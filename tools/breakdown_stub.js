// A small SYNTHETIC set for the browser tripwires (check_mobile.js, check_darkmode.js, check_breakdown.js): the
// Northwind output feed tools/catalog_stub.js already draws, offered as a Google market and a Meta one, so
// /breakdown renders its panes, the pivot and the fields catalogue instead of its "reading the feed" states. Nothing
// here is a client's product: the brand ("Northwind") is invented. The real shapes are asserted in
// tools/test_breakdown.mjs.
//
// The lines stubLines() returns only answer on the Breakdown page (a guard on the file name), so the engines they
// hand over never change what another page meets under the same tripwire.
'use strict';
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
const CAT = require('./catalog_stub.js');
const CLIENT = CAT.CLIENT, MKT = CAT.MKT;
function build() {
  const xml = CAT.build().xml;
  const roster = { ok: true, clients: { [CLIENT]: [{ mkt: MKT, kind: 'xml', meta: false }, { mkt: MKT + '-fb', kind: 'xml', meta: true }] } };
  // a SYNTHETIC 30-day Google Ads read, keyed by the stub's own ids (upper-cased, as the report may carry them, so the
  // case-blind join is exercised) plus one id the feed does not carry — its spend must stay out of every row
  const ids = [...xml.matchAll(/<g:id>([^<]+)<\/g:id>/g)].map((m) => m[1]);
  const ads = {};
  ids.forEach((id, i) => { if (i % 3 === 2) return; ads[id.toUpperCase()] = [100 + i * 10, 5 + i, 12.5 + i * 3, i % 4 === 0 ? 1 : 0, i % 4 === 0 ? 60 + i * 5 : 0]; });
  ads['NW-GONE-404'] = [40, 4, 9.5, 0, 0];
  return { xml, roster, ads };
}
function stubLines() {
  const d = build();
  const src = (f) => JSON.stringify(fs.readFileSync(path.join(D, f), 'utf8'));
  const txt = (body, type, extra) => 'return Promise.resolve(new Response(' + body + ',{status:200,headers:Object.assign({"content-type":"' + type + '"},' + JSON.stringify(extra || {}) + ')}));';
  return " if(/Breakdown/.test(location.pathname)){\n"
    + "  if(url.indexOf('/breakdown/engine.js')>=0)" + txt(src('breakdown_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/feedlab/engine.js')>=0)" + txt(src('feedlab_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/api/breakdown/roster')>=0)return j(" + JSON.stringify(d.roster) + ");\n"
    + "  if(url.indexOf('/api/breakdown/ads')>=0)return j(" + JSON.stringify({ ok: true, done: true, cmpid: '999', period: '30_days', range: 'Last 30 days', cur: 'GBP', got: Object.keys(d.ads).length, total: Object.keys(d.ads).length, rows: d.ads }) + ");\n"
    + "  if(url.indexOf('/api/feed/proxy')>=0){window.__bdReads=(window.__bdReads||[]).concat([url]);" + txt(JSON.stringify(d.xml), 'application/xml', { 'x-feed-bytes': String(Buffer.byteLength(d.xml)) }) + "}\n"
    + " }\n";
}
module.exports = { build, stubLines, CLIENT, MKT };
