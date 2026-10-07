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
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  if (o && o.seed) await p.addInitScript('window.__pzS=' + JSON.stringify(o.seed) + ';');
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
    const clip = await p.evaluate(() => Array.from(document.querySelectorAll('.tier .ln-a a')).map((a) => { const f = a.closest('.rc-scroll').getBoundingClientRect(), r = a.getBoundingClientRect(); return Math.round(r.right - f.right); }));
    ok('no "→ Brief" link is clipped by its tier card at 1440px', clip.length > 0 && clip.every((d) => d <= 0), clip);
    // A — the tier names
    const names = await p.evaluate(() => Array.from(document.querySelectorAll('.tier h3')).map((h) => h.innerText));
    ok('the tiers read Tier 1 · Google-ready and Tier 2 · AI-ready, each with its sub-label', /^Tier 1 · Google-ready/.test(names[0]) && /eligible \+ everything Google recommends/.test(names[0]) && /^Tier 2 · AI-ready/.test(names[1]) && /the bundle/.test(names[1]), names);
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
    await p.fill('#rc-g input[data-k="_g|test3"]', '999');
    await p.press('#rc-g input[data-k="_g|test3"]', 'Tab');
    await p.waitForFunction(() => window.__PZX.PQ.go.tests.price === 999, null, { timeout: 5000 }).catch(() => {});
    const tB2 = await p.evaluate(() => ({ t: window.__PZX.PQ.go.tests || {}, put: (window.__pzPuts || []).filter((x) => x.name === 'price').pop() }));
    ok('Management\'s £999 for 3 tests is saved to _g|test3 and priced without the draft flag', tB2.t.price === 999 && !tB2.t.draft && tB2.put && tB2.put.body['_g|test3'] && tB2.put.body['_g|test3'].v === 999, tB2.t);
    await p.click('#svc-cust button[data-tests="0"]');
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
    await p.click('.sec-tog[data-sec="cq"]');
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
