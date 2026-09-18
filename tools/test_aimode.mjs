#!/usr/bin/env node
/*
 * AI MODE — the conversational attributes priced by DATA SOURCE (Ray, 17 Sep 2026:
 * "mirror this artifact to import inside the quote generator for AI, using the exact same
 * calculation logic").
 *
 * The point of this harness is the word EXACT. The pricing model came in from a separate
 * builder Ray had already signed off on, so the numbers it produces are the contract: a
 * later tidy-up of docs/FeedSpark_AIQuote.html must not quietly move a rate, drop the
 * scrape-once rule, lose the AI monthly floor or start rounding mid-calculation.
 *
 * The engine is lifted verbatim out of the page between its AIMODE:ENGINE markers and run in
 * a bare sandbox — which also pins that the block stays free of page globals, since anything
 * it reached for would throw here.
 *
 * Run: node tools/test_aimode.mjs
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join('docs', 'FeedSpark_AIQuote.html');
const src = fs.readFileSync(path.join(root, PAGE), 'utf8');

let fails = 0, n = 0;
function ok(cond, what, extra) {
  n++;
  if (cond) return;
  fails++;
  console.log('  ✗ ' + what + (extra ? '\n      ' + extra : ''));
}
function eq(a, b, what) { ok(a === b, what, `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
// money comes out unrounded on purpose — compare to the penny
function near(a, b, what) { ok(Math.abs(a - b) < 0.005, what, `got ${a}, expected ${b}`); }

/* ---------- lift the engine ---------- */
const A = src.indexOf('/* AIMODE:ENGINE-START');
const B = src.indexOf('/* AIMODE:ENGINE-END */');
if (A < 0 || B < 0 || B < A) {
  console.log('AI Mode: the AIMODE:ENGINE markers are gone from ' + PAGE + ' — the engine can no longer be pinned.');
  process.exit(1);
}
const engine = src.slice(A, B);
const sandbox = {};
vm.createContext(sandbox);
try {
  vm.runInContext(engine + '\n;this.E={AIM_RATE_DEFAULT:AIM_RATE_DEFAULT,AIM_NEWNESS_DEFAULT:AIM_NEWNESS_DEFAULT,' +
    'AIM_ATTRS:AIM_ATTRS,AIM_ROUTE_LABEL:AIM_ROUTE_LABEL,AIM_RATE_ORDER:AIM_RATE_ORDER,AIM_RATE_LABEL:AIM_RATE_LABEL,' +
    'aimHourly:aimHourly,aimParseDate:aimParseDate,aimNewness:aimNewness,aimBuild:aimBuild};', sandbox);
} catch (e) {
  console.log('AI Mode: the engine block does not run on its own — it has reached for a page global.\n  ' + e.message);
  process.exit(1);
}
const E = sandbox.E;
const R = () => JSON.parse(JSON.stringify(E.AIM_RATE_DEFAULT));

console.log('AI Mode — the builder\'s own model, unchanged\n');

/* ---------- 1. the rate card ---------- */
console.log('  rates and attributes');
const D = E.AIM_RATE_DEFAULT;
eq(D.dayRate, 695, 'day rate is £695');
eq(D.hoursPerDay, 8, 'a day is 8 hours');
eq(D.hoursSupplied, 2, 'adding a field to the master feed is 2h');
eq(D.hoursScrape, 2, 'a scraped field is 2h to configure');
eq(D.scrapeMonthly, 100, 'the scrape run is £100 a month');
eq(D.aiSetupDays, 2, 'AI set-up is 2 days per field');
eq(D.aiPerField, 0.10, 'AI generation is £0.10 per field');
eq(D.aiMinMonthly, 100, 'the AI monthly minimum is £100');
eq(D.hoursFeedHero, 2, 'a FeedHero rule is 2h');
eq(D.buffer, 10, 'the volume buffer is 10%');
eq(E.AIM_NEWNESS_DEFAULT, 10.5, "the fallback newness is FeedSpark's 10.5% a year");
near(E.aimHourly(R()), 86.875, 'the effective hourly rate is the day rate over the hours in a day');

eq(E.AIM_ATTRS.length, 7, 'seven rows — the conversational six plus product highlights');
const keys = E.AIM_ATTRS.map(a => a.key).join(',');
eq(keys, 'question_and_answer,document_link,related_product,item_group_title,variant_option,product_highlight,popularity_rank',
  'the attributes are Google\'s own, in the builder\'s order');
const aiable = E.AIM_ATTRS.filter(a => a.routes.indexOf('ai') >= 0).map(a => a.id).join(',');
eq(aiable, 'qa,igt,hi', 'only Q&A, item group title and product highlight can be AI-generated');
const pop = E.AIM_ATTRS.filter(a => a.id === 'pop')[0];
eq(pop.routes.join(','), 'feedhero', 'popularity rank is FeedHero and nothing else');
E.AIM_ATTRS.forEach(a => ok(a.routes.indexOf('feed') >= 0 && a.routes.indexOf('scrape') >= 0 || a.id === 'pop',
  `${a.key} can always be supplied or scraped`));

/* ---------- 2. one route at a time ---------- */
console.log('\n  each route costs what it costs');
const hr = E.aimHourly(R());

let q = E.aimBuild({ qa: 'feed' }, R(), 10000, 100);
eq(q.lines.length, 1, 'a master-feed field is one line');
near(q.setup, 2 * hr, 'a master-feed field is its configuration hours');
eq(q.monthly, 0, 'a master-feed field costs nothing monthly');
eq(q.hours, 2, 'and takes 2h');

q = E.aimBuild({ pop: 'feedhero' }, R(), 10000, 100);
near(q.setup, 2 * hr, 'a FeedHero rule is the hours to build it');
eq(q.monthly, 0, 'a FeedHero rule costs nothing monthly');
ok(/Google Ads/.test(q.lines[0].detail), 'popularity rank says where it is computed from');

q = E.aimBuild({ doc: 'scrape' }, R(), 10000, 100);
near(q.setup, 2 * hr, 'a scraped field is its configuration hours');
eq(q.monthly, 100, 'and carries the scrape run');

/* the AI shape: a per-field set-up in DAYS, plus the whole range once, then the new ones monthly */
q = E.aimBuild({ qa: 'ai' }, R(), 10000, 100);
near(q.setup, 2 * 8 * hr + 10000 * 0.10, 'an AI field is 2 days of set-up plus the range at £0.10 each');
near(q.setup, 2390, 'which on 10,000 products is £2,390');
near(q.monthly, 100, '100 new a month at £0.10 is £10 — lifted to the £100 floor');
eq(q.hours, 16, 'the AI set-up is counted as 16h of our time');

/* ---------- 3. the scrape is charged ONCE, however many fields ride it ---------- */
console.log('\n  the scrape run is charged once, not per field');
q = E.aimBuild({ doc: 'scrape', rel: 'scrape', vopt: 'scrape' }, R(), 10000, 100);
eq(q.counts.scrape, 3, 'three scraped fields');
near(q.setup, 3 * 2 * hr, 'each one still costs its own configuration hours');
eq(q.monthly, 100, 'but there is one scrape run, not three');
eq(q.lines[0].monthlyNote, null, 'the first scraped field carries the charge');
eq(q.lines[1].monthlyNote, 'Included', 'the second says it is included');
eq(q.lines[2].monthlyNote, 'Included', 'and so does the third');
ok(/charged once/.test(q.lines[0].detail), 'the first line says the charge covers every scraped field');
ok(/covered by the scrape running cost above/.test(q.lines[1].detail), 'the second says what covers it');

/* ---------- 4. the AI monthly floor ---------- */
console.log('\n  the AI monthly minimum is its own line, never hidden inside another');
q = E.aimBuild({ qa: 'ai' }, R(), 10000, 100);
const floorLine = q.lines.filter(l => l.shared)[0];
ok(!!floorLine, 'a top-up line appears when the AI months fall under the floor');
eq(floorLine.key, 'minimum', 'and it is named as the minimum');
near(floorLine.monthly, 90, '£10 of generation is topped up by £90');
eq(floorLine.setup, 0, 'the top-up is monthly only');

/* three AI fields on 4,000 new a month clear the floor on their own */
q = E.aimBuild({ qa: 'ai', igt: 'ai', hi: 'ai' }, R(), 10000, 4000);
eq(q.lines.filter(l => l.shared).length, 0, 'no top-up once the generation clears the minimum');
near(q.monthly, 3 * 4000 * 0.10, 'three AI fields × 4,000 new × £0.10 = £1,200 a month');

/* the boundary: exactly at the floor is not under it */
q = E.aimBuild({ qa: 'ai' }, R(), 10000, 1000);
eq(q.lines.filter(l => l.shared).length, 0, '£100 exactly is not under the £100 minimum');
near(q.monthly, 100, 'and stands as the £100 it earned');

/* ---------- 5. new products are always rounded UP ---------- */
console.log('\n  a part product is a whole product');
q = E.aimBuild({ qa: 'ai', igt: 'ai' }, R(), 10000, 1050.4);
eq(q.newPer, 1051, '1,050.4 new a month is quoted as 1,051');
near(q.monthly, 2 * 1051 * 0.10, 'and every AI field is charged on that same whole number');

/* ---------- 6. newness ---------- */
console.log('\n  newness, and the volume buffer on top');
let nn = E.aimNewness(10000, 10.5, 10);
near(nn.perYear, 1050, '10.5% of 10,000 is 1,050 a year');
near(nn.perMonthRaw, 87.5, 'which is 87.5 a month');
near(nn.perMonth, 96.25, 'and 96.25 with the 10% buffer');
eq(E.aimNewness(10000, -4, 10).pct, 0, 'a negative newness is read as zero, never as a credit');
eq(E.aimNewness(10000, NaN, 10).pct, 0, 'and so is a number that is not one');
near(E.aimNewness(10000, 10.5, 0).perMonth, 87.5, 'no buffer leaves the plain twelfth alone');

/* ---------- 7. dates the way feeds actually write them ---------- */
console.log('\n  the first-seen date, read the way feeds write it');
const d = (s) => { const v = E.aimParseDate(s); return v ? [v.getFullYear(), v.getMonth() + 1, v.getDate()].join('-') : null; };
eq(d('2026-03-04'), '2026-3-4', 'ISO');
eq(d('04/03/2026'), '2026-3-4', 'dd/mm/yyyy reads UK order');
eq(d('13/03/2026'), '2026-3-13', 'a day over 12 confirms the UK order');
eq(d('03/13/2026'), '2026-3-13', 'and a MONTH over 12 is read the American way rather than refused');
eq(d('20260304'), '2026-3-4', 'bare YYYYMMDD');
eq(d(''), null, 'an empty cell has no date');
eq(d('n/a'), null, 'and neither does a placeholder');
eq(E.aimParseDate(null), null, 'a missing value is not a date');

/* ---------- 8. the whole thing, on one worked quote ---------- */
console.log('\n  a whole quote adds up');
q = E.aimBuild({ qa: 'ai', igt: 'ai', hi: 'ai', doc: 'scrape', rel: 'scrape', vopt: 'feed', pop: 'feedhero' }, R(), 20000, 250);
eq(q.counts.ai, 3, '3 by AI');
eq(q.counts.scrape, 2, '2 scraped');
eq(q.counts.feed, 1, '1 in the master feed');
eq(q.counts.fh, 1, '1 as a FeedHero rule');
const expSetup = 3 * (2 * 8 * hr + 20000 * 0.10) + 2 * (2 * hr) + 1 * (2 * hr) + 1 * (2 * hr);
near(q.setup, expSetup, 'the set-up is every route added up');
/* 3 AI fields × 250 new × £0.10 = £75, which is under the floor, so the AI side is £100; the
   scrape run is £100 of its own and sits OUTSIDE the floor — the minimum is an AI minimum, and
   reading it as a floor on the whole card would swallow the scrape and undercharge by £100 */
near(q.monthly, 200, 'the monthly is the AI side at its floor plus one scrape run');
near(q.lines.filter(l => l.shared)[0].monthly, 25, 'the top-up lifts £75 of generation to £100');
near(q.lines.filter(l => l.route === 'ai').reduce((a, l) => a + l.monthly, 0), 100,
  'the floor is measured across the AI fields only, never across the scrape');
near(q.year1, q.setup + q.monthly * 12, 'year one is the set-up plus twelve months');
eq(q.hours, 3 * 16 + 2 * 2 + 2 + 2, 'and our time is every route’s hours');

/* the man-power split the FCC's discount rule needs */
console.log('\n  man power is split out, because the Discount % column excludes it');
q.lines.forEach(l => {
  if (l.shared) return;
  near(l.man + l.gen, l.setup, `${l.key}: hours + generation = its set-up`);
});
const aiLine = q.lines.filter(l => l.route === 'ai')[0];
near(aiLine.gen, 20000 * 0.10, 'only the per-product generation is outside man power');
const feedLine = q.lines.filter(l => l.route === 'feed')[0];
eq(feedLine.gen, 0, 'a master-feed field is man power end to end');

/* ---------- 9. nothing routed ---------- */
console.log('\n  an untouched card prices nothing');
q = E.aimBuild({}, R(), 20000, 250);
eq(q.lines.length, 0, 'no lines');
eq(q.setup, 0, 'no set-up');
eq(q.monthly, 0, 'no monthly');
q = E.aimBuild({ qa: 'off', doc: 'off' }, R(), 20000, 250);
eq(q.lines.length, 0, 'and an explicit Ignore is not a line either');

/* ---------- 10. the page keeps its side of the bargain ---------- */
console.log('\n  the page still uses it');
ok(/function aimInfo\(\)/.test(src), 'aimInfo() — the page\'s entry into the engine');
ok(/aim:aq,aimOne:aimOne,aimMon:aimMon/.test(src), 'totals() carries the AI Mode figures');
ok(/data-tp="aim"/.test(src), 'the card is wired to the AI Mode quote type');
ok(/\['aim','AI Mode attributes'/.test(src), 'and the type is offered in "What are you quoting?"');
ok(/function aimPerMonth\(\)/.test(src) && /updExpected\(\)/.test(src),
  'new products a month come from the Monthly update card, not a second newness step');
/* Ray, 18 Sep 2026: "why don't you bring the new product volume arrival bar chart that looks
   really beautiful over to this section too?" — so the chart IS here now, but drawn by the
   Monthly update card's own updBars off ONE shared series builder, never a second implementation
   that could show a client a shape /volume would disagree with. */
ok(/function aimChart\(nn\)/.test(src), 'the card draws the arrivals chart');
ok(/function updMonthRows\(\)/.test(src) && /function updDayRows\(\)/.test(src),
  'off ONE series builder shared with the Monthly update card');
ok((src.match(/updMonthRows\(\)/g) || []).length >= 3, 'and both cards call it rather than building their own');
ok(/id="aim-chart"[\s\S]{0,300}Catalogue in scope/.test(src), 'the chart sits above the scoped rows it is evidence for');
ok(!/function aimBars\(/.test(src), 'and there is no second bar renderer');
/* the contradiction Ray screenshotted: "0 products in scope" over "1,534 / month at this scope" */
ok(/unsized=\(!ix&&sc\.mode!=='manual'\)/.test(src),
  'an unsized card knows it is unsized');
ok(/nn\.unsized\?'\u2014 pull the feed'/.test(src),
  'and prints a dash rather than a scoped figure it cannot know');
ok(/id="aim-pull"/.test(src) && /if\(t\.id==='aim-pull'\)\{ pullFeed\(\); return; \}/.test(src),
  'the pull action sits in the card, on the hero\'s own pullFeed()');
/* the arrivals fetch resolves once; BOTH cards read that record, so both must be redrawn or the
   AI Mode chart never appears until something else re-renders the page */
ok(/renderUpd\(\); try\{ renderAim\(\); \}catch\(e\)\{\} foot\(\);/.test(src),
  'and the arrivals load redraws both cards, not just the Monthly update one');
ok(/AIM_DOB_PATS/.test(src) && /dob:\(dbc>=0\?/.test(src),
  'the live pull captures the feed\'s first-seen date column on the same stream');
ok(/function aimRefresh\(\)/.test(src), 'aimRefresh() moves the numbers without rewriting an input');
/* .qp is the page's shared pill LOOK. The scope quick-pick handler had no data-qp guard, so the
   quote-type buttons, the market chips and this card's unit toggle all fell through to its else
   branch and set scope={mode:'manual',manual:NaN} — picking a quote type zeroed the product
   scope and every SKU count with it. Pinned because the guard is one line and looks removable. */
ok(/var q=b\.getAttribute\('data-qp'\); if\(q==null\)return;/.test(src),
  'the scope quick-pick handler answers only to buttons that carry data-qp');

/* ---------- 11. Ray, 18 Sep 2026: "i cannot save AI Mode quote btw" ---------- */
console.log('\n  an AI Mode quote can be saved');
ok(/function qLineN\(t\)\{/.test(src), 'the quote\'s lines are counted in ONE named place');
ok(/if\(!qLineN\(t\)\)\{ err\(/.test(src), 'and the save guard asks that count, not two of the four line types');
const ln = (src.match(/function qLineN\(t\)\{[\s\S]*?\n  \}/) || [''])[0];
ok(/\(\+t\.inc\|\|0\)/.test(ln), 'it counts the ticked Tachyon fields');
ok(/t\.x&&t\.x\.length/.test(ln), '…the system / feed / retainer lines');
ok(/t\.aim&&t\.aim\.lines/.test(ln), '…every routed AI Mode attribute');
ok(/t\.upd\?1:0/.test(ln), '…and the monthly new-product bundle');
ok(!/if\(!t\.inc&&!t\.x\.length\)/.test(src), 'the old two-type guard is gone');
ok(/route an AI Mode attribute to a data source/.test(src) && /new-product bundle/.test(src),
  'and the refusal on a genuinely empty quote names every way to fill it');

/* ---------- 12. Ray, same message: "also allows all text can be edited please" ---------- */
console.log('\n  and every word on the card can be reworded');
ok(/window\.DECK_EDITOR_SELECTOR=/.test(src), 'the page declares its own editable surface');
const sel = (src.match(/window\.DECK_EDITOR_SELECTOR=[\s\S]*?;/) || [''])[0];
ok(/\.card > \.ch/.test(sel), 'every card explanation is in it');
ok(/\.aim-lbl/.test(sel), 'so is every AI Mode row label');
ok(/\.aim-note/.test(sel) && /\.qs-h/.test(sel), '…the scrape note and the summary column headings');
/* a derived sentence must NEVER be editable: the edit freezes the number inside it, and a frozen
   number on a client quote is a wrong number. */
ok(!/aim-srcline/.test(sel) && !/aim-word/.test(sel) && !/\.hint/.test(sel),
  'and no line that carries a live figure is - an edited sentence would freeze it');
/* the editor keys each element ONCE at load, so copy a render redraws can never hold an edit */
ok(/<div class="aim-note">/.test(src), 'the scrape note lives in the template, not in a render');
ok(/<span class="aim-lbl">Catalogue in scope<\/span>/.test(src), 'and so does every foot row label');
ok(/function aimFoot\(q\)\{/.test(src), 'aimFoot() fills that shell');
ok(/el\.innerHTML=h;\s*\n\s*aimFoot\(q\);/.test(src), 'and the render calls it');
ok(/function aimNums\(q\)\{/.test(src) && (src.match(/aimNums\(q\)/g) || []).length >= 3,
  'one place writes the figures, and both the render and the refresh use it');
ok(!/h\+='<div class="aim-note">/.test(src) && !/h\+='<div class="aim-foot">/.test(src),
  'nothing rebuilds the prose as HTML any more');
ok(/pi&&pi!==document\.activeElement/.test(src),
  'and the newness box is left alone while somebody is typing in it');

/* ---------- 13. Delivered — Ray, 18 Sep 2026 ---------- */
console.log('\n  Delivered, and ASPL\'s own confirmation');
ok(/'In action','Delivered','Billed'/.test(src), 'Delivered sits between In action and Billed');
ok(/var WF_DELIVERED=\{done:1,running:1,analysis:1,confirmed:1\}/.test(src),
  'every Workflow stage from "Done — ASPL" on means the work was delivered');
ok(/function loadQBriefs\(\)/.test(src) && /fetch\('\/api\/briefs'\)/.test(src),
  'the tracker reads the brief pipeline');
ok(/refs\.sort\(function\(a,b\)\{ return b\.ref\.length-a\.ref\.length; \}\)/.test(src),
  'the LONGEST quote ref claims a ticket, so QT500-2 is never taken for QT500');
ok(/if\(b\.client&&r\.client&&String\(b\.client\)!==String\(r\.client\)\)break;/.test(src),
  'and another brand\'s ticket can never land on this quote');
ok(/function autoDeliver\(\)/.test(src) && /if\(q\.aspl\)return;/.test(src),
  'the pipeline moves a quote once and then stands down - a human\'s later call stands');
ok(/if\(q\.stage==='Declined'\|\|si<0\|\|si>=di\)return;/.test(src),
  'and never moves a Billed or Declined quote, or moves one backwards');
ok(/Delivered · not billed/.test(src), 'finance gets the figure it exists for: delivered, not yet billed');
ok(/no ticket yet/.test(src), 'and a filed quote with no matching ticket says so');

console.log('\n' + (fails ? `✗ ${fails} of ${n} failed` : `✓ all ${n} passed`));
process.exit(fails ? 1 : 0);
