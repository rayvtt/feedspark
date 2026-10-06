/*
 * STOCK LEVERS — the worker's half (Ray, 5 Oct 2026: "summarise a stock management dashboard for Superdry (specifically)
 * … stock levers : 1 . Range Completion (20-40%, currently at 35%) - 2. Stock unit exclusion for Everest (previously >5
 * units per size, now N/A) - 3. Hero Sizes (current activated, follow the mapping above) - build an facilitor interface
 * to action BAU vs. SALE perido").
 *
 * The reading is docs/stocklevers_engine.js (served to /stock at /stock/levers.js). This module is what the worker trusts
 * instead of the page: the shape a lever plan, a market's own values and a sale period may take, and the edits a signin
 * may make.
 *
 *   KV stocklevers   ONE shared map in the kvmerge envelope, a key per decision (deletions only through `_deleted`):
 *                      p:<Brand>          the brand's plan {levers:[{k, bau, sale, lo, hi, scope, was, note}], note}
 *                      m:<Brand>|<MKT>    a market's own values {lv:{<k>:{bau, sale}}}
 *                      e:<Brand>|<id>     a sale period {name, from, to, mk:[markets], sale:{st}, bau:{st}}
 *                      r:<Brand>|<id>     a record kept by hand {d, mk:[markets], k, mode, v, was, note, src} — what was
 *                                         set in FeedHero, the day, where (Ray, 6 Oct 2026: "maybe there should be a
 *                                         manual table as well to keep record of it")
 *                    by / at stamped here, never trusted from the page — and a record keeps the person who FIRST wrote
 *                    it down through every edit (the editor is stamped as ed), so an edit can never rewrite who said so
 *
 * NO CLIENT FIGURES IN GIT. The one thing written here is a brand's lever settings as Ray stated them (LEVER_SEEDS —
 * Superdry's, 5 Oct 2026: a range-completion band and line, a units rule and its scope, hero sizes on), put into the
 * store ONCE (applyLeverSeeds) and the team's to edit from then on.
 */
export const LEVERS_KEY = 'stocklevers';
const KINDS = { rc: 'pct', units: 'units', hero: 'onoff' };
const STEPS = ['planned', 'briefed', 'done'];
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// one value as a lever of this kind may hold it: a number in range, 'on' / 'off', or null (not set) — else undefined
function val(kind, v) {
  if (v === null || v === undefined || v === '') return null;
  if (v === 'off') return 'off';
  if (kind === 'onoff') return v === 'on' ? 'on' : undefined;
  const n = typeof v === 'number' ? v : NaN;
  if (!isFinite(n)) return undefined;
  if (kind === 'pct') return n >= 0 && n <= 100 ? Math.round(n * 10) / 10 : undefined;
  if (kind === 'units') return n >= 0 && n <= 100000 ? Math.round(n) : undefined;
  return undefined;
}
// a period's step (switch to SALE / back to BAU): who moved it, and when, is the server's word — a step the save did not
// move keeps the stamp it already had (the page sends a period whole), a step it moved is stamped now
function step(s, was, ctx) {
  const st = s && STEPS.indexOf(s.st) >= 0 ? s.st : 'planned';
  if (st === 'planned') return { st };
  if (was && was.st === st && was.by) return { st, by: was.by, at: was.at || ctx.now };
  return { st, by: ctx.by, at: ctx.now };
}
// one incoming key -> the value to store, or {error}
//   ctx: { brands, inScope(brand), marketsOf(brand), prev(key) → the stored value, by, now }
export function sanitizeLeverKey(key, v, ctx) {
  const k = String(key || '');
  let m;
  if ((m = /^p:(.{1,80})$/.exec(k))) {
    const brand = m[1];
    if (ctx.brands.indexOf(brand) < 0) return { error: 'not a roster brand: ' + brand };
    if (!ctx.inScope(brand)) return { error: 'out of scope: ' + brand };
    if (v == null) return { value: null };
    if (typeof v !== 'object' || !Array.isArray(v.levers)) return { error: 'bad plan' };
    const levers = [], seen = {};
    for (const l of v.levers.slice(0, 12)) {
      if (!l || typeof l !== 'object' || !KINDS[l.k] || seen[l.k]) return { error: 'bad lever' };
      seen[l.k] = 1;
      const kind = KINDS[l.k], bau = val(kind, l.bau), sale = val(kind, l.sale);
      if (bau === undefined || sale === undefined) return { error: 'bad value for ' + l.k };
      const o = { k: l.k, bau, sale };
      if (kind === 'pct') {
        const lo = val('pct', l.lo), hi = val('pct', l.hi);
        if (lo === undefined || hi === undefined || (typeof lo === 'number' && typeof hi === 'number' && lo > hi)) return { error: 'bad band for ' + l.k };
        if (typeof lo === 'number') o.lo = lo;
        if (typeof hi === 'number') o.hi = hi;
      }
      if (l.scope) o.scope = str(l.scope, 40);
      if (l.was) o.was = str(l.was, 80);
      if (l.note) o.note = str(l.note, 200);
      levers.push(o);
    }
    return { value: { levers, note: str(v.note, 300), by: ctx.by, at: ctx.now } };
  }
  if ((m = /^m:(.{1,80})\|([A-Z-]{2,8})$/.exec(k))) {
    const brand = m[1], mk = m[2];
    if (ctx.brands.indexOf(brand) < 0) return { error: 'not a roster brand: ' + brand };
    if (!ctx.inScope(brand)) return { error: 'out of scope: ' + brand };
    if (ctx.marketsOf(brand).indexOf(mk) < 0) return { error: 'not a ' + brand + ' market: ' + mk };
    if (v == null) return { value: null };
    if (typeof v !== 'object' || !v.lv || typeof v.lv !== 'object') return { error: 'bad market values' };
    const lv = {};
    for (const lk of Object.keys(v.lv).slice(0, 12)) {
      if (!KINDS[lk]) return { error: 'bad lever ' + lk };
      const o = v.lv[lk] || {}, bau = val(KINDS[lk], o.bau), sale = val(KINDS[lk], o.sale);
      if (bau === undefined || sale === undefined) return { error: 'bad value for ' + lk };
      if (bau !== null || sale !== null) lv[lk] = { bau, sale };
    }
    return { value: { lv, by: ctx.by, at: ctx.now } };
  }
  if ((m = /^e:(.{1,80})\|([a-z0-9-]{3,40})$/.exec(k))) {
    const brand = m[1];
    if (ctx.brands.indexOf(brand) < 0) return { error: 'not a roster brand: ' + brand };
    if (!ctx.inScope(brand)) return { error: 'out of scope: ' + brand };
    if (v == null) return { value: null };
    if (typeof v !== 'object') return { error: 'bad period' };
    const name = str(v.name, 80); if (!name) return { error: 'a sale period has a name' };
    if (!DAY.test(String(v.from || '')) || !DAY.test(String(v.to || '')) || v.from > v.to) return { error: 'a sale period runs from one day to a later one' };
    const all = ctx.marketsOf(brand), mk = [];
    for (const x of (Array.isArray(v.mk) ? v.mk : []).slice(0, 40)) { const c = str(x, 8).toUpperCase(); if (all.indexOf(c) < 0) return { error: 'not a ' + brand + ' market: ' + c }; if (mk.indexOf(c) < 0) mk.push(c); }
    if (!mk.length) return { error: 'a sale period covers at least one market' };
    const was = (ctx.prev && ctx.prev(k)) || {};
    return { value: { name, from: v.from, to: v.to, mk, sale: step(v.sale, was.sale, ctx), bau: step(v.bau, was.bau, ctx), note: str(v.note, 300), by: ctx.by, at: ctx.now } };
  }
  if ((m = /^r:(.{1,80})\|([a-z0-9-]{3,40})$/.exec(k))) {
    const brand = m[1];
    if (ctx.brands.indexOf(brand) < 0) return { error: 'not a roster brand: ' + brand };
    if (!ctx.inScope(brand)) return { error: 'out of scope: ' + brand };
    if (v == null) return { value: null };
    if (typeof v !== 'object') return { error: 'bad record' };
    if (!DAY.test(String(v.d || ''))) return { error: 'a record has a day' };
    if (!KINDS[v.k]) return { error: 'bad lever ' + str(v.k, 20) };
    const kind = KINDS[v.k], to = val(kind, v.v), from = val(kind, v.was);
    if (to === undefined || to === null) return { error: 'a record says what was set' };
    if (from === undefined) return { error: 'bad value for what it was' };
    const all = ctx.marketsOf(brand), mk = [];
    for (const x of (Array.isArray(v.mk) ? v.mk : []).slice(0, 40)) { const c = str(x, 8).toUpperCase(); if (all.indexOf(c) < 0) return { error: 'not a ' + brand + ' market: ' + c }; if (mk.indexOf(c) < 0) mk.push(c); }
    if (!mk.length) return { error: 'a record names at least one market' };
    const prev = (ctx.prev && ctx.prev(k)) || null;
    const o = { d: v.d, mk, k: v.k, mode: v.mode === 'sale' || v.mode === 'bau' ? v.mode : '', v: to, note: str(v.note, 300) };
    if (from !== null) o.was = from;
    const src = str(v.src, 60); if (src) o.src = src;
    if (prev && prev.by) { o.by = prev.by; o.at = prev.at || ctx.now; o.ed = { by: ctx.by, at: ctx.now }; } else { o.by = ctx.by; o.at = ctx.now; }
    return { value: o };
  }
  return { error: 'unknown key' };
}
// a whole PUT body -> {data, deleted, errors}; nothing is written unless every key is acceptable
export function sanitizeLeverPut(body, ctx) {
  const data = {}, deleted = [], errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { data, deleted, errors: ['bad body'] };
  const keys = Object.keys(body).filter((k) => k !== '_deleted');
  if (keys.length > 120) return { data, deleted, errors: ['too many keys in one save'] };
  for (const k of keys) {
    const r = sanitizeLeverKey(k, body[k], ctx);
    if (r.error) errors.push(r.error); else if (r.value === null) deleted.push(k); else data[k] = r.value;
  }
  for (const k of (Array.isArray(body._deleted) ? body._deleted : []).slice(0, 120)) {
    const r = sanitizeLeverKey(k, null, ctx);
    if (r.error) errors.push(r.error); else if (deleted.indexOf(k) < 0) deleted.push(k);
  }
  return { data, deleted, errors };
}
// what one signin may READ: the keys of the brands in its scope
export function leverView(store, inScope) {
  const out = {};
  Object.keys(store || {}).forEach((k) => {
    if (k === '_deleted') return;
    const m = /^[pmer]:([^|]{1,80})(?:\||$)/.exec(k);
    if (m && inScope(m[1])) out[k] = store[k];
  });
  return out;
}
// the brands in scope with a plan, and how many sale periods each holds — the page's brand row on "All brands"
export function leverBrands(store, mine) {
  return (mine || []).map((b) => {
    const p = store && store['p:' + b];
    if (!p || !Array.isArray(p.levers)) return null;
    const periods = Object.keys(store).filter((k) => k.indexOf('e:' + b + '|') === 0).length;
    return { client: b, levers: p.levers.length, periods };
  }).filter(Boolean);
}

// ---- seeded plans ----------------------------------------------------------------------------------------------------
// SUPERDRY (Ray, 5 Oct 2026) — the three levers as Ray stated them, nothing he did not:
//   range completion: the band 20–40%, BAU at 35% ("currently at 35%"); the SALE line is the team's to set
//   stock unit exclusion for Everest: N/A now in BAU ("previously >5 units per size, now N/A"); SALE not set
//   hero sizes: on in BAU ("current activated, follow the mapping above"); SALE not set
export const LEVER_SEEDS = {
  Superdry: { from: 'Ray’s brief, 5 Oct 2026', levers: [
    { k: 'rc', lo: 20, hi: 40, bau: 35, sale: null, note: '20–40%, currently at 35%' },
    { k: 'units', scope: 'Everest', bau: 'off', sale: null, was: '> 5 units per size', note: 'previously > 5 units per size, now N/A' },
    { k: 'hero', bau: 'on', sale: null, note: 'activated — follows the hero-size mapping' }
  ] }
};
// written into the store ONCE (on the first read after it ships) unless its key has ever existed — a plan the team
// edited or deleted is theirs; returns how many it wrote
export function applyLeverSeeds(envx, now) {
  let n = 0;
  Object.keys(LEVER_SEEDS).forEach((b) => {
    const k = 'p:' + b, sd = LEVER_SEEDS[b];
    if (!envx || !envx.meta || !envx.data || envx.meta[k]) return;
    envx.data[k] = { levers: sd.levers.map((l) => Object.assign({}, l)), note: '', by: 'FeedSpark · from ' + sd.from, at: now, seed: 1 };
    envx.meta[k] = { t: now };
    n++;
  });
  return n;
}
