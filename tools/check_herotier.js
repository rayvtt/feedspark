#!/usr/bin/env node
/*
 * tools/check_herotier.js — /stock hero sizes, AT THE TIER OF PT YOU PICK.
 *
 * Ray, 30 Sep 2026, circling the PRODUCT TYPE head of the hero-size card: "can you allow tier 2, tier 3 of PT to be
 * chosen too ? sometimes no need too much granulartiy". The census now places every master row on the Google Shopping
 * feed's own product_type tree and keeps each type at its finest level; the card rolls them up to the tier picked, and a
 * list set at a tier reaches every finer type under it. What a person sees and does is a property of the rendered page,
 * so this drives the real page through Chromium on the synthetic stub (tools/rules_stub.js — an invented master placed
 * on an invented feed tree, no real figure) and checks:
 *
 *   · the PT tier control lists every tier the census offers, each with its count of types, and opens on the engine's
 *     default tier; picking a tier lists exactly that tier's types (the rows ARE the tier: the negative control)
 *   · a name several rows share leads with its department ("Women › Clothing", "Men › Clothing")
 *   · the choice is remembered per brand on this device, and survives a reload
 *   · ticking a size at tier 2 saves THAT tier's key, and the tier-3 types under it then read "⤴ Tier 2"
 *   · a list set below a row is named on the row ("1 type under it sets its own"); a master-only type is badged
 *   · the hero-stock headline does not move with the tier (it is the brand's, on every type's own list)
 *   · on a phone the control stays inside the screen and the page never scrolls sideways
 *   · THE BRAND'S OWN DOCUMENT (Ray, 5 Oct 2026, Superdry's category × gender table): the guide row names it and the
 *     markets it is written for; ⊞ Rows opens it row by row against this market (a row reaching part of a type, a row
 *     whose sizes are not made here, a row naming no type here, FeedSpark's note); "Document doesn't fit" lists exactly
 *     the types it can't measure; a market chip saves the document with that market added; the panel pans on a phone
 *
 * Run: node tools/check_herotier.js      (PW_CHROMIUM overrides the browser path)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'docs');
const RS = require('./rules_stub.js');
const H = require(path.join(D, 'herosize_engine.js'));
const HB = RS.build().hero;
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
// the worker's injected layers (the phone layer turns the module row into a bottom bar — without it a 390px topbar wraps
// into a wall over the page), put where worker.js › inject() puts them: the first </body>, else the end
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html', 'mobile_widget.html', 'digest_widget.html', 'migration_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const PAGE = fs.readFileSync(process.env.STOCK_PAGE || path.join(D, 'FeedSpark_Stock.html'), 'utf8').split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
const HTML = PAGE.indexOf('</body>') >= 0 ? PAGE.replace('</body>', WIDGETS + '</body>') : PAGE + '\n' + WIDGETS;
const TMP = path.join(require('os').tmpdir(), 'fcc_herotier_' + process.pid + '.html');
fs.writeFileSync(TMP, HTML);

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
// the hero route answers from a store the page's own PUTs write into, so a save reads back as the server would
const STUB = (keep) => `${keep ? '' : 'try{localStorage.clear();}catch(e){}'}
window.__puts=[];var HB=${JSON.stringify(HB)};
window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 if(url.indexOf('/api/rules/hero')>=0&&opts&&opts.method==='PUT'){var body=JSON.parse(opts.body);window.__puts.push(body);Object.keys(body).forEach(function(k){if(k==='_deleted')body[k].forEach(function(d){delete HB.store[d];});else HB.store[k]=body[k];});return j({ok:true,saved:Object.keys(body).length,store:HB.store});}
 if(url.indexOf('/api/rules/hero')>=0)return j(HB);
${RS.stubLines().split('\n').filter((l) => l.indexOf('/api/rules/hero') < 0).join('\n')}
 return j({ok:false,error:'stub'},404);};`;

async function open(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h || 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/^https?:\/\//, (r) => r.abort());
  await p.addInitScript(STUB(false));
  await p.goto('file://' + TMP);
  // attached, not visible: on a phone the skim view folds every card until it is opened
  await p.waitForSelector('#hm-t tbody tr', { timeout: 10000, state: 'attached' });
  return { ctx, p, errs };
}
const state = (p) => p.evaluate(() => ({
  on: (document.querySelector('#hm-tiers button.on') || {}).textContent || '',
  tiers: Array.from(document.querySelectorAll('#hm-tiers button')).map((b) => ({ t: +b.getAttribute('data-tier'), k: (b.querySelector('.k') || {}).textContent || '', tip: b.title })),
  rows: Array.from(document.querySelectorAll('#hm-t tbody tr[data-hi]')).map((tr) => ({ name: tr.querySelector('td.nm b').textContent, full: tr.querySelector('td.nm').title, src: (tr.querySelector('td.hsrc .tg') || {}).textContent || '', note: Array.from(tr.querySelectorAll('td.hsrc .sub2')).map((x) => x.textContent).join(' '), badges: Array.from(tr.querySelectorAll('td.nm .mo')).map((x) => x.textContent) })),
  head: (document.querySelector('#hm-sum .it:nth-child(2) b') || {}).textContent || '',
}));

(async () => {
  const exe = process.env.PW_CHROMIUM || undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const cen = HB.census, TS = H.tiers(cen), DEF = H.defaultTier(cen);
  const sizedAt = (L) => H.tierTypes(cen, L).filter((t) => t.sz.length).length;

  console.log('· the PT tier control');
  {
    const { ctx, p, errs } = await open(browser, 1440);
    let st = await state(p);
    ok('every tier the census offers, each with its count of types, in tree order', st.tiers.length === TS.length && TS.length >= 3
      && st.tiers.every((x, i) => x.t === TS[i].t && +x.k === TS[i].types && /product types/.test(x.tip)), st.tiers);
    ok('it opens on the engine’s default tier until one is picked', st.on.indexOf('Tier ' + DEF) === 0, st.on);
    ok('the default tier lists that tier’s sized types', st.rows.length === sizedAt(DEF), [st.rows.length, sizedAt(DEF)]);
    await p.click('#hm-tiers button[data-tier="2"]');
    st = await state(p);
    ok('picking tier 2 lists exactly tier 2’s types', st.on.indexOf('Tier 2') === 0 && st.rows.length === sizedAt(2) && st.rows.every((r) => r.full.split(' › ').length <= 2), st.rows.map((r) => r.full));
    // NEGATIVE CONTROL: the rows ARE the tier — tier 2 and the finest tier list different sets, so a card that ignored the
    // control would fail the line above on one of them
    ok('negative control: tier 2 and the finest tier are different lists (the control changes the rows)', sizedAt(2) !== sizedAt(TS[TS.length - 1].t));
    ok('a name several tier-2 rows share leads with its department', st.rows.some((r) => r.name === 'Women › Clothing') && st.rows.some((r) => r.name === 'Men › Clothing'), st.rows.map((r) => r.name));
    const men = st.rows.find((r) => r.name === 'Men › Clothing') || {};
    ok('a list set below a row is named on it ("1 type under it sets its own")', /1 type under it sets its own/.test(men.note), men);
    ok('a master-only type is badged as the master’s own word', st.rows.some((r) => r.badges.indexOf('master type') >= 0), st.rows.map((r) => r.badges));
    const head2 = st.head;
    await p.click('#hm-tiers button[data-tier="3"]');
    st = await state(p);
    ok('the hero-stock headline does not move with the tier', st.head === head2 && !!head2, [head2, st.head]);
    ok('tier-3 types under a tier-2 list read "⤴ Tier 2"', st.rows.filter((r) => r.full.indexOf('Men › Clothing ›') === 0 && r.src === '⤴ Tier 2').length >= 1, st.rows.map((r) => r.full + ' ' + r.src));
    ok('no page errors', errs.length === 0, errs);

    console.log('· remembered per brand on this device');
    const saved = await p.evaluate(() => localStorage.getItem('fcc-stock-hmtier'));
    ok('the pick is stored per brand', saved === JSON.stringify({ Superdry: 3 }), saved);
    await p.evaluate((s) => { localStorage.setItem('fcc-stock-hmtier', s); }, saved);
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const p2 = await ctx2.newPage();
    await p2.route(/^https?:\/\//, (r) => r.abort());
    await p2.addInitScript('try{localStorage.setItem("fcc-stock-hmtier",' + JSON.stringify(saved) + ');}catch(e){}' + STUB(true));
    await p2.goto('file://' + TMP); await p2.waitForSelector('#hm-t tbody tr');
    ok('…and a new page opens on it', (await state(p2)).on.indexOf('Tier 3') === 0, (await state(p2)).on);
    await ctx2.close();
  }

  console.log('· a list set at a tier');
  {
    const { ctx, p, errs } = await open(browser, 1440);
    await p.click('#hm-tiers button[data-tier="2"]');
    await p.click('#hm-edit');
    await p.click('#hm-t tbody tr:has(td.nm b:text-is("Shoes")) button.sz[data-hs="UK 7"]');
    await p.waitForTimeout(800);
    const puts = await p.evaluate(() => window.__puts);
    const key = puts.length ? Object.keys(puts[0])[0] : '';
    ok('ticking a size at tier 2 saves THAT tier’s key, starting from the list it read', key === 'm:Superdry|women > shoes' && puts[0][key].s.indexOf('UK 7') >= 0 && puts[0][key].s.length >= 2, puts);
    await p.click('#hm-edit');
    await p.click('#hm-tiers button[data-tier="3"]');
    const st = await state(p);
    const tr = st.rows.find((r) => r.full === 'Women › Shoes › Trainers') || {};
    ok('the tier-3 type under it now reads the tier-2 list ("⤴ Tier 2")', tr.src === '⤴ Tier 2', tr);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('· the brand’s own document, as written');
  {
    const { ctx, p, errs } = await open(browser, 1440);
    await p.click('#hm-tiers button[data-tier="3"]');
    const g = await p.evaluate(() => ({ txt: document.getElementById('hm-guide').innerText, btn: !!document.querySelector('#hm-guide [data-g="docrows"]') }));
    ok('the guide row names the document, its rows and the markets it is written for', /Superdry hero sizes/.test(g.txt) && /3 rows · GB/.test(g.txt) && g.btn, g.txt);
    await p.click('#hm-guide [data-g="docrows"]');
    const rows = await p.evaluate(() => Array.from(document.querySelectorAll('#hm-dt tbody tr')).map((tr) => ({ c: tr.cells[0].innerText, fit: tr.cells[3].innerText, note: tr.cells[4].innerText })));
    ok('⊞ Rows: every row as written, each with what it reaches here', rows.length === 3 && rows[0].c === 'Tops' && rows[1].c === 'Bralettes' && rows[2].c === 'Swimwear', rows);
    ok('…a row reaching part of a type says so; a row whose sizes are not made here says what the type is made in', /only in part/.test(rows[0].fit) && /doesn’t fit/.test(rows[1].fit) && /made in XS–L/.test(rows[1].fit), rows);
    ok('…a row naming no type here says so, and FeedSpark’s note travels with its row', /no product type in GB/.test(rows[2].fit) && /which sizes are the heroes/.test(rows[0].note), rows);
    await p.click('#hm-f [data-hf="fit"]');
    let st = await state(p);
    ok('"Document doesn’t fit" lists exactly the types it can’t measure, each tagged', st.rows.length === 2 && st.rows.some((r) => /Bralettes/.test(r.full) && r.src === '📄 Doesn’t fit') && st.rows.some((r) => /Tops/.test(r.full) && /^📄 Part · /.test(r.src)), st.rows.map((r) => r.full + ' ' + r.src));
    await p.click('#hm-dmk button[data-dmk="DE"]');
    await p.waitForTimeout(800);
    const puts = await p.evaluate(() => window.__puts);
    const last = puts[puts.length - 1] || {}, dput = last['d:Superdry'];
    ok('a market chip saves the document with that market added — its rows untouched', !!dput && JSON.stringify(dput.mk) === JSON.stringify(['GB', 'DE']) && dput.rows.length === 3, puts);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(browser, 390, 844);
    await p.evaluate(() => window.FCCDigest && window.FCCDigest.expandAll && window.FCCDigest.expandAll());
    await p.waitForSelector('#hm-guide [data-g="docrows"]', { timeout: 10000 });
    await p.click('#hm-guide [data-g="docrows"]');
    const g = await p.evaluate(() => { const t = document.getElementById('hm-dt'), w = t.closest('.tw'); return { tw: t.getBoundingClientRect().width, ww: w.getBoundingClientRect().width, pan: getComputedStyle(w).overflowX, over: document.documentElement.scrollWidth - innerWidth }; });
    ok('on a phone the rows panel pans inside its own frame — the page never scrolls sideways', g.tw > g.ww && /auto|scroll/.test(g.pan) && g.over <= 0, g);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  console.log('· a phone');
  {
    const { ctx, p, errs } = await open(browser, 390, 844);
    await p.evaluate(() => window.FCCDigest && window.FCCDigest.expandAll && window.FCCDigest.expandAll());
    await p.waitForSelector('#hm-tiers button', { timeout: 10000 });
    await p.evaluate(() => document.getElementById('hm-tiers').scrollIntoView({ block: 'center' }));
    const g = await p.evaluate(() => { const r = document.getElementById('hm-tiers').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, over: document.documentElement.scrollWidth - innerWidth }; });
    ok('the tier control stays inside the screen', g.l >= 0 && g.r <= g.w + 0.5, g);
    ok('no sideways overflow', g.over <= 0, g.over);
    await p.click('#hm-tiers button[data-tier="2"]');
    ok('a tier is one tap away', (await state(p)).on.indexOf('Tier 2') === 0);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
  }

  await browser.close();
  try { fs.unlinkSync(TMP); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { fs.unlinkSync(TMP); } catch (x) {} process.exit(1); });
