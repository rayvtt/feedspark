// CATALOGUE harness (pure node, CI-safe). Ray, 28 Sep 2026: "a module to browse / view / track /
// deep dive product catalogs … when you hover over an image or product, you should have access to
// what we call a master feed source in FeedHero report MCP. That is the product data before
// FeedSpark optimization … which field existed vs. didn't, which field is structured vs. didn't,
// which field is enriched vs didn't".
//
// Pins the engine (docs/catalog_engine.js) on SYNTHETIC fixtures shaped like the real feeds — a
// FeedHero output item carrying every FeedSpark stamp, and a Shopify-style master where
// `product_id` is the parent and `id` the row the output was built from (the trap YuMOVE's real
// master sets). Nothing here is a client's product. Then the real Feed Lab parser on that item,
// a master zip built in-process, the worker's catalogue helpers LIFTED out of worker.js by name,
// the route wiring, the page, and that no master file is committed.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import * as ROAS from '../cloudflare/feedspark-deck/src/roas.js';
import { MODULES, MODULE_PATHS } from '../cloudflare/feedspark-deck/src/access.js';
import { MIG_SEED } from '../cloudflare/feedspark-deck/src/migration.js';
const require = createRequire(import.meta.url);
const E = require('../docs/catalog_engine.js');
const FA = require('../docs/feedlab_engine.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), PG = read('docs/FeedSpark_Catalog.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why ? ' — ' + why : '')); } };

// ---- fixtures ---------------------------------------------------------------------------------------------
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" xmlns:c="http://base.google.com/cns/1.0" version="2.0"><channel><title>fixture</title>
<item>
<g:id>SKU-100-8</g:id>
<title>Northwind Navy Linen Midi Dress, Size 8</title>
<description>Soft linen midi dress in navy.</description>
<link>https://shop.example/p/100?size=8</link>
<g:image_link>https://lia.feedspark.com/feedspark-meta-dynamic-v2/meta_catelog_call.php?template_hash=ab12&amp;img_url=https://cdn.example/img/100.jpg</g:image_link>
<g:additional_image_link>https://cdn.example/img/100-2.jpg</g:additional_image_link>
<g:additional_image_link>https://cdn.example/img/100-3.jpg</g:additional_image_link>
<g:additional_image_link>https://cdn.example/img/100-4.jpg</g:additional_image_link>
<g:availability>in stock</g:availability>
<g:price>95.00 GBP</g:price>
<g:sale_price>76.00 GBP</g:sale_price>
<g:brand>Northwind</g:brand>
<g:gtin>5012345678900</g:gtin>
<g:condition>new</g:condition>
<g:google_product_category>Apparel &amp; Accessories &gt; Clothing &gt; Dresses</g:google_product_category>
<g:product_type>Womens &gt; Clothing &gt; Dresses &gt; Midi Dresses</g:product_type>
<g:product_type>linen dress &gt; summer dress</g:product_type>
<g:color>Navy</g:color>
<g:size>8</g:size>
<g:gender>female</g:gender>
<g:age_group>adult</g:age_group>
<g:material>Linen</g:material>
<g:item_group_id>100</g:item_group_id>
<g:product_highlight>Breathable linen</g:product_highlight>
<g:product_highlight>Midi length</g:product_highlight>
<g:shipping><g:country>GB</g:country><g:service>Standard</g:service><g:price>3.95 GBP</g:price></g:shipping>
<g:variant_option><g:name>Size</g:name><g:value>8</g:value></g:variant_option>
<g:custom_label_0>Summer</g:custom_label_0>
<c:fs_data_opti type="string">T:Y|Cat:Y|Keywords:Y|D:N|IMG:Y|ID:N</c:fs_data_opti>
<c:fs_data_original_title type="string">Linen Midi Dress Navy (NAVY)</c:fs_data_original_title>
<c:fs_data_original_id type="string">M-100-8</c:fs_data_original_id>
<c:title_field type="string">Human reviewed title</c:title_field>
<c:fs_date_of_birth type="string">2026-08-14</c:fs_date_of_birth>
<c:stock_quantity type="string">11</c:stock_quantity>
</item>
<item>
<g:id>M-200</g:id>
<title>Northwind Canvas Tote</title>
<description>A canvas tote.</description>
<link>https://shop.example/p/200</link>
<g:image_link>https://cdn.example/img/200.jpg</g:image_link>
<g:availability>out of stock</g:availability>
<g:price>40.00 GBP</g:price>
<g:brand>Northwind</g:brand>
<c:fs_data_opti type="string">T:N|Cat:N|Keywords:N|D:N|IMG:N|ID:N</c:fs_data_opti>
<c:fs_data_original_id type="string">M-200</c:fs_data_original_id>
<c:fs_date_of_birth type="string">2025-02-01</c:fs_date_of_birth>
</item>
<item>
<g:id>NEW-300</g:id>
<title>Northwind Straw Hat</title>
<g:price>18.00 GBP</g:price>
<c:fs_data_original_title type="string">Straw Hat</c:fs_data_original_title>
<c:fs_data_original_id type="string">NEW-300</c:fs_data_original_id>
</item>
</channel></rss>`;
// the master: product_id is the PARENT (a decoy for the join), id is the row the output was built from
const MASTER_CSV = [
  'id,product_id,title,price,was_price,sale_price,description,vendor,barcode,colour,size,product_type,image_link,additional_image_link,availability,composition,tags',
  'M-100-8,100,Linen Midi Dress Navy (NAVY),£76.00,£95.00,,"<p>Soft linen midi dress in navy.</p>",Northwind,5012345678900,Navy (NAVY),8,Midi Dresses,https://cdn.example/img/100.jpg,"https://cdn.example/img/100.jpg,https://cdn.example/img/100-2.jpg",IN_STOCK,Outer: Linen 100%,"Women\'s,summer"',
  'M-200,200,Northwind Canvas Tote,40.00,,40.00,A canvas tote.,Northwind,,,,Bags,http://cdn.example/img/200.jpg,,out of stock,,',
  'M-999,999,A product the feed leaves out,12.00,,,,Northwind,,,,Hats,https://cdn.example/img/999.jpg,,in stock,,',
].join('\r\n');

// a real zip, built here: one deflated entry, CRC32, central directory, end record
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function zipOne(name, data) {
  const nm = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(0, 42);
  const off = 30 + nm.length + comp.length, cdl = 46 + nm.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cdl, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([lh, nm, comp, cd, nm, end]));
}

console.log('· header keys — the MCP, the Feed Lab parser and a delimited export all land on one naming');
t('MCP repeats: g:additional_image_link_3 → additionalimagelink #3', JSON.stringify(E.hkey('g:additional_image_link_3')) === JSON.stringify({ base: 'additionalimagelink', rep: 3 }));
t('parser repeats: g:product_highlight(2) → producthighlight #1', JSON.stringify(E.hkey('g:product_highlight(2)')) === JSON.stringify({ base: 'producthighlight', rep: 1 }));
t('a c: stamp with its type attribute: c:fs_date_of_birth type="string" → fsdateofbirth', E.hkey('c:fs_date_of_birth type="string"').base === 'fsdateofbirth');
t('custom_label_0 is a field, never "repeat 0" of custom_label', E.hkey('g:custom_label_0').base === 'customlabel0');
t('Schuh-style image1URL…image4URL: the first is the main image', E.hkey('image1URL').base === 'imagen' && E.hkey('image1URL').rep === 0 && E.hkey('image3URL').rep === 2);
t('an attribute column (c:drid@type) is not a value', E.hkey('c:drid@type') === null);
t('nested MCP names keep their parts: g:shipping->g:price → shippingprice', E.hkey('g:shipping->g:price').base === 'shippingprice');

console.log('· values — what makes two values the same information');
t('"£76.00", "76.00 GBP" and "76" are one amount', E.norm('price', '£76.00') === '76.00' && E.norm('price', '76.00 GBP') === '76.00' && E.norm('price', '76') === '76.00');
t('European formats: "1.234,50 EUR" and "12,50 €"', E.money('1.234,50 EUR').a === 1234.5 && E.money('12,50 €').a === 12.5 && E.money('1,234.50 GBP').a === 1234.5 && E.money('abc') === null);
t('availability vocab: IN_STOCK / In stock / in_stock are one', E.norm('availability', 'IN_STOCK') === E.norm('availability', 'in stock') && E.norm('availability', 'In stock') === 'in_stock');
t('gender vocab: womens → female, mens → male', E.norm('gender', 'womens') === 'female' && E.norm('gender', "Men's") === 'male');
t('a GPC with a stray "{" and tight separators is the same path', E.norm('google_product_category', '{Clothing & Accessories>Clothing') === E.norm('google_product_category', 'Clothing & Accessories > Clothing'));
t('a colour with its internal code in brackets is the same colour', E.norm('color', 'Navy (NAVY)') === E.norm('color', 'Navy'));
t('a GTIN padded with zeros is the same GTIN', E.norm('gtin', '05012345678900') === E.norm('gtin', '5012345678900'));
t('a link differing only in tracking parameters is the same page', E.norm('link', 'https://shop.example/p/1?utm_source=google&glCountry=GB') === E.norm('link', 'https://shop.example/p/1'));
t('HTML and entities never make two descriptions different', E.norm('description', '&lt;p&gt;Soft &amp;amp; light&lt;/p&gt;') === E.norm('description', 'Soft & light'));
t('every URL in a comma list or a JSON blob, commas inside a URL kept', E.urls('https://a.example/1.jpg,https://a.example/2.jpg').length === 2 && E.urls('{"image":[{"url":"http://i.example/x.jpg?im=Resize,width=450"}]}')[0] === 'http://i.example/x.jpg?im=Resize,width=450');
t('FeedSpark overlay hosts are overlays; the source image is read off the URL', E.isOverlay('https://lia.feedspark.com/x?img_url=https://c/1.jpg') && E.isOverlay('https://dashboard.feedspark.com/image-creator/a/b.php') && !E.isOverlay('https://cdn.example/1.jpg') && E.overlaySource('https://lia.feedspark.com/x?a=1&img_url=https%3A%2F%2Fc%2F1.jpg') === 'https://c/1.jpg');
t('fs_data_opti reads every flag, unknown keys kept', JSON.stringify(E.opti('T:Y|Cat:N|Keywords:Y|D:N|IMG:Y|ID:N|X:Y')) === JSON.stringify({ T: true, Cat: false, Keywords: true, D: false, IMG: true, ID: false, X: true }));

console.log('· the output feed through the REAL Feed Lab parser');
const prods = [];
{
  let hdr = null, pl = null, n = 0;
  const P = FA.createXmlParser((row, h) => { if (!hdr) { hdr = h || row; pl = E.outPlan(hdr); n = hdr.length; return; } if (h && h.length !== n) { pl = E.outPlan(h); n = h.length; } prods.push(E.outRow(pl, row)); });
  for (let i = 0; i < XML.length; i += 97) P.push(XML.slice(i, i + 97)); P.end();
}
const p1 = prods[0], p2 = prods[1], p3 = prods[2];
t('three products, every chunk boundary survived', prods.length === 3 && p1.id === 'SKU-100-8' && p2.id === 'M-200' && p3.id === 'NEW-300');
t('the stamps: original id, original title, title field, first-seen date, the flags', p1.oid === 'M-100-8' && p1.otitle === 'Linen Midi Dress Navy (NAVY)' && p1.tfield === 'Human reviewed title' && p1.dob === '2026-08-14' && p1.opti.T === true && p1.opti.D === false);
t('the first product_type is the category tree, the rest are keyword slots', p1.f.product_type === 'Womens > Clothing > Dresses > Midi Dresses' && JSON.stringify(p1.f.keywords) === JSON.stringify(['linen dress > summer dress']));
t('nested tags read as their parts: shipping, variant options', p1.f.shipping === 'GB: Standard: 3.95 GBP' && JSON.stringify(p1.f.variant_option) === JSON.stringify(['Size: 8']));
t('repeated tags are lists: 3 more images, 2 highlights', p1.f.additional_image_link.length === 3 && p1.f.product_highlight.length === 2);
t('a c: field FeedSpark does not map is kept as feed metadata', p1.x['c:stock_quantity'] === '11');
const now = Date.UTC(2026, 8, 28);
const fx1 = E.facts(p1, now);
t('facts: on sale 20% off, 4 levels deep, leaf, 4 images, 45 days old', fx1.onSale && fx1.disc === 20 && fx1.depth === 4 && fx1.leaf === 'Midi Dresses' && fx1.imgs === 4 && fx1.age === 45 && fx1.av === 'in_stock' && fx1.cur === 'GBP');
t('facts: no sale price is never "on sale"', !E.facts(p2, now).onSale && E.facts(p2, now).av === 'out_of_stock');

console.log('· the master: a zip, sniffed, parsed, joined on the column the DATA says');
const zip = zipOne('northwind_master_20260928.csv', Buffer.from(MASTER_CSV));
const ents = E.zipEntries(zip), main = E.zipMain(ents);
t('the zip is read off its central directory', E.isZip(zip) && ents.length === 1 && main.name === 'northwind_master_20260928.csv' && main.method === 8);
const text = zlib.inflateRawSync(Buffer.from(E.zipData(zip, main))).toString('utf8');
t('the entry inflates back to the exact file', text === MASTER_CSV);
t('not a zip: an XML file is left alone', !E.isZip(new TextEncoder().encode('<?xml version="1.0"?>')) && E.zipEntries(new Uint8Array(40)) === null);
const sn = E.sniff(text.slice(0, 4000));
t('sniff: comma, quotes honoured', sn.fmt === 'delim' && sn.delim === ',' && sn.quotes === true);
t('sniff: XML, TSV (quotes off when the header has none), pipe', E.sniff('<?xml version="1.0"?><rss>').fmt === 'xml' && E.sniff('id\ttitle\tprice\n1\t"A\t2').quotes === false && E.sniff('id|title|price').delim === '|');
const mrows = []; let mhead = null;
{ const D = E.delimParser(',', (r, i) => { if (i === 0) mhead = r; else mrows.push(r); }, sn); for (const ch of text) D.push(ch); D.end(); }
t('CSV: quoted commas, a quoted HTML cell, CRLF — one character at a time', mhead.length === 17 && mrows.length === 3 && mrows[0][6] === '<p>Soft linen midi dress in navy.</p>' && mrows[0][16] === "Women's,summer" && mrows[2][2] === 'A product the feed leaves out');
{ const out = []; const D = E.delimParser('\t', (r) => out.push(r), { quotes: false }); D.push('a\t"literal quote\tb\n"c\td\te\n'); D.end(); t('TSV without quoting keeps a literal quote and never swallows the file', out.length === 2 && out[0][1] === '"literal quote' && out[1][0] === '"c'); }
{ const out = []; const D = E.delimParser(',', (r) => out.push(r)); D.push('x,"he said ""hi"""\n'); D.push('y,"two\nlines"'); D.end(); t('CSV: doubled quotes and a newline inside quotes', out[0][1] === 'he said "hi"' && out[1][1] === 'two\nlines'); }
const plan = E.plan(mhead);
const ids = new Set(prods.map((p) => E.idKey(p.oid)));
const j = E.detectJoin(plan, mrows, ids);
t('the join is `id`, not the parent `product_id` — read off the data', j.h === 'id' && j.hit === 2 && j.col === 0);
{ const pl2 = E.plan(['sku', 'id', 'title']); const j2 = E.detectJoin(pl2, [['A1', 'A1', 'x'], ['B2', 'B2', 'y']], new Set(['a1', 'b2'])); t('a tie (id and sku identical) goes to the column the alias list ranks first', j2.h === 'id'); }
t('no column carrying the ids = no join, never a guess', E.detectJoin(plan, mrows, new Set(['nothing'])).col === -1);
plan.join = j.col; plan.joinH = j.h;
const by = new Map(); mrows.forEach((r) => by.set(E.idKey(r[j.col]), E.masterCells(r)));

console.log('· one product, field by field — every status');
const lin = E.lineage(p1, by.get('m-100-8'), plan), R = {}; lin.forEach((r) => { R[r.k] = r; });
const is = (k, st, how) => R[k] && R[k].st === st && (how == null || R[k].how === how);
t('title rewritten → optimised; before = the master title', is('title', 'optimised', 'rewrite') && R.title.m === 'Linen Midi Dress Navy (NAVY)' && R.title.src === 'title');
t('description only lost its HTML → structured, to spec', is('description', 'structured', 'format'));
t('price £95 came from was_price → structured, remapped', is('price', 'structured', 'remap') && R.price.src === 'was_price');
t('sale price £76 = the master price under a higher was_price → structured, remapped', is('sale_price', 'structured', 'remap') && R.sale_price.src === 'price');
t('IN_STOCK → in stock is structured, not optimised', is('availability', 'structured', 'format'));
t('brand from vendor, unchanged → kept, the column named', is('brand', 'kept') && R.brand.src === 'vendor');
t('GTIN from barcode → kept', is('gtin', 'kept') && R.gtin.src === 'barcode');
t('"Navy (NAVY)" → "Navy" is structured (the code stripped, same colour)', is('color', 'structured', 'format'));
t('size unchanged → kept', is('size', 'kept'));
t('gender lifted from the master\'s tags ("Women\'s") → structured, lifted', is('gender', 'structured', 'lift') && R.gender.src === 'tags');
t('age group the master never had → populated', is('age_group', 'populated', 'new'));
t('condition, GPC, shipping, link — core gaps filled → populated', is('condition', 'populated') && is('google_product_category', 'populated') && is('shipping', 'populated') && is('link', 'populated'));
t('"Midi Dresses" rebuilt as a four-level path → optimised, restructured', is('product_type', 'optimised', 'restructure'));
t('material read out of the master\'s composition ("Outer: Linen 100%") → structured, lifted', is('material', 'structured', 'lift') && R.material.src === 'composition');
t('item group lifted from the parent column → structured, lifted', is('item_group_id', 'structured', 'lift') && R.item_group_id.src === 'product_id');
t('the main image is now a FeedSpark overlay, composed from the master image', is('image_link', 'optimised', 'overlay') && R.image_link.overlayOf === 'https://cdn.example/img/100.jpg');
t('more images: the master\'s one kept, two added → enriched, +2 (a list added to)', is('additional_image_link', 'enriched', '+2') && R.additional_image_link.from === 0);
t('highlights, keyword slots, variant options, a custom label — new → enriched', is('product_highlight', 'enriched', 'new') && is('keywords', 'enriched') && is('variant_option', 'enriched') && is('custom_label_0', 'enriched'));
t('the id changed from the master row\'s → optimised', is('id', 'optimised'));
t('nothing on either side → missing', is('pattern', 'missing') && is('question_and_answer', 'missing'));
t('EXISTED / ENRICHED read off the one record', R.title.ex && R.title.en && !R.age_group.ex && R.age_group.en && R.brand.ex && !R.brand.en && R.gender.en && !R.gender.ex);
t('STRUCTURED = the value sent passes Google\'s format', R.price.spec === 'ok' && R.availability.spec === 'ok' && R.gtin.spec === 'ok' && R.google_product_category.spec === 'ok');
const lin2 = E.lineage(p2, by.get('m-200'), plan), R2 = {}; lin2.forEach((r) => { R2[r.k] = r; });
t('a sale price equal to the price, left out → dropped, and it says why', R2.sale_price.st === 'dropped' && R2.sale_price.how === 'same as price');
t('a promotion FeedSpark sets where the master has none → populated, never "reprice"', E.classify('sale_price', [], '16.69 GBP', ['x'], E.plan(['x'])).st === 'populated');
t('an http image re-served on https is the same image', R2.image_link.st === 'structured');
const lin3 = E.lineage(p3, null, null), R3 = {}; lin3.forEach((r) => { R3[r.k] = r; });
t('no master row: every field is unknown — the title still reads against FeedHero\'s original title', R3.price.st === 'unknown' && R3.title.st === 'optimised' && R3.title.m === 'Straw Hat');

console.log('· the four stages, and the one-character codes the table and the matrix read');
const sc = E.stageCounts(lin);
t('fields holding a value grow master → populated → enriched', sc.hold[0] < sc.hold[1] && sc.hold[1] <= sc.hold[3] && sc.changed[1] > 0 && sc.changed[2] > 0 && sc.changed[3] > 0);
t('the title reads the master at stages 1–2 and the rewrite from stage 3', E.valueAt(R.title, 0) === R.title.m && E.valueAt(R.title, 1) === R.title.m && E.valueAt(R.title, 2) === R.title.o && E.valueAt(R.title, 3) === R.title.o);
t('a populated field is absent at the master stage and present after', E.valueAt(R.age_group, 0) == null && E.valueAt(R.age_group, 1) === 'adult');
t('an enriched field arrives at stage 4 only', E.valueAt(R.product_highlight, 2) == null && E.valueAt(R.product_highlight, 3).length === 2);
t('a dropped field is gone from stage 3 on', E.valueAt(R2.sale_price, 1) != null && E.valueAt(R2.sale_price, 2) == null);
const cd = E.codes(lin);
t('one character per attribute, in ATTRS order', cd.length === E.ATTRS.length && cd.charAt(E.ATTRS.findIndex((a) => a.k === 'title')) === 'o' && cd.charAt(E.ATTRS.findIndex((a) => a.k === 'gender')) === 'l' && cd.charAt(E.ATTRS.findIndex((a) => a.k === 'additional_image_link')) === 'g' && E.codes(lin2).charAt(E.ATTRS.findIndex((a) => a.k === 'sale_price')) === 'd');
t('the lineage strip reads real attributes', E.DNA.every((k) => E.ATTR[k]));
const mx = E.matrixAdd({}, lin); E.matrixAdd(mx, lin2);
t('the matrix counts each status per attribute', mx.title.n === 2 && mx.title.optimised === 1 && mx.title.kept === 1);

console.log('· completeness before → after, the apparel rule, the conversational six');
const cm = E.completeness(lin, p1);
t('a dress is apparel (its category says so): the apparel five count', cm.apparel && cm.list.some((x) => x.k === 'gender'));
t('completeness rises from master to feed', cm.after > cm.before && cm.after <= 100 && cm.before >= 0);
const pet = E.outRecord({ 'g:id': 'P1', title: 'Joint tablets', 'g:size': 'Small / Double pack', 'g:google_product_category': 'Animals & Pet Supplies > Pet Supplies' });
t('a pet supplement with a SIZE is not apparel — never marked down for a gender', !E.completeness(E.lineage(pet, null, null), pet).apparel);
t('gtin or mpn count once, as the identifier', cm.list.filter((x) => x.k === 'gtin / mpn').length === 1);
t('AI-ready counts the conversational six', E.aiCount(lin).after === 1 && E.aiCount(lin).of === 6);

console.log('· Google\'s format, per attribute');
t('GTIN check digit', E.gtinOk('5012345678900') && !E.gtinOk('5012345678901') && E.spec('gtin', '5012345678901') === 'warn');
t('availability / price / condition vocab', E.spec('availability', 'IN_STOCK') === 'ok' && E.spec('availability', 'Available') === 'warn' && E.spec('price', '£76.00') === 'warn' && E.spec('price', '76.00 GBP') === 'ok' && E.spec('condition', 'New') === 'ok');
t('a GPC path with ">" is fine; a stray "{" is not', E.spec('google_product_category', 'Apparel & Accessories > Clothing') === 'ok' && E.spec('google_product_category', '{Clothing') === 'warn');
t('a title over 150 characters, or shouting, is not', E.spec('title', 'x'.repeat(151)) === 'warn' && E.spec('title', 'SALE NOW ON') === 'warn' && E.spec('title', 'Linen dress') === 'ok');
t('HTML in a description is not', E.spec('description', '<p>x</p>') === 'warn' && E.spec('description', 'plain') === 'ok');

console.log('· the word diff behind the inspector\'s before → after');
const wd = E.wordDiff('Linen Midi Dress Navy (NAVY)', 'Northwind Navy Linen Midi Dress, Size 8');
t('additions and deletions are marked, shared words kept', wd.some((x) => x.t === 'add' && x.w === 'Northwind') && wd.some((x) => x.t === 'del' && x.w === '(NAVY)') && wd.some((x) => x.t === 'eq' && x.w === 'Linen'));
t('a word that only changed punctuation or case is a tweak', E.wordDiff('Midi dress', 'Midi Dress,').some((x) => x.t === 'tweak'));
t('a very long description falls back to a bag of words (a hover never stalls)', E.wordDiff('a '.repeat(500), 'b '.repeat(500)).length === 1000);

console.log('· which Google Ads segment a product sits in — the rules measured against FeedHero\'s own counts');
{
  const at = Date.UTC(2026, 8, 28), d = (y, m, dd) => Date.UTC(y, m - 1, dd);
  const b = (x) => E.ageBucket(x, at);
  t('product age: <=7 days Brand new, <=30 days New', b(d(2026, 9, 21)) === 'Brand new' && b(d(2026, 9, 20)) === 'New' && b(d(2026, 8, 29)) === 'New');
  t('then calendar QUARTERS, never 90 / 365 days: 1 Jul = This season, 30 Jun = Last season', b(d(2026, 7, 1)) === 'This season' && b(d(2026, 6, 30)) === 'Last season' && b(d(2026, 4, 1)) === 'Last season');
  t('This year = the two quarters before that; 29 Sep 2025 (364 days) is already Perennial', b(d(2026, 3, 31)) === 'This year' && b(d(2025, 10, 1)) === 'This year' && b(d(2025, 9, 29)) === 'Perennial');
  t('an undated product is Perennial', b(null) === 'Perennial' && b(NaN) === 'Perennial');
  t('the quarter rolls with the read date (a January read reaches back into the previous year)', E.ageBucket(d(2025, 10, 1), d(2026, 1, 15)) === 'Last season' && E.ageBucket(d(2025, 4, 1), d(2026, 1, 15)) === 'This year');
  const fx = [{ grp: 'G1', dob: d(2026, 9, 18) }, { grp: 'g1', dob: d(2025, 2, 19) }, { grp: 'G2', dob: d(2026, 9, 25) }, { grp: '', dob: d(2026, 9, 1) }, { grp: 'G3', dob: null }];
  const gm = E.groupBirth(fx);
  t('age is the GROUP\'s: a colour added last week to a 2025 style is filed with its style', E.birthOf(fx[0], gm) === d(2025, 2, 19) && E.ageBucket(E.birthOf(fx[0], gm), at) === 'Perennial' && E.ageBucket(fx[0].dob, at) === 'New');
  t('a product with no group keeps its own date; an undated one borrows its group\'s', E.birthOf(fx[3], gm) === d(2026, 9, 1) && E.birthOf({ grp: 'G2', dob: null }, gm) === d(2026, 9, 25) && E.birthOf(fx[4], gm) == null);
  t('grouping is case-insensitive (G1 and g1 are one style)', Object.keys(gm).length === 2 && gm.g1 === d(2025, 2, 19));
  const pOn = { f: { brand: 'Northwind', color: '', custom_label_2: 'SaveÂ£5' }, opti: { T: true, Keywords: false } };
  t('price type is a rule: sale below price', E.segValue('Price_type', pOn, { onSale: true }) === 'Products on Sale' && E.segValue('Price_type', pOn, { onSale: false }) === 'Products at Full Price');
  t('title / keyword status are FeedSpark\'s own fs_data_opti flags; no stamp, no placement', E.segValue('Title_optimisation_status', pOn, {}) === 'Optimized' && E.segValue('Keyword_optimisation_status', pOn, {}) === 'Non Optimized' && E.segValue('Title_optimisation_status', { f: {} }, {}) === null);
  t('an empty column reads "Unsorted", as FeedHero files it', E.segValue('Colour', pOn, {}) === 'Unsorted' && E.segValue('Brand', pOn, {}) === 'Northwind');
  t('data-field review and batch are FeedHero workflow states — never placed', E.segValue('Data_field_optimisation_status', pOn, {}) === null && E.segValue('Batch_id', pOn, {}) === null);
  t('matching is case-insensitive and repairs "Â£" (latin-1 read as utf-8)', E.segKey('SaveÂ£5', 'Custom_label_2') === E.segKey('save£5', 'Custom_label_2') && E.segKey('KIDS', 'Age_group') === 'kids');
  t('a path compares as a path: entities, tight separators, a stray "{"', E.segKey('{Apparel &amp; Accessories&gt;Jewelry', 'Google_product_category') === E.segKey('Apparel & Accessories > Jewelry', 'Google_product_category'));
  const merged = E.mergeSegRows([{ category: 'Model Making', skus: 971, spend: { n: 100, cur: 'GBP' }, revenue: { n: 500, cur: 'GBP' }, roasPct: 500, zombiePct: 10 },
    { category: 'model making', skus: 947, spend: { n: 300, cur: 'GBP' }, revenue: { n: 300, cur: 'GBP' }, roasPct: 100, zombiePct: 30 }, { category: 'Paint', skus: 5, roasPct: 50 }], 'Google_product_category');
  t('one name twice in FeedHero\'s list is one segment: counts summed, ROAS recomputed from the money', merged.length === 2 && merged[0].skus === 1918 && merged[0].spend.n === 400 && merged[0].revenue.n === 800 && merged[0].roasPct === 200 && merged[0].merged === 2);
  t('a merged zombie share is weighted by SKUs, never averaged', Math.abs(merged[0].zombiePct - (10 * 971 + 30 * 947) / 1918) < 1e-9);
  t('a cut FeedHero reads as EMPTY (every real row Unsorted) places no product', E.unsortedOnly([{ category: 'Unsorted' }, { category: 'Unlisted SKUs in Ads traffic' }, { category: 'Total' }]) && !E.unsortedOnly([{ category: 'Unsorted' }, { category: 'New In' }]) && !E.unsortedOnly([]));
  t('the "Unlisted SKUs in Ads traffic" row belongs to no feed product', E.segUnlisted('Unlisted SKUs in Ads traffic') && !E.segUnlisted('Unsorted'));
}
t('the page places a category on its FULL path only — no nearest-ancestor fallback, a miss shown as a miss', /function exactPath\(v\) \{/.test(PG) && !/function deepest\(/.test(PG) && PG.indexOf('not in the ROAS tree yet') >= 0);
t('the page reads product age at the ROAS read, on the group\'s first-seen date', /function roasAt\(\) \{/.test(PG) && /S\.gm = E\.groupBirth\(S\.fx\)/.test(PG) && /E\.birthOf\(x, S\.gm\)/.test(PG));
t('a cut FeedHero reads as empty says so and lists nothing', /if \(rows && E\.unsortedOnly\(rows\)\) return 'FeedHero reads this column as empty';/.test(PG) && /if \(!el \|\| !S\.roasCan\) return;/.test(PG));

console.log('· the worker — the master is reachable only behind a feed FeedSpark runs');
const liftF = (name) => { const a = WK.indexOf('function ' + name + '('); const b = WK.indexOf('\n}\n', a); if (a < 0 || b < 0) throw new Error('cannot lift ' + name); return WK.slice(a, b + 2); };
const liftA = (name) => { const a = WK.indexOf('async function ' + name + '('); const b = WK.indexOf('\n}\n', a); if (a < 0 || b < 0) throw new Error('cannot lift ' + name); return WK.slice(a, b + 2); };
const W = new Function(liftF('catCmpid') + liftF('catFileOk') + liftF('catColKeys') + 'return { catCmpid, catFileOk, catColKeys };')();
t('the company id is read off the output URL (s2 / s3 / bare feedhero.net)', W.catCmpid({ xml: 'https://s3.feedhero.net/output_feeds/gb/northwind_uk/ab12/northwind_uk_gb_output.xml' }) === 'northwind_uk' && W.catCmpid({ xml: 'https://feedhero.net/output_feeds/gb/northwind_us/ab12/latest-us.xml' }) === 'northwind_us');
t('a Meta (-fb) feed carries the SAME company as its Google market', W.catCmpid({ xml: 'https://s2.feedhero.net/output_feeds/fb/northwind_uk/cd34/latest.xml' }) === 'northwind_uk');
t('a sheet-backed feed has no company — no master, never a guess', W.catCmpid({ id: 'sheet', gid: '0' }) === null && W.catCmpid(null) === null);
t('the file proxy is pinned to THIS company\'s import folder on https feedhero.net', W.catFileOk('https://s2.feedhero.net/import_feeds/northwind_uk/h/backup/m.xml.zip', 'northwind_uk'));
t('…and refuses another company, http, a look-alike host and a path that climbs out', !W.catFileOk('https://s2.feedhero.net/import_feeds/other_uk/h/m.zip', 'northwind_uk') && !W.catFileOk('http://s2.feedhero.net/import_feeds/northwind_uk/m.zip', 'northwind_uk')
  && !W.catFileOk('https://feedhero.net.evil.example/import_feeds/northwind_uk/m.zip', 'northwind_uk') && !W.catFileOk('https://s2.feedhero.net/import_feeds/northwind_uk/../other_uk/m.zip', 'northwind_uk') && !W.catFileOk('https://s2.feedhero.net/import_feeds/northwind_uk_2/m.zip', 'northwind_uk'));
t('the MCP\'s c0…c10 keys sort as columns, not strings', JSON.stringify(W.catColKeys({ c0: 'a', c10: 'k', c2: 'c', c1: 'b', x: 'no' })) === JSON.stringify(['c0', 'c1', 'c2', 'c10']));
{
  const kv = new Map(); let calls = 0; let payload;
  const env = { ROAS_MCP_TOKEN: 'x', EDITS: { get: async (k, ty) => (kv.has(k) ? (ty === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } } };
  const roasMcp = () => ({ init: async () => ({}), call: async (tool, a) => { calls++; if (tool !== 'master_feed' || a.company !== 'northwind_uk' || a.page_size !== 1) throw new Error('bad call'); return payload; } });
  const M = new Function('roasMcp', 'fetch', liftF('catFileOk') + liftF('catColKeys') + liftA('catMasterInfo') + 'return catMasterInfo;')(roasMcp, () => null);
  payload = { report: 'Master Feed', total_rows: 3, web_url: 'https://mcp.feedhero.net/master-feed?company=northwind_uk&run=1', columns: { c0: 'id', c1: 'product_id', c10: 'k', c2: 'title' },
    info: { client_name: 'Northwind UK', total_rows: 3, last_import: '2026-09-28 08:00:00', import_status: 'Ok - Success', read_from: 'Source file',
      source_url: 'https://s3.feedhero.net/import_feeds/northwind_uk/h/backup/northwind_uk_master_20260928.csv.zip', master_feed_url: 'https://s3.feedhero.net/import_feeds/other_uk/h/backup/x.xlsx' } };
  const r1 = await M(env, 'northwind_uk', false);
  t('one MCP call reads the file, its headings in column order, the import time', r1.state === 'ok' && calls === 1 && r1.file === 'northwind_uk_master_20260928.csv.zip' && r1.headers.join(',') === 'id,product_id,title,k' && r1.lastImport === '2026-09-28 08:00:00');
  t('a link outside the company\'s own folder is never kept', r1.src !== '' && r1.wb === '');
  const r2 = await M(env, 'northwind_uk', false);
  t('the second read comes from KV (20 minutes), no MCP call', r2.cached === true && calls === 1);
  payload = { message: 'The master feed is still being prepared — call again shortly' };
  const r3 = await M(env, 'northwind_uk', true);
  t('"still being prepared" is a state, never an error or an empty master', r3.state === 'preparing' && /prepared/.test(r3.note));
  t('no token = says so', (await M({ EDITS: env.EDITS }, 'northwind_uk', true)).state === 'no_token');
}
const route = WK.slice(WK.indexOf("if (path.startsWith('/api/catalog/')"), WK.indexOf('// RULES + STOCK MANAGEMENT (Ray, 28 Sep 2026'));
t('four routes: roster, master, master/file, master/row', ['/api/catalog/roster', "'/api/catalog/master'", '/api/catalog/master/file', '/api/catalog/master/row'].every((p) => route.indexOf(p) >= 0));
t('scoped like /api/roas — owner or a clientMatch, 403 otherwise', /const inScope = \(c\) => acc\.owner \|\| clientMatch\(acc\.clients, c\);/.test(route) && /if \(!inScope\(client\)\) return json\(\{ ok: false, error: 'out of scope' \}, 403\);/.test(route) && /\.filter\(\(r\) => inScope\(r\.client\)\)/.test(route));
t('the company comes from the wired feed, never the query', /const cmpid = catCmpid\(src\);/.test(route) && !/searchParams\.get\('cmpid'\)/.test(route));
t('FeedHero\'s backup URLs never leave the server', /delete pub\.src; delete pub\.wb;/.test(route));
t('the file is streamed with its size as an informational header, never content-length', /h\['x-feed-bytes'\] = len;/.test(route) && !/'content-length':/.test(route));
t('a moved file (FeedHero re-imported) is re-read once, fresh', /rec = await catMasterInfo\(env, cmpid, true\);/.test(route));
t('the client\'s file is served as BYTES on our origin: never FeedHero\'s content-type, nosniff, a download', /'content-type': 'application\/octet-stream', 'x-content-type-options': 'nosniff'/.test(route) && /'content-disposition': 'attachment; filename="' \+ fname \+ '"'/.test(route) && !/up\.headers\.get\('content-type'\)/.test(route));
t('the file name is cleaned before it becomes a header (a newline would throw)', /\.replace\(\/\[\^\\w\.\\-\]\/g, '_'\)\.slice\(0, 120\)/.test(route));
t('a first-read timeout reads as "preparing" (the MCP client times out at 25s)', /timed\? \?out\|aborted\|timeout/.test(route));
t('the live row lookup asks the MCP\'s own search, ten rows, this company only', /mcp\.call\('master_feed', \{ company: cmpid, search: q, page_size: 10 \}\)/.test(route));
t('the page and its engine are served', /'\/catalog':\s+\{ html: CATALOG_PAGE, slug: 'catalog' \}/.test(WK) && /if \(path === '\/catalog\/engine\.js' && request\.method === 'GET'\)/.test(WK) && /import CATALOG_ENGINE_SRC from "\.\.\/\.\.\/\.\.\/docs\/catalog_engine\.js";/.test(WK));
{
  const aggs = (/const AGGS = \[([^\]]*)\];/.exec(WK.slice(WK.indexOf("if (path === '/api/roas/live'"))) || [0, ''])[1];
  const pageAggs = (/var AGGS = \[([\s\S]*?)\];/.exec(PG) || [0, ''])[1].match(/\['([A-Za-z_0-9]+)',/g).map((x) => x.slice(2, -2));
  t('the live ROAS cut allows every cut the page asks for (the chart AND the inspector)', pageAggs.length >= 15 && pageAggs.every((a) => a === 'Category' || aggs.indexOf("'" + a + "'") >= 0), pageAggs.filter((a) => a !== 'Category' && aggs.indexOf("'" + a + "'") < 0).join(','));
}
t('the roster hands the page the ROAS roster\'s own market label (GB, BE-FR)', /roas: rb \? \{ client: rb\.client, market: rb\.market \} : null/.test(route) && ROAS.cmpidBrand('superdry_befr').market === 'BE-FR');

console.log('· registry, nav, page');
t('a grantable module whose slug is its path', MODULES.some((m) => m.slug === 'catalog' && m.path === '/catalog') && MODULE_PATHS['/catalog'] === 'catalog');
t('on the migration board', MIG_SEED.some((m) => m.p === '/catalog'));
const navPages = fs.readdirSync(new URL('../docs/', import.meta.url)).filter((f) => /\.html$/.test(f)).map((f) => read('docs/' + f)).filter((h) => h.indexOf('<nav class="tb-nav tb-modules"') >= 0);
t('every nav-bearing page links the Catalogue, right after Stock', navPages.length > 20 && navPages.every((h) => /href="\/stock"[^]*?<\/a><a href="\/catalog" class="tbm( on)?"/.test(h)));
t('its own nav marks it, and only it', /<a href="\/catalog" class="tbm on"/.test(PG) && (PG.match(/class="tbm on"/g) || []).length === 1);
t('the one design stylesheet, exactly as the tripwires read it', PG.indexOf('<link rel="stylesheet" href="/design/fcc.css">') >= 0);
t('no </body> anywhere (the worker injects at the first one)', PG.indexOf('</body>') < 0);
t('esc() escapes both quotes', /function esc\(s\) \{[^\n]*&quot;[^\n]*&#39;/.test(PG));
t('the engines load the way /golden loads them (fetch + run), so a stub can hand them over', /function loadEngines\(\) \{/.test(PG) && ["'/feedlab/engine.js'", "'/catalog/engine.js'", "'/volume/engine.js'", "'/overlays/engine.js'"].every((s) => PG.indexOf(s) >= 0));
t('the inspector follows REAL pointer movement only (the /stock lesson)', PG.indexOf('if (e.clientX === PT.x && e.clientY === PT.y) return;') >= 0);
t('a hover must MEAN it: a dwell to open, a shorter one to follow', /\}, open \? 150 : 380\);/.test(PG));
t('the arrivals engine is handed a Date (a timestamp broke the whole stream once)', /AR\.stats\(dob, new Date\(\), S\.prods\.length\)/.test(PG));
t('one chart failing never stops the master join', /\[counts, detectRoasField, renderStatus, renderKpis, renderTabs, function \(\) \{ refresh\(false\); \}, renderArrivals, renderRoasChart, renderMods\]\.forEach\(safe\);\n\s+maybeJoin\(g\);/.test(PG));
t('the dashboard is TWELVE modules of one size on an even grid that follows the page\'s own width', (PG.match(/class="card mod" id="[a-z-]+" data-mod="/g) || []).length === 12 && /\.mod\{display:flex;flex-direction:column;height:340px/.test(PG) && /\.ins\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(PG) && /main\.wrap\{container-type:inline-size;container-name:cat\}/.test(PG));
t('stock control reads Stock management\'s OWN route and matches the market on the feed\'s FeedHero company id, never a name', /fetch\('\/api\/rules\/stock\?brand=/.test(PG) && /String\(x\.cmpid\) === String\(e\.cmpid\)/.test(PG) && /loadRoas\(g\); loadStock\(g\);/.test(PG));
t('stock control is /stock\'s coverage matrix for this market — one hue, the count in the cell, — where none', /function covShade\(n, mx\)/.test(PG) && /<table class="covt/.test(PG) && /none: the market has no rule doing this/.test(PG) && /fcc-cat-stkch/.test(PG));
t('ad spend kept off counts a market ONCE at its largest blocking rule (the /stock floor), never the sum of its rules', /h\.kind === 'blocked' && h\.n > 0 && \(!best \|\| h\.n > best\.n\)/.test(PG) && /best\.n \* a\.spendDay \* D/.test(PG));
t('every module bar is a filter the table obeys (spec · price · size run · mix · depth · availability)', /if \(F\.k === 'spec' \|\| F\.k === 'price' \|\| F\.k === 'run' \|\| F\.k === 'mix' \|\| F\.k === 'depth' \|\| F\.k === 'avail'\) return passModFacet\(F, i, x\);/.test(PG));
t('modules are the viewer\'s to hide and reorder, per device, never shared', /lsSet\('fcc-cat-mods', st\)/.test(PG) && PG.indexOf("/api/state?ns=catmods") < 0);
t('a path cut names its leaf, not a truncated root repeated ten times', /var shortLab = function \(c\)/.test(PG));
t('blue is ROAS\'s alone: bars paint var(--chart-1), the lineage has its own four tokens in both themes', /\.cht \.bar\{fill:var\(--chart-1\)/.test(PG) && /--lk:#9aa3ae;--lp:#15a070;--lo:#ED6F0B;--le:#5b47c7;--ld:#d23c3c/.test(PG) && /--lk:#6b7482;--lp:#199e70;--lo:#C67B28;--le:#9085e9;--ld:#e66767/.test(PG) && !/#2563EB/i.test(PG));
t('image tiles paint var(--paper), never white (the dark-mode tripwire)', /--tile:var\(--paper\)/.test(PG));
t('segment ROAS is labelled as the segment\'s, never the product\'s', PG.indexOf('Segment ROAS — the products this one sits with, never this product’s own.') >= 0);
t('one audit legend (the same auditBand /golden carries)', /function auditBand\(v\) \{ return v == null \|\| isNaN\(v\) \? '' : \(v >= 95 \? 'green' : \(v >= 85 \? 'yellow' : \(v >= 70 \? 'orange' : 'red'\)\)\); \}/.test(PG));
{
  const liftP = (name) => { const a = PG.indexOf('function ' + name + '('); const b = PG.indexOf('\n  }\n', a); return PG.slice(a, b + 4); };
  const qf = /var QF = \{[\s\S]*?\};/.exec(PG)[0];
  const parseQ = new Function(qf + liftP('parseQ') + 'return parseQ;')();
  const q = parseQ('brand:northwind colour:navy, black -avail:out "midi dress"');
  t('search grammar: field:value, a comma list (even with a space), a negation, a quoted phrase', q.length === 4 && q[0].f === 'brand' && q[1].f === 'color' && q[1].alts.join('|') === 'navy|black' && q[2].neg && q[2].f === '@av' && q[3].f === '*' && q[3].alts[0] === 'midi dress');
  t('an unknown field is read as plain text, never dropped', parseQ('foo:bar')[0].f === '*' && parseQ('foo:bar')[0].alts[0] === 'foo:bar');
}

console.log('· no client data in git');
const tracked = (() => { try { return require('node:child_process').execSync('git ls-files', { cwd: new URL('..', import.meta.url).pathname }).toString().split('\n'); } catch (e) { return []; } })();
t('no master file, zip or feed dump is committed', !tracked.some((f) => /(_master|master_feed)[^/]*\.(zip|csv|tsv|txt|xml|xlsx)$/i.test(f) || /catalog[^/]*\.(zip|xml)$/i.test(f)));
t('no FeedHero import URL (with its hash) is written into the code', !/import_feeds\/[a-z0-9_]+\/[0-9a-f]{16,}/.test(WK + PG + read('docs/catalog_engine.js')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
