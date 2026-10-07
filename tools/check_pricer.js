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
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.addInitScript(stub(o));
  await p.goto('file://' + tmp);
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
    // a market whose feed cannot be read
    await p.click('.mchip[data-m="de"]');
    await p.waitForFunction(() => window.__PZX && window.__PZX.FAILED['Northwind|de'], null, { timeout: 10000 });
    await p.waitForTimeout(300);
    if (vp === 390) await p.evaluate('window.FCCDigest && FCCDigest.expandAll({ silent: true, caps: true })');
    const de = await p.evaluate(() => ({
      chip: document.querySelector('.mchip[data-m="de"]').innerText,
      tp: !!document.querySelector('.tp-in[data-tp="de"]'),
      kw: (document.querySelector('.tier[data-opt="go"] tr[data-line="keywords"] .stc') || {}).textContent,
      fix: Array.from(document.querySelectorAll('.tier[data-opt="go"] .fixes li')).map((li) => li.innerText).join(' | '),
    }));
    ok('the refused DE feed says "failed" on its chip and offers the typed-parents input', /failed/.test(de.chip) && de.tp, de);
    ok('the unsized keyword line shows its fix', /not sized/.test(de.kw || '') && /Keyword optimisation/.test(de.fix) && /count the live feed/.test(de.fix), de);
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
    ok('💾 Save as proposal writes every shown tier under ONE proposal id, with SVC references', saved.n === 2 && saved.ids[0] === saved.ids[1] && saved.refs.every((r) => /^SVC\d{6}(-\d+)?$/.test(r)) && saved.opts.join() === 'go,go+ar', saved);
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
    ok('no console error for the AM signin', !errs.filter((e) => !/403/.test(e)).length, errs.slice(0, 3));
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
  ok('the stores are the new ones — the page never writes the legacy rate card', !/fetch\('\/api\/tachyon\/rates',\{method:'PUT'/.test(SRC) && /\/api\/pricer\/'\+name/.test(SRC));

  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();
