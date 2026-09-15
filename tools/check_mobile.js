#!/usr/bin/env node
/* Phone tripwire (Ray, 15 Sep 2026: "complete overhaul for UX UI for mobile version — MIRROR
 * desktop setting"). Every app page is rendered at 390×844 (iPhone-class, touch) via file://
 * with stubbed fetches and the worker's injected widgets, and must hold:
 *   1. no page-level horizontal overflow (wide tables / workbenches pan inside their own frame);
 *   2. the topbar is one compact row (≤ 64px) — never the 630px icon column the old CSS produced;
 *   3. the module bar is visible and carries EVERY module the desktop menu carries;
 *   4. MIRROR: every control visible on the desktop render (1400px) is visible on the phone —
 *      nothing is hidden under a max-width rule (the old .at-act / .bs-ctx / .wf-go regressions);
 *   5. (reported, not failed) tap targets under 30px and the count of <11px text nodes.
 * Usage: node tools/check_mobile.js [--shots <dir>]   (screenshots per page when a dir is given)
 * Lives in presync (like the dark tripwire); CI has no browsers. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium, devices; try { ({ chromium, devices } = require('playwright')); } catch (e) { console.log('· playwright not installed — mobile tripwire skipped'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs');
const SHOTS = process.argv.indexOf('--shots') >= 0 ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'lang_widget.html', 'mobile_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const PAGES = fs.readdirSync(D).filter((f) => /^FeedSpark_.*\.html$/.test(f) && !/Strategy_Review|Deck/.test(f))
  .filter((f) => fs.readFileSync(path.join(D, f), 'utf8').indexOf('tb-modules') >= 0 || f === 'FeedSpark_Command_Center.html');
const STUB = `window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
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
  return { W, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, nCtl: ctl.length, counts, over, tiny, small, navVis, navLinks, napps, navAll, navFixed, tbH };
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
      res[mode] = await p.evaluate(COLLECT).catch((e) => ({ err: String(e).slice(0, 100) }));
      if (mode === 'mob' && SHOTS) { try { await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); await p.screenshot({ path: path.join(SHOTS, name + '_full.png'), fullPage: true, clip: { x: 0, y: 0, width: 390, height: Math.min(3000, res.mob.sh || 3000) } }); } catch (e) {} }
      await ctx.close();
    }
    try { fs.unlinkSync(tmp); } catch (e) {}
    const d = res.desk, m = res.mob;
    if (!d || !m || d.err || m.err) { fail++; console.log('  ✗ ' + name + ' — audit could not run: ' + JSON.stringify((d && d.err) || (m && m.err))); continue; }
    const hidden = Object.keys(d.counts).filter((k) => (m.counts[k] || 0) < d.counts[k]).filter((k) => !/^button:nav-collapse$/.test(k));
    const bad = [];
    if (m.sw > m.W + 1) bad.push('horizontal overflow ' + (m.sw - m.W) + 'px' + (m.over.length ? ' (' + m.over.join(' | ') + ')' : ''));
    if (m.tbH > 64) bad.push('topbar ' + m.tbH + 'px tall');
    if (!m.navVis || !m.navFixed) bad.push('module bar not shown as the fixed bottom bar');
    if (m.navLinks + m.napps < d.navAll) bad.push('module bar + ▦ sheet carry ' + (m.navLinks + m.napps) + ' of ' + d.navAll + ' modules');
    if (hidden.length) bad.push('hidden on the phone but visible on desktop: ' + hidden.slice(0, 8).join(' | ') + (hidden.length > 8 ? ' +' + (hidden.length - 8) : ''));
    if (bad.length) fail++;
    console.log((bad.length ? '  ✗ ' : '  ✓ ') + name.padEnd(17) + ' ctl ' + String(m.nCtl).padStart(4) + '/' + String(d.nCtl).padEnd(4) + ' tb ' + String(m.tbH).padStart(3) + 'px · bar ' + m.navLinks + '/' + d.navAll + ' · tiny ' + String(m.tiny).padStart(3) + ' · <11px ' + String(m.small).padStart(3) + (bad.length ? '\n      ' + bad.join('\n      ') : ''));
  }
  await b.close();
  console.log('\n' + PAGES.length + ' app pages at 390px' + (fail ? ' — ' + fail + ' failing the phone rules' : ' — phone rules hold'));
  process.exit(fail ? 1 : 0);
})();
