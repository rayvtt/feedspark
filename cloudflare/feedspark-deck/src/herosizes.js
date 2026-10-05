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
 *                             d:<Brand>          the brand's own document AS WRITTEN — category × gender rows
 *                                                {name, mk (the markets its sizes are written for), rows:[{c, g, s, n}]}
 *                           deletions only through `_deleted` (explicit tombstones): a partial view never deletes
 *
 * NO CLIENT FIGURES IN GIT — the census lives in KV only. The one thing written here is a brand's hero-size TABLE as
 * Ray sent it (DOC_SEEDS — sizes and category words, not a figure), put into the store ONCE (applySeeds) so it lands
 * in KV like any import: from then on the team edits, replaces or deletes it on /stock and it never comes back.
 */

// the census SHAPE — docs/herosize_engine.js CENSUS_V holds the same number (tools/test_herosize.mjs pins both)
//   4: no product placed by a merchandising bucket ("outlet/mens/view all") or onto another sizing scale (skis in cm beside
//      S–XXL), the master's word refining a place only where its reading's sent products agree, a tie between two readings
//      to the surer, a "155" read as a collar 15½ only beside whole collar sizes (Superdry's skis are 155 cm) — Ray, 5 Oct
//      2026: "double check [Sizes made in] are actually presentation of Superdry catalogue"
//   3: types placed on the Google Shopping feed's own product_type tree and kept at their finest level (every tier is a
//      roll-up of them on the page) — Ray, 30 Sep 2026: "can you allow tier 2, tier 3 of PT to be chosen too"
//   2: departments in every roster market's language
export const CENSUS_V = 4;
// a census of an unchanged import is still read again after this long: its types ride the Google feed's product_type tree
export const CENSUS_FRESH_MS = 20 * 3600 * 1000;
export const HERO_KEY = 'heroguide';
const CAP = { types: 600, sz: 30, pat: 400, rows: 200, sizes: 40 };
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
    const o = { k, t: Math.max(1, int(t.t, 12)), d: DEPTS.indexOf(t.d) >= 0 ? t.d : '', n: int(t.n), in: int(t.in), out: int(t.out), one: int(t.one), nos: int(t.nos),
      st: int(t.st), sz, more: int(t.more, 1e5), pat, patx: int(t.patx) };
    if (t.fw) o.fw = 1;
    if (t.m) o.m = 1;
    if (o.in + o.out > o.n) return null;
    types.push(o);
  }
  const cols = {};
  ['pt', 'size', 'gender', 'age', 'grp', 'av', 'qty'].forEach((k) => { cols[k] = str(c.cols && c.cols[k], 60); });
  // where the types came from: the feed's tree (and how each master row found its place on it), or the master's own words
  const tr = c.tree && typeof c.tree === 'object' ? c.tree : null;
  const tree = tr ? { feed: int(tr.feed), typed: int(tr.typed), fold: int(tr.fold), id: int(tr.id), grp: int(tr.grp), learn: int(tr.learn), word: int(tr.word), own: int(tr.own),
    join: str(tr.join, 60), on: tr.on === 'g:id' ? 'g:id' : tr.on === 'fs_data_original_id' ? 'fs_data_original_id' : '' } : null;
  return { v: CENSUS_V, rows: int(c.rows), sized: int(c.sized), one: int(c.one), nos: int(c.nos), groups: int(c.groups), capped: !!c.capped,
    cols, src: c.src === 'feed' && tree ? 'feed' : 'master', tree, types, tx: { n: int(c.tx && c.tx.n), k: int(c.tx && c.tx.k, 1e5) } };
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
//   ctx: { brands: roster brand names, inScope(brand), canEx: may this signin save an example, marketsOf(brand), by, now }
export function sanitizeHeroKey(key, val, ctx) {
  const k = String(key || '');
  let m;
  if ((m = /^d:(.{1,80})$/.exec(k))) {
    const brand = m[1];
    if (ctx.brands.indexOf(brand) < 0) return { error: 'not a roster brand: ' + brand };
    if (!ctx.inScope(brand)) return { error: 'out of scope: ' + brand };
    if (val == null) return { value: null };
    if (typeof val !== 'object' || !Array.isArray(val.rows)) return { error: 'bad document' };
    // the markets the document's sizes are written for — the brand's own roster markets, nothing else
    const all = (ctx.marketsOf && ctx.marketsOf(brand)) || [], mk = [];
    for (const x of (Array.isArray(val.mk) ? val.mk : []).slice(0, 40)) {
      const v = str(x, 12).toUpperCase();
      if (all.indexOf(v) < 0) return { error: 'not a ' + brand + ' market: ' + v };
      if (mk.indexOf(v) < 0) mk.push(v);
    }
    const rows = [];
    for (const r of val.rows.slice(0, CAP.rows)) {
      if (!r || typeof r !== 'object') return { error: 'bad document row' };
      const c = str(r.c, 120); if (!c) return { error: 'a document row names its category' };
      const sz = sizes(Array.isArray(r.s) ? r.s : []); if (!sz) return { error: 'bad sizes for ' + c };
      rows.push({ c, g: str(r.g, 30), s: sz, n: str(r.n, 300) });
    }
    if (!rows.length) return { error: 'a document has rows' };
    return { value: { name: str(val.name, 120) || brand + ' hero sizes', mk, rows, by: ctx.by, at: ctx.now } };
  }
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
    const m = /^(g|m|d):([^|]{1,80})(?:\||$)/.exec(k);
    if (k.indexOf('x:') === 0 || (m && inScope(m[2]))) out[k] = store[k];
  });
  return out;
}
// per brand: has a guide (and of which kind) and how many product types carry their own hero list — the
// all-brands view reads this without a census
export function guideBrands(store, brands) {
  return brands.map((b) => {
    const g = store['g:' + b] || null, d = store['d:' + b] || null;
    let own = 0, doc = 0;
    Object.keys(store || {}).forEach((k) => { if (k.indexOf('m:' + b + '|') === 0 && store[k]) { own++; if (store[k].src === 'doc') doc++; } });
    return { client: b, doc: !!((g && g.doc) || (d && d.rows)), ex: (g && g.ex) || '', from: (g && g.from) || '', own, fromDoc: doc,
      rows: d && Array.isArray(d.rows) ? d.rows.length : 0, mk: d && Array.isArray(d.mk) ? d.mk.slice() : [] };
  });
}

// ---- seeded documents ------------------------------------------------------------------------------------------------
// SUPERDRY (Ray, 5 Oct 2026, sending the table: "can you follow this to implement hero sizes mapping in FCC for Superdry ?")
// — every row exactly as the table writes it (the category with its | alternatives, the gender, the sizes, FeedSpark's note
// to the client). Its sizes are UK sizes: GB and IE carry them (their masters sell women's 6–20 the UK way); US sells US
// 2–16 (US 8 = UK 12) and the EU markets 34–48, so the document is written for GB and IE only — a person adds a market on
// /stock when its sizes read the same.
export const DOC_SEEDS = {
  Superdry: { name: 'Superdry hero sizes', mk: ['GB', 'IE'], from: 'Ray’s table, 5 Oct 2026', rows: [
    { c: 'Jeans|Trousers', g: 'Male', s: ['M', 'L', '30', '32'], n: '' },
    { c: 'Jeans|Trousers', g: 'Female', s: ['8', '10', '12', '14', '26', '28', '30', '32'], n: '' },
    { c: 'Joggers', g: 'Male', s: ['M', 'L'], n: '' },
    { c: 'Joggers', g: 'Female', s: ['8', '10', '12', '14'], n: '' },
    { c: 'Shorts', g: 'Male', s: ['M', 'L', '32', '34'], n: '' },
    { c: 'Shorts', g: 'Female', s: ['8', '10', '12', '14', '26', '28', '30', '32'], n: '' },
    { c: 'Skirts', g: 'Female', s: ['8', '10', '12', '14'], n: '' },
    { c: 'Underwear', g: 'Male', s: ['M', 'L'], n: '' },
    { c: 'Underwear', g: 'Female', s: ['M', 'L'], n: '' },
    { c: 'Swimwear', g: 'Male', s: ['M', 'L'], n: '' },
    { c: 'Swimwear', g: 'Female', s: ['S', 'M', 'L'], n: '' },
    { c: 'trainers', g: 'Male', s: ['8', '9', '10'], n: '' },
    { c: 'trainers', g: 'Female', s: ['4', '5', '6', '7'], n: '' },
    { c: 'Sport bras', g: 'Female', s: ['S', 'M', 'L'], n: '' },
    { c: 'Jackets|coats', g: 'Male', s: ['M', 'L'], n: "Men's Jacket - also comes in numeric size, do you have heros ?" },
    { c: 'Jackets|coats', g: 'Female', s: ['8', '10', '12', '14'], n: '' },
    { c: 'Dresses', g: 'Female', s: ['8', '10', '12', '14'], n: '' },
    { c: 'Tshirts|Shirts|Sweatshirts|hoodies', g: 'Male', s: ['M', 'L'], n: '' },
    { c: 'Tshirts|Shirts|Sweatshirts|hoodies', g: 'Female', s: ['S', 'M', 'L'], n: '' }
  ] }
};
// write each seed into the store ONCE — on the read after a deploy — unless its key has ever existed: a document the team
// edited, replaced or deleted (a tombstone is still a record that it existed) is theirs and is never put back.
// envx = the kvmerge envelope ({data, meta}); returns how many it wrote (0 = nothing to save).
export function applySeeds(envx, now) {
  let n = 0;
  Object.keys(DOC_SEEDS).forEach((b) => {
    const k = 'd:' + b, sd = DOC_SEEDS[b];
    if (!envx || !envx.meta || !envx.data || envx.meta[k]) return;
    envx.data[k] = { name: sd.name, mk: sd.mk.slice(), rows: sd.rows.map((r) => ({ c: r.c, g: r.g, s: r.s.slice(), n: r.n })), by: 'FeedSpark · from ' + sd.from, at: now, seed: 1 };
    envx.meta[k] = { t: now };
    n++;
  });
  return n;
}
