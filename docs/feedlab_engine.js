/* FeedSpark Feed Lab — audit engine (docs/feedlab_engine.js)
 * ------------------------------------------------------------------
 * UMD, dependency-free, browser + node. Served verbatim at /feedlab/engine.js
 * and unit-tested in node — page and tests run this exact file.
 *
 * API (contract v1 — see docs/FEEDLAB.md + scratchpad feedlab_contract.md):
 *   FeedAudit.createParser(onRow) -> {push(chunk), end()}   incremental RFC-4180 CSV
 *   FeedAudit.createXmlParser(onRow) -> {push(chunk), end()}   incremental RSS 2.0 XML
 *                                       (Meta/FB product feeds) — same onRow contract
 *   FeedAudit.normKey(rawHeader)  -> canonical column key
 *   FeedAudit.audit(header, rows, opts) -> audit JSON (opts: client, sheetId, gid,
 *                                          rowTotalEstimate, fetchedAt)
 *   FeedAudit.VERSION
 *
 * All numbers are computed from the data — nothing is hardcoded. When the caller
 * samples (rows.length < rowTotalEstimate) every COUNT in the output is scaled up
 * to the full feed (× rowCount/sampled); percentages are sample percentages.
 */
(function (root, factory) {
  var api = factory();
  try { root.FeedAudit = api; } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof globalThis !== 'undefined' ? globalThis :
  (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var VERSION = '1.4.0';   // 1.4.0: every pillar vetted against the published specs (Google / OpenAI); product_type
                           //        depth = the primary path's chevron depth, the SAME read as content quality;
                           //        a bare first column is slot one (XML feeds no longer lose it); per-pillar `reads`
                           // 1.3.0: XML header = sampled union padded to slot 10 (was first-item-only — dropped keyword slots)

  /* ================================================================
   * 1. Incremental RFC-4180 CSV parser
   * ----------------------------------------------------------------
   * State survives across push() chunks, so quoted fields with embedded
   * commas/newlines and escaped quotes ("") can split ANYWHERE across
   * chunk boundaries (including between the two quotes of an escaped
   * pair, or between CR and LF). Lenient extras: BOM strip, bare quotes
   * inside unquoted fields kept literal, unterminated quote closed at
   * end(), fully blank lines skipped, trailing row without newline
   * emitted by end().
   * ================================================================ */
  function createParser(onRow) {
    var field = '';      // accumulated current field (across chunks)
    var row = [];        // accumulated current record
    var inQ = false;     // inside a quoted field
    var qSeen = false;   // last char was '"' while inQ (escape vs close pending)
    var skipLF = false;  // last char was CR that ended a row -> swallow one LF
    var first = true;    // BOM strip on very first chunk

    function endField() { row.push(field); field = ''; }
    function endRow() {
      if (row.length === 1 && row[0] === '') { row = []; return; } // blank line
      var r = row; row = []; onRow(r);
    }

    function push(chunk) {
      chunk = String(chunk);
      if (first) { first = false; if (chunk.charCodeAt(0) === 0xFEFF) chunk = chunk.slice(1); }
      var n = chunk.length, i = 0, seg = 0, c;
      while (i < n) {
        c = chunk.charCodeAt(i);
        if (qSeen) {                       // previous char was '"' inside quotes
          qSeen = false;
          if (c === 34) { field += '"'; i++; seg = i; continue; } // "" -> literal "
          inQ = false;                     // closing quote; reprocess c unquoted
          continue;
        }
        if (inQ) {
          if (c === 34) { field += chunk.slice(seg, i); qSeen = true; i++; seg = i; }
          else i++;
          continue;
        }
        if (c === 10) {                    // LF
          if (skipLF) { skipLF = false; i++; seg = i; continue; }
          field += chunk.slice(seg, i); endField(); endRow(); i++; seg = i; continue;
        }
        skipLF = false;
        if (c === 44) {                    // comma
          field += chunk.slice(seg, i); endField(); i++; seg = i;
        } else if (c === 13) {             // CR -> row end, swallow next LF
          field += chunk.slice(seg, i); endField(); endRow(); skipLF = true; i++; seg = i;
        } else if (c === 34 && field === '' && seg === i) {
          inQ = true; i++; seg = i;        // quote at field start opens quoting
        } else {
          i++;                             // ordinary char (incl. bare " mid-field)
        }
      }
      field += chunk.slice(seg);           // carry the tail run into state
    }

    function end() {
      if (qSeen) { qSeen = false; inQ = false; }  // trailing close-quote at EOF
      inQ = false;                                 // unterminated quote: lenient close
      if (field !== '' || row.length > 0) { endField(); endRow(); }
    }

    return { push: push, end: end };
  }

  /* ================================================================
   * 1b. Incremental XML feed parser (RSS 2.0 product feeds — Meta/FB
   *     channel exports, e.g. FeedHero-hosted latest.xml)
   * ----------------------------------------------------------------
   * Same contract as createParser: push(chunk)/end(), first onRow()
   * is the header, then one row per <item>. The header is the UNION
   * of tags across the first SAMPLE items (first-seen order); any
   * tag that repeats within an item gets (2), (3)… suffixes, PADDED
   * to slot 10 (the sheet exports pre-declare product_type(1..8),
   * additional_image_link(1..10), product_highlight(1..10) — the
   * old first-item-only header silently DROPPED every slot the
   * first item didn't carry: on the real Reiss GB FeedHero feed
   * item #1 has 2 product_types while ~6k items carry 3–10, so all
   * injected keyword slots vanished from audits/kw-saturation).
   * normKey lands the suffixed names on the same canonical names as
   * the sheet exports' |||N columns. Items are flat key→text by
   * spec; CDATA is unwrapped and entities decoded. Chunk-safe: an
   * <item> split anywhere across push() boundaries is buffered
   * until its </item> arrives; complete items are released as soon
   * as the sample header is settled, so memory stays bounded by the
   * SAMPLE, never the feed.
   * ================================================================ */
  function createXmlParser(onRow) {
    var buf = '', header = null, ix = null, done = false;
    var SAMPLE = 50, PADCAP = 10, pend = [];
    function settleHeader() {   // union header over the sampled items, then release them
      var order = [], maxRep = {};
      for (var p = 0; p < pend.length; p++) {
        for (var q = 0; q < pend[p].length; q++) {
          var key = pend[p][q][0], sm = /^(.*)\((\d+)\)$/.exec(key);
          var base = sm ? sm[1] : key, n = sm ? +sm[2] : 1;
          if (!(base in maxRep)) { maxRep[base] = n; order.push(base); }
          else if (n > maxRep[base]) maxRep[base] = n;
        }
      }
      header = [];
      for (var o = 0; o < order.length; o++) {
        var b = order[o], top = maxRep[b] > 1 ? Math.max(maxRep[b], PADCAP) : 1;
        for (var s = 1; s <= top; s++) header.push(s > 1 ? b + '(' + s + ')' : b);
      }
      ix = {}; header.forEach(function (k, i) { ix[k] = i; });
      onRow(header.slice(), header);
      for (var r = 0; r < pend.length; r++) emitRow(pend[r]);
      pend = null;
    }
    function emitRow(fs) {
      // late-debut tags (sparse fields can first appear ARBITRARILY deep in a sorted feed —
      // Monsoon GB's custom_label_1 lives on 458 of 8,898 items and debuts at item #52,
      // just past the sample): GROW the live header instead of dropping the value. Every
      // earlier row was empty for this column by definition, so nothing is lost; consumers
      // get the live header as onRow's 2nd argument and can re-resolve their columns.
      for (var g = 0; g < fs.length; g++) {
        if (!(fs[g][0] in ix)) { ix[fs[g][0]] = header.length; header.push(fs[g][0]); }
      }
      var row = header.map(function () { return ''; });
      for (var i = 0; i < fs.length; i++) row[ix[fs[i][0]]] = fs[i][1];
      onRow(row, header);
    }
    function decode(s) {
      s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
      return s.replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(+d); })
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    }
    function fieldsOf(item) {   // ordered [key,value] pairs; nth repeat of a tag -> key(n)
      var out = [], seen = {}, m,
        re = /<([A-Za-z0-9_.:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>|<([A-Za-z0-9_.:-]+)(?:\s[^>]*)?\/>/g;
      while ((m = re.exec(item))) {
        var k = m[1] || m[3], v = m[1] ? decode(m[2]) : '';
        var n = (seen[k] = (seen[k] || 0) + 1);
        out.push([n > 1 ? k + '(' + n + ')' : k, v]);
      }
      return out;
    }
    function push(chunk) {
      if (done) return;
      buf += chunk;
      var lo;
      while ((lo = buf.search(/<item[\s>]/)) >= 0) {   // NOT indexOf('<item') — <item_group_id> must not match
        var hi = buf.indexOf('</item>', lo);
        if (hi < 0) { if (lo > 0) buf = buf.slice(lo); break; }   // partial item — wait for more chunks
        var body = buf.slice(buf.indexOf('>', lo) + 1, hi);
        buf = buf.slice(hi + 7);
        var fs = fieldsOf(body);
        if (!fs.length) continue;
        if (!header) {
          pend.push(fs);
          if (pend.length >= SAMPLE) settleHeader();
          continue;
        }
        emitRow(fs);
      }
      if (!header && !pend.length && buf.length > 4194304) buf = buf.slice(-65536);   // no <item> in 4MB — not a feed; keep a tail, stay bounded
    }
    function end() { done = true; buf = ''; if (!header && pend && pend.length) settleHeader(); }
    return { push: push, end: end };
  }

  /* ================================================================
   * 2. Header normalisation
   *   'g:color'                        -> 'color'
   *   'c:base_title type=""string""'   -> 'base_title'
   *   'additional_image_link|||3'      -> 'additional_image_link(3)'
   *   'g:product_type(2)'              -> 'product_type(2)'
   * ================================================================ */
  function normKey(k) {
    k = String(k == null ? '' : k);
    k = k.replace(/^\uFEFF/, '').trim();
    k = k.replace(/\s+type=.*$/i, '');       // strip ` type=""string""` suffixes
    k = k.replace(/^[gc]:/i, '');            // strip g:/c: namespace prefix
    k = k.replace(/\|\|\|(\d+)\s*$/, '($1)'); // |||N -> (N)
    return k.toLowerCase();
  }

  /* ================================================================
   * 3. Lexicons (MASK detection — Brand + Material + Fit + Colour + Use)
   * ================================================================ */
  var LEX_COLOUR = ['navy', 'black', 'white', 'grey', 'gray', 'blue', 'red', 'green', 'pink',
    'purple', 'brown', 'beige', 'cream', 'tan', 'camel', 'khaki', 'stone', 'charcoal', 'ivory',
    'orange', 'yellow', 'gold', 'silver', 'burgundy', 'rust', 'teal', 'olive', 'ecru', 'taupe',
    'sage', 'lilac', 'coral', 'mint', 'mauve', 'oatmeal', 'chocolate', 'bronze', 'blush',
    'berry', 'wine', 'off-white', 'neutral', 'multi'];
  var LEX_MATERIAL = ['wool', 'cotton', 'leather', 'silk', 'linen', 'suede', 'denim',
    'cashmere', 'merino', 'velvet', 'satin', 'viscose', 'polyester', 'nylon', 'jersey',
    'tweed', 'corduroy', 'mohair', 'alpaca', 'lyocell', 'modal', 'canvas', 'shearling',
    'crepe', 'chiffon', 'lace', 'poplin', 'twill', 'seersucker', 'jacquard', 'interlock'];
  var LEX_FIT = ['slim', 'regular', 'relaxed', 'tailored', 'oversized', 'fitted', 'straight',
    'cropped', 'skinny', 'wide-leg', 'crew-neck', 'v-neck', 'half-zip', 'funnel-neck',
    'longline', 'midi', 'maxi', 'mini', 'roll-neck', 'turtleneck', 'zip-neck', 'bootcut',
    'flared', 'a-line', 'high-rise', 'mid-rise', 'petite', 'hooded', 'double-breasted', 'wrap'];
  var LEX_USE = ['work', 'office', 'occasion', 'wedding', 'party', 'evening', 'weekend',
    'casual', 'formal', 'holiday', 'everyday', 'smart', 'gym', 'running', 'travel',
    'lounge', 'beach'];

  // word-boundary matcher cache: 'crew-neck' matches "Crew Neck"/"Crew-neck" as whole words
  var RE_CACHE = {};
  function wordRe(term) {
    var re = RE_CACHE[term];
    if (!re) {
      var toks = term.toLowerCase().split(/[\s\-]+/), parts = [], t;
      for (var i = 0; i < toks.length; i++) {
        t = toks[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (t) parts.push(t);
      }
      re = RE_CACHE[term] = new RegExp('(^|[^a-z0-9])' + parts.join('[\\s\\-]') + '([^a-z0-9]|$)');
    }
    return re;
  }
  function anyLex(lower, lex) {
    for (var i = 0; i < lex.length; i++) if (wordRe(lex[i]).test(lower)) return true;
    return false;
  }
  // split an attribute value ("Navy/White", "Main 55% Wool/ 41% Polyester…") into match tokens
  function valTokens(v) {
    var raw = String(v).toLowerCase().split(/[\/,;|&+]/), out = [], t;
    for (var i = 0; i < raw.length; i++) {
      t = raw[i].replace(/[0-9%.]/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (t.length >= 3) out.push(t);
    }
    return out;
  }

  /* ================================================================
   * 4. audit(header, rows, opts)
   * ================================================================ */
  var CONV_ATTRS = ['question_and_answer', 'document_link', 'related_product',
    'item_group_title', 'variant_option', 'popularity_rank'];
  var FEEDHERO_COLS = ['base_title', 'auto_optimised_title', 'new_product_name_with_rules',
    'fs_data_opti'];
  var ATTR_LABELS = {
    id: 'ID', title: 'Title', description: 'Description', link: 'Link',
    image_link: 'Image link', availability: 'Availability', price: 'Price',
    sale_price: 'Sale price', google_product_category: 'Google product category',
    product_type: 'Product type', brand: 'Brand', gtin: 'GTIN', mpn: 'MPN',
    identifier_exists: 'Identifier exists', condition: 'Condition', is_bundle: 'Is bundle',
    age_group: 'Age group', color: 'Colour', gender: 'Gender', material: 'Material',
    pattern: 'Pattern', size: 'Size', item_group_id: 'Item group ID', shipping: 'Shipping',
    return_policy_label: 'Return policy label', product_detail: 'Product detail',
    question_and_answer: 'Question & answer', document_link: 'Document link',
    related_product: 'Related product', item_group_title: 'Item group title',
    variant_option: 'Variant option', popularity_rank: 'Popularity rank'
  };
  var CORE_ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability',
    'price', 'sale_price', 'google_product_category', 'product_type', 'brand', 'gtin', 'mpn',
    'identifier_exists', 'condition', 'is_bundle', 'age_group', 'color', 'gender', 'material',
    'pattern', 'size', 'item_group_id', 'shipping', 'return_policy_label', 'product_detail'];

  /* ---- the taxonomy reads shared with the content-quality engine (labelguard.js) -------
   * pathDepth is labelguard's, verbatim: chevron levels, "/" as the fallback separator, a
   * value with neither = one level. Product Type Guard's depthProfile, content quality's
   * avgDepth and this audit all count depth with this one function, so the three surfaces
   * can never disagree about how deep a path is (Ray, 17 Sep 2026: Schuh GB read 3.3 levels
   * on the content-quality row and "2.2 levels deep" on the AI-readiness tile — the tile was
   * counting filled KEYWORD SLOTS, not levels, and had dropped the category column). */
  function pathDepth(v) {
    var s = String(v == null ? '' : v).replace(/^\s+|\s+$/g, '');
    if (!s) return 0;
    var sep = s.indexOf('>') >= 0 ? '>' : (s.indexOf('/') >= 0 ? '/' : null);
    if (!sep) return 1;
    var parts = s.split(sep), n = 0;
    for (var i = 0; i < parts.length; i++) if (parts[i].replace(/^\s+|\s+$/g, '')) n++;
    return n;
  }
  /* Google's product taxonomy has 52 second-level branches with NO third level (derived once
   * from the official taxonomy-with-ids export — the same list labelguard.js keeps as
   * GPC_LEAF2, and tools/test_feedlab.mjs asserts the two copies are identical). "Apparel &
   * Accessories > Shoes" IS the most specific category Google offers, so it earns full
   * credit here exactly as it passes the content-quality "too broad" rule. */
  var GPC_LEAF2 = {};
  ['animals & pet supplies > live animals', 'apparel & accessories > shoes',
    'arts & entertainment > event tickets', 'baby & toddler > baby gift sets',
    'business & industrial > film & television', 'business & industrial > forestry & logging',
    'business & industrial > hotel & hospitality', 'business & industrial > industrial storage accessories',
    'business & industrial > janitorial carts & caddies', 'business & industrial > manufacturing',
    'business & industrial > mining & quarrying', 'electronics > gps navigation systems',
    'electronics > gps tracking devices', 'electronics > radar detectors', 'electronics > speed radars',
    'electronics > toll collection devices', 'electronics > video game consoles',
    'furniture > entertainment centers & tv stands', 'furniture > futon frames', 'furniture > futon pads',
    'furniture > futons', 'furniture > ottomans', 'furniture > room divider accessories',
    'furniture > room dividers', 'furniture > sofas', 'hardware > fuel containers & tanks',
    'hardware > small engines', 'hardware > storage tanks', 'home & garden > fireplaces',
    'home & garden > parasols & rain umbrellas', 'home & garden > umbrella sleeves & cases',
    'home & garden > wood stoves', 'luggage & bags > backpacks', 'luggage & bags > briefcases',
    'luggage & bags > cosmetic & toiletry bags', 'luggage & bags > diaper bags', 'luggage & bags > dry boxes',
    'luggage & bags > duffel bags', 'luggage & bags > fanny packs', 'luggage & bags > garment bags',
    'luggage & bags > messenger bags', 'luggage & bags > shopping totes', 'luggage & bags > suitcases',
    'luggage & bags > train cases', 'media > carpentry & woodworking project plans', 'media > sheet music',
    'office supplies > desk pads & blotters', 'office supplies > impulse sealers', 'office supplies > lap desks',
    'office supplies > name plates', 'software > video game software', 'toys & games > game timers'
  ].forEach(function (k) { GPC_LEAF2[k] = 1; });
  // How specific a GPC value is, 0–1: Google asks for "the most specific category possible"
  // (answer 6324436) and accepts the numeric ID or the full path. An ID cannot be judged for
  // depth here, and Google resolves it to its exact node, so it is taken as specific; a path
  // of 3+ levels, or a 2-level path Google's own taxonomy ends at, is specific; a 2-level
  // path with a deeper option is half credit; a bare top-level name a quarter — the same
  // three thresholds the content-quality "too broad" rule draws its warning at.
  function gpcCredit(v, depth) {
    if (/^\d{2,8}$/.test(v)) return 1;
    if (depth >= 3) return 1;
    if (depth === 2) {
      var lv = v.split('>'), key = [];
      for (var i = 0; i < lv.length; i++) key.push(lv[i].replace(/^\s+|\s+$/g, '').toLowerCase());
      return GPC_LEAF2[key.join(' > ')] ? 1 : 0.5;
    }
    return 0.25;
  }
  // product_type: "include all the levels" (answer 6324406) — the content-quality rule warns
  // on a single level; 3+ levels is where Product Type Guard's granularity read starts. Same
  // three steps as GPC so the two halves of the pillar read alike.
  function ptCredit(depth) { return depth >= 3 ? 1 : (depth === 2 ? 0.5 : 0.25); }
  // description length against the one range Google states — "list the most important
  // details in the first 160–500 characters" (answer 6324468): under 160 the description
  // cannot carry them (the content-quality "thin" rule fires at the same 160); credit grows
  // linearly to full at 500, the top of Google's own window. No house number in it.
  var DESC_FLOOR = 160, DESC_FULL = 500;
  function descCredit(len) { return len >= DESC_FULL ? 1 : (len >= DESC_FLOOR ? len / DESC_FULL : 0); }

  /* ---- what every pillar reads, and where each number comes from ---------------------
   * Rendered as the scoring pop-up on /feedlab and /golden (Ray, 17 Sep 2026: "vet every
   * single tile of AI readiness against what the current industry or high-authoritative
   * platforms such as Google, ChatGPT, or Claude recommend, and remove all the subtext
   * underneath"). One copy, in the engine, so the two pages cannot drift. `f` = the formula
   * in words, `src` = the published pages each threshold is taken from, `house` = anything
   * that is FeedSpark's own standard rather than a platform's, named as such. */
  var G = 'https://support.google.com/merchants/answer/';
  var OPENAI_FEED = 'https://developers.openai.com/commerce/specs/feed';
  var CLAUDE_COMMERCE = 'https://claude.com/blog/the-anatomy-of-effective-commerce-agents';
  var BASIS = {
    conversational: {
      f: ['Mean coverage of Google’s six conversational attributes — question_and_answer, document_link, related_product, item_group_title, variant_option, popularity_rank.',
        'Coverage, not presence: an attribute on 3% of the catalogue scores 3, not 100.',
        'A feed with no item_group_id is judged on four — the variant pair cannot apply to it.'],
      src: [['Google · conversational attributes (answer 17085370): “help customers discover information about your products across AI-driven surfaces, like AI Mode in Search”', G + '17085370']],
      house: 'The ×2.4 weight is FeedSpark’s: it is set so that every other pillar together tops out at 79, so a feed carrying none of the fields Google built for AI surfaces cannot read as Agentic-ready.' },
    identity: {
      f: ['Mean coverage of six fields: id, link, brand, gtin or mpn, price, availability.',
        'Each is required by Google for a new product and by the OpenAI product feed; an agent that cannot identify, price or link to the offer cannot sell it.'],
      src: [['Google · product data specification (answer 7052112): id, link, price, availability required; brand required for new products; gtin where one exists', G + '7052112'],
        ['OpenAI · product feed spec: item_id, url, brand, price, availability required', OPENAI_FEED]],
      house: null },
    titles: {
      f: ['0.40 length: full credit 70–150 characters, half credit 30–69, none under 30 or over 150.',
        '0.40 MASK structure — the share of titles carrying fit (×.25), material (×.2), colour (×.2), use-case (×.2) and brand (×.15).',
        '0.20 hygiene: 100 minus the share of duplicated titles minus the share in ALL CAPS.',
        'Meta feeds: full credit 25–65, half 66–90 (Meta truncates at ~65), weighted 0.5 / 0.3 / 0.2.'],
      src: [['Google · title (answer 6324415): 1–150 characters, “users will usually notice only the first 70”, brand + distinguishing details such as colour, size, material; no all caps', G + '6324415'],
        ['OpenAI · product feed spec: title at most 150 characters', OPENAI_FEED]],
      house: 'MASK (Brand + Material + Fit + Colour + Use-case) and its 80–120 window are FeedSpark’s house structure — Google names the ingredients, not the order or the window.' },
    descriptions: {
      f: ['0.50 coverage — the share of products with any description.',
        '0.30 length: each description earns nothing under 160 characters, then a growing share up to full credit at 500.',
        '0.20 uniqueness — 100 minus the share of distinct copy reused across different products (variants of one product may share copy).'],
      src: [['Google · description (answer 6324468): 1–5,000 characters, “list the most important details in the first 160–500 characters”, “describe only the product itself”', G + '6324468'],
        ['OpenAI · product feed spec: description at most 5,000 characters', OPENAI_FEED]],
      house: null },
    attributes: {
      f: ['Weighted coverage of the variant and visual attributes: color, size, item_group_id (×1.2), material, gender, age_group (×1), pattern (×0.8).',
        'Follows the industry scoring profile: color/size/gender/age_group/item_group_id count only when present or when the profile expects them; material and pattern always, unless the profile waives them.'],
      src: [['Google · product data specification (answer 7052112): color, size, gender, age_group required for apparel; material and pattern optional', G + '7052112'],
        ['OpenAI · product feed spec: material, color, size, gender, age_group listed as optional fields', OPENAI_FEED]],
      house: 'The weights are FeedSpark’s; which attributes count is the industry best-practice profile set on the Golden Record page.' },
    taxonomy: {
      f: ['0.50 google_product_category — mean per-product credit: a numeric ID, a path of 3+ levels or a 2-level branch Google’s taxonomy ends at = 1; another 2-level path = 0.5; one level = 0.25; missing = 0.',
        '0.50 product_type — the PRIMARY value’s chevron depth (bare g:product_type or slot 1; keyword slots 2–10 are not the category tree): 3+ levels = 1, two = 0.5, one = 0.25, missing = 0.',
        'Depth is counted with the same function the content-quality rows and Product Type Guard use, so “levels deep” is one number everywhere.'],
      src: [['Google · google_product_category (answer 6324436): “use the most specific category possible”; the ID or the full path', G + '6324436'],
        ['Google · product_type (answer 6324406): “include all the levels”, separated by “ > ”; only the first value is used for bidding and reporting', G + '6324406'],
        ['OpenAI · product feed spec: product_category “broad to specific”', OPENAI_FEED]],
      house: null },
    media: {
      f: ['0.50 image_link coverage.',
        '0.50 additional images: min(average additional_image_link per product ÷ 3, 1).',
        'http vs https is not scored — Google accepts either.'],
      src: [['Google · image_link (answer 6324350): required, http or https, at least 500 × 500 px', G + '6324350'],
        ['Google · additional_image_link (answer 6324370): up to 10, “different angles, in use, or in different settings”', G + '6324370'],
        ['OpenAI · product feed spec: image_url required, additional_image_urls optional', OPENAI_FEED]],
      house: 'Three additional images = one of each kind Google’s page names (another angle, in use, another setting) — FeedSpark’s reading of that list, not a number Google states.' },
    ai: {
      f: ['0.40 product_highlight: min(average highlights per product ÷ 4, 1).',
        '0.30 product_detail coverage — the share of products with at least one section:attribute:value detail.',
        '0.30 description length, the same 160–500 read as the Descriptions pillar — how much there is to quote.',
        'product_type depth is NOT read here — Taxonomy depth owns it, so nothing is counted twice.'],
      src: [['Google · product_highlight (answer 9216100): 2–100 per product, 4–6 recommended; shown “across AI-driven surfaces, like AI Mode”', G + '9216100'],
        ['Google · product_detail (answer 9218260): “technical specifications or other additional details”, so customers “discover information about your products across AI-driven surfaces”', G + '9218260'],
        ['Anthropic · The anatomy of effective commerce agents (Sep 2026): the agent’s product tools “call those systems, not reimplement them” — what the catalogue returns is what the agent reasons over and quotes', CLAUDE_COMMERCE]],
      house: null }
  };

  function round1(x) { return Math.round(x * 10) / 10; }
  function clamp(x) { return Math.max(0, Math.min(100, Math.round(x))); }
  function fmtN(x) { return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtK(x) { return x >= 1000 ? (Math.round(x / 100) / 10) + 'k' : String(Math.round(x)); }

  function tierFor(total) {
    // FeedSpark AI-Readiness ladder
    if (total >= 80) return { tier: 4, tierLabel: 'Agentic-ready' };
    if (total >= 60) return { tier: 3, tierLabel: 'Enriched' };
    if (total >= 40) return { tier: 2, tierLabel: 'Structured' };
    return { tier: 1, tierLabel: 'Foundational' };
  }

  function audit(header, rows, opts) {
    opts = opts || {};
    // CHANNEL-AWARE title norms (opts.channel: 'google' default | 'meta'). Google Shopping
    // rewards the 80–120 MASK window; Meta/Facebook TRUNCATES catalogue titles at ~65 chars,
    // so a concise ≤65 title is correct there — never a gap. Bands: [thin, half, full, over].
    var META = opts.channel === 'meta';
    var LB = META ? [25, 40, 66, 91] : [50, 80, 120, 151];   // band edges: b0 <LB[0] | b1 <LB[1] | b2 <LB[2] | b3 <LB[3] | b4 rest
    // full-credit bands: google b2+b3 (80–150) half b1 (50–79); meta b1+b2 (25–65) half b3 (66–90)
    var n = rows.length;
    var rowCount = (opts.rowTotalEstimate > 0 ? Math.round(opts.rowTotalEstimate) : n) || n;
    if (rowCount < n) rowCount = n;
    var scale = n > 0 ? rowCount / n : 1;
    function C(x) { return Math.round(x * scale); }          // scaled count
    function P(x) { return n > 0 ? Math.round(100 * x / n) : 0; } // pct of sample

    // ---- column map: canonical key -> [column indices] (dup headers OR together)
    var keys = [], idx = {}, i, j, k;
    for (i = 0; i < header.length; i++) {
      k = normKey(header[i]); keys.push(k);
      if (!k) continue;
      (idx[k] = idx[k] || []).push(i);
    }
    function has(key) { return !!idx[key]; }
    function val(r, key) {
      var ii = idx[key]; if (!ii) return '';
      for (var a = 0; a < ii.length; a++) {
        var v = r[ii[a]];
        if (v != null && v !== '' && String(v).replace(/^\s+|\s+$/g, '') !== '') {
          return String(v).replace(/^\s+|\s+$/g, '');
        }
      }
      return '';
    }
    // slot lists present in header. SLOT ONE IS THE BARE COLUMN when there is one: the XML
    // parser names the first repeat of a tag bare and the rest (2), (3)… while the sheet
    // exports pre-declare (1)…(10) — so a slot list that started at "(1)" DROPPED the first
    // value of every repeatable attribute on every XML feed (Monsoon GB's four highlights
    // read as three; the primary product_type — the category tree — left the audit
    // altogether and "depth" became a count of keyword slots). Bare and (1) are the same
    // slot, never both counted.
    function slots(prefix, max) {
      var out = [];
      if (has(prefix)) out.push(prefix); else if (has(prefix + '(1)')) out.push(prefix + '(1)');
      for (var s = 2; s <= max; s++) if (has(prefix + '(' + s + ')')) out.push(prefix + '(' + s + ')');
      return out;
    }
    var ADDL = slots('additional_image_link', 10);
    var HL = slots('product_highlight', 10);
    var PD = slots('product_detail', 10);
    var PT = slots('product_type', 10);
    // the PRIMARY product_type = the category tree Google reads: bare g:product_type, or
    // slot 1 of the numbered family (labelguard's KEY_ALIASES — the content-quality row and
    // Product Type Guard resolve it exactly this way). Slots 2–10 are FeedSpark keyword
    // injection, counted as assignments, never as depth.
    var PT_PRIMARY = has('product_type') ? 'product_type' : (has('product_type(1)') ? 'product_type(1)' : null);
    var LABELS5 = [];
    for (i = 0; i <= 4; i++) if (has('custom_label_' + i)) LABELS5.push('custom_label_' + i);

    // ---- single pass over sampled rows -------------------------------------
    var attrFill = {};                        // key -> filled count
    var measured = [];                        // attribute keys measured for coverage
    var SLOTTED = { product_type: PT, product_detail: PD };   // coverage read across every slot
    for (i = 0; i < CORE_ATTRS.length; i++) {
      k = CORE_ATTRS[i];
      if (SLOTTED[k] ? SLOTTED[k].length : has(k)) measured.push(k);
    }
    for (i = 0; i < CONV_ATTRS.length; i++) measured.push(CONV_ATTRS[i]); // always shown (gap view)
    for (i = 0; i < measured.length; i++) attrFill[measured[i]] = 0;

    var tl = { n: 0, sum: 0, min: Infinity, max: 0, caps: 0, seen: {}, dup: 0, full: 0, half: 0, over: 0, thin: 0,
      b: [0, 0, 0, 0, 0], mask: { brand: 0, material: 0, colour: 0, fit: 0, use: 0 } };
    var de = { filled: 0, chars: 0, short: 0, deep: 0, credit: 0, owner: {} };
    var me = { img: 0, https: 0, addlSum: 0, zero: 0 };
    var hlFill = [], hlSum = 0; for (i = 0; i < 10; i++) hlFill.push(0);
    var pdAny = 0;
    var tx = { gpc: 0, gpcSegs: 0, gpcCredit: 0, gpcFull: 0, ptAny: 0, ptSlotSum: 0,
      ptPrim: 0, ptDepthSum: 0, ptDeep: 0, ptCredit: 0 };
    var lb = {}; for (i = 0; i < LABELS5.length; i++) lb[LABELS5[i]] = { n: 0, freq: {} };
    var idOk = 0, linkOk = 0, brandOk = 0, gmOk = 0, priceOk = 0, availOk = 0, condOk = 0;
    var perRow = [];                          // per-row digest for samples/dissect

    function anySlot(rr, list) { for (var s = 0; s < list.length; s++) if (val(rr, list[s])) return true; return false; }
    for (i = 0; i < n; i++) {
      var r = rows[i];

      // attribute coverage
      for (j = 0; j < measured.length; j++) {
        k = measured[j];
        var got = SLOTTED[k] ? anySlot(r, SLOTTED[k]) : val(r, k) !== '';
        if (got) attrFill[k]++;
      }

      // identity — the six fields Google requires of a new product and the OpenAI feed
      // requires of every item (condition is optional for new goods on both, so it is
      // measured below but not scored)
      var gtin = val(r, 'gtin'), mpn = val(r, 'mpn');
      if (val(r, 'id')) idOk++;
      if (val(r, 'link')) linkOk++;
      var brand = val(r, 'brand'); if (brand) brandOk++;
      if (gtin || mpn) gmOk++;
      if (val(r, 'price')) priceOk++;
      if (val(r, 'availability')) availOk++;
      if (val(r, 'condition')) condOk++;

      // titles + MASK
      var t = val(r, 'title'), maskArr = [], lower = '', len = 0;
      if (t) {
        len = t.length; lower = t.toLowerCase();
        tl.n++; tl.sum += len;
        if (len < tl.min) tl.min = len; if (len > tl.max) tl.max = len;
        if (len < LB[0]) tl.b[0]++; else if (len < LB[1]) tl.b[1]++; else if (len < LB[2]) tl.b[2]++;
        else if (len < LB[3]) tl.b[3]++; else tl.b[4]++;
        // Google's title edges: 150 max (answer 6324415), "users will usually notice only
        // the first 70 or fewer characters", and under 30 a title cannot carry brand +
        // product + a distinguishing detail (the content-quality "thin" rule's own line)
        if (len > 150) tl.over++; else if (len >= 70) tl.full++; else if (len >= 30) tl.half++; else tl.thin++;
        if (/[A-Za-z]/.test(t) && t === t.toUpperCase()) tl.caps++;
        if (tl.seen[t]) tl.dup++; else tl.seen[t] = 1;
        var colV = val(r, 'color'), matV = val(r, 'material'), tk, a;
        var mBrand = !!(brand && wordRe(brand.toLowerCase()).test(lower));
        var mColour = false;
        if (colV) { tk = valTokens(colV); for (a = 0; a < tk.length; a++) if (wordRe(tk[a]).test(lower)) { mColour = true; break; } }
        if (!mColour) mColour = anyLex(lower, LEX_COLOUR);
        var mMat = false;
        if (matV) { tk = valTokens(matV); for (a = 0; a < tk.length; a++) if (wordRe(tk[a]).test(lower)) { mMat = true; break; } }
        if (!mMat) mMat = anyLex(lower, LEX_MATERIAL);
        var mFit = anyLex(lower, LEX_FIT);
        var mUse = anyLex(lower, LEX_USE);
        if (mBrand) { tl.mask.brand++; maskArr.push('brand'); }
        if (mColour) { tl.mask.colour++; maskArr.push('colour'); }
        if (mFit) { tl.mask.fit++; maskArr.push('fit'); }
        if (mMat) { tl.mask.material++; maskArr.push('material'); }
        if (mUse) { tl.mask.use++; maskArr.push('use'); }
        maskArr.sort();
      }

      // descriptions (uniqueness judged per item_group — size variants legitimately share copy)
      var d = val(r, 'description');
      if (d) {
        de.filled++; de.chars += d.length; de.credit += descCredit(d.length);
        if (d.length < DESC_FLOOR) de.short++; else de.deep++;
        var grp = val(r, 'item_group_id') || val(r, 'id') || String(i);
        var own = de.owner[d];
        if (own === undefined) de.owner[d] = grp;
        else if (own !== grp && own !== true) de.owner[d] = true; // true => shared across groups
      }

      // media
      var img = val(r, 'image_link');
      if (img) { me.img++; if (/^https:\/\//i.test(img)) me.https++; }
      var addl = 0;
      for (j = 0; j < ADDL.length; j++) if (val(r, ADDL[j])) addl++;
      me.addlSum += addl; if (!addl) me.zero++;

      // highlights + product details (both repeatable: one value per slot)
      var hlc = 0;
      for (j = 0; j < HL.length; j++) if (val(r, HL[j])) { hlFill[j]++; hlc++; }
      hlSum += hlc;
      if (anySlot(r, PD)) pdAny++;

      // taxonomy: GPC = how specific (ID / 3+ levels / a branch Google ends at = full);
      // product_type = the PRIMARY path's chevron depth (pathDepth — the content-quality
      // and Product Type Guard read), keyword slots counted separately as assignments
      var gpc = val(r, 'google_product_category'), gd = 0;
      if (gpc) {
        tx.gpc++; gd = pathDepth(gpc); tx.gpcSegs += gd;
        var gc = gpcCredit(gpc, gd); tx.gpcCredit += gc; if (gc >= 1) tx.gpcFull++;
      }
      var ptc = 0;
      for (j = 0; j < PT.length; j++) if (val(r, PT[j])) ptc++;
      if (ptc) tx.ptAny++;
      tx.ptSlotSum += ptc;
      var ptv = PT_PRIMARY ? val(r, PT_PRIMARY) : '', ptd = 0;
      if (ptv) {
        ptd = pathDepth(ptv); tx.ptPrim++; tx.ptDepthSum += ptd; tx.ptCredit += ptCredit(ptd);
        if (ptd >= 3) tx.ptDeep++;
      }

      // labels
      for (j = 0; j < LABELS5.length; j++) {
        var lv = val(r, LABELS5[j]);
        if (lv) { var L = lb[LABELS5[j]]; L.n++; L.freq[lv] = (L.freq[lv] || 0) + 1; }
      }

      // per-row digest (samples + dissection theatre)
      var q = maskArr.length + (META ? (len >= 25 && len <= 65 ? 2 : (len >= 20 && len <= 90 ? 1 : 0))
        : (len >= 70 && len <= 150 ? 2 : (len >= 30 ? 1 : 0))) +
        (d ? (d.length >= DESC_FULL ? 2 : 1) : 0) + (addl >= 3 ? 1 : 0) + (hlc >= 4 ? 1 : 0);
      perRow.push({ i: i, t: t, len: len, mask: maskArr, q: q, desc: d ? d.length : 0,
        addl: addl, hl: hlc, pt: ptc, ptd: ptd, pat: val(r, 'pattern') !== '', mFit: t ? maskArr.indexOf('fit') >= 0 : false,
        mUse: t ? maskArr.indexOf('use') >= 0 : false, id: val(r, 'id') });
    }

    // ---- derived stats ------------------------------------------------------
    var attributes = [];
    for (i = 0; i < measured.length; i++) {
      k = measured[i];
      attributes.push({ key: k, label: ATTR_LABELS[k] || k, pct: P(attrFill[k]), n: C(attrFill[k]) });
    }
    function apct(key) { return P(attrFill[key] || 0); }

    var titledPct = function (x) { return tl.n > 0 ? Math.round(100 * x / tl.n) : 0; };
    var titles = {
      avg: tl.n ? Math.round(tl.sum / tl.n) : 0,
      min: tl.n ? tl.min : 0, max: tl.max,
      dup: C(tl.dup), allCaps: C(tl.caps),
      buckets: [
        { b: '<' + LB[0], n: C(tl.b[0]) }, { b: LB[0] + '–' + (LB[1] - 1), n: C(tl.b[1]) }, { b: LB[1] + '–' + (LB[2] - 1), n: C(tl.b[2]) },
        { b: LB[2] + '–' + (LB[3] - 1), n: C(tl.b[3]) }, { b: '>' + (LB[3] - 1), n: C(tl.b[4]) }],
      mask: { brand: titledPct(tl.mask.brand), material: titledPct(tl.mask.material),
        colour: titledPct(tl.mask.colour), fit: titledPct(tl.mask.fit), use: titledPct(tl.mask.use) },
      samples: []
    };

    // samples: 3 weakest + 3 strongest titled rows (distinct titles)
    var titled = [], seenT = {};
    for (i = 0; i < perRow.length; i++) if (perRow[i].t) titled.push(perRow[i]);
    titled.sort(function (a, b) { return a.q - b.q || a.len - b.len; });
    function takeSample(list, upto) {
      for (var a = 0; a < list.length && titles.samples.length < upto; a++) {
        var p = list[a];
        if (seenT[p.t]) continue; seenT[p.t] = 1;
        titles.samples.push({ t: p.t, len: p.len, mask: p.mask });
      }
    }
    takeSample(titled, 3);                               // 3 worst
    takeSample(titled.slice().reverse(), 6);             // 3 best

    var dupShared = 0, dupDistinct = 0, dk;
    for (dk in de.owner) { dupDistinct++; if (de.owner[dk] === true) dupShared++; }
    var descDupPct = dupDistinct ? Math.round(100 * dupShared / dupDistinct) : 0;
    var descriptions = {
      pct: P(de.filled),
      avg: n ? Math.round(de.chars / n) : 0,     // avg over ALL items (missing read as 0 by agents)
      short: C(de.short),                         // filled but under Google's 160-char floor
      full: C(de.deep),                           // filled and at or past the floor
      dupPct: descDupPct                          // % of distinct copy reused across item groups
    };

    var media = {
      imagePct: P(me.img),
      httpsPct: me.img ? Math.round(100 * me.https / me.img) : 0,   // measured, not scored
      addlAvg: n ? round1(me.addlSum / n) : 0,
      zeroAddl: C(me.zero)
    };

    var highlights = { depth: [], avg: n ? round1(hlSum / n) : 0 };
    for (i = 0; i < 10; i++) highlights.depth.push(P(hlFill[i]));
    var details = { pct: P(pdAny), slots: PD.length };

    var labels = [];
    for (i = 0; i < LABELS5.length; i++) {
      var Lk = LABELS5[i], L = lb[Lk], tops = [], fv;
      for (fv in L.freq) tops.push([fv, L.freq[fv]]);
      tops.sort(function (a, b) { return b[1] - a[1]; });
      labels.push({ key: Lk, pct: P(L.n), top: tops.slice(0, 3).map(function (x) { return x[0]; }) });
    }

    var taxonomy = {
      gpcPct: P(tx.gpc),
      gpcDepthAvg: tx.gpc ? round1(tx.gpcSegs / tx.gpc) : 0,   // mean levels over filled = content quality's avgDepth
      gpcSpecificPct: P(tx.gpcFull),                             // share of ALL items at full credit
      ptPct: P(tx.ptPrim),                                       // primary product_type coverage
      ptDepthAvg: tx.ptPrim ? round1(tx.ptDepthSum / tx.ptPrim) : 0,   // mean levels over filled = content quality's avgDepth
      ptDeepPct: P(tx.ptDeep),                                   // share of ALL items at 3+ levels
      ptSlotsAvg: n ? round1(tx.ptSlotSum / n) : 0,              // type assignments per item incl. keyword slots — not depth
      ptPrimary: PT_PRIMARY
    };

    var fhCols = [];
    for (i = 0; i < FEEDHERO_COLS.length; i++) if (has(FEEDHERO_COLS[i])) fhCols.push(FEEDHERO_COLS[i]);
    var pipeline = { feedhero: fhCols.length > 0, cols: fhCols };

    /* ---- pillar scores (0–100) — FeedSpark AI-Readiness ladder ------------
     * Every threshold below is the one BASIS (above) cites; the pop-up on both pages
     * renders BASIS, so change the two together.
     * titles       = .40 length (full credit 70–150 — Google: first 70 noticed, 150 max;
     *                half 30–69) + .40 MASK (fit .25, material .2, colour .2, use .2,
     *                brand .15) + .20 hygiene
     *                META channel: .50 length (full 25–65, half 66–90 — FB truncates ~65)
     *                + .30 MASK + .20 hygiene
     * descriptions = .5 coverage + .3 length credit (0 under 160, linear to 1 at 500 —
     *                Google's "first 160–500 characters") + .2 uniqueness
     * attributes   = weighted coverage (color/size/item_group ×1.2, material/
     *                gender/age_group ×1, pattern ×.8) under the industry profile
     * identity     = mean(id, link, brand, gtin|mpn, price, availability) — condition
     *                is optional for new goods on Google and OpenAI, so it left the score
     * taxonomy     = .5 mean GPC credit (ID / 3+ levels / terminal 2-level = 1, other
     *                2-level .5, 1 level .25) + .5 mean primary product_type depth credit
     *                (3+ = 1, 2 = .5, 1 = .25) — coverage is built in (missing = 0)
     * media        = .5 image + .5 min(addlAvg/3,1) — https is measured, not scored
     * conversational = mean COVERAGE of Google's six conversational attributes
     *                (variant pair excluded when the feed carries no variants)
     * ai           = .4 highlights min(avg/4,1) + .3 product_detail coverage + .3
     *                description length credit — product_type depth lives in taxonomy only
     *
     * VETTED 17 Sep 2026 (Ray: "vet every single tile of AI readiness against what the
     * current industry or high-authoritative platforms such as Google, ChatGPT, or Claude
     * recommend"): product_type depth is the primary path's chevron depth, the SAME
     * pathDepth read as the content-quality row (Schuh GB: 3.3 on one, "2.2" on the other —
     * the tile was counting keyword slots); GPC credit knows a numeric ID and Google's own
     * 52 terminal two-level branches; condition (optional for new goods) and https (Google
     * accepts either) no longer score; product_detail — the attribute Google names beside
     * highlights as what AI surfaces read — joins Structured detail; description length
     * is scored against Google's stated 160–500 rather than a house 300.
     *
     * WHAT CHANGED, AND WHY (Ray, 16 Sep 2026: "label architecture that involves
     * custom labels is not necessarily usable for AI … include the most important
     * factor for AI readiness, probably the conversational attribute"):
     *
     *  - CUSTOM LABELS LEFT THE SCORE. Google's own spec for [custom_label_0-4]
     *    (answer 6324473) says they exist to "create specific filters to use in
     *    your Performance Max, Shopping, or Demand Gen campaigns … for reporting
     *    and bidding", and states plainly: "The information you include in this
     *    attribute won't be shown to customers." A field no surface ever reads
     *    cannot be evidence of readiness for those surfaces, so it no longer
     *    scores. The reading itself is not lost — Label Guard (/labels) is a whole
     *    module devoted to it, and audit() still returns `labels`.
     *  - CONVERSATIONAL ATTRIBUTES BECAME THE HEAVIEST PILLAR (×2.4). They are the
     *    only fields in the spec whose STATED purpose is AI comprehension: Google
     *    (answer 17085370) ships them so "customers discover information about your
     *    products across AI-driven surfaces, like AI Mode in Search". The weight is
     *    set so the rest of the model tops out at 79 — a feed carrying NONE of the
     *    attributes Google built for agentic surfaces cannot be called Agentic-ready.
     *  - The AI pillar stopped double-counting them: it now reads only the
     *    structured detail an agent can quote (highlights, product_type depth) and
     *    how much description there is to quote.
     * -------------------------------------------------------------------- */
    // Google's own edges (30 / 70 / 150), counted per title — the histogram keeps the house
    // MASK buckets for display, the score does not read them
    var lenScore = tl.n ? (META ? 100 * (tl.b[1] + tl.b[2] + 0.5 * tl.b[3]) / tl.n
      : 100 * (tl.full + 0.5 * tl.half) / tl.n) : 0;
    var maskScore = 0.25 * titles.mask.fit + 0.2 * titles.mask.material +
      0.2 * titles.mask.colour + 0.2 * titles.mask.use + 0.15 * titles.mask.brand;
    var hygiene = tl.n ? Math.max(0, 100 - 100 * tl.dup / tl.n - 100 * tl.caps / tl.n) : 0;
    // Meta: a ≤65-char title cannot carry all five MASK slots — length + hygiene matter more
    var sTitles = META ? (0.5 * lenScore + 0.3 * maskScore + 0.2 * hygiene)
      : (0.4 * lenScore + 0.4 * maskScore + 0.2 * hygiene);

    var covD = n ? 100 * de.filled / n : 0;
    var depthD = n ? 100 * de.credit / n : 0;     // mean length credit against Google's 160–500
    var uniqD = de.filled ? (100 - descDupPct) : 0;
    var sDesc = 0.5 * covD + 0.3 * depthD + 0.2 * uniqD;

    // Ray, 17 Sep 2026 (screenshot, YuMOVE/Pet Care): "make sure all scoring (AI readiness,
    // content quality) always refer back to the industry best practice that had been set" —
    // this pillar scored EVERY brand against the apparel five with no awareness of the SAME
    // industry profile goldenScore already consults. Mirrors goldenScore's own two rules
    // (labelguard.js): color/size/gender/age_group/item_group_id are ATTR_SPEC `cond` tier —
    // counted only when PRESENT, or when absent but industry-`expected` (an apparel-five gap
    // is real; a Pet Care feed carrying none of them is not incomplete, no waiving needed).
    // material/pattern are `rec` tier — always counted (the optimisation surface) UNLESS the
    // profile explicitly `waived` them (Pet Care waives pattern only; material still counts —
    // Ray's own default profile keeps it as a cross-industry opportunity). opts.expected /
    // opts.waived are plain attribute-key arrays — this engine stays industry-agnostic, the
    // caller (which already has profileFor()) decides what to expect or waive.
    var AW = { color: 1.2, size: 1.2, item_group_id: 1.2, material: 1, gender: 1, age_group: 1, pattern: 0.8 };
    var CONDW = { color: 1, size: 1, gender: 1, age_group: 1, item_group_id: 1 };
    var attrExpected = {}; (opts.expected || []).forEach(function (wk) { attrExpected[wk] = 1; });
    var attrWaived = {}; (opts.waived || []).forEach(function (wk) { attrWaived[wk] = 1; });
    function attrCounted(ak) { return CONDW[ak] ? (has(ak) || attrExpected[ak]) : !attrWaived[ak]; }
    var awSum = 0, awTot = 0;
    for (k in AW) { if (!attrCounted(k)) continue; awSum += AW[k] * apct(k); awTot += AW[k]; }
    var sAttrs = awTot ? awSum / awTot : 0;

    var sIdentity = n ? (100 / n) * (idOk + linkOk + brandOk + gmOk + priceOk + availOk) / 6 : 0;

    var gpcPart = n ? 100 * tx.gpcCredit / n : 0;   // mean per-product credit — missing counts 0
    var ptPart = n ? 100 * tx.ptCredit / n : 0;
    var sTax = 0.5 * gpcPart + 0.5 * ptPart;

    var addlPart = 100 * Math.min(media.addlAvg / 3, 1);
    var sMedia = 0.5 * media.imagePct + 0.5 * addlPart;

    var lbSum = 0;
    for (i = 0; i < labels.length; i++) {
      var mono = labels[i].pct >= 95 && labels[i].top.length === 1 &&
        Object.keys(lb[labels[i].key].freq).length === 1;
      lbSum += labels[i].pct * (mono ? 0.5 : 1);  // one value on every row = no segmentation
    }
    var sLabels = labels.length ? lbSum / labels.length : 0;

    // Google's six conversational attributes, scored on COVERAGE not mere presence —
    // question_and_answer on 3% of the catalogue is a pilot, not a capability. Two of the
    // six describe variants (item_group_title, variant_option), so a feed that carries no
    // variants at all is judged on the other four rather than marked down for fields that
    // cannot apply to it — the same "required in specific cases" logic as the spec itself.
    var hasVariants = apct('item_group_id') >= 5;
    var VARIANT_CONV = { item_group_title: 1, variant_option: 1 };
    var convKeys = [], convPresent = 0, convSum = 0;
    for (i = 0; i < CONV_ATTRS.length; i++) {
      if (!hasVariants && VARIANT_CONV[CONV_ATTRS[i]]) continue;
      convKeys.push(CONV_ATTRS[i]);
      convSum += Math.min(100, apct(CONV_ATTRS[i]));
      if (apct(CONV_ATTRS[i]) >= 5) convPresent++;
    }
    var convScore = convKeys.length ? convSum / convKeys.length : 0;
    var hlPart = 100 * Math.min(highlights.avg / 4, 1);   // Google recommends 4–6 per product
    var sAi = 0.4 * hlPart + 0.3 * details.pct + 0.3 * depthD;

    function idGaps() {
      var parts = [];
      if (P(gmOk) < 95) parts.push('gtin/mpn ' + P(gmOk) + '%');
      if (P(brandOk) < 95) parts.push('brand ' + P(brandOk) + '%');
      if (P(priceOk) < 95) parts.push('price ' + P(priceOk) + '%');
      if (P(availOk) < 95) parts.push('availability ' + P(availOk) + '%');
      if (P(idOk) < 95) parts.push('id ' + P(idOk) + '%');
      if (P(linkOk) < 95) parts.push('link ' + P(linkOk) + '%');
      return parts;
    }
    var weakAttrs = [];
    for (k in AW) if (attrCounted(k) && apct(k) < 60) weakAttrs.push(k + ' ' + apct(k) + '%');
    var weakestLabel = null;
    for (i = 0; i < labels.length; i++) if (!weakestLabel || labels[i].pct < weakestLabel.pct) weakestLabel = labels[i];

    // which of the six are actually live, named — "no conversational attributes" on its own
    // never told an AM which field to go and get
    var convLive = [], convGap = [];
    for (i = 0; i < convKeys.length; i++) {
      (apct(convKeys[i]) >= 5 ? convLive : convGap).push(convKeys[i].replace(/_/g, ' '));
    }
    var convSummary = convPresent === 0
      ? 'none of the ' + convKeys.length + ' Google built for AI surfaces'
      : convPresent + '/' + convKeys.length + ' live (' + convLive.join(', ') + ')' +
        (convGap.length ? '; missing ' + convGap.join(', ') : '');
    if (!hasVariants) convSummary += ' — no variants in this feed, so the variant pair is not counted';

    // `summary` = one line (the reconciliation band and the estate carry it); `reads` = the
    // live components behind the number, one per line, for the scoring pop-up — every
    // figure a reader could check against the content-quality rows or the feed itself
    var r1 = function (x) { return Math.round(x); };
    var pillars = [
      { key: 'conversational', label: 'Conversational attributes', score: clamp(convScore), weight: 2.4,
        summary: convSummary,
        reads: convKeys.map(function (ck) { return ck.replace(/_/g, ' ') + ' on ' + apct(ck) + '%'; })
          .concat(hasVariants ? [] : ['no item_group_id — variant pair not counted']) },
      { key: 'identity', label: 'Identity & trust', score: clamp(sIdentity), weight: 1.4,
        summary: idGaps().length ? 'gaps: ' + idGaps().join(', ') : 'id, link, brand, GTIN/MPN, price, availability all present',
        reads: ['id ' + P(idOk) + '%', 'link ' + P(linkOk) + '%', 'brand ' + P(brandOk) + '%',
          'gtin or mpn ' + P(gmOk) + '%', 'price ' + P(priceOk) + '%', 'availability ' + P(availOk) + '%',
          'condition ' + P(condOk) + '% — measured, not scored (optional for new goods)'] },
      { key: 'titles', label: 'Title anatomy', score: clamp(sTitles), weight: 1.6,
        summary: 'avg ' + titles.avg + ' chars — ' + (META ? 'Meta window is 25–65 (truncates ~65)' : 'Google reads the first 70, allows 150'),
        reads: [(META ? 'length 25–65 on ' + titledPct(tl.b[1] + tl.b[2]) + '%, 66–90 on ' + titledPct(tl.b[3]) + '%'
            : 'length 70–150 on ' + titledPct(tl.full) + '%, 30–69 on ' + titledPct(tl.half) + '%, over 150 on ' + titledPct(tl.over) + '%') +
            ' → ' + r1(lenScore),
          'MASK: fit ' + titles.mask.fit + '%, material ' + titles.mask.material + '%, colour ' + titles.mask.colour +
            '%, use ' + titles.mask.use + '%, brand ' + titles.mask.brand + '% → ' + r1(maskScore),
          'hygiene: ' + titledPct(tl.dup) + '% duplicated, ' + titledPct(tl.caps) + '% ALL CAPS → ' + r1(hygiene)] },
      { key: 'descriptions', label: 'Descriptions', score: clamp(sDesc), weight: 1.3,
        summary: descriptions.pct + '% coverage, avg ' + descriptions.avg + ' chars',
        reads: ['coverage ' + r1(covD) + '%', 'length credit vs Google’s 160–500: ' + r1(depthD) + ' (' + P(de.short) + '% under 160)',
          'uniqueness ' + r1(uniqD) + ' (' + descDupPct + '% of distinct copy shared across products)'] },
      { key: 'attributes', label: 'Attribute completeness', score: clamp(sAttrs), weight: 1.5,
        summary: weakAttrs.length ? weakAttrs.join(', ') + ', rest strong' : 'all core attributes strong',
        reads: Object.keys(AW).map(function (ak) {
          return ak + ' ' + (attrCounted(ak) ? apct(ak) + '% (×' + AW[ak] + ')' : (has(ak) ? apct(ak) + '% — waived by the profile' : 'not in feed — not expected by the profile'));
        }) },
      { key: 'taxonomy', label: 'Taxonomy depth', score: clamp(sTax), weight: 1.2,
        summary: 'GPC on ' + taxonomy.gpcPct + '%, avg ' + taxonomy.gpcDepthAvg + ' levels · product_type on ' + taxonomy.ptPct +
          '%, avg ' + taxonomy.ptDepthAvg + ' levels, 3+ on ' + taxonomy.ptDeepPct + '%',
        reads: ['google_product_category on ' + taxonomy.gpcPct + '%, averaging ' + taxonomy.gpcDepthAvg + ' levels; specific enough on ' +
            taxonomy.gpcSpecificPct + '% → ' + r1(gpcPart),
          'product_type (' + (PT_PRIMARY || 'none') + ') on ' + taxonomy.ptPct + '%, averaging ' + taxonomy.ptDepthAvg +
            ' levels; 3+ levels on ' + taxonomy.ptDeepPct + '% → ' + r1(ptPart),
          'type assignments incl. keyword slots: ' + taxonomy.ptSlotsAvg + ' per product — counted, not scored as depth'] },
      { key: 'media', label: 'Media richness', score: clamp(sMedia), weight: 1.0,
        summary: media.addlAvg >= 3 ? 'multi-angle imagery on most items'
          : 'avg ' + media.addlAvg + ' additional images per item',
        reads: ['image_link on ' + media.imagePct + '%', 'additional images avg ' + media.addlAvg + ' per product → ' + r1(addlPart) +
            ' (' + P(me.zero) + '% have none)', 'https on ' + media.httpsPct + '% of images — measured, not scored'] },
      { key: 'ai', label: 'Structured detail', score: clamp(sAi), weight: 1.2,
        summary: 'highlights avg ' + highlights.avg + ' per item, product_detail on ' + details.pct + '%, description length credit ' + r1(depthD),
        reads: ['product_highlight avg ' + highlights.avg + ' per product → ' + r1(hlPart) + ' (Google recommends 4–6)',
          'product_detail on ' + details.pct + '%' + (PD.length ? '' : ' — not in feed'),
          'description length credit vs 160–500: ' + r1(depthD)] }
    ];
    var wSum = 0, wTot = 0;
    for (i = 0; i < pillars.length; i++) { wSum += pillars[i].score * pillars[i].weight; wTot += pillars[i].weight; }
    var total = clamp(wTot ? wSum / wTot : 0);
    var tier = tierFor(total);

    /* ---- issues (rule table; counts scaled to the full feed) -------------- */
    var issues = [];
    var missD = n - de.filled;
    if (missD > 0) {
      issues.push({ sev: (missD / n > 0.2 ? 'crit' : 'warn'), code: 'desc-missing',
        title: fmtN(C(missD)) + ' products carry no description',
        detail: 'Empty descriptions give Shopping and agentic surfaces (AI Mode, ChatGPT Shopping) nothing to rank or reason over — these items lean on title alone.',
        count: C(missD) });
    }
    if (de.filled && de.short / de.filled > 0.25) {
      issues.push({ sev: 'warn', code: 'desc-thin',
        title: fmtN(C(de.short)) + ' descriptions under 160 characters',
        detail: 'Google asks for “the most important details in the first 160–500 characters” — a description shorter than that cannot carry them, and gives AI surfaces too little to answer from.',
        count: C(de.short) });
    }
    var outsideWin = META ? (tl.b[0] + tl.b[3] + tl.b[4]) : (tl.thin + tl.half + tl.over);
    var winShare = tl.n ? (META ? (tl.b[1] + tl.b[2]) : tl.full) / tl.n : 0;
    if (tl.n && winShare < 0.3) {
      issues.push(META
        ? { sev: 'warn', code: 'title-window',
          title: fmtN(C(outsideWin)) + ' titles outside the 25–65 character Meta window',
          detail: 'Meta truncates catalogue titles at ~65 characters in most placements — titles past the cut lose their tail; very short ones waste the slot entirely.',
          count: C(outsideWin) }
        : { sev: 'warn', code: 'title-window',
          title: fmtN(C(outsideWin)) + ' titles under 70 or over 150 characters',
          detail: 'Google allows 150 characters and says users notice about the first 70 — a title short of that carries less of the brand, material, fit, colour and use-case that matching reads; one past 150 is truncated.',
          count: C(outsideWin) });
    }
    if (tl.n && tl.dup / tl.n > 0.01) {
      issues.push({ sev: 'warn', code: 'title-dup',
        title: fmtN(C(tl.dup)) + ' duplicate titles',
        detail: 'Identical titles across SKUs blur variant matching and can suppress impressions on the duplicates.', count: C(tl.dup) });
    }
    if (tl.n && tl.caps / tl.n > 0.01) {
      issues.push({ sev: 'warn', code: 'title-caps',
        title: fmtN(C(tl.caps)) + ' ALL-CAPS titles',
        detail: 'ALL-CAPS titles violate Shopping editorial rules and risk disapproval.', count: C(tl.caps) });
    }
    if (has('pattern') && attrCounted('pattern') && apct('pattern') < 60) {
      issues.push({ sev: 'warn', code: 'attr-pattern',
        title: 'pattern missing on ' + fmtN(C(n - attrFill.pattern)) + ' products',
        detail: 'pattern is a visual attribute Google matches on for apparel — harvestable from product imagery.',
        count: C(n - attrFill.pattern) });
    }
    // http image links are NOT an issue: Google's image_link spec (answer 6324350) accepts
    // "http or https" — the reading stays on media.httpsPct for anyone who wants it
    if (convPresent === 0) {
      // the heaviest pillar at zero is the single biggest thing standing between this feed
      // and the top of the ladder, so it is stated as a gap, not an aside
      issues.push({ sev: 'crit', code: 'conv-missing',
        title: 'None of Google’s conversational attributes are in the feed',
        detail: convGap.join(', ') + ' are all absent. These are the only fields in the specification whose stated purpose is AI comprehension — Google ships them so “customers discover information about your products across AI-driven surfaces, like AI Mode in Search” — and they carry the heaviest weight in this score. They are optional, never affect product approval, and go in through a supplemental data source or the Merchant API.',
        count: C(n) });
    } else if (convGap.length) {
      issues.push({ sev: 'warn', code: 'conv-partial',
        title: convPresent + ' of ' + convKeys.length + ' conversational attributes live',
        detail: 'Missing: ' + convGap.join(', ') + '. Coverage is what scores, not presence — an attribute on a slice of the catalogue answers questions for that slice only.',
        count: C(n) });
    }
    if (has('mpn') && apct('mpn') < 5 && apct('gtin') >= 95) {
      issues.push({ sev: 'info', code: 'mpn-absent',
        title: 'MPN absent — GTIN carries identity',
        detail: 'mpn is 0% but gtin is ' + apct('gtin') + '%, so identifiers still resolve. No action needed.',
        count: C(n - (attrFill.mpn || 0)) });
    }
    if (weakestLabel && weakestLabel.pct < 30) {
      issues.push({ sev: 'info', code: 'label-gap',
        title: weakestLabel.key + ' populated on ' + weakestLabel.pct + '% of items',
        detail: 'A near-empty custom label is a free segmentation slot — campaign splits, margin bands or AI-test cohorts cost nothing to add via FeedHero rules.',
        count: C(n - lb[weakestLabel.key].n) });
    }
    if (n && me.zero / n > 0.02) {
      issues.push({ sev: 'info', code: 'img-zero',
        title: fmtN(C(me.zero)) + ' products have no additional images',
        detail: 'Single-image items lose multi-angle real estate in Shopping and give visual AI less to work from.',
        count: C(me.zero) });
    }
    if (pipeline.feedhero) {
      issues.push({ sev: 'info', code: 'pipeline-live',
        title: 'FeedHero optimisation pipeline live',
        detail: 'Working columns detected (' + fhCols.join(', ') + ') — optimised titles ship through the existing before/after pipeline, so rollouts need no new plumbing.',
        count: C(n) });
    }
    var sevRank = { crit: 0, warn: 1, info: 2 };
    issues.sort(function (a, b) { return sevRank[a.sev] - sevRank[b.sev]; });

    /* ---- recommendations (threshold rule table; impact 3→1) --------------- */
    var client = opts.client || '';
    var recs = [];
    var titleDetailFH = pipeline.feedhero
      ? ' FeedHero pipeline is live — stage rewrites in c:base_title → c:auto_optimised_title and A/B the before/after columns before rollout.'
      : '';
    if (tl.n && (winShare < 0.5 || (!META && maskScore < 60))) {
      recs.push(META
        ? { impact: 3, effort: 'M', service: 'Tachyon title rebuild', tachyon: true,
          title: 'Recompose ' + fmtN(C(outsideWin)) + ' titles for the ≤65-char Meta window',
          detail: 'Tachyon compresses titles to lead with the strongest hooks — brand or category + colour — inside Meta’s ~65-character truncation point, keeping every displayed word matchable.' + titleDetailFH,
          evidence: 'avg ' + titles.avg + ' chars · ' + titledPct(tl.b[3] + tl.b[4]) + '% past the 65-char cut · ' + titledPct(tl.b[0]) + '% under 25',
          brief: { client: client, task: 'Tachyon Meta title recompose — ' + fmtK(C(outsideWin)) + ' SKUs into the ≤65-char window', cat: 'title' } }
        : { impact: 3, effort: 'M', service: 'Tachyon title rebuild', tachyon: true,
          title: 'Rebuild ' + fmtN(C(outsideWin)) + ' titles into the 80–120 MASK window',
          detail: 'Tachyon regenerates titles to MASK structure — Brand + Material + Fit + Colour + Use-case — lifting matchable intent per impression.' + titleDetailFH,
          evidence: 'avg ' + titles.avg + ' chars · ' + titledPct(tl.thin + tl.half) + '% under 70 · fit in ' +
            titles.mask.fit + '% / use-case in ' + titles.mask.use + '% of titles',
          brief: { client: client, task: 'Tachyon title rebuild — ' + fmtK(C(outsideWin)) + ' SKUs into the MASK window', cat: 'title' } });
    }
    if (n && (covD < 80 || depthD < 60 || de.short / n > 0.3)) {
      var thin = C(missD + de.short);
      recs.push({ impact: 3, effort: 'M', service: 'Tachyon description enrichment', tachyon: true,
        title: 'Enrich ' + fmtN(thin) + ' missing or thin descriptions',
        detail: 'Tachyon drafts benefit-led, attribute-grounded copy per item group — filling the 160–500 characters Google says carry the important details, covering material, fit and occasion, deduplicated across product families.',
        evidence: descriptions.pct + '% coverage · avg ' + descriptions.avg + ' chars · length credit ' + r1(depthD) + '/100 vs Google’s 160–500',
        brief: { client: client, task: 'Tachyon description enrichment — ' + fmtK(thin) + ' SKUs', cat: 'data' } });
    }
    if (convPresent < convKeys.length) {
      recs.push({ impact: 3, effort: 'M', service: 'Conversational attributes supplemental feed', tachyon: true,
        title: 'Ship ' + (convGap.length === convKeys.length ? 'conversational attributes' : convGap.join(', ')) + ' via a supplemental feed',
        detail: 'Generate the missing attributes with Tachyon and submit them as a supplemental data source joined on id (or through the Merchant API). They are optional and never affect approval status, and they are the heaviest single input to this score — the one set of fields Google built for AI Mode and agentic surfaces.',
        evidence: convPresent + '/' + convKeys.length + ' live' + (convLive.length ? ' (' + convLive.join(', ') + ')' : '') +
          ' · conversational pillar ' + Math.round(convScore) + '/100' + (hasVariants ? '' : ' · no variants, so the variant pair is not counted'),
        brief: { client: client, task: 'Conversational attributes supplemental feed — ' + convPresent + '/' + convKeys.length + ' live today', cat: 'data' } });
    }
    if (has('pattern') && attrCounted('pattern') && apct('pattern') < 60) {
      recs.push({ impact: 2, effort: 'M', service: 'Tachyon visual attribute harvest', tachyon: true,
        title: 'Harvest pattern from imagery for ' + fmtN(C(n - attrFill.pattern)) + ' products',
        detail: 'Tachyon reads product imagery and returns the missing visual attributes (pattern first) as feed-ready values.',
        evidence: 'pattern ' + apct('pattern') + '% · colour ' + apct('color') + '% · material ' + apct('material') + '%',
        brief: { client: client, task: 'Tachyon visual attribute harvest — pattern back-fill on ' + fmtK(C(n - attrFill.pattern)) + ' SKUs', cat: 'data' } });
    }
    if (weakestLabel && weakestLabel.pct < 30) {
      recs.push({ impact: 2, effort: 'S', service: 'FeedHero rules & custom labels', tachyon: false,
        title: 'Activate ' + weakestLabel.key + ' segmentation',
        detail: 'Define a FeedHero rule set (margin band, price tier, seasonal or AI-test cohort) so campaigns can bid on the split — the slot is live but idle.',
        evidence: weakestLabel.key + ' ' + weakestLabel.pct + '%' +
          (labels.length ? ' · ' + labels.map(function (l) { return l.key.replace('custom_label_', 'CL') + ' ' + l.pct + '%'; }).join(' · ') : ''),
        brief: { client: client, task: 'FeedHero custom-label build — ' + weakestLabel.key + ' segmentation', cat: 'custom_label' } });
    }
    if ((PT_PRIMARY && taxonomy.ptDeepPct < 30) || (tx.gpc && taxonomy.gpcSpecificPct < 70)) {
      var shallowPt = C(n - tx.ptDeep);
      recs.push({ impact: 2, effort: 'M', service: 'GPC / product_type mapping', tachyon: false,
        title: 'Deepen the product_type path to 3+ levels on ' + fmtN(shallowPt) + ' products',
        detail: 'Google asks for every level of your own taxonomy in product_type (“Books > Non-Fiction > Sports > Baseball”) and for the most specific google_product_category possible — a shallow tree gives listing groups, PMAX and AI surfaces less to bind to. Keyword slots 2–10 are a separate lever and are not counted here.',
        evidence: 'product_type 3+ levels on ' + taxonomy.ptDeepPct + '% (avg ' + taxonomy.ptDepthAvg + ') · GPC specific on ' +
          taxonomy.gpcSpecificPct + '% (avg ' + taxonomy.gpcDepthAvg + ' levels)',
        brief: { client: client, task: 'product_type deepening — 3+ levels per SKU', cat: 'product_type' } });
    }
    if (n && HL.length && (highlights.avg < 2 || (!PD.length && details.pct === 0))) {
      recs.push({ impact: 2, effort: 'M', service: 'Tachyon structured detail', tachyon: true,
        title: (highlights.avg < 2 ? 'Generate product highlights' : 'Add product_detail') + ' for the AI surfaces',
        detail: 'Google shows product_highlight and product_detail “across AI-driven surfaces, like AI Mode” — 4–6 benefit highlights per product and section:attribute:value details (composition, care, dimensions) are what an agent quotes back. Tachyon drafts both from the description and imagery.',
        evidence: 'highlights avg ' + highlights.avg + ' per product · product_detail on ' + details.pct + '%',
        brief: { client: client, task: 'Structured detail — highlights + product_detail generation', cat: 'data' } });
    }
    if (n && (me.zero / n > 0.02 || media.addlAvg < 2)) {
      recs.push({ impact: 1, effort: 'S', service: 'Image cycling', tachyon: false,
        title: 'Cycle imagery for ' + fmtN(C(me.zero)) + ' products with no additional images',
        detail: 'FeedHero image cycling rotates alternate angles into image_link and back-fills additional_image_link slots.',
        evidence: fmtN(C(me.zero)) + ' products with 0 additional images · avg ' + media.addlAvg + ' per item',
        brief: { client: client, task: 'Image cycling — back-fill additional images on ' + fmtK(C(me.zero)) + ' SKUs', cat: 'image' } });
    }
    recs.sort(function (a, b) { return b.impact - a.impact; });

    /* ---- dissection theatre: 6 real products spanning worst → best -------- */
    var dissect = [], pool = titled.length ? titled : perRow;
    var picks = [], usedT = {};
    if (pool.length) {
      var want = Math.min(6, pool.length);
      for (i = 0; i < want; i++) {
        var pos = want === 1 ? 0 : Math.round(i * (pool.length - 1) / (want - 1));
        var p = pool[pos], step = 0, pk;
        while (p && usedT[p.t || ('#' + p.i)] && pos + step + 1 < pool.length) { step++; p = pool[pos + step]; }
        pk = p ? (p.t || ('#' + p.i)) : '';
        if (p && !usedT[pk]) { usedT[pk] = 1; picks.push(p); }
      }
    }
    for (i = 0; i < picks.length; i++) {
      var pr = picks[i], missing = [];
      if (!pr.desc) missing.push('description');
      else if (pr.desc < DESC_FLOOR) missing.push('description under 160 chars');
      if (has('pattern') && attrCounted('pattern') && !pr.pat) missing.push('pattern');
      if (pr.hl <= 1 && HL.length > 1) missing.push('highlights 2–10');
      if (!pr.mFit) missing.push('fit in title');
      if (!pr.mUse) missing.push('use-case in title');
      if (!pr.addl && ADDL.length) missing.push('additional images');
      if (PT_PRIMARY && pr.ptd < 3) missing.push('product_type 3+ levels');
      dissect.push({ id: pr.id, title: pr.t, len: pr.len, mask: pr.mask,
        missing: missing.slice(0, 4), desc: pr.desc, addl: pr.addl, highlights: pr.hl });
    }

    return {
      v: 1,
      client: client,
      sheetId: opts.sheetId || '',
      gid: opts.gid != null ? String(opts.gid) : '',
      fetchedAt: opts.fetchedAt || Date.now(),
      rowCount: rowCount,
      sampled: n,
      score: { total: total, tier: tier.tier, tierLabel: tier.tierLabel, pillars: pillars },
      attributes: attributes,
      titles: titles,
      descriptions: descriptions,
      media: media,
      highlights: highlights,
      details: details,
      labels: labels,
      // MEASURED, NOT SCORED. Custom labels are a bidding and reporting tool — Google's spec
      // says the values "won't be shown to customers" — so they carry no weight in an
      // AI-readiness score. The reading is still returned, and Label Guard owns the detail.
      labelArchitecture: { score: Math.round(sLabels), scored: false,
        why: 'custom labels are campaign filters for bidding and reporting — never shown to shoppers, never read by an AI surface',
        weakest: weakestLabel ? weakestLabel.key : null },
      conversational: { present: convPresent, of: convKeys.length, live: convLive, gap: convGap,
        hasVariants: hasVariants, score: Math.round(convScore) },
      taxonomy: taxonomy,
      pipeline: pipeline,
      issues: issues,
      recs: recs,
      dissect: dissect
    };
  }

  return { VERSION: VERSION, createParser: createParser, createXmlParser: createXmlParser, normKey: normKey, audit: audit,
    // the scoring basis the pop-ups render, and the shared reads the harness checks for
    // parity with labelguard.js (pathDepth verbatim, GPC_LEAF2 identical)
    BASIS: BASIS, pathDepth: pathDepth, GPC_LEAF2: Object.keys(GPC_LEAF2) };
}));
