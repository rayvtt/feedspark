#!/usr/bin/env node
/* THE MODULE MENU HAS THE ROW BELOW (Ray, 25 Sep 2026) ------------------------------------
 *
 *   "tidy up this menu pleease , or allow the core modules dropdown ai the below row"
 *
 * — over a screenshot of the Command Center topbar with the right-hand widget cluster crossed
 * out. Nineteen unlabelled glyphs shared one row with the wordmark, the page tag, the viewer's
 * name and six injected widgets, and wrapped onto a second line INSIDE the bar.
 *
 * A source assertion could not catch any of this: the layout is in an injected widget, the nav
 * markup it lays out is in 24 other files, MODGATE hides some of its anchors at runtime, the ▦
 * customiser moves others out of it, and the phone layer takes the whole node away under 760px.
 * So this drives the REAL pages through Chromium, built exactly as the worker serves them, and
 * measures what is painted.
 *
 * What it holds:
 *   1. ONE ROW, BELOW THE FIRST. The chips never wrap and never sit beside the wordmark.
 *      A negative control builds the same page WITHOUT the widget and asserts it DOES wrap —
 *      otherwise assertion 1 could be passing on a page where nothing is being measured.
 *   2. EVERY MODULE IS STILL REACHABLE. Nothing is dropped: what leaves the row is in "More",
 *      and the two together are exactly the granted menu.
 *   3. A DENIED MODULE IS IN NEITHER. MODGATE hides it inline; it must not be measured onto the
 *      row and must not be cloned into the dropdown — a menu is not a place to discover a page
 *      you will be refused.
 *   4. THE PAGE YOU ARE ON IS ALWAYS ON THE ROW, even when its module sits 16th in the order.
 *   5. THE ☰ TOGGLE STILL HIDES THE MENU. The page rule is two classes and the row's is an id,
 *      which beats it — so without an explicit rule the button silently stops working.
 *   6. UNDER 760px THE ROW STANDS DOWN and leaves no trace on the node the phone bar takes.
 *   7. The dropdown closes on Esc and on a click outside it.
 *   8. Every render tripwire that injects the widget set carries this widget, or they would all
 *      go on rendering a topbar the site no longer has.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_navrow.js     (LGX-style: NAVROW_KEEP=1 keeps
 * the built pages for a visual pass)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const W = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '\n      got: ' + JSON.stringify(got) : '')); }
};

// the worker's own app-page injection, in its order — with the widget under test in it
const ORDER = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html',
  'apps_widget.html', 'navrow_widget.html', 'hours_widget.html', 'touch_widget.html', 'migration_widget.html'];
const MODGATE = eval((W.match(/const MODGATE = ([^]*?);\n/) || [])[1]);   // the real gate, lifted
const readW = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navrow-'));
function build(page, opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(DOCS, page), 'utf8');
  const widgets = ORDER.filter((w) => !(opts.without || []).includes(w)).map(readW).join('\n');
  const extra = widgets
    + '\n<script>window.__FCCMOD=' + JSON.stringify(opts.mods === undefined ? null : opts.mods) + ';</script>\n' + MODGATE
    + '\n' + readW('mobile_widget.html') + '\n' + readW('digest_widget.html');
  const served = html.indexOf('</body>') >= 0 ? html.replace('</body>', extra + '\n</body>') : html + '\n' + extra;
  const name = (opts.as || page);
  fs.writeFileSync(path.join(tmp, name), served);
  return name;
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('· playwright not installed — skipping (run with NODE_PATH=$(npm root -g))'); process.exit(0); }

  const CC = build('FeedSpark_Command_Center.html');
  const KW = build('FeedSpark_KWCal.html');
  const BARE = build('FeedSpark_Command_Center.html', { without: ['navrow_widget.html'], as: 'bare.html' });
  const SCOPED = build('FeedSpark_Command_Center.html', { mods: ['workflow', 'feedlab', 'golden'], as: 'scoped.html' });

  const server = http.createServer((req, res) => {
    const f = path.join(tmp, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
    fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(b); } });
  });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';

  const browser = await chromium.launch();
  const open = async (file, w, h) => {
    const p = await browser.newPage({ viewport: { width: w || 1280, height: h || 800 } });
    p.on('pageerror', (e) => { fail++; console.log('  ✗ page error on ' + file + ': ' + String(e).slice(0, 180)); });
    await p.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await p.goto(base + file, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    return p;
  };
  // what the bar is actually painting
  const read = (p) => p.evaluate(() => {
    const n = document.getElementById('tb-modules');
    const anchors = [...n.querySelectorAll('a.tbm')];
    const granted = anchors.filter((a) => a.style.display !== 'none');
    const onRow = granted.filter((a) => !a.classList.contains('nv-of'));
    const menu = document.getElementById('fcc-navmenu');
    const more = document.getElementById('fcc-navmore');
    const brand = document.querySelector('.topbar-in .brand');
    const href = (a) => a.getAttribute('href');
    return {
      rows: [...new Set(onRow.map((a) => Math.round(a.getBoundingClientRect().top)))].length,
      onRow: onRow.map(href),
      named: onRow.every((a) => !!a.querySelector('.nvl') && a.querySelector('.nvl').textContent.trim().length > 1),
      inMenu: menu ? [...menu.querySelectorAll('a')].map(href) : [],
      denied: anchors.filter((a) => a.style.display === 'none').map(href),
      moreShown: more ? getComputedStyle(more).display !== 'none' : false,
      navTop: Math.round(n.getBoundingClientRect().top),
      navVisible: getComputedStyle(n).display !== 'none',
      brandBottom: brand ? Math.round(brand.getBoundingClientRect().bottom) : 0,
      overflowsRight: onRow.length ? Math.round(onRow[onRow.length - 1].getBoundingClientRect().right) - Math.round(n.getBoundingClientRect().right) : 0,
      active: (onRow.find((a) => a.classList.contains('on')) || {}).getAttribute ? href(onRow.find((a) => a.classList.contains('on'))) : null,
      strays: [...document.querySelectorAll('a.tbm .nvl')].filter((s) => s.closest('a.tbm').parentNode !== n).length,
    };
  });

  /* 1 — one row, below the first, nothing wrapped, nothing running past the edge */
  console.log('\none row, below the first');
  for (const w of [1440, 1280, 1100, 900, 780]) {
    const p = await open(CC, w);
    const r = await read(p);
    ok(w + 'px: the chips are on ONE row', r.rows === 1, r.rows);
    ok(w + 'px: that row is below the wordmark, not beside it', r.navTop >= r.brandBottom, { navTop: r.navTop, brandBottom: r.brandBottom });
    ok(w + 'px: nothing runs past the right edge', r.overflowsRight <= 1, r.overflowsRight);
    ok(w + 'px: every chip on the row carries its name', r.named);
    await p.close();
  }

  /* the negative control — without the widget the same page wraps, so assertion 1 measures
     something real rather than passing on a bar that was never crowded */
  console.log('\nthe negative control (the same page without the widget)');
  {
    const p = await open(BARE, 1280);
    const r = await read(p);
    ok('without the row widget the icons DO wrap inside the bar', r.rows > 1, r.rows);
    ok('without it they are also unnamed', !r.named);
    await p.close();
  }

  /* 2 — nothing is lost */
  console.log('\nnothing is lost');
  {
    const p = await open(CC, 1280);
    const before = await read(p);
    ok('what left the row is in More', before.moreShown && before.inMenu.length > 0, before.inMenu.length);
    const all = before.onRow.concat(before.inMenu);
    ok('row + More = every granted module, each exactly once',
      new Set(all).size === all.length && all.length === (await p.evaluate(() => [...document.querySelectorAll('#tb-modules a.tbm')].filter((a) => a.style.display !== 'none').length)),
      { row: before.onRow.length, menu: before.inMenu.length });
    ok('the row leads with the menu\'s own order — Workflow before Feed Lab',
      before.onRow.indexOf('/workflow') === 1 && before.onRow.indexOf('/workflow') < before.onRow.indexOf('/feedlab'), before.onRow);

    /* 7 — the dropdown closes the way a dropdown must */
    await p.click('#fcc-navmore');
    ok('More opens', await p.evaluate(() => document.getElementById('fcc-navmenu').classList.contains('on')));
    await p.keyboard.press('Escape');
    ok('Esc closes it', await p.evaluate(() => !document.getElementById('fcc-navmenu').classList.contains('on')));
    await p.click('#fcc-navmore');
    await p.evaluate(() => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    ok('a click outside closes it', await p.evaluate(() => !document.getElementById('fcc-navmenu').classList.contains('on')));

    /* 5 — the ☰ toggle still hides the menu */
    await p.click('#nav-collapse');
    await p.waitForTimeout(250);
    ok('the ☰ toggle still hides the whole menu', !(await read(p)).navVisible);
    await p.click('#nav-collapse');
    await p.waitForTimeout(250);
    ok('and brings it back', (await read(p)).navVisible);
    await p.close();
  }

  /* the row settles — it shipped, briefly, chasing its own writes at 60fps */
  console.log('\nthe row settles');
  {
    const p = await open(CC, 1280);
    const runs = () => p.evaluate(() => window.FCCNavRow.runs());
    const a = await runs();
    await p.evaluate(() => {
      window.__m = 0;
      new MutationObserver((rs) => { window.__m += rs.length; })
        .observe(document.getElementById('tb-modules'), { childList: true, attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    });
    await p.waitForTimeout(1500);
    // classList.remove() rewrites the attribute even when the token was absent, and the observer
    // callback is a microtask that lands AFTER layout() has cleared its own guard — so without
    // takeRecords() the row re-measures forever. Measured pre-fix: 5,400 in three idle seconds.
    ok('an idle page stops rewriting the nav', (await p.evaluate(() => window.__m)) === 0, await p.evaluate(() => window.__m));
    ok('and stops re-laying the row out', (await runs()) - a === 0, { before: a, after: await runs() });
    await p.close();
  }

  /* 3 — a module this signin may not open is in neither place */
  console.log('\na denied module is in neither place');
  {
    const p = await open(SCOPED, 1280);
    const r = await read(p);
    ok('MODGATE still hides the ungranted links', r.denied.length > 5, r.denied.length);
    ok('none of them is on the row', !r.onRow.some((h) => r.denied.includes(h)), r.onRow);
    ok('and none is cloned into More', !r.inMenu.some((h) => r.denied.includes(h)), r.inMenu);
    ok('the granted ones are all still reachable',
      ['/workflow', '/feedlab', '/golden'].every((h) => r.onRow.includes(h) || r.inMenu.includes(h)), { row: r.onRow, menu: r.inMenu });
    await p.close();
  }

  /* 4 — the page you are on is always on the row */
  console.log('\nthe page you are on is always on the row');
  {
    const p = await open(KW, 1100);
    const r = await read(p);
    ok('/kwcal is 16th in the order and still on the row', r.onRow.includes('/kwcal'), r.onRow);
    ok('it is the one marked as the page you are on', r.active === '/kwcal', r.active);
    ok('the row still does not wrap to hold it', r.rows === 1, r.rows);
    await p.close();
  }

  /* 6 — under 760px the row stands down */
  console.log('\nunder 760px the phone layer owns the node');
  {
    const p = await open(CC, 390, 844);
    const r = await p.evaluate(() => {
      const n = document.getElementById('tb-modules');
      const more = document.getElementById('fcc-navmore');
      return { of: n.querySelectorAll('a.tbm.nv-of').length, more: !!(more && more.offsetParent),
        moreInNav: !!(more && n.contains(more)),
        header: Math.round((document.querySelector('.topbar') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height) };
    });
    ok('no chip is left folded away', r.of === 0, r.of);
    ok('the More button is not in the phone bar', !r.moreInNav && !r.more);
    ok('the header stays inside the phone tripwire\'s 64px', r.header <= 64, r.header);
    await p.close();
  }

  /* 8 — the render tripwires all carry the widget */
  console.log('\nevery render tripwire injects it');
  for (const t of ['check_mobile.js', 'check_darkmode.js', 'check_grpdf.js', 'check_grmobile.js']) {
    ok(t + ' injects navrow_widget.html', fs.readFileSync(path.join(__dirname, t), 'utf8').includes("'navrow_widget.html'"));
  }
  ok('the worker injects it on app pages, after the ▦ customiser and before the phone layer',
    /APPSW\s*\n?\s*\+ '\\n' \+ NAVROWW/.test(W) && W.indexOf('NAVROWW') < W.indexOf("inject(html, MOBILEW)"));

  await browser.close();
  server.close();
  if (process.env.NAVROW_KEEP) console.log('\n· built pages kept in ' + tmp);
  else fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
