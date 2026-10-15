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

  console.log('· eighteen modules, one card size, every row full');
  {
    const { ctx, p, errs } = await open(browser);
    const b = await boxes(p);
    ok('eighteen modules on the page, in the default order — the eight, then the ten brand-on-brand stories', b.map((x) => x.k).join(',') === 'trend,movers,bands,split,ladder,cost,zombie,fresh,bandmix,funnel,concentration,scale,momentum,horizon,breakeven,attention,persku,steady', b.map((x) => x.k));
    const hs = new Set(b.map((x) => x.h));
    ok('every card is the same height', hs.size === 1, [...hs]);
    const rows = {}; b.forEach((x) => { (rows[x.y] = rows[x.y] || []).push(x); });
    const rs = Object.keys(rows).sort((a, c) => a - c).map((y) => rows[y]);
    const WIDE = { trend: 2, bandmix: 2, concentration: 2 };
    ok('seven rows at 1440px, every one of them FULL (three columns of width — a wide card counts two), no hole', rs.length === 7 && rs.every((r) => r.reduce((a, x) => a + (WIDE[x.k] || 1), 0) === 3), rs.map((r) => r.map((x) => x.k)));
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
    ok('…and the bar says how many are shown', /17 of 18 modules shown/.test(await p.evaluate(() => document.getElementById('mods-s').textContent)));
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
    ok('Reset puts every module back in the default order', b.every((x) => x.painted) && b.slice().sort((a, c) => a.y - c.y || a.x - c.x).map((x) => x.k).join(',') === 'trend,movers,bands,split,ladder,cost,zombie,fresh,bandmix,funnel,concentration,scale,momentum,horizon,breakeven,attention,persku,steady', b.map((x) => x.k + (x.painted ? '' : '(hidden)')));
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }


  console.log('· brand on brand — ten stories, each against a count made HERE (Ray, 15 Oct 2026)');
  {
    // on All brands every group is a BRAND: the £ book has one £ market per brand, so a brand's figure is its market's
    const fmtP = (n, d) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
    const fmtM = (n, d) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
    const G = gbp.map((m) => { const t = m[W]; return { n: m.client, sp: sp(m), rv: rv(m), cv: t.conv, ck: t.clicks, im: t.impr, sk: t.skus, band: t.band, m }; });
    const TI = G.reduce((a, g) => a + g.im, 0);
    const { ctx, p, errs } = await open(browser);
    let r = await rowsOf(p, 'bandmix');
    ok('Band mix: each brand\'s share of spend in Strong + Steady, and in Losing', G.every((g) => r.some((t) => t.indexOf(g.n) === 0 && t.indexOf((g.band === 'Strong' || g.band === 'Steady' ? '100%' : '0%') + 'Strong + Steady · 0% Losing') >= 0)), r);
    const segs = await p.evaluate(() => Array.from(document.querySelectorAll('#m-bandmix-b .hb')).map((h) => Array.from(h.querySelectorAll('.stk i')).map((i) => i.className + ':' + i.style.width)));
    ok('…drawn as ONE stacked bar per brand, a segment per band it carries, in the band\'s own colour', segs.length === G.length && segs.every((x) => x.length === 1 && /^sb-(strong|weak):100(\.00)?%$/.test(x[0])), segs);
    r = await rowsOf(p, 'funnel');
    const fun = G.map((g) => ({ n: g.n, cr: g.cv / g.ck * 100, ctr: g.ck / g.im * 100 })).sort((a, b) => b.cr - a.cr);
    ok('Funnel: conversion rate with CTR beside it, best conversion rate first', fun.every((f, i) => r[i].indexOf(f.n) === 0 && r[i].indexOf(fmtP(f.cr, 2) + 'CTR ' + fmtP(f.ctr, 2)) >= 0), r);
    r = await rowsOf(p, 'scale');
    const med = (() => { const v = G.map((g) => g.sp).sort((a, b) => a - b); return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; })();
    const blend = TR / TS * 100;
    const quad = (g) => (g.sp >= med ? 'Big' : 'Small') + ' & ' + (g.rv / g.sp * 100 >= blend ? 'strong' : 'weak');
    ok('Scale vs return: each brand in its quadrant against the MEDIAN spend and the BLENDED ROAS, biggest spender first', G.slice().sort((a, b) => b.sp - a.sp).every((g, i) => r[i].indexOf(g.n) === 0 && r[i].indexOf(quad(g)) >= 0 && r[i].indexOf(pct1(g.sp / TS * 100) + ' of spend') >= 0), r);
    ok('…and the legend states both references', await p.evaluate(() => /median £/.test(document.querySelector('#m-scale-b .mleg').textContent) && /blended \d/.test(document.querySelector('#m-scale-b .mleg').textContent)));
    r = await rowsOf(p, 'breakeven');
    const be = G.map((g) => ({ n: g.n, be: g.sp / g.rv * 100 })).sort((a, b) => a.be - b.be);
    ok('Break-even margin: spend ÷ revenue per brand, lowest first', be.every((x, i) => r[i].indexOf(x.n) === 0 && r[i].indexOf(fmtP(x.be, 1)) >= 0), r);
    r = await rowsOf(p, 'attention');
    const cpm = G.map((g) => ({ n: g.n, cpm: g.sp / g.im * 1000, sim: g.im / TI * 100 })).sort((a, b) => a.cpm - b.cpm);
    ok('Cost of attention: spend per 1,000 impressions, cheapest first, with the impression share beside it', cpm.every((x, i) => r[i].indexOf(x.n) === 0 && r[i].indexOf(fmtM(x.cpm, 2)) >= 0 && r[i].indexOf('impr. ' + pct1(x.sim)) >= 0), r);
    r = await rowsOf(p, 'persku');
    const ps = G.map((g) => ({ n: g.n, rps: g.rv / g.sk, sps: g.sp / g.sk })).sort((a, b) => b.rps - a.rps);
    ok('Per advertised SKU: revenue and spend per SKU that saw traffic, most revenue per SKU first', ps.every((x, i) => r[i].indexOf(x.n) === 0 && r[i].indexOf(fmtM(x.rps, 2) + fmtM(x.sps, 2) + ' spent') >= 0), r);
    ok('…and the foot says the SKUs are those that saw ad traffic, not the catalogue', /not the catalogue/.test(await p.evaluate(() => document.getElementById('m-persku-f').textContent)));
    r = await rowsOf(p, 'horizon');
    const hz = G.map((g) => ({ n: g.n, r7: g.m.w7.revenue.n / g.m.w7.spend.n * 100, r90: g.m.w90.revenue.n / g.m.w90.spend.n * 100 })).sort((a, b) => (b.r7 - b.r90) - (a.r7 - a.r90));
    ok('Short run vs long run: the 7-day ROAS against the 90-day, heating up first — whatever period the page is on', hz.every((x, i) => r[i].indexOf(x.n) === 0 && r[i].indexOf('heating up' + fmtP(x.r7, 0) + ' vs ' + fmtP(x.r90, 0)) >= 0), r);
    // momentum + consistency read the SPARK: the trailing 30-day ROAS as read each day, latest against ≤7 days earlier
    const roasOf = (pt) => pt[1] / pt[0] * 100;
    const dayN = (d) => Math.round(Date.parse(d) / 86400000);
    const mom = G.map((g) => { const sp_ = g.m.spark; const last = sp_[sp_.length - 1]; const tgt = dayN(last.d) - 7; let prev = null; for (const e of sp_) { if (dayN(e.d) <= tgt) prev = e; else break; }
      const now = roasOf(last[W]), was = roasOf(prev[W]); return { n: g.n, d: (now - was) / Math.abs(was) * 100, now, was }; }).sort((a, b) => b.d - a.d);
    r = await rowsOf(p, 'momentum');
    ok('Momentum: ROAS now against the reading 7 days earlier, per brand, rising first', mom.every((x, i) => r[i].indexOf(x.n) === 0 && r[i].indexOf((x.d > 0 ? '▲ +' : '▼ −') + fmtP(Math.abs(x.d), 1) + fmtP(x.was, 0) + ' → ' + fmtP(x.now, 0)) >= 0), [r, mom]);
    const cv = G.map((g) => { const v = g.m.spark.map((e) => roasOf(e[W])); const mean = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / v.length); return { n: g.n, cv: sd / mean * 100, lo: Math.min(...v), hi: Math.max(...v) }; }).sort((a, b) => a.cv - b.cv);
    r = await rowsOf(p, 'steady');
    ok('Consistency: the day-to-day swing (sd ÷ mean) of that daily ROAS, steadiest first, the range beside it', cv.every((x, i) => r[i].indexOf(x.n) === 0 && r[i].indexOf('±' + fmtP(x.cv, 1) + 'ROAS ' + fmtP(x.lo, 0) + ' – ' + fmtP(x.hi, 0)) >= 0), [r, cv]);
    r = await rowsOf(p, 'concentration');
    ok('Market concentration on a one-market brand: 100% on its one market, ≈1 effective market', r.length === G.length && r.every((t) => /100%GB · ≈1\.0 effective/.test(t)), r);

    console.log('  · a story leads somewhere, and follows the brand once one is picked');
    await p.click('#m-scale-b .hb'); await p.waitForTimeout(300);
    const picked = await p.evaluate(() => document.getElementById('brand').value);
    ok('clicking a brand on a story opens that brand (the biggest spender led the Scale card)', picked === G.slice().sort((a, b) => b.sp - a.sp)[0].n, picked);
    r = await rowsOf(p, 'funnel');
    ok('…and every story now compares that brand\'s MARKETS, not brands', r.length === D.book.markets.filter((m) => m.client === picked && m.cur === '£').length && /by market/.test(await p.evaluate(() => document.getElementById('m-funnel-f').textContent)), r);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }
  {
    // the LONGER book gives Superdry thirteen £ markets: concentration has a spread to read, and a full-read rule to honour
    const { ctx, p, errs } = await open(browser, { book: BIG });
    const sd = BIG.markets.filter((m) => m.client === 'Superdry' && m.cur === '£').map((m) => ({ n: m.market, rv: m[W].revenue.n })).sort((a, b) => b.rv - a.rv);
    const T = sd.reduce((a, m) => a + m.rv, 0), hh = sd.reduce((a, m) => a + (m.rv / T) * (m.rv / T), 0);
    const r = await rowsOf(p, 'concentration');
    const row = r.find((t) => t.indexOf('Superdry') === 0);
    ok('a thirteen-market brand: its biggest market\'s share and the effective market count (1 ÷ Σ share²), counted here', row && row.indexOf(sd.length + ' markets') >= 0 && row.indexOf((Math.round(sd[0].rv / T * 100)) + '%' + sd[0].n + ' · ≈' + (Math.round(1 / hh * 10) / 10).toLocaleString('en-GB', { minimumFractionDigits: 1 }) + ' effective') >= 0, [row, sd[0], 1 / hh]);
    const segN = await p.evaluate(() => Array.from(document.querySelectorAll('#m-concentration-b .hb')).find((h) => /^Superdry/.test(h.textContent.trim())).querySelectorAll('.stk i').length);
    ok('…its bar carries six market segments and one for the rest', segN === 7, segN);
    ok('…and the most concentrated brand leads', r[0].indexOf('Schuh') === 0, r[0]);
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
    ok('…a tab each: About, Scorecards, every module shown, the table', JSON.stringify(names) === JSON.stringify(['About', 'Scorecards', 'Trend', 'Movers', 'ROAS bands', 'Spend vs revenue share', 'ROAS by market', 'Cost per conversion', 'Zombie SKUs', 'Data freshness', 'Band mix', 'Funnel', 'Market concentration', 'Scale vs return', 'Momentum', 'Short run vs long run', 'Break-even margin', 'Cost of attention', 'Per advertised SKU', 'Consistency', 'Performance']), names);
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

  console.log('· ◐ Heat — a colour scale per column, trough to peak, columns picked one by one');
  {
    // counted HERE: a brand's ROAS in the currency its row shows (£ — the book's own), every market's ROAS, £ spend per market
    const brandRoas = {}; gbp.forEach((m) => { const b = brandRoas[m.client] || (brandRoas[m.client] = { sp: 0, rv: 0 }); b.sp += sp(m); b.rv += rv(m); });
    const brOrder = Object.keys(brandRoas).sort((a, c) => brandRoas[c].rv / brandRoas[c].sp - brandRoas[a].rv / brandRoas[a].sp);
    const mkAll = D.book.markets.filter((m) => m[W]).map((m) => ({ k: 'm|' + m.cmpid, r: m[W].roasPct, cur: m.cur, sp: sp(m) })).sort((a, c) => c.r - a.r);
    const cell = (p, key, col) => p.evaluate(([key, col]) => {
      const tr = document.querySelector('#pt tbody tr[data-key="' + key + '"]'); if (!tr) return null;
      const i = Array.from(document.querySelectorAll('#pt thead th')).findIndex((th) => th.getAttribute('data-k') === col); const td = tr.children[i]; if (!td) return null;
      return { cls: td.className, bg: getComputedStyle(td).backgroundColor, title: td.title, mark: (td.querySelector('.hk') || {}).textContent || '' };
    }, [key, col]);
    const rgb = (bg) => (bg.match(/[\d.]+/g) || []).map(Number);
    const { ctx, p, errs } = await open(browser);
    ok('no cell is tinted until a column is picked', (await p.evaluate(() => document.querySelectorAll('#pt td.hx').length)) === 0);
    await p.click('#heat-btn'); await p.waitForTimeout(100);
    const listed = await p.evaluate(() => Array.from(document.querySelectorAll('#heat-pop [data-heat]')).map((c) => c.getAttribute('data-heat')));
    const shownCols = await p.evaluate(() => Array.from(document.querySelectorAll('#pt thead th')).map((th) => th.getAttribute('data-k')).filter((k) => k !== 'name'));
    ok('◐ Heat lists every column on screen one by one — but not Band or Updated, which have no peak', JSON.stringify(listed) === JSON.stringify(shownCols.filter((k) => k !== 'band' && k !== 'upd')), [listed, shownCols]);
    await p.check('#heat-pop [data-heat="roas"]'); await p.waitForTimeout(150);
    ok('ticking a column keeps the menu open (pick several in one go)', await p.evaluate(() => !document.getElementById('heat-pop').hidden));
    ok('…the button counts the columns on', /◐ Heat\s*1/.test(await p.evaluate(() => document.getElementById('heat-btn').textContent)));
    let a = await cell(p, 'b|' + brOrder[0], 'roas'), z = await cell(p, 'b|' + brOrder[brOrder.length - 1], 'roas');
    ok('the brand with the highest ROAS (counted here) is the PEAK — ▲, green', a && /\bpk\b/.test(a.cls) && a.mark === '▲' && rgb(a.bg).slice(0, 3).join() === '22,101,52' && /^Peak/.test(a.title), a);
    ok('…the lowest is the TROUGH — ▼, orange', z && /\btr\b/.test(z.cls) && z.mark === '▼' && rgb(z.bg).slice(0, 3).join() === '237,111,11' && /^Trough/.test(z.title), z);
    ok('…only the column picked is coloured', (await p.evaluate(() => Array.from(document.querySelectorAll('#pt td.hx')).every((td) => { var i = Array.prototype.indexOf.call(td.parentElement.children, td); return document.querySelectorAll('#pt thead th')[i].getAttribute('data-k') === 'roas'; }))));
    ok('…its header carries the scale, and the footer names it', await p.evaluate(() => document.querySelector('#pt thead th[data-k="roas"]').classList.contains('hx') && !document.querySelector('#pt thead th[data-k="sp"]').classList.contains('hx') && /◐ ROAS: orange = lowest → green = highest, within each level/.test(document.getElementById('pt-foot').textContent)));
    ok('the Total rows are never on the scale', (await p.evaluate(() => document.querySelectorAll('#pt tr.tot td.hx').length)) === 0);

    // a column where LOWER is better runs the other way: green is read as good, so it marks the lowest
    // (Ray, 7 Oct 2026: "orange > green for highest" — and a green peak CPC would call the dearest market the best)
    await p.check('#heat-pop [data-heat="zb"]'); await p.waitForTimeout(150);
    const zbB = D.book.brands[W].slice().sort((x, y) => x.avgZombiePct - y.avgZombiePct);
    const zLo = await cell(p, 'b|' + zbB[0].client, 'zb'), zHi = await cell(p, 'b|' + zbB[zbB.length - 1].client, 'zb');
    ok('Zombie % (lower is better): the LOWEST brand is green — still marked ▼ as the trough', zLo && /\btr\b/.test(zLo.cls) && zLo.mark === '▼' && rgb(zLo.bg).slice(0, 3).join() === '22,101,52' && /lower is better here, so green marks the lowest$/.test(zLo.title), zLo);
    ok('…and the HIGHEST is orange, still marked ▲ as the peak', zHi && /\bpk\b/.test(zHi.cls) && zHi.mark === '▲' && rgb(zHi.bg).slice(0, 3).join() === '237,111,11', zHi);
    ok('…its header bar runs green → orange, and the footer says which column runs the other way', await p.evaluate(() => document.querySelector('#pt thead th[data-k="zb"]').classList.contains('rev') && !document.querySelector('#pt thead th[data-k="roas"]').classList.contains('rev') && /green = lowest on Zombie %, where lower is better/.test(document.getElementById('pt-foot').textContent)));
    await p.uncheck('#heat-pop [data-heat="zb"]'); await p.waitForTimeout(100);
    await p.check('#heat-pop [data-heat="sp"]'); await p.keyboard.press('Escape');
    await p.click('#expand-all'); await p.waitForTimeout(250);
    a = await cell(p, mkAll[0].k, 'roas'); z = await cell(p, mkAll[mkAll.length - 1].k, 'roas');
    ok('open every brand: markets are compared with MARKETS, not with brands — a ratio across every currency', a && /\bpk\b/.test(a.cls) && /of the 3 markets shown$/.test(a.title) && z && /\btr\b/.test(z.cls), [a, z]);
    const mid = await cell(p, mkAll[1].k, 'roas');
    ok('…the median market sits at the neutral midpoint: untinted, its rank in the tooltip', mid && !/\bhx\b/.test(mid.cls) && /^2nd highest ROAS of the 3 markets shown/.test(mid.title), mid);
    const eurMk = D.book.markets.filter((m) => m.cur === '€');
    const e1 = await cell(p, 'm|' + eurMk[0].cmpid, 'sp');
    ok('money never crosses a currency: the lone € market has no spend scale to sit on', eurMk.length === 1 && e1 && !/\bhx\b/.test(e1.cls) && !e1.mark, e1);
    const g = gbp.slice().sort((x, y) => sp(y) - sp(x));
    const g0 = await cell(p, 'm|' + g[0].cmpid, 'sp'), g1 = await cell(p, 'm|' + g[g.length - 1].cmpid, 'sp');
    ok('…while the £ markets are scaled against each other (peak and trough in £)', /\bpk\b/.test(g0.cls) && / in £$/.test(g0.title) && /\btr\b/.test(g1.cls) && / in £$/.test(g1.title), [g0, g1]);

    await p.reload(); await p.waitForSelector('#pt tbody tr'); await p.waitForTimeout(250);
    ok('the picked columns survive a reload (this device)', await p.evaluate(() => document.querySelector('#pt thead th[data-k="roas"]').classList.contains('hx') && document.querySelector('#pt thead th[data-k="sp"]').classList.contains('hx') && document.querySelectorAll('#pt td.hx').length > 0));
    await p.click('#views-btn'); await p.fill('#view-name', 'heat view'); await p.click('#view-save'); await p.keyboard.press('Escape');
    await p.click('#heat-btn'); await p.click('#heat-pop [data-heat-none]'); await p.waitForTimeout(150);
    ok('Clear takes every colour off, and the button count with it', (await p.evaluate(() => document.querySelectorAll('#pt td.hx, #pt th.hx').length)) === 0 && !/\d/.test(await p.evaluate(() => document.getElementById('heat-btn').textContent)));
    ok('…and the menu stays open with every box unticked', await p.evaluate(() => !document.getElementById('heat-pop').hidden && Array.from(document.querySelectorAll('#heat-pop [data-heat]')).every((c) => !c.checked)));
    await p.keyboard.press('Escape');
    await p.click('#views-btn'); await p.click('#views-pop [data-view="0"]'); await p.waitForTimeout(250);
    ok('a saved view carries its colour scale', await p.evaluate(() => document.querySelector('#pt thead th[data-k="roas"]').classList.contains('hx') && document.querySelector('#pt thead th[data-k="sp"]').classList.contains('hx')));
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }
  {
    // a longer £ book: the gradient is a GRADIENT — deeper the further a market sits from the median, one hue each side
    const { ctx, p, errs } = await open(browser, { book: BIG, init: "localStorage.setItem('fcc-roas-heat','[\"sp\"]');" });
    await p.click('#expand-all'); await p.waitForTimeout(250);
    const list = await p.evaluate(() => { var i = Array.from(document.querySelectorAll('#pt thead th')).findIndex((th) => th.getAttribute('data-k') === 'sp');
      return Array.from(document.querySelectorAll('#pt tbody tr.r[data-key^="m|"]')).map((tr) => { var td = tr.children[i]; return { k: tr.getAttribute('data-key'), cls: td.className, bg: getComputedStyle(td).backgroundColor, v: +td.textContent.replace(/[^\d.]/g, ''), cur: (tr.querySelector('.cur') || {}).textContent }; }).filter((x) => x.cur === '£'); });
    const vs = list.map((x) => x.v).sort((x, y) => x - y), h = vs.length / 2, med = vs.length % 2 ? vs[Math.floor(h)] : (vs[h - 1] + vs[h]) / 2;
    const al = (x) => { const c = (x.bg.match(/[\d.]+/g) || []).map(Number); return c.length > 3 ? c[3] : (c.length ? 1 : 0); };
    const hue = (x) => (x.bg.match(/[\d.]+/g) || []).slice(0, 3).join();
    const above = list.filter((x) => x.v > med).sort((x, y) => x.v - y.v), below = list.filter((x) => x.v < med).sort((x, y) => y.v - x.v);
    ok('(the longer book has a dozen £ markets to scale)', list.length >= 12, list.length);
    ok('above the median: green, deepening toward the peak', above.every((x) => hue(x) === '22,101,52') && above.every((x, i) => !i || al(x) >= al(above[i - 1])), above.map((x) => [x.v, x.bg]));
    ok('below the median: orange, deepening toward the trough', below.every((x) => hue(x) === '237,111,11') && below.every((x, i) => !i || al(x) >= al(below[i - 1])), below.map((x) => [x.v, x.bg]));
    ok('exactly one ▲ peak and one ▼ trough among the £ markets', list.filter((x) => /\bpk\b/.test(x.cls)).length === 1 && list.filter((x) => /\btr\b/.test(x.cls)).length === 1 && list.find((x) => /\bpk\b/.test(x.cls)).v === vs[vs.length - 1] && list.find((x) => /\btr\b/.test(x.cls)).v === vs[0]);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(browser, { init: "localStorage.setItem('fcc-theme','dark');localStorage.setItem('fcc-roas-heat','[\"roas\"]');" });
    const bgs = await p.evaluate(() => Array.from(document.querySelectorAll('#pt td.hx')).map((td) => getComputedStyle(td).backgroundColor.match(/[\d.]+/g).slice(0, 3).join()));
    ok('dark mode draws the scale in its own validated dark steps (green #22A06B, orange #C67B28)', bgs.length && bgs.every((c) => c === '34,160,107' || c === '198,123,40') && bgs.indexOf('34,160,107') >= 0, bgs);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(browser, { w: 390, h: 844 });
    // file:// has no phone layer, so the page's own topbar wraps its module icons over the table — press each button directly.
    // Every menu hangs off its button's right edge; before fitPop, ⊞ Columns, ★ Views and ⬇ Export ran off the left of a phone too.
    const r = await p.evaluate(() => [['heat-btn', 'heat-pop'], ['cols-btn', 'cols-pop'], ['views-btn', 'views-pop'], ['exp-btn', 'exp-pop']].map(([b, m]) => {
      var btn = document.getElementById(b); btn.scrollIntoView({ block: 'center' }); btn.click(); var e = document.getElementById(m), q = e.getBoundingClientRect();
      var o = { m: m, l: Math.round(q.left), r: Math.round(q.right), vw: document.documentElement.clientWidth, open: !e.hidden }; document.body.click(); return o; }));
    ok('on the phone the ◐ Heat menu — and every other menu on the page — opens inside the screen', r.every((x) => x.open && x.l >= 0 && x.r <= x.vw), r);
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
