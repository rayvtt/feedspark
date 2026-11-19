#!/usr/bin/env node
/*
 * tools/check_aidemand.js — AI SHOPPING DEMAND, DRIVEN AS AN AM DRIVES IT.
 *
 * Ray, 19 Nov 2026: "I am looking for instant recommendations, instant activation, things to be changed,
 * and product SKU matching … match how many products in the catalog correspond to that search term and how
 * they are performing in terms of average ROAS across the catalog."
 *
 * tools/test_aidemand.mjs pins the engine and the store. THIS drives the real /aivis page on an INVENTED
 * Merchant Center book (tools/aivis_stub.js) and an invented eight-product feed whose every count is made
 * by hand in this file:
 *   · a fresh device opens the demand report and the live answers, folds the rest; the fold is remembered;
 *   · the stored reading renders: period, weighted share of voice, a blank share as NOT REPORTED, the move
 *     against the previous week;
 *   · ⚡ Match the catalogue: products per term, how many say it in the title, ROAS beside the catalogue's,
 *     and the verdict — hero, growth, wording gap, range gap;
 *   · a term opens its products, the ones not saying it in the title first;
 *   · ⬇ Label SKUs downloads the AI_Hero_Terms / AI_Growth_Opportunity sheet;
 *   · → Brief opens Workflow in a NEW tab with the term's evidence;
 *   · ⇪ Upload reads a UTF-16 tab-separated export as Google writes it, stores it, and the trend grows;
 *   · 390px never scrolls sideways.
 * Run: node tools/check_aidemand.js        (in presync; CI has no browsers)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright not installed — AI demand check skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const STUBS = require('./aivis_stub.js');
const PAGE = fs.readFileSync(path.join(D, 'FeedSpark_AIVisibility.html'), 'utf8');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return a < 0 ? '' : s.slice(a, b); })();
const HTML = PAGE.split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');

// the invented feed — eight products, six styles. Hand counts:
//   "wool coat"   → N1 N2 (title) + N3 (description only)  = 3 products, 2 in the title, 2 styles
//   "rain jacket" → N4 N5 (title; N5 written "Rain-Jackets") + N6 (description) = 3, 2 in the title
//   "storm proof" → none (N4 says "Storm", never "proof")   → Google shows 5 → a WORDING gap
//   "ski suit"    → none, Google shows 0                    → a RANGE gap
//   "quilted"     → N7 (title)                               = 1
const FEED = ['id,item_group_id,title,description,product_type,product_highlight,color,material,gender,product_detail',
  'N1,g1,Northwind Wool Coat Navy,A warm coat for winter,Women > Coats,Fully lined,Navy,Wool,female,General:Season:Winter',
  'N2,g1,Northwind Wool Coat Camel,A warm coat for winter,Women > Coats,Fully lined,Camel,Wool,female,',
  'N3,g2,Northwind Long Overcoat,A long wool coat cut from a heavy blend,Women > Coats,,Grey,Wool,female,',
  'N4,g3,Northwind Storm Rain Jacket,Keeps the weather out,Men > Jackets,Taped seams,Black,Nylon,male,',
  'N5,g3,Northwind Packable Rain-Jackets,Folds into its pocket,Men > Jackets,,Blue,Nylon,male,',
  'N6,g4,Northwind Shell,A light rain jacket for the hills,Men > Jackets,,Green,Nylon,male,',
  'N7,g5,Northwind Quilted Gilet,A layer for cold mornings,Men > Gilets,,Olive,Polyester,male,',
  'N8,g6,Northwind Fleece,Soft and warm,Men > Fleece,,,Polyester,male,'].join('\n') + '\n';
// Google Ads, 30 days: [impr, clicks, cost, conv, value] — the ids in another case on purpose
//   catalogue: 300 spend, 700 value → 233% · wool coat: 100 → 500 = 500% · rain jacket: 100 → 100 = 100%
const ADS = { n1: [900, 40, 50, 3, 400], N2: [500, 20, 50, 1, 100], n4: [400, 10, 100, 1, 100], N8: [300, 9, 100, 1, 100] };
const BOOK = STUBS.build().demand.uploads;
const STUB = `
window.__dem=${JSON.stringify(BOOK)};window.__demPuts=[];
window.fetch=function(url,opts){url=String(url);opts=opts||{};var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 if(url.indexOf('/api/aivis/demand')>=0){
   if(opts.method==='PUT'){var b=JSON.parse(opts.body);window.__demPuts.push(b);var u=b.upload;u.id=u.kind+'_'+u.from+'_'+u.to;u.by='ray@feedspark.com';u.at=1;u.src='upload';
     window.__dem=window.__dem.filter(function(x){return x.id!==u.id;}).concat([u]).sort(function(a,b){return a.to<b.to?1:-1;});return j({ok:true,id:u.id,uploads:window.__dem});}
   return j({ok:true,granted:true,uploads:window.__dem});}
 if(url.indexOf('/api/feed/proxy')>=0)return Promise.resolve(new Response(${JSON.stringify(FEED)},{status:200,headers:{'content-type':'text/csv'}}));
 if(url.indexOf('/api/breakdown/ads')>=0)return j({ok:true,done:true,cur:'GBP',range:'Last 30 days',rows:${JSON.stringify(ADS)}});
${STUBS.stubLines()}
 return j({ok:false,error:'stub'},404);};`;

let pass = 0, fail = 0;
const ok = (name, cond, got) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (got !== undefined ? ' — got ' + JSON.stringify(got) : '')); } };
// a week later, as Google writes the tab-separated export: UTF-16LE with a byte-order mark
const NEXT = '﻿"Name: AI shopping terms, product attributes and search intents"\n"Time period: Nov 16, 2026 – Nov 22, 2026"\nFilters: Country = GB;Category = Apparel > Outerwear\nColumn filters: Term frequency >= 0.05\n'
  + 'Search term\tTerm frequency\tProducts showing\tShare of voice\nwool coat\t1.0\t44\t0.4\nrain jacket\t0.6\t30\t0.21\nski suit\t0.2\t0\t\n';

(async () => {
  const b = await chromium.launch({ headless: true });
  const tmp = path.join(os.tmpdir(), '_aidemandcheck_FeedSpark_AIVisibility.html');
  fs.writeFileSync(tmp, HTML);
  const row = (pg, t) => pg.evaluate((t) => { const tr = document.querySelector('#dem-terms tr[data-term="' + t + '"]'); return tr ? [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim()) : null; }, t);
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
    const pg = await ctx.newPage();
    const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.addInitScript(STUB);
    await pg.goto('file://' + tmp);
    await pg.waitForSelector('#dem-terms tbody tr', { timeout: 8000 });

    console.log('· a fresh device');
    const folds = await pg.evaluate(() => [...document.querySelectorAll('main .card')].map((c) => [c.id, !c.classList.contains('folded'), (c.querySelector('.chead .fold') || { getAttribute() {} }).getAttribute('aria-expanded')]));
    ok('ten sections, each with its own chevron', folds.length === 10 && folds.every((f) => f[2] === 'true' || f[2] === 'false'), folds);
    ok('the demand report and the live answers open, the rest folded', folds.filter((f) => f[1]).map((f) => f[0]).join() === 'dem-card,live-card', folds.filter((f) => f[1]));
    const h0 = await pg.evaluate(() => { const c = document.querySelector('#sov-card'); return [...c.children].filter((x) => !x.classList.contains('chead')).every((x) => x.getBoundingClientRect().height === 0); });
    ok('a folded section paints nothing but its head', h0);
    ok('the button names the action still available', (await pg.textContent('#fold-all')).indexOf('Open all') >= 0);

    console.log('· the stored reading');
    const src = (await pg.innerText('#dem-src')).replace(/\s+/g, ' ');
    ok('the source line names the report, the category and the period', /AI performance/.test(src) && /Apparel > Outerwear/.test(src) && /9 Nov – 15 Nov 2026/.test(src), src);
    const k0 = (await pg.innerText('#dem-kpis')).replace(/\s+/g, ' ');
    ok('5 terms and a share of voice weighted by frequency over the 3 that report one (19%)', /TERMS SHOPPERS ASK 5/i.test(k0) && /19%/.test(k0) && /3 of 5 terms/.test(k0), k0);
    const wool0 = await row(pg, 'wool coat'), ski0 = await row(pg, 'ski suit');
    ok('the move against the week before is in points (22% → 31% = ▲9)', /31%/.test(wool0[2]) && /▲9 pts/.test(wool0[2]), wool0);
    ok('a blank share of voice reads NOT REPORTED, never 0%', /not reported/.test(ski0[2]) && !/0%/.test(ski0[2]), ski0);
    ok('before a match the catalogue columns say so rather than showing a zero', /match to see/.test(wool0[4]) && !(await pg.isEnabled('#dem-labels')), wool0);

    console.log('· ⚡ Match the catalogue');
    await pg.click('#dem-match');
    await pg.waitForFunction(() => /500%/.test((document.querySelector('#dem-terms') || {}).innerText || ''), null, { timeout: 8000 });
    const wool = await row(pg, 'wool coat'), rain = await row(pg, 'rain jacket'), storm = await row(pg, 'storm proof'), ski = await row(pg, 'ski suit'), quilt = await row(pg, 'quilted');
    ok('wool coat: 3 products in 2 styles, 2 say it in the title', /^3 2 styles$/.test(wool[4]) && /^2 67%$/.test(wool[5]), wool);
    ok('its ROAS is the matched products’ own sums (500%) beside the catalogue’s (233%)', /500%/.test(wool[6]) && /vs 233% catalogue/.test(wool[6]), wool);
    ok('a hyphenated plural in a title still matches (rain jacket: 3, 2 in the title, 100%)', /^3 /.test(rain[4]) && /^2 /.test(rain[5]) && /100%/.test(rain[6]), rain);
    ok('the four verdicts: hero · growth · wording gap · range gap', /HERO/i.test(wool[7]) && /GROWTH/i.test(rain[7]) && /WORDING GAP/i.test(storm[7]) && /RANGE GAP/i.test(ski[7]) && /GROWTH/i.test(quilt[7]), [wool[7], rain[7], storm[7], ski[7], quilt[7]]);
    ok('a term no product says shows 0 in the catalogue beside Google’s own 5', storm[3] === '5' && /^0/.test(storm[4]), storm);
    const k1 = (await pg.innerText('#dem-kpis')).replace(/\s+/g, ' ');
    ok('the tiles count 1 hero · 2 growth · 1 wording · 1 range and 7 SKUs to label (3 hero, 4 growth)', /HERO TERMS 1 /i.test(k1) && /GROWTH TERMS 2 /i.test(k1) && /WORDING GAPS 1 /i.test(k1) && /RANGE GAPS 1 /i.test(k1) && /SKUS TO LABEL 7 3 hero · 4 growth/i.test(k1), k1);
    ok('the source line says what was matched and against which Google Ads read', /Matched against 8 products/.test(await pg.innerText('#dem-src')) && /4 advertised/.test(await pg.innerText('#dem-src')));

    console.log('· a verdict tile filters the terms');
    await pg.click('#dem-kpis [data-vf="growth"]');
    const gr = await pg.evaluate(() => [...document.querySelectorAll('#dem-terms tbody tr[data-term]')].map((tr) => tr.getAttribute('data-term')));
    ok('the Growth tile shows only the growth terms and says it is on', gr.slice().sort().join('|') === 'quilted|rain jacket' && await pg.evaluate(() => document.querySelector('#dem-kpis [data-vf="growth"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.dm-vf [data-vf="growth"]').classList.contains('on')), gr);
    await pg.click('.dm-vf [data-vf=""]');
    ok('All puts every term back', await pg.evaluate(() => document.querySelectorAll('#dem-terms tbody tr[data-term]').length) === 5);
    const tiles = await pg.evaluate(() => [...document.querySelectorAll('#dem-kpis .k')].map((k) => { const r = k.getBoundingClientRect(), l = k.querySelector('span').getBoundingClientRect(); return [Math.round(r.top), Math.round(l.top - r.top)]; }));
    ok('the tiles sit on one row and every label starts at the same height', new Set(tiles.map((t) => t[0])).size === 1 && new Set(tiles.map((t) => t[1])).size === 1, tiles);
    console.log('· a term’s products');
    await pg.click('#dem-terms tr[data-term="wool coat"]');
    const det = await pg.evaluate(() => { const x = document.querySelector('#dem-terms tr.dm-x'); return { act: x.querySelector('.dm-act').innerText, rows: [...x.querySelectorAll('table.t > tbody > tr')].map((tr) => [...tr.children].map((c) => c.innerText.trim())) }; });
    ok('its three products, the one NOT saying it in the title first', det.rows.length === 3 && det.rows[0][1] === 'N3' && /Not in title/.test(det.rows[0][2]) && /^✓ Title/.test(det.rows[1][2]), det.rows);
    const hl = await pg.evaluate(() => [...document.querySelectorAll('#dem-terms tr.dm-x table.t > tbody > tr')].map((tr) => ({
      found: [...tr.children[2].querySelectorAll('.dm-fi')].map((c) => c.textContent.trim()),
      marks: [...tr.children[0].querySelectorAll('mark.dm-hit')].map((m) => m.textContent),
      ex: [...tr.children[0].querySelectorAll('.dm-ex')].map((d) => [d.querySelector('.dm-exf').textContent, [...d.querySelectorAll('mark.dm-hit')].map((m) => m.textContent).join('|'), d.innerText.replace(/\s+/g, ' ').trim()]) })));
    ok('Found in: the overcoat says it in its description only, the two coats in their title only', hl[0].found.join('|') === '✗ Not in title|Description' && hl[1].found.join('|') === '✓ Title' && hl[2].found.join('|') === '✓ Title', hl.map((h) => h.found));
    ok('the description is quoted with the term itself marked', hl[0].ex.length === 1 && hl[0].ex[0][0] === 'Description' && hl[0].ex[0][1] === 'wool coat' && /A long wool coat cut from a heavy blend/.test(hl[0].ex[0][2]), hl[0].ex);
    ok('a title that says it has the term marked in the title, as the feed writes it', hl[1].marks.join('|') === 'Wool Coat' && hl[2].marks.join('|') === 'Wool Coat' && hl[1].ex.length === 0, hl.map((h) => h.marks));
    const mk = await pg.evaluate(() => { const m = document.querySelector('#dem-terms tr.dm-x mark.dm-hit'), c = getComputedStyle(m); return [c.backgroundColor, c.fontWeight]; });
    ok('the mark is coloured and bold', /rgba?\(245, 166, 35/.test(mk[0]) && +mk[1] >= 700, mk);
    const [xd] = await Promise.all([pg.waitForEvent('download'), pg.click('#dem-terms tr.dm-x [data-skus="wool coat"]')]);
    const xb = fs.readFileSync(await xd.path());
    const XL = require('../docs/xlsx_engine.js');
    const xr = await XL.readXlsx(xb.buffer.slice(xb.byteOffset, xb.byteOffset + xb.byteLength));
    const xml = xb.toString('utf8');
    ok('⬇ These SKUs is an Excel file: a header and one row per product', /\.xlsx$/.test(xd.suggestedFilename()) && xr.length === 4 && xr[0].slice(0, 6).join('|') === 'ID|Title|Search term|Found in|In the title|Description', [xd.suggestedFilename(), xr[0]]);
    ok('each row names where the term was found and carries the words', xr[1][0] === 'N3' && xr[1][3] === 'Description' && xr[1][4] === 'no' && xr[1][5] === 'A long wool coat cut from a heavy blend' && xr[2][3] === 'Title' && !xr[2][5], xr.slice(1).map((r) => r.slice(0, 6)));
    ok('the term is coloured in the file: three coloured runs, each the term as written', (xml.match(/<rPr><b\/><sz val="11"\/><color rgb="FFED6F0B"\/>/g) || []).length === 3 && /<color rgb="FFED6F0B"\/><rFont val="Calibri"\/><family val="2"\/><\/rPr><t xml:space="preserve">wool coat<\/t>/.test(xml) && /<t xml:space="preserve">Wool Coat<\/t>/.test(xml));
    ok('the action is said in words and names the label', /Protect it/.test(det.act) && /AI_Hero_Terms/.test(det.act), det.act);

    console.log('· Match on — the fields the AM picks');
    const chips = () => pg.evaluate(() => [...document.querySelectorAll('#dem-flds [data-dfld]')].map((b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')));
    ok('six fields, all on, no reset offered', (await chips()).join('|') === 'Title*|Description*|Product type*|Product highlights*|Product details*|Attributes*', await chips());
    await pg.click('#dem-flds [data-dfld="de"]');
    const woolD = await row(pg, 'wool coat'), rainD = await row(pg, 'rain jacket');
    ok('Description off: the two products that say a term only in their description leave it (3 → 2, each)', /^2 /.test(woolD[4]) && /^2 /.test(rainD[4]) && /^2 100%$/.test(woolD[5]), [woolD, rainD]);
    ok('the feed was not read again and the line says what is matched on', /on title, product type, product highlights, product details, attributes only/.test(await pg.innerText('#dem-src')));
    ok('the labels follow: 5 SKUs, not 7', /SKUS TO LABEL 5 2 hero · 3 growth/i.test((await pg.innerText('#dem-kpis')).replace(/\s+/g, ' ')), (await pg.innerText('#dem-kpis')).replace(/\s+/g, ' ').slice(-60));
    for (const k of ['pt', 'hl', 'pd', 'at']) await pg.click('#dem-flds [data-dfld="' + k + '"]');
    ok('Title alone: every match says it in the title', /^2 100%$/.test((await row(pg, 'wool coat'))[5]) && (await chips()).filter((c) => /\*$/.test(c)).join() === 'Title*');
    await pg.click('#dem-flds [data-dfld="ti"]');
    ok('the last field cannot be switched off', (await chips()).filter((c) => /\*$/.test(c)).join() === 'Title*');
    await pg.click('#dem-flds [data-dfld="ti"]'); await pg.click('#dem-flds [data-dfld="de"]');
    await pg.reload(); await pg.waitForSelector('#dem-terms tbody tr', { timeout: 8000 });
    ok('the pick is this device’s and survives a reload', (await chips()).filter((c) => /\*$/.test(c)).join('|') === 'Title*|Description*', await chips());
    await pg.click('#dem-match');
    await pg.waitForFunction(() => /500%/.test((document.querySelector('#dem-terms') || {}).innerText || ''), null, { timeout: 8000 });
    await pg.click('#dem-flds [data-dfld="*"]');
    ok('All fields puts every field back and the counts with it', (await chips()).length === 6 && /^3 /.test((await row(pg, 'wool coat'))[4]), await chips());
    console.log('· every column sorts');
    const col = (i) => pg.evaluate((i) => [...document.querySelectorAll('#dem-terms tr[data-term]')].map((tr) => tr.children[i].innerText.replace(/\s+/g, ' ').trim()), i);
    const numOf = (t) => { const m = /-?[\d,]+(\.\d+)?/.exec(t); return m && !/^—/.test(t) && !/not reported/i.test(t) ? Number(m[0].replace(/,/g, '')) : null; };
    const shape = (vals, dir) => {            // measured values run one way, every blank after them
      const n = vals.map(numOf), k = n.findIndex((v) => v == null), body = k < 0 ? n : n.slice(0, k);
      return (k < 0 || n.slice(k).every((v) => v == null)) && body.every((v, i) => !i || (dir < 0 ? body[i - 1] >= v : body[i - 1] <= v));
    };
    const head = (k) => pg.getAttribute('#dem-terms th[data-dsrt="terms:' + k + '"]', 'aria-sort');
    ok('all eight heads of the terms table sort', await pg.evaluate(() => { const th = [...document.querySelectorAll('#dem-terms thead th')]; return th.length === 8 && th.every((x) => x.matches('.srt[data-dsrt^="terms:"]')); }));
    ok('it opens most asked first', (await head('f')) === 'descending' && shape(await col(1), -1), await col(1));
    await pg.click('#dem-terms th[data-dsrt="terms:ps"]');
    ok('Google shows: highest first', (await head('ps')) === 'descending' && (await head('f')) === 'none' && shape(await col(3), -1), await col(3));
    await pg.click('#dem-terms th[data-dsrt="terms:ps"]');
    ok('a second click reverses it', (await head('ps')) === 'ascending' && shape(await col(3), 1), await col(3));
    await pg.click('#dem-terms th[data-dsrt="terms:sov"]');
    const sv1 = await col(2);
    await pg.click('#dem-terms th[data-dsrt="terms:sov"]');
    const sv2 = await col(2);
    ok('Share of voice sorts both ways, and a share Google did not report stays last in both', shape(sv1, -1) && shape(sv2, 1) && numOf(sv1[sv1.length - 1]) == null && numOf(sv2[sv2.length - 1]) == null, [sv1, sv2]);
    for (const [k, i, nm] of [['n', 4, 'In the catalogue'], ['ti', 5, 'In the title'], ['roas', 6, 'ROAS']]) {
      await pg.click('#dem-terms th[data-dsrt="terms:' + k + '"]');
      ok(nm + ': highest first', (await head(k)) === 'descending' && shape(await col(i), -1), await col(i));
    }
    await pg.click('#dem-terms th[data-dsrt="terms:t"]');
    const names = await col(0);
    ok('Search term sorts A to Z', (await head('t')) === 'ascending' && names.join('|') === names.slice().sort((x, y) => x.localeCompare(y)).join('|'), names);
    await pg.click('#dem-terms th[data-dsrt="terms:score"]');
    ok('Verdict sorts by priority, and the rows are all still there', (await head('score')) === 'descending' && (await col(0)).slice().sort().join('|') === names.slice().sort().join('|'));
    for (const [tab, id, n] of [['intents', 'dem-intents', 6], ['attrs', 'dem-attrs', 6]]) {
      await pg.click('#dem-tabs [data-dtab="' + tab + '"]');
      await pg.waitForSelector('#' + id + ' tbody tr');
      const before = await pg.evaluate((id) => [...document.querySelectorAll('#' + id + ' tbody tr')].map((tr) => tr.children[0].innerText.trim()), id);
      await pg.click('#' + id + ' th[data-dsrt="' + tab + ':t"]');
      const after = await pg.evaluate((id) => [...document.querySelectorAll('#' + id + ' tbody tr')].map((tr) => tr.children[0].innerText.trim()), id);
      ok('the ' + tab + ' table: ' + n + ' sortable heads, and its first column sorts A to Z', (await pg.$$('#' + id + ' th.srt')).length === n && after.length === before.length && after.join('|') === before.slice().sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())).join('|'), after);
    }
    await pg.click('#dem-tabs [data-dtab="terms"]');
    ok('the sort is kept when you come back to the tab', (await head('score')) === 'descending');
    await pg.click('#dem-terms th[data-dsrt="terms:f"]');
    await pg.click('#dem-terms tr[data-term="wool coat"]');
    if (process.env.AIDEMAND_SHOT) await (await pg.$('#dem-card')).screenshot({ path: path.join(process.env.AIDEMAND_SHOT, 'aidemand_terms.png') });   // a visual pass, on request
    console.log('· activation');
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#dem-labels')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').trim().split('\n');
    ok('⬇ Label SKUs: one row per product, 3 AI_Hero_Terms and 4 AI_Growth_Opportunity', csv[0] === 'id,custom_label,ai_terms,title' && csv.length === 8 && csv.filter((l) => /,AI_Hero_Terms,/.test(l)).length === 3 && csv.filter((l) => /,AI_Growth_Opportunity,/.test(l)).length === 4, csv);
    ok('a product is labelled once, and the fleece nobody asked for is not labelled', new Set(csv.slice(1).map((l) => l.split(',')[0])).size === 7 && !csv.some((l) => /^N8,/.test(l)));
    await pg.click('#dem-tabs [data-dtab="act"]');
    const order = await pg.evaluate(() => [...document.querySelectorAll('#dem-body .dm-rank .w b')].map((x) => x.firstChild.textContent.trim()));
    ok('Actions rank by how often it is asked and how little is held: rain jacket, storm proof, quilted — then the hero', order.join('|') === 'rain jacket|storm proof|quilted|wool coat', order);
    if (process.env.AIDEMAND_SHOT) await (await pg.$('#dem-card')).screenshot({ path: path.join(process.env.AIDEMAND_SHOT, 'aidemand_actions.png') });
    ok('a range gap is named for the client and offered no brief', /ski suit/.test(await pg.innerText('#dem-body')) && !(await pg.$('#dem-body [data-tbrief="ski suit"]')));
    // file:// cannot load /workflow, so the tab is caught where the page opens it: window.open(url, '_blank')
    await pg.evaluate(() => { window.__opened = []; window.open = function (u, t) { window.__opened.push([String(u), t]); return {}; }; });
    await pg.click('#dem-body [data-tbrief="rain jacket"]');
    const opened = await pg.evaluate(() => window.__opened);
    const u = (opened[0] || [''])[0], q = (u.split('brief=')[1] || '').replace(/-/g, '+').replace(/_/g, '/');
    let brief = {}; try { brief = JSON.parse(Buffer.from(q, 'base64').toString('utf8')); } catch (e) {}
    ok('→ Brief opens Workflow in a NEW tab and the module stays where it was', opened.length === 1 && /^\/workflow\?brief=/.test(u) && opened[0][1] === '_blank' && /AIVisibility/.test(pg.url()), opened);
    ok('the brief carries the term, its evidence and the label', /^AI Demand - rain jacket - Growth - Northwind GB - \d{4}$/.test(brief.task || '') && brief.cat === 'keyword' && /3 products/.test(brief.scope) && /100% against 233%/.test(brief.scope) && /AI_Growth_Opportunity/.test(brief.scope), brief);

    console.log('· intents and attributes');
    await pg.click('#dem-tabs [data-dtab="intents"]');
    const ints = await pg.evaluate(() => [...document.querySelectorAll('#dem-intents tbody tr')].map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim())));
    ok('an intent is matched on its own key words and given what to write', ints.length === 2 && /say “cold weather”/.test(ints[0][4]) && /g:product_highlight/.test(ints[0][5]) && /occasion/i.test(ints[1][5]), ints);
    await pg.click('#dem-tabs [data-dtab="attrs"]');
    const attrs = await pg.evaluate(() => [...document.querySelectorAll('#dem-attrs tbody tr')].map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim())));
    ok('an attribute names where it lives and how full the feed is (colour 7 of 8 = 88%; Season has no field)', /g:color/.test(attrs[0][3]) && /^88%/.test(attrs[0][4]) && /g:material/.test(attrs[1][3]) && /^100%/.test(attrs[1][4]) && /g:product_detail/.test(attrs[2][3]) && /^13%/.test(attrs[2][4]), attrs);

    console.log('· ⇪ Upload — the export as Google writes it');
    const buf = Buffer.from(NEXT, 'utf16le');
    await pg.setInputFiles('#dem-file', { name: 'AI_shopping_terms_2026-11-23.csv', mimeType: 'text/csv', buffer: buf });
    await pg.waitForFunction(() => window.__demPuts.length === 1, null, { timeout: 8000 });
    const put = await pg.evaluate(() => window.__demPuts[0].upload);
    ok('a UTF-16 tab-separated export is read: kind, period, country, rows', put.kind === 'terms' && put.from === '2026-11-16' && put.to === '2026-11-22' && put.country === 'GB' && put.rows.length === 3, put);
    ok('a blank share of voice is stored as null, not zero', put.rows[2].sov === null && put.rows[0].sov === 0.4, put.rows);
    await pg.click('#dem-tabs [data-dtab="time"]');
    await pg.click('#dem-time th[data-dsrt="time:delta"]');
    const mv = await pg.evaluate(() => [...document.querySelectorAll('#dem-time tbody tr')].map((tr) => tr.children[3].innerText.trim()));
    ok('Over time: five sortable heads, Move sorts biggest gain first with no-move rows last', (await pg.$$('#dem-time th.srt')).length === 5 && /\+18 pts/.test(mv[0]) && mv[mv.length - 1] === '—', mv);
    const time = await pg.evaluate(() => [...document.querySelectorAll('#dem-time tbody tr')].map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, ' ').trim())));
    const tw = time.filter((r) => r[0] === 'wool coat')[0], ts = time.filter((r) => r[0] === 'ski suit')[0];
    ok('Over time: wool coat 22% → 40% across three readings, +18 pts', tw && /^22%/.test(tw[1]) && /^40%/.test(tw[2]) && /\+18 pts/.test(tw[3]) && tw[4] === '3', tw);
    ok('a term never given a share shows no move rather than a made-up one', ts && ts[3] === '—', ts);
    ok('the new week is the reading on screen and the match re-ran on it', /16 Nov – 22 Nov 2026/.test(await pg.innerText('#dem-src')) && /TERMS SHOPPERS ASK 3/i.test((await pg.innerText('#dem-kpis')).replace(/\s+/g, ' ')));

    console.log('· the fold');
    await pg.click('#live-card > .chead h3');
    ok('a head click folds its section', await pg.evaluate(() => document.querySelector('#live-card').classList.contains('folded')));
    await pg.click('#dem-match');
    ok('a control in a head is never a fold', await pg.evaluate(() => !document.querySelector('#dem-card').classList.contains('folded')));
    await pg.reload(); await pg.waitForSelector('#dem-kpis .k', { timeout: 8000 });
    ok('the choice is remembered on this device', await pg.evaluate(() => document.querySelector('#live-card').classList.contains('folded') && !document.querySelector('#dem-card').classList.contains('folded')));
    await pg.click('#fold-all');
    ok('⊕ Open all opens every section', await pg.evaluate(() => !document.querySelector('main .card.folded')) && /Fold all/.test(await pg.textContent('#fold-all')));
    await pg.click('#fold-all');
    const line = await pg.textContent('#dem-sum');
    ok('folded, the demand head keeps what it found', await pg.evaluate(() => document.querySelector('#dem-card').classList.contains('folded')) && /5 terms/.test(line) && /share of voice 19%/.test(line), line);
    await pg.evaluate(() => { location.hash = '#prod-card'; });
    await pg.waitForFunction(() => !document.querySelector('#prod-card').classList.contains('folded'), null, { timeout: 3000 });
    ok('a #hash opens the section it names', true);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· at 390px');
    const mc = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const mp = await mc.newPage();
    await mp.addInitScript(STUB);
    await mp.goto('file://' + tmp);
    await mp.waitForSelector('#dem-terms tbody tr', { timeout: 8000 });
    await mp.click('#dem-match');
    await mp.waitForFunction(() => /500%/.test((document.querySelector('#dem-terms') || {}).innerText || ''), null, { timeout: 8000 });
    ok('the page never scrolls sideways — the table pans in its frame', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await mp.evaluate(() => document.documentElement.scrollWidth));
    ok('every control of the section is on the phone', await mp.evaluate(() => ['dem-up', 'dem-match', 'dem-labels', 'dem-brief'].every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.height > 0; })));
    await mc.close();
  } finally { await b.close(); try { fs.unlinkSync(tmp); } catch (e) {} }
  console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions' + (fail ? ', ' + fail + ' failed' : ''));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
