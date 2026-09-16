#!/usr/bin/env node
/*
 * Playbook panel — Workflow's right-hand rail (Ray, 16 Sep 2026).
 *
 * "Let's elevate the workflow like a playbook … the playbook will generate in real time: first,
 *  what the clients are doing well and what they are not doing; second, product volumes for new
 *  products. If a new product accounts for 10% to 20% of total, it should be highlighted because
 *  it indicates a new collection that needs immediate attention. Third, include golden records of
 *  all audit attributes that are not working well … Delete the separate playbook module and
 *  incorporate it into the workflow as the right-hand panel."
 *
 * This is read out loud on client calls, so the judgements it makes are pinned here: which
 * practices count as landing, what "not doing" is allowed to mean, the 10–20% collection band,
 * which month arrivals are read from, and which attributes count as not working.
 *
 * The engine is lifted out of the page between its PBENGINE markers — rename or move it and this
 * fails loudly, which is the point. The second half asserts the module was really retired: the
 * page deleted, the route redirected, the nav swapped on every page, the grant folded away.
 *
 * Run: node tools/test_playbook_panel.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WF = rd('docs/FeedSpark_Workflow.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

// ---- lift the engine ---------------------------------------------------------------------------
const S = WF.indexOf('/* PBENGINE:START'), E = WF.indexOf('/* PBENGINE:END */');
if (S < 0 || E < 0 || E < S) { console.error('✗ PBENGINE markers missing from docs/FeedSpark_Workflow.html'); process.exit(1); }
const block = WF.slice(S, E);
const names = ['pbClassify', 'pbCats', 'pbIndex', 'pbPractice', 'pbBand', 'pbArrivals', 'pbWeak', 'PB_TAX', 'PB_TIER'];
const EN = new Function(block + '\n;return {' + names.map((n) => n + ':' + n).join(',') + '};')();
const { pbClassify, pbCats, pbIndex, pbPractice, pbBand, pbArrivals, pbWeak, PB_TAX, PB_TIER } = EN;

console.log('\n── the classifier');
eq(pbClassify('Keywords Optimisation - Cashmere - Marketing Planner - 0926'), 'keyword', 'a keyword optimisation is a keyword task');
eq(pbClassify('Sale roundel overlay refresh'), 'image', 'a roundel overlay is image work');
eq(pbClassify('Backfill gtin across the DE feed'), 'golden', 'gtin backfill is Golden Record work');
eq(pbClassify('Monthly catch-up'), 'general', 'text matching nothing is general, never forced into a category');
eq(pbClassify('Custom label rebuild', { hide: { labels: 1 } }), 'general', 'a hidden category is not classified into');
eq(pbClassify('Ship the widget', { extra: { image: ['widget'] } }), 'image', 'a tuned extra term classifies');

console.log('\n── practices: done is the plan bucket, not a guess');
const TASKS = [
  { t: 'Title rewrite GB', b: 'done' }, { t: 'Title rewrite DE', b: 'done' },
  { t: 'Title rewrite IE', b: 'done' }, { t: 'Title rewrite FR', b: 'done' }, { t: 'Title rewrite US', b: 'open' },
  { t: 'Custom label CL2 rebuild', b: 'open' }, { t: 'Custom label CL3 rebuild', b: 'open' },
  { t: 'Custom label CL4 rebuild', b: 'done' },
];
const cats = pbCats(TASKS);
eq(cats.title.all, 5, 'five title tasks bucketed');
eq(cats.title.done, 4, 'four of them finished');
eq(cats.labels.open.length, 2, 'the unfinished ones are kept by name, not just counted');

const IDX = pbIndex({
  Reiss: { tasks: TASKS },
  Schuh: { tasks: [{ t: 'Overlay roundel A', b: 'done' }, { t: 'Overlay roundel B', b: 'done' }] },
  Monsoon: { tasks: [{ t: 'Image cycler set-up', b: 'done' }, { t: 'Image cycler refresh', b: 'open' }] },
  YuMOVE: { tasks: [{ t: 'Search intent map', b: 'done' }] },
});
const P = pbPractice(cats, IDX, 'Reiss');
ok(P.well.length === 1 && P.well[0].k === 'title', 'landing = 3+ finished AND 80%+ through');
ok(P.slip.length === 1 && P.slip[0].k === 'labels' && P.slip[0].open === 2, 'stalling = 2+ tasks under 60% through, counted by what is open');
ok(P.gap.some((g) => g.k === 'image' && g.peers === 2), '"not doing" needs TWO peer accounts actually running the play');
ok(!P.gap.some((g) => g.k === 'intent'), 'one peer with a single task is not evidence of a practice');
ok(!P.gap.some((g) => g.k === 'account' || g.k === 'tech'), 'BAU admin is never cross-pollinated onto a client call');
ok(!pbPractice(pbCats([{ t: 'Overlay roundel A', b: 'done' }, { t: 'Overlay roundel B', b: 'done' }]), IDX, 'Schuh').gap.some((g) => g.k === 'image'),
  'a brand is never its own peer — work it already does is not a gap');

console.log('\n── new products: the 10–20% collection band, exactly as asked');
eq(pbBand(0), 'steady', 'nothing new is steady');
eq(pbBand(4.9), 'steady', 'under 5% is steady');
eq(pbBand(5), 'watch', '5% starts building');
eq(pbBand(9.9), 'watch', '9.9% is still building, not a collection');
eq(pbBand(10), 'collection', '10% IS a collection landing — the lower edge Ray named');
eq(pbBand(19.9), 'collection', 'the whole 10–20% band is a collection');
// above the band is the SAME signal louder, so it is still highlighted — never dropped off the top
eq(pbBand(20), 'major', '20%+ is a major drop, still highlighted');
eq(pbBand(35), 'major', 'a third of the catalogue arriving at once is the loudest case there is');

const NOW = Date.UTC(2026, 8, 16);                       // 16 Sep 2026
const dob = { rows: 10000, m: { '2026-06': 300, '2026-07': 1200, '2026-08': 1500, '2026-09': 90 } };
const a = pbArrivals(dob, NOW);
eq(a.month, '2026-08', 'arrivals read the last COMPLETE month, never the running one');
eq(a.n, 1500, 'that month’s count');
eq(Math.round(a.pct * 10) / 10, 15, '15% of the catalogue');
eq(a.band, 'collection', '15% highlights as a collection');
ok(pbArrivals(null, NOW) === null, 'no histogram = no answer (never a zero)');
ok(pbArrivals({ rows: 10, m: { '2026-09': 5 } }, NOW) === null, 'a feed with only the running month has no complete month yet');
eq(pbArrivals({ rows: 0, m: { '2026-08': 5 } }, NOW).pct, 0, 'an empty catalogue never divides by zero');

console.log('\n── Golden Record: what is not working');
const rec = {
  score: 88,
  reqMissing: ['image_link'],
  condMissing: ['gtin'],
  recMissing: ['product_highlight'],
  cov: { id: 1, title: 1, description: 0.97, price: 1, brand: 1, color: 0.72, product_type: 0.55, material: 0.9,
    question_and_answer: 0.02, image_link: null },
};
const W = pbWeak(rec);
const keys = W.map((w) => w.k);
eq(keys[0], 'image_link', 'a MISSING required attribute is the worst thing on the feed');
ok(keys.indexOf('description') > 0 && keys.indexOf('description') < keys.indexOf('product_type'),
  'a required attribute under 99% outranks a thin recommended one');
ok(keys.includes('gtin'), 'a missing conditional attribute is listed');
ok(keys.includes('color'), 'a conditional attribute under 90% is listed');
ok(keys.includes('product_type'), 'a recommended attribute under 60% is listed');
ok(!keys.includes('material'), 'a recommended attribute at 90% is fine — not everything is a problem');
ok(!keys.includes('title') && !keys.includes('price'), 'a fully-filled required attribute is not listed');
ok(!keys.includes('question_and_answer'), 'the conversational AI six are supplemental by design — never scored as a failure here');
eq(keys.filter((k) => k === 'image_link').length, 1, 'a missing attribute is listed once, not again from the coverage map');
ok(pbWeak(null).length === 0, 'an unscanned feed yields nothing — absent is not zero');
ok(Object.keys(PB_TIER).filter((k) => PB_TIER[k] === 'req').length === 7, 'Google’s seven always-required attributes');

console.log('\n── the panel is wired into Workflow');
ok(/id="fcc-hrs-dock"/.test(WF), 'the retainer read-out has a home in the LEFT rail');
ok(/id="ck-r-body"/.test(WF) && /id="ck-brand"/.test(WF), 'the playbook is the RIGHT rail, with its own account picker');
ok(/body\.ck-l-on\{padding-left/.test(WF) && /body\.ck-r-on\{padding-right/.test(WF),
  'both rails PUSH the page — the complaint was that the popover covered the tasks and brands');
ok(/\/api\/playbook/.test(WF) && /\/api\/volume\/arrivals/.test(WF) && /\/api\/golden\/estate/.test(WF),
  'all three sections read live routes, not baked figures');
ok(PB_TAX.length >= 16, 'the strategy taxonomy came across whole');

console.log('\n── the standalone module is really gone');
ok(!fs.existsSync(path.join(root, 'docs/FeedSpark_Playbook.html')), 'the /playbook page is deleted');
const W2 = rd('cloudflare/feedspark-deck/src/worker.js');
ok(!/PLAYBOOK_PAGE/.test(W2), 'the worker no longer imports a playbook page');
ok(/path === '\/playbook'[\s\S]{0,220}Location: '\/workflow\?pb=1'/.test(W2), '/playbook 301s onto the rail, so old links still land');
ok(/\/api\/playbook' && request\.method === 'GET'/.test(W2), 'the crawl that feeds it survives — only the page went');
ok(/h\.replace\(\/\[\?#\]\.\*\$\/,""\)/.test(W2), 'MODGATE strips a query string before reading a nav link’s module slug');
const acc = rd('cloudflare/feedspark-deck/src/access.js');
ok(!/slug: 'playbook'/.test(acc), 'the Playbook is no longer separately grantable — it rides the workflow grant');

const navPages = fs.readdirSync(path.join(root, 'docs')).filter((f) => /^FeedSpark_.*\.html$/.test(f))
  .filter((f) => /tb-nav tb-modules/.test(rd('docs/' + f)));
ok(navPages.length >= 20, 'every app page was checked (' + navPages.length + ')');
const bad = navPages.filter((f) => { const s = rd('docs/' + f); return /href="\/playbook"/.test(s) || !/href="\/workflow\?pb=1"/.test(s); });
ok(bad.length === 0, 'no page still links the retired module, and every page carries the new Playbook icon' + (bad.length ? ' — ' + bad.join(', ') : ''));
const act = navPages.filter((f) => { const s = rd('docs/' + f); const n = s.match(/<nav class="tb-nav tb-modules"[^>]*>([\s\S]*?)<\/nav>/)[1];
  return n.indexOf('href="/workflow?pb=1"') < n.indexOf('href="/activity"'); });
ok(act.length === 0, 'the Playbook icon sits NEXT TO the Activity/Build Log icon, as asked');

const HW = rd('docs/hours_widget.html');
ok(/function dockShow\(/.test(HW) && /fcc-hrs-dock/.test(HW), 'the hours widget can render into a page’s own panel');
ok(/function hoverOpen\(b\) \{ if \(dockEl\(\)\) return;/.test(HW),
  'once docked, HOVER opens nothing — the read-out never covers the board again');
ok(/\.fh-body \.fh-pill/.test(HW), 'the popover’s styling is shared with the docked home, not duplicated');

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (fail ? fail + ' failed, ' : '') + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
