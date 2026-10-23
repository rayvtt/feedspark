#!/usr/bin/env node
/*
 * Test Lab (Ray, 14 Oct 2026: "the playbook and the workflow should be a bit smarter … proactive
 * information about testing proposals, with specifics … 'How about we test A/B testing image
 * position this month?' because I have seen other brands achieve a certain uplift over the last
 * three months … consider competitors … on Google Shopping and Meta … super innovative in testing").
 *
 * Pins: the library's shape, the family read of an archive row, the uplift figures (never invented,
 * only lifted from a recorded test or a keyword round), the evidence window, the competitor read's
 * normalisation + signals, the ranking rules (ran-recently out, blocked never in the three, one
 * first-for-the-book in the three, a client brief names the industry and never a peer brand),
 * then BOTH routes lifted out of worker.js against a stub KV + a stub SerpApi, then the wiring.
 * No real client figure is used — every fixture is invented (Northwind / Harbour / Linden).
 *
 * Run: node tools/test_testlab.mjs
 */
import fs from 'node:fs';
import * as TL from '../cloudflare/feedspark-deck/src/testlab.js';
import * as SEC from '../cloudflare/feedspark-deck/src/security.js';
import * as AIVIS from '../cloudflare/feedspark-deck/src/aivis.js';
import * as RET from '../cloudflare/feedspark-deck/src/retired.js';
import { liftEnvelope } from '../cloudflare/feedspark-deck/src/kvmerge.js';
import { industryOf } from '../cloudflare/feedspark-deck/src/labelguard.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const WF = read('docs/FeedSpark_Workflow.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + JSON.stringify(why).slice(0, 300) : '')); } };

const DAY = 86400000, NOW = Date.UTC(2026, 9, 14, 12);
const dmy = (daysAgo) => { const d = new Date(NOW - daysAgo * DAY); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear(); };

console.log('── the library');
const keys = TL.TESTS.map((x) => x.k);
t('every test has a key, a name, a surface, a field, a hypothesis, a design, a metric, a family and a source', TL.TESTS.every((x) => x.k && x.n && /^(google|meta|both)$/.test(x.surf) && x.field && x.hyp && x.how && x.metric && x.fam instanceof RegExp && x.src));
t('keys are unique', new Set(keys).size === keys.length);
t('every readiness need names a check', TL.TESTS.every((x) => (x.need || []).every((k) => typeof TL.NEEDS[k] === 'function')));
t('Google forbids promotional overlays on the main image, so every overlay test is Meta-only', TL.TESTS.filter((x) => /^ovl_/.test(x.k)).every((x) => x.surf === 'meta'));
t('at least twenty specific tests, both surfaces covered', TL.TESTS.length >= 20 && TL.TESTS.some((x) => x.surf === 'meta') && TL.TESTS.some((x) => x.surf === 'google'));

console.log('── the family read of an archive row');
t('a title test is the MASK family, by type or by the parser’s own title flag', TL.familyOf({ type: 'Title', batch: 'Batch 3' }) === 'title_mask' && TL.familyOf({ type: 'Other', title: true }) === 'title_mask');
t('"Lifestyle vs packshot" is the main-image family; "Overlay price tag" the Meta overlay family; "Keyword" the keyword family', TL.familyOf({ type: 'Image', batch: 'Lifestyle vs packshot' }) === 'img_lifestyle' && TL.familyOf({ type: 'Overlay price tag' }) === 'ovl_price_meta' && TL.familyOf({ type: 'Keywords', batch: 'Oct I' }) === 'kw_theme');
t('a row no family claims is null, never a guess', TL.familyOf({ type: 'Pricing', batch: 'Batch 1' }) === null && TL.familyOf({}) === null);
t('the best metric is the largest positive up-is-good figure, with its name', JSON.stringify(TL.bestMetric({ clicks: 4.2, ctr: 12.4, impressions: -3 })) === '{"metric":"ctr","pct":12.4}' && TL.bestMetric({}) === null && TL.bestMetric({ clicks: -2 }).pct === -2);
t('a keyword line is read in both shapes, direction words honoured, a cost line never counted', JSON.stringify(TL.kwFigure('Clicks: 5.18% Increase')) === '{"metric":"clicks","pct":5.2}' && TL.kwFigure('+24.7% clicks').pct === 24.7 && TL.kwFigure('CTR down 3%').pct === -3 && TL.kwFigure('Cost per click: 2% Increase') === null && TL.kwFigure('no figure here') === null);
t('a test is dated by its live date, else its report date, else 0', TL.testWhen({ live: dmy(10) }) > 0 && TL.testWhen({ live: 'NA', reportDate: dmy(5) }) > 0 && TL.testWhen({ live: 'NA' }) === 0);

console.log('── the evidence table over the whole book');
const BOOK = [
  { brand: 'Northwind', industry: 'Fashion', tests: [
    { type: 'Image', batch: 'Lifestyle vs packshot', country: 'GB', live: dmy(40), metrics: { ctr: 12.4, clicks: 8 }, verdict: 'positive', winner: { group: 'test' } },
    { type: 'Title', batch: 'MASK', country: 'GB', live: dmy(200), metrics: { clicks: 3.1 }, verdict: 'positive', title: true },
    { type: 'Image', batch: 'Lifestyle vs packshot', country: 'DE', live: dmy(30), metrics: { ctr: -4 }, verdict: 'negative' } ] },
  { brand: 'Harbour', industry: 'Footwear', tests: [
    { type: 'Highlights', batch: 'Six highlights', country: 'GB', live: dmy(20), metrics: { conversions: 6.5 }, verdict: 'positive' },
    { type: 'Image', batch: 'Lifestyle vs packshot', country: 'GB', live: dmy(60), metrics: { ctr: 5.5 }, verdict: 'positive', winner: { group: 'test' } } ] },
  { brand: 'Linden', industry: 'Fashion', tests: [ { type: 'Colour', batch: 'Plain colour', country: 'GB', live: dmy(15), metrics: {}, verdict: 'inconclusive' } ] },
];
const KW = [ { brand: 'Harbour', industry: 'Footwear', mkt: 'gb', period: 'Sep II', when: NOW - 25 * DAY, metrics: ['Impressions: 4.63% Increase', 'Clicks: 5.18% Increase'], verdict: 'positive' },
  { brand: 'Northwind', industry: 'Fashion', mkt: 'gb', period: 'Aug I', when: NOW - 70 * DAY, metrics: ['Clicks: 2% decrease'], verdict: 'negative' } ];
const EV = TL.evidenceBook(BOOK, KW, NOW);
t('the main-image family counts every run, every win, and only wins inside three months as recent — best first', EV.img_lifestyle.n === 3 && EV.img_lifestyle.wins === 2 && EV.img_lifestyle.recent.length === 2 && EV.img_lifestyle.best.brand === 'Northwind' && EV.img_lifestyle.best.pct === 12.4 && EV.img_lifestyle.best.metric === 'ctr');
t('a win older than the window is kept apart as older, not forgotten', EV.title_mask.n === 1 && EV.title_mask.recent.length === 0 && EV.title_mask.older.length === 1 && EV.title_mask.best === null);
t('a negative or inconclusive test is a run, never a win', EV.colour_plain.n === 1 && EV.colour_plain.wins === 0);
t('keyword rounds are the keyword family’s evidence; a negative round is a run, not a win', EV.kw_theme.n === 2 && EV.kw_theme.wins === 1 && EV.kw_theme.best.brand === 'Harbour' && EV.kw_theme.best.pct === 5.2);
t('which brands ran a family, and when, is kept for the "ran recently" rule', EV.img_lifestyle.brands.Northwind > EV.img_lifestyle.brands.Harbour);

console.log('── the competitor read');
const PT = [['Women > Clothing > Dresses', 900], ['Women > Clothing > View All', 1200], ['Men > Jackets', 400], ['Women > Clothing > Dresses', 1], ['Accessories', 50], ['Kids > Shoes', 10]];
const QS = TL.compQueries(PT, 4);
t('queries are the biggest leaves, department-prefixed, deduped, generic buckets skipped', QS.map((q) => q.q).join('|') === 'womens dresses|mens jackets|kids shoes' , QS);
const SERP = { shopping_results: [
  { position: 1, title: 'Northwind Midi Dress Navy', source: 'Northwind', price: '£89', extracted_price: 89, thumbnail: 'https://encrypted-tbn0.gstatic.com/a', product_link: 'https://www.northwind.example/p/1' },
  { position: 2, title: 'Midi Wrap Dress — Harbour', source: 'Harbour', price: '£59', extracted_price: 59, old_price: '£79', extracted_old_price: 79, rating: 4.5, reviews: 120, thumbnail: 'https://encrypted-tbn0.gstatic.com/b', product_link: 'https://harbour.example/x' },
  { position: 3, title: 'Floral midi dress', source: 'Linden', extracted_price: 45, tag: 'SALE', thumbnail: 'http://insecure.example/c', product_link: 'javascript:alert(1)' },
  null, { position: 5, title: 'Satin slip dress', source: 'Atelier', extracted_price: 120, rating: 4.1 },
  { position: 6, title: 'Pleated midi dress', source: 'Atelier', extracted_price: 70, thumbnail: 'https://encrypted-tbn0.gstatic.com/d' },
  { position: 7, title: 'Ribbed knit dress', source: 'Linden', extracted_price: 55, rating: 4.7, reviews: 12 } ] };
const R = TL.normShopping(SERP, 'womens dresses');
t('a SerpApi page is reduced to the rows we keep — nothing else of it', R.n === 6 && R.rows[0].m === 'Northwind' && R.rows[1].sale && R.rows[1].old === 79 && R.rows[2].sale && R.rows[2].img === '' && R.rows[2].link === '' && !('price' in R.rows[0]));
const CR = TL.cleanRead({ at: NOW, mkt: 'gb', reads: [R, { q: 'x', rows: [{ t: 'bad', pos: 'nope' }, {}, { t: 'ok', p: 'NaN', img: 'https://ok/img', rating: 4.9 }] }] });
t('the stored read is checked whole, and a second pass through the check changes nothing', CR.n === 8 && CR.reads[1].rows.length === 2 && CR.reads[1].rows[1].p === null && CR.reads[1].rows[1].rating === 4.9 && JSON.stringify(TL.cleanRead(CR)) === JSON.stringify(CR));
const BIG = { q: 'womens dresses', rows: [] };
for (let i = 0; i < 20; i++) BIG.rows.push({ pos: i + 1, m: i % 4 === 0 ? 'Harbour' : i % 4 === 1 ? 'Linden' : 'Atelier', t: (i % 2 ? 'Midi dress ' : 'Atelier midi dress ') + i, p: 40 + i, sale: i % 2 === 0, rating: i % 2 === 0 ? 4 : null, img: 'https://t/' + i });
BIG.rows.push({ pos: 21, m: 'Northwind', t: 'Northwind Midi Dress', p: 89, sale: false, img: 'https://t/n' });
const SM = TL.compSummary([BIG], 'Northwind', 'northwind.example');
t('merchants are ranked by presence with share, sale, stars and title-lead rates; we are read apart', SM.total === 21 && SM.merchants[0].m === 'Atelier' && SM.merchants.length === 3 && SM.us.n === 1 && SM.us.share === 4.8 && SM.them.sale === 50);
t('the signals name specific tests with the figures behind them', SM.signals.some((s) => s.k === 'sale_badge' && /50%/.test(s.why)) && SM.signals.some((s) => s.k === 'ratings_feed'));
const NONE = TL.compSummary([BIG], 'Nobody', '');
t('a brand absent from its own category results is a keyword signal; under ten competitor rows there are no signals at all', NONE.signals.some((s) => s.k === 'kw_theme') && TL.compSummary([{ q: 'a', rows: BIG.rows.slice(0, 5) }], 'Northwind', '').signals.length === 0);

console.log('── the proposals');
const FEEDS = [{ mkt: 'gb', fb: true, cov: { additional_image_link: 80, sale_price: 20, keywords: 30, item_group_id: 90, google_product_category: 100, hl_depth: 40, detail_depth: 20 }, rows: 1000, ai: 0, ovlFb: false, lang: 'en', arrivals: 300 },
  { mkt: 'de', fb: false, cov: { additional_image_link: 80, sale_price: 0 }, rows: 500, ai: 0, ovlFb: false, lang: 'de', arrivals: 0 }];
const ctxN = { industry: 'Fashion', feeds: FEEDS, archive: BOOK[0].tests, kw: [], briefs: ['A/B Test - Six product highlights per product - Northwind - 1026'], comp: { signals: SM.signals } };
const P = TL.proposeTests('Northwind', ctxN, EV, { now: NOW });
const byK = {}; P.top.concat(P.rest).forEach((p) => { byK[p.k] = p; });
t('a test this brand ran in the last six months is not proposed, and says so', byK.img_lifestyle.status === 'ran' && !P.top.some((p) => p.k === 'img_lifestyle'));
t('a test already briefed is marked briefed with its ticket, never proposed twice', byK.hl_six.status === 'briefed' && /Six product highlights/.test(byK.hl_six.briefedAs) && !P.top.some((p) => p.k === 'hl_six'));
t('a test the feed cannot carry is blocked with what unblocks it, and never in the three', byK.conv_qa.status === 'ready' && byK.variant_card.status === 'ready' && P.rest.filter((p) => p.status === 'blocked').every((p) => p.ready.why) && !P.top.some((p) => p.status !== 'ready'));
t('three proposals, each a specific question with a field, a design, a metric and a line to say', P.top.length === 3 && P.top.every((p) => /^How about we A\/B test .+ this month\?$/.test(p.title) && p.field && p.how && p.metric && p.say.length > 40 && p.brief.cat === 'test' && /^A\/B Test - .+ - Northwind - 1026$/.test(p.brief.task)));
t('the competitor signal lifts the sale-badge test and names the read in its evidence', byK.sale_badge.evKind === 'comp' && /^Competitors: /.test(byK.sale_badge.ev) && byK.sale_badge.score > byK.desc_160.score);
t('one of the three is a first for the book (nobody has run it), marked as such', P.top.some((p) => p.first) && P.top.filter((p) => p.first).every((p) => /first/.test(p.ev)));
const ctxH = { industry: 'Fashion', feeds: FEEDS, archive: [], kw: [], briefs: [], comp: null };
const PH = TL.proposeTests('Linden', ctxH, EV, { now: NOW });
const img = PH.top.concat(PH.rest).find((p) => p.k === 'img_lifestyle');
t('a peer’s win is the evidence, named inside the FCC with its figure, market and month — the same-industry peer first', img.evKind === 'peer' && /^Northwind GB \+12\.4% ctr \(/.test(img.ev) && /2 wins across the book/.test(img.ev) && img.peers[0].brand === 'Northwind');
t('the brief a client may read names the INDUSTRY and never the peer brand', /a Fashion account saw \+12\.4% ctr/.test(img.brief.scope) && !/Northwind|Harbour/.test(img.brief.scope) && /Field: g:image_link/.test(img.brief.scope) && /Markets wired: GB, DE/.test(img.brief.scope));
t('the line to say names the peer (this is the AM’s rail), the figure and the design', /Northwind saw \+12\.4% ctr on lifestyle main image in/.test(img.say) && /We would split/.test(img.say));
t('a same-industry peer win outranks an other-industry one, which outranks an older one, which outranks none', img.score > PH.top.concat(PH.rest).find((p) => p.k === 'hl_six').score && PH.top.concat(PH.rest).find((p) => p.k === 'hl_six').score > PH.top.concat(PH.rest).find((p) => p.k === 'title_mask').score);
const PB = TL.proposeTests('Linden', { industry: 'Beauty', feeds: [{ mkt: 'gb', fb: false, cov: { additional_image_link: 10 }, ai: 2, lang: 'en' }], archive: [], kw: [], briefs: [], comp: null }, EV, { now: NOW });
const rb = {}; PB.top.concat(PB.rest).forEach((p) => { rb[p.k] = p; });
t('readiness reads the feeds: no Meta feed, no second image, conversational attributes present, English-only', /no Meta catalogue feed/.test(rb.ovl_price_meta.ready.why) && /second image/.test(rb.img_lifestyle.ready.why) && /already carries conversational/.test(rb.conv_qa.ready.why) && /English-speaking/.test(rb.ll_titles.ready.why));
t('the counts add up over every test', PB.counts.ready + PB.counts.blocked + PB.counts.briefed + PB.counts.ran === TL.TESTS.length);
t('a brand with no evidence in the book still gets three ready proposals resting on the platform pages', PB.top.length === 3 && PB.top.every((p) => p.status === 'ready' && p.src));

console.log('── Auction Insights — the report as Google Ads downloads it, no API');
// the Shopping-campaign shape: a title line, the date range, the header, "You", competitors, "< 10%" and "--"
const AUC = [['Auction insights report'], ['1 Oct 2026 - 14 Oct 2026'], [],
  ['Display URL domain', 'Impression share', 'Overlap rate', 'Outranking share'],
  ['You', '23.40%', '--', '--'], ['harbour.example', '45.10%', '60.00%', '31.20%'], ['www.atelier.example', '< 10%', '12.00%', '70.00%'], ['Total', '--', '--', '--']];
let a = TL.parseAuction(AUC);
t('the header is found under the title lines, the range read off the line before it', a.ok && a.range === '1 Oct 2026 - 14 Oct 2026' && !a.segmented && a.cols.join() === 'is,ov,or');
t('You is apart; competitors sorted by impression share; www./scheme stripped, lower-cased; Total skipped', a.you.you && a.you.is === 23.4 && a.comps.map((c) => c.d).join() === 'harbour.example,atelier.example' && a.comps.length === 2);
t('"< 10%" is kept as a floor, never 10; "--" is null, never 0', a.comps[1].is === 10 && a.comps[1].isLt === true && a.you.ov == null && a.comps[0].ov === 60);
const AUCX = [['Campaign', 'Display URL domain', 'Impression share', 'Overlap rate', 'Outranking share', 'Position above rate', 'Top of page rate', 'Abs. top of page rate'],
  ['Shopping - GB', 'You', 0.31, '', '', '', 0.9, 0.42], ['Shopping - GB', 'harbour.example', 0.52, 0.61, 0.3, 0.55, 0.8, 0.3], ['PMax - GB', 'harbour.example', 0.2, 0.3, 0.6, 0.2, 0.5, 0.1], ['PMax - GB', 'linden.example', 0.08, 0.2, 0.9, 0.1, 0.3, 0.05]];
a = TL.parseAuction(AUCX);
t('an Excel export: fractions read as the same percentages; a Campaign column folds rows per domain keeping the strongest figure and the count; the Search columns ride along', a.ok && a.segmented && a.you.is === 31 && a.you.top === 90 && a.comps[0].d === 'harbour.example' && a.comps[0].n === 2 && a.comps[0].is === 52 && a.comps[0].or === 60 && a.comps[1].is === 8 && a.cols.join() === 'is,ov,or,pa,top,atop');
t('a file with no Auction Insights header is refused with the fix, never read as empty data', TL.parseAuction([['Campaign', 'Clicks', 'Cost'], ['x', 1, 2]]).ok === false && /Display URL domain/.test(TL.parseAuction([['a']]).error) && TL.parseAuction(null).ok === false && TL.parseAuction([['Display URL domain', 'Impression share']]).ok === false);
t('aucPct: a number ≤1 is a fraction, 45.23 is a percentage, "1,234%" never, "> 90%" a ceiling', TL.aucPct(0.4523).v === 45.23 && TL.aucPct(45.23).v === 45.23 && TL.aucPct('45.23%').v === 45.23 && TL.aucPct('> 90%').gt === true && TL.aucPct('n/a').v === null && TL.aucPct('').v === null);
const rec = TL.cleanAuction(Object.assign({}, TL.parseAuction(AUC), { at: NOW, mkt: 'gb', by: 'ray@feedspark.com' }));
t('cleanAuction keeps the shape, clamps to 0–100, and a second pass changes nothing', rec && rec.v === 1 && rec.at === NOW && rec.mkt === 'gb' && rec.comps.length === 2 && rec.comps[1].isLt === true && JSON.stringify(TL.cleanAuction(rec)) === JSON.stringify(rec) && TL.cleanAuction({ comps: [{ d: 'x', is: 140 }] }).comps[0].is === 100 && TL.cleanAuction(null) === null && TL.cleanAuction({}) === null);
const sg = TL.auctionSignals(rec), sgk = sg.map((x) => x.k);
t('the signals name tests that move ELIGIBILITY and BIDDING — a leader 5+ points ahead on impression share promotes keywords + titles, being outranked under 40% where you overlap promotes a performance label, a share under 20% among 3+ promotes the sale badge', sgk.indexOf('kw_theme') >= 0 && sgk.indexOf('title_mask') >= 0 && sgk.indexOf('cl_perf') >= 0 && sgk.indexOf('sale_badge') < 0 && sg.every((x) => /\d/.test(x.why)) && /harbour\.example wins 45\.1%/.test(sg[0].why));
t('no signal where the report says nothing: no comps, or You ahead', TL.auctionSignals(null).length === 0 && TL.auctionSignals({ you: { is: 60 }, comps: [{ d: 'a', is: 20, ov: 50, or: 80 }] }).length === 0);
t('the signals are keys of real tests, so a proposal can wear them', sgk.every((k) => TL.TESTS.some((x) => x.k === k)));

console.log('── the routes, lifted out of worker.js against a stub KV + a stub SerpApi');
function lift(startMark) {
  const start = WK.indexOf(startMark);
  let depth = 0, end = -1;
  for (let i = WK.indexOf('{', start); i < WK.length; i++) { const ch = WK[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) { end = i + 1; break; } } }
  return start > 0 && end > start ? WK.slice(start, end) : '';
}
const b1 = lift("  if (path === '/api/testlab' && request.method === 'GET') {");
const b2 = lift("  if (path === '/api/compwatch' && (request.method === 'GET' || request.method === 'POST')) {");
const b3 = lift("  if (path === '/api/compwatch/auction' && (request.method === 'GET' || request.method === 'PUT' || request.method === 'DELETE')) {");
t('all three route blocks are found', b1.length > 500 && b2.length > 500 && b3.length > 500);
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const routeFn = new AsyncFn('path', 'url', 'request', 'env', 'ctx', 'accessOf', 'clientMatch', 'clientSlug', 'moduleAllowed', 'feedRoster', 'json', 'logActivity', 'TL', 'AIVIS', 'RET', 'retiredSetOf', 'PLAN_SHEETS', 'industryOf', 'liftEnvelope', 'lgKey', 'mktOf', 'fetch', b1 + '\n' + b3 + '\n' + b2 + '\nreturn null;');
function kvStub() {
  const m = new Map();
  return { m, async get(k, type) { const v = m.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const KV = kvStub(), logs = [];
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ROSTER = [{ client: 'Northwind', mkt: 'gb', src: { xml: 'https://s1.feedhero.net/x' } }, { client: 'Northwind', mkt: 'gb-fb', src: { xml: 'https://s1.feedhero.net/y' } }, { client: 'Northwind', mkt: 'de', src: { xml: 'https://s1.feedhero.net/z' } }, { client: 'Harbour', mkt: 'gb', src: { xml: 'https://s1.feedhero.net/h' } }];
const PLAN = { Northwind: 'sheet1', Harbour: 'sheet2', Linden: 'sheet3' };
const jsonR = (d, s) => new Response(JSON.stringify(d), { status: s || 200, headers: { 'content-type': 'application/json' } });
const serpCalls = [];
const stubFetch = async (u) => { serpCalls.push(String(u)); return new Response(JSON.stringify(SERP), { status: 200 }); };
async function call(method, p, body, acc0, envX, fetch0) {
  const url = new URL('https://x' + p);
  const request = new Request(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } });
  const acc = acc0 || { owner: true, clients: null, modules: null };
  const res = await routeFn(url.pathname, url, request, Object.assign({ EDITS: KV }, envX || {}), {}, async () => acc, (cl, n) => !cl || cl.indexOf(n) >= 0, slug,
    (mods, s) => !mods || mods.indexOf(s) >= 0, async () => ROSTER, jsonR, (c, e, rq, a, d) => logs.push(a + ' ' + (d || '')), TL, AIVIS, RET, async () => new Set(), PLAN, industryOf, liftEnvelope, (c, m) => c + '|' + m, (raw) => String(raw || 'gb').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 6) || 'gb', fetch0 || stubFetch);
  return res;
}
await KV.put('abtests:Northwind', JSON.stringify({ ok: true, v: 4, tests: BOOK[0].tests }));
await KV.put('abtests:Harbour', JSON.stringify({ ok: true, v: 4, tests: BOOK[1].tests }));
await KV.put('kwresults', JSON.stringify(KW.map((k) => ({ client: k.brand, mkt: k.mkt, period: k.period, when: k.when, metrics: k.metrics, verdict: k.verdict }))));
await KV.put('goldenidx', JSON.stringify({ 'Northwind|gb': { client: 'Northwind', mkt: 'gb', rows: 1000, cov: FEEDS[0].cov, ai: { n: 0, of: 6 } }, 'Northwind|de': { client: 'Northwind', mkt: 'de', rows: 500, cov: FEEDS[1].cov, ai: { n: 0, of: 6 } } }));
await KV.put('overlayidx', JSON.stringify({ 'Northwind|gb-fb': { ovl: 0 } }));
await KV.put('voldobidx', JSON.stringify({ 'Northwind|gb': { m: { [new Date(NOW).toISOString().slice(0, 7)]: 120 } } }));
await KV.put('briefs', JSON.stringify({ b1: { id: 'b1', client: 'Northwind', cat: 'test', task: 'A/B Test - Six product highlights per product - Northwind - 1026', stage: 'briefed' } }));
await KV.put('clients', JSON.stringify({ Northwind: { dom: 'northwind.example' } }));
let res = await call('GET', '/api/testlab?client=Northwind');
let d = await res.json();
t('GET /api/testlab: three proposals, the rest, the counts, the evidence by family, the book, and which archives are still cold', d.ok && d.top.length === 3 && d.rest.length === TL.TESTS.length - 3 && d.evidence.img_lifestyle.recent === 2 && d.book.length === 2 && d.cold.join() === 'Linden' && d.ownArchive === true && d.industry === industryOf('Northwind'));
t('the brand’s feeds are read for readiness — the Meta feed wired, the scans, the arrivals, the open test brief', d.feeds.length === 2 && d.feeds[0].fb === true && d.feeds[0].scanned && d.rest.some((p) => p.k === 'hl_six' && p.status === 'briefed') && d.rest.some((p) => p.k === 'cl_newin' && p.status !== 'blocked'));
t('the competitor block says what is stored (nothing yet) and that Meta is not readable', d.comp.markets.gb === null && d.comp.markets.de === null && d.comp.on === false && /Meta Ad Library/.test(d.comp.meta.why) && d.comp.signals.length === 0);
res = await call('GET', '/api/testlab?client=Harbour', null, { owner: false, clients: ['Northwind'], modules: null });
t('scope: a client outside the signin’s scope is refused', res.status === 403);
res = await call('GET', '/api/testlab?client=a|b');
t('a client with a separator in it is refused', res.status === 400);
res = await call('POST', '/api/compwatch', { client: 'Northwind', market: 'gb' });
d = await res.json();
t('POST /api/compwatch without SERPAPI_KEY: not connected, nothing read, nothing stored', !d.ok && d.on === false && serpCalls.length === 0 && !KV.m.has('compwatch:Northwind:gb'));
res = await call('POST', '/api/compwatch', { client: 'Northwind', market: 'gb' }, null, { SERPAPI_KEY: 'sk-test' });
d = await res.json();
t('with a key but no product-type snapshot the read is refused with the fix, nothing spent', res.status === 409 && /Product Type Guard/.test(d.error) && serpCalls.length === 0);
await KV.put('ptype:Northwind:gb', JSON.stringify({ labels: { product_type: { values: PT } } }));
res = await call('POST', '/api/compwatch', { client: 'Northwind', market: 'gb' }, null, { SERPAPI_KEY: 'sk-test' });
d = await res.json();
const stored = JSON.parse(KV.m.get('compwatch:Northwind:gb') || 'null');
t('the read runs one google_shopping search per category query in the market’s own gl/hl, stores the checked rows, logs it, answers the summary', d.ok && d.fresh && serpCalls.length === 3 && serpCalls.every((u) => /engine=google_shopping/.test(u) && /gl=uk/.test(u) && /api_key=sk-test/.test(u)) && stored && stored.n === 18 && d.summary.merchants.length >= 1 && logs.some((l) => /^compwatch-read Northwind GB · 3 queries/.test(l)));
t('the stored read never carries the key or the raw page', !/sk-test/.test(KV.m.get('compwatch:Northwind:gb')) && !/shopping_results/.test(KV.m.get('compwatch:Northwind:gb')));
res = await call('POST', '/api/compwatch', { client: 'Northwind', market: 'gb' }, null, { SERPAPI_KEY: 'sk-test' });
d = await res.json();
t('a second read inside a day answers the stored one (one read per market per day); force re-reads', !d.fresh && serpCalls.length === 3 && (await (await call('POST', '/api/compwatch', { client: 'Northwind', market: 'gb', force: true }, null, { SERPAPI_KEY: 'sk-test' })).json()).fresh && serpCalls.length === 6);
res = await call('POST', '/api/compwatch', { client: 'Northwind', market: 'gb-fb' }, null, { SERPAPI_KEY: 'sk-test' });
t('a Meta catalogue has no Shopping results — refused', res.status === 400);
res = await call('POST', '/api/compwatch', { client: 'Northwind', market: 'gb' }, { owner: false, clients: null, modules: ['feedlab'] }, { SERPAPI_KEY: 'sk-test' });
t('reading spends money: it needs the Workflow module', res.status === 403);
res = await call('GET', '/api/compwatch?client=Northwind&market=gb');
d = await res.json();
t('GET /api/compwatch serves the stored read and its summary', d.ok && d.read && d.read.n === 18 && d.summary.us.n === 3);
res = await call('GET', '/api/testlab?client=Northwind');
d = await res.json();
t('the test lab now carries the market’s read and its signals, and the proposals wear them', d.comp.markets.gb && d.comp.markets.gb.n === 18 && d.comp.signals.length > 0 && d.top.concat(d.rest).some((p) => /^Competitors: /.test(p.ev)));
t('the money throttle covers the read: /api/compwatch is a money path with its own limit', SEC.MONEY_PATHS.has('/api/compwatch') && SEC.THROTTLES['/api/compwatch'].limit === 40);

console.log('── the Auction Insights upload, lifted');
res = await call('PUT', '/api/compwatch/auction', { client: 'Northwind', market: 'de', rows: AUC });
d = await res.json();
const storedA = JSON.parse(KV.m.get('compauction:Northwind:de') || 'null');
t('PUT stores the checked record under compauction:<client>:<mkt>, stamps who and when, logs it, answers the record + its signals', d.ok && d.auction.comps.length === 2 && storedA && storedA.v === 1 && storedA.at > 0 && storedA.mkt === 'de' && storedA.range === '1 Oct 2026 - 14 Oct 2026' && d.signals.length >= 2 && logs.some((l) => /^compauction-upload Northwind DE · 2 competitors/.test(l)));
t('the stored record is the figures only — never the file’s rows or a raw cell', !/Auction insights report/.test(KV.m.get('compauction:Northwind:de')) && !/Total/.test(KV.m.get('compauction:Northwind:de')));
res = await call('PUT', '/api/compwatch/auction', { client: 'Northwind', market: 'de', rows: [['Campaign', 'Clicks'], ['x', 2]] });
d = await res.json();
t('a file with no Auction Insights header is refused with the fix, the stored report untouched', res.status === 400 && /Display URL domain/.test(d.error) && KV.m.get('compauction:Northwind:de') === JSON.stringify(storedA));
res = await call('PUT', '/api/compwatch/auction', { client: 'Northwind', market: 'de', rows: [] });
t('no rows is refused', res.status === 400);
res = await call('PUT', '/api/compwatch/auction', { client: 'Northwind', market: 'gb-fb', rows: AUC });
t('a Meta market is refused — it is a Google Ads report', res.status === 400);
res = await call('PUT', '/api/compwatch/auction', { client: 'Northwind', market: 'de', rows: AUC }, { owner: false, clients: null, modules: ['feedlab'] });
t('writing needs the Workflow module', res.status === 403);
res = await call('PUT', '/api/compwatch/auction', { client: 'Harbour', market: 'gb', rows: AUC }, { owner: false, clients: ['Northwind'], modules: null });
t('scope: a client outside the signin’s scope is refused', res.status === 403);
res = await call('GET', '/api/compwatch/auction?client=Northwind&market=de');
d = await res.json();
t('GET serves the stored report', d.ok && d.auction && d.auction.comps[0].d === 'harbour.example');
res = await call('GET', '/api/testlab?client=Northwind');
d = await res.json();
t('the test lab carries the report on its market, WITHOUT a Shopping read, with its signals marked as the auction’s; the proposals wear them', d.comp.markets.de && !d.comp.markets.de.summary && d.comp.markets.de.auction.comps.length === 2 && d.comp.markets.de.auction.signals.length >= 2 && d.comp.signals.some((x) => x.src === 'auction' && x.mkt === 'de') && d.comp.signals.some((x) => x.src === 'shopping' && x.mkt === 'gb') && d.top.concat(d.rest).some((p) => p.k === 'cl_perf' && /^Competitors: /.test(p.ev)));
res = await call('DELETE', '/api/compwatch/auction?client=Northwind&market=de');
d = await res.json();
t('DELETE forgets it, and the lab no longer carries it', d.ok && d.auction === null && !KV.m.has('compauction:Northwind:de') && (await (await call('GET', '/api/testlab?client=Northwind')).json()).comp.markets.de === null);
t('no money is spent on an upload: the auction route is not a money path', !SEC.MONEY_PATHS.has('/api/compwatch/auction'));

console.log('── wiring');
t('the worker imports the engine and serves both routes', /import \* as TL from "\.\/testlab\.js"/.test(WK) && /path === '\/api\/testlab'/.test(WK) && /path === '\/api\/compwatch'/.test(WK));
// REACHABLE, not merely written (23 Oct 2026): both routes shipped inside goldenRoutes(), which
// route() enters only on `/api/golden/` — so the rail's fetch answered HTML and 🧪 Test this month
// read "could not read the test lab". tools/check_routes.js reads the whole router this way.
t('route() dispatches all three paths by name',
  ["'/api/testlab'", "'/api/compwatch'", "'/api/compwatch/auction'"].every((p) => new RegExp('RAIL_PATHS = new Set\\(\\[[^\\]]*' + p.replace(/\//g, '\\/')).test(WK))
  && /RAIL_PATHS\.has\(path\)[\s\S]{0,120}await railRoutes\(env, request, url, ctx\)/.test(WK));
t('…and they live in railRoutes(), the function that dispatch calls',
  WK.indexOf('async function railRoutes(') >= 0 && WK.indexOf("path === '/api/testlab'") > WK.indexOf('async function railRoutes('));
t('the rail uploads the Auction Insights report through the xlsx engine loaded on first use, PUTs rows only, draws the report and lets it be forgotten', /fetch\('\/api\/compwatch\/auction',\{method:'PUT'/.test(WF) && /sc\.src='\/xlsx\/engine\.js'/.test(WF) && /function secAuction\(m,a\)/.test(WF) && /data-au-x=/.test(WF) && /utf-16le/.test(WF) && /id="ck-au-file"/.test(WF));
t('the Playbook rail draws the section after the Top 3 (the Spend Lens sits between them) and wires it', /secActions\(BRAND\)\+[A-Za-z()]*\+?secTests\(BRAND\)\)/.test(WF) && /wireTests\(BRAND\)/.test(WF) && /id="ck-tl"/.test(WF) && /fetch\('\/api\/testlab\?client='/.test(WF) && /fetch\('\/api\/compwatch'/.test(WF));
t('→ Brief raises the brief through the ONE composer entry, as a test', /window\.FCCBrief\(\{client:brand,task:p\.brief\.task,cat:p\.brief\.cat,source:'plan',scope:p\.brief\.scope\}\)/.test(WF));
t('cold archives are warmed once per session through the archive route, never guessed', /fetch\('\/api\/abtests\?client='\+encodeURIComponent\(b\)\)/.test(WF) && /TLWARM\[b\]=1/.test(WF));
t('the harness runs in qa_gate, presync and CI', /node tools\/test_testlab\.mjs/.test(read('tools/qa_gate.sh')) && /node tools\/test_testlab\.mjs/.test(read('tools/presync.sh')) && /node tools\/test_testlab\.mjs/.test(read('.github/workflows/validate.yml')));
t('documented', fs.existsSync(new URL('../docs/TESTLAB.md', import.meta.url)) && /Test Lab/.test(read('docs/PLAYBOOK.md')));
const src = read('cloudflare/feedspark-deck/src/testlab.js');
t('no key, no client figure, no competitor name in the engine', !/serpapi\.com\/.*api_key=[a-z0-9]{10}/i.test(src) && !/Hobbs|Zara|Next plc|ASOS/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
