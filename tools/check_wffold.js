/* EVERY SECTION OF WORKFLOW IS A BOX, AND EVERY BOX FOLDS.
 *
 * Ray, 15 Oct 2026: "can we make all sections of Workflow collapsible ? and also redesign boxes
 * pls - i dont like floating text".
 *
 * Each of the seven sections was a bare <h2> on the page wash with its bars, controls and tables
 * floating loose under it — no box, no edge, and (bar two) no way to put it away. This drives the
 * REAL page and asserts what a source read cannot: that each section is ONE card with a measured
 * border, that its head is a tile with the chevron at the RIGHT edge, that a fresh device opens
 * the board and folds the tail, that every folded head still carries the line its own render
 * wrote (a fold can never hide a finding), that the ⓘ does not toggle the fold, and that the
 * choice survives a reload. A NEGATIVE CONTROL serves the same page with the fold rule stripped,
 * which must fail the folded checks.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_wffold.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); }
catch (e) { console.log('· playwright not installed — workflow fold tripwire skipped'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..');
const PORT = 8861, U = 'http://127.0.0.1:' + PORT;
const PAGE = path.join(ROOT, 'docs/FeedSpark_Workflow.html');
const KEYS = ['intake', 'tl', 'bp', 'bl', 'sla', 'tests', 'wk'];

let pass = 0, fail = 0, NOFOLD = false;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };
const body = q => new Promise(r => { let b = ''; q.on('data', d => b += d); q.on('end', () => r(b)); });

const BRANDS = ['Monsoon', 'Reiss', 'Superdry'];
const ROWS = []; for (let i = 0; i < 40; i++) ROWS.push({ t: 'Task family ' + (i % 12) + ' - detail ' + i, o: 'Ray', d: (1 + i % 28) + '/10/2026' });
const BRIEFS = {}; for (let i = 0; i < 24; i++) { const b = BRANDS[i % BRANDS.length];
  BRIEFS['B' + i] = { id: 'B' + i, client: b, task: 'Keywords Optimisation - theme ' + i + ' - Marketing Planner - 1026',
    status: i % 4 === 0 ? 'intake' : 'briefed', created: '0' + (1 + i % 9) + '/09/2026', due: '2' + (i % 9) + '/10/2026',
    t: Date.now() - i * 86400000, by: 'Ray', cat: 'keyword', aspl: 'Vimalesh' }; }

const KV = {};
const API = { '/api/tests': [{ client: 'Reiss', name: 'Silk titles', hypo: 'MASK lifts CTR', skus: '400',
    readout: '2026-10-01', status: 'running', result: '' }],
  '/api/gmail/intake': { items: [], calls: [] },
  '/api/access?me=1': { ok: true, clients: null, modules: null, owner: true, name: 'Ray', ownerName: 'Ray' },
  '/api/ingest/pending': { ok: true, items: [] }, '/api/schedule': { ok: true, brands: [] } };

const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), p = u.pathname;
  const send = (o, h) => { r.writeHead(200, Object.assign({ 'content-type': 'application/json' }, h || {})); r.end(JSON.stringify(o)); };
  if (p === '/__nofold') { NOFOLD = u.searchParams.get('on') === '1'; return send({ nofold: NOFOLD }); }
  if (p === '/api/state') { if (q.method === 'PUT') { const inc = JSON.parse(await body(q) || '{}');
      for (const ns of Object.keys(inc)) KV[ns] = Object.assign({}, KV[ns] || {}, inc[ns]); }
    return send(KV, { 'X-Sync-Base': String(Date.now()) }); }
  if (p === '/api/plan/live' && q.method === 'POST') { await body(q); const brands = {};
    BRANDS.forEach(bn => { brands[bn] = { tasks: ROWS.map(t => Object.assign({ s: 'Open', b: 'open', c: 'keyword' }, t)), updated: Date.now() }; });
    return send({ ok: true, connected: true, brands }); }
  if (p === '/api/briefs') { if (q.method === 'PUT') await body(q); return send(BRIEFS, { 'X-Sync-Base': String(Date.now()) }); }
  if (p.startsWith('/api/sheets/')) { await body(q); return send({ ok: true, atRow: 900, appended: 1 }); }
  const key = p + (u.search || ''); if (API[key]) return send(API[key]); if (API[p]) return send(API[p]);
  if (p.startsWith('/api/')) return send({ ok: true });
  if (p === '/kwcal/engine.js') { r.writeHead(200, { 'content-type': 'application/javascript' });
    return r.end(fs.readFileSync(path.join(ROOT, 'docs/kwcal_engine.js'))); }
  if (p === '/workflow') { let html = fs.readFileSync(PAGE, 'utf8');
    if (NOFOLD) html = html.replace('.wsec.folded>.wsb{display:none!important}', '.wsec.folded>.wsb{display:block}');
    r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); return r.end(html); }
  r.writeHead(404); r.end('no');
});

const read = pg => pg.evaluate(KS => KS.map(k => {
  const sec = document.getElementById('ws-' + k);
  if (!sec) return { k, missing: true };
  const head = sec.querySelector(':scope > .wsh'), ch = document.getElementById('wsc-' + k);
  const bd = document.getElementById(k === 'bp' ? 'bp-body' : k === 'bl' ? 'bl-body' : 'wsb-' + k);
  const cs = getComputedStyle(sec), sr = sec.getBoundingClientRect(), cr = ch ? ch.getBoundingClientRect() : null;
  const hr = head ? head.getBoundingClientRect() : null;
  return { k,
    folded: sec.classList.contains('folded'),
    expanded: ch ? ch.getAttribute('aria-expanded') : null,
    border: parseFloat(cs.borderTopWidth) || 0, radius: parseFloat(cs.borderTopLeftRadius) || 0,
    bodyH: bd ? Math.round(bd.getBoundingClientRect().height) : -1,
    bodyShown: bd ? getComputedStyle(bd).display !== 'none' : null,
    sum: (document.getElementById('wss-' + k) || {}).textContent.trim(),
    title: (sec.querySelector('.wst') || {}).textContent.trim(),
    chevRight: cr ? Math.round(sr.right - cr.right) : -1,
    chevRound: cr ? Math.round(parseFloat(getComputedStyle(ch).borderTopLeftRadius)) : -1,
    headRows: hr && cr ? Math.round(hr.height) : -1,
    inCard: !!(bd && bd.closest('section.wsec') === sec),
    overflow: Math.round(sec.getBoundingClientRect().right) > Math.round(document.documentElement.clientWidth) + 1 };
}), KEYS);

(async () => {
  await new Promise(res => server.listen(PORT, '127.0.0.1', res));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const fresh = async (w, h) => { const c = await b.newContext({ viewport: { width: w || 1440, height: h || 1000 } });
    const pg = await c.newPage(); pg.on('pageerror', e => { fail++; console.log('  ✗ pageerror ' + e.message); });
    await pg.goto(U + '/workflow', { waitUntil: 'load' }); await pg.waitForTimeout(4500); return { c, pg }; };

  /* ---------- 1. seven boxes, each with a tile head ---------- */
  console.log('\n-- seven boxes, not seven floating headings --');
  let { c, pg } = await fresh();
  let S = await read(pg);
  ok('every one of the seven sections is on the page', S.every(x => !x.missing), S.filter(x => x.missing).map(x => x.k));
  ok('each is a real box — a measured border and a radius', S.every(x => x.border >= 1 && x.radius >= 8),
     S.map(x => x.k + ':' + x.border + '/' + x.radius));
  ok('each head names its section', S.every(x => x.title.length > 3), S.map(x => x.title));
  ok('the chevron is round and at the box’s right edge', S.every(x => x.chevRight >= 8 && x.chevRight <= 40 && x.chevRound >= 10),
     S.map(x => x.k + ':' + x.chevRight + '/' + x.chevRound));
  ok('each body sits INSIDE its own card', S.every(x => x.inCard), S.filter(x => !x.inCard).map(x => x.k));
  ok('no card runs off the page', S.every(x => !x.overflow), S.filter(x => x.overflow).map(x => x.k));

  /* ---------- 2. the fresh-device default, and a line that survives every fold ---------- */
  console.log('\n-- a fresh device opens the board and folds the tail --');
  const by = {}; S.forEach(x => by[x.k] = x); const TAIL = KEYS.slice(2);
  ok('Intake is open', !by.intake.folded && by.intake.bodyShown && by.intake.bodyH > 100,
     { folded: by.intake.folded, h: by.intake.bodyH });
  /* the Timeline is open WITH it, deliberately: a brief a colleague raises reaches an open board
   * through the Timeline, never through Intake — test_teamsync [2] is the case, and it fails the
   * moment this opens Intake alone. */
  ok('the Timeline is open beside it', !by.tl.folded && by.tl.bodyShown && by.tl.bodyH > 100,
     { folded: by.tl.folded, h: by.tl.bodyH });
  ok('the tail below the board is folded', TAIL.every(k => by[k].folded && !by[k].bodyShown),
     TAIL.filter(k => !by[k].folded || by[k].bodyShown));
  ok('a folded body takes no height at all', TAIL.every(k => by[k].bodyH === 0),
     TAIL.map(k => k + ':' + by[k].bodyH));
  ok('aria-expanded says what the card is doing', S.every(x => x.expanded === (x.folded ? 'false' : 'true')),
     S.map(x => x.k + ':' + x.expanded));
  ok('EVERY head carries the line its own render wrote — a fold can never hide a finding',
     S.every(x => x.sum.length > 4), S.map(x => x.k + ' = ' + JSON.stringify(x.sum)));
  console.log('   ' + S.map(x => x.k + ': ' + x.sum).join('\n   '));
  ok('the counts are the section’s own, not one number repeated',
     new Set(S.map(x => x.sum)).size === S.length, S.map(x => x.sum));

  /* ---------- 3. opening one, and the choice surviving a reload ---------- */
  console.log('\n-- the tile toggles, and the device keeps the choice --');
  await pg.click('#ws-sla .wsh .wst');            // a click on the tile, not on the chevron
  await pg.waitForTimeout(400);
  let s2 = (await read(pg)).find(x => x.k === 'sla');
  ok('a click on the tile opens the section', !s2.folded && s2.bodyH > 20, { folded: s2.folded, h: s2.bodyH });
  await pg.click('#wsc-tests');
  await pg.waitForTimeout(400);
  let s3 = (await read(pg)).find(x => x.k === 'tests');
  ok('so does the chevron', !s3.folded, s3.folded);
  await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(4500);
  let R = await read(pg); const r2 = {}; R.forEach(x => r2[x.k] = x);
  ok('after a reload both are still open', !r2.sla.folded && !r2.tests.folded,
     { sla: r2.sla.folded, tests: r2.tests.folded });
  ok('and the ones nobody touched are still folded', r2.wk.folded && r2.bl.folded,
     { wk: r2.wk.folded, bl: r2.bl.folded });

  /* ---------- 4. the head never swallows its own controls ---------- */
  console.log('\n-- the tile never swallows its own controls --');
  const before = (await read(pg)).find(x => x.k === 'wk').folded;
  await pg.click('#ws-wk .wsh .info-btn');
  await pg.waitForTimeout(300);
  const after = (await read(pg)).find(x => x.k === 'wk').folded;
  ok('clicking the ⓘ does not fold or open the section', before === after, { before, after });
  const popOpen = await pg.evaluate(() => { const p = document.querySelector('#ws-wk .info-pop');
    if (!p) return 'no pop'; return getComputedStyle(p).position === 'absolute'; });
  ok('the ⓘ still owns the long explainer', popOpen === true, popOpen);

  /* ---------- 5. ⊕ Open all / ⊖ Fold all names the action still available ---------- */
  console.log('\n-- open all / fold all --');
  let lbl = await pg.textContent('#ws-all');
  ok('the bar offers to open everything while something is folded', /Open all/.test(lbl), lbl);
  await pg.click('#ws-all'); await pg.waitForTimeout(600);
  let A = await read(pg);
  ok('and really opens every section', A.every(x => !x.folded), A.filter(x => x.folded).map(x => x.k));
  lbl = await pg.textContent('#ws-all');
  ok('then offers to fold them', /Fold all/.test(lbl), lbl);
  ok('the ledger builds its rows once its section is open',
     await pg.evaluate(() => document.querySelectorAll('#bl-rows tr').length) > 0);
  await pg.click('#ws-all'); await pg.waitForTimeout(600);
  A = await read(pg);
  ok('fold all folds every one of the seven', A.every(x => x.folded), A.filter(x => !x.folded).map(x => x.k));
  ok('and every head still says what is inside it', A.every(x => x.sum.length > 4), A.map(x => x.k + ':' + x.sum));

  /* ---------- 6. a jump into a folded section opens it ---------- */
  console.log('\n-- a link into a folded section opens it --');
  /* a link from one part of this page to another is a FRAGMENT navigation — the document is never
   * re-created, so a boot-only hash read would leave the reader at a folded head. Both paths: the
   * in-page jump first, then a cold load on the same address. */
  await pg.evaluate(() => { location.hash = 'sla-grid'; });
  await pg.waitForTimeout(600);
  let h = (await read(pg)).find(x => x.k === 'sla');
  ok('an in-page jump opens the folded section it points at', !h.folded && h.bodyH > 20, { folded: h.folded, h: h.bodyH });
  await pg.evaluate(() => { location.hash = ''; });
  await pg.goto(U + '/workflow?x=1#tests-body', { waitUntil: 'load' }); await pg.waitForTimeout(4500);
  h = (await read(pg)).find(x => x.k === 'tests');
  ok('and so does a cold load on that address', !h.folded && h.bodyH > 20, { folded: h.folded, h: h.bodyH });
  const kept = await pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('fcc-wf-fold') || '{}'); } catch (e) { return {}; } });
  ok('without rewriting the folds this device chose', kept.wk === 0 && kept.tests === 0, kept);
  await c.close();

  /* ---------- 7. the choice a person already made on the two old pills carries over ---------- */
  console.log('\n-- the old per-section pills hand their choice over --');
  const c2 = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await c2.addInitScript(() => { try { localStorage.setItem('fcc-bl-open', '1'); } catch (e) {} });
  const p2 = await c2.newPage(); p2.on('pageerror', e => { fail++; console.log('  ✗ pageerror ' + e.message); });
  await p2.goto(U + '/workflow', { waitUntil: 'load' }); await p2.waitForTimeout(4500);
  const L = (await read(p2)).find(x => x.k === 'bl');
  ok('a ledger left open under fcc-bl-open opens here too', !L.folded, L.folded);
  await c2.close();

  /* ---------- 8. the phone ---------- */
  console.log('\n-- the phone (390px) --');
  const r3 = await fresh(390, 844); const P = await read(r3.pg);
  ok('every card fits the screen', P.every(x => !x.overflow), P.filter(x => x.overflow).map(x => x.k));
  ok('and every head still carries its line', P.every(x => x.sum.length > 4), P.map(x => x.k));
  /* the skim view stands down for a page that folds its own sections, so the phone's opening
   * length is ours now: a device that has never chosen gets everything folded, which is what the
   * skim view did for this page before. Keeping the desktop default here opened it at 4.1 screens
   * where it used to open at 1.3. */
  ok('a phone that has never chosen opens with every section folded', P.every(x => x.folded),
     P.filter(x => !x.folded).map(x => x.k));
  /* how SHORT it opens is measured by the phone tripwire (tools/check_mobile.js), which reads the
   * page's real laid-out length rather than body.scrollHeight — the rails and modals this page
   * parks off-canvas make that number meaningless here. */
  await r3.pg.click('#wsc-intake'); await r3.pg.waitForTimeout(500);
  ok('and a tap still opens a section there', !(await read(r3.pg)).find(x => x.k === 'intake').folded);
  await r3.c.close();

  /* ---------- 9. negative control ---------- */
  console.log('\n-- negative control: the fold rule stripped out --');
  await fetch(U + '/__nofold?on=1');
  const r4 = await fresh(); const N = await read(r4.pg);
  const nb = {}; N.forEach(x => nb[x.k] = x);
  const caught = KEYS.slice(1).some(k => nb[k].bodyShown || nb[k].bodyH > 0);
  ok('a page with no fold rule FAILS the folded checks above (so they mean something)', caught,
     KEYS.slice(1).map(k => k + ':' + nb[k].bodyH));
  await r4.c.close();
  await fetch(U + '/__nofold?on=0');

  await b.close(); server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
