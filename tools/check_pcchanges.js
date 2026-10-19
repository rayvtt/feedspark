#!/usr/bin/env node
/* Golden Record — CHANGES ACROSS YOUR PORTFOLIO, rendered (Ray, 19 Oct 2026: "monitor the changes on my entire
   account's portfolio … on a weekly basis, how many brands I have worked on, how many fields I worked on … just for
   the account manager").

   Renders the REAL /golden against a stubbed FCC whose /api/golden/changes answer is built in node by labelguard's
   own histWindow over invented records (Northwind, Atelier, Harbour; two AMs). Asserts what is PAINTED: the counts
   against an independent count, the AM pick narrowing them and defaulting to the signin's own accounts, a week pick
   refetching its own dates, a market click opening that scorecard, the fold and its memory, demo mode, the phone.

   Run: NODE_PATH=$(npm root -g) node tools/check_pcchanges.js
*/
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }

const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html');
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');
let fail = 0;
const ok = (name, cond, extra) => { if (cond) console.log('   ✓ ' + name); else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : '')); } };

(async () => {
  const LG = await import('file://' + ENGINE_LG);
  const today = new Date().toISOString().slice(0, 10);
  const wk = LG.weekRange(today, 0);
  const at = (back, h) => Date.parse(LG.weekRange(today, back).from + 'T' + String(h || 9).padStart(2, '0') + ':00:00Z');
  const cov = { id: 100, title: 100, description: 100, link: 100, image_link: 100, availability: 100, price: 100, brand: 100, gtin: 80, material: 40 };
  const R = (t, extra) => ({ t, rows: 500, cov: Object.assign({}, cov, extra || {}) });
  const prof = LG.profileFor('Northwind', {});
  const win = (h) => LG.histWindow(h, prof, { from: wk.from, to: wk.to });
  const H = (r, q) => ({ v: 1, r, s: [], q: q || [] });
  // Northwind GB: material + highlights moved this week; Northwind DE: quiet; Atelier GB: content quality moved;
  // Harbour GB (no AM): first read this week
  const feeds = [
    Object.assign({ client: 'Northwind', mkt: 'gb', am: 'Ray', tracked: true }, win(H([R(at(1)), R(at(0) + 3600e3, { material: 90, product_highlight: 55 })]))),
    Object.assign({ client: 'Northwind', mkt: 'de', am: 'Ray', tracked: true }, win(H([R(at(1))]))),
    Object.assign({ client: 'Atelier', mkt: 'gb', am: 'Steven', tracked: true }, win(H([], [
      { t: at(1), q: 60, air: 48, qa: { title: { s: 70, f: 500, b: { caps: 200 } } }, ap: { titles: 60 } },
      { t: at(0) + 3600e3, q: 66, air: 48, qa: { title: { s: 82, f: 500, b: { caps: 80 } } }, ap: { titles: 60 } }]))),
    Object.assign({ client: 'Harbour', mkt: 'gb', am: null, tracked: true }, win(H([R(at(0) + 3600e3)]))),
  ];
  const nwGb = feeds[0];
  console.log('-- the independent reading: Northwind GB ' + nwGb.gs.from + ' → ' + nwGb.gs.to + ' · ' + nwGb.gs.fields.length + ' fields');
  ok('the invented records move the way the harness expects', nwGb.changed && !feeds[1].changed && feeds[2].changed && feeds[3].gs.state === 'new', feeds.map((f) => f.changed));

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const run = async (vp, init) => {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
    await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
    await page.addInitScript(({ feeds, init }) => {
      if (location.protocol !== 'file:') return;
      if (init && !sessionStorage.getItem('__seeded')) { Object.keys(init).forEach((k) => localStorage.setItem(k, init[k])); sessionStorage.setItem('__seeded', '1'); }
      const NOW = Date.now();
      const est = {};
      feeds.forEach((f) => { est[f.client + '|' + f.mkt] = { client: f.client, mkt: f.mkt, status: 'ok', t: NOW, rows: 500, score: 80, ai: { n: 0, of: 6 }, cov: {}, reqMissing: [] }; });
      window.__chg = [];
      const real = window.fetch.bind(window);
      window.fetch = (url, opts) => {
        const u = String(url), j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
        if (/engine\.js/.test(u)) return real(url, opts);
        if (u.includes('/api/golden/changes')) {
          const q = new URL(u, 'http://x').searchParams; window.__chg.push(q.get('from') + '..' + q.get('to'));
          return j({ ok: true, from: q.get('from'), to: q.get('to'), me: 'Ray', feeds });
        }
        if (u.includes('/api/golden/estate')) return j({ feeds: est, alerts: {} });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 500, client: 'Northwind', market: 'gb', attrs: {} }, baseline: null, daily: null });
        if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
        if (u.includes('/api/golden/history')) return j({ hist: null });
        if (u.includes('/api/golden/quality')) return j({ quality: null });
        return j({});
      };
    }, { feeds, init });
    await page.goto(PAGE);
    await page.waitForSelector('#pc-panel .pc-kpis', { timeout: 15000, state: 'attached' });
    return { page, ctx };
  };
  const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
  const kpis = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#pc-panel .pc-kpi b')).map((b) => b.innerText.replace(/\s+/g, ' ').trim()));

  console.log('-- desktop, a fresh device');
  const { page, ctx } = await run({ width: 1360, height: 950 });
  ok('the section is section 02, above the estate, open on a fresh device', /Changes across your portfolio/.test(await txt(page, '#sec-pc .cat-h')) &&
    (await page.evaluate(() => document.getElementById('pc-body').offsetHeight > 0 && document.getElementById('sec-pc').compareDocumentPosition(document.getElementById('est-grid')) & 4)));
  ok('it opens on the signin’s own accounts (the Task Manager names Ray)', (await page.$eval('#pc-am', (s) => s.value)) === 'Ray');
  let k = await kpis(page);
  ok('Ray’s week: 1 of 1 brand changed, 1 of 2 markets, Golden Score ▲1 ▼0, the feed fields named in node', k[0] === '1 / 1' && k[1] === '1 / 2' && /▲1 ▼0/.test(k[2]) && k[3] === String(nwGb.gs.fields.length), k);
  ok('the week asked for is this calendar week', (await page.evaluate(() => window.__chg[0])) === wk.from + '..' + wk.to, await page.evaluate(() => window.__chg));
  const brand = await txt(page, '#pc-panel .pc-brand');
  ok('the brand row names its markets changed and each market its fields', /Northwind/.test(brand) && /1 of 2 markets changed/.test(brand) && /g:material ▲ \+50pp/.test(brand), brand);
  await page.selectOption('#pc-am', '*');
  k = await kpis(page);
  ok('All accounts: 2 of 3 brands, 2 of 4 markets, the content fields with the values they fixed', k[0] === '2 / 3' && k[1] === '2 / 4' && /^1 · 120 fixed$/.test(k[4]), k);
  const all = await txt(page, '#pc-panel');
  ok('Atelier shows content quality 60 → 66 and the field with its fix count', /Content quality 60 → 66 ▲ \+6/.test(all) && /g:title ▲ \+12 \(120 fixed\)/.test(all), all.slice(0, 600));
  ok('a brand that did not change is listed as such, not dropped', /No change this week: Harbour/.test(all));
  ok('Harbour, first read this week, is counted apart — never as a week of work', /Harbour/.test(all) && /1 market first read this week/.test(all));
  ok('the fold line keeps the week’s headline', /2 of 3 brands · 2 markets changed/.test(await txt(page, '#pc-sum')), await txt(page, '#pc-sum'));
  await page.selectOption('#pc-wk', 'w1');
  await page.waitForFunction(() => window.__chg.length >= 2);
  const lw = LG.weekRange(today, 1);
  ok('picking last week reads last week', (await page.evaluate(() => window.__chg[window.__chg.length - 1])) === lw.from + '..' + lw.to);
  await page.waitForSelector('#pc-panel .pc-kpis');
  await page.selectOption('#pc-wk', 'w0');
  await page.waitForFunction(() => window.__chg.length >= 3);
  await page.waitForSelector('#pc-panel .pc-mk');
  await page.click('#pc-panel .pc-mk[data-pck="Atelier|gb"]');
  await page.waitForTimeout(500);
  ok('a market click opens that market’s scorecard', /Atelier/.test(await txt(page, '#det-panel') || ''), (await txt(page, '#det-panel') || '').slice(0, 120));
  await page.click('#pc-h h2');
  ok('the head folds the section', (await page.evaluate(() => document.getElementById('pc-body').offsetHeight)) === 0 && (await page.$eval('#pc-h', (e) => e.getAttribute('aria-expanded'))) === 'false');
  await page.click('#pc-am');
  ok('a click on its own pickers never folds it', (await page.evaluate(() => document.getElementById('sec-pc').classList.contains('pc-fold'))) === true);
  await page.reload();
  await page.waitForSelector('#pc-panel .pc-kpis', { state: 'attached' });
  ok('the fold, the AM and the week are remembered on this device', (await page.evaluate(() => document.getElementById('pc-body').offsetHeight)) === 0 && (await page.$eval('#pc-am', (s) => s.value)) === '*');
  await ctx.close();

  console.log('-- demo mode, the phone');
  const d = await run({ width: 1360, height: 900 }, { 'gr-pc-fold': '0' });
  await d.page.click('#demo-tgl');
  ok('demo mode hides it — the AM’s, never a client screen share', (await d.page.evaluate(() => document.getElementById('sec-pc').offsetHeight)) === 0);
  await d.ctx.close();
  const m = await run({ width: 390, height: 844 }, { 'gr-pc-fold': '0', 'gr-pc-am': '*' });
  const over = await m.page.evaluate(() => {
    const W = document.documentElement.clientWidth, bad = [];
    document.querySelectorAll('#sec-pc *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && r.right > W + 1 && !e.closest('.pc-chip')) bad.push(e.tagName + '.' + e.className + ' ' + Math.round(r.right)); });
    return bad.slice(0, 5);
  });
  ok('at 390px nothing in it runs past the screen', over.length === 0, over);
  ok('…and both pickers are on screen', await m.page.evaluate(() => ['pc-am', 'pc-wk'].every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 60 && r.right <= document.documentElement.clientWidth + 1; })));
  await m.ctx.close();

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' failed' : '\n✓ changes across the portfolio — painted, counted, folded');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
