#!/usr/bin/env node
/* Golden Record ⬇ PDF tripwire (Ray, 16 Sep 2026 — twice: "should all fit in 1 vertical
   page", then "ensure PDF downloads include [the content quality section] … make sure it is
   one or two pages").

   The scorecard PDF has two properties that are easy to break silently and impossible to
   notice from the app itself, because they only exist in the print layout:

     1. it is ONE sheet — exportPdf measures the laid-out document and writes its height
        into @page, so the scorecard is never sliced across A4 breaks;
     2. it carries EVERYTHING the page shows, the content-quality section included, with
        its findings intact. The printable column is 703px, which trips the page's own
        ≤900px responsive rules — those drop the spec note, the worst-rule summary and the
        per-rule hit counts on a phone, and twice now they have silently emptied columns of
        the PDF too. body.pdf re-shows them; this check is what keeps them re-shown.

   It renders the REAL PDF through Chromium and counts pages, rather than trusting CSS.
   Playwright-based, so it runs in presync (like check_mobile), not in validate.yml.

   Run: NODE_PATH=$(npm root -g) node tools/check_grpdf.js
*/
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) {
  console.log('· playwright unavailable — skipped'); process.exit(0);
}

const PAGE = 'file://' + path.resolve(__dirname, '..', 'docs', 'FeedSpark_GoldenRecord.html');
const ENGINE_LG = path.resolve(__dirname, '..', 'docs', 'labelguard_engine.js');
const ENGINE_FA = path.resolve(__dirname, '..', 'docs', 'feedlab_engine.js');
const A4 = 297;                 // mm
const MAX_A4 = 2.2;             // the collapsed scorecard must stay inside ~two A4 lengths

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin',
  'mpn', 'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category',
  'product_type', 'sale_price', 'additional_image_link', 'product_highlight', 'product_detail', 'material',
  'pattern', 'size_type', 'size_system', 'question_and_answer', 'document_link', 'related_product',
  'item_group_title', 'variant_option', 'popularity_rank'];

// a stored content-quality reading: two attributes, each with a broken rule of each severity
const rule = (n, pct, eg) => ({ n, pct, eg: eg || ['example value'] });
const QUALITY = {
  t: Date.now(), client: 'Reiss', market: 'gb', rows: 1000,
  attrs: {
    title: { filled: 1000, cov: 100, avgLen: 58, minLen: 12, maxLen: 160,
      rules: { caps: rule(120, 12), promo: rule(30, 3), short: rule(600, 60), 'no-brand': rule(90, 9) } },
    description: { filled: 990, cov: 99, avgLen: 240, minLen: 20, maxLen: 4000,
      rules: { html: rule(50, 5), thin: rule(300, 30.3), dupe: rule(120, 12.1) } },
    material: { filled: 400, cov: 40, avgLen: 16, minLen: 4, maxLen: 45,
      rules: { placeholder: rule(40, 10), sentence: rule(20, 5) } },
  },
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));

  await page.addInitScript(({ ATTRS, QUALITY }) => {
    const NOW = Date.now();
    const cov = {}, attrs = {};
    ATTRS.forEach((k, i) => {
      const absent = i > 19 && i % 3 === 0;                 // a realistic mix of gaps
      cov[k] = absent ? null : 100 - (i % 7) * 4;
      attrs[k] = absent ? { present: false } : { present: true, filled: 900, cov: cov[k] };
    });
    const feed = { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 88,
      ai: { n: 0, of: 6 }, cov, reqMissing: [] };
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      const j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': feed }, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
      if (u.includes('/api/labels/askdraft')) return j({ cfg: { to: {} }, asked: {} });
      return j({});
    };
    window.print = function () {};
  }, { ATTRS, QUALITY });

  await page.goto(PAGE);
  await page.waitForTimeout(1200);
  ok('the scorecard renders with a stored quality reading', await page.$('#qz-tier .qz-score') !== null);

  await page.click('#det-pdf');
  await page.waitForTimeout(500);
  // MEASURE AT THE PRINTABLE WIDTH. The page's own responsive rules key on the VIEWPORT,
  // and when printing the viewport IS the page box (186mm = 703px) — so measuring at
  // desktop width would never see the ≤900px rules that have twice emptied columns of the
  // PDF, and this tripwire would pass on exactly the bug it exists to catch.
  await page.setViewportSize({ width: 703, height: 1000 });
  await page.waitForTimeout(350);

  const m = await page.evaluate(() => {
    const MM = 25.4 / 96;
    const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    const el = document.getElementById('sec-detail');
    const pg = document.getElementById('pdf-page');
    return {
      mm: el ? +(el.getBoundingClientRect().height * MM).toFixed(1) : 0,
      page: pg ? pg.textContent : null,
      quality: vis('#qz-tier'),
      qScore: vis('#qz-tier .qz-score'),
      worst: vis('.qz-row .qz-worst'),          // the finding itself
      flag: vis('.qz-row .qz-flag'),            // the requirement / best-practice counts
      note: vis('.at-row .at-note'),            // the spec note on the coverage rows
      actions: vis('.qz-act') || vis('.at-act') || vis('.det-actions'),
      runBtn: vis('#qz-run'),
      chrome: vis('.topbar') || vis('.hero') || vis('#sec-estate'),
      head: vis('#print-head'), foot: vis('#print-foot'),
    };
  });

  ok('the content-quality section is in the PDF', m.quality && m.qScore);
  ok('its findings print — the worst rule per attribute', m.worst);
  ok('its requirement / best-practice counts print', m.flag);
  ok('the coverage rows keep their spec note', m.note);
  ok('the branded header and footer frame it', m.head && m.foot);
  ok('app chrome and buttons stay out of the document', !m.chrome && !m.actions && !m.runBtn);
  ok('a sized sheet is written into @page', /@page\{size:210mm \d+mm/.test(m.page || ''), m.page);
  ok('the document stays inside ' + MAX_A4 + ' A4 lengths (' + m.mm + 'mm = ' +
    (m.mm / A4).toFixed(2) + ')', m.mm > 0 && m.mm / A4 <= MAX_A4, m.mm);

  const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok('the rendered PDF is ONE page', pages === 1, pages);

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.waitForTimeout(250);
  ok('printing leaves the app exactly as it was', await page.evaluate(() =>
    !document.body.classList.contains('pdf') && !document.getElementById('pdf-page') &&
    getComputedStyle(document.querySelector('.topbar')).display !== 'none'));

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  if (fail) { console.log('\n✗ Golden Record PDF tripwire: ' + fail + ' check(s) failed'); process.exit(1); }
  console.log('   ✓ Golden Record PDF: one page, scorecard + content quality intact');
})().catch((e) => { console.error(e); process.exit(1); });
