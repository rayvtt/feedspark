#!/usr/bin/env node
/* ⬇ EVERY MARKET IN ONE FILE — Product Type Guard + Golden Record, and the whole portfolio on all three guard
   pages (Ray, 12 Oct 2026: "Can you allow downloads across the whole portfolio, similar to the way the custom
   label is being set up for Golden Records and PT Cards, please?").

   1. The shared block (between PFX:START and PFX:END) is byte-identical on /ptypes and /golden.
   2. Drives the REAL /ptypes page against a stubbed estate: a brand card's ⬇ HTML downloads ONE file for that
      brand, which is opened and used the way a client would (overview, never-scanned market, compare built by
      the reader, tabs, the depth bars, Δ + a gone path, the filter, CSV inside); the dissection header carries
      ⬇ HTML · all markets; ⬇ Whole portfolio names every market with its brand.
   3. The same on /golden (read off the index, no fetch): scores per market, attributes compared by tier.
   4. /labels ⬇ Whole portfolio: one file, every brand's markets named with their brand.
   Nothing of the FCC in any file.

   Run: NODE_PATH=$(npm root -g) node tools/check_pfx.js   (presync) */
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 600) : '')); }
};

// ---- 1. one block, two pages
console.log('-- the shared block --');
const block = (f) => { const s = fs.readFileSync(path.join(D, f), 'utf8'); const a = s.indexOf('/* PFX:START'), b = s.indexOf('/* PFX:END */'); return a >= 0 && b > a ? s.slice(a, b) : null; };
const bPt = block('FeedSpark_ProductTypeGuard.html'), bGr = block('FeedSpark_GoldenRecord.html');
ok('both pages carry the PFX block', !!bPt && !!bGr);
ok('…byte-identical on /ptypes and /golden', bPt === bGr, bPt && bGr ? { pt: bPt.length, gr: bGr.length } : null);
ok('…no raw line-separator characters (they end a JS string)', bPt && !/[\u2028\u2029]/.test(bPt));

const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — browser checks skipped'); process.exit(fail ? 1 : 0); }

const NOW = Date.now(), DAY = 864e5;
const save = async (dl, name) => { const tmp = path.join(os.tmpdir(), name + '-' + Date.now() + '.html'); await dl.saveAs(tmp); return tmp; };
const fccFree = (html) => !/tb-modules|fcc-|de-bar|de-handle|tky-|fetch\(/.test(html) && !/Claude/.test(html);
const stubJ = "var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};";

// ---- PT fixtures: Schuh gb (a gone path vs its reference) + de, ie never scanned; Reiss gb
const ptLbl = (vals, cov) => ({ present: true, filled: vals.reduce((a, p) => a + p[1], 0), cov, distinct: vals.length, truncated: false, values: vals });
const ptSnap = (client, mkt, rows, vals, cov) => ({ v: 1, t: NOW - 3600000, client, market: mkt, rows, labels: { product_type: ptLbl(vals, cov) } });
const GBV = [['Womens > Shoes > Trainers > Canvas > Low', 4000], ['Mens > Boots > Chelsea Boots', 3000], ['Kids > Shoes', 2000], ['Womens', 1000]];
const PT = {
  gb: { snapshot: ptSnap('Schuh', 'gb', 10000, GBV, 100), baseline: ptSnap('Schuh', 'gb', 10000, GBV.concat([['Mens > Sandals > Sliders', 250]]).map((p) => p[0] === 'Kids > Shoes' ? [p[0], 1800] : p), 100), daily: null },
  de: { snapshot: ptSnap('Schuh', 'de', 5000, [['Damen > Schuhe > Sneaker', 3000], ['Mens > Boots > Chelsea Boots', 1500]], 90), baseline: null, daily: null },
  rgb: { snapshot: ptSnap('Reiss', 'gb', 8000, [['Womens > Dresses > Midi', 5000], ['Mens > Suits', 2000]], 87.5), baseline: null, daily: null },
};
const ptIdx = (client, mkt, extra) => Object.assign({ client, mkt, t: NOW - 3600000, rows: 10000, cov: { product_type: 100 }, nCrit: 0, nWarn: 0, status: 'ok' }, extra || {});
const PT_FEEDS = { 'Schuh|gb': ptIdx('Schuh', 'gb', { nWarn: 1, status: 'warn' }), 'Schuh|de': ptIdx('Schuh', 'de', { rows: 5000 }), 'Schuh|ie': { client: 'Schuh', mkt: 'ie', t: 0, status: 'never' }, 'Reiss|gb': ptIdx('Reiss', 'gb', { rows: 8000 }) };
const PT_ALERTS = { 'Schuh|gb': { client: 'Schuh', mkt: 'gb', t: NOW, alerts: [{ sev: 'warn', msg: 'product_type “Mens > Sandals > Sliders” gone (250 SKUs)' }] } };
const PT_INIT = 'window.__D=' + JSON.stringify({ feeds: PT_FEEDS, alerts: PT_ALERTS, snaps: PT }) + ';' +
  'window.fetch=function(url){var u=String(url),D=window.__D;' + stubJ +
  "if(u.indexOf('/estate')>=0)return j({feeds:D.feeds,alerts:D.alerts});" +
  "if(u.indexOf('/snapshot')>=0){var c=decodeURIComponent((u.match(/client=([^&]+)/)||[])[1]||''),m=decodeURIComponent((u.match(/market=([^&]+)/)||[])[1]||'');window.__calls=(window.__calls||[]).concat([c+'|'+m]);return j(D.snaps[(c==='Reiss'?'r':'')+m]||{snapshot:null})}" +
  "if(u.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:0,warn:0,pt:{crit:0,warn:0},gr:{crit:0,warn:0},clients:{}});return j({});};";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 }, acceptDownloads: true });
  const t = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  const rowsOf = (pg, sel) => pg.evaluate((s) => Array.from(document.querySelectorAll(s)).map((r) => Array.from(r.cells).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')), sel);

  // ================= /ptypes =================
  console.log('-- /ptypes --');
  const pt = await ctx.newPage();
  pt.on('pageerror', (e) => errs.push('ptypes: ' + e.message));
  await pt.addInitScript({ content: PT_INIT });
  await pt.goto('file://' + path.join(D, 'FeedSpark_ProductTypeGuard.html'));
  await pt.waitForTimeout(1200);
  ok('every brand card carries ⬇ HTML in its header', await pt.evaluate(() => document.querySelectorAll('.est-hd .est-dl').length === 2));
  ok('the estate header carries ⬇ Whole portfolio', !!(await pt.$('#pfx-all')));
  let [dl] = await Promise.all([pt.waitForEvent('download'), pt.click('.est-dl[data-dl="Schuh"]')]);
  ok('a brand card downloads ONE file named for the brand', /^ptguard_Schuh_all-markets_\d{4}-\d{2}-\d{2}\.html$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const calls = await pt.evaluate(() => window.__calls || []);
  ok('…fetching only that brand’s scanned markets — never the unscanned one, never another brand', calls.slice().sort().join(',') === 'Schuh|de,Schuh|gb', calls);
  ok('…and the button is back to its label', await pt.evaluate(() => { const b = document.querySelector('.est-dl[data-dl="Schuh"]'); return !b.disabled && b.textContent === '⬇ HTML'; }));
  let file = await save(dl, 'pfx-pt'), html = fs.readFileSync(file, 'utf8');
  if (process.env.PFX_KEEP) fs.writeFileSync(process.env.PFX_KEEP, html);
  ok('nothing of the FCC in the file — no nav, no injected layers, no fetch, no Claude', fccFree(html));
  ok('the file carries the confidentiality footer', /Private &amp; Confidential/.test(html));
  const doc = await ctx.newPage();
  doc.on('pageerror', (e) => errs.push('pt file: ' + e.message));
  await doc.goto('file://' + file); await doc.waitForTimeout(400);
  ok('the header names the brand, three markets, two scanned', (await t(doc, 'h1')) === 'Schuh' && /3 markets · 2 scanned/.test(await t(doc, '.hd .sub')), await t(doc, '.hd .sub'));
  let ov = await rowsOf(doc, '#ov tbody tr');
  ok('the overview: a row per market (the never-scanned one saying so) and an all-markets row',
    ov.length === 4 && /^DE \| 5,000 \| 90%/.test(ov[0]) && /^GB \| 10,000 \| 100% \| 4 \| /.test(ov[1]) && /^IE \| not scanned yet$/.test(ov[2]) && /^All markets \| 15,000/.test(ov[3]), ov);
  ok('GB carries its flag, DE a tick', /1 warn$/.test(ov[1]) && /✓$/.test(ov[0]), ov);
  const head = await doc.evaluate(() => Array.from(document.querySelectorAll('#cmp thead th')).map((h) => h.textContent.trim()));
  ok('compare: one column per scanned market, then the average and the spread', head.join('|') === 'Product type|Top level|DE|GB|Average ▼% of SKUs|Spreadwidest gap', head);
  const shared = await doc.evaluate(() => Array.from(document.querySelectorAll('#cmp tbody tr')).find((r) => /Chelsea/.test(r.textContent)).textContent);
  ok('a path both markets carry reads in both columns (SKUs + share)', /1,500\s*30%/.test(shared) && /3,000\s*30%/.test(shared), shared);
  await doc.evaluate(() => document.querySelector('[data-rows="gap"]').click()); await doc.waitForTimeout(100);
  ok('“Missing somewhere” keeps only the paths one market lacks', await doc.evaluate(() => Array.from(document.querySelectorAll('#cmp tbody tr')).every((r) => !/Chelsea/.test(r.textContent)) && document.querySelectorAll('#cmp tbody tr').length === 4));
  await doc.evaluate(() => document.querySelector('[data-rows="all"]').click());
  await doc.evaluate(() => document.querySelector('[data-grp="Mens"]').click()); await doc.waitForTimeout(100);
  ok('a top-level chip narrows the comparison to that branch', await doc.evaluate(() => Array.from(document.querySelectorAll('#cmp tbody tr')).map((r) => r.cells[1].textContent).every((g) => g === 'Mens')));
  ok('…and the view travels in the address', /g=Mens/.test(await doc.evaluate(() => location.hash)));
  await doc.evaluate(() => document.querySelector('#tabs [data-tab="1"]').click()); await doc.waitForTimeout(100);
  ok('the GB tab: products, scanned, Δ vs its reference', /GB/.test(await t(doc, '#mk h2')) && /10,000 products/.test(await t(doc, '#mk .st')) && /Δ vs (yesterday|last known-good)/.test(await t(doc, '#mk .st')), await t(doc, '#mk .st'));
  const bars = await doc.evaluate(() => Array.from(document.querySelectorAll('#mk .pop .pr')).map((r) => [r.querySelector('.pl').textContent, r.querySelector('.pv').textContent]));
  ok('…the depth card: six levels, the 5-level share 40%', bars.length === 6 && bars[4][0] === '5 levels' && bars[4][1] === '40%', bars);
  ok('…its alert', /Sliders/.test(await t(doc, '#mk .al') || ''));
  ok('…a path gone since the reference is listed as GONE, a grown one shows its Δ', await doc.evaluate(() => {
    const rs = Array.from(document.querySelectorAll('#mk tbody tr'));
    const g = rs.find((r) => /Sliders/.test(r.textContent)), k = rs.find((r) => /Kids > Shoes/.test(r.textContent));
    return !!g && g.classList.contains('gone') && /GONE/.test(g.textContent) && !!k && /\+200/.test(k.textContent);
  }));
  await doc.fill('#q', 'boots'); await doc.waitForTimeout(300);
  ok('🔍 narrows the market table and the comparison together', await doc.evaluate(() => document.querySelectorAll('#mk tbody tr').length === 1 && Array.from(document.querySelectorAll('#cmp tbody tr')).every((r) => /Boots/i.test(r.textContent))));
  [dl] = await Promise.all([doc.waitForEvent('download'), doc.click('#csv0')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').split('\n');
  ok('⤓ CSV · all markets: every market’s paths with group, SKUs, share and Δ', /^"market","Top level","Product type","skus"/.test(csv[0]) && csv.some((l) => /^"GB","Kids","Kids > Shoes",2000,20,/.test(l)) && csv.some((l) => /^"DE",/.test(l)), csv.slice(0, 3));
  await doc.close();
  await pt.evaluate(() => document.querySelector('.est-mkt[data-k="Schuh|gb"]').click()); await pt.waitForTimeout(600);
  ok('the dissection header carries ⬇ HTML · all markets', await pt.evaluate(() => { const b = document.getElementById('det-html'); return !!b && /all markets/.test(b.textContent); }));
  [dl] = await Promise.all([pt.waitForEvent('download'), pt.click('#pfx-all')]);
  ok('⬇ Whole portfolio downloads one portfolio file', /^ptguard_portfolio_all-markets_/.test(dl.suggestedFilename()), dl.suggestedFilename());
  html = fs.readFileSync(await save(dl, 'pfx-ptall'), 'utf8');
  const pall = await ctx.newPage(); await pall.setContent(html); await pall.waitForTimeout(300);
  ov = await rowsOf(pall, '#ov tbody tr');
  ok('…every brand’s markets, each named with its brand, then the estate row', (await t(pall, 'h1')) === 'Every brand' && ov.length === 5 && /^Reiss · GB \| 8,000/.test(ov[0]) && /^Schuh · DE/.test(ov[1]) && /^Estate \| 23,000/.test(ov[4]), ov);
  await pall.close(); await pt.close();

  // ================= /golden =================
  console.log('-- /golden --');
  const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin', 'mpn', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category', 'product_type'];
  const gr = await ctx.newPage();
  gr.on('pageerror', (e) => errs.push('golden: ' + e.message));
  await gr.route('**/labels/engine.js', (r) => r.fulfill({ path: path.join(D, 'labelguard_engine.js'), contentType: 'text/javascript' }));
  await gr.route('**/feedlab/engine.js', (r) => r.fulfill({ path: path.join(D, 'feedlab_engine.js'), contentType: 'text/javascript' }));
  await gr.addInitScript(({ ATTRS }) => {
    try { localStorage.clear(); sessionStorage.setItem('gr-demo', '0'); } catch (e) {}
    const NOW = Date.now(), full = {}, part = {};
    ATTRS.forEach((k, i) => { full[k] = 100; part[k] = i === 1 ? 92 : 100; });
    const feeds = {
      'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, cov: part, reqMissing: [], q: 88.4, air: 64, airTier: 3 },
      'Reiss|de': { client: 'Reiss', mkt: 'de', status: 'ok', t: NOW, rows: 800, cov: Object.assign({}, full, { gtin: null, mpn: null }), reqMissing: [] },
      'Reiss|it': { client: 'Reiss', mkt: 'it', status: 'never' },
      'Schuh|gb': { client: 'Schuh', mkt: 'gb', status: 'ok', t: NOW, rows: 500, cov: full, reqMissing: [], q: 70 },
    };
    const real = window.fetch.bind(window);
    window.__calls = [];
    window.fetch = (url, o) => {
      const u = String(url);
      const j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
      if (/engine\.js/.test(u)) return real(url, o);
      window.__calls.push(u);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      return j({});
    };
  }, { ATTRS });
  await gr.goto('file://' + path.join(D, 'FeedSpark_GoldenRecord.html'));
  await gr.waitForTimeout(1500);
  ok('every brand card carries ⬇ HTML, the estate header ⬇ Whole portfolio', await gr.evaluate(() => document.querySelectorAll('.est-hd .est-dl').length === 2 && !!document.getElementById('pfx-all')));
  await gr.evaluate(() => { window.__calls = []; });
  [dl] = await Promise.all([gr.waitForEvent('download'), gr.click('.est-dl[data-dl="Reiss"]')]);
  ok('a brand card downloads ONE file named for the brand', /^goldenrecord_Reiss_all-markets_/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok('…read off the index this page holds — no fetch', (await gr.evaluate(() => window.__calls.length)) === 0, await gr.evaluate(() => window.__calls));
  html = fs.readFileSync(await save(dl, 'pfx-gr'), 'utf8');
  ok('nothing of the FCC in the file', fccFree(html));
  const gdoc = await ctx.newPage(); gdoc.on('pageerror', (e) => errs.push('golden file: ' + e.message));
  await gdoc.setContent(html); await gdoc.waitForTimeout(300);
  ov = await rowsOf(gdoc, '#ov tbody tr');
  ok('the overview: scores per market, the never-scanned one saying so', (await t(gdoc, 'h1')) === 'Reiss' && ov.length === 4 && /^DE \| /.test(ov[0]) && /^GB \| \d+(\.\d)? \| 88.4 \| 64 · /.test(ov[1]) && /^IT \| not scanned yet$/.test(ov[2]), ov);
  const gh = await gdoc.evaluate(() => Array.from(document.querySelectorAll('#cmp thead th')).map((h) => h.textContent.trim()));
  ok('compare: attributes by tier, a column per market', gh.join('|') === 'Attribute|Tier|DE|GB|Average ▼coverage|Spreadwidest gap', gh);
  await gdoc.evaluate(() => document.querySelector('[data-grp="Required"]').click()); await gdoc.waitForTimeout(100);
  const titleRow = await gdoc.evaluate(() => { const r = Array.from(document.querySelectorAll('#cmp tbody tr')).find((x) => x.cells[0].textContent === 'g:title'); return r ? Array.from(r.cells).map((c) => c.textContent).join('|') : null; });
  ok('the Required chip lines g:title up across markets — 100% DE, 92% GB, 8pp apart', titleRow === 'g:title|Required|100%|92%|96%|8pp', titleRow);
  await gdoc.evaluate(() => document.querySelector('#tabs [data-tab="1"]').click()); await gdoc.waitForTimeout(100);
  const kp = await gdoc.evaluate(() => Array.from(document.querySelectorAll('#mk .kt .l')).map((x) => x.textContent));
  ok('the GB tab: Golden Score, content quality, AI-readiness, required attributes', kp.join('|') === 'Golden Score|Content quality|AI-readiness|Required attributes', kp);
  ok('…and the fill by Google’s tier as bars', await gdoc.evaluate(() => document.querySelectorAll('#mk .pop .pr').length >= 2));
  await gdoc.close();
  [dl] = await Promise.all([gr.waitForEvent('download'), gr.click('#pfx-all')]);
  html = fs.readFileSync(await save(dl, 'pfx-grall'), 'utf8');
  const gall = await ctx.newPage(); await gall.setContent(html); await gall.waitForTimeout(300);
  ov = await rowsOf(gall, '#ov tbody tr');
  ok('⬇ Whole portfolio: every brand’s markets named with their brand', /^goldenrecord_portfolio_all-markets_/.test(dl.suggestedFilename()) && ov.length === 5 && /^Reiss · DE/.test(ov[0]) && /^Schuh · GB/.test(ov[3]) && /^Estate/.test(ov[4]), ov);
  await gall.close(); await gr.close();

  // ================= /labels whole portfolio =================
  console.log('-- /labels --');
  const lbl = (vals) => ({ present: true, filled: 100, cov: 100, distinct: vals.length, truncated: false, values: vals });
  const lsnap = (c, m) => ({ v: 1, t: NOW, client: c, market: m, rows: 100, labels: { custom_label_0: lbl([['FULL', 60], ['SALE', 40]]), custom_label_1: { present: false }, custom_label_2: { present: false }, custom_label_3: { present: false }, custom_label_4: { present: false } } });
  const lidx = (c, m) => ({ client: c, mkt: m, t: NOW, rows: 100, cov: { custom_label_0: 100 }, present: 1, nCrit: 0, nWarn: 0, status: 'ok' });
  const L_INIT = 'window.__D=' + JSON.stringify({ feeds: { 'Schuh|gb': lidx('Schuh', 'gb'), 'Reiss|gb': lidx('Reiss', 'gb'), 'Reiss|gb-fb': lidx('Reiss', 'gb-fb') }, snaps: { Schuh: lsnap('Schuh', 'gb'), Reiss: lsnap('Reiss', 'gb') } }) + ';' +
    'window.fetch=function(url){var u=String(url),D=window.__D;' + stubJ +
    "if(u.indexOf('/estate')>=0)return j({feeds:D.feeds,alerts:{}});" +
    "if(u.indexOf('/snapshot')>=0){var c=decodeURIComponent((u.match(/client=([^&]+)/)||[])[1]||'');return j({snapshot:D.snaps[c],baseline:D.snaps[c],daily:null})}" +
    "if(u.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:0,warn:0,pt:{crit:0,warn:0},gr:{crit:0,warn:0},clients:{}});if(u.indexOf('/askdraft')>=0)return j({cfg:{to:{}},asked:{}});return j({});};";
  const lg = await ctx.newPage();
  lg.on('pageerror', (e) => errs.push('labels: ' + e.message));
  await lg.addInitScript({ content: L_INIT });
  await lg.goto('file://' + path.join(D, 'FeedSpark_LabelGuard.html'));
  await lg.waitForTimeout(1200);
  [dl] = await Promise.all([lg.waitForEvent('download'), lg.click('#pfx-all')]);
  ok('⬇ Whole portfolio downloads one portfolio file', /^labelguard_portfolio_all-markets_/.test(dl.suggestedFilename()), dl.suggestedFilename());
  html = fs.readFileSync(await save(dl, 'pfx-lgall'), 'utf8');
  const lall = await ctx.newPage(); await lall.setContent(html); await lall.waitForTimeout(300);
  ov = await rowsOf(lall, '#ov tbody tr');
  ok('…every brand’s markets named with their brand', (await t(lall, 'h1')) === 'Every brand' && ov.length === 3 && /Reiss · GB/.test(ov[0]) && /Schuh · GB/.test(ov[2]), ov);
  await lall.close(); await lg.close();

  ok('no page errors (the pages and every file)', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ every-market downloads: ' + fail + ' check(s) failed' : '\n✓ every-market downloads: /ptypes and /golden per brand + whole portfolio, /labels whole portfolio');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
