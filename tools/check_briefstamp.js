/* BRIEFING A TASK RECORDS WHO HAS IT AND WHEN IT IS DUE.
 *
 * Ray, 15 Oct 2026, over two briefed Reiss rows whose Owner column read a dash:
 * "btw when using brief to send to Internal briefing - obviously that's an ASPL task",
 * and then "why due date is also not recorded properly" — the same rows read "Oct 26",
 * which is the board's rendering of a MONTH SECTION (1 Oct 2026), not a deadline.
 *
 * Both facts are decided in the composer. This drives the REAL composer off a real Intake row
 * and reads the row back off the PAINT: the Owner cell says ASPL, the Due cell says the date
 * that was briefed, a row somebody already owns is left alone, and the historic rows are filled
 * in once. A NEGATIVE CONTROL strips the stamp and must leave the dash.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_briefstamp.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); }
catch (e) { console.log('· playwright not installed — brief-stamp tripwire skipped'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 8877, U = 'http://127.0.0.1:' + PORT;
const PAGE = path.join(ROOT, 'docs/FeedSpark_Workflow.html');

let pass = 0, fail = 0, NOSTAMP = false;
const writes = [];
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };
const body = q => new Promise(r => { let b = ''; q.on('data', d => b += d); q.on('end', () => r(b)); });

/* One brand, four rows. Two carry a MONTH SECTION as their due (01/10/2026) and no owner —
   exactly the shape of the rows Ray screenshotted; one is owned by Steven; one is already
   briefed by an older ticket and still shows a dash, which is what the backfill is for. */
const TASKS = [
  { t: 'Content Quality - g:material - Reiss BE - 1026', o: '', d: '01/10/2026', s: 'Open', b: 'open', c: 'data' },
  { t: 'UK market-s Coats & Jackets full price > ideas to push', o: '', d: '01/10/2026', s: 'Open', b: 'open', c: 'opt' },
  { t: '[SVS-Q3/26] AI Search Intent - as keywords', o: 'Steven', d: '08/10/2026', s: 'Open', b: 'open', c: 'keyword' },
  { t: 'Keywords Optimisation - Coats & Jackets (Full-priced) - 1126', o: '', d: '21/10/2026', s: 'Briefed', b: 'briefed', c: 'keyword' },
];
const OLD_BRIEF = { 'REIS-20260901-01': { id: 'REIS-20260901-01', client: 'Reiss',
  task: 'Keywords Optimisation - Coats & Jackets (Full-priced) - 1126', taskKey: 'Reiss|Keywords Optimisation - Coats & Jackets (Full-priced) - 1126',
  status: 'briefed', created: '01/09/2026', due: '21102026', t: Date.now() - 20 * 86400000,
  by: 'Steven', cat: 'keyword', planned: 1 } };
const KV = {};
const API = { '/api/tests': [], '/api/gmail/intake': { items: [], calls: [] },
  '/api/access?me=1': { ok: true, clients: null, modules: null, owner: true, name: 'Ray', ownerName: 'Ray' },
  '/api/ingest/pending': { ok: true, items: [] }, '/api/schedule': { ok: true, brands: [] } };

const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), p = u.pathname;
  const send = o => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (p === '/__mode') { NOSTAMP = u.searchParams.get('nostamp') === '1'; writes.length = 0;
    /* The shared store outlives a browser context, so a later run would inherit the overlays the
       earlier one wrote — which is exactly how the negative control first passed by accident. */
    for (const k of Object.keys(KV)) delete KV[k];
    delete OLD_BRIEF['REIS-20260901-01'].stmp;
    return send({ NOSTAMP }); }
  if (p === '/__writes') return send(writes);
  if (p === '/api/state') { if (q.method === 'PUT') { const inc = JSON.parse(await body(q) || '{}');
      for (const ns of Object.keys(inc)) KV[ns] = Object.assign({}, KV[ns] || {}, inc[ns]); }
    return send(KV); }
  if (p === '/api/plan/live' && q.method === 'POST') { await body(q);
    return send({ ok: true, connected: true, brands: { Reiss: { tasks: TASKS, updated: Date.now() } } }); }
  if (p === '/api/briefs') { if (q.method === 'PUT') await body(q); return send(OLD_BRIEF); }
  if (p === '/api/sheets/owner' || p === '/api/sheets/due') {
    const b = JSON.parse(await body(q) || '{}');
    writes.push({ what: p.split('/').pop(), task: b.match, value: b.value });
    return send({ ok: true, cell: 'E9' }); }
  if (p.startsWith('/api/sheets/')) { await body(q); return send({ ok: true, atRow: 516, appended: 1 }); }
  const key = p + (u.search || ''); if (API[key]) return send(API[key]); if (API[p]) return send(API[p]);
  if (p.startsWith('/api/')) return send({ ok: true });
  if (p === '/kwcal/engine.js') { r.writeHead(200, { 'content-type': 'application/javascript' });
    return r.end(fs.readFileSync(path.join(ROOT, 'docs/kwcal_engine.js'))); }
  if (p === '/workflow') { let html = fs.readFileSync(PAGE, 'utf8');
    /* NEGATIVE CONTROL: the stamp does nothing, so the dash and the month section must survive. */
    if (NOSTAMP) html = html.replace('function briefStampRow(b,dueIso){ if(!b||!b.id)return false;',
      'function briefStampRow(b,dueIso){ if(b)return false;');
    r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); return r.end(html); }
  r.writeHead(404); r.end('no');
});

/* The row as a reader sees it: the Owner and Due cells of the Intake table, by task. */
const rowOf = (pg, task) => pg.evaluate((t) => {
  const tr = [...document.querySelectorAll('.itbl tbody tr')].find((x) =>
    (x.querySelector('.c-task') || {}).textContent && x.querySelector('.c-task').textContent.indexOf(t) >= 0);
  if (!tr) return null;
  const tds = [...tr.querySelectorAll('td')];
  return { owner: (tds[4] || {}).textContent ? tds[4].textContent.trim() : '',
    due: (tds[5] || {}).textContent ? tds[5].textContent.trim() : '' };
}, task);

const brief = async (pg, task, dueIso) => {
  await pg.evaluate((t) => {
    const tr = [...document.querySelectorAll('.itbl tbody tr')].find((x) =>
      (x.querySelector('.c-task') || {}).textContent && x.querySelector('.c-task').textContent.indexOf(t) >= 0);
    tr.querySelector('.brief-btn').click();
  }, task);
  await pg.waitForTimeout(500);
  await pg.evaluate((d) => { const el = document.getElementById('bg-due');
    if (el) { el.value = d; el.dispatchEvent(new Event('change', { bubbles: true })); } }, dueIso);
  await pg.waitForTimeout(150);
  await pg.click('#bg-save');
  await pg.waitForTimeout(1200);
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const br = await chromium.launch();
  const open = async () => { const ctx = await br.newContext({ viewport: { width: 1440, height: 1000 } });
    const pg = await ctx.newPage(); pg.on('dialog', d => d.accept());
    await pg.goto(U + '/workflow', { waitUntil: 'load' }); await pg.waitForTimeout(2200); return { ctx, pg }; };

  console.log('── the row Ray screenshotted: no owner, a month section for a due date');
  await fetch(U + '/__mode');
  let { ctx, pg } = await open();
  let before = await rowOf(pg, 'Content Quality - g:material');
  ok('it starts with no owner', before && /^[—\-\s]*$/.test(before.owner), before);
  ok('…and the month section as its date', before && /Oct 26/.test(before.due), before);

  console.log('\n── briefing it');
  await brief(pg, 'Content Quality - g:material', '2026-10-19');
  let after = await rowOf(pg, 'Content Quality - g:material');
  ok('the Owner column says ASPL', after && after.owner === 'ASPL', after);
  ok('and the Due column is the date that was briefed', after && /19 Oct/.test(after.due), after);
  let w = await (await fetch(U + '/__writes')).json();
  ok('the owner really reached the plan sheet',
    w.some(x => x.what === 'owner' && x.value === 'ASPL' && /g:material/.test(x.task)), w);
  ok('…and so did the due date',
    w.some(x => x.what === 'due' && x.value === '19/10/2026' && /g:material/.test(x.task)), w);

  console.log('\n── a task somebody already owns is left alone');
  await brief(pg, '[SVS-Q3/26] AI Search Intent', '2026-10-22');
  const steven = await rowOf(pg, '[SVS-Q3/26] AI Search Intent');
  ok('Steven keeps his task', steven && steven.owner === 'Steven', steven);
  ok('but its due date still follows the brief', steven && /22 Oct/.test(steven.due), steven);

  console.log('\n── an AM who takes a task back is not corrected');
  await pg.evaluate(() => { const m = JSON.parse(localStorage.getItem('fcc-state') || '{}'); return m; });
  await pg.evaluate(() => {
    const tr = [...document.querySelectorAll('.itbl tbody tr')].find((x) =>
      x.textContent.indexOf('g:material') >= 0);
    const td = tr.querySelectorAll('td')[4];
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await pg.waitForTimeout(300);
  await brief(pg, 'Content Quality - g:material', '2026-10-19');
  after = await rowOf(pg, 'Content Quality - g:material');
  ok('one stamp per brief — re-saving writes no second owner', after && after.owner === 'ASPL', after);

  console.log('\n── the rows briefed before the rule, filled in once');
  const old = await rowOf(pg, 'Keywords Optimisation - Coats & Jackets');
  ok('a ticket raised weeks ago no longer shows a dash', old && old.owner === 'ASPL', old);
  await ctx.close();

  console.log('\n── negative control');
  await fetch(U + '/__mode?nostamp=1');
  ({ ctx, pg } = await open());
  await brief(pg, 'Content Quality - g:material', '2026-10-19');
  after = await rowOf(pg, 'Content Quality - g:material');
  ok('without the stamp the dash and the month section survive — the checks can really fail',
    after && /^[—\-\s]*$/.test(after.owner) && /Oct 26/.test(after.due), after);
  await ctx.close();

  await br.close(); server.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' assertions passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
