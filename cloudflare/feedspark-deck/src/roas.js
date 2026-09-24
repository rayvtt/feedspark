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

export const ROAS_MCP_URL = 'https://mcp.feedhero.net/mcp';   // best-guess default — override with ROAS_MCP_URL once confirmed against the live server
export const ROAS_PROTOCOL = '2025-06-18';
export const ROAS_CRON = '10,40 * * * *';   // mirrored in wrangler.toml [triggers] and worker.js -> scheduled()
export const ROAS_PULLS = 6;                // clients per firing — 57 on the roster, so every one turns over roughly every 5 hours
export const ROAS_KEEP_CATS = 30;           // category rows kept per market (Superdry GB alone has 425; the page needs the top spenders, not the whole tree)

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
export function splitClientRows(rows) {
  const norm = (Array.isArray(rows) ? rows : []).map(normRow).filter((r) => r.cmpid);
  const total = norm.find((r) => r.category === 'Total') || null;
  const categories = norm.filter((r) => r.category !== 'Total')
    .sort((a, b) => b.spend.n - a.spend.n).slice(0, ROAS_KEEP_CATS);
  return { total, categories };
}

// ---- rotation: stalest cmpid first, a never-read one (rot 0) always leads --------------------
export function planPulls(roster, rot, k, now) {
  rot = rot || {}; k = k == null ? ROAS_PULLS : k;
  const list = (roster || []).slice();
  list.sort((a, b) => (rot[a.cmpid] || 0) - (rot[b.cmpid] || 0) || a.cmpid.localeCompare(b.cmpid));
  return list.slice(0, Math.max(0, k));
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
function tallyBand(list, counts) { list.forEach((b) => { if (b) counts[b] = (counts[b] || 0) + 1; }); }

// idx = { cmpid: { client, market, cmpid, ...normalized Total row fields, updated } } (roasidx,
// as roasStore writes it) -> per-brand rollup. Markets FeedHero has never been pulled for are
// simply absent — "not scanned yet", never assumed zero.
export function brandRollup(rows) {
  const by = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || !r.client) return;
    const b = by[r.client] || (by[r.client] = {
      client: r.client, roster: (ROAS_ROSTER[r.client] || []).length,
      markets: [], spendByCur: {}, revenueByCur: {}, bandCounts: {}, zombieSkus: 0, zombieWeighted: 0, updated: 0,
    });
    b.markets.push(r);
    addCur(b.spendByCur, r.spend && r.spend.cur, (r.spend && r.spend.n) || 0);
    addCur(b.revenueByCur, r.revenue && r.revenue.cur, (r.revenue && r.revenue.n) || 0);
    if (r.band) b.bandCounts[r.band] = (b.bandCounts[r.band] || 0) + 1;
    if (r.zombiePct != null && r.skus) { b.zombieSkus += r.skus; b.zombieWeighted += r.zombiePct * r.skus; }
    if (r.updated > b.updated) b.updated = r.updated;
  });
  return Object.keys(by).sort().map((client) => {
    const b = by[client];
    b.markets.sort((a, c) => (c.spend.n || 0) - (a.spend.n || 0));
    b.marketsRead = b.markets.length;
    b.roasPct = blendedRoas(b.spendByCur, b.revenueByCur);
    b.avgZombiePct = b.zombieSkus ? r2(b.zombieWeighted / b.zombieSkus) : null;
    delete b.zombieSkus; delete b.zombieWeighted;
    return b;
  });
}

// book-wide, across whatever's been read of the (already client-scoped) roster passed in
export function bookKpis(brands) {
  const spendByCur = {}, revenueByCur = {}, bandCounts = {};
  let marketsRead = 0, marketsTotal = 0, brandsRead = 0;
  (brands || []).forEach((b) => {
    marketsRead += b.marketsRead || 0; marketsTotal += b.roster || 0;
    if (b.marketsRead) brandsRead++;
    Object.keys(b.spendByCur || {}).forEach((c) => addCur(spendByCur, c, b.spendByCur[c]));
    Object.keys(b.revenueByCur || {}).forEach((c) => addCur(revenueByCur, c, b.revenueByCur[c]));
    Object.keys(b.bandCounts || {}).forEach((k) => { bandCounts[k] = (bandCounts[k] || 0) + b.bandCounts[k]; });
  });
  return { brands: brands ? brands.length : 0, brandsRead, marketsRead, marketsTotal, spendByCur, revenueByCur, bandCounts, bandOrder: BAND_ORDER };
}

// a short stable signature (change detection -> KV writes only when a figure moved)
export function sigOf(obj) {
  const s = JSON.stringify(obj || {}); let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + s.length.toString(36);
}
