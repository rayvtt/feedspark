// RESTOCK — the server half (Ray, 7 Oct 2026: "feedhero-reports have got By Products report - and
// 'Restock products' is interesting to build as a module").
//
// WHAT A RESTOCK PRODUCT IS, here: a product shoppers are still asking for in Google Ads — an
// impression, a click, a conversion in FeedHero's trailing 30-day Ads Traffic read — that cannot
// be bought right now, because the output feed either sends it OUT OF STOCK or no longer carries
// it at all (FeedHero's own "Unlisted SKUs in Ads traffic"). The demand is FeedHero's per-product
// `ads_traffic` report (the Catalogue's lane, read over 30 days instead of 7 — catAdsRead takes
// the period); the stock state is the output feed, streamed in the browser through the Feed Lab
// parser; the JOIN is done in the page (docs/restock_engine.js). Nothing here reads a feed.
//
// THIS FILE IS THE LEDGER: FeedHero reports a window, never a day, and the feed says what is out
// of stock NOW, so "out of stock for how long" exists nowhere until something writes it down. The
// page reports what it saw (ids out of stock, ids gone, ids that came back) and the worker keeps
// one record a market — first seen unavailable, last seen, which way, and when it came back — so
// a product's days unavailable are read off the record, never guessed from a window. It starts
// the day a market is first opened and says so ("tracking began …"); it is never back-filled.
//
// Nothing in git: KV `restock:<cmpid>` only, written through the Access-gated PUT (ACT
// 'restock-ledger'), scoped like every FeedHero route by the ROAS roster.

export const RESTOCK_PERIOD = '30_days';     // the trailing window the demand is read over (ads_traffic periods: 7_days / 30_days / 90_days …)
export const RESTOCK_PERIODS = ['7_days', '30_days'];   // what catAdsRead may be asked for — anything else is refused
export const RESTOCK_BACK_KEEP_DAYS = 14;    // a product that came back stays on the Back-in-stock view this long
export const RESTOCK_STALE_DAYS = 45;        // an entry nobody has seen (out, gone or back) for this long leaves the ledger — it is no longer demanded
export const RESTOCK_CAP = 6000;             // entries a market's ledger holds; the oldest-seen go first
export const RESTOCK_ID_MAX = 120, RESTOCK_LIST_MAX = 20000;
export const RESTOCK_TTL_S = 120 * 86400;    // KV expiry — a market nobody opens for four months starts afresh, and says so
export const DAY = 86400000;

export const ST = { oos: 'o', gone: 'g' };   // the state codes the ledger stores: o = in the feed, out of stock · g = not in the feed
export const ST_WORD = { o: 'oos', g: 'gone' };

export function ledgerKey(cmpid) { return 'restock:' + String(cmpid || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 60); }
export function daysSince(t, now) { const d = Math.floor(((now == null ? Date.now() : now) - (+t || 0)) / DAY); return d < 0 ? 0 : d; }

// one id as the ledger keys it — the product's own id, case kept (the feed's), trimmed, bounded
function idOk(v) { const s = String(v == null ? '' : v).trim(); return s && s.length <= RESTOCK_ID_MAX ? s : ''; }
function idList(a) {
  const out = [], seen = new Set();
  (Array.isArray(a) ? a : []).slice(0, RESTOCK_LIST_MAX).forEach((v) => { const s = idOk(v); if (s && !seen.has(s)) { seen.add(s); out.push(s); } });
  return out;
}
// the page's observation, sanitised: {oos:[ids], gone:[ids], back:[ids], n: products demanded, feedN: products in the feed}
// — null when it carries no lists at all (a feed that failed to stream must never be written as "everything came back")
export function cleanObs(b) {
  if (!b || typeof b !== 'object') return null;
  if (!Array.isArray(b.oos) && !Array.isArray(b.gone) && !Array.isArray(b.back)) return null;
  const oos = idList(b.oos), gone = new Set(idList(b.gone)), back = new Set(idList(b.back));
  const oosSet = new Set(oos);
  // an id cannot be two things at once: out of stock in the feed beats "gone", and neither can also be "back"
  oosSet.forEach((id) => { gone.delete(id); back.delete(id); });
  gone.forEach((id) => back.delete(id));
  return { oos, gone: Array.from(gone), back: Array.from(back), n: Math.max(0, Math.min(1e7, Math.round(+b.n || 0))), feedN: Math.max(0, Math.min(1e7, Math.round(+b.feedN || 0))) };
}
// the ledger: {v, t0: when tracking began, t: last observation, n: observations, p: {id: [first seen unavailable, last seen, state code, came back at|0]}}
export function emptyLedger(now) { return { v: 1, t0: now, t: 0, n: 0, p: {} }; }
export function ledgerUpdate(prev, obs, now) {
  const L = prev && prev.v === 1 && prev.p && typeof prev.p === 'object' ? { v: 1, t0: +prev.t0 || now, t: +prev.t || 0, n: +prev.n || 0, p: Object.assign({}, prev.p) } : emptyLedger(now);
  if (!obs) return L;
  const seen = (id, code) => {
    const e = L.p[id];
    // still unavailable → the episode goes on (first seen kept); came back then went again → a NEW episode; never seen → first seen today
    if (e && !e[3]) L.p[id] = [e[0], now, code, 0];
    else L.p[id] = [now, now, code, 0];
  };
  obs.oos.forEach((id) => seen(id, ST.oos));
  obs.gone.forEach((id) => seen(id, ST.gone));
  // came back: the page saw a ledger product in stock in the feed and still demanded — stamp when, keep the episode so the days read
  obs.back.forEach((id) => { const e = L.p[id]; if (e && !e[3]) L.p[id] = [e[0], now, e[2], now]; });
  // leave: came back more than RESTOCK_BACK_KEEP_DAYS ago, or nobody has seen it (either way) for RESTOCK_STALE_DAYS
  Object.keys(L.p).forEach((id) => {
    const e = L.p[id];
    if (!Array.isArray(e) || e.length < 4) { delete L.p[id]; return; }
    if (e[3] && now - e[3] > RESTOCK_BACK_KEEP_DAYS * DAY) delete L.p[id];
    else if (now - e[1] > RESTOCK_STALE_DAYS * DAY) delete L.p[id];
  });
  // bounded: the oldest-seen entries go first
  const ids = Object.keys(L.p);
  if (ids.length > RESTOCK_CAP) ids.sort((a, b) => L.p[a][1] - L.p[b][1]).slice(0, ids.length - RESTOCK_CAP).forEach((id) => { delete L.p[id]; });
  L.t = now; L.n = L.n + 1;
  return L;
}
// what the ledger says, in words the page prints: counts by state and the age of the record
export function ledgerSummary(L, now) {
  const out = { began: L && L.t0 ? L.t0 : 0, last: L && L.t ? L.t : 0, n: L && L.n ? L.n : 0, oos: 0, gone: 0, back: 0, days: L && L.t0 ? daysSince(L.t0, now) : 0 };
  Object.keys((L && L.p) || {}).forEach((id) => { const e = L.p[id]; if (e[3]) out.back++; else if (e[2] === ST.gone) out.gone++; else out.oos++; });
  return out;
}
