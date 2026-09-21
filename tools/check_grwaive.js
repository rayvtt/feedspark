#!/usr/bin/env node
/* Golden Record — does this issue apply to the brand? (Ray, 21 Sep 2026: "within golden record
   content quality analysis. For each problem, for example under Title, allow a button to indicate
   whether the issue actually applies for the brand. For instance, I'm looking at Reiss, brand not
   in title mistake where the title is not applicable, so it should be possible to remove the
   issue and have the overall score reanalyzed.")

   The engine maths is pinned in tools/test_labelguard.mjs; this drives the REAL page: expand
   g:title, click "✕ Doesn't apply to Reiss" on the brand-missing rule, and assert that ONE click
   sends ONE token to the brand's profile, that the row, the headline and the estate re-analyse
   without the rule, that the rule stays listed struck through with its undo, that the undo puts
   it back, and that the ⬇ HTML carries the set-aside block but never the button.

   Run: NODE_PATH=$(npm root -g) node tools/check_grwaive.js   (presync) */
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) {
  console.log('· playwright unavailable — skipped'); process.exit(0);
}
const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html');
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin',
  'mpn', 'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category',
  'product_type', 'sale_price', 'additional_image_link', 'product_highlight', 'product_detail', 'material',
  'pattern', 'size_type', 'size_system'];
const rule = (n, pct) => ({ n, pct, eg: ['example value'] });
// title: caps 12 (req) + promo 3 (req) + short 60 (bp) + no-brand 9 (bp) → 100 − 12 − 3 − 24 − 3.6 = 57.4
const QUALITY = {
  t: Date.now(), client: 'Reiss', market: 'gb', rows: 1000,
  attrs: {
    title: { filled: 1000, cov: 100, avgLen: 58, minLen: 12, maxLen: 160,
      rules: { caps: rule(120, 12), promo: rule(30, 3), short: rule(600, 60), 'no-brand': rule(90, 9) } },
    description: { filled: 990, cov: 99, avgLen: 240, minLen: 20, maxLen: 4000, rules: { thin: rule(300, 30.3) } },
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
    ATTRS.forEach((k) => { cov[k] = 100; attrs[k] = { present: true, filled: 1000, cov: 100 }; });
    const feed = { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 88, ai: { n: 0, of: 6 }, cov, reqMissing: [], q: 68.6, qFails: 2 };
    // the profile store, as the worker would keep it — the stub PUT toggles the token and
    // answers with the re-analysed headline, exactly the worker's own contract
    window.__prof = { clients: {} };
    window.__puts = [];
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      const j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': feed }, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: null, daily: null });
      if (u.includes('/api/golden/profile')) {
        if (opts && opts.method === 'PUT') {
          const b = JSON.parse(opts.body);
          window.__puts.push(b);
          const rec = window.__prof.clients[b.name] || {};
          const next = (rec.qwaived || []).filter((t) => t !== b.qrule);
          if (b.waive !== false) next.push(b.qrule);
          if (next.length) window.__prof.clients[b.name] = { qwaived: next }; else delete window.__prof.clients[b.name];
          const requal = { 'Reiss|gb': { q: next.length ? 71.1 : 68.6, qFails: 2 } };
          return j({ ok: true, overrides: JSON.parse(JSON.stringify(window.__prof)), requal });
        }
        return j({ defaults: {}, overrides: JSON.parse(JSON.stringify(window.__prof)), industryMap: {} });
      }
      if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
      if (u.includes('/api/labels/askdraft')) return j({ cfg: { to: {} }, asked: {} });
      return j({});
    };
  }, { ATTRS, QUALITY });

  await page.goto(PAGE);
  await page.waitForTimeout(1200);
  ok('the scorecard renders with a stored quality reading', await page.$('#qz-tier .qz-score') !== null);

  const read = () => page.evaluate(() => {
    const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
    const row = document.querySelector('.qz-row[data-qk="title"]');
    return {
      head: t('#qz-tier .qz-score'),
      title: row ? row.querySelector('.qz-n').textContent.trim() : null,
      flags: row ? [...row.querySelectorAll('.qz-flag')].map((f) => f.textContent.trim()) : [],
      broken: [...document.querySelectorAll('.qz-row[data-qk="title"] .qz-rule:not(.waived) .qz-rl')].map((e) => e.textContent.trim()),
      waived: [...document.querySelectorAll('.qz-row[data-qk="title"] .qz-rule.waived .qz-rl')].map((e) => e.textContent.trim()),
      waivedStruck: [...document.querySelectorAll('.qz-row[data-qk="title"] .qz-rule.waived .qz-rl')].every((e) => getComputedStyle(e).textDecorationLine.indexOf('line-through') >= 0),
      buttons: [...document.querySelectorAll('.qz-row[data-qk="title"] .qz-na')].map((b) => b.textContent.trim()),
      // the estate row's CONTENT score (the feed score sits beside it in its own captioned pair)
      estateQ: (() => { const e = [...document.querySelectorAll('.est-su')].find((x) => /content/.test(x.textContent)); return e ? e.querySelector('b').textContent.trim() : null; })(),
      puts: window.__puts.slice(),
    };
  });

  // open g:title
  await page.click('.qz-row[data-qk="title"] .qz-nm');
  await page.waitForTimeout(300);
  const before = await read();
  ok('g:title reads 57.4 with four findings, the brand-missing rule among them',
    before.title === '57.4' && before.broken.length === 4 && before.broken.some((l) => /brand missing/i.test(l)), before);
  ok('every finding carries "✕ Doesn’t apply to Reiss" — the brand named, never a generic label',
    before.buttons.length === 4 && before.buttons.every((b) => /Doesn’t apply to Reiss/.test(b)), before.buttons);

  // set the brand-missing rule aside
  const idx = before.broken.findIndex((l) => /brand missing/i.test(l));
  const btns = await page.$$('.qz-row[data-qk="title"] .qz-rule:not(.waived) .qz-na');
  await btns[idx].click();
  await page.waitForTimeout(500);
  const after = await read();
  ok('one click sent ONE token to the brand’s own profile: client scope, title:no-brand, waive',
    after.puts.length === 1 && after.puts[0].scope === 'client' && after.puts[0].name === 'Reiss' &&
    after.puts[0].qrule === 'title:no-brand' && after.puts[0].waive === true, after.puts);
  ok('g:title re-analysed without it — 57.4 → 61 (0.4 × 9% comes back)', after.title === '61', after.title);
  ok('the headline re-analysed with it', parseFloat(after.head) > parseFloat(before.head), [before.head, after.head]);
  ok('the rule is no longer a finding…', after.broken.length === 3 && !after.broken.some((l) => /brand missing/i.test(l)), after.broken);
  ok('…but stays LISTED, struck through, under the set-aside block', after.waived.length === 1 && /brand missing/i.test(after.waived[0]) && after.waivedStruck, after);
  ok('…with its undo, and the row says "1 set aside"',
    after.buttons.some((b) => /Applies to Reiss again/.test(b)) && after.flags.some((f) => /1 set aside/.test(f)), after);
  ok('the worker’s re-analysed headline is mirrored onto the estate row', after.estateQ === '71.1', after.estateQ);

  // the client HTML: the decision is in the file, the button is not
  {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#det-html')]);
    const tmp = path.join(os.tmpdir(), 'grwaive-' + Date.now() + '.html');
    await download.saveAs(tmp);
    const html = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
    const body = html.replace(/<style[\s\S]*?<\/style>/g, '');
    ok('the ⬇ HTML carries the set-aside block — the client sees WHY the score is what it is',
      /Set aside for Reiss as not applicable/.test(html) && /class="qz-rule waived"/.test(body));
    ok('…and never the button', !/qz-na/.test(body) && !/Doesn’t apply to/.test(html) && !/Applies to Reiss again/.test(html));
    await page.waitForTimeout(300);
  }

  // put it back
  const undo = await page.$('.qz-row[data-qk="title"] .qz-rule.waived .qz-na');
  await undo.click();
  await page.waitForTimeout(500);
  const back = await read();
  ok('the undo sends the same token with waive:false', back.puts.length === 2 && back.puts[1].qrule === 'title:no-brand' && back.puts[1].waive === false, back.puts);
  ok('and everything reads as it did before — score, findings, no set-aside block',
    back.title === before.title && back.broken.length === 4 && back.waived.length === 0 && !back.flags.some((f) => /set aside/.test(f)) && back.estateQ === '68.6', back);

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  if (fail) { console.log('\n✗ Golden Record per-rule waiver: ' + fail + ' check(s) failed'); process.exit(1); }
  console.log('   ✓ Golden Record per-rule waiver: one click sets a rule aside, the score re-analyses, the undo restores, the client file carries the decision');
})().catch((e) => { console.error(e); process.exit(1); });
