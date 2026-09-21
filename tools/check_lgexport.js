#!/usr/bin/env node
/* Label Guard — ⬇ HTML · all markets (Ray, 21 Sep 2026: "Is there a way to get data shown for
   clients with multi-market such as Schuh, Superdry, or Reiss? A downloaded CSV or HTML would be
   fine, but not too techy. I like the current filter section view … HTML would be best because
   it can be interactive").

   Drives the REAL /labels page against a stubbed four-market brand (three scanned, one never),
   clicks ⬇ HTML · all markets, then OPENS THE DOWNLOADED FILE in a second page and uses it the
   way a client would: every market in the overview, the never-scanned one saying so, the tabs
   switching the dissection, the 🔍 filter narrowing every pane AND the cross-market matrix, a
   header sort flipping, show-all lifting the cap, both CSVs downloading with the page's own
   columns — and nothing of the FCC in the file.

   Run: NODE_PATH=$(npm root -g) node tools/check_lgexport.js   (presync) */
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_LabelGuard.html');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const NOW = Date.now(), DAY = 86400000;
const vals = (prefix, n, base) => Array.from({ length: n }, (_, i) => [prefix + ' ' + (i + 1), base - i * 37]);
const lbl = (values, cov) => ({ present: true, filled: values.reduce((a, p) => a + p[1], 0), cov: cov, distinct: values.length, truncated: false, values });
const snap = (mkt, rows, o) => ({ v: 1, t: NOW - 3600000, client: 'Schuh', market: mkt, rows, labels: {
  custom_label_0: lbl([['FULL', Math.round(rows * 0.6)], ['SALE', Math.round(rows * 0.4)]], 100),
  custom_label_1: lbl(vals('Zombie', 5, 1300), 16.4),
  custom_label_2: lbl(vals(o.cl2 || 'Hoodies', 15, 4000), 99.9),
  custom_label_3: o.noCl3 ? { present: false } : lbl([['New In', 3000], ['Festival', 1500]], 26.4),
  custom_label_4: lbl([['Medium', 18000], ['High', 7000], ['Low', 600]], 99.9),
}, labelPop: o.pop ? { pct: { '1': 0, '2': 0.1, '3': 61.7, '4': 33.8, '5': 4.5 }, avg: 3.4, skus: rows, zero: 0, max: 5 } : undefined });
const GB = snap('gb', 26438, { pop: true, noCl3: true });
const GB_BASE = JSON.parse(JSON.stringify(GB)); GB_BASE.t = NOW - DAY; GB_BASE.rows = 26626;
GB_BASE.labels.custom_label_0.values = [['FULL', 15544], ['SALE', 11082], ['CLEARANCE', 40]];   // CLEARANCE is GONE now
const DE = snap('de', 12000, { cl2: 'Kapuzen' });
const DE_DAY = JSON.parse(JSON.stringify(DE)); DE_DAY.t = NOW - DAY;   // DE has yesterday's capture → its Δ reads vs yesterday
const FB = snap('gb-fb', 9000, { cl2: 'Meta hoodies', pop: true });
const idx = (client, mkt, extra) => Object.assign({ client, mkt, t: NOW - 3600000, rows: 26438, cov: { custom_label_0: 100, custom_label_1: 16.4, custom_label_2: 99.9, custom_label_3: 26.4, custom_label_4: 99.9 }, present: 5, nCrit: 0, nWarn: 0, status: 'ok', baseT: NOW - DAY }, extra || {});
const FEEDS = {
  'Schuh|gb': idx('Schuh', 'gb', { nWarn: 1, status: 'warn' }),
  'Schuh|de': idx('Schuh', 'de', { rows: 12000 }),
  'Schuh|gb-fb': idx('Schuh', 'gb-fb', { rows: 9000 }),
  'Schuh|ie': { client: 'Schuh', mkt: 'ie', t: 0, rows: 0, cov: {}, present: 0, nCrit: 0, nWarn: 0, status: 'never' },
  'Reiss|gb': idx('Reiss', 'gb'),
};
const ALERTS = { 'Schuh|gb': { client: 'Schuh', mkt: 'gb', t: NOW - 3600000, alerts: [{ sev: 'warn', code: 'value-drop', label: 'custom_label_1', value: 'Zombie 1', msg: 'CL1 “Zombie 1” dropped 12% (1,386 → 1,215 SKUs)' }] } };
const INIT = 'window.__D=' + JSON.stringify({ feeds: FEEDS, alerts: ALERTS, snaps: { gb: { snapshot: GB, baseline: GB_BASE, daily: null }, de: { snapshot: DE, baseline: DE_DAY, daily: DE_DAY }, 'gb-fb': { snapshot: FB, baseline: FB, daily: null } } }) + ';' +
  "window.fetch=function(url){var u=String(url),D=window.__D;var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};" +
  "if(u.indexOf('/estate')>=0)return j({feeds:D.feeds,alerts:D.alerts});" +
  "if(u.indexOf('/snapshot')>=0){var m=decodeURIComponent((u.match(/market=([^&]+)/)||[])[1]||'');window.__snapCalls=(window.__snapCalls||[]).concat([m]);return j(D.snaps[m]||{snapshot:null,baseline:null,daily:null})}" +
  "if(u.indexOf('/api/labels/alerts')>=0)return j({ok:true,crit:0,warn:1,pt:{crit:0,warn:0},gr:{crit:0,warn:0},clients:{}});" +
  "if(u.indexOf('/askdraft')>=0)return j({cfg:{to:{}},asked:{}});return j({});};";

async function saveDownload(dl, name) {
  const tmp = path.join(os.tmpdir(), name + '-' + Date.now() + path.extname(dl.suggestedFilename()));
  await dl.saveAs(tmp);
  return tmp;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await ctx.addInitScript({ content: INIT });
  await page.goto(PAGE);
  await page.waitForTimeout(1200);

  // ---- the page: two doors to one export
  ok('every brand card carries ⬇ HTML in its header', await page.evaluate(() => document.querySelectorAll('.est-hd .est-dl').length === 2 && !!document.querySelector('.est-dl[data-dl="Schuh"]')));
  await page.evaluate(() => document.querySelector('.est-mkt[data-k="Schuh|gb"]').click());
  await page.waitForTimeout(700);
  ok('the dissection header carries ⬇ HTML · all markets beside ⤓ CSV', await page.evaluate(() => { const b = document.getElementById('det-html'); return !!b && /all markets/.test(b.textContent) && !!document.getElementById('det-csv'); }));
  await page.evaluate(() => { window.__snapCalls = []; });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#det-html')]);
  const file = await saveDownload(dl, 'lgexport');
  ok('the download is one HTML file named for the brand and every market', /labelguard_Schuh_all-markets_\d{4}-\d{2}-\d{2}\.html$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const calls = await page.evaluate(() => window.__snapCalls);
  ok('it fetched only the scanned markets the page did not already hold (de, gb-fb) — never the unscanned one, never GB twice', calls.slice().sort().join(',') === 'de,gb-fb', calls);
  ok('the button is back to its label afterwards', await page.evaluate(() => { const b = document.getElementById('det-html'); return !b.disabled && /all markets/.test(b.textContent); }));
  const html = fs.readFileSync(file, 'utf8');
  ok('nothing of the FCC in the file — no module nav, no injected layers, no editor, no fetch, no Claude',
    !/tb-modules|fcc-|de-bar|de-handle|tky-|instr-tgl|fetch\(/.test(html) && !/Claude/.test(html), (html.match(/.{30}(tb-modules|fcc-|de-bar|Claude).{30}/g) || []).slice(0, 3));
  ok('the file speaks CL0–CL4, never the raw attribute keys', !/custom_label/.test(html));
  ok('the file carries the FeedSpark confidentiality footer', /Private &amp; Confidential/.test(html));

  // ---- the file, used as a client would
  const doc = await ctx.newPage();
  const derr = []; doc.on('pageerror', (e) => derr.push(e.message));
  await doc.goto('file://' + file);
  await doc.waitForTimeout(500);
  const t = (sel) => doc.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
  ok('the header names the brand, four markets, three scanned, and which reference Δ reads', (await t('h1')) === 'Schuh' && /4 markets · 3 scanned · Δ = change in SKUs vs yesterday/.test(await t('.hd .sub')), await t('.hd .sub'));
  // markets in the estate's own order: Google feeds A→Z (DE, GB, IE), then the Facebook catalogue
  const ov = await doc.evaluate(() => Array.from(document.querySelectorAll('#ov tbody tr')).map((r) => Array.from(r.cells).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' ')));
  ok('the overview lists every market — coverage per label side by side, the never-scanned one saying so',
    ov.length === 4 && /^GDE 12,000 100% 16.4% 99.9% 26.4% 99.9% —/.test(ov[0]) && /^GGB 26,438 100% 16.4% 99.9% — 99.9% 3.4/.test(ov[1]) && /^GIE not scanned yet$/.test(ov[2]) && /^fGB 9,000/.test(ov[3]), ov);
  ok('the GB row carries its flag, the clean ones a tick', /1 warn$/.test(ov[1]) && /✓$/.test(ov[0]) && /✓$/.test(ov[3]), ov);
  const tabs = await doc.evaluate(() => Array.from(document.querySelectorAll('#tabs .chip')).map((c) => [c.textContent.trim(), c.classList.contains('on'), c.disabled]));
  ok('one tab per market in the estate’s order, the first scanned one open, the never-scanned market present but not clickable',
    tabs.length === 4 && tabs[0][0] === 'GDE' && tabs[0][1] === true && tabs[2][0] === 'GIE' && tabs[2][2] === true && tabs[3][0] === 'fGB', tabs);
  ok('DE reads its Δ against yesterday’s capture', /Schuh · DE/.test(await t('#mk h2')) && /Δ vs yesterday/.test(await t('#mk .st')) && /12,000 SKUs/.test(await t('#mk .st')), await t('#mk .st'));
  ok('DE has no per-SKU population read and the file says so instead of drawing an empty table', /not profiled/.test(await t('#mk .pop')));
  // open GB
  await doc.evaluate(() => document.querySelector('#tabs [data-tab="1"]').click());
  await doc.waitForTimeout(150);
  ok('the GB tab opens GB — brand · market, SKUs, scanned, Δ vs last known-good (no capture from yesterday on this one) dated', /Schuh · GB/.test(await t('#mk h2')) && /26,438 SKUs/.test(await t('#mk .st')) && /Δ vs last known-good/.test(await t('#mk .st')), await t('#mk .st'));
  ok('the overview row follows the open tab', await doc.evaluate(() => document.querySelector('#ov tr.cur').textContent.indexOf('GB') >= 0));
  ok('the market’s live alert is in the file', /Zombie 1.*dropped 12%/.test(await t('#mk .al')), await t('#mk .al'));
  const pop = await doc.evaluate(() => Array.from(document.querySelectorAll('#mk .pop .pr')).map((r) => [r.querySelector('.pl').textContent.trim(), r.querySelector('.pv').textContent.trim(), r.querySelector('.pb i').style.width]));
  ok('the label population card draws one row per bucket with the share as a bar of that width', pop.length === 5 && pop[2][0] === '3 labels' && pop[2][1] === '61.7%' && pop[2][2] === '61.7%', pop);
  const panes = await doc.evaluate(() => Array.from(document.querySelectorAll('#mk .lc')).map((c) => [c.classList.contains('absent'), (c.querySelector('.nm') || {}).textContent, c.querySelectorAll('tbody tr').length, !!c.querySelector('.more')]));
  ok('five panes — CL3 honestly absent, CL2 capped at 12 with show-all', panes.length === 5 && panes[3][0] === true && panes[2][2] === 12 && panes[2][3] === true && panes[0][2] === 3, panes);
  ok('a value on the reference that is gone from the live feed is listed struck through as GONE', await doc.evaluate(() => { const r = document.querySelector('#mk .lc tr.gone'); return !!r && /CLEARANCE/.test(r.textContent) && /GONE/.test(r.textContent) && getComputedStyle(r.querySelector('td.v')).textDecorationLine.indexOf('line-through') >= 0; }));
  ok('Δ reads the SKU change against the reference — FULL 15,544 → 15,863 shows +319', await doc.evaluate(() => { const r = Array.from(document.querySelectorAll('#mk .lc tr')).find((x) => /^FULL/.test(x.textContent)); return !!r && /\+319/.test(r.textContent); }));
  // show all
  await doc.evaluate(() => document.querySelector('#mk .lc [data-more]').click());
  await doc.waitForTimeout(150);
  ok('show all lifts the cap for that pane', await doc.evaluate(() => document.querySelectorAll('#mk .lc')[2].querySelectorAll('tbody tr').length === 15));
  // sort
  await doc.evaluate(() => document.querySelector('#mk .lc th.s[data-s="v"]').click());
  await doc.waitForTimeout(150);
  ok('a header click sorts the pane (value A→Z — CLEARANCE, FULL, SALE) and marks the header', await doc.evaluate(() => { const c = document.querySelector('#mk .lc'); const rows = Array.from(c.querySelectorAll('tbody tr')).map((r) => r.querySelector('td.v').textContent); return /value ▲/.test(c.querySelector('th.s[data-s="v"]').textContent) && rows.join(',') === 'CLEARANCE,FULL,SALE'; }));
  await doc.evaluate(() => document.querySelector('#mk .lc th.s[data-s="v"]').click());
  await doc.waitForTimeout(150);
  ok('a second click flips it (Z→A)', await doc.evaluate(() => Array.from(document.querySelector('#mk .lc').querySelectorAll('tbody tr')).map((r) => r.querySelector('td.v').textContent).join(',') === 'SALE,FULL,CLEARANCE'));
  // compare matrix
  const cmpHead = await doc.evaluate(() => Array.from(document.querySelectorAll('#cmp thead th')).map((h) => h.textContent.trim()));
  ok('values across markets — one column per scanned market plus the total', cmpHead.join('|') === 'Value|GDE|GGB|fGB|Total', cmpHead);
  const cmpRow = await doc.evaluate(() => Array.from(document.querySelector('#cmp tbody tr').cells).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  ok('the matrix leads with the biggest CL0 value across markets — SKUs and share PER MARKET, GB and GB-FB told apart although they share a code',
    cmpRow === 'FULL | 7,200 60% | 15,863 60% | 5,400 60% | 28,463', cmpRow);
  await doc.evaluate(() => document.querySelector('#cmp [data-cmp="2"]').click());
  await doc.waitForTimeout(150);
  ok('picking CL2 shows values that exist in some markets and not others — a dash where a market lacks the value',
    await doc.evaluate(() => { const r = Array.from(document.querySelectorAll('#cmp tbody tr')).find((x) => /^Kapuzen 1/.test(x.textContent)); return !!r && (r.textContent.match(/—/g) || []).length === 2; }));
  // filter narrows every pane AND the matrix
  await doc.fill('#q', 'zombie 3');
  await doc.waitForTimeout(300);
  const filt = await doc.evaluate(() => ({ cmp: document.querySelectorAll('#cmp tbody tr').length, cmpTxt: document.querySelector('#cmp tbody').textContent, cl1: document.querySelectorAll('#mk .lc')[1].querySelectorAll('tbody tr').length, cl0: document.querySelectorAll('#mk .lc')[0].querySelector('tbody').textContent }));
  ok('the 🔍 filter narrows every pane at once and the matrix with it', filt.cl1 === 1 && /no values match/.test(filt.cl0) && /no values match/.test(filt.cmpTxt), filt);
  await doc.fill('#q', '');
  await doc.waitForTimeout(300);
  // tabs switch the market — back to DE, a different feed with its own values
  await doc.evaluate(() => document.querySelector('#tabs [data-tab="0"]').click());
  await doc.waitForTimeout(150);
  ok('the DE tab opens DE again — its own values, its own reference', /Schuh · DE/.test(await t('#mk h2')) && /Kapuzen 1/.test(await t('#mk')) && !/Zombie 1.*dropped/.test(await t('#mk')), await t('#mk h2'));
  ok('the overview row follows the open tab', await doc.evaluate(() => document.querySelector('#ov tr.cur').textContent.indexOf('DE') >= 0));
  // CSVs inside the file
  const [c1] = await Promise.all([doc.waitForEvent('download'), doc.click('#csv1')]);
  const c1f = await saveDownload(c1, 'lgcsv1');
  const c1t = fs.readFileSync(c1f, 'utf8').split('\n');
  ok('⤓ CSV · this market — the page’s own columns plus market + channel, DE only, reference named', c1t[0] === 'market,channel,label,value,skus,share_pct,reference,reference_skus,delta' && c1t.slice(1).every((l) => /^DE,google,/.test(l)) && /^DE,google,CL0,"FULL",7200,60,yesterday,7200,0$/.test(c1t[1]) && c1t.length > 20, [c1t[0], c1t[1], c1t.length]);
  const [c0] = await Promise.all([doc.waitForEvent('download'), doc.click('#csv0')]);
  const c0f = await saveDownload(c0, 'lgcsv0');
  const c0t = fs.readFileSync(c0f, 'utf8').split('\n');
  ok('⤓ CSV · all markets — every scanned market, the GONE value carried with its reference count', c0t.some((l) => /^GB,google,CL0,"CLEARANCE",0,0,last known-good,40,-40$/.test(l)) && c0t.some((l) => /^GB,facebook,/.test(l)) && c0t.some((l) => /^DE,google,/.test(l)), c0t.filter((l) => /CLEARANCE/.test(l)));
  ok('no errors in the file', derr.length === 0, derr);

  // ---- the brand-card door: same file, and the click never folds the card
  await page.bringToFront();
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('.est-dl[data-dl="Schuh"]')]);
  ok('⬇ HTML on the brand card downloads the same file without folding the card', /labelguard_Schuh_all-markets/.test(dl2.suggestedFilename()) && await page.evaluate(() => !document.querySelector('.est-card[data-client="Schuh"]').classList.contains('collapsed')));
  ok('no page errors', errs.length === 0, errs);
  if (process.env.LGX_KEEP) console.log('   · export kept at ' + file); else [file, c1f, c0f].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
  await browser.close();
  if (fail) { console.log('\n✗ Label Guard HTML export: ' + fail + ' check(s) failed'); process.exit(1); }
  console.log('   ✓ Label Guard ⬇ HTML · all markets: one file, every market, filter/sort/show-all/tabs live, CSV inside, nothing of the FCC');
})().catch((e) => { console.error(e); process.exit(1); });
