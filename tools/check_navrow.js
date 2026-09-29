#!/usr/bin/env node
/* THE MODULE MENU HAS THE ROW BELOW — EVERY ICON ON THE RIGHT, THE ▦ BUNDLE AT ITS END ---------
 *
 * Ray, 25 Sep 2026: "tidy up this menu pleease , or allow the core modules dropdown ai the
 * below row". The first cut (#543) put NAMED chips on the row and folded the rest into a
 * "More ▾" while the ▦ bundle button stayed in the top row — two places holding hidden modules.
 * Ray, 27 Sep 2026: "I just want to see icons, so the icons should stay on the right … keep all
 * the icons of the menu on the right-hand side, below the text on the first row." The second cut
 * (#544) did that and hid the ▦ on the desktop, re-homing whatever a viewer had bundled. Ray,
 * 28 Sep 2026: "Can you bring back the bundle, menu bundle feature, on the module menu bar
 * please?" — so the ▦ sits at the end of the icon row and the customiser works on the desktop
 * again, with NO node moved by this widget (it is CSS; the ▦ customiser owns the anchors).
 *
 * A source assertion could not catch any of this: the layout is an injected widget, the nav
 * markup it lays out is in 24 other files, MODGATE hides some of its anchors at runtime, the ▦
 * customiser moves others out of it, and the phone layer takes the whole node away under 760px.
 * So this drives the REAL pages through Chromium, built exactly as the worker serves them, and
 * measures what is painted.
 *
 * What it holds:
 *   1. ONE ROW OF ICONS, BELOW THE FIRST, FLUSH RIGHT — and the ▦ bundle on that same row, to
 *      the right of the last icon, ending at the bar's edge. No chip carries text; every one
 *      keeps the hover name it always had (data-lbl). A negative control builds the same page
 *      WITHOUT the widget and asserts the icons DO wrap inside the bar.
 *   2. ON A FRESH DEVICE every module is on the row in the canonical order and the bundle is
 *      empty — nothing is bundled out of the box.
 *   3. THE BUNDLE WORKS: a viewer's bundled module is OFF the row and IN the ▦ menu (dressed as
 *      the bundle's labelled row, the ▦ wearing its dot); the customiser opens from the ▦, moves
 *      a module to the bundle and back at its own slot, and the choice survives a reload.
 *   4. A DENIED MODULE IS IN NEITHER PLACE. MODGATE hides it with an inline style that travels
 *      with the anchor — on the row and in the bundle.
 *   5. THE PAGE YOU ARE ON is on the row, marked, even when its module sits 16th in the order.
 *   6. THE ☰ TOGGLE HIDES THE WHOLE ROW — icons, hairline and bundle. The page rule is two
 *      classes and the row's carries an id, which beats it; without an explicit rule the button
 *      silently stops working.
 *   7. UNDER 760px THE PHONE LAYER OWNS THE NODE: nothing is moved on a phone load, the ▦ is its
 *      bottom-sheet trigger, and a bundled module stays bundled through a desktop→phone resize.
 *   8. AN IDLE PAGE REWRITES NOTHING — the first cut re-measured itself at 60fps.
 *   9. Every render tripwire that injects the widget set carries this widget.
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
const minus = (h) => CANON.filter((x) => x !== h);

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
  // a page as a viewer sees it; `layout` = a saved ▦ layout on the device (fcc-nav-layout)
  const open = async (file, w, h, layout) => {
    const p = await browser.newPage({ viewport: { width: w || 1280, height: h || 800 } });
    // on a MONDAY the Command Center opens its Monday catch-up panel over the page (by design) — mark today's seen
    await p.addInitScript((lo) => {
      try { localStorage.setItem('mc-' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), '1'); } catch (e) {}
      if (lo) { try { localStorage.setItem('fcc-nav-layout', JSON.stringify(lo)); } catch (e) {} }
    }, layout || null);
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
    const tb = document.querySelector('.topbar-in');
    const apps = document.getElementById('fcc-apps');
    const nb = n.getBoundingClientRect();
    const last = shown[shown.length - 1];
    const lr = last ? last.getBoundingClientRect() : null;
    const ar = apps ? apps.getBoundingClientRect() : null;
    const tbr = tb ? tb.getBoundingClientRect() : null;
    const tbPad = tb ? parseFloat(getComputedStyle(tb).paddingRight) || 0 : 0;
    const bundle = [...document.querySelectorAll('#fcc-apps-menu a.tbm')];
    return {
      rows: [...new Set(shown.map((a) => Math.round(a.getBoundingClientRect().top)))].length,
      onRow: shown.map(href),
      withText: shown.filter((a) => a.textContent.trim().length > 0).map(href),
      unnamed: shown.filter((a) => !(a.getAttribute('data-lbl') || '').trim()).map(href),
      denied: anchors.filter((a) => a.style.display === 'none').map(href),
      inBundle: bundle.map(href),
      bundleDressed: bundle.filter((a) => a.classList.contains('napps') && a.querySelector('.nl') && a.querySelector('.nl').textContent.trim()).map(href),
      appsShown: apps ? getComputedStyle(apps).display !== 'none' : null,
      appsDot: apps ? apps.classList.contains('hasapps') : null,
      appsSameRow: (lr && ar) ? Math.abs((lr.top + lr.bottom) / 2 - (ar.top + ar.bottom) / 2) <= 4 : null,
      appsRightOfIcons: (lr && ar) ? Math.round(ar.left) >= Math.round(lr.right) : null,
      appsEdgeGap: (ar && tbr) ? Math.round((tbr.right - tbPad) - ar.right) : null,
      navTop: Math.round(nb.top), navVisible: getComputedStyle(n).display !== 'none',
      brandBottom: brand ? Math.round(brand.getBoundingClientRect().bottom) : 0,
      rightGap: last ? Math.round(nb.right - lr.right) : null,
      overflowsRight: last ? Math.round(lr.right) - Math.round(nb.right) : 0,
      active: (shown.find((a) => a.classList.contains('on')) || { getAttribute: () => null }).getAttribute('href'),
      rehomed: document.querySelectorAll('[data-nv-home]').length,
    };
  });
  const saved = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('fcc-nav-layout')); } catch (e) { return null; } });

  /* 1 — one row of icons, below the first, flush right, the ▦ at its end */
  console.log('\none row of icons, below the first, flush right — the ▦ bundle at its end');
  for (const w of [1440, 1280, 1100, 900]) {
    const p = await open(CC, w);
    const r = await read(p);
    ok(w + 'px: the icons are on ONE row', r.rows === 1, r.rows);
    ok(w + 'px: that row is below the wordmark, not beside it', r.navTop >= r.brandBottom, { navTop: r.navTop, brandBottom: r.brandBottom });
    ok(w + 'px: the last icon ends at the nav\'s right edge', r.rightGap !== null && r.rightGap <= 1 && r.overflowsRight <= 1, { rightGap: r.rightGap, over: r.overflowsRight });
    ok(w + 'px: the ▦ bundle is painted, on the same row, to the right of the last icon', r.appsShown === true && r.appsSameRow === true && r.appsRightOfIcons === true, { shown: r.appsShown, sameRow: r.appsSameRow, rightOf: r.appsRightOfIcons });
    ok(w + 'px: …and ends at the bar\'s edge', r.appsEdgeGap !== null && Math.abs(r.appsEdgeGap) <= 1, r.appsEdgeGap);
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
    ok('and the ▦ bundle button is still painted (the customiser is the page\'s own)', r.appsShown === true);
    await p.close();
  }

  /* 2 — on a fresh device every module is on the row and the bundle is empty */
  console.log('\non a fresh device every module is on the row, the bundle empty');
  {
    const p = await open(CC, 1280);
    const r = await read(p);
    ok('the row carries every module of the canonical nav, each once',
      r.onRow.length === CANON.length && CANON.every((h) => r.onRow.includes(h)) && new Set(r.onRow).size === r.onRow.length, { row: r.onRow.length, canon: CANON.length });
    ok('the row is in the canonical order', r.onRow.join() === CANON.join(), r.onRow);
    ok('nothing is in the ▦ bundle — nothing is bundled out of the box', r.inBundle.length === 0 && r.appsDot === false, { bundle: r.inBundle, dot: r.appsDot });
    ok('this widget moves no node (nothing is ever "re-homed")', r.rehomed === 0 && !/data-nv-home|rehome\(|unhome\(/.test(readW('navrow_widget.html')));
    ok('no "More" button exists', await p.evaluate(() => !document.getElementById('fcc-navmore') && !document.getElementById('fcc-navmenu')));
    await p.close();
  }

  /* 3 — the bundle works on the desktop */
  console.log('\nthe bundle works: a bundled module is off the row and in the ▦, and the customiser moves it');
  {
    // a viewer who bundled the Pricer
    const p = await open(CC, 1280, 800, { v: 1, place: { '/pricer': 'apps' }, order: null });
    let r = await read(p);
    ok('the bundled Pricer is OFF the row', !r.onRow.includes('/pricer'), r.onRow);
    ok('…and IN the ▦ bundle, dressed as the bundle\'s labelled row', r.inBundle.join() === '/pricer' && r.bundleDressed.join() === '/pricer', { bundle: r.inBundle, dressed: r.bundleDressed });
    ok('the ▦ wears its dot', r.appsDot === true);
    ok('the rest of the row is intact, in the canonical order', r.onRow.join() === minus('/pricer').join(), r.onRow);
    ok('the row is still ONE row with the ▦ at its end', r.rows === 1 && r.appsSameRow === true && r.appsRightOfIcons === true, { rows: r.rows, sameRow: r.appsSameRow, rightOf: r.appsRightOfIcons });

    // the ▦ menu opens on the row and lists it
    await p.click('#fcc-apps-btn');
    await p.waitForTimeout(200);
    const m = await p.evaluate(() => {
      const menu = document.getElementById('fcc-apps-menu'), a = menu.querySelector('a.tbm[href="/pricer"]'), btn = document.getElementById('fcc-apps-btn');
      const mr = menu.getBoundingClientRect(), br = btn.getBoundingClientRect();
      return { open: getComputedStyle(menu).display !== 'none', label: a ? a.textContent.trim() : null, below: Math.round(mr.top) >= Math.round(br.bottom), inside: mr.right <= innerWidth + 1 && mr.left >= -1 };
    });
    ok('the ▦ menu opens below the button, inside the viewport', m.open && m.below && m.inside, m);
    ok('…and names the bundled Pricer', m.label === 'Pricer', m.label);

    // the customiser: Pricer back to the menu, Volume into the bundle
    await p.click('#fcc-apps-cust');
    await p.waitForTimeout(200);
    ok('Customize menu… opens the customiser', await p.evaluate(() => !!document.getElementById('fcc-navcz')));
    await p.click('#fcc-navcz .cz-row[data-h="/pricer"] [data-pl="menu"]');
    await p.waitForTimeout(200);
    r = await read(p);
    ok('Menu puts the Pricer back on the row at its own slot', r.onRow.join() === CANON.join() && r.inBundle.length === 0, r.onRow);
    await p.click('#fcc-navcz .cz-row[data-h="/volume"] [data-pl="apps"]');
    await p.waitForTimeout(200);
    r = await read(p);
    ok('▦ Bundle takes the Volume module off the row into the bundle', !r.onRow.includes('/volume') && r.inBundle.join() === '/volume' && r.onRow.join() === minus('/volume').join(), { row: r.onRow, bundle: r.inBundle });
    await p.click('#cz-done');
    await p.waitForTimeout(150);
    ok('Done closes it', await p.evaluate(() => !document.getElementById('fcc-navcz')));
    const lo = await saved(p);
    ok('the choice is saved on the device', lo && lo.place && lo.place['/volume'] === 'apps' && lo.place['/pricer'] === 'menu', lo);
    await p.close();
    // …and what was saved is what the next load applies (a fresh page seeded with exactly that record —
    // a reload here would re-run the fixture's init script and put the old layout back)
    const q = await open(CC, 1280, 800, lo);
    r = await read(q);
    ok('the next load applies the saved layout: Volume still bundled, the row still whole and in order', !r.onRow.includes('/volume') && r.inBundle.join() === '/volume' && r.onRow.join() === minus('/volume').join() && r.rows === 1, { row: r.onRow, bundle: r.inBundle, rows: r.rows });
    await q.close();
  }

  /* 4 — a module this signin may not open is in neither place */
  console.log('\na denied module is in neither place');
  {
    const p = await open(SCOPED, 1280);
    const r = await read(p);
    ok('MODGATE still hides the ungranted links', r.denied.length > 5, r.denied.length);
    ok('none of them is painted on the row', !r.onRow.some((h) => r.denied.includes(h)), r.onRow);
    ok('the granted ones are on it', ['/workflow', '/feedlab', '/golden'].every((h) => r.onRow.includes(h)), r.onRow);
    await p.close();
    // the same signin with a denied module bundled on their device: it must not show in the ▦ either
    const q = await open(SCOPED, 1280, 800, { v: 1, place: { '/ptypes': 'apps' }, order: null });
    const s = await q.evaluate(() => { const a = document.querySelector('#fcc-apps-menu a.tbm[href="/ptypes"]'); return { there: !!a, hidden: !!(a && a.style.display === 'none') }; });
    ok('a denied module the viewer bundled sits hidden in the bundle — MODGATE\'s inline style travels with it', s.there && s.hidden, s);
    await q.close();
  }

  /* 5 — the page you are on */
  console.log('\nthe page you are on is on the row, marked');
  {
    const p = await open(KW, 1100);
    const r = await read(p);
    ok('/kwcal is 16th in the order and on the row', r.onRow.includes('/kwcal'), r.onRow);
    ok('it is the one marked as the page you are on', r.active === '/kwcal', r.active);
    await p.close();
  }

  /* 6 — the ☰ toggle hides the whole row */
  console.log('\nthe ☰ toggle hides the whole row');
  {
    const p = await open(CC, 1280);
    await p.click('#nav-collapse');
    await p.waitForTimeout(250);
    let r = await read(p);
    ok('the ☰ toggle hides the menu', !r.navVisible);
    ok('…and the ▦ with it', r.appsShown === false);
    ok('…and the hairline', await p.evaluate(() => getComputedStyle(document.querySelector('.topbar-in'), '::before').display === 'none'));
    await p.click('#nav-collapse');
    await p.waitForTimeout(250);
    r = await read(p);
    ok('and brings them back', r.navVisible && r.appsShown === true && r.rows === 1);
    await p.close();
  }

  /* 7 — under 760px the phone layer owns the node */
  console.log('\nunder 760px the phone layer owns the node');
  {
    const p = await open(CC, 390, 844);
    const r = await p.evaluate(() => {
      const n = document.getElementById('tb-modules');
      const apps = document.getElementById('fcc-apps');
      const nav = n.querySelectorAll('a.tbm').length, bundle = document.querySelectorAll('#fcc-apps-menu #fcc-apps-wrap a.tbm').length;
      return { moved: document.querySelectorAll('[data-nv-home]').length, appsShown: apps ? getComputedStyle(apps).display !== 'none' : null,
        inTop: !!(apps && apps.closest('.topbar')), nav, bundle,
        header: Math.round((document.querySelector('.topbar') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height) };
    });
    ok('on a phone load nothing is moved', r.moved === 0, r.moved);
    ok('the ▦ is painted in the top bar (the phone\'s own bottom-sheet trigger)', r.appsShown === true && r.inTop);
    ok('on a fresh device the bar carries every module — it mirrors the desktop row', r.nav === CANON.length && r.bundle === 0, { nav: r.nav, bundle: r.bundle, canon: CANON.length });
    ok('the header stays inside the phone tripwire\'s 64px', r.header <= 64, r.header);
    await p.close();

    // a viewer who bundled the Pricer, on a desktop window dragged down to phone width: it stays
    // bundled — the bundle is the same on both viewports, nothing to hand back
    const q = await open(CC, 1280, 800, { v: 1, place: { '/pricer': 'apps' }, order: null });
    const before = await read(q);
    ok('at desktop width the Pricer is in the bundle, off the row', before.inBundle.join() === '/pricer' && !before.onRow.includes('/pricer'), { bundle: before.inBundle });
    await q.setViewportSize({ width: 390, height: 844 });
    await q.waitForTimeout(900);
    const s = await q.evaluate(() => {
      const a = document.querySelector('#fcc-apps-wrap a.tbm[href="/pricer"]');
      return { still: !!a, dressed: !!(a && a.classList.contains('napps') && a.querySelector('.nl') && a.querySelector('.nl').textContent.trim()),
        onBar: !!document.querySelector('#tb-modules a.tbm[href="/pricer"]'),
        total: document.querySelectorAll('#tb-modules a.tbm').length + document.querySelectorAll('#fcc-apps-wrap a.tbm').length };
    });
    ok('after the resize it is still in the bundle, in the bundle\'s own dress', s.still && s.dressed && !s.onBar, s);
    ok('and every module is still somewhere', s.total === CANON.length, s.total);
    await q.close();
  }

  /* 8 — the row settles */
  console.log('\nthe row settles');
  {
    const p = await open(CC, 1280);
    await p.evaluate(() => {
      window.__m = 0;
      new MutationObserver((rs) => { window.__m += rs.length; })
        .observe(document.getElementById('tb-modules'), { childList: true, attributes: true, subtree: true });
    });
    await p.waitForTimeout(1500);
    ok('an idle page stops rewriting the nav', (await p.evaluate(() => window.__m)) === 0, await p.evaluate(() => window.__m));
    ok('the widget is CSS + a body class — no observer, no layout pass of its own', !/MutationObserver|requestAnimationFrame|insertBefore|appendChild/.test(readW('navrow_widget.html')));
    await p.close();
  }

  /* 9 — the render tripwires all carry the widget */
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
