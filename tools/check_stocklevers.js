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
 *   · FOUR LEVERS FOR EVERY BRAND (Ray, 7 Oct 2026: "every client should have these stock levers: 1. range completion 2.
 *     hero sizes 3. stock quantity threshold 4. stock based exclusion"): on All brands the card offers every brand, a plan
 *     or not, one tap away; a brand with no plan still reads all four levers off its rules; the stored `units` lever is
 *     read as the stock-based exclusion; the threshold reads the cut-off a rule's name states ("Stock < 9 -> OOS")
 *   · for a brand: four tiles of one size, four lever tiles of one size, a SALE value to consider with its reason — and
 *     the market × lever MATRIX above them (Ray, 6 Oct 2026: "the lst should be table/ matrix for overview review",
 *     pointing at the coverage matrix): every roster market a row (one not read yet says so), the plan line in each
 *     lever's head, one short value a cell — blue on plan, orange with a dot off plan, muted where no rule runs it — the
 *     detail in the cell's tooltip, an Off plan count per market, lever columns of one width
 *   · a market's own values open in a row UNDER it (✎ toggles it); "Keep as it runs" sits in that row
 *   · the RECORD, kept by hand (Ray, 6 Oct 2026: "maybe there should be a manual table as well to keep record of it"):
 *     newest first, add / edit / delete each save the key they should, an edit keeps who first wrote it down, a switch
 *     marked made is recorded in one click and then says so, the latest record is in its matrix cell's tooltip
 *   · planning a sale period saves its key with the markets picked; ✓ Switched marks the switch and the markets read SALE
 *   · editing a lever, using a suggestion, a market's own values and "Keep as it runs" each save the key they should
 *   · ⧉ Copy summary is the dashboard in words; → Brief marks the switch briefed BEFORE it opens the Workflow composer
 *     with the switch as the brief
 *   · ONE RULE PER LEVER (Ray, 6 Oct 2026: "Each individual stock lever will be connected to one rule, and that rule could
 *     be spotted or aggregated across different markets"): with none connected, a lever more than one rule reads as is
 *     dashed where they overlap; ⛓ Connect a rule picks one as a market runs it (every stock rule on request, another
 *     market on request) and saves it — name, market, field — on the plan; every market then reads that rule alone: the
 *     overlap gone, the head naming the rule and found / total; a market running it under ANOTHER name (Ray, 6 Oct 2026, on
 *     Superdry FR: "system is not picking it up") found by its job, and said so; a market without it reading missing,
 *     the switch list saying copy it there first; ✕ disconnects; ⧉ Copy summary names each lever's rule
 *   · on a phone the lever tiles stack, the tiles pair, the matrix pans in its own frame, a one-line note stays one line
 *     (the page shell's .sc flex-basis once stood one 170px tall) and the page never scrolls sideways
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
const stubFor = (lines) => `try{localStorage.clear();}catch(e){}
window.__puts=[];window.__copied='';var LB=${JSON.stringify(LB)};
try{Object.defineProperty(navigator,'clipboard',{value:{writeText:function(s){window.__copied=s;return Promise.resolve();}},configurable:true});}catch(e){}
window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 if(url.indexOf('/api/rules/levers')>=0&&opts&&opts.method==='PUT'){var body=JSON.parse(opts.body);window.__puts.push(body);if(window.__putSeen)window.__putSeen(opts.body);
  if(window.__fail){window.__fail=0;return j({ok:false,error:'refused (test)'},500);}Object.keys(body).forEach(function(k){if(k==='_deleted')body[k].forEach(function(d){delete LB.store[d];});else{var v=JSON.parse(JSON.stringify(body[k]));['sale','bau'].forEach(function(s){if(v[s]&&v[s].st&&v[s].st!=='planned'){v[s].by='Tester';v[s].at=Date.now();}});
   if(/^r:/.test(k)){var pv=LB.store[k];delete v.by;delete v.at;delete v.ed;if(pv&&pv.by){v.by=pv.by;v.at=pv.at;v.ed={by:'Tester',at:Date.now()};}else{v.by='Tester';v.at=Date.now();}}
   LB.store[k]=v;}});var resp=j({ok:true,saved:Object.keys(body).length,store:JSON.parse(JSON.stringify(LB.store)),brands:LB.brands});
  if(window.__slow){var ms=window.__slow;window.__slow=0;window.__inflight=1;return new Promise(function(r){setTimeout(r,ms);}).then(function(){window.__inflight=0;return resp;});}
  return resp;}
 if(url.indexOf('/api/rules/levers')>=0)return j(LB);
${lines.split('\n').filter((l) => l.indexOf('/api/rules/levers') < 0).join('\n')}
 return j({ok:false,error:'stub'},404);};`;
const STUB = stubFor(RS.stubLines());
// a brand with MANY markets (tools/rules_stub.js build({ many: true }) — nine Superdry markets, markets of one seed reading alike)
const STUB_MANY = stubFor(RS.stubLines({ many: true }));

async function open(browser, w, h, q, extra, stub) {
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
  await p.addInitScript(stub || STUB);
  if (extra) await p.addInitScript(extra);
  await p.goto('http://fcc.test/stock' + (q || ''));
  await p.waitForSelector('#lev-card:not([hidden])', { timeout: 10000, state: 'attached' });
  return { ctx, p, errs, seen };
}
const boxes = (p, sel) => p.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }), sel);
// the matrix as a person reads it: a row per market (an editor row under one is not a market), each cell's value, its state
// (on · off · none) and its tooltip, the market's own-values tag and its Off plan count
const rows = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#lev-t tbody tr[data-mk]:not(.med)')).map((tr) => ({ mk: tr.getAttribute('data-mk'), unread: tr.classList.contains('unread'),
  text: tr.textContent.replace(/\s+/g, ' ').trim(), own: !!tr.querySelector('td.nm .tg'), mode: (tr.querySelector('.mode') || {}).textContent || '', lo: ((tr.querySelector('td.lo') || {}).textContent || '').trim(),
  cells: Array.from(tr.querySelectorAll('td.lc')).map((td) => ({ v: td.textContent.trim(), st: ['on', 'off', 'none'].filter((c) => td.classList.contains(c))[0] || '', off: td.classList.contains('off'), dot: !!td.querySelector('.dot'), tip: td.getAttribute('data-tip') || '' })) })));
const recs = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#lev-rt tbody tr[data-rid]')).map((tr) => ({ id: tr.getAttribute('data-rid'), cells: Array.from(tr.cells).map((c) => c.textContent.replace(/\s+/g, ' ').trim()) })));
const lastPut = (p) => p.evaluate(() => window.__puts[window.__puts.length - 1] || null);

(async () => {
  const exe = process.env.PW_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  try {
    console.log('· All brands — every brand, a plan or not, one tap away');
    let { ctx, p, errs } = await open(browser, 1440, 1000);
    await p.waitForSelector('#lev-brands [data-lvb]', { timeout: 10000 });
    const chips = await p.$$eval('#lev-brands [data-lvb]', (a) => a.map((b) => ({ b: b.getAttribute('data-lvb'), t: b.textContent.replace(/\s+/g, ' ') })));
    ok('a chip per brand — Superdry: 3 markets, 3 of 4 levers planned, 1 sale period; Reiss, with no plan, is there too', chips.length === 2 && chips.some((c) => c.b === 'Superdry' && /3 markets/.test(c.t) && /3 of 4 planned/.test(c.t) && /1 sale period/.test(c.t))
      && chips.some((c) => c.b === 'Reiss' && /2 markets/.test(c.t) && /no plan yet/.test(c.t)), chips);
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
    ok('FOUR lever tiles, one row, one size, one height', lv.length === 4 && new Set(lv.map((b) => b.y)).size === 1 && Math.max(...lv.map((b) => b.w)) - Math.min(...lv.map((b) => b.w)) <= 1 && Math.max(...lv.map((b) => b.h)) - Math.min(...lv.map((b) => b.h)) <= 1, lv);
    const plan = await p.evaluate(() => Array.from(document.querySelectorAll('#lev-plan .lv')).map((x) => ({ k: x.getAttribute('data-lk'), t: x.textContent.replace(/\s+/g, ' ') })));
    ok('in Ray’s order: range completion, hero sizes, stock quantity threshold, stock-based exclusion', plan.map((x) => x.k).join(',') === 'rc,hero,thresh,excl', plan.map((x) => x.k));
    ok('range completion: BAU 30%, SALE not set, its band — and a SALE value to consider, with its reason', /Range completion/.test(plan[0].t) && /BAU\s*30%/.test(plan[0].t) && /SALE\s*not set/.test(plan[0].t) && /band 20–40%/.test(plan[0].t) && /To consider for SALE: 20% — the band’s floor/.test(plan[0].t), plan[0]);
    ok('hero sizes: BAU on, no SALE value offered (nothing in the rules says which way)', /Hero sizes/.test(plan[1].t) && /BAU\s*on/.test(plan[1].t) && !/To consider/.test(plan[1].t), plan[1]);
    ok('stock quantity threshold: never planned — BAU and SALE not set, nothing offered', /Stock quantity threshold/.test(plan[2].t) && /BAU\s*not set/.test(plan[2].t) && /SALE\s*not set/.test(plan[2].t) && !/To consider/.test(plan[2].t), plan[2]);
    ok('stock-based exclusion · Everest (stored as the legacy `units` lever): BAU N/A, what it ran at before offered for SALE', /Stock-based exclusion · Everest/.test(plan[3].t) && /BAU\s*N\/A/.test(plan[3].t) && /> 5 units per size/.test(plan[3].t), plan[3]);
    const order = await p.evaluate(() => ['lev-sum', 'lev-bar', 'lev-tw', 'lev-legend', 'lev-plan', 'lev-per', 'lev-rec'].map((id) => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().top) : null; }));
    ok('overview first: the tiles, the filter, the MATRIX and its legend — then the plan, the sale periods and the record', order.every((y, i) => y !== null && (!i || y > order[i - 1])), order);
    const head = await p.evaluate(() => Array.from(document.querySelectorAll('#lev-t thead th')).map((th) => ({ t: th.textContent.replace(/\s+/g, ' ').trim(), w: th.getBoundingClientRect().width, lev: th.classList.contains('num') && !th.classList.contains('lo') })));
    const lh = head.filter((h) => h.lev);
    ok('a lever per column, each head carrying the plan: BAU 30% · SALE not set · BAU on · SALE not set · BAU not set · SALE not set · BAU N/A · SALE not set', lh.length === 4 && /Range completion\s*BAU 30% · SALE not set/.test(lh[0].t) && /Hero sizes\s*BAU on · SALE not set/.test(lh[1].t)
      && /Stock quantity threshold\s*BAU not set · SALE not set/.test(lh[2].t) && /Stock-based exclusion · Everest\s*BAU N\/A · SALE not set/.test(lh[3].t), head.map((h) => h.t));
    ok('…the lever columns one width', Math.max(...lh.map((h) => h.w)) - Math.min(...lh.map((h) => h.w)) <= 1, lh.map((h) => Math.round(h.w)));
    let R = await rows(p);
    ok('every roster market is a row — named with its products, one not read yet saying so across the levers', R.map((r) => r.mk).join(',') === 'GB,DE,FR' && /^Superdry GB\s*[\d,]+ products/.test(R[0].text) && R[2].unread && R[2].cells.length === 0 && /not read yet/.test(R[2].text) && /Waiting for its first read/.test(R[2].text), R);
    ok('GB: ≈35% measured, off a 30% plan — orange, a dot, the Off plan count 1; the tooltip says what runs, what it is held to, why it is off, and the rules', R[0].cells[0].v === '≈35%' && R[0].cells[0].st === 'off' && R[0].cells[0].dot && R[0].lo === '1'
      && /Runs: 35% measured from the products/.test(R[0].cells[0].tip) && /Held to 30% — the brand’s BAU value/.test(R[0].cells[0].tip) && /Off plan<\/b> — Measured ≈35% — the target is 30%/.test(R[0].cells[0].tip) && /#\d+ Range completion/.test(R[0].cells[0].tip), R[0]);
    ok('DE: range completion runs with no stated line — "runs", blue, never called off plan (✓)', R[1].cells[0].v === 'runs' && R[1].cells[0].st === 'on' && /no stated line/.test(R[1].cells[0].tip) && R[1].lo === '✓', R[1]);
    ok('hero sizes on (blue) and the Everest exclusion N/A (muted — no rule runs it) — on plan in both read markets', R.slice(0, 2).every((r) => r.cells[1].v === 'on' && r.cells[1].st === 'on' && r.cells[3].v === 'N/A' && r.cells[3].st === 'none'), R);
    ok('the stock quantity threshold reads the cut-off each market’s rule name states, in the rule’s own words (GB < 9, DE < 11) — the rule and where the number comes from in the tooltip', R[0].cells[2].v === '< 9' && R[1].cells[2].v === '< 11' && R[0].cells[2].st === 'on'
      && /Runs: stock &lt; 9 in a rule name|Runs: stock < 9 in a rule name/.test(R[0].cells[2].tip) && /The cut-off a rule’s name states/.test(R[0].cells[2].tip) && /#\d+ Stock &lt; 9 -&gt; OOS|#\d+ Stock < 9 -> OOS/.test(R[0].cells[2].tip) && /No BAU value set to hold it to/.test(R[0].cells[2].tip), R[0].cells[2]);
    ok('no cell holds a sentence — a word or a number each, the detail in the tooltip', R.every((r) => r.cells.every((c) => c.v.length <= 10)), R.map((r) => r.cells.map((c) => c.v)));
    ok('the legend names the three states and the marks', /A rule runs it, on plan/.test(await p.$eval('#lev-legend', (x) => x.textContent)) && /Off plan/.test(await p.$eval('#lev-legend', (x) => x.textContent)) && /measured from the products/.test(await p.$eval('#lev-legend', (x) => x.textContent)));
    ok('the latest record for a market × lever is in its cell’s tooltip (GB range completion: 1 Oct, 30% → 35%)', /Recorded 1 Oct: 30% → 35% \(BAU\) — Analyst A/.test(R[0].cells[0].tip), R[0].cells[0].tip);
    ok('the off-plan tile counts it, and filters to it', /1 of 3/.test(await p.$eval('#lev-sum .it.lv-go b', (b) => b.textContent)));
    await p.click('#lev-sum .it.lv-go');
    ok('…the table lists only the market off plan', (await rows(p)).map((r) => r.mk).join(',') === 'GB');
    await p.click('#lev-f [data-lvf2=""]');

    console.log('· keep a market as it runs, a market’s own values, edit a lever, use a suggestion');
    await p.click('#lev-t tr[data-mk="GB"] [data-act="lv-medit"]');
    const edUnder = await p.evaluate(() => { const m = document.querySelector('#lev-t tr.med'); return m ? { mk: m.getAttribute('data-mk'), prev: m.previousElementSibling && m.previousElementSibling.getAttribute('data-mk'), exp: document.querySelector('#lev-t tr[data-mk="GB"]:not(.med) [data-act="lv-medit"]').getAttribute('aria-expanded') } : null; });
    ok('✎ opens the market’s own values in a row directly UNDER it', edUnder && edUnder.mk === 'GB' && edUnder.prev === 'GB' && edUnder.exp === 'true', edUnder);
    await p.click('#lev-t tr.med[data-mk="GB"] [data-act="lv-keep"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; return b && b['m:Superdry|GB']; }, null, { timeout: 5000 });
    let put = await lastPut(p);
    ok('"Keep as it runs" makes what GB runs its own BAU (35% · on · < 9 · N/A) — under the four levers’ keys, never the legacy one', put['m:Superdry|GB'].lv.rc.bau === 35 && put['m:Superdry|GB'].lv.hero.bau === 'on' && put['m:Superdry|GB'].lv.thresh.bau === 9 && put['m:Superdry|GB'].lv.excl.bau === 'off' && !('units' in put['m:Superdry|GB'].lv), put);
    R = await rows(p);
    ok('…and GB reads on plan — its own tag, its own value named in the tooltip, the editor closed', !R[0].cells[0].off && R[0].own && /Held to 35% — its own BAU value/.test(R[0].cells[0].tip) && R[0].lo === '✓' && !(await p.$('#lev-t tr.med')), R[0]);
    ok('…the off-plan tile follows (0 of 3) and the bulk button goes', /0 of 3/.test(await p.$eval('#lev-sum .it.lv-go b', (b) => b.textContent)) && await p.$eval('#lev-adopt', (b) => b.hidden));
    await p.click('#lev-t tr[data-mk="DE"] [data-act="lv-medit"]');
    await p.click('#lev-t tr[data-mk="DE"]:not(.med) [data-act="lv-medit"]');
    ok('…a second ✎ closes it', !(await p.$('#lev-t tr.med')));
    await p.click('#lev-t tr[data-mk="DE"] [data-act="lv-medit"]');
    await p.fill('#lev-t tr.med[data-mk="DE"] .mlv[data-lk="rc"] [data-lvf="bau"]', '25');
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
    ok('…the plan saved carries all four levers in order — the legacy `units` lever saved as the stock-based exclusion, its scope and history kept', put['p:Superdry'].levers.map((l) => l.k).join(',') === 'rc,hero,thresh,excl'
      && put['p:Superdry'].levers[3].scope === 'Everest' && put['p:Superdry'].levers[3].was === '> 5 units per size', put['p:Superdry'].levers);
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
    ok('…held to their SALE values now (GB: the brand’s SALE 20%, though GB keeps its own BAU)', /Held to 20% — the brand’s SALE value/.test(R[0].cells[0].tip), R[0].cells[0].tip);
    ok('…the tile says so', /SALE · 2/.test(await p.$eval('#lev-sum .it b', (b) => b.textContent)));
    ok('…who switched it is on the step', /Switched by Tester/.test(await p.$eval(per0 + ' .stp[data-dir="sale"] .tg', (x) => x.title)));

    console.log('· the record, kept by hand');
    let RC = await recs(p);
    ok('the record lists newest first — day, markets, lever, what was set, the note, who', RC.length === 2 && RC[0].cells[0] === '1 Oct' && RC[0].cells[1] === 'GB' && RC[0].cells[2] === 'Range completion' && /^30% → 35% BAU$/.test(RC[0].cells[3]) && /Line moved after the review/.test(RC[0].cells[4]) && /Analyst A edited/.test(RC[0].cells[5]) && RC[1].cells[0] === '14 Sep', RC);
    await p.click('#lev-rec [data-act="lv-rnew"]');
    await p.fill('#lvr-d', '2026-10-06');
    await p.selectOption('#lvr-k', 'rc');
    await p.selectOption('#lvr-mode', 'sale');
    await p.fill('#lev-rform [data-lvf="set"]', '21');
    await p.fill('#lev-rform [data-lvf="was"]', '35');
    await p.fill('#lvr-note', 'Agreed on the call (test)');
    await p.click('#lev-rform [data-lvrm="GB"]');
    ok('the form keeps what was typed when a market chip re-draws it', (await p.$eval('#lvr-note', (i) => i.value)) === 'Agreed on the call (test)' && (await p.$eval('#lev-rform [data-lvf="set"]', (i) => i.value)) === '21');
    await p.click('#lev-rform [data-lvrm="DE"]');
    await p.click('#lev-rform [data-act="lv-radd"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; return b && Object.keys(b).some((k) => /^r:Superdry\|rec-20261006-rc-/.test(k)); }, null, { timeout: 5000 });
    put = await lastPut(p);
    const rk = Object.keys(put).filter((k) => /^r:Superdry\|rec-/.test(k))[0];
    ok('a record saves its key: the day, the markets picked, the lever, SALE, 35% → 21%, the note', rk && JSON.stringify(put[rk]) === JSON.stringify({ d: '2026-10-06', mk: ['GB', 'DE'], k: 'rc', mode: 'sale', v: 21, note: 'Agreed on the call (test)', was: 35 }), put);
    await p.waitForFunction(() => document.querySelectorAll('#lev-rt tbody tr[data-rid]').length === 3, null, { timeout: 5000 });
    RC = await recs(p);
    ok('…and leads the record, stamped by the server (Tester)', /^6 Oct$/.test(RC[0].cells[0]) && RC[0].cells[1] === 'GB, DE' && /35% → 21% SALE/.test(RC[0].cells[3]) && /Tester/.test(RC[0].cells[5]), RC[0]);
    await p.click('#lev-rt tbody tr[data-rid="' + rk.split('|')[1] + '"] [data-act="lv-redit"]');
    ok('✎ re-opens the record in the form, as it was saved', (await p.$eval('#lvr-note', (i) => i.value)) === 'Agreed on the call (test)' && (await p.$eval('#lev-rform [data-lvf="set"]', (i) => i.value)) === '21' && (await p.$eval('#lvr-mode', (i) => i.value)) === 'sale');
    await p.selectOption('#lvr-k', 'hero');
    ok('…choosing another lever re-draws the value as that lever takes it (on / off for hero sizes)', (await p.$eval('#lev-rform [data-lvf="set"]', (i) => i.tagName)) === 'SELECT');
    await p.selectOption('#lev-rform [data-lvf="set"]', 'off');
    await p.click('#lev-rform [data-act="lv-radd"]');
    await p.waitForFunction((k) => { const b = window.__puts[window.__puts.length - 1]; return b && b[k] && b[k].k === 'hero'; }, rk, { timeout: 5000 });
    put = await lastPut(p);
    ok('…an edit saves the SAME key (hero sizes off), what it was dropped for the new lever', put[rk].k === 'hero' && put[rk].v === 'off' && !('was' in put[rk]), put);
    await p.waitForFunction(() => /edited/.test(((document.querySelector('#lev-rt tbody tr[data-rid]') || {}).textContent) || ''), null, { timeout: 5000 }).catch(() => {});
    RC = await recs(p);
    ok('…and still names who first wrote it down, marked edited', /^Tester edited$/.test(RC[0].cells[5]) && /Hero sizes/.test(RC[0].cells[2]) && /^off SALE$/.test(RC[0].cells[3]), RC[0]);
    p.once('dialog', (d) => d.accept());
    await p.click('#lev-rt tbody tr[data-rid="' + rk.split('|')[1] + '"] [data-act="lv-rdel"]');
    await p.waitForFunction((k) => { const b = window.__puts[window.__puts.length - 1]; return b && (b._deleted || []).indexOf(k) >= 0; }, rk, { timeout: 5000 });
    ok('🗑 deletes it — through _deleted, after asking', (await recs(p)).length === 2);
    await p.click(per0 + ' .stp[data-dir="sale"] [data-act="lv-rsw"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; return b && Object.keys(b).some((k) => /^r:Superdry\|/.test(k) && b[k].src === 'e:peak-test|sale'); }, null, { timeout: 5000 });
    put = await lastPut(p);
    const swRec = Object.keys(put).map((k) => put[k]).filter((x) => x && x.src === 'e:peak-test|sale');
    ok('＋ Record it writes the switch made into the record — each change, in SALE, from → to, naming the period', swRec.length === 3 && swRec.every((x) => x.mode === 'sale' && /^Peak sale \(test\) — switch to SALE$/.test(x.note))
      && swRec.some((x) => x.k === 'rc' && x.mk.join(',') === 'GB' && x.was === 35 && x.v === 20) && swRec.some((x) => x.k === 'hero' && x.mk.join(',') === 'GB,DE' && x.was === 'on' && x.v === 'off'), swRec);
    await p.waitForFunction((s) => /✓ recorded/.test((document.querySelector(s + ' .stp[data-dir="sale"]') || {}).textContent || ''), per0, { timeout: 5000 });
    ok('…and then says it was (no second click can double it)', !(await p.$(per0 + ' .stp[data-dir="sale"] [data-act="lv-rsw"]')));

    console.log('· the summary, and the brief');
    await p.click('#lev-copy');
    await p.waitForFunction(() => !!window.__copied, null, { timeout: 5000 });
    const txt = await p.evaluate(() => window.__copied);
    ok('⧉ Copy summary is the dashboard in words — the record at its foot', /^Superdry — stock levers, \d{4}-\d{2}-\d{2}/.test(txt) && /• Range completion: BAU 30% · SALE 20% \(band 20–40%\)/.test(txt) && /not read yet — FR/.test(txt) && /Peak sale \(test\)/.test(txt) && /• Recorded:\n    \d{4}-\d{2}-\d{2} — /.test(txt), txt);
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
    // a save that is still on the wire when → Brief is pressed (the stock-based exclusion re-saved as it is)
    await p.evaluate(() => { window.__slow = 900; });
    await p.click('#lev-plan .lv[data-lk="excl"] [data-act="lv-edit"]');
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

    console.log('· one rule per lever — connected in one market, read in every market');
    ({ ctx, p, errs, seen } = await open(browser, 1440, 1000, '?brand=Superdry'));
    await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000 });
    const cls = (mk, lk) => p.$eval('#lev-t tr[data-mk="' + mk + '"]:not(.med) td.lc[data-lk="' + lk + '"]', (td) => td.className).catch(() => '');
    const heads = () => p.$$eval('#lev-t thead th .thr', (a) => a.map((x) => ({ t: x.textContent.trim(), c: x.className })));
    let H = await heads();
    R = await rows(p);
    ok('no rule connected: each head says so; where two rules read as a lever the cell is dashed (GB and DE: range completion, hero sizes — one threshold rule each, so not the threshold)', H.length === 4 && H.every((h) => h.t === 'no rule connected')
      && /\bov\b/.test(await cls('GB', 'rc')) && /\bov\b/.test(await cls('DE', 'rc')) && /\bov\b/.test(await cls('GB', 'hero')) && !/\bov\b/.test(await cls('GB', 'thresh')) && !/\bov\b/.test(await cls('GB', 'excl')), H);
    ok('…the plan tile says where they overlap, and offers to connect one', /not connected — more than one rule reads as it in GB, DE/.test(await p.$eval('#lev-plan .lv[data-lk="rc"] .lvr', (x) => x.textContent)) && /Connect a rule/.test(await p.$eval('#lev-plan .lv[data-lk="rc"] .lvr', (x) => x.textContent)));
    ok('…and the cell’s tooltip counts them', /2 rules read as this lever<\/b> — connect one in Brand plan/.test(R[0].cells[0].tip), R[0].cells[0].tip);
    await p.click('#lev-plan .lv[data-lk="rc"] [data-act="lv-rcon"]');
    await p.waitForSelector('#lev-pick');
    const pick0 = await p.evaluate(() => ({ mk: document.getElementById('lvk-mk').value, items: Array.from(document.querySelectorAll('#lev-pick .pk')).map((x) => ({ n: x.querySelector('input').value, on: x.querySelector('input').checked, pc: x.querySelector('.pc').textContent.trim() })) }));
    ok('⛓ Connect a rule opens the picker on the first market read (GB): the rules that read as range completion, each "in 2 of 2"', pick0.mk === 'GB' && pick0.items.map((x) => x.n).join('|') === 'Range completion percentage|Range completion exclusion' && pick0.items.every((x) => x.pc === 'in 2 of 2') && pick0.items[0].on, pick0);
    await p.check('#lev-pick input[name="lvk-r"][value="Range completion exclusion"]');
    await p.click('#lev-pick [data-act="lv-rpick"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; const l = b && b['p:Superdry'] && b['p:Superdry'].levers.filter((x) => x.k === 'rc')[0]; return l && l.rule; }, null, { timeout: 5000 });
    put = await lastPut(p);
    const rcL = put['p:Superdry'].levers.filter((x) => x.k === 'rc')[0];
    ok('Connect saves the plan with the rule — its name, the market it was picked in, the field it writes — every other value as it was', JSON.stringify(rcL.rule) === JSON.stringify({ n: 'Range completion exclusion', mk: 'GB', d: 'rc_exclusion' }) && rcL.bau === 30 && rcL.lo === 20 && put['p:Superdry'].levers.filter((x) => x.k !== 'rc').every((x) => !x.rule), put);
    await p.waitForFunction(() => /Range completion exclusion · 2\/2/.test((document.querySelector('#lev-t thead th .thr') || {}).textContent || ''), null, { timeout: 5000 });
    R = await rows(p);
    ok('…every market now reads that ONE rule: the head names it and 2/2, the overlap is gone, the tooltip names it and what it touched', !/\bov\b/.test(await cls('GB', 'rc')) && !/\bov\b/.test(await cls('DE', 'rc')) && /⛓ The connected rule:<br>#11 Range completion exclusion · 3,480 of 58,000 products/.test(R[0].cells[0].tip)
      && /Also reads as range completion here, not connected:<\/span><br>#9 Range completion percentage/.test(R[0].cells[0].tip), R[0].cells[0].tip);
    ok('…and the plan tile says where it is found', /Range completion exclusion\s*in 2 of 2 markets/.test(await p.$eval('#lev-plan .lv[data-lk="rc"] .lvr', (x) => x.textContent.replace(/\s+/g, ' '))));
    // the Everest exclusion: nothing in GB reads as it — said so, and "every stock rule" lists the rest, each that does not
    // read as the lever marked, with where its copy would be found
    await p.click('#lev-plan .lv[data-lk="excl"] [data-act="lv-rcon"]');
    await p.waitForSelector('#lev-pick');
    ok('a lever no rule reads as yet says so in the picker (the Everest exclusion in GB)', /No rule in Superdry GB reads as this lever/.test(await p.$eval('#lev-pick', (x) => x.textContent)));
    await p.check('#lvk-all');
    await p.waitForSelector('#lev-pick input[name="lvk-r"][value="Stock < 9 -> OOS"]');
    const pkAll = await p.$eval('#lev-pick input[name="lvk-r"][value="Stock < 9 -> OOS"]', (i) => i.closest('.pk').textContent.replace(/\s+/g, ' '));
    ok('…"Every stock rule in GB" lists the rest, marking each that does not read as the lever, with where it would be found (DE runs its copy under another name: 2 of 2)', /does not read as this lever/.test(pkAll) && /in 2 of 2\s*1 under another name/.test(pkAll), pkAll);
    await p.click('#lev-pick [data-act="lv-rpx"]');
    await p.waitForFunction(() => !document.getElementById('lev-pick'), null, { timeout: 5000 });
    // the threshold: GB's "Stock < 9 -> OOS" reads as it — connected, and DE's "Stock < 11 -> OOS" found doing its job
    await p.click('#lev-plan .lv[data-lk="thresh"] [data-act="lv-rcon"]');
    await p.waitForSelector('#lev-pick input[name="lvk-r"][value="Stock < 9 -> OOS"]');
    const pkT = await p.evaluate(() => Array.from(document.querySelectorAll('#lev-pick .pk')).map((x) => ({ n: x.querySelector('input').value, on: x.querySelector('input').checked, t: x.textContent.replace(/\s+/g, ' ') })));
    ok('the threshold’s picker: GB’s one stock threshold, picked, reading as the lever — in 2 of 2, DE’s copy under another name', pkT.length === 1 && pkT[0].n === 'Stock < 9 -> OOS' && pkT[0].on && !/does not read as this lever/.test(pkT[0].t) && /in 2 of 2\s*1 under another name/.test(pkT[0].t), pkT);
    await p.click('#lev-pick [data-act="lv-rpick"]');
    await p.waitForFunction(() => /Stock < 9 -> OOS · 2\/2/.test(Array.from(document.querySelectorAll('#lev-t thead th .thr')).map((x) => x.textContent).join('|')), null, { timeout: 5000 });
    // the head moves on the change itself; the save leaves a beat later
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; const l = b && b['p:Superdry'] && b['p:Superdry'].levers.filter((x) => x.k === 'thresh')[0]; return l && l.rule; }, null, { timeout: 5000 });
    put = await lastPut(p);
    ok('Connect stores the rule’s field with it (how its copies under other names are found)', JSON.stringify(put['p:Superdry'].levers.filter((x) => x.k === 'thresh')[0].rule) === JSON.stringify({ n: 'Stock < 9 -> OOS', mk: 'GB', d: 'stock_quantity' }), put);
    H = await heads(); R = await rows(p);
    ok('DE runs GB’s rule under another name ("Stock < 11 -> OOS", the same field): found 2/2, DE reads ITS cut-off, its tooltip saying so', !/miss/.test(H[2].c) && R[1].cells[2].v === '< 11' && /run here under another name:<br>#\d+ Stock &lt; 11 -&gt; OOS|run here under another name:<br>#\d+ Stock < 11 -> OOS/.test(R[1].cells[2].tip), [H[2], R[1].cells[2]]);
    ok('…and the tile counts it', /in 2 of 2 markets · 1 under another name/.test(await p.$eval('#lev-plan .lv[data-lk="thresh"] .lvr', (x) => x.textContent.replace(/\s+/g, ' '))));
    await p.click('#lev-plan .lv[data-lk="hero"] [data-act="lv-rcon"]');
    await p.selectOption('#lvk-mk', 'DE');
    await p.waitForFunction(() => document.getElementById('lvk-mk').value === 'DE' && /Every stock rule in DE/.test(document.getElementById('lev-pick').textContent), null, { timeout: 5000 });
    await p.check('#lev-pick input[name="lvk-r"][value="Set hero sizes"]');
    await p.click('#lev-pick [data-act="lv-rpick"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; const l = b && b['p:Superdry'] && b['p:Superdry'].levers.filter((x) => x.k === 'hero')[0]; return l && l.rule; }, null, { timeout: 5000 });
    put = await lastPut(p);
    ok('a rule can be picked as ANOTHER market runs it (DE) — the plan says where it was picked', JSON.stringify(put['p:Superdry'].levers.filter((x) => x.k === 'hero')[0].rule) === JSON.stringify({ n: 'Set hero sizes', mk: 'DE', d: 'is_hero_size' }) && !!put['p:Superdry'].levers.filter((x) => x.k === 'rc')[0].rule, put);
    // a plan for the threshold — BAU < 9, SALE < 4 — puts it on the switch list with each market's own copy of its rule
    await p.click('#lev-plan .lv[data-lk="thresh"] [data-act="lv-edit"]');
    await p.fill('#lev-plan .lv.ed [data-lvf="bau"]', '9');
    await p.fill('#lev-plan .lv.ed [data-lvf="sale"]', '4');
    await p.click('#lev-plan .lv.ed [data-act="lv-save"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; const l = b && b['p:Superdry'] && b['p:Superdry'].levers.filter((x) => x.k === 'thresh')[0]; return l && l.bau === 9 && l.sale === 4; }, null, { timeout: 5000 });
    put = await lastPut(p);
    ok('the threshold’s plan saves as numbers, its connected rule kept', JSON.stringify(put['p:Superdry'].levers.filter((x) => x.k === 'thresh')[0]) === JSON.stringify({ k: 'thresh', bau: 9, sale: 4, rule: { n: 'Stock < 9 -> OOS', mk: 'GB', d: 'stock_quantity' } }), put['p:Superdry'].levers);
    R = await rows(p);
    ok('…DE’s "< 11" against a "< 9 units" plan is off plan, and says both', R[1].cells[2].st === 'off' && /Off plan<\/b> — A rule name states stock &lt; 11 — the target is &lt; 9 units|Off plan<\/b> — A rule name states stock < 11 — the target is < 9 units/.test(R[1].cells[2].tip) && R[0].cells[2].st === 'on', [R[0].cells[2], R[1].cells[2]]);
    await p.click('#lev-plan .lv[data-lk="excl"] [data-act="lv-sug"]');
    await p.waitForFunction(() => /Stock-based exclusion · Everest N\/A → > 5/.test((document.querySelector('.per[data-p="peak-test"] details.sw') || {}).textContent || ''), null, { timeout: 5000 });
    const swM = await p.$eval('.per[data-p="peak-test"] details.sw', (d) => d.textContent.replace(/\s+/g, ' '));
    ok('the switch list names EACH market’s own copy of the connected rule — GB’s, and DE’s under its own name', /Stock quantity threshold < 9 units → < 4 units GB, DE/.test(swM) && /“Stock < 9 -> OOS” GB ↗/.test(swM) && /“Stock < 11 -> OOS” DE ↗/.test(swM) && !/copy it there first/.test(swM), swM);
    ok('…and a lever no market runs yet is listed with nothing to edit — set it up (the Everest exclusion, N/A → > 5)', /Stock-based exclusion · Everest N\/A → > 5 units per size GB, DE/.test(swM) && /No rule runs it yet — it needs setting up in FeedHero/.test(swM), swM);
    await p.click('#lev-copy');
    await p.waitForFunction(() => /no rule connected|rule “/.test(window.__copied || ''), null, { timeout: 5000 });
    const txR = await p.evaluate(() => window.__copied);
    ok('⧉ Copy summary names each lever’s rule, where it is found, and how many run it under another name', /• Range completion: [^\n]* — rule “Range completion exclusion”, in 2 of 2 markets/.test(txR) && /• Stock quantity threshold: BAU < 9 units · SALE < 4 units — rule “Stock < 9 -> OOS”, in 2 of 2 markets \(1 under another name\)/.test(txR)
      && /• Stock-based exclusion · Everest: [^\n]* — no rule connected/.test(txR), txR);
    await p.click('#lev-plan .lv[data-lk="rc"] [data-act="lv-rdis"]');
    await p.waitForFunction(() => { const b = window.__puts[window.__puts.length - 1]; const l = b && b['p:Superdry'] && b['p:Superdry'].levers.filter((x) => x.k === 'rc')[0]; return l && !l.rule; }, null, { timeout: 5000 });
    await p.waitForFunction(() => /no rule connected/.test((document.querySelector('#lev-t thead th .thr') || {}).textContent || ''), null, { timeout: 5000 });
    ok('✕ disconnects: the lever reads every rule that looks like it again — the overlap back', /\bov\b/.test(await cls('GB', 'rc')));
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· a market WITHOUT the connected rule, or any rule doing its job');
    // the same stub, with DE no longer running "Range completion exclusion" (nor anything on its field)
    const NOEXCL = "(function(){var f=window.fetch;window.fetch=function(u,o){return f(u,o).then(function(r){if(String(u).indexOf('/api/rules/stock')<0)return r;return r.json().then(function(j){(j.markets||[]).forEach(function(m){if(m.market==='DE')m.stock=(m.stock||[]).filter(function(x){return x.n!=='Range completion exclusion';});});return new Response(JSON.stringify(j),{status:200,headers:{'content-type':'application/json'}});});});};})();";
    ({ ctx, p, errs, seen } = await open(browser, 1440, 1000, '?brand=Superdry', NOEXCL));
    await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000 });
    await p.click('#lev-plan .lv[data-lk="rc"] [data-act="lv-rcon"]');
    await p.waitForSelector('#lev-pick input[name="lvk-r"][value="Range completion exclusion"]');
    ok('the picker counts where it would be found: 1 of 2', /in 1 of 2/.test(await p.$eval('#lev-pick input[name="lvk-r"][value="Range completion exclusion"]', (i) => i.closest('.pk').textContent)));
    await p.check('#lev-pick input[name="lvk-r"][value="Range completion exclusion"]');
    await p.click('#lev-pick [data-act="lv-rpick"]');
    await p.waitForFunction(() => /Range completion exclusion · 1\/2/.test((document.querySelector('#lev-t thead th .thr') || {}).textContent || ''), null, { timeout: 5000 });
    H = await p.$$eval('#lev-t thead th .thr', (a) => a.map((x) => ({ t: x.textContent.trim(), c: x.className })));
    R = await rows(p);
    ok('DE reads MISSING in red — no other rule’s value in its place; the head reads 1/2 in red; the tooltip names what DE runs instead', /miss/.test(H[0].c) && R[1].cells[0].v === 'missing' && /\bmiss\b/.test(await p.$eval('#lev-t tr[data-mk="DE"]:not(.med) td.lc[data-lk="rc"]', (td) => td.className))
      && /is not in this market, nor a rule doing its job — it runs “Range completion percentage” instead/.test(R[1].cells[0].tip) && R[1].lo === '1', [H[0], R[1]]);
    ok('…and the tile names where it is missing', /in 1 of 2 markets · missing in DE/.test(await p.$eval('#lev-plan .lv[data-lk="rc"] .lvr', (x) => x.textContent.replace(/\s+/g, ' '))));
    await p.click('#lev-plan .lv[data-lk="rc"] [data-act="lv-sug"]');
    await p.waitForFunction(() => /copy it there first/.test((document.querySelector('.per[data-p="peak-test"] details.sw') || {}).textContent || ''), null, { timeout: 5000 });
    const swX = await p.$eval('.per[data-p="peak-test"] details.sw', (d) => d.textContent.replace(/\s+/g, ' '));
    ok('the switch list keeps DE on the change, flagged: copy the rule there first', /Range completion 30% → 20% GB, DE/.test(swX) && /“Range completion exclusion” GB ↗/.test(swX) && /The connected rule “Range completion exclusion” is not in DE — copy it there first/.test(swX), swX);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· a brand with many markets — the markets that read the same share a row');
    ({ ctx, p, errs } = await open(browser, 1440, 1000, '?brand=Superdry', null, STUB_MANY));
    await p.waitForSelector('#lev-t tbody tr[data-g]', { timeout: 10000 });
    const grp = () => p.evaluate(() => ({ on: document.getElementById('lev-t').classList.contains('grouped'), view: Array.from(document.querySelectorAll('#lev-view button')).map((b) => ({ t: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true' })), hidden: document.getElementById('lev-view').hidden,
      rows: Array.from(document.querySelectorAll('#lev-t tbody tr:not(.med)')).map((tr) => ({ g: tr.hasAttribute('data-g'), mk: tr.getAttribute('data-mk') || '', chips: Array.from(tr.querySelectorAll('.mkc')).map((c) => c.textContent.trim()), name: (tr.querySelector('td.nm') || {}).textContent || '', ed: !!tr.querySelector('[data-act="lv-medit"]'),
        cells: Array.from(tr.querySelectorAll('td.lc')).map((td) => ({ v: td.textContent.trim(), st: ['on', 'off', 'none'].filter((c) => td.classList.contains(c))[0] || '', ov: td.classList.contains('ov'), tip: td.getAttribute('data-tip') || '' })), lo: ((tr.querySelector('td.lo') || {}).textContent || '').trim() })) }));
    let G = await grp();
    ok('nine roster markets open GROUPED on a fresh device — the switch reads "Grouped · 4 mixes", pressed', G.on && !G.hidden && G.view.length === 2 && G.view[1].on && /^Grouped · 4 mixes$/.test(G.view[1].t) && !G.view[0].on, G.view);
    ok('one row per mix, the biggest first: ES IT DK SE · then DE NL IE · then GB alone · then FR, not read yet — last', G.rows.length === 4 && G.rows[0].chips.join(',') === 'ES,IT,DK,SE' && /^4 markets/.test(G.rows[0].name) && G.rows[1].chips.join(',') === 'DE,NL,IE'
      && G.rows[2].mk === 'GB' && !G.rows[2].g && /^Superdry GB/.test(G.rows[2].name) && G.rows[2].ed && G.rows[3].mk === 'FR' && /not read yet/.test(G.rows[3].name), G.rows.map((r) => [r.mk || r.chips.join(','), r.name.slice(0, 30)]));
    ok('a group’s row draws what each of its markets would — the threshold each runs (< 13, < 11), the rest on plan (✓), GB off plan on its own', G.rows[0].cells[2].v === '< 13' && G.rows[1].cells[2].v === '< 11' && G.rows[0].lo === '✓' && G.rows[1].lo === '✓' && G.rows[2].lo === '1' && G.rows[2].cells[0].st === 'off', G.rows.map((r) => [r.cells.map((c) => c.v).join(' · '), r.lo]));
    ok('…a group’s cell names its markets and the rule each runs, in its tooltip', /ES, IT, DK, SE/.test(G.rows[0].cells[2].tip) && /Stock &lt; 13 -&gt; OOS|Stock < 13 -> OOS/.test(G.rows[0].cells[2].tip) && /Runs: stock/.test(G.rows[0].cells[2].tip), G.rows[0].cells[2].tip);
    ok('…a mark a market would carry is kept on its group (dashed: more than one rule reads as range completion and hero sizes)', G.rows[0].cells[0].ov && G.rows[0].cells[1].ov && G.rows[1].cells[0].ov, G.rows.slice(0, 2).map((r) => r.cells.map((c) => c.ov)));
    await p.click('#lev-t .mkc[data-mk="IT"]');
    const edG = await p.evaluate(() => { const m = document.querySelector('#lev-t tr.med'); return m ? { mk: m.getAttribute('data-mk'), prev: m.previousElementSibling && m.previousElementSibling.getAttribute('data-g') !== null, exp: document.querySelector('#lev-t .mkc[data-mk="IT"]').getAttribute('aria-expanded'), head: (m.querySelector('.mlh') || {}).textContent || '' } : null; });
    ok('a market’s chip opens ITS own values in a row directly under its group', edG && edG.mk === 'IT' && edG.prev && edG.exp === 'true' && /^Superdry IT — its own values/.test(edG.head), edG);
    await p.click('#lev-t .mkc[data-mk="IT"]');
    ok('…and a second tap closes it', !(await p.$('#lev-t tr.med')));
    await p.click('#lev-f [data-lvf2="off"]');
    G = await grp();
    ok('Off plan narrows first, then groups: GB alone', G.rows.length === 1 && G.rows[0].mk === 'GB', G.rows.map((r) => r.mk || r.chips.join(',')));
    await p.click('#lev-f [data-lvf2=""]');
    await p.click('#lev-view [data-lvv="0"]');
    G = await grp();
    ok('By market: every one of the nine markets a row again, each with its ✎', !G.on && G.rows.length === 9 && G.rows.every((r) => !r.g && r.ed) && G.view[0].on, G.rows.map((r) => r.mk));
    const kept = await p.evaluate(() => localStorage.getItem('fcc-stock-lvgrp'));
    ok('…the choice is this device’s', kept === '0', kept);
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();
    ({ ctx, p, errs } = await open(browser, 1440, 1000, '?brand=Superdry', 'try{localStorage.setItem("fcc-stock-lvgrp","0");}catch(e){}', STUB_MANY));
    await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000 });
    G = await grp();
    ok('…and holds on the next visit (nine markets, by market)', !G.on && G.rows.length === 9, G.rows.length);
    await ctx.close();
    ({ ctx, p, errs } = await open(browser, 1440, 1000, '?brand=Superdry'));
    await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000 });
    G = await grp();
    ok('a brand whose markets all read differently (GB, DE, FR not read) has nothing to group: no switch, a row each', !G.on && G.hidden && G.rows.length === 3, G);
    await ctx.close();

    console.log('· on a phone');
    ({ ctx, p, errs } = await open(browser, 390, 860, '?brand=Superdry'));
    await p.waitForSelector('#lev-t tbody tr[data-mk]', { timeout: 10000, state: 'attached' });
    await p.evaluate(() => { if (window.FCCDigest && window.FCCDigest.expandAll) window.FCCDigest.expandAll(); });
    await p.waitForTimeout(150);
    const pl = await boxes(p, '#lev-plan .lv');
    ok('the four lever tiles stack, one column', pl.length === 4 && new Set(pl.map((b) => b.x)).size === 1 && pl[1].y > pl[0].y, pl);
    const tl = await boxes(p, '#lev-sum .it');
    ok('the tiles pair', tl.length === 4 && new Set(tl.map((b) => b.y)).size === 2, tl);
    const ov = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth, tw: (() => { const t = document.querySelector('#lev-t'), w = t.closest('.tw'); return { t: t.scrollWidth, w: w.clientWidth, ox: getComputedStyle(w).overflowX }; })() }));
    ok('the page never scrolls sideways; the matrix pans in its own frame', ov.doc <= ov.vw && ov.tw.t > ov.tw.w && /auto|scroll/.test(ov.tw.ox), ov);
    const note = await p.evaluate(() => { const n = document.querySelector('#lev-plan .lv .lvc'); return n ? Math.round(n.getBoundingClientRect().height) : null; });
    ok('a one-line note in a lever tile stays one line (the shell’s .sc took flex-basis 170px under 820px)', note !== null && note < 40, note);
    await p.click('#lev-rec [data-act="lv-rnew"]');
    const rf = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('#lev-rform .rf > .vb')).map((x) => x.getBoundingClientRect()); const d = document.querySelector('#lvr-d'); return { cols: new Set(b.map((x) => Math.round(x.left))).size, dw: d.getBoundingClientRect().width, over: document.documentElement.scrollWidth - innerWidth }; });
    ok('the record form stacks on a phone, the day box wide enough to read', rf.cols === 1 && rf.dw >= 200 && rf.over <= 0, rf);
    ok('no page errors on the phone', errs.length === 0, errs);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
