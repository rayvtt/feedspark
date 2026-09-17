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
// the collapsed scorecard — four spec tiers + content quality + AI-readiness — must stay
// inside roughly two and a half A4 lengths on its single sheet (Ray: "one or two pages")
const MAX_A4 = 2.4;

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
  // the Feed Lab reading that rides the same stream — the card the client actually reads
  ai: {
    total: 76, tier: 3, tierLabel: 'Enriched', sampled: 1000, rows: 1000,
    pillars: [
      { key: 'identity', label: 'Identity & trust', score: 100, weight: 1.2, summary: 'GTIN, brand, price, availability all present' },
      { key: 'titles', label: 'Title anatomy', score: 62, weight: 1.6, summary: 'avg 60 chars — MASK window is 80–120' },
      { key: 'descriptions', label: 'Descriptions', score: 90, weight: 1.3, summary: '100% coverage, avg 359 chars' },
      { key: 'attributes', label: 'Attribute completeness', score: 92, weight: 1.5, summary: 'pattern 27%, rest strong' },
      { key: 'taxonomy', label: 'Taxonomy depth', score: 51, weight: 1.0, summary: 'GPC 100%, product_type deep on 24%' },
      { key: 'media', label: 'Media richness', score: 100, weight: 1.0, summary: 'multi-angle imagery on most items' },
      { key: 'labels', label: 'Label architecture', score: 69, weight: 0.9, summary: 'label_1 nearly unused' },
      { key: 'ai', label: 'Agentic readiness', score: 47, weight: 1.5, summary: 'no conversational attributes; highlights shallow' },
    ],
    titles: { avg: 60, min: 18, max: 140, dup: 12, allCaps: 3,
      buckets: [{ b: '<50', n: 120 }, { b: '50–79', n: 380 }, { b: '80–119', n: 400 }, { b: '120–150', n: 80 }, { b: '>150', n: 20 }],
      mask: { brand: 96, material: 41, fit: 28, colour: 88, use: 12 } },
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

  // FIDELITY: the PDF is the page SCALED, never a second design (Ray, 16 Sep 2026: "PDF
  // export still doesn't reflect exact same visual as FCC"). Print may hide interactive
  // chrome and put the page's own ≤900px rules back to their desktop form — it may NOT
  // restyle the design. These properties are read on screen and again in print mode, and
  // must match: anything else is a compact variant creeping back in.
  const PROBE = [['.tier', ['padding', 'marginTop', 'borderRadius']], ['.tier-h h4', ['fontSize']],
    ['.qz-i', ['fontSize']], ['.dial', ['width']], ['.gr-verdict', ['fontSize']],
    ['.at-row', ['padding', 'fontSize']], ['.qz-row', ['padding', 'fontSize']], ['.qz-score', ['fontSize']],
    ['.qz-line', ['fontSize']], ['.qz-why', ['fontSize']], ['.big-ring', ['width']], ['.brv .bn', ['fontSize']],
    ['.air-card', ['padding']], ['.pillar', ['padding']], ['.pq', ['fontSize']], ['.pillars', ['gap']],
    ['.lad .ln', ['fontSize']], ['.heat-card', ['padding']], ['.thist', ['height']]];
  const readStyles = () => page.evaluate((P) => {
    const out = {};
    P.forEach(([sel, props]) => {
      const el = document.querySelector(sel); if (!el) return;
      const cs = getComputedStyle(el);
      props.forEach((pr) => { out[sel + '{' + pr + '}'] = cs[pr]; });
    });
    return out;
  }, PROBE);
  const onScreen = await readStyles();

  // The layout/CSS checks below are about preparePdf()'s print styling, unchanged by the
  // 17 Sep 2026 one-click rework (#det-pdf now rasterises via html2canvas+jsPDF instead of
  // calling window.print() — see the dedicated one-click-download block further down).
  // preparePdf() lives in the page's own closure, not on window, so it's reached the same
  // way a bare Ctrl+P reaches it: the beforeprint listener the page registers on window.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
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
      air: vis('#air-tier'),
      airScore: (document.querySelector('#air-tier .brv .bn') || {}).textContent,
      rungs: document.querySelectorAll('#air-tier .lad').length,
      here: !!document.querySelector('#air-tier .lad.on'),
      pillars: document.querySelectorAll('#air-tier .pillar').length,
      worst: vis('.qz-row .qz-worst'),          // the finding itself
      flag: vis('.qz-row .qz-flag'),            // the requirement / best-practice counts
      note: vis('.at-row .at-note'),            // the spec note on the coverage rows
      actions: vis('.qz-act') || vis('.at-act') || vis('.det-actions'),
      runBtn: vis('#qz-run'),
      chrome: vis('.topbar') || vis('.hero') || vis('#sec-estate'),
      head: vis('#print-head'), foot: vis('#print-foot'),
    };
  });

  // sub-pixel rounding from the zoom is expected; a restyle is not
  const inPrint = await readStyles();
  const drift = Object.keys(onScreen).filter((k) => {
    if (!(k in inPrint)) return false;
    const a = parseFloat(onScreen[k]), b = parseFloat(inPrint[k]);
    if (isFinite(a) && isFinite(b)) return Math.abs(a - b) > 0.2;     // zoom rounding only
    return onScreen[k] !== inPrint[k];
  }).map((k) => k + ' screen=' + onScreen[k] + ' print=' + inPrint[k]);
  ok('print does not restyle the page — same type scale, padding and dial as the FCC',
    drift.length === 0 && Object.keys(onScreen).length >= 15, drift);

  ok('the content-quality section is in the PDF', m.quality && m.qScore);
  ok('the AI-Readiness score prints with it', m.air && m.airScore === '76', m.airScore);
  ok('its tier ladder prints — four rungs, current one marked', m.rungs === 4 && m.here);
  ok('all eight pillars print', m.pillars === 8, m.pillars);
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

  console.log('\n-- one-click PDF download (Ray, 17 Sep 2026: "still not seamless") --');
  {
    // html2canvas/jsPDF are real ~200KB CDN libraries — stubbed here so the tripwire pins the
    // GLUE (button -> libs -> rasterise -> package -> save -> restore), not the libraries'
    // own rendering, which a fidelity check does separately against the real thing.
    await page.evaluate(() => {
      window.__pdfSaved = null;
      window.html2canvas = () => Promise.resolve({ width: 960, height: 1200, toDataURL: () => 'data:image/jpeg;base64,AAAA' });
      window.jspdf = { jsPDF: function (opts) { this.opts = opts; this.addImage = () => {}; this.save = (name) => { window.__pdfSaved = name; }; } };
    });
    await page.click('#det-pdf');
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({
      saved: window.__pdfSaved,
      stillCapturing: document.body.classList.contains('pdf') || document.body.classList.contains('pdfshot'),
      chromeBack: getComputedStyle(document.querySelector('.topbar')).display !== 'none',
      btnRestored: document.getElementById('det-pdf').textContent,
    }));
    ok('a one click produces a downloaded PDF file — no print dialog', !!r.saved && /\.pdf$/.test(r.saved), r.saved);
    ok('the capture classes are removed once the download completes — no lingering print state', !r.stillCapturing);
    ok('the app is back to normal immediately (no waiting on window.print’s afterprint)', r.chromeBack);
    ok('the button label is restored', r.btnRestored === '⬇ PDF', r.btnRestored);
  }

  console.log('\n-- ⬇ HTML: the same document, self-contained, zero dialog --');
  {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#det-html'),
    ]);
    const fs = require('fs');
    const os = require('os');
    const tmp = require('path').join(os.tmpdir(), 'grhtml-' + Date.now() + '.html');
    await download.saveAs(tmp);
    const html = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
    ok('downloads as .html, not .htm or extensionless', /\.html$/.test(download.suggestedFilename()), download.suggestedFilename());
    ok('starts with a doctype — opens correctly standalone', /^<!doctype html>/i.test(html));
    ok('carries no <script> — a static snapshot never calls the FCC\'s own APIs', !/<script/i.test(html));
    ok('body is laid out chrome-free at natural size (pdf pdfshot)', /<body class="pdf pdfshot"/.test(html), html.match(/<body[^>]*>/));
    ok('the branded header is baked in', /Golden Record scorecard/.test(html) && /Reiss/.test(html));
    ok('the scorecard content itself is present', /Required.{0,5}every product/.test(html));
  }

  console.log('\n-- CDN unreachable: the old print dialog is the fallback, never a silent failure --');
  {
    const page2 = await browser.newPage();
    const errs2 = [];
    page2.on('pageerror', (e) => errs2.push(e.message));
    await page2.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
    await page2.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
    await page2.route('**/html2canvas*', (r) => r.abort());
    await page2.route('**/jspdf*', (r) => r.abort());
    await page2.addInitScript(({ ATTRS, QUALITY }) => {
      const NOW = Date.now();
      const cov = {}, attrs = {};
      ATTRS.forEach((k, i) => { cov[k] = 100; attrs[k] = { present: true, filled: 900, cov: 100 }; });
      const feed = { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 88, ai: { n: 0, of: 6 }, cov, reqMissing: [] };
      const real = window.fetch.bind(window);
      window.fetch = (url, opts) => {
        const u = String(url);
        const j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
        if (/engine\.js/.test(u)) return real(url, opts);
        if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': feed }, alerts: {} });
        if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: null, daily: null });
        if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
        if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
        if (u.includes('/api/labels/askdraft')) return j({ cfg: { to: {} }, asked: {} });
        return j({});
      };
      window.__printed = false;
      window.print = function () { window.__printed = true; };
    }, { ATTRS, QUALITY });
    await page2.goto(PAGE);
    await page2.waitForTimeout(1200);
    await page2.click('#det-pdf');
    await page2.waitForTimeout(800);
    const printed = await page2.evaluate(() => window.__printed);
    ok('the CDN being unreachable falls back to the print dialog, not a dead button', printed === true, printed);
    await page2.close();
  }

  await browser.close();
  if (fail) { console.log('\n✗ Golden Record PDF tripwire: ' + fail + ' check(s) failed'); process.exit(1); }
  console.log('   ✓ Golden Record PDF: one page, scorecard + content quality intact, one-click download works, CDN-miss falls back');
})().catch((e) => { console.error(e); process.exit(1); });
