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
import { parseAbTests, extractMetrics, abVerdict, abSummary, resolveAbTab, findHeaderRow, hasAbHeader, abClientKey }
  from '../cloudflare/feedspark-deck/src/abtests.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// pull `function name(...){…}` out of a source file by brace matching, so the worker's own code
// is what runs here rather than a copy of it that can drift
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found in source: ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced braces reading ' + name);
}

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

// THE REISS BUG (Ray, 16 Sep 2026: "Reiss - AB Test Archive is still not populating"). The brand
// branch used to run BEFORE the exact-name rule, so a workbook holding the archive alongside any
// second archive-ish tab refused: near.length was 2, neither name contained "reiss", and the
// answer was null. Passing the client made the result WORSE than omitting it.
const REISS = ['Project Plan', 'Service Overview', 'AB Test Archive', 'Old AB Test Archive', 'Metric'];
ok('the exact tab wins even with a stale sibling AND a client name',
   resolveAbTab(REISS, 'Reiss') === 'AB Test Archive', resolveAbTab(REISS, 'Reiss'));
ok('naming the client is never worse than omitting it',
   resolveAbTab(REISS, 'Reiss') === resolveAbTab(REISS),
   [resolveAbTab(REISS, 'Reiss'), resolveAbTab(REISS)]);
ok('the plural exact name wins the same way',
   resolveAbTab(['AB Test Archives', 'Old AB Test Archive'], 'Reiss') === 'AB Test Archives');
ok('"A/B Test Archive" is the same exact name',
   resolveAbTab(['A/B Test Archive', 'AB Test Archive 2024'], 'Reiss') === 'A/B Test Archive');
// and the guard it must NOT weaken: two exact copies are still ambiguous
ok('two tabs with the exact same name stay ambiguous',
   resolveAbTab(['AB Test Archive', 'ab test archive'], 'Reiss') === null,
   resolveAbTab(['AB Test Archive', 'ab test archive'], 'Reiss'));
// Reiss's tab is PLURAL and carries no brand suffix (Ray, 16 Sep 2026: "tab is: AB Test
// Archives"). It always resolved — pinned here so the answer to "is the name the problem?"
// is a test rather than a re-reading of the regex.
ok('Reiss’s real tab name resolves',
   resolveAbTab(['Project Plan', 'AB Test Archives', 'Scrape'], 'Reiss') === 'AB Test Archives',
   resolveAbTab(['Project Plan', 'AB Test Archives', 'Scrape'], 'Reiss'));
ok('… and without a client too',
   resolveAbTab(['Project Plan', 'AB Test Archives']) === 'AB Test Archives');


console.log('\n-- SHARED WORKBOOKS: Monsoon + Accessorize live in one sheet --');
// Ray's real tab names. Without brand-matching this workbook is either "ambiguous" (nothing
// shows) or first-wins (Accessorize's dossier shows Monsoon's tests).
const SHARED = ['Project Plan', 'AB Test Archives Monsoon', 'AB Test Archives Accessorize'];
ok('Monsoon picks its own tab', resolveAbTab(SHARED, 'Monsoon') === 'AB Test Archives Monsoon',
   resolveAbTab(SHARED, 'Monsoon'));
ok('Accessorize picks its own tab', resolveAbTab(SHARED, 'Accessorize') === 'AB Test Archives Accessorize',
   resolveAbTab(SHARED, 'Accessorize'));
ok('a brand with no tab in the workbook gets nothing, not a sibling\u2019s',
   resolveAbTab(SHARED, 'Hobbycraft') === null, resolveAbTab(SHARED, 'Hobbycraft'));
ok('accents/spacing fold in the brand match',
   resolveAbTab(['AB Test Archive Estee Lauder', 'AB Test Archive MAC'], 'Estée Lauder')
     === 'AB Test Archive Estee Lauder');
ok('single archive still resolves without a client', resolveAbTab(['AB Test Archive']) === 'AB Test Archive');
ok('client key folds case, accents and punctuation',
   abClientKey('Estée Lauder') === 'esteelauder' && abClientKey('House of Bruar') === 'houseofbruar');

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


console.log('\n-- adjacent figures must never fuse (Monsoon/Accessorize "Eid" test) --');
{
  // Reconnaissance over this sheet once reported +10285.47% impressions by JOINING the merged
  // Report cells and welding 102… to …85.47. The real figures are 85.18 / 104.42. The parser
  // takes ONE cell, never a concatenation — this pins that.
  const EID = 'Results: The A/B test for keyword optimization resulted in a positive impact on both '
    + 'impressions and clicks. The test group experienced a 85.18% uplift in impressions and a '
    + '104.42% uplift in clicks. Conclusion: the strategy was effective.';
  const m = extractMetrics(EID);
  ok('impressions read as 85.18, not fused', m.impressions === 85.18, m);
  ok('clicks read as 104.42', m.clicks === 104.42, m);
  ok('no impossible figure survives', Math.abs(m.impressions) < 1000 && Math.abs(m.clicks) < 1000, m);

  // the merged Report block repeats the same prose across seven columns: the parser must pick
  // one of them, not stitch them together
  const row = ['UK', 'Single Group', 'Keyword Optimisation', 'Eid', '28/01/2025', '', ...new Array(7).fill(EID)];
  const r = parseAbTests([HDR, row]);
  ok('a repeated merged block yields one clean read',
     r.tests[0].metrics.impressions === 85.18 && r.tests[0].metrics.clicks === 104.42, r.tests[0].metrics);
}

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


console.log('\n-- content probe: the archive found by its header, whatever the tab is called --');
// Schuh and Hobbycraft both carry this archive with the identical layout; if the feature hangs
// on someone having typed the right tab name, it silently shows nothing for those brands.
ok('a real archive header is detected',
   hasAbHeader([['Country', 'Test Method', 'Test Type', 'Batch URL', 'Live Date', 'Report Date']]));
ok('detected even when the table starts lower down',
   hasAbHeader([[''], ['Some notes'], ['Country', 'Test Method', 'Test Type']]));
ok('a Project Plan tab is NOT an archive',
   !hasAbHeader([['Area', 'Task', 'Owner', 'Hours', 'Priority', 'Status', 'Due']]));
ok('an empty tab is not an archive', !hasAbHeader([]));
ok('a lookalike without Test Method is not an archive',
   !hasAbHeader([['Country', 'Market', 'Currency', 'Feeds']]));

// ---- the page's own diagnostics -----------------------------------------------------------
// The tab list is the EVIDENCE for "no archive tab". It printed 12 names with no sign it had
// truncated, which read as the whole workbook and hid the tab we were looking for.
console.log('\n-- the failure message tells the truth about its own evidence --');
{
  const page = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');
  ok('the page has one shared tab-list renderer', /function abTabList\(/.test(page));
  const fn = new Function('esc', lift(page, 'abTabList') + ' return abTabList;')((s) => String(s));
  const many = { tabs: Array.from({ length: 24 }, (_, i) => 'Tab' + i), tabCount: 31 };
  ok('a truncated list SAYS it is truncated', /showing 24 of 31 tabs/.test(fn(many)), fn(many).slice(0, 60));
  const few = { tabs: ['Project Plan', 'AB Test Archive'], tabCount: 2 };
  ok('a complete list does not claim to be truncated', !/showing/.test(fn(few)) && /tabs found/.test(fn(few)));
  ok('no tabs at all adds nothing', fn({ tabs: [] }) === '' && fn(null) === '');
  ok('the count falls back to the list length when the worker sent none',
     /tabs found/.test(fn({ tabs: ['A', 'B'] })));
  ok('the worker sends the true tab count', /tabCount: titles\.length/.test(
     fs.readFileSync(path.join(root, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8')));
  // \\U is not a JavaScript escape — the backslash is dropped and the page prints "U0001F9EA"
  ok('no invalid \\U escapes survive in the page', !/\\U[0-9A-Fa-f]{4}/.test(page));
  ok('the A/B card renders a real test-tube emoji', page.indexOf('\u{1F9EA} A/B test archive') > 0);
}

// ---- what the read FAILED with, lifted out of the worker by name ---------------------------
// The bug this pins: a workbook the service account cannot open returns an error and no `sheets`,
// which read as "zero tabs" and were reported as `no_archive_tab` — the page then told Ray his
// plan had no archive tab while he was looking straight at one. A sheet we cannot read says
// NOTHING about what is in it.
console.log('\n-- Sheets failures are classified, never inferred --');
const wsrc = fs.readFileSync(path.join(root, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');
const abReadError = new Function(`${lift(wsrc, 'abReadError')} return abReadError;`)();
const ENV = { GOOGLE_SA_JSON: JSON.stringify({ client_email: 'fcc-reader@feedspark.iam.gserviceaccount.com' }) };

const denied = abReadError({ code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission' }, ENV);
ok('403 = not shared, not a missing tab', denied.error === 'not_shared', denied.error);
ok('… and it names the address to share with',
   denied.sa === 'fcc-reader@feedspark.iam.gserviceaccount.com', denied.sa);
ok('… keeping Google’s own wording as the detail', /does not have permission/.test(denied.detail));
ok('PERMISSION_DENIED without a numeric code still classifies',
   abReadError({ status: 'PERMISSION_DENIED', message: 'x' }, ENV).error === 'not_shared');
ok('a wrong sheet id is ours to fix, and says so',
   abReadError({ code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' }, ENV).error === 'bad_sheet_id');
ok('anything else passes through verbatim rather than inventing a cause',
   abReadError({ code: 500, status: 'INTERNAL', message: 'Internal error' }, ENV).error === 'Internal error');
ok('every classification is a failure, never a silent ok',
   [403, 404, 500].every((c) => abReadError({ code: c, message: 'm' }, ENV).ok === false));
// the SA address is read from the secret, so a worker without one must not crash the handler
ok('no service account configured = no address, no throw',
   abReadError({ code: 403, status: 'PERMISSION_DENIED', message: 'm' }, {}).sa === '');
ok('malformed GOOGLE_SA_JSON degrades instead of throwing',
   abReadError({ code: 403, status: 'PERMISSION_DENIED', message: 'm' }, { GOOGLE_SA_JSON: '{oops' }).sa === '');

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
