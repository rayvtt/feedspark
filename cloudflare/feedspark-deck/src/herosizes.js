/*
 * HERO SIZES — the worker's half (Ray, 30 Sep 2026: "bring in hero size mapping per brand as well and later
 * allow cross industry "guildlines" - (this is a document per brand or they can follow examples) - sit within
 * stock management - breakdown by their product type").
 *
 * The reading is docs/herosize_engine.js (the agent builds the SIZE CENSUS with it; the /stock page maps and
 * measures with it). The engine is served as text, so the worker cannot import it: this module is what the
 * worker trusts instead — the census SHAPE a push may store, and the guide edits a signin may make.
 *
 *   KV mastersize:<cmpid>   one market's census (per product type: its size run, rows + in stock per size, style
 *                           patterns) — written by tools/master_stock.mjs through the key-gated push lane
 *   KV heroguide            ONE shared map in the kvmerge envelope, a key per decision so two people editing
 *                           different types never collide:
 *                             g:<Brand>          the brand's guide {doc:{name,url}, ex, from, note}
 *                             m:<Brand>|<type>   one product type's hero sizes {k, s:[…], src, fw}
 *                             x:<id>             an example a person saved from a brand's guide {name, ind, note, rows}
 *                           deletions only through `_deleted` (explicit tombstones): a partial view never deletes
 *
 * NOTHING HERE IS CLIENT DATA IN GIT — the census and the guides live in KV only.
 */

// the census SHAPE — docs/herosize_engine.js CENSUS_V holds the same number (tools/test_herosize.mjs pins both)
export const CENSUS_V = 2;   // 2: departments in every roster market's language
export const HERO_KEY = 'heroguide';
const CAP = { types: 80, sz: 30, pat: 400, rows: 200, sizes: 40 };
const DEPTS = ['', 'kids', 'women', 'men', 'unisex'];
const SRCS = ['set', 'doc', 'core', 'ex'];
const SEED_EX = /^fs-/;   // the engine's own examples — never overwritten from the page

const int = (v, max) => { const n = Math.floor(+v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max == null ? 1e8 : max) : 0; };
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const sizeOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= 24 && /^[\w .\/½+&'#-]+$/u.test(s);

// one market's census, as pushed — anything off-shape is refused rather than stored half-read
export function sanitizeCensus(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.types) || c.v !== CENSUS_V) return null;
  const types = [];
  for (const t of c.types.slice(0, CAP.types)) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.sz)) return null;
    const k = str(t.k, 160); if (!k) return null;
    const sz = [];
    for (const z of t.sz.slice(0, CAP.sz)) {
      if (!Array.isArray(z) || !sizeOk(z[0])) return null;
      const n = int(z[1]), inn = int(z[2]), out = int(z[3]);
      if (inn + out > n) return null;
      sz.push([z[0], n, inn, out]);
    }
    const pat = [];
    for (const p of (Array.isArray(t.pat) ? t.pat : []).slice(0, CAP.pat)) {
      if (!Array.isArray(p) || typeof p[0] !== 'string' || p[0].length !== sz.length || !/^[0-3]*$/.test(p[0])) return null;
      const c2 = int(p[1]); if (!c2) return null;
      pat.push([p[0], c2]);
    }
    const o = { k, d: DEPTS.indexOf(t.d) >= 0 ? t.d : '', n: int(t.n), in: int(t.in), out: int(t.out), one: int(t.one), nos: int(t.nos),
      st: int(t.st), sz, more: int(t.more, 1e5), pat, patx: int(t.patx) };
    if (t.fw) o.fw = 1;
    if (o.in + o.out > o.n) return null;
    types.push(o);
  }
  const cols = {};
  ['pt', 'size', 'gender', 'age', 'grp', 'av', 'qty'].forEach((k) => { cols[k] = str(c.cols && c.cols[k], 60); });
  return { v: CENSUS_V, rows: int(c.rows), sized: int(c.sized), one: int(c.one), nos: int(c.nos), groups: int(c.groups), capped: !!c.capped,
    cols, types, tx: { n: int(c.tx && c.tx.n), k: int(c.tx && c.tx.k, 1e5) } };
}
// the one-line summary /api/rules/stock carries for every market (no second read of the census)
export function censusSummary(c, t) {
  if (!c) return null;
  return { t: t || null, types: c.types.length, sized: c.sized, rows: c.rows, groups: c.groups, v: c.v };
}

// ---- guide edits ----------------------------------------------------------------------------------------------------
// the page generates `w` (an example row's words) as a regex fragment; only letters, digits, spaces, ?, | and the \W+
// joiner may reach the RegExp another signin's browser will build from it
// (and at most a dozen optional marks, so no fragment can make that RegExp backtrack for long)
const wOk = (w) => w == null || w === '' || (typeof w === 'string' && w.length <= 300 && /^(?:[a-z0-9 ?|]|\\W\+)*$/.test(w) && (w.match(/\?/g) || []).length <= 12);
function sizes(list, cap) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const s of list.slice(0, cap || CAP.sizes)) { if (!sizeOk(s)) return null; if (out.indexOf(s) < 0) out.push(s); }
  return out;
}
function httpsUrl(u) {
  const s = str(u, 500);
  if (!s) return '';
  try { const x = new URL(s); return x.protocol === 'https:' ? x.toString() : null; } catch (e) { return null; }
}
// one incoming key -> the value to store, or {error}
//   ctx: { brands: roster brand names, inScope(brand), canEx: may this signin save an example, by, now }
export function sanitizeHeroKey(key, val, ctx) {
  const k = String(key || '');
  let m;
  if ((m = /^g:(.{1,80})$/.exec(k))) {
    const brand = m[1];
    if (ctx.brands.indexOf(brand) < 0) return { error: 'not a roster brand: ' + brand };
    if (!ctx.inScope(brand)) return { error: 'out of scope: ' + brand };
    if (val == null) return { value: null };
    if (typeof val !== 'object') return { error: 'bad guide' };
    const doc = val.doc && typeof val.doc === 'object' ? { name: str(val.doc.name, 120), url: httpsUrl(val.doc.url) } : null;
    if (doc && doc.url === null) return { error: 'the document link must be https' };
    const from = str(val.from, 80);
    if (from && (from === brand || ctx.brands.indexOf(from) < 0)) return { error: 'a brand follows another roster brand' };
    return { value: { doc: doc && (doc.name || doc.url) ? doc : null, ex: str(val.ex, 60).replace(/[^a-z0-9-]/g, ''), from, note: str(val.note, 300), by: ctx.by, at: ctx.now } };
  }
  if ((m = /^m:(.{1,80})\|(.{1,160})$/.exec(k))) {
    const brand = m[1];
    if (ctx.brands.indexOf(brand) < 0) return { error: 'not a roster brand: ' + brand };
    if (!ctx.inScope(brand)) return { error: 'out of scope: ' + brand };
    if (m[2] !== m[2].toLowerCase()) return { error: 'a type key is lower case' };
    if (val == null) return { value: null };
    if (typeof val !== 'object') return { error: 'bad entry' };
    const s = sizes(val.s);
    if (!s) return { error: 'bad sizes for ' + m[2] };
    return { value: { k: str(val.k, 160) || m[2], s, src: SRCS.indexOf(val.src) >= 0 ? val.src : 'set', fw: val.fw ? 1 : 0, by: ctx.by, at: ctx.now } };
  }
  if ((m = /^x:([a-z0-9-]{3,40})$/.exec(k))) {
    if (SEED_EX.test(m[1])) return { error: 'a FeedSpark example is read-only' };
    if (!ctx.canEx) return { error: 'saving an example needs the stock module' };
    if (val == null) return { value: null };
    if (typeof val !== 'object' || !Array.isArray(val.rows)) return { error: 'bad example' };
    const rows = [];
    for (const r of val.rows.slice(0, CAP.rows)) {
      if (!r || typeof r !== 'object') return { error: 'bad example row' };
      const d = r.d === '*' ? '*' : DEPTS.indexOf(r.d) > 0 ? r.d : '*';
      if (!wOk(r.w)) return { error: 'bad example words' };
      const s = sizes(r.s); if (!s || !s.length) return { error: 'an example row names its sizes' };
      rows.push({ d, fw: r.fw ? 1 : 0, w: r.w || null, s });
    }
    const name = str(val.name, 80); if (!name) return { error: 'an example has a name' };
    return { value: { name, ind: str(val.ind, 40) || 'Brand guide', note: str(val.note, 300), rows, by: ctx.by, at: ctx.now } };
  }
  return { error: 'unknown key' };
}
// a whole PUT body -> {data, deleted, errors}; nothing is written unless every key is acceptable
export function sanitizeHeroPut(body, ctx) {
  const data = {}, deleted = [], errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { data, deleted, errors: ['bad body'] };
  const keys = Object.keys(body).filter((k) => k !== '_deleted');
  if (keys.length > 400) return { data, deleted, errors: ['too many keys in one save'] };
  for (const k of keys) {
    const r = sanitizeHeroKey(k, body[k], ctx);
    if (r.error) errors.push(r.error);
    else if (r.value === null) deleted.push(k);
    else data[k] = r.value;
  }
  for (const k of (Array.isArray(body._deleted) ? body._deleted : []).slice(0, 400)) {
    const r = sanitizeHeroKey(k, null, ctx);
    if (r.error) errors.push(r.error); else if (deleted.indexOf(k) < 0) deleted.push(k);
  }
  return { data, deleted, errors };
}
// what one signin may READ of the store: every example, and the guides of the brands in its scope
export function heroView(store, inScope) {
  const out = {};
  Object.keys(store || {}).forEach((k) => {
    if (k === '_deleted') return;
    const m = /^(g|m):([^|]{1,80})(?:\||$)/.exec(k);
    if (k.indexOf('x:') === 0 || (m && inScope(m[2]))) out[k] = store[k];
  });
  return out;
}
// per brand: has a guide (and of which kind) and how many product types carry their own hero list — the
// all-brands view reads this without a census
export function guideBrands(store, brands) {
  return brands.map((b) => {
    const g = store['g:' + b] || null;
    let own = 0, doc = 0;
    Object.keys(store || {}).forEach((k) => { if (k.indexOf('m:' + b + '|') === 0 && store[k]) { own++; if (store[k].src === 'doc') doc++; } });
    return { client: b, doc: !!(g && g.doc), ex: (g && g.ex) || '', from: (g && g.from) || '', own, fromDoc: doc };
  });
}
