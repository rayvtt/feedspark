/* FeedBreakdown — the Field Breakdown module's browser engine (Ray, 15 Oct 2026: "build another module that similar
 * to custom label and PT — basically having the ability to breakdown in pivot table like this for any fields is super
 * helpful … a custom 'breakdown' fields module to breakdown in pivot with any fields in any feeds"). UMD: the page
 * loads it at /breakdown/engine.js, tools/test_breakdown.mjs requires it in node, tools/breakdown_stub.js hands it to
 * the browser tripwires. Pure functions, no DOM, no fetch.
 *
 * WHAT IT HOLDS: one feed, streamed once in the browser, kept COLUMN BY COLUMN — every column a dictionary of the
 * distinct values it carries and one small integer per product pointing into it. A 25,000-product feed of 150 columns
 * is ~15 MB this way, and every breakdown after the read is arithmetic over integers, never another fetch.
 *
 * WHAT IT ANSWERS: for ANY field of ANY feed — Label Guard's value · SKUs · share table, which until now existed only
 * for custom_label_0..4 and the primary product_type — plus a cross-tab of any two fields, read on the products a
 * person has filtered to. Four rules, because these tables go in front of clients:
 *   · a blank is a VALUE, "(blank)", counted and shown — a field 40% empty is a finding, never a smaller table;
 *   · a product carrying several values (a list split apart, or a field repeated across slots like
 *     g:product_highlight(1..10)) is counted ONCE IN EACH, and the result says so (multi) — those shares add to more
 *     than 100% and the page must never print them as though they add to 100;
 *   · a derived reading (a path cut to a tier, text cut into length bands, prices into number bands) is a VIEW of the
 *     column, never a new one: the column underneath is untouched and the mode is part of the spec;
 *   · nothing is sampled. Every product the feed sent is counted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedBreakdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.0.0';
  var BLANK = '(blank)';
  var MAXLEN = 300;          // a value longer than this is kept to its first 300 characters (a description is a value too)
  var SLOT_SUFFIX = ' · all slots';

  function s0(v) { return v == null ? '' : String(v); }
  // what a person reads in a cell: tags out, entities decoded, whitespace collapsed
  function clean(v) {
    var s = s0(Array.isArray(v) ? v.join(' | ') : v);
    if (s.indexOf('<') >= 0) s = s.replace(/<[^>]*>/g, ' ');
    if (s.indexOf('&') >= 0) s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > MAXLEN ? s.slice(0, MAXLEN) : s;
  }
  // a column's name as the feed states it, without the parser's type stamp ('c:fs_data_opti type="string"')
  function colName(h) { return s0(h).replace(/\s+type=.*$/i, '').trim(); }
  // the column's family and slot: g:product_type(3) → base g:product_type, slot 3; a bare tag is slot 1
  function slotOf(name) {
    var m = /^(.*?)\s*\((\d+)\)\s*$/.exec(name);
    return m ? { base: m[1], slot: +m[2] } : { base: name, slot: 1 };
  }
  // the label a person reads: the tag without its namespace, the slot said in words
  function labelOf(name) {
    var so = slotOf(name), b = so.base.replace(/^(g|c|fs):/i, '');
    return so.slot > 1 ? b + ' (' + so.slot + ')' : b;
  }

  // ---- the store ------------------------------------------------------------------------------------------------------
  function createStore() { return { n: 0, cap: 1024, cols: [], byName: Object.create(null), hmap: null, hlen: -1, hsrc: null }; }
  function addCol(S, name) {
    var c = { name: name, dict: new Map([['', 0]]), vals: [''], ids: new Uint32Array(S.cap) };
    S.byName[name] = S.cols.length; S.cols.push(c); return S.cols.length - 1;
  }
  function grow(S) {
    var cap = S.cap * 2;
    S.cols.forEach(function (c) { var a = new Uint32Array(cap); a.set(c.ids); c.ids = a; });
    S.cap = cap;
  }
  // one product → the store. h is the header the row is aligned to (the XML parser grows its header as new tags
  // appear, so a later row can carry more columns than an earlier one — the earlier rows read blank there, which a
  // zero-filled Uint32Array already says)
  function addRow(S, row, h) {
    if (!row) return;
    if (S.n >= S.cap) grow(S);
    if (h !== S.hsrc || h.length !== S.hlen) {
      S.hsrc = h; S.hlen = h.length; S.hmap = new Array(h.length);
      for (var j = 0; j < h.length; j++) {
        var nm = colName(h[j]); if (!nm) { S.hmap[j] = -1; continue; }
        var ci = S.byName[nm]; S.hmap[j] = ci == null ? addCol(S, nm) : ci;
      }
    }
    var r = S.n;
    for (var i = 0; i < row.length && i < S.hmap.length; i++) {
      var k = S.hmap[i]; if (k < 0) continue;
      var v = clean(row[i]); if (!v) continue;
      var c = S.cols[k], id = c.dict.get(v);
      if (id == null) { id = c.vals.length; c.dict.set(v, id); c.vals.push(v); }
      c.ids[r] = id;
    }
    S.n++;
  }

  // ---- what a field is ------------------------------------------------------------------------------------------------
  var NUM_RE = /-?\d+(?:[.,]\d+)?/;
  function numOf(v) { var m = NUM_RE.exec(s0(v)); return m ? parseFloat(m[0].replace(',', '.')) : NaN; }
  function isPath(v) { return /\S\s*>\s*\S/.test(v); }
  // a calendar date as a feed writes it — 2026-05-22 (FeedHero's fs_date_of_birth, any timestamp after it) or 22/05/2026
  var DATE_ISO = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/, DATE_UK = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/;
  function dateOf(v) {
    var s = s0(v), m = DATE_ISO.exec(s), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } else if ((m = DATE_UK.exec(s))) { y = +m[3]; mo = +m[2]; d = +m[1]; } else return null;
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d };
  }
  // read a column's character off its distinct values — never off its name, which says nothing in a sheet feed
  function kindOf(c, filled) {
    var vals = c.vals, d = vals.length - 1;
    if (!d) return 'empty';
    var lim = Math.min(d, 400), path = 0, num = 0, url = 0, list = 0, len = 0, date = 0;
    for (var i = 1; i <= lim; i++) {
      var v = vals[i]; len += v.length;
      if (isPath(v)) path++;
      if (dateOf(v)) date++;
      if (/^https?:\/\//i.test(v)) url++;
      else if (/^\s*-?\d+(?:[.,]\d+)?(\s*[A-Za-z£$€]{0,4})?\s*$/.test(v) || /^[£$€]\s*\d/.test(v)) num++;
      if (/\|/.test(v) || /;/.test(v)) list++;
    }
    if (url / lim >= 0.8) return 'url';
    if (date / lim >= 0.8) return 'date';
    if (path / lim >= 0.3) return 'path';
    if (num / lim >= 0.8) return 'number';
    if (list / lim >= 0.3) return 'list';
    if (len / lim > 60) return 'text';
    if (filled >= 20 && d / filled >= 0.95) return 'id';
    return 'value';
  }
  // every field a person can pick: each column, plus ONE "all slots" field per repeated tag carrying 2+ filled slots
  function fields(S) {
    var out = [], fam = Object.create(null);
    S.cols.forEach(function (c, i) {
      var filled = 0; for (var r = 0; r < S.n; r++) if (c.ids[r]) filled++;
      var so = slotOf(c.name), kind = kindOf(c, filled);
      var f = { f: c.name, label: labelOf(c.name), base: so.base, slot: so.slot, col: i, filled: filled, fill: S.n ? filled / S.n : 0,
        distinct: c.vals.length - 1, kind: kind };
      out.push(f);
      if (filled) (fam[so.base] = fam[so.base] || []).push(f);
    });
    Object.keys(fam).forEach(function (b) {
      var m = fam[b]; if (m.length < 2) return;
      m.sort(function (a, z) { return a.slot - z.slot; });
      var any = 0; for (var r = 0; r < S.n; r++) { for (var j = 0; j < m.length; j++) if (S.cols[m[j].col].ids[r]) { any++; break; } }
      out.push({ f: b + '*', label: labelOf(b) + SLOT_SUFFIX, base: b, slot: 0, cols: m.map(function (x) { return x.col; }), slots: m.length,
        filled: any, fill: S.n ? any / S.n : 0, distinct: null, kind: m[0].kind === 'path' ? 'path' : (m[0].kind === 'text' ? 'text' : 'value'), multi: true });
    });
    out.sort(function (a, z) { return a.base === z.base ? (a.slot || 99) - (z.slot || 99) : (a.base < z.base ? -1 : 1); });
    return out;
  }
  function fieldOf(S, f) {
    if (!f) return null;
    if (S.byName[f] != null) return { cols: [S.byName[f]], multi: false };
    if (/\*$/.test(f)) {
      var b = f.slice(0, -1), cols = [];
      S.cols.forEach(function (c, i) { if (slotOf(c.name).base === b) cols.push(i); });
      if (cols.length) return { cols: cols, multi: true };
    }
    return null;
  }
  // the readings a field allows, by what it is
  function modesFor(kind) {
    var m = ['raw'];
    if (kind === 'path') m.push('tier');
    if (kind === 'text' || kind === 'value' || kind === 'id' || kind === 'list') m.push('len');
    if (kind === 'number') m.push('num');
    if (kind === 'date') m.push('qtr');
    if (kind === 'list' || kind === 'value' || kind === 'text') m.push('list');
    return m;
  }
  var MODE_LBL = { raw: 'Each value', tier: 'Path to tier', len: 'Length bands', num: 'Number bands', list: 'Split lists', qtr: 'Newness by quarter' };

  // ---- derived readings: a VIEW of the column, cached per (column, mode, tier) --------------------------------------
  var LEN_BANDS = [[1, 30, '1–30 characters'], [31, 70, '31–70 characters'], [71, 150, '71–150 characters'], [151, 500, '151–500 characters'], [501, 1e12, '501+ characters']];
  var NUM_EDGES = [0, 10, 25, 50, 100, 250, 500, 1000];
  function numBand(x) {
    if (isNaN(x)) return 'not a number';
    if (x < 0) return 'below 0';
    for (var i = NUM_EDGES.length - 1; i >= 0; i--) if (x >= NUM_EDGES[i]) return i === NUM_EDGES.length - 1 ? NUM_EDGES[i] + '+' : NUM_EDGES[i] + '–' + NUM_EDGES[i + 1];
    return '0–10';
  }
  // NEWNESS BY QUARTER: a date read as the calendar quarter it falls in, counted back from the quarter we are in — the
  // latest quarter first, then the one before, … QTR_BACK quarters, the rest folded into one "Before …" band. Quarters,
  // not rolling 30/90-day windows (Ray, 19 Oct 2026: "just do it based on quarter, from the latest quarter to the
  // previous quarter"), so a band means the same thing to everyone reading it on any day of that quarter.
  var QTR_BACK = 8, NO_DATE = 'no readable date';
  function qIdx(y, m) { return y * 4 + Math.floor((m - 1) / 3); }
  function qName(i) { return 'Q' + (i % 4 + 1) + ' ' + Math.floor(i / 4); }
  function nowQ(S) { var t = new Date(S && S.now != null ? S.now : Date.now()); return qIdx(t.getUTCFullYear(), t.getUTCMonth() + 1); }
  function qtrBand(v, ref) {
    var d = dateOf(v); if (!d) return NO_DATE;
    var i = qIdx(d.y, d.m), back = ref - i;
    if (back < QTR_BACK) return qName(i);           // a quarter is named by itself — ahead, this one and the last read as any other
    return 'Before ' + qName(ref - QTR_BACK + 1);
  }
  // a quarter nothing arrived in is a real zero, not a missing row: the ladder runs unbroken from THIS quarter back to the
  // oldest one the counts reach (all QTR_BACK when anything sits in "Before …"), so an empty latest quarter is seen
  function qtrFill(S, cnt) {
    var ref = nowQ(S), deep = -1;
    cnt.forEach(function (n, v) {
      if (/^Before /.test(v)) deep = QTR_BACK - 1;
      var q = /^Q([1-4]) (\d{4})/.exec(v); if (q) { var back = ref - (+q[2] * 4 + (+q[1] - 1)); if (back > deep) deep = back; }
    });
    for (var b = 0; b <= Math.min(deep, QTR_BACK - 1); b++) { var lbl = qtrBand((function (i) { var y = Math.floor(i / 4), m = (i % 4) * 3 + 1; return y + '-' + (m < 10 ? '0' : '') + m + '-01'; })(ref - b), ref); if (!cnt.has(lbl)) cnt.set(lbl, 0); }
  }
  // the natural order of a band — so 10–25 sits after 0–10 rather than wherever its count puts it
  function isBand(mode) { return mode === 'len' || mode === 'num' || mode === 'qtr'; }
  function bandOrder(mode, v) {
    if (v === BLANK) return 1e9;
    if (mode === 'len') { for (var i = 0; i < LEN_BANDS.length; i++) if (LEN_BANDS[i][2] === v) return i; }
    if (mode === 'num') { var x = parseFloat(v); return isNaN(x) ? (v === 'below 0' ? -1 : 1e8) : x; }
    if (mode === 'qtr') {   // newest first: a later quarter sorts ahead; "Before …" after every quarter; no date last
      if (v === NO_DATE) return 1e8;
      var q = /^(Before )?Q([1-4]) (\d{4})/.exec(v); if (!q) return 1e7;
      return (q[1] ? 1e6 : 0) - (+q[3] * 4 + (+q[2] - 1));
    }
    return null;
  }
  function tierOf(v, k) { var p = v.split(/\s*>\s*/); return p.length <= k ? p.join(' > ') : p.slice(0, k).join(' > '); }
  function splitList(v) {
    var parts = v.indexOf('|||') >= 0 ? v.split('|||') : v.split(/\s*[|;]\s*|\s*,\s+/);
    var seen = Object.create(null), out = [];
    parts.forEach(function (p) { p = p.trim(); if (p && !seen[p]) { seen[p] = 1; out.push(p); } });
    return out;
  }
  function derive(S, ci, mode, k) {
    var ref = mode === 'qtr' ? nowQ(S) : 0;
    var c = S.cols[ci], key = mode + ':' + (mode === 'qtr' ? ref : (k || 0));
    c.dv = c.dv || Object.create(null);
    if (c.dv[key]) return c.dv[key];
    var out = new Array(c.vals.length); out[0] = [];
    for (var i = 1; i < c.vals.length; i++) {
      var v = c.vals[i];
      if (mode === 'tier') out[i] = [tierOf(v, k || 1)];
      else if (mode === 'len') { var L = v.length, b = ''; for (var j = 0; j < LEN_BANDS.length; j++) if (L >= LEN_BANDS[j][0] && L <= LEN_BANDS[j][1]) { b = LEN_BANDS[j][2]; break; } out[i] = [b]; }
      else if (mode === 'num') out[i] = [numBand(numOf(v))];
      else if (mode === 'list') out[i] = splitList(v);
      else if (mode === 'qtr') out[i] = [qtrBand(v, ref)];
      else out[i] = [v];
    }
    c.dv[key] = out; return out;
  }
  // the deepest tier a path field reaches (the tier picker's ceiling)
  function maxTier(S, f) {
    var F = fieldOf(S, f); if (!F) return 0;
    var mx = 1;
    F.cols.forEach(function (ci) { var vals = S.cols[ci].vals; for (var i = 1; i < vals.length; i++) { var d = vals[i].split(/\s*>\s*/).length; if (d > mx) mx = d; } });
    return mx;
  }
  // spec {f, m, k} → a function giving a product's values (an empty list = blank)
  function reader(S, spec) {
    var F = fieldOf(S, spec && spec.f); if (!F) return null;
    var mode = spec.m || 'raw', k = spec.k || 1;
    var D = F.cols.map(function (ci) { return { ids: S.cols[ci].ids, dv: derive(S, ci, mode, k) }; });
    var multi = F.multi || mode === 'list';
    if (D.length === 1 && !multi) { var d0 = D[0]; return { multi: false, of: function (r) { return d0.dv[d0.ids[r]]; } }; }
    return { multi: true, of: function (r) {
      var out = [];
      for (var j = 0; j < D.length; j++) { var a = D[j].dv[D[j].ids[r]]; for (var x = 0; x < a.length; x++) if (out.indexOf(a[x]) < 0) out.push(a[x]); }
      return out;
    } };
  }

  // ---- filters: AND across fields, OR within one field ---------------------------------------------------------------
  // filters = [{spec, vals:[...]}]; a product passes a filter when ANY of its values is listed (BLANK names an empty one)
  function mask(S, filters) {
    var m = new Uint8Array(S.n); m.fill(1);
    (filters || []).forEach(function (fl) {
      var R = reader(S, fl.spec); if (!R || !fl.vals || !fl.vals.length) return;
      var want = Object.create(null); fl.vals.forEach(function (v) { want[v] = 1; });
      for (var r = 0; r < S.n; r++) {
        if (!m[r]) continue;
        var a = R.of(r), hit = false;
        if (!a.length) hit = !!want[BLANK];
        else for (var j = 0; j < a.length; j++) if (want[a[j]]) { hit = true; break; }
        if (!hit) m[r] = 0;
      }
    });
    return m;
  }
  function passing(m) { var n = 0; for (var i = 0; i < m.length; i++) if (m[i]) n++; return n; }

  // the item group a product belongs to (the unit "styles" counts), or null when the feed carries no item_group_id
  function groupCol(S) {
    for (var i = 0; i < S.cols.length; i++) { var nm = S.cols[i].name.replace(/^(g|c|fs):/i, '').toLowerCase(); if (nm === 'item_group_id' || nm === 'itemgroupid') return i; }
    return -1;
  }

  // ---- one field: value · products · share --------------------------------------------------------------------------
  // opts.unit 'sku' (each product) | 'group' (each item group, once per value); a group with no id counts as itself
  function pivot(S, spec, m, opts) {
    opts = opts || {};
    var R = reader(S, spec); if (!R) return null;
    // opts.w / opts.w2: a WEIGHT per product (Google Ads spend, clicks …) summed instead of counting — a weighted
    // table counts products (never item groups), and still says how many products each value carries (p)
    var w = typeof opts.w === 'function' ? opts.w : null, w2 = w && typeof opts.w2 === 'function' ? opts.w2 : null;
    var g = !w && opts.unit === 'group' ? groupCol(S) : -1, gids = g >= 0 ? S.cols[g].ids : null;
    var cnt = new Map(), sets = g >= 0 ? new Map() : null, tot = 0, totSet = g >= 0 ? new Set() : null, multiRows = 0;
    var pc_ = w ? new Map() : null, c2 = w2 ? new Map() : null, totP = 0, tot2 = 0;
    // opts.lw / opts.lw2: a SECOND reading LAYERED on the first (Ray, 19 Oct 2026: "see 2 data points together …
    // volume of product (in count) and ROAS") — 1 = count products, else a weight per product; lw2 makes it a ratio
    var lw = opts.lw === 1 ? function () { return 1; } : typeof opts.lw === 'function' ? opts.lw : null, lw2 = lw && typeof opts.lw2 === 'function' ? opts.lw2 : null;
    var cL = lw ? new Map() : null, cL2 = lw2 ? new Map() : null, totL = 0, totL2 = 0;
    for (var r = 0; r < S.n; r++) {
      if (m && !m[r]) continue;
      var a = R.of(r); if (!a.length) a = [BLANK]; else if (a.length > 1) multiRows++;
      if (lw) { var y = lw(r), y2 = lw2 ? lw2(r) : 0; totL += y; totL2 += y2; for (var jl = 0; jl < a.length; jl++) { cL.set(a[jl], (cL.get(a[jl]) || 0) + y); if (lw2) cL2.set(a[jl], (cL2.get(a[jl]) || 0) + y2); } }
      var unitKey = gids ? (gids[r] ? 'g' + gids[r] : 'r' + r) : null;
      var x = w ? w(r) : 1, x2 = w2 ? w2(r) : 0;
      if (totSet) totSet.add(unitKey); else tot += x;
      if (w) { totP++; tot2 += x2; }
      for (var j = 0; j < a.length; j++) {
        if (sets) { var s = sets.get(a[j]); if (!s) { s = new Set(); sets.set(a[j], s); } s.add(unitKey); }
        else cnt.set(a[j], (cnt.get(a[j]) || 0) + x);
        if (w) { pc_.set(a[j], (pc_.get(a[j]) || 0) + 1); if (w2) c2.set(a[j], (c2.get(a[j]) || 0) + x2); }
      }
    }
    if (totSet) { tot = totSet.size; sets.forEach(function (s, v) { cnt.set(v, s.size); }); }
    var rows = [], mode = spec.m || 'raw';
    if (mode === 'qtr') qtrFill(S, cnt);
    cnt.forEach(function (n, v) {
      var o = { v: v, n: n, share: tot ? n / tot : 0, o: bandOrder(mode, v) };
      if (w) { o.p = pc_.get(v) || 0; if (w2) o.n2 = c2.get(v) || 0; }
      if (lw) { o.nL = cL.get(v) || 0; if (lw2) o.nL2 = cL2.get(v) || 0; }
      rows.push(o);
    });
    sortRows(rows, isBand(mode) ? 'o' : 'n', isBand(mode) ? 1 : -1);
    var blank = cnt.get(BLANK) || 0;
    var res = { rows: rows, total: tot, distinct: rows.filter(function (x) { return x.n > 0; }).length - (blank ? 1 : 0), blank: blank, multi: R.multi && multiRows > 0, multiRows: multiRows, unit: g >= 0 ? 'group' : 'sku' };
    if (w) { res.weighted = true; res.totalP = totP; if (w2) res.total2 = tot2; }
    if (lw) { res.layered = true; res.totalL = totL; if (lw2) res.totalL2 = totL2; }
    return res;
  }
  // k: 'v' value (A→Z, numbers in number order) · 'n' count · 'share' · 'o' band order; blank always last
  var COLL = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) : null;
  function sortRows(rows, k, dir) {
    dir = dir || -1;
    rows.sort(function (a, b) {
      if (a.v === BLANK && b.v !== BLANK) return 1;
      if (b.v === BLANK && a.v !== BLANK) return -1;
      var x, y;
      if (k === 'v') { var c = COLL ? COLL.compare(a.v, b.v) : (a.v < b.v ? -1 : a.v > b.v ? 1 : 0); return c * dir; }
      if (k === 'o' && a.o != null && b.o != null) { x = a.o; y = b.o; }
      else { x = a.n; y = b.n; }
      if (x !== y) return (x - y) * dir;
      return COLL ? COLL.compare(a.v, b.v) : (a.v < b.v ? -1 : 1);
    });
    return rows;
  }

  // ---- two fields: the cross-tab --------------------------------------------------------------------------------------
  // rows × columns of products, the columns past maxC folded into ONE "Other" column that keeps its count, so the row
  // totals still add up; a row's total is the products carrying ANY of its values (the row field's own count)
  function cross(S, rs, cs, m, opts) {
    opts = opts || {};
    var RR = reader(S, rs), RC = reader(S, cs); if (!RR || !RC) return null;
    // 0 = no limit (every column / every row); absent = the screen's defaults
    var maxC = opts.maxC == null ? 12 : opts.maxC, maxR = opts.maxR == null ? 25 : opts.maxR;
    // opts.w / opts.w2 as in pivot(): every cell sums the weight (cells) and the second weight (cells2), each row and
    // column also says how many products it holds (p) — so a share of spend can sit beside a share of products
    var w = typeof opts.w === 'function' ? opts.w : null, w2 = w && typeof opts.w2 === 'function' ? opts.w2 : null;
    var rowTot = new Map(), colTot = new Map(), cell = new Map(), tot = 0;
    var rowP = new Map(), colP = new Map(), row2 = new Map(), col2 = new Map(), cell2 = new Map(), totP = 0, tot2 = 0;
    // the LAYER (as in pivot): a second reading summed per cell, row, column and total, on the SAME rows and columns
    var lw = opts.lw === 1 ? function () { return 1; } : typeof opts.lw === 'function' ? opts.lw : null, lw2 = lw && typeof opts.lw2 === 'function' ? opts.lw2 : null;
    var cellL = new Map(), cellL2 = new Map(), rowL = new Map(), rowL2 = new Map(), colL = new Map(), colL2 = new Map(), totL = 0, totL2 = 0;
    var addL = function (M, k1, k2, v) { var mm = M.get(k1); if (!mm) { mm = new Map(); M.set(k1, mm); } mm.set(k2, (mm.get(k2) || 0) + v); };
    for (var r = 0; r < S.n; r++) {
      if (m && !m[r]) continue;
      var x = w ? w(r) : 1, x2 = w2 ? w2(r) : 0;
      tot += x; totP++; tot2 += x2;
      var a = RR.of(r), b = RC.of(r); if (!a.length) a = [BLANK]; if (!b.length) b = [BLANK];
      if (lw) {
        var y = lw(r), y2 = lw2 ? lw2(r) : 0; totL += y; totL2 += y2;
        for (var la = 0; la < a.length; la++) {
          rowL.set(a[la], (rowL.get(a[la]) || 0) + y); if (lw2) rowL2.set(a[la], (rowL2.get(a[la]) || 0) + y2);
          for (var lb = 0; lb < b.length; lb++) { addL(cellL, a[la], b[lb], y); if (lw2) addL(cellL2, a[la], b[lb], y2); }
        }
        for (var lc = 0; lc < b.length; lc++) { colL.set(b[lc], (colL.get(b[lc]) || 0) + y); if (lw2) colL2.set(b[lc], (colL2.get(b[lc]) || 0) + y2); }
      }
      for (var i = 0; i < a.length; i++) {
        rowTot.set(a[i], (rowTot.get(a[i]) || 0) + x);
        rowP.set(a[i], (rowP.get(a[i]) || 0) + 1);
        var row = cell.get(a[i]); if (!row) { row = new Map(); cell.set(a[i], row); }
        for (var j = 0; j < b.length; j++) row.set(b[j], (row.get(b[j]) || 0) + x);
        if (w2) {
          row2.set(a[i], (row2.get(a[i]) || 0) + x2);
          var rw2 = cell2.get(a[i]); if (!rw2) { rw2 = new Map(); cell2.set(a[i], rw2); }
          for (var j3 = 0; j3 < b.length; j3++) rw2.set(b[j3], (rw2.get(b[j3]) || 0) + x2);
        }
      }
      for (var j2 = 0; j2 < b.length; j2++) {
        colTot.set(b[j2], (colTot.get(b[j2]) || 0) + x);
        colP.set(b[j2], (colP.get(b[j2]) || 0) + 1);
        if (w2) col2.set(b[j2], (col2.get(b[j2]) || 0) + x2);
      }
    }
    var rm = rs.m || 'raw', cm = cs.m || 'raw';
    if (rm === 'qtr') qtrFill(S, rowTot);
    if (cm === 'qtr') qtrFill(S, colTot);
    var cols = []; colTot.forEach(function (n, v) { cols.push({ v: v, n: n, o: bandOrder(cm, v) }); });
    sortRows(cols, isBand(cm) ? 'o' : 'n', isBand(cm) ? 1 : -1);
    var rows = []; rowTot.forEach(function (n, v) { rows.push({ v: v, n: n, o: bandOrder(rm, v) }); });
    sortRows(rows, isBand(rm) ? 'o' : 'n', isBand(rm) ? 1 : -1);
    var shown = maxC > 0 ? cols.slice(0, maxC) : cols, other = maxC > 0 ? cols.slice(maxC) : [];
    var otherN = other.reduce(function (s, c) { return s + c.n; }, 0);
    var sumOf = function (M, list) { return list.reduce(function (s, c) { return s + (M.get(c.v) || 0); }, 0); };
    var outCols = shown.map(function (c) { var o = { v: c.v, n: c.n }; if (w) { o.p = colP.get(c.v) || 0; if (w2) o.n2 = col2.get(c.v) || 0; } if (lw) { o.nL = colL.get(c.v) || 0; if (lw2) o.nL2 = colL2.get(c.v) || 0; } return o; });
    if (other.length) {
      var oc = { v: 'Other (' + other.length + ' more)', n: otherN, other: true, members: other.map(function (c) { return c.v; }) };
      if (w) { oc.p = sumOf(colP, other); if (w2) oc.n2 = sumOf(col2, other); }
      if (lw) { oc.nL = sumOf(colL, other); if (lw2) oc.nL2 = sumOf(colL2, other); }
      outCols.push(oc);
    }
    var cut = maxR > 0 ? rows.slice(0, maxR) : rows;
    var outRows = cut.map(function (rw) {
      var map = cell.get(rw.v) || new Map(), cells = shown.map(function (c) { return map.get(c.v) || 0; });
      if (other.length) { var o = 0; other.forEach(function (c) { o += map.get(c.v) || 0; }); cells.push(o); }
      var out = { v: rw.v, n: rw.n, cells: cells };
      if (w) {
        out.p = rowP.get(rw.v) || 0;
        if (w2) {
          var m2 = cell2.get(rw.v) || new Map();
          out.n2 = row2.get(rw.v) || 0; out.cells2 = shown.map(function (c) { return m2.get(c.v) || 0; });
          if (other.length) out.cells2.push(sumOf(m2, other));
        }
      }
      if (lw) {
        var mL = cellL.get(rw.v) || new Map(), mL2 = cellL2.get(rw.v) || new Map();
        out.nL = rowL.get(rw.v) || 0; out.cellsL = shown.map(function (c) { return mL.get(c.v) || 0; });
        if (other.length) out.cellsL.push(sumOf(mL, other));
        if (lw2) { out.nL2 = rowL2.get(rw.v) || 0; out.cellsL2 = shown.map(function (c) { return mL2.get(c.v) || 0; }); if (other.length) out.cellsL2.push(sumOf(mL2, other)); }
      }
      return out;
    });
    var res = { rows: outRows, cols: outCols, total: tot, rowsAll: rows.length, rowsHidden: rows.length - cut.length, multi: RR.multi || RC.multi };
    if (w) { res.weighted = true; res.totalP = totP; if (w2) res.total2 = tot2; }
    if (lw) { res.layered = true; res.totalL = totL; if (lw2) res.totalL2 = totL2; }
    return res;
  }

  // ---- SPLIT: a field of two or three values read INSIDE every cell (Ray, 20 Oct 2026: "add a layer 3 with fields
  // from feed which only have < 3 unique values — eg % of product in Full / Sale"). Not a sum like the layers: what
  // a cell's products are MADE OF, so it always adds to 100% of that cell. A product with no value is its own part
  // (BLANK), never dropped. '@price' is a field no feed carries: on sale when the sale price is below the price.
  var PRICE_TYPE = '@price', SALE = 'On sale', FULL = 'Full price', SPLIT_MAX = 3;
  function colByBare(S, bare) {
    for (var i = 0; i < S.cols.length; i++) if (S.cols[i].name.replace(/^(g|c|fs):/i, '').toLowerCase() === bare) return i;
    return -1;
  }
  function splitFields(S) {
    var out = [], pc = colByBare(S, 'price'), sc = colByBare(S, 'sale_price');
    if (pc >= 0 && sc >= 0) out.push({ f: PRICE_TYPE, label: 'Price type', vals: [SALE, FULL], derived: true });
    fields(S).forEach(function (x) {
      if (x.multi || !x.filled || x.distinct < 2 || x.distinct > SPLIT_MAX) return;
      out.push({ f: x.f, label: x.label, vals: S.cols[x.col].vals.slice(1) });
    });
    return out;
  }
  function splitReader(S, f) {
    if (f === PRICE_TYPE) {
      var pc = colByBare(S, 'price'), sc = colByBare(S, 'sale_price'); if (pc < 0 || sc < 0) return null;
      var P = S.cols[pc], Q = S.cols[sc];
      return function (r) {
        var p = numOf(P.vals[P.ids[r]]), q = numOf(Q.vals[Q.ids[r]]);
        if (q > 0 && p > 0 && q < p) return SALE;
        return p > 0 ? FULL : BLANK;
      };
    }
    var R = reader(S, { f: f, m: 'raw' }); if (!R) return null;
    return function (r) { var a = R.of(r); return a.length ? a[0] : BLANK; };
  }
  // the parts every row × column cell (and every row, column and the whole) is made of: {vals, flag, cell, row, col,
  // tot} with an array per key in vals' order; opts.w sums a weight (spend) instead of counting products. rs / cs read
  // exactly as pivot() and cross() read them, so a part lines up with the cell it sits in; cs null = one field.
  function split(S, rs, cs, f, m, opts) {
    opts = opts || {};
    var RR = reader(S, rs), RC = cs ? reader(S, cs) : null, SP = splitReader(S, f); if (!RR || !SP || (cs && !RC)) return null;
    var w = typeof opts.w === 'function' ? opts.w : null;
    var by = new Map(), seen = [], cell = new Map(), row = new Map(), col = new Map(), tot = new Map();
    var add = function (M, k, v, x) { var o = M.get(k); if (!o) { o = new Map(); M.set(k, o); } o.set(v, (o.get(v) || 0) + x); };
    for (var r = 0; r < S.n; r++) {
      if (m && !m[r]) continue;
      var v = SP(r), x = w ? w(r) : 1;
      if (!by.has(v)) { by.set(v, 0); seen.push(v); }
      by.set(v, by.get(v) + x); tot.set(v, (tot.get(v) || 0) + x);
      var a = RR.of(r); if (!a.length) a = [BLANK];
      var b = RC ? RC.of(r) : null; if (b && !b.length) b = [BLANK];
      for (var i = 0; i < a.length; i++) {
        add(row, a[i], v, x);
        if (b) for (var j = 0; j < b.length; j++) add(cell, a[i] + '\u0001' + b[j], v, x);
      }
      if (b) for (var k = 0; k < b.length; k++) add(col, b[k], v, x);
    }
    // the parts in a fixed order: by size, the blank last; the FLAG is the part a reader asks about — "on sale" for the
    // price type, else the smaller of the stated parts (out of stock, the less common gender) — never the blank
    var vals = seen.filter(function (v) { return v !== BLANK; }).sort(function (p, q) { return by.get(q) - by.get(p); });
    if (by.has(BLANK)) vals.push(BLANK);
    var stated = vals.filter(function (v) { return v !== BLANK; });
    var flag = f === PRICE_TYPE ? SALE : stated.length > 1 ? stated[stated.length - 1] : stated[0] || null;
    var arr = function (o) { return vals.map(function (v) { return o ? o.get(v) || 0 : 0; }); };
    var conv = function (M) { var o = Object.create(null); M.forEach(function (mm, k) { o[k] = arr(mm); }); return o; };
    return { f: f, vals: vals, flag: flag, fi: vals.indexOf(flag), weighted: !!w, tot: arr(tot), row: conv(row), col: conv(col), cell: conv(cell) };
  }
  function splitKey(rv, cv) { return rv + '\u0001' + cv; }

  // ---- GOOGLE ADS PER PRODUCT: FeedHero's Ads Traffic read ({id: [impr, clicks, cost, conv, value]}) joined onto the
  // store by product id, CASE-BLIND (Google lower-cases the Ads item id that stands in for a blank one). The join
  // column is the one carrying more of the report's ids — g:id, else c:fs_data_original_id — never a guess. Spend on
  // ids the feed does not carry is kept APART (out), never spread over the groups. Weights are per product.
  var ADS_KEYS = ['impr', 'clicks', 'cost', 'conv', 'value'];
  function adsJoin(S, rows) {
    var idx = new Map();
    Object.keys(rows || {}).forEach(function (k) { idx.set(String(k).trim().toLowerCase(), rows[k]); });
    var cand = [];
    S.cols.forEach(function (c, i) { var nm = c.name.replace(/^(g|c|fs):/i, '').toLowerCase(); if (nm === 'id' || nm === 'fs_data_original_id') cand.push(i); });
    var best = -1, bestN = -1;
    cand.forEach(function (ci) {
      var c = S.cols[ci], hit = 0;
      for (var r = 0; r < S.n; r++) { var v = c.vals[c.ids[r]]; if (v && idx.has(v.toLowerCase())) hit++; }
      if (hit > bestN) { bestN = hit; best = ci; }
    });
    var f = {}; ADS_KEYS.forEach(function (k) { f[k] = new Float64Array(S.n); });
    var tot = { impr: 0, clicks: 0, cost: 0, conv: 0, value: 0 }, inF = { impr: 0, clicks: 0, cost: 0, conv: 0, value: 0 }, used = new Set(), matched = 0;
    idx.forEach(function (a) { ADS_KEYS.forEach(function (k, j) { tot[k] += +a[j] || 0; }); });
    if (best >= 0) {
      var c = S.cols[best];
      for (var r = 0; r < S.n; r++) {
        var v = c.vals[c.ids[r]]; if (!v) continue;
        var key = v.toLowerCase(), a = idx.get(key); if (!a) continue;
        matched++;
        if (used.has(key)) continue;   // two rows one id: the report's figure is counted once, on the first
        used.add(key);
        ADS_KEYS.forEach(function (k, j) { var x = +a[j] || 0; f[k][r] = x; inF[k] += x; });
      }
    }
    var out = {}; ADS_KEYS.forEach(function (k) { out[k] = Math.max(0, tot[k] - inF[k]); });
    return { f: f, col: best >= 0 ? S.cols[best].name : null, ids: idx.size, matched: matched, used: used.size, unmatchedIds: idx.size - used.size, tot: tot, inFeed: inF, out: out };
  }

  // ---- the defaults a fresh device opens on: the fields a feed person reaches for first, those this feed carries ----
  var PANE_PREFS = [['g:product_type', 'tier', 2], ['product_type', 'tier', 2], ['g:custom_label_0', 'raw'], ['custom_label_0', 'raw'], ['g:brand', 'raw'], ['brand', 'raw'],
    ['g:availability', 'raw'], ['availability', 'raw'], ['g:color', 'raw'], ['color', 'raw'], ['g:gender', 'raw'], ['gender', 'raw']];
  function defaultPanes(S, n) {
    var out = [], used = Object.create(null);
    PANE_PREFS.forEach(function (p) {
      if (out.length >= (n || 4)) return;
      var base = p[0].replace(/^g:/, '');
      if (used[base] || S.byName[p[0]] == null) return;
      used[base] = 1; out.push({ f: p[0], m: p[1], k: p[2] || 0 });
    });
    if (!out.length) {
      fields(S).filter(function (f) { return f.kind === 'value' && f.filled && f.distinct > 1 && f.distinct < 200; }).slice(0, n || 4)
        .forEach(function (f) { out.push({ f: f.f, m: 'raw', k: 0 }); });
    }
    return out;
  }
  // a saved spec on a feed that names its columns another way: the same field by its bare name (g:brand ↔ brand)
  function resolve(S, spec) {
    if (!spec || !spec.f) return null;
    if (fieldOf(S, spec.f)) return spec;
    var star = /\*$/.test(spec.f), bare = spec.f.replace(/\*$/, '').replace(/^(g|c|fs):/i, '').toLowerCase();
    for (var i = 0; i < S.cols.length; i++) {
      var so = slotOf(S.cols[i].name), b = so.base.replace(/^(g|c|fs):/i, '').toLowerCase();
      if (b === bare && (star || so.slot === 1)) return { f: star ? so.base + '*' : so.base, m: spec.m, k: spec.k };
    }
    return null;
  }

  // ---- CSV ------------------------------------------------------------------------------------------------------------
  function csvCell(v) { var s = s0(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function csv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }
  function specName(S, spec) {
    if (!spec) return '';
    var nm = /\*$/.test(spec.f) ? labelOf(spec.f.slice(0, -1)) + SLOT_SUFFIX : labelOf(spec.f);
    if (spec.m === 'tier') nm += ' · tier ' + (spec.k || 1);
    else if (spec.m && spec.m !== 'raw') nm += ' · ' + MODE_LBL[spec.m].toLowerCase();
    return nm;
  }

  return { VERSION: VERSION, BLANK: BLANK, MAXLEN: MAXLEN, MODE_LBL: MODE_LBL, LEN_BANDS: LEN_BANDS, NUM_EDGES: NUM_EDGES,
    clean: clean, colName: colName, slotOf: slotOf, labelOf: labelOf, createStore: createStore, addRow: addRow, kindOf: kindOf,
    fields: fields, fieldOf: fieldOf, modesFor: modesFor, maxTier: maxTier, tierOf: tierOf, splitList: splitList, numBand: numBand, adsJoin: adsJoin, ADS_KEYS: ADS_KEYS, dateOf: dateOf, qtrBand: qtrBand, isBand: isBand, QTR_BACK: QTR_BACK, NO_DATE: NO_DATE,
    reader: reader, mask: mask, passing: passing, groupCol: groupCol, pivot: pivot, sortRows: sortRows, cross: cross,
    defaultPanes: defaultPanes, resolve: resolve, csv: csv, specName: specName,
    split: split, splitFields: splitFields, splitReader: splitReader, splitKey: splitKey, PRICE_TYPE: PRICE_TYPE, SALE: SALE, FULL: FULL, SPLIT_MAX: SPLIT_MAX };
});
