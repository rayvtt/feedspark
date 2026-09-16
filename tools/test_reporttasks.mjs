#!/usr/bin/env node
/*
 * FS TASK MANAGER harness.
 *
 * Three things are pinned here, and the third is the reason this file exists at all:
 *
 *  1. THE QUERY GRAMMAR. The search bar is the module — if `client:Rei` stops finding Reiss, or
 *     `bill:no` starts meaning "not billable at all" instead of "carries unbilled time", an AM
 *     gets a confidently wrong answer with no sign anything went wrong.
 *  2. THE AGGREGATION AND THE BOOK STORE. Billable and non-billable must add up to the total on
 *     every path, the "Other (N more)" fold must carry the tail it folded rather than dropping
 *     it, and a market's pull must survive the round trip through KV — including the two traps
 *     in the source (an ignored `from_date` and a newest-first row cap).
 *  3. PAGE / ENGINE PARITY. docs/FeedSpark_TaskManager.html carries its own copy of the grammar
 *     (a page cannot import an .mjs). The copy is lifted out of the page BY NAME and run
 *     against the SAME assertion table as tools/reporttasks.mjs, so the bar Ray types into and
 *     the module this harness proves can never quietly disagree.
 *
 * Plus the worker's own tmBookPull, LIFTED OUT OF worker.js BY NAME and run against an
 * in-process stub MCP server with a fake KV — the same technique tools/test_tmmcp.mjs uses for
 * the hours lane, so the rotation, the window and the partial-pull refusal are proved against a
 * real transport rather than asserted about.
 *
 * Pure node, no browser; the only network is a stub server on localhost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import * as M from '../cloudflare/feedspark-deck/src/taskbook.js';
import * as TMM from '../cloudflare/feedspark-deck/src/tmmcp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PAGE = path.join(ROOT, 'docs', 'FeedSpark_TaskManager.html');
const WORKER = path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'worker.js');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n      got ${JSON.stringify(a)}\n      want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------------------------------------
// lift the page's copy of the grammar
// ---------------------------------------------------------------------------------------------
function liftPage() {
  const src = fs.readFileSync(PAGE, 'utf8');
  const A = '/* ENGINE:START */', B = '/* ENGINE:END */';
  const a = src.indexOf(A), b = src.indexOf(B);
  if (a < 0 || b < 0) throw new Error('page is missing its ENGINE:START / ENGINE:END markers');
  const body = src.slice(a + A.length, b);
  const names = ['parseQuery', 'matchTask', 'matchTicket', 'bucketOf', 'summarise', 'groupBy',
    'ticketStats', 'billVerdict', 'balanceState', 'taskBlob', 'ticketBlob',
    'CATS', 'CAT_LABEL', 'DIMS', 'BUCKET_LABEL', 'STATUS_BUCKET'];
  // eslint-disable-next-line no-new-func
  const f = new Function(body + '\nreturn {' + names.join(',') + '};');
  return f();
}
const P = liftPage();

// ---------------------------------------------------------------------------------------------
// the assertion table — run against BOTH implementations
// ---------------------------------------------------------------------------------------------
const T = (o) => Object.assign({
  d: '2026-05-04', client: 'Reiss', market: 'GB', owner: 'Febin', title: 'Keyword optimisation',
  cat: 'opt', am: 'Ray', status: 'done', bucket: 'done', bill: 2, nonbill: 0, hours: 2,
  sched: 2, id: 1, ticket: 0, note: '',
}, o);
const K = (o) => Object.assign({
  id: 900, client: 'Reiss', subject: 'Israel Feed Set Up', status: 'open', d: '2026-09-16',
  first: '2026-09-14', by: 'internal', origin: 'client', from: 'eliza.bendall@reiss.com',
  age: 1, level: 'ok', idle: 0, msgs: 7, tasks: 0, hours: 0, am: 'Ray',
}, o);

function grammar(E, tag) {
  const q = (s) => E.parseQuery(s);
  const m = (row, s) => E.matchTask(Object.assign({}, row), q(s));
  const mk = (row, s) => E.matchTicket(Object.assign({}, row), q(s));

  // --- bare words search the whole record, and AND together -----------------------------------
  ok(m(T(), 'keyword'), tag + ': a bare word matches the title');
  ok(m(T(), 'KEYWORD OPTIMISATION'), tag + ': search is case-folded');
  ok(m(T(), 'keyword reiss'), tag + ': two bare words AND together across fields');
  ok(!m(T(), 'keyword hobbycraft'), tag + ': a word matching nothing on the row fails the whole query');
  ok(m(T({ note: 'FW: Gifting Line List - CL3' }), 'gifting'), tag + ': notes are searchable');
  ok(!m(T(), 'gifting'), tag + ': an empty note matches nothing');

  // --- quoted phrases -------------------------------------------------------------------------
  ok(m(T(), '"keyword optimisation"'), tag + ': a quoted phrase matches as one substring');
  ok(!m(T({ title: 'Optimisation keyword review' }), '"keyword optimisation"'),
    tag + ': a quoted phrase is NOT two loose words');
  ok(m(T({ owner: 'Steven Opuni' }), 'owner:"Steven Opuni"'), tag + ': a field value may be quoted');

  // --- negation -------------------------------------------------------------------------------
  ok(m(T(), '-hobbycraft'), tag + ': a negated word absent from the row passes');
  ok(!m(T(), '-reiss'), tag + ': a negated word present on the row fails');
  ok(!m(T(), '-client:Reiss'), tag + ': a negated field excludes its own client');
  ok(m(T(), 'keyword -call'), tag + ': positive and negative terms combine');

  // --- field matching is equals-or-prefix, never a bare substring ------------------------------
  ok(m(T(), 'client:Reiss'), tag + ': client: matches exactly');
  ok(m(T(), 'client:rei'), tag + ': client: matches a prefix of 2+ characters');
  ok(!m(T(), 'client:eiss'), tag + ': client: does NOT match a mid-word substring');
  ok(!m(T({ market: 'DE' }), 'market:E'), tag + ': a single character never matches a field by prefix');
  ok(m(T({ market: 'DE' }), 'market:DE'), tag + ': a two-letter market matches exactly');
  ok(!m(T(), 'client:Superdry'), tag + ': the wrong client fails');

  // --- repeats of a field OR, different fields AND ---------------------------------------------
  ok(m(T(), 'client:Reiss client:Schuh'), tag + ': two values of one field OR together');
  ok(m(T({ client: 'Schuh' }), 'client:Reiss client:Schuh'), tag + ': ...either side matches');
  ok(!m(T(), 'client:Reiss owner:Gary'), tag + ': two different fields AND together');
  ok(m(T(), 'client:Reiss owner:Febin'), tag + ': ...and both may be satisfied');

  // --- aliases ---------------------------------------------------------------------------------
  ok(m(T(), 'brand:Reiss'), tag + ': brand: is an alias for client:');
  ok(m(T(), 'who:Febin'), tag + ': who: is an alias for owner:');
  ok(m(T(), 'mkt:GB'), tag + ': mkt: is an alias for market:');
  ok(m(T(), 'cat:optimisation'), tag + ': the category answers to its own word');
  ok(m(T({ cat: 'tech' }), 'cat:fixes'), tag + ': "fixes" resolves to the technical category');

  // --- BILLABLE: the whole point of the module --------------------------------------------------
  ok(m(T({ bill: 2, nonbill: 0 }), 'bill:yes'), tag + ': bill:yes finds charged time');
  ok(!m(T({ bill: 0, nonbill: 2 }), 'bill:yes'), tag + ': bill:yes skips a row with no charged time');
  ok(m(T({ bill: 0, nonbill: 2 }), 'bill:no'), tag + ': bill:no finds unbilled time');
  ok(!m(T({ bill: 2, nonbill: 0 }), 'bill:no'), tag + ': bill:no skips a fully-billed row');
  // A row can be part billed and part not. It answers to BOTH, because both are true of it —
  // treating bill:no as "nothing was billed" would hide every mixed row, which is most of them.
  ok(m(T({ bill: 1, nonbill: 1 }), 'bill:yes'), tag + ': a part-billed row answers to bill:yes');
  ok(m(T({ bill: 1, nonbill: 1 }), 'bill:no'), tag + ': ...and to bill:no as well');
  ok(m(T({ bill: 0, nonbill: 3 }), 'billable:non'), tag + ': billable:non is bill:no');
  ok(m(T({ bill: 0, nonbill: 3 }), 'bill:0'), tag + ': bill:0 is bill:no');

  // --- dates and bounds --------------------------------------------------------------------------
  ok(m(T({ d: '2026-05-04' }), 'from:2026-01-01'), tag + ': from: keeps a later row');
  ok(!m(T({ d: '2025-11-02' }), 'from:2026-01-01'), tag + ': from: drops an earlier row');
  ok(m(T({ d: '2026-05-04' }), 'to:2026-06'), tag + ': to: accepts a bare month and covers the whole of it');
  ok(!m(T({ d: '2026-07-04' }), 'to:2026-06'), tag + ': ...and excludes the month after');
  ok(m(T({ d: '2026-05-04' }), 'month:2026-05'), tag + ': month: pins one month');
  ok(!m(T({ d: '' }), 'from:2025-10-01'), tag + ': an undated row is never swept into a date range');
  ok(m(T({ hours: 4 }), 'min:4'), tag + ': min: is inclusive');
  ok(!m(T({ hours: 3.5 }), 'min:4'), tag + ': min: excludes below the bound');
  ok(m(T({ hours: 3.5 }), 'max:4'), tag + ': max: is inclusive on the other side');
  ok(m(T({ hours: 4 }), 'min:2 max:6'), tag + ': min and max bound together');

  // --- status: the word or the bucket -------------------------------------------------------------
  ok(m(T({ status: 'created', bucket: 'open' }), 'status:open'), tag + ': status: matches the bucket');
  ok(m(T({ status: 'created', bucket: 'open' }), 'status:created'), tag + ": status: matches the database's own word");
  ok(!m(T({ status: 'done', bucket: 'done' }), 'status:open'), tag + ': a done row is not open');

  // --- tickets -------------------------------------------------------------------------------------
  ok(mk(K(), 'israel'), tag + ': a ticket matches on its subject');
  ok(mk(K(), 'client:Reiss'), tag + ': a ticket matches on its client');
  ok(mk(K(), 'reiss.com'), tag + ': a ticket matches on who raised it');
  ok(mk(K({ status: 'ignored' }), 'status:ignored'), tag + ': ticket status filters');
  // owner/market/cat/bill are task dimensions. A ticket query carrying one returns NOTHING
  // rather than quietly ignoring the filter and showing every ticket as if it had matched.
  ok(!mk(K(), 'owner:Febin'), tag + ': a task-only filter yields no tickets rather than ignoring itself');
  ok(!mk(K(), 'bill:no'), tag + ': ...the same for bill:');

  // --- status buckets --------------------------------------------------------------------------
  eq(E.bucketOf('done'), 'done', tag + ': done buckets done');
  eq(E.bucketOf('created'), 'open', tag + ': created buckets open');
  eq(E.bucketOf('On Hold'), 'hold', tag + ': spacing and case fold before bucketing');
  eq(E.bucketOf('cancelled'), 'cancelled', tag + ': cancelled buckets cancelled');
  eq(E.bucketOf('whatever-this-is'), 'open', tag + ': an unrecognised state is OUTSTANDING, not done');
  eq(E.bucketOf(''), 'open', tag + ': a blank state is outstanding too');

  // --- summarise ---------------------------------------------------------------------------------
  const rows = [
    T({ bill: 2, nonbill: 0, hours: 2, d: '2026-05-04' }),
    T({ bill: 0, nonbill: 3, hours: 3, d: '2026-04-01', owner: 'Gary', cat: 'tech' }),
    T({ bill: 1.5, nonbill: 1.5, hours: 3, d: '', client: 'Schuh', bucket: 'open' }),
  ];
  const s = E.summarise(rows);
  eq(s.n, 3, tag + ': summarise counts the rows');
  eq(s.hours, 8, tag + ': summarise totals the hours');
  eq(s.bill, 3.5, tag + ': summarise totals billable');
  eq(s.nonbill, 4.5, tag + ': summarise totals non-billable');
  ok(Math.abs(s.bill + s.nonbill - s.hours) < 1e-9, tag + ': billable + non-billable = total, always');
  eq(s.billPct, 43.8, tag + ': billable share is one decimal place');
  eq(s.owners, 2, tag + ': distinct owners counted');
  eq(s.clients, 2, tag + ': distinct clients counted');
  eq(s.undated, 1, tag + ': an undated row is counted as undated');
  eq(s.months, 2, tag + ': ...and belongs to no month');
  eq(s.first, '2026-04-01', tag + ': first dated day');
  eq(s.last, '2026-05-04', tag + ': last dated day');
  eq(E.summarise([]).billPct, 0, tag + ': an empty set has no billable share rather than NaN');

  // --- groupBy -------------------------------------------------------------------------------------
  const g = E.groupBy(rows, 'owner', 0);
  eq(g.length, 2, tag + ': groupBy splits by owner');
  eq(g[0].k, 'Febin', tag + ': biggest group first');
  eq(g[0].hours, 5, tag + ': group hours add up');
  const gm = E.groupBy(rows, 'month', 0);
  eq(gm.map((x) => x.k), ['(undated)', '2026-04', '2026-05'], tag + ': months read in time order, undated named');
  // THE FOLD TRAP: a capped chart that drops its tail overstates every bar left standing.
  const many = [];
  for (let i = 0; i < 10; i++) many.push(T({ client: 'C' + i, owner: 'O' + i, bill: 10 - i, nonbill: i, hours: 10 }));
  const gc = E.groupBy(many, 'client', 4);
  eq(gc.length, 4, tag + ': the cap holds');
  eq(gc[3].k, 'Other (7 more)', tag + ': the tail is named and counted, not hidden');
  eq(gc.reduce((a, x) => a + x.hours, 0), 100, tag + ': the folded chart still totals the whole set');
  eq(gc.reduce((a, x) => a + x.n, 0), 10, tag + ': ...and still counts every task');
  eq(E.groupBy(many, 'total', 0).length, 1, tag + ': the total dimension is one bucket');

  // --- verdicts ------------------------------------------------------------------------------------
  ok(/charged for/.test(E.billVerdict(92)), tag + ': a high billable share reads as charged');
  ok(/without being charged/.test(E.billVerdict(20)), tag + ': a low billable share says so plainly');
  eq(E.balanceState(35, -36.75), 'over', tag + ': a negative balance is over');
  eq(E.balanceState(35, 10), 'ok', tag + ': a balance inside the allowance is ok');
  eq(E.balanceState(4, 16.75), 'banked', tag + ': a balance far above the allowance is banked');
  eq(E.balanceState(0, 0), 'ok', tag + ': a zero-allowance market with a zero balance is not "over"');

  // --- ticketStats ---------------------------------------------------------------------------------
  const ts = E.ticketStats([
    K({ status: 'open', idle: 40, hours: 2, tasks: 1, msgs: 5 }),
    K({ status: 'reopened', idle: 0, hours: 0, tasks: 0, msgs: 4 }),
    K({ status: 'closed', idle: 200, hours: 1, tasks: 2, msgs: 9 }),
    K({ status: 'ignored', idle: 300, hours: 0, tasks: 0, msgs: 3 }),
  ]);
  eq(ts.live, 2, tag + ': open and reopened are the live states');
  eq(ts.closed, 1, tag + ': closed counted apart');
  eq(ts.ignored, 1, tag + ': "ignored" is its own state, not folded into open or closed');
  eq(ts.stale, 1, tag + ': only a LIVE thread idle 30 days is stale — a closed one is finished');
  eq(ts.hours, 3, tag + ': hours booked through tickets add up');
}

console.log('── query grammar + aggregation (tools/reporttasks.mjs)');
grammar(M, 'engine');
console.log('── the same table against the page\'s own copy (docs/FeedSpark_TaskManager.html)');
grammar(P, 'page');

// ---------------------------------------------------------------------------------------------
// page ↔ engine parity, term by term
// ---------------------------------------------------------------------------------------------
console.log('── page / engine parity on every query shape');
const QUERIES = ['', 'keyword', 'client:Reiss', 'client:rei owner:Feb', 'bill:no', 'bill:yes',
  'cat:opt -client:Schuh', '"keyword optimisation"', 'from:2026-01 to:2026-06', 'min:2 max:8',
  'status:open', 'month:2026-05', 'am:Ray market:GB', '-call optimisation', 'who:Gary cat:tech',
  // the comma rule rides the parity sweep too — two surfaces, one meaning
  'Gary,Steven', 'Gary, Steven', 'Gary ,Steven', 'Gary,', ',', 'keyword,feeds', '-Gary,Steven',
  'owner:Gary,Steven', 'owner:Gary, Steven', 'market:GB,DE', 'cat:tech,feat', 'month:2026-05,2025-11',
  'client:Reiss keyword,feeds', '"keyword optimisation",Feeds', 'min:2,5'];
const SAMPLE = [
  T(), T({ client: 'Schuh', owner: 'Gary', cat: 'tech', bill: 0, nonbill: 1, hours: 1 }),
  T({ d: '', title: 'Client call', cat: 'acct', bill: 1, nonbill: 1, hours: 2 }),
  T({ d: '2025-11-02', market: 'DE', am: 'Steven', status: 'created', bucket: 'open', hours: 8, bill: 8 }),
  T({ title: 'New Feeds', cat: 'feat', owner: 'Steven Opuni', bill: 4, nonbill: 0.5, hours: 4.5 }),
];
for (const qs of QUERIES) {
  const a = SAMPLE.map((r) => M.matchTask(Object.assign({}, r), M.parseQuery(qs)));
  const b = SAMPLE.map((r) => P.matchTask(Object.assign({}, r), P.parseQuery(qs)));
  eq(b, a, `page and engine agree on "${qs}"`);
}
// ---------------------------------------------------------------------------------------------
// a comma is OR, whitespace is AND
//
// Ray, 16 Sep 2026: "This search bar allows multiple filters separated by commas. For example, I
// want to filter Febin and Vitus. The search bar should accommodate 'Febin,Vitus' with no space
// after the comma."
//
// Two names side by side already meant "rows naming BOTH" and must keep meaning that — it is the
// right default and AMs rely on it. The comma is the OTHER question.
// ---------------------------------------------------------------------------------------------
console.log('── the comma rule (OR) against the space rule (AND)');
const PEOPLE = [
  T({ owner: 'Febin', client: 'Reiss', market: 'GB', title: 'Plan Update', cat: 'acct' }),
  T({ owner: 'Vitus', client: 'Reiss', market: 'US', title: 'Data request', cat: 'acct' }),
  T({ owner: 'Steven Opuni', client: 'Monsoon', market: 'GB', title: 'Overview, all markets', cat: 'opt' }),
];
const who = (qs) => PEOPLE.filter((r) => M.matchTask(r, M.parseQuery(qs))).map((r) => r.owner);
const whoPage = (qs) => PEOPLE.filter((r) => P.matchTask(r, P.parseQuery(qs))).map((r) => r.owner);

eq(who('Febin,Vitus'), ['Febin', 'Vitus'], 'RAY\'S CASE: "Febin,Vitus", no space, returns both people');
eq(who('Febin, Vitus'), ['Febin', 'Vitus'],
  'and WITH the space, because half of us type it and reading that as AND would answer "no rows"');
eq(who('Febin ,Vitus'), ['Febin', 'Vitus'], 'a space before the comma is the same list');
eq(who('Febin Vitus'), [],
  'while a SPACE still means AND — the old default is untouched, and no row names both people');
eq(who('Febin'), ['Febin'], 'one name is still one name');
eq(who('Febin,'), ['Febin'],
  'a trailing comma is someone mid-type, not a term that matches nothing');
eq(who(','), ['Febin', 'Vitus', 'Steven Opuni'],
  'a bare comma is not a filter at all — it shows everything rather than nothing');
eq(who('reiss Febin,Vitus'), ['Febin', 'Vitus'],
  'groups AND across the spaces: Reiss AND (Febin OR Vitus)');
eq(who('reiss Febin,steven'), ['Febin'],
  'so a Reiss filter still excludes the Monsoon row the OR list would otherwise have let in');
eq(who('-Febin,Vitus'), ['Steven Opuni'],
  'negating a list excludes a row carrying EITHER, which is what "not these two" means');

console.log('── the comma on a field is the shorthand for repeating it');
eq(who('owner:Febin,Vitus'), who('owner:Febin owner:Vitus'),
  'owner:Febin,Vitus is exactly owner:Febin owner:Vitus');
eq(who('market:GB,US'), ['Febin', 'Vitus', 'Steven Opuni'], 'markets OR');
eq(who('cat:acct,opt'), ['Febin', 'Vitus', 'Steven Opuni'], 'and so do categories, through their aliases');
eq(M.parseQuery('cat:technical,feature').f.cat, ['tech', 'feat'],
  'each alternative goes through the alias map, not just the first');
eq(who('client:Reiss,Monsoon owner:Febin'), ['Febin'], 'a list on one field still ANDs with another field');
eq(M.parseQuery('min:2,5').num, [{ k: 'min', v: 2 }],
  'a BOUND takes the first value — an alternation of minimums is not a question anyone asks');
eq(M.parseQuery('from:2026-01,2026-06').f.from[0], '2026-01',
  'and a range keeps its first date, exactly as a repeated from: already did');

console.log('── inside quotes a comma is punctuation, not syntax');
eq(who('"Overview, all markets"'), ['Steven Opuni'],
  'a quoted phrase keeps its own commas — it is one literal, which is what quoting means');
eq(who('"Overview, all markets",Febin'), ['Febin', 'Steven Opuni'],
  'and can still be one alternative in a list beside a bare word');
eq(M.parseQuery('"a, b"').text, [['a, b']], 'the comma survives the parse rather than splitting the phrase');
ok(M.parseQuery('"a, b"').text[0][0].indexOf('\u0000') < 0,
  'and the sentinel it rode through tokenisation on never reaches a term');

console.log('── the page agrees on every one of those');
for (const qs of ['Febin,Vitus', 'Febin, Vitus', 'Febin Vitus', 'Febin,', ',', '-Febin,Vitus',
  'reiss Febin,Vitus', 'owner:Febin,Vitus', 'cat:technical,feature', '"Overview, all markets",Febin']) {
  eq(whoPage(qs), who(qs), `page and engine agree on "${qs}"`);
}

eq(P.DIMS.map((d) => d.k), M.DIMS.map((d) => d.k), 'the page offers exactly the engine\'s dimensions');
eq(P.CATS, M.CATS, 'the page carries the same category keys');
eq(Object.keys(P.CAT_LABEL).sort(), Object.keys(M.CAT_LABEL).sort(), 'the page carries the same category labels');
eq(Object.keys(P.STATUS_BUCKET).sort(), Object.keys(M.STATUS_BUCKET).sort(), 'the page carries the same status map');

// ---------------------------------------------------------------------------------------------
// the book store — one market's pull, through KV, and out the other side
// ---------------------------------------------------------------------------------------------
console.log('── the book store (pack → KV → assemble)');
const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);
const WIN = M.bookWindow(NOW, 12);
eq(WIN, { from: '2025-10-01', to: '2026-09-16' }, 'the window is twelve whole months ending today');

// a pull as the database returns it: newest first, `raw` carrying the two hour columns
const src = (id, title, day, bill, nb, owner, status, note) => ({
  list_id: id, title, status: status || 'done', owner: owner || 'Febin', created_on: day + ' 00:00:00',
  time_taken: bill,
  raw: { list_id: id, client_id: 155, title, status: status || 'done', createdon: day + ' 00:00:00',
    time_taken: bill, time_taken_nonbill: nb, time_schedule: bill + nb, notes: note || '', ticket_id: 0 },
});
const META = { client: 'Reiss', market: 'GB', am: 'Ray', cid: 155 };

{
  const rec = M.packMarket([
    src(9, 'Keyword optimisation', '2026-05-04', 2, 1.5),
    src(8, 'Client call', '2026-01-10', 1, 0),
    // OUTSIDE the window — the database ignores from_date, so the window is applied here
    src(7, 'Category mapping', '2024-11-21', 2, 0),
    src(6, 'Quarterly Business Review', '0000-00-00', 0, 0),
  ], META, WIN, NOW);
  eq(rec.n, 2, 'only rows inside the window are kept — the ignored from_date is caught here');
  eq(rec.pulled, 4, 'the pull size is recorded as it came');
  eq(rec.deepest, '2024-11-21', 'the deepest dated row is recorded');
  ok(rec.full === true, 'a pull reaching past the window start is FULL');
  eq(rec.bill, 3, 'billable is summed over the kept rows');
  eq(rec.nonbill, 1.5, 'non-billable is summed apart');
  const back = rec.rows.map((r) => M.unpackRow(r, 'Reiss', 'GB', 'Ray'));
  eq(back[0].title, 'Keyword optimisation', 'a row survives the round trip');
  eq(back[0].bill, 2, 'billable hours survive the quarter-hour encoding');
  eq(back[0].nonbill, 1.5, 'so do non-billable');
  eq(back[0].hours, 3.5, 'and the total is their sum');
  eq(back[0].cat, 'opt', 'the category is carried, not re-derived from a lost title');
  eq(back[0].client, 'Reiss', 'client and market come from the record, not the row');
  ok(rec.rows.every((r) => Number.isInteger(r[5] || 0) && Number.isInteger(r[6] || 0)),
    'hours are stored as whole quarter-hours, so four thousand rows cannot accumulate float dust');
}
{
  // THE SECOND TRAP: newest-first with a row cap. A pull whose deepest row is INSIDE the window
  // never reached the start of it — reporting that as a full year would overstate every total.
  const rec = M.packMarket([src(1, 'Keyword optimisation', '2026-05-04', 2, 0)], META, WIN, NOW);
  ok(rec.full === false, 'a pull that stops inside the window is PARTIAL, not a whole year');
  eq(rec.n, 1, '...and still contributes the rows it does have');
}
{
  const rec = M.packMarket([], META, WIN, NOW);
  ok(rec.full === true, 'a market with no rows at all is not "partial" — there was nothing to miss');
  eq(rec.n, 0, 'and it contributes nothing');
}

console.log('── the ticket queue');
const tsrc = (id, subject, status, d, idle) => ({
  ticket_id: id, client_id: 51, client_name: 'Reiss', primary_am: 'Ray', subject, status,
  received_date: d + ' 10:00:00', first_received: d + ' 09:00:00', last_reply_by: 'internal',
  origin_type: 'client', origin_from: 'eliza.bendall@reiss.com', age_days: 3, age_level: 'ok',
  idle_days: idle == null ? 0 : idle, message_count: 7, task_count: 1, hours_spent: 0.5,
});
{
  const q = M.packQueue([
    tsrc(33256, 'Israel Feed Set Up', 'reopened', '2026-09-16'),
    tsrc(20197, 'Access Request', 'open', '2024-10-01', 700),
  ], 'Reiss', WIN, NOW);
  eq(q.n, 1, 'a ticket whose LAST ACTIVITY predates the window is out of scope');
  eq(q.pulled, 2, 'the pull size is recorded as it came');
  const t0 = M.unpackTicket(q.rows[0], 'Reiss', 'Ray');
  eq(t0.subject, 'Israel Feed Set Up', 'a ticket survives the round trip');
  eq(t0.hours, 0.5, 'ticket hours survive the quarter-hour encoding');
}

console.log('── the rotation');
{
  const markets = [{ id: 1, client: 'A', market: 'GB' }, { id: 2, client: 'B', market: 'GB' }, { id: 3, client: 'C', market: 'GB' }];
  // a market never read always leads — otherwise one at the end of the roster starves
  eq(M.bookPlan(markets, { 1: NOW, 2: NOW - 1000 }, 2, NOW).map((m) => m.id), [3, 2],
    'never-read first, then stalest');
  eq(M.bookPlan(markets, { 1: 10, 2: 20, 3: 30 }, 2, NOW).map((m) => m.id), [1, 2],
    'once all are read, stalest first');
  eq(M.bookPlan(markets, {}, 0, NOW).length, 0, 'a zero budget reads nothing');
  eq(M.queuePlan([{ tid: 7, client: 'A' }, { tid: 8, client: 'B' }], { 7: NOW }, 1).map((q) => q.tid), [8],
    'the ticket queues rotate the same way');
}

console.log('── the roster');
{
  const r = M.rosterOf([
    { client_id: 155, ticket_client_id: 51, market_flag: 0, client_name: 'Reiss', country: 'GB', primary_am: 'Ray', allowance: 35, used_hours: 38.25, balance: -36.75 },
    { client_id: 608, ticket_client_id: 51, market_flag: 1, client_name: 'Reiss', country: 'ES', primary_am: 'Ray', allowance: 0, used_hours: 0, balance: 0 },
    { client_id: 362, ticket_client_id: 51, market_flag: 0, client_name: 'Reiss', country: 'AU', primary_am: 'Ray', allowance: 0, used_hours: 2, balance: -22 },
    { client_id: 99, ticket_client_id: 0, market_flag: 0, client_name: 'Bad:Name', country: 'GB' },
  ]);
  eq(r.accounts.length, 3, 'a client name that could poison a KV key is refused outright');
  eq(r.markets.map((m) => m.id), [155, 362], 'only markets carrying a block or booked hours are worth a pull');
  eq(r.queues.map((q) => q.tid), [51], 'one queue per client, not per market');
  eq(r.accounts[0].balance, -36.75, 'the balance is carried through as the master states it');
  ok(r.accounts.some((a) => a.flag !== 0), 'stopped markets stay in the roster — the Accounts tab shows them');
}

console.log('── assembling the book');
{
  const accounts = [
    { cid: 155, tid: 51, client: 'Reiss', market: 'GB', am: 'Ray', flag: 0, allowance: 35, used: 38.25, balance: -36.75 },
    { cid: 276, tid: 62, client: 'American Golf', market: 'GB', am: 'Ray', flag: 0, allowance: 12, used: 4.75, balance: -21.25 },
  ];
  const books = [
    { client: 'Reiss', markets: { GB: M.packMarket([src(9, 'Keyword optimisation', '2026-05-04', 2, 1)], META, WIN, NOW) } },
    { client: 'American Golf', markets: { GB: M.packMarket([src(5, 'GMC Fixing', '2026-06-01', 1, 0)], { client: 'American Golf', market: 'GB', am: 'Ray', cid: 276 }, WIN, NOW) } },
  ];
  // the ticket queue spells the brand its own way; unfolded it would be a second client
  const queues = [{ client: 'American golf', at: NOW, from: WIN.from, to: WIN.to, pulled: 1, n: 1, deepest: '2026-06-01',
    rows: M.packQueue([tsrc(31597, 'Open Ai Feed', 'open', '2026-06-30')], 'American golf', WIN, NOW).rows }];
  const b = M.assembleBook(books, queues, accounts, NOW);
  eq(b.rows.length, 2, 'every market’s rows land in one list');
  eq(b.rows[0].d, '2026-06-01', 'newest first');
  eq(b.tickets.length, 1, 'the tickets come with them');
  eq(b.tickets[0].client, 'American Golf', 'the ticket queue’s spelling is folded onto the client master’s');
  const names = b.rows.map((r) => r.client).concat(b.tickets.map((t) => t.client));
  eq([...new Set(names)].sort(), ['American Golf', 'Reiss'], 'so a brand never appears twice under two spellings');
  eq(b.coverage.length, 2, 'coverage names every market read');
  eq(b.from, WIN.from, 'the assembled book states its own window');
  const h = M.bookHealth(b.coverage, [{ id: 155 }, { id: 276 }, { id: 501 }], NOW);
  eq(h.read, 2, 'health counts what has been read');
  eq(h.total, 3, '...against the whole roster, not against itself');
  ok(!h.complete, 'a book missing a market is not complete');
  eq(M.bookHealth([], [{ id: 1 }], NOW).read, 0, 'an unread book says zero rather than pretending');
}

// ---------------------------------------------------------------------------------------------
// the worker's tmBookPull, lifted by name, against a stub MCP server
// ---------------------------------------------------------------------------------------------
console.log('── worker: tmBookPull (lifted) against a stub MCP');
const WK = fs.readFileSync(WORKER, 'utf8');
function liftFn(name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\(', 'm');
  const m = re.exec(WK);
  if (!m) throw new Error('worker.js: ' + name + ' not found');
  const end = WK.indexOf('\n}\n', m.index);
  if (end < 0) throw new Error(name + ': no end');
  return WK.slice(m.index, end + 3);
}
const W = new Function('TMM', 'TB', liftFn('tmMcp') + liftFn('tmBookPull') + '\nreturn { tmBookPull };')(TMM, M);

function fakeKV(init) {
  const store = new Map();
  Object.keys(init || {}).forEach((k) => store.set(k, JSON.stringify(init[k])));
  const puts = [];
  return { store, puts,
    async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, typeof v === 'string' ? v : JSON.stringify(v)); puts.push(k); } };
}

const TOKEN = 'book-token';
const CLIENTS = [
  { client_id: 155, ticket_client_id: 51, market_flag: 0, client_name: 'Reiss', country: 'GB', primary_am: 'Ray', allowance: 35, used_hours: 38.25, balance: -36.75, balance_health: 'negative' },
  { client_id: 467, ticket_client_id: 51, market_flag: 0, client_name: 'Reiss', country: 'DE', primary_am: 'Ray', allowance: 8, used_hours: 7.5, balance: -0.25 },
  { client_id: 608, ticket_client_id: 51, market_flag: 1, client_name: 'Reiss', country: 'ES', primary_am: 'Ray', allowance: 0, used_hours: 0, balance: 0 },
];
const TASKROWS = {
  155: [src(9, 'Keyword optimisation', '2026-05-04', 2, 1.5), src(7, 'Category mapping', '2024-11-21', 2, 0)],
  467: [src(4, 'Title optimisation', '2026-07-01', 1, 0.25)],
};
const TICKETROWS = { 51: [tsrc(33256, 'Israel Feed Set Up', 'open', '2026-09-16')] };
let calls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const m = body ? JSON.parse(body) : {};
    if (req.headers.authorization !== 'Bearer ' + TOKEN) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Unauthorized.' } }));
    }
    if (m.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'Mcp-Session-Id': 's1' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: {} })); }
    if (m.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    const name = m.params && m.params.name, args = (m.params && m.params.arguments) || {};
    calls.push({ name, args });
    const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(obj) }] } })); };
    if (name === 'get_client_list') return reply(CLIENTS);
    if (name === 'get_task_list_for_client') { const rows = TASKROWS[args.client_id] || []; return reply({ status: 'ok', rows, returned_count: rows.length, total_count: rows.length, truncated: false }); }
    if (name === 'get_tickets_for_client') return reply(TICKETROWS[args.client_id] || []);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/mcp';
const envOf = (o) => Object.assign({ TM_MCP_URL: URL0 }, o);

{
  const kv = fakeKV();
  const st = await W.tmBookPull(envOf({ EDITS: kv }), { now: NOW });
  eq(st.state, 'no_token', 'no TM_MCP_TOKEN → an honest state, and no network call');
  eq(calls.length, 0, '...nothing was fetched');
  ok(!st.error || st.error.indexOf('TM_MCP_TOKEN') >= 0, '...and the status names the missing secret');
}
{
  calls = [];
  const kv = fakeKV();
  const st = await W.tmBookPull(envOf({ EDITS: kv, TM_MCP_TOKEN: 'wrong' }), { now: NOW });
  eq(st.state, 'unauthorized', 'a refused credential is reported as unauthorized');
  ok(JSON.stringify(st).indexOf('wrong') < 0, '...and the status never echoes the secret back');
}
{
  calls = [];
  const kv = fakeKV();
  const st = await W.tmBookPull(envOf({ EDITS: kv, TM_MCP_TOKEN: TOKEN }), { now: NOW, pulls: 2, queues: 1 });
  eq(st.state, 'ok', 'the real pull succeeds');
  eq(calls.filter((c) => c.name === 'get_client_list').length, 1, 'one client list per firing');
  eq(calls.filter((c) => c.name === 'get_task_list_for_client').map((c) => c.args.client_id).sort(), [155, 467],
    'only the markets worth reading are pulled — the stopped one with no hours is skipped');
  eq(calls.filter((c) => c.name === 'get_tickets_for_client').length, 1, 'and one ticket queue');
  ok(kv.puts.indexOf('tmbook:Reiss') >= 0, 'the market lands in the client’s book record');
  ok(kv.puts.indexOf('tmtick:Reiss') >= 0, 'the queue lands in its own record');
  ok(kv.puts.indexOf('tmbookidx') >= 0, 'the index is written');
  const book = await kv.get('tmbook:Reiss', 'json');
  eq(Object.keys(book.markets).sort(), ['DE', 'GB'], 'both markets sit in one client record');
  eq(book.markets.GB.n, 1, 'the out-of-window row was dropped on the way in');
  eq(book.markets.GB.full, true, 'the GB pull reached past the window start');
  eq(book.markets.DE.full, false, 'the DE pull did not, so it is marked partial');
  const idx = await kv.get('tmbookidx', 'json');
  eq(Object.keys(idx.rot).map(Number).sort(), [155, 467], 'the rotation records what it read');
  eq(idx.roster.length, 2, 'the index keeps the roster the health line counts against');
  ok(idx.accounts.length === 3, 'the client master is kept whole — stopped markets included');

  // a second firing must MOVE ON rather than re-reading the same market
  calls = [];
  const st2 = await W.tmBookPull(envOf({ EDITS: kv, TM_MCP_TOKEN: TOKEN }), { now: NOW + 3600000, pulls: 1, queues: 0 });
  eq(st2.state, 'ok', 'the next firing succeeds too');
  eq(calls.filter((c) => c.name === 'get_task_list_for_client').map((c) => c.args.client_id), [155],
    'and reads the STALEST market, so nothing starves at the end of the roster');

  // and the assembled view is what the route serves
  const b = M.assembleBook([await kv.get('tmbook:Reiss', 'json')],
    [Object.assign({ client: 'Reiss' }, await kv.get('tmtick:Reiss', 'json'))], idx.accounts, NOW);
  eq(b.rows.length, 2, 'the assembled book carries both markets’ rows');
  eq(b.tickets.length, 1, '...and the queue');
  const sum = M.summarise(b.rows);
  ok(Math.abs(sum.bill + sum.nonbill - sum.hours) < 1e-9, 'billable + non-billable = total, through KV and back');
  eq(sum.bill, 3, 'billable survives the whole round trip');
  eq(sum.nonbill, 1.75, 'and so does non-billable');
}
{
  calls = [];
  const kv = fakeKV();
  const st = await W.tmBookPull(envOf({ EDITS: kv, TM_MCP_TOKEN: TOKEN, TM_MCP_URL: 'http://127.0.0.1:1/mcp' }), { now: NOW });
  ok(st.state === 'unreachable' || st.state === 'error', 'an unreachable endpoint fails up honestly rather than writing an empty book');
  ok(kv.puts.indexOf('tmbookidx') < 0, '...and never writes a half-built index');
}
server.close();


// ---------------------------------------------------------------------------------------------
// the page is wired the way the worker expects
// ---------------------------------------------------------------------------------------------
console.log('── page wiring');
const page = fs.readFileSync(PAGE, 'utf8');
ok(page.indexOf("fetch('/api/taskmanager')") >= 0, 'the page reads the SCOPED api route, not a baked payload');
ok(page.indexOf('window.FSTASKS') < 0, 'the dataset is never spliced into the page — scoping happens server-side');
ok(page.indexOf('Sync more') >= 0, 'the owner can fill the book on demand rather than waiting for :15 / :45');
ok(/has not been read yet/.test(page), 'an unread book reads as unread, not as an empty one');
ok(/id="q"/.test(page), 'the search bar is on the page');
ok(/id="cstage"/.test(page) && /id="cform"/.test(page), 'the chart workbench is on the page');
ok(/Billable vs non-billable/.test(page), 'the chart says what it is charting');
ok(/id="xpng"/.test(page) && /id="xcsv"/.test(page) && /id="xtsv"/.test(page),
  'the pull-out exits are on the page (PNG, CSV, copy table)');
ok(/data-t="tickets"/.test(page) && /data-t="accounts"/.test(page),
  'the ticket queue and the client master each have their own tab');
ok(/href="\/tasks" class="tbm on"/.test(page), 'the page marks its own nav link');
const worker = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');
ok(worker.indexOf("'/api/taskmanager'") >= 0, 'the worker serves /api/taskmanager');
ok(worker.indexOf("'/tasks':") >= 0, 'the worker serves /tasks');
ok(worker.indexOf('reports_tasks.json') < 0 && !fs.existsSync(path.join(ROOT, 'docs', 'reports_tasks.json')),
  'NO client hours in git — the book is pulled live and lives in KV only');
// a session working on the module will have pulls sitting in ops/reports locally; the rule is
// that none of it is COMMITTED, so the check is on what git tracks, not on what is on disk
ok(/^ops\/reports\/$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')),
  "nor anything a session pulls while working on it — ops/reports/ is ignored wholesale");
ok(worker.indexOf('async function tmBookPull') >= 0, 'the worker pulls the book out of the MCP itself');
ok(/await tmBookPull\(env\);/.test(worker), 'and does it on the cron, not by hand');
ok(worker.indexOf("'tmbook:' + m.client") >= 0 && worker.indexOf("'tmtick:' + q.client") >= 0,
  'the book and the ticket queues each have their own KV records');
ok(/sync is owner-only/.test(worker), '?sync= is owner-only — it spends the MCP budget');
const access = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'access.js'), 'utf8');
ok(/slug: 'taskmanager'.*path: '\/tasks'/.test(access), 'the module is grantable per person');

// ---------------------------------------------------------------------------------------------
// the pane's own filter + totals footer, lifted out of the page by name
//
// Ray, 16 Sep 2026: "Under the task box, include a search bar. It should display the list of
// tasks, and at the bottom show the total hours of billable and non-billable for filtered
// searches."
//
// The trap worth pinning: the table paints 200 rows at a time, so a footer summed from what is
// on screen would quietly report a fraction of the search as its total.
// ---------------------------------------------------------------------------------------------
console.log('── pane filter + totals footer (lifted from the page)');
const PG = fs.readFileSync(PAGE, 'utf8');
function liftPageSrc(name) {
  const re = new RegExp('^  (?:var ' + name + ' = \\{|function ' + name + '\\()', 'm');
  const m = re.exec(PG);
  if (!m) throw new Error('page: ' + name + ' not found');
  const end = PG.indexOf(name.charAt(0) === name.charAt(0).toUpperCase() && !/^[a-z]/.test(name) ? '\n  };\n' : '\n  }\n', m.index);
  if (end < 0) throw new Error(name + ': no end');
  return PG.slice(m.index, end + 4);
}
// setPQ is lifted REAL, not stubbed: since the comma rule lives in the parse, a stand-in setter
// would test a filter nobody runs. The comma helpers come with it, from the same page.
const PANE = new Function('CAT_LABEL', 'num', 'hrs', 'esc', 'SHOW',
  'var PQ = "", PQT = [], QCOMMA = "\\u0000";\n'
  + liftPageSrc('mergeCommaRuns') + '\n' + liftPageSrc('splitAlts') + '\n'
  + liftPageSrc('orTerms') + '\n' + liftPageSrc('setPQ') + '\n'
  + liftPageSrc('pqHay') + '\n' + liftPageSrc('pqMatch') + '\n'
  + liftPageSrc('FOOT') + '\n' + liftPageSrc('footHtml') + '\n'
  + 'return { setPQ: setPQ, pqMatch: pqMatch, footHtml: footHtml, FOOT: FOOT };'
)(M.CAT_LABEL,
  (n) => String(n),
  (n) => String(Math.round((Number(n) || 0) * 100) / 100),
  (s2) => String(s2 == null ? '' : s2).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  200);

const prow = (o) => Object.assign({ title: '', client: '', market: '', owner: '', am: '',
  status: '', note: '', cat: 'opt', bill: 0, nonbill: 0, hours: 0 }, o);

// --- the filter --------------------------------------------------------------------------------
PANE.setPQ('');
ok(PANE.pqMatch('tasks', prow({ title: 'anything' })), 'an empty filter keeps every row');
PANE.setPQ('keyword');
ok(PANE.pqMatch('tasks', prow({ title: 'Keyword optimisation' })), 'it is case-insensitive');
ok(!PANE.pqMatch('tasks', prow({ title: 'Title optimisation' })), 'and it actually excludes');
ok(PANE.pqMatch('tasks', prow({ title: 'x', note: 'keyword themes' })), 'the note is searched too');
ok(PANE.pqMatch('tasks', prow({ title: 'x', owner: 'Keyword Bot' })), 'so is who did it');
PANE.setPQ('optimisation');
ok(PANE.pqMatch('tasks', prow({ title: 'x', cat: 'opt' })),
  'the TYPE matches on its display label, not the internal slug — the column reads "Optimisation"');
PANE.setPQ('reiss keyword');
ok(PANE.pqMatch('tasks', prow({ title: 'Keyword optimisation', client: 'Reiss' })),
  'every word must appear, but they may land in different columns');
ok(!PANE.pqMatch('tasks', prow({ title: 'Keyword optimisation', client: 'Schuh' })),
  'so a row carrying only one of the words is out');
PANE.setPQ('israel');
ok(PANE.pqMatch('tickets', prow({ subject: 'Israel Feed Set Up' })), 'tickets search their own fields');
ok(PANE.pqMatch('accounts', prow({ client: 'x', name: 'Israel - GB' })), 'and so do accounts');

// --- the totals --------------------------------------------------------------------------------
PANE.setPQ('');
const many = [];
for (let i = 0; i < 220; i++) many.push(prow({ bill: 1, nonbill: 0.25, hours: 1.25 }));
const capped = PANE.footHtml('tasks', many, new Array(9).fill({}), true);
ok(capped.indexOf('>275<') >= 0, 'the TOTAL column sums all 220 rows (275 h), not the 200 painted');
ok(capped.indexOf('>220<') >= 0 && capped.indexOf('>55<') >= 0,
  'billable (220 h) and non-billable (55 h) are totalled SEPARATELY and never merged');
ok(/totalled in full, not just the 200 shown/.test(capped),
  'and the row says so, because a total beside a shorter list is otherwise ambiguous');
ok(!/totalled in full/.test(PANE.footHtml('tasks', many.slice(0, 10), new Array(9).fill({}), false)),
  'an uncapped list does not carry that caveat');
eq(PANE.footHtml('tasks', [], new Array(9).fill({}), false), '',
  'no rows means no totals row at all — a row of zeroes would read as a finding');

PANE.setPQ('gmc');
ok(/matching/.test(PANE.footHtml('tasks', many.slice(0, 4), new Array(9).fill({}), false)),
  'when a filter is on, the label names it');
PANE.setPQ('');

// --- the comma rule, on the box Ray was actually pointing at ------------------------------------
// This pane filter is the plain-substring box under the tab header. It reads the ENGINE's own
// orTerms, so "Febin,Vitus" cannot mean one thing here and another in the grammar bar above it.
console.log('── the comma rule on the pane filter');
const PR = [prow({ owner: 'Febin', client: 'Reiss', title: 'Plan Update' }),
  prow({ owner: 'Vitus', client: 'Reiss', title: 'Data request' }),
  prow({ owner: 'Steven', client: 'Monsoon', title: 'Overview, all markets' })];
const pwho = (q) => { PANE.setPQ(q); return PR.filter((r) => PANE.pqMatch('tasks', r)).map((r) => r.owner); };

eq(pwho('Febin,Vitus'), ['Febin', 'Vitus'], 'RAY\'S CASE on the pane box: no space after the comma');
eq(pwho('Febin, Vitus'), ['Febin', 'Vitus'], 'and with the space');
eq(pwho('Febin Vitus'), [], 'a space is still AND here too — the default AMs already rely on');
eq(pwho('Febin,'), ['Febin'], 'mid-type trailing comma is just the one name');
eq(pwho(','), ['Febin', 'Vitus', 'Steven'], 'a bare comma filters nothing rather than everything out');
eq(pwho('reiss febin,vitus'), ['Febin', 'Vitus'], 'and groups AND across the space');
eq(pwho('reiss febin,steven'), ['Febin'], 'so the Reiss word still excludes the Monsoon row');
eq(pwho('FEBIN,VITUS'), ['Febin', 'Vitus'], 'case-insensitive, like the rest of the box');
PANE.setPQ('');
eq(PR.filter((r) => PANE.pqMatch('tasks', r)).length, 3, 'and clearing it restores every row');

ok(/PQT\.length \? \(num\(n\)/.test(PG) && /PQT\.length \? ' matching/.test(PG),
  'and so does the "N of M" chip and the footer label — "45 of 45 matching ," would claim a filter '
  + 'that is not narrowing anything');
ok(/PQT\.length \? src\.filter/.test(PG),
  'paneRows tests the PARSED terms, not the raw string — else a lone "," would filter to nothing');
ok(/function orTerms/.test(PG) && /PQT = orTerms\(PQ\)/.test(PG),
  'and the pane reads the engine\'s own comma rule rather than carrying a second copy of it');

// the columns a tab can honestly add up
eq(PANE.FOOT.tasks.map((f) => f.k), ['bill', 'nonbill', 'hours'], 'tasks total the three hour columns');
eq(PANE.FOOT.tickets.map((f) => f.k), ['tasks', 'hours'], 'tickets total what is summable');
ok(PANE.FOOT.tickets.every((f) => f.k !== 'age' && f.k !== 'idle'),
  'and never Age or Idle — adding those together is arithmetic on a meaningless number');
eq(PANE.FOOT.accounts.map((f) => f.k), ['allowance', 'used', 'balance'], 'accounts total the hours columns');

ok(/id="pq"/.test(PG), 'the filter input sits on the pane, under the tab header');
ok(/function paneRows/.test(PG) && /var rows = paneRows\('tasks'\)/.test(PG),
  'one resolver feeds the table');
ok(/var rows = paneRows\(tab\);/.test(PG),
  'and the Excel export reads the SAME one, so a download can never be a different population');
ok(/runs on top of the search above/.test(PG),
  'an empty result distinguishes "nothing matched at all" from "this filter narrowed it to nothing"');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
