#!/usr/bin/env node
/*
 * tools/check_stocklevers.js — /stock STOCK LEVERS, BAU ↔ SALE, as a person uses it.
 *
 * Ray, 5 Oct 2026: "summarise a stock management dashboard for Superdry (specifically) eahc of those markets have got
 * quite aan interesting mix of stock levers : 1 . Range Completion (20-40%, currently at 35%) - 2. Stock unit exclusion
 * for Everest (previously >5 units per size, now N/A) - 3. Hero Sizes (current activated, follow the mapping above) -
 * build an facilitor interface to action BAU vs. SALE perido". What a person sees and does is a property of the rendered
 * page, so this drives the real page through Chromium on the synthetic stub (tools/rules_stub.js — invented rules and an
 * invented plan, no real figure) and checks:
 *
 *   · on All brands the card offers the brands with a plan, one tap away
 *   · for a brand: four tiles of one size, three lever tiles of one size, the market × lever table with every roster
 *     market (one not read yet says so), a market off plan marked, a SALE value to consider with its reason
 *   · planning a sale period saves its key with the markets picked; ✓ Switched marks the switch and the markets read SALE
 *   · editing a lever, using a suggestion, a market's own values and "Keep as it runs" each save the key they should
 *   · ⧉ Copy summary is the dashboard in words; → Brief marks the switch briefed BEFORE it opens the Workflow composer
 *     with the switch as the brief
 *   · on a phone the lever tiles stack, the tiles pair, the table pans in its own frame and the page never scrolls sideways
 *
 * Run: node tools/check_stocklevers.js      (PW_CHROMIUM overrides the browser path)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'docs');
const RS = require('./rules_stub.js');
const LB = RS.build().levers;
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html', 'mobile_widget.html', 'digest_widget.html', 'migration_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const PAGE = fs.readFileSync(process.env.STOCK_PAGE || path.join(D, 'FeedSpark_Stock.html'), 'utf8').split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
const HTML = PAGE.indexOf('</body>') >= 0 ? PAGE.replace('</body>', WIDGETS + '</body>') : PAGE + '\n' + WIDGETS;

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
// the levers route answers from a store the page's own PUTs write into (as the server would, stamping a moved step)
const STUB = `try{localStorage.clear();}catch(e){}
window.__puts=[];window.__copied='';var LB=${JSON.stringify(LB)};
try{Object.defineProperty(navigator,'clipboard',{value:{writeText:function(s){window.__copied=s;return Promise.resolve();}},configurable:true});}catch(e){}
window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 if(url.indexOf('/api/rules/levers')>=0&&opts&&opts.method==='PUT'){var body=JSON.parse(opts.body);window.__puts.push(body);if(window.__putSeen)window.__putSeen(opts.body);
  if(window.__fail){window.__fail=0;return j({ok:false,error:'refused (test)'},500);}Object.keys(body).forEach(function(k){if(k==='_deleted')body[k].forEach(function(d){delete LB.store[d];});else{var v=JSON.parse(JSON.stringify(body[k]));['sale','bau'].forEach(function(s){if(v[s]&&v[s].st&&v[s].st!=='planned'){v[s].by='Tester';v[s].at=Date.now();}});LB.store[k]=v;}});var resp=j({ok:true,saved:Object.keys(body).length,store:JSON.parse(JSON.stringify(LB.store)),brands:LB.brands});
  if(window.__slow){var ms=window.__slow;window.__slow=0;window.__inflight=1;return new Promise(function(r){setTimeout(r,ms);}).then(function(){window.__inflight=0;return resp;});}
  return resp;}
 if(url.indexOf('/api/rules/levers')>=0)return j(LB);
${RS.stubLines().split('\n').filter((l) => l.indexOf('/api/rules/levers') < 0).join('\n')}
 return j({ok:false,error:'stub'},404);};`;

async function open(browser, w, h, q) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h || 1000 } });
  const p = await ctx.newPage();
  const errs = [], seen = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // every PUT the page sends, recorded in node — a brief NAVIGATES, and a record kept in the page would go with it
  await p.exposeBinding('__putSeen', (src, body) => { try { seen.push(JSON.parse(body)); } catch (e) {} });
  // served from an http origin, so → Brief's navigation to /workflow lands on a page (from file:// it is a missing file,
  // and the navigation throws before anything can be read); every other host is refused
  await p.route(/^https?:\/\//, (r) => {
    const u = new URL(r.request().url());
    if (u.host !== 'fcc.test') return r.abort();
    if (u.pathname === '/stock') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML });
    if (u.pathname === '/workflow') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>Workflow</title><p>Workflow</p>' });
    return r.abort();
  });
  await p.addInitScript(STUB);
  await p.goto('http://fcc.test/stock' + (q || ''));
  await p.waitForSelector('#lev-card:not([hidden])', { timeout: 10000, state: 'attached' });
  return { ctx, p, errs, seen };
}
const boxes = (p, sel) => p.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }), sel);
const rows = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#lev-t tbody tr[data-mk]')).map((tr) => ({ mk: tr.getAttribute('data-mk'), mode: (tr.querySelector('.mode') || {}).textContent || '', cells: Array.from(tr.querySelectorAll('td.lc')).map((td) => ({ v: (td.querySelector('.v') || td).textContent.trim(), pl: (td.querySelector('.pl') || {}).textContent || '', off: td.classList.contains('off') })) })));
const lastPut = (p) => p.evaluate(() => window.__puts[window.__puts.length - 1] || null);

(async () => {
  const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    console.log('· All brands — the brands with a plan, one tap away');
    let { ctx, p, errs } = await open(browser, 1440, 1000);
    await p.waitForSelector('#lev-brands [data-lvb]', { timeout: 10000 });
    const chip = await p.$eval('#lev-brands [data-lvb]', (b) => b.textContent);
    ok('a chip per brand with a plan, its levers and sale periods counted', /Superdry/.test(chip) && /3 levers/.test(chip) && /1 sale period/.test(chip), chip);
    await p.click('#lev-brands [data-lvb="Superdry"]');
    await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000 });
    ok('…a tap opens the brand (the page’s own brand select follows)', (await p.$eval('#brand', (s) => s.value)) === 'Superdry');
    await ctx.close();

    console.log('· a brand, laid out for a client screen');
    let seen;
    ({ ctx, p, errs, seen } = await open(browser, 1440, 1000, '?brand=Superdry'));
    await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000 });
    const tiles = await boxes(p, '#lev-sum .it');
    ok('four tiles, one row, one size', tiles.length === 4 && new Set(tiles.map((b) => b.y)).size === 1 && Math.max(...tiles.map((b) => b.w)) - Math.min(...tiles.map((b) => b.w)) <= 1, tiles);
    const lv = await boxes(p, '#lev-plan .lv');
    ok('three lever tiles, one row, one size, one height', lv.length === 3 && new Set(lv.map((b) => b.y)).size === 1 && Math.max(...lv.map((b) => b.w)) - Math.min(...lv.map((b) => b.w)) <= 1 && Math.max(...lv.map((b) => b.h)) - Math.min(...lv.map((b) => b.h)) <= 1, lv);
    const plan = await p.evaluate(() => Array.from(document.querySelectorAll('#lev-plan .lv')).map((x) => x.textContent.replace(/\s+/g, ' ')));
    ok('range completion: BAU 30%, SALE not set, its band — and a SALE value to consider, with its reason', /Range completion/.test(plan[0]) && /BAU\s*30%/.test(plan[0]) && /SALE\s*not set/.test(plan[0]) && /band 20–40%/.test(plan[0]) && /To consider for SALE: 20% — the band’s floor/.test(plan[0]), plan[0]);
    ok('stock unit exclusion · Everest: BAU N/A, what it ran at before offered for SALE', /Everest/.test(plan[1]) && /BAU\s*N\/A/.test(plan[1]) && /> 5 units per size/.test(plan[1]), plan[1]);
    ok('hero sizes: BAU on, no SALE value offered (nothing in the rules says which way)', /Hero sizes/.test(plan[2]) && /BAU\s*on/.test(plan[2]) && !/To consider/.test(plan[2]), plan[2]);
    let R = await rows(p);
    ok('every roster market is a row — one not read yet says so', R.map((r) => r.mk).join(',') === 'GB,DE,FR' && R[2].cells.every((c) => /not read yet/.test(c.v)), R);
    ok('GB: 35% measured from the products, off a 30% plan — marked', /35% measured from the products/.test(R[0].cells[0].v) && R[0].cells[0].off && /plan 30%/.test(R[0].cells[0].pl), R[0]);
    ok('DE: range completion runs with no stated line — never called off plan', /no stated line/.test(R[1].cells[0].v) && !R[1].cells[0].off, R[1]);
    ok('hero sizes on, units N/A — on plan in both read markets', R.slice(0, 2).every((r) => /no such rule/.test(r.cells[1].v) && !r.cells[1].off && r.cells[2].v === 'on' && !r.cells[2].off), R);
    ok('the off-plan tile counts it, and filters to it', /1 of 3/.test(await p.$eval('#lev-sum .it.lv-go b', (b) => b.textContent)));
    await p.click('#lev-sum .it.lv-go');
    ok('…the table lists only the market off plan', (await rows(p)).map((r) => r.mk).join(',') === 'GB');
    await p.click('#lev-f [data-lvf2=""]');

    console.log('· keep a market as it runs, a market’s own values, edit a lever, use a suggestion');
    await p.click('#lev-t tr[data-mk="GB"] [data-act="lv-keep"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; return b && b['m:Superdry|GB']; }, null, { timeout: 5000 });
    let put = await lastPut(p);
    ok('"Keep as it runs" makes what GB runs its own BAU (35% · N/A · on)', put['m:Superdry|GB'].lv.rc.bau === 35 && put['m:Superdry|GB'].lv.units.bau === 'off' && put['m:Superdry|GB'].lv.hero.bau === 'on', put);
    R = await rows(p);
    ok('…and GB reads on plan, its own value named', !R[0].cells[0].off && /own 35%/.test(R[0].cells[0].pl), R[0]);
    ok('…the off-plan tile follows (0 of 3) and the bulk button goes', /0 of 3/.test(await p.$eval('#lev-sum .it.lv-go b', (b) => b.textContent)) && await p.$eval('#lev-adopt', (b) => b.hidden));
    await p.click('#lev-t tr[data-mk="DE"] [data-act="lv-medit"]');
    await p.fill('#lev-t tr.med[data-mk="DE"] td[data-lk="rc"] [data-lvf="bau"]', '25');
    await p.click('#lev-t tr.med [data-act="lv-msave"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; return b && b['m:Superdry|DE']; }, null, { timeout: 5000 });
    put = await lastPut(p);
    ok('a market’s own value saves its key — the blank levers left to the brand', JSON.stringify(put['m:Superdry|DE']) === JSON.stringify({ lv: { rc: { bau: 25, sale: null } } }), put);
    await p.click('#lev-plan .lv[data-lk="hero"] [data-act="lv-edit"]');
    await p.selectOption('#lev-plan .lv.ed [data-lvf="sale"]', 'off');
    await p.click('#lev-plan .lv.ed [data-act="lv-save"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; return b && b['p:Superdry']; }, null, { timeout: 5000 });
    put = await lastPut(p);
    ok('✎ Edit → SALE off saves the plan with hero sizes off for SALE, everything else as it was', put['p:Superdry'].levers.filter((l) => l.k === 'hero')[0].sale === 'off' && put['p:Superdry'].levers.filter((l) => l.k === 'rc')[0].bau === 30, put);
    await p.click('#lev-plan .lv[data-lk="rc"] [data-act="lv-sug"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; const l = b && b['p:Superdry'] && b['p:Superdry'].levers.filter((x) => x.k === 'rc')[0]; return l && l.sale === 20; }, null, { timeout: 5000 });
    ok('"Use it" sets that SALE value — and only on a click', /SALE\s*20%/.test(await p.$eval('#lev-plan .lv[data-lk="rc"]', (x) => x.textContent.replace(/\s+/g, ' '))));

    console.log('· plan a sale period, and switch');
    await p.click('[data-act="lv-new"]');
    await p.fill('#lvf-name', 'Test sale');
    await p.fill('#lvf-from', '2026-11-20');
    await p.fill('#lvf-to', '2026-11-30');
    await p.click('.lvf-mk [data-lvm="FR"]');
    ok('the form keeps what was typed when a market chip re-draws it', (await p.$eval('#lvf-name', (i) => i.value)) === 'Test sale');
    await p.click('[data-act="lv-add"]');
    await p.waitForFunction(() => window.__puts.some((b) => Object.keys(b).some((k) => /^e:Superdry\|test-sale-/.test(k))), null, { timeout: 5000 });
    const put1 = await p.evaluate(() => window.__puts.filter((b) => Object.keys(b).some((k) => /^e:Superdry\|test-sale-/.test(k)))[0]);
    const pk = Object.keys(put1)[0], pv = put1[pk];
    ok('a period saves its key: name, dates, the markets picked (FR left out), both steps planned', pv.name === 'Test sale' && pv.from === '2026-11-20' && pv.to === '2026-11-30' && pv.mk.join(',') === 'GB,DE' && pv.sale.st === 'planned' && pv.bau.st === 'planned', put1);
    await p.waitForSelector('.per[data-p="' + pk.split('|')[1] + '"]');
    ok('…and reads back as a period with a switch each way', (await p.$$eval('.per[data-p="' + pk.split('|')[1] + '"] .stp', (x) => x.length)) === 2);
    const per0 = '.per[data-p="peak-test"]';
    const sw = await p.$eval(per0 + ' details.sw', (d) => d.textContent.replace(/\s+/g, ' '));
    ok('the switch list names what to change, market by market: GB 35% → 20%, DE 25% → 20%, hero sizes on → off, and the rules', /Range completion 35% → 20% GB/.test(sw) && /Range completion 25% → 20% DE/.test(sw) && /Hero sizes on → off GB, DE/.test(sw) && /“Range completion percentage”/.test(sw), sw);
    ok('…each rule opens on FeedHero', (await p.$$eval(per0 + ' details.sw a.fh', (a) => a.filter((x) => /mcp\.feedhero\.net\/reports\/rule-report/.test(x.href)).length)) > 0);
    await p.click(per0 + ' .stp[data-dir="sale"] [data-act="lv-done"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; return b && b['e:Superdry|peak-test'] && b['e:Superdry|peak-test'].sale.st === 'done'; }, null, { timeout: 5000 });
    await p.waitForFunction(() => /switched/.test((document.querySelector('.per[data-p="peak-test"] .stp[data-dir="sale"] .tg') || {}).textContent || ''), null, { timeout: 5000 });
    R = await rows(p);
    ok('✓ Switched marks the switch made — the period’s markets read SALE, the one outside it BAU', R[0].mode === 'SALE' && R[1].mode === 'SALE' && R[2].mode === 'BAU', R.map((r) => r.mode));
    ok('…held to their SALE values now (GB: plan 20%)', /plan 20%/.test(R[0].cells[0].pl), R[0]);
    ok('…the tile says so', /SALE · 2/.test(await p.$eval('#lev-sum .it b', (b) => b.textContent)));
    ok('…who switched it is on the step', /Switched by Tester/.test(await p.$eval(per0 + ' .stp[data-dir="sale"] .tg', (x) => x.title)));

    console.log('· the summary, and the brief');
    await p.click('#lev-copy');
    await p.waitForFunction(() => !!window.__copied, null, { timeout: 5000 });
    const txt = await p.evaluate(() => window.__copied);
    ok('⧉ Copy summary is the dashboard in words', /^Superdry — stock levers, \d{4}-\d{2}-\d{2}/.test(txt) && /• Range completion: BAU 30% · SALE 20% \(band 20–40%\)/.test(txt) && /not read yet — FR/.test(txt) && /Peak sale \(test\)/.test(txt), txt);
    const nPut = seen.length;
    await Promise.all([p.waitForURL(/\/workflow\?brief=/, { timeout: 8000 }), p.click(per0 + ' .stp[data-dir="bau"] [data-act="lv-brief"]')]);
    const briefPut = seen.slice(nPut);
    const raw = decodeURIComponent(new URL(p.url()).searchParams.get('brief') || '');
    const brief = JSON.parse(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    ok('→ Brief opens the Workflow composer: the brand, a technical brief from the levers, the switch back to BAU as the scope', brief.client === 'Superdry' && brief.cat === 'technical' && brief.source === 'stock-levers' && /^Stock Levers - Back to BAU - Peak sale \(test\) - Superdry - 1226$/.test(brief.task)
      && /^Back to BAU — Superdry — Peak sale \(test\)/.test(brief.scope) && /Range completion: 20% → 35% — GB/.test(brief.scope) && /Range completion: 20% → 25% — DE/.test(brief.scope) && /Hero sizes: off → on — GB, DE/.test(brief.scope), brief);
    ok('…the switch marked briefed before the page left', briefPut.some((b) => b['e:Superdry|peak-test'] && b['e:Superdry|peak-test'].bau.st === 'briefed'), briefPut);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· → Brief while another save is in flight, and a mark that does not land');
    ({ ctx, p, errs, seen } = await open(browser, 1440, 1000, '?brand=Superdry'));
    await p.waitForSelector('.per[data-p="peak-test"] .stp[data-dir="sale"] [data-act="lv-brief"]', { timeout: 10000 });
    // a save that is still on the wire when → Brief is pressed (the units lever re-saved as it is)
    await p.evaluate(() => { window.__slow = 900; });
    await p.click('#lev-plan .lv[data-lk="units"] [data-act="lv-edit"]');
    await p.click('#lev-plan .lv.ed [data-act="lv-save"]');
    await p.waitForFunction(() => window.__inflight === 1, null, { timeout: 5000 });
    const n2 = seen.length;
    await Promise.all([p.waitForURL(/\/workflow\?brief=/, { timeout: 8000 }), p.click('.per[data-p="peak-test"] .stp[data-dir="sale"] [data-act="lv-brief"]')]);
    const after = seen.slice(n2);
    ok('…the page waits for that save, sends its OWN mark, and only then leaves', after.some((b) => b['e:Superdry|peak-test'] && b['e:Superdry|peak-test'].sale.st === 'briefed'), after);
    await ctx.close();
    ({ ctx, p, errs, seen } = await open(browser, 1440, 1000, '?brand=Superdry'));
    await p.waitForSelector('.per[data-p="peak-test"] .stp[data-dir="sale"] [data-act="lv-brief"]', { timeout: 10000 });
    await p.evaluate(() => { window.__fail = 1; });
    let asked = '';
    p.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
    const url0 = p.url();
    await p.click('.per[data-p="peak-test"] .stp[data-dir="sale"] [data-act="lv-brief"]');
    // (a page that leaves anyway never shows the warning — read as a failure, not a crash)
    await p.waitForFunction(() => /Not saved/.test((document.querySelector('#lev-warn') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(300);
    ok('a mark the server refused is SAID before the page leaves — and declining keeps the page', /could not be marked briefed/.test(asked) && /refused \(test\)/.test(asked) && p.url() === url0, { asked, url: p.url() });
    ok('…the step still reads planned (nothing claims a brief that was not recorded)', /planned/.test(await p.$eval('.per[data-p="peak-test"] .stp[data-dir="sale"] .tg', (x) => x.textContent).catch(() => '')));
    await ctx.close();

    console.log('· on a phone');
    ({ ctx, p, errs } = await open(browser, 390, 860, '?brand=Superdry'));
    await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000, state: 'attached' });
    await p.evaluate(() => { if (window.FCCDigest && window.FCCDigest.expandAll) window.FCCDigest.expandAll(); });
    await p.waitForTimeout(150);
    const pl = await boxes(p, '#lev-plan .lv');
    ok('the lever tiles stack, one column', pl.length === 3 && new Set(pl.map((b) => b.x)).size === 1 && pl[1].y > pl[0].y, pl);
    const tl = await boxes(p, '#lev-sum .it');
    ok('the tiles pair', tl.length === 4 && new Set(tl.map((b) => b.y)).size === 2, tl);
    const ov = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth, tw: (() => { const t = document.querySelector('#lev-t'), w = t.closest('.tw'); return { t: t.scrollWidth, w: w.clientWidth, ox: getComputedStyle(w).overflowX }; })() }));
    ok('the page never scrolls sideways; the table pans in its own frame', ov.doc <= ov.vw && ov.tw.t > ov.tw.w && /auto|scroll/.test(ov.tw.ox), ov);
    ok('no page errors on the phone', errs.length === 0, errs);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
