#!/usr/bin/env node
/* Golden Record — SCORE A GROUP OF PRODUCTS, AND THE WHOLE SCORECARD ON IT (Ray, 16 Oct 2026: "is there a way to dissect
   the Golden Score based on a group of products ? (filter by fields?)" → "it could be a modularised section as part of
   Score card - can be either downloaded specifically just for the selected group of products or entire catalogue").

   Renders the REAL page against a stubbed FCC and an invented 40-product feed (Womens dresses complete, Mens shirts
   missing colour and GTIN). Every score the page prints is checked against an INDEPENDENT computation: the same rows
   pushed through labelguard's own xmlCollector + goldenScore in node, so a filter that lets the wrong rows through, or a
   group scored any other way than the dial, fails here. Then the scorecard is put on the group: the dial, the Δ
   reference, the catalogue-only sections and the write actions, the cover and the file name of the ⬇ HTML — and back.

   Run: NODE_PATH=$(npm root -g) node tools/check_grseg.js
*/
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }

const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html') + '#Northwind%7Cgb';
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : '')); }
};

// ---- the invented feed
const items = [];
for (let i = 0; i < 40; i++) {
  const w = i < 20;
  const t = (k, v) => (v == null ? '' : '<g:' + k + '>' + v + '</g:' + k + '>');
  items.push('<item>' + t('id', 'NW' + (1000 + i)) + t('title', (w ? 'Linen midi dress ' : 'Oxford shirt ') + i) +
    t('description', 'An invented product for the harness, number ' + i + '.') + t('link', 'https://shop.example/p/' + i) +
    t('image_link', 'https://img.example/' + i + '.jpg') + t('availability', i % 7 === 0 ? 'out of stock' : 'in stock') +
    t('price', (w ? '89.00' : '45.00') + ' GBP') + (w ? '' : (i % 2 ? t('sale_price', '35.00 GBP') : '')) +
    t('brand', 'Northwind') + (w ? t('gtin', '5012345678' + String(900 + i)) : '') + t('condition', 'new') +
    t('item_group_id', 'G' + Math.floor(i / 2)) + (w ? t('color', 'Blue') : '') + t('size', w ? '12' : 'M') +
    t('gender', w ? 'female' : 'male') + t('age_group', 'adult') +
    t('google_product_category', 'Apparel &amp; Accessories &gt; Clothing &gt; ' + (w ? 'Dresses' : 'Shirts &amp; Tops')) +
    t('product_type', w ? 'Womens &gt; Dresses &gt; Midi' : 'Mens &gt; Shirts &gt; Oxford') +
    t('custom_label_0', w && i < 10 ? 'Best Sellers' : 'Core') + (w ? t('material', 'Linen') : '') + '</item>');
}
const XML = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>' + items.join('') + '</channel></rss>';

(async () => {
  // ---- the independent reading: the same rows, labelguard's own collector + score, in node
  const FA = require(ENGINE_FA);
  const LG = await import('file://' + ENGINE_LG);
  const rows = []; let header = null;
  const pr = FA.createFeedParser((r, live) => { if (!header) { header = r.slice(); return; } if (live && live.length !== header.length) header = live.slice(); rows.push(r); });
  pr.push(XML); pr.end();
  const score = (pick) => {
    const c = LG.xmlCollector({ client: 'Northwind', market: 'gb' }); c.onRow(header);
    rows.forEach((r, i) => { if (pick(i)) c.onRow(r); });
    const sn = c.finish().snap; return { n: sn.rows, s: LG.goldenScore(sn.attrs, { expected: [], waived: [] }).score, attrs: sn.attrs };
  };
  const ALL = score(() => true), WOM = score((i) => i < 20), MEN = score((i) => i >= 20);
  console.log('-- the independent reading: all ' + ALL.s + ' · womens ' + WOM.s + ' · mens ' + MEN.s);
  ok('the invented feed reads 40 products, and the two halves score apart', ALL.n === 40 && WOM.n === 20 && MEN.n === 20 && WOM.s > MEN.s, { ALL: ALL.s, WOM: WOM.s, MEN: MEN.s });

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  await page.addInitScript(({ XML, attrs }) => {
    if (location.protocol !== 'file:') return;
    const NOW = Date.now(), cov = {};
    Object.keys(attrs).forEach((k) => { cov[k] = attrs[k].present ? attrs[k].cov : null; });
    const feeds = { 'Northwind|gb': { client: 'Northwind', mkt: 'gb', status: 'ok', t: NOW, rows: 40, score: 80, ai: { n: 0, of: 6 }, cov, reqMissing: [] } };
    window.__feedReads = 0;
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url), j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/feed/proxy')) { window.__feedReads++; return Promise.resolve(new Response(XML, { headers: { 'x-feed-bytes': String(XML.length) } })); }
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: null });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 40, client: 'Northwind', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/golden/history')) return j({ hist: null });
      return j({});
    };
  }, { XML, attrs: ALL.attrs });
  await page.goto(PAGE);
  await page.waitForSelector('#sg-tier', { timeout: 15000 });
  await page.waitForTimeout(600);
  const txt = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, sel);
  const num = async (sel) => parseFloat(await txt(sel));

  console.log('-- before the feed is read');
  ok('the section is on the scorecard and says what it does', /Dissect the score by any group of products/.test(await txt('#sg-tier')) && /Read the feed/.test(await txt('#sg-tier')));
  ok('the scorecard opens on the entire catalogue, the group button pointing at the section', /Entire catalogue/.test(await txt('.gr-scope')) && !!(await page.$('.gr-scope [data-grp="pick"]')));
  ok('nothing is read until asked', (await page.evaluate(() => window.__feedReads)) === 0);

  console.log('-- ⚡ Read the feed');
  await page.click('#sg-run');
  await page.waitForSelector('#sg-dim', { timeout: 15000 });
  ok('it reads the feed once, all 40 products', (await page.evaluate(() => window.__feedReads)) === 1 && /40 products read/.test(await txt('#sg-tier')), await txt('#sg-tier .qz-meta'));
  ok('All products scores what the collector + goldenScore score in node', Math.abs((await num('#sg-tier .sg-score')) - ALL.s) < 0.05, { page: await num('#sg-tier .sg-score'), node: ALL.s });

  console.log('-- a filter: product type tier 2 = Mens > Shirts');
  await page.selectOption('#sg-dim', 'pt2');
  const opts = await page.evaluate(() => Array.from(document.querySelectorAll('#sg-val option')).map((o) => o.textContent));
  ok('the value list carries both product types with their counts', opts.some((o) => /Mens > Shirts · 20/.test(o)) && opts.some((o) => /Womens > Dresses · 20/.test(o)), opts);
  await page.selectOption('#sg-val', 'Mens > Shirts');
  ok('the filter shows as a chip', /Mens > Shirts/.test(await txt('#sg-tier .sg-chip')));
  ok('the group scores what the same 20 rows score in node', Math.abs((await num('#sg-tier .sg-score')) - MEN.s) < 0.05, { page: await num('#sg-tier .sg-score'), node: MEN.s });
  ok('…named as 20 of 40 products, against the whole feed', /20 of 40 products/.test(await txt('#sg-tier .sg-vs')) && new RegExp('whole feed ' + ALL.s).test(await txt('#sg-tier .sg-vs')), await txt('#sg-tier .sg-vs'));
  const fields = await page.evaluate(() => Array.from(document.querySelectorAll('#sg-tier .sg-card .sg-tr:not(.sg-th) .sg-f')).map((e) => e.textContent));
  ok('the fields costing the group points lead with the ones the shirts lack (colour, gtin)', fields.slice(0, 3).some((f) => /color|gtin/.test(f)), fields);
  ok('a second filter field ANDs: + custom label 0 = Best Sellers leaves nothing (no shirt is a best seller)', await (async () => {
    await page.selectOption('#sg-dim', 'custom_label_0');
    const o = await page.evaluate(() => Array.from(document.querySelectorAll('#sg-val option')).map((x) => x.textContent));
    return !o.some((x) => /Best Sellers/.test(x)) && o.some((x) => /Core · 20/.test(x));   // the list counts what the other filters leave
  })());

  console.log('-- split by');
  await page.click('#sg-clear');
  await page.selectOption('#sg-sp', 'pt2');
  const split = await page.evaluate(() => Array.from(document.querySelectorAll('#sg-tier .sg-sp .sg-row')).map((r) => ({ v: r.getAttribute('data-sgv'), s: parseFloat(r.querySelector('.sg-c b').textContent), n: r.querySelector('.sg-n').textContent })));
  ok('a row per product type, worst first, each scoring what node scores', split.length === 2 && split[0].v === 'Mens > Shirts' && Math.abs(split[0].s - MEN.s) < 0.05 && Math.abs(split[1].s - WOM.s) < 0.05, split);
  await page.click('#sg-tier .sg-sp .sg-row[data-sgv="Womens > Dresses"]');
  ok('clicking a row narrows the group to it', /Womens > Dresses/.test(await txt('#sg-tier .sg-chip')) && Math.abs((await num('#sg-tier .sg-score')) - WOM.s) < 0.05);
  await page.click('#sg-tier .sg-chip button');
  await page.selectOption('#sg-dim', 'pt2'); await page.selectOption('#sg-val', 'Mens > Shirts');

  if (process.env.GRSEG_SHOT) await (await page.$('#sg-tier')).screenshot({ path: process.env.GRSEG_SHOT + '_module.png' });
  console.log('-- ▶ Score the scorecard on this group');
  ok('the scorecard\'s own scope line now offers the group', /Group ready: Product type · tier 2: Mens > Shirts/.test(await txt('.gr-scope')), await txt('.gr-scope'));
  await page.click('#sg-tier [data-grp="apply"]');
  await page.waitForTimeout(400);
  const dial = await page.evaluate(() => parseFloat(document.querySelector('.dial-n').textContent));
  ok('the dial reads the group', Math.abs(dial - MEN.s) < 0.05, { dial, node: MEN.s });
  const st = await page.evaluate(() => ({
    on: !!document.querySelector('.gr-scope.on'), chip: !!document.querySelector('.grp-chip'), hist: !!document.getElementById('hs-tier'),
    plan: !!document.getElementById('ap-tier'), cl: !!document.getElementById('cl-tier'), mt: !!document.getElementById('mt-tier'),
    ack: getComputedStyle(document.getElementById('det-ack')).display, scan: getComputedStyle(document.getElementById('det-scan')).display,
    act: Array.from(document.querySelectorAll('.at-act')).every((e) => getComputedStyle(e).display === 'none'),
    delta: (document.querySelector('.at-delta') || {}).title || '', qz: !!document.getElementById('qz-tier'),
  }));
  ok('the scope line says so, and every Δ reads against the entire catalogue', st.on && st.chip && /entire catalogue/.test(st.delta), st);
  ok('history, custom labels, Meta and the plan board — the catalogue\'s — leave the screen', !st.hist && !st.plan && !st.cl && !st.mt, st);
  ok('the actions that write (known-good, rescan, ask, brief) are not offered over a group', st.ack === 'none' && st.scan === 'none' && st.act, st);
  ok('content quality is still on — read off the group\'s own rows', st.qz && /products read/.test(await txt('#qz-tier')), await txt('#qz-tier .qz-meta'));

  if (process.env.GRSEG_SHOT) { await page.evaluate(() => window.scrollTo(0, document.getElementById('det-panel').offsetTop - 20)); await page.screenshot({ path: process.env.GRSEG_SHOT + '_group.png' }); }
  console.log('-- ⬇ HTML of the group');
  await page.evaluate(() => {
    window.__html = null; window.__name = null; window.__grPlainExport = true;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { b.text().then((t) => { window.__html = t; }); return real(b); };
    HTMLAnchorElement.prototype.click = function () { window.__name = this.download; };
  });
  await page.click('#det-html');
  await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
  const out = await page.evaluate(() => ({ html: window.__html, name: window.__name }));
  ok('the file is named for the group', /Northwind_GB_Product-type-tier-2-Mens-Shirts_/.test(out.name || ''), out.name);
  ok('its cover names the group and its size', /cv-grp/.test(out.html) && /Mens &gt; Shirts — 20 of 40 products/.test(out.html), (out.html.match(/<div class="cv-grp">[^<]*/) || [])[0]);
  ok('…and it carries no scope bar and no segment module (AM tools)', !/class="gr-scope/.test(out.html) && !/id="sg-tier"/.test(out.html));

  console.log('-- ↩ Entire catalogue');
  await page.click('.gr-scope [data-grp="all"]');
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ on: !!document.querySelector('.gr-scope.on'), hist: !!document.getElementById('hs-tier'), dial: parseFloat(document.querySelector('.dial-n').textContent) }));
  ok('the stored scorecard is back, history and all', !back.on && back.hist && Math.abs(back.dial - ALL.s) < 0.05, back);

  console.log('-- the phone');
  await page.setViewportSize({ width: 390, height: 860 });
  await page.waitForTimeout(300);
  // the raw file:// page carries no phone layer (the topbar is check_mobile's job) — this asks of the two new pieces only
  const ov = await page.evaluate(() => ['#sg-tier', '.gr-scope'].map((q) => { const e = document.querySelector(q); return e ? Math.round(e.getBoundingClientRect().right - window.innerWidth) : 'missing'; }));
  ok('the segment section and the scope line fit a 390px screen', ov.every((x) => typeof x === 'number' && x <= 1), ov);

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ Golden Score by group: any field, the same score as the dial, the whole scorecard and its downloads on the group — and back');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
