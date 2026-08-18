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
// Product Type Guard (/ptypes) tracks the PRIMARY g:product_type only — the numbered
// keyword slots (product_type2 / _2 / |||N) are AI keyword fields, not the category tree,
// and normHeader keeps them distinct ('product_type2' / 'product_type(2)') so they can
// never be picked up by accident. Google Shopping channel only (no -fb markets).
export const PT_KEYS = ['product_type'];
// display name for a monitored field: CL0..CL4 for custom labels, PT for product_type
export function dispKey(k) {
  const m = /^custom_label_([0-4])$/.exec(String(k || ''));
  return m ? 'CL' + m[1] : (k === 'product_type' ? 'PT' : String(k || ''));
}

/* ---------------- channels: Google Shopping vs Facebook/Meta ---------------------------
 * A Facebook catalogue feed rides the SAME rails as everything else (Meta feeds carry
 * custom_label_0..4 too) — it is simply attached under a market code with the `-fb`
 * suffix: `gb` = Google Shopping GB, `gb-fb` = Facebook GB. Every KV key, sweep, watch,
 * cross query and report flows through unchanged; only display splits the two sets
 * (Google green vs Facebook blue on the page). */
export function chOf(mkt) { return /-fb$/.test(String(mkt || '')) ? 'facebook' : 'google'; }
export function dispFeed(client, mkt) {
  const m = String(mkt || 'gb');
  const base = m.replace(/-fb$/, '').toUpperCase();
  return (client || '') + ' · ' + base + (chOf(m) === 'facebook' ? ' · Facebook' : '');
}

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
// keys defaults to the custom labels; pass e.g. LABEL_KEYS.concat(PT_KEYS) to also
// resolve product_type in the same probe.
// The primary product_type ships under TWO header conventions across the estate:
// bare `g:product_type` (YuMOVE, HoB) or slot 1 of the numbered family —
// `g:product_type(1)` (Reiss/Superdry/Schuh/American Golf). Keyword slots start
// at 2, so slot 1 is always the real category tree; it aliases onto the same key.
const KEY_ALIASES = { product_type: ['product_type(1)'] };
export function findCols(headerRow, keys) {
  const norm = (headerRow || []).map(normHeader);
  let id = norm.indexOf('id');
  if (id < 0) id = norm.indexOf('item_id');
  if (id < 0) id = norm.indexOf('offer_id');
  if (id < 0) id = 0; // no id header — count the first column instead
  const labels = {};
  for (const k of (keys || LABEL_KEYS)) {
    let i = norm.indexOf(k);
    if (i < 0 && KEY_ALIASES[k]) {
      for (const a of KEY_ALIASES[k]) { i = norm.indexOf(a); if (i >= 0) break; }
    }
    labels[k] = i;
  }
  return { id, labels, headerCount: norm.length };
}

/* ---------------- snapshot ------------------------------------------------------------- */
// Shape (v1):
// { v:1, t, client, market, rows,
//   labels: { custom_label_0: { present, filled, cov, distinct, truncated, values: [[v,n],...] }
//             custom_label_1: { present:false }, ... } }
export function snapshotFromParts(meta, cols, countsRow, groupRowsByKey, keys) {
  const t = meta.fetchedAt || Date.now();
  // countsRow order: [count(id), count(label) for each present label in key order]
  const rows = Math.max(0, Math.round(parseFloat(countsRow && countsRow[0]) || 0));
  const labels = {};
  let ci = 1;
  for (const k of (keys || LABEL_KEYS)) {
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
export async function scanFeed(fetchFn, src, meta, keys) {
  keys = keys || LABEL_KEYS;
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
  const cols = findCols(head[0], keys);

  // 2. one multi-count query: total rows (count id) + per-key filled counts
  const sel = ['count(' + colLetter(cols.id) + ')'];
  for (const k of keys) if (cols.labels[k] >= 0) sel.push('count(' + colLetter(cols.labels[k]) + ')');
  const counts = await get('select ' + sel.join(', '));
  const countsRow = counts.length > 1 ? counts[counts.length - 1] : [];

  // 3. one group-by pivot per present key (Google aggregates; we parse ≤250 rows)
  const groupRowsByKey = {};
  for (const k of keys) {
    const ci = cols.labels[k];
    if (ci < 0) continue;
    const L = colLetter(ci), A = colLetter(cols.id);
    const g = await get('select ' + L + ', count(' + A + ') where ' + L + " is not null and " + L + " != '' group by " + L +
      ' order by count(' + A + ') desc limit ' + TH.maxValues);
    groupRowsByKey[k] = g.slice(1); // drop the gviz header row
  }

  return snapshotFromParts(meta, cols, countsRow, groupRowsByKey, keys);
}

/* ---------------- live cross-label dissection ------------------------------------------ */
// a gviz string literal for the where clause: single-quoted unless the value itself
// carries a single quote (then double-quoted). Both quote kinds in one value can't be
// expressed as a gviz literal — reject rather than mangle.
export function gvizLiteral(v) {
  const s = String(v == null ? '' : v);
  if (s.indexOf("'") < 0) return "'" + s + "'";
  if (s.indexOf('"') < 0) return '"' + s + '"';
  return null;
}

// Within by=<value> (e.g. CL0 = "Best Sellers"), pivot the segment by another label
// (e.g. CL2 -> women - fp / women - sale / ...). Fully LIVE — 3 tiny gviz fetches
// (header probe, segment count, cross group-by); Google does the aggregation.
export async function crossFeed(fetchFn, src, byKey, value, vsKey) {
  const pool = LABEL_KEYS.concat(PT_KEYS);   // PT Guard crosses product_type <-> custom labels
  if (pool.indexOf(byKey) < 0 || pool.indexOf(vsKey) < 0 || byKey === vsKey) {
    throw new Error('bad-cross: by/vs must be two different keys from custom_label_0..4 / product_type');
  }
  const lit = gvizLiteral(value);
  if (!lit) throw new Error('bad-cross: value mixes both quote characters - cannot query it');
  const get = async (tq) => {
    const r = await fetchFn(gvizUrl(src.id, src.gid, tq));
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    if (!r.ok || !/csv|text\/plain/i.test(ct)) {
      throw new Error('fetch-fail: gviz ' + r.status + ' (' + (String(ct).split(';')[0] || 'no type') + ') - is the sheet link-shared?');
    }
    return parseCsv(await r.text());
  };
  const head = await get('select * limit 1');
  if (!head.length) throw new Error('fetch-fail: empty gviz response');
  const cols = findCols(head[0], pool);
  if (cols.labels[byKey] < 0) throw new Error('bad-cross: ' + byKey + ' is not in this feed');
  if (cols.labels[vsKey] < 0) throw new Error('bad-cross: ' + vsKey + ' is not in this feed');
  const A = colLetter(cols.id), U = colLetter(cols.labels[byKey]), W = colLetter(cols.labels[vsKey]);

  const seg = await get('select count(' + A + ') where ' + U + ' = ' + lit);
  const segment = Math.max(0, Math.round(parseFloat((seg[seg.length - 1] || [])[0]) || 0));

  const g = await get('select ' + W + ', count(' + A + ') where ' + U + ' = ' + lit +
    ' and ' + W + " is not null and " + W + " != '' group by " + W +
    ' order by count(' + A + ') desc limit ' + TH.maxValues);
  const rows = [];
  let labelled = 0;
  for (const r of g.slice(1)) {
    const v = String(r[0] == null ? '' : r[0]).trim();
    const n = Math.max(0, Math.round(parseFloat(r[1]) || 0));
    if (!v || !n) continue;
    rows.push([v, n]); labelled += n;
  }
  rows.sort((a, b) => b[1] - a[1]);
  return { by: byKey, value: String(value), vs: vsKey, segment, labelled,
    unlabelled: Math.max(0, segment - labelled), rows,
    truncated: g.length - 1 >= TH.maxValues, t: Date.now() };
}

/* ---------------- custom watch rules (the alert builder) -------------------------------
 * A watch rule pins a REFERENCE set of values (captured from the live pivot the moment
 * Ray creates it — e.g. Reiss GB CL0 "Best Sellers" -> the 8 CL2 cross values) and every
 * periodic live check compares the feed against it. A watched value going to zero (or
 * dropping past the rule's threshold) fires a HIGH-PRIORITY ping to the rule's
 * destinations (Google Chat / Slack webhook, email via the Gmail bridge).
 *
 * Rule shape (KV `labelwatch`, key "<client>|<mkt>|<id>"):
 *   { id, client, mkt, label, value|null, vs|null, ref: [[v,n],...], refSeg,
 *     dropPct (0 = only fire on GONE), dests: [destId,...], enabled, repingH,
 *     state: { "<value>": {st:'ok'|'fired', t, n} }, lastRun, note }
 * Fire semantics: fire on the ok->broken TRANSITION; while broken, re-ping every
 * repingH (default 24h); send a ✅ recovery notice when it comes back. */

// current values of ONE label — the cheap live check for non-cross rules (2 fetches)
export async function labelPivot(fetchFn, src, key) {
  if (LABEL_KEYS.indexOf(key) < 0) throw new Error('bad-watch: ' + key + ' is not a custom label');
  const get = async (tq) => {
    const r = await fetchFn(gvizUrl(src.id, src.gid, tq));
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    if (!r.ok || !/csv|text\/plain/i.test(ct)) {
      throw new Error('fetch-fail: gviz ' + r.status + ' (' + (String(ct).split(';')[0] || 'no type') + ') - is the sheet link-shared?');
    }
    return parseCsv(await r.text());
  };
  const head = await get('select * limit 1');
  if (!head.length) throw new Error('fetch-fail: empty gviz response');
  const cols = findCols(head[0]);
  if (cols.labels[key] < 0) return { values: [], present: false };
  const L = colLetter(cols.labels[key]), A = colLetter(cols.id);
  const g = await get('select ' + L + ', count(' + A + ') where ' + L + " is not null and " + L + " != '' group by " + L +
    ' order by count(' + A + ') desc limit ' + TH.maxValues);
  const values = [];
  for (const r of g.slice(1)) {
    const v = String(r[0] == null ? '' : r[0]).trim();
    const n = Math.max(0, Math.round(parseFloat(r[1]) || 0));
    if (v && n) values.push([v, n]);
  }
  return { values, present: true };
}

// An answer that CONTRADICTS ITSELF must never drive an alert. Twice now Google served
// the worker "segment counts 9,000+ SKUs" and, seconds later in the same run, "that same
// segment has zero cross values" — for feeds whose sheets were verifiably fine (the
// two-strike guard was defeated because the bad reads recurred across consecutive checks;
// throttling of Cloudflare's shared egress IPs fits the signature). No genuine feed state
// is provable from such a response, so the watch runner re-queries once after a pause and,
// if still implausible, SKIPS the check with a diagnostic instead of evaluating. A real
// full-label wipe is still caught by the baseline sweep's cov-zero CRIT (different query,
// different schedule) — the watch just refuses to confirm from garbage.
export function isImplausible(rule, live) {
  if (!live || !(rule.ref || []).length) return false;
  const empty = !(live.values || []).length;
  // cross: segment=0 + empty pivot is COHERENT (the whole segment vanished — evaluated
  // normally as segment-gone with two-strike); segment>0 + empty pivot contradicts itself.
  if (rule.vs) return empty && (live.segment || 0) > 0;
  // plain label: an all-values-empty reading (column "missing" or "blank") is exactly what
  // a garbled header probe produces too — never confirmable from here. The baseline sweep's
  // label-gone / cov-zero CRIT owns genuine column wipes.
  return empty;
}

// pure state machine: reference vs live -> fires + next state. No fetching, no clock reads.
// TWO-STRIKE CONFIRMATION: the first sighting of a drop-off marks the value 'suspect' and
// stays SILENT; only a second consecutive bad check fires the ping. Feed sheets are
// rewritten in place upstream (cleared + repopulated) — a check landing mid-refresh sees
// columns momentarily empty and, without this, pings 8 false "GONE"s that self-heal
// minutes later (happened live on Reiss GB day one). A real wipe persists and still
// pings, one check later.
export function evalWatch(rule, live, now) {
  const fires = [];
  const state = Object.assign({}, rule.state || {});
  const repingMs = Math.max(1, rule.repingH || 24) * 3600 * 1000;
  const dropPct = Math.max(0, Math.min(99, rule.dropPct == null ? 50 : rule.dropPct));
  const cur = new Map(live.values || []);
  let suspects = 0;

  const step = (key, refN, curN, kindGone, kindDrop) => {
    const st = state[key] || { st: 'ok', t: 0, n: refN };
    const broken = curN === 0 ? kindGone : (dropPct > 0 && refN > 0 && curN <= refN * (1 - dropPct / 100) ? kindDrop : null);
    if (broken) {
      if (st.st === 'fired') {
        if (now - (st.t || 0) >= repingMs) {
          fires.push({ kind: broken, value: key, was: refN, now: curN, again: true });
          state[key] = { st: 'fired', t: now, n: curN };
        } else {
          state[key] = { st: 'fired', t: st.t, n: curN };   // still broken, inside the re-ping window
        }
      } else if (st.st === 'suspect') {
        fires.push({ kind: broken, value: key, was: refN, now: curN, again: false });   // confirmed on the 2nd check
        state[key] = { st: 'fired', t: now, n: curN };
      } else {
        state[key] = { st: 'suspect', t: now, n: curN };    // first sighting — silent
        suspects++;
      }
    } else {
      if (st.st === 'fired') fires.push({ kind: 'recovered', value: key, was: refN, now: curN });
      state[key] = { st: 'ok', t: now, n: curN };           // suspect that recovered = transient, stays silent
    }
  };

  // cross rules also watch the SEGMENT itself (the by-value vanishing entirely). When
  // the segment is gone, per-value checks are suppressed — one loud fire, not N echoes.
  if (rule.vs && live.segment != null) {
    const segRef = rule.refSeg || 0;
    if (live.segment === 0 && segRef > 0) {
      step('__seg', segRef, 0, 'segment-gone', 'segment-gone');
      return { fires, state, suspects };
    }
    step('__seg', segRef, live.segment, 'segment-gone', dropPct > 0 ? 'segment-drop' : 'segment-gone');
  }

  for (const [v, n] of (rule.ref || [])) step(v, n, cur.get(v) || 0, 'gone', 'drop');
  return { fires, state, suspects };
}

// ONE digest message per rule per check — not one ping per value (a mid-refresh or real
// wipe of an 8-value breakdown must not fire 8 separate messages). Each value sits on its
// OWN row wrapped in `code` markup, which renders as a visually distinct highlighted token
// in both Slack (red monospace chip) and Google Chat (boxed monospace) — instantly
// recognisable. Same body works for the email bridge.
export function alertDigest(rule, fires, opts) {
  opts = opts || {};
  const CL = (k) => 'CL' + String(k).slice(-1);
  const feed = dispFeed(rule.client, rule.mkt);
  const scope = rule.vs
    ? CL(rule.label) + ' "' + rule.value + '" → ' + CL(rule.vs)
    : CL(rule.label) + (rule.value ? ' "' + rule.value + '"' : '');
  const alerts = fires.filter((f) => f.kind !== 'recovered');
  const recovered = fires.filter((f) => f.kind === 'recovered');
  const row = (f) => {
    const name = f.value === '__seg' ? 'the whole "' + rule.value + '" segment' : '`' + f.value + '`';
    if (f.kind === 'recovered') return '• ' + name + ' — back with ' + f.now + ' SKUs (ref ' + f.was + ')';
    if (f.now === 0) return '• ' + name + ' — was ' + f.was + ' SKUs → now 0 (GONE)' + (f.again ? ' · re-ping, still broken' : '');
    return '• ' + name + ' — ' + f.was + ' → ' + f.now + ' SKUs (−' + Math.round(((f.was - f.now) / Math.max(1, f.was)) * 100) + '%)' + (f.again ? ' · re-ping, still broken' : '');
  };
  const out = [];
  if (alerts.length) {
    out.push('🔴 HIGH PRIORITY — Label Guard | ' + feed + '\n' +
      scope + ' — CONFIRMED drop-off on ' + alerts.length + ' watched value' + (alerts.length === 1 ? '' : 's') +
      ' vs the pinned reference' + (rule.created ? ' (armed ' + new Date(rule.created).toUTCString().slice(5, 16) + ')' : '') +
      ', seen on two consecutive live checks:\n' +
      alerts.map(row).join('\n') +
      '\nPMAX listing groups keyed on these values are dark.' +
      (opts.link ? '\n' + opts.link : ''));
  }
  if (recovered.length) {
    out.push('✅ RECOVERED — Label Guard | ' + feed + '\n' +
      scope + ' — back on the live feed:\n' +
      recovered.map(row).join('\n') +
      (opts.link ? '\n' + opts.link : ''));
  }
  return out;   // 0-2 messages: an alert digest and/or a recovery digest
}

/* ---------------- the emailed status report -------------------------------------------- */
// Plain-text summary of the whole Label Guard estate — sent to Ray's inbox by the Gmail
// bridge (daily after the 07:00 GMT watch pass, optionally 17:00, or on demand). Pure
// function over the KV stores so it's unit-testable; the worker assembles the inputs.
export function buildReport(inp) {
  const { rules, dests, idx, alerts, now, link } = inp;
  const CL = (k) => 'CL' + String(k).slice(-1);
  const L = [];
  const d = new Date(now);
  L.push('FEEDSPARK LABEL GUARD — STATUS REPORT');
  L.push(d.toUTCString().replace(' GMT', ' GMT') + '');
  L.push('');

  // watch rules, broken first
  const rKeys = Object.keys(rules || {}).sort();
  const down = [], sus = [], ok = [];
  for (const k of rKeys) {
    const r = rules[k]; if (!r) continue;
    const st = r.state || {};
    const downVals = Object.keys(st).filter((v) => st[v] && st[v].st === 'fired');
    const susVals = Object.keys(st).filter((v) => st[v] && st[v].st === 'suspect');
    const scope = r.vs ? CL(r.label) + ' "' + r.value + '" → ' + CL(r.vs) + ' (' + (r.ref || []).length + ' values)'
      : CL(r.label) + (r.value ? ' "' + r.value + '"' : ' (' + (r.ref || []).length + ' values)');
    const who = (r.dests || []).map((id) => ((dests || {})[id] || {}).name || '?').join(', ');
    const head = dispFeed(r.client, r.mkt) + ' — ' + scope +
      ' · ' + (r.dropPct ? 'gone or -' + r.dropPct + '%' : 'gone only') +
      ' · ' + ((r.sched || 'hourly') === 'twice' ? '07:00 & 17:00 GMT' : 'hourly') +
      (r.enabled ? '' : ' · PAUSED') + ' → ' + who;
    if (!r.enabled) { ok.push('[PAUSED] ' + head); continue; }
    if (downVals.length) {
      down.push('[DOWN] ' + head + '\n        broken: ' + downVals.map((v) => (v === '__seg' ? '(whole segment)' : '`' + v + '`')).join(', '));
    } else if (susVals.length) {
      sus.push('[SUSPECT] ' + head + '\n        first sighting on: ' + susVals.map((v) => (v === '__seg' ? '(whole segment)' : '`' + v + '`')).join(', ') + ' — confirms or clears next check');
    } else {
      ok.push('[OK] ' + head);
    }
  }
  L.push('WATCH RULES (' + rKeys.length + ') — ' + down.length + ' down · ' + sus.length + ' suspect · ' + (rKeys.length - down.length - sus.length) + ' ok');
  for (const s of down.concat(sus, ok)) L.push('  ' + s);
  if (!rKeys.length) L.push('  (no watch rules configured)');
  L.push('');

  // estate board, worst first
  const fKeys = Object.keys(idx || {}).sort((a, b) => {
    const rank = (e) => (e.status === 'crit' ? 0 : e.status === 'warn' ? 1 : e.status === 'unreachable' ? 2 : 3);
    return rank(idx[a] || {}) - rank(idx[b] || {}) || a.localeCompare(b);
  });
  const badge = (e) => (e.status === 'crit' ? '[CRIT]' : e.status === 'warn' ? '[WARN]' : e.status === 'unreachable' ? '[UNREACHABLE]' : '[ok]');
  L.push('ESTATE (' + fKeys.length + ' scanned feeds)');
  for (const k of fKeys) {
    const e = idx[k] || {};
    const cov = LABEL_KEYS.map((lk, i) => (e.cov && e.cov[lk] != null ? 'CL' + i + ' ' + e.cov[lk] + '%' : null)).filter(Boolean).join(' · ');
    L.push('  ' + badge(e) + ' ' + dispFeed(k.split('|')[0], k.split('|')[1]) + ' — ' + (e.rows != null ? e.rows + ' rows' : 'no scan') +
      (cov ? ' · ' + cov : '') + ((e.nCrit || e.nWarn) ? ' · ' + (e.nCrit || 0) + ' crit / ' + (e.nWarn || 0) + ' warn' : ''));
  }
  L.push('');

  // active baseline alerts
  const aKeys = Object.keys(alerts || {});
  let aN = 0;
  const aLines = [];
  for (const k of aKeys) {
    for (const a of ((alerts[k] || {}).alerts || [])) {
      if (a.sev === 'info') continue;
      aN++;
      if (aLines.length < 15) aLines.push('  [' + String(a.sev).toUpperCase() + '] ' + dispFeed(k.split('|')[0], k.split('|')[1]) + ' — ' + a.msg);
    }
  }
  L.push('ACTIVE ALERTS — vs last known-good (' + aN + ')');
  if (aLines.length) { for (const s of aLines) L.push(s); if (aN > aLines.length) L.push('  … +' + (aN - aLines.length) + ' more on the board'); }
  else L.push('  none — every scanned feed matches its last known-good state');
  L.push('');
  if (link) L.push('Live board: ' + link);
  return L.join('\n');
}

/* ---------------- baseline diff -> alerts ---------------------------------------------- */
// [{ sev: 'crit'|'warn'|'info', code, label?, value?, msg, was?, now? }]
export function diffSnapshots(base, cur, th, keys) {
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

  for (const k of (keys || LABEL_KEYS)) {
    const b = (base.labels || {})[k], c = (cur.labels || {})[k];
    const CL = dispKey(k);
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
export function summarize(snap, alerts, baseT, keys) {
  const cov = {}; let present = 0;
  for (const k of (keys || LABEL_KEYS)) {
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
