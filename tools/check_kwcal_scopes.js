#!/usr/bin/env node
/*
 * Keyword Calendar — the seeded product scopes, RENDERED (Ray, 14 Oct 2026: "can you scope up by
 * choosing products on clients product type on all the keywords themes?").
 *
 * tools/test_kwcal_tie.mjs pins the DATA (every seeded path against an independent census). This
 * drives the real board, because the two things that go wrong here are only visible once drawn —
 * both of them did, on the Superdry seed:
 *   1. A SCOPE THAT IS SET reading as a scope to set. volOf needs the market's product-type index
 *      and returns null without one, so before anyone runs ⟳ Sync every scoped card said
 *      "⚙ Set scope" and counted in the KPI. An unread index is not a zero.
 *   2. The brand has to APPEAR with its cards — a seed reaching the store, the selector carrying
 *      the brand and N cards landing are each a step that can fail in silence.
 *
 * Run: node tools/check_kwcal_scopes.js       (skips cleanly where Playwright is unavailable)
 */
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { installEngineRoutes } = require('./engine_routes.js');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');
const root = path.resolve(__dirname, '..');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// what the seed holds, read independently of the page we are about to drive
const src = fs.readFileSync(path.join(D, 'FeedSpark_KWCal.html'), 'utf8');
const blk = src.slice(src.indexOf('var SEED={'), src.indexOf('\n]}};', src.indexOf('var SEED={')));
function seg(b) {
  const at = blk.indexOf(b + ':{events:[');
  const rest = blk.slice(at + b.length + 10);
  const nxt = /\w[\w ]*:\{events:\[/.exec(rest);
  return nxt ? rest.slice(0, nxt.index) : rest;
}
function moments(b) {
  const s = seg(b), out = [], re = /\{id:["']([a-z0-9_]+)["']/g; let m;
  while ((m = re.exec(s))) {
    let d = 0, q = null, j = m.index;
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
      if (c === "'" || c === '"') q = c; else if (c === '{') d++; else if (c === '}' && --d === 0) break;
    }
    const body = s.slice(m.index, j + 1);
    const p = /pts:\[([\s\S]*?)\]\}/.exec(body);
    out.push({ id: m[1], pts: p ? JSON.parse('[' + p[1] + ']') : null, wide: /brandwide:1/.test(body) });
  }
  return out;
}

const BRANDS = ['Reiss', 'Accessorize', 'Schuh'];
const MKTS = { Reiss: ['gb', 'de', 'us'], Accessorize: ['gb', 'gb-fb'], Schuh: ['gb', 'de', 'ie'] };
const clients = {}; BRANDS.forEach((b) => { clients[b] = { markets: MKTS[b] }; });
const INIT = "window.fetch=function(url){var u=String(url);"
  + "var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(u.indexOf('/api/feed/clients')>=0)return j({clients:" + JSON.stringify(clients) + "});"
  + "if(u.indexOf('/api/feed/markets')>=0)return j({markets:{gb:1,de:1,us:1,ie:1,'gb-fb':1}});"
  + "if(u.indexOf('/api/kwresults')>=0)return j({results:[]});"
  + "if(u.indexOf('/api/briefs')>=0)return j({});"
  + "if(u.indexOf('/api/kwcal')>=0)return j({});return j({});};";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await installEngineRoutes(ctx);
  await ctx.addInitScript({ content: INIT });
  await page.goto('file://' + path.join(D, 'FeedSpark_KWCal.html'));
  await page.waitForTimeout(1200);
  console.log('\n1) the boards render');
  ok('no page error', errs.length === 0, errs.slice(0, 3));

  for (const brand of BRANDS) {
    const want = moments(brand);
    const scoped = want.filter((m) => m.pts), wide = want.filter((m) => m.wide && !m.pts);
    const bare = want.filter((m) => !m.pts && !m.wide);
    await page.selectOption('#brand', brand);
    await page.waitForTimeout(600);
    console.log(`\n2·${brand}) ${want.length} moments — ${scoped.length} scoped, ${wide.length} brand-wide, ${bare.length} named unscoped`);
    const btns = await page.$$eval('.scope', (n) => n.map((b) => ({
      id: (b.closest('[data-scope]') || b).getAttribute('data-scope') || b.getAttribute('data-scope'),
      cls: b.className, txt: b.textContent.trim() })));
    ok('every moment draws a card', btns.length === want.length, { drew: btns.length, seed: want.length });
    const pend = btns.filter((b) => /\bpend\b/.test(b.cls));
    const unset = btns.filter((b) => /\bunset\b/.test(b.cls));
    // nobody has synced this market, so a SET scope must read as waiting to be measured —
    // never as "Set scope", which is what the KPI counts and what an AM would act on
    ok('no scoped card reads "Set scope"', unset.length === bare.length, { unset: unset.length, want: bare.length });
    ok('…each scoped card names how many product types it covers',
      pend.filter((b) => /^\d+ product types? · sync to measure/.test(b.txt)).length === scoped.length,
      pend.slice(0, 2).map((b) => b.txt));
    ok('…and the brand-wide ones say the catalogue is in scope',
      pend.filter((b) => /whole catalogue/.test(b.txt)).length === wide.length,
      { wide: pend.filter((b) => /whole catalogue/.test(b.txt)).length, want: wide.length });
    const kpi = await page.$$eval('.kpi', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(`the KPI counts only the ${bare.length} genuinely unscoped`,
      kpi.some((k) => new RegExp('^' + bare.length + '\\s*Scopes to set$').test(k)), kpi);
  }

  /* and once an index exists the scopes resolve to real counts — a seeded path that drifted in
     spelling would still LOOK set while summing to nothing. The index goes in through the STORED
     record on a second load: applySeeds replaces STORE[brand] wholesale when KV has no events for
     it, so an index poked onto the live object is gone by the next render. */
  console.log('\n3) with the market\u2019s index synced, a scope resolves to the sum of its own paths');
  const cen = JSON.parse(fs.readFileSync(path.join(root, 'ops', 'calendars',
    'schuh_gb_product_types_2026-10-14.json'), 'utf8')).product_types;
  const sch = moments('Schuh').filter((m) => m.pts);
  // a path the census does not carry is a FINDING, not a crash — building the index straight off
  // cen[p].skus threw a stack trace on a drifted spelling, which reads as a broken harness
  const map = {}, offTree = [];
  sch.forEach((m) => m.pts.forEach((p) => {
    if (!cen[p]) { offTree.push(m.id + ' → ' + p); return; }
    map[p] = cen[p].skus;
  }));
  ok('every seeded Schuh path is one the census carries', offTree.length === 0, offTree.slice(0, 3));
  const stored = { Schuh: {
    ptidx: { gb: { map, __total: 22344, sat: { n: 7950, cols: 1, v: 2 }, t: Date.now() } },
    events: sch.map((m, i) => ({ id: m.id, name: 'M' + i, lane: 'studio',
      date: '2026-11-' + String((i % 27) + 1).padStart(2, '0'), terms: ['x'], pts: m.pts })) } };
  const p2 = await ctx.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.addInitScript({ content: INIT.replace("if(u.indexOf('/api/kwcal')>=0)return j({});",
    "if(u.indexOf('/api/kwcal')>=0)return j(" + JSON.stringify(stored) + ");") });
  await p2.goto('file://' + path.join(D, 'FeedSpark_KWCal.html') + '?client=Schuh');
  await p2.waitForTimeout(1500);
  ok('no page error on the stored board', errs2.length === 0, errs2.slice(0, 2));
  const after = await p2.$$eval('.scope', (n) => n.map((b) => ({
    id: b.getAttribute('data-scope'), txt: b.textContent.trim() })));
  ok('no Schuh card is still waiting to be measured', after.length > 0 && !after.some((b) => /sync to measure/.test(b.txt)),
    after.filter((b) => /sync to measure/.test(b.txt)).slice(0, 3));
  const byId = Object.fromEntries(after.map((b) => [b.id, b.txt]));
  const bad = sch.filter((m) => {
    const want = m.pts.reduce((a, pp) => a + (cen[pp] ? cen[pp].skus : 0), 0);
    return byId[m.id] !== want.toLocaleString('en-GB') + ' products' && byId[m.id] !== want + ' products';
  });
  ok('every scoped card reads the sum of its own paths', bad.length === 0,
    bad.slice(0, 3).map((m) => m.id + ' → ' + byId[m.id] + ' want '
      + m.pts.reduce((a, pp) => a + (cen[pp] ? cen[pp].skus : 0), 0)));

  /* 4) THE BOARD THAT ALREADY EXISTS (Ray, 14 Oct 2026: "i dont see products being selected in
     scopes for Schuh btw"). Every check above loads against an EMPTY /api/kwcal, so applySeeds
     writes the whole seed and the scopes are there by construction — which is why all of them
     passed on a live board that had none. Schuh's KV record has held events since 22 Sep, so the
     real state is a stored moment with the seed's id and NO scope: upgradeSeeds has to fill it,
     and a moment somebody has scoped by hand has to survive untouched. */
  console.log('\n4) a scope added to the seed reaches a board that already had events');
  const mine = sch[0].id, keep = ['Mens > Trainers > Nike'];
  const pre = { Schuh: {
    ptidx: { gb: { map: Object.assign({}, map, { 'Mens > Trainers > Nike': 123 }), __total: 22344,
      sat: { n: 7950, cols: 1, v: 2 }, t: Date.now() } },
    events: sch.map((m, i) => {
      const e = { id: m.id, name: 'M' + i, lane: 'studio',
        date: '2026-11-' + String((i % 27) + 1).padStart(2, '0'), terms: ['x'] };
      if (m.id === mine) e.pts = keep;              // an AM's own scope — never overwritten
      return e;                                      // every other moment: no scope at all
    }) } };
  let put = null;
  const p3 = await ctx.newPage();
  const errs3 = []; p3.on('pageerror', (e) => errs3.push(e.message));
  await p3.addInitScript({ content: INIT.replace("if(u.indexOf('/api/kwcal')>=0)return j({});",
    "if(u.indexOf('/api/kwcal')>=0){if((arguments[1]||{}).method==='PUT'){window.__put=arguments[1].body;return j({ok:1})}return j("
    + JSON.stringify(pre) + ")}") });
  await p3.goto('file://' + path.join(D, 'FeedSpark_KWCal.html') + '?client=Schuh');
  await p3.waitForTimeout(1800);
  ok('no page error', errs3.length === 0, errs3.slice(0, 2));
  const up = await p3.$$eval('.scope', (n) => n.map((b) => ({
    id: b.getAttribute('data-scope'), txt: b.textContent.trim(), cls: b.className })));
  const upById = Object.fromEntries(up.map((b) => [b.id, b.txt]));
  ok('no card reads "Set scope"', !up.some((b) => /\bunset\b/.test(b.cls)),
    up.filter((b) => /\bunset\b/.test(b.cls)).slice(0, 3).map((b) => b.id));
  const idx = pre.Schuh.ptidx.gb.map;   // the fixture's own index, Nike override included
  const miss = sch.filter((m) => m.id !== mine).filter((m) => {
    const want = m.pts.reduce((a, pp) => a + (idx[pp] || 0), 0);
    return upById[m.id] !== want.toLocaleString('en-GB') + ' products' && upById[m.id] !== want + ' products';
  });
  ok('every unscoped stored moment took the seed’s scope', miss.length === 0,
    miss.slice(0, 3).map((m) => m.id + ' → ' + upById[m.id]));
  ok('a scope the AM set by hand is left exactly as it was', upById[mine] === '123 products',
    { id: mine, got: upById[mine] });
  put = await p3.evaluate(() => window.__put || null);
  ok('the upgrade is saved to the team, not left on this screen', !!put && /pts/.test(put));
  const saved = put ? JSON.parse(put) : null;
  if (saved) {
    const ev = (saved.Schuh.events || []).reduce((a, e) => (a[e.id] = e, a), {});
    ok('…and the saved record carries the AM’s own scope untouched',
      JSON.stringify((ev[mine] || {}).pts) === JSON.stringify(keep), (ev[mine] || {}).pts);
    const other = sch.find((m) => m.id !== mine);
    ok('…and the seed’s scope on the rest',
      JSON.stringify((ev[other.id] || {}).pts) === JSON.stringify(other.pts), (ev[other.id] || {}).pts);
  }

  /* ---- 5) a moment added to the seed after the board existed, tracking a ticket already raised
     (Ray, 22 Oct 2026: "can you add this ticket as a keywords theme in Reiss ? - it's “New
     Arrivals” and start tracking it"). Two things only a render shows: the moment reaching a
     board that already has events, and its chip reading the TICKET'S stage rather than a manual
     one — which is the whole of "start tracking it". ---- */
  console.log('\n5) a new seed moment lands on an old board and reads its ticket');
  const rs = moments('Reiss').filter((m) => m.id !== 'rs_newarrivals');
  const old = { Reiss: { events: rs.map((m, i) => ({ id: m.id, name: 'R' + i, lane: 'campaign',
    date: '2026-11-' + String((i % 27) + 1).padStart(2, '0'), terms: ['x'] })) } };
  const TICK = { 'REIS-20261019-02': { id: 'REIS-20261019-02', client: 'Reiss',
    task: 'Golden Record Fix - First seen: Last 30 days - Reiss GB - 1026', status: 'running' } };
  const p4 = await ctx.newPage();
  const errs4 = []; p4.on('pageerror', (e) => errs4.push(e.message));
  await p4.addInitScript({ content: INIT
    .replace("if(u.indexOf('/api/kwcal')>=0)return j({});",
      "if(u.indexOf('/api/kwcal')>=0){if((arguments[1]||{}).method==='PUT'){window.__put=arguments[1].body;return j({ok:1})}return j("
      + JSON.stringify(old) + ")}")
    .replace("if(u.indexOf('/api/briefs')>=0)return j({});",
      "if(u.indexOf('/api/briefs')>=0)return j(" + JSON.stringify(TICK) + ");") });
  await p4.goto('file://' + path.join(D, 'FeedSpark_KWCal.html') + '?client=Reiss');
  await p4.waitForTimeout(1800);
  ok('no page error', errs4.length === 0, errs4.slice(0, 2));
  const cards = await p4.$$eval('.rc[data-kw]', (n) => n.map((c) => ({
    id: c.getAttribute('data-kw') || '', txt: c.textContent.replace(/\s+/g, ' ').trim() })));
  const na = cards.find((c) => c.id === 'rs_newarrivals');
  ok('the New Arrivals card is on the board', !!na, cards.length + ' cards, none with that id');
  if (na) {
    ok('…named as Ray named it', /New Arrivals/.test(na.txt), na.txt.slice(0, 80));
    // the tie is e.wf, so the chip is the TICKET's stage — not a manual one anybody has to move
    // the tie is e.wf, so the chip is the TICKET's stage and whose court it is in — not a
    // manual chip somebody has to remember to move
    ok('…and its chip reads the ticket’s own stage and court',
      /running/i.test(na.txt) && /AM/.test(na.txt), na.txt.slice(0, 160));
    // the ticket's ibfdue is the brief-by; the live date is LEAD_DAYS after it
    ok('…and the card says both dates', /live 13 Nov/.test(na.txt) && /brief 23 Oct/.test(na.txt),
      na.txt.slice(0, 120));
  }
  const put4 = await p4.evaluate(() => window.__put || null);
  const rec = put4 ? JSON.parse(put4).Reiss : null;
  ok('it is saved to the team, not left on this screen',
    !!rec && (rec.events || []).some((e) => e.id === 'rs_newarrivals'));
  ok('…with the offer recorded so a deletion can stick',
    !!rec && (rec.seeded || []).indexOf('rs_newarrivals') >= 0, rec && rec.seeded);

  await browser.close();
  console.log(fail ? '\nFAIL ' + fail : '\nPASS');
  process.exit(fail ? 1 : 0);
})();
