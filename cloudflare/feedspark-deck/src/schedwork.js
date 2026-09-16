/*
 * SCHEDULED WORK — the ASPL weekly schedule, read as a skip-cadence per brand (Ray, 15 Sep 2026:
 * "Scheduled Work vs. Workflow work … each week will be dated in hidden sheets … keep track of
 * the clients that are in my brand dossier, see the cadence of which column P 'AM status'
 * indicated a skip, track how many consecutive months the task was skipped for my clients").
 *
 * The source is ONE Google Sheet ("Scheduled Title and Keyword Optimisation", owned by the
 * content team) that the Workflow's Intake never sees: every week the ASPL team lists each
 * client × market × task (Keyword optimisation / Titles / Product Type / Data tagging / Social
 * & Short titles) with the hours left in the client's bucket, and the AM answers Go ahead or
 * Skip. Two eras live in the workbook:
 *
 *   • the CONSOLIDATED tab ("Content-team-task-summary", the visible one) — one row per
 *     client × task × WEEK since Jun 2025, the week in a `Dates` column, the AM's call in
 *     `AM Status` (column P), a `Reason` column for go-aheads on negative hours;
 *   • HIDDEN WEEKLY tabs before that ("KWs 1906", "Titles 0201", "PTs 1206" … back to Nov
 *     2024) — one tab per task type per week, the week ONLY in the tab name (DDMM, no year),
 *     the AM's call in `AM Confirmation` and the outcome in `Final Status`. Their layouts drift
 *     (20 header variants), so columns are resolved BY NAME per tab, never by position.
 *
 * Pure module — no KV, no fetch — shared by the worker's /api/schedule (live via the service
 * account, or the committed snapshot ops/schedule/) and tools/test_schedule.mjs.
 */

export const SCHEDULE_SHEET_ID = '16yYMQ50__qv-9V-mtIebm8Ih0-2huE452bgRz3f70Tw';

/* ---------------- small text helpers ---------------------------------------------------- */
const S = (v) => (v == null ? '' : String(v)).trim();
const low = (v) => S(v).toLowerCase();
// accent/case/punctuation-blind key — 'Estee Lauder' == 'Estée Lauder', 'All Saints' == 'AllSaints'
export function brandKey(s) {
  return low(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/* ---------------- dates ------------------------------------------------------------------ */
const pad = (n) => (n < 10 ? '0' : '') + n;
export function isoOf(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
// a cell that may hold a date: ISO 'YYYY-MM-DD[T…]', 'DD/MM/YYYY', 'DD-MM-YYYY', 'D-M-YYYY',
// or a Sheets serial (days since 1899-12-30 — what the values API returns UNFORMATTED)
export function dateCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return isoOf(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000));
  }
  const s = S(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  if (/^\d{5}$/.test(s)) return dateCell(+s);
  return null;
}
export function monthOf(iso) { return iso ? iso.slice(0, 7) : ''; }

// hidden weekly tabs: "KWs 1906" / "Titles1004" / "Kws 2111" / "PTs 0506" — DDMM with no year.
// The year is inferred from an ANCHOR (the earliest week of the consolidated tab, else today):
// the tab's date is the most recent DD/MM on or before the anchor. Tabs with no digits
// ("Titles", "Keywords") are the oldest, undated ones — kind only, week null.
const TAB_RE = /^(kws?|keywords?|titles?|pts?|product\s*types?)\s*(?:(\d{2})(\d{2}))?$/i;
export function tabInfo(title, anchorIso) {
  const m = S(title).match(TAB_RE);
  if (!m) return null;
  const p = m[1].toLowerCase();
  const kind = /^k/.test(p) ? 'kw' : /^t/.test(p) ? 'titles' : 'pt';
  if (!m[2]) return { kind, week: null };
  const dd = +m[2], mm = +m[3];
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return { kind, week: null };
  const a = anchorIso ? new Date(anchorIso + 'T00:00:00Z') : new Date();
  let y = a.getUTCFullYear();
  let d = new Date(Date.UTC(y, mm - 1, dd));
  if (d > a) d = new Date(Date.UTC(y - 1, mm - 1, dd));
  return { kind, week: isoOf(d) };
}

/* ---------------- header resolution -------------------------------------------------------- */
// find the header row (the one carrying "Client"/"Clients" + "Task"/"Time") and map columns
export function resolveHeader(values) {
  for (let r = 0; r < Math.min(values.length, 8); r++) {
    const row = values[r] || [];
    const names = row.map((c) => low(c));
    const ci = names.findIndex((x) => x === 'client' || x === 'clients');
    if (ci < 0) continue;
    const find = (...tests) => {
      for (const t of tests) { const i = names.findIndex((x) => t.test(x)); if (i >= 0) return i; }
      return -1;
    };
    return {
      headerRow: r,
      client: ci,
      task: find(/^task name/),
      ttype: find(/^task type/),
      sched: find(/^time schedule/),
      time: names.findIndex((x) => x === 'time'),
      days: find(/^days left/),
      batch: find(/^batch size/),
      dates: find(/^dates?$/),
      am: find(/^am status/),
      conf: find(/^am confirmation/),
      final: find(/^final status/),
      reason: find(/^reason/),
      pam: find(/^primary am/),
      aspl: find(/^aspl comment/),
      zoe: find(/^zoe\/xiaoli|^xiaoli note/),
      amc: find(/^am comment/),
    };
  }
  return null;
}

/* ---------------- vocab --------------------------------------------------------------------- */
// the AM's call, normalised. Precedence per row: AM Status (consolidated tab) → AM Confirmation
// (weekly tabs) → Final Status (the ASPL outcome, used only when the AM columns are blank —
// a "Cancelled" with no AM word is still a week the work did not go ahead).
const SKIP_RE = /^(skip|cancel|to cancel|no\b|not for|ignore|n\/a\b|we can skip|zoe suggests to cancel|hold)/;
const GO_RE = /^(go ?ahead|go head|yes|ok\b|okay|please go ahead|to go ahead|approved|single test|keyword embedding|products without|additional xmas|go$)/;
export function decisionOf(v) {
  const s = low(v);
  if (!s) return '';
  if (/^\(/.test(s)) return '';                                 // "(no confirmation but no hrs - xiaoli)" is a note
  if (SKIP_RE.test(s)) return 'skip';
  if (GO_RE.test(s)) return 'go';
  return '';
}
export function rowDecision(cells) {
  const tries = [['am', cells.am], ['conf', cells.conf], ['final', cells.final]];
  for (const [via, v] of tries) { const d = decisionOf(v); if (d) return { d, via }; }
  return { d: 'none', via: '' };
}
// task kind off the task name (weekly tab prefix is the fallback)
export function kindOf(taskName, taskType, tabKind) {
  const s = low(taskName) + ' | ' + low(taskType);
  if (/social|meta/.test(s)) return 'social';
  if (/short/.test(s)) return 'short';
  if (/keyword/.test(s)) return 'kw';
  if (/product type/.test(s)) return 'pt';
  if (/tagging/.test(s)) return 'tagging';
  if (/title|data field/.test(s)) return 'titles';
  return tabKind || 'other';
}
export const KIND_LABEL = { kw: 'Keywords', titles: 'Titles', pt: 'Product Type', tagging: 'Data tagging', social: 'Social titles', short: 'Short titles', other: 'Other' };
// why it was skipped (or went ahead on negative hours) — one class off the team's comment
export function reasonClass(comment, reason) {
  const classify = (s) => {
    if (!s) return '';
    if (/negative/.test(s)) return 'negative hours';
    if (/less hours|low hrs|low hours|no hours|no hrs|no time|not enough|^low\b|renews? (in|within)/.test(s)) return 'low hours';
    if (/xmas|black friday|\bbf\b|winter|gifting|seasonal|peak/.test(s)) return 'seasonal batch instead';
    if (/cdb|client defined|client-defined/.test(s)) return 'client-defined batch';
    if (/migration/.test(s)) return 'migration';
    if (/client left|suspension|suspended/.test(s)) return 'account paused';
    if (/cross\/upsell|upsell/.test(s)) return 'cross/upsell in progress';
    if (/performance/.test(s)) return 'performance issues';
    if (/risk/.test(s)) return 'risk mitigation';
    if (/relationship/.test(s)) return 'relationship concerns';
    return '';
  };
  // the AM's explicit Reason (consolidated tab, column Q) outranks the ASPL hours comment
  return classify(low(reason)) || classify(low(comment));
}
export function hoursOf(v) {
  if (typeof v === 'number') return v;
  const m = S(v).match(/(-?\d+(?:\.\d+)?)/);
  return m ? +m[1] : null;
}
const numOf = (v) => (typeof v === 'number' ? v : (S(v) === '' ? null : (isNaN(+S(v)) ? null : +S(v))));

/* ---------------- the client cell ---------------------------------------------------------- */
// "Reiss - DE" · "Accessorize - GB (Mon)" · "Harvey Nichols - GB - EN" · "[merged] Benefit Cosmetics - GB"
export function parseClient(raw) {
  let s = S(raw);
  const merged = /^\[merged\]/i.test(s);
  s = s.replace(/^\[merged\]\s*/i, '');
  const gm = s.match(/\(([^)]+)\)\s*$/);
  const group = gm ? gm[1].trim() : '';
  s = s.replace(/\s*\([^)]*\)\s*$/, '');
  const parts = s.split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  const name = parts[0] || '';
  let mkt = low(parts[1] || '');
  if (mkt === 'uk') mkt = 'gb';
  if (!/^[a-z]{2,4}$/.test(mkt)) mkt = mkt ? mkt.slice(0, 4) : '';
  return { name, mkt, group, merged };
}
// map a sheet client name onto the FCC roster (dossier ∪ plan sheets ∪ wired feeds). Exact
// key first; then the roster name equals the sheet name's FIRST WORD ("Benefit Cosmetics" →
// Benefit, "MAC Cosmetics" → MAC, "Ryobi Tools" → Ryobi). Unmatched = stays a sheet-only client.
export function resolveBrand(name, roster) {
  const k = brandKey(name);
  if (!k) return null;
  const byKey = {};
  (roster || []).forEach((r) => { const rk = brandKey(r); if (rk && !byKey[rk]) byKey[rk] = r; });
  if (byKey[k]) return byKey[k];
  const first = brandKey(S(name).split(/\s+/)[0]);
  if (first.length >= 3 && byKey[first]) return byKey[first];
  return null;
}

/* ---------------- tab → rows ---------------------------------------------------------------- */
// one tab's grid → normalised rows. `tab` = {title, hidden, values}; anchorIso for weekly tabs.
export function parseTab(tab, anchorIso, roster) {
  const values = (tab && tab.values) || [];
  const h = resolveHeader(values);
  if (!h) return [];
  const ti = tabInfo(tab.title, anchorIso);
  const tabKind = ti ? ti.kind : '';
  const tabWeek = ti ? ti.week : null;
  const out = [];
  for (let r = h.headerRow + 1; r < values.length; r++) {
    const row = values[r] || [];
    const g = (i) => (i >= 0 && i < row.length ? row[i] : '');
    const clientRaw = S(g(h.client));
    if (!clientRaw) continue;
    if (/^clients?$/i.test(clientRaw)) continue;                // a repeated header
    const c = parseClient(clientRaw);
    if (!c.name) continue;
    const week = h.dates >= 0 ? (dateCell(g(h.dates)) || tabWeek) : tabWeek;
    const dec = rowDecision({ am: g(h.am), conf: g(h.conf), final: g(h.final) });
    const comment = [g(h.aspl), g(h.zoe), g(h.amc)].map(S).filter(Boolean)
      .filter((x, i, a) => a.indexOf(x) === i).join(' · ');
    const reason = S(g(h.reason));
    const kind = kindOf(g(h.task), g(h.ttype), tabKind);
    out.push({
      w: week, tab: S(tab.title), hid: !!tab.hidden,
      c: c.name, m: c.mkt, grp: c.group, mg: c.merged,
      b: resolveBrand(c.name, roster),
      k: kind, task: S(g(h.task)) || S(g(h.ttype)),
      d: dec.d, via: dec.via,
      am: S(g(h.am)), conf: S(g(h.conf)), fin: S(g(h.final)),
      h: hoursOf(g(h.sched)), t: numOf(g(h.time)), dl: numOf(g(h.days)), bs: numOf(g(h.batch)),
      n: comment, r: reason, rc: reasonClass(comment, reason), pam: S(g(h.pam)),
    });
  }
  return out;
}

// the whole workbook: tabs = [{title, hidden, values}]. The consolidated tab's earliest week
// anchors the year inference for the DDMM weekly tabs.
export function parseWorkbook(tabs, roster, todayIso) {
  const list = (tabs || []).filter((t) => t && Array.isArray(t.values));
  let anchor = null;
  list.forEach((t) => {
    const h = resolveHeader(t.values);
    if (!h || h.dates < 0) return;
    for (let r = h.headerRow + 1; r < t.values.length; r++) {
      const d = dateCell((t.values[r] || [])[h.dates]);
      if (d && (!anchor || d < anchor)) anchor = d;
    }
  });
  const anchorIso = anchor || todayIso || isoOf(new Date());
  const rows = [];
  const tabsOut = [];
  list.forEach((t) => {
    const rs = parseTab(t, anchorIso, roster);
    const ti = tabInfo(t.title, anchorIso);
    tabsOut.push({ title: S(t.title), hidden: !!t.hidden, rows: rs.length, week: ti ? ti.week : (rs[0] && rs[0].w) || null, kind: ti ? ti.kind : 'mixed' });
    rows.push(...rs);
  });
  rows.sort((a, b) => (a.w || '') < (b.w || '') ? -1 : (a.w || '') > (b.w || '') ? 1 : 0);
  return { rows, tabs: tabsOut, anchor: anchorIso };
}

/* ---------------- cadence: months + skip streaks ------------------------------------------- */
// per brand × market × kind. A MONTH is skipped when the task was scheduled that month and the
// AM never said Go — every scheduled week that month was Skip (or Cancelled with no AM word).
// Months with no row at all are simply absent from the series (a 4-weekly cadence can miss a
// calendar month — that is not a skip, and it does not break a streak either). The streak is
// the run of trailing DECIDED months (skip or go) that are skips, counted back from the latest
// one; a month whose rows all carry no decision yet is passed over, never counted.
export function buildCadence(rows) {
  const byKey = {};
  (rows || []).forEach((r) => {
    if (!r.w) return;                                              // undated (oldest tabs) — log only
    const key = (r.b || r.c) + '|' + r.m + '|' + r.k;
    const e = byKey[key] || (byKey[key] = { client: r.b || r.c, sheetName: r.c, inRoster: !!r.b, mkt: r.m, kind: r.k, months: {}, rows: [] });
    e.rows.push(r);
    const mk = monthOf(r.w);
    const mo = e.months[mk] || (e.months[mk] = { m: mk, n: 0, skip: 0, go: 0, none: 0, hrs: 0, hrsSkip: 0, weeks: [] });
    mo.n++; mo[r.d === 'skip' ? 'skip' : r.d === 'go' ? 'go' : 'none']++;
    if (r.h) { mo.hrs += r.h; if (r.d === 'skip') mo.hrsSkip += r.h; }
    mo.weeks.push(r.w);
  });
  const out = Object.keys(byKey).map((key) => {
    const e = byKey[key];
    const months = Object.keys(e.months).sort().map((k) => {
      const mo = e.months[k];
      mo.v = mo.go ? 'go' : mo.skip ? 'skip' : 'none';
      return mo;
    });
    let streak = 0, since = null, hoursSkipped = 0, lastGo = null, lastSkip = null, lastDecided = null;
    for (let i = months.length - 1; i >= 0; i--) {
      const mo = months[i];
      if (mo.v === 'none') continue;
      if (!lastDecided) lastDecided = mo.m;
      if (mo.v === 'skip') { streak++; since = mo.m; hoursSkipped += mo.hrsSkip; }
      else break;
    }
    // trailing consecutive skipped WEEKS (rows), newest first, undecided rows passed over
    let streakWeeks = 0;
    const sorted = e.rows.slice().sort((a, b) => (a.w < b.w ? 1 : a.w > b.w ? -1 : 0));
    for (const r of sorted) { if (r.d === 'none') continue; if (r.d === 'skip') streakWeeks++; else break; }
    let skips = 0, goes = 0, hrsSkipAll = 0, latest = null;
    e.rows.forEach((r) => {
      if (r.d === 'skip') { skips++; hrsSkipAll += r.h || 0; if (!lastSkip || r.w > lastSkip) lastSkip = r.w; }
      if (r.d === 'go' && (!lastGo || r.w > lastGo)) lastGo = r.w;
      if (r.d === 'go') goes++;
      if (!latest || r.w > latest.w) latest = r;
    });
    const decided = skips + goes;
    return {
      key, client: e.client, sheetName: e.sheetName, inRoster: e.inRoster, mkt: e.mkt, kind: e.kind,
      months: months.map((mo) => ({ m: mo.m, v: mo.v, n: mo.n, skip: mo.skip, go: mo.go, hrs: mo.hrs, hrsSkip: mo.hrsSkip })),
      streak, since, streakWeeks, hoursSkipped: round1(hoursSkipped),
      lastGo, lastSkip, lastDecided, skips, goes, total: e.rows.length,
      skipRate: decided ? Math.round((skips / decided) * 100) : null,
      hoursSkippedAll: round1(hrsSkipAll),
      latest: latest ? { w: latest.w, d: latest.d, rc: latest.rc, n: latest.n, r: latest.r, t: latest.t, dl: latest.dl, h: latest.h } : null,
    };
  });
  out.sort((a, b) => (b.streak - a.streak) || (b.streakWeeks - a.streakWeeks) || a.client.localeCompare(b.client) || a.mkt.localeCompare(b.mkt) || a.kind.localeCompare(b.kind));
  return out;
}
const round1 = (n) => Math.round((n || 0) * 10) / 10;

// one line per brand for the Workflow band / dossier: worst streak, live skips this month
export function brandSummary(cadence) {
  const by = {};
  (cadence || []).forEach((c) => {
    const e = by[c.client] || (by[c.client] = { client: c.client, inRoster: c.inRoster, tasks: 0, onStreak: 0, maxStreak: 0, worst: null, hoursSkipped: 0, lastDecided: null, mkts: {} });
    e.tasks++; e.mkts[c.mkt] = 1;
    if (c.streak > 0) { e.onStreak++; e.hoursSkipped = round1(e.hoursSkipped + c.hoursSkipped); }
    if (c.streak > e.maxStreak) { e.maxStreak = c.streak; e.worst = { mkt: c.mkt, kind: c.kind, since: c.since, weeks: c.streakWeeks }; }
    if (c.lastDecided && (!e.lastDecided || c.lastDecided > e.lastDecided)) e.lastDecided = c.lastDecided;
  });
  return Object.keys(by).map((k) => Object.assign(by[k], { mkts: Object.keys(by[k].mkts).sort() }))
    .sort((a, b) => (b.maxStreak - a.maxStreak) || (b.onStreak - a.onStreak) || a.client.localeCompare(b.client));
}

// the compact row shape the API ships (log drill-down on the page)
export function compactRow(r) {
  return { w: r.w, c: r.c, b: r.b, m: r.m, k: r.k, d: r.d, via: r.via, s: r.am || r.conf || '', h: r.h, t: r.t, dl: r.dl, n: r.n, r: r.r, rc: r.rc, fin: r.fin, tab: r.tab, mg: r.mg ? 1 : 0 };
}

// ---------------------------------------------------------------------------------------------
// THE DIGEST THE HOURS POPOVER READS
//
// Ray, 16 Sep 2026: "This pop-up over retainer should also include the skipped schedule work, as
// well as an indication of the last 12 months" — and then, on seeing the hours bars stretched to
// twelve: "no i prefer the dotted green and orange bar for go and skip that you have, just try to
// fit 3 at least in that popup."
//
// So the twelve-month indication is THIS module's own cadence strip, carried to the badge: one
// cell per calendar month, green where the work went ahead, orange where the AM skipped it.
//
// Parsing the workbook costs a multi-tab walk the badge must never pay, so the strips are derived
// once here and stored as a tiny record. Encoded a character per month:
//   g go · s skipped · n scheduled but undecided · - not scheduled that month
// Four codes, twelve characters, three tasks per brand — the whole estate is a couple of KB.
// ---------------------------------------------------------------------------------------------

export const DIGEST_MONTHS = 12;
export const DIGEST_TASKS = 3;          // "fit 3 at least in that popup"
const CODE = { go: 'g', skip: 's', none: 'n' };

/** The last N calendar months ending with `now`'s month, oldest first, as 'YYYY-MM'. */
export function digestMonths(now, n) {
  const d = new Date(now || Date.now());
  d.setUTCDate(1);
  const out = [];
  for (let i = (n || DIGEST_MONTHS) - 1; i >= 0; i--) {
    const x = new Date(d.getTime());
    x.setUTCMonth(x.getUTCMonth() - i);
    out.push(x.toISOString().slice(0, 10).slice(0, 7));
  }
  return out;
}

/**
 * One cadence entry → its last-N-month strip.
 *
 * A month the schedule never offered is '-', NOT a skip: nothing was declined because nothing was
 * put forward. Conflating the two would turn every quiet summer into a skip streak.
 */
export function stripOf(entry, now, n) {
  const keys = digestMonths(now, n);
  const by = {};
  ((entry && entry.months) || []).forEach((m) => { by[m.m] = m; });
  return keys.map((k) => (by[k] ? (CODE[by[k].v] || 'n') : '-')).join('');
}

/**
 * cadence → { <client>: { tasks, onStreak, maxStreak, hoursSkipped, lastDecided, months, rows } }
 *
 * `rows` are the DIGEST_TASKS worth showing: the ones on the longest current skip streak first,
 * because those are what an AM needs to see beside a negative balance. A brand with nothing
 * skipped still ships its rows — a strip of green is the answer to "are they taking the work",
 * and an empty block would read as "no data" rather than "all good".
 */
export function skipDigest(cadence, now, opts) {
  const o = opts || {};
  const months = digestMonths(now, o.months || DIGEST_MONTHS);
  const want = o.tasks || DIGEST_TASKS;
  const by = {};
  (cadence || []).forEach((c) => {
    if (!c || !c.client) return;
    const e = by[c.client] || (by[c.client] = { tasks: 0, onStreak: 0, maxStreak: 0, hoursSkipped: 0, lastDecided: null, months, rows: [] });
    e.tasks++;
    if (c.streak > 0) { e.onStreak++; e.hoursSkipped = round1(e.hoursSkipped + (c.hoursSkipped || 0)); }
    if ((c.streak || 0) > e.maxStreak) e.maxStreak = c.streak || 0;
    if (c.lastDecided && (!e.lastDecided || c.lastDecided > e.lastDecided)) e.lastDecided = c.lastDecided;
    const s = stripOf(c, now, o.months || DIGEST_MONTHS);
    e.rows.push({ mkt: c.mkt || '', kind: KIND_LABEL[c.kind] || c.kind || '', streak: c.streak || 0,
      hrsSkip: round1(c.hoursSkipped || 0), since: c.since || null, s });
  });
  Object.keys(by).forEach((k) => {
    const e = by[k];
    // longest streak first, then the strip with the most decided months (the fullest record),
    // then alphabetically so the same three appear every time rather than shuffling on a tie
    e.rows.sort((a, b) => (b.streak - a.streak)
      || (b.s.replace(/-/g, '').length - a.s.replace(/-/g, '').length)
      || (a.kind + a.mkt).localeCompare(b.kind + b.mkt));
    e.more = Math.max(0, e.rows.length - want);
    e.rows = e.rows.slice(0, want);
  });
  return by;
}
