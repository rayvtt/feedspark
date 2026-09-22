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
    'CATS', 'CAT_LABEL', 'DIMS', 'BUCKET_LABEL', 'STATUS_BUCKET',
    'TAG_SEED', 'normTagSlug', 'taggable', 'ruleHits', 'tagsOf', 'decorateTags',
    'displacement', 'rulePreview', 'groupNested', 'flattenNested', 'NEST_CAPS',
    'typeOf', 'decorateTypes', 'seriesByMonth', 'monthOf', 'isoOf', 'MEASURES', 'mOf',
    'urgencyCheck'];
  // eslint-disable-next-line no-new-func
  const f = new Function(body + '\nreturn {' + names.join(',') + '};');
  return f();
}
const P = liftPage();
const PAGE_SRC = fs.readFileSync(PAGE, 'utf8');
const ENG = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'taskbook.js'), 'utf8');
const SS = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'sharedstate.js'), 'utf8');

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
// A SECOND AND THIRD SPLIT, NESTED
//
// Ray, 17 Sep 2026: "allow secondary and tertiary axis split as well, so you can see more granular
// breakdown, almost like AdWord campaigns."
//
// AdWords nests ROWS (Campaign > Ad group > Keyword) and keeps the metrics in the columns. The
// rules worth pinning are the ones that keep the numbers readable: the extra dimensions must not
// become the series, children must add up to their parent EXCEPT where a multi-valued dimension
// makes that impossible (and then it must say so), and the cross product must be capped without
// the fold becoming a dead end.
// ---------------------------------------------------------------------------------------------
console.log('── a second and third split, nested');
const NT = (o) => Object.assign({ id: 1, d: '2026-08-01', client: 'Reiss', market: 'GB', am: 'Ray',
  title: 't', note: '', cat: 'opt', owner: 'Febin', status: 'DONE', bucket: 'done',
  bill: 0, nonbill: 0, hours: 0, sched: 0, ticket: 0, tags: [] }, o);
const BOOK3 = [
  NT({ id: 1, client: 'Reiss', owner: 'Febin', cat: 'opt', bill: 4, hours: 4 }),
  NT({ id: 2, client: 'Reiss', owner: 'Febin', cat: 'tech', bill: 1, nonbill: 1, hours: 2 }),
  NT({ id: 3, client: 'Reiss', owner: 'Vitus', cat: 'opt', bill: 3, hours: 3 }),
  NT({ id: 4, client: 'Monsoon', owner: 'Febin', cat: 'acct', nonbill: 5, hours: 5 }),
  NT({ id: 5, client: 'Monsoon', owner: 'Steven', cat: 'opt', bill: 1, hours: 1, tags: ['urgent', 'technical'] }),
];

const T3 = M.groupNested(BOOK3, ['client', 'owner', 'cat']);
eq(T3.dims, ['client', 'owner', 'cat'], 'the tree records the levels it actually used');
eq(T3.map((x) => x.k), ['Reiss', 'Monsoon'], 'top level is biggest-hours first, like the flat chart');
eq(T3[0].hours, 9, 'a parent carries its own total');
eq(T3[0].kids.map((x) => x.k), ['Febin', 'Vitus'], 'and its children, also biggest-first');
eq(T3[0].kids[0].kids.map((x) => x.k), ['opt', 'tech'], 'to a third level');
eq(T3[0].kids.reduce((a, x) => a + x.hours, 0), T3[0].hours,
  'CHILDREN ADD UP TO THEIR PARENT — the one thing that makes a hierarchy readable at all');
ok(T3[0].kids[0].bill + T3[0].kids[0].nonbill === T3[0].kids[0].hours,
  'and every node at every depth keeps its OWN billable/non-billable split, because the nesting '
  + 'is the rows — the series is never handed to a second dimension');
eq(T3[0].kids[0].billPct, 83.3, 'each node carries its own share, not the parent\'s');

console.log('── the shape of the request is honoured, and its edges refused');
eq(M.groupNested(BOOK3, ['client']).dims, ['client'], 'one dimension still works — nesting is opt-in');
eq(M.groupNested(BOOK3, []).length, 0, 'no dimension yields no tree rather than a guess');
eq(M.groupNested(BOOK3, ['total', 'client']).dims, ['client'],
  '"Everything" is one bucket, so it is dropped rather than making a level that says nothing');
eq(M.groupNested(BOOK3, ['owner', 'owner', 'cat']).dims, ['owner', 'cat'],
  'a dimension repeated deeper is dropped — owner within owner is one child per parent');
eq(M.groupNested(BOOK3, ['client', 'owner', 'cat', 'month']).dims, ['client', 'owner', 'cat'],
  'and a fourth level is refused: three is what the view can render');

console.log('── the cross product is capped, and the fold is not a dead end');
const WIDE = [];
for (let i = 0; i < 40; i++) WIDE.push(NT({ id: 100 + i, client: 'C' + i, owner: 'O' + (i % 3), hours: 40 - i, bill: 40 - i }));
const TW = M.groupNested(WIDE, ['client', 'owner'], [5, 8]);
eq(TW.length, 5, 'the level is capped');
ok(/^Other \(36 more\)$/.test(TW[4].k), 'and the tail is named honestly, with its count');
eq(TW.folded, 36, 'the tree reports how many were folded so the surface can say so');
eq(TW[4].hours, WIDE.slice(4).reduce((a, x) => a + x.hours, 0),
  'the fold carries the folded HOURS, so the column still totals the book');
ok(TW[4].kids.length > 0,
  'AND ITS OWN CHILDREN — folding must not turn "Other" into a dead end you cannot look inside');
eq(TW[4].kids.reduce((a, x) => a + x.hours, 0), TW[4].hours, 'which still add up to it');
ok(M.groupNested(WIDE, ['client']).length <= M.NEST_CAPS[0], 'the default caps apply when none are given');

console.log('── where the rows CANNOT add up, it says so rather than hiding it');
const TAGTREE = M.groupNested(BOOK3, ['client', 'tag']);
ok(TAGTREE.multi === true,
  'nesting through the multi-valued tag dimension sets `multi`: one task carrying two tags is '
  + 'counted under each, so the children exceed the parent and the page must say so');
ok(M.groupNested(BOOK3, ['client', 'owner']).multi === false,
  'while an ordinary pair of dimensions never double-counts');
const mon = TAGTREE.find((x) => x.k === 'Monsoon');
eq(mon.kids.reduce((a, x) => a + x.hours, 0), 7,
  'and the excess is real arithmetic (5 untagged + 1 urgent + 1 technical), not a rounding artefact');

console.log('── flattened for the table and the export');
const FL = M.flattenNested(T3);
eq(FL.length, 2 + 4 + 5, 'every node appears once (2 clients, 4 client-owners, 5 leaves)');
eq(FL[0].depth, 0, 'parents come before their children');
eq(FL[1].depth, 1, 'in reading order');
eq(FL[0].path, ['Reiss'], 'each row carries its full path…');
eq(FL[2].path, ['Reiss', 'Febin', 'opt'], '…so an export can give every level its own column');
ok(FL[0].leaf === false && FL[2].leaf === true,
  'and marks leaves, because a pasted table that mixed parents with children would double every '
  + 'total the moment anyone summed the column');
eq(FL.filter((r) => r.leaf).reduce((a, r) => a + r.hours, 0), 15,
  'the leaves alone total the book exactly once');

console.log('── the page nests identically');
for (const fn of ['groupNested', 'flattenNested']) ok(typeof P[fn] === 'function', `the page exposes ${fn}`);
{
  const A = M.groupNested(BOOK3.map((r) => Object.assign({}, r)), ['client', 'owner', 'cat']);
  const B = P.groupNested(BOOK3.map((r) => Object.assign({}, r)), ['client', 'owner', 'cat']);
  eq(P.flattenNested(B).map((r) => r.path.join('>') + '=' + r.hours),
     M.flattenNested(A).map((r) => r.path.join('>') + '=' + r.hours),
     'node for node, hour for hour');
  eq(P.groupNested(BOOK3, ['client', 'tag']).multi, M.groupNested(BOOK3, ['client', 'tag']).multi,
     'and agrees about when the rows stop adding up');
  eq(P.NEST_CAPS, M.NEST_CAPS, 'with the same caps');
}
ok(/id="cdim2"/.test(PAGE_SRC) && /id="cdim3"/.test(PAGE_SRC), 'the page offers both extra splits');
ok(/no further split/.test(PAGE_SRC), 'each defaulting to none, so the existing single split is untouched');
ok(/function nestBars/.test(PAGE_SRC) && /viewBox/.test(PAGE_SRC),
  'the nested view is SVG like every other form, so the PNG export and the hover tooltip work unchanged');
ok(/Nested breakdown/.test(PAGE_SRC),
  'and the form selector NAMES the nested reading rather than sitting greyed out on a stale label');

// ---------------------------------------------------------------------------------------------
// TAGS — the judgement layer, and the number it exists to produce
//
// Ray, 17 Sep 2026: "there will be a tagging system, a labeling system of which task is urgent,
// which task is from agency work, and which task is technical … the goal is to highlight how many
// hours are spent on urgent stuff that should have been spent on optimisation."
//
// The rules worth pinning are the ones that decide whether anyone trusts the number: a human
// always beats a keyword rule, an untagged row is UNKNOWN rather than "not urgent", and a
// multi-tagged task must not silently double-count its hours under a heading that says "hours".
// ---------------------------------------------------------------------------------------------
console.log('── tags: a second axis, keyed on the task id');
const TT = (o) => Object.assign({ id: 1, d: '2026-08-01', client: 'Reiss', market: 'GB', am: 'Ray',
  title: '', note: '', cat: 'other', owner: 'Febin', status: 'DONE', bucket: 'done',
  bill: 0, nonbill: 0, hours: 0, sched: 0, ticket: 0 }, o);

eq(M.TAG_SEED.map((t) => t.slug), ['urgent', 'agency', 'technical'],
  "the seeded vocabulary is Ray's three, in his order");
ok(M.TAG_SEED.filter((t) => t.displaces).map((t) => t.slug).join() === 'urgent',
  'and only Urgent is marked as displacing the plan — the others are context, not a verdict');
eq(M.normTagSlug('Agency Work!'), 'agency-work', 'a tag name slugs down to something storable');
eq(M.normTagSlug('  '), '', 'and an empty name yields no slug rather than a blank tag');
ok(M.taggable(TT({ id: 7 })) && !M.taggable(TT({ id: 0 })),
  'a row without the source\'s own task id CANNOT be tagged — the key would have to be its wording, '
  + 'and the rotation re-packs every row about twice a day');

console.log('── the tag palette is the validated one, with its own dark steps');
eq(M.TAG_PAL.length, M.TAG_PAL_DARK.length, 'every light step has a dark counterpart');
eq(M.TAG_SEED.map((t) => t.color), M.TAG_PAL.slice(0, 3),
  'the seeded three take the first three slots of the validated set rather than hand-picked hues');
eq(M.tagDark('#e34948'), '#e66767', 'a light step resolves to its dark counterpart');
eq(M.tagDark('#123456'), '#123456', 'and an unknown colour is passed through rather than mangled');
ok(M.TAG_PAL.indexOf('#7c3aed') < 0 && M.TAG_PAL.indexOf('#2563EB'.toLowerCase()) < 0,
  'the ΔE-0.4-under-deuteranopia pair that the first draft gave Agency and Technical is gone — '
  + 'those are Ray\'s two non-urgent tags and they sit side by side on the same row');
ok(/dp-leg/.test(PAGE_SRC) && /Not yet tagged/.test(PAGE_SRC),
  'and the bar carries a LEGEND with its numbers, so identity is never colour alone');

console.log('── keyword rules read the field they were pointed at');
ok(M.ruleHits({ q: 'disapprov', on: 'title' }, TT({ title: 'Disapprovals' })), 'title match is case-insensitive substring');
ok(!M.ruleHits({ q: 'disapprov', on: 'note' }, TT({ title: 'Disapprovals' })), 'on:note does not read the title');
ok(M.ruleHits({ q: 'chase', on: 'both' }, TT({ title: 'Data request', note: 'had to chase' })), 'on:both reads either');
ok(!M.ruleHits({ q: '', on: 'title' }, TT({ title: 'anything' })), 'an empty rule matches nothing rather than everything');
ok(M.ruleHits({ q: '(', on: 'title' }, TT({ title: 'Email ticket: [x] (y)' })),
  'a rule is a plain SUBSTRING, never a regex — an AM typing "(" would otherwise throw inside the render loop');

console.log('── a human always beats a rule');
const RULES = [{ q: 'disapprov', on: 'title', tag: 'urgent' }, { q: 'disapprov', on: 'title', tag: 'technical' }];
eq(M.tagsOf(TT({ title: 'Disapprovals' }), {}, RULES).tags, ['urgent', 'technical'],
  'with nothing set by hand, every matching rule contributes its tag');
eq(M.tagsOf(TT({ title: 'Disapprovals' }), {}, RULES).src, 'rule', 'and the row says where that came from');
eq(M.tagsOf(TT({ id: 5, title: 'Disapprovals' }), { 5: { tags: ['agency'] } }, RULES).tags, ['agency'],
  'a hand-set record REPLACES the rules rather than merging with them');
eq(M.tagsOf(TT({ id: 5, title: 'Disapprovals' }), { 5: { tags: [] } }, RULES).tags, [],
  'AN EMPTY HAND-SET LIST STICKS — it means "I looked, none of these apply". Without this rule a '
  + 'keyword rule would re-apply its tag every render and nobody could ever take one off');
eq(M.tagsOf(TT({ title: 'Disapprovals' }), {}, [RULES[0], RULES[0]]).tags, ['urgent'],
  'two rules pointing at one tag do not double it');
eq(M.tagsOf(TT({ title: 'Keyword optimisation' }), {}, RULES).src, 'none', 'a row no rule matches says so');

console.log('── the displacement figure, and what it refuses to imply');
const BOOK = [
  TT({ id: 1, title: 'Disapprovals', cat: 'tech', hours: 3, bill: 3 }),
  TT({ id: 2, title: 'Email ticket: x', cat: 'acct', hours: 2, bill: 1, nonbill: 1 }),
  TT({ id: 3, title: 'Keyword optimisation', cat: 'opt', hours: 10, bill: 10 }),
  TT({ id: 4, title: 'Title optimisation', cat: 'opt', hours: 5, bill: 5 }),
];
M.decorateTags(BOOK, {}, [{ q: 'disapprov', on: 'title', tag: 'urgent' },
  { q: 'email ticket', on: 'title', tag: 'urgent' }, { q: 'disapprov', on: 'title', tag: 'technical' }]);
const D = M.displacement(BOOK, M.TAG_SEED);
eq(D.dispHours, 5, 'the displacing tag\'s hours are summed');
eq(D.optHours, 15, 'against the hours whose WORK classified as optimisation');
eq(D.pct, 25, 'reported as a share of the whole book in view, not of the tagged part');
eq(D.ratio, 0.33, 'and as reactive hours per hour of optimisation');
eq(D.coverage, 25, 'COVERAGE TRAVELS WITH IT — 25% of these hours have been judged at all');
eq([D.untaggedN, D.untaggedHours], [2, 15], 'the untagged remainder is counted, never assumed innocent');
eq(D.byTag.technical.hours, 3, 'each tag keeps its own hours');
eq(D.dispN, 2, 'and the row count behind the figure');
const D0 = M.displacement(BOOK, M.TAG_SEED.map((t) => Object.assign({}, t, { displaces: false })));
eq(D0.dispHours, 0, 'with nothing marked as displacing, the headline is zero rather than a guess');
eq(M.displacement([], M.TAG_SEED).pct, 0, 'an empty view divides by nothing and says 0, not NaN');

console.log('── one task, several tags: counted in each bucket, and SAID so');
const G = M.groupBy(BOOK, 'tag');
const gk = {}; G.forEach((g) => { gk[g.k] = g.hours; });
eq(gk.urgent, 5, 'the urgent bucket carries both urgent rows');
eq(gk.technical, 3, 'and the technical bucket carries the row that is also technical');
eq(gk['(untagged)'], 15, 'UNTAGGED IS ITS OWN BUCKET — the gap is never invisible on the chart');
ok(G.multi === true && G.placements === 5,
  'and groupBy reports that it placed 5 times across 4 rows, so the surface can say the hours '
  + 'legitimately sum to more than the book rather than quietly double-counting');
ok(M.groupBy(BOOK, 'owner').multi === false, 'every other dimension puts a task in exactly one bucket');
ok(M.DIMS.some((d) => d.k === 'tag'), 'tag is offered as a chart dimension');

console.log('── tag: in the search grammar');
const tq = (s2) => BOOK.filter((r) => M.matchTask(r, M.parseQuery(s2))).map((r) => r.id);
eq(tq('tag:urgent'), [1, 2], 'tag: matches a row carrying it');
eq(tq('tag:technical'), [1], 'including one of several on the same row');
eq(tq('tag:urgent,technical'), [1, 2], 'the comma rule works on tags like any other field');
eq(tq('tag:none'), [3, 4], 'tag:none asks the question an AM needs before trusting the figure');
eq(tq('tag:any'), [1, 2], 'tag:any is its opposite');
eq(tq('-tag:urgent'), [3, 4], 'and it negates');
eq(tq('tag:urgent cat:tech'), [1], 'tags AND with every other field, being a separate axis');
ok(!M.matchTicket({ subject: 'x', client: 'Reiss', status: 'open', d: '2026-08-01' }, M.parseQuery('tag:urgent')),
  'a ticket carries no tags, so a tag query returns none rather than ignoring the filter');

console.log('── the rule preview tells you what it will NOT touch');
const pv = M.rulePreview(BOOK, { q: 'disapprov', on: 'title' }, { 1: { tags: ['agency'] } });
eq([pv.hits, pv.held], [1, 1],
  'a row whose tags were set by hand is counted as a hit but HELD BACK — the rule builder says '
  + '"N already set by hand and left alone" rather than promising to tag rows it will not touch');
const pv2 = M.rulePreview(BOOK, { q: 'optimisation', on: 'title' }, {});
eq([pv2.hits, pv2.hours], [2, 15], 'and an untouched match reports the hours it would tag');

console.log('── the page carries the same tag engine');
for (const fn of ['tagsOf', 'displacement', 'ruleHits', 'rulePreview', 'taggable', 'normTagSlug']) {
  ok(typeof P[fn] === 'function', `the page exposes ${fn}`);
}
eq(P.TAG_SEED.map((t) => t.slug), M.TAG_SEED.map((t) => t.slug), 'with the same seeded vocabulary');
{
  const A = BOOK.map((r) => Object.assign({}, r)), B = BOOK.map((r) => Object.assign({}, r));
  const rules = [{ q: 'disapprov', on: 'title', tag: 'urgent' }, { q: 'email ticket', on: 'title', tag: 'urgent' }];
  M.decorateTags(A, { 1: { tags: [] } }, rules);
  P.decorateTags(B, { 1: { tags: [] } }, rules);
  eq(B.map((r) => r.tags.join('+')), A.map((r) => r.tags.join('+')), 'and agrees row for row, including the hand-cleared one');
  eq(P.displacement(B, P.TAG_SEED).dispHours, M.displacement(A, M.TAG_SEED).dispHours,
    'and reaches the same displacement figure');
  eq(P.groupBy(B, 'tag').multi, M.groupBy(A, 'tag').multi, 'and owns up to the same double count');
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
// ---------------------------------------------------------------------------------------------
// A HAND-SET TYPE THAT SURVIVES THE SYNC
//
// Ray, 17 Sep 2026: "Can Type also be edited on FCC and made changed data sticky from either tag
// or excel import too?, because the daily report fetched from the MCP will actually overwrite?"
//
// He is right about the mechanism: `cat` is derived by classifyTask(title) inside normTask and
// PACKED INTO the KV row, so every tmBookPull re-derives it. Anything written onto the record is
// gone within about twelve hours. These assertions pin the shape that survives it.
// ---------------------------------------------------------------------------------------------
console.log('── a hand-set Type, and the re-pull that would have overwritten it');
const CT = (o) => Object.assign({ id: 9, title: 'Disapprovals', cat: 'tech', client: 'Reiss',
  bill: 1, nonbill: 0, hours: 1 }, o);

ok(/cat: classifyTask\(title\)/.test(ENG) && /CATS\.indexOf\(t\.cat\)/.test(ENG),
  'THE PREMISE: cat is derived from the title AND packed into the stored row, which is exactly '
  + 'why an edit written onto the record cannot survive the next pull');

eq(M.typeOf(CT(), {}).cat, 'tech', 'with no override the derived value stands');
eq(M.typeOf(CT(), {}).src, 'auto', 'and says where it came from');
eq(M.typeOf(CT(), { 9: { cat: 'opt', t: 'Disapprovals' } }).cat, 'opt', 'an override wins');
eq(M.typeOf(CT(), { 9: { cat: 'opt', t: 'Disapprovals' } }).auto, 'tech',
  'and keeps the derived value alongside it, so the row can say what the database reads');
eq(M.typeOf(CT(), { 9: { cat: 'not-a-category' } }).src, 'auto',
  'a category the engine does not know is ignored rather than rendering an empty chip');
eq(M.typeOf(CT({ id: 0 }), { 0: { cat: 'opt' } }).src, 'auto',
  'a row with NO task id cannot be overridden: id 0 is not an id, and every such row would '
  + 'otherwise share the key "0" so one override would leak onto all of them');
eq(M.tagsOf(CT({ id: 0 }), { 0: { tags: ['urgent'] } }, []).tags, [],
  'and the same guard holds on tags, where the leak would have been just as quiet');

console.log('── the re-pull, simulated');
{
  const before = [CT({ id: 9 })];
  M.decorateTypes(before, { 9: { cat: 'opt', t: 'Disapprovals' } });
  eq(before[0].cat, 'opt', 'the override is applied…');
  // the rotation re-packs the row from scratch: cat comes back as the classifier's reading
  const repacked = M.unpackRow(M.packRow(M.normTask(
    { list_id: 9, title: 'Disapprovals', created_on: '2026-08-01', status: 'done', raw: { time_taken: 1 } },
    { client: 'Reiss', market: 'GB' })), 'Reiss', 'GB', 'Ray');
  eq(repacked.cat, 'tech', '…and the freshly pulled row carries the DERIVED value again, as Ray said');
  M.decorateTypes([repacked], { 9: { cat: 'opt', t: 'Disapprovals' } });
  eq(repacked.cat, 'opt',
    'but the override is applied AFTER unpack from a store the pull never writes, so it survives');
}

console.log('── a rename in the reports database is flagged, not silently obeyed or silently dropped');
{
  const r = M.typeOf(CT({ title: 'Disapprovals - full account sweep' }), { 9: { cat: 'opt', t: 'Disapprovals' } });
  eq(r.cat, 'opt', 'the override still applies — it is keyed on the id, not the wording');
  ok(r.stale === true,
    'but is marked STALE: dropping it silently loses a judgement, keeping it silently hides that '
    + 'it was made about a different task name');
  eq(M.typeOf(CT(), { 9: { cat: 'opt', t: 'Disapprovals' } }).stale, false, 'an unchanged title is not stale');
  eq(M.typeOf(CT(), { 9: { cat: 'opt' } }).stale, false,
    'and an override stored before this field existed is not retrospectively called stale');
}

console.log('── overriding the FIELD keeps every reader telling one story');
{
  const rows = [CT({ id: 9, cat: 'tech', hours: 3, bill: 3 }), CT({ id: 10, title: 'Keyword optimisation', cat: 'opt', hours: 5, bill: 5 })];
  M.decorateTypes(rows, { 9: { cat: 'opt', t: 'Disapprovals' } });
  rows.forEach((t) => { t.tags = []; });
  eq(M.displacement(rows, M.TAG_SEED).optHours, 8,
    'the displacement headline follows the override, because `cat` IS the field the search, the '
    + 'grouping and the headline all read — no reader needs teaching about overrides');
  eq(rows.filter((t) => M.matchTask(t, M.parseQuery('cat:opt'))).length, 2, 'and so does cat: in the search');
  eq(M.groupBy(rows, 'cat').length, 1, 'and the chart');
}

console.log('── a tag never drives the Type');
ok(!/tagsOf[\s\S]{0,400}setType|tag[\s\S]{0,80}->[\s\S]{0,40}cat =/.test(ENG),
  'Type is what the work WAS and a tag is why it happened; the displacement figure compares one '
  + 'against the other, so wiring them together would make the comparison measure itself');
ok(/tmtype:\s*'field'/.test(SS), 'the override is client-scoped shared state, like every other team judgement');
ok(/id="ptagimp"/.test(PAGE_SRC) && /Type of work/.test(PAGE_SRC), 'the spreadsheet round trip carries it');
ok(/Type set by hand/.test(PAGE_SRC),
  'and the export marks which Types were hand-set, so a round trip cannot launder a judgement into '
  + 'something that looks derived');

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
// ---------------------------------------------------------------------------------------------
// is_urgent — the Task Manager's own judgement, cross-checked against the tag
// (Ray, 22 Sep 2026: "can you bring in the is_urgent from FR mcp? it'll be used to cross-check
//  with my tag")
//
// The live book decides the shape and these assertions pin it: is_urgent is on NEITHER the task
// rows nor the ticket list — only get_ticket_detail — and `ticket_id` is 0 on every task row, so
// a task can never be asked whether its ticket was urgent. The two readings therefore stay apart.
// ---------------------------------------------------------------------------------------------
console.log('\n── is_urgent: read on its own rotation, never merged into the tag');
{
  const tk = (id, status, at) => ({ id, status, hours: 1, tasks: 2 });
  const tickets = [tk(1, 'open'), tk(2, 'closed'), tk(3, 'open'), tk(4, 'open')];
  const T0 = Date.UTC(2026, 8, 22);

  // never read first, in id order, capped
  let plan = M.urgPlan(tickets, { read: {} }, 2, T0);
  eq(plan.map((t) => t.id).join(','), '1,2', 'a ticket never read leads the rotation, and the cap holds');

  // a CLOSED ticket read once is final; an open one comes round again after the TTL
  const ttl = M.URG_TTL_DAYS * 864e5;
  const urg = { read: { 1: T0 - ttl - 1, 2: T0 - ttl - 1, 3: T0 - 1000, 4: T0 - ttl - 1 } };
  plan = M.urgPlan(tickets, urg, 10, T0);
  eq(plan.map((t) => t.id).join(','), '1,4', 'a closed ticket is never re-read, an open one is once its flag is stale');
  ok(plan.every((t) => t.id !== 3), '...and one read moments ago is left alone');
  eq(M.urgPlan(tickets, urg, 0, T0).length, 0, 'a zero budget reads nothing');

  // the store keeps the FLAG and nothing else
  let st = M.urgApply(null, 33300, true, T0);
  eq(Object.keys(st.urgent).join(','), '33300', 'an urgent ticket is recorded');
  eq(st.n, 1, '...and the read count is the tickets asked, not the ones flagged');
  st = M.urgApply(st, 33256, false, T0);
  eq(st.n, 2, 'a calm ticket still counts as READ');
  eq(Object.keys(st.urgent).join(','), '33300', '...without joining the urgent list');
  st = M.urgApply(st, 33300, false, T0 + 1);
  eq(Object.keys(st.urgent).length, 0, 'a flag taken off in the TM comes off here too');
  eq(JSON.stringify(Object.keys(st).sort()), JSON.stringify(['at', 'n', 'read', 'urgent']),
    'the store holds ids, timestamps and a flag — no subject, no body, no address');

  // unpackTicket: absent is NOT false
  const packed = [33256, 'subject', 'open', '2026-09-16', '2026-09-15', 'internal', 'client', 'a@b.c', 3, 'ok', 0, 7, 1, 2];
  eq(M.unpackTicket(packed, 'Reiss', 'Ray').urgent, null, 'with no urgency store read, a ticket reads NOT READ, never calm');
  eq(M.unpackTicket(packed, 'Reiss', 'Ray', { read: { 33256: T0 }, urgent: {} }).urgent, false,
    'read and unflagged is FALSE — a different answer from not read');
  eq(M.unpackTicket(packed, 'Reiss', 'Ray', { read: { 33256: T0 }, urgent: { 33256: 1 } }).urgent, true, 'and flagged is true');
  eq(M.unpackTicket(packed, 'Reiss', 'Ray', { read: {}, urgent: { 33256: 1 } }).urgent, null,
    'a flag with no read stamp is not trusted — the read map is what says the question was asked');

  // normTicket off a DETAIL row
  eq(M.normTicket({ ticket_id: 1, is_urgent: true }).urgent, true, 'a detail row carries the flag through normTicket');
  eq(M.normTicket({ ticket_id: 1 }).urgent, null, '...and a LIST row, which has no such field, reads not-read');
  eq(M.normTicket({ ticket_id: 1, is_urgent: false }).urgent, false, '...and an explicit false is false');
}

{
  const defs = [{ slug: 'urgent', label: 'Urgent', displaces: true }, { slug: 'agency', label: 'Agency work' }];
  const tasks = [
    { id: 1, hours: 4, bill: 4, nonbill: 0, cat: 'opt', tags: [] },
    { id: 2, hours: 2, bill: 2, nonbill: 0, cat: 'tech', tags: ['urgent'] },
    { id: 3, hours: 1, bill: 1, nonbill: 0, cat: 'acct', tags: ['agency'] },
  ];
  const tickets = [
    { id: 1, hours: 3, tasks: 2, urgent: true },
    { id: 2, hours: 5, tasks: 1, urgent: false },
    { id: 3, hours: 9, tasks: 4, urgent: null },
  ];
  const x = M.urgencyCheck(tasks, tickets, defs);
  eq(x.tag.dispHours, 2, 'the tag side is the team\'s own displacement reading, unchanged');
  eq(x.tm.n, 1, 'the TM side counts flagged tickets');
  eq(x.tm.hours, 3, '...and the hours the TM itself puts on them');
  eq(x.tm.tasks, 2, '...and says how many tasks sit under them');
  eq(x.tm.read, 2, 'coverage is the tickets READ');
  eq(x.tm.unread, 1, '...and the unread ones are named, not counted as calm');
  eq(x.tm.total, 3, '...against the whole queue');
  // 3 of (3+5) read hours = 37.5%; the unread ticket's 9h is NOT in the denominator
  eq(x.tm.pct, 37.5, 'the share is of hours on tickets actually read — an unread ticket never dilutes it');
  eq(x.tm.readHours, 8, '...and the denominator is stated');
  eq(x.joinable, false, 'the two are never reported as joinable');
  ok(x.tm.hours !== x.tag.dispHours, 'they are different numbers off different objects — that is the point');

  const none = M.urgencyCheck(tasks, [{ id: 1, hours: 3, tasks: 1, urgent: null }], defs);
  eq(none.tm.read, 0, 'nothing read yet reads as nothing read');
  eq(none.tm.pct, 0, '...and states no share rather than a fabricated 0%');
  eq(M.urgencyCheck(tasks, [], defs).tm.total, 0, 'an empty queue is empty, not urgent');
}

console.log('\n── urgent: the page twin reads it the same way');
{
  const defs = [{ slug: 'urgent', label: 'Urgent', displaces: true }];
  const tasks = [{ id: 1, hours: 4, bill: 4, nonbill: 0, cat: 'opt', tags: [] },
    { id: 2, hours: 2, bill: 2, nonbill: 0, cat: 'tech', tags: ['urgent'] }];
  const tickets = [{ id: 1, hours: 3, tasks: 2, urgent: true }, { id: 2, hours: 5, tasks: 1, urgent: false },
    { id: 3, hours: 9, tasks: 4, urgent: null }];
  const a = M.urgencyCheck(tasks, tickets, defs), b = P.urgencyCheck(tasks, tickets, defs);
  eq(JSON.stringify(b.tm), JSON.stringify(a.tm), 'the page twin and the engine agree on the TM reading');
  eq(b.tag.dispHours, a.tag.dispHours, '...and on the tag reading');
  eq(b.joinable, false, '...and both refuse to call them joinable');
  // the grammar, through the page's own matcher
  const tk = (u) => ({ id: 1, client: 'Reiss', am: 'Ray', subject: 'x', status: 'open', d: '2026-09-16',
    first: '', by: '', origin: '', from: '', age: 1, level: 'ok', idle: 0, msgs: 1, tasks: 1, hours: 1, urgent: u });
  ok(P.matchTicket(tk(true), P.parseQuery('urgent:yes')), 'the page finds a flagged ticket');
  ok(!P.matchTicket(tk(null), P.parseQuery('urgent:no')), '...and never calls an unread one calm');
  ok(P.matchTicket(tk(null), P.parseQuery('urgent:none')), '...and can ask for the unread ones');
  ok(P.matchTicket(tk(true), P.parseQuery('urgent:yes,none')), '...and a comma is OR here too');
}

console.log('\n── urgent: in the grammar, on tickets only');
{
  const tk = (u) => ({ id: 1, client: 'Reiss', am: 'Ray', subject: 'x', status: 'open', d: '2026-09-16',
    first: '', by: '', origin: '', from: '', age: 1, level: 'ok', idle: 0, msgs: 1, tasks: 1, hours: 1, urgent: u });
  const q = (t) => M.parseQuery(t);
  ok(M.matchTicket(tk(true), q('urgent:yes')), 'urgent:yes finds a flagged ticket');
  ok(!M.matchTicket(tk(false), q('urgent:yes')), '...and not a calm one');
  ok(!M.matchTicket(tk(null), q('urgent:yes')), '...and never an unread one');
  ok(M.matchTicket(tk(false), q('urgent:no')), 'urgent:no is READ AND NOT FLAGGED');
  ok(!M.matchTicket(tk(null), q('urgent:no')), '...so an unread ticket does NOT answer to it');
  ok(M.matchTicket(tk(null), q('urgent:none')), 'urgent:none is the third answer — not read yet');
  ok(!M.matchTicket(tk(true), q('urgent:none')), '...and only that');
  ok(!M.matchTicket(tk(true), q('-urgent:yes')), 'negation works');
  ok(M.matchTicket(tk(false), q('-urgent:yes')), '...without swallowing the others');
  ok(M.matchTicket(tk(true), q('urgent:yes,none')), 'a comma is still OR here');
  // and a TASK query naming it offers nothing rather than ignoring the filter
  const task = { id: 1, client: 'Reiss', market: 'GB', owner: 'Ray', am: 'Ray', title: 'x', notes: '',
    status: 'done', bucket: 'done', cat: 'opt', d: '2026-05-04', hours: 1, bill: 1, nonbill: 0, tags: [] };
  ok(!M.matchTask(task, q('urgent:yes')), 'a TASK query naming urgent returns nothing — a task has no such flag');
  ok(M.matchTask(task, q('cat:opt')), '...and an ordinary task filter is untouched');
}

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
const TICKETROWS = { 51: [tsrc(33256, 'Israel Feed Set Up', 'open', '2026-09-16'),
  tsrc(33300, 'Feed down', 'open', '2026-09-15'), tsrc(33111, 'Old thread', 'closed', '2026-08-01')] };
const URGENT = { 33300: 1 };
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
    // the ONLY place is_urgent exists — one call, one ticket (verified against the live book)
    if (name === 'get_ticket_detail') return reply(Object.assign({ ticket_id: args.ticket_id,
      is_urgent: !!URGENT[args.ticket_id], body_plain: 'a whole client email thread that must never be stored',
      to: 'someone@client.example', cc: 'another@client.example' }));
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
  /* THE URGENCY LANE, on the same firing. is_urgent lives only on get_ticket_detail — one call,
     one ticket — so it rides a rotation of its own on the queue this firing just read. */
  const det = calls.filter((c) => c.name === 'get_ticket_detail');
  ok(det.length > 0, 'the pull reads ticket detail — the only place is_urgent exists');
  eq(det.length, 3, '...once per ticket in the queue it just read');
  ok(det.every((c) => c.args.client_id === 51), '...against the TICKET client id, not the market id');
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
  eq(b.tickets.length, 3, '...and the queue');

  /* THE URGENCY LANE. is_urgent lives only on get_ticket_detail, so it rides its own rotation on
     the queue this firing just read — and what lands in KV is the flag, nothing else: the same
     call answers with the whole client email thread and the to/cc addresses, none of which may
     ever reach storage (no client contact data in KV, the rule the whole module runs on). */
  const urg = await kv.get('tmurg:Reiss', 'json');
  ok(!!urg, 'the flags are stored in their own key, beside the queue record');
  eq(Object.keys(urg.urgent).join(','), '33300', 'the one urgent ticket is the one the TM flagged');
  eq(urg.n, 3, 'and every ticket asked counts as read, flagged or not');
  const urgRaw = kv.store.get('tmurg:Reiss');
  ok(urgRaw.indexOf('body_plain') < 0 && urgRaw.indexOf('email thread') < 0,
    'NO email body reaches KV, though the same MCP answer carried one');
  ok(urgRaw.indexOf('@client.example') < 0, '...and no client address either');
  ok(urgRaw.indexOf('Feed down') < 0, '...and not even the ticket subject — the queue record already holds that');

  // the queue record itself is untouched, so the next queue pull cannot wipe the flags
  const tick = await kv.get('tmtick:Reiss', 'json');
  ok(JSON.stringify(tick).indexOf('urgent') < 0, 'the flag is NOT folded into the queue record');
  const merged = M.assembleBook([await kv.get('tmbook:Reiss', 'json')],
    [Object.assign({ client: 'Reiss' }, tick, { urg })], idx.accounts, NOW);
  const byId = {}; merged.tickets.forEach((t) => { byId[t.id] = t; });
  eq(byId[33300].urgent, true, '...and merged back on READ');
  eq(byId[33256].urgent, false, '...with a read-and-calm ticket reading false');

  // the firing above ran with queues:0 — the urgency lane rides the queue a firing actually
  // reads, so it correctly spent nothing
  eq(calls.filter((c) => c.name === 'get_ticket_detail').length, 0,
    'a firing that reads no ticket queue reads no ticket detail either');

  // and a firing that DOES read the queue again re-reads no flag it already has
  calls = [];
  await W.tmBookPull(envOf({ EDITS: kv, TM_MCP_TOKEN: TOKEN }), { now: NOW + 60000, pulls: 0, queues: 1 });
  eq(calls.filter((c) => c.name === 'get_ticket_detail').length, 0,
    'nor does it re-read a flag it already has — the budget goes to tickets nobody has asked about');
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
// DECIMAL ALIGNMENT in stacked hour columns (Ray, 17 Sep 2026: "why these numbers are not
// aligned vertically, you kept making this issue btw"). Right-aligning "1" and "0.5" in the
// same column only lines up their LAST character, not the ones digit — "1" sits two characters
// short of where "1.00" would put it, so a column reads crooked even though every cell is
// individually right-aligned correctly. hrsCell() fixes every value to the quarter-hour grain
// the data is actually booked in (.00/.25/.50/.75), so every value in a table column is the
// same width and the decimal points line up.
// ---------------------------------------------------------------------------------------------
console.log('── decimal alignment: every stacked hours column uses hrsCell, not hrs');
const hrsCellSrc = /^  function hrsCell\([^)]*\) \{.*\}$/m.exec(page);
if (!hrsCellSrc) throw new Error('page: hrsCell (one-liner) not found');
const HC = new Function('return (' + hrsCellSrc[0].replace(/^  function/, 'function') + ')')();
eq(HC(0.5), '0.50', 'a half hour is fixed to two decimals');
eq(HC(1), '1.00', 'a whole hour gets its decimals too — this is exactly what the bare "1" was missing');
eq(HC(1.25), '1.25', 'quarter-hour values are unaffected — they already carried two decimals');
eq(HC(13.5), '13.50', 'a footer sum is fixed the same way as the rows above it');
{
  // every td.num cell that prints an hrs()-style figure inside a table (Tasks / the ⊞ breakdown
  // table / Tickets / Accounts / the totals footer) must call hrsCell, or the fix regresses one
  // column at a time exactly the way Ray flagged it happening
  const numCellHrs = [...page.matchAll(/<td class="num[^"]*"[^>]*>[^<]*?\bhrs\(/g)];
  eq(numCellHrs.length, 0, 'no table cell calls the bare hrs() formatter — every stacked column uses hrsCell');
  ok((page.match(/hrsCell\(/g) || []).length >= 12,
    'hrsCell is actually wired into every stacked hours column (tasks, breakdown table x2, tickets, accounts, the totals footer)');
}

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

console.log('\n── urgent: on the page');
{
  // liftArr hands back the DECLARATION, so it is evaluated rather than trusted as text
  const cols = new Function(liftArr('TK_COLS') + '\nreturn TK_COLS;')();
  ok(cols.some((c) => c.k === 'urgent'), 'the Tickets tab carries an Urgent column');
  ok(/urgCell\(t\)/.test(PAGE_SRC), '...rendered by urgCell, which knows three states');
  const cell = liftPageSrc('urgCell');
  const fn = new Function(cell + '\nreturn urgCell;')();
  ok(/not read/i.test(fn({ urgent: null })), 'an unread ticket SAYS it has not been read');
  ok(/urgent/i.test(fn({ urgent: true })), 'a flagged one says urgent');
  ok(!/urgent/i.test(fn({ urgent: false }).replace(/title="[^"]*"/g, '')),
    'and a read-and-calm one claims nothing');
  // the footer still resolves by key, so inserting a column cannot misalign the totals
  ok(/function colIdx\(/.test(PAGE_SRC), 'the totals row still resolves its columns BY KEY');
  const hrsIdx = cols.map((c) => c.k).indexOf('hours');
  eq(hrsIdx, cols.length - 1, '...and the hour total is still the last column');
  // the cross-check band
  ok(/id="dpxchk"/.test(PAGE_SRC), 'the hours card carries the cross-check band');
  ok(/urgencyCheck\(FT, FK, DEFS\(\)\)/.test(PAGE_SRC), '...fed by the same search the card reads');
  ok(/two readings, not one figure/i.test(PAGE_SRC),
    '...and says in words that the two are not one number');
  ok(/no ticket id on a task row/i.test(PAGE_SRC), '...and why: the join does not exist in this feed');
  ok(/data-ins="urgent:yes"/.test(PAGE_SRC), 'urgent: is offered in the search hints');
}

// the column arrays are `var NAME = [ … ];` — lifted whole so the footer tests read the SAME
// list the table's own header does
function liftArr(name) {
  const re = new RegExp('^  var ' + name + ' = \\[', 'm');
  const m = re.exec(PG);
  if (!m) throw new Error('page: ' + name + ' array not found');
  const end = PG.indexOf('];', m.index);
  if (end < 0) throw new Error(name + ': no end');
  return PG.slice(m.index, end + 2);
}
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
const PANE = new Function('CAT_LABEL', 'num', 'hrs', 'hrsCell', 'esc', 'SHOW',
  'var PQ = "", PQT = [], QCOMMA = "\\u0000";\n'
  + liftPageSrc('mergeCommaRuns') + '\n' + liftPageSrc('splitAlts') + '\n'
  + liftPageSrc('orTerms') + '\n' + liftPageSrc('setPQ') + '\n'
  + liftPageSrc('pqHay') + '\n' + liftPageSrc('pqMatch') + '\n'
  + liftArr('TASK_COLS') + '\n' + liftArr('TK_COLS') + '\n' + liftArr('AC_COLS') + '\n'
  + liftPageSrc('FOOT') + '\n' + liftPageSrc('colIdx') + '\n' + liftPageSrc('footHtml') + '\n'
  + 'return { setPQ: setPQ, pqMatch: pqMatch, footHtml: footHtml, FOOT: FOOT, colIdx: colIdx,'
  + ' COLS: { tasks: TASK_COLS, tickets: TK_COLS, accounts: AC_COLS } };'
)(M.CAT_LABEL,
  (n) => String(n),
  (n) => String(Math.round((Number(n) || 0) * 100) / 100),
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
const capped = PANE.footHtml('tasks', many, PANE.COLS.tasks, true);
ok(capped.indexOf('>275<') >= 0, 'the TOTAL column sums all 220 rows (275 h), not the 200 painted');
ok(capped.indexOf('>220<') >= 0 && capped.indexOf('>55<') >= 0,
  'billable (220 h) and non-billable (55 h) are totalled SEPARATELY and never merged');
ok(/totalled in full, not just the 200 shown/.test(capped),
  'and the row says so, because a total beside a shorter list is otherwise ambiguous');
ok(!/totalled in full/.test(PANE.footHtml('tasks', many.slice(0, 10), PANE.COLS.tasks, false)),
  'an uncapped list does not carry that caveat');
eq(PANE.footHtml('tasks', [], PANE.COLS.tasks, false), '',
  'no rows means no totals row at all — a row of zeroes would read as a finding');

PANE.setPQ('gmc');
ok(/matching/.test(PANE.footHtml('tasks', many.slice(0, 4), PANE.COLS.tasks, false)),
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

// ---------------------------------------------------------------------------------------------
// MASS TAGGING ACTS ON THE ROWS ON SCREEN (Ray, 17 Sep 2026: "this button Tag all: > should only
// tag the filtered row instead of all rows"). There are TWO filters on this page and the bulk bar
// read the top one, so a pane search narrowed to 12 rows offered — and would have written — 660.
// The functions are lifted REAL, with the real tag store, so what is asserted is the row set the
// button actually writes to, not a re-implementation of it.
// ---------------------------------------------------------------------------------------------
console.log('\n── mass tagging: the bulk bar writes to exactly what is painted');
function liftLine(name) {
  const re = new RegExp('^  function ' + name + '\\([^)]*\\) \\{.*\\}$', 'm');
  const m = re.exec(PG);
  if (!m) throw new Error('page: ' + name + ' (one-liner) not found');
  return m[0];
}
const BAR = { hidden: true, innerHTML: '' };
const SEEN = { saves: 0, toasts: [], undo: null };
const TAGDEFS = [{ slug: 'urgent', label: 'Urgent', color: '#B42318', displaces: true },
  { slug: 'agency', label: 'Agency work', color: '#2563EB', displaces: false }];
const BULK = new Function('CAT_LABEL', 'sortRows', 'SORT', 'tagSave', 'toast', 'toastAct', 'defOf',
  'DEFS', 'tagColor', 'esc', 'num', 'hrs', '$',
  'var PQ = "", PQT = [], QCOMMA = "\\u0000", ME = "tester";\n'
  + 'var TAB = "tasks", FT = [], FK = [], ACCOUNTS = [], TAGS = {}, Q = { raw: "" };\n'
  + liftPageSrc('mergeCommaRuns') + '\n' + liftPageSrc('splitAlts') + '\n'
  + liftPageSrc('orTerms') + '\n' + liftPageSrc('setPQ') + '\n'
  + liftPageSrc('pqHay') + '\n' + liftPageSrc('pqMatch') + '\n'
  + liftPageSrc('paneRows') + '\n'
  + liftLine('taggable') + '\n' + liftPageSrc('setTags') + '\n' + liftLine('clearTags') + '\n'
  + liftLine('bulkSrc') + '\n' + liftPageSrc('bulkRender') + '\n'
  + liftPageSrc('bulkSnapshot') + '\n' + liftPageSrc('bulkUndo') + '\n' + liftPageSrc('bulkApply') + '\n'
  + 'return { setPQ: setPQ, bulkSrc: bulkSrc, bulkRender: bulkRender, bulkApply: bulkApply,'
  + ' tags: function () { return TAGS; },'
  + ' set: function (o) {'
  + '   if (o.TAB !== undefined) TAB = o.TAB;'
  + '   if (o.FT) FT = o.FT;'
  + '   if (o.q !== undefined) Q = { raw: o.q };'
  + '   if (o.TAGS) TAGS = o.TAGS; } };'
)(
  M.CAT_LABEL,
  (rows) => rows,
  { tasks: { k: 'd', dir: -1 }, tickets: { k: 'd', dir: -1 }, accounts: { k: 'c', dir: 1 } },
  () => { SEEN.saves++; },
  (m) => SEEN.toasts.push(m),
  (m, label, fn) => { SEEN.toasts.push(m); SEEN.undo = fn; },
  (slug) => TAGDEFS.filter((d) => d.slug === slug)[0] || { slug, label: slug },
  () => TAGDEFS,
  (d) => d.color,
  (x) => String(x == null ? '' : x),
  (n) => String(n),
  (n) => String(Math.round((Number(n) || 0) * 100) / 100),
  () => BAR
);

const brow = (o) => Object.assign({ id: 0, title: '', client: 'Reiss', market: 'GB', owner: 'Febin',
  am: 'Ray', status: 'Done', note: '', cat: 'opt', hours: 1, tags: [] }, o);
const BROWS = [];
for (let i = 1; i <= 12; i++) BROWS.push(brow({ id: i, title: 'GMC disapproval fix ' + i }));
for (let i = 13; i <= 60; i++) BROWS.push(brow({ id: i, title: 'Keyword optimisation ' + i }));

BULK.set({ TAB: 'tasks', FT: BROWS, q: 'client:reiss', TAGS: {} });
BULK.setPQ('gmc');
eq(BULK.bulkSrc().length, 12,
  'the bulk action reads the rows the TABLE is showing (12), not the grammar bar\'s 60');
eq(BULK.bulkSrc().map((t) => t.id).slice(0, 3), [1, 2, 3], 'and they are the matching rows themselves');
BULK.bulkRender();
ok(!BAR.hidden && /<b>12<\/b>/.test(BAR.innerHTML),
  'the bar states 12 — the count and the write can never be two different row sets');
ok(/matching/.test(BAR.innerHTML) && /gmc/.test(BAR.innerHTML),
  'and NAMES the filter that produced it: "660 rows in this search" beside a table showing 12 is '
  + 'how the wrong row set went unnoticed');
ok(/Tag these rows/.test(BAR.innerHTML) && !/Tag all/.test(BAR.innerHTML),
  'the label no longer says "Tag all" — the words were part of the promise it broke');

BULK.bulkApply('urgent');
eq(Object.keys(BULK.tags()).length, 12, 'applying it writes 12 records, not 60');
ok(Object.keys(BULK.tags()).every((k) => Number(k) <= 12), 'and only the rows that matched');
eq(SEEN.saves, 1, 'one save for the batch');

ok(typeof SEEN.undo === 'function', 'a bulk write to the team\'s shared state offers an undo');
SEEN.undo();
eq(Object.keys(BULK.tags()).length, 0,
  'which puts back exactly what was there — an absent record is restored as ABSENT, never as an '
  + 'empty list, which would record a judgement nobody made');

// row 5 already carries a person's judgement — the record AND the decorated row, exactly as
// decorateTags hands it to the render
BROWS[4].tags = ['agency'];
BULK.set({ TAGS: { 5: { client: 'Reiss', tags: ['agency'], by: 'ray', at: 1 } } });
BULK.bulkApply('urgent');
eq(BULK.tags()['5'].tags, ['agency', 'urgent'], 'a bulk tag ADDS to what a person already set');
SEEN.undo();
eq(BULK.tags()['5'].tags, ['agency'], 'and the undo restores their record rather than clearing it');
eq(Object.keys(BULK.tags()), ['5'], 'leaving the rows that had nothing with nothing');

BULK.setPQ('');
eq(BULK.bulkSrc().length, 60, 'with no pane filter it is the grammar bar\'s result, as before');
BULK.bulkRender();
ok(!BAR.hidden && / in this search/.test(BAR.innerHTML), 'and the wording says so');

BULK.set({ q: '' });
BULK.setPQ('gmc');
BULK.bulkRender();
ok(!BAR.hidden && /<b>12<\/b>/.test(BAR.innerHTML),
  'a PANE-ONLY filter shows the bar — Ray\'s own case, where keying on the top bar alone showed '
  + 'nothing at all');
BULK.setPQ('');
BULK.bulkRender();
ok(BAR.hidden, 'and with neither filter set there is nothing to bulk-tag, so no bar');

BULK.set({ TAB: 'tickets', q: 'client:reiss' });
BULK.setPQ('gmc');
eq(BULK.bulkSrc().length, 0, 'off the Tasks tab there are no taggable rows on screen');
BULK.bulkRender();
ok(BAR.hidden, 'so the bar is not offered there at all');

ok(/function pane\(\)[\s\S]{0,400}bulkRender\(\);/.test(PG),
  'pane() refreshes the bar — a tab switch or a change to the pane filter never reaches apply()');
const BULKSRC = PG.slice(PG.indexOf('function bulkSrc'), PG.indexOf('function rulesOpen'));
ok(!/FT\.filter\(taggable\)/.test(BULKSRC),
  'and nothing in the bulk block reads FT directly any more — one row resolver, paneRows');

// ---------------------------------------------------------------------------------------------
// THE TAGS & RULES PANEL, REORGANISED (Ray, 17 Sep 2026: "love this, reorganise and make the tab
// cleaner pls"). Two columns, one line per row, and the labels that were repeated on every row
// promoted to column headings. The assertions that matter are the CLASS COLLISION (the table
// already owns .tg-add and .tg-cell — inheriting the latter's 210px cap is what wrapped every
// rule onto two lines) and that nothing was quietly dropped on the way.
// ---------------------------------------------------------------------------------------------
console.log('\n── the Tags & rules panel');
const PANEL = PG.slice(PG.indexOf("var TG_KEY = 'fcc-tg-rail'"), PG.indexOf('var TAG_COLORS = TAG_PAL'));
ok(PANEL.length > 1000, 'the panel builder is where it was');

ok(!/class="tg-(add|cell|grid|cols|sec|hint|k|n|ln|nm|note|empty|tags|rules|src|w)"/.test(PANEL)
  && !/class="tg-\w+ /.test(PANEL),
  'every class the panel paints is tgd-, never tg- — the TABLE owns .tg-add (the row\'s "+ tag" '
  + 'pill) and .tg-cell (capped at 210px), and borrowing those names styled the panel as pills '
  + 'and wrapped every rule onto two lines');
ok(/#tgbd \.tgd-cols\{display:grid;grid-template-columns:minmax\(0,1fr\)/.test(PG)
  && /@container \(min-width:560px\)\{#tgbd \.tgd-cols\{grid-template-columns:minmax\(0,1fr\) minmax/.test(PG),
  'tags and rules go side by side on the PANEL\'s own width, not the window\'s — it lives in a rail, '
  + 'and a viewport media query would have put two 200px columns inside a 420px rail on a wide monitor');
ok(/#tgbd \.bd-b\{[\s\S]{0,160}container-type:inline-size/.test(PG),
  'which is only true because the panel body declares itself the container');
ok(/#tgbd \.tgd-add select\{min-width:0;max-width:100%\}/.test(PG),
  'a select sizes to its widest OPTION unless told not to — 99px of sideways overflow on a phone');

eq((PANEL.match(/displaces the plan<\/label>/g) || []).length, 0,
  'the words "displaces the plan" are no longer printed once per tag');
ok(/class="tgd-k">Displaces</.test(PANEL), 'they are the column heading, said once');
ok(/aria-label="' \+ esc\(d\.label\) \+ ' displaces the plan"/.test(PANEL),
  'but each checkbox keeps its own accessible name — a column heading is not read out per row');
ok(/class="tgd-k">Matches<\/div><div class="tgd-k">By hand</.test(PANEL),
  'the two rule counts became headed columns, so the numbers line up and can be compared');
ok(/tgd-n" title="Already tagged by a person/.test(PANEL),
  'and "set by hand, untouched" survives as the column\'s tooltip rather than prose on every row');
ok(/pv\.held \? num\(pv\.held\) : '—'/.test(PANEL), 'a rule holding nothing back reads — , not 0');

ok(/<select id="tg-sugg" class="tgd-src">/.test(PANEL) && /Start from a common title/.test(PANEL),
  'the twelve common titles are the rule builder\'s own source list, not a wall of chips below it');
ok(/tot\.slice\(0, 12\)/.test(PANEL), 'all twelve are still offered — nothing was dropped to save room');
ok(/x\.n\) \+ ' tasks · ' \+ hrs\(x\.h\)/.test(PANEL), 'each still carries its task count and hours');
ok(/el\.selectedIndex = 0;/.test(PANEL), 'picking one fills the word box and resets: it is a source list, not a setting');
ok(/\$\('tg-q'\)\.value = String\(el\.value\)\.replace\(\/:\$\/, ''\);/.test(PANEL),
  'and it fills the box rather than creating a rule, so the preview is seen before anything is saved');
ok(!/data-sugg/.test(PANEL), 'the old chip handler went with the chips — no dead branch left behind');

ok(/id="tg-list"/.test(PANEL) && /id="tg-rules"/.test(PANEL) && /id="tg-new"/.test(PANEL)
  && /id="tg-addtag"/.test(PANEL) && /id="tg-q"/.test(PANEL) && /id="tg-on"/.test(PANEL)
  && /id="tg-tag"/.test(PANEL) && /id="tg-addrule"/.test(PANEL) && /id="tg-prev"/.test(PANEL),
  'every control the panel had is still there — this was a reorganisation, not a cut');

// ---------------------------------------------------------------------------------------------
// ...AND IT IS A RAIL, NOT A MODAL (Ray, 17 Sep 2026: "can it also popup as on the right panel
// similar to build log so i can also work simultaneously"). Simultaneously is the requirement, so
// the assertions are about what the panel does NOT do: dim the page, block it, or cover the
// columns being judged.
// ---------------------------------------------------------------------------------------------
console.log('\n── the panel as a right-hand rail');
ok(!/bd-dim/.test(PANEL) && !/#tgbd \.bd-dim/.test(PG),
  'no dim layer anywhere — the board behind the rail stays live, which is the whole request');
ok(/#tgbd \.bd-box\{position:fixed;z-index:70;top:0;right:0;bottom:0;width:var\(--tgd-w\)/.test(PG),
  'the panel is docked to the right edge, full height');
ok(/body\.tgd-on\{padding-right:var\(--tgd-w\)\}/.test(PG),
  'and it PUSHES the page rather than sitting on it — the columns it would otherwise cover on this '
  + 'page are the hours, which is the thing being judged while you tag');
ok(/max-width:900px\)\{[\s\S]{0,220}body\.tgd-on\{padding-right:0\}/.test(PG),
  'below 900px there is no room to push, so it overlays');
ok(/max-width:760px\)\{#tgbd \.bd-box\{width:100vw/.test(PG), 'and on a phone it is a full sheet');

ok(/if \(!host\.querySelector\('\.bd-box'\)\) \{/.test(PANEL) && /\$\('tg-body'\)\.innerHTML = ''/.test(PANEL),
  'the shell is built once and only the body is redrawn — rewriting the host on every edit would '
  + 'restart the slide-in, so adding a rule would make the rail flinch');
ok(/function rulesToggle\(\)/.test(PANEL) && /dt\.onclick = rulesToggle;/.test(PG),
  'the toolbar button toggles it, because a rail you cannot put away is worse than a modal');
ok(/aria-pressed/.test(PANEL), 'and says whether it is open');
ok(/role="complementary"/.test(PANEL) && !/role="dialog"/.test(PANEL),
  'the rail is a landmark, not a dialog: it sits beside the work rather than trapping focus in '
  + 'front of it, and "dialog" would tell a screen-reader user the opposite');
ok(/e\.key === 'Escape' && tgIsOpen\(\)\) rulesClose\(\)/.test(PANEL), 'Esc closes it');
ok(!/bd-dim'\) \{ host\.innerHTML/.test(PANEL) && !/className === 'bd-dim'/.test(PANEL),
  'clicking the page does NOT close it: on a modal that is how you dismiss it, here clicking away '
  + 'is the work');
ok(/localStorage\.setItem\(TG_KEY/.test(PANEL) && /var TG_KEY = 'fcc-tg-rail'/.test(PANEL),
  'the open state is remembered per DEVICE — a panel being open describes one screen, not the team');
ok(/if \(want === '1'\) rulesOpen\(\);/.test(PG) && PG.indexOf("if (want === '1') rulesOpen();") > PG.indexOf('tagLoad(function () {'),
  'and it reopens AFTER the tags land, so it never paints an empty vocabulary and then fills itself in');
ok(/setTimeout\(function \(\) \{ if \(!tgIsOpen\(\)\) host\.innerHTML = ''; \}, 260\)/.test(PANEL),
  'closing clears the host only once it has slid out, and only if nobody re-opened it meanwhile');

// ---------------------------------------------------------------------------------------------
// MORE FORMS (Ray, 17 Sep 2026: "Can you allow more different types of charts? I like pie charts,
// donut charts, and line charts. What I want to see is merge the lines together and dissect them
// more easily side by side"). The line's cross-tab is engine work and is asserted as such; the
// forms matrix and the colour rules are asserted on the page that draws them.
// ---------------------------------------------------------------------------------------------
console.log('\n── the line form: month × category, in the engine and on the page');
const LR = (d, h, nb, client, cat) => ({
  d, client, market: 'GB', am: 'Ray', owner: 'Febin', title: 't', status: 'done',
  cat: cat || 'opt', bucket: 'done', bill: h, nonbill: nb || 0, hours: h + (nb || 0), id: 1, tags: [],
});
const LROWS = [
  LR('2026-01-10', 4, 1, 'Reiss'), LR('2026-01-20', 2, 0, 'Reiss'),
  LR('2026-03-05', 6, 2, 'Reiss'),                       // February is a HOLE for Reiss
  LR('2026-02-14', 3, 0, 'Schuh'), LR('2026-03-02', 1, 0, 'Schuh'),
  LR('0000-00-00', 9, 9, 'Reiss'), LR('', 5, 0, 'Schuh'), // undated, both shapes
];
for (const impl of [['engine', M], ['page', P]]) {
  const [who, mod] = impl;
  const sm = mod.seriesByMonth(LROWS, 'client', 6);
  eq(sm.months, ['2026-01', '2026-02', '2026-03'], `${who}: the months are the whole view's, in order`);
  eq(sm.undated, 2, `${who}: undated rows are counted back, never plotted`);
  eq(sm.series.map((x) => x.k), ['Reiss', 'Schuh'], `${who}: series read biggest-first`);
  const reiss = sm.series[0];
  eq(reiss.points.map((p) => p.hours), [7, 0, 8],
    `${who}: a month a series MISSED is a ZERO, not a gap — two lines with different gaps would `
    + 'otherwise read as the same shape at different speeds');
  eq(reiss.points.map((p) => p.m), ['2026-01', '2026-02', '2026-03'], `${who}: every series is read against the same x`);
  eq(reiss.hours, 15, `${who}: the series total is its plotted hours`);
  eq([reiss.points[0].bill, reiss.points[0].nonbill], [6, 1],
    `${who}: every point keeps its own billable split — the colour stops carrying it, the number never does`);
  eq(mod.monthOf('0000-00-00'), '', `${who}: 0000-00-00 is undated, not a month called "0000-00"`);
  eq(mod.monthOf('2026-04-01'), '2026-04', `${who}: and a real date still reads as its month`);
}

// the fold, so the lines stay readable and the total still reconciles
const MANY = [];
for (let i = 0; i < 9; i++) MANY.push(LR('2026-01-0' + ((i % 8) + 1), 9 - i, 0, 'C' + i));
const lineCap = M.seriesByMonth(MANY, 'client', 4);
eq(lineCap.series.length, 4, 'past the cap the tail folds into ONE line');
eq(lineCap.folded, 6, 'and says how many it folded');
ok(/^Other \(6 more\)$/.test(lineCap.series[3].k), 'named for what it is');
eq(lineCap.series.reduce((a, x) => a + x.hours, 0), MANY.reduce((a, r) => a + r.hours, 0),
  'the folded line keeps its hours, so a total read off the lines matches the book');
eq(P.seriesByMonth(MANY, 'client', 4).series.map((x) => [x.k, x.hours]),
  lineCap.series.map((x) => [x.k, x.hours]), 'the page folds identically');

const TAGROWS = [
  Object.assign(LR('2026-01-02', 2, 0, 'Reiss'), { tags: ['urgent', 'technical'] }),
  Object.assign(LR('2026-01-03', 1, 0, 'Reiss'), { tags: [] }),
];
const tagSm = M.seriesByMonth(TAGROWS, 'tag', 6);
ok(tagSm.multi, 'a task with several tags lands on several lines, and the record says so');
eq(tagSm.series.reduce((a, x) => a + x.hours, 0), 5,
  'so those lines legitimately sum to more than the book — stated, never silently drawn');

console.log('\n── which form each split can honestly carry');
ok(/var FORMS = \[/.test(PAGE_SRC) && /\{ v: 'pie', label: 'Pie' \}/.test(PAGE_SRC)
  && /\{ v: 'line', label: 'Line over months' \}/.test(PAGE_SRC)
  && /\{ v: 'small', label: 'Side by side' \}/.test(PAGE_SRC),
  'pie, line and side-by-side joined donut, columns and bars');
ok(/if \(nested\(\)\) return \['nest', 'small'\];/.test(PAGE_SRC),
  'a nested split reads as the indented breakdown OR side by side — nothing else can show three '
  + 'levels honestly');
ok(/if \(CDIM === 'total'\) return \['donut', 'line'\];/.test(PAGE_SRC),
  'and "Everything" has nothing to divide into slices, so it keeps the donut and gains the line');
ok(/return \['stack', 'pct', 'bars', 'donut', 'pie', 'line', 'small'\];/.test(PAGE_SRC),
  'every other split offers all seven');
ok(/fs\.innerHTML = FORMS\.filter/.test(PAGE_SRC) && /if \(allow\.indexOf\(CFORM\) < 0\) CFORM = allow\[0\]/.test(PAGE_SRC),
  'the selector is REBUILT from what applies rather than greyed out over a stale label');
ok(!/fs\.disabled = true/.test(PAGE_SRC), 'so no form ever sits disabled while naming something else');

ok(/function byIdentity\(\)/.test(PAGE_SRC),
  'the page knows which forms colour by identity and which keep billable vs non-billable');
ok(/var ident = byIdentity\(\), sw = function/.test(PAGE_SRC)
  && /hd\('Billable', showBill\(\), cvar\('--bil'\), s\.bill, s\.billPct\)/.test(PAGE_SRC)
  && /return '<div class="lg-row hd"[\s\S]{0,400}\(ident \? '' : \(on \? sw\(col\)/.test(PAGE_SRC),
  'when colour carries identity the swatches move to the categories and the two figures stay as '
  + 'plain rows — the split is never dropped, it just stops being the colour');
ok(/Colour \\u00b7 /.test(PAGE_SRC) || /Colour · /.test(PAGE_SRC),
  'and the legend names the encoding out loud');

const SMALL = PAGE_SRC.slice(PAGE_SRC.indexOf('function smallCells'), PAGE_SRC.indexOf('function niceMax'));
ok(/COLOUR FOLLOWS THE CHILD, NEVER ITS RANK INSIDE ITS PARENT/.test(SMALL)
  && /top\.forEach\(function \(k, i\) \{ col\[k\] = keyColour\(CDIM2, k, i, false\);/.test(SMALL),
  'side by side ranks the children ONCE across the whole tree: colouring each ring by position '
  + 'would make Reiss blue in one donut and Superdry blue in the next');
ok(/parts\.sort\(function \(a, b\) \{ return a\.rank - b\.rank; \}\)/.test(SMALL),
  'and every ring reads its slices in the same order, so the eye compares like with like');
ok(/var SER_PAL = \['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'\]/.test(PAGE_SRC),
  'the categorical palette is the repo\'s validated set in the Deck Generator\'s order — one rank, '
  + 'one colour, across the FCC');
ok(/SER_OTHER = \{ light: '#9aa3ad', dark: '#6b7482' \}/.test(PAGE_SRC),
  'and a fold is grey, because a remainder is not a category and should not be in the race');

ok(/if \(sm && CFORM === 'line'\)/.test(PAGE_SRC) && /a line chart's table is the CROSS-TAB/.test(PAGE_SRC),
  'the table under a line chart is the cross-tab it was drawn from, not the split\'s totals');
ok(/if \(CFORM === 'line'\) \{\n      var sm = lineData\(\);/.test(PAGE_SRC),
  'and so is the copied / exported one');
ok(/cannot sit on a time axis and is/.test(PAGE_SRC) && /cannot sit on a time axis and are/.test(PAGE_SRC),
  'the verdict names the undated rows the line could not plot, in the right number');

// ---------------------------------------------------------------------------------------------
// ONE COLOUR PER THING, EVERYWHERE (Ray, 17 Sep 2026: "Make sure legend colors are consistent
// across sections of the task manager—for example, urgent in green versus urgent in red—and allow
// an option to show the legend directly on the chart as well, so I don't have to do side by side.
// Anything untagged could be a dotted line, dimmed and slightly more hidden").
// ---------------------------------------------------------------------------------------------
console.log('\n── colour follows the thing, not its rank');
ok(/function keyColour\(dim, k, rank, fold\)/.test(PAGE_SRC),
  'one resolver decides every mark\'s colour');
ok(/if \(dim === 'tag'\) \{[\s\S]{0,220}return d && d\.color \? tagColor\(d\) : serCol\(rank, false\);/.test(PAGE_SRC),
  'a TAG wears the colour its vocabulary gives it — the same red the displacement card paints, '
  + 'which is exactly the "urgent in green versus urgent in red" Ray was reading');
ok(/var CAT_VAR = \{ opt: '--c-opt'/.test(PAGE_SRC) && /if \(dim === 'cat'\) return cvar\(CAT_VAR\[k\]/.test(PAGE_SRC),
  'and a TYPE OF WORK wears the token its chip in the table already uses');
ok(/if \(fold\) return serCol\(0, true\);/.test(PAGE_SRC),
  'a fold is always the same grey — a remainder is not a category and does not join the race');
ok(/return serCol\(rank, false\);\n  \}/.test(PAGE_SRC),
  'a client, an owner, a market have no colour of their own, so those keep the rank palette');

ok(/function keyLabel\(dim, k\)/.test(PAGE_SRC) && /if \(isUntag\(k\)\) return 'Not yet tagged';/.test(PAGE_SRC)
  && /return \(d && d\.label\) \|\| k;/.test(PAGE_SRC),
  'a tag reads as its NAME, not its slug — "urgent" under a card saying "Urgent" is the same '
  + 'inconsistency in words that the rank palette was in colour');
ok(/function dimLabel\(k\) \{ return keyLabel\(CDIM, k\); \}/.test(PAGE_SRC)
  && /function nodeLabel\(k, dim\) \{ return keyLabel\(dim, k\); \}/.test(PAGE_SRC),
  'and the flat and nested readings share that one definition');

console.log('\n── untagged is drawn as the gap it is');
ok(/var UNTAG = '\(untagged\)'/.test(PAGE_SRC) && /function isUntag\(k\)/.test(PAGE_SRC),
  'the untagged bucket is named once');
ok(/function untagDefs\(\)[\s\S]{0,400}pattern id="tmUntag"/.test(PAGE_SRC),
  'it fills with a dotted pattern rather than a hue');
ok(/function fillFor\(dim, k, rank, fold\) \{\n    return \(dim === 'tag' && isUntag\(k\)\) \? 'url\(#tmUntag\)'/.test(PAGE_SRC),
  'which every ring and slice reads through one call');
ok(/the untagged line is DASHED and recessive/.test(PAGE_SRC)
  && /\(untag \? ' stroke-dasharray="5 4" opacity="\.6"' : ''\)/.test(PAGE_SRC),
  'and on the time chart it is a DASHED, dimmed line — Ray\'s own words');
ok(/border:1px dotted/.test(PAGE_SRC) && /opacity:\.62/.test(PAGE_SRC),
  'the legend row is dotted and dimmed to match');
ok(!/if \(isUntag\(k\)\) return[^;]*serCol/.test(PAGE_SRC),
  'it never takes a palette slot');
ok(/keeps its true size/.test(PAGE_SRC),
  'but it keeps its true SIZE — shrinking the part nobody has judged would be the dishonest kind '
  + 'of hiding');

console.log('\n── the legend, on the chart');
ok(/id="cleg" checked> Legend on chart/.test(PAGE_SRC), 'a toggle, default on');
ok(/function legendRows\(items, W\)/.test(PAGE_SRC) && /function legendOn\(\)/.test(PAGE_SRC),
  'drawn INSIDE the svg');
ok(/the ⬇ PNG\n     carries it/.test(PAGE_SRC) || /it rides the PNG export too/.test(PAGE_SRC),
  'which is also how the PNG export stopped being a set of unnamed wedges');
ok(/localStorage\.setItem\('fcc-tm-cleg'/.test(PAGE_SRC),
  'remembered per DEVICE, like the theme — it describes one screen');
ok(/function chartKeys\(sm\)/.test(PAGE_SRC) && /rows = chartKeys\(sm\) \|\| \[\];/.test(PAGE_SRC),
  'and ONE list feeds both legends, so the rail and the chart can never name the same colour '
  + 'differently');
ok(/ser\.length <= 4 && sr\.points\.length && !legendOn\(\)/.test(PAGE_SRC),
  'the end-of-line labels stand down when the legend is already on the chart — the same names '
  + 'twice is clutter');
ok(/if \(ends\[i\]\.y - ends\[i - 1\]\.y < 13\) ends\[i\]\.y = ends\[i - 1\]\.y \+ 13;/.test(PAGE_SRC),
  'and when they are drawn, two lines finishing together are pushed apart rather than printed '
  + 'one over the other');

console.log('\n── the account\'s own type, as a split');
eq(M.DIMS.map((d) => d.k), P.DIMS.map((d) => d.k), 'engine and page offer the same dimensions');
ok(M.DIMS.some((d) => d.k === 'atype' && d.label === 'Account type'),
  'Account type joins the split list (Ray, 17 Sep 2026: "add \"type\" in the SPLIT BY too")');
ok(M.DIMS.some((d) => d.k === 'cat' && d.label === 'Type of work'),
  'beside Type of work, which is a different question: what the JOB was, read off its title');
ok(/function decorateAccountType\(\)/.test(PAGE_SRC),
  'a task carries no account type, so it is joined on from the accounts the page already read');
ok(/byClient\[a\.client\] = null;   \/\/ the brand disagrees with itself/.test(PAGE_SRC),
  'and a brand whose markets disagree falls back to "(not set)" rather than picking one of them');
ok(/t\.atype = byMkt\[t\.client \+ '\|' \+ t\.market\] \|\| byClient\[t\.client\] \|\| '\(not set\)';/.test(PAGE_SRC),
  'exact market first, then the brand, then an honest blank');
// dimKey falls through to the decorated field, so nothing in the engine had to learn about it
eq(M.groupBy([{ atype: 'FM', bill: 2, nonbill: 0, hours: 2, tags: [] },
  { atype: '', bill: 1, nonbill: 0, hours: 1, tags: [] }], 'atype').map((g) => g.k),
  ['FM', '(none)'], 'and the engine groups it like any other field');

console.log('\n── Not yet tagged, left out of a tag split (Ray, 17 Sep 2026: "btw [Not yet tagged] can be excluded from showing when dissect by Tag")');
// the predicate and the population are lifted out of the page by name and run for real
const UT = new Function('$', 'FT', 'CDIM', 'CDIM2', 'CDIM3',
  'function r2(n){return Math.round(n*100)/100}\n'
  + liftPageSrc('tagged') + '\n' + liftPageSrc('tagDim') + '\n' + liftPageSrc('hideUntag') + '\n'
  + 'var POP_SRC = null, POP_FLAG = null, POP_OUT = null;\n'
  + liftPageSrc('chartPop') + '\n' + liftPageSrc('untagLeft') + '\n'
  + 'return { tagged: tagged, tagDim: tagDim, hideUntag: hideUntag, chartPop: chartPop, untagLeft: untagLeft };');
const utrun = (rows, dims, checked) => UT(
  (id) => (id === 'cuntag' ? { checked } : null), rows, dims[0], dims[1] || '', dims[2] || '');

const utrow = (tags, hours) => ({ tags, hours, bill: hours, nonbill: 0 });
const UBOOK = [utrow(['urgent'], 4), utrow(['agency', 'tech'], 2), utrow([], 6), utrow([], 1)];

ok(!utrun(UBOOK, ['client'], true).hideUntag(),
  'on a split that has no untagged bucket the exclusion never applies — every other dimension puts '
  + 'a task in exactly one bucket');
ok(utrun(UBOOK, ['tag'], true).hideUntag() && utrun(UBOOK, ['client', 'tag'], true).hideUntag()
  && utrun(UBOOK, ['client', 'owner', 'tag'], true).hideUntag(),
  'it applies wherever a TAG is one of the three levels, not only the first');
ok(!utrun(UBOOK, ['tag'], false).hideUntag(), 'and the tickbox turns it off');

eq(utrun(UBOOK, ['tag'], true).chartPop().length, 2,
  'THE ROW LEAVES, NOT THE BUCKET: the untagged rows are out of the population the chart, its '
  + 'legend, its table, its CSV and its PNG all read — a dropped slice would leave a nested parent '
  + 'its children no longer sum to, and a headline counting hours that are not on the chart');
eq(utrun(UBOOK, ['tag'], false).chartPop().length, 4, 'untick and the whole search is back');
eq(utrun(UBOOK, ['client'], true).chartPop().length, 4, 'a non-tag split is never filtered');
ok(utrun(UBOOK, ['client'], true).chartPop() === UBOOK,
  'and is handed the very array it was given, never a copy that could drift');

const ULEFT = utrun(UBOOK, ['tag'], true).untagLeft();
eq([ULEFT.n, ULEFT.hours], [2, 7],
  'what was left out is counted so the verdict line can name it — hidden, never dropped');
eq(utrun(UBOOK, ['tag'], false).untagLeft(), null, 'nothing to say when nothing is hidden');
eq(utrun([utrow(['urgent'], 4)], ['tag'], true).untagLeft(), null,
  'and nothing to say on a fully-judged search, rather than a "0 rows" line nobody needs');

// the engine's own rule, which is what makes the row filter equal to dropping the bucket: a task
// is in `(untagged)` exactly when it carries no tags, and in its real tags otherwise — never both
eq(M.groupBy(UBOOK.filter((t) => t.tags.length), 'tag').map((g) => g.k).sort(),
  ['agency', 'tech', 'urgent'], 'dropping the untagged ROWS leaves exactly the tag buckets');
ok(!M.groupBy(UBOOK.filter((t) => t.tags.length), 'tag').some((g) => g.k === '(untagged)'),
  'and no untagged bucket can survive it');

ok(/id="cuntag-l" hidden/.test(PAGE_SRC) && /id="cuntag" checked/.test(PAGE_SRC),
  'the control ships in the chart\'s own control row, hidden until a tag split is on screen');
ok(/var cul = \$\('cuntag-l'\); if \(cul\) cul\.hidden = !tagDim\(\);/.test(PAGE_SRC),
  'and every render decides that again — a control that does nothing is a control that lies');
ok(/Not yet tagged is hidden: <b>' \+ num\(left\.n\)/.test(PAGE_SRC),
  'the verdict line names the rows and the hours that are not in the split');
ok(/var s = summarise\(POP\)/.test(PAGE_SRC),
  'the "N h in view" headline is summarised from the CHARTED population, so it can never count '
  + 'hours that are not drawn');
ok(/Every row in this search is still untagged/.test(PAGE_SRC),
  'and a search that empties itself says WHY, with the way back');
ok(/var body = chartPop\(\)\.map/.test(PAGE_SRC) && /hideUntag\(\) \? '-tagged' : ''/.test(PAGE_SRC),
  'the CSV is "every row behind this chart", so it follows — and its filename says it is a cut');
ok(/hideUntag\(\) \? ' · untagged rows not shown' : ''/.test(PAGE_SRC),
  'the PNG stamps it too, so a shared image cannot imply it is the whole book');
ok(/localStorage\.setItem\('fcc-tm-untag'/.test(PAGE_SRC),
  'remembered per DEVICE, like the theme and the legend toggle — not a team fact');
ok(!/groupBy\(FT, CDIM|groupNested\(FT,|seriesByMonth\(FT,/.test(PAGE_SRC),
  'ONE population feeds every form: no chart function reads FT behind chartPop\'s back');

console.log('\n── the measure: hiding a series re-ranks, it does not repaint (Ray, 18 Sep 2026: "then option to hide non-billable also from dissectment")');
// the engine, run for real
const mrow = (k, bill, nonbill) => ({ cat: k, client: k, task: k, title: k, d: '2026-03-01',
  bill, nonbill, hours: r2b(bill + nonbill), tags: [] });
function r2b(n) { return Math.round(n * 100) / 100; }
const MB = [mrow('a', 1, 9), mrow('b', 5, 0), mrow('c', 3, 3)];

eq(M.MEASURES, ['hours', 'bill', 'nonbill'], 'three measures, and only three');
eq([M.mOf({ hours: 10, bill: 1, nonbill: 9 }, 'hours'), M.mOf({ hours: 10, bill: 1, nonbill: 9 }, 'bill'),
  M.mOf({ hours: 10, bill: 1, nonbill: 9 }, 'nonbill'), M.mOf({ hours: 10, bill: 1, nonbill: 9 })],
  [10, 1, 9, 10], 'mOf picks the number, and an absent measure is the total — every existing caller unchanged');
eq(M.mOf(null, 'bill'), 0, 'and a missing node is 0, never a throw inside a render loop');

eq(M.groupBy(MB, 'cat').map((g) => g.k), ['a', 'c', 'b'], 'by total, a (10h) leads');
eq(M.groupBy(MB, 'cat', 0, 'bill').map((g) => g.k), ['b', 'c', 'a'],
  'THE RE-RANK IS THE POINT: on billable the order reverses, so the bars are never ordered by a '
  + 'number the chart no longer draws — a row with 5 h of it sitting under one with 1 h that '
  + 'happened to carry more non-billable is worse than no ordering at all');
eq(M.groupBy(MB, 'cat', 0, 'nonbill').map((g) => g.k), ['a', 'c', 'b'], 'and non-billable ranks on its own');
const mGb = M.groupBy(MB, 'cat', 0, 'bill')[0];
eq([mGb.bill, mGb.nonbill, mGb.hours], [5, 0, 5],
  'NOTHING IS DISCARDED — every node still carries all three, so the tooltip, the table and the '
  + 'CSV can state the split the chart put away');

// the cap keeps the biggest OF WHAT IS DRAWN, which is the trap a visual-only hide would spring
const mCap = [mrow('keep', 40, 0), mrow('drop', 1, 39), mrow('x', 2, 0)];
eq(M.groupBy(mCap, 'cat', 2, 'bill').map((g) => g.k), ['keep', 'Other (2 more)'],
  'and the fold keeps the biggest by the MEASURE, not the biggest by a total nobody asked for');

const mTree = M.groupNested(MB, ['cat'], null, 'bill');
eq(mTree.map((n) => n.k), ['b', 'c', 'a'], 'the nested mTree ranks on it at every level');
eq(M.seriesByMonth(MB, 'cat', 6, 'bill').series.map((x) => x.k), ['b', 'c', 'a'],
  'and so does the line, so its fold and the bars\' fold keep the same rows');

// engine and the page twin agree, as they must for every other function here
eq(P.MEASURES, M.MEASURES, 'the page twin carries the same measures');
eq([P.mOf({ hours: 9, bill: 4, nonbill: 5 }, 'bill'), P.mOf({ hours: 9, bill: 4, nonbill: 5 }, 'nonbill')],
  [4, 5], 'and the same mOf');
eq(P.groupBy(MB, 'cat', 0, 'bill').map((g) => g.k), M.groupBy(MB, 'cat', 0, 'bill').map((g) => g.k),
  'so a re-rank reads identically in the worker and on the page');

console.log('\n── percentage labels, and what they are a share of (Ray: "percentage of which attributes")');
// the label rules, lifted out of the page by name and run
const LB = new Function('CMEAS', 'CLAB', 'nested', 'hrs', 'mOf',
  liftPageSrc('mv') + '\n' + liftPageSrc('showBill') + '\n' + liftPageSrc('showNon') + '\n'
  + liftPageSrc('hiddenSeries') + '\n' + liftPageSrc('measWord') + '\n' + liftPageSrc('labMode') + '\n'
  + liftPageSrc('pctOf') + '\n' + liftPageSrc('labText') + '\n' + liftPageSrc('labOn') + '\n'
  + liftPageSrc('labBasis') + '\n'
  + 'return { mv, showBill, showNon, hiddenSeries, measWord, labMode, pctOf, labText, labOn, labBasis };');
const lb = (meas, lab, isNested) => LB(meas, lab, () => !!isNested,
  (n) => String(Math.round(n * 100) / 100), M.mOf);

const KWO = { hours: 110, bill: 63.75, nonbill: 46.25 };       // his row
const OPT = { hours: 562.25, bill: 312.5, nonbill: 249.75 };   // its parent

eq(lb('hours', 'hours', true).labText(KWO, OPT.hours), '110 h', 'hours is still hours — the default is untouched');
eq(lb('bill', 'pparent', true).labText(KWO, OPT.bill), '20.4%',
  'RAY\'S OWN NUMBER: Include → Billable only, Labels → % of its parent reads 63.75 of 312.5 — '
  + '"how mCap out of 63.75 hours of keywords optimisation are accumulated to the total of '
  + 'billable optimisation work type"');
eq(lb('hours', 'pparent', true).labText(KWO, OPT.hours), '19.6%',
  'and with both series in, the same label is the row\'s total against its parent\'s total — one '
  + 'measure drives the mark AND its denominator, so the two can never be taken from different numbers');
eq(lb('bill', 'hours', true).labText(KWO, 0), '63.75 h', 'hours under a single measure shows THAT series\' hours');
eq(lb('bill', 'off', true).labText(KWO, 1), '', 'and None draws nothing');
eq(lb('nonbill', 'pview', false).labText(KWO, 800), '5.8%', '% of the whole chart divides by the view');

eq(lb('hours', 'pparent', false).labMode(), 'pview',
  '"% of its parent" on a FLAT split falls back to the share of the chart — the same question one '
  + 'level up — rather than dividing by a parent that does not exist');
eq(lb('bill', 'pparent', true).pctOf(5, 0), '0%', 'a zero denominator is 0%, never NaN% on a live chart');
eq([lb('bill', 'hours', true).hiddenSeries(), lb('nonbill', 'hours', true).hiddenSeries(),
  lb('hours', 'hours', true).hiddenSeries()], ['Non-billable', 'Billable', ''],
  'the series put away is named, so the verdict and the legend can say which');
ok(/share of their parent/.test(lb('bill', 'pparent', true).labBasis())
  && /billable hours/.test(lb('bill', 'pparent', true).labBasis()),
  'and the basis is a full sentence: which hours, and a share of what');
eq(lb('hours', 'hours', true).labBasis(), '',
  'with nothing to explain it says nothing — the subtitle is not padded with a restatement of the default');

console.log('\n── the page wiring');
ok(/<select id="cmeas">/.test(PAGE_SRC) && /<option value="bill">Billable only<\/option>/.test(PAGE_SRC)
  && /<option value="nonbill">Non-billable only<\/option>/.test(PAGE_SRC),
  'the Include control ships with both single-series readings');
ok(/<label for="cmeas">Include<\/label>/.test(PAGE_SRC),
  'and it is NOT called "Show" — "Show as" is the form selector inches away, and two controls one '
  + 'word apart is a misread waiting to happen');
ok(/\{ v: 'pparent', label: '% of its parent', nest: true \}/.test(PAGE_SRC) && /function fillLabs\(\)/.test(PAGE_SRC),
  'the Labels list is rebuilt with the split, so % of its parent is only offered where there is one');
ok(/CLAB = CLAB === 'pparent' \? 'pview' : 'hours'/.test(PAGE_SRC),
  'and a pick that stops being offered falls back to the nearest true question, not silently to hours');
ok(/return !\(f === 'pct' && CMEAS !== 'hours'\)/.test(PAGE_SRC),
  '100% stacked IS the billable split, so it leaves the form list while a series is hidden rather '
  + 'than drawing every column full and saying nothing');
ok(/groupBy\(chartPop\(\), CDIM, CDIM === 'total' \? 0 : 12, CMEAS\)/.test(PAGE_SRC)
  && /groupNested\(chartPop\(\), \[CDIM, CDIM2, CDIM3\], null, CMEAS\)/.test(PAGE_SRC)
  && /seriesByMonth\(chartPop\(\), CDIM, 6, CMEAS\)/.test(PAGE_SRC)
  && /groupBy\(chartPop\(\), CDIM, 8, CMEAS\)/.test(PAGE_SRC),
  'every grouping call carries the measure — one population, one ranking, all four forms');
ok(/var SEP = '\\u0000', own = \{\}, viewTot = 0;/.test(PAGE_SRC)
  && /own\[flat\[i\]\.path\.join\(SEP\)\] = mv\(flat\[i\]\);/.test(PAGE_SRC)
  && /own\[r\.path\.slice\(0, r\.depth\)\.join\(SEP\)\]/.test(PAGE_SRC),
  'a nested child divides by the parent it actually hangs under — keyed on the FULL PATH, never on '
  + 'a node name that can repeat elsewhere in the mTree');
ok(/\$\('cwsub'\)\.textContent = \(nested\(\)/.test(PAGE_SRC) && /if \(labBasis\(\)\) basis\.push\(labBasis\(\)\);/.test(PAGE_SRC),
  'the basis rides the SUBTITLE, not the verdict: the verdict collapses behind the card\'s ⓘ, and a '
  + 'percentage whose meaning can be folded away is one someone will read wrong');
ok(/esc\(hiddenSeries\(\)\) \+ ' is hidden: <b>'/.test(PAGE_SRC) && /ranked on '\s*\+ measWord\(\) \+ ' hours/.test(PAGE_SRC),
  'the verdict names the hidden series, its hours, and that the rows were re-ranked');
ok(/· hidden<\/span>/.test(PAGE_SRC) && /var hd = function \(name, on, col, val, pct\)/.test(PAGE_SRC),
  'the hidden series KEEPS its legend row — dimmed, marked, with its hours — so the two head rows '
  + 'still add up to the book and the number nobody looked at is not lost');
ok(/localStorage\.setItem\('fcc-tm-meas'/.test(PAGE_SRC) && /localStorage\.setItem\('fcc-tm-lab'/.test(PAGE_SRC),
  'both are per DEVICE, like the theme and the legend toggle — one screen\'s reading, not a team fact');
ok(/qp\.get\('meas'\) \|\| localStorage\.getItem\('fcc-tm-meas'\)/.test(PAGE_SRC),
  'and a link that names them BEATS the remembered pick, or a shared view opens as something else '
  + 'on every screen');
ok(/if \(showBill\(\)\) ser\.push\(mk\('Billable', 'bill'\)\);/.test(PAGE_SRC),
  'on Everything the two lines ARE the two series, so hiding one leaves one line, not an empty chart');
ok(/\(CMEAS !== 'hours' \? ' · ' \+ measWord\(\) \+ ' hours only' : ''\)/.test(PAGE_SRC),
  'and the PNG stamps the same basis, so a shared image cannot imply it is the whole book');

ok(/\$\('cwh'\)\.textContent = CMEAS === 'hours' \? 'Billable vs non-billable'/.test(PAGE_SRC),
  'the card HEADING follows the measure too — it is the first thing read, and "Billable vs '
  + 'non-billable" over a chart with non-billable put away is the heading contradicting the chart');
ok(/\.cw-ctl \.cwp\{display:inline-flex/.test(PAGE_SRC) && /<span class="cwp"><label for="cmeas">/.test(PAGE_SRC),
  'and a label wraps WITH its control — the row wraps, and "INCLUDE" stranded at the end of one '
  + 'line with its select on the next names nothing');

console.log('\n── side by side, expanded (Ray, 18 Sep 2026: "clicking on any chart will expand it as the main chart on the screen and showcase the different split legend in animation pls")');
ok(/function smallOne\(c, colourBy\)/.test(PAGE_SRC), 'a cell can fill the stage on its own');
ok(/out \+= '<rect class="smx" data-k="'/.test(PAGE_SRC) && /click to expand/.test(PAGE_SRC),
  'the whole CELL is the click target, not the ring — a 12px slice is not something a hand can '
  + 'reliably hit, and the label under it is part of the thing being pointed at');
ok(/It goes LAST\n         so it sits above the arcs/.test(PAGE_SRC),
  'and it is drawn last so it sits over the arcs, which keep their own hover tooltips');
ok(/r\.onclick = function \(\) \{ CEXP = r\.getAttribute\('data-k'\); chart\(\); \};/.test(PAGE_SRC)
  && /if \(b\) b\.onclick = function \(\) \{ CEXP = null; chart\(\); \};/.test(PAGE_SRC),
  'a click expands, the ← All groups button returns');
ok(/if \(e\.key === 'Escape' && CEXP != null && CFORM === 'small'\) \{ CEXP = null; chart\(\); return; \}/.test(PAGE_SRC),
  'Esc closes the expansion BEFORE it reaches the drawer — the nearest thing closes first');
ok(/if \(CEXP != null && !one\) CEXP = null;/.test(PAGE_SRC),
  'a key that no longer exists is a stale view, not an error: it falls back to the grid');
ok(/function expReset\(\)/.test(PAGE_SRC)
  && /\$\('cform'\)\.onchange = function \(\) \{ expReset\(\);/.test(PAGE_SRC)
  && /\$\('cmeas'\)\.onchange = function \(\) \{\n      expReset\(\);/.test(PAGE_SRC),
  'and anything that changes what the CELLS ARE — split, form, measure, the untagged rule — drops it');
ok(/The SEARCH deliberately does not drop it/.test(PAGE_SRC),
  'the search deliberately does not, and says so where someone would look for it');

console.log('   the animation, and the export it must survive');
ok(/@keyframes tmarc\{from\{stroke-dashoffset:var\(--arclen\)\}to\{stroke-dashoffset:0\}\}/.test(PAGE_SRC)
  && /@keyframes tmlgi\{/.test(PAGE_SRC),
  'the ring draws itself and the legend rows arrive with it');
ok(/stroke-dashoffset="0"/.test(PAGE_SRC) && /style="--arclen:' \+ draw\.toFixed\(2\) \+ 'px;animation-delay:/.test(PAGE_SRC),
  'EVERY animated element also carries its FINAL state as an SVG attribute — the ⬇ PNG serialises '
  + 'the node away from this stylesheet, where no keyframe can run, so without that rule the '
  + 'export would rasterise frame zero: a ring hidden behind its own dash offset');
ok(/<g class="lgi" style="animation-delay:[^"]*" opacity="1">/.test(PAGE_SRC),
  'the legend rows likewise default to visible and are only animated by the wrapper class');
ok(/@media\(prefers-reduced-motion:reduce\)\{\.tm-exp \.arc,\.tm-exp \.lgi,\.tm-exp \.ctr\{animation:none\}\}/.test(PAGE_SRC),
  'and a reader who asked for less motion gets the finished figure, not a slower one');
ok(/var narrow = \(\(\$\('cstage'\) && \$\('cstage'\)\.clientWidth\) \|\| 720\) < 560;/.test(PAGE_SRC),
  'a narrow card gets its OWN geometry — ring above, legend across the full width — because a '
  + '720-wide viewBox on a 360px screen halves every font and lands the legend at ~6px');
ok(/l: 'Everything else here'/.test(PAGE_SRC),
  'and the cell\'s out-of-key remainder is no longer a second row reading "Other" beside the '
  + 'engine\'s own "Other (N more)" fold — invisible in a 40px ring, unanswerable once expanded');

console.log('\n── one control scale (Ray, 18 Sep 2026: "the box and button in the task manager are not equal size, so it looks messy")');
ok(/:root\{--h-field:34px;--h-pill:30px\}/.test(PAGE_SRC),
  'two roles, two sizes: a FIELD you open or type in, a PILL you press');
ok(/\.btn\.sm,\.chip,\.pq-x\{height:var\(--h-pill\)/.test(PAGE_SRC),
  'the three pill styles that differed only by a pixel of padding (.btn.sm 4⁄9, .chip 5⁄10, '
  + '.pq-x 4⁄10) are now one');
ok(/\.cw-ctl select,\.pq-bar input\{height:var\(--h-field\)/.test(PAGE_SRC),
  'and the select and the text input stop being 33px and 37.5px');
ok(/HEIGHT IS SET EXPLICITLY, not left to padding/.test(PAGE_SRC),
  'height is set outright: padding + line-height + font-size lands somewhere different for every '
  + 'font size, which is exactly how one page reached ten heights');
ok(/Deliberately NOT normalised: \.tab/.test(PAGE_SRC),
  'and what is legitimately its own size is exempt BY NAME, never quietly rounded into a bucket');
const MOB = fs.readFileSync(path.join(ROOT, 'tools', 'check_mobile.js'), 'utf8');
ok(/const SCALED = \/\^\(TaskManager\)\$\//.test(MOB) && /control scale fragmented/.test(MOB),
  'the tripwire enforces it where the scale is set and REPORTS every other page\'s number, so the '
  + 'next module to be worked on has a target rather than a surprise failure about someone else\'s change');
ok(/if \(Math\.abs\(r\.width - r\.height\) < 3\) return;/.test(MOB),
  'a square control is an icon button — its size is its glyph, not the text scale');
ok(/Measured on the DESKTOP pass only/.test(MOB),
  'and it measures desktop only: under 760px the phone layer\'s 36px tap-target rule governs');

console.log('\n── a total sits under its own column (Ray, 21 Sep 2026: "total row is not in line with rest")');
/* The footer carried each total's column as a HARD-CODED INDEX. When the Tag column was inserted
   at position 4 by the tagging system, nothing tied the two facts together, so every tasks total
   moved one column left: 216.00 printed under Status, 54.00 under Billable, 270.00 under
   Non-bill, and Total got an empty cell. Arithmetic right, every number under the wrong heading.

   These assertions test the STRUCTURE, not today's numbers — the old footer tests passed
   `new Array(9).fill({})` as the column list, a list with no column NAMES in it, which is exactly
   why a shifted footer could ship green. They now read the table's own arrays. */
const SLOTS = (html) => {
  // expand colspans so a slot index is a real column index
  const cells = [...html.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
  const out = [];
  cells.forEach(([, attrs, inner]) => {
    const cs = /colspan="(\d+)"/.exec(attrs);
    const n = cs ? +cs[1] : 1;
    for (let i = 0; i < n; i++) out.push(i === 0 ? inner.replace(/<[^>]+>/g, '').trim() : '');
  });
  return out;
};
const FROWS = [{ bill: 1.5, nonbill: 0.5, hours: 2, tasks: 3, allowance: 10, used: 4, balance: 6 },
  { bill: 2.5, nonbill: 1.5, hours: 4, tasks: 1, allowance: 20, used: 6, balance: 14 }];

['tasks', 'tickets', 'accounts'].forEach((tab) => {
  const cols = PANE.COLS[tab];
  // 1. every total names a column this table actually has
  PANE.FOOT[tab].forEach((f) => {
    ok(PANE.colIdx(cols, f.k) >= 0,
      tab + ': the "' + f.k + '" total names a real column — a key the header does not carry is a '
      + 'total with nowhere to sit');
  });
  const html = PANE.footHtml(tab, FROWS, cols, false);
  const slots = SLOTS(html);
  // 2. the footer occupies exactly as many columns as the table has
  eq(slots.length, cols.length,
    tab + ': the footer spans exactly ' + cols.length + ' columns — one short and every total '
    + 'after it slides left, which is the bug Ray ringed');
  // 3. and each total sits at the index of the column with the SAME key
  PANE.FOOT[tab].forEach((f) => {
    const i = PANE.colIdx(cols, f.k);
    ok(slots[i] !== '' && /[\d]/.test(slots[i]),
      tab + ': the "' + f.k + '" total lands in the "' + cols[i].l + '" column (slot ' + i + '), '
      + 'not one to its left');
  });
  // 4. nothing numeric leaks into a column that has no total
  cols.forEach((c, i) => {
    if (PANE.FOOT[tab].some((f) => f.k === c.k)) return;
    if (i < PANE.colIdx(cols, PANE.FOOT[tab].map((f) => f.k).reduce((a2, k) => (PANE.colIdx(cols, k) < PANE.colIdx(cols, a2) ? k : a2)))) return;  // inside the label span
    eq(slots[i], '', tab + ': "' + c.l + '" totals nothing, so its footer cell stays empty');
  });
});

/* The regression, stated as a RULE rather than today's column numbers — "Billable is the eighth
   column" would fail the next time somebody legitimately adds a column, which is the very change
   this fix exists to make safe. What is actually true is that the totalled columns are the last
   ones, and that the footer agrees with the header about where they are. */
eq(PANE.FOOT.tasks.map((f) => PANE.colIdx(PANE.COLS.tasks, f.k)),
  [PANE.COLS.tasks.length - 3, PANE.COLS.tasks.length - 2, PANE.COLS.tasks.length - 1],
  'the three hour totals are the last three tasks columns, wherever the columns before them move');
PANE.FOOT.tasks.forEach((f) => {
  eq(PANE.colIdx(PANE.COLS.tasks, f.k), PANE.COLS.tasks.findIndex((c) => c.k === f.k),
    '"' + f.k + '": the footer and the header resolve the same column, which is the whole fix');
});
ok(PANE.FOOT.tasks.every((f) => f.i === undefined),
  'no total carries a hard-coded index any more: the column is resolved BY KEY from the table\'s '
  + 'own list, so a column inserted anywhere can never desync the footer again');
eq(PANE.colIdx(PANE.COLS.tasks, 'nope'), -1, 'an unknown key resolves to -1 rather than column 0');
eq(PANE.footHtml('tasks', FROWS, [{ k: 'a', l: 'A' }], false), '',
  'and a table carrying none of the totalled columns prints no footer at all, rather than one '
  + 'whose numbers sit under whatever happens to be there');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
