/*
 * MIGRATION ROADMAP — HISTORY (Ray, 28 Sep 2026: "keep a pop-up panel on the right-hand side for any
 * historic or archive actions — delete, remove, edit — of everything, because it will be co-worked by
 * Matt and Andy and me").
 *
 * The roadmap store (KV `transform`) is a kvmerge map: every PUT carries the WHOLE map, so the page
 * cannot be trusted to say what it changed. The worker diffs the map as it was against the map as it
 * is after the merge, and appends one entry per key that actually moved to KV `transformlog`, stamped
 * with the Access identity (never the name the page wrote into the value). The page resolves each
 * key into words (card titles live in the page's seed) and can put any entry's BEFORE value back.
 *
 * Pure: the worker calls txDiff + txLogAppend; tools/test_transform.mjs runs both.
 */

export const TX_LOG_CAP = 1000;
const STAMP = { by: 1, at: 1 };
const MAX_STR = 1600;               // above every textarea's 1500 cap, so an undo puts back the whole value

// the value minus who/when (those change on every write and are not what anybody edited)
function core(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v === undefined ? undefined : v;
  const o = {};
  Object.keys(v).sort().forEach((k) => { if (!STAMP[k]) o[k] = v[k]; });
  return o;
}
// a stored before/after, bounded so one long description cannot bloat the log
function trim(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v === undefined ? null : v;
  const o = {};
  Object.keys(v).forEach((k) => {
    if (STAMP[k]) return;
    const x = v[k];
    o[k] = typeof x === 'string' && x.length > MAX_STR ? x.slice(0, MAX_STR) + '…' : x;
  });
  return o;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function changedFields(b, a) {
  const keys = {};
  Object.keys(b || {}).forEach((k) => { keys[k] = 1; });
  Object.keys(a || {}).forEach((k) => { keys[k] = 1; });
  return Object.keys(keys).filter((k) => !STAMP[k] && !same((b || {})[k], (a || {})[k])).sort();
}

// what kind of change one key saw — the words the panel files it under
export function txKind(key, b, a) {
  const k = String(key);
  if (a === undefined || a === null) return b && b.del ? 'restored' : 'reset';   // override removed → back to the plan
  const del = !!(a && a.del), wasDel = !!(b && b.del);
  if (del && !wasDel) return 'deleted';
  if (!del && wasDel) return 'restored';
  if (k.indexOf('cfg:') === 0) return 'setting';
  if ((b === undefined || b === null) && a && a.add) return 'added';
  const f = changedFields(b, a);
  if (k.indexOf('chk:') === 0) {
    if (f.length === 1 && f[0] === 'done') return a.done ? 'ticked' : 'unticked';
    if (f.every((x) => x === 'ord')) return 'moved';
    return 'edited';
  }
  if (k.indexOf('c:') === 0 && f.length && f.every((x) => x === 'm' || x === 'ord')) return 'moved';
  if (f.indexOf('st') >= 0) return 'status';
  return 'edited';
}

// every key that moved between two versions of the map → log entries (newest-first order not implied)
export function txDiff(prev, next, who, email, at) {
  const P = prev || {}, N = next || {}, out = [], keys = {};
  Object.keys(P).forEach((k) => { keys[k] = 1; });
  Object.keys(N).forEach((k) => { keys[k] = 1; });
  Object.keys(keys).sort().forEach((k) => {
    const b = P[k], a = N[k];
    if (same(core(b), core(a))) return;                              // only who/when moved: not a change
    out.push({ at, who: who || email || 'someone', email: email || '', k,
      kind: txKind(k, b, a), f: changedFields(b, a), b: trim(b), a: trim(a) });
  });
  return out;
}

// append, newest first, capped
export function txLogAppend(log, entries, cap) {
  const cur = Array.isArray(log) ? log : [];
  const add = (entries || []).slice().reverse();
  return add.concat(cur).slice(0, cap || TX_LOG_CAP);
}
