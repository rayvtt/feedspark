#!/usr/bin/env node
/*
 * tools/check_catalog.js — THE CATALOGUE, DRIVEN AS AN AM DRIVES IT.
 *
 * Ray, 28 Sep 2026: "when you hover over an image or product, you should have access to what we call
 * a master feed source … I want a smooth transition of (before and after) … it should clearly show
 * which field existed vs. didn't, which field is structured vs. didn't, which field is enriched vs
 * didn't".
 *
 * tools/test_catalog.mjs pins the engine and the worker. THIS pins the half only a browser can see,
 * on the REAL page with the synthetic Northwind set from tools/catalog_stub.js:
 *   · the feed streams, the master file joins on the column the DATA says (fs_data_original_id → id),
 *     master-only products land in "Not in feed";
 *   · a REAL hover opens the inspector, docked beside the table (never over it), inside the viewport;
 *   · the pointer guard (the /stock lesson): scrolling a row under a still cursor must NOT move the
 *     inspector — Chromium reports that as a mousemove at the same coordinates;
 *   · the four-stage scrubber shows the master's title at stage 1 and FeedSpark's at stage 4, and the
 *     title row opens onto a word diff;
 *   · Google Ads: a category is placed on its FULL path only — a re-typed product says "not in the
 *     ROAS tree yet" and borrows no ancestor's figure; product age is the STYLE's (a variant born 3
 *     days ago in a 26-day-old group reads New, not Brand new); a cut FeedHero reads as empty is named;
 *   · the chart facets, the search grammar and the lineage matrix list exactly the products an
 *     independent count (the engine run here in node) says they should;
 *   · at 390px the inspector is a bottom sheet inside the screen.
 * Run: node tools/check_catalog.js        (in presync; CI has no browsers)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright not installed — catalogue check skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const STUBS = require('./catalog_stub.js');
const E = require('../docs/catalog_engine.js');
const FA = require('../docs/feedlab_engine.js');
const PAGE = fs.readFileSync(path.join(D, 'FeedSpark_Catalog.html'), 'utf8');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const HTML = PAGE.split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
// the phone pass meets the page AS SERVED: the worker injects these layers (the phone bottom bar, the
// skim view …), and without them a 390px topbar is the old 600px icon column sitting over the table
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html', 'lang_widget.html', 'hours_widget.html', 'shipped_widget.html', 'mobile_widget.html', 'digest_widget.html', 'migration_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const SERVED = HTML + '\n' + WIDGETS;
const STUB = `window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
${STUBS.stubLines()}
 return j({ok:false,error:'stub'},404);};`;

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };

// ---- the independent count: the same synthetic feed + master, through the engine, in node -----------------------
const DATA = STUBS.build();
const prods = [];
{
  let hdr = null, pl = null, n = 0;
  const P = FA.createXmlParser((row, h) => { if (!hdr) { hdr = h || row; pl = E.outPlan(hdr); n = hdr.length; return; } if (h && h.length !== n) { pl = E.outPlan(h); n = h.length; } prods.push(E.outRow(pl, row)); });
  P.push(DATA.xml); P.end();
}
const AT = DATA.market.updated;
const fx = prods.map((p) => E.facts(p, AT)), gm = E.groupBirth(fx);
const want = {
  n: prods.length,
  age: (b) => prods.filter((p, i) => E.ageBucket(E.birthOf(fx[i], gm), AT) === b).length,
  treeHas: (pt) => { let hit = false; (function walk(ns) { (ns || []).forEach((nd) => { if (E.pathKey(nd.path) === E.pathKey(pt)) hit = true; walk(nd.kids); }); })(DATA.market.tree); return hit; },
};
const roasTxt = (v) => Math.round(v).toLocaleString('en-GB') + '%';
const nodeOf = (pt) => { let o = null; (function walk(ns) { (ns || []).forEach((nd) => { if (E.pathKey(nd.path) === E.pathKey(pt)) o = nd; walk(nd.kids); }); })(DATA.market.tree); return o; };

(async () => {
  const tmp = path.join(os.tmpdir(), '_catcheck_FeedSpark_Catalog.html'); fs.writeFileSync(tmp, HTML);
  const tmpS = path.join(os.tmpdir(), '_catcheck_served_FeedSpark_Catalog.html'); fs.writeFileSync(tmpS, SERVED);
  const b = await chromium.launch({ headless: true });
  try {
    // ---------------------------------------------------------------- desktop
    console.log('· 1440px — load, join, the table');
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await pg.addInitScript(STUB);
    await pg.goto('file://' + tmp);
    await pg.waitForFunction(() => window.__FCCCatalogue && window.__FCCCatalogue.state().linDone, null, { timeout: 30000 });
    await pg.waitForTimeout(400);
    const st = await pg.evaluate(() => { const S = window.__FCCCatalogue.state(); return { n: S.prods.length, by: S.m.by.size, light: S.m.light.length, join: S.m.join, field: S.roas.field, miss: S.roas.miss, rows: document.querySelectorAll('#vr .tr.row').length }; });
    ok('the feed streamed every product', st.n === want.n, st.n);
    ok('the master joined on the column the data says: g:id ↔ fs_data_original_id → master `id`, not the parent product_id', st.by === want.n && st.join && st.join.h === 'id' && st.join.on === 'fs_data_original_id', st.join);
    ok('master-only products are counted for "Not in feed" (incl. the out-of-stock sizes the feed leaves out)', st.light === 4 + STUBS.HELD.length, st.light);
    ok('the table draws rows', st.rows > 0 && st.rows <= want.n, st.rows);
    const reTyped = prods.filter((p) => p.f.product_type && !want.treeHas(p.f.product_type)).length;
    ok('categories read on product_type; a re-typed product is counted as NOT in the ROAS tree (no ancestor stands in)', st.field === 'product_type' && st.miss === reTyped && reTyped > 0, { field: st.field, miss: st.miss, reTyped });
    const cell = await pg.evaluate(() => { const r = document.querySelector('#vr .tr.row[data-i="0"] .rb b'); return r ? r.textContent : null; });
    const n0 = nodeOf(prods[0].f.product_type);
    ok('the ROAS cell is the product\'s OWN category row (full path)', n0 && cell === roasTxt(n0.row.roasPct), { cell, want: n0 && roasTxt(n0.row.roasPct) });

    console.log('· the inspector — a real hover, docked, and the pointer guard');
    await pg.evaluate(() => document.getElementById('cat').scrollIntoView()); await pg.waitForTimeout(250);
    const r0 = await pg.locator('#vr .tr.row[data-i="0"]').boundingBox();
    await pg.mouse.move(r0.x + 380, r0.y + r0.height / 2); await pg.mouse.move(r0.x + 390, r0.y + r0.height / 2 + 1);
    await pg.waitForTimeout(700);
    const ins = await pg.evaluate(() => { const p = document.getElementById('insp'), r = p.getBoundingClientRect(), c = document.getElementById('cat').getBoundingClientRect(); return { on: p.classList.contains('on'), i: window.__FCCCatalogue.state().insp && window.__FCCCatalogue.state().insp.i, l: r.left, r: r.right, t: r.top, b: r.bottom, cr: c.right, W: innerWidth, H: innerHeight, ey: (document.querySelector('#ih .ey') || {}).textContent || '' }; });
    ok('a dwell on a row opens the inspector on THAT product', ins.on && ins.i === 0 && ins.ey.indexOf(prods[0].id) >= 0, ins);
    ok('the inspector sits inside the viewport', ins.l >= 0 && ins.r <= ins.W + 1 && ins.t >= 0, ins);
    ok('it is docked beside the table, never over it (the page is pushed)', ins.on && ins.cr <= ins.l + 1, { cat: ins.cr, insp: ins.l });
    // scroll the grid under the still cursor: Chromium sends a mousemove at the SAME coordinates
    await pg.mouse.wheel(0, 260); await pg.waitForTimeout(300);
    // …and Firefox reports it as a mousemove AT THE SAME COORDINATES (Gecko's synthetic move after a
    // scroll) — the event the guard exists for, so it is sent here exactly as Gecko would send it
    await pg.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); el && el.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true })); }, [r0.x + 390, r0.y + r0.height / 2 + 1]);
    await pg.waitForTimeout(600);
    const still = await pg.evaluate(() => window.__FCCCatalogue.state().insp.i);
    ok('scrolling a different row under a still cursor does NOT move the inspector (the /stock lesson)', still === 0, still);
    // the row is brought on screen FIRST (the dashboard above can push it below the fold) — the move that follows is the real one
    await pg.locator('#vr .tr.row').nth(3).scrollIntoViewIfNeeded(); await pg.waitForTimeout(250);
    const r3 = await pg.locator('#vr .tr.row').nth(3).boundingBox();
    const i3 = await pg.locator('#vr .tr.row').nth(3).getAttribute('data-i');
    await pg.mouse.move(r3.x + 380, r3.y + r3.height / 2); await pg.mouse.move(r3.x + 392, r3.y + r3.height / 2 + 1);
    await pg.waitForTimeout(500);
    const moved = await pg.evaluate(() => window.__FCCCatalogue.state().insp.i);
    ok('real movement onto another row follows it', String(moved) === String(i3), { moved, i3 });

    console.log('· before → after — the four stages and the word diff');
    await pg.evaluate(() => { window.__FCCCatalogue.state().pin = true; });
    await pg.click('#vr .tr.row[data-i="0"]'); await pg.waitForTimeout(250);
    const stages = await pg.locator('#i-stage [data-st]').count();
    await pg.click('#i-stage [data-st="0"]'); await pg.waitForTimeout(150);
    const tMaster = await pg.evaluate(() => (document.querySelector('.fr[data-k="title"] .fv') || {}).textContent);
    await pg.click('#i-stage [data-st="3"]'); await pg.waitForTimeout(150);
    const tFeed = await pg.evaluate(() => (document.querySelector('.fr[data-k="title"] .fv') || {}).textContent);
    ok('four stages: Master · Populated · Optimised · Enriched', stages === 4, stages);
    ok('stage 1 shows the title the client sent, stage 4 the one FeedSpark sends', tMaster === prods[0].otitle && tFeed === E.plain(prods[0].f.title), { tMaster, tFeed });
    await pg.click('.fr[data-k="title"]'); await pg.waitForTimeout(200);
    const diff = await pg.evaluate(() => { const x = document.querySelector('.fr[data-k="title"].x'); const d = document.querySelector('.fx'); return { open: !!x, ins: d ? d.querySelectorAll('ins').length : 0, del: d ? d.querySelectorAll('del').length : 0 }; });
    ok('the title row opens onto a word diff (added and removed words marked)', diff.open && diff.ins > 0 && diff.del > 0, diff);

    console.log('· Google Ads — where this product sits');
    await pg.waitForFunction(() => { const el = document.getElementById('i-roas'); return el && el.textContent.indexOf('Reading') < 0 && el.querySelector('.rs'); }, null, { timeout: 10000 }).catch(() => {});
    const roas0 = await pg.evaluate(() => Array.from(document.querySelectorAll('#i-roas .rs .l')).map((l) => [(l.querySelector('small') || {}).textContent, (l.querySelector('span') || {}).textContent]));
    const age0 = (roas0.find((r) => r[0] === 'product age') || [])[1];
    const own0 = E.ageBucket(fx[0].dob, AT), grp0 = E.ageBucket(E.birthOf(fx[0], gm), AT);
    ok('product age is the STYLE\'s: this variant is ' + own0 + ' on its own date, its group is ' + grp0, age0 === grp0 && own0 !== grp0, { age0, own0, grp0 });
    ok('its category reads level by level on the full path', roas0.filter((r) => /^Category · level/.test(r[0])).length === prods[0].f.product_type.split(' > ').length, roas0);
    const miss = prods.findIndex((p) => !want.treeHas(p.f.product_type) && p.f.custom_label_1);
    // walk to it by keyboard from the first row of the view (↓ inspects the next product)
    const first = await pg.evaluate(() => window.__FCCCatalogue.state().view[0]);
    await pg.click('#vr .tr.row[data-i="' + first + '"]');
    const target = await pg.evaluate((id) => { const S = window.__FCCCatalogue.state(); return S.view.indexOf(S.prods.findIndex((p) => p.id === id)); }, prods[miss].id);
    for (let k = 0; k < target; k++) await pg.keyboard.press('ArrowDown');
    await pg.waitForTimeout(400);
    await pg.waitForFunction(() => { const el = document.getElementById('i-roas'); return el && el.textContent.indexOf('Reading') < 0; }, null, { timeout: 10000 }).catch(() => {});
    const r7 = await pg.evaluate(() => ({ i: window.__FCCCatalogue.state().insp.i, txt: document.getElementById('i-roas').textContent, lv: Array.from(document.querySelectorAll('#i-roas .rs .l small')).filter((s) => /^Category/.test(s.textContent)).length }));
    ok('a re-typed product says "not in the ROAS tree yet" and shows NO category figure', r7.txt.indexOf('not in the ROAS tree yet') >= 0 && r7.lv === 0, r7);
    ok('a cut FeedHero reads as empty is named, never placed ("custom label 1")', /Not read by FeedHero’s ROAS here: [^·]*custom label 1/.test(r7.txt), r7.txt.slice(0, 300));
    ok('segment ROAS is labelled as the segment\'s, never the product\'s', r7.txt.indexOf('never this product’s own') >= 0);
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(350);
    ok('Esc closes the inspector', await pg.evaluate(() => !document.getElementById('insp').classList.contains('on')));

    console.log('· facets, search and the matrix list exactly what an independent count says');
    const view = () => pg.evaluate(() => window.__FCCCatalogue.state().view.length);
    await pg.selectOption('#roas-agg', 'Product_age'); await pg.waitForTimeout(500);
    const bucket = E.AGE_BUCKETS.find((x) => want.age(x) > 0 && want.age(x) < want.n);
    await pg.evaluate((k) => { const el = Array.from(document.querySelectorAll('#roas-body [data-k]')).find((e) => e.getAttribute('data-k') === k); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, bucket);
    await pg.waitForTimeout(300);
    ok('ROAS by product age → "' + bucket + '" lists the products the group rule places there', await view() === want.age(bucket), { page: await view(), want: want.age(bucket) });
    await pg.evaluate(() => { const b = document.querySelector('#facet button'); b && b.click(); }); await pg.waitForTimeout(200);
    await pg.selectOption('#roas-agg', 'Category'); await pg.waitForTimeout(400);
    // the branch that still holds the left-out path's ancestor: exact placement lists only exact paths
    const top = STUBS.DROPPED.split(' > ')[0];
    await pg.evaluate((k) => { const el = Array.from(document.querySelectorAll('#roas-body [data-k]')).find((e) => e.getAttribute('data-k') === k); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, top);
    await pg.waitForTimeout(300);
    const wantTop = prods.filter((p) => want.treeHas(p.f.product_type) && (E.pathKey(p.f.product_type) + ' >').indexOf(E.pathKey(top) + ' >') === 0).length;
    ok('ROAS by category → "' + top + '" lists its products on their exact paths only', await view() === wantTop && wantTop > 0, { page: await view(), want: wantTop });
    await pg.evaluate(() => { const b = document.querySelector('#facet button'); b && b.click(); }); await pg.waitForTimeout(200);
    await pg.selectOption('#roas-agg', 'Custom_label_1'); await pg.waitForTimeout(400);
    const cl1 = await pg.evaluate(() => document.getElementById('roas-body').textContent);
    ok('a cut FeedHero reads as empty says so on the chart', cl1.indexOf('FeedHero reads this column as empty') >= 0, cl1.slice(0, 200));

    console.log('· price band — FeedHero\'s Price group, in price order, placed on the price the data says');
    await pg.selectOption('#roas-agg', 'Price_group'); await pg.waitForTimeout(450);
    const pbc = await pg.evaluate(() => { const seen = []; document.querySelectorAll('#roas-body [data-k]').forEach((e) => { const k = e.getAttribute('data-k'); if (seen.indexOf(k) < 0) seen.push(k); }); const S = window.__FCCCatalogue.state(); return { labs: seen, lbl: document.getElementById('roas-lbl').textContent, basis: S.roas.pg && S.roas.pg.basis, foot: (document.querySelector('#roas-body .cfoot') || {}).textContent || '' }; });
    const PBN = E.priceGroupBands(DATA.live.Price_group.rows), basisN = E.priceGroupBasis(PBN, fx);
    ok('"price band" is on the list and draws FeedHero\'s bands in PRICE order', pbc.lbl === 'price band' && pbc.labs.join('|') === '£0 - £25|£25 - £50|£50 - £75|£75+', pbc);
    ok('the price it bands on is the one an independent read of the data picks (' + basisN + '), and the card says which', pbc.basis === basisN && /placed on the (list price|price the shopper pays)/.test(pbc.foot), pbc);
    const band = '£25 - £50';
    await pg.evaluate((k) => { const el = Array.from(document.querySelectorAll('#roas-body [data-k]')).find((e) => e.getAttribute('data-k') === k); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, band);
    await pg.waitForTimeout(300);
    const wantBand = prods.filter((p, i) => E.priceGroupOf(PBN, basisN === 'price' ? fx[i].price : (fx[i].onSale ? fx[i].sale : fx[i].price)) === band).length;
    ok('ROAS by price band → "' + band + '" lists exactly the products priced in it', await view() === wantBand && wantBand > 0, { page: await view(), want: wantBand });
    await pg.evaluate(() => { const b = document.querySelector('#facet button'); b && b.click(); }); await pg.waitForTimeout(200);
    await pg.fill('#q', 'colour:navy,black -avail:out'); await pg.waitForTimeout(450);
    const wantQ = prods.filter((p, i) => /navy|black/i.test(p.f.color || '') && fx[i].av !== 'out_of_stock').length;
    ok('search grammar: a comma list OR-s, a minus excludes', await view() === wantQ && wantQ > 0, { page: await view(), want: wantQ });
    await pg.fill('#q', ''); await pg.waitForTimeout(300);
    await pg.click('#tabs [data-tab="gone"]'); await pg.waitForTimeout(300);
    ok('"Not in feed" lists the master-only products', await view() === 4 + STUBS.HELD.length && (await pg.evaluate(() => [...document.querySelectorAll('#vr .tr.row')].map((r) => r.textContent).join('|'))).indexOf('M-OLD-') >= 0
      && (await pg.evaluate(() => [...document.querySelectorAll('#vr .tr.row')].map((r) => r.textContent).join('|'))).indexOf('M-NW100-S') >= 0);
    await pg.click('#tabs [data-tab="all"]'); await pg.waitForTimeout(300);
    const seg = await pg.evaluate(() => { const i = window.__FCCCatalogue.state(); const el = document.querySelector('#lm-body i[data-c="s"][title^="Sale price"]'); if (!el) return null; const n = +(/· ([\d,]+) products/.exec(el.getAttribute('title')) || [0, '0'])[1].replace(/,/g, ''); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return n; });
    await pg.waitForTimeout(300);
    const wantSale = prods.filter((p, i) => fx[i].onSale).length;
    ok('the matrix: "Sale price · structured" lists every sale the master stated under another column', seg === wantSale && await view() === wantSale, { seg, page: await view(), want: wantSale });

    console.log('· the dashboard — twenty modules of one size (Product type depth two wide) and Image pixels across the row, evenly spaced, each one a filter');
    await pg.evaluate(() => { const S = window.__FCCCatalogue.state(); if (S.facet) document.querySelector('#facet button').click(); });
    await pg.waitForTimeout(250);
    const grid = await pg.evaluate(() => {
      const ms = Array.from(document.querySelectorAll('#ins > .mod')).filter((m) => !m.hidden).map((m) => { const r = m.getBoundingClientRect(); return { id: m.dataset.mod, t: Math.round(r.top), h: Math.round(r.height), l: Math.round(r.left), w: Math.round(r.width) }; });
      const rows = {}; ms.forEach((m) => { (rows[m.t] = rows[m.t] || []).push(m); });
      const k = document.querySelectorAll('#kpis .kpi'), kh = new Set(Array.from(k).map((x) => Math.round(x.getBoundingClientRect().height))), kt = new Set(Array.from(k).map((x) => Math.round(x.getBoundingClientRect().top)));
      const one = ms.filter((m) => m.id !== 'pix' && m.id !== 'ptd'), px = ms.filter((m) => m.id === 'pix')[0] || null, ins = document.getElementById('ins').getBoundingClientRect();
      return { n: ms.length, hs: new Set(ms.map((m) => m.h)).size, ws: new Set(one.map((m) => m.w)).size, rows: Object.values(rows).map((r) => r.length), kpis: k.length, kh: kh.size, kt: kt.size,
        px: px && { w: px.w, full: Math.abs(px.w - Math.round(ins.width)) <= 2 },
        ptd2: (function () { const p = ms.filter((m) => m.id === 'ptd')[0], o = one[0]; return !!(p && o && p.w > o.w * 2); })() };
    });
    ok('twenty-one modules, every one the same height; the nineteen single cards one width', grid.n === 21 && grid.hs === 1 && grid.ws === 1, grid);
    ok('Image pixels spans the whole row', grid.px && grid.px.full, grid.px);
    ok('three to a row at 1440px — seven full rows (Product type depth two wide beside one card) and the Image pixels row, no hole',
      grid.rows.length === 8 && grid.rows.filter((r) => r === 3).length === 6 && grid.rows.filter((r) => r === 2).length === 1 && grid.rows.filter((r) => r === 1).length === 1 && grid.ptd2, grid.rows);
    ok('the KPI band is one row of equal tiles', grid.kpis === 7 && grid.kh === 1 && grid.kt === 1, grid);
    // CUSTOM LABELS + PRODUCT TYPE DEPTH (Ray, 8 Oct 2026: "add custom label values overview in the customisable module in golden
    // record report as well" · "product type breakdown as well especially the depth table as modularised component") — read
    // against counts made here, off the same synthetic feed through the engine in node
    const plainV = (v) => String(Array.isArray(v) ? v[0] : (v == null ? '' : v)).trim();
    const clN = (k, val) => prods.filter((p) => plainV(p.f['custom_label_' + k]).toLowerCase() === val.toLowerCase()).length;
    const clCard = await pg.evaluate(() => Array.from(document.querySelectorAll('#cl-body .cl-r')).map((r) => ({ h: r.querySelector('.cl-h').textContent.replace(/\s+/g, ' ').trim(), segs: r.querySelectorAll('.cl-bar i:not(.rest)').length })));
    const cl1Pct = Math.round(clN(1, 'Clearance') / prods.length * 100);
    ok('Custom labels: all five labels, each with its share carrying one and how many values — an absent label says so', clCard.length === 5 &&
      /^CL0 ?100% carry one · 2 values$/.test(clCard[0].h) && clCard[0].segs === 2 && new RegExp('^CL1 ?' + cl1Pct + '% carry one · 1 value$').test(clCard[1].h) &&
      clCard.slice(2).every((c) => /^CL[2-4] ?not in the feed$/.test(c.h) && c.segs === 0), { clCard, cl1Pct });
    await pg.evaluate(() => { const el = document.querySelector('#cl-body [data-f="mix:custom_label_0:new in"]'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await pg.waitForTimeout(300);
    ok('…a value\'s segment lists exactly its products', await view() === clN(0, 'New In') && clN(0, 'New In') > 0, { page: await view(), want: clN(0, 'New In') });
    await pg.evaluate(() => { const S = window.__FCCCatalogue.state(); if (S.facet) document.querySelector('#facet button').click(); });
    await pg.waitForTimeout(250);
    const ptOf = (p) => plainV(p.f.product_type), ptDep = (p) => { const v = ptOf(p); if (!v) return 'none'; let a = v.split(/\s*(?:>|›|»)\s*/).filter(Boolean); if (a.length < 2 && v.indexOf('/') >= 0) a = v.split(/\s*\/\s*/).filter(Boolean); const n = a.length || 1; return n >= 6 ? '6+' : String(n); };
    const dW = {}; prods.forEach((p) => { const b = ptDep(p); dW[b] = (dW[b] || 0) + 1; });
    const ptd = await pg.evaluate(() => ({ rows: Array.from(document.querySelectorAll('#ptd-body .pr')).map((r) => [r.getAttribute('data-f'), parseFloat(r.querySelector('.pv').textContent)]),
      hi: Array.from(document.querySelectorAll('#ptd-body .pr.hi')).map((r) => r.getAttribute('data-f')), paths: Array.from(document.querySelectorAll('#ptd-body .pp')).map((r) => [r.getAttribute('data-f'), r.querySelector('.pc').textContent]),
      foot: document.querySelector('#ptd-body .ptd-f:last-child').textContent, wide: document.getElementById('m-ptd').getBoundingClientRect().width }));
    ok('Product type depth: 1 … 6+ levels in Product Type Guard\'s rows (3–5 emphasised), each share matching a count made here, with the 5-level standard named',
      ptd.rows.map((r) => r[0]).join() === 'ptd:1,ptd:2,ptd:3,ptd:4,ptd:5,ptd:6+' && ptd.hi.join() === 'ptd:3,ptd:4,ptd:5' &&
      ptd.rows.every((r) => Math.abs(r[1] - Math.round((dW[r[0].slice(4)] || 0) / prods.length * 1000) / 10) < 0.06) && /industry standard is 30–40%/.test(ptd.foot), { ptd, dW });
    const bigB = Object.keys(dW).filter((b) => b !== 'none').sort((a, b) => dW[b] - dW[a])[0];
    await pg.evaluate((b) => { document.querySelector('#ptd-body [data-f="ptd:' + b + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, bigB);
    await pg.waitForTimeout(300);
    ok('…a depth row lists exactly the products at that depth', await view() === dW[bigB], { page: await view(), want: dW[bigB], b: bigB });
    await pg.evaluate(() => { const S = window.__FCCCatalogue.state(); if (S.facet) document.querySelector('#facet button').click(); });
    await pg.waitForTimeout(250);
    const p0 = ptd.paths[0], wantP = prods.filter((p) => ptOf(p).toLowerCase() === p0[0].slice(4)).length;
    await pg.evaluate((f) => { document.querySelector('#ptd-body [data-f="' + f + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, p0[0]);
    await pg.waitForTimeout(300);
    ok('…the biggest paths list their products, and the count beside each is that many', await view() === wantP && +p0[1].replace(/,/g, '') === wantP && wantP > 0, { page: await view(), want: wantP, p0 });
    await pg.evaluate(() => { const S = window.__FCCCatalogue.state(); if (S.facet) document.querySelector('#facet button').click(); });
    await pg.waitForTimeout(250);
    const pb = await pg.evaluate(() => { const el = document.querySelector('#price-body [data-k]'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); const S = window.__FCCCatalogue.state(); return { lo: S.facet && S.facet.lo, hi: S.facet && S.facet.hi, k: S.facet && S.facet.k }; });
    await pg.waitForTimeout(300);
    const wantPb = prods.filter((p, i) => { const v = fx[i].onSale ? fx[i].sale : fx[i].price; return v != null && v >= pb.lo && (pb.hi == null || v < pb.hi); }).length;
    ok('a price band lists exactly the products priced in it (what the shopper pays)', pb.k === 'price' && await view() === wantPb && wantPb > 0, { pb, page: await view(), want: wantPb });
    await pg.evaluate(() => { const el = document.querySelector('#price-body [data-k]'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await pg.waitForTimeout(250);
    ok('clicking the same band again clears it', await pg.evaluate(() => !window.__FCCCatalogue.state().facet));
    const run = await pg.evaluate(() => { const el = document.querySelector('#run-body [data-f="run:all"]'); if (!el) return null; el.click(); return document.getElementById('run-body').textContent; });
    await pg.waitForTimeout(250);
    // the run is the MASTER's: the feed's sizes plus the out-of-stock sizes it leaves out (counted here, not by the page)
    const grp = {}; fx.forEach((x) => { if (!x.grp) return; const c = grp[x.grp] || (grp[x.grp] = [0, 0]); c[0]++; if (x.av === 'in_stock') c[1]++; });
    STUBS.HELD.forEach((g) => { grp[g][0]++; });
    const wantRun = fx.filter((x) => x.grp && grp[x.grp][0] >= 2 && grp[x.grp][1] === grp[x.grp][0]).length;
    ok('size-run health lists the products whose whole run is in stock', run != null && await view() === wantRun, { page: await view(), want: wantRun });
    const heldGrps = STUBS.HELD.filter((g) => grp[g][1] === grp[g][0] - 1).length;
    ok('a group whose missing size the feed left out is NOT "all in stock" (read off the master, not the feed)',
      await pg.evaluate((H) => { const S = window.__FCCCatalogue.state(); return H.every((g) => S.run && S.run.get(g) && S.run.get(g)[1] < S.run.get(g)[0]); }, STUBS.HELD) && heldGrps > 0);
    ok('the card says the run is read off the master and names the sizes left out of the feed',
      /from the master/.test(await pg.evaluate(() => document.getElementById('run-sub').textContent)) && new RegExp(STUBS.HELD.length + '\\s*out-of-stock sizes left out of the feed').test(run), run);
    console.log('· column filters — a ▾ on a header lists the column\'s values (Ray, 30 Sep 2026)');
    await pg.evaluate(() => { const b = document.querySelector('#facet [data-fx]'); b && b.click(); }); await pg.waitForTimeout(250);
    const sortBefore = await pg.evaluate(() => JSON.stringify(window.__FCCCatalogue.state().sort));
    await pg.click('#gh [data-cf="avail"]'); await pg.waitForTimeout(150);
    const avList = await pg.evaluate(() => { const p = document.getElementById('cfp'); return p.hidden ? null : [...p.querySelectorAll('.cfl label')].map((l) => [l.querySelector('span').textContent, +l.querySelector('small').textContent.replace(/,/g, '')]); });
    const AVL = { in_stock: 'In stock', out_of_stock: 'Out of stock' }, wantAv = {}; fx.forEach((x) => { const l = AVL[x.av]; wantAv[l] = (wantAv[l] || 0) + 1; });
    ok('▾ on Availability opens the list of its values, each with how many products carry it', avList && avList.length === Object.keys(wantAv).length && avList.every(([v, n]) => wantAv[v] === n), { avList, wantAv });
    ok('clicking ▾ does not sort the column', await pg.evaluate(() => JSON.stringify(window.__FCCCatalogue.state().sort)) === sortBefore);
    await pg.evaluate(() => { const c = [...document.querySelectorAll('#cfp .cfl input')].find((i) => i.getAttribute('data-cfv') === 'In stock'); c.click(); document.querySelector('#cfp [data-cfa="apply"]').click(); });
    await pg.waitForTimeout(300);
    const wantOut = fx.filter((x) => x.av === 'out_of_stock').length;
    ok('unticking "In stock" leaves exactly the out-of-stock products', await view() === wantOut && wantOut > 0, { page: await view(), want: wantOut });
    ok('the filter shows as a chip and the header ▾ is lit', await pg.evaluate(() => /Availability: Out of stock/.test(document.getElementById('facet').textContent) && document.querySelector('#gh [data-cf="avail"]').classList.contains('on')));
    // another column's list is counted from what the Availability filter leaves (the spreadsheet rule)
    await pg.click('#gh [data-cf="type"]'); await pg.waitForTimeout(150);
    const ptList = await pg.evaluate(() => [...document.querySelectorAll('#cfp .cfl label')].reduce((a, l) => a + +l.querySelector('small').textContent.replace(/,/g, ''), 0));
    ok('another column\'s value counts are read from the products the other filters leave', ptList === wantOut, { ptList, wantOut });
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
    ok('Esc closes the pop-up', await pg.evaluate(() => document.getElementById('cfp').hidden));
    await pg.evaluate(() => document.querySelector('#facet [data-cfx="avail"]').click()); await pg.waitForTimeout(250);
    ok('the chip\'s ✕ clears it', await view() === prods.length && await pg.evaluate(() => !Object.keys(window.__FCCCatalogue.state().cf).length), await view());
    // a number range
    await pg.click('#gh [data-cf="price"]'); await pg.waitForTimeout(150);
    await pg.fill('#cf-lo', '50'); await pg.fill('#cf-hi', '80'); await pg.press('#cf-hi', 'Enter'); await pg.waitForTimeout(300);
    const wantPr = fx.filter((x) => x.price != null && x.price >= 50 && x.price <= 80).length;
    ok('Price 50–80 keeps exactly the products priced in it', await view() === wantPr && wantPr > 0, { page: await view(), want: wantPr });
    // text, combined with the range
    await pg.click('#gh [data-cf="title"]'); await pg.waitForTimeout(150);
    await pg.fill('#cf-t', 'navy'); await pg.press('#cf-t', 'Enter'); await pg.waitForTimeout(300);
    const wantTx = prods.filter((p, i) => fx[i].price != null && fx[i].price >= 50 && fx[i].price <= 80 && /navy/i.test(E.plain(p.f.title))).length;
    ok('Title contains "navy" combines with the price range', await view() === wantTx, { page: await view(), want: wantTx });
    ok('two column filters offer "Clear column filters"', await pg.evaluate(() => !!document.querySelector('#facet [data-cfx="*"]')));
    await pg.evaluate(() => document.querySelector('#facet [data-cfx="*"]').click()); await pg.waitForTimeout(250);
    ok('"Clear column filters" clears them all', await view() === prods.length, await view());
    console.log('· the pixel scan — what each main image shows, read off its pixels (Ray, 6 Oct 2026)');
    {
      // the expectations, counted here off the stub's own table of what each item group's picture is
      const grpOf = (i) => String(prods[i].f.item_group_id || ''), specOf = (i) => STUBS.PIX[grpOf(i)] || STUBS.PIX_DEFAULT;
      const urls = new Set(prods.map((p) => String(p.f.image_link || '').trim()).filter(Boolean));
      const want = { req: 0, lowres: 0, colour: 0, scene: 0, tiny: 0, shared: 0, plain: 0 };
      prods.forEach((p, i) => { const s = specOf(i), g = grpOf(i);
        if (s.w < 100) want.req++; else if (s.w < 800) want.lowres++;
        if (s.bg) want.colour++; else if (s.scene) want.scene++; else want.plain++;
        if ((s.box != null && s.box < 0.5) || s.ph) want.tiny++;   // a placeholder's graphic sits small in its frame too
        if (s.ph) want.shared++; });
      await pg.evaluate(() => { const S = window.__FCCCatalogue.state(); if (S.facet) document.querySelector('#facet [data-fx]').click(); document.getElementById('pix-n').value = '3000'; });
      await pg.waitForTimeout(200);
      const before = await pg.evaluate(() => document.getElementById('pix-body').textContent);
      ok('before a scan the card says no image is read yet — never a pass', /No image read yet/.test(before), before.slice(0, 120));
      await pg.click('#pix-go');
      await pg.waitForFunction(() => { const S = window.__FCCCatalogue.state(); return S.px && !S.px.run && S.px.map.size > 0; }, null, { timeout: 30000 });
      await pg.waitForTimeout(400);
      const got = await pg.evaluate(() => { const S = window.__FCCCatalogue.state(); const out = {}; S.px.map.forEach((r, u) => { out[u] = r; }); return { n: S.px.map.size, r: out, put: (window.__pxPut || []).reduce((a, b) => a + Object.keys(b.r || {}).length, 0), gets: window.__pxGets || 0 }; });
      ok('🔍 Scan reads every distinct main image once (variants sharing a picture are read once)', got.n === urls.size && got.gets === urls.size, { got: got.n, gets: got.gets, want: urls.size });
      const i100 = prods.findIndex((p) => grpOf(prods.indexOf(p)) === 'NW100' && !/feedspark/.test(String(p.f.image_link)));
      const r100 = got.r[String(prods[i100].f.image_link).trim()];
      ok('the reading is the picture: 1200 × 1200, a white background, the product spanning 90% of the frame', r100 && r100.w === 1200 && r100.h === 1200 && r100.bg === 'white' && Math.abs(r100.fill - 90) <= 1, r100);
      const r103 = got.r[String(prods[prods.findIndex((p, i) => grpOf(i) === 'NW103')].f.image_link).trim()];
      ok('a coloured background is read as one, its colour named', r103 && r103.bg === 'colour' && /^#2e7d32$/i.test(r103.bgc), r103);
      ok('every reading is saved for the next visit (one KV write per batch, keyed by image URL)', got.put === urls.size, got.put);
      const rows = await pg.evaluate(() => { const o = {}; document.querySelectorAll('#pix-body .mlist .v').forEach((v) => { const l = v.previousElementSibling.previousElementSibling; o[l.getAttribute('data-f').slice(4)] = +String((v.querySelector('small') || {}).textContent || '0').replace(/,/g, ''); }); return o; });
      ok('each row counts the products an independent count gives — Google’s rules, under 800 px, plain, coloured, scene, under half the frame, the same picture on 3+ products',
        ['req', 'lowres', 'plain', 'colour', 'scene', 'tiny', 'shared'].every((k) => rows[k] === want[k]), { rows, want });
      await pg.evaluate(() => document.querySelector('#pix-body [data-f="pix:req"]').click());
      await pg.waitForTimeout(300);
      ok('a row is a table filter: “Below Google’s image rules” lists exactly those products', await view() === want.req && want.req > 0, { page: await view(), want: want.req });
      await pg.evaluate(() => { const b = document.querySelector('#facet [data-fx]'); b && b.click(); });
      await pg.waitForTimeout(250);
      const look = await pg.evaluate(() => Array.from(document.querySelectorAll('#pix-body .pixlook button')).map((b) => b.querySelector('b').className));
      ok('“To look at” leads with what Google refuses, then what it advises against', look.length > 0 && look[0] === 'fail', look);
      if (process.env.CAT_SHOT) { await pg.locator('#m-pix').scrollIntoViewIfNeeded(); await pg.locator('#m-pix').screenshot({ path: path.join(process.env.CAT_SHOT, 'cat_pix.png') }); }
      const i103 = prods.findIndex((p, i) => grpOf(i) === 'NW103');
      await pg.evaluate((i) => window.__FCCCatalogue.state && document.querySelector('#pix-body [data-px-open]') && (function () { const b = document.querySelector('#pix-body [data-px-open="' + i + '"]'); if (b) b.click(); })(), i103);
      await pg.waitForTimeout(500);
      const insp = await pg.evaluate(() => (document.getElementById('i-stage') || {}).textContent || '');
      ok('a tile opens its product, and the inspector reads its picture out', /Image pixels/.test(insp) && /Coloured background/.test(insp) && /1,000 × 1,000/.test(insp), insp.slice(0, 200));
      // CAT_SHOT=<dir> keeps a picture of the module and the inspector for a visual pass
      if (process.env.CAT_SHOT) { const d = pg.locator('#insp details[data-g="px"]'); await d.scrollIntoViewIfNeeded().catch(() => {}); await d.screenshot({ path: path.join(process.env.CAT_SHOT, 'cat_pix_insp.png') }).catch(() => {}); }
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
    }
    console.log('· stock control — off Stock management\'s own read of this market');
    const oosEl = await pg.evaluate(() => { const el = document.querySelector('#avail-body [data-f="avail:out_of_stock"]'); if (!el) return false; el.click(); return true; });
    await pg.waitForTimeout(250);
    const wantOos = fx.filter((x) => x.av === 'out_of_stock').length;
    ok('Availability: "Out of stock" lists exactly the products the feed calls out of stock', oosEl && await view() === wantOos && wantOos > 0, { page: await view(), want: wantOos });
    await pg.evaluate(() => { const b = document.querySelector('#facet button'); b && b.click(); }); await pg.waitForTimeout(200);
    // the coverage matrix — /stock's own table for this one market: a row per stock mechanism, the rule count in the cell,
    // "—" where the market runs none; counted here independently off the same stub data the page was served
    const wantCov = await pg.evaluate(() => { const st = window.__FCCCatalogue.state().stk; const c = {}; (st.m.stock || []).forEach((r) => { c[r.sk] = (c[r.sk] || 0) + 1; }); return { c, mechs: st.mechs.map((x) => x.k), tot: (st.m.stock || []).length }; });
    const stk = await pg.evaluate(() => ({ rows: Array.from(document.querySelectorAll('#stock-body .covt tbody tr')).map((tr) => ({ k: tr.getAttribute('data-mech'), lab: tr.querySelector('th').textContent, v: tr.querySelector('td.c').textContent, bg: getComputedStyle(tr.querySelector('td.c')).backgroundColor })), tot: (document.querySelector('#stock-body .covt tfoot td.c') || {}).textContent, href: document.getElementById('stock-to').getAttribute('href'), kept: document.getElementById('kept-body').textContent }));
    const cellsOk = stk.rows.length === wantCov.mechs.length && wantCov.mechs.every((k, i) => { const n = wantCov.c[k] || 0, r = stk.rows[i]; return n ? (r.k === k && r.v === String(n) && r.bg !== 'rgba(0, 0, 0, 0)') : (r.k === null && r.v === '—'); });
    ok('Stock control: /stock\'s coverage matrix for this market — every mechanism in /stock\'s order, the rule count shaded in its cell, — where none, the total', cellsOk && stk.tot === String(wantCov.tot) && wantCov.tot > 0 && Object.keys(wantCov.c).length >= 3, { stk, wantCov });
    ok('Stock control: linked to /stock for this market', stk.href === '/stock?brand=Northwind&market=GB', stk.href);
    await pg.evaluate(() => { const c = document.getElementById('stock-ch'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.waitForTimeout(150);
    const sp = await pg.evaluate(() => ({ cols: document.querySelectorAll('#stock-body .covt thead th').length, txt: document.querySelector('#stock-body .covt tbody td.ch') && document.querySelector('#stock-body .covt').textContent, saved: localStorage.getItem('fcc-cat-stkch') }));
    ok('Split by channel adds the channel column and is remembered on the device', sp.cols === 3 && /every|Google|Meta/.test(sp.txt || '') && sp.saved === 'true', sp);
    await pg.evaluate(() => { const c = document.getElementById('stock-ch'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    // 9 held back × (£1,200 ÷ 30 products in the output feed ÷ 30 days) × 5% × 30 days = £18.00; the ceiling (100%) = £360.00
    ok('Ad spend kept off: the largest blocking rule × spend per product a day × the scenario — £18.00 at 5%, £360.00 ceiling', /£18\.00/.test(stk.kept) && /£36\.00/.test(stk.kept) && /£360\.00/.test(stk.kept) && /at least/.test(stk.kept), stk.kept);
    await pg.evaluate(() => { const b = document.querySelector('#facet button'); b && b.click(); }); await pg.waitForTimeout(200);
    await pg.click('#mods-b'); await pg.waitForTimeout(150);
    await pg.evaluate(() => { const c = document.querySelector('#mods-p [data-mod-on="price"]'); c.click(); });
    await pg.waitForTimeout(200);
    const hid = await pg.evaluate(() => ({ hidden: document.getElementById('m-price').hidden, disp: getComputedStyle(document.getElementById('m-price')).display, saved: localStorage.getItem('fcc-cat-mods'), note: document.getElementById('mods-s').textContent }));
    ok('⊞ Modules hides a module (painted, not just flagged), remembers it on the device, and says so', hid.hidden && hid.disp === 'none' && /"price":1/.test(hid.saved || '') && /20 of 21/.test(hid.note), hid);
    await pg.evaluate(() => { document.querySelector('#mods-p [data-reset]').click(); });
    await pg.waitForTimeout(200);
    ok('Reset puts every module back', await pg.evaluate(() => !document.getElementById('m-price').hidden && !localStorage.getItem('fcc-cat-mods')));

    console.log('· the commercial view — six modules a buyer reads, each against an independent count');
    // 👔 Procurement view: nine modules, the commercial six first, the operational ones put away — and off again restores all
    await pg.click('#proc-b'); await pg.waitForTimeout(300);
    const pv = await pg.evaluate(() => ({ shown: Array.from(document.querySelectorAll('#ins > .mod')).filter((m) => !m.hidden && getComputedStyle(m).display !== 'none').sort((a, b) => (+a.style.order) - (+b.style.order)).map((m) => m.dataset.mod), on: document.getElementById('proc-b').getAttribute('aria-pressed'), note: document.getElementById('mods-s').textContent }));
    ok('👔 Procurement view shows nine modules, the commercial six first, and says so', pv.on === 'true' && pv.shown.length === 9 && pv.shown.slice(0, 6).join() === 'lift,fix,waste,vendor,scope,fee' && /Procurement view · 9 of 21/.test(pv.note), pv);
    // optimised vs not: FeedHero's own cut of Google Ads, re-added in node
    const lr = DATA.live.Title_optimisation_status.rows.filter((r) => !/unlisted/i.test(r.category));
    const side = (r) => (/non/i.test(r.category) ? 'n' : 'o'), acc = { o: { s: 0, r: 0, sp: 0 }, n: { s: 0, r: 0, sp: 0 } };
    lr.forEach((r) => { const t = acc[side(r)]; t.s += r.skus; t.r += r.revenue.n; t.sp += r.spend.n; });
    const gbp = (v) => '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await pg.waitForFunction(() => document.querySelector('#lift-body .vs'), null, { timeout: 8000 });
    const lift = await pg.evaluate(() => Array.from(document.querySelectorAll('#lift-body .vs tbody tr')).map((tr) => Array.from(tr.children).map((c) => c.textContent.trim())));
    const rowOf = (lab) => lift.find((r) => r[0] === lab) || [];
    ok('Optimised vs not: revenue per product and ROAS equal an independent count of the same cut', rowOf('Revenue per product')[1] === gbp(acc.o.r / acc.o.s) && rowOf('Revenue per product')[2] === gbp(acc.n.r / acc.n.s) && rowOf('ROAS')[1] === Math.round(acc.o.r / acc.o.sp * 100) + '%', { page: [rowOf('Revenue per product'), rowOf('ROAS')], want: [gbp(acc.o.r / acc.o.s), gbp(acc.n.r / acc.n.s), Math.round(acc.o.r / acc.o.sp * 100)] });
    ok('…and says it is a comparison, not a controlled test', await pg.evaluate(() => /not a controlled test/.test(document.getElementById('lift-body').textContent)));
    // before and after: the page's headline is the traced catalogue's own average, both ways
    const fx2 = await pg.evaluate(() => { const S = window.__FCCCatalogue.state(), b = document.querySelectorAll('#fix-body .bna b'); return { page: [b[0] && b[0].textContent, b[1] && b[1].textContent], want: S.sum ? [Math.round(S.sum.cb / S.sum.n), Math.round(S.sum.ca / S.sum.n)] : null }; });
    ok('Before and after FeedSpark: master → feed completeness is the traced average both ways', fx2.want && +fx2.page[0] === fx2.want[0] && +fx2.page[1] === fx2.want[1], fx2);
    // where the budget goes: the three buckets add up to every category's spend, each bucket by the category's own ROAS
    const roots = (DATA.market.tree || []).map((n) => n.row).filter((r) => r && r.category !== 'Total' && !/unlisted/i.test(r.category) && r.spend && r.spend.n > 0);
    const mk = DATA.market.total.roasPct, W = { lo: 0, mid: 0, hi: 0 }; let T = 0;
    roots.forEach((r) => { const ro = r.revenue.n / r.spend.n * 100, k = ro < 100 ? 'lo' : (ro < mk ? 'mid' : 'hi'); W[k] += r.spend.n; T += r.spend.n; });
    const wb = await pg.evaluate(() => Array.from(document.querySelectorAll('#waste-body .mlist .v')).map((v) => v.firstChild.textContent.trim()));
    ok('Where the ad budget goes: losing / below market / at or above add up to the category spend', wb.join('|') === [gbp(W.lo), gbp(W.mid), gbp(W.hi)].join('|'), { page: wb, want: [W.lo, W.mid, W.hi], total: T });
    // what the service does: titles rewritten = FeedSpark's own stamp, counted in node
    const tN = prods.filter((p) => p.opti && p.opti.T).length;
    const vd = await pg.evaluate(() => { const ks = Array.from(document.querySelectorAll('#vendor-body .evl .k')), vs = document.querySelectorAll('#vendor-body .evl .v'); const i = ks.findIndex((k) => k.textContent === 'Titles rewritten'); return i >= 0 ? vs[i].textContent : null; });
    ok('What the service does: "Titles rewritten" is FeedSpark’s own stamp over every product', vd === Math.round(tN / prods.length * 100) + '% of products', { page: vd, want: tN + '/' + prods.length });
    ok('…a capability the page cannot read says so rather than scoring a zero', await pg.evaluate(() => /not readable here/.test(document.getElementById('vendor-body').textContent)));
    // fee check: empty until typed, then the buyer's own figure over the catalogue and the Ads revenue — kept on the device only
    ok('Fee check is empty until a fee is typed', await pg.evaluate(() => { localStorage.removeItem('fcc-cat-fee'); document.getElementById('fee-a').value = ''; document.getElementById('fee-a').dispatchEvent(new Event('input')); return !document.querySelector('#fee-out .kvl'); }));
    await pg.fill('#fee-a', '2500'); await pg.fill('#fee-b', '1800'); await pg.waitForTimeout(200);
    const fee = await pg.evaluate(() => { const o = {}; const ks = document.querySelectorAll('#fee-out .kvl .k'), vs = document.querySelectorAll('#fee-out .kvl .v'); ks.forEach((k, i) => { o[k.textContent] = vs[i].firstChild.textContent.trim(); }); return { o, saved: localStorage.getItem('fcc-cat-fee') }; });
    const rev = DATA.market.total.revenue.n, fpc = (v) => { const x = v * 100; return (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + '%'; };
    ok('Fee check: per product and against Ads revenue are the typed fee over this catalogue and this market', fee.o['Per product, a month'] === gbp(2500 / prods.length) && fee.o['vs Google Ads revenue'] === fpc(2500 / rev) && fee.o['Costs more by'] === gbp(700 * 12), fee);
    ok('…and the fees stay on this device (fcc-cat-fee), never a request', JSON.parse(fee.saved || '{}').a === 2500);
    await pg.click('#proc-b'); await pg.waitForTimeout(250);
    ok('turning the view off brings all twenty-one back', await pg.evaluate(() => Array.from(document.querySelectorAll('#ins > .mod')).filter((m) => !m.hidden).length === 21 && document.getElementById('proc-b').getAttribute('aria-pressed') === 'false'));
    ok('no page errors', errs.length === 0, errs.slice(0, 5));
    await ctx.close();

    // ---------------------------------------------------------------- a cut FeedHero has not set up
    // the real state on 29 Sep 2026: every roster brand answers "Reports not found for Price group", which the
    // worker hands the page as {ok, rows:[], missing:true} — an answer, never a red error
    console.log('· price band not set up in FeedHero — said, on the chart and in the inspector');
    const nc = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const np = await nc.newPage(); const nerrs = [];
    np.on('pageerror', (e) => nerrs.push(e.message));
    await np.addInitScript(STUB);
    await np.addInitScript(`(function(){var f=window.fetch;window.fetch=function(u,o){if(String(u).indexOf('/api/roas/live')>=0&&String(u).indexOf('agg=Price_group')>=0)return Promise.resolve(new Response(JSON.stringify({ok:true,cached:false,agg:'Price_group',rows:[],n:0,missing:true}),{status:200,headers:{'content-type':'application/json'}}));return f(u,o);};})();`);
    await np.goto('file://' + tmp);
    await np.waitForFunction(() => window.__FCCCatalogue && window.__FCCCatalogue.state().linDone, null, { timeout: 30000 });
    await np.selectOption('#roas-agg', 'Price_group'); await np.waitForTimeout(450);
    const nsTxt = await np.evaluate(() => document.getElementById('roas-body').textContent);
    ok('the card says FeedHero has no price band report set up for this market yet', /FeedHero has no price band report set up for this market yet/.test(nsTxt) && !/Could not|error/i.test(nsTxt), nsTxt.slice(0, 200));
    await np.click('#vr .tr.row'); await np.waitForTimeout(400);
    await np.waitForFunction(() => { const el = document.getElementById('i-roas'); return el && el.textContent.indexOf('Reading') < 0; }, null, { timeout: 10000 }).catch(() => {});
    const niTxt = await np.evaluate(() => (document.getElementById('i-roas') || {}).textContent || '');
    ok('the inspector names it as not set up, apart from a column FeedHero reads as empty', /Not set up in FeedHero for this market: price band/.test(niTxt) && !/Not read by FeedHero’s ROAS here: [^·]*price band/.test(niTxt), niTxt.slice(0, 300));
    ok('no page errors', nerrs.length === 0, nerrs.slice(0, 5));
    await nc.close();

    // ---------------------------------------------------------------- Google Ads per product, last 7 days
    console.log('· Google Ads per product — FeedHero\'s Ads Traffic, matched on the product ID');
    const ac = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const ap = await ac.newPage(); const aerrs = [];
    ap.on('pageerror', (e) => aerrs.push(e.message));
    await ap.addInitScript(STUB);
    await ap.goto('file://' + tmp);
    await ap.waitForFunction(() => window.__FCCCatalogue && window.__FCCCatalogue.state().linDone, null, { timeout: 30000 });
    ok('nothing is read until a 7-day column is on', await ap.evaluate(() => !window.__adsCalls && window.__FCCCatalogue.state().ads.st === 'idle'));
    await ap.click('#cols-b'); await ap.waitForTimeout(150);
    const grpTxt = await ap.evaluate(() => (document.querySelector('#cols-p .grp') || {}).textContent || '');
    ok('the picker groups them under "Google Ads · this product · 7 days"', /Google Ads · this product · 7 days/.test(grpTxt), grpTxt);
    for (const k of ['a7clk', 'a7cost', 'a7roas', 'a7cpc']) { await ap.check('#cols-p [data-col="' + k + '"]'); await ap.waitForTimeout(60); }
    await ap.waitForFunction(() => window.__FCCCatalogue.state().ads.st === 'ready', null, { timeout: 10000 }).catch(() => {});
    const ad = DATA.ads.rows, akey = (id) => String(id).trim().toLowerCase();
    const want7 = new Map(Object.keys(ad).map((k) => [akey(k), ad[k]]));
    ok('the read is taken a chunk at a time until whole (two calls)', await ap.evaluate(() => window.__adsCalls === 2 && window.__FCCCatalogue.state().ads.st === 'ready'));
    await ap.click('body', { position: { x: 5, y: 5 } }); await ap.waitForTimeout(100);
    const cellOf = (id, k) => ap.evaluate(([id, k]) => {
      const S = window.__FCCCatalogue.state(), i = S.prods.findIndex((p) => p.id === id), r = S.view.indexOf(i);
      const cols = S.vc.map((c) => c.k), j = cols.indexOf(k); if (r < 0 || j < 0) return null;
      document.getElementById('gw').scrollTop = r * S.rh; return null;
    }, [id, k]).then(() => ap.waitForTimeout(120)).then(() => ap.evaluate(([id, k]) => {
      const S = window.__FCCCatalogue.state(), i = S.prods.findIndex((p) => p.id === id);
      const row = document.querySelector('#vr .tr.row[data-i="' + i + '"]'); if (!row) return null;
      const j = S.vc.map((c) => c.k).indexOf(k); return row.children[j] ? row.children[j].textContent.trim() : null;
    }, [id, k]));
    const served = prods.find((p) => want7.has(akey(p.id)) && p.id === Object.keys(ad)[0]);
    const v0 = ad[served.id];
    ok('a served product shows its own clicks, cost and ROAS (value ÷ cost)', await cellOf(served.id, 'a7clk') === String(v0[1]) && await cellOf(served.id, 'a7cost') === '£' + v0[2].toFixed(2) && await cellOf(served.id, 'a7roas') === Math.round(v0[4] / v0[2] * 100).toLocaleString('en-GB') + '%', { clk: await cellOf(served.id, 'a7clk'), cost: await cellOf(served.id, 'a7cost'), roas: await cellOf(served.id, 'a7roas') });
    const lowId = Object.keys(ad).find((k) => k !== k.toUpperCase() && k !== 'NW-GONE-1');
    const lowProd = prods.find((p) => akey(p.id) === lowId);
    ok('the join is case-blind (Google lower-cases the Ads item id): ' + lowProd.id + ' matches "' + lowId + '"', await cellOf(lowProd.id, 'a7clk') === String(ad[lowId][1]));
    const noClicks = Object.keys(ad).find((k) => ad[k][1] === 0);
    ok('impressions but no clicks: CPC is blank, never £0.00', await cellOf(prods.find((p) => akey(p.id) === akey(noClicks)).id, 'a7cpc') === '—');
    const unserved = prods.find((p) => !want7.has(akey(p.id)));
    ok('a product Google Ads did not serve reads "—" (the whole read did not list it)', await cellOf(unserved.id, 'a7clk') === '—');
    await ap.click('#gh [data-s="a7cost"]'); await ap.waitForTimeout(250);
    const top7 = await ap.evaluate(() => { const S = window.__FCCCatalogue.state(); return S.prods[S.view[0]].id; });
    const maxCost = prods.filter((p) => want7.has(akey(p.id))).sort((x, y) => want7.get(akey(y.id))[2] - want7.get(akey(x.id))[2])[0];
    ok('sorting by Cost · 7 d puts the biggest spender first', top7 === maxCost.id, { top7, want: maxCost.id });
    const pill = await ap.evaluate(() => document.querySelector('#src-roas .t2').textContent);
    ok('the Google Ads source says it read per product, and how many served products left the feed', /per product 22–28 Sep/.test(pill) && /1 not in this feed/.test(pill), pill);
    await ap.evaluate((id) => { const S = window.__FCCCatalogue.state(); const r = S.view.indexOf(S.prods.findIndex((p) => p.id === id)); document.getElementById('gw').scrollTop = r * S.rh; }, served.id);
    await ap.waitForTimeout(150);
    await ap.click('#vr .tr.row[data-i="' + prods.findIndex((p) => p.id === served.id) + '"]'); await ap.waitForTimeout(450);
    const insp7 = await ap.evaluate(() => (document.querySelector('#i-roas .ia7') || {}).textContent || '');
    ok('the inspector opens on this product\'s own Google Ads · 22–28 Sep, above the segments', /This product · Google Ads · 22–28 Sep/.test(insp7) && insp7.indexOf('£' + v0[2].toFixed(2)) >= 0, insp7.slice(0, 200));
    ok('no page errors', aerrs.length === 0, aerrs.slice(0, 5));
    await ac.close();

    // ---------------------------------------------------------------- phone
    console.log('· 390px — the inspector is a bottom sheet inside the screen');
    const mc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const mp = await mc.newPage(); await mp.addInitScript(STUB);
    await mp.goto('file://' + tmpS);
    await mp.waitForFunction(() => window.__FCCCatalogue && window.__FCCCatalogue.state().linDone, null, { timeout: 30000 });
    await mp.evaluate('window.FCCDigest && FCCDigest.expandAll({ silent: true })').catch(() => {});
    await mp.waitForTimeout(300);
    // centred, so the page's own topbar (this check runs without the phone widget) is not over it
    await mp.evaluate(() => document.querySelector('#vr .tr.row[data-i="1"]').scrollIntoView({ block: 'center' }));
    await mp.waitForTimeout(300);
    await mp.tap('#vr .tr.row[data-i="1"]'); await mp.waitForTimeout(500);
    const sh = await mp.evaluate(() => { const r = document.getElementById('insp').getBoundingClientRect(); return { on: document.getElementById('insp').classList.contains('on'), l: r.left, r: r.right, b: r.bottom, t: r.top, W: innerWidth, H: innerHeight, sw: document.documentElement.scrollWidth }; });
    ok('a tap opens it, inside the screen, no sideways scroll', sh.on && sh.l >= 0 && sh.r <= sh.W + 1 && sh.b <= sh.H + 1 && sh.t >= 0 && sh.sw <= sh.W + 1, sh);
    await mc.close();
  } finally { await b.close(); [tmp, tmpS].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} }); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('check_catalog crashed:', e); process.exit(1); });
