/**
 * tools/test_xlsx.mjs — the shared XLSX table writer + the Task Manager's three exports.
 *
 * Ray, 16 Sep 2026: "allows excel downloads on Tasks / Client tickets / Account & hours balance".
 *
 * A broken .xlsx fails SILENTLY — Excel refuses the whole workbook over one stray control
 * character or an over-long sheet name, and says only "we found a problem with some content".
 * So this pins the structure of the bytes, not just the API:
 *   1. the ZIP is well formed (magic, end-of-central-directory, one local header per part);
 *   2. every required part is present and every sheet is declared in workbook.xml + its rels;
 *   3. cells carry TYPES — a date is a serial, hours are numbers, text is inline;
 *   4. "absent" is an empty cell, never a zero and never a fabricated date;
 *   5. the page exports the view that is on screen, with the split intact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(import.meta.url);
const X = require(path.join(ROOT, 'docs', 'xlsx_engine.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  x ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n      got ${JSON.stringify(a)}\n      want ${JSON.stringify(b)}`);

// --- a reader, so the assertions are about the real bytes ---------------------------------------
function unzip(buf) {
  const u = Buffer.from(buf), out = {};
  let p = 0;
  while (p + 4 <= u.length && u.readUInt32LE(p) === 0x04034b50) {
    const nlen = u.readUInt16LE(p + 26), elen = u.readUInt16LE(p + 28), size = u.readUInt32LE(p + 18);
    const name = u.slice(p + 30, p + 30 + nlen).toString('utf8');
    const start = p + 30 + nlen + elen;
    out[name] = u.slice(start, start + size).toString('utf8');
    p = start + size;
  }
  return out;
}

console.log('-- the ZIP container');
const simple = X.build([{ name: 'One', cols: [{ k: 'a', l: 'A' }], rows: [{ a: 'x' }] }]);
ok(simple[0] === 0x50 && simple[1] === 0x4B, 'starts with the ZIP magic');
ok(Buffer.from(simple).readUInt32LE(simple.length - 22) === 0x06054b50,
  'ends with an end-of-central-directory record');
const parts = unzip(simple);
['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
  'xl/styles.xml', 'xl/worksheets/sheet1.xml'].forEach((f) => ok(parts[f] != null, 'part present: ' + f));

console.log('-- sheets are declared everywhere they must be');
const three = X.build([
  { name: 'Tasks', cols: [{ k: 'a', l: 'A' }], rows: [{ a: '1' }] },
  { name: 'Client tickets', cols: [{ k: 'a', l: 'A' }], rows: [{ a: '2' }] },
  { name: 'About this export', cols: [{ k: 'a', l: 'A' }], rows: [{ a: '3' }] },
]);
const P3 = unzip(three);
ok((P3['xl/workbook.xml'].match(/<sheet /g) || []).length === 3, 'three <sheet> entries in workbook.xml');
[1, 2, 3].forEach((i) => {
  ok(P3['xl/worksheets/sheet' + i + '.xml'] != null, 'sheet' + i + '.xml exists');
  ok(P3['xl/_rels/workbook.xml.rels'].indexOf('worksheets/sheet' + i + '.xml') >= 0,
    'sheet' + i + ' is related in workbook rels');
  ok(P3['[Content_Types].xml'].indexOf('/xl/worksheets/sheet' + i + '.xml') >= 0,
    'sheet' + i + ' has a content-type override');
});
ok(P3['xl/_rels/workbook.xml.rels'].indexOf('styles.xml') >= 0,
  'the stylesheet is related too — an unrelated one is a refused workbook');

console.log('-- sheet names Excel will actually accept');
eq(X.safeName('Accounts & hours balance'), 'Accounts & hours balance', 'an ampersand is fine in a sheet name');
eq(X.safeName('a/b:c?d*e[f]g'), 'a b c d e f g', 'the six characters Excel forbids are replaced, not kept');
ok(X.safeName('x'.repeat(50)).length === 31, 'over-long names are cut to 31 — Excel refuses the file otherwise');
eq(X.safeName('', 2), 'Sheet3', 'an empty name still yields a legal one');

console.log('-- cells carry types, so the column sorts and sums');
const typed = unzip(X.build([{ name: 'T',
  rows: [{ d: '2026-09-16', h: 1.25, n: 7, s: 'Reiss' }],
  cols: [{ k: 'd', l: 'Date', t: 'date' }, { k: 'h', l: 'Hours', t: 'hours' },
    { k: 'n', l: 'N', t: 'int' }, { k: 's', l: 'Client' }] }]))['xl/worksheets/sheet1.xml'];
ok(/<c r="A2"[^>]*><v>46281<\/v><\/c>/.test(typed), 'a date is written as an Excel serial, not text');
ok(/<c r="B2"[^>]*><v>1.25<\/v><\/c>/.test(typed), 'hours are a number');
ok(/<c r="D2"[^>]*t="inlineStr"/.test(typed), 'text is an inline string');
ok(typed.indexOf('<pane ySplit="1"') >= 0, 'the header row is frozen');
ok(/<autoFilter ref="A1:D2"\/>/.test(typed), 'and every column filters');
ok(/<col min="1"[^>]*customWidth="1"/.test(typed), 'columns carry explicit widths');

console.log('-- absent is absent: never a zero, never a fabricated date');
const sparse = unzip(X.build([{ name: 'T',
  rows: [{ d: '', h: null, s: undefined }, { d: '0000-00-00', h: 0, s: 'x' }],
  cols: [{ k: 'd', l: 'Date', t: 'date' }, { k: 'h', l: 'Hours', t: 'hours' }, { k: 's', l: 'S' }] }]))['xl/worksheets/sheet1.xml'];
ok(sparse.indexOf('r="A2"') < 0 && sparse.indexOf('r="B2"') < 0 && sparse.indexOf('r="C2"') < 0,
  'an empty/null/undefined value writes NO cell at all');
ok(sparse.indexOf('r="A3"') < 0,
  'the reports database 0000-00-00 sentinel is absent, not a text cell poisoning a date column');
ok(/<c r="B3"[^>]*><v>0<\/v><\/c>/.test(sparse),
  'a real zero IS written — 0 h delivered is a fact, not a gap');
eq(X.serial('0000-00-00'), null, 'serial() refuses the sentinel');
eq(X.serial('not a date'), null, 'and anything it cannot parse');
ok(X.serial('2026-09-16') === 46281, 'and gets a real date right');

console.log('-- XML that would otherwise refuse to open');
const BELL = String.fromCharCode(7);
const nasty = unzip(X.build([{ name: 'T', cols: [{ k: 'a', l: 'A & B' }],
  rows: [{ a: 'Q&A <tag> "quoted" ' + BELL + 'bell' }] }]))['xl/worksheets/sheet1.xml'];
ok(nasty.indexOf('&amp;') >= 0 && nasty.indexOf('&lt;tag&gt;') >= 0, 'ampersands and angle brackets are escaped');
ok(nasty.indexOf(BELL) < 0, 'a control character is stripped — one of them refuses the whole workbook');
ok(nasty.indexOf('A &amp; B') >= 0, 'header text is escaped too');

console.log('-- an empty export is still a valid file');
const none = unzip(X.build([{ name: 'T', cols: [{ k: 'a', l: 'A' }], rows: [] }]))['xl/worksheets/sheet1.xml'];
ok(none.indexOf('autoFilter') < 0, 'no rows means no autofilter (Excel rejects a filter over a header alone)');
ok(none.indexOf('r="A1"') >= 0, 'but the header is still written');
ok(X.build([]).length > 0, 'and no sheets at all still produces a readable workbook');

console.log('-- the page wires all three tabs to it');
const PAGE = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_TaskManager.html'), 'utf8');
ok(/<script src="\/xlsx\/engine\.js"/.test(PAGE), 'the page loads the shared engine');
ok(/id="pxlsx"/.test(PAGE), 'the export button is on the tab pane, so it follows the active tab');
const XC = PAGE.slice(PAGE.indexOf('var XCOLS'), PAGE.indexOf('var XNAME'));
['tasks', 'tickets', 'accounts'].forEach((t) => ok(new RegExp(t + ':\\s*\\[').test(XC),
  'XCOLS covers the ' + t + ' tab'));
ok(/xrows\(tab\)/.test(PAGE) && /var rows = paneRows\(tab\);/.test(PAGE),
  'it exports the CURRENT view through the same resolver the table uses — the top-bar search, the '
  + 'pane filter and the sort — not the whole book, and not the rows that happen to be painted');
ok(/Billable h/.test(XC) && /Non-billable h/.test(XC) && /Total h/.test(XC),
  'billable and non-billable stay split, with the total beside them');
ok(/About this export/.test(PAGE), 'provenance rides as its own sheet, never mixed into the data grid');
ok(/ABSENT, not zero/.test(PAGE), 'and it says how much of the book had been read');

const WK = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');
ok(/path === '\/xlsx\/engine\.js'/.test(WK), 'the worker serves the engine');
ok(/import XLSX_ENGINE_SRC from "\.\.\/\.\.\/\.\.\/docs\/xlsx_engine\.js"/.test(WK), 'and bundles it');
// asked of the shared checker, not of a filename glob written out here: the rule is a
// PATTERN now, and a test pinning one name is how image_engine.js slipped the net
ok(require('./check_textmodules.js').covered('docs/xlsx_engine.js'),
  'wrangler treats it as a Text module like its sibling engines');

// ---------------------------------------------------------------------------------------------
// READING one back (Ray, 17 Sep 2026: "using Excel that I can import and export")
//
// An export nobody can send back is half a round trip. The reader is exercised against a workbook
// THIS WRITER PRODUCED, so the two can never drift apart, and against the CSV shapes Excel emits.
// ---------------------------------------------------------------------------------------------
console.log('-- reading a workbook back');
const RT = X.build([{ name: 'Tasks',
  cols: [{ k: 'id', l: 'Task id', t: 'int' }, { k: 'title', l: 'Task' }, { k: 'tagsL', l: 'Tags' }],
  rows: [{ id: 220082, title: 'Disapprovals & "urgent", today', tagsL: 'Urgent; Technical' },
    { id: 219998, title: 'Keyword optimisation', tagsL: '' }] }]);
const back = await X.readXlsx(RT.buffer.slice(RT.byteOffset, RT.byteOffset + RT.length));
eq(back[0], ['Task id', 'Task', 'Tags'], 'the header row reads back as written');
eq(back[1][0], '220082', 'and the task id survives, which is what the round trip keys on');
eq(back[1][1], 'Disapprovals & "urgent", today',
  'XML-escaped ampersands and quotes come back as themselves, not as entities');
eq(back[1][2], 'Urgent; Technical', 'and the tags column round-trips');
const tb = X.table(back, ['Task id', 'Tags']);
eq(tb.header, 0, 'the header row is found by its labels');
eq(tb.rows.length, 2, 'and every data row below it is returned');
eq(tb.rows[1].Tags, '', 'a cleared tag cell reads as empty, not as missing');

console.log('-- and the CSV Excel writes');
const csv = X.readCsv('Task id,Task,Tags\r\n220082,"Disapprovals, urgent","urgent; technical"\r\n219998,plain,\r\n');
eq(csv[1], ['220082', 'Disapprovals, urgent', 'urgent; technical'],
  'a quoted comma inside a cell does not split the row — the single most common way a CSV import corrupts data');
eq(csv[2], ['219998', 'plain', ''], 'CRLF line endings are handled');
eq(X.readCsv('a,b\n"he said ""hi""",2')[1][0], 'he said "hi"', 'doubled quotes unescape');
eq(X.table([['report', ''], ['Task id', 'Tags'], ['1', 'urgent']], ['Task id', 'Tags']).header, 1,
  'a header sitting BELOW a title row is still found — people add titles to spreadsheets');
eq(X.table([['Nope']], ['Task id', 'Tags']).header, -1,
  'and a file with no such header is refused rather than read as if column 1 were ids');

const PGT = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_TaskManager.html'), 'utf8');
ok(/id="ptagimp"/.test(PGT) && /accept=".csv,.xlsx"/.test(PGT), 'the page offers the import beside the export');
ok(/Nothing is saved until you confirm/.test(PGT),
  'IT PREVIEWS BEFORE IT WRITES — a sheet off someone\'s laptop can be stale, filtered or full of typos');
ok(/Rows this file does not mention are left exactly as they are/.test(PGT),
  'and importing a FILTERED sheet cannot wipe the rest of the book');
ok(/task ids not in this book \(ignored\)/.test(PGT), 'unknown ids are reported, not silently applied');
ok(/are not tags/.test(PGT), 'and so are tag names the vocabulary does not have');
ok(/\{ k: 'tagsL', l: 'Tags'/.test(PGT), 'the export carries the Tags column the import reads back');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
