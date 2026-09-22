/* Build Log — SUGGESTED NEXT BUILDS (Ray, 22 Sep 2026: "within Build Log also start suggesting
 * the top five new features to build for FCC to improve revenue, churn, client retention, AM
 * efficiency, increase billable hours, or reduce the time taken for each account work").
 *
 * The obvious build is a wishlist in git, and it would be wrong within a week: it would suggest
 * the same five features whatever the book was doing, and nothing on it could be argued with.
 * So a suggestion here is DERIVED — every candidate play carries a rule that reads the FCC's own
 * live stores and either produces a number or produces nothing. A play with no evidence is not
 * ranked low, it is ABSENT, and a signal nobody has synced yet is named as unread rather than
 * counted as a zero: "no negative balances" and "the Task Manager has never synced" are opposite
 * findings and the panel must never print one when it means the other. The same rule the guards,
 * the Playbook and the hours badge already follow.
 *
 * Scoring is stated, not hidden (BASIS below), because the ranking is an argument the reader is
 * entitled to disagree with: lever weight x evidence size x effort factor. Evidence size is the
 * measured number against a `full` threshold written into the rule, so a rule can never out-score
 * another by measuring itself in a bigger unit.
 *
 * The candidate list is FIXED and finite — ten plays today. That is deliberate: an LLM asked to
 * invent features would invent the numbers under them too, which is the one thing every figure in
 * this codebase is not allowed to be. The panel says how many candidates it ranked, so a reader can
 * see it is a backlog being prioritised rather than an oracle. Add a rule to add a play.
 *
 * Pure: no fetch, no KV, no DOM. The worker reads the stores and hands them in; the harness
 * (tools/test_buildsuggest.mjs) runs the same table.
 */

/* Ray's own six levers, in his words. Weights say which lever wins a tie, not which matters:
 * money already lost (revenue) and an account at risk (churn) outrank an hour saved, because an
 * hour saved is recoverable next week and a churned client is not. */
export const LEVERS = {
  revenue:    { w: 1.00, label: 'Revenue' },
  churn:      { w: 1.00, label: 'Churn risk' },
  retention:  { w: 0.95, label: 'Retention' },
  billable:   { w: 0.90, label: 'Billable hours' },
  efficiency: { w: 0.80, label: 'AM efficiency' },
  time:       { w: 0.80, label: 'Time per account' },
};

/* A week, three weeks, a quarter. The factor is deliberately steep: two small builds that each
 * land next week beat one large one that lands at Christmas, and a ranking that ignored effort
 * would recommend the biggest thing on the list every single time. */
export const EFFORT = { S: 1.00, M: 0.72, L: 0.45 };
export const EFFORT_LABEL = { S: 'days', M: '1–2 weeks', L: 'a month+' };

export const BASIS = {
  formula: 'score = lever weight × evidence size × effort factor',
  size: 'evidence size = the measured number ÷ the rule’s own full-marks threshold, capped at 1',
  levers: 'revenue and churn 1.00 · retention 0.95 · billable 0.90 · efficiency and time 0.80',
  effort: 'S 1.00 · M 0.72 · L 0.45',
  honest: 'a play whose signal has never been synced is listed as unread, never scored as zero',
};

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const r1 = (n) => Math.round(n * 10) / 10;
const DAY = 86400000;

/* Word-level dedupe against what is already queued, in build, or shipped. Matching on a rule's
 * own distinctive words rather than its title, because the queue is typed by a human and a PR
 * title is written by whoever built it — neither will ever equal the rule's wording. Every key
 * must appear for a match, so "quote" alone can never suppress the quote-chase play. */
export function alreadyOn(rule, done) {
  const keys = (rule.keys || []).map((k) => String(k).toLowerCase());
  if (!keys.length) return null;
  for (const d of done || []) {
    const t = String((d && d.title) || d || '').toLowerCase();
    if (!t) continue;
    if (keys.every((k) => t.indexOf(k) >= 0)) return { where: (d && d.where) || 'queue', title: (d && d.title) || String(d) };
  }
  return null;
}

/* ---------------------------------------------------------------- the candidate plays
 * Each rule reads ONE question off the live stores and answers with a number, a sentence naming
 * where the number came from, and nothing else. `full` is the value that scores full marks —
 * chosen as "the size at which this is plainly the most important thing on the list", so the
 * thresholds are arguable on purpose and sit here rather than buried in the maths. */
export const RULES = [
  {
    id: 'overrun-report',
    lever: 'revenue',
    effort: 'M',
    title: 'Over-servicing report — turn a negative balance into a billable conversation',
    what: 'A per-account statement of the hours delivered beyond the block, with the tasks that consumed them, ready to send.',
    keys: ['over-servicing'],
    full: 200,
    read(sig) {
      const idx = sig.tm;
      if (!idx || !Object.keys(idx).length) return { unread: 'the Task Manager has not synced a balance yet' };
      let hours = 0, clients = 0;
      Object.keys(idx).forEach((c) => {
        const b = num(idx[c] && idx[c].balance);
        if (b < 0) { hours += -b; clients++; }
      });
      return { n: r1(hours), unit: 'hours', why: r1(hours) + ' hours delivered beyond the block across ' + clients + ' account' + (clients === 1 ? '' : 's') + ', carried month after month.', src: 'Task Manager balances' };
    },
  },
  {
    id: 'skip-winback',
    lever: 'churn',
    effort: 'M',
    title: 'Skip win-back — propose the optimisation the client keeps deferring',
    what: 'A monthly per-client note listing the scheduled work skipped, what it would cost in hours, and what it is expected to move.',
    keys: ['win-back'],
    full: 400,
    read(sig) {
      const by = (sig.skip && (sig.skip.clients || sig.skip)) || null;
      if (!by || !Object.keys(by).length) return { unread: 'the scheduled-work sheet has not been read yet' };
      let hrs = 0, onStreak = 0, brands = 0;
      Object.keys(by).forEach((c) => {
        const e = by[c] || {};
        if (num(e.onStreak) > 0) { brands++; onStreak += num(e.onStreak); }
        hrs += num(e.hoursSkipped);
      });
      return { n: r1(hrs), unit: 'hours', why: r1(hrs) + ' hours of scheduled optimisation skipped, with ' + onStreak + ' tasks on a streak across ' + brands + ' brand' + (brands === 1 ? '' : 's') + '.', src: 'scheduled-work cadence' };
    },
  },
  {
    id: 'quote-chase',
    lever: 'revenue',
    effort: 'S',
    title: 'Quote chase — a follow-up the day a quote goes quiet',
    what: 'A quote with no stage change for a fortnight drafts its own chase email to the client contact.',
    keys: ['quote', 'chase'],
    full: 25000,
    read(sig, now) {
      const q = sig.quotes;
      if (!q || !Object.keys(q).length) return { unread: 'no quotes have been saved yet' };
      let gbp = 0, n = 0;
      Object.keys(q).forEach((k) => {
        const rec = q[k] || {};
        if (rec.stage === 'Billed' || rec.stage === 'Declined' || rec.superseded) return;
        const last = num(rec.t2) || num((rec.hist || [])[(rec.hist || []).length - 1] && rec.hist[rec.hist.length - 1].t) || num(rec.t);
        if (!last || now - last < 14 * DAY) return;
        gbp += num(rec.gross); n++;
      });
      return { n: Math.round(gbp), unit: '£', why: '£' + Math.round(gbp).toLocaleString('en-GB') + ' sitting on ' + n + ' quote' + (n === 1 ? '' : 's') + ' with no movement for a fortnight.', src: 'saved quotes' };
    },
  },
  {
    id: 'invoice-handoff',
    lever: 'revenue',
    effort: 'S',
    title: 'Invoice handoff — a weekly finance export of delivered, unbilled work',
    what: 'Everything the rail says is Delivered but not Billed, exported in the finance book’s own format.',
    keys: ['invoice', 'handoff'],
    full: 15000,
    read(sig) {
      const q = sig.quotes;
      if (!q || !Object.keys(q).length) return { unread: 'no quotes have been saved yet' };
      let gbp = 0, n = 0;
      Object.keys(q).forEach((k) => {
        const rec = q[k] || {};
        if (rec.stage !== 'Delivered' || rec.superseded) return;
        gbp += num(rec.gross); n++;
      });
      return { n: Math.round(gbp), unit: '£', why: '£' + Math.round(gbp).toLocaleString('en-GB') + ' of work is delivered and not yet billed, across ' + n + ' quote' + (n === 1 ? '' : 's') + '.', src: 'saved quotes' };
    },
  },
  {
    id: 'auto-chase',
    lever: 'efficiency',
    effort: 'M',
    title: 'Auto-chase — the escalation list sends its own reminder',
    what: 'A ticket sitting in one court past its SLA drafts the chase to whoever is holding it, instead of waiting to be noticed.',
    keys: ['auto-chase'],
    full: 15,
    read(sig, now) {
      const b = sig.briefs;
      if (!b || !Object.keys(b).length) return { unread: 'no briefs are in the pipeline yet' };
      const DONE = { confirmed: 1 };
      let n = 0, oldest = 0;
      Object.keys(b).forEach((k) => {
        const t = b[k] || {};
        if (DONE[t.status]) return;
        const moved = num(t.updated) || num(t.created);
        if (!moved) return;
        const days = (now - moved) / DAY;
        if (days >= 10) { n++; if (days > oldest) oldest = days; }
      });
      return { n, unit: 'tickets', why: n + ' ticket' + (n === 1 ? '' : 's') + ' have not moved a stage in over ten days, the oldest for ' + Math.round(oldest) + '.', src: 'brief pipeline' };
    },
  },
  {
    id: 'gap-to-quote',
    lever: 'billable',
    effort: 'M',
    title: 'Gap-to-quote — price every required-attribute gap as scoped work',
    what: 'The Golden Record gaps on a feed become a priced, scoped piece of work in one click, rather than a finding an AM has to translate.',
    keys: ['gap-to-quote'],
    full: 20,
    read(sig) {
      const g = sig.golden;
      if (!g || !Object.keys(g).length) return { unread: 'no feed has been scored for the Golden Record yet' };
      let n = 0, attrs = 0;
      Object.keys(g).forEach((k) => {
        const f = g[k] || {};
        const miss = (f.reqMissing || []).length + (f.condMissing || []).length;
        if (miss > 0) { n++; attrs += miss; }
      });
      return { n, unit: 'feeds', why: n + ' feed' + (n === 1 ? '' : 's') + ' carry ' + attrs + ' missing required or conditional attributes between them.', src: 'Golden Record index' };
    },
  },
  {
    id: 'quality-packs',
    lever: 'billable',
    effort: 'M',
    title: 'Content-quality fix packs — the rules a feed breaks, priced per attribute',
    what: 'Every broken content-quality rule becomes a line on a quote with the share of the catalogue it affects.',
    keys: ['content-quality', 'pack'],
    full: 12,
    read(sig) {
      const g = sig.golden;
      if (!g || !Object.keys(g).length) return { unread: 'no feed has been scored for the Golden Record yet' };
      const scored = Object.keys(g).filter((k) => typeof g[k].q === 'number');
      if (!scored.length) return { unread: 'no feed has been analysed for content quality yet' };
      const below = scored.filter((k) => g[k].q < 75);
      return { n: below.length, unit: 'feeds', why: below.length + ' of ' + scored.length + ' analysed feeds score under 75 for content quality, which is the band Google’s own rules call violations.', src: 'content-quality scores' };
    },
  },
  {
    id: 'coverage-sweep',
    lever: 'time',
    effort: 'S',
    title: 'Coverage sweep — every wired feed scanned before the Monday call',
    what: 'A feed that has never been scanned is chased automatically, so the estate board is never partly blank when it is read.',
    keys: ['coverage sweep'],
    full: 20,
    read(sig) {
      const f = sig.feeds;
      if (!f || !num(f.wired)) return { unread: 'the feed roster has not been read yet' };
      const never = Math.max(0, num(f.wired) - num(f.scanned));
      return { n: never, unit: 'feeds', why: never + ' of ' + num(f.wired) + ' wired Shopping feeds have never been scanned, so the estate reads partly blank.', src: 'feed roster vs the scan index' };
    },
  },
  {
    id: 'quiet-accounts',
    lever: 'retention',
    effort: 'S',
    title: 'Quiet-account radar — flag an account with no work raised in sixty days',
    what: 'An account nobody has briefed, called or scanned for two months surfaces on Leadership before the renewal does.',
    keys: ['quiet-account'],
    full: 8,
    read(sig, now) {
      const b = sig.briefs;
      const roster = sig.clients || [];
      if (!roster.length) return { unread: 'the client roster has not been read yet' };
      if (!b || !Object.keys(b).length) return { unread: 'no briefs are in the pipeline yet' };
      const last = {};
      Object.keys(b).forEach((k) => {
        const t = b[k] || {};
        const c = String(t.client || '');
        const when = num(t.created);
        if (c && when > (last[c] || 0)) last[c] = when;
      });
      const quiet = roster.filter((c) => !last[c] || now - last[c] > 60 * DAY);
      return { n: quiet.length, unit: 'accounts', why: quiet.length + ' of ' + roster.length + ' accounts have had no brief raised in sixty days.', src: 'brief pipeline vs the client roster' };
    },
  },
  {
    id: 'arrivals-autobrief',
    lever: 'billable',
    effort: 'M',
    title: 'Arrivals auto-brief — new products become a briefed optimisation on their own',
    what: 'A month’s arrivals raise their own titles-and-keywords brief at the lead time, instead of waiting for an AM to read a chart.',
    keys: ['auto-brief'],
    full: 20000,
    read(sig) {
      const v = sig.arrivals;
      if (!v || !Object.keys(v).length) return { unread: 'no feed has been read for first-seen dates yet' };
      let n = 0, feeds = 0;
      const month = lastCompleteMonth(sig.now);
      Object.keys(v).forEach((k) => {
        const m = (v[k] && v[k].m) || {};
        const c = num(m[month]);
        if (c > 0) { n += c; feeds++; }
      });
      if (!feeds) return { unread: 'no arrivals recorded for the last complete month yet' };
      return { n, unit: 'products', why: n.toLocaleString('en-GB') + ' products arrived across ' + feeds + ' feeds last month, each one needing a title and keywords.', src: 'first-seen dates' };
    },
  },
];

/* The last COMPLETE month as YYYY-MM. The running month is never used: it is a part-month by
 * definition, so counting it would make every account look like arrivals had collapsed. */
export function lastCompleteMonth(now) {
  const d = new Date(now || Date.now());
  const y = d.getUTCFullYear(), m = d.getUTCMonth();  // 0-based; month-1 is the previous month
  const p = new Date(Date.UTC(y, m - 1, 1));
  return p.getUTCFullYear() + '-' + String(p.getUTCMonth() + 1).padStart(2, '0');
}

export function sizeOf(n, full) {
  if (!(full > 0)) return 0;
  return Math.max(0, Math.min(1, n / full));
}

export function scoreOf(rule, n) {
  const lev = LEVERS[rule.lever] || { w: 0.5 };
  const size = sizeOf(n, rule.full);
  return Math.round(lev.w * size * (EFFORT[rule.effort] || 0.5) * 1000) / 1000;
}

/* sig = { tm, skip, quotes, briefs, golden, arrivals, feeds:{wired,scanned}, clients:[], now }
 * done = [{title, where}] — the queue, the open PRs and the merged PRs, so a play that is already
 * somebody's job is never suggested again.
 *
 * Returns the five highest-scoring plays, plus everything it did not rank and WHY: `clear` (the
 * evidence says there is nothing to do — a good state, worth seeing), `unread` (the signal has
 * never been synced, so the FCC cannot answer), and `done` (already queued, in build or shipped). */
export function suggest(sig, done, opts) {
  const o = opts || {};
  const now = num(sig && sig.now) || Date.now();
  const top = o.top || 5;
  const s = Object.assign({}, sig || {}, { now });
  const ranked = [], clear = [], unread = [], taken = [];

  for (const rule of RULES) {
    const on = alreadyOn(rule, done);
    if (on) { taken.push({ id: rule.id, title: rule.title, where: on.where, as: on.title }); continue; }
    let out = null;
    try { out = rule.read(s, now); } catch (e) { out = { unread: 'the signal could not be read' }; }
    if (!out || out.unread) { unread.push({ id: rule.id, title: rule.title, lever: rule.lever, why: (out && out.unread) || 'no reading' }); continue; }
    const n = num(out.n);
    const row = {
      id: rule.id, title: rule.title, what: rule.what,
      lever: rule.lever, leverLabel: (LEVERS[rule.lever] || {}).label || rule.lever,
      effort: rule.effort, effortLabel: EFFORT_LABEL[rule.effort] || '',
      n, unit: out.unit || '', why: out.why || '', src: out.src || '',
      size: Math.round(sizeOf(n, rule.full) * 100) / 100, full: rule.full,
      score: scoreOf(rule, n),
    };
    if (n <= 0) { clear.push(row); continue; }
    ranked.push(row);
  }

  // highest score first; a tie goes to the cheaper build, then to the rule's own order so the
  // same five appear in the same order on every load rather than shuffling
  ranked.sort((a, b) => (b.score - a.score)
    || ((EFFORT[b.effort] || 0) - (EFFORT[a.effort] || 0))
    || RULES.findIndex((r) => r.id === a.id) - RULES.findIndex((r) => r.id === b.id));

  return { at: now, top: ranked.slice(0, top), rest: ranked.slice(top), clear, unread, taken,
    candidates: RULES.length, basis: BASIS };
}
