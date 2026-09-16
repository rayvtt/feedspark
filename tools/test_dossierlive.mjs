#!/usr/bin/env node
/*
 * THE DOSSIER'S LIVE WORK BLOCK (Ray, 16 Sep 2026).
 *
 *   "another section within the brand dossier — current running tests — shows zero live. At
 *    least I can see that three keyword optimization tests are running in the current workflow.
 *    So be more dynamic in our active tasks at the moment in the brand dossier, because that
 *    will be the main interface for leadership and higher management."
 *
 * The block read only the project plan's own test-flagged rows, so three pipeline tickets
 * sitting at "Test running" in Workflow — Steven's keyword optimisations, which have no
 * test-flagged plan row — rendered as "0 live". The fixture below IS that situation.
 *
 * The functions are lifted out of the page by name so the shipped code is what runs here.
 * Run: node tools/test_dossierlive.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CC = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');
const WF = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Workflow.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced: ' + name);
}
function liftVar(src, name) {
  const re = new RegExp('var ' + name + '=\\{[\\s\\S]*?\\};');
  const m = src.match(re);
  if (!m) throw new Error('not found: var ' + name);
  return m[0];
}

// build a sandbox carrying the page's own vocabulary + functions
const api = new Function('BRIEFSC', `
  ${liftVar(CC, 'WF_STAGE')} ${liftVar(CC, 'WF_COURT')} ${liftVar(CC, 'WF_COLOR')}
  ${liftVar(CC, 'WF_SHUT')} ${liftVar(CC, 'WF_TEST')}
  ${lift(CC, 'wfNorm')} ${lift(CC, 'wkKey')} ${lift(CC, 'liveWork')}
  return { liveWork:liveWork, wkKey:wkKey, wfNorm:wfNorm,
           WF_STAGE:WF_STAGE, WF_COURT:WF_COURT, WF_SHUT:WF_SHUT, WF_TEST:WF_TEST };
`);

/* Ray's actual board: three keyword optimisations Steven briefed, all at Test running, plus a
   finished one and a foreign brand's ticket. */
const BRIEFS = {
  a: { id: 'REIS-20260910-02', client: 'Reiss', task: 'Keywords Optimisation - Cashmere/Merino - Marketing Planner - 0926', status: 'running', by: 'Steven', updated: 30 },
  b: { id: 'REIS-20260914-01', client: 'Reiss', task: 'Keywords Optimisation - Gifting - Marketing Planner - 1126', status: 'running', by: 'Steven', updated: 20 },
  c: { id: 'REIS-20260908-01', client: 'Reiss', task: 'Keywords Optimisation - Leather & Suede - Marketing Planner - 0926', status: 'running', by: 'Steven', updated: 10 },
  d: { id: 'REIS-20260901-01', client: 'Reiss', task: 'AI readiness audit', status: 'progress', by: 'Ray', updated: 40 },
  e: { id: 'REIS-20260820-01', client: 'Reiss', task: 'Daily delta-alert monitoring proposal', status: 'briefed', by: 'Ray', updated: 5 },
  f: { id: 'REIS-20260701-01', client: 'Reiss', task: 'An old finished thing', status: 'confirmed', by: 'Ray', updated: 99 },
  g: { id: 'REIS-20260702-01', client: 'Reiss', task: 'Another finished thing', status: 'done', by: 'Ray', updated: 98 },
  h: { id: 'SCH-20260901-01', client: 'Schuh', task: 'Somebody else\u2019s test', status: 'running', by: 'Ray', updated: 50 },
};
const A = api(BRIEFS);

console.log('\n-- the report: three tests running, dossier said 0 --');
let L = A.liveWork('Reiss', []);
ok('the three running tickets are found with NO plan row at all', L.tests.length === 3, L.tests.map((t) => t.id));
ok('…named, not just counted', L.tests.every((t) => /Keywords Optimisation/.test(t.t)));
ok('each carries its ticket id', L.tests.every((t) => /^REIS-/.test(t.id)));
ok('each carries the stage label Workflow shows', L.tests.every((t) => t.lbl === 'Test running ⏱'), L.tests[0]);
ok('…and whose court it sits in', L.tests.every((t) => t.court === 'AM'));
ok('newest first', L.tests[0].id === 'REIS-20260910-02', L.tests.map((t) => t.id));

console.log('\n-- the pipeline behind them --');
ok('in-flight tickets are listed apart from the tests', L.flight.length === 2, L.flight.map((f) => f.id));
ok('an In progress ticket is in flight, not a test', L.flight.some((f) => f.lbl === 'In progress'));
ok('a Briefed ticket is in flight', L.flight.some((f) => f.lbl === 'Briefed to ASPL'));
ok('ASPL holds the briefed ball', L.flight.find((f) => f.st === 'briefed').court === 'ASPL');

console.log('\n-- what must NEVER appear --');
ok('a confirmed ticket is finished, not in flight', !L.flight.concat(L.tests).some((r) => r.st === 'confirmed'));
ok('a done ticket is finished too', !L.flight.concat(L.tests).some((r) => r.st === 'done'));
ok('another brand\u2019s test never leaks in',
   !L.tests.concat(L.flight).some((r) => /Somebody/.test(r.t)), L.tests.concat(L.flight).map((r) => r.t));
ok('the brand\u2019s whole ticket count excludes the other brand', L.n === 7, L.n);

console.log('\n-- plan test rows join in, but the same work is never listed twice --');
const TASKS = [
  { t: 'Keywords Optimisation - Gifting - Marketing Planner - 1126', x: true, b: 'open', ae: 'Steven' }, // same as ticket b
  { t: 'Brand inclusion A/B title test', x: true, b: 'open', ae: 'Ray' },                                 // plan-only test
  { t: 'A finished test', x: true, b: 'done', ae: 'Ray' },                                                // done
  { t: 'Not a test at all', x: false, b: 'open', ae: 'Ray' },
];
L = A.liveWork('Reiss', TASKS);
ok('a plan-only test is added', L.tests.some((t) => /Brand inclusion/.test(t.t)));
ok('a plan row already covered by a ticket is NOT duplicated',
   L.tests.filter((t) => /Gifting/.test(t.t)).length === 1, L.tests.filter((t) => /Gifting/.test(t.t)));
ok('…and the TICKET is the one kept, because it carries the live stage',
   L.tests.find((t) => /Gifting/.test(t.t)).tkt === true);
ok('a done plan test is not "running"', !L.tests.some((t) => /A finished test/.test(t.t)));
ok('a non-test plan row is not a test', !L.tests.some((t) => /Not a test/.test(t.t)));
ok('total tests = 3 tickets + 1 plan-only', L.tests.length === 4, L.tests.length);

console.log('\n-- wording folds so a ticket and its plan row match --');
ok('bracketed codes are ignored',
   A.wkKey('[SVS-Q3/26] Keyword Planner') === A.wkKey('Keyword Planner'));
ok('an escaped ampersand folds', A.wkKey('Leather &amp; Suede') === A.wkKey('Leather & Suede'));
ok('case and punctuation fold', A.wkKey('AI Readiness Audit!') === A.wkKey('ai readiness audit'));
ok('two different tasks do NOT fold', A.wkKey('Gifting') !== A.wkKey('Cashmere/Merino'));

console.log('\n-- empties and junk --');
ok('no briefs at all is empty, not a crash',
   api({}).liveWork('Reiss', []).tests.length === 0);
ok('a brand with nothing gets nothing', A.liveWork('Nobody', []).tests.length === 0);
ok('a null task list is fine', A.liveWork('Reiss', null).tests.length === 3);
ok('an unknown stage is still shown, never silently dropped',
   api({ z: { id: 'X', client: 'Reiss', task: 'T', status: 'whatever' } }).liveWork('Reiss', []).flight.length === 1);
ok('a collapsed duplicate ticket is skipped',
   api({ z: { id: 'X', client: 'Reiss', task: 'T', status: 'running', dup: 1 } }).liveWork('Reiss', []).tests.length === 0);

console.log('\n-- the stage vocabulary must not drift from Workflow --');
// Workflow is the canonical: a stage it knows and this page doesn't renders without a label
const wfStages = [...WF.matchAll(/\['(\w+)','([^']+)','#[0-9A-Fa-f]{6}'\]/g)].map((m) => [m[1], m[2]]);
ok('Workflow\u2019s stage list was found', wfStages.length >= 8, wfStages.length);
wfStages.forEach(([k, label]) => {
  ok('the dossier knows stage "' + k + '"', A.WF_STAGE[k] === label, [A.WF_STAGE[k], label]);
});
const wfCourt = WF.match(/var COURT=\{[^}]*\}/);
ok('Workflow\u2019s court map was found', !!wfCourt);
if (wfCourt) {
  const court = new Function('return ' + wfCourt[0].replace('var COURT=', '') + ';')();
  Object.keys(court).forEach((k) => {
    ok('court for "' + k + '" agrees', A.WF_COURT[k] === court[k], [A.WF_COURT[k], court[k]]);
  });
}

console.log('\n-- the page wiring --');
ok('the in-flight count reads .status, not the .st that never existed',
   /!WF_SHUT\[wfNorm\(x\.status\)\]/.test(CC) && !/String\(x\.st\|\|''\)/.test(CC));
ok('the block has its own container to repaint', CC.indexOf('id="dz-live"') > 0);
ok('there is a refresh that re-reads the pipeline', /function livePoll\(/.test(CC));
ok('…on a timer', /setInterval\(livePoll/.test(CC));
ok('…and when the tab comes back', /visibilitychange[\s\S]{0,80}livePoll/.test(CC));
ok('the cached pipeline expires instead of living forever', /BRIEF_TTL/.test(CC));
ok('a failed refresh keeps the last good data rather than blanking the block',
   /BRIEFSC=\(j&&typeof j==='object'&&!j\.error\)\?j:\(BRIEFSC\|\|\{\}\)/.test(CC));
ok('the pipeline section is rendered', CC.indexOf('In the pipeline') > 0);
ok('rows link into Workflow', /class="lw-chip" href="\/workflow"/.test(CC));
// the dossier is the INTERNAL view — the client-facing one-pager is what sanitises vocabulary
ok('live rows are not run through the client-safe scrubber', !/liveRows[\s\S]{0,400}opSafe\(/.test(CC));

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
