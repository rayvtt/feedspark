#!/usr/bin/env node
/* Golden Record at 390px WITH DATA (Ray, 17 Sep 2026, via the phone rule: "pan, don't crush —
   no sideways page overflow"). tools/check_mobile.js renders every app page in its DEFAULT
   state — and /golden's default state has no scanned feed, so the attribute rows, the
   content-quality section and the AI-readiness card never existed for it. On a scanned feed
   the page's own ≤900px attribute-row grid had a ~438px minimum (a "NOT IN FEED" pill in the
   fluid column plus three fixed columns) — the worker-injected phone layer re-lays the row on
   the live page, so what overflowed was every render WITHOUT it: the ⬇ HTML export opened on a
   phone, and the 761–900px band. This renders the page the way the worker serves it (the
   injected widgets, an iPhone 13) with a stubbed scanned snapshot — half
   the spec attributes present with coverage and a baseline so Δ prints, half "not in feed" —
   runs a real in-browser content-quality analysis over a stubbed feed (so the quality rows,
   the AI-readiness tiles and the scoring pop-up all exist), and asserts nothing reaches past
   the screen edge: loaded at 390px, resized from desktop to 390px, and with a pop-up open.

   Run: NODE_PATH=$(npm root -g) node tools/check_grmobile.js   (presync) */
const fs = require('fs');
const os = require('os');
const path = require('path');
let chromium, devices;
try { ({ chromium, devices } = require(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'playwright'))); } catch (e) {
  console.log('· playwright unavailable — skipped'); process.exit(0);
}
const ROOT = path.resolve(__dirname, '..'), D = path.join(ROOT, 'docs');
const W = 390;
// the same injected chrome check_mobile.js renders with — the phone layer lives in mobile_widget.html
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html', 'lang_widget.html', 'hours_widget.html', 'shipped_widget.html', 'mobile_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const SRC = fs.readFileSync(path.join(D, 'FeedSpark_GoldenRecord.html'), 'utf8');
const TMP = path.join(os.tmpdir(), '_grmobcheck_FeedSpark_GoldenRecord.html');
// same injection as check_mobile.js: before </body> when the page has one, appended otherwise
fs.writeFileSync(TMP, SRC.indexOf('</body>') >= 0 ? SRC.replace('</body>', WIDGETS + '\n</body>') : SRC + '\n' + WIDGETS);

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin', 'mpn',
  'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category', 'product_type',
  'sale_price', 'additional_image_link', 'product_highlight', 'product_detail', 'material', 'pattern', 'size_type',
  'size_system', 'question_and_answer', 'document_link', 'related_product', 'item_group_title', 'variant_option', 'popularity_rank'];
const HEAD = 'id,title,description,link,image_link,additional_image_link,availability,price,brand,gtin,condition,item_group_id,color,size,gender,age_group,material,pattern,google_product_category,product_type,product_type(2),product_highlight,product_highlight(2),product_highlight(3),product_highlight(4),product_detail';
const CSV = [HEAD].concat(Array.from({ length: 30 }, (_, i) => [
  'S' + i, 'Schuh Converse Chuck Taylor All Star Ox Canvas Trainers in White Low Top UK ' + (3 + (i % 9)),
  'A canvas low-top trainer with a rubber sole and Ortholite insole, cut from a durable cotton canvas and finished with the classic ankle patch; true to size and easy to wear through the season, item ' + i + '.',
  'https://x.com/' + i, 'https://x.com/' + i + '.jpg', 'https://x.com/' + i + '-b.jpg', 'in stock', '60.00 GBP', 'Converse', '501234567890' + (i % 10), 'new',
  'G' + Math.floor(i / 9), 'White', 'UK ' + (3 + (i % 9)), 'unisex', 'adult', 'canvas', 'Plain', 'Apparel & Accessories > Shoes',
  ['Womens > Shoes > Trainers', 'Mens > Boots > Chelsea Boots > Leather', 'Kids > Shoes'][i % 3], 'chuck taylor',
  'Canvas upper', 'Rubber sole', 'Lace fastening', 'Ortholite insole', 'Composition:Upper:Canvas',
].map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(','))).join('\n');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: W, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: path.join(D, 'labelguard_engine.js'), contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: path.join(D, 'feedlab_engine.js'), contentType: 'text/javascript' }));
  await page.route('**/api/feed/proxy*', (r) => r.fulfill({ contentType: 'text/csv', headers: { 'x-feed-bytes': String(CSV.length) }, body: CSV }));
  let saved = null;
  await page.route('**/api/golden/quality*', (r) => {
    if (r.request().method() === 'PUT') { saved = JSON.parse(r.request().postData()); return r.fulfill({ contentType: 'application/json', body: '{"ok":true,"score":80}' }); }
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ quality: saved }) });
  });
  await page.addInitScript((ATTRS) => {
    const NOW = Date.now();
    const attrs = {}, base = {};
    ATTRS.forEach((k, i) => {
      // every other attribute is "not in feed" — the pill that overflowed — the rest carry
      // coverage and a moved baseline so every Δ prints "▲ +x.xpp" / "▼ x.xpp"
      if (i % 2) { attrs[k] = { present: false }; base[k] = { present: false }; return; }
      attrs[k] = { present: true, cov: Math.round((100 - (i % 7) * 9.3) * 10) / 10 };
      base[k] = { present: true, cov: Math.round((100 - (i % 5) * 12.7) * 10) / 10 };
    });
    const snap = { t: NOW, rows: 12345, client: 'Schuh', market: 'gb', attrs };
    const feeds = { 'Schuh|gb': { client: 'Schuh', mkt: 'gb', status: 'ok', t: NOW, rows: 12345, score: 90, ai: { n: 2, of: 6 }, cov: {}, reqMissing: [] } };
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      const j = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } }));
      if (/engine\.js/.test(u) || u.includes('/api/feed/proxy') || u.includes('/api/golden/quality')) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: snap, baseline: { t: NOW - 864e5 * 3, attrs: base }, daily: { t: NOW - 864e5, attrs: base } });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
      if (u.includes('/api/labels/askdraft')) return j({ cfg: { to: {} }, asked: {} });
      if (u.includes('/api/labels/alerts')) return j({ ok: true, crit: 0, warn: 0, pt: { crit: 0, warn: 0 }, gr: { crit: 0, warn: 0 }, clients: {} });
      if (u.includes('/api/access')) return j({ ok: true, email: 'ray@feedspark.com', owner: true, clients: null, modules: null });
      if (u.includes('/api/presence')) return j({ ok: true, me: 'ray@feedspark.com', owner: true, now: NOW, users: [], roster: [] });
      if (u.includes('/api/claude')) return j({ configured: false });
      return j({});
    };
  }, ATTRS);

  // what sticks out: every visible element whose right edge passes the screen (fixed layers
  // excepted — the topbar and module bar are check_mobile's to measure)
  const wide = () => page.evaluate((W) => Array.from(document.querySelectorAll('body *')).filter((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (!(r.right > W + 1 && r.width > 0 && cs.display !== 'none') || e.closest('.scm')) return false;
    // inside a fixed layer (the module bar scrolls within its own frame) or a scrolling
    // frame is by design — "pan, don't crush"; what is measured here is the page itself
    for (let p = e; p && p !== document.body; p = p.parentElement) {
      const pc = getComputedStyle(p);
      if (pc.position === 'fixed' || /(auto|scroll)/.test(pc.overflowX)) return false;
    }
    return true;
  }).slice(0, 8).map((e) => e.tagName + (e.id ? '#' + e.id : '') + '.' + (typeof e.className === 'string' ? e.className.slice(0, 40) : '') + ' right=' + Math.round(e.getBoundingClientRect().right)), W);
  const sw = () => page.evaluate(() => document.documentElement.scrollWidth);
  // the phone layer's sweep wraps anything wider than the screen in its own scroll frame
  // (.fcc-mpan) — a rescue, not a layout. An attribute row that needed one was too wide.
  const panned = () => page.evaluate(() => document.querySelectorAll('.at-row.fcc-mpan, .fcc-mpan .at-row, .fcc-mpan .at-list, .fcc-mpan .tier').length);

  await page.goto('file://' + TMP);
  await page.waitForTimeout(1500);
  ok('the attribute rows rendered — present ones with a Δ, absent ones as "not in feed"',
    await page.evaluate(() => document.querySelectorAll('.at-row .at-delta').length) >= 20 && await page.evaluate(() => document.querySelectorAll('.at-row .at-miss').length) >= 10);
  ok('loaded at 390px: nothing reaches past the screen edge', (await wide()).length === 0, await wide());
  ok('and the document does not pan sideways', (await sw()) <= W, await sw());
  ok('no attribute row needed the phone layer to wrap it in a scroll frame — the rows FIT', (await panned()) === 0, await panned());

  // rotate: desktop, then back to the phone — the layout must settle to the same result
  await page.setViewportSize({ width: 1360, height: 900 }); await page.waitForTimeout(300);
  await page.setViewportSize({ width: W, height: 844 }); await page.waitForTimeout(400);
  ok('after resizing from desktop to 390px: nothing reaches past the screen edge', (await wide()).length === 0, await wide());
  ok('and the document still does not pan sideways', (await sw()) <= W, await sw());
  ok('and still no attribute row in a rescue frame', (await panned()) === 0, await panned());

  // the two sections under the scorecard: a real content-quality analysis over the stubbed feed
  await page.evaluate(() => document.getElementById('qz-run').click());
  await page.waitForFunction(() => document.getElementById('air-tier'), { timeout: 30000 });
  await page.waitForTimeout(500);
  ok('content quality + AI-readiness rendered', await page.evaluate(() => !!document.querySelector('#qz-tier .qz-row') && document.querySelectorAll('#air-tier .pillar').length === 8));
  ok('with both sections on the page: nothing reaches past the screen edge', (await wide()).length === 0, await wide());
  ok('and the document does not pan sideways', (await sw()) <= W, await sw());

  // the scoring pop-ups, open on the phone
  const boxOf = () => page.evaluate(() => { const b = document.querySelector('.sc-box'); const r = b && b.getBoundingClientRect(); return r ? { l: Math.round(r.left), r: Math.round(r.right) } : null; });
  await page.evaluate(() => document.querySelector('#air-tier .pillar[data-scpop="taxonomy"]').click());
  await page.waitForTimeout(200);
  const box = await boxOf();
  ok('a pillar’s scoring pop-up fits the phone screen', box && box.l >= 0 && box.r <= W, box);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#qz-tier .qz-i[data-qinfo="title"]').click());
  await page.waitForTimeout(200);
  const box2 = await boxOf();
  ok('so does a content-quality row’s', box2 && box2.l >= 0 && box2.r <= W, box2);
  await page.keyboard.press('Escape');

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  try { fs.unlinkSync(TMP); } catch (e) {}
  if (fail) { console.log('\n✗ Golden Record at 390px with data: ' + fail + ' check(s) failed'); process.exit(1); }
  console.log('   ✓ Golden Record at 390px with a scanned feed, both sections and the pop-ups: no sideways overflow');
})().catch((e) => { console.error(e); process.exit(1); });
