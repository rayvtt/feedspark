#!/usr/bin/env node
/* Golden Record — the ACTION PLAN at the foot of the client documents (Ray, 8 Oct 2026: "since it is an audit, an action
   plan must be created and recommended to client after the audit is completed. At the bottom of the downloaded report,
   include an action plan in a workflow style, designed from the workflow module") — and NO OTHER BRAND IN THE REPORT
   (same day: "dont ever mention competitor brand in the report (just mention industry)").

   The plan exists only in the downloads, so this renders the REAL page against a stubbed FCC whose report market has a
   required field short of the spec, no identifiers, a recommended field worth points, a content rule Google states as a
   requirement and no conversational attributes — then opens the exported file and reads the plan off it, lane by lane.
   The estate carries a PEER brand in the same industry scoring higher, so the benchmark line has someone to name; the file
   must name nobody but the client.

   Run: NODE_PATH=$(npm root -g) node tools/check_grplan.js   (GRPLAN_SHOT=/path.png keeps a picture of the plan)
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

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  await page.addInitScript(({ ATTRS, QUALITY, COV }) => {
    const NOW = Date.now(), cov = {}, attrs = {};
    ATTRS.forEach((k) => {
      const c = k in COV ? COV[k] : 100;
      cov[k] = c; attrs[k] = c == null ? { present: false } : { present: true, filled: c * 10, cov: c };
    });
    const peerCov = {}; ATTRS.forEach((k) => { peerCov[k] = 100; });
    const feeds = {
      'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 80, ai: { n: 0, of: 6 }, cov, reqMissing: [] },
      'Superdry|gb': { client: 'Superdry', mkt: 'gb', status: 'ok', t: NOW, rows: 900, score: 97, ai: { n: 0, of: 6 }, cov: peerCov, reqMissing: [] },
      'Monsoon|gb': { client: 'Monsoon', mkt: 'gb', status: 'ok', t: NOW, rows: 800, score: 85, ai: { n: 0, of: 6 }, cov: peerCov, reqMissing: [] },
    };
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url), j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      return j({});
    };
  }, { ATTRS, QUALITY, COV });
  await page.goto(PAGE);
  await page.waitForSelector('#det-html', { timeout: 15000 });
  await page.waitForTimeout(900);

  console.log('-- on screen');
  const scr = await page.evaluate(() => ({ plan: !!document.getElementById('print-plan'),
    shown: (() => { const e = document.getElementById('print-plan'); return e && getComputedStyle(e).display !== 'none'; })(),
    text: document.body.innerText }));
  ok('the plan never paints on the AM\'s screen — the downloads carry it', scr.plan && !scr.shown, scr.shown);
  const bench = (scr.text.match(/Industry benchmark[^\n]*/) || [''])[0];
  ok('the industry benchmark on screen names the industry, never the brand that leads it', /Industry benchmark — Fashion/.test(bench) && !/Superdry|Reiss|Monsoon/.test(bench), bench);

  console.log('-- the ⬇ HTML');
  await page.evaluate(() => {
    window.__html = null; window.__grPlainExport = true;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { b.text().then((t) => { window.__html = t; }); return real(b); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.click('#det-html');
  await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
  const html = await page.evaluate(() => window.__html);
  if (process.env.GRPLAN_KEEP) fs.writeFileSync(process.env.GRPLAN_KEEP, html);
  ok('the file names no other brand — not in the benchmark, not anywhere', !/Superdry|Monsoon/.test(html), (html.match(/.{40}(Superdry|Monsoon).{40}/) || [])[0]);
  const tmp = path.join(os.tmpdir(), 'grplan_' + process.pid + '.html');
  fs.writeFileSync(tmp, html);
  const out = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await out.goto('file://' + tmp);
  await out.waitForTimeout(400);
  const r = await out.evaluate(() => {
    const pp = document.getElementById('print-plan');
    const lanes = pp ? Array.from(pp.querySelectorAll('.ap-lane')).map((l) => ({
      h: l.querySelector('.ap-lh').innerText,
      cards: Array.from(l.querySelectorAll('.ap-tk')).map((c) => ({ f: c.querySelector('.ap-f').innerText, own: c.querySelector('.ap-own').innerText,
        gain: (c.querySelector('.ap-gain') || {}).innerText || '', t: c.querySelector('.ap-t').innerText })) })) : [];
    const after = (a, b) => { const x = document.getElementById(a), y = document.getElementById(b); return !!(x && y && (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)); };
    const kp = pp ? Array.from(pp.querySelectorAll('.ap-k div')).map((d) => d.innerText.replace(/\s+/g, ' ')) : [];
    return { has: !!pp && pp.innerHTML.length > 0, shown: pp && getComputedStyle(pp).display !== 'none', lanes, kp,
      flow: pp ? pp.querySelectorAll('.ap-flow').length : -1, more: pp ? pp.querySelectorAll('.ap-more').length : -1,
      note: pp ? pp.querySelectorAll('.pm-note').length : -1,
      last: after('print-mkts', 'print-plan') && after('print-plan', 'print-foot') };
  });
  ok('the plan is in the file and shows, after every market\'s scores and before the footer', r.has && r.shown && r.last, { has: r.has, shown: r.shown, last: r.last });
  // the next quarter, month by month (Ray, 8 Oct 2026: "divide into months into the next quarter … adding all actions … remove
  // the progress status"): the three calendar months after this one, every action on the board, no status strip, no footnote
  const MN = [1, 2, 3].map((i) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + i, 1).toLocaleDateString('en-GB', { month: 'long' }); });
  ok('no workflow status strip, no "+N more", no footnote', r.flow === 0 && r.more === 0 && r.note === 0, { flow: r.flow, more: r.more, note: r.note });
  ok('three lanes — the next three calendar months (' + MN.join(' / ') + ')', r.lanes.length === 3 && r.lanes.every((l, i) => l.h.indexOf(MN[i]) === 0), r.lanes.map((l) => l.h));
  const all = r.lanes.flatMap((l) => l.cards), m1 = (r.lanes[0] || { cards: [] }).cards;
  const tot = +((r.kp[0] || '').match(/\d+/) || [0])[0];
  ok('every action is on the board — the lanes add up to the Actions figure', all.length === tot && all.length >= 6, { cards: all.length, kpi: tot });
  const ix = (f) => all.findIndex(f);
  const price = all.find((c) => c.f === 'g:price'), gtin = all.find((c) => c.f === 'g:gtin'), title = all.find((c) => c.f === 'g:title');
  ok('the required field short of the spec, owned by the client, with the points it is worth — in the first month', price && m1.indexOf(price) >= 0 && /Your team/.test(price.own) && /^\+\d/.test(price.gain), price);
  ok('the missing identifiers — the client\'s to send, never generated', gtin && /Your team/.test(gtin.own) && /GTIN/.test(gtin.t), gtin);
  ok('the content rule Google states as a requirement, FeedSpark\'s to fix', title && /FeedSpark/.test(title.own) && /capital letters/.test(title.t), title);
  const mat = all.find((c) => c.f === 'g:material');
  ok('the recommended field worth points, FeedSpark\'s, after the requirements', mat && /FeedSpark/.test(mat.own) && /^\+\d/.test(mat.gain) && ix((c) => c === mat) > ix((c) => c === title), mat);
  const conv = ix((c) => /conversational attributes/i.test(c.t)), tax = ix((c) => /taxonomy depth \(41/.test(c.t));
  ok('the AI-readiness work comes last — conversational attributes and the weakest area', conv > ix((c) => c === mat) && tax > ix((c) => c === mat), all.map((c) => c.t));
  ok('a field already at full coverage is never an action', !all.some((c) => c.f === 'g:pattern' || c.f === 'g:sale_price'), all.map((c) => c.f));
  const proj = (r.kp[3] || '').match(/([\d.]+)\s*→\s*([\d.]+)/);
  ok('the KPI band states the Golden Score now and after the quarter — a projection higher than today', proj && +proj[2] > +proj[1], r.kp);
  if (process.env.GRPLAN_SHOT) await (await out.$('#print-plan')).screenshot({ path: process.env.GRPLAN_SHOT });
  await out.setViewportSize({ width: 390, height: 844 });
  await out.waitForTimeout(150);
  const ph = await out.evaluate(() => { const b = document.querySelector('#print-plan .ap-board'); return b ? getComputedStyle(b).gridTemplateColumns.split(' ').length : 0; });
  ok('on a phone the lanes stack in one column', ph === 1, ph);
  await out.close(); fs.unlinkSync(tmp);

  console.log('-- the ⬇ PDF');
  await page.evaluate(() => {
    window.__cap = null;
    window.html2canvas = (el) => { const d = el.ownerDocument;
      if (d !== document && !window.__cap) { const pp = d.getElementById('print-plan');
        window.__cap = { lanes: pp ? pp.querySelectorAll('.ap-lane').length : 0, shown: pp ? d.defaultView.getComputedStyle(pp).display !== 'none' : false, text: d.body.textContent }; }
      return Promise.resolve({ width: 1220, height: 3000, toDataURL: () => 'data:image/jpeg;base64,AAAA' }); };
    window.jspdf = { jsPDF: function () { this.addImage = () => {}; this.save = () => { window.__pdfdone = true; }; } };
  });
  await page.click('#det-pdf');
  await page.waitForFunction(() => window.__pdfdone === true, null, { timeout: 20000 }).catch(() => {});
  const cap = await page.evaluate(() => window.__cap);
  ok('the PDF carries the same plan, shown', cap && cap.lanes === 3 && cap.shown, cap && { lanes: cap.lanes, shown: cap.shown });
  ok('…and names no other brand either', cap && !/Superdry|Monsoon/.test(cap.text));

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ Golden action plan: read off the audit, the next quarter month by month, at the foot of both downloads — and no other brand named');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
