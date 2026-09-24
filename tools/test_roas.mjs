// ROAS integration harness (pure node, CI-safe). SOURCE = the FeedHero_reports MCP's
// roas_dashboard / client_list tools — a DIFFERENT server from the Task Manager MCP /api/tm
// reads. Pins the pure engine (src/roas.js: parsing, the FeedSpark-only roster, the
// currency-safe rollup, the rotation planner, and since v2 the three windows, the daily
// history, the category tree, the per-currency series and the movers) against real specimen
// rows pulled from the live FeedHero_reports connector on 23 Sep 2026, the worker's wiring
// (route, scope, cron, the three reads per market, the live segment route) and the page's
// Google Ads feature set (Ray, 24 Sep 2026: "mirror exactly features like AdWords but
// futuristic design").
import fs from 'node:fs';
import * as ROAS from '../cloudflare/feedspark-deck/src/roas.js';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const WRANGLER = read('wrangler.toml');
const PAGE = read('docs/FeedSpark_ROAS.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why ? ' — ' + why : '')); } };

console.log('· parsing — real FeedHero roas_dashboard specimens (Superdry GB, 23 Sep 2026)');
t('a plain money string keeps its symbol', JSON.stringify(ROAS.parseMoney('£41,794.42')) === JSON.stringify({ cur: '£', n: 41794.42 }));
t('euro and dollar symbols are kept apart, never assumed', JSON.stringify(ROAS.parseMoney('€126,666.90')) === JSON.stringify({ cur: '€', n: 126666.9 }) && JSON.stringify(ROAS.parseMoney('$12,842.20')) === JSON.stringify({ cur: '$', n: 12842.2 }));
t('a zero reading with no symbol carries cur:null, never a guessed one', ROAS.parseMoney('0.00').cur === null);
t('percentages strip the comma and the % sign', ROAS.pctNum('1,148.65%') === 1148.65 && ROAS.pctNum('8.71%') === 8.71);
t('SKU counts strip thousands separators', ROAS.intNum('64,469') === 64469);

const superdryGbTotal = { cmpid: 'superdry_gb', cmpname: 'Superdry GB', category: 'Total', skus: '64,469', zombie: '48.06%', impressions: '14,477,612', clicks: '204,985', conversions: '6,585.04', revenue: '£480,072.16', spend: '£41,794.42', cpc: '£0.20', ctr: '1.42%', aov: '£72.90', avg_price: '£41.96', uplift: '173.74%', cr: '3.21%', cpa: '£6.35', roas: '1,148.65%', min_margin: '8.71%', band: 'Strong', data_source: 'Google Ads', updated: '23/09/2026 at 12:37 AM' };
const superdryGbCat = { cmpid: 'superdry_gb', cmpname: 'Superdry GB', category: 'Women > Clothing > Jackets and Coats > Puffer Jacket', skus: '964', zombie: '43.15%', impressions: '1,175,375', clicks: '14,709', conversions: '440.06', revenue: '£42,837.62', spend: '£3,070.16', cpc: '£0.21', ctr: '1.25%', aov: '£97.34', avg_price: '£84.78', uplift: '114.81%', cr: '2.99%', cpa: '£6.98', roas: '1,395.29%', min_margin: '7.17%', band: 'Strong', data_source: 'Google Ads', updated: '23/09/2026 at 12:37 AM' };
const reissEuZero = { cmpid: 'reiss_eu', cmpname: 'Reiss EU', category: 'Total', skus: '60,048', zombie: '100.00%', impressions: '0', clicks: '0', conversions: '0.00', revenue: '€0.00', spend: '€0.00', cpc: '€0.00', ctr: '0.00%', aov: '€0.00', avg_price: '€125.83', uplift: '0.00%', cr: '0.00%', cpa: '€0.00', roas: '0.00%', min_margin: '0.00%', band: '', data_source: 'Google Ads', updated: '23/09/2026 at 12:47 AM' };
const nrow = ROAS.normRow(superdryGbTotal);
t('a normalized Total row carries every field, band included', nrow.category === 'Total' && nrow.skus === 64469 && nrow.roasPct === 1148.65 && nrow.band === 'Strong' && nrow.spend.cur === '£' && nrow.spend.n === 41794.42);
t('a zero-traffic row\'s band is null, never "Losing" — no reading is not a bad reading', ROAS.normRow(reissEuZero).band === null);
t('a market\'s currency is read off any money field with a symbol — a zero-spend market still prints its avg price with one', ROAS.rowCur(ROAS.normRow(reissEuZero)) === '€' && ROAS.rowCur(ROAS.normRow({ cmpid: 'x', category: 'Total' })) === null);

console.log('· splitClientRows — Total found by category, not position; categories capped and spend-sorted');
const split = ROAS.splitClientRows([superdryGbCat, superdryGbTotal]);
t('the Total row is found even when it is not first in the page', split.total && split.total.category === 'Total' && split.total.roasPct === 1148.65);
t('categories exclude Total and are sorted by spend', split.categories.length === 1 && split.categories[0].category.indexOf('Puffer Jacket') >= 0);
const manyCats = Array.from({ length: 260 }, (_, i) => Object.assign({}, superdryGbCat, { category: 'Cat ' + i, spend: '£' + (i + 1) + '.00' }));
t('category rows are capped at ROAS_KEEP_CATS (200) on the default window — Superdry GB alone has 425', ROAS.splitClientRows(manyCats).categories.length === ROAS.ROAS_KEEP_CATS && ROAS.ROAS_KEEP_CATS === 200);
t('the other windows keep a thinner tree (ROAS_KEEP_CATS_ALT) via the cap argument', ROAS.splitClientRows(manyCats, ROAS.ROAS_KEEP_CATS_ALT).categories.length === ROAS.ROAS_KEEP_CATS_ALT && ROAS.ROAS_KEEP_CATS_ALT < ROAS.ROAS_KEEP_CATS);

console.log('· roster — FeedSpark\'s own seven brands only');
const list = ROAS.rosterList();
t('the roster is exactly the seven brands Ray named, 23 Sep 2026', Object.keys(ROAS.ROAS_ROSTER).sort().join(',') === 'Accessorize,Hobbycraft,Monsoon,Reiss,Schuh,Superdry,YuMOVE');
t('a client outside the roster resolves to nothing', ROAS.rosterOf('Sofology').length === 0 && ROAS.cmpidBrand('sofology') === null);
t('cmpidBrand resolves a real market back to its brand', JSON.stringify(ROAS.cmpidBrand('superdry_gb')) === JSON.stringify({ client: 'Superdry', market: 'GB' }));
t('every roster entry carries a client, market and cmpid', list.every((m) => m.client && m.market && m.cmpid) && list.length === Object.values(ROAS.ROAS_ROSTER).reduce((n, a) => n + a.length, 0));

console.log('· rotation — stalest cmpid first, a never-read one always leads');
const roster3 = [{ client: 'A', market: 'GB', cmpid: 'a_gb' }, { client: 'B', market: 'GB', cmpid: 'b_gb' }, { client: 'C', market: 'GB', cmpid: 'c_gb' }];
const plan = ROAS.planPulls(roster3, { a_gb: 1000, c_gb: 2000 }, 2, 3000);
t('b_gb (never read, rot=0) leads; the older-read a_gb comes before the newer c_gb', plan[0].cmpid === 'b_gb' && plan[1].cmpid === 'a_gb');
t('k caps the plan size', ROAS.planPulls(roster3, {}, 1, 0).length === 1);
// SUBREQUEST BUDGET: a firing has ~50 subrequests. Per market: one MCP call per window + get
// record + put record + put idx; per firing: initialize + initialized + status get/put + idx get.
t('ROAS_PULLS x (windows + 4 KV) + 5 fits one firing\'s ~50-subrequest budget', ROAS.ROAS_PULLS * (ROAS.ROAS_WINDOWS.length + 4) + 5 <= 50);

console.log('· three windows — the periods Google Ads switches between, each its own FeedHero read');
t('7 / 30 / 90 days, in FeedHero\'s own period tokens; 30 days is the default', ROAS.ROAS_WINDOWS.map((w) => w.k + ':' + w.period).join(',') === 'w7:7_days,w30:30_days,w90:90_days' && ROAS.ROAS_DEFAULT_WIN === 'w30');

console.log('· history — the trailing figure AS READ EACH DAY, one point a day');
const T = ROAS.normRow(superdryGbTotal), T2 = ROAS.normRow(Object.assign({}, superdryGbTotal, { spend: '£50,000.00', revenue: '£400,000.00' }));
let hist = ROAS.histAdd([], '2026-09-10', { w7: T, w30: T, w90: T });
hist = ROAS.histAdd(hist, '2026-09-17', { w7: T, w30: T2, w90: T });
hist = ROAS.histAdd(hist, '2026-09-17', { w7: T, w30: T2, w90: T });   // a second read the same day
t('histPoint is the compact [spend, revenue, conv, clicks, impr, skus, zombie] column set', JSON.stringify(ROAS.histPoint(T)) === JSON.stringify([41794.42, 480072.16, 6585.04, 204985, 14477612, 64469, 48.06]) && ROAS.HIST_COLS.join(',') === 'sp,rv,cv,ck,im,sk,zb');
t('a re-read the same day REPLACES the day\'s point — four reads a day leave one point', hist.length === 2 && hist[1].d === '2026-09-17');
t('points sort by day and carry the market\'s currency', hist[0].d === '2026-09-10' && hist[0].cur === '£');
t('the history is capped to the newest N', ROAS.histAdd(hist, '2026-09-18', { w30: T }, 2).map((e) => e.d).join(',') === '2026-09-17,2026-09-18');
t('pointOf names the columns and derives ROAS from revenue / spend — the one rate history carries', ROAS.pointOf(hist[1], 'w30').sp === 50000 && ROAS.pointOf(hist[1], 'w30').roas === 800 && ROAS.pointOf(hist[1], 'w7').roas === 1148.65);
t('a window never read that day reads as no point, not zeros', ROAS.pointOf(ROAS.histAdd([], '2026-09-01', { w30: T })[0], 'w7') === null);
t('backPoint = the reading at or before 7 days earlier; null while the record is younger', ROAS.backPoint(hist, 'w30', 7).d === '2026-09-10' && ROAS.backPoint(hist, 'w30', 8) === null && ROAS.backPoint([hist[1]], 'w30', 7) === null);
t('deltaPct is null against nothing or against zero — never a guessed change', ROAS.deltaPct(120, 100) === 20 && ROAS.deltaPct(120, 0) === null && ROAS.deltaPct(null, 100) === null && ROAS.deltaPct(80, 100) === -20);

console.log('· idxEntry — the one index record, v1 shape kept flat + the windows + the spark');
const entry = ROAS.idxEntry({ client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', updated: Date.parse('2026-09-17T10:00:00Z') }, { w7: T, w30: T2, w90: T }, hist);
t('the 30-day Total stays FLAT on the entry (spend/band at the top level, the v1 shape)', entry.spend.n === 50000 && entry.band === 'Strong' && entry.client === 'Superdry');
t('w7 / w30 / w90 sit beside it, the spark carries the history, day = the read\'s UTC day', entry.w7.spend.n === 41794.42 && entry.w90.spend.n === 41794.42 && entry.spark.length === 2 && entry.day === '2026-09-17' && entry.cur === '£');
const entry2 = ROAS.idxEntry({ client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', updated: Date.parse('2026-09-18T10:00:00Z') }, { w7: T, w30: T2, w90: T }, hist);
t('sig excludes updated / day / spark — an unchanged reading on a new day keeps its sig (the day decides the write)', entry.sig === entry2.sig && entry.day !== entry2.day);
t('windowTotal reads a v1 flat entry as its 30-day Total and nothing for the other windows', ROAS.windowTotal(Object.assign({ client: 'X' }, T), 'w30').spend.n === 41794.42 && ROAS.windowTotal(Object.assign({ client: 'X' }, T), 'w7') === null && ROAS.windowTotal(entry, 'w7').spend.n === 41794.42);
t('the spark is capped at ROAS_SPARK_DAYS while the record keeps ROAS_HIST_DAYS', ROAS.ROAS_SPARK_DAYS < ROAS.ROAS_HIST_DAYS && ROAS.idxEntry({ cmpid: 'x', updated: 0 }, {}, Array.from({ length: 100 }, (_, i) => ({ d: 'd' + i }))).spark.length === ROAS.ROAS_SPARK_DAYS);

console.log('· catTree — FeedHero\'s "A > B > C" paths, every level already its own aggregate row');
const cats = ['Women', 'Women > Clothing', 'Women > Clothing > Jackets', 'Men', 'Kids > Shoes > Boots'].map((p, i) => ROAS.normRow({ cmpid: 'x', category: p, spend: '£' + (100 - i * 10) + '.00' }));
const tree = ROAS.catTree(cats.slice().reverse());
t('roots are the top-level paths, children hang under their parent, sorted by spend', tree.map((n) => n.name).join(',') === 'Women,Men,Kids > Shoes > Boots' && tree[0].kids[0].name === 'Clothing' && tree[0].kids[0].kids[0].name === 'Jackets');
t('a child whose parent was capped away hangs at the root under its FULL path — never summed into an invented parent', tree[2].path === 'Kids > Shoes > Boots' && tree[2].depth === 3 && tree[2].kids.length === 0);
t('nothing is summed — every node\'s row is FeedHero\'s own aggregate', tree[0].row.spend.n === 100 && tree[0].kids[0].row.spend.n === 90);
t('flattenTree walks parents before children with their depth', ROAS.flattenTree(tree).map((x) => x.depth + ':' + x.node.name).join(',') === '0:Women,1:Clothing,2:Jackets,0:Men,0:Kids > Shoes > Boots');

console.log('· brandRollup / bookKpis — currency never crosses a boundary');
const idxRows = [
  Object.assign({ client: 'Superdry', market: 'GB', updated: 100 }, ROAS.normRow(superdryGbTotal)),
  Object.assign({ client: 'Superdry', market: 'DE', updated: 200 }, ROAS.normRow({ cmpid: 'superdry_de', category: 'Total', skus: '62,253', zombie: '52.95%', revenue: '€369,851.24', spend: '€53,253.13', roas: '694.52%', band: 'Strong', updated: '' })),
  Object.assign({ client: 'Reiss', market: 'EU', updated: 300 }, ROAS.normRow(reissEuZero)),
];
const brands = ROAS.brandRollup(idxRows);
const sd = brands.find((b) => b.client === 'Superdry');
t('a brand\'s spend stays split by currency — £ and € never combine', sd.spendByCur['£'] === 41794.42 && sd.spendByCur['€'] === 53253.13);
t('blended ROAS% is null once a brand spans more than one currency', sd.roasPct === null);
t('byCur carries each currency\'s own population — n, sums, the rates the scorecards derive from, its band tally', sd.byCur['£'].n === 1 && sd.byCur['£'].roas === 1148.65 && sd.byCur['€'].sp === 53253.13 && sd.byCur['£'].bands.Strong === 1 && sd.byCur['£'].zb === 48.06);
const reiss = brands.find((b) => b.client === 'Reiss');
t('a null band (no traffic) never counts toward the band tally', Object.keys(reiss.bandCounts).length === 0);
t('brands sort alphabetically for a stable table', brands.map((b) => b.client).join(',') === 'Reiss,Superdry');
const book = ROAS.bookKpis(brands);
t('book KPIs sum per currency across brands, never across currencies', book.spendByCur['£'] === 41794.42 && book.spendByCur['€'] === 53253.13 && book.marketsRead === 3);
t('the book\'s byCur is the same per-currency population summed across brands', book.byCur['€'].n === 2 && book.byCur['€'].sp === 53253.13 && book.byCur['€'].bands.Strong === 1);
t('a brand with zero markets read is not silently counted as "read"', book.brandsRead === 2);
t('brandRollup takes a window: a v1 flat entry asked for w7 is read with NO reading, not zeros', ROAS.brandRollup(idxRows, 'w7')[1].markets[0].has === false && Object.keys(ROAS.brandRollup(idxRows, 'w7')[1].spendByCur).length === 0);

console.log('· seriesFor / movers — per-currency daily sums off the sparks; a delta only against a real earlier reading');
const gb2 = ROAS.idxEntry({ client: 'Schuh', market: 'GB', cmpid: 'schuh_uk_1', updated: Date.parse('2026-09-17T11:00:00Z') }, { w7: T, w30: T, w90: T }, ROAS.histAdd([], '2026-09-17', { w7: T, w30: T, w90: T }));
const de = ROAS.idxEntry({ client: 'Superdry', market: 'DE', cmpid: 'superdry_de', updated: Date.parse('2026-09-17T11:00:00Z') }, { w30: ROAS.normRow({ cmpid: 'superdry_de', category: 'Total', revenue: '€369,851.24', spend: '€53,253.13' }) }, ROAS.histAdd([], '2026-09-17', { w30: ROAS.normRow({ cmpid: 'superdry_de', category: 'Total', revenue: '€369,851.24', spend: '€53,253.13' }) }));
const ser = ROAS.seriesFor([entry, gb2, de], 'w30', '£');
t('the £ series sums only £ markets, day by day, with n = markets contributing that day', ser.length === 2 && ser[0].d === '2026-09-10' && ser[0].n === 1 && ser[1].n === 2 && ser[1].sp === 91794.42 && ser[1].roas === 958.74);
t('idxEntry keys the entry on the MARKET\'s cmpid — the Total row\'s own cmpid field never overwrites it', gb2.cmpid === 'schuh_uk_1' && gb2.client === 'Schuh');
t('the every-market series (cur null) carries counts but NO money — a sum across £ and € is not a number', ROAS.seriesFor([entry, gb2, de], 'w30', null)[1].n === 3 && ROAS.seriesFor([entry, gb2, de], 'w30', null)[1].sp === null && ROAS.seriesFor([entry, gb2, de], 'w30', null)[1].ck === 409970);
const mv = ROAS.movers([entry, gb2, de], 'w30', 7);
t('a market with a reading 7 days older than its latest carries deltas; one read today for the first time carries null, never 0%', mv.find((m) => m.cmpid === 'superdry_gb').dSp === 19.63 && mv.find((m) => m.cmpid === 'schuh_uk_1').dRv === null && mv.find((m) => m.cmpid === 'schuh_uk_1').prevD === null);
t('movers keep the currency and band beside the figures and sort by revenue (Schuh GB\'s £480k leads Superdry GB\'s £400k)', mv[0].cmpid === 'schuh_uk_1' && mv[0].cur === '£' && mv[0].band === 'Strong' && mv[1].cmpid === 'superdry_gb' && mv.find((m) => m.cmpid === 'superdry_de').cur === '€');
t('marketView exposes exactly what the index holds per window plus the spark', ROAS.marketView(entry).w7.spend.n === 41794.42 && ROAS.marketView(entry).spark.length === 2 && ROAS.marketView(Object.assign({ client: 'X', market: 'GB', cmpid: 'x' }, T)).w30.spend.n === 41794.42);

console.log('· a market with NO Total row (live bug, 23 Sep 2026 — Ray: "ROAS data is unavailable")');
// A market with zero Google Ads activity in FeedHero's window returns no Total row at all, so a
// record built from it (before the roasStore fix) carried client/market/cmpid/updated and NOTHING
// else — no .spend, no .revenue. brandRollup's market sort read c.spend.n straight off that record
// and threw, which the worker never caught: GET /api/roas 500'd, the page's fetch failed to parse
// JSON, and the table showed "ROAS data is unavailable" for every brand although the sync itself
// (roasPull writing roasidx) had succeeded for all 57 markets — a write-side success masking a
// read-side crash. A record missing .spend must never reach here in practice (roasStore's fix),
// but brandRollup stays defensive regardless — a shape it cannot control must never crash the read.
const noTotalRow = { client: 'Reiss', market: 'IL', cmpid: 'reiss_il', updated: 500 };
let threw = false;
let brokenBrands = [];
try { brokenBrands = ROAS.brandRollup([noTotalRow, Object.assign({ client: 'Reiss', market: 'GB', updated: 600 }, ROAS.normRow(superdryGbTotal))]); }
catch (e) { threw = true; }
t('a market record with no .spend/.revenue never crashes brandRollup\'s sort', !threw);
t('that market still appears in the rollup (read, just with no ad data)', !threw && brokenBrands[0] && brokenBrands[0].markets.some((m) => m.market === 'IL'));
let threw2 = false; try { ROAS.seriesFor([noTotalRow], 'w30', '£'); ROAS.movers([noTotalRow], 'w30'); ROAS.marketView(noTotalRow); } catch (e) { threw2 = true; }
t('nor seriesFor / movers / marketView', !threw2);

console.log('· worker wiring');
t('roasMcp is authenticated with its OWN secret, not TM_MCP_TOKEN', /env\.ROAS_MCP_TOKEN/.test(WK) && /env\.ROAS_MCP_URL \|\| ROAS\.ROAS_MCP_URL/.test(WK));
t('roasPull degrades honestly before the secret is set (no_token), like tmPull', /ROAS_MCP_TOKEN not set/.test(WK) && /state: 'no_token'/.test(WK));
t('every market is read once PER WINDOW with FeedHero\'s own period token', /for \(const w of ROAS\.ROAS_WINDOWS\)/.test(WK) && /period: w\.period/.test(WK) && /w\.k === ROAS\.ROAS_DEFAULT_WIN \? ROAS\.ROAS_KEEP_CATS : ROAS\.ROAS_KEEP_CATS_ALT/.test(WK));
t('roasStore carries the record\'s history forward (histAdd) and writes the idxEntry; the idx is read ONCE per pull', /ROAS\.histAdd\(\(prev && prev\.hist\) \|\| \[\]/.test(WK) && /ROAS\.idxEntry\(/.test(WK) && /const idx = \(await env\.EDITS\.get\('roasidx', 'json'\)\) \|\| \{\};\s*let changed = 0;/.test(WK));
t('an unchanged reading on the SAME day is not re-written; a new day always is (its point is needed)', /idx\[cmpid\]\.sig === entry\.sig && idx\[cmpid\]\.day === entry\.day\) return \{ changed: false \}/.test(WK));
t('GET /api/roas is scoped per signin (owner = whole roster; a scoped signin only their clients)', /path === '\/api\/roas' && request\.method === 'GET'/.test(WK) && /const inScope = \(name\) => acc\.owner \|\| clientMatch\(acc\.clients, name\)/.test(WK) && /if \(!inScope\(one\)\) return json\(\{ ok: false, error: 'out of scope' \}, 403\)/.test(WK));
t('?brand= narrows the SAME shape (never a second rollup in the page) and is scope-checked too', /if \(brandQ && !inScope\(brandQ\)\) return json/.test(WK) && /\(!brandQ \|\| r\.client === brandQ\) && \(!mktQ \|\| r\.market === mktQ\)/.test(WK));
t('the book carries every window\'s rollup, the per-currency series (+ the every-market one) and the movers', /brands\[k\] = ROAS\.brandRollup\(rows, k\)/.test(WK) && /series\[k\] = \{ '\*': ROAS\.seriesFor\(rows, k, null\) \}/.test(WK) && /moversBy\[k\] = ROAS\.movers\(rows, k, ROAS\.ROAS_DELTA_BACK\)/.test(WK));
t('?client=&market=&win= serves ONE market\'s category tree — a 30-market brand is never sent whole', /tree: ROAS\.catTree\(cats\)/.test(WK) && /const mkt = url\.searchParams\.get\('market'\)/.test(WK));
t('?pull=1 on /api/roas is owner-only, like /api/tm, and capped at 6 markets a call for the budget', new RegExp("path === '/api/roas'[\\s\\S]{0,1200}realOwner\\(env, request\\)").test(WK) && /Math\.min\(6, Math\.max\(0, \+url\.searchParams\.get\('pulls'\)/.test(WK));
t('GET /api/roas/live cuts one market by Brand / Gender / Price group live, roster-only, scoped, cached six hours', /path === '\/api\/roas\/live' && request\.method === 'GET'/.test(WK) && /const who2 = ROAS\.cmpidBrand\(cmpid\)/.test(WK) && /\['Brand', 'Gender', 'Price_group', 'Category'\]/.test(WK) && /6 \* 3600000/.test(WK) && /aggregation: agg/.test(WK));
t('the ROAS cron runs on its OWN firing, not the TM one, so subrequest budgets never compete', /event\.cron === '10,40 \* \* \* \*'/.test(WK) && /await roasPull\(env\)/.test(WK));
t('roasStore writes roasidx (the /api/roas rollup) and roas:<cmpid> (the per-market detail /api/roas?client= reads)', /env\.EDITS\.put\('roas:' \+ cmpid/.test(WK) && /env\.EDITS\.put\('roasidx'/.test(WK));
t('the /roas page is registered in PAGES and gated the same way every other module is (access.js MODULES)', /'\/roas':\s*\{\s*html:\s*ROAS_PAGE,\s*slug:\s*'roas'\s*\}/.test(WK) && /slug: 'roas', label: 'ROAS', path: '\/roas'/.test(read('cloudflare/feedspark-deck/src/access.js')));

console.log('· the page — Google Ads\' reporting feature set, one currency at a time, never a dual axis');
t('a brand select the hours badge follows, a period switch, a currency select, sync, CSV and saved views', /<select class="fld" id="brand"/.test(PAGE) && /id="win" role="group"/.test(PAGE) && /<select class="fld" id="cur"/.test(PAGE) && /id="sync-now"/.test(PAGE) && /id="csv"/.test(PAGE) && /id="views-btn"/.test(PAGE));
t('scorecards: the twelve Google Ads metrics, each a value + delta vs 7 days ago + sparkline, clickable into the trend', /id="sc-row"/.test(PAGE) && /\{k:'sp',l:'Spend'/.test(PAGE) && /\{k:'zb',l:'Zombie SKUs'/.test(PAGE) && /vs '\+BACK\+'d ago/.test(PAGE) && /no history yet/.test(PAGE));
t('the trend plots up to TWO metrics as two stacked panels on one calendar — never two y-axes on one plot', /S\.metrics\.length>2\)S\.metrics\.shift\(\)/.test(PAGE) && /each on its own axis/.test(PAGE) && !/yAxis2|axis2|secondary axis|y2=/.test(PAGE.replace(/y2="[^"]*"/g, '')) && (PAGE.match(/class="tr-panel"/g) || []).length === 2);
t('every figure runs on ONE currency\'s markets — the scorecards read book.byCur[S.cur] and the series the same currency', /var by=agg\(\), a=S\.cur&&by\[S\.cur\]/.test(PAGE) && /return \(S\.cur&&s\[S\.cur\]\)\|\|\[\]/.test(PAGE));
t('the table drills brand → market → category with sortable headers, a text filter, band chips, a column chooser and per-currency Total rows', /type:'brand',key:bk,depth:0/.test(PAGE) && /type:'market',key:mk,depth:1/.test(PAGE) && /function catRows\(/.test(PAGE) && /id="q" type="search"/.test(PAGE) && /id="bands"/.test(PAGE) && /id="cols-pop"/.test(PAGE) && /Total · '\+esc\(c\)\+' markets/.test(PAGE) && /fcc-roas-cols/.test(PAGE));
t('segments: Category from the store, Brand / Gender / Price group live from /api/roas/live', /Segment · Price group/.test(PAGE) && /\/api\/roas\/live\?cmpid=/.test(PAGE) && /\/api\/roas\?client='\+encodeURIComponent\(m\.client\)\+'&market='/.test(PAGE));
t('⚡ Sync now walks the whole roster (loops ceil(roster / per-call)), never trusting `read` which is every market ever read', /need=Math\.min\(16,Math\.ceil\(\(s\.total\|\|per\)\/per\)\)/.test(PAGE) && /if\(n<need\)/.test(PAGE));
t('bars = share of the parent\'s same-currency total, movers split rising / falling with the band beside each', /share of the parent/.test(PAGE) && /Rising · revenue/.test(PAGE) && /Falling · revenue/.test(PAGE));
t('the dark steps are the FCC\'s validated chart pair; the scorecard row scrolls sideways so the phone never overflows', /#4C82E0','#C67B28'\]:\['#2563EB','#ED6F0B'\]/.test(PAGE) && /\.sc-row\{display:flex;gap:12px;overflow-x:auto/.test(PAGE) && /\.tscroll\{overflow:auto/.test(PAGE));
t('the multi-sentence explainers collapse behind ⓘ (data-instr); no control hides under a max-width rule', /<p class="sub" data-instr>/.test(PAGE) && !/@media\(max-width:[^)]*\)[^}]*display:none/.test(PAGE.replace(/\.tb-tag\{display:none\}/, '')));
t('the browser tripwires feed /roas the synthetic stub so the charts and table render under their rules', /roas_stub\.js/.test(read('tools/check_mobile.js')) && /roas_stub\.js/.test(read('tools/check_darkmode.js')) && /ROAS_STUB/.test(read('tools/check_mobile.js')));

console.log('· deploy config');
t('wrangler.toml carries the new cron firing and no others were dropped', WRANGLER.indexOf('10,40 * * * *') > 0 && WRANGLER.indexOf('15,45 * * * *') > 0 && WRANGLER.indexOf('0 7,17 * * *') > 0);

console.log('· no client commercial data in git');
t('no committed spend/revenue snapshot, seed or seed builder — the figures live in KV only', !fs.existsSync(new URL('../ops/roas', import.meta.url)) && !fs.existsSync(new URL('../docs/roas_seed.json', import.meta.url)) && !fs.existsSync(new URL('../tools/roas_build_seed.mjs', import.meta.url)) && !/ROAS_SEED/.test(WK));
t('the tripwire stub is synthetic — two brands, numbers no report ever printed', /Nothing here is a real figure/.test(read('tools/roas_stub.js')) && !/reiss_gb|monsoon|yumove|hobbycraft/i.test(read('tools/roas_stub.js')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
