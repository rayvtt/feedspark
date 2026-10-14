#!/usr/bin/env node
/*
 * Workflow Playbook — the Test Lab section on the real page
 * (Ray, 14 Oct 2026: "the playbook and the workflow should be a bit smarter … more proactive
 * information about testing proposals, with specifics … 'How about we test A/B testing image
 * position this month?' because I have seen other brands achieve a certain uplift over the last
 * three months … consider competitors … on Google Shopping and Meta … super innovative in testing").
 *
 * What only the rendered rail can prove: the three proposals are drawn with the evidence, the line
 * to say and the design exactly as the route said them; a first-for-the-book wears its badge;
 * → Brief fills the page's own composer with the test brief (category Testing); the competitor
 * block lists the merchants, our own line, the pictures and the signals; ⚡ Read now POSTs the
 * market to /api/compwatch and re-reads; the rest folds behind "N more ideas".
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_testlab.js   (skips cleanly without Playwright)
 */
const path = require('path');
const { installEngineRoutes } = require('./engine_routes.js');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };

// a synthetic answer in the route's own shape — invented brands, invented figures
const P = (k, n, surf, first, ev) => ({ k, n, surf, field: 'g:' + k, hyp: 'Hypothesis for ' + n + '.', how: 'Split by item group; four weeks.', metric: 'CTR', src: 'Google — spec',
  title: 'How about we A/B test ' + n.toLowerCase() + ' this month?', ev, evKind: first ? 'first' : 'peer', first, peers: [], ready: { ok: true, why: '' }, status: 'ready', score: 50, ranAt: 0, briefedAs: null,
  say: 'Harbour saw +12.4% ctr on ' + n.toLowerCase() + ' in Aug 2026. We would split the catalogue by item group.',
  brief: { cat: 'test', task: 'A/B Test - ' + n + ' - Northwind - 1026', scope: 'Test: ' + n + '\nEvidence: a Fashion account saw +12.4% ctr.' } });
const TLD = { ok: true, client: 'Northwind', industry: 'Fashion',
  top: [P('img_lifestyle', 'Lifestyle main image', 'google', false, 'Harbour GB +12.4% ctr (Aug 2026) · 2 wins across the book in 3 months'),
    P('ovl_price_meta', 'Price-tag overlay on Meta', 'meta', false, 'Linden GB +6.1% clicks (Sep 2026)'),
    P('conv_qa', 'Q&A conversational attribute on best sellers', 'google', true, 'no FeedSpark result yet — this would be the book’s first, which is the point')],
  rest: [Object.assign(P('sale_badge', 'Sale price with strike-through', 'google', false, ''), { status: 'blocked', ready: { ok: false, why: 'no market carries sale prices on 5% of products' } }),
    Object.assign(P('hl_six', 'Six product highlights per product', 'google', false, ''), { status: 'briefed', briefedAs: 'A/B Test - Six product highlights per product - Northwind - 1026' }),
    Object.assign(P('title_mask', 'MASK title structure', 'google', false, ''), { status: 'ran', ranAt: Date.now() - 40 * 86400000 })],
  counts: { ready: 3, blocked: 1, briefed: 1, ran: 1 }, evidence: {}, book: [{ brand: 'Harbour', n: 4 }], cold: [], ownArchive: true,
  comp: { on: true, markets: { gb: { at: Date.now() - 3600000, n: 120, summary: { total: 120, queries: [{ q: 'womens dresses', n: 40 }, { q: 'mens jackets', n: 40 }, { q: 'kids shoes', n: 40 }],
    merchants: [{ m: 'Atelier', n: 40, share: 33.3, top3: 5, queries: 3, sale: 45, rated: 60, typeFirst: 70, priceMed: 55, lenMed: 62, img: 'https://x/a' }, { m: 'Harbour', n: 30, share: 25, top3: 2, queries: 2, sale: 10, rated: 0, typeFirst: 40, priceMed: 70, lenMed: 50, img: '' }],
    us: { n: 6, share: 5, top3: 0, posMed: 14, sale: 0, rated: 0, typeFirst: 20, priceMed: 89, lenMed: 38, thumbs: [{ img: 'https://x/us1', t: 'Northwind Midi Dress', q: 'womens dresses' }] },
    them: { n: 114, sale: 35, rated: 48, typeFirst: 62, priceMed: 60, lenMed: 58, thumbs: [{ img: 'https://x/t1', m: 'Atelier', t: 'Pleated midi dress', q: 'womens dresses', sale: true, p: 55 }, { img: 'https://x/t2', m: 'Harbour', t: 'Wrap dress', q: 'womens dresses', sale: false, p: 70 }] },
    signals: [{ k: 'sale_badge', why: 'competitors badge a sale on 35% of their Shopping results; you on 0%' }] },
    auction: { v: 1, at: Date.now() - 7200000, mkt: 'gb', range: '1 Oct 2026 - 14 Oct 2026', segmented: false, you: { d: 'You', you: true, n: 1, is: 23.4 },
      comps: [{ d: 'harbour.example', you: false, n: 1, is: 45.1, ov: 60, or: 31.2 }, { d: 'atelier.example', you: false, n: 1, is: 10, isLt: true, ov: 12, or: 70 }],
      signals: [{ k: 'kw_theme', why: 'harbour.example wins 45.1% impression share against your 23.4% (Auction Insights, 1 Oct 2026 - 14 Oct 2026) — eligibility is what keywords lift' }] } }, de: null },
    signals: [{ mkt: 'gb', k: 'sale_badge', why: 'competitors badge a sale on 35% of their Shopping results; you on 0%' }],
    meta: { on: false, why: 'Meta’s ad creatives are not readable without a Meta Ad Library token (EU ads only under the DSA); what competitors run on Meta is a manual read for now.' } },
  feeds: [{ mkt: 'gb', fb: true, scanned: true }, { mkt: 'de', fb: false, scanned: false }] };
const PLAYBOOK = { ok: true, owner: true, scoped: false, brands: { Northwind: { tasks: [{ t: 'Keywords Optimisation - Oct', o: 'Ray', b: 'In progress', d: '01/11/2026' }], updated: Date.now() } }, generated: Date.now() };

const INIT = "window.__posts=[];(function(){var real=window.fetch;window.fetch=function(u,o){u=String(u);"
  + "var j=function(x){return Promise.resolve(new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(/engine\\.js/.test(u))return real(u,o);"
  + "if(u.indexOf('/api/compwatch')>=0&&o&&o.method==='POST'){window.__posts.push(JSON.parse(o.body));return j({ok:true,fresh:true});}"
  + "if(u.indexOf('/api/compwatch/auction')>=0&&o&&o.method==='PUT'){window.__puts=window.__puts||[];window.__puts.push(JSON.parse(o.body));return j({ok:true,auction:{comps:[{d:'harbour.example'},{d:'atelier.example'}]},signals:[]});}"
  + "if(u.indexOf('/api/compwatch/auction')>=0&&o&&o.method==='DELETE'){window.__dels=(window.__dels||0)+1;return j({ok:true,auction:null});}"
  + "if(u.indexOf('/api/testlab')>=0){window.__tlhits=(window.__tlhits||0)+1;return j(" + JSON.stringify(TLD) + ");}"
  + "if(u.indexOf('/api/playbook')>=0)return j(" + JSON.stringify(PLAYBOOK) + ");"
  + "if(u.indexOf('/api/golden/estate')>=0)return j({ok:true,feeds:{}});"
  + "if(u.indexOf('/api/volume/arrivals')>=0)return j({ok:true,feeds:[]});"
  + "if(u.indexOf('/api/access')>=0)return j({ok:1,modules:null,clients:null});"
  + "if(u.indexOf('/api/briefs')>=0&&o&&o.method==='PUT')return j({});"
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

  console.log('\n1) the section is on the rail, after the Top 3, drawn from the route');
  ok('no page error', errs.length === 0, errs.slice(0, 3));
  const sec = await page.$eval('#ck-tl', (n) => ({
    head: n.querySelector('h4').textContent.trim(),
    afterActs: !!(n.previousElementSibling && n.previousElementSibling.classList.contains('ck-act')),
    rows: [...n.querySelectorAll('.ck-row')].map((r) => r.querySelector('.nm').textContent.trim()),
    evs: [...n.querySelectorAll('.ck-ev')].map((e) => e.textContent.trim()),
    says: [...n.querySelectorAll('.ck-say')].map((e) => e.textContent.trim()),
    hows: [...n.querySelectorAll('.ck-how')].map((e) => e.textContent.trim()),
    firsts: n.querySelectorAll('.ck-first').length,
    pills: [...n.querySelectorAll('.ck-row .ck-pill')].map((p) => p.className.replace('ck-pill ', '')),
    briefs: n.querySelectorAll('[data-tl]').length,
    more: (n.querySelector('#ck-tl-more') || { textContent: '' }).textContent.trim(),
    list: n.querySelectorAll('.ck-tlmore li').length,
  })).catch((e) => ({ err: String(e) }));
  ok('the section renders, headed with the count', !sec.err && /Test this month/.test(sec.head) && /3 proposals · 3 more/.test(sec.head), sec.head || sec.err);
  ok('it sits after the Top 3 actions', sec.afterActs);
  ok('three questions, each specific', sec.rows.length === 3 && sec.rows.every((r) => /^How about we A\/B test .+ this month\?/.test(r)), sec.rows);
  ok('each carries the evidence the route gave — the peer, the figure, the month', sec.evs.length === 3 && /Harbour GB \+12\.4% ctr \(Aug 2026\)/.test(sec.evs[0]) && /book’s first/.test(sec.evs[2]), sec.evs);
  ok('…the line to say, and the design with its field and metric', sec.says.length === 3 && /Harbour saw \+12\.4%/.test(sec.says[0]) && sec.hows.length === 3 && /g:img_lifestyle/.test(sec.hows[0]) && /Measure: CTR/.test(sec.hows[0]), sec.hows[0]);
  ok('a first for the book wears its badge, once', sec.firsts === 1 && /first in the book/.test(sec.rows[2]), sec.rows[2]);
  ok('the surface is a pill on the row — Google, Meta', sec.pills.join() === 'tg,tm,tg', sec.pills);
  ok('one → Brief per proposal', sec.briefs === 3);
  ok('the rest folds behind "N more ideas"', /3 more ideas/.test(sec.more) && sec.list === 0, sec.more);

  console.log('\n2) the rest, opened: what unblocks each, what was briefed, what ran');
  await page.click('#ck-tl-more');
  await page.waitForTimeout(300);
  const more = await page.$$eval('#ck-tl .ck-tlmore li', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  ok('three ideas listed with their state', more.length === 3, more);
  ok('a blocked test names what unblocks it', more.some((m) => /not yet/.test(m) && /no market carries sale prices/.test(m)), more);
  ok('a briefed test names its ticket; a test that ran says when', more.some((m) => /briefed/.test(m) && /A\/B Test - Six/.test(m)) && more.some((m) => /^G ran \d/.test(m) || /ran \d+ \w+/.test(m)), more);

  console.log('\n3) the competitor read: who shows, where we sit, their pictures, the signal');
  const cw = await page.$eval('#ck-tl .ck-cw', (n) => ({
    merchants: [...n.querySelectorAll('.ck-cwm .nm:not(.us)')].map((e) => e.textContent.trim()),
    us: (n.querySelector('.ck-cwm .nm.us') || { textContent: '' }).textContent.trim(),
    usLine: (n.querySelector('.ck-cwm .nm.us') ? n.querySelector('.ck-cwm .nm.us').parentNode.textContent : '').replace(/\s+/g, ' ').trim(),
    thumbs: n.querySelectorAll('.ck-thumbs a').length, ours: n.querySelectorAll('.ck-thumbs a.us').length, sale: n.querySelectorAll('.ck-thumbs .s').length,
    sig: [...n.querySelectorAll('.ck-sig')].filter((e) => !e.closest('.ck-au')).map((e) => e.textContent.trim()),
    read: n.querySelectorAll('[data-cw]').length, notYet: /not read yet/.test(n.textContent), meta: /Meta Ad Library/.test(n.textContent),
    bars: [...n.querySelectorAll('.ck-tlbar i')].map((i) => i.style.width),
  }));
  ok('the merchants lead, in order of presence, with a share bar each', cw.merchants.slice(1, 3).join() === 'Atelier,Harbour' && cw.bars.length >= 3, cw.merchants);
  ok('our own line is apart, with our share and position', cw.us === 'Northwind' && /5%/.test(cw.usLine) && /median position 14/.test(cw.usLine), cw.usLine);
  ok('their pictures beside ours, a sale flagged on the picture', cw.thumbs === 3 && cw.ours === 1 && cw.sale === 1, cw);
  ok('the signal names the test and the figures behind it', cw.sig.length === 1 && /test sale badge/.test(cw.sig[0]) && /35%/.test(cw.sig[0]), cw.sig);
  ok('an unread market offers ⚡ Read now; a read one offers ⟳', cw.read === 2 && cw.notYet);
  ok('Meta is stated as not readable, with why', cw.meta);

  console.log('\n3b) Auction Insights — the report drawn as uploaded, and uploaded through the real file input');
  const au = await page.$eval('#ck-tl .ck-cw', (n) => {
    const blocks = [...n.querySelectorAll('.ck-au')];
    const gb = blocks[0], de = blocks[1];
    return { blocks: blocks.length, head: gb.querySelector('.ck-cwm').textContent.replace(/\s+/g, ' ').trim(),
      rows: [...gb.querySelectorAll('.ck-cwm')].slice(1).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
      youFirst: gb.querySelectorAll('.ck-cwm')[1].classList.contains('you'), lt: !!gb.querySelector('.lt'),
      bars: [...gb.querySelectorAll('.ck-tlbar i')].map((i) => i.style.width), sig: [...gb.querySelectorAll('.ck-sig')].map((e) => e.textContent.trim()),
      deHead: de.textContent.replace(/\s+/g, ' ').trim(), upBtn: !!de.querySelector('[data-au="de"]'), replBtn: !!gb.querySelector('[data-au="gb"]'), forget: !!gb.querySelector('[data-au-x="gb"]'),
      input: (() => { const i = document.querySelector('#ck-au-file'); return i ? { type: i.type, hidden: getComputedStyle(i).display === 'none' } : null; })() };
  });
  ok('one block per market: GB carries the report with its range and upload date; DE says no report uploaded with ⇪ Upload', au.blocks === 2 && /1 Oct 2026 - 14 Oct 2026/.test(au.head) && /uploaded/.test(au.head) && /no report uploaded/.test(au.deHead) && au.upBtn, au);
  ok('You first, then the domains by impression share, each a bar; "< 10%" drawn as the floor it is', au.youFirst && /^You.*23\.4%/.test(au.rows[0]) && /harbour\.example.*45\.1%.*overlap 60%.*you outrank 31\.2%/.test(au.rows[1]) && /atelier\.example.*<10%/.test(au.rows[2]) && au.lt && au.bars[0] === '23%' && au.bars[1] === '45%', au.rows);
  ok('the auction signal names the test and the figures; ⇪ Replace and ✕ offered on a read market', au.sig.length === 1 && /test kw theme/.test(au.sig[0]) && /45\.1%/.test(au.sig[0]) && au.replBtn && au.forget, au.sig);
  ok('the file input is a real file control, hidden until the button opens it', au.input && au.input.type === 'file' && au.input.hidden, au.input);
  const csv = path.join(require('os').tmpdir(), 'fcc-auction-' + process.pid + '.csv');
  require('fs').writeFileSync(csv, '\ufeffAuction insights report\n1 Oct 2026 - 14 Oct 2026\n\nDisplay URL domain,Impression share,Overlap rate,Outranking share\nYou,23.40%,--,--\nharbour.example,45.10%,60.00%,31.20%\n"www.atelier.example",< 10%,12.00%,70.00%\nTotal,--,--,--\n');
  const hitsBefore = await page.evaluate(() => window.__tlhits || 0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#ck-tl [data-au="de"]')]);
  await chooser.setFiles(csv);
  await page.waitForTimeout(2500);
  const up = await page.evaluate(() => ({ puts: window.__puts || [], hits: window.__tlhits || 0 }));
  if (process.env.AU_DEBUG) console.log('DEBUG', JSON.stringify({ errs, hitsBefore, hits: up.hits }));
  try { require('fs').unlinkSync(csv); } catch (e) {}
  ok('⇪ Upload opens the file chooser; the file is read in the browser into ROWS and PUT once for the brand and market — the blank line dropped, the quoted domain unquoted', up.puts.length === 1 && up.puts[0].client === 'Northwind' && up.puts[0].market === 'de' && up.puts[0].rows.length === 7 && up.puts[0].rows[2][0] === 'Display URL domain' && up.puts[0].rows[5][0] === 'www.atelier.example' && up.puts[0].rows[5][1] === '< 10%', up.puts[0] && { n: up.puts[0].rows.length, r5: up.puts[0].rows[5] });
  ok('the lab is re-read after the upload', up.hits > hitsBefore, up);
  page.once('dialog', (d) => d.accept());
  await page.click('#ck-tl [data-au-x="gb"]');
  await page.waitForTimeout(600);
  ok('✕ asks, then DELETEs the stored report', (await page.evaluate(() => window.__dels || 0)) === 1);

  console.log('\n4) ⚡ Read now POSTs the market and re-reads the lab');
  const before = await page.evaluate(() => window.__tlhits || 0);
  await page.click('#ck-tl [data-cw="de"]');
  await page.waitForTimeout(900);
  const posted = await page.evaluate(() => ({ posts: window.__posts, hits: window.__tlhits || 0 }));
  ok('one POST, the brand and the market, forced', posted.posts.length === 1 && posted.posts[0].client === 'Northwind' && posted.posts[0].market === 'de' && posted.posts[0].force === true, posted.posts);
  ok('the lab is re-read after it', posted.hits > before, posted);

  console.log('\n5) → Brief raises a TEST brief through the page’s own composer');
  await page.click('#ck-tl [data-tl="0"]');
  await page.waitForTimeout(900);
  const comp = await page.evaluate(() => {
    const t = document.querySelector('#bg-task'), c = document.querySelector('#bg-client'), s = document.querySelector('#bg-scope'), k = document.querySelector('#bg-cat');
    return { task: t && t.value, client: c && c.value, scope: s && s.value, cat: k && k.value };
  });
  ok('the composer opened on the brand', comp.client === 'Northwind', comp.client);
  ok('with the test’s task name', comp.task === 'A/B Test - Lifestyle main image - Northwind - 1026', comp.task);
  ok('the category is Testing', comp.cat === 'test', comp.cat);
  ok('the scope is the test brief — and names the INDUSTRY, never the peer brand', /Test: Lifestyle main image/.test(comp.scope || '') && /a Fashion account saw/.test(comp.scope || '') && !/Harbour/.test(comp.scope || ''), (comp.scope || '').slice(0, 120));

  console.log('\n6) the phone');
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await installEngineRoutes(m);
  const mp = await m.newPage(); const merr = []; mp.on('pageerror', (e) => merr.push(e.message));
  await m.addInitScript({ content: INIT });
  await mp.goto('file://' + path.join(D, 'FeedSpark_Workflow.html') + '?pb=1');
  await mp.waitForTimeout(2600);
  await mp.selectOption('#ck-brand', 'Northwind'); await mp.waitForTimeout(1200);
  const ph = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, has: !!document.querySelector('#ck-tl') }));
  ok('no page error, no sideways overflow, the section present', merr.length === 0 && ph.sw <= ph.w + 1 && ph.has, { merr: merr.slice(0, 2), ph });

  await browser.close();
  console.log(fail ? `\n✗ ${fail} failed` : '\n✓ Test Lab on the Workflow rail holds');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
