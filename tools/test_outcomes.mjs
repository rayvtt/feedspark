#!/usr/bin/env node
/**
 * tools/test_outcomes.mjs — WHAT THE HOURS MOVED (Ray, 28 Sep 2026).
 *
 * "find more way even making data dissectment even more useful - especially if im trying to get
 * charts for procurement heads/ senior executives to defend feedspark services."
 *
 * The rendering is pinned by tools/check_outcomes.js. This pins the arithmetic and the wiring —
 * the parts that would be wrong in a way nobody could see on screen, on a chart that is going in
 * front of a buyer:
 *
 *   1. A MONTH'S VALUE IS ITS CLOSE, not a mean of its days. A mean smears the step a piece of
 *      work produced across the month it happened in, which is the movement being credited.
 *   2. AN UNMEASURED MONTH IS ABSENT, never 0 and never carried flat. Drawing it would show a
 *      client a collapse, or a recovery, that never happened.
 *   3. A BRAND FIGURE CARRIES ITS COVERAGE. A mean over the markets measured that month, with the
 *      count travelling beside it — three of twenty-eight markets is a different claim.
 *   4. AN ABSENT SOURCE SAYS WHICH. "No improvement" and "nobody scanned this brand" are opposite
 *      findings and a blank panel cannot tell them apart.
 *
 * Run: node tools/test_outcomes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as O from '../cloudflare/feedspark-deck/src/outcomes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${msg}\n      got ${JSON.stringify(a)}\n      want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------------------------------------
console.log('── the calendar');
// ---------------------------------------------------------------------------------------------
eq(O.monthPrev('2026-01'), '2025-12', 'January steps back over the year boundary');
eq(O.monthPrev('2026-10'), '2026-09', 'and an ordinary month steps back by one');
eq(O.monthPrev('nonsense'), '', 'a key that is not a month is refused rather than guessed');
eq(O.monthsBack('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02'],
  'the window is oldest-first and crosses the year');
eq(O.monthsBack('2026-09', 1), ['2026-09'], 'one month is a legal window');
ok(O.monthsBack('2026-09', 999).length === O.OUTCOME_MONTHS_MAX,
  'and a silly window is clamped rather than building thousands of columns');

// ---------------------------------------------------------------------------------------------
console.log('── a month is its CLOSE, and a gap stays a gap');
// ---------------------------------------------------------------------------------------------
// one feed's daily line from 28 Jun: two readings in July, none in September
const ms = O.monthsBack('2026-09', 6);
const daily = new Array(95).fill(null);
daily[0] = 80;      // 28 Jun
daily[5] = 82;      // 3 Jul
daily[20] = 84.5;   // 18 Jul
daily[40] = 88;     // 7 Aug
const close = O.monthlyClose('2026-06-28', daily, ms);
eq(close['2026-07'], 84.5, "July is its LAST reading (84.5), not its first and not the mean of the two");
eq(close['2026-06'], 80, 'June closes on the only reading it has');
ok(!('2026-09' in close), 'a month with no reading is ABSENT from the map — never 0, never carried');
ok(!('2026-04' in close) && !('2026-05' in close), 'and months before the record began are absent too');
eq(O.monthlyClose('not-a-date', daily, ms), {}, 'a malformed start reduces to nothing rather than throwing');
eq(O.monthlyClose('2026-06-28', null, ms), {}, 'and so does a missing line');
// the day walk has to survive month lengths and a year roll, or every month after Feb is mislabelled
const long = new Array(400).fill(null);
long[0] = 1;        // 2025-12-31
long[1] = 2;        // 2026-01-01
long[60] = 3;       // 2026-03-01 (2026 is not a leap year)
const lc = O.monthlyClose('2025-12-31', long, null);
eq([lc['2025-12'], lc['2026-01'], lc['2026-03']], [1, 2, 3],
  'the day walk crosses a year end and a 28-day February without drifting');

// ---------------------------------------------------------------------------------------------
console.log('── a brand is its markets, and says how many');
// ---------------------------------------------------------------------------------------------
const gb = { '2026-07': 90, '2026-08': 92 };
const de = { '2026-08': 80 };
const bm = O.brandMonthly([gb, de], ms);
eq(bm['2026-07'], { v: 90, n: 1 }, 'a month only one market measured reports that market, and says n=1');
eq(bm['2026-08'], { v: 86, n: 2 }, 'a month both measured is their mean, over the markets MEASURED');
ok(!('2026-06' in bm), 'and a month neither measured is absent, not an average of nothing');
eq(O.brandMonthly([{ '2026-08': 0 }], ms)['2026-08'], { v: 0, n: 1 },
  'a genuine ZERO reading is kept — absent and zero are different facts');

// ---------------------------------------------------------------------------------------------
console.log('── the whole panel, and what it admits');
// ---------------------------------------------------------------------------------------------
const feeds = [
  { mkt: 'gb', start: '2026-06-28', gs: daily, q: new Array(95).fill(null), air: new Array(95).fill(null) },
  { mkt: 'de', start: '2026-06-28', gs: daily.map((v) => (v == null ? null : v - 4)), q: [], air: [] },
];
const out = O.brandOutcomes(feeds, ms, { results: [
  { t: Date.parse('2026-08-14'), client: 'Reiss', market: 'gb', period: 'Aug I', metrics: ['Clicks: 5.18% Increase'] },
  { t: Date.parse('2025-01-02'), client: 'Reiss', market: 'gb', period: 'Jan I', metrics: ['old'] },
] });
eq(Object.keys(out.metrics.gs).sort(), ['2026-06', '2026-07', '2026-08'],
  'the brand line covers exactly the months something was measured in');
eq(out.metrics.gs['2026-07'], { v: 82.5, n: 2 }, 'and each month is the mean of the markets’ own closes');
eq(out.measured, { gs: 3, q: 0, air: 0 }, 'how many months carry a reading, per metric');
ok(out.sources.some((s) => s.k === 'q' && !s.ok && /content quality/i.test(s.why)),
  'a metric with no reading at all says so BY NAME — not the same finding as an unscanned brand');
ok(out.sources.some((s) => s.k === 'feeds' && s.ok && s.n === 2),
  'and the source line states how many markets were read');
eq(Object.keys(out.results), ['2026-08'], 'a read-out lands in its own month, and one outside the window is dropped');
eq(out.results['2026-08'][0].market, 'GB', 'with its market upper-cased as every surface prints it');

const none = O.brandOutcomes([], ms, {});
ok(!none.feeds && none.sources.some((s) => s.k === 'feeds' && !s.ok && /no market/.test(s.why)),
  'a brand with no scan history says exactly that rather than returning an empty line');

// ---------------------------------------------------------------------------------------------
console.log('── the caption never states a brand figure without its coverage');
// ---------------------------------------------------------------------------------------------
const cap = O.outcomeCaption(out, 'gs');
ok(/2 markets/.test(cap), 'the caption names the coverage');
ok(/last reading/i.test(cap), '…says a month is its close, not an average of its days');
ok(/up 8 points/.test(cap), '…and reports the movement across the window (78 → 86)');
ok(/Source:/.test(cap), '…and where the number came from');
ok(/nothing to plot/.test(O.outcomeCaption(out, 'q')),
  'a metric with no readings gets an honest line, never an empty caption under an empty panel');
ok(O.outcomeCaption(out, 'nope') === '', 'and an unknown metric produces nothing rather than guessing');
const one = O.brandOutcomes([{ mkt: 'gb', start: '2026-08-01', gs: [77], q: [], air: [] }], ms, {});
ok(/no movement to report yet/.test(O.outcomeCaption(one, 'gs')),
  'ONE measured month refuses to claim a direction — a trend needs two');

// ---------------------------------------------------------------------------------------------
console.log('── the wiring: the route, the page, the harness');
// ---------------------------------------------------------------------------------------------
const WK = rd('cloudflare', 'feedspark-deck', 'src', 'worker.js');
ok(/import \* as OUT from ".\/outcomes.js"/.test(WK), 'the worker imports the engine rather than re-deriving it');
ok(/path === '\/api\/outcomes' && request\.method === 'GET'/.test(WK), 'the route exists');
ok(/acc\.clients && !clientMatch\(acc\.clients, who\)/.test(WK),
  'and it is scoped per signin like every other client-data route — 403 outside the caller’s brands');
ok(/histSeries\(hists\[i\], pf, \{ days: span, today, live \}\)/.test(WK),
  'the scores come from labelguard’s OWN histSeries, so this can never disagree with /golden');
ok(/profileFor\(f\.client, overrides\)/.test(WK),
  '…re-scored against the brand’s current profile, exactly as the audit page does');
ok(/-fb\$/.test(WK.slice(WK.indexOf("path === '/api/outcomes'"), WK.indexOf("path === '/api/outcomes'") + 2600)),
  'Meta catalogue feeds are excluded — they carry none of these readings');

const PG = rd('docs', 'FeedSpark_TaskManager.html');
ok(/id="cout"/.test(PG) && /id="coutbox"/.test(PG), 'the page has the control and the panel');
ok(/function outCal\(\)[^}]*CFORM === 'line'[^}]*CDIM === 'month'/.test(PG),
  'it draws only where there is a calendar to share');
ok(/function outAcct\(\)[\s\S]{0,160}!p\.multi/.test(PG),
  '…and only for ONE account — a score averaged across brands is not a number');
ok(/outMonths[\s\S]{0,200}seriesByMonth\(chartPop\(\), 'total'/.test(PG),
  'both plots take their months from ONE source, so the calendars cannot disagree');
ok(/if \(p\.v == null\) flush\(\);/.test(PG),
  'a gap BREAKS the line rather than being joined through');
ok(/\.cmain\{flex:1 1 460px/.test(PG) && /\.cstage\{min-width:0\}/.test(PG),
  'the hours and the outcome share one column, so the month above a point is the month it belongs to');
ok(/function pngSvgs\(\)/.test(PG) && /imgs\.forEach\(function \(im, i\)/.test(PG),
  'the PNG stacks both panels — these go straight into a client deck');
ok(/localStorage\.setItem\('fcc-tm-out'/.test(PG),
  'the pick is per device, like every other reading preference on this page');
ok(/u\.searchParams\.set\('out', COUT\)/.test(PG), 'and 🔗 Link is how it travels to a colleague');
ok(/\|\| outOn\(\);/.test(PG), 'the ⚙ Display dot counts it, so a fold never buries what is on screen');

for (const f of ['qa_gate.sh', 'presync.sh']) {
  ok(rd('tools', f).indexOf('test_outcomes.mjs') >= 0, 'test_outcomes runs in ' + f);
}
ok(rd('tools', 'presync.sh').indexOf('check_outcomes.js') >= 0, 'and the rendered tripwire runs in presync');
ok(rd('.github', 'workflows', 'validate.yml').indexOf('test_outcomes.mjs') >= 0, 'and in validate.yml');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
