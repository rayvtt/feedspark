#!/usr/bin/env node
/*
 * tools/check_restock.js — RESTOCK, DRIVEN AS AN AM DRIVES IT.
 *
 * Ray, 7 Oct 2026: "feedhero-reports have got By Products report - and 'Restock products' is interesting to
 * build as a module".
 *
 * tools/test_restock.mjs pins the engine, the ledger and the worker. THIS pins the half only a browser can see,
 * on the REAL page with the synthetic Northwind set from tools/restock_stub.js:
 *   · the feed streams whole and the Ads read lands in two calls; the join waits for both;
 *   · every KPI equals an INDEPENDENT count (the same synthetic feed + Ads rows through the engine, here in node);
 *   · the restock view lists exactly the unavailable products, biggest conversion value first, each with its
 *     state chip; days unavailable are the LEDGER's (12 d for a product first seen 12 days ago; "today" for one
 *     the ledger never had), not the window's;
 *   · the Back-in-stock view lists the ledger products the feed carries in stock again, and the All view every
 *     product served; a column sort and the text filter narrow to what an independent count says;
 *   · the observation the page PUTs is exactly the out-of-stock, gone and returned ids the engine computes;
 *   · ⬇ CSV downloads the table as shown, one line per row;
 *   · a ?view= deep link lands on its view; no console error anywhere;
 *   · at 390px the page scrolls nowhere sideways, the KPI band is two a row and the table pans in its own frame.
 * Run: node tools/check_restock.js        (in presync; CI has no browsers)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright not installed — restock check skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const STUBS = require('./restock_stub.js');
const E = require('../docs/restock_engine.js');
const FA = require('../docs/feedlab_engine.js');
const PAGE = fs.readFileSync(path.join(D, 'FeedSpark_Restock.html'), 'utf8');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const HTML = PAGE.split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
// the phone pass meets the page AS SERVED: the worker injects these layers (the phone bottom bar, the skim view …)
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html', 'lang_widget.html', 'hours_widget.html', 'shipped_widget.html', 'mobile_widget.html', 'digest_widget.html', 'migration_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const SERVED = HTML.replace('</body>', WIDGETS + '\n</body>');
const STUB = `window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
${STUBS.stubLines()}
 if(url.indexOf('/api/access')>=0)return j({ok:true,email:'ray@feedspark.com',owner:true,clients:null,modules:null});
 if(url.indexOf('/api/presence')>=0)return j({ok:true,me:'ray@feedspark.com',owner:true,now:Date.now(),users:[],roster:[]});
 if(url.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:0,warn:0,pt:{crit:0,warn:0},gr:{crit:0,warn:0},clients:{}});
 return j({ok:false,error:'stub'},404);};`;

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };
const n0 = (v) => Number(v).toLocaleString('en-GB');

// ---- the independent count: the same synthetic feed + Ads rows through the engine, in node ------------------------
const DATA = STUBS.build();
const fm = new Map(); let feedN = 0;
{
  let P = null, n = 0;
  const parser = FA.createXmlParser((row, h) => { if (!P) { P = E.plan(h || row); n = (h || row).length; return; } if (h && h.length !== n) { P = E.plan(h); n = h.length; } const f = E.feedRow(P, row); if (!f) return; feedN++; const k = E.adsKey(f.id); if (!fm.has(k)) fm.set(k, f); });
  parser.push(DATA.xml); parser.end();
}
const NOW = Date.now();
const LED = new Function('return ' + STUBS.LEDGER_JS)();
const rows = E.join(fm, DATA.adsRows); E.withLedger(rows, LED, NOW);
const sum = E.summary(rows, 'GBP', false);
const unavail = E.rank(rows.filter(E.isUnavail));
const obs = E.observation(rows, fm, LED, feedN);
const back = E.backRows(fm, E.adsIndex(DATA.adsRows), LED, NOW);
const cats = E.byCategory(rows, 8);
const byClicks = rows.slice().sort((a, b) => (b.clicks - a.clicks) || (b.value - a.value) || (a.id < b.id ? -1 : 1));
const q = 'dress', qN = rows.filter((r) => { const f = r.f || {}; return r.id.toLowerCase().indexOf(q) >= 0 || (f.title || '').toLowerCase().indexOf(q) >= 0 || (f.ptFull || '').toLowerCase().indexOf(q) >= 0; }).length;

(async () => {
  const tmp = path.join(os.tmpdir(), '_rscheck_FeedSpark_Restock.html'); fs.writeFileSync(tmp, HTML);
  const tmpS = path.join(os.tmpdir(), '_rscheck_served_FeedSpark_Restock.html'); fs.writeFileSync(tmpS, SERVED);
  const b = await chromium.launch({ headless: true });
  try {
    console.log('· 1440px — load, join, the KPIs against an independent count');
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text())) errs.push(m.text()); });
    await pg.addInitScript(STUB);
    await pg.goto('file://' + tmp);
    await pg.waitForFunction(() => window.__FCCRestock && window.__FCCRestock.state().joined && window.__FCCRestock.state().led.wrote, null, { timeout: 30000 });
    await pg.waitForTimeout(300);
    const st = await pg.evaluate(() => { const S = window.__FCCRestock.state(); return { feedN: S.feedN, feed: S.feed.st, ads: S.ads.st, adsCalls: window.__rsAds, n: S.rows.length, brand: S.brand, mkt: S.mkt, cur: S.ads.cur }; });
    ok('the feed streamed whole (' + feedN + ' products) and the Ads read landed in two calls', st.feed === 'done' && st.feedN === feedN && st.ads === 'ready' && st.adsCalls === 2, st);
    ok('the first brand and its Google market were picked; the sheet market is offered dashed', st.brand === STUBS.CLIENT && st.mkt === STUBS.MKT && await pg.locator('#mkts .chip.none').count() === 1, st);
    const kp = await pg.evaluate(() => Array.from(document.querySelectorAll('#kp .kpi')).map((k) => [k.querySelector('.l').textContent, k.querySelector('.n').textContent]));
    const K = {}; kp.forEach((x) => { K[x[0]] = x[1]; });
    ok('six KPI tiles', kp.length === 6, kp.map((x) => x[0]));
    ok('Products served = every Ads row (' + sum.demanded + ')', K['Products served'] === n0(sum.demanded), K);
    ok('Not buyable = out of stock + gone (' + sum.unavail + ')', K['Not buyable'] === n0(sum.unavail), K);
    ok('Out of stock in feed (' + sum.oos + ') and Not in the feed (' + sum.gone + ') read apart', K['Out of stock in feed'] === n0(sum.oos) && K['Not in the feed'] === n0(sum.gone), K);
    ok('Conversion value on them is the engine\'s one-currency sum', K['Conversion value on them'] === E.money('GBP', sum.money.value), { got: K['Conversion value on them'], want: E.money('GBP', sum.money.value) });
    ok('Back in stock = the ledger products the feed carries in stock again (' + back.length + ')', K['Back in stock'] === n0(back.length), K);
    const split = await pg.evaluate(() => Array.from(document.querySelectorAll('#split i')).map((i) => i.className));
    ok('the split draws a segment per non-empty state, no "not stated" one here', split.join(',') === ['live', 'oos', 'gone', 'na'].filter((k) => sum[k] > 0).join(','), split);
    const catL = await pg.evaluate(() => Array.from(document.querySelectorAll('#cats .r .l')).map((l) => l.textContent));
    ok('where the lost demand sits: the engine\'s categories in its order, the gone bucket named', catL.join('|') === cats.map((c) => c.pt).join('|'), { catL, want: cats.map((c) => c.pt) });

    console.log('· the restock view — the list, the chips, the ledger\'s days');
    const tb = await pg.evaluate(() => Array.from(document.querySelectorAll('#t tbody tr')).map((tr) => ({ id: tr.getAttribute('data-id'), st: (tr.querySelector('.st') || {}).textContent, days: (tr.querySelector('.days') || {}).textContent })));
    ok('exactly the unavailable products, biggest conversion value first', tb.length === unavail.length && tb.map((r) => r.id).join(',') === unavail.map((r) => r.id).join(','), { got: tb.map((r) => r.id), want: unavail.map((r) => r.id) });
    ok('each row wears its state chip (Out of stock / Not in feed)', tb.every((r) => r.st === 'Out of stock' || r.st === 'Not in feed') && tb.some((r) => r.st === 'Not in feed'), tb);
    const r102 = tb.find((r) => r.id === 'NW102-M'), rG2 = tb.find((r) => r.id === 'NW-GONE-2'), rG1 = tb.find((r) => r.id === 'NW-GONE-1');
    ok('days unavailable are the LEDGER\'s: 12 d for a product first seen 12 days ago, 5 d for the gone one', r102 && /^12\s*d$/.test(r102.days.replace(/\s+/g, ' ')) && rG1 && /^5\s*d$/.test(rG1.days.replace(/\s+/g, ' ')), { r102, rG1 });
    ok('a product the ledger never had reads "today" once this reading is recorded, never a day count', rG2 && rG2.days === 'today', rG2);
    const cnt = await pg.textContent('#cnt');
    ok('the count line names the rows', cnt.trim() === n0(unavail.length) + ' products', cnt);
    const stLine = await pg.textContent('#mstate');
    ok('the status line names the feed, the 30-day window, the products served and when tracking began', /Feed · \d+ products/.test(stLine) && /Google Ads · last 30 days/.test(stLine) && /products served/.test(stLine) && /Tracking since/.test(stLine), stLine);

    console.log('· the observation the page reported');
    const put = await pg.evaluate(() => window.__rsPut && window.__rsPut[0]);
    ok('one PUT, carrying the out-of-stock ids, the gone ids and the returned ids the engine computes', put && put.oos.slice().sort().join(',') === obs.oos.slice().sort().join(',') && put.gone.slice().sort().join(',') === obs.gone.slice().sort().join(',') && put.back.slice().sort().join(',') === obs.back.slice().sort().join(',') && put.n === rows.length && put.feedN === feedN, { put, obs });
    ok('a product already stamped as returned is not reported again; the one seen returning now is', put && put.back.indexOf('NW101-L') >= 0 && put.back.indexOf('NW100-M') < 0, put && put.back);

    console.log('· the other views, a sort, the filter');
    await pg.click('#views [data-v="back"]'); await pg.waitForTimeout(200);
    const bk = await pg.evaluate(() => Array.from(document.querySelectorAll('#t tbody tr')).map((tr) => ({ id: tr.getAttribute('data-id'), st: (tr.querySelector('.st') || {}).textContent, th: document.getElementById('th-since').textContent })));
    ok('Back in stock lists the returned products with what they were', bk.length === back.length && bk.map((r) => r.id).sort().join(',') === back.map((r) => r.id).sort().join(',') && bk.every((r) => /^Back · was /.test(r.st)) && bk[0].th === 'Days it was unavailable', bk);
    await pg.click('#views [data-v="all"]'); await pg.waitForTimeout(200);
    const all = await pg.evaluate(() => document.querySelectorAll('#t tbody tr').length);
    ok('All demanded lists every product served (' + rows.length + ')', all === rows.length, all);
    await pg.click('#t th[data-k="clicks"]'); await pg.waitForTimeout(200);
    const first = await pg.evaluate(() => document.querySelector('#t tbody tr').getAttribute('data-id'));
    ok('a column sort: most clicks first', first === byClicks[0].id, { first, want: byClicks[0].id });
    await pg.fill('#q', q); await pg.waitForTimeout(350);
    const fN = await pg.evaluate(() => document.querySelectorAll('#t tbody tr').length);
    ok('the filter narrows to the products whose id, title or category carry "' + q + '" (' + qN + ')', fN === qN && qN > 0 && qN < rows.length, { fN, qN });
    const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }).catch(() => null), pg.click('#csv')]);
    let csvLines = 0, csvName = '';
    if (dl) { csvName = dl.suggestedFilename(); const p2 = await dl.path(); csvLines = fs.readFileSync(p2, 'utf8').trim().split('\r\n').length; }
    ok('⬇ CSV downloads the table as shown — a header and one line per filtered row', !!dl && /^restock_Northwind_gb_all_/.test(csvName) && csvLines === qN + 1, { csvName, csvLines, want: qN + 1 });
    ok('no console error on the way', errs.length === 0, errs);
    await ctx.close();

    console.log('· a ?view= deep link');
    const c2 = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p2 = await c2.newPage(); await p2.addInitScript(STUB);
    await p2.goto('file://' + tmp + '?brand=' + encodeURIComponent(STUBS.CLIENT) + '&market=gb&view=back');
    await p2.waitForFunction(() => window.__FCCRestock && window.__FCCRestock.state().joined, null, { timeout: 30000 });
    await p2.waitForTimeout(200);
    const dv = await p2.evaluate(() => ({ v: window.__FCCRestock.state().view, on: (document.querySelector('#views .on') || {}).getAttribute && document.querySelector('#views .on').getAttribute('data-v'), h: document.getElementById('tbl-h').textContent }));
    ok('lands on the Back-in-stock view', dv.v === 'back' && dv.on === 'back' && dv.h === 'Back in stock', dv);
    await c2.close();

    // ---------------------------------------------------------------- phone
    console.log('· 390px — no sideways scroll, the KPI band two a row, the table pans in its frame');
    const mc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const mp = await mc.newPage(); await mp.addInitScript(STUB);
    await mp.goto('file://' + tmpS);
    await mp.waitForFunction(() => window.__FCCRestock && window.__FCCRestock.state().joined, null, { timeout: 30000 });
    await mp.evaluate('window.FCCDigest && FCCDigest.expandAll({ silent: true })').catch(() => {});
    await mp.waitForTimeout(400);
    const ph = await mp.evaluate(() => {
      const ks = Array.from(document.querySelectorAll('#kp .kpi')).map((k) => k.getBoundingClientRect());
      const tw = document.querySelector('#tbl-card .tw');
      // the skim view (digest_widget) lays the band out 3-up under 760px, the phone layer 2-up — either way every tile sits inside the screen and the band is at least two a row
      const perRow = ks.filter((r) => Math.abs(r.top - ks[0].top) < 2).length;
      return { sw: document.documentElement.scrollWidth, W: innerWidth, k: ks.length, perRow, inside: ks.every((r) => r.right <= innerWidth + 1 && r.left >= -1), pans: tw.scrollWidth > tw.clientWidth + 10, twRight: tw.getBoundingClientRect().right };
    });
    ok('nothing scrolls sideways', ph.sw <= ph.W + 1, ph);
    ok('six tiles, at least two a row, every one inside the screen', ph.k === 6 && ph.perRow >= 2 && ph.perRow <= 3 && ph.inside, ph);
    ok('the table pans inside its own frame, the frame inside the screen', ph.pans && ph.twRight <= ph.W + 1, ph);
    await mc.close();
  } finally { await b.close(); [tmp, tmpS].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} }); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('✗ harness error: ' + (e && e.stack || e)); process.exit(1); });
