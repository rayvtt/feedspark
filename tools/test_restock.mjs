// RESTOCK harness (pure node, CI-safe). Ray, 7 Oct 2026: "feedhero-reports have got By Products report - and
// 'Restock products' is interesting to build as a module".
//
// Pins the browser engine (docs/restock_engine.js) on a SYNTHETIC feed shaped like the real ones — the Feed Lab
// parser on an XML item, the availability vocabulary, the case-blind join against FeedHero's Ads Traffic rows,
// sums that never cross a currency, the category rollup, the ledger read-back and the observation the page
// reports; the server half (src/restock.js): the ledger's episodes, purge, cap and sanitiser; the Catalogue's Ads
// lane LIFTED out of worker.js and driven by PERIOD against a stub MCP; the routes, the registries, the nav on
// every page, the stub + gate wiring; and that nothing of a client's is committed.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as ROAS from '../cloudflare/feedspark-deck/src/roas.js';
import * as RS from '../cloudflare/feedspark-deck/src/restock.js';
import { MODULES, MODULE_PATHS, moduleAllowed } from '../cloudflare/feedspark-deck/src/access.js';
import { MIG_SEED } from '../cloudflare/feedspark-deck/src/migration.js';
const require = createRequire(import.meta.url);
const E = require('../docs/restock_engine.js');
const FA = require('../docs/feedlab_engine.js');
const { covered } = require('./check_textmodules.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), PG = read('docs/FeedSpark_Restock.html'), TX = read('docs/FeedSpark_Transformation.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + (typeof why === 'string' ? why : JSON.stringify(why)) : '')); } };
const DAY = 86400000, NOW = Date.UTC(2026, 9, 7, 9);

// ---- fixtures: a FeedHero-shaped output feed, as the Feed Lab parser hands it over --------------------------------
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" xmlns:c="http://base.google.com/cns/1.0" version="2.0"><channel><title>fixture</title>
<item><g:id>SKU-100-8</g:id><title>Northwind Navy Linen Midi Dress, Size 8</title><link>https://shop.example/p/100</link><g:image_link>https://cdn.example/100.jpg</g:image_link><g:availability>in stock</g:availability><g:price>95.00 GBP</g:price><g:sale_price>76.00 GBP</g:sale_price><g:product_type>Womens &gt; Clothing &gt; Dresses</g:product_type><g:product_type>linen dress</g:product_type><g:brand>Northwind</g:brand><g:item_group_id>100</g:item_group_id><c:fs_data_opti type="string">T:Y</c:fs_data_opti></item>
<item><g:id>SKU-200</g:id><title>Northwind Canvas Tote</title><link>https://shop.example/p/200</link><g:image_link>https://cdn.example/200.jpg</g:image_link><g:availability>out of stock</g:availability><g:price>40.00 GBP</g:price><g:product_type>Womens &gt; Accessories &gt; Bags</g:product_type><g:brand>Northwind</g:brand></item>
<item><g:id>SKU-300</g:id><title>Northwind Straw Hat</title><g:availability>preorder</g:availability><g:price>18.00 GBP</g:price><g:product_type>Womens &gt; Accessories &gt; Hats</g:product_type></item>
<item><g:id>SKU-400</g:id><title>Northwind Wool Scarf</title><g:price>22.00 GBP</g:price><g:product_type>Womens &gt; Accessories &gt; Scarves</g:product_type></item>
<item><g:id>SKU-500</g:id><title>Northwind Cardigan</title><g:availability>OUT_OF_STOCK</g:availability><g:price>60.00 GBP</g:price><g:product_type>Mens &gt; Knitwear</g:product_type></item>
</channel></rss>`;
const ADS = { 'SKU-100-8': [1000, 40, 12.5, 3, 228], 'sku-200': [800, 30, 9, 2, 80], 'SKU-300': [200, 4, 1, 0, 0], 'SKU-400': [150, 2, 0.5, 0, 0], 'SKU-500': [600, 25, 7, 1, 60], 'GONE-1': [900, 36, 10, 2, 120], 'GONE-2': [50, 1, 0.2, 0, 0], bad: [1, 2] };
function feedMapOf(xml) {
  const fm = new Map(); let P = null, n = 0, N = 0;
  const parser = FA.createXmlParser((row, h) => { if (!P) { P = E.plan(h || row); n = (h || row).length; return; } if (h && h.length !== n) { P = E.plan(h); n = h.length; } const f = E.feedRow(P, row); if (!f) return; N++; const k = E.adsKey(f.id); if (!fm.has(k)) fm.set(k, f); });
  parser.push(xml); parser.end();
  return { fm, N, P };
}

console.log('· availability — the feed\'s word, four states, never a guess');
t('in stock / instock / IN_STOCK / available / limited availability → in', ['in stock', 'instock', 'IN_STOCK', 'available', 'Limited availability', 'yes'].every((v) => E.availState(v) === 'in'));
t('preorder / backorder → pre (buyable, the shopper waits)', ['preorder', 'pre-order', 'backorder', 'back order'].every((v) => E.availState(v) === 'pre'));
t('out of stock / OUT_OF_STOCK / sold out / unavailable / discontinued → out', ['out of stock', 'OUT_OF_STOCK', 'Sold Out', 'unavailable', 'discontinued', 'no'].every((v) => E.availState(v) === 'out'));
t('no word, or a word the vocabulary cannot read, is NOT STATED — its own bucket', E.availState('') === 'na' && E.availState(null) === 'na' && E.availState('maybe later') === 'na');

console.log('· the feed\'s columns, read by name');
{
  const P = E.plan(['g:id', 'title', 'link', 'g:image_link', 'g:availability', 'g:price', 'g:sale_price', 'g:product_type', 'g:product_type(2)', 'g:brand', 'g:item_group_id', 'c:fs_data_opti type="string"']);
  t('every column the module needs resolves, the g: prefix and a type attribute stripped', P.id === 0 && P.title === 1 && P.link === 2 && P.image === 3 && P.avail === 4 && P.price === 5 && P.sale === 6 && P.pt === 7 && P.brand === 9 && P.grp === 10);
  t('a repeated product_type takes its FIRST slot only (the numbered slots are keywords)', P.pt === 7 && E.hkey('g:product_type(2)').rep === 2);
  t('a sheet names its columns its own way: id / availability / image_link', (() => { const Q = E.plan(['id', 'title', 'availability', 'image_link', 'product type']); return Q.id === 0 && Q.avail === 2 && Q.image === 3 && Q.pt === 4; })());
  t('the top-level category: "Womens > Clothing > Dresses" → Womens; "a/b" → a; none → ""', E.topLevel('Womens > Clothing > Dresses') === 'Womens' && E.topLevel('a/b') === 'a' && E.topLevel('') === '');
}

console.log('· the join — Google Ads\' demand placed by the feed\'s word on it');
const { fm, N } = feedMapOf(XML);
const rows = E.join(fm, ADS);
const by = {}; rows.forEach((r) => { by[r.id] = r; });
t('the real Feed Lab parser streams the fixture: five products, every one keyed', N === 5 && fm.size === 5 && fm.get('sku-200').av === 'out' && fm.get('sku-300').av === 'pre');
t('a malformed Ads row (fewer than five sums) is dropped; seven demanded products placed', rows.length === 7 && !by.bad);
t('in stock → buyable; pre-order → buyable', by['SKU-100-8'].st === 'live' && by['SKU-300'].st === 'live');
t('out of stock (either spelling) → out of stock in the feed', by['SKU-200'].st === 'oos' && by['SKU-500'].st === 'oos');
t('no availability word → not stated, never out of stock', by['SKU-400'].st === 'na');
t('a demanded id no feed product carries → not in the feed (FeedHero\'s "Unlisted SKUs in Ads traffic")', by['GONE-1'].st === 'gone' && by['GONE-2'].st === 'gone' && by['GONE-1'].f === null);
t('the join is CASE-BLIND and the row keeps the FEED\'s own id spelling', by['SKU-200'] && by['SKU-200'].key === 'sku-200' && fm.get(E.adsKey('Sku-200')).id === 'SKU-200');
t('the sums ride the row as numbers', by['SKU-100-8'].impr === 1000 && by['SKU-100-8'].value === 228 && by['GONE-2'].conv === 0);
const un = rows.filter(E.isUnavail);
t('unavailable = out of stock + gone, never not-stated or buyable', un.length === 4 && un.every((r) => r.st === 'oos' || r.st === 'gone'));
t('ranked biggest demand first: conversion value, then conversions, clicks, impressions', E.rank(un).map((r) => r.id).join(',') === 'GONE-1,SKU-200,SKU-500,GONE-2');

console.log('· the figures — one currency or none');
{
  const s = E.summary(rows, 'GBP', false);
  t('counts: 7 served · 2 buyable · 2 out of stock · 2 gone · 1 not stated · 4 unavailable', s.demanded === 7 && s.live === 2 && s.oos === 2 && s.gone === 2 && s.na === 1 && s.unavail === 4);
  t('impressions, clicks and conversions summed over the unavailable products', s.impr === 2350 && s.clicks === 92 && s.conv === 5 && s.imprAll === 3700);
  t('money summed over the unavailable products, and the share of the market\'s conversion value they carried', s.money && s.money.value === 260 && s.money.cost === 26.2 && s.money.valueAll === 488 && Math.abs(s.share - 260 / 488) < 1e-9 && s.cur === 'GBP');
  const m = E.summary(rows, 'GBP', true);
  t('a read in two currencies: counts yes, MONEY NO (null, never a sum of pounds and euros)', m.money === null && m.share === null && m.curMix === true && m.unavail === 4);
  const e = E.summary([], 'GBP', false);
  t('an empty read: zeros, a share of nothing is null', e.demanded === 0 && e.money.value === 0 && e.share === null);
}

console.log('· where the lost demand sits');
{
  const c = E.byCategory(rows, 8);
  t('by the feed\'s top-level category, biggest value first; a gone product sits under "No longer in the feed"', c.map((x) => x.pt).join('|') === 'No longer in the feed|Womens|Mens' && c[0].value === 120 && c[0].n === 2 && c[1].value === 80 && c[2].value === 60);
  const many = {}; for (let i = 0; i < 12; i++) many['x' + i] = [10, 1, 1, 1, 100 - i];
  const fmx = new Map(); for (let i = 0; i < 12; i++) fmx.set('x' + i, { id: 'x' + i, av: 'out', pt: 'Cat' + i });
  const c2 = E.byCategory(E.join(fmx, many), 8);
  t('past eight categories the tail folds into "Other (N more)" carrying its figures', c2.length === 9 && c2[8].other && c2[8].pt === 'Other (4 more)' && c2[8].n === 4 && c2[8].value === 89 + 90 + 91 + 92);
  t('nothing unavailable → an empty list, never a row of zeros', E.byCategory(rows.filter((r) => !E.isUnavail(r)), 8).length === 0);
}

console.log('· the ledger read back onto the rows, and what came back');
{
  const L = { v: 1, t0: NOW - 20 * DAY, t: NOW - DAY, n: 3, p: { 'SKU-200': [NOW - 12 * DAY, NOW - DAY, 'o', 0], 'GONE-1': [NOW - 5 * DAY, NOW - DAY, 'g', 0], 'SKU-100-8': [NOW - 9 * DAY, NOW - 3 * DAY, 'o', NOW - 2 * DAY], 'SKU-300': [NOW - 6 * DAY, NOW - DAY, 'o', 0], 'SKU-500': [NOW - 2 * DAY, NOW - 2 * DAY, 'o', NOW - DAY] } };
  const R = E.join(fm, ADS); E.withLedger(R, L, NOW);
  const b = {}; R.forEach((r) => { b[r.id] = r; });
  t('days unavailable are read off the ledger\'s FIRST SEEN: 12 for the tote, 5 for the gone product', b['SKU-200'].since === 12 && b['GONE-1'].since === 5 && b['SKU-200'].first === NOW - 12 * DAY);
  t('an unavailable product the ledger never saw has no days yet (null → "first seen today"), never 0 days claimed', b['GONE-2'].since === null);
  t('a buyable product carries no days, even with a ledger entry', b['SKU-100-8'].since === null && b['SKU-300'].since === null);
  t('an entry already stamped as returned gives no days to a product out AGAIN (a new episode starts at the next observation)', b['SKU-500'].since === null);
  const back = E.backRows(fm, E.adsIndex(ADS), L, NOW);
  t('back in stock = ledger products the feed carries IN STOCK or pre-order now: the dress (stamped back) and the hat (seen returning now)', back.map((r) => r.id).sort().join(',') === 'SKU-100-8,SKU-300' && back.every((r) => r.st === 'live'));
  const dress = back.find((r) => r.id === 'SKU-100-8'), hat = back.find((r) => r.id === 'SKU-300');
  t('each carries what it was, how long it was out, and its demand', dress.was === 'oos' && dress.outDays === 7 && dress.back === NOW - 2 * DAY && dress.value === 228 && hat.back === 0 && hat.outDays === 6);
  t('a ledger product still out of stock, or gone from the feed, is not "back"', !back.find((r) => r.id === 'SKU-200') && !back.find((r) => r.id === 'GONE-1'));
  const obs = E.observation(R, fm, L, N);
  t('the observation the page reports: out-of-stock ids, gone ids, the ledger ids buyable now (not one already stamped back)', obs.oos.sort().join(',') === 'SKU-200,SKU-500' && obs.gone.sort().join(',') === 'GONE-1,GONE-2' && obs.back.join(',') === 'SKU-300' && obs.n === 7 && obs.feedN === 5);
  const csv = E.csv(E.rank(R.filter(E.isUnavail)), 'GBP', 'restock');
  const lines = csv.split('\r\n');
  t('CSV: a header naming the currency, one line per row, the title quoted where it carries a comma', lines.length === 5 && /^Product ID,State,Title,/.test(lines[0]) && lines[0].indexOf('Cost (GBP)') > 0 && lines[1].startsWith('GONE-1,Not in feed,,not in feed,5,900,36,10,2,120') && lines[2].indexOf('"') < 0);
  const csv2 = E.csv(E.rank(E.join(new Map([['sku-9', { id: 'SKU-9', av: 'out', title: 'A, with a comma', avRaw: 'out of stock' }]]), { 'SKU-9': [1, 1, 1, 1, 1] })), 'EUR', 'restock');
  t('a value carrying a comma is quoted', csv2.indexOf('"A, with a comma"') > 0);
  const bl = E.briefLines(R, E.summary(R, 'GBP', false), 3);
  t('the brief: counts first, money second, then the biggest first with their days and clicks', /^4 of 7 products Google Ads served in the last 30 days cannot be bought: 2 sent out of stock, 2 no longer in the feed\.$/.test(bl[0]) && /GBP 260 of conversion value \(53% of the market’s\)/.test(bl[1]) && bl[4].startsWith('- GONE-1 — Not in feed (5 d) · 36 clicks · GBP 120 value') && bl.length === 7);
  t('a mixed-currency brief says money is not summed instead of inventing a figure', /not summed/.test(E.briefLines(R, E.summary(R, 'GBP', true), 3)[1]));
}

console.log('· src/restock.js — the ledger: episodes, purge, cap, sanitiser');
{
  t('the period the demand is read over is 30 days, and the allow-list twins the worker\'s', RS.RESTOCK_PERIOD === '30_days' && RS.RESTOCK_PERIODS.indexOf('30_days') >= 0 && WK.indexOf("const CAT_ADS_PERIODS = ['7_days', '30_days'];") > 0 && JSON.stringify(RS.RESTOCK_PERIODS) === JSON.stringify(['7_days', '30_days']));
  t('the KV key is the company id, sanitised', RS.ledgerKey('superdry_gb') === 'restock:superdry_gb' && RS.ledgerKey('Bad Key/../x') === 'restock:badkeyx');
  t('cleanObs: junk → null; a body with no lists → null (a failed feed is never written as "everything came back")', RS.cleanObs(null) === null && RS.cleanObs('x') === null && RS.cleanObs({ n: 5 }) === null);
  const o = RS.cleanObs({ oos: ['A', ' A ', 'B', '', 'x'.repeat(200)], gone: ['B', 'C'], back: ['A', 'C', 'D'], n: '7', feedN: 5.4 });
  t('cleanObs: ids trimmed and deduped, an id is ONE thing (out of stock beats gone beats back), counts whole', o.oos.join(',') === 'A,B' && o.gone.join(',') === 'C' && o.back.join(',') === 'D' && o.n === 7 && o.feedN === 5);
  let L = RS.ledgerUpdate(null, RS.cleanObs({ oos: ['A', 'B'], gone: ['G'], back: ['Z'] }), NOW);
  t('a first observation starts the ledger: tracking began now, one reading, every id first seen now', L.t0 === NOW && L.n === 1 && L.t === NOW && L.p.A[0] === NOW && L.p.A[2] === 'o' && L.p.G[2] === 'g' && !L.p.Z);
  L = RS.ledgerUpdate(L, RS.cleanObs({ oos: ['A'], gone: ['B'], back: ['G'] }), NOW + 3 * DAY);
  t('still unavailable → the episode goes on, FIRST SEEN KEPT; a state can change (B out of stock → gone) without restarting it', L.p.A[0] === NOW && L.p.A[1] === NOW + 3 * DAY && L.p.B[0] === NOW && L.p.B[2] === 'g');
  t('came back → stamped, the episode kept so its length still reads', L.p.G[3] === NOW + 3 * DAY && L.p.G[0] === NOW && L.n === 2 && L.t0 === NOW);
  L = RS.ledgerUpdate(L, RS.cleanObs({ oos: ['G'], gone: [], back: [] }), NOW + 5 * DAY);
  t('back then out again → a NEW episode, first seen now', L.p.G[0] === NOW + 5 * DAY && L.p.G[3] === 0);
  L = RS.ledgerUpdate(L, RS.cleanObs({ oos: ['A'], gone: [], back: ['B'] }), NOW + 6 * DAY);
  const later = RS.ledgerUpdate(L, RS.cleanObs({ oos: ['A'], gone: [], back: [] }), NOW + 6 * DAY + (RS.RESTOCK_BACK_KEEP_DAYS + 1) * DAY);
  t('a returned product leaves the ledger after RESTOCK_BACK_KEEP_DAYS; one still out stays', !later.p.B && later.p.A);
  const stale = RS.ledgerUpdate(L, RS.cleanObs({ oos: ['A'], gone: [], back: [] }), NOW + 6 * DAY + (RS.RESTOCK_STALE_DAYS + 1) * DAY);
  t('an entry nobody has seen for RESTOCK_STALE_DAYS leaves (no longer demanded); the one just seen stays', !stale.p.G && stale.p.A);
  const big = { v: 1, t0: NOW, t: NOW, n: 1, p: {} }; for (let i = 0; i < RS.RESTOCK_CAP + 50; i++) big.p['p' + i] = [NOW - i * 1000, NOW - i * 1000, 'o', 0];
  const capped = RS.ledgerUpdate(big, RS.cleanObs({ oos: ['new'], gone: [], back: [] }), NOW + 1000);
  t('the ledger is bounded: the oldest-seen entries go first, the one just seen stays', Object.keys(capped.p).length === RS.RESTOCK_CAP && capped.p.new && !capped.p['p' + (RS.RESTOCK_CAP + 49)] && capped.p.p0);
  const junk = RS.ledgerUpdate({ v: 1, t0: NOW, t: NOW, n: 1, p: { ok: [NOW, NOW, 'o', 0], bad: [NOW], worse: 'x' } }, RS.cleanObs({ oos: [], gone: [], back: [] }), NOW + 1);
  t('a malformed entry is dropped on the way through', junk.p.ok && !junk.p.bad && !junk.p.worse);
  const sm = RS.ledgerSummary(L, NOW + 6 * DAY);
  t('the summary counts by state and dates the record', sm.oos === 2 && sm.gone === 0 && sm.back === 1 && sm.began === NOW && sm.days === 6 && sm.n === 4);
  t('daysSince never goes negative', RS.daysSince(NOW + DAY, NOW) === 0 && RS.daysSince(NOW - 2.5 * DAY, NOW) === 2);
}

console.log('· the worker — the Ads lane lifted and driven by PERIOD');
{
  const liftF = (name) => { const a = WK.indexOf('function ' + name + '('); const b = WK.indexOf('\n}\n', a); if (a < 0 || b < 0) throw new Error('cannot lift ' + name); return WK.slice(a, b + 2); };
  const liftA = (name) => { const a = WK.indexOf('async function ' + name + '('); const b = WK.indexOf('\n}\n', a); if (a < 0 || b < 0) throw new Error('cannot lift ' + name); return WK.slice(a, b + 2); };
  const consts = (WK.match(/^const CAT_ADS_[\s\S]*?;$/gm) || []).join('\n');
  const TMM = { rowsOf: (p) => (p && Array.isArray(p.rows) ? p.rows : []) };
  const kv = new Map(); const calls = [];
  const env = { ROAS_MCP_TOKEN: 'x', EDITS: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } } };
  const pageOf = (page, size, total) => ({ report: 'Ads Traffic', total_rows: total, page, pages: Math.ceil(total / size), page_size: size, info: { from: '2026-09-07', to: '2026-10-06', report_rows: total },
    rows: Array.from({ length: Math.max(0, Math.min(size, total - (page - 1) * size)) }, (_, j) => { const n = (page - 1) * size + j; return { pid: 'P' + n, c0: 'p' + n, c1: String(10 + n), c2: '1', c3: '0.5', c4: '2', c5: '0.1', cur: 'GBP' }; }) });
  const roasMcp = () => ({ init: async () => ({}), call: async (tool, a) => { calls.push(a); return pageOf(a.page, 20, 30); } });
  const src = consts.replace('CAT_ADS_SIZE = 200', 'CAT_ADS_SIZE = 20').replace('CAT_ADS_CHUNK = 24', 'CAT_ADS_CHUNK = 4') + liftF('catAdsRow') + liftA('catAdsRead') + 'return catAdsRead;';
  const A = new Function('roasMcp', 'fetch', 'TMM', src)(roasMcp, () => null, TMM);
  const r30 = await A(env, 'northwind_gb', false, '30_days');
  t('asked for 30 days, the lane calls FeedHero for 30 days and keeps its OWN record (catads:<cmpid>:30_days)', r30.state === 'ok' && r30.period === '30_days' && calls.every((c) => c.period === '30_days') && kv.has('catads:northwind_gb:30_days') && !kv.has('catads:northwind_gb:7_days'));
  const r7 = await A(env, 'northwind_gb', false);
  t('no period = the Catalogue\'s 7 days, as before — a second record, never spliced with the first', r7.period === '7_days' && kv.has('catads:northwind_gb:7_days') && calls.filter((c) => c.period === '7_days').length > 0);
  const rX = await A(env, 'northwind_gb', false, '1_year');
  t('a period outside the allow-list falls back to the default rather than asking FeedHero for it', rX.period === '7_days' && !calls.some((c) => c.period === '1_year'));
  const cached = await A(env, 'northwind_gb', false, '30_days');
  t('the 30-day record is served from KV on the next call', cached.cached && cached.period === '30_days');
}

console.log('· the worker — routes, scope, wiring');
{
  const route = WK.slice(WK.indexOf("if (path.startsWith('/api/restock/')"), WK.indexOf('// THE CATALOGUE (Ray, 28 Sep 2026'));
  t('the block is there, GET everywhere and PUT only on the ledger', route.length > 500 && /request\.method === 'GET' \|\| \(request\.method === 'PUT' && path === '\/api\/restock\/ledger'\)/.test(route));
  t('scoped like /api/catalog (accessOf → clientMatch) on every route, the roster filtered to the signin\'s clients', /const inScope = \(c\) => acc\.owner \|\| clientMatch\(acc\.clients, c\);/.test(route) && /if \(!inScope\(client\)\) return json\(\{ ok: false, error: 'out of scope' \}, 403\)/.test(route) && /filter\(\(r\) => inScope\(r\.client\) && !\/-fb\$\/\.test\(r\.mkt\)\)/.test(route));
  t('the company id comes off the WIRED output feed, never the query; a sheet-backed feed says FeedHero holds no report', /const cmpid = catCmpid\(src\);/.test(route) && /state: 'no_ads'/.test(route) && !/searchParams\.get\('cmpid'\)/.test(route));
  t('a Meta market is refused — Google Ads is the Google feed\'s', /if \(\/-fb\$\/i\.test\(mkt\)\) return json\(\{ ok: false, error: 'Google Ads is read for the Google feed/.test(route));
  t('the Ads read asks the lane for RESTOCK_PERIOD and answers 503 / 202 / missing / a chunk / the rows like the Catalogue', /catAdsRead\(env, cmpid, !!url\.searchParams\.get\('fresh'\), RESTOCK\.RESTOCK_PERIOD\)/.test(route) && /state: 'no_token'[^\n]*503/.test(route) && /state: 'preparing'[^\n]*202/.test(route) && /missing: true, done: true/.test(route) && /done: true, at: rec\.at, rows: rec\.rows/.test(route));
  t('the ledger PUT sanitises with cleanObs, refuses an empty observation, merges with ledgerUpdate and writes with the TTL', /const obs = RESTOCK\.cleanObs\(b\);/.test(route) && /if \(!obs\) return json\(\{ ok: false, error: 'no observation' \}, 400\);/.test(route) && /L = RESTOCK\.ledgerUpdate\(L, obs, now\);/.test(route) && /expirationTtl: RESTOCK\.RESTOCK_TTL_S/.test(route));
  t('the GET and the PUT answer the same shape: the ledger, its summary, the keep + stale days', /ledger: L \|\| null, summary: RESTOCK\.ledgerSummary\(L, now\), keep: RESTOCK\.RESTOCK_BACK_KEEP_DAYS, stale: RESTOCK\.RESTOCK_STALE_DAYS/.test(route));
  t('a finished read is logged once (restock-ads), the ledger write through the ACT map (restock-ledger)', /logActivity\(ctx, env, request, 'restock-ads'/.test(route) && /'\/api\/restock\/ledger': 'restock-ledger'/.test(WK));
  t('"still being prepared" is a 202 state here too, never an error', /return json\(\{ ok: false, state: 'preparing', note: msg \}, 202\);/.test(route));
  t('the module imported, the page and the engine imported and served', /import \* as RESTOCK from "\.\/restock\.js";/.test(WK) && /import RESTOCK_PAGE from "\.\.\/\.\.\/\.\.\/docs\/FeedSpark_Restock\.html";/.test(WK) && /import RESTOCK_ENGINE_SRC from "\.\.\/\.\.\/\.\.\/docs\/restock_engine\.js";/.test(WK) && /'\/restock':\s+\{ html: RESTOCK_PAGE, slug: 'restock' \}/.test(WK) && /if \(path === '\/restock\/engine\.js' && request\.method === 'GET'\)/.test(WK));
  t('the engine is a Text module (served verbatim, never bundled as ESM — the /images lesson)', covered('../../../docs/restock_engine.js'.replace(/^(\.\.\/)+/, '')) || covered('docs/restock_engine.js'));
}

console.log('· registries — grant, migration board + twin, assessment, nav on every page');
{
  const mod = MODULES.find((m) => m.slug === 'restock');
  t('a grantable module, open to an unrestricted signin (not opt-in)', mod && mod.path === '/restock' && mod.label === 'Restock' && MODULE_PATHS['/restock'] === 'restock' && moduleAllowed(null, 'restock') === true && moduleAllowed(['catalog'], 'restock') === false && moduleAllowed(['restock'], 'restock') === true);
  t('listed right after the Catalogue in MODULES (the panel\'s order)', MODULES.findIndex((m) => m.slug === 'restock') === MODULES.findIndex((m) => m.slug === 'catalog') + 1);
  const mig = MIG_SEED.find((m) => m.p === '/restock');
  t('on the migration board, wave 3, December', mig && mig.n === 'Restock' && mig.w === 3 && mig.m === '2026-12');
  t('the Transformation page carries the twin row and an assessment row', /\{p:'\/restock',n:'Restock',w:3,m:'2026-12',data:'restock/.test(TX) && /\{id:'restock',p:'\/restock',n:'Restock',ben:/.test(TX));
  const D = new URL('../docs/', import.meta.url);
  const pages = fs.readdirSync(D).filter((f) => /^FeedSpark_.*\.html$/.test(f)).filter((f) => /<nav class="tb-nav tb-modules"/.test(fs.readFileSync(new URL(f, D), 'utf8')));
  const afterStock = pages.every((f) => { const nav = fs.readFileSync(new URL(f, D), 'utf8').match(/<nav class="tb-nav tb-modules"[^>]*>([\s\S]*?)<\/nav>/)[1]; const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]); return hrefs.indexOf('/restock') === hrefs.indexOf('/stock') + 1; });
  t('the nav carries /restock right after /stock on every nav-bearing page (' + pages.length + ')', pages.length >= 30 && afterStock);
  t('the Restock page marks its own link .on and no other', (PG.match(/class="tbm on"/g) || []).length === 1 && /<a href="\/restock" class="tbm on"/.test(PG));
}

console.log('· the page');
{
  t('loads the shared stylesheet and the two engines by fetch (so the tripwires can hand them over)', /<link rel="stylesheet" href="\/design\/fcc\.css">/.test(PG) && /\['\/feedlab\/engine\.js', 'FeedAudit'\], \['\/restock\/engine\.js', 'FeedRestock'\]/.test(PG));
  t('a brand select the hours badge follows, market chips, the three views, the exits', /<select class="fld" id="brand"/.test(PG) && /id="mkts"/.test(PG) && /data-v="restock"/.test(PG) && /data-v="back"/.test(PG) && /data-v="all"/.test(PG) && /id="csv"/.test(PG) && /id="brief"/.test(PG) && /id="copy"/.test(PG) && /id="fresh"/.test(PG) && /id="fh"/.test(PG));
  t('nothing is joined against a feed that did not stream whole', /if \(S\.feed\.st !== 'done' \|\| S\.ads\.st !== 'ready'\) return;/.test(PG));
  t('the observation is reported ONCE a load, and the ledger that comes back re-stamps the rows', /if \(S\.reported \|\| g !== S\.gen\) return;\s*S\.reported = true;/.test(PG) && /method: 'PUT'/.test(PG) && /S\.led = \{ st: 'ready', L: d\.ledger \|\| null, sum: d\.summary \|\| null, keep: d\.keep \|\| S\.keep, wrote: true \};/.test(PG));
  t('a mixed-currency read is said out loud in the status line, the KPI and the split', /MIXED CURRENCIES — money not summed/.test(PG) && /Mixed currencies in the Ads read — money is not summed/.test(PG) && /money is not\./.test(PG));
  t('the FeedHero link is the MCP\'s own web_url shape (company, period, sorted by conversion value)', /mcp\.feedhero\.net\/ads-traffic' \+ \(S\.cmpid \? '\?company=' \+ encodeURIComponent\(S\.cmpid\) \+ '&period=' \+ encodeURIComponent\(S\.period\) \+ '&sort=c4&order=desc&run=1' : ''\)/.test(PG));
  t('the brief deep-links Workflow with the restock list (cat technical) and names its source', /location\.href = '\/workflow\?brief=' \+ b64url\(/.test(PG) && /'Restock - demanded, not buyable'/.test(PG) && /cat: 'technical'/.test(PG));
  t('days unavailable come from the ledger, the first reading says so rather than claiming 0', /first seen<small> today<\/small>/.test(PG) && /Tracking begins today/.test(PG));
  t('the state hook for the harness, the deep link, the per-device memory', /window\.__FCCRestock = \{ state: function \(\) \{ return S; \} \};/.test(PG) && /fcc-rs-brand/.test(PG) && /fcc-rs-mkt/.test(PG) && /VIEWS\.indexOf\(Q\.get\('view'\)\)/.test(PG));
  t('the explainers collapse behind ⓘ (data-instr), the methodology too', (PG.match(/data-instr/g) || []).length >= 2);
}

console.log('· wiring + nothing of a client\'s in git');
{
  const QA = read('tools/qa_gate.sh'), PS = read('tools/presync.sh'), VY = read('.github/workflows/validate.yml'), CM = read('tools/check_mobile.js'), CD = read('tools/check_darkmode.js'), STUB = read('tools/restock_stub.js'), MF = read('docs/feature_manifest.json'), CL = read('CLAUDE.md');
  t('the harness runs in qa_gate, presync and validate; the tripwire in presync', /node tools\/test_restock\.mjs/.test(QA) && /node tools\/test_restock\.mjs/.test(PS) && /node tools\/check_restock\.js/.test(PS) && /run: node tools\/test_restock\.mjs/.test(VY));
  t('both browser tripwires carry the stub', /const RESTOCK_STUB = require\('\.\/restock_stub\.js'\)\.stubLines\(\);/.test(CM) && /\$\{RESTOCK_STUB\}/.test(CM) && /const RESTOCK_STUB = require\('\.\/restock_stub\.js'\)\.stubLines\(\);/.test(CD) && /\$\{RESTOCK_STUB\}/.test(CD));
  t('the stub answers only on the Restock page', /if\(\/Restock\/\.test\(location\.pathname\)\)\{/.test(STUB));
  const cmpids = ROAS.rosterList().map((m) => m.cmpid);
  t('the stub names no roster company and no real product id — a synthetic brand only', !cmpids.some((c) => STUB.indexOf(c) >= 0) && STUB.indexOf('208221850057902') < 0 && PG.indexOf('208221850057902') < 0);
  t('no Ads Traffic payload is committed', !fs.existsSync(new URL('../ops/reports', import.meta.url)) || !fs.readdirSync(new URL('../ops/reports', import.meta.url)).some((f) => /ads_traffic|restock/i.test(f)));
  t('docs/RESTOCK.md, the CLAUDE.md entry and the manifest markers are in', fs.existsSync(new URL('../docs/RESTOCK.md', import.meta.url)) && /^GET  \/restock /m.test(CL) && (MF.match(/"name": "Restock: /g) || []).length >= 8);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
