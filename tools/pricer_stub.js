// A small SYNTHETIC book for the browser tripwires (check_mobile.js, check_darkmode.js, check_pricer.js): the
// Golden Record stores for two invented brands ("Northwind", "Thornfield"), a content-quality reading, product-type
// depth, first-seen dates, a Northwind output feed the live audit streams, the six /api/pricer/* stores and the
// legacy rate card — so /pricer renders its audit stepper, the tier cards, the debrief kit, the rollout and the rate
// card instead of its "pick a client" states. Nothing here is a client's product or a real price: the brands are
// invented, the figures made up, every rate is the engine's own draft default. The engine's shapes are asserted in
// tools/test_pricer.mjs; the worker's in tools/test_pricerstore.mjs.
//
// The lines stubLines() returns only answer on the Pricer page (a guard on the file name), so the engines they hand
// over never change what another page meets under the same tripwire. The Northwind GB feed lands after `delay` ms,
// so check_pricer.js sees the STORED first paint (estimates, bound chips) before the live read turns the needs exact; the
// DE feed is refused (404), so the page shows its failed state, the typed-parents input and an unsized line's fix.
'use strict';
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
const NOW = Date.UTC(2026, 9, 6, 9);
const DAY = 864e5;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ym = (t) => new Date(t).toISOString().slice(0, 7);
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// twelve parent products, two sizes each — every kind of gap the package prices, in known amounts
const PARENTS = [
  { pt: 'Womens > Dresses > Midi Dresses', gpc: 'Apparel & Accessories > Clothing > Dresses', t: 'Northwind Navy Linen Midi Dress', col: 'Navy', mat: 'Linen', hl: 2, kw: 'linen midi dress > navy midi dress' },
  { pt: 'Womens > Dresses', gpc: 'Apparel & Accessories > Clothing', t: 'NORTHWIND RUST WRAP DRESS', col: 'Rust', hl: 0, kw: '' },
  { pt: 'Womens > Knitwear > Jumpers', gpc: 'Apparel & Accessories > Clothing > Shirts & Tops', t: 'Northwind Sage Cable Knit Jumper', col: 'Sage', mat: 'Wool', hl: 4, kw: 'cable knit jumper' },
  { pt: 'Womens > Knitwear', gpc: 'Apparel & Accessories > Clothing', t: 'Jumper', col: '', hl: 1, kw: '' },
  { pt: 'Mens > Shirts > Oxford Shirts', gpc: 'Apparel & Accessories > Clothing > Shirts & Tops', t: 'Northwind Ivory Oxford Shirt, Slim Fit, Cotton', col: 'Ivory', hl: 6, kw: 'oxford shirt > slim fit shirt' },
  { pt: 'Mens > Shirts', gpc: '', t: 'SALE Northwind Grey Flannel Shirt', col: 'Grey', hl: 2, kw: '' },
  { pt: 'Mens > Knitwear > Cardigans', gpc: 'Apparel & Accessories > Clothing > Shirts & Tops', t: 'Northwind Black Merino Cardigan', col: 'Black', hl: 3, kw: '9f3c2a1b7e6d5c4b3a291807f6e5d4c3' },
  { pt: 'Mens > Outerwear', gpc: 'Apparel & Accessories > Clothing > Outerwear', t: 'Northwind Navy Waxed Field Jacket', col: '', hl: 2, kw: 'waxed jacket' },
  { pt: 'Accessories > Scarves', gpc: 'Apparel & Accessories > Clothing Accessories > Scarves & Shawls', t: 'Northwind Rust Wool Scarf', col: 'Rust', mat: 'Wool', hl: 0, kw: '' },
  { pt: 'Accessories > Bags > Totes', gpc: 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags', t: 'Northwind Canvas Tote', col: 'Sage', hl: 2, kw: '' },
  { pt: 'Home > Cushions', gpc: 'Home & Garden > Decor > Throw Pillows', t: 'Northwind Linen Cushion Cover', col: 'Ivory', hl: 1, kw: '' },
  { pt: 'Home > Throws', gpc: 'Home & Garden > Linens & Bedding > Bedding > Blankets', t: 'Northwind Wool Throw', col: '', hl: 0, kw: '' },
];
const LONG = 'Cut from a soft, breathable weave for everyday wear, this piece from the synthetic Northwind range is made for the browser tripwires and nothing else. It layers easily, washes at thirty degrees and keeps its shape through the season. Pair it with the rest of the range for a considered, easy look. The fit is true to size with room through the body, and the finish is clean and simple. ';
function feedXml() {
  const items = [];
  PARENTS.forEach((p, g) => {
    ['M', 'L'].forEach((sz, k) => {
      const i = g * 2 + k, grp = 'NW' + (200 + g), id = grp + '-' + sz;
      const desc = g % 4 === 3 ? '' : g % 3 === 1 ? 'A ' + p.col.toLowerCase() + ' piece.' : LONG + (g % 2 ? '' : LONG);
      const hls = []; for (let h = 0; h < p.hl; h++) hls.push('<g:product_highlight>' + ['Soft handle', 'Easy care', 'Breathable weave', 'True to size', 'Machine washable', 'Responsibly made'][h] + '</g:product_highlight>');
      items.push('<item>\n<g:id>' + id + '</g:id>\n<title>' + esc(p.t + (k ? ', Size ' + sz : '')) + '</title>\n<description>' + esc(desc) + '</description>\n'
        + '<link>https://shop.northwind.invalid/p/' + grp.toLowerCase() + '</link>\n<g:image_link>https://img.northwind.invalid/' + grp + '.jpg</g:image_link>\n'
        + '<g:availability>in stock</g:availability>\n<g:price>' + (25 + g * 7) + '.00 GBP</g:price>\n<g:brand>Northwind</g:brand>\n'
        + (g % 3 ? '<g:gtin>50000000' + String(1000 + i) + '</g:gtin>\n' : '')
        + '<g:google_product_category>' + esc(p.gpc) + '</g:google_product_category>\n<g:product_type>' + esc(p.pt) + '</g:product_type>\n'
        + (p.kw ? '<g:product_type>' + esc(p.kw) + '</g:product_type>\n' : '')
        + (p.col ? '<g:color>' + p.col + '</g:color>\n' : '') + (p.mat ? '<g:material>' + p.mat + '</g:material>\n' : '')
        + '<g:size>' + sz + '</g:size>\n<g:gender>' + (/^Mens/.test(p.pt) ? 'male' : 'female') + '</g:gender>\n<g:age_group>adult</g:age_group>\n'
        + '<g:item_group_id>' + grp + '</g:item_group_id>\n' + (hls.length ? hls.join('\n') + '\n' : '')
        + '<c:fs_date_of_birth type="string">' + iso(NOW - (12 + g * 31) * DAY) + '</c:fs_date_of_birth>\n</item>');
    });
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss xmlns:g="http://base.google.com/ns/1.0" xmlns:c="http://base.google.com/cns/1.0" version="2.0"><channel><title>Northwind (synthetic)</title>\n'
    + items.join('\n') + '\n</channel></rss>';
}
// the Golden Record estate as goldenidx serves it — percentages, a GPC-scoped in-scope count map, the headlines
const COV_NW = { id: 100, title: 100, description: 83.3, link: 100, image_link: 100, availability: 100, price: 100, brand: 100, gtin: 66.7, mpn: null,
  condition: null, item_group_id: 100, color: 75, size: 100, gender: 100, age_group: 100, google_product_category: 91.7, product_type: 100, keywords: 41.7,
  sale_price: null, additional_image_link: null, product_highlight: 75, product_detail: null, material: 15, pattern: null, size_type: null, size_system: null,
  question_and_answer: null, document_link: null, related_product: null, item_group_title: null, variant_option: null, popularity_rank: null };
function estate() {
  const de = Object.assign({}, COV_NW, { description: 88.9, gtin: 50, color: 72.2, product_highlight: 61.1 }); delete de.keywords;   // keyword slots not read on this scan
  const th = Object.assign({}, COV_NW, { description: 97.5, color: 92.5, material: 40, product_highlight: 90, keywords: 70, gtin: 100 });
  return {
    'Northwind|gb': { client: 'Northwind', mkt: 'gb', t: NOW - 3 * 3600e3, rows: 24, score: 84.1, ind: 'Retail', status: 'ok', cov: COV_NW,
      sc: { color: 20, gender: 20, age_group: 20, size: 20, material: 20, pattern: 20 }, air: 58.4, airTier: 2, ai: { n: 0, of: 6, missing: [] }, q: 71.2, qFails: 9 },
    'Northwind|de': { client: 'Northwind', mkt: 'de', t: NOW - 26 * 3600e3, rows: 18, score: 80.3, ind: 'Retail', status: 'ok', cov: de, air: null },
    'Thornfield|gb': { client: 'Thornfield', mkt: 'gb', t: NOW - 5 * 3600e3, rows: 40, score: 91.2, ind: 'Retail', status: 'ok', cov: th, air: 66.1, airTier: 2, ai: { n: 1, of: 6, missing: [] } },
    'Thornfield|us': { client: 'Thornfield', mkt: 'us', status: 'never' },
  };
}
function quality() {
  const eg = (a) => a;
  return { t: NOW - 20 * 3600e3, client: 'Northwind', market: 'gb', rows: 24, kind: 'a', attrs: {
    title: { filled: 24, cov: 100, avgLen: 36, rules: { caps: { n: 2, pct: 8.3, eg: eg(['NORTHWIND RUST WRAP DRESS']) }, promo: { n: 2, pct: 8.3, eg: ['SALE Northwind Grey Flannel Shirt'] },
      thin: { n: 2, pct: 8.3, eg: ['Jumper'] }, short: { n: 18, pct: 75, eg: ['Northwind Canvas Tote', 'Northwind Wool Throw'] }, 'no-brand': { n: 2, pct: 8.3, eg: ['Jumper'] } } },
    description: { filled: 20, cov: 83.3, avgLen: 420, rules: { thin: { n: 6, pct: 30, eg: ['A rust piece.', 'A sage piece.'] } } },
    google_product_category: { filled: 22, cov: 91.7, avgDepth: 2.8, rules: { shallow: { n: 4, pct: 18.2, eg: ['Apparel & Accessories > Clothing'] } } },
    product_type: { filled: 24, cov: 100, avgDepth: 2.6, rules: {} },
    product_highlight: { filled: 18, cov: 75, rules: { 'count-min': { n: 4, pct: 22.2, eg: ['Easy care'] }, 'count-low': { n: 4, pct: 22.2, eg: [] } }, hlDist: { 1: 22.2, 2: 44.4, 3: 11.1, 4: 11.1, 5: 0, '6+': 11.1 } },
    color: { filled: 18, cov: 75, rules: { 'not-colour': { n: 1, pct: 5.6, eg: ['Multi'] }, hex: { n: 1, pct: 5.6, eg: ['#1A365D'] } } },
    material: { filled: 6, cov: 25, rules: {} },
  }, ai: { total: 58.4, tier: 2, tierLabel: 'Enriched', pillars: [] } };
}
function stores(opts) {
  opts = opts || {};
  // one saved proposal per brand: Northwind's still guarded (draft rates), Thornfield's chosen and client-safe
  const opt = (ref, client, n, label, option, one, mon, safe, extra) => Object.assign({ ref, client, markets: ['gb'], t: NOW - 2 * DAY, by: 'Ray',
    prop: { id: client === 'Northwind' ? 'ppnorth01' : 'ppthorn01', n, label }, option, pkgVersion: '', audit: {}, rates: {}, opts: {}, aimSources: {},
    pq: { label, option, oneOff: { total: one }, monthly: { total: mon }, lines: [], perMarket: [] }, clientSafe: safe,
    blockers: safe ? [] : [{ code: 'draft-unit', why: 'Title optimisation: the unit price is still a draft — Management' }], hist: [{ s: 'Saved', t: NOW - 2 * DAY, by: 'Ray' }] }, extra || {});
  return {
    ops: {}, cost: {}, roadmap: {},
    // Management's test-package prices when a run asks for them (else the engine's DRAFT defaults apply)
    price: Object.keys(opts.testPrices || {}).reduce((m, n) => { m['_g|test' + n] = { v: opts.testPrices[n], by: 'Ray', at: NOW - DAY }; return m; }, {}),
    proposals: {
      onorth00001: opt('SVC100001', 'Northwind', 1, 'Tier 1 · Google-ready', 'go', 1840.5, 120, false),
      othorn00001: opt('SVC200001', 'Thornfield', 1, 'Tier 1 · Google-ready', 'go', 2210, 150, true, { chosen: { t: NOW - DAY, by: 'Ray' }, sentAt: { t: NOW - 2 * DAY, by: 'Ray', via: 'manual' } }),
      othorn00002: opt('SVC200001-2', 'Thornfield', 2, 'Tier 2 · AI-ready', 'go+ar', 4120, 260, true, { sentAt: { t: NOW - 2 * DAY, by: 'Ray', via: 'manual' } }),
    },
    rollout: { Thornfield: { debriefAt: { t: NOW - 6 * DAY, by: 'Ray' }, next: 'Confirm Tier 1 start date', nextDue: '2026-10-01', am: 'Ray' } },
  };
}
function build(opts) {
  const xml = feedXml(), m = {};
  for (let k = 0; k < 14; k++) { const key = ym(NOW - k * 30 * DAY); m[key] = (m[key] || 0) + (k % 3) + 1; }
  return {
    xml,
    estate: estate(),
    ptypes: { 'Northwind|gb': { client: 'Northwind', mkt: 'gb', t: NOW - 3 * 3600e3, depth: { pct: { 1: 0, 2: 41.7, 3: 50, 4: 8.3, 5: 0, '6+': 0 }, avg: 2.7, skus: 24 } },
      'Thornfield|gb': { client: 'Thornfield', mkt: 'gb', t: NOW - 5 * 3600e3, depth: { pct: { 1: 0, 2: 10, 3: 60, 4: 30, 5: 0, '6+': 0 }, avg: 3.2, skus: 40 } } },
    arrivals: { field: 'fs_date_of_birth', feeds: [{ client: 'Northwind', mkt: 'gb', kind: 'xml', dob: { t: NOW - 3 * 3600e3, rows: 24, n: 24, bad: 0, m, min: '2025-08-01', max: iso(NOW) } },
      { client: 'Northwind', mkt: 'de', kind: 'xml' }, { client: 'Thornfield', mkt: 'gb', kind: 'xml' }] },
    quality: { 'Northwind|gb': quality() },
    markets: { Northwind: { gb: { rows: 24 }, de: { rows: 18 }, 'gb-fb': { rows: 24 } }, Thornfield: { gb: { rows: 40 }, us: null } },
    hours: { Northwind: { tracked: true, allowance: 20, used: 12.5, balance: 7.5, health: 'healthy', am: 'Steven', amEmail: 'steven@feedspark.com' },
      Thornfield: { tracked: true, allowance: 30, used: 34, balance: -4, health: 'negative', am: 'Ray', amEmail: 'ray@feedspark.com' } },
    sched: [{ client: 'Northwind', mkt: 'gb', kind: 'kw', skips: 3, goes: 2, streak: 2, skipRate: 60 }, { client: 'Northwind', mkt: 'gb', kind: 'titles', skips: 0, goes: 4, streak: 0, skipRate: 0 },
      { client: 'Thornfield', mkt: 'gb', kind: 'kw', skips: 1, goes: 5, streak: 0, skipRate: 17 }],
    // a Greenlit AI Quote with a monthly new-products bundle: Thornfield GB's new products are already covered (overlap)
    aiqsaved: { qthorn01: { client: 'Thornfield', mkt: 'gb', t: NOW - 40 * DAY, ref: 'QT260101', stage: 'Greenlight', lines: [{ id: 'keywords' }], upd: { gbp: 100, band: 'up to 1,000' } } },
    stores: stores(opts),
  };
}
// opts: { delay (ms before the GB feed lands — 0 by default; check_pricer.js holds it back to see the stored paint), me ({email, owner, modules, name}: answer /api/access on this page),
//         costDenied (the cost store answers 403), testPrices ({2:£,3:£,4:£} — Management-set test packages),
//         emptyFeed (the Northwind GB feed answers with no products), full (the proposals store answers 413 "store is full", as the worker does past 20 MB) }
// The /api/pricer/* stores behave like the worker's (pricerstore.js): a PUT sends X-Sync-Base, and a key whose stored
// value was stamped AFTER that base and differs from what the page sent is KEPT and listed in _rejected ('changed by …
// since you loaded'); every accepted key is stamped (cells {by,at}, proposals/rollout lu {by,at}); a scoped signin's
// proposal for a client outside its scope is refused. window.__pzS holds the stores — a harness simulates a colleague
// by writing a key there with a later `at`.
function stubLines(opts) {
  opts = opts || {};
  const d = build(opts);
  const src = (f) => JSON.stringify(fs.readFileSync(path.join(D, f), 'utf8'));
  const js = (f) => 'return Promise.resolve(new Response(' + src(f) + ',{status:200,headers:{"content-type":"application/javascript"}}));';
  const delay = opts.delay == null ? 0 : +opts.delay;   // the tripwires that snapshot twice (desktop, phone) meet the same settled page
  return " if(/Pricer/.test(location.pathname)){\n"
    + "  if(url.indexOf('/pricer/engine.js')>=0)" + js('pricer_engine.js') + "\n"
    + "  if(url.indexOf('/feedlab/engine.js')>=0)" + js('feedlab_engine.js') + "\n"
    + "  if(url.indexOf('/volume/engine.js')>=0)" + js('arrivals_engine.js') + "\n"
    + "  if(url.indexOf('/catalog/engine.js')>=0)" + js('catalog_engine.js') + "\n"
    + "  if(url.indexOf('/labels/engine.js')>=0)" + js('labelguard_engine.js') + "\n"
    + (opts.me ? "  if(url.indexOf('/api/access')>=0)return j(" + JSON.stringify(Object.assign({ ok: true, clients: null }, opts.me)) + ");\n" : '')
    + "  var qs=function(k){var m=new RegExp('[?&]'+k+'=([^&]*)').exec(url);return m?decodeURIComponent(m[1].replace(/\\+/g,' ')):''};\n"
    + "  if(url.indexOf('/api/clients')>=0)return j({Northwind:{},Thornfield:{}});\n"
    + "  if(url.indexOf('/api/golden/estate')>=0)return j({feeds:" + JSON.stringify(d.estate) + ",alerts:{},daily:null});\n"
    + "  if(url.indexOf('/api/golden/quality')>=0){var Q=" + JSON.stringify(d.quality) + ";return j({quality:Q[qs('client')+'|'+qs('market')]||null});}\n"
    + "  if(url.indexOf('/api/golden/pdp')>=0)return j({sample:null});\n"
    + "  if(url.indexOf('/api/golden/profile')>=0)return j({defaults:{},overrides:{clients:{Northwind:{expected:['color','size','gender','age_group','item_group_id']}}},industryMap:{}});\n"
    + "  if(url.indexOf('/api/ptypes/estate')>=0)return j({feeds:" + JSON.stringify(d.ptypes) + ",alerts:{}});\n"
    + "  if(url.indexOf('/api/volume/arrivals')>=0)return j(" + JSON.stringify(d.arrivals) + ");\n"
    + "  if(url.indexOf('/api/feed/markets')>=0){var MK=" + JSON.stringify(d.markets) + ";return j({client:qs('client'),markets:MK[qs('client')]||{}});}\n"
    + "  if(url.indexOf('/api/feed/proxy')>=0){if(qs('client')==='Northwind'&&qs('market')==='gb'){window.__pzFeed=(window.__pzFeed||0)+1;var X=" + JSON.stringify(d.xml) + ";"
    +     (opts.emptyFeed ? "X='<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><title>empty</title></channel></rss>';" : '')
    +     "return new Promise(function(res){setTimeout(function(){res(new Response(X,{status:200,headers:{'content-type':'application/xml','x-feed-bytes':String(X.length)}}))}," + delay + ")});}"
    +     "return j({error:'no feed for this market in the synthetic book'},404);}\n"
    + "  if(url.indexOf('/api/aiquote/saved')>=0)return j(" + JSON.stringify(d.aiqsaved) + ");\n"
    + "  if(url.indexOf('/api/aiquote')>=0)return j({ratecard:{}});\n"
    + "  if(url.indexOf('/api/hours')>=0)return j({ok:true,clients:" + JSON.stringify(d.hours) + "});\n"
    + "  if(url.indexOf('/api/schedule')>=0)return j({ok:true,cadence:" + JSON.stringify(d.sched) + ",brands:[]});\n"
    + "  if(url.indexOf('/api/labels/askdraft')>=0){if(opts&&opts.method==='POST'){window.__pzAsk=(window.__pzAsk||[]).concat([JSON.parse(opts.body)]);return j({ok:true,id:'ad_x'});}return j({cfg:{to:{Northwind:'buyer@northwind.invalid'}},asked:{},pending:0});}\n"
    + "  if(url.indexOf('/api/pricer/')>=0){var nm=url.split('/api/pricer/')[1].split('?')[0];window.__pzS=window.__pzS||" + JSON.stringify(d.stores) + ";"
    +     (opts.costDenied ? "if(nm==='cost'||(nm==='price'&&opts&&opts.method==='PUT'))return j({ok:false,error:'Management only (the pricer-cost grant)'},403);" : '')
    +     (opts.full ? "if(nm==='proposals'&&opts&&opts.method==='PUT'){window.__pzFull=(window.__pzFull||0)+1;return j({ok:false,error:'the proposals store is full (it would pass 20 MB) — nothing was saved. Delete options nobody needs (a deleted option keeps only its name) and save again'},413);}" : '')
    +     "var sb=function(o){return new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json','X-Sync-Base':String(Date.now())}})};"
    +     "var cell=nm==='ops'||nm==='price'||nm==='cost'||nm==='roadmap',stamp=function(v){return v&&typeof v==='object'?(cell?+v.at||0:(v.lu&&+v.lu.at)||0):0};"
    +     "if(opts&&opts.method==='PUT'){var b=JSON.parse(opts.body),hd=opts.headers||{},base=+(hd['X-Sync-Base']||hd['x-sync-base'])||0,cur=window.__pzS[nm]||{},out={},rej=[],now=Date.now();"
    +       "window.__pzPuts=(window.__pzPuts||[]).concat([{name:nm,body:b,base:base}]);"
    +       "Object.keys(cur).forEach(function(k){if(!(k in b)&&stamp(cur[k])>base)out[k]=cur[k]});"
    +       "Object.keys(b).forEach(function(k){var v=b[k],o=cur[k];"
    +         "if(o!==undefined&&JSON.stringify(o)===JSON.stringify(v)){out[k]=o;return}"
    +         "if(o!==undefined&&stamp(o)>base){out[k]=o;rej.push({k:k,why:'changed by '+((cell?o.by:(o.lu&&o.lu.by))||'someone')+' since you loaded — reload to edit it'});return}"
    +         (opts.me && opts.me.clients ? "if(nm==='proposals'&&v&&v.client&&" + JSON.stringify(opts.me.clients) + ".indexOf(v.client)<0){if(o!==undefined)out[k]=o;rej.push({k:k,why:'outside your clients — \"'+v.client+'\" is not one of your accounts, so this signin cannot save it (a prospect proposal needs an unscoped signin)'});return}" : '')
    +         "var n=JSON.parse(JSON.stringify(v));if(n&&typeof n==='object'){if(cell){n.by='Ray';n.at=now}else n.lu={by:'Ray',at:now}}out[k]=n});"
    +       "window.__pzS[nm]=out;var r=JSON.parse(JSON.stringify(out));if(rej.length)r._rejected=rej;return Promise.resolve(sb(r));}"
    +     "return Promise.resolve(sb(window.__pzS[nm]||{}));}\n"
    + "  if(url.indexOf('/api/tachyon/')>=0)return j({});\n"
    + "  if(url.indexOf('/api/briefs')>=0)return j({});\n"
    + "  if(url.indexOf('/pricer/gpc.txt')>=0)return Promise.resolve(new Response('Apparel & Accessories\\nApparel & Accessories > Clothing',{status:200}));\n"
    + " }\n";
}
module.exports = { build, stubLines, feedXml, NOW };
