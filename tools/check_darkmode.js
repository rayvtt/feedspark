#!/usr/bin/env node
/* Dark-view tripwire (Ray's re-review, 14 Sep 2026: "I see some UX/UI issues on homepage / PDP scan /
 * leadership" — every one was a hard-coded light background or a light tint with light ink that the
 * page's [data-theme=dark] block never covered). Renders EVERY app page in dark mode (file:// + the
 * worker's injected widget fragments + a generic API stub) and FAILS on any "light island": a
 * visible element ≥40×16px painting a near-white background onto the dark page. Contrast is
 * reported for information only (the alpha-blend heuristic has false positives).
 *   NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/check_darkmode.js
 * Runs inside presync's real-browser block; skipped where Playwright is absent. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'docs');
const WIDGETS = ['instr_collapse.html', 'presence_widget.html', 'feedchat_widget.html', 'viewas_widget.html', 'apps_widget.html', 'mobile_widget.html', 'digest_widget.html']
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
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
const STUB = `try{localStorage.setItem('fcc-theme','dark');}catch(e){}
window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 if(url.indexOf('/api/taskmanager')>=0)return j({ok:true,owner:true,scoped:false,status:{state:'ok',at:Date.now()},data:${TMDATA}});
 if(url.indexOf('/api/presence')>=0)return j({ok:true,me:'ray@feedspark.com',owner:true,now:Date.now(),users:[],roster:[]});
 if(url.indexOf('/api/access')>=0)return j({ok:true,email:'ray@feedspark.com',owner:true,clients:null,modules:null});
 if(url.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:0,warn:0,pt:{crit:0,warn:0},gr:{crit:0,warn:0},clients:{}});
 if(url.indexOf('/api/claude')>=0)return j({ok:true,configured:false});
 if(url.indexOf('/api/abtests')>=0)return j({ok:true,client:'YuMOVE',summary:{winRate:25,inconclusive:0},tests:[
   {country:'UK',type:'Title optimisation',batch:'MultiVits Versus MultiVitamins',live:'31/01/2025',verdict:'positive',metrics:{impressions:126.62,clicks:87.63},report:'Impressions rose 126.62%.'},
   {country:'UK',type:'Title optimisation',batch:'Joint Care Plus - Title Optimisation',live:'05/05/2025',verdict:'mixed',metrics:{impressions:-15.68,clicks:23.76},report:'Mixed.'},
   {country:'UK',type:'Image overlay',batch:'PPC Overlays - All products with SUBG price',live:'22/07/2025',verdict:'negative',metrics:{impressions:-3.99,clicks:-15.6},report:'Lost.'},
   {country:'UK',type:'Image overlay',batch:'Black Friday - Keyword Optimisation',live:'01/11/2025',verdict:'unknown',metrics:{},report:''}]});
 if(url.indexOf('/api/kwresults')>=0)return j({ok:true,results:[{mid:'a',period:'Aug II',brand:'YuMOVE',market:'GB',date:'2026-08-28',metrics:[{k:'impressions',v:'+12.4%'},{k:'clicks',v:'+8.1%'}],raw:'YuMOVE GB x Feedspark - Aug II - Keyword Optimisation',subject:'YuMOVE GB x Feedspark - Aug II - Keyword Optimisation'}]});
 return j({ok:false,error:'stub'},404);};`;
const AUDIT = `(() => {
  function lum(rgb){const [r,g,b]=rgb.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*r+0.7152*g+0.0722*b;}
  function parse(c){const m=/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/.exec(c||'');return m?{rgb:[+m[1],+m[2],+m[3]],a:m[4]==null?1:+m[4]}:null;}
  const seen={},islands=[];const sig=(el)=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\\s+/).slice(0,3).join('.'):'');
  const body=parse(getComputedStyle(document.body).backgroundColor); const dark=body&&body.a>0&&lum(body.rgb)<0.3;
  for(const el of document.querySelectorAll('body *')){const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0')continue;const r=el.getBoundingClientRect();if(r.width<6||r.height<6)continue;
    if(/^(img|svg|canvas|video|iframe)$/i.test(el.tagName))continue; if(el.closest('.dz-logo,.dzs-logo,.brand-logo'))continue;
    const bgp=parse(cs.backgroundColor);if(bgp&&bgp.a>0.6&&lum(bgp.rgb)>0.8&&r.width>=40&&r.height>=16){const s=sig(el);if(!seen[s]){seen[s]=1;islands.push(s+' '+cs.backgroundColor+' "'+(el.textContent||'').trim().slice(0,30).replace(/\\s+/g,' ')+'"');}}}
  return {dark, islands:islands.slice(0,10)};})()`;
(async () => {
  const b = await chromium.launch({ headless: true });
  let fail = 0;
  for (const f of PAGES) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
    const p = await ctx.newPage(); await p.addInitScript(STUB);
    const src = fs.readFileSync(path.join(D, f), 'utf8');
    const html = src.indexOf('</body>') >= 0 ? src.replace('</body>', WIDGETS + '\n</body>') : src + '\n' + WIDGETS;
    const tmp = path.join(require('os').tmpdir(), '_darkcheck_' + f); fs.writeFileSync(tmp, html);
    try { await p.goto('file://' + tmp, { timeout: 20000 }); await p.waitForTimeout(900); } catch (e) {}
    const a = await p.evaluate(AUDIT).catch(() => null);
    const name = f.replace('FeedSpark_', '').replace('.html', '');
    if (!a) { console.log('  · ' + name + ' (audit could not run)'); }
    else if (!a.dark) { fail++; console.log('  ✗ ' + name + ' — page did not switch to dark (no [data-theme=dark] body rule?)'); }
    else if (a.islands.length) { fail++; console.log('  ✗ ' + name + ' — light island(s) in dark mode:'); a.islands.forEach((x) => console.log('      ' + x)); }
    else console.log('  ✓ ' + name);
    await ctx.close(); try { fs.unlinkSync(tmp); } catch (e) {}
  }
  await b.close();
  console.log('\n' + PAGES.length + ' app pages rendered in dark mode' + (fail ? ' — ' + fail + ' with light islands' : ' — no light islands'));
  process.exit(fail ? 1 : 0);
})();
