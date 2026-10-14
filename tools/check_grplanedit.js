#!/usr/bin/env node
/* Golden Record — the ACTION PLAN ON SCREEN, EDITABLE AND MOVABLE (Ray, 14 Oct 2026: "can you surface the action plan in
   the golden record module and make each tasks editable/ movable on each month as well").

   Renders the REAL page against a stubbed FCC (the audit of tools/check_grplan.js) with an in-page /api/state that keeps
   what the board saves, then drives the board the way an AM would: moves a task with ›, rewords one, takes one out and puts
   it back, adds one of the team's own, DRAGS one into another month — and checks every move reaches the shared store, the
   KPI band follows, a reload keeps it, the client's ⬇ HTML closes on the SAME plan with none of the controls, demo mode
   hides the controls, and ↺ goes back to the plan the audit reads.

   Run: NODE_PATH=$(npm root -g) node tools/check_grplanedit.js
*/
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }

const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html') + '#Reiss%7Cgb';
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : '')); }
};

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin', 'mpn',
  'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category', 'product_type',
  'sale_price', 'additional_image_link', 'product_highlight', 'product_detail', 'material', 'pattern', 'size_type', 'size_system'];
const COV = { price: 92, gtin: null, mpn: null, material: 30, pattern: 100, sale_price: 100, product_highlight: 100, product_detail: 100 };
const rule = (n, pct) => ({ n, pct, eg: ['EXAMPLE TITLE'] });
const QUALITY = {
  t: Date.now(), client: 'Reiss', market: 'gb', rows: 1000,
  attrs: { title: { filled: 1000, cov: 100, avgLen: 58, minLen: 12, maxLen: 160, rules: { caps: rule(120, 12) } } },
  ai: { total: 61, tier: 3, tierLabel: 'Enriched', sampled: 1000, rows: 1000, pillars: [
    { key: 'identity', label: 'Identity & trust', score: 100, weight: 1.4 }, { key: 'titles', label: 'Title anatomy', score: 62, weight: 1.6 },
    { key: 'descriptions', label: 'Descriptions', score: 90, weight: 1.3 }, { key: 'attributes', label: 'Attribute completeness', score: 92, weight: 1.5 },
    { key: 'taxonomy', label: 'Taxonomy depth', score: 41, weight: 1.2 }, { key: 'media', label: 'Media richness', score: 100, weight: 1.0 },
    { key: 'conv', label: 'Conversational attributes', score: 0, weight: 2.4 }, { key: 'detail', label: 'Structured detail', score: 55, weight: 1.2 }] },
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  await page.addInitScript(({ ATTRS, QUALITY, COV }) => {
    const NOW = Date.now(), cov = {}, attrs = {};
    ATTRS.forEach((k) => {
      const c = k in COV ? COV[k] : 100;
      cov[k] = c; attrs[k] = c == null ? { present: false } : { present: true, filled: c * 10, cov: c };
    });
    const peerCov = {}; ATTRS.forEach((k) => { peerCov[k] = 100; });
    const feeds = {
      'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 80, ai: { n: 0, of: 6 }, cov, reqMissing: [] },
      'Superdry|gb': { client: 'Superdry', mkt: 'gb', status: 'ok', t: NOW, rows: 900, score: 97, ai: { n: 0, of: 6 }, cov: peerCov, reqMissing: [] },
      'Monsoon|gb': { client: 'Monsoon', mkt: 'gb', status: 'ok', t: NOW, rows: 800, score: 85, ai: { n: 0, of: 6 }, cov: peerCov, reqMissing: [] },
    };
    window.__store = JSON.parse(sessionStorage.getItem('__store') || '{}'); window.__puts = [];
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url), j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/state?ns=grplan')) { window.__gets = (window.__gets || 0) + 1; return j({ grplan: JSON.parse(JSON.stringify(window.__store)) }); }
      if (u.endsWith('/api/state') && opts && opts.method === 'PUT') {
        const b = JSON.parse(opts.body); if (b.grplan) { window.__store = b.grplan; window.__puts.push(b.grplan); sessionStorage.setItem('__store', JSON.stringify(b.grplan)); return j({ grplan: b.grplan }); }
      }
      return j({});
    };
  }, { ATTRS, QUALITY, COV });
  await page.goto(PAGE);
  await page.waitForSelector('#ap-tier', { timeout: 15000 });
  await page.waitForTimeout(700);
  const read = () => page.evaluate(() => {
    const t = document.getElementById('ap-tier');
    return { lanes: Array.from(t.querySelectorAll('.ap-lane')).map((l) => Array.from(l.querySelectorAll('.ap-tk[data-apid]')).map((c) => ({ id: c.getAttribute('data-apid'), t: (c.querySelector('.ap-t') || {}).innerText || '', tag: (c.querySelector('.ap-tag') || {}).innerText || '' }))),
      kpi: Array.from(t.querySelectorAll('.ap-k div')).map((d) => d.innerText.replace(/\s+/g, ' ')), rem: (t.querySelector('.ap-rem summary') || {}).innerText || '',
      reset: !!document.getElementById('ap-reset') };
  });
  const MN = [1, 2, 3].map((i) => { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth() + i, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); });
  const it = () => page.evaluate(() => ((window.__store['Reiss|gb'] || {}).it) || {});
  const nAct = (r) => +((r.kpi[0] || '').match(/\d+/) || [0])[0];

  console.log('-- on screen');
  let r = await read();
  const vis = await page.evaluate(() => { const t = document.getElementById('ap-tier'); return t && getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 100; });
  ok('the plan is a section of the scorecard, on screen', vis);
  ok('three months, every action on the board — the lanes add up to the Actions figure', r.lanes.length === 3 && r.lanes.flat().length === nAct(r) && nAct(r) >= 6, { lanes: r.lanes.map((l) => l.length), kpi: r.kpi });
  ok('nothing edited yet, so no ↺', !r.reset);
  const before = r;

  console.log('-- move with ›');
  const first = before.lanes[0][0];
  await page.click('#ap-tier .ap-tk[data-apid="' + first.id + '"] [data-apmv][data-d="1"]');
  await page.waitForTimeout(150);
  r = await read();
  ok('the task leaves the first month and lands at the end of the second', !r.lanes[0].some((c) => c.id === first.id) && r.lanes[1][r.lanes[1].length - 1].id === first.id, r.lanes.map((l) => l.map((c) => c.id)));
  let st = await it();
  ok('…saved to the team store under Reiss|gb with the month it is in', st[first.id] && st[first.id].m === MN[1], st[first.id]);
  ok('…and the order of that month saved with it', r.lanes[1].every((c, i) => st[c.id] && st[c.id].i === i), r.lanes[1].map((c) => st[c.id]));
  ok('↺ appears once there is an edit', r.reset);

  console.log('-- reword');
  const ed = r.lanes[0][0];
  await page.click('#ap-tier .ap-tk[data-apid="' + ed.id + '"] [data-aped]');
  await page.fill('#ap-tier .ap-in-t', 'Send GTINs for the spring range first');
  await page.selectOption('#ap-tier .ap-in-o', 'fs');
  await page.click('#ap-tier [data-apsave]');
  await page.waitForTimeout(150);
  r = await read();
  const edc = r.lanes.flat().find((c) => c.id === ed.id);
  ok('the card reads the new wording and says it was edited', edc && edc.t === 'Send GTINs for the spring range first' && edc.tag === 'edited', edc);
  st = await it();
  ok('…the wording and owner saved, nothing else invented', st[ed.id] && st[ed.id].t === 'Send GTINs for the spring range first' && st[ed.id].own === 'fs' && st[ed.id].w === undefined, st[ed.id]);

  console.log('-- take out, put back');
  const n0 = nAct(r), gone = r.lanes[2][0];
  await page.click('#ap-tier .ap-tk[data-apid="' + gone.id + '"] [data-apdel]');
  await page.waitForTimeout(150);
  r = await read();
  ok('taken out: off the board, one fewer action, listed as taken out', !r.lanes.flat().some((c) => c.id === gone.id) && nAct(r) === n0 - 1 && /1 task taken out/.test(r.rem), { n: nAct(r), rem: r.rem });
  await page.click('#ap-tier .ap-rem summary');
  await page.click('#ap-tier [data-apback="' + gone.id + '"]');
  await page.waitForTimeout(150);
  r = await read();
  ok('put back: on the board again', r.lanes.flat().some((c) => c.id === gone.id) && nAct(r) === n0 && !r.rem, { n: nAct(r) });

  console.log('-- add a task of the team\'s own');
  await page.click('#ap-tier [data-apadd="2"]');
  await page.fill('#ap-tier .ap-in-t', 'Review the Christmas gifting titles');
  await page.fill('#ap-tier .ap-in-w', 'Agreed on the October call.');
  await page.click('#ap-tier [data-apsave]');
  await page.waitForTimeout(150);
  r = await read();
  const add = r.lanes[2].find((c) => c.t === 'Review the Christmas gifting titles');
  ok('the new task is in the third month, marked added, and counted', add && add.tag === 'added' && nAct(r) === n0 + 1, { add, n: nAct(r) });
  st = await it();
  ok('…saved as the team\'s own task in that month', add && st[add.id] && st[add.id].c === 1 && st[add.id].m === MN[2], add && st[add.id]);

  console.log('-- drag into another month');
  const dragc = r.lanes[2][0];
  await page.dragAndDrop('#ap-tier .ap-tk[data-apid="' + dragc.id + '"]', '#ap-tier .ap-lane[data-apm="0"] .ap-lh');
  await page.waitForTimeout(200);
  r = await read();
  ok('dragged onto the first month: it is there now, at the top', r.lanes[0][0] && r.lanes[0][0].id === dragc.id && !r.lanes[2].some((c) => c.id === dragc.id), r.lanes.map((l) => l.map((c) => c.id)));
  st = await it();
  ok('…and saved there', st[dragc.id] && st[dragc.id].m === MN[0] && st[dragc.id].i === 0, st[dragc.id]);

  console.log('-- a reload keeps the team\'s plan');
  const kept = r;
  await page.reload();
  await page.waitForSelector('#ap-tier', { timeout: 15000 });
  await page.waitForTimeout(700);
  r = await read();
  ok('the same board after a reload', JSON.stringify(r.lanes) === JSON.stringify(kept.lanes), { was: kept.lanes.map((l) => l.length), now: r.lanes.map((l) => l.length) });

  console.log('-- the client\'s ⬇ HTML closes on the same plan');
  await page.evaluate(() => {
    window.__html = null; window.__grPlainExport = true;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { b.text().then((t) => { window.__html = t; }); return real(b); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.click('#det-html');
  await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
  const html = await page.evaluate(() => window.__html);
  const tmp = path.join(os.tmpdir(), 'grplanedit_' + process.pid + '.html');
  fs.writeFileSync(tmp, html);
  const out = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await out.goto('file://' + tmp);
  const f = await out.evaluate(() => {
    const pp = document.getElementById('print-plan');
    return { lanes: Array.from(pp.querySelectorAll('.ap-lane')).map((l) => Array.from(l.querySelectorAll('.ap-t')).map((t) => t.innerText)),
      board: !!document.getElementById('ap-tier'), ctl: document.querySelectorAll('.ap-ctl,.ap-add,.ap-tag,[data-apmv],[data-aped]').length };
  });
  const scr = r.lanes.map((l) => l.map((c) => c.t));
  ok('the file\'s plan is the board, month for month, task for task', JSON.stringify(f.lanes) === JSON.stringify(scr), { file: f.lanes, screen: scr });
  ok('…with the edited wording and the added task in it', f.lanes.flat().includes('Send GTINs for the spring range first') && f.lanes.flat().includes('Review the Christmas gifting titles'));
  ok('…and none of the AM\'s board or its controls', !f.board && f.ctl === 0, f);
  await out.close(); fs.unlinkSync(tmp);

  console.log('-- demo mode');
  const dm = await page.evaluate(() => { document.body.classList.add('demo'); const c = document.querySelector('#ap-tier .ap-ctl'), a = document.querySelector('#ap-tier .ap-add');
    const res = { ctl: c && getComputedStyle(c).display, add: a && getComputedStyle(a).display }; document.body.classList.remove('demo'); return res; });
  ok('demo mode hides the controls on a client screen share', dm.ctl === 'none' && dm.add === 'none', dm);

  console.log('-- phone');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const ph = await page.evaluate(() => { const b = document.querySelector('#ap-tier .ap-board'); const t = document.getElementById('ap-tier').getBoundingClientRect();
    const wide = Array.from(document.querySelectorAll('#ap-tier *')).filter((e) => e.getBoundingClientRect().right > t.right + 1).map((e) => e.className).slice(0, 5);
    return { cols: b ? getComputedStyle(b).gridTemplateColumns.split(' ').length : 0, over: wide.length > 0, wide, tr: t.right, iw: innerWidth }; });
  ok('on a phone the months stack and nothing in the plan runs past its own box', ph.cols === 1 && !ph.over, ph);
  await page.setViewportSize({ width: 1360, height: 950 });

  console.log('-- back to the audit');
  page.once('dialog', (d) => d.accept());
  await page.click('#ap-reset');
  await page.waitForTimeout(200);
  r = await read();
  st = await it();
  ok('↺ puts the audit\'s plan back and clears the store for this market', JSON.stringify(r.lanes.map((l) => l.map((c) => c.id))) === JSON.stringify(before.lanes.map((l) => l.map((c) => c.id))) && !Object.keys(st).length && !r.reset, r.lanes.map((l) => l.length));

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ Golden action plan on screen: moved, reworded, taken out, added, dragged — saved for the team, and the download follows');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
