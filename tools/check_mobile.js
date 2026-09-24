#!/usr/bin/env node
/* Phone tripwire (Ray, 15 Sep 2026: "complete overhaul for UX UI for mobile version — MIRROR
 * desktop setting"). Every app page is rendered at 390×844 (iPhone-class, touch) via file://
 * with stubbed fetches and the worker's injected widgets, and must hold:
 *   1. no page-level horizontal overflow (wide tables / workbenches pan inside their own frame);
 *   2. the topbar is one compact row (≤ 64px) — never the 630px icon column the old CSS produced;
 *   3. the module bar is visible and carries EVERY module the desktop menu carries;
 *   4. MIRROR: every control visible on the desktop render (1400px) is visible on the phone —
 *      nothing is hidden under a max-width rule (the old .at-act / .bs-ctx / .wf-go regressions);
 *   5. (reported, not failed) tap targets under 30px and the count of <11px text nodes;
 *   6. SKIM VIEW (Ray, 18 Sep 2026, holding up the Meta Ads Manager app: "only necessary
 *      information for AM to make decisions while using mobile phone … a lot of collapse and
 *      expand"): a page with two or more sections opens with EVERY section folded behind its
 *      heading (docs/digest_widget.html) — asserted at first paint, on a fresh device; then
 *      everything is expanded before rule 4 counts, so the fold can never hide a control from it.
 * Usage: node tools/check_mobile.js [--shots <dir>]   (screenshots per page when a dir is given)
 * Lives in presync (like the dark tripwire); CI has no browsers. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium, devices; try { ({ chromium, devices } = require('playwright')); } catch (e) { console.log('· playwright not installed — mobile tripwire skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const SHOTS = process.argv.indexOf('--shots') >= 0 ? process.argv[process.argv.indexOf('--shots') + 1] : null;
// pages whose control scale has been set — add a page here in the PR that tidies it
const SCALED = /^(TaskManager)$/;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'lang_widget.html', 'hours_widget.html', 'shipped_widget.html', 'mobile_widget.html', 'digest_widget.html', 'migration_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
// /roas reads its book from /api/roas (KV, nothing committed) — the synthetic stub in
// tools/roas_stub.js lets the scorecards, trend, movers and drill table render so the overflow
// and parity rules actually meet them
const ROAS_STUB = require('./roas_stub.js').stubLines();
const PAGES = fs.readdirSync(D).filter((f) => /^FeedSpark_.*\.html$/.test(f) && !/Strategy_Review|Deck/.test(f))
  .filter((f) => fs.readFileSync(path.join(D, f), 'utf8').indexOf('tb-modules') >= 0 || f === 'FeedSpark_Command_Center.html');
// FS Task Manager reads its book from /api/taskmanager (the worker pulls it out of the reports
// MCP and keeps it in KV — nothing is committed), so both browser tripwires feed it a small
// live-shaped payload. Without it /tasks renders its "not read yet" state and neither tripwire
// sees the chart, the tables or the search bar it is supposed to be checking.
const TMDATA = (() => {
  const mk = (d, owner, title, cat, bill, nb) => [d, owner, title, 'done', cat, bill * 4, nb * 4, (bill + nb) * 4, 0, 0, ''];
  const rows = [], OWN = ['Ray', 'Febin', 'Ezgi', 'Gary'], TT = ['Keyword optimisation', 'Title optimisation', 'GMC Fixing', 'New Feeds', 'Client call'];
  for (let i = 0; i < 120; i++) {
    const mth = 1 + (i % 9);
    rows.push({ d: '2026-0' + mth + '-1' + (i % 9), client: i % 2 ? 'Reiss' : 'Schuh', market: i % 3 ? 'GB' : 'DE',
      am: 'Ray', owner: OWN[i % 4], title: TT[i % 5], status: 'done', cat: ['opt', 'opt', 'tech', 'feat', 'acct'][i % 5],
      bucket: 'done', bill: (i % 5) * 0.5, nonbill: (i % 3) * 0.25, hours: (i % 5) * 0.5 + (i % 3) * 0.25,
      sched: 1, id: 1000 + i, ticket: 0, note: '' });
  }
  const tickets = [{ id: 1, client: 'Reiss', subject: 'Israel Feed Set Up', status: 'open', d: '2026-09-16',
    first: '2026-09-14', by: 'internal', origin: 'client', from: 'a@reiss.com', age: 2, level: 'ok',
    idle: 1, msgs: 7, tasks: 0, hours: 0.5, am: 'Ray' }];
  const accounts = [{ cid: 155, tid: 51, client: 'Reiss', market: 'GB', name: 'Reiss - GB', group: '', flag: 0,
    status: 'active', type: 'FM', am: 'Ray', am2: '', allowance: 35, used: 38.25, balance: -36.75, health: 'negative', since: '2019-01-01' }];
  return JSON.stringify({ from: '2025-10-01', to: '2026-09-16', months: 12, at: Date.now(), rows, tickets, accounts,
    coverage: [{ client: 'Reiss', market: 'GB', cid: 155, at: Date.now(), n: 60, pulled: 80, deepest: '2024-01-01', full: true, capped: false }],
    ticketCoverage: [{ client: 'Reiss', at: Date.now(), n: 1, pulled: 3, deepest: '2024-10-01' }],
    health: { read: 1, total: 2, partial: 0, oldest: Date.now(), newest: Date.now(), complete: false, staleHours: 0 },
    scoped: false, queuesTotal: 2 });
})();
const STUB = `window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 if(url.indexOf('/api/taskmanager')>=0)return j({ok:true,owner:true,scoped:false,status:{state:'ok',at:Date.now()},data:${TMDATA}});
${ROAS_STUB}
 if(url.indexOf('/api/presence')>=0)return j({ok:true,me:'ray@feedspark.com',owner:true,now:Date.now(),users:[{e:'ray@feedspark.com',n:'Ray',p:'/workflow',t:Date.now()},{e:'steven@feedspark.com',n:'Steven',p:'/',t:Date.now()}],roster:[]});
 if(url.indexOf('/api/access')>=0)return j({ok:true,email:'ray@feedspark.com',owner:true,clients:null,modules:null});
 if(url.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:1,warn:2,pt:{crit:0,warn:1},gr:{crit:0,warn:0},clients:{}});
 if(url.indexOf('/api/i18n')>=0)return j({ok:true,lang:'vi',map:{},n:0,ai:'nokey'});
 if(url.indexOf('/api/claude')>=0)return j({ok:true,configured:false});
 return j({ok:false,error:'stub'},404);};`;
const COLLECT = `(() => {
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0') return false; const r = el.getBoundingClientRect(); return r.width>0 && r.height>0; };
  const sig = (el) => (el.tagName.toLowerCase()+':'+(el.id||el.getAttribute('aria-label')||el.getAttribute('title')||(el.textContent||'').trim().slice(0,28)||el.getAttribute('href')||'')).replace(/\\s+/g,' ');
  const ctl = Array.from(document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[contenteditable="true"],summary')).filter(vis);
  const counts = {}; ctl.forEach((el) => { const s = sig(el); counts[s] = (counts[s]||0)+1; });
  const W = innerWidth, over = [];
  if (document.documentElement.scrollWidth > W + 1) for (const el of document.querySelectorAll('body *')) { if (!vis(el)) continue; const cs = getComputedStyle(el); if (cs.position==='fixed') continue; const r = el.getBoundingClientRect(); if (r.right > W + 2 && r.width > 30 && r.width < 8000) { over.push(el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\\s+/).slice(0,2).join('.'):'')+' '+Math.round(r.width)+'w'); if (over.length>=6) break; } }
  let tiny = 0; ctl.forEach((el) => { if (el.closest('#tb-modules,.instr-tgl,.info-btn')) return; const r = el.getBoundingClientRect(); if (r.height < 30 && r.top < 4000) tiny++; });
  let small = 0; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.nodeValue.trim() || !n.parentElement || !vis(n.parentElement)) continue; if (parseFloat(getComputedStyle(n.parentElement).fontSize) < 11) small++; }
  const nav = document.getElementById('tb-modules'); const navVis = nav ? vis(nav) : false; const navLinks = nav ? Array.from(nav.querySelectorAll('a.tbm')).filter(vis).length : 0;
  const napps = document.querySelectorAll('#fcc-apps-menu a.tbm.napps').length;   // bundled into ▦ by the viewer's layout — reachable from the sheet
  const navAll = nav ? nav.querySelectorAll('a.tbm').length + napps : 0;
  const tb = document.querySelector('.topbar-in'); const tbH = tb ? Math.round(tb.getBoundingClientRect().height) : 0;
  const navFixed = nav ? getComputedStyle(nav).position === 'fixed' : false;
  /* CONTROL SCALE (Ray, 18 Sep 2026: "the box and button in the task manager are not equal size,
     so it looks messy … review the entire page UX/UI and ensure these elements are not outdated.
     It should stay consistent"). A page accumulates a bespoke height per feature until an eye
     reads the row as mess before it can name why; measured on /tasks before the fix, ONE page
     carried ten control heights and three pill styles differing only by a pixel of padding.
     Measured on the DESKTOP pass only — under 760px the phone layer's own 36px tap-target rule
     governs, as it should. Components that are legitimately their own size are exempt BY NAME,
     never by being quietly rounded into a bucket. */
  const SKIP = '.tab,.fh-dot,.instr-tgl,.info-btn,.tg-add,.nav-collapse,.tbm,#tb-modules,.topbar-in,#q,.hero,.dz-x,.chipx,.tag,.pz-av,.cz-move,.close,.x';
  const scale = {};
  Array.from(document.querySelectorAll('select,input[type=text],input[type=search],button.btn,button.chip,.pq-x')).filter(vis).forEach((el) => {
    if (el.closest(SKIP) || el.matches(SKIP)) return;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    // a square control is an icon button — its size is its glyph, not the text scale
    if (Math.abs(r.width - r.height) < 3) return;
    const k = Math.round(r.height) + '|' + cs.paddingLeft + '|' + cs.borderRadius.split(' ')[0] + '|' + cs.fontSize;
    (scale[k] = scale[k] || []).push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''));
  });
  return { W, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, nCtl: ctl.length, counts, over, tiny, small, navVis, navLinks, napps, navAll, navFixed, tbH, scale };
})()`;
(async () => {
  const b = await chromium.launch({ headless: true });
  let fail = 0;
  for (const f of PAGES) {
    const name = f.replace('FeedSpark_', '').replace('.html', '');
    const src = fs.readFileSync(path.join(D, f), 'utf8');
    const html = src.indexOf('</body>') >= 0 ? src.replace('</body>', WIDGETS + '\n</body>') : src + '\n' + WIDGETS;
    const tmp = path.join(os.tmpdir(), '_mobcheck_' + f); fs.writeFileSync(tmp, html);
    const res = {};
    for (const mode of ['desk', 'mob']) {
      const ctx = await b.newContext(mode === 'desk' ? { viewport: { width: 1400, height: 900 } } : { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage(); await p.addInitScript(STUB);
      try { await p.goto('file://' + tmp, { timeout: 20000 }); await p.waitForTimeout(mode === 'mob' ? 1500 : 900); } catch (e) {}
      let skim = null;
      if (mode === 'mob') {
        // the skim view as the reader meets it (fresh device = every section folded), then the
        // whole page opened out so the parity count below sees every control the desktop has
        skim = await p.evaluate('window.FCCDigest ? FCCDigest.state() : null').catch(() => null);
        if (SHOTS) { try { await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); } catch (e) {} }
        await p.evaluate('window.FCCDigest && FCCDigest.expandAll({ silent: true, caps: true })').catch(() => {});
        await p.waitForTimeout(500);
      }
      res[mode] = await p.evaluate(COLLECT).catch((e) => ({ err: String(e).slice(0, 100) }));
      if (mode === 'mob') { res.mob.skim = skim; if (SHOTS) { try { await p.screenshot({ path: path.join(SHOTS, name + '_full.png'), fullPage: true, clip: { x: 0, y: 0, width: 390, height: Math.min(3000, res.mob.sh || 3000) } }); } catch (e) {} } }
      await ctx.close();
    }
    try { fs.unlinkSync(tmp); } catch (e) {}
    const d = res.desk, m = res.mob;
    if (!d || !m || d.err || m.err) { fail++; console.log('  ✗ ' + name + ' — audit could not run: ' + JSON.stringify((d && d.err) || (m && m.err))); continue; }
    // injected-widget chrome (the collapse toggle, the per-section instruction/notes toggles)
    // is added at DOMContentLoaded and appears identically on both viewports — a count skew is
    // injection timing on a heavy page, not a page control hidden on mobile, so it's excluded
    const CHROME = /^button:(nav-collapse|Toggle instructions|Toggle the notes for this section)$/;
    const hidden = Object.keys(d.counts).filter((k) => (m.counts[k] || 0) < d.counts[k]).filter((k) => !CHROME.test(k));
    const bad = [];
    if (m.sw > m.W + 1) bad.push('horizontal overflow ' + (m.sw - m.W) + 'px' + (m.over.length ? ' (' + m.over.join(' | ') + ')' : ''));
    if (m.tbH > 64) bad.push('topbar ' + m.tbH + 'px tall');
    if (!m.navVis || !m.navFixed) bad.push('module bar not shown as the fixed bottom bar');
    if (m.navLinks + m.napps < d.navAll) bad.push('module bar + ▦ sheet carry ' + (m.navLinks + m.napps) + ' of ' + d.navAll + ' modules');
    if (hidden.length) bad.push('hidden on the phone but visible on desktop: ' + hidden.slice(0, 8).join(' | ') + (hidden.length > 8 ? ' +' + (hidden.length - 8) : ''));
    const sk = m.skim;
    if (sk && sk.n >= 2 && sk.closed < sk.n) bad.push('skim view: ' + (sk.n - sk.closed) + ' of ' + sk.n + ' sections open at first paint on a fresh device (' + sk.keys.join(', ') + ')');
    const skimTxt = sk ? ' · skim ' + sk.closed + '/' + sk.n + ' ' + Math.round(sk.h / 844 * 10) / 10 + '→' + Math.round(m.sh / 844 * 10) / 10 + 'scr' : ' · skim —';
    /* CONTROL SCALE. Two sizes are the whole vocabulary: a FIELD you open or type in, and a PILL
       you press. More than two means a feature styled its own control and the row stops lining
       up. Enforced where the scale has been set, REPORTED elsewhere with the page's own number,
       so the next module to be worked on has a target rather than a surprise failure that is not
       about the change in hand. */
    const scl = Object.keys(d.scale || {}).sort((a2, b2) => d.scale[b2].length - d.scale[a2].length);
    const nScale = scl.length;
    if (SCALED.test(name)) {
      if (nScale > 2) bad.push('control scale fragmented — ' + nScale + ' distinct sizes where there should be 2 (field + pill): '
        + scl.map((k) => k.split('|')[0] + 'px ×' + d.scale[k].length + ' ' + Array.from(new Set(d.scale[k])).slice(0, 3).join(',')).join('  |  '));
    }
    if (bad.length) fail++;
    console.log((bad.length ? '  ✗ ' : '  ✓ ') + name.padEnd(17) + ' ctl ' + String(m.nCtl).padStart(4) + '/' + String(d.nCtl).padEnd(4) + ' tb ' + String(m.tbH).padStart(3) + 'px · bar ' + m.navLinks + '/' + d.navAll + ' · tiny ' + String(m.tiny).padStart(3) + ' · <11px ' + String(m.small).padStart(3)
      + ' · scale ' + nScale + (SCALED.test(name) ? '' : '*') + skimTxt + (bad.length ? '\n      ' + bad.join('\n      ') : ''));
  }
  await b.close();
  console.log('\n' + PAGES.length + ' app pages at 390px' + (fail ? ' — ' + fail + ' failing the phone rules' : ' — phone rules hold'));
  console.log('control scale: enforced on ' + SCALED.source.replace(/[^A-Za-z|]/g, '').split('|').join(', ')
    + ' · * = reported only, tidy it when you next work that page');
  process.exit(fail ? 1 : 0);
})();
