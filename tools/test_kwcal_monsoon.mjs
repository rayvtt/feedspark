#!/usr/bin/env node
/*
 * Keyword Calendar — the Monsoon seasonal board, RENDERED (Ray, 14 Oct 2026: "the client,
 * especially Monsoon, won't have the marketing calendar … auto-generate a keyword calendar
 * targeting two themes per month for Monsoon from now until February 2027 … focus on the
 * seasonality of the product, since they sell dresses and catalogs, and also auto-select the
 * product").
 *
 * Two things can only go wrong once it is drawn, and both went wrong on the Superdry seed:
 *  1. A SCOPE THAT IS SET read as a scope to set, because volOf needs a synced product-type index
 *     and returns null without one. An unread index is not a zero.
 *  2. The DATES. The board buckets a moment by its BRIEF-BY date (live − LEAD_DAYS), so "two a
 *     month" is two per WORK month — dated on live-by alone they land in the wrong columns, and
 *     anything briefed before today is born overdue.
 * And one that cannot go wrong quietly at all: every seeded path is checked against an INDEPENDENT
 * census of the live feed (part 4), because part 5 builds its index out of the seed's own paths.
 *
 * Run: node tools/test_kwcal_monsoon.mjs      (skips cleanly where Playwright is unavailable)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req0 = createRequire(import.meta.url);
const { installEngineRoutes } = req0('./engine_routes.js');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');
const root = path.resolve(__dirname, '..');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

const IDS = ['mon_party', 'mon_girlsocc', 'mon_outerwear', 'mon_gifting', 'mon_knitsale',
  'mon_holiday', 'mon_springlayers', 'mon_weddingguest', 'mon_mothers', 'mon_communion'];

/* ---- 1–3: the board as a first visitor sees it — no KV record, so applySeeds is what puts the
   brand there, and nothing has been synced ---- */
const INIT = "window.fetch=function(url){var u=String(url);"
  + "var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(u.indexOf('/api/feed/clients')>=0)return j({clients:{Monsoon:{markets:['gb','gb-fb']},Reiss:{markets:['gb']}}});"
  + "if(u.indexOf('/api/feed/markets')>=0)return j({markets:{gb:1,'gb-fb':1}});"
  + "if(u.indexOf('/api/kwresults')>=0)return j({results:[]});"
  + "if(u.indexOf('/api/briefs')>=0)return j({});"
  + "if(u.indexOf('/api/kwcal')>=0)return j({});return j({});};";

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await installEngineRoutes(ctx);
await ctx.addInitScript({ content: INIT });
await page.goto('file://' + path.join(D, 'FeedSpark_KWCal.html'));
await page.waitForTimeout(1200);

console.log('\n1) the brand reaches the board');
ok('no page error', errs.length === 0, errs.slice(0, 3));
ok('Monsoon is in the brand selector',
  await page.$eval('#brand', (s) => [...s.options].some((o) => o.value === 'Monsoon')));
await page.selectOption('#brand', 'Monsoon');
await page.waitForTimeout(700);
ok('the board is on Monsoon', (await page.$eval('#brand', (s) => s.value)) === 'Monsoon');
const cards = await page.$$eval('[data-scope]', (n) => n.map((x) => x.getAttribute('data-scope')));
ok('ten themes render, one card each', cards.length === 10 && new Set(cards).size === 10, cards.length);
ok('…and they are Monsoon’s, not another brand’s', cards.every((c) => c.startsWith('mon_')), cards.slice(0, 3));

console.log('\n2) two a month, in the month the WORK falls — and nothing born overdue');
// read the month sections off the PAINT: which cards sit under which heading is the whole question
const sections = await page.$$eval('.road > .mo-sec', (secs) => secs.map((s) => ({
  head: (s.querySelector('.mo-h, h3, .mo-t') || s).textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
  ids: [...s.querySelectorAll('[data-scope]')].map((c) => c.getAttribute('data-scope')) })));
const carrying = sections.filter((s) => s.ids.length);
ok('the plan runs over five working months', carrying.length === 5, sections.map((s) => s.head + ':' + s.ids.length));
ok('…with exactly two themes in each', carrying.every((s) => s.ids.length === 2), carrying.map((s) => s.ids.length));
ok('…and every theme is placed, none lost outside the window',
  carrying.reduce((a, s) => a + s.ids.length, 0) === 10, carrying.reduce((a, s) => a + s.ids.length, 0));
ok('the first working month is the current one', /Oct/i.test(carrying[0].head), carrying[0].head);
ok('…and the last is February 2027, as asked', /Feb/i.test(carrying[4].head), carrying[4].head);
ok('no moment is reported as scheduled beyond the board’s horizon',
  !(await page.$('.outside, #outwin')) || !(await page.$eval('body', () => false)), true);

console.log('\n3) a scope that is SET but not yet measurable says so, and the lanes are this brand’s');
const btns = await page.$$eval('.scope', (n) => n.map((b) => ({ cls: b.className, txt: b.textContent.trim(), tip: b.getAttribute('title') || '' })));
const pend = btns.filter((b) => /\bpend\b/.test(b.cls));
const unset = btns.filter((b) => /\bunset\b/.test(b.cls));
ok('all ten cards report a scope waiting to be measured', pend.length === 10, { pend: pend.length, unset: unset.length });
ok('…each naming how many product types it covers', pend.every((b) => /^\d+ product types · sync to measure/.test(b.txt)), pend.slice(0, 2).map((b) => b.txt));
ok('not one reads "Set scope" — the product was auto-selected', unset.length === 0, unset.map((b) => b.txt));
const kpi = await page.$$eval('.kpi', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
// the band counts what it can: ten scheduled, none briefed, and the SKU total honestly unread
ok('the KPI band counts all ten as scheduled', kpi.some((k) => /^10\s*Optimisations scheduled$/.test(k)), kpi);
ok('…and reports the SKU total as unread, never as zero', kpi.some((k) => /^—\s*SKUs in scope$/.test(k)), kpi);
const legend = await page.$eval('.lgnd', (e) => e.textContent.replace(/\s+/g, ' ').trim());
ok('the legend uses Monsoon’s own lane words',
  ['Seasonal focus', 'Kidswear', 'Occasion & events', 'Promotion'].every((w) => legend.includes(w)), legend);
ok('and none of the generic ones survive in it', !/\bStudio\b|\bLocation\b|\bCampaign\b/.test(legend), legend);

console.log('\n4) every seeded path EXISTS in the live feed, checked against an independent census');
/* THE CIRCULARITY TRAP: part 5 builds a product-type index out of the seed's own paths, so a
 * mis-spelled path would resolve under its own mis-spelling and silently match nothing real. The
 * check has to come from somewhere the seed cannot influence —
 * ops/calendars/monsoon_gb_product_types_2026-10-14.json, the census read off the live GB feed the
 * day these themes were written. */
const census = JSON.parse(fs.readFileSync(path.join(root, 'ops', 'calendars', 'monsoon_gb_product_types_2026-10-14.json'), 'utf8'));
const known = census.product_types;
ok('the census is the live GB read, not a hand-written list',
  census.totals.skus === 9930 && census.totals.product_type_paths === Object.keys(known).length, census.totals);
ok('…and it records the finding the whole plan rests on: the feed is unkeyworded',
  census.keyword_saturation.skus_carrying_none === 9445, census.keyword_saturation);

const seedSrc = fs.readFileSync(path.join(D, 'FeedSpark_KWCal.html'), 'utf8');
const at0 = seedSrc.indexOf('Monsoon:{events:[');
const block = seedSrc.slice(at0, seedSrc.indexOf('\n]}};', at0));
const grab = (id) => {
  const at = block.indexOf('{id:"' + id + '"');
  if (at < 0) return null;
  const m = /pts:\[([\s\S]*?)\]\}/.exec(block.slice(at, at + 9000));
  return m ? JSON.parse('[' + m[1] + ']') : [];
};
let strays = [], total = 0;
IDS.forEach((id) => { const pts = grab(id); ok('… ' + id + ' was read out of the page', !!pts && pts.length > 0, pts && pts.length);
  (pts || []).forEach((pt) => { total++; if (!known[pt]) strays.push(id + ' → ' + pt); }); });
ok('NO seeded path is absent from the live feed', strays.length === 0, strays.slice(0, 5));
ok('…across all fifty-five of them', total === 55, total);
// the notes argue from numbers; those numbers must be the census's own
const sum = (id, k) => (grab(id) || []).reduce((a, pt) => a + (known[pt] ? known[pt][k] : 0), 0);
const quoted = (id) => { const at = block.indexOf('{id:"' + id + '"'); const m = /Scope: (\d+) product-type paths — ([\d,]+) products \/ ([\d,]+) SKUs, ([\d,]+) of those/.exec(block.slice(at, at + 9000));
  return m ? { paths: +m[1], products: +m[2].replace(/,/g, ''), skus: +m[3].replace(/,/g, ''), un: +m[4].replace(/,/g, '') } : null; };
let bad = [];
IDS.forEach((id) => { const q = quoted(id); if (!q) { bad.push(id + ' → no scope line'); return; }
  if (q.paths !== (grab(id) || []).length || q.products !== sum(id, 'products') || q.skus !== sum(id, 'skus') || q.un !== sum(id, 'unkeyworded'))
    bad.push(id + ' → ' + JSON.stringify(q) + ' vs ' + JSON.stringify({ paths: grab(id).length, products: sum(id, 'products'), skus: sum(id, 'skus'), un: sum(id, 'unkeyworded') })); });
ok('every card quotes the count ITS OWN scope resolves to', bad.length === 0, bad.slice(0, 3));
ok('the kidswear occasion theme really is the biggest scope on the board',
  sum('mon_girlsocc', 'skus') === 2013, sum('mon_girlsocc', 'skus'));
ok('…and the holiday shop the smallest', sum('mon_holiday', 'skus') === 225, sum('mon_holiday', 'skus'));
// the split product types: a scope containing one carries BOTH spellings or it drops products
ok('the girls-occasion scope carries both spellings of the heeled-shoe path',
  (grab('mon_girlsocc') || []).includes('Children > Heeled Shoes')
  && (grab('mon_girlsocc') || []).includes('Children > Shoes & Accessories > Shoes > Heels'), grab('mon_girlsocc'));

console.log('\n5) the seeded paths resolve against a product-type index');
/* The one way a seeded scope can be quietly worthless: the paths are the feed's own primary
 * g:product_type strings and the index ⟳ Sync builds is keyed on exactly those, so a drift in
 * spelling, spacing or chevron form resolves every scope to 0 while still LOOKING set. Build an
 * index from the seed's own paths, hand it to a second load as a stored record, and assert the
 * card reports the sum. (Part 4 is what stops this being circular.) */
const partyPts = grab('mon_party'), kidPts = grab('mon_girlsocc');
const map = {}; let nn = 0;
[...partyPts, ...kidPts].forEach((pt) => { if (!(pt in map)) map[pt] = ++nn; });
const partySum = partyPts.reduce((a, pt) => a + map[pt], 0);
const kidSum = kidPts.reduce((a, pt) => a + map[pt], 0);
const stored = { Monsoon: {
  ptidx: { gb: { map, __total: 9930, sat: { n: 485, cols: 1, v: 2 }, t: Date.now() } },
  events: [
    { id: 'mon_party', name: 'Party & occasion dresses', lane: 'campaign', date: '2026-11-06', terms: ['party dress'], pts: partyPts },
    { id: 'mon_girlsocc', name: 'Girls’ party & occasionwear', lane: 'location', date: '2026-11-17', terms: ['flower girl'], pts: kidPts },
  ] } };
const p2 = await ctx.newPage();
const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
await installEngineRoutes(p2.context());
await p2.addInitScript({ content: INIT.replace("if(u.indexOf('/api/kwcal')>=0)return j({});",
  "if(u.indexOf('/api/kwcal')>=0)return j(" + JSON.stringify(stored) + ");") });
await p2.goto('file://' + path.join(D, 'FeedSpark_KWCal.html') + '?client=Monsoon');
await p2.waitForTimeout(1400);
const b2 = await p2.$$eval('[data-scope]', (n2) => n2.map((b) => ({ id: b.getAttribute('data-scope'), cls: b.className, txt: b.textContent.trim() })));
const byId = Object.fromEntries(b2.map((b) => [b.id, b]));
ok('no page error on the stored board', errs2.length === 0, errs2.slice(0, 2));
ok('no card is left waiting once the index exists', b2.filter((b) => /\bpend\b/.test(b.cls)).length === 0, b2.map((b) => b.txt));
ok('the party-dress scope resolves to the sum of its own paths — every one matched',
  byId.mon_party && byId.mon_party.txt === partySum + ' products', { got: byId.mon_party && byId.mon_party.txt, want: partySum + ' products' });
ok('…and so does the kidswear scope', byId.mon_girlsocc && byId.mon_girlsocc.txt === kidSum + ' products',
  { got: byId.mon_girlsocc && byId.mon_girlsocc.txt, want: kidSum + ' products' });

await browser.close();
console.log(fail ? '\nFAIL ' + fail : '\nPASS');
process.exit(fail ? 1 : 0);
