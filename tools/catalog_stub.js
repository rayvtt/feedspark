// A small SYNTHETIC catalogue for the browser tripwires (check_mobile.js, check_darkmode.js,
// check_catalog.js): a FeedHero-shaped output feed, the client's master file it was built from, and
// FeedHero's Google Ads read for the same market — so /catalog renders its KPI band, the three
// insight cards, the virtual table, the lineage matrix and the inspector instead of its "not read
// yet" states. Nothing here is a client's product: the brand ("Northwind") is invented, the paths
// generic, the figures made up. The real shapes are asserted in tools/test_catalog.mjs.
//
// The lines stubLines() returns only answer on the Catalogue page (a guard on the file name), so the
// engines it hands over (/feedlab, /catalog, /volume, /overlays engine.js) never change what another
// page meets under the same tripwire.
'use strict';
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
const CLIENT = 'Northwind', MKT = 'gb', CMPID = 'northwind_gb';
const PATHS = ['Womens > Clothing > Dresses > Midi Dresses', 'Womens > Clothing > Dresses > Maxi Dresses', 'Womens > Clothing > Knitwear > Jumpers',
  'Womens > Accessories > Bags > Totes', 'Womens > Accessories > Scarves', 'Mens > Clothing > Shirts', 'Mens > Clothing > Knitwear > Cardigans',
  'Home > Cushions'];
const DROPPED = 'Mens > Clothing > Knitwear > Cardigans';
const COLOURS = ['Navy', 'Black', 'Ivory', 'Sage', 'Rust', 'Grey'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const NOW = Date.UTC(2026, 8, 28, 9);
function products() {
  const out = [];
  for (let i = 0; i < 26; i++) {
    const pt = PATHS[i % PATHS.length], leaf = pt.split(' > ').pop().replace(/s$/, ''), col = COLOURS[i % COLOURS.length];
    const grp = 'NW' + (100 + Math.floor(i / 2)), price = 20 + (i % 7) * 12, sale = i % 5 === 0 ? price - 8 : null;
    out.push({
      id: grp + '-' + (i % 2 ? 'L' : 'M'), oid: 'M-' + grp + '-' + (i % 2 ? 'L' : 'M'), grp, pt, col, price, sale,
      title: 'Northwind ' + col + ' ' + leaf + (i % 3 ? ', Size ' + (i % 2 ? 'L' : 'M') : ''), otitle: leaf + ' ' + col.toUpperCase(),
      dob: iso(NOW - (3 + i * 23) * 86400000), stock: i % 9 === 4 ? 'out of stock' : 'in stock',
      img: 'https://img.northwind.invalid/' + grp + '.jpg', kw: i % 4 === 0, overlay: i % 6 === 1,
    });
  }
  return out;
}
function outputXml() {
  const items = products().map((p, i) => {
    const img = p.overlay ? 'https://lia.feedspark.com/feedspark-meta-dynamic-v2/meta_catelog_call.php?template_hash=t1&amp;img_url=' + p.img : p.img;
    return '<item>\n<g:id>' + p.id + '</g:id>\n<title>' + esc(p.title) + '</title>\n<description>' + esc('A ' + p.col.toLowerCase() + ' piece from the synthetic Northwind range, made for the catalogue tripwires.') + '</description>\n'
      + '<link>https://shop.northwind.invalid/p/' + p.grp.toLowerCase() + '</link>\n<g:image_link>' + img + '</g:image_link>\n'
      + '<g:additional_image_link>https://img.northwind.invalid/' + p.grp + '-2.jpg</g:additional_image_link>\n'
      + (i % 3 === 0 ? '<g:additional_image_link>https://img.northwind.invalid/' + p.grp + '-3.jpg</g:additional_image_link>\n' : '')
      + '<g:availability>' + p.stock + '</g:availability>\n<g:price>' + p.price.toFixed(2) + ' GBP</g:price>\n'
      + (p.sale ? '<g:sale_price>' + p.sale.toFixed(2) + ' GBP</g:sale_price>\n' : '')
      + '<g:brand>Northwind</g:brand>\n<g:condition>new</g:condition>\n<g:google_product_category>Apparel &amp; Accessories &gt; Clothing</g:google_product_category>\n'
      + '<g:product_type>' + esc(p.pt) + '</g:product_type>\n' + (p.kw ? '<g:product_type>' + esc(p.col.toLowerCase() + ' ' + p.pt.split(' > ').pop().toLowerCase()) + '</g:product_type>\n' : '')
      + '<g:color>' + p.col + '</g:color>\n<g:size>' + (i % 2 ? 'L' : 'M') + '</g:size>\n<g:gender>' + (/^Mens/.test(p.pt) ? 'male' : 'female') + '</g:gender>\n<g:age_group>adult</g:age_group>\n'
      + '<g:item_group_id>' + p.grp + '</g:item_group_id>\n' + (i % 2 ? '<g:product_highlight>Soft handle</g:product_highlight>\n<g:product_highlight>Easy care</g:product_highlight>\n' : '')
      + '<g:custom_label_0>' + (i % 4 ? 'Core' : 'New In') + '</g:custom_label_0>\n' + (i % 5 === 2 ? '<g:custom_label_1>Clearance</g:custom_label_1>\n' : '')
      + '<c:fs_data_opti type="string">T:' + (i % 3 ? 'Y' : 'N') + '|Cat:Y|Keywords:' + (p.kw ? 'Y' : 'N') + '|D:N|IMG:' + (p.overlay ? 'Y' : 'N') + '|ID:N</c:fs_data_opti>\n'
      + '<c:fs_data_original_title type="string">' + esc(p.otitle) + '</c:fs_data_original_title>\n<c:fs_data_original_id type="string">' + p.oid + '</c:fs_data_original_id>\n'
      + '<c:fs_date_of_birth type="string">' + p.dob + '</c:fs_date_of_birth>\n</item>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss xmlns:g="http://base.google.com/ns/1.0" xmlns:c="http://base.google.com/cns/1.0" version="2.0"><channel><title>Northwind (synthetic)</title>\n' + items.join('\n') + '\n</channel></rss>';
}
function masterCsv() {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const rows = [['id', 'product_id', 'title', 'price', 'was_price', 'description', 'vendor', 'colour', 'product_type', 'image_link', 'availability', 'composition']];
  products().forEach((p, i) => rows.push([p.oid, p.grp, p.otitle, '£' + (p.sale || p.price).toFixed(2), p.sale ? '£' + p.price.toFixed(2) : '', '<p>A ' + p.col.toLowerCase() + ' piece.</p>', 'Northwind',
    p.col + ' (' + p.col.slice(0, 3).toUpperCase() + ')', p.pt.split(' > ').pop(), p.img, i % 9 === 4 ? 'OUT_OF_STOCK' : 'IN_STOCK', i % 2 ? 'Cotton 100%' : '']));
  ['Linen Shirt', 'Wool Beanie', 'Canvas Belt', 'Silk Scarf'].forEach((t, i) => rows.push(['M-OLD-' + i, 'OLD' + i, t, '£' + (15 + i * 5) + '.00', '', '', 'Northwind', '', 'Archive', 'https://img.northwind.invalid/old' + i + '.jpg', 'OUT_OF_STOCK', '']));
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}
// FeedHero's category tree for the market: a row per level, ONE path left out on purpose so the "not in
// the ROAS tree yet" state renders (a product re-typed since Google Ads was read). The path left out
// keeps an ancestor in the tree ("Mens > Clothing"), so a nearest-ancestor fallback would show up.
function roasRead() {
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const row = (cat, skus) => { const spend = 40 + rnd() * 2400, pct = 150 + rnd() * 1300; return { cmpid: CMPID, category: cat, skus, zombiePct: Math.round(rnd() * 40), impr: Math.round(spend * 90), clicks: Math.round(spend * 2.2), conv: Math.round(spend / 30), revenue: { n: spend * pct / 100, cur: 'GBP' }, spend: { n: spend, cur: 'GBP' }, roasPct: pct, band: pct >= 400 ? 'Strong' : 'Steady' }; };
  const counts = {};
  PATHS.filter((p) => p !== DROPPED).forEach((p) => { const parts = p.split(' > '); for (let d = 1; d <= parts.length; d++) { const k = parts.slice(0, d).join(' > '); counts[k] = (counts[k] || 0) + 4; } });
  const nodes = {}; Object.keys(counts).forEach((k) => { nodes[k] = { name: k.split(' > ').pop(), path: k, depth: k.split(' > ').length, row: row(k, counts[k]), kids: [] }; });
  const roots = []; Object.keys(nodes).forEach((k) => { const parts = k.split(' > '); const par = parts.length > 1 ? nodes[parts.slice(0, -1).join(' > ')] : null; if (par) par.kids.push(nodes[k]); else roots.push(nodes[k]); });
  const total = row('Total', 40); total.roasPct = 612; total.band = 'Strong';
  const cuts = {
    Product_age: ['Brand new', 'New', 'This season', 'Last season', 'This year', 'Perennial'], Price_type: ['Products on Sale', 'Products at Full Price'],
    Title_optimisation_status: ['Optimized', 'Non Optimized'], Keyword_optimisation_status: ['Optimized', 'Non Optimized'],
    Data_field_optimisation_status: ['Not reviewed', 'QC Passed'], Brand: ['Northwind'], Colour: COLOURS, Gender: ['female', 'male'], Age_group: ['adult'],
    Google_product_category: ['Apparel & Accessories > Clothing', 'apparel & accessories > clothing', 'Home & Garden > Decor'],
    Custom_label_0: ['New In', 'Core'], Custom_label_1: ['Unsorted'], Custom_label_2: ['Unsorted'], Custom_label_3: ['Unsorted'], Custom_label_4: ['Unsorted'],
    // price bands as a price range each, listed out of price order on purpose (the card draws them in price order);
    // last in the list so every cut above keeps the random draws it always had
    Price_group: ['£50 - £75', '£0 - £25', '£75+', '£25 - £50'],
  };
  const live = {};
  Object.keys(cuts).forEach((agg) => { live[agg] = { ok: true, cached: true, cmpid: CMPID, agg, win: 'w30', total, rows: cuts[agg].map((c) => row(c, 6 + Math.round(rnd() * 20))).concat([row('Unlisted SKUs in Ads traffic', 9)]) }; });
  return { market: { ok: true, client: CLIENT, market: 'GB', cmpid: CMPID, win: 'w30', read: true, total, tree: roots, n: Object.keys(counts).length, updated: NOW, hist: [] }, live };
}
function build() {
  const xml = outputXml(), csv = masterCsv(), r = roasRead();
  const roster = { ok: true, clients: { [CLIENT]: [{ mkt: MKT, channel: 'google', kind: 'xml', cmpid: CMPID, roas: { client: CLIENT, market: 'GB' } },
    { mkt: 'gb-fb', channel: 'meta', kind: 'xml', cmpid: CMPID, roas: null }] } };
  const info = { ok: true, state: 'ok', cmpid: CMPID, name: 'Northwind GB (synthetic)', rows: 30, lastImport: '2026-09-28 08:00:00', importStatus: 'Completed', file: 'northwind_gb_master.csv',
    web: 'https://mcp.feedhero.net/master-feed?company=' + CMPID, headers: [], hasFile: true };
  const row = { ok: true, rows: [{ id: 'M-NW100-M', title: 'Midi Dresse NAVY', price: '£28.00', colour: 'Navy (NAV)' }] };
  // Stock management's read of the same market (GET /api/rules/stock?brand=), pushed through the REAL rules engine
  // off rules_stub's synthetic rule list, with the market's Google Ads price for a click off the ROAS total above
  const RS = require('./rules_stub.js'), RE = RS.engine(), now = Date.UTC(2026, 8, 28, 9);
  const mk = { client: CLIENT, market: 'GB', cmpid: CMPID, of: 30, seed: 1 };
  const idx = RE.idxEntry(mk, RE.normRules(RS.rows(CMPID, 'Northwind GB', 30, 1)), {}, now);
  const stock = { ok: true, tracked: 1, roster: 1, unread: [], mechanisms: RE.MECHANISMS, channels: RE.CHANNELS, sev: RE.SEV,
    sv: { scenarios: RE.SV_SCENARIOS, days: RE.SV_WINDOW_DAYS },
    markets: [RE.stockView(idx, { w30: { spend: { cur: 'GBP', n: 1200 }, clicks: 4800, skus: 30, impr: 260000 }, updated: now })] };
  // Google Ads per product, last 7 days (the worker's /api/catalog/ads shape): every third product served, one keyed
  // in LOWER case (Google lower-cases the Ads item id that stands in for a blank pid), one with impressions but no
  // clicks (its rates are blank, never 0%), and one product the feed no longer carries — all synthetic
  const adsRows = {};
  products().forEach((pr, i) => {
    if (i % 3) return;
    const impr = 120 + i * 37, clicks = i === 3 ? 0 : 2 + (i % 7), cost = Math.round(clicks * (0.18 + (i % 4) * 0.07) * 100) / 100;
    const conv = i % 2 ? 0 : Math.round(clicks * 0.3 * 100) / 100, value = Math.round(conv * pr.price * 100) / 100;
    adsRows[i === 6 ? pr.id.toLowerCase() : pr.id] = [impr, clicks, cost, conv, value];
  });
  adsRows['NW-GONE-1'] = [900, 30, 9.5, 2, 120];
  const ads = { ok: true, done: true, cmpid: CMPID, period: '7_days', from: '2026-09-22', to: '2026-09-28', range: 'Last 7 Days (22/09/2026 - 28/09/2026)',
    total: Object.keys(adsRows).length, pages: 2, next: 3, got: Object.keys(adsRows).length, cur: 'GBP', curMix: false, at: now, rows: adsRows };
  return { xml, csv, roster, info, row, market: r.market, live: r.live, stock, ads };
}
// the fetch-stub lines the tripwires splice into their STUB string (url + j() are theirs); every line
// sits behind the Catalogue guard so no other page is served an engine or a feed it never asked for
function stubLines() {
  const d = build();
  const src = (f) => JSON.stringify(fs.readFileSync(path.join(D, f), 'utf8'));
  const txt = (body, type, extra) => 'return Promise.resolve(new Response(' + body + ',{status:200,headers:Object.assign({"content-type":"' + type + '"},' + JSON.stringify(extra || {}) + ')}));';
  return " if(/Catalog/.test(location.pathname)){\n"
    + "  if(url.indexOf('/catalog/engine.js')>=0)" + txt(src('catalog_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/feedlab/engine.js')>=0)" + txt(src('feedlab_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/volume/engine.js')>=0)" + txt(src('arrivals_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/overlays/engine.js')>=0)" + txt(src('overlay_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/api/catalog/roster')>=0)return j(" + JSON.stringify(d.roster) + ");\n"
    + "  if(url.indexOf('/api/feed/proxy')>=0)" + txt(JSON.stringify(d.xml), 'application/xml', { 'x-feed-bytes': String(Buffer.byteLength(d.xml)) }) + "\n"
    + "  if(url.indexOf('/api/catalog/master/file')>=0)" + txt(JSON.stringify(d.csv), 'text/csv', { 'x-feed-bytes': String(Buffer.byteLength(d.csv)) }) + "\n"
    + "  if(url.indexOf('/api/catalog/master/row')>=0)return j(" + JSON.stringify(d.row) + ");\n"
    + "  if(url.indexOf('/api/catalog/master')>=0)return j(" + JSON.stringify(d.info) + ");\n"
    + "  if(url.indexOf('/api/roas/live')>=0){var ag=(url.match(/[?&]agg=([^&]+)/)||[])[1];var L=" + JSON.stringify(d.live) + ";return j(L[decodeURIComponent(ag||'')]||{ok:false,error:'stub'});}\n"
    + "  if(url.indexOf('/api/rules/stock')>=0)return j(" + JSON.stringify(d.stock) + ");\n"
    // the read arrives in two calls — the first a chunk (done:false), the page calls again for the rest
    + "  if(url.indexOf('/api/catalog/ads')>=0){window.__adsCalls=(window.__adsCalls||0)+1;if(window.__adsCalls===1)return j({ok:true,done:false,cmpid:" + JSON.stringify(d.ads.cmpid) + ",got:3,total:" + d.ads.total + ",pages:2,next:2});return j(" + JSON.stringify(d.ads) + ");}\n"
    + "  if(url.indexOf('/api/roas?client=')>=0)return j(" + JSON.stringify(d.market) + ");\n"
    + " }\n";
}
module.exports = { build, stubLines, CLIENT, MKT, CMPID, DROPPED };
