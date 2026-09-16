/**
 * tools/test_hoursbadge.mjs — the FCC-wide hours badge.
 *
 * Ray, 16 Sep 2026: "this hour report should appear everywhere in Watcher, for example with
 * workflow, and flag whether the client is negative or not. It should also show the trajectory
 * of the past three months of client activity per hour. It would be like a hovering pop-up, so
 * it doesn't clutter the current dashboard… display it within brand[ dossier] and other areas in
 * the F[C]C that are appropriate for an AM to decide whether to continue the task with the
 * current hours. Obviously, there are cases where a client is negative, but because of
 * relationship smoothing, the AM may still continue the task."
 *
 * Four things this pins, because each one is a way the badge could silently lie:
 *   1. THE TRAIL MATHS. A partial current month is flagged, not plotted as a finished one; a
 *      partly-read book reports its coverage; billable and non-billable never merge.
 *   2. POSTURE OVER PANIC. A negative balance the team decided to keep serving reads `served`,
 *      not `over` — otherwise the deliberate call looks like an unhandled alarm on every page.
 *   3. WIDGET/ENGINE PARITY. docs/hours_widget.html carries a hand-written twin of the engine
 *      rules (it can't import). The twin is lifted by name and run against the SAME table as
 *      src/taskbook.js, so the two can never drift.
 *   4. THE WIRING. The namespace, the route, the trail write, the injection, and the anchors on
 *      the pages Ray named.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../cloudflare/feedspark-deck/src/taskbook.js';
import { STATE_NS } from '../cloudflare/feedspark-deck/src/sharedstate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${msg}\n      got ${JSON.stringify(a)}\n      want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------------------------------------
// the trail
// ---------------------------------------------------------------------------------------------
console.log('── the three-month trail');

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);          // 16 Sep 2026
eq(M.trailMonths(NOW, 3), ['2026-07', '2026-08', '2026-09'], 'three months, oldest first');
eq(M.TRAIL_MONTHS, 3, 'the hours trajectory stays THREE months — the twelve-month view Ray asked '
  + 'for is the schedule\u2019s go/skip strip, not this chart');
eq(M.trailMonths(Date.UTC(2026, 0, 4), 3), ['2025-11', '2025-12', '2026-01'],
  'and it rolls back over a year boundary');

// a packed row is [day, ref, owner, status, cat, billQ, nonbillQ, ...] — quarter-hours
const row = (day, billQ, nbQ) => [day, '', 'Ray', 'done', 'opt', billQ, nbQ];
const BOOK = { markets: {
  GB: { at: NOW, rows: [row('2026-07-04', 8, 2), row('2026-08-11', 12, 0), row('2026-09-02', 4, 4),
                        row('2026-05-01', 40, 40)] },   // outside the window — counted in windowHours only
  DE: { at: NOW - 3600e3, rows: [row('2026-08-20', 6, 2), row('2026-09-14', 2, 0)] },
} };

const tr = M.trailOf(BOOK, 4, NOW);
eq(tr.months, ['2026-07', '2026-08', '2026-09'], 'the trail spans the three months');
eq(tr.current, '2026-09', 'and knows which one is still running');
eq(tr.read, 2, 'two markets read');
eq(tr.total, 4, 'of four the client has');
ok(tr.at === NOW, 'the read-age is the freshest market, not the stalest');

const rows = M.trailRows(tr);
eq(rows.map((r) => r.month), ['2026-07', '2026-08', '2026-09'], 'rows come back in order');
eq(rows.map((r) => r.bill), [2, 4.5, 1.5], 'billable hours per month (quarter-hours / 4)');
eq(rows.map((r) => r.nonbill), [0.5, 0.5, 1], 'non-billable kept SEPARATE, never folded in');
eq(rows.map((r) => r.hours), [2.5, 5, 2.5], 'and the total is the two of them added, not one of them');
rows.forEach((r) => ok(Math.abs(r.bill + r.nonbill - r.hours) < 1e-9,
  'bill + non-bill = total for ' + r.month));
eq(rows.map((r) => r.partial), [false, false, true],
  'ONLY the current month is partial — a finished month is never flagged');

// the deliberate rule: a row outside the three months still counts toward the window total, so
// "what this account has cost lately" is not silently truncated to the chart
ok(tr.windowHours > rows.reduce((s, r) => s + r.hours, 0),
  'hours outside the three months are in windowHours but NOT plotted as a month');

const undated = M.trailOf({ markets: { GB: { at: NOW, rows: [row('', 8, 8)] } } }, 1, NOW);
eq(M.trailRows(undated).map((r) => r.hours), [0, 0, 0],
  'an undated row is never guessed into a month');

// ---------------------------------------------------------------------------------------------
// the trend
// ---------------------------------------------------------------------------------------------
console.log('── the trend, and when it refuses to call one');

const R = (h, partial) => ({ month: 'x', bill: h, nonbill: 0, hours: h, n: 1, partial: !!partial });
eq(M.trailTrend([R(10), R(20), R(3, true)]).dir, 'up', 'up when the last COMPLETE month rose');
eq(M.trailTrend([R(20), R(10), R(30, true)]).dir, 'down',
  'and down when it fell — the partial month never swings the verdict');
eq(M.trailTrend([R(10), R(10.5), R(0, true)]).dir, 'flat', 'a 5% move is flat, not a trend');
eq(M.trailTrend([R(10), R(0, true)]).enough, false,
  'one complete month is not enough to claim a direction');
eq(M.trailTrend([]).enough, false, 'nor is none');

// ---------------------------------------------------------------------------------------------
// the state — where relationship smoothing lives
// ---------------------------------------------------------------------------------------------
console.log('── state: the balance is a fact, the posture is a decision');

const rec = (o) => Object.assign({ tracked: true, allowance: 32, used: 10, balance: 22 }, o);
eq(M.hoursState(rec()), 'ok', 'comfortably inside the block');
eq(M.hoursState(rec({ balance: 6 })), 'tight', 'under a quarter of the block left reads tight');
eq(M.hoursState(rec({ balance: 8 })), 'ok', 'exactly a quarter is not yet tight');
eq(M.hoursState(rec({ balance: -4 })), 'over', 'negative with no decision taken is over');
eq(M.hoursState(rec({ balance: -4, posture: { state: 'continue' } })), 'served',
  "Ray's case: negative, but the AM is continuing — that is `served`, not an alarm");
eq(M.hoursState(rec({ balance: -4, posture: { state: 'hold' } })), 'held',
  'negative with new work held is its own state');
eq(M.hoursState(rec({ balance: -4, posture: { state: 'watch' } })), 'over',
  'watching is not a decision — the balance still reads over');
eq(M.hoursState(rec({ balance: 22, posture: { state: 'continue' } })), 'ok',
  'a posture never makes a healthy account look interesting');
eq(M.hoursState({ tracked: false }), 'none', 'an unsynced client says so rather than reading 0h');
eq(M.hoursState(rec({ tracked: false, balance: -9 })), 'none',
  'and an unsynced client is never flagged negative off a stale figure');
eq(M.hoursState(rec({ allowance: 0, balance: 0 })), 'ok',
  'no allowance at all cannot be "tight" — there is no block to be close to');

ok(Object.keys(M.POSTURES).length === 3 && M.POSTURES.continue && M.POSTURES.hold && M.POSTURES.watch,
  'three postures: continue, hold, watch');
Object.keys(M.POSTURES).forEach((k) => ok(/\S/.test(M.POSTURES[k].note),
  'posture ' + k + ' explains itself'));
Object.keys(M.STATE_LABEL).forEach((k) => ok(/\S/.test(M.STATE_LABEL[k]), 'state ' + k + ' has a label'));
ok(!/stop|don'?t|must not/i.test(Object.values(M.STATE_LABEL).join(' ')),
  'no state tells the AM to stop — it states the balance and leaves the call with them');

const v = M.hoursVerdict(rec({ balance: -4, posture: { state: 'continue' } }));
ok(/over/.test(v) && /keep going|continu/i.test(v),
  'the served verdict says BOTH that it is over and that the team chose to keep going');
ok(/synced/i.test(M.hoursVerdict({ tracked: false })), 'an unsynced verdict is honest');

// ---------------------------------------------------------------------------------------------
// widget / engine parity
// ---------------------------------------------------------------------------------------------
console.log('── docs/hours_widget.html carries the SAME rules');

const WIDGET = rd('docs', 'hours_widget.html');
const A = WIDGET.indexOf("// ---- the engine's own rules");
const B = WIDGET.indexOf('/* FCC-HOURS:ENGINE-END */');
ok(A >= 0 && B > A, 'the widget marks its engine twin');
const twin = new Function('h1',
  WIDGET.slice(A, B) + '\nreturn { hoursState, hoursVerdict, trailRows, trailTrend, POSTURES, STATE_LABEL };'
)((n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString());

const CASES = [rec(), rec({ balance: 6 }), rec({ balance: -4 }),
  rec({ balance: -4, posture: { state: 'continue' } }), rec({ balance: -4, posture: { state: 'hold' } }),
  rec({ balance: -4, posture: { state: 'watch' } }), { tracked: false }, rec({ allowance: 0, balance: 0 })];
CASES.forEach((c, i) => {
  eq(twin.hoursState(c), M.hoursState(c), 'parity: hoursState case ' + i);
  eq(twin.hoursVerdict(c), M.hoursVerdict(c), 'parity: hoursVerdict case ' + i);
});
eq(twin.trailRows(tr), M.trailRows(tr), 'parity: trailRows on the same trail');
eq(twin.trailTrend(rows), M.trailTrend(rows), 'parity: trailTrend on the same rows');
eq(Object.keys(twin.POSTURES).sort(), Object.keys(M.POSTURES).sort(), 'parity: the same three postures');
eq(twin.STATE_LABEL, M.STATE_LABEL, 'parity: the same state labels, word for word');

// ---------------------------------------------------------------------------------------------
// the wiring
// ---------------------------------------------------------------------------------------------
console.log('── the wiring: store, route, write, injection, anchors');

ok(STATE_NS.hourspost === 'self',
  "the posture is a SHARED namespace keyed by client — one AM's call is the team's call");

const WK = rd('cloudflare', 'feedspark-deck', 'src', 'worker.js');
ok(/path === '\/api\/hours'/.test(WK), 'the worker serves /api/hours');
ok(/'\/api\/hours'[\s\S]{0,900}accessOf/.test(WK), 'and scopes it per signin like every other client route');
ok(/'\/api\/hours'[\s\S]{0,1400}state:hourspost/.test(WK), 'reading the posture out of the shared store');
ok(/TB\.trailOf\(/.test(WK), 'the cron computes the trail with the shared engine, not its own maths');
ok(/EDITS\.put\('tmtrail'/.test(WK), 'and writes it to its own KV record');
ok(/import HOURSW from "\.\.\/\.\.\/\.\.\/docs\/hours_widget\.html"/.test(WK), 'the widget is bundled');
ok(/HOURSW/.test(WK.slice(WK.indexOf('INSTR + '))), 'and injected on every app page');
ok(!/hours_widget/.test(WK.slice(WK.indexOf("path.startsWith('/deck/')"), WK.indexOf("path.startsWith('/deck/')") + 400)),
  'client decks never get it — it is internal commercial data');

// NO CLIENT HOURS IN GIT (the rule the hours sync set when it shipped): the widget's only
// source is the route — it bakes no figures and names no clients
ok(/fetch\('\/api\/hours'\)/.test(WIDGET), 'the widget reads the route and nothing else');
['Reiss', 'Schuh', 'Monsoon', 'Superdry', 'YuMOVE', 'Accessorize', 'Hobbycraft']
  .forEach((c) => ok(WIDGET.indexOf(c) < 0, 'no client named in the widget: ' + c));

const ANCHORS = [
  ['docs/FeedSpark_Workflow.html', 'the Workflow board'],
  ['docs/FeedSpark_Command_Center.html', 'the brand dossier'],
  ['docs/FeedSpark_TaskManager.html', 'the Task Manager'],
  ['docs/FeedSpark_Playbook.html', 'the Playbook'],
  ['docs/FeedSpark_Leadership.html', 'Leadership'],
];
ANCHORS.forEach(([f, what]) => ok(/data-hrs=/.test(rd(f)), what + ' anchors the badge'));

const WF = rd('docs', 'FeedSpark_Workflow.html');
ok(/data-hrs="'\+esc\(b\.client\)\+'"/.test(WF), 'every Workflow ticket card carries its client');
ok(/data-hrs-flag/.test(WF),
  'the intake table flags the EXCEPTION only — a healthy dot on 500 rows is clutter, which is the '
  + 'one thing the popover was asked not to be');
ok(/data-hrs-flag/.test(rd('docs', 'FeedSpark_TaskManager.html')),
  'and so does the accounts table, which already prints every balance in full');
ok(/data-hrs-flag/.test(WIDGET) && /function flagged/.test(WIDGET),
  'the widget implements the flag-only rule');
ok(/'tight'[\s\S]{0,80}'over'[\s\S]{0,80}'served'[\s\S]{0,80}'held'/.test(
  WIDGET.slice(WIDGET.indexOf('function flagged'), WIDGET.indexOf('function flagged') + 220)),
  'and flags exactly the four states worth stopping at');

ok(/select#brand|getElementById\('brand'\)/.test(WIDGET),
  'a module page that picks a brand from its own selector gets a badge without being touched');
['KWCal', 'FeedLab', 'Volume', 'Overlays', 'Schedule', 'AIQuote'].forEach((p) =>
  ok(/<select id="brand"/.test(rd('docs', 'FeedSpark_' + p + '.html')),
    'FeedSpark_' + p + ' is covered by that rule'));

ok(/embed=1/.test(WIDGET), 'the Feed Chat iframe is skipped — a popover in there would be clipped');
ok(WIDGET.indexOf('^\\/deck\\/') >= 0, 'and so is every client deck');

// the popover itself
ok(/id="fcc-hrs"|'fcc-hrs'/.test(WIDGET), 'the popover is one element, shared by every dot');
ok(/mouseenter/.test(WIDGET) && /Escape/.test(WIDGET), 'hover to open, Esc to close');
ok(/#2563EB/.test(WIDGET) && /#ED6F0B/.test(WIDGET), 'light palette: the validated billable/non-billable pair');
ok(/#4C82E0/.test(WIDGET) && /#C67B28/.test(WIDGET), 'dark palette: its own validated steps, not a flip');
ok(/fh-key/.test(WIDGET) && /Billable /.test(WIDGET) && /Non-billable /.test(WIDGET),
  'a legend names both series with their numbers — identity is never colour alone, and the light '
  + 'orange carries a contrast WARN that visible labels are what relieve');
ok(/aria-label/.test(WIDGET), 'the dot names itself for a screen reader');
ok(/function skipBlock/.test(WIDGET) && /fh-sr/.test(WIDGET),
  'the popover carries the schedule\u2019s go/skip strips beside the balance');
ok(/if \(!k \|\| !k\.rows \|\| !k\.rows\.length\) return ''/.test(WIDGET),
  'and shows nothing at all when the schedule store has not been read \u2014 absence, not "no skips"');
ok(/rec\.skip/.test(WIDGET), 'read off the record /api/hours already serves, with no second fetch');
var BASE = /#fcc-hrs\{[\s\S]*?\}/.exec(WIDGET)[0];
ok(/opacity:0/.test(BASE) && /pointer-events:none/.test(BASE),
  'the base rule KEEPS the properties that hide the popover \u2014 without them it is permanently '
  + 'on screen and permanently clickable, which reads as a frozen popup');
ok(/box-sizing:border-box/.test(BASE) && /width:362px/.test(BASE),
  'border-box caps the WHOLE card, and the width compensates so the CONTENT stays the 330px it has '
  + 'always been \u2014 folding the padding in narrowed it and wrapped the posture buttons');
ok(/padding:13px 15px 12px/.test(BASE),
  'and its padding \u2014 losing it puts the chart and the links flush against the card edge');
ok(!/\}[\s\S]*\{/.test(BASE.slice(BASE.indexOf('{') + 1, BASE.length - 1)),
  'the rule is ONE block: a stray brace mid-rule silently discards everything after it');
ok(/max-height:min\(660px,calc\(100vh - 24px\)\);overflow:auto/.test(WIDGET),
  'the taller popover scrolls inside itself rather than running off a short viewport');
ok(/markets read, so these are a floor/.test(WIDGET),
  'a partly-read book is stated as a FLOOR, never implied to be the whole account');
ok(/not the same as zero/.test(WIDGET), 'and an unread client is never rendered as 0 hours');

const CC = rd('docs', 'FeedSpark_Command_Center.html');
ok(/portHours/.test(CC), "the dossier's portfolio band carries the hours inline as well as on the dot");
ok(/fcc-hours/.test(CC) && /fcc-hours/.test(WIDGET),
  'and refills when the hours land, rather than polling for them');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
