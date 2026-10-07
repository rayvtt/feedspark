/* FeedPixels — what a product IMAGE actually shows, read off its pixels (Ray, 6 Oct 2026: "on Catalog -
 * scan and crawl the pixel for client's imagery as well").
 *
 * The feed says WHERE an image is; nothing in it says what the picture is like. The page fetches each image
 * through the worker's image route (same origin, so the pixels are readable), draws it small onto a canvas and
 * hands the RGBA array here. Everything below is arithmetic on that array — no model, no guess:
 *   - BACKGROUND: the frame's outer strip. Mostly one backdrop = plain (near-white = white; pale and unsaturated =
 *     light; otherwise a solid colour); transparent; no backdrop holding the frame = a scene (lifestyle / location).
 *   - FILL: on a plain background, how far the product spans the frame along its longer side (Google's best
 *     practice: not less than 75% nor more than 90% of the image). A scene has no measurable fill.
 *   - SHARPNESS: the variance of the Laplacian on the downscaled greyscale — a relative reading, compared across
 *     the images of one scan, never an absolute verdict on one picture.
 *   - FINGERPRINT: a 256-bit difference hash + the colour at the centre, so the same picture on several products (a placeholder, a
 *     "coming soon" tile, one shot reused across a range) is found however each copy was resized.
 * The image's own size, file size and format come from the file, not the canvas.
 * UMD: window.FeedPixels in the page, require() in node (tools/test_catalog.mjs runs it on synthetic arrays). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedPixels = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = 2;
  var SAMPLE = 256;            // the long side the page draws an image at before reading it
  // GOOGLE'S IMAGE REQUIREMENTS (Merchant Center, image_link): 100 x 100 px at least, 250 x 250 for apparel,
  // no more than 64 megapixels, no more than 16 MB; JPEG, WebP, PNG, GIF (not animated), BMP or TIFF.
  // FROM 31 JAN 2027 the minimum is 500 x 500 for EVERY product (answer 6324350: "new image size requirements
  // of at least 500 x 500 pixels for all products beginning January 31, 2027" — the page names no separate
  // apparel minimum). Until that date an image under it is a WARNING naming the date; from it, a fail.
  var REQ = { min: 100, minApparel: 250, min2027: 500, from2027: Date.UTC(2027, 0, 31), maxMp: 64, maxBytes: 16 * 1024 * 1024 };
  var FORMATS = { 'image/jpeg': 'JPEG', 'image/jpg': 'JPEG', 'image/pjpeg': 'JPEG', 'image/webp': 'WebP', 'image/png': 'PNG', 'image/gif': 'GIF',
    'image/bmp': 'BMP', 'image/x-ms-bmp': 'BMP', 'image/tiff': 'TIFF' };
  // FeedSpark's own working thresholds — labelled as ours wherever they are shown
  var HOUSE = { hiRes: 800, fillLo: 75, fillHi: 90, fillSmall: 50 };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function grey(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  function dist(a, b) { var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return Math.sqrt(dr * dr + dg * dg + db * db); }
  function median(arr) { if (!arr.length) return 0; var s = arr.slice().sort(function (a, b) { return a - b; }); return s[s.length >> 1]; }
  function hex2(n) { n = Math.round(clamp(n, 0, 255)); return (n < 16 ? '0' : '') + n.toString(16); }

  // ---- the frame's outer strip → what the picture stands on ------------------------------------------------
  // A studio backdrop is rarely ONE colour, and the product often runs off the frame: a pale wall fading into the
  // floor, a model cropped at the knee, a chair arm at the side. So the border is judged on what MOST of it is:
  // plain when a pale backdrop shows on 40%+ of it (any pale, unsaturated tone — the sweep, the floor) or one
  // colour holds 60%+ of it, and a scene only when no backdrop holds the frame. Pale means light and
  // barely coloured: white, grey, stone, ecru — Google's "white, grey or light-coloured background".
  function isPale(r, g, b) { var mx = Math.max(r, g, b), mn = Math.min(r, g, b); return (mx + mn) / 2 >= 180 && mx - mn <= 40; }
  function background(px, w, h) {
    var strip = Math.max(1, Math.round(Math.min(w, h) * 0.03)), R = [], G = [], B = [], cols = [], clear = 0, n = 0;
    function take(x, y) {
      var i = (y * w + x) * 4, a = px[i + 3]; n++;
      if (a < 250) clear++;
      if (a < 20) return;
      R.push(px[i]); G.push(px[i + 1]); B.push(px[i + 2]); cols.push([px[i], px[i + 1], px[i + 2]]);
    }
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (x < strip || y < strip || x >= w - strip || y >= h - strip) take(x, y);
    }
    if (n && clear / n > 0.5) return { kind: 'transparent', c: null, uniform: true, plain: true, strip: strip };
    var N = cols.length || 1, P = [[], [], []];
    cols.forEach(function (p) { if (isPale(p[0], p[1], p[2])) { P[0].push(p[0]); P[1].push(p[1]); P[2].push(p[2]); } });
    // a pale backdrop showing on 40%+ of the edge IS the backdrop, however much of the rest the product covers
    // (a seated model, a knee crop, a chair arm) — its colour is read off the pale pixels alone
    var paleBd = P[0].length / N >= 0.4;
    var c = paleBd ? [median(P[0]), median(P[1]), median(P[2])] : [median(R), median(G), median(B)], near = 0;
    cols.forEach(function (p) { if (dist(p, c) <= 26) near++; });
    var share = paleBd ? Math.max(near, P[0].length) / N : near / N;
    var uniform = cols.length > 0 && near / N >= 0.85, plain = cols.length > 0 && (paleBd || near / N >= 0.6), pale = paleBd || isPale(c[0], c[1], c[2]);
    var mn = Math.min(c[0], c[1], c[2]);
    var kind = !plain ? 'scene' : mn >= 243 ? 'white' : pale ? 'light' : 'colour';
    return { kind: kind, c: '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]), uniform: uniform, plain: plain, pale: pale, rgb: c, strip: strip, share: Math.round(share * 100) };
  }

  // ---- on a plain background: how far the product spans the frame -----------------------------------------
  function fill(px, w, h, bg) {
    if (!bg || !bg.plain) return null;
    var rows = new Array(h), colsN = new Array(w), x, y, i, k;
    for (y = 0; y < h; y++) rows[y] = 0;
    for (x = 0; x < w; x++) colsN[x] = 0;
    // a uniform border is one colour; a studio sweep changes down the frame, so each ROW is judged against its
    // own left and right edges (the wall at the top, the floor at the bottom)
    var sw = bg.strip || 1, rowBg = null;
    if (!bg.uniform && bg.kind !== 'transparent') {
      rowBg = new Array(h);
      for (y = 0; y < h; y++) {
        var sr = [], sg = [], sb = [];
        for (k = 0; k < sw; k++) [k, w - 1 - k].forEach(function (xx) { var j = (y * w + xx) * 4; if (bg.pale ? isPale(px[j], px[j + 1], px[j + 2]) : dist([px[j], px[j + 1], px[j + 2]], bg.rgb) <= 26) { sr.push(px[j]); sg.push(px[j + 1]); sb.push(px[j + 2]); } });
        // where the product itself reaches the side, that row's edge is not backdrop — use the frame's own colour
        rowBg[y] = sr.length ? [median(sr), median(sg), median(sb)] : bg.rgb;
      }
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = (y * w + x) * 4;
      var on = bg.kind === 'transparent' ? px[i + 3] > 24 : (px[i + 3] > 24 && dist([px[i], px[i + 1], px[i + 2]], rowBg ? rowBg[y] : bg.rgb) > 40);
      if (on) { rows[y]++; colsN[x]++; }
    }
    // a lone speck of dust or a JPEG halo is not the product: a row / column counts once it carries a real share
    var rMin = Math.max(1, Math.round(w * 0.006)), cMin = Math.max(1, Math.round(h * 0.006));
    var top = -1, bot = -1, lef = -1, rig = -1;
    for (y = 0; y < h; y++) if (rows[y] >= rMin) { if (top < 0) top = y; bot = y; }
    for (x = 0; x < w; x++) if (colsN[x] >= cMin) { if (lef < 0) lef = x; rig = x; }
    if (top < 0 || lef < 0) return { pct: 0, box: null, edges: 0 };
    var bw = (rig - lef + 1) / w, bh = (bot - top + 1) / h, m = Math.max(1, Math.round(Math.min(w, h) * 0.01));
    var edges = (top <= m ? 1 : 0) + (lef <= m ? 1 : 0) + (bot >= h - 1 - m ? 1 : 0) + (rig >= w - 1 - m ? 1 : 0);
    return { pct: Math.round(Math.max(bw, bh) * 100), area: Math.round(bw * bh * 100), box: [lef, top, rig, bot], edges: edges };
  }

  // ---- sharpness: the variance of the Laplacian on greyscale ------------------------------------------------
  function sharpness(px, w, h) {
    if (w < 3 || h < 3) return 0;
    var g = new Float32Array(w * h), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var i = (y * w + x) * 4; g[y * w + x] = grey(px[i], px[i + 1], px[i + 2]); }
    var sum = 0, sum2 = 0, k = 0;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      var c = y * w + x, l = g[c - 1] + g[c + 1] + g[c - w] + g[c + w] - 4 * g[c];
      sum += l; sum2 += l * l; k++;
    }
    if (!k) return 0;
    var mean = sum / k;
    return Math.round(sum2 / k - mean * mean);
  }

  // ---- a 256-bit difference hash: 17 x 16 greyscale, each cell against its right-hand neighbour ------------
  // 64 bits (9 x 8) was too coarse: on a studio catalogue every garment stands centred on the same pale sweep, so
  // two DIFFERENT dresses hashed within a few bits of each other. 16 rows read the silhouette, not just the layout.
  var HW = 17, HH = 16, HBITS = (HW - 1) * HH, TOL = 12, CC_TOL = 24;
  function dhash(px, w, h) {
    var cells = new Array(HW * HH), bits = '';
    for (var cy = 0; cy < HH; cy++) for (var cx = 0; cx < HW; cx++) {
      var x0 = Math.floor(cx * w / HW), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * w / HW)), y0 = Math.floor(cy * h / HH), y1 = Math.max(y0 + 1, Math.floor((cy + 1) * h / HH)), s = 0, n = 0;
      for (var y = y0; y < y1 && y < h; y++) for (var x = x0; x < x1 && x < w; x++) {
        var i = (y * w + x) * 4, a = px[i + 3] / 255;
        s += grey(px[i], px[i + 1], px[i + 2]) * a + 255 * (1 - a); n++;
      }
      cells[cy * HW + cx] = n ? s / n : 255;
    }
    for (var r = 0; r < HH; r++) for (var q = 0; q < HW - 1; q++) bits += cells[r * HW + q] > cells[r * HW + q + 1] ? '1' : '0';
    var hex = '';
    for (var b = 0; b < HBITS; b += 4) hex += parseInt(bits.slice(b, b + 4), 2).toString(16);
    return hex;
  }
  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return HBITS;
    var d = 0;
    for (var i = 0; i < a.length; i++) { var x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
    return d;
  }
  // ---- the colour at the middle of the frame (where the product is) — the second half of "the same picture":
  // the same dress in black and in ivory hashes alike in grey, and is not the same picture
  function centreColour(px, w, h) {
    var x0 = Math.floor(w * 0.25), x1 = Math.ceil(w * 0.75), y0 = Math.floor(h * 0.25), y1 = Math.ceil(h * 0.75), r = 0, g = 0, b = 0, n = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var i = (y * w + x) * 4; if (px[i + 3] < 20) continue; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    return n ? '#' + hex2(r / n) + hex2(g / n) + hex2(b / n) : '';
  }
  function rgbOf(h) { return /^#[0-9a-f]{6}$/i.test(h || '') ? [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] : null; }

  // ---- one image: the drawn pixels + what the file says about itself -----------------------------------------
  // px: RGBA of the image drawn at sw x sh (long side ≤ SAMPLE); meta: { w, h } natural size, bytes, type, ms
  function analyse(px, sw, sh, meta) {
    meta = meta || {};
    var bg = background(px, sw, sh), f = fill(px, sw, sh, bg);
    return { v: VERSION, w: meta.w || sw, h: meta.h || sh, bytes: meta.bytes || 0, fmt: FORMATS[String(meta.type || '').toLowerCase().split(';')[0].trim()] || (meta.type ? String(meta.type).split(';')[0].replace(/^image\//, '').toUpperCase() : ''),
      bg: bg.kind, bgc: bg.c, bgs: bg.share == null ? null : bg.share, fill: f ? f.pct : null, area: f ? f.area : null, edges: f ? f.edges : null,
      sharp: sharpness(px, sw, sh), hash: dhash(px, sw, sh), cc: centreColour(px, sw, sh) };
  }

  // ---- what an image reading means against Google's spec + FeedSpark's working thresholds ------------------
  // returns [{k, sev:'fail'|'warn'|'info', src:'google'|'feedspark', t}] — sev 'fail' only where Google STATES a requirement
  function checks(r, o) {
    o = o || {};
    var out = [];
    if (!r || r.err) return out;
    var now = o.now != null ? +o.now : Date.now(), y27 = now >= REQ.from2027;
    var min = y27 ? REQ.min2027 : (o.apparel ? REQ.minApparel : REQ.min);
    if (r.w < min || r.h < min) out.push({ k: 'small', sev: 'fail', src: 'google', t: r.w + ' × ' + r.h + ' px is under Google\'s minimum of ' + min + ' × ' + min + (o.apparel && !y27 ? ' for apparel' : '') });
    else if (!y27 && (r.w < REQ.min2027 || r.h < REQ.min2027)) out.push({ k: 'small27', sev: 'warn', src: 'google', t: r.w + ' × ' + r.h + ' px — Google\'s minimum rises to ' + REQ.min2027 + ' × ' + REQ.min2027 + ' for every product on 31 Jan 2027; under it the image will not be shown' });
    if (r.w * r.h > REQ.maxMp * 1e6) out.push({ k: 'huge', sev: 'fail', src: 'google', t: 'over Google\'s 64-megapixel limit' });
    if (r.bytes > REQ.maxBytes) out.push({ k: 'heavy', sev: 'fail', src: 'google', t: 'over Google\'s 16 MB file limit' });
    if (r.fmt && ['JPEG', 'WebP', 'PNG', 'GIF', 'BMP', 'TIFF'].indexOf(r.fmt) < 0) out.push({ k: 'format', sev: 'fail', src: 'google', t: r.fmt + ' is not a format Google accepts (JPEG, WebP, PNG, GIF, BMP, TIFF)' });
    if (!(r.w < min || r.h < min) && Math.max(r.w, r.h) < HOUSE.hiRes) out.push({ k: 'lowres', sev: 'warn', src: 'feedspark', t: 'under ' + HOUSE.hiRes + ' px on its long side — too small to zoom on' });
    if (r.bg === 'scene') out.push({ k: 'scene', sev: 'info', src: 'google', t: 'a scene, not a plain background — Google asks for a plain white, grey or light background on the main image' });
    else if (r.bg === 'colour') out.push({ k: 'colour', sev: 'warn', src: 'google', t: 'a coloured background (' + (r.bgc || '') + ') — Google asks for white, grey or light' });
    if (r.fill != null && r.bg !== 'scene') {
      if (r.fill < HOUSE.fillSmall) out.push({ k: 'tiny', sev: 'warn', src: 'google', t: 'the product spans ' + r.fill + '% of the frame — Google suggests 75–90%' });
      else if (r.fill < HOUSE.fillLo) out.push({ k: 'loose', sev: 'info', src: 'google', t: 'the product spans ' + r.fill + '% of the frame — Google suggests 75–90%' });
      if (r.edges >= 3 && r.fill >= 99) out.push({ k: 'edge', sev: 'info', src: 'google', t: 'the product runs to the frame on ' + r.edges + ' sides — it may be cropped' });
    }
    if (o.soft) out.push({ k: 'soft', sev: 'warn', src: 'feedspark', t: 'among the softest images in this scan — check it is in focus' });
    if (o.shared) out.push({ k: 'shared', sev: 'warn', src: 'google', t: 'the same picture is on ' + o.shared + ' different products — a placeholder or a reused shot' });
    return out;
  }

  // ---- across a scan: the softest images (relative, never absolute) and pictures shared by several products --
  // recs: [{id, grp, r}] — grp = item group (variants of one product sharing a shot is expected, not a finding)
  function scanFindings(recs, o) {
    o = o || {};
    var ok = recs.filter(function (x) { return x && x.r && !x.r.err; }), out = { soft: {}, shared: {}, groups: [] };
    // SOFT: the bottom 5% by sharpness, and only where that reading sits well under the scan's median — a
    // catalogue of soft-focus fashion photography is not "blurry" image by image
    var sv = ok.map(function (x) { return x.r.sharp; }).sort(function (a, b) { return a - b; });
    if (sv.length >= 20) {
      var cut = sv[Math.floor(sv.length * 0.05)], med = sv[sv.length >> 1];
      ok.forEach(function (x) { if (x.r.sharp <= cut && x.r.sharp < med * 0.25) out.soft[x.id] = 1; });
    }
    // SHARED: pictures within TOL bits of each other AND the same colour at the centre, across DIFFERENT item
    // groups (variants of one product sharing a shot is expected). Compared on the UNIQUE fingerprints, not every
    // product pair, so a big scan stays quick.
    var tol = o.tol == null ? TOL : o.tol, byHash = {}, uniq = [];
    ok.forEach(function (x) { var hh = x.r.hash + '|' + (x.r.cc || ''); if (!byHash[hh]) { byHash[hh] = []; uniq.push(hh); } byHash[hh].push(x); });
    function close(p, q) {
      var a = p.split('|'), b = q.split('|');
      if (hamming(a[0], b[0]) > tol) return false;
      var ca = rgbOf(a[1]), cb = rgbOf(b[1]);
      return !ca || !cb || dist(ca, cb) <= CC_TOL;
    }
    var seen = {};
    for (var i = 0; i < uniq.length; i++) {
      if (seen[uniq[i]]) continue;
      var cl = [uniq[i]];
      for (var j = i + 1; j < uniq.length; j++) if (!seen[uniq[j]] && close(uniq[i], uniq[j])) cl.push(uniq[j]);
      var members = [], grps = {};
      cl.forEach(function (hh) { byHash[hh].forEach(function (x) { members.push(x); grps[x.grp || ('#' + x.id)] = 1; }); });
      var ng = Object.keys(grps).length;
      if (ng >= 3) {
        cl.forEach(function (hh) { seen[hh] = 1; });
        members.forEach(function (x) { out.shared[x.id] = ng; });
        out.groups.push({ hash: uniq[i].split('|')[0], n: members.length, groups: ng, ids: members.slice(0, 8).map(function (x) { return x.id; }) });
      }
    }
    out.groups.sort(function (a, b) { return b.groups - a.groups; });
    return out;
  }

  // the long side the page should draw at, and the size that gives
  function sampleSize(w, h) { var s = Math.min(1, SAMPLE / Math.max(w || 1, h || 1)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; }

  // a reading packed for the store (one array per image URL) and back
  function pack(r) { return r && !r.err ? [r.w, r.h, r.bytes, r.fmt, r.bg, r.bgc || '', r.fill == null ? -1 : r.fill, r.edges == null ? -1 : r.edges, r.sharp, r.hash, r.area == null ? -1 : r.area, r.cc || ''] : [0, 0, 0, '', 'err', String((r && r.err) || '').slice(0, 80)]; }
  function unpack(a) {
    if (!Array.isArray(a)) return null;
    if (a[4] === 'err') return { err: a[5] || 'could not be read' };
    return { v: VERSION, w: +a[0] || 0, h: +a[1] || 0, bytes: +a[2] || 0, fmt: String(a[3] || ''), bg: String(a[4] || ''), bgc: String(a[5] || '') || null,
      fill: a[6] < 0 ? null : +a[6], edges: a[7] < 0 ? null : +a[7], sharp: +a[8] || 0, hash: String(a[9] || ''), area: a[10] == null || a[10] < 0 ? null : +a[10], cc: String(a[11] || '') };
  }

  return { VERSION: VERSION, SAMPLE: SAMPLE, REQ: REQ, HOUSE: HOUSE, FORMATS: FORMATS,
    background: background, fill: fill, sharpness: sharpness, dhash: dhash, hamming: hamming, centreColour: centreColour, HBITS: HBITS, TOL: TOL,
    analyse: analyse, checks: checks, scanFindings: scanFindings, sampleSize: sampleSize, pack: pack, unpack: unpack };
}));
