#!/usr/bin/env node
/*
 * Keyword Calendar — the Superdry focus-theme board, RENDERED (Ray, 30 Sep 2026:
 * "look at superdry product types and create 4 focus themes for each month from now till january").
 *
 * tools/test_kwcal_tie.mjs pins the seed's DATA. This one drives the real page, because the two
 * things that could go wrong here are only visible once it is drawn:
 *
 *  1. A SEEDED SCOPE THAT CANNOT YET BE MEASURED. volOf needs the market's product-type index
 *     (⟳ Sync product types) and returns null without one — so before the first sync, eleven
 *     genuinely scoped themes read "⚙ Set scope" on their cards and counted in the "Scopes to set"
 *     KPI. A scope that is set is not a scope to set; an unread index is not a zero. Both surfaces
 *     now go through hasScope(), and this asserts the rendered result, then syncs a stub index and
 *     asserts the same cards switch to exact product counts.
 *  2. The brand has to APPEAR. Superdry was never on this board before, so the seed reaching the
 *     store, the selector carrying it and sixteen cards landing in four months are each a step
 *     that can silently fail.
 *
 * Run: node tools/test_kwcal_superdry.mjs      (skips cleanly where Playwright is unavailable)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');
const root = path.resolve(__dirname, '..');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// Superdry's wired GB Shopping feed, as /api/feed/clients reports it. No KV record, so applySeeds
// is what puts the brand on the board — exactly the state a real first visit is in.
const INIT = "window.fetch=function(url){var u=String(url);"
  + "var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(u.indexOf('/api/feed/clients')>=0)return j({clients:{Superdry:{markets:['gb','de','fr','ie','nl']},Reiss:{markets:['gb']}}});"
  + "if(u.indexOf('/api/feed/markets')>=0)return j({markets:{gb:1,de:1,fr:1,ie:1,nl:1}});"
  + "if(u.indexOf('/api/kwresults')>=0)return j({results:[]});"
  + "if(u.indexOf('/api/briefs')>=0)return j({});"
  + "if(u.indexOf('/api/kwcal')>=0)return j({});return j({});};";

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await ctx.addInitScript({ content: INIT });
await page.goto('file://' + path.join(D, 'FeedSpark_KWCal.html'));
await page.waitForTimeout(1200);

console.log('\n1) the brand reaches the board');
ok('no page error', errs.length === 0, errs.slice(0, 3));
ok('Superdry is in the brand selector',
  await page.$eval('#brand', (s) => [...s.options].some((o) => o.value === 'Superdry')));
await page.selectOption('#brand', 'Superdry');
await page.waitForTimeout(700);
ok('the board is on Superdry', (await page.$eval('#brand', (s) => s.value)) === 'Superdry');

const cards = await page.$$eval('[data-scope]', (n) => n.map((x) => x.getAttribute('data-scope')));
ok('sixteen themes render, one card each', cards.length === 16 && new Set(cards).size === 16, cards.length);
ok('…and they are the sd_ themes, not another brand’s', cards.every((c) => c.startsWith('sd_')), cards.slice(0, 3));
const months = await page.$$eval('.road > *', (n) => n.length);
ok('the plan opens on its six-month window', months === 6, months);

console.log('\n2) a scope that is SET but not yet measurable says so');
// Nobody has synced Superdry GB, so there is no ptidx: the eleven scoped themes must name what
// they scope, NOT read "Set scope" — and the KPI must not call them scopes to set.
const btns = await page.$$eval('.scope', (n) => n.map((b) => ({ cls: b.className, txt: b.textContent.trim(), tip: b.getAttribute('title') || '' })));
const pend = btns.filter((b) => /\bpend\b/.test(b.cls));
const unset = btns.filter((b) => /\bunset\b/.test(b.cls));
const wide = btns.filter((b) => /\bwide\b/.test(b.cls));
ok('fourteen cards report a scope waiting to be measured', pend.length === 14, pend.length);
ok('…each naming what it scopes', pend.every((b) => /(\d+ product types?|whole catalogue) · sync to measure/.test(b.txt)), pend.slice(0, 2));
ok('…and telling the reader how to measure it', pend.every((b) => /Sync product types/.test(b.tip) && /GB/.test(b.tip)), pend[0]);
ok('the winter-outerwear theme names all forty of its paths', pend.some((b) => /^40 product types/.test(b.txt)), pend.map((b) => b.txt));
ok('only the two deliberately unscoped themes read "Set scope"', unset.length === 2, unset.map((b) => b.txt));
// A BRAND-WIDE theme is a scope decision too — the whole catalogue — and only its TOTAL is missing
// without an index. It read "⚙ Set scope" as well until this was closed.
const bw = pend.filter((b) => /whole catalogue · sync to measure/.test(b.txt));
ok('the three brand-wide themes say the catalogue is in scope, not that nothing is', bw.length === 3, pend.map((b) => b.txt));
ok('every card accounts for itself', wide.length + pend.length + unset.length === btns.length && btns.length === 16,
  { wide: wide.length, pend: pend.length, unset: unset.length });
ok('…leaving the eleven product-type scopes to name their own paths', pend.length - bw.length === 11, pend.length - bw.length);
const kpi = await page.$$eval('.kpi', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
ok('the KPI band does NOT claim sixteen scopes to set', !kpi.some((k) => /Scopes to set/.test(k) && /^1[0-9]/.test(k)), kpi);
ok('…and the two genuinely unscoped ones are the only ones counted',
  kpi.some((k) => /^2\s*Scopes to set$/.test(k)), kpi);

console.log('\n3) lanes read as the KIND of work, not a marketing stream');
const legend = await page.$eval('.lgnd', (e) => e.textContent.replace(/\s+/g, ' ').trim());
ok('the legend uses Superdry’s own lane words',
  ['Seasonal focus', 'Vocabulary gap', 'Catalogue sweep', 'Promotion'].every((w) => legend.includes(w)),
  legend);
ok('and none of the generic ones survive in it', !/\bStudio\b|\bLocation\b|\bCampaign\b/.test(legend), legend);

console.log('\n4) every seeded path EXISTS in the live feed, checked against an independent census');
/* THE CIRCULARITY TRAP this section exists to avoid: part 5 builds a product-type index out of the
 * seed's own paths, so a mis-spelled path would be looked up under its own mis-spelling and still
 * resolve — the scope would read "N products" and silently match nothing in the real feed. The
 * check has to come from somewhere the seed cannot influence: ops/calendars/
 * superdry_gb_product_types_2026-09-30.json is the census taken off the live GB feed the day these
 * themes were written (305 distinct primary g:product_type paths). Every seeded path must be in it. */
const census = JSON.parse(fs.readFileSync(path.join(root, 'ops', 'calendars', 'superdry_gb_product_types_2026-09-30.json'), 'utf8'));
const known = census.product_types;
ok('the census is the live GB read, not a hand-written list',
  census.totals.products === 5726 && census.totals.distinct_primary_paths === Object.keys(known).length, census.totals);

const seedSrc = fs.readFileSync(path.join(D, 'FeedSpark_KWCal.html'), 'utf8');
const sdBlock = seedSrc.slice(seedSrc.indexOf('Superdry:{events:['), seedSrc.indexOf('\n]}};', seedSrc.indexOf('Superdry:{events:[')));
const grab = (id) => {
  const at = sdBlock.indexOf("{id:'" + id + "'");
  if (at < 0) return null;
  const m = /pts:\[([\s\S]*?)\]\}/.exec(sdBlock.slice(at, at + 9000));
  return m ? m[1].split("','").map((x) => x.replace(/^'|'$/g, '')) : [];
};
const SCOPED = ['sd_winterintent', 'sd_longline', 'sd_sweater', 'sd_festive', 'sd_fleece', 'sd_wintacc',
  'sd_gifting', 'sd_hoodzip', 'sd_lounge', 'sd_layer', 'sd_varsity'];
let strays = [], total = 0;
SCOPED.forEach((id) => {
  const pts = grab(id) || [];
  total += pts.length;
  pts.forEach((pt) => { if (!known[pt]) strays.push(id + ' → ' + pt); });
});
ok('all eleven scoped themes were read out of the page — 175 paths in all', total === 175, total);
ok('NO seeded path is absent from the live feed', strays.length === 0, strays.slice(0, 5));
// and the figures the notes quote must be the census's own, or the card argues from numbers the
// feed does not support
const sum = (id, k) => (grab(id) || []).reduce((a, pt) => a + (known[pt] ? known[pt][k] : 0), 0);
ok('the winter-outerwear theme really covers the 956 products its note is built on', sum('sd_winterintent', 'products') === 956, sum('sd_winterintent', 'products'));
ok('the knitwear scope really is the 500 products / 443 unkeyworded its note now claims',
  sum('sd_sweater', 'products') === 500 && sum('sd_sweater', 'unkeyworded') === 443,
  { products: sum('sd_sweater', 'products'), unkeyworded: sum('sd_sweater', 'unkeyworded') });
ok('the hoodie scope really is the biggest gap in the feed', sum('sd_hoodzip', 'unkeyworded') === 693, sum('sd_hoodzip', 'unkeyworded'));
// EVERY scoped note must quote the figure its OWN scope produces. The notes first quoted the
// category total, which is larger — a card reading "984 products" beside a button reading "956"
// is a contradiction a reader spots before an AM does.
const noteFig = { sd_winterintent: 956, sd_longline: 325, sd_sweater: 500, sd_festive: 301, sd_fleece: 80,
  sd_wintacc: 196, sd_gifting: 417, sd_hoodzip: 766, sd_lounge: 339, sd_layer: 457, sd_varsity: 147 };
const wrong = Object.keys(noteFig).filter((id) => {
  const at = sdBlock.indexOf("{id:'" + id + "'");
  const note = /note:'([\s\S]*?)',\n/.exec(sdBlock.slice(at, at + 9000));
  return !note || !note[1].includes(String(noteFig[id]));
});
ok('every scoped theme’s note quotes the product count its own scope resolves to', wrong.length === 0, wrong);
ok('…and those counts are the census’s own', Object.keys(noteFig).every((id) => sum(id, 'products') === noteFig[id]),
  Object.keys(noteFig).filter((id) => sum(id, 'products') !== noteFig[id]));
ok('…and the census agrees 60.8% of the catalogue carries no keyword',
  Math.round(census.totals.unkeyworded_products / census.totals.products * 1000) / 10 === 57.5
  && census.keyword_saturation.fs_data_opti_keywords_N === 3481, census.keyword_saturation);

console.log('\n5) the seeded paths resolve against a product-type index');
/* The one way a seeded scope can be quietly worthless: the paths are the feed's own primary
 * g:product_type strings, and the index ⟳ Sync product types builds is keyed on exactly those —
 * so if the spelling, spacing or chevron form drifted, every scope would resolve to 0 products
 * while still LOOKING set. Build an index from the seed's own paths, hand it to a second load as
 * a stored record, and assert the card reports the sum. */
const knitPts = grab('sd_sweater');       // 15 paths  (grab/known come from section 4)
const accPts = grab('sd_wintacc');        // 9 paths
ok('the seed’s knitwear paths were read back out of the page', knitPts.length === 15, knitPts.length);
ok('…and the accessory paths too', accPts.length === 9, accPts.length);

// an index keyed EXACTLY as the live GB feed spells them, with a distinct count per path
const map = {}; let n = 0;
[...knitPts, ...accPts].forEach((pt) => { map[pt] = ++n; });
const knitSum = knitPts.reduce((a, pt) => a + map[pt], 0);
const accSum = accPts.reduce((a, pt) => a + map[pt], 0);

const stored = {
  Superdry: {
    ptidx: { gb: { map, __total: 5726, sat: { n: 2245, cols: 4 }, t: Date.now() } },
    events: [
      { id: 'sd_sweater', name: 'Knitwear — the "sweater" gap', lane: 'studio', date: '2026-10-21', terms: ['sweater'], pts: knitPts },
      { id: 'sd_wintacc', name: 'Winter accessories', lane: 'campaign', date: '2026-11-23', terms: ['beanie'], pts: accPts },
      { id: 'sd_eoss', name: 'End-of-season sale', lane: 'sale', date: '2026-12-26', brandwide: 1, terms: ['sale'] },
      { id: 'sd_fit', name: 'Fit vocabulary', lane: 'studio', date: '2027-01-25', terms: ['oversized'] },
    ],
  },
};
const p2 = await ctx.newPage();
const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
await p2.addInitScript({ content: INIT.replace("if(u.indexOf('/api/kwcal')>=0)return j({});",
  "if(u.indexOf('/api/kwcal')>=0)return j(" + JSON.stringify(stored) + ");") });
await p2.goto('file://' + path.join(D, 'FeedSpark_KWCal.html') + '?client=Superdry');
await p2.waitForTimeout(1400);

const b2 = await p2.$$eval('[data-scope]', (n2) => n2.map((b) => ({ id: b.getAttribute('data-scope'), cls: b.className, txt: b.textContent.trim() })));
const byId = Object.fromEntries(b2.map((b) => [b.id, b]));
ok('no card is left waiting once the index exists', b2.filter((b) => /\bpend\b/.test(b.cls)).length === 0, b2.map((b) => b.txt));
ok('the knitwear scope resolves to the sum of its own paths — every one matched',
  byId.sd_sweater && byId.sd_sweater.txt === knitSum + ' products', { got: byId.sd_sweater?.txt, want: knitSum + ' products' });
ok('…and so does the accessories scope',
  byId.sd_wintacc && byId.sd_wintacc.txt === accSum + ' products', { got: byId.sd_wintacc?.txt, want: accSum + ' products' });
ok('the brand-wide theme states the catalogue total', byId.sd_eoss && /whole catalogue/.test(byId.sd_eoss.txt), byId.sd_eoss?.txt);
ok('the by-design unscoped theme still asks for a scope', byId.sd_fit && /Set scope/.test(byId.sd_fit.txt), byId.sd_fit?.txt);
ok('no page error on the stored-record load', errs2.length === 0, errs2.slice(0, 3));
ok('still no page error on the seeded load', errs.length === 0, errs.slice(0, 3));

await browser.close();
console.log(fail ? `\n${fail} failed` : '\nPASS');
process.exit(fail ? 1 : 0);
