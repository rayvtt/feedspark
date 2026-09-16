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
  ${liftVar(CC, 'WF_SHUT')} ${liftVar(CC, 'WF_TEST')} ${liftVar(CC, 'LW_RANK')}
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
ok('…on a timer', /setInterval\(function\(\)\{ livePoll\(true\); \},BRIEF_TTL\)/.test(CC));
ok('…and when the tab comes back', /visibilitychange[\s\S]{0,80}livePoll/.test(CC));
ok('the cached pipeline expires instead of living forever', /BRIEF_TTL/.test(CC));
ok('a failed refresh keeps the last good data rather than blanking the block',
   /BRIEFSC=\(j&&typeof j==='object'&&!j\.error\)\?j:\(BRIEFSC\|\|\{\}\)/.test(CC));
ok('the pipeline section is rendered', CC.indexOf('In the pipeline') > 0);
ok('rows link into Workflow', /class="lw-chip" href="\/workflow"/.test(CC));
// the dossier is the INTERNAL view — the client-facing one-pager is what sanitises vocabulary
ok('live rows are not run through the client-safe scrubber', !/liveRows[\s\S]{0,400}opSafe\(/.test(CC));

console.log('\n-- ONE list, ranked (Ray: "why the two sections … basically merged together") --');
{
  const M = A.liveWork('Reiss', TASKS);
  ok('tests and pipeline are merged into one list',
     M.items.length === M.tests.length + M.flight.length, [M.items.length, M.tests.length, M.flight.length]);
  ok('nothing is dropped by the merge',
     M.items.length === 6, M.items.map((r) => r.lbl));
  ok('running leads', M.items[0].st === 'running', M.items.map((r) => r.st));
  const rank = M.items.map((r) => ({ running: 0, analysis: 1, progress: 2, briefed: 3, blocked: 4 }[r.st] ?? 5));
  ok('the order never goes backwards', rank.every((v, i, a2) => !i || a2[i - 1] <= v), rank);
  ok('the In progress ticket sits with its siblings, not under its own heading',
     M.items.some((r) => r.st === 'progress'), M.items.map((r) => r.st));
  ok('a plan-only row ranks last, after every live ticket',
     rank[rank.length - 1] === 5, rank);
  // the count beside the heading still says how many are genuinely TESTS
  ok('the test count is still available for the heading', M.tests.length === 4, M.tests.length);
}

console.log('\n-- the chip mirrors Workflow, and stops stretching --');
{
  const bf = WF.match(/\.bf-chip\{([^}]*)\}/);
  ok('Workflow\u2019s chip rule was found', !!bf);
  const lw = CC.match(/\.lw-chip\{([^}]*)\}/);
  ok('the dossier defines its own chip', !!lw);
  if (bf && lw) {
    ['padding:1px 8px', 'border-radius:100px', 'font-size:9.5px', 'font-weight:900', 'white-space:nowrap']
      .forEach((d) => ok('chip matches Workflow on "' + d + '"',
        bf[1].includes(d) && lw[1].includes(d), [d, lw[1]]));
  }
  // .wl-item is a 3-column grid; a 2-child row put the chip in the 1fr column and it stretched
  ok('the live row overrides the grid so the chip cannot stretch',
     /\.lw-item\{grid-template-columns:1fr auto\}/.test(CC));
  ok('the chip is pinned to the end of its row', /justify-self:end/.test(CC));
  // scoped to the live block — the one-pager has its own legitimate "In the pipeline" list
  const lh = CC.slice(CC.indexOf('function liveHtml('), CC.indexOf('function liveHtml(') + 900);
  ok('the live block renders ONE list, not two', (lh.match(/liveRows\(/g) || []).length === 1,
     (lh.match(/liveRows\(/g) || []).length);
  ok('…and no second heading inside it', !/In the pipeline/.test(lh));
  ok('the heading names what it is', /Active right now/.test(CC));
}

console.log('\n-- the row reads cleanly with parts missing --');
{
  const rows = new Function('esc', `${lift(CC, 'liveRows')} return liveRows;`)((x) => String(x));
  const h = rows([{ id: 'REIS-1', t: 'A task', st: 'running', lbl: 'Test running', court: 'AM', col: '#9D174D', by: '', tkt: true }], 'none');
  ok('an absent author leaves no double separator', !/·\s*·/.test(h), h.match(/wl-meta">[^<]*/));
  ok('…and the parts that exist still join', /REIS-1 · ball with AM/.test(h), h.match(/wl-meta">[^<]*/));
  const h2 = rows([{ id: '', t: 'Plan row', st: '', lbl: 'Open', court: '', col: '#8a94a0', by: 'Ray', tkt: false }], 'none');
  ok('a plan row with no ticket id starts at its owner', /wl-meta">Ray</.test(h2), h2.match(/wl-meta">[^<]*/));
  ok('the heading counts do not run together', / live<\/span>/.test(CC) && /\\u00b7 '\+run/.test(CC));
}

console.log('\n-- the Activity ring (Ray: "use pie chart or some chart to break the text flow") --');
const ring = new Function('fmtN', 'esc', `${lift(CC, 'actRing')} return actRing;`)(
  (n) => String(n), (s) => String(s));
{
  const h = ring({ total: 108, done: 98, open: 6 }, 4, 0);
  ok('it draws a ring', /<svg[\s\S]*<path/.test(h) || /<circle/.test(h));
  ok('overdue is carved OUT of open, never counted twice',
     /<title>Open: 2 /.test(h) && /<title>Overdue: 4 /.test(h), h.match(/<title>[^<]*<\/title>/g));
  ok('the slices add up to the tracked total',
     (h.match(/<title>\w+: (\d+)/g) || []).map((m) => +m.split(': ')[1]).reduce((a, b) => a + b, 0) === 108,
     (h.match(/<title>[^<]*<\/title>/g) || []));
  ok('the centre states the done share', /<b>91%<\/b>/.test(h), h.match(/<b>\d+%<\/b>/));
  ok('every slice is labelled in the legend', /Done<\/span>/.test(h) && /Overdue<\/span>/.test(h));
}
{
  // a plan whose parts do not sum to the total keeps the remainder visible rather than hiding it
  const h = ring({ total: 96, done: 61, open: 34 }, 0, 0);
  ok('a remainder is shown, not folded away', /<title>Other: 1 /.test(h), h.match(/<title>[^<]*<\/title>/g));
}
ok('a brand with no tasks does not draw an empty ring',
   !/<svg/.test(ring({ total: 0, done: 0, open: 0 }, 0, 0)));
ok('overdue larger than open is clamped, never negative',
   !/-\d/.test(ring({ total: 10, done: 8, open: 2 }, 99, 0)));
ok('the ring sits in the same card, with briefs/kw below a rule',
   /dzp-act[\s\S]{0,4000}dzp-foot/.test(CC));

console.log('\n-- real time: what another module changed shows without a manual refresh --');
ok('every portfolio cache has a stamp, not just the briefs', /var PSTAMP=\{briefs:0,alerts:0,kw:0\}/.test(CC));
ok('the guard-alert read expires', /ALERTC===null\|\|!pFresh\('alerts'\)/.test(CC));
ok('the keyword-calendar read expires', /KWC===null\|\|!pFresh\('kw'\)/.test(CC));
ok('the Feed Lab audit expires too — it is what a scan rewrites', /AUDAT\[key\]/.test(CC));
ok('the poll repaints the portfolio band, not only the live block', /liveFill\(cur\); portFill\(cur\);/.test(CC));
ok('coming back to the tab refreshes immediately', /visibilitychange[\s\S]{0,90}livePoll\(true\)/.test(CC));
ok('another tab can announce a change', /'storage'[\s\S]{0,80}fcc-touch/.test(CC));

console.log('\n-- the cross-tab broadcaster --');
{
  const TW = fs.readFileSync(path.join(ROOT, 'docs', 'touch_widget.html'), 'utf8');
  const WK = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');
  ok('it is injected on app pages', /TOUCHW/.test(WK) && /touch_widget\.html/.test(WK));
  ok('only mutating methods announce', /MUT=\/\^\(POST\|PUT\|PATCH\|DELETE\)/.test(TW));
  ok('only a successful response announces', /if\(r&&r\.ok\)touch\(\)/.test(TW));
  ok('the heartbeat routes are excluded, or every page would fire it every minute',
     /presence\|activity\|claude\|version/.test(TW));
  ok('storage failure cannot break the fetch it observes', /try\{ localStorage\.setItem/.test(TW));
  ok('it returns the original promise', /return p;/.test(TW));
  ok('it installs once', /window\.__fccTouch/.test(TW));
}

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
