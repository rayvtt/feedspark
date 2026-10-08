// THE BRAND'S OWN FACE ON A SOCIAL AD (Ray, 8 Oct 2026: "ensure also client's logo is as how they are — get it
// from their actual meta & ig & partner platforms"). Pure: which URL to read for a brand's picture on each
// network, how to find the picture and the account's own name in what comes back, and which hosts a fetch may
// touch on the way. The worker (/api/social/logo) does the fetching through SEC.fetchWithin, so every redirect
// hop is checked against the same list — this is never an open proxy: the handle is the only thing a caller
// supplies, and it is checked against HANDLE_RE before it is put into a fixed URL.
//
//   fb   — graph.facebook.com/<page>/picture?type=large&redirect=false — public, no token; {data:{url,is_silhouette}}
//   tt   — www.tiktok.com/@<handle> — the profile page carries uniqueId, nickname, avatarLarger, verified
//   pin  — www.pinterest.com/<handle>/ — the profile page carries username, full_name, image_xlarge_url
//   site — the brand's own website (the feed's product host) — its apple-touch-icon / icon links
//   Instagram — NO public read (every profile endpoint answers require_login), so it is not a network here.
//
// The account's own NAME comes back with the picture because a handle can belong to somebody else — checked live
// on 8 Oct 2026, TikTok @reiss is "ÇATLI" and Pinterest @superdry is "Dry Super". The page shows the name and the
// verified mark and an AM says "this is us" before a network's own avatar is used.

export const HANDLE_RE = /^[A-Za-z0-9._]{2,60}$/;
export const NETS = ['fb', 'tt', 'pin', 'site'];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function profileUrl(net, h, siteHost) {
  if (net === 'site') return siteHost ? 'https://' + siteHost + '/' : '';
  if (!HANDLE_RE.test(String(h || ''))) return '';
  if (net === 'fb') return 'https://graph.facebook.com/' + h + '/picture?type=large&redirect=false';
  if (net === 'tt') return 'https://www.tiktok.com/@' + h;
  if (net === 'pin') return 'https://www.pinterest.com/' + h + '/';
  return '';
}

function hostOf(u) { try { const x = new URL(String(u)); return x.protocol === 'https:' ? x.hostname.toLowerCase() : ''; } catch (e) { return ''; } }
// the registrable part of a host: shop.monsoon.co.uk and www.monsoon.co.uk are one site, cdn.other.com is not
export function regDomain(host) {
  const p = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (p.length < 2) return p.join('.');
  const sl = p[p.length - 2], tl = p[p.length - 1];
  if (p.length >= 3 && tl.length === 2 && /^(co|com|org|net|ac|gov|ltd|plc)$/.test(sl)) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
function sameSite(u, siteHost) { const h = hostOf(u); return !!(h && siteHost && regDomain(h) === regDomain(siteHost)); }

// hosts the PROFILE read may land on (redirects included)
export function pageAllowed(net, u, siteHost) {
  const h = hostOf(u); if (!h) return false;
  if (net === 'fb') return h === 'graph.facebook.com';
  if (net === 'tt') return h === 'www.tiktok.com' || h === 'tiktok.com';
  if (net === 'pin') return /^([a-z]{2,3}\.|www\.)?pinterest\.(com|co\.uk|[a-z]{2,3}|com\.[a-z]{2})$/.test(h);
  if (net === 'site') return sameSite(u, siteHost);
  return false;
}
// hosts the PICTURE may come from
export function imgAllowed(net, u, siteHost) {
  const h = hostOf(u); if (!h) return false;
  if (net === 'fb') return /(^|\.)fbcdn\.net$/.test(h);
  if (net === 'tt') return /(^|\.)tiktokcdn(-us|-eu)?\.com$/.test(h);
  if (net === 'pin') return h === 'i.pinimg.com';
  if (net === 'site') return sameSite(u, siteHost);
  return false;
}

function unesc(s) {
  return String(s || '').replace(/\\u([0-9a-fA-F]{4})/g, (m, x) => String.fromCharCode(parseInt(x, 16))).replace(/\\\//g, '/').replace(/&amp;/g, '&');
}
function near(text, at, re, span) {
  // the match of re closest to `at` within ±span — a profile page carries many accounts' objects (related pins,
  // suggested creators), and the right picture is the one beside the right username
  const lo = Math.max(0, at - span), seg = text.slice(lo, at + span);
  let best = null, m; const r = new RegExp(re.source, 'g');
  while ((m = r.exec(seg))) { const d = Math.abs(lo + m.index - at); if (!best || d < best.d) best = { d, v: m[1] }; }
  return best ? best.v : '';
}

// what a profile read says: { img, name, verified } or { none: why }
export function parseProfile(net, h, body) {
  body = String(body || '');
  if (net === 'fb') {
    let j; try { j = JSON.parse(body); } catch (e) { return { none: 'Facebook did not answer with a picture' }; }
    const d = j && j.data;
    if (!d || !d.url) return { none: (j && j.error && 'Facebook has no public page "' + h + '"') || 'Facebook has no picture for "' + h + '"' };
    if (d.is_silhouette) return { none: 'the Facebook page "' + h + '" has no picture of its own' };
    return { img: String(d.url), name: '', verified: false };
  }
  if (net === 'tt') {
    const key = '"uniqueId":"' + h + '"';
    let at = body.indexOf(key);
    if (at < 0) { const lo = body.toLowerCase().indexOf(key.toLowerCase()); at = lo; }
    if (at < 0) return { none: 'TikTok shows no account @' + h + ' (or did not show the profile to the server)' };
    const img = unesc(near(body, at, /"avatarLarger":"([^"]+)"/, 4000) || near(body, at, /"avatarMedium":"([^"]+)"/, 4000));
    if (!img) return { none: 'TikTok shows @' + h + ' with no picture' };
    return { img, name: unesc(near(body, at, /"nickname":"([^"]*)"/, 4000)), verified: near(body, at, /"verified":(true|false)/, 4000) === 'true' };
  }
  if (net === 'pin') {
    const key = '"username":"' + h + '"', low = body.toLowerCase(), k2 = key.toLowerCase();
    // the profile's own object carries seo_title; an occurrence without it is the same user quoted on a pin
    let at = -1, i = low.indexOf(k2), first = -1;
    while (i >= 0) { if (first < 0) first = i; if (low.slice(i, i + k2.length + 40).indexOf('"seo_title"') >= 0) { at = i; break; } i = low.indexOf(k2, i + 1); }
    if (at < 0) at = first;
    if (at < 0) return { none: 'Pinterest shows no account "' + h + '"' };
    const img = unesc(near(body, at, /"image_xlarge_url":"([^"]+)"/, 3000) || near(body, at, /"image_large_url":"([^"]+)"/, 3000)
      || near(body, at, /"image_medium_url":"([^"]+)"/, 3000).replace('/75x75_RS/', '/280x280_RS/'));
    if (!img) return { none: 'Pinterest shows "' + h + '" with no picture' };
    if (/default_/i.test(img) || near(body, at, /"is_default_image":(true|false)/, 3000) === 'true') return { none: 'the Pinterest account "' + h + '" has no picture of its own' };
    return { img, name: unesc(near(body, at, /"full_name":"([^"]*)"/, 3000)),
      verified: near(body, at, /"is_verified_merchant":(true|false)/, 3000) === 'true' || near(body, at, /"domain_verified":(true|false)/, 3000) === 'true' };
  }
  return { none: 'unknown network' };
}

// a website's own icons, best first: apple-touch-icon (180px, made for exactly this), then <link rel=icon> by
// declared size, then /favicon.ico. SVG is refused everywhere in the FCC's image lanes, so it is skipped here.
export function siteIcons(html, pageUrl) {
  const out = [], seen = {};
  const add = (href, score) => {
    if (!href || /^data:/i.test(href)) return;
    let u; try { u = new URL(href.replace(/&amp;/g, '&'), pageUrl).toString(); } catch (e) { return; }
    if (/\.svg(\?|$)/i.test(u) || seen[u]) return;
    seen[u] = 1; out.push({ u, score });
  };
  const re = /<link\b[^>]*>/gi; let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[0], rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '', href = (/\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag) || [])[1] || '';
    if (/svg/i.test((/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(tag) || [])[1] || '')) continue;
    const sz = +(((/\bsizes\s*=\s*["']?(\d+)x\d+/i.exec(tag) || [])[1]) || 0);
    if (/apple-touch-icon/i.test(rel)) add(href, 1000 + (sz || 180));
    else if (/(^|\s)icon(\s|$)/i.test(rel) || /shortcut/i.test(rel)) add(href, 100 + sz);
  }
  try { add(new URL('/favicon.ico', pageUrl).toString(), 1); } catch (e) {}
  return out.sort((a, b) => b.score - a.score).map((x) => x.u).slice(0, 4);
}
