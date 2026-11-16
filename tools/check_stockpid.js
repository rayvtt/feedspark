#!/usr/bin/env node
/*
 * tools/check_stockpid.js — /stock › Check a product, as an account manager uses it.
 *
 * Ray, 16 Nov 2026: "Create a new module within stock management to check the stock status for each individual ID. When a
 * product ID is entered, the dashboard will show the range completion applied to it, how many stock sizes are in stock and
 * how many are out of stock. It will display the range of completion percentage and whether it is impacted by an exclusion
 * or stock levels."
 *
 * Drives the REAL page through Chromium on the synthetic rules stub (tools/rules_stub.js — Superdry GB runs "Stock < 9 ->
 * OOS" and holds styles under a range-completion line of ≈35%) plus an INVENTED master + Google feed (Northwind, no real
 * figure) served at the routes the page reads, with the real engines. Every figure is checked against a count THIS FILE
 * makes from the same invented rows:
 *
 *   · a product ID (typed in any case) → its style's sizes in / out of stock, its range completion, its quantity, Google today
 *   · the verdict: live · held back by range completion · held back by the stock quantity threshold · held back for a reason
 *     these rules do not explain · out of stock in the master · stock not stated
 *   · a style (item_group_id) → every size of it; a near miss → the closest matches, one click to check; nothing → says so
 *   · the size table: one row per size, the product looked up marked, a click checks that size
 *   · a hero size says so; one read serves the simulator too; the query is remembered on the device; the phone
 *
 * Run: node tools/check_stockpid.js      (PW_CHROMIUM overrides the browser path)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'docs');
const RS = require('./rules_stub.js');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const HTML = fs.readFileSync(path.join(D, 'FeedSpark_Stock.html'), 'utf8').split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');

// ---- the invented catalogue: five styles of ten sizes
//   SA — 8 of 10 in stock (80%), 20 units each, every in-stock size live in Google             → live
//   SB — 2 of 10 in stock (20%, under the ≈35% line), 20 units, none of it in the feed           → held back by range completion
//   SC — 8 of 10 in stock, size 4 has 3 units (under 9) and is sent out of stock, the rest live  → held back by the threshold
//   SD — 8 of 10 in stock, 20 units, size 6 not in the feed though nothing holds it back          → held for another reason
//   SE — 8 of 10 in stock, but size 4 states no stock at all (no word, no quantity)              → stock not stated
const SIZES = ['4', '6', '8', '10', '12', '14', '16', '18', '20', '22'];
const ST = { SA: 8, SB: 2, SC: 8, SD: 8, SE: 8 }, CAT = { SA: 'Women > Tops > Tees', SB: 'Men > Coats', SC: 'Men > Coats', SD: 'Kids > Shoes', SE: 'Kids > Shoes' };
const P = [];
Object.keys(ST).forEach((g) => SIZES.forEach((z, j) => {
  const inS = j < ST[g], none = g === 'SE' && j === 0;
  const q = none ? '' : !inS ? 0 : g === 'SC' && j === 0 ? 3 : 20;
  let feed = inS ? 'in stock' : null;
  if (g === 'SB') feed = null;
  if (g === 'SC' && j === 0) feed = 'out of stock';
  if (g === 'SD' && j === 1) feed = null;
  P.push({ id: g + '-' + z, t: 'Northwind ' + g + ' ' + z, s: z, g, inS, none, q, cat: CAT[g], feed });
}));
const MASTER = ['id,title,size,item_group_id,availability,quantity,product_type,brand']
  .concat(P.map((p) => [p.id, p.t, p.s, p.g, p.none ? '' : p.inS ? 'in stock' : 'out of stock', p.q, 'Master type', 'Northwind'].join(','))).join('\n');
const FEED = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>'
  + P.filter((p) => p.feed).map((p) => '<item><g:id>' + p.id + '</g:id><g:title>' + p.t + '</g:title><g:availability>' + p.feed + '</g:availability><g:product_type>' + p.cat.replace(/>/g, '&gt;') + '</g:product_type><g:item_group_id>' + p.g + '</g:item_group_id></item>').join('')
  + '</channel></rss>';
// the rules the stub's Superdry GB runs, read here off the stub itself
const STK = RS.build(Date.now()).stock.markets.find((m) => m.cmpid === 'superdry_gb');
const LINE = STK.av.held.line.x, ML = +((STK.stock || []).map((r) => /^Stock < (\d+)/.exec(r.n)).filter(Boolean)[0] || [])[1];
const sty = (g) => { const r = P.filter((p) => p.g === g), made = r.filter((p) => !p.none); return { made: made.length, in: made.filter((p) => p.inS).length, out: made.filter((p) => !p.inS).length, rc: Math.round((made.filter((p) => p.inS).length / made.length) * 1000) / 10 }; };
const HERO = { 'Women > Tops > Tees': ['10', '12'] };
const HERO_RESP = (() => {
  const E = require(path.join(D, 'catalog_engine.js')), H = require(path.join(D, 'herosize_engine.js'));
  const ti = H.treeIndex(E), FH = ['g:id', 'g:item_group_id', 'g:product_type'];
  ti.onRow(null, FH); P.filter((p) => p.feed).forEach((p) => ti.onRow([p.id, p.g, p.cat], FH));
  const c = H.census(E, ti.finish());
  c.onRow(null, ['id', 'title', 'size', 'item_group_id', 'availability', 'quantity', 'product_type', 'brand']);
  P.forEach((p) => c.onRow([p.id, p.t, p.s, p.g, p.none ? '' : p.inS ? 'in stock' : 'out of stock', p.q, 'Master type', 'Northwind']));
  const store = {};
  Object.keys(HERO).forEach((k) => { store['m:Superdry|' + k.toLowerCase()] = { k, s: HERO[k], src: 'set', fw: 0, by: 'Analyst A', at: 1 }; });
  return { ok: true, brand: 'Superdry', market: 'GB', census: Object.assign({ client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', t: Date.now() }, c.finish()), store, markets: [{ market: 'GB', census: true }] };
})();

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
const ENG = { cat: fs.readFileSync(path.join(D, 'catalog_engine.js'), 'utf8'), fl: fs.readFileSync(path.join(D, 'feedlab_engine.js'), 'utf8') };
const OPEN = RS.openCards(HTML);
const STUB = `window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 var tx=function(b,ct){return Promise.resolve(new Response(b,{status:200,headers:{'content-type':ct}}));};
 if(url.indexOf('/catalog/engine.js')>=0)return tx(${JSON.stringify(ENG.cat)},'application/javascript');
 if(url.indexOf('/feedlab/engine.js')>=0)return tx(${JSON.stringify(ENG.fl)},'application/javascript');
 if(url.indexOf('/api/feed/proxy')>=0){window.__reads=(window.__reads||0)+1;return tx(${JSON.stringify(FEED)},'application/xml');}
 if(url.indexOf('/api/catalog/master/file')>=0)return tx(${JSON.stringify(MASTER)},'text/csv');
 if(url.indexOf('/api/catalog/master')>=0)return j({ok:true,rows:${P.length},lastImport:'2026-11-15 05:00:00'});
 if(url.indexOf('/api/rules/hero')>=0)return j(${JSON.stringify(HERO_RESP)});
 if(url.indexOf('/api/rules/stocksrc')>=0)return j({ok:true,nosupp:true,done:true,note:'no suppfeed stock field'});
${RS.stubLines()}
 return j({ok:false,error:'stub'},404);};`;

async function open(browser, w, h, ctxOpts, pre) {
  const co = Object.assign({}, ctxOpts || {}); delete co.fresh;
  const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: h || 1000 } }, co));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/^https?:\/\//, (r) => {
    const u = new URL(r.request().url());
    if (u.host !== 'fcc.test' || u.pathname !== '/stock') return r.abort();
    return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
  });
  if (!(ctxOpts && ctxOpts.fresh)) await p.addInitScript(OPEN);
  if (pre) await p.addInitScript(pre);
  await p.addInitScript(STUB);
  await p.goto('http://fcc.test/stock?brand=Superdry&market=GB');
  await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000, state: 'attached' });
  await p.waitForTimeout(300);
  return { ctx, p, errs };
}
async function check(p, q) {
  await p.fill('#pid-in', q);
  await p.$eval('#pid-go', (b) => { b.scrollIntoView({ block: 'center' }); b.click(); });
  await p.waitForFunction(() => !document.getElementById('pid').hidden && !/Reading/.test(document.getElementById('pid-go').textContent), null, { timeout: 15000 });
  await p.waitForTimeout(120);
  return p.evaluate(() => {
    const box = document.getElementById('pid'), tiles = Array.from(box.querySelectorAll('.sv-sum .it')).map((t) => t.textContent);
    const cks = Array.from(box.querySelectorAll('.pid-ck .ck')).map((c) => ({ h: c.querySelector('h4').textContent, p: c.querySelector('p').textContent }));
    const rows = Array.from(box.querySelectorAll('#pid-t tbody tr')).map((r) => ({ id: r.getAttribute('data-pid'), me: r.classList.contains('me'), c: Array.from(r.cells).map((x) => x.textContent) }));
    const vd = box.querySelector('.pid-vd');
    return { head: (vd.querySelector('.vh') || {}).textContent, sub: (vd.querySelector('.vs') || {}).textContent, meta: (vd.querySelector('.vm') || {}).textContent || '', cls: vd.className, tiles, cks, rows,
      near: Array.from(box.querySelectorAll('.pid-near [data-pid]')).map((b) => b.getAttribute('data-pid')) };
  });
}
const tile = (r, lab) => (r.tiles.filter((t) => t.indexOf(lab) === 0)[0] || '');
const ck = (r, lab) => (r.cks.filter((c) => c.h.indexOf(lab) === 0)[0] || { h: '', p: '' });

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    console.log('· the card, before a check (line ≈' + LINE + '%, threshold ' + ML + ' units, both read off the stub)');
    let { ctx, p, errs } = await open(browser, 1440, 1000);
    const st0 = await p.evaluate(() => ({ card: !!document.getElementById('pid-card'), hidden: document.getElementById('pid').hidden, opts: Array.from(document.querySelectorAll('#pid-mkt option')).map((o) => o.textContent), order: Array.from(document.querySelectorAll('main > section.card')).map((c) => c.id) }));
    ok('a Check a product card sits on /stock, right after the simulator, listing the markets with a Google feed', st0.card && st0.hidden && st0.opts.indexOf('Superdry GB') >= 0 && st0.order.indexOf('pid-card') === st0.order.indexOf('sim-card') + 1, st0);

    console.log('· a product that is live');
    let r = await check(p, 'sa-10');
    const A = sty('SA');
    ok('the ID is found whatever its case — live in Google', /^Live in Google/.test(r.head) && /\bok\b/.test(r.cls), r.head);
    ok('range completion applied: ' + A.rc + '% (' + A.in + ' of ' + A.made + ' sizes in stock) against the ≈' + LINE + '% line', new RegExp('^Range completion applied' + A.rc + '%').test(tile(r, 'Range completion')) && new RegExp(A.in + ' of ' + A.made + ' sizes in stock').test(tile(r, 'Range completion')) && new RegExp('line ≈' + LINE + '%').test(tile(r, 'Range completion')), r.tiles);
    ok('sizes in stock ' + A.in + ', out of stock ' + A.out, tile(r, 'Sizes in stock') === 'Sizes in stock' + A.in + 'of ' + A.made + ' sizes made' && /^Sizes out of stock2/.test(tile(r, 'Sizes out of stock')), r.tiles);
    ok('this product: in stock, 20 units, live in Google', /^This productIn stock20 units · Google: live/.test(tile(r, 'This product')), tile(r, 'This product'));
    ok('range completion passes (' + A.rc + '% is over the line) and the threshold passes (20 ≥ ' + ML + ')', /Passes/.test(ck(r, 'Range completion').h) && /Passes/.test(ck(r, 'Stock quantity threshold').h) && new RegExp('at least ' + ML + ' units').test(ck(r, 'Stock quantity threshold').p), r.cks);
    ok('the exclusion check names what runs: no stock-based exclusion holds products back here', /No such rule/.test(ck(r, 'Stock-based exclusion').h), ck(r, 'Stock-based exclusion'));
    ok('a hero size says so — 10 is on the tees\' hero list', /^Hero size/.test(ck(r, 'Hero size').h) && /10 is a hero size/.test(ck(r, 'Hero size').p), ck(r, 'Hero size'));
    ok('the size table: one row per size of the style, this size marked', r.rows.length === 10 && r.rows.filter((x) => x.me).map((x) => x.id).join() === 'SA-10' && r.rows.filter((x) => /In stock/.test(x.c[1])).length === A.in && r.rows.filter((x) => /Out of stock/.test(x.c[1])).length === A.out, r.rows.map((x) => x.c.join('|')));
    ok('…in size order', r.rows.map((x) => x.c[0].replace(/SA-.*/, '')).join() === SIZES.join(), r.rows.map((x) => x.c[0]));

    console.log('· held back by range completion');
    r = await check(p, 'SB-4');
    const B = sty('SB');
    ok('its style is under the line (' + B.rc + '% < ≈' + LINE + '%) and it is not in the feed → held back by range completion', /^Held back from Google by range completion/.test(r.head) && /\bhold\b/.test(r.cls) && /not in the feed/.test(r.sub), [r.head, r.sub]);
    ok('…the range-completion check holds it back and says by how much', /Holds it back/.test(ck(r, 'Range completion').h) && new RegExp('reads ' + B.rc + '%').test(ck(r, 'Range completion').p) && /under it/.test(ck(r, 'Range completion').p), ck(r, 'Range completion'));
    ok('…' + B.in + ' sizes in stock, ' + B.out + ' out', /^Sizes in stock2/.test(tile(r, 'Sizes in stock')) && /^Sizes out of stock8/.test(tile(r, 'Sizes out of stock')), r.tiles);

    console.log('· held back by a stock level');
    r = await check(p, 'SC-4');
    ok('3 units, under the threshold of ' + ML + ', sent out of stock → held back by the stock quantity threshold', /^Held back from Google by the stock quantity threshold/.test(r.head) && /sent out of stock/.test(r.sub), [r.head, r.sub]);
    ok('…the threshold check says what it needs and what this product has', /Holds it back/.test(ck(r, 'Stock quantity threshold').h) && new RegExp('at least ' + ML + ' units to stay live; this one has 3 units').test(ck(r, 'Stock quantity threshold').p), ck(r, 'Stock quantity threshold'));
    ok('…and range completion passes (' + sty('SC').rc + '%)', /Passes/.test(ck(r, 'Range completion').h), ck(r, 'Range completion'));

    console.log('· held back for another reason, out of stock, not stated');
    r = await check(p, 'SD-6');
    ok('in stock, every rule passes, yet not in the feed → held back for a reason these rules do not explain', /^Held back from Google — for a reason these rules do not explain/.test(r.head), r.head);
    r = await check(p, 'SA-20');
    ok('an out-of-stock size → out of stock in the master, no rule involved', /^Out of stock in the master/.test(r.head) && /\bout\b/.test(r.cls), r.head);
    r = await check(p, 'SE-4');
    ok('a size whose stock the master does not state says so — and the style counts it apart (7 of 9 made in stock, 2 out, 1 not stated)', /^The master states no stock for it/.test(r.head) && /^Sizes out of stock2/.test(tile(r, 'Sizes out of stock')) && /1 not stated/.test(tile(r, 'Sizes out of stock')) && /of 9 sizes made/.test(tile(r, 'Sizes in stock')), [r.head, r.tiles]);

    console.log('· a style, a near miss, nothing');
    r = await check(p, 'sb');
    ok('a style (item_group_id) → every size of it, starting from its first', r.rows.length === 10 && /Style SB — checking its first size/.test(r.meta) && r.rows[0].me, [r.meta, r.rows.length]);
    r = await check(p, 'SA-1');
    ok('a near miss lists the closest matches (SA-10, SA-12, SA-14, SA-16, SA-18) — never a guess', /is not a product ID or a style/.test(r.head) && r.near.join() === 'SA-10,SA-12,SA-14,SA-16,SA-18', [r.head, r.near]);
    await p.click('.pid-near [data-pid="SA-12"]'); await p.waitForTimeout(150);
    const pick = await p.$eval('#pid .pid-vd .vh', (e) => e.textContent);
    ok('…one click checks the match', /^Live in Google/.test(pick) && (await p.$eval('#pid-in', (e) => e.value)) === 'SA-12', pick);
    await p.click('#pid-t tbody tr[data-pid="SA-20"]'); await p.waitForTimeout(150);
    ok('a click on a size in the table checks that size', /^Out of stock in the master/.test(await p.$eval('#pid .pid-vd .vh', (e) => e.textContent)));
    r = await check(p, 'zzz-404');
    ok('nothing like it → says so and names what to check', /“zzz-404” is not a product ID or a style/.test(r.head) && /Nothing contains it/.test(r.sub) && !r.near.length, r);

    console.log('· one read, the device');
    ok('every check above read the market ONCE', (await p.evaluate(() => window.__reads)) === 1, await p.evaluate(() => window.__reads));
    await p.$eval('#sim-load', (b) => b.click()); await p.waitForTimeout(300);
    ok('…and the simulator reads it again only when asked (its own button)', (await p.evaluate(() => window.__reads)) === 2);
    const fs1 = await p.$eval('#pid-card .fsum', (e) => e.textContent);
    ok('folded, the card keeps its reading (market · product · verdict)', /Superdry GB · zzz-404|Superdry GB · “zzz-404” not found/.test(fs1), fs1);
    ok('the query is remembered on this device', (await p.evaluate(() => localStorage.getItem('fcc-stock-pid'))) === 'zzz-404');
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    ({ ctx, p, errs } = await open(browser, 1440, 1000, { fresh: true }));
    const fold = await p.$eval('#pid-card', (c) => ({ folded: c.classList.contains('folded'), exp: c.querySelector('.fold').getAttribute('aria-expanded') }));
    ok('on a fresh device the card starts folded (the overview opens first)', fold.folded && fold.exp === 'false', fold);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· on a phone');
    ({ ctx, p, errs } = await open(browser, 390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
    r = await check(p, 'SB-4');
    const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
    ok('a check on the phone reads the same and nothing scrolls sideways', /^Held back from Google by range completion/.test(r.head) && ov.sw <= ov.vw, [r.head, ov]);
    if (process.env.PID_SHOT) await p.$('#pid-card').then((el) => el.screenshot({ path: process.env.PID_SHOT.replace('.png', '_phone.png') }));
    ok('no page errors on the phone', errs.length === 0, errs);
    await ctx.close();
    if (process.env.PID_SHOT) {
      ({ ctx, p, errs } = await open(browser, 1440, 1000));
      await check(p, 'SC-4');
      await p.$('#pid-card').then((el) => el.screenshot({ path: process.env.PID_SHOT }));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
