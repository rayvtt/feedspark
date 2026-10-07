// Overlay Design Studio harness — drives the REAL /overlays page in Chromium.
//
// Served over http (not file://) ON PURPOSE: the studio paints the product image onto a canvas and
// reads it back (getImageData, toBlob), which only works when the image is same-origin. That is the
// whole reason the page fetches pixels through /api/catalog/img, so a harness on an opaque file://
// origin would test a different program from the one that ships.
//
// The engines are NOT pre-injected — the page's own <script src="/overlays/engine.js"> and
// <script src="/overlays/studio.js"> must fetch and define their globals, because serving an empty
// 200 for an engine is how /images shipped dead: a <script> tag loads that without firing onerror
// and without a parse error, so the page sees no global and no failure.
//
// The feed fixture is built here from the shape read off Monsoon's live Meta output feed on
// 7 Oct 2026, so this runs unconditionally rather than skipping without a download — a tripwire
// that skips is a tripwire that hides the next outage. OVS_FEED=<path to a real feed> deepens it.
//   node tools/check_ovstudio.js
import { createRequire as _cr } from 'node:module';
const require = _cr(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';

const REPO = '/home/user/feedspark/';
const PAGE = REPO + 'docs/FeedSpark_Overlays.html';

/* ---- a product image with real pixels, so the canvas has something to composite ---- */
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1); raw[o] = 0;
    for (let x = 0; x < w; x++) {
      const p = o + 1 + x * 3;
      raw[p] = rgb[0]; raw[p + 1] = (rgb[1] + ((x * 7 + y * 11) % 40)) & 255; raw[p + 2] = rgb[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let CRC;
function crc32(buf) {
  if (!CRC) { CRC = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[i] = c; } }
  let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return c ^ -1;
}
const IMG = png(240, 320, [196, 206, 218]);
const IMG2 = png(240, 320, [214, 196, 186]);

/* ---- the feed, in Monsoon's real Meta shape: g:price the reference, g:sale_price on a third ---- */
const FEED_N = 640;   // over the studio's 500-row sample, so the cap is really exercised
function buildFeed() {
  if (process.env.OVS_FEED && existsSync(process.env.OVS_FEED)) return readFileSync(process.env.OVS_FEED, 'utf8').slice(0, 20e6);
  let x = '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>\n';
  for (let i = 0; i < FEED_N; i++) {
    const sale = i % 3 === 0;
    // image_link is ALREADY a FeedSpark overlay, as Monsoon's Meta feed really is — the studio has
    // to decode the source image out of it rather than compositing on top of a composite
    // the source images ride RAW, exactly as Monsoon's live feed carries them (checked 7 Oct 2026) —
    // percent-encoding them here would have tested a shape the estate does not serve
    const live = 'https://dashboard.feedspark.com/image-creator/monsoon-mix-meta/image_process_products_lifestyle.php'
      + '?img_url_left=https://www.monsoon.co.uk/img/' + i + '_a.jpg'
      + '&img_url_right=https://www.monsoon.co.uk/img/' + i + '_b.jpg&img_ver=1';
    x += '<item>'
      + '<g:id>20001' + (600 + i) + '</g:id>'
      + '<title>Monsoon Women’s Mona Angel Sleeve Maxi Dress, Size: ' + (6 + (i % 8)) + '</title>'
      + '<description>Sheer elegance, cut with angel sleeves over a V-neck bodice.</description>'
      + '<link>https://www.monsoon.co.uk/p' + i + '.html</link>'
      + '<g:image_link>' + live.replace(/&/g, '&amp;') + '</g:image_link>'
      + '<g:additional_image_link>https://www.monsoon.co.uk/img/' + i + '_b.jpg</g:additional_image_link>'
      + '<g:availability>in stock</g:availability>'
      + '<g:price>150.00 GBP</g:price>'
      + (sale ? '<g:sale_price>105.00 GBP</g:sale_price>' : '')
      + '<g:brand>Monsoon</g:brand><g:color>Navy/Green/Blue</g:color><g:size>' + (6 + (i % 8)) + '</g:size>'
      + '<g:product_type>womens &#62; tea dresses</g:product_type>'
      + '<g:shipping><g:country>GB</g:country><g:service>Standard</g:service><g:price>0.00 GBP</g:price></g:shipping>'
      + '</item>\n';
  }
  return x + '</channel></rss>\n';
}
const FEED = buildFeed();

/* ---- the stubbed worker ---- */
const FEEDS = [
  { client: 'Monsoon', mkt: 'gb', kind: 'xml', scan: { client: 'Monsoon', mkt: 'gb', t: Date.now() - 36e5, rows: 9664, ovl: 0, types: [] } },
  { client: 'Monsoon', mkt: 'gb-fb', kind: 'xml', scan: { client: 'Monsoon', mkt: 'gb-fb', t: Date.now() - 36e5, rows: 1593, ovl: 329, types: [] } },
  { client: 'Schuh', mkt: 'gb', kind: 'xml' },
];
const MASTER_HEADERS = ['g:id', 'title', 'g:availability', 'stock_quantity', 'g:price', 'g:was_price', 'g:brand', 'g:image_link'];
const ADS_ROWS = {}; for (let i = 0; i < 90; i++) ADS_ROWS['20001' + (600 + i)] = [367863 - i * 900, 1267 - i * 5, 688.49, 55.24, 2853.02];
// a 30-day window is a different read, not the same numbers relabelled
const ADS_ROWS_30 = {}; for (let i = 0; i < 90; i++) ADS_ROWS_30['20001' + (600 + i)] = [1488210 - i * 900, 5102 - i * 5, 2871.4, 223.9, 11602.7];
const seen = { ads: 0, master: 0, row: 0, img: 0, proxy: 0, adsPer: [] };
const FILES = {
  '/overlays/engine.js': 'docs/overlay_engine.js',
  '/overlays/studio.js': 'docs/overlay_studio_engine.js',
  '/feedlab/engine.js': 'docs/feedlab_engine.js',
};
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname, q = u.searchParams;
  const send = (code, ct, body) => { res.writeHead(code, { 'content-type': ct }); res.end(body); };
  const j = (o, code) => send(code || 200, 'application/json', JSON.stringify(o));
  if (p === '/' || p === '/overlays') return send(200, 'text/html; charset=utf-8', readFileSync(PAGE, 'utf8'));
  if (FILES[p]) return send(200, 'application/javascript; charset=utf-8', readFileSync(REPO + FILES[p], 'utf8'));
  if (p === '/api/overlays') {
    const c = q.get('client'), m = q.get('market');
    if (!c) return j({ ok: true, feeds: FEEDS });
    const f = FEEDS.find((x) => x.client === c && x.mkt === m);
    return j({ ok: true, client: c, market: m, kind: 'xml', cap: null, hist: [], scan: f && f.scan });
  }
  if (p === '/api/feed/proxy') { seen.proxy++; return send(200, 'application/xml; charset=utf-8', FEED); }
  if (p === '/api/catalog/img') {
    seen.img++;
    const url = q.get('url') || '';
    if (/host-not-allowed/.test(url)) return j({ ok: false, error: 'host not allowed' }, 403);
    return send(200, 'image/png', /_b\.jpg/.test(url) ? IMG2 : IMG);
  }
  if (p === '/api/catalog/master') { seen.master++; return j({ ok: true, cmpid: 'monsoon_uk', rows: 18644, headers: MASTER_HEADERS, file: 'monsoon_uk_master.xml.zip', lastImport: '2026-10-07 06:35:26' }); }
  if (p === '/api/catalog/master/row') {
    seen.row++;
    const want = q.get('q') || '';
    return j({ ok: true, cmpid: 'monsoon_uk', q: want, headers: MASTER_HEADERS,
      rows: [[want, 'Mona Angel Sleeve Maxi Dress', 'in stock', '8', '£150.00', '', 'Monsoon', 'https://www.monsoon.co.uk/a.jpg']], total: 1 });
  }
  if (p === '/api/catalog/ads') {
    seen.ads++;
    if (/-fb$/.test(q.get('market') || '')) return j({ ok: false, error: 'Google Ads is read for the Google feed' }, 400);
    const per = q.get('period') === '30_days' ? '30_days' : '7_days';
    seen.adsPer.push(per);
    const long = per === '30_days';
    return j({ ok: true, cmpid: 'monsoon_uk', period: per, from: long ? '2026-09-07' : '2026-09-30', to: '2026-10-06',
      range: long ? 'Last 30 Days (07/09/2026 - 06/10/2026)' : 'Last 7 Days (30/09/2026 - 06/10/2026)',
      total: 90, pages: 1, next: 2, got: 90, cur: 'GBP', done: true, at: Date.now(),
      rows: long ? ADS_ROWS_30 : ADS_ROWS });
  }
  return j({ ok: true });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|fonts\.googleapis/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// nothing leaves the sandbox: Google Fonts and any stray host are refused, not fetched
await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
await page.goto(BASE + '/overlays');
await page.waitForSelector('#esttbl tbody tr');

let pass = 0, fail = 0;
const t = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : ' — ' + x)); };
const txt = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const pix = (sel) => page.$eval(sel, (c) => { try { const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data; let h = 0;
  for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0; return { h, w: c.width, hh: c.height, ok: true }; }
  catch (e) { return { ok: false, err: String(e.message) }; } });

console.log('· the engines the page asks for arrive and define themselves');
{
  const g = await page.evaluate(() => ({ ov: typeof window.Overlay, st: typeof window.FeedOverlayStudio,
    fa: typeof window.FeedAudit, f1: window.__ovEngineFail || 0, f2: window.__stEngineFail || 0 }));
  t('the studio engine script tag defined window.FeedOverlayStudio', g.st === 'object', JSON.stringify(g));
  t('the overlay engine and Feed Lab parser are there too', g.ov === 'object' && g.fa === 'object', JSON.stringify(g));
  t('and no engine reported a load failure', !g.f1 && !g.f2, JSON.stringify(g));
  const v = await page.evaluate(() => window.FeedOverlayStudio.VERSION);
  t('the served engine is the repo’s own file, not an empty 200', /^\d+\.\d+\.\d+$/.test(v), String(v));
}

console.log('· the studio section is on the page, folded until asked');
t('the Design studio card is present', await page.$('#studio') !== null);
{
  // a heredoc that writes the escape instead of the glyph ships a button reading "\\u26A1 Read this feed"
  const chrome = await page.$eval('#studio', (e) => e.innerText);
  t('its chrome carries real glyphs, never a literal escape', !/\\u[0-9a-fA-F]{4}|\\U[0-9a-fA-F]{8}/.test(chrome), chrome.slice(0, 140));
  t('the buttons read as written', /Read this feed/.test(chrome) && /Add Google Ads/.test(chrome), chrome.slice(0, 160));
}
t('its working area starts hidden', await page.$eval('#st-wrap', (e) => e.hidden));
t('the gallery is empty before a feed is read', (await page.$eval('#st-gal', (e) => e.children.length)) === 0);

console.log('· reading the feed: the field summoner');
await page.selectOption('#brand', 'Monsoon');
await page.click('[data-mkc="gb-fb"]');
await page.waitForTimeout(250);
await page.click('#st-read');
await page.waitForFunction(() => !document.querySelector('#st-wrap').hidden && document.querySelector('#st-gal').children.length > 0, null, { timeout: 25000 });
{
  const st = await txt('#st-state');
  t('the state line says how much it read', /\d+ columns, [\d,]+ products read/.test(st), st);
  t('and states how many messages this feed can carry', /messages this feed can carry/.test(st), st);
  t('it read a SAMPLE of a bigger feed, not all ' + FEED_N + ' products', /500 products read/.test(st), st);
  const rail = await txt('#st-rail');
  t('the reference price is read as g:price', /g:price is the higher/.test(rail), rail.slice(0, 400));
  t('the live price is read as g:sale_price', /g:sale_price is the lower/.test(rail), rail.slice(0, 400));
  t('a thin message states its own coverage', /reads on 3\d% of the products read/.test(rail), rail.slice(0, 500));
}

console.log('· THE STOCK GAP IS REPORTED, NOT MOCKED UP');
{
  const rail = await txt('#st-rail');
  t('the panel names the master’s own stock column', /master feed carries stock_quantity/.test(rail), rail.slice(0, 900));
  t('and says a FeedHero rule has to map it into the output feed', /FeedHero rule/.test(rail));
  t('the gap block is rendered, not just the sentence', await page.$('.st-gap') !== null);
  t('the master was actually read for its headers', seen.master > 0, String(seen.master));
  t('and this product’s real figure was fetched from it', seen.row > 0, String(seen.row));
  t('the product line shows the real 8 in stock, marked as the master’s', /8 in stock/.test(await txt('#st-prod')), await txt('#st-prod'));
}

console.log('· the design gallery paints the real image');
{
  const n = await page.$eval('#st-gal', (e) => e.children.length);
  const designs = await page.evaluate(() => window.FeedOverlayStudio.DESIGNS.length);
  t('every design has a card', n === designs, n + ' cards for ' + designs + ' designs');
  t('the image proxy was used for the pixels', seen.img > 0, String(seen.img));
  const clean = await pix('[data-st-cv="clean"]'), flash = await pix('[data-st-cv="corner-flash"]');
  t('the canvases are readable — same origin, so a composite can be exported', clean.ok && flash.ok, JSON.stringify(clean));
  t('the control and an overlay design really differ', clean.h !== flash.h, 'both hashed ' + clean.h);
  const sz = await page.$eval('[data-st-cv="clean"]', (c) => ({ w: c.width, h: c.height }));
  t('the canvas follows the image’s own aspect', sz.h > sz.w, JSON.stringify(sz));
  const ribbon = await pix('[data-st-cv="ribbon"]'), pill = await pix('[data-st-cv="pill-badge"]');
  t('two different designs draw two different pictures', ribbon.h !== pill.h && ribbon.h !== clean.h);
}
console.log('· NO OVERLAY TEXT RUNS OFF THE PICTURE');
{
  // measured with the REAL glyphs, not the layout's estimate. The bug this pins drew
  // "1,267 clicks in Last 7 Days (30/09/2026 - 06/10/2026)" straight off both edges of a corner pill.
  const r = await page.evaluate(() => {
    const S = window.FeedOverlayStudio, off = [], nolim = [], wide = [];
    document.querySelectorAll('[data-st-cv]').forEach((cv) => {
      const id = cv.getAttribute('data-st-cv'), g = cv.getContext('2d');
      const c = S.compose(id, window.__res || {}, window.__stText ? { text: window.__stText } : {});
      S.layout(c, cv.width, cv.height).boxes.forEach((b) => {
        if (!b.text) return;
        if (b.x < 0 || b.y < 0 || b.x + b.w > cv.width + 1 || b.y + b.h > cv.height + 1) off.push({ id, fact: b.fact });
        if (!(b.maxW > 0)) { nolim.push({ id, fact: b.fact }); return; }
        g.font = '800 ' + b.fs + 'px Lato,system-ui,sans-serif';
        const w = g.measureText(b.text).width;
        if (w > b.maxW + 1) wide.push({ id, fact: b.fact, w: Math.round(w), lim: Math.round(b.maxW), text: b.text.slice(0, 48) });
      });
    });
    return { off, nolim, wide };
  });
  t('no zone is placed outside its canvas', r.off.length === 0, JSON.stringify(r.off.slice(0, 3)));
  t('every drawn zone hands the painter a measured limit to cut against', r.nolim.length === 0, JSON.stringify(r.nolim.slice(0, 3)));
  t('and the shrink-to-fit leaves the long Ads message inside its shape', r.wide.length === 0, JSON.stringify(r.wide.slice(0, 2)));
}

console.log('· A DESIGN WITH NOTHING TO SAY SAYS SO');
{
  const note = await page.$eval('[data-st-note="social-proof"]', (e) => e.textContent);
  t('the Ads design is marked unavailable on a Meta feed', /Nothing to say|needs clicks|not in this feed/i.test(note), note);
  const pills = await page.$$eval('.st-card', (cs) => cs.map((c) => ({ d: c.getAttribute('data-st-d'), p: c.querySelector('.st-pill').className, w: c.querySelector('.st-pill').textContent })));
  const sp = pills.find((x) => x.d === 'social-proof');
  t('its chip reads "not in this feed"', /no/.test(sp.p) && /not in this feed/.test(sp.w), JSON.stringify(sp));
  const cl = pills.find((x) => x.d === 'clean');
  t('the control reads "every product"', /every product/.test(cl.w), JSON.stringify(cl));
  const cf = pills.find((x) => x.d === 'corner-flash');
  t('a sale design states the share of the feed it fits', /3\d% of the feed/.test(cf.w), JSON.stringify(cf));
}

console.log('· the workbench: composer and recipe');
await page.click('.st-card[data-st-d="price-tag"]');
await page.waitForSelector('#st-big');
{
  t('the workbench opened', !(await page.$eval('#st-wb', (e) => e.hidden)));
  const rec = await txt('#st-wb');
  t('it names the REAL image-creator script', /image_process_subscription_v1/.test(rec), rec.slice(0, 300));
  const keys = await page.$$eval('table.st-rt td.k', (ts) => ts.map((x) => x.textContent));
  ['show_price', 'tags_bg_color', 'tags_font_color', 'tags_img_type', 'ver'].forEach((k) =>
    t('the recipe carries ' + k, keys.includes(k), keys.join(',')));
  const url = await txt('#st-urlbox');
  t('the URL is built on the real host and project', /dashboard\.feedspark\.com\/image-creator\/monsoon-gb-fb\/image_process_subscription_v1\.php\?/.test(url), url.slice(0, 160));
  t('the overlay text is a TEMPLATE, not this product’s words', /%7Bsale_price%7D|%7Bprice%7D/.test(url), url.slice(0, 300));
}
console.log('· editing the message redraws and re-emits');
{
  const before = (await pix('#st-big')).h, urlBefore = await txt('#st-urlbox');
  await page.fill('[data-st-tx="price_now"]', 'YOURS FOR £105');
  await page.waitForTimeout(220);
  const after = (await pix('#st-big')).h;
  t('the big canvas repainted', before !== after, 'both hashed ' + before);
  t('the recipe URL still emits the per-product token, not the typed words', urlBefore === (await txt('#st-urlbox')),
    'a hand-typed preview must not freeze a number into the feed rule');
  const drop = await txt('#st-dropline');
  t('the dropped zone is named with its reason', /reference price|dropped|Every zone/i.test(drop), drop);
}
console.log('· the exits');
{
  const dl = page.waitForEvent('download', { timeout: 9000 });
  await page.click('#st-png');
  const d = await dl;
  t('↓ PNG downloads the composite', /\.png$/.test(d.suggestedFilename()), d.suggestedFilename());
  // the channel must survive: a Google and a Meta composite of one product cannot share a name
  t('and names the client, MARKET WITH ITS CHANNEL, design and product',
    /monsoon-gb-fb-price-tag-\d+\.png/i.test(d.suggestedFilename()), d.suggestedFilename());
}
{
  await page.evaluate(() => { window.__opened = null; window.open = (u) => { window.__opened = u; return null; }; });
  await page.click('#st-brief');
  const u = await page.evaluate(() => window.__opened);
  t('→ Brief deep-links the Workflow composer', /^\/workflow\?brief=/.test(String(u)), String(u).slice(0, 80));
  const b = JSON.parse(decodeURIComponent(String(u).replace('/workflow?brief=', '')));
  t('the brief names the client and the design', b.client === 'Monsoon' && /price tag/i.test(b.task), JSON.stringify(b).slice(0, 220));
  t('and carries the BLOCKER when the design needs a field the output feed lacks',
    !/BLOCKER/.test(b.scope) || /FeedHero rule must map stock_quantity/.test(b.scope), b.scope.slice(-240));
  t('its scope lists the real parameters', /image_process_subscription_v1/.test(b.scope) && /tags_img_type = round_dpa/.test(b.scope), b.scope.slice(0, 300));
}

console.log('· Google Ads');
{
  await page.click('#st-ads');
  await page.waitForTimeout(400);
  const st = await txt('#st-state');
  t('a Meta feed is refused with the reason, and no call is made', /Meta catalogue feed has no Ads traffic/.test(st) && seen.ads === 0, st + ' | calls ' + seen.ads);
}
await page.click('[data-mkc="gb"]');
await page.waitForTimeout(250);
{
  t('switching market cleared the studio rather than keeping stale fields',
    await page.$eval('#st-wrap', (e) => e.hidden), 'the studio kept another feed’s columns');
  const st = await txt('#st-state');
  t('and says which feed is showing now', /Monsoon GB/.test(st) && /read this feed/.test(st), st);
}
await page.click('#st-read');
await page.waitForFunction(() => !document.querySelector('#st-wrap').hidden && document.querySelector('#st-gal').children.length > 0, null, { timeout: 25000 });
await page.click('#st-ads');
await page.waitForFunction(() => /Google Ads read/.test(document.querySelector('#st-state').textContent), null, { timeout: 20000 });
{
  t('the Google market reads Ads per product', seen.ads > 0, String(seen.ads));
  const st = await txt('#st-state');
  t('and reports the window and the share of the sample carrying traffic', /Last 7 Days/.test(st) && /\d+% of the sample/.test(st), st);
  const rail = await txt('#st-rail');
  t('the rail moves the Ads facts out of the gaps', /carry Ads traffic over Last 7 Days/.test(rail), rail.slice(0, 700));
  const pills = await page.$$eval('.st-card', (cs) => cs.map((c) => ({ d: c.getAttribute('data-st-d'), w: c.querySelector('.st-pill').textContent })));
  const sp = pills.find((x) => x.d === 'social-proof');
  t('and the social-proof design becomes drawable', !/not in this feed/.test(sp.w), JSON.stringify(sp));
  await page.click('.st-card[data-st-d="social-proof"]');
  await page.waitForSelector('#st-big');
  const wb = await txt('#st-wb');
  const cv = await page.$eval('[data-st-tx="clicks"]', (e) => e.value);
  t('its composer shows the real click figure', /1,267 clicks|1,2\d\d clicks/.test(cv), cv);
  // the panel says "Last 7 Days (30/09/2026 - 06/10/2026)"; a product card cannot carry that
  t('the overlay text takes a SHORT window, not FeedHero\u2019s full date range',
    /in 7 days$/.test(cv) && !/\d{2}\/\d{2}\/\d{4}/.test(cv), cv);
}

console.log('· the Ads window Ray asked for');
{
  // Ray asked for "x clicks over past 30 days"; the shared ads lane is 7. The window is a control,
  // and the figures on screen belong to the window they were read over.
  const before = await page.$eval('[data-st-tx="clicks"]', (e) => e.value);
  t('the default window is the already-cached 7 days', seen.adsPer.every((x) => x === '7_days'), seen.adsPer.join(','));
  await page.selectOption('#st-adswin', '30_days');
  await page.waitForTimeout(250);
  const st0 = await txt('#st-state');
  t('changing the window DROPS the old figures rather than relabelling them',
    /press Add Google Ads to read it/.test(st0) && !(await page.$eval('[data-st-tx="clicks"]', (e) => e.value)).includes('1,267'), st0);
  await page.click('#st-ads');
  await page.waitForFunction(() => /Google Ads read/.test(document.querySelector('#st-state').textContent), null, { timeout: 20000 });
  t('the 30-day window is actually asked of the route', seen.adsPer.includes('30_days'), seen.adsPer.join(','));
  const after = await page.$eval('[data-st-tx="clicks"]', (e) => e.value);
  t('the overlay now carries the 30-day figure', /5,102 clicks in 30 days/.test(after), after);
  t('and it really is a different reading from the 7-day one', after !== before, before + ' -> ' + after);
  const rail = await txt('#st-rail');
  t('the panel names the longer window', /Last 30 Days/.test(rail), rail.slice(0, 500));
  await page.selectOption('#st-adswin', '7_days');
  await page.click('#st-ads');
  await page.waitForFunction(() => /Google Ads read/.test(document.querySelector('#st-state').textContent), null, { timeout: 20000 });
  t('and it goes back', /1,267 clicks in 7 days/.test(await page.$eval('[data-st-tx="clicks"]', (e) => e.value)),
    await page.$eval('[data-st-tx="clicks"]', (e) => e.value));
}

console.log('· a product search inside the studio');
{
  await page.fill('#st-q', '20001605');
  await page.click('#st-go');
  await page.waitForTimeout(500);
  t('the product line moved to that ID', /20001605/.test(await txt('#st-prod')), await txt('#st-prod'));
  await page.fill('#st-q', 'nothing-like-this');
  await page.click('#st-go');
  await page.waitForTimeout(250);
  const st = await txt('#st-state');
  t('a miss says the studio read a sample, not the whole feed', /reads a sample of the feed, not all of it/.test(st), st);
}

console.log('· the image behind an overlay already live');
{
  const srcs = await page.evaluate(() => Array.from(document.querySelectorAll('#st-prod img')).map((i) => i.src));
  t('the preview composites the SOURCE image, not the live composite',
    srcs.length === 1 && /img_url=|url=https%3A%2F%2Fwww\.monsoon\.co\.uk%2Fimg/.test(srcs[0]), String(srcs[0]).slice(0, 180));
  t('the proxy was never asked for a dashboard.feedspark.com composite',
    !/dashboard\.feedspark\.com/.test(decodeURIComponent(String(srcs[0] || ''))), String(srcs[0]).slice(0, 200));
}

console.log('· the phone');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
{
  const o = await page.evaluate(() => {
    const s = document.querySelector('#studio');
    return { pageW: document.documentElement.scrollWidth, win: window.innerWidth,
      studioW: s.getBoundingClientRect().width, right: s.getBoundingClientRect().right };
  });
  t('the page does not scroll sideways at 390px', o.pageW <= o.win + 1, JSON.stringify(o));
  t('the studio card stays inside the screen', o.right <= o.win + 1, JSON.stringify(o));
}
await page.setViewportSize({ width: 1440, height: 1000 });

t('no console errors anywhere in the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); srv.close();
console.log('\n' + (fail ? '✗ ' + fail + ' of ' + (pass + fail) + ' FAILED' : '✓ overlay studio page: ' + pass + ' checks pass'));
process.exit(fail ? 1 : 0);
