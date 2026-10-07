/* FeedRestock — the Restock module's browser engine (Ray, 7 Oct 2026: "feedhero-reports have got By Products
 * report - and 'Restock products' is interesting to build as a module"). UMD: the page loads it at
 * /restock/engine.js, tools/test_restock.mjs requires it in node, tools/restock_stub.js hands it to the
 * browser tripwires. Pure functions, no DOM, no fetch.
 *
 * WHAT IT ANSWERS: of the products Google Ads served in FeedHero's trailing window (the Catalogue's per-product
 * Ads Traffic read, 30 days), which ones can a shopper NOT buy right now — because the output feed sends them
 * OUT OF STOCK, or no longer carries them at all (FeedHero's "Unlisted SKUs in Ads traffic")? Ranked by the
 * conversion value they carried, so the top of the list is the demand the stock position is costing the most.
 *
 * THREE RULES, because this goes in front of a client:
 *   · the feed decides the stock state; a feed with no availability word on a product says "not stated", which
 *     is its own bucket — never read as out of stock, never read as in stock;
 *   · money never crosses a currency: every sum is one currency's, and a mixed read sums impressions, clicks
 *     and conversions only — the page prints why;
 *   · days unavailable come from the ledger the worker keeps (first seen unavailable), never from the window:
 *     FeedHero reports 30 days of demand, not when the product went out of stock.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedRestock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.0.0';
  function s0(v) { return v == null ? '' : String(v); }
  function plain(v) { return s0(Array.isArray(v) ? v[0] : v).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim(); }

  // ---- availability, as the feed states it -----------------------------------------------------------------------
  // in · pre (pre-order / backorder: buyable, the shopper waits) · out · na (no word, or one we cannot read)
  function availState(v) {
    var s = plain(v).toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return 'na';
    if (/^(in stock|instock|available|available for order|yes|true|1|limited availability|limited stock|low stock|in_stock)$/.test(s)) return 'in';
    if (/^(preorder|pre order|backorder|back order|available for preorder|pre sale|presale)$/.test(s)) return 'pre';
    if (/^(out of stock|outofstock|sold out|soldout|no|false|0|unavailable|not available|discontinued|out)$/.test(s)) return 'out';
    return 'na';
  }
  var AV_WORD = { 'in': 'In stock', pre: 'Pre-order / backorder', out: 'Out of stock', na: 'Not stated' };

  // ---- the feed's columns, read by name --------------------------------------------------------------------------
  // the Feed Lab parser names an XML column by its tag ("g:availability", a repeat "g:product_type(2)", a stamp
  // 'c:fs_data_opti type="string"'); a sheet names it as the sheet does. ONE normalisation covers both.
  function hkey(h) {
    var s = s0(h).trim();
    var rep = /\((\d+)\)\s*$/.exec(s);
    s = s.replace(/\s+type=.*$/i, '').replace(/\(\d+\)\s*$/, '').toLowerCase().replace(/^(g|c|fs):/, '').replace(/[^a-z0-9]/g, '');
    return { base: s, rep: rep ? +rep[1] : 1 };
  }
  var ALIAS = {
    id: ['id', 'gid', 'productid', 'sku'], title: ['title', 'name', 'productname'], link: ['link', 'url', 'producturl'],
    image: ['imagelink', 'image', 'imageurl', 'image1url'], avail: ['availability', 'stockstatus', 'availabilitystatus', 'instock'],
    price: ['price'], sale: ['saleprice'], pt: ['producttype'], brand: ['brand'], grp: ['itemgroupid'],
  };
  // the first column that answers each name — a repeated product_type takes only its FIRST slot (the category tree;
  // the numbered slots are keywords)
  function plan(header) {
    var P = {};
    (header || []).forEach(function (h, i) {
      var k = hkey(h); if (!k.base || k.rep > 1) return;
      Object.keys(ALIAS).forEach(function (a) { if (P[a] == null && ALIAS[a].indexOf(k.base) >= 0) P[a] = i; });
    });
    return P;
  }
  function cell(row, i) { return i == null ? '' : plain(row[i]); }
  function topLevel(pt) { var s = plain(pt); if (!s) return ''; var parts = s.split(/\s*>\s*|\s*\/\s*|\s*»\s*/); return (parts[0] || '').trim(); }
  // one feed row → the little the module needs of it
  function feedRow(P, row) {
    var id = cell(row, P.id); if (!id) return null;
    var av = cell(row, P.avail);
    return { id: id, title: cell(row, P.title), link: cell(row, P.link), image: cell(row, P.image), av: availState(av), avRaw: av,
      price: cell(row, P.price), sale: cell(row, P.sale), pt: topLevel(cell(row, P.pt)), ptFull: cell(row, P.pt), brand: cell(row, P.brand), grp: cell(row, P.grp) };
  }

  // ---- the join: Google Ads' demand × the feed's stock state ------------------------------------------------------
  function adsKey(id) { return s0(id).trim().toLowerCase(); }
  // the worker's rows: {pid: [impr, clicks, cost, conversions, conversion value]} — case-blind on the product id
  function adsIndex(rows) {
    var m = new Map();
    Object.keys(rows || {}).forEach(function (k) { var v = rows[k]; if (Array.isArray(v) && v.length >= 5) m.set(adsKey(k), { pid: k, v: v }); });
    return m;
  }
  function stateOf(f) { return !f ? 'gone' : f.av === 'out' ? 'oos' : f.av === 'na' ? 'na' : 'live'; }
  var ST_WORD = { oos: 'Out of stock in the feed', gone: 'Not in the feed', na: 'Availability not stated', live: 'Buyable' };
  var ST_SHORT = { oos: 'Out of stock', gone: 'Not in feed', na: 'Not stated', live: 'In stock' };
  // feedMap: Map adsKey(id) → feedRow; ads: the worker's rows object. Every demanded product, placed.
  function join(feedMap, ads) {
    var out = [];
    Object.keys(ads || {}).forEach(function (pid) {
      var v = ads[pid]; if (!Array.isArray(v) || v.length < 5) return;
      var f = feedMap ? feedMap.get(adsKey(pid)) : null;
      out.push({ id: f ? f.id : pid, key: adsKey(pid), st: stateOf(f), f: f || null,
        impr: +v[0] || 0, clicks: +v[1] || 0, cost: +v[2] || 0, conv: +v[3] || 0, value: +v[4] || 0 });
    });
    return out;
  }
  function isUnavail(r) { return r.st === 'oos' || r.st === 'gone'; }
  // biggest demand first: conversion value, then conversions, clicks, impressions
  function rank(rows) {
    return rows.slice().sort(function (a, b) { return (b.value - a.value) || (b.conv - a.conv) || (b.clicks - a.clicks) || (b.impr - a.impr) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
  }
  // ---- the figures: one currency or none ---------------------------------------------------------------------------
  function r2(n) { return Math.round(n * 100) / 100; }
  function summary(rows, cur, curMix) {
    var s = { demanded: 0, live: 0, oos: 0, gone: 0, na: 0, unavail: 0, impr: 0, clicks: 0, conv: 0, imprAll: 0, clicksAll: 0, convAll: 0, cur: cur || '', curMix: !!curMix, money: null, share: null };
    var value = 0, cost = 0, valueAll = 0, costAll = 0;
    (rows || []).forEach(function (r) {
      s.demanded++; s[r.st]++; s.imprAll += r.impr; s.clicksAll += r.clicks; s.convAll += r.conv; valueAll += r.value; costAll += r.cost;
      if (isUnavail(r)) { s.unavail++; s.impr += r.impr; s.clicks += r.clicks; s.conv += r.conv; value += r.value; cost += r.cost; }
    });
    s.conv = r2(s.conv); s.convAll = r2(s.convAll);
    // money only when every row is one currency — a read FeedHero returns in two currencies has no sum
    if (!curMix) { s.money = { value: r2(value), cost: r2(cost), valueAll: r2(valueAll), costAll: r2(costAll) }; s.share = valueAll > 0 ? value / valueAll : null; }
    return s;
  }
  // where the lost demand sits — the feed's top-level category (a product gone from the feed has none: "No longer in the feed")
  function byCategory(rows, top) {
    var m = {}, GONE = 'No longer in the feed';
    (rows || []).forEach(function (r) {
      if (!isUnavail(r)) return;
      var k = r.st === 'gone' ? GONE : ((r.f && r.f.pt) || 'No category');
      var e = m[k] || (m[k] = { pt: k, n: 0, value: 0, clicks: 0, impr: 0 });
      e.n++; e.value += r.value; e.clicks += r.clicks; e.impr += r.impr;
    });
    var all = Object.keys(m).map(function (k) { m[k].value = r2(m[k].value); return m[k]; }).sort(function (a, b) { return (b.value - a.value) || (b.clicks - a.clicks) || (b.n - a.n); });
    top = top || 8;
    if (all.length <= top) return all;
    var head = all.slice(0, top), rest = all.slice(top), o = { pt: 'Other (' + rest.length + ' more)', n: 0, value: 0, clicks: 0, impr: 0, other: true };
    rest.forEach(function (e) { o.n += e.n; o.value += e.value; o.clicks += e.clicks; o.impr += e.impr; });
    o.value = r2(o.value);
    return head.concat([o]);
  }
  // ---- the ledger (kept by the worker): days unavailable, and what came back ---------------------------------------
  var DAY = 86400000;
  function daysSince(t, now) { var d = Math.floor(((now == null ? Date.now() : now) - (+t || 0)) / DAY); return d < 0 ? 0 : d; }
  // ledger.p[id] = [first seen unavailable, last seen, state code (o|g), came back at|0]
  function withLedger(rows, ledger, now) {
    var p = (ledger && ledger.p) || {};
    (rows || []).forEach(function (r) {
      var e = p[r.id] || p[r.key];
      r.since = e && !e[3] && isUnavail(r) ? daysSince(e[0], now) : null;   // days unavailable, read off the record
      r.first = e && !e[3] && isUnavail(r) ? e[0] : 0;
    });
    return rows;
  }
  // products the ledger had as unavailable that are IN STOCK in the feed now (demanded or not) — the re-activate list;
  // `back` = already stamped as returned by an earlier observation, else the page is seeing the return now
  function backRows(feedMap, adsIx, ledger, now) {
    var p = (ledger && ledger.p) || {}, out = [];
    Object.keys(p).forEach(function (id) {
      var e = p[id], f = feedMap ? feedMap.get(adsKey(id)) : null;
      if (!f || (f.av !== 'in' && f.av !== 'pre')) return;
      var a = adsIx ? adsIx.get(adsKey(id)) : null, v = a ? a.v : null;
      out.push({ id: f.id, key: adsKey(id), st: 'live', f: f, was: e[2] === 'g' ? 'gone' : 'oos', first: e[0], back: e[3] || 0, outDays: daysSince(e[0], e[3] || now),
        impr: v ? +v[0] || 0 : 0, clicks: v ? +v[1] || 0 : 0, cost: v ? +v[2] || 0 : 0, conv: v ? +v[3] || 0 : 0, value: v ? +v[4] || 0 : 0 });
    });
    return rank(out);
  }
  // what the page reports to the worker after a join: the unavailable ids by state, and the ledger ids now buyable
  function observation(rows, feedMap, ledger, feedN) {
    var oos = [], gone = [], back = [], p = (ledger && ledger.p) || {};
    rows.forEach(function (r) { if (r.st === 'oos') oos.push(r.id); else if (r.st === 'gone') gone.push(r.id); });
    Object.keys(p).forEach(function (id) { var e = p[id]; if (e[3]) return; var f = feedMap ? feedMap.get(adsKey(id)) : null; if (f && (f.av === 'in' || f.av === 'pre')) back.push(id); });
    return { oos: oos, gone: gone, back: back, n: rows.length, feedN: feedN || 0 };
  }
  // ---- exits ---------------------------------------------------------------------------------------------------
  function csvCell(v) { var s = s0(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csv(rows, cur, view) {
    var head = ['Product ID', 'State', 'Title', 'Availability (feed)', view === 'back' ? 'Days it was unavailable' : 'Days unavailable', 'Impressions', 'Clicks', 'Cost' + (cur ? ' (' + cur + ')' : ''), 'Conversions', 'Conversion value' + (cur ? ' (' + cur + ')' : ''), 'Price', 'Category', 'Link'];
    var lines = [head.map(csvCell).join(',')];
    (rows || []).forEach(function (r) {
      var f = r.f || {};
      lines.push([r.id, view === 'back' ? 'Back in stock (was ' + ST_SHORT[r.was] + ')' : ST_SHORT[r.st], f.title || '', f.avRaw || (r.st === 'gone' ? 'not in feed' : ''), view === 'back' ? r.outDays : (r.since == null ? '' : r.since),
        r.impr, r.clicks, r2(r.cost), r2(r.conv), r2(r.value), f.sale || f.price || '', f.ptFull || '', f.link || ''].map(csvCell).join(','));
    });
    return lines.join('\r\n');
  }
  function money(cur, v) { v = +v || 0; return (cur ? cur + ' ' : '') + v.toLocaleString('en-GB', { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 }); }
  // the brief: the top N unavailable products as lines a colleague can act on
  function briefLines(rows, s, n) {
    var top = rank(rows.filter(isUnavail)).slice(0, n || 15), L = [];
    L.push(s.unavail.toLocaleString('en-GB') + ' of ' + s.demanded.toLocaleString('en-GB') + ' products Google Ads served in the last 30 days cannot be bought: ' + s.oos.toLocaleString('en-GB') + ' sent out of stock, ' + s.gone.toLocaleString('en-GB') + ' no longer in the feed.');
    if (s.money) L.push('They carried ' + money(s.cur, s.money.value) + ' of conversion value' + (s.share != null ? ' (' + Math.round(s.share * 100) + '% of the market’s)' : '') + ' and ' + money(s.cur, s.money.cost) + ' of spend in the window.');
    else if (s.curMix) L.push('Money is not summed: the Ads read carries more than one currency.');
    L.push('');
    L.push('Biggest first:');
    top.forEach(function (r) { L.push('- ' + r.id + (r.f && r.f.title ? ' · ' + r.f.title : '') + ' — ' + ST_SHORT[r.st] + (r.since != null ? ' (' + r.since + ' d)' : '') + ' · ' + r.clicks.toLocaleString('en-GB') + ' clicks' + (s.money ? ' · ' + money(s.cur, r.value) + ' value' : '')); });
    return L;
  }
  return { VERSION: VERSION, availState: availState, AV_WORD: AV_WORD, hkey: hkey, plan: plan, feedRow: feedRow, topLevel: topLevel, adsKey: adsKey, adsIndex: adsIndex, stateOf: stateOf, ST_WORD: ST_WORD, ST_SHORT: ST_SHORT,
    join: join, isUnavail: isUnavail, rank: rank, summary: summary, byCategory: byCategory, daysSince: daysSince, withLedger: withLedger, backRows: backRows, observation: observation, csv: csv, money: money, briefLines: briefLines, plain: plain };
});
