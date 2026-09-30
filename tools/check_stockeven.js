#!/usr/bin/env node
/*
 * tools/check_stockeven.js — /stock, EVEN ENOUGH TO SHOW A CLIENT LIVE.
 *
 * Ray, 30 Sep 2026: "Please ensure the presentation of the data is not too cluttered and is evenly spaced, so it
 * is not troublesome to use with clients live." Evenness is a property of the PAINT — a source read cannot see a
 * KPI band wrapping 7 + 2, a row made taller by one button, a market named four times down a table or a size chip
 * one character wide beside one three characters wide — so this drives the real page through Chromium on the
 * synthetic rule list (tools/rules_stub.js, no real figure) and measures it:
 *
 *   · the KPI band is SIX tiles on a count that divides them: one row at 1440px, 3 × 2 at 1100px and beside the
 *     open forecast panel, 3 × 2 on a phone — equal widths, and every value, label and line below it at one height
 *   · every row of summary tiles (in stock, ad spend, hero sizes) fills its card as equal tiles
 *   · the ad-spend rows are one height whether or not the ⬇ List button sits in them
 *   · a table grouped by market (ad spend, cut-offs, hero-size runs) names each market once
 *   · the coverage matrix gives every stock control one column width
 *   · the size chips are one width, so a run lines up row under row; the Source column names the kind, not the example
 *   · a finding is one line until opened (badge · title · where), titles at one x; the reason opens with the rules
 *   · the findings and cut-offs cards stand one height side by side
 *   · a market's setup is a one-line summary; its plain-words sentence opens with its rules
 *   · on a phone the search field has a row of its own (it shrank to its first two letters)
 *
 * NEGATIVE CONTROL: the shared auto-fit grid (/design/fcc.css .kpis) forced back onto the band puts the six tiles
 * 5 + 1 at 1100px, and the even-row measure must say so — the check cannot pass on a band nobody is laying out.
 *
 * Run: node tools/check_stockeven.js      (PW_CHROMIUM overrides the browser path)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'docs');
const RULES_STUB = require('./rules_stub.js').stubLines();
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
// STOCK_PAGE=<file> measures another copy (e.g. the page on main, to see these checks fail on the ragged layout)
const HTML = fs.readFileSync(process.env.STOCK_PAGE || path.join(D, 'FeedSpark_Stock.html'), 'utf8').split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
const TMP = path.join(require('os').tmpdir(), 'fcc_stockeven_' + process.pid + '.html');
fs.writeFileSync(TMP, HTML);

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
const STUB = `try{localStorage.clear();}catch(e){}
window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
${RULES_STUB}
 return j({ok:false,error:'stub'},404);};`;

async function open(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h || 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/^https?:\/\//, (r) => r.abort());   // no font, no CDN: geometry only
  await p.addInitScript(STUB);
  await p.goto('file://' + TMP);
  await p.waitForSelector('#hm-t tbody tr', { timeout: 10000 });
  await p.waitForTimeout(250);
  return { ctx, p, errs };
}
// rows of boxes, grouped by their top edge
const rowsOf = (bs) => { const m = {}; bs.forEach((b) => { const k = Math.round(b.y); (m[k] = m[k] || []).push(b); }); return Object.keys(m).sort((a, c) => a - c).map((k) => m[k]); };
const kpis = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#kpis .kpi')).map((el) => {
  const r = el.getBoundingClientRect(), l = el.querySelector('.l').getBoundingClientRect(), d = el.querySelector('.d');
  return { x: r.left, y: r.top, w: r.width, h: r.height, ly: l.top, dy: d ? d.getBoundingClientRect().top : null };
}));
const even = (rs) => rs.length > 0 && rs.every((r) => r.length === rs[0].length);
const same = (xs, tol) => xs.every((x) => Math.abs(x - xs[0]) <= (tol == null ? 1 : tol));

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  console.log('· the KPI band — six tiles, even rows');
  {
    const { ctx, p, errs } = await open(browser, 1440);
    const k = await kpis(p);
    const rs = rowsOf(k);
    ok('six tiles', k.length === 6, k.length);
    ok('one row of six at 1440px', rs.length === 1 && rs[0].length === 6, rs.map((r) => r.length));
    ok('every tile one width', same(k.map((b) => b.w)), k.map((b) => Math.round(b.w)));
    ok('every label, and every line under it, starts at one height', same(k.map((b) => b.ly)) && same(k.filter((b) => b.dy != null).map((b) => b.dy)), k.map((b) => [Math.round(b.ly), Math.round(b.dy)]));
    const go = await p.evaluate(() => Array.from(document.querySelectorAll('#kpis [data-go]')).map((el) => el.getAttribute('data-go')));
    ok('a tile names the card it summarises (a click jumps to it)', ['av-card', 'cov-card', 'hmap-card', 'cut-card', 'find-card'].every((g) => go.indexOf(g) >= 0), go);

    console.log('· rows of summary tiles fill their card');
    for (const id of ['av-sum', 'sv-sum', 'hm-sum']) {
      const t = await p.evaluate((id) => {
        const box = document.getElementById(id), r = box.getBoundingClientRect();
        return { r: r.right, l: r.left, its: Array.from(box.children).map((c) => { const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, right: b.right }; }) };
      }, id);
      const rows = rowsOf(t.its);
      ok('#' + id + ': ' + t.its.length + ' tiles, one row, one width each, the last one flush with the card', t.its.length >= 2 && rows.length === 1 && same(t.its.map((b) => b.w)) && Math.abs(t.its[t.its.length - 1].right - t.r) <= 1 && Math.abs(t.its[0].x - t.l) <= 1, t);
    }

    console.log('· the ad-spend rows — one height, the market named once');
    const sv = await p.evaluate(() => Array.from(document.querySelectorAll('#sv-t tbody tr')).map((tr) => ({ h: tr.getBoundingClientRect().height, list: !!tr.querySelector('[data-hbdl]'), mk: tr.cells[0].textContent.trim(), id: (tr.getAttribute('data-sv') || '').split('|')[0] })));
    ok('the stub sizes rules with and without the ⬇ List button', sv.some((r) => r.list) && sv.some((r) => !r.list), sv);
    ok('a row with the ⬇ List button is no taller than one without', same(sv.map((r) => r.h), 1), sv.map((r) => [Math.round(r.h), r.list]));
    for (const id of ['sv-t', 'cuts', 'heroes']) {
      const g = await p.evaluate((id) => Array.from(document.querySelectorAll('#' + id + ' tbody tr[data-sv]')).map((tr) => ({ mk: tr.cells[0].textContent.trim(), id: tr.getAttribute('data-sv').split('|')[0], gi: tr.classList.contains('gi') })), id);
      const runs = g.filter((r, i) => !i || g[i - 1].id !== r.id);
      ok('#' + id + ': each market named once, on the first row of its run (' + runs.length + ' markets, ' + g.length + ' rows)', g.length > 0 && g.filter((r) => r.mk).length === runs.length && g.every((r, i) => !!r.mk === (!i || g[i - 1].id !== r.id)), g);
      ok('#' + id + ': the rows that continue a run are divided by a quieter line', g.every((r, i) => r.gi === (i < g.length - 1 && g[i + 1].id === r.id)), g);
    }
    ok('the stub has a market with more than one sized rule (so "named once" meets a run)', sv.some((r, i) => i && sv[i - 1].id === r.id));

    console.log('· the coverage matrix — one width per stock control');
    const cw = await p.evaluate(() => { const th = Array.from(document.querySelectorAll('#cov thead th')); return th.slice(1, -1).map((x) => x.getBoundingClientRect().width); });
    ok('every stock-control column is one width', cw.length >= 6 && same(cw), cw.map((w) => Math.round(w)));

    console.log('· hero sizes by product type — one chip width, a short source word');
    const chips = await p.evaluate(() => Array.from(document.querySelectorAll('#hm-t .sz')).map((el) => ({ t: el.textContent.trim(), w: el.getBoundingClientRect().width })));
    const short = chips.filter((c) => c.t.length <= 2);
    ok('every short size (1–2 characters, hero or not) is one chip width', short.length >= 10 && same(short.map((c) => c.w), 0.5), short.map((c) => c.t + ':' + Math.round(c.w)));
    const srcs = await p.evaluate(() => Array.from(document.querySelectorAll('#hm-t tbody td.hsrc .tg')).map((el) => el.textContent.trim()));
    ok('the Source column names the kind of source (the example is named in its tooltip)', srcs.length >= 5 && srcs.every((t) => t.length <= 16) && srcs.indexOf('⧉ Example') >= 0, srcs);
    const heads = await p.evaluate(() => Array.from(document.querySelectorAll('#hm-t thead th')).map((th) => ({ t: th.textContent.trim(), tip: th.getAttribute('title') || '' })));
    ok('the heads are short, the full question in each tooltip', heads.every((h) => h.t.length <= 16) && heads.slice(1).every((h) => h.tip.length > 20), heads);
    const guideNote = await p.evaluate(() => { const g = document.getElementById('hm-guide'); return { lines: g.querySelectorAll('.ex-note').length, tip: (g.querySelector('#hm-ex') || {}).title || '' }; });
    ok('the example\'s note is the follow select\'s tooltip, not a line of prose', guideNote.lines === 0 && /starting point/i.test(guideNote.tip), guideNote);

    console.log('· needs a look — one line each until opened');
    const fd = await p.evaluate(() => Array.from(document.querySelectorAll('#finds .fd')).map((d) => {
      const tt = d.querySelector('summary .tt').getBoundingClientRect(), why = d.querySelector('.why');
      // a closed <details> keeps its content laid out but unpainted (content-visibility), so a box height proves nothing
      return { x: tt.left, open: d.open, why: !!why && why.checkVisibility(), inSummary: !!d.querySelector('summary .why') };
    }));
    ok('the stub has findings', fd.length >= 5, fd.length);
    ok('closed, a finding paints no reason (badge · title · where only)', fd.every((f) => !f.open && !f.why && !f.inSummary), fd);
    ok('every title starts at one x, whatever the badge says', same(fd.map((f) => f.x)), fd.map((f) => Math.round(f.x)));
    await p.click('#finds .fd summary');
    const opened = await p.evaluate(() => { const d = document.querySelector('#finds .fd'); const w = d.querySelector('.why'); return { open: d.open, why: !!w && w.checkVisibility() && w.getBoundingClientRect().height > 0, rules: d.querySelectorAll('.rl li').length }; });
    ok('opening one shows its reason with its rules', opened.open && opened.why && opened.rules > 0, opened);
    const hh = await p.evaluate(() => ['find-card', 'cut-card'].map((id) => document.getElementById(id).getBoundingClientRect().height));
    ok('the findings and cut-offs cards stand one height', same(hh, 1), hh);

    console.log('· each market\'s setup — a one-line summary');
    const su = await p.evaluate(() => Array.from(document.querySelectorAll('#setups > details')).map((d) => ({ h: d.querySelector('summary').getBoundingClientRect().height, why: !!d.querySelector('summary .why'), body: !!d.querySelector(':scope > .set-top .why'), fh: !!d.querySelector(':scope > .set-top a.fh') })));
    ok('each summary is one line, its sentence and FeedHero link open with the rules', su.length >= 2 && su.every((s) => s.h <= 34 && !s.why && s.body && s.fh), su);
    const cols = await p.evaluate(() => Array.from(document.querySelectorAll('#setups table.t thead tr:first-child th')).slice(0, 8).map((th) => th.textContent.trim()));
    ok('the setup table carries no column that repeats "every" / "all" down every row (batch rides under the channel)', cols.indexOf('Batch') < 0 && cols.indexOf('Channel') >= 0, cols);
    ok('no page errors', errs.length === 0, errs);

    console.log('· beside the open forecast panel the band goes 3 × 2');
    await p.click('#sv-t tbody tr td:nth-child(3)');   // a click on a rule row (not its link or button) docks the panel
    await p.waitForTimeout(350);
    const on = await p.evaluate(() => document.body.classList.contains('sv-on'));
    if (on) {
      const kr = rowsOf(await kpis(p));
      ok('with the panel docked, the six tiles sit 3 × 2', kr.length === 2 && even(kr) && kr[0].length === 3, kr.map((r) => r.length));
    } else ok('the forecast panel opened on a rule row (needed for the next measure)', false, 'panel did not open');
    await ctx.close();
  }

  console.log('· 1100px — 3 × 2, and the negative control');
  {
    const { ctx, p } = await open(browser, 1100);
    let rs = rowsOf(await kpis(p));
    ok('3 × 2 at 1100px', rs.length === 2 && even(rs) && rs[0].length === 3, rs.map((r) => r.length));
    // NEGATIVE CONTROL — the shared auto-fit grid put back: the band goes ragged, and the measure must catch it
    await p.addStyleTag({ content: '#kpis{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))!important}' });
    await p.waitForTimeout(100);
    rs = rowsOf(await kpis(p));
    ok('negative control: the shared auto-fit grid wraps the same six tiles unevenly, and the even-row measure says so', !even(rs), rs.map((r) => r.length));
    await ctx.close();
  }

  console.log('· a phone — the band 3 × 2, the search field on a row of its own');
  {
    const { ctx, p, errs } = await open(browser, 390, 844);
    const rs = rowsOf(await kpis(p));
    ok('3 × 2 at 390px', rs.length === 2 && even(rs) && rs[0].length === 3, rs.map((r) => r.length));
    const q = await p.evaluate(() => { const r = document.getElementById('q').getBoundingClientRect(), c = document.querySelector('.hero .ctl').getBoundingClientRect(); return { w: r.width, cw: c.width }; });
    ok('the search field spans the control row (it had shrunk to its first two letters)', q.w >= q.cw - 2, q);
    const t = await p.evaluate(() => Array.from(document.getElementById('sv-sum').children).map((c) => { const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; }));
    const tr = rowsOf(t);
    ok('an odd tile out on a phone spans the row rather than leaving a gap', tr.length === 2 && tr[1].length === 1 && tr[1][0].w > tr[0][0].w * 1.8, tr.map((r) => r.map((b) => Math.round(b.w))));
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok('no sideways overflow', over <= 0, over);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  await browser.close();
  try { fs.unlinkSync(TMP); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.unlinkSync(TMP); } catch (x) {} process.exit(1); });
