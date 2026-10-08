// FCC SECURITY — the rules every request passes through (Ray, 8 Oct 2026: "Perform a complete
// security check and enforcement across FCC, and make sure it will be safe from bot attacks or
// any type of attack"). Pure functions; the worker's fetch() entry calls them and tools/test_security.mjs
// runs them. Nothing here reads a page or a feed. docs/SECURITY.md is the register.
//
// THE MODEL. The whole FCC sits behind Cloudflare Access (Zero Trust): a site-wide Allow app and ONE
// path-scoped Bypass for /api/gmail/push, which the agents reach with a shared key. The worker learns
// who is asking from the headers Access injects. Three things follow, each enforced below:
//   1. A request with NO identity is refused (idGate). Before this, an anonymous request resolved to
//      'unknown' → unassigned → full house — so any route that reached the worker without passing
//      through Access (a Workers preview URL, a route added to another hostname, a misconfigured
//      policy) answered the whole book to anyone. Only the public lanes stay open: the version
//      marker, the news digest, the key-gated push lane and CORS preflight.
//   2. The identity header can be VERIFIED, not just read (accessJwt). Access signs every request
//      with Cf-Access-Jwt-Assertion; with ACCESS_TEAM_DOMAIN + ACCESS_AUD set the worker checks the
//      RS256 signature against the team's published keys and reads the email from the token, so a
//      spoofed header is worth nothing. Unset, the headers are trusted as before and the audit says so.
//   3. Everything a request can make the worker DO is bounded: body size per lane, a constant-time
//      key compare + a per-IP throttle on the push lane, a per-identity throttle on the routes that
//      spend money, and an outbound fetch that re-checks its allow-list on EVERY redirect hop.

// ---- lanes that answer without an Access identity ----
// Every other path needs one. /api/version is the deploy check, /api/news the git-bundled digest
// (no client data in either); /api/gmail/push is key-gated and sits behind the Access Bypass.
export const PUBLIC_PATHS = new Set(['/api/version', '/api/news', '/api/gmail/push']);

export function isPublicPath(path, method) {
  if (method === 'OPTIONS') return true;
  return PUBLIC_PATHS.has(String(path || ''));
}

// identity off the headers Access injects — the email, else a service token's id, else 'unknown'
export function identityOf(headers) {
  const get = (k) => (headers && typeof headers.get === 'function' ? headers.get(k) : (headers || {})[k]) || '';
  const e = get('Cf-Access-Authenticated-User-Email');
  if (e) return String(e).toLowerCase();
  const svc = get('Cf-Access-Client-Id');
  if (svc) return 'service:' + String(svc).slice(0, 12);
  return 'unknown';
}

// the identity gate: { ok:true } or { ok:false, status:401, reason }
// env.ALLOW_ANONYMOUS = '1' is the emergency escape hatch (documented, never the default)
export function idGate(path, method, identity, env) {
  if (isPublicPath(path, method)) return { ok: true, public: true };
  if (identity && identity !== 'unknown') return { ok: true };
  if (env && String(env.ALLOW_ANONYMOUS || '') === '1') return { ok: true, anonymous: true };
  return { ok: false, status: 401, reason: 'no Cloudflare Access identity on this request' };
}

// ---- request body caps (bytes), read off Content-Length before the body is touched ----
// 4 MB covers every page save (the largest kvmerge envelopes are well under 1 MB); the materials
// bank takes client decks (its own route already refuses over 24 MB); the push lane carries the
// xml-scan agent's batches of 8 feed snapshots with their id sets (several MB each).
export const BODY_CAP_DEFAULT = 4 * 1024 * 1024;
export const BODY_CAPS = { '/api/materials': 26 * 1024 * 1024, '/api/gmail/push': 48 * 1024 * 1024 };

export function bodyCapFor(path) {
  return BODY_CAPS[String(path || '')] || BODY_CAP_DEFAULT;
}

// { ok:true } or { ok:false, status:413 }. A body with no declared length is allowed through —
// Cloudflare already bounds a request at 100 MB and every FCC client sends a length.
export function bodyGate(path, method, contentLength) {
  if (method !== 'PUT' && method !== 'POST' && method !== 'PATCH') return { ok: true };
  const n = Number(contentLength);
  if (!contentLength || !Number.isFinite(n) || n < 0) return { ok: true, undeclared: true };
  const cap = bodyCapFor(path);
  return n > cap ? { ok: false, status: 413, cap, size: n } : { ok: true, cap, size: n };
}

// ---- constant-time string compare (the push key) ----
// Runs over the longer of the two so the time never says where the first difference is, and folds
// the length difference into the result rather than returning early on it.
export function safeEqual(a, b) {
  const x = String(a == null ? '' : a), y = String(b == null ? '' : b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i % (x.length || 1)) || 0) ^ (y.charCodeAt(i % (y.length || 1)) || 0);
  return diff === 0 && x.length === y.length;
}

// ---- throttles (KV-backed, fixed window) ----
// A counter per bucket × subject with a TTL = the window. KV is eventually consistent, so this is a
// brake, not a turnstile: it stops a key being brute-forced and a compromised signin burning the
// Anthropic budget, and costs one read (plus one write when counted) per request on the lanes it
// guards. A KV error never blocks a request.
export const THROTTLES = {
  // failed push-key attempts per IP: 20 in 10 minutes, then 429 for the rest of the window
  'push-fail': { limit: 20, windowS: 600 },
  // money routes, per identity
  '/api/claude': { limit: 120, windowS: 600 },
  '/api/aivis/ask': { limit: 300, windowS: 600 },
  '/api/i18n': { limit: 60, windowS: 600 },
};
export const MONEY_PATHS = new Set(['/api/claude', '/api/aivis/ask', '/api/i18n']);

export function throttleKey(bucket, subject) {
  return 'rl:' + String(bucket).replace(/[^a-z0-9/_-]/gi, '_').slice(0, 40) + ':' + String(subject || 'none').replace(/[^a-z0-9.:_@-]/gi, '_').slice(0, 80);
}

// read the window: { n, limited } — does NOT count
export async function throttleRead(kv, bucket, subject) {
  const t = THROTTLES[bucket]; if (!t || !kv) return { n: 0, limited: false };
  try {
    const n = Number(await kv.get(throttleKey(bucket, subject))) || 0;
    return { n, limited: n >= t.limit, limit: t.limit, windowS: t.windowS };
  } catch (e) { return { n: 0, limited: false }; }
}

// count one and answer whether the subject is now over: { n, limited }
export async function throttleHit(kv, bucket, subject, now) {
  const t = THROTTLES[bucket]; if (!t || !kv) return { n: 0, limited: false };
  const k = throttleKey(bucket, subject);
  try {
    const cur = await kv.get(k, 'json');
    const nowS = Math.floor((now || Date.now()) / 1000);
    // the record is { n, w } — w is the window's start; a record from an older window starts over
    const rec = cur && typeof cur === 'object' && Number.isFinite(cur.w) && nowS - cur.w < t.windowS ? cur : { n: 0, w: nowS };
    rec.n = (Number(rec.n) || 0) + 1;
    await kv.put(k, JSON.stringify(rec), { expirationTtl: Math.max(60, t.windowS - (nowS - rec.w)) });
    return { n: rec.n, limited: rec.n > t.limit, limit: t.limit, windowS: t.windowS };
  } catch (e) { return { n: 0, limited: false }; }
}

// is the subject already over? reads the same {n,w} record throttleHit writes
export async function throttleOver(kv, bucket, subject, now) {
  const t = THROTTLES[bucket]; if (!t || !kv) return false;
  try {
    const cur = await kv.get(throttleKey(bucket, subject), 'json');
    const nowS = Math.floor((now || Date.now()) / 1000);
    return !!(cur && Number.isFinite(cur.w) && nowS - cur.w < t.windowS && (Number(cur.n) || 0) >= t.limit);
  } catch (e) { return false; }
}

// ---- outbound fetch that re-checks its allow-list on EVERY redirect hop ----
// redirect:'follow' asks the runtime to follow a Location header to wherever it points, so an
// allow-listed product page that 302s to another host would have the worker fetch THAT host — the
// allow-list checked only the first URL. Manual redirects: each hop is resolved against the previous
// URL and must pass the same predicate, up to maxHops; a hop that fails is refused with its host named.
export async function fetchWithin(fetchFn, target, allowed, init, maxHops) {
  let url = String(target), hops = 0;
  const max = Number.isFinite(maxHops) ? maxHops : 5;
  for (;;) {
    if (!allowed(url)) return { blocked: true, url, host: hostOf(url), hops };
    const res = await fetchFn(url, Object.assign({}, init || {}, { redirect: 'manual' }));
    const loc = res.headers && res.headers.get ? res.headers.get('location') : '';
    if (res.status >= 300 && res.status < 400 && loc) {
      if (res.body && res.body.cancel) { try { await res.body.cancel(); } catch (e) {} }
      if (++hops > max) return { blocked: true, url, host: hostOf(url), hops, tooMany: true };
      try { url = new URL(loc, url).toString(); } catch (e) { return { blocked: true, url: loc, host: '', hops, badLocation: true }; }
      continue;
    }
    return { blocked: false, res, url, hops };
  }
}
export function hostOf(u) { try { return new URL(String(u)).hostname.toLowerCase(); } catch (e) { return ''; } }

// ---- Cloudflare Access JWT (optional, on when ACCESS_TEAM_DOMAIN + ACCESS_AUD are set) ----
// Access signs each request it lets through with Cf-Access-Jwt-Assertion (RS256). The team's public
// keys sit at https://<team>.cloudflareaccess.com/cdn-cgi/access/certs; the AUD is the application's
// audience tag (Zero Trust → Access → Applications → the site-wide app → Overview). A valid token
// names the email the header claims; an invalid one means the header is not Cloudflare's word.
export function accessConfigured(env) {
  return !!(env && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}
export function accessCertsUrl(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return team ? 'https://' + team + (team.includes('.') ? '' : '.cloudflareaccess.com') + '/cdn-cgi/access/certs' : '';
}
function b64urlToBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const dec = new TextDecoder();
    return { header: JSON.parse(dec.decode(b64urlToBytes(parts[0]))), payload: JSON.parse(dec.decode(b64urlToBytes(parts[1]))),
      signed: parts[0] + '.' + parts[1], sig: b64urlToBytes(parts[2]) };
  } catch (e) { return null; }
}
// certs = the JSON body of the certs endpoint ({ keys:[jwk…] }); subtle = crypto.subtle.
// Returns { ok:true, email, sub, exp } or { ok:false, reason }.
export async function verifyAccessJwt(token, certs, aud, now, subtle) {
  const j = decodeJwt(token);
  if (!j) return { ok: false, reason: 'malformed' };
  if (j.header.alg !== 'RS256') return { ok: false, reason: 'alg ' + String(j.header.alg) };
  const key = (certs && Array.isArray(certs.keys) ? certs.keys : []).find((k) => k.kid === j.header.kid);
  if (!key) return { ok: false, reason: 'unknown kid' };
  const nowS = Math.floor((now || Date.now()) / 1000);
  if (!Number.isFinite(j.payload.exp) || j.payload.exp < nowS - 60) return { ok: false, reason: 'expired' };
  if (Number.isFinite(j.payload.nbf) && j.payload.nbf > nowS + 60) return { ok: false, reason: 'not yet valid' };
  const auds = Array.isArray(j.payload.aud) ? j.payload.aud : [j.payload.aud];
  if (!auds.some((a) => safeEqual(a, aud))) return { ok: false, reason: 'audience' };
  try {
    const ck = await subtle.importKey('jwk', { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const good = await subtle.verify('RSASSA-PKCS1-v1_5', ck, j.sig, new TextEncoder().encode(j.signed));
    if (!good) return { ok: false, reason: 'signature' };
  } catch (e) { return { ok: false, reason: 'verify failed' }; }
  const email = String(j.payload.email || '').toLowerCase();
  return { ok: true, email, sub: String(j.payload.sub || ''), exp: j.payload.exp, service: !email && j.payload.common_name ? String(j.payload.common_name) : '' };
}

// the identity a verified request carries: the token's email, a service token's name, or
// 'unknown' when the token is missing/invalid — never the unverified header
export function identityFromJwt(v) {
  if (!v || !v.ok) return 'unknown';
  if (v.email) return v.email;
  if (v.service) return 'service:' + v.service.slice(0, 12);
  return 'unknown';
}

// ---- response headers ----
// Access-Control-Allow-Origin is rewritten from '*' to the request's own origin: the FCC is a
// same-origin app, nothing else reads its JSON, and an open origin is one less thing to reason
// about. Every /api/ answer without a cache directive gets no-store so a shared cache never keeps it.
export function tightenHeaders(h, path, origin) {
  if (h.get('Access-Control-Allow-Origin')) { h.set('Access-Control-Allow-Origin', origin || 'null'); h.set('Vary', [h.get('Vary'), 'Origin'].filter(Boolean).join(', ')); }
  if (String(path || '').startsWith('/api/') && !h.get('Cache-Control')) h.set('Cache-Control', 'no-store');
  return h;
}

// the answer an anonymous request gets
export function deniedBody(path) {
  if (String(path || '').startsWith('/api/')) return { json: true, body: { error: 'sign in through Cloudflare Access', code: 'no_identity' } };
  return { json: false, body: '<!doctype html><meta charset="utf-8"><title>Sign in</title><body style="font-family:Lato,system-ui,sans-serif;padding:60px;color:#333"><h2>Sign in required</h2><p>This page is only served to a signed-in FeedSpark account through Cloudflare Access.</p></body>' };
}
