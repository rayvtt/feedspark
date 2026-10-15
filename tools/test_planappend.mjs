/* WHERE A TASK LANDS IN A PROJECT PLAN — AND WHAT HAPPENS WHEN THERE IS NO ROOM.
 *
 * Ray, 14 Oct 2026, with a screenshot of three 📞 Call rows on Monsoon's Intake and an arrow
 * across to the open Monsoon + Accessorize project plan: "actions added by call / gemini - is
 * not added in Project Plan btw".
 *
 * MEASURED on the live workbook that day: the plan's last task sits on row 515, the grid is
 * 891 rows deep, and its VERY LAST ROW (891) holds a lone "Open" in the status column with 375
 * empty rows between the two. The write anchored on "the last row carrying anything", so it
 * asked for row 892 — one row PAST THE END OF THE GRID — and values.update refuses a range
 * outside the grid instead of growing it. Every append to that workbook failed that way and
 * said nothing: a parsed call action, ＋ Add task, a Golden Record fix, a briefed ticket.
 *
 * This pins the two halves of the fix: planAppendRow (where the rows go) and the worker/page
 * wiring that makes room and stops a refused write from passing for a filed one.
 *
 * Run: node tools/test_planappend.mjs
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m, got) => { if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };

const W = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
const P = readFileSync(new URL('../docs/FeedSpark_Workflow.html', import.meta.url), 'utf8');

function liftFrom(src, name, label) {
  let at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('could not find ' + name + ' in ' + label + ' — has it been renamed?');
  if (src.slice(at - 6, at) === 'async ') at -= 6;   // an async body's awaits need its own keyword
  let depth = 0, end = -1;
  for (let k = src.indexOf('{', at); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  return src.slice(at, end);
}
const planAppendRow = new Function(liftFrom(W, 'planAppendRow', 'worker.js') + '\nreturn planAppendRow;')();

/* ---------- 1. the live Monsoon + Accessorize grid, as it really reads ---------- */
console.log('── the workbook Ray was looking at (891 rows, last task 515, a lone "Open" on 891)');
const TC = 2, SC = 5;                                    // resolveCols on that tab: task C, status F
const realGrid = (() => {
  const g = [];
  for (let r = 0; r < 891; r++) g.push([]);
  g[10] = ['', '', 'Task', '', '', 'Status', 'Due'];     // its header row
  for (let r = 11; r < 515; r++) g[r] = ['', 'PPC', 'row ' + r + ' work', 'Gary (FS)', '', 'Done', ''];
  g[514] = ['', '', 'Oct-26', '', '', '', ''];           // the last row carrying a task
  g[890] = ['', '', '', '', '', 'Open', ''];             // the stray cell on the final grid row
  return g;
})();
const real = planAppendRow(realGrid, TC, 3);
ok(real.startRow === 516, 'three call actions land on row 516 — directly under the plan\'s last task', real);
ok(real.anchor === 'task', 'and it says it anchored on the task, not on whatever sits at the bottom');
ok(real.startRow + 3 - 1 <= 891, 'the rows it asks for exist inside an 891-row grid', real.startRow);
/* the pre-fix rule, recorded verbatim so it can never come back */
const preFix = (grid, n) => { let lastRow = 0;
  for (let r = 0; r < grid.length; r++) if ((grid[r] || []).some(x => String(x || '').trim() !== '')) lastRow = r;
  return lastRow + 2; };
ok(preFix(realGrid, 3) === 892, 'the rule it replaces asked for row 892 on this very grid');
ok(892 > 891, '— which is past the end of the grid, so values.update refused the write outright');
ok(!/let lastRow = 0; for \(let r = 0; r < grid\.length/.test(W),
  'worker.js no longer carries the last-row-carrying-anything anchor');

/* ---------- 2. the rule in general ---------- */
console.log('\n── the rule');
const plain = [['', '', 'Task', '', '', 'Status'], ['', '', 'Alpha', '', '', 'Open'], ['', '', 'Beta', '', '', 'Done']];
ok(planAppendRow(plain, TC, 1).startRow === 4, 'an ordinary plan appends immediately after its last row');
ok(planAppendRow(plain, TC, 1).anchor === 'content',
  'where the last task IS the last content row there is nothing to step back from');
ok(planAppendRow([], TC, 1).startRow === 1, 'an empty tab starts at row 1');
ok(planAppendRow([], TC, 1).anchor === 'content', 'with nothing to anchor on it says so');

const blocked = plain.concat([[], ['', '', '', '', '', 'Open']]);   // something sits right below the last task
ok(planAppendRow(blocked, TC, 1).startRow === 4,
  'one free row below the last task is used when only one row is needed', planAppendRow(blocked, TC, 1));
ok(planAppendRow(blocked, TC, 2).startRow === 6,
  'two rows will not fit there, so the write falls back to after the last content row',
  planAppendRow(blocked, TC, 2));
ok(planAppendRow(blocked, TC, 2).anchor === 'content', 'and reports the fallback honestly');
const tight = plain.concat([['', '', '', 'someone'], []]);
ok(planAppendRow(tight, TC, 1).startRow === 5,
  'a row holding only an owner is content — written after, never over', planAppendRow(tight, TC, 1));
const noTask = [[], [], ['', '', '', '', '', 'Open']];
ok(planAppendRow(noTask, TC, 1).startRow === 4, 'a tab with no task at all still appends after its content');
ok(planAppendRow([[], ['', '', 'Only task']], TC, 4).startRow === 3,
  'four rows below the last task are free on a short tab');

/* ---------- 3. the worker makes room before it asks for the range ---------- */
console.log('\n── making room');
ok(/async function resolveTabInfo\(/.test(W), 'resolveTabInfo reads the tab in one metadata call');
ok(/gridProperties\(rowCount\)/.test(W), '— and asks for the tab\'s row count, which a write needs');
ok(/sheets\.properties\(sheetId,title,gridProperties\(rowCount\)\)/.test(W),
  '— plus its sheetId, so rows can be added to it');
ok(/async function resolveTab\(id, tab, token\) \{ const i = await resolveTabInfo/.test(W),
  'resolveTab delegates to it, so the tab-name matching has one implementation');
const ap = liftFrom(W, 'appendPlanRows', 'worker.js');
ok(/const info = await resolveTabInfo\(id, tab, token\)/.test(ap), 'appendPlanRows resolves the tab through it');
ok(/if \(!info\) return tabAmbiguous/.test(ap), 'an ambiguous workbook is still refused by name');
ok(/const place = planAppendRow\(grid, tc, values\.length\)/.test(ap), 'and places its rows with planAppendRow');
ok(/const need = startRow \+ values\.length - 1/.test(ap), 'it works out the last row it will fill');
ok(/appendDimension/.test(ap) && /dimension: 'ROWS'/.test(ap),
  'and adds rows to the grid when that row does not exist yet');
ok(/if \(info\.rowCount && need > info\.rowCount && info\.sheetId != null\)/.test(ap),
  'only when the grid is really too short, and only when it knows which tab to grow');
ok(/if \(gd\.error\) return \{ ok: false, error: permHint/.test(ap),
  'a refused expansion is reported, never written over');
ok(/anchor: place\.anchor/.test(ap), 'the answer says which anchor it used');

/* ---------- 4. the page stops calling a refused write a filed task ---------- */
/* The fact is still on screen. What changed on 15 Oct 2026 is WHERE: Ray, over the dark-red
   floating banner, "i dont want this message to show" and then "warning like this never linger !"
   — so the count rides Intake's own head line (quiet, re-written by every render, un-hideable by
   a fold) and never a fixed band. Two things the band got wrong are pinned here too: it held ONE
   global reason against the FIRST unsynced row of any brand (ELC's sheet error printed against
   an Accessorize task), and it said "Retrying…" about a refusal that can never succeed. */
console.log('\n── a failed write says so on Intake\'s head line, and never lingers as a band');
const pageFns = ['planUnsynced', 'planNote', 'planNoteFill', 'planWarn', 'planWriteFailed', 'planFatal', 'adoptIntoPlan', 'resyncPlanWrites']
  .map((n) => liftFrom(P, n, 'FeedSpark_Workflow.html')).join('\n');
ok(/function planNote\(/.test(pageFns), 'the board still reports unwritten plan rows');
ok(/PLAN_FAIL\[m\.client\]/.test(pageFns),
  'raised only for a client whose write has actually been REFUSED — never by one still in flight');
ok(/m\.w\|\|!m\.client\|\|!m\.task/.test(pageFns), 'it counts the rows the sheet never confirmed');
ok(/DELETED\[m\.client\+'\|'\+m\.task\]/.test(pageFns), 'a deleted row is not counted as unwritten');
ok(/PLAN_FAIL\[c\]/.test(pageFns) && /t\.slice\(0,6\)/.test(pageFns),
  'and names every brand with ITS OWN sheet reason and its tasks, never one reason over another brand\'s row');
ok(/p\.dead\?' \\u00b7 the sheet has to change'/.test(pageFns),
  'a refusal that can never succeed says the sheet has to change — it never claims to be retrying');
ok(!/_planWarnEl/.test(P), 'the floating plan band is gone from the page');
ok(!/Brief not saved to the pipeline yet/.test(P), 'and so is the floating unsaved-brief band');
ok(!/background:#8A2A1B/.test(P), 'no dark-red fixed banner is left anywhere on the board');
ok(/<span id="plan-note">/.test(liftFrom(P, 'renderIntake', 'FeedSpark_Workflow.html')),
  'Intake\'s head line carries the slot the note is written into');
ok(/function bfWarn\(on\)\{ _bfWarn=!!on; if\(typeof renderBpTog==='function'\)renderBpTog\(\); \}/.test(P),
  'an unsaved brief is a flag the pipeline\'s head line reads, not a band');
ok(/_bfWarn\?\(' \\u00b7 '\+wsWarn\('not saved to the pipeline yet'\)\)/.test(liftFrom(P, 'renderBpTog', 'FeedSpark_Workflow.html')),
  'and that line says so while the save is still out');
const adopt = liftFrom(P, 'adoptIntoPlan', 'FeedSpark_Workflow.html');
ok(/planWriteFailed\(client,ae\)/.test(adopt), 'a refused append raises it, against the client it was for');
ok(/planWriteFailed\(client,'network'\)/.test(adopt), 'so does a lost one');
ok(/if\(!planFatal\(ae\)\)delete _planTried/.test(adopt),
  'a refusal the workbook will repeat is NOT handed back to the retry pass');
ok(/planWriteOk\(client\); planWarn\(\)/.test(adopt), 'a confirmed write clears it');
const resync = liftFrom(P, 'resyncPlanWrites', 'FeedSpark_Workflow.html');
ok(/if\(!planFatal\(re\)\)rows\.forEach\(function\(m\)\{ delete _planTried/.test(resync),
  'the resync pass hands a refused row back only when another attempt could work');
ok(/planWriteFailed\(c,re\)/.test(resync), 'and reports it under that client rather than returning in silence');
ok(/planWriteOk\(c\); planWarn\(\)/.test(resync), 'a successful resync takes it down');
/* The classifier, run: the real refusal off Ray's screenshot against the ones worth retrying. */
const planFatal = new Function(liftFrom(P, 'planFatal', 'FeedSpark_Workflow.html') + '\nreturn planFatal;')();
ok(planFatal('Could not find a single "Project Plan"-like tab in this sheet (1KWrB4Ip…) — it has several tabs')
  === true, 'a workbook with no Plan-like tab is a permanent refusal');
ok(planFatal('no_plan_sheet') === true && planFatal('bad_sheet_id') === true,
  'so is no sheet wired, and a bad id');
ok(planFatal('The caller does not have permission') === true,
  'so is a service account that can read but not write');
ok(planFatal('network') === false && planFatal('write failed') === false && planFatal('backendError') === false,
  'a transient failure is still retried');

/* ---------- 5. the real appendPlanRows, run against a fake Sheets API ---------- */
/* The two halves above are each pinned on their own; this runs the function itself over the live
   grid shape and reads the requests it makes, because the bug was in how they met. */
console.log('\n── appendPlanRows over that grid, with Google stubbed');
const PB = (await import('../cloudflare/feedspark-deck/src/planbrand.js')).default
  || await import('../cloudflare/feedspark-deck/src/planbrand.js');
const SHEET = '1SM52DXN3ecY5EDCIIqlRPONSmxkFvOM1xaeDrMlJ79w';
async function runAppend(rows, client, { rowCount = 891 } = {}) {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
    const u = String(url);
    if (/fields=sheets\.properties/.test(u)) return { json: async () => ({ sheets: [{ properties: { sheetId: 7, title: 'Project Plan', gridProperties: { rowCount } } }] }) };
    if (/\/values\/.*A1%3AZZ5000/.test(u) || /A1:ZZ5000/.test(u)) return { json: async () => ({ values: realGrid }) };
    if (/:batchUpdate/.test(u)) return { json: async () => ({ replies: [{}] }) };
    return { json: async () => ({ updatedCells: 1 }) };
  };
  const sandbox = new Function('deps', `
    const { fetchStub, PB, PLAN_SHEETS, resolveCols, colLetter, permHint, tabAmbiguous, googleToken, env } = deps;
    const fetch = fetchStub;
    const { brandsOnSheet, brandToken, rowBrands, appendToken, rowCovered, noteRow } = PB;
    ${liftFrom(W, 'resolveTabInfo', 'worker.js')}
    ${liftFrom(W, 'planAppendRow', 'worker.js')}
    ${liftFrom(W, 'appendPlanRows', 'worker.js')}
    return appendPlanRows;`)({
      fetchStub, PB, PLAN_SHEETS: { Monsoon: SHEET, Accessorize: SHEET, Reiss: 'other' },
      resolveCols: () => ({ headerRow: 10, offset: 0, statusCol: SC, taskCol: TC, ownerCol: 3, dueCol: 6 }),
      colLetter: (n) => String.fromCharCode(65 + n), permHint: (m) => m,
      tabAmbiguous: () => ({ ok: false, error: 'ambiguous' }),
      googleToken: async () => 'tok', env: { EDITS: { delete: async () => {} } },
    });
  const out = await sandbox({ EDITS: { delete: async () => {} } }, SHEET, 'Project Plan', rows, client);
  return { out, calls };
}
const three = ['Share Black Friday Brief: Send the Black Friday brief to the Monsoon team',
  'Share Optimization Needs: Send details on product range optimization needs',
  'Schedule Meeting: Send an email invitation for a follow up call at the end of October']
  .map((t) => ({ task: t, owner: 'Ray Vu', status: 'Open', due: '' }));
const r1 = await runAppend(three, 'Monsoon');
ok(r1.out.ok === true, 'the three call actions are written', r1.out);
ok(r1.out.atRow === 516, '— on row 516, under the plan\'s last task', r1.out.atRow);
ok(r1.out.appended === 3 && r1.out.skipped === 0, 'all three, none skipped as already there');
ok(r1.out.brand === 'MON', 'stamped MON — a call on Monsoon\'s account is Monsoon\'s work');
const put = r1.calls.find((c) => c.method === 'PUT');
ok(!!put && /A516/.test(put.url), 'the range it PUTs is A516', put && put.url);
ok(!r1.calls.some((c) => /:batchUpdate/.test(c.url)),
  'no rows are added — 516-518 already exist inside an 891-row grid');
ok(put && put.body.values[0][TC] === three[0].task && put.body.values[0][SC] === 'Open'
  && put.body.values[0][1] === 'MON', 'task, status and brand land in their own columns', put && put.body.values[0]);

/* and on a grid with genuinely no room left */
const r2 = await runAppend(three, 'Monsoon', { rowCount: 517 });
const grow = r2.calls.find((c) => /:batchUpdate/.test(c.url));
ok(!!grow, 'a grid too short to hold them is grown first');
ok(grow && grow.body.requests[0].appendDimension.sheetId === 7, '— on the tab the write is going to');
ok(grow && grow.body.requests[0].appendDimension.length === (518 - 517) + 50,
  '— by what it needs plus a little slack', grow && grow.body.requests[0].appendDimension.length);
ok(r2.out.ok === true && r2.out.atRow === 516, 'and the write then lands where it meant to', r2.out);

/* ---------------------------------------------------------------- 5. a confirmed ticket closes
   its task (Ray, 15 Oct 2026: "When a ticket's status is changed to client confirm anywhere, the
   corresponding task in InTake should be updated to Done accordingly"). The behaviour is driven
   in a browser by tools/check_confirmdone.js; these pin the WIRING, which is what a later change
   would quietly undo: the close rides setStage, so every surface is covered by construction. */
console.log('\n── a confirmed ticket closes its task');
ok(/b\.status=stage; b\.updated=Date\.now\(\);\s*\n\s*if\(stage==='confirmed'\)confirmDone\(b\);/.test(P),
  'the close rides setStage — the one writer every surface goes through');
ok(/if\(applyConfirmDone\(b\)\)pend\.push\(b\);/.test(P),
  'and it is retried from the pass that runs on every render once the plan is live');
ok(P.indexOf('if(applyConfirmDone(b))pend.push(b);') < P.indexOf("if(b.status==='confirmed')return;"),
  '— before the reconcile drops a confirmed ticket, or it would never be reached');
ok(/asplBackfill\(\); confirmBackfill\(\); \}/.test(P), 'the tickets already confirmed are filled in too');
const AC = P.slice(P.indexOf('function applyConfirmDone('), P.indexOf('var _cdDone'));
ok(/b\.cstmp=1;/.test(AC) && /if\(!b\|\|!b\.id\|\|b\.cstmp\)return false;/.test(P),
  'stamped once per ticket, so an AM who re-opens the row is not corrected');
ok(/bucketOf\(row\.s\|\|''\)==='done'\)return true;/.test(AC), 'a task already closed is not re-written');
ok(/inScopeClient\(b\.client\)/.test(AC), 'a scoped signin never writes another book\'s row');
ok(/delete PEND_DONE\[b\.id\]; b\.cstmp=1;/.test(AC),
  'the pending entry is dropped BEFORE the writer, since the writer renders');
ok(/writeStatus\(row\.client,row\.task,'Done'\)/.test(AC),
  'it writes through writeStatus — the same two-way writer an AM\'s own change uses');
ok(/STAGE_STATUS=\{[^}]*confirmed:'Done'/.test(P), 'and confirmed still maps to Done where a row is created');

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' assertions passed');
process.exit(fail ? 1 : 0);
