// A small SYNTHETIC set of FeedHero rule_report rows, pushed through the REAL engine
// (cloudflare/feedspark-deck/src/rules.js) into the three shapes the worker serves — GET /api/rules,
// GET /api/rules?client=&market=, GET /api/rules/stock — for the browser tripwires (check_mobile.js,
// check_darkmode.js). Without it /rules and /stock render their "nothing read yet" state and neither
// tripwire meets the bars, findings, tables or the coverage matrix. Nothing here is a real rule list:
// the names are generic, the counts invented. The real shapes are asserted in tools/test_rules.mjs.
//
// The engine is loaded by reading its source (it has no imports) rather than require()-ing an ES
// module, so this runs on any Node the tripwires run on.
'use strict';
const fs = require('fs');
const path = require('path');
function engine() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'feedspark-deck', 'src', 'rules.js'), 'utf8');
  const names = [];
  const body = src.replace(/^export (const|function) ([A-Za-z0-9_]+)/gm, (_, kw, n) => { names.push(n); return kw + ' ' + n; });
  return new Function(body + '\nreturn {' + names.join(',') + '};')();
}
function rows(cmpid, company, of, seed) {
  const R = [];
  const add = (name, field, db, type, imp, created, mod, by, issues, batch) => R.push({
    rule_id: cmpid + '-' + R.length, cmpid, company, rule_name: name, target_field: field, target_db: db, rule_type: type || 'User',
    batch_id: batch || 'All products', runtime: (0.1 + (R.length % 7) / 10).toFixed(1) + ' sec', impacted_items: (imp == null ? of : imp).toLocaleString('en-GB') + ' of ' + of.toLocaleString('en-GB'),
    created_on: created, created_by: by || 'Analyst A', modified_on: mod || '', modified_by: mod ? (by || 'Analyst A') : '', rule_status: 'Active', rule_issues: issues || [],
  });
  add('Copy base title', 'Product name', 'product_name', 'System', of, '19/08/2021 at 12:22 PM');
  add('Title: append colour', 'Product name', 'product_name', 'User', Math.round(of * 0.8), '02/03/2024 at 10:00 AM', '14/09/2026 at 09:30 AM');
  add('Title: brand at the front', 'Product name', 'product_name', 'User', Math.round(of * 0.7), '02/03/2024 at 10:05 AM');
  add('A/B title test - material', 'Product name', 'product_name', 'User', 0, '11/01/2026 at 11:00 AM', '', 'Analyst B', ['Not impacting any items']);
  add('Description clean-up', 'Description', 'long_description', 'User', of, '05/05/2023 at 09:00 AM');
  add('Product type from category', 'Product Type', 'new_product_types', 'User', of, '05/05/2023 at 09:10 AM');
  add('Setup availability', 'Availability', 'stock_status', 'System', of, '19/08/2021 at 12:30 PM');
  add('Stock < ' + (8 + seed) + ' -> OOS', 'Stock quantity', 'stock_quantity', 'User', Math.round(of * 0.3), '10/10/2024 at 02:00 PM');
  add('Range completion percentage', 'Range completion', 'rc_percent', 'User', of, '10/10/2024 at 02:10 PM');
  add('Set hero sizes', 'Hero size', 'is_hero_size', 'User', of, '10/10/2024 at 02:20 PM');
  add('Range completion exclusion', 'Exclusion', 'rc_exclusion', 'User', Math.round(of * 0.06), '10/10/2024 at 02:30 PM');
  add('Social: RC > 6' + seed + '% -> out of stock', 'Social availability', 'social_availability', 'User', Math.round(of * 0.2), '12/12/2024 at 03:00 PM');
  add('Ad hoc hero size inclusion - review weekly', 'Availability', 'stock_status', 'User', Math.round(of * 0.02), '01/02/2026 at 10:00 AM', '01/02/2026 at 10:00 AM', 'Analyst B');
  add('CL2: empty < 0.26 RC', 'Custom label 2', 'gb_cl2', 'User', of, '12/12/2024 at 03:10 PM');
  add('LIA: next day', 'Pickup SLA', 'pickup_sla', 'User', of, '03/03/2025 at 11:00 AM');
  add('New In by date', 'Custom label 0', 'gb_cl0', 'User', Math.round(of * 0.1), '03/03/2025 at 11:10 AM');
  add('Christmas 2025 label', 'Custom label 4', 'custom_label_4', 'User', 12, '01/11/2025 at 09:00 AM');
  add('Valentine label', 'Custom label 1', 'custom_label_1', 'User', 0, '01/02/2025 at 09:00 AM', '', 'Analyst A', ['Not impacting any items']);
  add('Temporary PT fix', 'Product Type', 'new_product_types', 'User', 40, '01/06/2025 at 09:00 AM');
  add('Old overlay link', 'Image URL', 'meta_image_link', 'User', 0, '01/06/2022 at 09:00 AM', '', 'Analyst C', ['Target column missing']);
  add('Tracking string', 'Product URL', 'utm_shopping', 'User', of, '01/06/2022 at 09:10 AM');
  for (let i = 0; i < 4 + seed; i++) add('Label rule ' + (i + 1), 'Custom label 3', 'custom_label_3', 'User', i % 2 ? 0 : 200, '0' + (1 + i) + '/0' + (1 + (i % 8)) + '/2025 at 10:00 AM', '', 'Analyst A', i % 2 ? ['Not impacting any items'] : []);
  return R;
}
function build() {
  const E = engine();
  const now = Date.UTC(2026, 8, 28, 9);
  const MK = [
    { client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', of: 58000, seed: 1 },
    { client: 'Superdry', market: 'DE', cmpid: 'superdry_de', of: 41000, seed: 3 },
    { client: 'Reiss', market: 'GB', cmpid: 'reiss_gb', of: 60000, seed: 2 },
  ];
  const recs = {}, idx = {};
  MK.forEach((m) => {
    const rules = E.normRules(rows(m.cmpid, m.client + ' ' + m.market, m.of, m.seed));
    recs[m.cmpid] = rules;
    idx[m.cmpid] = E.idxEntry(m, rules, { total: m.cmpid === 'superdry_gb' ? rules.length + 40 : rules.length }, now);
  });
  const list = Object.keys(idx).map((k) => idx[k]);
  const status = { state: 'ok', at: now, ok_at: now - 1800000, fails: 0, error: null, auth: 'Authorization', url: 'mcp.feedhero.net', pulled: ['Superdry GB (24)'], read: 3, total: 5 };
  const rosterBrands = [{ client: 'Reiss', markets: ['GB', 'US'] }, { client: 'Superdry', markets: ['GB', 'DE', 'FR'] }];
  const unread = [{ client: 'Reiss', market: 'US', cmpid: 'reiss_us' }, { client: 'Superdry', market: 'FR', cmpid: 'superdry_fr' }];
  const base = { ok: true, tracked: list.length, roster: 5, unread, rosterBrands, scope: { brand: null }, status, at: now };
  const findings = []; list.forEach((r) => (r.find || []).forEach((f) => findings.push(f))); findings.sort((a, b) => b.sev - a.sev || b.n - a.n);
  const book = Object.assign({}, base, { families: E.FAMILIES, mechanisms: E.MECHANISMS, channels: E.CHANNELS, sev: E.SEV, estate: E.estate(list), brands: E.brandsOf(list), findings,
    markets: list.map((r) => { const o = Object.assign({}, r); delete o.find; o.sn = (r.stock || []).length; delete o.stock; return o; }) });
  // a synthetic 30-day Google Ads Total per market (the ROAS index entry's shape) — invented figures, so
  // the ad-spend forecast card and panel render under the tripwires; Reiss GB is left unread on purpose
  const ROAS = {
    superdry_gb: { w30: { spend: { cur: '£', n: 42000 }, clicks: 160000, skus: 21000, impr: 9800000, zombiePct: 31.5 }, updated: now - 7200000 },
    superdry_de: { w30: { spend: { cur: '€', n: 18500 }, clicks: 70500, skus: 15200, impr: 4100000, zombiePct: 38.2 }, updated: now - 7200000 },
  };
  // the wired feeds, joined to a roster market on the FeedHero company id (feedKeys) exactly as the worker
  // joins them — synthetic URLs in the real /output_feeds/<cc>/<cmpid>/<hash>/<file> shape, scan-index keys
  // in the real WIRED shape ('Superdry|gb', never the roster's 'GB'); only Reiss GB has a Meta feed
  const WIRED = [
    { client: 'Superdry', mkt: 'gb', url: 'https://s2.feedhero.net/output_feeds/gb/superdry_gb/0000/latest.xml' },
    { client: 'Superdry', mkt: 'de', url: 'https://s2.feedhero.net/output_feeds/gb/superdry_de/0000/latest.xml' },
    { client: 'Reiss', mkt: 'gb', url: 'https://s2.feedhero.net/output_feeds/gb/reiss_gb/0000/latest.xml' },
    { client: 'Reiss', mkt: 'gb-fb', url: 'https://s2.feedhero.net/output_feeds/fb/reiss_gb/0000/latest.xml' },
  ];
  const FK = E.feedKeys(WIRED);
  // the SKU denominator is the live output feed's own row count (voldobidx), not FeedHero's Ads-traffic
  // 'skus' — deliberately a DIFFERENT number from ROAS.skus above so the stub can never pass by
  // coincidence; Reiss GB carries no ROAS read so its feed row count alone must not price it
  const VOLIDX = {
    'Superdry|gb': { rows: 45210, t: now - 5400000 },
    'Superdry|de': { rows: 31840, t: now - 5400000 },
    'Reiss|gb': { rows: 22657, t: now - 5400000 },
  };
  // availability, master → feed (invented counts): Superdry DE's master is left uncounted on purpose, so the
  // card draws its "not counted yet" state beside a scanned feed
  const FEEDAV = {
    'Superdry|gb': { n: 45210, in: 45210, out: 0, pre: 0, none: 0, other: 0, t: now - 5400000 },
    'Superdry|de': { n: 31840, in: 30120, out: 1720, pre: 0, none: 0, other: 0, t: now - 5400000 },
    'Reiss|gb': { n: 22657, in: 22400, out: 0, pre: 257, none: 0, other: 0, t: now - 5400000 },
    'Reiss|gb-fb': { n: 9400, in: 6120, out: 3280, pre: 0, none: 0, other: 0, t: now - 5400000 },
  };
  // held back from Google (the agent's join, invented counts, pushed through the REAL sanitizeHeld the worker stores them
  // with): Superdry GB's held-back styles sit under one range-completion line, Reiss GB's are spread across every level
  // (no line — the card falls back to the cut-off a rule NAME states), Superdry DE is not counted yet
  const MASTERAV = {
    superdry_gb: { n: 58000, in: 29100, out: 28900, pre: 0, none: 0, other: 0, via: 'availability', col: 'availability', imp: '2026-09-28 05:27:48', t: now - 7200000,
      hbv: E.HELD_V, hb: E.sanitizeHeld({ ok: true, n: 3800, absent: 3790, out: 10, inStock: 29100, feedN: 45210, feedLive: 45210, join: { h: 'product_id', on: 'fs_data_original_id', rate: 0.52 },
        rcH: [[10, 400, 0], [20, 900, 0], [25, 1100, 4], [33.3, 1300, 0], [37.5, 5, 900], [50, 20, 4000], [66.7, 10, 8000], [100, 65, 9000]] }) },
    reiss_gb: { n: 60000, in: 24900, out: 34790, pre: 300, none: 0, other: 10, via: 'availability', col: 'availability', imp: '2026-09-28 07:00:11', t: now - 7200000,
      hbv: E.HELD_V, hb: E.sanitizeHeld({ ok: true, n: 2100, absent: 2100, out: 0, inStock: 24900, feedN: 22657, feedLive: 22657, join: { h: 'id', on: 'fs_data_original_id', rate: 0.54 },
        rcH: [[20, 300, 1500], [40, 400, 3000], [60, 500, 5000], [80, 400, 6000], [100, 500, 7000]] }) },
  };
  const stock = Object.assign({}, base, { mechanisms: E.MECHANISMS, channels: E.CHANNELS, drivers: E.DRIVERS, sev: E.SEV, matrix: E.stockMatrix(list), cutoffs: E.stockCutoffs(list), heroRuns: E.heroRuns(list), findings: E.stockFindings(list, now),
    sv: { scenarios: E.SV_SCENARIOS, days: E.SV_WINDOW_DAYS },
    markets: list.map((r) => { const k = FK[r.cmpid] || {};
      return Object.assign(E.stockView(r, ROAS[r.cmpid], k.g ? VOLIDX[k.g] : null,
        { master: MASTERAV[r.cmpid], g: k.g ? FEEDAV[k.g] : null, fb: k.fb ? FEEDAV[k.fb] : null, wired: { g: !!k.g, fb: !!k.fb } }),
        { wk: { g: k.g ? k.g.split('|')[1] : null, fb: k.fb ? k.fb.split('|')[1] : null } }); }) });
  const rules = recs.superdry_gb, where = { client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', rules };
  const market = { ok: true, client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', read: true, updated: now, total: rules.length + 40, capped: true, rules,
    chains: E.chains(rules, 2).map((c) => ({ d: c.d, t: c.t, fam: c.fam, rules: c.rules.map((x) => x.i) })), findings: E.rulesFindings([where], now),
    stockFindings: E.stockFindings([Object.assign({ stock: rules.filter((x) => x.sk) }, where)], now), status };
  return { book, stock, market, hero: heroBuild(now), levers: leverBuild(now) };
}
// STOCK LEVERS (/api/rules/levers): an invented plan for a brand — a range-completion band and a BAU line the stub's GB
// measured line sits OFF (so a market reads off plan), a units lever scoped to a range with what it ran at before, hero
// sizes on, every SALE value unset — one sale period over two of its three markets, and two records kept by hand. No real
// figure.
function leverBuild(now) {
  const store = {
    'p:Superdry': { levers: [{ k: 'rc', lo: 20, hi: 40, bau: 30, sale: null, note: 'A test band' }, { k: 'units', scope: 'Everest', bau: 'off', sale: null, was: '> 5 units per size' }, { k: 'hero', bau: 'on', sale: null }], note: '', by: 'Analyst A', at: now - 86400000 },
    'e:Superdry|peak-test': { name: 'Peak sale (test)', from: '2026-11-20', to: '2026-12-01', mk: ['GB', 'DE'], sale: { st: 'planned' }, bau: { st: 'planned' }, note: '', by: 'Analyst A', at: now - 3600000 },
    // the record kept by hand: two invented entries, the newer one edited by someone else
    'r:Superdry|rec-20260914-hero-tst01': { d: '2026-09-14', mk: ['GB', 'DE'], k: 'hero', mode: 'bau', v: 'on', note: 'Hero sizes switched on (test)', by: 'Analyst A', at: now - 20 * 86400000 },
    'r:Superdry|rec-20261001-rc-tst02': { d: '2026-10-01', mk: ['GB'], k: 'rc', mode: 'bau', v: 35, was: 30, note: 'Line moved after the review (test)', by: 'Analyst A', at: now - 5 * 86400000, ed: { by: 'Analyst B', at: now - 4 * 86400000 } },
  };
  return { ok: true, store, brands: [{ client: 'Superdry', levers: 3, periods: 1 }], at: now };
}
// HERO SIZES (/api/rules/hero): a synthetic master pushed through the REAL census (docs/herosize_engine.js, reading rows
// with the Catalogue's own engine) and placed on a synthetic Google Shopping feed's product_type tree (treeIndex) — so the
// card meets size chips, hero crowns, both measures, every tier of the tree, a list set for a coarser tier reaching the
// types under it, a type matched by the master's own word, a master-only type, a document-sourced type, a hand-set type,
// an example-sourced type and an unmapped one. Invented product types, sizes and stock.
function heroBuild(now) {
  const E = require(path.join(__dirname, '..', 'docs', 'catalog_engine.js'));
  const H = require(path.join(__dirname, '..', 'docs', 'herosize_engine.js'));
  // the master, and — for the in-stock half of each style, as a real feed sends it — the feed's product_type path
  const master = [], feed = [];
  let id = 0;
  const style = (pt, g, sizes, n, seed, tree) => {
    for (let s = 0; s < n; s++) {
      const grp = pt.slice(0, 3).toUpperCase() + seed + '-' + s, path = typeof tree === 'function' ? tree(s) : tree;
      // every fourth style is out of the feed altogether — placed by where its master type's sent products sit
      const sent = path && s % 4 !== 3;
      sizes.forEach((z, j) => {
        const inStock = ((s * 7 + j * 3 + seed) % 10) < 7 - (j === 0 || j === sizes.length - 1 ? 2 : 0), pid = 'P' + (++id);
        master.push([pid, grp, pt + ' ' + s, g, pt, z, inStock ? 'in stock' : 'out of stock']);
        if (sent && inStock) feed.push([pid, grp, path]);
      });
    }
  };
  style('Dresses', 'womens', ['6', '8', '10', '12', '14', '16', '18'], 42, 1, (s) => 'Women > Clothing > Dresses > ' + (s % 2 ? 'Maxi Dresses' : 'Midi Dresses'));
  style('T-Shirts', 'mens', ['XS', 'S', 'M', 'L', 'XL', 'XXL'], 36, 2, (s) => 'Men > Clothing > T-Shirts > ' + (s % 3 ? 'Graphic T-Shirt' : 'Plain T-Shirt'));
  style('Jackets', 'womens', ['6', '8', '10', '12', '14', '16'], 24, 3, 'Women > Clothing > Jackets and Coats > Puffer Jacket');
  style('Trainers', 'womens', ['UK 3', 'UK 3.5', 'UK 4', 'UK 4.5', 'UK 5', 'UK 5.5', 'UK 6', 'UK 7'], 18, 4, 'Women > Shoes > Trainers');
  style('Coats', 'kids', ['3-4 years', '5-6 years', '7-8 years', '9-10 years'], 14, 5, 'Kids > Clothing > Coats');
  style('Jumpers', 'mens', ['S', 'M', 'L', 'XL'], 12, 6, 'Men > Clothing > Knitwear > Jumpers');
  // one type made in BOTH alpha and numeric runs (by different styles) — the card keeps each kind on its own line
  style('Tops', 'womens', ['XS', 'S', 'M', 'L', 'XL'], 10, 7, 'Women > Clothing > Tops');
  style('Tops', 'womens', ['6', '8', '10', '12', '14', '16', '18'], 12, 8, 'Women > Clothing > Tops');
  // a type the feed never sends — kept under its department, marked as the master's own word
  style('Bralettes', 'womens', ['XS', 'S', 'M', 'L'], 6, 9, '');
  for (let s = 0; s < 20; s++) { const pid = 'P' + (++id); master.push([pid, 'BAG-' + s, 'Bag ' + s, 'womens', 'Bags', 'One Size', 'in stock']); feed.push([pid, 'BAG-' + s, 'Women > Accessories > Bags']); }
  const ti = H.treeIndex(E);
  ti.onRow(null, ['g:id', 'g:item_group_id', 'g:product_type']);
  feed.forEach((r) => ti.onRow(r, ['g:id', 'g:item_group_id', 'g:product_type']));
  const c = H.census(E, ti.finish());
  c.onRow(null, ['id', 'item_group_id', 'title', 'gender', 'product_type', 'size', 'availability']);
  master.forEach((r) => c.onRow(r));
  const census = Object.assign({ client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', t: now - 5400000, imp: '2026-09-28 05:27:48' }, c.finish());
  const store = {
    'g:Superdry': { doc: { name: 'Superdry hero sizes 2026', url: 'https://example.com/superdry-hero-sizes' }, ex: 'fs-fashion-uk', from: '', note: '', by: 'Analyst A', at: now - 86400000 },
    // a document row in the brand's own words ("Women > Dresses") — it meets the feed's "… > Dresses" by its leaf
    'm:Superdry|women > dresses': { k: 'Women > Dresses', s: ['10', '12', '14'], src: 'doc', fw: 0, by: 'Analyst A', at: now - 86400000 },
    'm:Superdry|men > jumpers': { k: 'Men > Jumpers', s: ['M', 'L'], src: 'set', fw: 0, by: 'Analyst B', at: now - 3600000 },
    // a list set for a whole tier-2 branch — every men's clothing type that sets none of its own reads it
    'm:Superdry|men > clothing': { k: 'Men > Clothing', s: ['M', 'L', 'XL'], src: 'set', fw: 0, by: 'Analyst B', at: now - 7200000 },
    // the brand's own document as written (category × gender): a row reaching only PART of a type's run (alpha heroes on
    // tops sold mostly 6–18), a row whose sizes the type is not made in, a row naming no type here, FeedSpark's note
    'd:Superdry': { name: 'Superdry hero sizes', mk: ['GB'], by: 'FeedSpark · from a test table', at: now - 3600000, rows: [
      { c: 'Tops', g: 'Female', s: ['S', 'M', 'L'], n: 'Numeric tops (6–18) too — which sizes are the heroes?' },
      { c: 'Bralettes', g: 'Female', s: ['32B', '34B'], n: '' },
      { c: 'Swimwear', g: 'Female', s: ['S', 'M', 'L'], n: '' }] },
  };
  const sum = { t: census.t, types: census.types.length, sized: census.sized, rows: census.rows, groups: census.groups, v: census.v };
  return { ok: true, v: H.CENSUS_V, store, at: now, auto: true,
    brands: [{ client: 'Reiss', doc: false, ex: '', from: '', own: 0, fromDoc: 0, census: false }, { client: 'Superdry', doc: true, ex: 'fs-fashion-uk', from: '', own: 3, fromDoc: 1, census: true }],
    brand: 'Superdry', market: 'GB', cmpid: 'superdry_gb', census,
    markets: [{ market: 'GB', cmpid: 'superdry_gb', census: sum }, { market: 'DE', cmpid: 'superdry_de', census: null }, { market: 'FR', cmpid: 'superdry_fr', census: null }] };
}
// the fetch-stub lines the tripwires splice into their STUB string (url + j() are theirs)
function stubLines() {
  const d = build();
  const engine = JSON.stringify(fs.readFileSync(path.join(__dirname, '..', 'docs', 'herosize_engine.js'), 'utf8'));
  const lengine = JSON.stringify(fs.readFileSync(path.join(__dirname, '..', 'docs', 'stocklevers_engine.js'), 'utf8'));
  return " if(url.indexOf('/stock/levers.js')>=0)return Promise.resolve(new Response(" + lengine + ",{status:200,headers:{'content-type':'application/javascript'}}));\n"
    + " if(url.indexOf('/api/rules/levers')>=0)return j(" + JSON.stringify(d.levers) + ");\n"
    + " if(url.indexOf('/stock/engine.js')>=0)return Promise.resolve(new Response(" + engine + ",{status:200,headers:{'content-type':'application/javascript'}}));\n"
    + " if(url.indexOf('/api/rules/hero')>=0)return j(" + JSON.stringify(d.hero) + ");\n"
    + " if(url.indexOf('/api/rules/stock')>=0)return j(" + JSON.stringify(d.stock) + ");\n"
    + " if(url.indexOf('/api/rules?client=')>=0)return j(" + JSON.stringify(d.market) + ");\n"
    + " if(url.indexOf('/api/rules?pull')>=0)return j({ok:true,status:" + JSON.stringify(d.book.status) + "});\n"
    + " if(url.indexOf('/api/rules')>=0)return j(" + JSON.stringify(d.book) + ");\n";
}
module.exports = { build, stubLines, engine, rows };
