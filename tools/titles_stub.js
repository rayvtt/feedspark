// A small SYNTHETIC set for the browser tripwires (check_mobile.js, check_darkmode.js, check_titles.js): an invented
// brand's shopping feed and the master file it was built from, so /titles renders its summary, cards, masks, checks
// and list instead of its "reading the feed" states. Nothing here is a client's product: "Northwind" is invented.
//
// The set is DELIBERATE, so a harness can count it without the engine:
//   · every sixth product (i % 6 === 5) keeps its master title unchanged; the rest are rewritten to one mask
//   · products with i % 8 === 3 carry no g:material although their rewritten title names one (title, not field)
//   · product 7's title says its master colour while g:color says "Blue" (title and field differ)
//   · products with i % 4 === 2 have no pattern, so their mask is one chip shorter
// The lines stubLines() returns only answer on the Titles page (a guard on the file name).
'use strict';
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
const CLIENT = 'Northwind', MKT = 'gb', CMPID = 'northwind_gb', N = 24;
const TYPES = [
  { t: 'Midi Dress', pt: 'Womens > Clothing > Dresses > Midi Dresses', g: 'female' },
  { t: 'Jumper', pt: 'Womens > Clothing > Knitwear > Jumpers', g: 'female' },
  { t: 'Shirt', pt: 'Mens > Clothing > Shirts', g: 'male' },
  { t: 'Tote Bag', pt: 'Womens > Accessories > Bags > Tote Bags', g: 'female' },
];
const COLOURS = ['Navy', 'Black', 'Ivory', 'Sage', 'Rust', 'Grey'];
const MATS = ['Cotton', 'Wool', 'Linen'];
const PATS = ['Floral', 'Striped', '', 'Checked'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function products() {
  const out = [];
  for (let i = 0; i < N; i++) {
    const ty = TYPES[i % TYPES.length], col = COLOURS[i % COLOURS.length], mat = MATS[i % MATS.length], pat = PATS[i % PATS.length], size = i % 2 ? 'L' : 'M';
    const before = ty.t + ' ' + col, same = i % 6 === 5;
    const after = same ? before : 'Northwind ' + (ty.g === 'male' ? 'Men’s' : 'Women’s') + ' ' + col + ' ' + (pat ? pat + ' ' : '') + mat + ' ' + ty.t + ', Size ' + size;
    out.push({ i, id: 'NW' + (200 + i), oid: 'M-NW' + (200 + i), type: ty.t, pt: ty.pt, gender: ty.g, col, fieldCol: i === 7 ? 'Blue' : col, mat, fieldMat: i % 8 === 3 ? '' : mat, pat, size, before, after, same });
  }
  return out;
}
function outputXml() {
  const items = products().map((p) => '<item>\n<g:id>' + p.id + '</g:id>\n<title>' + esc(p.after) + '</title>\n<description>' + esc('A synthetic ' + p.type.toLowerCase() + ' made for the title tripwires.') + '</description>\n'
    + '<link>https://shop.northwind.invalid/p/' + p.id.toLowerCase() + '</link>\n<g:image_link>https://img.northwind.invalid/' + p.id + '.jpg</g:image_link>\n'
    + '<g:availability>in stock</g:availability>\n<g:price>' + (20 + p.i).toFixed(2) + ' GBP</g:price>\n<g:brand>Northwind</g:brand>\n'
    + '<g:product_type>' + esc(p.pt) + '</g:product_type>\n<g:color>' + p.fieldCol + '</g:color>\n' + (p.fieldMat ? '<g:material>' + p.fieldMat + '</g:material>\n' : '')
    + (p.pat ? '<g:pattern>' + p.pat + '</g:pattern>\n' : '') + '<g:size>' + p.size + '</g:size>\n<g:gender>' + p.gender + '</g:gender>\n<g:age_group>adult</g:age_group>\n'
    + '<c:fs_data_original_title type="string">' + esc(p.before) + '</c:fs_data_original_title>\n<c:fs_data_original_id type="string">' + p.oid + '</c:fs_data_original_id>\n</item>');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss xmlns:g="http://base.google.com/ns/1.0" xmlns:c="http://base.google.com/cns/1.0" version="2.0"><channel><title>Northwind (synthetic)</title>\n' + items.join('\n') + '\n</channel></rss>';
}
function masterCsv() {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const rows = [['id', 'title', 'vendor', 'colour', 'composition', 'product_type', 'price']];
  products().forEach((p) => rows.push([p.oid, p.before, 'Northwind', p.col, '100% ' + p.mat, p.pt, '£' + (20 + p.i).toFixed(2)]));
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
}
function build() {
  const xml = outputXml(), csv = masterCsv();
  const roster = { ok: true, clients: { [CLIENT]: [{ mkt: MKT, channel: 'google', kind: 'xml', cmpid: CMPID }, { mkt: 'ie', channel: 'google', kind: 'none', cmpid: '', why: 'unwired' }] } };
  const info = { ok: true, state: 'ok', cmpid: CMPID, name: 'Northwind GB (synthetic)', rows: N, file: 'northwind_gb_master.csv', headers: [], hasFile: true };
  return { xml, csv, roster, info };
}
function stubLines() {
  const d = build();
  const src = (f) => JSON.stringify(fs.readFileSync(path.join(D, f), 'utf8'));
  const txt = (body, type, extra) => 'return Promise.resolve(new Response(' + body + ',{status:200,headers:Object.assign({"content-type":"' + type + '"},' + JSON.stringify(extra || {}) + ')}));';
  return " if(/Titles/.test(location.pathname)){\n"
    + "  if(url.indexOf('/titles/engine.js')>=0)" + txt(src('titlelab_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/catalog/engine.js')>=0)" + txt(src('catalog_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/feedlab/engine.js')>=0)" + txt(src('feedlab_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/api/catalog/roster')>=0)return j(" + JSON.stringify(d.roster) + ");\n"
    + "  if(url.indexOf('/api/catalog/master/file')>=0)" + txt(JSON.stringify(d.csv), 'text/csv', { 'x-feed-bytes': String(Buffer.byteLength(d.csv)) }) + "\n"
    + "  if(url.indexOf('/api/catalog/master')>=0)return j(" + JSON.stringify(d.info) + ");\n"
    + "  if(url.indexOf('/api/feed/proxy')>=0)" + txt(JSON.stringify(d.xml), 'application/xml', { 'x-feed-bytes': String(Buffer.byteLength(d.xml)) }) + "\n"
    + " }\n";
}
module.exports = { build, stubLines, products, CLIENT, MKT, CMPID, N };
