/* FeedSpark Golden Record — PDP harvest engine (docs/pdp_engine.js)
 * ------------------------------------------------------------------
 * UMD, dependency-free, browser + node. Served verbatim at /golden/pdp-engine.js and
 * unit-tested in node (tools/test_pdpharvest.mjs) — the page and the tests run this
 * exact file. The WORKER never parses a product page: it only proxies the fetch
 * (host-allowlisted to the feed's own product host, honest scanner UA); the browser
 * runs this engine on the HTML, exactly like Feed Lab / Label Guard / Overlays.
 *
 * What it answers (Ray, 14 Sep 2026): "missing data can be sourced from the PDP —
 * take one URL linked to a product PDP to scan for any information for missing
 * attributes within the golden record … see if there's a quick way to actually
 * extract the data from the product page that might not exist in the source feed."
 *
 * Probe evidence (14 Sep 2026, 8 wired brands × 3 PDPs): the schema.org JSON-LD on
 * these sites mirrors what the feed already sends (brand, sku, price, availability,
 * images, breadcrumb). The Golden Record GAPS — material, pattern, product_detail,
 * product_highlight, document_link, the conversational six — live in the visible
 * "Fabric & Details / Composition & Care / Key features" text. So the engine reads
 * BOTH: every machine-readable source first (JSON-LD, OpenGraph product: meta,
 * microdata, GA4 dataLayer, embedded JSON keys), then the visible details text with
 * label:value + composition + feature-bullet rules; an optional AI pass (the page
 * calls /api/claude with llmPrompt) fills what the rules cannot, and every AI value
 * must quote its evidence verbatim from the page text or it is dropped.
 *
 * API:
 *   PdpHarvest.GOLDEN_KEYS                 attributes the harvest targets (spec order)
 *   PdpHarvest.sampler(n, attr)            {onRow, pick, seen, full} — reservoir sample
 *                                          on the Feed Lab parser contract, blank-in-
 *                                          attr rows preferred
 *   PdpHarvest.hostOf / hostAllowed / linkHostFromFeedHead — the proxy allowlist maths
 *   PdpHarvest.extract(html, url, row)     -> {title, sources, attrs, details, ...}
 *   PdpHarvest.mapToGolden(row, ex)        -> per-SKU feed-vs-PDP {attr:{feed,pdp,src,ev,state}}
 *   PdpHarvest.matrix(results, keys)       -> per-attribute recovery counts + examples
 *   PdpHarvest.llmPrompt(pages) / parseLlm(text) / mergeLlm(ex, aiAttrs) — the AI pass
 *   PdpHarvest.supplementalCsv(results)    -> id + g:attr CSV of the recovered values
 *   PdpHarvest.VERSION
 */
(function (root, factory) {
  var api = factory();
  try { root.PdpHarvest = api; } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof globalThis !== 'undefined' ? globalThis :
  (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var VERSION = '1.0.0';
  var SCAN_UA = 'Mozilla/5.0 (compatible; FeedSparkPDPScan/1.0; +https://feedspark.com)';
  var ROWCAP = 60000;      // rows the sampler reads before it stops asking for more feed
  var DETAILS_CAP = 3500;  // chars of page text handed to the AI pass per product
  var EV_CAP = 160;        // evidence quote length
  var LONG = { product_detail: 1, product_highlight: 1, document_link: 1, question_and_answer: 1, additional_image_link: 1, variant_option: 1 };
  function capOf(k) { return LONG[k] ? 1200 : 120; }
  function slug(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  // the attributes a product page can plausibly fill — Google's required seven are
  // never harvested (the feed carries them or nothing serves), price/sale_price/
  // availability change hourly and are not "missing data", gpc is a fixed taxonomy.
  var GOLDEN_KEYS = ['brand', 'gtin', 'mpn', 'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group',
    'product_type', 'additional_image_link', 'product_highlight', 'product_detail', 'material', 'pattern',
    'size_type', 'size_system', 'question_and_answer', 'document_link', 'related_product', 'item_group_title', 'variant_option'];
  // what the AI pass may fill: descriptive attributes only — identifiers are never guessed
  var LLM_KEYS = ['color', 'material', 'pattern', 'gender', 'age_group', 'size_type', 'size_system',
    'product_highlight', 'product_detail', 'item_group_title'];
  var VOCAB = {
    gender: ['male', 'female', 'unisex'],
    age_group: ['newborn', 'infant', 'toddler', 'kids', 'adult'],
    size_type: ['regular', 'petite', 'plus', 'tall', 'big', 'maternity'],
    size_system: ['UK', 'EU', 'US', 'AU', 'BR', 'CN', 'DE', 'FR', 'IT', 'JP', 'MEX'],
    condition: ['new', 'used', 'refurbished']
  };

  /* ---------------- small utils ---------------- */
  function str(v) {
    if (v == null) return '';
    if (typeof v === 'object') return String(v.name || v['@id'] || v.value || '');
    return String(v);
  }
  function clean(s, cap) { s = str(s).replace(/\s+/g, ' ').trim(); return cap ? s.slice(0, cap) : s; }
  function decode(s) {
    return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&pound;/g, '£')
      .replace(/&deg;/g, '°').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function normKey(k) {
    k = String(k || '').trim().replace(/^g:/i, '').toLowerCase().replace(/\s+/g, '_');
    if (k === 'colour') k = 'color';
    return k;
  }
  function cap1(s) { s = clean(s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function uniq(a) { var m = {}, out = []; for (var i = 0; i < a.length; i++) { if (!m[a[i]]) { m[a[i]] = 1; out.push(a[i]); } } return out; }
  function normEv(s) { return String(s || '').toLowerCase().replace(/[\u2018\u2019\u201c\u201d]/g, "'").replace(/[^a-z0-9%£€$]+/g, ' ').trim(); }

  /* ---------------- host allowlist maths (the worker proxy uses these) ---------------- */
  function hostOf(url) {
    var m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || '').trim());
    return m ? m[1].toLowerCase() : '';
  }
  function bareHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }
  function hostAllowed(url, host) {
    var h = hostOf(url), a = bareHost(host);
    if (!h || !a) return false;
    return bareHost(h) === a;
  }
  // first product link in a feed head: XML (<link> / <g:link> inside the first <item>,
  // CDATA tolerant; channel <link> as a fallback) or CSV (link column of the first row)
  function linkHostFromFeedHead(text) {
    text = String(text || '');
    if (/<item[\s>]/.test(text) || /<rss|<feed|<channel/i.test(text)) {
      var it = /<item[\s>]([\s\S]*?)(<\/item>|$)/.exec(text);
      var scope = it ? it[1] : text;
      var m = /<(?:g:)?link>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^<\s\]]+)/i.exec(scope) || /<(?:g:)?link>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^<\s\]]+)/i.exec(text);
      return m ? hostOf(decode(m[1])) : '';
    }
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return '';
    var head = splitCsv(lines[0]).map(normKey), li = head.indexOf('link');
    if (li < 0) return '';
    for (var i = 1; i < Math.min(lines.length, 40); i++) {
      var cells = splitCsv(lines[i]); var h = hostOf(cells[li] || '');
      if (h) return h;
    }
    return '';
  }
  function splitCsv(line) {   // light single-line RFC-4180 split (feed heads only)
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (q) { if (c === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  /* ---------------- the feed sampler (Feed Lab parser contract) ----------------
     First onRow = header; XML headers may GROW mid-stream (late-debut tags), so columns are
     re-resolved whenever the header length changes. Two reservoirs: rows BLANK in the chosen
     attribute (what a recovery scan wants) and any row (the fallback fill). */
  function sampler(n, attr) {
    n = Math.max(1, Math.min(200, n | 0 || 25));
    var header = null, hlen = -1, cols = null, seen = 0, blank = [], any = [], nb = 0, na = 0;
    function resolve(h) {
      cols = { id: [], title: [], link: [] };
      GOLDEN_KEYS.forEach(function (k) { cols[k] = []; });
      for (var i = 0; i < h.length; i++) {
        var k = normKey(h[i]), sm = /^(.*)\((\d+)\)$/.exec(k);
        var base = sm ? sm[1] : k;
        if (base === 'colour') base = 'color';
        if (cols[base]) cols[base].push(i);
      }
      hlen = h.length;
    }
    function val(row, k) {
      var ix = cols[k] || [];
      for (var i = 0; i < ix.length; i++) { var v = row[ix[i]]; if (v != null && String(v).trim()) return String(v).trim(); }
      return '';
    }
    function compact(row) {
      var o = { id: val(row, 'id'), title: val(row, 'title'), link: val(row, 'link'), row: {} };
      GOLDEN_KEYS.forEach(function (k) { o.row[k] = val(row, k); });
      return o;
    }
    function reservoir(pool, count, item) {   // Vitter's R — every row an equal chance
      if (pool.length < n) pool.push(item);
      else { var j = Math.floor(Math.random() * (count + 1)); if (j < n) pool[j] = item; }
    }
    function onRow(row, h) {
      if (!header) { header = h || row; resolve(header); return; }
      if (h && h.length !== hlen) { header = h; resolve(h); }
      if (seen >= ROWCAP) return;
      seen++;
      if (!val(row, 'link')) return;
      var item = compact(row);
      if (attr && !item.row[attr]) { reservoir(blank, nb, item); nb++; }
      reservoir(any, na, item); na++;
    }
    function pick() {
      var out = blank.slice(0, n), ids = {};
      out.forEach(function (x) { ids[x.id || x.link] = 1; });
      for (var i = 0; i < any.length && out.length < n; i++) { var x = any[i]; if (!ids[x.id || x.link]) { ids[x.id || x.link] = 1; out.push(x); } }
      return out;
    }
    return { onRow: onRow, pick: pick, seen: function () { return seen; }, blank: function () { return nb; },
      full: function () { return seen >= ROWCAP; }, header: function () { return header; } };
  }

  /* ---------------- page text ---------------- */
  function textOf(html) {
    var s = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
      // block-level elements break lines on BOTH edges — a rendered page never runs nav text
      // into the next block ("Log in My Account Colour: Florida Orange" would hide the label)
      .replace(/<(?:p|div|li|dd|dt|td|th|tr|h[1-6]|section|article|ul|ol|table|summary|details|nav|header|footer|main|aside|form|blockquote|figure|figcaption|dl|fieldset|legend|address|pre|label|button|option|select)(?:\s[^>]*)?>/gi, '\n')
      .replace(/<\/(?:p|div|li|dd|dt|td|th|tr|h[1-6]|section|article|span|ul|ol|table|summary|details|label|button|a|nav|header|footer|main|aside|form|blockquote|figure|figcaption|dl|fieldset|legend|address|pre|option|select)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    s = decode(s).replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n');
    return s;
  }
  var NOISE = /cookie|privacy|policy|newsletter|sign up|subscribe|delivery|returns?\b|% off|free shipping|add to (bag|basket|cart)|wishlist|klarna|clearpay|paypal|checkout|unsubscribe|terms|javascript/i;
  var LABEL_ONLY = /^[A-Za-z][A-Za-z &\/'-]{1,30}:$/;
  function lines(text) {   // "Material:" on its own line + "Cotton 100%" on the next (dt/dd layouts) → one line
    var raw = String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; }), out = [];
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if (LABEL_ONLY.test(l) && i + 1 < raw.length && raw[i + 1].length < 160 && !LABEL_ONLY.test(raw[i + 1])) { l = l + ' ' + raw[i + 1]; i++; }
      if (l.length > 1 && l.length < 260) out.push(l);
    }
    return out;
  }

  /* ---------------- JSON-LD ---------------- */
  function jsonLd(html) {
    var out = [], re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(html))) {
      var raw = m[1].trim().replace(/^<!--/, '').replace(/-->$/, '').trim(), j;
      try { j = JSON.parse(raw); } catch (e) { continue; }
      walk(j);
    }
    function walk(x) {
      if (!x || typeof x !== 'object') return;
      if (Object.prototype.toString.call(x) === '[object Array]') { for (var i = 0; i < x.length; i++) walk(x[i]); return; }
      var t = x['@type'];
      t = Object.prototype.toString.call(t) === '[object Array]' ? t.join('/') : str(t);
      if (t) out.push({ type: t, node: x });
      if (x['@graph']) walk(x['@graph']);
      for (var k in x) if (k !== '@graph' && x.hasOwnProperty(k) && x[k] && typeof x[k] === 'object') walk(x[k]);
    }
    return out;
  }
  function gtinOf(x) { return x ? (x.gtin13 || x.gtin || x.gtin14 || x.gtin12 || x.gtin8 || '') : ''; }
  function idMatch(a, b) {
    a = clean(a).toLowerCase(); b = clean(b).toLowerCase();
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 5 && b.length >= 5 && (a.slice(-a.length) === b.slice(-a.length) || b.slice(-b.length) === a.slice(-b.length))) return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
    return false;
  }
  function variantFor(cands, row) {   // the variant that IS the feed row — never a guess
    if (!cands.length) return null;
    var vid = /[?&]variant=([^&#]+)/.exec(String(row && row.link || ''));
    for (var i = 0; i < cands.length; i++) {
      var v = cands[i];
      if (row && (idMatch(v.sku, row.id) || idMatch(v.mpn, row.id) || (row.row && (idMatch(v.sku, row.row.mpn) || (row.row.gtin && gtinOf(v) && idMatch(gtinOf(v), row.row.gtin)))))) return v;
      var urls = [v.url, v['@id'], v.offers && (v.offers.url || (v.offers[0] && v.offers[0].url))].map(str).join(' ');
      if (vid && vid[1] && urls.indexOf(vid[1]) >= 0) return v;
    }
    return cands.length === 1 ? cands[0] : null;
  }

  /* ---------------- meta / microdata / dataLayer ---------------- */
  function metaTags(html) {
    var out = {}, re1 = /<meta\s+[^>]*?(?:property|name)=["']((?:og|product|twitter):[a-z:_]+)["'][^>]*?content=["']([^"']*)["']/gi,
      re2 = /<meta\s+[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']((?:og|product|twitter):[a-z:_]+)["']/gi, m;
    while ((m = re1.exec(html))) if (!out[m[1].toLowerCase()]) out[m[1].toLowerCase()] = decode(m[2]);
    while ((m = re2.exec(html))) if (!out[m[2].toLowerCase()]) out[m[2].toLowerCase()] = decode(m[1]);
    return out;
  }
  function itemprop(html, k) {
    var m = new RegExp('itemprop=["\']' + k + '["\'][^>]*?content=["\']([^"\']*)["\']', 'i').exec(html)
      || new RegExp('<[^>]+itemprop=["\']' + k + '["\'][^>]*>([^<]{1,80})<', 'i').exec(html);
    return m ? clean(decode(m[1])) : '';
  }
  function jsonKey(html, keys) {
    for (var i = 0; i < keys.length; i++) {
      var m = new RegExp('["\']' + keys[i] + '["\']\\s*:\\s*["\']([^"\']{1,80})["\']', 'i').exec(html);
      if (m && m[1] && !/^(null|undefined|true|false|\s*)$/i.test(m[1])) return { k: keys[i], v: clean(decode(m[1])) };
    }
    return null;
  }

  /* ---------------- value normalisers ---------------- */
  function normGender(v) {
    v = clean(v).toLowerCase();
    if (!v) return '';
    if (/\b(unisex|everyone)\b/.test(v)) return 'unisex';
    if (/\b(women|womens|woman|female|ladies|lady|girls?|her)\b/.test(v) || v === 'f') return 'female';
    if (/\b(men|mens|man|male|gents?|gentlemen|boys?|him)\b/.test(v) || v === 'm') return 'male';
    return '';
  }
  function normAge(v) {
    v = clean(v).toLowerCase();
    if (!v) return '';
    if (/\b(newborn)\b/.test(v)) return 'newborn';
    if (/\b(baby|babies|infant)\b/.test(v)) return 'infant';
    if (/\b(toddler)\b/.test(v)) return 'toddler';
    if (/\b(kids?|children|child|junior|juniors|boys?|girls?|youth|teen)\b/.test(v)) return 'kids';
    if (/\b(adults?|men|mens|women|womens|ladies|gents)\b/.test(v)) return 'adult';
    return '';
  }
  function normCondition(v) {
    v = clean(v).toLowerCase();
    if (/refurb/.test(v)) return 'refurbished';
    if (/used|pre-?owned|second/.test(v)) return 'used';
    if (/new/.test(v)) return 'new';
    return '';
  }
  var FIBRES = 'cotton|polyester|polyamide|nylon|elastane|spandex|lycra|viscose|rayon|wool|merino|cashmere|silk|linen|acrylic|leather|suede|modal|lyocell|tencel|bamboo|hemp|jute|down|feather|polyurethane|pu|pvc|rubber|canvas|denim|jersey|satin|velvet|lace|mesh|fleece|metallised fibre|metallic fibre|metallised|alpaca|mohair|angora|cupro|acetate|triacetate|elastomultiester|polypropylene|glass|steel|stainless steel|brass|aluminium|aluminum|wood|bamboo|ceramic|plastic|paper|card|graphite|carbon fibre|titanium|silicone|resin|acrylic|stone|marble';
  var FIBRE_RE = new RegExp('(' + FIBRES + ')', 'i');
  // "Outer: Elastane 7% , Metallised Fibre 2% , Polyamide 91% Lining: …" → the dominant fibre
  // of the FIRST section; "100% Cotton" / "Cotton 100%" → Cotton; a lone fibre word → itself
  function materialFrom(line) {
    var s = clean(line);
    if (!s) return '';
    var first = s.split(/\b(lining|trim|sole|insole|upper|inner|filling|padding|inside)\s*:/i)[0];
    var re = new RegExp('(\\d{1,3})\\s?%\\s?(' + FIBRES + ')|(' + FIBRES + ')\\s?(\\d{1,3})\\s?%', 'gi'), m, best = null;
    while ((m = re.exec(first))) {
      var pct = +(m[1] || m[4]), fib = m[2] || m[3];
      if (!best || pct > best.pct) best = { pct: pct, fib: fib };
    }
    if (best) return cap1(best.fib.toLowerCase());
    var one = /^(?:material|fabric|composition)\s*[:\-–]\s*(.{2,40})$/i.exec(s);
    if (one && FIBRE_RE.test(one[1])) return cap1(FIBRE_RE.exec(one[1])[1].toLowerCase());
    return '';
  }
  var PATTERNS = ['plain', 'solid', 'floral', 'striped', 'stripe', 'stripes', 'checked', 'check', 'checks', 'gingham', 'polka dot', 'spotted', 'spot', 'paisley', 'leopard', 'animal print', 'zebra', 'snake print', 'geometric', 'abstract', 'printed', 'print', 'embroidered', 'colour block', 'color block', 'houndstooth', 'herringbone', 'tartan', 'plaid', 'camouflage', 'camo', 'tie dye', 'tie-dye', 'ombre', 'marl', 'textured', 'jacquard', 'chevron', 'argyle', 'pinstripe', 'dogtooth', 'ditsy', 'tropical', 'graphic', 'logo'];
  function patternFrom(line) {
    var s = clean(line).toLowerCase();
    if (!s || s.length > 30) return '';
    var lab = /^(?:pattern|print|design)\s*[:\-–]\s*(.{2,30})$/i.exec(s);
    if (lab) s = lab[1].trim();
    for (var i = 0; i < PATTERNS.length; i++) if (s === PATTERNS[i]) return cap1(s === 'solid' ? 'plain' : s);
    return '';
  }
  function sizeSystemFrom(text) {
    var m = /\b(UK|EU|US|AU|FR|DE|IT|JP|CN)\s*(?:size|sizes|sizing)\b/.exec(text);
    return m ? m[1] : '';
  }
  function sizeTypeFrom(line) {
    var s = clean(line).toLowerCase();
    if (!s || s.length > 40) return '';
    if (/\bpetite\b/.test(s)) return 'petite';
    if (/\bplus[- ]size\b|\bcurve\b/.test(s)) return 'plus';
    if (/\btall\b/.test(s) && /\b(fit|size|range|length)\b/.test(s)) return 'tall';
    if (/\bmaternity\b/.test(s)) return 'maternity';
    if (/\b(big & tall|big and tall)\b/.test(s)) return 'big';
    if (/^(regular|regular fit|standard fit)$/.test(s)) return 'regular';
    return '';
  }

  /* ---------------- the visible details rules ---------------- */
  var CARE = { bleach: 'Bleach', dry: 'Dry', 'tumble dry': 'Tumble dry', 'dry clean': 'Dry clean', wash: 'Wash', washing: 'Wash', iron: 'Iron', ironing: 'Iron', care: 'Care', 'care instructions': 'Care' };
  // the care ACTION named in the value wins over a vague label ("Dry: do not tumble dry" → Tumble dry)
  function careAttrOf(v, fallback) {
    v = String(v || '').toLowerCase();
    if (/bleach/.test(v)) return 'Bleach';
    if (/tumble/.test(v)) return 'Tumble dry';
    if (/dry clean/.test(v)) return 'Dry clean';
    if (/iron/.test(v)) return 'Iron';
    if (/wipe/.test(v)) return 'Wipe clean';
    if (/wash/.test(v)) return 'Wash';
    return fallback || 'Care';
  }
  var LABELS = ['bleach', 'dry', 'tumble dry', 'dry clean', 'wash', 'iron', 'ironing', 'colour', 'color', 'material', 'materials', 'composition', 'fabric', 'fabric composition', 'fit', 'pattern', 'print', 'care', 'care instructions', 'washing', 'heel', 'heel height', 'sole', 'upper', 'lining', 'insole', 'length', 'sleeve', 'sleeves', 'sleeve length', 'neckline', 'neck', 'closure', 'fastening', 'weight', 'dimensions', 'size', 'sizes', 'width', 'height', 'depth', 'capacity', 'volume', 'gender', 'age', 'age range', 'model', 'model height', 'model wears', 'style', 'product code', 'style code', 'sku', 'ean', 'barcode', 'country of origin', 'made in', 'collection', 'occasion', 'season', 'shape', 'texture', 'finish', 'ingredients', 'flavour', 'flavor', 'life stage', 'breed size', 'pack size', 'suitable for', 'shaft', 'flex', 'loft', 'hand', 'grip', 'brand', 'range', 'features', 'key features', 'wattage', 'power', 'colour family'];
  var DETAIL_KEYS = { colour: 'color', color: 'color', 'colour family': 'color', material: 'material', materials: 'material', composition: 'material', fabric: 'material', 'fabric composition': 'material', pattern: 'pattern', print: 'pattern', gender: 'gender', age: 'age_group', 'age range': 'age_group', ean: 'gtin', barcode: 'gtin', 'product code': 'mpn', 'style code': 'item_group_id', sku: 'mpn' };
  var FEAT_HEAD = /^(key features|features|benefits|highlights|product highlights|why you'll love it|why we love it|about this (item|product)|good to know|what's included|at a glance)\s*[:\-–]?$/i;
  var HEADING = /^(details|product details|the details|fabric & details|fabric and details|composition & care|composition and care|details & care|specification|specifications|tech specs|description|product information|size & fit|care|ingredients|delivery & returns|you may also like|you might also like|complete the look|frequently bought together|customers also (bought|viewed|loved)|recommended for you|similar (items|products|styles)|related products|wear it with|shop the look|reviews)\s*[:\-–]?$/i;
  function specLine(l) {
    var m = /^([A-Za-z][A-Za-z &\/'-]{1,30}?)\s*[:\-–]\s*(.{1,180})$/.exec(l);
    if (!m) return null;
    var lab = m[1].trim().toLowerCase();
    if (LABELS.indexOf(lab) < 0) return null;
    var v = m[2].trim();
    if (/^\{0\}$|^\{\{|^undefined$|^null$/.test(v)) return null;
    return { label: m[1].trim(), key: lab, v: v };
  }
  function detailBits(ls) {   // structured product_detail rows from the details list
    var out = [], seen = {};
    function add(section, attr, value, line) {
      var k = (attr + '|' + value).toLowerCase(); if (seen[k] || out.length >= 12) return; seen[k] = 1;
      out.push({ section: section, attr: attr, v: clean(value, 80), ev: clean(line, EV_CAP) });
    }
    for (var i = 0; i < ls.length; i++) {
      var l = ls[i]; if (NOISE.test(l)) continue;
      var sp = specLine(l);
      if (sp && CARE[sp.key]) { add('Care', careAttrOf(sp.v, CARE[sp.key]), cap1(sp.v), l); continue; }
      if (sp && ['sku', 'ean', 'barcode', 'product code', 'style code', 'model', 'model height', 'model wears', 'brand', 'features', 'key features', 'size', 'sizes'].indexOf(sp.key) < 0) { add('Details', cap1(sp.label), sp.v, l); continue; }
      var m;
      if ((m = /^(button|zip|zipper|tie|hook and eye|hook & eye|hook|popper|snap|drawstring|buckle|velcro|lace-up|lace up|slip-on|slip on|elasticated|concealed zip|magnetic)\s+(fastening|closure)$/i.exec(l))) add('Details', 'Fastening', cap1(m[1]), l);
      else if ((m = /^([a-z-]+(?: [a-z-]+)?)\s+neck(?:line)?$/i.exec(l)) && l.length < 28) add('Details', 'Neckline', cap1(m[1]), l);
      else if ((m = /^(short|long|three-quarter|3\/4|cap|sleeveless|bicep-length|elbow-length|extra long|puff|balloon|raglan|batwing)\s+sleeves?$/i.exec(l))) add('Details', 'Sleeve', cap1(m[1]), l);
      else if ((m = /^(?:l|length)\s*:?\s*(\d{2,3})\s?cm$/i.exec(l))) add('Details', 'Length', m[1] + ' cm', l);
      else if ((m = /^(machine wash(?:able)?(?: -? ?(?:cold|warm|at)?\s*\(?\d{2}°?c?\)?)?|hand wash(?: only)?|dry clean(?: only)?|do not (?:bleach|tumble dry|dry clean|iron|wash)|wipe clean|tumble dry low|cool iron|iron on reverse)$/i.exec(l))) add('Care', careAttrOf(l, 'Wash'), cap1(m[1]), l);
      else if ((m = /^(regular|relaxed|slim|skinny|loose|oversized|tailored|classic|straight|fitted|wide|boxy|cropped)\s+fit$/i.exec(l))) add('Size & Fit', 'Fit', cap1(m[1]), l);
      else if ((m = /^(outer|shell|main|body|lining|trim|sole|upper|insole|filling|inner)\s*:\s*(.{3,120})$/i.exec(l)) && /\d\s?%|cotton|polyester|leather|wool|silk|linen/i.test(m[2])) add('Composition', cap1(m[1]), m[2], l);
    }
    return out;
  }
  function highlightsFrom(ls, title) {   // bullet lines under a features/benefits heading
    var out = [], on = false, since = 0, tl = clean(title || '').toLowerCase();
    for (var i = 0; i < ls.length && out.length < 6; i++) {
      var l = ls[i];
      if (FEAT_HEAD.test(l)) { on = true; since = 0; continue; }
      if (!on) continue;
      if (HEADING.test(l) || (/[.!?]$/.test(l) && l.length > 60)) { on = false; continue; }
      since++;
      if (since > 9 || l.length > 140) { on = false; continue; }
      if (l.length < 10 || NOISE.test(l) || /[£$€]\s?\d|^\d+$|^(model|size guide|composition|material|care|delivery)/i.test(l) || specLine(l)) continue;
      if (/\d{1,3}\s?%/.test(l) || /^(outer|lining|trim|shell|main|body)\s*:/i.test(l) || /learn more|find out more|read more|see (our|the|all)|click here|view all/i.test(l)) continue;
      if (/^[A-Z0-9\s&\-\/]{4,}$/.test(l) || /[.!?]$/.test(l) && l.length > 110) continue;
      var ll = l.toLowerCase();
      if (tl && (ll === tl || tl.indexOf(ll) === 0 || ll.indexOf(tl.slice(0, 24)) === 0)) continue;
      out.push(clean(l, 110));
    }
    return uniq(out);
  }
  function docLinks(html, url) {
    var out = [], re = /<a\s+[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi, m, seen = {};
    while ((m = re.exec(html)) && out.length < 6) {
      var href = decode(m[1]).trim(), t = clean(textOf(m[2])).toLowerCase();
      var isDoc = /\.pdf(\?|$)/i.test(href) || /\b(size[- ]?guide|size chart|fit[- ]?guide|care[- ]?guide|spec(?:ification)? sheet|user (?:guide|manual)|instructions?|feeding guide|dosage|ingredients|safety data|assembly guide|datasheet)\b/i.test(t);
      if (!isDoc || /javascript:|mailto:/i.test(href)) continue;
      var abs = absUrl(href, url);
      if (!abs || seen[abs]) continue;
      seen[abs] = 1; out.push({ t: t.slice(0, 40), url: abs });
    }
    return out;
  }
  function absUrl(href, base) {
    try { if (typeof URL === 'function') return new URL(href, base).href; } catch (e) {}
    if (/^https?:\/\//i.test(href)) return href;
    var h = /^(https?:\/\/[^/]+)/i.exec(String(base || '')); if (!h) return '';
    if (href.charAt(0) === '/') return h[1] + href;
    return h[1] + '/' + href;
  }
  function relatedBlocks(html) {
    return (html.match(/you may also like|complete the look|wear it with|customers also (?:bought|viewed|loved)|recommended for you|similar (?:items|products|styles)|frequently bought together|pairs well with|goes well with|shop the look|style it with|others also bought|related products|you might also like/gi) || []).length;
  }

  /* ---------------- extract ---------------- */
  function extract(html, url, row) {
    html = String(html || '');
    url = String(url || '');
    var ex = { url: url, title: '', sources: { ld: [], meta: 0, productMeta: [], itemprops: [], dataLayer: [], blobs: [] },
      attrs: {}, details: '', images: 0, faq: 0, docs: [], related: 0, variants: 0, breadcrumb: '' };
    function put(k, v, src, ev) {
      v = clean(v, capOf(k));
      if (!v || ex.attrs[k]) return;
      ex.attrs[k] = { v: v, src: src, ev: clean(ev == null ? v : ev, EV_CAP) };
    }
    var tm = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html);
    ex.title = tm ? clean(decode(tm[1]), 160) : '';

    // 1. JSON-LD — Product / ProductGroup / variants / offers / breadcrumb / FAQ / notes
    var ld = jsonLd(html), main = null, cands = [], crumbs = null;
    ex.sources.ld = uniq(ld.map(function (x) { return x.type; }).filter(function (t) { return /Product|FAQ|Breadcrumb|Offer|ItemList|Question/i.test(t); })).slice(0, 12);
    for (var i = 0; i < ld.length; i++) {
      var t = ld[i].type, x = ld[i].node;
      if (/Product/i.test(t) && !/ProductPage/i.test(t)) {
        if (!main && (x.name || x.sku || x.offers)) main = x;
        if (x !== main && (x.sku || gtinOf(x))) cands.push(x);
      }
      if (/BreadcrumbList/i.test(t) && !crumbs && x.itemListElement) {
        crumbs = [].concat(x.itemListElement).map(function (e) { return clean(str(e && (e.name || (e.item && (e.item.name || e.item)))), 60); }).filter(Boolean);
      }
      if (/FAQPage/i.test(t)) {
        var qs = [].concat(x.mainEntity || []).filter(function (q) { return q && q.name; }); ex.faq += qs.length;
        if (qs.length) put('question_and_answer', qs.slice(0, 5).map(function (q) { var an = q.acceptedAnswer && (q.acceptedAnswer.text || q.acceptedAnswer); return clean(str(q.name), 90) + ' → ' + clean(textOf(str(an)), 160); }).join(' | '), 'ld:faq', qs.length + ' Q&A pairs in the page schema');
      }
    }
    if (main) {
      if (main.hasVariant) { var hv = [].concat(main.hasVariant); cands = hv.concat(cands); }
      ex.variants = cands.length;
      put('brand', main.brand, 'ld');
      put('item_group_id', main.productGroupID || main.inProductGroupWithID, 'ld');
      if (/ProductGroup/i.test(str(main['@type']))) put('item_group_title', main.name, 'ld');
      var vdims = main.variesBy ? [].concat(main.variesBy).map(function (v) { return str(v).replace(/^https?:\/\/schema\.org\//, '').toLowerCase(); }) : [];
      if (!vdims.length && cands.length > 1) { var vk = {}; cands.forEach(function (v) { ['color', 'size', 'material', 'pattern'].forEach(function (k) { if (v && v[k]) vk[k] = 1; }); }); vdims = Object.keys(vk); }
      var imgs = [].concat(main.image || []); if (imgs.length) ex.images = imgs.length;
      if (imgs.length > 1) put('additional_image_link', imgs.slice(1, 11).map(function (im) { return str(im && (im.url || im.contentUrl) || im); }).filter(Boolean).join(' | '), 'ld', (imgs.length - 1) + ' extra image' + (imgs.length > 2 ? 's' : '') + ' in the page schema');
      if (main.additionalProperty) {
        var ap = [].concat(main.additionalProperty).filter(function (p) { return p && p.name && p.value != null; });
        if (ap.length) put('product_detail', ap.slice(0, 8).map(function (p) { return 'Details:' + clean(str(p.name), 40) + ':' + clean(str(p.value), 60); }).join(' | '), 'ld:additionalProperty', JSON.stringify(ap[0]).slice(0, EV_CAP));
      }
      var notes = main.positiveNotes && main.positiveNotes.itemListElement;
      if (notes) { var nl = [].concat(notes).map(function (e) { return clean(str(e && (e.name || e.item)), 110); }).filter(Boolean); if (nl.length) put('product_highlight', nl.slice(0, 5).join(' | '), 'ld:positiveNotes', nl[0]); }
      if (main.isSimilarTo || main.isRelatedTo || main.isAccessoryOrSparePartFor) put('related_product', 'related products declared in the page schema', 'signal', 'isSimilarTo / isRelatedTo in the Product schema');
      if (main.audience) { put('gender', normGender(main.audience.suggestedGender), 'ld', str(main.audience.suggestedGender)); if (main.audience.suggestedMinAge != null || main.audience.suggestedMaxAge != null) put('age_group', normAge(main.audience.suggestedMaxAge != null && +main.audience.suggestedMaxAge < 14 ? 'kids' : 'adult'), 'ld', 'suggestedMinAge ' + main.audience.suggestedMinAge + ' / suggestedMaxAge ' + main.audience.suggestedMaxAge); }
      var v = variantFor(cands, row);
      var sv = v || (cands.length ? null : main);
      if (vdims.length) put('variant_option', vdims.map(function (dk) { return v && v[dk] ? dk + ':' + clean(str(v[dk]), 60) : dk; }).join(', '), v ? 'ld:variant' : 'ld', 'variesBy ' + vdims.join(', '));
      // the retailer's SKU is the MPN only for OWN-BRAND products (Monsoon sells Monsoon);
      // a third-party brand's part number is not the retailer's stock code — never map it
      var own = !!(row && row.client && main.brand && slug(str(main.brand)) === slug(row.client));
      if (sv) {
        put('gtin', gtinOf(sv), v ? 'ld:variant' : 'ld', 'sku ' + str(sv.sku));
        put('size', sv.size, v ? 'ld:variant' : 'ld');
        put('color', sv.color, v ? 'ld:variant' : 'ld');
        put('mpn', sv.mpn || (own ? sv.sku : ''), sv.mpn ? (v ? 'ld:variant' : 'ld') : 'ld:sku', sv.mpn ? str(sv.mpn) : 'own-brand sku ' + str(sv.sku));
        put('material', sv.material, 'ld'); put('pattern', sv.pattern, 'ld');
        var offs = [].concat(sv.offers || []);
        for (var o = 0; o < offs.length; o++) { if (!offs[o] || typeof offs[o] !== 'object') continue; put('condition', normCondition(str(offs[o].itemCondition)), 'ld', str(offs[o].itemCondition)); put('gtin', gtinOf(offs[o]), 'ld:offer'); }
      }
      put('color', main.color, 'ld'); put('material', main.material, 'ld'); put('pattern', main.pattern, 'ld'); put('mpn', main.mpn || (own ? main.sku : ''), main.mpn ? 'ld' : 'ld:sku', main.mpn ? str(main.mpn) : 'own-brand sku ' + str(main.sku));
      var offm = [].concat(main.offers || []);
      for (var o2 = 0; o2 < offm.length; o2++) if (offm[o2] && typeof offm[o2] === 'object') put('condition', normCondition(str(offm[o2].itemCondition)), 'ld', str(offm[o2].itemCondition));
      if (main.category && !crumbs) put('product_type', str(main.category).replace(/\s*\/\s*/g, ' > '), 'ld');
    }
    if (crumbs && crumbs.length) {
      var path = crumbs.slice();
      if (/^(home|homepage|start)$/i.test(path[0])) path.shift();
      var nm = clean(str(main && main.name) || (row && row.title) || '', 80).toLowerCase();
      if (path.length > 1 && nm && (path[path.length - 1].toLowerCase() === nm || nm.indexOf(path[path.length - 1].toLowerCase()) === 0 || path[path.length - 1].toLowerCase().indexOf(nm.slice(0, 24)) === 0)) path.pop();
      ex.breadcrumb = path.join(' > ');
      if (path.length) put('product_type', path.join(' > '), 'ld:breadcrumb');
      var g = normGender(path.slice(0, 2).join(' ')), ag = normAge(path.slice(0, 2).join(' '));
      if (g) put('gender', g, 'ld:breadcrumb', path.slice(0, 2).join(' > '));
      if (ag) put('age_group', ag, 'ld:breadcrumb', path.slice(0, 2).join(' > '));
    }

    // 2. OpenGraph / product: meta (Meta commerce tags), microdata, GA4 dataLayer, embedded JSON
    var meta = metaTags(html);
    ex.sources.meta = Object.keys(meta).length;
    ex.sources.productMeta = Object.keys(meta).filter(function (k) { return k.indexOf('product:') === 0; }).slice(0, 12);
    put('brand', meta['product:brand'], 'meta'); put('color', meta['product:color'], 'meta'); put('material', meta['product:material'], 'meta');
    put('pattern', meta['product:pattern'], 'meta'); put('size', meta['product:size'], 'meta'); put('gender', normGender(meta['product:gender']), 'meta', meta['product:gender']);
    put('age_group', normAge(meta['product:age_group']), 'meta', meta['product:age_group']); put('condition', normCondition(meta['product:condition']), 'meta', meta['product:condition']);
    // identifiers are per-VARIANT facts: a page-level GTIN/MPN (meta, microdata, embedded JSON,
    // "EAN:" lines) belongs to whichever variant the page defaulted to — on a multi-variant page
    // it would be attributed to the wrong SKU (YuMOVE's 30-bite barcode on the 90-bite row), so
    // page-level identifiers are only trusted when the page carries a single product
    var single = !cands.length;
    if (single) { put('gtin', meta['product:gtin'] || meta['product:ean'] || meta['product:upc'] || meta['product:isbn'], 'meta'); put('mpn', meta['product:mfr_part_no'], 'meta'); }
    put('item_group_id', meta['product:item_group_id'], 'meta'); put('product_type', meta['product:category'], 'meta');
    var props = {}, pm, pre = /itemprop=["']([a-zA-Z0-9]+)["']/g;
    while ((pm = pre.exec(html))) props[pm[1]] = 1;
    ex.sources.itemprops = Object.keys(props).slice(0, 12);
    ['brand', 'color', 'material', 'pattern', 'size', 'gtin13', 'gtin', 'mpn', 'category'].forEach(function (k) {
      if (!props[k] || (!single && (k === 'gtin13' || k === 'gtin' || k === 'mpn'))) return; var pv = itemprop(html, k);
      if (pv) put(k === 'gtin13' ? 'gtin' : (k === 'category' ? 'product_type' : k), pv, 'microdata');
    });
    var dl = html.match(/item_(?:brand|category\d?|variant|color|colour|size|material|gender)["']?\s*:\s*["']([^"']{1,60})["']/g) || [];
    ex.sources.dataLayer = uniq(dl.map(function (s) { return s.replace(/["']?\s*:.*$/, ''); })).slice(0, 10);
    for (var d = 0; d < dl.length; d++) {
      var dm = /item_([a-z_0-9]+)["']?\s*:\s*["']([^"']{1,60})["']/.exec(dl[d]); if (!dm) continue;
      var dk = dm[1], dv = decode(dm[2]);
      if (dk === 'brand') put('brand', dv, 'dataLayer', dl[d]);
      else if (dk === 'variant') put('variant_option', dv, 'dataLayer', dl[d]);
      else if (dk === 'color' || dk === 'colour') put('color', dv, 'dataLayer', dl[d]);
      else if (dk === 'size') put('size', dv, 'dataLayer', dl[d]);
      else if (dk === 'material') put('material', dv, 'dataLayer', dl[d]);
      else if (dk === 'gender') put('gender', normGender(dv), 'dataLayer', dl[d]);
    }
    var jk;
    if ((jk = jsonKey(html, ['colourName', 'colorName', 'swatchName', 'baseColour', 'baseColor', 'colour', 'color']))) put('color', jk.v, 'json:' + jk.k, jk.k + ': ' + jk.v);
    if ((jk = jsonKey(html, ['fabricComposition', 'materialComposition', 'composition', 'fabric', 'material']))) put('material', materialFrom('Material: ' + jk.v) || jk.v, 'json:' + jk.k, jk.k + ': ' + jk.v);
    if ((jk = jsonKey(html, ['genderName', 'gender', 'department']))) put('gender', normGender(jk.v), 'json:' + jk.k, jk.k + ': ' + jk.v);
    if (single && (jk = jsonKey(html, ['ean', 'ean13', 'barcode', 'upc', 'gtin13', 'gtin']))) put('gtin', /^\d{8,14}$/.test(jk.v) ? jk.v : '', 'json:' + jk.k, jk.k + ': ' + jk.v);
    if ((jk = jsonKey(html, ['pattern', 'printType']))) put('pattern', patternFrom(jk.v) || jk.v, 'json:' + jk.k, jk.k + ': ' + jk.v);
    if ((jk = jsonKey(html, ['ageGroup', 'age_group']))) put('age_group', normAge(jk.v), 'json:' + jk.k, jk.k + ': ' + jk.v);
    if ((jk = jsonKey(html, ['styleCode', 'styleNumber', 'parentSku', 'masterId', 'productGroupId', 'groupId']))) put('item_group_id', jk.v, 'json:' + jk.k, jk.k + ': ' + jk.v);
    var blobs = [];
    [['__NEXT_DATA__', /id=["']__NEXT_DATA__["']/], ['__NUXT__', /window\.__NUXT__/], ['__PRELOADED_STATE__', /__PRELOADED_STATE__/], ['__INITIAL_STATE__', /__INITIAL_STATE__/],
      ['Shopify', /ShopifyAnalytics\.meta|cdn\.shopify\.com/], ['dataLayer', /dataLayer\s*[=.]/], ['reviews', /bazaarvoice|yotpo|trustpilot|feefo|reviews\.io/i]].forEach(function (b) { if (b[1].test(html)) blobs.push(b[0]); });
    ex.sources.blobs = blobs;

    // 3. the visible details text — where the Golden Record gaps actually live
    var text = textOf(html), ls = lines(text);
    var compLine = '', comps = [];
    for (var li = 0; li < ls.length; li++) {
      var l = ls[li]; if (NOISE.test(l)) continue;
      var sp = specLine(l);
      if (sp) {
        var gk = DETAIL_KEYS[sp.key];
        if (gk === 'color') put('color', sp.v.length <= 40 ? sp.v : '', 'text', l);
        else if (gk === 'material') { var mf = materialFrom(l); if (mf) put('material', mf, 'text', l); if (!compLine) compLine = l; }
        else if (gk === 'pattern') put('pattern', patternFrom(sp.v) || (sp.v.length <= 30 ? cap1(sp.v) : ''), 'text', l);
        else if (gk === 'gender') put('gender', normGender(sp.v), 'text', l);
        else if (gk === 'age_group') put('age_group', normAge(sp.v), 'text', l);
        else if (gk === 'gtin') { if (single) put('gtin', /^\d{8,14}$/.test(sp.v) ? sp.v : '', 'text', l); }
        else if (gk === 'mpn') { if (single) put('mpn', sp.v.length <= 40 ? sp.v : '', 'text', l); }
        else if (gk === 'item_group_id') put('item_group_id', sp.v.length <= 40 ? sp.v : '', 'text', l);
        else if (sp.key === 'fit') { var stf = sizeTypeFrom(sp.v); if (stf) put('size_type', stf, 'text', l); }
        continue;
      }
      var cm = /^(outer|shell|main|body|material|fabric|composition)\s*:\s*(.{3,160})$/i.exec(l);
      if (cm || /\d{1,3}\s?%/.test(l) && FIBRE_RE.test(l) && l.length < 200) { comps.push(l); if (!compLine) compLine = l; var mf2 = materialFrom(l); if (mf2) put('material', mf2, 'text', l); }
      var pf = patternFrom(l); if (pf && l.length <= 30) put('pattern', pf, 'text', l);
      var st = sizeTypeFrom(l); if (st && /\b(fit|size|sizes|range|length)\b/i.test(l)) put('size_type', st, 'text', l);
    }
    var ss = sizeSystemFrom(text); if (ss) put('size_system', ss, 'text', (/\b(UK|EU|US|AU|FR|DE|IT|JP|CN)\s*(?:size|sizes|sizing)\b[^\n]{0,60}/.exec(text) || [ss])[0]);
    var bits = detailBits(ls);
    if (bits.length) put('product_detail', bits.map(function (b) { return b.section + ':' + b.attr + ':' + b.v; }).join(' | '), 'text', bits[0].ev);
    var hl = highlightsFrom(ls, ex.title || (row && row.title) || (main && main.name));
    if (hl.length >= 2) put('product_highlight', hl.slice(0, 5).join(' | '), 'text', hl[0]);
    ex.docs = docLinks(html, url);
    if (ex.docs.length) put('document_link', ex.docs.map(function (dd) { return dd.url; }).slice(0, 5).join(' | '), 'text:links', ex.docs[0].t + ' → ' + ex.docs[0].url);
    ex.related = relatedBlocks(html);
    if (ex.related) put('related_product', ex.related + ' recommendation block' + (ex.related > 1 ? 's' : '') + ' on the page — the ids come from the client\'s recommendation engine', 'signal', 'you may also like / complete the look block');

    // 4. the details excerpt the AI pass reads (and the evidence guard checks against)
    ex.details = detailsText(text, ls, ex, comps);
    return ex;
  }
  var ANCHOR = /^(product )?(details|description|composition( (&|and) care)?|materials?( & care)?|fabric( (&|and) details)?|care( instructions)?|specifications?|tech specs|key features|features|benefits|ingredients|size (&|and) fit|about this (item|product)|product information|details (&|and) care|why you'll love it|good to know)\s*[:\-–]?$/i;
  var JUNK = /^(\d+|xxs|xs|s|m|l|xl|xxl|xxxl|[a-z]|log ?in|register|my account|search|menu|close|back|next|previous|home|total|qty|quantity)$/i;
  function detailsText(text, ls, ex, comps) {
    var out = [], seen = {}, len = 0;
    function add(l) { l = clean(l, 220); if (!l || l.length < 3 || JUNK.test(l) || seen[l] || NOISE.test(l)) return; if (len + l.length > DETAILS_CAP) return; seen[l] = 1; out.push(l); len += l.length + 1; }
    if (ex.title) add('Title: ' + ex.title);
    if (ex.breadcrumb) add('Category path: ' + ex.breadcrumb);
    for (var i = 0; i < ls.length; i++) {
      if (ls[i].length > 45 || !ANCHOR.test(ls[i])) continue;
      for (var j = i; j < Math.min(ls.length, i + 16); j++) add(ls[j]);
      if (len > DETAILS_CAP * 0.8) break;
    }
    for (var c = 0; c < (comps || []).length; c++) add(comps[c]);
    for (var k = 0; k < ls.length && len < DETAILS_CAP * 0.6; k++) { var sp = specLine(ls[k]); if (sp) add(ls[k]); }
    return out.join('\n');
  }

  /* ---------------- feed vs PDP ---------------- */
  function mapToGolden(row, ex) {
    var out = { id: row.id || '', title: row.title || '', link: row.link || '', rows: {} };
    for (var i = 0; i < GOLDEN_KEYS.length; i++) {
      var k = GOLDEN_KEYS[i], f = (row.row && row.row[k]) ? clean(row.row[k], capOf(k)) : '', p = ex && ex.attrs && ex.attrs[k];
      var sig = p && p.src === 'signal';
      out.rows[k] = { feed: f, pdp: p ? p.v : '', src: p ? p.src : '', ev: p ? p.ev : '',
        state: f && p ? (sig ? 'feed' : 'both') : (f ? 'feed' : (p ? (sig ? 'signal' : 'recovered') : 'none')) };
    }
    return out;
  }
  function matrix(results, keys) {
    keys = keys || GOLDEN_KEYS;
    var m = { n: 0, ok: 0, attrs: {} };
    keys.forEach(function (k) { m.attrs[k] = { blank: 0, found: 0, both: 0, signal: 0, examples: [], srcs: {} }; });
    for (var i = 0; i < results.length; i++) {
      var r = results[i]; m.n++;
      if (!r || !r.map || r.error) continue;
      m.ok++;
      keys.forEach(function (k) {
        var x = r.map.rows[k], a = m.attrs[k]; if (!x) return;
        if (!x.feed) {
          a.blank++;
          if (x.state === 'signal') a.signal++;
          else if (x.pdp) { a.found++; if (a.examples.length < 4) a.examples.push({ id: r.map.id, v: x.pdp, src: x.src, ev: x.ev }); var s = x.src.split(':')[0]; a.srcs[s] = (a.srcs[s] || 0) + 1; }
        }
        else if (x.state === 'both') a.both++;
      });
    }
    keys.forEach(function (k) { var a = m.attrs[k]; a.rate = a.blank ? Math.round(a.found / a.blank * 100) : null; });
    return m;
  }
  function supplementalCsv(results, keys) {
    keys = keys || GOLDEN_KEYS;
    var use = keys.filter(function (k) { return results.some(function (r) { return r && r.map && r.map.rows[k] && r.map.rows[k].state === 'recovered'; }); });
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = ['id,' + use.map(function (k) { return 'g:' + k; }).join(',')];
    results.forEach(function (r) {
      if (!r || !r.map) return;
      var vals = use.map(function (k) { var x = r.map.rows[k]; return x && x.state === 'recovered' ? x.pdp : ''; });
      if (vals.some(Boolean)) out.push(q(r.map.id) + ',' + vals.map(q).join(','));
    });
    return out.join('\n');
  }

  /* ---------------- the AI pass (evidence-gated) ---------------- */
  function llmPrompt(pages) {
    var system = 'You extract Google Shopping product-feed attributes from retailer product-page text for FeedSpark. ' +
      'Reply with STRICT JSON only — no prose, no markdown fences. Shape: {"items":[{"id":"<id>","attrs":{"<attribute>":{"v":"<value>","ev":"<verbatim quote>"}}}]}. ' +
      'Attributes you may fill (only when the text explicitly supports them): color (the colour name as the retailer states it), ' +
      'material (the dominant fibre/material, one or two words), pattern (plain/floral/striped/checked/gingham/printed/… one or two words), ' +
      'gender (male|female|unisex), age_group (newborn|infant|toddler|kids|adult), size_type (regular|petite|plus|tall|big|maternity), ' +
      'size_system (UK|EU|US|AU|FR|DE|IT|JP|CN — only when the page names the sizing system), ' +
      'product_highlight (2–5 short selling points, 15–110 chars each, joined with " | "), ' +
      'product_detail (up to 8 structured specs as "Section:Attribute:Value", joined with " | " — composition per part, fit, fastening, neckline, sleeve, care, dimensions, weight, ingredients), ' +
      'item_group_title (the product family name when variants share it). ' +
      'Never fill identifiers (gtin, mpn, ids), prices or availability. Every "ev" must be a VERBATIM quote (≤160 chars) copied from that product\'s text — if you cannot quote it, omit the attribute. ' +
      'Omit attributes the text does not support. An item with nothing supportable gets "attrs":{}.';
    var parts = pages.map(function (p, i) {
      return '### Product ' + (i + 1) + '\nid: ' + p.id + '\nfeed title: ' + (p.title || '') + '\nalready in the feed: ' + (p.have || 'none') + '\nneeded: ' + (p.need || 'any') + '\n--- page text ---\n' + (p.details || '(no product-details text found)') + '\n';
    });
    return { system: system, prompt: parts.join('\n') + '\nReturn the JSON for all ' + pages.length + ' products.' };
  }
  function parseLlm(text) {
    var s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b < a) return null;
    try { var j = JSON.parse(s.slice(a, b + 1)); return j && Object.prototype.toString.call(j.items) === '[object Array]' ? j.items : null; } catch (e) { return null; }
  }
  // merge the AI attrs for ONE product into its extract: deterministic wins, vocab is
  // enforced, and the evidence must actually appear in the page text handed to the model
  function mergeLlm(ex, aiAttrs) {
    var added = [], hay = normEv(ex.details || '');
    if (!aiAttrs || typeof aiAttrs !== 'object') return added;
    for (var i = 0; i < LLM_KEYS.length; i++) {
      var k = LLM_KEYS[i], a = aiAttrs[k];
      if (!a || ex.attrs[k]) continue;
      var v = clean(typeof a === 'object' ? a.v : a, 400), ev = clean(typeof a === 'object' ? a.ev : '', EV_CAP);
      if (!v || !ev) continue;
      var nev = normEv(ev);
      if (nev.length < 4 || hay.indexOf(nev) < 0) continue;
      if (VOCAB[k]) { var lv = k === 'size_system' ? v.toUpperCase() : v.toLowerCase(); if (VOCAB[k].indexOf(lv) < 0) continue; v = lv; }
      if (k === 'product_highlight' || k === 'product_detail') { var bitsA = v.split('|').map(function (x) { return clean(x, 110); }).filter(Boolean); if (!bitsA.length) continue; v = bitsA.slice(0, 8).join(' | '); }
      else v = clean(v, 120);
      ex.attrs[k] = { v: v, src: 'ai', ev: ev };
      added.push(k);
    }
    return added;
  }

  return { VERSION: VERSION, SCAN_UA: SCAN_UA, GOLDEN_KEYS: GOLDEN_KEYS, LLM_KEYS: LLM_KEYS, VOCAB: VOCAB, ROWCAP: ROWCAP,
    sampler: sampler, hostOf: hostOf, hostAllowed: hostAllowed, linkHostFromFeedHead: linkHostFromFeedHead,
    textOf: textOf, extract: extract, mapToGolden: mapToGolden, matrix: matrix, supplementalCsv: supplementalCsv,
    llmPrompt: llmPrompt, parseLlm: parseLlm, mergeLlm: mergeLlm,
    materialFrom: materialFrom, patternFrom: patternFrom, normGender: normGender, normAge: normAge, normKey: normKey };
}));
