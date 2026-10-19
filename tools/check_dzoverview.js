#!/usr/bin/env node
/*
 * tools/check_dzoverview.js — THE BRAND OVERVIEW, RENDERED (FCC-DZ-OVERVIEW).
 *
 * Ray, 19 Oct 2026: "redesign the brand dossier into a better-looking, more visual, interactive
 * overview for clients, so it can be exported as a single PDF showing the current progress".
 *
 * Drives the REAL Command Center page from file:// with every /api/ read stubbed (an
 * unauthenticated live request only ever returns the Access login page) and asserts what a
 * source read cannot:
 *   · the overview paints: dark call-out, four KPI tiles, the delivery grid, attention + live
 *     work, lanes + markets — and every grid column holds exactly the squares its month counts
 *   · the folds: a fresh device opens the overview and folds the working detail; ⊕/⊖ and a
 *     click flip them; the choice survives a reload (per device, never shared state)
 *   · the CLIENT copy the ⬇ PDF prints carries no internal vocabulary, no hours, no overdue list
 *   · ⬇ PDF is one click to a real PDF (or, with no CDN, the print fallback window)
 *   · 390px: nothing in the overview runs past its column; the grid pans in its own frame
 *   · dark mode: the hero's links stay white instead of taking the theme's link orange
 * Run: node tools/check_dzoverview.js   (PW_CHROMIUM overrides the browser path)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'docs', 'FeedSpark_Command_Center.html');
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };

const NOW = Date.now();
function stub(u) {
  if (u.includes('/api/briefs')) return {
    a: { id: 'YUMO-20261001-01', client: 'YuMOVE', status: 'running', task: 'Description test using Tachyon', by: 'Ray', updated: NOW },
    b: { id: 'YUMO-20261005-02', client: 'YuMOVE', status: 'progress', task: 'Keywords Optimisation - Black Friday', by: 'Steven', updated: NOW - 1000 },
    c: { id: 'YUMO-20261007-01', client: 'YuMOVE', status: 'briefed', task: 'Q&A attributes for ASPL', by: 'Ray', updated: NOW - 2000 } };
  if (u.includes('/api/labels/alerts')) return { clients: { YuMOVE: { crit: 1, warn: 2 } }, ptClients: {} };
  if (u.includes('/api/golden/estate')) return { feeds: { 'YuMOVE|gb': { client: 'YuMOVE', mkt: 'gb', score: 91, q: 93, air: 75, reqMissing: ['gtin'], status: 'ok' } } };
  if (u.includes('/api/feed/clients')) return { clients: { YuMOVE: { wired: ['gb', 'gb-fb'] } } };
  if (u.includes('/api/feed/audit')) return { score: { total: 50 } };
  if (u.includes('/api/kwcal')) return { YuMOVE: { events: [1, 2], ptidx: { gb: { sat: { n: 80 }, __total: 100 } } } };
  return {};
}
async function open(ctx, opts) {
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub(r.request().url())) }));
  if (opts && opts.noCdn) await pg.route('https://cdnjs.cloudflare.com/**', r => r.abort());
  await pg.goto(URL);
  await pg.waitForTimeout(700);
  await pg.evaluate(() => { const y = [...document.querySelectorAll('#dz-list button')].find(x => /YuMOVE/.test(x.textContent)); if (y) y.click(); });
  await pg.waitForFunction(() => !!document.querySelector('#dz-ov .ov-hero .ov-pri.p1, #dz-ov .ov-cnt'), null, { timeout: 8000 }).catch(() => {});
  await pg.waitForTimeout(900);
  await pg.evaluate(() => { const m = document.getElementById('mc-panel'); if (m) m.remove(); });
  return { pg, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  // ---- desktop, fresh device ----
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  let { pg, errs } = await open(ctx);
  console.log('── 1440px, fresh device');
  const m = await pg.evaluate(() => {
    const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
    const disp = el => el ? getComputedStyle(el).display : null;
    const P = window.PLANTASKS.YuMOVE;
    const cols = qa('#dz-ov .ov-gc').map(c => ({ d: c.querySelectorAll('i.d').length, o: c.querySelectorAll('i.o,i.c').length }));
    const max = Math.max.apply(null, P.vol.map(x => x.d + x.o)), rows = Math.min(14, max), unit = Math.max(1, Math.ceil(max / rows));
    const want = P.vol.map(x => ({ d: Math.ceil(x.d / unit), o: Math.ceil(x.o / unit) }));
    return {
      hero: !!q('#dz-ov .ov-hero h4') && q('#dz-ov .ov-hero h4').textContent.length > 10,
      heroBg: getComputedStyle(q('#dz-ov .ov-hero')).backgroundColor,
      kpis: qa('#dz-ov .ov-kpi').length, kpiNums: qa('#dz-ov .ov-kv b').map(b => b.textContent),
      sparks: qa('#dz-ov .ov-kpi .ov-spk:not(.none)').length,
      cols, want,
      attn: q('#dz-ov .ov-cnt') ? q('#dz-ov .ov-cnt').textContent : null,
      attnRows: qa('#dz-ov .ov-side .ov-card:first-child .ov-ar').map(r => r.textContent),
      live: qa('#dz-ov .ov-lr').length, prog: qa('#dz-ov .ov-lr .ov-prog').length,
      lanes: qa('#dz-ov .ov-lane').length,
      ovOpen: disp(q('.dz-sec[data-sec=ov] > .dz-secb')), detail: disp(q('.dz-sec[data-sec=detail] > .dz-secb')),
      detailExp: q('.dz-sec[data-sec=detail] .dz-sech').getAttribute('aria-expanded'),
      portInside: !!q('.dz-sec[data-sec=detail] #dz-port'), pdfBtn: !!q('.dz-head .dz-pdfb'),
      foldAll: q('.dz-foldall').textContent,
    };
  });
  ok('no page errors', errs.length === 0, errs);
  ok('the dark call-out paints with a headline', m.hero && m.heroBg === 'rgb(28, 31, 36)', m.heroBg);
  ok('four KPI tiles', m.kpis === 4, m.kpis);
  ok('the tiles read the plan, Golden Record and Feed Lab figures', m.kpiNums[2] === '91' && m.kpiNums[3] === '50', m.kpiNums);
  ok('the plan-backed tiles carry their own trend', m.sparks >= 2, m.sparks);
  ok('one grid column per plan month', m.cols.length === m.want.length && m.cols.length > 0, [m.cols.length, m.want.length]);
  ok('every column holds exactly the squares its month counts', JSON.stringify(m.cols) === JSON.stringify(m.want), { got: m.cols, want: m.want });
  ok('needs attention counts the alert, the required gap and the market', m.attn === '2', m.attn);
  ok('the critical alert leads the attention list', /critical guard alert/.test(m.attnRows[0] || ''), m.attnRows);
  ok('live work lists every ticket with its stage dots', m.live === 3 && m.prog === 3, [m.live, m.prog]);
  ok('a lane row per plan lane', m.lanes >= 5, m.lanes);
  ok('fresh device: the overview opens', m.ovOpen === 'block', m.ovOpen);
  ok('fresh device: the working detail is folded (and says so)', m.detail === 'none' && m.detailExp === 'false', [m.detail, m.detailExp]);
  ok('the working detail still holds the portfolio band', m.portInside);
  ok('the button names the action still available', m.foldAll === '⊕ Open all', m.foldAll);
  ok('⬇ PDF sits in the dossier header', m.pdfBtn);

  // grid hover card
  const tip = await pg.evaluate(() => {
    const sq = document.querySelector('#dz-ov .ov-gsq i.d[data-t]'); const r = sq.getBoundingClientRect();
    sq.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.x + 2, clientY: r.y + 2 }));
    const t = document.querySelector('#dz-ov .ov-tip'); return { shown: !t.hidden && getComputedStyle(t).display !== 'none', text: t.textContent };
  });
  ok('hovering a square names its month and state', tip.shown && /delivered/.test(tip.text), tip);

  // folds
  await pg.click('.dz-foldall');
  ok('⊕ Open all opens every section', await pg.evaluate(() => [...document.querySelectorAll('.dz-sec')].every(s => !s.classList.contains('folded'))));
  ok('…and the button flips to ⊖ Fold all', (await pg.textContent('.dz-foldall')) === '⊖ Fold all');
  await pg.click('.dz-sec[data-sec=ov] .dz-sech');
  ok('a heading click folds its section', await pg.evaluate(() => getComputedStyle(document.querySelector('.dz-sec[data-sec=ov] > .dz-secb')).display === 'none'));
  await pg.reload(); await pg.waitForTimeout(700);
  await pg.evaluate(() => { const y = [...document.querySelectorAll('#dz-list button')].find(x => /YuMOVE/.test(x.textContent)); if (y) y.click(); });
  await pg.waitForTimeout(500);
  const kept = await pg.evaluate(() => ({ ov: document.querySelector('.dz-sec[data-sec=ov]').classList.contains('folded'), det: document.querySelector('.dz-sec[data-sec=detail]').classList.contains('folded') }));
  ok('the choice survives a reload on this device', kept.ov === true && kept.det === false, kept);
  await pg.evaluate(() => localStorage.removeItem('fcc-dz-fold'));

  // client copy
  const doc = await pg.evaluate(() => {
    const d = document.createElement('div'); d.className = 'ov-print'; d.innerHTML = window.__fccOverview.doc('YuMOVE', null);
    document.body.appendChild(d); const t = d.innerText; const links = d.querySelectorAll('a').length; d.remove(); return { t, links };
  });
  const banned = ['Tachyon', 'ASPL', 'Feed Lab', 'Label Guard', 'Workflow', 'overdue', 'Retainer', 'ball with', 'P1', 'Needs attention', 'Steven'];
  ok('the client copy uses no internal vocabulary, hours or overdue list', banned.every(w => doc.t.indexOf(w) < 0), banned.filter(w => doc.t.indexOf(w) >= 0));
  ok('the client copy carries no links to the dashboard', doc.links === 0, doc.links);
  ok('the client copy is footed Private & Confidential', /FeedSpark · Private & Confidential/.test(doc.t));
  ok('the client copy renames our tool words', /AI generation/.test(doc.t) && /content team/.test(doc.t), doc.t.slice(0, 200));

  // ⬇ PDF — one click
  const dl = pg.waitForEvent('download', { timeout: 45000 }).catch(() => null);
  const pop = pg.waitForEvent('popup', { timeout: 45000 }).catch(() => null);
  await pg.click('.dz-pdfb');
  const got = await Promise.race([dl, pop]);
  if (got && got.suggestedFilename) {
    const f = path.join(require('os').tmpdir(), got.suggestedFilename()); await got.saveAs(f);
    const head = fs.readFileSync(f).slice(0, 5).toString();
    ok('⬇ PDF downloads a real PDF named for the brand and the day', head === '%PDF-' && /^YuMOVE_FeedSpark_Overview_\d{4}-\d{2}-\d{2}\.pdf$/.test(got.suggestedFilename()), [head, got.suggestedFilename()]);
  } else {
    ok('⬇ PDF opens the print fallback when the CDN is out of reach', !!got);
  }
  ok('the offscreen client copy is cleaned up', await pg.waitForFunction(() => !document.getElementById('ov-print'), null, { timeout: 10000 }).then(() => true, () => false));
  await ctx.close();

  // CDN unreachable → the print window, never a dead button
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  ({ pg } = await open(ctx, { noCdn: true }));
  const popup = pg.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
  await pg.click('.dz-pdfb');
  const pw = await popup;
  ok('no CDN: ⬇ PDF falls back to a print window carrying the client copy', !!pw && /Private &amp; Confidential|Private & Confidential/.test(await pw.content()));
  ok('…and the button comes back', await pg.waitForFunction(() => { const b = document.querySelector('.dz-pdfb'); return b && !b.disabled && b.textContent === '⬇ PDF'; }, null, { timeout: 10000 }).then(() => true, () => false));
  await ctx.close();

  // phone
  console.log('── 390px');
  ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  ({ pg, errs } = await open(ctx));
  await pg.click('.dz-foldall').catch(() => {});
  const ph = await pg.evaluate(() => {
    const ov = document.querySelector('#dz-ov .ov'), r = ov.getBoundingClientRect();
    const over = [...ov.querySelectorAll('*')].filter(e => !e.closest('.ov-gwrap') && e.getBoundingClientRect().right > r.right + 1).map(e => e.className).slice(0, 5);
    const gw = document.querySelector('#dz-ov .ov-gwrap');
    return { over, kp: getComputedStyle(document.querySelector('.ov-kpis')).gridTemplateColumns.split(' ').length, pans: getComputedStyle(gw).overflowX, head: document.querySelector('.dz-head').getBoundingClientRect().right <= innerWidth + 1 };
  });
  ok('nothing in the overview runs past its column', ph.over.length === 0, ph.over);
  ok('the KPI tiles pair up', ph.kp === 2, ph.kp);
  ok('the delivery grid pans inside its own frame', ph.pans === 'auto', ph.pans);
  ok('the dossier header wraps inside the screen', ph.head);
  await ctx.close();

  // dark
  console.log('── dark');
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fcc-theme', 'dark'); } catch (e) {} });
  ({ pg } = await open(ctx));
  const dk = await pg.evaluate(() => ({ th: document.documentElement.getAttribute('data-theme'), c: [...document.querySelectorAll('#dz-ov .ov-hero a.ov-hr, #dz-ov .ov-hero a.ov-btn:not(.pri)')].map(a => getComputedStyle(a).color) }));
  ok('dark mode is on', dk.th === 'dark', dk.th);
  ok('the hero links stay white in dark mode', dk.c.length > 0 && dk.c.every(c => c === 'rgb(255, 255, 255)'), dk.c);
  await ctx.close();

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
