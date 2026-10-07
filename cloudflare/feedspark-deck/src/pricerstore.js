/*
 * SERVICES & PRICER — the shared stores behind /pricer (7 Oct 2026). Pure: key grammar, field
 * allow-lists and sanitizers only; the worker's pricerRoute does the KV reads, the gate and the
 * kvmerge pass. Six stores, each its own kvmerge envelope:
 *
 *   pricerops    the rate card's OPERATIONS half — hours, lead days, ASPL attended minutes,
 *                tokens per product, QC share. Any Pricer signin writes it (ASPL and the London
 *                AMs each own their own columns of the same rows).
 *   pricerprice  the SELL half — unit £ per row, the block, the volume ladder, bundle / re-use /
 *                floor. Every Pricer signin READS it; only the owner or a `pricer-cost` grant
 *                writes it (the worker refuses before KV).
 *   pricercost   what it COSTS us — labour rates, £ per million tokens, overhead, target margin.
 *                Read AND written only by the owner or `pricer-cost`; the worker refuses with a
 *                403 before the key is ever read, so a cost figure never leaves the worker for an
 *                AM signin.
 *   pricerprop   saved proposal OPTIONS (one record per option, `prop.id` groups a proposal) —
 *                client-scoped by the record's own `client` ('field').
 *   svcroll      the services rollout per client — debriefed, next step, always-on, live —
 *                client-scoped by the KEY ('self').
 *   svcmap       the delivery roadmap per package line × industry — house-wide.
 *
 * Rate-card values (ops / price / cost) are stored as {v, by, at}, one key per row × FIELD
 * (`<id>|<field>`), so ASPL entering minutes and a London AM entering QC on the same row at the
 * same moment never clobber each other. `by`/`at` are the SERVER's word, stamped only on a key
 * whose `v` actually moved — re-saving the map you read changes nothing and re-stamps nothing.
 *
 * A key the sanitizer refuses KEEPS ITS STORED VALUE (it is put back into the incoming map, so a
 * whole-map save under X-Sync-Base can never delete a row by sending it malformed) and is listed
 * in `rejected` with the reason, which the route returns as `_rejected` beside the merged map.
 * Deletion is by absence under X-Sync-Base, exactly like /api/briefs; a cell sent as null or ''
 * is a clear (the key is left out, so the read stamp decides).
 *
 * ONE KV TRAP: kvmerge treats every key that STARTS WITH '_' as reserved and never writes it, and
 * the house-wide rows here are `_g|…` / `_c|…`. toStore/fromStore swap that leading '_' for '~'
 * at the KV boundary, so the API grammar stays what the engine reads and the merge still writes.
 *
 * The Pricer catalogue ids are DUPLICATED here, not imported: docs/pricer_engine.js is bundled as
 * TEXT (wrangler's **\/*_engine.js rule), so the worker cannot run it as code. tools/
 * test_pricerstore.mjs requires the engine in node and fails the moment the two lists differ.
 */

// PricerEngine.CATALOG ids (in order) ∪ PricerEngine.PKG_ROWS ids — held equal by the harness
export const PRICER_IDS = ['title_gen', 'title_short', 'title_intent', 'desc_gen', 'desc_pro', 'highlights',
  'details', 'keywords', 'visual_attr', 'gpc', 'pt_class', 'attr_pop'];
// PricerEngine.PKG_LINES keys — the package lines a roadmap status can be set for, plus the
// always-on routing itself
export const PKG_LINE_KEYS = ['title', 'keywords', 'ptype', 'gpc', 'attr_ai', 'attr_rule', 'client',
  'highlights', 'details', 'desc', 'conv'];
export const ROADMAP_KEYS = PKG_LINE_KEYS.concat(['alwayson']);
export const ROADMAP_STATUS = ['live', 'pilot', 'building', 'planned'];
export const PROPOSAL_OPTIONS = ['go', 'go+ar', 'ar'];

// the six stores: KV key, who reads / writes, how entries map onto a client (sharedstate rules),
// and the most keys one PUT may carry
export const PRICER_STORES = {
  ops:       { kv: 'pricerops',   kind: 'cell', scope: null,    mgmtRead: false, mgmtWrite: false, maxKeys: 2000 },
  price:     { kv: 'pricerprice', kind: 'cell', scope: null,    mgmtRead: false, mgmtWrite: true,  maxKeys: 2000 },
  cost:      { kv: 'pricercost',  kind: 'cell', scope: null,    mgmtRead: true,  mgmtWrite: true,  maxKeys: 200 },
  proposals: { kv: 'pricerprop',  kind: 'prop', scope: 'field', mgmtRead: false, mgmtWrite: false, maxKeys: 1500 },
  rollout:   { kv: 'svcroll',     kind: 'roll', scope: 'self',  mgmtRead: false, mgmtWrite: false, maxKeys: 600 },
  roadmap:   { kv: 'svcmap',      kind: 'map',  scope: null,    mgmtRead: false, mgmtWrite: false, maxKeys: 600 },
};

export const PROPOSAL_MAX_BYTES = 60 * 1024;

/* ---------------------------------- field allow-lists ---------------------------------- */
const num = (min, max, dp) => ({ t: 'num', min, max, dp });
const str = (max) => ({ t: 'str', max });

// pricerops: `<id>|<field>` for every catalogue / package row, plus two house-wide `_g` rows
export const OPS_ROW_FIELDS = {
  aspl: num(0, 1000, 2), qc: num(0, 1000, 2), pm: num(0, 1000, 2), mon: num(0, 1000, 2), lead: num(0, 1000, 2),
  aMin: num(0, 10000, 2), tokPerP: num(0, 1e8, 2), qcPct: num(0, 100, 2), qcMin: num(0, 600, 2), note: str(200),
};
export const OPS_G_FIELDS = { ruleH: num(0, 100, 2), langSetupH: num(0, 200, 2) };
// pricerprice: `<id>|unit` per row, and the house-wide `_g` commercials
export const PRICE_ROW_FIELDS = { unit: num(0, 100, 4) };
export const PRICE_G_FIELDS = {
  blockGBP: num(1, 10000, 2), blockH: num(1, 24, 2), tiers: { t: 'tiers' },
  bundlePct: num(0, 50, 2), reusePct: num(0, 100, 2), floorMonthly: num(0, 100000, 2), pkgVersion: str(20),
};
// pricercost: `_c|<field>` only
export const COST_FIELDS = {
  rateAspl: num(0, 1000, 2), rateAm: num(0, 1000, 2), gbpPerMTok: num(0, 1000, 4), tokAsOf: { t: 'date' },
  ohPct: num(0, 300, 2), marginPct: num(0, 95, 2),
};

// the field spec a cell key names in a store, or null
export function cellSpec(store, key) {
  const k = String(key || '');
  const i = k.indexOf('|');
  if (i < 1 || k.indexOf('|', i + 1) >= 0) return null;
  const id = k.slice(0, i), field = k.slice(i + 1);
  const own = (o) => (Object.prototype.hasOwnProperty.call(o, field) ? o[field] : null);
  if (store === 'ops') return id === '_g' ? own(OPS_G_FIELDS) : (PRICER_IDS.indexOf(id) >= 0 ? own(OPS_ROW_FIELDS) : null);
  if (store === 'price') return id === '_g' ? own(PRICE_G_FIELDS) : (PRICER_IDS.indexOf(id) >= 0 ? own(PRICE_ROW_FIELDS) : null);
  if (store === 'cost') return id === '_c' ? own(COST_FIELDS) : null;
  return null;
}

/* ------------------------------------- KV boundary ------------------------------------- */
// '_g|blockGBP' <-> '~g|blockGBP' (kvmerge never writes a key that starts with '_')
export function toStoreKey(k) { return k.charAt(0) === '_' ? '~' + k.slice(1) : k; }
export function fromStoreKey(k) { return k.charAt(0) === '~' ? '_' + k.slice(1) : k; }
export function toStore(map) {
  const out = {};
  for (const k of Object.keys(map || {})) out[toStoreKey(k)] = map[k];
  return out;
}
export function fromStore(map) {
  const out = {};
  for (const k of Object.keys(map || {})) out[fromStoreKey(k)] = map[k];
  return out;
}

/* --------------------------------------- helpers --------------------------------------- */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const CTRL = /[\u0000-\u001f\u007f]/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const META_KEYS = { _deleted: 1, _rejected: 1 };

export function validDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function roundTo(n, dp) { const f = Math.pow(10, dp); return Math.round(n * f) / f; }
function byteLen(s) {
  try { return new TextEncoder().encode(s).length; } catch (e) { return String(s).length * 3; }
}
// a plain string field: trimmed, no control characters, within its length
function cleanStr(v, max, label) {
  if (typeof v !== 'string') return { ok: false, why: label + ' must be text' };
  const s = v.trim();
  if (CTRL.test(s)) return { ok: false, why: label + ' carries a control character' };
  if (s.length > max) return { ok: false, why: label + ' is longer than ' + max + ' characters' };
  return { ok: true, v: s };
}
// a market code as the feed map wires it ('gb', 'benl', 'uae'); a Meta '-fb' market never prices
function cleanMkt(m) { return typeof m === 'string' && /^[a-z]{2,8}$/.test(m) ? m : null; }
// a client name used as a key or a field: 1–60 characters, never a separator or a control char
export function cleanClient(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  if (!s || s.length > 60 || /[:|]/.test(s) || CTRL.test(s) || s.charAt(0) === '_' || s.charAt(0) === '~') return null;
  return s;
}
// a time the page stamped: kept when it is a plausible epoch ms, else now
function tOf(t, now) { return (typeof t === 'number' && isFinite(t) && t > 1.5e12 && t <= now + 86400000) ? Math.round(t) : now; }

// one {t, by, …extra} stamp (sentAt / chosen / declined / superseded / debriefAt / live / …).
// absent / null / false clears it; `true` means "now". The page's `t` is kept (countedOption
// compares chosen.t across two AMs' clicks), `by` is ALWAYS the server's word — but a stamp
// identical to the stored one is returned as stored, so re-saving a map never re-attributes it.
function cleanStamp(v, prev, ctx, extra, label) {
  if (v == null || v === false) return { ok: true, v: undefined };
  if (v === true) v = {};
  if (!isObj(v)) return { ok: false, why: label + ' must be a {t, by} stamp' };
  const out = { t: tOf(v.t, ctx.now) };
  for (const f of Object.keys(extra || {})) {
    if (v[f] == null) continue;
    const sp = extra[f];
    if (sp === 'bool') { out[f] = !!v[f]; continue; }
    if (sp === 'ref') {
      if (typeof v[f] !== 'string' || !/^SVC\d{6}(-\d+)?$/.test(v[f])) return { ok: false, why: label + '.' + f + ' is not a proposal ref' };
      out[f] = v[f]; continue;
    }
    const s = cleanStr(v[f], sp, label + '.' + f);
    if (!s.ok) return s;
    out[f] = s.v;
  }
  if (isObj(prev)) {
    const cmp = Object.assign({}, out); const was = Object.assign({}, prev);
    delete cmp.by; delete was.by;
    if (same(cmp, was)) return { ok: true, v: prev };
  }
  out.by = ctx.by;
  return { ok: true, v: out };
}

/* ------------------------------------- cell stores ------------------------------------- */
// one cell's value, coerced to its field spec: {ok, v} or {ok:false, why}
export function coerceCell(spec, raw) {
  if (spec.t === 'num') {
    const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? +raw : NaN);
    if (!isFinite(n)) return { ok: false, why: 'must be a number' };
    if (n < spec.min || n > spec.max) return { ok: false, why: 'must be between ' + spec.min + ' and ' + spec.max };
    return { ok: true, v: roundTo(n, spec.dp) };
  }
  if (spec.t === 'str') return cleanStr(raw, spec.max, 'text');
  if (spec.t === 'date') return validDay(raw) ? { ok: true, v: raw } : { ok: false, why: 'must be a real date, YYYY-MM-DD' };
  if (spec.t === 'tiers') return cleanTiers(raw);
  return { ok: false, why: 'unknown field type' };
}

// the volume ladder: 1–6 bands, upTo strictly ascending, the LAST band open-ended (upTo null = ∞,
// JSON cannot carry Infinity), every multiplier 0–1
export function cleanTiers(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 6) return { ok: false, why: 'the ladder needs 1 to 6 bands' };
  const out = [];
  let prev = 0;
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (!isObj(b)) return { ok: false, why: 'band ' + (i + 1) + ' must be {upTo, x}' };
    const x = typeof b.x === 'number' ? b.x : +b.x;
    if (!isFinite(x) || x < 0 || x > 1) return { ok: false, why: 'band ' + (i + 1) + ' multiplier must be between 0 and 1' };
    const last = i === raw.length - 1;
    if (b.upTo == null) {
      if (!last) return { ok: false, why: 'only the last band can be open-ended' };
      out.push({ upTo: null, x: roundTo(x, 4) });
      continue;
    }
    if (last) return { ok: false, why: 'the last band must be open-ended (upTo null)' };
    const u = typeof b.upTo === 'number' ? b.upTo : +b.upTo;
    if (!isFinite(u) || u <= prev || u > 1e9) return { ok: false, why: 'band upper bounds must rise (band ' + (i + 1) + ')' };
    prev = u;
    out.push({ upTo: Math.round(u), x: roundTo(x, 4) });
  }
  return { ok: true, v: out };
}

// PUT of a cell store (ops | price | cost). body/cur use the API grammar (`_g|…`).
//   -> {data, rejected}: data = the map to merge (refused keys carry their stored value)
export function sanitizeCellPut(store, body, cur, ctx) {
  const data = {}, rejected = [];
  cur = cur || {};
  for (const k of Object.keys(body || {})) {
    if (META_KEYS[k]) continue;
    const stored = cur[k];
    const refuse = (why) => { rejected.push({ k, why }); if (stored !== undefined) data[k] = stored; };
    const spec = cellSpec(store, k);
    if (!spec) { refuse('unknown key'); continue; }
    let raw = body[k];
    if (isObj(raw) && Object.prototype.hasOwnProperty.call(raw, 'v')) raw = raw.v;
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) continue;    // a clear — absence decides
    const c = coerceCell(spec, raw);
    if (!c.ok) { refuse(c.why); continue; }
    if (isObj(stored) && same(stored.v, c.v)) { data[k] = stored; continue; }     // unchanged — keep its stamp
    data[k] = { v: c.v, by: ctx.by, at: ctx.now };
  }
  return { data, rejected };
}

/* -------------------------------------- proposals -------------------------------------- */
// what a saved option may still change; everything else is the SNAPSHOT finance signs off
// against and is frozen the moment it is stored — a new version is a new option (superseded)
const PROP_MUTABLE = ['sentAt', 'chosen', 'declined', 'superseded', 'deleted', 'hist'];
const PROP_FROZEN = ['ref', 'client', 'markets', 't', 'by', 'prop', 'option', 'pkgVersion', 'audit', 'rates',
  'opts', 'aimSources', 'pq', 'clientSafe', 'blockers'];
export const OPTION_ID_RE = /^o[a-z0-9]{6,20}$/;

// the snapshot half of a NEW option
function cleanSnapshot(v, ctx) {
  if (typeof v.ref !== 'string' || !/^SVC\d{6}(-\d+)?$/.test(v.ref)) return { ok: false, why: 'ref must look like SVC123456 (or SVC123456-2)' };
  const client = cleanClient(v.client);
  if (!client) return { ok: false, why: 'client is missing or not a client name' };
  if (!Array.isArray(v.markets) || !v.markets.length || v.markets.length > 40) return { ok: false, why: 'markets must list 1 to 40 market codes' };
  const markets = v.markets.map(cleanMkt);
  if (markets.some((m) => !m)) return { ok: false, why: 'a market code is not a wired Google market (Meta "-fb" markets are never priced)' };
  if (!isObj(v.prop) || typeof v.prop.id !== 'string' || !/^pp[a-z0-9]{4,20}$/.test(v.prop.id)) return { ok: false, why: 'prop.id must look like pp1234' };
  const n = +v.prop.n;
  if (!(Number.isInteger(n) && n >= 1 && n <= 6)) return { ok: false, why: 'prop.n must be an option number from 1 to 6' };
  const label = cleanStr(v.prop.label == null ? '' : v.prop.label, 60, 'prop.label');
  if (!label.ok) return label;
  if (PROPOSAL_OPTIONS.indexOf(v.option) < 0) return { ok: false, why: 'option must be go, go+ar or ar' };
  const pkgVersion = cleanStr(v.pkgVersion == null ? '' : v.pkgVersion, 20, 'pkgVersion');
  if (!pkgVersion.ok) return pkgVersion;
  for (const f of ['audit', 'rates', 'pq']) { if (!isObj(v[f])) return { ok: false, why: f + ' must be an object (the snapshot the page renders)' }; }
  for (const f of ['opts', 'aimSources']) { if (v[f] != null && !isObj(v[f])) return { ok: false, why: f + ' must be an object' }; }
  if (Object.keys(v.audit).length > 40) return { ok: false, why: 'audit carries more markets than a proposal can' };
  if (typeof v.clientSafe !== 'boolean') return { ok: false, why: 'clientSafe must be true or false' };
  if (!Array.isArray(v.blockers) || v.blockers.length > 100) return { ok: false, why: 'blockers must be a list (100 at most)' };
  if (v.blockers.some((b) => typeof b !== 'string' && !isObj(b))) return { ok: false, why: 'a blocker must be text or an object' };
  return { ok: true, v: {
    ref: v.ref, client, markets, t: tOf(v.t, ctx.now), by: ctx.by,
    prop: { id: v.prop.id, n, label: label.v }, option: v.option, pkgVersion: pkgVersion.v,
    audit: v.audit, rates: v.rates, opts: v.opts || {}, aimSources: v.aimSources || {}, pq: v.pq,
    clientSafe: v.clientSafe, blockers: v.blockers,
  } };
}

// the buy-in half (sent / chosen / declined / superseded / deleted / hist) — on a new option and
// on every later save; the stamps' `by` is the server's word
function cleanBuyIn(v, prev, ctx, out) {
  prev = prev || {};
  const steps = [
    ['sentAt', { via: 20 }], ['chosen', {}], ['declined', { why: 200 }], ['superseded', { ref: 'ref' }], ['deleted', {}],
  ];
  for (const [f, extra] of steps) {
    const s = cleanStamp(v[f], prev[f], ctx, extra, f);
    if (!s.ok) return s;
    if (s.v !== undefined) out[f] = s.v;
  }
  if (v.hist != null) {
    if (!Array.isArray(v.hist) || v.hist.length > 60 || v.hist.some((h) => !isObj(h))) return { ok: false, why: 'hist must be a list of entries (60 at most)' };
    out.hist = v.hist;
  }
  return { ok: true, v: out };
}

// one OPTION record: {ok, v, note?}. A stored option keeps its snapshot; only the buy-in (and the
// option's own label) moves. `note` says so when the incoming copy tried to change the snapshot.
export function cleanOption(v, stored, ctx) {
  if (!isObj(v)) return { ok: false, why: 'an option must be an object' };
  if (byteLen(JSON.stringify(v)) > PROPOSAL_MAX_BYTES) return { ok: false, why: 'the option is larger than 60 KB' };
  let out, note = null;
  if (isObj(stored)) {
    out = {};
    for (const f of PROP_FROZEN) { if (stored[f] !== undefined) out[f] = stored[f]; }
    const tried = PROP_FROZEN.filter((f) => f !== 'prop' && v[f] !== undefined && !same(v[f], stored[f]));
    const sp = isObj(stored.prop) ? stored.prop : {};
    if (isObj(v.prop) && (v.prop.id !== sp.id || +v.prop.n !== sp.n)) tried.push('prop');
    if (isObj(v.prop) && v.prop.label != null && v.prop.label !== sp.label) {
      const l = cleanStr(v.prop.label, 60, 'prop.label');
      if (!l.ok) return l;
      out.prop = Object.assign({}, sp, { label: l.v });
    }
    if (tried.length) note = 'saved options are frozen (' + tried.join(', ') + ') — save a new version to change them';
  } else {
    const s = cleanSnapshot(v, ctx);
    if (!s.ok) return s;
    out = s.v;
  }
  const b = cleanBuyIn(v, stored, ctx, out);
  if (!b.ok) return b;
  if (isObj(stored)) {
    const was = Object.assign({}, stored); delete was.lu;
    if (same(out, was)) return { ok: true, v: stored, note };       // nothing moved — keep lu as stored
  }
  out.lu = { by: ctx.by, at: ctx.now };
  return { ok: true, v: out, note };
}

// PUT /api/pricer/proposals. ctx.inScope(client) is the signin's client fence: a write for (or
// over) a foreign client is refused here, and the route re-injects every foreign record so a
// scoped save of a partial view can never delete one.
export function sanitizeProposalPut(body, cur, ctx) {
  const data = {}, rejected = [];
  cur = cur || {};
  const inScope = ctx.inScope || (() => true);
  for (const k of Object.keys(body || {})) {
    if (META_KEYS[k]) continue;
    const stored = cur[k];
    const refuse = (why) => { rejected.push({ k, why }); if (stored !== undefined) data[k] = stored; };
    if (!OPTION_ID_RE.test(k)) { refuse('an option id looks like o + 6–20 lowercase letters or digits'); continue; }
    const owner = stored !== undefined ? (stored && stored.client) : (body[k] && body[k].client);
    if (!inScope(String(owner || ''))) { rejected.push({ k, why: 'outside your clients' }); continue; }
    const r = cleanOption(body[k], stored, ctx);
    if (!r.ok) { refuse(r.why); continue; }
    if (r.note) rejected.push({ k, why: r.note });
    data[k] = r.v;
  }
  return { data, rejected };
}

/* --------------------------------------- rollout --------------------------------------- */
// one client's services rollout record
export function cleanRollout(v, stored, ctx) {
  if (!isObj(v)) return { ok: false, why: 'a rollout record must be an object' };
  const prev = isObj(stored) ? stored : {};
  const out = {};
  const stamps = [['debriefAt', {}], ['live', {}], ['declined', { why: 200 }], ['alwaysOn', { on: 'bool', mechanism: 40 }]];
  for (const [f, extra] of stamps) {
    const s = cleanStamp(v[f], prev[f], ctx, extra, f);
    if (!s.ok) return s;
    if (s.v !== undefined) out[f] = s.v;
  }
  for (const [f, max] of [['next', 160], ['notes', 1000], ['am', 40]]) {
    if (v[f] == null || v[f] === '') continue;
    const s = cleanStr(v[f], max, f);
    if (!s.ok) return s;
    if (s.v) out[f] = s.v;
  }
  if (v.nextDue != null && v.nextDue !== '') {
    if (!validDay(v.nextDue)) return { ok: false, why: 'nextDue must be a real date, YYYY-MM-DD' };
    out.nextDue = v.nextDue;
  }
  if (isObj(stored)) {
    const was = Object.assign({}, stored); delete was.lu;
    if (same(out, was)) return { ok: true, v: stored };
  }
  out.lu = { by: ctx.by, at: ctx.now };
  return { ok: true, v: out };
}

export function sanitizeRolloutPut(body, cur, ctx) {
  const data = {}, rejected = [];
  cur = cur || {};
  const inScope = ctx.inScope || (() => true);
  for (const k of Object.keys(body || {})) {
    if (META_KEYS[k]) continue;
    const stored = cur[k];
    const refuse = (why) => { rejected.push({ k, why }); if (stored !== undefined) data[k] = stored; };
    if (cleanClient(k) !== k) { refuse('the key must be a client name (1–60 characters, no ":" or "|")'); continue; }
    if (!inScope(k)) { rejected.push({ k, why: 'outside your clients' }); continue; }
    const r = cleanRollout(body[k], stored, ctx);
    if (!r.ok) { refuse(r.why); continue; }
    data[k] = r.v;
  }
  return { data, rejected };
}

/* --------------------------------------- roadmap --------------------------------------- */
// `<lineKey|alwayson>|<industry|*>` — the industry is free text because /api/golden/profile lets
// the team name industries of their own; only the line is a closed list
export function roadmapKey(k) {
  const s = String(k || '');
  const i = s.indexOf('|');
  if (i < 1) return null;
  const line = s.slice(0, i), ind = s.slice(i + 1);
  if (ROADMAP_KEYS.indexOf(line) < 0) return null;
  if (ind !== '*' && !/^[A-Za-z0-9][A-Za-z0-9 &'.,()\/-]{0,59}$/.test(ind)) return null;
  return { line, industry: ind };
}

export function sanitizeRoadmapPut(body, cur, ctx) {
  const data = {}, rejected = [];
  cur = cur || {};
  for (const k of Object.keys(body || {})) {
    if (META_KEYS[k]) continue;
    const stored = cur[k];
    const refuse = (why) => { rejected.push({ k, why }); if (stored !== undefined) data[k] = stored; };
    if (!roadmapKey(k)) { refuse('unknown key — <line or alwayson>|<industry or *>'); continue; }
    const v = body[k];
    if (v == null) continue;                                                     // a clear
    if (!isObj(v)) { refuse('a roadmap entry must be {status, note}'); continue; }
    if (ROADMAP_STATUS.indexOf(v.status) < 0) { refuse('status must be live, pilot, building or planned'); continue; }
    const note = cleanStr(v.note == null ? '' : v.note, 200, 'note');
    if (!note.ok) { refuse(note.why); continue; }
    const out = { status: v.status, note: note.v };
    if (isObj(stored) && stored.status === out.status && (stored.note || '') === out.note) { data[k] = stored; continue; }
    data[k] = Object.assign(out, { by: ctx.by, at: ctx.now });
  }
  return { data, rejected };
}

/* ---------------------------------------- one door ---------------------------------------- */
// the route's single call: store name -> its sanitizer. -> {data, rejected} | {error}
export function sanitizePut(store, body, cur, ctx) {
  const S = PRICER_STORES[store];
  if (!S) return { error: 'unknown pricer store' };
  if (!isObj(body)) return { error: 'the body must be a JSON object (the whole map)' };
  const n = Object.keys(body).filter((k) => !META_KEYS[k]).length;
  if (n > S.maxKeys) return { error: 'too many keys in one save (' + n + ' > ' + S.maxKeys + ')' };
  if (S.kind === 'cell') return sanitizeCellPut(store, body, cur, ctx);
  if (S.kind === 'prop') return sanitizeProposalPut(body, cur, ctx);
  if (S.kind === 'roll') return sanitizeRolloutPut(body, cur, ctx);
  return sanitizeRoadmapPut(body, cur, ctx);
}
