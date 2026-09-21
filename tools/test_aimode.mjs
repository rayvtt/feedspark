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
/* NO ANNUAL FIGURE ANYWHERE (Ray, 18 Sep 2026: "move annual cost lines or anything related to
   annual cost (pro-rata) not neccessary (Across all quotes)"). A Year-1 total adds a one-off to
   twelve months, which re-mixes exactly what the CFO rework pulled apart. The engine no longer
   computes one, so no surface can quietly print one again. */
ok(q.year1 === undefined, 'the engine carries no year-one total', q.year1);
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
ok(/\['aim','Spark AI'/.test(src), 'and the type is offered in "What are you quoting?" as Spark AI');
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
ok(/route a Spark AI attribute to a data source/.test(src) && /new-product bundle/.test(src),
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
ok(/🎫 no ticket/.test(src) && /no Workflow ticket carries this quote/.test(src), 'and a filed quote with no matching ticket says so');

/* ---------- 14. nothing annual, on any surface (Ray, 18 Sep 2026) ---------- */
console.log('\n  and no quote surface carries an annual or pro-rated figure');
ok(!/year1/.test(src), 'the page computes no year-one total');
ok(!/id="aim-y1"|id="qs-annual"/.test(src), 'the AI Mode card and the summary tile have no annual row');
ok(!/Year 1 Total|Total Annual|Pro-rated /.test(src), 'the finance workbook has no Annual, Pro-rated or Year 1 row');
ok(!/monGross\*12|monNet\*12|monGross \* 12/.test(src),
  'and nothing multiplies a monthly figure by twelve — not the bottom line, the copy text, the email, the brief or the tracker');
/* the pro-rated row assumed a January contract year-end, so on any other client it printed a
   figure nobody had agreed - it is gone, not re-derived */
ok(!/contract year assumed to end in January/.test(src), 'and the assumed January contract year-end is gone with it');
/* what MUST survive: the arrivals figures are counts of PRODUCTS, not money */
ok(/a year/.test(src), 'new products a year still reads — it is a count, not a cost');

/* ---------- 15. a flex row ignores `hidden` ---------- */
/* The UA's [hidden]{display:none} loses to any class that sets display, so el.hidden=true on one
   of these rows left it ON SCREEN with an empty value in it - the newness pair drew BOTH ("Arrivals
   run-rate 0 / month" above the typed % box) and the quote summary's AI Mode rows had been showing
   empty since they shipped. Caught by looking at the render, not the code. */
ok(/\.aim-r\[hidden\],\.qs-r\[hidden\]\{display:none\}/.test(src),
  'the rows the page hides by attribute are actually hidden');

/* ---------- 16. the run-rate a quote is priced on ---------- */
/* Ray, 18 Sep 2026: "The logic for new products a month is not accurate. For example, Monsoon had
   10,298 divided by 12. It's not 1,534." The engine's own rule is pinned by tools/test_arrivals.mjs
   on Ray's exact numbers; what this pins is that the card's KPI reads the PRICED figure. A KPI
   disagreeing with the line under it is how a quote gets argued about in front of a client. */
ok(/updKpi\(st\.forecast\?fmt\(st\.forecast\.month\):'—','Run-rate \/ month'\)/.test(src),
  'the Monthly update KPI reads the forecast, not a second average of its own');

/* ---------- 17. Ray, 21 Sep 2026: the section is Spark AI ---------- */
console.log('\n  the section is called Spark AI');
ok(/<h3>Spark AI &mdash; priced by data source<\/h3>/.test(src), 'the card heading');
ok(!/AI Mode/.test(src), 'and nothing on the page still says "AI Mode"');
/* the KEY is untouched - a saved quote carries types.aim and q.aim, so renaming the label must
   never rename the record, or every quote finance already signed off would read as empty */
ok(/\['aim','Spark AI'/.test(src) && /data-tp="aim"/.test(src) && /typesRec\(\)\.aim/.test(src),
  'the record key stays `aim`, so every saved quote still reads');

/* ---------- 18. the arrival cohort ---------- */
/* Ray: "within the charge per product ID, allow selection - for example, if clients only want to
   optimize for new collections ... based on date of birth ... any product that arrives after
   August 2026." */
console.log('\n  and it generates for the cohort you pick');
ok(/AIQUOTE-COHORT/.test(src), 'the cohort is one named, documented block');
ok(/rowsM:dRowM,parsM:dParM,ptM:dPtM/.test(src),
  'the pull buckets first-seen dates by MONTH - rows, parents and per product type');
ok(/function aimYm\(ms\)/.test(src), 'with one month key, so a cutoff is a string compare and never a timezone');
ok(/function aimCoSeries\(\)/.test(src) && /function aimCoMonths\(\)/.test(src) && /function aimCohort\(\)/.test(src),
  'ONE pass builds the months, the options and the selected count');
ok(/id="aim-since"/.test(src), 'the control is on the card');
ok(/function aimCoWhy\(\)/.test(src) && /carries no first-seen date column/.test(src),
  'and says why it cannot be offered rather than sitting dead');

/* THE RULE THAT KEEPS THE QUOTE HONEST: a cohort narrows what is generated ONCE, never the
   monthly flow - every product that arrives next month is in the cohort by definition, so
   scaling the ongoing figure down by the cohort's share would undercharge the part of the
   service that never ends. */
ok(/function aimUnits\(\)\{ var c=aimCohort\(\); return c\?c\.units:aimScopeUnits\(\); \}/.test(src),
  'the ONE-OFF range is the cohort');
ok(/function aimScopeUnits\(\)/.test(src), 'the product-type scope is its own count');
/* pinned on the declaration line rather than by brace-matching the body: `u` is the one figure
   the whole monthly read is built from, and it must be the SCOPE count */
ok(/function aimPerMonth\(\)\{\s*\n\s*var buf=[^\n]*u=aimScopeUnits\(\)/.test(src),
  'and the PER-MONTH figure reads the scope, never the cohort');
ok(/nn=aimNewness\(u,aimPct\(\),aimRate\('buffer'\)\)/.test(src),
  '…including the newness fallback, which is fed the same scope figure');

/* an undated product cannot be shown to have arrived after the cutoff */
ok(/undated:Math\.max\(0,s\.scope-s\.dated\)/.test(src), 'undated products are counted out');
ok(/carry no first-seen date and are left out/.test(src), '…and the card says how many');
ok(/per-month figure below is untouched/.test(src), 'the hint states the monthly rule on screen');

/* a selection made on the whole catalogue must survive narrowing the product-type scope */
ok(/months\.push\(\{ym:since,n:0,cum:\(c\?c\.units:0\)\}\)/.test(src),
  'a month the current scope cannot reach is still shown, reading 0, rather than silently cleared');

/* it changes what the client is buying, so it leaves the page with every figure */
ok(/since:t\.aim\.since\|\|null/.test(src), 'the snapshot records it');
ok(/r\.aim\.since=\(typeof q\.aim\.since==='string'\)/.test(src), '…and ✎ Edit restores it');
ok((src.match(/Generated for products that arrived since/g) || []).length >= 2,
  'the copy text, the client email and the brief all name the cohort');
ok(/Spark AI cohort: generated for products that arrived since/.test(src),
  'and so does the finance workbook, where the quantity alone would not say which products');

/* ---------- 19. Ray, 21 Sep 2026: a proposal is 1–4 options, and one of them wins ---------- */
console.log('\n  a quote can be one option of a proposal');
ok(/AIQUOTE-OPTIONS/.test(src), 'options are one named, documented block');
/* AN OPTION IS A QUOTE - no parallel record type, so it keeps its own ref, email, brief and rail */
ok(/function qProp\(q\)/.test(src) && /q\.prop\.id===pid/.test(src),
  'an option is a saved quote carrying prop {id,n,label}');
ok(/!q\.superseded&&qProp\(q\)/.test(src),
  'an edited option leaves the proposal as an EARLIER VERSION, so it is never counted twice');
ok(/if\(qProp\(old\)\)snap\.prop=\{id:old\.prop\.id,n:old\.prop\.n/.test(src),
  'and its replacement inherits the option, so ✎ Edit of option 2 stays option 2');

/* THE CHOICE, and who it belongs to */
ok(/function propChosenId\(pid\)\{ var win=null,wt=-1;/.test(src) && /if\(c&&\+c\.t>wt\)/.test(src),
  'the NEWEST choice wins on read, so two AMs clicking before a merge settle on one answer');
ok(/optsFor\(p\.id\)\.forEach\(function\(x\)\{ if\(SAVED\[x\]\.chosen\)delete SAVED\[x\]\.chosen; \}\)/.test(src),
  'choosing one option un-chooses its siblings — never two winners');
const ch = (src.match(/function chooseOpt\(k\)\{[\s\S]*?putSaved\([^\n]*\n/) || [''])[0];
ok(!/stage/.test(ch),
  'and choosing NEVER touches the stage rail — the client\'s decision is not finance\'s');
ok(/was===k/.test(ch), 'it is a toggle, because a client may change their mind');
ok(/not taken — client chose/.test(src) && !/stage='Declined'/.test(ch),
  'a sibling reads NOT TAKEN, never Declined — different facts about different people');

/* THE MONEY: three options at £5k are one £5k opportunity, not £15k */
ok(/function countedIds\(ids\)/.test(src), 'a proposal contributes ONE quote to every money figure');
ok(/out\[ch\|\|optsFor\(p\.id\)\[0\]\|\|k\]=1/.test(src),
  '…the chosen option, or the lowest-numbered one until the client picks');
ok(/if\(!CNT\[k\]\)return;/.test(src), 'and the KPI loop honours it');
ok(/counts a proposal once, at its chosen option/.test(src), 'the board says so, so nobody reads it as three deals');

/* BUILDING THE NEXT ONE is a different mode from editing this one */
ok(/var PENDING_OPT=null;/.test(src) && /function addOption\(k\)/.test(src),
  '➕ Add option is its own mode');
ok(/EDITING=null; PENDING_OPT=\{pid:p\.id,n:n,label:''\};/.test(src),
  '…and it clears EDITING, so a save stores a SIBLING rather than a new version');
ok(/while\(used\[n\]\)n\+\+;/.test(src), 'the next free option number is taken, never a duplicate');
ok(/p=\{id:newPropId\(\),n:1,label:''\}; src\.prop=p;/.test(src),
  'a standalone quote becomes option 1 the moment a second option is wanted');

/* THE STRIP, where Ray asked for it */
ok(/<div id="opt-strip"><\/div>[\s\S]{0,200}edit-bar/.test(src),
  'the options sit right after the quote summary');
ok(/function renderOptStrip\(\)/.test(src) && /function propInPlay\(\)/.test(src),
  'and render from the proposal in play, never guessed from the client');
ok(/LAST_SAVED&&SAVED\[LAST_SAVED\]&&qProp\(SAVED\[LAST_SAVED\]\)/.test(src),
  '…staying up after a save, which is "after each generated quote"');
ok(/renderTracker\(\); renderOptStrip\(\);/.test(src),
  'every write to the saved store redraws the strip, or it reads one option behind');

/* THE TRACKER, and the analysis Ray asked the data for */
ok(/class="t-opt/.test(src), 'each row carries its option chip');
ok(/Proposals decided/.test(src) && /is chosen most often/.test(src),
  'and the rail reports what the options are teaching us');
ok(/ost&&ost!=='super'/.test(src),
  'an earlier version offers no ✓ Chosen — a button that silently did nothing');
ok(/if\(optState\(k\)==='nottaken'\)return;/.test(src),
  'and ASPL never auto-delivers an option the client did not buy');

/* THE CLIENT-FACING COMPARISON - the thing the feature exists for */
ok(/function optionsText\(k\)/.test(src), 'the options copy as ONE client document');
ok(/'  Includes: '\+optWhat\(o\)/.test(src), '…saying what each one contains, not just a price');
ok(/Every figure is ex VAT\. Valid '\+qValid\(q\)/.test(src),
  '…on the same ex-VAT + validity footing as every other client exit');

/* ---------- THE BAND PRICE IS A TYPED FIGURE (Ray, 21 Sep 2026: "at which point the new-product
   updates for this quote gets to 15,100/month?") — nothing multiplies to reach it; it was two
   characters typed in front of a pre-filled "100" on the SHARED rate card ---------- */
console.log('\nthe new-product bundle: a typed band price, and the quote says so');
ok(/monSub\+=ui\.gbp;/.test(src) && /function updGBP\(\)\{ var f=updFrozen\(\); return f!=null\?f:updBandGBP\(\); \}/.test(src),
  'the monthly figure is the band price and nothing else — no SKU count ever multiplies it');
ok(/function updBandGBP\(\)\{ var T=updTiers\(\); return Math\.max\(UPD_MIN,\+T\[updTierIdx\(\)\]\.gbp\|\|0\); \}/.test(src),
  'the band price is read straight off the rate card');
ok(/function setBandGBP\(j,v\)/.test(src) && (src.match(/setBandGBP\(/g)||[]).length>=3,
  'ONE writer for a band price, used by the input and both ↺ buttons');
ok(!/rc\.upd\.tiers\[\+t\.getAttribute\('data-tier'\)\]\.gbp=/.test(src),
  '…so the input handler no longer writes the tier itself');
/* the prepend trap */
ok(/addEventListener\('focusin'/.test(src) && /_selFx=t; try\{ t\.select\(\); \}/.test(src),
  'the band box selects its value on focus, so the first keystroke REPLACES');
ok(/addEventListener\('mouseup',function\(e\)\{ if\(e\.target===_selFx\)\{ e\.preventDefault\(\);/.test(src),
  '…and the mouseup that completes the click is swallowed, or it collapses the selection back to a caret');
ok(/input\.tgbp\{width:78px/.test(src), 'the box is wide enough to read five digits');
/* off-scale */
ok(/function updOffScale\(j\)\{ var T=updTiers\(\); return !!\(T\[j\]&&\(\+T\[j\]\.gbp\|\|0\)>updDefGBP\(j\)\*5\); \}/.test(src),
  'a band more than 5× its FeedSpark default is off-scale');
ok(/function updDefGBP\(j\)\{ var d=UPD_DEFAULT_TIERS\[j\]; return d\?d\.gbp:UPD_MIN; \}/.test(src),
  'the default is read off the same table the placeholders come from');
ok(/\(off\?' off':''\)/.test(src) && /\.tier\.off\{border-color:var\(--orange-deep\)/.test(src),
  'the chip is ringed');
ok(/'was £'\+fmt\(dg\)\+' <button type="button" class="twx" data-def="'\+j\+'"/.test(src),
  '…carries "was £X" and hands the default back in one click');
ok(/class="updwarn">⚠ '\+money\(bd\)\+' a month is more than five times the FeedSpark band price of '\+money\(updDefGBP\(i\)\)/.test(src),
  'the card warns under the bands, naming the FeedSpark price');
ok(/'A flat monthly charge typed into the band box on your shared rate card — the new-SKU figure picks the band, it never multiplies the price\.'/.test(src),
  'the QUOTE TOTAL row says what the figure is');
ok(/\(t\.upd\.off\?'\\u26a0 ':''\)\+money\(t\.upd\.gbp\)\+'\/mo band price'\+\(t\.upd\.off\?\(' · band is £'\+fmt\(t\.upd\.def\)\)/.test(src),
  '…and shouts on the total when the band is off-scale');
ok(/band:updBandGBP\(\),frozen:updFrozen\(\),off:updOffScale\(i\),def:updDefGBP\(i\)/.test(src),
  'updInfo carries band / frozen / off / default for every surface that renders the bundle');
/* the blur must not eat the click */
ok(/if\(T\[j\]&&String\(T\[j\]\.gbp\)!==String\(e\.target\.value\)\)\{ e\.target\.value=String\(T\[j\]\.gbp\); paintTiers\(\); \}/.test(src),
  'on blur the box snaps to the stored price WITHOUT rebuilding the card — a rebuild destroys the button being clicked');
ok(/function paintTiers\(\)/.test(src) && !/contains\('tgbp'\)\)\{ renderUpd\(\);/.test(src),
  'the chips repaint in place while a price is being typed');
/* a saved quote reproduces its own price */
ok(/gbp:\(\(qu\.gbp!=null&&isFinite\(\+qu\.gbp\)&&\+qu\.gbp>0\)\?\+qu\.gbp:null\)/.test(src),
  '✎ Edit freezes the snapshot\'s own £ — the band index alone trusted the rate card to still hold it');
ok(/function updThaw\(\)/.test(src) && (src.match(/updThaw\(\)/g)||[]).length>=5,
  'pinning a band, ↺ auto, editing a price or moving the estimate thaws it — those are new decisions');
ok(/Frozen at '\+money\(fz\)\+' — the figure this quote was signed off at\. The band costs '\+money\(bd\)\+' today/.test(src),
  '…and the card says so when today\'s band differs');
/* draft prices means what it says */
ok(/function updDraft\(\)\{ return !updTiers\(\)\.some\(function\(x,j\)\{ return \+x\.gbp!==updDefGBP\(j\); \}\); \}/.test(src),
  '"draft prices" = no band priced yet, not "the rate card has a tiers key"');
/* a discount that discounts nothing says why */
ok(/function discNil\(side,t\)/.test(src) && /discNil\('oneoff',t\)/.test(src) && /discNil\('monthly',t\)/.test(src),
  'a £0 discount names its reason on both sides');
ok(/why='no line ticked'/.test(src) && /why='man power only'/.test(src) && /why='nothing to discount'/.test(src),
  '…in three short words that fit the value cell');
ok(/\(loud\?'\\u26a0 £0\.00 \\u00b7 ':''\)/.test(src), '…loud when the scope covers this side, quiet when it simply excludes it');
/* the tiles could not shrink */
ok(/\.qs-col\{display:grid;grid-template-columns:minmax\(0,1fr\);grid-template-rows:subgrid/.test(src),
  'the quote-total tiles can shrink — every row was ~10px wider than its tile on main');
ok(/\.qs-r\.tot\{flex-wrap:wrap\} \.qs-r\.tot>b\{margin-left:auto\}/.test(src),
  '…and a wide total drops onto its own line instead of overlapping its nowrap label');
ok(/#upd-card \.pt-act\{/.test(src), 'the bundle card\'s own small buttons are styled (.pt-act was scoped to the PT picker)');

/* ---------- THE AI FEED GENERATION BUTTON IS GONE (Ray, 21 Sep 2026: "remove AI feed generation
   Quoting button -- we have Spark AI now") ---------- */
console.log('\nthe AI feed generation button is gone; Spark AI is the AI quote');
ok(!/\['ai','AI feed generation','Tachyon fields on the live feed'\]/.test(src), 'the picker no longer offers it');
ok(/var TYPE_LEGACY_AI=\['ai','AI feed generation','Legacy/.test(src) && /TYPES\.concat\(ty\.ai\?\[TYPE_LEGACY_AI\]:\[\]\)/.test(src),
  '…but a record that still carries types.ai gets it back, labelled legacy, until unticked');
ok(/r\.types=\{aim:true\}; migrateLia\(r\)/.test(src), 'a fresh record opens on Spark AI');
ok(/r\.types=q\.types\?JSON\.parse\(JSON\.stringify\(q\.types\)\):\{ai:true\};/.test(src),
  'an old snapshot with no types is still an AI-only quote — its field lines must render');
ok(/id="scope-card" data-tp="ai aim"/.test(src) && /id="upd-card" data-tp="ai aim"/.test(src),
  'the product-type scope and the Monthly update bundle ride Spark AI too');
ok(/c\.getAttribute\('data-tp'\)\.split\(\/\\s\+\/\)\.some\(function\(k\)\{ return !!ty\[k\]; \}\)/.test(src),
  'a card lists every type it belongs to and shows while any is on');
ok(/\(typeOn\('ai'\)\?kpi\(t\.inc\+' \/ '\+CAT\.length,'Fields selected'\)\+kpi\(fmt\(t\.tp\),'SKUs quoted'\):''\)/.test(src),
  'the per-SKU field KPIs only show with the legacy type on — never a dead "0 SKUs quoted"');
ok(/<b>Spark AI<\/b> prices the six Google/.test(src) && !/Scope an <b>AI field-generation<\/b> engagement/.test(src),
  'the hero leads with Spark AI');

/* ---------- THE TRACKER DECLUTTERS (Ray, 21 Sep 2026: "the saved quotes getting super cluttered -
   expand horizontally if needed, buttons should be presented cleaner - maybe in a different format
   to save space") ---------- */
console.log('\nthe finance tracker: one line per quote');
ok(/q\.lu=Date\.now\(\); \}/.test(src) && !/q\.upd=Date\.now\(\)/.test(src) && !/old\.upd=Date\.now\(\)/.test(src),
  'the last-update stamp is q.lu — it was q.upd, the field the snapshot keeps the new-products BUNDLE on');
ok(/function tkLast\(q\)\{ return \+q\.lu\|\|\(\(typeof q\.upd==='number'\)\?\+q\.upd:0\)\|\|\+q\.t\|\|0; \}/.test(src),
  'tkLast reads lu, then a legacy numeric upd, then the save time — never an object as a date');
ok(/function qUpd\(q\)\{ return \(q&&q\.upd&&typeof q\.upd==='object'\)\?q\.upd:null; \}/.test(src),
  'qUpd is the one reader of the bundle and only ever returns an object');
ok(!/[^a-zA-Z_.]q\.upd\?/.test(src.replace(/typeof q\.upd/g,'')) && (src.match(/qUpd\(q\)/g)||[]).length>=8,
  '…and every bundle read on a saved quote goes through it');
ok(/class="st on" data-st=/.test(src) && /class="st '\+\(done\?'done':'todo'\)\+'" data-st=/.test(src),
  'the stage rail is a stepper: the current stage is the only word, the others are dots');
ok(/\.st\.done,\.st\.todo\{width:12px;height:12px;padding:0;border-radius:50%/.test(src), '…12px dots');
ok(/aria-label="Mark '\+esc\(s\)\+'"/.test(src) && /aria-label="Mark Declined"/.test(src), '…every dot names its stage for a screen reader');
ok(/Stage · click a dot<\/th>/.test(src), '…and the header says so');
ok(/function icoBtn\(cls,attrs,title,glyph\)/.test(src) && /function icoSpan\(cls,title,glyph\)/.test(src), 'the actions are icons');
ok(/\.tk \.t-act\{[^}]*width:24px;height:24px;padding:0/.test(src), '…24px each');
ok(/<span class="t-grp">'\+g\+'<\/span>/.test(src), '…the three proposal actions grouped');
ok(/icoBtn\('done','data-draft=/.test(src) && /icoSpan\('done','Filed into the '/.test(src), '…a done state is the icon in green with the who/when in its tooltip');
ok(/\.tk \.t-acts\{display:flex;flex-direction:row;flex-wrap:wrap/.test(src) && /\.tk \.t-ico\{display:inline-flex;gap:4px;align-items:center;flex:none;white-space:nowrap\}/.test(src),
  '…the six icons never wrap; only the live ticket chip may drop a line');
ok(/<div class="tk-legend">/.test(src) && /Compare options<\/span>/.test(src), 'a legend under the table names every icon once');
ok(/<th style="text-align:right" class="tk-money">Total · ex VAT<\/th>/.test(src) && !/font-size:10px">ex VAT<\/span>'\)\+'<\/span>'\)/.test(src),
  '"ex VAT" is said once in the header, not on every row');
ok(/function tkWhenC\(ts,who\)/.test(src) && /tkWhenC\(q\.t,tkWho\(q\.by\)\)/.test(src) && /tkWhenC\(last,tkWho\(lastBy\)\)/.test(src),
  'the two date columns are compact: day, then time · who');
ok(/\.tk\{width:100%;border-collapse:collapse;font-size:12\.5px;min-width:1000px\}/.test(src), 'the table fits the 1280px column without a scrollbar');
ok(/@media \(min-width:1400px\)\{ #tracker-card\{margin-left:calc\(50% - 50vw \+ 30px\);margin-right:calc\(50% - 50vw \+ 30px\)\} \}/.test(src),
  '…and steps out to the viewport on a wide screen ("expand horizontally if needed")');
ok(/'<span class="t-sup" title="Edited '\+esc\(tkWhenS\(q\.superseded\.t\)\)[\s\S]{0,80}?'">↻ newer: '/.test(src) && !/newer version: '/.test(src), 'the superseded notice sits under the ref, not among the buttons');

/* ---------- WHAT SETS EACH OPTION APART (Ray, 21 Sep 2026: "the summaries below each option should be
   clearer - to easier identify - ensure AI writting here to provide both details (delta chagnes
   between option) but not too cluttered") ---------- */
console.log('\nthe option strip: what each option includes, and what changed against the one before');
ok(/AIQUOTE-OPTDELTA/.test(src), 'one named block');
ok(/function optDelta\(q,b\)/.test(src) && /function optDeltaHtml\(q,b,bn,P\)/.test(src) && /function optDeltaText\(q,b,P\)/.test(src), 'the delta writer, in HTML and in text');
ok(/never by Tachyon/.test(src) && !/\/api\/claude[^\n]*optDelta/.test(src), 'written by the page off the snapshots — never a model call');
ok(/'Spark AI \\u00d7'\+ids\.length\+' \('/.test(src), 'includes: Spark AI with its route mix');
ok(/p\.push\('monthly new products'\+\(u\.label\?' \('\+u\.label\+'\)':''\)\)/.test(src), '…the bundle with its band');
ok(/if\(q\.aim&&q\.aim\.since\)p\.push\('arrivals since '\+moLbl\(q\.aim\.since\)\)/.test(src), '…the cohort');
ok(/p\.push\(optScopeWord\(q\)\)/.test(src), '…the scope, last');
ok(/it\.push\(\{s:'~',t:B\[id\]\.label\+': '\+rw\(A\[id\]\.route\)\+' \\u2192 '\+rw\(B\[id\]\.route\)\}\)/.test(src), 'delta: an attribute re-routed reads "label: A → B"');
ok(/if\(ub&&!ua\)it\.push\(\{s:'\+',t:'monthly new products'\}\); else if\(ua&&!ub\)it\.push\(\{s:'\\u2212',t:'monthly new products'\}\)/.test(src), '…the bundle on or off');
ok(/if\(shp\(b\)!==shp\(q\)\)it\.push/.test(src) && /else if\(va&&vb&&va!==vb\)it\.push/.test(src),
  '…the scope by SHAPE, and the SKU count only when both sides know it (an unpulled build is not a difference)');
ok(/return \{items:it,money:mon\.length\?mon\.join\(' \\u00b7 '\):'same price'\}/.test(src), '…and the £ movement, one-off and monthly apart');
ok(/var cap=4, shown=d\.items\.slice\(0,cap\)/.test(src) && /<span class="od more">\+'\+more\+' more<\/span>/.test(src), 'four clauses on screen, the rest in the tooltip');
ok(/'<span class="od same">same lines<\/span>'/.test(src), 'nothing different says so — a duplicate option is a finding');
ok(/var rows=ks\.map\(function\(k,i\)\{ var q=SAVED\[k\], st=optState\(k\), prev=i\?SAVED\[ks\[i-1\]\]:null;/.test(src) && /\(prev\?optDeltaHtml\(q,prev,prev\.prop\.n,SHOWP\):''\)/.test(src),
  'each option is compared with the one BEFORE it — a ladder, not everything against option 1');
ok(/optDeltaHtml\(live,SAVED\[lastK\],SAVED\[lastK\]\.prop\.n,true\)/.test(src), 'the build in progress is compared with the last saved option');
ok(/if\(pv\)out\.push\('  Compared with option '\+pv\.prop\.n\+': '\+optDeltaText\(o,pv,P\)\)/.test(src), 'the client comparison carries the same line');
ok(/\.od\.add\{color:var\(--good\)/.test(src) && /\.od\.rem\{color:var\(--orange-deep\)/.test(src) && /\.od\.chg\{color:var\(--navy\)/.test(src), '+ green · − deep orange · ~ navy');

/* ---------- A HIDDEN CARD NEVER PRICES (Ray, 21 Sep 2026: "a fresh Reiss quote still have these
   numbers - refresh it ?") ---------- */
console.log('\na hidden card never prices');
ok(/function fOn\(id\)\{ var f=rec\(\)\.fields\[id\]; return !!\(f&&f\.on\)&&typeOn\('ai'\); \}/.test(src),
  'a per-SKU field line is ON only while the legacy type is — the record keeps its ticks, the total follows the screen');
ok(/id="fresh"/.test(src) && /STORE\[CLIENT\]=\{mkt:MKT,scope:\{mode:'all'\},pts:\{\},fields:\{\}\}; EDITING=null; PENDING_OPT=null;/.test(src),
  '↺ Start fresh puts the client record back to blank — saved quotes and the rate card untouched');
ok(/if\(!confirm\('Start a fresh '\+CLIENT\+' quote\?/.test(src), '…behind a confirm');

/* ---------- THE SCOPE COLUMN SAYS WHAT WAS QUOTED (Ray, 21 Sep 2026: "can scope be more details
   (should be market + quote type "Spark AI + New dashboard + new feed.. etc from selection)") ---------- */
console.log('\nthe tracker scope column: what was quoted, then market · product scope');
ok(/function qTypesWord\(q\)/.test(src) && /p\.push\('Spark AI \\u00d7'\+n\)/.test(src) && /p\.push\('New dashboard'\+\(c\.sys>1\?' \\u00d7'\+c\.sys:''\)\)/.test(src)
  && /p\.push\('New feed'\+\(c\.feed>1\?' \\u00d7'\+c\.feed:''\)\)/.test(src) && /p\.push\('Retainer '\+ret\.join\(' \+ '\)\)/.test(src) && /p\.push\('New products bundle'\)/.test(src),
  'line one names the quote types off the frozen lines, in Ray\'s words');
ok(/<td class="t-when t-scope" title="'\+esc\(qt\+' \\u2014 '\+optWhat\(q\)\)\+'"><span class="t-qt">'\+esc\(show\)\+'<\/span><br>/.test(src) && /show=qp\.length>3\?\(qp\.slice\(0,3\)\.join\(' \\u00b7 '\)\+' \+'\+\(qp\.length-3\)\+' more'\):qt/.test(src),
  '…three types on the row, the rest behind "+N more", the full list + includes line in the tooltip');
ok(/\(qOnProducts\(q\)\?\(' · '\+scopeTxt\+' · '\+fmt\(scope\.vol\|\|q\.prods\|\|0\)/.test(src), 'line two = market · product scope, only when a line is priced on products');
ok(/<th>Quoted · scope<\/th>/.test(src), 'the header says so');
ok(!/ks\.push\('AI'\)/.test(src), 'the duplicate type chips under the client name are gone');

/* ---------- ONE TAB PER OPTION IN THE EXPORT (Ray, 21 Sep 2026: "when export quote - export Option
   on seperate tab in the same excel") ---------- */
console.log('\nthe Excel export: one tab per option');
ok(/function applySnap\(q,r\)\{ r\.mkt=q\.mkt\|\|'gb';/.test(src) && /var r=rec\(\); applySnap\(q,r\); MKT=r\.mkt;/.test(src),
  'the snapshot → record mapping is its own function, and ✎ Edit uses it');
ok(/function withSnap\(q,fn\)/.test(src) && /finally\{ CLIENT=c0; MKT=m0; if\(had\)STORE\[q\.client\]=r0; else delete STORE\[q\.client\]; EDITING=e0; PENDING_OPT=p0; \}/.test(src),
  'withSnap swaps a snapshot into the builder for the call and restores everything after — no render, no save');
ok(/function quoteSheet\(opts\)\{ opts=opts\|\|\{\};/.test(src) && /\['Agency','-','Reference',opts\.ref\|\|quoteRef\(now\),'t'\]/.test(src) && /now=opts\.at\?new Date\(\+opts\.at\):new Date\(\)/.test(src),
  'the sheet builder takes the option\'s own reference and save date');
ok(/function xlsxBytes\(tabs\)\{/.test(src) && /var sxs=tabs\.map\(function\(t\)\{ return sheetXml\(t\.sh,st\); \}\);/.test(src),
  'the workbook takes N tabs and renders every sheet against ONE style table before styles.xml is written');
ok(/'<definedName name="Dayrate" localSheetId="'\+i\+'">'\+n2\(t\.day\)\+'<\/definedName>'/.test(src), 'Dayrate is defined per sheet');
ok(/files\.push\(\{n:'xl\/drawings\/drawing'\+k\+'\.xml',s:drawingXml\(\)\}\);/.test(src), 'each sheet carries its own wordmark drawing');
ok(/function exportTabs\(\)\{ var pid=propInPlay\(\), tabs=\[\];/.test(src) && /tabs\.push\(withSnap\(q,function\(\)\{ return \{name:nm,sh:quoteSheet\(\{ref:q\.ref,at:q\.t\}\),day:blockGBP\(\)\}; \}\)\)/.test(src),
  'every option of the proposal in play gets a tab built off its own snapshot');
ok(/if\(EDITING&&EDITING\.id===k\)tabs\.push\(\{name:nm,sh:quoteSheet\(\{ref:q\.ref\}\),day:blockGBP\(\)\}\);/.test(src), '…the option under ✎ Edit off the live builder, with its saved ref');
ok(/if\(PENDING_OPT\)tabs\.push\(\{name:'Option '\+PENDING_OPT\.n\+' \\u00b7 this build'/.test(src), '…and the unsaved build being added gets its own tab');
ok(/if\(!tabs\.length\)tabs\.push\(\{name:xTabName\(\),sh:quoteSheet\(\),day:blockGBP\(\)\}\);/.test(src), 'a quote outside a proposal exports as it always did');
ok(/function xTab\(n\)\{ return String\(n\)\.replace\(\/\[\\\[\\\]:\*\?\\\/\\\\\]\/g,' '\)\.slice\(0,31\); \}/.test(src), 'tab names are Excel-safe (31 chars, no []:*?/\\)');

console.log('\n' + (fails ? `✗ ${fails} of ${n} failed` : `✓ all ${n} passed`));
process.exit(fails ? 1 : 0);
