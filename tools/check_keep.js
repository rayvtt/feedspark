#!/usr/bin/env node
/*
 * tools/check_keep.js — THE PICK YOU MADE IS THE PICK YOU COME BACK TO, RENDERED.
 *
 * Ray, 14 Oct 2026: "after refreshing the page or tab, the pre-filter pre-selected option is not
 * saved … if I selected Monsoon on the playbook, after refreshing the page it returned to where
 * it was before. I want it to stay on Monsoon even after refresh. Apply this methodology across
 * everything else."
 *
 * Two halves, both driven in Chromium because a reload is the whole point and a source read
 * cannot reload anything:
 *
 *   1. THE SHARED LAYER (docs/keep_widget.html) on a synthetic module page served over http,
 *      shaped like the real ones: a brand <select> that fills from a fetch AFTER the widget has
 *      run, market chips (button[data-mkt]) drawn when a brand loads, a period group
 *      (button[data-win]), a select inside a modal that must never be remembered. A person picks
 *      brand · market · period; the page reloads; every pick is back AND the page's own handlers
 *      ran (the replay dispatches the control's change / click, it never pokes state). Then: a
 *      ?brand= link wins over the memory, a market remembered under one brand is never replayed
 *      under another, a brand that left the roster is simply not applied, and a replay never
 *      records itself (untrusted events).
 *
 *   2. THE WORKFLOW PAGE ITSELF under file:// with its fetches stubbed (the check_playbook_mine
 *      recipe): the Playbook account picker and the board's client filter / window survive a
 *      reload — the ask verbatim.
 *
 * Run: node tools/check_keep.js        (PW_CHROMIUM overrides the browser path)
 */
const path = require('path');
const http = require('http');
const { readFileSync } = require('fs');
const { chromium } = require('playwright');

const REPO = path.join(__dirname, '..');
const WIDGET = readFileSync(path.join(REPO, 'docs', 'keep_widget.html'), 'utf8');
const WF = 'file://' + path.join(REPO, 'docs', 'FeedSpark_Workflow.html');
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };

/* a module page as the FCC builds them: the roster lands from a fetch, the market chips are
   rendered per brand, the widget sits at the end of the body as the worker injects it */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Keep check</title></head><body>
<div class="hero"><select id="brand" aria-label="Brand"></select>
<div class="chips" id="mkts"></div>
<span class="seg" id="win"><button type="button" data-win="7" class="on">7d</button><button type="button" data-win="30">30d</button><button type="button" data-win="90">90d</button></span>
<select id="sortby"><option value="rev">Revenue</option><option value="spend">Spend</option></select>
<div class="scrim"><div class="modal" role="dialog"><select id="bg-client"><option value="">—</option><option value="Reiss">Reiss</option><option value="Monsoon">Monsoon</option></select></div></div>
<pre id="log"></pre></div>
<script>
var S={brand:'',mkt:'',win:'7',loads:0};
var MK={Reiss:['gb','de','us'],Monsoon:['gb'],Schuh:['gb','de','ie']};
function log(s){document.getElementById('log').textContent+=s+'\\n';}
function drawMkts(){var b=S.brand,h=document.getElementById('mkts');h.innerHTML=(MK[b]||[]).map(function(m){return '<button type="button" class="chip'+(m===S.mkt?' on':'')+'" data-mkt="'+m+'">'+m.toUpperCase()+'</button>';}).join('');}
function loadBrand(b){S.brand=b;S.loads++;S.mkt=(MK[b]||[])[0]||'';log('load:'+b);drawMkts();}
document.getElementById('mkts').addEventListener('click',function(e){var t=e.target.closest('[data-mkt]');if(!t)return;S.mkt=t.getAttribute('data-mkt');log('mkt:'+S.mkt);drawMkts();});
document.getElementById('win').addEventListener('click',function(e){var t=e.target.closest('[data-win]');if(!t)return;S.win=t.getAttribute('data-win');log('win:'+S.win);Array.prototype.forEach.call(this.querySelectorAll('button'),function(b){b.classList.toggle('on',b===t);});});
var sel=document.getElementById('brand');
sel.addEventListener('change',function(){loadBrand(sel.value);});
var q=new URLSearchParams(location.search);
fetch('/api/roster').then(function(r){return r.json();}).then(function(d){
  sel.innerHTML=d.map(function(b){return '<option value="'+b+'">'+b+'</option>';}).join('');
  var want=q.get('brand');if(want&&d.indexOf(want)>=0)sel.value=want;
  loadBrand(sel.value);
  if(want)history.replaceState(null,'',location.pathname);   // as ROAS / Workflow do
});
</script>
${WIDGET}
</body></html>`;

let roster = ['Monsoon', 'Reiss', 'Schuh'];
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/roster') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(roster)); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
});


/* Playwright's selectOption dispatches an UNTRUSTED change — exactly the event the layer must
   ignore (a page setting its own default). A person's pick is trusted, so the harness picks the
   way a person does: focus the select and step through it with the keyboard. */
async function pickSel(p, sel, value) {
  await p.focus(sel);
  for (let i = 0; i < 40; i++) {
    if ((await p.$eval(sel, (e) => e.value)) === value) return true;
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(30);
  }
  return false;
}

const state = (p) => p.evaluate(() => ({ brand: document.getElementById('brand').value, mkt: window.S.mkt, win: window.S.win,
  loads: window.S.loads, on: (document.querySelector('#mkts .on') || {}).getAttribute ? document.querySelector('#mkts .on').getAttribute('data-mkt') : null,
  winOn: document.querySelector('#win .on').getAttribute('data-win'), log: document.getElementById('log').textContent,
  kept: localStorage.getItem('fcc-keep:/roas') }));

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  console.log('\n── the shared layer on a module-shaped page');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(base + '/roas'); await p.waitForTimeout(400);
    let a = await state(p);
    ok('a fresh device opens on the page’s own default — ' + a.brand, a.brand === 'Monsoon' && a.kept === null);
    await pickSel(p, '#brand', 'Reiss'); await p.waitForTimeout(100);
    await p.click('#mkts [data-mkt="de"]'); await p.click('#win [data-win="90"]');
    await pickSel(p, '#sortby', 'spend');
    await pickSel(p, '#bg-client', 'Monsoon');   // inside a modal: an input, not a view
    await p.waitForTimeout(150);
    a = await state(p);
    ok('a hand pick is written to the device', a.kept && /"sel:brand"/.test(a.kept) && /"chip:mkt:mkts"/.test(a.kept) && /"chip:win:win"/.test(a.kept) && /"sel:sortby"/.test(a.kept));
    ok('…with the market tied to the brand it was picked under', /"b":"Reiss"/.test(a.kept));
    ok('…and the modal’s select is NOT', !/bg-client/.test(a.kept));

    await p.reload(); await p.waitForTimeout(700);
    a = await state(p);
    ok('after a reload the brand is back — ' + a.brand, a.brand === 'Reiss');
    ok('the page’s OWN handler loaded it (log carries load:Reiss after the default)', /load:Monsoon\nload:Reiss/.test(a.log));
    ok('the market is back on the chip and in the page’s state', a.mkt === 'de' && a.on === 'de');
    ok('the period is back', a.win === '90' && a.winOn === '90');
    ok('the sort select is back', (await p.$eval('#sortby', (e) => e.value)) === 'spend');
    ok('the modal’s select opened blank', (await p.$eval('#bg-client', (e) => e.value)) === '');
    const keptBefore = a.kept;
    await p.waitForTimeout(300);
    ok('the replay recorded nothing of its own (untrusted events)', (await state(p)).kept === keptBefore);

    await p.goto(base + '/roas?brand=Schuh'); await p.waitForTimeout(700);
    a = await state(p);
    ok('a link naming a brand wins over the memory — ' + a.brand, a.brand === 'Schuh');
    ok('…and nothing is replayed over it (Schuh loaded once, no Reiss)', a.loads === 1 && !/load:Reiss/.test(a.log));
    ok('…even though the page stripped its query before the widget ran', await p.evaluate(() => location.search === ''));
    await p.click('#mkts [data-mkt="ie"]'); await p.waitForTimeout(100);
    ok('a pick made on a linked page is still recorded', /"v":"ie"/.test((await state(p)).kept));

    await p.goto(base + '/roas'); await p.waitForTimeout(700);
    a = await state(p);
    ok('the next plain open lands on the last pick (Schuh IE), not the older one', a.brand === 'Schuh' && a.mkt === 'ie');

    await p.goto(base + '/roas?view=procurement'); await p.waitForTimeout(700);
    ok('a query that names no brand does not block the replay', (await state(p)).brand === 'Schuh');

    roster = ['Monsoon', 'Reiss'];   // Schuh left the roster
    await p.goto(base + '/roas'); await p.waitForTimeout(700);
    a = await state(p);
    ok('a remembered brand the roster no longer offers is not forced — ' + a.brand, a.brand === 'Monsoon' && a.loads === 1);
    ok('…and its market is not replayed under another brand', a.mkt === 'gb' && !/mkt:ie/.test(a.log));
    roster = ['Monsoon', 'Reiss', 'Schuh'];
    await ctx.close();
  }

  console.log('\n── the Workflow page: the Playbook account and the board filter survive a refresh');
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.addInitScript(() => {
      const j = (o) => Promise.resolve({ ok: true, status: 200, headers: { get: () => '0' }, json: () => Promise.resolve(o), text: () => Promise.resolve('{}') });
      window.fetch = function (u) {
        u = String(u);
        if (u.indexOf('/api/access?me=1') >= 0) return j({ ok: true, owner: true, email: 'ray@feedspark.com', name: 'Ray', ownerName: 'Ray' });
        if (u.indexOf('/api/volume/arrivals') >= 0) return j({ ok: true, feeds: [] });   // a list, as the route answers
        if (u.indexOf('/api/golden/estate') >= 0) return j({ ok: true, feeds: {} });
        return j({ ok: true, briefs: {}, map: {}, items: [], calls: [], clients: {} });
      };
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => ok('no page error: ' + e.message, false));
    const open = async () => { await p.goto(WF); await p.waitForTimeout(2600);
      await p.evaluate(() => { const r = document.getElementById('ck-r'); if (r) r.hidden = false; }); await p.waitForTimeout(600); };
    await open();
    const brands = await p.$$eval('#ck-brand option', (os) => os.map((o) => o.value));
    ok('the Playbook picker carries the baked accounts (' + brands.length + ')', brands.length >= 2);
    const first = await p.$eval('#ck-brand', (s) => s.value);
    const onBoard = await p.$$eval('#it-client-menu label', (ls) => ls.map((l) => l.textContent.replace('✕', '').trim()));
    const pick = brands.find((b) => b !== first && onBoard.indexOf(b) >= 0);
    ok('an account the board carries is available to pick (' + pick + ')', !!pick);
    await pickSel(p, '#ck-brand', pick); await p.waitForTimeout(500);
    const chips = await p.$$eval('#it-client-chips .it-fchip', (c) => c.map((x) => x.textContent.replace('×', '').trim()));
    ok('picking ' + pick + ' in the Playbook filters the board to it (the link that already existed)', chips.length === 1 && chips[0] === pick);
    await p.evaluate(() => { const w = document.getElementById('it-window'); w.value = ''; w.dispatchEvent(new Event('change')); }); await p.waitForTimeout(200);
    ok('the picks are on the device', await p.evaluate(() => localStorage.getItem('fcc-ck-brand') && /"clients":\[/.test(localStorage.getItem('fcc-it-state') || '')));

    await open();
    ok('after a refresh the Playbook is still on ' + pick, (await p.$eval('#ck-brand', (s) => s.value)) === pick);
    const chips2 = await p.$$eval('#it-client-chips .it-fchip', (c) => c.map((x) => x.textContent.replace('×', '').trim()));
    ok('…and the board is still filtered to it', chips2.length === 1 && chips2[0] === pick);
    ok('…and the window a person set is still set', (await p.$eval('#it-window', (s) => s.value)) === '');

    await p.goto(WF.replace(/$/, '?client=' + encodeURIComponent(first))); await p.waitForTimeout(3200);
    const chips3 = await p.$$eval('#it-client-chips .it-fchip', (c) => c.map((x) => x.textContent.replace('×', '').trim()));
    ok('a ?client= deep link from the dossier still wins over the memory', chips3.length === 1 && chips3[0] === first);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log(`\ncheck_keep: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
