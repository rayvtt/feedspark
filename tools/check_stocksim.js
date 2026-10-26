#!/usr/bin/env node
/*
 * tools/check_stocksim.js — the /stock rule simulator, as a manager uses it.
 *
 * Ray, 23 Oct 2026: "Within the stock module, create a range‑completion emulation. For example, if the manager drags between
 * range completions of 5 %, 10 %, 15 % or 20 % (or any other percentage), simulate the amount of product that would be
 * excluded. Add stock quantity, a category block, or any other element—almost like a volume simulation of all the stock
 * rules. - also, remove this" (the "Needs a look" card).
 *
 * Drives the REAL page through Chromium on the synthetic rules stub (tools/rules_stub.js) plus an INVENTED master + Google
 * feed (Northwind / Linden — no real figure), served at the routes the page reads (/api/feed/proxy, /api/catalog/master,
 * /api/catalog/master/file) with the real engines. Every count the page prints is checked against a count THIS FILE makes
 * from the same invented rows — never against the engine — so a wrong rule in the engine fails here:
 *
 *   · ⚡ Read products reads the market; the KPIs (in stock, held back, stays live, held back today) match
 *   · range completion: the 5/10/15/20 presets, a dragged slider (any value) and a sweep-bar click each re-count
 *   · a stock-quantity threshold and a category block stack on top, in run order, each product counted ONCE
 *   · the rule table's rows add up to the total; "on its own" is each rule alone
 *   · the comparison with the Google feed today (newly held / brought back)
 *   · the category table, the CSV, the rules remembered on the device, the phone, and "Needs a look" gone
 *
 * Run: node tools/check_stocksim.js      (PW_CHROMIUM overrides the browser path)
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

// ---- the invented catalogue: 44 styles × 10 sizes; style i has (i % 11) sizes in stock (the first k), so its range completion
// is k/10 — every step from 0 to 100% in tens; quantity per in-stock size (i + j) % 7 + 1; three departments; two brands; plus one bag with no style. The Google feed
// sends live every in-stock product of a style with 2+ sizes in stock, sends the 1-size styles OUT of stock, carries the bag.
const SIZES = ['4', '6', '8', '10', '12', '14', '16', '18', '20', '22'], CATS = ['Women > Tops > Tees', 'Men > Coats', 'Kids > Shoes'], BR = ['Northwind', 'Linden'];
const P = [];
for (let i = 0; i < 44; i++) {
  const k = i % 11;
  SIZES.forEach((z, j) => {
    const inS = j < k;
    P.push({ id: 'NW' + i + '-' + z, t: 'Style ' + i + ' ' + z, s: z, g: 'S' + i, inS, q: inS ? ((i + j) % 7) + 1 : 0, cat: CATS[i % 3], br: BR[i % 2], k,
      feed: k >= 3 && inS ? 'in stock' : k >= 1 && k <= 2 ? 'out of stock' : null });
  });
}
P.push({ id: 'BAG-1', t: 'Tote bag', s: '', g: '', inS: true, q: 3, cat: 'Accessories > Bags', br: 'Northwind', k: null, feed: 'in stock' });
const MASTER = ['id,title,size,item_group_id,availability,quantity,product_type,brand']
  .concat(P.map((p) => [p.id, p.t, p.s, p.g, p.inS ? 'in stock' : 'out of stock', p.q, 'Master type', p.br].join(','))).join('\n');
const FEED = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>'
  + P.filter((p) => p.feed).map((p) => '<item><g:id>' + p.id + '</g:id><g:title>' + p.t + '</g:title><g:availability>' + p.feed + '</g:availability><g:product_type>' + p.cat.replace(/>/g, '&gt;') + '</g:product_type><g:item_group_id>' + p.g + '</g:item_group_id></item>').join('')
  + '</channel></rss>';

// ---- the counts, made here (run order: range completion → quantity → sizes in stock → block)
const IN = P.filter((p) => p.inS);
function heldBy(p, R) {
  if (R.rc && p.k != null && (p.k / 10) * 100 < R.rc) return 'rc';
  if (R.qty && p.q < R.qty) return 'qty';
  if (R.sz && p.k != null && p.k < R.sz) return 'sz';
  if (R.block && R.block.indexOf(p.cat.split(' > ')[0]) >= 0) return 'block';
  return '';
}
const count = (R) => IN.filter((p) => heldBy(p, R)).length;
const todayHeld = IN.filter((p) => p.feed !== 'in stock').length;

// ---- FeedHero's suppfeed stock is NOT the simulator's (Ray, 26 Oct 2026: "the supp feed is product quantity only so it
// shouldn't impact the simulation at all"). A suppfeed read that disagrees with the master everywhere is served, and every
// count must stay the master's — the simulator never asks /api/rules/stocksrc.
const SRC = {};
P.forEach((p) => { if (p.k != null) SRC[p.id] = [p.inS ? 'o' : 'i', 0, p.inS ? 'o' : 'i', p.inS ? 0 : 9, 99]; });

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
const ENG = { cat: fs.readFileSync(path.join(D, 'catalog_engine.js'), 'utf8'), fl: fs.readFileSync(path.join(D, 'feedlab_engine.js'), 'utf8') };
const STUB = `${RS.openCards(HTML)}
window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 var tx=function(b,ct){return Promise.resolve(new Response(b,{status:200,headers:{'content-type':ct}}));};
 if(url.indexOf('/catalog/engine.js')>=0)return tx(${JSON.stringify(ENG.cat)},'application/javascript');
 if(url.indexOf('/feedlab/engine.js')>=0)return tx(${JSON.stringify(ENG.fl)},'application/javascript');
 if(url.indexOf('/api/feed/proxy')>=0){window.__simReads=(window.__simReads||[]).concat([url]);return tx(${JSON.stringify(FEED)},'application/xml');}
 if(url.indexOf('/api/catalog/master/file')>=0)return tx(${JSON.stringify(MASTER)},'text/csv');
 if(url.indexOf('/api/catalog/master')>=0)return j({ok:true,rows:${P.length},lastImport:'2026-10-22 05:00:00'});
 if(url.indexOf('/api/rules/stocksrc')>=0){window.__srcAsked=(window.__srcAsked||0)+1;}if(url.indexOf('/api/rules/stocksrc')>=0)return window.__SRC?j({ok:true,done:true,cmpid:'superdry_gb',at:Date.now(),supp:1,rows:window.__SRC}):j({ok:true,nosupp:true,done:true,note:'no suppfeed stock field'});
${RS.stubLines()}
 return j({ok:false,error:'stub'},404);};`;

async function open(browser, w, h, ctxOpts, keep, pre) {
  const ctx = keep || await browser.newContext(Object.assign({ viewport: { width: w, height: h || 1000 }, acceptDownloads: true }, ctxOpts || {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/^https?:\/\//, (r) => {
    const u = new URL(r.request().url());
    if (u.host !== 'fcc.test' || u.pathname !== '/stock') return r.abort();
    return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
  });
  if (pre) await p.addInitScript(pre);
  await p.addInitScript(STUB);
  await p.goto('http://fcc.test/stock?brand=Superdry');
  await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000, state: 'attached' });
  await p.waitForTimeout(300);
  return { ctx, p, errs };
}
const kpi = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#sim-sum .it b')).map((b) => +b.textContent.replace(/[^0-9]/g, '')));
async function read(p) { await p.$eval('#sim-load', (b) => { b.scrollIntoView({ block: 'center' }); b.click(); }); await p.waitForSelector('#sim:not([hidden])', { timeout: 15000 }); await p.waitForTimeout(150); }

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    console.log('· before a read');
    let { ctx, p, errs } = await open(browser, 1440, 1000);
    let st = await p.evaluate(() => ({ hidden: document.getElementById('sim').hidden, txt: document.getElementById('sim-st').textContent, opts: Array.from(document.querySelectorAll('#sim-mkt option')).map((o) => o.textContent), find: !!document.getElementById('find-card') }));
    ok('"Needs a look" is gone from /stock', !st.find, st.find);
    ok('the simulator lists the markets with a Google feed and says what a read does — nothing drawn yet', st.hidden && /Read Superdry GB/.test(st.txt) && st.opts.indexOf('Superdry GB') >= 0, st);
    const order = await p.evaluate(() => Array.from(document.querySelectorAll('main > section.card')).map((c) => c.id));
    ok('it sits right after the in-stock / held-back card', order.indexOf('sim-card') === order.indexOf('av-card') + 1, order);

    console.log('· a read, and range completion');
    await read(p);
    const reads = await p.evaluate(() => window.__simReads || []);
    ok('⚡ Read products reads the market\'s own Google feed', reads.length === 1 && /client=Superdry&market=gb/.test(reads[0]), reads);
    let k = await kpi(p);
    ok('in stock in the master = ' + IN.length + ' (counted here)', k[0] === IN.length, k);
    ok('a fresh device starts on range completion under 20%: held back ' + count({ rc: 20 }), k[1] === count({ rc: 20 }) && k[2] === IN.length - count({ rc: 20 }), k);
    ok('held back today = the in-stock products the feed does not carry live (' + todayHeld + ')', k[3] === todayHeld, k);
    for (const v of [5, 10, 15, 20, 40, 50]) {
      await p.click('#sim-ctl [data-pre="rc|' + v + '"]'); await p.waitForTimeout(60);
      k = await kpi(p);
      ok('preset ' + v + '% → ' + count({ rc: v }) + ' held back', k[1] === count({ rc: v }), [k[1], count({ rc: v })]);
    }
    await p.$eval('#sim-ctl [data-rng="rc"]', (el) => { el.focus(); el.value = '61'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForTimeout(120);
    k = await kpi(p);
    const rv = await p.$eval('#sim-ctl [data-r="rc"] .v', (e) => e.textContent);
    ok('dragging the slider to any value (61%) re-counts while it moves: ' + count({ rc: 61 }), k[1] === count({ rc: 61 }) && rv === '< 61%', [k[1], rv]);
    const still = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-rng'));
    ok('…and the slider keeps the pointer (not rebuilt under it)', still === 'rc', still);
    const bars = await p.$$eval('#sim-sweep .bar', (b) => b.map((x) => +x.getAttribute('data-sx')));
    ok('the sweep draws one bar per 5% from 0 to 100', bars.length === 21 && bars[0] === 0 && bars[20] === 100, bars);
    await p.click('#sim-sweep .bar[data-sx="80"]'); await p.waitForTimeout(80);
    k = await kpi(p);
    ok('a click on the 80% bar sets the line: ' + count({ rc: 80 }), k[1] === count({ rc: 80 }), [k[1], count({ rc: 80 })]);
    await p.click('#sim-ctl [data-pre="rc|20"]'); await p.waitForTimeout(60);

    console.log('· stock quantity and a category block, in run order');
    await p.click('#sim-ctl [data-pre="qty|3"]'); await p.waitForTimeout(60);
    k = await kpi(p);
    ok('quantity under 3 on top of RC under 20%: ' + count({ qty: 3, rc: 20 }), k[1] === count({ qty: 3, rc: 20 }), [k[1], count({ qty: 3, rc: 20 })]);
    await p.check('#sim-ctl input[data-bv="Kids"]'); await p.waitForTimeout(80);
    k = await kpi(p);
    const R = { block: ['Kids'], qty: 3, rc: 20 };
    ok('blocking Kids (tier 1) stacks too, last in run order: ' + count(R), k[1] === count(R), [k[1], count(R)]);
    const rows = await p.$$eval('#sim-rules tbody tr', (t) => t.map((r) => Array.from(r.cells).map((c) => c.textContent)));
    const take = rows.filter((r) => !/All the rules/.test(r[0])).map((r) => +r[1].replace(/\D/g, '')), own = rows.filter((r) => !/All the rules/.test(r[0])).map((r) => +r[2].replace(/\D/g, ''));
    const exTake = ['rc', 'qty', 'block'].map((x) => IN.filter((pp) => heldBy(pp, R) === x).length);
    if (process.env.SIM_SHOT) await p.$eval('#sim-card', (c) => c.scrollIntoView()).then(() => p.screenshot({ path: process.env.SIM_SHOT.replace('.png', '_desk.png') }));
    ok('the rule table runs range completion → quantity → block, each product counted once: ' + exTake.join(' + '), JSON.stringify(take) === JSON.stringify(exTake), [take, exTake]);
    ok('…its rows add up to the total', take.reduce((a, b) => a + b, 0) === count(R) && +rows[rows.length - 1][1].replace(/\D/g, '') === count(R), rows);
    const exOwn = [count({ rc: 20 }), count({ qty: 3 }), count({ block: ['Kids'] })];
    ok('"on its own" is each rule alone: ' + exOwn.join(' / '), JSON.stringify(own) === JSON.stringify(exOwn), [own, exOwn]);
    const live = IN.filter((pp) => pp.feed === 'in stock'), newly = live.filter((pp) => heldBy(pp, R)).length, back = IN.filter((pp) => pp.feed !== 'in stock' && !heldBy(pp, R)).length;
    const cmp = await p.$eval('#sim-cmp', (e) => e.textContent);
    ok('against the feed today: ' + newly + ' live today would go, ' + back + ' held back today would come back', new RegExp(newly + ' live today would go, ' + back + ' held back today would come back').test(cmp), cmp);
    const cats = await p.$$eval('#sim-cats tbody tr', (t) => t.map((r) => [r.cells[0].textContent, +r.cells[1].textContent.replace(/\D/g, ''), +r.cells[2].textContent.replace(/\D/g, '')]));
    const kidsIn = IN.filter((pp) => pp.cat.startsWith('Kids')).length, kr = cats.filter((c) => c[0] === 'Kids')[0];
    ok('the category table reads the Google feed\'s tree: Kids ' + kidsIn + ' in stock, all held back', kr && kr[1] === kidsIn && kr[2] === kidsIn && cats.some((c) => c[0] === 'Accessories'), cats);
    await p.click('#sim-tier [data-st="c2"]'); await p.waitForTimeout(60);
    const c2 = await p.$$eval('#sim-cats tbody tr td.nm', (t) => t.map((x) => x.textContent));
    ok('…tier 2 splits it (Women > Tops, Men > Coats …)', c2.indexOf('Women > Tops') >= 0 && c2.indexOf('Men > Coats') >= 0, c2);

    console.log('· the CSV and the device');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#sim-csv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').trim().split('\n');
    ok('⬇ CSV lists every product these rules hold back (' + count(R) + ')', csv.length - 1 === count(R) && /held back by/.test(csv[0]) && csv.some((l) => /,category block,/.test(l)), [csv.length - 1, csv[0]]);
    const mem = await p.evaluate(() => JSON.parse(localStorage.getItem('fcc-stock-sim') || '{}'));
    ok('the rules are remembered on this device (quantity on at 3, RC at 20, tier 2)', mem.qty && mem.qty.on && mem.qty.v === 3 && mem.rc.v === 20 && mem.cat === 'c2', mem);
    await p.reload(); await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000, state: 'attached' }); await p.waitForTimeout(250);
    await read(p);
    k = await kpi(p);
    ok('…a reload and a read start from them (a block belongs to the read, so it starts empty): ' + count({ qty: 3, rc: 20 }), k[1] === count({ qty: 3, rc: 20 }), [k[1], count({ qty: 3, rc: 20 })]);
    await p.uncheck('#sim-ctl input[data-on="qty"]'); await p.waitForTimeout(60);
    k = await kpi(p);
    ok('switching a rule off takes it out: ' + count({ rc: 20 }), k[1] === count({ rc: 20 }), k[1]);
    const fsum = await p.$eval('#sim-card .fsum', (e) => e.textContent);
    ok('folded, the card keeps its reading (market · held back of in stock)', /Superdry GB · \d+ of \d+ in stock held back/.test(fsum), fsum);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· FeedHero\'s suppfeed stock does not move the simulator');
    ({ ctx, p, errs } = await open(browser, 1440, 1000, null, null, 'window.__SRC=' + JSON.stringify(SRC) + ';localStorage.removeItem("fcc-stock-sim");'));
    await read(p);
    k = await kpi(p);
    ok('in stock stays the master\'s (' + IN.length + ') with a contrary suppfeed read on offer', k[0] === IN.length, [k[0], IN.length]);
    ok('held back under 20% stays the master\'s style runs: ' + count({ rc: 20 }), k[1] === count({ rc: 20 }), [k[1], count({ rc: 20 })]);
    ok('held back today stays the master\'s: ' + todayHeld, k[3] === todayHeld, [k[3], todayHeld]);
    ok('the simulator never asks for the suppfeed read', (await p.evaluate(() => window.__srcAsked || 0)) === 0);
    const foot = await p.$eval('#sim-foot', (e) => e.textContent);
    ok('the card names the master, never the suppfeed', /read off the master/.test(foot) && !/suppfeed|range_comp/.test(foot), foot);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· on a phone');
    ({ ctx, p, errs } = await open(browser, 390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
    await read(p);
    const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, ctl: Math.round(document.getElementById('sim-ctl').getBoundingClientRect().width), out: Math.round(document.querySelector('.sim-out').getBoundingClientRect().width) }));
    ok('the controls stack above the results and nothing scrolls sideways', ov.sw <= ov.vw && ov.ctl > 300 && ov.out > 300, ov);
    await p.$eval('#sim-ctl [data-pre="rc|15"]', (b) => b.click()); await p.waitForTimeout(80);
    k = await kpi(p);
    ok('a preset re-counts on the phone: ' + count({ rc: 15 }), k[1] === count({ rc: 15 }), k[1]);
    if (process.env.SIM_SHOT) await p.$('#sim-card').then((el) => el.screenshot({ path: process.env.SIM_SHOT }));
    ok('no page errors on the phone', errs.length === 0, errs);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
