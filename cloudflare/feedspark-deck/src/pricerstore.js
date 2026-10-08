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
 * A STALE COPY NEVER WINS (fix round 1, 7 Oct 2026). The page saves its WHOLE map and re-reads
 * only every 90 s, so a tab that read `aMin = 30` before a colleague saved 45 sends 30 back on its
 * next save of ANY field — and comparing values alone, that read as a fresh edit: the colleague's
 * 45 was lost and the revert credited to someone who never touched it (a stale proposal copy did
 * the same to a ✓ Chosen). kvmerge's read stamp only ever guarded absence. So every store here
 * also guards PRESENCE: when the incoming value DIFFERS from the stored one and the stored one was
 * written AFTER the writer's read (its server stamp — a cell's / roadmap entry's `at`, a
 * proposal's / rollout record's `lu.at` — is later than ctx.base, the X-Sync-Base the page sent),
 * the stored value stays and the key is listed in `rejected` as 'changed by <who> since you
 * loaded — reload to edit it'. That includes the same person in another tab (named as such):
 * a stale tab of your own is as blind to the newer value as a colleague's. A value equal to the
 * stored one is untouched (stamps kept); a new key, or a change on top of the latest value, is
 * accepted and stamped. A writer that sends no read stamp (base 0) has read nothing, so every
 * stamped value is newer than its read. Keys the writer LEFT OUT that were written after its read
 * are kept by kvmerge and listed the same way (staleAbsent), so a cleared cell that a colleague
 * had just changed is reported, never silently undone. The reply names every such key; the page
 * shows only those it changed itself and re-adopts the merged map.
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
// go+ar+rf = Tier 3 · AI-Refresher (Tier 2 plus the AI-ready fields refreshed monthly or quarterly)
export const PROPOSAL_OPTIONS = ['go', 'go+ar', 'go+ar+rf', 'ar'];

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
// a deleted option keeps only its identity and stamps (stripDeleted); one deleted longer ago than
// this leaves the map entirely on the next save (kvmerge tombstones it under the read stamp)
export const DELETED_PURGE_MS = 30 * 86400000;

/* ---------------------------------- field allow-lists ---------------------------------- */
const num = (min, max, dp) => ({ t: 'num', min, max, dp });
const str = (max) => ({ t: 'str', max });

// pricerops: `<id>|<field>` for every catalogue / package row, plus two house-wide `_g` rows
export const OPS_ROW_FIELDS = {
  aspl: num(0, 1000, 2), qc: num(0, 1000, 2), pm: num(0, 1000, 2), mon: num(0, 1000, 2), lead: num(0, 1000, 2),
  aMin: num(0, 10000, 2), tokPerP: num(0, 1e8, 2), qcPct: num(0, 100, 2), qcMin: num(0, 600, 2), note: str(200),
};
export const OPS_G_FIELDS = { ruleH: num(0, 100, 2), langSetupH: num(0, 200, 2) };
// pricerprice: `<id>|unit` per row, and the house-wide `_g` commercials. test2 / test3 / test4 are
// the TEST PACKAGE prices (£ a month for 2, 3 or 4 tests a month — Ray, 7 Oct 2026: the bundle
// add-on), Management-owned like every other sell price; unset = the engine prices the line as
// draft / unpriced, never a guess
export const PRICE_ROW_FIELDS = { unit: num(0, 100, 4) };
export const PRICE_G_FIELDS = {
  blockGBP: num(1, 10000, 2), blockH: num(1, 24, 2), tiers: { t: 'tiers' },
  bundlePct: num(0, 50, 2), reusePct: num(0, 100, 2), floorMonthly: num(0, 100000, 2), pkgVersion: str(20),
  test2: num(0, 100000, 2), test3: num(0, 100000, 2), test4: num(0, 100000, 2),
  // AI-Refresher: a refresh costs this % of each field's generation price (Tier 3)
  rfPct: num(0, 100, 2),
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

// the server stamp {by, at} a stored value carries: a cell / roadmap entry IS its stamp, a
// proposal option / rollout record carries it as `lu`
function stampOf(kind, stored) {
  if (!isObj(stored)) return null;
  const s = (kind === 'prop' || kind === 'roll') ? stored.lu : stored;
  return isObj(s) && typeof s.at === 'number' && isFinite(s.at) ? s : null;
}
// the stored value was written AFTER the writer's read (ctx.base = the X-Sync-Base it sent) — so
// the copy it is saving over it is stale. A caller that passes no base at all (a unit-level call)
// gets no check; the route always passes one, and a base of 0 means "read nothing".
export function staleStamp(kind, stored, ctx) {
  if (!ctx || typeof ctx.base !== 'number' || !isFinite(ctx.base)) return null;
  const s = stampOf(kind, stored);
  return s && s.at > ctx.base ? s : null;
}
export function staleWhy(stamp, ctx) {
  const who = !stamp.by ? 'someone' : (stamp.by === ctx.by ? 'you in another tab' : stamp.by);
  return 'changed by ' + who + ' since you loaded — reload to edit it';
}

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
    // rounded BEFORE the rise is checked, so 5000.2 then 5000.4 cannot both land as 5000 (and 0.3
    // cannot land as a 0 bound): the stored ladder is what must rise, not the typed one
    const u = Math.round(typeof b.upTo === 'number' ? b.upTo : +b.upTo);
    if (!isFinite(u) || u <= prev || u > 1e9) return { ok: false, why: 'band upper bounds must rise, in whole products (band ' + (i + 1) + ')' };
    prev = u;
    out.push({ upTo: u, x: roundTo(x, 4) });
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
    if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {            // a clear — absence decides,
      const st = staleStamp('cell', stored, ctx);                                 // unless the value is newer than the read
      if (st) refuse(staleWhy(st, ctx));
      continue;
    }
    const c = coerceCell(spec, raw);
    if (!c.ok) { refuse(c.why); continue; }
    if (isObj(stored) && same(stored.v, c.v)) { data[k] = stored; continue; }     // unchanged — keep its stamp
    const st = staleStamp('cell', stored, ctx);
    if (st) { refuse(staleWhy(st, ctx)); continue; }                             // newer than the writer's read — it stays
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

// A DELETED OPTION SHEDS ITS SNAPSHOT (fix round 1). ✕ Delete was a stamp on a record that kept
// its whole 11–60 KB snapshot, and the store is one whole-map save every click moves, so it only
// ever grew — past 20 MB every save is a 413, past 1,500 options a 400, and deleting could not
// free a byte. A deleted option has left the pipeline (every reader skips `deleted`), so it keeps
// who / what / when — ref, client, markets, proposal, option, version, the two totals and its
// stamps — and nothing else; DELETED_PURGE_MS later it leaves the map altogether.
const PROP_SHED = ['audit', 'rates', 'opts', 'aimSources', 'blockers'];
export function stripDeleted(o) {
  for (const f of PROP_SHED) delete o[f];
  if (isObj(o.pq)) {
    const pq = o.pq, slim = {};
    if (typeof pq.label === 'string') slim.label = pq.label.slice(0, 80);
    for (const h of ['oneOff', 'monthly']) {
      if (isObj(pq[h]) && typeof pq[h].total === 'number' && isFinite(pq[h].total)) slim[h] = { total: pq[h].total };
    }
    o.pq = slim;
  }
  return o;
}
// a stored option that has already shed its snapshot
export function isShed(o) { return isObj(o) && !!o.deleted && o.audit === undefined; }

// the snapshot half of a NEW option
function cleanSnapshot(v, ctx) {
  if (typeof v.ref !== 'string' || !/^SVC\d{6}(-\d+)?$/.test(v.ref)) return { ok: false, why: 'ref must look like SVC123456 (or SVC123456-2)' };
  const client = cleanClient(v.client);
  if (!client) return { ok: false, why: 'client must be a name of 1–60 characters (no ":" or "|", not starting with "_" or "~")' };
  if (!Array.isArray(v.markets) || !v.markets.length || v.markets.length > 40) return { ok: false, why: 'markets must list 1 to 40 market codes' };
  const markets = v.markets.map(cleanMkt);
  if (markets.some((m) => !m)) return { ok: false, why: 'a market code is not a wired Google market (Meta "-fb" markets are never priced)' };
  if (!isObj(v.prop) || typeof v.prop.id !== 'string' || !/^pp[a-z0-9]{4,20}$/.test(v.prop.id)) return { ok: false, why: 'prop.id must look like pp1234' };
  const n = +v.prop.n;
  if (!(Number.isInteger(n) && n >= 1 && n <= 6)) return { ok: false, why: 'prop.n must be an option number from 1 to 6' };
  const label = cleanStr(v.prop.label == null ? '' : v.prop.label, 60, 'prop.label');
  if (!label.ok) return label;
  if (PROPOSAL_OPTIONS.indexOf(v.option) < 0) return { ok: false, why: 'option must be go, go+ar, go+ar+rf or ar' };
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
    // a shed record has no snapshot left to compare a copy against — the copy is simply older
    const tried = isShed(stored) ? [] : PROP_FROZEN.filter((f) => f !== 'prop' && v[f] !== undefined && !same(v[f], stored[f]));
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
  if (isShed(stored) && !out.deleted) return { ok: false, why: 'a deleted option cannot be restored (it kept only its name) — build it again as a new option' };
  if (out.deleted) stripDeleted(out);
  if (isObj(stored)) {
    const was = Object.assign({}, stored); delete was.lu;
    if (same(out, was)) return { ok: true, v: stored, note };       // nothing moved — keep lu as stored
    // an option deleted before records shed their snapshot: shedding it now is housekeeping, not
    // an edit — it keeps its lu, and `shed` tells the caller nobody changed anything
    if (stored.deleted && same(out, stripDeleted(Object.assign({}, was)))) {
      if (stored.lu !== undefined) out.lu = stored.lu;
      return { ok: true, v: out, note, shed: true };
    }
  }
  out.lu = { by: ctx.by, at: ctx.now };
  return { ok: true, v: out, note };
}

// PUT /api/pricer/proposals. ctx.inScope(client) is the signin's client fence: a write for (or
// over) a foreign client is refused here, and the route re-injects every foreign record so a
// scoped save of a partial view can never delete one.
// The refusal says WHY in words the page can show as it stands (finding 34): a prospect built in
// file mode is never one of a scoped signin's clients, and the fence stays — but the AM is told
// that, rather than watching the options vanish. A FOREIGN STORED record is never named.
export function scopeWhy(client, stored) {
  if (stored !== undefined) return 'outside your clients — this record belongs to an account your signin cannot edit';
  const c = String(client == null ? '' : client).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return 'outside your clients — ' + (c ? '"' + c + '" is not one of your accounts' : 'it names no client') +
    ', so this signin cannot save it (a prospect proposal needs an unscoped signin)';
}

export function sanitizeProposalPut(body, cur, ctx) {
  const data = {}, rejected = [], purged = [];
  cur = cur || {};
  const inScope = ctx.inScope || (() => true);
  for (const k of Object.keys(body || {})) {
    if (META_KEYS[k]) continue;
    const stored = cur[k];
    const refuse = (why) => { rejected.push({ k, why }); if (stored !== undefined) data[k] = stored; };
    if (!OPTION_ID_RE.test(k)) { refuse('an option id looks like o + 6–20 lowercase letters or digits'); continue; }
    const owner = stored !== undefined ? (stored && stored.client) : (body[k] && body[k].client);
    if (!inScope(String(owner || ''))) { rejected.push({ k, why: scopeWhy(owner, stored) }); continue; }
    // deleted long enough ago, and still deleted in this copy: left out, so the read stamp purges it
    if (isShed(stored) && isObj(body[k]) && body[k].deleted && isObj(stored.deleted) &&
        typeof stored.deleted.t === 'number' && ctx.now - stored.deleted.t > DELETED_PURGE_MS) { purged.push(k); continue; }
    const r = cleanOption(body[k], stored, ctx);
    if (stored !== undefined && !r.shed && !(r.ok && r.v === stored)) {
      const st = staleStamp('prop', stored, ctx);
      if (st) { refuse(staleWhy(st, ctx)); continue; }                         // a colleague's newer copy stays
    }
    if (!r.ok) { refuse(r.why); continue; }
    if (r.note) rejected.push({ k, why: r.note });
    data[k] = r.v;
  }
  return { data, rejected, purged };
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
    if (cleanClient(k) !== k) { refuse('the key must be a client name (1–60 characters, no ":" or "|", not starting with "_" or "~", no space at either end)'); continue; }
    if (!inScope(k)) { rejected.push({ k, why: scopeWhy(k) }); continue; }
    const r = cleanRollout(body[k], stored, ctx);
    if (stored !== undefined && !(r.ok && r.v === stored)) {
      const st = staleStamp('roll', stored, ctx);
      if (st) { refuse(staleWhy(st, ctx)); continue; }
    }
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
    const st = staleStamp('map', stored, ctx);
    if (v == null) { if (st) refuse(staleWhy(st, ctx)); continue; }             // a clear (unless it is newer than the read)
    if (!isObj(v)) { refuse('a roadmap entry must be {status, note}'); continue; }
    if (ROADMAP_STATUS.indexOf(v.status) < 0) { refuse('status must be live, pilot, building or planned'); continue; }
    const note = cleanStr(v.note == null ? '' : v.note, 200, 'note');
    if (!note.ok) { refuse(note.why); continue; }
    const out = { status: v.status, note: note.v };
    if (isObj(stored) && stored.status === out.status && (stored.note || '') === out.note) { data[k] = stored; continue; }
    if (st) { refuse(staleWhy(st, ctx)); continue; }
    data[k] = Object.assign(out, { by: ctx.by, at: ctx.now });
  }
  return { data, rejected };
}

/* ---------------------------------------- one door ---------------------------------------- */
// the route's single call: store name -> its sanitizer. -> {data, rejected} | {error}
export function sanitizePut(store, body, cur, ctx) {
  const S = Object.prototype.hasOwnProperty.call(PRICER_STORES, store) ? PRICER_STORES[store] : null;
  if (!S) return { error: 'unknown pricer store' };
  if (!isObj(body)) return { error: 'the body must be a JSON object (the whole map)' };
  // an option that already shed its snapshot does not count against a save (it is about to be
  // purged, and counting it would refuse the very save that purges it)
  const cnt = (k) => !META_KEYS[k] && !(S.kind === 'prop' && isShed(cur && Object.prototype.hasOwnProperty.call(cur, k) ? cur[k] : null));
  const n = Object.keys(body).filter(cnt).length;
  if (n > S.maxKeys) {
    return { error: 'too many keys in one save (' + n + ' > ' + S.maxKeys + ')' +
      (S.kind === 'prop' ? ' — the proposals store is full: delete options nobody needs (a deleted option no longer counts) and save again' : '') };
  }
  let r;
  if (S.kind === 'cell') r = sanitizeCellPut(store, body, cur, ctx);
  else if (S.kind === 'prop') r = sanitizeProposalPut(body, cur, ctx);
  else if (S.kind === 'roll') r = sanitizeRolloutPut(body, cur, ctx);
  else r = sanitizeRoadmapPut(body, cur, ctx);
  r.rejected = r.rejected.concat(staleAbsent(store, body, cur, ctx));
  return r;
}

// keys the writer LEFT OUT that were written after its read: kvmerge keeps them (the writer never
// saw them), and the reply names them — so a value the writer cleared, which a colleague had just
// changed, is reported rather than silently undone. A foreign record is never named.
export function staleAbsent(store, body, cur, ctx) {
  const out = [];
  const S = Object.prototype.hasOwnProperty.call(PRICER_STORES, store) ? PRICER_STORES[store] : null;
  if (!S || !ctx || typeof ctx.base !== 'number') return out;
  const inScope = ctx.inScope || (() => true);
  for (const k of Object.keys(cur || {})) {
    if (META_KEYS[k] || Object.prototype.hasOwnProperty.call(body || {}, k)) continue;
    const owner = S.scope === 'field' ? String((cur[k] && cur[k].client) || '') : (S.scope === 'self' ? k : null);
    if (owner !== null && !inScope(owner)) continue;
    const st = staleStamp(S.kind, cur[k], ctx);
    if (st) out.push({ k, why: staleWhy(st, ctx) });
  }
  return out;
}

/* ---- PRE-LOADED EXAMPLES (Ray, 8 Oct 2026: "pre-loaded population for 5 products examples per brands ahead
   to run this audit live with client"). One KV key per client, `pricerex:<client>` = {mkts: {<mkt>: {t, by,
   products: [{p, ex, src}]}}}: up to five of the client's own products per market (their feed row, trimmed to
   the fields the preview shows) and the example values the tiers write for each — a Spark AI example (src 'ai')
   or one built from the row alone ('derived'). A PUT replaces ONE market; the worker scopes it per signin like
   every Pricer route. Client product data lives in KV only, never in git. */
export const EXAMPLE_ROW_FIELDS = ['id', 'title', 'image_link', 'description', 'google_product_category', 'product_type', 'color', 'material',
  'pattern', 'gender', 'age_group', 'size', 'size_type', 'size_system', 'product_detail', 'question_and_answer', 'document_link',
  'related_product', 'item_group_title', 'variant_option', 'popularity_rank', 'brand', 'price'];
export const EXAMPLE_EX_FIELDS = ['title', 'description', 'google_product_category', 'product_type', 'keywords', 'color', 'material', 'pattern',
  'gender', 'age_group', 'size_type', 'size_system', 'product_highlight', 'product_detail', 'question_and_answer', 'item_group_title'];
export const EXAMPLES_MAX = 5;
const EX_LIST = { keywords: 16, product_highlight: 8, product_detail: 10, question_and_answer: 6 };
function exText(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max) : null; }
function exAny(v) {
  if (typeof v === 'string') return exText(v, 1200);
  if (isObj(v)) { const o = {}; for (const k of ['q', 'a', 'question', 'answer', 'section', 'name', 'value']) { const s = exText(v[k], 600); if (s) o[k] = s; } return Object.keys(o).length ? o : null; }
  return null;
}
// one market's examples, or {ok:false, why}
export function cleanExamples(body) {
  if (!isObj(body)) return { ok: false, why: 'the examples must be an object' };
  if (!Array.isArray(body.products) || !body.products.length || body.products.length > EXAMPLES_MAX) return { ok: false, why: 'products must list 1 to ' + EXAMPLES_MAX + ' products' };
  const products = [];
  for (const it of body.products) {
    if (!isObj(it) || !isObj(it.p)) return { ok: false, why: 'every product needs its feed row (p)' };
    const p = {};
    for (const k of EXAMPLE_ROW_FIELDS) { const s = exText(it.p[k], k === 'description' || k === 'product_detail' ? 1200 : 400); if (s) p[k] = s; }
    if (!p.id || !p.title) return { ok: false, why: 'every product needs an id and a title' };
    if (p.image_link && !/^https?:\/\//.test(p.image_link)) delete p.image_link;
    p.hl = Math.max(0, Math.min(100, Math.round(+it.p.hl || 0)));
    p.hlv = Array.isArray(it.p.hlv) ? it.p.hlv.slice(0, 6).map((x) => exText(x, 200)).filter(Boolean) : [];
    p.kw = Array.isArray(it.p.kw) ? it.p.kw.slice(0, 3).map((x) => exText(x, 200)).filter(Boolean) : [];
    let ex = null;
    if (isObj(it.ex)) {
      ex = {};
      for (const k of EXAMPLE_EX_FIELDS) {
        const v = it.ex[k];
        if (v == null) continue;
        if (EX_LIST[k] && Array.isArray(v)) { const L = v.slice(0, EX_LIST[k]).map(exAny).filter(Boolean); if (L.length) ex[k] = L; }
        else { const s = exText(v, k === 'description' ? 1500 : 400); if (s) ex[k] = s; }
      }
      if (!Object.keys(ex).length) ex = null;
    }
    products.push({ p, ex, src: ex && it.src === 'ai' ? 'ai' : 'derived' });
  }
  if (byteLen(JSON.stringify(products)) > 60 * 1024) return { ok: false, why: 'the examples are larger than 60 KB' };
  return { ok: true, v: products };
}
