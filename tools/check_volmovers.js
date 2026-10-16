// /volume — the movers card breaks the movement down by MORE THAN THE CATEGORY.
//
// Ray, 16 Oct 2026, over the Category movers card: "module volume > can we breakdown new arrivals
// movers further more by more fields on feeds? (PT/ color/ gender etc ....)"
//
// The worker keeps, per day, a top-12 in/out table per dimension (volTrack — tools/test_volume.mjs
// pins the arithmetic). This drives the REAL page through Chromium on an invented feed and checks
// the card as a person uses it:
//
//   · a chip per dimension; Category is the one a fresh device opens on, and the table reads exactly
//     what the category table always read
//   · picking Brand re-titles the card, re-heads the first column, and the rows are the brand
//     figures summed across the window — checked against a sum this test makes itself
//   · a dimension NO day in the window carries (gender here) is dimmed on its chip and, picked,
//     says so in words — never an empty table
//   · a day captured before the facts shipped is COUNTED on the card ("N moved products … not
//     attributed by brand"), never read as blank or as zero
//   · the pick is this device's and survives a reload; the day-click still scopes the table
//   · the phone (390px): the chips wrap, nothing scrolls sideways
//
//   node tools/check_volmovers.js
import { createRequire as _cr } from 'node:module';
const require = _cr(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
import { readFileSync } from 'node:fs';
import http from 'node:http';

const REPO = '/home/user/feedspark/';
const PAGE = REPO + 'docs/FeedSpark_Volume.html';
const WIDGETS = ['instr_collapse.html', 'digest_widget.html', 'mobile_widget.html', 'keep_widget.html']
  .map((f) => readFileSync(REPO + 'docs/' + f, 'utf8')).join('\n');

const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
// an invented brand; four days inside the 30-day window — one of them from before the facts shipped
const HIST = [
  { d: day(20), rows: 1000, in: 12, out: 7, cats: [{ c: 'Bags', in: 8, out: 2 }, { c: 'Hats', in: 4, out: 5 }], dnr: { in: 12, out: 7 } },
  { d: day(9), rows: 1010, in: 30, out: 20, cats: [{ c: 'Bags', in: 20, out: 5 }, { c: 'Hats', in: 10, out: 15 }],
    dims: { pt2: [{ c: 'Bags > Totes', in: 20, out: 5 }, { c: 'Hats > Caps', in: 10, out: 15 }],
      brand: [{ c: 'Northwind', in: 25, out: 10 }, { c: 'Harbour', in: 5, out: 10 }],
      color: [{ c: 'Black', in: 18, out: 12 }, { c: 'Tan', in: 12, out: 8 }],
      avail: [{ c: 'In stock', in: 30, out: 2 }, { c: 'Out of stock', in: 0, out: 18 }] } },
  { d: day(3), rows: 1025, in: 15, out: 0, cats: [{ c: 'Bags', in: 15, out: 0 }],
    dims: { pt2: [{ c: 'Bags > Totes', in: 15, out: 0 }], brand: [{ c: 'Northwind', in: 9, out: 0 }, { c: 'Linden', in: 6, out: 0 }],
      color: [{ c: 'Black', in: 15, out: 0 }], avail: [{ c: 'In stock', in: 15, out: 0 }] } },
  { d: day(1), rows: 1020, in: 0, out: 5, cats: [{ c: 'Hats', in: 0, out: 5 }],
    dims: { pt2: [{ c: 'Hats > Caps', in: 0, out: 5 }], brand: [{ c: 'Harbour', in: 0, out: 5 }], color: [{ c: 'Black', in: 0, out: 5 }], avail: [{ c: 'Out of stock', in: 0, out: 5 }] } },
];
// the independent sum the brand table must read
const BRAND = {};
HIST.forEach((h) => ((h.dims && h.dims.brand) || []).forEach((r) => { const e = BRAND[r.c] = BRAND[r.c] || { in: 0, out: 0 }; e.in += r.in; e.out += r.out; }));
const DNR = HIST.reduce((s, h) => s + (h.dnr ? h.dnr.in + h.dnr.out : 0), 0);

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const send = (c, ct, b) => { res.writeHead(c, { 'content-type': ct }); res.end(b); };
  const j = (o) => send(200, 'application/json', JSON.stringify(o));
  if (p === '/' || p === '/volume') { const s = readFileSync(PAGE, 'utf8'); return send(200, 'text/html; charset=utf-8', s.indexOf('</body>') >= 0 ? s.replace('</body>', WIDGETS + '</body>') : s + '\n' + WIDGETS); }
  if (p === '/volume/engine.js') return send(200, 'application/javascript; charset=utf-8', readFileSync(REPO + 'docs/arrivals_engine.js', 'utf8'));
  if (p === '/feedlab/engine.js') return send(200, 'application/javascript; charset=utf-8', readFileSync(REPO + 'docs/feedlab_engine.js', 'utf8'));
  if (p === '/api/feed/clients') return j({ ok: true, clients: { Northwind: [{ mkt: 'gb', kind: 'xml' }] } });
  if (p === '/api/feed/markets') return j({ ok: true, markets: ['gb'] });
  if (p === '/api/volume/arrivals') return j({ ok: true, feeds: [] });
  if (p === '/api/volume') return j({ ok: true, client: 'Northwind', market: 'gb', tracked: 'xml', hist: HIST, scans: [], dob: null });
  return j({ ok: true });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

let pass = 0, fail = 0;
const t = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : ' — ' + JSON.stringify(x))); };
const browser = await chromium.launch();
const errors = [];
async function open(w, ctx) {
  const c = ctx || await browser.newContext({ viewport: { width: w, height: 1000 } });
  const page = await c.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|fonts\.googleapis/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await page.goto(BASE + '/volume');
  await page.waitForSelector('#cattbl tbody tr', { state: 'attached' });
  return { page, ctx: c };
}
const read = (page) => page.evaluate(() => ({
  title: document.getElementById('cats-title').textContent, col: document.getElementById('cats-col').textContent,
  chips: [...document.querySelectorAll('#dimrow [data-dim]')].map((b) => ({ k: b.getAttribute('data-dim'), on: b.classList.contains('on'), dim: b.style.opacity !== '' })),
  rows: [...document.querySelectorAll('#cattbl tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
  tableShown: document.getElementById('cattbl').style.display !== 'none',
  empty: document.getElementById('cats-empty').hidden ? '' : document.getElementById('cats-empty').textContent,
  nr: document.getElementById('cats-nr').hidden ? '' : document.getElementById('cats-nr').textContent,
}));
const num = (s) => +String(s).replace(/[^\d]/g, '');

let { page, ctx } = await open(1440);
let r = await read(page);
t('a fresh device opens on Category, every dimension a chip', r.chips.length === 8 && r.chips[0].k === 'cat' && r.chips[0].on && r.title === 'Category movers' && r.col === 'Category', r);
t('…and the category table reads as it always did (Bags +43 −7, Hats +14 −25)', r.rows.length === 2 && r.rows[0][0] === 'Bags' && num(r.rows[0][1]) === 43 && num(r.rows[0][3]) === 7 && r.rows[1][0] === 'Hats' && num(r.rows[1][1]) === 14 && num(r.rows[1][3]) === 25, r.rows);
t('a dimension no day carries (gender, age group, tier 3) is dimmed on its chip; the carried ones are not', r.chips.filter((c) => c.dim).map((c) => c.k).sort().join(',') === 'age,gender,pt3' , r.chips);
t('no not-recorded note on the category view (every day attributes its category)', r.nr === '', r.nr);

await page.click('#dimrow [data-dim="brand"]'); await page.waitForTimeout(80);
r = await read(page);
t('picking Brand re-titles the card and re-heads the column', r.title === 'Brand movers' && r.col === 'Brand' && r.chips.find((c) => c.k === 'brand').on, r);
const exp = Object.keys(BRAND).sort((a, b) => (BRAND[b].in + BRAND[b].out) - (BRAND[a].in + BRAND[a].out));
t('…the rows are the brand figures summed across the window, biggest mover first', r.rows.length === exp.length && r.rows.every((row, i) => row[0] === exp[i] && num(row[1]) === BRAND[exp[i]].in && num(row[3]) === BRAND[exp[i]].out), { rows: r.rows, exp, BRAND });
t('…and the day captured before the facts shipped is COUNTED, not read as blank', /^19 moved products/.test(r.nr) && /not attributed by brand/.test(r.nr) && DNR === 19, r.nr);

await page.click('#dimrow [data-dim="gender"]'); await page.waitForTimeout(80);
r = await read(page);
t('a dimension no day carries says so in words — never an empty table', !r.tableShown && /No gender recorded on these days/.test(r.empty) && r.rows.length === 0, r);

await page.click('#dimrow [data-dim="avail"]'); await page.waitForTimeout(80);
r = await read(page);
t('availability reads the bucket words', r.rows.some((x) => x[0] === 'In stock' && num(x[1]) === 45) && r.rows.some((x) => x[0] === 'Out of stock' && num(x[3]) === 23), r.rows);

// the day click still scopes the table on the picked dimension
await page.click('#dimrow [data-dim="color"]'); await page.waitForTimeout(80);
await page.evaluate((d) => { const h = document.querySelector('.hit[data-day="' + d + '"]'); if (h) h.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, day(3));
await page.waitForTimeout(80);
r = await read(page);
t('a day click scopes the picked dimension to that day (Black +15 on the day)', /Colour movers · /.test(r.title) && r.rows.length === 1 && r.rows[0][0] === 'Black' && num(r.rows[0][1]) === 15, r);

// the pick survives a reload on this device
const p2 = await ctx.newPage();
await p2.route('**/*', (x) => (x.request().url().startsWith(BASE) ? x.continue() : x.abort()));
await p2.goto(BASE + '/volume'); await p2.waitForSelector('#dimrow [data-dim]', { state: 'attached' }); await p2.waitForTimeout(150);
r = await read(p2);
t('the pick is this device\'s and survives a reload (Colour)', r.chips.find((c) => c.k === 'color').on && r.title === 'Colour movers', r.chips);
await ctx.close();

// the phone
({ page, ctx } = await open(390));
// the skim view folds every card on a phone — open them before measuring, as the phone tripwire does
await page.evaluate(() => { if (window.FCCDigest && FCCDigest.expandAll) FCCDigest.expandAll(); }); await page.waitForTimeout(120);
const ph = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, chips: document.querySelectorAll('#dimrow [data-dim]').length,
  rows: [...document.querySelectorAll('#dimrow [data-dim]')].map((b) => Math.round(b.getBoundingClientRect().top)).filter((v, i, a) => a.indexOf(v) === i).length }));
t('the phone: every chip present, wrapped onto rows, nothing scrolls sideways', ph.chips === 8 && ph.rows >= 2 && ph.sw <= ph.iw, ph);
await ctx.close();

t('no page errors', errors.length === 0, errors);
await browser.close(); srv.close();
console.log((fail ? '✗ ' : '✓ ') + 'volume movers by dimension: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
