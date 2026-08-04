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
