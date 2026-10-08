#!/usr/bin/env node
/* tools/check_grlock.js — THE GOLDEN RECORD ⬇ HTML, LOCKED TO THE CLIENT (Ray, 8 Oct 2026: "Shall we make the HTML download a bit
   more secure, so it will need the client email address to open the HTML to view it"; chosen: the whole client domain,
   encrypted, plus any @feedspark.com). Drives the real page: the dialog proposing the domain from /api/golden/readers, the
   download, then OPENS the downloaded file in a browser and types addresses at it — the client's, a subdomain, a second
   listed domain and FeedSpark open the full report; another domain and a look-alike do not; the file itself carries no
   domain, no address and none of the report's text.
   Run: NODE_PATH=$(npm root -g) node tools/check_grlock.js      (in presync; CI has no browsers) */
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
  const errs = [];
  const open = async (readers) => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 }, acceptDownloads: true });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
    await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
    await page.addInitScript(({ ATTRS, QUALITY, readers }) => {
      const NOW = Date.now(), cov = {}, attrs = {};
      ATTRS.forEach((k, i) => { cov[k] = 100 - (i % 7) * 4; attrs[k] = { present: true, filled: 900, cov: cov[k] }; });
      const feed = { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 88, ai: { n: 0, of: 6 }, cov, reqMissing: [] };
      const real = window.fetch.bind(window);
      window.__readerCalls = [];
      window.fetch = (url, opts) => {
        const u = String(url), j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
        if (/engine\.js/.test(u)) return real(url, opts);
        if (u.includes('/api/golden/readers')) { window.__readerCalls.push(u); return j(readers); }
        if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': feed }, alerts: {} });
        if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
        if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
        return j({});
      };
    }, { ATTRS, QUALITY, readers });
    await page.goto(PAGE + '?client=Reiss&market=gb');
    await page.waitForSelector('#det-html', { timeout: 15000 });
    await page.waitForTimeout(600);
    return page;
  };

  console.log('-- the lock dialog (Ray, 8 Oct 2026: "make the HTML download a bit more secure, so it will need the client email address to open") --');
  const page = await open({ client: 'Reiss', domains: [{ d: 'reiss.com', src: 'tickets', n: 12 }], staff: 'feedspark.com' });
  await page.click('#det-html');
  await page.waitForSelector('#lock-dlg .lock-box', { timeout: 15000 });
  await page.waitForFunction(() => /ticket/.test((document.getElementById('lock-src') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const d0 = await page.evaluate(() => ({ v: document.getElementById('lock-in').value, src: document.getElementById('lock-src').textContent,
    sub: document.querySelector('.lock-sub').textContent, calls: window.__readerCalls, r: (() => { const b = document.querySelector('.lock-box').getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom, innerWidth, innerHeight]; })() }));
  ok('⬇ HTML asks first: a dialog proposes the client\'s domain (read for this brand) and says where it came from', d0.v === 'reiss.com' && /12 ticket messages/.test(d0.src) && /client=Reiss/.test(d0.calls[0] || '') && /@feedspark\.com/.test(d0.sub), d0);
  ok('…on screen', d0.r[0] >= 0 && d0.r[1] <= d0.r[4] && d0.r[2] >= 0 && d0.r[3] <= d0.r[5], d0.r);
  await page.keyboard.press('Escape');
  ok('Esc closes it without a download', await page.evaluate(() => !document.getElementById('lock-dlg')));
  await page.click('#det-html');
  await page.waitForSelector('#lock-in');
  await page.fill('#lock-in', '');
  await page.click('#lock-go');
  ok('an empty domain list is refused — without one only FeedSpark could open the file', await page.evaluate(() => /Add the client/.test(document.getElementById('lock-src').textContent) && !!document.getElementById('lock-dlg')));
  await page.fill('#lock-in', 'Reiss.com, https://www.reissmail.co.uk/x');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#lock-go')]);
  const tmp = path.join(os.tmpdir(), 'grlock-' + Date.now() + '.html');
  await dl.saveAs(tmp);
  const file = fs.readFileSync(tmp, 'utf8');
  ok('the file is named as before and the dialog closes', /^FeedSpark_GoldenRecord_Reiss_GB_\d{4}-\d{2}-\d{2}\.html$/.test(dl.suggestedFilename()) && await page.evaluate(() => !document.getElementById('lock-dlg')), dl.suggestedFilename());
  ok('the edit is remembered for this brand on this device', await page.evaluate(() => JSON.parse(localStorage.getItem('gr-lock') || '{}').Reiss.join() === 'reiss.com,reissmail.co.uk'));
  ok('the file carries ciphertext only — no domain, no address, none of the scorecard', !/reiss\.com|reissmail|feedspark\.com/i.test(file.replace(/fonts\.googleapis\.com/g, '')) &&
    !/product_highlight|Recommended|Golden Score|print-mkts/.test(file) && /"ct":"[A-Za-z0-9+/=]{2000,}"/.test(file) && (file.match(/"w":"/g) || []).length === 3, { len: file.length, slots: (file.match(/"w":"/g) || []).length });

  console.log('-- opening the file');
  const tryOpen = async (email) => {
    const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const perr = []; p.on('pageerror', (e) => perr.push(e.message));
    await p.goto('file://' + tmp);
    await p.fill('#lk-e', email);
    await p.click('#lk-b');
    await p.waitForFunction(() => !document.getElementById('lk-f') || /only available|full work email/.test((document.getElementById('lk-m') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
    const r = await p.evaluate(() => ({ locked: !!document.getElementById('lk-f'), msg: (document.getElementById('lk-m') || {}).textContent || '',
      report: !!document.querySelector('.tier') && /Recommended/.test(document.body.textContent), mkts: !!document.getElementById('print-head'), title: document.title }));
    r.errs = perr; await p.close(); return r;
  };
  const shell = await (async () => { const p = await browser.newPage({ viewport: { width: 390, height: 844 } }); await p.goto('file://' + tmp);
    const r = await p.evaluate(() => ({ title: document.title, h1: document.querySelector('h1').textContent, w: document.querySelector('.lk').getBoundingClientRect().width, sw: document.documentElement.scrollWidth })); await p.close(); return r; })();
  ok('the locked file opens on a FeedSpark card naming the report — and fits a phone', /Golden Record — Reiss GB/.test(shell.title) && /Golden Record — Reiss GB/.test(shell.h1) && shell.w <= 390 && shell.sw <= 390, shell);
  const bad = await tryOpen('someone@gmail.com');
  ok('an address at another domain does not open it — and is told so', bad.locked && !bad.report && /only available to its client team and FeedSpark/.test(bad.msg), bad);
  const near = await tryOpen('jane@notreiss.com');
  ok('…nor a look-alike domain', near.locked && !near.report, near);
  const cli = await tryOpen('Jane.Doe@Reiss.com');
  ok('an address at the client domain opens the full report (any case)', !cli.locked && cli.report && cli.mkts && cli.errs.length === 0, cli);
  const sub = await tryOpen('jane@uk.reiss.com');
  ok('…and at a subdomain of it', !sub.locked && sub.report, sub);
  const second = await tryOpen('a@reissmail.co.uk');
  ok('every domain the AM listed opens it', !second.locked && second.report, second);
  const staff = await tryOpen('ray@feedspark.com');
  ok('any @feedspark.com opens it, so the AM can check it before sending', !staff.locked && staff.report, staff);
  fs.unlinkSync(tmp);

  console.log('-- no domain found');
  const p2 = await open({ client: 'Reiss', domains: [], staff: 'feedspark.com' });
  await p2.evaluate(() => localStorage.removeItem('gr-lock'));
  await p2.click('#det-html');
  await p2.waitForFunction(() => /No client domain found/.test((document.getElementById('lock-src') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok('with no domain on record the dialog says so and asks for it, never guessing silently', await p2.evaluate(() => /No client domain found/.test(document.getElementById('lock-src').textContent) && document.getElementById('lock-in').value === ''));
  const p3 = await open({ client: 'Reiss', domains: [{ d: 'agency.com', src: 'guess', n: 5 }], staff: 'feedspark.com' });
  await p3.click('#det-html');
  await p3.waitForFunction(() => /guess/i.test((document.getElementById('lock-src') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  ok('a guessed domain is labelled a guess to check', await p3.evaluate(() => /A guess — check it/.test(document.getElementById('lock-src').textContent)));

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ Golden ⬇ HTML lock: ' + fail + ' failed' : '\n✓ Golden ⬇ HTML lock: the client domain + FeedSpark open it, nothing else does, and the file holds no domain or report text');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
