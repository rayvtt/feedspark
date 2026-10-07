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
import { parseAbTests, extractMetrics, abVerdict, abSummary, resolveAbTab, findHeaderRow, hasAbHeader, abClientKey,
  abWinner, abGroups, isTitleTest, abDate, abSortKey, abSortTests }
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


console.log('\n-- WHO WON: an A/B title test names its winning group, not "lost" (Ray, 17 Sep 2026) --');
// the shape Ray described off the Superdry archive: the write-up names the control group by what
// it lacks and calls it the stronger performer, and the figures are (slightly) negative
const ITEM = 'A/B Title Test on the item type descriptor. The Batch Size was containing 400 products (50% Test Group | 50% Control Group). '
  + 'Results: The control group without item type descriptor is stronger performance than the test group. '
  + 'The test group experienced a -0.26% lowered in impressions and a -1.2% lowered in clicks compared to the control group.';
{
  const w = abWinner(ITEM, extractMetrics(ITEM));
  ok('the control group is read as the winner', w && w.group === 'control', w);
  ok('…named by what made it different', w && w.label === 'Without Item Type Descriptor', w && w.label);
  ok('…and the call came from the prose, not the sign of a number', w && w.how === 'prose', w && w.how);
  const g = abGroups(ITEM);
  ok('the other group is inferred from the one that was described', g.test === 'With Item Type Descriptor', g);
}
{
  // the same test written the other way round — parenthetical descriptors, the test group as subject
  const r = 'The test group (with item type descriptor) consistently trends below the control group (without item type descriptor).';
  const w = abWinner(r, {});
  ok('a losing cue on the test group hands the win to the control group', w && w.group === 'control' && w.label === 'Without Item Type Descriptor', w);
}
{
  const r = 'Compared to the control group, the test group (with item type descriptor) saw higher impressions and clicks.';
  const w = abWinner(r, {});
  ok('"compared to the control group, the test group…" — the yardstick is not the subject',
     w && w.group === 'test' && w.label === 'With Item Type Descriptor', w);
}
{
  const w = abWinner(JAN2, extractMetrics(JAN2));
  ok('Reiss’s real winning write-up: the test group, named by its optimisation',
     w && w.group === 'test' && /Keyword Optimization/i.test(w.label) && w.how === 'prose', w);
  const l = abWinner(JAN1, extractMetrics(JAN1));
  ok('Reiss’s real losing write-up: the control group wins', l && l.group === 'control' && l.how === 'prose', l);
}
ok('a single-group test has no opponent and no winner',
   abWinner('We conducted an Single group test. The test group experienced a 668% uplift in impressions.', { impressions: 668 }) === null);
ok('no data, no winner', abWinner(TITLE, {}) === null);
{
  const w = abWinner('Batch of 500 (50% Test Group | 50% Control Group). Impressions of 12.5% and clicks of 3%.', { impressions: 12.5, clicks: 3 });
  ok('prose that never calls it falls back to the figures — and SAYS so', w && w.group === 'test' && w.how === 'metrics', w);
  ok('…with the plain group name when nothing described it', w && w.label === 'Test group', w && w.label);
  ok('split figures and no call in the prose = no winner, not a guess',
     abWinner('Batch of 500 (50% Test Group | 50% Control Group).', { impressions: 12.5, clicks: -3 }) === null);
}
ok('a title test is recognised by its type', isTitleTest({ type: 'Title Optimisation' }));
ok('…or by its batch name', isTitleTest({ type: 'Keyword Optimisation', batch: 'A/B Title Test - Item Type Descriptor - UK' }));
ok('a keyword batch is not one', !isTitleTest({ type: 'Keyword Optimisation', batch: 'Jan II - Keyword Optimisation' }));
{
  const values = [
    HDR,
    ['UK', 'AB Test', 'Title Optimisation', 'A/B Title Test - Item Type Descriptor - UK - 18/03/2026', '18/03/2026', '15/04/2026', '', ITEM],
    ...Array.from({ length: 12 }, () => blank(8)),
    ['GB', 'Single Group', 'Title Optimisation', 'Data field and title optimisation', 'NA', 'NA', '', TITLE],
    ...Array.from({ length: 12 }, () => blank(8)),
  ];
  const r = parseAbTests(values);
  ok('the parsed row carries the winner', r.tests[0].winner && r.tests[0].winner.label === 'Without Item Type Descriptor', r.tests[0].winner);
  ok('…and is flagged as a title test', r.tests[0].title === true);
  ok('the verdict is still kept for the win-rate', r.tests[0].verdict === 'negative', r.tests[0].verdict);
  ok('a single-group row carries no winner even when it is a title test', r.tests[1].winner === null && r.tests[1].title === true, r.tests[1]);
}

console.log('\n-- the page says the same thing on both surfaces --');
{
  const CC = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');
  const abResult = new Function('ABV', 'esc', lift(CC, 'abResult') + '; return abResult;')(
    { positive: ['#15803d', '▲', 'won'], negative: ['#b91c1c', '▼', 'lost'], mixed: ['#b45309', '◆', 'mixed'],
      inconclusive: ['#64748b', '–', 'inconclusive'], unknown: ['#64748b', '?', 'no read'] }, (x) => String(x));
  const ctl = abResult({ title: true, verdict: 'negative', winner: { group: 'control', label: 'Without Item Type Descriptor', how: 'prose' } });
  ok('a control-group win reads as the conclusion, not as "lost"', ctl.text === 'Without Item Type Descriptor won', ctl.text);
  ok('…in navy — a finding, not a failure', ctl.color === '#2F6FB0', ctl.color);
  ok('…and the tooltip says which group and how it was read', /Control group won/.test(ctl.title) && /write-up/.test(ctl.title), ctl.title);
  const tst = abResult({ title: true, verdict: 'positive', winner: { group: 'test', label: 'With Item Type Descriptor', how: 'metrics' } });
  ok('a test-group win is green', tst.color === '#15803d' && tst.text === 'With Item Type Descriptor won', tst);
  ok('…and says it was read from the figures', /figures/.test(tst.title), tst.title);
  const kw = abResult({ title: false, verdict: 'negative', winner: { group: 'control', label: 'Control group', how: 'prose' } });
  ok('a keyword A/B keeps won / lost — only title tests change wording', kw.text === 'lost' && kw.color === '#b91c1c', kw);
  const none = abResult({ title: true, verdict: 'inconclusive', winner: null });
  ok('a title test with no winner falls back to the verdict', none.text === 'inconclusive', none.text);
  ok('the dossier pill and the one-pager column both go through it',
     /function abPill\(t\)\{\s*var r=abResult\(t\)/.test(CC) && /var mt = t\.metrics \|\| \{\}, rs = abResult\(t\)/.test(CC));
  const WK = fs.readFileSync(path.join(root, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');
  ok('the worker versions the archive cache so a stale shape does not outlive the deploy',
     /hit\.v === AB_SHAPE/.test(WK) && /v: AB_SHAPE/.test(WK) && /const AB_SHAPE = \d+/.test(WK));
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

// SUPERDRY heads the same table "Market" where Reiss heads it "Country" (Ray, 16 Sep 2026).
// Its tab resolved by name and then failed to PARSE — the same blank card by another route.
const SD_HDR = ['Market', 'Test Method', 'Test Type', 'Batch URL', 'Live Date', 'Report Date', 'Graph'];
ok('Superdry’s "Market" header is an archive too', hasAbHeader([SD_HDR]));
ok('…even with the merged "AB" banner row above it, as in the real sheet',
   hasAbHeader([['AB'], SD_HDR]));
ok('"Markets" and "Region" are accepted as the same column',
   hasAbHeader([['Markets', 'Test Method']]) && hasAbHeader([['Region', 'Test Method']]));
ok('the PAIR is still what identifies it — Market alone is not an archive',
   !hasAbHeader([['Market', 'Currency', 'Feeds']]));
{
  // and it must actually parse, not merely be detected
  const rows = [['AB'], SD_HDR,
    ['UK', 'Single Group', 'Title Optimisation', 'url', 'NA', 'NA', '', 'no performance data'],
    ['', '', '', '', '', '', '', ''],
    ['UK', 'Single Group', 'Keyword Optimisation', 'url', '14/01/2025', '10/2/2025', '',
      'Results: impressions of 21.37% and clicks of 11.85%'],
  ];
  const p = parseAbTests(rows);
  ok('Superdry’s rows parse', p.ok && p.tests.length === 2, p.tests && p.tests.length);
  ok('…the market travels with each test', p.ok && p.tests.every((t) => t.country === 'UK'));
  ok('…and the verdict still reads off the prose',
     p.ok && p.tests[1].verdict === 'positive', p.ok && p.tests[1].verdict);
}

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

// ---- NEWEST-FIRST DISPLAY ORDER (Ray, 23 Sep 2026, on Schuh's dossier card reading Jan-Jul 2025
// while the sheet already carried Aug 2026 batches): "Why Schuh dossier not be documented until
// September 2026? It should always show the latest six-month test first in the brand dossier."
// parseAbTests reads the sheet top to bottom — chronological ASCENDING, since the team appends
// each new batch below the last — and nothing reordered it before the dossier's capped card or
// the one-pager's slice(0,14) rendered it, so a year of history buried this month's tests below
// the fold on every long-running account. abSortTests is the one place that reorders for display.
console.log('\n-- newest-first display order --');
ok('abDate reads UK D/M/YYYY, with or without leading zeros',
   abDate('06/08/2026').getTime() === new Date(2026, 7, 6).getTime()
   && abDate('8/1/2025').getTime() === new Date(2025, 0, 8).getTime());
ok('a two-digit year is read as 20XX', abDate('06/08/26').getFullYear() === 2026);
ok('"NA" and blank are undated, not a bogus date', abDate('NA') === null && abDate('') === null && abDate(undefined) === null);
ok('an unparsable string is undated rather than guessed', abDate('August 2026') === null);

const T = (batch, live, reportDate) => ({ batch, live, reportDate });
{
  // the exact shape of the bug: a brand tested since Jan 2025, still running in Sep 2026
  const rows = [
    T('Jan I - Keyword Optimisation', '16/01/2025'),
    T('Jan II - Keyword Optimisation', '27/01/2025'),
    T('Aug I - Keyword Optimisation', '10/08/2026'),
    T('Back to School - Keyword Optimisation', '06/08/2026'),
  ];
  const s = abSortTests(rows);
  ok('the most recent test leads (Aug I, 10/08, ahead of Back to School, 06/08)',
     s[0].batch === 'Aug I - Keyword Optimisation', s.map((t) => t.batch));
  ok('…then the next most recent', s[1].batch === 'Back to School - Keyword Optimisation', s[1].batch);
  ok('the oldest test sinks to the bottom', s[s.length - 1].batch === 'Jan I - Keyword Optimisation', s[s.length - 1].batch);
  ok('nothing is dropped or duplicated', s.length === rows.length);
}
{
  // On ONE test, Live Date wins over Report Date — when the test ran matters more than when the
  // write-up was filed (often weeks later); Report Date only stands in when there is no Live Date
  const row = T('x', '01/06/2025', '01/06/2026');
  ok('the live date is the one the key is built from, not the (later) report date',
     abSortKey(row) === new Date(2025, 5, 1).getTime(), abSortKey(row));
  ok('…and a test with no live date falls back to its report date',
     abSortKey(T('y', 'NA', '01/06/2026')) === new Date(2026, 5, 1).getTime());
}
{
  // undated rows (many single-group runs record "NA" on both columns) sink below every dated
  // test rather than sorting arbitrarily by array position among the dated ones — and among
  // THEMSELVES they keep the sheet's own order, never reshuffled for no reason
  const rows = [T('dated', '01/01/2026'), T('undated A'), T('undated B'), T('also dated', '01/06/2026')];
  const s = abSortTests(rows);
  ok('every undated row sinks below every dated one',
     s[0].batch === 'also dated' && s[1].batch === 'dated' && s[2].batch === 'undated A' && s[3].batch === 'undated B',
     s.map((t) => t.batch));
}
ok('abSortTests on an empty or missing list never throws', JSON.stringify(abSortTests([])) === '[]' && JSON.stringify(abSortTests(null)) === '[]');
ok('abSortKey is the numeric form abSortTests sorts on (a live date, in ms)',
   abSortKey(T('x', '01/01/2026')) === new Date(2026, 0, 1).getTime() && abSortKey(T('x')) === null);

// ---- the worker serves and caches the SORTED order, so no consumer has to re-sort ----------
{
  const wsrc2 = fs.readFileSync(path.join(root, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');
  ok('the worker imports abSortTests', /import \{[^}]*abSortTests[^}]*\} from "\.\/abtests\.js"/.test(wsrc2));
  ok('the served/cached payload is built from the sorted array, not the raw parse',
     /const sorted = abSortTests\(p\.tests\)/.test(wsrc2) && /tests: sorted, summary: abSummary\(sorted\)/.test(wsrc2));
  ok('AB_SHAPE was bumped so a payload cached before this fix cannot serve the old sheet order for its remaining TTL',
     /const AB_SHAPE = 4/.test(wsrc2));
  // Sorting cannot recover a test that was never READ — a fixed A1:Z400 window covers roughly
  // an archive's first 30 tests (~13 rows each) and nothing below that line, so a brand tested
  // since early 2025 (Schuh: rows running past 850) had its Aug 2026 batches truncated OUT of
  // the fetch entirely; abSortTests had nothing to sort them into (Ray, 24 Sep 2026, after the
  // sort shipped: "still not seeing 2026 tests for Schuh dossier").
  ok('the archive fetch is no longer capped at 400 rows', !/encodeURIComponent\(tab \+ '!A1:Z400'\)/.test(wsrc2));
  ok('…it reads the whole tab, matching every other whole-tab read in this file',
     /encodeURIComponent\(tab \+ '!A1:ZZ5000'\)/.test(wsrc2));
}

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
