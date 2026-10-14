/* ONE PROJECT PLAN, TWO BRANDS.
 *
 * Ray, 14 Oct 2026, with the sheet open: "both brands are actually merged inside one project
 * plan … the initial brands, MON or ACC, should be indicated in column B … Every task that goes
 * into this plan should be done for both brands at once, unless a manual task is created within
 * the workflows and the brand is selected individually; then it should be done only for that
 * brand and marked in the Google Sheet accordingly."
 *
 * Three halves are pinned here:
 *   1. the engine (src/planbrand.js) against the cell shapes the LIVE sheet really holds — the
 *      five brand spellings the team already uses, and every non-brand value in that column,
 *      because the whole risk is reading a row number or a note as attribution.
 *   2. the worker: the parse carries the reading, a shared workbook is split per brand at serve
 *      time, and the append stamps the brand column and dedupes per brand.
 *   3. the page: every plan write names its client, and the board says when a row is one
 *      brand's only.
 *
 * The PRE-FIX behaviour is recorded verbatim (`out[brand] = seen[id]`) so the assertion that it
 * is gone can never pass on the old code.
 */
import { readFileSync } from 'node:fs';
import {
  brandsOnSheet, brandToken, readCellBrands, rowBrands, rowIsFor,
  tasksForBrand, splitPlanCache, appendToken, rowCovered, noteRow, foldName,
} from '../cloudflare/feedspark-deck/src/planbrand.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SHEET = '1SM52DXN3ecY5EDCIIqlRPONSmxkFvOM1xaeDrMlJ79w';
const MA = ['Accessorize', 'Monsoon'];                       // sorted, as brandsOnSheet returns
const ELC = ['Benefit', 'Bobbi Brown', 'Clinique', 'Estée Lauder', 'MAC'];

/* ---------- 1. the brands wired to one workbook ---------- */
console.log('\n── which brands share a workbook');
const MAP = { Monsoon: SHEET, Accessorize: SHEET, Reiss: 'r1', 'Jo Malone': 'j1' };
ok(eq(brandsOnSheet(MAP, SHEET), MA), 'Monsoon + Accessorize share ' + SHEET.slice(0, 8) + '…');
ok(eq(brandsOnSheet(MAP, 'r1'), ['Reiss']), 'Reiss has its own');
ok(eq(brandsOnSheet(MAP, 'nope'), []), 'an unwired id shares nothing');

/* ---------- 2. the tokens ---------- */
console.log('\n── the token the team writes, and the one we write back');
ok(brandToken('Monsoon', MA) === 'MON', 'Monsoon → MON (Ray named it)');
ok(brandToken('Accessorize', MA) === 'ACC', 'Accessorize → ACC');
ELC.forEach((b) => ok(/^[A-Z]{3}$/.test(brandToken(b, ELC)), b + ' derives a three-letter token (' + brandToken(b, ELC) + ')'));
ok(brandToken('Estée Lauder', ELC) === 'EST', 'and the accent is folded, not carried into the token');
const CLASH = ['Monarch', 'Monsoon'];
ok(brandToken('Monarch', CLASH) === 'Monarch',
  'two brands deriving the same three letters get no token — the full name, never one that cannot be told apart');

/* ---------- 3. the real column, value by value ---------- */
console.log('\n── reading the live sheet’s own column B');
// every brand spelling the team has used, read off the sheet 14 Oct 2026
[['Mon', ['Monsoon']], ['MON', ['Monsoon']], ['MONSOON', ['Monsoon']], ['Monsoon UK', ['Monsoon']],
 ['Acc', ['Accessorize']], ['ACC', ['Accessorize']], ['Accessorize UK ', ['Accessorize']],
 ['Mon & Acc', MA], ['Monsoon & Accessorize', MA]].forEach(([cell, want]) =>
  ok(eq(readCellBrands(cell, MA).sort(), want.slice().sort()), JSON.stringify(cell) + ' → ' + JSON.stringify(want)));
// and every OTHER value that column holds — a reading that cannot be made is never guessed
['', '   ', '1', '2', '1.1', '1.7', '14', '14.1', '14,5', 'PPC', 'SOCIAL', 'Single group', 'Bazaar',
 'UK & US', 'IE', 'Q1 - Spring Clean', '[with vs. Without Colour Trend]',
 '[with vs. Without item type descriptor]', '[with vs. Without Gifting Intent]'].forEach((cell) =>
  ok(eq(readCellBrands(cell, MA), []), JSON.stringify(cell) + ' names no brand — the row stays on both boards'));
ok(eq(readCellBrands('Mon', ['Monsoon']), []), 'a one-brand workbook attributes nothing — there is nothing to tell apart');
console.log('\n── the five-brand workbook gets the same reading for free');
ok(eq(readCellBrands('MAC', ELC), ['MAC']), 'MAC → MAC');
ok(eq(readCellBrands('Bob', ELC), ['Bobbi Brown']), 'Bob → Bobbi Brown');
ok(eq(readCellBrands('Best', ELC), []), 'Best is not Benefit — the piece must be a PREFIX, not merely share letters');
ok(eq(readCellBrands('Ben, MAC', ELC).sort(), ['Benefit', 'MAC']), 'a comma list names both');

/* ---------- 4. a row, not a cell ---------- */
console.log('\n── a row is read LEFT of its task text, never from the task itself');
// row 386 of the live sheet: the task names both brands, the brand column says Acc
const r386 = ['', 'Acc', 'Confirm new WoW with MON & ACC', 'Ray', '', 'Done', ''];
ok(eq(rowBrands(r386, 2, MA), ['Accessorize']),
  'row 386 is Accessorize’s — "Confirm new WoW with MON & ACC" in the TASK is not attribution');
ok(eq(rowBrands(['', '1.4', 'Data field and title optimisation', 'Mike (FS)', '', 'Done'], 2, MA), []),
  'a numbered monthly task names no brand');
ok(eq(rowBrands(['Monsoon', 'x', 'task text'], 0, MA), []),
  'no column left of the task text ⇒ nothing is ever attributed');

/* ---------- 5. whose board ---------- */
console.log('\n── whose board a row lands on');
const TASKS = [
  { t: 'Disapprovals - Basics' },                           // joint
  { t: 'Image Cycler: Accessories', br: ['Monsoon'] },
  { t: 'BTS keywords optimisation', br: ['Monsoon'] },
  { t: 'BTS keywords optimisation', br: ['Accessorize'] },
  { t: 'Monthly series' },                                   // "Mon & Acc" ⇒ joint, no br
];
ok(rowIsFor(TASKS[0], 'Monsoon') && rowIsFor(TASKS[0], 'Accessorize'), 'an unmarked row is BOTH brands’ (Ray’s default)');
ok(rowIsFor(TASKS[1], 'Monsoon') && !rowIsFor(TASKS[1], 'Accessorize'), 'a MON row is Monsoon’s only');
ok(rowIsFor({ t: 'x', br: [] }, 'Monsoon'), 'an empty br list is not an exclusion — it is no statement, so both');
ok(tasksForBrand(TASKS, 'Monsoon').length === 4, 'Monsoon gets the two joint rows plus its own two');
ok(tasksForBrand(TASKS, 'Accessorize').length === 3, 'Accessorize gets the two joint rows plus its own one');
ok(tasksForBrand(TASKS, 'Monsoon').every((t) => !t.br || t.br[0] === 'Monsoon'),
  'and never a row marked for the sibling');

console.log('\n── an older cache reads exactly as it did');
const legacy = { tasks: [{ t: 'a' }, { t: 'b' }], updated: 1 };
ok(splitPlanCache(legacy, 'Monsoon', MA) === legacy,
  'a parse with no br on any row is handed back UNCHANGED — the 300s cache roll cannot lose rows');
const split = splitPlanCache({ tasks: TASKS, updated: 2 }, 'Accessorize', MA);
ok(split.tasks.length === 3 && split.ofRows === 5 && split.shared === 2,
  'a split view says how many rows the workbook holds and how many brands share it');
ok(splitPlanCache({ tasks: TASKS }, 'Reiss', ['Reiss']).tasks.length === 5,
  'a one-brand sheet is never split');

/* ---------- 6. the write ---------- */
console.log('\n── what a new row writes into the brand column');
ok(appendToken('Monsoon', MA) === 'MON', 'a task raised for Monsoon is stamped MON');
ok(appendToken('Accessorize', MA) === 'ACC', 'a task raised for Accessorize is stamped ACC');
ok(appendToken('', MA) === '', 'a write that names no client stamps nothing — joint, the default');
ok(appendToken('Reiss', ['Reiss']) === '', 'a one-brand workbook has no brand column to stamp');
ok(appendToken('Reiss', MA) === '', 'a client that is not on this workbook is never stamped onto it');

console.log('\n── is the row already there? task text AND whose work it is');
const have = {};
noteRow(have, 'bts keywords optimisation', 'MON');
ok(!rowCovered(have, 'bts keywords optimisation', 'ACC'),
  'Accessorize’s copy of a task Monsoon already carries is NOT a duplicate (live rows 381/382)');
ok(rowCovered(have, 'bts keywords optimisation', 'MON'), 'a retry of the SAME brand’s row lands zero duplicates');
ok(!rowCovered(have, 'bts keywords optimisation', ''),
  'a one-brand row does not cover a joint one — swallowing it would drop the other brand’s half silently');
const have2 = {}; noteRow(have2, 'disapprovals basics', '');
ok(rowCovered(have2, 'disapprovals basics', 'MON') && rowCovered(have2, 'disapprovals basics', 'ACC')
  && rowCovered(have2, 'disapprovals basics', ''),
  'a blank-brand row already covers every brand, so nothing is filed beside it');
ok(!rowCovered({}, 'anything', 'MON'), 'an empty sheet covers nothing');

/* ---------- 7. the worker is wired to all of it ---------- */
console.log('\n── the worker');
const W = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
ok(/from "\.\/planbrand\.js"/.test(W), 'imports the engine rather than a second copy of these rules');
ok(/function parsePlanRows\(values, bg, brands\)/.test(W), 'parsePlanRows takes the workbook’s brands');
ok(/const br = rowBrands\(row, tcol, brands\);/.test(W), 'and reads each row’s brand column');
ok(/if \(br\.length && br\.length < \(brands \|\| \[\]\)\.length\) rec\.br = br;/.test(W),
  'storing it only when it NARROWS — a cell naming every brand is joint, so the cache stays small');
ok(/parsePlanRows\(g\.values, g\.bg, brandsOnSheet\(PLAN_SHEETS, id\)\)/.test(W), '/api/plan/live parses with them');
ok(/parsePlanRows\(g\.values, g\.bg, brandsOnSheet\(sheets, id\)\)/.test(W), 'so does the cron warm');
// THE PRE-FIX LINE, VERBATIM: both brands were handed the identical array
ok(!/out\[brand\] = seen\[id\];/.test(W),
  'the shared serve `out[brand] = seen[id]` is GONE — this is the assertion that fails on the old worker');
ok(/out\[brand\] = splitPlanCache\(cached, brand, brandsOnSheet\(PLAN_SHEETS, id\)\)/.test(W),
  'a brand is served its own rows on the first read');
ok(/if \(seen\[id\]\) \{ out\[brand\] = splitPlanCache\(seen\[id\]/.test(W),
  'and on the SECOND brand of the same workbook, which is the whole point');
ok(/const own = splitPlanCache\(cached, b, brandsOnSheet\(PLAN_SHEETS, id\)\)/.test(W),
  'the Playbook splits too — "not on this account" can never be answered off a sibling brand’s work');
ok(/const merged = idCount\[id\] > 1 && own\.tasks\.length === cached\.tasks\.length;/.test(W),
  'and its `shared` flag now follows the NARROWING, not the mere sharing — a split read is this '
  + 'brand’s own work and current, so the Playbook stops preferring a baked snapshot over it');
ok(!/\{ tasks, updated: cached\.updated \|\| 0 \}, idCount\[id\] > 1 \? \{ shared: 1 \}/.test(W),
  'the old unconditional flag is gone');
ok(/async function appendPlanRows\(env, id, tab, rows, client\)/.test(W), 'appendPlanRows takes the client');
ok(/const brandTok = appendToken\(client, sheetBrands\);/.test(W), 'resolves the token through the engine');
ok(/const bc = \(sheetBrands\.length > 1 && tc > 0\) \? tc - 1 : -1;/.test(W),
  'the brand column is the one left of the task text, and only on a shared workbook');
ok(/if \(bc >= 0 && tk\) a\[bc\] = tk;/.test(W), 'and the stamp lands in it');
ok(/rowCovered\(have, k, tk\)/.test(W), 'the dedupe asks the brand-aware guard');
ok(!/const have = new Set\(\); for \(const g of grid\)/.test(W),
  'the old task-text-only Set guard is gone — it would skip the second brand’s copy for ever');
// every caller names the brand it is filing for
const calls = [...W.matchAll(/appendPlanRows\(env,[^;]*?\);/gs)].map((m) => m[0]);
ok(calls.length >= 6, 'found every append call site (' + calls.length + ')');
calls.forEach((c, i) => ok(/,\s*(client|batch\.client[^)]*|String\(body\.client[^)]*)\)?\s*\)?;$/.test(c.replace(/\s+/g, ' ').trim())
  || /client/.test(c), 'call site ' + (i + 1) + ' names its client'));
ok(/String\(body\.client \|\| ''\)/.test(W), '/api/sheets/append reads the client off the body');

/* ---------- 8. the page ---------- */
console.log('\n── the Workflow board');
const P = readFileSync(new URL('../docs/FeedSpark_Workflow.html', import.meta.url), 'utf8');
const appends = [...P.matchAll(/\/api\/sheets\/append[\s\S]{0,420}?rows:/g)].map((m) => m[0]);
ok(appends.length === 5, 'the page has five plan-write call sites (' + appends.length + ')');
appends.forEach((a, i) => ok(/client:\s*(client|c|nc)\s*,/.test(a),
  'write ' + (i + 1) + ' names the client it is filing for'));
ok(/only:\(Array\.isArray\(t\.br\)&&t\.br\.length===1\)\?t\.br\[0\]:''/.test(P),
  'planTasks carries whether the row is one brand’s only');
ok(/src-only/.test(P) && /only<\/span>/.test(P), 'and the row says so on the board');
ok(/\.itbl \.src-only\{/.test(P), 'with its own chip style, not colour alone');

/* ---------- 9. nothing of the client’s plan is in git ---------- */
console.log('\n── no client data committed');
const PB = readFileSync(new URL('../cloudflare/feedspark-deck/src/planbrand.js', import.meta.url), 'utf8');
ok(!/Image Cycler|BTS keywords|Pixel matchrate/.test(PB), 'the engine quotes no task from the sheet');
ok(foldName('Estée Lauder') === 'estee lauder', 'accents fold (used by every rule above)');

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
