/*
 * ROAS reporting (working name — Ray, 23 Sep 2026: "we can call it something else, not ROS,
 * but let's start with ROS for now"). SOURCE = the FeedHero_reports MCP's `roas_dashboard` and
 * `client_list` tools (mcp.feedhero.net) — Google Ads return-on-ad-spend per client x category,
 * NOT the feedspark-reports Task Manager MCP that /api/tm already reads (different server,
 * different data: hours vs ad performance).
 *
 * SCOPE (Ray, 23 Sep 2026): FeedHero's own client_list carries 112 clients — most of them are
 * not FeedSpark accounts (Freemans, Sofology, DFS, Ocado, Secret Sales… sit next to Superdry and
 * Reiss on the same platform). Ray named the roster explicitly: Superdry, Reiss, Schuh, Monsoon,
 * Accessorize, YuMOVE, Hobbycraft. ROAS_ROSTER is that roster's markets, resolved against
 * FeedHero's own cmpid per market (client_list search, 23 Sep 2026) — the same static-map
 * pattern PLAN_SHEETS/DEFAULT_FEEDS already use in worker.js. A cmpid outside this map is never
 * pulled, never stored and never shown, however wide the connector's own reach is.
 *
 * PURE + dependency-free (no fetch, no KV) so the worker's cron pull (worker.js -> roasPull) and
 * the harness (tools/test_roas.mjs) run the SAME code — the tmparse.js/tmmcp.js pattern.
 *
 * CURRENCY (the landmine): a brand's markets report in different currencies (Superdry DE/FR/NL
 * in EUR, Superdry US in USD, Superdry GB in GBP) and FeedHero's own book-wide summary already
 * shows the trap — it sums "Total spend" across every currency into one meaningless figure.
 * Nothing here ever sums money across currency symbols; every rollup keeps a {cur: amount} map
 * and a blended ROAS% is only ever computed within one currency group.
 *
 * v2 (Ray, 24 Sep 2026: "mirror exactly features like AdWords but futuristic design"): Google
 * Ads reporting is three things FeedHero's one-shot read never gave us — a PERIOD you switch
 * (7 / 30 / 90 days), a TREND with a delta against the previous reading, and a table you DRILL.
 * FeedHero reports trailing windows only, never a day's own figure, so:
 *   - every market is read THREE times per pull, once per window (ROAS_WINDOWS), and the record
 *     keeps each window's Total + category rows apart (w7 / w30 / w90);
 *   - HISTORY is the trailing figure AS READ EACH DAY (histAdd — same-day replace, one point a
 *     day, ROAS_HIST_DAYS on the record, the last ROAS_SPARK_DAYS carried on the index for the
 *     page's trend and deltas). A delta "vs 7 days ago" therefore compares two trailing windows
 *     read a week apart, which is exactly what Google Ads' own "compare to previous period"
 *     chip does — never a day-level figure re-derived from window differences;
 *   - the category rows FeedHero returns are already every level of the tree as its own
 *     aggregate ("Women", "Women > Clothing", "Women > Clothing > Jackets" each carry their own
 *     spend), so catTree() only has to hang each path under its parent — nothing is summed here.
 */

const s0 = (v) => String(v == null ? '' : v);
const r2 = (n) => Math.round(n * 100) / 100;

// ---- FeedSpark's own roster on FeedHero (Ray, 23 Sep 2026) -----------------------------------
export const ROAS_ROSTER = {
  Superdry: [
    { market: 'GB', cmpid: 'superdry_gb' }, { market: 'FR', cmpid: 'superdry_fr' },
    { market: 'DE', cmpid: 'superdry_de' }, { market: 'NL', cmpid: 'superdry_nl' },
    { market: 'IE', cmpid: 'superdry_ie' }, { market: 'US', cmpid: 'superdry_us' },
    { market: 'ES', cmpid: 'superdry_es' }, { market: 'DK', cmpid: 'superdry_dk' },
    { market: 'BE-FR', cmpid: 'superdry_befr' }, { market: 'BE-NL', cmpid: 'superdry_benl' },
    { market: 'CH-DE', cmpid: 'superdry_chde' }, { market: 'CH-FR', cmpid: 'superdry_chfr' },
    { market: 'IT', cmpid: 'superdry_it' }, { market: 'NO', cmpid: 'superdry_no' },
    { market: 'PL', cmpid: 'superdry_pl' }, { market: 'SE', cmpid: 'superdry_se' },
    { market: 'FI', cmpid: 'superdry_fi' }, { market: 'CA-EN', cmpid: 'superdry_caen' },
    { market: 'CA-FR', cmpid: 'superdry_cafr' },
  ],
  Reiss: [
    { market: 'GB', cmpid: 'reiss_gb' }, { market: 'US', cmpid: 'reiss_us' },
    { market: 'IE', cmpid: 'reiss_ie_pla' }, { market: 'DE', cmpid: 'reiss_de' },
    { market: 'NL', cmpid: 'reiss_nl' }, { market: 'AU', cmpid: 'reiss_au' },
    { market: 'CA', cmpid: 'reiss_ca' }, { market: 'EU', cmpid: 'reiss_eu' },
    { market: 'FR', cmpid: 'reiss_fr' }, { market: 'UAE', cmpid: 'reiss_uae' },
    { market: 'AT', cmpid: 'reiss_at' }, { market: 'BE', cmpid: 'reiss_be' },
    { market: 'CH', cmpid: 'reiss_ch' }, { market: 'CZ', cmpid: 'reiss_cz' },
    { market: 'DK', cmpid: 'reiss_dk' }, { market: 'ES', cmpid: 'reiss_es' },
    { market: 'FI', cmpid: 'reiss_fi' }, { market: 'GR', cmpid: 'reiss_gr' },
    { market: 'HK', cmpid: 'reiss_hk' }, { market: 'IL', cmpid: 'reiss_il' },
    { market: 'IT', cmpid: 'reiss_it' }, { market: 'KW', cmpid: 'reiss_kw' },
    { market: 'PL', cmpid: 'reiss_pl' }, { market: 'PT', cmpid: 'reiss_pt' },
    { market: 'QA', cmpid: 'reiss_qa' }, { market: 'RO', cmpid: 'reiss_ro' },
    { market: 'SA', cmpid: 'reiss_sa' }, { market: 'SE', cmpid: 'reiss_se' },
    { market: 'SG', cmpid: 'reiss_sg' }, { market: 'SK', cmpid: 'reiss_sk' },
  ],
  Schuh: [
    { market: 'GB', cmpid: 'schuh_uk_1' }, { market: 'DE', cmpid: 'schuhde' },
    { market: 'IE', cmpid: 'schuhie' },
  ],
  Monsoon: [
    { market: 'GB', cmpid: 'monsoon_uk' }, { market: 'IE', cmpid: 'monsoon_ie' },
  ],
  Accessorize: [{ market: 'GB', cmpid: 'accessorize_uk' }],
  YuMOVE: [{ market: 'GB', cmpid: 'yumove_uk' }],
  Hobbycraft: [{ market: 'GB', cmpid: 'fs_new_hobbycraft' }],
};

export const ROAS_MCP_URL = 'https://mcp.feedhero.net/mcp';   // confirmed live 24 Sep 2026 (a bare POST answers a JSON-RPC 401) — ROAS_MCP_URL overrides
export const ROAS_PROTOCOL = '2025-06-18';
export const ROAS_CRON = '10,40 * * * *';   // mirrored in wrangler.toml [triggers] and worker.js -> scheduled()
// clients per firing. Each market now costs THREE MCP calls (one per window) + four KV ops, and a
// firing has ~50 subrequests on the plan the worker runs on: 5 x 7 + init + status = ~40. The
// 57-market roster turns over roughly every 6 hours — still several times faster than FeedHero's
// own figures move (about once a day).
export const ROAS_PULLS = 5;
export const ROAS_KEEP_CATS = 200;        // category rows kept on the DEFAULT window (Superdry GB alone has 425; 200 by spend covers every branch the table drills)
export const ROAS_KEEP_CATS_ALT = 80;     // the other two windows keep a thinner tree — the drill-down follows the period switch, the record does not triple
export const ROAS_HIST_DAYS = 400;        // daily points kept on the per-market record
export const ROAS_SPARK_DAYS = 60;        // daily points carried on the index — the page's trend, sparklines and deltas read these
export const ROAS_DELTA_BACK = 7;         // "vs 7 days ago" — the reading nearest to a week before the latest one

// the three periods FeedHero's roas_dashboard accepts that the page switches between (1_year is
// a fourth call per market for a figure nobody asked for — not pulled)
export const ROAS_WINDOWS = [
  { k: 'w7', period: '7_days', days: 7, label: '7 days' },
  { k: 'w30', period: '30_days', days: 30, label: '30 days' },
  { k: 'w90', period: '90_days', days: 90, label: '90 days' },
];
export const ROAS_DEFAULT_WIN = 'w30';
export const HIST_COLS = ['sp', 'rv', 'cv', 'ck', 'im', 'sk', 'zb'];   // a compact daily point per window, in this order

// flat roster -> the rotation planner works over one list, not seven nested arrays
export function rosterList() {
  const out = [];
  Object.keys(ROAS_ROSTER).forEach((client) => {
    (ROAS_ROSTER[client] || []).forEach((m) => out.push({ client, market: m.market, cmpid: m.cmpid }));
  });
  return out;
}
export function rosterOf(client) { return (ROAS_ROSTER[client] || []).map((m) => ({ client, market: m.market, cmpid: m.cmpid })); }
export function cmpidBrand(cmpid) {
  for (const client of Object.keys(ROAS_ROSTER)) {
    const hit = ROAS_ROSTER[client].find((m) => m.cmpid === cmpid);
    if (hit) return { client, market: hit.market };
  }
  return null;
}

// ---- parsing (FeedHero formats everything for display — "£41,794.42", "1,148.65%", "64,469") ---
// leading currency symbol + the number; a bare "0.00" with no symbol carries cur:null rather than a guessed one
export function parseMoney(v) {
  const s = s0(v).trim();
  const m = /^([^\d.,\s-]+)?\s*(-?[\d,]+(?:\.\d+)?)/.exec(s);
  if (!m) return { cur: null, n: 0 };
  return { cur: m[1] || null, n: r2(parseFloat(m[2].replace(/,/g, '')) || 0) };
}
export function pctNum(v) { const n = parseFloat(s0(v).replace(/[,%]/g, '')); return isNaN(n) ? null : r2(n); }
export function intNum(v) { const n = parseFloat(s0(v).replace(/,/g, '')); return isNaN(n) ? 0 : Math.round(n); }

// one roas_dashboard row -> the shape every surface reads. band: FeedHero prints "" for a
// zero-traffic row (no Google Ads activity that period) — that is not "Losing", it is no reading.
export function normRow(row) {
  row = row || {};
  const band = s0(row.band).trim();
  return {
    cmpid: s0(row.cmpid), cmpname: s0(row.cmpname), category: s0(row.category) || 'Total',
    skus: intNum(row.skus), zombiePct: pctNum(row.zombie),
    impr: intNum(row.impressions), clicks: intNum(row.clicks), conv: pctNum(row.conversions),
    revenue: parseMoney(row.revenue), spend: parseMoney(row.spend), cpc: parseMoney(row.cpc),
    ctrPct: pctNum(row.ctr), aov: parseMoney(row.aov), avgPrice: parseMoney(row.avg_price),
    upliftPct: pctNum(row.uplift), crPct: pctNum(row.cr), cpa: parseMoney(row.cpa),
    roasPct: pctNum(row.roas), minMarginPct: pctNum(row.min_margin),
    band: band || null, source: s0(row.data_source) || null, collected: s0(row.updated) || null,
  };
}

// a client's roas_dashboard page (Total row first by convention, but never assumed — found by
// category) -> { total, categories (Total excluded, spend-sorted, capped) }
export function splitClientRows(rows, cap) {
  const norm = (Array.isArray(rows) ? rows : []).map(normRow).filter((r) => r.cmpid);
  const total = norm.find((r) => r.category === 'Total') || null;
  const categories = norm.filter((r) => r.category !== 'Total')
    .sort((a, b) => b.spend.n - a.spend.n).slice(0, cap == null ? ROAS_KEEP_CATS : cap);
  return { total, categories };
}

// ---- rotation: stalest cmpid first, a never-read one (rot 0) always leads --------------------
export function planPulls(roster, rot, k, now) {
  rot = rot || {}; k = k == null ? ROAS_PULLS : k;
  const list = (roster || []).slice();
  list.sort((a, b) => (rot[a.cmpid] || 0) - (rot[b.cmpid] || 0) || a.cmpid.localeCompare(b.cmpid));
  return list.slice(0, Math.max(0, k));
}

// ---- the currency a market reports in ---------------------------------------------------------
// read off any money field carrying a symbol — a zero-spend market still prints its avg_price
// with one (Reiss EU: €0.00 spend, €125.83 avg price), so a quiet market is not currency-less
export function rowCur(t) {
  if (!t) return null;
  const f = ['spend', 'revenue', 'avgPrice', 'aov', 'cpc', 'cpa'];
  for (const k of f) { if (t[k] && t[k].cur) return t[k].cur; }
  return null;
}

// ---- history: the trailing figure as read each day -------------------------------------------
export function dayKey(ms) { return new Date(ms == null ? Date.now() : ms).toISOString().slice(0, 10); }
export function dayDiff(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }
// normalized Total row -> compact point [spend, revenue, conv, clicks, impr, skus, zombie%]
export function histPoint(t) {
  if (!t) return null;
  return [(t.spend && t.spend.n) || 0, (t.revenue && t.revenue.n) || 0, t.conv || 0, t.clicks || 0, t.impr || 0, t.skus || 0, t.zombiePct == null ? null : t.zombiePct];
}
// compact point -> named, with the derived ROAS (revenue / spend) — the one rate history carries
export function pointOf(entry, k) {
  const p = entry && entry[k];
  if (!Array.isArray(p)) return null;
  const o = { d: entry.d };
  HIST_COLS.forEach((c, i) => { o[c] = p[i] == null ? null : p[i]; });
  o.roas = o.sp > 0 ? r2((o.rv / o.sp) * 100) : null;
  return o;
}
// hist (sorted by d) + today's totals per window -> hist with today's point (same day = replace,
// so four reads a day leave ONE point), sorted, capped to the newest `cap`
export function histAdd(hist, d, totals, cap) {
  const entry = { d, cur: null };
  ROAS_WINDOWS.forEach((w) => { const t = totals && totals[w.k]; entry[w.k] = histPoint(t); if (!entry.cur) entry.cur = rowCur(t); });
  const out = (Array.isArray(hist) ? hist : []).filter((e) => e && e.d && e.d !== d);
  out.push(entry);
  out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  cap = cap == null ? ROAS_HIST_DAYS : cap;
  return out.length > cap ? out.slice(out.length - cap) : out;
}
// the point at or before `back` days before the newest one — null while the record is younger
// than that (a delta against nothing is not a delta)
export function backPoint(hist, k, back) {
  const h = (Array.isArray(hist) ? hist : []).filter((e) => e && Array.isArray(e[k]));
  if (h.length < 2) return null;
  const last = h[h.length - 1];
  const target = dayDiff(last.d, '1970-01-01') - (back == null ? ROAS_DELTA_BACK : back);
  let hit = null;
  for (const e of h) { if (dayDiff(e.d, '1970-01-01') <= target) hit = e; else break; }
  return hit ? pointOf(hit, k) : null;
}
export function deltaPct(now, prev) {
  if (now == null || prev == null || !isFinite(now) || !isFinite(prev) || prev === 0) return null;
  return r2(((now - prev) / Math.abs(prev)) * 100);
}

// ---- the index entry roasStore writes (one per market, read by GET /api/roas in ONE KV get) ----
// The w30 Total stays FLAT on the entry (spend/revenue/band… at the top level) for the v1 shape
// every reader already handles; w7 / w90 sit beside it; the last ROAS_SPARK_DAYS of history ride
// as `spark`. `day` is the read's UTC day so a new day with unchanged figures still writes (that
// day needs its point); `sig` excludes updated/day/spark so an unchanged reading costs no write.
export function idxEntry(meta, totals, hist) {
  totals = totals || {};
  const w30 = totals.w30 || normRow({ cmpid: meta.cmpid, category: 'Total' });
  const wins = {};
  ROAS_WINDOWS.forEach((w) => { wins[w.k] = totals[w.k] || null; });
  const sig = sigOf({ w: wins });
  const spark = (Array.isArray(hist) ? hist : []).slice(-ROAS_SPARK_DAYS);
  // the meta (client / market / cmpid) is written AFTER the flat Total so the row's own cmpid
  // field can never overwrite the market's — they match on live data, but the market is the key
  return Object.assign({}, w30, { client: meta.client, market: meta.market, cmpid: meta.cmpid, updated: meta.updated, day: dayKey(meta.updated),
    cur: rowCur(w30) || rowCur(wins.w7) || rowCur(wins.w90), w7: wins.w7, w30: wins.w30, w90: wins.w90, spark, sig });
}
// an index row (v1 flat shape OR v2) -> that window's Total, or null when the window was never read
export function windowTotal(row, k) {
  if (!row) return null;
  k = k || ROAS_DEFAULT_WIN;
  if (row[k]) return row[k];
  if (k === ROAS_DEFAULT_WIN && row.spend) return row;   // v1 entry: the 30-day Total is the entry
  return null;
}

// ---- category tree: FeedHero's "A > B > C" paths, every level its own aggregate row ------------
export function splitPath(s) { return s0(s).split('>').map((x) => x.trim()).filter(Boolean); }
// categories (normalized, any order) -> roots [{ name, path, depth, row, kids }]. A child whose
// parent row was capped away hangs at the root under its own full path — never summed into a
// synthetic parent (FeedHero already aggregated every level; inventing one would double it).
export function catTree(categories) {
  const nodes = {};
  const list = (Array.isArray(categories) ? categories : []).filter((c) => c && c.category);
  list.forEach((c) => { nodes[c.category] = { name: splitPath(c.category).slice(-1)[0] || c.category, path: c.category, depth: splitPath(c.category).length, row: c, kids: [] }; });
  const roots = [];
  Object.keys(nodes).forEach((p) => {
    const n = nodes[p]; const parts = splitPath(p);
    let parent = null;
    for (let i = parts.length - 1; i > 0 && !parent; i--) { const pp = parts.slice(0, i).join(' > '); if (nodes[pp]) parent = nodes[pp]; }
    if (parent) parent.kids.push(n); else { if (n.depth > 1) n.name = n.path; roots.push(n); }
  });
  const bySpend = (a, b) => ((b.row.spend && b.row.spend.n) || 0) - ((a.row.spend && a.row.spend.n) || 0);
  const sortTree = (arr) => { arr.sort(bySpend); arr.forEach((n) => sortTree(n.kids)); };
  sortTree(roots);
  return roots;
}
export function flattenTree(roots, depth) {
  const out = [];
  (roots || []).forEach((n) => { out.push({ node: n, depth: depth || 0 }); flattenTree(n.kids, (depth || 0) + 1).forEach((x) => out.push(x)); });
  return out;
}

// ---- rollups: money NEVER crosses a currency boundary -----------------------------------------
function addCur(map, cur, n) { if (!cur) return; map[cur] = r2((map[cur] || 0) + n); }
function blendedRoas(spendByCur, revByCur) {
  // only meaningful where exactly one currency covers all the spend being blended
  const curs = Object.keys(spendByCur).filter((c) => spendByCur[c] > 0);
  if (curs.length !== 1) return null;
  const c = curs[0]; const spend = spendByCur[c], rev = revByCur[c] || 0;
  return spend > 0 ? r2((rev / spend) * 100) : null;
}
const BAND_ORDER = ['Strong', 'Steady', 'Weak', 'Losing'];

// per-currency aggregate (n markets, the sums every rate on the scorecards derives from)
function curAgg(map, cur, t) {
  if (!cur) return;
  const a = map[cur] || (map[cur] = { n: 0, sp: 0, rv: 0, cv: 0, ck: 0, im: 0, sk: 0, zbSk: 0, zbW: 0, bands: {} });
  a.n++; a.sp = r2(a.sp + ((t.spend && t.spend.n) || 0)); a.rv = r2(a.rv + ((t.revenue && t.revenue.n) || 0));
  a.cv = r2(a.cv + (t.conv || 0)); a.ck += t.clicks || 0; a.im += t.impr || 0; a.sk += t.skus || 0;
  if (t.zombiePct != null && t.skus) { a.zbSk += t.skus; a.zbW += t.zombiePct * t.skus; }
  if (t.band) a.bands[t.band] = (a.bands[t.band] || 0) + 1;
}
function finishAgg(map) {
  Object.keys(map).forEach((c) => { const a = map[c]; a.zb = a.zbSk ? r2(a.zbW / a.zbSk) : null; a.roas = a.sp > 0 ? r2((a.rv / a.sp) * 100) : null; delete a.zbSk; delete a.zbW; });
  return map;
}

// idx rows (roasidx entries as roasStore writes them, v1 flat or v2) -> per-brand rollup for ONE
// window. Markets FeedHero has never been pulled for are simply absent — "not scanned yet",
// never assumed zero; a market read but without that window (a v1 entry asked for w7) counts as
// read with no reading.
export function brandRollup(rows, k) {
  k = k || ROAS_DEFAULT_WIN;
  const by = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || !r.client) return;
    const b = by[r.client] || (by[r.client] = {
      client: r.client, roster: (ROAS_ROSTER[r.client] || []).length,
      markets: [], spendByCur: {}, revenueByCur: {}, byCur: {}, bandCounts: {}, zombieSkus: 0, zombieWeighted: 0, updated: 0,
      conv: 0, clicks: 0, impr: 0, skus: 0,
    });
    const t = windowTotal(r, k) || {};
    const cur = rowCur(t) || r.cur || null;
    b.markets.push(Object.assign({ client: r.client, market: r.market, cmpid: r.cmpid, updated: r.updated, cur, has: !!windowTotal(r, k) }, t));
    addCur(b.spendByCur, t.spend && t.spend.cur, (t.spend && t.spend.n) || 0);
    addCur(b.revenueByCur, t.revenue && t.revenue.cur, (t.revenue && t.revenue.n) || 0);
    if (windowTotal(r, k)) curAgg(b.byCur, cur, t);
    if (t.band) b.bandCounts[t.band] = (b.bandCounts[t.band] || 0) + 1;
    if (t.zombiePct != null && t.skus) { b.zombieSkus += t.skus; b.zombieWeighted += t.zombiePct * t.skus; }
    b.conv = r2(b.conv + (t.conv || 0)); b.clicks += t.clicks || 0; b.impr += t.impr || 0; b.skus += t.skus || 0;
    if (r.updated > b.updated) b.updated = r.updated;
  });
  return Object.keys(by).sort().map((client) => {
    const b = by[client];
    b.markets.sort((a, c) => ((c.spend && c.spend.n) || 0) - ((a.spend && a.spend.n) || 0));
    b.marketsRead = b.markets.length;
    b.roasPct = blendedRoas(b.spendByCur, b.revenueByCur);
    b.avgZombiePct = b.zombieSkus ? r2(b.zombieWeighted / b.zombieSkus) : null;
    b.byCur = finishAgg(b.byCur);
    delete b.zombieSkus; delete b.zombieWeighted;
    return b;
  });
}

// book-wide, across whatever's been read of the (already client-scoped) roster passed in
export function bookKpis(brands) {
  const spendByCur = {}, revenueByCur = {}, bandCounts = {}, byCur = {};
  let marketsRead = 0, marketsTotal = 0, brandsRead = 0;
  (brands || []).forEach((b) => {
    marketsRead += b.marketsRead || 0; marketsTotal += b.roster || 0;
    if (b.marketsRead) brandsRead++;
    Object.keys(b.spendByCur || {}).forEach((c) => addCur(spendByCur, c, b.spendByCur[c]));
    Object.keys(b.revenueByCur || {}).forEach((c) => addCur(revenueByCur, c, b.revenueByCur[c]));
    Object.keys(b.bandCounts || {}).forEach((k) => { bandCounts[k] = (bandCounts[k] || 0) + b.bandCounts[k]; });
    Object.keys(b.byCur || {}).forEach((c) => {
      const s = b.byCur[c]; const a = byCur[c] || (byCur[c] = { n: 0, sp: 0, rv: 0, cv: 0, ck: 0, im: 0, sk: 0, zbSk: 0, zbW: 0, bands: {} });
      a.n += s.n; a.sp = r2(a.sp + s.sp); a.rv = r2(a.rv + s.rv); a.cv = r2(a.cv + s.cv); a.ck += s.ck; a.im += s.im; a.sk += s.sk;
      if (s.zb != null && s.sk) { a.zbSk += s.sk; a.zbW += s.zb * s.sk; }
      Object.keys(s.bands || {}).forEach((k) => { a.bands[k] = (a.bands[k] || 0) + s.bands[k]; });
    });
  });
  return { brands: brands ? brands.length : 0, brandsRead, marketsRead, marketsTotal, spendByCur, revenueByCur, byCur: finishAgg(byCur), bandCounts, bandOrder: BAND_ORDER };
}

// ---- series: the trailing window as read each day, summed per currency ----------------------
// rows = idx entries (their `spark`), k = window, cur = one currency symbol — or null for EVERY
// market, where the money columns are set to null (a sum across £ and € is not a number). Each
// day carries `n`, how many markets had a point that day, so a day read for half the roster is
// never mistaken for the whole. Days are the union of every market's days.
export function seriesFor(rows, k, cur) {
  const days = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || !Array.isArray(r.spark)) return;
    const rc = r.cur || rowCur(windowTotal(r, ROAS_DEFAULT_WIN));
    if (cur && rc !== cur) return;
    r.spark.forEach((e) => {
      const p = pointOf(e, k); if (!p) return;
      const d = days[p.d] || (days[p.d] = { d: p.d, sp: 0, rv: 0, cv: 0, ck: 0, im: 0, sk: 0, n: 0 });
      d.sp = r2(d.sp + (p.sp || 0)); d.rv = r2(d.rv + (p.rv || 0)); d.cv = r2(d.cv + (p.cv || 0)); d.ck += p.ck || 0; d.im += p.im || 0; d.sk += p.sk || 0; d.n++;
    });
  });
  return Object.keys(days).sort().map((d) => {
    const x = days[d];
    if (!cur) { x.sp = null; x.rv = null; x.roas = null; } else x.roas = x.sp > 0 ? r2((x.rv / x.sp) * 100) : null;
    return x;
  });
}

// ---- movers: every market's latest reading against the one ~back days earlier ----------------
export function movers(rows, k, back) {
  k = k || ROAS_DEFAULT_WIN; back = back == null ? ROAS_DELTA_BACK : back;
  return (Array.isArray(rows) ? rows : []).filter((r) => r && r.client).map((r) => {
    const t = windowTotal(r, k);
    const now = t ? histPoint(t) : null;
    const cur = rowCur(t) || r.cur || null;
    const nowP = now ? { sp: now[0], rv: now[1], cv: now[2], ck: now[3], im: now[4], roas: now[0] > 0 ? r2((now[1] / now[0]) * 100) : null } : null;
    const prev = backPoint(r.spark, k, back);
    return {
      client: r.client, market: r.market, cmpid: r.cmpid, cur, band: (t && t.band) || null,
      sp: nowP ? nowP.sp : null, rv: nowP ? nowP.rv : null, roas: nowP ? nowP.roas : null, cv: nowP ? nowP.cv : null,
      prevD: prev ? prev.d : null,
      dSp: nowP && prev ? deltaPct(nowP.sp, prev.sp) : null,
      dRv: nowP && prev ? deltaPct(nowP.rv, prev.rv) : null,
      dRoas: nowP && prev ? deltaPct(nowP.roas, prev.roas) : null,
      dCv: nowP && prev ? deltaPct(nowP.cv, prev.cv) : null,
    };
  }).sort((a, b) => (b.rv || 0) - (a.rv || 0));
}

// the public per-market row the page's table + scorecards read (nothing the index doesn't hold)
export function marketView(r) {
  const out = { client: r.client, market: r.market, cmpid: r.cmpid, updated: r.updated || 0, cur: r.cur || rowCur(windowTotal(r, ROAS_DEFAULT_WIN)) || null, spark: Array.isArray(r.spark) ? r.spark : [] };
  ROAS_WINDOWS.forEach((w) => { out[w.k] = windowTotal(r, w.k); });
  return out;
}

// a short stable signature (change detection -> KV writes only when a figure moved)
export function sigOf(obj) {
  const s = JSON.stringify(obj || {}); let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + s.length.toString(36);
}
