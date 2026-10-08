// Every /overlays section folds — and the Overlay estate is stacked ABOVE Live overlays, not beside it.
//
// Ray, 7 Oct 2026, over a screenshot of the page with "Overlay Estate" ringed in red:
//   "make 'Overlay Estate' a collapsible section above the Live overlays pls (there's already a
//    dropdown above) no need side by side"
//
// What is folded, and where a card SITS, are properties of the rendered page: the markup can be
// right in one file while a grid rule in another puts the cards back side by side, which is how the
// /labels outage shipped. So this drives the real page through Chromium on a synthetic estate
// (invented brands, no client figure) and checks it as a person uses it:
//
//   · the estate's box sits ABOVE the live panel's — not beside it — at 1440px and at 1100px, and
//     nothing on the page is laid out as a two-column pair of those two cards
//   · a fresh device opens Live overlays, the studio, the trend and the method, and folds the estate
//     (the one Ray asked for: a forty-row table opened above the panel pushes the panel off screen)
//   · a folded card is ONE row — its content not painted, and the line it keeps says what is in it,
//     never an empty row: the estate's names the feeds carrying an overlay AND the ones never
//     scanned, which is the finding a fold must not hide
//   · a click on a title folds / opens that card and this device keeps it through a reload; Enter on
//     the focused title does the same
//   · ⊕ Expand all / ⊖ Collapse all does every card and always names the action still available
//   · a #hash opens the card it names for the visit without rewriting what the device chose
//   · the phone (390px): the skim view leaves these headings to the page, a tap toggles exactly once,
//     and nothing scrolls sideways
//
// NEGATIVE CONTROL at the end: the same page with the fold's own CSS rule removed must FAIL the
// "a folded card is one row" check — so the assertion can never pass on a page nobody is folding.
//
//   node tools/check_ovfold.js
import { createRequire as _cr } from 'node:module';
const require = _cr(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
import { readFileSync } from 'node:fs';
import http from 'node:http';

const REPO = '/home/user/feedspark/';
const PAGE = REPO + 'docs/FeedSpark_Overlays.html';
const WIDGETS = ['instr_collapse.html', 'digest_widget.html', 'mobile_widget.html']
  .map((f) => readFileSync(REPO + 'docs/' + f, 'utf8')).join('\n');

/* ---- a synthetic estate: invented brands, and three feeds nobody has scanned ---- */
const BRANDS = ['Northwind', 'Atelier', 'Harbour', 'Linden', 'Calder', 'Thornbury'];
const FEEDS = [];
BRANDS.forEach((b, i) => {
  ['gb-fb', 'gb', 'de'].forEach((m, k) => {
    const n = i * 3 + k;
    // 3 of 18 never scanned — but never the feed the page OPENS on, or the live panel and the trend
    // would be read on a feed with no reading and this would be testing the empty state
    const scanned = !(n >= 6 && n % 4 === 3);
    const ovl = scanned && n % 3 === 0 ? 120 + n * 7 : 0;
    FEEDS.push({
      client: b, mkt: m, kind: 'xml',
      scan: scanned ? { t: Date.now() - n * 36e5, rows: 1500 + n * 40, ovl, addl: 0, plain: 1500 + n * 40 - ovl,
        hasImage: true, hosts: [['cdn.example.test', 1500]],
        types: ovl ? [{ key: 'image_process_engine', label: 'Dynamic overlay engine', n: ovl }] : [] } : null,
    });
  });
});
const OVL_ON = FEEDS.filter((f) => f.scan && f.scan.ovl).length;
const NEVER = FEEDS.filter((f) => !f.scan).length;
// two scans on the opening feed so the trend really draws, and its folded line can say so
const HIST = [{ t: Date.now() - 864e5, rows: 1500, ovl: 90 }, { t: Date.now() - 36e5, rows: 1500, ovl: 120 }];

const FILES = {
  '/overlays/engine.js': 'docs/overlay_engine.js',
  '/overlays/studio.js': 'docs/overlay_studio_engine.js',
  '/feedlab/engine.js': 'docs/feedlab_engine.js',
};
let STRIP_FOLD = false;
function html() {
  let s = readFileSync(PAGE, 'utf8');
  // the fold's one structural rule — removing it is the negative control
  if (STRIP_FOLD) s = s.replace(/\n\s*\.card\.folded>:not\(\.fhd\)[^\n]*\n/, '\n');
  return s.indexOf('</body>') >= 0 ? s.replace('</body>', WIDGETS + '</body>') : s + '\n' + WIDGETS;
}
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams;
  const send = (c, ct, b) => { res.writeHead(c, { 'content-type': ct }); res.end(b); };
  const j = (o) => send(200, 'application/json', JSON.stringify(o));
  if (p === '/' || p === '/overlays') return send(200, 'text/html; charset=utf-8', html());
  if (FILES[p]) return send(200, 'application/javascript; charset=utf-8', readFileSync(REPO + FILES[p], 'utf8'));
  if (p === '/api/overlays') {
    const c = q.get('client'), m = q.get('market');
    if (!c) return j({ ok: true, feeds: FEEDS });
    const f = FEEDS.find((x) => x.client === c && x.mkt === m);
    // the real route answers a per-feed read with `snap` (the roster uses `scan`) — see worker.js
    // /api/overlays; returning `scan` here tested the page's never-scanned state instead
    return j({ ok: true, client: c, market: m, kind: 'xml', cap: null, hist: f && f.scan ? HIST : [], snap: (f && f.scan) || null });
  }
  return j({ ok: true });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

let pass = 0, fail = 0;
const t = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : ' — ' + JSON.stringify(x))); };
const CARDS = ['estate', 'detail', 'studio', 'trend-card', 'meth'];
const OPEN0 = ['detail', 'studio', 'trend-card', 'meth'];

const browser = await chromium.launch();
const errors = [];
async function open(w, h, hash, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: w, height: h || 1000 } });
  const page = await c.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|fonts\.googleapis/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await page.goto(BASE + '/overlays' + (hash || ''));
  await page.waitForSelector('#esttbl tbody tr', { state: 'attached' });
  await page.waitForFunction(() => !!document.querySelector('#detail > .fhd .fold'));
  return { page, ctx: c };
}
// press ⊕/⊖ until every card is folded (or opened) — the button names the action still available, so
// which way one press goes depends on what is open when it is pressed
async function foldEvery(page, want) {
  for (let i = 0; i < 3; i++) {
    const n = await page.$$eval('main .card.folded', (a) => a.length);
    if (want ? n === CARDS.length : n === 0) return;
    await page.click('#fold-all');
    await page.waitForTimeout(80);
  }
  throw new Error('⊕/⊖ never reached ' + (want ? 'all folded' : 'all open'));
}
// what the PAINT says, never what a property claims
const fold = (page) => page.evaluate((ids) => ids.map((id) => {
  const c = document.getElementById(id);
  if (!c) return { id, missing: true };
  const b = c.querySelector(':scope > .fhd .fold');
  const body = Array.prototype.slice.call(c.children).filter((e) => !e.classList.contains('fhd'));
  const painted = body.some((e) => e.getBoundingClientRect().height > 0);
  return { id, folded: c.classList.contains('folded'), aria: b && b.getAttribute('aria-expanded'),
    painted, sum: (c.querySelector(':scope > .fhd .fsum') || {}).textContent || '',
    h: Math.round(c.getBoundingClientRect().height) };
}), CARDS);

console.log('· the estate is ABOVE the live panel, not beside it');
{
  for (const w of [1440, 1100]) {
    const { page, ctx } = await open(w);
    const box = await page.evaluate(() => {
      const r = (id) => { const e = document.getElementById(id).getBoundingClientRect(); return { top: e.top, bottom: e.bottom, left: e.left, right: e.right }; };
      return { e: r('estate'), d: r('detail'), duo: document.querySelectorAll('.duo').length };
    });
    t(w + 'px: the estate\'s whole box sits above the live panel\'s', box.e.bottom <= box.d.top + 1, box);
    t(w + 'px: they share the same left edge — not two columns', Math.abs(box.e.left - box.d.left) < 2, box);
    t(w + 'px: the side-by-side wrapper is gone from the page', box.duo === 0, box);
    await ctx.close();
  }
  const src = readFileSync(PAGE, 'utf8');
  t('and its CSS left with it, so nothing can re-create the pair', !/\.duo\s*\{/.test(src), 'a .duo rule survives');
}

console.log('· a fresh device: the estate folded, everything else open');
{
  const { page, ctx } = await open(1440);
  const f = await fold(page);
  const by = {}; f.forEach((x) => (by[x.id] = x));
  t('every card carries a fold button', f.every((x) => !x.missing && x.aria !== null), f);
  t('the estate opens FOLDED — the one Ray asked for', by.estate.folded === true && by.estate.aria === 'false', by.estate);
  t('its rows are not painted', by.estate.painted === false, by.estate);
  t('and it really is one row (under 90px)', by.estate.h > 0 && by.estate.h < 90, by.estate);
  // "painted" is asserted only where the card HAS something to paint: the method card's whole body is
  // a data-instr list, which the ⓘ widget collapses by design, so an open method card paints nothing
  OPEN0.forEach((id) => t('"' + id + '" opens open', by[id].folded === false && by[id].aria === 'true' && (id === 'meth' || by[id].painted === true), by[id]));
  await ctx.close();
}

console.log('· the line a folded card keeps says what is in it');
{
  const { page, ctx } = await open(1440);
  const sum = await page.$eval('#estate > .fhd .fsum', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  t('the estate names its feeds', new RegExp('\\b' + FEEDS.length + ' feeds\\b').test(sum), sum);
  t('…the ones carrying an overlay', new RegExp('\\b' + OVL_ON + ' carrying an overlay').test(sum), sum);
  t('…and the ones nobody has scanned — the finding a fold must not hide', new RegExp('\\b' + NEVER + ' never scanned').test(sum), sum);
  // fold EVERY card and read every line off the paint. The button names the action still available, and
  // with the estate already folded that action is "expand" — so press it until nothing is open.
  await foldEvery(page, true);
  const f = await fold(page);
  t('folded, not one card keeps an empty row', f.every((x) => /\S/.test(x.sum)), f.map((x) => [x.id, x.sum]));
  t('…and none of them is painting its body', f.every((x) => !x.painted), f);
  const d = f.find((x) => x.id === 'detail').sum;
  const who = await page.$eval('#brand', (e) => e.value);
  t('Live overlays\' line carries the feed on screen and its coverage', d.indexOf(who) >= 0 && /\(\d+(\.\d+)?%\)/.test(d), { d, who });
  t('the trend\'s line says how many scans it draws from', /\b2 scans\b/.test(f.find((x) => x.id === 'trend-card').sum), f.find((x) => x.id === 'trend-card').sum);
  await ctx.close();
}

console.log('· a click folds, the device keeps it, Enter does the same');
{
  const { page, ctx } = await open(1440);
  await page.click('#estate > .fhd .fold');
  await page.waitForFunction(() => !document.getElementById('estate').classList.contains('folded'));
  t('a click on the estate\'s title opens it', (await fold(page)).find((x) => x.id === 'estate').painted === true);
  await page.click('#detail > .fhd .fold');
  await page.waitForFunction(() => document.getElementById('detail').classList.contains('folded'));
  t('a click on Live overlays\' title folds it', (await fold(page)).find((x) => x.id === 'detail').folded === true);
  const stored = await page.evaluate(() => localStorage.getItem('fcc-ovl-fold'));
  t('the device wrote the choice down', /"estate":1/.test(stored) && /"detail":0/.test(stored), stored);
  const p2 = await ctx.newPage();
  await p2.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await p2.goto(BASE + '/overlays');
  await p2.waitForSelector('#detail > .fhd .fold');
  const f2 = await fold(p2); const by2 = {}; f2.forEach((x) => (by2[x.id] = x));
  t('a reload lands on what the person chose, both ways round', by2.estate.folded === false && by2.detail.folded === true, f2);
  await p2.close();
  // Enter on the focused title
  await page.focus('#meth > .fhd .fold');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('meth').classList.contains('folded'));
  t('Enter on a focused title folds it too', (await fold(page)).find((x) => x.id === 'meth').folded === true);
  await ctx.close();
}

console.log('· ⊕ Expand all / ⊖ Collapse all');
{
  const { page, ctx } = await open(1440);
  const lbl = () => page.$eval('#fold-all', (b) => b.textContent.trim() + '|' + b.getAttribute('data-to'));
  t('with the estate folded the button offers to EXPAND', (await lbl()).startsWith('⊕'), await lbl());
  await page.click('#fold-all');
  await page.waitForFunction(() => document.querySelectorAll('.card.folded').length === 0);
  t('one click opens every card', (await fold(page)).every((x) => !x.folded));
  t('…and the button now offers to collapse', (await lbl()).startsWith('⊖'), await lbl());
  await page.click('#fold-all');
  await page.waitForFunction((n) => document.querySelectorAll('main .card.folded').length === n, CARDS.length);
  t('the next click folds every card', (await fold(page)).every((x) => x.folded));
  t('…and it names the action still available', (await lbl()).startsWith('⊕'), await lbl());
  await ctx.close();
}

console.log('· picking a feed in the estate opens the panel that answers for it');
{
  const { page, ctx } = await open(1440);
  // open the estate, fold the live panel by hand, then click a feed — the click is a request to SEE it
  await page.click('#estate > .fhd .fold');
  await page.waitForFunction(() => !document.getElementById('estate').classList.contains('folded'));
  await page.click('#detail > .fhd .fold');
  await page.waitForFunction(() => document.getElementById('detail').classList.contains('folded'));
  await page.click('#esttbl tbody tr.row:nth-child(4)');
  await page.waitForTimeout(200);
  t('the live panel opens for the feed the reader asked for', (await fold(page)).find((x) => x.id === 'detail').folded === false);
  t('…and the device still has it recorded folded, so the next visit obeys the person', /"detail":0/.test(await page.evaluate(() => localStorage.getItem('fcc-ovl-fold'))), await page.evaluate(() => localStorage.getItem('fcc-ovl-fold')));
  await ctx.close();
}

console.log('· a #hash opens the card it names, for the visit only');
{
  const { page, ctx } = await open(1440, 1000, '#estate');
  t('the estate opens because the link asked for it', (await fold(page)).find((x) => x.id === 'estate').painted === true);
  t('…without rewriting what the device chose', await page.evaluate(() => !localStorage.getItem('fcc-ovl-fold')), await page.evaluate(() => localStorage.getItem('fcc-ovl-fold')));
  await ctx.close();
}

console.log('· the phone');
{
  const { page, ctx } = await open(390, 820);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t('nothing scrolls sideways at 390px', over <= 1, over);
  const own = await page.evaluate(() => Array.prototype.slice.call(document.querySelectorAll('main .card > .fhd h3'))
    .map((h) => !!h.querySelector('[aria-expanded]:not(.instr-tgl)')));
  t('the skim view leaves every one of these headings to the page', own.length === CARDS.length && own.every(Boolean), own);
  const before = (await fold(page)).find((x) => x.id === 'detail').folded;
  await page.click('#detail > .fhd .fold');
  await page.waitForTimeout(120);
  const after = (await fold(page)).find((x) => x.id === 'detail').folded;
  t('a tap toggles exactly once — never twice back to where it was', after === !before, { before, after });
  await ctx.close();
}

console.log('· negative control: the same page with the fold rule removed');
{
  STRIP_FOLD = true;
  const { page, ctx } = await open(1440);
  const f = (await fold(page)).find((x) => x.id === 'estate');
  t('a folded card is NOT one row once the rule is gone, so the check means something', f.painted === true && f.h >= 90, f);
  await ctx.close();
  STRIP_FOLD = false;
}

t('no console errors anywhere in the run', errors.length === 0, errors.slice(0, 4));
await browser.close();
srv.close();
console.log((fail ? '\n✗ ' : '\n✓ ') + 'overlays fold: ' + pass + ' checks pass' + (fail ? ', ' + fail + ' FAIL' : ''));
process.exit(fail ? 1 : 0);
