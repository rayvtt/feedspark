#!/usr/bin/env node
/*
 * SUGGESTED NEXT MOVES ARRIVE FILTERED (Ray, 16 Sep 2026).
 *
 *   "within the suggested next moves, when you hit chase or reschedule the four overdue tasks.
 *    When you hit the workflow tab you open, it should auto-filter to those four overdue tasks.
 *    So the same mechanism should be replicated everywhere."
 *
 * A suggestion that names a number has already done the counting. Landing on an unfiltered
 * board makes the reader do it again by eye. This pins BOTH halves of the chain — the link the
 * dossier builds, and the target actually honouring it — because either half alone is a link
 * that looks right and does nothing.
 *
 * Run: node tools/test_deeplink.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => fs.readFileSync(path.join(ROOT, 'docs', p), 'utf8');
const CC = R('FeedSpark_Command_Center.html');
const WF = R('FeedSpark_Workflow.html');
const LG = R('FeedSpark_LabelGuard.html');
const PT = R('FeedSpark_ProductTypeGuard.html');
const FLAB = R('FeedSpark_FeedLab.html');
const KW = R('FeedSpark_KWCal.html');

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

console.log('\n-- the dossier builds a filtered link for every suggestion --');
// the suggestion block, isolated so a stray '/workflow' elsewhere on the page can't pass this
const sugBlock = CC.slice(CC.indexOf('var sug=[]'), CC.indexOf('var sug=[]') + 3000);
ok('a Workflow link helper exists', /WF=function\(f\)/.test(sugBlock));
ok('…and it always carries the brand', /'\/workflow\?client='\+C/.test(sugBlock));
ok('the overdue move filters to overdue', /overdue task[\s\S]{0,60}WF\('overdue'\)/.test(sugBlock),
   sugBlock.match(/overdue task[\s\S]{0,90}/));
ok('the "open tasks, no briefs" move filters to open', /no briefs in flight[\s\S]{0,60}WF\('open'\)/.test(sugBlock));
ok('the weakest-lane move also carries the lane as a search', /WF\('open'\)\+'&q='/.test(sugBlock));
ok('the guard moves name the brand', /'\/labels':'\/ptypes'\)\+'\?client='\+C/.test(sugBlock));
ok('the warning move names the brand', /'\/labels\?client='\+C/.test(sugBlock));
ok('the weak-audit move opens the WORST market, not just the brand',
   /dissect the weak pillars[\s\S]{0,60}FL\+'&market='/.test(sugBlock));
ok('the saturation move opens the worst market too',
   /step toward 100%[\s\S]{0,80}KWL\+'&market='/.test(sugBlock));
ok('NO suggestion still links to a bare module page',
   !/l:'\/(workflow|labels|ptypes)'/.test(sugBlock),
   (sugBlock.match(/l:'\/[a-z]+'/g) || []));

console.log('\n-- Workflow honours it --');
ok('it reads ?client=', /var cl=qs\('client'\)/.test(WF));
ok('it reads ?f=', /qs\('f'\)/.test(WF));
ok('overdue sets the board’s own overdue filter', /f==='overdue'\)\{ itState\.overdue=true/.test(WF));
ok('open narrows the status filter', /f==='open'\)\{ itState\.statuses=\['open'\]/.test(WF));
ok('the client filter is the board’s own', /itState\.clients=\[cl\]/.test(WF));
// the month window would otherwise hide rows the dossier counted across all time
ok('the month window is lifted so it cannot hide what was counted',
   /itState\.window=''/.test(WF));
ok('a brand the board does not know is added, never filed under the first client',
   /CLIENTS\.indexOf\(cl\)<0/.test(WF));
ok('the query string is cleared so a refresh is not stuck in the filter',
   /deep-link[\s\S]{0,2200}history\.replaceState/.test(WF));
ok('it says what it filtered', /Filtered from the brand dossier/.test(WF));
ok('…with one click to clear it', /Clear filter/.test(WF));
ok('clearing restores the board’s defaults, not an empty board',
   /itState\.statuses=\['open','progress','briefed'\]/.test(WF));
ok('it re-renders rather than waiting for the next interaction',
   /renderIntake\(\);[\s\S]{0,400}scrollIntoView/.test(WF));
ok('the existing ?brief= deep link still stands', /\[\?&\]brief=/.test(WF));

console.log('\n-- the guards honour it --');
[['Label Guard', LG], ['PT Guard', PT]].forEach(([n, src]) => {
  ok(n + ': estate cards carry their client', /est-card" data-client="/.test(src));
  ok(n + ': it reads ?client=', /\[\?&\]client=\(\[\^&\]\+\)/.test(src));
  ok(n + ': it scrolls to the brand', /scrollIntoView/.test(src));
  ok(n + ': the name is folded, so "House of Bruar" matches',
     /replace\(\/\[\^a-z0-9\]\/g,''\)/.test(src));
  // a guard page that HIDES feeds is how a real alert goes unseen
  ok(n + ': nothing is hidden — it marks and scrolls', !/display:none[\s\S]{0,40}est-card/.test(src));
  ok(n + ': it gives up rather than spinning forever', /tries<20/.test(src));
});

console.log('\n-- Feed Lab and the calendar already took these, and still do --');
ok('Feed Lab reads ?client=', /\[\?&\]client=\(\[\^&\]\+\)/.test(FLAB));
ok('Feed Lab reads ?market=', /\[\?&\]market=\(\[\^&\]\+\)/.test(FLAB));
ok('the calendar reads ?client=', /\[\?&\]client=\(\[\^&\]\+\)/.test(KW));
ok('the calendar reads ?market=', /\[\?&\]market=\(\[\^&\]\+\)/.test(KW));

console.log('\n-- every link the dossier emits points somewhere that reads it --');
const HONOURS = { '/workflow': WF, '/labels': LG, '/ptypes': PT, '/feedlab': FLAB, '/kwcal': KW };
Object.keys(HONOURS).forEach((route) => {
  ok(route + ' parses a query string at all', /location\.search/.test(HONOURS[route]));
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
