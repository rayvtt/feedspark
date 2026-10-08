#!/usr/bin/env node
/* Golden Record ⬇ HTML — THE CATALOGUE'S MODULES, PICKED BY THE AM (Ray, 7 Oct 2026: "within Golden Score record,
   at bottom, pull in modules dashboard from Catalogue (module) also, and Leave AM to actually select which module of
   the dashboard is shown inside the HTML download. For example, with content depth, there could be multiple content
   depths displayed on the dashboard … All this would be added at the end of the HTML, and AM can also have the option
   of not including it if it's not needed.")

   What a source read cannot see: whether the framed Catalogue really shows its module grid alone, whether a tick on a
   card with a measure picks THAT measure (two content depths are two picks), whether the download carries each pick
   as the Catalogue drew it — the right measure, no control, nothing that needs a script — at the end of the file,
   whether the frame is put back as the AM left it, whether nothing at all is carried until something is ticked, and
   whether the AM's own Catalogue preferences on the device survive the frame. So this serves BOTH real pages over
   HTTP (a file:// frame is another origin and its document unreachable), runs the Catalogue on the synthetic
   Northwind set of tools/catalog_stub.js, and uses every exit.

   Playwright-based, so it runs in presync (like check_grpdf), not in validate.yml.
   Run: NODE_PATH=$(npm root -g) node tools/check_grcatx.js      (GRCATX_SHOT=/dir keeps screenshots)
*/
'use strict';
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const fs = require('fs');
const os = require('os');
const http = require('http');
const D = path.resolve(__dirname, '..', 'docs');
const STUBS = require('./catalog_stub.js');
const SHOT = process.env.GRCATX_SHOT || '';
const CLIENT = STUBS.CLIENT, MKT = STUBS.MKT;

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const FILES = {
  '/golden': ['FeedSpark_GoldenRecord.html', 'text/html'],
  '/FeedSpark_Catalog.html': ['FeedSpark_Catalog.html', 'text/html'],
  '/labels/engine.js': ['labelguard_engine.js', 'application/javascript'],
  '/feedlab/engine.js': ['feedlab_engine.js', 'application/javascript'],
};
const server = http.createServer((rq, rs) => {
  const u = rq.url.split('?')[0];
  if (u === '/design/fcc.css') { rs.writeHead(200, { 'content-type': 'text/css' }); return rs.end(FCC_CSS); }
  // what a signin without the Catalogue module meets: a page that is not the Catalogue
  if (u === '/denied') { rs.writeHead(403, { 'content-type': 'text/html' }); return rs.end('<!doctype html><title>No access</title><p>You do not have access to this module.</p>'); }
  const f = FILES[u];
  if (!f) { rs.writeHead(404); return rs.end('nope'); }
  rs.writeHead(200, { 'content-type': f[1] });
  rs.end(fs.readFileSync(path.join(D, f[0])));
});

// ONE init script for every frame: the Catalogue's stub behind its own guard, the Golden Record's on /golden
const STUB = `(function(){var real=window.fetch.bind(window);
window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
${STUBS.stubLines()}
 if(/\\/golden/.test(location.pathname))return window.__grFetch(url,opts,real,j);
 return real(url,opts);};})();`;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const open = async (opts) => {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(({ CLIENT, MKT, picks, prefs, catSrc }) => {
      if (/\/golden/.test(location.pathname)) {
        try {
          localStorage.clear();
          Object.keys(prefs || {}).forEach((k) => localStorage.setItem(k, JSON.stringify(prefs[k])));
          if (picks) localStorage.setItem('gr-catx', JSON.stringify(picks));
        } catch (e) {}
        if (catSrc) window.__grCatSrc = catSrc;
        else window.__grCatSrc = '/FeedSpark_Catalog.html';
        const NOW = Date.now(), attrs = {}, cov = {};
        ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin', 'condition', 'item_group_id',
          'color', 'size', 'gender', 'age_group', 'google_product_category', 'product_type', 'material'].forEach((k, i) => {
          const c = i < 11 ? 100 : 80; attrs[k] = { present: true, filled: c * 10, cov: c }; cov[k] = c;
        });
        const feed = { client: CLIENT, mkt: MKT, status: 'ok', t: NOW, rows: 1000, cov, reqMissing: [] };
        window.__grFetch = (u, o, real, j) => {
          if (/engine\.js/.test(u)) return real(u, o);
          if (u.includes('/api/golden/estate')) return j({ feeds: { [CLIENT + '|' + MKT]: feed }, alerts: {} });
          if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: CLIENT, market: MKT, attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
          if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
          if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
          if (u.includes('/api/golden/history')) return j({ hist: null });
          if (u.includes('/api/golden/quality')) return j({ quality: null });
          return j({});
        };
      }
    }, { CLIENT, MKT, picks: opts.picks || null, prefs: opts.prefs || null, catSrc: opts.catSrc || null });
    await page.addInitScript(STUB);
    await page.goto(BASE + '/golden#' + encodeURIComponent(CLIENT + '|' + MKT));
    await page.waitForSelector('#catx:not([hidden])', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    return { page, ctx };
  };
  const frameOf = (page) => page.frames().find((f) => /FeedSpark_Catalog\.html/.test(f.url()));
  const grabHtml = async (page) => {
    await page.evaluate(() => {
      window.__html = null;
      const real = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (bl) { bl.text().then((t) => { window.__html = t; }); return real(bl); };
      HTMLAnchorElement.prototype.click = function () {};
    });
    await page.evaluate(() => { window.__grPlainExport = true; });   // the plain document — tools/check_grlock.js drives the locked file
    await page.click('#det-html');
    await page.waitForFunction(() => window.__html !== null, null, { timeout: 60000 });
    return page.evaluate(() => window.__html);
  };

  console.log('── the card, before anything is loaded');
  // the AM's own Catalogue preferences on this device — the frame must neither obey nor overwrite them
  const PREFS = { 'fcc-cat-mods': { order: [], off: { price: 1, depth: 1 } }, 'fcc-cat-last': { c: 'Someone else', m: 'de' }, 'fcc-cat-depth': 'tlen' };
  let { page, ctx } = await open({ prefs: PREFS });
  const head = await page.evaluate(() => ({
    shown: getComputedStyle(document.getElementById('catx')).display !== 'none',
    btn: document.getElementById('catx-load').textContent, hiddenBtn: document.getElementById('catx-load').hidden,
    sub: document.getElementById('catx-sub').textContent, frames: document.querySelectorAll('#catx iframe').length,
  }));
  ok('the card sits under the scorecard for the market on screen', head.shown && /Northwind GB/.test(head.btn) && !head.hiddenBtn, head);
  ok('…loads nothing until asked — the Catalogue streams the feed and the master', head.frames === 0, head.frames);
  ok('…and says the download carries no module until one is ticked', /none is, so the download carries none/.test(head.sub), head.sub);

  console.log('── the framed Catalogue');
  await page.click('#catx-load');
  await page.waitForFunction(() => document.querySelectorAll('#catx iframe').length === 1, null, { timeout: 5000 });
  let fr = null;
  for (let i = 0; i < 60 && !fr; i++) { fr = frameOf(page); if (!fr) await page.waitForTimeout(250); }
  await fr.waitForFunction(() => document.querySelectorAll('.grx').length > 0, null, { timeout: 45000 });
  await fr.waitForFunction(() => window.__FCCCatalogue && window.__FCCCatalogue.state().prods.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const fv = await fr.evaluate(() => {
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    const mods = Array.from(document.querySelectorAll('.mod[data-mod]'));
    return {
      emb: document.documentElement.classList.contains('emb'),
      topbar: vis(document.querySelector('.topbar')), hero: vis(document.querySelector('.hero')), kpis: vis(document.getElementById('kpis')), table: vis(document.getElementById('cat')),
      shownMods: mods.filter(vis).map((m) => m.getAttribute('data-mod')),
      ticks: mods.filter((m) => m.querySelector('.grx')).map((m) => m.getAttribute('data-mod')),
      fee: vis(document.querySelector('.mod[data-mod="fee"]')),
      client: window.__FCCCatalogue.state().client, mkt: window.__FCCCatalogue.state().mkt,
    };
  });
  ok('the frame is the Catalogue for THIS market, not the device\'s last brand', fv.client === CLIENT && fv.mkt === MKT, { c: fv.client, m: fv.mkt });
  ok('…showing the module grid alone — no topbar, hero, KPI band or product table', fv.emb && !fv.topbar && !fv.hero && !fv.kpis && !fv.table, fv);
  ok('…every module, whatever this device hides on its own Catalogue', fv.shownMods.includes('price') && fv.shownMods.includes('depth') && fv.shownMods.length >= 15, fv.shownMods);
  ok('…the Fee check left out (a calculator the AM types into, not a reading of the feed)', !fv.fee && !fv.ticks.includes('fee'), fv);
  ok('…and an "In ⬇ HTML" tick on every module it shows', fv.ticks.length === fv.shownMods.length, { ticks: fv.ticks.length, shown: fv.shownMods.length });
  const fh0 = await page.$eval('#catx iframe', (f) => Math.round(f.getBoundingClientRect().height));
  ok('the picker frame is capped and scrolls inside its card rather than running the page on', fh0 > 300 && fh0 <= 860, fh0);
  ok('the frame opens on the AM\'s own depth measure (it is read, never written)', await fr.evaluate(() => document.getElementById('depth-f').value) === 'tlen');

  console.log('── ticking: one module, and two measures of one module');
  const tick = (mod) => fr.evaluate((m) => { const c = document.querySelector('.mod[data-mod="' + m + '"] .grx input'); c.click(); return c.checked; }, mod);
  const setDepth = (v) => fr.evaluate((val) => { const s = document.getElementById('depth-f'); s.value = val; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  await setDepth('imgs'); await page.waitForTimeout(150);
  await tick('depth');
  await setDepth('hl'); await page.waitForTimeout(150);
  const hlBefore = await fr.evaluate(() => document.querySelector('.mod[data-mod="depth"] .grx input').checked);
  ok('switching the measure shows ITS tick — highlights are not yet picked', hlBefore === false, hlBefore);
  await tick('depth');
  await tick('price');
  const picks = await page.evaluate(() => JSON.parse(localStorage.getItem('gr-catx') || '[]'));
  ok('three picks: content depth twice (images, highlights) and price bands',
    picks.map((x) => x.k).join(',') === 'depth:imgs,depth:hl,price', picks);
  ok('…each named as the AM sees it', picks.map((x) => x.l).join(' / ') === 'Content depth · Images per product / Content depth · Highlights per product / Price bands', picks.map((x) => x.l));
  await setDepth('imgs'); await page.waitForTimeout(150);
  ok('back on images per product, its tick reads ticked', await fr.evaluate(() => document.querySelector('.mod[data-mod="depth"] .grx input').checked));
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#catx-picks .catx-chip')).map((c) => c.textContent.replace('✕', '').trim()));
  ok('the card lists the picks as chips, each with its own ✕', chips.length === 3 && /Highlights per product/.test(chips[1]), chips);
  ok('…and its line counts them', /^3 modules from the Catalogue added to the end of ⬇ HTML$/.test(await page.$eval('#catx-sub', (e) => e.textContent)));
  await setDepth('tlen'); await page.waitForTimeout(150);   // the AM leaves the frame on another measure
  if (SHOT) await (await page.$('#catx')).screenshot({ path: path.join(SHOT, 'grcatx_card.png') });

  console.log('── ⬇ HTML with three picks');
  const html = await grabHtml(page);
  const tmp = path.join(os.tmpdir(), 'grcatx_export_' + process.pid + '.html');
  fs.writeFileSync(tmp, html);
  const out = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await out.goto('file://' + tmp);
  await out.waitForTimeout(800);
  const x = await out.evaluate(() => {
    const sec = document.getElementById('print-catx'), f = sec && sec.querySelector('iframe');
    const foot = document.getElementById('print-foot'), det = document.getElementById('det-panel');
    const src = f ? f.getAttribute('srcdoc') : '';
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const r = (e) => e.getBoundingClientRect();
    return {
      has: !!sec, live: !!document.getElementById('catx'),
      sandbox: f ? f.getAttribute('sandbox') : null,
      title: sec ? sec.querySelector('h3').textContent : '',
      heads: Array.from(doc.querySelectorAll('.mod .chead h3')).map((h) => h.textContent.trim()),
      svgs: doc.querySelectorAll('.mod svg.cht').length,
      controls: doc.querySelectorAll('select,button,input,textarea,a,script').length,
      hooks: doc.querySelectorAll('[data-f],[data-k],[onclick],[id]').length,
      clickWords: /click to list/i.test(src),
      css: /\.mod\b/.test(src) && /--chart-1/.test(src),
      order: sec && foot && det ? (r(sec).top >= r(det).bottom - 1 && r(sec).bottom <= r(foot).top + 1) : false,
      h: f ? Math.round(r(f).height) : 0,
    };
  });
  ok('the download ends with the Catalogue section — under the scorecard, above the footer', x.has && x.order, x);
  ok('…the live picker card itself is not in the file', !x.live);
  ok('…in a frame that runs nothing (sandbox with no permissions)', x.sandbox === '', x.sandbox);
  ok('…carrying exactly the three picks, in order, each measure named', x.heads.join(' | ') === 'Content depth · Images per product | Content depth · Highlights per product | Price bands', x.heads);
  ok('…each as the Catalogue drew it — a chart in each', x.svgs === 3, x.svgs);
  ok('…with no control, link, script, id or click hook left in it', x.controls === 0 && x.hooks === 0 && !x.clickWords, x);
  ok('…and the Catalogue\'s own stylesheet, so it reads as it does there', x.css);
  const inner = out.frames().find((f) => f !== out.mainFrame());
  const iv = inner ? await inner.evaluate(() => ({
    mods: document.querySelectorAll('.mod').length,
    h: document.documentElement.scrollHeight,
    bars: Array.from(document.querySelectorAll('.mod svg.cht rect')).filter((r) => +r.getAttribute('height') > 0).length,
    lato: getComputedStyle(document.body).fontFamily,
    cols: new Set(Array.from(document.querySelectorAll('.mod')).map((m) => Math.round(m.getBoundingClientRect().left))).size,
    rows: new Set(Array.from(document.querySelectorAll('.mod')).map((m) => Math.round(m.getBoundingClientRect().top))).size,
  })) : null;
  ok('the frame renders its three cards with their bars', iv && iv.mods === 3 && iv.bars > 4, iv);
  ok('…sized to its content, so it never scrolls inside the document', iv && x.h >= iv.h - 4 && x.h <= iv.h + 24, { frame: x.h, content: iv && iv.h });
  ok('…three picks side by side, one row', iv && iv.cols === 3 && iv.rows === 1, iv);
  // the reader's window is not the one the frame was measured in: a narrower one must not make it scroll
  await out.setViewportSize({ width: 820, height: 1000 }); await out.waitForTimeout(300);
  const nar = await inner.evaluate(() => ({ h: document.documentElement.scrollHeight, vw: innerWidth }));
  const fh = await out.$eval('#print-catx iframe', (f) => Math.round(f.getBoundingClientRect().height));
  ok('…and at a narrower window the same frame still holds the whole grid', nar.h <= fh + 2, { frame: fh, content: nar.h, vw: nar.vw });
  // a card that runs longer than its square SCROLLS, it is never cut (Ray, 8 Oct 2026: "html downloads on golden score has
  // visual cropping issue on some of the customised module - i like the balance square sizes so maybe make it scrollable?")
  const sc = await inner.evaluate(() => {
    const mods = Array.from(document.querySelectorAll('.mod')), b = (m) => m.querySelector(':scope>div:last-child');
    const reach = mods.every((m) => { const e = b(m), cs = getComputedStyle(e); return e.scrollHeight <= e.clientHeight + 1 || /auto|scroll/.test(cs.overflowY); });
    const m = mods[0], e = b(m), tall = document.createElement('div'); tall.style.cssText = 'height:700px;flex:none'; tall.className = 'probe-tall'; e.appendChild(tall);
    const h = Math.round(m.getBoundingClientRect().height); e.scrollTop = 1e6;
    const r = { reach, h, heights: mods.map((x) => Math.round(x.getBoundingClientRect().height)), scrolled: e.scrollTop > 0, end: Math.abs(e.scrollTop + e.clientHeight - e.scrollHeight) <= 2, inside: e.getBoundingClientRect().bottom <= m.getBoundingClientRect().bottom + 1 };
    tall.remove(); e.scrollTop = 0; return r;
  });
  ok('a card whose content runs past its square keeps the square and scrolls to the end inside it, never cropped', sc.reach && sc.h === 340 && sc.heights.every((v) => v === 340) && sc.scrolled && sc.end && sc.inside, sc);
  await out.setViewportSize({ width: 1200, height: 1000 });
  if (SHOT) {
    if (process.env.GRCATX_KEEP) fs.copyFileSync(tmp, path.join(SHOT, 'grcatx_export.html'));
    await out.waitForTimeout(1500);
    await (await out.$('#print-catx')).screenshot({ path: path.join(SHOT, 'grcatx_export.png') });
  }
  fs.unlinkSync(tmp);
  await out.close();

  // ⬇ PDF carries the picks too, now that it is the ⬇ HTML on paper (Ray, 8 Oct 2026: "can the PDF download format be
  // adapted to latest update and ensure design is consistent?") — OPT-IN with the real libraries (GRPDF_LIBS=<dir>), since a
  // canvas cannot see inside a frame: the section is drawn into an image in place, every card grown to its content
  if (process.env.GRPDF_LIBS) {
    console.log('── ⬇ PDF with the same picks (GRPDF_LIBS)');
    for (const f of ['html2canvas.min.js', 'jspdf.umd.min.js']) await page.route('**/' + f, (r) => r.fulfill({ path: path.join(process.env.GRPDF_LIBS, f), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    await page.evaluate(() => { window.__pdfOut = null; window.__printed = false; window.print = () => { window.__printed = true; };
      const iv = setInterval(() => { if (window.jspdf && window.jspdf.jsPDF && !window.jspdf.__w) { const J = window.jspdf.jsPDF; window.jspdf.__w = 1;
        window.jspdf.jsPDF = function (o) { const j = new J(o); j.addImage = function (u) { window.__pdfImg = u; }; j.save = function (n) { window.__pdfOut = n; }; return j; }; clearInterval(iv); }
        if (window.html2canvas && !window.html2canvas.__w) { const H = window.html2canvas; window.__h2cT = [];
          window.html2canvas = function (el, o) { window.__h2cT.push({ catx: !!(el.ownerDocument.querySelector('.ins.mods')), mods: el.ownerDocument.querySelectorAll('.mod').length,
            tall: Array.from(el.ownerDocument.querySelectorAll('.mod')).map((m) => Math.round(m.getBoundingClientRect().height)), imgs: el.ownerDocument.querySelectorAll('#print-catx img').length,
            frames: el.ownerDocument.querySelectorAll('#print-catx iframe').length }); return H(el, o); }; window.html2canvas.__w = 1; } }, 20); });
    await page.click('#det-pdf');
    await page.waitForFunction(() => window.__pdfOut || window.__printed, null, { timeout: 90000 }).catch(() => {});
    const pr = await page.evaluate(() => ({ out: window.__pdfOut, printed: window.__printed, calls: window.__h2cT, len: (window.__pdfImg || '').length, left: document.querySelectorAll('iframe.pdf-render').length }));
    const inner = (pr.calls || []).find((c) => c.catx), outer = (pr.calls || []).slice(-1)[0] || {};
    ok('⬇ PDF draws the picked Catalogue cards into the document — each grown to its content, at least the square — and saves without the print dialog',
      !!pr.out && !pr.printed && inner && inner.mods === 3 && inner.tall.every((h) => h >= 340) && outer.imgs === 1 && outer.frames === 0 && pr.left === 0 && pr.len > 20000,
      { out: pr.out, printed: pr.printed, inner, outer: { imgs: outer.imgs, frames: outer.frames }, left: pr.left });
    if (process.env.GRCATX_PDFSHOT && pr.len) fs.writeFileSync(process.env.GRCATX_PDFSHOT, Buffer.from((await page.evaluate(() => window.__pdfImg)).split(',')[1], 'base64'));
  }

  console.log('── the frame and the device, after the export');
  ok('the frame is put back on the measure the AM left it on', await fr.evaluate(() => document.getElementById('depth-f').value) === 'tlen');
  ok('the button is free again', await page.evaluate(() => !document.getElementById('det-html').disabled && /HTML/.test(document.getElementById('det-html').textContent)));
  const ls = await page.evaluate(() => ({ mods: localStorage.getItem('fcc-cat-mods'), last: localStorage.getItem('fcc-cat-last'), depth: localStorage.getItem('fcc-cat-depth') }));
  ok('the AM\'s own Catalogue preferences on this device are untouched', ls.mods === JSON.stringify(PREFS['fcc-cat-mods']) && ls.last === JSON.stringify(PREFS['fcc-cat-last']) && ls.depth === JSON.stringify(PREFS['fcc-cat-depth']), ls);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  ok('the PDF never carries the picker card', await page.evaluate(() => getComputedStyle(document.getElementById('catx')).display === 'none'));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  console.log('── leaving a pick out, and leaving them all out');
  await page.click('#catx-picks [data-catx-rm="2"]');
  ok('✕ on a chip drops that pick — and its tick in the frame', (await page.evaluate(() => JSON.parse(localStorage.getItem('gr-catx')).length)) === 2
    && await fr.evaluate(() => !document.querySelector('.mod[data-mod="price"] .grx input').checked));
  await page.click('#catx-clear');
  ok('Clear all leaves the download with no Catalogue module', (await page.evaluate(() => JSON.parse(localStorage.getItem('gr-catx')).length)) === 0);
  const html0 = await grabHtml(page);
  ok('…and the file then carries no Catalogue section at all', html0.indexOf('id="print-catx"') < 0 && html0.indexOf('id="catx"') < 0);
  await ctx.close();

  console.log('── picks made on another market, exported straight away (frame not open)');
  ({ page, ctx } = await open({ picks: [{ k: 'depth:kw', l: 'Content depth · Keyword slots' }, { k: 'avail', l: 'Availability' }] }));
  const t0 = Date.now();
  const html2 = await grabHtml(page);
  const d2 = await page.evaluate((h) => {
    const doc = new DOMParser().parseFromString(h, 'text/html'), f = doc.querySelector('#print-catx iframe');
    const inner = f ? new DOMParser().parseFromString(f.getAttribute('srcdoc'), 'text/html') : null;
    return inner ? Array.from(inner.querySelectorAll('.mod .chead h3')).map((x) => x.textContent.trim()) : null;
  }, html2);
  ok('a saved set applies to the next market: the export opens the Catalogue itself and waits for it', d2 && d2.join(' | ') === 'Content depth · Keyword slots | Availability', { d2, ms: Date.now() - t0 });
  await ctx.close();

  // THE PICTURES THE SCAN FLAGGED, IN THE FILE (Ray, 8 Oct 2026: "images of the scanned should be screenshot to add in report
  // too - just keep 10 small images"): the Image pixels card's tiles are buttons onto a CDN the file must never call, so the
  // export embeds the first ten as small JPEGs read through our own /api/catalog/img
  console.log('── Image pixels: ten small pictures embedded in the file');
  ({ page, ctx } = await open({ picks: [{ k: 'pix', l: 'Image pixels' }] }));
  await page.click('#catx-load');
  let pf = null;
  for (let i = 0; i < 60 && !pf; i++) { pf = frameOf(page); if (!pf) await page.waitForTimeout(250); }
  await pf.waitForFunction(() => window.__FCCCatalogue && window.__FCCCatalogue.state().prods.length > 0, null, { timeout: 45000 });
  await pf.evaluate(() => { const s = document.getElementById('pix-n'); s.value = '100'; document.getElementById('pix-go').click(); });
  await pf.waitForFunction(() => document.querySelectorAll('.mod[data-mod="pix"] .pixlook [data-px-open]').length > 0, null, { timeout: 60000 }).catch(() => {});
  const tilesOnScreen = await pf.evaluate(() => document.querySelectorAll('.mod[data-mod="pix"] .pixlook [data-px-open]').length);
  ok('the scan flags pictures to look at on the Catalogue card', tilesOnScreen > 0, tilesOnScreen);
  const htmlP = await grabHtml(page);
  const pv = await page.evaluate((h) => {
    const doc = new DOMParser().parseFromString(h, 'text/html'), f = doc.querySelector('#print-catx iframe');
    const inner = f ? new DOMParser().parseFromString(f.getAttribute('srcdoc'), 'text/html') : null;
    const imgs = inner ? Array.from(inner.querySelectorAll('.pixlook img')) : [];
    return {
      n: imgs.length, data: imgs.every((i) => /^data:image\/jpeg;base64,/.test(i.getAttribute('src') || '')),
      small: imgs.every((i) => (i.getAttribute('src') || '').length < 40000),
      labels: inner ? Array.from(inner.querySelectorAll('.pixlook .pxt b')).filter((b) => b.textContent.trim()).length : 0,
      buttons: inner ? inner.querySelectorAll('.pixlook button,[data-px-open]').length : -1,
      http: inner ? Array.from(inner.querySelectorAll('img')).filter((i) => /^https?:/.test(i.getAttribute('src') || '')).length : -1,
      head: inner ? (inner.querySelector('.pixh') || {}).textContent || '' : '',
    };
  }, htmlP);
  ok('the file carries the flagged pictures — at most ten, each a small embedded JPEG with its problem named',
    pv.n > 0 && pv.n === Math.min(10, tilesOnScreen) && pv.data && pv.small && pv.labels === pv.n, pv);
  ok('…as pictures, not buttons, and never a call out to an image host', pv.buttons === 0 && pv.http === 0, pv);
  ok('…its heading saying how many are shown when the scan flagged more', tilesOnScreen <= 10 || /10 shown/.test(pv.head), pv.head);
  const tmpP = path.join(os.tmpdir(), 'grcatx_pix_' + process.pid + '.html');
  fs.writeFileSync(tmpP, htmlP);
  const outP = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await outP.goto('file://' + tmpP); await outP.waitForTimeout(800);
  const innerP = outP.frames().find((f) => f !== outP.mainFrame());
  const drawn = innerP ? await innerP.evaluate(() => Array.from(document.querySelectorAll('.pixlook img')).filter((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 20).length) : 0;
  ok('…and every one of them draws in the downloaded file', drawn === pv.n, { drawn, n: pv.n });
  if (SHOT) { await outP.waitForTimeout(1500); await (await outP.$('#print-catx')).screenshot({ path: path.join(SHOT, 'grcatx_pix.png') }); }
  fs.unlinkSync(tmpP); await outP.close();
  await ctx.close();

  console.log('── a signin without the Catalogue');
  ({ page, ctx } = await open({ catSrc: '/denied' }));
  await page.click('#catx-load');
  await page.waitForSelector('#catx-fw .catx-x', { timeout: 8000 }).catch(() => {});
  const dn = await page.evaluate(() => ({ msg: (document.querySelector('#catx-fw .catx-x') || {}).textContent || '', btn: !document.getElementById('catx-load').hidden }));
  ok('says the Catalogue could not be opened — at once, not after a long wait — and offers the button again', /could not be opened/.test(dn.msg) && dn.btn, dn);
  await ctx.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  server.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ Catalogue-modules-in-the-HTML checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { server.close(); } catch (er) {} process.exit(1); });
