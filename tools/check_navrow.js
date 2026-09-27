#!/usr/bin/env node
/* THE MODULE MENU HAS THE ROW BELOW — EVERY ICON, ON THE RIGHT ----------------------------
 *
 * Ray, 25 Sep 2026: "tidy up this menu pleease , or allow the core modules dropdown ai the
 * below row". The first cut (#543) put NAMED chips on the row and folded the rest into a
 * "More ▾" while the ▦ bundle button stayed in the top row — two places holding hidden modules.
 * Ray, 27 Sep 2026: "I just want to see icons, so the icons should stay on the right. There's
 * no point in having the first bar with bundle tool and more … keep all the icons of the menu on
 * the right-hand side, below the text on the first row, for visual clarity and cadence."
 *
 * A source assertion could not catch any of this: the layout is an injected widget, the nav
 * markup it lays out is in 24 other files, MODGATE hides some of its anchors at runtime, the ▦
 * customiser moves others out of it, and the phone layer takes the whole node away under 760px.
 * So this drives the REAL pages through Chromium, built exactly as the worker serves them, and
 * measures what is painted.
 *
 * What it holds:
 *   1. ONE ROW OF ICONS, BELOW THE FIRST, FLUSH RIGHT. No chip carries text; every one keeps the
 *      hover name it always had (data-lbl); the last icon ends at the row's right edge, under
 *      the widgets. A negative control builds the same page WITHOUT the widget and asserts the
 *      icons DO wrap inside the bar — otherwise the one-row assertion could pass on a bar nobody
 *      is laying out.
 *   2. EVERY MODULE IS ON THE ROW — including what the ▦ bundle had (the Pricer, by default), at
 *      its canonical slot — and the ▦ button is not painted on the desktop. One place.
 *   3. A DENIED MODULE IS NOT ON IT. MODGATE hides it with an inline style that travels with the
 *      anchor; re-homing it must not reveal it.
 *   4. THE PAGE YOU ARE ON is on the row, marked, even when its module sits 16th in the order.
 *   5. THE ☰ TOGGLE STILL HIDES THE MENU — the page rule is two classes and the row's carries an
 *      id, which beats it, so without an explicit rule the button silently stops working.
 *   6. UNDER 760px THE ROW STANDS DOWN: on a phone load nothing is moved and the ▦ button is
 *      back; on a desktop→phone resize the re-homed anchor goes back to the bundle in the
 *      bundle's own dress, and bar + sheet still carry every module.
 *   7. AN IDLE PAGE REWRITES NOTHING — the first cut re-measured itself at 60fps.
 *   8. Every render tripwire that injects the widget set carries this widget, or they would all
 *      go on rendering a topbar the site no longer has.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_navrow.js     (NAVROW_KEEP=1 keeps the built
 * pages for a visual pass)
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
// the canonical nav, straight from the page — what "every module" means
const CANON = [...fs.readFileSync(path.join(DOCS, 'FeedSpark_Workflow.html'), 'utf8')
  .match(/<nav class="tb-nav tb-modules"[^>]*>([\s\S]*?)<\/nav>/)[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

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
    p.on('pageerror', (e) => { if (!/Cannot convert undefined or null/.test(String(e))) { fail++; console.log('  ✗ page error on ' + file + ': ' + String(e).slice(0, 180)); } });
    await p.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await p.goto(base + file, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    return p;
  };
  // what the bar is actually painting
  const read = (p) => p.evaluate(() => {
    const n = document.getElementById('tb-modules');
    const anchors = [...n.querySelectorAll('a.tbm')];
    const shown = anchors.filter((a) => a.style.display !== 'none');
    const href = (a) => a.getAttribute('href');
    const brand = document.querySelector('.topbar-in .brand');
    const apps = document.getElementById('fcc-apps');
    const nb = n.getBoundingClientRect();
    const last = shown[shown.length - 1];
    return {
      rows: [...new Set(shown.map((a) => Math.round(a.getBoundingClientRect().top)))].length,
      onRow: shown.map(href),
      withText: shown.filter((a) => a.textContent.trim().length > 0).map(href),
      unnamed: shown.filter((a) => !(a.getAttribute('data-lbl') || '').trim()).map(href),
      denied: anchors.filter((a) => a.style.display === 'none').map(href),
      inBundle: [...document.querySelectorAll('#fcc-apps-menu a.tbm')].map(href),
      appsShown: apps ? getComputedStyle(apps).display !== 'none' : null,
      navTop: Math.round(nb.top), navVisible: getComputedStyle(n).display !== 'none',
      brandBottom: brand ? Math.round(brand.getBoundingClientRect().bottom) : 0,
      rightGap: last ? Math.round(nb.right - last.getBoundingClientRect().right) : null,
      overflowsRight: last ? Math.round(last.getBoundingClientRect().right) - Math.round(nb.right) : 0,
      active: (shown.find((a) => a.classList.contains('on')) || { getAttribute: () => null }).getAttribute('href'),
    };
  });

  /* 1 — one row of icons, below the first, flush right */
  console.log('\none row of icons, below the first, flush right');
  for (const w of [1440, 1280, 1100, 900]) {
    const p = await open(CC, w);
    const r = await read(p);
    ok(w + 'px: the icons are on ONE row', r.rows === 1, r.rows);
    ok(w + 'px: that row is below the wordmark, not beside it', r.navTop >= r.brandBottom, { navTop: r.navTop, brandBottom: r.brandBottom });
    ok(w + 'px: the last icon ends at the row\'s right edge', r.rightGap !== null && r.rightGap <= 1 && r.overflowsRight <= 1, { rightGap: r.rightGap, over: r.overflowsRight });
    ok(w + 'px: no icon carries text', r.withText.length === 0, r.withText);
    ok(w + 'px: every icon keeps its hover name', r.unnamed.length === 0, r.unnamed);
    await p.close();
  }

  /* the negative control — without the widget the same page wraps, so the one-row assertion
     measures something real rather than passing on a bar that was never crowded */
  console.log('\nthe negative control (the same page without the widget)');
  {
    const p = await open(BARE, 1280);
    const r = await read(p);
    ok('without the row widget the icons DO wrap inside the bar', r.rows > 1, r.rows);
    ok('and the ▦ bundle button is painted', r.appsShown === true);
    await p.close();
  }

  /* 2 — every module is on the row, one place */
  console.log('\nevery module is on the row — one place');
  {
    const p = await open(CC, 1280);
    const r = await read(p);
    ok('the row carries every module of the canonical nav, each once',
      r.onRow.length === CANON.length && CANON.every((h) => r.onRow.includes(h)) && new Set(r.onRow).size === r.onRow.length, { row: r.onRow.length, canon: CANON.length });
    ok('the Pricer the ▦ bundle used to hold by default is on the row', r.onRow.includes('/pricer'));
    ok('the row is in the canonical order', r.onRow.join() === CANON.join(), r.onRow);
    ok('nothing is in the ▦ bundle on a fresh device', r.inBundle.length === 0, r.inBundle);
    ok('nothing had to be re-homed to get there — the default bundle is gone', await p.evaluate(() => !document.querySelector('#tb-modules a.tbm[data-nv-home]')));
    ok('the ▦ bundle button is not painted on the desktop', r.appsShown === false);
    ok('no "More" button exists', await p.evaluate(() => !document.getElementById('fcc-navmore') && !document.getElementById('fcc-navmenu')));

    await p.close();
    // a viewer who bundled the Pricer on their phone: the desktop has no bundle to reach it from,
    // so it comes back onto the row — at its own slot, not tacked on the end
    const q = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await q.addInitScript(() => { try { localStorage.setItem('fcc-nav-layout', JSON.stringify({ v: 1, place: { '/pricer': 'apps' }, order: null })); } catch (e) {} });
    await q.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await q.goto(base + CC, { waitUntil: 'domcontentloaded' });
    await q.waitForTimeout(1500);
    const rr = await read(q);
    ok('a viewer-bundled Pricer is re-homed onto the desktop row', rr.onRow.includes('/pricer') && rr.inBundle.length === 0 && (await q.evaluate(() => !!document.querySelector('#tb-modules a.tbm[data-nv-home="apps"][href="/pricer"]'))), { row: rr.onRow, bundle: rr.inBundle });
    ok('…at its canonical slot, not tacked on the end', rr.onRow.indexOf('/pricer') === CANON.indexOf('/pricer') && rr.onRow.join() === CANON.join(), rr.onRow);
    ok('…as an icon, not the bundle\'s labelled row', (await q.evaluate(() => { const a = document.querySelector('#tb-modules a.tbm[href="/pricer"]'); return !a.classList.contains('napps') && !a.querySelector('.nl') && a.textContent.trim() === ''; })));
    await q.close();
    const p2 = await open(CC, 1280);

    /* 5 — the ☰ toggle still hides the menu */
    await p2.click('#nav-collapse');
    await p2.waitForTimeout(250);
    ok('the ☰ toggle still hides the whole menu', !(await read(p2)).navVisible);
    await p2.click('#nav-collapse');
    await p2.waitForTimeout(250);
    ok('and brings it back', (await read(p2)).navVisible);
    await p2.close();
  }

  /* 3 — a module this signin may not open is not on the row */
  console.log('\na denied module is not on the row');
  {
    const p = await open(SCOPED, 1280);
    const r = await read(p);
    ok('MODGATE still hides the ungranted links', r.denied.length > 5, r.denied.length);
    ok('none of them is painted on the row', !r.onRow.some((h) => r.denied.includes(h)), r.onRow);
    ok('the granted ones are on it', ['/workflow', '/feedlab', '/golden'].every((h) => r.onRow.includes(h)), r.onRow);
    await p.close();
  }

  /* 4 — the page you are on */
  console.log('\nthe page you are on is on the row, marked');
  {
    const p = await open(KW, 1100);
    const r = await read(p);
    ok('/kwcal is 16th in the order and on the row', r.onRow.includes('/kwcal'), r.onRow);
    ok('it is the one marked as the page you are on', r.active === '/kwcal', r.active);
    await p.close();
  }

  /* 6 — under 760px the phone layer owns the node */
  console.log('\nunder 760px the phone layer owns the node');
  {
    const p = await open(CC, 390, 844);
    const r = await p.evaluate(() => {
      const n = document.getElementById('tb-modules');
      const apps = document.getElementById('fcc-apps');
      const nav = n.querySelectorAll('a.tbm').length, bundle = document.querySelectorAll('#fcc-apps-menu #fcc-apps-wrap a.tbm').length;
      return { moved: n.querySelectorAll('a.tbm[data-nv-home]').length, appsShown: apps ? getComputedStyle(apps).display !== 'none' : null,
        nav, bundle, header: Math.round((document.querySelector('.topbar') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height) };
    });
    ok('on a phone load nothing is re-homed', r.moved === 0, r.moved);
    ok('the ▦ bundle button is back', r.appsShown === true);
    ok('on a fresh device the bar carries every module — it mirrors the desktop row', r.nav === CANON.length && r.bundle === 0, { nav: r.nav, bundle: r.bundle, canon: CANON.length });
    ok('the header stays inside the phone tripwire\'s 64px', r.header <= 64, r.header);
    await p.close();

    // a viewer who bundled the Pricer, on a desktop window dragged down to phone width: the
    // re-homed Pricer goes back to the bundle in the bundle's own dress
    const q = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await q.addInitScript(() => { try { localStorage.setItem('fcc-nav-layout', JSON.stringify({ v: 1, place: { '/pricer': 'apps' }, order: null })); } catch (e) {} });
    await q.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await q.goto(base + CC, { waitUntil: 'domcontentloaded' });
    await q.waitForTimeout(1500);
    ok('at desktop width the Pricer was re-homed onto the row', await q.evaluate(() => !!document.querySelector('#tb-modules a.tbm[data-nv-home]')));
    await q.setViewportSize({ width: 390, height: 844 });
    await q.waitForTimeout(900);
    const s = await q.evaluate(() => {
      const a = document.querySelector('#fcc-apps-wrap a.tbm[href="/pricer"]');
      return { back: !!a, dressed: !!(a && a.classList.contains('napps') && a.querySelector('.nl') && a.querySelector('.nl').textContent.trim()),
        stray: document.querySelectorAll('#tb-modules a.tbm[data-nv-home]').length,
        total: document.querySelectorAll('#tb-modules a.tbm').length + document.querySelectorAll('#fcc-apps-wrap a.tbm').length };
    });
    ok('after the resize it is back in the bundle', s.back);
    ok('…in the bundle\'s own dress (labelled row)', s.dressed);
    ok('nothing re-homed is left on the bar', s.stray === 0, s.stray);
    ok('and every module is still somewhere', s.total === CANON.length, s.total);
    await q.close();
  }

  /* 7 — the row settles */
  console.log('\nthe row settles');
  {
    const p = await open(CC, 1280);
    const runs = () => p.evaluate(() => window.FCCNavRow.runs());
    const a = await runs();
    await p.evaluate(() => {
      window.__m = 0;
      new MutationObserver((rs) => { window.__m += rs.length; })
        .observe(document.getElementById('tb-modules'), { childList: true, attributes: true, subtree: true });
    });
    await p.waitForTimeout(1500);
    ok('an idle page stops rewriting the nav', (await p.evaluate(() => window.__m)) === 0, await p.evaluate(() => window.__m));
    ok('and stops re-laying the row out', (await runs()) - a === 0, { before: a, after: await runs() });
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
