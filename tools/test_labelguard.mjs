#!/usr/bin/env node
/**
 * Unit tests for the Label Guard engine (cloudflare/feedspark-deck/src/labelguard.js):
 * gviz header detection, aggregate-CSV parsing, snapshot assembly, and — the part that
 * pages Ray before a PMAX campaign craters — the baseline diff that turns a label/value
 * drop-off into an alert. Runs in plain node, no deps:
 *
 *   node tools/test_labelguard.mjs
 *
 * The repo has no package.json (on purpose), so a .js ESM file can't be imported directly;
 * the module is copied to a temp .mjs first — same code, no repo-wide module-type flip.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const srcPath = new URL('../cloudflare/feedspark-deck/src/labelguard.js', import.meta.url);
const tmp = join(mkdtempSync(join(tmpdir(), 'labelguard-')), 'labelguard.mjs');
writeFileSync(tmp, readFileSync(srcPath, 'utf8'));
const LG = await import(pathToFileURL(tmp));

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++; console.error(`✗ ${name}\n    got  ${g}\n    want ${w}`);
}
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; console.error(`✗ ${name}${detail ? ' — ' + detail : ''}`);
}

/* ---------- normHeader ---------- */
eq('normHeader strips g: prefix', LG.normHeader('g:custom_label_0'), 'custom_label_0');
eq('normHeader folds spaces', LG.normHeader('Custom Label 2'), 'custom_label_2');
eq('normHeader folds missing underscore', LG.normHeader('custom_label3'), 'custom_label_3');
eq('normHeader strips type suffix', LG.normHeader('custom_label_4 type=""string""'), 'custom_label_4');
eq('normHeader plain id', LG.normHeader(' ID '), 'id');
eq('normHeader item group id untouched', LG.normHeader('g:item_group_id'), 'item_group_id');

/* ---------- parseCsv ---------- */
eq('parseCsv quotes+comma', LG.parseCsv('a,"b,1",c\n"x ""y""",2,3'), [['a', 'b,1', 'c'], ['x "y"', '2', '3']]);
eq('parseCsv CRLF + blank line', LG.parseCsv('a,b\r\n\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);

/* ---------- colLetter / findCols ---------- */
eq('colLetter A', LG.colLetter(0), 'A');
eq('colLetter Z', LG.colLetter(25), 'Z');
eq('colLetter AA', LG.colLetter(26), 'AA');
{
  const cols = LG.findCols(['g:id', 'title', 'g:custom_label_0', 'Custom Label 2']);
  eq('findCols id', cols.id, 0);
  eq('findCols cl0', cols.labels.custom_label_0, 2);
  eq('findCols cl2', cols.labels.custom_label_2, 3);
  eq('findCols cl1 absent', cols.labels.custom_label_1, -1);
}
{
  const cols = LG.findCols(['sku', 'name']); // no id header at all
  eq('findCols falls back to column 0', cols.id, 0);
}

/* ---------- scanFeed against a mocked gviz ---------- */
function gvizMock(routes) {
  return async (url) => {
    const tq = decodeURIComponent((/tq=([^&]*)/.exec(url) || [])[1] || '');
    for (const [pat, body] of routes) {
      if (tq.startsWith(pat)) {
        return { ok: true, headers: { get: () => 'text/csv' }, text: async () => body };
      }
    }
    throw new Error('unmocked tq: ' + tq);
  };
}

const HEADER = '"id","title","custom_label_0","g:custom_label_1"\n"sku-1","Boot","bestseller","aw25"';
const routes = [
  ['select * limit 1', HEADER],
  // count(A)=rows, then per present label in LABEL_KEYS order (C, D)
  ['select count(A), count(C), count(D)', '"count id","count cl0","count cl1"\n"1000","950","400"'],
  ['select C, count(A)', '"custom_label_0","count id"\n"bestseller","600"\n"new in","250"\n"clearance","100"'],
  ['select D, count(A)', '"g:custom_label_1","count id"\n"aw25","400"'],
];
const snap = await LG.scanFeed(gvizMock(routes), { id: 'X', gid: '0' }, { client: 'Reiss', market: 'gb' });
eq('scan rows', snap.rows, 1000);
eq('scan cl0 filled (group sum, not count())', snap.labels.custom_label_0.filled, 950);
eq('scan cl0 coverage', snap.labels.custom_label_0.cov, 95);
eq('scan cl0 values sorted', snap.labels.custom_label_0.values, [['bestseller', 600], ['new in', 250], ['clearance', 100]]);
eq('scan cl1 present via g: header', snap.labels.custom_label_1.present, true);
eq('scan cl2 absent', snap.labels.custom_label_2.present, false);
ok('scan not truncated', !snap.labels.custom_label_0.truncated);

/* unreachable sheet -> throws fetch-fail (worker turns this into the 'unreachable' alert) */
let threw = null;
try {
  await LG.scanFeed(async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => 'login page' }),
    { id: 'X', gid: '0' }, {});
} catch (e) { threw = String(e.message); }
ok('non-CSV response throws fetch-fail', threw && threw.startsWith('fetch-fail'), threw);

/* ---------- gvizLiteral + crossFeed (live cross-label dissection) ---------- */
eq('gvizLiteral plain', LG.gvizLiteral('Best Sellers'), "'Best Sellers'");
eq('gvizLiteral apostrophe -> double-quoted', LG.gvizLiteral("Men's"), '"Men\'s"');
eq('gvizLiteral both quotes -> null', LG.gvizLiteral('a\'b"c'), null);

{
  const xroutes = [
    ['select * limit 1', HEADER],
    ["select count(A) where C = 'bestseller'", '"count id"\n"600"'],
    ["select D, count(A) where C = 'bestseller' and D is not null", '"cl1","count id"\n"aw25","400"\n"ss26","150"'],
  ];
  const x = await LG.crossFeed(gvizMock(xroutes), { id: 'X', gid: '0' }, 'custom_label_0', 'bestseller', 'custom_label_1');
  eq('cross segment', x.segment, 600);
  eq('cross rows sorted', x.rows, [['aw25', 400], ['ss26', 150]]);
  eq('cross labelled/unlabelled', [x.labelled, x.unlabelled], [550, 50]);
  ok('cross not truncated', !x.truncated);

  let err = null;
  try { await LG.crossFeed(gvizMock(xroutes), { id: 'X', gid: '0' }, 'custom_label_0', 'x', 'custom_label_0'); }
  catch (e) { err = String(e.message); }
  ok('same by/vs rejected', err && err.startsWith('bad-cross'), err);
  err = null;
  try { await LG.crossFeed(gvizMock(xroutes), { id: 'X', gid: '0' }, 'custom_label_0', 'x', 'custom_label_2'); }
  catch (e) { err = String(e.message); }
  ok('vs column absent rejected', err && err.indexOf('custom_label_2') >= 0, err);
}

/* ---------- diffSnapshots scenarios ---------- */
function mkSnap(rows, labels) {
  const L = {};
  for (const k of LG.LABEL_KEYS) L[k] = { present: false };
  for (const [k, spec] of Object.entries(labels)) {
    const values = spec.values || [];
    const filled = values.reduce((a, [, n]) => a + n, 0);
    L[k] = { present: true, filled, cov: rows ? Math.round((filled / rows) * 1000) / 10 : 0,
      distinct: values.length, truncated: !!spec.truncated, values };
  }
  return { v: 1, t: Date.now(), client: 'T', market: 'gb', rows, labels: L };
}
const codes = (alerts) => alerts.map((a) => a.sev + ':' + a.code).sort();

// identical -> silent
{
  const a = mkSnap(1000, { custom_label_0: { values: [['best', 600], ['new', 300]] } });
  eq('identical snapshots -> no alerts', LG.diffSnapshots(a, mkSnap(1000, { custom_label_0: { values: [['best', 600], ['new', 300]] } })), []);
}
// the nightmare: label column vanished
{
  const base = mkSnap(1000, { custom_label_0: { values: [['best', 600]] } });
  const cur = mkSnap(1000, {});
  eq('label column vanished -> crit', codes(LG.diffSnapshots(base, cur)), ['crit:label-gone']);
}
// a PMAX-keyed value gone while the column survives
{
  const base = mkSnap(1000, { custom_label_0: { values: [['best', 600], ['clearance', 200]] } });
  const cur = mkSnap(1000, { custom_label_0: { values: [['best', 800]] } });
  const A = LG.diffSnapshots(base, cur);
  ok('value gone -> crit value-gone', A.some((a) => a.sev === 'crit' && a.code === 'value-gone' && a.value === 'clearance'), JSON.stringify(A));
}
// value drop >50% -> warn; insignificant values ignored
{
  const base = mkSnap(1000, { custom_label_0: { values: [['best', 600], ['tiny', 4]] } });
  const cur = mkSnap(1000, { custom_label_0: { values: [['best', 250]] } });
  const A = LG.diffSnapshots(base, cur);
  ok('value -58% -> warn', A.some((a) => a.sev === 'warn' && a.code === 'value-drop' && a.value === 'best'), JSON.stringify(A));
  ok('sub-floor value gone -> ignored', !A.some((a) => a.value === 'tiny'), JSON.stringify(A));
}
// coverage decay tiers
{
  const base = mkSnap(1000, { custom_label_0: { values: [['a', 900]] } });
  const warn = LG.diffSnapshots(base, mkSnap(1000, { custom_label_0: { values: [['a', 800]] } }));
  ok('cov -10pp -> warn cov-drop', warn.some((a) => a.sev === 'warn' && a.code === 'cov-drop'), JSON.stringify(warn));
  const crit = LG.diffSnapshots(base, mkSnap(1000, { custom_label_0: { values: [['a', 500]] } }));
  ok('cov -40pp -> crit cov-drop', crit.some((a) => a.sev === 'crit' && a.code === 'cov-drop'), JSON.stringify(crit));
  const zero = LG.diffSnapshots(base, mkSnap(1000, { custom_label_0: { values: [] } }));
  ok('cov -> 0 -> crit cov-zero', zero.some((a) => a.sev === 'crit' && a.code === 'cov-zero'), JSON.stringify(zero));
}
// feed rows collapse
{
  const base = mkSnap(10000, { custom_label_0: { values: [['a', 9000]] } });
  const cur = mkSnap(6000, { custom_label_0: { values: [['a', 5400]] } });
  const A = LG.diffSnapshots(base, cur);
  ok('rows -40% -> crit rows-drop', A.some((a) => a.sev === 'crit' && a.code === 'rows-drop'), JSON.stringify(A));
}
// truncated current list downgrades a disappeared value to warn (may just be below top-250)
{
  const base = mkSnap(100000, { custom_label_0: { values: [['seg', 800], ['big', 90000]] } });
  const cur = mkSnap(100000, { custom_label_0: { values: [['big', 90000]], truncated: true } });
  const A = LG.diffSnapshots(base, cur);
  ok('gone-but-truncated -> warn not crit', A.some((a) => a.sev === 'warn' && a.value === 'seg') && !A.some((a) => a.sev === 'crit'), JSON.stringify(A));
}
// new significant value + new label -> info only
{
  const base = mkSnap(1000, { custom_label_0: { values: [['a', 900]] } });
  const cur = mkSnap(1000, { custom_label_0: { values: [['a', 900], ['fresh', 90]] }, custom_label_3: { values: [['x', 500]] } });
  const A = LG.diffSnapshots(base, cur);
  eq('additions are info-only', A.map((a) => a.sev), ['info', 'info']);
}

/* ---------- watch rules: labelPivot / evalWatch / alertText ---------- */
{
  const proutes = [
    ['select * limit 1', HEADER],
    ['select C, count(A)', '"cl0","count id"\n"bestseller","600"\n"new in","250"'],
  ];
  const pv = await LG.labelPivot(gvizMock(proutes), { id: 'X', gid: '0' }, 'custom_label_0');
  eq('labelPivot values', pv.values, [['bestseller', 600], ['new in', 250]]);
  const pv2 = await LG.labelPivot(gvizMock(proutes), { id: 'X', gid: '0' }, 'custom_label_2');
  eq('labelPivot absent column -> present:false', pv2.present, false);
}
{
  const H = 3600 * 1000, T0 = 1000000000000;
  const rule = { client: 'Reiss', mkt: 'gb', label: 'custom_label_0', value: 'Best Sellers', vs: 'custom_label_2',
    ref: [['women - fp', 3166], ['men - fp', 2542]], refSeg: 9596, dropPct: 50, repingH: 24, state: {} };
  const GONE_LIVE = { segment: 9500, values: [['men - fp', 2542]] };

  // healthy: everything at reference -> silence
  let ev = LG.evalWatch(rule, { segment: 9596, values: [['women - fp', 3166], ['men - fp', 2542]] }, T0);
  eq('watch healthy -> no fires', ev.fires, []);

  // TWO-STRIKE: first bad sighting is a silent 'suspect' (mid-refresh false-positive guard)…
  ev = LG.evalWatch(rule, GONE_LIVE, T0);
  ok('first sighting -> silent suspect', ev.fires.length === 0 && ev.suspects === 1 &&
    ev.state['women - fp'].st === 'suspect', JSON.stringify(ev));
  rule.state = ev.state;

  // …a transient gap that self-heals never pings at all…
  ev = LG.evalWatch(rule, { segment: 9596, values: [['women - fp', 3166], ['men - fp', 2542]] }, T0 + H);
  ok('suspect that recovers -> fully silent', ev.fires.length === 0 && ev.state['women - fp'].st === 'ok', JSON.stringify(ev));

  // …but a persistent wipe confirms on the SECOND consecutive check
  rule.state = {};
  rule.state = LG.evalWatch(rule, GONE_LIVE, T0).state;   // strike one: suspect
  ev = LG.evalWatch(rule, GONE_LIVE, T0 + H);             // strike two: fire
  eq('second sighting -> confirmed gone fire', ev.fires.map((f) => f.kind + ':' + f.value), ['gone:women - fp']);
  rule.state = ev.state;

  // still gone 2h later -> inside the re-ping window, no duplicate ping
  ev = LG.evalWatch(rule, GONE_LIVE, T0 + 3 * H);
  eq('still broken inside window -> silent', ev.fires, []);
  rule.state = ev.state;

  // still gone 25h after confirmation -> re-ping (again:true)
  ev = LG.evalWatch(rule, GONE_LIVE, T0 + 26 * H);
  ok('re-ping after repingH', ev.fires.length === 1 && ev.fires[0].again === true, JSON.stringify(ev.fires));
  rule.state = ev.state;

  // value comes back -> recovery notice, state resets
  ev = LG.evalWatch(rule, { segment: 9596, values: [['women - fp', 3100], ['men - fp', 2542]] }, T0 + 27 * H);
  eq('recovery fire', ev.fires.map((f) => f.kind + ':' + f.value), ['recovered:women - fp']);
  rule.state = ev.state;

  // thresholds (two evals = confirmed): -60% fires at 50; silent at dropPct 0
  const conf = (r, live) => { const s1 = LG.evalWatch(r, live, T0); return LG.evalWatch({ ...r, state: s1.state }, live, T0 + H); };
  const live60 = { segment: 9596, values: [['women - fp', 1200], ['men - fp', 2542]] };
  ok('-60%% -> confirmed drop fire', conf({ ...rule, state: {} }, live60).fires.some((f) => f.kind === 'drop' && f.value === 'women - fp'), 'no drop fire');
  eq('dropPct 0 -> gone only, silent on -60%', conf({ ...rule, dropPct: 0, state: {} }, live60).fires, []);

  // custom fine-grained threshold: -15% fires at dropPct 10, stays silent at dropPct 20
  const live15 = { segment: 9596, values: [['women - fp', 2691], ['men - fp', 2542]] };  // 3166 -> 2691 = -15%
  ok('custom 10%% catches a -15%% drift', conf({ ...rule, dropPct: 10, state: {} }, live15).fires.some((f) => f.kind === 'drop'), 'expected drop fire at 10%');
  eq('custom 20%% ignores a -15%% drift', conf({ ...rule, dropPct: 20, state: {} }, live15).fires, []);

  // whole segment vanishes -> one loud confirmed segment-gone, no per-value echo spam
  eq('segment gone -> single confirmed fire', conf({ ...rule, dropPct: 0, state: {} }, { segment: 0, values: [] }).fires.map((f) => f.kind), ['segment-gone']);

  // digest: ONE alert message with each value on its own `highlighted` row + one recovery message
  const msgs = LG.alertDigest(rule, [
    { kind: 'gone', value: 'women - fp', was: 3166, now: 0 },
    { kind: 'drop', value: 'men - fp', was: 2542, now: 1100 },
    { kind: 'recovered', value: 'women - sale', was: 2081, now: 2050 },
  ], { link: 'https://x/labels' });
  eq('digest -> exactly 2 messages (alert + recovery)', msgs.length, 2);
  ok('alert digest: one message, own rows, code-highlighted values',
    msgs[0].indexOf('HIGH PRIORITY') >= 0 && msgs[0].indexOf('CONFIRMED') >= 0 &&
    msgs[0].indexOf('\n• `women - fp` — was 3166 SKUs → now 0 (GONE)') >= 0 &&
    msgs[0].indexOf('\n• `men - fp` — 2542 → 1100 SKUs (−57%)') >= 0 &&
    msgs[0].indexOf('https://x/labels') >= 0, msgs[0]);
  ok('recovery digest separate', msgs[1].indexOf('RECOVERED') >= 0 && msgs[1].indexOf('`women - sale`') >= 0, msgs[1]);
  eq('digest with no fires -> no messages', LG.alertDigest(rule, [], {}), []);
}

/* ---------- channels: -fb market suffix ---------- */
eq('chOf google', LG.chOf('gb'), 'google');
eq('chOf facebook', LG.chOf('gb-fb'), 'facebook');
eq('dispFeed google', LG.dispFeed('Reiss', 'gb'), 'Reiss · GB');
eq('dispFeed facebook', LG.dispFeed('Visual K', 'gb-fb'), 'Visual K · GB · Facebook');
{
  const fbRule = { client: 'Visual K', mkt: 'gb-fb', label: 'custom_label_0', value: 'Best Sellers', vs: 'custom_label_2', ref: [['x', 5]] };
  const msg = LG.alertDigest(fbRule, [{ kind: 'gone', value: 'x', was: 5, now: 0 }], {})[0];
  ok('digest names the Facebook channel', msg.indexOf('Visual K · GB · Facebook') >= 0, msg);
}

/* ---------- isImplausible (the impossible-answer guard) ---------- */
{
  const xr = { vs: 'custom_label_2', ref: [['a', 10], ['b', 5]] };
  ok('cross: segment>0 + empty pivot = implausible', LG.isImplausible(xr, { segment: 9178, values: [] }));
  ok('cross: segment=0 + empty pivot = coherent (segment-gone path)', !LG.isImplausible(xr, { segment: 0, values: [] }));
  ok('cross: data present = plausible', !LG.isImplausible(xr, { segment: 9178, values: [['a', 9]] }));
  const pr = { vs: null, ref: [['a', 10]] };
  ok('plain: empty values = implausible (sweep owns real wipes)', LG.isImplausible(pr, { present: true, values: [] }));
  ok('plain: column-missing reading also unprovable', LG.isImplausible(pr, { present: false, values: [] }));
  ok('plain: data present = plausible', !LG.isImplausible(pr, { present: true, values: [['a', 4]] }));
  ok('no ref = nothing to contradict', !LG.isImplausible({ vs: null, ref: [] }, { present: true, values: [] }));
}

/* ---------- buildReport (the emailed status summary) ---------- */
{
  const T0 = 1754280000000; // fixed clock
  const rep = LG.buildReport({
    now: T0, link: 'https://x/labels',
    rules: {
      'Reiss|gb|w_1': { client: 'Reiss', mkt: 'gb', label: 'custom_label_0', value: 'Best Sellers', vs: 'custom_label_2',
        ref: [['a', 1], ['b', 2]], dropPct: 20, sched: 'twice', enabled: true, dests: ['d1'],
        state: { 'women - fp': { st: 'fired', t: T0, n: 0 } } },
      'Reiss|gb|w_2': { client: 'Reiss', mkt: 'gb', label: 'custom_label_1', value: null, vs: null,
        ref: [['aw25', 9]], dropPct: 0, enabled: true, dests: ['d1'],
        state: { aw25: { st: 'suspect', t: T0, n: 0 } } },
      'YuMOVE|gb|w_3': { client: 'YuMOVE', mkt: 'gb', label: 'custom_label_0', value: null, vs: null,
        ref: [['x', 5]], dropPct: 50, enabled: true, dests: ['d1'], state: {} },
    },
    dests: { d1: { name: 'Reiss-alerts', type: 'gchat' } },
    idx: {
      'Reiss|gb': { status: 'crit', rows: 22496, nCrit: 1, nWarn: 0, cov: { custom_label_0: 83.3, custom_label_1: 100, custom_label_2: null, custom_label_3: null, custom_label_4: null } },
      'Schuh|gb': { status: 'ok', rows: 41000, nCrit: 0, nWarn: 0, cov: {} },
    },
    alerts: { 'Reiss|gb': { alerts: [
      { sev: 'crit', msg: 'CL0 value "clearance" GONE - was on 900 SKUs' },
      { sev: 'info', msg: 'noise that must not appear' } ] } },
  });
  ok('report: rule counts line', rep.indexOf('WATCH RULES (3) — 1 down · 1 suspect · 1 ok') >= 0, rep);
  ok('report: DOWN rule first with broken value', rep.indexOf('[DOWN] Reiss · GB') >= 0 &&
    rep.indexOf('broken: `women - fp`') >= 0 && rep.indexOf('[DOWN]') < rep.indexOf('[SUSPECT]'), rep);
  ok('report: suspect note', rep.indexOf('confirms or clears next check') >= 0, rep);
  ok('report: schedule + threshold shown', rep.indexOf('07:00 & 17:00 GMT') >= 0 && rep.indexOf('gone or -20%') >= 0, rep);
  ok('report: estate crit first with coverage', rep.indexOf('[CRIT] Reiss · GB — 22496 rows · CL0 83.3% · CL1 100%') >= 0 &&
    rep.indexOf('[CRIT]') < rep.indexOf('[ok] Schuh'), rep);
  ok('report: baseline alerts, info excluded', rep.indexOf('ACTIVE BASELINE ALERTS (1)') >= 0 &&
    rep.indexOf('"clearance" GONE') >= 0 && rep.indexOf('noise that must not appear') < 0, rep);
  ok('report: link', rep.indexOf('https://x/labels') >= 0, rep);
}

/* ---------- summarize ---------- */
{
  const s = mkSnap(1000, { custom_label_0: { values: [['a', 900]] } });
  const sum = LG.summarize(s, [{ sev: 'crit', code: 'value-gone' }, { sev: 'warn', code: 'cov-drop' }, { sev: 'info', code: 'value-new' }], 123);
  eq('summarize status', sum.status, 'crit');
  eq('summarize counts', [sum.nCrit, sum.nWarn], [1, 1]);
  eq('summarize cov', sum.cov.custom_label_0, 90);
  eq('summarize baseT', sum.baseT, 123);
  const clean = LG.summarize(s, [], 0);
  eq('summarize clean ok', clean.status, 'ok');
}

console.log(`\nLabel Guard engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
