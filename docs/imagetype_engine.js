/* FeedSpark Image Library — image TYPE engine (docs/imagetype_engine.js)
 * ------------------------------------------------------------------------------
 * UMD, dependency-free, browser + node. Served verbatim at /images/types.js and
 * unit-tested in node (tools/test_imagetypes.mjs) — the page and the harness run
 * this exact file.
 *
 * Ray, 15 Oct 2026: "Inside the image library module, can I rely on you to identify
 * the image type for every image field for each of our clients? Can you build an
 * engine?"
 *
 * The answer the engine is built to give is a MEASURED one, per client, per image
 * field — never a claim. Three things were read off the live estate on 15 Oct 2026
 * before a line of this was written (GB Google feeds, 2,675–4,045 products each,
 * 380 of their real images fetched and read through docs/pixel_engine.js), and two
 * of them killed lanes that would have been obvious to build:
 *
 *   1. THE FILENAME LANE IS REAL AND CHEAP, on four of five brands.
 *      Reiss 7 shot codes name 15,853 images · Schuh 6 → 14,608 · Monsoon 11 →
 *      11,856 · Accessorize 11 → 13,277, all at 100% of the images read. Superdry's
 *      filenames are sequential upload ids (upload9223368955666681843.jpg), which
 *      difference into 100+ near-unique fragments: image_engine already refuses them
 *      (`learnable:false`) and that refusal is correct.
 *
 *   2. THE IMAGE FIELD IS NOT THE GROUPING. "Slot 5 is always lifestyle" is false
 *      here: Monsoon's main field carries 9 different codes, Accessorize's 7, and the
 *      share of images sitting in a field where one code holds 90%+ is 0% on Monsoon,
 *      0% on Accessorize, 75% on Schuh. Where it IS clean (Reiss 100%) the code
 *      already names it, so the field adds nothing. On Superdry — the one feed that
 *      needs a free grouping — its two fields are pixel-identical (white background,
 *      fill ~99%, sharpness ~1,120 both). So there is NO slot lane. The field is
 *      something this engine REPORTS ON, not something it reasons from.
 *
 *   3. PIXELS DO NOT NAME A SHOT TYPE on this estate. Every brand shoots on a pale
 *      studio sweep, so the background reads `light` almost everywhere and fill sits
 *      at 98–100% across unrelated shot types; a plain background is as likely to be
 *      an on-model shot against a wall as a flat-lay. A pixel→type rule table would
 *      be invented confidence, so there is no pixel lane either.
 *
 * WHAT PIXELS ARE FOR, instead — and this is the engine's own contribution. A code's
 * tag rests on one assumption: that every image carrying that code is the same kind of
 * photograph. That assumption is TESTABLE. Read a sample of the code's own images and
 * compare their pixel signatures; where they disagree (Monsoon's `03` came back
 * light:5 / scene:3 / colour:2 with sharpness swinging 6×) the code is MIXED and its
 * single tag is not safe for all of it — the engine says so, names what disagrees, and
 * hands back the sample to look at. One tag over thousands of images is only worth
 * having if something checks it, and nothing did.
 *
 * So the ladder is short, and every verdict says which rung it came from:
 *   decided  — a person's own call on this image, or on its code. Certain.
 *   named    — the code's verdict (a model that looked at the code's own images),
 *              carrying that model's confidence and dropped where the audit says
 *              the code is mixed.
 *   shot     — a model read of THIS image (the only lane an unpatterned feed has).
 *   nothing  — unnamed, with the reason and what it would take. Never a guess.
 *
 * API:
 *   T.resolveType(ctx)            -> {tag, lane, conf, why} | {tag:null, why, need}
 *   T.sigOf(read)                 -> a coarse pixel signature for one image
 *   T.codeAudit(reads)            -> {state, n, why, split, worst}
 *   T.fieldReport(cap,tags,aud)   -> one row per image field: named, how, what
 *   T.clientReport(cap,tags,aud)  -> the feed's headline + the route to 100%
 *   T.namingPlan(cap,tags)        -> the decisions left, biggest first, with the cost
 *   T.gradeLanes(cap,tags)        -> where a person corrected the model: agreement
 *   T.estateRoll(feeds)           -> every client x market
 *
 * Ray, 11 Nov 2026, sending a row of jackets each with its own chip: "use maybe the
 * easiest model to identify each different type of image tag … product filter can be
 * grouped based on image URL / itemgroup id / item id"
 *
 *   T.photoKey(url)               -> the photograph a URL names, query and protocol off
 *   T.photoIndex(rows)            -> every distinct photograph, with the slots it fills
 *   T.photoTag(key,ctx)           -> the ladder, for one photograph
 *   T.photoReport(rows,ctx)       -> named, over the photographs rather than the slots
 *   T.groupRows(rows,by,tokOf)    -> the review, grouped by item / item group / shot code
 *   T.runEstimate(n,opts)         -> what naming n photographs would cost and take
 *   T.runCost(usage,model)        -> what one answer really cost, off its own token counts
 *   T.VERSION
 *
 * MEASURED 11 Nov 2026 on the live Superdry GB feed, which is why the unit of a tag is the
 * PHOTOGRAPH and not the product-slot: 26,862 SKUs carry 53,718 image slots filled by only
 * 13,315 DISTINCT photographs, 4.03 slots each, because every size variant of a style
 * repeats the same files; 187 of its 13,502 raw URLs differ only by their query; and its
 * item groups hold 2.06 photographs each. Its filenames carry no shot code, so it is both
 * the feed the code lane correctly refuses and the one that needs this lane.
 */
(function (root, factory) {
  var api = factory();
  try { root.FeedImageTypes = api; } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof globalThis !== 'undefined' ? globalThis :
  (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var VERSION = '1.1.0';

  /* ---- the lanes, in order. A verdict names its lane so a reader always knows what
   * it rests on; there is deliberately no lane resting on the image field or on the
   * pixels alone (see the header — both were measured and refused). */
  var LANES = [
    { id: 'decided', label: 'Decided by hand', rests: 'A person named this image, or its shot code.' },
    { id: 'named',   label: 'Named shot code', rests: 'A model looked at this code’s own images and named the shot.' },
    { id: 'shot',    label: 'Read on this image', rests: 'A model looked at this photograph itself.' },
  ];
  var LANE_RANK = { decided: 0, named: 1, shot: 2 };

  /* ---- pixel signature ----------------------------------------------------------
   * NOT a type — a shape. Its only job is to let a code's own images be compared with
   * one another, so `codeAudit` can tell a consistent code from a mixed one. The bands
   * are FeedSpark's own, chosen off the spread measured across the estate (fill sits at
   * 98–100 on most studio imagery, so the interesting cuts are low, not high).
   */
  var FILL_BANDS = [[40, 'sparse'], [80, 'loose'], [101, 'tight']];   // product span on a plain background
  var SHARP_BANDS = [[1200, 'calm'], [3000, 'busy'], [1e9, 'dense']]; // edge energy: a plate vs a crowded or text-heavy frame
  function band(v, bands) {
    if (v == null || !(v >= 0)) return '?';
    for (var i = 0; i < bands.length; i++) if (v < bands[i][0]) return bands[i][1];
    return bands[bands.length - 1][1];
  }
  // one image -> "<background>/<fill band>/<sharpness band>"; a scene has no measurable fill
  function sigOf(r) {
    if (!r || r.err) return null;
    var bg = String(r.bg || '?');
    return bg + '/' + (bg === 'scene' ? 'n-a' : band(r.fill, FILL_BANDS)) + '/' + band(r.sharp, SHARP_BANDS);
  }

  var AUDIT_MIN = 4;         // under four readings a code has not been audited, it has been glanced at
  var AUDIT_DOM = 0.75;      // one signature on three quarters of the sample = the code holds one kind of shot
  var AUDIT_BG = 0.8;        // and its background has to agree at least this often

  /* codeAudit(reads) — does this code really carry ONE kind of photograph?
   * reads: [{url, r}] — the pixel readings of a sample of the code's own images.
   * Never a type, never a tag: a state, what disagrees, and the split to look at. */
  function codeAudit(reads) {
    var rs = (reads || []).filter(function (x) { return x && x.r && !x.r.err; });
    var n = rs.length;
    if (n < AUDIT_MIN) {
      return { state: 'thin', n: n, why: n ? 'only ' + n + ' image' + (n === 1 ? '' : 's') + ' read — too few to tell whether the code holds one kind of shot'
        : 'none of this code’s images have been read yet', split: [], worst: null };
    }
    var sig = {}, bg = {}, i, s;
    for (i = 0; i < n; i++) {
      s = sigOf(rs[i].r); sig[s] = (sig[s] || 0) + 1;
      bg[rs[i].r.bg] = (bg[rs[i].r.bg] || 0) + 1;
    }
    var split = Object.keys(sig).map(function (k) { return { sig: k, n: sig[k], share: Math.round(sig[k] / n * 100) }; })
      .sort(function (a, b) { return b.n - a.n; });
    var bgs = Object.keys(bg).map(function (k) { return { bg: k, n: bg[k] }; }).sort(function (a, b) { return b.n - a.n; });
    var topSig = split[0].n / n, topBg = bgs[0].n / n;
    if (topSig >= AUDIT_DOM && topBg >= AUDIT_BG) {
      return { state: 'consistent', n: n, why: split[0].share + '% of the ' + n + ' images read look the same way (' + split[0].sig + ')',
        split: split, worst: null };
    }
    var why = topBg < AUDIT_BG
      ? 'the background disagrees — ' + bgs.map(function (b) { return b.n + ' ' + b.bg; }).join(', ')
      : 'the images read ' + split.length + ' different ways, the commonest on only ' + split[0].share + '%';
    return { state: 'mixed', n: n, why: why, split: split,
      worst: (rs.filter(function (x) { return sigOf(x.r) !== split[0].sig; })[0] || {}).url || null };
  }

  /* ---- resolveType — the one reader -------------------------------------------
   * ctx: { tags, tok, slot, id, audit }
   *   tags  — the client's tag store { tok:{<code>:{tag,by,conf,note}}, img:{'<id>#<slot>':{tag,by}} }
   *   tok   — this image's shot code (null on a feed with no readable convention)
   *   audit — the audit of THAT code, when one has been run
   * A mixed code is NOT silently applied: its verdict is handed back with the state so
   * the caller can show it as unsafe rather than counting it as named.
   */
  function resolveType(ctx) {
    ctx = ctx || {};
    var tags = ctx.tags || {}, tok = ctx.tok, slot = ctx.slot, id = ctx.id;
    var ov = tags.img && id != null ? tags.img[id + '#' + slot] : null;
    if (ov && ov.tag) return { tag: ov.tag, lane: 'decided', conf: 1, why: 'named on this image by ' + (ov.by === 'ai' ? 'a model read of it' : 'hand') };
    var r = tags.tok ? tags.tok[tok] : null;
    if (r && r.tag) {
      if (r.by === 'manual') return { tag: r.tag, lane: 'decided', conf: 1, why: 'shot code ' + tok + ' was named by hand' };
      var aud = ctx.audit || null;
      if (aud && aud.state === 'mixed') {
        return { tag: r.tag, lane: 'named', conf: Math.min(r.conf == null ? 0.6 : r.conf, 0.4), mixed: true,
          why: 'shot code ' + tok + ' is named ' + r.tag + ', but its own images disagree — ' + aud.why };
      }
      return { tag: r.tag, lane: 'named', conf: r.conf == null ? 0.6 : r.conf,
        why: 'shot code ' + tok + ' was read from a sample of its images' + (aud && aud.state === 'consistent' ? ', which agree with one another' : '') };
    }
    if (tok == null) return { tag: null, why: 'this feed’s filenames carry no readable shot code', need: 'image' };
    return { tag: null, why: 'shot code ' + tok + ' has not been named yet', need: 'code', tok: tok };
  }

  /* ---- the per-image lane, counted without double-counting ----------------------
   * An override is keyed '<id>#<slot>', so it is exactly one image in exactly one
   * field and can be counted per field with no second read of the feed. The trap is
   * adding it to a code's own count: on a patterned feed an override is usually a
   * CORRECTION of an image a named code already counted, and adding both would report more
   * named images than the field holds. So an override counts only where its image is
   * not already named through its code — exact on an unpatterned feed (no codes at
   * all, so every override is new), conservative on a patterned one. */
  function handCounts(cap, tags, audits) {
    var out = {}, t = (tags && tags.img) || {}, tokOf = {}, i, j, s, k, parts, slot;
    for (i = 0; i < ((cap && cap.tokens) || []).length; i++) {
      for (j = 0; j < (cap.tokens[i].samples || []).length; j++) {
        s = cap.tokens[i].samples[j];
        if (s && s.id) tokOf[s.id + '#' + s.slot] = cap.tokens[i].tok;
      }
    }
    var keys = Object.keys(t);
    for (k = 0; k < keys.length; k++) {
      if (!t[keys[k]] || !t[keys[k]].tag) continue;
      parts = String(keys[k]).split('#');
      slot = parts.length > 1 ? +parts[parts.length - 1] : 0;
      if (!(slot >= 0)) continue;
      var tok = tokOf[keys[k]];
      if (tok != null) {
        var v = resolveType({ tags: { tok: tags.tok }, tok: tok, slot: slot, audit: (audits || {})[tok] });
        if (v.tag && !v.mixed) continue;           // its code already counts this image
      }
      (out[slot] = out[slot] || { n: 0, byTag: {} });
      out[slot].n++;
      out[slot].byTag[t[keys[k]].tag] = (out[slot].byTag[t[keys[k]].tag] || 0) + 1;
    }
    return out;
  }

  /* ---- fieldReport — Ray's question, field by field -----------------------------
   * One row per image field the feed actually uses (image_link, then
   * additional_image_link 1..10): how many images it holds, how many are named, by
   * which lane, what they are named, and whether any code feeding it is mixed. */
  function fieldReport(cap, tags, audits) {
    if (!cap) return [];
    audits = audits || {};
    var hand = handCounts(cap, tags, audits);
    var rows = [], slots = cap.slots || [], s, i, t, codes, named, byTag, lanes, mixed, tot;
    // tokens carry their own slot histogram, so a field is answered without re-reading the feed
    for (s = 0; s < slots.length; s++) {
      tot = slots[s] || 0;
      if (!tot) continue;
      named = 0; byTag = {}; lanes = {}; mixed = 0; codes = [];
      for (i = 0; i < (cap.tokens || []).length; i++) {
        t = cap.tokens[i];
        var n = (t.slots && t.slots[s]) || 0;
        if (!n) continue;
        codes.push({ tok: t.tok, n: n });
        var v = resolveType({ tags: tags, tok: t.tok, slot: s, audit: audits[t.tok] });
        if (!v.tag) continue;
        if (v.mixed) { mixed += n; continue; }      // named, but not safely — not counted as named
        named += n;
        byTag[v.tag] = (byTag[v.tag] || 0) + n;
        lanes[v.lane] = (lanes[v.lane] || 0) + n;
      }
      // the per-image lane: an image read or named on its own, in this field
      var h = hand[s];
      if (h) {
        named += Math.min(h.n, Math.max(0, tot - named - mixed));
        lanes.decided = (lanes.decided || 0) + h.n;
        Object.keys(h.byTag).forEach(function (k) { byTag[k] = (byTag[k] || 0) + h.byTag[k]; });
      }
      rows.push({
        slot: s, field: s === 0 ? 'image_link' : 'additional_image_link' + (s > 1 ? ' ' + s : ' 1'),
        imgs: tot, named: named, pct: tot ? Math.round(named / tot * 1000) / 10 : 0,
        mixed: mixed, hand: h ? h.n : 0, codes: codes.sort(function (a, b) { return b.n - a.n; }),
        byTag: byTag, lanes: lanes,
        top: Object.keys(byTag).sort(function (a, b) { return byTag[b] - byTag[a]; })[0] || null,
      });
    }
    return rows;
  }

  /* ---- clientReport — the feed's headline, and the honest route to 100% --------- */
  function clientReport(cap, tags, audits) {
    if (!cap) return { scanned: false, why: 'this feed has not been scanned yet', route: 'scan' };
    audits = audits || {};
    var imgs = cap.imgs || 0, named = 0, mixed = 0, byLane = {}, byTag = {}, unnamed = [], i, t, v;
    for (i = 0; i < (cap.tokens || []).length; i++) {
      t = cap.tokens[i];
      v = resolveType({ tags: tags, tok: t.tok, audit: audits[t.tok] });
      if (!v.tag) { unnamed.push({ tok: t.tok, n: t.n, weak: !!t.weak }); continue; }
      if (v.mixed) { mixed += t.n; continue; }
      named += t.n;
      byLane[v.lane] = (byLane[v.lane] || 0) + t.n;
      byTag[v.tag] = (byTag[v.tag] || 0) + t.n;
    }
    var hand = handCounts(cap, tags, audits), handN = 0;
    Object.keys(hand).forEach(function (k) { handN += hand[k].n; });
    if (handN) {
      var room = Math.max(0, imgs - named - mixed);
      named += Math.min(handN, room);
      byLane.decided = (byLane.decided || 0) + handN;
      Object.keys(hand).forEach(function (k) {
        Object.keys(hand[k].byTag).forEach(function (g) { byTag[g] = (byTag[g] || 0) + hand[k].byTag[g]; });
      });
    }
    var audited = 0, consistent = 0, mixedCodes = 0;
    Object.keys(audits).forEach(function (k) {
      var a = audits[k]; if (!a || a.state === 'thin') return;
      audited++; if (a.state === 'consistent') consistent++; else mixedCodes++;
    });
    // the route is a fact about this feed, not a preference: a readable convention is
    // named code by code; a feed without one can only be named image by image, and the
    // cost of that is stated rather than hidden behind a button
    var route = cap.learnable ? 'codes' : 'per-image';
    return {
      scanned: true, imgs: imgs, named: named, mixed: mixed, hand: handN,
      pct: imgs ? Math.round(named / imgs * 1000) / 10 : 0,
      byLane: byLane, byTag: byTag,
      codes: (cap.tokens || []).length, unnamed: unnamed.sort(function (a, b) { return b.n - a.n; }),
      audited: audited, consistentCodes: consistent, mixedCodes: mixedCodes,
      route: route,
      why: route === 'codes'
        ? (cap.tokens || []).length + ' shot codes cover this feed — naming them names every image that carries them'
        : 'no readable shot code in these filenames, so nothing groups the images for free: each one has to be read on its own',
    };
  }

  /* ---- namingPlan — what is left, biggest first, and what it costs -------------- */
  function namingPlan(cap, tags, audits) {
    var rep = clientReport(cap, tags, audits);
    if (!rep.scanned) return { steps: [], left: 0, why: rep.why };
    var steps = [], left = 0;
    rep.unnamed.forEach(function (u) {
      left += u.n;
      steps.push({ kind: 'code', tok: u.tok, imgs: u.n, weak: u.weak,
        what: 'Name shot code ' + u.tok + ' — ' + u.n + ' image' });
    });
    (rep.mixed ? [1] : []).forEach(function () {
      steps.push({ kind: 'mixed', imgs: rep.mixed,
        what: 'Split the mixed codes — ' + rep.mixed + ' images carry a code whose own pictures disagree' });
    });
    if (rep.route === 'per-image' && rep.imgs > rep.named) {
      var per = rep.imgs - rep.named;   // what is left once the ones already read by hand are off
      steps.push({ kind: 'image', imgs: per,
        what: per + ' images with no code to group them — one model read each' });
    }
    return { steps: steps, left: left + rep.mixed, route: rep.route,
      why: steps.length ? null : 'every image on this feed is named' };
  }

  /* ---- gradeLanes — the reliability figure, measured on this client -------------
   * Where a PERSON has named an image whose code a model had already named, the two
   * answers can be compared. That is the only honest grade available: it accumulates
   * as AMs correct things, and it is reported with its own sample size so three
   * corrections never read as a verdict on the lane. */
  function gradeLanes(cap, tags) {
    var t = (tags && tags.img) || {}, keys = Object.keys(t), agree = 0, dis = 0, cases = [];
    var tokOf = {}, i, j, k, s;
    // which code does an image belong to? the capture's samples carry id+slot per code
    for (i = 0; i < ((cap && cap.tokens) || []).length; i++) {
      var tk = cap.tokens[i];
      for (j = 0; j < (tk.samples || []).length; j++) {
        s = tk.samples[j];
        if (s && s.id) tokOf[s.id + '#' + s.slot] = tk.tok;
      }
    }
    for (k = 0; k < keys.length; k++) {
      var ov = t[keys[k]]; if (!ov || !ov.tag) continue;
      var tok = tokOf[keys[k]]; if (tok == null) continue;
      var rule = tags.tok ? tags.tok[tok] : null;
      if (!rule || !rule.tag || rule.by !== 'ai') continue;   // only a model's answer can be graded
      if (rule.tag === ov.tag) agree++;
      else { dis++; if (cases.length < 8) cases.push({ img: keys[k], tok: tok, model: rule.tag, person: ov.tag }); }
    }
    var n = agree + dis;
    return { n: n, agree: agree, pct: n ? Math.round(agree / n * 1000) / 10 : null, cases: cases,
      why: !n ? 'nobody has corrected a model-named code on this client yet — there is nothing to grade it against'
        : n < 10 ? 'only ' + n + ' correction' + (n === 1 ? '' : 's') + ' to go on — a floor, not a verdict'
        : agree + ' of ' + n + ' model verdicts stood when a person looked' };
  }

  /* ---- estateRoll — every client x market ------------------------------------- */
  function estateRoll(feeds) {
    var out = (feeds || []).map(function (f) {
      var rep = clientReport(f.cap, f.tags, f.audits);
      return { client: f.client, mkt: f.mkt, kind: f.kind || null, scanned: rep.scanned,
        imgs: rep.imgs || 0, named: rep.named || 0, pct: rep.pct || 0, mixed: rep.mixed || 0,
        route: rep.route, codes: rep.codes || 0, mixedCodes: rep.mixedCodes || 0 };
    });
    var imgs = 0, named = 0, noRoute = 0;
    out.forEach(function (r) { imgs += r.imgs; named += r.named; if (r.scanned && r.route === 'per-image') noRoute++; });
    return { feeds: out.sort(function (a, b) { return b.imgs - a.imgs; }), imgs: imgs, named: named,
      pct: imgs ? Math.round(named / imgs * 1000) / 10 : 0, noRoute: noRoute,
      unscanned: out.filter(function (r) { return !r.scanned; }).length };
  }

  /* ================================================================
   * THE PHOTOGRAPH IS THE UNIT OF A TAG (Ray, 11 Nov 2026, sending a row of
   * jackets each with its own chip — "use maybe the easiest model to
   * identify each different type of image tag … product filter can be grouped
   * based on image URL / itemgroup id / item id")
   * ----------------------------------------------------------------
   * The code lane names a SHOT CODE and the hand lane names an '<id>#<slot>'. Neither
   * fits the feed in Ray's screenshot: its filenames carry no code, and '<id>#<slot>' is
   * the wrong unit — on the estate's largest feed (the figures are in this file's header)
   * 53,718 image slots are filled by 13,315 distinct photographs, so a tag per slot would
   * be four decisions where one will do.
   *
   * A photograph is one kind of shot wherever it appears, so the UNIT OF A READ
   * AND OF A TAG is the photograph: photoKey strips the query (?width=658,
   * &v=1 — a cache-buster and a render size move independently of the picture,
   * the same reasoning fileStem already applies to shot codes) and the protocol.
   * On that feed it also merges the URLs that differ only by their query.
   *
   * GROUPING IS A VIEW, NOT THE UNIT. Ray named three ways to group the review
   * and all three are over the same photographs: by item id (his screenshot's
   * rows), by item_group_id (one row per style) and by shot code where the feed
   * has one. Grouping never
   * changes what is read or what is stored; it changes what a person scrolls. */

  var PHOTO_GROUPINGS = [
    { id: 'item',  label: 'Item ID',       hint: 'one row per product, its own images — the feed as it ships' },
    { id: 'group', label: 'Item group ID', hint: 'one row per style, every photograph its variants share' },
    { id: 'photo', label: 'Image URL',     hint: 'one row per photograph — no repeats, the shortest way through a library' },
    { id: 'code',  label: 'Shot code',     hint: 'one row per shot code — only where the filenames carry one' }
  ];

  function photoKey(url) {
    if (url == null) return '';
    return String(url).replace(/&amp;/g, '&').split('#')[0].split('?')[0]
      .replace(/^https?:\/\//i, '').toLowerCase();
  }

  /* photoIndex — every distinct photograph in a set of product rows, with the slots
   * and products it fills. rows: [{id, ti, grp, urls:[], slots:[]}] (the shape the
   * page already keeps for its product search). */
  function photoIndex(rows) {
    var map = {}, order = [], i, j, r, k;
    for (i = 0; i < (rows || []).length; i++) {
      r = rows[i]; if (!r || !r.urls) continue;
      for (j = 0; j < r.urls.length; j++) {
        k = photoKey(r.urls[j]); if (!k) continue;
        if (!map[k]) { map[k] = { key: k, url: r.urls[j], slots: {}, ids: [], n: 0 }; order.push(k); }
        map[k].n++;
        map[k].slots[r.slots && r.slots[j] != null ? r.slots[j] : 0] = 1;
        if (map[k].ids.length < 8) map[k].ids.push(r.id);
      }
    }
    return { map: map, keys: order, photos: order.length,
      slots: order.reduce(function (a, k) { return a + map[k].n; }, 0) };
  }

  /* photoTag — the ladder, for one photograph. A hand tag on the photograph beats a
   * model read of it, which beats the shot code it belongs to; nothing names it and
   * the caller is told WHICH read would (`need`), never given a guess. */
  function photoTag(key, ctx) {
    ctx = ctx || {};
    var photos = ctx.photos || {}, p = photos[key];
    if (p && p.tag) {
      return p.by === 'ai'
        ? { tag: p.tag, lane: 'shot', conf: p.conf == null ? 0.6 : p.conf, note: p.note || '',
            why: 'a model looked at this photograph itself' }
        : { tag: p.tag, lane: 'decided', conf: 1, why: 'named on this photograph by hand' };
    }
    return resolveType(ctx);
  }

  /* photoReport — what is named, over the photographs rather than the slots, so the
   * count a person reads is the count of decisions still to make. */
  /* ONE reader for "how much of this library is named", so the card's head, its fold line
   * and the harness can never count it two ways. `idx` is optional: the page already holds
   * the index it just built, and rebuilding it per render on a 13,000-photograph feed is
   * work nobody asked for. */
  function photoReport(rows, ctx, idx) {
    ctx = ctx || {};
    idx = idx || photoIndex(rows);
    var i, k, v, named = 0, slotsNamed = 0, ai = 0, hand = 0, byLane = {}, byTag = {}, need = { code: 0, image: 0 };
    var tokOf = ctx.tokOf || {};
    for (i = 0; i < idx.keys.length; i++) {
      k = idx.keys[i];
      v = photoTag(k, { photos: ctx.photos, tags: ctx.tags, audits: ctx.audits, tok: tokOf[k] });
      if (v && v.tag && !v.mixed) {
        named++; slotsNamed += idx.map[k].n;
        byLane[v.lane] = (byLane[v.lane] || 0) + 1;
        byTag[v.tag] = (byTag[v.tag] || 0) + 1;
        if (v.lane === 'decided') hand++; else ai++;
      } else if (v && v.need) { need[v.need] = (need[v.need] || 0) + 1; }
    }
    return { photos: idx.photos, slots: idx.slots, named: named, slotsNamed: slotsNamed,
      ai: ai, hand: hand,
      left: idx.photos - named, perPhoto: idx.photos ? Math.round(idx.slots / idx.photos * 100) / 100 : 0,
      pct: idx.photos ? Math.round(named / idx.photos * 1000) / 10 : 0,
      byLane: byLane, byTag: byTag, need: need, index: idx };
  }

  /* groupRows — the review, grouped the way the reader asked for. Never changes a
   * tag or a count: a photograph a group repeats is listed once in that group. */
  function groupRows(rows, by, tokOf) {
    // by image URL: one row per photograph, which is the unit itself — the only grouping
    // that shows each decision exactly once, and the shortest way through a whole library
    if (by === 'photo') {
      var pi = photoIndex(rows);
      return pi.keys.map(function (k) {
        var e = pi.map[k], sl = Object.keys(e.slots).map(Number).sort(function (a, b) { return a - b; });
        return { key: k, label: e.ids[0] || k, rows: [],
          sub: e.n + ' image slot' + (e.n === 1 ? '' : 's') + (e.ids.length > 1 ? ' · ' + e.ids.length + ' products' : ''),
          photos: [{ key: k, url: e.url, slot: sl.length ? sl[0] : 0, id: e.ids[0] || '' }] };
      });
    }
    if (by === 'item' || !by) {
      return (rows || []).map(function (r) {
        return { key: r.id, label: r.ti || r.id, sub: r.id, rows: [r],
          photos: (r.urls || []).map(function (u, i) {
            return { key: photoKey(u), url: u, slot: r.slots ? r.slots[i] : i, id: r.id }; }) };
      });
    }
    var by_ = {}, order = [], i, j, r, k, g, pk, seen;
    for (i = 0; i < (rows || []).length; i++) {
      r = rows[i]; if (!r) continue;
      k = by === 'group' ? (r.grp || '') : '';
      if (by === 'code') k = '';
      if (by === 'group' && !k) k = '(no item group)';
      if (by === 'code') {
        // one row per shot code: a photograph joins the code its filename carries
        for (j = 0; j < (r.urls || []).length; j++) {
          pk = photoKey(r.urls[j]);
          var t = (tokOf || {})[pk]; var ck = t == null ? '(no shot code)' : String(t);
          if (!by_[ck]) { by_[ck] = { key: ck, label: ck === '(no shot code)' ? ck : 'Shot code ' + ck, sub: '', rows: [], photos: [], seen: {} }; order.push(ck); }
          if (by_[ck].seen[pk]) continue;
          by_[ck].seen[pk] = 1;
          by_[ck].photos.push({ key: pk, url: r.urls[j], slot: r.slots ? r.slots[j] : j, id: r.id });
        }
        continue;
      }
      if (!by_[k]) { by_[k] = { key: k, label: by === 'group' ? ('Item group ' + k) : k, sub: '', rows: [], photos: [], seen: {} }; order.push(k); }
      g = by_[k]; g.rows.push(r);
      for (j = 0; j < (r.urls || []).length; j++) {
        pk = photoKey(r.urls[j]); if (g.seen[pk]) continue;
        g.seen[pk] = 1;
        g.photos.push({ key: pk, url: r.urls[j], slot: r.slots ? r.slots[j] : j, id: r.id });
      }
    }
    return order.map(function (k) { var g = by_[k];
      if (by === 'group' && g.rows.length) g.sub = g.rows.length + ' variant' + (g.rows.length === 1 ? '' : 's') + ' · ' + (g.rows[0].ti || '');
      if (by === 'code') g.sub = g.photos.length + ' photograph' + (g.photos.length === 1 ? '' : 's');
      delete g.seen; return g; });
  }

  /* ---- what a run of the model costs, and how long the throttle makes it take ----
   * Stated BEFORE a run and measured during it: the page reads the real token counts
   * off each answer's `usage`, so the figure a person acts on is what was spent, not
   * this estimate. PRICE is per million tokens; CALL_LIMIT / CALL_WINDOW_MIN are the
   * worker's own money throttle on /api/claude, which decides the clock. */
  var AI_PRICE = { 'claude-haiku-5-5': { in: 0.10, out: 0.50 }, 'claude-opus-5': { in: 5, out: 25 } };
  var CALL_LIMIT = 120, CALL_WINDOW_MIN = 10;

  function runEstimate(photos, opts) {
    opts = opts || {};
    var batch = Math.max(1, opts.batch || 10),
        px = Math.max(1, opts.px || 658 * 779),           // the size the estate's feeds serve
        model = opts.model || 'claude-haiku-5-5',
        price = AI_PRICE[model] || AI_PRICE['claude-haiku-5-5'],
        perImg = Math.round(px / 750),                    // Anthropic's image-token rule
        calls = Math.ceil(photos / batch),
        inTok = calls * (opts.system || 380) + photos * (perImg + 10),
        outTok = photos * (opts.perTag || 35);
    return { photos: photos, calls: calls, batch: batch, model: model,
      inTok: inTok, outTok: outTok,
      usd: Math.round((inTok / 1e6 * price.in + outTok / 1e6 * price.out) * 100) / 100,
      minutes: Math.round(calls / CALL_LIMIT * CALL_WINDOW_MIN) };
  }

  function runCost(usage, model) {
    var price = AI_PRICE[model] || AI_PRICE['claude-haiku-5-5'], u = usage || {};
    return ((+u.input_tokens || 0) / 1e6 * price.in) + ((+u.output_tokens || 0) / 1e6 * price.out);
  }

  return { VERSION: VERSION, LANES: LANES, LANE_RANK: LANE_RANK,
    FILL_BANDS: FILL_BANDS, SHARP_BANDS: SHARP_BANDS, AUDIT_MIN: AUDIT_MIN, AUDIT_DOM: AUDIT_DOM, AUDIT_BG: AUDIT_BG,
    band: band, sigOf: sigOf, codeAudit: codeAudit, resolveType: resolveType, handCounts: handCounts,
    fieldReport: fieldReport, clientReport: clientReport, namingPlan: namingPlan,
    gradeLanes: gradeLanes, estateRoll: estateRoll,
    PHOTO_GROUPINGS: PHOTO_GROUPINGS, AI_PRICE: AI_PRICE, CALL_LIMIT: CALL_LIMIT, CALL_WINDOW_MIN: CALL_WINDOW_MIN,
    photoKey: photoKey, photoIndex: photoIndex, photoTag: photoTag, photoReport: photoReport,
    groupRows: groupRows, runEstimate: runEstimate, runCost: runCost };
}));
