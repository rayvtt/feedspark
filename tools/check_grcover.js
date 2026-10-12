#!/usr/bin/env node
/* Golden Record — THE COVER of the client documents (Ray, 12 Oct 2026, over the report's top box: "it should have a cover
   photo; the FeedSpark logo should be bigger. This section should be centered … Think of the quarterly or strategy review
   deck … this section should be interpreted as a cover").

   Drives the REAL /golden page with a stubbed feed whose head carries product images, exports the ⬇ HTML and reads the
   file: the cover's photo band is the CLIENT'S OWN pictures, read off the feed's first g:image_link values through the
   host-allowlisted /api/catalog/img proxy and EMBEDDED as small JPEGs (the file never calls out for them); five at most,
   no picture twice; the gradient stands in when the feed cannot be read, and always in demo mode, where a client's
   pictures would name the brand; and Score history follows the cover untouched.

   Run: NODE_PATH=$(npm root -g) node tools/check_grcover.js   (presync) */
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html') + '#Reiss%7Cgb';

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : '')); }
};
const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin', 'mpn', 'item_group_id', 'color', 'size', 'gender', 'age_group'];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const run = async (opts) => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/labels/engine.js', (r) => r.fulfill({ path: path.join(D, 'labelguard_engine.js'), contentType: 'text/javascript' }));
    await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: path.join(D, 'feedlab_engine.js'), contentType: 'text/javascript' }));
    await page.addInitScript(({ ATTRS, opts }) => {
      try { localStorage.clear(); sessionStorage.setItem('gr-demo', opts.demo ? '1' : '0'); } catch (e) {}
      const NOW = Date.now(), attrs = {}, cov = {};
      ATTRS.forEach((k) => { attrs[k] = { present: true, filled: 1000, cov: 100 }; cov[k] = 100; });
      const feeds = { 'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, cov, reqMissing: [] } };
      // the feed's head: seven products, one image repeated — six distinct pictures
      const imgs = ['a', 'b', 'c', 'b', 'd', 'e', 'f'].map((x) => 'https://images.example-cdn.com/p/' + x + '.jpg');
      const xml = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>' +
        imgs.map((u, i) => '<item><g:id>' + i + '</g:id><g:image_link><![CDATA[' + u + ']]></g:image_link></item>').join('') + '</channel></rss>';
      const COLS = { a: '#c0392b', b: '#2563eb', c: '#15803d', d: '#7c3aed', e: '#ed6f0b', f: '#333333' };
      window.__img = [];
      const real = window.fetch.bind(window);
      window.fetch = (url, o) => {
        const u = String(url);
        const j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
        if (/engine\.js/.test(u)) return real(url, o);
        if (u.includes('/api/feed/proxy')) return opts.noFeed ? Promise.resolve(new Response('nope', { status: 502 })) : Promise.resolve(new Response(xml, { status: 200 }));
        if (u.includes('/api/catalog/img')) {
          const src = decodeURIComponent((u.match(/[?&]url=([^&]+)/) || [])[1] || ''); window.__img.push(src);
          const c = document.createElement('canvas'); c.width = 400; c.height = 500;
          const x = c.getContext('2d'); x.fillStyle = COLS[(src.match(/\/(\w)\.jpg$/) || [])[1]] || '#999'; x.fillRect(0, 0, 400, 500);
          return new Promise((res) => c.toBlob((b) => res(new Response(b, { status: 200, headers: { 'content-type': 'image/png' } })), 'image/png'));
        }
        if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
        if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
        return j({});
      };
      window.print = function () {};
    }, { ATTRS, opts: opts || {} });
    await page.goto(PAGE);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__html = null;
      const real = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (bl) { bl.text().then((t) => { window.__html = t; }); return real(bl); };
      HTMLAnchorElement.prototype.click = function () {};
      window.__grPlainExport = true;
    });
    await page.click('#det-html');
    await page.waitForFunction(() => window.__html !== null, null, { timeout: 20000 });
    const html = await page.evaluate(() => window.__html), asked = await page.evaluate(() => window.__img);
    await page.close();
    const out = await browser.newPage({ viewport: { width: 1220, height: 1000 } });
    await out.setContent(html); await out.waitForTimeout(300);
    const r = await out.evaluate(() => {
      const cv = document.querySelector('#print-head .cv'), q = (s) => document.querySelector(s);
      const imgs = Array.from(document.querySelectorAll('#print-head .cv-photo img'));
      const after = cv ? (() => { let n = document.querySelector('.hist, #hist-tier, .tier'); return n ? n.getBoundingClientRect().top >= cv.getBoundingClientRect().bottom : null; })() : null;
      return { cover: !!cv, n: imgs.length, srcs: imgs.map((i) => i.getAttribute('src').slice(0, 23)), loaded: imgs.every((i) => i.naturalWidth > 0),
        art: !!q('#print-head .cv-art'), title: (q('.cv-h1') || {}).textContent, after };
    });
    await out.close();
    return { r, asked, html };
  };

  console.log('── the client\'s own pictures');
  let { r, asked, html } = await run();
  if (process.env.GRCOVER_KEEP) fs.writeFileSync(process.env.GRCOVER_KEEP, html);
  ok('the cover carries a photo band of FIVE pictures, each an embedded JPEG that loads', r.cover && r.n === 5 && r.srcs.every((s) => s === 'data:image/jpeg;base64,') && r.loaded, r);
  ok('…read off the feed’s own g:image_link values, a repeated picture asked for once', asked.length === 6 && new Set(asked).size === 6 && asked[0] === 'https://images.example-cdn.com/p/a.jpg', asked);
  ok('…and the file never calls out for them — no image URL from the feed in it', !/example-cdn\.com/.test(html));
  ok('the title is the brand · market', /Reiss\s*·\s*GB/.test(r.title || ''), r.title);
  ok('Score history and the scorecard follow the cover', r.after === true, r);

  console.log('── a feed that cannot be read');
  ({ r } = await run({ noFeed: true }));
  ok('the FeedSpark gradient stands in — never an empty band', r.cover && r.n === 0 && r.art, r);

  console.log('── demo mode');
  ({ r, asked } = await run({ demo: true }));
  ok('demo mode never shows a client’s pictures (they would name the brand) and never asks for them', r.cover && r.n === 0 && r.art && asked.length === 0, { r, asked });

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ Golden Record cover: ' + fail + ' check(s) failed' : '\n✓ Golden Record cover: the client\'s own pictures embedded, the gradient when the feed is unreadable or in demo');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
