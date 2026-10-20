#!/usr/bin/env node
/*
 * tools/check_breakdown.js — FIELD BREAKDOWN, DRIVEN AS AN AM DRIVES IT.
 *
 * Ray, 15 Oct 2026: "build another module that similar to custom label and PT — basically having the ability to
 * breakdown in pivot table like this for any fields is super helpful … a custom 'breakdown' fields module to
 * breakdown in pivot with any fields in any feeds".
 *
 * tools/test_breakdown.mjs pins the engine and the wiring. THIS pins the half only a browser can see, on the REAL
 * page with the synthetic Northwind feed from tools/breakdown_stub.js, every count checked against an INDEPENDENT
 * count read straight off the XML with a regular expression (never through the engine under test):
 *   · the feed streams whole; the default panes are the fields a feed person reaches for, read the right way
 *     (product_type cut to tier 2);
 *   · a pane's rows equal the independent count; clicking a value filters EVERY OTHER table and the bar, never its
 *     own (the value stays highlighted, its siblings still listed);
 *   · any field can be picked into a pane; a repeated field read as "all slots" says its shares add to more than 100%;
 *   · the pivot's cells equal the independent cross count, and clicking one filters the page to it;
 *   · Styles counts item groups once;
 *   · the layout survives a reload, a saved view opens on another market's feed, the Meta market reads its own feed;
 *   · every section folds — fresh-device defaults, a click, the remembered choice, Open/Fold all, a #hash;
 *   · ⤓ CSV downloads every row of a table; no console error; at 390px nothing scrolls sideways.
 * Run: node tools/check_breakdown.js        (in presync; CI has no browsers)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright not installed — breakdown check skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const STUBS = require('./breakdown_stub.js');
const PAGE = fs.readFileSync(path.join(D, 'FeedSpark_Breakdown.html'), 'utf8');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const HTML = PAGE.split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html', 'lang_widget.html', 'hours_widget.html', 'shipped_widget.html', 'mobile_widget.html', 'digest_widget.html', 'migration_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const SERVED = HTML.replace('</body>', WIDGETS + '\n</body>');
const STUB = `window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
${STUBS.stubLines()}
 if(url.indexOf('/api/access')>=0)return j({ok:true,email:'ray@feedspark.com',owner:true,clients:null,modules:null});
 if(url.indexOf('/api/presence')>=0)return j({ok:true,me:'ray@feedspark.com',owner:true,now:Date.now(),users:[],roster:[]});
 if(url.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:0,warn:0,pt:{crit:0,warn:0},gr:{crit:0,warn:0},clients:{}});
 return j({ok:false,error:'stub'},404);};`;

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };

// ---- the independent count: regular expressions over the synthetic XML, never the engine ---------------------------
const XML = STUBS.build().xml;
const dec = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').trim();
const ITEMS = [...XML.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
const tag = (it, t) => { const m = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>').exec(it); return m ? dec(m[1]) : ''; };
const tagsAll = (it, t) => [...it.matchAll(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>', 'g'))].map((m) => dec(m[1])).filter(Boolean);
const tier = (v, k) => v ? v.split(/\s*>\s*/).slice(0, k).join(' > ') : '(blank)';
const count = (fn, items) => { const m = {}; (items || ITEMS).forEach((it) => { [].concat(fn(it)).forEach((v) => { m[v] = (m[v] || 0) + 1; }); }); return m; };
const PT2 = count((it) => tier(tag(it, 'g:product_type'), 2));
const COLOR = count((it) => tag(it, 'g:color') || '(blank)');
const HL = count((it) => { const a = [...new Set(tagsAll(it, 'g:product_highlight'))]; return a.length ? a : ['(blank)']; });
const TOP = Object.keys(PT2).sort((a, b) => PT2[b] - PT2[a])[0];
const inTop = ITEMS.filter((it) => tier(tag(it, 'g:product_type'), 2) === TOP);
const COLOR_IN_TOP = count((it) => tag(it, 'g:color') || '(blank)', inTop);
const AV = (it) => tag(it, 'g:availability') || '(blank)';
const CROSS = {}; ITEMS.forEach((it) => { const r = tier(tag(it, 'g:product_type'), 2), c = AV(it); CROSS[r] = CROSS[r] || {}; CROSS[r][c] = (CROSS[r][c] || 0) + 1; });
const GROUPS = new Set(ITEMS.map((it) => tag(it, 'g:item_group_id') || Math.random())).size;

async function paneRows(pg, i) {
  return pg.evaluate((i) => Array.from(document.querySelectorAll('#panes .pane:not(.add)')[i].querySelectorAll('tbody tr[data-v]'))
    .map((tr) => [tr.getAttribute('data-v'), +tr.querySelector('td.n').textContent.replace(/,/g, ''), tr.classList.contains('sel')]), i);
}
async function setPaneField(pg, i, f) {
  await pg.evaluate(([i, f]) => { const s = document.querySelectorAll('#panes .pane:not(.add)')[i].querySelector('select.f'); s.value = f; s.dispatchEvent(new Event('change', { bubbles: true })); }, [i, f]);
  await pg.waitForTimeout(80);
}
const ready = (pg) => pg.waitForFunction(() => window.__FCCBreakdown && window.__FCCBreakdown.state().feed.st === 'done', null, { timeout: 30000 });

(async () => {
  const tmp = path.join(os.tmpdir(), '_bdcheck_FeedSpark_Breakdown.html'); fs.writeFileSync(tmp, HTML);
  const tmpS = path.join(os.tmpdir(), '_bdcheck_served_FeedSpark_Breakdown.html'); fs.writeFileSync(tmpS, SERVED);
  const b = await chromium.launch({ headless: true });
  try {
    console.log('· 1440px — the read, the default panes, each against an independent count');
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text())) errs.push(m.text()); });
    pg.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Merch view' : undefined));
    await pg.addInitScript(STUB);
    await pg.goto('file://' + tmp);
    await ready(pg);
    const st = await pg.evaluate(() => { const S = window.__FCCBreakdown.state(); return { n: S.st.n, panes: S.L.panes, brand: S.brand, mkt: S.mkt, reads: window.__bdReads }; });
    ok('the whole feed is read — every product, the header not counted as one', st.n === ITEMS.length, [st.n, ITEMS.length]);
    ok('it opens on the brand and its Google market (never the Meta one first)', st.brand === STUBS.CLIENT && st.mkt === STUBS.MKT && /market=gb$/.test(st.reads[0]), st);
    ok('four default fields, product_type read to tier 2', st.panes.length === 4 && st.panes[0].f === 'g:product_type' && st.panes[0].m === 'tier' && st.panes[0].k === 2, st.panes);
    let r0 = await paneRows(pg, 0);
    ok('product_type to tier 2: every value and its count equal the independent count', r0.length === Object.keys(PT2).length && r0.every(([v, n]) => PT2[v] === n), r0);
    ok('…biggest first', r0[0][0] === TOP, r0[0]);

    console.log('· a click filters every OTHER table, never its own');
    await pg.click('#panes .pane:not(.add) >> nth=0 >> tr[data-v="' + TOP + '"]');
    await pg.waitForTimeout(120);
    const sum = await pg.textContent('#fsum');
    ok('the bar reads the filtered count', sum.replace(/,/g, '').indexOf(inTop.length + ' of ' + ITEMS.length) >= 0, sum);
    r0 = await paneRows(pg, 0);
    ok('…the clicked table keeps every value, the picked one highlighted', r0.length === Object.keys(PT2).length && r0.filter((r) => r[2]).map((r) => r[0]).join() === TOP, r0);
    await setPaneField(pg, 1, 'g:color');
    let r1 = await paneRows(pg, 1);
    ok('a pane switched to any field (g:color) reads the filtered products', r1.length === Object.keys(COLOR_IN_TOP).length && r1.every(([v, n]) => COLOR_IN_TOP[v] === n), [r1, COLOR_IN_TOP]);
    ok('…and its chip names the filter', /product_type · tier 2 = /.test(await pg.textContent('#fchips')));
    await pg.click('#fclear'); await pg.waitForTimeout(100);
    r1 = await paneRows(pg, 1);
    ok('✕ Clear filters reads every product again', r1.every(([v, n]) => COLOR[v] === n), r1);

    console.log('· every slot of a repeated field, counted once in each value');
    await pg.selectOption('#addf', 'g:product_highlight*'); await pg.waitForTimeout(120);
    const nP = await pg.evaluate(() => document.querySelectorAll('#panes .pane:not(.add)').length);
    const rh = await paneRows(pg, nP - 1);
    ok('＋ Add a field puts "all slots" on a new pane', nP === 5 && rh.length === Object.keys(HL).length && rh.every(([v, n]) => HL[v] === n), [nP, rh, HL]);
    const meta = await pg.evaluate(() => { const p = document.querySelectorAll('#panes .pane:not(.add)'); return p[p.length - 1].querySelector('.pm').textContent; });
    ok('…and says those shares add to more than 100%', /counted in each value/.test(meta), meta);

    console.log('· the pivot');
    await pg.evaluate(() => { const s = document.querySelector('#pv-c select.f'); s.value = 'g:availability'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await pg.waitForTimeout(150);
    const pv = await pg.evaluate(() => {
      const t = document.querySelector('#pv table'), heads = Array.from(t.querySelectorAll('thead th')).slice(1, -1).map((th) => th.textContent);
      return { heads, rows: Array.from(t.querySelectorAll('tbody tr')).map((tr) => [tr.querySelector('td.rh').textContent, Array.from(tr.querySelectorAll('td.c:not(.tot)')).map((td) => td.textContent === '·' ? 0 : +td.textContent.replace(/,/g, ''))]) };
    });
    ok('every pivot cell equals the independent cross count', pv.rows.length === Object.keys(CROSS).length && pv.rows.every(([r, cells]) => cells.every((n, j) => (CROSS[r][pv.heads[j]] || 0) === n)), pv);
    await pg.click('#pv tbody tr >> nth=0 >> td.c >> nth=0'); await pg.waitForTimeout(120);
    const fl = await pg.evaluate(() => window.__FCCBreakdown.state().filters.map((f) => f.spec.f + '=' + f.vals.join('|')));
    ok('clicking a cell filters the page to its row and column', fl.length === 2 && fl[0] === 'g:product_type=' + pv.rows[0][0] && fl[1] === 'g:availability=' + pv.heads[0], fl);
    await pg.click('#fclear'); await pg.waitForTimeout(100);

    console.log('· the pivot CSV carries every column the screen folds into Other');
    const IDS = new Set(ITEMS.map((it) => tag(it, 'g:id'))).size;
    await pg.evaluate(() => { const s = document.querySelector('#pv-c select.f'); s.value = 'g:id'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await pg.waitForTimeout(150);
    const scrOther = await pg.evaluate(() => /Other \(/.test(document.querySelector('#pv table thead').textContent));
    ok('the screen folds the columns past twelve into Other', IDS > 12 && scrOther, [IDS, scrOther]);
    const [pdl] = await Promise.all([pg.waitForEvent('download'), pg.click('#pv-csv')]);
    const pcsv = fs.readFileSync(await pdl.path(), 'utf8').replace(/^\uFEFF/, '');
    const head = pcsv.split(/\r\n/)[0].split(',');
    const pRows = pcsv.split(/\r\n/).filter((l) => l && !/^(Column total|Read|Note),/.test(l)).length - 1;
    ok('…the CSV has one column per id and no Other', !/Other \(/.test(pcsv) && head.length === IDS + 2, [head.length, IDS]);
    ok('…and every row of the row field', pRows === Object.keys(PT2).length, [pRows, Object.keys(PT2).length]);
    await pg.evaluate(() => { const s = document.querySelector('#pv-c select.f'); s.value = 'g:availability'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await pg.waitForTimeout(120);

    console.log('· newness by quarter, on the columns and the rows');
    {
      const now = new Date(), refQ = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3), QN = (i) => 'Q' + (i % 4 + 1) + ' ' + Math.floor(i / 4);
      const want = {};
      ITEMS.forEach((it) => { const m = /<c:fs_date_of_birth[^>]*>\s*(\d{4})-(\d{2})/.exec(it); if (!m) return; const i = +m[1] * 4 + Math.floor((+m[2] - 1) / 3), back = refQ - i;
        const v = back < 8 ? QN(i) : 'Before ' + QN(refQ - 7); want[v] = (want[v] || 0) + 1; });
      { let deep = -1; Object.keys(want).forEach((v) => { if (/^Before /.test(v)) deep = 7; const r = /^Q(\d) (\d{4})/.exec(v); if (r) deep = Math.max(deep, refQ - (+r[2] * 4 + +r[1] - 1)); });
        for (let k = 0; k <= Math.min(deep, 7); k++) { const i = refQ - k, v = QN(i); if (!(v in want)) want[v] = 0; } }
      const grp = await pg.evaluate(() => { const s = document.querySelector('#pv-c select.f'), g = s.querySelector('optgroup'); return g && g.label + '|' + Array.from(g.querySelectorAll('option')).map((o) => o.value).join(); });
      ok('the column picker opens on a Newness group carrying the feed\'s first-seen date', grp === 'Newness · by quarter|c:fs_date_of_birth', grp);
      await pg.evaluate(() => { const s = document.querySelector('#pv-c select.f'); s.value = 'c:fs_date_of_birth'; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await pg.waitForTimeout(150);
      const q = await pg.evaluate(() => ({ m: document.querySelector('#pv-c select.m').value, heads: Array.from(document.querySelectorAll('#pv table thead th')).slice(1, -1).map((th) => th.textContent), tot: Array.from(document.querySelectorAll('#pv table tfoot td.c')).map((td) => +td.textContent.replace(/[^0-9]/g, '') || 0) }));
      const order = Object.keys(want).sort((x, y) => { const k = (v) => { const r = /(Before )?Q(\d) (\d{4})/.exec(v); return (r[1] ? 1e6 : 0) - (+r[3] * 4 + +r[2]); }; return k(x) - k(y); });
      ok('picking the date reads it by quarter, newest first, every quarter counted independently', q.m === 'qtr' && q.heads.join('|') === order.join('|') && q.heads.every((h, j) => q.tot[j] === want[h]), [q, want]);
      const qf = await pg.evaluate(() => { const w = document.getElementById('pv'), ths = Array.from(w.querySelectorAll('thead th')); return { sw: w.scrollWidth, cw: w.clientWidth, n: ths.length, cut: ths.filter((th) => th.scrollWidth > th.clientWidth + 1).map((th) => th.textContent) }; });
      ok('…with ' + q.heads.length + ' quarter columns the pivot still fits the card at 1440px, every heading whole', qf.sw <= qf.cw + 1 && !qf.cut.length && qf.n === q.heads.length + 2, qf);
      await pg.evaluate(() => { const r = document.querySelector('#pv-r select.f'); r.value = 'c:fs_date_of_birth'; r.dispatchEvent(new Event('change', { bubbles: true })); });
      await pg.waitForTimeout(150);
      const qr = await pg.evaluate(() => ({ m: document.querySelector('#pv-r select.m').value, rows: Array.from(document.querySelectorAll('#pv tbody tr td.rh')).map((td) => td.textContent) }));
      ok('…and on the rows, in the same order', qr.m === 'qtr' && qr.rows.join('|') === order.join('|'), [qr, order]);
      if (process.env.BD_SHOT) await pg.locator('#sec-pivot, #pv').first().screenshot({ path: process.env.BD_SHOT });
      await pg.evaluate(() => { const r = document.querySelector('#pv-r select.f'); r.value = 'g:product_type'; r.dispatchEvent(new Event('change', { bubbles: true })); const s = document.querySelector('#pv-c select.f'); s.value = 'g:availability'; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await pg.waitForTimeout(120);
    }

    console.log('· Google Ads in the pivot: spend per group, against its share of products, and ROAS');
    {
      const ADS = STUBS.build().ads, A = {}; Object.keys(ADS).forEach((k) => { A[k.toLowerCase()] = ADS[k]; });
      const SP = {}, VAL = {}, NP = {}; let tot = 0, totV = 0;
      ITEMS.forEach((it) => { const r = tier(tag(it, 'g:product_type'), 2), a = A[tag(it, 'g:id').toLowerCase()] || [0, 0, 0, 0, 0];
        SP[r] = (SP[r] || 0) + a[2]; VAL[r] = (VAL[r] || 0) + a[4]; NP[r] = (NP[r] || 0) + 1; tot += a[2]; totV += a[4]; });
      const money = (t) => parseFloat(String(t).replace(/[£,\s]/g, ''));
      await pg.selectOption('#pv-meas', 'cost'); await pg.waitForTimeout(250);
      const sp = await pg.evaluate(() => ({ line: document.getElementById('pv-ads').textContent, hidden: document.getElementById('pv-ads').hidden,
        heads: Array.from(document.querySelectorAll('#pv table thead th')).map((th) => th.textContent),
        rows: Array.from(document.querySelectorAll('#pv tbody tr')).map((tr) => { const t = tr.querySelectorAll('td'); return [t[0].textContent, t[t.length - 2].textContent, t[t.length - 1].textContent]; }),
        foot: Array.from(document.querySelectorAll('#pv tfoot td')).map((td) => td.textContent) }));
      ok('picking Spend reads Google Ads and says what it joined, naming the spend on products the feed no longer carries', !sp.hidden && /last 30 days/i.test(sp.line) && /no longer carries/.test(sp.line) && /£9\.50/.test(sp.line), sp.line);
      ok('…every row total is the 30-day spend of its own products, counted independently (an id is matched case-blind)', sp.rows.length === Object.keys(SP).length && sp.rows.every(([v, t]) => Math.abs(money(t) - SP[v]) < 0.6), [sp.rows, SP]);
      ok('…the column total is the feed’s spend, never the out-of-feed id', Math.abs(money(sp.foot[sp.foot.length - 2]) - tot) < 0.6, [sp.foot, tot]);
      ok('…and beside it each row’s share of PRODUCTS, the contrast the spend is read against', sp.heads[sp.heads.length - 1] === '% of products' && sp.rows.every(([v, , p]) => Math.abs(parseFloat(p) - NP[v] / ITEMS.length * 100) < 0.6), sp.rows);
      await pg.click('#pv-show [data-s="all"]'); await pg.waitForTimeout(150);
      const share = await pg.evaluate(() => Array.from(document.querySelectorAll('#pv tbody tr')).map((tr) => { const t = tr.querySelectorAll('td'); return [t[0].textContent, t[t.length - 2].textContent]; }));
      if (process.env.BD_SHOT2) await pg.locator('#sec-pivot').screenshot({ path: process.env.BD_SHOT2 });
      ok('…% of total turns each row into its share of the spend', share.every(([v, t]) => Math.abs(parseFloat(t) - SP[v] / tot * 100) < 0.6), share);
      await pg.selectOption('#pv-meas', 'roas'); await pg.waitForTimeout(200);
      const ro = await pg.evaluate(() => ({ off: document.getElementById('pv-show').classList.contains('off'), rows: Array.from(document.querySelectorAll('#pv tbody tr')).map((tr) => { const t = tr.querySelectorAll('td'); return [t[0].textContent, t[t.length - 2].textContent, t[t.length - 1].textContent]; }) }));
      ok('ROAS is conversion value ÷ spend from each group’s own sums, with the spend beside it, and never a share', ro.off && ro.rows.every(([v, r, s2]) => (SP[v] > 0 ? Math.abs(parseFloat(r.replace(/,/g, '')) - Math.round(VAL[v] / SP[v] * 100)) <= 1 : r === '—') && Math.abs(money(s2) - SP[v]) < 0.6), [ro, SP, VAL]);
      await pg.selectOption('#pv-lay', 'n'); await pg.waitForTimeout(200);
      const lyr = await pg.evaluate(() => ({ note: document.getElementById('pv-note').textContent, cells: document.querySelectorAll('#pv tbody td.c .pl').length, rows: Array.from(document.querySelectorAll('#pv tbody tr')).map((tr) => { const t = tr.querySelectorAll('td'), tot = t[t.length - 2]; return [t[0].textContent, tot.firstChild.textContent, (tot.querySelector('.pl .plt') || {}).textContent]; }) }));
      ok('a second reading LAYERS into the same table — ROAS shaded, products counted under it in every cell and row total', /reads two things/.test(lyr.note) && lyr.cells > lyr.rows.length && lyr.rows.every(([v, r, l]) => l === NP[v] + (NP[v] === 1 ? ' product' : ' products') && (SP[v] > 0 ? Math.abs(parseFloat(r.replace(/,/g, '')) - Math.round(VAL[v] / SP[v] * 100)) <= 1 : r === '—')), [lyr, NP]);
      const lyw = await pg.evaluate(() => Array.from(document.querySelectorAll('#pv tbody td.tot .pl i')).map((i) => parseFloat(i.style.width)));
      ok('…its blue bar is on the layer\'s OWN scale (the biggest group fills it)', Math.max(...lyw) === 100 && lyw.every((w) => w >= 0 && w <= 100), lyw);
      await pg.selectOption('#pv-meas', 'n'); await pg.click('#pv-show [data-s="n"]'); await pg.selectOption('#pv-lay', 'roas'); await pg.waitForTimeout(200);
      const lyr2 = await pg.evaluate(() => Array.from(document.querySelectorAll('#pv tbody tr')).map((tr) => { const t = tr.querySelectorAll('td'), tot = t[t.length - 1]; return [t[0].textContent, tot.firstChild.textContent, (tot.querySelector('.pl .plt') || {}).textContent]; }));
      ok('…and the other way round: products counted, ROAS layered from each group\'s own sums', lyr2.every(([v, n, l]) => +n.replace(/,/g, '') === NP[v] && (SP[v] > 0 ? Math.abs(parseFloat(l.replace(/,/g, '')) - Math.round(VAL[v] / SP[v] * 100)) <= 1 : !l || /^— ROAS/.test(l))), lyr2);
      await pg.selectOption('#pv-lay2', 'cost'); await pg.waitForTimeout(200);
      const ly3 = await pg.evaluate(() => ({ note: document.getElementById('pv-note').textContent,
        rows: Array.from(document.querySelectorAll('#pv tbody tr')).map((tr) => { const t = tr.querySelectorAll('td'), tot = t[t.length - 1]; return [t[0].textContent, tot.firstChild.textContent, (tot.querySelector('.pl:not(.pl2) .plt') || {}).textContent, (tot.querySelector('.pl2 .plt') || {}).textContent]; }),
        bars: Array.from(document.querySelectorAll('#pv tbody td.tot .pl2 i')).map((i) => parseFloat(i.style.width)),
        green: (() => { const i = document.querySelector('#pv .pl2 i'); return i ? getComputedStyle(i).backgroundColor : ''; })(),
        blue: (() => { const i = document.querySelector('#pv .pl:not(.pl2) i'); return i ? getComputedStyle(i).backgroundColor : ''; })(),
        foot: (() => { const t = document.querySelectorAll('#pv tfoot td'); const e = t.length && t[t.length - 1].querySelector('.pl2 .plt'); return e ? e.textContent : ''; })() }));
      if (process.env.BD_SHOT3) await pg.locator('#pv').screenshot({ path: process.env.BD_SHOT3 });
      ok('a THIRD reading layers under the second — products counted, ROAS blue, spend green, every row against its own sums', /reads three things/.test(ly3.note) && ly3.rows.length && ly3.rows.every(([v, n, l, m]) => +n.replace(/,/g, '') === NP[v] && (SP[v] > 0 ? Math.abs(parseFloat(l.replace(/,/g, '')) - Math.round(VAL[v] / SP[v] * 100)) <= 1 : true) && (SP[v] ? Math.abs(money(m) - SP[v]) < 0.6 : !m)), [ly3, SP]);
      ok('…in its own colour on its own scale, the total row naming the feed\'s spend', ly3.green && ly3.green !== ly3.blue && Math.max(...ly3.bars) === 100 && ly3.foot && Math.abs(money(ly3.foot) - tot) < 0.6, ly3);
      const [l2dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#pv-csv')]);
      const l2csv = fs.readFileSync(await l2dl.path(), 'utf8');
      ok('…and the CSV carries both layers, each as its own block', /\r\nLayer · ROAS,/.test(l2csv) && /\r\nLayer 2 · Spend,/.test(l2csv), l2csv.slice(0, 400));
      await pg.selectOption('#pv-lay', 'cost'); await pg.waitForTimeout(150);
      ok('…a second layer that repeats the first steps aside rather than drawing one reading twice', await pg.evaluate(() => !document.querySelector('#pv .pl2') && document.getElementById('pv-lay2').value === ''));
      await pg.selectOption('#pv-meas', 'roas'); await pg.selectOption('#pv-lay', ''); await pg.selectOption('#pv-lay2', ''); await pg.waitForTimeout(150);
      const [cdl] = await Promise.all([pg.waitForEvent('download'), pg.click('#pv-csv')]);
      const csv = fs.readFileSync(await cdl.path(), 'utf8');
      ok('…the CSV says which measure and keeps the spend column', /ROAS \(Google Ads, last 30 days/.test(csv) && /,Spend\r\n/.test(csv.split('\r\n')[0] + '\r\n'), csv.split('\r\n')[0]);
      const sv = await pg.evaluate(() => ({ head: (document.querySelector('#pv3 .sv3h b') || {}).textContent, by: (document.getElementById('sv3-by') || {}).value,
        rows: Array.from(document.querySelectorAll('#pv3 .sv3r')).map((r) => { const b = r.querySelectorAll('.b'); return [r.querySelector('.nm').textContent, b[0].textContent, b[1].textContent, r.querySelector('.ro em').textContent, b[0].querySelector('i').getBoundingClientRect().width, b[1].querySelector('i').getBoundingClientRect().width]; }) }));
      const live = Object.keys(SP).filter((v) => SP[v] || VAL[v]);
      ok('spend, conversion value and ROAS sit together under the pivot, one row per segment of the rows field', sv.head === 'Spend · conversion value · ROAS' && sv.by === 'r' && sv.rows.length === Math.min(15, live.length), [sv.head, sv.by, sv.rows.length, live.length]);
      ok('…each row\'s spend, value and ROAS are its own products\' sums, counted independently', sv.rows.every(([v, s1, v1, r]) => Math.abs(money(s1) - SP[v]) < 0.6 && Math.abs(money(v1) - VAL[v]) < 0.6 && (SP[v] > 0 ? Math.abs(parseFloat(r.replace(/,/g, '')) - Math.round(VAL[v] / SP[v] * 100)) <= 1 : r === '—')), [sv.rows, SP, VAL]);
      ok('…biggest spend first, and the two money bars on ONE scale (a bigger figure is a longer bar)', sv.rows.every((r, i) => !i || money(sv.rows[i - 1][1]) >= money(r[1])) && sv.rows.every(([, s1, v1, , ws, wv]) => (money(s1) - money(v1)) * (ws - wv) >= -1), sv.rows);
      await pg.selectOption('#sv3-sort', 'ro'); await pg.waitForTimeout(120);
      const svr = await pg.evaluate(() => Array.from(document.querySelectorAll('#pv3 .sv3r .ro em')).map((e) => e.textContent));
      ok('…sorted by ROAS on request, a segment with no spend last', svr.every((t, i) => !i || (t === '—' ? true : svr[i - 1] !== '—' && parseFloat(svr[i - 1].replace(/,/g, '')) >= parseFloat(t.replace(/,/g, '')))), svr);
      await pg.selectOption('#sv3-sort', 'sp');
      await pg.selectOption('#pv-meas', 'n'); await pg.click('#pv-show [data-s="n"]'); await pg.waitForTimeout(150);
      const back = await pg.evaluate(() => ({ hidden: document.getElementById('pv-ads').hidden, last: Array.from(document.querySelectorAll('#pv table thead th')).pop().textContent }));
      ok('…and back on Products the table counts again', back.hidden && back.last === 'Row total', back);
    }

    console.log('· the pivot\'s columns fit the card, and each one is dragged to its own width');
    {
      const fit = await pg.evaluate(() => { const w = document.getElementById('pv'), ths = Array.from(w.querySelectorAll('thead th')); return { sw: w.scrollWidth, cw: w.clientWidth, n: ths.length, grips: w.querySelectorAll('thead .crz').length, cut: ths.some((th) => th.scrollWidth > th.clientWidth + 1) }; });
      ok('no sideways scroll at 1440px, every heading whole (wrapped, never cut), a grip on every column', fit.sw <= fit.cw + 1 && !fit.cut && fit.grips === fit.n && fit.n > 3, fit);
      const quarters = await pg.evaluate(() => Array.from(document.querySelectorAll('#pv thead th')).map((th) => th.textContent).join('|'));
      ok('…a quarter is named by itself, never "this quarter" or "last quarter"', !/this quarter|last quarter|· ahead/.test(quarters), quarters);
      const g = pg.locator('#pv thead th.tot .crz').first(), bb = await g.boundingBox(), w0 = await pg.evaluate(() => document.querySelector('#pv thead th.tot').getBoundingClientRect().width);
      await pg.mouse.move(bb.x + 4, bb.y + 8); await pg.mouse.down(); await pg.mouse.move(bb.x + 64, bb.y + 8, { steps: 6 }); await pg.mouse.up(); await pg.waitForTimeout(150);
      const after = await pg.evaluate(() => ({ w: document.querySelector('#pv thead th.tot').getBoundingClientRect().width, saved: (JSON.parse(localStorage.getItem('fcc-bd-layout') || '{}').pivot || {}).w, sw: document.getElementById('pv').scrollWidth, cw: document.getElementById('pv').clientWidth }));
      ok('dragging a column\'s grip widens it, remembered on the device by what the column is', after.w > w0 + 40 && after.saved && after.saved.tot > w0 + 40, [w0, after]);
      ok('…and the table still fits the card', after.sw <= after.cw + 1, after);
      await pg.dblclick('#pv thead th.tot .crz'); await pg.waitForTimeout(150);
      const reset = await pg.evaluate(() => ({ w: document.querySelector('#pv thead th.tot').getBoundingClientRect().width, saved: (JSON.parse(localStorage.getItem('fcc-bd-layout') || '{}').pivot || {}).w }));
      ok('…a double-click puts it back', Math.abs(reset.w - w0) < 3 && !(reset.saved && reset.saved.tot), [w0, reset]);
    }

    console.log('· a pane is as wide as its longest value');
    const fit = await pg.evaluate(() => Array.from(document.querySelectorAll('#panes .pane:not(.add) td.v')).every((td) => td.scrollWidth <= td.clientWidth + 1 && getComputedStyle(td).textOverflow !== 'ellipsis'));
    ok('no value in a pane is cut short', fit);

    console.log('· a pane\'s width is dragged');
    const pw = (i) => pg.evaluate((i) => Math.round(document.querySelectorAll('#panes .pane:not(.add)')[i].getBoundingClientRect().width), i);
    const w0 = await pw(2);
    await pg.locator('#panes .pane:not(.add) >> nth=2 >> .rz').scrollIntoViewIfNeeded();
    const hb = await pg.locator('#panes .pane:not(.add) >> nth=2 >> .rz').boundingBox();
    await pg.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await pg.mouse.down();
    await pg.mouse.move(hb.x + hb.width / 2 + 160, hb.y + hb.height / 2, { steps: 6 }); await pg.mouse.up(); await pg.waitForTimeout(120);
    const w1 = await pw(2);
    ok('dragging the edge widens the table by the distance dragged', Math.abs(w1 - (w0 + 160)) <= 4, [w0, w1]);
    const sw = await pg.evaluate(() => JSON.parse(localStorage.getItem('fcc-bd-layout')).panes[2].w);
    ok('…and the width is kept with this device\'s layout', Math.abs(sw - w1) <= 2, [sw, w1]);
    await pg.focus('#panes .pane:not(.add) >> nth=2 >> .rz'); await pg.keyboard.press('ArrowLeft'); await pg.waitForTimeout(80);
    ok('← steps it 20px narrower', Math.abs((await pw(2)) - (w1 - 20)) <= 2, await pw(2));
    await pg.reload(); await ready(pg); await pg.waitForTimeout(150);
    ok('the dragged width survives a reload', Math.abs((await pw(2)) - (w1 - 20)) <= 2, await pw(2));
    await pg.locator('#panes .pane:not(.add) >> nth=2 >> .rz').scrollIntoViewIfNeeded();
    await pg.dblclick('#panes .pane:not(.add) >> nth=2 >> .rz'); await pg.waitForTimeout(100);
    const back = await pg.evaluate(() => ({ w: JSON.parse(localStorage.getItem('fcc-bd-layout')).panes[2].w, sized: document.querySelectorAll('#panes .pane:not(.add)')[2].classList.contains('sized') }));
    ok('double-click gives the table its own width back', back.w === undefined && !back.sized, back);

    console.log('· Styles counts each item group once');
    await pg.click('#unit [data-u="group"]'); await pg.waitForTimeout(120);
    const tot = await pg.evaluate(() => document.querySelectorAll('#panes .pane:not(.add)')[1].querySelector('.pm').textContent);
    ok('a pane totals the item groups, not the products', tot.indexOf(GROUPS + ' styles') >= 0, [tot, GROUPS]);
    await pg.click('#unit [data-u="sku"]');

    console.log('· ⤓ CSV');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#panes .pane:not(.add) >> nth=1 >> [data-csv]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok('a pane downloads every row it holds, with what was read', csv.split(/\r\n/).filter((l) => /^color,/.test(l)).length === Object.keys(COLOR).length && /Read,every product/.test(csv), csv.slice(0, 300));

    console.log('· folds');
    const fold = () => pg.evaluate(() => Array.from(document.querySelectorAll('section.fs')).map((c) => c.id + ':' + (c.classList.contains('folded') ? 0 : 1)).join(' '));
    ok('a fresh device opens Breakdown and Pivot, the catalogue and the method folded', (await fold()) === 'sec-panes:1 sec-pivot:1 sec-fields:0 sec-how:0', await fold());
    ok('…a folded body is not painted', await pg.evaluate(() => document.querySelector('#fd').getBoundingClientRect().height === 0));
    ok('…a folded head still says what is inside', /fields carry a value/.test(await pg.textContent('#ln-fields')));
    await pg.click('#sec-pivot .fhd');
    ok('a click on the head folds it', (await fold()).indexOf('sec-pivot:0') >= 0);
    await pg.click('#openall');
    ok('⊕ Open all opens every section', (await fold()) === 'sec-panes:1 sec-pivot:1 sec-fields:1 sec-how:1');
    await pg.click('#sec-how .fhd');

    console.log('· 📖 Guidebook');
    const gbVis = () => pg.evaluate(() => { const g = document.getElementById('gb'); const r = g.getBoundingClientRect(); return { open: !g.hidden && r.height > 0, pin: g.classList.contains('pin'), n: g.querySelectorAll('.gr').length, tries: g.querySelectorAll('[data-gb]').length, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1, exp: document.getElementById('gbtn').getAttribute('aria-expanded') }; });
    await pg.evaluate(() => scrollTo(0, 0));
    ok('the guidebook is not painted at rest', !(await gbVis()).open);
    const fab = await pg.evaluate(() => { const r = document.getElementById('gbtn').getBoundingClientRect(); return { r: innerWidth - r.right, b: innerHeight - r.bottom, pos: getComputedStyle(document.getElementById('gbw')).position, inHero: !!document.querySelector('.hero #gbtn'), chat: !!document.getElementById('fcc-fcb') }; });
    ok('📖 Guidebook sits in the bottom-right corner (the one the Feed Chat bubble held), not in the hero', fab.pos === 'fixed' && fab.r >= 0 && fab.r <= 30 && fab.b >= 0 && fab.b <= 30 && !fab.inHero, fab);
    ok('…and no Feed Chat bubble is on the page', !fab.chat, fab);
    await pg.hover('#gbtn'); await pg.waitForTimeout(250);
    let g = await gbVis();
    ok('hovering 📖 Guidebook opens it', g.open && g.exp === 'true', g);
    ok('…every recipe is in it, each but the habits with a ▶ Try it', g.n === 15 && g.tries >= 13, g);
    ok('…and it fits the window', g.inView, g);
    await pg.mouse.move(5, 700); await pg.waitForTimeout(400);
    ok('moving away closes it', !(await gbVis()).open);
    await pg.click('#gbtn'); await pg.mouse.move(5, 700); await pg.waitForTimeout(400);
    g = await gbVis();
    ok('a click pins it — moving away leaves it open', g.open && g.pin, g);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(50);
    ok('Esc closes it', !(await gbVis()).open);
    await pg.click('#gbtn');
    await pg.click('#gb [data-gb="0.0"]'); await pg.waitForTimeout(150);
    const gpv = await pg.evaluate(() => { const P = window.__FCCBreakdown.state().L.pivot; return { r: P.r, c: P.c, gb: document.getElementById('gb').hidden, fold: document.getElementById('sec-pivot').classList.contains('folded') }; });
    ok('▶ Try it sets the pivot — price bands × product type tier 1', gpv.r && gpv.r.f === 'g:price' && gpv.r.m === 'num' && gpv.c && gpv.c.f === 'g:product_type' && gpv.c.m === 'tier' && gpv.c.k === 1, gpv);
    ok('…closes the guidebook and opens the pivot', gpv.gb && !gpv.fold, gpv);
    // the field with MORE values goes on the rows (Ray, 16 Oct 2026): the recipe is written custom_label_0 × product
    // type, but on this feed the label carries 2 values and tier 1 of the type 3 — so the type runs down the page.
    // Counted here independently of the page, off the engine on the same store.
    await pg.click('#gbtn'); await pg.click('#gb [data-gb="0.1"]'); await pg.waitForTimeout(150);
    const gpt = await pg.evaluate(() => {
      const st = window.__FCCBreakdown.state(), B = window.FeedBreakdown, P = st.L.pivot;
      const n = (f, m, k) => B.pivot(st.st, B.resolve(st.st, { f, m, k: k || 0 }), null, { unit: 'sku' }).rows.length;
      return { r: P.r, c: P.c, nl: n('g:custom_label_0', 'raw'), np: n('g:product_type', 'tier', 1), toast: (document.querySelector('.toast, #toast') || {}).textContent || '' };
    });
    ok('▶ Try it on custom label 0 × category turns the pivot — the type carries more values, so it runs down the page', gpt.np > gpt.nl && gpt.r && gpt.r.f === 'g:product_type' && gpt.r.m === 'tier' && gpt.c && gpt.c.f === 'g:custom_label_0', gpt);
    ok('…and the toast says so, with both counts', /rows and columns turned/.test(gpt.toast) && gpt.toast.indexOf(gpt.np + ' against ' + gpt.nl) >= 0, gpt.toast);
    await pg.click('#gbtn');
    await pg.click('#gb [data-gb="2.2"]'); await pg.waitForTimeout(150);
    const miss = await pg.evaluate(() => ({ r: window.__FCCBreakdown.state().L.pivot.r, t: document.getElementById('toast').textContent }));
    ok('a field the feed does not carry is named, the pivot left as it was', miss.r.f === gpt.r.f && miss.r.k === gpt.r.k && /does not carry material/.test(miss.t), miss);
    await pg.keyboard.press('Escape');

    console.log('· saved view, reload, another market');
    await pg.click('#vsave'); await pg.waitForTimeout(100);
    await pg.reload(); await ready(pg); await pg.waitForTimeout(150);
    const after = await pg.evaluate(() => ({ panes: window.__FCCBreakdown.state().L.panes.map((p) => p.f), fold: Array.from(document.querySelectorAll('section.fs')).map((c) => c.classList.contains('folded') ? 0 : 1).join('') }));
    ok('the fields survive a reload', after.panes.join() === 'g:product_type,g:color,g:brand,g:availability,g:product_highlight*', after.panes);
    ok('…and so does every fold the person set', after.fold === '1110', after.fold);
    await pg.click('#mkts [data-mkt="gb-fb"]'); await ready(pg);
    const meta2 = await pg.evaluate(() => ({ reads: window.__bdReads, panes: window.__FCCBreakdown.state().L.panes.length, view: document.querySelector('#views').textContent }));
    ok('the Meta market reads its own feed, and the fields come with it', /market=gb-fb$/.test(meta2.reads[meta2.reads.length - 1]) && meta2.panes === 5, meta2);
    ok('the saved view is listed', /Merch view/.test(meta2.view), meta2.view);
    await pg.goto('file://' + tmp + '#sec-how'); await ready(pg);
    ok('a #hash opens the section it names', (await fold()).indexOf('sec-how:1') >= 0, await fold());
    ok('no console error', errs.length === 0, errs);
    await ctx.close();

    console.log('· 390px — as served');
    const ph = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    const pp = await ph.newPage(); const perr = [];
    pp.on('pageerror', (e) => perr.push(e.message));
    await pp.addInitScript(STUB);
    await pp.goto('file://' + tmpS); await ready(pp); await pp.waitForTimeout(300);
    const w = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, cols: getComputedStyle(document.getElementById('panes')).gridTemplateColumns.split(' ').length }));
    ok('nothing scrolls sideways at 390px', w.sw <= w.iw + 1, w);
    ok('…the panes stack one a row', w.cols === 1, w);
    const pfab = await pp.evaluate(() => { const r = document.getElementById('gbtn').getBoundingClientRect(), bar = document.getElementById('tb-modules'); const br = bar ? bar.getBoundingClientRect() : null; return { b: r.bottom, barTop: br && getComputedStyle(bar).position === 'fixed' ? br.top : innerHeight, r: innerWidth - r.right }; });
    ok('…the guidebook button rides above the phone bar, in the corner', pfab.b <= pfab.barTop + 1 && pfab.r <= 30, pfab);
    const shipOv = await pp.evaluate(() => { const h = document.getElementById('fcc-ship-h'); if (!h) return false; const a = h.getBoundingClientRect(), g = document.getElementById('gbtn').getBoundingClientRect(); return !(a.bottom <= g.top || g.bottom <= a.top || a.right <= g.left || g.right <= a.left); });
    ok('…and clear of the Shipped panel handle that shares that corner on a phone', !shipOv);
    await pp.tap('#gbtn'); await pp.waitForTimeout(150);
    const sh = await pp.evaluate(() => { const r = document.getElementById('gb').getBoundingClientRect(); return { open: !document.getElementById('gb').hidden, l: r.left, rr: r.right, b: r.bottom, iw: innerWidth, ih: innerHeight }; });
    ok('…the guidebook opens as a bottom sheet on a tap', sh.open && sh.l <= 1 && sh.rr >= sh.iw - 1 && Math.abs(sh.b - sh.ih) <= 2, sh);
    ok('…no page error on the phone', perr.length === 0, perr);
    await ph.close();
  } finally { await b.close(); }
  console.log('\n' + (fail ? '✗' : '✓') + ' Field breakdown: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
