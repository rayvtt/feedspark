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

const fs = require('fs');
const os = require('os');
const D = path.resolve(__dirname, '..', 'docs');
// THE PAGE AS THE WORKER SERVES IT — with the injected layers (the ⓘ instruction toggles, the
// Tachyon copilot, the Feed Chat bubble, the presence avatars, the phone bar …). The ⬇ HTML
// export clones the live DOM, so what those layers leave behind is exactly what a client
// receives; a check that renders the bare file never sees it (Ray, 18 Sep 2026: "remove the
// element that sends code or feedback to Claude. I'm sending this to my clients").
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html',
  'lang_widget.html', 'hours_widget.html', 'shipped_widget.html', 'mobile_widget.html', 'tachyon_widget.html']
  .filter((f) => fs.existsSync(path.join(D, f)))
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const SRC = fs.readFileSync(path.join(D, 'FeedSpark_GoldenRecord.html'), 'utf8');
const TMP = path.join(os.tmpdir(), '_grpdfcheck_FeedSpark_GoldenRecord.html');
// same injection as check_mobile.js: before </body> when the page has one, appended otherwise
fs.writeFileSync(TMP, SRC.indexOf('</body>') >= 0 ? SRC.replace('</body>', WIDGETS + '\n</body>') : SRC + '\n' + WIDGETS);
// The PRINT measurements stay on the bare page: the print viewport is 703px, and the phone
// layer's own ≤760px rules + pan-frame sweep would fire on a resize the real print path never
// makes (the one-click PDF captures at 960px). The ⬇ HTML export is exercised on the served page.
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html');
const PAGE_W = 'file://' + TMP;
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
  const errs = [];
  // the same stubbed FCC behind every page this check opens
  const arm = async (page) => {
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
    // a second analysed market, so the brand's PILLAR HEATMAP renders on the live page — the
    // export check below has to prove it was taken OUT, which it can only do if it was there
    const airP = { conversational: 10, identity: 100, titles: 62, descriptions: 90, attributes: 92, taxonomy: 51, media: 100, ai: 47 };
    const feedDe = Object.assign({}, feed, { mkt: 'de', air: 74, airTier: 3, airP });
    const feedGb = Object.assign({}, feed, { air: 76, airTier: 3, airP: Object.assign({}, airP, { titles: 58 }) });
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      const j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': feedGb, 'Reiss|de': feedDe }, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
      if (u.includes('/api/labels/askdraft')) return j({ cfg: { to: {} }, asked: {} });
      return j({});
    };
    window.print = function () {};
  }, { ATTRS, QUALITY });
  };
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  await arm(page);

  await page.goto(PAGE);
  await page.waitForTimeout(1200);
  ok('the scorecard renders with a stored quality reading', await page.$('#qz-tier .qz-score') !== null);
  // the AM's screen keeps its tools — what the client documents drop must exist here first
  const live = await page.evaluate(() => ({
    heat: !!document.querySelector('#air-tier .heat-card'),
    rec: !!document.querySelector('#rec-tier'),
    dots: document.querySelectorAll('#air-tier .pillar .wdots').length,
    fillW: Array.from(document.querySelectorAll('#air-tier .pfill')).map((f) => f.style.width),
  }));
  ok('the live page shows the pillar heatmap (two analysed markets)', live.heat);
  ok('the live page shows the "Two scores, two questions" band', live.rec);
  ok('the live page shows a weight under every pillar', live.dots === 8, live.dots);
  ok('every pillar bar carries its width inline — the file with no scripts draws it too',
    live.fillW.length === 8 && live.fillW.every((w) => /^\d+%$/.test(w) && parseInt(w, 10) > 0), live.fillW);

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
      // the client documents are simpler than the AM's screen (Ray, 18 Sep 2026)
      heat: vis('.heat-card'), rec: vis('#rec-tier'), dots: vis('#air-tier .pillar .pf2'),
      fillPx: Array.from(document.querySelectorAll('#air-tier .pfill')).map((f) => f.getBoundingClientRect().width),
      fillAnim: Array.from(document.querySelectorAll('#air-tier .pfill')).map((f) => getComputedStyle(f).animationName),
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
  ok('the pillar heatmap stays out of the client document (Ray: "too complicated for multi-market clients")', !m.heat);
  ok('the "Two scores, two questions" band stays out of it', !m.rec);
  ok('the pillar weights stay out of it', !m.dots);
  ok('every pillar bar has a real width on paper', m.fillPx.length === 8 && m.fillPx.every((w) => w > 4), m.fillPx);
  ok('…and its grow-in animation stands down for the capture (html2canvas renders a fresh clone)',
    m.fillAnim.every((a) => a === 'none'), m.fillAnim);
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
      // the capture records WHAT it was handed: the PDF is the ⬇ HTML document on paper (Ray, 8 Oct 2026: "can the PDF
      // download format be adapted to latest update and ensure design is consistent?"), never the live page
      window.__h2c = [];
      window.html2canvas = (el) => { const d = el.ownerDocument;
        window.__h2c.push({ live: d === document, cls: d.body.className, closed: d.querySelectorAll('details:not([open])').length, det: d.querySelectorAll('details').length, depClosed: d.querySelectorAll('details.dep-more:not([open])').length, bodies: Array.from(d.querySelectorAll('details:not([open])')).filter((x) => Array.from(x.childNodes).some((n) => !(n.nodeType === 1 && n.tagName === 'SUMMARY'))).length, methOpen: d.querySelectorAll('details[open]').length,
          head: !!d.querySelector('#print-head .ph-brand, #print-head *'), dial: !!d.querySelector('svg.dial'), scripts: d.querySelectorAll('script').length,
          tip: d.querySelectorAll('.dptip,[data-deptip]').length, chrome: !!d.querySelector('.topbar:not([hidden])') && getComputedStyle(d.querySelector('.topbar')).display !== 'none',
          bg: getComputedStyle(d.body).backgroundColor, w: d.documentElement.clientWidth,
          ring: (() => { const c = d.querySelector('.big-ring svg.br-svg circle:last-child'); return c ? { dash: c.getAttribute('stroke-dasharray'), stroke: c.getAttribute('stroke'), bg: getComputedStyle(d.querySelector('.big-ring')).backgroundImage } : null; })() });
        return Promise.resolve({ width: 1220, height: 3000, toDataURL: () => 'data:image/jpeg;base64,AAAA' }); };
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
    const cap = await page.evaluate(() => ({ calls: window.__h2c, frames: document.querySelectorAll('iframe.pdf-render').length }));
    const c0 = (cap.calls || [])[0] || {};
    ok('the PDF is rasterised from the ⬇ HTML document, laid out apart from the live page — the same body classes, the header band with its dial, no script',
      cap.calls.length === 1 && c0.live === false && /\bxhtml\b/.test(c0.cls) && /\bxpaper\b/.test(c0.cls) && c0.dial && c0.scripts === 0 && !c0.chrome && c0.w === 1220, c0);
    ok('…its folds stand as the ⬇ HTML opens them — section methods open, attributes folded on their score — the depth explanations open, and the pop-up never travels',
      c0.det > 0 && c0.closed > 0 && c0.methOpen > 0 && c0.depClosed === 0 && c0.tip === 0, c0);
    ok('…and a fold left closed carries only its summary line (html2canvas would paint a closed fold\'s body over the next section)', c0.closed > 0 && c0.bodies === 0, c0);
    // Ray, 8 Oct 2026: "downloaded PDF still have this issue of this AI readiness circle" — a conic-gradient, which html2canvas
    // cannot paint, printed a grey disc; the ring is an SVG arc now, its colour a literal (a serialised SVG has no CSS variables)
    ok('the AI-readiness ring is an SVG arc with a literal colour — never a conic-gradient the rasteriser cannot paint',
      c0.ring && /^[\d.]+ 433\.54$/.test(c0.ring.dash) && Math.abs(parseFloat(c0.ring.dash) - 433.54 * 0.76) < 0.5 && !/var\(/.test(c0.ring.stroke) && c0.ring.bg === 'none' &&
      !/conic-gradient\(/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'FeedSpark_GoldenRecord.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), c0.ring);
    ok('…on the file\'s own wash page, and the render frame is cleared away after the save', c0.bg === 'rgb(247, 247, 245)' && cap.frames === 0, [c0.bg, cap.frames]);
  }

  // OPT-IN: the REAL libraries (GRPDF_LIBS=<dir holding html2canvas.min.js + jspdf.umd.min.js>), so a session can look at
  // the page jsPDF is handed (GRPDF_SHOT=<file.jpg>) — CI and most sandboxes cannot reach the CDN
  if (process.env.GRPDF_LIBS) {
    console.log('\n-- the real render (GRPDF_LIBS) --');
    const pr = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    await arm(pr);
    await pr.route('**/html2canvas.min.js', (r) => r.fulfill({ path: path.join(process.env.GRPDF_LIBS, 'html2canvas.min.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    await pr.route('**/jspdf.umd.min.js', (r) => r.fulfill({ path: path.join(process.env.GRPDF_LIBS, 'jspdf.umd.min.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
    await pr.addInitScript(() => { window.__printed = false; window.print = function () { window.__printed = true; };
      const iv = setInterval(() => { if (window.jspdf && window.jspdf.jsPDF && !window.jspdf.__w) { const J = window.jspdf.jsPDF; window.jspdf.__w = 1;
        window.jspdf.jsPDF = function (o) { const j = new J(o); const add = j.addImage.bind(j); j.addImage = function (u) { window.__img = u; window.__fmt = o.format; return add.apply(null, arguments); };
          j.save = function (n) { window.__pdfSaved = n; }; return j; }; clearInterval(iv); } }, 20); });
    await pr.goto(PAGE_W);
    await pr.waitForTimeout(1500);
    await pr.click('#det-pdf');
    await pr.waitForFunction(() => window.__pdfSaved || window.__printed, null, { timeout: 60000 }).catch(() => {});
    const rr = await pr.evaluate(() => ({ saved: window.__pdfSaved, printed: window.__printed, fmt: window.__fmt, len: (window.__img || '').length }));
    ok('the real libraries save a one-page PDF of the document (no print-dialog fallback)', !!rr.saved && !rr.printed && rr.fmt && rr.fmt[0] === 210 && rr.len > 20000, rr);
    if (process.env.GRPDF_SHOT && rr.len) { const b64 = (await pr.evaluate(() => window.__img)).split(',')[1]; fs.writeFileSync(process.env.GRPDF_SHOT, Buffer.from(b64, 'base64')); }
    await pr.close();
  }

  console.log('\n-- ⬇ HTML: the same document, self-contained, zero dialog --');
  {
    // the live editor is injected by the worker as an inline script (not a docs/ widget), so
    // its boot-time furniture is stood up here by hand: the ✎ handle, the "Send an element to
    // Claude Code" panel and the 💬 Feedback panel — the element Ray saw in the file he was
    // about to send a client
    const pageW = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    await arm(pageW);
    await pageW.goto(PAGE_W);
    await pageW.waitForTimeout(1500);
    await pageW.evaluate(() => {
      const mk = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; document.body.appendChild(d); };
      mk('de-handle', '✎'); mk('de-panel', 'Send an element to Claude Code'); mk('de-fbpanel', '💬 Feedback (0)');
      mk('de-bar', '✎ Edit'); mk('de-stalepanel', 'A note on your saved edits');
    });
    const seen = await pageW.evaluate(() => ({
      tky: !!document.getElementById('tky-fab'), chat: !!document.getElementById('fcc-fcb'),
      heat: !!document.querySelector('#air-tier .heat-card'), rec: !!document.querySelector('#rec-tier'),
    }));
    ok('the served page carries the Tachyon copilot, the Feed Chat bubble, the heatmap and the reconciliation band (so their absence below is a removal, not a no-op)',
      seen.tky && seen.chat && seen.heat && seen.rec, seen);
    const [download] = await Promise.all([
      pageW.waitForEvent('download'),
      pageW.click('#det-html'),
    ]);
    const tmp = require('path').join(os.tmpdir(), 'grhtml-' + Date.now() + '.html');
    await download.saveAs(tmp);
    await pageW.close();
    const html = fs.readFileSync(tmp, 'utf8');
    // GRPDF_KEEP=/path/to/file.html keeps the export for a visual pass
    if (process.env.GRPDF_KEEP) fs.copyFileSync(tmp, process.env.GRPDF_KEEP);
    // THE EXPORT, RENDERED (Ray, 21 Sep 2026: "the text on the downloaded html … is strangely
    // bigger than rest — can you mirror the same text size/font as rest of audit"): the inlined
    // pop-up prose must read at the pop-up's own 12.5px, never the browser's 16px default
    const pageX = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    await pageX.goto('file://' + tmp);
    await pageX.waitForTimeout(400);
    const type = await pageX.evaluate(() => {
      const fs = (el) => el ? getComputedStyle(el).fontSize : null;
      const q = (s) => document.querySelector(s);
      const probe = document.createElement('i'); probe.style.background = 'var(--wash)'; document.body.appendChild(probe);
      const wash = getComputedStyle(probe).backgroundColor; probe.remove();
      return {
        section: fs(q('.xd-wrap details.xd .xd-pop li')),           // the section headline's method
        pillar: fs(q('#air-tier .pillar details.xd .xd-pop li')),  // a pillar's card
        attr: fs(q('#qz-tier details.xd-q .xd-pop li')),           // an attribute's card
        row: fs(q('#qz-tier .qz-nm')),                             // the audit row it sits beside
        srcLink: fs(q('.xd-wrap details.xd .xd-pop .sc-src a')),
        rule: fs(q('#qz-tier details.xd-q .xd-pop .sc-rule .rl')),
        // THE POP-UP CARD, EXACTLY (Ray, 21 Sep 2026): its header sizes, the page's own wash
        title: fs(q('.xd-wrap details.xd > summary .xd-t')), num: fs(q('.xd-wrap details.xd > summary .xd-n')),
        attrTitle: (q('#qz-tier details.xd-q details.xd-in > summary .xd-t') || {}).textContent,
        chip: fs(q('#air-tier .pillar details.xd-chip > summary')),
        chipHead: !!q('#air-tier .pillar details.xd-chip .sc-h h3'),
        bodyBg: getComputedStyle(document.body).backgroundColor, wash,
        cardBg: q('.xd-wrap details.xd') ? getComputedStyle(q('.xd-wrap details.xd')).backgroundColor : null,
        refChips: document.querySelectorAll('.refseg .on').length, refButtons: document.querySelectorAll('.refseg button').length,
        refVisible: q('.refseg') ? getComputedStyle(q('.refseg')).display !== 'none' : false,
        dead: document.querySelectorAll('#pdp-last, #prof-edit').length,
      };
    });
    await pageX.close();
    ok('the inlined method reads at the pop-up\'s own 12.5px — section, pillar and attribute alike',
      type.section === '12.5px' && type.pillar === '12.5px' && type.attr === '12.5px', type);
    ok('…no larger than the audit row it sits beside', parseFloat(type.section) <= parseFloat(type.row) + 0.6, type);
    ok('…and its source links and rule rows too', type.srcLink && parseFloat(type.srcLink) <= 13 && type.rule && parseFloat(type.rule) <= 13, type);
    ok('each box wears the pop-up\'s header — 16px title, 22px score — on a white card',
      type.title === '16px' && type.num === '22px' && type.cardBg === 'rgb(255, 255, 255)', type);
    ok('an attribute\'s card is titled as its pop-up is ("g:title — content quality")', /^g:title — content quality$/.test(type.attrTitle || ''), type.attrTitle);
    ok('a pillar\'s card folds behind the tile\'s own 10.5px "how it’s scored" chip and carries the pop-up header inside',
      type.chip === '10.5px' && type.chipHead, type);
    ok('the page keeps the screen\'s wash background behind the cards', type.bodyBg === type.wash && type.wash !== 'rgb(255, 255, 255)', type);
    ok('the Δ reference reads as one static chip; the PDP-sample and profile buttons are gone',
      type.refVisible && type.refChips === 1 && type.refButtons === 0 && type.dead === 0, type);
    fs.unlinkSync(tmp);
    ok('downloads as .html, not .htm or extensionless', /\.html$/.test(download.suggestedFilename()), download.suggestedFilename());
    ok('starts with a doctype — opens correctly standalone', /^<!doctype html>/i.test(html));
    ok('carries no <script> — a static snapshot never calls the FCC\'s own APIs', !/<script/i.test(html));
    // `xhtml` joined the pair on 18 Sep 2026: the download rewrites its clone into <details>
    // disclosures (the file has no scripts, so a click-handler chevron does nothing) and that
    // layout needs its own scope — the PDF rasteriser must NOT pick it up, which is exactly what
    // a class only the HTML export sets buys us.
    ok('body is laid out chrome-free at natural size (pdf pdfshot), with the export\'s own xhtml scope',
      /<body class="pdf pdfshot xhtml"/.test(html), html.match(/<body[^>]*>/));
    ok('the branded header is baked in', /Golden Record scorecard/.test(html) && /Reiss/.test(html));
    ok('the scorecard content itself is present', /Required.{0,5}every product/.test(html));

    // THE CLIENT COPY (Ray, 18 Sep 2026: "Let's remove a few things so it's not too complicated
    // for the client to read … I'm sending this to my clients")
    console.log('\n-- ⬇ HTML: simpler than the AM\'s screen --');
    // 1. "Keep the content quality score description, but remove the weight"
    // the boxes wear the POP-UP's own titles — the interface, exactly (Ray, 21 Sep 2026)
    ok('the content-quality description is kept, under the pop-up\'s own titles', /Content quality — the headline/.test(html) &&
      /g:title — content quality/.test(html) && /g:description — content quality/.test(html));
    ok('every pillar keeps its "how it’s scored" chip and card', (html.match(/class="xd-pq"/g) || []).length === 8,
      (html.match(/class="xd-pq"/g) || []).length);
    ok('the AI-readiness headline keeps its description', /AI-readiness — the headline/.test(html));
    ok('no weight factor anywhere — no "weight ×", no ×1.6, no (×3)', !/weight ×/i.test(html) && !/×\d\.\d/.test(html) && !/\(×/.test(html),
      (html.match(/.{30}(weight ×|×\d\.\d|\(×).{20}/gi) || []).slice(0, 4));
    // the summary chip still carries the tier and the verdict on the two headlines — only a
    // weight is never written into it
    ok('no weight chip on a disclosure, no weight dots under a tile',
      !/class="xd-w">[^<]*weight/i.test(html) && !/class="wdots"/.test(html) && !/class="pf2"/.test(html),
      (html.match(/class="xd-w">[^<]*/g) || []));
    ok('no HTML comments — the injected layers\' own notes stay with the team', !/<!--/.test(html), (html.match(/<!--.{0,60}/g) || []).slice(0, 3));
    // 2. "show the scoring bars in green, yellow, and red, because now they're empty"
    const fills = (html.match(/<i class="pfill" style="width:(\d+)%;background:var\(--([a-z-]+)\)/g) || [])
      .map((s) => { const mm = s.match(/width:(\d+)%;background:var\(--([a-z-]+)\)/); return [+mm[1], mm[2]]; });
    const band = (s) => (s < 40 ? 'risk' : s < 60 ? 'orange-deep' : s < 80 ? 'orange' : 'good');
    ok('all eight pillar bars carry an inline width — never empty in a file with no scripts', fills.length === 8 && fills.every((f) => f[0] > 0), fills);
    ok('…coloured by the number\'s own band: green ≥80, amber 60–79, deep orange 40–59, red under 40',
      fills.length === 8 && fills.every((f) => f[1] === band(f[0])), fills);
    ok('the MASK bars carry their width inline too', /<i class="mf" style="width:\d+%;background:/.test(html));
    // 3. "Remove the pillar heat map for now; it's too complicated for multi-market clients"
    ok('the pillar heatmap is gone — removed, not hidden', !/heat-card/.test(html.replace(/<style[\s\S]*?<\/style>/g, '')) && !/Pillar heatmap/.test(html));
    // 4. 'remove the "two scores" question'
    ok('the "Two scores, two questions" band is gone', !/rec-tier/.test(html.replace(/<style[\s\S]*?<\/style>/g, '')) && !/Two scores, two questions/.test(html));
    // 5. "remove the element that sends code or feedback to Claude"
    const body = html.replace(/<style[\s\S]*?<\/style>/g, '');
    ok('the live editor is gone — handle, "Send an element to Claude Code" panel, Feedback panel, toolbar, saved-edits note',
      !/de-handle|de-panel|de-fbpanel|de-bar|de-stale/.test(body) && !/Claude Code/.test(html) && !/Feedback/.test(html) && !/note on your saved edits/.test(html));
    ok('the Tachyon copilot and the Feed Chat bubble are gone', !/tky-fab|tky-drawer|tky-scrim|fcc-fcb|fcc-fcp/.test(body) && !/Tachyon/.test(html));
    ok('the view-as pill, app switcher, nav customiser and ⓘ instruction toggles are gone',
      !/fcc-viewas|fcc-apps|fcc-navcz|instr-tgl|instr-hide/.test(body));
    ok('nothing in the file mentions Claude at all', !/Claude/.test(html), (html.match(/.{40}Claude.{40}/g) || []).slice(0, 3));
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
