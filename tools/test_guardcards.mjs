#!/usr/bin/env node
/* Label Guard + Product Type Guard cards (Ray, 18 Sep 2026: "I want this feature [the PT depth
   granularity table] to be the table breakdown for highlight population (1, 2, 3, 4, 5, >5)
   applied to label cards and product types as well, and the [Golden Record scorecard's expand
   and collapse — all and individual] too").

   Renders the REAL /labels and /ptypes pages through Chromium against a stubbed estate and
   snapshots (one feed carrying the per-SKU population profile, one sheet-backed feed without
   it) and asserts: on /labels the per-SKU label-population card draws one row per bucket with
   the share, the footer states avg / profiled / none, and a sheet-backed feed gets the honest
   note rather than an empty table (labelPop is XML-only). On /ptypes (Ray, 22 Sep 2026: "PT
   guard does not need this breakdown ... replace it with the PT depth granularity chart") the
   SAME card slot instead draws category-path DEPTH — read off the value/count pivot every scan
   carries, XML or sheet-backed alike, so a gviz feed gets the full card too, not a fallback.
   Both pages also assert: every brand card folds on its own header, ⊖ Collapse all / ⊕ Expand
   all does them all with the button naming the action still available, the fold survives a
   reload (a device preference), and the ?client= deep link opens a folded card. Then /golden's
   highlight row draws the shared population card off a real in-browser analysis.

   Run: NODE_PATH=$(npm root -g) node tools/test_guardcards.mjs   (presync) */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const NOW = Date.now();
const lblPop = { pct: { '1': 12.3, '2': 21.4, '3': 40.1, '4': 18.2, '5': 8, '6+': 0 }, avg: 2.9, skus: 21020, zero: 1215, max: 5 };
const ptPop = { pct: { '1': 30.5, '2': 10.2, '3': 24.1, '4': 15, '5': 9.2, '6+': 11 }, avg: 3.3, skus: 20500, zero: 300, max: 9 };
const lbl = () => ({ present: true, filled: 20000, cov: 95.2, distinct: 2, truncated: false, values: [['a', 12000], ['b', 8000]] });
const labels = { custom_label_0: lbl(), custom_label_1: lbl(), custom_label_2: lbl(), custom_label_3: { present: false }, custom_label_4: lbl() };
// depth: 4000@4-level, 3000@5-level, 2000@2-level, 1000@1-level -> pct {1:10,2:20,3:0,4:40,5:30,6+:0}, avg 3.6, skus 10000
const pt = { present: true, filled: 10000, cov: 98.9, distinct: 4, truncated: false, values: [['Womens > Shoes > Trainers > Canvas', 4000], ['Mens > Boots > Chelsea Boots > Leather > Formal', 3000], ['Kids > Shoes', 2000], ['Womens', 1000]] };
const idx = (client, mkt, extra) => Object.assign({ client, mkt, t: NOW, rows: 22235, cov: { custom_label_0: 95, custom_label_1: 95, custom_label_2: 95, custom_label_3: null, custom_label_4: 95, product_type: 98.9 }, present: 4, nCrit: 0, nWarn: 1, status: 'warn', baseT: NOW }, extra || {});
const feeds = { 'Schuh|gb': idx('Schuh', 'gb', { depth: { pct: { '1': 0, '2': 0.1, '3': 11.6, '4': 50.8, '5': 36.9, '6+': 0.6 }, avg: 4.3, skus: 21020 } }), 'Schuh|de': idx('Schuh', 'de'), 'House of Bruar|gb': idx('House of Bruar', 'gb'), 'Reiss|gb': idx('Reiss', 'gb', { nCrit: 1, status: 'crit' }) };
const snapOf = (kind, hob) => {
  const s = { v: 1, t: NOW, client: hob ? 'House of Bruar' : 'Schuh', market: 'gb', rows: 22235, labels: kind === 'pt' ? { product_type: pt } : labels };
  if (!hob) { if (kind === 'pt') s.ptPop = ptPop; else s.labelPop = lblPop; }
  return s;
};
const initFor = (kind) => 'window.__D=' + JSON.stringify({ kind, feeds, snap: snapOf(kind, false), hob: snapOf(kind, true) }) + ';' +
  "window.fetch=function(url){var u=String(url),D=window.__D;var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};" +
  "if(u.indexOf('/estate')>=0)return j({feeds:D.feeds,alerts:{}});" +
  "if(u.indexOf('/snapshot')>=0){var s=/House/.test(decodeURIComponent(u))?D.hob:D.snap;return j({snapshot:s,baseline:s,daily:null})}" +
  "if(u.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:0,warn:0,pt:{crit:0,warn:0},gr:{crit:0,warn:0},clients:{}});" +
  "if(u.indexOf('/askdraft')>=0)return j({cfg:{to:{}},asked:{}});return j({});};";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const [name, file, kind, key, one, many] of [
    ['labels', 'FeedSpark_LabelGuard.html', 'lbl', 'lg-collapse', 'label', 'labels'],
    ['ptypes', 'FeedSpark_ProductTypeGuard.html', 'pt', 'pt-collapse', 'value', 'values']]) {
    console.log('-- /' + name + ' --');
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await ctx.addInitScript({ content: initFor(kind) });
    const url = 'file://' + path.join(D, file);
    await page.goto(url);
    await page.waitForTimeout(1200);
    const cards = () => page.evaluate(() => Array.from(document.querySelectorAll('.est-card')).map((c) => [c.getAttribute('data-client'), c.classList.contains('collapsed'), (c.querySelector('.est-sum') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim()]));
    let cs = await cards();
    ok('every brand card has a clickable header with a summary that survives the fold', cs.length === 3 && cs.every((c) => /(feed|market)s?/.test(c[2])), cs);
    ok('the summary carries the live alerts — folding a brand can never hide one', cs.some((c) => c[0] === 'Reiss' && /1 crit/.test(c[2])), cs);
    ok('the button starts as ⊖ Collapse all', (await page.evaluate(() => document.getElementById('collapse-all').textContent)) === '⊖ Collapse all');

    // individual
    await page.evaluate(() => document.querySelector('.est-hd[data-toggle="Reiss"]').click());
    await page.waitForTimeout(150);
    cs = await cards();
    ok('one header click folds THAT card only', cs.filter((c) => c[1]).map((c) => c[0]).join(',') === 'Reiss', cs);
    ok('a folded card carries no market rows, an open one still does', await page.evaluate(() => !document.querySelector('.est-card[data-client="Reiss"] .est-mkt') && !!document.querySelector('.est-card[data-client="Schuh"] .est-mkt')));
    ok('the fold is remembered on the device (' + key + ')', (await page.evaluate((k) => localStorage.getItem(k), key)) === '["Reiss"]');
    // all
    await page.evaluate(() => document.getElementById('collapse-all').click());
    await page.waitForTimeout(150);
    ok('⊖ Collapse all folds every card and the button now offers ⊕ Expand all',
      (await page.evaluate(() => document.querySelectorAll('.est-card.collapsed').length)) === 3 && (await page.evaluate(() => document.getElementById('collapse-all').textContent)) === '⊕ Expand all');
    await page.evaluate(() => document.getElementById('collapse-all').click());
    await page.waitForTimeout(150);
    ok('⊕ Expand all opens every card and the button offers ⊖ Collapse all again',
      (await page.evaluate(() => document.querySelectorAll('.est-card.collapsed').length)) === 0 && (await page.evaluate(() => document.getElementById('collapse-all').textContent)) === '⊖ Collapse all');
    // survives a reload
    await page.evaluate(() => document.querySelector('.est-hd[data-toggle="Schuh"]').click());
    await page.waitForTimeout(150);
    await page.reload(); await page.waitForTimeout(1200);
    cs = await cards();
    ok('the fold survives a reload', cs.filter((c) => c[1]).map((c) => c[0]).join(',') === 'Schuh', cs);
    // ?client= opens a folded card
    await page.goto(url + '?client=Schuh'); await page.waitForTimeout(1600);
    ok('the ?client= deep link opens a folded card before scrolling to it', await page.evaluate(() => { const c = document.querySelector('.est-card[data-client="Schuh"]'); return c && !c.classList.contains('collapsed') && c.style.outline !== ''; }));

    // the population / depth card
    await page.evaluate(() => document.querySelector('.est-mkt[data-k="Schuh|gb"]').click());
    await page.waitForTimeout(700);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.pop .pr')).map((r) => [r.querySelector('.pl').textContent.trim(), r.querySelector('.pv').textContent.trim(), r.querySelector('.pb i').style.width]));
    const want = kind === 'lbl' ? ['1 label', '2 labels', '3 labels', '4 labels', '5 labels'] : ['1 level', '2 levels', '3 levels', '4 levels', '5 levels', '6+ levels'];
    ok('the ' + (kind === 'lbl' ? 'population' : 'depth') + ' card draws one row per bucket — ' + want.join(' / '), rows.map((r) => r[0]).join('|') === want.join('|'), rows);
    ok('each row states its share and draws it as a bar of that width', rows.every((r) => /^[\d.]+%$/.test(r[1]) && r[2] === r[1]), rows);
    const foot = await page.evaluate(() => Array.from(document.querySelectorAll('.pop .pf')).map((p) => p.textContent.replace(/\s+/g, ' ')).join(' ¦ '));
    if (kind === 'lbl') {
      ok('the footer states the SKU-weighted average, how many SKUs were profiled and how many carry none',
        /avg 2\.9 labels per SKU/.test(foot) && /21,020 SKUs profiled/.test(foot) && /carry none \(/.test(foot), foot);
      ok('labels: the verdict line reads the share carrying 3+ of the five', /66\.3% of profiled SKUs carry 3\+/.test(foot), foot);
    } else {
      ok('the footer states the SKU-weighted average category-path depth and how many SKUs were profiled — no "carry none" line (a present product_type column always has a depth)',
        /avg 3\.6 levels per SKU/.test(foot) && /10,000 SKUs profiled/.test(foot) && !/carry none/.test(foot), foot);
      ok('product types: the verdict line reads the 5-level share against the 30–40% industry standard',
        /30% of product volume sits at 5-level paths — the industry standard is 30–40%/.test(foot) && /30% sits at 1–2 levels/.test(foot), foot);
    }
    // labels: sheet-backed → honest note, never an empty table (labelPop is XML-only).
    // ptypes: depth reads the value/count pivot every scan carries, so a sheet-backed feed
    // gets the SAME full card — no fallback needed, unlike the per-SKU population it replaced.
    await page.evaluate(() => document.querySelector('.est-mkt[data-k="House of Bruar|gb"]').click());
    await page.waitForTimeout(700);
    if (kind === 'lbl') {
      ok('a sheet-backed feed (no per-SKU read) says so instead of drawing an empty table',
        await page.evaluate(() => { const p = document.querySelector('.pop'); return !!p && p.classList.contains('na') && /column counts/.test(p.textContent) && !p.querySelector('.pr'); }));
    } else {
      ok('a sheet-backed (gviz) feed still gets the full depth card — depth comes from the category pivot, not a per-SKU-only field',
        await page.evaluate(() => { const p = document.querySelector('.pop'); return !!p && !p.classList.contains('na') && document.querySelectorAll('.pop .pr').length === 6; }));
    }
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  // /golden: the highlight row draws the same card off a real analysis
  console.log('-- /golden --');
  {
    const HEAD = 'id,title,description,link,image_link,availability,price,brand,product_highlight,product_highlight(2),product_highlight(3),product_highlight(4),product_highlight(5),product_highlight(6)';
    const CSV = [HEAD].concat(Array.from({ length: 20 }, (_, i) => {
      const n = i < 4 ? 2 : (i < 14 ? 4 : 6);   // 4 products carry 2, 10 carry 4, 6 carry 6
      const hl = ['Canvas upper', 'Rubber sole', 'Lace fastening', 'Ortholite insole', 'Vulcanised', 'Unisex'].slice(0, n).concat(['', '', '', '', '', '']).slice(0, 6);
      return ['S' + i, 'Schuh Converse Chuck Taylor All Star Ox Canvas Trainers in White Low Top UK ' + (3 + i), 'A canvas low-top trainer with a rubber sole and an Ortholite insole, cut from durable cotton canvas and finished with the classic ankle patch; true to size and easy to wear, item ' + i + '.', 'https://x.com/' + i, 'https://x.com/' + i + '.jpg', 'in stock', '60.00 GBP', 'Converse'].concat(hl).map((x) => '"' + x + '"').join(',');
    })).join('\n');
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/labels/engine.js', (r) => r.fulfill({ path: path.join(D, 'labelguard_engine.js'), contentType: 'text/javascript' }));
    await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: path.join(D, 'feedlab_engine.js'), contentType: 'text/javascript' }));
    await page.route('**/api/feed/proxy*', (r) => r.fulfill({ contentType: 'text/csv', headers: { 'x-feed-bytes': String(CSV.length) }, body: CSV }));
    let saved = null;
    await page.route('**/api/golden/quality*', (r) => {
      if (r.request().method() === 'PUT') { saved = JSON.parse(r.request().postData()); return r.fulfill({ contentType: 'application/json', body: '{"ok":true,"score":80}' }); }
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ quality: saved }) });
    });
    await ctx.addInitScript(() => {
      const NOW = Date.now();
      const feeds = { 'Schuh|gb': { client: 'Schuh', mkt: 'gb', status: 'ok', t: NOW, rows: 20, score: 90, ai: { n: 0, of: 6 }, cov: {}, reqMissing: [] } };
      const real = window.fetch.bind(window);
      window.fetch = (url, opts) => {
        const u = String(url);
        const j = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } }));
        if (/engine\.js/.test(u) || u.includes('/api/feed/proxy') || u.includes('/api/golden/quality')) return real(url, opts);
        if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 20, client: 'Schuh', market: 'gb', attrs: { id: { present: true, cov: 100 } } }, baseline: null, daily: null });
        if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
        if (u.includes('/api/claude')) return j({ configured: false });
        return j({});
      };
    });
    await page.goto('file://' + path.join(D, 'FeedSpark_GoldenRecord.html'));
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.getElementById('qz-run').click());
    await page.waitForFunction(() => document.getElementById('air-tier'), { timeout: 30000 });
    await page.waitForTimeout(400);
    eq2(saved && saved.attrs && saved.attrs.product_highlight && saved.attrs.product_highlight.hlDist, { '1': 0, '2': 20, '3': 0, '4': 50, '5': 0, '6+': 30 }, 'the collector stores the EXACT count distribution (1..5, 6+) — 4 products at 2, 10 at 4, 6 at 6');
    await page.evaluate(() => document.querySelector('.qz-row[data-qk="product_highlight"] .qz-nm').click());
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.pop.hlpop .pr')).map((r) => [r.querySelector('.pl').textContent.trim(), r.querySelector('.pv').textContent.trim()]));
    ok('the highlight row draws the population table — 1 … 5, 6+ highlights, with 6+ marked as our target',
      rows.map((r) => r[0]).join('|') === '1 highlight|2 highlights|3 highlights|4 highlights|5 highlights|6+ highlights (our target)', rows);
    ok('the shares are the stored distribution', rows.map((r) => r[1]).join('|') === '0%|20%|0%|50%|0%|30%', rows);
    const foot = await page.evaluate(() => Array.from(document.querySelectorAll('.pop.hlpop .pf')).map((p) => p.textContent.replace(/\s+/g, ' ')).join(' ¦ '));
    ok('the footer separates Google’s 4–6 (80% at 4+) from FeedSpark’s 6–10 house target (30% at 6+)', /80% of products carry 4 or more/.test(foot) && /30%<\/b>|30% carry 6 or more/.test(foot.replace(/<[^>]+>/g, '')), foot);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }
  await browser.close();
  if (fail) { console.log('\n✗ guard cards: ' + fail + ' check(s) failed'); process.exit(1); }
  console.log('   ✓ guard cards: population tables on /labels, /ptypes and /golden; collapse all + individual on the two guard pages');
})().catch((e) => { console.error(e); process.exit(1); });

function eq2(a, b, name) { ok(name, JSON.stringify(a) === JSON.stringify(b), [a, b]); }
