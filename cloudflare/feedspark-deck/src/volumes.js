/*
 * WORK VOLUMES — every workstream on an account, bucketed by month (Ray, 15 Sep 2026: "a chart
 * generator for any kind of work-volumes type analysis … I'm looking at Reiss for the past six
 * months of work. With the data knowledge of all the current workstreams — project plans,
 * emails, calls, and scheduled work — the chart can be customised, edited, personalised for AMs
 * to see the breakdown of volumes for each area").
 *
 * One brand, one window, six streams, each counted per month with its own breakdown dimensions:
 *   plan      — project-plan tasks (cron-warmed planlive:<sheet>)      dims: category · status · owner
 *   emails    — captured client emails (KV gmailinbox)                dims: decision · kind
 *   calls     — call-notes action items (KV callactions)               dims: meeting · owner
 *   briefs    — Workflow tickets (KV briefs)                           dims: stage · category · source
 *   schedule  — the ASPL weekly schedule (schedwork rows)              dims: task · decision  (+ hours)
 *   results   — keyword-optimisation result rounds (KV kwresults)      dims: market · verdict
 *
 * Pure module — no KV, no fetch — the worker's /api/volumes feeds it what it read and the page
 * renders what comes back; tools/test_volumes.mjs drives it directly. Every month key is
 * 'YYYY-MM'; a record whose date cannot be read lands in `undated` (counted, never guessed).
 */

const pad = (n) => (n < 10 ? '0' : '') + n;
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// any date-ish value → 'YYYY-MM' or '' : epoch ms, ISO, DD/MM/YYYY, DD-MM-YY, 'Jul 25' / 'July-2026'
// month labels (the plan's section headers), Sheets serials, RFC-2822 mail dates.
export function monthKey(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    if (v > 1e11) { const d = new Date(v); return isNaN(d) ? '' : d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); }
    if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); }
    return '';
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (m) return m[1] + '-' + m[2];
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const mo = +m[2]; if (mo >= 1 && mo <= 12) return y + '-' + pad(mo); return ''; }
  m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*['\s\-\/,.]*((?:20)?\d{2})\b/i);
  if (m) { let y = +m[2]; if (y < 100) y += 2000; return y + '-' + pad(MON.indexOf(m[1].slice(0, 3).toLowerCase()) + 1); }
  if (/^\d{5}$/.test(s)) return monthKey(+s);
  if (/^\d{12,}$/.test(s)) return monthKey(+s);
  const d = new Date(s);                                  // RFC-2822 mail dates, 'Tue, 12 Aug 2026 …'
  if (!isNaN(d) && /\d{4}/.test(s)) return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  return '';
}
// the last N month keys ending at `endKey` (inclusive), oldest first
export function monthRange(n, endKey) {
  const out = [];
  const [y0, m0] = String(endKey).split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    let y = y0, mo = m0 - 1 - i;
    while (mo < 0) { mo += 12; y--; }
    out.push(y + '-' + pad(mo + 1));
  }
  return out;
}
export function monthLabel(k) { const p = String(k).split('-'); return k ? MON[+p[1] - 1].replace(/^./, (c) => c.toUpperCase()) + ' ' + p[0].slice(2) : ''; }

/* ---------------- the bucket builder ------------------------------------------------------ */
// records → { n, byMonth{m:n}, undated, dims{dim:{value:{m:n}}}, sums{name:{m:n}} }
function bucket(months, records, monthOfRec, dimsOfRec, sumsOfRec) {
  const inWin = {}; months.forEach((m) => { inWin[m] = 1; });
  const out = { n: 0, byMonth: {}, undated: 0, outside: 0, dims: {}, sums: {} };
  months.forEach((m) => { out.byMonth[m] = 0; });
  records.forEach((r) => {
    const m = monthOfRec(r);
    if (!m) { out.undated++; return; }
    if (!inWin[m]) { out.outside++; return; }
    out.n++; out.byMonth[m]++;
    const dims = dimsOfRec(r) || {};
    Object.keys(dims).forEach((dim) => {
      const v = dims[dim] == null || dims[dim] === '' ? '—' : String(dims[dim]);
      const d = out.dims[dim] || (out.dims[dim] = {});
      const row = d[v] || (d[v] = {});
      row[m] = (row[m] || 0) + 1;
    });
    const sums = sumsOfRec ? sumsOfRec(r) : null;
    if (sums) Object.keys(sums).forEach((k) => { const s = out.sums[k] || (out.sums[k] = {}); s[m] = Math.round(((s[m] || 0) + (+sums[k] || 0)) * 10) / 10; });
  });
  return out;
}
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());

/* ---------------- per-stream readers ------------------------------------------------------- */
export const CAT_LABEL = { title: 'Titles', keyword: 'Keywords', data: 'Data fields', image: 'Imagery', custom_label: 'Custom labels', product_type: 'Product type', technical: 'Feed & technical', channel: 'Channels', test: 'Testing', account: 'Account', opt: 'Optimisation' };
export const BUCKET_LABEL = { open: 'Open', progress: 'In progress', done: 'Done', hold: 'On hold', briefed: 'Briefed' };
export const STAGE_LABEL = { intake: 'Intake', briefed: 'Briefed', progress: 'In progress', blocked: 'Blocked', done: 'Done — ASPL', running: 'Test running', analysis: 'Analysis', confirmed: 'Confirmed' };
export const DECISION_LABEL = { task: 'Filed as task', briefed: 'Briefed', notask: 'Not a task', techam: 'To TechAM', pending: 'Awaiting triage' };
export const KIND_LABEL = { kw: 'Keywords', titles: 'Titles', pt: 'Product Type', tagging: 'Data tagging', social: 'Social titles', short: 'Short titles', other: 'Other' };

// project-plan tasks {t,o,s,b,c,d} (planlive shape) — month from the Due / month-section date
export function planStream(tasks, months) {
  return bucket(months, tasks || [], (t) => monthKey(t.d), (t) => ({
    category: CAT_LABEL[t.c] || cap(t.c || 'opt'),
    status: BUCKET_LABEL[t.b] || cap(t.b || t.s || 'open'),
    owner: (String(t.o || '').trim() || '—').slice(0, 40),
  }));
}
// captured emails {id, from, subject, date, client, kind, dismissed, decidedAs}
export function emailStream(items, months) {
  return bucket(months, items || [], (e) => monthKey(e.date), (e) => ({
    decision: DECISION_LABEL[e.dismissed ? (e.decidedAs || 'notask') : 'pending'],
    kind: e.kind === 'kwresult' ? 'Result update' : (e.briefable ? 'Briefable request' : 'Client email'),
  }));
}
// call-notes action items {id, mid, call, client, when, owner, task}
export function callStream(calls, months) {
  return bucket(months, calls || [], (a) => monthKey(a.when), (a) => ({
    meeting: (String(a.call || '').trim() || '—').slice(0, 60),
    owner: (String(a.owner || '').trim() || '—').slice(0, 40),
  }));
}
// Workflow tickets {id, client, created, status, cat, source}
export function briefStream(briefs, months) {
  return bucket(months, briefs || [], (b) => monthKey(b.created), (b) => ({
    stage: STAGE_LABEL[b.status] || cap(b.status || 'intake'),
    category: CAT_LABEL[b.cat] || (b.cat ? cap(b.cat) : 'Optimisation'),
    source: b.source === 'email' ? 'From email' : b.source === 'call' ? 'From call' : 'From plan',
  }));
}
// scheduled-work rows (compactRow shape) {w, b, m, k, d, h}
export function scheduleStream(rows, months) {
  return bucket(months, rows || [], (r) => monthKey(r.w), (r) => ({
    task: KIND_LABEL[r.k] || cap(r.k),
    decision: r.d === 'go' ? 'Went ahead' : r.d === 'skip' ? 'Skipped' : 'No decision',
    market: String(r.m || '').toUpperCase() || '—',
  }), (r) => ({ hours: r.h || 0, hoursSkipped: r.d === 'skip' ? (r.h || 0) : 0, hoursDelivered: r.d === 'go' ? (r.h || 0) : 0 }));
}
// keyword-optimisation result rounds {id, client, mkt, period, when, verdict}
export function resultStream(kwres, months) {
  return bucket(months, kwres || [], (k) => monthKey(k.when), (k) => ({
    market: String(k.mkt || '').toUpperCase() || '—',
    verdict: k.verdict === 'good' ? 'Positive' : k.verdict === 'bad' ? 'Negative' : k.verdict === 'mixed' ? 'Mixed' : 'Unclear',
  }));
}

/* ---------------- the payload --------------------------------------------------------------- */
export const STREAMS = [
  { key: 'plan', label: 'Project-plan tasks', short: 'Plan', dims: ['category', 'status', 'owner'] },
  { key: 'emails', label: 'Client emails', short: 'Emails', dims: ['decision', 'kind'] },
  { key: 'calls', label: 'Call actions', short: 'Calls', dims: ['meeting', 'owner'] },
  { key: 'briefs', label: 'Briefs (tickets)', short: 'Briefs', dims: ['stage', 'category', 'source'] },
  { key: 'schedule', label: 'Scheduled work', short: 'Schedule', dims: ['task', 'decision', 'market'] },
  { key: 'results', label: 'Result rounds', short: 'Results', dims: ['market', 'verdict'] },
];
export function buildVolumes(input) {
  const months = input.months || monthRange(input.n || 6, input.end || monthKey(Date.now()));
  const streams = {
    plan: planStream(input.plan, months),
    emails: emailStream(input.emails, months),
    calls: callStream(input.calls, months),
    briefs: briefStream(input.briefs, months),
    schedule: scheduleStream(input.schedule, months),
    results: resultStream(input.results, months),
  };
  STREAMS.forEach((s) => { const m = input.meta && input.meta[s.key]; if (m) streams[s.key].meta = m; });
  const total = {}; months.forEach((m) => { total[m] = STREAMS.reduce((a, s) => a + (streams[s.key].byMonth[m] || 0), 0); });
  return { months, labels: months.map(monthLabel), streams, total, n: STREAMS.reduce((a, s) => a + streams[s.key].n, 0) };
}
