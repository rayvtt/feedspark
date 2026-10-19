#!/usr/bin/env node
/*
 * Keyword Calendar — the Hobbycraft seasonal board, RENDERED (Ray, 19 Oct 2026: "generate a generic
 * keyword theme calendar for [Hobbycraft] in this industry from now until February next year —
 * because they have not sent the marketing calendar yet").
 *
 * The same three things the Monsoon and Superdry seeds proved can go wrong once a board is drawn:
 *  1. A SCOPE THAT IS SET reads as a scope to set, because volOf needs a synced product-type index
 *     and returns null without one. An unread index is not a zero — and a BRAND-WIDE moment is a
 *     scope decision too, so it must read as one rather than as "Set scope".
 *  2. The DATES. The board buckets by BRIEF-BY (live − LEAD_DAYS), so "two a month" is two per WORK
 *     month, and anything briefed before today is born overdue.
 *  3. The PATHS. Checked against an INDEPENDENT census of the live feed (part 4), because part 5
 *     builds its index out of the seed's own paths.
 *
 * Run: node tools/test_kwcal_hobbycraft.mjs   (skips cleanly where Playwright is unavailable)
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

const IDS = ['hc_xmas', 'hc_adv', 'hc_bf', 'hc_gift', 'hc_new',
  'hc_yarn', 'hc_val', 'hc_sew', 'hc_mum', 'hc_east'];
const SCOPED = IDS.filter((i) => i !== 'hc_bf');   // hc_bf is brand-wide, deliberately

const INIT = "window.fetch=function(url){var u=String(url);"
  + "var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(u.indexOf('/api/feed/clients')>=0)return j({clients:{Hobbycraft:{markets:['gb','gb-fb']},Reiss:{markets:['gb']}}});"
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
ok('Hobbycraft is in the brand selector',
  await page.$eval('#brand', (s) => [...s.options].some((o) => o.value === 'Hobbycraft')));
await page.selectOption('#brand', 'Hobbycraft');
await page.waitForTimeout(700);
ok('the board is on Hobbycraft', (await page.$eval('#brand', (s) => s.value)) === 'Hobbycraft');
const cards = await page.$$eval('[data-scope]', (n) => n.map((x) => x.getAttribute('data-scope')));
ok('ten themes render, one card each', cards.length === 10 && new Set(cards).size === 10, cards.length);
ok('…and they are Hobbycraft’s, not another brand’s', cards.every((c) => c.startsWith('hc_')), cards.slice(0, 3));

console.log('\n2) two a month, in the month the WORK falls — and nothing born overdue');
const sections = await page.$$eval('.road > .mo-sec', (secs) => secs.map((s) => ({
  head: (s.querySelector('.mo-h, h3, .mo-t') || s).textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
  ids: [...s.querySelectorAll('[data-scope]')].map((c) => c.getAttribute('data-scope')) })));
const carrying = sections.filter((s) => s.ids.length);
ok('the plan runs over five working months', carrying.length === 5, sections.map((s) => s.head + ':' + s.ids.length));
ok('…with exactly two themes in each', carrying.every((s) => s.ids.length === 2), carrying.map((s) => s.ids.length));
ok('…and every theme is placed, none lost outside the window',
  carrying.reduce((a, s) => a + s.ids.length, 0) === 10);
ok('the first working month is the current one', /Oct/i.test(carrying[0].head), carrying[0].head);
ok('…and the last is February 2027, as asked', /Feb/i.test(carrying[4].head), carrying[4].head);

console.log('\n3) a scope that is SET but not yet measurable says so, and the lanes are this brand’s');
const btns = await page.$$eval('.scope', (n) => n.map((b) => ({ cls: b.className, txt: b.textContent.trim() })));
const pend = btns.filter((b) => /\bpend\b/.test(b.cls));
const unset = btns.filter((b) => /\bunset\b/.test(b.cls));
ok('all ten cards report a scope waiting to be measured', pend.length === 10, { pend: pend.length, unset: unset.length });
ok('…nine naming how many product types they cover',
  pend.filter((b) => /^\d+ product types · sync to measure/.test(b.txt)).length === 9, pend.map((b) => b.txt));
ok('…and the one brand-wide moment saying THAT, not "Set scope"',
  pend.filter((b) => /^whole catalogue · sync to measure/.test(b.txt)).length === 1, pend.map((b) => b.txt));
ok('not one reads "Set scope" — the product was auto-selected', unset.length === 0, unset.map((b) => b.txt));
const kpi = await page.$$eval('.kpi', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
ok('the KPI band counts all ten as scheduled', kpi.some((k) => /^10\s*Optimisations scheduled$/.test(k)), kpi);
ok('…and reports the SKU total as unread, never as zero', kpi.some((k) => /^—\s*SKUs in scope$/.test(k)), kpi);
const legend = await page.$eval('.lgnd', (e) => e.textContent.replace(/\s+/g, ' ').trim());
ok('the legend uses Hobbycraft’s own lane words',
  ['Seasonal focus', 'Gifting & occasions', 'Kids & families', 'Promotion'].every((w) => legend.includes(w)), legend);
ok('and none of the generic ones survive in it', !/\bStudio\b|\bLocation\b|\bCampaign\b/.test(legend), legend);

console.log('\n4) every seeded path EXISTS in the live feed, checked against an independent census');
/* THE CIRCULARITY TRAP: part 5 builds a product-type index out of the seed's own paths, so a
 * mis-spelled path would resolve under its own mis-spelling and silently match nothing real. The
 * check comes from somewhere the seed cannot influence —
 * ops/calendars/hobbycraft_gb_product_types_2026-10-19.json, read off the live GB feed the day
 * these themes were written. */
const census = JSON.parse(fs.readFileSync(path.join(root, 'ops', 'calendars', 'hobbycraft_gb_product_types_2026-10-19.json'), 'utf8'));
const known = census.product_types;
ok('the census is the live GB read, not a hand-written list',
  census.totals.skus === 25483 && census.totals.product_type_paths === Object.keys(known).length, census.totals);
ok('…and it records the finding the whole plan rests on: half the feed is unkeyworded',
  census.keyword_saturation.skus_carrying_none === 12823, census.keyword_saturation);

const seedSrc = fs.readFileSync(path.join(D, 'FeedSpark_KWCal.html'), 'utf8');
const at0 = seedSrc.indexOf('Hobbycraft:{events:[');
const block = seedSrc.slice(at0, seedSrc.indexOf('\n]}', at0));
const grab = (id) => {
  const at = block.indexOf('{id:"' + id + '"');
  if (at < 0) return null;
  const m = /pts:\[([\s\S]*?)\]\}/.exec(block.slice(at, at + 9000));
  return m ? JSON.parse('[' + m[1] + ']') : [];
};
let strays = [], total = 0;
SCOPED.forEach((id) => { const pts = grab(id); ok('… ' + id + ' was read out of the page', !!pts && pts.length > 0, pts && pts.length);
  (pts || []).forEach((pt) => { total++; if (!known[pt]) strays.push(id + ' → ' + pt); }); });
ok('NO seeded path is absent from the live feed', strays.length === 0, strays.slice(0, 5));
ok('…across all 112 of them', total === 112, total);
ok('the brand-wide moment really carries no paths, rather than an empty list by accident',
  block.indexOf('{id:"hc_bf"') >= 0 && !/pts:/.test(block.slice(block.indexOf('{id:"hc_bf"'), block.indexOf('{id:"hc_gift"'))));

const sum = (id, k) => (grab(id) || []).reduce((a, pt) => a + (known[pt] ? known[pt][k] : 0), 0);
const quoted = (id) => { const at = block.indexOf('{id:"' + id + '"'); const m = /Scope: (\d+) product-type paths — ([\d,]+) products \/ ([\d,]+) SKUs, ([\d,]+) of those/.exec(block.slice(at, at + 9000));
  return m ? { paths: +m[1], products: +m[2].replace(/,/g, ''), skus: +m[3].replace(/,/g, ''), un: +m[4].replace(/,/g, '') } : null; };
let bad = [];
SCOPED.forEach((id) => { const q = quoted(id); if (!q) { bad.push(id + ' → no scope line'); return; }
  if (q.paths !== (grab(id) || []).length || q.products !== sum(id, 'products') || q.skus !== sum(id, 'skus') || q.un !== sum(id, 'unkeyworded'))
    bad.push(id + ' → ' + JSON.stringify(q) + ' vs ' + JSON.stringify({ paths: grab(id).length, products: sum(id, 'products'), skus: sum(id, 'skus'), un: sum(id, 'unkeyworded') })); });
ok('every scoped card quotes the count ITS OWN scope resolves to', bad.length === 0, bad.slice(0, 3));
const bfNote = block.slice(block.indexOf('{id:"hc_bf"'), block.indexOf('{id:"hc_gift"'));
ok('…and the brand-wide one quotes the WHOLE catalogue, from the same census',
  bfNote.includes('17,509 products / 25,483 SKUs') && bfNote.includes('12,823'), true);
ok('the sewing theme is the biggest scope on the board', sum('hc_sew', 'skus') === 1943, sum('hc_sew', 'skus'));
ok('…and the stocking-filler cohort the smallest', sum('hc_adv', 'skus') === 243, sum('hc_adv', 'skus'));
ok('no scoped theme is an exact duplicate of another',
  new Set(SCOPED.map((id) => (grab(id) || []).slice().sort().join('|'))).size === SCOPED.length);

console.log('\n5) the seeded paths resolve against a product-type index');
const xPts = grab('hc_xmas'), yPts = grab('hc_yarn');
const map = {}; let nn = 0;
[...xPts, ...yPts].forEach((pt) => { if (!(pt in map)) map[pt] = ++nn; });
const xSum = xPts.reduce((a, pt) => a + map[pt], 0);
const ySum = yPts.reduce((a, pt) => a + map[pt], 0);
const stored = { Hobbycraft: {
  ptidx: { gb: { map, __total: 25483, sat: { n: 12660, cols: 1, v: 2 }, t: Date.now() } },
  events: [
    { id: 'hc_xmas', name: 'Christmas crafting & card making', lane: 'campaign', date: '2026-11-11', terms: ['christmas card making'], pts: xPts },
    { id: 'hc_yarn', name: 'Cosy season — knitting, crochet & yarn', lane: 'campaign', date: '2027-01-08', terms: ['chunky yarn'], pts: yPts },
  ] } };
const p2 = await ctx.newPage();
const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
await installEngineRoutes(p2.context());
await p2.addInitScript({ content: INIT.replace("if(u.indexOf('/api/kwcal')>=0)return j({});",
  "if(u.indexOf('/api/kwcal')>=0)return j(" + JSON.stringify(stored) + ");") });
await p2.goto('file://' + path.join(D, 'FeedSpark_KWCal.html') + '?client=Hobbycraft');
await p2.waitForTimeout(1400);
const b2 = await p2.$$eval('[data-scope]', (n2) => n2.map((b) => ({ id: b.getAttribute('data-scope'), cls: b.className, txt: b.textContent.trim() })));
const byId = Object.fromEntries(b2.map((b) => [b.id, b]));
ok('no page error on the stored board', errs2.length === 0, errs2.slice(0, 2));
ok('no card is left waiting once the index exists', b2.filter((b) => /\bpend\b/.test(b.cls)).length === 0, b2.map((b) => b.txt));
ok('the Christmas scope resolves to the sum of its own paths — every one matched',
  byId.hc_xmas && byId.hc_xmas.txt === xSum + ' products', { got: byId.hc_xmas && byId.hc_xmas.txt, want: xSum + ' products' });
ok('…and so does the yarn scope', byId.hc_yarn && byId.hc_yarn.txt === ySum + ' products',
  { got: byId.hc_yarn && byId.hc_yarn.txt, want: ySum + ' products' });

await browser.close();
console.log(fail ? '\nFAIL ' + fail : '\nPASS');
process.exit(fail ? 1 : 0);
