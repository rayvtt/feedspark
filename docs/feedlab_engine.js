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

  var VERSION = '1.1.0';

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
   * is the header, then one row per <item>. The header is derived
   * from the FIRST item's child tags in document order; repeated
   * tags within an item (additional_image_link…) get (2), (3)…
   * suffixes so normKey lands on the same canonical names as the
   * sheet exports' |||N columns. Items are flat key→text by spec;
   * CDATA is unwrapped and entities decoded. Chunk-safe: an <item>
   * split anywhere across push() boundaries is buffered until its
   * </item> arrives; complete items are released from the buffer
   * immediately so memory stays bounded by one item, not the feed.
   * ================================================================ */
  function createXmlParser(onRow) {
    var buf = '', header = null, ix = null, done = false;
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
          header = fs.map(function (f) { return f[0]; });
          ix = {}; header.forEach(function (k, i) { ix[k] = i; });
          onRow(header.slice());
        }
        var row = header.map(function () { return ''; });
        for (var i = 0; i < fs.length; i++) if (fs[i][0] in ix) row[ix[fs[i][0]]] = fs[i][1];
        onRow(row);
      }
      if (!header && buf.length > 4194304) buf = buf.slice(-65536);   // no <item> in 4MB — not a feed; keep a tail, stay bounded
    }
    function end() { done = true; buf = ''; }
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
    return_policy_label: 'Return policy label',
    question_and_answer: 'Question & answer', document_link: 'Document link',
    related_product: 'Related product', item_group_title: 'Item group title',
    variant_option: 'Variant option', popularity_rank: 'Popularity rank'
  };
  var CORE_ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability',
    'price', 'sale_price', 'google_product_category', 'product_type', 'brand', 'gtin', 'mpn',
    'identifier_exists', 'condition', 'is_bundle', 'age_group', 'color', 'gender', 'material',
    'pattern', 'size', 'item_group_id', 'shipping', 'return_policy_label'];

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
    // slot lists present in header
    function slots(prefix, max) {
      var out = [];
      for (var s = 1; s <= max; s++) if (has(prefix + '(' + s + ')')) out.push(prefix + '(' + s + ')');
      return out;
    }
    var ADDL = slots('additional_image_link', 10);
    var HL = slots('product_highlight', 10);
    var PT = slots('product_type', 10);
    if (!PT.length && has('product_type')) PT = ['product_type']; // single-column feeds
    var LABELS5 = [];
    for (i = 0; i <= 4; i++) if (has('custom_label_' + i)) LABELS5.push('custom_label_' + i);

    // ---- single pass over sampled rows -------------------------------------
    var attrFill = {};                        // key -> filled count
    var measured = [];                        // attribute keys measured for coverage
    for (i = 0; i < CORE_ATTRS.length; i++) {
      k = CORE_ATTRS[i];
      if (k === 'product_type' ? PT.length : has(k)) measured.push(k);
    }
    for (i = 0; i < CONV_ATTRS.length; i++) measured.push(CONV_ATTRS[i]); // always shown (gap view)
    for (i = 0; i < measured.length; i++) attrFill[measured[i]] = 0;

    var tl = { n: 0, sum: 0, min: Infinity, max: 0, caps: 0, seen: {}, dup: 0,
      b: [0, 0, 0, 0, 0], mask: { brand: 0, material: 0, colour: 0, fit: 0, use: 0 } };
    var de = { filled: 0, chars: 0, short: 0, deep: 0, owner: {} };
    var me = { img: 0, https: 0, addlSum: 0, zero: 0 };
    var hlFill = [], hlSum = 0; for (i = 0; i < 10; i++) hlFill.push(0);
    var tx = { gpc: 0, gpcSegs: 0, ptAny: 0, ptSlotSum: 0, ptDeep: 0 };
    var lb = {}; for (i = 0; i < LABELS5.length; i++) lb[LABELS5[i]] = { n: 0, freq: {} };
    var idOk = 0, brandOk = 0, gmOk = 0, priceOk = 0, availOk = 0, condOk = 0;
    var perRow = [];                          // per-row digest for samples/dissect

    for (i = 0; i < n; i++) {
      var r = rows[i];

      // attribute coverage
      for (j = 0; j < measured.length; j++) {
        k = measured[j];
        var got = (k === 'product_type')
          ? (function (rr) { for (var s = 0; s < PT.length; s++) if (val(rr, PT[s])) return true; return false; })(r)
          : val(r, k) !== '';
        if (got) attrFill[k]++;
      }

      // identity
      var gtin = val(r, 'gtin'), mpn = val(r, 'mpn');
      if (val(r, 'id')) idOk++;
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
        if (len < 50) tl.b[0]++; else if (len < 80) tl.b[1]++; else if (len < 120) tl.b[2]++;
        else if (len <= 150) tl.b[3]++; else tl.b[4]++;
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
        de.filled++; de.chars += d.length;
        if (d.length < 300) de.short++; else de.deep++;
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

      // highlights
      var hlc = 0;
      for (j = 0; j < HL.length; j++) if (val(r, HL[j])) { hlFill[j]++; hlc++; }
      hlSum += hlc;

      // taxonomy: GPC depth = '>' path segments; product_type depth = how many
      // type assignments (slots) the item carries — deep = 3+ assignments
      var gpc = val(r, 'google_product_category');
      if (gpc) { tx.gpc++; tx.gpcSegs += gpc.split('>').length; }
      var ptc = 0;
      for (j = 0; j < PT.length; j++) if (val(r, PT[j])) ptc++;
      if (ptc) tx.ptAny++;
      tx.ptSlotSum += ptc; if (ptc >= 3) tx.ptDeep++;

      // labels
      for (j = 0; j < LABELS5.length; j++) {
        var lv = val(r, LABELS5[j]);
        if (lv) { var L = lb[LABELS5[j]]; L.n++; L.freq[lv] = (L.freq[lv] || 0) + 1; }
      }

      // per-row digest (samples + dissection theatre)
      var q = maskArr.length + (len >= 80 && len <= 150 ? 2 : (len >= 50 ? 1 : 0)) +
        (d ? (d.length >= 300 ? 2 : 1) : 0) + (addl >= 3 ? 1 : 0) + (hlc >= 3 ? 1 : 0);
      perRow.push({ i: i, t: t, len: len, mask: maskArr, q: q, desc: d ? d.length : 0,
        addl: addl, hl: hlc, pt: ptc, pat: val(r, 'pattern') !== '', mFit: t ? maskArr.indexOf('fit') >= 0 : false,
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
        { b: '<50', n: C(tl.b[0]) }, { b: '50–79', n: C(tl.b[1]) }, { b: '80–119', n: C(tl.b[2]) },
        { b: '120–150', n: C(tl.b[3]) }, { b: '>150', n: C(tl.b[4]) }],
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
      short: C(de.short),                         // filled but under the 300-char depth bar
      dupPct: descDupPct                          // % of distinct copy reused across item groups
    };

    var media = {
      imagePct: P(me.img),
      httpsPct: me.img ? Math.round(100 * me.https / me.img) : 0,
      addlAvg: n ? round1(me.addlSum / n) : 0,
      zeroAddl: C(me.zero)
    };

    var highlights = { depth: [], avg: n ? round1(hlSum / n) : 0 };
    for (i = 0; i < 10; i++) highlights.depth.push(P(hlFill[i]));

    var labels = [];
    for (i = 0; i < LABELS5.length; i++) {
      var Lk = LABELS5[i], L = lb[Lk], tops = [], fv;
      for (fv in L.freq) tops.push([fv, L.freq[fv]]);
      tops.sort(function (a, b) { return b[1] - a[1]; });
      labels.push({ key: Lk, pct: P(L.n), top: tops.slice(0, 3).map(function (x) { return x[0]; }) });
    }

    var taxonomy = {
      gpcPct: P(tx.gpc),
      gpcDepthAvg: tx.gpc ? round1(tx.gpcSegs / tx.gpc) : 0,
      ptDepthAvg: n ? round1(tx.ptSlotSum / n) : 0,
      ptDeepPct: P(tx.ptDeep)
    };

    var fhCols = [];
    for (i = 0; i < FEEDHERO_COLS.length; i++) if (has(FEEDHERO_COLS[i])) fhCols.push(FEEDHERO_COLS[i]);
    var pipeline = { feedhero: fhCols.length > 0, cols: fhCols };

    /* ---- pillar scores (0–100) — FeedSpark AI-Readiness ladder ------------
     * titles       = .40 length (full credit 80–150, half 50–79) + .40 MASK
     *                (fit .25, material .2, colour .2, use .2, brand .15) + .20 hygiene
     * descriptions = .5 coverage + .3 depth (share ≥300 chars) + .2 uniqueness
     * attributes   = weighted coverage (color/size/item_group ×1.2, material/
     *                gender/age_group ×1, pattern ×.8)
     * identity     = mean(id, brand, gtin|mpn, price, availability, condition)
     * taxonomy     = .5 GPC(coverage × min(depth/4,1)) + .5 product_type(coverage × deep≥3 share)
     * media        = .4 image + .4 min(addlAvg/3,1) + .2 https
     * labels       = mean coverage of labels 0–4, single-value-on-everything halved
     * ai           = .30 conversational + .25 desc depth + .20 structured richness
     *                + .15 identity + .10 MASK   — the headline gap pillar
     * -------------------------------------------------------------------- */
    var lenScore = tl.n ? 100 * (tl.b[2] + tl.b[3] + 0.5 * tl.b[1]) / tl.n : 0;
    var maskScore = 0.25 * titles.mask.fit + 0.2 * titles.mask.material +
      0.2 * titles.mask.colour + 0.2 * titles.mask.use + 0.15 * titles.mask.brand;
    var hygiene = tl.n ? Math.max(0, 100 - 100 * tl.dup / tl.n - 100 * tl.caps / tl.n) : 0;
    var sTitles = 0.4 * lenScore + 0.4 * maskScore + 0.2 * hygiene;

    var covD = n ? 100 * de.filled / n : 0;
    var depthD = n ? 100 * de.deep / n : 0;
    var uniqD = de.filled ? (100 - descDupPct) : 0;
    var sDesc = 0.5 * covD + 0.3 * depthD + 0.2 * uniqD;

    var AW = { color: 1.2, size: 1.2, item_group_id: 1.2, material: 1, gender: 1, age_group: 1, pattern: 0.8 };
    var awSum = 0, awTot = 0;
    for (k in AW) { awSum += AW[k] * apct(k); awTot += AW[k]; }
    var sAttrs = awTot ? awSum / awTot : 0;

    var sIdentity = n ? (100 / n) * (idOk + brandOk + gmOk + priceOk + availOk + condOk) / 6 : 0;

    var gpcPart = taxonomy.gpcPct * Math.min(taxonomy.gpcDepthAvg / 4, 1);
    var ptCov = n ? 100 * tx.ptAny / n : 0;
    var ptPart = (ptCov / 100) * taxonomy.ptDeepPct;
    var sTax = 0.5 * gpcPart + 0.5 * ptPart;

    var sMedia = 0.4 * media.imagePct + 0.4 * 100 * Math.min(media.addlAvg / 3, 1) + 0.2 * media.httpsPct;

    var lbSum = 0;
    for (i = 0; i < labels.length; i++) {
      var mono = labels[i].pct >= 95 && labels[i].top.length === 1 &&
        Object.keys(lb[labels[i].key].freq).length === 1;
      lbSum += labels[i].pct * (mono ? 0.5 : 1);  // one value on every row = no segmentation
    }
    var sLabels = labels.length ? lbSum / labels.length : 0;

    var convPresent = 0;
    for (i = 0; i < CONV_ATTRS.length; i++) if (apct(CONV_ATTRS[i]) >= 5) convPresent++;
    var hlBeyond2 = highlights.depth.length > 2 && highlights.depth[2] >= 25; // slot 3 in real use
    var convScore = 100 * (convPresent + (hlBeyond2 ? 1 : 0)) / (CONV_ATTRS.length + 1);
    var richScore = 50 * Math.min(highlights.avg / 4, 1) + 50 * Math.min(taxonomy.ptDepthAvg / 4, 1);
    var sAi = 0.30 * convScore + 0.25 * depthD + 0.20 * richScore + 0.15 * sIdentity + 0.10 * maskScore;

    function idGaps() {
      var parts = [];
      if (P(gmOk) < 95) parts.push('gtin/mpn ' + P(gmOk) + '%');
      if (P(brandOk) < 95) parts.push('brand ' + P(brandOk) + '%');
      if (P(priceOk) < 95) parts.push('price ' + P(priceOk) + '%');
      if (P(availOk) < 95) parts.push('availability ' + P(availOk) + '%');
      if (P(idOk) < 95) parts.push('id ' + P(idOk) + '%');
      if (P(condOk) < 95) parts.push('condition ' + P(condOk) + '%');
      return parts;
    }
    var weakAttrs = [];
    for (k in AW) if (apct(k) < 60) weakAttrs.push(k + ' ' + apct(k) + '%');
    var weakestLabel = null;
    for (i = 0; i < labels.length; i++) if (!weakestLabel || labels[i].pct < weakestLabel.pct) weakestLabel = labels[i];

    var pillars = [
      { key: 'identity', label: 'Identity & trust', score: clamp(sIdentity), weight: 1.2,
        summary: idGaps().length ? 'gaps: ' + idGaps().join(', ') : 'GTIN, brand, price, availability all present' },
      { key: 'titles', label: 'Title anatomy', score: clamp(sTitles), weight: 1.6,
        summary: 'avg ' + titles.avg + ' chars — MASK window is 80–120' },
      { key: 'descriptions', label: 'Descriptions', score: clamp(sDesc), weight: 1.3,
        summary: descriptions.pct + '% coverage, avg ' + descriptions.avg + ' chars' },
      { key: 'attributes', label: 'Attribute completeness', score: clamp(sAttrs), weight: 1.5,
        summary: weakAttrs.length ? weakAttrs.join(', ') + ', rest strong' : 'all core attributes strong' },
      { key: 'taxonomy', label: 'Taxonomy depth', score: clamp(sTax), weight: 1.0,
        summary: 'GPC ' + taxonomy.gpcPct + '%, product_type deep on ' + taxonomy.ptDeepPct + '%' },
      { key: 'media', label: 'Media richness', score: clamp(sMedia), weight: 1.0,
        summary: media.addlAvg >= 3 ? 'multi-angle imagery on most items'
          : 'avg ' + media.addlAvg + ' additional images per item' },
      { key: 'labels', label: 'Label architecture', score: clamp(sLabels), weight: 0.9,
        summary: weakestLabel && weakestLabel.pct < 15 ? weakestLabel.key.replace('custom_', '') + ' nearly unused'
          : (weakestLabel && weakestLabel.pct < 50 ? weakestLabel.key.replace('custom_', '') + ' underused'
            : 'labels 0–4 active') },
      { key: 'ai', label: 'Agentic readiness', score: clamp(sAi), weight: 1.5,
        summary: (convPresent === 0 ? 'no conversational attributes' : convPresent + '/6 conversational attributes')
          + (highlights.avg < 3 ? '; highlights shallow' : '; highlights deep') }
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
        title: fmtN(C(de.short)) + ' descriptions under 300 characters',
        detail: 'Thin copy caps relevance matching and gives AI surfaces too little to answer from — 300+ chars is the working floor for enriched descriptions.',
        count: C(de.short) });
    }
    var outsideWin = tl.b[0] + tl.b[1] + tl.b[4];
    if (tl.n && (tl.b[2] + tl.b[3]) / tl.n < 0.3) {
      issues.push({ sev: 'warn', code: 'title-window',
        title: fmtN(C(outsideWin)) + ' titles outside the 80–150 character window',
        detail: 'Short titles waste indexable slots — the MASK window (80–120 chars) carries brand, material, fit, colour and use-case into matching.',
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
    if (has('pattern') && apct('pattern') < 60) {
      issues.push({ sev: 'warn', code: 'attr-pattern',
        title: 'pattern missing on ' + fmtN(C(n - attrFill.pattern)) + ' products',
        detail: 'pattern is a visual attribute Google matches on for apparel — harvestable from product imagery.',
        count: C(n - attrFill.pattern) });
    }
    if (me.img && me.https < me.img) {
      issues.push({ sev: 'warn', code: 'img-http',
        title: fmtN(C(me.img - me.https)) + ' image links not HTTPS',
        detail: 'Non-HTTPS imagery risks fetch failures and disapprovals.', count: C(me.img - me.https) });
    }
    if (convPresent === 0) {
      issues.push({ sev: 'warn', code: 'conv-missing',
        title: 'No conversational attributes in the feed',
        detail: 'question_and_answer, document_link, related_product, item_group_title, variant_option and popularity_rank are absent — the 2026 differentiator set for conversational and agentic surfaces, submitted via a supplemental data source.',
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
    if (tl.n && ((tl.b[2] + tl.b[3]) / tl.n < 0.5 || maskScore < 60)) {
      recs.push({ impact: 3, effort: 'M', service: 'Tachyon title rebuild', tachyon: true,
        title: 'Rebuild ' + fmtN(C(outsideWin)) + ' titles into the 80–120 MASK window',
        detail: 'Tachyon regenerates titles to MASK structure — Brand + Material + Fit + Colour + Use-case — lifting matchable intent per impression.' + titleDetailFH,
        evidence: 'avg ' + titles.avg + ' chars · ' + titledPct(tl.b[0] + tl.b[1]) + '% under 80 · fit in ' +
          titles.mask.fit + '% / use-case in ' + titles.mask.use + '% of titles',
        brief: { client: client, task: 'Tachyon title rebuild — ' + fmtK(C(outsideWin)) + ' SKUs into the MASK window', cat: 'title' } });
    }
    if (n && (covD < 80 || descriptions.avg < 250 || de.deep / n < 0.3)) {
      var thin = C(missD + de.short);
      recs.push({ impact: 3, effort: 'M', service: 'Tachyon description enrichment', tachyon: true,
        title: 'Enrich ' + fmtN(thin) + ' missing or thin descriptions',
        detail: 'Tachyon drafts benefit-led, attribute-grounded copy per item group — 300+ chars covering material, fit and occasion, deduplicated across product families.',
        evidence: descriptions.pct + '% coverage · avg ' + descriptions.avg + ' chars vs 300+ target',
        brief: { client: client, task: 'Tachyon description enrichment — ' + fmtK(thin) + ' SKUs', cat: 'data' } });
    }
    if (convPresent < 3) {
      recs.push({ impact: 3, effort: 'M', service: 'Conversational attributes supplemental feed', tachyon: true,
        title: 'Ship conversational attributes via a supplemental feed',
        detail: 'Generate question_and_answer, item_group_title, variant_option and popularity_rank with Tachyon and submit as a supplemental data source — the 2026 conversational-surface differentiator.',
        evidence: convPresent + '/6 conversational attributes present · product_highlight avg ' + highlights.avg + ' per item',
        brief: { client: client, task: 'Conversational attributes supplemental feed — ' + convPresent + '/6 live today', cat: 'data' } });
    }
    if (has('pattern') && apct('pattern') < 60) {
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
    if (PT.length && (taxonomy.ptDeepPct < 30 || taxonomy.gpcDepthAvg < 3)) {
      recs.push({ impact: 2, effort: 'M', service: 'GPC / product_type mapping', tachyon: false,
        title: 'Deepen product_type to 3+ assignments on ' + fmtN(C(n - tx.ptDeep)) + ' products',
        detail: 'Extend the product_type set per item (category + collection + intent paths) so query mapping has more taxonomy to bind to; keep GPC as the fixed Google taxonomy.',
        evidence: 'product_type ≥3 assignments on ' + taxonomy.ptDeepPct + '% · GPC depth avg ' + taxonomy.gpcDepthAvg,
        brief: { client: client, task: 'product_type deepening — 3+ assignments per SKU', cat: 'product_type' } });
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
      else if (pr.desc < 300) missing.push('rich description (300+ chars)');
      if (has('pattern') && !pr.pat) missing.push('pattern');
      if (pr.hl <= 1 && HL.length > 1) missing.push('highlights 2–10');
      if (!pr.mFit) missing.push('fit in title');
      if (!pr.mUse) missing.push('use-case in title');
      if (!pr.addl && ADDL.length) missing.push('additional images');
      if (PT.length >= 3 && pr.pt < 3) missing.push('3+ product_type');
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
      labels: labels,
      taxonomy: taxonomy,
      pipeline: pipeline,
      issues: issues,
      recs: recs,
      dissect: dissect
    };
  }

  return { VERSION: VERSION, createParser: createParser, createXmlParser: createXmlParser, normKey: normKey, audit: audit };
}));
