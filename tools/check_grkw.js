#!/usr/bin/env node
/* Golden Record — KEYWORDS IN THE SCORE, rendered (Ray, 30 Sep 2026: "add keywords fields
   (product_type2,3,4,5,6,7,8,9) to the golden score mix also?").

   The keyword reading has three honest states and the page must never blur them: MEASURED (the XML
   scan read every product — a coverage, how deep the keyworded products go, how many carry an id
   instead of a keyword), ABSENT (the feed has no keyword slots — scored at 0 like any recommended
   attribute) and NOT MEASURED (a sheet-read feed, or a snapshot from before 30 Sep — left out of
   the score, never counted as missing). A source read cannot see which state a row draws or what
   the dial prints, so this renders the REAL /golden page for each and checks the dial against the
   engine's own goldenScore on the same snapshot. Then it presses → Brief and reads the brief it
   opens: a keyword brief in the keyword task family, not a technical attribute fix.

   Playwright-based, so it runs in presync. Run: NODE_PATH=$(npm root -g) node tools/check_grkw.js */
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const PAGE = 'file://' + path.resolve(__dirname, '..', 'docs', 'FeedSpark_GoldenRecord.html');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const COV = { id: 100, title: 100, description: 95, link: 100, image_link: 100, availability: 100, price: 100,
  brand: 100, gtin: 98, condition: 100, item_group_id: 100, color: 90, size: 96, gender: 100, age_group: 100,
  google_product_category: 100, product_type: 100, sale_price: 30, additional_image_link: 80, material: 40, pattern: 20 };
const ROWS = 23449;
const KW = { present: true, filled: 5229, cov: 22.3, slots: 9, strings: 181970, perSku: 7.8, hash: 23449 };   // Reiss GB shape, 30 Sep 2026

(async () => {
  const LG = await import('../cloudflare/feedspark-deck/src/labelguard.js');
  const prof = LG.profileFor('Reiss', {});
  const attrsWith = (kw) => {
    const a = {};
    Object.keys(COV).forEach((k) => { a[k] = { present: true, cov: COV[k], filled: Math.round(COV[k] * ROWS / 100) }; });
    if (kw !== undefined) a.keywords = kw;
    return a;
  };
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const open = async (attrs) => {
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    page.on('pageerror', (e) => errs.push(e.message));
    // the profile route answers as the worker does — the engine's own defaults + upgrade table, so
    // the page scores Reiss under the same Fashion profile the engine's profileFor reads
    const profAns = { defaults: LG.INDUSTRY_PROFILES, overrides: {}, industryMap: LG.INDUSTRY, upgrade: { v: LG.PROFILE_V, delta: LG.PROFILE_DELTA } };
    await page.addInitScript(({ attrs, ROWS, profAns }) => {
      try { localStorage.clear(); } catch (e) {}
      const real = window.fetch.bind(window);
      const cov = {};
      Object.keys(attrs).forEach((k) => { cov[k] = attrs[k].present ? attrs[k].cov : null; });
      const feed = { client: 'Reiss', mkt: 'gb', status: 'ok', t: Date.now(), rows: ROWS, score: null, ai: { n: 0, of: 6 }, cov };
      window.__asked = [];
      window.fetch = (url, o) => {
        const u = String(url);
        window.__asked.push(u);
        const j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
        if (/engine\.js/.test(u)) return real(url, o);
        if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': feed }, alerts: {}, daily: null });
        if (u.includes('/api/golden/history')) return j({ hist: null });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: Date.now(), rows: ROWS, client: 'Reiss', market: 'gb', attrs }, baseline: null, daily: null });
        if (u.includes('/api/golden/profile')) return j(profAns);
        return j({});
      };
    }, { attrs, ROWS, profAns });
    await page.goto(PAGE);
    await page.waitForSelector('.at-row', { timeout: 8000 });
    await page.waitForTimeout(300);
    return page;
  };
  const kwRow = (page) => page.evaluate(() => {
    const r = Array.from(document.querySelectorAll('.at-row')).find((x) => /^keywords/.test((x.querySelector('.at-nm') || {}).textContent || ''));
    if (!r) return null;
    return { nm: r.querySelector('.at-nm').textContent, badge: !!r.querySelector('.fs-std'), miss: (r.querySelector('.at-miss') || {}).textContent || null,
      cov: (r.querySelector('.at-cov') || {}).textContent, note: (r.querySelector('.at-note') || {}).textContent, tip: (r.querySelector('.at-note') || {}).title,
      ask: !!r.querySelector('[data-ask]'), pdp: !!r.querySelector('[data-pdp]'), brief: !!r.querySelector('[data-brief]'),
      tier: (r.closest('.tier').querySelector('h4') || {}).textContent };
  });
  const dial = (page) => page.$eval('svg.dial', (e) => { const m = /score ([\d.]+)/.exec(e.getAttribute('aria-label')); return m ? +m[1] : null; });

  console.log('── measured on the XML scan');
  {
    const attrs = attrsWith(KW);
    const page = await open(attrs);
    const r = await kwRow(page);
    ok('the keywords row sits in the recommended tier', r && /Recommended/i.test(r.tier), r && r.tier);
    ok('…badged as a FeedSpark standard, never as a Google attribute', r && r.badge && !/^g:/.test(r.nm), r && r.nm);
    ok('it reads the per-product coverage', r && r.cov === '22.3%', r && r.cov);
    ok('the note reads keyword STRINGS per SKU (every SKU, not only the keyworded) and names the ids that are not keywords',
      r && /^7\.8 keyword strings per SKU/.test(r.note) && !/keyworded product/.test(r.note) && /23,449 carry an id, not a keyword/.test(r.note), r && r.note);
    ok('the tooltip explains the unit and the average: one phrase between chevrons, over all SKUs, the ones with none counted as none',
      r && /a keyword string is one phrase between chevrons/.test(r.tip) && /181,970 strings across all 23,449 SKUs = 7\.8 per SKU, the 18,220 with no keywords counted as none/.test(r.tip) &&
      /an id is not a keyword/.test(r.tip) && /read across 9 keyword slots/.test(r.tip), r && r.tip);
    ok('our own work: no client ask, no PDP scan — one keyword brief', r && !r.ask && !r.pdp && r.brief);
    const d = await dial(page), e = LG.goldenScore(attrs, prof).score;
    ok('the dial is the engine\'s score, keywords included', d === e, [d, e]);
    const without = LG.goldenScore(attrsWith(undefined), prof).score;
    ok('…and keywords at 22% cost it points (it is in the mix)', e < without, [e, without]);
    // → Brief opens a keyword brief in the keyword task family
    const nav = new Promise((res) => page.on('request', (rq) => { if (/brief=/.test(rq.url())) res(rq.url()); }));
    await page.click('.at-row [data-brief="keywords"]');
    const url = await Promise.race([nav, new Promise((res) => setTimeout(() => res(null), 3000))]);
    let b = null;
    try { const x = /brief=([^&]+)/.exec(url)[1].replace(/-/g, '+').replace(/_/g, '/'); b = JSON.parse(Buffer.from(x, 'base64').toString('utf8')); } catch (e) {}
    ok('→ Brief opens a KEYWORD brief (cat keyword) in the keyword task family',
      b && b.cat === 'keyword' && /^Keywords Optimisation - Catalogue coverage - Reiss GB - \d{4}$/.test(b.task), b);
    ok('…scoped with the coverage, strings per SKU, the ids and the products still to keyword',
      b && /5,229 of 23,449 products keyworded \(22\.3%\), 7\.8 keyword strings per SKU on average/.test(b.scope) && /carry a 32-character id/.test(b.scope) && /keyword the remaining 18,220 products/.test(b.scope), b && b.scope);
    await page.close();
  }

  console.log('── measured before the string count (a scan from the morning of 30 Sep)');
  {
    const page = await open(attrsWith({ present: true, filled: 5229, cov: 22.3, slots: 9, per: 4.9, hash: 23449 }));
    const r = await kwRow(page);
    ok('an old reading never shows its slot count as strings — it says the next scan counts them',
      r && /strings per SKU counted on the next XML scan/.test(r.note) && !/4\.9/.test(r.note + r.tip), r);
    await page.close();
  }

  console.log('── not measured (a sheet-read feed, or a snapshot from before 30 Sep)');
  {
    const attrs = attrsWith(undefined);
    const page = await open(attrs);
    const r = await kwRow(page);
    ok('the row says NOT MEASURED — not "not in feed"', r && /not measured/i.test(r.miss) && /not scored until the next XML scan/.test(r.note), r);
    ok('…with nothing to act on', r && !r.ask && !r.pdp && !r.brief);
    const d = await dial(page), e = LG.goldenScore(attrs, prof).score;
    ok('the dial leaves it out of the score entirely (the engine\'s score, unchanged from before keywords existed)', d === e, [d, e]);
    await page.close();
  }

  console.log('── no keyword slots in the feed');
  {
    const attrs = attrsWith({ present: false });
    const page = await open(attrs);
    const r = await kwRow(page);
    ok('the row says the feed has no keyword slots', r && /no keyword slots/i.test(r.miss), r);
    const d = await dial(page), e = LG.goldenScore(attrs, prof).score;
    ok('…and it counts at 0, like any recommended attribute the feed does not carry', d === e && e < LG.goldenScore(attrsWith(undefined), prof).score, [d, e]);
    await page.close();
  }

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? `\n✗ keywords in the Golden Score: ${fail} failed` : '\n✓ keywords in the Golden Score: all passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
