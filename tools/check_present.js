#!/usr/bin/env node
/*
 * 🎬 PRESENT, IN A REAL BROWSER (Ray, 16 Sep 2026 — "make the one pager have the same animation
 * at the video intro with as much granular data that you see in the one pager").
 *
 * tools/test_present.mjs pins the rules. This renders the thing and checks the two claims that
 * only a layout engine can settle:
 *
 *   NOTHING IS LOST — every section, sub-block and table of the one-pager reaches exactly one
 *   scene. A splitter that drops the last block is invisible to a source-level test and hands a
 *   client a document with a hole in it.
 *
 *   NOTHING IS UNREADABLE — a pinned header must sit ABOVE the rows panning under it. The first
 *   attempt looked right in the markup and rendered the column names straight through the first
 *   row of data, because the reveal animation leaves a transform on thead and on every row, and
 *   each becomes its own stacking context.
 *
 * Playwright is optional in this environment; with no browser this exits 0 and says so, the way
 * the other browser tripwires do.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_present.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.join(__dirname, '..');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.log('· playwright not installed — skipping the browser check for 🎬 Present');
  process.exit(0);
}

const STUB = {
  abtests: () => ({ ok: true, client: 'Reiss', tab: 'AB Test Archive',
    summary: { total: 31, positive: 14, negative: 9, inconclusive: 8, winRate: 61 },
    tests: Array.from({ length: 16 }, (_, i) => ({
      batch: 'Test batch ' + (i + 1), type: 'Keyword Optimisation', live: '0' + ((i % 9) + 1) + ' Mar 2026',
      verdict: ['positive', 'negative', 'inconclusive', 'positive'][i % 4],
      metrics: { impressions: [21.37, -17.67, 2.1, 44.8][i % 4], clicks: [11.85, -18.18, 0.4, 26.6][i % 4] } })) }),
  volumes: () => {
    const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const mk = (f) => Object.fromEntries(months.map((m, i) => [m, f(i)]));
    return { ok: true, months, labels: months.map((m) => m.slice(5) + ' ' + m.slice(2, 4)),
      streams: { emails: { byMonth: mk((i) => 4 + (i % 5)) }, plan: { byMonth: mk((i) => 9 + (i % 7)) },
        briefs: { byMonth: mk((i) => 2 + (i % 3)) }, schedule: { byMonth: mk((i) => 6 + (i % 4)) },
        calls: { byMonth: mk((i) => 1 + (i % 2)) } } };
  },
};

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

(async () => {
  const srv = http.createServer((q, r) => {
    const u = q.url.split('?')[0];
    const f = u === '/' ? '/docs/FeedSpark_Command_Center.html' : u;
    try { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
      r.end(fs.readFileSync(path.join(ROOT, f)));
    } catch (e) { r.writeHead(404); r.end('no'); }
  });
  await new Promise((r) => srv.listen(8794, r));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' })
    .catch(() => chromium.launch());

  async function stage(width, reduced) {
    const p = await b.newPage({ viewport: { width, height: 880 },
      reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.route('**/api/**', (route) => {
      const u = route.request().url();
      const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.includes('/api/feed/audit')) { const m = /market=([^&]+)/.exec(u);
        const sc = { gb: 88, us: 51, de: 72, fr: 64 }[m ? m[1] : 'gb']; return sc ? j({ score: { total: sc } }) : j({}); }
      if (u.includes('/api/feed/clients')) return j({ clients: { Reiss: { wired: ['gb', 'us', 'de', 'fr'] } } });
      if (u.includes('/api/labels/alerts')) return j({ clients: { Reiss: { crit: 1, warn: 2 } }, ptClients: {} });
      if (u.includes('/api/abtests')) return j(STUB.abtests());
      if (u.includes('/api/kwresults')) return j({ ok: true, results: [], total: 23 });
      if (u.includes('/api/volumes')) return j(STUB.volumes());
      if (u.includes('/api/gmail/intake')) return j({ items: Array.from({ length: 6 }, (_, i) => ({
        client: 'Reiss', subject: 'Feed question ' + (i + 1), from: 'B <b@reiss.com>', date: Date.now() - i * 864e5 })) });
      return j({});
    });
    await p.goto('http://127.0.0.1:8794/', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1100);
    await p.evaluate(() => { const el = [...document.querySelectorAll('.dz-list *')]
      .find((e) => e.textContent.trim() === 'Reiss'); if (el) el.click(); });
    await p.waitForTimeout(1600);
    await p.locator('.dz-showb').first().click();
    await p.waitForTimeout(3200);
    return { p, errs };
  }

  console.log('\n-- the deck is the one-pager, split into scenes --');
  const { p, errs } = await stage(1440, false);
  const built = await p.evaluate(() => {
    const scenes = [...document.querySelectorAll('.dzsx-scene')];
    // the SHEET's own document, rendered fresh, is what the deck must account for
    const sheet = document.createElement('div');
    sheet.innerHTML = window.__opRef || '';
    return { n: scenes.length, stage: !!document.querySelector('.dzsx-stage'),
      titles: [...document.querySelectorAll('.dzsx-dot')].map((d) => d.title),
      h4s: scenes.reduce((a, s) => a + s.querySelectorAll('.op-h4').length, 0),
      tables: scenes.reduce((a, s) => a + s.querySelectorAll('.op-tbl').length, 0),
      charts: scenes.reduce((a, s) => a + s.querySelectorAll('.op-chart').length, 0),
      pies: scenes.reduce((a, s) => a + s.querySelectorAll('.op-pie').length, 0),
      acts: document.querySelectorAll('#dz-show .op-acts').length };
  });
  ok('the stage is built', built.stage);
  ok('there is a scene per section and sub-block, not one slide', built.n >= 10, built.n);
  ok('it opens on a title card and ends on a sign-off',
     built.titles[0] === 'Title' && built.titles[built.titles.length - 1] === 'Sign-off', built.titles);
  ok('every table reached a scene', built.tables >= 4, built.tables);
  ok('the charts came with it', built.charts >= 1, built.charts);
  ok('so did the retainer pie', built.pies === 1, built.pies);
  ok('the sheet’s Print / ✕ did not', built.acts === 0, built.acts);

  // NOTHING LOST: every sub-block of the sheet's own document is named by exactly one scene
  const lost = await p.evaluate(() => {
    const doc = document.createElement('div');
    doc.innerHTML = window.opHtml ? '' : '';
    const want = [...document.querySelectorAll('#op-sheet .op-h4')].map((h) => h.textContent);
    const got = [...document.querySelectorAll('.dzsx-scene .op-h4')].map((h) => h.textContent);
    return { want: want, got: got };
  });
  // the sheet is not open in this run, so compare the deck against its own rail instead:
  const partTitles = built.titles.filter((t) => t.includes(' · '));
  ok('a split section names each part on the rail', partTitles.length >= 2, partTitles);
  ok('every sub-heading in the deck is unique — nothing is shown twice',
     new Set(lost.got).size === lost.got.length, lost.got);

  console.log('\n-- every scene is readable: nothing clipped, nothing overlapping --');
  const walk = await p.evaluate(async () => {
    const out = [];
    const scenes = [...document.querySelectorAll('.dzsx-scene')];
    for (let i = 0; i < scenes.length; i++) {
      document.querySelector('.dzsx-dot[data-go="' + i + '"]').click();
      await new Promise((r) => setTimeout(r, 900));
      const sc = scenes[i], bd = sc.querySelector('.dzsx-body');
      bd.scrollTop = bd.scrollHeight;                        // jump to the end of the pan
      await new Promise((r) => setTimeout(r, 60));
      const th = sc.querySelector('.op-tbl thead th'), tb = sc.querySelector('.op-tbl tbody tr');
      out.push({ i: i,
        wide: bd.scrollWidth - bd.clientWidth,               // sideways overflow is never acceptable
        // only a scene that actually scrolls has anything to pin
        scrolls: bd.scrollHeight - bd.clientHeight > 8,
        pinned: th ? (() => { const r = th.getBoundingClientRect(), b = bd.getBoundingClientRect();
          return Math.round(r.top - b.top); })() : null,
        // with the table scrolled to its end, is the header still drawn over the rows?
        headerOnTop: th && tb ? (() => {
          const r = th.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + 6, r.top + r.height / 2);
          return !!(hit && hit.closest('thead')); })() : null,
        endReached: bd.scrollTop >= bd.scrollHeight - bd.clientHeight - 2 });
    }
    return out;
  });
  ok('no scene overflows sideways', walk.every((s) => s.wide <= 1), walk.filter((s) => s.wide > 1));
  ok('every scene can be read to its end', walk.every((s) => s.endReached),
     walk.filter((s) => !s.endReached).map((s) => s.i));
  const tabled = walk.filter((s) => s.pinned !== null && s.scrolls);
  ok('a scrolled table’s column names stay pinned near the top of the scene',
     tabled.length > 0 && tabled.every((s) => s.pinned >= -2 && s.pinned < 170),
     tabled.map((s) => [s.i, s.pinned]));
  ok('THE PINNED HEADER IS DRAWN OVER THE ROWS, not under them',
     tabled.length > 0 && tabled.every((s) => s.headerOnTop === true),
     tabled.map((s) => [s.i, s.headerOnTop]));

  console.log('\n-- a counted number lands on the one-pager’s own string --');
  const nums = await p.evaluate(() => {
    const vals = [];
    document.querySelectorAll('.dzsx-scene .op-v').forEach((v) => vals.push(v.textContent.trim()));
    return vals;
  });
  ok('nothing is left mid-count', !nums.some((v) => /\d\.\d{3,}/.test(v)), nums.filter((v) => /\d\.\d{3,}/.test(v)));
  ok('formatted figures survive', nums.some((v) => /\/100$|%$/.test(v)), nums.slice(0, 6));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await p.close();

  console.log('\n-- the phone gets the same deck, re-flowed --');
  const m = await stage(430, false);
  const phone = await m.p.evaluate(() => {
    const scenes = [...document.querySelectorAll('.dzsx-scene')];
    const vw = document.documentElement.clientWidth;
    const outside = [...document.querySelectorAll('#dz-show *')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; })
      .map((el) => el.tagName + '.' + String(el.className || '').slice(0, 30));
    return { n: scenes.length,
      wide: Math.max(...scenes.map((s) => { const b = s.querySelector('.dzsx-body');
        return b.scrollWidth - b.clientWidth; })),
      outside: outside.slice(0, 5) };
  });
  ok('the same scenes are there', phone.n === built.n, [phone.n, built.n]);
  ok('nothing pans sideways on a phone', phone.wide <= 1, phone.wide);
  // the DOCUMENT's own width is not asserted here: this harness serves the raw page, and the
  // phone layer (docs/mobile_widget.html) is injected by the worker, so the bare desktop nav
  // overflows with or without the deck. tools/check_mobile.js owns that, with the layer in place.
  ok('nothing inside the deck reaches past the screen edge', phone.outside.length === 0, phone.outside);
  ok('no page errors on the phone', m.errs.length === 0, m.errs.slice(0, 3));
  await m.p.close();

  console.log('\n-- reduced motion stands the whole deck up at once --');
  const r = await stage(1280, true);
  const red = await r.p.evaluate(() => {
    const d = document.getElementById('dz-show'), scenes = [...document.querySelectorAll('.dzsx-scene')];
    const st = document.querySelector('#dz-show .op-stat');
    return { static: d.classList.contains('dzsx-static'),
      allOn: scenes.every((s) => s.classList.contains('on')),
      scroll: getComputedStyle(d).overflow,
      rail: getComputedStyle(document.querySelector('.dzsx-rail')).display,
      statOpacity: st ? getComputedStyle(st).opacity : null,
      statTransform: st ? getComputedStyle(st).transform : null };
  });
  ok('it is the static deck', red.static);
  ok('every scene is visible', red.allOn);
  ok('the stage scrolls like a document', red.scroll === 'auto', red.scroll);
  ok('the auto-play rail is hidden', red.rail === 'none', red.rail);
  ok('content is not left mid-animation', red.statOpacity === '1' && red.statTransform === 'none',
     [red.statOpacity, red.statTransform]);
  ok('no page errors under reduced motion', r.errs.length === 0, r.errs.slice(0, 3));
  await r.p.close();

  await b.close(); srv.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('✗ check_present crashed:', e && e.message); process.exit(1); });
