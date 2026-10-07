/**
 * src/outcomes.js — WHAT THE HOURS MOVED.
 *
 * Ray, 28 Sep 2026, on the Task Manager's chart card: "find more way even making data dissectment
 * even more useful - especially if im trying to get charts for procurement heads/ senior executives
 * to defend feedspark services."
 *
 * The card answers an INTERNAL question — where our hours went, billable against non-billable —
 * on a screen being used for an EXTERNAL argument. A procurement head does not buy hours; the
 * first thing they ask about a row of hours is what it produced. Hours alone cannot answer that,
 * and no amount of re-cutting hours will.
 *
 * So this is the other half of the pair: the brand's OUTCOME, month by month, on the same calendar
 * the hours are already drawn on. Two plots, one calendar, each on its own axis — never a dual
 * axis, the rule every chart in the FCC follows.
 *
 * FOUR RULES, because a chart shown to a buyer is the last place an invented number belongs:
 *
 *   1. A MONTH NOBODY MEASURED IS A GAP, never a zero. The feed-scan lanes only started recording
 *      history in Sep 2026, and a scan can be missed; drawing an unmeasured month at 0 would show
 *      a client a collapse that never happened. `null` travels all the way to the page.
 *   2. A BRAND FIGURE NAMES ITS COVERAGE. A brand is many markets and they are not all measured on
 *      the same days, so every monthly value carries `n` — how many markets it averaged — and the
 *      surface says so. "88.6 across 3 of 28 markets" and "88.6" are different claims.
 *   3. NOTHING IS RE-DERIVED. The scores come from labelguard's own histSeries, already re-scored
 *      against the brand's current profile, so this can never disagree with /golden or Leadership's
 *      portfolio trend. A month's value is the last reading IN that month — its close — never a
 *      mean of the days, which would blur the step a piece of work actually produced.
 *   4. AN ABSENT SOURCE SAYS SO. `sources` reports what was read and what was not, because "no
 *      improvement" and "nobody has scanned this brand" are opposite findings and a blank panel
 *      cannot tell them apart.
 */

/** The metrics a brand's outcome panel can draw. `up` = which direction is good. */
export const OUTCOME_METRICS = [
  { k: 'gs', label: 'Golden Record score', unit: '/100', up: true,
    what: 'how completely the feed carries the attributes Google’s product data spec asks for',
    src: 'the feed scan, re-scored against this brand’s current scoring profile' },
  { k: 'q', label: 'Content quality', unit: '/100', up: true,
    what: 'what is actually IN the free-text fields, measured against each attribute’s own Google spec page',
    src: 'the content-quality analysis' },
  { k: 'air', label: 'AI-readiness', unit: '/100', up: true,
    what: 'how ready the feed is for agentic surfaces — the conversational attributes weigh heaviest',
    src: 'the Feed Lab audit' },
];

export const OUTCOME_KEYS = OUTCOME_METRICS.map((m) => m.k);
/** A year of months is as far back as the hours book itself goes. */
export const OUTCOME_MONTHS_MAX = 24;

const r1 = (n) => Math.round(n * 10) / 10;
const pad2 = (n) => (n < 10 ? '0' : '') + n;

/** '2026-09' → the month before it. Plain string arithmetic; no timezone can move a month key. */
export function monthPrev(m) {
  const s = String(m || '');
  if (!/^\d{4}-\d{2}$/.test(s)) return '';
  let y = +s.slice(0, 4), mo = +s.slice(5, 7) - 1;
  if (mo < 1) { mo = 12; y--; }
  return y + '-' + pad2(mo);
}

/** The n months ending at `end` (inclusive), oldest first. */
export function monthsBack(end, n) {
  const out = [];
  let m = String(end || '');
  if (!/^\d{4}-\d{2}$/.test(m)) return out;
  const want = Math.max(1, Math.min(OUTCOME_MONTHS_MAX, parseInt(n, 10) || 12));
  for (let i = 0; i < want; i++) { out.unshift(m); m = monthPrev(m); }
  return out;
}

/**
 * One feed's daily array (labelguard histSeries: `start` = the first day, one slot per day, null
 * where the day was not measured) reduced to a value per month.
 *
 * THE MONTH'S VALUE IS ITS CLOSE — the last day in it that carried a reading — not a mean of its
 * days. A mean would smear a step change across the month it happened in, which is precisely the
 * movement a piece of work is being credited with. A month with no reading at all stays null.
 */
export function monthlyClose(start, values, months) {
  const out = {};
  const s = String(start || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Array.isArray(values)) return out;
  const want = months && months.length ? new Set(months) : null;
  let y = +s.slice(0, 4), mo = +s.slice(5, 7), d = +s.slice(8, 10);
  const dim = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  for (let i = 0; i < values.length; i++) {
    const key = y + '-' + pad2(mo);
    const v = values[i];
    if (v != null && (!want || want.has(key))) out[key] = +v;   // later day in the month wins
    if (++d > dim(y, mo)) { d = 1; if (++mo > 12) { mo = 1; y++; } }
  }
  return out;
}

/**
 * Several markets' monthly closes rolled into ONE brand line.
 *
 * The mean is over the markets that were MEASURED in that month, and `n` carries how many those
 * were — a brand whose three scanned markets moved is not the same claim as one whose twenty-eight
 * did, and the panel says which. A month nobody measured is absent from the map entirely, so it
 * draws as a gap rather than as a zero or as a line carried flat through it.
 */
export function brandMonthly(perFeed, months) {
  const out = {};
  (months || []).forEach((m) => {
    let sum = 0, n = 0;
    (perFeed || []).forEach((f) => {
      const v = f && f[m];
      if (v != null && isFinite(v)) { sum += +v; n++; }
    });
    if (n) out[m] = { v: r1(sum / n), n };
  });
  return out;
}

/**
 * The optimisation read-outs that landed in each month — Dino's fortnightly rounds and the
 * read-outs filed on a brief's own thread, as the archive already holds them.
 *
 * These are MARKS on the calendar, not a series: they are reported per round rather than per month,
 * they carry their own wording, and averaging a set of percentage uplifts from different tests over
 * different catalogues would produce a number nobody could defend. So the month gets a count and
 * the rounds themselves, and the panel prints what the report itself said.
 */
export function resultsByMonth(results, months) {
  const want = months && months.length ? new Set(months) : null;
  const out = {};
  (Array.isArray(results) ? results : []).forEach((r) => {
    if (!r) return;
    const t = r.t || r.at || r.date;
    const iso = typeof t === 'number' ? new Date(t).toISOString() : String(t || '');
    const m = /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : '';
    if (!m || (want && !want.has(m))) return;
    (out[m] || (out[m] = [])).push({
      market: String(r.market || r.mkt || '').toUpperCase() || null,
      period: r.period || null,
      metrics: Array.isArray(r.metrics) ? r.metrics.slice(0, 6) : [],
    });
  });
  return out;
}

/**
 * The whole panel's data for one brand: the months, a line per metric, the result marks, and an
 * honest account of what was read.
 *
 * `feeds` are labelguard histSeries outputs, one per market, each already carrying {start, gs, q,
 * air}. Nothing is scored here — this only reduces days to months and markets to a brand.
 */
export function brandOutcomes(feeds, months, opts) {
  const o = opts || {};
  const ms = Array.isArray(months) ? months : [];
  const list = Array.isArray(feeds) ? feeds.filter(Boolean) : [];
  const metrics = {};
  OUTCOME_KEYS.forEach((k) => {
    metrics[k] = brandMonthly(list.map((f) => monthlyClose(f.start, f[k], ms)), ms);
  });
  const measured = {};
  OUTCOME_KEYS.forEach((k) => { measured[k] = ms.filter((m) => metrics[k][m]).length; });
  const sources = [];
  if (!list.length) sources.push({ k: 'feeds', ok: false, why: 'no market of this brand has a scan history yet' });
  else sources.push({ k: 'feeds', ok: true, n: list.length,
    markets: list.map((f) => String(f.mkt || '').toUpperCase()).filter(Boolean) });
  OUTCOME_KEYS.forEach((k) => {
    if (list.length && !measured[k]) {
      const spec = OUTCOME_METRICS.filter((x) => x.k === k)[0];
      sources.push({ k, ok: false, why: 'no ' + spec.label.toLowerCase() + ' reading falls in this window' });
    }
  });
  const results = resultsByMonth(o.results, ms);
  if (o.results && !Object.keys(results).length) sources.push({ k: 'results', ok: false, why: 'no optimisation read-out in this window' });
  return { months: ms, metrics, measured, results, feeds: list.length, sources };
}

/**
 * What the panel says under itself. Written here rather than in the page so the caption can never
 * describe a series the reducer did not produce — and so it states coverage every time, which is
 * the one thing a brand-level average must never be read without.
 */
export function outcomeCaption(out, key) {
  const spec = OUTCOME_METRICS.filter((x) => x.k === key)[0];
  if (!spec) return '';
  const o = out || {};
  const map = (o.metrics && o.metrics[key]) || {};
  const pts = (o.months || []).filter((m) => map[m]);
  if (!pts.length) {
    const s = (o.sources || []).filter((x) => x.k === key || (x.k === 'feeds' && !x.ok))[0];
    return spec.label + ' — nothing to plot: ' + ((s && s.why) || 'no reading in this window') + '.';
  }
  let lo = Infinity, hi = 0;
  pts.forEach((m) => { const n = map[m].n; if (n < lo) lo = n; if (n > hi) hi = n; });
  const cov = lo === hi ? lo + ' market' + (lo === 1 ? '' : 's') : lo + '–' + hi + ' markets';
  const first = map[pts[0]].v, last = map[pts[pts.length - 1]].v;
  const move = r1(last - first);
  const dir = pts.length < 2 ? 'one month measured, so no movement to report yet'
    : (Math.abs(move) < 0.1 ? 'level over the window'
      : (move > 0 ? 'up ' : 'down ') + Math.abs(move) + ' points over the window');
  return spec.label + ' — ' + spec.what + '. Each month is its last reading, averaged across the '
    + cov + ' measured that month; ' + dir + '. Source: ' + spec.src + '.';
}
