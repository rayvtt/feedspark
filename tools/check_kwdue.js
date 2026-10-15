#!/usr/bin/env node
/*
 * Workflow — the Keyword Calendar's briefing actions, centralised here
 * (Ray, 14 Oct 2026: "bring the briefing action into the workflows as well … so the account
 * manager can remember when to brief rather than flip to the keyword calendar module …
 * when hitting brief, button in Workflow, that action is flipped back into the keyword calendar
 * module and then saved in the brief workflow as usual. Do not duplicate the task.")
 *
 * The two halves that can only be proved on the real page: that → Brief here raises the SAME
 * brief the calendar card raises (same task, same scope, same kw stamp — which is what flips it
 * back), and that a moment already carrying a ticket is never offered, so the second ticket can
 * never be raised.
 *
 * Run: node tools/check_kwdue.js        (skips cleanly where Playwright is unavailable)
 */
const path = require('path');
const { installEngineRoutes } = require('./engine_routes.js');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// Two brands. Northwind has three moments — one already briefed (a ticket stamped with its id),
// one overdue, one due soon. Harbour has one, to prove the band spans the book.
const soon = (d) => { const t = new Date(Date.now() + d * 86400000); return t.toISOString().slice(0, 10); };
const KW = {
  Northwind: { events: [
    { id: 'n1', name: 'Festive knitwear', date: soon(5),  terms: ['christmas jumper', 'cable knit'] },  // brief was due 16 days ago
    { id: 'n2', name: 'Winter outerwear', date: soon(26), terms: ['puffer'] },                           // due in 5 days
    { id: 'n3', name: 'Already briefed',  date: soon(30) } ],
    ptidx: { gb: { map: { 'Jumpers': 400 }, __total: 1000, sat: { n: 300 } } } },
  // Ray, 14 Oct 2026: a brief-by weeks past is a wrong date, not a late task — this one is
  // 46 days past and must leave the band, named rather than silently dropped.
  Harbour: { events: [ { id: 'h1', name: 'Spring drop', date: soon(28), brandwide: 1 },
    { id: 'h2', name: 'Window long gone', date: soon(-25) },
    { id: 'h3', name: 'Done one', date: soon(10) },
    { id: 'h4', name: 'Blocked one', date: soon(12) } ],
    ptidx: { gb: { map: {}, __total: 500, sat: { n: 100 } } } }
};
KW.Northwind.events[0].ptsm = { gb: ['Jumpers'] };
const BRIEFS = {
  t9: { id: 't9', client: 'Northwind', kw: 'n3', task: 'Keywords Optimisation - Already briefed', status: 'briefed', created: 1, by: 'Steven' },
  // Ray, 15 Oct 2026: the briefed half, with its status — a blocked one, which the fold's own
  // summary has to name, and a finished one, which must not be counted as still moving
  t8: { id: 't8', client: 'Harbour', kw: 'h4', task: 'Keywords Optimisation - Blocked one', status: 'blocked', created: 1 },
  t7: { id: 't7', client: 'Harbour', kw: 'h3', task: 'Keywords Optimisation - Done one', status: 'confirmed', created: 1 } };

const INIT = "window.__puts=[];(function(){var real=window.fetch;window.fetch=function(u,o){u=String(u);"
  + "var j=function(x){return Promise.resolve(new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(/engine\\.js/.test(u))return real(u,o);"
  + "if(u.indexOf('/api/briefs')>=0&&o&&o.method==='PUT'){window.__puts.push(JSON.parse(o.body));return j({});}"
  + "if(u.indexOf('/api/kwcal')>=0)return j(" + JSON.stringify(KW) + ");"
  + "if(u.indexOf('/api/briefs')>=0)return j(" + JSON.stringify(BRIEFS) + ");"
  + "if(u.indexOf('/api/access')>=0)return j({ok:1,modules:null,clients:null});"
  + "if(u.indexOf('/api/schedule')>=0)return j({ok:0});"
  + "return j({});};})();";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await installEngineRoutes(ctx);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await ctx.addInitScript({ content: INIT });
  await page.goto('file://' + path.join(D, 'FeedSpark_Workflow.html'));
  await page.waitForTimeout(2200);

  const band = async () => page.$eval('#kwd-band', (n) => ({
    hidden: n.hidden, sub: n.querySelector('#kwd-sub').textContent,
    // the to-brief rows ONLY — the briefed group below shares the row class
    rows: [...n.querySelectorAll('#kwd-rows .kwd-row')].map((r) => ({
      when: r.querySelector('.kwd-when').textContent.trim(),
      who: r.querySelector('.kwd-who').textContent.trim(),
      name: r.querySelector('.kwd-nm').textContent.trim(),
      scope: r.querySelector('.kwd-sc').textContent.trim(),
      late: r.classList.contains('late'), soon: r.classList.contains('soon') })),
    stale: (n.querySelector('#kwd-stale') || { textContent: '' }).textContent.trim()
  }));

  console.log('\n1) the calendar’s unbriefed moments are ON the Workflow board');
  ok('no page error', errs.length === 0, errs.slice(0, 3));
  ok('the engine loaded — the page did not fall back to its own copy',
    (await page.evaluate(() => typeof window.FeedKwCal)) === 'object');
  const b = await band();
  ok('the band is shown', !b.hidden);
  ok('one row per moment still to brief, across brands', b.rows.length === 3, b.rows.map((r) => r.name));
  ok('the moment that already has a ticket is NOT offered',
    !b.rows.some((r) => /Already briefed/.test(r.name)), b.rows.map((r) => r.name));
  ok('the overdue one leads', /late/.test(b.rows[0].when), b.rows[0]);
  ok('…and is marked as overdue', b.rows[0].late);
  ok('the summary counts them', /3 to brief/.test(b.sub) && /overdue/.test(b.sub), b.sub);
  ok('a moment more than 20 days past its brief-by is NOT listed',
    !b.rows.some((r) => /Window long gone/.test(r.name)), b.rows.map((r) => r.name));
  ok('…and the band says so, with the way back', /1 moment more than 20 days past/.test(b.stale)
    && /Re-date them on the calendar/.test(b.stale), b.stale);

  console.log('\n2) each row carries what you need to decide, not a number it does not have');
  const fest = b.rows.find((r) => /Festive/.test(r.name));
  ok('a scoped moment shows its product count', fest.scope === '400 products', fest.scope);
  ok('…and its themes', /cable knit/.test(fest.name), fest.name);
  const spring = b.rows.find((r) => /Spring/.test(r.name));
  ok('a brand-wide moment says so', spring.scope === 'whole catalogue', spring.scope);
  const wint = b.rows.find((r) => /Winter/.test(r.name));
  ok('an unscoped moment is still listed, and says it has no scope', wint.scope === 'no scope yet', wint.scope);
  ok('…and names its brand', wint.who === 'Northwind', wint.who);

  console.log('\n2b) …and what IS briefed, with where it has got to');
  // Ray, 15 Oct 2026: "with keywords calendar, also shown the briefed events (and status)"
  const done = async () => page.$eval('#kwd-done', (n) => ({
    hidden: n.hidden,
    open: n.querySelector('#kwd-dh').getAttribute('aria-expanded') === 'true',
    sum: n.querySelector('#kwd-dsum').textContent.trim(),
    bodyShown: !n.querySelector('#kwd-drows').hidden,
    rows: [...n.querySelectorAll('#kwd-drows .kwd-row')].map((r) => ({
      name: r.querySelector('.kwd-nm').textContent.trim(),
      stage: (r.querySelector('.kwd-st') || {}).textContent,
      court: (r.querySelector('.kwd-ct') || {}).textContent,
      hasBrief: !!r.querySelector('.kwd-go'),
      ticket: !!r.querySelector('.kwd-tk') })) }));
  let d = await done();
  ok('the briefed group is shown', !d.hidden);
  ok('a fresh device finds it folded — the actionable rows keep the top', !d.open && !d.bodyShown, d);
  ok('…but its summary already counts them', /3 briefed/.test(d.sum), d.sum);
  ok('…names what is still moving', /2 still moving/.test(d.sum), d.sum);
  ok('…and never hides a blocked ticket behind the fold', /1 blocked/.test(d.sum), d.sum);
  await page.click('#kwd-dh');
  await page.waitForTimeout(250);
  d = await done();
  ok('it opens', d.open && d.bodyShown && d.rows.length === 3, d.rows.map((r) => r.name));
  ok('every row is a moment that HAS a ticket', d.rows.every((r) => r.ticket), d.rows);
  ok('…and none offers a second → Brief', !d.rows.some((r) => r.hasBrief), d.rows);
  // pipeline order, earliest stage first — the finished work sinks to the bottom
  ok('the least-advanced leads and the finished sinks',
    d.rows.map((r) => r.name).join('|') === 'Already briefed|Blocked one|Done one', d.rows.map((r) => r.name));
  ok('each row carries the stage in Workflow’s OWN words, not the raw key',
    d.rows.map((r) => r.stage).join('|') === 'Briefed to ASPL|Blocked|Client confirmed',
    d.rows.map((r) => r.stage));
  ok('…and whose court it sits in',
    d.rows.map((r) => r.court).join('|') === 'ASPL|AM|', d.rows.map((r) => r.court));
  // no moment in both halves — the two lists are one tie read twice
  {
    const b2 = await band();
    const both = d.rows.filter((r) => b2.rows.some((x) => x.name === r.name));
    ok('no moment is in both halves of the band', both.length === 0, both);
  }
  // a briefed row opens the ticket on THIS page rather than linking to the page we are on
  await page.evaluate(() => { window.__tk = null; const r = window.FCCTicket; window.FCCTicket = (id) => { window.__tk = id; r && 0; }; });
  await page.click('#kwd-drows .kwd-row:has-text("Blocked one") .kwd-tk');
  await page.waitForTimeout(200);
  ok('clicking it opens its own ticket', (await page.evaluate(() => window.__tk)) === 't8',
    await page.evaluate(() => window.__tk));
  // the fold is this device's, and it survives a reload
  await page.reload();
  await page.waitForTimeout(2000);
  ok('the fold is remembered on this device', (await done()).open);
  await page.click('#kwd-dh');
  await page.waitForTimeout(200);
  ok('…and folding it again sticks', !(await done()).open);

  console.log('\n3) → Brief raises the CALENDAR’s brief, through the page’s own composer');
  await page.click('.kwd-row:has-text("Festive") .kwd-go');
  await page.waitForTimeout(900);
  const comp = await page.evaluate(() => {
    const t = document.querySelector('#bg-task'), c = document.querySelector('#bg-client'),
      s = document.querySelector('#bg-scope'), k = document.querySelector('#bg-cat');
    return { task: t && t.value, client: c && c.value, scope: s && s.value, cat: k && k.value,
      kw: window.__kwId || null, open: !!document.querySelector('.bg-wrap,.scrim.on') };
  });
  ok('the composer opened', comp.open || !!comp.task, comp);
  ok('on the moment’s own brand', comp.client === 'Northwind', comp.client);
  ok('with the house task name the calendar would have used',
    /^Keywords Optimisation - Festive knitwear - Marketing Planner - /.test(comp.task || ''), comp.task);
  ok('the scope carries the moment, its dates and its themes',
    /Moment: Festive knitwear/.test(comp.scope || '') && /Keyword themes: christmas jumper/.test(comp.scope || ''), (comp.scope || '').slice(0, 90));
  ok('…and the categories it was scoped to', /Jumpers — 400 SKUs/.test(comp.scope || ''), (comp.scope || '').slice(0, 200));
  ok('the category is keyword work', comp.cat === 'keyword', comp.cat);
  // THE FLIP BACK: the moment's id rides the brief, which is what makes the calendar read it as
  // briefed for life and what stops this band ever offering it again
  ok('the moment id is stamped on the brief being composed', comp.kw === 'n1', comp.kw);

  console.log('\n4) the same brief, whichever surface raised it');
  const pair = await page.evaluate((kw) => {
    const E = window.FeedKwCal;
    const ev = kw.Northwind.events[0];
    const a = E.briefPayload(kw, 'Northwind', ev, 'gb');
    return { task: a.task, kw: a.kw, cat: a.cat, scope: a.scope };
  }, KW);
  ok('the composer was filled from the engine’s own payload, not a second builder',
    pair.task === comp.task && pair.cat === comp.cat && pair.kw === comp.kw
    && String(comp.scope).trim() === String(pair.scope).trim(), { built: pair.task, composed: comp.task });

  console.log('\n5) a brief that lands takes its moment off the list — no second ticket');
  await page.evaluate(() => {
    // the page's own save path: a brief carrying the moment's stamp
    const k = 'z1';
    const b = JSON.parse(localStorage.getItem('fcc-briefs') || '{}');
    b[k] = { id: k, client: 'Northwind', kw: 'n1', task: 'Keywords Optimisation - Festive knitwear', status: 'briefed', created: Date.now() };
    localStorage.setItem('fcc-briefs', JSON.stringify(b));
  });
  await page.evaluate((B) => {
    window.fetch = ((real) => (u, o) => {
      u = String(u);
      const j = (x) => Promise.resolve(new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } }));
      if (/engine\.js/.test(u)) return real(u, o);
      if (u.indexOf('/api/briefs') >= 0 && !(o && o.method === 'PUT')) return j(B);
      if (u.indexOf('/api/kwcal') >= 0) return j(window.__kwFix);
      return j({});
    })(window.fetch);
  }, { ...BRIEFS, z1: { id: 'z1', client: 'Northwind', kw: 'n1', task: 'x', status: 'briefed', created: 2 } });
  await page.evaluate((k) => { window.__kwFix = k; }, KW);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('fcc-briefs')));
  await page.waitForTimeout(800);
  const after = await band();
  ok('the briefed moment is gone from the band', !after.rows.some((r) => /Festive/.test(r.name)), after.rows.map((r) => r.name));
  ok('…and the others remain', after.rows.length === 2, after.rows.map((r) => r.name));

  console.log('\n6) the calendar fails HONESTLY if its engine does not load');
  // the worker once served an EMPTY 200 for an engine and the page simply died (docs/IMAGES.md).
  // The calendar now depends on one, so that failure must read as a sentence, not a TypeError.
  {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await c2.route('**/kwcal/engine.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await c2.addInitScript({ content: "window.fetch=function(u){u=String(u);var j=function(x){return Promise.resolve(new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}}))};if(u.indexOf('/api/feed/clients')>=0)return j({clients:{Northwind:{markets:['gb']}}});if(u.indexOf('/api/kwcal')>=0)return j({Northwind:{events:[{id:'a',name:'X',date:'2026-12-01'}]}});return j({});};" });
    const p2 = await c2.newPage();
    const e2 = []; p2.on('pageerror', (e) => e2.push(e.message));
    await p2.goto('file://' + path.join(D, 'FeedSpark_KWCal.html'));
    await p2.waitForTimeout(1200);
    ok('an empty engine throws nothing', e2.length === 0, e2.slice(0, 2));
    ok('…and the board says what is wrong', await p2.$eval('#kw-error', (n) => n.classList.contains('on')));
    ok('…naming the file, so it is actionable',
      /kwcal\/engine\.js/.test(await p2.$eval('#kw-error-msg', (n) => n.textContent)));
    await c2.close();
  }

  console.log('\n7) the phone');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const of = await page.evaluate(() => {
    const n = document.querySelector('#kwd-band');
    return { over: n.scrollWidth > n.clientWidth + 1, vis: !n.hidden };
  });
  ok('the band fits a phone', !of.over && of.vis, of);

  await browser.close();
  console.log(fail ? '\nFAIL ' + fail : '\nPASS');
  process.exit(fail ? 1 : 0);
})();
