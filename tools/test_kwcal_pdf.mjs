#!/usr/bin/env node
/* Keyword Calendar — the CLIENT PDF: it downloads, and it carries the results (Ray, 22 Sep 2026:
 * "downloaded clietn PDF is not print pls, download directly, also, add results in where test has
 * recorded (right now silk & satin / denim are done and results are captured so ensure the
 * download button always reflect the latest updated calendar)").
 *
 * Two behaviours that only exist in a browser, so they are checked in one:
 *
 * 1. ONE CLICK, NO DIALOG. window.print() cannot be suppressed by page JS, so the export
 *    rasterises the client document and saves it directly. The print route survives ONLY as the
 *    fallback for an unreachable CDN — if it ever becomes the happy path again, [1] fails.
 * 2. THE RESULTS ARE ON IT. The agenda row used to carry a verdict pip and no numbers, so a
 *    client read "▲" with no idea what moved. A read-out filed on a moment's OWN brief thread is
 *    that optimisation and nothing else; a fortnightly round reports everything that went live in
 *    its window. The two are never merged: the round's figures print ONCE, with a "Covers:" line
 *    naming exactly the moments whose LIVE-BY date falls inside its fortnight.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/test_kwcal_pdf.mjs   (presync) */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');
const root = path.resolve(__dirname, '..');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// Ray's live picture: Silk answered on its OWN brief thread (the Vimalesh read-out), and a
// scheduled round reporting a whole fortnight beside it.
const briefs = {
  'REIS-20260811-02': {
    id: 'REIS-20260811-02', client: 'Reiss', cat: 'keyword', status: 'confirmed', updated: 3,
    task: 'Keywords Optimisation - Silk - Marketing Planner - 0826', kw: 'silk',
    comms: [{ when: Date.parse('2026-09-11T10:00:00Z'), note: 'Result: +4.63% impressions · +5.18% clicks' }],
  },
};
const rounds = { results: [{ client: 'Reiss', mkt: 'gb', period: 'Aug I', id: 'r1',
  when: Date.parse('2026-08-20T09:00:00Z'), verdict: 'positive', metrics: ['Impressions +12.4%', 'Clicks +8.1%'] }] };
const INIT = 'window.__B=' + JSON.stringify(briefs) + ';window.__R=' + JSON.stringify(rounds) + ';'
  + "window.fetch=function(url){var u=String(url);var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};"
  + "window.__pulls=(window.__pulls||0)+(u.indexOf('/api/kwresults')>=0?1:0);"
  + "if(u.indexOf('/api/feed/clients')>=0)return j({clients:{Reiss:{markets:['gb']}}});"
  + "if(u.indexOf('/api/feed/markets')>=0)return j({markets:{gb:1}});"
  + "if(u.indexOf('/api/kwresults')>=0)return j(window.__R);"
  + "if(u.indexOf('/api/briefs')>=0)return j(window.__B);"
  + 'if(u.indexOf(\'/api/kwcal\')>=0)return j({});return j({});};';

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await ctx.addInitScript({ content: INIT });
await page.goto('file://' + path.join(D, 'FeedSpark_KWCal.html'));
await page.waitForTimeout(1500);

console.log('-- one click, no dialog --');
const run = await page.evaluate(async () => {
  window.__printed = 0; window.print = function () { window.__printed++; };
  window.__saved = null; window.__capW = null; window.__fmt = null;
  window.__pullsAt = window.__pulls || 0;
  window.html2canvas = function (el) {
    window.__capW = Math.round(el.getBoundingClientRect().width);
    window.__off = /left:\s*-10000px/.test(el.getAttribute('style') || '');
    return Promise.resolve({ width: 1400, height: 960, toDataURL: () => 'data:image/jpeg;base64,AAA' });
  };
  window.jspdf = { jsPDF: function (o) { window.__fmt = o; this.addImage = function () {}; this.save = function (n) { window.__saved = n; }; } };
  document.getElementById('pdf').click();
  await new Promise((r) => setTimeout(r, 1500));
  return { printed: window.__printed, saved: window.__saved, capW: window.__capW, off: window.__off, fmt: window.__fmt,
    repull: (window.__pulls || 0) - window.__pullsAt,
    btn: document.getElementById('pdf').textContent, dis: document.getElementById('pdf').disabled,
    style: document.getElementById('pdf-doc').getAttribute('style') || '' };
});
ok('[1] one click saves a file and never opens the print dialog', !!run.saved && run.printed === 0, run);
ok('the filename names the brand, the market and the day', /Reiss/.test(run.saved) && /GB/.test(run.saved) && /\.pdf$/.test(run.saved), run.saved);
ok('the page is A4 landscape width, cut to the capture — one page by construction, not by a paginator',
  run.fmt && run.fmt.format && run.fmt.format[0] === 297 && Math.abs(run.fmt.format[1] - 297 * 960 / 1400) < 0.2, run.fmt);
ok('the capture runs at the fitted layout’s own width, off-screen', run.capW > 500 && run.off === true, run);
ok('the export re-pulls the results archive first, so the file is never a stale read', run.repull >= 1, run.repull);
ok('the button is handed back to the reader', !run.dis && /Client PDF/.test(run.btn), run);
ok('the off-screen document is put back exactly as it was', !/-10000px/.test(run.style), run.style);

console.log('-- the results are on it --');
const res = await page.evaluate(() => {
  const d = document.getElementById('pdf-doc'), sec = d.querySelector('.pd-res');
  const txt = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  return { has: !!sec, head: sec ? txt(sec.querySelector('h4')) : '',
    rows: Array.from(d.querySelectorAll('.pd-rr')).map(txt),
    covers: Array.from(d.querySelectorAll('.pd-rc')).map(txt),
    pips: d.querySelectorAll('.pd-ag .rp').length,
    agendaNums: Array.from(d.querySelectorAll('.pd-ag')).filter((r) => /12\.4|4\.63/.test(txt(r))).length };
});
ok('[2] the client PDF carries a Results reported section', res.has && /Results reported/i.test(res.head), res.head);
ok('the own-ticket read-out prints its figures against its own moment',
  res.rows.some((r) => /Silk/.test(r) && /4\.63/.test(r) && /5\.18/.test(r)), res.rows);
ok('the shared round prints its figures exactly ONCE', res.rows.filter((r) => /12\.4/.test(r)).length === 1, res.rows);
ok('…named by its fortnight, never by one of the moments it covers',
  res.rows.some((r) => /Aug 2026/.test(r) && /12\.4/.test(r)) && !res.rows.some((r) => /12\.4/.test(r) && /Silk/.test(r)), res.rows);
ok('the agenda stays scannable — the numbers live in the section, not on every row', res.agendaNums === 0, res.agendaNums);
ok('the agenda rows keep their verdict pips', res.pips >= 2, res.pips);

// the real invariant behind "Covers:" — a round reports every optimisation that went LIVE inside
// its fortnight, which is the moment's date minus the 21-day lead, not the moment's own date
const covers = await page.evaluate(() => {
  const line = document.querySelector('#pdf-doc .pd-rc');
  return { named: line ? line.textContent.replace(/^\s*Covers:\s*/, '').split(',').map((s) => s.trim()).filter(Boolean) : [] };
});
ok('exactly one Covers line, for the one shared round', (await page.evaluate(() => document.querySelectorAll('#pdf-doc .pd-rc').length)), 1);
ok('it names every moment whose live-by date falls in that fortnight, and only those',
  await page.evaluate(() => {
    const named = document.querySelector('#pdf-doc .pd-rc').textContent.replace(/^\s*Covers:\s*/, '').split(',').map((s) => s.trim());
    // recomputed independently of the page: a moment dated D goes live D-21, and Aug I is 1–15 Aug
    const live = (d) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 21); return t.getTime(); };
    const seed = { 'R-Flex': '2026-08-30', 'Atelier 1': '2026-09-02', Tailoring: '2026-09-04', Silk: '2026-08-30',
      Denim: '2026-08-21', Jewellery: '2026-08-03', 'Cashmere/Merino': '2026-09-28' };
    const a = Date.UTC(2026, 7, 1), b = Date.UTC(2026, 7, 15, 23, 59, 59);
    const inWin = Object.keys(seed).filter((k) => live(seed[k]) >= a && live(seed[k]) <= b && k !== 'Silk');
    return inWin.every((k) => named.includes(k)) && named.every((n) => inWin.includes(n)) && named.length > 0;
  }), covers.named);
ok('the moment with its own read-out is never folded into the batch — different evidence, different claim',
  !covers.named.includes('Silk'), covers.named);
// a Covers line separated from its own round by a column break reads as the NEXT round's
// coverage, and a client cannot tell it is wrong — so the grid item is the whole result
ok('every Covers line sits inside the same block as the round it belongs to',
  await page.evaluate(() => Array.from(document.querySelectorAll('#pdf-doc .pd-rc'))
    .every((c) => c.parentElement.classList.contains('pd-rg') && c.parentElement.querySelector('.pd-rr'))), true);
ok('…and a result with no Covers line is still its own block',
  await page.evaluate(() => document.querySelectorAll('#pdf-doc .pd-rg').length === document.querySelectorAll('#pdf-doc .pd-rr').length), true);
// the document's own month names, so an ICU upgrade cannot change what a client PDF says
ok('dates read in the document’s own month names, not the browser’s',
  res.rows.every((r) => !/Sept/.test(r)) && res.rows.some((r) => /11 Sep/.test(r)), res.rows);

console.log('-- an unreachable CDN still gets the client a file --');
const fb = await page.evaluate(async () => {
  window.__printed = 0; window.__saved = null;
  delete window.html2canvas; delete window.jspdf;
  const real = document.createElement.bind(document);
  document.createElement = function (t) { const el = real(t);
    if (String(t).toLowerCase() === 'script') setTimeout(() => el.onerror && el.onerror(new Event('error')), 5);
    return el; };
  document.getElementById('pdf').click();
  await new Promise((r) => setTimeout(r, 1400));
  document.createElement = real;
  return { printed: window.__printed, saved: window.__saved, dis: document.getElementById('pdf').disabled,
    style: document.getElementById('pdf-doc').getAttribute('style') || '' };
});
ok('the dialog is the fallback, not a silent failure', fb.printed === 1 && !fb.saved, fb);
ok('…and the button and the document both come back', !fb.dis && !/-10000px/.test(fb.style), fb);
// a transient CDN miss must not be remembered as permanently broken
const retry = await page.evaluate(async () => {
  window.__printed = 0; window.__saved = null;
  window.html2canvas = () => Promise.resolve({ width: 1400, height: 960, toDataURL: () => 'data:image/jpeg;base64,AAA' });
  window.jspdf = { jsPDF: function () { this.addImage = function () {}; this.save = function (n) { window.__saved = n; }; } };
  document.getElementById('pdf').click();
  await new Promise((r) => setTimeout(r, 1400));
  return { printed: window.__printed, saved: window.__saved };
});
ok('the next click tries the download again rather than staying on the dialog forever', !!retry.saved && retry.printed === 0, retry);

console.log('-- the design scale holds --');
/* Ray, 22 Sep 2026: "redesign it so the headlines and the footer have a bit more margin and look
 * more premium … Use an Apple design scale or design theory". Three things below are the system,
 * and one is the bug the redesign uncovered. */
const src = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_KWCal.html'), 'utf8');
const css = src.slice(src.indexOf("THE CLIENT DOCUMENT'S DESIGN SCALE"), src.indexOf('.pd-intro{font-size'));
const tok = (n) => { const m = new RegExp('--' + n + ':\\s*([^;]+);').exec(css); return m && m[1].trim(); };

// 1. THE 4pt GRID. Every space is a multiple of the unit — that is what makes things line up.
ok('the document declares a spacing unit', tok('u') === '4px', tok('u'));
const spaces = [...css.matchAll(/calc\(var\(--u\)\s*\*\s*([0-9.]+)\)/g)].map((m) => parseFloat(m[1]));
ok('every space is expressed in units of that grid, not hand-picked pixels', spaces.length > 20, spaces.length);
const offGrid = spaces.filter((n) => (n * 4) % 2 !== 0);
ok('…and every one lands on the 4pt grid or its half-step', offGrid.length === 0, offGrid);
// a raw px margin/padding/gap is how the old sheet's 1/1.5/3/5/7/9/13px soup got in
// NB the value must stop at `}` as well as `;` — the last declaration in a rule has no
// semicolon, so [^;]+ ran straight into the next rule and reported its width as a raw margin
const raw = [...css.matchAll(/(?:margin|padding|gap)[a-z-]*:\s*([^;}]+)[;}]/g)]
  .flatMap((m) => m[1].match(/(?<![-\w.])\d*\.?\d+px/g) || []).filter((v) => v !== '1px');
ok('no hand-picked pixel spacing survives (1px hairlines aside)', raw.length === 0, raw);

// 2. THE TYPE SCALE. Six steps, each a real jump — the old sheet had eleven sizes, several a half
// pixel apart, which at print size is no hierarchy at all.
const scale = ['t-display', 't-title', 't-head', 't-body', 't-cap', 't-micro'].map((n) => parseFloat(tok(n)));
ok('six type steps, all declared', scale.filter((n) => n > 0).length === 6, scale);
ok('strictly descending', scale.every((n, i) => !i || n < scale[i - 1]), scale);
const ratios = scale.slice(1).map((n, i) => +(scale[i] / n).toFixed(3));
const flat = ratios.filter((r) => r < 1.1);
ok('every step is a jump the eye can read at print size (≥1.1×)', flat.length === 0, { ratios, flat });
ok('tracking is set tight on large type and loose on small labels',
  parseFloat(tok('tr-tight')) < 0 && parseFloat(tok('tr-label')) > 0, [tok('tr-tight'), tok('tr-label')]);

// 3. TWO WEIGHTS, and not by taste: the page loads Lato 400/700/900, so a 500 or 600 anywhere in
// this sheet is SYNTHESISED, and html2canvas rasterises a synthetic weight unpredictably — the
// downloaded file would not match the screen.
const weights = [...new Set([...css.matchAll(/font-weight:(\d+)/g)].map((m) => m[1]))].sort();
ok('the client document uses exactly two weights', weights.join() === '400,700', weights);
const imp = /family=Lato:wght@([0-9;]+)/.exec(src);
ok('…and the font actually loads both', imp && weights.every((w) => imp[1].split(';').includes(w)), true);

// 4. THE MARGIN RAY ASKED FOR — and it was a bug, not a preference: ⬇ Client PDF rasterises
// #pdf-doc itself, so @page margin never reached the downloaded file. It printed edge to edge.
ok('the page margin is expressed on the grid', /calc\(var\(--u\)/.test(tok('pad')), tok('pad'));
ok('…and it is box-sizing:border-box, so the fit still measures the printable column',
  /#pdf-doc\{[^}]*box-sizing:border-box/.test(css), true);

// 5. THE TRAP THE REDESIGN FOUND. fitPdf measured, and exportPdf captured, with their OWN
// `line-height:1.35` restated inline — so when the stylesheet's leading changed they measured a
// document that no longer existed, the chosen scale was too large, and the print fallback
// silently paginated. Typography belongs in the stylesheet and nowhere else.
const overrides = [...src.matchAll(/doc\.style\.cssText\s*=\s*'([^']*(?:'\s*\+[^']*'[^']*)*)/g)].map((m) => m[0]);
ok('fitPdf and exportPdf both override the document', overrides.length >= 2, overrides.length);
const typo = overrides.filter((o) => /line-height|font-family/.test(o));
ok('neither restates the document’s typography', typo.length === 0, typo);

// 6. …and the constraint it exists to enforce actually holds on the real document. This is the
// assertion that fails on the pre-fix page.
const fit = await (async () => {
  const p2 = await ctx.newPage();
  await p2.goto('file://' + path.join(D, 'FeedSpark_KWCal.html'));
  await p2.waitForTimeout(1200);
  const r = await p2.evaluate(async () => {
    window.print = function () {};
    let capW = null;
    window.html2canvas = function (el) { capW = Math.round(el.getBoundingClientRect().width);
      return Promise.resolve({ width: 1400, height: 960, toDataURL: () => 'data:image/jpeg;base64,AAA' }); };
    window.jspdf = { jsPDF: function () { this.addImage = function () {}; this.save = function () {}; } };
    document.getElementById('pdf').click();
    await new Promise((r) => setTimeout(r, 1500));
    const d = document.getElementById('pdf-doc'), k = 1047 / capW, keep = d.getAttribute('style') || '';
    d.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;visibility:hidden;width:' + capW + 'px';
    const H = d.scrollHeight, W = d.scrollWidth;
    d.setAttribute('style', keep);
    return { k, H, W, capW, hxk: H * k, pad: parseFloat(getComputedStyle(d).paddingLeft) };
  });
  await p2.close();
  return r;
})();
ok('the document carries a real page margin — the one the download never had',
  fit.pad >= 24, fit.pad);
ok('the scale fitPdf chose really does fit the page box it measures against',
  fit.hxk <= 718, { ...fit, box: 718 });
ok('…and does not overflow its own width', fit.W <= fit.capW + 1, fit);

ok('no page errors throughout', errs.length === 0, errs);
await browser.close();
console.log('\n' + (fail ? fail + ' FAILED' : 'PASS'));
process.exit(fail ? 1 : 0);
