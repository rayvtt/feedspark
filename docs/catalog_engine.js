/*
 * FeedSpark catalogue engine — the product catalogue as the client SENT it (the master feed
 * FeedHero imports) against the catalogue FeedSpark SENDS (the output feed Google reads), field
 * by field (Ray, 28 Sep 2026: "a module to browse / view / track / deep dive product catalogs …
 * when you hover over an image or product, you should have access to … the master feed source …
 * the product data before FeedSpark optimization … a smooth transition of before and after
 * between pre-optimization, update population, data optimization, and data enrichment … which
 * field existed vs. didn't, which field is structured vs. didn't, which field is enriched vs
 * didn't").
 *
 * One file, two lanes: the /catalog page (window.FeedCatalog, served verbatim at
 * /catalog/engine.js) and tools/test_catalog.mjs (require()). PURE — no fetch, no DOM, no
 * DecompressionStream: the page inflates, this reads.
 *
 * THE JOIN IS READ OFF THE FEEDS, NEVER ASSUMED. Every FeedHero output item carries
 * c:fs_data_original_id — the master row it was built from. Which master COLUMN holds that id
 * differs per client (YuMOVE's Shopify export keeps it in `id` while `product_id` is the parent,
 * Monsoon's XML in `g:id`, Reiss's TSV beside an `ItemNo`), so detectJoin() tests every column
 * against the output's own ids and takes the one that actually hits.
 *
 * SEVEN STATUSES, FOUR STAGES — one vocabulary for a field's history, the stages Ray named:
 *   ① Master      kept        the client's value, passed through untouched
 *   ② Populated   populated   a gap filled with data the master never carried (core attributes)
 *                 structured  (lift) the value WAS in the master, unstructured — in the title, a
 *                             description, another column — and now sits in its own attribute
 *   ③ Optimised   structured  (format / remap) same information, rewritten to Google's spec:
 *                             "£76.00" → "76.00 GBP", IN_STOCK → in stock, was_price → price
 *                 optimised   the content itself rewritten (a title, a category tree, an image
 *                             overlay)
 *                 dropped     the master had it, the feed does not
 *   ④ Enriched    enriched    new information beyond the master's schema (highlights, product
 *                             details, material, custom labels, keyword slots, AI attributes)
 *   —             missing     neither side has it
 * The three questions Ray asked are three readings of that one record: EXISTED = the master
 * carried a value; STRUCTURED = the value FeedSpark sends passes Google's own format for that
 * attribute (spec()); ENRICHED = FeedSpark added or changed the information.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.0.0';
  function s0(v) { return v == null ? '' : String(v); }
  function has(v) { return Array.isArray(v) ? v.length > 0 : s0(v).trim() !== ''; }

  // ---- text ------------------------------------------------------------------------------------
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', hellip: '…',
    ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', trade: '™',
    reg: '®', copy: '©', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü',
    ouml: 'ö', auml: 'ä', szlig: 'ß', deg: '°', frac34: '¾', frac12: '½', times: '×' };
  function decode1(s) {
    return s0(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, function (m, e) {
      if (e.charAt(0) === '#') {
        var n = (e.charAt(1) === 'x' || e.charAt(1) === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return (isFinite(n) && n > 0 && n < 0x110000) ? String.fromCodePoint(n) : m;
      }
      var k = e.toLowerCase(); return ENT[k] != null ? ENT[k] : m;
    });
  }
  // master exports are often escaped TWICE (Reiss's additional_description arrives as &lt;p&gt;)
  function decode(s) { var t = decode1(s); return /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/i.test(t) ? decode1(t) : t; }
  function stripTags(s) { return s0(s).replace(/<[^>]*>/g, ' '); }
  function squash(s) { return s0(s).replace(/[\s ​]+/g, ' ').trim(); }
  // the value as a reader sees it: entities decoded, tags gone, whitespace collapsed
  function plain(s) { return squash(stripTags(decode(s))); }
  function low(s) { return plain(s).toLowerCase(); }
  function cap(s, n) { s = s0(s); return s.length > n ? s.slice(0, n) : s; }
  function escRe(s) { return s0(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ---- header keys: one naming for three sources ----------------------------------------------
  // The MCP names repeats g:additional_image_link_1, _2 and nests with -> ; the Feed Lab parser
  // names them g:product_highlight, g:product_highlight(2); a delimited export simply repeats the
  // heading (Reiss: four columns called additional_image_link). All three land on {base, rep}.
  // An attribute column (the MCP's c:drid@type) is not a value — null.
  var REPEAT = /^(additionalimagelink|producthighlight|productdetail|producttype|variantoption|relatedproduct|questionandanswer|documentlink)(\d+)$/;
  function hkey(h) {
    var s = s0(h).replace(/^﻿/, '').trim().replace(/\s+type=.*$/i, '');
    if (!s || s.indexOf('@') >= 0) return null;
    var rep = 0, m = /\((\d+)\)\s*$/.exec(s);
    if (m) { rep = +m[1] - 1; s = s.slice(0, m.index); }
    s = s.replace(/(^|->|\/|\.)\s*[a-z]{1,4}:/gi, '$1');
    var base = s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!base) return null;
    if ((m = REPEAT.exec(base))) { base = m[1]; rep = Math.max(rep, +m[2]); }
    else if ((m = /^image(\d+)(url|link)?$/.exec(base))) { base = 'imagen'; rep = +m[1] - 1; }   // Schuh image1URL…image4URL — the first is the main image
    return { base: base, rep: rep };
  }

  // ---- the attributes a product is read on, in the order the inspector lists them --------------
  // tier: req = Google-required · cond = required in some cases · rec = recommended · ai = the
  // conversational six · camp = campaign structure. core = a gap here filled is POPULATION (the
  // attribute the product should always have had); anything else new is ENRICHMENT.
  var ATTRS = [
    { k: 'id', g: 'Identity', l: 'ID', kind: 'code', tier: 'req' },
    { k: 'item_group_id', g: 'Identity', l: 'Item group', kind: 'code', tier: 'cond' },
    { k: 'gtin', g: 'Identity', l: 'GTIN', kind: 'gtin', tier: 'cond' },
    { k: 'mpn', g: 'Identity', l: 'MPN', kind: 'code', tier: 'cond' },
    { k: 'brand', g: 'Identity', l: 'Brand', kind: 'short', tier: 'cond' },
    { k: 'identifier_exists', g: 'Identity', l: 'Identifier exists', kind: 'vocab', tier: 'cond' },
    { k: 'condition', g: 'Identity', l: 'Condition', kind: 'vocab', tier: 'cond' },
    { k: 'title', g: 'Content', l: 'Title', kind: 'text', tier: 'req' },
    { k: 'short_title', g: 'Content', l: 'Short title', kind: 'text', tier: 'rec' },
    { k: 'description', g: 'Content', l: 'Description', kind: 'text', tier: 'req' },
    { k: 'product_highlight', g: 'Content', l: 'Highlights', kind: 'list', tier: 'rec' },
    { k: 'product_detail', g: 'Content', l: 'Product details', kind: 'list', tier: 'rec' },
    { k: 'price', g: 'Offer', l: 'Price', kind: 'money', tier: 'req' },
    { k: 'sale_price', g: 'Offer', l: 'Sale price', kind: 'money', tier: 'rec', core: 1 },
    { k: 'availability', g: 'Offer', l: 'Availability', kind: 'vocab', tier: 'req' },
    { k: 'shipping', g: 'Offer', l: 'Shipping', kind: 'money', tier: 'rec', core: 1 },
    { k: 'google_product_category', g: 'Taxonomy', l: 'Google category', kind: 'path', tier: 'rec', core: 1 },
    { k: 'product_type', g: 'Taxonomy', l: 'Product type', kind: 'path', tier: 'rec', core: 1 },
    { k: 'keywords', g: 'Taxonomy', l: 'Keyword slots', kind: 'list', tier: 'rec' },
    { k: 'color', g: 'Attributes', l: 'Colour', kind: 'color', tier: 'cond' },
    { k: 'size', g: 'Attributes', l: 'Size', kind: 'short', tier: 'cond' },
    { k: 'gender', g: 'Attributes', l: 'Gender', kind: 'vocab', tier: 'cond' },
    { k: 'age_group', g: 'Attributes', l: 'Age group', kind: 'vocab', tier: 'cond' },
    { k: 'material', g: 'Attributes', l: 'Material', kind: 'short', tier: 'rec' },
    { k: 'pattern', g: 'Attributes', l: 'Pattern', kind: 'short', tier: 'rec' },
    { k: 'size_type', g: 'Attributes', l: 'Size type', kind: 'vocab', tier: 'rec', core: 1 },
    { k: 'size_system', g: 'Attributes', l: 'Size system', kind: 'vocab', tier: 'rec', core: 1 },
    { k: 'image_link', g: 'Media', l: 'Main image', kind: 'image', tier: 'req' },
    { k: 'additional_image_link', g: 'Media', l: 'More images', kind: 'images', tier: 'rec' },
    { k: 'link', g: 'Links', l: 'Product page', kind: 'url', tier: 'req' },
    { k: 'canonical_link', g: 'Links', l: 'Canonical link', kind: 'url', tier: 'rec', core: 1 },
    { k: 'item_group_title', g: 'AI-ready', l: 'Group title', kind: 'text', tier: 'ai' },
    { k: 'variant_option', g: 'AI-ready', l: 'Variant options', kind: 'list', tier: 'ai' },
    { k: 'question_and_answer', g: 'AI-ready', l: 'Q & A', kind: 'list', tier: 'ai' },
    { k: 'document_link', g: 'AI-ready', l: 'Document link', kind: 'list', tier: 'ai' },
    { k: 'related_product', g: 'AI-ready', l: 'Related products', kind: 'list', tier: 'ai' },
    { k: 'popularity_rank', g: 'AI-ready', l: 'Popularity rank', kind: 'short', tier: 'ai' },
    { k: 'custom_label_0', g: 'Campaign', l: 'Custom label 0', kind: 'short', tier: 'camp' },
    { k: 'custom_label_1', g: 'Campaign', l: 'Custom label 1', kind: 'short', tier: 'camp' },
    { k: 'custom_label_2', g: 'Campaign', l: 'Custom label 2', kind: 'short', tier: 'camp' },
    { k: 'custom_label_3', g: 'Campaign', l: 'Custom label 3', kind: 'short', tier: 'camp' },
    { k: 'custom_label_4', g: 'Campaign', l: 'Custom label 4', kind: 'short', tier: 'camp' }
  ];
  var ATTR = {}; ATTRS.forEach(function (a) { a.core = !!(a.core || a.tier === 'req' || a.tier === 'cond'); ATTR[a.k] = a; });
  var GROUPS = ['Identity', 'Content', 'Offer', 'Taxonomy', 'Attributes', 'Media', 'Links', 'AI-ready', 'Campaign'];
  // the strip each table row wears: one cell per attribute, coloured by what happened to it
  var DNA = ['title', 'description', 'price', 'sale_price', 'availability', 'brand', 'gtin', 'google_product_category',
    'product_type', 'keywords', 'color', 'size', 'gender', 'age_group', 'material', 'pattern', 'product_highlight',
    'product_detail', 'image_link', 'additional_image_link', 'custom_label_0'];

  var STATUS = ['kept', 'structured', 'populated', 'optimised', 'enriched', 'dropped', 'missing'];
  var STATUS_LABEL = { kept: 'Kept', structured: 'Structured', populated: 'Populated', optimised: 'Optimised',
    enriched: 'Enriched', dropped: 'Dropped', missing: 'Missing', unknown: 'No master row' };
  var STAGES = [
    { k: 0, l: 'Master', d: 'as the client sent it' },
    { k: 1, l: 'Populated', d: 'gaps filled' },
    { k: 2, l: 'Optimised', d: 'rewritten to spec' },
    { k: 3, l: 'Enriched', d: 'new data added' }
  ];

  // ---- where each attribute lives in a master feed (normalised heading bases, priority order) ---
  // Order matters only for which master value is SHOWN as "before" when nothing matches exactly:
  // classify() compares the output against EVERY candidate, so a wide list costs nothing and the
  // column that actually supplied the value is named (the provenance GMC shows per attribute).
  var ALIAS = {
    id: ['id', 'itemid', 'offerid', 'variantid', 'sku', 'productid', 'itemno'],
    item_group_id: ['itemgroupid', 'parentid', 'groupid', 'styleid', 'parentsku', 'productgroupid'],
    gtin: ['gtin', 'ean', 'barcode', 'upc', 'ean13', 'gtin13', 'isbn', 'jan'],
    mpn: ['mpn', 'manufacturerpartnumber', 'partnumber', 'sku', 'itemno'],
    brand: ['brand', 'vendor', 'manufacturer', 'brandname', 'designer', 'label'],
    identifier_exists: ['identifierexists'],
    condition: ['condition', 'itemcondition'],
    // NOT 'productname' — on Reiss that is the style name ("Indira"), not the title
    title: ['title', 'name', 'producttitle', 'itemname'],
    short_title: ['shorttitle'],
    // Reiss leaves `description` empty on most rows and carries it in `additional_description`
    description: ['description', 'productdescription', 'longdescription', 'bodyhtml', 'additionaldescription', 'shortdescription'],
    product_highlight: ['producthighlight', 'highlights', 'keyfeatures', 'features', 'bulletpoints'],
    product_detail: ['productdetail', 'details', 'specifications'],
    price: ['price', 'wasprice', 'compareatprice', 'regularprice', 'rrp', 'mrrp', 'listprice', 'fullprice', 'originalprice'],
    // a sale price the master STATES; the one it merely implies (a current price under a higher
    // was / compare-at price) is added by cands() — never the regular price on its own, or every
    // promotion FeedSpark runs would read as a "reprice" of the client's price
    sale_price: ['saleprice', 'specialprice', 'promoprice', 'offerprice'],
    availability: ['availability', 'stockstatus', 'instock', 'availabilitystatus'],
    // NOT an output attribute — the master's own stock COUNT, read only by masterStock() when the master
    // states no availability word (many client masters carry a quantity and let the feed say in/out)
    stock_qty: ['quantity', 'qty', 'stock', 'stocklevel', 'stockquantity', 'stockqty', 'inventory', 'inventoryquantity',
      'quantityavailable', 'availablequantity', 'availableqty', 'onhand', 'stockonhand', 'freestock', 'units'],
    shipping: ['shipping', 'shippingprice', 'shippingcost', 'deliverycost'],
    google_product_category: ['googleproductcategory', 'gpc', 'googlecategory', 'googlecategoryid'],
    product_type: ['producttype', 'category', 'categories', 'collcategory', 'categorypath', 'type', 'itemtype', 'productcategory', 'categoryid', 'department'],
    keywords: [],
    color: ['color', 'colour', 'brandcolour', 'genericcolour', 'colourname', 'colorname', 'basecolour'],
    size: ['size', 'displaysize', 'mappedsize', 'sizename', 'shoesize', 'webattribute2', 'option1'],
    gender: ['gender', 'sex', 'targetgender'],
    age_group: ['agegroup', 'age', 'targetage'],
    // NOT composition — that is where material is EXTRACTED from (a lift), not the same field; reading
    // it as the alias called every product FeedSpark had not yet extracted a material for "dropped"
    material: ['material', 'fabric'],
    pattern: ['pattern', 'print'],
    size_type: ['sizetype'],
    size_system: ['sizesystem'],
    image_link: ['imagelink', 'imagen', 'image', 'imageurl', 'mainimage', 'media'],
    additional_image_link: ['additionalimagelink', 'imagen', 'media', 'images', 'alternateimages'],
    link: ['link', 'url', 'producturl', 'onlinestoreurl', 'deeplink', 'pdpurl', 'adsredirect', 'shorturl'],
    canonical_link: ['canonicallink'],
    item_group_title: ['itemgrouptitle'],
    variant_option: ['variantoption'],
    question_and_answer: ['questionandanswer'],
    document_link: ['documentlink'],
    related_product: ['relatedproduct'],
    popularity_rank: ['popularityrank'],
    custom_label_0: ['customlabel0'], custom_label_1: ['customlabel1'], custom_label_2: ['customlabel2'],
    custom_label_3: ['customlabel3'], custom_label_4: ['customlabel4']
  };

  // ---- the output side: header base → attribute --------------------------------------------------
  var OUT_ATTR = {};
  ATTRS.forEach(function (a) { OUT_ATTR[a.k.replace(/_/g, '')] = a.k; });
  OUT_ATTR.colour = 'color';
  var OUT_LIST = { additional_image_link: 1, product_highlight: 1, product_detail: 1, product_type: 1, variant_option: 1,
    related_product: 1, question_and_answer: 1, document_link: 1 };
  // FeedSpark's own stamps on every FeedHero output item
  var STAMP = { fsdataopti: 'opti', fsdataoriginaltitle: 'otitle', fsdataoriginalid: 'oid', titlefield: 'tfield', fsdateofbirth: 'dob' };
  var OPTI_KEYS = [
    { k: 'T', l: 'Title' }, { k: 'Cat', l: 'Category' }, { k: 'Keywords', l: 'Keywords' },
    { k: 'D', l: 'Description' }, { k: 'IMG', l: 'Image' }, { k: 'ID', l: 'Identifiers' }
  ];
  // "T:Y|Cat:N|Keywords:N|D:Y|IMG:Y|ID:N" → {T:true, Cat:false, …}; keys this list does not know are kept
  function opti(v) {
    var out = {}; s0(v).split('|').forEach(function (p) {
      var m = /^\s*([A-Za-z_]+)\s*:\s*([A-Za-z]+)\s*$/.exec(p); if (m) out[m[1]] = /^(y|yes|true|1)$/i.test(m[2]);
    });
    return out;
  }

  var DESC_CAP = 1600, VAL_CAP = 600, META_CAP = 300;
  // A tag with CHILDREN reaches the parser as its inner XML (the Feed Lab parser keeps an item
  // flat): <g:variant_option><g:name>Size</g:name><g:value>Small</g:value></g:variant_option>
  // reads "Size: Small", a shipping block "GB: Standard: 0.00 GBP", a product_detail
  // "General: Neckline: V-neck".
  var NESTED = { shipping: 1, product_detail: 1, variant_option: 1, question_and_answer: 1, document_link: 1, related_product: 1 };
  function nestedText(v) {
    var s = s0(v); if (s.indexOf('<') < 0) return squash(decode(s));
    var parts = [];
    s.replace(/<([A-Za-z0-9_.:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g, function (m, t, x) { var y = plain(x); if (y) parts.push(y); return m; });
    return parts.length ? parts.join(': ') : plain(s);
  }
  // which output column is what — worked out ONCE per header (the header grows when a sparse tag
  // debuts deep in the feed, so the page re-plans on growth), never per row
  function outPlan(header) {
    return (header || []).map(function (h, i) {
      var k = hkey(h); if (!k) return null;
      if (STAMP[k.base]) return { i: i, st: STAMP[k.base] };
      var a = OUT_ATTR[k.base];
      if (a) return { i: i, a: a };
      return { i: i, meta: s0(h).replace(/\s+type=.*$/i, '').trim() };
    }).filter(Boolean);
  }
  function blank() { return { f: {}, x: {}, id: '', oid: '', opti: null, otitle: '', tfield: '', dob: '', _pt: [] }; }
  function addVal(p, a, v) {
    var t = a === 'description' ? cap(plain(v), DESC_CAP) : (NESTED[a] ? cap(nestedText(v), VAL_CAP) : cap(squash(decode(v)), VAL_CAP));
    if (!t) return;
    if (a === 'product_type') { p._pt.push(t); return; }
    if (OUT_LIST[a]) (p.f[a] = p.f[a] || []).push(t);
    else if (p.f[a] == null) p.f[a] = t;
  }
  // On Reiss, Schuh and Hobbycraft the SECOND product_type slot of every item holds md5(g:id) — a
  // FeedHero hash, not a keyword — so a 32-hex value is never counted as a keyword slot
  var MD5 = /^[0-9a-f]{32}$/i;
  function seal(p) {
    if (p._pt.length) {
      p.f.product_type = p._pt[0];
      var kw = p._pt.slice(1).filter(function (v) { return !MD5.test(v.trim()); });
      if (kw.length) p.f.keywords = kw;
    }
    delete p._pt;
    p.id = s0(p.f.id); p.oid = p.oid || p.id;
    return p;
  }
  // one parsed row (an array aligned to the header) → the compact product the page keeps
  function outRow(pl, row) {
    var p = blank();
    for (var j = 0; j < pl.length; j++) {
      var c = pl[j], v = row[c.i]; if (v == null || v === '') continue;
      if (c.st) { var sv = plain(v); if (c.st === 'opti') p.opti = opti(sv); else p[c.st] = sv; }
      else if (c.a) addVal(p, c.a, v);
      else { var xv = plain(v); if (xv) p.x[c.meta] = cap(xv, META_CAP); }
    }
    return seal(p);
  }
  // the same from an object {key: value | [values]} — the harness and any caller holding objects
  function outRecord(obj) {
    var hs = Object.keys(obj || {}), row = [], header = [];
    hs.forEach(function (h) { var v = obj[h]; (Array.isArray(v) ? v : [v]).forEach(function (x) { header.push(h); row.push(x); }); });
    return outRow(outPlan(header), row);
  }

  // ---- normalisation: what makes two values "the same information" ---------------------------------
  var CUR = { '£': 'GBP', '€': 'EUR', '$': 'USD', '¥': 'JPY' };
  function money(v) {
    var s = plain(v); if (!s) return null;
    var cur = null, m = /\b([A-Z]{3})\b/.exec(s);
    if (m) cur = m[1]; else if ((m = /[£€$¥]/.exec(s))) cur = CUR[m[0]];
    var num = s.replace(/[^0-9.,]/g, ''); if (!num || !/\d/.test(num)) return null;
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(num)) num = num.replace(/\./g, '').replace(',', '.');   // 1.234,50
    else if (/^\d+,\d{1,2}$/.test(num)) num = num.replace(',', '.');                              // 12,50
    else num = num.replace(/,/g, '');                                                             // 1,234.50
    var a = parseFloat(num);
    return isFinite(a) ? { a: Math.round(a * 100) / 100, cur: cur } : null;
  }
  function amt(v) { var m = money(v); return m ? m.a.toFixed(2) : ''; }
  var VOCAB = {
    availability: function (s) {
      s = s.replace(/[\s_\-]+/g, '');
      if (/^(instock|available|yes|true|1|limitedstock|lowstock|limitedavailability)$/.test(s)) return 'in_stock';
      if (/^(outofstock|soldout|unavailable|no|false|0|discontinued)$/.test(s)) return 'out_of_stock';
      if (/^preorder/.test(s)) return 'preorder';
      if (/^backorder/.test(s)) return 'backorder';
      return s;
    },
    gender: function (s) {
      s = s.replace(/[^a-z]/g, '');
      if (/^(female|women|womens|woman|ladies|lady|womenswear|womans|f)$/.test(s)) return 'female';
      if (/^(male|men|mens|man|menswear|m)$/.test(s)) return 'male';
      if (/^(unisex|u|both)$/.test(s)) return 'unisex';
      return s;
    },
    age_group: function (s) {
      s = s.replace(/[^a-z]/g, '');
      if (/^(adult|adults|grownup)$/.test(s)) return 'adult';
      if (/^(kids|kid|children|child|junior|juniors|youth)$/.test(s)) return 'kids';
      if (/^(toddler|toddlers)$/.test(s)) return 'toddler';
      if (/^(infant|infants|baby|babies)$/.test(s)) return 'infant';
      if (/^(newborn|newborns)$/.test(s)) return 'newborn';
      return s;
    },
    condition: function (s) { s = s.replace(/[^a-z]/g, ''); return /^(new|brandnew)$/.test(s) ? 'new' : /^(used|preowned|secondhand)$/.test(s) ? 'used' : /refurb/.test(s) ? 'refurbished' : s; },
    identifier_exists: function (s) { return /^(yes|true|y|1)$/.test(s) ? 'yes' : /^(no|false|n|0)$/.test(s) ? 'no' : s; },
    size_type: function (s) { return s.replace(/[^a-z]/g, ''); },
    size_system: function (s) { return s.replace(/[^a-z]/g, ''); }
  };
  function urlKey(v) {
    var s = plain(v); if (!s) return '';
    s = s.replace(/^http:\/\//i, 'https://')
      .replace(/([?&])(utm_[a-z_]+|glcountry|gclid|srsltid|_ga)=[^&#]*/gi, '$1').replace(/[?&]+(?=#|$)/, '').replace(/\?&+/, '?').replace(/&&+/g, '&')
      .replace(/\/+(?=[?#]|$)/, '');
    return s.replace(/^(https:\/\/[^/?#]+)/i, function (h) { return h.toLowerCase(); });
  }
  function imgKey(v) { return urlKey(v).replace(/[?#].*$/, '').toLowerCase(); }
  // every URL a master cell holds: a comma list (YuMOVE), a JSON blob (Superdry's `media`), one URL
  function urls(v) {
    var s = decode(s0(v)), out = [];
    s.split(/\s*,\s*(?=https?:\/\/)|\s*\|\s*(?=https?:\/\/)/i).forEach(function (part) {
      var re = /https?:\/\/[^\s"'<>|\\]+/gi, m;
      while ((m = re.exec(part))) out.push(m[0].replace(/[),.;\]}]+$/, ''));
    });
    return out;
  }
  function pathKey(v) {
    return plain(v).replace(/^[\s{\[(]+|[\s}\])]+$/g, '').split(/\s*(?:>|›|»|\|)\s*/)
      .map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean).join(' > ');
  }
  function gtinKey(v) { return s0(v).replace(/\D/g, '').replace(/^0+/, ''); }
  function colorKey(v) { return low(v).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*[\/,&+]\s*|\s+and\s+/g, '/').replace(/\s+/g, ' ').trim(); }
  // the comparable form of a value for attribute k (a list compares as a sorted set)
  function norm(k, v) {
    var a = ATTR[k] || { kind: 'short' };
    if (Array.isArray(v)) return v.map(function (x) { return norm(k, x); }).filter(Boolean).sort().join('\n');
    switch (a.kind) {
      case 'money': return amt(v);
      case 'vocab': return (VOCAB[k] || function (s) { return s; })(low(v));
      case 'path': return pathKey(v);
      case 'url': return urlKey(v).toLowerCase();
      case 'image': case 'images': return imgKey(v);
      case 'gtin': return gtinKey(v);
      case 'color': return colorKey(v);
      case 'code': return low(v).replace(/\s+/g, '');
      // FeedHero strips a description's HTML WITHOUT putting a space where a tag was ("jerseySubtle
      // stretch"), so two texts are the same information when they match with the spaces taken out
      case 'text': return low(v).replace(/[\s\u00a0]+/g, '');
      default: return low(v);
    }
  }
  // a FeedSpark image-overlay host — the image was composed, not re-hosted (docs/overlay_engine.js reads the type)
  function isOverlay(u) { return /^https?:\/\/(dashboard\.feedspark\.com|lia\.feedspark\.com|[a-z0-9.-]*feed5\.com)\//i.test(s0(u)); }
  // the source image an overlay URL was composed from (img_url= / img_url_left=), when it says
  function overlaySource(u) {
    var m = /[?&](?:img_url|img_url_left|image_url|src)=([^&#]+)/i.exec(s0(u)); if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  // ---- the master side ------------------------------------------------------------------------------
  // plan(headers): which columns feed which attribute, in priority order; the join column is chosen
  // separately (detectJoin) because it is a property of the DATA, not of the heading.
  function plan(headers) {
    var cols = (headers || []).map(function (h, i) { var k = hkey(h); return { i: i, h: s0(h), base: k ? k.base : '', rep: k ? k.rep : 0 }; });
    var attr = {};
    Object.keys(ALIAS).forEach(function (a) {
      var list = [];
      ALIAS[a].forEach(function (b) { cols.forEach(function (c) { if (c.base === b && list.indexOf(c.i) < 0) list.push(c.i); }); });
      attr[a] = list;
    });
    return { cols: cols, attr: attr, join: -1, joinH: '' };
  }
  function idKey(v) { return plain(v).toLowerCase(); }
  // which master column carries the ids the output feed was built from. rows = a sample of master
  // rows (arrays), ids = a Set of the output's c:fs_data_original_id (or g:id) values, idKey'd.
  function detectJoin(p, rows, ids) {
    var pri = {}; ALIAS.id.forEach(function (b, i) { pri[b] = ALIAS.id.length - i; });
    var ranked = p.cols.filter(function (c) { return c.base; }).map(function (c) {
      var hit = 0, seen = 0;
      for (var r = 0; r < rows.length; r++) {
        var v = idKey(rows[r][c.i]); if (!v) continue; seen++; if (ids.has(v)) hit++;
      }
      return { i: c.i, h: c.h, hit: hit, seen: seen, score: hit + (pri[c.base] || 0) / 100 };
    }).sort(function (a, b) { return b.score - a.score; });
    var best = ranked[0] || null, second = ranked[1] || null;
    if (!best || !best.hit) return { col: -1, h: '', hit: 0, rate: 0, second: second ? second.h : '' };
    return { col: best.i, h: best.h, hit: best.hit, seen: best.seen, rate: rows.length ? best.hit / rows.length : 0,
      second: second ? second.h : '', secondHit: second ? second.hit : 0 };
  }
  // the master cells a product keeps: every column, long ones capped (the inspector shows the raw row)
  function masterCells(cells) {
    var out = new Array(cells.length);
    for (var i = 0; i < cells.length; i++) { var v = s0(cells[i]); out[i] = v.length > DESC_CAP ? v.slice(0, DESC_CAP) : v; }
    return out;
  }
  // the candidate master values for attribute k on one master row: [{h, v}] non-empty, priority order
  function cands(k, cells, p) {
    var out = [], idx = p.attr[k] || [];
    if (k === 'image_link' || k === 'additional_image_link') {
      var all = [];
      idx.forEach(function (i) {
        var c = p.cols[i];
        urls(cells[i]).forEach(function (u, j) {
          var main = (c.base === 'imagelink' || c.base === 'image' || c.base === 'imageurl' || c.base === 'mainimage') ? j === 0
            : (c.base === 'imagen' ? (c.rep === 0 && j === 0) : (c.base === 'media' ? j === 0 : false));
          all.push({ h: c.h, v: u, main: main });
        });
      });
      if (k === 'image_link') { var mn = all.filter(function (x) { return x.main; }); return mn.length ? [mn[0]] : []; }
      // the main image is not a "more images" entry, wherever the master put it — its own column, or
      // repeated at the head of the additional list (YuMOVE's master carries it in both)
      var mainK = {}, mm = all.filter(function (x) { return x.main; })[0], mi = cands('image_link', cells, p)[0];
      if (mm) mainK[imgKey(mm.v)] = 1;
      if (mi) mainK[imgKey(mi.v)] = 1;
      var seen = {}; all.forEach(function (x) { var key = imgKey(x.v); if (mainK[key] || seen[key]) return; seen[key] = 1; out.push({ h: x.h, v: x.v }); });
      return out.length ? [{ h: out[0].h, v: out.map(function (x) { return x.v; }), list: 1 }] : [];
    }
    if (k === 'id' && p.join >= 0) { var jv = s0(cells[p.join]).trim(); return jv ? [{ h: p.joinH, v: jv }] : []; }
    idx.forEach(function (i) { var v = s0(cells[i]); if (v.trim() !== '') out.push({ h: p.cols[i].h, v: v }); });
    if (k === 'sale_price' && !out.length) {
      // PRICE IS A MODEL, not a column (measured on 116,687 real products). Base = `price`. A NOW column
      // below it is the sale price (YuMOVE's bundles carry compare_at_price BELOW price and sell at it);
      // otherwise a WAS column above it makes the base the sale price (Monsoon: g:price £76 beside
      // g:was_price £95). A was-only column below the base is ignored (American Golf's mrrp < price).
      var base = null, now = null, was = null;
      (p.attr.price || []).forEach(function (i) {
        var b = p.cols[i].base, m = money(cells[i]); if (!m) return;
        if (b === 'price') { if (!base) base = { h: p.cols[i].h, v: s0(cells[i]), a: m.a }; }
        else if (b === 'compareatprice') { (now = now || []).push({ h: p.cols[i].h, v: s0(cells[i]), a: m.a }); (was = was || []).push(m.a); }
        else (was = was || []).push(m.a);
      });
      var below = base && now ? now.filter(function (x) { return x.a < base.a; })[0] : null;
      if (below) out.push({ h: below.h, v: below.v });
      else if (base && was && was.some(function (a) { return a > base.a; })) out.push({ h: base.h, v: base.v });
    }
    if (ATTR[k] && ATTR[k].kind === 'list' && out.length) {
      return [{ h: out[0].h, v: out.map(function (x) { return plain(x.v); }).filter(Boolean), list: 1 }];
    }
    return out;
  }

  // ---- one field's history ----------------------------------------------------------------------------
  // LIFT: a short value FeedSpark sends that was already in the master — as a whole word in the
  // title, a category, another column — was STRUCTURED, not invented. Gender and age read their
  // synonyms (a "Women's …" title is where g:gender female came from).
  // Not campaign labels — those are FeedSpark's own structure, new by definition — and not
  // condition, whose "new" sits in half the descriptions of any catalogue.
  var LIFTABLE = { brand: 1, color: 1, size: 1, gender: 1, age_group: 1, material: 1, pattern: 1, size_type: 1,
    item_group_id: 1, mpn: 1, gtin: 1 };
  // gender and age are only read where a product is NAMED or FILED (title, category), never in the
  // description, where "pairs well with women's…" would be mistaken for the product's own gender
  var NAMEISH = /^(title|name|productname|producttitle|itemname|producttype|category|collcategory|type|itemtype|department|categorypath|tags)$/;
  var SYN = { female: 'women|womens|woman|ladies|female', male: 'men|mens|man|male', kids: 'kids|kid|children|childrens|junior|girls|boys',
    adult: 'adult|adults', unisex: 'unisex' };
  var LIFT_PREF = { material: /composition|fabric|fibre|fiber|material/, pattern: /pattern|print/, color: /colou?r/,
    size: /size/, brand: /brand|vendor|manufacturer|designer/, gtin: /gtin|ean|upc|barcode/, mpn: /mpn|sku|style|model/,
    item_group_id: /parent|group|style|productid/, size_type: /fit|sizetype/ };
  function liftFrom(k, o, cells, p, skip) {
    if (!LIFTABLE[k] || !cells) return null;
    var t = ATTR[k].kind === 'vocab' ? norm(k, o) : (ATTR[k].kind === 'gtin' ? gtinKey(o) : low(o));
    if (!t || t.length < 3) return null;
    var alt = (k === 'gender' || k === 'age_group') && SYN[t] ? SYN[t] : escRe(t);
    var re = new RegExp('(^|[^a-z0-9])(' + alt + ')($|[^a-z0-9])', 'i');
    var nameOnly = k === 'gender' || k === 'age_group';
    // the column that belongs to the attribute is read first (material out of `composition` before
    // the title that also says "Linen"), then every other column in the master's own order
    var pref = LIFT_PREF[k], order = [];
    for (var q = 0; q < cells.length; q++) if (pref && pref.test((p.cols[q] || {}).base || '')) order.push(q);
    for (var q2 = 0; q2 < cells.length; q2++) if (order.indexOf(q2) < 0) order.push(q2);
    for (var oi = 0; oi < order.length; oi++) {
      var i = order[oi];
      if (skip[i] || i === p.join) continue;
      if (nameOnly && !NAMEISH.test((p.cols[i] || {}).base || '')) continue;
      var v = s0(cells[i]); if (!v || v.length > 4000 || /^https?:\/\//i.test(v.trim())) continue;
      var lv = low(v).replace(/[’']s\b/g, 's');
      if (re.test(lv)) return p.cols[i].h;
    }
    return null;
  }
  // When nothing matches, the "before" shown is the master column CLOSEST to what was sent — the
  // one it was plainly rewritten from (YuMOVE's link came from online_store_url, not the
  // myshopify `link`) — priority order breaking ties.
  function toks(v) { var o = {}; low(Array.isArray(v) ? v.join(' ') : v).split(/[^a-z0-9À-ɏ]+/).forEach(function (w) { if (w) o[w] = 1; }); return o; }
  function sim(a, b) {
    var ta = toks(a), tb = toks(b), n = 0, u = 0, w;
    for (w in ta) { u++; if (tb[w]) n++; }
    for (w in tb) if (!ta[w]) u++;
    return u ? n / u : 0;
  }
  function closest(k, mc, o) {
    if (mc.length < 2 || !has(o)) return mc[0];
    var best = mc[0], bs = -1;
    mc.forEach(function (c) { var s = sim(c.v, o); if (s > bs + 1e-9) { bs = s; best = c; } });
    return best;
  }
  // main = the output's main image keys (and an overlay's source): a master image promoted to the
  // main slot has moved, it is not lost from the gallery
  function classify(k, mc, o, cells, p, main) {
    var a = ATTR[k], r = { k: k, st: 'missing', stage: null, from: null, m: '', src: '', o: o == null ? '' : o, how: '' };
    var hasO = has(o), hasM = mc.length > 0;
    if (hasM) { var best = closest(k, mc, o); r.m = best.v; r.src = best.h; }
    if (!hasO) {
      if (hasM) {
        r.st = 'dropped'; r.stage = 2; r.from = 0;
        // Superdry states sale_price = price on every full-price line: dropping it is correct
        if (k === 'sale_price' && cells && p) {
          var pc = cands('price', cells, p).filter(function (c) { return (hkey(c.h) || {}).base === 'price'; })[0];
          if (pc && amt(pc.v) && amt(pc.v) === amt(r.m)) r.how = 'same as price';
        }
      }
      return r;
    }
    if (hasM) {
      // exact first — the column that supplied the value is the one named
      var oStr = Array.isArray(o) ? o.map(squash).join('\n') : squash(decode(o));
      for (var i = 0; i < mc.length; i++) {
        var mStr = Array.isArray(mc[i].v) ? mc[i].v.map(squash).join('\n') : squash(decode(mc[i].v));
        if (mStr === oStr) { r.st = 'kept'; r.stage = 0; r.from = 0; r.m = mc[i].v; r.src = mc[i].h; return r; }
      }
      var on = norm(k, o);
      for (var j = 0; j < mc.length; j++) {
        if (on && norm(k, mc[j].v) === on) {
          var same = hkey(mc[j].h), remap = a.kind === 'money' && same && same.base !== k.replace(/_/g, '');
          r.st = 'structured'; r.how = remap ? 'remap' : 'format'; r.stage = 2; r.from = 0; r.m = mc[j].v; r.src = mc[j].h; return r;
        }
      }
      if (a.kind === 'images' && Array.isArray(o)) {
        var ms = {}, os = {}; (Array.isArray(mc[0].v) ? mc[0].v : [mc[0].v]).forEach(function (u) { ms[imgKey(u)] = 1; });
        o.forEach(function (u) { os[imgKey(u)] = 1; });
        var added = Object.keys(os).filter(function (x) { return !ms[x]; }).length, lost = Object.keys(ms).filter(function (x) { return !os[x] && !(main && main[x]); }).length;
        if (added && !lost) { r.st = 'enriched'; r.how = '+' + added; r.stage = 3; r.from = 0; return r; }
        r.st = 'optimised'; r.how = (added ? '+' + added : '') + (lost ? (added ? ' ' : '') + '−' + lost : ''); r.stage = 2; r.from = 0; return r;
      }
      if (a.kind === 'image' && isOverlay(o)) {
        r.st = 'optimised'; r.how = 'overlay'; r.stage = 2; r.from = 0;
        var srcImg = overlaySource(o); if (srcImg) r.overlayOf = srcImg;
        return r;
      }
      if (a.kind === 'list' && Array.isArray(o) && Array.isArray(mc[0].v)) {
        var mset = {}; mc[0].v.forEach(function (x) { mset[low(x)] = 1; });
        var extra = o.filter(function (x) { return !mset[low(x)]; }).length;
        if (extra && extra + mc[0].v.length === o.length) { r.st = 'enriched'; r.how = '+' + extra; r.stage = 3; r.from = 0; return r; }
      }
      r.st = 'optimised'; r.how = a.kind === 'money' ? 'reprice' : (a.kind === 'path' ? 'restructure' : 'rewrite'); r.stage = 2; r.from = 0;
      return r;
    }
    // nothing in the master's own column(s) for it
    var skip = {}; ((p && p.attr[k]) || []).forEach(function (i) { skip[i] = 1; });
    var lifted = liftFrom(k, Array.isArray(o) ? o[0] : o, cells, p || { cols: [], join: -1 }, skip);
    if (lifted) { r.st = 'structured'; r.how = 'lift'; r.src = lifted; r.stage = 1; r.from = 1; return r; }
    if (a.core) { r.st = 'populated'; r.how = 'new'; r.stage = 1; r.from = 1; return r; }
    r.st = 'enriched'; r.how = 'new'; r.stage = 3; r.from = 3;
    return r;
  }

  // ---- STRUCTURED? — the value FeedSpark sends, read against Google's own format for it ---------------
  function gtinOk(d) {
    if (!/^(\d{8}|\d{12,14})$/.test(d)) return false;
    var s = 0, L = d.length;
    for (var i = 0; i < L - 1; i++) { var x = +d.charAt(L - 2 - i); s += (i % 2 === 0) ? x * 3 : x; }
    return (10 - s % 10) % 10 === +d.charAt(L - 1);
  }
  // ok = in Google's structure · warn = sent, but not in the form the spec asks for · null = n/a
  function spec(k, v) {
    if (!has(v)) return null;
    var t = plain(Array.isArray(v) ? v[0] : v), lt = t.toLowerCase();
    switch (k) {
      case 'availability': return /^(in[ _]stock|out[ _]of[ _]stock|preorder|backorder)$/.test(lt) ? 'ok' : 'warn';
      case 'price': case 'sale_price': return /^\d+(\.\d{1,2})?\s[A-Z]{3}$/.test(t) ? 'ok' : 'warn';
      case 'condition': return /^(new|refurbished|used)$/.test(lt) ? 'ok' : 'warn';
      case 'gender': return /^(male|female|unisex)$/.test(lt) ? 'ok' : 'warn';
      case 'age_group': return /^(newborn|infant|toddler|kids|adult)$/.test(lt) ? 'ok' : 'warn';
      case 'identifier_exists': return /^(yes|no|true|false)$/.test(lt) ? 'ok' : 'warn';
      case 'gtin': return gtinOk(t.replace(/\s/g, '')) ? 'ok' : 'warn';
      case 'size_type': return /^(regular|petite|maternity|big|tall|plus)$/.test(lt) ? 'ok' : 'warn';
      case 'size_system': return /^(au|br|cn|de|eu|fr|it|jp|mex|uk|us)$/.test(lt) ? 'ok' : 'warn';
      case 'google_product_category': return (/^\d+$/.test(t) || /^[A-Za-z][^{}<]*$/.test(t)) ? 'ok' : 'warn';
      case 'link': case 'canonical_link': case 'image_link': return /^https:\/\//i.test(t) ? 'ok' : 'warn';
      case 'title': return (t.length >= 1 && t.length <= 150 && (t !== t.toUpperCase() || !/[A-Z]/.test(t))) ? 'ok' : 'warn';
      case 'short_title': return t.length <= 65 ? 'ok' : 'warn';
      case 'description': return (/<[a-z][^>]*>/i.test(decode(Array.isArray(v) ? v[0] : v)) || t.length > 5000) ? 'warn' : 'ok';
      case 'color': return (/[()\[\]{}]/.test(t) || t.split('/').length > 3 || /^[A-Z]{2,}$/.test(t)) ? 'warn' : 'ok';
      case 'product_type': return t.length <= 750 ? 'ok' : 'warn';
      case 'product_highlight': return (Array.isArray(v) ? v : [v]).every(function (x) { return plain(x).length <= 150; }) ? 'ok' : 'warn';
      case 'additional_image_link': return (Array.isArray(v) ? v : [v]).every(function (x) { return /^https:\/\//i.test(plain(x)); }) ? 'ok' : 'warn';
      default: return 'ok';
    }
  }

  // ---- the whole product ---------------------------------------------------------------------------------
  // lineage(product, masterCells|null, plan) → one record per attribute, ATTRS order.
  // No master row: st 'unknown' everywhere except the title, whose "before" FeedHero stamps on
  // the output item itself (c:fs_data_original_title).
  // WHAT THE MASTER SAYS ABOUT STOCK, before any FeedHero rule touched it: the master's availability word
  // first, else its stock count (> 0 = in stock). 'in' | 'out' | 'pre' | '' (the master states neither).
  // A count is read only when it is a plain number — '10+' or 'yes' is not a quantity anyone can compare.
  function masterStock(cells, p) {
    if (!cells || !p) return '';
    var av = (p.attr.availability || []);
    for (var i = 0; i < av.length; i++) {
      var w = plain(cells[av[i]]); if (!w) continue;
      var v = VOCAB.availability(low(w));
      if (v === 'in_stock') return 'in';
      if (v === 'out_of_stock') return 'out';
      if (v === 'preorder' || v === 'backorder') return 'pre';
    }
    var q = (p.attr.stock_qty || []);
    for (var j = 0; j < q.length; j++) {
      var t = plain(cells[q[j]]).replace(/,/g, '');
      if (!/^-?\d+(\.\d+)?$/.test(t)) continue;
      return +t > 0 ? 'in' : 'out';
    }
    return '';
  }
  // the feed's own word, on the same three-way scale
  function feedStock(av) { return av === 'in_stock' ? 'in' : av === 'out_of_stock' ? 'out' : (av === 'preorder' || av === 'backorder') ? 'pre' : ''; }
  function lineage(pr, cells, p) {
    var omain = {}, om = pr.f.image_link;
    if (has(om)) { omain[imgKey(om)] = 1; var os0 = isOverlay(om) && overlaySource(om); if (os0) omain[imgKey(os0)] = 1; }
    return ATTRS.map(function (a) {
      var o = pr.f[a.k], r;
      if (!cells) {
        if (a.k === 'title' && pr.otitle) r = classify('title', [{ h: 'fs_data_original_title', v: pr.otitle }], o, null, null);
        else { r = { k: a.k, st: has(o) ? 'unknown' : 'missing', stage: null, from: has(o) ? 3 : null, m: '', src: '', o: o == null ? '' : o, how: '' }; }
      } else {
        var mc = cands(a.k, cells, p);
        if (a.k === 'title' && !mc.length && pr.otitle) mc = [{ h: 'fs_data_original_title', v: pr.otitle }];
        r = classify(a.k, mc, o, cells, p, a.k === 'additional_image_link' ? omain : null);
      }
      r.l = a.l; r.g = a.g; r.tier = a.tier; r.spec = spec(a.k, r.o);
      r.ex = r.st === 'kept' || r.st === 'optimised' || r.st === 'dropped' || (r.st === 'structured' && r.how !== 'lift') || (r.st === 'enriched' && r.from === 0);
      r.en = r.st === 'populated' || r.st === 'optimised' || r.st === 'enriched' || (r.st === 'structured' && r.how === 'lift');
      return r;
    });
  }
  // what the inspector animates: fields holding a value after each stage, and fields changed AT it
  function stageCounts(lin) {
    var hold = [0, 0, 0, 0], changed = [0, 0, 0, 0];
    lin.forEach(function (r) {
      if (r.from == null) return;
      for (var s = r.from; s < 4; s++) { if (r.st === 'dropped' && s >= 2) break; hold[s]++; }
      if (r.stage != null) changed[r.stage]++;
    });
    return { hold: hold, changed: changed };
  }
  // the value a field shows at stage s (the inspector's scrubber)
  function valueAt(r, s) {
    if (r.from == null || s < r.from) return null;
    if (r.st === 'dropped') return s < 2 ? r.m : null;
    if ((r.st === 'structured' && r.how !== 'lift') || r.st === 'optimised' || (r.st === 'enriched' && r.from === 0)) return s < r.stage ? r.m : r.o;
    return r.o;
  }
  function tally(lin) {
    var t = {}; STATUS.concat(['unknown']).forEach(function (s) { t[s] = 0; });
    lin.forEach(function (r) { t[r.st] = (t[r.st] || 0) + 1; });
    return t;
  }

  // ---- word-level diff (titles, descriptions) --------------------------------------------------------------
  function wkey(w) { return w.toLowerCase().replace(/^[^a-z0-9À-ɏ]+|[^a-z0-9À-ɏ]+$/g, ''); }
  function wordDiff(a, b) {
    var A = plain(a).split(' ').filter(Boolean), B = plain(b).split(' ').filter(Boolean), out = [];
    var n = A.length, m = B.length;
    if (!n) return B.map(function (w) { return { t: 'add', w: w }; });
    if (!m) return A.map(function (w) { return { t: 'del', w: w }; });
    var ka = A.map(wkey), kb = B.map(wkey), i, j;
    if (n * m > 160000) {   // a very long description: bag of words, so the page never stalls on a hover
      var sa = {}, sb = {};
      ka.forEach(function (w) { sa[w] = 1; }); kb.forEach(function (w) { sb[w] = 1; });
      A.forEach(function (w, x) { if (!sb[ka[x]]) out.push({ t: 'del', w: w }); });
      B.forEach(function (w, y) { out.push({ t: sa[kb[y]] ? 'eq' : 'add', w: w }); });
      return out;
    }
    var W = m + 1, L = new Int32Array((n + 1) * W);
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) {
      L[i * W + j] = ka[i] === kb[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
    i = 0; j = 0;
    while (i < n && j < m) {
      if (ka[i] === kb[j]) { out.push({ t: A[i] === B[j] ? 'eq' : 'tweak', w: B[j], was: A[i] }); i++; j++; }
      else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { out.push({ t: 'del', w: A[i] }); i++; }
      else { out.push({ t: 'add', w: B[j] }); j++; }
    }
    while (i < n) out.push({ t: 'del', w: A[i++] });
    while (j < m) out.push({ t: 'add', w: B[j++] });
    return out;
  }

  // ---- master files: a FeedHero backup zip, then CSV / TSV / TXT / XML inside it --------------------------------
  function u16(u, o) { return u[o] | (u[o + 1] << 8); }
  function u32(u, o) { return (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0; }
  function utf8(u) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(u);
    var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return s;
  }
  function isZip(u) { return !!u && u.length > 4 && u[0] === 0x50 && u[1] === 0x4b && u[2] === 0x03 && u[3] === 0x04; }
  // the central directory: [{name, method, csize, size, lho}] — null when this is not a zip we can read
  function zipEntries(u) {
    var n = u.length, eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 65557); i--) { if (u32(u, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) return null;
    var cnt = u16(u, eocd + 10), off = u32(u, eocd + 16), out = [];
    if (off === 0xffffffff) return null;   // zip64 — a FeedHero backup never is
    for (var k = 0; k < cnt && off + 46 <= n; k++) {
      if (u32(u, off) !== 0x02014b50) break;
      var nl = u16(u, off + 28), xl = u16(u, off + 30), cl = u16(u, off + 32);
      out.push({ name: utf8(u.subarray(off + 46, off + 46 + nl)), method: u16(u, off + 10), csize: u32(u, off + 20),
        size: u32(u, off + 24), lho: u32(u, off + 42) });
      off += 46 + nl + xl + cl;
    }
    return out;
  }
  // the entry's stored bytes (still deflated when method 8) — sizes come from the central directory,
  // so an entry written with a trailing data descriptor reads the same
  function zipData(u, e) {
    if (u32(u, e.lho) !== 0x04034b50) return null;
    var st = e.lho + 30 + u16(u, e.lho + 26) + u16(u, e.lho + 28);
    return u.subarray(st, st + e.csize);
  }
  // the one file worth reading in a backup zip: the largest non-directory entry
  function zipMain(entries) {
    return (entries || []).filter(function (e) { return !/\/$/.test(e.name) && !/^__MACOSX\//.test(e.name); })
      .sort(function (a, b) { return b.size - a.size; })[0] || null;
  }
  // what the text is: XML, or delimited by tab / comma / pipe / semicolon (read off the header line)
  function sniff(head) {
    var s = s0(head).replace(/^﻿/, '').replace(/^\s+/, '');
    if (/^<(\?xml|rss|feed|products?\b|items?\b|catalog|channel)/i.test(s)) return { fmt: 'xml' };
    var line = s.split(/\r?\n/)[0] || '', best = ',', bn = -1;
    ['\t', ',', '|', ';'].forEach(function (d) { var c = line.split(d).length - 1; if (c > bn) { bn = c; best = d; } });
    // a TAB file only honours quotes when its header does — an unquoted TSV cell may legitimately
    // start with a quote mark, and treating it as one would swallow the rest of the file
    return { fmt: 'delim', delim: best, quotes: best !== '\t' || /(^|\t)"/.test(line) };
  }
  // RFC-4180-ish streaming reader: push(text) as it inflates, end() once; quotes, doubled quotes,
  // CRLF and newlines inside quotes all survive a chunk boundary
  function delimParser(delim, onRow, opts) {
    var quotes = !opts || opts.quotes !== false;
    var re = new RegExp('[' + (delim === '\t' ? '\\t' : escRe(delim)) + '\\n\\r' + (quotes ? '"' : '') + ']', 'g');
    var st = 0, cell = '', row = [], n = 0, fresh = true;
    function endCell() { row.push(cell); cell = ''; fresh = true; }
    function endRow() { endCell(); if (row.length > 1 || row[0] !== '') onRow(row, n++); row = []; }
    function push(s) {
      var i = 0, L = s.length;
      while (i < L) {
        if (st === 1) {
          var q = s.indexOf('"', i);
          if (q < 0) { cell += s.slice(i); return; }
          cell += s.slice(i, q); i = q + 1; st = 2; continue;
        }
        if (st === 2) {
          if (s.charAt(i) === '"') { cell += '"'; i++; st = 1; continue; }
          st = 0; fresh = false;
        }
        re.lastIndex = i;
        var m = re.exec(s);
        if (!m) { if (i < L) { cell += s.slice(i); fresh = false; } return; }
        if (m.index > i) { cell += s.slice(i, m.index); fresh = false; }
        i = m.index + 1;
        var c = m[0];
        if (c === '"') { if (fresh) st = 1; else cell += '"'; fresh = false; }
        else if (c === delim) endCell();
        else if (c === '\n') endRow();
      }
    }
    return { push: push, end: function () { st = 0; if (cell !== '' || row.length) endRow(); }, count: function () { return n; } };
  }

  // ---- what the table shows about one product, worked out once when it arrives -------------------------------------
  var DAY = 86400000;
  function depthOf(v) { var s = plain(v); if (!s) return 0; return s.split(/\s*(?:>|›|»)\s*/).filter(Boolean).length || 1; }
  function leafOf(v) { var s = plain(v).split(/\s*(?:>|›|»)\s*/).filter(Boolean); return s.length ? s[s.length - 1] : ''; }
  function facts(p, now) {
    var f = p.f, pr = money(f.price), sp = money(f.sale_price);
    var onSale = !!(pr && sp && sp.a < pr.a);
    var av = VOCAB.availability(low(f.availability || ''));
    var dob = /^\d{4}-\d{2}-\d{2}/.test(p.dob) ? Date.parse(p.dob.slice(0, 10) + 'T00:00:00Z') : NaN;
    var imgs = (has(f.image_link) ? 1 : 0) + (Array.isArray(f.additional_image_link) ? f.additional_image_link.length : 0);
    return {
      price: pr ? pr.a : null, cur: (pr && pr.cur) || (sp && sp.cur) || '', sale: onSale ? sp.a : null,
      disc: onSale ? Math.round((1 - sp.a / pr.a) * 100) : 0, onSale: onSale,
      av: av || '', pt: s0(f.product_type), leaf: leafOf(f.product_type), depth: depthOf(f.product_type),
      dob: isFinite(dob) ? dob : null, age: isFinite(dob) ? Math.max(0, Math.floor(((now || Date.now()) - dob) / DAY)) : null,
      imgs: imgs, tlen: plain(f.title).length, grp: s0(f.item_group_id)
    };
  }
  // COMPLETENESS, before → after: the share of what Google asks of THIS product that is filled,
  // weighted like the Golden Record score (required ×3, conditional ×2, recommended ×1). The
  // apparel attributes only count on apparel — a pet supplement is never marked down for a
  // missing size — and gtin/mpn count once, as the identifier.
  var APPAREL = /\b(apparel|clothing|clothes|shoes|footwear|dress|shirt|jacket|coat|jumper|knitwear|trousers|jeans|skirt|lingerie|swimwear)\b/i;
  function completeness(lin, p) {
    var by = {}; lin.forEach(function (r) { by[r.k] = r; });
    // apparel is read off the category, or a gender / age the feed states — never off a size
    // (a tub of supplements has one) or a colour (so does a paint pot)
    var appar = APPAREL.test(s0(p && p.f.google_product_category) + ' ' + s0(p && p.f.product_type)) || ['gender', 'age_group'].some(function (k) { return by[k] && has(by[k].o); });
    var W = [['title', 3], ['description', 3], ['link', 3], ['image_link', 3], ['availability', 3], ['price', 3],
      ['brand', 2], ['@id', 2], ['google_product_category', 1], ['product_type', 1], ['additional_image_link', 1],
      ['product_highlight', 1], ['product_detail', 1], ['material', 1]];
    if (appar) W = W.concat([['color', 2], ['size', 2], ['gender', 2], ['age_group', 2], ['pattern', 1]]);
    var tot = 0, b = 0, a = 0, list = [];
    W.forEach(function (w) {
      var before, after;
      if (w[0] === '@id') {
        before = ['gtin', 'mpn'].some(function (k) { return by[k] && by[k].ex; });
        after = ['gtin', 'mpn'].some(function (k) { return by[k] && has(by[k].o); });
      } else { var r = by[w[0]] || {}; before = !!r.ex; after = has(r.o); }
      tot += w[1]; if (before) b += w[1]; if (after) a += w[1];
      list.push({ k: w[0] === '@id' ? 'gtin / mpn' : w[0], w: w[1], before: before, after: after });
    });
    return { before: tot ? Math.round(b / tot * 100) : 0, after: tot ? Math.round(a / tot * 100) : 0, apparel: appar, list: list };
  }
  // Google's conversational six — how many a product carries, before and after
  var AI_SIX = ['question_and_answer', 'document_link', 'related_product', 'item_group_title', 'variant_option', 'popularity_rank'];
  function aiCount(lin) {
    var b = 0, a = 0; lin.forEach(function (r) { if (AI_SIX.indexOf(r.k) < 0) return; if (r.ex) b++; if (has(r.o)) a++; });
    return { before: b, after: a, of: AI_SIX.length };
  }

  // ONE character per attribute — what the table's lineage strip, the matrix and every filter read,
  // so 30,000 products × 42 attributes cost a string each, never a record each:
  //   k kept · l structured (lifted from master text) · p populated · s structured (to spec)
  //   o optimised · e enriched (new) · g enriched (a list the master had, added to) · d dropped
  //   m missing · u no master row
  function code(r) {
    switch (r.st) {
      case 'kept': return 'k';
      case 'structured': return r.how === 'lift' ? 'l' : 's';
      case 'populated': return 'p';
      case 'optimised': return 'o';
      case 'enriched': return r.from === 0 ? 'g' : 'e';
      case 'dropped': return 'd';
      case 'unknown': return 'u';
      default: return 'm';
    }
  }
  function codes(lin) { var s = ''; for (var i = 0; i < lin.length; i++) s += code(lin[i]); return s; }

  // ---- the catalogue at a glance ---------------------------------------------------------------------------------
  // matrix(list of lineage arrays) → {attr: {kept:n, structured:n, …, n}} — the "what FeedSpark did" card
  function matrixAdd(mx, lin) {
    lin.forEach(function (r) {
      var c = mx[r.k] || (mx[r.k] = { n: 0 });
      c.n++; c[r.st] = (c[r.st] || 0) + 1; if (r.spec === 'warn') c.warn = (c.warn || 0) + 1;
    });
    return mx;
  }

  // ---- which Google Ads segment a product sits in (FeedHero's roas_dashboard) ------------------------------------
  // Measured 28 Sep 2026 against the six clients FeedHero reports on: a segment row is a VALUE of one
  // FeedHero column, grouped case-insensitively, an empty column reading "Unsorted". Brand, colour,
  // gender, age group and GPC are the raw g: value; price type is a rule (sale below price); title and
  // keyword status are FeedSpark's own fs_data_opti flags; product age is a rule on the item GROUP's
  // first-seen date. The CATEGORY is g:product_type slot 1 matched on its FULL path and never an
  // ancestor: FeedHero's report still files re-typed products under their old path (Superdry's
  // "Men > Swimwear" sits under "Menswear" in ROAS, not "Men"), so an ancestor would claim a product
  // for a row it is not counted in. Data-field status and batch are FeedHero workflow states no feed
  // carries — segment totals only.
  var SEG_FIELD = { Brand: 'brand', Colour: 'color', Gender: 'gender', Age_group: 'age_group', Google_product_category: 'google_product_category',
    Custom_label_0: 'custom_label_0', Custom_label_1: 'custom_label_1', Custom_label_2: 'custom_label_2', Custom_label_3: 'custom_label_3',
    Custom_label_4: 'custom_label_4' };
  var SEG_PATH = { Category: 1, Google_product_category: 1 };
  // "SaveÂ£5" is "Save£5" read as latin-1 (Hobbycraft's custom label 2): both sides are repaired before comparing
  function segKey(v, agg) {
    var t = plain(Array.isArray(v) ? v[0] : v).replace(/\u00c2([\u00a0-\u00bf])/g, '$1');
    return SEG_PATH[agg] ? pathKey(t) : t.trim().toLowerCase();
  }
  function segUnlisted(c) { return /^unlisted skus in ads traffic$/i.test(s0(c).trim()); }
  // FeedHero lists some names twice (GPC "Model Making" at 971 and at 947 SKUs): one name, one segment
  function mergeSegRows(rows, agg) {
    var by = {}, out = [];
    (rows || []).forEach(function (r) {
      if (!r || r.category == null) return;
      var k = segKey(r.category, agg), m = by[k];
      if (!m) { m = by[k] = JSON.parse(JSON.stringify(r)); m.merged = 1; out.push(m); return; }
      var sk = (+m.skus || 0) + (+r.skus || 0);
      if (r.zombiePct != null || m.zombiePct != null) m.zombiePct = sk ? (((+m.zombiePct || 0) * (+m.skus || 0)) + ((+r.zombiePct || 0) * (+r.skus || 0))) / sk : 0;
      m.skus = sk; m.merged++;
      ['impr', 'clicks', 'conv'].forEach(function (f) { if (r[f] != null) m[f] = (+m[f] || 0) + (+r[f] || 0); });
      ['revenue', 'spend'].forEach(function (f) { if (r[f] && r[f].n != null) { if (!m[f]) m[f] = { n: 0, cur: r[f].cur }; m[f].n = (+m[f].n || 0) + (+r[f].n || 0); } });
      var sp = m.spend && m.spend.n, rv = m.revenue && m.revenue.n;
      m.roasPct = sp > 0 ? rv / sp * 100 : m.roasPct;
      m.band = '';
    });
    return out;
  }
  // a cut whose every real row is "Unsorted" is a column the report reads as EMPTY, whatever the
  // output feed carries (Monsoon's five custom labels) — no product can be placed in it
  function unsortedOnly(rows) {
    var real = (rows || []).filter(function (r) { var k = segKey(r && r.category); return k && k !== 'total' && !segUnlisted(r.category); });
    return real.length > 0 && real.every(function (r) { return segKey(r.category) === 'unsorted'; });
  }
  // PRODUCT AGE: two rolling windows, then calendar quarters — <=7 days Brand new, <=30 days New, this
  // quarter This season, the quarter before Last season, the two before that This year, anything older
  // (or undated) Perennial. On the GROUP's first-seen date: a colour added last week to a two-year-old
  // style is filed with its style (99.45% of 1,992 SKUs placed this way, 97.34% on the variant's own).
  var AGE_BUCKETS = ['Brand new', 'New', 'This season', 'Last season', 'This year', 'Perennial'];
  function qStart(t, back) { var d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - d.getUTCMonth() % 3 - 3 * (back || 0), 1); }
  function ageBucket(dob, at) {
    if (dob == null || !isFinite(dob)) return 'Perennial';
    var days = Math.floor((at - dob) / DAY);
    if (days <= 7) return 'Brand new';
    if (days <= 30) return 'New';
    if (dob >= qStart(at, 0)) return 'This season';
    if (dob >= qStart(at, 1)) return 'Last season';
    if (dob >= qStart(at, 3)) return 'This year';
    return 'Perennial';
  }
  // the earliest first-seen date per item group, across every variant the feed carries
  function groupBirth(fx) {
    var m = {};
    (fx || []).forEach(function (x) { if (!x || x.dob == null || !x.grp) return; var k = x.grp.toLowerCase(); if (m[k] == null || x.dob < m[k]) m[k] = x.dob; });
    return m;
  }
  function birthOf(x, gm) { var g = x && x.grp && gm ? gm[x.grp.toLowerCase()] : null; return g != null && (x.dob == null || g < x.dob) ? g : (x ? x.dob : null); }
  // the value a product carries for one cut, or null where no product-level field decides it
  function segValue(agg, p, x, at, birth) {
    switch (agg) {
      case 'Price_type': return x && x.onSale ? 'Products on Sale' : 'Products at Full Price';
      case 'Title_optimisation_status': return p.opti ? (p.opti.T ? 'Optimized' : 'Non Optimized') : null;
      case 'Keyword_optimisation_status': return p.opti ? (p.opti.Keywords ? 'Optimized' : 'Non Optimized') : null;
      case 'Product_age': return ageBucket(birth, at);
      case 'Category': return has(p.f.product_type) ? plain(p.f.product_type) : null;
    }
    var k = SEG_FIELD[agg]; if (!k) return null;
    var v = plain(Array.isArray(p.f[k]) ? p.f[k][0] : p.f[k]);
    return v || 'Unsorted';
  }

  return {
    VERSION: VERSION, ATTRS: ATTRS, ATTR: ATTR, GROUPS: GROUPS, DNA: DNA, STATUS: STATUS, STATUS_LABEL: STATUS_LABEL, STAGES: STAGES,
    ALIAS: ALIAS, OPTI_KEYS: OPTI_KEYS,
    decode: decode, plain: plain, hkey: hkey, opti: opti, outPlan: outPlan, outRow: outRow, outRecord: outRecord, nestedText: nestedText,
    facts: facts, completeness: completeness, aiCount: aiCount, AI_SIX: AI_SIX, depthOf: depthOf, leafOf: leafOf, money: money, norm: norm, urls: urls,
    code: code, codes: codes, pathKey: pathKey,
    isOverlay: isOverlay, overlaySource: overlaySource, plan: plan, idKey: idKey, detectJoin: detectJoin, masterCells: masterCells,
    cands: cands, masterStock: masterStock, feedStock: feedStock, classify: classify, spec: spec, gtinOk: gtinOk, lineage: lineage, stageCounts: stageCounts, valueAt: valueAt,
    tally: tally, wordDiff: wordDiff, isZip: isZip, zipEntries: zipEntries, zipData: zipData, zipMain: zipMain, sniff: sniff,
    delimParser: delimParser, matrixAdd: matrixAdd,
    SEG_FIELD: SEG_FIELD, AGE_BUCKETS: AGE_BUCKETS, segKey: segKey, segUnlisted: segUnlisted, mergeSegRows: mergeSegRows,
    unsortedOnly: unsortedOnly, ageBucket: ageBucket, groupBirth: groupBirth, birthOf: birthOf, segValue: segValue
  };
});
