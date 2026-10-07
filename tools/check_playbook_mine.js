#!/usr/bin/env node
/*
 * tools/check_playbook_mine.js — THE PLAYBOOK PICKER LISTS YOUR ACCOUNTS, RENDERED.
 *
 * Ray, 29 Sep 2026: "clean up the client's dropdown in Playbook pls - only my accounts".
 *
 * The rail's roster is plan tasks ∪ the whole wired Shopping estate ∪ every arrivals feed, and
 * WHOSE an account is comes from the Task Manager through /api/hours — which the worker-injected
 * hours widget fetches AFTER the first paint. Every interesting case here is therefore about
 * TIMING or ABSENCE, which a source read cannot see:
 *
 *   · THE FILTER MUST NEVER EMPTY THE PICKER. /api/hours can be late, the Task Manager may never
 *     have synced, the widget is not on the page at all under file://, and a signin may simply be
 *     on nobody's accounts. In all of those the AM is unknown — so the filter stands down WHOLE
 *     and says why, rather than leaving a rail with nothing to review.
 *   · IT HAS TO NARROW WHEN THE ANSWER ARRIVES. The hours land on their own event; without that
 *     listener the rail opens on every account and only narrows on the next poll, which reads as
 *     the filter not working.
 *   · AN ACCOUNT THE BOARD PICKED IS KEPT. The rail follows the board's client filter, so a brand
 *     that is not yours must still be reviewable when something else selected it.
 *
 * The page's own roster, its own filter and its own markup are driven — nothing is re-implemented.
 * Run: node tools/check_playbook_mine.js        (PW_CHROMIUM overrides the browser path)
 */
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(__dirname, '..', 'docs', 'FeedSpark_Workflow.html');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };

/* an estate shaped like the real one: nine brands, five of them Ray's, three Steven's and one the
   Task Manager has never named an AM for */
const EST = [['Reiss', 3], ['Superdry', 2], ['Schuh', 2], ['Monsoon', 1], ['Accessorize', 1],
  ['YuMOVE', 1], ['Hobbycraft', 1], ['American Golf', 1], ['House of Bruar', 1]];
const AM = { Reiss: 'Ray', Superdry: 'Ray', Monsoon: 'Ray', Accessorize: 'Ray', Hobbycraft: 'Ray',
  Schuh: 'Steven', YuMOVE: 'Steven', 'American Golf': 'Steven' };   // House of Bruar: none
const MINE = Object.keys(AM).filter((b) => AM[b] === 'Ray').sort();
const ALL = EST.map((e) => e[0]).sort();

function stub(mode) {
  return function (d) {
    const gold = { ok: true, feeds: {} }, arr = { ok: true, feeds: [] };
    d.EST.forEach(function (e) {
      for (let i = 0; i < e[1]; i++) {
        gold.feeds[e[0] + '|m' + i] = { client: e[0], mkt: 'm' + i, score: 88 };
        arr.feeds.push({ client: e[0], mkt: 'm' + i });
      }
    });
    const j = (o) => Promise.resolve({ ok: true, status: 200, headers: { get: () => '0' },
      json: () => Promise.resolve(o), text: () => Promise.resolve('{}') });
    window.fetch = function (u) {
      u = String(u);
      if (u.indexOf('/api/golden/estate') >= 0) return j(gold);
      if (u.indexOf('/api/volume/arrivals') >= 0) return j(arr);
      if (u.indexOf('/api/access?me=1') >= 0)
        return j({ ok: true, owner: true, email: 'ray@feedspark.com', name: 'Ray', ownerName: 'Ray' });
      return j({ ok: true, briefs: {}, map: {}, items: [], calls: [], feeds: [], clients: {} });
    };
    if (d.mode === 'nowidget') return;                 // the worker never injected the hours widget
    const C = {};
    Object.keys(d.AM).forEach(function (b) {
      const n = d.mode === 'nobody' ? 'Steven' : d.AM[b];   // named, but never this reader
      C[b] = { am: n };
      if (d.mode !== 'noemail') C[b].amEmail = n.toLowerCase() + '@feedspark.com';
    });
    const mount = function () {
      window.FCCHours = { dock: function () {}, docked: function () { return false; },
        rec: function (n) { const k = String(n || '').toLowerCase();
          const keys = Object.keys(C);
          for (let i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === k) return { name: keys[i], rec: C[keys[i]] };
          return null; } };
    };
    if (d.mode !== 'late') { mount(); return; }
    /* the real widget answers only once /api/hours lands — so hold it back, then announce it the
       way the widget does, which is the path the rail's listener exists for */
    window.__mountHours = function () { mount(); document.dispatchEvent(new CustomEvent('fcc-hours')); };
  };
}

const read = (p) => p.evaluate(() => {
  const s = document.getElementById('ck-brand');
  return { opts: s ? Array.prototype.map.call(s.options, (o) => o.value) : null,
    sub: (document.getElementById('ck-sub') || {}).textContent || '',
    btn: (document.querySelector('.ck-mine-b') || {}).textContent || null };
});

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  async function open(mode, ctxIn) {
    const ctx = ctxIn || await browser.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.addInitScript(stub(mode), { EST, AM, mode });
    const p = await ctx.newPage();
    await p.goto(PAGE);
    await p.waitForTimeout(2600);
    await p.evaluate(() => { const r = document.getElementById('ck-r'); if (r) r.hidden = false; });
    await p.waitForTimeout(900);
    return { ctx, p };
  }

  console.log('\n── the picker opens on your accounts, and says what it set aside');
  {
    const { ctx, p } = await open('normal');
    const a = await read(p);
    ok('only the accounts the Task Manager says are yours — ' + a.opts.join(', '),
      JSON.stringify(a.opts) === JSON.stringify(MINE));
    ok('a colleague’s account is not listed', a.opts.indexOf('Schuh') < 0 && a.opts.indexOf('YuMOVE') < 0);
    ok('nor one the Task Manager has never named an AM for', a.opts.indexOf('House of Bruar') < 0);
    ok('and the subtitle COUNTS what is hidden rather than dropping it silently — "'
      + (a.sub.split('·').pop() || '').trim() + '"',
      /your 5 of 9 accounts/.test(a.sub) && a.btn === 'show all');

    /* clicked through the page, but never WAITED for: on a build with no toggle this would hang
       thirty seconds and die on a timeout instead of reporting the four findings above */
    const tap = async () => { const n = await p.$('.ck-mine-b'); if (!n) return false;
      await n.click(); await p.waitForTimeout(250); return true; };
    if (await tap()) {
      const b = await read(p);
      ok('one click shows every account again', JSON.stringify(b.opts.slice().sort()) === JSON.stringify(ALL));
      ok('…and the button then names the way back', b.btn === 'mine only');
      await tap();
      ok('which puts it back to yours', (await read(p)).opts.length === MINE.length);

      await p.reload(); await p.waitForTimeout(2600);
      await p.evaluate(() => { const r = document.getElementById('ck-r'); if (r) r.hidden = false; });
      await p.waitForTimeout(700);
      ok('the choice is remembered on this device', (await read(p)).opts.length === MINE.length);
    } else ok('there is a control to show every account', false);
    await ctx.close();
  }

  console.log('\n── it stands down rather than leaving a rail with nothing in it');
  for (const [mode, why] of [['nobody', 'the Task Manager names an AM, but never this reader'],
    ['nowidget', 'the hours widget is not on the page, so no AM is known at all']]) {
    const { ctx, p } = await open(mode);
    const a = await read(p);
    ok(why + ' → every account, never an empty picker',
      JSON.stringify(a.opts.slice().sort()) === JSON.stringify(ALL));
    ok('…and it says why instead of looking broken',
      /names no AM on any of these/.test(a.sub) && a.btn === null);
    await ctx.close();
  }
  {
    const { ctx, p } = await open('noemail');
    ok('an AM the access directory has no address for still matches on the name the TM states',
      JSON.stringify((await read(p)).opts) === JSON.stringify(MINE));
    await ctx.close();
  }

  console.log('\n── it narrows when the answer arrives, not on the next poll');
  {
    const { ctx, p } = await open('late');
    const before = await read(p);
    ok('before /api/hours lands the picker carries every account',
      JSON.stringify(before.opts.slice().sort()) === JSON.stringify(ALL));
    await p.evaluate(() => window.__mountHours());
    await p.waitForTimeout(350);
    const after = await read(p);
    ok('the hours land and the picker narrows to yours by itself',
      JSON.stringify(after.opts) === JSON.stringify(MINE));
    await ctx.close();
  }

  console.log('\n── an account something else selected is still reviewable');
  {
    const { ctx, p } = await open('normal');
    await p.evaluate(() => { if (window.FCCFilterClient) window.FCCFilterClient('Schuh'); });
    await p.evaluate(() => { document.dispatchEvent(new CustomEvent('fcc-clients', { detail: { clients: ['Schuh'] } })); });
    await p.waitForTimeout(400);
    const a = await read(p);
    const sel = await p.evaluate(() => document.getElementById('ck-brand').value);
    ok('the board picked a colleague’s brand — the rail keeps it in the list rather than jumping away',
      sel !== 'Schuh' || a.opts.indexOf('Schuh') >= 0);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
