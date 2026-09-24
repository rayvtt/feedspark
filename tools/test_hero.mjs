#!/usr/bin/env node
/*
 * THE HERO KPIs COME FROM THE PROJECT PLANS — WORKFLOW'S SOURCE (Ray, 22 Sep 2026).
 *
 *   "Can you disconnect the ATRT checker entirely from FCC? … Now I have moved on from ATRT and
 *    just use Workflow to monitor the tasks across all clients from their own project plan. So
 *    the number that you showed there should also reflect it from Workflow, not ATRT."
 *
 * The landing strip (Active · Overdue · Due next 7 days · Tests running · Accounts) used to be
 * spliced into the page source from a retired tracker export by a sync tool, and a `window.ATRT`
 * global fed the dossier list, the health model and the Monday catch-up. All of that is gone.
 * The strip is now computed in the page from PT — the project plans, baked at build and replaced
 * brand by brand as /api/plan/live lands — and this pins the three things that would make the
 * number disagree with the Workflow board:
 *
 *   · the DATE RULE is Workflow's own parseUKDate, ported verbatim — the two function bodies are
 *     asserted IDENTICAL, so a fix on one page cannot leave the other counting differently;
 *   · OVERDUE is the board's rule exactly — dated before today and not Done — with the team's
 *     shared overlays applied first (a status or due date set on the board wins over the sheet,
 *     a deleted row is off the board entirely, a hidden row is never chased);
 *   · a plan that has NOT synced contributes NO overdue figure — it cannot, its baked rows carry
 *     a month stub instead of a due date — and the model says how many live plans it counted.
 *
 * The functions are lifted out of the pages by name, so the shipped code is what runs here.
 * Run: node tools/test_hero.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CC = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');
const WF = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Workflow.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced: ' + name);
}

/* ====================================================== THE TRACKER IS GONE =============== */
console.log('\nthe tracker is gone');
ok('no window.ATRT global on the page', !/window\.ATRT/.test(CC));
ok('no ATRT splice markers left in the page', !/ATRT:(KPI|TESTS|BENCH|GLOBAL|PLANS|LOG)/.test(CC));
ok('no tracker <details> blocks', !/atrt-detail/.test(CC));
ok('nothing on the page reads A.overdue / A.active / A.brands / A.scores / A.plantasks',
  !/\bA\.(overdue|active|brands|scores|benchmarks|plantasks|synced)\b/.test(CC));
ok('the tracker export is deleted', !fs.existsSync(path.join(ROOT, 'docs', 'atrt_data.json')));
ok('the splice tool is deleted', !fs.existsSync(path.join(ROOT, 'tools', 'sync_atrt.py')));
ok('the hero strip ships EMPTY — nothing baked into the source', /<div class="statstrip" id="kpi"><!--[^]*?--><\/div>/.test(CC) && !/id="kpi">[^]*?<div class="s">[^]*?<\/div>\s*<div class="synced">/.test(CC.slice(CC.indexOf('id="kpi"'), CC.indexOf('id="kpi"') + 600)));
ok('the synced line names the project plans, not a tracker', /Project plans synced <span id="synced">/.test(CC) && !/ATRT Tracker synced/.test(CC));
ok('the count-up that read the splice is gone (renderHero owns the animation)', !/Count the figures up/.test(CC) && /function heroCount\(/.test(CC));
ok('renderHero is what fills the strip', /function renderHero\(/.test(CC) && /window\.__fccHero=\{model:heroModel,render:renderHero\}/.test(CC));
ok('the plans modal renders from the dossier store (renderPlans), not a splice', /function renderPlans\(/.test(CC) && /id="plans-list"/.test(CC));
ok('the Monday catch-up reads PT[b].over', /od:PT\[b\]\.over\|\|0/.test(CC));

/* ================================================== ONE DATE RULE, TWO PAGES ============= */
console.log('\none date rule on both pages');
const wfSrc = lift(WF, 'parseUKDate');
const ccSrc = lift(CC, 'wfDate');
const norm = (s, name) => s.replace('function ' + name + '(', 'function X(').replace(/\s+/g, ' ').trim();
ok('wfDate on the Command Center IS parseUKDate on Workflow, byte for byte after the rename',
  norm(ccSrc, 'wfDate') === norm(wfSrc, 'parseUKDate'), { cc: norm(ccSrc, 'wfDate').slice(0, 120), wf: norm(wfSrc, 'parseUKDate').slice(0, 120) });

/* ========================================================== THE MODEL ==================== */
console.log('\nthe overdue rule is the board’s');
const ctx = { console, Date, Math, RegExp, String, Number, Object, Array, isNaN, parseInt };
vm.createContext(ctx);
const bucketSrc = lift(CC.slice(CC.indexOf('function shStatus()')), 'bucketOf');
vm.runInContext([
  'var PT={}, B={}, GIT={};',
  ccSrc, lift(CC, 'wfToday'), bucketSrc,
  lift(CC, 'ptFromLive'), lift(CC, 'heroModel'),
].join('\n'), ctx);

const T0 = new Date(); T0.setHours(0, 0, 0, 0);
const day = (n) => { const d = new Date(T0); d.setDate(d.getDate() + n); return d; };
const uk = (d) => ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
const stub = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-01';   // the worker's month-section stub
const lastMonthStub = stub(new Date(T0.getFullYear(), T0.getMonth() - 1, 1));

const rows = [
  { t: 'A past, open',            o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: uk(day(-7)) },
  { t: 'B month stub, open',      o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: lastMonthStub },
  { t: 'C due in 3 days',         o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: uk(day(3)) },
  { t: 'D past, done',            o: 'Ray', s: 'Done',        b: 'done', c: 'opt',  d: uk(day(-7)) },
  { t: 'E date typed into status', o: 'Ray', s: uk(day(-2)),  b: 'open', c: 'opt',  d: '' },
  { t: 'F deleted on the board',  o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: uk(day(-7)) },
  { t: 'G hidden on the board',   o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: uk(day(-7)) },
  { t: 'H board says Done',       o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: uk(day(-7)) },
  { t: 'I board re-dated',        o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: uk(day(-7)) },
  { t: 'J on hold, past',         o: 'Ray', s: 'On Hold',     b: 'hold', c: 'opt',  d: uk(day(-7)) },
  { t: 'K test, no date',         o: 'Ray', s: 'Test running', b: 'open', c: 'test', d: '' },
  { t: 'L test, done',            o: 'Ray', s: 'Done',        b: 'done', c: 'test', d: '' },
  { t: 'M due in exactly 7 days', o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: uk(day(7)) },
  { t: 'N due in 8 days',         o: 'Ray', s: 'Open',        b: 'open', c: 'opt',  d: uk(day(8)) },
];
const ov = { s: { 'H board says Done': 'Done' }, d: { 'I board re-dated': uk(day(5)) }, del: { 'F deleted on the board': 1 }, hid: { 'G hidden on the board': 1 } };
const p = vm.runInContext('ptFromLive(' + JSON.stringify(rows) + ',"live 10:00",' + JSON.stringify(ov) + ')', ctx);

ok('a live plan is stamped live', p.live === true);
ok('a deleted row is off the board entirely — 13 of 14 rows counted', p.total === 13, p.total);
ok('overdue = dated before today and not Done: A, B (month stub — the board reads it as the 1st), E (date in the status cell), J (on hold counts, only Done is excused) = 4',
  p.over === 4, p.over);
ok('a hidden row keeps its place in the totals but is never chased as overdue', p.open >= 1 && p.over === 4);
ok('the board’s Done wins over the sheet’s Open (H is not overdue, and is done)', p.done === 3, p.done);
ok('the board’s re-date wins over the sheet’s (I moved from overdue to due-soon)', p.due7 === 3, p.due7);
ok('due next 7 days is inclusive of day 7 and excludes day 8 (C, I, M — not N)', p.due7 === 3);
ok('on hold is not active', p.hold === 1 && p.open === 9, { hold: p.hold, open: p.open });
ok('test tasks are counted by category', p.cats.test && p.cats.test.total === 2 && p.cats.test.done === 1, p.cats.test);
ok('the overlay status is what the row shows', p.latest.find((x) => x.t === 'H board says Done').s === 'Done');

// without overlays the same rows read the sheet as written
const p0 = vm.runInContext('ptFromLive(' + JSON.stringify(rows) + ',"live 10:00")', ctx);
ok('no overlays: every row counted, F and G and H and I all overdue = 8', p0.total === 14 && p0.over === 8, { total: p0.total, over: p0.over });

// the same rows through Workflow's own overdue test, row by row
const wfCtx = { Date, Math, RegExp, String, Number, isNaN, parseInt };
vm.createContext(wfCtx);
vm.runInContext(wfSrc + '\n' + lift(WF, 'today') + '\nfunction od(d,b){var x=parseUKDate(d); return !!(x&&x<today()&&b!=="done");}', wfCtx);
const wfOver = rows.filter((r) => !ov.del[r.t] && !ov.hid[r.t]).filter((r) => {
  const b = ov.s[r.t] ? (ov.s[r.t] === 'Done' ? 'done' : 'open') : r.b;
  let dd = ov.d[r.t] != null ? ov.d[r.t] : (r.d || ''); if (!dd && /\d{1,2}[\/-]\d{1,2}|\d{1,2}\s+[a-z]{3}/i.test(r.s)) dd = r.s;
  return vm.runInContext('od(' + JSON.stringify(dd) + ',' + JSON.stringify(b) + ')', wfCtx);
}).length;
ok('Workflow’s own parseUKDate + overdue test on the same rows lands on the same count', wfOver === p.over, { wf: wfOver, cc: p.over });

/* ========================================================== THE STRIP ==================== */
console.log('\nthe strip sums the plans');
vm.runInContext('PT={Live:' + JSON.stringify(p) + ', Baked:{score:50,total:20,done:15,open:5,hold:0,cats:{test:{total:3,done:1}},latest:[]}}; B={Live:{},Baked:{},NoPlan:{}}; GIT={A:1};', ctx);
const m = vm.runInContext('heroModel()', ctx);
ok('Active = open tasks across every plan, baked and live (9 + 5)', m.active === 14, m.active);
ok('Overdue and due-soon come from LIVE plans only — a baked plan has no due dates to offer', m.over === 4 && m.due7 === 3 && m.live === 1, m);
ok('Tests running = test tasks not done, the Tests section’s own figure (1 + 2)', m.tests === 3, m.tests);
ok('Accounts = brands in the dossier, plan or no plan', m.accounts === 3, m.accounts);
ok('plans counted', m.plans === 2, m.plans);
vm.runInContext('B={};', ctx);
ok('before the dossier store lands, Accounts falls back to the git-bundled brands', vm.runInContext('heroModel()', ctx).accounts === 1);

/* ============================================================ WIRING ===================== */
console.log('\nwiring');
ok('liveSync stores the raw rows and rebuilds through the brand overlay', /LIVE_RAW\[k\]=\{tasks:b\.tasks,stamp:stamp\}; PT\[k\]=ptFromLive\(b\.tasks,stamp,brandOverlay\(k\)\)/.test(CC));
ok('liveSync re-renders the hero after every pull', /renderHero\(\);\n\s+if\(ok\)\{ if\(cur\)render\(cur\);/.test(CC));
ok('the synced line says how many plans are in', /' of '\+n\+' plan'/.test(CC));
ok('the shared overlays are read in one call and rebuild the live plans', /\/api\/state\?ns=taskstatus,taskdue,deleted,hidden/.test(CC) && /rebuildLive\(\); renderHero\(\);/.test(CC));
ok('buildList re-renders the hero and the plans modal', /renderHero\(\); renderPlans\(\);\n\s+\}/.test(CC));
ok('the dossier list sorts by plan activity, flags plan overdue', /var n=act\(name\), od=\(PT\[name\]&&PT\[name\]\.over\)\|\|0/.test(CC));
ok('the health model docks for plan overdue', /var p=PT\[name\]\|\|null, od=\(p&&p\.over\)\|\|0;/.test(CC));
// CLAUDE.md may still NAME the retired tool once, past tense, to say it's gone — but nothing
// may tell a session to run it, and nothing outside that one historical line may mention it.
const claudeMd = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
ok('CLAUDE.md never instructs running the splice tool', !/python tools\/sync_atrt\.py/.test(claudeMd));
ok('no other repo tool or doc still points at the splice tool', !fs.readFileSync(path.join(ROOT, 'docs', 'WAYS_OF_WORKING.md'), 'utf8').includes('sync_atrt') && !fs.readFileSync(path.join(ROOT, 'tools', 'overlap.sh'), 'utf8').includes('atrt'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
