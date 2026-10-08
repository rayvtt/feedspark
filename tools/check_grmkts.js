#!/usr/bin/env node
/* Golden Record — ALL MARKETS at the foot of the client documents (Ray, 7 Oct 2026: "For
   multi-market clients, when you download the HTML or report card, at bottom there should be an
   overview of all the market scores as well").

   The table only exists inside the two downloads (⬇ PDF, ⬇ HTML) and a bare Ctrl+P, so a source
   read cannot see whether it lands, whether the market the report is about prints the SAME
   numbers as the document above it, or whether a market nobody measured reads as a dash rather
   than a zero. This renders the REAL page against a stubbed FCC carrying a four-market brand —
   one analysed in full, one scanned only, one never scanned — and uses every exit.

   Playwright-based, so it runs in presync (like check_grpdf), not in validate.yml.
   Run: NODE_PATH=$(npm root -g) node tools/check_grmkts.js
*/
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) {
  console.log('· playwright unavailable — skipped'); process.exit(0);
}
const fs = require('fs');
const os = require('os');
const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html') + '#Reiss%7Cgb';
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin',
  'mpn', 'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category',
  'product_type', 'sale_price', 'additional_image_link', 'product_highlight', 'material', 'pattern'];
const rule = (n, pct) => ({ n, pct, eg: ['example value'] });
// the report's own market carries a stored content-quality + AI-readiness reading
const QUALITY = {
  t: Date.now(), client: 'Reiss', market: 'gb', rows: 1000,
  attrs: {
    title: { filled: 1000, cov: 100, avgLen: 58, minLen: 12, maxLen: 160, rules: { caps: rule(120, 12), short: rule(600, 60) } },
    description: { filled: 990, cov: 99, avgLen: 240, minLen: 20, maxLen: 4000, rules: { html: rule(50, 5) } },
  },
  ai: {
    total: 71, tier: 3, tierLabel: 'Enriched', sampled: 1000, rows: 1000,
    pillars: [
      { key: 'identity', label: 'Identity & trust', score: 100, weight: 1.4 },
      { key: 'titles', label: 'Titles', score: 62, weight: 1.6 },
      { key: 'descriptions', label: 'Descriptions', score: 90, weight: 1.3 },
      { key: 'attributes', label: 'Attributes', score: 92, weight: 1.5 },
      { key: 'taxonomy', label: 'Taxonomy', score: 51, weight: 1.2 },
      { key: 'media', label: 'Media', score: 100, weight: 1.0 },
      { key: 'conversational', label: 'Conversational', score: 0, weight: 2.4 },
      { key: 'ai', label: 'Structured detail', score: 47, weight: 1.2 },
    ],
  },
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const open = async (opts) => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
    await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
    await page.addInitScript(({ ATTRS, QUALITY, single, demo }) => {
      try { localStorage.clear(); sessionStorage.setItem('gr-demo', demo ? '1' : '0'); } catch (e) {}
      const NOW = Date.now(), DAY = 864e5;
      const attrs = {}, full = {}, half = {};
      ATTRS.forEach((k, i) => {
        const c = i < 17 ? 100 : 60;
        attrs[k] = { present: true, filled: c * 10, cov: c };
        full[k] = c; half[k] = 50;
      });
      // the INDEX copy of the report's own market deliberately disagrees with its snapshot, so a
      // row read off the index instead of the document above it shows up as a different number
      const gb = { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, cov: half, reqMissing: [],
        q: 12.3, air: 12, airTier: 1 };
      const de = { client: 'Reiss', mkt: 'de', status: 'ok', t: NOW - 2 * DAY, rows: 800, cov: full, reqMissing: [],
        q: 81.4, air: 64, airTier: 3 };
      const fr = { client: 'Reiss', mkt: 'fr', status: 'ok', t: NOW - 3 * DAY, rows: 600, cov: full, reqMissing: ['gtin'] };
      const it = { client: 'Reiss', mkt: 'it', status: 'never' };
      const feeds = single ? { 'Reiss|gb': gb } : { 'Reiss|gb': gb, 'Reiss|de': de, 'Reiss|fr': fr, 'Reiss|it': it,
        'Schuh|gb': { client: 'Schuh', mkt: 'gb', status: 'ok', t: NOW, rows: 500, cov: full, reqMissing: [], q: 70 } };
      const real = window.fetch.bind(window);
      window.fetch = (url, o) => {
        const u = String(url);
        const j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
        if (/engine\.js/.test(u)) return real(url, o);
        if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
        if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
        if (u.includes('/api/golden/history')) return j({ hist: null });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
        if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
        if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
        return j({});
      };
      window.print = function () {};
    }, Object.assign({ ATTRS, QUALITY }, opts || {}));
    await page.goto(PAGE);
    await page.waitForSelector('#qz-tier .qz-score', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    return page;
  };
  const readTable = (page) => page.evaluate(() => {
    const el = document.getElementById('print-mkts');
    const t = el && el.querySelector('.pm-t');
    const txt = (n) => (n ? String(n.innerText != null ? n.innerText : n.textContent).replace(/\s+/g, ' ').trim() : '');
    const rows = t ? Array.from(t.querySelectorAll('tbody tr')).map((r) => ({
      me: r.classList.contains('me'), cells: Array.from(r.cells).map(txt),
      g: txt(r.cells[1] && r.cells[1].querySelector('b')), q: txt(r.cells[2] && r.cells[2].querySelector('b')),
      a: txt(r.cells[3] && r.cells[3].querySelector('b')) })) : [];
    const foot = t && t.tFoot ? Array.from(t.tFoot.rows[0].cells).map(txt) : [];
    return { shown: !!el && getComputedStyle(el).display !== 'none', html: el ? el.innerHTML : '', rows, foot,
      head: txt(el && el.querySelector('.pm-h h3')), note: txt(el && el.querySelector('.pm-note')),
      dial: txt(document.querySelector('#det-panel .dial .dial-n')),
      qz: txt(document.querySelector('#qz-tier .qz-score')),
      air: txt(document.querySelector('#air-tier .brv .bn')) };
  });

  console.log('── a four-market brand, on screen and on paper');
  const page = await open();
  let r = await readTable(page);
  ok('the estate scorecard is the AM\'s table — nothing of it on screen', !r.shown, r.shown);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(300);
  r = await readTable(page);
  ok('a bare Ctrl+P prints the all-markets table at the foot of the scorecard', r.shown && r.rows.length === 4, { shown: r.shown, n: r.rows.length });
  ok('…one row per market of THIS brand, in the estate\'s order (no other brand leaks in)',
    r.rows.map((x) => x.cells[0].split(' ')[0]).join(',') === 'DE,FR,GB,IT', r.rows.map((x) => x.cells[0]));
  ok('…headed with the brand', /^All markets — Reiss$/.test(r.head), r.head);
  const gb = r.rows.find((x) => x.me) || {};
  ok('the report\'s own market is marked "this report"', gb.cells && /^GB THIS REPORT/i.test(gb.cells[0]), gb.cells);
  ok('…and prints the SAME Golden Score as the dial above it, not the index copy', gb.g && gb.g === r.dial, { row: gb.g, dial: r.dial });
  ok('…the same content quality as the headline above it', gb.q && gb.q === r.qz && gb.q !== '12.3', { row: gb.q, doc: r.qz });
  ok('…the same AI-readiness as the ring above it, with its tier', gb.a === r.air && /Enriched/.test(gb.cells[3]), { row: gb.a, doc: r.air, cell: gb.cells && gb.cells[3] });
  const de = r.rows.find((x) => /^DE/.test(x.cells[0])) || {};
  ok('another analysed market carries its own three scores', de.q === '81.4' && de.a === '64' && /Enriched/.test(de.cells[3]) && !!de.g, de);
  const fr = r.rows.find((x) => /^FR/.test(x.cells[0])) || {};
  ok('a scanned market with no analysis reads a dash for both analyses — never a zero',
    !!fr.g && fr.q === '' && fr.a === '' && fr.cells[2] === '—' && fr.cells[3] === '—', fr.cells);
  ok('…and names the required attribute it is missing', /^1 gtin$/.test(fr.cells[5]), fr.cells && fr.cells[5]);
  const it = r.rows.find((x) => /^IT/.test(x.cells[0])) || {};
  ok('a market never scanned says so and prints no figure', it.cells && it.cells.slice(1, 6).every((c) => c === '—') && it.cells[6] === 'not scanned yet', it.cells);
  const gs = [gb.g, de.g, fr.g].map(Number), avgG = Math.round(gs.reduce((a, b) => a + b, 0) / 3 * 10) / 10;
  ok('the average reads only the markets that carry each score — and says how many',
    r.foot[1] === avgG + ' of 3' && r.foot[2] === (Math.round((+gb.q + 81.4) / 2 * 10) / 10) + ' of 2' &&
    r.foot[3] === (Math.round((+gb.a + 64) / 2 * 10) / 10) + ' of 2', { foot: r.foot, avgG });
  ok('…products summed over the scanned markets, the count of markets missing a required attribute, and the scan coverage',
    r.foot[4] === '2,400' && r.foot[5] === '1 market' && r.foot[6] === '3 of 4 scanned', r.foot);
  if (process.env.GRMKTS_SHOT) {
    await page.evaluate(() => document.body.classList.add('pdfshot'));
    await (await page.$('#print-mkts')).screenshot({ path: path.join(process.env.GRMKTS_SHOT, 'grmkts_pdf.png') });
    await page.evaluate(() => document.body.classList.remove('pdfshot'));
  }
  // on paper the table lives in the 960px scorecard column: nothing wraps a row to two lines
  const lines = await page.evaluate(() => Array.from(document.querySelectorAll('#print-mkts .pm-t tr')).map((tr) => Math.round(tr.getBoundingClientRect().height)));
  const fit = await page.evaluate(() => { const c = document.querySelector('#print-mkts .pm'), t = c && c.querySelector('.pm-t');
    return c && t ? { table: Math.round(t.getBoundingClientRect().right), card: Math.round(c.getBoundingClientRect().right) } : null; });
  ok('the table fits inside its card at the PDF\'s 960px column — no column cut off', fit && fit.table <= fit.card - 10, fit);
  ok('every row of the table is one line in the PDF\'s column', lines.length === 6 && Math.max.apply(null, lines.slice(1)) <= Math.min.apply(null, lines.slice(1)) + 2, lines);
  ok('a one-line key says what each score is', /Golden Score = .*Content quality = .*AI-readiness = /.test(r.note), r.note);

  console.log('── ⬇ PDF (one click)');
  await page.evaluate(() => {
    document.body.classList.remove('pdf');
    document.getElementById('print-mkts').innerHTML = '';
    window.__cap = null;
    window.html2canvas = function (node) {
      // the PDF is the ⬇ HTML document on paper (8 Oct 2026) — the table is read where the capture reads it, in that document
      const el = node.ownerDocument.getElementById('print-mkts');
      window.__cap = { shown: getComputedStyle(el).display !== 'none', rows: el.querySelectorAll('.pm-t tbody tr').length };
      const c = document.createElement('canvas'); c.width = 20; c.height = 40; return Promise.resolve(c);
    };
    window.jspdf = { jsPDF: function () { return { addImage: function () {}, save: function () { window.__saved = true; } }; } };
  });
  await page.click('#det-pdf');
  await page.waitForFunction(() => window.__saved === true, null, { timeout: 8000 }).catch(() => {});
  const cap = await page.evaluate(() => window.__cap);
  ok('the one-click PDF captures the document WITH the all-markets table on it', cap && cap.shown && cap.rows === 4, cap);

  console.log('── ⬇ HTML');
  await page.evaluate(() => {
    window.__html = null;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (bl) { bl.text().then((t) => { window.__html = t; }); return real(bl); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.evaluate(() => { window.__grPlainExport = true; });   // the plain document — tools/check_grlock.js drives the locked file
  await page.click('#det-html');
  await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
  const html = await page.evaluate(() => window.__html);
  const tmp = path.join(os.tmpdir(), 'grmkts_export_' + process.pid + '.html');
  fs.writeFileSync(tmp, html);
  const out = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await out.goto('file://' + tmp);
  await out.waitForTimeout(300);
  const x = await readTable(out);
  const pos = await out.evaluate(() => {
    const m = document.getElementById('print-mkts'), d = document.getElementById('det-panel'), f = document.getElementById('print-foot');
    const r = (e) => e.getBoundingClientRect();
    return { afterDetail: r(m).top >= r(d).bottom - 1, beforeFoot: r(m).bottom <= r(f).top + 1,
      inside: r(m).left >= r(d).left - 1 && r(m).right <= r(d).right + 1, buttons: m.querySelectorAll('button').length };
  });
  ok('the HTML file carries the table, visible, every market', x.shown && x.rows.length === 4 && x.foot.length === 7, { shown: x.shown, n: x.rows.length });
  ok('…at the bottom: under the scorecard, above the footer, in the same column', pos.afterDetail && pos.beforeFoot && pos.inside, pos);
  ok('…the same figures the PDF prints', x.rows.map((q) => q.cells.join('|')).join('/') === r.rows.map((q) => q.cells.join('|')).join('/'));
  ok('…and nothing a script would have to answer', pos.buttons === 0, pos);
  // every bar track is one length, so a bar's fill is its number wherever it sits in the table
  const tracks = await out.$$eval('#print-mkts .pm-bar', (b) => b.map((e) => Math.round(e.getBoundingClientRect().width)));
  ok('every score bar is drawn on one track length — a tier label or an "of 3" never shortens it',
    tracks.length >= 9 && tracks.every((w) => w === tracks[0] && w > 40), tracks);
  if (process.env.GRMKTS_SHOT) await (await out.$('#print-mkts')).screenshot({ path: path.join(process.env.GRMKTS_SHOT, 'grmkts_html.png') });
  fs.unlinkSync(tmp);
  await out.close();
  await page.close();

  console.log('── demo mode');
  const dm = await open({ demo: true });
  await dm.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await dm.waitForTimeout(300);
  const dr = await readTable(dm);
  ok('a screen-share alias is the brand on the table too — the real name never prints', dr.rows.length === 4 && !/Reiss/.test(dr.html) && /^All markets — Fashion /.test(dr.head), dr.head);
  await dm.close();

  console.log('── a single-market brand');
  const one = await open({ single: true });
  await one.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await one.waitForTimeout(300);
  const o = await readTable(one);
  ok('nothing prints — the document above already IS its only market', !o.shown && o.html === '', { shown: o.shown, html: o.html.slice(0, 80) });
  await one.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ all-markets overview checks passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
