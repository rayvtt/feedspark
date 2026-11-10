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
const STUB = `try{localStorage.clear();}catch(e){}${require('./rules_stub.js').openCards(HTML)}
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

  // Ray, 27 Oct 2026: "the volumes of in-stock not live should be deducted from Google Shopping versus the master feed
  // in-stock product, instead of using the sub-feed logic. The sub-feed in-stock logic should be used in another section"
  console.log('· the in-stock card counts the master; the suppfeed is its own section');
  {
    const { ctx, p, errs } = await open(browser, 1440);
    const r = await p.evaluate(() => {
      const row = (sel, mk) => Array.from(document.querySelectorAll(sel + ' tbody tr')).find((tr) => (tr.querySelector('td.nm') || {}).textContent === mk);
      const av = row('#av-t', 'Superdry GB'), sp = row('#supp-t', 'Superdry GB'), card = document.getElementById('supp-card');
      return { av: av && av.querySelector('td.hbs .big').textContent, avTip: av && av.querySelector('td.hbs [data-tip]').getAttribute('data-tip'),
        shown: !!card && !card.hidden, rows: document.querySelectorAll('#supp-t tbody tr').length,
        sp: sp && Array.from(sp.querySelectorAll('td')).map((td) => td.textContent.replace(/\s+/g, ' ').trim()),
        dl: sp && sp.querySelector('[data-hbdl]').getAttribute('data-hbdl'), avdl: av && av.querySelector('[data-hbdl]').getAttribute('data-hbdl'),
        after: card && card.previousElementSibling && card.previousElementSibling.id };
    });
    ok('the in-stock card\'s Superdry GB count is the master\'s (3,800), with no suppfeed line', /3,800$/.test(r.av || '') && !/suppfeed/.test(r.avTip || ''), r.av);
    ok('the suppfeed section is shown, right after the in-stock card, one row per market FeedHero carries a suppfeed for', r.shown && r.after === 'av-card' && r.rows === 1, r);
    ok('…its row: suppfeed decides 31,000 · in stock 26,400 against the master\'s 29,100 · 2,600 not live · ≈ 25% on range_comp · 1,200 fewer than the master', r.sp && /^31,000/.test(r.sp[1]) && /^26,400 ?master 29,100/.test(r.sp[2]) && /2,600/.test(r.sp[3]) && /≈25%/.test(r.sp[4]) && /^−1,200 ?against 3,800 by the master/.test(r.sp[5]), r.sp);
    ok('…each card downloads its own list (the master\'s, the suppfeed\'s)', r.avdl === 'superdry_gb' && r.dl === 'superdry_gb|s', [r.avdl, r.dl]);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  // ---- THE PAGE AS REDESIGNED (Ray, 10 Nov 2026: "rethink the entire stock dashboard module to surface data that actually
  // makes sense … keep the 'stimulate the stock rule'. Cut, revamp, re-insight") — Stock health first, the waterfall, the
  // simulator, the levers, the hero-size mapping, How it's read; the coverage matrix, cut-offs, hero-size runs, market
  // setups and "how a rule is placed" are gone. Every figure below is recomputed here from the stub's own counts.
  console.log('· the page as redesigned — Stock health first, the cut cards gone');
  {
    const { ctx, p, errs } = await open(browser, 1440);
    const top = await p.evaluate(() => ({ order: Array.from(document.querySelectorAll('main.wrap > section.card')).map((c) => c.id),
      gone: ['cov', 'cuts', 'heroes', 'setups', 'mechs', 'how', 'q', 'kpis'].filter((id) => document.getElementById(id)) }));
    ok('the cards, in order: Stock health · suppfeed · where the catalogue goes · simulator · levers · hero-size mapping · how it’s read', top.order.join() === 'av-card,supp-card,wf-card,sim-card,lev-card,hmap-card,how-card', top.order);
    ok('the coverage matrix, cut-offs, hero-size runs, market setups, rule search and "how a rule is placed" table are gone', top.gone.length === 0, top.gone);

    console.log('· Stock health — five tiles, the sums of the markets measured');
    const T = await p.evaluate(() => Array.from(document.querySelectorAll('#av-sum .it')).map((it) => ({ h: (it.querySelector('.h') || {}).textContent, b: (it.querySelector('b') || {}).textContent, s: (it.querySelector('.s') || {}).textContent, sv: it.getAttribute('data-sv') })));
    // the stub: Superdry GB 29,100 in stock, 3,800 held (3,700 under the ≈35% line); Reiss GB 24,900 in stock, 2,100 held, no line
    ok('in stock 54,000 (29,100 + 24,900) over 2 markets · live 89.1% (48,100) · range completion 3,700 · other reasons 2,200 (100 + 2,100) · ad spend the book', T.length === 5
      && T[0].b === '54,000' && /2 markets/.test(T[0].s) && T[1].b === '89.1%' && /48,100/.test(T[1].s) && T[2].b === '3,700' && T[3].b === '2,200' && /1 market to check/.test(T[3].s) && T[4].sv === 'book' && /£808/.test(T[4].b), T);
    for (const id of ['av-sum', 'hm-sum']) {
      const t = await p.evaluate((id) => {
        const box = document.getElementById(id), r = box.getBoundingClientRect();
        return { r: r.right, l: r.left, its: Array.from(box.children).map((c) => { const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, right: b.right }; }) };
      }, id);
      const rows = rowsOf(t.its);
      ok('#' + id + ': ' + t.its.length + ' tiles, one row, one width each, the last one flush with the card', t.its.length >= 2 && rows.length === 1 && same(t.its.map((b) => b.w)) && Math.abs(t.its[t.its.length - 1].right - t.r) <= 1 && Math.abs(t.its[0].x - t.l) <= 1, t);
    }

    console.log('· Stock health — one row per measured market, a verdict each, the rest one line');
    const av = await p.evaluate(() => {
      const t = document.getElementById('av-t'), fr = t.parentElement;
      const rows = Array.from(t.querySelectorAll('tbody tr')).map((tr) => ({ wait: tr.classList.contains('sh-wait'), mk: tr.cells[0].textContent.replace(/\s+/g, ' ').trim(), cells: tr.cells.length,
        live: tr.cells[2] ? tr.cells[2].textContent.replace(/\s+/g, ' ').trim() : '', hb: tr.cells[3] ? tr.cells[3].textContent.replace(/\s+/g, ' ').trim() : '', rc: tr.cells[4] ? tr.cells[4].textContent.replace(/\s+/g, ' ').trim() : '',
        sv: !!(tr.cells[5] && tr.cells[5].hasAttribute('data-sv')), vd: ((tr.querySelector('.vd') || {}).textContent || '').trim(), vdk: ((tr.querySelector('.vd') || {}).className || ''), list: !!tr.querySelector('[data-hbdl]') }));
      const clip = Array.from(t.querySelectorAll('thead th')).filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim().slice(0, 30));
      return { cols: t.querySelectorAll('thead th').length, frame: fr.clientWidth, sw: fr.scrollWidth, rows, clip, inCard: !!document.querySelector('#av-card #sv-rules #sv-t'),
        tools: Array.from(document.querySelectorAll('#av-card .chead .tools > *')).map((x) => x.id), th: ((document.getElementById('sv-th') || {}).textContent || '').replace(/\s+/g, ' ').trim() };
    });
    const R = av.rows.filter((r) => !r.wait), W = av.rows.filter((r) => r.wait);
    ok('seven columns: market · in stock · live in Google · held back · range-completion line · ad spend kept off · verdict', av.cols === 7, av.cols);
    ok('the table fits its card at 1440px, no heading clipped', av.sw <= av.frame + 1 && av.clip.length === 0, [av.sw, av.frame, av.clip]);
    ok('the market to check leads: Reiss GB — Check (8.4% held, no line explains it), then Superdry GB — Protecting', R.length === 2 && R[0].mk === 'Reiss GB' && R[0].vd === 'Check' && /leak/.test(R[0].vdk) && R[1].mk === 'Superdry GB' && R[1].vd === 'Protecting', R.map((r) => [r.mk, r.vd]));
    ok('Superdry GB: 86.9% live (25,300) · 3,800 held, 97.4% by range completion · ≈35% in the data · its ⬇ List', /^86\.9%\s*25,300$/.test(R[1].live) && /3,800\s*13\.1% · 97\.4% by RC/.test(R[1].hb) && /≈\s*35%/.test(R[1].rc) && R[1].list, R[1]);
    ok('Reiss GB: no RC line in the data — the cut-off a rule name states', /no RC line/.test(R[0].hb) && /^RC < \d+%/.test(R[0].rc), R[0]);
    ok('a market nothing can be measured on is ONE line naming it and why (Superdry DE — not counted yet)', W.length === 1 && /Not measured yet/.test(W[0].mk) && /DE/.test(W[0].mk) && /not counted yet/.test(W[0].mk), W);
    ok('a measured market\'s ad-spend cell opens its largest rule\'s working (data-sv)', R.filter((r) => r.sv).length === 2, R.map((r) => r.sv));
    ok('only ⬇ CSV in the card\'s header; the column head names the forecast shown; the rule-by-rule table in the card\'s fold', av.tools.join(',') === 'av-csv' && /^Ad spend kept off\s*conservative 5% · a month$/.test(av.th) && av.inCard, [av.tools, av.th]);
    await p.evaluate(() => { document.getElementById('sv-rules').open = true; });
    await p.waitForTimeout(100);
    const sv = await p.evaluate(() => Array.from(document.querySelectorAll('#sv-t tbody tr')).map((tr) => ({ h: tr.getBoundingClientRect().height, mk: tr.cells[0].textContent.trim(), id: (tr.getAttribute('data-sv') || '').split('|')[0] })));
    ok('the rule-by-rule fold opens onto its rules, one height each', sv.length >= 2 && sv.every((r) => r.h > 0) && same(sv.map((r) => r.h), 1), sv.map((r) => Math.round(r.h)));
    {
      const g = await p.evaluate(() => Array.from(document.querySelectorAll('#sv-t tbody tr[data-sv]')).map((tr) => ({ mk: tr.cells[0].textContent.trim(), id: tr.getAttribute('data-sv').split('|')[0], gi: tr.classList.contains('gi') })));
      const runs = g.filter((r, i) => !i || g[i - 1].id !== r.id);
      ok('#sv-t: each market named once, on the first row of its run (' + runs.length + ' markets, ' + g.length + ' rows)', g.length > 0 && g.filter((r) => r.mk).length === runs.length && g.every((r, i) => !!r.mk === (!i || g[i - 1].id !== r.id)), g);
      ok('#sv-t: the rows that continue a run are divided by a quieter line', g.every((r, i) => r.gi === (i < g.length - 1 && g[i + 1].id === r.id)), g);
    }

    console.log('· where the in-stock catalogue goes — the waterfall and the market bars');
    const wf = await p.evaluate(() => ({ labs: Array.from(document.querySelectorAll('#wf-svg svg text')).map((t) => t.textContent), rects: document.querySelectorAll('#wf-svg svg rect').length,
      cap: document.getElementById('wf-cap').textContent, h: document.getElementById('wf-h').textContent,
      bars: Array.from(document.querySelectorAll('#wf-bars .wf-row')).map((r) => ({ nm: r.querySelector('.nm').textContent, pc: r.querySelector('.pc').textContent, w: Array.from(r.querySelectorAll('.bar i')).map((i) => parseFloat(i.style.width)) })) }));
    ok('four steps: 54,000 in stock → −3,700 range completion → −2,200 other reasons → 48,100 live (89.1%)', wf.rects === 4 && wf.labs.indexOf('54,000') >= 0 && wf.labs.indexOf('−3,700') >= 0 && wf.labs.indexOf('−2,200') >= 0 && wf.labs.indexOf('48,100 · 89.1%') >= 0, wf.labs);
    ok('…in stock = range completion + other reasons + live (3,700 + 2,200 + 48,100)', 3700 + 2200 + 48100 === 54000);
    ok('…the held back named by where they go: 5,890 not in the Google feed, 10 sent out of stock', /5,900 held back, 5,890 are not in the Google feed at all and 10 are sent as out of stock/.test(wf.cap), wf.cap);
    ok('one bar per measured market, most held back first, each adding up to its in stock', wf.bars.length === 2 && /Superdry GB/.test(wf.bars[0].nm) && wf.bars[0].pc === '13.1%' && wf.bars[1].pc === '8.4%' && wf.bars.every((b) => Math.abs(b.w.reduce((a, c) => a + c, 0) - 100) < 0.05), wf.bars);

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

    console.log('· how it’s read — the method in six plain blocks, the rules one click away');
    const how = await p.evaluate(() => ({ n: document.querySelectorAll('#how-card .how-g > div').length, a: (document.getElementById('how-rules') || {}).getAttribute && document.getElementById('how-rules').getAttribute('href'), last: (Array.from(document.querySelectorAll('main.wrap > section.card')).pop() || {}).id }));
    ok('six blocks, a link to every rule in run order, and it is the last card', how.n === 6 && /^\/rules/.test(how.a) && how.last === 'how-card', how);
    ok('no findings card ("Needs a look" stays gone)', await p.evaluate(() => !document.getElementById('find-card') && !/Needs a look/.test(document.querySelector('main').textContent)));
    ok('no page errors', errs.length === 0, errs);

    console.log('· beside the open forecast panel the Stock health tiles stay even');
    await p.click('#av-t tbody td[data-sv]');
    await p.waitForTimeout(350);
    const on = await p.evaluate(() => document.body.classList.contains('sv-on'));
    if (on) {
      const tr = rowsOf(await tiles(p, 'av-sum'));
      ok('with the panel docked, the tiles sit in even rows, one width each', tr.length >= 1 && even(tr) && same([].concat(...tr).map((b) => b.w)), tr.map((r) => r.map((b) => Math.round(b.w))));
    } else ok('the forecast panel opened on a market row (needed for the next measure)', false, 'panel did not open');
    await ctx.close();
  }

  console.log('· 1100px — the Stock health tiles even, and the negative control');
  {
    const { ctx, p } = await open(browser, 1100);
    let rs = rowsOf(await tiles(p, 'av-sum'));
    ok('the Stock health tiles sit in even rows at 1100px, one width each', rs.length >= 1 && even(rs) && same([].concat(...rs).map((b) => b.w)), rs.map((r) => r.map((b) => Math.round(b.w))));
    // NEGATIVE CONTROL — a fixed-width fill forced onto the same tiles leaves them 3 + 1, and the measure must catch it
    await p.addStyleTag({ content: '#av-sum{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))!important}' });
    await p.waitForTimeout(100);
    rs = rowsOf(await tiles(p, 'av-sum'));
    ok('negative control: a fixed-width fill wraps the same tiles unevenly, and the even-row measure says so', !even(rs), rs.map((r) => r.length));
    await ctx.close();
  }

  console.log('· a phone — the header controls fit');
  {
    const { ctx, p, errs } = await open(browser, 390, 844);
    ok('no KPI band on the phone either', !(await p.$('#kpis')));
    const q = await p.evaluate(() => { const c = document.querySelector('.hero .ctl').getBoundingClientRect(); return { r: Math.round(Array.from(document.querySelectorAll('.hero .ctl > *')).reduce((m, e) => Math.max(m, e.getBoundingClientRect().right), 0)), cw: Math.round(c.right) }; });
    ok('the header controls fit the phone (the rule search left with the market setups)', !(await p.$('#q')) && q.r <= q.cw + 1, q);
    await p.evaluate(() => window.FCCDigest && window.FCCDigest.expandAll && window.FCCDigest.expandAll());
    await p.waitForTimeout(150);
    for (const id of ['av-sum', 'hm-sum']) {
      const t = await p.evaluate((id) => Array.from(document.getElementById(id).children).map((c) => { const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; }), id);
      const tr = rowsOf(t);
      ok('#' + id + ' on a phone: even rows, or an odd tile out spanning the row rather than leaving a gap', tr.length >= 1 && tr.every((r, i) => r.length === tr[0].length || (i === tr.length - 1 && r.length === 1 && r[0].w > tr[0][0].w * 1.8)), tr.map((r) => r.map((b) => Math.round(b.w))));
    }
    const pan = await p.evaluate(() => { const fr = document.getElementById('av-t').parentElement; return { sw: fr.scrollWidth, cw: fr.clientWidth, ox: getComputedStyle(fr).overflowX }; });
    ok('the Stock health table pans inside its own frame on a phone (pan, don\'t crush)', pan.sw > pan.cw && /auto|scroll/.test(pan.ox), pan);
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
