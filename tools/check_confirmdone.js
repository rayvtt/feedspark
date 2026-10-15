/* A CONFIRMED TICKET CLOSES ITS TASK.
 *
 * Ray, 15 Oct 2026: "When a ticket's status is changed to client confirm anywhere, the
 * corresponding task in InTake should be updated to Done accordingly."
 *
 * STAGE_STATUS has said confirmed → Done since the reconcile was written, but it was only ever
 * read when the plan row was CREATED — so a ticket that reached Client confirmed afterwards left
 * its Intake row reading whatever it last said, and the plan sheet with it.
 *
 * This drives the REAL ticket modal and reads the Intake row's status back OFF THE PAINT: the
 * stage buttons close it, the ✓ Client confirmed draft closes it, a row already Done is not
 * re-written, an AM who re-opens the row afterwards is not corrected, and a ticket confirmed
 * while its row was off the board is closed on the next open. A NEGATIVE CONTROL strips the
 * stamp and must leave the row open.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_confirmdone.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); }
catch (e) { console.log('· playwright not installed — confirm-done tripwire skipped'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 8879, U = 'http://127.0.0.1:' + PORT;
const PAGE = path.join(ROOT, 'docs/FeedSpark_Workflow.html');

let pass = 0, fail = 0, NOSTAMP = false, LATE = false, SLOW = false;
let writes = [];
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };
const body = q => new Promise(r => { let b = ''; q.on('data', d => b += d); q.on('end', () => r(b)); });

/* Five Reiss rows, each tied to a ticket at a stage from which a client confirmation is the
   next real step. D's ticket is ALREADY confirmed (the historic case); E's row only reaches the
   board on the second read, so the confirm made on the first one has nothing to write to. */
const T = {
  A: 'Keywords Optimisation - Denim - Marketing Planner - 1026',
  B: 'Content Quality - g:title - Reiss GB - 1026',
  C: 'Titles Optimisation - Coats & Jackets - 1026',
  D: 'Golden Record Fix - g:gtin - Reiss GB - 1026',
  E: 'Product type depth - Reiss GB - 1026',
};
const ROWS = () => [
  { t: T.A, o: 'ASPL', d: '19/10/2026', s: 'In Progress', b: 'progress', c: 'keyword' },
  { t: T.B, o: 'ASPL', d: '19/10/2026', s: 'Briefed', b: 'briefed', c: 'data' },
  { t: T.C, o: 'ASPL', d: '12/10/2026', s: 'Done', b: 'done', c: 'title' },
  { t: T.D, o: 'ASPL', d: '05/10/2026', s: 'In Progress', b: 'progress', c: 'data' },
].concat(LATE ? [{ t: T.E, o: 'ASPL', d: '19/10/2026', s: 'In Progress', b: 'progress', c: 'product_type' }] : []);

const tkt = (k, task, status) => ({ id: 'REIS-202610' + k, client: 'Reiss', task: task,
  taskKey: 'Reiss|' + task, status: status, created: '01/10/2026', due: '19102026',
  t: Date.now() - 6 * 86400000, by: 'Steven', cat: 'keyword', planned: 1,
  comms: [{ from: 'ASPL', note: 'All done and live.', done: true, when: Date.now() - 86400000 }] });
let BR = {};
const seed = () => { BR = { 'REIS-20261001': tkt('01', T.A, 'analysis'), 'REIS-20261002': tkt('02', T.B, 'done'),
  'REIS-20261003': tkt('03', T.C, 'analysis'), 'REIS-20261004': tkt('04', T.D, 'confirmed'),
  'REIS-20261005': tkt('05', T.E, 'analysis') }; };
seed();
const KV = {};
const API = { '/api/tests': [], '/api/gmail/intake': { items: [], calls: [] },
  '/api/access?me=1': { ok: true, clients: null, modules: null, owner: true, name: 'Ray', ownerName: 'Ray' },
  '/api/ingest/pending': { ok: true, items: [] }, '/api/schedule': { ok: true, brands: [] } };

const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), p = u.pathname;
  const send = o => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (p === '/__mode') { NOSTAMP = u.searchParams.get('nostamp') === '1';
    LATE = u.searchParams.get('late') === '1'; SLOW = u.searchParams.get('slow') === '1'; writes = [];
    /* The shared store and the brief store outlive a browser context, so a later run would read
       the overlays an earlier one wrote — which is how a negative control passes by accident. */
    for (const k of Object.keys(KV)) delete KV[k];
    if (u.searchParams.get('keep') !== '1') seed();
    return send({ NOSTAMP, LATE }); }
  if (p === '/__writes') return send(writes);
  if (p === '/__briefs') return send(BR);
  if (p === '/api/state') { if (q.method === 'PUT') { const inc = JSON.parse(await body(q) || '{}');
      for (const ns of Object.keys(inc)) KV[ns] = Object.assign({}, KV[ns] || {}, inc[ns]); }
    return send(KV); }
  if (p === '/api/plan/live' && q.method === 'POST') { await body(q);
    /* SLOW: the live plan read lands seconds after the pipeline does, which is the real window
       in which a confirmation has no row to write to. */
    if (SLOW) await new Promise(x => setTimeout(x, 4200));
    return send({ ok: true, connected: true, brands: { Reiss: { tasks: ROWS(), updated: Date.now() } } }); }
  if (p === '/api/briefs') { if (q.method === 'PUT') { const inc = JSON.parse(await body(q) || '{}');
      for (const k of Object.keys(inc)) if (inc[k] && typeof inc[k] === 'object') BR[k] = inc[k]; }
    return send(BR); }
  if (p === '/api/sheets/status') { const b = JSON.parse(await body(q) || '{}');
    writes.push({ task: b.match, value: b.value }); return send({ ok: true, cell: 'F12' }); }
  if (p.startsWith('/api/sheets/')) { await body(q); return send({ ok: true, atRow: 516, appended: 1 }); }
  const key = p + (u.search || ''); if (API[key]) return send(API[key]); if (API[p]) return send(API[p]);
  if (p.startsWith('/api/')) return send({ ok: true });
  if (p === '/kwcal/engine.js') { r.writeHead(200, { 'content-type': 'application/javascript' });
    return r.end(fs.readFileSync(path.join(ROOT, 'docs/kwcal_engine.js'))); }
  if (p === '/workflow') { let html = fs.readFileSync(PAGE, 'utf8');
    /* NEGATIVE CONTROL: the stamp does nothing, so the open row must survive the confirmation. */
    if (NOSTAMP) html = html
      .replace('function confirmDone(b){ if(!b||!b.id||b.cstmp)return false;', 'function confirmDone(b){ if(b)return false;')
      .replace('if(_cdDone||!LIVE_CONN||!Object.keys(BRIEFS).length)return; _cdDone=true;', 'if(1)return; _cdDone=true;');
    r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); return r.end(html); }
  r.writeHead(404); r.end('no');
});

/* The status a reader sees on the Intake row — the select's own value, off the paint. */
const statOf = (pg, task) => pg.evaluate((t) => {
  const tr = [...document.querySelectorAll('.itbl tbody tr')].find((x) =>
    (x.querySelector('.c-task') || {}).textContent && x.querySelector('.c-task').textContent.indexOf(t) >= 0);
  if (!tr) return null;
  const s = tr.querySelector('.c-stat select');
  return s ? s.value : '(no select)';
}, task);

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const br = await chromium.launch();
  /* The working board shows open · in progress · briefed, so a task it closes rightly leaves
     the view — read it the way an AM checks, with every status shown. */
  const showAll = async (pg) => { await pg.evaluate(() => {
      document.getElementById('it-status-btn').click();
      const cb = document.querySelector('#it-status-menu .it-multi-all input');
      if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      document.getElementById('it-status-btn').click(); });
    await pg.waitForTimeout(900); };
  const open = async (settle) => { const ctx = await br.newContext({ viewport: { width: 1440, height: 1000 } });
    const pg = await ctx.newPage(); pg.on('dialog', d => d.accept());
    await pg.goto(U + '/workflow', { waitUntil: 'load' }); await pg.waitForTimeout(settle || 2300);
    if (settle === undefined) await showAll(pg);
    return { ctx, pg }; };
  /* Clicking the stage button a reader clicks — the modal opened through the page's own opener. */
  const stage = async (pg, id, s) => {
    await pg.evaluate((i) => window.FCCTicket(i), id); await pg.waitForTimeout(400);
    const n = await pg.evaluate((st) => { const b = document.querySelector('#m-stat button[data-s="' + st + '"]');
      if (!b) return 'no stage button'; b.click(); return 'ok'; }, s);
    await pg.waitForTimeout(1300); return n; };

  console.log('\u2500\u2500 the rows before anybody confirms anything');
  await fetch(U + '/__mode');
  let { ctx, pg } = await open();
  ok('a ticket in Analysis leaves its task In Progress', await statOf(pg, T.A) === 'In Progress', await statOf(pg, T.A));
  ok('a ticket Done at ASPL leaves its task Briefed', await statOf(pg, T.B) === 'Briefed', await statOf(pg, T.B));

  console.log('\n\u2500\u2500 moving the ticket to Client confirmed, on the stage buttons');
  ok('the stage button is there to click', await stage(pg, 'REIS-20261001', 'confirmed') === 'ok');
  ok('the task now reads Done in Intake', await statOf(pg, T.A) === 'Done', await statOf(pg, T.A));
  let w = await (await fetch(U + '/__writes')).json();
  ok('\u2026and Done was written to the brand\u2019s plan sheet',
    w.some(x => x.task === T.A && x.value === 'Done'), w);
  ok('\u2026once, not twice', w.filter(x => x.task === T.A).length === 1, w);

  console.log('\n\u2500\u2500 and on the \u2713 Client confirmed draft \u2014 the other way there');
  await pg.evaluate((i) => window.FCCTicket(i), 'REIS-20261002'); await pg.waitForTimeout(400);
  const clicked = await pg.evaluate(() => { const a = document.getElementById('m-confirm');
    if (!a) return 'no draft button';
    a.addEventListener('click', e => e.preventDefault(), true);   // the draft would navigate; the page\u2019s own listener still runs
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'ok'; });
  await pg.waitForTimeout(1300);
  ok('the draft button is there to click', clicked === 'ok', clicked);
  ok('that task reads Done too', await statOf(pg, T.B) === 'Done', await statOf(pg, T.B));

  console.log('\n\u2500\u2500 a task already closed is never re-written');
  await stage(pg, 'REIS-20261003', 'confirmed');
  ok('that ticket reached Client confirmed',
    ((await (await fetch(U + '/__briefs')).json())['REIS-20261003'] || {}).status === 'confirmed');
  w = await (await fetch(U + '/__writes')).json();
  ok('\u2026and its already-Done task was left alone', !w.some(x => x.task === T.C), w);

  console.log('\n\u2500\u2500 an AM who re-opens the row afterwards is not corrected');
  await pg.evaluate((t) => { const tr = [...document.querySelectorAll('.itbl tbody tr')].find((x) =>
      (x.querySelector('.c-task') || {}).textContent && x.querySelector('.c-task').textContent.indexOf(t) >= 0);
    const s = tr.querySelector('.c-stat select'); s.value = 'In Progress';
    s.dispatchEvent(new Event('change', { bubbles: true })); }, T.A);
  await pg.waitForTimeout(1400);
  await pg.evaluate((i) => window.FCCTicket(i), 'REIS-20261001'); await pg.waitForTimeout(600);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(900);
  ok('their In Progress stands', await statOf(pg, T.A) === 'In Progress', await statOf(pg, T.A));

  console.log('\n\u2500\u2500 the tickets already at Client confirmed, filled in once');
  ok('a ticket confirmed before the rule reads Done now', await statOf(pg, T.D) === 'Done', await statOf(pg, T.D));
  await ctx.close();

  console.log('\n\u2500\u2500 a confirmation made before the live plan read lands');
  await fetch(U + '/__mode?slow=1&late=1');   // the pipeline is there seconds before the plan is
  ({ ctx, pg } = await open(1400));
  await stage(pg, 'REIS-20261005', 'confirmed');
  w = await (await fetch(U + '/__writes')).json();
  ok('there is no row to write to yet, and none is invented', !w.length, w);
  await pg.waitForTimeout(5400);              // the plan arrives
  await showAll(pg);
  ok('the task is closed the moment its row appears', await statOf(pg, T.E) === 'Done', await statOf(pg, T.E));
  w = await (await fetch(U + '/__writes')).json();
  ok('\u2026and the sheet is told, once', w.filter(x => x.task === T.E && x.value === 'Done').length === 1, w);
  await ctx.close();

  console.log('\n\u2500\u2500 NEGATIVE CONTROL \u2014 the stamp stripped out');
  await fetch(U + '/__mode?nostamp=1');
  ({ ctx, pg } = await open());
  await stage(pg, 'REIS-20261001', 'confirmed');
  ok('without it the confirmed task stays open \u2014 the bug Ray reported',
    await statOf(pg, T.A) === 'In Progress', await statOf(pg, T.A));
  ok('\u2026and the historic one stays open too', await statOf(pg, T.D) === 'In Progress', await statOf(pg, T.D));
  await ctx.close();

  await br.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
