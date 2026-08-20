// Task due-today reminders — Ray's ask: "auto-send reminder to owner (ray,steven)@feedspark.com
// of those tasks whom status are due today but still stay open by 12pm GMT time".
// Pure logic only (unit-tested): the worker's 12:00 GMT cron firing feeds it the parsed plan
// tasks (the same parsePlanRows output the plan warm just refreshed) and queues the built
// emails into the Label Guard outbox, which the Gmail bridge drains from Ray's own mailbox.

// Owner first-name → mailbox. Ray named ray + steven; extend here when more owners want nudges.
export const OWNER_EMAILS = { ray: 'ray@feedspark.com', steven: 'steven@feedspark.com' };

// The PAGE's bucketOf, verbatim — NOT the worker's planBucket, which lacks the briefed bucket:
// a task already Briefed has been actioned and must not be nudged as "still open".
export function taskBucket(s) {
  s = String(s || '').toLowerCase();
  if (/(done|complete|finish|live|delivered|actioned|signed)/.test(s)) return 'done';
  if (/(hold|park)/.test(s)) return 'hold';
  if (/brief/.test(s)) return 'briefed';
  if (/(progress|wip|ongoing|review)/.test(s)) return 'progress';
  if (/client/.test(s)) return 'client';
  return 'open';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// A plan row's date is only a REAL deadline when it names a day. parsePlanRows falls back to
// the month-section label (ISO yyyy-mm-01) for dateless rows — treating that as "due on the
// 1st" would nudge every task in the month's section, so the ISO month shape is never a day.
export function parseDueDay(d) {
  d = String(d || '').trim();
  if (!d) return null;
  if (/^\d{4}-\d{2}-01$/.test(d)) return null;               // month-section fallback, not a deadline
  let m = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?$/.exec(d);   // 20/08/2026 · 20/08 · 20.8.26
  if (m) { const y = m[3] == null ? null : (+m[3] < 100 ? 2000 + (+m[3]) : +m[3]); return { dd: +m[1], mm: +m[2], y }; }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);                    // ISO with a real day
  if (m) return { dd: +m[3], mm: +m[2], y: +m[1] };
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\s*(\d{4})?$/i.exec(d);   // 20 Aug / 3rd September 2026
  if (m) { const mm = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; if (mm) return { dd: +m[1], mm, y: m[3] ? +m[3] : null }; }
  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/i.exec(d);  // Aug 20, 2026
  if (m) { const mm = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; if (mm) return { dd: +m[2], mm, y: m[3] ? +m[3] : null }; }
  return null;
}
export function isDueToday(d, now) {
  const p = parseDueDay(d);
  if (!p || p.dd < 1 || p.dd > 31 || p.mm < 1 || p.mm > 12) return false;
  const n = new Date(now);
  return p.dd === n.getUTCDate() && p.mm === n.getUTCMonth() + 1 && (p.y == null || p.y === n.getUTCFullYear());
}

// 'Ray / Steven', 'Steven (FS)', 'Ray & Venki' → first-name tokens for the mailbox map
export function ownerKeys(owner) {
  return String(owner || '').replace(/\(.*?\)/g, ' ')
    .split(/[/,&+]|\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export function dd8(now) { const n = new Date(now); const p = (x) => ('0' + x).slice(-2); return '' + n.getUTCFullYear() + p(n.getUTCMonth() + 1) + p(n.getUTCDate()); }
const humanDay = (now) => new Date(now).toUTCString().slice(0, 11).replace(/,/, '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// groups: [{brands: 'Monsoon / Accessorize', tasks: parsePlanRows() output}] — one group per
// SHEET (brands sharing a sheet share its rows; grouping stops the same task mailing twice).
// Returns one email per matched owner listing every due-today-still-open task they hold.
export function buildDueReminders(groups, opts) {
  opts = opts || {};
  const owners = opts.owners || OWNER_EMAILS;
  const now = opts.now || 0;
  const per = {};
  for (const g of groups || []) {
    for (const t of g.tasks || []) {
      if (taskBucket(t.s) !== 'open') continue;
      if (!isDueToday(t.d, now)) continue;
      const ks = Array.from(new Set(ownerKeys(t.o).filter((k) => owners[k])));
      for (const k of ks) (per[k] = per[k] || []).push({ brands: g.brands, task: t.t, status: t.s || 'Open', due: t.d });
    }
  }
  const day = dd8(now);
  return Object.keys(per).sort().map((k) => {
    const list = per[k];
    const subject = '⏰ ' + list.length + ' task' + (list.length === 1 ? '' : 's') + ' due today, still open — ' + humanDay(now);
    const body = 'Hi ' + cap(k) + ',\n\n'
      + 'Nudge from the Workflow — ' + (list.length === 1 ? 'this task is' : 'these tasks are') + ' due TODAY and still sitting Open in the plan:\n\n'
      + list.map((x) => '• ' + x.brands + ' — ' + x.task + '  (' + x.status + ', due ' + x.due + ')').join('\n')
      + '\n\nIf one is already moving, set it to In progress (or Done) in the Workflow and the nudge stops.\n'
      + 'https://feedspark.ray-vtt.workers.dev/workflow';
    return { id: 'taskrem:' + day + ':' + k, to: owners[k], owner: k, n: list.length, subject, body };
  });
}
