/* A WARNING NEVER LINGERS ACROSS THE BOARD.
 *
 * Ray, 15 Oct 2026, over a dark-red band sitting on Workflow's Intake table — "⚠ 15 tasks not
 * written to the project plan — e.g. Accessorize: "…" · Could not find a single "Project
 * Plan"-like tab in this sheet (1KWrB4Ip…). Retrying…" — first "i dont want this message to
 * show", then "warning like this never linger !".
 *
 * Three things were wrong with it and only a rendered page shows them:
 *   · it was a FIXED band lying over the work, and it stayed up for the life of the tab;
 *   · it said "Retrying…" about a refusal that can never succeed (five ELC brands share one
 *     workbook whose tabs carry no "Plan"-like name), and the retry really did re-send it on
 *     every pass;
 *   · it held ONE global reason against the FIRST unsynced row of ANY brand, so ELC's sheet
 *     error was printed against an Accessorize task.
 *
 * This drives the real page with that exact refusal and asserts: no fixed banner anywhere, the
 * count on Intake's own head line with each brand's own reason in its tooltip, a brand with an
 * unwritten row but no refusal never named, the refusal sent ONCE, and the same for an unsaved
 * brief on the pipeline's head. A NEGATIVE CONTROL strips the fatal classifier and must fail
 * the sent-once check.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_nolinger.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); }
catch (e) { console.log('· playwright not installed — lingering-warning tripwire skipped'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 8873, U = 'http://127.0.0.1:' + PORT;
const PAGE = path.join(ROOT, 'docs/FeedSpark_Workflow.html');
/* The real refusal, as the worker words it (tabAmbiguous in worker.js) for the ELC workbook. */
const ELC_ERR = 'Could not find a single "Project Plan"-like tab in this sheet '
  + '(1KWrB4IpHGRUnlhVjWP4hpyhpBGs5c-JM_cBa7mj6J0Y) — it has several tabs and none match by name or contain "plan".';

let pass = 0, fail = 0, NOFATAL = false, BRIEFS_REFUSE = false;
const appends = [];
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };
const body = q => new Promise(r => { let b = ''; q.on('data', d => b += d); q.on('end', () => r(b)); });

const BRANDS = ['Benefit', 'Monsoon'];
const ROWS = []; for (let i = 0; i < 8; i++) ROWS.push({ t: 'Plan task ' + i, o: 'Ray', d: (1 + i) + '/10/2026', s: 'Open', b: 'open', c: 'keyword' });
const KV = {};
const BRIEFS = { 'MONS-20261001-01': { id: 'MONS-20261001-01', client: 'Monsoon', task: 'Keywords Optimisation - Party dresses - Monsoon GB - 1026',
  status: 'intake', created: '01/10/2026', due: '20/10/2026', t: Date.now() - 86400000, by: 'Ray', cat: 'keyword', aspl: 'Vimalesh' } };
const API = { '/api/tests': [], '/api/gmail/intake': { items: [], calls: [] },
  '/api/access?me=1': { ok: true, clients: null, modules: null, owner: true, name: 'Ray', ownerName: 'Ray' },
  '/api/ingest/pending': { ok: true, items: [] }, '/api/schedule': { ok: true, brands: [] } };

const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), p = u.pathname;
  const send = (o, h, code) => { r.writeHead(code || 200, Object.assign({ 'content-type': 'application/json' }, h || {})); r.end(JSON.stringify(o)); };
  if (p === '/__mode') { NOFATAL = u.searchParams.get('nofatal') === '1'; BRIEFS_REFUSE = u.searchParams.get('briefs') === '0';
    appends.length = 0; return send({ NOFATAL, BRIEFS_REFUSE }); }
  if (p === '/__appends') return send(appends);
  if (p === '/api/state') { if (q.method === 'PUT') { const inc = JSON.parse(await body(q) || '{}');
      for (const ns of Object.keys(inc)) KV[ns] = Object.assign({}, KV[ns] || {}, inc[ns]); }
    return send(KV, { 'X-Sync-Base': String(Date.now()) }); }
  if (p === '/api/plan/live' && q.method === 'POST') { await body(q); const brands = {};
    BRANDS.forEach(bn => { brands[bn] = { tasks: ROWS.slice(), updated: Date.now() }; });
    return send({ ok: true, connected: true, brands }); }
  if (p === '/api/briefs') { if (q.method === 'PUT') { await body(q);
      if (BRIEFS_REFUSE) return send({ error: 'nope' }, null, 500); }
    return send(BRIEFS, { 'X-Sync-Base': String(Date.now()) }); }
  /* Benefit's workbook has no Plan-like tab — a refusal it will give every time. Monsoon's
     write is accepted, so a Monsoon row left unwritten (planted below) is never a refusal. */
  if (p === '/api/sheets/append') { const b = JSON.parse(await body(q) || '{}');
    appends.push({ client: b.client, tasks: (b.rows || []).map(x => x.task) });
    if (b.client === 'Benefit') return send({ ok: false, error: ELC_ERR });
    return send({ ok: true, atRow: 516, appended: (b.rows || []).length }); }
  if (p.startsWith('/api/sheets/')) { await body(q); return send({ ok: true }); }
  const key = p + (u.search || ''); if (API[key]) return send(API[key]); if (API[p]) return send(API[p]);
  if (p.startsWith('/api/')) return send({ ok: true });
  if (p === '/kwcal/engine.js') { r.writeHead(200, { 'content-type': 'application/javascript' });
    return r.end(fs.readFileSync(path.join(ROOT, 'docs/kwcal_engine.js'))); }
  if (p === '/workflow') { let html = fs.readFileSync(PAGE, 'utf8');
    /* NEGATIVE CONTROL: nothing is permanent, so every refusal is handed back to the retry. */
    if (NOFATAL) html = html.replace(/function planFatal\(e\)\{[^\n]*\}/, 'function planFatal(e){ return false; }');
    r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); return r.end(html); }
  r.writeHead(404); r.end('no');
});

/* Anything fixed over the board, measured off the paint rather than off the source: a node the
   page positions itself, covering real width, that is not one of the page's own docks or its
   2.4s toast. */
const lingering = pg => pg.evaluate(() => [...document.body.querySelectorAll('*')].filter((el) => {
  const cs = getComputedStyle(el);
  if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
  const b = el.getBoundingClientRect();
  if (b.width < 200 || b.height < 20) return false;
  if (el.closest('.topbar,.scrim,[role=dialog],.modal,.ck-rail,#fcc-hrs-dock,.fcc-m-bar,.tb-modules')) return false;
  if (el.className && /toast|ck-toast/.test(String(el.className))) return false;
  return /not written|not saved|Retrying|⚠/.test(el.textContent || '');
}).map((el) => ({ txt: (el.textContent || '').slice(0, 90), bg: getComputedStyle(el).backgroundColor })));

const addTask = (pg, client, task) => pg.evaluate(async ([c, t]) => {
  const btn = document.getElementById('add-task-btn'); if (btn) btn.click();
  const cs = document.getElementById('af-client'); cs.value = c; cs.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('af-task').value = t;
  document.getElementById('af-save').click();
}, [client, task]);

const sum = (pg, k) => pg.evaluate((kk) => {
  const e = document.getElementById('wss-' + kk);
  const n = document.getElementById('plan-note');
  return { line: e ? (e.textContent || '').trim() : null, title: e ? (e.title || '') : '',
    note: n ? (n.textContent || '').trim() : null, noteTip: n ? (n.title || '') : '' };
}, k);

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const br = await chromium.launch();
  const open = async (w, h) => { const ctx = await br.newContext({ viewport: { width: w || 1440, height: h || 1000 } });
    const pg = await ctx.newPage(); pg.on('dialog', d => d.accept());
    await pg.goto(U + '/workflow', { waitUntil: 'load' }); await pg.waitForTimeout(1600); return { ctx, pg }; };

  /* ---------- 1. the refusal Ray screenshotted ---------- */
  console.log('── a plan write the workbook refuses for good');
  await fetch(U + '/__mode');
  let { ctx, pg } = await open();
  await addTask(pg, 'Benefit', 'Golden Record Fix - g:material - Benefit GB - 1026');
  await pg.waitForTimeout(900);
  let lin = await lingering(pg);
  ok('nothing is left lying over the board', lin.length === 0, lin);
  let s = await sum(pg, 'intake');
  ok('Intake\'s own head line carries the count', /1 not written to Benefit’s plan/.test(s.note || ''), s.note);
  ok('and says the sheet has to change, not that it is retrying',
    /the sheet has to change/.test(s.note || '') && !/Retrying/i.test(s.note || ''), s.note);
  ok('the brand\'s own reason is there to read', /Benefit — 1 task/.test(s.noteTip) && /-like tab/.test(s.noteTip), s.noteTip.slice(0, 120));
  ok('with the task named', /Golden Record Fix - g:material/.test(s.noteTip));

  /* ---------- 2. a reason is never read against another brand's row ---------- */
  console.log('\n── one brand\'s sheet error is never printed against another brand\'s task');
  await addTask(pg, 'Monsoon', 'Keywords Optimisation - Dresses - Monsoon GB - 1026');
  await pg.waitForTimeout(900);
  s = await sum(pg, 'intake');
  ok('an accepted write leaves the count where it was', /^· 1 not written to Benefit’s plan/.test(s.note || ''), s.note);
  ok('Monsoon is not named', !/Monsoon/.test(s.note || '') && !/Monsoon/.test(s.noteTip), s.note);

  /* ---------- 3. it is sent ONCE ---------- */
  console.log('\n── a refusal that can never succeed is not re-sent every pass');
  let ap = await (await fetch(U + '/__appends')).json();
  const before = ap.filter(x => x.client === 'Benefit').length;
  await pg.evaluate(() => { document.dispatchEvent(new CustomEvent('fcc-briefs')); });
  await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(2200);
  ap = await (await fetch(U + '/__appends')).json();
  const after = ap.filter(x => x.client === 'Benefit').length;
  ok('the refused row is attempted once per session, not once per pass', after - before <= 1, { before, after });
  s = await sum(pg, 'intake');
  ok('and the row is still reported after a reload', /not written to Benefit’s plan/.test(s.note || ''), s.note);
  lin = await lingering(pg);
  ok('still nothing fixed over the board', lin.length === 0, lin);

  /* ---------- 4. the folded head keeps the finding ---------- */
  console.log('\n── folding Intake cannot hide it');
  await pg.evaluate(() => { document.getElementById('wsc-intake').click(); });
  await pg.waitForTimeout(300);
  const folded = await pg.evaluate(() => {
    const sec = document.getElementById('ws-intake'), n = document.getElementById('plan-note');
    return { folded: sec.classList.contains('folded'), bodyH: document.getElementById('wsb-intake').getBoundingClientRect().height,
      note: n ? (n.textContent || '').trim() : null, shown: n ? !!n.getClientRects().length : false }; });
  ok('the section really is folded', folded.folded === true && folded.bodyH === 0, folded);
  ok('the line still names the unwritten rows', /not written to Benefit’s plan/.test(folded.note || '') && folded.shown, folded);
  await ctx.close();

  /* ---------- 5. an unsaved brief, same rule ---------- */
  console.log('\n── a brief whose save the server refuses');
  await fetch(U + '/__mode?briefs=0');
  ({ ctx, pg } = await open());
  await pg.evaluate(() => { const b = document.getElementById('wsc-bp');
    if (b && document.getElementById('ws-bp').classList.contains('folded')) b.click(); });
  /* A real stage move: the modal's own stage button → setStage → persist → the refused PUT. */
  const moved = await pg.evaluate(() => { if (!window.FCCTicket) return 'no opener';
    window.FCCTicket('MONS-20261001-01');
    const btn = document.querySelector('#m-stat button[data-s="briefed"]');
    if (!btn) return 'no stage button'; btn.click(); return 'ok'; });
  ok('a stage move is drivable', moved === 'ok', moved);
  await pg.waitForTimeout(1400);
  await pg.evaluate(() => { const c = document.getElementById('m-close'); if (c) c.click(); else document.body.click(); });
  await pg.waitForTimeout(300);
  lin = await lingering(pg);
  ok('no band says it over the board', lin.length === 0, lin);
  s = await sum(pg, 'bp');
  ok('the pipeline\'s own head line says the brief is not saved yet', /not saved to the pipeline yet/.test(s.line || ''), s.line);
  ok('and the head explains it on hover', /only on this device/.test(s.title || ''), s.title);
  await ctx.close();

  /* ---------- 6. the phone ---------- */
  console.log('\n── 390px');
  await fetch(U + '/__mode');
  ({ ctx, pg } = await open(390, 780));
  await addTask(pg, 'Benefit', 'Golden Record Fix - g:pattern - Benefit GB - 1026');
  await pg.waitForTimeout(900);
  await pg.evaluate(() => { const b = document.getElementById('wsc-intake');
    if (b && document.getElementById('ws-intake').classList.contains('folded')) b.click(); });
  await pg.waitForTimeout(300);
  s = await sum(pg, 'intake');
  ok('the phone reads the same line', /not written to Benefit’s plan/.test(s.note || ''), s.note);
  lin = await lingering(pg);
  ok('and nothing covers a 390px screen', lin.length === 0, lin);
  const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('no sideways overflow', over <= 2, over);
  await ctx.close();

  /* ---------- 7. NEGATIVE CONTROL ---------- */
  console.log('\n── negative control: nothing is permanent, so everything is re-sent');
  await fetch(U + '/__mode?nofatal=1');
  ({ ctx, pg } = await open());
  await addTask(pg, 'Benefit', 'Golden Record Fix - g:material - Benefit GB - 1026');
  await pg.waitForTimeout(900);
  const b0 = (await (await fetch(U + '/__appends')).json()).filter(x => x.client === 'Benefit').length;
  await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(2200);
  const b1 = (await (await fetch(U + '/__appends')).json()).filter(x => x.client === 'Benefit').length;
  ok('without the classifier the refusal IS re-sent — the check above can really fail', b1 - b0 >= 1, { b0, b1 });
  await ctx.close();

  await br.close(); server.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' assertions passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
