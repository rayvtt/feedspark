#!/usr/bin/env node
/* Golden Record "Scan whole estate" tripwire (Ray, 17 Sep 2026: "scan whole estate > will
   also scan content quality too for all estate").

   The estate rescan button already force-rescanned every feed's score/labels/product
   types/attribute coverage (the worker's gviz pass), but left content quality to per-feed
   manual "Analyse Content Quality" clicks — a freshly rescanned estate could still show
   stale or missing quality readings. Each feed in the loop now gets BOTH passes: the
   existing /api/golden/scan POST, then qualityRun() (the SAME in-browser stream + PUT the
   per-feed button uses). This renders the REAL page through Chromium, stubs the feed
   stream + both write endpoints, and asserts every feed gets both calls, one feed's
   quality-scan failure doesn't halt the estate run, and the final message names both passes.

   Run: NODE_PATH=$(npm root -g) node tools/test_grscanall.mjs
*/
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  // a tiny real CSV feed so qualityRun's stream genuinely completes
  await page.route('**/api/feed/proxy*', (r) => r.fulfill({
    contentType: 'text/csv', headers: { 'x-feed-bytes': '40' },
    body: 'id,title,description,link,image_link,availability,price\n1,Product One,A description here.,https://x.com/1,https://x.com/1.jpg,in stock,10.00 GBP\n',
  }));

  const calls = { scan: [], quality: [] };
  await page.route('**/api/golden/scan*', (r) => {
    const u = new URL(r.request().url());
    calls.scan.push(u.searchParams.get('client') + '|' + u.searchParams.get('market'));
    r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  // GET (the stored reading, read on select/boot) and PUT (qualityRun's own save) share this
  // path — only the PUT is "a content-quality scan ran"; conflating the two would count the
  // page's own unrelated boot-time read as if scan-all had triggered it
  await page.route('**/api/golden/quality*', (r) => {
    if (r.request().method() !== 'PUT') return r.fulfill({ contentType: 'application/json', body: '{"quality":{}}' });
    const u = new URL(r.request().url());
    const k = u.searchParams.get('client') + '|' + u.searchParams.get('market');
    calls.quality.push(k);
    // the SECOND feed's quality write fails — the estate run must not stop because of it
    if (k === 'Monsoon|gb') return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.addInitScript(() => {
    const NOW = Date.now();
    const feeds = {
      'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1, score: 90, ai: { n: 0, of: 6 }, cov: {}, reqMissing: [] },
      'Monsoon|gb': { client: 'Monsoon', mkt: 'gb', status: 'ok', t: NOW, rows: 1, score: 80, ai: { n: 0, of: 6 }, cov: {}, reqMissing: [] },
    };
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      const j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u) || u.includes('/api/feed/proxy') || u.includes('/api/golden/scan') || u.includes('/api/golden/quality')) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      // a real (non-null) snapshot — boot's own "no data yet, scan automatically" behaviour
      // (select(): !d.snapshot -> scan(k)) is a DIFFERENT, pre-existing feature; a null
      // snapshot here would trigger it and pollute the scan-count this test is pinning
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1, client: 'x', market: 'gb', attrs: {} }, baseline: null, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
      if (u.includes('/api/labels/askdraft')) return j({ cfg: { to: {} }, asked: {} });
      return j({});
    };
  });

  await page.goto(PAGE);
  await page.waitForTimeout(1000);
  ok('the estate renders both feeds', await page.evaluate(() => document.querySelectorAll('.est-mkt').length) === 2 ||
     await page.evaluate(() => document.body.textContent.includes('Reiss') && document.body.textContent.includes('Monsoon')));

  calls.scan.length = 0; calls.quality.length = 0;   // discard anything boot itself triggered before the click
  await page.evaluate(() => document.getElementById('scan-all').click());
  // two feeds x (score + a full content-quality stream) — give it real time to complete
  await page.waitForFunction(() => {
    const el = document.getElementById('scan-all-msg');
    return el && /^Done/.test(el.textContent);
  }, { timeout: 20000 });

  ok('every feed gets a score-scan call', calls.scan.sort().join(',') === 'Monsoon|gb,Reiss|gb', calls.scan);
  ok('every feed ALSO gets a content-quality call — not left to a manual per-feed click', calls.quality.sort().join(',') === 'Monsoon|gb,Reiss|gb', calls.quality);
  ok('a failed content-quality write on one feed does not halt the estate run — the other feed still completed', calls.scan.length === 2 && calls.quality.length === 2);
  const finalMsg = await page.evaluate(() => document.getElementById('scan-all-msg').textContent);
  ok('the done message names BOTH passes, not just "scanned"', /score/i.test(finalMsg) && /content quality/i.test(finalMsg), finalMsg);
  ok('the button re-enables once the whole estate (score + quality) is done', await page.evaluate(() => !document.getElementById('scan-all').disabled));

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  if (fail) { console.log('\n✗ Golden Record scan-whole-estate tripwire: ' + fail + ' check(s) failed'); process.exit(1); }
  console.log('   ✓ Golden Record scan-whole-estate: every feed gets score AND content quality, one failure never halts the run');
})().catch((e) => { console.error(e); process.exit(1); });
