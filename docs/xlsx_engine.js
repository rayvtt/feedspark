/* FeedSpark — minimal XLSX table writer (UMD).  Served at /xlsx/engine.js.
 *
 * Ray, 16 Sep 2026: "allows excel downloads on Tasks / Client tickets / Account & hours balance".
 *
 * WHY NOT REUSE THE AI QUOTE'S WRITER: that one is a replica of Finance's own quote book — fixed
 * columns A–O, their widths, their fills, a drawing part and the wordmark PNG. It writes ONE
 * document. This writes a TABLE: arbitrary columns, typed cells, a frozen filterable header, and
 * as many sheets as you hand it. The two want different things from the same file format, so they
 * are two writers rather than one with a mode flag.
 *
 * An .xlsx is a ZIP of XML parts, so there is no library here either: build the parts, CRC32 each
 * one, and lay them out as a STORE-method (uncompressed) ZIP with correct local + central
 * directory headers.
 *
 * TYPES ARE THE POINT. A CSV hands Excel a wall of text and lets it guess — which is how "0.5"
 * becomes a date and a market code like "DE" survives but "1-2" does not. Every cell here is
 * written as a number, a date serial or an inline string, declared, so a column of hours sums and
 * a column of dates sorts without anyone retyping it.
 *
 * Sheet: { name, cols:[{k, l, t, w}], rows:[object], note }
 *   t: 'text' (default) | 'num' | 'hours' | 'int' | 'pct' | 'date' | 'money'
 *   A null/undefined/'' value writes an EMPTY cell, never a zero — "not recorded" and "none" are
 *   different facts and a spreadsheet that blurs them produces wrong averages.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedXlsx = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function xesc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      // control characters are illegal in XML and Excel refuses the whole file over one
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/\r?\n/g, '&#10;');
  }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }

  // Excel's epoch is 1899-12-30 (its 1900 leap-year bug baked in). A date we cannot parse is left
  // BLANK rather than written as 1970 — a wrong date reads as data, an empty cell reads as absent.
  function serial(v) {
    if (v == null || v === '' || noDate(v)) return null;
    var d = (v instanceof Date) ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) + 'T00:00:00Z' : v);
    if (!d || isNaN(d.getTime())) return null;
    var days = d.getTime() / 86400000 + 25569;
    return Math.round(days * 100000) / 100000;
  }

  // The reports database spells "no date" as 0000-00-00. That is ABSENCE, not an unparseable
  // date, and the two get opposite treatment below: absence writes no cell at all, while a date
  // we simply cannot read is kept as text rather than silently discarded. taskbook's isoOf
  // already folds the sentinel to '' upstream, so it should never arrive — but a date column
  // that turns into a text column the moment one does is not worth the line it saves.
  function noDate(v) { return /^0{4}[-/]?0{1,2}[-/]?0{1,2}$/.test(String(v == null ? '' : v).trim()); }

  var NUMFMT = { hours: '#,##0.00', num: '#,##0.00', int: '#,##0', pct: '0.0%', date: 'dd/mm/yyyy', money: '"£"#,##0.00' };

  function styles(kinds) {
    var nf = [], xf = [], HEAD = 0;
    kinds.forEach(function (k) { var f = NUMFMT[k]; if (f && nf.indexOf(f) < 0) nf.push(f); });
    // 0 body text · 1 header · then one per number format
    xf.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    xf.push('<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>');
    var map = {};
    nf.forEach(function (f, i) { map[f] = xf.length; xf.push('<xf numFmtId="' + (164 + i) + '" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'); });
    return {
      head: 1, body: 0,
      of: function (kind) { var f = NUMFMT[kind]; return f ? map[f] : 0; },
      xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + (nf.length ? ('<numFmts count="' + nf.length + '">' + nf.map(function (f, i) { return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + xesc(f) + '"/>'; }).join('') + '</numFmts>') : '')
        + '<fonts count="2">'
        + '<font><sz val="11"/><color rgb="FF333333"/><name val="Calibri"/><family val="2"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>'
        + '</fonts>'
        + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FF1A365D"/><bgColor indexed="64"/></patternFill></fill></fills>'
        + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
        + '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE6E6E6"/></bottom><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="' + xf.length + '">' + xf.join('') + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2"/></styleSheet>'
    };
  }

  function sheetXml(sh, st) {
    var cols = sh.cols || [], rows = sh.rows || [], out = [], i, j;
    var head = '<row r="1" ht="20" customHeight="1">' + cols.map(function (c, j2) {
      return '<c r="' + colName(j2) + '1" s="' + st.head + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(c.l || c.k) + '</t></is></c>';
    }).join('') + '</row>';
    out.push(head);
    for (i = 0; i < rows.length; i++) {
      var r = rows[i], rn = i + 2, body = '';
      for (j = 0; j < cols.length; j++) {
        var c = cols[j], v = r[c.k], ref = colName(j) + rn, kind = c.t || 'text';
        if (v == null || v === '') continue;                       // absent stays absent
        if (kind === 'date') {
          if (noDate(v)) continue;                                 // absence, not a date we failed to read
          var sv = serial(v);
          if (sv == null) { body += '<c r="' + ref + '" t="inlineStr"><is><t>' + xesc(v) + '</t></is></c>'; continue; }
          body += '<c r="' + ref + '" s="' + st.of('date') + '"><v>' + sv + '</v></c>'; continue;
        }
        if (kind !== 'text') {
          var n = Number(v);
          if (!isFinite(n)) { body += '<c r="' + ref + '" t="inlineStr"><is><t>' + xesc(v) + '</t></is></c>'; continue; }
          body += '<c r="' + ref + '" s="' + st.of(kind) + '"><v>' + n + '</v></c>'; continue;
        }
        body += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>';
      }
      out.push('<row r="' + rn + '">' + body + '</row>');
    }
    var last = colName(Math.max(0, cols.length - 1)), n = rows.length + 1;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<dimension ref="A1:' + last + n + '"/>'
      // the header stays put while you scroll, and every column filters — this is a table people
      // will sort and pivot, not a document they will read top to bottom
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + '<sheetFormatPr defaultRowHeight="15"/>'
      + (cols.length ? ('<cols>' + cols.map(function (c, j2) {
          return '<col min="' + (j2 + 1) + '" max="' + (j2 + 1) + '" width="' + (c.w || 14) + '" customWidth="1"/>'; }).join('') + '</cols>') : '')
      + '<sheetData>' + out.join('') + '</sheetData>'
      + (rows.length ? ('<autoFilter ref="A1:' + last + n + '"/>') : '')
      + '</worksheet>';
  }

  // Excel rejects a sheet name over 31 chars or carrying : \ / ? * [ ] — silently, by refusing the
  // whole workbook, so the name is sanitised here rather than trusted from the caller.
  function safeName(s, i) {
    var n = String(s || ('Sheet' + (i + 1))).replace(/[:\\\/?*\[\]]/g, ' ').trim().slice(0, 31);
    return n || ('Sheet' + (i + 1));
  }

  function build(sheets) {
    sheets = (sheets || []).filter(Boolean);
    if (!sheets.length) sheets = [{ name: 'Sheet1', cols: [], rows: [] }];
    var kinds = [];
    sheets.forEach(function (s) { (s.cols || []).forEach(function (c) { if (c.t && kinds.indexOf(c.t) < 0) kinds.push(c.t); }); });
    var st = styles(kinds);
    var names = sheets.map(function (s, i) { return safeName(s.name, i); });
    var files = [
      { n: '[Content_Types].xml', s: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('')
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '</Types>' },
      { n: '_rels/.rels', s: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { n: 'xl/workbook.xml', s: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets>' + names.map(function (n, i) { return '<sheet name="' + xesc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('')
        + '</sheets></workbook>' },
      { n: 'xl/_rels/workbook.xml.rels', s: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('')
        + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '</Relationships>' },
      { n: 'xl/styles.xml', s: st.xml }
    ];
    sheets.forEach(function (s, i) { files.push({ n: 'xl/worksheets/sheet' + (i + 1) + '.xml', s: sheetXml(s, st) }); });
    return zipStore(files.map(function (f) { return { name: f.n, data: utf8(f.s) }; }));
  }

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var a = unescape(encodeURIComponent(s)), u = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) u[i] = a.charCodeAt(i);
    return u;
  }
  var CRCT = null;
  function crc32(u) {
    if (!CRCT) { CRCT = new Int32Array(256);
      for (var i = 0; i < 256; i++) { var c = i; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRCT[i] = c; } }
    var crc = -1;
    for (var j = 0; j < u.length; j++) crc = (crc >>> 8) ^ CRCT[(crc ^ u[j]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }
  function zipStore(files) {
    var parts = [], central = [], off = 0;
    function n2(v) { return [v & 255, (v >>> 8) & 255]; }
    function n4(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var nm = utf8(f.name), da = f.data, c = crc32(da);
      var h = [].concat([80, 75, 3, 4], n2(20), n2(0), n2(0), n2(0), n2(0), n4(c), n4(da.length), n4(da.length), n2(nm.length), n2(0));
      parts.push(new Uint8Array(h), nm, da);
      central.push({ nm: nm, c: c, len: da.length, off: off });
      off += h.length + nm.length + da.length;
    });
    var cd = [], cdLen = 0;
    central.forEach(function (e) {
      var h = [].concat([80, 75, 1, 2], n2(20), n2(20), n2(0), n2(0), n2(0), n2(0), n4(e.c), n4(e.len), n4(e.len),
        n2(e.nm.length), n2(0), n2(0), n2(0), n2(0), n4(0), n4(e.off));
      cd.push(new Uint8Array(h), e.nm); cdLen += h.length + e.nm.length;
    });
    var end = new Uint8Array([].concat([80, 75, 5, 6], n2(0), n2(0), n2(central.length), n2(central.length), n4(cdLen), n4(off), n2(0)));
    var all = parts.concat(cd, [end]), total = all.reduce(function (a, x) { return a + x.length; }, 0);
    var out = new Uint8Array(total), p = 0;
    all.forEach(function (x) { out.set(x, p); p += x.length; });
    return out;
  }

  function download(sheets, filename) {
    var bytes = build(sheets);
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = /\.xlsx$/i.test(filename || '') ? filename : ((filename || 'export') + '.xlsx');
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    return bytes.length;
  }

  /* ---------------------------------------------------------------------------------------------
   * READING one back (Ray, 17 Sep 2026: "using Excel that I can import and export").
   *
   * An export nobody can send back is half a round trip, so this reads the same shape it writes.
   * No library: a .xlsx is a ZIP, and the browser can inflate a raw deflate stream itself
   * (DecompressionStream 'deflate-raw'), so unzip the two parts that matter — the shared string
   * table and the first worksheet — and read the cells.
   *
   * CSV IS READ TOO, and is the format the button offers first. Excel writes it natively, it
   * survives being emailed and pasted, and it cannot carry a macro. The .xlsx path exists because
   * Ray will have the file open in Excel and "Save As CSV" is one more step to forget.
   * ------------------------------------------------------------------------------------------ */

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  /** Entries of a ZIP, read from its CENTRAL DIRECTORY rather than by scanning for local headers —
   *  a local header may declare sizes of 0 and defer them to a data descriptor, which is exactly
   *  what several writers do, and scanning would then read the wrong number of bytes. */
  function zipEntries(buf) {
    var b = new Uint8Array(buf), i, eocd = -1;
    for (i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
      if (b[i] === 80 && b[i + 1] === 75 && b[i + 2] === 5 && b[i + 3] === 6) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    var n = u16(b, eocd + 10), off = u32(b, eocd + 16), out = [], p = off;
    for (i = 0; i < n; i++) {
      if (b[p] !== 80 || b[p + 1] !== 75 || b[p + 2] !== 1 || b[p + 3] !== 2) break;
      var method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24);
      var nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32), lho = u32(b, p + 42);
      var name = '';
      for (var j = 0; j < nlen; j++) name += String.fromCharCode(b[p + 46 + j]);
      var lnlen = u16(b, lho + 26), lelen = u16(b, lho + 28);
      out.push({ name: name, method: method, csize: csize, usize: usize, at: lho + 30 + lnlen + lelen });
      p += 46 + nlen + elen + clen;
    }
    return { bytes: b, entries: out };
  }

  function inflateRaw(slice) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('this browser cannot unzip .xlsx — save the file as CSV and import that'));
    var ds = new DecompressionStream('deflate-raw');
    return new Response(new Blob([slice]).stream().pipeThrough(ds)).arrayBuffer();
  }

  function partText(z, name) {
    var e = null;
    for (var i = 0; i < z.entries.length; i++) if (z.entries[i].name === name) { e = z.entries[i]; break; }
    if (!e) return Promise.resolve('');
    var slice = z.bytes.subarray(e.at, e.at + (e.method === 0 ? e.usize : e.csize));
    var dec = function (ab) { return new TextDecoder('utf-8').decode(ab); };
    if (e.method === 0) return Promise.resolve(dec(slice));
    return inflateRaw(slice).then(dec);
  }

  function unesc(x) {
    return String(x).replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  // <si> can be one <t> or several <r><t> runs; joining the runs is the difference between
  // reading "Urgent" and reading "Urg" when Excel has split a cell's formatting mid-word
  function sharedStrings(xml) {
    var out = [], re = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      var txt = '', tre = /<t[^>]*>([\s\S]*?)<\/t>/g, t;
      while ((t = tre.exec(m[1]))) txt += unesc(t[1]);
      out.push(txt);
    }
    return out;
  }

  function colOf(ref) {
    var c = 0, i;
    for (i = 0; i < ref.length; i++) {
      var ch = ref.charCodeAt(i);
      if (ch < 65 || ch > 90) break;
      c = c * 26 + (ch - 64);
    }
    return c - 1;
  }

  function sheetRows(xml, ss) {
    var rows = [], rre = /<row\b[^>]*>([\s\S]*?)<\/row>/g, rm;
    while ((rm = rre.exec(xml))) {
      var cells = [], cre = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      while ((cm = cre.exec(rm[1]))) {
        var attr = cm[1] || '', body = cm[2] || '';
        var ref = (attr.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
        var ty = (attr.match(/t="([^"]+)"/) || [])[1] || 'n';
        var v = '';
        if (ty === 'inlineStr') { var im = body.match(/<t[^>]*>([\s\S]*?)<\/t>/); v = im ? unesc(im[1]) : ''; }
        else {
          var vm = body.match(/<v>([\s\S]*?)<\/v>/);
          v = vm ? unesc(vm[1]) : '';
          if (ty === 's') v = ss[Number(v)] != null ? ss[Number(v)] : '';
        }
        var at = ref ? colOf(ref) : cells.length;
        while (cells.length < at) cells.push('');
        cells[at] = v;
      }
      rows.push(cells);
    }
    return rows;
  }

  /** .xlsx bytes -> array of row arrays (first worksheet). */
  function readXlsx(buf) {
    var z;
    try { z = zipEntries(buf); } catch (e) { return Promise.reject(e); }
    return partText(z, 'xl/sharedStrings.xml').then(function (ssXml) {
      var ss = ssXml ? sharedStrings(ssXml) : [];
      return partText(z, 'xl/worksheets/sheet1.xml').then(function (sh) {
        if (!sh) throw new Error('no worksheet found in that file');
        return sheetRows(sh, ss);
      });
    });
  }

  /** CSV text -> array of row arrays. Quotes, doubled quotes and embedded newlines all honoured. */
  function readCsv(text) {
    var s = String(text || '').replace(/^\ufeff/, ''), rows = [], row = [], cur = '', q = false, i;
    for (i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (q) {
        if (c === '"') { if (s.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') { /* CRLF — the \n does the work */ }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /** One File (.xlsx or .csv) -> rows. The extension decides; the content is not sniffed. */
  function readFile(file) {
    var name = String((file && file.name) || '');
    if (/\.xlsx$/i.test(name)) return file.arrayBuffer().then(readXlsx);
    return file.text().then(readCsv);
  }

  /**
   * Rows -> objects, keyed by the HEADER TEXT, matched case- and space-insensitively.
   * The header may sit below a title row, so the first row carrying every required label wins.
   */
  function table(rows, required) {
    var need = (required || []).map(function (x) { return String(x).toLowerCase().replace(/\s+/g, ''); });
    var norm = function (x) { return String(x == null ? '' : x).toLowerCase().replace(/\s+/g, ''); };
    var hi = -1, i, j;
    for (i = 0; i < Math.min(rows.length, 25); i++) {
      var have = (rows[i] || []).map(norm);
      var ok = need.every(function (n) { return have.indexOf(n) >= 0; });
      if (ok) { hi = i; break; }
    }
    if (hi < 0) return { header: -1, cols: [], rows: [] };
    var head = (rows[hi] || []).map(function (x) { return String(x == null ? '' : x).trim(); });
    var out = [];
    for (i = hi + 1; i < rows.length; i++) {
      var r = rows[i] || {}, o = {}, any = false;
      for (j = 0; j < head.length; j++) {
        if (!head[j]) continue;
        var v = (rows[i] || [])[j];
        o[head[j]] = v == null ? '' : String(v);
        if (o[head[j]] !== '') any = true;
      }
      if (any) out.push(o);
    }
    return { header: hi, cols: head, rows: out };
  }

  return { build: build, download: download, serial: serial, noDate: noDate, colName: colName, safeName: safeName, xesc: xesc,
    readXlsx: readXlsx, readCsv: readCsv, readFile: readFile, table: table, zipEntries: zipEntries, sharedStrings: sharedStrings, sheetRows: sheetRows };
}));
