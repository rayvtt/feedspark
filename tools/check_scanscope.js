#!/usr/bin/env node
/* Guard pages — scan scope (Ray, 7 Oct 2026: "allow scan per brand (all markets) / all brands /
   single market", over a /labels "Done — 0 scanned, 73 fresh (skipped)").

   The estate button had two traps this renders the real pages to keep shut:
     1. /labels skipped every feed read in the last 20 h — so a catch-up scanned NOTHING; a scope
        is now a FORCED read unless "skip feeds read in the last 20 h" is ticked;
     2. every guard page POSTed only the server scan, which refuses a FeedHero XML feed — so the
        XML markets were counted scanned and never read; each feed now takes the per-feed
        button's path, and an XML refusal streams the live feed in the browser and pushes it.
   And the scopes themselves: All brands / one brand (every market) / one market, ⏹ Stop, and
   ⚡ on each brand card. One block on /labels, /ptypes and /golden — held byte-equal here.

   Playwright-based → presync. Run: NODE_PATH=$(npm root -g) node tools/check_scanscope.js */
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const fs = require('fs');

const D = path.resolve(__dirname, '..', 'docs');
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');
const PAGES = [
  { file: 'FeedSpark_LabelGuard.html', mod: 'labels' },
  { file: 'FeedSpark_ProductTypeGuard.html', mod: 'ptypes' },
  { file: 'FeedSpark_GoldenRecord.html', mod: 'golden' },
];

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

// the shared block, byte for byte, on all three pages
{
  console.log('\n-- one block on three pages --');
  const cut = (s) => { const i = s.indexOf('  /* ---- SCAN SCOPE'), j = s.indexOf('  scopeRender();\n', i); return i < 0 || j < 0 ? null : s.slice(i, j); };
  const norm = (b) => b && b.replace(/'\/api\/(labels|ptypes|golden)\/scan'/g, "'/api/X/scan'");
  const blocks = PAGES.map((p) => norm(cut(fs.readFileSync(path.join(D, p.file), 'utf8'))));
  ok('the scan-scope block sits on /labels, /ptypes and /golden', blocks.every(Boolean));
  ok('…identical but for the route each page scans through', blocks.every((b) => b === blocks[0]));
}

// Reiss: a sheet market (GB), two XML markets (DE, FR) and a Meta one on /labels; Superdry: one XML market
const FEEDS = (mod) => {
  const NOW = Date.now(), fresh = NOW - 2 * 3600e3;
  const f = (client, mkt, t) => ({ client, mkt, status: 'ok', t, rows: 1000, score: 90, cov: { title: 100 }, labels: {}, reqMissing: [], ai: { n: 0, of: 6 } });
  const list = [f('Reiss', 'gb', fresh), f('Reiss', 'de', fresh), f('Reiss', 'fr', NOW - 40 * 3600e3), f('Superdry', 'gb', fresh)];
  if (mod === 'labels') list.push(f('Reiss', 'gb-fb', fresh));
  const o = {}; list.forEach((x) => { o[x.client + '|' + x.mkt] = x; }); return o;
};
const XML = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>' +
  Array.from({ length: 60 }, (_, i) => '<item><g:id>p' + i + '</g:id><g:title>Shirt ' + i + '</g:title><g:custom_label_0>a</g:custom_label_0><g:product_type>Women &gt; Tops</g:product_type></item>').join('') +
  '</channel></rss>';

async function open(browser, P) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  await page.addInitScript(({ mod, feeds, xml }) => {
    window.__calls = [];
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url), m = (opts && opts.method) || 'GET';
      const j = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } }));
      if (/engine\.js/.test(u)) return real(url, opts);
      const q = new URL(u, 'http://x').searchParams, who = q.get('client') + '|' + q.get('market');
      if (/\/api\/(labels|ptypes|golden)\/estate/.test(u)) return j({ feeds, alerts: {} });
      // a stored snapshot for every feed, so opening one never starts a scan of its own
      if (/\/api\/(labels|ptypes|golden)\/snapshot/.test(u)) return j({ snapshot: { t: Date.now(), rows: 1000, client: q.get('client'), market: q.get('market'), labels: {}, attrs: {} }, baseline: null, daily: null });
      if (/\/api\/(labels|ptypes|golden)\/scan\b/.test(u) && m === 'POST') {
        window.__calls.push('scan:' + who);
        // ⏹ Stop needs a scan in flight to press against
        if (window.__slow) return new Promise((res) => setTimeout(res, 300)).then(() => j({ ok: true, snapshot: { t: Date.now(), rows: 1000, labels: {} } }));
        // DE / FR / Superdry are FeedHero XML — the server refuses, exactly as the worker does
        if (/\|(de|fr)$|^Superdry/.test(who)) return j({ error: 'XML feed - live scans are sheets-only (gviz cannot query XML); XML feeds are scanned by the 4x-daily xml-scan push instead' });
        return j({ ok: true, snapshot: { t: Date.now(), rows: 1000, labels: {} } });
      }
      if (u.includes('/api/feed/proxy')) { window.__calls.push('stream:' + who); return Promise.resolve(new Response(xml, { status: 200 })); }
      if (u.includes('/api/labels/scanpush')) { window.__calls.push('push:' + who); return j({ ok: true, snapshot: { t: Date.now(), rows: 60, labels: {} } }); }
      if (u.includes('/api/golden/quality') && m === 'PUT') { window.__calls.push('quality:' + who); return j({ ok: true }); }
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      return j({});
    };
    window.print = function () {};
  }, { mod: P.mod, feeds: FEEDS(P.mod), xml: XML });
  await page.goto('file://' + path.join(D, P.file));
  await page.waitForFunction(() => document.querySelectorAll('#scan-brand option').length > 1, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { page, errs };
}
const runScan = async (page, sel) => {
  await page.evaluate(() => { window.__calls = []; });
  await page.click(sel || '#scan-all');
  await page.waitForFunction(() => /^(Done|Stopped) — /.test((document.getElementById('scan-all-msg') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
  return page.evaluate(() => ({ calls: window.__calls.slice(), msg: document.getElementById('scan-all-msg').textContent }));
};
const scans = (r) => r.calls.filter((c) => c.indexOf('scan:') === 0).map((c) => c.slice(5)).sort();

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const P of PAGES) {
    console.log('\n-- /' + P.mod + ' --');
    const { page, errs } = await open(browser, P);
    const all = Object.keys(FEEDS(P.mod)).sort();
    const opts = await page.evaluate(() => ({ b: Array.from(document.querySelectorAll('#scan-brand option')).map((o) => o.textContent), mDis: document.getElementById('scan-mkt').disabled, btn: document.getElementById('scan-all').textContent }));
    ok('the brand picker lists All brands and each brand with its market count; the market picker waits for a brand',
      /^All brands · \d+ feeds$/.test(opts.b[0]) && opts.b.some((t) => /^Reiss · \d+ markets$/.test(t)) && opts.mDis && /Scan whole estate/.test(opts.btn), opts);

    // all brands — a FORCED read, nothing skipped for being fresh
    let r = await runScan(page);
    ok('All brands reads every feed — none skipped for being read in the last 20 h', JSON.stringify(scans(r)) === JSON.stringify(all) && !/skipped/.test(r.msg), [scans(r), r.msg]);
    const xmlOnes = all.filter((k) => /\|(de|fr)$|^Superdry/.test(k));
    ok('…and every FeedHero XML market the server refuses is streamed here and pushed, not counted unread',
      xmlOnes.every((k) => r.calls.includes('stream:' + k) && r.calls.includes('push:' + k)) && /Done — Whole estate: \d+ scanned/.test(r.msg), r.calls);
    if (P.mod === 'golden') ok('…/golden reads content quality for each feed in the same pass', all.filter((k) => !/-fb$/.test(k)).every((k) => r.calls.filter((c) => c === 'stream:' + k).length >= 1), r.calls);

    // the skip, when asked for
    await page.check('#scan-skip');
    r = await runScan(page);
    const fresh = all.filter((k) => !/\|fr$/.test(k));
    ok('ticked, "skip feeds read in the last 20 h" reads only the stale one and says how many it skipped',
      JSON.stringify(scans(r)) === JSON.stringify(['Reiss|fr']) && new RegExp(fresh.length + ' read in the last 20 h \\(skipped\\)').test(r.msg), [scans(r), r.msg]);
    await page.uncheck('#scan-skip');

    // one brand, every market
    await page.selectOption('#scan-brand', 'Reiss');
    const reiss = all.filter((k) => k.indexOf('Reiss|') === 0);
    const b1 = await page.evaluate(() => ({ btn: document.getElementById('scan-all').textContent, mDis: document.getElementById('scan-mkt').disabled, m: Array.from(document.querySelectorAll('#scan-mkt option')).map((o) => o.value) }));
    ok('picking a brand names it on the button with its market count and opens the market picker',
      b1.btn === '⚡ Scan Reiss — ' + reiss.length + ' markets' && !b1.mDis && b1.m.length === reiss.length + 1, b1);
    r = await runScan(page);
    ok('…and scans exactly that brand’s markets', JSON.stringify(scans(r)) === JSON.stringify(reiss) && /Done — Reiss: /.test(r.msg), [scans(r), r.msg]);

    // one market
    await page.selectOption('#scan-mkt', 'de');
    const b2 = await page.textContent('#scan-all');
    r = await runScan(page);
    ok('one market: the button says so and exactly that feed is read', b2 === '⚡ Scan Reiss · DE' && JSON.stringify(scans(r)) === '["Reiss|de"]' && /Done — Reiss · DE: 1 scanned/.test(r.msg), [b2, scans(r), r.msg]);

    // ⏹ Stop finishes the feed in hand and stops
    await page.selectOption('#scan-brand', '*');
    await page.evaluate(() => { window.__calls = []; window.__slow = true; });
    await page.click('#scan-all');
    await page.waitForFunction(() => window.__calls.length > 0 && !document.getElementById('scan-stop').hidden, null, { timeout: 5000 }).catch(() => {});
    const midway = await page.evaluate(() => ({ bDis: document.getElementById('scan-brand').disabled, btnDis: document.getElementById('scan-all').disabled }));
    await page.click('#scan-stop');
    await page.waitForFunction(() => /^Stopped — /.test(document.getElementById('scan-all-msg').textContent), null, { timeout: 20000 }).catch(() => {});
    r = await page.evaluate(() => { window.__slow = false; return { calls: window.__calls.slice(), msg: document.getElementById('scan-all-msg').textContent, stopHidden: document.getElementById('scan-stop').hidden }; });
    ok('while it runs the scope is locked; ⏹ Stop ends it short of the estate and says how many were not reached',
      midway.bDis && midway.btnDis && scans(r).length < all.length && /not reached/.test(r.msg) && r.stopHidden, [midway, scans(r), r.msg]);

    // ⚡ on a brand card
    const cardBtn = await page.$('.est-card[data-client="Superdry"] .est-scan');
    if (cardBtn) {
      r = await runScan(page, '.est-card[data-client="Superdry"] .est-scan');
      ok('⚡ on a brand card scans that brand’s markets — and never folds the card', JSON.stringify(scans(r)) === '["Superdry|gb"]' &&
        await page.evaluate(() => !document.querySelector('.est-card[data-client="Superdry"]').classList.contains('collapsed')), [scans(r), r.msg]);
    } else ok('each brand card carries ⚡ Scan', false);

    ok('no page errors', errs.length === 0, errs.slice(0, 3));
    await page.close();
  }

  // the controls fit a phone
  {
    console.log('\n-- 390px --');
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
    await page.addInitScript(({ feeds }) => { window.fetch = () => Promise.resolve(new Response(JSON.stringify({ feeds, alerts: {} }), { status: 200 })); }, { feeds: FEEDS('labels') });
    await page.goto('file://' + path.join(D, 'FeedSpark_LabelGuard.html'));
    await page.waitForTimeout(600);
    // the bare file's theme toggle already overhangs 390px (the phone layer the worker injects
    // re-lays the topbar — check_mobile owns that); what is asserted here is that every control this
    // change adds wraps inside the screen
    const w = await page.evaluate(() => {
      const iw = window.innerWidth;
      const out = ['scan-brand', 'scan-mkt', 'scan-skip', 'scan-all', 'scan-all-msg'].map((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return [id, Math.round(r.left), Math.round(r.right)]; });
      return { iw, out, over: out.filter((x) => x[1] < 0 || x[2] > iw + 1) };
    });
    ok('the scope controls wrap inside a 390px screen', w.over.length === 0, w);
    await page.close();
  }
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' failed' : '\n✓ scan scope: all brands / a brand / a market — forced, XML streamed, stoppable');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
