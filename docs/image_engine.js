/* FeedSpark Image Library — media engine (docs/image_engine.js)
 * ------------------------------------------------------------------
 * UMD, dependency-free, browser + node. Served verbatim at /images/engine.js,
 * required by the 4x-daily xml-scan agent (tools/xml_scan.mjs) and unit-tested in
 * node (tools/test_images.mjs) — every lane runs this exact file.
 *
 * What it answers (Ray, 15 Sep 2026): "manage the client's images across image_link,
 * additional_image_link 1,2,3,4… up to 10, and find a way to tag / categorise them.
 * The problem is the brand can't define which images are flat-lay and which are
 * on-model / upper-body — we can use this module to AI tag or manual tag it."
 *
 * The lever: a retailer's image URLs already encode the shot type, they just never
 * say so. Within ONE product, every image shares a long common stem (the SKU, the
 * CDN path, the size suffix) and differs by a short fragment — Monsoon's 01_ vs 21_,
 * Schuh's m1 / m4 / m8, Reiss's trailing 2..5. Mask the stem and that fragment is a
 * SHOT TOKEN. Estate-wide the same handful of tokens repeat across every product, so
 * tagging ONE token (by eye or by one vision call) labels every image that carries it
 * — thousands of images per tag, at the cost of a sample.
 *
 * Where a feed has no such convention (Superdry's opaque upload<19-digit>.jpg) the
 * tokens are near-unique and the engine SAYS SO rather than inventing a taxonomy:
 * `learnable:false` sends the feed down the per-image tagging lane instead.
 *
 * API:
 *   Img.shotTokens(urls)        -> [token…] aligned with urls (one product's images)
 *   Img.imageCollector(meta)    -> { onRow, finish } on the Feed Lab parser contract
 *                                  (first onRow = header, then rows; XML header may
 *                                  grow mid-stream)
 *   Img.TAXONOMY                -> the default shot taxonomy (editable per client)
 *   Img.tagFor(tags, tok, slot) -> the tag that applies to an image, rule-first
 *   Img.coverageOf(cap, tags)   -> { imgs, tagged, pct, byTag } for a capture
 *   Img.VERSION
 *
 * Nothing is hardcoded per brand: a retailer the module has never seen yields its own
 * token vocabulary on the first scan.
 */
(function (root, factory) {
  var api = factory();
  try { root.FeedImages = api; } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof globalThis !== 'undefined' ? globalThis :
  (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var VERSION = '1.0.0';
  var MAX_SLOTS = 11;        // image_link + additional_image_link 1..10 (Ray: "it should have up to 10")
  var MAX_TOKENS = 60;       // distinct shot tokens tracked per feed
  var TOK_SAMPLES = 24;      // example images kept per token (the tagging strip + the AI sample)
  var MIN_SUPPORT = 0.005;   // a token on <0.5% of products is per-product noise, not a shot code
  var LEARN_COVER = 0.6;     // supported tokens must cover 60% of images for the feed to be learnable
  // No studio briefs twenty different shots. A vocabulary bigger than this is not a
  // convention someone can tag — it is the residue of opaque filenames that happen to
  // collide, and calling it learnable would send an AM off to name 50 meaningless codes.
  var LEARN_MAX_CODES = 20;

  /* ---- the default shot taxonomy ------------------------------------------------
   * The vocabulary brands actually brief their studios in. Editable per client on the
   * page (the tag STORE carries its own list); this is only the starting point, so a
   * homeware or pet-supplement client can rename the lot without touching the engine. */
  var TAXONOMY = [
    { id: 'packshot',  label: 'Packshot / flat-lay',   hint: 'Product alone on a plain background, laid flat or cut out' },
    { id: 'ghost',     label: 'Ghost mannequin',       hint: 'Garment holding its shape with no visible model' },
    { id: 'model-full',label: 'On model — full body',  hint: 'Model head to toe' },
    { id: 'model-up',  label: 'On model — upper body', hint: 'Crop from roughly the waist up' },
    { id: 'model-low', label: 'On model — lower body', hint: 'Crop from roughly the waist down, or feet' },
    { id: 'back',      label: 'Back view',             hint: 'The product photographed from behind' },
    { id: 'side',      label: 'Side / angle view',     hint: 'Three-quarter or profile angle' },
    { id: 'detail',    label: 'Detail / close-up',     hint: 'Fabric, stitching, hardware, sole, a logo' },
    { id: 'lifestyle', label: 'Lifestyle / in situ',   hint: 'The product in a real setting or in use' },
    { id: 'styled',    label: 'Styled / full outfit',  hint: 'Worn with other pieces, a styled group shot' },
    { id: 'swatch',    label: 'Swatch / colourway',    hint: 'A colour or material chip' },
    { id: 'infographic', label: 'Infographic / size guide', hint: 'Text, a size chart, ingredients, a benefits panel' },
    { id: 'other',     label: 'Other',                 hint: "Doesn't fit the list" },
  ];
  var TAX_IDS = {}; TAXONOMY.forEach(function (t) { TAX_IDS[t.id] = t.label; });

  /* ---- header handling (shared contract with the Feed Lab parser) ---------------- */
  function normKey(k) {
    return String(k == null ? '' : k).replace(/^﻿/, '').trim().toLowerCase()
      .replace(/\s+type=.*$/i, '').replace(/^[gc]:/, '').replace(/\s*\|\|\|\s*(\d+)$/, '($1)');
  }

  /* ---- URL → filename stem ------------------------------------------------------
   * Query strings carry cache-busters (?v=141025) and render params (&width=658) that
   * move independently of the shot, so the token is read from the PATH's last segment
   * with its extension stripped. */
  function fileStem(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    s = s.split('#')[0].split('?')[0];
    s = s.slice(s.lastIndexOf('/') + 1);
    return s.replace(/\.(jpe?g|png|webp|gif|avif|bmp|tiff?)$/i, '');
  }

  /* ---- longest common substring across a product's filenames --------------------
   * Bounded by design: a product has at most 11 images and a filename is short, so the
   * quadratic scan over the SHORTEST stem is a few hundred cheap indexOf calls. Runs
   * once per product on a streamed feed. */
  function commonStem(stems) {
    var i, j, L, cand, ok, shortest = stems[0];
    for (i = 1; i < stems.length; i++) if (stems[i].length < shortest.length) shortest = stems[i];
    if (shortest.length > 160) shortest = shortest.slice(0, 160);
    for (L = shortest.length; L >= 4; L--) {
      for (i = 0; i + L <= shortest.length; i++) {
        cand = shortest.slice(i, i + L); ok = true;
        for (j = 0; j < stems.length; j++) if (stems[j].indexOf(cand) < 0) { ok = false; break; }
        if (ok) return cand;
      }
    }
    return null;
  }

  /* The stem has to mean the same thing however many images a product happens to carry.
   * On a product with four images the stem lands on `_20001600003_` and the codes read
   * 01 / 21 / 02 / 03; on a product with only two — both ending `_1` — the longest common
   * substring greedily swallows a digit of the prefix too (`1_20001600003_1`), and the same
   * photograph would come back as `0` instead of `01`. One shot, two codes, purely because
   * of how deep that product's gallery is.
   * So when the stem CONTAINS a separator, it is trimmed back to separator boundaries: the
   * stem can then only ever start and end on a real segment edge, and the two products agree.
   * When it contains none (Schuh's 8341007080, Reiss's Y76182s, Superdry's hash) it is left
   * exactly as it is — trimming there has no boundary to find and would leak the SKU itself
   * into the code. */
  var SEP_RE = /[_\-.]/;
  function snapStem(c) {
    if (!SEP_RE.test(c)) return c;
    var a = c.search(SEP_RE), b = c.length - 1;
    while (b >= 0 && !SEP_RE.test(c.charAt(b))) b--;
    if (a < 0 || b < a) return c;
    var t = c.slice(a, b + 1);
    return t.length >= 2 ? t : c;     // never trim away the whole stem
  }

  // the fragment left once the shared stem is masked out, tidied to a stable key
  function residue(stem, common) {
    var i = stem.indexOf(common);
    if (i < 0) return stem;
    var r = stem.slice(0, i) + '|' + stem.slice(i + common.length);
    r = r.replace(/[_\-.\s]*\|[_\-.\s]*/g, '|').replace(/^[_\-.\s|]+|[_\-.\s|]+$/g, '');
    return r || '·';       // '·' = this image IS the stem (the primary shot, nothing added)
  }

  /* shotTokens(urls) — the shot token for each of ONE product's images, in feed order.
   * A single-image product has nothing to difference against, so it yields the primary
   * marker; a product whose filenames share no stem at all yields nulls (unreadable). */
  function shotTokens(urls) {
    var stems = [], i, out = [];
    for (i = 0; i < urls.length; i++) stems.push(fileStem(urls[i]));
    if (!stems.length) return [];
    if (stems.length === 1) return ['·'];
    var c = commonStem(stems);
    if (!c) { for (i = 0; i < stems.length; i++) out.push(null); return out; }
    c = snapStem(c);
    for (i = 0; i < stems.length; i++) out.push(residue(stems[i], c));
    return out;
  }

  // Monsoon's 01_20001600003_1 vs 01_20001600003_5 leave 01|1 and 01|5 — the same shot
  // code with a drifting image index. The HEAD alone usually collapses those into one
  // token; finish() keeps whichever grouping explains more of the feed with fewer codes.
  function headOf(tok) { return tok == null ? null : String(tok).split('|')[0] || '·'; }

  function hostOf(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || '')); return m ? m[1].toLowerCase() : '(no host)'; }

  /* ================================================================
   * The collector — one pass over the feed
   * ================================================================ */
  function imageCollector(meta) {
    meta = meta || {};
    var header = null, cols = null, rows = 0, withImg = 0, imgs = 0, prodTok = 0;
    var slotFill = [], depth = {}, hosts = {}, dupRows = 0, exts = {};
    var full = {}, head = {}, fullOrder = [], headOrder = [];

    function resolve() {
      var c = { id: -1, title: -1, link: -1, image: -1, group: -1, ptype: -1, addl: [] }, i, k, m, slot;
      var seen = {};
      for (i = 0; i < header.length; i++) {
        k = normKey(header[i]);
        if (k === 'id' && c.id < 0) c.id = i;
        else if (k === 'title' && c.title < 0) c.title = i;
        else if (k === 'link' && c.link < 0) c.link = i;
        else if (k === 'item_group_id' && c.group < 0) c.group = i;
        else if ((k === 'product_type' || k === 'product_type(1)') && c.ptype < 0) c.ptype = i;
        else if (k === 'image_link' && c.image < 0) c.image = i;
        else if ((m = /^additional_image_link(?:\((\d+)\))?$/.exec(k))) {
          slot = m[1] ? +m[1] : 1;
          if (slot >= 1 && slot <= 10 && !seen[slot]) { seen[slot] = 1; c.addl.push({ i: i, slot: slot }); }
        }
      }
      c.addl.sort(function (a, b) { return a.slot - b.slot; });
      cols = c;
    }

    // tracked PER GROUPING: the full-token bag routinely overflows on a feed whose head
    // vocabulary is small and clean (Monsoon has hundreds of full tokens and eleven heads),
    // and that overflow says nothing about the grouping the page actually uses.
    var over = { full: false, head: false };
    function bump(bag, order, tok, slot, row, url, which) {
      var t = bag[tok];
      if (!t) {
        if (order.length >= MAX_TOKENS) { over[which] = true; return; }
        t = bag[tok] = { tok: tok, n: 0, slots: {}, samples: [] };
        order.push(tok);
      }
      t.n++;
      t.slots[slot] = (t.slots[slot] || 0) + 1;
      if (t.samples.length < TOK_SAMPLES) {
        t.samples.push({
          id: cols.id >= 0 ? String(row[cols.id] == null ? '' : row[cols.id]).trim().slice(0, 80) : '',
          ti: cols.title >= 0 ? String(row[cols.title] == null ? '' : row[cols.title]).trim().slice(0, 140) : '',
          link: cols.link >= 0 ? String(row[cols.link] == null ? '' : row[cols.link]).trim().slice(0, 500) : '',
          pt: cols.ptype >= 0 ? String(row[cols.ptype] == null ? '' : row[cols.ptype]).trim().slice(0, 160) : '',
          url: String(url).trim().slice(0, 900), slot: slot });
      }
    }

    function onRow(r, liveHeader) {
      if (!header) { header = r; resolve(); return; }
      if (liveHeader && liveHeader.length !== header.length) { header = liveHeader.slice(); resolve(); }
      rows++;
      var urls = [], slots = [], i, v, m;
      if (cols.image >= 0) {
        v = String(r[cols.image] == null ? '' : r[cols.image]).trim();
        if (v) { urls.push(v); slots.push(0); }
      }
      for (i = 0; i < cols.addl.length; i++) {
        v = String(r[cols.addl[i].i] == null ? '' : r[cols.addl[i].i]).trim();
        if (v) { urls.push(v); slots.push(cols.addl[i].slot); }
      }
      if (!urls.length) return;
      withImg++;
      imgs += urls.length;
      depth[urls.length] = (depth[urls.length] || 0) + 1;
      var uniq = {}, dup = false;
      for (i = 0; i < urls.length; i++) {
        slotFill[slots[i]] = (slotFill[slots[i]] || 0) + 1;
        hosts[hostOf(urls[i])] = (hosts[hostOf(urls[i])] || 0) + 1;
        m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(urls[i].split('/').pop() || '');
        if (m) exts[m[1].toLowerCase()] = (exts[m[1].toLowerCase()] || 0) + 1;
        if (uniq[urls[i]]) dup = true; else uniq[urls[i]] = 1;
      }
      if (dup) dupRows++;
      var toks = shotTokens(urls);
      if (toks.length && toks[0] != null) prodTok++;
      for (i = 0; i < toks.length; i++) {
        if (toks[i] == null) continue;
        bump(full, fullOrder, toks[i], slots[i], r, urls[i], 'full');
        bump(head, headOrder, headOf(toks[i]), slots[i], r, urls[i], 'head');
      }
    }

    // how much of the image estate a grouping's WELL-SUPPORTED tokens explain
    function score(bag, order, prods, total) {
      var min = Math.max(2, Math.ceil(prods * MIN_SUPPORT)), kept = 0, n = 0, i, t;
      for (i = 0; i < order.length; i++) { t = bag[order[i]]; if (t.n >= min) { kept++; n += t.n; } }
      return { kept: kept, cover: total ? n / total : 0 };
    }

    function finish() {
      if (!header) throw new Error('fetch-fail: no rows parsed');
      var sf = score(full, fullOrder, prodTok, imgs), sh = score(head, headOrder, prodTok, imgs);
      // head grouping wins when it explains as much of the feed with fewer codes — the
      // point of a shot vocabulary is that a human can tag all of it in one sitting.
      var useHead = sh.cover >= sf.cover - 0.02 && sh.kept <= sf.kept;
      var bag = useHead ? head : full, order = useHead ? headOrder : fullOrder, sc = useHead ? sh : sf;
      var overflow = useHead ? over.head : over.full;
      var min = Math.max(2, Math.ceil(prodTok * MIN_SUPPORT));
      var list = order.map(function (k) { return bag[k]; })
        .sort(function (a, b) { return b.n - a.n; })
        .map(function (t) { return { tok: t.tok, n: t.n, slots: t.slots, weak: t.n < min, samples: t.samples }; });
      var slotList = [];
      for (var s = 0; s < MAX_SLOTS; s++) slotList.push(slotFill[s] || 0);
      return {
        v: 1, t: Date.now(), client: meta.client || '', market: meta.market || '',
        rows: rows, withImg: withImg, imgs: imgs, slots: slotList, dupRows: dupRows,
        depth: depth, hasImage: cols.image >= 0, addlSlots: cols.addl.length,
        hosts: Object.keys(hosts).map(function (h) { return [h, hosts[h]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5),
        exts: Object.keys(exts).map(function (e) { return [e, exts[e]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5),
        grouping: useHead ? 'head' : 'full', overflow: overflow,
        // overflow means the vocabulary ran past the cap, so the coverage figure is measured
        // against a truncated count — honest only as a floor, never as a verdict
        learnable: sc.cover >= LEARN_COVER && sc.kept > 0 && sc.kept <= LEARN_MAX_CODES && !overflow,
        tokCover: Math.round(sc.cover * 1000) / 1000, tokKept: sc.kept,
        tokens: list,
      };
    }
    return { onRow: onRow, finish: finish };
  }

  /* ================================================================
   * Tagging — a token rule labels every image that carries it
   * ================================================================ */
  // tags = { tok: {tag, by, t, note}, … } plus optional per-image overrides keyed
  // '<id>#<slot>'. Rule order: the image's own override, then its token's rule.
  function tagFor(tags, tok, slot, id) {
    if (!tags) return null;
    var ov = tags.img && id ? tags.img[id + '#' + slot] : null;
    if (ov && ov.tag) return { tag: ov.tag, by: ov.by || 'manual', src: 'image' };
    var r = tags.tok ? tags.tok[tok] : null;
    if (r && r.tag) return { tag: r.tag, by: r.by || 'manual', src: 'token' };
    return null;
  }

  function coverageOf(cap, tags) {
    var imgs = (cap && cap.imgs) || 0, tagged = 0, byTag = {};
    ((cap && cap.tokens) || []).forEach(function (t) {
      var r = tags && tags.tok ? tags.tok[t.tok] : null;
      if (r && r.tag) { tagged += t.n; byTag[r.tag] = (byTag[r.tag] || 0) + t.n; }
    });
    return { imgs: imgs, tagged: tagged, pct: imgs ? Math.round(tagged / imgs * 1000) / 10 : 0, byTag: byTag };
  }

  return { VERSION: VERSION, MAX_SLOTS: MAX_SLOTS, TOK_SAMPLES: TOK_SAMPLES, LEARN_MAX_CODES: LEARN_MAX_CODES, TAXONOMY: TAXONOMY, TAX_IDS: TAX_IDS,
    normKey: normKey, fileStem: fileStem, commonStem: commonStem, snapStem: snapStem, residue: residue, shotTokens: shotTokens,
    headOf: headOf, imageCollector: imageCollector, tagFor: tagFor, coverageOf: coverageOf };
}));
