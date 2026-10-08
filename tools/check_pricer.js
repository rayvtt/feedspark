#!/usr/bin/env node
/*
 * tools/check_pricer.js — SERVICES & PRICER, DRIVEN AS AN AM DRIVES IT.
 *
 * Ray, 7 Oct 2026: "attach and transform /pricer a little bit" — the Pricer became the services proposal and
 * rollout tool. tools/test_pricer.mjs pins the engine and tools/test_pricerstore.mjs the six stores; THIS pins the
 * half only a browser can see, on the REAL page with the synthetic Northwind book of tools/pricer_stub.js:
 *   · the audit stepper draws its eight readings;
 *   · the STORED first paint carries an estimate (a 'bound' chip) while the live feed is still being read, and once
 *     the stream lands every line of every tier card is exact — no estimate chip left;
 *   · Tier 1 and Tier 2 cards, and Tier 2's one-off is LESS than Tier 1 plus AI Readiness bought apart (set-up
 *     rounded to blocks once over the union);
 *   · a market whose feed cannot be read fails honestly: its chip says so, the typed-parents input appears and the
 *     unsized line carries its fix;
 *   · the client copy is GUARDED — every figure reads "[£ to confirm — Ray]" while a blocker stands — and "Mark sent"
 *     is disabled on a saved option that is not client-safe;
 *   · 💾 Save as proposal PUTs every shown tier under ONE proposal id with SVC references;
 *   · the Management 🔒 tab exists for the owner and NOT for a signin without the pricer-cost grant;
 *   · a Meta "-fb" market is never listed, and the page says how many it left out;
 *   · a rollout row click loads that client into the bar;
 *   · no console error, and nothing scrolls sideways at 1440px or at 390px.
 * Then the source rules: ex VAT (never "+VAT"), labelguard loaded by a Blob import (never a <script src>), the talk
 * track and the email never collapse behind ⓘ, the proposal and rollout carry their phone digests, the custom
 * quote's scaffolds and refresh select are kept (the lead's scope decision), nothing annual.
 * Run: node tools/check_pricer.js        (in presync; CI has no browsers)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium, devices; try { ({ chromium, devices } = require('playwright')); } catch (e) { console.log('· playwright not installed — pricer check skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const STUBS = require('./pricer_stub.js');
const SRC = fs.readFileSync(path.join(D, 'FeedSpark_Pricer.html'), 'utf8');
const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
const HTML = SRC.split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
// the phone pass meets the page AS SERVED: the worker injects these layers (the phone bottom bar, the skim view …)
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'navrow_widget.html', 'lang_widget.html', 'hours_widget.html', 'shipped_widget.html', 'mobile_widget.html', 'digest_widget.html', 'migration_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const SERVED = HTML.replace('</body>', WIDGETS + '\n</body>');
const GUARD = '[£ to confirm — Ray]';
const stub = (o) => `window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
${o && o.noFA ? "if(url.indexOf('/feedlab/engine.js')>=0)return j({error:'gone'},404);" : ''}
${STUBS.stubLines(o)}
 if(url.indexOf('/api/access')>=0)return j({ok:true,email:'ray@feedspark.com',owner:true,clients:null,modules:null});
 if(url.indexOf('/api/presence')>=0)return j({ok:true,me:'ray@feedspark.com',owner:true,now:Date.now(),users:[],roster:[]});
 if(url.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:0,warn:0,pt:{crit:0,warn:0},gr:{crit:0,warn:0},clients:{}});
 return j({ok:false,error:'stub'},404);};
window.open=function(u){window.__pzOpened=(window.__pzOpened||[]).concat([String(u)]);return null;};`;
const OWNER = { email: 'ray@feedspark.com', owner: true, modules: null, name: 'Ray' };
const AM = { email: 'steven@feedspark.com', owner: false, modules: ['pricer'], name: 'Steven' };

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };

async function open(b, html, vp, o) {
  const tmp = path.join(os.tmpdir(), '_pzcheck_' + Math.random().toString(36).slice(2) + '_FeedSpark_Pricer.html');
  fs.writeFileSync(tmp, html);
  const ctx = await b.newContext(vp === 390 ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 1000 } });
  // the synthetic catalogue's product images live on an .invalid host — answer them locally (an SVG stand-in)
  // so the preview's product card shows a picture here as it does live, and no request leaves the sandbox
  await ctx.route(/^https?:\/\/img\.northwind\.invalid\//, (r) => r.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#EFE7DA"/><path d="M130 110h140l30 60-40 20v120H140V190l-40-20z" fill="#2F4F6F"/><text x="200" y="372" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#6b6b6b">demo product</text></svg>' }));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  if (o && o.seed) await p.addInitScript('window.__pzS=' + JSON.stringify(o.seed) + ';');
  if (o && o.init) await p.addInitScript(o.init);
  // every section folds (8 Oct 2026); the checks below read inside them, so a device that has opened them all — the
  // fresh-device defaults have their own scenario
  if (!(o && o.freshSec)) await p.addInitScript("try{if(!localStorage.getItem('fcc-pz-sec'))localStorage.setItem('fcc-pz-sec',JSON.stringify({au:1,pq:1,db:1,ro:1,bk:1,rc:1,sv:1,rm:1,cq:1,ai:1}))}catch(e){}");
  await p.addInitScript(stub(o));
  await p.goto('file://' + tmp + ((o && o.query) || ''));
  return { p, ctx, errs, tmp };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

(async () => {
  const b = await chromium.launch({ headless: true });

  for (const vp of [1440, 390]) {
    console.log('\nServices & Pricer at ' + vp + 'px (owner)');
    const { p, ctx, errs, tmp } = await open(b, vp === 390 ? SERVED : HTML, vp, { delay: 3000, me: OWNER });
    // the STORED first paint — while the Northwind GB feed is still in flight
    await p.waitForSelector('.tier', { timeout: 15000 });
    if (vp === 390) await p.evaluate('window.FCCDigest && FCCDigest.expandAll({ silent: true, caps: true })');
    const first = await p.evaluate(() => ({
      steps: document.querySelectorAll('#svc-steps .stp-i').length,
      bound: document.querySelectorAll('.tier .est-bound').length,
      counting: /counting/.test(document.querySelector('#svc-mk').innerText),
      fb: !!document.querySelector('.mchip[data-m$="-fb"]'),
      note: document.querySelector('#svc-note').innerText,
      srcs: (window.__PZX && window.__PZX.SV.audits.map((x) => x.audit.src)) || [],
    }));
    ok('eight audit steps are drawn', first.steps === 8, first.steps);
    ok('the stored first paint carries a bound estimate while the feed is still being read', first.bound > 0 && first.counting && first.srcs[0] === 'stored', first);
    ok('a Meta "-fb" market is never offered, and the page says it left one out', !first.fb && /1 Meta feed not shown/.test(first.note), first.note);
    // the live read lands
    await p.waitForFunction(() => window.__PZX && window.__PZX.SV.audits.length && window.__PZX.SV.audits[0].audit.src === 'live', null, { timeout: 15000 });
    await p.waitForTimeout(300);
    if (vp === 390) await p.evaluate('window.FCCDigest && FCCDigest.expandAll({ silent: true, caps: true })');
    const live = await p.evaluate(() => {
      const PQ = window.__PZX.PQ;
      return {
        est: document.querySelectorAll('.tier .lines .est').length,
        chip: document.querySelector('.mchip[data-m="gb"]').innerText,
        cards: Array.from(document.querySelectorAll('.tier')).map((t) => t.getAttribute('data-opt')),
        t1: PQ.go.oneOff.total, t2: PQ['go+ar'].oneOff.total, ar: PQ.ar.oneOff.total,
        exact: PQ['go+ar'].lines.filter((l) => l.status === 'priced').every((l) => !l.est && (!l.need || !l.need.est)),
        counted: window.__PZX.SV.audits[0].audit.counts && window.__PZX.SV.audits[0].audit.counts.P,
        t2safe: PQ['go+ar'].clientSafe,
      };
    });
    ok('once the stream lands the market reads live and every priced line is exact (no estimate chip)', live.est === 0 && live.exact && /live/.test(live.chip), live);
    ok('the live read counted the synthetic catalogue\'s 12 parent products', live.counted === 12, live.counted);
    ok('Tier 1 and Tier 2 cards are drawn', live.cards[0] === 'go' && live.cards[1] === 'go+ar', live.cards);
    ok('Tier 2 one-off < Tier 1 + AI Readiness bought apart (blocks rounded once)', live.t2 < live.t1 + live.ar, [live.t2, live.t1, live.ar]);
    // the tier preview: the catalogue fills in as the option changes (bars, the score, the swept rows)
    const pv = async (opt) => { await p.click('#svc-prev [data-pv="' + opt + '"]'); await p.waitForTimeout(1300); return p.evaluate((o) => {
      const rows = Array.from(document.querySelectorAll('#svc-prev .pv-r'));
      const q = o === 'now' ? null : window.__PZX.PQ[o];
      return { full: rows.filter((r) => r.querySelector('.pv-v').textContent === '100%').length, pop: rows.filter((r) => r.classList.contains('pop')).length,
        score: document.querySelector('#svc-prev .pv-s').textContent, want: q ? q.perMarket[0].projected.after : window.__PZX.SV.audits[0].audit.golden.score,
        fixed: q ? q.perMarket[0].projected.fixed.length : 0, img: !!document.querySelector('#svc-prev .pv-img img[src^="http"]'), on: document.querySelectorAll('#svc-prev .pv-fr.on:not(.pv-sv)').length, invented: Array.from(document.querySelectorAll('#svc-prev .pv-fr.on:not(.pv-sv) .fs')).every((x) => /^(✦ T[12]( · £ tbc)?|✓ contracted)$/.test(x.textContent) && /^(filled|optimised|completed in the Tier 2 delivery) /.test(x.title)), ex: Object.fromEntries(Array.from(document.querySelectorAll('#svc-prev .pv-fr.on:not(.pv-sv)')).map((r) => [r.getAttribute('data-k'), { v: r.querySelector('.fv').textContent, c: r.querySelector('.fv').className }])), h: document.querySelector('#svc-prev .pv-body').getBoundingClientRect().height, calls: (window.__pzClaude || []).length, img: !!document.querySelector('#svc-prev .pv-img img[src^="http"]'), pressed: document.querySelector('#svc-prev [aria-pressed="true"]').getAttribute('data-pv'), dial: (() => { const d = document.querySelector('#svc-prev .pv-k .pv-dial'), fg = d && d.querySelector('.dial-fg'); if (!fg) return null; const r = d.getBoundingClientRect(); return { arc: parseFloat(fg.style.strokeDasharray) / 326.7 * 100, cls: fg.getAttribute('class'), stroke: getComputedStyle(fg).stroke, w: r.width, num: d.contains(document.querySelector('#svc-prev .pv-s')), label: d.getAttribute('aria-label') }; })() }; }, opt); };
    const v0 = await pv('now'), v1 = await pv('go'), v2 = await pv('go+ar');
    // the Golden Score is /golden's ring, not a bare number (Ray, 8 Oct 2026: "if it's score, mirror the circle score from golden score module")
    const bandOf = (v) => v >= 95 ? 'b-g' : v >= 85 ? 'b-y' : v >= 70 ? 'b-o' : 'b-r';
    ok('the preview\'s Golden Score is a ring as /golden draws it — the score inside it, the arc its share of 100, coloured by the audit band', [v0, v1, v2].every((v) => v.dial && v.dial.num && v.dial.w >= 60 && Math.abs(v.dial.arc - +v.score) < 0.2 && v.dial.cls === 'dial-fg ' + bandOf(+v.score) && /Golden Score \d/.test(v.dial.label) && v.dial.stroke !== 'none'), [v0.dial, v1.dial, v2.dial]);
    ok('the tier preview fills more attributes Today → Tier 1 → Tier 2, each row the engine says the option fills', v0.full <= v1.full && v1.full < v2.full && v1.fixed > 0 && v2.fixed > v1.fixed, [v0, v1, v2]);
    ok('the preview score lands on the engine\'s projected Golden Score for each option, and the changed rows sweep', +v1.score === +(+v1.want).toFixed(1) && +v2.score === +(+v2.want).toFixed(1) && v2.pop > 0 && v2.pressed === 'go+ar', [v1, v2]);
    ok('the preview shows one of the client\'s own products, its image and fields filling in Today → Tier 1 → Tier 2, each filled field tagged with its tier and naming HOW in its tooltip', v0.img && v0.on === 0 && v1.on > 0 && v2.on > v1.on && v2.invented, [v0.on, v1.on, v2.on, v0.img]);
    const call = await p.evaluate(() => (window.__pzClaude || [])[0]);
    ok('Spark AI is asked ONCE per product (cached across tier switches), with the product\'s own image and feed row', v0.calls === 0 && v2.calls === 1 && call && call.messages[0].content[0].type === 'image' && /Northwind/.test(call.messages[0].content[1].text) && !/"gtin"|"mpn"/.test(call.messages[0].content[1].text), [v0.calls, v1.calls, v2.calls]);
    ok('the tiers show actual example values — pattern "Plain", 10+ keyword strings — labelled as Spark AI examples', v2.ex.pattern && v2.ex.pattern.v === 'Plain' && /ex/.test(v2.ex.pattern.c) && v2.ex.keywords && /^1\d strings: /.test(v2.ex.keywords.v), v2.ex);
    ok('fields built in FeedHero show HOW, never a generated value; no size is ever generated', (!v2.ex.popularity_rank || /how/.test(v2.ex.popularity_rank.c)) && (!v2.ex.size || !/ex/.test(v2.ex.size.c)), [v2.ex.popularity_rank, v2.ex.size]);
    // without the Claude connection every brand still sees real values, built from its own product row
    const off = await p.evaluate(() => { const X = window.__PZX, P = [].concat(X.LIVE['Northwind|gb'].ps)[0]; X.pv().ex[P.id] = { st: 'off' }; X.preview();
      const rows = Object.fromEntries(Array.from(document.querySelectorAll('#svc-prev .pv-fr.on:not(.pv-sv)')).map((r) => [r.getAttribute('data-k'), { v: r.querySelector('.fv').textContent, c: r.querySelector('.fv').className }]));
      const d = X.derive({ id: 'x', title: 'Northwind Wide Leg Trousers', brand: 'Northwind', description: 'Wide leg trousers in a soft crepe. 95% Polyester, 5% Elastane. Machine wash.', product_type: 'Women > Clothing > Trousers', product_detail: '<g:section_name>Care</g:section_name><g:attribute_name>Washing</g:attribute_name><g:attribute_value>Machine wash</g:attribute_value>' }, 'gb');
      const img = document.querySelector('#svc-prev .pv-img img'), ib = img.getBoundingClientRect();
      return { rows, d, line: document.querySelector('#svc-prev .pv-ex').getAttribute('data-note'), imgW: ib.width, fit: getComputedStyle(img).objectFit, nat: img.naturalWidth && Math.abs(ib.width / ib.height - img.naturalWidth / img.naturalHeight) < 0.02 }; });
    ok('with no Claude connection the tier still shows actual values built from the product row — 10+ keyword strings, a pattern, a MASK title with the brand', off.rows.keywords && /^1\d strings: /.test(off.rows.keywords.v) && off.rows.pattern && /ex/.test(off.rows.pattern.c) && /^Northwind /.test(off.rows.title.v) && /own data/.test(off.line), [off.rows.keywords, off.rows.pattern, off.line]);
    ok('the data-built example reads the row honestly: plain when no pattern is named, the largest share of the composition as material, product_detail XML as section: attribute: value, size system from the market', off.d.pattern === 'Plain' && off.d.material === 'Polyester' && off.d.product_detail[0] === 'Care: Washing: Machine wash' && off.d.size_system === 'UK' && off.d.gender === 'female' && off.d.keywords.length >= 10 && !('size' in off.d) && !('gtin' in off.d), off.d);
    if (vp === 1440) ok('the product image is large and never cropped — drawn at its own aspect, contain', off.imgW >= 150 && off.fit === 'contain' && off.nat, [off.imgW, off.fit, off.nat]);
    if (vp === 1440) ok('the preview fits one screen: product card + catalogue column under 760px tall', v2.h < 760, v2.h);
    // FIVE products per brand, prepared ahead for a client meeting; Tier 2 leaves nothing missing (Ray, 8 Oct 2026)
    const five = await p.evaluate(() => ({ sw: (document.querySelector('#svc-prev .pv-sw b') || {}).textContent, n: [].concat(window.__PZX.LIVE['Northwind|gb'].ps).length,
      t0: document.querySelector('#svc-prev .pv-pt').textContent, src: (document.querySelector('#svc-prev .pv-src') || {}).textContent,
      miss: Array.from(document.querySelectorAll('#svc-prev .pv-fr .fv.miss')).map((x) => x.closest('.pv-fr').getAttribute('data-k')),
      contr: Array.from(document.querySelectorAll('#svc-prev .pv-fr .fs')).filter((x) => x.textContent === '✓ contracted').length }));
    ok('the live read keeps FIVE of the client\'s own products, and the card steps through them (1 / 5, live read)', five.n === 5 && five.sw === '1 / 5' && /live read/.test(five.src), five);
    ok('Tier 2 · AI-ready leaves nothing missing on the example product', five.miss.length === 0, five.miss);
    await p.click('#svc-prev [data-pvp="1"]'); await p.waitForTimeout(250);
    const nx = await p.evaluate(() => ({ sw: document.querySelector('#svc-prev .pv-sw b').textContent, t: document.querySelector('#svc-prev .pv-pt').textContent,
      miss: document.querySelectorAll('#svc-prev .pv-fr .fv.miss').length }));
    ok('› shows the next of the five — another product, still nothing missing in Tier 2', nx.sw === '2 / 5' && nx.t !== five.t0 && nx.miss === 0, [five.t0, nx]);
    await p.click('#svc-prev [data-pvx="brand"]');
    await p.waitForFunction(() => (window.__pzExPuts || []).length > 0, null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(300);
    const pre = await p.evaluate(() => ({ put: (window.__pzExPuts || [])[0], src: (document.querySelector('#svc-prev .pv-src') || {}).textContent, msg: (document.querySelector('#svc-prev .pv-pre-s') || {}).textContent }));
    ok('⟳ Prepare examples keeps five Northwind GB products with their Spark AI examples, and the card then reads pre-loaded',
      pre.put && pre.put.client === 'Northwind' && pre.put.mkt === 'gb' && pre.put.products.length === 5 && pre.put.products.every((x) => x.p.id && x.p.title && x.p.image_link)
      && pre.put.products.some((x) => x.src === 'ai' && x.ex && x.ex.title) && /pre-loaded/.test(pre.src) && /5 products ready/.test(pre.msg), { src: pre.src, msg: pre.msg, n: pre.put && pre.put.products.length });
    await p.click('#svc-prev [data-pvp="-1"]'); await p.waitForTimeout(150);
    if (vp === 1440 && process.env.PZ_SHOTS) await (await p.$('#svc-prev')).screenshot({ path: process.env.PZ_SHOTS + '/preview_t2.png' });
    if (process.env.PZ_SHOTS) await (await p.$('#svc-tiers')).screenshot({ path: process.env.PZ_SHOTS + '/tiers_' + vp + '.png' });
    // a market whose feed cannot be read
    await p.click('.mchip[data-m="de"]');
    await p.waitForFunction(() => window.__PZX && window.__PZX.FAILED['Northwind|de'], null, { timeout: 10000 });
    await p.waitForTimeout(300);
    if (vp === 390) await p.evaluate('window.FCCDigest && FCCDigest.expandAll({ silent: true, caps: true })');
    const de = await p.evaluate(() => ({
      chip: document.querySelector('.mchip[data-m="de"]').innerText,
      tp: !!document.querySelector('.tp-in[data-tp="de"]'),
      kw: (document.querySelector('.tier[data-opt="go"] tr[data-line="keywords"] .stc') || {}).textContent,
      fix: Array.from(document.querySelectorAll('.tier[data-opt="go"] .fixes li')).map((li) => li.textContent).join(' | '),
      money: Array.from(document.querySelectorAll('.tier[data-opt="go"] .money .mv')).map((x) => x.innerText),
      aon: (document.querySelector('.tier[data-opt="go"] .aon') || {}).innerText || '',
      digest: document.querySelector('#svc-prop').getAttribute('data-m-digest'),
      step8: (Array.from(document.querySelectorAll('#svc-steps .stp-i')).pop() || {}).innerText || '',
      supply: (document.querySelector('.tier[data-opt="go"] tr[data-line="client"] .nd-parts') || {}).textContent || '',
    }));
    ok('the refused DE feed says "failed" on its chip and offers the typed-parents input', /failed/.test(de.chip) && de.tp, de);
    ok('the unsized keyword line shows its fix', /not sized/.test(de.kw || '') && /Keyword optimisation/.test(de.fix) && /count the live feed/.test(de.fix), de);
    ok('a tier with nothing sized reads "not sized", never £0 — card, every-new-product line, step 8 and the phone digest', de.money.length === 2 && de.money.every((t) => /not sized/.test(t) && !/£/.test(t)) && !/£0\b/.test(de.aon) && de.digest === 'T1 not sized' && !/T1\s*£0/.test(de.step8), de);
    ok('"Client to supply" names the market of every count once two markets are in the proposal', !de.supply || (/\bGB /.test(de.supply) && /\bDE /.test(de.supply)), de.supply);
    await p.click('.mchip[data-m="de"]');   // back to GB alone
    await p.waitForTimeout(250);
    // the guarded client copy, and Mark sent on an option that is not client-safe
    const guard = await p.evaluate(() => ({
      body: document.querySelector('#db-body').value,
      talk: document.querySelectorAll('#db-talk li').length,
      sent: (document.querySelector('button[data-sp="sent"][data-id="onorth00001"]') || {}).disabled,
    }));
    ok('the debrief email is guarded — every figure reads "' + GUARD + '"', guard.body.indexOf(GUARD) >= 0 && !/£\d/.test(guard.body), guard.body.slice(0, 160));
    ok('the talk track carries five bullets', guard.talk === 5, guard.talk);
    ok('"Mark sent" is disabled on a saved option that is not client-safe', guard.sent === true, guard.sent);
    // 💾 Save as proposal — every shown tier under one proposal id
    await p.click('#pq-save');
    await p.waitForFunction(() => (window.__pzPuts || []).some((x) => x.name === 'proposals'), null, { timeout: 8000 });
    await p.waitForFunction(() => document.querySelectorAll('#sp-list .pg').length >= 2, null, { timeout: 5000 }).catch(() => {});
    const saved = await p.evaluate(() => {
      const put = window.__pzPuts.filter((x) => x.name === 'proposals').pop().body;
      const fresh = Object.keys(put).filter((k) => ['onorth00001', 'othorn00001', 'othorn00002'].indexOf(k) < 0).map((k) => put[k]);
      return { n: fresh.length, ids: fresh.map((r) => r.prop.id), refs: fresh.map((r) => r.ref), opts: fresh.map((r) => r.option), safe: fresh.map((r) => r.clientSafe),
        groups: document.querySelectorAll('#sp-list .pg').length, keep: Object.keys(put).indexOf('onorth00001') >= 0 };
    });
    ok('💾 Save as proposal writes every shown tier (Tier 1, 2 and 3) under ONE proposal id, with SVC references', saved.n === 3 && saved.ids.every((x) => x === saved.ids[0]) && saved.refs.every((r) => /^SVC\d{6}(-\d+)?$/.test(r)) && saved.opts.join() === 'go,go+ar,go+ar+rf', saved);
    ok('the save keeps every existing option (a whole-map save never drops one) and the list shows the new proposal', saved.keep && saved.groups >= 2, saved);
    // the rate card: Management is there for the owner
    const mg = await p.evaluate(() => { const b2 = document.querySelector('#rc-tabs button[data-tab="mgmt"]'); return b2 && !b2.hidden && getComputedStyle(b2).display !== 'none'; });
    ok('the Management 🔒 tab is shown to the owner', mg === true, mg);
    // a rollout row click loads that client
    await p.click('#ro-body tr[data-client="Thornfield"] td.ro-c');
    await p.waitForTimeout(400);
    const ro = await p.evaluate(() => ({ brand: document.querySelector('#brand').value, client: window.__PZX.SV.client }));
    ok('a rollout row click loads that client into the bar', ro.brand === 'Thornfield' && ro.client === 'Thornfield', ro);
    const ov = await overflow(p);
    ok('nothing scrolls sideways at ' + vp + 'px', ov <= 1, ov);
    ok('no console error at ' + vp + 'px', !errs.length, errs.slice(0, 3));
    if (process.env.PZ_SHOTS) await p.screenshot({ path: path.join(process.env.PZ_SHOTS, 'check_pricer_' + vp + '.png'), fullPage: true });
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }

  console.log('\nPre-loaded examples open in a client meeting with no feed read');
  {
    const row = (i, t) => ({ id: 'NW-PRE-' + i, title: t, image_link: 'https://img.northwind.invalid/pre' + i + '.jpg', brand: 'Northwind', price: '49.00 GBP', description: 'A short description.', hl: 0, hlv: [], kw: [] });
    const preEx = { Northwind: { gb: { t: Date.now() - 86400000, by: 'Steven', products: [
      { p: row(1, 'Northwind Linen Shirt Dress'), src: 'ai', ex: { title: 'Northwind Women\'s Linen Relaxed Fit Sage Shirt Dress for Summer Days, Midi Length With Belt', pattern: 'Plain', keywords: ['linen shirt dress', 'sage midi dress', 'womens linen dress', 'belted shirt dress', 'summer midi dress', 'relaxed fit dress', 'linen dress uk', 'shirt dress women', 'sage green dress', 'holiday dress', 'northwind dress'] } },
      { p: row(2, 'Northwind Cord Trousers'), src: 'derived', ex: null }] } } };
    const { p, errs, tmp } = await open(b, HTML, 1440, { me: OWNER, preEx, delay: 8000, init: "try{localStorage.setItem('fcc-svc-src','stored')}catch(e){}", query: '?client=Northwind' });
    await p.waitForSelector('.tier', { timeout: 15000 });
    await p.waitForSelector('#svc-prev .pv-pt', { timeout: 8000 }).catch(() => {});
    await p.click('#svc-prev [data-pv="go+ar"]').catch(() => {}); await p.waitForTimeout(600);
    const st = await p.evaluate(() => ({ t: (document.querySelector('#svc-prev .pv-pt') || {}).textContent, sw: (document.querySelector('#svc-prev .pv-sw b') || {}).textContent,
      src: (document.querySelector('#svc-prev .pv-src') || {}).textContent, title: (document.querySelector('#svc-prev .pv-fr[data-k="title"] .fv') || {}).textContent,
      live: !!(window.__PZX.LIVE['Northwind|gb'] && window.__PZX.LIVE['Northwind|gb'].ps), claude: (window.__pzClaude || []).length, miss: document.querySelectorAll('#svc-prev .pv-fr .fv.miss').length }));
    ok('in Stored mode the prepared product opens at once — before any live read lands, no Spark AI call — with its stored example and "pre-loaded · Steven"',
      st.t === 'Northwind Linen Shirt Dress' && st.sw === '1 / 2' && /pre-loaded.*Steven/.test(st.src) && /Sage Shirt Dress/.test(st.title) && !st.live && st.claude === 0 && st.miss === 0, st);
    ok('…and no console error', errs.length === 0, errs);
    fs.unlinkSync(tmp);
  }

  console.log('\nEvery section folds (a fresh device)');
  {
    const { p, errs, tmp } = await open(b, HTML, 1440, { me: OWNER, freshSec: true });
    await p.waitForSelector('.tier', { timeout: 15000 });
    const st = () => p.evaluate(() => Array.from(document.querySelectorAll('section')).filter((x) => x.querySelector('.wrap > h2')).map((x) => {
      const t = x.querySelector('.wrap > h2 .sec-tog'), body = t && document.getElementById(t.getAttribute('aria-controls') || ('sec-' + t.getAttribute('data-sec')));
      return { id: x.id, tog: !!t, open: !!body && !body.hidden && body.getBoundingClientRect().height > 0, aria: t && t.getAttribute('aria-expanded') };
    }));
    const s0 = await st();
    ok('every section heading carries a ▸ Show / ▾ Hide toggle', s0.length >= 10 && s0.every((x) => x.tog), s0.filter((x) => !x.tog).map((x) => x.id));
    const tiles = await p.evaluate(() => [...document.querySelectorAll('h2.sec-h')].map((h) => ({ desc: !!h.querySelector('.sec-desc'), tt: !!h.querySelector('.sec-tt'), floating: [...h.parentNode.querySelectorAll(':scope > .sec-body > p.sub')].filter((x) => getComputedStyle(x).display !== 'none' && x === x.parentNode.firstElementChild).length })));
    ok('every section head is a tile — a title and one line of what is inside, no explainer floating under it', tiles.length >= 10 && tiles.every((t) => t.tt && t.desc && !t.floating), tiles);
    ok('a fresh device opens Audit and Proposal, every other section folded (Debrief kit included)',
      s0.filter((x) => x.open).map((x) => x.id).join() === 'svc-audit,svc-prop' && s0.every((x) => (x.aria === 'true') === x.open), s0.map((x) => x.id + ':' + x.open));
    await p.click('#svc-debrief .sec-tog'); await p.waitForTimeout(200);
    ok('the Debrief kit opens from its own heading, its email and talk track on screen', await p.evaluate(() => { const b = document.querySelector('#db-body'); return !!b && b.getBoundingClientRect().height > 40 && !!document.querySelector('#db-talk li'); }));
    await p.click('#svc-debrief .sec-tog'); await p.waitForTimeout(150);
    await p.click('#pq-debrief'); await p.waitForTimeout(250);
    ok('✉ Debrief opens a folded Debrief kit before scrolling to it', await p.evaluate(() => !document.getElementById('sec-db').hidden));
    await p.click('.sec-all[data-secall="0"]'); await p.waitForTimeout(150);
    const sF = await st();
    ok('⊖ Fold all sections folds every one', sF.every((x) => !x.open), sF.filter((x) => x.open).map((x) => x.id));
    await p.click('.sec-all[data-secall="1"]'); await p.waitForTimeout(300);
    const sO = await st();
    ok('⊕ Open all sections opens every one', sO.every((x) => x.open), sO.filter((x) => !x.open).map((x) => x.id));
    await p.click('#svc-bank .sec-tog'); await p.waitForTimeout(150);
    await p.reload(); await p.waitForSelector('.tier', { timeout: 15000 });
    const sR = await st();
    ok('…and the device remembers it: after a reload the bank stays folded, the rest open', !sR.find((x) => x.id === 'svc-bank').open && sR.filter((x) => x.id !== 'svc-bank').every((x) => x.open), sR.map((x) => x.id + ':' + x.open));
    ok('…no console error', errs.length === 0, errs);
    fs.unlinkSync(tmp);
  }

  console.log('\nThe bank in the audit — every optimisation the bank places in a tier has its own row');
  {
    const bank = { x_img_type: { label: 'Image type', kind: 'service', pkg: 'rf', gives: 'Spark AI detects image type for email + social DPAs', by: 'Ray', at: Date.now() },
      x_aivis: { label: 'AI visibility report', kind: 'service', pkg: 'rf', gives: 'intent data refreshed from the Spark AI visibility report', by: 'Ray', at: Date.now() } };
    const { p, ctx, errs, tmp } = await open(b, HTML, 1440, { delay: 50, me: OWNER, bank, query: '?client=Northwind&market=gb' });
    await p.waitForSelector('#svc-prev .pv-r', { timeout: 15000 }); await p.waitForTimeout(900);
    const read = async (opt) => { await p.click('#svc-prev [data-pv="' + opt + '"]'); await p.waitForTimeout(600); return p.evaluate(() => {
      const card = Object.fromEntries(Array.from(document.querySelectorAll('#svc-prev .pv-sv')).map((r) => [r.getAttribute('data-b'), { on: r.classList.contains('on'), fs: r.querySelector('.fs').textContent, fv: r.querySelector('.fv').textContent }]));
      const cov = Object.fromEntries(Array.from(document.querySelectorAll('#svc-prev .pv-svr')).map((r) => [r.getAttribute('data-b'), { v: r.querySelector('.pv-v').textContent, c: r.querySelector('.pv-c').textContent, lb: r.querySelector('.lb').textContent }]));
      return { card, cov }; }); };
    const now = await read('now'), t2 = await read('go+ar'), t3 = await read('go+ar+rf');
    const keys = ['x_stock_rc', 'x_restock', 'x_img_type', 'x_aivis'];
    ok('the two Tier 2 services and both Tier 3 items each have a row on the product card and in the coverage column', keys.every((k) => t3.card[k] && t3.cov[k]), { card: Object.keys(t3.card), cov: Object.keys(t3.cov) });
    ok('the coverage rows read the bank\'s own names', t3.cov.x_img_type && t3.cov.x_img_type.lb === 'Image type' && t3.cov.x_aivis.lb === 'AI visibility report' && /Stock range completion/.test(t3.cov.x_stock_rc.lb), t3.cov);
    ok('today nothing runs: every row off, the coverage says not running today', keys.every((k) => !now.card[k].on && now.cov[k].v === '—' && /not running today/.test(now.cov[k].c)), now);
    ok('Tier 2 runs its two services and says Tier 3 adds the other two', t2.card.x_stock_rc.on && t2.card.x_restock.on && t2.card.x_stock_rc.fs === '✦ T2' && !t2.card.x_img_type.on && /Tier 3 adds it/.test(t2.cov.x_aivis.c), t2);
    ok('Tier 3 carries all four — Tier 2\'s services marked T2, its own marked T3', keys.every((k) => t3.card[k].on && t3.cov[k].v === '✓') && t3.card.x_img_type.fs === '✦ T3' && t3.card.x_restock.fs === '✦ T2' && /run by Tier 3/.test(t3.cov.x_aivis.c), t3);
    ok('a bank row shows what the bank says it gives', /email \+ social DPAs/.test(t3.card.x_img_type.fv), t3.card.x_img_type);
    ok('no console error with a bank on the audit', !errs.length, errs.slice(0, 3));
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }
  console.log('\nA signin without the pricer-cost grant');
  {
    const { p, ctx, errs, tmp } = await open(b, HTML, 1440, { delay: 50, me: AM, costDenied: true });
    await p.waitForSelector('.tier', { timeout: 15000 });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const b2 = document.querySelector('#rc-tabs button[data-tab="mgmt"]');
      const unitEd = !!document.querySelector('#rc-body .r-ed[data-store="price"]');
      return { shown: !!b2 && !b2.hidden && getComputedStyle(b2).display !== 'none', mgmt: window.__PZX.MGMT, unitEd,
        costGet: (window.__pzPuts || []).length };
    });
    ok('the Management 🔒 tab is absent and the sell £ is read-only', !r.shown && r.mgmt === false && !r.unitEd, r);
    ok('the Optimisation bank is read-only for an AM: tier buttons disabled, no add form, it says Management sets the tiers',
      await p.evaluate(() => Array.from(document.querySelectorAll('#bk-body button[data-bkt]')).every((x) => x.disabled) && document.querySelectorAll('#bk-body tr').length === 12 && !document.querySelector('#bk-add details') && /Management sets the tiers/.test(document.querySelector('#bk-sum').textContent)));
    ok('no console error for the AM signin', !errs.filter((e) => !/403/.test(e)).length, errs.slice(0, 3));
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }
  console.log('\nRound-1 fixes, driven (owner, ?client=Northwind&pkg=go+ar)');
  {
    const { p, ctx, errs, tmp } = await open(b, HTML, 1440, { delay: 50, me: OWNER, query: '?client=Northwind&market=gb&pkg=go+ar' });
    const dialogs = [];
    p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    await p.waitForFunction(() => window.__PZX && window.__PZX.SV.audits.length && window.__PZX.SV.audits[0].audit.src === 'live', null, { timeout: 15000 });
    await p.waitForTimeout(700);
    const toast = () => p.evaluate(() => document.querySelector('#toast').textContent);
    // 23 / 39 — the documented deep link, '+' and all
    ok('?pkg=go+ar highlights the Tier 2 card (a "+" in a query reads as a space — the page maps it back)', await p.evaluate(() => !!document.querySelector('.tier.hl[data-opt="go+ar"]')));
    // 22 — every → Brief link sits inside its card's frame
    const clip = await p.evaluate(() => { document.querySelectorAll('.tier .tier-more').forEach((d) => { d.open = true; }); return Array.from(document.querySelectorAll('.tier .ln-a a')).map((a) => { const f = a.closest('.rc-scroll').getBoundingClientRect(), r = a.getBoundingClientRect(); return Math.round(r.right - f.right); }); });
    ok('no "→ Brief" link is clipped by its tier card at 1440px', clip.length > 0 && clip.every((d) => d <= 0), clip);
    // A — the tier names
    const names = await p.evaluate(() => Array.from(document.querySelectorAll('.tier h3')).map((h) => h.innerText));
    ok('the tiers read Tier 1 · Google-ready and Tier 2 · AI-ready, each with its sub-label', /^Tier 1 · Google-ready/.test(names[0]) && /eligible \+ everything Google recommends/.test(names[0]) && /^Tier 2 · AI-ready/.test(names[1]) && /the bundle/.test(names[1]), names);
    // the card reads in a glance: score bar, what you get, two prices — the working folded under See the breakdown
    const bite = await p.evaluate(() => { const t = document.querySelector('.tier[data-opt="go+ar"]'); const d = t.querySelector('.tier-more');
      d.open = false; const h = t.getBoundingClientRect().height; const chips = Array.from(t.querySelectorAll('.tk-get .tk-c:not(.svc)')).map((c) => c.textContent);
      return { h, chips, bars: t.querySelectorAll('.proj .tk-bar').length, folded: !d.open && !!d.querySelector('table.lines') && !!d.querySelector('.rates-l'), mv: t.querySelectorAll('.money .mv').length,
        words: t.innerText.replace(d.innerText, '').split(/\s+/).filter(Boolean).length }; });
    ok('a tier card leads with a score bar, what-you-get chips and two prices, the line table and rates folded under See the breakdown', bite.bars >= 1 && bite.chips.length >= 4 && /^✓ Everything in Tier 1/.test(bite.chips[0]) && bite.chips.slice(1).every((c) => /^(—|[\d,]+) /.test(c)) && bite.folded && bite.mv === 2 && bite.words < 120, bite);
    // C — Tier 3 · AI-Intel Refresher: Tier 2 plus the AI-ready fields refreshed monthly or quarterly
    const t3 = await p.evaluate(() => { const t = document.querySelector('.tier[data-opt="go+ar+rf"]'), X = window.__PZX.PQ; if (!t) return null; const q = X['go+ar+rf'];
      return { name: t.querySelector('h3').innerText, n: t.querySelector('.tier-n').textContent, chips: Array.from(t.querySelectorAll('.tk-get .tk-c')).map((c) => c.textContent),
        money: t.querySelector('.money').innerText, F: q.refresh, m2: X['go+ar'].monthly.total, m3: q.monthly.total, o2: X['go+ar'].oneOff.total, o3: q.oneOff.total,
        bd: (t.querySelector('.rf-bd') || {}).textContent || '' }; });
    ok('Tier 3 · AI-Intel Refresher is drawn after Tier 2: "Everything in Tier 2, plus" the refresh chips, the one-off unchanged, the refresh inside the monthly',
      t3 && /^Tier 3 · AI-Intel Refresher/.test(t3.name) && t3.n === '3' && /^✓ Everything in Tier 2/.test(t3.chips[0]) && /Monthly/.test(t3.chips[1]) && /Keywords/.test(t3.chips[1])
      && t3.o3 === t3.o2 && Math.abs(t3.m3 - t3.m2 - t3.F.monthlyEq) < 0.01 && /AI-Intel Refresher/.test(t3.money) && /Read against/.test(t3.bd), t3);
    // D — the optimisation bank: every optimisation, its tier, what it gives — moved / added and every quote follows
    const bk0 = await p.evaluate(() => ({ rows: document.querySelectorAll('#bk-body tr').length, seg: document.querySelectorAll('#svc-prev [data-pv]').length,
      hl: (document.querySelector('#bk-body tr[data-bkrow="highlights"] .bk-g') || {}).value, svc: !!document.querySelector('#bk-body tr[data-bkrow="x_stock_rc"]'),
      t2svc: Array.from(document.querySelectorAll('.tier[data-opt="go+ar"] .tk-c.svc')).map((x) => x.textContent) }));
    ok('the Optimisation bank lists every optimisation (10 package lines + the two seeded services) with what each gives', bk0.rows === 12 && bk0.hl === '+4 highlights per product' && bk0.svc, bk0);
    ok('the Tier 2 card carries the seeded services as what-it-gives chips (Stock RC%, Restock)', bk0.t2svc.some((t) => /Stock RC%/.test(t)) && bk0.t2svc.some((t) => /Restock/.test(t)), bk0.t2svc);
    ok('the preview switch offers Today · Tier 1 · Tier 2 · Tier 3', bk0.seg === 4);
    await p.click('#svc-prev [data-pv="go+ar+rf"]'); await p.waitForTimeout(500);
    const pv3 = await p.evaluate(() => ({ gv: (document.querySelector('#svc-prev .pv-gv') || {}).textContent || '', rf: Array.from(document.querySelectorAll('#svc-prev .pv-fr .fs')).filter((x) => / ↻$/.test(x.textContent)).length,
      dyn: (() => { const w = document.querySelector('#svc-prev .pv-dynw'); return w && !w.hidden ? { n: w.querySelector('.pv-dyn').textContent, t: w.title } : null; })(),
      seg: (document.querySelector('#svc-prev [data-pv="go+ar+rf"]') || {}).textContent, texts: !!document.querySelector('#svc-prev .pv-n') || !!(document.querySelector('#svc-prev .pv-ex') || {}).textContent,
      miss: document.querySelectorAll('#svc-prev .pv-fr .fv.miss').length }));
    ok('Tier 3 is named AI-Intel Refresher and counts its Dynamic fields (3 by default: keywords · Q&A · highlights); the note and footnote texts are gone',
      pv3.seg === 'Tier 3 · AI-Intel Refresher' && pv3.dyn && pv3.dyn.n === '3' && /Keywords · Q&A · Product highlights/.test(pv3.dyn.t) && !pv3.texts, { seg: pv3.seg, dyn: pv3.dyn, texts: pv3.texts });
    ok('Tier 3 in the preview: "What Tier 3 gives" with the refresh, the refreshed fields marked ↻, nothing missing', /What Tier 3 gives/.test(pv3.gv) && /Everything in Tier 2/.test(pv3.gv) && /refreshed monthly/.test(pv3.gv) && pv3.rf >= 2 && pv3.miss === 0, pv3);
    await p.click('#svc-prev [data-pv="go+ar"]'); await p.waitForTimeout(400);
    const gv2 = await p.evaluate(() => document.querySelector('#svc-prev .pv-gv').textContent);
    ok('Dynamic fields shows only on Tier 3', await p.evaluate(() => document.querySelector('#svc-prev .pv-dynw').hidden));
    ok('Tier 2 in the preview lists what it gives — +4 highlights, +5–8 details, Stock RC%, Restock', /\+4 highlights/.test(gv2) && /\+5–8 product details/.test(gv2) && /Stock RC%/.test(gv2) && /Restock/.test(gv2), gv2);
    const t1a = await p.evaluate(() => window.__PZX.PQ.go.oneOff.total);
    await p.click('#bk-body tr[data-bkrow="highlights"] button[data-bkt="go"]');
    await p.waitForFunction(() => (window.__pzPuts || []).some((x) => x.name === 'bank'), null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(300);
    const mv = await p.evaluate(() => ({ put: (window.__pzPuts || []).filter((x) => x.name === 'bank').pop(), t1: window.__PZX.PQ.go.lines.some((l) => l.key === 'highlights' && l.status === 'priced'),
      tot: window.__PZX.PQ.go.oneOff.total, chip: Array.from(document.querySelectorAll('.tier[data-opt="go"] .tk-c')).some((c) => /products with highlights/.test(c.textContent)),
      moved: !!document.querySelector('#bk-body tr[data-bkrow="highlights"] .bk-tag.mv') }));
    ok('moving Highlights to Tier 1 in the bank saves it and puts it on the Tier 1 quote, card and price', mv.put && mv.put.body.highlights && mv.put.body.highlights.pkg === 'go' && mv.t1 && mv.tot > t1a && mv.chip && mv.moved, { t1: mv.t1, tot: mv.tot, t1a, chip: mv.chip, moved: mv.moved });
    await p.click('#bk-body tr[data-bkrow="highlights"] button[data-bkt="ar"]'); await p.waitForTimeout(300);
    await p.click('#bk-add summary');
    await p.fill('#bkn-label', 'Size chart links'); await p.fill('#bkn-fields', 'document_link'); await p.fill('#bkn-gives', 'a size chart on every product');
    await p.selectOption('#bkn-pkg', 'rf');
    await p.click('#bk-add [data-bkadd]'); await p.waitForTimeout(400);
    const nw = await p.evaluate(() => ({ row: !!document.querySelector('#bk-body tr[data-bkrow="x_size_chart_links"]'), q3: (window.__PZX.PQ['go+ar+rf'].lines.filter((l) => l.key === 'x_size_chart_links')[0] || {}).status,
      q2: window.__PZX.PQ['go+ar'].lines.some((l) => l.key === 'x_size_chart_links'), chip: Array.from(document.querySelectorAll('.tier[data-opt="go+ar+rf"] .tk-c')).some((c) => /Size chart links/.test(c.textContent) && /£ tbc/.test(c.textContent)) }));
    ok('＋ Add an optimisation (Tier 3, no price yet): it joins the bank and the Tier 3 quote as "£ tbc" — never £0 — and stays off Tier 2', nw.row && nw.q3 === 'unpriced' && !nw.q2 && nw.chip, nw);
    await p.click('#bk-body tr[data-bkrow="x_size_chart_links"] [data-bkdel]'); await p.waitForTimeout(300);
    if (process.env.PZ_SHOTS) await (await p.$('#svc-bank')).screenshot({ path: process.env.PZ_SHOTS + '/bank.png' });
    ok('Remove takes it out of the bank and the quote', await p.evaluate(() => !document.querySelector('#bk-body tr[data-bkrow="x_size_chart_links"]') && !window.__PZX.PQ['go+ar+rf'].lines.some((l) => l.key === 'x_size_chart_links')));
    // 16 — the client contact
    ok('the debrief opens with Northwind\'s remembered contact', (await p.inputValue('#db-to')) === 'buyer@northwind.invalid');
    // 21 — an edited email survives a Customise change, and says the figures moved
    await p.fill('#db-body', 'Hello — my own words');
    await p.click('#pq-cust');
    await p.waitForSelector('#svc-cust [data-cb="includeContracted"]');
    await p.click('#svc-cust [data-cb="includeContracted"]');
    await p.waitForTimeout(250);
    const kept = await p.evaluate(() => ({ body: document.querySelector('#db-body').value, reset: !document.querySelector('#db-reset').hidden, edited: window.__PZX.SV.dbEdited }));
    ok('an edited debrief email is kept through a Customise change (↺ stays offered)', kept.body === 'Hello — my own words' && kept.reset && kept.edited, kept);
    await p.click('#svc-cust [data-cb="includeContracted"]');
    // 28 — one toast says the draft was queued AND what happened to the sent stamp
    await p.click('#db-draft');
    await p.waitForFunction(() => (window.__pzAsk || []).length === 1, null, { timeout: 5000 });
    await p.waitForTimeout(100);
    const t28 = await toast();
    ok('✉ Create Gmail draft says the draft is queued, in the same toast as the sent-stamp outcome', /Gmail draft queued/.test(t28) && /not recorded as sent/.test(t28), t28);
    // 32 — a body the bridge would cut is refused before the POST
    await p.fill('#db-body', 'x'.repeat(8100));
    await p.click('#db-draft');
    await p.waitForTimeout(200);
    const t32 = await toast(), asks32 = await p.evaluate(() => (window.__pzAsk || []).length);
    ok('a debrief body over 8,000 characters is refused before it reaches the Drafts bridge', asks32 === 1 && /8,000/.test(t32), [asks32, t32]);
    await p.click('#db-reset');
    await p.waitForTimeout(200);
    ok('↺ Back to the generated text restores the guarded email and hides itself', await p.evaluate(() => document.querySelector('#db-body').value.indexOf('[£ to confirm') >= 0 && document.querySelector('#db-reset').hidden));
    // B — a test package rides on the option
    const m0 = await p.evaluate(() => window.__PZX.PQ.go.monthly.total);
    await p.click('#svc-cust button[data-tests="3"]');
    await p.waitForTimeout(300);
    const tB = await p.evaluate(() => { const q = window.__PZX.PQ.go; return { t: q.tests, m: q.monthly.total, card: document.querySelector('.tier[data-opt="go"] .money').innerText,
      draftBl: q.blockers.some((b) => b.code === 'draft-tests'), body: document.querySelector('#db-body').value, on: (() => { const x = document.querySelector('#svc-cust button[data-tests="3"]'); return x ? x.getAttribute('aria-pressed') : null; })() }; });
    ok('Customise → 3 tests a month adds the draft £1,140 line to the monthly total and the card', tB.t.n === 3 && tB.t.price === 1140 && tB.t.draft && Math.abs(tB.m - m0 - 1140) < 0.01 && /test package 3 tests/.test(tB.card) && tB.on === 'true', tB);
    ok('a draft test price keeps the option off client-safe, and the guarded email names the package', tB.draftBl && /Test package/.test(tB.body), { draftBl: tB.draftBl });
    await p.evaluate(() => { const b2 = document.querySelector('#rc-tabs button[data-tab="mgmt"]'); b2.click(); });
    await p.waitForSelector('#rc-g input[data-k="_g|test3"]');
    ok('the Management tab carries the three test-package prices, the draft shown as a placeholder', await p.evaluate(() => ['2', '3', '4'].every((n) => !!document.querySelector('#rc-g input[data-k="_g|test' + n + '"]')) && (document.querySelector('#rc-g input[data-k="_g|test3"]') || {}).placeholder === 'draft 1140' && (document.querySelector('#rc-g input[data-k="_g|test3"]') || {}).value === ''));
    ok('the Management tab carries the AI-Intel Refresher % — the draft 50 shown as a placeholder', await p.evaluate(() => { const x = document.querySelector('#rc-g input[data-k="_g|rfPct"]'); return !!x && x.placeholder === 'draft 50' && x.value === ''; }));
    await p.fill('#rc-g input[data-k="_g|test3"]', '999');
    await p.press('#rc-g input[data-k="_g|test3"]', 'Tab');
    await p.waitForFunction(() => window.__PZX.PQ.go.tests.price === 999, null, { timeout: 5000 }).catch(() => {});
    const tB2 = await p.evaluate(() => ({ t: window.__PZX.PQ.go.tests || {}, put: (window.__pzPuts || []).filter((x) => x.name === 'price').pop() }));
    ok('Management\'s £999 for 3 tests is saved to _g|test3 and priced without the draft flag', tB2.t.price === 999 && !tB2.t.draft && tB2.put && tB2.put.body['_g|test3'] && tB2.put.body['_g|test3'].v === 999, tB2.t);
    await p.click('#svc-cust button[data-tests="0"]');
    // C — the AI-Intel Refresher controls: quarterly counts a third a month; a field left out comes off the price; Management's % cell
    const rf0 = await p.evaluate(() => window.__PZX.PQ['go+ar+rf'].refresh);
    await p.click('#svc-cust button[data-rfcad="quarterly"]');
    await p.waitForTimeout(250);
    const rfQ = await p.evaluate(() => ({ F: window.__PZX.PQ['go+ar+rf'].refresh, on: document.querySelector('#svc-cust button[data-rfcad="quarterly"]').getAttribute('aria-pressed'), money: document.querySelector('.tier[data-opt="go+ar+rf"] .money').innerText }));
    ok('Customise → Quarterly: the same refresh, counted as a third of it a month', rfQ.F.cadence === 'quarterly' && rfQ.on === 'true' && (rf0.status !== 'priced' || (Math.abs(rfQ.F.perRefresh - rf0.perRefresh) < 0.01 && Math.abs(rfQ.F.monthlyEq - rf0.perRefresh / 3) < 0.02 && /a quarter/.test(rfQ.money))), { rf0, rfQ });
    await p.uncheck('#svc-cust input[data-rff="qa"]');
    await p.waitForTimeout(250);
    const rfF = await p.evaluate(() => window.__PZX.PQ['go+ar+rf'].refresh);
    ok('unticking Q&A takes it off the refresh', rfF.fields.map((f) => f.id).indexOf('qa') < 0 && rfF.fields.length === rf0.fields.length - 1, rfF.fields.map((f) => f.id));
    await p.click('#svc-cust button[data-rfcad="monthly"]');
    await p.check('#svc-cust input[data-rff="qa"]');
    await p.waitForTimeout(150);
    // 25 — ↺ Reset covers the highlight sources
    await p.check('#svc-cust input[data-hl="reviews"]');
    await p.waitForTimeout(150);
    await p.click('#svc-cust [data-act="custreset"]');
    await p.waitForTimeout(150);
    ok('↺ Reset restores the highlight sources too', await p.evaluate(() => window.__PZX.SV.hlSrc.reviews === false && window.__PZX.SV.hlSrc.desc === true));
    // 17 — Customise and language groups belong to one client
    await p.fill('#svc-cust input[data-c="retainerH"]', '6');
    await p.press('#svc-cust input[data-c="retainerH"]', 'Tab');
    await p.check('#svc-cust input[data-cb="absorbMonitoring"]');
    await p.selectOption('#svc-mk select[data-lang="gb"]', 'de');
    await p.waitForTimeout(200);
    const nwSet = await p.evaluate(() => ({ r: window.__PZX.SV.popts.retainerH, a: window.__PZX.SV.popts.absorbMonitoring, l: window.__PZX.SV.lang.gb }));
    await p.selectOption('#brand', 'Thornfield');
    await p.waitForTimeout(400);
    const th = await p.evaluate(() => ({ r: window.__PZX.SV.popts.retainerH, a: window.__PZX.SV.popts.absorbMonitoring, lang: window.__PZX.SV.lang, to: document.querySelector('#db-to').value, c: window.__PZX.SV.client }));
    ok('Northwind\'s retainer hours, monitoring absorbed and GB language group never carry over to Thornfield', nwSet.r === 6 && nwSet.a && nwSet.l === 'de' && th.c === 'Thornfield' && th.r === 0 && !th.a && !Object.keys(th.lang).length, { nwSet, th });
    ok('loading Thornfield clears Northwind\'s buyer from the contact field', th.to === '', th.to);
    const ovl = await p.evaluate(() => ({ aon: (document.querySelector('.tier[data-opt="go"] .aon') || {}).innerText || '', pm: window.__PZX.PQ.go && window.__PZX.PQ.go.perMarket[0] }));
    ok('a market whose new products an AI Quote bundle covers reads "covered by QT…", never its would-be £', /covered by QT260101/.test(ovl.aon) && ovl.pm && ovl.pm.overlap === 'QT260101' && !/Every new product: £/.test(ovl.aon), ovl.aon);
    // 16 — an address another client is remembered by is asked about, and nothing is drafted on a No
    await p.fill('#db-to', 'buyer@northwind.invalid');
    await p.click('#db-draft');
    await p.waitForTimeout(200);
    ok('a draft to another client\'s remembered contact asks first, and a No drafts nothing', dialogs.some((d) => /Northwind's remembered contact/.test(d)) && (await p.evaluate(() => (window.__pzAsk || []).length)) === 1, dialogs);
    await p.selectOption('#brand', 'Northwind');
    await p.waitForTimeout(400);
    ok('back on Northwind the field holds Northwind\'s contact again', (await p.inputValue('#db-to')) === 'buyer@northwind.invalid');
    // 24 + 36 — a rate-card cell commits on Enter, and the custom quote redraws off the same card
    // open the custom quote (a click on its toggle would CLOSE it when the device already holds it open)
    if (await p.evaluate(() => document.getElementById('sec-cq').hidden)) await p.click('.sec-tog[data-sec="cq"]');
    await p.waitForSelector('#cat-grid input[data-id="title_gen"]');
    await p.check('#cat-grid input[data-id="title_gen"]');
    await p.waitForTimeout(150);
    await p.evaluate(() => { document.querySelector('#rc-tabs button[data-tab="aspl"]').click(); });
    await p.waitForSelector('#rc-body .r-ed[data-k="title_gen|aspl"]');
    await p.click('#rc-body .r-ed[data-k="title_gen|aspl"]');
    await p.fill('#rc-body input.r-in', '40');
    await p.press('#rc-body input.r-in', 'Enter');
    await p.waitForTimeout(600);
    const rc = await p.evaluate(() => ({ inputs: document.querySelectorAll('#svc-rates input.r-in').length, cell: (document.querySelector('#rc-body .r-ed[data-k="title_gen|aspl"]') || {}).textContent, q: document.querySelector('#q-body').innerText }));
    ok('Enter commits a rate-card cell and redraws it at once (no dead input left behind)', rc.inputs === 0 && rc.cell === '40', rc);
    ok('the custom quote on screen redraws off the edited rate card (ASPL 40), the figure ⧉ Copy and 💾 Save read', /ASPL 40/.test(rc.q), rc.q.slice(0, 200));
    // 13 / 30 — only OUR refused keys are reported; a colleague's newer value is adopted silently
    await p.evaluate(() => window.__PZX.stores.ops.set('title_gen|qc', { v: 5 }));
    await p.waitForTimeout(400);
    await p.evaluate(() => { window.__pzS.ops['title_gen|qc'] = { v: 7, by: 'Steven', at: Date.now() + 600000 }; document.querySelector('#toast').textContent = ''; });
    await p.evaluate(() => window.__PZX.stores.ops.set('title_gen|pm', { v: 2 }));
    await p.waitForTimeout(500);
    const r13 = await p.evaluate(() => ({ toast: document.querySelector('#toast').textContent, qc: window.__PZX.stores.ops.data['title_gen|qc'], pm: window.__PZX.stores.ops.data['title_gen|pm'], state: window.__PZX.stores.ops.state }));
    ok('a colleague\'s newer key refused on OUR whole-map save is adopted silently (we never touched it)', !/Steven/.test(r13.toast) && r13.qc && r13.qc.v === 7 && r13.pm && r13.pm.v === 2 && /saved/.test(r13.state), r13);
    await p.evaluate(() => { window.__pzS.ops['title_gen|qc'] = { v: 8, by: 'Steven', at: Date.now() + 600000 }; });
    await p.evaluate(() => window.__PZX.stores.ops.set('title_gen|qc', { v: 6 }));
    await p.waitForTimeout(500);
    const r13b = await p.evaluate(() => ({ toast: document.querySelector('#toast').textContent, qc: window.__PZX.stores.ops.data['title_gen|qc'] }));
    ok('a key WE changed on top of a colleague\'s newer value is reported ("changed by Steven") and theirs is kept', /changed by Steven/.test(r13b.toast) && r13b.qc && r13b.qc.v === 8, r13b);
    ok('no console error through the round-1 drive', !errs.length, errs.slice(0, 3));
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }

  console.log('\nThe proposals store is full (413)');
  {
    const { p, ctx, errs, tmp } = await open(b, HTML, 1440, { delay: 50, me: OWNER, full: true });
    await p.waitForSelector('.tier', { timeout: 15000 });
    await p.waitForTimeout(300);
    await p.click('#pq-save');
    await p.waitForTimeout(5000);
    const r = await p.evaluate(() => ({ n: window.__pzFull || 0, state: document.querySelector('#sp-state').textContent, toast: document.querySelector('#toast').textContent }));
    ok('a 413 is said once (the store is full) and never retried', r.n === 1 && /full/.test(r.state), r);
    ok('no console error on a full store', !errs.length, errs.slice(0, 3));
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }

  console.log('\nA client-scoped signin in ⇪ File');
  {
    const { p, ctx, errs, tmp } = await open(b, HTML, 1440, { delay: 50, me: { email: 'northwind@feedspark.com', owner: false, modules: null, name: 'Northwind team', clients: ['Northwind'] } });
    await p.waitForSelector('.tier', { timeout: 15000 });
    await p.click('#svc-src button[data-src="file"]');
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => ({ note: document.querySelector('#svc-note').innerText, save: document.querySelector('#pq-save').disabled }));
    ok('a scoped signin is told in ⇪ File, before building, that a prospect proposal needs an unscoped signin — and Save is off', /unscoped signin/.test(r.note) && r.save, r);
    ok('no console error for the scoped signin', !errs.length, errs.slice(0, 3));
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }

  console.log('\nA live read that returns no products');
  {
    const { p, ctx, errs, tmp } = await open(b, HTML, 1440, { delay: 50, me: OWNER, emptyFeed: true });
    await p.waitForFunction(() => window.__PZX && window.__PZX.FAILED['Northwind|gb'], null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => ({ chip: (document.querySelector('.mchip[data-m="gb"]') || {}).innerText || '', live: !!(window.__PZX && window.__PZX.LIVE['Northwind|gb']), src: window.__PZX && window.__PZX.SV.audits[0] && window.__PZX.SV.audits[0].audit.src }));
    ok('an empty live read is a FAILED read (never "live ✓"), and the stored reading stays', /failed/.test(r.chip) && !r.live && r.src === 'stored', r);
    ok('no console error on an empty read', !errs.length, errs.slice(0, 3));
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }

  console.log('\nThe Feed Lab parser does not load');
  {
    const { p, ctx, errs, tmp } = await open(b, HTML, 1440, { delay: 50, me: OWNER, noFA: true });
    await p.waitForSelector('.tier', { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(500);
    const r = await p.evaluate(() => ({ fail: !!document.querySelector('.eng-fail'), tiers: document.querySelectorAll('.tier').length, cards: document.querySelectorAll('#cat-grid input').length, chip: (document.querySelector('.mchip[data-m="gb"]') || {}).innerText }));
    ok('without /feedlab/engine.js the page still renders (stored tiers, the custom quote) and the market says the read failed', !r.fail && r.tiers >= 2 && r.cards > 0 && /failed/.test(r.chip || ''), r);
    ok('no page error without the parser', !errs.filter((e) => !/404/.test(e)).length, errs.slice(0, 3));
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }

  console.log('\n✎ New version on a prospect (⇪ File) option');
  {
    const seed = STUBS.build().stores;
    seed.proposals.oacme000001 = Object.assign(JSON.parse(JSON.stringify(seed.proposals.onorth00001)), { ref: 'SVC300001', client: 'Acme Prospect', markets: ['de'],
      prop: { id: 'ppacme01', n: 1, label: 'Tier 1 · Google-ready' }, opts: { src: 'file', industry: 'Retail', popts: {} } });
    const { p, ctx, errs, tmp } = await open(b, HTML, 1440, { delay: 50, me: OWNER, seed });
    await p.waitForSelector('.tier', { timeout: 15000 });
    await p.click('#sp-filter button[data-spf="all"]');
    await p.waitForSelector('button[data-sp="version"][data-id="oacme000001"]');
    await p.click('button[data-sp="version"][data-id="oacme000001"]');
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ mode: window.__PZX.SV.mode, name: document.querySelector('#svc-pname').value, mkt: document.querySelector('#svc-fmkt').value,
      note: document.querySelector('#svc-note').innerText, btn: document.querySelector('#pq-save').textContent, ver: window.__PZX.SV.version }));
    ok('it returns to ⇪ File with the prospect\'s name and market filled in and asks for its feed file', r.mode === 'file' && r.name === 'Acme Prospect' && r.mkt === 'de' && /Re-read Acme Prospect/.test(r.note) && r.ver === 'oacme000001', r);
    ok('the save button says it will save a new version even before the file is read', /new version/.test(r.btn), r.btn);
    ok('no console error on the prospect version', !errs.length, errs.slice(0, 3));
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }
  await b.close();

  console.log('\nThe page source');
  ok('ex VAT everywhere — no "+VAT"', SRC.indexOf('+VAT') < 0);
  ok('labelguard is imported from a Blob, never a <script src="/labels/engine.js">', /fetch\('\/labels\/engine\.js'\)/.test(SRC) && /import\(URL\.createObjectURL\(new Blob\(/.test(SRC) && !/<script[^>]+src="\/labels\/engine\.js"/.test(SRC));
  ok('the talk track and the email never collapse behind ⓘ', /id="db-talk" data-no-collapse/.test(SRC) && /id="db-mail" data-no-collapse/.test(SRC));
  ok('the proposal and the rollout carry their phone digests', /id="svc-prop" data-m-digest=/.test(SRC) && /id="svc-rollout" data-m-digest=/.test(SRC));
  ok('the custom quote keeps its scaffolds and its monthly refresh select (the lead\'s scope decision)', /var SCAFFOLDS=/.test(SRC) && /id="pz-scaf"/.test(SRC) && /id="pz-refresh"/.test(SRC));
  ok('the module is titled Services & Pricer', (SRC.match(/Services &amp; Pricer/g) || []).length >= 3);
  ok('nothing annual or ×12 on the page', !/annual|year[- ]?one|year 1\b|×\s?12|\*\s?12\b/i.test(SRC.replace(/<script>\/\* PRICER ENGINE LOADERS[\s\S]*?<\/script>/, '')));
  ok('the tracking table offers every id the engine tags (CATALOG + PKG_ROWS), so attr_pop never reads "— pick —"', /\[\['','— pick —'\]\]\.concat\(E\.CATALOG\.concat\(E\.PKG_ROWS/.test(SRC));
  ok('the Feed Lab engine is optional in the loader (only the Pricer engine is fatal)', /\['\/feedlab\/engine\.js', 'FeedAudit', 0\]/.test(SRC) && /if \(!a\[0\]\) throw/.test(SRC));
  ok('a 413 is a hard refusal in the store client', /r\.status===413/.test(SRC));
  ok('no old tier name on the page', !/Google Optimise \+ AI Readiness|Tier 1 · Google Optimise|Offer AI Readiness alone/.test(SRC));
  ok('the stores are the new ones — the page never writes the legacy rate card', !/fetch\('\/api\/tachyon\/rates',\{method:'PUT'/.test(SRC) && /\/api\/pricer\/'\+name/.test(SRC));

  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();
