// ROAS integration harness (pure node, CI-safe). SOURCE = the FeedHero_reports MCP's
// roas_dashboard / client_list tools — a DIFFERENT server from the Task Manager MCP /api/tm
// reads. Pins the pure engine (src/roas.js: parsing, the FeedSpark-only roster, the
// currency-safe rollup, the rotation planner) against real specimen rows pulled from the live
// FeedHero_reports connector on 23 Sep 2026, and the worker's wiring (route, scope, cron).
import fs from 'node:fs';
import * as ROAS from '../cloudflare/feedspark-deck/src/roas.js';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const WRANGLER = read('wrangler.toml');
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

console.log('· splitClientRows — Total found by category, not position; categories capped and spend-sorted');
const split = ROAS.splitClientRows([superdryGbCat, superdryGbTotal]);
t('the Total row is found even when it is not first in the page', split.total && split.total.category === 'Total' && split.total.roasPct === 1148.65);
t('categories exclude Total and are sorted by spend', split.categories.length === 1 && split.categories[0].category.indexOf('Puffer Jacket') >= 0);
const manyCats = Array.from({ length: 40 }, (_, i) => Object.assign({}, superdryGbCat, { category: 'Cat ' + i, spend: '£' + (i + 1) + '.00' }));
t('category rows are capped at ROAS_KEEP_CATS (30)', ROAS.splitClientRows(manyCats).categories.length === ROAS.ROAS_KEEP_CATS);

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
const reiss = brands.find((b) => b.client === 'Reiss');
t('a null band (no traffic) never counts toward the band tally', Object.keys(reiss.bandCounts).length === 0);
t('brands sort alphabetically for a stable table', brands.map((b) => b.client).join(',') === 'Reiss,Superdry');
const book = ROAS.bookKpis(brands);
t('book KPIs sum per currency across brands, never across currencies', book.spendByCur['£'] === 41794.42 && book.spendByCur['€'] === 53253.13 && book.marketsRead === 3);
t('a brand with zero markets read is not silently counted as "read"', book.brandsRead === 2);

console.log('· worker wiring');
t('roasMcp is authenticated with its OWN secret, not TM_MCP_TOKEN', /env\.ROAS_MCP_TOKEN/.test(WK) && /env\.ROAS_MCP_URL \|\| ROAS\.ROAS_MCP_URL/.test(WK));
t('roasPull degrades honestly before the secret is set (no_token), like tmPull', /ROAS_MCP_TOKEN not set/.test(WK) && /state: 'no_token'/.test(WK));
t('GET /api/roas is scoped per signin (owner = whole roster; a scoped signin only their clients)', /path === '\/api\/roas' && request\.method === 'GET'/.test(WK) && /clientMatch\(acc\.clients, one\)/.test(WK) && /out of scope/.test(WK));
t('?pull=1 on /api/roas is owner-only, like /api/tm', new RegExp("path === '/api/roas'[\\s\\S]{0,1200}realOwner\\(env, request\\)").test(WK));
t('the ROAS cron runs on its OWN firing, not the TM one, so subrequest budgets never compete', /event\.cron === '10,40 \* \* \* \*'/.test(WK) && /await roasPull\(env\)/.test(WK));
t('roasStore writes roasidx (the /api/roas rollup) and roas:<cmpid> (the per-market detail /api/roas?client= reads)', /env\.EDITS\.put\('roas:' \+ cmpid/.test(WK) && /env\.EDITS\.put\('roasidx'/.test(WK));
t('the /roas page is registered in PAGES and gated the same way every other module is (access.js MODULES)', /'\/roas':\s*\{\s*html:\s*ROAS_PAGE,\s*slug:\s*'roas'\s*\}/.test(WK) && /slug: 'roas', label: 'ROAS', path: '\/roas'/.test(read('cloudflare/feedspark-deck/src/access.js')));

console.log('· deploy config');
t('wrangler.toml carries the new cron firing and no others were dropped', WRANGLER.indexOf('10,40 * * * *') > 0 && WRANGLER.indexOf('15,45 * * * *') > 0 && WRANGLER.indexOf('0 7,17 * * *') > 0);

console.log('· no client commercial data in git');
t('no committed spend/revenue snapshot, seed or seed builder — the figures live in KV only', !fs.existsSync(new URL('../ops/roas', import.meta.url)) && !fs.existsSync(new URL('../docs/roas_seed.json', import.meta.url)) && !fs.existsSync(new URL('../tools/roas_build_seed.mjs', import.meta.url)) && !/ROAS_SEED/.test(WK));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
