#!/usr/bin/env node
/*
 * tools/check_aivis.js — AI VISIBILITY, DRIVEN AS AN AM DRIVES IT.
 *
 * Ray, 29 Sep 2026: "lets build 2 AI Surface visibility tracker real-time".
 *
 * tools/test_aivis.mjs pins the engine, the adapters and the route. THIS pins the half only a browser can
 * see, on the REAL page with the synthetic Northwind book of tools/aivis_stub.js and a streaming stub of
 * POST /api/aivis/ask (NDJSON, a line every few ms, the way the worker streams it):
 *   · the stored run renders as the question × surface grid, and the KPIs equal an INDEPENDENT count
 *     (the engine run here in node over the same stored cells);
 *   · a surface that showed no AI answer, and one that failed, read as that — never as "not named";
 *   · a cell opens the answer drawer docked on the right, inside the viewport, the brand highlighted;
 *   · ⚡ Ask live: cells go queued → asking (spinner, the live search) → answered; the drawer open on a
 *     running cell shows the answer AS IT IS WRITTEN; at most 4 asks in flight and 2 per surface; the
 *     finished run is saved final with every answer;
 *   · ⏹ Stop mid-run keeps the answers already in and saves no half-asked question as a failure;
 *   · ＋ Track moves an untracked name into share of voice at once;
 *   · ⚡ Match against the feed names the brand's cited product;
 *   · at 390px the page never scrolls sideways and the drawer is a bottom sheet inside the screen.
 * Run: node tools/check_aivis.js        (in presync; CI has no browsers)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright not installed — AI visibility check skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const STUBS = require('./aivis_stub.js');
const E = require('../docs/aivis_engine.js');
const PAGE = fs.readFileSync(path.join(D, 'FeedSpark_AIVisibility.html'), 'utf8');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const HTML = PAGE.split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html', 'lang_widget.html', 'hours_widget.html', 'shipped_widget.html', 'mobile_widget.html', 'digest_widget.html', 'migration_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const ASK = `
window.__asks={n:0,inflight:0,max:0,per:{},maxPer:{},done:0};window.__puts=[];
function askStub(opts){
  var b=JSON.parse(opts.body),A=window.__asks;A.n++;A.inflight++;A.max=Math.max(A.max,A.inflight);A.per[b.s]=(A.per[b.s]||0)+1;A.maxPer[b.s]=Math.max(A.maxPer[b.s]||0,A.per[b.s]);
  var enc=new TextEncoder(),named=/coats|boots|Northwind/.test(b.q);
  var text=named?'Top picks: **Southbay** first, then **Northwind** for the best-made coat, and **Harbour & Co**.':'Try **Southbay** or **Eastfield**; **Harbour & Co** is a smaller label.';
  var lines=[{t:'start',s:b.s},{t:'search',q:b.q.toLowerCase()},{t:'sources',n:3}];
  text.match(/.{1,9}/g).forEach(function(p){lines.push({t:'text',d:p});});
  var r={ok:true,text:text,cites:named?[{u:'https://www.northwind.co.uk/p/wool-coat/NW100?utm_source=chatgpt.com',t:'NW'},{u:'https://www.reddit.com/r/x',t:'r'}]:[{u:'https://southbay.com/',t:'S'}],results:[],searches:[b.q],model:'m',ms:900};
  if(b.s==='aio'&&/walking/.test(b.q))r={ok:true,none:true,note:'Google showed no AI Overview for this search'};
  lines.push({t:'done',r:r});
  var i=0,ctl=null,dead=false,delay=window.__askDelay||25;
  function fin(){if(dead)return;dead=true;A.inflight--;A.per[b.s]--;A.done++;}
  var st=new ReadableStream({start:function(c){ctl=c;},pull:function(c){return new Promise(function(res){setTimeout(function(){if(dead){res();return;}if(i<lines.length){c.enqueue(enc.encode(JSON.stringify(lines[i++])+'\\n'));}else{fin();c.close();}res();},delay);});}});
  if(opts.signal)opts.signal.addEventListener('abort',function(){if(dead)return;fin();try{ctl.error(new DOMException('aborted','AbortError'));}catch(e){}});
  return Promise.resolve(new Response(st,{status:200,headers:{'content-type':'application/x-ndjson'}}));
}`;
const STUB = `${ASK}
window.fetch=function(url,opts){url=String(url);opts=opts||{};var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 if(url.indexOf('/api/aivis/ask')>=0)return askStub(opts);
 if(url.indexOf('/api/aivis/run')>=0){window.__puts.push(JSON.parse(opts.body));return j({ok:true});}
${STUBS.stubLines()}
 return j({ok:false,error:'stub'},404);};`;

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };

// the independent count: the stored run's cells through the engine, in node
const DATA = STUBS.build();
const LAST = DATA.runs[1];
const SUM = E.summarise(LAST.cells.map((c) => E.analyse(c, DATA.ctx)), DATA.ctx);
const pcTxt = (v) => (Math.round(v * 10) / 10) + '%';

(async () => {
  const b = await chromium.launch({ headless: true });
  const tmp = path.join(os.tmpdir(), '_aivischeck_FeedSpark_AIVisibility.html');
  fs.writeFileSync(tmp, HTML);
  try {
    console.log('· the stored run');
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const pg = await ctx.newPage();
    const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.addInitScript(STUB);
    await pg.goto('file://' + tmp);
    await pg.waitForSelector('#mx button.cell[data-i]', { timeout: 8000 });
    const grid = await pg.evaluate(() => ({ rows: document.querySelectorAll('#mx tbody tr').length, cols: document.querySelectorAll('#mx thead th.sf').length, cells: document.querySelectorAll('#mx button.cell[data-i]').length }));
    ok('the stored run is a 4 × 4 question × surface grid', grid.rows === 4 && grid.cols === 4 && grid.cells === 16, grid);
    const kp = await pg.evaluate(() => Array.from(document.querySelectorAll('#kpis .kpi')).map((k) => ({ n: k.querySelector('.n').textContent, l: k.querySelector('.l').textContent })));
    const kv = (l) => (kp.find((k) => k.l === l) || {}).n;
    ok('Visibility = the independent count (unbranded answers naming the brand)', kv('Visibility') === pcTxt(SUM.all.vis), { page: kv('Visibility'), want: SUM.all.vis });
    ok('Share of voice + Own site cited = the independent count', kv('Share of voice') === pcTxt(SUM.all.sov) && kv('Own site cited') === pcTxt(SUM.all.cite), { page: [kv('Share of voice'), kv('Own site cited')], want: [SUM.all.sov, SUM.all.cite] });
    ok('Answers counts the no-answer cell apart', kv('Answers') === SUM.all.ans + ' / ' + SUM.all.n, kv('Answers'));
    const states = await pg.evaluate(() => ({ none: document.querySelectorAll('#mx button.cell.none').length, err: document.querySelectorAll('#mx button.cell.err').length, brand: document.querySelectorAll('#mx button.cell.brand').length }));
    ok('no AI answer reads as that, never as "not named"; branded questions read as branded', states.none === 1 && states.err === 0 && states.brand === 4, states);
    ok('the tracked brand\'s share-of-voice bar is the orange one', await pg.evaluate(() => { const r = document.querySelector('#sov .r.own'); return !!r && /Northwind/.test(r.textContent); }));
    const tk = await pg.evaluate(() => { const c = document.getElementById('dom-card').getBoundingClientRect(); return Array.from(document.querySelectorAll('#doms [data-trackdom]')).map((x) => { const r = x.getBoundingClientRect(); return r.width > 20 && r.right <= c.right && r.left >= c.left; }); });
    ok('every ＋ Track in the cited-sites list is on screen inside its card (a long domain never hides it)', tk.length > 0 && tk.every(Boolean), tk);
    ok('an untracked name the answers lean on is offered', await pg.evaluate(() => /Harbour & Co/.test(document.querySelector('#cands').textContent)));

    console.log('· the answer drawer');
    const named = await pg.$('#mx button.cell.named');
    await named.click();
    await pg.waitForSelector('#ap.on');
    const ap = await pg.evaluate(() => { const r = document.getElementById('ap').getBoundingClientRect(); const m = document.querySelector('#ap .ans mark.own'), mc = document.querySelector('#ap .ans mark.comp'); return { l: r.left, r: r.right, t: r.top, b: r.bottom, W: innerWidth, H: innerHeight, mark: m ? m.textContent : null, comp: mc ? mc.textContent : null, pad: getComputedStyle(document.body).paddingRight }; });
    ok('opens docked right, inside the viewport, the page pushed aside', ap.r <= ap.W + 1 && ap.l > ap.W / 2 && ap.t >= 0 && ap.b <= ap.H + 1 && parseFloat(ap.pad) > 300, ap);
    ok('the brand is highlighted in the answer (competitors in their own colour)', ap.mark === 'Northwind' && !!ap.comp && ap.comp !== 'Northwind', ap);
    ok('its cited sources are listed with whose site each is', await pg.evaluate(() => /Your site/.test(document.querySelector('#ap .bd').textContent) && document.querySelectorAll('#ap ol.src li').length > 0));
    await pg.keyboard.press('Escape');
    ok('Esc closes it', await pg.evaluate(() => !document.getElementById('ap').classList.contains('on')));

    console.log('· ⚡ Ask live');
    await pg.evaluate(() => { window.__askDelay = 25; });
    await pg.click('#run');
    await pg.waitForSelector('#mx button.cell.run', { timeout: 5000 });
    const mid = await pg.evaluate(() => ({ run: document.querySelectorAll('#mx button.cell.run').length, q: document.querySelectorAll('#mx button.cell.q').length, spin: document.querySelectorAll('#mx .spin').length, stop: !document.getElementById('stop').hidden }));
    ok('cells go queued → asking with a live spinner, ⏹ Stop showing', mid.run > 0 && mid.q > 0 && mid.spin === mid.run && mid.stop, mid);
    await pg.click('#mx button.cell.run');
    await pg.waitForFunction(() => { const a = document.querySelector('#ap .ans'); return a && a.querySelector('.caret') && a.textContent.length > 5; }, null, { timeout: 5000 });
    ok('the drawer on a running cell shows the answer AS IT IS WRITTEN', await pg.evaluate(() => /answering live/.test(document.querySelector('#ap .verdict').textContent)));
    await pg.waitForFunction(() => window.__puts.some((p) => p.run.final), null, { timeout: 30000 });
    const fin = await pg.evaluate(() => { const p = window.__puts.filter((x) => x.run.final).pop(); return { n: p.run.cells.length, pend: p.run.cells.filter((c) => c.pending).length, sumN: p.sum.all.n, max: window.__asks.max, maxPer: window.__asks.maxPer, puts: window.__puts.length }; });
    ok('the finished run is saved final with every answer and its headline', fin.n === 16 && fin.pend === 0 && fin.sumN === 16, fin);
    ok('never more than 4 asks in flight, 2 per surface', fin.max <= 4 && Object.keys(fin.maxPer).every((k) => fin.maxPer[k] <= 2) && fin.max >= 2, fin);
    ok('it was saved AS answers landed, not only at the end', fin.puts >= 2, fin.puts);
    const after = await pg.evaluate(() => ({ named: document.querySelectorAll('#mx button.cell.named').length, run: document.querySelectorAll('#mx button.cell.run').length, hist: document.getElementById('hist').options.length, go: !document.getElementById('run').hidden }));
    ok('every cell answered, the run joined the history, ⚡ back', after.run === 0 && after.named > 0 && after.hist === 3 && after.go, after);

    console.log('· ⏹ Stop');
    await pg.evaluate(() => { window.__askDelay = 120; window.__puts.length = 0; });
    await pg.click('#run');
    await pg.waitForFunction(() => window.__asks.done >= 16 + 3, null, { timeout: 20000 });
    await pg.click('#stop');
    await pg.waitForFunction(() => window.__puts.some((p) => p.run.final), null, { timeout: 10000 });
    const st = await pg.evaluate(() => { const p = window.__puts.filter((x) => x.run.final).pop(); return { n: p.run.cells.length, err: p.run.cells.filter((c) => !c.ok).length, running: document.querySelectorAll('#mx button.cell.run,#mx button.cell.q').length }; });
    ok('a stopped run keeps what was answered and saves no half-asked question as a failure', st.n >= 3 && st.n < 16 && st.err === 0 && st.running === 0, st);

    console.log('· ＋ Track, ⚡ Match');
    await pg.evaluate(() => { const o = document.getElementById('hist'); o.selectedIndex = o.options.length - 1; o.dispatchEvent(new Event('change')); });
    await pg.waitForFunction(() => /Harbour/.test(document.querySelector('#cands').textContent));
    await pg.click('#cands [data-track="Harbour & Co"]');
    const tr = await pg.evaluate(() => ({ sov: /Harbour & Co/.test(document.querySelector('#sov').textContent), comps: /Harbour & Co/.test(document.querySelector('#comps').textContent), dirty: !document.getElementById('dirty').hidden, cand: /Harbour/.test(document.querySelector('#cands').textContent) }));
    ok('a tracked name joins share of voice at once and the setup is marked unsaved', tr.sov && tr.comps && tr.dirty && !tr.cand, tr);
    await pg.click('#match');
    await pg.waitForFunction(() => /NW100/.test(document.querySelector('#prods').textContent), null, { timeout: 8000 });
    ok('the brand\'s cited product page is matched to its feed product', await pg.evaluate(() => /page cited/.test(document.querySelector('#prods').textContent)));
    ok('no page errors', errs.length === 0, errs);
    await ctx.close();

    console.log('· at 390px');
    const tmpS = path.join(os.tmpdir(), '_aivischeck_served_FeedSpark_AIVisibility.html');
    fs.writeFileSync(tmpS, HTML.replace('</body>', WIDGETS + '\n</body>'));
    const mc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const mp = await mc.newPage();
    await mp.addInitScript(STUB);
    await mp.goto('file://' + tmpS);
    await mp.waitForSelector('#mx button.cell[data-i]', { timeout: 8000 });
    await mp.evaluate(() => window.FCCDigest && window.FCCDigest.expandAll && window.FCCDigest.expandAll());
    ok('the page never scrolls sideways — the grid pans inside its frame', await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await mp.evaluate(() => document.querySelector('#mx button.cell.named').click());
    await mp.waitForSelector('#ap.on');
    await mp.waitForTimeout(350);
    const sh = await mp.evaluate(() => { const r = document.getElementById('ap').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, W: innerWidth, H: innerHeight }; });
    ok('the drawer is a bottom sheet inside the screen', sh.l >= -1 && sh.r <= sh.W + 1 && sh.b <= sh.H + 1 && sh.t > sh.H * 0.1, sh);
    await mc.close();
  } finally {
    await b.close();
  }
  console.log('\n' + (fail ? '✗ AI VISIBILITY CHECK FAILED' : 'PASS') + ' — ' + pass + ' assertions' + (fail ? ', ' + fail + ' failed' : ''));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
