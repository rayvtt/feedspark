/* One team, one board — the browser tripwire for Ray's Sep 2026 report that Steven's work was
 * invisible on Ray's FCC ("the updates are not seen by everyone but only by themselves").
 *
 * Two Playwright contexts = two real users with separate localStorage, against an in-process
 * stub of the worker's /api/briefs, /api/state and /api/sheets/append (the append is idempotent
 * on exact normalised task text, exactly like appendPlanRows). Everything here is a regression
 * that actually happened and was reported from the live board:
 *   [1][2] a brief reaches the shared store, and an already-open board sees it
 *   [3][4] a refused save is never reported as saved, and lands by itself on retry
 *   [5]    the poll never overwrites work this tab has not saved
 *   [6][7] briefs ALREADY stranded in a browser publish on next open — once, never resurrected
 *   [8]    a COLLEAGUE's unconfirmed plan row is written to the sheet by whoever opens the board
 *   [9]    a row is only settled as "the plan has it" on EXACT wording — Steven's two real task
 *          names dice at 0.615, so the old fuzzy rule marked one written against the other
 *
 * Run: NODE_PATH=$(npm root -g) node tools/test_teamsync.mjs
 */
import http from 'http'; import fs from 'fs'; import path from 'path';
import { createRequire } from 'module';
import { liftEnvelope, mergeIntoEnvelope } from '../cloudflare/feedspark-deck/src/kvmerge.js';
import { isStateNs } from '../cloudflare/feedspark-deck/src/sharedstate.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.log('  · playwright unavailable — skipped'); process.exit(0); }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8798, U = 'http://127.0.0.1:' + PORT;
const KV = {}; let FAIL = false;
const SHEET = {};                      // sheet id -> [{task,owner,status,due}] (the Project Plan tab)
let SHEETFAIL = false, APPENDS = 0;
const nk = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
let PLANLIVE = null;            // when set, /api/plan/live answers connected with these rows
const API = { '/api/tests': [], '/api/gmail/intake': { items: [], calls: [] },
  '/api/access?me=1': { ok: true, clients: null, modules: null, owner: true, name: 'Ray', ownerName: 'Ray' },
  '/api/plan/live': { ok: true, clients: {} },
  '/api/ingest/pending': { ok: true, items: [] }, '/api/schedule': { ok: true, brands: [] } };
const body = q => new Promise(r => { let b = ''; q.on('data', d => b += d); q.on('end', () => r(b)); });

const server = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://x'), p = u.pathname, now = Date.now();
  const send = (o, h = {}) => { r.writeHead(200, Object.assign({ 'content-type': 'application/json' }, h)); r.end(JSON.stringify(o)); };
  if (p === '/__fail') { FAIL = u.searchParams.get('on') === '1'; return send({ ok: true, FAIL }); }
  if (p === '/__sheetfail') { SHEETFAIL = u.searchParams.get('on') === '1'; return send({ ok: true, SHEETFAIL }); }
  if (p === '/__briefs') return send(liftEnvelope(KV['briefs'] || null, now).data);
  if (p === '/__sheet') return send({ rows: SHEET[u.searchParams.get('id')] || [], appends: APPENDS });
  if (p === '/__seedsheet') { const id = u.searchParams.get('id'); (SHEET[id] = SHEET[id] || []).push({ task: u.searchParams.get('task') }); return send({ ok: true }); }
  if (p === '/__seedstate') {                      // publish a row into the shared store as a colleague would
    const inc = JSON.parse(await body(q) || '{}'), out = {};
    for (const ns of Object.keys(inc)) { if (!isStateNs(ns)) continue;
      const e = mergeIntoEnvelope(liftEnvelope(KV['state:' + ns] || null, now), inc[ns], 0, now, {});
      KV['state:' + ns] = e; out[ns] = e.data; }
    return send(out);
  }
  if (p === '/api/briefs') {
    if (q.method === 'PUT') {
      if (FAIL) { r.writeHead(500, { 'content-type': 'application/json' }); return r.end('{"error":"boom"}'); }
      const inc = JSON.parse(await body(q) || '{}'), base = Number(q.headers['x-sync-base'] || 0) || 0;
      const e = mergeIntoEnvelope(liftEnvelope(KV['briefs'] || null, now), inc, base, now, {});
      KV['briefs'] = e; return send(e.data, { 'X-Sync-Base': String(Date.now()) });
    }
    return send(liftEnvelope(KV['briefs'] || null, now).data, { 'X-Sync-Base': String(Date.now()) });
  }
  if (p === '/api/state') {
    if (q.method === 'PUT') {
      const inc = JSON.parse(await body(q) || '{}'), base = Number(q.headers['x-sync-base'] || 0) || 0, out = {};
      for (const ns of Object.keys(inc)) { if (!isStateNs(ns)) continue;
        const e = mergeIntoEnvelope(liftEnvelope(KV['state:' + ns] || null, now), inc[ns], base, now, {});
        KV['state:' + ns] = e; out[ns] = e.data; }
      return send(out, { 'X-Sync-Base': String(Date.now()) });
    }
    const out = {}; for (const k of Object.keys(KV)) if (k.startsWith('state:')) out[k.slice(6)] = liftEnvelope(KV[k], now).data;
    return send(out, { 'X-Sync-Base': String(Date.now()) });
  }
  if (p === '/api/plan/live' && q.method === 'POST') {
    await body(q);
    if (!PLANLIVE) return send({ ok: true, connected: false });
    const brands = {};
    for (const [b, tasks] of Object.entries(PLANLIVE)) brands[b] = { tasks: tasks.map(t => ({ t, s: 'Open', b: 'open', c: 'keyword', o: '' })) };
    return send({ ok: true, connected: true, brands });
  }
  if (p === '/__planlive') { PLANLIVE = JSON.parse(await body(q) || 'null'); return send({ ok: true }); }
  if (p === '/api/sheets/append') {
    const b = JSON.parse(await body(q) || '{}');
    if (SHEETFAIL) return send({ ok: false, error: 'no editor access' });
    APPENDS++;
    const list = SHEET[b.id] = SHEET[b.id] || [];
    const have = new Set(list.map(x => nk(x.task)));
    let appended = 0, skipped = 0;
    for (const row of (b.rows || [])) { const k = nk(row.task);
      if (!k || have.has(k)) { skipped++; continue; } have.add(k); list.push(row); appended++; }
    return send({ ok: true, appended, skipped, atRow: list.length + 1 });
  }
  if (p.startsWith('/api/sheets/') || p === '/api/gmail/dismiss') return send({ ok: true });
  const key = p + (u.search || ''); if (API[key]) return send(API[key]); if (API[p]) return send(API[p]);
  if (p.startsWith('/api/')) return send({ ok: true });
  if (p === '/workflow' || p === '/') { r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
    return r.end(fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_Workflow.html'))); }
  r.writeHead(404); r.end('no');
});
await new Promise(res => server.listen(PORT, '127.0.0.1', res));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

async function user(opts) {
  opts = opts || {};
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  !! pageerror ' + e.message); fails++; });
  if (opts.briefs) await p.addInitScript(v => { try { localStorage.setItem('fcc-briefs', JSON.stringify(v)); } catch (e) {} }, opts.briefs);
  if (opts.manual) await p.addInitScript(v => { try { localStorage.setItem('fcc-manual', JSON.stringify(v)); } catch (e) {} }, opts.manual);
  // the page assigns window.PLANTASKS in its own <script>; hook the assignment so a seeded plan
  // row survives it (addInitScript alone would be clobbered)
  if (opts.plan) await p.addInitScript(rows => {
    Object.defineProperty(window, 'PLANTASKS', { configurable: true,
      set(v) { try { rows.forEach(r => { const c = v[r.client] = v[r.client] || { latest: [] };
        (c.latest = c.latest || []).push({ t: r.task, s: r.status || 'Open', b: 'open', c: 'keyword', o: '' }); }); } catch (e) {}
        this.__pt = v; }, get() { return this.__pt; } });
  }, opts.plan);
  await p.addInitScript(() => { window.__toasts = [];
    const go = () => { new MutationObserver(ms => { ms.forEach(m => {
      Array.prototype.forEach.call(m.addedNodes, n => {
        if (n.nodeType === 1 && /position:\s*fixed/.test(n.getAttribute('style') || '')) window.__toasts.push(n.textContent || '');
      }); }); }).observe(document.body, { childList: true, subtree: true }); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go); });
  await p.goto(U + '/workflow', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
  return { ctx, p };
}
const briefs = () => fetch(U + '/__briefs').then(r => r.json());
const sheet = id => fetch(U + '/__sheet?id=' + encodeURIComponent(id)).then(r => r.json());
const setFail = v => fetch(U + '/__fail?on=' + (v ? 1 : 0)).then(r => r.json());
const seedState = o => fetch(U + '/__seedstate', { method: 'POST', body: JSON.stringify(o) }).then(r => r.json());
const seedBriefs = o => fetch(U + '/api/briefs', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json());
const planLive = o => fetch(U + '/__planlive', { method: 'POST', body: JSON.stringify(o) }).then(r => r.json());
async function till(fn, want, ms) { const t0 = Date.now(); let v;
  while (Date.now() - t0 < (ms || 12000)) { v = await fn(); if (v === want) return v; await new Promise(r => setTimeout(r, 300)); } return v; }
async function raise(p, client, task) { return p.evaluate(([c, t]) => {
  const g = id => document.getElementById(id);
  const sel = g('bg-client'); if (sel && [...sel.options].every(o => o.value !== c)) { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); }
  if (sel) { sel.value = c; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  g('bg-task').value = t; g('bg-task').dispatchEvent(new Event('input', { bubbles: true }));
  const btn = g('bg-save'); if (!btn) return 'no button'; if (btn.disabled) return 'disabled';
  btn.click(); return 'ok';
}, [client, task]); }

const CASH = 'Keywords Optimisation - Cashmere/Merino - Marketing Planner - 0926';
const GIFT = 'Keywords Optimisation - Gifting - Marketing Planner - 1026';
const REISS_SHEET = '1hGcpxaTYVax4hB_nLYCMlol7sIi3qqF0xQgJGjIgZSg';   // PLANSHEET['Reiss']

console.log('\n[1] Steven raises the brief — it reaches the pipeline');
const S = await user();
ok(await raise(S.p, 'Reiss', CASH) === 'ok', 'the composer saved');
ok(await till(async () => Object.values(await briefs()).some(x => x.task === CASH), true) === true, 'the ticket is in the shared store');

console.log('\n[2] A colleague\'s brief arrives on an already-open board');
const Ray = await user(); const R2 = await user();
await raise(S.p, 'Reiss', GIFT); await S.p.waitForTimeout(800);
await R2.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
ok(await till(() => R2.p.evaluate(() => document.body.innerText.indexOf('Gifting') >= 0), true) === true, 'it appears without a reload');

console.log('\n[3] A save the server refuses is NEVER reported as saved');
await setFail(true);
const before3 = Object.keys(await briefs()).length;
await raise(S.p, 'Reiss', 'Keywords Optimisation - Tailoring - Marketing Planner - 1126');
await S.p.waitForTimeout(2500);
ok(await S.p.evaluate(() => [...document.querySelectorAll('div')].some(d => /not saved to the pipeline yet/i.test(d.textContent || ''))), 'the board says it is not saved and is retrying');
ok(!(await S.p.evaluate(() => [...document.querySelectorAll('div')].some(d => /saved to pipeline · /i.test(d.textContent || '')))), 'and never claims it landed');
ok(Object.keys(await briefs()).length === before3, 'the server really does not have it');

console.log('\n[4] …and it lands by itself once the server is back');
await setFail(false);
ok(await till(async () => Object.values(await briefs()).some(x => /Tailoring/.test(x.task || '')), true, 30000) === true, 'the retry delivered it with no further action');
ok(await till(() => S.p.evaluate(() => ![...document.querySelectorAll('div')].some(d => /not saved to the pipeline yet/i.test(d.textContent || ''))), true) === true, 'and the warning clears');

console.log('\n[5] The poll never overwrites work this tab has not saved');
await setFail(true);
await raise(Ray.p, 'Reiss', 'Keywords Optimisation - Coats - Marketing Planner - 1126');
await Ray.p.waitForTimeout(500);
await Ray.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await Ray.p.waitForTimeout(1200);
ok(await Ray.p.evaluate(() => document.body.innerText.indexOf('Coats') >= 0), 'the unsaved brief is still on screen after a poll');
await setFail(false);
ok(await till(async () => Object.values(await briefs()).some(x => /Coats/.test(x.task || '')), true, 30000) === true, 'and it lands when the server returns');

console.log('\n[6] Briefs ALREADY stranded in a browser are published on next open');
const RUN = '-' + Date.now().toString(36).toUpperCase();
const A1 = 'REIS-20260910-02' + RUN, A2 = 'REIS-20260910-03' + RUN, OLD = 'OLD-1' + RUN;
const held = {};
held[A1] = { id: A1, client: 'Reiss', task: CASH, status: 'running', created: 1, updated: 1, comms: [], hist: [] };
held[A2] = { id: A2, client: 'Reiss', task: GIFT, status: 'running', created: 1, updated: 1, comms: [], hist: [] };
held[OLD] = { id: OLD, client: 'Reiss', task: 'Deleted elsewhere', status: 'done', sv: 1, created: 1, updated: 1, comms: [], hist: [] };
const Steven = await user({ briefs: held });
await Steven.p.waitForTimeout(1500);
let srv = await briefs();
ok(!!srv[A1] && !!srv[A2], 'both stranded briefs reach the pipeline on open');
ok(srv[A1].task.indexOf('Cashmere/Merino') >= 0, 'with their task intact');
ok(!srv[OLD], 'a brief this device already synced is NOT resurrected — that absence was a deletion');
ok(await Steven.p.evaluate(() => (window.__toasts || []).some(t => /held on this device published/i.test(t))), 'and it says so rather than doing it silently');

console.log('\n[7] …and a second open republishes nothing');
const before7 = Object.keys(await briefs()).length;
const Again = await user({ briefs: await Steven.p.evaluate(() => { try { return JSON.parse(localStorage.getItem('fcc-briefs') || '{}'); } catch (e) { return {}; } }) });
await Again.p.waitForTimeout(1500);
ok(Object.keys(await briefs()).length === before7, 'no duplicates, no churn');

console.log('\n[8] A COLLEAGUE\'s unconfirmed plan row is written to the sheet by whoever opens the board');
// Steven's browser published the Intake row to the shared store but his own sheet write never
// landed (no w:1). Ray opens with an empty mirror: the row reaches him through shApply, LONG
// after his boot resync ran. Before this fix nothing ever re-sent it — only Steven's own
// browser could, and Reiss's Project Plan stayed behind with no error anywhere.
const T8 = 'Keywords Optimisation - Outerwear - Marketing Planner - 1126' + RUN;
await seedState({ manual: { ['Reiss|' + T8]: { client: 'Reiss', task: T8, owner: '', status: 'Briefed', due: '' } } });
const Ray8 = await user();
ok(await till(async () => (await sheet(REISS_SHEET)).rows.some(r => r.task === T8), true, 15000) === true,
  'the row reaches Reiss\'s Project Plan from a browser that never created it');
ok(await till(() => Ray8.p.evaluate(() => document.body.innerText.indexOf('Outerwear') >= 0), true) === true,
  'and it is on the Intake board too');

console.log('\n[9] "the plan already has it" is EXACT wording only — a near match is still written');
// Steven's two real task names dice at 0.615, over sameTask's 0.6 threshold. With the fuzzy
// rule, Cashmere/Merino was settled as written the moment Gifting sat in the plan — and never
// reached the sheet. This is the report: "the 2 themes are not added as Task in Intake nor
// Reiss' GS Project Plan".
const T9 = CASH + RUN, NEAR = GIFT + RUN;
await fetch(U + '/__seedsheet?id=' + encodeURIComponent(REISS_SHEET) + '&task=' + encodeURIComponent(NEAR));
await seedState({ manual: { ['Reiss|' + T9]: { client: 'Reiss', task: T9, owner: '', status: 'Briefed', due: '' } } });
const Ray9 = await user({ plan: [{ client: 'Reiss', task: NEAR, status: 'Briefed' }] });
ok(await till(async () => (await sheet(REISS_SHEET)).rows.some(r => r.task === T9), true, 15000) === true,
  'the near-miss sibling is written, not silently settled against the other theme');

console.log('\n[10] A briefed ticket with no task in the plan is filed — even beside a fuzzy sibling');
// Ray's Brief Ledger, 16 Sep 2026: REIS-20260910-02 (Cashmere/Merino) and REIS-20260914-01
// (Gifting) sitting at Test running, briefed by Steven, with no Intake row and no plan row.
// reconcileBriefTasks asked "is it already in Intake?" with the FUZZY sameTask, and Reiss's
// own plan carries "Keywords Optimisation - Leather & Suede - Marketing Planner - 0926" —
// dice 0.714 against Cashmere/Merino. So it said yes, stamped planned, and filed nothing.
// planned:1 below is that stale stamp: the fix has to heal a ticket ALREADY carrying it.
const SIB = 'Keywords Optimisation - Leather & Suede - Marketing Planner - 0926';
// deliberately NOT the CASH string scenario [9] already wrote into this stub's sheet — a
// pre-fix run passed on that row and proved nothing. Knitwear dices 0.769 against the sibling.
const T10 = 'Keywords Optimisation - Knitwear - Marketing Planner - 0926' + RUN;
const ID10 = 'REIS-20260910-02' + RUN;
await planLive({ Reiss: [SIB] });
await seedBriefs({ [ID10]: { id: ID10, client: 'Reiss', task: T10, status: 'running', by: 'Steven Opuni', due: '15092026', planned: 1, created: 1, updated: 1, comms: [], hist: [] } });
const Ray10 = await user();
ok(await till(async () => (await sheet(REISS_SHEET)).rows.some(r => r.task === T10), true, 15000) === true,
  'the ticket\'s task is written into Reiss\'s Project Plan');
ok(await till(() => Ray10.p.evaluate(t => document.body.innerText.indexOf(t) >= 0, 'Knitwear'), true) === true,
  'and it shows in Intake');
// the blocker was isDup: every "Keywords Optimisation - <theme> - Marketing Planner" ticket
// anchored to the same Intake row at dice >= .45 and collapsed into one, so the reconcile
// skipped it and it never rendered as its own record anywhere
const dupMark = await Ray10.p.evaluate(() => {
  const t = document.getElementById('bl-tog'); if (t) t.click();
  return [...document.querySelectorAll('#bl-rows tr')].map(r => ({
    task: (r.querySelectorAll('td')[2] || {}).textContent || '',
    dup: !!r.querySelector('td span[title^="Collapsed duplicate"]') }));
});
const knit = dupMark.filter(r => r.task.indexOf('Knitwear') >= 0);
ok(knit.length === 1 && !knit[0].dup, 'and it is NOT collapsed as a duplicate of another keyword ticket');
const collapsed = dupMark.filter(r => r.dup);
ok(collapsed.length === 0, 'no distinct keyword theme is collapsed into another — ' +
  (collapsed.length ? JSON.stringify(collapsed.map(r => r.task.slice(0, 50))) : 'none'));

console.log('\n[11] …and a ticket whose task IS in the plan is not filed twice');
const T11 = SIB;   // already a live plan row
const ID11 = 'REIS-20260101-99' + RUN;
const appendsBefore = (await sheet(REISS_SHEET)).appends;
await seedBriefs({ [ID11]: { id: ID11, client: 'Reiss', task: T11, status: 'running', created: 1, updated: 1, comms: [], hist: [] } });
const Ray11 = await user();
await Ray11.p.waitForTimeout(3000);
const rows11 = (await sheet(REISS_SHEET)).rows.filter(r => r.task === T11).length;
ok(rows11 === 0, 'a task the plan already carries is never appended again');
ok((await sheet(REISS_SHEET)).appends >= appendsBefore, 'sanity: the sheet stub stayed reachable');

console.log('\n[12] The ledger names the owner on a brief raised before `by` existed');
const led = await Ray11.p.evaluate(() => {
  const t = document.getElementById('bl-tog'); if (t) t.click();
  const rows = [...document.querySelectorAll('#bl-rows tr')];
  return rows.map(r => { const c = r.querySelectorAll('td');
    return { task: (c[2] || {}).textContent || '', by: ((c[3] || {}).textContent || '').trim(),
             inf: !!r.querySelector('.by-inf') }; });
});
const dashless = led.filter(r => r.by === '—');
ok(led.length > 0, 'the ledger rendered ' + led.length + ' rows');
ok(dashless.length === 0, 'no row is left as a dash');
const stevens = led.filter(r => r.by === 'Steven Opuni');
ok(stevens.length > 0 && stevens.every(r => !r.inf), 'a brief that recorded its author keeps that name, unmarked');
// ID11 is the one seeded with NO `by`; the briefs raised through the composer above genuinely
// recorded by:'Ray', so those must read Ray WITHOUT the inferred marking
const unattr = led.filter(r => r.task.indexOf('Leather & Suede') >= 0);
ok(unattr.length > 0 && unattr.every(r => r.by === 'Ray' && r.inf),
  'the unattributed brief reads Ray, marked as the inference it is');
const own = led.filter(r => r.task.indexOf('Tailoring') >= 0);
ok(own.length > 0 && own.every(r => r.by === 'Ray' && !r.inf),
  'a brief Ray actually raised records his name and is NOT marked inferred');

await b.close(); server.close();
console.log(fails ? ('\nFAIL (' + fails + ')') : '\nPASS');
process.exit(fails ? 1 : 0);
