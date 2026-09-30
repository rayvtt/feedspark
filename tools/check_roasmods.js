#!/usr/bin/env node
/*
 * tools/check_roasmods.js — THE ROAS DASHBOARD, MODULAR, RENDERED.
 *
 * Ray, 30 Sep 2026: "make roas dashboard modularised also pls, allow exports". The Catalogue's own
 * pattern — one card size on a 3-column grid, ⊞ Modules hides and reorders them per device — and every
 * module leaves the page as a PNG or a CSV, the whole screen as an Excel workbook or a PDF.
 *
 * A source read cannot see any of what matters here — that the cards are EVEN, that a hidden module is
 * not painted, that the figure on a card is the figure the book holds, that a download is a real file
 * with the right rows in it — so this drives the real page through Chromium on the synthetic book
 * (tools/roas_stub.js, no real figure) and checks each card against a count made HERE, independently.
 * html2canvas / jsPDF are stubbed (the page loads them from cdnjs on first use); the xlsx writer is the
 * real docs/xlsx_engine.js, and the workbook it writes is opened and read back.
 *
 * Run: node tools/check_roasmods.js      (PW_CHROMIUM overrides the browser path)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'docs', 'FeedSpark_ROAS.html');
const D = require('./roas_stub.js').build();
const XLSX_SRC = fs.readFileSync(path.join(ROOT, 'docs', 'xlsx_engine.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

const W = 'w30';
// a LONGER book for the capture checks: twelve more £ markets, so a card has rows under its fold and
// "nothing clipped" is a claim with something to catch (the stub's two £ markets never overflow a card)
const BIG = JSON.parse(JSON.stringify(D.book));
for (let i = 1; i <= 12; i++) { const m = JSON.parse(JSON.stringify(D.book.markets[0])); m.market = 'M' + i; m.cmpid = 'extra_' + i; m[W].spend.n = 1000 * i; BIG.markets.push(m); }
// the worker's routes, answered from the synthetic book (the same payloads tools/roas_stub.js hands the other tripwires)
const stubFor = (book) => `
  window.fetch = function (url) {
    url = String(url);
    var j = function (o) { return Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })); };
    if (url.indexOf('/api/roas/live') >= 0) return j(${JSON.stringify(D.live)});
    if (url.indexOf('/api/roas?client=') >= 0) return j(${JSON.stringify(D.market)});
    if (url.indexOf('/api/roas') >= 0) return j(${JSON.stringify(book)});
    return j({ ok: false, error: 'stub' });
  };`;
const LIBS = `
  // the capture libraries the page loads from cdnjs on first use: stubs that RECORD what they were handed
  window.__caps = [];
  window.html2canvas = function (el, opts) {
    window.__caps.push({ tag: el.tagName, mod: el.getAttribute('data-mod'), cap: (el.querySelector('.xcap') || {}).textContent || '',
      head: (el.querySelector('.xhead') || {}).textContent || '', shot: el.classList.contains('xshot'), all: document.body.classList.contains('xshotall'),
      clipped: el.getAttribute('data-mod') ? (el.querySelector('.mbody').scrollHeight > el.querySelector('.mbody').clientHeight + 1) : null,
      ignoresExport: !!(opts && opts.ignoreElements && opts.ignoreElements(el.querySelector('.xb') || document.createElement('i'))) });
    var c = document.createElement('canvas'); c.width = 40; c.height = 20; return Promise.resolve(c);
  };
  window.jspdf = { jsPDF: function (o) { window.__pdfOpts = o; return { addImage: function () {}, save: function (n) { window.__pdf = n; } }; } };
  ${XLSX_SRC}
`;

// ---- the book, counted HERE (the £ markets, 30 days) ----
const gbp = D.book.markets.filter((m) => m.cur === '£' && m[W]);
const sp = (m) => m[W].spend.n, rv = (m) => m[W].revenue.n;
const TS = gbp.reduce((a, m) => a + sp(m), 0), TR = gbp.reduce((a, m) => a + rv(m), 0);
const pct1 = (n) => (Math.round(n * 10) / 10).toFixed(1) + '%';
const byBand = {}; gbp.forEach((m) => { const b = m[W].band || 'none'; byBand[b] = (byBand[b] || 0) + sp(m); });
const ladder = gbp.map((m) => ({ n: m.client + ' ' + m.market, r: rv(m) / sp(m) * 100 })).sort((a, b) => b.r - a.r).map((x) => x.n);
const cost = gbp.map((m) => ({ n: m.client + ' ' + m.market, c: sp(m) / m[W].conv })).sort((a, b) => b.c - a.c).map((x) => x.n);
const zombOf = (book) => book.markets.filter((m) => m.cur === '£' && m[W]).map((m) => ({ n: m.client + ' ' + m.market, z: Math.round(m[W].skus * m[W].zombiePct / 100) })).sort((a, b) => b.z - a.z);
const zomb = zombOf(D.book), zombBig = zombOf(BIG);

async function open(browser, opt) {
  opt = opt || {};
  const ctx = await browser.newContext({ viewport: { width: opt.w || 1440, height: opt.h || 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(stubFor(opt.book || D.book));
  await p.addInitScript(LIBS);
  if (opt.init) await p.addInitScript(opt.init);
  await p.goto('file://' + PAGE + (opt.qs || ''));
  await p.waitForSelector('#m-bands-b .hb', { timeout: 10000 });
  await p.waitForTimeout(300);
  return { ctx, p, errs };
}
const boxes = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.mod')).map((el) => {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { k: el.getAttribute('data-mod'), x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), painted: cs.display !== 'none' && r.width > 0 && r.height > 0 };
}));
const rowsOf = (p, id) => p.evaluate((id) => Array.from(document.querySelectorAll('#m-' + id + '-b .hb')).map((r) => r.textContent.replace(/\s+/g, ' ').trim()), id);
async function download(p, click) { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), click()]); const f = await d.path(); return { name: d.suggestedFilename(), buf: fs.readFileSync(f) }; }

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  console.log('· eight modules, one card size, even rows');
  {
    const { ctx, p, errs } = await open(browser);
    const b = await boxes(p);
    ok('eight modules on the page, in the default order', b.map((x) => x.k).join(',') === 'trend,movers,bands,split,ladder,cost,zombie,fresh', b.map((x) => x.k));
    const hs = new Set(b.map((x) => x.h));
    ok('every card is the same height', hs.size === 1, [...hs]);
    const rows = {}; b.forEach((x) => { (rows[x.y] = rows[x.y] || []).push(x); });
    const rs = Object.keys(rows).sort((a, c) => a - c).map((y) => rows[y]);
    ok('three even rows at 1440px — Trend spans two columns beside Movers, then three and three', rs.length === 3 && rs[0].length === 2 && rs[1].length === 3 && rs[2].length === 3, rs.map((r) => r.map((x) => x.k)));
    const tr = b.find((x) => x.k === 'trend'), mv = b.find((x) => x.k === 'movers');
    ok('…Trend is two cards wide (its width ≈ two cards + the gap)', Math.abs(tr.w - (2 * mv.w + 14)) <= 2, [tr.w, mv.w]);
    const fit = await p.evaluate(() => { const mb = document.querySelector('#tr-card .mbody').getBoundingClientRect(); const pn = Array.from(document.querySelectorAll('#tr-panels .tr-panel')); const last = pn[pn.length - 1].getBoundingClientRect(); return { n: pn.length, bottom: Math.round(last.bottom), mb: Math.round(mb.bottom) }; });
    ok('both trend panels fit inside their card, not under the fold', fit.n === 2 && fit.bottom <= fit.mb + 1, fit);
    ok('no page errors', errs.length === 0, errs);

    console.log('· each card carries the figure the book holds (counted here)');
    let r = await rowsOf(p, 'bands');
    ok('ROAS bands: each band\'s share of the £ spend', r.length === Object.keys(byBand).length && Object.keys(byBand).every((k) => r.some((t) => t.indexOf(pct1(byBand[k] / TS * 100) + ' of spend') >= 0)), r);
    r = await rowsOf(p, 'split');
    ok('Spend vs revenue share: each brand\'s share of the £ spend and of the £ revenue', gbp.every((m) => r.some((t) => t.indexOf(m.client) === 0 && t.indexOf(pct1(sp(m) / TS * 100) + ' · ' + pct1(rv(m) / TR * 100)) >= 0)), r);
    r = await rowsOf(p, 'ladder');
    ok('ROAS by market: highest ROAS first', JSON.stringify(r.map((t) => ladder.find((n) => t.indexOf(n) === 0))) === JSON.stringify(ladder), r);
    const ref = await p.evaluate(() => document.querySelector('#m-ladder-b .mleg').textContent);
    ok('…against the blended ROAS of these markets', ref.indexOf('blended ' + Math.round(TR / TS * 100).toLocaleString('en-GB') + '%') >= 0, ref);
    r = await rowsOf(p, 'cost');
    ok('Cost per conversion: most expensive first', JSON.stringify(r.map((t) => cost.find((n) => t.indexOf(n) === 0))) === JSON.stringify(cost), r);
    r = await rowsOf(p, 'zombie');
    ok('Zombie SKUs: skus × zombie share, biggest first', r.length === zomb.length && zomb.every((z, i) => r[i].indexOf(z.n) === 0 && r[i].indexOf(z.z.toLocaleString('en-GB')) >= 0), r);
    const fr = await p.evaluate(() => document.getElementById('m-fresh-f').textContent);
    const rosterN = D.book.rosterBrands.reduce((a, bb) => a + bb.markets.length, 0);
    ok('Data freshness covers every roster market in scope, every currency', fr.indexOf(rosterN + ' roster market') >= 0 && /every currency/.test(fr), fr);

    console.log('· money never crosses a currency');
    await p.selectOption('#cur', '€'); await p.waitForTimeout(200);
    r = await rowsOf(p, 'ladder');
    const eur = D.book.markets.filter((m) => m.cur === '€').map((m) => m.client + ' ' + m.market);
    ok('switching to € redraws every money module on the € markets only', r.length === eur.length && r.every((t) => eur.some((n) => t.indexOf(n) === 0)), r);
    await p.selectOption('#cur', '£'); await p.waitForTimeout(200);

    console.log('· a card leads somewhere');
    await p.click('#m-bands-b [data-band-go="Weak"]'); await p.waitForTimeout(200);
    ok('clicking a band filters the table to it', await p.evaluate(() => { var on = Array.from(document.querySelectorAll('#bands .chip.on')).map((c) => c.getAttribute('data-band')); return on.length === 1 && on[0] === 'Weak'; }));
    await p.click('#m-split-b [data-split-go="Schuh"]'); await p.waitForTimeout(300);
    ok('clicking a brand in Spend vs revenue share opens that brand', (await p.inputValue('#brand')) === 'Schuh');
    ok('…and the card now splits by market', /by market/.test(await p.evaluate(() => document.getElementById('m-split-f').textContent)));
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('· ⊞ Modules: hide, reorder, remember, reset — read off the PAINT');
  {
    const { ctx, p, errs } = await open(browser);
    await p.click('#mods-b'); await p.waitForTimeout(100);
    await p.uncheck('#mods-p [data-mod-on="zombie"]'); await p.waitForTimeout(150);
    let b = await boxes(p);
    ok('an unticked module is not painted', !b.find((x) => x.k === 'zombie').painted, b.find((x) => x.k === 'zombie'));
    ok('…and the bar says how many are shown', /7 of 8 modules shown/.test(await p.evaluate(() => document.getElementById('mods-s').textContent)));
    await p.click('#mods-p [data-mv="ladder"][data-d="-1"]'); await p.waitForTimeout(150);
    b = await boxes(p);
    const vis = b.filter((x) => x.painted).sort((a, c) => a.y - c.y || a.x - c.x).map((x) => x.k);
    ok('↑ moves a module one place earlier on the grid', vis.indexOf('ladder') < vis.indexOf('split'), vis);
    await p.reload(); await p.waitForSelector('#m-bands-b .hb'); await p.waitForTimeout(250);
    b = await boxes(p);
    const vis2 = b.filter((x) => x.painted).sort((a, c) => a.y - c.y || a.x - c.x).map((x) => x.k);
    ok('the choice survives a reload (this device)', !b.find((x) => x.k === 'zombie').painted && vis2.indexOf('ladder') < vis2.indexOf('split'), vis2);
    await p.click('#mods-b'); await p.waitForTimeout(100); await p.click('#mods-p [data-mreset]'); await p.waitForTimeout(150);
    b = await boxes(p);
    ok('Reset puts every module back in the default order', b.every((x) => x.painted) && b.slice().sort((a, c) => a.y - c.y || a.x - c.x).map((x) => x.k).join(',') === 'trend,movers,bands,split,ladder,cost,zombie,fresh', b.map((x) => x.k + (x.painted ? '' : '(hidden)')));
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('· exports — a module as CSV or PNG, the screen as Excel or PDF');
  {
    const { ctx, p, errs } = await open(browser, { book: BIG });
    ok('(the longer book overflows the ladder card, so "nothing clipped" below has something to catch)', await p.evaluate(() => { var b = document.querySelector('#m-ladder .mbody'); return b.scrollHeight > b.clientHeight + 20; }));
    await p.click('#m-zombie [data-x="zombie"]'); await p.waitForTimeout(100);
    ok('⬇ on a card opens its own menu: PNG image and CSV data', await p.evaluate(() => { var x = document.getElementById('x-pop'); return !!x && !x.hidden && x.closest('#m-zombie') && x.querySelectorAll('[data-xk]').length === 2; }));
    let f = await download(p, () => p.click('#x-pop [data-xk="csv"]'));
    const csv = f.buf.toString('utf8').replace(/^﻿/, '').split('\n');
    ok('the CSV is named for its module and scope', /^roas_zombie_all_w30_GBP\.csv$/.test(f.name), f.name);
    ok('…its header names every column', csv[0] === 'Brand,Market,Zombie SKUs,SKUs,Zombie share', csv[0]);
    ok('…and it carries EVERY row, not only those that fit the card — figures as numbers', csv.length === 1 + zombBig.length && zombBig.every((z, i) => csv[1 + i].indexOf(',' + z.z + ',') >= 0), csv.length);
    f = await download(p, async () => { await p.click('#m-bands [data-x="bands"]'); await p.click('#x-pop [data-xk="csv"]'); });
    const bc = f.buf.toString('utf8').replace(/^﻿/, '').split('\n');
    ok('a money module\'s CSV puts the currency in its own column, never glued to the figure', bc[0].indexOf('Currency,Band') === 0 && bc.slice(1).every((l) => l.indexOf('£,') === 0 && !/£\d/.test(l)), bc);

    f = await download(p, async () => { await p.click('#m-ladder [data-x="ladder"]'); await p.click('#x-pop [data-xk="png"]'); });
    const cap = await p.evaluate(() => window.__caps[window.__caps.length - 1]);
    ok('⬇ PNG captures THAT card', cap && cap.mod === 'ladder', cap);
    ok('…captioned with its module, scope and FeedSpark · Private & Confidential', cap && /ROAS · ROAS by market · All brands · 30 days · £ markets/.test(cap.cap) && /Private & Confidential/.test(cap.cap), cap && cap.cap);
    ok('…at its full height (nothing clipped under the fold) and without the ⬇ button', cap && cap.shot && cap.clipped === false && cap.ignoresExport, cap);
    ok('…saved as roas_ladder_….png', /^roas_ladder_all_w30_GBP\.png$/.test(f.name), f.name);
    ok('the card is put back exactly as it was — no caption, normal height', await p.evaluate(() => !document.querySelector('#m-ladder .xcap') && !document.querySelector('#m-ladder').classList.contains('xshot')));

    f = await download(p, async () => { await p.click('#exp-btn'); await p.click('#xlsx'); });
    ok('⬇ Export → Excel saves a workbook', /^roas_all_w30_GBP\.xlsx$/.test(f.name) && f.buf.slice(0, 2).toString() === 'PK', f.name);
    const wb = f.buf.toString('latin1');
    const names = (wb.match(/<sheet name="[^"]+"/g) || []).map((s) => s.slice(13, -1));
    ok('…a tab each: About, Scorecards, every module shown, the table', JSON.stringify(names) === JSON.stringify(['About', 'Scorecards', 'Trend', 'Movers', 'ROAS bands', 'Spend vs revenue share', 'ROAS by market', 'Cost per conversion', 'Zombie SKUs', 'Data freshness', 'Performance']), names);
    ok('…figures written as typed numbers, not text', /<c r="C2" s="\d+"><v>[\d.]+<\/v><\/c>/.test(wb));
    ok('…the table tab carries its brands', /Superdry/.test(wb) && /Schuh/.test(wb));

    await p.click('#mods-b'); await p.uncheck('#mods-p [data-mod-on="zombie"]'); await p.keyboard.press('Escape');
    f = await download(p, async () => { await p.click('#exp-btn'); await p.click('#xlsx'); });
    const names2 = (f.buf.toString('latin1').match(/<sheet name="[^"]+"/g) || []).map((s) => s.slice(13, -1));
    ok('a module put away is left out of the workbook too', names2.indexOf('Zombie SKUs') < 0 && names2.length === names.length - 1, names2);

    await p.click('#exp-btn'); await p.click('#pdf'); await p.waitForTimeout(300);
    const pc = await p.evaluate(() => ({ cap: window.__caps[window.__caps.length - 1], pdf: window.__pdf, opts: window.__pdfOpts, head: !!document.querySelector('.xhead'), all: document.body.classList.contains('xshotall') }));
    ok('⬇ Export → PDF captures the whole dashboard, headed with its scope', pc.cap && pc.cap.tag === 'MAIN' && /ROAS · All brands · 30 days · £ markets/.test(pc.cap.head) && pc.cap.all, pc.cap);
    ok('…saved as one page, A4-landscape wide', pc.pdf === 'roas_dashboard_all_w30_GBP.pdf' && pc.opts && pc.opts.format && pc.opts.format[0] === 297, pc);
    ok('…and the page is put back (no header, no capture layout)', !pc.head && !pc.all, pc);
    f = await download(p, async () => { await p.click('#exp-btn'); await p.click('#csv'); });
    ok('the table CSV is still one click away in the same menu', /^roas_all_w30\.csv$/.test(f.name), f.name);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('· the phone: one column, nothing wider than the screen');
  {
    const { ctx, p, errs } = await open(browser, { w: 390, h: 844 });
    const b = await boxes(p);
    const xs = new Set(b.map((x) => x.x));
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('one column at 390px — every card on the same left edge', xs.size === 1, [...xs]);
    ok('no sideways scroll', over <= 0, over);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
