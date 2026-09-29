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
    ok('master-only products are counted for "Not in feed"', st.light === 4, st.light);
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
    await pg.fill('#q', 'colour:navy,black -avail:out'); await pg.waitForTimeout(450);
    const wantQ = prods.filter((p, i) => /navy|black/i.test(p.f.color || '') && fx[i].av !== 'out_of_stock').length;
    ok('search grammar: a comma list OR-s, a minus excludes', await view() === wantQ && wantQ > 0, { page: await view(), want: wantQ });
    await pg.fill('#q', ''); await pg.waitForTimeout(300);
    await pg.click('#tabs [data-tab="gone"]'); await pg.waitForTimeout(300);
    ok('"Not in feed" lists the master-only products', await view() === 4 && (await pg.evaluate(() => document.querySelector('#vr .tr.row') && document.querySelector('#vr .tr.row').textContent)).indexOf('M-OLD-') >= 0);
    await pg.click('#tabs [data-tab="all"]'); await pg.waitForTimeout(300);
    const seg = await pg.evaluate(() => { const i = window.__FCCCatalogue.state(); const el = document.querySelector('#lm-body i[data-c="s"][title^="Sale price"]'); if (!el) return null; const n = +(/· ([\d,]+) products/.exec(el.getAttribute('title')) || [0, '0'])[1].replace(/,/g, ''); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return n; });
    await pg.waitForTimeout(300);
    const wantSale = prods.filter((p, i) => fx[i].onSale).length;
    ok('the matrix: "Sale price · structured" lists every sale the master stated under another column', seg === wantSale && await view() === wantSale, { seg, page: await view(), want: wantSale });

    console.log('· the dashboard — nine modules of one size, evenly spaced, each one a filter');
    await pg.evaluate(() => { const S = window.__FCCCatalogue.state(); if (S.facet) document.querySelector('#facet button').click(); });
    await pg.waitForTimeout(250);
    const grid = await pg.evaluate(() => {
      const ms = Array.from(document.querySelectorAll('#ins > .mod')).filter((m) => !m.hidden).map((m) => { const r = m.getBoundingClientRect(); return { id: m.dataset.mod, t: Math.round(r.top), h: Math.round(r.height), l: Math.round(r.left), w: Math.round(r.width) }; });
      const rows = {}; ms.forEach((m) => { (rows[m.t] = rows[m.t] || []).push(m); });
      const k = document.querySelectorAll('#kpis .kpi'), kh = new Set(Array.from(k).map((x) => Math.round(x.getBoundingClientRect().height))), kt = new Set(Array.from(k).map((x) => Math.round(x.getBoundingClientRect().top)));
      return { n: ms.length, hs: new Set(ms.map((m) => m.h)).size, ws: new Set(ms.map((m) => m.w)).size, rows: Object.values(rows).map((r) => r.length), kpis: k.length, kh: kh.size, kt: kt.size };
    });
    ok('nine modules, every one the same height and width', grid.n === 9 && grid.hs === 1 && grid.ws === 1, grid);
    ok('three to a row at 1440px — three even rows', grid.rows.length === 3 && grid.rows.every((r) => r === 3), grid.rows);
    ok('the KPI band is one row of equal tiles', grid.kpis === 7 && grid.kh === 1 && grid.kt === 1, grid);
    const pb = await pg.evaluate(() => { const el = document.querySelector('#price-body [data-k]'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); const S = window.__FCCCatalogue.state(); return { lo: S.facet && S.facet.lo, hi: S.facet && S.facet.hi, k: S.facet && S.facet.k }; });
    await pg.waitForTimeout(300);
    const wantPb = prods.filter((p, i) => { const v = fx[i].onSale ? fx[i].sale : fx[i].price; return v != null && v >= pb.lo && (pb.hi == null || v < pb.hi); }).length;
    ok('a price band lists exactly the products priced in it (what the shopper pays)', pb.k === 'price' && await view() === wantPb && wantPb > 0, { pb, page: await view(), want: wantPb });
    await pg.evaluate(() => { const el = document.querySelector('#price-body [data-k]'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await pg.waitForTimeout(250);
    ok('clicking the same band again clears it', await pg.evaluate(() => !window.__FCCCatalogue.state().facet));
    const run = await pg.evaluate(() => { const el = document.querySelector('#run-body [data-f="run:all"]'); if (!el) return null; el.click(); return document.getElementById('run-body').textContent; });
    await pg.waitForTimeout(250);
    const grp = {}; fx.forEach((x) => { if (!x.grp) return; const c = grp[x.grp] || (grp[x.grp] = [0, 0]); c[0]++; if (x.av === 'in_stock') c[1]++; });
    const wantRun = fx.filter((x) => x.grp && grp[x.grp][0] >= 2 && grp[x.grp][1] === grp[x.grp][0]).length;
    ok('size-run health lists the products whose whole run is in stock', run != null && await view() === wantRun, { page: await view(), want: wantRun });
    await pg.evaluate(() => { const b = document.querySelector('#facet button'); b && b.click(); }); await pg.waitForTimeout(200);
    await pg.click('#mods-b'); await pg.waitForTimeout(150);
    await pg.evaluate(() => { const c = document.querySelector('#mods-p [data-mod-on="price"]'); c.click(); });
    await pg.waitForTimeout(200);
    const hid = await pg.evaluate(() => ({ hidden: document.getElementById('m-price').hidden, disp: getComputedStyle(document.getElementById('m-price')).display, saved: localStorage.getItem('fcc-cat-mods'), note: document.getElementById('mods-s').textContent }));
    ok('⊞ Modules hides a module (painted, not just flagged), remembers it on the device, and says so', hid.hidden && hid.disp === 'none' && /"price":1/.test(hid.saved || '') && /8 of 9/.test(hid.note), hid);
    await pg.evaluate(() => { document.querySelector('#mods-p [data-reset]').click(); });
    await pg.waitForTimeout(200);
    ok('Reset puts every module back', await pg.evaluate(() => !document.getElementById('m-price').hidden && !localStorage.getItem('fcc-cat-mods')));
    ok('no page errors', errs.length === 0, errs.slice(0, 5));
    await ctx.close();

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
