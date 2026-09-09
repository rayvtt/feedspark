/*
 * A/B TEST ARCHIVE — each brand's project plan carries a tab where the team summarises every
 * test run for that client: keyword-optimisation batches, title optimisations, the uplift each
 * one produced (Ray, 9 Sep 2026: "I told my team to summarize all the A/B tests and keyword
 * optimisation uplift, so you will be able to see all the tests backdated").
 *
 * Shape (Reiss is the reference specimen):
 *   Country | Test Method | Test Type | Batch URL | Live Date | Report Date | Graph… | Report…
 * Graph is a block of merged columns holding a SCREENSHOT — nothing readable comes back from
 * the values API for it, which is why the uplift is mined from the Report prose instead. Report
 * is itself a merged block, so its text arrives in the first column of the run.
 *
 * MERGED CELLS ARE THE WHOLE PROBLEM. A test occupies ~13 sheet rows (the height of its graph
 * image), and the Sheets values API returns a merged cell's value ONLY in its top-left cell —
 * every continuation row comes back empty. So a naive row-per-line read yields one real test
 * followed by twelve blanks. parseAbTests fills down and treats a row as a NEW test only when
 * it carries its own identity, which is what makes the count come out right.
 *
 * Pure module — no KV, no fetch — so it is unit-testable outside the worker.
 */

// The archive tab, by name. Deliberately NOT reusing the worker's resolveTab: that one falls
// back to "any tab whose name contains plan", which here would silently read the Project Plan
// and report its rows as tests. This fails closed instead — a brand whose tab is named
// something unrecognised reports "no archive tab", which is true and fixable, rather than
// inventing an archive out of the wrong tab.
const AB_TAB_RE = /(a\/?b|ab)[\s_-]*test.*archive|archive.*(a\/?b|ab)[\s_-]*test|test\s*archive/i;
// `client` matters because SHEETS ARE SHARED: Monsoon and Accessorize live in one workbook, as
// do the five ELC brands. That workbook holds "AB Test Archives Monsoon" AND "AB Test Archives
// Accessorize", so a name search that ignores the brand either calls it ambiguous and shows
// nothing, or picks the first — putting one brand's tests on the other's dossier. Brand-matching
// is therefore checked BEFORE the single-match shortcut, not after it.
export function abClientKey(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
export function resolveAbTab(titles, client) {
  const list = (titles || []).filter(Boolean);
  const near = list.filter((t) => AB_TAB_RE.test(t));
  const key = abClientKey(client);
  if (key && near.length > 1) {
    const mine = near.filter((t) => abClientKey(t).indexOf(key) >= 0);
    if (mine.length === 1) return mine[0];
    return null;                               // still can't tell them apart — never guess
  }
  const exact = list.find((t) => /^\s*ab test archive\s*$/i.test(t));
  if (exact) return exact;
  return near.length === 1 ? near[0] : null;   // several archive-ish tabs = ambiguous, not a guess
}

// Name matching alone is too brittle to hang the whole feature on: the archive exists in Schuh
// and Hobbycraft with the identical column layout, and whether the dossier finds it comes down
// to what someone typed on the tab. So when the name search comes up empty the worker probes
// the sheet's tabs for the ARCHIVE'S OWN HEADER instead — Country beside Test Method. That
// shape appears nowhere else in these workbooks (a Project Plan has no Test Method column), so
// content detection stays as fail-closed as the name match while surviving any rename.
export function hasAbHeader(values) { return !!findHeaderRow(values); }

const HDR_COUNTRY = /^countr(y|ies)$/i;
const HDR_METHOD = /^test\s*method$/i;
// Only these count as a real archive row. The tab often continues into unrelated blocks below
// (material lists, market tables) whose first columns look similar; keying on the method column
// is what stops those bleeding in as hundreds of phantom "tests".
const METHODS = /^(a\/?b\s*test|single\s*group|multi[\s-]*group|holdout)$/i;

export function findHeaderRow(values) {
  for (let i = 0; i < Math.min((values || []).length, 200); i++) {
    const r = values[i] || [];
    for (let c = 0; c < Math.min(r.length, 8); c++) {
      if (HDR_COUNTRY.test(String(r[c] || '').trim()) && HDR_METHOD.test(String(r[c + 1] || '').trim())) {
        return { row: i, col: c };
      }
    }
  }
  return null;
}

// Percentages in the report prose. The team writes both "a -17.67% lowered in impressions" and
// "impressions of 21.37%", so both orders are read; first mention of a metric wins.
const PCT_THEN_METRIC = /([+-]?\d+(?:\.\d+)?)\s*%[^.;\n]{0,40}?\b(impressions?|clicks?|conversions?|revenue|ctr|cvr)\b/gi;
const METRIC_THEN_PCT = /\b(impressions?|clicks?|conversions?|revenue|ctr|cvr)\b[^.;\n]{0,40}?([+-]?\d+(?:\.\d+)?)\s*%/gi;
// "lowered/decreased/down" flips an unsigned figure negative — the prose often drops the sign
// ("experienced a 17.67% lowered in impressions") and reading that as +17.67% would invert the
// verdict on a losing test.
const DOWN_NEAR = /\b(lower|lowered|decreas|declin|drop|fell|down|negative)/i;
const NO_DATA_RE = /no performance data|inconclusive|not enough data|no data detected/i;

function metricKey(w) {
  const s = String(w).toLowerCase();
  if (s.startsWith('impression')) return 'impressions';
  if (s.startsWith('click')) return 'clicks';
  if (s.startsWith('conversion')) return 'conversions';
  if (s === 'revenue') return 'revenue';
  return s;
}

export function extractMetrics(report) {
  const txt = String(report || '');
  const out = {};
  const take = (key, num, ctx) => {
    if (out[key] !== undefined) return;
    let v = parseFloat(num);
    if (!isFinite(v)) return;
    if (v > 0 && !/^[+]/.test(String(num).trim()) && DOWN_NEAR.test(ctx)) v = -v;
    out[key] = v;
  };
  for (const re of [PCT_THEN_METRIC, METRIC_THEN_PCT]) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(txt))) {
      const isFirst = re === PCT_THEN_METRIC;
      const num = isFirst ? m[1] : m[2], word = isFirst ? m[2] : m[1];
      take(metricKey(word), num, m[0]);
    }
  }
  return out;
}

// positive / negative / mixed / inconclusive. Every metric here is up-is-good (impressions,
// clicks, conversions, revenue) — unlike the emailed keyword results, these reports carry no
// cost metrics, so there is no inversion to apply.
export function abVerdict(metrics, report) {
  const vals = Object.values(metrics || {});
  if (!vals.length) return NO_DATA_RE.test(String(report || '')) ? 'inconclusive' : 'unknown';
  const good = vals.filter((v) => v > 0).length, bad = vals.filter((v) => v < 0).length;
  if (good && bad) return good >= bad * 2 ? 'positive' : bad >= good * 2 ? 'negative' : 'mixed';
  if (good) return 'positive';
  if (bad) return 'negative';
  return 'inconclusive';                       // every figure was exactly 0
}

export function parseAbTests(values, opts) {
  const o = opts || {};
  const head = findHeaderRow(values);
  if (!head) return { ok: false, error: 'no_header', tests: [] };
  const c0 = head.col;
  const carry = ['', '', '', '', '', ''];      // country, method, type, batch, live, reportDate
  const tests = [];
  for (let i = head.row + 1; i < values.length; i++) {
    const row = values[i] || [];
    const cell = (n) => String(row[c0 + n] === undefined || row[c0 + n] === null ? '' : row[c0 + n]).trim();
    const own = [cell(0), cell(1), cell(2), cell(3), cell(4), cell(5)];
    // A merged block's continuation rows are empty; carry the anchor's values down so the
    // report text that trails below a test still attaches to that test.
    for (let k = 0; k < 6; k++) if (own[k]) carry[k] = own[k];
    // Report is a merged run of columns — take the longest non-empty cell to its right rather
    // than assuming a fixed column, since the block's width differs per client's layout.
    let rep = '';
    for (let c = c0 + 6; c < row.length; c++) {
      const v = String(row[c] === undefined || row[c] === null ? '' : row[c]).trim();
      if (v.length > rep.length) rep = v;
    }
    const startsTest = !!(own[1] && METHODS.test(own[1]));
    if (startsTest) {
      tests.push({ country: carry[0], method: carry[1], type: carry[2], batch: carry[3],
        live: carry[4], reportDate: carry[5], report: rep });
    } else if (tests.length && rep) {
      const t = tests[tests.length - 1];
      if (rep.length > (t.report || '').length) t.report = rep;   // the block's text sat lower down
    }
  }
  const out = tests.map((t) => {
    const metrics = extractMetrics(t.report);
    return { ...t, metrics, verdict: abVerdict(metrics, t.report),
      report: String(t.report || '').slice(0, o.reportChars || 3000) };
  });
  return { ok: true, tests: out };
}

// Headline the dossier can show without opening anything: how many ran, how many won.
export function abSummary(tests) {
  const s = { total: (tests || []).length, positive: 0, negative: 0, mixed: 0, inconclusive: 0, unknown: 0, types: {} };
  (tests || []).forEach((t) => {
    s[t.verdict] = (s[t.verdict] || 0) + 1;
    if (t.type) s.types[t.type] = (s.types[t.type] || 0) + 1;
  });
  const decided = s.positive + s.negative + s.mixed;
  s.winRate = decided ? Math.round((s.positive / decided) * 100) : null;
  return s;
}
