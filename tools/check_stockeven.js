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
 *   · NO KPI band (Ray, 6 Oct 2026, a red cross over it: "clean up stock section alittle bit"): the page opens on its
 *     first card, and every figure the band carried still stands on a card below — the ad-spend book is a tile of the
 *     in-stock card, the rules and hero sizes are the coverage matrix and the hero-size runs, the cut-offs and the
 *     findings their own cards
 *   · every row of summary tiles (in stock + ad spend, hero sizes) fills its card as equal tiles — at 1440px, at 1100px
 *     and beside the open forecast panel
 *   · ONE in-stock card (Ray, 1 Oct 2026: "merge the Adspend kept off section into this interface"): seven columns that
 *     fit the card at 1440px with no cell or header clipped, the three feeds one width, a market row one height whether
 *     or not its ⬇ List button sits in it, and every state of the held-back / range-completion cells drawn
 *   · a table grouped by market (the rule-by-rule ad spend, cut-offs, hero-size runs) names each market once
 *   · the coverage matrix gives every stock control one column width
 *   · the size chips are one width, so a run lines up row under row; the Source column names the kind, not the example
 *   · a finding is one line until opened (badge · title · where), titles at one x; the reason opens with the rules
 *   · the findings and cut-offs cards stand one height side by side
 *   · a market's setup is a one-line summary; its plain-words sentence opens with its rules
 *   · on a phone the search field has a row of its own (it shrank to its first two letters)
 *
 * NEGATIVE CONTROL: a fixed-width fill (auto-fill, 260px) forced onto the in-stock tiles at 1100px leaves them 3 + 1, and
 * the even-row measure must say so — the check cannot pass on tiles nobody is laying out.
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
const tiles = (p, id) => p.evaluate((id) => Array.from(document.getElementById(id).children).map((c) => { const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, right: b.right }; }), id);
const even = (rs) => rs.length > 0 && rs.every((r) => r.length === rs[0].length);
const same = (xs, tol) => xs.every((x) => Math.abs(x - xs[0]) <= (tol == null ? 1 : tol));

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  console.log('· no KPI band — the page opens on its first card');
  {
    const { ctx, p, errs } = await open(browser, 1440);
    const top = await p.evaluate(() => { const f = Array.from(document.querySelectorAll('main.wrap > *')).filter((e) => !e.hidden && e.getBoundingClientRect().height > 0)[0]; return { band: !!document.getElementById('kpis') || !!document.querySelector('main .kpis'), first: f ? f.id : '', card: f ? f.classList.contains('card') : false }; });
    ok('no KPI band on the page; the first thing under the header is a card', !top.band && top.card && top.first === 'lev-card', top);
    const kept = await p.evaluate(() => ({ book: !!document.querySelector('#av-sum [data-sv="book"]'), google: /Google/.test((document.getElementById('av-sum') || {}).textContent || ''), cov: document.querySelectorAll('#cov tbody tr').length, heroes: document.querySelectorAll('#heroes tbody tr[data-sv]').length, cuts: document.querySelectorAll('#cuts tbody tr[data-sv]').length, finds: document.querySelectorAll('#finds .fd').length }));
    ok('every figure the band carried still stands on a card: the ad-spend book and Google’s in-stock tile, the coverage matrix, the hero-size runs, the cut-offs, the findings', kept.book && kept.google && kept.cov > 0 && kept.heroes > 0 && kept.cuts > 0 && kept.finds > 0, kept);

    console.log('· rows of summary tiles fill their card');
    for (const id of ['av-sum', 'hm-sum']) {
      const t = await p.evaluate((id) => {
        const box = document.getElementById(id), r = box.getBoundingClientRect();
        return { r: r.right, l: r.left, its: Array.from(box.children).map((c) => { const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, right: b.right }; }) };
      }, id);
      const rows = rowsOf(t.its);
      ok('#' + id + ': ' + t.its.length + ' tiles, one row, one width each, the last one flush with the card', t.its.length >= 2 && rows.length === 1 && same(t.its.map((b) => b.w)) && Math.abs(t.its[t.its.length - 1].right - t.r) <= 1 && Math.abs(t.its[0].x - t.l) <= 1, t);
    }

    console.log('· the in-stock card — seven columns, nothing clipped, one row height (the ad spend merged in)');
    const av = await p.evaluate(() => {
      const t = document.getElementById('av-t'), fr = t.parentElement;
      const ths = Array.from(t.querySelectorAll('thead tr:last-child th'));
      const rows = Array.from(t.querySelectorAll('tbody tr')).map((tr) => ({ h: tr.getBoundingClientRect().height, list: !!tr.querySelector('[data-hbdl]'), cells: tr.cells.length,
        rc: tr.cells[5] ? tr.cells[5].textContent.replace(/\s+/g, ' ').trim() : '', hb: tr.cells[4] ? tr.cells[4].textContent.replace(/\s+/g, ' ').trim() : '', sv: !!(tr.cells[6] && tr.cells[6].hasAttribute('data-sv')) }));
      const clip = Array.from(t.querySelectorAll('th,td')).filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim().slice(0, 30));
      return { cols: ths.length, feeds: ths.slice(1, 4).map((x) => x.getBoundingClientRect().width), frame: fr.clientWidth, sw: fr.scrollWidth, rows, clip,
        card: !!document.getElementById('sv-card'), inCard: !!document.querySelector('#av-card #sv-rules #sv-t') && !!document.querySelector('#av-card .chead #sv-scn') };
    });
    ok('one card: the ad-spend card is gone; its scenario controls sit in the in-stock card\'s header, its rule-by-rule table in the card\'s fold', !av.card && av.inCard, av);
    ok('seven columns, the three feeds one width', av.cols === 7 && same(av.feeds), [av.cols, av.feeds.map(Math.round)]);
    ok('the table fits its card at 1440px — nothing to scroll sideways', av.sw <= av.frame + 1, [av.sw, av.frame]);
    ok('no header or cell has its text clipped', av.clip.length === 0, av.clip);
    ok('the stub draws a market with the ⬇ List and one without', av.rows.some((r) => r.list) && av.rows.some((r) => !r.list), av.rows);
    ok('every market row one height, whatever its cells hold', same(av.rows.map((r) => r.h), 1), av.rows.map((r) => [Math.round(r.h), r.list]));
    ok('range completion: the line read off the products (≈), a rule name\'s cut-off, and "not counted yet" — each state drawn', av.rows.some((r) => /^≈\s*\d+%/.test(r.rc) && /in the data/.test(r.rc)) && av.rows.some((r) => /^RC < \d+%/.test(r.rc) && /in a rule name/.test(r.rc)) && av.rows.some((r) => /not counted yet/.test(r.hb)), av.rows.map((r) => [r.hb, r.rc]));
    ok('a market\'s ad-spend cell opens its largest rule\'s working (data-sv)', av.rows.filter((r) => r.sv).length >= 2, av.rows.map((r) => r.sv));
    await p.evaluate(() => { document.getElementById('sv-rules').open = true; });
    await p.waitForTimeout(100);
    const sv = await p.evaluate(() => Array.from(document.querySelectorAll('#sv-t tbody tr')).map((tr) => ({ h: tr.getBoundingClientRect().height, mk: tr.cells[0].textContent.trim(), id: (tr.getAttribute('data-sv') || '').split('|')[0] })));
    ok('the rule-by-rule fold opens onto its rules, one height each', sv.length >= 2 && sv.every((r) => r.h > 0) && same(sv.map((r) => r.h), 1), sv.map((r) => Math.round(r.h)));
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

    console.log('· beside the open forecast panel the in-stock tiles stay even');
    await p.click('#av-t tbody td[data-sv]');   // a click on a market's ad spend (not a link or a button) docks its rule's working
    await p.waitForTimeout(350);
    const on = await p.evaluate(() => document.body.classList.contains('sv-on'));
    if (on) {
      const tr = rowsOf(await tiles(p, 'av-sum'));
      ok('with the panel docked, the in-stock tiles sit in even rows, one width each', tr.length >= 1 && even(tr) && same([].concat(...tr).map((b) => b.w)), tr.map((r) => r.map((b) => Math.round(b.w))));
    } else ok('the forecast panel opened on a market row (needed for the next measure)', false, 'panel did not open');
    await ctx.close();
  }

  console.log('· 1100px — the in-stock tiles even, and the negative control');
  {
    const { ctx, p } = await open(browser, 1100);
    let rs = rowsOf(await tiles(p, 'av-sum'));
    ok('the in-stock tiles sit in even rows at 1100px, one width each', rs.length >= 1 && even(rs) && same([].concat(...rs).map((b) => b.w)), rs.map((r) => r.map((b) => Math.round(b.w))));
    // NEGATIVE CONTROL — a fixed-width fill forced onto the same tiles leaves them 3 + 1, and the measure must catch it
    await p.addStyleTag({ content: '#av-sum{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))!important}' });
    await p.waitForTimeout(100);
    rs = rowsOf(await tiles(p, 'av-sum'));
    ok('negative control: a fixed-width fill wraps the same tiles unevenly, and the even-row measure says so', !even(rs), rs.map((r) => r.length));
    await ctx.close();
  }

  console.log('· a phone — the search field on a row of its own');
  {
    const { ctx, p, errs } = await open(browser, 390, 844);
    ok('no KPI band on the phone either', !(await p.$('#kpis')));
    const q = await p.evaluate(() => { const r = document.getElementById('q').getBoundingClientRect(), c = document.querySelector('.hero .ctl').getBoundingClientRect(); return { w: r.width, cw: c.width }; });
    ok('the search field spans the control row (it had shrunk to its first two letters)', q.w >= q.cw - 2, q);
    await p.evaluate(() => window.FCCDigest && window.FCCDigest.expandAll && window.FCCDigest.expandAll());
    await p.waitForTimeout(150);
    for (const id of ['av-sum', 'hm-sum']) {
      const t = await p.evaluate((id) => Array.from(document.getElementById(id).children).map((c) => { const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; }), id);
      const tr = rowsOf(t);
      ok('#' + id + ' on a phone: even rows, or an odd tile out spanning the row rather than leaving a gap', tr.length >= 1 && tr.every((r, i) => r.length === tr[0].length || (i === tr.length - 1 && r.length === 1 && r[0].w > tr[0][0].w * 1.8)), tr.map((r) => r.map((b) => Math.round(b.w))));
    }
    const pan = await p.evaluate(() => { const fr = document.getElementById('av-t').parentElement; return { sw: fr.scrollWidth, cw: fr.clientWidth, ox: getComputedStyle(fr).overflowX }; });
    ok('the in-stock table pans inside its own frame on a phone (pan, don\'t crush)', pan.sw > pan.cw && /auto|scroll/.test(pan.ox), pan);
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
