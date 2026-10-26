/* A DUE DATE TYPED SHORT RESOLVES FORWARD.
 *
 * Ray, 26 Oct 2026, over setting 2027 due dates in Workflow: "2 sounds good, it should roll
 * forward to future anw".
 *
 * The Due cell and ＋ Add task both take DDMM. The old rule kept the CURRENT year unless the
 * date was more than SIXTY DAYS past, so on 26 Oct 2026 `1501` meant 15 Jan 2026 — ten months
 * gone — while `1509` meant 15 Sep 2027, and the cliff between them was invisible. A due date is
 * a deadline, so four digits now mean the next time that day comes round.
 *
 * What that costs, and how it is paid for: the grace was the only way to type a deadline that
 * had already passed, so DDMMYYYY is now stated as the form that names a date outright, past
 * included — and every toast says the date back, because the same four digits can now mean a
 * year later than they did yesterday.
 *
 * Pinned here against a FIXED CLOCK (the page's own today() is replaced), because every one of
 * these answers depends on what day it is.
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };

const page = readFileSync(new URL('../docs/FeedSpark_Workflow.html', import.meta.url), 'utf8');
function lift(name) {
  const at = page.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('could not find ' + name + ' on the page — has it been renamed?');
  let i = page.indexOf('{', at), depth = 0, end = -1;
  for (let k = i; k < page.length; k++) {
    if (page[k] === '{') depth++;
    else if (page[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  return page.slice(at, end);
}

/* the reader, run against a clock the test owns */
function readerAt(y, m, d) {
  const src = lift('pad') + '\n' + lift('ddmmToIso')
    + '\nfunction today(){return new Date(' + y + ',' + (m - 1) + ',' + d + ');}'
    + '\nreturn ddmmToIso;';
  return new Function(src)();
}

/* ---------- 1. four digits resolve forward ---------- */
console.log('\n── DDMM means the next time that day comes round');
const oct = readerAt(2026, 10, 26);   // the day Ray asked

ok(oct('1501').iso === '2027-01-15', '15 Jan is next January, not ten months ago');
ok(oct('1501').rolled === true, '…and says it rolled');
ok(oct('0103').iso === '2027-03-01', '1 Mar is next March');
ok(oct('2608').iso === '2027-08-26', '26 Aug — two months past — rolls, where the 60-day grace kept it in 2026');
ok(oct('0112').iso === '2026-12-01', '1 Dec is still ahead, so it stays in this year');
ok(oct('0112').rolled === false, '…and says it did not roll');
ok(oct('2610').iso === '2026-10-26', 'TODAY is today — never a year away');
ok(oct('2710').iso === '2026-10-27', 'and tomorrow is tomorrow');

console.log('\n── the same four digits, read on a different day');
ok(readerAt(2026, 1, 5)('1501').iso === '2026-01-15', 'on 5 Jan 2026, 15 Jan is this month');
ok(readerAt(2027, 1, 20)('1501').iso === '2028-01-15', 'on 20 Jan 2027 it has gone, so it is 2028');
ok(readerAt(2026, 12, 31)('0101').iso === '2027-01-01', 'New Year\'s Eve: 0101 is tomorrow, across the year end');

/* ---------- 1b. WHAT THE OLD RULE DID, recorded verbatim ---------- */
/* Run against the pre-change page on 26 Oct 2026, the reader answered:
 *     1501 → 2027-01-15      (the grace did cover a date ten months past)
 *     2608 → 2027-08-26      (61 days past — one day over the cliff)
 *     2010 → 2026-10-20      (6 days past — UNDER the cliff, so a deadline in the past)
 *     3102 → "2027-02-31"    (an impossible date, written to the Project Plan as 31/02/2027)
 *     2902 → "2027-02-29"    (likewise, in a year with no 29 February)
 * The last two are the find: the ISO was assembled from the digits TYPED, never from the Date
 * that was resolved, so a typo left the FCC and reached the client's sheet as a day that does
 * not exist. Both entry points did it. */
console.log('\n── the two things the old rule got wrong');
ok(oct('2010').iso === '2027-10-20',
  'a deadline six days past resolves FORWARD — under the old 60-day grace it stayed at 2026-10-20');
ok(oct('3102').iso !== '2027-02-31' && oct('3102').iso === '',
  'and an impossible date is refused rather than written to the plan as 31/02/2027');

/* ---------- 2. eight digits name a date outright ---------- */
console.log('\n── DDMMYYYY is exact, past included — what the grace was really for');
ok(oct('15012027').iso === '2027-01-15', 'an explicit 2027 date');
ok(oct('20102026').iso === '2026-10-20', 'a date six days PAST is kept, never rolled');
ok(oct('01011999').iso === '1999-01-01', 'and so is one from years ago — the only way to backdate');
ok(oct('15012027').rolled === false, 'an exact date never reports a roll');

/* ---------- 3. a day the calendar does not have is refused, never rolled ---------- */
console.log('\n── a typo is refused out loud, never turned into a different real date');
ok(oct('3102').iso === '' && /31\/02\/2026 is not a day/.test(oct('3102').why),
  '31 Feb is refused by name (new Date(y,1,31) IS 3 March — it used to be stored as that)');
ok(oct('3109').iso === '' && /31\/09/.test(oct('3109').why), '31 Sep is refused');
ok(oct('2902').iso === '' && /29\/02\/2026 is not a day/.test(oct('2902').why),
  '29 Feb is refused in a year that has no 29 February, naming that year');
ok(readerAt(2028, 1, 1)('2902').iso === '2028-02-29', '…and accepted in a leap year');
ok(readerAt(2028, 3, 1)('2902').iso === '' && /2029/.test(readerAt(2028, 3, 1)('2902').why),
  'past 29 Feb in a leap year it rolls, finds no 29 Feb next year, and refuses naming 2029');
ok(oct('0013').iso === '' && /no month 13/.test(oct('0013').why), 'month 13 is refused');
ok(oct('1500').iso === '' && /no month 00/.test(oct('1500').why), 'month 00 is refused');
ok(oct('0000').iso === '' && oct('0000').why, 'all zeros refused');
ok(oct('150').iso === '' && /4 digits .*8/.test(oct('150').why), 'three digits names both forms');
ok(oct('150120271').iso === '' && oct('150120271').why, 'nine digits is refused');
ok(oct('').iso === '' && oct('').why === '', 'nothing in: no date, and no complaint to make');
ok(oct(null).iso === '' && oct(null).why === '', 'and the same for null');
ok(oct('15/01/2027').iso === '2027-01-15', 'punctuation a person types is stripped, not refused');

/* ---------- 4. one reader, both surfaces, and the date said back ---------- */
console.log('\n── the wiring');
ok((page.match(/function ddmmToIso\(/g) || []).length === 1, 'ONE ddmmToIso on the page');
ok(!/\/86400000\s*<\s*-60/.test(page), 'the 60-day grace is gone — no second copy of it survives');
const due = lift('editDue');
ok(/ddmmToIso\(/.test(due), 'the Due cell reads the one reader rather than its own copy of the rule');
ok(/toast\(r\.why\)/.test(due), '…and repeats its reason verbatim when it refuses');
ok(/cur\.getFullYear\(\)/.test(due),
  'the prompt is prefilled with all EIGHT digits, so pressing OK on a date that has just gone past cannot move it a year');
ok(/DDMMYYYY/.test(due) && /past included/.test(due), 'the prompt names the exact-date form and that it takes a past date');
const add = page.slice(page.indexOf('function submitAddTask('));
ok(/var dr=ddmmToIso\(dueRaw\);[\s\S]{0,80}toast\('Due — '\+dr\.why\)/.test(add),
  '＋ Add task reads the same reader and shows the same reason');
ok(/function dueWords\(/.test(page), 'there is one writer for the date a toast says back');
const setDue = lift('setDue');
ok((setDue.match(/dueWords\(/g) || []).length >= 3,
  'every path out of setDue names the date it set — a roll forward is never silent');
ok(!/toast\(iso\?'Due updated'/.test(page), 'the bare "Due updated" toast is gone');
ok(/title="DDMM for the next one/.test(page), '＋ Add task\'s own field says what both forms mean');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
