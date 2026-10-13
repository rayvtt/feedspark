/*
 * RETIRED CLIENTS (Ray, 13 Oct 2026: "why i still see House of Bruar in these modules").
 *
 * A client taken off the FCC in code (#653) still showed, because removing it from the code
 * removes nothing the worker had already STORED, and two live sources keep handing it back:
 *   - the scan indexes (labels / product types / golden / volume / overlays / images / the
 *     availability tally) and their alert maps list a feed they once read, wired or not;
 *   - the brand dossier store and the brief pipeline hold its record and its tickets;
 *   - the Task Manager reports database and the Scheduled-work sheet are not ours — they go on
 *     naming the client on every pull, every half hour.
 *
 * So retiring a client is DATA, not code: the list lives in KV (`retiredclients`, owner-written),
 * never in git — a name in the repo is exactly what the removal set out to end. The owner's
 * Retire button runs purgeRetired over every store below once, and the live lanes ask isRetired
 * before they write, so nothing the next pull returns can bring it back.
 *
 * Pure: no KV, no fetch. The worker hands in parsed values and writes back what comes out.
 */

export const RETIRED_KEY = 'retiredclients';

// one spelling per client: "House of Bruar", "HouseofBruar", "house-of-bruar" are one name
export function foldName(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

// the stored list → [{n, by, at}], unique by folded name, bounded
export function cleanList(v) {
  const out = [], seen = {};
  (Array.isArray(v) ? v : []).forEach((x) => {
    const n = String((x && x.n) || x || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const f = foldName(n);
    if (!f || seen[f]) return;
    seen[f] = 1;
    out.push({ n, by: String((x && x.by) || '').slice(0, 80), at: +((x && x.at) || 0) || 0 });
  });
  return out.slice(0, 50);
}

export function retiredSet(list) {
  const s = new Set();
  cleanList(list).forEach((x) => s.add(foldName(x.n)));
  return s;
}
export function isRetired(set, name) { return !!(set && set.size && name != null && set.has(foldName(name))); }

// a map keyed "client|mkt" (or "client") → the same map without the retired clients' keys
export function stripKeyed(obj, set) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { out: obj, n: 0 };
  const out = {}; let n = 0;
  Object.keys(obj).forEach((k) => {
    const c = k.split('|')[0];
    if (isRetired(set, c)) { n++; return; }
    out[k] = obj[k];
  });
  return { out, n };
}
// an array of records carrying .client → the records that are not retired
export function stripRows(arr, set, field) {
  if (!Array.isArray(arr)) return { out: arr, n: 0 };
  const f = field || 'client';
  const out = arr.filter((r) => !isRetired(set, r && r[f]));
  return { out, n: arr.length - out.length };
}

/* THE STORES, by shape. `keyed` = a plain map keyed by client or client|mkt; `field` = an object
   whose named sub-map is keyed that way; `book` = the Task Manager book index; `envelope` = a
   kvmerge envelope ({__v:2,data,meta}) whose keys are clients (`self`) or whose values carry
   .client (`value`) — those are TOMBSTONED, never just deleted, so a stale open tab saving its
   whole map cannot write the client back. */
export const PURGE_STORES = [
  { key: 'labelidx', kind: 'keyed' }, { key: 'ptypeidx', kind: 'keyed' }, { key: 'goldenidx', kind: 'keyed' },
  { key: 'voldobidx', kind: 'keyed' }, { key: 'overlayidx', kind: 'keyed' }, { key: 'imageidx', kind: 'keyed' },
  { key: 'feedavail', kind: 'keyed' }, { key: 'labelalerts', kind: 'keyed' }, { key: 'ptypealerts', kind: 'keyed' },
  { key: 'goldenalerts', kind: 'keyed' }, { key: 'tmidx', kind: 'keyed' }, { key: 'tmtrail', kind: 'keyed' },
  { key: 'schedskip', kind: 'field', field: 'clients' },
  { key: 'tmbookidx', kind: 'book' },
  { key: 'clients', kind: 'envelope', by: 'self' },
  { key: 'briefs', kind: 'envelope', by: 'value' },
];

// tombstone the retired clients' entries in a kvmerge envelope (lifted already)
export function tombstoneEnvelope(env, set, by, now) {
  if (!env || !env.data) return { out: env, n: 0 };
  let n = 0;
  Object.keys(env.data).forEach((k) => {
    const v = env.data[k];
    const c = by === 'self' ? k : (v && v.client);
    if (!isRetired(set, c)) return;
    delete env.data[k];
    env.meta = env.meta || {};
    env.meta[k] = { t: now, del: 1 };
    n++;
  });
  return { out: env, n };
}

// one store's value → { out, n } with every retired client taken out
export function purgeValue(store, value, set, now) {
  if (value == null) return { out: value, n: 0 };
  if (store.kind === 'keyed') return stripKeyed(value, set);
  if (store.kind === 'field') {
    const r = stripKeyed(value[store.field], set);
    return { out: Object.assign({}, value, { [store.field]: r.out }), n: r.n };
  }
  if (store.kind === 'book') {
    const v = Object.assign({}, value);
    let n = 0;
    const c = stripKeyed(v.clients, set); v.clients = c.out; n += c.n;
    ['accounts', 'roster', 'queues'].forEach((f) => { const r = stripRows(v[f], set); v[f] = r.out; n += r.n; });
    return { out: v, n };
  }
  return { out: value, n: 0 };
}

// the Task Manager roster minus the retired, so a pull never reads (and never writes) them
export function stripRoster(roster, set) {
  if (!roster) return roster;
  return {
    markets: stripRows(roster.markets, set).out,
    queues: stripRows(roster.queues, set).out,
    accounts: stripRows(roster.accounts, set).out,
  };
}
