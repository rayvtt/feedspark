#!/usr/bin/env node
/*
 * tools/check_stockfold.js — every /stock card folds, as a person uses it.
 *
 * Ray, 7 Oct 2026: "each module info on Stock Management is collapsible pls - too many at once". Each card's title is ONE
 * button (chevron · title · the line that survives the fold); a fresh device opens the overview Ray asked to see first
 * (which controls each market runs) and the levers, the rest folded; what a person folds or opens by hand is the device's;
 * a link or a jump to something inside a folded card opens it for the visit. What is folded is a property of the rendered
 * page, so this drives the real page through Chromium on the synthetic stub (tools/rules_stub.js — invented rules, no real
 * figure) and checks:
 *
 *   · a fresh device: the overview and the levers open, every other card one row — its content not painted, its line kept
 *   · each folded card's line says what is in it (markets, rules, held back, findings …), never an empty row
 *   · a click on a title folds / opens that card and the device keeps it through a reload; Enter on the focused title too
 *   · ⊕ Expand all / ⊖ Collapse all does every card and always names the action still available
 *   · a deep link to a stock control (?mech=) opens the market setups; a #hash opens the card it names; a click on a
 *     coverage cell opens the setups at that market — none of them rewrites what the device chose
 *   · side by side, a folded card does not stretch to its open neighbour
 *   · on a phone the same fold: the skim view leaves these headings to the page, a tap on the title — or anywhere on its
 *     row — toggles exactly once, and nothing scrolls sideways
 *
 * Run: node tools/check_stockfold.js      (PW_CHROMIUM overrides the browser path; STOCK_PAGE=<file> checks another copy)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'docs');
const RS = require('./rules_stub.js');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'apps_widget.html', 'navrow_widget.html', 'mobile_widget.html', 'digest_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const PAGE = fs.readFileSync(process.env.STOCK_PAGE || path.join(D, 'FeedSpark_Stock.html'), 'utf8').split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
const HTML = PAGE.indexOf('</body>') >= 0 ? PAGE.replace('</body>', WIDGETS + '</body>') : PAGE + '\n' + WIDGETS;
const CARDS = ['cov-card', 'lev-card', 'av-card', 'hero-card', 'hmap-card', 'find-card', 'cut-card', 'setup-card', 'how-card'];
const OPEN0 = ['cov-card', 'lev-card'];

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
// a fresh device ONCE per tab — a reload keeps what the page stored (sessionStorage survives the reload, the clear does not)
const STUB = `try{if(!sessionStorage.getItem('fold-t')){localStorage.clear();sessionStorage.setItem('fold-t','1');}}catch(e){}
window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
${RS.stubLines()}
 return j({ok:false,error:'stub'},404);};`;

async function open(browser, w, h, q, ctxOpts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: h || 1000 } }, ctxOpts || {}));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/^https?:\/\//, (r) => {
    const u = new URL(r.request().url());
    if (u.host !== 'fcc.test' || u.pathname !== '/stock') return r.abort();
    return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
  });
  await p.addInitScript(STUB);
  await p.goto('http://fcc.test/stock' + (q || '?brand=Superdry'));
  await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000, state: 'attached' });
  await p.waitForTimeout(350);
  return { ctx, p, errs };
}
// every card as it is painted: open or folded, its height, whether its body is drawn, its line
const state = (p) => p.evaluate((ids) => ids.map((id) => {
  const c = document.getElementById(id), b = c && c.querySelector(':scope > .chead .fold'), fs = c && c.querySelector(':scope > .chead .fsum');
  const kids = c ? Array.from(c.children).filter((k) => !k.classList.contains('chead')) : [];
  const r = c ? c.getBoundingClientRect() : { height: 0 };
  return { id, hidden: !c || c.hidden, folded: !!c && c.classList.contains('folded'), exp: b ? b.getAttribute('aria-expanded') : null, h: Math.round(r.height),
    body: kids.some((k) => k.getBoundingClientRect().height > 0), sum: fs ? fs.textContent.trim() : '', sumShown: !!fs && fs.getBoundingClientRect().width > 0 };
}), CARDS);
const byId = (S) => { const o = {}; S.forEach((x) => { o[x.id] = x; }); return o; };
const stored = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('fcc-stock-fold') || '{}'); } catch (e) { return null; } });

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    console.log('· a fresh device');
    let { ctx, p, errs } = await open(browser, 1440, 1000);
    let S = byId(await state(p));
    ok('the overview and the levers open — every other card folded', CARDS.every((id) => S[id].folded === (OPEN0.indexOf(id) < 0)), CARDS.map((id) => id + ':' + (S[id].folded ? 'folded' : 'open')));
    ok('…each title says so to a screen reader (aria-expanded)', CARDS.every((id) => S[id].exp === (S[id].folded ? 'false' : 'true')), CARDS.map((id) => S[id].exp));
    const fd = CARDS.filter((id) => S[id].folded);
    ok('a folded card is ONE row (under 60px), its body not painted', fd.every((id) => S[id].h > 0 && S[id].h < 60 && !S[id].body), fd.map((id) => [id, S[id].h, S[id].body]));
    ok('…and keeps a line saying what is in it, never an empty row', fd.every((id) => S[id].sumShown && S[id].sum.length > 8), fd.map((id) => [id, S[id].sum]));
    ok('the lines read the card: markets and what Google is not sent; hero-size rules; product types mapped; findings; cut-offs; markets in view',
      /^· 2 markets/.test(S['av-card'].sum) && /held back from Google/.test(S['av-card'].sum) && /kept off/.test(S['av-card'].sum) && /hero-size rule/.test(S['hero-card'].sum) && /product types? mapped/.test(S['hmap-card'].sum)
      && /finding/.test(S['find-card'].sum) && /cut-off/.test(S['cut-card'].sum) && /market/.test(S['setup-card'].sum) && /stock control/.test(S['how-card'].sum), fd.map((id) => S[id].sum));
    ok('an open card shows no line in its title (its content says it)', OPEN0.every((id) => !S[id].sumShown && !S[id].folded), OPEN0.map((id) => S[id]));
    ok('the page header offers ⊕ Expand all (some cards are folded)', (await p.$eval('#fold-all', (b) => b.textContent.trim())) === '⊕ Expand all');
    const cv = await p.evaluate(() => { const c = document.getElementById('cov-card'); c.querySelector('.fold').click(); const f = c.querySelector('.fsum'); return { folded: c.classList.contains('folded'), t: f.textContent.trim() }; });
    ok('the overview folded reads its markets and rules (2 markets read · 20 stock rules · 1 not read yet)', cv.folded && cv.t === '· 2 markets · 20 stock rules · 1 not read yet', cv);
    await p.click('#cov-card .fold');

    console.log('· a click, the keyboard, and the device keeping it');
    await p.click('#av-card .fold');
    S = byId(await state(p));
    ok('a click on a folded title opens the card — its table painted, its line gone', !S['av-card'].folded && S['av-card'].body && !S['av-card'].sumShown && S['av-card'].exp === 'true', S['av-card']);
    await p.click('#lev-card .fold');
    await p.focus('#hero-card .fold'); await p.keyboard.press('Enter');
    S = byId(await state(p));
    ok('…a click folds an open one (the levers); Enter on a focused title opens it (hero-size runs) — the title is a real button', S['lev-card'].folded && !S['hero-card'].folded, [S['lev-card'].folded, S['hero-card'].folded]);
    const mem = await stored(p);
    ok('the device stores exactly what was chosen by hand', mem && mem['av-card'] === 1 && mem['lev-card'] === 0 && mem['hero-card'] === 1 && !('setup-card' in mem), mem);
    await p.reload(); await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000, state: 'attached' }); await p.waitForTimeout(350);
    S = byId(await state(p));
    ok('…and keeps it through a reload (in stock open, the levers folded, hero-size runs open, the rest as they were)', !S['av-card'].folded && S['lev-card'].folded && !S['hero-card'].folded && S['setup-card'].folded && !S['cov-card'].folded, CARDS.map((id) => id + ':' + (S[id].folded ? 'f' : 'o')));

    console.log('· every card at once');
    await p.click('#fold-all');
    S = byId(await state(p));
    ok('⊕ Expand all opens every card, and the button now offers ⊖ Collapse all', CARDS.every((id) => !S[id].folded) && (await p.$eval('#fold-all', (b) => b.textContent.trim())) === '⊖ Collapse all', CARDS.map((id) => S[id].folded));
    await p.click('#fold-all');
    S = byId(await state(p));
    ok('⊖ Collapse all folds every card — the overview and the levers too — and offers ⊕ Expand all again', CARDS.every((id) => S[id].folded) && (await p.$eval('#fold-all', (b) => b.textContent.trim())) === '⊕ Expand all', CARDS.map((id) => S[id].folded));
    const ph = await p.evaluate(() => document.documentElement.scrollHeight);
    ok('…a page of nine cards folded stands about one screen tall', ph < 1400, ph);
    await p.click('#cut-card .fold');
    const pair = await p.evaluate(() => ['find-card', 'cut-card'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().height)));
    ok('side by side, a folded card does not stretch to its open neighbour (findings folded beside open cut-offs)', pair[0] < 60 && pair[1] > 100, pair);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· links and jumps open what they point at, for the visit');
    ({ ctx, p, errs } = await open(browser, 1440, 1000, '?brand=Superdry&mech=threshold'));
    S = byId(await state(p));
    ok('a deep link to a stock control (?mech=threshold) opens the market setups', !S['setup-card'].folded && S['setup-card'].body, S['setup-card']);
    ok('…without rewriting what the device chose (nothing stored)', JSON.stringify(await stored(p)) === '{}', await stored(p));
    await ctx.close();
    ({ ctx, p, errs } = await open(browser, 1440, 1000, '?brand=Superdry#hero-card'));
    await p.waitForTimeout(250);
    const hc = await p.evaluate(() => { const c = document.getElementById('hero-card'), r = c.getBoundingClientRect(); return { folded: c.classList.contains('folded'), top: Math.round(r.top), vh: innerHeight }; });
    ok('a #hash opens the card it names and brings it into view', !hc.folded && hc.top >= -2 && hc.top < hc.vh / 2, hc);
    await ctx.close();
    ({ ctx, p, errs } = await open(browser, 1440, 1000));
    await p.click('#cov tbody td[data-cell^="Superdry|DE|threshold"]');
    await p.waitForTimeout(600);
    const jc = await p.evaluate(() => { const c = document.getElementById('setup-card'), el = document.getElementById('set-superdry_de'); return { folded: c.classList.contains('folded'), el: !!el, top: el ? Math.round(el.getBoundingClientRect().top) : null, vh: innerHeight }; });
    ok('a click on a coverage cell opens the market setups at that market', !jc.folded && jc.el && jc.top !== null && jc.top >= -2 && jc.top < jc.vh, jc);
    ok('…for the visit — the device’s choice is not rewritten', !('setup-card' in ((await stored(p)) || {})), await stored(p));
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· on a phone');
    ({ ctx, p, errs } = await open(browser, 390, 844, '?brand=Superdry', { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }));
    await p.waitForTimeout(800);
    S = byId(await state(p));
    ok('the same fold on the phone: the overview and the levers open, the rest folded', CARDS.every((id) => S[id].folded === (OPEN0.indexOf(id) < 0)), CARDS.map((id) => id + ':' + (S[id].folded ? 'f' : 'o')));
    const dg = await p.evaluate(() => (window.FCCDigest ? window.FCCDigest.state() : null));
    ok('the phone’s skim view leaves these headings to the page (none of the cards is one of its sections)', dg && !(dg.keys || []).some((k) => /-card/.test(k)), dg);
    const exp = (id) => p.$eval('#' + id + ' .fold', (b) => b.getAttribute('aria-expanded'));
    const t0 = await exp('av-card'); await p.tap('#av-card .fold'); await p.waitForTimeout(150);
    const t1 = [t0, await exp('av-card')];
    ok('a tap on the title opens the card — once', t1[0] === 'false' && t1[1] === 'true', t1);
    // a tap at the far end of a short title's row ("Needs a look") — past its words. Whether that spot is the title's button
    // (the phone layer may stretch it across the row) or the heading beside it (which the skim view hands to the button),
    // the card must end up toggled ONCE, never twice back to where it was
    await p.$eval('#find-card', (c) => c.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(150);
    const row = await p.evaluate(() => { const h = document.querySelector('#find-card > .chead h3'), t = h.querySelector('.fold'), hr = h.getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(t); const tr = r.getBoundingClientRect(); return { x: Math.round(hr.right - 8), y: Math.round(hr.top + hr.height / 2), past: Math.round(hr.right - 8 - tr.right), vh: innerHeight }; });
    const f0 = await exp('find-card');
    await p.touchscreen.tap(row.x, row.y); await p.waitForTimeout(150);
    const f1 = await exp('find-card');
    ok('…a tap at the far end of a title’s row, past its words, toggles it — once, never twice', row.past > 40 && row.y > 0 && row.y < row.vh && f0 === 'false' && f1 === 'true', [row, f0, f1]);
    const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
    ok('nothing scrolls sideways on the phone', ov.sw <= ov.vw, ov);
    ok('no page errors on the phone', errs.length === 0, errs);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
