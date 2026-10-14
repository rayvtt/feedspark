/* THE BRIEF'S DUE DATE IS THE TASK'S DUE DATE.
 *
 * Ray, 14 Oct 2026, over a Superdry Intake row still reading "Aug 26" after he briefed it for the
 * 19th: "Due Date in brief doesn't save here (this should be due 19/10)".
 *
 * The composer PREFILLS its due from the intake row and the brief then kept the AM's date to
 * itself — into the subject's ibfdue token and the ledger, never onto the row it was raised from.
 * The due reached a row ONLY where the brief CREATED it (adoptIntoPlan, the email and
 * module-deep-link paths), never in the ordinary case of briefing a row that already exists. On
 * Ray's row the plan's own date was a MONTH SECTION (1 Aug 2026) — not a deadline at all — so the
 * one date anyone sorts and chases on was the only place the decision never landed.
 *
 * Rendered, not read: the string was right in every file. This drives the REAL page against an
 * in-process stub of /api/state, /api/plan/live and /api/sheets/due, presses the row's own Brief
 * button, types a date into the composer and reads the Due cell back off the table.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_briefdue.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); }
catch (e) { console.log('· playwright not installed — brief-due tripwire skipped'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 8841, U = 'http://127.0.0.1:' + PORT;
const KV = {}; const SHEETDUE = []; let PLANLIVE = null;
let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
const body = q => new Promise(r => { let b = ''; q.on('data', d => b += d); q.on('end', () => r(b)); });

const API = { '/api/tests': [], '/api/gmail/intake': { items: [], calls: [] },
  '/api/access?me=1': { ok: true, clients: null, modules: null, owner: true, name: 'Ray', ownerName: 'Ray' },
  '/api/plan/live': { ok: true, clients: {} }, '/api/ingest/pending': { ok: true, items: [] },
  '/api/schedule': { ok: true, brands: [] } };

const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), p = u.pathname;
  const send = (o, h) => { r.writeHead(200, Object.assign({ 'content-type': 'application/json' }, h || {})); r.end(JSON.stringify(o)); };
  if (p === '/__state') return send(KV.taskdue || null);
  if (p === '/__due') return send(SHEETDUE);
  if (p === '/__planlive') { PLANLIVE = JSON.parse(await body(q) || 'null'); return send({ ok: true }); }
  if (p === '/api/state') {
    if (q.method === 'PUT') { const inc = JSON.parse(await body(q) || '{}');
      // a plain last-writer-wins merge is enough here: one tab, one namespace under test
      for (const ns of Object.keys(inc)) KV[ns] = Object.assign({}, KV[ns] || {}, inc[ns]);
      return send(KV, { 'X-Sync-Base': String(Date.now()) }); }
    return send(KV, { 'X-Sync-Base': String(Date.now()) });
  }
  if (p === '/api/plan/live' && q.method === 'POST') { await body(q);
    if (!PLANLIVE) return send({ ok: true, connected: false });
    const brands = {};
    for (const [bn, rows] of Object.entries(PLANLIVE))
      brands[bn] = { tasks: rows.map(t => ({ t: t.t, s: 'Open', b: 'open', c: 'keyword', o: t.o || 'Ray', d: t.d })) };
    return send({ ok: true, connected: true, brands }); }
  if (p === '/api/sheets/due') { SHEETDUE.push(JSON.parse(await body(q) || '{}')); return send({ ok: true, cell: 'D7' }); }
  if (p === '/api/briefs') { if (q.method === 'PUT') await body(q); return send({}, { 'X-Sync-Base': String(Date.now()) }); }
  if (p.startsWith('/api/sheets/')) { await body(q); return send({ ok: true }); }
  const key = p + (u.search || ''); if (API[key]) return send(API[key]); if (API[p]) return send(API[p]);
  if (p.startsWith('/api/')) return send({ ok: true });
  if (p === '/workflow') { r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
    return r.end(fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_Workflow.html'))); }
  r.writeHead(404); r.end('no');
});

/* The row as Ray's board really carries it: its plan date is a MONTH SECTION (the 1st), which is
 * why the cell reads "Aug 26" rather than a day — exactly the screenshot. */
const TASK = 'Golden Record Fix - g:size_type - Superdry GB - Oct26';

(async () => {
  await new Promise(res => server.listen(PORT, '127.0.0.1', res));
  await fetch(U + '/__planlive', { method: 'POST', body: JSON.stringify({ Superdry: [
    { t: TASK, d: '01/08/2026', o: 'Ray' },
    { t: 'Keywords Optimisation - Knitwear & winterwear keywords - Marketing Planner - 1026', d: '14/10/2026', o: 'ASPL' } ] }) });

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await (await b.newContext()).newPage();
  pg.on('pageerror', e => { fail++; console.log('  ✗ pageerror ' + e.message); });
  await pg.goto(U + '/workflow', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(3000);

  const cell = () => pg.evaluate(t => {
    for (const tr of document.querySelectorAll('#itbl tbody tr'))
      if ((tr.textContent || '').indexOf(t) >= 0) { const d = tr.querySelector('.c-due'); return d ? d.textContent.trim() : '(no cell)'; }
    return '(row not found)';
  }, TASK);
  const openBriefFor = () => pg.evaluate(t => {
    for (const tr of document.querySelectorAll('#itbl tbody tr')) {
      if ((tr.textContent || '').indexOf(t) < 0) continue;
      const btn = [...tr.querySelectorAll('button,a')].filter(x => /brief/i.test(x.textContent || ''))[0];
      if (!btn) return false; btn.click(); return true; }
    return false;
  }, TASK);
  const saveWith = async (iso) => {
    await pg.evaluate(v => { const d = document.getElementById('bg-due'); d.value = v;
      d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true })); }, iso);
    await pg.evaluate(() => document.getElementById('bg-save').click());
    await pg.waitForTimeout(1400);
  };
  const stored = () => fetch(U + '/__state').then(r => r.json());
  const dueWrites = () => fetch(U + '/__due').then(r => r.json());

  console.log('\n-- the row as the board carries it --');
  ok('the Intake row shows the plan’s own date', (await cell()) === 'Aug 26', await cell());
  ok('a month-section date reads as a month, not a day', /^[A-Za-z]{3} \d{2}$/.test(await cell()), await cell());

  console.log('\n-- briefing it for the 19th --');
  ok('the row carries its own Brief button', await openBriefFor());
  await pg.waitForTimeout(900);
  ok('the composer prefills the due from the row',
     (await pg.evaluate(() => document.getElementById('bg-due').value)) === '2026-08-01',
     await pg.evaluate(() => document.getElementById('bg-due').value));
  await saveWith('2026-10-19');
  ok('the Intake cell now reads the briefed date', (await cell()) === '19 Oct', await cell());
  const st = await stored();
  ok('…and it is in the TEAM’s store, not one browser',
     !!st && st['Superdry|' + TASK] === '2026-10-19', st);
  const w1 = await dueWrites();
  ok('…and written back to the Project Plan',
     w1.length === 1 && w1[0].value === '19/10/2026' && w1[0].match === TASK, w1);

  console.log('\n-- re-saving the same brief --');
  ok('the brief re-opens', await openBriefFor()); await pg.waitForTimeout(900);
  ok('it now prefills the date it set', (await pg.evaluate(() => document.getElementById('bg-due').value)) === '2026-10-19',
     await pg.evaluate(() => document.getElementById('bg-due').value));
  await saveWith('2026-10-19');
  ok('an unmoved due writes nothing to the sheet', (await dueWrites()).length === 1, (await dueWrites()).length);
  ok('and the cell is unchanged', (await cell()) === '19 Oct', await cell());

  console.log('\n-- a brief with no due at all --');
  ok('the brief re-opens', await openBriefFor()); await pg.waitForTimeout(900);
  await saveWith('');
  ok('clearing the brief’s due never wipes the task’s date', (await cell()) === '19 Oct', await cell());
  ok('…and sends no blank to the plan', (await dueWrites()).length === 1, await dueWrites());

  console.log('\n-- the inline editor still works --');
  await pg.evaluate(() => { window.prompt = () => '2211'; });
  await pg.evaluate(t => {
    for (const tr of document.querySelectorAll('#itbl tbody tr'))
      if ((tr.textContent || '').indexOf(t) >= 0) tr.querySelector('.c-due').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }, TASK);
  await pg.waitForTimeout(1200);
  ok('a double-click still sets the date by hand', (await cell()) === '22 Nov', await cell());

  await b.close(); server.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
  process.exit(fail ? 1 : 0);
})();
