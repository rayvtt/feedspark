#!/usr/bin/env node
/* tools/check_imagetypes.js — /images' "Image type — every field" section, rendered.
 *
 * Ray, 15 Oct 2026: "can I rely on you to identify the image type for every image field
 * for each of our clients? Can you build an engine?"
 *
 * A source read cannot answer that: the figures are composed in the browser out of a
 * capture, a tag store and an audit, and the thing most worth catching is a field whose
 * named share is overstated. So this drives the REAL page over http (the pixel reads go
 * through /api/catalog/img, and an opaque file:// origin would taint the canvas and test
 * a different program from the one that ships) against a synthetic estate, and checks
 * every number against a count made here rather than against the page's own.
 *
 * The stub brands are invented (Northwind / Atelier) — no client figure belongs in git.
 */
import { createRequire as _cr } from 'node:module';
const require = _cr(import.meta.url);
import http from 'node:http';
import zlib from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
const { chromium } = require(existsSync('/opt/node22/lib/node_modules/playwright')
  ? '/opt/node22/lib/node_modules/playwright' : '/opt/node-tools/node_modules/playwright');

const REPO = '/home/user/feedspark/';
const PAGE = REPO + 'docs/FeedSpark_Images.html';

/* ---- a 2x2 PNG of one flat colour: enough for the pixel engine to read a background --- */
function png(rgb) {
  const W = 8, H = 8, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const WHITE = png([250, 250, 250]), DARK = png([30, 90, 40]);

/* ---- the synthetic estate -------------------------------------------------------
 * Northwind: a readable convention — three codes over three image fields, shaped like the
 * real patterned feeds (one code spanning two fields, one field fed by two codes).
 * Atelier: no convention at all, the shape the engine must route per image.            */
const CODES = [
  { tok: 'zm',    n: 500, slots: { 0: 300, 1: 200 } },
  { tok: 'm4_zm', n: 300, slots: { 2: 300 } },
  { tok: '03',    n: 200, slots: { 1: 100, 2: 100 } },   // the one whose own pictures disagree
];
const sampleFor = (tok, slot, i) => ({ id: 'NW-' + tok + '-' + i, ti: 'A Northwind thing', link: 'https://northwind.invalid/p' + i,
  pt: 'womens > dresses', slot, url: 'https://img.northwind.invalid/' + tok + '_' + i + (tok === '03' && i % 2 ? '_scene' : '') + '.jpg' });
const NW = {
  v: 1, t: Date.now() - 36e5, client: 'Northwind', market: 'gb',
  rows: 400, withImg: 400, imgs: 1000, slots: [300, 300, 400], dupRows: 0, depth: { 3: 400 },
  hasImage: true, addlSlots: 2, hosts: [['img.northwind.invalid', 1000]], exts: [['jpg', 1000]],
  grouping: 'head', overflow: false, learnable: true, tokCover: 1, tokKept: 3,
  tokens: CODES.map((c) => Object.assign({}, c, { weak: false,
    samples: Object.keys(c.slots).reduce((a, s) => a.concat(
      Array.from({ length: 8 }, (_, i) => sampleFor(c.tok, +s, i))), []).slice(0, 12) })),
};
const AT = { v: 1, t: Date.now() - 72e5, client: 'Atelier', market: 'gb', rows: 500, withImg: 500, imgs: 1000,
  slots: [500, 500], dupRows: 0, depth: { 2: 500 }, hasImage: true, addlSlots: 1,
  hosts: [['cdn.atelier.invalid', 1000]], exts: [['jpg', 1000]], grouping: 'head', overflow: true,
  learnable: false, tokCover: 0.42, tokKept: 61, tokens: [] };

const TAGS = { Northwind: { v: 1, tok: { zm: { tag: 'packshot', by: 'ai', conf: 0.86, note: 'the thing alone on a pale sweep' } }, img: {} }, Atelier: { v: 1, tok: {}, img: {} } };
const AUDIT = {};   // filled by the page's own ⚡ Audit run

const IDX = { 'Northwind|gb': { client: 'Northwind', mkt: 'gb', t: NW.t, rows: 400, withImg: 400, imgs: 1000,
    slots: NW.slots, learnable: true, toks: 3, tokCover: 1, tops: CODES.map((c) => ({ tok: c.tok, n: c.n })) },
  'Atelier|gb': { client: 'Atelier', mkt: 'gb', t: AT.t, rows: 500, withImg: 500, imgs: 1000,
    slots: AT.slots, learnable: false, toks: 61, tokCover: 0.42, tops: [] } };

let NEG = false;
const seen = { img: 0, auditPut: null, tagGets: [] };
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' }); res.end(body); };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname, client = u.searchParams.get('client') || '';
  if (p === '/' || p === '/images') return send(res, 200, 'text/html; charset=utf-8', readFileSync(PAGE, 'utf8'));
  for (const [route, file] of [['/images/engine.js', 'docs/image_engine.js'], ['/images/types.js', 'docs/imagetype_engine.js'],
    ['/feedlab/engine.js', 'docs/feedlab_engine.js'], ['/catalog/pixels.js', 'docs/pixel_engine.js']]) {
    if (p === route) {
      if (!existsSync(REPO + file)) return send(res, 404, 'text/plain', 'no');
      let src = readFileSync(REPO + file, 'utf8');
      // NEGATIVE CONTROL: strip the gate that keeps a mixed code's images out of the named
      // total. The checks below must fail on it, or they are not testing anything.
      if (NEG && route === '/images/types.js') {
        src = src.replace(/if \(v\.mixed\) \{ mixed \+= n; continue; \}/, '/* gate removed */')
                 .replace(/if \(v\.mixed\) \{ mixed \+= t\.n; continue; \}/, '/* gate removed */');
      }
      return send(res, 200, 'application/javascript', src);
    }
  }
  if (p === '/api/catalog/img') { seen.img++;
    return send(res, 200, 'image/png', /_scene/.test(u.searchParams.get('url') || '') ? DARK : WHITE); }
  if (p === '/api/images' && client) {
    const cap = client === 'Northwind' ? NW : client === 'Atelier' ? AT : null;
    return send(res, 200, 'application/json', JSON.stringify({ ok: true, client, market: u.searchParams.get('market') || 'gb',
      kind: 'xml', snap: cap, hist: [], tags: TAGS[client] || null, audit: AUDIT[client] || null }));
  }
  if (p === '/api/images') return send(res, 200, 'application/json', JSON.stringify({ ok: true,
    feeds: Object.values(IDX).map((s) => ({ client: s.client, mkt: s.mkt, kind: 'xml', scan: s })) }));
  if (p === '/api/images/tags') {
    if (req.method === 'GET') { seen.tagGets.push(client);
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, client, tags: TAGS[client] || { v: 1, tok: {}, img: {} } })); }
    let b = ''; req.on('data', (d) => { b += d; });
    return req.on('end', () => { let v = {}; try { v = JSON.parse(b); } catch (e) {}
      const cur = TAGS[client] || (TAGS[client] = { v: 1, tok: {}, img: {} });
      Object.assign(cur.tok, (v.tags && v.tags.tok) || {}); Object.assign(cur.img, (v.tags && v.tags.img) || {});
      send(res, 200, 'application/json', JSON.stringify({ ok: true, client, tags: cur })); });
  }
  if (p === '/api/images/audit') {
    if (req.method === 'GET') return send(res, 200, 'application/json', JSON.stringify({ ok: true, client, audit: AUDIT[client] || null }));
    let b = ''; req.on('data', (d) => { b += d; });
    return req.on('end', () => { let v = {}; try { v = JSON.parse(b); } catch (e) {}
      seen.auditPut = (v && v.audit) || null;
      AUDIT[client] = Object.assign(AUDIT[client] || {}, seen.auditPut);
      send(res, 200, 'application/json', JSON.stringify({ ok: true, client, audit: AUDIT[client] })); });
  }
  if (p.startsWith('/api/')) return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
  return send(res, 404, 'text/plain', 'no');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

let pass = 0, fail = 0;
const t = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : ' — ' + x)); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(String(e.message).slice(0, 120)); if (process.env.IMGT_DEBUG) console.log('   [pageerror] ' + e.message.slice(0, 200)); });
if (process.env.IMGT_DEBUG) { page.on('console', (m) => console.log('   [console] ' + m.text().slice(0, 160)));
  page.on('request', (r) => { if (/api|\.js/.test(r.url())) console.log('   [req] ' + r.url().replace(BASE, '')); });
  page.on('requestfailed', (r) => console.log('   [FAIL] ' + r.url().replace(BASE, '') + ' ' + (r.failure() || {}).errorText)); }
await page.goto(BASE + '/images', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__imgPage && window.__imgPage.state.FEEDS.length > 0, null, { timeout: 20000 });

const txt = (s) => page.$eval(s, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const painted = (s) => page.$eval(s, (e) => { const r = e.getBoundingClientRect();
  return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'; });

console.log('· the engines the page asks for arrive');
{
  const g = await page.evaluate(() => ({ t: typeof window.FeedImageTypes, i: typeof window.FeedImages, f: window.__typeEngineFail || 0 }));
  t('the type engine defined itself from its own script tag', g.t === 'object', JSON.stringify(g));
  t('and reported no load failure', !g.f, JSON.stringify(g));
  const v = await page.evaluate(() => window.FeedImageTypes.VERSION);
  t('the served engine is the repo’s file, not an empty 200', /^\d+\.\d+\.\d+$/.test(v), String(v));
}

console.log('· the section opens on a fresh device, and the estate card does not');
{
  t('Image type — every field is on the page', await page.$('#types') !== null);
  t('and open without being asked', !(await page.$eval('#types', (e) => e.classList.contains('folded'))));
  t('the shot-code card is open too — the overview', !(await page.$eval('#detail', (e) => e.classList.contains('folded'))));
  t('the media estate starts folded', await page.$eval('#estate', (e) => e.classList.contains('folded')));
  t('so does the method', await page.$eval('#meth', (e) => e.classList.contains('folded')));
  const sum = await txt('#estate > .fhd .fsum');
  t('and a folded head keeps what its own section found', /feeds/.test(sum) && /images/.test(sum), sum);
}

console.log('· every image field, counted here and compared');
await page.selectOption('#brand', 'Northwind');
await page.waitForFunction(() => { const s = window.__imgPage.state; return s.CLIENT === 'Northwind' && s.DATA && s.DATA.snap; }, null, { timeout: 15000 });
{
  const rows = await page.$$eval('#tytbl tbody tr', (rs) => rs.map((r) => Array.from(r.children).map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  t('one row per image field the feed uses, and no more', rows.length === 3, JSON.stringify(rows.map((r) => r[0])));
  t('the main field is named by its own spec field', /image_link/.test(rows[0][0]) && !/additional/.test(rows[0][0]), rows[0][0]);
  t('the next two are the additional fields, counted from one', /additional_image_link 1/.test(rows[1][0]) && /additional_image_link 2/.test(rows[2][0]), rows[1][0] + ' | ' + rows[2][0]);
  // only `zm` is named, and it holds 300 of the main field's 300 images
  t('the main field reads 100% named off the one named code', /100%/.test(rows[0][2]), rows[0][2]);
  t('and says which type it mostly carries', /Packshot/i.test(rows[0][3]), rows[0][3]);
  t('the lane is named, so a reader knows what it rests on', /Named shot code/.test(rows[0][4]), rows[0][4]);
  // field 1 holds zm 200 + 03 100; only zm is named -> 200/300 = 66.7%
  t('a field fed by a named and an unnamed code reads the share, not all of it', /66\.7%/.test(rows[1][2]), rows[1][2]);
  // field 2 holds m4_zm 300 + 03 100, neither named -> 0%
  t('a field with nothing named says so rather than showing a bar', /0%/.test(rows[2][2]) && /nothing named/i.test(rows[2][3]), rows[2][2] + ' | ' + rows[2][3]);
  const head = await txt('#ty-head');
  t('the headline is the share of every image read', /50%/.test(head) && /1,000 images/.test(head), head);
  t('and says why that is the share', /shot codes cover this feed/.test(head), head);
}

console.log('· what it would take to name the rest');
{
  const plan = await txt('#ty-plan');
  t('the plan leads with the code that names the most images', /m4_zm/.test(plan), plan);
  t('and states the images each decision names', /300/.test(plan), plan);
  const grade = await txt('#ty-grade');
  t('nothing has been corrected yet, so the grade refuses a figure', /nothing to grade it against/.test(grade), grade);
  t('and says the figure will be measured, not claimed', /rather than claimed/.test(grade), grade);
}

console.log('· ⚡ Audit: the pixels check the code, they never name it');
{
  const before = seen.img;
  await page.click('#tyaudit');
  await page.waitForFunction(() => /Done —/.test(document.querySelector('#mstate').textContent), null, { timeout: 40000 });
  t('it read the codes’ own images through the proxy', seen.img > before, String(seen.img));
  t('and only through the proxy, so the canvas can be read', seen.img >= 3, String(seen.img));
  const put = seen.auditPut || {};
  t('a verdict was stored for every code it read', Object.keys(put).length === 3, Object.keys(put).join(','));
  t('the code whose pictures all match reads consistent', put.zm && put.zm.state === 'consistent', JSON.stringify(put.zm || {}).slice(0, 120));
  t('the code shot two ways reads mixed', put['03'] && put['03'].state === 'mixed', JSON.stringify(put['03'] || {}).slice(0, 140));
  t('and the stored verdict carries no tag — an audit is a check, not a decision',
    Object.values(put).every((a) => !('tag' in a)), JSON.stringify(put).slice(0, 120));
  const aud = await txt('#ty-audit');
  t('the section names the mixed code', /03/.test(aud) && /mixed/i.test(aud), aud.slice(0, 200));
  t('with the reason its own images disagree', /background disagrees|different ways/.test(aud), aud.slice(0, 240));
  const state = await txt('#mstate');
  t('the run says how many codes it checked and on how many images', /3 shot codes checked on \d+ images/.test(state), state);
}

console.log('· a mixed code is never counted as named — the point of the audit');
{
  // name the mixed code by hand through the page's own store, then re-read
  await page.evaluate(() => fetch('/api/images/tags?client=Northwind', { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tags: { tok: { '03': { tag: 'lifestyle', by: 'ai', conf: 0.8 } } } }) }).then((r) => r.json()));
  await page.evaluate(() => window.__imgPage.load());
  await page.waitForFunction(() => { const s = window.__imgPage.state; return s.TAGS && s.TAGS.tok && s.TAGS.tok['03']; }, null, { timeout: 15000 });
  const rep = await page.evaluate(() => window.__imgPage.types.head);
  t('naming a mixed code does not add its images to the named total', rep.named === 500, JSON.stringify({ named: rep.named, mixed: rep.mixed }));
  t('they are counted apart instead', rep.mixed === 200, String(rep.mixed));
  t('never more named than the feed holds', rep.named + rep.mixed <= rep.imgs, JSON.stringify(rep).slice(0, 100));
  const head = await txt('#ty-head');
  t('and the headline says how many are not safely named', /200 not safely/.test(head), head);
}

console.log('· the feed with no convention at all');
{
  await page.selectOption('#brand', 'Atelier');
  await page.waitForFunction(() => { const s = window.__imgPage.state; return s.CLIENT === 'Atelier' && s.DATA && s.DATA.snap; }, null, { timeout: 15000 });
  const head = await txt('#ty-head');
  t('nothing is named on it, and the share says 0%', /\b0% of 1,000 images named/.test(head), head);
  t('and the reason is the filenames, stated plainly', /nothing groups the images for free/.test(head), head);
  const plan = await txt('#ty-plan');
  t('the plan states the per-image cost rather than offering a shortcut', /1,000 images with no code/.test(plan), plan);
  const rows = await page.$$eval('#tytbl tbody tr', (rs) => rs.length);
  t('its two image fields are still reported, not skipped', rows === 2, String(rows));
}

console.log('· the estate: which clients have no shot code to name them with');
{
  await page.waitForFunction(() => document.querySelectorAll('#tyesttbl tbody tr').length >= 2, null, { timeout: 15000 });
  const rows = await page.$$eval('#tyesttbl tbody tr', (rs) => rs.map((r) => Array.from(r.children).map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  t('every scanned feed is listed', rows.length === 2, String(rows.length));
  t('a feed with a convention is routed by shot code', rows.some((r) => /Northwind/.test(r[0]) && /by shot code/.test(r[3])), JSON.stringify(rows));
  t('one without is routed image by image', rows.some((r) => /Atelier/.test(r[0]) && /image by image/.test(r[3])), JSON.stringify(rows));
  const foot = await txt('#tyest-foot');
  t('the foot counts the feeds that cost a read per image', /1 feed/.test(foot) && /no shot code/.test(foot), foot);
  t('and never reports a named share for a brand whose tags it has not read',
    seen.tagGets.length > 0, seen.tagGets.join(','));
}

console.log('· the fold');
{
  await page.click('#estate > .fhd .fold');
  t('a click on a folded title opens the card', await painted('#esttbl'));
  await page.click('#types > .fhd .fold');
  t('and folds an open one', await page.$eval('#types', (e) => e.classList.contains('folded')));
  await page.click('#fold-all');
  const anyOpen = await page.$$eval('main .card', (cs) => cs.filter((c) => c.querySelector(':scope > .fhd .fold')).some((c) => !c.classList.contains('folded')));
  t('⊕ Expand all opens every one', anyOpen);
  await page.click('#fold-all');
  const allFolded = await page.$$eval('main .card', (cs) => cs.filter((c) => c.querySelector(':scope > .fhd .fold')).every((c) => c.classList.contains('folded')));
  t('⊖ Collapse all folds every one', allFolded);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__imgPage && window.__imgPage.state.FEEDS.length > 0, null, { timeout: 20000 });
  const kept = await page.$eval('#types', (e) => e.classList.contains('folded'));
  t('and the device keeps the choice through a reload', kept);
}

console.log('· a jump opens the card it points at, without rewriting the choice');
{
  await page.goto(BASE + '/images#types', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__imgPage && window.__imgPage.state.FEEDS.length > 0, null, { timeout: 20000 });
  t('a #hash opens its card for the visit', !(await page.$eval('#types', (e) => e.classList.contains('folded'))));
  const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('fcc-img-fold') || '{}'); } catch (e) { return {}; } });
  t('and the stored choice is untouched', stored.types === 0, JSON.stringify(stored));
}

console.log('· the phone');
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const o = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, win: window.innerWidth,
    right: document.querySelector('#types').getBoundingClientRect().right }));
  t('the page does not scroll sideways at 390px', o.w <= o.win + 1, JSON.stringify(o));
  t('and the section stays inside the screen', o.right <= o.win + 1, JSON.stringify(o));
}

t('no console error anywhere in the run', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\u00b7 negative control \u2014 the same page with the mixed-code gate stripped out');
{
  NEG = true;
  const nctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await nctx.route('**://img.northwind.invalid/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: WHITE }));
  await nctx.route('**://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const np = await nctx.newPage();
  await np.goto(BASE + '/images', { waitUntil: 'domcontentloaded' });
  await np.waitForFunction(() => window.__imgPage && window.__imgPage.state.FEEDS.length > 0, null, { timeout: 20000 });
  await np.selectOption('#brand', 'Northwind');
  await np.waitForFunction(() => { const s = window.__imgPage.state; return s.CLIENT === 'Northwind' && s.DATA && s.DATA.snap && s.TAGS.tok['03']; }, null, { timeout: 15000 });
  const rep = await np.evaluate(() => window.__imgPage.types.head);
  t('without the gate the mixed code IS counted as named \u2014 so the check above is real',
    rep.named === 700 && rep.mixed === 0, JSON.stringify({ named: rep.named, mixed: rep.mixed }));
  await nctx.close();
  NEG = false;
}

await b.close(); srv.close();
if (fail) { console.log('✗ ' + fail + ' of ' + (pass + fail) + ' FAILED'); process.exit(1); }
console.log('✓ image type section: ' + pass + ' checks pass');
