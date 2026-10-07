// A small SYNTHETIC set for the browser tripwires (check_mobile.js, check_darkmode.js, check_restock.js): the
// Northwind output feed tools/catalog_stub.js already draws, FeedHero's 30-day Ads Traffic read for the same
// market, and a ledger with a few days of history — so /restock renders its KPI band, the split, the category
// bars and the three views instead of its "waiting for the feed" states. Nothing here is a client's product:
// the brand ("Northwind") is invented, the figures made up. The real shapes are asserted in tools/test_restock.mjs.
//
// The lines stubLines() returns only answer on the Restock page (a guard on the file name), so the engines they
// hand over never change what another page meets under the same tripwire. Ledger times are written as offsets
// from Date.now() IN THE BROWSER, so "12 days unavailable" reads 12 whenever the tripwire runs.
'use strict';
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
const CAT = require('./catalog_stub.js');
const CLIENT = CAT.CLIENT, MKT = CAT.MKT, CMPID = CAT.CMPID;
// the ads rows: every product with (index % 3 === 0) plus the three out-of-stock ones, two the feed no longer carries,
// one keyed in lower case (Google lower-cases the Ads item id that stands in for a blank pid)
function adsRows() {
  const rows = {}, P = CAT.build().xml;
  const ids = [...P.matchAll(/<g:id>([^<]+)<\/g:id>/g)].map((m) => m[1]);
  ids.forEach((id, i) => {
    const oos = i % 9 === 4;
    if (!(i % 3 === 0 || oos)) return;
    const impr = 300 + i * 41, clicks = 4 + (i % 7) * 3, cost = Math.round(clicks * (0.22 + (i % 4) * 0.06) * 100) / 100;
    const conv = oos ? 2 + (i % 3) : (i % 2 ? 0 : 1 + (i % 4) * 0.5), value = Math.round(conv * (28 + (i % 7) * 12) * 100) / 100;
    rows[i === 6 ? id.toLowerCase() : id] = [impr, clicks, cost, conv, value];
  });
  rows['NW-GONE-1'] = [1400, 36, 11.2, 4, 196];
  rows['NW-GONE-2'] = [260, 5, 1.1, 0, 0];
  return rows;
}
// the ledger as a JS EXPRESSION (offsets from the browser's clock): one product out 12 days, one gone 5 days, one that
// came back 2 days ago, and one the ledger has as out of stock that the feed now carries IN STOCK (the page sees it return)
const LEDGER_JS = "(function(){var D=Date.now(),d=864e5;return {v:1,t0:D-20*d,t:D-1*d,n:7,p:{'NW102-M':[D-12*d,D-1*d,'o',0],'NW-GONE-1':[D-5*d,D-1*d,'g',0],'NW100-M':[D-9*d,D-3*d,'o',D-2*d],'NW101-L':[D-6*d,D-1*d,'o',0]}};})()";
function build() {
  const d = CAT.build();
  const ads = adsRows();
  const roster = { ok: true, period: '30_days', keep: 14, clients: { [CLIENT]: [{ mkt: MKT, kind: 'xml', cmpid: CMPID, ads: true }, { mkt: 'de', kind: 'sheet', cmpid: null, ads: false }] } };
  const adsDone = { ok: true, done: true, cmpid: CMPID, period: '30_days', from: '2026-09-07', to: '2026-10-06', range: 'Last 30 Days (07/09/2026 - 06/10/2026)',
    total: Object.keys(ads).length, pages: 2, next: 3, got: Object.keys(ads).length, cur: 'GBP', curMix: false, at: Date.UTC(2026, 9, 7, 8), rows: ads };
  return { xml: d.xml, roster, ads: adsDone, adsRows: ads };
}
function stubLines() {
  const d = build();
  const src = (f) => JSON.stringify(fs.readFileSync(path.join(D, f), 'utf8'));
  const txt = (body, type, extra) => 'return Promise.resolve(new Response(' + body + ',{status:200,headers:Object.assign({"content-type":"' + type + '"},' + JSON.stringify(extra || {}) + ')}));';
  return " if(/Restock/.test(location.pathname)){\n"
    + "  if(url.indexOf('/restock/engine.js')>=0)" + txt(src('restock_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/feedlab/engine.js')>=0)" + txt(src('feedlab_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/api/restock/roster')>=0)return j(" + JSON.stringify(d.roster) + ");\n"
    + "  if(url.indexOf('/api/feed/proxy')>=0)" + txt(JSON.stringify(d.xml), 'application/xml', { 'x-feed-bytes': String(Buffer.byteLength(d.xml)) }) + "\n"
    // the read arrives in two calls — the first a chunk (done:false), the page calls again for the rest
    + "  if(url.indexOf('/api/restock/ads')>=0){window.__rsAds=(window.__rsAds||0)+1;if(window.__rsAds===1)return j({ok:true,done:false,cmpid:" + JSON.stringify(CMPID) + ",got:4,total:" + d.ads.total + ",pages:2,next:2});return j(" + JSON.stringify(d.ads) + ");}\n"
    // the ledger: GET hands over the stored record; PUT records the observation and merges it the way the worker does
    + "  if(url.indexOf('/api/restock/ledger')>=0){window.__rsL=window.__rsL||" + LEDGER_JS + ";var L=window.__rsL;"
    + "if(opts&&opts.method==='PUT'){var b=JSON.parse(opts.body);window.__rsPut=(window.__rsPut||[]).concat([b]);var now=Date.now();"
    + "(b.oos||[]).forEach(function(id){var e=L.p[id];L.p[id]=e&&!e[3]?[e[0],now,'o',0]:[now,now,'o',0];});(b.gone||[]).forEach(function(id){var e=L.p[id];L.p[id]=e&&!e[3]?[e[0],now,'g',0]:[now,now,'g',0];});"
    + "(b.back||[]).forEach(function(id){var e=L.p[id];if(e&&!e[3])L.p[id]=[e[0],now,e[2],now];});L.t=now;L.n++;}"
    + "var sm={began:L.t0,last:L.t,n:L.n,oos:0,gone:0,back:0};Object.keys(L.p).forEach(function(id){var e=L.p[id];if(e[3])sm.back++;else if(e[2]==='g')sm.gone++;else sm.oos++;});"
    + "return j({ok:true,cmpid:" + JSON.stringify(CMPID) + ",client:" + JSON.stringify(CLIENT) + ",market:" + JSON.stringify(MKT) + ",ledger:L,summary:sm,keep:14,stale:45});}\n"
    + " }\n";
}
module.exports = { build, stubLines, adsRows, CLIENT, MKT, CMPID, LEDGER_JS };
