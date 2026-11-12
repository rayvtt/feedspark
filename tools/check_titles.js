#!/usr/bin/env node
/*
 * tools/check_titles.js — TITLE LAB, DRIVEN AS AN AM DRIVES IT.
 *
 * Ray, 12 Nov 2026: "a new module just for the title. The audit will compare the master feed to the output feed,
 * showing the state of the title and how the title mask looks … side by side, either for a single product or
 * multiple products … if material appears in the title, it must also appear in the material field … then provide a
 * summary of what we have done so far".
 *
 * tools/test_titles.mjs pins the engine and the wiring. THIS pins the half only a browser can see, on the REAL page
 * with the synthetic Northwind set of tools/titles_stub.js — every count against the stub's OWN rules, never through
 * the engine under test:
 *   · the feed and the master are read and joined; the summary tiles and the story carry the counted figures;
 *   · side by side opens on rewritten products, each card showing before and after with the attributes marked where
 *     they sit, both masks, and the title-against-field check; a product is added by ID and removed;
 *   · the mask list ranks the masks; clicking one lists exactly those titles;
 *   · the check table's counts open those titles; → Brief opens Workflow in a NEW tab with the task named;
 *   · the list filters by view and by a word; ⬇ CSV carries every listed title;
 *   · every section folds — fresh-device defaults, a click, the remembered choice, Open/Fold all, a #hash;
 *   · with no master the page says so and reads before from the stamp; no console error; 390px does not scroll sideways.
 * Run: node tools/check_titles.js        (in presync; CI has no browsers)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright not installed — titles check skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const STUBS = require('./titles_stub.js');
const PAGE = fs.readFileSync(path.join(D, 'FeedSpark_Titles.html'), 'utf8');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const HTML = PAGE.split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
const stub = (noMaster) => `window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
${noMaster ? " if(url.indexOf('/api/catalog/master')>=0)return j({ok:false,error:'no master feed on record'},404);\n" : ''}${STUBS.stubLines()}
 if(url.indexOf('/api/access')>=0)return j({ok:true,email:'ray@feedspark.com',owner:true,clients:null,modules:null});
 return j({ok:false,error:'stub'},404);};`;

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };
// the independent count: the stub's own rules
const P = STUBS.products(), N = P.length, SAME = P.filter((p) => p.same).length, CH = N - SAME;
const MAT_GAP = P.filter((p) => !p.same && !p.fieldMat), FULL = P.filter((p) => !p.same && p.pat).length;
const ready = (pg) => pg.waitForFunction(() => window.__FCCTitles && window.__FCCTitles.state().final && !window.__FCCTitles.state().pass, null, { timeout: 30000 });
const num = (s) => +String(s).replace(/[^\d.]/g, '');

(async () => {
  const tmp = path.join(os.tmpdir(), '_tlcheck_FeedSpark_Titles.html'); fs.writeFileSync(tmp, HTML);
  const b = await chromium.launch({ headless: true });
  try {
    console.log('· 1440px — the read, the join, the summary');
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
    await ctx.route(/\/workflow\?brief=/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wf</title>' }));
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text())) errs.push(m.text()); });
    await pg.addInitScript(stub(false));
    await pg.goto('file://' + tmp);
    await ready(pg);
    const fold = () => pg.evaluate(() => Array.from(document.querySelectorAll('.sec[data-sec]')).map((s) => s.getAttribute('data-sec') + ':' + (s.classList.contains('open') ? 1 : 0) + (s.querySelector('.sec-h').getAttribute('aria-expanded') === String(s.classList.contains('open')) ? '' : '!')).join(' '));
    ok('a fresh device opens the summary and side by side, the rest folded', (await fold()) === 'sum:1 sbs:1 mask:0 chk:0 list:0 how:0', await fold());
    ok('…a folded body is not painted, and its head still says what is inside', await pg.evaluate(() => document.getElementById('sec-chk-b').getBoundingClientRect().height === 0) && /titles/.test(await pg.textContent('#ln-chk')));
    const status = await pg.textContent('#mstate');
    ok('the status names the products read and the master column joined on', new RegExp('^' + N + ' products').test(status) && /joined on “id”/.test(status) && status.indexOf(N + ' titles have a before') >= 0, status);
    const kp = await pg.$$eval('#kp .kpi', (els) => els.map((e) => [e.querySelector('.n').textContent, e.querySelector('.l').textContent, (e.querySelector('.s') || {}).textContent || '']));
    ok('six summary tiles', kp.length === 6, kp.length);
    ok('titles read and rewritten equal the stub’s own count', num(kp[0][0]) === N && kp[1][2] === CH + ' of ' + N && Math.abs(num(kp[1][0]) - Math.round(CH / N * 1000) / 10) < 0.01, kp.slice(0, 2));
    ok('titles to look at = the material gaps + the one colour difference', num(kp[5][0]) === MAT_GAP.length + 1, kp[5]);
    const story = await pg.$$eval('#story li', (els) => els.map((e) => e.textContent));
    ok('the story says what was done, in words', story.some((s) => s.indexOf(CH + ' of ' + N + ' titles') >= 0 && /rewritten/.test(s)) && story.some((s) => s.indexOf('Material — ' + MAT_GAP.length + ' in the title but not in the field') >= 0), story);

    console.log('· side by side');
    const cards = await pg.$$eval('#sbs .pc', (els) => els.map((c) => ({ id: c.querySelector('.id').textContent, before: c.querySelector('.side.before .ttl').textContent, after: c.querySelector('.side.after .ttl').textContent, marks: Array.from(c.querySelectorAll('.side.after .ttl mark')).map((m) => m.className.replace('a-', '') + '=' + m.textContent), maskB: Array.from(c.querySelectorAll('.side.before .mk')).map((m) => m.textContent), maskA: Array.from(c.querySelectorAll('.side.after .mk')).map((m) => m.textContent), ringed: c.querySelectorAll('.side.after .mk.new').length, rows: c.querySelectorAll('tbody tr').length })));
    ok('it opens on six products, none of them an unchanged title', cards.length === 6 && cards.every((c) => { const p = P.find((x) => x.id === c.id); return p && !p.same; }), cards.map((c) => c.id));
    ok('each card shows the master title before and the shopping title after', cards.every((c) => { const p = P.find((x) => x.id === c.id); return c.before === p.before && c.after === p.after; }));
    const c0 = cards[0], p0 = P.find((x) => x.id === c0.id);
    ok('the attributes are marked where they sit in the title', ['brand=Northwind', 'color=' + p0.col, 'material=' + p0.mat, 'type=' + p0.type].every((m) => c0.marks.indexOf(m) >= 0), c0.marks);
    ok('both masks: Item type + Colour before, the full mask after', c0.maskB.join('+') === 'Item type+Colour' && c0.maskA[0] === 'Brand' && c0.maskA.indexOf('Material') > 0 && c0.maskA[c0.maskA.length - 1] === 'Size', [c0.maskB, c0.maskA]);
    ok('the attributes the title gained are ringed, the two it already had are not', c0.ringed === c0.maskA.length - 2, [c0.ringed, c0.maskA.length]);
    ok('eight attribute rows a card', cards.every((c) => c.rows === 8));
    await pg.fill('#add', P[5].id); await pg.press('#add', 'Enter');
    ok('a product added by its ID leads the cards', await pg.evaluate((id) => document.querySelector('#sbs .pc .id').textContent === id && document.querySelectorAll('#sbs .pc').length === 7, P[5].id));
    const gap = MAT_GAP[0];
    await pg.fill('#add', gap.id); await pg.press('#add', 'Enter');
    const g = await pg.evaluate((id) => { const c = Array.from(document.querySelectorAll('#sbs .pc')).find((x) => x.querySelector('.id').textContent === id); if (!c) return null; const tr = Array.from(c.querySelectorAll('tbody tr')).find((r) => r.cells[0].textContent === 'Material'); return { first: document.querySelector('#sbs .pc .id').textContent, feed: tr.cells[2].textContent, after: tr.cells[4].textContent.trim(), ck: tr.querySelector('.ck').textContent, n: document.querySelectorAll('#sbs .pc').length }; }, gap.id);
    ok('…and one already compared moves to the front rather than appearing twice', g && g.first === gap.id && g.n === 7, g);
    ok('MATERIAL IN THE TITLE, NOT IN THE FIELD reads so on its card', g && g.feed === '—' && g.after === '✓' && g.ck === 'Not in field', g);
    await pg.click('#sbs .pc [data-rm] >> nth=0'); await pg.waitForTimeout(80);
    ok('✕ removes a card', (await pg.$$('#sbs .pc')).length === 6);
    await pg.click('#clr'); await pg.click('#best');
    ok('Clear empties it and ✦ Best examples fills it again', (await pg.$$('#sbs .pc')).length === 6);

    console.log('· the mask');
    await pg.click('#sec-mask .sec-h');
    const mr = await pg.$$eval('#masks .mrow', (els) => els.map((e) => [Array.from(e.querySelectorAll('.mk')).map((m) => m.textContent).join('+'), e.querySelector('.fig span').textContent]));
    ok('masks ranked biggest first, the full mask on every rewritten title with a pattern', mr.length === 3 && mr[0][0] === 'Brand+Gender+Colour+Pattern+Material+Item type+Size' && mr[0][1].indexOf('· ' + FULL) >= 0, mr);
    ok('the unchanged titles keep the master’s own mask', mr.some((m) => m[0] === 'Item type+Colour' && m[1].indexOf('· ' + SAME) >= 0), mr);
    await pg.click('#mside [data-s="b"]');
    ok('Master feed shows the one mask every master title has', await pg.$$eval('#masks .mrow', (els) => els.length === 1 && /100%/.test(els[0].textContent)));
    await pg.click('#mside [data-s="a"]');
    const ar = await pg.$$eval('#attrs .arow', (els) => els.map((e) => e.querySelector('.mk').textContent + ' ' + e.querySelector('.v').childNodes[0].textContent));
    ok('each attribute’s share of titles, before → after', ar.indexOf('Material 0% → ' + Math.round(CH / N * 100) + '%') >= 0 && ar.indexOf('Colour 100% → 100%') >= 0, ar);
    await pg.click('#masks .mrow >> nth=0'); await pg.waitForTimeout(150);
    ok('clicking a mask opens the list on exactly those titles', (await fold()).indexOf('list:1') >= 0 && (await pg.textContent('#cnt')) === FULL + ' of ' + N + ' titles' && (await pg.$$('#list-t tbody tr[data-x]')).length === FULL, await pg.textContent('#cnt'));
    await pg.click('#fchips [data-clear="mask"]');
    ok('…and ✕ on the chip clears it', (await pg.textContent('#cnt')) === N + ' of ' + N + ' titles');

    console.log('· the title against the fields');
    await pg.click('#sec-chk .sec-h');
    const row = (label) => pg.evaluate((label) => { const tr = Array.from(document.querySelectorAll('#chk-t tbody tr')).find((r) => r.cells[0].textContent === label); return Array.from(tr.cells).slice(1, 5).map((c) => +c.textContent.replace(/\D/g, '')); }, label);
    ok('material: agree, in the title not in the field, differ, field only', JSON.stringify(await row('Material')) === JSON.stringify([CH - MAT_GAP.length, MAT_GAP.length, 0, P.filter((p) => p.same && p.fieldMat).length]), await row('Material'));
    ok('colour: the one difference', JSON.stringify(await row('Colour')) === JSON.stringify([N - 1, 0, 1, 0]), await row('Colour'));
    const prs = await pg.$$eval('#pairs .prow', (els) => els.map((e) => e.textContent));
    ok('the commonest gaps are named: what the title says against what the field says', prs.length === MAT_GAP.length + 1 && prs.some((x) => /Colour.*title says Black · field says Blue.*1$/.test(x)) && prs.some((x) => /Material.*field is empty/.test(x)), prs);
    await pg.click('#chk-t [data-ck="material|title_only"]'); await pg.waitForTimeout(150);
    const ids = await pg.$$eval('#list-t tbody tr[data-x] td.mono', (els) => els.map((e) => e.textContent));
    ok('a count opens exactly those titles', ids.join() === MAT_GAP.map((p) => p.id).join(), ids);
    const [tab] = await Promise.all([ctx.waitForEvent('page'), pg.click('#chk-t [data-brief="material"]')]);
    await tab.waitForLoadState('domcontentloaded').catch(() => {});
    const u = tab.url(); let payload = null; try { payload = JSON.parse(Buffer.from(u.split('brief=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) {}
    ok('→ Brief opens Workflow in a NEW tab, this page staying put', /\/workflow\?brief=/.test(u) && /Titles/.test(pg.url()), u.slice(0, 80));
    ok('…the task names the attribute, the brand and the market; the scope carries the count and examples', payload && /^Title Fix - Material in title, not in field - Northwind GB - \d{4}$/.test(payload.task) && payload.cat === 'technical' && payload.scope.indexOf(MAT_GAP.length + ' titles name a material') >= 0 && payload.scope.indexOf(MAT_GAP[0].id) >= 0, payload);
    await tab.close();
    await pg.click('#fchips [data-clear="chk"]');

    console.log('· every title');
    await pg.click('#views [data-v="same"]');
    ok('Unchanged lists the titles the stub left alone', (await pg.$$('#list-t tbody tr[data-x]')).length === SAME);
    await pg.click('#views [data-v="look"]');
    ok('To look at lists the gaps', (await pg.$$('#list-t tbody tr[data-x]')).length === MAT_GAP.length + 1);
    await pg.click('#views [data-v="all"]');
    await pg.fill('#q', 'tote bag'); await pg.waitForTimeout(300);
    const totes = P.filter((p) => p.type === 'Tote Bag').length;
    ok('a word filters the list', (await pg.$$('#list-t tbody tr[data-x]')).length === totes, totes);
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#csv')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').trim().split('\n');
    ok('⬇ CSV carries the listed titles with both masks and the checks', csv.length === totes + 1 && /^Product ID,Before title,.*Mask before,Mask after,Change/.test(csv[0]) && /Material · title vs field/.test(csv[0]) && csv[1].indexOf('Item type + Colour') >= 0, csv.slice(0, 2));
    await pg.fill('#q', ''); await pg.waitForTimeout(300);
    await pg.click('#list-t tbody tr[data-x] >> nth=5');
    ok('a row adds that product to Side by side', await pg.evaluate((id) => document.querySelector('#sbs .pc .id').textContent === id, P[5].id));
    ok('an unchanged title’s card says Unchanged', /Unchanged/.test(await pg.textContent('#sbs .pc .kind')));

    console.log('· folds');
    await pg.click('#foldall');
    ok('⊕ Open all opens every section', (await fold()) === 'sum:1 sbs:1 mask:1 chk:1 list:1 how:1', await fold());
    await pg.click('#foldall');
    ok('⊖ Fold all folds every section', (await fold()) === 'sum:0 sbs:0 mask:0 chk:0 list:0 how:0', await fold());
    await pg.click('#sec-mask .sec-h');
    await pg.reload(); await ready(pg);
    ok('the choice is this device’s and survives a reload', (await fold()) === 'sum:0 sbs:0 mask:1 chk:0 list:0 how:0', await fold());
    await pg.evaluate(() => { location.hash = '#sec-chk'; }); await pg.waitForTimeout(150);
    ok('a #hash opens the section it names', (await fold()).indexOf('chk:1') >= 0);
    ok('no console or page error', errs.length === 0, errs);
    await ctx.close();

    console.log('· no master feed');
    const c2 = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p2 = await c2.newPage(); await p2.addInitScript(stub(true)); await p2.goto('file://' + tmp); await ready(p2);
    const s2 = await p2.textContent('#mstate');
    ok('the status says there is no master and that before is the original-title stamp', /no master title to compare with/.test(s2) && /original title FeedSpark stamps/.test(s2), s2);
    ok('…the story never calls the stamp the master feed', /original title FeedSpark stamps/.test(await p2.textContent('#story')) && !/master feed carries/.test(await p2.textContent('#story')));
    ok('…and the cards label the before as the stamp', /Original title · c:fs_data_original_title/.test(await p2.textContent('#sbs .pc .side.before .cap')));
    await c2.close();

    console.log('· 390px');
    const ph = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    const pp = await ph.newPage(); const perr = []; pp.on('pageerror', (e) => perr.push(e.message));
    await pp.addInitScript(stub(false)); await pp.goto('file://' + tmp); await ready(pp);
    await pp.click('#foldall');
    const m = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, cards: document.querySelectorAll('#sbs .pc').length, cardW: document.querySelector('#sbs .pc').getBoundingClientRect().width }));
    ok('nothing scrolls sideways; the cards stack one a row inside the screen', m.sw <= m.iw + 1 && m.cards === 6 && m.cardW <= m.iw, m);
    ok('no page error on the phone', perr.length === 0, perr);
    await ph.close();
  } finally { await b.close(); }
  console.log('\n' + (fail ? '✗' : '✓') + ' Title Lab: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
