#!/usr/bin/env node
/*
 * Work-volumes harness (Ray, 15 Sep 2026): every workstream on an account bucketed by month for
 * the Deck Generator's chart workbench. Pure node over src/volumes.js.
 *
 * What breaks this and is pinned here:
 *   1. DATES ARRIVE IN SIX SHAPES — epoch ms (emails, calls, briefs), ISO month-section stamps
 *      ('2026-04-01', the plan), UK due dates ('14/07/2026'), 'Jul 25' section labels, Sheets
 *      serials and RFC-2822 mail headers. One reader, no guessing: unreadable = undated.
 *   2. The window is a fixed run of months ending at the chosen month — a record outside it is
 *      counted as `outside`, never dropped silently.
 *   3. Each stream's breakdown dims are labelled for the page (category codes → names, stage
 *      slugs → names), and the schedule stream carries hours as sums, not counts.
 * Run: node tools/test_volumes.mjs
 */
import { monthKey, monthRange, monthLabel, planStream, emailStream, callStream, briefStream, scheduleStream, resultStream, buildVolumes, STREAMS }
  from '../cloudflare/feedspark-deck/src/volumes.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

console.log('\n-- monthKey: six date shapes → YYYY-MM --');
ok('epoch ms', monthKey(Date.UTC(2026, 6, 14)) === '2026-07');
ok('epoch ms as string', monthKey(String(Date.UTC(2026, 6, 14))) === '2026-07');
ok('ISO month-section stamp (plan)', monthKey('2026-04-01') === '2026-04');
ok('ISO date', monthKey('2026-09-10') === '2026-09');
ok('UK due date DD/MM/YYYY', monthKey('14/07/2026') === '2026-07');
ok('UK due date DD/MM/YY', monthKey('3/2/26') === '2026-02');
ok('section label "Jul 25"', monthKey('Jul 25') === '2025-07');
ok('section label "July-2026"', monthKey('July-2026') === '2026-07');
ok('Sheets serial', monthKey(46205) === '2026-07');
ok('RFC-2822 mail date', monthKey('Tue, 12 Aug 2026 09:14:00 +0100') === '2026-08');
ok('garbage is undated', monthKey('Negative hours') === '' && monthKey('') === '' && monthKey(null) === '' && monthKey('99/99/2026') === '');

console.log('\n-- the window --');
ok('six months ending Sep 26', monthRange(6, '2026-09').join(',') === '2026-04,2026-05,2026-06,2026-07,2026-08,2026-09', monthRange(6, '2026-09'));
ok('crosses the year boundary', monthRange(3, '2026-01').join(',') === '2025-11,2025-12,2026-01');
ok('labels', monthLabel('2026-09') === 'Sep 26');

console.log('\n-- streams --');
const M = monthRange(6, '2026-09');
const plan = planStream([
  { t: 'Title batch', o: 'Dino', s: 'Done', b: 'done', c: 'title', d: '2026-07-01' },
  { t: 'Keyword batch', o: 'Dino', s: 'Open', b: 'open', c: 'keyword', d: '14/08/2026' },
  { t: 'QBR', o: 'Ray', s: 'Done', b: 'done', c: 'account', d: '2026-09-01' },
  { t: 'Old task', o: 'Ray', s: 'Done', b: 'done', c: 'account', d: '2025-11-01' },
  { t: 'No date', o: '', s: 'Open', b: 'open', c: 'opt', d: '' },
], M);
ok('plan: 3 in window, 1 outside, 1 undated', plan.n === 3 && plan.outside === 1 && plan.undated === 1, plan);
ok('plan: byMonth', plan.byMonth['2026-07'] === 1 && plan.byMonth['2026-08'] === 1 && plan.byMonth['2026-09'] === 1 && plan.byMonth['2026-04'] === 0);
ok('plan dims labelled: category / status / owner', plan.dims.category.Titles['2026-07'] === 1 && plan.dims.status.Done['2026-09'] === 1 && plan.dims.owner.Dino['2026-08'] === 1, plan.dims);
const emails = emailStream([
  { id: 'a', date: Date.UTC(2026, 7, 3), client: 'Reiss', briefable: true },
  { id: 'b', date: 'Tue, 12 Aug 2026 09:14:00 +0100', client: 'Reiss', dismissed: true, decidedAs: 'task' },
  { id: 'c', date: Date.UTC(2026, 8, 3), client: 'Reiss', kind: 'kwresult', dismissed: true, decidedAs: 'notask' },
], M);
ok('emails: decisions + kinds', emails.n === 3 && emails.dims.decision['Awaiting triage']['2026-08'] === 1 && emails.dims.decision['Filed as task']['2026-08'] === 1 && emails.dims.kind['Result update']['2026-09'] === 1, emails.dims);
const calls = callStream([{ id: '1', call: 'Reiss x FeedSpark monthly', when: Date.UTC(2026, 8, 2), owner: 'Ray', task: 'Send roadmap' }, { id: '2', call: 'Reiss x FeedSpark monthly', when: Date.UTC(2026, 8, 2), owner: 'Steven', task: 'Fix feed' }], M);
ok('calls: 2 actions from one meeting', calls.n === 2 && calls.dims.meeting['Reiss x FeedSpark monthly']['2026-09'] === 2 && calls.dims.owner.Steven['2026-09'] === 1);
const briefs = briefStream([{ id: 'x', client: 'Reiss', created: Date.UTC(2026, 6, 20), status: 'done', cat: 'keyword', source: 'plan' }, { id: 'y', client: 'Reiss', created: Date.UTC(2026, 8, 1), status: 'intake', cat: '', source: 'email' }], M);
ok('briefs: stage / category / source', briefs.n === 2 && briefs.dims.stage['Done — ASPL']['2026-07'] === 1 && briefs.dims.category.Keywords['2026-07'] === 1 && briefs.dims.source['From email']['2026-09'] === 1, briefs.dims);
const sched = scheduleStream([
  { w: '2026-07-02', b: 'Reiss', m: 'eu', k: 'kw', d: 'skip', h: 4 }, { w: '2026-07-09', b: 'Reiss', m: 'gb', k: 'titles', d: 'go', h: 4 },
  { w: '2026-08-06', b: 'Reiss', m: 'eu', k: 'kw', d: 'skip', h: 4.5 }, { w: null, b: 'Reiss', m: 'gb', k: 'kw', d: 'go', h: 4 },
], M);
ok('schedule: rows by month + task / decision / market dims', sched.n === 3 && sched.undated === 1 && sched.dims.decision.Skipped['2026-07'] === 1 && sched.dims.task.Keywords['2026-08'] === 1 && sched.dims.market.EU['2026-07'] === 1);
ok('schedule: hours are SUMS — offered 8 / skipped 4 / delivered 4 in Jul, skipped 4.5 in Aug', sched.sums.hours['2026-07'] === 8 && sched.sums.hoursSkipped['2026-07'] === 4 && sched.sums.hoursDelivered['2026-07'] === 4 && sched.sums.hoursSkipped['2026-08'] === 4.5, sched.sums);
const res = resultStream([{ id: 'r', client: 'Reiss', mkt: 'gb', when: Date.UTC(2026, 7, 28), verdict: 'good' }, { id: 's', client: 'Reiss', mkt: 'de', when: Date.UTC(2026, 8, 12), verdict: 'bad' }], M);
ok('results: market / verdict', res.n === 2 && res.dims.verdict.Positive['2026-08'] === 1 && res.dims.market.DE['2026-09'] === 1);

console.log('\n-- the payload --');
const V = buildVolumes({ months: M, plan: [{ t: 'a', b: 'done', c: 'title', d: '2026-09-01' }], emails: [{ id: 'e', date: Date.UTC(2026, 8, 3) }], calls: [], briefs: [], schedule: [], results: [], meta: { plan: { source: 'planlive' } } });
ok('six streams in fixed order', STREAMS.map((s) => s.key).join(',') === 'plan,emails,calls,briefs,schedule,results' && Object.keys(V.streams).length === 6);
ok('months + labels + totals', V.months.length === 6 && V.labels[5] === 'Sep 26' && V.total['2026-09'] === 2 && V.total['2026-04'] === 0 && V.n === 2, V.total);
ok('meta rides on its stream', V.streams.plan.meta.source === 'planlive' && !V.streams.emails.meta);
ok('default window = n months ending now', buildVolumes({ n: 3 }).months.length === 3 && buildVolumes({ n: 3 }).months[2] === monthKey(Date.now()));
ok('empty dims stay empty objects, never crash', Object.keys(V.streams.calls.dims).length === 0 && V.streams.calls.n === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
