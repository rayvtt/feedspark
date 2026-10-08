// FCC SECURITY HARNESS (Ray, 8 Oct 2026: "a complete security check and enforcement across FCC").
// Four parts: the gate module on its own; the worker's identity resolver LIFTED by name and run
// against a signed token; the worker's wiring (the gate runs before route(), the push lane compares
// in constant time behind a throttle, every allow-listed outbound fetch re-checks its redirects);
// and the repository itself (no secret-shaped string in any tracked file).
// Run: node tools/test_security.mjs   (qa_gate / presync / validate)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import * as SEC from '../cloudflare/feedspark-deck/src/security.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WK = fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');
let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + name); } };
const subtle = globalThis.crypto && globalThis.crypto.subtle ? globalThis.crypto.subtle : webcrypto.subtle;

// an in-memory KV with the two calls the throttle makes
const mkKv = () => { const m = new Map(); return { m, get: async (k, type) => { const v = m.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, v); } }; };
const H = (o) => ({ get: (k) => (o[k] == null ? null : String(o[k])) });

console.log('· the identity gate');
{
  t('the three public lanes and nothing else', [...SEC.PUBLIC_PATHS].sort().join() === '/api/gmail/push,/api/news,/api/version');
  t('OPTIONS is public (CORS preflight carries no identity)', SEC.isPublicPath('/api/briefs', 'OPTIONS'));
  t('a data route is not public', !SEC.isPublicPath('/api/briefs', 'GET') && !SEC.isPublicPath('/', 'GET') && !SEC.isPublicPath('/api/version/x', 'GET'));
  t('identity: the Access email, lower-cased', SEC.identityOf(H({ 'Cf-Access-Authenticated-User-Email': 'Ray@FeedSpark.com' })) === 'ray@feedspark.com');
  t('identity: a service token', SEC.identityOf(H({ 'Cf-Access-Client-Id': 'abcdefghijklmnop.access' })) === 'service:abcdefghijkl');
  t('identity: nothing = unknown', SEC.identityOf(H({})) === 'unknown');
  t('unknown on a data route → 401', (() => { const g = SEC.idGate('/api/briefs', 'GET', 'unknown', {}); return !g.ok && g.status === 401; })());
  t('unknown on a PAGE → 401 (the landing too — Access serves the login page, the worker never serves the page)', !SEC.idGate('/', 'GET', 'unknown', {}).ok && !SEC.idGate('/workflow', 'GET', 'unknown', {}).ok);
  t('unknown on a public lane → allowed, marked public', (() => { const g = SEC.idGate('/api/version', 'GET', 'unknown', {}); return g.ok && g.public; })());
  t('a signed-in email passes', SEC.idGate('/api/briefs', 'GET', 'steven@feedspark.com', {}).ok);
  t('a service token passes', SEC.idGate('/api/briefs', 'GET', 'service:abc', {}).ok);
  t('ALLOW_ANONYMOUS=1 is the only escape hatch, and it says so', (() => { const g = SEC.idGate('/api/briefs', 'GET', 'unknown', { ALLOW_ANONYMOUS: '1' }); return g.ok && g.anonymous && !SEC.idGate('/api/briefs', 'GET', 'unknown', { ALLOW_ANONYMOUS: 'yes' }).ok; })());
  const d = SEC.deniedBody('/api/x'), dp = SEC.deniedBody('/workflow');
  t('a refused API call gets JSON, a refused page gets a plain sign-in page naming Access', d.json && d.body.code === 'no_identity' && !dp.json && /Cloudflare Access/.test(dp.body));
}

console.log('· body caps');
{
  t('a GET is never capped', SEC.bodyGate('/api/briefs', 'GET', '999999999').ok);
  t('a 4 MB default on a PUT', SEC.bodyCapFor('/api/briefs') === 4 * 1024 * 1024 && SEC.bodyGate('/api/briefs', 'PUT', String(4 * 1024 * 1024)).ok && !SEC.bodyGate('/api/briefs', 'PUT', String(4 * 1024 * 1024 + 1)).ok);
  t('the refusal is a 413 carrying the cap and the size', (() => { const g = SEC.bodyGate('/api/state', 'POST', '9000000'); return g.status === 413 && g.cap === 4194304 && g.size === 9000000; })());
  t('the materials bank takes 26 MB, the push lane 48 MB', SEC.bodyCapFor('/api/materials') === 26 * 1024 * 1024 && SEC.bodyCapFor('/api/gmail/push') === 48 * 1024 * 1024 && SEC.bodyGate('/api/gmail/push', 'POST', String(40 * 1024 * 1024)).ok);
  t('an undeclared length passes and is marked so (Cloudflare bounds the request at 100 MB)', SEC.bodyGate('/api/briefs', 'PUT', null).undeclared === true && SEC.bodyGate('/api/briefs', 'PUT', 'abc').ok);
}

console.log('· constant-time compare');
{
  t('equal strings', SEC.safeEqual('k9x-secret', 'k9x-secret') && SEC.safeEqual('', ''));
  t('one char off', !SEC.safeEqual('k9x-secret', 'k9x-secreT'));
  t('a prefix is not a match, nor is a longer string', !SEC.safeEqual('k9x', 'k9x-secret') && !SEC.safeEqual('k9x-secret', 'k9x'));
  t('null / undefined never match a set key', !SEC.safeEqual(null, 'k') && !SEC.safeEqual(undefined, 'k') && !SEC.safeEqual('k', null));
  t('the loop runs over the LONGER string — no early return on a length difference', (() => { const src = SEC.safeEqual.toString(); return /Math\.max\(x\.length, y\.length\)/.test(src) && !/return false/.test(src); })());
}

console.log('· throttles');
{
  const kv = mkKv();
  const now = 1_700_000_000_000;
  let r;
  for (let i = 0; i < 20; i++) r = await SEC.throttleHit(kv, 'push-fail', '203.0.113.9', now + i * 1000);
  t('20 failures in the window: the 20th is counted and not yet over', r.n === 20 && !r.limited);
  t('…and the address now reads OVER for the rest of the window', await SEC.throttleOver(kv, 'push-fail', '203.0.113.9', now + 30000));
  t('another address is untouched', !(await SEC.throttleOver(kv, 'push-fail', '203.0.113.10', now + 30000)));
  t('the window rolls: 10 minutes on, the same address starts at one', (await SEC.throttleHit(kv, 'push-fail', '203.0.113.9', now + 601_000)).n === 1);
  t('the record is keyed rl:<bucket>:<subject> with unsafe characters replaced', SEC.throttleKey('push-fail', '2001:db8::1') === 'rl:push-fail:2001:db8::1' && SEC.throttleKey('/api/claude', 'ray@feedspark.com') === 'rl:/api/claude:ray@feedspark.com' && !/[<>"]/.test(SEC.throttleKey('x', '<b>"')));
  t('money routes are per identity: 120 Tachyon calls, 300 AI-visibility asks, 60 i18n posts per 10 minutes', SEC.THROTTLES['/api/claude'].limit === 120 && SEC.THROTTLES['/api/aivis/ask'].limit === 300 && SEC.THROTTLES['/api/i18n'].limit === 60 && [...SEC.MONEY_PATHS].every((p) => SEC.THROTTLES[p]));
  const kv2 = mkKv();
  for (let i = 0; i < 120; i++) r = await SEC.throttleHit(kv2, '/api/claude', 'steven@feedspark.com', now);
  t('the 120th Tachyon call goes through, the 121st is limited', !r.limited && (await SEC.throttleHit(kv2, '/api/claude', 'steven@feedspark.com', now)).limited);
  t('a bucket nobody defined never limits', !(await SEC.throttleHit(kv2, 'nothing', 'x')).limited && !(await SEC.throttleOver(kv2, 'nothing', 'x')));
  const broken = { get: async () => { throw new Error('kv down'); }, put: async () => { throw new Error('kv down'); } };
  t('a KV error never blocks a request', !(await SEC.throttleHit(broken, 'push-fail', 'a')).limited && !(await SEC.throttleOver(broken, 'push-fail', 'a')));
}

console.log('· redirect-checked outbound fetch');
{
  const log = [];
  const mk = (status, headers, body) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] || null }, body: body === undefined ? { cancel: async () => {} } : body });
  const world = {
    'https://cdn.northwind.example/a.jpg': mk(302, { location: '/b.jpg' }),
    'https://cdn.northwind.example/b.jpg': mk(302, { location: 'https://img.northwind.example/c.jpg' }),
    'https://img.northwind.example/c.jpg': mk(200, { 'content-type': 'image/jpeg' }, 'bytes'),
    'https://cdn.northwind.example/evil.jpg': mk(302, { location: 'https://169.254.169.254/latest/meta-data' }),
    'https://cdn.northwind.example/loop.jpg': mk(302, { location: '/loop.jpg' }),
  };
  const fetchFn = async (u, init) => { log.push({ u, redirect: init.redirect }); return world[u] || mk(404, {}); };
  const allowed = (u) => /(^|\.)northwind\.example$/.test(SEC.hostOf(u));
  const a = await SEC.fetchWithin(fetchFn, 'https://cdn.northwind.example/a.jpg', allowed, { headers: { x: 1 } });
  t('a relative hop and a hop to another allowed host are followed; the final response comes back with the hop count', !a.blocked && a.res.status === 200 && a.url === 'https://img.northwind.example/c.jpg' && a.hops === 2);
  t('every hop is fetched with redirect:manual (the runtime never follows on its own)', log.every((l) => l.redirect === 'manual'));
  log.length = 0;
  const b = await SEC.fetchWithin(fetchFn, 'https://cdn.northwind.example/evil.jpg', allowed, {});
  t('a hop OFF the allow-list is refused with its host named — and that host is never fetched', b.blocked && b.host === '169.254.169.254' && !log.some((l) => /169\.254/.test(l.u)));
  const c = await SEC.fetchWithin(fetchFn, 'https://evil.example/x', allowed, {});
  t('a first URL off the list is refused before any fetch', c.blocked && c.hops === 0);
  const d = await SEC.fetchWithin(fetchFn, 'https://cdn.northwind.example/loop.jpg', allowed, {}, 3);
  t('a redirect loop stops at maxHops', d.blocked && d.tooMany && d.hops === 4);
  t('hostOf reads a hostname and nothing from a broken URL', SEC.hostOf('https://A.B.example/x?y') === 'a.b.example' && SEC.hostOf('nope') === '');
}

console.log('· the Access JWT');
const kp = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await subtle.exportKey('jwk', kp.publicKey);
const certs = { keys: [{ kid: 'k1', kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' }] };
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = async (payload, header) => {
  const h = b64u(JSON.stringify(Object.assign({ alg: 'RS256', kid: 'k1', typ: 'JWT' }, header || {})));
  const p = b64u(JSON.stringify(payload));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
};
const NOW = 1_800_000_000_000, nowS = NOW / 1000;
const AUD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdefabcdef';
{
  const good = await sign({ aud: [AUD], email: 'Steven@FeedSpark.com', exp: nowS + 3600, iat: nowS, nbf: nowS, sub: 'u1', iss: 'https://feedspark.cloudflareaccess.com' });
  const v = await SEC.verifyAccessJwt(good, certs, AUD, NOW, subtle);
  t('a token signed by the team key for this audience verifies and names the email, lower-cased', v.ok && v.email === 'steven@feedspark.com' && SEC.identityFromJwt(v) === 'steven@feedspark.com');
  t('aud as a plain string verifies too', (await SEC.verifyAccessJwt(await sign({ aud: AUD, email: 'a@b.c', exp: nowS + 10 }), certs, AUD, NOW, subtle)).ok);
  t('expired → refused', (await SEC.verifyAccessJwt(await sign({ aud: [AUD], email: 'a@b.c', exp: nowS - 120 }), certs, AUD, NOW, subtle)).reason === 'expired');
  t('wrong audience → refused', (await SEC.verifyAccessJwt(await sign({ aud: ['other'], email: 'a@b.c', exp: nowS + 10 }), certs, AUD, NOW, subtle)).reason === 'audience');
  t('unknown kid → refused (the worker then re-reads the certs once)', (await SEC.verifyAccessJwt(await sign({ aud: [AUD], email: 'a@b.c', exp: nowS + 10 }, { kid: 'k9' }), certs, AUD, NOW, subtle)).reason === 'unknown kid');
  t('alg none → refused', (await SEC.verifyAccessJwt(b64u(JSON.stringify({ alg: 'none', kid: 'k1' })) + '.' + b64u(JSON.stringify({ aud: [AUD], email: 'a@b.c', exp: nowS + 10 })) + '.', certs, AUD, NOW, subtle)).reason === 'alg none');
  const tampered = good.replace(/\.([^.]+)\.([^.]+)$/, (m, p, s) => '.' + b64u(JSON.stringify({ aud: [AUD], email: 'ray@feedspark.com', exp: nowS + 3600 })) + '.' + s);
  t('a payload rewritten to the owner\'s email fails the signature', (await SEC.verifyAccessJwt(tampered, certs, AUD, NOW, subtle)).reason === 'signature');
  t('garbage → malformed, and the identity of any failure is unknown', (await SEC.verifyAccessJwt('abc', certs, AUD, NOW, subtle)).reason === 'malformed' && SEC.identityFromJwt({ ok: false }) === 'unknown' && SEC.identityFromJwt(null) === 'unknown');
  t('a service token (common_name, no email) is a service identity', SEC.identityFromJwt({ ok: true, email: '', service: 'xml-scan-agent' }) === 'service:xml-scan-age');
  t('configured only with BOTH vars; the certs URL is the team\'s', !SEC.accessConfigured({ ACCESS_AUD: AUD }) && !SEC.accessConfigured({ ACCESS_TEAM_DOMAIN: 'feedspark' }) && SEC.accessConfigured({ ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: 'feedspark' })
    && SEC.accessCertsUrl({ ACCESS_TEAM_DOMAIN: 'feedspark' }) === 'https://feedspark.cloudflareaccess.com/cdn-cgi/access/certs'
    && SEC.accessCertsUrl({ ACCESS_TEAM_DOMAIN: 'https://feedspark.cloudflareaccess.com/' }) === 'https://feedspark.cloudflareaccess.com/cdn-cgi/access/certs');
}

console.log('· the worker\'s identity resolver, lifted and run');
{
  const a = WK.indexOf('async function resolveIdentity('); const b = WK.indexOf('\n}\n', a);
  t('resolveIdentity is in the worker', a > 0 && b > a);
  const src = 'let ACCESS_CERTS = null;\n' + WK.slice(a, b + 2) + '\nreturn resolveIdentity;';
  const mkReq = (headers) => ({ method: 'GET', headers: H(headers) });
  let certFetches = 0;
  const fetchStub = async (u) => { certFetches++; if (!/cloudflareaccess\.com\/cdn-cgi\/access\/certs$/.test(u)) throw new Error('unexpected fetch ' + u); return { ok: true, json: async () => certs }; };
  const R = new Function('SEC', 'fetch', 'crypto', src)(SEC, fetchStub, { subtle });
  const envOff = {}, envOn = { ACCESS_TEAM_DOMAIN: 'feedspark', ACCESS_AUD: AUD };
  t('unconfigured: the Access header is trusted as before', (await R(mkReq({ 'Cf-Access-Authenticated-User-Email': 'ray@feedspark.com' }), envOff, '/api/briefs')) === 'ray@feedspark.com' && certFetches === 0);
  t('configured: a spoofed email header with NO token is unknown', (await R(mkReq({ 'Cf-Access-Authenticated-User-Email': 'ray@feedspark.com' }), envOn, '/api/briefs')) === 'unknown');
  const tok = await sign({ aud: [AUD], email: 'steven@feedspark.com', exp: Math.floor(Date.now() / 1000) + 600 });
  t('configured: the identity is the TOKEN\'s email, not the header\'s', (await R(mkReq({ 'Cf-Access-Authenticated-User-Email': 'ray@feedspark.com', 'Cf-Access-Jwt-Assertion': tok }), envOn, '/api/briefs')) === 'steven@feedspark.com');
  t('the token is also read off the CF_Authorization cookie', (await R(mkReq({ Cookie: 'a=1; CF_Authorization=' + tok + '; b=2' }), envOn, '/')) === 'steven@feedspark.com');
  t('the certs were read once and cached', certFetches === 1);
  const bad = await sign({ aud: [AUD], email: 'ray@feedspark.com', exp: Math.floor(Date.now() / 1000) + 600 }, { kid: 'k9' });
  t('an unknown kid re-reads the certs once, then still refuses', (await R(mkReq({ 'Cf-Access-Jwt-Assertion': bad }), envOn, '/api/briefs')) === 'unknown' && certFetches === 2);
  t('the public push lane never needs a token (headers only, no cert read)', (await R(mkReq({}), envOn, '/api/gmail/push')) === 'unknown' && certFetches === 2);
  const Rdown = new Function('SEC', 'fetch', 'crypto', src)(SEC, async () => { throw new Error('offline'); }, { subtle });
  t('the certs endpoint unreachable → unknown (fail closed), never a trusted header', (await Rdown(mkReq({ 'Cf-Access-Authenticated-User-Email': 'ray@feedspark.com', 'Cf-Access-Jwt-Assertion': tok }), envOn, '/api/briefs')) === 'unknown');
}

console.log('· the worker\'s wiring');
{
  const fetchBlock = WK.slice(WK.indexOf('async fetch(request, env, ctx) {'), WK.indexOf('async scheduled(event, env, ctx)'));
  const idx = (s) => fetchBlock.indexOf(s);
  t('fetch() resolves the identity, stashes it, and runs the gate BEFORE route()', idx('resolveIdentity(request, env, path)') > 0 && idx('IDENT.set(request, ident)') > idx('resolveIdentity(') && idx('SEC.idGate(') > idx('IDENT.set(') && idx('await route(request, env, ctx)') > idx('SEC.idGate('));
  t('the body cap and the money-route throttle also run before route()', idx('SEC.bodyGate(') > 0 && idx('SEC.bodyGate(') < idx('await route(') && idx('SEC.MONEY_PATHS.has(path)') < idx('await route(') && /429/.test(fetchBlock));
  t('every answer out of fetch() goes through secHeaders with the request origin', (fetchBlock.match(/secHeaders\(/g) || []).length >= 4 && !/return (json|new Response)\([^;]*;\s*$/m.test(fetchBlock.replace(/secHeaders\([\s\S]*?\);/g, '')));
  t('who() reads the stashed identity first', /function who\(request\) \{\s*const stashed = IDENT\.get\(request\);\s*if \(stashed\) return stashed;/.test(WK));
  t('secHeaders tightens CORS to the request origin and marks /api/ no-store', /function secHeaders\(res, path, origin\)/.test(WK) && /SEC\.tightenHeaders\(new Headers\(res\.headers\), path, origin\)/.test(WK));
  const h = SEC.tightenHeaders(new Headers({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }), '/api/briefs', 'https://feedspark.ray-vtt.workers.dev');
  t('…so an answer built with the open CORS constant leaves with the app\'s own origin, Vary: Origin and no-store', h.get('Access-Control-Allow-Origin') === 'https://feedspark.ray-vtt.workers.dev' && /Origin/.test(h.get('Vary')) && h.get('Cache-Control') === 'no-store');
  const h2 = SEC.tightenHeaders(new Headers({ 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=86400' }), '/design/fcc.css', 'https://x');
  t('a page or asset with its own cache directive is left alone; no CORS header is invented', h2.get('Cache-Control') === 'public, max-age=86400' && !h2.get('Access-Control-Allow-Origin'));
  const push = WK.slice(WK.indexOf("if (path === '/api/gmail/push' && request.method === 'POST') {"), WK.indexOf('if (body.outboxPoll)'));
  t('the push lane compares the key in constant time', /SEC\.safeEqual\(request\.headers\.get\('X-FCC-Push-Key'\), env\.GMAIL_PUSH_KEY\)/.test(push) && !/!== env\.GMAIL_PUSH_KEY/.test(push));
  t('…behind a per-IP brake read BEFORE the compare and counted on every failure', push.indexOf("SEC.throttleOver(env.EDITS, 'push-fail'") < push.indexOf('SEC.safeEqual(') && /SEC\.throttleHit\(env\.EDITS, 'push-fail', pushIp\)/.test(push) && /429/.test(push));
  t('no outbound fetch follows redirects on its own any more', !/redirect: 'follow'/.test(WK));
  t('the image proxy and the PDP fetch run through fetchWithin on their own allow-lists', /SEC\.fetchWithin\(fetch, target, \(u\) => catImgAllowed\(u, hosts\)/.test(WK) && /SEC\.fetchWithin\(fetch, target, \(u\) => pdpHostAllowed\(u, host\)/.test(WK));
  t('the feed proxy, the master file and the image proxy still never take a URL from the query that is not allow-listed', /no open proxy: only clients whose feed/.test(WK) && /catFileOk/.test(WK) && /catImgAllowed\(target, hosts\)\) return json/.test(WK));
  const owners = (WK.match(/realOwner\(env, request\)/g) || []).length;
  t('the owner gates still resolve through realOwner (view-as denied like the person previewed)', owners >= 8);
  const wf = fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_Workflow.html'), 'utf8'), vw = fs.readFileSync(path.join(ROOT, 'docs/viewas_widget.html'), 'utf8');
  t('the view-as cookie is Secure + SameSite=Lax, set and cleared', /fcc-viewas='\+encodeURIComponent\(em\)\+';path=\/;max-age=7200;Secure;SameSite=Lax'/.test(wf) && /fcc-viewas=;path=\/;max-age=0;Secure;SameSite=Lax/.test(vw));
  t('the CSP is still one list the CSP tripwire can lift', /const CSP = \[[\s\S]*?\]\.join\('; '\);/.test(WK) && /object-src 'none'/.test(WK) && /frame-ancestors 'self'/.test(WK) && /base-uri 'self'/.test(WK));
  t('HSTS, nosniff, Referrer-Policy and Permissions-Policy still leave on every answer', /Strict-Transport-Security/.test(WK) && /X-Content-Type-Options', 'nosniff'/.test(WK) && /Referrer-Policy', 'same-origin'/.test(WK) && /Permissions-Policy/.test(WK));
  // every /api/ path literal in the router that is PUBLIC must be one of the three — a new public lane is a decision, not an accident
  const pathLits = [...new Set((WK.match(/path === '\/api\/[^']+'/g) || []).map((m) => m.slice(10, -1)))];
  t('the router names ' + pathLits.length + ' /api/ paths; every one but the three public lanes sits behind the identity gate', pathLits.length > 100 && pathLits.filter((p) => SEC.isPublicPath(p, 'GET')).sort().join() === '/api/gmail/push,/api/news,/api/version');
}

console.log('· the repository');
{
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !/\.(png|jpg|jpeg|webp|mp4|pptx|pdf|xlsx|woff2?|ico|zip|gz)$/i.test(f));
  const shapes = [
    [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic key'],
    [/AIza[0-9A-Za-z_-]{30,}/, 'a Google API key'],
    [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'a private key'],
    [/xox[bpas]-[0-9A-Za-z-]{10,}/, 'a Slack token'],
    [/gh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
    [/"private_key_id"\s*:\s*"[0-9a-f]{20,}"/, 'a service-account JSON'],
    [/(GMAIL_PUSH_KEY|ROAS_MCP_TOKEN|TM_MCP_TOKEN|ANTHROPIC_API_KEY|SERPAPI_KEY|OPENAI_API_KEY|PERPLEXITY_API_KEY)\s*=\s*["']?[A-Za-z0-9_\-]{16,}/, 'a worker secret assigned a value'],
  ];
  const hits = [];
  for (const f of files) {
    let s; try { s = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
    for (const [re, what] of shapes) if (re.test(s)) hits.push(f + ': ' + what);
  }
  t('no secret-shaped string in any of ' + files.length + ' tracked files' + (hits.length ? ' — ' + hits.join('; ') : ''), hits.length === 0);
  const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const vars = (toml.split('[vars]')[1] || '').split('[')[0].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  t('wrangler.toml [vars] carries configuration only (OWNER_EMAIL) — every credential is a Worker secret', /OWNER_EMAIL/.test(vars) && !/KEY|TOKEN|SECRET|PASS/i.test(vars));
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  t('.dev.vars and ops/reports/ are ignored', /\.dev\.vars/.test(gi) && /ops\/reports\//.test(gi));
  t('docs/SECURITY.md is the register and names every control here', (() => { const d = fs.existsSync(path.join(ROOT, 'docs/SECURITY.md')) ? fs.readFileSync(path.join(ROOT, 'docs/SECURITY.md'), 'utf8') : ''; return /ACCESS_AUD/.test(d) && /ALLOW_ANONYMOUS/.test(d) && /fetchWithin/.test(d) && /push-fail/.test(d) && /Preview URLs/i.test(d); })());
}

console.log(fail ? `✗ ${fail} failed, ${pass} passed` : `✓ ${pass} passed`);
process.exit(fail ? 1 : 0);
