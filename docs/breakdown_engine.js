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
  // read a column's character off its distinct values — never off its name, which says nothing in a sheet feed
  function kindOf(c, filled) {
    var vals = c.vals, d = vals.length - 1;
    if (!d) return 'empty';
    var lim = Math.min(d, 400), path = 0, num = 0, url = 0, list = 0, len = 0;
    for (var i = 1; i <= lim; i++) {
      var v = vals[i]; len += v.length;
      if (isPath(v)) path++;
      if (/^https?:\/\//i.test(v)) url++;
      else if (/^\s*-?\d+(?:[.,]\d+)?(\s*[A-Za-z£$€]{0,4})?\s*$/.test(v) || /^[£$€]\s*\d/.test(v)) num++;
      if (/\|/.test(v) || /;/.test(v)) list++;
    }
    if (url / lim >= 0.8) return 'url';
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
    if (kind === 'list' || kind === 'value' || kind === 'text') m.push('list');
    return m;
  }
  var MODE_LBL = { raw: 'Each value', tier: 'Path to tier', len: 'Length bands', num: 'Number bands', list: 'Split lists' };

  // ---- derived readings: a VIEW of the column, cached per (column, mode, tier) --------------------------------------
  var LEN_BANDS = [[1, 30, '1–30 characters'], [31, 70, '31–70 characters'], [71, 150, '71–150 characters'], [151, 500, '151–500 characters'], [501, 1e12, '501+ characters']];
  var NUM_EDGES = [0, 10, 25, 50, 100, 250, 500, 1000];
  function numBand(x) {
    if (isNaN(x)) return 'not a number';
    if (x < 0) return 'below 0';
    for (var i = NUM_EDGES.length - 1; i >= 0; i--) if (x >= NUM_EDGES[i]) return i === NUM_EDGES.length - 1 ? NUM_EDGES[i] + '+' : NUM_EDGES[i] + '–' + NUM_EDGES[i + 1];
    return '0–10';
  }
  // the natural order of a band — so 10–25 sits after 0–10 rather than wherever its count puts it
  function bandOrder(mode, v) {
    if (v === BLANK) return 1e9;
    if (mode === 'len') { for (var i = 0; i < LEN_BANDS.length; i++) if (LEN_BANDS[i][2] === v) return i; }
    if (mode === 'num') { var x = parseFloat(v); return isNaN(x) ? (v === 'below 0' ? -1 : 1e8) : x; }
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
    var c = S.cols[ci], key = mode + ':' + (k || 0);
    c.dv = c.dv || Object.create(null);
    if (c.dv[key]) return c.dv[key];
    var out = new Array(c.vals.length); out[0] = [];
    for (var i = 1; i < c.vals.length; i++) {
      var v = c.vals[i];
      if (mode === 'tier') out[i] = [tierOf(v, k || 1)];
      else if (mode === 'len') { var L = v.length, b = ''; for (var j = 0; j < LEN_BANDS.length; j++) if (L >= LEN_BANDS[j][0] && L <= LEN_BANDS[j][1]) { b = LEN_BANDS[j][2]; break; } out[i] = [b]; }
      else if (mode === 'num') out[i] = [numBand(numOf(v))];
      else if (mode === 'list') out[i] = splitList(v);
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
    var g = opts.unit === 'group' ? groupCol(S) : -1, gids = g >= 0 ? S.cols[g].ids : null;
    var cnt = new Map(), sets = g >= 0 ? new Map() : null, tot = 0, totSet = g >= 0 ? new Set() : null, multiRows = 0;
    for (var r = 0; r < S.n; r++) {
      if (m && !m[r]) continue;
      var a = R.of(r); if (!a.length) a = [BLANK]; else if (a.length > 1) multiRows++;
      var unitKey = gids ? (gids[r] ? 'g' + gids[r] : 'r' + r) : null;
      if (totSet) totSet.add(unitKey); else tot++;
      for (var j = 0; j < a.length; j++) {
        if (sets) { var s = sets.get(a[j]); if (!s) { s = new Set(); sets.set(a[j], s); } s.add(unitKey); }
        else cnt.set(a[j], (cnt.get(a[j]) || 0) + 1);
      }
    }
    if (totSet) { tot = totSet.size; sets.forEach(function (s, v) { cnt.set(v, s.size); }); }
    var rows = [], mode = spec.m || 'raw';
    cnt.forEach(function (n, v) { rows.push({ v: v, n: n, share: tot ? n / tot : 0, o: bandOrder(mode, v) }); });
    sortRows(rows, mode === 'len' || mode === 'num' ? 'o' : 'n', mode === 'len' || mode === 'num' ? 1 : -1);
    var blank = cnt.get(BLANK) || 0;
    return { rows: rows, total: tot, distinct: rows.length - (blank ? 1 : 0), blank: blank, multi: R.multi && multiRows > 0, multiRows: multiRows, unit: g >= 0 ? 'group' : 'sku' };
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
    var rowTot = new Map(), colTot = new Map(), cell = new Map(), tot = 0;
    for (var r = 0; r < S.n; r++) {
      if (m && !m[r]) continue;
      tot++;
      var a = RR.of(r), b = RC.of(r); if (!a.length) a = [BLANK]; if (!b.length) b = [BLANK];
      for (var i = 0; i < a.length; i++) {
        rowTot.set(a[i], (rowTot.get(a[i]) || 0) + 1);
        var row = cell.get(a[i]); if (!row) { row = new Map(); cell.set(a[i], row); }
        for (var j = 0; j < b.length; j++) row.set(b[j], (row.get(b[j]) || 0) + 1);
      }
      for (var j2 = 0; j2 < b.length; j2++) colTot.set(b[j2], (colTot.get(b[j2]) || 0) + 1);
    }
    var rm = rs.m || 'raw', cm = cs.m || 'raw';
    var cols = []; colTot.forEach(function (n, v) { cols.push({ v: v, n: n, o: bandOrder(cm, v) }); });
    sortRows(cols, cm === 'len' || cm === 'num' ? 'o' : 'n', cm === 'len' || cm === 'num' ? 1 : -1);
    var rows = []; rowTot.forEach(function (n, v) { rows.push({ v: v, n: n, o: bandOrder(rm, v) }); });
    sortRows(rows, rm === 'len' || rm === 'num' ? 'o' : 'n', rm === 'len' || rm === 'num' ? 1 : -1);
    var shown = maxC > 0 ? cols.slice(0, maxC) : cols, other = maxC > 0 ? cols.slice(maxC) : [];
    var otherN = other.reduce(function (s, c) { return s + c.n; }, 0);
    var outCols = shown.map(function (c) { return { v: c.v, n: c.n }; });
    if (other.length) outCols.push({ v: 'Other (' + other.length + ' more)', n: otherN, other: true, members: other.map(function (c) { return c.v; }) });
    var cut = maxR > 0 ? rows.slice(0, maxR) : rows;
    var outRows = cut.map(function (rw) {
      var map = cell.get(rw.v), cells = shown.map(function (c) { return map.get(c.v) || 0; });
      if (other.length) { var o = 0; other.forEach(function (c) { o += map.get(c.v) || 0; }); cells.push(o); }
      return { v: rw.v, n: rw.n, cells: cells };
    });
    return { rows: outRows, cols: outCols, total: tot, rowsAll: rows.length, rowsHidden: rows.length - cut.length, multi: RR.multi || RC.multi };
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
    fields: fields, fieldOf: fieldOf, modesFor: modesFor, maxTier: maxTier, tierOf: tierOf, splitList: splitList, numBand: numBand,
    reader: reader, mask: mask, passing: passing, groupCol: groupCol, pivot: pivot, sortRows: sortRows, cross: cross,
    defaultPanes: defaultPanes, resolve: resolve, csv: csv, specName: specName };
});
