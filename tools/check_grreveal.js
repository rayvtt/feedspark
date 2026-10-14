#!/usr/bin/env node
/* Golden Record — DEMO REVEAL (Ray, 14 Oct 2026, over the demo-mode estate: "when a brand is popped down,
   the name of the brand starts appearing because I want to show the clients that this is actually the brand").
   In demo every brand card starts folded under its industry alias; opening one names that brand (card,
   scorecard), folding it masks it again, every other brand keeps its alias, switching demo on again starts
   from nothing named, and the AM's own fold layout (gr-collapse) is never touched by the demo's.

   Playwright-based, so it runs in presync. Run: NODE_PATH=$(npm root -g) node tools/check_grreveal.js
   Fixture brands are three of the real roster's NAMES only (the alias table is keyed on them) — no figures. */
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html');
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};
const NAMES = ['Accessorize', 'Monsoon', 'Reiss'];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: path.join(D, 'labelguard_engine.js'), contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: path.join(D, 'feedlab_engine.js'), contentType: 'text/javascript' }));
  await page.addInitScript((NAMES) => {
    if (!sessionStorage.getItem('__seeded')) {
      localStorage.clear(); sessionStorage.clear(); sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('gr-collapse', JSON.stringify(['Reiss']));   // the AM's own layout
      sessionStorage.setItem('gr-demo', '1');
    }
    const NOW = Date.now(), cov = { id: 100, title: 100, description: 100, link: 100, image_link: 100, availability: 100, price: 100 };
    const feeds = {};
    NAMES.forEach((c) => { feeds[c + '|gb'] = { client: c, mkt: 'gb', status: 'ok', t: NOW, rows: 100, cov, reqMissing: [] }; });
    const attrs = {}; Object.keys(cov).forEach((k) => { attrs[k] = { present: true, filled: 100, cov: 100 }; });
    const real = window.fetch.bind(window);
    window.fetch = (url, o) => {
      const u = String(url), j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
      if (/engine\.js/.test(u)) return real(url, o);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/snapshot')) { const c = decodeURIComponent((u.match(/client=([^&]+)/) || [])[1] || 'Reiss');
        return j({ snapshot: { t: NOW, rows: 100, client: c, market: 'gb', attrs }, baseline: { t: NOW, attrs }, daily: null }); }
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      return j({});
    };
  }, NAMES);
  await page.goto(PAGE);
  await page.waitForSelector('.est-card', { timeout: 8000 });
  await page.waitForTimeout(400);
  const read = () => page.evaluate(() => Array.from(document.querySelectorAll('.est-card')).map((c) => ({
    c: c.getAttribute('data-client'), h: c.querySelector('h3').textContent, open: !c.classList.contains('collapsed'),
    rows: c.querySelectorAll('.est-mkt').length })));
  const named = (cards) => cards.filter((x) => x.h === x.c).map((x) => x.c);
  const gridTxt = () => page.evaluate(() => document.getElementById('est-grid').innerText);
  const toggle = (c) => page.click('.est-card[data-client="' + c + '"] .est-hd h3');

  console.log('── demo on, fresh screen share');
  let cards = await read();
  ok('every brand card starts folded in demo', cards.length === 3 && cards.every((x) => !x.open), cards);
  ok('…under its industry alias — no brand named', named(cards).length === 0, cards.map((x) => x.h));
  let txt = await gridTxt();
  ok('…and no real name anywhere on the estate', !NAMES.some((n) => txt.includes(n)), txt.slice(0, 200));

  console.log('── open Monsoon');
  await toggle('Monsoon'); await page.waitForTimeout(200);
  cards = await read();
  const mo = cards.find((x) => x.c === 'Monsoon');
  ok('opening a brand names it on its card', mo.open && mo.h === 'Monsoon' && mo.rows === 1, mo);
  ok('…every other brand stays folded under its alias', named(cards).join() === 'Monsoon' && cards.filter((x) => x.open).length === 1, cards);
  await page.click('.est-card[data-client="Monsoon"] .est-mkt'); await page.waitForTimeout(700);
  const det = await page.evaluate(() => { const h = document.querySelector('#det-panel .det-head h3'); return h ? h.textContent : ''; });
  ok('its scorecard is headed with the brand\'s name', /^Monsoon · GB/.test(det), det);
  await toggle('Accessorize'); await page.waitForTimeout(200);
  cards = await read();
  ok('a second brand opened is named too', named(cards).sort().join() === 'Accessorize,Monsoon', cards);

  console.log('── fold it again');
  await toggle('Monsoon'); await page.waitForTimeout(500);
  cards = await read();
  ok('folding a brand masks its name again', !named(cards).includes('Monsoon') && named(cards).join() === 'Accessorize', cards);
  const det2 = await page.evaluate(() => { const h = document.querySelector('#det-panel .det-head h3'); return h ? h.textContent : ''; });
  ok('…and its open scorecard goes back to the alias', det2 && !/Monsoon/.test(det2), det2);

  console.log('── reload mid-share, then Expand all / Collapse all');
  await page.reload(); await page.waitForSelector('.est-card'); await page.waitForTimeout(400);
  cards = await read();
  ok('a reload keeps what was opened for the share', named(cards).join() === 'Accessorize', cards);
  await page.click('#collapse-all'); await page.waitForTimeout(200);
  cards = await read();
  ok('Collapse all in demo folds and masks every brand', cards.every((x) => !x.open) && named(cards).length === 0, cards);
  await page.click('#collapse-all'); await page.waitForTimeout(200);
  cards = await read();
  ok('Expand all in demo opens and names every brand', cards.every((x) => x.open) && named(cards).length === 3, cards);

  console.log('── demo off, then on again');
  await page.click('#demo-off'); await page.waitForTimeout(300);
  cards = await read();
  ok('out of demo the AM\'s own fold layout is back, untouched', cards.find((x) => x.c === 'Reiss').open === false &&
    cards.filter((x) => x.open).length === 2 && named(cards).length === 3, cards);
  const coll = await page.evaluate(() => localStorage.getItem('gr-collapse'));
  ok('…the demo never wrote to gr-collapse', coll === '["Reiss"]', coll);
  await page.click('#demo-tgl'); await page.waitForTimeout(300);
  cards = await read();
  ok('switching demo on again starts with nothing named', cards.every((x) => !x.open) && named(cards).length === 0, cards);
  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' demo-reveal check(s) failed' : '\n✓ Golden Record demo: opening a brand names it, folding masks it');
  process.exit(fail ? 1 : 0);
})();
