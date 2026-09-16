#!/usr/bin/env node
/*
 * Scheduled Work harness (Ray, 15 Sep 2026): the content team's weekly schedule sheet read as
 * a skip cadence per dossier brand. Pure node over src/schedwork.js, plus a smoke pass over the
 * committed snapshot (ops/schedule/) so a re-ingest that drops a tab or shifts a column fails
 * the build instead of quietly emptying the module.
 *
 * What actually breaks this reader, pinned here:
 *   1. TWENTY header layouts across the hidden weekly tabs — columns resolve BY NAME, and the
 *      AM's call lives in `AM Status` (consolidated tab), `AM Confirmation` (weekly tabs) or,
 *      when both are blank, the ASPL `Final Status`.
 *   2. The hidden tabs carry the week ONLY in their name, as DDMM with no year — "Titles 2606"
 *      is the 26 Jun of the year that makes it the most recent such date on or before the
 *      consolidated tab's first week (26 Jun 2025 → itself, not 2024).
 *   3. Skips must be counted per MONTH, and a month with no row is neither a skip nor a break.
 * Run: node tools/test_schedule.mjs
 */
import { readFileSync } from 'node:fs';
import { dateCell, tabInfo, resolveHeader, decisionOf, rowDecision, kindOf, reasonClass, parseClient, resolveBrand,
  parseTab, parseWorkbook, buildCadence, brandSummary, compactRow, hoursOf,
  digestMonths, stripOf, skipDigest, DIGEST_MONTHS, DIGEST_TASKS } from '../cloudflare/feedspark-deck/src/schedwork.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

console.log('\n-- dates: ISO / UK / serial --');
ok('ISO', dateCell('2026-09-10') === '2026-09-10');
ok('ISO datetime', dateCell('2025-06-26T00:00:00') === '2025-06-26');
ok('DD/MM/YYYY', dateCell('26/06/2025') === '2025-06-26');
ok('D-M-YYYY', dateCell('6-10-2021') === '2021-10-06');
ok('Sheets serial (what the values API returns UNFORMATTED)', dateCell(45834) === '2025-06-26', dateCell(45834));
ok('serial as text', dateCell('45834') === '2025-06-26');
ok('prose is not a date', dateCell('Skip (got BF & XMAS)') === null);

console.log('\n-- hidden weekly tabs: DDMM + the anchor year --');
const A = '2025-06-26';
ok('"KWs 1906" → 19 Jun 2025', tabInfo('KWs 1906', A).week === '2025-06-19' && tabInfo('KWs 1906', A).kind === 'kw', tabInfo('KWs 1906', A));
ok('"Titles 2606" = the anchor week itself, not a year earlier', tabInfo('Titles 2606', A).week === '2025-06-26', tabInfo('Titles 2606', A));
ok('"PTs 1206" → 12 Jun 2025 (pt)', tabInfo('PTs 1206', A).week === '2025-06-12' && tabInfo('PTs 1206', A).kind === 'pt');
ok('"Titles 0201" rolls the year → 2 Jan 2025', tabInfo('Titles 0201', A).week === '2025-01-02');
ok('"Kws 1411" (lower-case, after the anchor month) → 14 Nov 2024', tabInfo('Kws 1411', A).week === '2024-11-14');
ok('"Titles1004" (no space) → 10 Apr 2025', tabInfo('Titles1004', A).week === '2025-04-10');
ok('"Keywords" / "Titles" = undated (kind only)', tabInfo('Keywords', A).week === null && tabInfo('Keywords', A).kind === 'kw' && tabInfo('Titles', A).week === null);
ok('the consolidated tab is not a weekly tab', tabInfo('Content-team-task-summary', A) === null);
ok('a nonsense day is undated, not a crash', tabInfo('KWs 3213', A).week === null);

console.log('\n-- the AM\'s word --');
ok('Skip / SKIP / "Skip (got BF & XMAS)" / "skip - migration"', ['Skip', 'SKIP', 'Skip (got BF & XMAS)', 'skip - migration', 'Skip please'].every((v) => decisionOf(v) === 'skip'));
ok('Cancelled / No / Not for this week / Ignore / "we can skip (BF batch separately)"', ['Cancelled', 'No', 'Not for this week', 'Ignore', 'we can skip (BF batch separately)', 'to cancel', 'Zoe suggests to cancel due to hours'].every((v) => decisionOf(v) === 'skip'));
ok('Go ahead / go head / Yes / ok / please go ahead / Approved / "go aheadgo ahead"', ['Go ahead', 'go head', 'Yes', 'ok', 'please go ahead', 'Approved', 'go aheadgo ahead', 'Go ahead - single test', 'yes please go ahead'].every((v) => decisionOf(v) === 'go'));
ok('a note is not a decision', decisionOf('(no confirmation but no hrs - xiaoli)') === '' && decisionOf('migration') === '' && decisionOf('') === '');
ok('precedence: AM Status wins', rowDecision({ am: 'Skip', conf: 'Yes', final: 'Approved' }).d === 'skip' && rowDecision({ am: 'Skip', conf: 'Yes', final: 'Approved' }).via === 'am');
ok('weekly tabs: AM Confirmation before Final Status', rowDecision({ am: '', conf: 'Yes', final: 'Cancelled' }).d === 'go' && rowDecision({ am: '', conf: 'Yes', final: 'Cancelled' }).via === 'conf');
ok('AM blank → the ASPL outcome stands in (Cancelled = did not go ahead)', rowDecision({ am: '', conf: '', final: 'Cancelled' }).d === 'skip' && rowDecision({ am: '', conf: '', final: 'Cancelled' }).via === 'final');
ok('nothing said = none', rowDecision({ am: '', conf: '', final: '' }).d === 'none');

console.log('\n-- task kinds + reasons --');
ok('Keyword optimisation → kw', kindOf('Keyword optimisation - Optimisation', '', '') === 'kw');
ok('Data field and title optimisation → titles', kindOf('Data field and title optimisation - Optimisation', '', '') === 'titles');
ok('Title optimisation → titles', kindOf('Title optimisation - Optimisation', 'Title Optimisation', '') === 'titles');
ok('Product Type Optimisation / Fixes → pt', kindOf('Product Type Fixes - Optimisation', '', '') === 'pt');
ok('Social Title Optimisation → social (not titles)', kindOf('Social Title Optimisation', '', '') === 'social');
ok('Short Titles Google Shopping → short', kindOf('Short Titles Google Shopping', '', '') === 'short');
ok('Data tagging → tagging', kindOf('Data tagging', '', '') === 'tagging');
ok('blank name falls back to the tab prefix', kindOf('', '', 'pt') === 'pt');
ok('reason classes', reasonClass('Negative hours', '') === 'negative hours' && reasonClass('Less Hours', '') === 'low hours' && reasonClass('low hrs', '') === 'low hours'
  && reasonClass('XMAS / Winter kws', '') === 'seasonal batch instead' && reasonClass('', 'Cross/Upsell in progress') === 'cross/upsell in progress' && reasonClass('client left', '') === 'account paused');
ok('hours: "4 hours" / "0.5 hour" / 4.5', hoursOf('4 hours') === 4 && hoursOf('0.5 hour') === 0.5 && hoursOf(4.5) === 4.5 && hoursOf('') === null);

console.log('\n-- the client cell → brand + market --');
ok('"Reiss - DE"', JSON.stringify(parseClient('Reiss - DE')) === JSON.stringify({ name: 'Reiss', mkt: 'de', group: '', merged: false }), parseClient('Reiss - DE'));
ok('"Accessorize - GB (Mon)" keeps the group', parseClient('Accessorize - GB (Mon)').group === 'Mon' && parseClient('Accessorize - GB (Mon)').mkt === 'gb');
ok('"Harvey Nichols - GB - EN" ignores the language', parseClient('Harvey Nichols - GB - EN').name === 'Harvey Nichols' && parseClient('Harvey Nichols - GB - EN').mkt === 'gb');
ok('"Bonmarche - UK" → gb', parseClient('Bonmarche - UK').mkt === 'gb');
ok('"[merged] Benefit Cosmetics - GB" flags merged', parseClient('[merged] Benefit Cosmetics - GB').merged === true && parseClient('[merged] Benefit Cosmetics - GB').name === 'Benefit Cosmetics');
ok('"Dr.Jart+ - UK (ELC)"', parseClient('Dr.Jart+ - UK (ELC)').name === 'Dr.Jart+' && parseClient('Dr.Jart+ - UK (ELC)').group === 'ELC');
const ROSTER = ['Reiss', 'AllSaints', 'Schuh', 'Superdry', 'Accessorize', 'Monsoon', 'Hobbycraft', 'YuMOVE', 'Estée Lauder', 'Bobbi Brown', 'Benefit', 'Jo Malone', 'Clinique', 'MAC', 'Craghoppers', 'Regatta', 'Dare2b', 'House of Bruar', 'American Golf', 'Ryobi'];
ok('YuMove → YuMOVE (case)', resolveBrand('YuMove', ROSTER) === 'YuMOVE');
ok('Estee Lauder → Estée Lauder (accent)', resolveBrand('Estee Lauder', ROSTER) === 'Estée Lauder');
ok('All Saints → AllSaints (space)', resolveBrand('All Saints', ROSTER) === 'AllSaints');
ok('bobbi brown → Bobbi Brown', resolveBrand('bobbi brown', ROSTER) === 'Bobbi Brown');
ok('Benefit Cosmetics / MAC Cosmetics / Ryobi Tools → first-word match', resolveBrand('Benefit Cosmetics', ROSTER) === 'Benefit' && resolveBrand('MAC Cosmetics', ROSTER) === 'MAC' && resolveBrand('Ryobi Tools', ROSTER) === 'Ryobi');
ok('Dare2B → Dare2b', resolveBrand('Dare2B', ROSTER) === 'Dare2b');
ok('a sheet-only client stays unmatched (never guessed onto a brand)', resolveBrand('Harvey Nichols', ROSTER) === null && resolveBrand('Office', ROSTER) === null);

console.log('\n-- a weekly tab and the consolidated tab parse the same way --');
const WEEKLY = { title: 'KWs 1906', hidden: true, values: [
  ['Client', 'Status', 'Priority', 'Task Name', 'Time schedule', 'Server', 'Time', 'Days left', 'Batch size', 'CDBs', 'Name of batch', 'Date of batch', 'ASPL Comments', 'AM Confirmation', 'AM Comment', 'Final Status'],
  ['Hobbycraft - GB', '', 'Low', 'Keyword optimisation - Optimisation', '4 hours', 'FH', 19, 7, 500, 0, '', '', '', '', '', 'Go ahead'],
  ['Reiss - DE', '', 'Low', 'Keyword optimisation - Optimisation', '4.5 hours', 'FH', -5, 4, 500, 0, '', '', 'Negative hours', 'skip', '', 'Cancelled'],
  ['Client', 'Status'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
] };
const wr = parseTab(WEEKLY, A, ROSTER);
ok('two rows (the repeated header + blank line dropped)', wr.length === 2, wr.length);
ok('week from the tab name, kind kw, brand matched', wr[0].w === '2025-06-19' && wr[0].k === 'kw' && wr[0].b === 'Hobbycraft' && wr[0].m === 'gb');
ok('Go ahead via Final Status when the AM columns are blank', wr[0].d === 'go' && wr[0].via === 'final');
ok('Reiss DE: skip via AM Confirmation, hours 4.5, time -5, negative-hours class', wr[1].d === 'skip' && wr[1].via === 'conf' && wr[1].h === 4.5 && wr[1].t === -5 && wr[1].rc === 'negative hours');
const CONS = { title: 'Content-team-task-summary', hidden: false, values: [
  ['', '', ''],
  ['Clients', 'Priority', 'Task Name', 'Time schedule', 'Server', 'Time', 'Days left', 'Batch size', 'https://docs…', 'Name of batch', 'Date of batch', 'Dates', 'Task Type', 'Primary AM', 'ASPL Comments', 'AM Status', 'Reason \n(complete if task is going ahead with negative hours)'],
  ['Reiss - EU', 'Low', 'Keyword optimisation - Optimisation', '4 hours', 'FH', -8, 12, 500, 0, '', '', 46205, 'Keywords', 'Ray', 'Negative hours', 'Skip', ''],
  ['Reiss - EU', 'Low', 'Keyword optimisation - Optimisation', '4 hours', 'FH', 2, 5, 500, 0, '', '', '2026-07-02', 'Keywords', 'Ray', '', 'Go Ahead', ''],
  ['Bape - GB', 'Low', 'Title optimisation - Optimisation', '4 hours', 'FH', -4, 28, 500, 0, '', '', '2026-07-02', 'Data Field and Title Optimisation', '', 'Negative hours', 'Go ahead', 'Cross/Upsell in progress'],
] };
const cr = parseTab(CONS, A, ROSTER);
ok('header found on row 2, three rows', cr.length === 3, cr.length);
ok('week from the Dates column (serial 46205 = 2026-07-02)', cr[0].w === '2026-07-02' && cr[1].w === '2026-07-02');
ok('AM Status = column P is the decision', cr[0].d === 'skip' && cr[0].via === 'am' && cr[1].d === 'go');
ok('a go-ahead on negative hours keeps its Reason', cr[2].d === 'go' && cr[2].r === 'Cross/Upsell in progress' && cr[2].rc === 'cross/upsell in progress' && cr[2].b === null);
ok('compactRow keeps the log fields', (() => { const c = compactRow(cr[0]); return c.w === '2026-07-02' && c.b === 'Reiss' && c.m === 'eu' && c.k === 'kw' && c.d === 'skip' && c.h === 4 && c.t === -8 && c.tab === 'Content-team-task-summary'; })());

console.log('\n-- workbook: the consolidated tab anchors the hidden tabs\' year --');
const WB = parseWorkbook([CONS, WEEKLY, { title: 'Titles 2606', hidden: true, values: [['Client', 'Task Name', 'Time', 'Days left', 'Batch size', 'AM Confirmation', 'Final Status ', 'AM Comment'], ['Reiss - GB', 'Title optimisation - Optimisation', 3.75, 2, 500, 'Yes', 'Approved', '']] }, { title: 'Keywords', hidden: true, values: [['Client', 'Time', 'Days left', 'AM Confirmation', 'Final Status', 'AM Comment'], ['Hobbycraft - GB', 9.25, 19, 'Skip', 'Cancelled', '']] }], ROSTER, '2026-09-15');
ok('anchor = earliest consolidated week', WB.anchor === '2026-07-02', WB.anchor);
ok('"KWs 1906" dated against that anchor → 19 Jun 2026', WB.rows.find((r) => r.tab === 'KWs 1906').w === '2026-06-19');
ok('"Titles 2606" → 26 Jun 2026 (before the anchor, same year)', WB.rows.find((r) => r.tab === 'Titles 2606').w === '2026-06-26');
ok('the undated "Keywords" tab parses (kind kw, week null) and is listed', WB.rows.find((r) => r.tab === 'Keywords').w === null && WB.tabs.find((t) => t.title === 'Keywords').week === null);
ok('rows come back oldest → newest', WB.rows.filter((r) => r.w).every((r, i, a) => !i || a[i - 1].w <= r.w));

console.log('\n-- cadence: months, streaks, hours --');
const mk = (w, d, h, k = 'kw', c = 'Reiss - EU') => Object.assign(parseTab({ title: 'Content-team-task-summary', values: [
  ['Clients', 'Task Name', 'Time schedule', 'Dates', 'AM Status'], [c, k === 'kw' ? 'Keyword optimisation' : 'Title optimisation', h + ' hours', w, d]] }, A, ROSTER)[0]);
// Reiss EU kw: Mar go, Apr skip, May skip skip, Jun — no row —, Jul skip, Aug (blank), Sep skip
const rows = [mk('2026-03-05', 'Go ahead', 4), mk('2026-04-02', 'Skip', 4), mk('2026-05-07', 'Skip', 4), mk('2026-05-14', 'Skip', 4),
  mk('2026-07-02', 'Skip', 4), mk('2026-08-06', '', 4), mk('2026-09-03', 'Skip', 4),
  // Reiss EU titles: a go in the latest month breaks nothing
  mk('2026-08-06', 'Skip', 2, 'titles'), mk('2026-09-03', 'Go ahead', 2, 'titles'),
  // a month that is skip THEN go counts as go
  mk('2026-09-03', 'Skip', 4, 'kw', 'Schuh - GB'), mk('2026-09-10', 'Go ahead', 4, 'kw', 'Schuh - GB'), mk('2026-08-06', 'Skip', 4, 'kw', 'Schuh - GB')];
const cad = buildCadence(rows);
const reu = cad.find((c) => c.client === 'Reiss' && c.mkt === 'eu' && c.kind === 'kw');
ok('Reiss EU kw: 4 consecutive skipped months (Apr, May, Jul, Sep — Jun absent, Aug undecided passed over)', reu.streak === 4 && reu.since === '2026-04', reu);
ok('…streak weeks 5 (two May rows), last go-ahead 5 Mar, 5 skips / 6 decided = 83%', reu.streakWeeks === 5 && reu.lastGo === '2026-03-05' && reu.skips === 5 && reu.skipRate === 83, reu);
ok('…hours of scheduled work skipped in the streak = 20', reu.hoursSkipped === 20, reu.hoursSkipped);
ok('…month series carries the verdicts', reu.months.map((m) => m.v).join(',') === 'go,skip,skip,skip,none,skip', reu.months.map((m) => m.v));
ok('…the latest row is exposed', reu.latest && reu.latest.w === '2026-09-03' && reu.latest.d === 'skip');
const ret = cad.find((c) => c.client === 'Reiss' && c.kind === 'titles');
ok('a go-ahead this month = no streak', ret.streak === 0 && ret.streakWeeks === 0 && ret.lastGo === '2026-09-03');
const sch = cad.find((c) => c.client === 'Schuh');
ok('skip then go inside one month = the month went ahead; streak 0, weeks 0', sch.streak === 0 && sch.months.find((m) => m.m === '2026-09').v === 'go' && sch.streakWeeks === 0);
ok('sorted worst streak first', cad[0] === reu);
const bs = brandSummary(cad);
ok('brand summary: Reiss worst = EU keywords 4 months, 1 of 2 tasks on a streak, 20 hrs', bs[0].client === 'Reiss' && bs[0].maxStreak === 4 && bs[0].onStreak === 1 && bs[0].tasks === 2 && bs[0].hoursSkipped === 20 && bs[0].worst.kind === 'kw' && bs[0].worst.mkt === 'eu', bs[0]);
ok('undated rows never enter the cadence', buildCadence([Object.assign(mk('2026-09-03', 'Skip', 4), { w: null })]).length === 0);

console.log('\n-- the committed snapshot still reads (ops/schedule/) --');
const snapPath = new URL('../ops/schedule/scheduled_work_2026-09-15.json', import.meta.url);
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const P = parseWorkbook(snap.tabs, ROSTER, '2026-09-15');
ok('77 tabs, 76 hidden', P.tabs.length === 77 && P.tabs.filter((t) => t.hidden).length === 76, [P.tabs.length, P.tabs.filter((t) => t.hidden).length]);
ok('anchor is the consolidated tab\'s first week, 26 Jun 2025', P.anchor === '2025-06-26', P.anchor);
ok('≥ 2,600 rows, ≥ 1,700 of them in the consolidated tab', P.rows.length >= 2600 && P.tabs.find((t) => t.title === 'Content-team-task-summary').rows >= 1700, P.rows.length);
ok('the weekly tabs span Nov 2024 → Jun 2025', P.tabs.filter((t) => t.hidden && t.week).every((t) => t.week >= '2024-11-01' && t.week <= '2025-06-30'));
ok('< 1% of rows carry no decision', P.rows.filter((r) => r.d === 'none').length < P.rows.length / 100);
ok('every row has a kind, none "other"', P.rows.every((r) => r.k && r.k !== 'other'));
const C = buildCadence(P.rows);
ok('dossier brands produce cadences (Reiss, Superdry, Schuh, Estée Lauder, YuMOVE …)', ['Reiss', 'Superdry', 'Schuh', 'Estée Lauder', 'YuMOVE', 'Accessorize', 'Monsoon', 'Hobbycraft'].every((b) => C.some((c) => c.client === b && c.inRoster)));
ok('the worst dossier streak is at least a year (Reiss EU keywords, since Aug 2025)', C.filter((c) => c.inRoster)[0].streak >= 12 && C.filter((c) => c.inRoster)[0].client === 'Reiss', C.filter((c) => c.inRoster)[0]);

// ---------------------------------------------------------------------------------------------
// THE DIGEST THE HOURS POPOVER READS
// Ray, 16 Sep 2026: "This pop-up over retainer should also include the skipped schedule work …
// i prefer the dotted green and orange bar for go and skip that you have, just try to fit 3 at
// least in that popup."
// ---------------------------------------------------------------------------------------------
console.log('\n\u00b7 skip digest (the strip the hours badge shows)');
{
  const NOW = Date.UTC(2026, 8, 16);
  const mo = digestMonths(NOW);
  ok('twelve calendar months, oldest first, ending with the current one',
    mo.length === 12 && mo[0] === '2025-10' && mo[11] === '2026-09', mo);
  ok('DIGEST_TASKS is three — "fit 3 at least in that popup"', DIGEST_TASKS >= 3 && DIGEST_MONTHS === 12);

  const entry = (client, mkt, kind, streak, hrs, months) =>
    ({ client, mkt, kind, streak, hoursSkipped: hrs, since: '2026-04', lastDecided: '2026-09', months });
  const M = (spec) => Object.keys(spec).map((k) => ({ m: k, v: spec[k] }));

  const kw = entry('Schuh', 'gb', 'Keywords', 5, 22.5, M({
    '2026-01': 'go', '2026-02': 'go', '2026-03': 'go',
    '2026-04': 'skip', '2026-05': 'skip', '2026-06': 'skip', '2026-07': 'skip', '2026-08': 'skip', '2026-09': 'none' }));
  ok('a month never scheduled is "-", NOT a skip — nothing was declined because nothing was offered',
    stripOf(kw, NOW) === '---gggsssssn', stripOf(kw, NOW));
  ok('the strip is exactly one character per month', stripOf(kw, NOW).length === 12);

  const gap = entry('Schuh', 'de', 'Titles', 0, 0, M({ '2026-06': 'go', '2026-07': 'go', '2026-09': 'go' }));
  ok('a GAP mid-history stays "-" rather than filling forward from the last decision',
    stripOf(gap, NOW) === '--------gg-g', stripOf(gap, NOW));

  const cad = [kw, gap,
    entry('Schuh', 'ie', 'Product Type', 2, 6, M({ '2026-08': 'skip', '2026-09': 'skip' })),
    entry('Schuh', 'fr', 'Data tagging', 1, 2, M({ '2026-09': 'skip' })),
    entry('Reiss', 'gb', 'Keywords', 0, 0, M({ '2026-08': 'go', '2026-09': 'go' }))];
  const d = skipDigest(cad, NOW);
  ok('one entry per client, not per task', Object.keys(d).sort().join() === 'Reiss,Schuh');
  const S2 = d.Schuh;
  ok('the aggregate counts tasks and streaks', S2.tasks === 4 && S2.onStreak === 3 && S2.maxStreak === 5);
  ok('hours skipped sum ONLY over tasks actually on a streak', S2.hoursSkipped === 30.5, S2.hoursSkipped);
  ok('at most DIGEST_TASKS rows ship, longest streak first',
    S2.rows.length === DIGEST_TASKS && S2.rows[0].kind === 'Keywords' && S2.rows[0].streak === 5
    && S2.rows[1].streak === 2 && S2.rows[2].streak === 1, S2.rows.map((r) => r.kind + ':' + r.streak));
  ok('and it says how many it left out rather than implying that is all of them', S2.more === 1);
  ok('every shipped row carries its own twelve-month strip', S2.rows.every((r) => r.s.length === 12));
  ok('the month keys travel with the digest so the badge can label the strip', S2.months.length === 12 && S2.months[11] === '2026-09');

  const R = d.Reiss;
  ok('a brand with NOTHING skipped still ships its rows — a green strip is the answer to "are they taking the work"',
    R.rows.length === 1 && R.onStreak === 0 && R.maxStreak === 0 && R.rows[0].s.slice(-2) === 'gg');
  ok('…and reports no skipped hours rather than omitting the figure', R.hoursSkipped === 0);
  ok('an empty cadence yields an empty digest, never a fabricated brand', Object.keys(skipDigest([], NOW)).length === 0);

  // the real workbook, end to end
  const live = skipDigest(C, Date.now());
  ok('the committed snapshot digests without throwing, one entry per client',
    Object.keys(live).length > 0 && Object.values(live).every((e) => e.rows.length <= DIGEST_TASKS
      && e.rows.every((r) => r.s.length === 12 && /^[gsn-]{12}$/.test(r.s))));
}

console.log('\n\u00b7 the badge renders it');
{
  const W = readFileSync(new URL('../docs/hours_widget.html', import.meta.url), 'utf8');
  ok('the strip uses the /schedule module\u2019s own go/skip colours, so the two surfaces agree',
    W.indexOf('#2E7D32') > 0 && W.indexOf('#ED6F0B') > 0);
  ok('"not scheduled" is an OUTLINE, never a coloured cell that could read as a decision',
    /'-': \{ c: '', t: 'not scheduled' \}/.test(W) && /i\.off\{background:transparent/.test(W));
  ok('every cell names its month and outcome on hover', /title="' \+ esc\(moLabel\(k\) \+ ' \u2014 ' \+ sp\.t\)/.test(W));
  ok('a legend names all three states — identity is never colour alone', /went ahead/.test(W) && /skipped/.test(W) && /not scheduled/.test(W));
  ok('a row is name + twelve cells + a SHORT tail, so it fits the card at 330px',
    /flex:0 0 84px/.test(W) && /flex:0 0 32px/.test(W) && /row\.streak \? '<b>' \+ row\.streak \+ 'mo<\/b>'/.test(W));
  ok('the hours a task skipped live in its tooltip, not in the row \u2014 the total is already in the summary line',
    /var rt = kind \+[\s\S]{0,400}h not taken/.test(W)
    && !/var tail = row\.streak[\s\S]{0,120}hrsSkip/.test(W));
  ok('the popover scrolls rather than running off a short viewport', /max-height:min\(660px,calc\(100vh - 24px\)\);overflow:auto/.test(W));
  ok('and links through to the full cadence for that brand', /\/schedule\?b=/.test(W));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
