// FIELD BREAKDOWN harness (pure node, CI-safe). Ray, 15 Oct 2026: "build another module that similar to custom
// label and PT — basically having the ability to breakdown in pivot table like this for any fields is super helpful
// … a custom 'breakdown' fields module to breakdown in pivot with any fields in any feeds".
//
// Pins the browser engine (docs/breakdown_engine.js) on a SYNTHETIC feed shaped like the real ones, pushed through
// the REAL Feed Lab XML and CSV parsers: the column store (a header that grows mid-stream, a header row never counted
// as a product), what a field reads as, every reading (raw, tier, list, length bands, number bands, all slots), the
// blank as a value, a product counted once in each of several values, item-group counting, filters (AND across, OR
// within), the cross-tab with its Other column, saved-spec resolution across feeds, CSV; then the route, the
// registries, the nav on every page, the stub + gate wiring; and that nothing of a client's is committed.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MODULES, MODULE_PATHS, moduleAllowed } from '../cloudflare/feedspark-deck/src/access.js';
import { MIG_SEED } from '../cloudflare/feedspark-deck/src/migration.js';
const require = createRequire(import.meta.url);
const B = require('../docs/breakdown_engine.js');
const FA = require('../docs/feedlab_engine.js');
const { covered } = require('./check_textmodules.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), PG = read('docs/FeedSpark_Breakdown.html'), TX = read('docs/FeedSpark_Transformation.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + (typeof why === 'string' ? why : JSON.stringify(why)) : '')); } };
const P = (st, spec, m, o) => { const r = B.pivot(st, spec, m, o); const o2 = {}; r.rows.forEach((x) => { o2[x.v] = x.n; }); return Object.assign(r, { map: o2 }); };

// ---- fixtures: a FeedHero-shaped output feed, as the Feed Lab parser hands it over --------------------------------
// the last item carries a tag no earlier item had (custom_label_3), so the parser's header GROWS mid-stream
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" xmlns:c="http://base.google.com/cns/1.0" version="2.0"><channel><title>fixture</title>
<item><g:id>A-1</g:id><title>Navy Linen Midi Dress</title><g:availability>in stock</g:availability><g:price>95.00 GBP</g:price><g:product_type>Womens &gt; Clothing &gt; Dresses &gt; Midi</g:product_type><g:product_type>linen dress</g:product_type><g:brand>Northwind</g:brand><g:color>Navy</g:color><g:item_group_id>A</g:item_group_id><g:product_highlight>Easy care</g:product_highlight><g:product_highlight>Lined</g:product_highlight><c:fs_data_opti type="string">T:Y|Cat:Y</c:fs_data_opti></item>
<item><g:id>A-2</g:id><title>Navy Linen Midi Dress, Size 12</title><g:availability>out of stock</g:availability><g:price>95.00 GBP</g:price><g:product_type>Womens &gt; Clothing &gt; Dresses &gt; Midi</g:product_type><g:brand>Northwind</g:brand><g:color>Navy</g:color><g:item_group_id>A</g:item_group_id><g:product_highlight>Easy care</g:product_highlight><c:fs_data_opti type="string">T:N|Cat:Y</c:fs_data_opti></item>
<item><g:id>B-1</g:id><title>Canvas Tote</title><g:availability>in stock</g:availability><g:price>8.50 GBP</g:price><g:product_type>Womens &gt; Accessories &gt; Bags</g:product_type><g:brand>Northwind</g:brand><g:item_group_id>B</g:item_group_id></item>
<item><g:id>C-1</g:id><title>Wool Scarf in a deep forest green with a very long title that runs past the seventy character mark easily</title><g:availability>in stock</g:availability><g:price>22.00 GBP</g:price><g:product_type>Womens &gt; Accessories &gt; Scarves</g:product_type><g:brand>Other Co</g:brand><g:color>Green</g:color><g:custom_label_3>Clearance</g:custom_label_3></item>
</channel></rss>`;
function storeOf(xml) {
  const st = B.createStore(); let hdr = null;
  const p = FA.createXmlParser((row, h) => { if (!hdr) { hdr = h || row; return; } B.addRow(st, row, h || hdr); });
  p.push(xml); p.end(); return st;
}
const S = storeOf(XML);

console.log('· the store — one feed, column by column');
t('every product is in it, the header never counted as one', S.n === 4, S.n);
t('a column the parser met late (custom_label_3) reads blank on the earlier products, its value on the last', (() => { const c = S.cols[S.byName['g:custom_label_3']]; return c && c.ids[0] === 0 && c.ids[1] === 0 && c.ids[2] === 0 && c.vals[c.ids[3]] === 'Clearance'; })());
t('the parser\'s type stamp is not part of a column name', S.byName['c:fs_data_opti'] != null && !Object.keys(S.byName).some((k) => /type=/.test(k)));
t('a value is cleaned as a person reads it: entities decoded, tags and runs of space gone', B.clean(' a &amp; <b>b</b>\n  c ') === 'a & b c' && B.clean(['x', 'y']) === 'x | y');
t('a value is kept to its first ' + B.MAXLEN + ' characters', B.clean('x'.repeat(900)).length === B.MAXLEN);
{
  const s = B.createStore(), h = ['id', 'v']; for (let i = 0; i < 3000; i++) B.addRow(s, ['i' + i, i % 2 ? 'odd' : 'even'], h);
  const r = P(s, { f: 'v' });
  t('the store grows past its first capacity and every product is still counted', r.total === 3000 && r.map.odd === 1500 && r.map.even === 1500, r.map);
}
{
  // a sheet feed, through the Feed Lab CSV parser
  const st = B.createStore(); let hdr = null;
  const p = FA.createParser((row, h) => { if (!hdr) { hdr = h || row; return; } B.addRow(st, row, h || hdr); });
  p.push('id,brand,product type\r\n1,Acme,"Home > Kitchen"\r\n2,Acme,\r\n3,,Home > Garden\r\n'); p.end();
  const r = P(st, { f: 'brand' });
  t('a sheet feed reads the same way (the CSV parser, its own column names)', st.n === 3 && r.map.Acme === 2 && r.map[B.BLANK] === 1, [st.n, r.map]);
}

console.log('· what a field reads as — off its values, never its name');
const F = B.fields(S), fo = (f) => F.find((x) => x.f === f);
t('a category path is a path', fo('g:product_type').kind === 'path');
t('a price is a number', fo('g:price').kind === 'number');
t('a list of codes is a list', fo('c:fs_data_opti').kind === 'list');
t('fill is products carrying a value over every product', Math.abs(fo('g:color').fill - 0.75) < 1e-9 && fo('g:color').filled === 3);
t('a repeated tag becomes ONE "all slots" field, marked multi', (() => { const f = fo('g:product_highlight*'); return f && f.multi && f.slots === 2 && f.filled === 2 && /all slots/.test(f.label); })());
t('…the product_type slots too (tree + keywords), and it reads as a path', fo('g:product_type*') && fo('g:product_type*').kind === 'path');
t('readings by kind: a path can be cut to a tier, a number banded, free text banded by length, a list split', B.modesFor('path').includes('tier') && B.modesFor('number').includes('num') && B.modesFor('text').includes('len') && B.modesFor('list').includes('list') && !B.modesFor('url').includes('tier'));
t('labels read as a person says them: no namespace, the slot in brackets', B.labelOf('g:product_type(3)') === 'product_type (3)' && B.labelOf('c:fs_data_opti') === 'fs_data_opti');

console.log('· every reading');
let r = P(S, { f: 'g:product_type', m: 'tier', k: 2 });
t('product_type to tier 2 — the path cut, the counts summed', r.map['Womens > Clothing'] === 2 && r.map['Womens > Accessories'] === 2 && r.rows.length === 2, r.map);
r = P(S, { f: 'g:product_type', m: 'tier', k: 9 });
t('a tier past the path\'s depth reads the whole path', r.map['Womens > Clothing > Dresses > Midi'] === 2);
t('the tier picker\'s ceiling is the deepest path', B.maxTier(S, 'g:product_type') === 4);
r = P(S, { f: 'g:color' });
t('a blank is a VALUE, counted and shown', r.map[B.BLANK] === 1 && r.blank === 1 && r.distinct === 2, r);
t('…and sits last whatever its count', r.rows[r.rows.length - 1].v === B.BLANK);
t('shares are of the products read', Math.abs(r.rows[0].share - 0.5) < 1e-9);
r = P(S, { f: 'g:product_highlight*' });
t('all slots: a product is counted once in EACH value it carries', r.map['Easy care'] === 2 && r.map.Lined === 1 && r.map[B.BLANK] === 2, r.map);
t('…and the result says so (multi), with how many products carry several', r.multi === true && r.multiRows === 1);
r = P(S, { f: 'c:fs_data_opti', m: 'list' });
t('a list split apart: T:Y / T:N / Cat:Y each counted', r.map['T:Y'] === 1 && r.map['T:N'] === 1 && r.map['Cat:Y'] === 2 && r.multi, r.map);
t('a list splits on |||, |, ; and ", " — never on a comma inside a value', JSON.stringify(B.splitList('a|||b|||a')) === '["a","b"]' && JSON.stringify(B.splitList('a | b; c, d')) === '["a","b","c","d"]' && JSON.stringify(B.splitList('1,000')) === '["1,000"]');
r = P(S, { f: 'g:price', m: 'num' });
t('number bands on the edges ' + B.NUM_EDGES.join('/'), r.map['0–10'] === 1 && r.map['10–25'] === 1 && r.map['50–100'] === 2, r.map);
t('…in number order, not count order', r.rows.map((x) => x.v).join() === '0–10,10–25,50–100', r.rows.map((x) => x.v));
t('a value with no number is said, never banded as 0', B.numBand(NaN) === 'not a number' && B.numBand(1500) === '1000+' && B.numBand(-1) === 'below 0');
r = P(S, { f: 'title', m: 'len' });
t('length bands, in their own order', r.map['1–30 characters'] === 3 && r.map['71–150 characters'] === 1 && r.rows[0].v === '1–30 characters', r.map);
r = P(S, { f: 'g:color' }, null, { unit: 'group' });
t('Styles: each item group once — A\'s two sizes are one Navy style; a product with no group is its own', r.map.Navy === 1 && r.map.Green === 1 && r.total === 3, r);
t('…a feed with no item_group_id cannot count styles and says so (unit falls back)', (() => { const s = B.createStore(); B.addRow(s, ['1', 'x'], ['id', 'v']); return B.groupCol(s) < 0 && B.pivot(s, { f: 'v' }, null, { unit: 'group' }).unit === 'sku'; })());
t('an unknown field reads as nothing, never as an empty table', B.pivot(S, { f: 'g:nope' }) === null && B.reader(S, null) === null);

console.log('· sort');
r = B.pivot(S, { f: 'g:color' });
B.sortRows(r.rows, 'v', 1);
t('A→Z with the blank still last', r.rows.map((x) => x.v).join() === 'Green,Navy,' + B.BLANK);
B.sortRows(r.rows, 'n', 1);
t('smallest first with the blank still last', r.rows[r.rows.length - 1].v === B.BLANK && r.rows[0].n <= r.rows[1].n);

console.log('· filters: AND across fields, OR within one');
let m = B.mask(S, [{ spec: { f: 'g:availability' }, vals: ['in stock'] }]);
t('one value', B.passing(m) === 3);
m = B.mask(S, [{ spec: { f: 'g:availability' }, vals: ['in stock'] }, { spec: { f: 'g:color' }, vals: ['Navy', 'Green'] }]);
t('AND across fields, OR within one', B.passing(m) === 2 && m[0] && m[3] && !m[1] && !m[2]);
m = B.mask(S, [{ spec: { f: 'g:color' }, vals: [B.BLANK] }]);
t('(blank) filters to the products with nothing in the field', B.passing(m) === 1 && m[2] === 1);
m = B.mask(S, [{ spec: { f: 'g:product_type', m: 'tier', k: 2 }, vals: ['Womens > Accessories'] }]);
t('a filter on a READING (tier 2) filters on that reading', B.passing(m) === 2 && m[2] && m[3]);
r = P(S, { f: 'g:brand' }, m);
t('a table read through a mask counts only those products', r.total === 2 && r.map.Northwind === 1 && r.map['Other Co'] === 1);
t('an empty filter list passes everything', B.passing(B.mask(S, [])) === 4);

console.log('· the cross-tab');
let X = B.cross(S, { f: 'g:product_type', m: 'tier', k: 2 }, { f: 'g:availability' });
const cell = (rv, cv) => { const row = X.rows.find((x) => x.v === rv), j = X.cols.findIndex((c) => c.v === cv); return row && j >= 0 ? row.cells[j] : null; };
t('every cell is the products carrying both', cell('Womens > Clothing', 'in stock') === 1 && cell('Womens > Clothing', 'out of stock') === 1 && cell('Womens > Accessories', 'in stock') === 2 && cell('Womens > Accessories', 'out of stock') === 0, X);
t('row and column totals add up to the products read', X.total === 4 && X.rows.reduce((s, x) => s + x.n, 0) === 4 && X.cols.reduce((s, x) => s + x.n, 0) === 4);
X = B.cross(S, { f: 'g:brand' }, { f: 'g:id' }, null, { maxC: 2 });
t('columns past maxC fold into ONE Other column that keeps its count and names its members', X.cols.length === 3 && X.cols[2].other && X.cols[2].n === 2 && X.cols[2].members.length === 2 && X.rows.every((row) => row.cells.reduce((a, b) => a + b, 0) === row.n), X.cols);
X = B.cross(S, { f: 'g:brand' }, { f: 'g:id' }, null, { maxC: 0, maxR: 0 });
t('maxC 0 / maxR 0 = every column and every row, no Other fold (the pivot CSV reads this)', X.cols.length === 4 && !X.cols.some((c) => c.other) && X.rowsHidden === 0, X.cols);
X = B.cross(S, { f: 'g:id' }, { f: 'g:brand' }, null, { maxR: 2 });
t('rows past maxR are cut and counted (rowsHidden), never dropped silently', X.rows.length === 2 && X.rowsAll === 4 && X.rowsHidden === 2);
X = B.cross(S, { f: 'g:product_highlight*' }, { f: 'g:brand' });
t('a multi-valued side is flagged, so the page can say rows add to more than the total', X.multi === true);

console.log('· the defaults, saved specs across feeds, CSV');
const D = B.defaultPanes(S, 4);
t('a fresh device opens on product_type to tier 2, then the fields a feed person reaches for, those this feed carries', D[0].f === 'g:product_type' && D[0].m === 'tier' && D[0].k === 2 && D.map((d) => d.f).join() === 'g:product_type,g:brand,g:availability,g:color', D);
{
  const s = B.createStore(); B.addRow(s, ['1', 'Acme', 'x'], ['id', 'brand', 'g:product_highlight']); B.addRow(s, ['2', 'Acme', 'y'], ['id', 'brand', 'g:product_highlight(2)']);
  t('a saved spec meets a feed that names the field another way (g:brand ↔ brand)', JSON.stringify(B.resolve(s, { f: 'g:brand', m: 'raw' })) === JSON.stringify({ f: 'brand', m: 'raw', k: undefined }));
  t('…an "all slots" spec too', B.resolve(s, { f: 'product_highlight*' }).f === 'g:product_highlight*');
  t('…and a field the feed does not carry resolves to nothing (the pane says so)', B.resolve(s, { f: 'g:custom_label_4' }) === null);
}
t('CSV quotes a comma, a quote and a line break', B.csv([['a,b', 'say "hi"', 'x\ny']]) === '"a,b","say ""hi""","x\ny"\r\n');
t('a spec reads in words for a chip or a CSV', B.specName(S, { f: 'g:product_type', m: 'tier', k: 2 }) === 'product_type · tier 2' && B.specName(S, { f: 'g:product_highlight*' }) === 'product_highlight · all slots');

console.log('· newness by quarter (Ray, 19 Oct 2026: "just do it based on quarter, from the latest quarter to the previous quarter")');
{
  const st = B.createStore(), h = ['id', 'c:fs_date_of_birth', 'g:availability'];
  const rows = [['1', '2026-10-02', 'in stock'], ['2', '2026-08-15T10:00:00', 'in stock'], ['3', '2026-07-01', 'out of stock'], ['4', '2026-04-30', 'in stock'],
    ['5', '2024-12-31', 'in stock'], ['6', '2019-01-01', 'in stock'], ['7', 'soon', 'in stock'], ['8', '', 'in stock'], ['9', '15/05/2026', 'in stock'], ['10', '2027-01-04', 'in stock']];
  rows.forEach((r) => B.addRow(st, r, h));
  st.now = Date.UTC(2026, 9, 19);
  const f = B.fields(st).find((x) => x.f === 'c:fs_date_of_birth');
  t('a column of dates reads as a date, and offers newness by quarter', f && f.kind === 'date' && B.modesFor('date').join() === 'raw,qtr' && B.MODE_LBL.qtr === 'Newness by quarter', f && f.kind);
  t('…a date as either shape a feed writes (ISO with or without a time, DD/MM/YYYY); anything else is not one', B.dateOf('2026-08-15T10:00:00').m === 8 && B.dateOf('15/05/2026').m === 5 && B.dateOf('2026-13-01') === null && B.dateOf('soon') === null);
  const r = P(st, { f: 'c:fs_date_of_birth', m: 'qtr' });
  t('the quarter we are in, then the one before, by the calendar — a timestamp and a UK date land in theirs', r.map['Q4 2026'] === 1 && r.map['Q3 2026'] === 2 && r.map['Q2 2026'] === 2, r.map);
  t('…' + B.QTR_BACK + ' quarters back, the rest folded into ONE "Before …" band', r.map['Q4 2024'] === undefined && r.map['Before Q1 2025'] === 2, r.map);
  t('…an unreadable date is named, a blank stays blank, a future date is never called this quarter', r.map[B.NO_DATE] === 1 && r.map[B.BLANK] === 1 && r.map['Q1 2027'] === 1, r.map);
  t('…read newest first, never by count: this quarter leads, Before … then the unreadable, the blank last', r.rows.map((x) => x.v).join('|') === ['Q1 2027', 'Q4 2026', 'Q3 2026', 'Q2 2026', 'Q1 2026', 'Q4 2025', 'Q3 2025', 'Q2 2025', 'Q1 2025', 'Before Q1 2025', B.NO_DATE, B.BLANK].join('|'), r.rows.map((x) => x.v));
  t('…a quarter nothing arrived in is a ZERO on an unbroken ladder, never a missing row (and not a value in the count)', r.map['Q1 2026'] === 0 && r.map['Q1 2025'] === 0 && r.distinct === 6, [r.map, r.distinct]);
  {
    const s2 = B.createStore(); B.addRow(s2, ['1', '2026-05-01'], ['id', 'd']); B.addRow(s2, ['2', '2026-05-09'], ['id', 'd']); s2.now = Date.UTC(2026, 9, 19);
    const r2 = P(s2, { f: 'd', m: 'qtr' });
    t('…an empty LATEST quarter still leads the ladder (the quarter we are in, read as 0), and it stops at the oldest one the counts reach', r2.rows.map((x) => x.v + '=' + x.n).join('|') === 'Q4 2026=0|Q3 2026=0|Q2 2026=2', r2.rows.map((x) => x.v + '=' + x.n));
  }
  const x = B.cross(st, { f: 'c:fs_date_of_birth', m: 'qtr' }, { f: 'g:availability' }, null, {}), y = B.cross(st, { f: 'g:availability' }, { f: 'c:fs_date_of_birth', m: 'qtr' }, null, {});
  t('…on the pivot\'s rows AND its columns, in the same order', x.rows[1].v === 'Q4 2026' && y.cols[1].v === 'Q4 2026' && x.rows.map((q) => q.v).join() === y.cols.map((q) => q.v).join(), [x.rows.map((q) => q.v), y.cols.map((q) => q.v)]);
  st.now = Date.UTC(2027, 0, 5);
  t('…the bands move with the calendar (the cached reading is per quarter, never a stale one)', P(st, { f: 'c:fs_date_of_birth', m: 'qtr' }).map['Q1 2027'] === 1);
  t('…the name says how it is read', B.specName(st, { f: 'c:fs_date_of_birth', m: 'qtr' }) === 'fs_date_of_birth · newness by quarter', B.specName(st, { f: 'c:fs_date_of_birth', m: 'qtr' }));
  t('the page: a picked date opens on its quarters, newness leads every field picker, one default for panes and both pivot sides', /function defSpec\(f\)/.test(PG) && /mt\.kind === 'date' \? 'qtr'/.test(PG) && /<optgroup label="Newness · by quarter">/.test(PG) && /\$\('#pv-r'\)[^\n]*sp = defSpec\(sp\.f\)/.test(PG) && /\$\('#pv-c'\)[^\n]*sp = defSpec\(sp\.f\)/.test(PG) && /S\.L\.panes\.push\(defSpec\(f\)\)/.test(PG));
}

console.log('· Google Ads in the breakdown (Ray, 19 Oct 2026: "how much spend in the past 30 days each group of custom labels has received, in contrast with the total spend")');
{
  // the fixture's ids: A-1 A-2 B-1 C-1; the report carries them in upper case for some, plus an id the feed lacks
  const ADS = { 'a-1': [100, 10, 40, 2, 160], 'A-2': [50, 5, 20, 0, 0], 'C-1': [10, 1, 15, 1, 45], 'GONE-9': [7, 1, 9, 0, 0] };
  const J = B.adsJoin(S, ADS);
  t('the report joins by product id, case-blind, on the column carrying its ids', J.col === 'g:id' && J.used === 3 && J.ids === 4, [J.col, J.used, J.ids]);
  t('…spend on an id the feed does not carry is kept APART, never spread over the groups', J.out.cost === 9 && J.inFeed.cost === 75 && J.tot.cost === 84, [J.out, J.inFeed, J.tot]);
  t('…a product with no ads traffic carries 0, never a guess', J.f.cost[2] === 0 && J.f.cost[0] === 40, Array.from(J.f.cost));
  const w = (r) => J.f.cost[r], w2 = (r) => J.f.value[r];
  const P = B.pivot(S, { f: 'g:brand' }, null, { w, w2 }), pm = {}; P.rows.forEach((r) => { pm[r.v] = r; });
  t('a weighted breakdown SUMS spend per value, and still says how many products each carries', P.weighted && P.total === 75 && P.totalP === 4 && pm.Northwind.n === 60 && pm.Northwind.p === 3 && pm['Other Co'].n === 15 && pm['Other Co'].p === 1, P.rows);
  t('…sorted by the measure, not the count', P.rows[0].v === 'Northwind');
  t('…ROAS is a ratio of SUMS (value ÷ spend per group), never an average of ratios', pm.Northwind.n2 === 160 && P.total2 === 205 && Math.abs(pm.Northwind.n2 / pm.Northwind.n - 160 / 60) < 1e-9, [pm.Northwind, P.total2]);
  const X = B.cross(S, { f: 'g:availability' }, { f: 'g:brand' }, null, { w, w2 }), xr = {}; X.rows.forEach((r) => { xr[r.v] = r; });
  const ci = X.cols.findIndex((c) => c.v === 'Northwind');
  t('the cross-tab sums a cell, its row and its column the same way; products travel beside', X.total === 75 && X.totalP === 4 && xr['in stock'].n === 55 && xr['in stock'].p === 3 && xr['in stock'].cells[ci] === 40 && xr['in stock'].cells2[ci] === 160 && X.cols[ci].n === 60 && X.cols[ci].n2 === 160, [X.rows, X.cols]);
  t('…an unweighted read is exactly what it was', B.cross(S, { f: 'g:availability' }, { f: 'g:brand' }, null, {}).total === 4 && !B.cross(S, { f: 'g:availability' }, { f: 'g:brand' }, null, {}).weighted);
  t('…a weighted read never counts item groups (spend belongs to a product)', B.pivot(S, { f: 'g:brand' }, null, { w, unit: 'group' }).unit === 'sku');
  t('the worker serves the 30-day read on its own route, scoped, a Meta market reading its Google market\'s report', /path === '\/api\/breakdown\/ads'/.test(WK) && /gmkt = asked\.replace\(\/-fb\$\/i, ''\)/.test(WK) && /catAdsRead\(env, cmpid, !!url\.searchParams\.get\('fresh'\), RESTOCK\.RESTOCK_PERIOD\)/.test(WK.slice(WK.indexOf("'/api/breakdown/ads'"))) && /clientMatch\(acc\.clients, client\)/.test(WK.slice(WK.indexOf("'/api/breakdown/ads'"), WK.indexOf("'/api/breakdown/ads'") + 1200)));
  t('the page: a Measure picker (Products, then Google Ads · last 30 days), the share of products beside a sum, ROAS never a share, the out-of-feed spend named', /<select class="fld" id="pv-meas"[^>]*data-no-keep>/.test(PG) && /<optgroup label="Google Ads · last 30 days">/.test(PG) && />% of products</.test(PG) && /ROAS is a ratio — it is shown as itself, never as a share/.test(PG) && /no longer carries — in no row/.test(PG) && /fetch\('\/api\/breakdown\/ads'/.test(PG));
}

console.log('· the worker');
{
  t('the page and the engine imported, the page routed, the engine served', /import BREAKDOWN_PAGE from "\.\.\/\.\.\/\.\.\/docs\/FeedSpark_Breakdown\.html";/.test(WK) && /import BREAKDOWN_ENGINE_SRC from "\.\.\/\.\.\/\.\.\/docs\/breakdown_engine\.js";/.test(WK)
    && /'\/breakdown':\s+\{ html: BREAKDOWN_PAGE, slug: 'breakdown' \}/.test(WK) && /path === '\/breakdown\/engine\.js'[\s\S]{0,80}BREAKDOWN_ENGINE_SRC/.test(WK));
  t('the engine is a Text module (served verbatim, never bundled as ESM — the /images lesson)', covered('docs/breakdown_engine.js'));
  const i = WK.indexOf("path === '/api/breakdown/roster'"), route = WK.slice(i, i + 900);
  t('the roster is scoped per signin, Google AND Meta markets, the source kind named', i > 0 && /acc\.owner \|\| clientMatch\(acc\.clients, r\.client\)/.test(route) && /meta: \/-fb\$\/\.test\(r\.mkt\)/.test(route) && /kind: r\.src && r\.src\.xml \? 'xml' : 'sheet'/.test(route));
  t('the roster sits behind the identity gate (no public lane)', !/\/api\/breakdown/.test(read('cloudflare/feedspark-deck/src/security.js')));
}

console.log('· the registries, the nav');
{
  const mod = MODULES.find((x) => x.slug === 'breakdown');
  t('a grantable module, open to an unrestricted signin', mod && mod.path === '/breakdown' && MODULE_PATHS['/breakdown'] === 'breakdown' && moduleAllowed(null, 'breakdown'));
  const mig = MIG_SEED.find((x) => x.p === '/breakdown');
  t('on the migration board in wave 3 (it reads the feed proxy, not the scan lane), December', mig && mig.w === 3 && mig.m === '2026-12');
  t('the Transformation page carries the twin row and an assessment row', /\{p:'\/breakdown',n:'Field breakdown',w:3,m:'2026-12'/.test(TX) && /\{id:'breakdown',p:'\/breakdown',n:'Field breakdown',ben:/.test(TX));
  const pages = fs.readdirSync(new URL('../docs/', import.meta.url)).filter((f) => /^FeedSpark_.*\.html$/.test(f)).map((f) => read('docs/' + f)).filter((s) => s.indexOf('id="tb-modules"') >= 0);
  const after = pages.every((s) => /<a href="\/ptypes" class="tbm(?: on)?"[^>]*>[\s\S]*?<\/a><a href="\/breakdown" class="tbm(?: on)?"/.test(s));
  t('the nav carries /breakdown right after PT Guard on every nav-bearing page (' + pages.length + ')', pages.length >= 30 && after);
  t('the Breakdown page marks its own link .on and no other', (PG.match(/class="tbm on"/g) || []).length === 1 && /<a href="\/breakdown" class="tbm on"/.test(PG));
}

console.log('· the page');
{
  t('loads the shared stylesheet and the two engines by fetch (so the tripwires can hand them over)', /<link rel="stylesheet" href="\/design\/fcc\.css">/.test(PG) && /\['\/feedlab\/engine\.js', 'FeedAudit'\], \['\/breakdown\/engine\.js', 'FeedBreakdown'\]/.test(PG));
  t('the feed streams through the proxy and the parser\'s header row is never counted', /fetch\('\/api\/feed\/proxy' \+ mq\(\)/.test(PG) && /if \(!hdr\) \{ hdr = h \|\| row; return; \}/.test(PG));
  t('every section folds: a tile head per section, the device keeps the choice, a fresh device opens the first two', (PG.match(/<section class="card fs/g) || []).length === 4 && (PG.match(/<button class="fhd"/g) || []).length === 4
    && /var FOLD_DEF = \{ 'sec-panes': 1, 'sec-pivot': 1, 'sec-fields': 0, 'sec-how': 0 \};/.test(PG) && /fcc-bd-fold/.test(PG) && /\.card\.folded>:not\(\.fhd\)\{display:none!important\}/.test(PG));
  t('…⊕ Open all / ⊖ Fold all, and a #hash opens what it names', /id="openall"/.test(PG) && /id="foldall"/.test(PG) && /window\.addEventListener\('hashchange', hashOpen\)/.test(PG));
  t('a table is never filtered by its own selection', /function maskExcept\(spec\)/.test(PG) && /B\.pivot\(S\.st, spec, maskExcept\(spec\)/.test(PG));
  t('a view is the shape, never the brand: the layout per device, views per device, the filters reset with the feed', /put\('fcc-bd-layout', S\.L\)/.test(PG) && /fcc-bd-views/.test(PG) && /S\.st = null; S\.fields = \[\]; S\.filters = \[\];/.test(PG));
  t('every picker the page persists itself opts out of the keep widget (one writer per control)', /<select class="fld" id="brand" aria-label="Brand" data-no-keep>/.test(PG) && /data-mkt="' \+ esc\(m\.mkt\) \+ '" data-no-keep/.test(PG) && !/<select(?![^>]*data-no-keep)[^>]*class="fld[^"]*"[^>]*>/.test(PG.replace(/'[^']*<select[^']*'/g, '')));
  t('the state hook for the harness, the deep link, the per-device memory', /window\.__FCCBreakdown = \{ state: function \(\) \{ return S; \} \};/.test(PG) && /Q\.get\('brand'\)/.test(PG) && /fcc-bd-brand/.test(PG));
  t('a multi-valued table says its shares add to more than 100%', /counted in each value/.test(PG) && /can add to more than the total/.test(PG));
  t('the explainers collapse behind ⓘ (data-instr)', (PG.match(/data-instr/g) || []).length >= 2);
  {
    const gb = /var GUIDE = \[([\s\S]*?)\n  \];/.exec(PG);
    const rec = gb ? (gb[1].match(/\{ t: '/g) || []).length : 0;
    t('📖 Guidebook: a hover button in the hero, fifteen recipes in five groups, each with what to look for, the action and the KPI it moves', /id="gbtn"[^>]*aria-controls="gb"/.test(PG) && rec === 15 && gb && (gb[1].match(/ h: '/g) || []).length === 5 && (gb[1].match(/look: '/g) || []).length === 15 && (gb[1].match(/kpi: '/g) || []).length === 15, rec);
    t('…▶ Try it resolves every field through the engine and NAMES one the feed lacks, never sets a field that is not there', /function gbTry\(key\)/.test(PG) && /B\.resolve\(S\.st, gbSpec\(sp\)\)/.test(PG) && /does not carry/.test(PG));
    t('…the panel lives on <body> (the hero clips it and its animation would trap a fixed sheet), a tap\'s focus never opens it', /document\.body\.appendChild\(el\)/.test(PG) && /matches\(':focus-visible'\)/.test(PG));
    t('…it is a floating corner button, not a hero control, and the Feed Chat bubble is gone from the FCC', /<span class="gbw" id="gbw"><button class="gbfab" id="gbtn"/.test(PG) && /\.gbw\{position:fixed;right:18px;bottom:18px/.test(PG) && !/<header class="hero">[\s\S]*id="gbtn"[\s\S]*<\/header>/.test(PG) && !/feedchat_widget|FEEDCHATW/.test(read('cloudflare/feedspark-deck/src/worker.js')));
    t('…▶ Try it puts the field with MORE values on the rows (Ray, 16 Oct 2026), counted on the feed, a tie keeping the recipe\'s order', /var nr = gbCount\(rs\), nc = gbCount\(cs\); if \(nc > nr\)/.test(PG) && /function gbCount\(sp\) \{ var P = S\.st && B\.pivot\(S\.st, sp, null/.test(PG) && /rows and columns turned/.test(PG));
    t('…the guidebook names no client and no currency', gb && !/£|€|\$\d/.test(gb[1]) && !/Reiss|Schuh|Superdry|Monsoon|Accessorize|YuMOVE|Hobbycraft/i.test(gb[1]));
  }
  t('no literal </body> inside the script (the worker injects at the first one)', PG.indexOf('</body>') === PG.lastIndexOf('</body>'));
}

console.log('· the split — what each cell is made of');
{
  const it = (id, pt, av, price, sale, g) => '<item><g:id>' + id + '</g:id><g:product_type>' + pt + '</g:product_type><g:availability>' + av + '</g:availability>' + (price ? '<g:price>' + price + ' GBP</g:price>' : '') + (sale ? '<g:sale_price>' + sale + ' GBP</g:sale_price>' : '') + '<g:gender>' + g + '</g:gender><g:color>C' + id + '</g:color></item>';
  const X2 = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>' + it('A', 'Womens', 'in stock', '100.00', '60.00', 'female') + it('B', 'Womens', 'in stock', '50.00', '50.00', 'female') + it('C', 'Mens', 'out of stock', '30.00', '', 'male') + it('D', 'Mens', 'in stock', '', '', 'male') + '</channel></rss>';
  const S2 = storeOf(X2), SF = B.splitFields(S2), sfo = (f) => SF.find((x) => x.f === f);
  t('Price type is offered first, built from price and sale price (no feed carries it)', SF[0] && SF[0].f === B.PRICE_TYPE && SF[0].derived);
  t('a field of two or three values is offered; one of more values is not', !!sfo('g:availability') && !!sfo('g:gender') && !sfo('g:color') && !sfo('g:id'));
  const sp = B.split(S2, { f: 'g:product_type', m: 'raw' }, { f: 'g:availability', m: 'raw' }, B.PRICE_TYPE, null);
  const at = (a, v) => a[sp.vals.indexOf(v)] || 0;
  t('on sale = a sale price BELOW the price; equal is full price; no price at all is not stated', at(sp.tot, B.SALE) === 1 && at(sp.tot, B.FULL) === 2 && at(sp.tot, B.BLANK) === 1, sp);
  t('…the flag is "on sale" and the blank part sits last', sp.flag === B.SALE && sp.vals[sp.vals.length - 1] === B.BLANK);
  t('each row, column and cell is made of its own products — and adds to what it holds', at(sp.row.Womens, B.SALE) === 1 && at(sp.row.Womens, B.FULL) === 1 && at(sp.row.Mens, B.FULL) === 1 && at(sp.row.Mens, B.BLANK) === 1
    && at(sp.col['out of stock'], B.FULL) === 1 && at(sp.cell[B.splitKey('Mens', 'in stock')], B.BLANK) === 1 && sp.cell[B.splitKey('Womens', 'out of stock')] === undefined, sp);
  const sw = B.split(S2, { f: 'g:product_type', m: 'raw' }, null, B.PRICE_TYPE, null, { w: (r) => [10, 5, 2, 1][r] });
  t('split by a weight (spend) sums it instead of counting products', sw.row.Womens[sw.vals.indexOf(B.SALE)] === 10 && sw.row.Womens[sw.vals.indexOf(B.FULL)] === 5 && sw.weighted, sw);
  const sg = B.split(S2, { f: 'g:availability', m: 'raw' }, null, 'g:gender', null);
  t('on any other field the flag is the SMALLER stated part, never the blank', sg.flag === 'female' || sg.flag === 'male');
  // ---- the opportunity spotter: an invented 200-product feed where the "Low" label is 60% male against 20% overall
  {
    const S3 = B.createStore(), h3 = ['g:id', 'g:custom_label_1', 'g:gender', 'g:color'];
    for (let i = 0; i < 200; i++) {
      const low = i < 50, male = low ? i < 30 : i % 5 === 0 && i >= 50 && i < 100 ? true : false;
      B.addRow(S3, ['p' + i, low ? 'Low' : (i < 125 ? 'High' : 'Mid'), male ? 'male' : 'female', i % 3 === 0 && low ? '' : (i % 2 ? 'black' : 'red')], h3);
    }
    const m3 = B.mask(S3, [{ spec: { f: 'g:custom_label_1', m: 'raw' }, vals: ['Low'] }]);
    const sel = B.spot(S3, { groups: (r) => m3[r] ? ['sel'] : null, exclude: ['g:custom_label_1'] });
    const mx = sel.found.find((x) => x.k === 'mix' && x.f === 'g:gender' && x.v === 'male');
    const maleAll = [...Array(200).keys()].filter((i) => i < 30 || (i >= 50 && i < 100 && i % 5 === 0)).length / 200;
    t('spotter: a value over-represented in the selection is found, with its share here and across the feed counted', !!mx && Math.abs(mx.s - 30 / 50) < 1e-9 && Math.abs(mx.b - maleAll) < 1e-9 && mx.vn === 30, mx);
    t('…a field the selection defines is never read back as a finding', !sel.found.some((x) => x.f === 'g:custom_label_1'));
    const bl = sel.found.find((x) => x.k === 'blank' && x.f === 'g:color');
    t('…a field left blank on a quarter of the selection (and not elsewhere) is a data gap', !!bl && bl.vn === 17, bl);
    const tiny = B.spot(S3, { groups: (r) => r < 4 ? ['t'] : null });
    t('…a group under its floor is never read (20 products on a big feed, 2% of a small one, never under 5)', tiny.found.length === 0 && tiny.min === 5 && B.SPOT_MIN === 20);
    const cost = new Float64Array(200), value = new Float64Array(200);
    for (let i = 0; i < 200; i++) { cost[i] = 10; value[i] = i < 50 ? (i < 30 ? 80 : 10) : 30; }
    const ad = B.spot(S3, { groups: (r) => m3[r] ? ['sel'] : null, exclude: ['g:custom_label_1'], ads: { cost, value } });
    const sc = ad.found.find((x) => x.k === 'scale' && x.v === 'male');
    t('…with Google Ads, a value earning well above the segment’s ROAS on a slice of its spend reads Scale, its ROAS a ratio of sums', !!sc && Math.abs(sc.roas - 8) < 1e-9 && Math.abs(sc.groas - (30 * 80 + 20 * 10) / 500) < 1e-9, sc);
    const scan = B.spot(S3, { groups: (r) => ['r\u0001' + S3.cols[1].vals[S3.cols[1].ids[r]]], exclude: ['g:custom_label_1'] });
    t('…with no selection every row is read against the feed, the finding naming its row', scan.found.some((x) => x.g === 'r\u0001Low' && x.k === 'mix' && x.v === 'male'));
  }
  t('spotter page: the findings live IN the pivot — a flag per cell, a card, a ribbon — never a section of their own; briefs in a new tab',
    !/id="sec-opp"/.test(PG) && /id="pv-opp"/.test(PG) && /id="oppop"/.test(PG) && /function renderOpp\(rows\)/.test(PG) && /B\.spot\(S\.st, \{ groups:/.test(PG) && /class="opp" type="button" data-op="/.test(PG) && /wfTab\('\/workflow\?brief=' \+ b64url/.test(PG) && /renderSv3\(\); renderOpp\(rows\);/.test(PG)
    && /var pip = e\.target\.closest\('\.opp'\); if \(pip\) \{ e\.stopPropagation\(\);/.test(PG));
  t('a field that is not there reads nothing rather than guessing', B.split(S2, { f: 'g:product_type', m: 'raw' }, null, 'g:nope', null) === null);
  t('the page: a Split by picker, its share-of choice, a strip per cell, the CSV block, and the layout default', /id="pv-spl"/.test(PG) && /id="pv-splw"/.test(PG) && /function spCell\(sp, a\)/.test(PG) && /'Split · % '/.test(PG) && /spl: '', splw: 'n'/.test(PG));
}
console.log('· the gates, the stub, nothing of a client\'s');
{
  const QA = read('tools/qa_gate.sh'), PS = read('tools/presync.sh'), VY = read('.github/workflows/validate.yml'), CM = read('tools/check_mobile.js'), CD = read('tools/check_darkmode.js'), STUB = read('tools/breakdown_stub.js');
  t('the harness runs in qa_gate, presync and validate; the tripwire in presync', /node tools\/test_breakdown\.mjs/.test(QA) && /node tools\/test_breakdown\.mjs/.test(PS) && /node tools\/check_breakdown\.js/.test(PS) && /node tools\/test_breakdown\.mjs/.test(VY));
  t('both browser tripwires carry the stub', /const BREAKDOWN_STUB = require\('\.\/breakdown_stub\.js'\)\.stubLines\(\);/.test(CM) && /\$\{BREAKDOWN_STUB\}/.test(CM) && /const BREAKDOWN_STUB = require\('\.\/breakdown_stub\.js'\)\.stubLines\(\);/.test(CD) && /\$\{BREAKDOWN_STUB\}/.test(CD));
  t('the stub answers only on the Breakdown page and serves the synthetic brand only', /if\(\/Breakdown\/\.test\(location\.pathname\)\)\{/.test(STUB) && /require\('\.\/catalog_stub\.js'\)/.test(STUB));
  const CL = read('CLAUDE.md'), MF = read('docs/feature_manifest.json');
  t('docs/BREAKDOWN.md, the CLAUDE.md entry and the manifest markers are in', fs.existsSync(new URL('../docs/BREAKDOWN.md', import.meta.url)) && /^GET  \/breakdown /m.test(CL) && (MF.match(/"name": "Breakdown/g) || []).length >= 3);
}

console.log('\n' + (fail ? '✗' : '✓') + ' Field breakdown: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
