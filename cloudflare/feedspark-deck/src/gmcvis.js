/* GMC COMPETITIVE VISIBILITY — Google Merchant Center's own read of who is seen beside the brand on Google
 * Shopping (Ray, 2 Nov 2026: "You can now start importing competitors on Google Shopping via the new data
 * from Google Merchant Center. Inside [FeedHero] MCP, you can see GMC visibility and bring in whatever is
 * necessary").
 *
 * SOURCE: the FeedHero_reports MCP's `gmc_visibility` tool (same server + ROAS_MCP_TOKEN as /roas), which
 * reads the Merchant API's competitive-visibility report on a daily refresh and returns, per client, one row
 * per market (country × Google product category): the client's rank, the share of its visibility that is
 * paid, the TOP competitor with its rank, how much more visible it is, how often it shows above the client
 * and on how many of the same pages, and how many competitors the market has. Figures are a 28-day average
 * ending 3 days ago — never live — and `checked` says when FeedHero read each client.
 *
 * THREE FACTS ABOUT THE SOURCE, read off it on 2 Nov 2026, that decide how this module reads it:
 *   1. It is per MERCHANT CENTER ACCOUNT, not per feed. Every Reiss market (30 FeedHero clients on one
 *      multi-country account) returns the same rows — GB, AU, US — so a market's view is the account's rows
 *      FILTERED TO ITS COUNTRY, and a market the account reports nothing for says so instead of borrowing
 *      another country's figures.
 *   2. It names ONE competitor per market (the most visible), with a COUNT of the rest. This is not a
 *      competitor list and nothing here pretends it is.
 *   3. The client's rank reads 5 on almost every market while the competitor reads 1 — consistent with a
 *      ceiling at 5 rather than a measured fifth place. Shown as "5 or lower" (RANK_CAP), never as an exact 5.
 * Three sources are read (all / ads / organic): organic = Google's free listings, which rank on the FEED
 * itself — the one surface FeedSpark's work moves without a bid.
 *
 * PURE + dependency-free so the worker's cron pull (worker.js → gmcPull) and the harness
 * (tools/test_gmcvis.mjs) run the same code. Competitor domains and ranks are client data: KV only
 * (`gmcvis`), never in git.
 */

export const GMC_PULLS = 2;                         // roster companies read per :10/:40 ROAS firing
export const GMC_STALE_MS = 20 * 3600 * 1000;       // FeedHero refreshes daily; one read a day per company
export const GMC_SOURCES = ['all', 'ads', 'organic'];
export const GMC_SRC_WORD = { all: 'all traffic', ads: 'Shopping ads', organic: 'free listings' };
export const RANK_CAP = 5;                          // the rank the source reads on almost every market
export const GMC_ROWS = 40;                         // markets kept per source

const s0 = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10); return isFinite(n) ? n : null; };

/* "Its visibility vs you": "+5%", "+1000%", ">+1,000%", "Within 2.5%", "-20%", "" */
export function visPct(v) {
  const s = s0(v);
  if (!s) return null;
  if (/^within/i.test(s)) return { v: 0, within: true, t: s };
  const m = /^([<>])?\s*([+-])?\s*([\d.,]+)\s*%$/.exec(s.replace(/\s/g, ''));
  if (!m) return null;
  const n = parseFloat(m[3].replace(/,/g, ''));
  if (!isFinite(n)) return null;
  const o = { v: m[2] === '-' ? -n : n, t: s };
  if (m[1] === '>') o.gt = true; else if (m[1] === '<') o.lt = true;
  return o;
}

/* one source's rows → the markets, each in the shape the rail draws */
export function normMarkets(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const c = s0(r.country).toUpperCase().slice(0, 3);
    if (!/^[A-Z]{2,3}$/.test(c)) return;
    const d = s0(r.top_competitor).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 120);
    const top = d ? { d, rank: int(r.top_rank), vis: visPct(r.visibility), higher: int(r.higher), overlap: int(r.overlap) } : null;
    out.push({ c, cat: s0(r.category).slice(0, 80), rank: int(r.rank), ads: int(r.ads_ratio), top, n: Math.max(0, int(r.competitors) || 0) });
  });
  return out.slice(0, GMC_ROWS);
}

/* the record one company's read is stored as (`gmcvis` map, keyed by cmpid) */
export function makeRecord(m, bySrc, now) {
  const rec = { v: 1, cmpid: m.cmpid, client: m.client, market: m.market, at: now, checked: '', note: '', src: {} };
  GMC_SOURCES.forEach((k) => {
    const p = bySrc[k];
    const rows = (p && Array.isArray(p.rows)) ? p.rows : [];
    rec.src[k] = normMarkets(rows);
    if (!rec.checked) rec.checked = s0((rows.find((r) => r && r.checked) || {}).checked).slice(0, 20);
    if (!rec.note) rec.note = s0((rows.find((r) => r && r.note) || {}).note).slice(0, 200);
  });
  // a client with no Merchant Center data comes back with no rows at all — the list view carries the reason
  if (!rec.note && !GMC_SOURCES.some((k) => rec.src[k].length)) rec.note = 'No visibility data from Google for this account';
  return rec;
}

/* which roster companies to read this firing: never-read first, then the stalest past GMC_STALE_MS */
export function gmcPlan(roster, store, k, now) {
  store = store || {};
  const due = (roster || []).filter((m) => { const r = store[m.cmpid]; return !r || !(now - (+r.at || 0) < GMC_STALE_MS); });
  due.sort((a, b) => ((store[a.cmpid] || {}).at || 0) - ((store[b.cmpid] || {}).at || 0) || a.cmpid.localeCompare(b.cmpid));
  return due.slice(0, Math.max(0, k == null ? GMC_PULLS : k));
}

/* a roster market label ('GB', 'BE-FR', 'UAE', 'CA-EN', 'EU') → the country the source reports it under */
export function ccOf(label) {
  const L = s0(label).toUpperCase();
  if (!L || L === 'EU') return null;
  if (L === 'UAE') return 'AE';
  if (L === 'UK') return 'GB';
  return /^[A-Z]{2}/.test(L) ? L.slice(0, 2) : null;
}
/* the wired feed code ('gb', 'befr', 'uae') → its roster company (same client, same market) */
export function cmpidFor(rosterList, client, mkt) {
  const want = s0(mkt).toLowerCase(), fold = (x) => s0(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = (rosterList || []).find((m) => fold(m.client) === fold(client) && s0(m.market).toLowerCase().replace(/[^a-z]/g, '') === want);
  return hit || null;
}

/* one market's view: the account's rows in that market's country, per source */
export function marketView(rec, cc) {
  if (!rec) return null;
  const out = { at: rec.at, checked: rec.checked, note: rec.note, cc: cc || null, src: {}, countries: [] };
  const seen = {};
  GMC_SOURCES.forEach((k) => {
    const all = (rec.src && rec.src[k]) || [];
    all.forEach((r) => { seen[r.c] = 1; });
    out.src[k] = cc ? all.filter((r) => r.c === cc) : [];
  });
  out.countries = Object.keys(seen).sort();
  out.has = GMC_SOURCES.some((k) => out.src[k].length > 0);
  return out;
}

export function rankWord(rank) {
  if (rank == null) return '–';
  return rank >= RANK_CAP ? RANK_CAP + ' or lower' : String(rank);
}
function visWord(top) {
  const v = top && top.vis;
  if (!v) return '';
  if (v.within) return 'about as visible as you';
  if (v.v <= 0) return 'less visible than you';
  const x = (v.v / 100) + 1;   // +100% = twice as visible
  return (v.gt ? 'over ' : '') + (x >= 3 ? Math.round(x) + '× as visible as you' : Math.round(v.v) + '% more visible than you');
}

/* the signals a GMC read promotes — the tests that move VISIBILITY. Read on `all` traffic, with the free
   listings (organic) read apart because those rank on the feed alone. A signal names the category and the
   competitor, and quotes the source's own figures. */
export function gmcSignals(view) {
  const out = [];
  if (!view || !view.has) return out;
  const all = view.src.all || [], org = view.src.organic || [];
  const big = all.filter((r) => r.top && r.top.vis && !r.top.vis.within && r.top.vis.v >= 100 && (r.top.overlap || 0) >= 30)
    .sort((a, b) => (b.top.vis.v - a.top.vis.v) || ((b.top.overlap || 0) - (a.top.overlap || 0)));
  if (big.length) {
    const r = big[0];
    out.push({ k: 'kw_theme', why: r.top.d + ' is ' + visWord(r.top) + ' in ' + r.cat + ' and shows on ' + r.top.overlap + '% of the same pages (Merchant Center, last 28 days) — keyword coverage is what makes the catalogue eligible for more of them' });
  }
  const above = all.filter((r) => r.top && (r.top.higher || 0) >= 50 && (r.top.overlap || 0) >= 10)
    .sort((a, b) => (b.top.higher || 0) - (a.top.higher || 0));
  if (above.length) {
    const r = above[0];
    out.push({ k: 'cl_perf', why: r.top.d + ' sits above you ' + r.top.higher + '% of the time where you both show in ' + r.cat + ' — a performance-tier label lets the campaign bid the heroes apart' });
  }
  const paid = all.filter((r) => typeof r.ads === 'number' && r.ads >= 90);
  const orgCats = {}; org.forEach((r) => { orgCats[r.cat] = 1; });
  if (paid.length) {
    const r = paid.sort((a, b) => b.ads - a.ads)[0];
    out.push({ k: 'title_mask', why: r.ads + '% of your visibility in ' + r.cat + ' is paid' + (!org.length || orgCats[r.cat] ? '' : ' and the free listings report no ' + r.cat + ' market of yours at all') + ' — free listings rank on the feed itself, and the title is the field they read first' });
  }
  return out;
}

/* the status line the rail and the route say about the store, across the roster */
export function storeStatus(roster, store, now) {
  store = store || {};
  const list = roster || [];
  let read = 0, fresh = 0, empty = 0;
  list.forEach((m) => { const r = store[m.cmpid]; if (!r) return; read++; if (now - (+r.at || 0) < GMC_STALE_MS) fresh++; if (!GMC_SOURCES.some((k) => (r.src && r.src[k] || []).length)) empty++; });
  return { total: list.length, read, fresh, empty };
}
