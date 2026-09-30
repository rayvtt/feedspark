#!/usr/bin/env node
/* FS Task Manager — WHAT THE HOURS MOVED, rendered.
 *
 * Ray, 28 Sep 2026: charts "for procurement heads/ senior executives to defend feedspark services".
 * A row of hours cannot answer what the spend produced, so the brand's outcome is drawn under it on
 * the same months — two plots, one calendar, each on its own axis.
 *
 * The reducing is pinned by tools/test_outcomes.mjs. THIS is the half a source read cannot reach,
 * and on this card every one of these has bitten before:
 *
 *   · A PANEL THAT DRAWS WHEN IT SHOULD NOT. It needs a calendar to share and ONE account; on a
 *     donut, or across two brands, a score line under the hours invites a reading the data cannot
 *     support. Both refusals must SAY which they are — a blank strip that could mean "no movement"
 *     or "never scanned" is worse than no strip.
 *   · A GAP DRAWN AS A LINE. The scan history began in Sep 2026, so most windows have unmeasured
 *     months. Joining across one would show a client a trend through months nobody measured.
 *   · A PNG THAT DROPS IT. These go straight into a client deck, so the export has to carry BOTH
 *     panels at the same width, or the slide shows hours with no outcome under them.
 *   · A CONTROL THAT PAINTS OPEN. `hidden` loses to any class that sets display, which is how three
 *     menus once shipped open on this very card — so every check reads the PAINT, never the property.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_outcomes.js   (presync) */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const page = fs.readFileSync(path.join(D, 'FeedSpark_TaskManager.html'), 'utf8');
// this page carries no </body>, so the widgets are APPENDED
const W = ['instr_collapse.html', 'presence_widget.html', 'hours_widget.html', 'mobile_widget.html']
  .map(f => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');

const CLIENTS = ['Reiss', 'Superdry'];
const TITLES = ['Keyword optimisation', 'Title optimisation', 'Category mapping', 'Client call'];
const rows = [];
let i = 0;
CLIENTS.forEach((c) => { for (let m = 4; m <= 9; m++) for (let k = 0; k < 3; k++) {
  i++;
  rows.push({ d: '2026-0' + m + '-1' + k, client: c, market: 'GB', am: 'Ray', owner: ['Ray', 'Febin'][i % 2],
    title: TITLES[i % 4] + ' ' + i, status: 'done', cat: ['opt', 'tech', 'feat', 'acct'][i % 4],
    bucket: 'done', bill: 1 + (i % 3) * 0.5, nonbill: (i % 4) * 0.25,
    hours: 1 + (i % 3) * 0.5 + (i % 4) * 0.25, sched: 1, id: 2000 + i, ticket: 0, note: '' });
} });
const ACC = CLIENTS.map((c, n) => ({ cid: n + 1, tid: n + 1, client: c, market: 'GB', name: c + ' - GB',
  group: '', flag: 0, status: 'active', type: 'FM', am: 'Ray', am2: '', allowance: 35, used: 20,
  balance: 15, health: 'healthy', since: '2019-01-01' }));
const DATA = { from: '2025-10-01', to: '2026-09-29', months: 12, at: Date.now(), rows, tickets: [], accounts: ACC,
  coverage: [], ticketCoverage: [], health: { read: 2, total: 2, partial: 0, oldest: Date.now(), newest: Date.now(), complete: true, staleHours: 0 },
  scoped: false, queuesTotal: 0 };

/* THE OUTCOME THE STUB SERVES. Two markets, and a deliberate HOLE in July: the panel must break
   its line there rather than join Jun to Aug through a month nobody measured. Superdry is served
   with no readings at all, so the "nothing to plot" path is exercised on a real account rather
   than only on a missing one. */
const OUT = {
  Reiss: { ok: true, client: 'Reiss', months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
    metrics: {
      gs: { '2026-05': { v: 80.2, n: 2 }, '2026-06': { v: 83.1, n: 2 }, '2026-08': { v: 88.4, n: 3 }, '2026-09': { v: 91.0, n: 3 } },
      q: { '2026-08': { v: 79.5, n: 1 } },
      air: {},
    },
    measured: { gs: 4, q: 1, air: 0 }, results: {}, feeds: 3,
    scale: { markets: 28, scanned: 3, rows: 47013, at: Date.now() },
    sources: [{ k: 'feeds', ok: true, n: 3, markets: ['GB', 'DE', 'US'] },
      { k: 'air', ok: false, why: 'no ai-readiness reading falls in this window' }] },
  Superdry: { ok: true, client: 'Superdry', months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
    metrics: { gs: {}, q: {}, air: {} }, measured: { gs: 0, q: 0, air: 0 }, results: {}, feeds: 0,
    scale: { markets: 4, scanned: 0, rows: 0, at: 0 },
    sources: [{ k: 'feeds', ok: false, why: 'no market of this brand has a scan history yet' }] },
};

const panel = () => {
  const box = document.getElementById('coutbox');
  const svg = box && box.querySelector('svg');
  const b = box ? box.getBoundingClientRect() : null;
  return {
    painted: !!box && getComputedStyle(box).display !== 'none',
    svg: !!svg,
    paths: svg ? svg.querySelectorAll('path').length : 0,
    dots: svg ? svg.querySelectorAll('circle').length : 0,
    empty: (box && box.querySelector('.cout-empty') ? box.querySelector('.cout-empty').textContent : '').trim(),
    cap: (document.getElementById('cout-cap') || {}).textContent || '',
    scale: (() => { const b = document.getElementById('cscale');
      return b && getComputedStyle(b).display !== 'none' ? b.textContent.replace(/\s+/g, ' ').trim() : ''; })(),
    note: (document.getElementById('cout-n') || {}).textContent || '',
    sub: (document.getElementById('cwsub') || {}).textContent || '',
    left: b ? Math.round(b.left) : null, right: b ? Math.round(b.right) : null, vw: innerWidth,
    scroll: document.documentElement.scrollWidth,
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const WIDTH of [1440, 390]) {
    console.log('\n── ' + WIDTH + 'px');
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 } });
    const p = await ctx.newPage();
    const errs = [];
    let calls = 0;
    p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    // ROUTE ORDER MATTERS: Playwright tries the most recently registered handler first, so the
    // catch-all goes FIRST and the specific routes after it, or the board never gets its book
    await p.route('**/api/**', r => r.fulfill({ json: { ok: true, owner: true, clients: null, modules: null, users: [], roster: [], crit: 0, warn: 0 } }));
    await p.route('**/api/state*', r => r.fulfill({ json: { tmtags: {}, tmtagdef: { tags: [], rules: [] }, tmtype: {} }, headers: { 'X-Sync-Base': String(Date.now()) } }));
    await p.route('**/api/taskmanager*', r => r.fulfill({ json: { ok: true, owner: true, scoped: false, status: { state: 'ok', at: Date.now() }, data: DATA } }));
    await p.route('**/api/outcomes*', r => {
      calls++;
      const c = decodeURIComponent((r.request().url().match(/client=([^&]*)/) || [, ''])[1]);
      r.fulfill({ json: OUT[c] || { ok: true, client: c, months: [], metrics: { gs: {}, q: {}, air: {} }, measured: {}, results: {}, feeds: 0, sources: [] } });
    });
    await p.route('https://fcc.test/tasks*', r => r.fulfill({ contentType: 'text/html', body: page + W }));
    await p.goto('https://fcc.test/tasks', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1000);

    // ---- it ships OFF, and the control says what it would do ------------------------------
    let v = await p.evaluate(panel);
    ok('the page threw nothing', errs.length === 0, errs[0]);
    ok('the panel is NOT painted until it is asked for (read off the paint, never the property)',
      !v.painted, { painted: v.painted });
    ok('and the control explains what it would draw before anyone turns it on',
      /outcome under the hours/i.test(v.note), v.note);
    ok('nothing was fetched while it was off', calls === 0, { calls });

    // ---- on, but no calendar to share ------------------------------------------------------
    const setOut = async (v) => {
      await p.click('#mb-disp');                 // the control lives behind ⚙ Display
      await p.selectOption('#cout', v);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
    };
    await setOut('gs');
    v = await p.evaluate(panel);
    const donut = await p.evaluate(() => document.getElementById('cform').value);
    if (donut !== 'line') {
      ok('on a view with no calendar it refuses AND says so', !v.painted && /no calendar to share/i.test(v.note), { painted: v.painted, note: v.note });
      ok('the subtitle says it is not drawn, so a fold can never bury it', /not drawn/.test(v.sub), v.sub);
      ok('and it still has not fetched anything', calls === 0, { calls });
    }

    // ---- a calendar, but two accounts ------------------------------------------------------
    await p.selectOption('#cform', 'line');
    await p.waitForTimeout(350);
    v = await p.evaluate(panel);
    ok('with a calendar but no single account it says to pick one', /pick one account/i.test(v.empty), v.empty);

    // ---- one account, a real series --------------------------------------------------------
    await p.selectOption('#cacct', 'Reiss');
    await p.waitForTimeout(700);
    v = await p.evaluate(panel);
    ok('one account draws the line', v.svg && v.paths >= 1, { svg: v.svg, paths: v.paths });
    ok('it asked the route for that brand exactly once', calls === 1, { calls });
    ok('a month nobody measured stays a GAP — the run is broken, not joined through July',
      v.paths >= 2, { paths: v.paths });
    ok('every measured month carries its own mark', v.dots === 4, { dots: v.dots });
    ok('the caption names the coverage rather than asserting a bare brand figure',
      /market/.test(v.cap) && /2–3 markets|2–3 markets/.test(v.cap), v.cap);
    ok('…and says a gap is a gap, in words', /gap, never a zero/.test(v.cap), v.cap);
    ok('…and names where the number came from', /Source:/.test(v.cap), v.cap);
    ok('the subtitle names the second reading', /golden record score below/i.test(v.sub), v.sub);
    ok('the ⚙ Display dot is lit, because a fold may cost a click and never the truth',
      await p.evaluate(() => !document.querySelector('#mb-disp .cdot').hidden));

    // ---- it lines up with the hours, and stays inside the card ------------------------------
    const align = await p.evaluate(() => {
      const a = document.querySelector('#cstage svg'), b = document.querySelector('#coutbox svg');
      if (!a || !b) return null;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return { dl: Math.abs(ra.left - rb.left), dw: Math.abs(ra.width - rb.width),
        below: rb.top >= ra.bottom - 1 };
    });
    ok('the outcome panel sits UNDER the hours, not inside them', align && align.below, align);
    ok('…on the same column, so the two calendars line up', align && align.dl < 2 && align.dw < 2, align);
    ok('no edge escapes the viewport', v.left >= 0 && v.right <= v.vw + 0.5, { l: v.left, r: v.right, vw: v.vw });
    ok('and the page gained no sideways scroll', v.scroll <= v.vw + 0.5, { s: v.scroll, vw: v.vw });

    // ---- an account with no readings says which, never a blank strip ------------------------
    await p.selectOption('#cacct', 'Superdry');
    await p.waitForTimeout(700);
    v = await p.evaluate(panel);
    ok('a brand nobody has scanned says exactly that, rather than drawing nothing',
      /no market of this brand has a scan history/.test(v.empty), v.empty);
    ok('…and never leaves a caption from the brand before it', v.cap === '', v.cap);

    // ---- a metric with no reading is told apart from a brand with none ----------------------
    await p.selectOption('#cacct', 'Reiss');
    await p.waitForTimeout(600);
    await setOut('air');
    v = await p.evaluate(panel);
    ok('a metric nobody has analysed names the metric, not the brand',
      /AI-readiness/.test(v.empty) && /no ai-readiness reading/i.test(v.empty), v.empty);

    /* ---- THE DENOMINATOR (Ray: "886 hours maintained 47k SKUs across 28 markets") -----------
       Hours with nothing beside them cannot be argued with by somebody pricing a service per unit.
       Every figure here is COUNTED from what is on screen, and the catalogue states how many of the
       brand's markets it covers rather than implying all of them. */
    v = await p.evaluate(panel);
    ok('the scale line states the hours and the pieces of work behind them',
      /delivered/.test(v.scale) && /pieces of work/.test(v.scale), v.scale);
    ok('\u2026the markets and the people carrying them', /market/.test(v.scale) && /people|person/.test(v.scale), v.scale);
    ok('\u2026and the catalogue those hours maintained', /47,013/.test(v.scale) && /products in the feed/.test(v.scale), v.scale);
    ok('the catalogue names how many markets it covers rather than implying all of them',
      /3 of 28 markets scanned/.test(await p.getAttribute('#cscale i:last-child', 'title') || ''),
      await p.getAttribute('#cscale i:last-child', 'title'));

    // ---- the cuts a board asks for ----------------------------------------------------------
    const dims = await p.evaluate(() => [...document.getElementById('cdim').options].map(o => o.value));
    ok('Quarter and Week are offered as splits', dims.includes('quarter') && dims.includes('week'), dims);
    await p.selectOption('#cdim', 'quarter');
    await p.selectOption('#cform', 'bars');
    await p.waitForTimeout(400);
    const qs = await p.evaluate(() => [...document.querySelectorAll('#cstage svg text')]
      .map(t => t.textContent).filter(t => /^\d{4}-Q\d$/.test(t)));
    ok('a quarter split draws quarters', qs.length >= 2, qs);
    ok('\u2026in TIME order, not biggest-first \u2014 a board reads a year forwards',
      qs.join(',') === [...qs].sort().join(','), qs);
    await p.selectOption('#cform', 'line');
    await p.selectOption('#cdim', 'month');
    await p.waitForTimeout(400);

    // ---- the export carries BOTH panels (these go straight into a deck) ---------------------
    await setOut('gs');
    await p.waitForTimeout(300);
    /* The page's functions are inside an IIFE, so the export is proved the only way a reader
       would: press the button and measure the file. A PNG's width and height are bytes 16..24 of
       its IHDR, so the image the slide will carry is measured rather than assumed — with the
       panel off, and with it on. */
    const grabPng = async () => {
      const dl = p.waitForEvent('download', { timeout: 15000 });
      await p.click('#xpng');
      const d = await dl;
      const f = await d.path();
      const buf = fs.readFileSync(f);
      return { name: d.suggestedFilename(), w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    };
    const withOut = await grabPng();
    await setOut('');
    const hoursOnly = await grabPng();
    ok('⬇ PNG still exports with the panel off', hoursOnly.w === 2000 && hoursOnly.h > 200, hoursOnly);
    ok('…and the deck image is TALLER with the outcome under it — the slide carries both panels',
      withOut.w === 2000 && withOut.h > hoursOnly.h + 100, { withOut, hoursOnly });
    ok('…and the file names itself after the metric it carries', /-gs-/.test(withOut.name), withOut.name);
    await setOut('gs');

    // ---- the choice survives a reload, like every other reading preference -----------------
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    const kept = await p.evaluate(() => document.getElementById('cout').value);
    ok('the pick is remembered on this device', kept === 'gs', { kept });

    await ctx.close();
  }
  await browser.close();
  console.log('\n' + (fail ? '✗' : '✓') + ' ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
