#!/usr/bin/env node
/* Golden Record ⬇ HTML tripwire (Ray, 18 Sep 2026: "allow the HTML file downloaded to be
   expandable and collapsible on every sections (content quality and AI-Readiness) so my client
   can read the scoring logic and the detail of each content quality scoring. Please remove the
   Scoring section bottom from every HTML download.")

   The download is the page cloned with every <script> removed, which is what makes it a safe
   self-contained file — and also what made it a dead one: every chevron and every ⓘ Scoring logic
   button was wired to a click handler that no longer exists, so the scoring logic a client is
   being asked to trust was unreachable, and the row detail behind a folded attribute was not even
   in the file.

   So the export now rewrites the clone: <details>/<summary> (native, no JS), the scoring prose
   inlined from the SAME builders the on-screen pop-ups use, and the injected FCC layers — the
   editor toolbar, the Shipped handle, presence, the EN/VI pill, the hours dots — stripped, since
   they arrive as dead furniture on a client-facing document.

   This renders the REAL exported file in a browser and toggles it, rather than trusting the string.

   Run: NODE_PATH=$(npm root -g) node tools/check_grhtml.js
*/
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) {
  console.log('· playwright unavailable — skipped'); process.exit(0);
}

const PAGE = 'file://' + path.resolve(__dirname, '..', 'docs', 'FeedSpark_GoldenRecord.html');
const ENGINE_LG = path.resolve(__dirname, '..', 'docs', 'labelguard_engine.js');
const ENGINE_FA = path.resolve(__dirname, '..', 'docs', 'feedlab_engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); }
};

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin',
  'mpn', 'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category',
  'product_type', 'sale_price', 'additional_image_link', 'product_highlight', 'product_detail', 'material',
  'pattern', 'size_type', 'size_system', 'question_and_answer', 'document_link', 'related_product',
  'item_group_title', 'variant_option', 'popularity_rank'];
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
  ai: {
    total: 76, tier: 3, tierLabel: 'Enriched', sampled: 1000, rows: 1000,
    pillars: [
      { key: 'identity', label: 'Identity & trust', score: 100, weight: 1.4, summary: 'GTIN, brand, price, availability all present' },
      { key: 'titles', label: 'Title anatomy', score: 62, weight: 1.6, summary: 'avg 60 chars — MASK window is 80–120' },
      { key: 'descriptions', label: 'Descriptions', score: 90, weight: 1.3, summary: '100% coverage, avg 359 chars' },
      { key: 'attributes', label: 'Attribute completeness', score: 92, weight: 1.5, summary: 'pattern 27%, rest strong' },
      { key: 'taxonomy', label: 'Taxonomy depth', score: 51, weight: 1.2, summary: 'GPC 100%, product_type deep on 24%' },
      { key: 'media', label: 'Media richness', score: 100, weight: 1.0, summary: 'multi-angle imagery on most items' },
      { key: 'detail', label: 'Structured detail', score: 69, weight: 1.2, summary: 'highlights shallow' },
      { key: 'conv', label: 'Conversational attributes', score: 12, weight: 2.4, summary: '0 of 6 live' },
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
      const absent = i > 19 && i % 3 === 0;
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
    /* the injected FCC layers, faked so the export has something real to strip — on the live
       worker they are appended to every app page and cloned into the download with the rest */
    window.addEventListener('DOMContentLoaded', () => {
      const add = (tag, id, cls, txt) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; e.textContent = txt || 'x'; document.body.appendChild(e); };
      add('div', null, 'de-bar', '✎ Edit 🎨 Design 💬 Feedback 📄 Present ↺ Undo 🧹 Reset page');
      add('div', 'fcc-ship-h', null, 'Shipped');
      add('div', 'fcc-ship', null, 'shipped panel');
      add('div', 'fcc-presence', null, 'RV');
      add('button', 'lang-tgl', null, 'EN');
      add('div', 'fcc-hrs', null, 'hours');
      add('i', null, 'fh-dot', '');
    });
  }, { ATTRS, QUALITY });

  await page.goto(PAGE);

  await page.waitForTimeout(1400);
  ok('the scorecard renders with a stored quality reading', await page.$('#qz-tier .qz-score') !== null);
  ok('the injected layers are on the page, so the export has something to strip', await page.$('.de-bar') !== null);

  // every quality row starts FOLDED, which is the state that used to export an empty chevron
  const openBefore = await page.$$eval('.qz-det', (e) => e.length);
  ok('the attribute rows start folded on screen', openBefore === 0, openBefore);

  /* grab the exported file: HTML, so reading the blob as text is exact */
  await page.evaluate(() => {
    window.__html = null; window.__grthrow = '';
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { b.text().then((t) => { window.__html = t; }); return real(b); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.click('#det-html');
  await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
  const html = await page.evaluate(() => window.__html);
  const threw = await page.evaluate(() => window.__grthrow);
  ok('the export transform ran clean', !threw, threw);
  ok('the export produced a document', /^<!doctype html>/i.test(html), html.slice(0, 40));

  /* --- the live page is put back exactly as it was --- */
  await page.waitForTimeout(400);
  ok('and the page it was taken from is left folded as it was',
    (await page.$$eval('.qz-det', (e) => e.length)) === openBefore);
  ok('with its Scoring logic buttons still there for the AM',
    (await page.$$eval('[data-qinfo], [data-scpop]', (e) => e.length)) > 0);

  /* --- the string: only what cannot be asserted on the DOM --- */
  ok('no script survives in it', !/<script/i.test(html));

  /* everything else is asserted on the RENDERED file below, never on the raw text: the page's
     own stylesheet legitimately NAMES these selectors in its body.pdf hide list, so a substring
     check would fail on the very CSS that does the hiding. */

  /* --- render the real file and use it --- */
  const tmp = path.join(os.tmpdir(), 'gr_export_' + process.pid + '.html');
  fs.writeFileSync(tmp, html);
  const out = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const oerr = [];
  out.on('pageerror', (e) => oerr.push(e.message));
  await out.goto('file://' + tmp);
  await out.waitForTimeout(500);

  const dets = await out.$$eval('details.xd', (e) => e.length);
  ok('the download is built from disclosures', dets >= 5, dets);

  /* nothing that needs JavaScript is left in a file that has none */
  const left = await out.evaluate(() => {
    const seen = (sel) => [...document.querySelectorAll(sel)].filter((e) => getComputedStyle(e).display !== 'none').length;
    return {
      qinfo: document.querySelectorAll('[data-qinfo]').length,
      scpop: document.querySelectorAll('[data-scpop]').length,
      logic: [...document.querySelectorAll('button')].filter((b) => /Scoring logic/.test(b.textContent)).length,
      chrome: ['.de-bar', '.de-dot', '#fcc-ship', '#fcc-ship-dim', '#fcc-ship-h', '#fcc-presence',
        '#lang-tgl', '#fcc-hrs', '.fh-dot', '#theme-tgl', '#fcc-mall', '.fcc-mpan', '#scm']
        .reduce((n, s2) => n + document.querySelectorAll(s2).length, 0),
      chromeVisible: ['.de-bar', '#fcc-ship-h', '#fcc-presence', '#lang-tgl'].reduce((n, s2) => n + seen(s2), 0),
      editor: [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && /Reset page/.test(e.textContent)).length,
    };
  });
  ok('no ⓘ Scoring logic button survives — it was a door to a pop-up no script can open', left.logic === 0, left.logic);
  ok('nor any handler hook left to click', left.qinfo === 0 && left.scpop === 0, left);
  ok('and every injected FCC layer is stripped, not merely hidden', left.chrome === 0, left.chrome);
  ok('so nothing of the editor toolbar reaches a client-facing document', left.editor === 0, left.editor);

  /* content quality: one per analysed attribute, each carrying its detail AND its scoring logic */
  const qKeys = Object.keys(QUALITY.attrs);
  for (const key of qKeys) {
    const has = await out.evaluate((k) => {
      const rows = [...document.querySelectorAll('details.xd-q > summary')];
      const r = rows.find((x) => /g:\s*$/.test('') || x.textContent.indexOf(k) >= 0);
      if (!r) return null;
      const d = r.parentElement, body = d.querySelector(':scope > .xd-b');
      const kids = body ? [...body.children] : [];
      return { open: d.open, detail: !!d.querySelector('.qz-det'), logic: !!d.querySelector('details.xd-in'),
        detailInBody: !!(body && body.querySelector('.qz-det')),
        detailInSummary: !!r.querySelector('.qz-det'),
        logicFirst: kids.length > 1 && kids[0].matches('details.xd-in'),
        acts: d.querySelectorAll('.qz-act, [data-qask], [data-qbrief]').length };
    }, key);
    ok('g:' + key + ' is a disclosure carrying its rule detail and its scoring logic',
      !!has && has.detail && has.logic, has);
    /* the trap: .qz-det is a CHILD of .qz-row, not its sibling, so a naive "move the row's
       children into the summary" buries the whole findings block inside the summary - the row
       then looks expandable and expands to nothing */
    ok('and its findings sit in the body, never inside the summary',
      !!has && has.detailInBody && !has.detailInSummary, has);
    ok('with the scoring logic first, then what was found', !!has && has.logicFirst, has);
  }
  ok('and the rule wording Google states is in the file', /requirement|best practice/.test(html));
  ok('no internal Ask-client / Brief button rides along in a client\'s file',
    (await out.$$eval('.qz-act, [data-qask], [data-qbrief], .det-actions', (e) => e.length)) === 0);

  /* the two section headlines */
  const secs = await out.$$eval('details.xd', (e) => e.map((x) => (x.querySelector('summary') || {}).textContent || ''));
  // the boxes wear the pop-up's own titles (Ray, 21 Sep 2026: "follow the audit golden score
  // interface exactly for the download")
  ok('the content-quality method is readable under its section, titled as its pop-up is',
    secs.some((t) => /Content quality — the headline/.test(t)), secs.slice(0, 8));
  ok('the AI-readiness method is readable under its section, titled as its pop-up is',
    secs.some((t) => /AI-readiness — the headline/.test(t)), secs.slice(0, 8));
  ok('and both carry their prose, not just a heading',
    /Coverage says an attribute is there/.test(html) && /weighted/.test(html));

  /* every pillar explains its own number */
  const pills = await out.$$eval('.pillar', (e) => e.map((p) => !!p.querySelector('details.xd')));
  ok('every AI-readiness pillar carries how it is scored', pills.length >= 8 && pills.every(Boolean),
    pills.length + ' pillars, ' + pills.filter(Boolean).length + ' with logic');

  /* IT ACTUALLY OPENS AND CLOSES — the whole point, in a file with no JavaScript */
  const sel = 'details.xd-q';
  const first = await out.$(sel + ' > summary');
  const h0 = await out.$eval(sel, (d) => { d.open = false; return d.getBoundingClientRect().height; });
  await first.click();
  await out.waitForTimeout(150);
  const h1 = await out.$eval(sel, (d) => d.getBoundingClientRect().height);
  ok('clicking an attribute opens it, with no script in the file', h1 > h0 + 20, { closed: h0, open: h1 });
  await first.click();
  await out.waitForTimeout(150);
  const h2 = await out.$eval(sel, (d) => d.getBoundingClientRect().height);
  ok('and clicking again folds it back', Math.abs(h2 - h0) < 3, { closed: h0, again: h2 });

  const sl = await out.$('details.xd:not(.xd-q) > summary');
  const s0 = await out.$eval('details.xd:not(.xd-q)', (d) => { d.open = false; return d.getBoundingClientRect().height; });
  await sl.click();
  await out.waitForTimeout(150);
  const s1 = await out.$eval('details.xd:not(.xd-q)', (d) => d.getBoundingClientRect().height);
  ok('the scoring-logic disclosures open too', s1 > s0 + 20, { closed: s0, open: s1 });

  ok('the exported file throws nothing', oerr.length === 0, oerr);
  try { fs.unlinkSync(tmp); } catch (e) {}

  if (errs.length) ok('the page threw nothing while exporting', false, errs);
  await browser.close();
  console.log(fail ? '\n✗ Golden Record HTML export: ' + fail + ' check(s) failed' : '\n✓ Golden Record HTML export — readable, foldable, and free of dead chrome');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('✗ check_grhtml crashed: ' + e.message); process.exit(1); });
