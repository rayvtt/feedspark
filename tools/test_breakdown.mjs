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
  t('on the migration board with the feed-scan family (wave 2), December', mig && mig.w === 2 && mig.m === '2026-12');
  t('the Transformation page carries the twin row and an assessment row', /\{p:'\/breakdown',n:'Field breakdown',w:2,m:'2026-12'/.test(TX) && /\{id:'breakdown',p:'\/breakdown',n:'Field breakdown',ben:/.test(TX));
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
  t('no literal </body> inside the script (the worker injects at the first one)', PG.indexOf('</body>') === PG.lastIndexOf('</body>'));
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
