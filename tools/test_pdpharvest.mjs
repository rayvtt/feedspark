#!/usr/bin/env node
/* Golden Record PDP-harvest harness — pins docs/pdp_engine.js (the page runs this exact file on
 * the HTML the worker proxies) + the worker's copy of the host-allowlist maths. Fixtures are
 * modelled on the 14 Sep 2026 probe of the live client PDPs (Demandware "Fabric & Details"
 * lists, Superdry "Composition & Care" label:value rows, Shopify ProductGroup + FAQPage,
 * American Golf "Key Features -" bullets, OpenGraph product: meta). Runs in qa_gate,
 * presync and validate.yml:   node tools/test_pdpharvest.mjs */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const P = require('../docs/pdp_engine.js');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };
const ld = (o) => '<script type="application/ld+json">' + JSON.stringify(o) + '</script>';
const page = (title, head, body) => '<!doctype html><html><head><title>' + title + '</title>' + head + '</head><body><nav><a href="/">Home</a> Log in My Account</nav>' + body + '<footer>Cookie policy · Privacy policy · Sign up to our newsletter for 10% off</footer></body></html>';

/* ---- F1: Demandware apparel (Monsoon-shaped) ---- */
const F1 = page('Mona Angel Sleeve Maxi Dress Blue | Evening Dresses | Monsoon UK',
  ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Mona Angel Sleeve Maxi Dress Blue', sku: '1000393676', brand: { '@type': 'Brand', name: 'Monsoon' },
    image: ['https://cdn.x/1.jpg', 'https://cdn.x/2.jpg', 'https://cdn.x/3.jpg'], offers: { '@type': 'Offer', price: '150.00', priceCurrency: 'GBP', availability: 'http://schema.org/InStock', itemCondition: 'http://schema.org/NewCondition' } }) +
  ld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home' }, { '@type': 'ListItem', position: 2, name: 'Women' }, { '@type': 'ListItem', position: 3, name: 'Dresses' }, { '@type': 'ListItem', position: 4, name: 'Occasion Dresses' }, { '@type': 'ListItem', position: 5, name: 'Mona Angel Sleeve Maxi Dress Blue' }] }),
  '<h1>Mona Angel Sleeve Maxi Dress Blue</h1><p>Complete the look with dazzling jewels. Blue</p>' +
  '<div><h3>Details</h3><h4>Fabric &amp; Details</h4><p>Learn more about the materials we use <a href="/materials">here</a>.</p>' +
  '<ul><li>Outer: Polyester 100% Lining: Polyester 100% Lace: Cotton 32% , Polyamide 46% , Viscose 22%</li><li>machine wash</li><li>Button fastening</li><li>High neck</li><li>Short sleeves</li><li>Plain</li><li>Weight: 72.0</li></ul></div>' +
  '<a href="/size-guide.html">Size guide</a><section><h2>You may also like</h2></section><section><h2>Complete the look</h2></section>');
const R1 = { id: '1000393676', title: 'Mona Angel Sleeve Maxi Dress Blue', link: 'https://www.monsoon.co.uk/mona-angel-sleeve-maxi-dress-blue-1000393676.html', client: 'Monsoon',
  row: { brand: '', material: '', pattern: '', product_detail: '', gender: '', age_group: '', color: 'Blue', product_type: '', document_link: '', related_product: '', mpn: '', additional_image_link: '' } };
console.log('· F1 Demandware apparel page (Fabric & Details list)');
const E1 = P.extract(F1, R1.link, R1), M1 = P.mapToGolden(R1, E1);
t('material = dominant fibre of the OUTER composition (Polyester), from text', E1.attrs.material && E1.attrs.material.v === 'Polyester' && E1.attrs.material.src === 'text', JSON.stringify(E1.attrs.material));
t('pattern = the standalone "Plain" line', E1.attrs.pattern && E1.attrs.pattern.v === 'Plain', JSON.stringify(E1.attrs.pattern));
t('gender/age_group read off the breadcrumb (Women → female / adult)', E1.attrs.gender && E1.attrs.gender.v === 'female' && E1.attrs.age_group && E1.attrs.age_group.v === 'adult');
t('product_type = breadcrumb path minus Home and the product name', E1.attrs.product_type && E1.attrs.product_type.v === 'Women > Dresses > Occasion Dresses', E1.attrs.product_type && E1.attrs.product_type.v);
const pd1 = E1.attrs.product_detail ? E1.attrs.product_detail.v : '';
t('product_detail carries composition, fastening, neckline, sleeve and care as section:attribute:value', /Composition:Outer:Polyester 100%/.test(pd1) && /Details:Fastening:Button/.test(pd1) && /Details:Neckline:High/.test(pd1) && /Details:Sleeve:Short/.test(pd1) && /Care:Wash:Machine wash/.test(pd1), pd1);
t('additional_image_link = the extra image URLs themselves', E1.attrs.additional_image_link && E1.attrs.additional_image_link.v === 'https://cdn.x/2.jpg | https://cdn.x/3.jpg', E1.attrs.additional_image_link && E1.attrs.additional_image_link.v);
t('document_link = the absolute size-guide URL', E1.attrs.document_link && E1.attrs.document_link.v === 'https://www.monsoon.co.uk/size-guide.html', E1.attrs.document_link && E1.attrs.document_link.v);
t('related_product is a SIGNAL (recommendation blocks), never a recovered value', E1.attrs.related_product && E1.attrs.related_product.src === 'signal' && M1.rows.related_product.state === 'signal');
t('own-brand retailer SKU is accepted as MPN (Monsoon sells Monsoon)', E1.attrs.mpn && E1.attrs.mpn.v === '1000393676' && E1.attrs.mpn.src === 'ld:sku');
t('no product_highlight invented from a Details list', !E1.attrs.product_highlight, E1.attrs.product_highlight && E1.attrs.product_highlight.v);
t('feed vs PDP states: colour feed-only (the page never states it), material recovered, brand recovered', M1.rows.color.state === 'feed' && M1.rows.material.state === 'recovered' && M1.rows.brand.state === 'recovered', JSON.stringify([M1.rows.color, M1.rows.material.state]));
t('details excerpt anchors on the Details heading and skips nav/cookie junk', /Fabric & Details/.test(E1.details) && /Outer: Polyester 100%/.test(E1.details) && !/Cookie policy/.test(E1.details) && !/Log in/.test(E1.details), E1.details.slice(0, 200));

/* ---- F2: Superdry-shaped label:value + care rows, third-party-free ---- */
const F2 = page('mens Core Logo City T-Shirt in Florida Orange | Superdry UK',
  ld({ '@type': 'BreadcrumbList', itemListElement: [{ name: 'Outlet' }, { name: 'Mens' }, { name: 'T-Shirts' }, { name: 'Core Logo City T-Shirt' }] }) +
  ld({ '@type': 'Product', name: 'Core Logo City T-Shirt', sku: '268142', brand: { name: 'SUPERDRY' }, image: 'https://cdn.x/a.jpg', offers: { '@type': 'Offer', price: '20.99', priceCurrency: 'GBP' } }),
  '<div>Colour: Florida Orange</div><h3>Size &amp; Fit</h3><p>Relaxed fit – the classic Superdry fit. Go for your normal size</p><p>Model: Height 6ft 3in. Chest 37.5in</p><p>Model wearing: M</p><a href="/size-guide">Size Guide</a>' +
  '<h3>Composition &amp; Care</h3><div>Material:</div><div>Organic Cotton 100%</div><div>Bleach:</div><div>do not bleach</div><div>Dry:</div><div>do not tumble dry</div><div>Wash:</div><div>machine wash - cold (30&deg;C)</div><p>Sizes shown are UK sizes.</p>');
const R2 = { id: '268142', title: 'Core Logo City T-Shirt', link: 'https://www.superdry.com/outlet/mens/t-shirts/core-logo-city-t-shirt-268142.html', client: 'Superdry', row: { color: '', material: '', gender: '', age_group: '', product_detail: '', size_system: '', pattern: '' } };
console.log('· F2 label:value + care rows (Superdry-shaped)');
const E2 = P.extract(F2, R2.link, R2);
t('color from the "Colour: X" line', E2.attrs.color && E2.attrs.color.v === 'Florida Orange' && E2.attrs.color.src === 'text');
t('material from "Material:" + "Organic Cotton 100%" split across lines → Cotton', E2.attrs.material && E2.attrs.material.v === 'Cotton', JSON.stringify(E2.attrs.material));
t('gender male / age_group adult from the Mens crumb', E2.attrs.gender && E2.attrs.gender.v === 'male' && E2.attrs.age_group && E2.attrs.age_group.v === 'adult');
t('size_system UK from "UK sizes"', E2.attrs.size_system && E2.attrs.size_system.v === 'UK');
const pd2 = E2.attrs.product_detail ? E2.attrs.product_detail.v : '';
t('care rows carry their real attribute (Bleach / Tumble dry / Wash), never "Care:Care"', /Care:Bleach:Do not bleach/.test(pd2) && /Care:Tumble dry:Do not tumble dry/.test(pd2) && /Care:Wash:Machine wash/.test(pd2) && !/Care:Care:/.test(pd2), pd2);
t('model measurements never become product_detail', !/Model/.test(pd2));

/* ---- F3: Shopify pet supplement (YuMOVE-shaped): ProductGroup, variants, FAQ, notes ---- */
const F3 = page('YuMOVE Skin & Coat Support Itch & Immune Bites for Dogs',
  ld({ '@context': 'https://schema.org', '@type': 'ProductGroup', name: 'Skin & Coat Support Itch & Immune for Dogs', productGroupID: 'YMSCII90-PP', brand: { name: 'YuMOVE' }, variesBy: ['https://schema.org/size'],
    hasVariant: [
      { '@type': 'Product', name: 'Skin & Coat 30', sku: 'YMSCII30-PP-PAYG', gtin14: '5060144759719', size: '30 Soft Bites', offers: { '@type': 'Offer', url: 'https://yumove.co.uk/products/itch?variant=1001', price: '20.00', priceCurrency: 'GBP', itemCondition: 'https://schema.org/NewCondition' } },
      { '@type': 'Product', name: 'Skin & Coat 90', sku: 'YMSCII90-PP-PAYG', gtin14: '5060144759757', size: '90 Soft Bites', offers: { '@type': 'Offer', url: 'https://yumove.co.uk/products/itch?variant=1002', price: '50.00', priceCurrency: 'GBP', itemCondition: 'https://schema.org/NewCondition' } }],
    positiveNotes: { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Gut and immune support' }, { '@type': 'ListItem', position: 2, name: 'For sensitive dogs' }] } }) +
  ld({ '@type': 'BreadcrumbList', itemListElement: [{ name: 'Home' }, { name: 'Dog Supplements' }, { name: 'Skin & Coat Supplements for Dogs' }] }) +
  ld({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Is this suitable for dogs with sensitive skin?', acceptedAnswer: { '@type': 'Answer', text: '<p>Yes, the bites are made for sensitive dogs.</p>' } }, { '@type': 'Question', name: 'How many bites a day?', acceptedAnswer: { text: 'One per 10kg.' } }, { '@type': 'Question', name: 'Can I give it with food?', acceptedAnswer: { text: 'Yes.' } }] }) +
  '<script>window.__st={"barcode":"5060144759719"}</script>',
  '<h1>Itch &amp; immune daily bites for dogs</h1><h2>Benefits</h2><ul><li>Year-round itch support</li><li>Maintains healthy skin</li><li>Aids immunity</li></ul><h2>Ingredients</h2><a href="/blogs/yumove-ingredients">YuMOVE ingredients</a><p>Get 50% off your first 2 months</p>');
const R3 = { id: 'YMSCII90-PP', title: 'Skin & Coat Itch & Immune for Dogs', link: 'https://yumove.co.uk/products/itch?variant=1002', client: 'YuMOVE', row: { gtin: '', size: '', product_highlight: '', question_and_answer: '', document_link: '', item_group_title: '', variant_option: '', condition: '', item_group_id: '' } };
console.log('· F3 Shopify ProductGroup + FAQ (YuMOVE-shaped)');
const E3 = P.extract(F3, R3.link, R3);
t('the ?variant= id in the feed link picks THE variant → its gtin14 (not the first one)', E3.attrs.gtin && E3.attrs.gtin.v === '5060144759757' && E3.attrs.gtin.src === 'ld:variant', JSON.stringify(E3.attrs.gtin));
t('size from the matched variant', E3.attrs.size && E3.attrs.size.v === '90 Soft Bites');
t('variant_option = dimension:value for this SKU (size:90 Soft Bites)', E3.attrs.variant_option && E3.attrs.variant_option.v === 'size:90 Soft Bites', E3.attrs.variant_option && E3.attrs.variant_option.v);
t('item_group_title from the ProductGroup name, item_group_id from productGroupID', E3.attrs.item_group_title && E3.attrs.item_group_title.v === 'Skin & Coat Support Itch & Immune for Dogs' && E3.attrs.item_group_id && E3.attrs.item_group_id.v === 'YMSCII90-PP');
t('question_and_answer = the actual pairs (Q → A, tags stripped) with the count as evidence', E3.attrs.question_and_answer && /^Is this suitable for dogs with sensitive skin\? → Yes, the bites are made for sensitive dogs\. \| How many bites a day\? → One per 10kg\./.test(E3.attrs.question_and_answer.v) && /3 Q&A/.test(E3.attrs.question_and_answer.ev), E3.attrs.question_and_answer && E3.attrs.question_and_answer.v);
t('product_highlight from positiveNotes (schema wins over the Benefits bullets)', E3.attrs.product_highlight && E3.attrs.product_highlight.v === 'Gut and immune support | For sensitive dogs' && E3.attrs.product_highlight.src === 'ld:positiveNotes');
t('condition new from the offer', E3.attrs.condition && E3.attrs.condition.v === 'new');
t('document_link = the ingredients page', E3.attrs.document_link && E3.attrs.document_link.v === 'https://yumove.co.uk/blogs/yumove-ingredients');
t('third-party rule: a Shopify sku is not an MPN unless own-brand — YuMOVE is own-brand so mpn = variant sku', E3.attrs.mpn && E3.attrs.mpn.v === 'YMSCII90-PP-PAYG');
// the YuMOVE trap: an unmatched row on a multi-variant page must NOT inherit the page-level barcode
const R3b = { id: 'YMSCII120-PP', title: 'x', link: 'https://yumove.co.uk/products/itch', client: 'YuMOVE', row: { gtin: '' } };
const E3b = P.extract(F3, R3b.link, R3b);
t('NO-GUESS: an unmatched SKU on a multi-variant page gets no gtin (the page-level "barcode" key is another variant\'s)', !E3b.attrs.gtin, JSON.stringify(E3b.attrs.gtin));
t('…and no size/variant value either', !E3b.attrs.size && (!E3b.attrs.variant_option || E3b.attrs.variant_option.v === 'size'));
// a single-SKU page may use the page-level barcode
const F3s = page('Single', ld({ '@type': 'Product', name: 'Single thing', sku: 'S1', brand: { name: 'Acme' }, offers: { '@type': 'Offer', price: '1' } }) + '<script>window.__st={"barcode":"5012345678900"}</script>', '<p>Details</p>');
const E3s = P.extract(F3s, 'https://x.com/p', { id: 'S1', client: 'Acme', row: { gtin: '' } });
t('single-SKU page: the page-level barcode is that product\'s gtin', E3s.attrs.gtin && E3s.attrs.gtin.v === '5012345678900' && E3s.attrs.gtin.src === 'json:barcode');

/* ---- F4: third-party brand + "Key Features -" bullets (American Golf-shaped) ---- */
const F4 = page('Stromberg Mens Sintra Golf Shorts | American Golf',
  ld({ '@type': 'Product', name: 'Stromberg Mens Sintra Golf Shorts', sku: '389190', brand: { '@type': 'Brand', name: 'Stromberg' }, offers: { '@type': 'Offer', price: '39.99' } }) +
  ld({ '@type': 'BreadcrumbList', itemListElement: [{ name: 'Home' }, { name: 'Golf Clothing' }, { name: 'Shorts' }] }),
  '<h2>PRODUCT DETAILS</h2><p>Stromberg Men\'s Sintra Golf Shorts</p><p>Key Features -</p><ul><li>Abrasion Resistant</li><li>Moisture-Wicking</li><li>Quick Drying Fabric</li><li>100% Polyester</li></ul><p>Stromberg\'s new Sintra is the only technical golf short you will need this summer.</p><h2>Frequently bought together</h2>');
const R4 = { id: '389190', title: 'Stromberg Mens Sintra Golf Shorts', link: 'https://www.americangolf.co.uk/all-products/stromberg-mens-sintra-golf-shorts-389180.html', client: 'American Golf', row: { mpn: '', brand: '', material: '', product_highlight: '', product_detail: '' } };
console.log('· F4 third-party brand + Key Features bullets (American Golf-shaped)');
const E4 = P.extract(F4, R4.link, R4);
t('product_highlight = the feature bullets only (no product-name line, no composition line)', E4.attrs.product_highlight && E4.attrs.product_highlight.v === 'Abrasion Resistant | Moisture-Wicking | Quick Drying Fabric', E4.attrs.product_highlight && E4.attrs.product_highlight.v);
t('material Polyester from "100% Polyester"', E4.attrs.material && E4.attrs.material.v === 'Polyester');
t('a THIRD-PARTY brand\'s retailer SKU is never an MPN (Stromberg ≠ American Golf)', !E4.attrs.mpn, JSON.stringify(E4.attrs.mpn));
t('brand from schema', E4.attrs.brand && E4.attrs.brand.v === 'Stromberg');

/* ---- F5: OpenGraph product: meta + microdata only (single product) ---- */
const F5 = page('Meta-only page', '<meta property="og:title" content="Silk Scarf"><meta property="product:brand" content="Acme"><meta property="product:color" content="Emerald"><meta content="women" property="product:gender"><meta property="product:age_group" content="adult"><meta property="product:condition" content="new"><meta property="product:material" content="Silk"><meta property="product:category" content="Accessories > Scarves">',
  '<span itemprop="gtin13" content="5099999999999"></span><span itemprop="pattern">Paisley</span>');
console.log('· F5 OpenGraph product: meta + microdata');
const E5 = P.extract(F5, 'https://acme.com/p/1', { id: '1', client: 'Acme', row: {} });
t('color/material/gender/age/condition from product: meta', E5.attrs.color && E5.attrs.color.v === 'Emerald' && E5.attrs.material.v === 'Silk' && E5.attrs.gender.v === 'female' && E5.attrs.age_group.v === 'adult' && E5.attrs.condition.v === 'new');
t('product_type from product:category', E5.attrs.product_type && E5.attrs.product_type.v === 'Accessories > Scarves');
t('gtin13 from microdata on a single-product page, pattern from itemprop text', E5.attrs.gtin && E5.attrs.gtin.v === '5099999999999' && E5.attrs.pattern && E5.attrs.pattern.v === 'Paisley');
t('reversed attribute order (content before property) still parses', E5.attrs.gender.src === 'meta');

/* ---- F6: a bot-wall page yields nothing ---- */
console.log('· F6 blocked / junk page');
const E6 = P.extract('<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="cf-chl">Verify you are human</div></body></html>', 'https://www.reiss.com/x', { id: 'a', row: { material: '' } });
t('no attributes, no sources', Object.keys(E6.attrs).length === 0 && E6.sources.ld.length === 0);
t('mapToGolden marks every gap none (never recovered)', Object.keys(P.mapToGolden({ id: 'a', row: { material: '' } }, E6).rows).every((k) => P.mapToGolden({ id: 'a', row: { material: '' } }, E6).rows[k].state === 'none'));
t('null / undefined html is safe', Object.keys(P.extract(null, '', null).attrs).length === 0);

/* ---- F7: host allowlist maths — engine and the worker's copy agree ---- */
console.log('· F7 host allowlist (engine + worker copy in step)');
const wsrc = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
const lift = (name) => { const i = wsrc.indexOf('function ' + name + '('); const j = wsrc.indexOf('\nfunction ', i + 10); const k = wsrc.indexOf('\nasync function ', i + 10); const end = Math.min(j < 0 ? 1e12 : j, k < 0 ? 1e12 : k); return wsrc.slice(i, end); };
const W = new Function(lift('pdpHostOf') + '\n' + lift('pdpHostAllowed') + '\n' + lift('pdpLinkHostFromHead') + '\nreturn { hostOf: pdpHostOf, hostAllowed: pdpHostAllowed, linkHostFromFeedHead: pdpLinkHostFromHead };')();
const XMLHEAD = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel><title>Reiss GB</title><link>https://www.reiss.com</link><item><g:id>SV1</g:id><g:title>Coat</g:title><g:link><![CDATA[https://www.reiss.com/style/SV131275/Y76182?utm=a&b=c]]></g:link></item>';
const CSVHEAD = 'id,title,link,price\n"HB1","Tweed jacket, brown","https://www.houseofbruar.com/mens/jackets/hb1","£299"\n';
[['hostOf', ['https://www.reiss.com/style/SV1', 'HTTP://Www.Reiss.com:443/x', 'not a url', '']],
  ['linkHostFromFeedHead', [XMLHEAD, CSVHEAD, '<rss><channel><link>https://shop.example.com</link></channel>', 'garbage']]].forEach(([fn, cases]) => cases.forEach((c) => {
    t(fn + ' parity: ' + JSON.stringify(String(c).slice(0, 40)) + ' → ' + JSON.stringify(P[fn](c)), P[fn](c) === W[fn](c), 'worker gave ' + JSON.stringify(W[fn](c)));
  }));
t('XML head → the first item\'s g:link host (CDATA + query tolerated)', P.linkHostFromFeedHead(XMLHEAD) === 'www.reiss.com');
t('CSV head → the link column of the first row (quoted comma-bearing cells)', P.linkHostFromFeedHead(CSVHEAD) === 'www.houseofbruar.com');
[['https://www.reiss.com/style/x', 'www.reiss.com', true], ['https://reiss.com/style/x', 'www.reiss.com', true], ['https://www.reiss.com/x', 'reiss.com', true],
  ['https://www.reiss.com.evil.io/x', 'www.reiss.com', false], ['https://m.reiss.com/x', 'www.reiss.com', false], ['https://evil.io/?u=https://www.reiss.com', 'www.reiss.com', false],
  ['javascript:alert(1)', 'www.reiss.com', false], ['', 'www.reiss.com', false], ['https://www.reiss.com/x', '', false]].forEach(([u, h, exp]) => {
    t('hostAllowed(' + JSON.stringify(u) + ', ' + h + ') = ' + exp + ' (engine + worker)', P.hostAllowed(u, h) === exp && W.hostAllowed(u, h) === exp);
  });

/* ---- F8: the feed sampler on the Feed Lab parser contract ---- */
console.log('· F8 sampler (blank-in-attribute rows first, reservoir over the rest)');
const HDR = ['g:id', 'g:title', 'g:link', 'g:colour', 'g:material', 'g:product_highlight(1)', 'g:product_highlight(2)'];
const S = P.sampler(5, 'material');
S.onRow(HDR.slice(), HDR);
for (let i = 1; i <= 40; i++) S.onRow([String(i), 'Item ' + i, i === 7 ? '' : 'https://x.com/p/' + i, 'Blue', i <= 10 ? '' : 'Cotton', '', i % 2 ? 'Soft' : ''], HDR);
const picked = S.pick();
t('5 picked, every one blank in material', picked.length === 5 && picked.every((x) => x.row.material === ''), JSON.stringify(picked.map((x) => x.id)));
t('rows without a link are skipped (id 7 never sampled), seen counts all 40', picked.every((x) => x.id !== '7') && S.seen() === 40 && S.blank() === 9);
t('colour column maps onto color; numbered highlight slots collapse onto product_highlight', picked[0].row.color === 'Blue' && picked.some((x) => x.row.product_highlight === 'Soft' || x.row.product_highlight === ''));
const S2 = P.sampler(50, 'material'); S2.onRow(HDR.slice(), HDR);
for (let i = 1; i <= 40; i++) S2.onRow([String(i), 'Item ' + i, 'https://x.com/p/' + i, 'Blue', i <= 10 ? '' : 'Cotton', '', ''], HDR);
const p2 = S2.pick();
t('when the sample is larger than the feed: blank rows first, then the rest, no duplicates', p2.length === 40 && p2.slice(0, 10).every((x) => x.row.material === '') && new Set(p2.map((x) => x.id)).size === 40);
const S3 = P.sampler(3, ''); S3.onRow(HDR.slice(), HDR); S3.onRow(['1', 'a', 'https://x.com/1', '', '', '', ''], HDR); S3.onRow(['2', 'b', 'https://x.com/2', '', '', '', ''], HDR);
t('no attribute focus → any row qualifies', S3.pick().length === 2);
const S4 = P.sampler(2, 'material'); const H4 = ['id', 'link']; S4.onRow(H4.slice(), H4); S4.onRow(['1', 'https://x.com/1'], H4); const H4b = ['id', 'link', 'g:material']; S4.onRow(['2', 'https://x.com/2', 'Wool'], H4b);
t('a header that GROWS mid-stream (late-debut tag) re-resolves the columns', S4.pick().length === 2 && S4.pick().some((x) => x.row.material === 'Wool'));
t('CSV contract (no header arg on later rows) works too', (() => { const c = P.sampler(2, 'color'); c.onRow(['id', 'link', 'color']); c.onRow(['9', 'https://x/9', '']); return c.pick().length === 1 && c.pick()[0].row.color === ''; })());

/* ---- F9: matrix + supplemental CSV ---- */
console.log('· F9 recovery matrix + supplemental CSV');
const results = [{ map: M1, ex: E1 }, { map: P.mapToGolden(R2, E2), ex: E2 }, { map: P.mapToGolden(R3, E3), ex: E3 }, { map: P.mapToGolden(R4, E4), ex: E4 }, { error: 'HTTP 403', map: null }];
const MX = P.matrix(results);
t('n counts every result, ok only the parsed ones', MX.n === 5 && MX.ok === 4);
t('material: 4 blank in feed, 3 found (a pet supplement has none) → 75%', MX.attrs.material.blank === 4 && MX.attrs.material.found === 3 && MX.attrs.material.rate === 75, JSON.stringify(MX.attrs.material));
t('related_product counts as signal, not found', MX.attrs.related_product.found === 0 && MX.attrs.related_product.signal >= 2);
t('examples carry value + source + evidence', MX.attrs.material.examples[0].v === 'Polyester' && MX.attrs.material.examples[0].src === 'text' && /Outer:/.test(MX.attrs.material.examples[0].ev));
t('an attribute never blank has rate null; brand recovered everywhere it was blank', P.matrix([{ map: { id: 'z', rows: { material: { feed: 'Cotton', pdp: '', state: 'feed' } } } }]).attrs.material.rate === null && MX.attrs.brand.rate === 100);
const csv = P.supplementalCsv(results);
const hdr = csv.split('\n')[0];
t('CSV header = id + only the attributes something was recovered for (colour from F2, never the related_product signal)', /^id,g:/.test(hdr) && hdr.indexOf('g:material') > 0 && hdr.indexOf('g:color') > 0 && hdr.indexOf('g:related_product') < 0 && hdr.indexOf('g:sale_price') < 0, hdr);
t('CSV rows = one per SKU with a recovered value, comma-bearing values quoted', csv.split('\n').length === 5 && /"Composition:Outer:Polyester 100% Lining: Polyester 100% Lace: Cotton 32% , Polyamide 46%/.test(csv), csv.split('\n')[1].slice(0, 120));

/* ---- F10: the AI pass is evidence-gated ---- */
console.log('· F10 AI pass (prompt shape, tolerant parse, evidence + vocab guards)');
const pr = P.llmPrompt([{ id: 'A1', title: 'Tee', details: 'Title: Tee\nMaterial: Organic Cotton 100%\nRelaxed fit', have: 'brand', need: 'material, size_type' }]);
t('prompt asks for STRICT JSON with verbatim evidence and names the product ids', /STRICT JSON/.test(pr.system) && /VERBATIM/.test(pr.system) && /id: A1/.test(pr.prompt) && /Return the JSON for all 1 products/.test(pr.prompt));
t('parseLlm tolerates fences and prose around the JSON', JSON.stringify(P.parseLlm('Sure!\n```json\n{"items":[{"id":"A1","attrs":{"material":{"v":"Cotton","ev":"Organic Cotton 100%"}}}]}\n```')) === '[{"id":"A1","attrs":{"material":{"v":"Cotton","ev":"Organic Cotton 100%"}}}]');
t('parseLlm returns null on garbage', P.parseLlm('no json here') === null && P.parseLlm('{"items":"nope"}') === null && P.parseLlm('') === null);
const exA = { attrs: {}, details: 'Title: Tee\nMaterial: Organic Cotton 100%\nRelaxed fit – the classic cut\nSizes shown are UK sizes' };
const added = P.mergeLlm(exA, { material: { v: 'Cotton', ev: 'Organic Cotton 100%' }, size_type: { v: 'regular', ev: 'Relaxed fit – the classic cut' }, size_system: { v: 'uk', ev: 'UK sizes' },
  gender: { v: 'Men', ev: 'Relaxed fit' }, color: { v: 'Blue', ev: 'a colour the page never states' }, gtin: { v: '5012345678900', ev: 'Organic Cotton 100%' }, product_highlight: { v: 'Relaxed fit – the classic cut | Organic Cotton 100% ', ev: 'Relaxed fit' } });
t('evidence found in the page text → accepted (material, size_type, size_system upper-cased)', exA.attrs.material && exA.attrs.material.v === 'Cotton' && exA.attrs.material.src === 'ai' && exA.attrs.size_type.v === 'regular' && exA.attrs.size_system.v === 'UK');
t('evidence NOT in the page text → dropped (color)', !exA.attrs.color);
t('vocab enforced (gender "Men" is not male|female|unisex → dropped)', !exA.attrs.gender);
t('identifiers are never taken from the AI (gtin ignored)', !exA.attrs.gtin && added.indexOf('gtin') < 0);
t('product_highlight joined and trimmed', exA.attrs.product_highlight && exA.attrs.product_highlight.v === 'Relaxed fit – the classic cut | Organic Cotton 100%');
const exB = { attrs: { material: { v: 'Polyester', src: 'text', ev: 'x' } }, details: 'Material: Cotton' };
P.mergeLlm(exB, { material: { v: 'Cotton', ev: 'Material: Cotton' } });
t('deterministic wins over the AI (material stays Polyester/text)', exB.attrs.material.v === 'Polyester' && exB.attrs.material.src === 'text');
t('mergeLlm is null-safe', P.mergeLlm({ attrs: {}, details: '' }, null).length === 0 && P.mergeLlm({ attrs: {}, details: '' }, 'x').length === 0);

/* ---- F11: value normalisers ---- */
console.log('· F11 normalisers');
t('materialFrom: dominant % of the first section, 100% either order, label-only', P.materialFrom('Outer: Elastane 7% , Metallised Fibre 2% , Polyamide 91% Lining: Elastane 8% , Polyester 92%') === 'Polyamide' && P.materialFrom('100% Cotton') === 'Cotton' && P.materialFrom('Cotton 100%') === 'Cotton' && P.materialFrom('Material: Leather') === 'Leather' && P.materialFrom('Free delivery') === '');
t('patternFrom: vocabulary only, label tolerated, long lines rejected', P.patternFrom('Plain') === 'Plain' && P.patternFrom('Pattern: Floral') === 'Floral' && P.patternFrom('Solid') === 'Plain' && P.patternFrom('This dress has a floral print all over it') === '' && P.patternFrom('Blue') === '');
t('normGender / normAge', P.normGender("Women's") === 'female' && P.normGender('Mens') === 'male' && P.normGender('Unisex') === 'unisex' && P.normGender('Blue') === '' && P.normAge('Kids') === 'kids' && P.normAge('Baby') === 'infant' && P.normAge('Womens') === 'adult');
t('normKey strips g:, lower-cases, colour→color', P.normKey('g:Colour') === 'color' && P.normKey('G:Product_Type') === 'product_type');
t('GOLDEN_KEYS never includes the required seven or price fields', ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'sale_price', 'google_product_category'].every((k) => P.GOLDEN_KEYS.indexOf(k) < 0) && P.GOLDEN_KEYS.length === 22);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
