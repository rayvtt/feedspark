#!/usr/bin/env node
/* Golden Record — CUSTOM LABEL STRATEGY (Ray, 8 Oct 2026: "within Golden Score, bring in custom labels as well … diverse,
   dynamic, and KPI-oriented … identify the strategy type, and score against it"). Renders the REAL /golden against a stubbed
   FCC whose Label Guard snapshot carries a performance label, a range-completion label, bare high/medium/low (margin, inferred),
   a gender label and an empty slot, with an older known-good where the performance label moved — then reads the section, its
   fold, the ⬇ HTML and the action plan's custom-label cards. (Fixture and stubs shared in shape with check_grplan.js.)

   Previously: the ACTION PLAN at the foot of the client documents (Ray, 8 Oct 2026: "since it is an audit, an action
   plan must be created and recommended to client after the audit is completed. At the bottom of the downloaded report,
   include an action plan in a workflow style, designed from the workflow module") — and NO OTHER BRAND IN THE REPORT
   (same day: "dont ever mention competitor brand in the report (just mention industry)").

   The plan exists only in the downloads, so this renders the REAL page against a stubbed FCC whose report market has a
   required field short of the spec, no identifiers, a recommended field worth points, a content rule Google states as a
   requirement and no conversational attributes — then opens the exported file and reads the plan off it, lane by lane.
   The estate carries a PEER brand in the same industry scoring higher, so the benchmark line has someone to name; the file
   must name nobody but the client.

   Run: NODE_PATH=$(npm root -g) node tools/check_grcl.js   (GRCL_SHOT=/path.png keeps a picture of the section)
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
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : '')); }
};

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin', 'mpn',
  'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category', 'product_type',
  'sale_price', 'additional_image_link', 'product_highlight', 'product_detail', 'material', 'pattern', 'size_type', 'size_system'];
const COV = { price: 92, gtin: null, mpn: null, material: 30, pattern: 100, sale_price: 100, product_highlight: 100, product_detail: 100 };
const rule = (n, pct) => ({ n, pct, eg: ['EXAMPLE TITLE'] });
const QUALITY = {
  t: Date.now(), client: 'Reiss', market: 'gb', rows: 1000,
  attrs: { title: { filled: 1000, cov: 100, avgLen: 58, minLen: 12, maxLen: 160, rules: { caps: rule(120, 12) } } },
  ai: { total: 61, tier: 3, tierLabel: 'Enriched', sampled: 1000, rows: 1000, pillars: [
    { key: 'identity', label: 'Identity & trust', score: 100, weight: 1.4 }, { key: 'titles', label: 'Title anatomy', score: 62, weight: 1.6 },
    { key: 'descriptions', label: 'Descriptions', score: 90, weight: 1.3 }, { key: 'attributes', label: 'Attribute completeness', score: 92, weight: 1.5 },
    { key: 'taxonomy', label: 'Taxonomy depth', score: 41, weight: 1.2 }, { key: 'media', label: 'Media richness', score: 100, weight: 1.0 },
    { key: 'conv', label: 'Conversational attributes', score: 0, weight: 2.4 }, { key: 'detail', label: 'Structured detail', score: 55, weight: 1.2 }] },
};


const L = (vals, cov) => ({ present: true, filled: vals.reduce((a, v) => a + v[1], 0), cov, distinct: vals.length, truncated: false, values: vals });
const LABELS = {
  custom_label_0: L([['Best Sellers', 300], ['Zombies', 400]], 70),
  custom_label_1: L([['RC 80%+', 600], ['RC <50%', 300]], 90),
  custom_label_2: L([['High', 300], ['Medium', 500], ['Low', 200]], 100),
  custom_label_3: L([['Womens', 600], ['Mens', 400]], 100),
  custom_label_4: { present: false } };
const REFL = JSON.parse(JSON.stringify(LABELS)); REFL.custom_label_0.values = [['Best Sellers', 400], ['Zombies', 300]];

async function open(browser, withLabels) {
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  await page.addInitScript(({ ATTRS, QUALITY, COV, LABELS, REFL, withLabels }) => {
    try { localStorage.removeItem('gr-tfold'); } catch (e) {}
    const NOW = Date.now(), cov = {}, attrs = {};
    ATTRS.forEach((k) => { const c = k in COV ? COV[k] : 100; cov[k] = c; attrs[k] = c == null ? { present: false } : { present: true, filled: c * 10, cov: c }; });
    const feeds = { 'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 80, ai: { n: 0, of: 6 }, cov, reqMissing: [] } };
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url), j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/labels/snapshot')) return j(withLabels
        ? { snapshot: { v: 1, t: NOW, client: 'Reiss', market: 'gb', rows: 1000, labels: LABELS }, baseline: { t: NOW - 7 * 864e5, rows: 1000, labels: REFL }, daily: null }
        : { snapshot: null, baseline: null, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      return j({});
    };
  }, { ATTRS, QUALITY, COV, LABELS, REFL, withLabels });
  await page.goto(PAGE);
  await page.waitForSelector('#det-html', { timeout: 15000 });
  await page.waitForFunction(() => { const t = document.getElementById('cl-tier'); return t && !/Reading the custom labels/.test(t.textContent); }, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { page, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const { page, errs } = await open(browser, true);

  console.log('-- the section on the scorecard');
  const s = await page.evaluate(() => {
    const t = document.getElementById('cl-tier');
    return { score: +(t.querySelector('.cl-score') || {}).textContent, pill: (t.querySelector('.qz-pill') || {}).textContent,
      parts: Array.from(t.querySelectorAll('.cl-parts span')).map((e) => e.textContent),
      slots: Array.from(t.querySelectorAll('.cl-slot')).map((e) => ({ n: e.querySelector('.cl-n').textContent, kind: e.querySelector('.cl-kind').textContent,
        mv: (e.querySelector('.cl-mv') || {}).textContent || '' })),
      strats: Array.from(t.querySelectorAll('.cl-st')).map((e) => ({ on: e.classList.contains('on'), t: e.querySelector('.cl-sh b').textContent, x: e.querySelector('.cl-sx').textContent })),
      after: !!(document.getElementById('qz-tier') && (document.getElementById('qz-tier').compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)),
      dial: document.querySelector('.gr-top').textContent };
  });
  ok('the strategy score is drawn with its verdict, after content quality', s.score > 0 && /KPI/.test(s.pill) && s.after, s);
  ok('the four parts are stated — strategies, diversity, reach, dynamism', s.parts.length === 4 && /Strategies 45\/60/.test(s.parts[0]) && /Diversity 15\/15/.test(s.parts[1]) && /Dynamism 5\/15/.test(s.parts[3]), s.parts);
  ok('five slots, CL0–CL4, each named by what its values mean', s.slots.length === 5 && s.slots.map((x) => x.n).join() === 'CL0,CL1,CL2,CL3,CL4', s.slots);
  ok('CL0 performance · CL1 stock & range completion · CL2 margin (inferred) · CL3 merchandising · CL4 not in feed',
    /Performance/.test(s.slots[0].kind) && /Stock/.test(s.slots[1].kind) && /Margin/.test(s.slots[2].kind) && /inferred/.test(s.slots[2].kind) &&
    /Merchandising/.test(s.slots[3].kind) && /not in feed/.test(s.slots[4].kind), s.slots.map((x) => x.kind));
  ok('the label that moved says how much; the ones that did not read static', /moved/.test(s.slots[0].mv) && /static/.test(s.slots[1].mv), s.slots.map((x) => x.mv));
  const on = s.strats.filter((x) => x.on).map((x) => x.t);
  ok('the six KPI strategies: performance, stock and margin carried', s.strats.length === 6 && on.length === 3 && /Performance/.test(on[0]), on);
  const price = s.strats.find((x) => /Price/.test(x.t));
  ok('a strategy not carried says what it would take', price && !price.on && /FeedHero rule/.test(price.x), price);
  ok('it never moves the Golden Score dial', !/Label strategy/.test(s.dial));
  if (process.env.GRCL_SHOT) await (await page.$('#cl-tier')).screenshot({ path: process.env.GRCL_SHOT });

  console.log('-- it folds like every section');
  await page.click('#cl-tier .tier-h h4');
  const f = await page.evaluate(() => { const t = document.getElementById('cl-tier'); const su = t.querySelector('.tf-sum');
    return { folded: t.classList.contains('folded'), sum: su && !su.hidden ? su.textContent : '', saved: localStorage.getItem('gr-tfold') || '' }; });
  ok('a click on its heading folds it, and the folded header keeps the score', f.folded && /\d/.test(f.sum) && /cl/.test(f.saved), f);
  await page.click('#cl-tier .tier-h h4');

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
  const tmp = path.join(os.tmpdir(), 'grcl_' + process.pid + '.html');
  fs.writeFileSync(tmp, html);
  const out = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await out.goto('file://' + tmp);
  await out.waitForTimeout(300);
  const x = await out.evaluate(() => {
    const t = document.getElementById('cl-tier');
    const cards = Array.from(document.querySelectorAll('#print-plan .ap-lane')).map((l) => Array.from(l.querySelectorAll('.ap-tk'))
      .filter((c) => /Custom labels/.test(c.querySelector('.ap-f').textContent)).map((c) => ({ own: c.querySelector('.ap-own').textContent, t: c.querySelector('.ap-t').textContent })));
    return { has: !!t && getComputedStyle(t).display !== 'none', slots: t ? t.querySelectorAll('.cl-slot').length : 0, cards };
  });
  ok('the client file carries the section, open', x.has && x.slots === 5, x);
  const thenCl = x.cards[2] || [];
  ok('the action plan proposes the strategies not carried — price band in Then, naming the free slot', thenCl.some((c) => /price band label \(CL\d is free for it\)/.test(c.t)), x.cards);
  ok('…and no card for a strategy already carried', !x.cards.flat().some((c) => /performance|stock|margin/i.test(c.t)), x.cards);
  await out.close(); fs.unlinkSync(tmp);
  ok('no page errors', errs.length === 0, errs);
  await page.close();

  console.log('-- a feed Label Guard has not read');
  const b = await open(browser, false);
  const e = await b.page.evaluate(() => document.getElementById('cl-tier').textContent);
  ok('says there is no reading yet — never a zero score', /No custom-label reading/.test(e) && !/Label strategy/.test(e), e.slice(0, 200));
  ok('no page errors', b.errs.length === 0, b.errs);

  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ Golden custom-label strategy: read off the values, scored in four stated parts, folded, in the download and the plan');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
