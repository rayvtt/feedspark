#!/usr/bin/env node
/* Golden Record — THE META CATALOGUE, ON META'S TERMS (Ray, 9 Oct 2026: "in golden record - let's also add in Meta audit as
   well (areas such as Title for Meta should be < 60 characters) - Imagery (if there's overlay being used on Meta feed) divide
   a new section just on Meta alone"). Renders the REAL /golden against a stubbed FCC whose market has a wired Meta feed, then
   presses ⚡ Analyse Meta feed: the page streams a synthetic Meta XML through the Feed Lab parser and labelguard's
   metaStream, with the Image Overlays engine reading the overlay off the URLs. Every figure on screen is checked against a
   count this file makes from the same fixture. Then: the PUT the worker receives, the fold, a reload off the stored reading,
   the ⬇ HTML (section in, controls out), the action plan's Meta cards, and a market with no Meta feed wired.

   Run: NODE_PATH=$(npm root -g) node tools/check_grmeta.js   (GRMETA_SHOT=/path.png keeps a picture of the section)
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
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 500) : '')); }
};

// ---- the synthetic Meta catalogue: 40 products, invented, with every rule represented and counted here
const N = 40, items = [];
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const OVL = (i) => 'https://dashboard.feedspark.com/image-creator/northwind/image_process_products_lifestyle.php?img_url_left=https%3A%2F%2Fcdn.example.com%2F' + i + 'a.jpg&img_url_right=https%3A%2F%2Fcdn.example.com%2F' + i + 'b.jpg';
const want = { long: 0, max: 0, html: 0, same: 0, avail: 0, price: 0, sale: 0, overlay: 0, dupe: 0 };
for (let i = 0; i < N; i++) {
  let title = 'Northwind Linen Shirt ' + i;                                   // short
  if (i % 2 === 0) { title = 'Northwind Relaxed Fit Linen Shirt in Washed Sage Green for Summer ' + i; }   // > 60
  if (i === 4) title = 'Northwind ' + 'Very Long Title '.repeat(14);          // > 200
  if (title.length > 60) want.long++;
  if (title.length > 200) want.max++;
  let desc = 'A relaxed linen shirt with a camp collar and a straight hem, cut for warm days.';
  if (i % 5 === 1) { desc = '<p>A relaxed linen shirt</p> with a camp collar.'; want.html++; }
  if (i === 7) { desc = title; want.same++; }
  const avail = i === 9 ? 'available' : (i % 3 ? 'in stock' : 'out of stock');
  if (i === 9) want.avail++;
  const price = i === 11 ? '£79' : '79.00 GBP';
  if (i === 11) want.price++;
  const sale = i === 13 ? '<g:sale_price>89.00 GBP</g:sale_price>' : (i === 15 ? '<g:sale_price>59.00 GBP</g:sale_price>' : '');
  if (i === 13) want.sale++;
  const img = i < 15 ? OVL(i) : 'https://cdn.example.com/' + i + '.jpg';
  if (i < 15) want.overlay++;
  const id = i === 39 ? 'NW-0' : 'NW-' + i;     // NW-0 twice — Meta ignores every instance
  items.push('<item><g:id>' + id + '</g:id><g:title>' + x(title) + '</g:title><g:description>' + x(desc) + '</g:description>' +
    '<g:availability>' + avail + '</g:availability><g:condition>new</g:condition><g:price>' + price + '</g:price>' + sale +
    '<g:link>https://www.example.com/p/' + i + '</g:link><g:image_link>' + x(img) + '</g:image_link>' +
    (i % 4 ? '<g:additional_image_link>https://cdn.example.com/' + i + 'x.jpg</g:additional_image_link>' : '') +
    (i === 20 ? '' : '<g:brand>Northwind</g:brand>') + '</item>');
}
want.dupe = 2;
const XML = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>' + items.join('') + '</channel></rss>';
const pct = (n) => Math.round((n / N) * 1000) / 10;

async function open(browser, opts) {
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: path.join(D, 'labelguard_engine.js'), contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: path.join(D, 'feedlab_engine.js'), contentType: 'text/javascript' }));
  await page.route('**/overlays/engine.js', (r) => r.fulfill({ path: path.join(D, 'overlay_engine.js'), contentType: 'text/javascript' }));
  await page.addInitScript(({ XML, wired, stored }) => {
    window.__mtputs = []; window.__mtstore = stored || null; window.__proxy = [];
    try { localStorage.removeItem('gr-tfold'); } catch (e) {}
    const NOW = Date.now(), attrs = {}, cov = {};
    ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin', 'condition', 'color', 'size', 'gender', 'age_group'].forEach((k) => { attrs[k] = { present: true, filled: 1000, cov: 100 }; cov[k] = 100; });
    const feeds = { 'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 90, ai: { n: 0, of: 6 }, cov, reqMissing: [] } };
    const real = window.fetch.bind(window);
    window.fetch = (url, o) => {
      const u = String(url), j = (b) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) });
      if (/engine\.js/.test(u)) return real(url, o);
      if (u.includes('/api/feed/proxy')) { window.__proxy.push(u); return Promise.resolve(new Response(XML, { status: 200, headers: { 'x-feed-bytes': String(XML.length) } })); }
      if (u.includes('/api/golden/meta') && o && o.method === 'PUT') { const b = JSON.parse(o.body); window.__mtputs.push({ u, b }); window.__mtstore = b; return j({ ok: true, t: NOW }); }
      if (u.includes('/api/golden/meta')) return j({ meta: window.__mtstore, wired, market: 'gb-fb' });
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      return j({});
    };
  }, { XML, wired: opts.wired, stored: opts.stored });
  await page.goto(PAGE);
  await page.waitForSelector('#det-html', { timeout: 15000 });
  await page.waitForFunction(() => { const t = document.getElementById('mt-tier'); return t && !/Looking for a Meta feed/.test(t.textContent); }, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  return { page, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });

  console.log('-- a market with a Meta feed wired, not analysed yet');
  const { page, errs } = await open(browser, { wired: true });
  const pre = await page.evaluate(() => { const t = document.getElementById('mt-tier');
    return { txt: t.textContent, btn: !!document.getElementById('mt-run'), last: !!(document.getElementById('cl-tier') && (document.getElementById('cl-tier').compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)) }; });
  ok('the Meta section is its own section, after the custom labels', pre.last && /on Meta’s terms/.test(pre.txt), pre.txt.slice(0, 120));
  ok('…says it is not analysed yet and offers ⚡ Analyse Meta feed — never a zero', pre.btn && /Not analysed yet/.test(pre.txt) && !/\/ 100/.test(pre.txt), pre.txt.slice(0, 200));

  console.log('-- ⚡ Analyse Meta feed');
  await page.click('#mt-run');
  await page.waitForSelector('#mt-tier .mt-score', { timeout: 20000 });
  await page.waitForTimeout(200);
  const put = await page.evaluate(() => window.__mtputs[0]);
  const proxy = await page.evaluate(() => window.__proxy);
  ok('it streams the market’s META feed (gb-fb), not the Google one', proxy.length === 1 && /market=gb-fb/.test(proxy[0]), proxy);
  ok('…and stores the reading against the Google market the page is on', put && /market=gb(&|$)/.test(put.u) && put.b.rows === N, put && { u: put.u, rows: put.b.rows });
  const s = await page.evaluate(() => {
    const t = document.getElementById('mt-tier');
    const rules = {}; t.querySelectorAll('.mt-rule').forEach((d) => { rules[d.querySelector('.mt-rl').textContent] = { pct: d.querySelector('.mt-rp').textContent, sev: d.querySelector('.mt-sev').textContent, n: d.querySelector('.mt-rn').textContent }; });
    const cards = Array.from(t.querySelectorAll('.mt-card')).map((c) => c.textContent);
    return { score: +t.querySelector('.mt-score').textContent, pill: t.querySelector('.qz-pill').textContent, areas: t.querySelectorAll('.mt-area').length,
      rules, cards, req: Array.from(t.querySelectorAll('.mt-f')).map((f) => f.textContent), dial: document.querySelector('.gr-top').textContent };
  });
  ok('a Meta score out of 100 with its verdict, five areas', s.score > 0 && s.score < 100 && s.pill && s.areas === 5, s);
  const r = (lbl) => s.rules[Object.keys(s.rules).find((k) => k.indexOf(lbl) === 0)] || null;
  ok('titles over 60 characters: counted and marked as FeedSpark’s standard', r('Title longer than 60') && r('Title longer than 60').pct === pct(want.long) + '%' && /FeedSpark/.test(r('Title longer than 60').sev), { got: r('Title longer than 60'), want: pct(want.long) });
  ok('the title card leads with the share under 60', new RegExp((100 - pct(want.long)) + '% under 60').test(s.cards[0]), s.cards[0]);
  ok('a title over Meta’s 200 limit is a Meta requirement', r('Title over Meta') && r('Title over Meta').pct === pct(want.max) + '%' && /requirement/.test(r('Title over Meta').sev), r('Title over Meta'));
  ok('HTML in a description, the title repeated as the description: Meta guidance', r('Description carries HTML') && r('Description carries HTML').pct === pct(want.html) + '%' && r('Description is the title') && /guidance/.test(r('Description carries HTML').sev), [r('Description carries HTML'), r('Description is the title')]);
  ok('availability, price format, sale price not below price: each counted', r('Availability not') && r('Availability not').pct === pct(want.avail) + '%' && r('Price not') && r('Price not').pct === pct(want.price) + '%' && r('Sale price not below') && r('Sale price not below').pct === pct(want.sale) + '%', [r('Availability not'), r('Price not'), r('Sale price not below')]);
  ok('a repeated ID counts every instance (Meta ignores them all)', r('ID repeated') && r('ID repeated').pct === pct(want.dupe) + '%', r('ID repeated'));
  ok('imagery: the FeedSpark overlay share and its type, read off the URL', new RegExp(pct(want.overlay) + '% carry a FeedSpark overlay').test(s.cards[1]) && /split/i.test(s.cards[1]) && new RegExp(String(want.overlay)).test(s.cards[1]), s.cards[1]);
  ok('the nine fields Meta requires, brand short on the product without one', s.req.length === 9 && s.req.some((t) => /brand/.test(t) && /97\.5%/.test(t)), s.req);
  ok('it never moves the Golden Score dial', !/Meta catalogue/.test(s.dial));
  if (process.env.GRMETA_SHOT) await (await page.$('#mt-tier')).screenshot({ path: process.env.GRMETA_SHOT });

  console.log('-- it folds like every section');
  await page.click('#mt-tier .tier-h h4');
  const f = await page.evaluate(() => { const t = document.getElementById('mt-tier'), su = t.querySelector('.tf-sum'); return { folded: t.classList.contains('folded'), sum: su && !su.hidden ? su.textContent : '' }; });
  ok('folded, the header keeps the Meta score', f.folded && /\d/.test(f.sum), f);
  await page.click('#mt-tier .tier-h h4');

  console.log('-- the ⬇ HTML and the action plan');
  await page.evaluate(() => {
    window.__html = null; window.__grPlainExport = true;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { b.text().then((t) => { window.__html = t; }); return real(b); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.click('#det-html');
  await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
  const html = await page.evaluate(() => window.__html);
  ok('the download carries no Meta control (Analyse, progress, the Overlays link)', !/id="mt-run"|id="mt-scan"|class="[^"]*mt-act/.test(html));
  const tmp = path.join(os.tmpdir(), 'grmeta_' + process.pid + '.html'); fs.writeFileSync(tmp, html);
  const out = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await out.goto('file://' + tmp); await out.waitForTimeout(250);
  const xo = await out.evaluate(() => { const t = document.getElementById('mt-tier');
    return { has: !!t && getComputedStyle(t).display !== 'none', score: t ? (t.querySelector('.mt-score') || {}).textContent : '',
      cards: Array.from(document.querySelectorAll('#print-plan .ap-tk')).filter((c) => /Meta/.test(c.querySelector('.ap-f').textContent)).map((c) => c.querySelector('.ap-t').textContent) }; });
  ok('the client file carries the Meta section with its score', xo.has && /\d/.test(xo.score), xo);
  ok('the action plan carries the Meta work: required fields, Meta’s requirements, then the 60-character titles',
    xo.cards.some((c) => /fields Meta requires — brand/.test(c)) && xo.cards.some((c) => /Meta: fix price not/i.test(c)) && xo.cards.some((c) => /Shorten Meta titles to under 60/.test(c)), xo.cards);
  await out.close(); fs.unlinkSync(tmp);
  const stored = await page.evaluate(() => window.__mtstore);
  ok('no page errors', errs.length === 0, errs);
  await page.close();

  console.log('-- opened again, off the stored reading');
  const o2 = await open(browser, { wired: true, stored });
  const v2 = await o2.page.evaluate(() => ({ score: (document.querySelector('#mt-tier .mt-score') || {}).textContent, proxy: window.__proxy.length, btn: (document.getElementById('mt-run') || {}).textContent }));
  ok('the stored audit draws at once, nothing streamed, ⟳ Re-analyse offered', /\d/.test(v2.score) && v2.proxy === 0 && /Re-analyse/.test(v2.btn), v2);
  ok('no page errors', o2.errs.length === 0, o2.errs);
  await o2.page.close();

  console.log('-- a market with no Meta feed wired');
  const o3 = await open(browser, { wired: false });
  const v3 = await o3.page.evaluate(() => ({ txt: document.getElementById('mt-tier').textContent, btn: !!document.getElementById('mt-run') }));
  ok('says no Meta catalogue is wired — no button, no score', !v3.btn && /No Meta catalogue is wired/.test(v3.txt) && !/\/ 100/.test(v3.txt), v3.txt.slice(0, 200));
  ok('no page errors', o3.errs.length === 0, o3.errs);
  await o3.page.close();

  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ Golden Meta catalogue: streamed, every rule counted, imagery read, folded, in the download and the plan');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
