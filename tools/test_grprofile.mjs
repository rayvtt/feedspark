#!/usr/bin/env node
/* Golden Record scoring-profile editor tripwire (Ray, 17 Sep 2026: "update scoring profile
   too pls ? gtin not on there and dont know what else").

   The editor's own hint text already said "The required seven and gtin/mpn always score" —
   but the chip grid only ever rendered the REQUIRED-IN-CASES / RECOMMENDED / CONVERSATIONAL AI
   tiers, since profOk() deliberately excludes the always-required roster from every toggleable
   group (they can never be waived). That left the always-required attributes completely
   invisible in the UI, which reads as missing rather than intentionally fixed. This renders the
   REAL editor (openProf) through Chromium and checks the always-required roster is now shown,
   named, and — critically — NOT clickable (a locked chip that silently did nothing on click
   would be worse than not showing it at all).

   Run: NODE_PATH=$(npm root -g) node tools/test_grprofile.mjs
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

  await page.addInitScript(() => {
    const NOW = Date.now();
    const feed = { client: 'YuMOVE', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 62,
      ai: { n: 0, of: 6 }, cov: { id: 100, title: 100 }, reqMissing: [] };
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      const j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds: { 'YuMOVE|gb': feed }, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: {} });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'YuMOVE', market: 'gb', attrs: {} }, baseline: null, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: { YuMOVE: 'Pet Care' } });
      if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
      if (u.includes('/api/labels/askdraft')) return j({ cfg: { to: {} }, asked: {} });
      return j({});
    };
  });

  await page.goto(PAGE);
  await page.waitForTimeout(1200);
  ok('the scorecard renders with a feed selected', await page.$('#prof-edit') !== null);

  await page.click('#prof-edit');
  await page.waitForTimeout(200);

  const m = await page.evaluate(() => {
    const slot = document.getElementById('profp-slot');
    const html = slot ? slot.innerHTML : '';
    const locked = Array.prototype.map.call(slot.querySelectorAll('.pchip.locked'), (el) => el.textContent.replace(/^\u{1F512}\s*/u, '').trim());
    const editable = Array.prototype.map.call(slot.querySelectorAll('.pchip:not(.locked)'), (el) => el.textContent.replace('★ ', '').trim());
    // a locked chip must not carry a click handler that would silently no-op
    const lockedTag = slot.querySelector('.pchip.locked') ? slot.querySelector('.pchip.locked').tagName : null;
    return { html, locked, editable, lockedTag, hasGroup: html.indexOf('Always required') >= 0 };
  });

  ok('an "Always required" section is drawn', m.hasGroup);
  ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price'].forEach((k) => {
    ok('the required seven includes g:' + k, m.locked.indexOf(k) >= 0, m.locked);
  });
  ok('gtin/mpn are named as the merged identifier pair goldenScore actually scores',
    m.locked.some((t) => /gtin/.test(t) && /mpn/.test(t)), m.locked);
  ok('the always-required roster is 8 chips (7 + one merged gtin/mpn pair)', m.locked.length === 8, m.locked);
  ok('a locked chip is a <span>, not a <button> — nothing to click, nothing that silently no-ops',
    m.lockedTag === 'SPAN', m.lockedTag);
  ok('gtin/mpn never ALSO appear among the editable (toggleable) chips',
    !m.editable.some((t) => t === 'gtin' || t === 'mpn'), m.editable);
  ok('the required seven never appear among the editable chips either',
    !['id', 'title', 'description', 'link', 'image_link', 'availability', 'price'].some((k) => m.editable.indexOf(k) >= 0), m.editable);
  ok('the toggleable tiers are still there — this is additive, not a replacement',
    m.editable.length > 0, m.editable);

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  if (fail) { console.log('\n✗ Golden Record scoring-profile editor tripwire: ' + fail + ' check(s) failed'); process.exit(1); }
  console.log('   ✓ Golden Record scoring-profile editor: the always-required roster is shown, named and locked');
})().catch((e) => { console.error(e); process.exit(1); });
