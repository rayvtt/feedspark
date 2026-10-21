#!/usr/bin/env node
/*
 * Workflow Playbook — the Spend Lens section on the real rail
 * (Ray, 19 Oct 2026, sending the Field Breakdown pivot for Reiss UK: "can you bring in Playbook -
 * a few interesting RoAS improvement or spend optiimser tactics from field breakdown ? … you can
 * see on RoAS avg: Textured, Striped, Checked, Colourblock has way better ROAS compared to Plain
 * where most Spend is at").
 *
 * What only the rendered rail can prove: the findings are drawn with the route's own evidence;
 * a market's unread cuts are NAMED beside it rather than reading as a market with nothing wrong;
 * ⚡ POSTs that market and re-reads; → Brief fills the page's own composer with the finding's own
 * words; and the section points at /breakdown for the fields FeedHero does not cut.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_spendlens.js   (skips cleanly without Playwright)
 */
const path = require('path');
const { installEngineRoutes } = require('./engine_routes.js');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };

// the route's own shape, invented brand and invented figures — the SHAPE of Ray's screenshot
const F = (k, market, agg, head, ev, extra) => Object.assign({ k, market, agg, cur: '£', worth: 1000, head, ev, vals: [], blended: 1571,
  brief: { cat: k === 'unlisted' ? 'technical' : 'account', task: 'Spend Lens - ' + k + ' - Northwind ' + market.toUpperCase(), scope: 'What the read says: ' + ev } }, extra || {});
const LENS = { ok: true, client: 'Northwind', on: true, win: 'w30', mcp: true,
  cuts: [{ k: 'Category', n: 'product category' }, { k: 'Brand', n: 'brand' }, { k: 'Colour', n: 'colour' }, { k: 'Gender', n: 'gender' },
    { k: 'Age_group', n: 'age group' }, { k: 'Price_type', n: 'full price or sale' }, { k: 'Product_age', n: 'how new the product is' }, { k: 'Custom_label_0', n: 'custom label 0' }],
  markets: [{ market: 'gb', spend: 26630, cur: '£' }, { market: 'de', spend: 4100, cur: '€' }],
  quiet: ['ie'], rest: ['fr', 'nl'],
  top: [
    F('laggard', 'gb', 'Colour', '86% of the colour spend sits on Plain, which returns less than the rest',
      'Plain 1,542% on £22,894 of £26,630 — the rest of the field returns 1,751% on £3,736 (the field as a whole 1,571%)'),
    F('starved', 'gb', 'Colour', 'Textured, Quilted, Colourblock return more than colour does as a whole',
      'Textured 1,642% on £664 · Quilted 2,977% on £509 · Colourblock 3,342% on £198 — against 1,571% across £26,630',
      { swing: { mv: 2289, cur: '£', from: 35300, to: 76500, fromV: 'Plain', toV: 'Colourblock' } }),
    F('unlisted', 'gb', null, '£30,147 is being spent on products this feed no longer carries',
      '£30,147 of £56,777 (53%) went to SKUs Google Ads is still serving and the market’s feed does not hold'),
  ],
  also: [F('laggard', 'gb', 'Brand', 'A brand carries most of the spend and returns least', 'invented evidence')],
  toRead: [{ market: 'gb', agg: 'Gender' }, { market: 'gb', agg: 'Age_group' }, { market: 'de', agg: 'Category' }],
  refused: [{ market: 'gb', agg: 'Price_type', why: 'FeedHero has not set this cut up for gb' }] };
const PLAYBOOK = { ok: true, owner: true, scoped: false, brands: { Northwind: { tasks: [{ t: 'Keywords Optimisation - Oct', o: 'Ray', b: 'In progress', d: '01/11/2026' }], updated: Date.now() } }, generated: Date.now() };

const INIT = "window.__posts=[];window.__slhits=0;(function(){var real=window.fetch;window.fetch=function(u,o){u=String(u);"
  + "var j=function(x){return Promise.resolve(new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(/engine\\.js/.test(u))return real(u,o);"
  + "if(u.indexOf('/api/spendlens')>=0&&o&&o.method==='POST'){window.__posts.push(u);return j({ok:true,read:6});}"
  + "if(u.indexOf('/api/spendlens')>=0){window.__slhits++;return j(" + JSON.stringify(LENS) + ");}"
  + "if(u.indexOf('/api/testlab')>=0)return j({ok:true,client:'Northwind',top:[],rest:[],counts:{},book:[],cold:[],comp:{on:false,markets:{},meta:{}}});"
  + "if(u.indexOf('/api/playbook')>=0)return j(" + JSON.stringify(PLAYBOOK) + ");"
  + "if(u.indexOf('/api/golden/estate')>=0)return j({ok:true,feeds:{}});"
  + "if(u.indexOf('/api/volume/arrivals')>=0)return j({ok:true,feeds:[]});"
  + "if(u.indexOf('/api/access')>=0)return j({ok:1,modules:null,clients:null});"
  + "if(u.indexOf('/api/briefs')>=0)return j({});"
  + "if(u.indexOf('/api/state')>=0)return j({});"
  + "if(u.indexOf('/api/hours')>=0)return j({ok:true,clients:{}});"
  + "return j({});};})();"
  + "try{localStorage.setItem('fcc-ck-r','1');localStorage.setItem('fcc-ck-brand','Northwind');}catch(e){}";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await installEngineRoutes(ctx);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await ctx.addInitScript({ content: INIT });
  await page.goto('file://' + path.join(D, 'FeedSpark_Workflow.html') + '?pb=1');
  await page.waitForTimeout(2600);
  await page.selectOption('#ck-brand', 'Northwind'); await page.waitForTimeout(1200);

  const read = () => page.$eval('#ck-sl', (n) => ({
    head: n.querySelector('h4').textContent.trim(),
    rows: [...n.querySelectorAll('.ck-row')].map((r) => r.querySelector('.nm').textContent.trim()),
    pills: [...n.querySelectorAll('.ck-row .ck-pill')].map((p) => p.textContent.trim()),
    evs: [...n.querySelectorAll('.ck-ev')].map((e) => e.textContent.trim()),
    says: [...n.querySelectorAll('.ck-say')].map((e) => e.textContent.trim()),
    briefs: n.querySelectorAll('[data-sl]').length,
    roasLinks: [...n.querySelectorAll('a[href*="/roas?"]')].map((a) => a.getAttribute('href')),
    newTab: [...n.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('target') + '|' + a.getAttribute('rel')),
    mkts: [...n.querySelectorAll('.ck-cwm')].map((m) => m.textContent.replace(/\s+/g, ' ').trim()),
    reads: n.querySelectorAll('[data-slr]').length,
    bd: (n.querySelector('a[href*="/breakdown"]') || {}).getAttribute ? n.querySelector('a[href*="/breakdown"]').getAttribute('href') : null,
    more: (n.querySelector('#ck-sl-more') || { textContent: '' }).textContent.trim(),
    list: n.querySelectorAll('.ck-tlmore li').length,
  })).catch((e) => ({ err: String(e) }));

  console.log('\n1) the section is on the rail, drawn from the route');
  ok('no page error', errs.length === 0, errs.slice(0, 3));
  const s = await read();
  ok('the section renders, headed with the count', !s.err && /Where the spend sits/.test(s.head) && /3 findings · 1 more/.test(s.head), s.head || s.err);
  ok('one row per finding, in the route’s own words', s.rows.length === 3
    && /86% of the colour spend sits on Plain/.test(s.rows[0]), s.rows);
  ok('each names the market it is about', s.pills.join() === 'GB,GB,GB', s.pills);
  ok('the evidence is the route’s, verbatim — the figures are not re-derived here',
    /Plain 1,542% on £22,894/.test(s.evs[0]) && /the rest of the field returns 1,751%/.test(s.evs[0]), s.evs[0]);
  ok('the swing says what it is — arithmetic on two readings, not a forecast',
    s.says.length === 1 && /Moving a tenth of Plain’s spend \(£2,289\)/.test(s.says[0]) && /not a forecast/.test(s.says[0]), s.says);
  ok('one → Brief per finding', s.briefs === 3);
  ok('a finding on a cut opens that cut in the ROAS module',
    s.roasLinks.length === 2 && /brand=Northwind/.test(s.roasLinks[0])
    && /market=gb/.test(s.roasLinks[0]) && /seg=Colour/.test(s.roasLinks[0]), s.roasLinks);

  console.log('\n2) what has NOT been read is named — never read as an account with nothing wrong');
  ok('each market says how many of its cuts have been read',
    /GB\s*£26,630 spend · 6 of 8 cuts read/.test(s.mkts[0]), s.mkts[0]);
  ok('…and names the ones it has not', /not read: gender, age group/.test(s.mkts[0]), s.mkts[0]);
  ok('a market with only one cut read says so too', /DE\s*€4,100 spend · 7 of 8 cuts read/.test(s.mkts[1]), s.mkts[1]);
  ok('a cut FeedHero has not set up is an answer with its reason, not an error',
    s.mkts.some((m) => /full price or sale — FeedHero has not set this cut up/.test(m)), s.mkts);
  ok('the markets not read here are counted, never dropped',
    s.mkts.some((m) => /2 smaller markets not read here: FR, NL/.test(m)), s.mkts);
  ok('…and so are the ones that carried no spend',
    s.mkts.some((m) => /1 market carried no spend in the window/.test(m)), s.mkts);
  // a link out of the rail throws away the rail, the board's filters and the scroll position
  ok('every link out of the rail opens a new tab, as its \u2197 says',
    s.newTab.length >= 3 && s.newTab.every((t) => t === '_blank|noopener'), s.newTab);
  // the Breakdown reads `brand`, not `client` — a link on the wrong parameter lands on whatever
// feed that device last had open, which is somebody else's account
ok('the fields FeedHero does not cut are pointed at /breakdown, on its own parameters',
  /\/breakdown\?brand=Northwind&market=gb/.test(s.bd || ''), s.bd);

  console.log('\n3) ⚡ reads one market’s cuts, and the panel re-reads');
  const before = await page.evaluate(() => window.__slhits);
  await page.click('#ck-sl [data-slr="gb"]');
  await page.waitForTimeout(600);
  const posts = await page.evaluate(() => window.__posts);
  ok('the click POSTs that market and nothing else', posts.length === 1 && /market=gb/.test(posts[0]) && /client=Northwind/.test(posts[0]), posts);
  ok('…and the panel re-reads after it', (await page.evaluate(() => window.__slhits)) > before);

  console.log('\n4) → Brief goes through the page’s own composer');
  await page.evaluate(() => { window.__brief = null; const f = window.FCCBrief; window.FCCBrief = (p) => { window.__brief = p; }; window.__realBrief = f; });
  await page.click('#ck-sl [data-sl="0"]');
  await page.waitForTimeout(250);
  const br = await page.evaluate(() => window.__brief);
  ok('the composer is handed the finding’s own brief', br && /Spend Lens - laggard - Northwind GB/.test(br.task), br);
  ok('…carrying the evidence into the ticket', br && /Plain 1,542% on £22,894/.test(br.scope), br && br.scope);
  ok('…on the account, with the brand named', br && br.client === 'Northwind' && br.cat === 'account', br);

  console.log('\n5) the rest folds, and opens');
  await page.click('#ck-sl-more');
  await page.waitForTimeout(300);
  const s2 = await read();
  ok('the other cuts’ findings open behind one button', s2.list === 1 && /▾ Fewer/.test(s2.more), [s2.list, s2.more]);

  console.log('\n6) an account with no Google Ads report says so, rather than nothing');
  await page.evaluate(() => { const real = window.fetch; window.fetch = (u, o) => (String(u).indexOf('/api/spendlens') >= 0
    ? Promise.resolve(new Response(JSON.stringify({ ok: true, client: 'Harbour', on: false, why: 'not on the ROAS roster — no Google Ads report for this account', top: [], also: [], toRead: [], refused: [], markets: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    : real(u, o)); });
  await page.evaluate(() => { window.FCCBrief = window.__realBrief; });
  const off = await page.evaluate(async () => {
    const r = await fetch('/api/spendlens?client=Harbour'); const d = await r.json();
    return d.why;   // the route's own wording, which the section prints as its only line
  });
  ok('the refusal is a sentence, not an empty panel', /no Google Ads report/.test(off), off);

  console.log('\n7) the phone');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const fit = await page.evaluate(() => {
    const n = document.querySelector('#ck-sl'); if (!n) return null;
    const b = n.getBoundingClientRect();
    return { l: Math.round(b.left), r: Math.round(b.right), w: window.innerWidth, rows: n.querySelectorAll('.ck-row').length };
  });
  ok('the section is still there on a phone, inside the screen',
    fit && fit.rows === 3 && fit.l >= -1 && fit.r <= fit.w + 1, fit);

  await browser.close();
  console.log(fail ? '\nFAIL (' + fail + ')' : '\nPASS');
  process.exit(fail ? 1 : 0);
})();
