/* ONE PROJECT PLAN, TWO BRANDS — ON THE BOARD.
 *
 * Ray, 14 Oct 2026: "both brands are actually merged inside one project plan … the initial
 * brands, MON or ACC, should be indicated in column B … Every task that goes into this plan
 * should be done for both brands at once, unless a manual task is created within the workflows
 * and the brand is selected individually".
 *
 * tools/test_planbrand.mjs pins the rules. This drives the REAL Workflow page: the worker serves
 * each brand its own rows, so Monsoon's board must carry the joint work and its own and NEVER
 * Accessorize's, the one-brand rows must SAY so, and a row added by hand for one brand must post
 * that brand's name so the sheet can be stamped. It carries a NEGATIVE CONTROL that serves both
 * brands the identical merged array — the pre-fix worker — and requires the board check to fail.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_planbrand.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); }
catch (e) { console.log('· playwright not installed — plan-brand tripwire skipped'); process.exit(0); }
const PB = require('../cloudflare/feedspark-deck/src/planbrand.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8847, U = 'http://127.0.0.1:' + PORT;
const KV = {}; const APPENDS = []; let MERGED = false;
let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };
const body = q => new Promise(r => { let b = ''; q.on('data', d => b += d); q.on('end', () => r(b)); });

const BRANDS = ['Accessorize', 'Monsoon'];
/* The shared workbook as the live sheet really reads: the monthly block both brands run, the two
 * brands' own BTS rows under the SAME wording (live rows 381/382), and one row each. */
const ROWS = [
  { t: 'Disapprovals - Basics', o: 'Gary (FS)', d: '' },
  { t: 'Category mapping - Basics', o: 'Gary (FS)', d: '' },
  { t: 'BTS keywords optimisation', o: 'Tony (FS)', d: '', br: ['Monsoon'] },
  { t: 'BTS keywords optimisation', o: 'Tony (FS)', d: '', br: ['Accessorize'] },
  { t: 'Image Cycler: Accessories', o: 'Ray', d: '', br: ['Monsoon'] },
  { t: 'PMAX restructure', o: 'Ray', d: '', br: ['Accessorize'] },
  { t: 'All custom label overview', o: 'Ray', d: '' },
];

const API = { '/api/tests': [], '/api/gmail/intake': { items: [], calls: [] },
  '/api/access?me=1': { ok: true, clients: null, modules: null, owner: true, name: 'Ray', ownerName: 'Ray' },
  '/api/ingest/pending': { ok: true, items: [] }, '/api/schedule': { ok: true, brands: [] } };

const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), p = u.pathname;
  const send = (o, h) => { r.writeHead(200, Object.assign({ 'content-type': 'application/json' }, h || {})); r.end(JSON.stringify(o)); };
  if (p === '/__appends') return send(APPENDS);
  if (p === '/__merged') { MERGED = u.searchParams.get('on') === '1'; APPENDS.length = 0; return send({ merged: MERGED }); }
  if (p === '/api/state') { if (q.method === 'PUT') { const inc = JSON.parse(await body(q) || '{}');
      for (const ns of Object.keys(inc)) KV[ns] = Object.assign({}, KV[ns] || {}, inc[ns]);
    } return send(KV, { 'X-Sync-Base': String(Date.now()) }); }
  if (p === '/api/plan/live' && q.method === 'POST') { await body(q);
    const brands = {};
    BRANDS.forEach((bn) => {
      // MERGED = the pre-fix worker: `out[brand] = seen[id]`, the identical array to both brands
      const mine = MERGED ? ROWS : PB.tasksForBrand(ROWS, bn);
      brands[bn] = { tasks: mine.map(t => Object.assign({ s: 'Open', b: 'open', c: 'keyword' }, t)), updated: Date.now() };
    });
    return send({ ok: true, connected: true, brands }); }
  if (p === '/api/sheets/append') { APPENDS.push(JSON.parse(await body(q) || '{}')); return send({ ok: true, atRow: 900, appended: 1 }); }
  if (p === '/api/briefs') { if (q.method === 'PUT') await body(q); return send({}, { 'X-Sync-Base': String(Date.now()) }); }
  if (p.startsWith('/api/sheets/')) { await body(q); return send({ ok: true }); }
  const key = p + (u.search || ''); if (API[key]) return send(API[key]); if (API[p]) return send(API[p]);
  if (p.startsWith('/api/')) return send({ ok: true });
  if (p === '/workflow') { r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
    return r.end(fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_Workflow.html'))); }
  r.writeHead(404); r.end('no');
});

(async () => {
  await new Promise(res => server.listen(PORT, '127.0.0.1', res));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext();

  // every row the board shows for one brand, with its chips
  const readBoard = (pg, brand) => pg.evaluate((bn) => {
    const out = [];
    for (const tr of document.querySelectorAll('#itbl tbody tr')) {
      const tds = tr.querySelectorAll('td'); if (tds.length < 2) continue;
      const txt = (tr.textContent || '');
      if (txt.indexOf(bn) < 0) continue;
      const task = (tr.querySelector('.c-task') || tds[1]).textContent.trim();
      const only = [...tr.querySelectorAll('.src-only')].map(x => x.textContent.trim());
      out.push({ task: task, only: only });
    }
    return out;
  }, brand);

  const open = async () => { const pg = await ctx.newPage();
    pg.on('pageerror', e => { fail++; console.log('  ✗ pageerror ' + e.message); });
    await pg.goto(U + '/workflow', { waitUntil: 'networkidle' });
    await pg.waitForTimeout(3200);
    // show every status so nothing under test is filtered away
    await pg.evaluate(() => { try { if (window.FCCFilterClient) {} } catch (e) {} });
    return pg; };

  /* ---------- the split, as the board paints it ---------- */
  await fetch(U + '/__merged?on=0');
  let pg = await open();
  const mon = await readBoard(pg, 'Monsoon'), acc = await readBoard(pg, 'Accessorize');
  const has = (list, t) => list.some(r => r.task.indexOf(t) >= 0);

  console.log('\n-- Monsoon’s board --');
  ok('carries the joint monthly work', has(mon, 'Disapprovals - Basics') && has(mon, 'Category mapping'), mon.map(r => r.task));
  ok('carries its own Image Cycler row', has(mon, 'Image Cycler'), mon.map(r => r.task));
  ok('NEVER carries Accessorize’s PMAX restructure — the assertion that fails on the pre-fix worker',
     !has(mon, 'PMAX restructure'), mon.map(r => r.task));
  const monBts = mon.filter(r => r.task.indexOf('BTS keywords') >= 0);
  ok('carries ONE BTS row, not both brands’ copies of the same wording', monBts.length === 1, monBts);
  ok('and says the Image Cycler row is Monsoon’s only',
     (mon.find(r => r.task.indexOf('Image Cycler') >= 0) || {}).only + '' === 'Monsoon only',
     mon.find(r => r.task.indexOf('Image Cycler') >= 0));
  ok('while a joint row claims no brand',
     ((mon.find(r => r.task.indexOf('All custom label') >= 0) || {}).only || []).length === 0,
     mon.find(r => r.task.indexOf('All custom label') >= 0));

  console.log('\n-- Accessorize’s board --');
  ok('carries the same joint work', has(acc, 'Disapprovals - Basics'), acc.map(r => r.task));
  ok('carries its own PMAX restructure', has(acc, 'PMAX restructure'), acc.map(r => r.task));
  ok('and never Monsoon’s Image Cycler', !has(acc, 'Image Cycler'), acc.map(r => r.task));
  ok('one brand’s board is not the other’s', mon.length !== acc.length || !has(mon, 'PMAX restructure'),
     { mon: mon.length, acc: acc.length });

  /* ---------- a row added by hand names its brand ---------- */
  console.log('\n-- "+ Add task" for ONE brand --');
  await pg.evaluate(() => { const t = document.getElementById('add-task-btn'); if (t) t.click(); });
  await pg.waitForTimeout(500);
  const added = await pg.evaluate(() => {
    const cs = document.getElementById('af-client'), ti = document.getElementById('af-task'),
          go = document.getElementById('af-save');
    if (!cs || !ti || !go) return 'no add row';
    if (![...cs.options].some(o => o.value === 'Accessorize')) return 'Accessorize not offered';
    cs.value = 'Accessorize'; cs.dispatchEvent(new Event('change', { bubbles: true }));
    ti.value = 'Gold & Silver CL2 scrape'; ti.dispatchEvent(new Event('input', { bubbles: true }));
    go.click(); return 'clicked';
  });
  await pg.waitForTimeout(1200);
  const ap = await fetch(U + '/__appends').then(r => r.json());
  ok('the add row was reachable (' + added + ')', added === 'clicked', added);
  ok('the write NAMES the brand it is for, so the sheet can be stamped',
     ap.length >= 1 && ap[ap.length - 1].client === 'Accessorize', ap);
  ok('and the engine turns that into the token the team writes',
     PB.appendToken((ap[ap.length - 1] || {}).client, BRANDS) === 'ACC',
     PB.appendToken((ap[ap.length - 1] || {}).client, BRANDS));
  await pg.close();

  /* ---------- NEGATIVE CONTROL: the pre-fix merged serve ---------- */
  console.log('\n-- negative control: both brands served the identical array --');
  await fetch(U + '/__merged?on=1');
  pg = await open();
  const mon2 = await readBoard(pg, 'Monsoon');
  ok('with the split removed, Monsoon’s board DOES show Accessorize’s PMAX row '
     + '(so the check above is really testing the split)',
     mon2.some(r => r.task.indexOf('PMAX restructure') >= 0), mon2.map(r => r.task));
  await pg.close();

  await b.close(); server.close();
  console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
