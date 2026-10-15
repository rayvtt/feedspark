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
  return { xml, roster };
}
function stubLines() {
  const d = build();
  const src = (f) => JSON.stringify(fs.readFileSync(path.join(D, f), 'utf8'));
  const txt = (body, type, extra) => 'return Promise.resolve(new Response(' + body + ',{status:200,headers:Object.assign({"content-type":"' + type + '"},' + JSON.stringify(extra || {}) + ')}));';
  return " if(/Breakdown/.test(location.pathname)){\n"
    + "  if(url.indexOf('/breakdown/engine.js')>=0)" + txt(src('breakdown_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/feedlab/engine.js')>=0)" + txt(src('feedlab_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/api/breakdown/roster')>=0)return j(" + JSON.stringify(d.roster) + ");\n"
    + "  if(url.indexOf('/api/feed/proxy')>=0){window.__bdReads=(window.__bdReads||[]).concat([url]);" + txt(JSON.stringify(d.xml), 'application/xml', { 'x-feed-bytes': String(Buffer.byteLength(d.xml)) }) + "}\n"
    + " }\n";
}
module.exports = { build, stubLines, CLIENT, MKT };
