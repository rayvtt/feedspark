#!/usr/bin/env node
/*
 * tools/check_roasseg.js — THE ROAS SEGMENT, RENDERED.
 *
 * Ray, 28 Sep 2026, over a screenshot of the Performance table (filter "schuh", Segment · Category,
 * the "No activity" band chip on, the footer reading "1 brand · 0 markets shown"): "in Roas module -
 * segment doesnt populate properly". Three separate things put that picture on the screen, and a
 * source read cannot see any of them, so this drives the real page through Chromium:
 *
 *   1. A SEGMENT IS READ PER MARKET, so picking one changed nothing until a market was opened by
 *      hand. Picking one now opens the markets in view (under an open brand, passing the search),
 *      busiest by clicks first, capped at SEG_AUTO so one choice can never fire a live FeedHero read
 *      per roster market.
 *   2. THE BAND FILTER HIDES A MARKET BY ITS OWN BAND, silently — every Schuh market has spend, so
 *      "No activity" left the brand row alone above nothing. The open brand now carries a line
 *      naming how many markets the filter hid, with one click to show them, and so does the footer.
 *   3. PRICE GROUP IS NOT SET UP IN FEEDHERO for any of the seven roster brands (checked live on
 *      28 Sep 2026: "Reports not found for Price group" on all of them). That reads as an honest
 *      "not set up for this market", never a red error.
 *
 * And two smaller ones on the way: typing a brand's name opens that brand, and a chevron opened by
 * default (or by the search) closes on the FIRST click — the toggle used to flip a flag that was
 * never set, so it took two.
 *
 * The page and the synthetic book are the shipped ones (tools/roas_stub.js — no real figure).
 * Run: node tools/check_roasseg.js      (PW_CHROMIUM overrides the browser path)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'docs', 'FeedSpark_ROAS.html');
const D = require('./roas_stub.js').build();

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

// the live segment read: Brand / Gender answer with rows, Price group answers "not set up" the way
// the worker now returns FeedHero's "Reports not found" — ok, no rows, missing:true
const LIVE_ROWS = D.live.rows;
const STUB = `
  window.__live = [];
  window.fetch = function (url) {
    url = String(url);
    var j = function (o) { return Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })); };
    if (url.indexOf('/api/roas/live') >= 0) {
      var q = new URL(url, location.href).searchParams; window.__live.push(q.get('cmpid') + '|' + q.get('agg'));
      if (q.get('agg') === 'Price_group') return j({ ok: true, cmpid: q.get('cmpid'), agg: 'Price_group', rows: [], n: 0, missing: true, at: Date.now() });
      return j({ ok: true, cmpid: q.get('cmpid'), agg: q.get('agg'), at: Date.now(), rows: ${JSON.stringify(LIVE_ROWS)}, n: ${LIVE_ROWS.length} });
    }
    if (url.indexOf('/api/roas?client=') >= 0) return j(${JSON.stringify(D.market)});
    if (url.indexOf('/api/roas') >= 0) return j(${JSON.stringify(D.book)});
    return j({ ok: false, error: 'stub' });
  };`;

async function open(browser, qs) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(STUB);
  await p.goto('file://' + PAGE + (qs || ''));
  await p.waitForSelector('#pt tbody tr', { timeout: 10000 });
  await p.waitForTimeout(250);
  return { ctx, p, errs };
}
const rows = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#pt tbody tr')).map((tr) => ({
  key: tr.getAttribute('data-key') || '', text: tr.textContent.replace(/\s+/g, ' ').trim(), tot: tr.classList.contains('tot'),
  open: !!(tr.querySelector('[data-tg]') && tr.querySelector('[data-tg]').getAttribute('aria-expanded') === 'true') })));
const foot = (p) => p.evaluate(() => document.getElementById('pt-foot').textContent.replace(/\s+/g, ' ').trim());
const pickSeg = (p, v) => p.selectOption('#seg', v).then(() => p.waitForTimeout(250));

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  console.log('· typing a brand opens it; picking a segment populates its markets');
  {
    const { ctx, p, errs } = await open(browser);
    await p.fill('#q', 'schuh'); await p.waitForTimeout(150);
    let r = await rows(p);
    const brand = r.find((x) => x.key === 'b|Schuh');
    ok('the search "schuh" opens the Schuh brand without a click', brand && brand.open, brand);
    ok('…so its market is on screen', r.some((x) => x.key === 'm|schuh_uk_1'), r.map((x) => x.key));
    await pickSeg(p, 'Brand');
    r = await rows(p);
    const mk = r.find((x) => x.key === 'm|schuh_uk_1');
    ok('picking Segment · Brand opens the market in view', mk && mk.open, mk);
    ok('…and its brand cut is on screen (Nike / Adidas / Converse)', ['Nike', 'Adidas', 'Converse'].every((n) => r.some((x) => x.key.indexOf('m|schuh_uk_1|s') === 0 && x.text.indexOf(n) >= 0)), r.map((x) => x.text.slice(0, 40)));
    ok('the footer counts the cut rows as brand rows', /3 brand rows shown/.test(await foot(p)), await foot(p));
    ok('the choice is in the link', await p.evaluate(() => /seg=Brand/.test(location.search)));
    const live = await p.evaluate(() => window.__live.slice());
    ok('one live read, for the market in view only (the search leaves Superdry out)', live.length === 1 && live[0] === 'schuh_uk_1|Brand', live);

    console.log('· the band filter says what it hid');
    await p.click('#bands [data-band="none"]'); await p.waitForTimeout(150);
    r = await rows(p);
    const note = r.find((x) => x.key === 'b|Schuh|bandhid');
    ok('"No activity" on: the Schuh market (Weak) is hidden…', !r.some((x) => x.key === 'm|schuh_uk_1'), r.map((x) => x.key));
    ok('…and the brand says so, right under it', !!note && /1 market hidden by the band filter \(No activity\)/.test(note.text), note);
    ok('the footer says it too', /1 market hidden by the band filter/.test(await foot(p)), await foot(p));
    await p.click('#pt tbody [data-clear-bands]'); await p.waitForTimeout(150);
    r = await rows(p);
    ok('"Show them" clears the band filter and the market comes back', r.some((x) => x.key === 'm|schuh_uk_1') && !(await p.evaluate(() => document.querySelector('#bands .chip.on'))), r.map((x) => x.key));

    console.log('· Price group is not set up in FeedHero — said, never an error');
    await pickSeg(p, 'Price_group');
    r = await rows(p);
    const pg = r.find((x) => x.key === 'm|schuh_uk_1|n');
    ok('the market reads "no price group report set up", not a red error', pg && /no price group report set up for this market/.test(pg.text) && !/Could not/.test(pg.text), pg);

    console.log('· a chevron opened for you closes on the first click');
    await p.click('#pt tbody tr[data-key="b|Schuh"] [data-tg]'); await p.waitForTimeout(150);
    r = await rows(p);
    ok('one click closes the brand the search opened', (r.find((x) => x.key === 'b|Schuh') || {}).open === false && !r.some((x) => x.key === 'm|schuh_uk_1'), r.map((x) => x.key + (x.open ? '+' : '')));
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('· nothing open: picking a segment says where to start, and reads nothing');
  {
    const { ctx, p, errs } = await open(browser);
    await pickSeg(p, 'Gender');
    ok('no brand open → the footer says to open one', /Open a brand \(or pick one above\) to cut its markets by gender/.test(await foot(p)), await foot(p));
    ok('…and no live read was fired', (await p.evaluate(() => window.__live.length)) === 0);
    await p.click('#expand-all'); await p.waitForTimeout(150);
    await pickSeg(p, 'Brand');
    const r = await rows(p);
    const opened = r.filter((x) => /^m\|/.test(x.key) && x.key.split('|').length === 2 && x.open).length;
    const live = await p.evaluate(() => window.__live.slice());
    ok('every brand open → every market in view opens (3 in the stub, under the cap of 8)', opened === 3, opened);
    ok('…one live read per market, never more', live.length === 3 && new Set(live).size === 3, live);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('· a deep link carrying a segment lands populated');
  {
    const { ctx, p, errs } = await open(browser, '?brand=Schuh&seg=Gender');
    await p.waitForTimeout(300);
    const r = await rows(p);
    ok('?seg=Gender opens the markets in scope on load', r.some((x) => x.key.indexOf('m|schuh_uk_1|s') === 0), r.map((x) => x.key));
    ok('the select shows the linked segment', (await p.inputValue('#seg')) === 'Gender');
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  const src = fs.readFileSync(PAGE, 'utf8');
  console.log('· the cap is in the page');
  ok('SEG_AUTO caps what one choice opens (8)', /var SEG_AUTO=8;/.test(src));
  ok('busiest by CLICKS — a count, so no currency is compared', /vis\.sort\(function\(a,b\)\{ return \(\(b\.t&&b\.t\.clicks\)\|\|0\)-\(\(a\.t&&a\.t\.clicks\)\|\|0\); \}\);/.test(src));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
