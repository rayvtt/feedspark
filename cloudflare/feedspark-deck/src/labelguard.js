/* FeedSpark Label Guard — custom_label_0..4 monitoring engine
 * ------------------------------------------------------------------
 * Watches every wired Shopping feed's g:custom_label_0..4 columns and flags
 * drop-offs BEFORE they break the PMAX campaigns keyed on them (listing groups
 * are built on label VALUES — a value silently vanishing from the feed breaks
 * spend worth six figures, and nobody sees it until performance craters).
 *
 * The worker never parses a raw feed CSV (CPU budget — see docs/FEEDLAB.md §6).
 * Instead every scan asks Google's gviz endpoint to do the pivot server-side:
 *   /gviz/tq?tqx=out:csv&tq=select E, count(A) group by E order by count(A) desc
 * so the worker only parses tiny aggregate CSVs (≤250 rows each). Per feed:
 * 1 header probe + 1 multi-count query + one group-by per present label ≤ 7
 * small fetches — cheap enough for the hourly cron AND the free-plan
 * subrequest budget.
 *
 * Monitoring semantics: every scan diffs against a BASELINE (the last known-good
 * snapshot), not merely the previous scan — so an alert stays active until the
 * feed recovers or Ray explicitly re-baselines ("expected change"). A clean scan
 * rolls the baseline forward automatically.
 *
 * Pure functions + an injectable fetch — unit-tested in node
 * (tools/test_labelguard.mjs) and imported by worker.js.
 */

export const VERSION = '1.0.0';

export const LABEL_KEYS = ['custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4'];

// Alert thresholds. cov* are percentage POINTS of coverage; *Drop fractions.
export const TH = {
  rowDropCrit: 0.30,   // feed lost ≥30% of rows -> crit
  rowDropWarn: 0.12,   // ≥12% -> warn
  covDropCrit: 25,     // label coverage fell ≥25pp -> crit
  covDropWarn: 8,      // ≥8pp -> warn
  covZeroFloor: 5,     // baseline coverage ≥5% emptying to 0 -> crit
  valDropWarn: 0.5,    // a tracked value losing ≥50% of its SKUs -> warn (100% -> crit)
  maxValues: 250,      // per-label distinct values kept (gviz `limit`)
};

// a value is significant enough to track when it covers ≥0.5% of the feed (min 10 SKUs)
export function sigFloor(rows) { return Math.max(10, Math.ceil((rows || 0) * 0.005)); }

/* ---------------- header canonicalisation (same cleaning as FeedAudit.normKey) -------- */
export function normHeader(k) {
  k = String(k == null ? '' : k);
  k = k.replace(/^\uFEFF/, '').trim();
  k = k.replace(/\s+type=.*$/i, '');        // strip ` type=""string""` suffixes
  k = k.replace(/^[gc]:/i, '');             // strip g:/c: namespace prefix
  k = k.replace(/\|\|\|(\d+)\s*$/, '($1)'); // |||N -> (N)
  k = k.toLowerCase();
  // fold "custom label 0" / "custom-label-0" / "custom_label0" onto custom_label_N
  const m = /^custom[ _-]*label[ _-]*([0-4])$/.exec(k);
  if (m) return 'custom_label_' + m[1];
  return k.replace(/\s+/g, '_');
}

/* ---------------- tiny RFC-4180 CSV parse (aggregate responses only, never feeds) ----- */
export function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  const s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (!(row.length === 1 && row[0] === '')) rows.push(row);
  return rows;
}

/* ---------------- gviz query plumbing -------------------------------------------------- */
export function colLetter(i) {
  let s = ''; let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export function gvizUrl(id, gid, tq) {
  return 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv&headers=1&gid=' +
    (gid || '0') + '&tq=' + encodeURIComponent(tq);
}

// header row -> { id: colIndex, labels: { custom_label_0: colIndex|-1, ... } }
export function findCols(headerRow) {
  const norm = (headerRow || []).map(normHeader);
  let id = norm.indexOf('id');
  if (id < 0) id = norm.indexOf('item_id');
  if (id < 0) id = norm.indexOf('offer_id');
  if (id < 0) id = 0; // no id header — count the first column instead
  const labels = {};
  for (const k of LABEL_KEYS) labels[k] = norm.indexOf(k);
  return { id, labels, headerCount: norm.length };
}

/* ---------------- snapshot ------------------------------------------------------------- */
// Shape (v1):
// { v:1, t, client, market, rows,
//   labels: { custom_label_0: { present, filled, cov, distinct, truncated, values: [[v,n],...] }
//             custom_label_1: { present:false }, ... } }
export function snapshotFromParts(meta, cols, countsRow, groupRowsByKey) {
  const t = meta.fetchedAt || Date.now();
  // countsRow order: [count(id), count(label) for each present label in LABEL_KEYS order]
  const rows = Math.max(0, Math.round(parseFloat(countsRow && countsRow[0]) || 0));
  const labels = {};
  let ci = 1;
  for (const k of LABEL_KEYS) {
    if (cols.labels[k] < 0) { labels[k] = { present: false }; continue; }
    const colFilled = Math.max(0, Math.round(parseFloat(countsRow && countsRow[ci]) || 0)); ci++;
    const groups = groupRowsByKey[k] || [];
    const values = [];
    let sum = 0;
    for (const g of groups) {
      const v = String(g[0] == null ? '' : g[0]).trim();
      const n = Math.max(0, Math.round(parseFloat(g[1]) || 0));
      if (!v || !n) continue;
      values.push([v, n]); sum += n;
    }
    values.sort((a, b) => b[1] - a[1]);
    const truncated = groups.length >= TH.maxValues;
    // exact filled count = sum of non-empty groups when the list is complete; the
    // count() column includes formula-blank "" cells, so prefer the group sum
    const filled = truncated ? Math.max(colFilled, sum) : sum;
    labels[k] = {
      present: true,
      filled,
      cov: rows ? Math.round((filled / rows) * 1000) / 10 : 0,
      distinct: values.length,
      truncated,
      values,
    };
  }
  return { v: 1, t, client: meta.client || '', market: meta.market || 'gb', rows, labels };
}

// fetch + assemble one feed's snapshot. fetchFn injectable for tests.
// Throws Error('fetch-fail: ...') when the sheet is unreachable / not link-shared.
export async function scanFeed(fetchFn, src, meta) {
  const get = async (tq) => {
    const r = await fetchFn(gvizUrl(src.id, src.gid, tq));
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    if (!r.ok || !/csv|text\/plain/i.test(ct)) {
      throw new Error('fetch-fail: gviz ' + r.status + ' (' + (String(ct).split(';')[0] || 'no type') + ') - is the sheet link-shared?');
    }
    return parseCsv(await r.text());
  };

  // 1. header probe — one data row so out:csv always emits the label row first
  const head = await get('select * limit 1');
  if (!head.length) throw new Error('fetch-fail: empty gviz response');
  const cols = findCols(head[0]);

  // 2. one multi-count query: total rows (count id) + per-label filled counts
  const sel = ['count(' + colLetter(cols.id) + ')'];
  for (const k of LABEL_KEYS) if (cols.labels[k] >= 0) sel.push('count(' + colLetter(cols.labels[k]) + ')');
  const counts = await get('select ' + sel.join(', '));
  const countsRow = counts.length > 1 ? counts[counts.length - 1] : [];

  // 3. one group-by pivot per present label (Google aggregates; we parse ≤250 rows)
  const groupRowsByKey = {};
  for (const k of LABEL_KEYS) {
    const ci = cols.labels[k];
    if (ci < 0) continue;
    const L = colLetter(ci), A = colLetter(cols.id);
    const g = await get('select ' + L + ', count(' + A + ') where ' + L + " is not null and " + L + " != '' group by " + L +
      ' order by count(' + A + ') desc limit ' + TH.maxValues);
    groupRowsByKey[k] = g.slice(1); // drop the gviz header row
  }

  return snapshotFromParts(meta, cols, countsRow, groupRowsByKey);
}

/* ---------------- baseline diff -> alerts ---------------------------------------------- */
// [{ sev: 'crit'|'warn'|'info', code, label?, value?, msg, was?, now? }]
export function diffSnapshots(base, cur, th) {
  th = th || TH;
  const A = [];
  if (!base || !cur) return A;
  const bRows = base.rows || 0, cRows = cur.rows || 0;

  if (bRows > 0 && cRows < bRows) {
    const d = (bRows - cRows) / bRows;
    if (d >= th.rowDropWarn) {
      A.push({ sev: d >= th.rowDropCrit ? 'crit' : 'warn', code: 'rows-drop',
        msg: 'feed rows ' + bRows + ' -> ' + cRows + ' (-' + Math.round(d * 100) + '%)', was: bRows, now: cRows });
    }
  }

  for (const k of LABEL_KEYS) {
    const b = (base.labels || {})[k], c = (cur.labels || {})[k];
    const CL = 'CL' + k.slice(-1);
    if (b && b.present) {
      if (!c || !c.present) {
        A.push({ sev: 'crit', code: 'label-gone', label: k,
          msg: CL + ' column vanished from the feed (was ' + b.cov + '% filled, ' + b.distinct + ' values)', was: b.cov, now: 0 });
        continue;
      }
      const drop = (b.cov || 0) - (c.cov || 0);
      if ((c.cov || 0) === 0 && (b.cov || 0) >= th.covZeroFloor) {
        A.push({ sev: 'crit', code: 'cov-zero', label: k,
          msg: CL + ' emptied - was ' + b.cov + '% filled, now 0%', was: b.cov, now: 0 });
      } else if (drop >= th.covDropWarn) {
        A.push({ sev: drop >= th.covDropCrit ? 'crit' : 'warn', code: 'cov-drop', label: k,
          msg: CL + ' coverage ' + b.cov + '% -> ' + c.cov + '% (-' + (Math.round(drop * 10) / 10) + 'pp)', was: b.cov, now: c.cov });
      }
      // value-level watch — the PMAX listing groups key on these exact strings
      const floor = sigFloor(bRows);
      const cv = new Map((c.values || []));
      for (const [v, n] of (b.values || [])) {
        if (n < floor) continue;
        const now = cv.get(v) || 0;
        if (now === 0) {
          if (c.truncated) {
            A.push({ sev: 'warn', code: 'value-drop', label: k, value: v,
              msg: CL + ' "' + v + '" fell out of the top ' + th.maxValues + ' (was ' + n + ' SKUs)', was: n, now: 0 });
          } else {
            A.push({ sev: 'crit', code: 'value-gone', label: k, value: v,
              msg: CL + ' value "' + v + '" GONE - was on ' + n + ' SKUs', was: n, now: 0 });
          }
        } else if ((n - now) / n >= th.valDropWarn) {
          A.push({ sev: 'warn', code: 'value-drop', label: k, value: v,
            msg: CL + ' "' + v + '" ' + n + ' -> ' + now + ' SKUs (-' + Math.round(((n - now) / n) * 100) + '%)', was: n, now });
        }
      }
      // new significant values — informational (someone shipped a new segmentation)
      const bv = new Map((b.values || []));
      const fresh = (c.values || []).filter(([v, n]) => !bv.has(v) && n >= sigFloor(cRows)).slice(0, 5);
      if (fresh.length) {
        A.push({ sev: 'info', code: 'value-new', label: k,
          msg: CL + ' new value' + (fresh.length > 1 ? 's' : '') + ': ' + fresh.map(([v, n]) => '"' + v + '" (' + n + ')').join(', ') });
      }
    } else if (c && c.present && (c.cov || 0) > 0) {
      A.push({ sev: 'info', code: 'label-new', label: k,
        msg: CL + ' appeared - ' + c.cov + '% filled, ' + c.distinct + ' values' });
    }
  }
  return A;
}

/* ---------------- estate index entry --------------------------------------------------- */
export function summarize(snap, alerts, baseT) {
  const cov = {}; let present = 0;
  for (const k of LABEL_KEYS) {
    const L = (snap.labels || {})[k];
    if (L && L.present) { cov[k] = L.cov; present++; } else cov[k] = null;
  }
  const list = alerts || [];
  const nCrit = list.filter((a) => a.sev === 'crit').length;
  const nWarn = list.filter((a) => a.sev === 'warn').length;
  return {
    t: snap.t, rows: snap.rows, cov, present,
    nCrit, nWarn,
    status: nCrit ? 'crit' : (nWarn ? 'warn' : 'ok'),
    baseT: baseT || snap.t,
  };
}
