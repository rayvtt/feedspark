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
    msgs[0].indexOf('vs the pinned reference') >= 0 &&
    msgs[0].indexOf('\n• `women - fp` — was 3166 SKUs → now 0 (GONE)') >= 0 &&
    msgs[0].indexOf('\n• `men - fp` — 2542 → 1100 SKUs (−57%)') >= 0 &&
    msgs[0].indexOf('https://x/labels') >= 0, msgs[0]);
  ok('recovery digest separate', msgs[1].indexOf('RECOVERED') >= 0 && msgs[1].indexOf('`women - sale`') >= 0, msgs[1]);
  const armed = LG.alertDigest({ ...rule, created: 1753600000000 }, [{ kind: 'gone', value: 'women - fp', was: 3166, now: 0 }], {})[0];
  ok('alert digest dates the pinned reference', armed.indexOf('vs the pinned reference (armed 27 Jul 2025)') >= 0, armed);
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
  ok('report: known-good alerts, info excluded', rep.indexOf('ACTIVE ALERTS — vs last known-good (1)') >= 0 &&
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

/* ---------- Product Type Guard: parameterised key set ---------- */
eq('dispKey CL', LG.dispKey('custom_label_3'), 'CL3');
eq('dispKey PT', LG.dispKey('product_type'), 'PT');
eq('dispKey passthrough', LG.dispKey('brand'), 'brand');
eq('PT_KEYS', LG.PT_KEYS, ['product_type']);

{
  // primary g:product_type only — numbered keyword slots (product_type2 / |||3) must be ignored
  const PTHEAD = '"id","g:product_type","product_type2","g:product_type|||3","custom_label_0"\n"sku-1","Womens > Dresses","kw","kw","bestseller"';
  const keys = LG.LABEL_KEYS.concat(LG.PT_KEYS);
  const routes = [
    ['select * limit 1', PTHEAD],
    // count(A)=rows, then per present key in KEY order: cl0 (E) then product_type (B)
    ['select count(A), count(E), count(B)', '"c","c","c"\n"1000","900","980"'],
    ['select E, count(A)', '"cl0","count id"\n"bestseller","900"'],
    ['select B, count(A)', '"pt","count id"\n"Womens > Dresses","600"\n"Mens > Boots","380"'],
  ];
  const s = await LG.scanFeed(gvizMock(routes), { id: 'X', gid: '0' }, { client: 'Reiss', market: 'gb' }, keys);
  eq('PT scan rows', s.rows, 1000);
  eq('PT picked the primary column only', s.labels.product_type.values, [['Womens > Dresses', 600], ['Mens > Boots', 380]]);
  eq('PT filled = group sum', s.labels.product_type.filled, 980);
  eq('labels still scanned alongside PT', s.labels.custom_label_0.values, [['bestseller', 900]]);

  // default key set stays label-only — no product_type key appears
  const dflt = await LG.scanFeed(gvizMock([
    ['select * limit 1', PTHEAD],
    ['select count(A), count(E)', '"c","c"\n"1000","900"'],
    ['select E, count(A)', '"cl0","count id"\n"bestseller","900"'],
  ]), { id: 'X', gid: '0' }, {});
  ok('default scan has no product_type', dflt.labels.product_type === undefined);
}

{
  // slot-1 convention (Reiss/Superdry/Schuh/American Golf): g:product_type(1) IS the
  // primary category tree — keyword slots start at (2). The (1) header aliases onto
  // the product_type key; bare g:product_type wins when both somehow exist.
  const keys = LG.LABEL_KEYS.concat(LG.PT_KEYS);
  const SLOT1 = '"id","g:product_type(1)","g:product_type(2)","g:product_type(10)"\n"sku-1","Mens > Jackets","kw","kw"';
  const s1 = await LG.scanFeed(gvizMock([
    ['select * limit 1', SLOT1],
    ['select count(A), count(B)', '"c","c"\n"500","480"'],
    ['select B, count(A)', '"pt","count id"\n"Mens > Jackets","480"'],
  ]), { id: 'X', gid: '0' }, { client: 'Reiss', market: 'gb' }, keys);
  eq('g:product_type(1) resolves as the primary PT', s1.labels.product_type.values, [['Mens > Jackets', 480]]);

  const both = LG.findCols(['id', 'g:product_type(1)', 'g:product_type'], keys);
  eq('bare product_type preferred over slot 1 when both exist', both.labels.product_type, 2);
  const only2plus = LG.findCols(['id', 'g:product_type(2)', 'g:product_type_3', 'product_type2'], keys);
  eq('keyword slots alone never resolve the primary PT', only2plus.labels.product_type, -1);
  const yumove = LG.findCols(['id', 'g:product_type', 'g:product_type_2'], keys);
  eq('bare form (YuMOVE) resolves', yumove.labels.product_type, 1);
}

{
  // PT-keyed diff: PT drop flags with the PT prefix; custom-label noise is out of scope
  const mkPT = (vals, cl0) => ({ v: 1, t: 1, rows: 1000, labels: {
    product_type: { present: true, filled: vals.reduce((a, [, n]) => a + n, 0), cov: 98, distinct: vals.length, truncated: false, values: vals },
    custom_label_0: { present: true, filled: 900, cov: 90, distinct: 1, truncated: false, values: cl0 },
  } });
  const base = mkPT([['Womens > Dresses', 600], ['Mens > Boots', 380]], [['bestseller', 900]]);
  const cur = mkPT([['Womens > Dresses', 598]], [['SOMETHING ELSE', 900]]);
  const A = LG.diffSnapshots(base, cur, null, LG.PT_KEYS);
  ok('PT value gone -> crit with PT prefix', A.some((a) => a.sev === 'crit' && a.code === 'value-gone' && a.msg.indexOf('PT value "Mens > Boots" GONE') === 0), JSON.stringify(A));
  ok('custom-label churn ignored under PT keys', !A.some((a) => String(a.msg).indexOf('CL0') >= 0), JSON.stringify(A));
  const sum = LG.summarize(cur, A, 5, LG.PT_KEYS);
  eq('PT summarize cov shape', Object.keys(sum.cov), ['product_type']);
  eq('PT summarize status', sum.status, 'crit');
}

{
  // cross dissection accepts product_type on either side
  const PTHEAD = '"id","g:product_type","custom_label_0"\n"sku-1","Womens > Dresses","bestseller"';
  const xroutes = [
    ['select * limit 1', PTHEAD],
    ["select count(A) where B = 'Womens > Dresses'", '"count id"\n"600"'],
    ["select C, count(A) where B = 'Womens > Dresses' and C is not null", '"cl0","count id"\n"bestseller","410"\n"sale","120"'],
  ];
  const x = await LG.crossFeed(gvizMock(xroutes), { id: 'X', gid: '0' }, 'product_type', 'Womens > Dresses', 'custom_label_0');
  eq('PT cross segment', x.segment, 600);
  eq('PT cross rows', x.rows, [['bestseller', 410], ['sale', 120]]);
  let err = null;
  try { await LG.crossFeed(gvizMock(xroutes), { id: 'X', gid: '0' }, 'product_type', 'x', 'brand'); }
  catch (e) { err = String(e.message); }
  ok('cross still rejects unknown keys', err && err.indexOf('bad-cross') === 0, err);
}

/* ---------- materiality + rename scenarios (Aug 2026 noise pass) ---------- */
// tiny value vanishing entirely -> warn, not crit (a 30-SKU niche label is churn)
{
  const base = mkSnap(4000, { custom_label_0: { values: [['niche', 30], ['big', 3000]] } });
  const cur = mkSnap(4000, { custom_label_0: { values: [['big', 3000]] } });
  eq('small value-gone -> warn not crit', codes(LG.diffSnapshots(base, cur)), ['warn:value-gone']);
}
// big value vanishing stays crit
{
  const base = mkSnap(4000, { custom_label_0: { values: [['hero', 400], ['big', 3000]] } });
  const cur = mkSnap(4000, { custom_label_0: { values: [['big', 3000]] } });
  eq('big value-gone -> crit (+the 10pp cov-drop it causes)', codes(LG.diffSnapshots(base, cur)), ['crit:value-gone', 'warn:cov-drop']);
}
// 50%+ relative drop but only a handful of SKUs lost -> silent (not worth warning)
{
  const base = mkSnap(4000, { custom_label_0: { values: [['niche', 24], ['big', 3000]] } });
  const cur = mkSnap(4000, { custom_label_0: { values: [['niche', 11], ['big', 3000]] } });
  eq('immaterial 54% drop (13 SKUs) -> silent', LG.diffSnapshots(base, cur), []);
}
// same ratio with material SKU loss still warns
{
  const base = mkSnap(4000, { custom_label_0: { values: [['seg', 200], ['big', 3000]] } });
  const cur = mkSnap(4000, { custom_label_0: { values: [['seg', 90], ['big', 3000]] } });
  eq('material 55% drop (110 SKUs) -> warn', codes(LG.diffSnapshots(base, cur)), ['warn:value-drop']);
}
// case/whitespace regen artefact -> value-renamed info, never a crit + no "new value" echo
{
  const base = mkSnap(4000, { custom_label_0: { values: [['Best Sellers ', 500], ['big', 3000]] } });
  const cur = mkSnap(4000, { custom_label_0: { values: [['best sellers', 490], ['big', 3000]] } });
  eq('regen rename -> info only', codes(LG.diffSnapshots(base, cur)), ['info:value-renamed']);
}
// a rename twin with a wildly different count is NOT a rename — the value really went
{
  const base = mkSnap(4000, { custom_label_0: { values: [['Hero Seg', 400], ['big', 3000]] } });
  const cur = mkSnap(4000, { custom_label_0: { values: [['hero seg', 40], ['big', 3000]] } });
  const A = LG.diffSnapshots(base, cur);
  ok('twin with -90% count is not a rename', A.some((a) => a.code === 'value-gone'), JSON.stringify(A));
}
// small value slipping below a truncated top-250 -> info, big one -> warn, never crit
// (rows=4000: sigFloor 20, bigVal 40 — 'tail' sits between them, 'seg' is far above)
{
  const base = mkSnap(4000, { custom_label_0: { values: [['tail', 30], ['seg', 800], ['big', 3000]] } });
  const cur = mkSnap(4000, { custom_label_0: { values: [['big', 3000]], truncated: true } });
  const A = LG.diffSnapshots(base, cur);
  ok('truncation fallout: 30-SKU -> info, 800-SKU -> warn, no crit',
    A.some((a) => a.sev === 'info' && a.value === 'tail') && A.some((a) => a.sev === 'warn' && a.value === 'seg') && !A.some((a) => a.sev === 'crit'),
    JSON.stringify(A));
}

/* ---------- estate mail plan (PT Guard email-on-confirmed-warning) ---------- */
{
  const A1 = { sev: 'crit', code: 'value-gone', label: 'product_type', value: 'Womens > Skirts', msg: 'PT value "Womens > Skirts" GONE' };
  const A2 = { sev: 'warn', code: 'cov-drop', label: 'product_type', msg: 'PT coverage 98% -> 60%' };
  const key = LG.alertKey;
  eq('alertKey normalises value case/space', key({ code: 'value-gone', label: 'product_type', value: ' Womens >  Skirts ' }),
    key(A1));

  // scan 1: alert appears -> record only, never mail (one bad read never emails)
  const p1 = LG.estateMailPlan(undefined, [A1]);
  eq('first sighting mails nothing', [p1.mail.length, p1.mailed, p1.recovered], [0, [], false]);
  const entry1 = { alerts: [A1], mailed: p1.mailed };

  // scan 2: still there -> confirmed, mail once
  const p2 = LG.estateMailPlan(entry1, [A1]);
  eq('second consecutive sighting mails once', [p2.mail.length, p2.mailed.length, p2.recovered], [1, 1, false]);
  const entry2 = { alerts: [A1], mailed: p2.mailed };

  // scan 3: unchanged -> silent (already mailed this incident)
  const p3 = LG.estateMailPlan(entry2, [A1]);
  eq('third sighting stays silent', [p3.mail.length, p3.mailed.length], [0, 1]);

  // scan 4: a SECOND alert joins -> only the newcomer waits for its own confirmation
  const p4 = LG.estateMailPlan({ alerts: [A1], mailed: p3.mailed }, [A1, A2]);
  eq('new alert not mailed on its first sighting', p4.mail.length, 0);
  const p5 = LG.estateMailPlan({ alerts: [A1, A2], mailed: p4.mailed }, [A1, A2]);
  eq('new alert mails after its own second sighting', p5.mail.map((a) => a.code), ['cov-drop']);
  eq('mailed set now carries both incidents', p5.mailed.length, 2);

  // recovery: everything clears after a mailed incident -> one ✅
  const p6 = LG.estateMailPlan({ alerts: [A1, A2], mailed: p5.mailed }, []);
  eq('recovery flagged once everything clears', [p6.mail.length, p6.mailed, p6.recovered], [0, [], true]);
  // nothing was ever mailed -> a self-healing blip recovers silently
  eq('unmailed blip recovers silently', LG.estateMailPlan({ alerts: [A1], mailed: [] }, []).recovered, false);

  const mail = LG.estateAlertEmail('Reiss · GB', [A1, A2], 'https://x/ptypes');
  ok('alert email: subject line + both rows + link', mail.indexOf('🔴 PT Guard — Reiss · GB: 2 confirmed') === 0 &&
    mail.indexOf('[CRIT] PT value "Womens > Skirts" GONE') > 0 && mail.indexOf('two consecutive scans') > 0 &&
    mail.indexOf('https://x/ptypes') > 0, mail);
  ok('recovery email', LG.estateRecoveryEmail('Reiss · GB', 'https://x/ptypes').indexOf('✅ PT Guard — Reiss · GB recovered') === 0);
}

/* ---------- buildReport: PT section rides along when ptAlerts is supplied ---------- */
{
  const base = { now: 1754280000000, link: 'https://x/labels', rules: {}, dests: {}, idx: {}, alerts: {} };
  const rep = LG.buildReport(Object.assign({}, base, { ptAlerts: { 'Reiss|gb': { alerts: [
    { sev: 'crit', msg: 'PT value "Womens > Skirts" GONE - was on 700 SKUs' },
    { sev: 'info', msg: 'must not appear' } ] } } }));
  ok('report PT section header + crit line, info excluded', rep.indexOf('PRODUCT TYPE ALERTS — vs last known-good (1)') > 0 &&
    rep.indexOf('"Womens > Skirts" GONE') > 0 && rep.indexOf('must not appear') < 0, rep);
  ok('report PT empty state', LG.buildReport(Object.assign({}, base, { ptAlerts: {} }))
    .indexOf('last known-good category tree') > 0);
  ok('report without ptAlerts input has no PT section', LG.buildReport(base).indexOf('PRODUCT TYPE ALERTS') < 0);
}

/* ---------- depth granularity KPI (3/4/5-depth population %) ---------- */
eq('pathDepth chevrons', LG.pathDepth('Womenswear > Clothing > Dresses > Midi Dresses'), 4);
eq('pathDepth single level', LG.pathDepth('Dresses'), 1);
eq('pathDepth slash fallback', LG.pathDepth('Home/Kitchen/Kettles'), 3);
eq('pathDepth empty', LG.pathDepth('  '), 0);
eq('pathDepth trailing chevron ignored', LG.pathDepth('A > B > '), 2);
{
  const dp = LG.depthProfile([
    ['Womenswear > Clothing > Dresses > Midi', 5000],       // 4
    ['Mens > Footwear > Boots', 3000],                      // 3
    ['Womens > Clothing > Knitwear > Jumpers > Wool', 2000], // 5
  ]);
  eq('depthProfile SKU-weighted pcts', [dp.pct['3'], dp.pct['4'], dp.pct['5']], [30, 50, 20]);
  eq('depthProfile untouched buckets zero', [dp.pct['1'], dp.pct['2'], dp.pct['6+']], [0, 0, 0]);
  eq('depthProfile avg levels', dp.avg, 3.9);
  eq('depthProfile counted skus', dp.skus, 10000);
}
{
  const dp = LG.depthProfile([['A > B > C > D > E > F > G', 10], ['solo', 10]]);
  eq('depthProfile 6+ bucket + single-level', [dp.pct['6+'], dp.pct['1']], [50, 50]);
}
eq('depthProfile empty -> null', LG.depthProfile([]), null);
eq('depthProfile zero-count rows -> null', LG.depthProfile([['A > B', 0]]), null);

/* ---------- depth standard + the client ask ---------- */
{
  const mk = (p1, p2, p3, p4, p5) => ({ pct: { 1: p1, 2: p2, 3: p3, 4: p4, 5: p5, '6+': 0 }, avg: 4, skus: 1000 });
  eq('standard met (Reiss-style, 35% at 5-depth)', LG.depthStandard(mk(0, 5, 25, 35, 35)).level, 'ok');
  const below = LG.depthStandard(mk(0, 10, 30, 40, 20));
  eq('below the 5-depth benchmark', [below.level, below.pct5, below.target], ['below', 20, 30]);
  const shal = LG.depthStandard(mk(30, 31, 20, 15, 4));
  eq('too shallow (majority at 1-2 levels)', [shal.level, shal.shallow], ['shallow', 61]);
  eq('no profile -> null', LG.depthStandard(null), null);

  const dpB = mk(0, 10, 30, 40, 20);
  const mB = LG.depthAskEmail('Schuh', 'gb', dpB, LG.depthStandard(dpB));
  ok('ask email (below): subject + numbers + extend-to-5 variant',
    mB.subject.indexOf('Schuh GB') === 0 && mB.body.indexOf('• 5 levels: 20%') > 0 &&
    mB.body.indexOf('30–40% of product volume') > 0 && mB.body.indexOf('extending the highest-volume categories to 5-level paths') > 0 &&
    mB.body.indexOf('Best regards,\nRay') > 0, mB.body);
  const dpS = mk(30, 31, 20, 15, 4);
  const mS = LG.depthAskEmail('Schuh', 'gb', dpS, LG.depthStandard(dpS));
  ok('ask email (shallow): restructure-first variant + 1-2 share',
    mS.body.indexOf('restructuring the tree to 3–4 levels') > 0 && mS.body.indexOf('• 1–2 levels: 61%') > 0, mS.body);
}

/* ---------- Golden Record: attribute coverage vs Google's product data spec ---------- */
{
  ok('ATTR_SPEC: 7 always-required attributes', LG.ATTR_SPEC.filter((s) => s.req === 'required').length === 7);
  ok('ATTR_SPEC: four tiers only', LG.ATTR_SPEC.every((s) => ['required', 'cond', 'rec', 'ai'].includes(s.req)));
  eq('ATTR_SPEC: the conversational AI six', LG.ATTR_SPEC.filter((s) => s.req === 'ai').map((s) => s.key),
    ['question_and_answer', 'document_link', 'related_product', 'item_group_title', 'variant_option', 'popularity_rank']);

  const cols = LG.findAttrCols(['id', 'g:title', 'description', 'link', 'image link', 'availability', 'price',
    'brand', 'gtin', 'item_group_id', 'color', 'size', 'g:product_type(1)', 'sale_price', 'custom_label_0']);
  eq('findAttrCols: g:-prefixed + spaced headers resolve', [cols.title, cols.image_link], [1, 4]);
  eq('findAttrCols: product_type via slot-1 alias', cols.product_type, 12);
  eq('findAttrCols: absent attr -> -1', cols.gender, -1);
}
{
  // full scan with opts.attrs: the roster rides the SAME multi-count query
  const HEADER2 = '"id","g:title","description","link","image link","availability","price","brand","gtin","item_group_id","color","size","g:product_type(1)","sale_price","custom_label_0"\n"sku-1","Boot","d","u","i","in_stock","10","Reiss","123","g1","black","M","Womens > Boots","8","bestseller"';
  const routes2 = [
    ['select * limit 1', HEADER2],
    // count(A)=rows, count(O)=cl0, count(M)=product_type, then the attr columns in
    // ATTR_SPEC order (id + product_type reuse existing positions — no duplicate aggregates)
    ['select count(A), count(O), count(M), count(B), count(C), count(D), count(E), count(F), count(G), count(H), count(I), count(J), count(K), count(L), count(N)',
      '"h"\n"1000","950","980","1000","990","1000","1000","1000","1000","940","700","1000","850","900","240"'],
    ['select O, count(A)', '"cl0","c"\n"bestseller","950"'],
    ['select M, count(A)', '"pt","c"\n"Womens > Boots","980"'],
  ];
  const s = await LG.scanFeed(gvizMock(routes2), { id: 'X', gid: '0' },
    { client: 'Reiss', market: 'gb' }, LG.LABEL_KEYS.concat(LG.PT_KEYS), { attrs: true });
  ok('attrs captured on the snapshot', !!s.attrs);
  eq('attrs: required attr coverage', [s.attrs.title.cov, s.attrs.description.cov], [100, 99]);
  eq('attrs: id reuses the rows count', [s.attrs.id.filled, s.attrs.id.cov], [1000, 100]);
  eq('attrs: product_type reuses the label count position', s.attrs.product_type.cov, 98);
  eq('attrs: gtin 70%', s.attrs.gtin.cov, 70);
  ok('attrs: absent columns -> present:false', !s.attrs.mpn.present && !s.attrs.gender.present && !s.attrs.product_highlight.present);
  ok('no attrs without opts', !('attrs' in snap));

  const gs = LG.goldenScore(s.attrs);
  eq('goldenScore: weighted completeness', gs.score, 75.5);
  eq('goldenScore: no required attr missing', gs.reqMissing, []);
  eq('goldenScore: conditional gaps flagged', gs.condMissing, ['mpn', 'condition', 'gender', 'age_group']);
  ok('goldenScore: identifier pair merges into one part', gs.parts.filter((p) => p.key === 'gtin/mpn').length === 1 &&
    gs.parts.every((p) => p.key !== 'gtin' && p.key !== 'mpn'));
  ok('goldenScore: null on no attrs', LG.goldenScore(null) === null);
  // the conversational six: an AI-readiness KPI, never score input
  eq('goldenScore: ai KPI counts the six', gs.ai, { n: 0, of: 6,
    missing: ['question_and_answer', 'document_link', 'related_product', 'item_group_title', 'variant_option', 'popularity_rank'] });
  const withAi = Object.assign({}, s.attrs, { question_and_answer: { present: true, filled: 500, cov: 50 } });
  const gs2 = LG.goldenScore(withAi);
  ok('goldenScore: ai attrs never move the score', gs2.score === gs.score && gs2.ai.n === 1 &&
    gs2.parts.every((p) => p.key !== 'question_and_answer'));
}
{
  // ai tier alerts: warn-only, exactly like recommended
  const A = (cov) => ({ present: true, filled: 100, cov });
  const al = LG.diffCoverage(
    { attrs: { question_and_answer: A(60), popularity_rank: A(90) } },
    { attrs: { question_and_answer: A(40) } });
  ok('diffCoverage: ai drop + ai column gone are warn-only',
    al.length === 2 && al.every((a) => a.sev === 'warn'), JSON.stringify(al));
}
{
  const spec = (k) => LG.ATTR_SPEC.filter((s) => s.key === k)[0];
  const miss = LG.attrAskEmail('Schuh', 'gb', spec('color'), null);
  ok('attrAskEmail missing: subject + condition + PIM offer', miss.subject === 'Schuh GB — feed data: proposal to add g:color' &&
    miss.body.indexOf('does not currently carry g:color') > 0 &&
    miss.body.indexOf('required by Google in specific cases') > 0 &&
    miss.body.indexOf('PIM or product export') > 0 && miss.body.indexOf('Best regards,\nRay') > 0, miss.body);
  const low = LG.attrAskEmail('Reiss', 'gb', spec('sale_price'), 27);
  ok('attrAskEmail low-coverage: quotes fill % + structured pass', low.subject.indexOf('proposal to lift g:sale_price coverage') > 0 &&
    low.body.indexOf('filled on 27% of products') > 0 && low.body.indexOf('structured pass') > 0, low.body);
  const ai = LG.attrAskEmail('Reiss', 'gb', spec('question_and_answer'), null);
  ok('attrAskEmail ai: conversational framing', ai.body.indexOf('six conversational AI attributes') > 0 &&
    ai.body.indexOf('visibility advantage') > 0, ai.body);
}
{
  const A = (cov) => ({ present: true, filled: Math.round(cov * 10), cov });
  const base = { attrs: { availability: A(100), color: A(85), sale_price: A(40), product_highlight: A(50), title: A(100) } };
  const cur = { attrs: { availability: A(88), color: A(83.5), sale_price: A(27), title: A(98), material: A(60) } };
  const al = LG.diffCoverage(base, cur);
  eq('diffCoverage: required 12pp drop -> crit', al.filter((a) => a.sev === 'crit').map((a) => a.label), ['availability']);
  ok('diffCoverage: required crit says products will disapprove', al.filter((a) => a.label === 'availability')[0].msg.indexOf('products will disapprove') > 0);
  eq('diffCoverage: rec 13pp drop -> warn; rec column gone -> warn', al.filter((a) => a.sev === 'warn').map((a) => a.label).sort(), ['product_highlight', 'sale_price']);
  ok('diffCoverage: gone message carries the was%', al.filter((a) => a.code === 'attr-gone')[0].msg.indexOf('was 50% filled') > 0);
  eq('diffCoverage: new column -> info', al.filter((a) => a.sev === 'info').map((a) => a.label), ['material']);
  ok('diffCoverage: small drops below threshold stay silent', !al.some((a) => a.label === 'color' || a.label === 'title'));
  const gone = LG.diffCoverage({ attrs: { title: A(100) } }, { attrs: {} });
  ok('diffCoverage: required column vanished -> crit attr-gone', gone.length === 1 && gone[0].sev === 'crit' && gone[0].code === 'attr-gone');
  eq('diffCoverage: no refs -> empty', LG.diffCoverage(null, cur), []);
}
{
  const mail = LG.goldenAlertEmail('Reiss · GB', [{ sev: 'crit', msg: 'availability coverage dropped 12pp' }], 'https://x/golden');
  ok('golden alert email', mail.indexOf('🔴 Golden Record — Reiss · GB: 1 confirmed attribute alert') === 0 &&
    mail.indexOf('accept as known-good') > 0 && mail.indexOf('https://x/golden') > 0, mail);
  ok('golden recovery email', LG.goldenRecoveryEmail('Reiss · GB', 'https://x/golden').indexOf('✅ Golden Record — Reiss · GB recovered') === 0);
}
{
  const base = { now: 1754280000000, link: 'https://x/labels', rules: {}, dests: {}, idx: {}, alerts: {} };
  const rep = LG.buildReport(Object.assign({}, base, { grAlerts: { 'Reiss|gb': { alerts: [
    { sev: 'crit', msg: 'availability coverage dropped 12pp (was 100%, now 88%)' },
    { sev: 'info', msg: 'must not appear' } ] } } }));
  ok('report GR section header + crit line, info excluded', rep.indexOf('GOLDEN RECORD ALERTS — attribute coverage vs last known-good (1)') > 0 &&
    rep.indexOf('availability coverage dropped') > 0 && rep.indexOf('must not appear') < 0, rep);
  ok('report GR empty state', LG.buildReport(Object.assign({}, base, { grAlerts: {} }))
    .indexOf('attribute coverage holds on every scanned feed') > 0);
  ok('report without grAlerts input has no GR section', LG.buildReport(base).indexOf('GOLDEN RECORD ALERTS') < 0);
}

console.log(`\nLabel Guard engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
