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
/* ---------- industry scoring profiles (the best-practice layer) ---------- */
{
  const pR = LG.profileFor('Reiss', null);
  eq('profileFor: Fashion defaults = the apparel five', [pR.industry, pR.expected],
    ['Fashion', ['color', 'size', 'gender', 'age_group', 'item_group_id']]);
  const pY = LG.profileFor('YuMOVE', null);
  eq('profileFor: Pet Care waives apparel-only recs', [pY.industry, pY.waived], ['Pet Care', ['size_type', 'size_system', 'pattern']]);
  eq('profileFor: unknown brand -> Retail, empty profile', LG.profileFor('Acme', null), { industry: 'Retail', expected: [], waived: [] });
  const ov = { industries: { Fashion: { expected: ['color'], waived: ['pattern'] } },
    clients: { Reiss: { expected: ['color', 'question_and_answer'] } } };
  eq('profileFor: brand override beats industry override beats default',
    LG.profileFor('Reiss', ov).expected, ['color', 'question_and_answer']);
  eq('profileFor: industry override applies to sibling brands', LG.profileFor('Superdry', ov),
    { industry: 'Fashion', expected: ['color'], waived: ['pattern'] });
  eq('profileFor: required + identifier attrs can never be profiled',
    LG.profileFor('Reiss', { clients: { Reiss: { expected: ['title', 'gtin', 'color'], waived: [] } } }).expected, ['color']);
  eq('profileFor: expected beats waived on a clash',
    LG.profileFor('Reiss', { clients: { Reiss: { expected: ['color'], waived: ['color', 'material'] } } }).waived, ['material']);
}
{
  // fixture attrs from the scan test above: gender/age_group absent, color 85 / size 90 present
  const HEADER2 = '"id","g:title","description","link","image link","availability","price","brand","gtin","item_group_id","color","size","g:product_type(1)","sale_price","custom_label_0"\n"x","B","d","u","i","in_stock","10","R","1","g","black","M","W > B","8","b"';
  const routes2 = [
    ['select * limit 1', HEADER2],
    ['select count(A), count(O), count(M), count(B), count(C), count(D), count(E), count(F), count(G), count(H), count(I), count(J), count(K), count(L), count(N)',
      '"h"\n"1000","950","980","1000","990","1000","1000","1000","1000","940","700","1000","850","900","240"'],
    ['select O, count(A)', '"cl0","c"\n"b","950"'],
    ['select M, count(A)', '"pt","c"\n"W > B","980"'],
  ];
  const s = await LG.scanFeed(gvizMock(routes2), { id: 'X', gid: '0' },
    { client: 'Reiss', market: 'gb' }, LG.LABEL_KEYS.concat(LG.PT_KEYS), { attrs: true });
  const apparel = LG.profileFor('Reiss', null);
  const gs = LG.goldenScore(s.attrs, apparel);
  eq('goldenScore + apparel profile: absent gender/age_group now count', gs.score, 68.8);
  ok('profiled parts carry the best-practice flag', gs.parts.some((p) => p.key === 'gender' && p.bp && p.missing && p.w === 2));
  eq('profile echoed on the result', gs.profile.industry, 'Fashion');
  const waivedGs = LG.goldenScore(s.attrs, { industry: 'Pet Care', expected: [], waived: ['size_type', 'size_system', 'pattern'] });
  eq('goldenScore + waivers: irrelevant recs drop out and lift the score', waivedGs.score, 81.5);
  const aiIn = LG.goldenScore(Object.assign({}, s.attrs, { question_and_answer: { present: true, filled: 500, cov: 50 } }),
    { industry: 'Fashion', expected: ['question_and_answer'], waived: [] });
  ok('goldenScore: an expected AI attr joins the score at weight 1',
    aiIn.parts.some((p) => p.key === 'question_and_answer' && p.w === 1 && p.bp) && aiIn.score !== LG.goldenScore(s.attrs).score);
  eq('goldenScore without profile unchanged', LG.goldenScore(s.attrs).score, 75.5);
  // ★ on a REC attr must MOVE the number (Ray, 16 Sep 2026: sale_price "doesn't actually
  // do anything") — rec attrs always score, so expected lifts them to weight 2.
  const recStar = LG.goldenScore(s.attrs, { industry: 'Fashion', expected: ['sale_price'], waived: [] });
  eq('goldenScore + ★ rec: sale_price at 24% weighs double, score drops', recStar.score, 74.3);
  ok('★ rec part carries w:2 + bp', recStar.parts.some((p) => p.key === 'sale_price' && p.w === 2 && p.bp && !p.missing));
  const recStarGone = LG.goldenScore(s.attrs, { industry: 'Fashion', expected: ['product_highlight'], waived: [] });
  eq('goldenScore + ★ absent rec: the gap counts at weight 2', recStarGone.score, 73.7);
  ok('★ absent rec part flagged missing at w:2', recStarGone.parts.some((p) => p.key === 'product_highlight' && p.w === 2 && p.bp && p.missing));
  eq('goldenScore + waived rec: sale_price drops out and lifts the score',
    LG.goldenScore(s.attrs, { industry: 'Fashion', expected: [], waived: ['sale_price'] }).score, 76.8);
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

/* ---------- xmlCrossCapture + crossFromRows (browser cross rails for {xml} feeds) ----
 * The capture must aggregate BY TAG NAME per <item> — independent of any header settled
 * from early items — so a sparse label first appearing past createXmlParser's 50-item
 * sample (Monsoon's custom_label_1, first filled at item #52) still lands. */
{
  const item = (id, cl0, cl1, cl2, pt) => '<item><g:id>' + id + '</g:id>' +
    (cl0 != null ? '<g:custom_label_0>' + cl0 + '</g:custom_label_0>' : '') +
    (cl1 != null ? '<g:custom_label_1>' + cl1 + '</g:custom_label_1>' : '') +
    (cl2 != null ? '<g:custom_label_2>' + cl2 + '</g:custom_label_2>' : '') +
    (pt != null ? '<g:product_type>' + pt + '</g:product_type>' : '') + '</item>';
  let xml = '<?xml version="1.0"?><rss><channel><title>Feed</title><item_group_id>ignored</item_group_id>';
  // 60 items: CL0 "Best Sellers" on all, CL2 alternates women - fp / women - sale,
  // CL1 appears ONLY from item #52 on — beyond any 50-item header sample
  for (let i = 1; i <= 60; i++) {
    xml += item('sku' + i, 'Best Sellers', i >= 52 ? 'sparse-late' : null,
      i % 2 ? 'women - fp' : 'women - sale', 'Women &gt; <![CDATA[Dresses & Gowns]]>' +
      '</g:product_type><g:product_type>keyword slot 2');
  }
  xml += item('skuNone', null, null, null, null);                       // no cross column at all — never joins a segment
  xml += item('skuOther', 'New In', null, ' women - fp ', 'Women > Tops');
  xml += '</channel></rss>';
  const cap = LG.xmlCrossCapture();
  for (let o = 0; o < xml.length; o += 97) cap.push(xml.slice(o, o + 97));   // ragged chunks — tags split mid-stream
  const rows = cap.end();
  eq('xmlCrossCapture keeps only items with a cross column', rows.length, 61);
  const x = LG.crossFromRows(rows, 'custom_label_0', 'Best Sellers', 'custom_label_2');
  eq('cross segment counts exact by-value matches', x.segment, 60);
  eq('cross rows: CL2 distribution within the segment',
    x.rows, [['women - fp', 30], ['women - sale', 30]]);
  eq('cross labelled/unlabelled', [x.labelled, x.unlabelled, x.truncated], [60, 0, false]);
  eq('cross response contract fields', [x.by, x.value, x.vs], ['custom_label_0', 'Best Sellers', 'custom_label_2']);
  // the sparse label that first appears at item #52 is still queryable
  const sparse = LG.crossFromRows(rows, 'custom_label_1', 'sparse-late', 'custom_label_2');
  eq('sparse late-appearing label captured (first at item #52)', sparse.segment, 9);
  // repeated product_type: only the FIRST slot is the category tree; CDATA + entities decode
  const pt = LG.crossFromRows(rows, 'custom_label_0', 'Best Sellers', 'product_type');
  eq('PT cross uses the first product_type slot, decoded', pt.rows, [['Women > Dresses & Gowns', 60]]);
  ok('keyword slot 2 never becomes a PT value', !pt.rows.some((r) => String(r[0]).indexOf('keyword') >= 0));
  // values are trimmed at capture, so " women - fp " groups with the clean form
  const other = LG.crossFromRows(rows, 'custom_label_0', 'New In', 'custom_label_2');
  eq('captured values are trimmed', other.rows, [['women - fp', 1]]);
  // unlabelled = segment rows with an empty vs column
  const un = LG.crossFromRows(rows, 'custom_label_2', 'women - fp', 'custom_label_1');
  eq('unlabelled counts segment rows missing the vs value', [un.segment, un.labelled, un.unlabelled],
    [31, un.rows.reduce((a, r) => a + r[1], 0), 31 - un.rows.reduce((a, r) => a + r[1], 0)]);
  ok('bad-cross: same key refused', (() => { try { LG.crossFromRows(rows, 'custom_label_0', 'x', 'custom_label_0'); return false; } catch (e) { return String(e.message).indexOf('bad-cross') === 0; } })());
  ok('bad-cross: empty value refused', (() => { try { LG.crossFromRows(rows, 'custom_label_0', '  ', 'custom_label_1'); return false; } catch (e) { return String(e.message).indexOf('bad-cross') === 0; } })());
}
{
  // truncation: >250 distinct vs values -> top 250 kept, tail folded into unlabelled
  const rows = [];
  for (let i = 0; i < 300; i++) rows.push(['seg', '', '', '', '', 'pt-' + i]);
  rows.push(['seg', '', '', '', '', 'pt-0']);   // pt-0 twice so the sort keeps it
  const t = LG.crossFromRows(rows, 'custom_label_0', 'seg', 'product_type');
  eq('truncated at TH.maxValues', [t.rows.length, t.truncated, t.segment], [250, true, 301]);
  eq('truncated tail folds into unlabelled', t.unlabelled, t.segment - t.labelled);
}

/* ---------- XML pipeline: sparse tags that debut PAST the parser's sample ---------- */
// The Monsoon GB regression (Ray, 10 Sep 2026): custom_label_1 lives on 458 of 8,898
// items and first appears at item #52 — one past the parser's 50-item union sample —
// so every guard scan read it as label-gone while the live feed carried it intact.
// The parser now GROWS its header on late-debut tags and hands consumers the live
// header; xmlCollector re-resolves its columns. This pipes the real parser into the
// real collector over a synthetic feed shaped like Monsoon.
{
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const FA = req('../docs/feedlab_engine.js');
  const item = (id, extra) => '<item><g:id>' + id + '</g:id><g:title>T</g:title><g:price>9 GBP</g:price>' +
    '<g:custom_label_2>core</g:custom_label_2><g:product_type>Women &gt; Dresses</g:product_type>' + (extra || '') + '</item>';
  let xml = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>';
  for (let i = 1; i <= 54; i++) xml += item('sku' + i);
  // custom_label_1 debuts at item 55 — past the 50-item sample — on 6 items total
  for (let i = 55; i <= 60; i++) xml += item('sku' + i, '<g:custom_label_1>' + (i % 2 ? 'HIGH' : 'LOW') + '</g:custom_label_1>');
  xml += '</channel></rss>';
  const col = LG.xmlCollector({ client: 'Monsoon', market: 'gb' });
  const parser = FA.createXmlParser(col.onRow);
  // push in tiny chunks so items split across push() boundaries too
  for (let o = 0; o < xml.length; o += 777) parser.push(xml.slice(o, o + 777));
  parser.end();
  const { snap } = col.finish();
  eq('xml pipe: all rows counted', snap.rows, 60);
  ok('xml pipe: late-debut custom_label_1 is PRESENT, never label-gone', snap.labels.custom_label_1.present === true);
  eq('xml pipe: late-debut label counts are exact', [snap.labels.custom_label_1.filled, snap.labels.custom_label_1.cov], [6, 10]);
  eq('xml pipe: late-debut value pivot', snap.labels.custom_label_1.values, [['HIGH', 3], ['LOW', 3]]);
  ok('xml pipe: sampled columns unaffected', snap.labels.custom_label_2.filled === 60 && snap.labels.product_type.filled === 60);
  ok('xml pipe: labels absent from the WHOLE feed still read absent', snap.labels.custom_label_0.present === false);

  // a late-debut ATTR (Golden Record roster) grows in the same way
  let xml2 = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>';
  for (let i = 1; i <= 54; i++) xml2 += item('sku' + i);
  for (let i = 55; i <= 58; i++) xml2 += item('sku' + i, '<g:sale_price>5 GBP</g:sale_price>');
  xml2 += '</channel></rss>';
  const col2 = LG.xmlCollector({ client: 'Monsoon', market: 'gb' });
  const parser2 = FA.createXmlParser(col2.onRow);
  parser2.push(xml2); parser2.end();
  const snap2 = col2.finish().snap;
  ok('xml pipe: late-debut Golden Record attr captured', snap2.attrs.sale_price.present === true && snap2.attrs.sale_price.filled === 4);
}


/* ---------- Content quality: the free-text attributes vs Google's own rules ---------- */
{
  eq('QSPEC: the eight free-text attributes', LG.QSPEC.map((q) => q.key),
    ['title', 'description', 'product_highlight', 'google_product_category', 'product_type', 'color', 'material', 'pattern']);
  ok('QSPEC: every rule carries a severity, a label, a Google quote', LG.QSPEC.every((q) => q.doc &&
    q.rules.every((r) => ['fail', 'warn'].includes(r.sev) && r.label && r.why && (r.test || r.dupe))));

  // caps: emphasis trips it, acronyms and a brand STYLED in capitals do not
  ok('shoutyCaps: shouting', LG.shoutyCaps('SALE NOW ON') && LG.shoutyCaps('CLEARANCEBARGAIN'));
  ok('shoutyCaps: acronyms + normal copy safe', !LG.shoutyCaps('Reiss Wool Coat XL UK') && !LG.shoutyCaps('USB-C Cable 2m'));
  ok('stripBrand: HUGO BOSS is a logo, not a shout',
    !LG.shoutyCaps(LG.stripBrand('HUGO BOSS Wool Blend Coat', 'HUGO BOSS')) &&
    LG.shoutyCaps(LG.stripBrand('HUGO BOSS COAT SALE NOW', 'HUGO BOSS')));
  eq('multiVals: repeatable fields split on |||', LG.multiVals('Waterproof|||Breathable|||  Lined  '),
    ['Waterproof', 'Breathable', 'Lined']);

  // a 10-row feed with one deliberate violation of each kind
  const HEAD = ['id', 'title', 'description', 'brand', 'product_highlight', 'google_product_category', 'product_type', 'color', 'material', 'pattern'];
  const cols = {}; HEAD.forEach((h, i) => { cols[h] = i; });
  const ROWS = [
    // clean baseline row, repeated so percentages are readable
    ['1', 'Reiss Margot Wool Blend Longline Coat in Camel, Size 12', 'A longline coat cut from an Italian wool blend with a notch lapel, welt pockets and a half lining. Falls below the knee, true to size, and finished with horn-effect buttons for a tailored winter silhouette that layers over knitwear.', 'Reiss', 'Italian wool blend|||Half lined|||Notch lapel|||Horn-effect buttons', 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets', 'Women > Coats & Jackets > Wool Coats', 'Camel', 'wool/polyester', 'Herringbone'],
    ['2', 'Reiss Elena Cotton Shirt Dress in Ivory, Size 10 Midi Length', 'A midi shirt dress in crisp cotton poplin with a self-tie waist, dropped shoulders and a hidden placket. Cut for an easy fit through the body with a gently gathered skirt that moves; wear it belted for the office or loose at the weekend.', 'Reiss', 'Cotton poplin|||Self-tie waist|||Hidden placket|||Midi length', 'Apparel & Accessories > Clothing > Dresses', 'Women > Dresses > Shirt Dresses', 'Ivory', 'cotton', 'Plain'],
    // 3: title over 150 + promo + caps
    ['3', 'SALE NOW ON ' + 'Reiss Luxury Cashmere Scarf in Charcoal with Hand Rolled Edges and a Gift Box Included Free Shipping This Weekend Only While Stocks Last Hurry'.padEnd(150, ' x'), 'Buy now and save £20 on this scarf. Visit www.example.com for more.', 'Reiss', 'Cashmere', '166', 'Accessories', '#3a3a3a', 'cashmere, silk', 'n/a'],
    // 4: HTML description + thin + single-level PT + placeholder material
    ['4', 'Reiss Belt', '<p>A leather belt.</p>', 'Reiss', 'Leather|||Leather', 'Apparel & Accessories', 'Belts', 'Black/Brown/Tan/Navy', 'none', 'PTN_04'],
    // 5: no brand in title, gimmick symbols, colour not a colour
    ['5', '★★★ Best Selling Midi Dress ★★★', 'A dress. It is a nice dress for many occasions and comes in several colours.', 'Reiss', 'Nice', 'Apparel & Accessories > Clothing > Dresses', 'Women>Dresses', 'variety', 'Cotton with a soft brushed finish for winter.', 'Striped/Plain'],
    // 6-10: clean rows to give the percentages a denominator
    ...[6, 7, 8, 9, 10].map((n) => ['' + n,
      'Reiss Hailey Slim Fit Trousers in Navy, Size ' + n + ' Tailored Ankle Length',
      'Slim-fit tailored trousers in a stretch wool blend with a mid rise, pressed creases and a cropped ankle. Fully lined to the knee with a hook-and-bar closure; pair with the matching blazer for a full suit or wear alone with knitwear.',
      'Reiss', 'Stretch wool|||Mid rise|||Pressed creases|||Ankle length',
      'Apparel & Accessories > Clothing > Pants', 'Women > Trousers > Tailored Trousers', 'Navy', 'wool/elastane', 'Plain']),
  ];
  const col = LG.qualityCollector(cols);
  ROWS.forEach((r) => col.onRow(r));
  const snap = col.finish({ client: 'Reiss', market: 'gb' });
  eq('qualityCollector: every row counted', snap.rows, 10);
  eq('quality: identity carried onto the snapshot', [snap.client, snap.market], ['Reiss', 'gb']);

  const t = snap.attrs.title;
  eq('title: all ten rows carry a title', t.filled, 10);
  eq('title: the over-length title is caught once', t.rules['len-over'].n, 1);
  eq('title: promotional copy caught', t.rules.promo.n, 1);
  eq('title: shouting caught (brand styling not counted)', t.rules.caps.n, 1);
  eq('title: decorative symbols caught', t.rules.gimmick.n, 1);
  eq('title: the one title without the brand is caught', t.rules['no-brand'].n, 1);
  ok('title: offenders are sampled for the page', t.rules.promo.eg.length === 1 && t.rules.promo.eg[0].length <= 140);

  const d = snap.attrs.description;
  eq('description: HTML markup caught', d.rules.html.n, 1);
  eq('description: a link caught', d.rules.links.n, 1);
  eq('description: thin copy caught', d.rules.thin.n, 3);
  eq('description: duplicated boilerplate caught across the five repeats', d.rules.dupe.n, 5);
  // a duplicate is reported as a GROUP — one value, its repeat count and the ids sharing it.
  // Ray read four unrelated titles under "title duplicated across products" on Monsoon GB and
  // called the finding wrong; the count was right, the evidence was unreadable.
  eq('dupe: one distinct value is duplicated, not five findings', d.rules.dupe.vals, 1);
  eq('dupe: the group is exported once', d.rules.dupe.groups.length, 1);
  eq('dupe: the group counts every product carrying the value', d.rules.dupe.groups[0].n, 5);
  eq('dupe: the group names the products, capped at four', d.rules.dupe.groups[0].ids, ['6', '7', '8', '9', '10'].slice(0, 4));
  ok('dupe: the example list names the value ONCE, not once per repeat',
    d.rules.dupe.eg.length === 1 && d.rules.dupe.eg[0] === d.rules.dupe.groups[0].v);
  ok('dupe: attrQuality carries the groups to the page',
    (() => { const b = LG.attrQuality('description', d).broken.filter((x) => x.id === 'dupe')[0];
      return b && b.vals === 1 && b.groups.length === 1 && b.groups[0].n === 5; })());
  // VARIANT AWARENESS (Ray, 16 Sep 2026: "there's definitely a discrepancy between the scoring
  // of content quality versus AI readiness … description for Superdry GB 60.1 but AI readiness
  // 89"). Google asks the TITLE to distinguish each variant, so a shared title counts however
  // it is shared; the DESCRIPTION rule is about boilerplate, and variants of one product
  // legitimately share copy — the same call the Feed Lab pillar makes, which is most of why the
  // two numbers diverged. Measured on the real Superdry GB feed: 99.7% of products vs 81.0%.
  {
    const cv = LG.qualityCollector({ id: 0, title: 1, description: 2, item_group_id: 3 });
    const D1 = 'A longline coat cut from an Italian wool blend with a notch lapel and welt pockets, half lined, true to size and finished with horn-effect buttons for a tailored winter silhouette.';
    const D2 = 'Slim-fit tailored trousers in a stretch wool blend with a mid rise, pressed creases and a cropped ankle, fully lined to the knee with a hook-and-bar closure for a sharp finish.';
    [['s1', 'Reiss Margot Coat in Camel, Size 8 Longline Wool Blend Notch Lapel', D1, 'G1'],
      ['s2', 'Reiss Margot Coat in Camel, Size 10 Longline Wool Blend Notch Lapel', D1, 'G1'],
      ['s3', 'Reiss Margot Coat in Camel, Size 12 Longline Wool Blend Notch Lapel', D1, 'G1'],
      ['t1', 'Reiss Hailey Trousers in Navy, Size 8 Tailored Slim Fit Ankle Length', D2, 'G2'],
      ['t2', 'Reiss Hailey Trousers in Navy, Size 8 Tailored Slim Fit Ankle Length', D2, 'G2'],
      ['u1', 'Reiss Something Else Entirely in Black, Size 10 With A Long Enough Name', D2, 'G3']].forEach((r) => cv.onRow(r));
    const av = cv.finish().attrs;
    eq('variant: a description shared only between variants of one product is NOT a finding',
      [av.description.rules.dupe.n, av.description.rules.dupe.vals], [3, 1]);
    eq('variant: …and is reported as context instead',
      [av.description.rules.dupe.within, av.description.rules.dupe.withinVals], [3, 1]);
    ok('variant: the only group shown is the one shared across DIFFERENT products',
      av.description.rules.dupe.groups.length === 1 && av.description.rules.dupe.groups[0].x === 1 &&
      av.description.rules.dupe.groups[0].n === 3, av.description.rules.dupe.groups);
    eq('variant: a title two variants share IS a finding — Google asks titles to distinguish variants',
      [av.title.rules.dupe.n, av.title.rules.dupe.vals, av.title.rules.dupe.within], [2, 1, undefined]);
    ok('variant: the title group is marked as variants, not different products',
      av.title.rules.dupe.groups[0].x === 0, av.title.rules.dupe.groups);
    ok('variant: the description rule says so in its own wording',
      /Variants of the SAME product/.test(LG.qspecOf('description').rules.filter((r) => r.dupe)[0].why));
  }
  // two different values each shared by two products = 4 products, 2 values — the Monsoon shape
  {
    const c2 = LG.qualityCollector({ id: 0, title: 1 });
    [['a1', 'Monsoon Blue Harper Regular Wide Leg Jeans, in Size: XL'],
      ['a2', 'Monsoon Blue Harper Regular Wide Leg Jeans, in Size: XL'],
      ['b1', 'Monsoon Blue Arizona Halter Ruffle Prom Dress, in Size: 9 Years'],
      ['b2', 'Monsoon Blue Arizona Halter Ruffle Prom Dress, in Size: 9 Years'],
      ['c1', 'Monsoon Blue Harper Short Wide Leg Jeans, in Size: L']].forEach((r) => c2.onRow(r));
    const dp = c2.finish().attrs.title.rules.dupe;
    eq('dupe: products involved counts both sides of each pair', dp.n, 4);
    eq('dupe: two distinct values shared', dp.vals, 2);
    eq('dupe: biggest groups first, each with its own products',
      dp.groups.map((g) => g.ids.join(',')).sort(), ['a1,a2', 'b1,b2']);
    eq('dupe: a title carried by ONE product is not in the evidence', dp.groups.length, 2);
  }

  eq('highlights: fewer than 2 caught', snap.attrs.product_highlight.rules['count-min'].n, 2);
  eq('highlights: the same highlight twice caught', snap.attrs.product_highlight.rules['dupe-in'].n, 1);
  eq('GPC: a bare numeric id is valid taxonomy', snap.attrs.google_product_category.rules['not-taxonomy'].n, 0);
  eq('GPC: a bare top-level name is shallow, not invalid', snap.attrs.google_product_category.rules.shallow.n, 1);
  eq('product_type: chevrons without spaces caught', snap.attrs.product_type.rules.sep.n, 1);
  eq('product_type: single level caught', snap.attrs.product_type.rules['single-level'].n, 2);
  eq('colour: hex code caught', snap.attrs.color.rules.hex.n, 1);
  eq('colour: "variety" is not a colour', snap.attrs.color.rules['not-colour'].n, 1);
  eq('colour: more than three colours caught', snap.attrs.color.rules['too-many'].n, 1);
  eq('material: placeholder caught', snap.attrs.material.rules.placeholder.n, 1);
  eq('material: comma separator caught', snap.attrs.material.rules.sep.n, 1);
  eq('material: prose caught', snap.attrs.material.rules.sentence.n, 1);
  eq('pattern: internal code caught', snap.attrs.pattern.rules.internal.n, 1);
  eq('pattern: two values caught', snap.attrs.pattern.rules.multi.n, 1);
  eq('pattern: placeholder caught', snap.attrs.pattern.rules.placeholder.n, 1);

  // scoring: a rule costs the share of products that break it, fails at full weight
  const q = LG.qualityScore(snap);
  ok('qualityScore: parts for every measured attribute', q.parts.length === 8);
  const ti = q.parts.filter((p) => p.key === 'title')[0];
  // title: len-over 10% + promo 10% + caps 10% + gimmick 10% (fails, ×1) = 40
  //        thin 10% + short 10% + no-brand 20% + space 10% + dupe 0 (warns, ×0.4) = 20
  eq('attrQuality: title scores 100 − fail% − 0.4×warn%', ti.score, 20);
  ok('attrQuality: worst rule sorts first', ti.broken[0].cost >= ti.broken[1].cost);
  eq('attrQuality: fail/warn counts', [ti.fails, ti.warns], [4, 3]);
  ok('qualityScore: weighted by attribute, not a flat mean',
    Math.abs(q.score - q.parts.reduce((s, p) => s + p.score * p.w, 0) / q.parts.reduce((s, p) => s + p.w, 0)) < 0.06);
  ok('qualityScore: verdict names the band', q.verdict.pill.indexOf('Spec violations') >= 0 && q.verdict.line.length > 40);
  eq('qualityVerdict: a clean feed reads as meeting the spec', LG.qualityVerdict(96, 0).band, 'good');
  eq('qualityVerdict: best-practice gap is its own band', LG.qualityVerdict(82, 0).band, 'mid');
  ok('attrQuality: an attribute nobody fills scores nothing', LG.attrQuality('title', { filled: 0 }) === null);

  // a perfect feed must actually reach 100 — no rule fires on compliant content
  const clean = LG.qualityCollector(cols);
  // titles padded past 70 chars: the clean feed must trip nothing at all, 'short' included
  [ROWS[0], ROWS[1], ...ROWS.slice(5)].forEach((r, i) => clean.onRow(r.map((c, j) => {
    if (j === 1) return c + ' with Notch Lapel and Half Lining ' + (i + 1);
    if (j === 2) return c + ' Style reference ' + (i + 1) + '.';   // unique per product, as the spec asks
    return c;
  })));
  const cq = LG.qualityScore(clean.finish());
  ok('a spec-compliant feed scores 100 on title + description',
    cq.parts.filter((p) => p.key === 'title')[0].score === 100 &&
    cq.parts.filter((p) => p.key === 'description')[0].score === 100, JSON.stringify(cq.parts.filter((p) => p.key === 'title')[0].broken));

  // the client ask
  const mail = LG.qualityAskEmail('Reiss', 'gb', ti);
  ok('qualityAskEmail: names the feed, the score and the top rules',
    mail.subject.indexOf('Reiss GB') === 0 && mail.subject.indexOf('g:title') > 0 &&
    mail.body.indexOf(ti.score + '/100') > 0 && mail.body.indexOf('% of products') > 0 &&
    mail.body.indexOf('disapproval') > 0 && mail.body.indexOf('Best regards,\nRay') > 0, mail.body);
  const warnOnly = LG.qualityAskEmail('Reiss', 'gb', { key: 'material', score: 88, filled: 100, fails: 0, broken: [{ label: 'a sentence', pct: 12, n: 12, why: 'w', sev: 'warn' }] });
  ok('qualityAskEmail: no requirement broken -> performance framing, not compliance',
    warnOnly.body.indexOf('best practices rather than hard rules') > 0 && warnOnly.body.indexOf('disapproval') < 0);

  // memory: duplicate tracking is bounded, never unbounded on a huge feed
  ok('qualityCollector: example offenders capped at 4',
    Object.keys(snap.attrs).every((k) => Object.keys(snap.attrs[k].rules).every((r) => snap.attrs[k].rules[r].eg.length <= 4)));
}

{
  // ---- A REPEATABLE ATTRIBUTE LIVES IN SEVERAL COLUMNS (Ray, 16 Sep 2026: "I don't think a
  // highlight quality scan is accurate because when I look inside Monsoon Shopping UK, each
  // product has at least four to five highlights, so why is it now showing as zero point?").
  // Monsoon GB ships four repeated <g:product_highlight> elements per item; the XML parser
  // expands them to g:product_highlight, (2), (3), (4); the quality read resolved ONE column,
  // saw one value, and fired "fewer than 2 highlights" on 100% of the catalogue. Measured on
  // the live feed: 0/100 before, 91.1/100 after, 4.1 highlights per product.
  console.log('\n— repeatable attributes: every column, not the first one —');
  const H = ['id', 'title', 'g:product_highlight', 'g:product_highlight(2)', 'g:product_highlight(3)', 'g:product_highlight(4)'];
  const mc = LG.findMultiCols(H);
  eq('findMultiCols: the whole slot set, namespace and (n) suffixes folded', mc.product_highlight, [2, 3, 4, 5]);
  eq('findMultiCols: only repeatable attributes have slots', Object.keys(mc), ['product_highlight']);
  const ROW = (a, b, c, d) => ['1', 'Monsoon Blue Arizona Halter Ruffle Prom Dress, in Size: 12', a, b || '', c || '', d || ''];
  const four = [ROW('High neck', 'Outer: Polyester 100%', 'Short Sleeves', 'Button fastening'),
    ROW('Square neck', 'Lining: Cotton 100%', 'Short Sleeves', 'Pull on')];
  {
    const c = LG.qualityCollector(LG.findAttrCols(H), { header: H });
    four.forEach((r) => c.onRow(r));
    const a = c.finish().attrs.product_highlight;
    eq('four repeated highlights are read as four, not one', a.perProduct, 4);
    eq('and the read says how many columns it covered', a.cols, 4);
    eq('so "fewer than 2 highlights" does not fire', a.rules['count-min'].n, 0);
    eq('nor "fewer than 4"', a.rules['count-low'].n, 0);
    ok(LG.attrQuality('product_highlight', a).score === 100,
      'a feed with four clean highlights scores 100, not 0', LG.attrQuality('product_highlight', a));
    ok(a.avgLen > 0 && a.avgLen < 40 && a.maxLen < 40,
      'length is measured PER HIGHLIGHT, not across four glued together', [a.avgLen, a.minLen, a.maxLen]);
  }
  {
    // the bug, pinned: reading one column of four is what produced the wrong finding
    const c = LG.qualityCollector(LG.findAttrCols(H));   // no header → single-column fallback
    four.forEach((r) => c.onRow(r));
    const a = c.finish().attrs.product_highlight;
    eq('without the header the old single-column read is preserved exactly', a.perProduct, 1);
    eq('…which is precisely what fired the wrong finding', a.rules['count-min'].n, 2);
  }
  {
    // the ||| form still works, and mixes with slots
    const c = LG.qualityCollector(LG.findAttrCols(H), { header: H });
    c.onRow(ROW('One|||Two', 'Three', 'Three'));
    const a = c.finish().attrs.product_highlight;
    eq('a |||-joined cell and sibling columns are one list', a.perProduct, 4);
    eq('duplicate detection works ACROSS the slots', a.rules['dupe-in'].n, 1);
  }
  {
    // a feed that really does ship one highlight is still caught
    const c = LG.qualityCollector(LG.findAttrCols(H), { header: H });
    c.onRow(ROW('High neck'));
    eq('one highlight is still one highlight', c.finish().attrs.product_highlight.rules['count-min'].n, 1);
  }
  const page = readFileSync(new URL('../docs/FeedSpark_GoldenRecord.html', import.meta.url), 'utf8');
  ok(/qualityCollector\(cols, \{ header: header \}\)/.test(page),
    'the page hands the collector the header, or the fix never reaches a real scan');
  ok(/read across <b>' \+ r\.cols/.test(page),
    'and the row shows what it counted across — a count nobody can check is a count nobody should trust');
}

{
  // ---- the scan's PROGRESS, wired end to end (Ray, 16 Sep 2026: "allow the user to see a
  // progress bar indicating how long it will take to scan the feed quality"). A bar needs the
  // size of the read up front, so the worker forwards the upstream length and the page reads
  // it; if either side goes missing the bar silently becomes a lie, so both are pinned here.
  console.log('\n— content-quality scan progress —');
  const page = readFileSync(new URL('../docs/FeedSpark_GoldenRecord.html', import.meta.url), 'utf8');
  const wk = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
  ok('worker: the feed proxy declares the XML feed’s size as x-feed-bytes',
    /x-feed-bytes/.test(wk) && /content-encoding/.test(wk.split('x-feed-bytes')[0].slice(-400)));
  ok('worker: it is never forwarded as content-length (that truncates a decoded stream)',
    !/xh\[['"]content-length/.test(wk));
  ok('page: the scan reads that header', /x-feed-bytes/.test(page));
  ok('page: the progress band, bar and its two readouts exist',
    ['id="qz-scan"', 'id="qz-pbar"', 'id="qz-pfill"', 'id="qz-ptxt"', 'id="qz-peta"'].every((s) => page.indexOf(s) > 0));
  ok('page: an undeclared size falls back to an indeterminate bar, never a fake percentage',
    /qz-pbar indet/.test(page) && /size not declared/.test(page));
  ok('page: the band is hidden on paper', /body\.pdf[^{]*\.qz-scan\{display:none/.test(page.replace(/\s+/g, ' ')) || /\.qz-scan\{display:none!important\}/.test(page.replace(/,body\.pdf/g, ',body.pdf')));
  // etaWords lifted out of the page by name and run — the words a human reads off the bar
  const etaWords = new Function('return ' + (page.match(/function etaWords\(s\) \{[\s\S]*?\n  \}/) || [])[0])();
  eq('etaWords: nothing to say without a rate', etaWords(0), '');
  eq('etaWords: seconds', [etaWords(4), etaWords(23)], ['a few seconds left', '~25s left']);
  eq('etaWords: minutes', etaWords(200), '~3m 15s left');

  // ---- the estate scorecard collapses per brand, and all at once (Ray, 17 Sep 2026: "Golden
  // record in the dossier scorecard; allow button to expand or collapse 'all' or individual
  // brand option"). Behaviour is covered end-to-end by the browser QA in the scratchpad; these
  // are the structural guarantees a future refactor should not lose silently.
  console.log('\n— estate scorecard: per-brand + collapse-all —');
  ok('a device-scoped preference key, like the sibling gr-ref/gr-demo toggles',
    /localStorage\.getItem\('gr-collapse'/.test(page) && /localStorage\.setItem\('gr-collapse'/.test(page));
  ok('Array.from, not Array.prototype.slice — a Set has no indices to slice',
    /Array\.from\(COLLAPSED\)/.test(page) && !/Array\.prototype\.slice\.call\(COLLAPSED\)/.test(page));
  ok('a collapsed card still carries its score, market count and req/crit/warn — folding a brand can never hide a live alert',
    /function estSummary/.test(page) && /est-flag crit/.test(page) && /est-flag warn/.test(page));
  ok('the header click toggles ONE brand; the section button toggles every one',
    /function toggleCollapse/.test(page) && /collapseAllEl\.onclick/.test(page));
  ok('the global button always names the action still available (⊖ collapse vs ⊕ expand), not a fixed label',
    /⊖ Collapse all/.test(page) && /⊕ Expand all/.test(page));
  ok('a mixed state collapses the rest first, rather than picking arbitrarily',
    /var allDown = clients\.length > 0 && clients\.every/.test(page));
  ok('the ?client= deep-link opens a folded card via a cross-scope bridge, rather than landing on it shut',
    /window\.__grExpand/.test(page) && /target\.classList\.contains\('collapsed'\)/.test(page));
  ok('the header row is a real tap target on the phone floor (padding, not just line-height)',
    /\.est-hd\{display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 0/.test(page));

  // ---- the pinned scorecard header (Ray, 16 Sep 2026: "when using the Golden Score card and
  // scrolling down to review the feed scorecard, make sure this section stays frozen when
  // scrolling down"). Three things have to hold together or the header silently stops working.
  console.log('\n— the pinned scorecard header —');
  ok('the header block is sticky, under a MEASURED topbar offset (it is sticky itself)',
    /\.gr-sticky\{position:sticky;top:var\(--stick/.test(page) && /--stick', GR_TOP \+ 'px'/.test(page));
  ok('it condenses once pinned rather than freezing a wall across the viewport',
    /\.gr-sticky\.stuck \.gr-verdict\{display:none\}/.test(page) && /\.gr-sticky\.stuck \.dial\{width:74px/.test(page));
  ok('what an AM needs while reading rows is NOT hidden — the Δ reference and the actions',
    !/\.gr-sticky\.stuck \.refseg\{display:none/.test(page) && !/\.gr-sticky\.stuck \.det-actions\{display:none/.test(page));
  ok('the stuck state is read off the element itself, not a sentinel that a re-render detaches',
    /function grStick/.test(page) && !/gr-sent/.test(page));
  ok('it is opaque, so rows scroll under it rather than through it',
    /\.gr-sticky\{position:sticky;[^}]*background:#fff/.test(page) && /\[data-theme=dark\] \.gr-sticky\{background:var\(--paper\)\}/.test(page));
  ok('on a phone it scrolls away like anything else', /@media\(max-width:760px\)\{\.gr-sticky\{position:static/.test(page));
  ok('paper gets the page AT REST — print un-pins it and the condensing pass stands down',
    /body\.pdf \.gr-sticky\{position:static!important/.test(page) &&
    /!document\.body\.classList\.contains\('pdf'\) &&\s*\n\s*el\.getBoundingClientRect\(\)\.top <= GR_TOP/.test(page) &&
    /gs\.className = 'gr-sticky'/.test(page));
}

console.log(`\nLabel Guard engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
