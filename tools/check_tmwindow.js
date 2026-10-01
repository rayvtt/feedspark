#!/usr/bin/env node
/* FS Task Manager — THE WINDOW THE BOOK IS READ OVER, rendered.
 *
 * Ray, 1 Oct 2026: "can you check if hours can be pulled from 'all time' not just from 2025?"
 *
 * It can. The twelve months were ours, not the reports database's — the MCP ignores from_date and
 * answers newest-first, so one call already reaches a market's first task, and the store was simply
 * throwing the rest away. tools/test_reporttasks.mjs pins that half.
 *
 * THIS is the half a source read cannot reach, and every assertion here is a way the control could
 * be correct in the file and wrong on screen:
 *
 *   · THE WINDOW IS WHAT THE SERVER READS, not a filter on rows already in hand — so the FIRST
 *     fetch has to name it. A control that worked only after a change would load twelve months and
 *     then reload, which on an all-time read is the expensive half done twice.
 *   · A REFETCH THAT CHANGES THE LABEL BUT NOT THE ROWS is the worst outcome available: the page
 *     would claim all time over twelve months of data. So the stub serves a DIFFERENT book per
 *     window and the row count is checked, not the caption.
 *   · A REFUSED REFETCH MUST ROLL BACK. Leaving "All time" selected over the old rows is the same
 *     lie arrived at by a different route.
 *   · "44 OF 39 MARKETS READ" — Ray's screenshot. The read count must never exceed the total, and
 *     what the live roster has dropped must be named rather than inflating one side of it.
 *   · A CONTROL OFF THE EDGE OF THE SCREEN. check_tmimport exists because a correct dialog was
 *     painted at x:1449 in a 1440px window; every edge here is measured at 1440 and at 390.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_tmwindow.js   (presync) */
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

const ACC = [{ cid: 1, tid: 1, client: 'Reiss', market: 'GB', name: 'Reiss - GB', group: '', flag: 0,
  status: 'active', type: 'FM', am: 'Ray', am2: '', allowance: 35, used: 20, balance: 15,
  health: 'healthy', since: '2018-02-01' }];

/* A ROW PER MONTH, as far back as the window asks. Twelve months is twelve rows and all time is
   over a hundred, so a refetch that did not really change the population is visible in one count. */
function rowsFor(months) {
  const out = [];
  const end = new Date(Date.UTC(2026, 9, 1));
  for (let i = 0; i < months; i++) {
    const d = new Date(end.getTime());
    d.setUTCMonth(d.getUTCMonth() - i);
    out.push({ d: d.toISOString().slice(0, 8) + '15', client: 'Reiss', market: 'GB', am: 'Ray',
      owner: 'Ray', title: 'Keyword optimisation ' + i, status: 'done', cat: 'opt', bucket: 'done',
      bill: 1, nonbill: 0.25, hours: 1.25, sched: 1, id: 5000 + i, ticket: 0, note: '' });
  }
  return out;
}

/* THE COVERAGE IS RAY'S OWN SHAPE: the book holds three markets, the live client master carries two
   of them this cycle. The old denominator was the roster alone, which is how "44 of 39" happened. */
const COV = [
  { client: 'Reiss', market: 'GB', cid: 1, at: Date.now(), n: 12, held: 120, from: '2010-01-01', holds: '2018-02-27', pulled: 120, deepest: '2018-02-27', full: true, capped: false },
  { client: 'Reiss', market: 'US', cid: 2, at: Date.now(), n: 6, held: 60, from: '2010-01-01', holds: '2019-01-01', pulled: 60, deepest: '2019-01-01', full: true, capped: false },
  // read before the window widened: it holds twelve months and cannot answer an all-time view yet
  { client: 'Reiss', market: 'DE', cid: 3, at: Date.now(), n: 4, held: 4, from: '2025-11-01', holds: '2025-11-01', pulled: 400, deepest: '2018-06-01', full: true, capped: false },
];

function book(win) {
  const all = win === 'all', m = all ? 104 : (win === '24' ? 24 : 12);
  const shallow = all ? 1 : 0;
  return {
    from: all ? '2010-01-01' : (win === '24' ? '2024-11-01' : '2025-11-01'), to: '2026-10-01',
    months: all ? 0 : +win, all: all, windows: [12, 24, 0], at: Date.now(),
    rows: rowsFor(m), tickets: [], accounts: ACC, coverage: COV, ticketCoverage: [],
    health: { read: 3, total: 3, roster: 2, dropped: 1, partial: 0, shallow: shallow,
      shallowFrom: shallow ? '2025-11-01' : '', oldest: Date.now(), newest: Date.now(),
      complete: true, staleHours: 0 },
    scoped: false, queuesTotal: 0,
  };
}

const probe = () => {
  const sel = document.getElementById('winsel');
  const b = sel ? sel.getBoundingClientRect() : null;
  const src = document.getElementById('src');
  return {
    there: !!sel,
    painted: !!sel && getComputedStyle(sel).display !== 'none' && !!(b && b.width > 0),
    value: sel ? sel.value : null,
    disabled: sel ? !!sel.disabled : null,
    opts: sel ? [].map.call(sel.options, o => o.value + ':' + o.textContent) : [],
    inSrc: !!(sel && src && src.contains(sel)),
    left: b ? Math.round(b.left) : null, right: b ? Math.round(b.right) : null,
    top: b ? Math.round(b.top) : null, bottom: b ? Math.round(b.bottom) : null,
    vw: innerWidth, vh: innerHeight, scroll: document.documentElement.scrollWidth,
    // the MESSAGE only — the control's own <option> labels sit inside #src too, so reading the whole
    // row for the words "all time" would match the picker rather than the sentence it changes
    srcText: (() => { const g = src && src.querySelector('.grow');
      return g ? g.textContent.replace(/\s+/g, ' ').trim() : ''; })(),
    rows: (document.getElementById('qres') || {}).textContent || '',
    remembered: (() => { try { return localStorage.getItem('fcc-tm-win'); } catch (e) { return null; } })(),
  };
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });

  // one context per scenario so a remembered pick is never carried in by accident
  const open = async (url, opts) => {
    const o = opts || {};
    const ctx = await browser.newContext({ viewport: { width: o.width || 1440, height: 1000 } });
    const p = await ctx.newPage();
    const asked = [];
    const errs = [];
    p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    // ROUTE ORDER: Playwright tries the most recently registered handler FIRST, so the catch-all
    // goes first and the specific routes after it, or the board never gets its book
    await p.route('**/api/**', r => r.fulfill({ json: { ok: true, owner: true, clients: null, modules: null, users: [], roster: [], crit: 0, warn: 0 } }));
    await p.route('**/api/state*', r => r.fulfill({ json: { tmtags: {}, tmtagdef: { tags: [], rules: [] }, tmtype: {} }, headers: { 'X-Sync-Base': String(Date.now()) } }));
    await p.route('**/api/taskmanager*', r => {
      const u = r.request().url();
      const w = (u.match(/[?&]win=([^&]*)/) || [, ''])[1];
      asked.push(/[?&]sync=/.test(u) ? 'sync:' + w : w);
      if (o.refuse && asked.length > 1) return r.fulfill({ json: { ok: false, error: 'refused' } });
      const d = book(w || '12');
      // a SYNC answers with a fuller book, which is the whole point of pressing it
      if (/[?&]sync=/.test(u)) { d.health.read = 3; d.health.total = 3; d.rows = d.rows.concat(rowsFor(3)); }
      else if (o.unread) { d.health.read = 2; d.health.total = 3; d.health.complete = false; }
      r.fulfill({ json: { ok: true, owner: true, scoped: false, status: { state: 'ok', at: Date.now() }, data: d } });
    });
    await p.route('https://fcc.test/tasks*', r => r.fulfill({ contentType: 'text/html', body: page + W }));
    if (o.seed) await p.addInitScript(v => { try { localStorage.setItem('fcc-tm-win', v); } catch (e) {} }, o.seed);
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    return { ctx, p, asked, errs };
  };

  // ------------------------------------------------------------------------------------------
  console.log('\n── it opens on twelve months, and the FIRST fetch says so');
  {
    const { ctx, p, asked, errs } = await open('https://fcc.test/tasks');
    const v = await p.evaluate(probe);
    ok('the page threw nothing', errs.length === 0, errs[0]);
    ok('the window control is painted', v.painted, v);
    ok('...on the source line itself, beside the dates it changes', v.inSrc);
    ok('...offering twelve months, two years and all time',
      v.opts.join('|') === '12:12 months|24:24 months|all:All time', v.opts);
    ok('it opens on twelve months', v.value === '12', v.value);
    ok('and the FIRST fetch already named the window — no twelve-month load then a reload',
      asked.length === 1 && asked[0] === '12', asked);
    ok('the source line states the span it is reading', /2025-11-01/.test(v.srcText), v.srcText.slice(0, 120));
    ok('and does not claim all time', !/all time/i.test(v.srcText), v.srcText.slice(0, 160));
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------
  console.log('\n── picking All time re-reads the book, and the ROWS change');
  {
    const { ctx, p, asked, errs } = await open('https://fcc.test/tasks');
    const before = await p.evaluate(() => document.querySelectorAll('#pbody tbody tr').length);
    await p.selectOption('#winsel', 'all');
    await p.waitForTimeout(700);
    const v = await p.evaluate(probe);
    const after = await p.evaluate(() => document.querySelectorAll('#pbody tbody tr').length);
    ok('the page threw nothing', errs.length === 0, errs[0]);
    ok('it asked the server for all time', asked.join(',') === '12,all', asked);
    ok('the control holds the pick', v.value === 'all', v.value);
    ok('the source line now says all time', /all time/i.test(v.srcText), v.srcText.slice(0, 160));
    // the rows are what matters: a label change over the same book would be the page lying
    ok('and the TABLE really got a different book, not just a new caption', after > before, { before, after });
    ok('the pick is remembered on this device', v.remembered === 'all', v.remembered);
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------
  console.log('\n── a link, and this device’s own memory, are honoured on the first fetch');
  {
    const a = await open('https://fcc.test/tasks?win=all');
    ok('?win=all is read before the book is fetched, so all time loads once',
      a.asked.length === 1 && a.asked[0] === 'all', a.asked);
    ok('...and the control shows it', (await a.p.evaluate(probe)).value === 'all');
    await a.ctx.close();

    const b = await open('https://fcc.test/tasks', { seed: '24' });
    ok('a bare reload opens on the window this screen last picked',
      b.asked.length === 1 && b.asked[0] === '24', b.asked);
    ok('...and the control shows it', (await b.p.evaluate(probe)).value === '24');
    await b.ctx.close();

    const c = await open('https://fcc.test/tasks?win=12', { seed: 'all' });
    ok('an explicit link beats the remembered pick', c.asked[0] === '12', c.asked);
    await c.ctx.close();

    const d = await open('https://fcc.test/tasks?win=nonsense');
    ok('a window nobody offers falls back to the default rather than blanking the page',
      (await d.p.evaluate(probe)).value === '12', d.asked);
    await d.ctx.close();
  }

  // ------------------------------------------------------------------------------------------
  console.log('\n── a refused re-read rolls back rather than mislabelling the book');
  {
    const { ctx, p, asked, errs } = await open('https://fcc.test/tasks', { refuse: true });
    const before = await p.evaluate(() => document.querySelectorAll('#pbody tbody tr').length);
    await p.selectOption('#winsel', 'all');
    await p.waitForTimeout(700);
    const v = await p.evaluate(probe);
    const after = await p.evaluate(() => document.querySelectorAll('#pbody tbody tr').length);
    ok('the page threw nothing', errs.length === 0, errs[0]);
    ok('it did ask', asked.join(',') === '12,all', asked);
    ok('the control goes back to the window actually on screen', v.value === '12', v.value);
    ok('the rows are untouched', after === before, { before, after });
    ok('and the source line never claims all time over twelve months of data',
      !/all time/i.test(v.srcText), v.srcText.slice(0, 160));
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------
  // PRE-EXISTING, found by this harness: apply() does not touch the source line, so "⟳ Sync more"
  // — a button whose entire purpose is to move "N of M markets read" — left that sentence stale.
  console.log('\n── a sync moves the sentence it exists to move');
  {
    const { ctx, p, asked, errs } = await open('https://fcc.test/tasks', { unread: true });
    const before = await p.evaluate(probe);
    ok('it opens with the book part-read', /2 of 3 markets read/.test(before.srcText), before.srcText.slice(0, 120));
    await p.click('#syncbtn');
    await p.waitForTimeout(900);
    const after = await p.evaluate(probe);
    ok('the page threw nothing', errs.length === 0, errs[0]);
    ok('it synced over the window on screen', asked.some(a => a === 'sync:12'), asked);
    ok('and the source line caught up rather than still reading 2 of 3',
      /3 of 3 markets read/.test(after.srcText), after.srcText.slice(0, 160));
    ok('the task count on the line moved too', after.srcText !== before.srcText);
    ok('the button is back to its resting label, not stuck on "Syncing…"',
      !/Syncing/.test(await p.evaluate(() => (document.getElementById('syncbtn') || {}).textContent || '')));
    ok('and the window control survived the re-render', after.painted && after.value === '12', after.value);
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------
  console.log('\n── the counts tell the truth (Ray’s "44 of 39 markets read")');
  {
    const { ctx, p } = await open('https://fcc.test/tasks?win=all');
    const v = await p.evaluate(probe);
    const m = v.srcText.match(/(\d+)\s+of\s+(\d+)\s+markets?\s+read/);
    ok('the source line states read of total', !!m, v.srcText.slice(0, 160));
    ok('...and the read count never exceeds the total', m && +m[1] <= +m[2], m && m.slice(1));
    ok('the markets the live client master has dropped are NAMED, not folded into the total',
      /no longer booking hours/i.test(v.srcText), v.srcText.slice(0, 220));
    ok('a market not yet re-read this far back says so rather than drawing a short line',
      /not read this far back yet/i.test(v.srcText), v.srcText.slice(0, 260));
    await ctx.close();
  }

  // ------------------------------------------------------------------------------------------
  for (const WIDTH of [1440, 390]) {
    console.log('\n── ' + WIDTH + 'px');
    const { ctx, p } = await open('https://fcc.test/tasks', { width: WIDTH });
    const v = await p.evaluate(probe);
    ok('the control is painted', v.painted, v);
    ok('every edge of it is inside the viewport',
      v.left >= 0 && v.right <= v.vw && v.top >= 0,
      { left: v.left, right: v.right, top: v.top, vw: v.vw });
    ok('and it did not push the page sideways', v.scroll <= v.vw + 1, { scroll: v.scroll, vw: v.vw });
    await ctx.close();
  }

  await browser.close();
  console.log(fail ? '\n' + fail + ' failed' : '\nall good');
  process.exit(fail ? 1 : 0);
})();
