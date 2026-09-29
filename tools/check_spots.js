#!/usr/bin/env node
/* SPOT ILLUSTRATIONS — WHERE THEY LAND, MEASURED --------------------------------------------------
 *
 * Ray, 29 Sep 2026: "generate / add in icons like (similar) to GMC like this to ease on eye strain".
 * A source read cannot tell whether a hero's art runs under its title, whether a card's spot lands
 * on the tools at the row's right, or whether the set reads as a light block in the dark theme.
 * So this drives the REAL pages, built exactly as the worker serves them, and measures:
 *   1. every data-spot host carries exactly ONE spot, drawn;
 *   2. the hero art sits at the hero's content corner (right edge, level with the eyebrow — whatever
 *      the host's own padding), and the title's TEXT ends before it, and it touches no control;
 *   3. a card's spot is the first thing on its header row, at the row's left edge, and touches no
 *      control in that row (the tools live at the right);
 *   4. a corner spot is inside its card, at the top-right, clear of the heading's text;
 *   5. on a phone the hero art is not drawn, a folded card hides its spot with its content and an
 *      opened one draws it small, and nothing overflows sideways;
 *   6. in the dark theme the disc and the sheet are dark — no light island;
 *   7. an idle page places nothing twice;
 *   8. /design draws the whole set.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_spots.js
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
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '\n      got: ' + JSON.stringify(got) : '')); } };

const ORDER = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html',
  'apps_widget.html', 'navrow_widget.html', 'spots_widget.html', 'hours_widget.html', 'touch_widget.html', 'migration_widget.html'];
const MODGATE = eval((W.match(/const MODGATE = ([^]*?);\n/) || [])[1]);
const readW = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');
const inject = (h, x) => (h.indexOf('</body>') >= 0 ? h.replace('</body>', x + '\n</body>') : h + '\n' + x);   // the worker's own rule
const FCC_CSS = (readW('FeedSpark_Design.html').match(/\/\* FCC-DESIGN:START \*\/([\s\S]*?)\/\* FCC-DESIGN:END \*\//) || ['', ''])[1];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spots-'));
function build(page) {
  const extra = ORDER.map(readW).join('\n') + '\n<script>window.__FCCMOD=null;</script>\n' + MODGATE + '\n' + readW('mobile_widget.html') + '\n' + readW('digest_widget.html');
  fs.writeFileSync(path.join(tmp, page), inject(readW(page), extra));
  return page;
}
const PAGES = ['FeedSpark_AIVisibility.html', 'FeedSpark_ROAS.html', 'FeedSpark_TaskManager.html', 'FeedSpark_Schedule.html', 'FeedSpark_Catalog.html', 'FeedSpark_Transformation.html', 'FeedSpark_Design.html'];

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('· playwright not installed — skipping (run with NODE_PATH=$(npm root -g))'); process.exit(0); }
  PAGES.forEach(build);
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/design/fcc.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(FCC_CSS); return; }
    const f = path.join(tmp, u.replace(/^\//, ''));
    fs.readFile(f, (e, b) => { if (e) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); } else { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end(b); } });
  });
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const open = async (file, w, h) => {
    const p = await browser.newPage({ viewport: { width: w || 1280, height: h || 900 } });
    await p.addInitScript(() => { try { localStorage.setItem('mc-' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), '1'); } catch (e) {} });
    p.on('pageerror', (e) => { if (!/Cannot convert undefined or null/.test(String(e))) { fail++; console.log('  ✗ page error on ' + file + ': ' + String(e).slice(0, 160)); } });
    await p.goto(base + file, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    return p;
  };
  // what each host is painting
  const read = (p) => p.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const textRect = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const b = rg.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const out = [];
    // PLACED spots only (they carry their placement class) — /design's gallery draws sixteen bare .spot tiles
    // inside the § Spot illustrations section, which is itself a host
    const PLACED = '.spot-hero,.spot-card,.spot-corner';
    document.querySelectorAll('[data-spot]').forEach((host) => {
      const spots = host.querySelectorAll(PLACED);
      const s = spots[0]; const o = { name: host.getAttribute('data-spot'), id: host.id || host.className, n: spots.length, drawn: !!(s && s.getBoundingClientRect().width > 0), kind: s ? (s.className.match(/spot-(hero|card|corner)/) || [])[1] : null };
      if (!s) { out.push(o); return; }
      const sr = r(s), cs = getComputedStyle(host);
      if (o.kind === 'hero') {
        const h1 = host.querySelector('h1');
        const hb = host.getBoundingClientRect();
        o.edgeGap = Math.round((hb.right - parseFloat(cs.paddingRight)) - sr.r);
        o.topGap = Math.round(sr.t - (hb.top + parseFloat(cs.paddingTop)));   // -4: level with the eyebrow, whatever the host's own padding
        o.titleClear = h1 ? Math.round(sr.l - textRect(h1).r) : null;
        const ctls = [...host.querySelectorAll('button,select,input,a.btn')].filter((c) => c.getBoundingClientRect().width > 0);
        o.hitsControl = ctls.some((c) => hit(r(c), sr));
        o.inHero = hit(r(host), sr);
      } else if (o.kind === 'card') {
        const row = s.parentElement; const rr = r(row);
        o.first = row.firstElementChild === s;
        o.leftGap = Math.round(sr.l - rr.l);
        const ctls = [...row.querySelectorAll('button,select,input,a,.tools *')].filter((c) => c !== s && !s.contains(c) && c.getBoundingClientRect().width > 0);
        o.hitsControl = ctls.some((c) => hit(r(c), sr));
        const title = row.querySelector('h2,h3');
        o.titleRight = title ? Math.round(textRect(title).l - sr.r) : null;
      } else if (o.kind === 'corner') {
        const hr = r(host);
        o.rightGap = Math.round(hr.r - sr.r); o.topGap = Math.round(sr.t - hr.t);
        const title = host.querySelector('h2,h3');
        o.titleClear = title ? Math.round(sr.l - textRect(title).r) : null;
        o.inside = hit(hr, sr) && sr.r <= hr.r + 1 && sr.t >= hr.t - 1;
      }
      out.push(o);
    });
    return { hosts: out, scrollW: document.documentElement.scrollWidth, inner: innerWidth, total: document.querySelectorAll(PLACED).length };
  });

  for (const page of PAGES) {
    console.log('\n' + page.replace('FeedSpark_', '').replace('.html', ''));
    const p = await open(page, 1280, 900);
    const a = await read(p);
    ok('every data-spot host carries exactly one spot, drawn', a.hosts.length > 0 && a.hosts.every((h) => h.n === 1 && h.drawn), a.hosts.filter((h) => h.n !== 1 || !h.drawn));
    const hero = a.hosts.filter((h) => h.kind === 'hero');
    if (page !== 'FeedSpark_Design.html' || hero.length) {
      ok('the hero art sits at the hero\'s content corner — right edge, level with the eyebrow — inside it', hero.length === 1 && Math.abs(hero[0].edgeGap) <= 2 && hero[0].topGap === -4 && hero[0].inHero, hero);
      ok('the title\'s text ends before the art, and the art touches no control', hero.every((h) => h.titleClear === null || h.titleClear >= 8) && hero.every((h) => !h.hitsControl), hero);
    }
    const cards = a.hosts.filter((h) => h.kind === 'card');
    if (cards.length) {
      ok('a card\'s spot is the first thing on its header row, at the row\'s left edge', cards.every((h) => h.first && Math.abs(h.leftGap) <= 2), cards);
      ok('…left of the title, touching no control in the row', cards.every((h) => h.titleRight === null || h.titleRight >= 4) && cards.every((h) => !h.hitsControl), cards);
    }
    const corners = a.hosts.filter((h) => h.kind === 'corner');
    if (corners.length) ok('a corner spot sits inside its card at the top-right, clear of the heading', corners.every((h) => h.inside && h.rightGap >= 12 && h.rightGap <= 24 && h.topGap >= 10 && (h.titleClear === null || h.titleClear >= 6)), corners);
    ok('nothing overflows sideways', a.scrollW <= a.inner, { scrollW: a.scrollW, inner: a.inner });
    // idle: nothing placed twice
    await p.waitForTimeout(1200);
    const b = await read(p);
    ok('an idle page places nothing twice', b.total === a.total && b.hosts.every((h) => h.n === 1), { before: a.total, after: b.total });
    // dark
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await p.waitForTimeout(150);
    const dk = await p.evaluate(() => {
      const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g) || [0, 0, 0]; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
      const g = document.querySelector('.spot .g'), pp = document.querySelector('.spot .p');
      return { disc: g ? lum(getComputedStyle(g).fill) : null, sheet: pp ? lum(getComputedStyle(pp).fill) : null };
    });
    ok('in the dark theme the disc and the sheet are dark — no light island', dk.disc !== null && dk.disc < 0.3 && (dk.sheet === null || dk.sheet < 0.3), dk);
    await p.close();
  }

  /* the phone: the hero art is not drawn; the card spots stay, small; nothing overflows */
  console.log('\nphone (390px)');
  {
    const p = await open('FeedSpark_AIVisibility.html', 390, 844);
    // the digest fold hides a card's content off the heading's line of descent — the spot with it; the tap row is the digest's
    const f = await p.evaluate(() => ({ folded: [...document.querySelectorAll('.spot-card')].map((s) => getComputedStyle(s).display), digest: !!(window.FCCDigest && window.FCCDigest.expandAll) }));
    ok('a folded card shows its tap row alone — the spot comes with the content', f.digest && f.folded.length > 0 && f.folded.every((d) => d === 'none'), f);
    await p.evaluate(() => window.FCCDigest.expandAll());
    await p.waitForTimeout(400);
    const m = await p.evaluate(() => ({
      hero: [...document.querySelectorAll('.spot-hero')].map((s) => getComputedStyle(s).display),
      cards: [...document.querySelectorAll('.spot-card')].map((s) => ({ w: Math.round(s.getBoundingClientRect().width), want: s.closest('.mod') ? 34 : 36 })),
      pad: getComputedStyle(document.querySelector('.spot-host-hero > h1')).paddingRight,
      scrollW: document.documentElement.scrollWidth, inner: innerWidth,
    }));
    ok('the hero art is not drawn on a phone and the title takes its width back', m.hero.every((d) => d === 'none') && m.pad === '0px', m);
    ok('opened, the card spots are drawn at 36px', m.cards.length > 0 && m.cards.every((c) => c.w === c.want), m.cards);
    ok('nothing overflows sideways', m.scrollW <= m.inner, { scrollW: m.scrollW, inner: m.inner });
    await p.close();
  }

  /* /design draws the set */
  console.log('\n/design');
  {
    const p = await open('FeedSpark_Design.html', 1280, 900);
    const g = await p.evaluate(() => ({ tiles: document.querySelectorAll('#spots-grid .sp-tile').length, drawn: [...document.querySelectorAll('#spots-grid .sp-tile .spot svg')].filter((s) => s.getBoundingClientRect().width > 0).length, names: window.FCCSpots ? window.FCCSpots.names.length : 0 }));
    ok('the gallery draws every spot in the set', g.tiles === g.names && g.drawn === g.names && g.names === 16, g);
    await p.close();
  }

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
