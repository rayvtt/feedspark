#!/usr/bin/env node
/*
 * A/B test archive parsing (Ray, 9 Sep 2026).
 *
 * Unlike the emailed keyword results, these fixtures are REAL: the report prose below is taken
 * verbatim from Reiss's "AB Test Archive" tab, read through the Drive API. The two things that
 * actually break this parser are both pinned here:
 *   1. MERGED CELLS — a test spans ~13 sheet rows (its graph's height) and the values API puts
 *      the value only in the top-left cell, so twelve empty rows follow every real one.
 *   2. UNSIGNED PROSE — the team writes "experienced a 17.67% lowered in impressions". Read
 *      naively that is +17.67% and a losing test reports as a win.
 * Run: node tools/test_abtests.mjs
 */
import { parseAbTests, extractMetrics, abVerdict, abSummary, resolveAbTab, findHeaderRow }
  from '../cloudflare/feedspark-deck/src/abtests.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

const HDR = ['Country', 'Test Method', 'Test Type', 'Batch URL', 'Live Date', 'Report Date', 'Graph', 'Report'];
const blank = (n) => new Array(n).fill('');
// real Reiss prose
const JAN1 = 'A/B test to assess the impact of keyword optimization on impressions. The Keywords '
  + 'Optimisation Test was about embedding Keywords in your feeds. The Batch Size was containing 500 '
  + 'products (50% tested: Test Group | 50% non-tested: Control Group). The test was running for 4 weeks. '
  + 'Results: The A/B test for keyword optimization resulted in a negative impact on both impressions and '
  + 'clicks. The test group experienced a -17.67% lowered in impressions and a -18.18% lowered in clicks '
  + 'compared to the control group.';
const JAN2 = 'The green line (test group with keyword optimization) consistently trends above the purple '
  + 'line (control group). The A/B test for keyword optimization resulted in a positive impact on both '
  + 'impressions and clicks. The test group experienced a 21.37% uplift in impressions and a 11.85% uplift '
  + 'in clicks. Conclusion: The test’s results support the continued use and potential expansion of '
  + 'keyword optimization strategies.';
const TITLE = 'No performance data detected > This test is inconclusive';

console.log('\n-- tab resolution (fails closed, never the Project Plan) --');
ok('exact name wins', resolveAbTab(['Project Plan', 'AB Test Archive', 'Scrape']) === 'AB Test Archive');
ok('case/spacing variant', resolveAbTab(['Project Plan', 'A/B Test Archive']) === 'A/B Test Archive');
ok('"Test Archive" accepted', resolveAbTab(['Project Plan', 'Test Archive']) === 'Test Archive');
ok('NEVER falls back to a plan tab', resolveAbTab(['Project Plan', 'Onboarding Plan']) === null);
// an EXACT name still wins beside a near-miss — "Old AB Test Archive" is plainly the previous
// copy, and refusing to read a correctly-named tab because a stale one sits next to it would
// strand the brand for no safety gain
ok('exact name wins over a near-miss sibling',
   resolveAbTab(['AB Test Archive', 'Old AB Test Archive']) === 'AB Test Archive');
ok('two near-misses and no exact = ambiguous, not a guess',
   resolveAbTab(['Old AB Test Archive', 'AB Test Archive 2024']) === null,
   resolveAbTab(['Old AB Test Archive', 'AB Test Archive 2024']));

console.log('\n-- unsigned prose keeps its direction --');
ok('"-17.67% lowered" is negative', extractMetrics(JAN1).impressions === -17.67, extractMetrics(JAN1));
ok('"-18.18% lowered in clicks" is negative', extractMetrics(JAN1).clicks === -18.18);
ok('"21.37% uplift" is positive', extractMetrics(JAN2).impressions === 21.37, extractMetrics(JAN2));
ok('unsigned + "lowered" flips negative',
   extractMetrics('experienced a 6.03% lowered in impressions').impressions === -6.03,
   extractMetrics('experienced a 6.03% lowered in impressions'));
ok('unsigned + "uplift" stays positive',
   extractMetrics('a 11.26% uplift in impressions').impressions === 11.26);
ok('metric-then-percent order also reads',
   extractMetrics('impressions rose by 9.4% over the period').impressions === 9.4,
   extractMetrics('impressions rose by 9.4% over the period'));

console.log('\n-- verdicts --');
ok('both metrics down = negative', abVerdict(extractMetrics(JAN1), JAN1) === 'negative');
ok('both metrics up = positive', abVerdict(extractMetrics(JAN2), JAN2) === 'positive');
ok('no data = inconclusive', abVerdict({}, TITLE) === 'inconclusive');
ok('no metrics and no cue = unknown', abVerdict({}, 'Ran for four weeks.') === 'unknown');
ok('one up one down = mixed', abVerdict({ impressions: 10, clicks: -9 }, '') === 'mixed');

console.log('\n-- merged cells: one test, twelve empty continuation rows --');
{
  const values = [
    HDR,
    ['GB', 'AB Test', 'Keyword Optimisation', 'Jan I - Keyword Optimisation', '8/1/2025', '4/2/2025', '', JAN1],
    ...Array.from({ length: 12 }, () => blank(8)),
    ['GB', 'Single Group', 'Title Optimisation', 'Data field and title optimisation', 'NA', 'NA', '', TITLE],
    ...Array.from({ length: 12 }, () => blank(8)),
    ['GB', 'AB Test', 'Keyword Optimisation', 'Jan II - Keyword Optimisation', '21/01/2025', '17/02/2025', '', JAN2],
    ...Array.from({ length: 12 }, () => blank(8)),
  ];
  const r = parseAbTests(values);
  ok('three tests, not thirty-nine', r.ok && r.tests.length === 3, r.tests && r.tests.length);
  ok('first test keeps its batch', r.tests[0].batch === 'Jan I - Keyword Optimisation');
  ok('first test reads negative', r.tests[0].verdict === 'negative', r.tests[0].verdict);
  ok('title run is inconclusive', r.tests[1].verdict === 'inconclusive');
  ok('third test reads positive', r.tests[2].verdict === 'positive');
  ok('dates carried', r.tests[2].live === '21/01/2025' && r.tests[2].reportDate === '17/02/2025');
}

console.log('\n-- report text arriving BELOW the anchor row --');
{
  const values = [
    HDR,
    ['GB', 'AB Test', 'Keyword Optimisation', 'Feb I', '2/2/2025', '1/3/2025', '', ''],
    [...blank(7), JAN2],
    ...Array.from({ length: 6 }, () => blank(8)),
  ];
  const r = parseAbTests(values);
  ok('one test', r.tests.length === 1);
  ok('the trailing report attaches to it', r.tests[0].verdict === 'positive', r.tests[0].verdict);
}

console.log('\n-- the tab continues into unrelated blocks --');
{
  // the real Reiss sheet runs Material/Pattern/Market tables under the archive; a naive read
  // swallowed 344 "tests" out of 10
  const values = [
    HDR,
    ['GB', 'AB Test', 'Keyword Optimisation', 'Jan I', '8/1/2025', '4/2/2025', '', JAN1],
    ...Array.from({ length: 12 }, () => blank(8)),
    ['Material', '', '', '', '', '', '', ''],
    ['Leather', '', '', '', '', '', '', ''],
    ['Cashmere', '', '', '', '', '', '', ''],
    ['Pattern', '', '', '', '', '', '', ''],
    ['Floral', '', '', '', '', '', '', ''],
    ['Herringbone', '', '', '', '', '', '', ''],
  ];
  const r = parseAbTests(values);
  ok('material/pattern rows are not tests', r.tests.length === 1, r.tests.length);
}

console.log('\n-- header not at column A --');
{
  const values = [
    ['', '', 'Country', 'Test Method', 'Test Type', 'Batch URL', 'Live Date', 'Report Date', 'Report'],
    ['', '', 'GB', 'AB Test', 'Keyword Optimisation', 'Mar I', '1/3/2025', '1/4/2025', JAN2],
  ];
  const h = findHeaderRow(values);
  ok('header located at its real column', h && h.col === 2, h);
  const r = parseAbTests(values);
  ok('offset table still parses', r.tests.length === 1 && r.tests[0].country === 'GB', r.tests);
}

console.log('\n-- no archive tab / empty sheet --');
ok('missing header reports no_header', parseAbTests([['a', 'b']]).error === 'no_header');
ok('empty values report no_header', parseAbTests([]).error === 'no_header');

console.log('\n-- summary --');
{
  const tests = [
    { verdict: 'negative', type: 'Keyword Optimisation' },
    { verdict: 'positive', type: 'Keyword Optimisation' },
    { verdict: 'positive', type: 'Keyword Optimisation' },
    { verdict: 'inconclusive', type: 'Title Optimisation' },
  ];
  const s = abSummary(tests);
  ok('counts by verdict', s.total === 4 && s.positive === 2 && s.negative === 1 && s.inconclusive === 1, s);
  ok('win rate excludes inconclusive', s.winRate === 67, s.winRate);
  ok('types tallied', s.types['Keyword Optimisation'] === 3, s.types);
  ok('no decided tests = null win rate', abSummary([{ verdict: 'inconclusive' }]).winRate === null);
}

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
