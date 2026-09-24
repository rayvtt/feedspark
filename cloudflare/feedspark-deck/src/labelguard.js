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
  // materiality floors (Aug 2026 noise pass): relative drops alone over-fire on small
  // values — a 12->5 niche label is churn, not a PMAX event. bigVal() gates crit,
  // minLost() gates warn by ABSOLUTE SKUs lost; both scale with feed size below.
  maxValues: 250,      // per-label distinct values kept (gviz `limit`)
};

// a value is significant enough to track when it covers ≥0.5% of the feed (min 10 SKUs)
export function sigFloor(rows) { return Math.max(10, Math.ceil((rows || 0) * 0.005)); }
// a value a campaign would actually FEEL losing: crit territory. Scales with feed size but
// CAPPED — SKU counts carry absolute meaning for PMAX listing groups, so a 200+-SKU value
// is always big news even inside a 100k-row feed.
export function bigVal(rows) { return Math.max(25, Math.min(200, Math.ceil((rows || 0) * 0.01))); }
// minimum absolute SKUs lost before a partial value-drop is worth a warn (same cap logic)
export function minLost(rows) { return Math.max(15, Math.min(75, Math.ceil((rows || 0) * 0.0025))); }
// case/whitespace-insensitive form — a feed regen that reflows "Best Sellers " into
// "best sellers" must read as a RENAME, not a value-gone crit plus a value-new info
export function normVal(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase(); }

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
export async function scanFeed(fetchFn, src, meta, keys, opts) {
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

  // 2. one multi-count query: total rows (count id) + per-key filled counts. With
  // opts.attrs the Golden Record roster rides the SAME query (extra count() aggregates,
  // columns already counted are reused) — attribute coverage costs zero extra subrequests.
  const sel = ['count(' + colLetter(cols.id) + ')'];
  for (const k of keys) if (cols.labels[k] >= 0) sel.push('count(' + colLetter(cols.labels[k]) + ')');
  let attrCols = null; const attrPos = {};
  if (opts && opts.attrs) {
    attrCols = findAttrCols(head[0]);
    const posOf = {}; posOf[cols.id] = 0;
    { let ci = 1; for (const k of keys) if (cols.labels[k] >= 0) { posOf[cols.labels[k]] = ci; ci++; } }
    for (const s of ATTR_SPEC) {
      const c = attrCols[s.key];
      if (c == null || c < 0) continue;
      if (posOf[c] != null) attrPos[s.key] = posOf[c];
      else { posOf[c] = sel.length; attrPos[s.key] = sel.length; sel.push('count(' + colLetter(c) + ')'); }
    }
  }
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

  const snap = snapshotFromParts(meta, cols, countsRow, groupRowsByKey, keys);
  if (attrCols) snap.attrs = attrsFromCounts(attrCols, attrPos, countsRow, snap.rows);
  return snap;
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

/* ---------------- browser cross rails for {xml} feeds (Ray, 10 Sep 2026) ---------------
 * gviz can only query Google Sheets, so a FeedHero-XML feed's cross-dissection is computed
 * IN THE PAGE (same posture as the #304 live rescan): the guard page streams
 * /api/feed/proxy ONCE through xmlCrossCapture below, keeps only the six cross columns
 * per item, and answers every subsequent by/value/vs flip from that in-memory capture —
 * flipping CL chips never re-streams a 40MB feed. crossFromRows then returns the EXACT
 * crossFeed() response shape, so the pages' renderCross panels work unchanged.
 *
 * xmlCrossCapture reads each <item>'s tags BY NAME, deliberately independent of any
 * parser header settled from early items — a sparse label that first appears thousands
 * of rows in (Monsoon's custom_label_1: filled on 458 of 8,898 items, first at #52,
 * past createXmlParser's 50-item header sample) is still captured. */
export const XKEYS = LABEL_KEYS.concat(PT_KEYS);
export function xmlCrossCapture() {
  let buf = '', done = false;
  const rows = [];
  // <g:custom_label_2>…</g:custom_label_2> — optional ns prefix, backreferenced close tag
  const tagRe = new RegExp('<((?:[A-Za-z0-9_.-]+:)?(' + XKEYS.join('|') + '))(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\1\\s*>', 'g');
  const decode = (s) => {
    s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  };
  const item = (body) => {
    const row = XKEYS.map(() => '');
    const seen = {};
    let m, any = false;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(body))) {
      const k = m[2];
      if (seen[k]) continue;   // first occurrence only — repeated product_type slots (2..10) are keywords, not the category tree
      seen[k] = 1;
      const v = decode(m[3]);
      if (v) { row[XKEYS.indexOf(k)] = v; any = true; }
    }
    if (any) rows.push(row);   // items with no cross column filled can never join a segment
  };
  const push = (chunk) => {
    if (done) return;
    buf += chunk;
    for (;;) {
      const lo = buf.search(/<item[\s>]/);   // NOT indexOf('<item') — <item_group_id> must not match
      if (lo < 0) { if (buf.length > 65536) buf = buf.slice(-4096); break; }   // no boundary — keep a tail, stay bounded
      const hi = buf.indexOf('</item>', lo);
      if (hi < 0) { if (lo > 0) buf = buf.slice(lo); break; }   // partial item — wait for more chunks
      item(buf.slice(buf.indexOf('>', lo) + 1, hi));
      buf = buf.slice(hi + 7);
    }
  };
  const end = () => { done = true; buf = ''; return rows; };
  return { push, end, rows: () => rows };
}

// crossFeed's exact response contract, computed from the captured rows: labelled sums
// only the kept top-250 (the gviz `limit` also hid the tail inside `unlabelled`), so the
// panels read identically whichever lane answered.
export function crossFromRows(rows, byKey, value, vsKey) {
  const bi = XKEYS.indexOf(byKey), vi = XKEYS.indexOf(vsKey);
  if (bi < 0 || vi < 0 || byKey === vsKey) {
    throw new Error('bad-cross: by/vs must be two different keys from custom_label_0..4 / product_type');
  }
  const want = String(value == null ? '' : value).trim();
  if (!want) throw new Error('bad-cross: empty value');
  let segment = 0;
  const m = new Map();
  for (const r of rows || []) {
    if (String(r[bi] == null ? '' : r[bi]).trim() !== want) continue;
    segment++;
    const v = String(r[vi] == null ? '' : r[vi]).trim();
    if (v) m.set(v, (m.get(v) || 0) + 1);
  }
  const all = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const kept = all.slice(0, TH.maxValues);
  let labelled = 0;
  for (const e of kept) labelled += e[1];
  return { by: byKey, value: String(value), vs: vsKey, segment, labelled,
    unlabelled: Math.max(0, segment - labelled), rows: kept.map((e) => [e[0], e[1]]),
    truncated: all.length > TH.maxValues, t: Date.now() };
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

  // Product Type Guard section (only when the caller supplies its alert map)
  if (inp.ptAlerts) {
    let pN = 0;
    const pLines = [];
    for (const k of Object.keys(inp.ptAlerts)) {
      for (const a of ((inp.ptAlerts[k] || {}).alerts || [])) {
        if (a.sev === 'info') continue;
        pN++;
        if (pLines.length < 15) pLines.push('  [' + String(a.sev).toUpperCase() + '] ' + dispFeed(k.split('|')[0], k.split('|')[1]) + ' — ' + a.msg);
      }
    }
    L.push('PRODUCT TYPE ALERTS — vs last known-good (' + pN + ')');
    if (pLines.length) { for (const s of pLines) L.push(s); if (pN > pLines.length) L.push('  … +' + (pN - pLines.length) + ' more on /ptypes'); }
    else L.push('  none — every scanned feed matches its last known-good category tree');
    L.push('');
  }

  // Golden Record section (attribute coverage vs Google's product data spec)
  if (inp.grAlerts) {
    let gN = 0;
    const gLines = [];
    for (const k of Object.keys(inp.grAlerts)) {
      for (const a of ((inp.grAlerts[k] || {}).alerts || [])) {
        if (a.sev === 'info') continue;
        gN++;
        if (gLines.length < 15) gLines.push('  [' + String(a.sev).toUpperCase() + '] ' + dispFeed(k.split('|')[0], k.split('|')[1]) + ' — ' + a.msg);
      }
    }
    L.push('GOLDEN RECORD ALERTS — attribute coverage vs last known-good (' + gN + ')');
    if (gLines.length) { for (const s of gLines) L.push(s); if (gN > gLines.length) L.push('  … +' + (gN - gLines.length) + ' more on /golden'); }
    else L.push('  none — attribute coverage holds on every scanned feed');
    L.push('');
  }

  if (link) L.push('Live board: ' + link);
  return L.join('\n');
}

/* ---------------- estate alert emails (PT Guard "email on warning") -------------------- */
// Which estate alerts to EMAIL on this scan. Two-strike by construction: an alert is
// mailed only when it was already present on the previous scan's stored entry AND is
// still active now — a single garbage read (mid-refresh sheet, gviz throttling) never
// emails — and only once per continuous incident (the entry's `mailed` keys persist
// while the feed stays broken; recovery emails once everything clears).
export function alertKey(a) { return a.code + '|' + (a.label || '') + '|' + normVal(a.value); }
export function estateMailPlan(prevEntry, active) {
  const prev = new Set(((prevEntry && prevEntry.alerts) || []).filter((a) => a.sev !== 'info').map(alertKey));
  const mailedPrev = (prevEntry && prevEntry.mailed) || [];
  const activeKeys = new Set(active.map(alertKey));
  const mailedSet = new Set(mailedPrev);
  const mail = active.filter((a) => prev.has(alertKey(a)) && !mailedSet.has(alertKey(a)));
  const mailed = mailedPrev.filter((k) => activeKeys.has(k)).concat(mail.map(alertKey));
  return { mail, mailed, recovered: active.length === 0 && mailedPrev.length > 0 };
}
export function estateAlertEmail(feedName, alerts, link) {
  return '🔴 PT Guard — ' + feedName + ': ' + alerts.length + ' confirmed product-type alert' + (alerts.length === 1 ? '' : 's') + '\n' +
    'Seen on two consecutive scans vs last known-good — PMAX listing groups split on these category paths.\n' +
    alerts.map((a) => '• [' + String(a.sev).toUpperCase() + '] ' + a.msg).join('\n') +
    '\nIntentional change? Open /ptypes and hit "Expected — accept as known-good".' +
    (link ? '\n' + link : '');
}
export function estateRecoveryEmail(feedName, link) {
  return '✅ PT Guard — ' + feedName + ' recovered\nEvery flagged product-type alert has cleared vs last known-good.' + (link ? '\n' + link : '');
}

/* ---------------- PT depth granularity (the "how granular" KPI for Google) ------------- */
// SKU-weighted share of the catalogue at each category-path depth — the taxonomy
// granularity number Google reads off g:product_type ("Womenswear > Clothing > Dresses >
// Midi Dresses" = depth 4). Chevron-separated paths; feeds without ">" fall back to "/".
// Computed over the pivot's value list, so a truncated (250+) feed profiles its top 250
// paths — the overwhelming SKU majority.
export function pathDepth(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  const sep = s.indexOf('>') >= 0 ? '>' : (s.indexOf('/') >= 0 ? '/' : null);
  if (!sep) return 1;
  return s.split(sep).filter((p) => p.trim()).length;
}
// The benchmark Ray reports against (Aug 2026, the new industry standard across the
// board): 30–40% of product VOLUME at 5-level paths — Reiss sits there. A tree with the
// majority of volume at 1–2 levels is "too shallow" and PMAX/AI surfaces read it blind.
export const DEPTH_STD = { pct5: 30, shallow: 50 };
export function depthStandard(dp) {
  if (!dp || !dp.pct) return null;
  const shallow = Math.round(((dp.pct['1'] || 0) + (dp.pct['2'] || 0)) * 10) / 10;
  const pct5 = dp.pct['5'] || 0;
  const level = shallow > DEPTH_STD.shallow ? 'shallow' : (pct5 < DEPTH_STD.pct5 ? 'below' : 'ok');
  return { level, shallow, pct5, target: DEPTH_STD.pct5 };
}
// the client ask — same consultative voice as Label Guard's askCompose, proposal not alarm
export function depthAskEmail(client, mkt, dp, std) {
  const loc = client + ' ' + String(mkt || '').toUpperCase();
  const subject = loc + ' — product type depth: proposal to deepen the category tree';
  const body = 'Hi team,\n\n'
    + 'A quick recommendation from our feed monitoring. Google increasingly rewards granular product_type category trees — the standard we now work to across accounts is 30–40% of product volume sitting at 5-level paths (e.g. Womenswear > Clothing > Dresses > Midi Dresses > Wrap), with the bulk of the catalogue at 3–4 levels or deeper.\n\n'
    + 'Where the ' + loc + ' feed sits today (share of product volume by category-path depth):\n'
    + '• 1–2 levels: ' + std.shallow + '%\n'
    + '• 3 levels: ' + (dp.pct['3'] || 0) + '%\n'
    + '• 4 levels: ' + (dp.pct['4'] || 0) + '%\n'
    + '• 5 levels: ' + (dp.pct['5'] || 0) + '%\n\n'
    + (std.level === 'shallow'
      ? 'Most of the catalogue currently sits at 1–2 levels, which limits how precisely the Shopping campaigns can segment and how well the newer AI shopping surfaces read the range. We would propose restructuring the tree to 3–4 levels as a first step, then extending the highest-volume categories to 5.'
      : 'The tree is in reasonable shape at 3–4 levels; the opportunity is extending the highest-volume categories to 5-level paths to reach the 30–40% benchmark.')
    + '\n\nWe can run this as a structured optimisation from our side — happy to share a short plan of the proposed hierarchy for sign-off before anything changes in the live feed.\n\n'
    + 'Best regards,\nRay';
  return { subject, body };
}
export function depthProfile(values) {
  const counts = {};
  let total = 0, wsum = 0;
  for (const pr of (values || [])) {
    const d = pathDepth(pr[0]);
    const n = pr[1] || 0;
    if (!d || !n) continue;
    const b = d >= 6 ? '6+' : String(d);
    counts[b] = (counts[b] || 0) + n;
    total += n; wsum += d * n;
  }
  if (!total) return null;
  const pct = {};
  for (const b of POP_KEYS) pct[b] = counts[b] ? Math.round((counts[b] / total) * 1000) / 10 : 0;
  return { pct, avg: Math.round((wsum / total) * 10) / 10, skus: total };
}

/* ---------------- POPULATION — how many VALUES a SKU carries (Ray, 18 Sep 2026) --------
   "I want this feature [the PT depth granularity table] to be the table breakdown for
   highlight population (1, 2, 3, 4, 5, >5) applied to label cards and product types as well."
   depthProfile answers "how deep is the path"; this answers "how many of the thing does a
   SKU carry" — custom labels populated per SKU (0–5), product_type values per SKU (the
   category tree plus every keyword slot), highlights per product — in the SAME shape
   (pct per bucket 1..5 / 6+, avg, skus profiled) so the three cards read alike. A SKU with
   NONE is not profiled (coverage is the other question) but is counted in `zero` so the
   card can say so out loud rather than quietly leaving it out of the denominator. */
export const POP_KEYS = ['1', '2', '3', '4', '5', '6+'];
export function popBucket(n) { return n >= 6 ? '6+' : String(n); }
export function popProfile(hist) {
  const counts = {};
  let total = 0, wsum = 0, zero = 0, max = 0;
  for (const k of Object.keys(hist || {})) {
    const c = Math.max(0, Math.round(+k || 0)), n = Math.max(0, Math.round(+hist[k] || 0));
    if (!n) continue;
    if (!c) { zero += n; continue; }
    const b = popBucket(c);
    counts[b] = (counts[b] || 0) + n;
    total += n; wsum += c * n;
    if (c > max) max = c;
  }
  if (!total) return null;
  const pct = {};
  for (const b of POP_KEYS) pct[b] = counts[b] ? Math.round((counts[b] / total) * 1000) / 10 : 0;
  return { pct, avg: Math.round((wsum / total) * 10) / 10, skus: total, zero, max };
}
// the push lanes (the 4x-daily agent, the page's live rescan) hand the worker a profile
// they computed — this keeps it to the exact shape, every number clamped, or drops it
export function cleanPop(p) {
  if (!p || typeof p !== 'object' || !p.pct || typeof p.pct !== 'object') return null;
  const num = (v, cap) => Math.max(0, Math.min(cap, Math.round((Number(v) || 0) * 10) / 10));
  const pct = {};
  for (const b of POP_KEYS) pct[b] = num(p.pct[b], 100);
  const skus = Math.max(0, Math.round(Number(p.skus) || 0));
  if (!skus) return null;
  return { pct, avg: num(p.avg, 1e4), skus, zero: Math.max(0, Math.round(Number(p.zero) || 0)), max: Math.max(0, Math.round(Number(p.max) || 0)) };
}
// every column a repeatable attribute occupies — bare `key`, or `key(n)` — the XML parser's
// shape for a repeated tag and the sheet exports' |||n shape after normHeader
export function slotCols(headerRow, key) {
  const norm = (headerRow || []).map(normHeader);
  const re = new RegExp('^' + key + '\\((\\d+)\\)$');
  const hits = [];
  for (let i = 0; i < norm.length; i++) if (norm[i] === key || re.test(norm[i])) hits.push(i);
  return hits;
}

/* ---------------- Golden Record: attribute coverage (module /golden) ------------------- */
// The attribute roster, vetted against Google's product data specification
// (support.google.com/google-ads/answer/7052112 — checked Aug 2026). Three tiers:
//   required — required for every product (feed-carried)
//   cond     — required in specific cases; `note` quotes the condition. For FeedSpark's
//              apparel/footwear estate the apparel five (color/size/gender/age_group +
//              item_group_id) are effectively required — the page flags them hard.
//   rec      — optional/recommended per the spec: the optimisation surface.
// Account-level attributes (shipping, tax) live in Merchant Center settings, not the
// feed — deliberately absent so a healthy feed never flags on them.
export const ATTR_SPEC = [
  { key: 'id',            req: 'required', note: 'unique identifier — use the SKU' },
  { key: 'title',         req: 'required', note: 'max 150 chars' },
  { key: 'description',   req: 'required', note: 'max 5000 chars' },
  { key: 'link',          req: 'required', note: 'product landing page' },
  { key: 'image_link',    req: 'required', note: 'min 500×500px enforced from Jan 2027' },
  { key: 'availability',  req: 'required', note: 'in_stock / out_of_stock / preorder / backorder' },
  { key: 'price',         req: 'required', note: 'must match the landing page' },
  { key: 'brand',         req: 'cond', note: 'required for all new products' },
  { key: 'gtin',          req: 'cond', note: 'strongly recommended — drives Shopping Graph matching; MPN accepted instead' },
  { key: 'mpn',           req: 'cond', note: 'required when no GTIN is available' },
  { key: 'condition',     req: 'cond', note: 'required if used / refurbished' },
  { key: 'item_group_id', req: 'cond', note: 'required for variants + all free listings' },
  { key: 'color',         req: 'cond', apparel: true, note: 'required — apparel in UK/DE/FR/US/JP/BR + variants' },
  { key: 'size',          req: 'cond', apparel: true, note: 'required — apparel Clothing & Shoes + variants' },
  { key: 'gender',        req: 'cond', apparel: true, note: 'required — apparel in UK/DE/FR/US/JP/BR + variants' },
  { key: 'age_group',     req: 'cond', apparel: true, note: 'required — apparel in UK/DE/FR/US/JP/BR + variants' },
  { key: 'google_product_category', req: 'rec', note: 'Google auto-assigns; submit to override' },
  { key: 'product_type',  req: 'rec', note: 'drives PMAX listing groups — monitored in depth on PT Guard' },
  { key: 'sale_price',    req: 'rec', note: 'with sale_price_effective_date for promos' },
  { key: 'additional_image_link', req: 'rec', note: 'up to 10 — fuels image cycling' },
  { key: 'product_highlight', req: 'rec', note: '2–100 highlights — AI-surfaces read these' },
  { key: 'product_detail',    req: 'rec', note: 'structured tech specs' },
  { key: 'material',      req: 'rec', note: 'required only when it distinguishes variants' },
  { key: 'pattern',       req: 'rec', note: 'required only when it distinguishes variants' },
  { key: 'size_type',     req: 'rec', note: 'apparel: regular / petite / plus / tall…' },
  { key: 'size_system',   req: 'rec', note: 'apparel: UK / EU / US…' },
  // the six conversational AI attributes (Google 2026) — optional per the same spec page,
  // read by Google's conversational / agentic shopping surfaces; usually submitted via a
  // SUPPLEMENTAL data source, so absence from the primary feed is the expected start state.
  // Tracked as their own tier ('ai'): counted as an AI-readiness KPI, NOT in goldenScore.
  { key: 'question_and_answer', req: 'ai', note: 'up to 30 Q&A pairs per product' },
  { key: 'document_link',       req: 'ai', note: 'PDF manuals / spec sheets, up to 5' },
  { key: 'related_product',     req: 'ai', note: 'part_of_set / often_bought_with / accessory…' },
  { key: 'item_group_title',    req: 'ai', note: 'names the variant family (with item_group_id)' },
  { key: 'variant_option',      req: 'ai', note: 'name–value pairs defining variant differences' },
  { key: 'popularity_rank',     req: 'ai', note: '0–100 rank — powers "bestseller" answers' },
];
// repeatable fields often ship numbered from feed tools — slot 1 aliases onto the bare key
const ATTR_ALIASES = {
  product_type: ['product_type(1)'],
  additional_image_link: ['additional_image_link(1)'],
  product_highlight: ['product_highlight(1)'],
  product_detail: ['product_detail(1)'],
  question_and_answer: ['question_and_answer(1)'],
  document_link: ['document_link(1)'],
  related_product: ['related_product(1)'],
  variant_option: ['variant_option(1)'],
};
export function findAttrCols(headerRow) {
  const norm = (headerRow || []).map(normHeader);
  const out = {};
  for (const s of ATTR_SPEC) {
    let i = norm.indexOf(s.key);
    if (i < 0 && ATTR_ALIASES[s.key]) {
      for (const a of ATTR_ALIASES[s.key]) { i = norm.indexOf(a); if (i >= 0) break; }
    }
    out[s.key] = i;
  }
  return out;
}
// Coverage caveat (same as the raw count() column in the label scan): gviz count()
// includes formula-blank "" cells, so a column of ='' formulas reads as filled. The
// per-value group-sum correction isn't affordable across 26 attributes — accepted.
export function attrsFromCounts(attrCols, attrPos, countsRow, rows) {
  const attrs = {};
  for (const s of ATTR_SPEC) {
    const c = attrCols[s.key];
    if (c == null || c < 0) { attrs[s.key] = { present: false }; continue; }
    const filled = Math.max(0, Math.round(parseFloat(countsRow && countsRow[attrPos[s.key]]) || 0));
    attrs[s.key] = { present: true, filled, cov: rows ? Math.min(100, Math.round((filled / rows) * 1000) / 10) : 0 };
  }
  return attrs;
}

/* ---- GPC CATEGORY SCOPE (Ray, 23 Sep 2026, on Hobbycraft's material 47.9% / pattern 43.9%:
   "for standard GPC material, that attribute is not required. So by that logic, it should not
   be cumulated or counted toward the score"). Every attribute used to be scored over EVERY
   product in the feed, so a craft catalogue was marked down for yarn and paint without a
   gender, and a golf retailer for clubs without a size. Google's spec does NOT assign
   attributes per category across the ~5,600 GPCs — only these carry a category rule, each
   quoted from its own help page (fetched 23 Sep 2026):
     color      answer 6324487  required for Clothing & Accessories (ID 166)
     gender     answer 6324479  required for 166, optional in 16 named sub-categories
     age_group  answer 6324463  the same, plus Cufflinks (193)
     size       answer 6324492  required for Clothing (1604) and Shoes (187)
     material   answer 7348545  Google's clothing best practice: 'include colour, size,
     pattern                    material and/or pattern' — outside 166 both are 'required for
                                products that vary by material/pattern' only (6324410/6324483)
   So each of these is scored over the products whose category it applies to, and a feed with
   none of them does not carry the attribute in its score at all. A product with NO readable
   category (blank, or a value no locale's taxonomy knows) stays IN scope — the scope can only
   narrow what the score asks for when the feed says so, never because a category is missing. */
// GPC-SCOPE:DATA-START
// generated by tools/build_gpc_scope.py from Google's taxonomy-with-ids files (26 locales,
// version 2021-09-21 — Google's current taxonomy); do not edit by hand
const GPC_ROOT = ['apparel & accessories', 'clothing & accessories', 'bekleidung & accessoires', 'vêtements et accessoires', 'kleding en accessoires', 'tøj og tilbehør', 'ropa y accesorios', 'abbigliamento e accessori', 'kläder och accessoarer', 'klær og tilbehør', 'ubrania i akcesoria', 'vestuário e acessórios', 'oblečení a doplňky', 'ファッション・アクセサリー', 'kıyafet ve aksesuarlar', 'предметы одежды и принадлежности', 'vaatteet ja asusteet', 'oblečenie a doplnky', 'îmbrăcăminte, încălțăminte și accesorii', 'ρούχα και αξεσουάρ', 'ruházat és kiegészítők', 'ملابس وإكسسوارات', '服饰与配饰'];
const GPC_TAILS = {
  '1604': ['clothing', 'bekleidung', 'vêtements', 'kleding', 'tøj', 'prendas de vestir', 'abbigliamento', 'kläder', 'klær', 'ubrania', 'roupas', 'oblečení', '衣料品', 'giyim eşyaları', 'одежда', 'vaatteet', 'oblečenie', 'haine', 'ενδύματα', 'ruházkodás', 'ملابس', '服装'],
  '187': ['shoes', 'schuhe', 'chaussures', 'schoenen', 'sko', 'calzado', 'scarpe', 'skor', 'buty', 'sapatos', 'obuv', '靴', 'ayakkabılar', 'обувь', 'jalkineet', 'încălțăminte', 'παπούτσια', 'cipők', 'أحذية', '鞋类'],
  '193': ['clothing accessories > cufflinks', 'bekleidungsaccessoires > manschettenknöpfe', 'accessoires d\'habillement > boutons de manchette', 'kledingaccessoires > manchetknopen', 'tilbehør til tøj > manchetknapper', 'complementos > gemelos', 'accessori di abbigliamento > gemelli da camicia', 'klädesaccessoarer > manschettknappar', 'klestilbehør > mansjettknapper', 'akcesoria do ubrań > spinki do mankietów', 'acessórios para roupas > abotoaduras', 'oděvní doplňky > manžetové knoflíčky', 'ファッション小物 > カフスボタン', 'kıyafet aksesuarları > kol düğmeleri', 'принадлежности для одежды > запонки', 'asusteet > kalvosinnapit', 'odevné doplnky > manžetové gombíky', 'accesorii pentru îmbrăcăminte > butoni', 'αξεσουάρ ρούχων > μανικετόκουμπα', 'ruházati kiegészítők > mandzsettagombok', 'إكسسوارات الملابس > أزرار الأكمام', '服装配饰 > 袖扣'],
  '4179': ['clothing accessories > pinback buttons', 'bekleidungsaccessoires > ansteckbuttons', 'accessoires d\'habillement > badges', 'kledingaccessoires > buttons', 'tilbehør til tøj > badgeknapper', 'complementos > chapas', 'accessori di abbigliamento > spillette', 'klädesaccessoarer > pins', 'klestilbehør > nåler og merker', 'akcesoria do ubrań > przypinki', 'acessórios para roupas > botons com pino', 'oděvní doplňky > odznaky', 'ファッション小物 > 缶バッジ', 'kıyafet aksesuarları > arkası i̇ğneli düğmeler', 'принадлежности для одежды > значки', 'asusteet > rintanapit', 'odevné doplnky > odznaky', 'accesorii pentru îmbrăcăminte > insigne cu ac de siguranță', 'αξεσουάρ ρούχων > κονκάρδες', 'ruházati kiegészítők > kitűzők', 'إكسسوارات الملابس > أزرار دبابيس', '服装配饰 > 钮扣徽章'],
  '180': ['clothing accessories > tie clips', 'bekleidungsaccessoires > krawattennadeln', 'accessoires d\'habillement > pinces à cravate', 'kledingaccessoires > dasspelden', 'tilbehør til tøj > slipsenåle', 'complementos > alfileres de corbata', 'accessori di abbigliamento > fermacravatte', 'klädesaccessoarer > slipsnålar', 'klestilbehør > slipsnåler', 'akcesoria do ubrań > spinki do krawatów', 'acessórios para roupas > prendedores de gravata', 'oděvní doplňky > spony do kravat', 'ファッション小物 > ネクタイピン', 'kıyafet aksesuarları > kravat i̇ğneleri', 'принадлежности для одежды > зажимы для галстуков', 'asusteet > solmioklipsit', 'odevné doplnky > spony na kravaty', 'accesorii pentru îmbrăcăminte > ace de cravată', 'αξεσουάρ ρούχων > κλιπ γραβάτας', 'ruházati kiegészítők > nyakkendőcsíptetők', 'إكسسوارات الملابس > مشابك رباط العنق', '服装配饰 > 领带夹'],
  '1893': ['clothing accessories > wristbands', 'bekleidungsaccessoires > schweißbänder', 'accessoires d\'habillement > serre-poignets', 'kledingaccessoires > polsbanden', 'tilbehør til tøj > manchetter', 'complementos > pulseras de goma y muñequeras sudadera', 'accessori di abbigliamento > polsini', 'klädesaccessoarer > handledsband', 'klestilbehør > mansjetter', 'akcesoria do ubrań > opaski na rękę', 'acessórios para roupas > pulseiras (de relógio)', 'oděvní doplňky > šnůřky a pásky', 'ファッション小物 > リストバンド', 'kıyafet aksesuarları > kol ağızları', 'принадлежности для одежды > манжеты', 'asusteet > rannekkeet', 'odevné doplnky > potítka', 'accesorii pentru îmbrăcăminte > manșete', 'αξεσουάρ ρούχων > περικάρπια', 'ruházati kiegészítők > csuklópántok', 'إكسسوارات الملابس > أساور المعصم', '服装配饰 > 腕带'],
  '5385': ['shoe accessories > shoe covers', 'schuh-accessoires > überschuhe', 'accessoires pour chaussures > sur-chaussures', 'accessoires voor schoenen > schoenhoezen', 'tilbehør til sko > skoovertræk', 'accesorios para zapatos > fundas para zapatos', 'accessori per scarpe > coperture scarpe', 'skotillbehör > skoöverdrag', 'skotilbehør > skoomslag', 'akcesoria do butów > ochraniacze na buty', 'acessórios para sapatos > capas para calçados', 'doplňky k obuvi > návleky na boty', '靴用品 > シューズカバー', 'ayakkabı aksesuarları > galoşlar', 'принадлежности для обуви > бахилы', 'jalkinetarvikkeet > kenkäsuojat', 'príslušenstvo k obuvi > poťahy na topánky', 'accesorii pentru încălțăminte > protecții pentru încălțăminte', 'αξεσουάρ για παπούτσια > καλύμματα παπουτσιών', 'cipőtartozékok > lábzsákok', 'إكسسوارات الأحذية > أغطية الأحذية استخدام مرة واحدة', '鞋类配饰 > 鞋套'],
  '1856': ['shoe accessories > shoelaces', 'schuh-accessoires > schnürsenkel', 'accessoires pour chaussures > lacets', 'accessoires voor schoenen > schoenveters', 'tilbehør til sko > snørebånd', 'accesorios para zapatos > cordones de zapatos', 'accessori per scarpe > stringhe per scarpe', 'skotillbehör > skosnören', 'skotilbehør > skolisser', 'akcesoria do butów > sznurowadła', 'acessórios para sapatos > cadarços', 'doplňky k obuvi > tkaničky do bot', '靴用品 > 靴ひも', 'ayakkabı aksesuarları > ayakkabı bağcıkları', 'принадлежности для обуви > шнурки для обуви', 'jalkinetarvikkeet > kengännauhat', 'príslušenstvo k obuvi > šnúrky do topánok', 'accesorii pentru încălțăminte > șireturi', 'αξεσουάρ για παπούτσια > κορδόνια για παπούτσια', 'cipőtartozékok > cipőfűzők', 'إكسسوارات الأحذية > أربطة أحذية', '鞋类配饰 > 鞋带'],
  '2427': ['shoe accessories > spurs', 'schuh-accessoires > sporen', 'accessoires pour chaussures > éperons', 'accessoires voor schoenen > sporen', 'tilbehør til sko > sporer', 'accesorios para zapatos > espuelas', 'accessori per scarpe > speroni', 'skotillbehör > sporrar', 'skotilbehør > sporer', 'akcesoria do butów > ostrogi', 'acessórios para sapatos > esporas', 'doplňky k obuvi > ostruhy', '靴用品 > 拍車', 'ayakkabı aksesuarları > mahmuzlar', 'принадлежности для обуви > шпоры', 'jalkinetarvikkeet > kannukset', 'príslušenstvo k obuvi > ostrohy', 'accesorii pentru încălțăminte > pinteni', 'αξεσουάρ για παπούτσια > σπιρούνια', 'cipőtartozékok > sarkantyúk', 'إكسسوارات الأحذية > مهاميز الخيول', '鞋类配饰 > 马刺'],
  '5123': ['jewelry > watch accessories > watch bands', 'jewellery & watches > watch accessories > watch bands', 'schmuck > uhrenaccessoires > uhrenarmbänder', 'bijoux > accessoires pour montres > bracelets de montres', 'sieraden > horlogeaccessoires > horlogebanden', 'smykker > tilbehør til ure > urremme', 'joyería > accesorios para reloj > correas de reloj', 'preziosi > accessori per orologi > cinturini per orologi', 'smycken > tillbehör till armbandsklockor > klockarmband', 'smykker > klokketilbehør > klokkereimer', 'biżuteria > akcesoria do zegarków > paski do zegarków', 'joias > acessórios para relógios > pulseiras para relógio', 'klenoty > hodinky – příslušenství > náhradní pásky k hodinkám', 'ジュエリー > 時計小物 > 時計用ベルト・バンド', 'mücevherler > kol saati aksesuarları > kol saati kayışları', 'ювелирные украшения > принадлежности для наручных часов > ремешки для часов', 'korut > kellojen tarvikkeet > kellonrannekkeet', 'šperky > príslušenstvo pre hodinky > remienky na hodinky', 'bijuterii > accesorii pentru ceasuri de mână > curele de ceas', 'κοσμήματα > αξεσουάρ ρολογιού χειρός > λουράκια για ρολόγια', 'ékszer > karóratartozékok > óraszíjak', 'حُلي > إكسسوارت ساعات اليد > أحزمة ساعات يد', '珠宝首饰 > 手表配件 > 表带'],
  '175': ['handbag & wallet accessories > keychains', 'handbag & wallet accessories > key chains', 'handtaschen & geldbörsenaccessoires > schlüsselanhänger', 'accessoires pour sacs à main et portefeuilles > porte-clés', 'accessoires voor handtassen en portefeuilles > sleutelhangers', 'tilbehør til håndtasker og pengepunge > nøgleringe', 'accesorios para bolsos y billeteras > llaveros', 'accessori per borsette e portafogli > portachiavi', 'accessoarer till handväskor och plånböcker > nyckelringar', 'håndveske- og lommeboktilbehør > nøkkelringer', 'akcesoria do torebek i portfeli > breloczki', 'acessórios para bolsas e carteiras > chaveiros', 'doplňky ke kabelkám a peněženkám > přívěsky na klíče', 'ハンドバッグ・財布用小物 > キーチェーン', 'el çantası ve cüzdan aksesuarları > anahtarlık halkaları', 'принадлежности для ручных сумок и кошельков > брелоки для ключей', 'käsilaukkujen ja lompakoiden tarvikkeet > avaimenperät', 'doplnky ku kabelkám a peňaženkám > prívesky na kľúče', 'accesorii pentru poșete și portofele > brelocuri pentru chei', 'αξεσουάρ για τσάντες χειρός και πορτοφόλια > μπρελόκ', 'kézitáska- és pénztárcatartozékok > kulcstartók', 'إكسسوارات حقائب اليد والمحافظ > ميداليات مفاتيح', '手提包/钱包配件 > 钥匙链'],
  '5841': ['handbag & wallet accessories > wallet chains', 'handtaschen & geldbörsenaccessoires > brieftaschenketten', 'accessoires pour sacs à main et portefeuilles > chaînes pour portefeuille', 'accessoires voor handtassen en portefeuilles > portefeuillekettingen', 'tilbehør til håndtasker og pengepunge > kæder til pengepunge', 'accesorios para bolsos y billeteras > cadenas de bolsillo', 'accessori per borsette e portafogli > catene per portafogli', 'accessoarer till handväskor och plånböcker > plånbokskedjor', 'håndveske- og lommeboktilbehør > lommebok-lenker', 'akcesoria do torebek i portfeli > łańcuchy do portfela', 'acessórios para bolsas e carteiras > correntes de carteira', 'doplňky ke kabelkám a peněženkám > řetízky k peněženkám', 'ハンドバッグ・財布用小物 > ウォレットチェーン', 'el çantası ve cüzdan aksesuarları > cüzdan zincirleri', 'принадлежности для ручных сумок и кошельков > цепи для кошельков', 'käsilaukkujen ja lompakoiden tarvikkeet > lompakkoketjut', 'doplnky ku kabelkám a peňaženkám > retiazky na peňaženku', 'accesorii pentru poșete și portofele > lanțuri pentru pantaloni', 'αξεσουάρ για τσάντες χειρός και πορτοφόλια > αλυσίδες πορτοφολιού', 'kézitáska- és pénztárcatartozékok > pénztárcaláncok', 'إكسسوارات حقائب اليد والمحافظ > سلاسل المحافظ', '手提包/钱包配件 > 钱包链'],
  '6277': ['handbag & wallet accessories > lanyards', 'handtaschen & geldbörsenaccessoires > tragebänder', 'accessoires pour sacs à main et portefeuilles > cordons', 'accessoires voor handtassen en portefeuilles > sleutelkoorden', 'tilbehør til håndtasker og pengepunge > halssnore', 'accesorios para bolsos y billeteras > cintas', 'accessori per borsette e portafogli > cordini', 'accessoarer till handväskor och plånböcker > snoddar', 'håndveske- og lommeboktilbehør > bæresnorer', 'akcesoria do torebek i portfeli > smycze', 'acessórios para bolsas e carteiras > correias de pescoço', 'doplňky ke kabelkám a peněženkám > šňůrky na krk', 'ハンドバッグ・財布用小物 > ネックストラップ', 'el çantası ve cüzdan aksesuarları > boyun askıları', 'принадлежности для ручных сумок и кошельков > ремешки', 'käsilaukkujen ja lompakoiden tarvikkeet > kaula- ja rannenauhat', 'doplnky ku kabelkám a peňaženkám > šnúrky na krk', 'accesorii pentru poșete și portofele > șnururi', 'αξεσουάρ για τσάντες χειρός και πορτοφόλια > κορδόνια λαιμού', 'kézitáska- és pénztárcatartozékok > nyakpántok', 'إكسسوارات حقائب اليد والمحافظ > شريط للتعليق حول الرقبة', '手提包/钱包配件 > 挂绳'],
  '6460': ['handbag & wallet accessories > checkbook covers', 'handbag & wallet accessories > chequebook covers', 'handtaschen & geldbörsenaccessoires > scheckheftetuis', 'accessoires pour sacs à main et portefeuilles > protège-chéquiers', 'accessoires voor handtassen en portefeuilles > chequeboekomslagen', 'tilbehør til håndtasker og pengepunge > checkhæfteholdere', 'accesorios para bolsos y billeteras > fundas para talonarios', 'accessori per borsette e portafogli > portassegni', 'accessoarer till handväskor och plånböcker > omslag för checkhäften', 'håndveske- og lommeboktilbehør > sjekkhefte-omslag', 'akcesoria do torebek i portfeli > okładki na książeczki czekowe', 'acessórios para bolsas e carteiras > capas para talões de cheques', 'doplňky ke kabelkám a peněženkám > pouzdra na šekové knížky', 'ハンドバッグ・財布用小物 > 小切手帳カバー', 'el çantası ve cüzdan aksesuarları > çek defteri kılıfları', 'принадлежности для ручных сумок и кошельков > обложки для чековых книжек', 'käsilaukkujen ja lompakoiden tarvikkeet > sekkivihon kannet', 'doplnky ku kabelkám a peňaženkám > puzdrá na šekové knižky', 'accesorii pentru poșete și portofele > coperți pentru carnetul de cecuri', 'αξεσουάρ για τσάντες χειρός και πορτοφόλια > καλύμματα μπλοκ επιταγών', 'kézitáska- és pénztárcatartozékok > csekk-könyvtárcák', 'إكسسوارات حقائب اليد والمحافظ > أغلفة دفاتر الشيكات', '手提包/钱包配件 > 支票夹/票据夹'],
  '6170': ['handbags, wallets & cases > badge & pass holders', 'handtaschen, geldbörsen & etuis > ausweistaschen', 'sacs à main, portefeuilles et étuis > étuis pour badges et insignes', 'handtassen, portefeuilles en koffers > badge- en pashouders', 'håndtasker, pengepunge og holdere > badges og adgangskortholdere', 'bolsos, billeteras y estuches > colgadores para pases e insignias', 'borsette, portafogli e custodie > portabadge e portacartellino', 'handväskor, plånböcker och fodral > fodral för pass och id-kort', 'håndvesker, lommebøker og omslag > id-holdere', 'torebki, portfele i etui > kieszonki na identyfikatory i przepustki', 'bolsas, carteiras e estojos > porta-crachás', 'kabelky, peněženky a pouzdra > držáky a pouzdra na odznaky a průkazky', 'ハンドバッグ・財布 > パスケース・idホルダー', 'el çantaları, cüzdanlar ve çantalar > kimlik ve paso kılıfları', 'ручные сумки, кошельки и чехлы > держатели для бейджей и пропусков', 'käsilaukut, lompakot ja kotelot > henkilökortti- ja passikotelot', 'kabelky, peňaženky a puzdrá > držiaky na odznaky a preukazy', 'poșete, portofele și huse > suporturi pentru legitimații', 'τσάντες, πορτοφόλια και θήκες > θήκες για ταυτότητες και πάσα', 'kézitáskák, pénztárcák és tokok > jelvény- és kártyatartók', 'حقائب اليد والمحافظ والحقائب الكبيرة > حاملات بطاقات المرور والشارات', '手提包、钱包与箱包 > 员工卡/门禁卡卡套'],
  '6870': ['jewelry > watch accessories > watch winders', 'jewellery & watches > watch accessories > watch winders', 'schmuck > uhrenaccessoires > uhrenbeweger', 'bijoux > accessoires pour montres > remontoirs', 'sieraden > horlogeaccessoires > horlogeopwinders', 'smykker > tilbehør til ure > uroptrækkere', 'joyería > accesorios para reloj > cuerdas para relojes', 'preziosi > accessori per orologi > avvolgitori per orologi', 'smycken > tillbehör till armbandsklockor > klockuppdragare', 'smykker > klokketilbehør > klokkeopptrekkere', 'biżuteria > akcesoria do zegarków > rotomaty do zegarków', 'joias > acessórios para relógios > aparelhos para dar corda', 'klenoty > hodinky – příslušenství > natahovací klíčky k hodinkám', 'ジュエリー > 時計小物 > 腕時計自動巻き上げ機', 'mücevherler > kol saati aksesuarları > kol saati kutuları', 'ювелирные украшения > принадлежности для наручных часов > устройства для завода часов', 'korut > kellojen tarvikkeet > kellonpyörittimet', 'šperky > príslušenstvo pre hodinky > naťahovače hodiniek', 'bijuterii > accesorii pentru ceasuri de mână > dispozitive pentru întors ceasuri automatice', 'κοσμήματα > αξεσουάρ ρολογιού χειρός > θήκες κουρδίσματος ρολογιών χειρός', 'ékszer > karóratartozékok > órafelhúzók és mozgó óratartók', 'حُلي > إكسسوارت ساعات اليد > ملفاف ساعات اليد', '珠宝首饰 > 手表配件 > 手表上链盒'],
  '7471': ['jewelry > watch accessories > watch stickers & decals', 'jewellery & watches > watch accessories > watch stickers & decals', 'schmuck > uhrenaccessoires > aufkleber für uhren', 'bijoux > accessoires pour montres > stickers et décalcomanies pour montres', 'sieraden > horlogeaccessoires > stickers en transfers voor horloges', 'smykker > tilbehør til ure > klistermærker til ure', 'joyería > accesorios para reloj > pegatinas y calcomanías para relojes', 'preziosi > accessori per orologi > adesivi e decalcomanie per orologi', 'smycken > tillbehör till armbandsklockor > klockstickers och -dekaler', 'smykker > klokketilbehør > klokkeklistremerker og -dekaler', 'biżuteria > akcesoria do zegarków > naklejki na tarcze', 'joias > acessórios para relógios > adesivos e decalques para relógio', 'klenoty > hodinky – příslušenství > nálepky a obtisky na hodinky', 'ジュエリー > 時計小物 > 時計用シール・ステッカー', 'mücevherler > kol saati aksesuarları > kol saati etiketleri ve çıkartmaları', 'ювелирные украшения > принадлежности для наручных часов > наклейки для наручных часов', 'korut > kellojen tarvikkeet > kellon tarrat ja siirtokuvat', 'šperky > príslušenstvo pre hodinky > nálepky a etikety na hodinky', 'bijuterii > accesorii pentru ceasuri de mână > abțibilduri și autocolante pentru ceasuri', 'κοσμήματα > αξεσουάρ ρολογιού χειρός > αυτοκόλλητα και χαλκομανίες ρολογιών', 'ékszer > karóratartozékok > óramatricák', 'حُلي > إكسسوارت ساعات اليد > شارات وملصقات ساعة اليد', '珠宝首饰 > 手表配件 > 手表贴纸和装饰膜'],
  '5207': ['clothing accessories > handkerchiefs', 'clothing accessories > pocket squares', 'bekleidungsaccessoires > einstecktücher', 'accessoires d\'habillement > pochettes de costume', 'kledingaccessoires > pochetten', 'tilbehør til tøj > lommetørklæder', 'complementos > pañuelos de bolsillo', 'accessori di abbigliamento > fazzoletti taschino', 'klädesaccessoarer > näsdukar', 'klestilbehør > lommetørkler', 'akcesoria do ubrań > chusteczki', 'acessórios para roupas > lenços de bolso', 'oděvní doplňky > kapesníčky do saka', 'ファッション小物 > ハンカチ', 'kıyafet aksesuarları > mendiller', 'принадлежности для одежды > нагрудные платки', 'asusteet > nenä- ja taskuliinat', 'odevné doplnky > vreckovky a vreckovky do saka', 'accesorii pentru îmbrăcăminte > batiste de buzunar', 'αξεσουάρ ρούχων > μαντήλια και ποσέτ', 'ruházati kiegészítők > zsebkendők és díszzsebkendők', 'إكسسوارات الملابس > مناديل البدل', '服装配饰 > 手帕'],
  '5114': ['clothing accessories > decorative fans', 'bekleidungsaccessoires > fächer', 'accessoires d\'habillement > éventails décoratifs', 'kledingaccessoires > decoratieve waaiers', 'tilbehør til tøj > vifter', 'complementos > abanicos decorativos', 'accessori di abbigliamento > ventagli decorativi', 'klädesaccessoarer > solfjädrar', 'klestilbehør > dekorative vifter', 'akcesoria do ubrań > wachlarze dekoracyjne', 'acessórios para roupas > leques decorativos', 'oděvní doplňky > ozdobné vějíře', 'ファッション小物 > 扇子', 'kıyafet aksesuarları > dekoratif yelpazeler', 'принадлежности для одежды > декоративные веера', 'asusteet > koristeviuhkat', 'odevné doplnky > ozdobné ventilátory', 'accesorii pentru îmbrăcăminte > ventilatoare decorative', 'αξεσουάρ ρούχων > διακοσμητικές βεντάλιες', 'ruházati kiegészítők > legyezők', 'إكسسوارات الملابس > مراوح مزينة', '服装配饰 > 装饰扇'],
};
const GPC_IDS = {
  '166': '166,167,168,169,170,171,173,175,176,177,178,179,180,181,182,184,187,188,189,190,191,192,193,194,196,197,200,201,203,204,206,207,208,209,211,212,213,214,215,1483,1516,1578,1580,1581,1594,1604,1662,1675,1772,1786,1807,1831,1856,1893,1922,1933,1948,2020,2160,2271,2292,2302,2306,2331,2396,2427,2477,2562,2563,2580,2668,2745,2963,3032,3066,3128,3188,3191,3253,3379,3414,3439,3455,3598,3683,3724,3729,3852,3888,3913,3951,3958,4003,4057,4179,5114,5122,5123,5182,5183,5192,5193,5194,5207,5250,5322,5327,5329,5330,5343,5344,5378,5379,5385,5387,5388,5390,5408,5409,5410,5411,5412,5422,5423,5424,5425,5426,5441,5443,5446,5460,5461,5462,5463,5483,5484,5490,5506,5513,5514,5517,5549,5552,5555,5564,5567,5598,5621,5622,5623,5624,5625,5626,5673,5674,5676,5677,5678,5679,5680,5681,5682,5683,5684,5685,5686,5687,5688,5697,5713,5834,5841,5878,5907,5909,5914,5915,5939,5941,5942,5949,6006,6031,6087,6169,6170,6183,6227,6228,6229,6238,6268,6277,6460,6463,6551,6552,6870,6984,6985,7003,7054,7078,7132,7133,7207,7208,7209,7210,7211,7230,7235,7236,7237,7281,7304,7305,7306,7307,7313,7471,8017,8018,8149,8200,8248,8451,499972,499979,500008,500118,502987,502988,543586,543587,543644,543645,543646,543673,543674',
  '1604': '182,203,204,206,207,208,209,211,212,213,214,215,1516,1578,1580,1581,1594,1604,1675,1772,1807,1831,2160,2271,2292,2302,2306,2331,2396,2562,2563,2580,2745,2963,3066,3128,3188,3191,3253,3379,3414,3439,3455,3598,3683,3724,3729,3852,3888,3951,3958,4003,5182,5183,5250,5322,5327,5329,5330,5343,5344,5378,5379,5388,5408,5409,5410,5411,5412,5423,5424,5425,5441,5460,5461,5462,5463,5483,5484,5490,5506,5513,5514,5517,5549,5552,5555,5564,5598,5621,5622,5673,5674,5676,5677,5678,5679,5680,5681,5682,5683,5684,5697,5713,5834,5878,5909,5949,6006,6031,6087,6227,6228,6229,7003,7132,7207,7208,7209,7210,7211,7235,7236,7237,7281,7313,8149,8248,499979',
  '187': '187',
  '193': '193',
  '4179': '4179',
  '180': '180',
  '1893': '1893',
  '5385': '5385',
  '1856': '1856',
  '2427': '2427',
  '5123': '5123',
  '175': '175',
  '5841': '5841',
  '6277': '6277',
  '6460': '6460',
  '6170': '6170',
  '6870': '6870',
  '7471': '7471',
  '5207': '5207',
  '5114': '5114',
};
const GPC_ROOTS = ['animals & pet supplies', 'apparel & accessories', 'arts & entertainment', 'baby & toddler', 'business & industrial', 'cameras & optics', 'electronics', 'food, beverages & tobacco', 'furniture', 'hardware', 'health & beauty', 'home & garden', 'luggage & bags', 'mature', 'media', 'office supplies', 'religious & ceremonial', 'software', 'sporting goods', 'toys & games', 'vehicles & parts', 'clothing & accessories', 'baby & kleinkind', 'bekleidung & accessoires', 'bürobedarf', 'elektronik', 'fahrzeuge & teile', 'für erwachsene', 'gesundheit & schönheit', 'heim & garten', 'heimwerkerbedarf', 'kameras & optik', 'kunst & unterhaltung', 'medien', 'möbel', 'nahrungsmittel, getränke & tabak', 'religion & feierlichkeiten', 'spielzeuge & spiele', 'sportartikel', 'taschen & gepäck', 'tiere & tierbedarf', 'wirtschaft & industrie', 'adulte', 'alimentation, boissons et tabac', 'animaux et articles pour animaux de compagnie', 'appareils photo, caméras et instruments d\'optique', 'appareils électroniques', 'arts et loisirs', 'bagages et maroquinerie', 'bébés et tout-petits', 'entreprise et industrie', 'fournitures de bureau', 'jeux et jouets', 'logiciels', 'maison et jardin', 'meubles', 'médias', 'offices religieux et cérémonies', 'quincaillerie', 'santé et beauté', 'véhicules et accessoires', 'vêtements et accessoires', 'équipements sportifs', 'baby en peuter', 'bagage en tassen', 'bouwmaterialen', 'camera\'s en optiek', 'dieren', 'elektronica', 'eten, drinken en tabak', 'gezondheid en persoonlijke verzorging', 'huis en tuin', 'kantoorartikelen', 'kleding en accessoires', 'kunst en entertainment', 'meubelen', 'religieus en ceremonieel', 'speelgoed en spellen', 'sportartikelen', 'voertuigen en onderdelen', 'volwassenen', 'zakelijk en industrieel', 'baby og småbørn', 'dyr og tilbehør til kæledyr', 'erhverv og industri', 'fødevarer, drikkevarer og tobak', 'hjem og have', 'isenkram', 'kameraer og optik', 'kontorforsyning', 'kufferter og tasker', 'kunst og underholdning', 'køretøjer og dele', 'legetøj og spil', 'medier', 'møbler', 'religiøst og ceremonielt', 'sportsartikler', 'sundhed og skønhed', 'tøj og tilbehør', 'voksne', 'alimentación, bebida y tabaco', 'arte y ocio', 'bebés y niños pequeños', 'bricolaje', 'casa y jardín', 'cámaras y ópticas', 'economía e industria', 'electrónica', 'elementos religiosos y ceremoniales', 'equipamiento deportivo', 'juegos y juguetes', 'maletas y bolsos de viaje', 'material de oficina', 'mobiliario', 'multimedia', 'productos para adultos', 'productos para mascotas y animales', 'ropa y accesorios', 'salud y belleza', 'vehículos y recambios', 'abbigliamento e accessori', 'arredamento', 'arte e svago', 'articoli di ferramenta', 'articoli per adulti', 'articoli per animali', 'articoli religiosi e per cerimonie', 'articoli sportivi', 'bagagli e borse', 'bebè e bimbi', 'casa e giardino', 'cibo, bevande e tabacco', 'commercio e industria', 'dispositivi elettronici', 'forniture per ufficio', 'fotocamere/dispositivi ottici', 'giochi e giocattoli', 'salute e bellezza', 'veicoli e parti', 'avsett för vuxna', 'bebis och småbarn', 'djur och tillbehör till husdjur', 'fordon och delar', 'företag och industri', 'hem och trädgård', 'kameror och optik', 'kläder och accessoarer', 'konst och underhållning', 'kontorsmaterial', 'leksaker och spel', 'mat, dryck och tobak', 'metallprodukter', 'möbler', 'programvara', 'religion och ceremonier', 'resväskor och väskor', 'skönhet och hälsa', 'sportartiklar', 'baby og småbarn', 'bagasje og vesker', 'dyr og kjæledyrutstyr', 'elektronikk', 'helse og skjønnhet', 'hjem og hage', 'jernvare', 'kameraer og optikk', 'kjøretøy og deler', 'klær og tilbehør', 'kontorrekvisita', 'leker og spill', 'mat, drikke og tobakk', 'næringsliv og industri', 'programvare', 'religiøst og seremonielt', 'sportsutstyr', 'aparaty, kamery i przyrządy optyczne', 'artykuły biurowe', 'artykuły dla dorosłych', 'artykuły religijne i dewocjonalia', 'biznes i przemysł', 'dom i ogród', 'dzieci i niemowlęta', 'elektronika', 'gry i zabawki', 'meble', 'oprogramowanie', 'pojazdy i części', 'sprzęt', 'sprzęt sportowy', 'sztuka i rozrywka', 'torby, walizki i akcesoria podróżne', 'ubrania i akcesoria', 'zdrowie i uroda', 'zwierzęta i artykuły dla zwierząt', 'żywność, napoje i tytoń', 'adultos', 'alimentos, bebidas e tabaco', 'animais e suprimentos para animais de estimação', 'artes e entretenimento', 'artigos esportivos', 'brinquedos e jogos', 'casa e jardim', 'comercial e industrial', 'câmeras e óptica', 'eletrônicos', 'ferragens', 'infantil', 'malas e bolsas', 'materiais de escritório', 'material para cerimônias e eventos religiosos', 'mídia', 'móveis', 'saúde e beleza', 'vestuário e acessórios', 'veículos e peças', 'chovatelství', 'děti a kojenci', 'dům a zahrada', 'foto, video a optika', 'hračky a hry', 'jídlo, pití a tabák', 'kancelářské potřeby', 'kutilství a řemeslo', 'média', 'náboženské a obřadní zboží', 'nábytek', 'obchod a průmysl', 'oblečení a doplňky', 'pro dospělé', 'sportovní potřeby', 'tašky a zavazadla', 'umění a zábava', 'vozidla a náhradní díly', 'zdraví a krása', 'diy用品', 'おもちゃ・ゲーム', 'オフィス用品', 'カメラ・光学機器', 'スポーツ用品', 'ソフトウェア', 'ビジネス・産業', 'ファッション・アクセサリー', 'ベビー用品', 'ペット・ペット用品', 'ホーム・ガーデン', 'メディア', '乗り物・パーツ', '冠婚葬祭・宗教', '家具', '成人向け', '旅行用かばん・バッグ', '美容・健康', '芸術・エンターテイメント', '電気製品', '食品・飲料', 'bavullar ve çantalar', 'bebek ve küçük çocuk ürünleri', 'büro malzemeleri', 'din ve törenler', 'ev ve bahçe', 'hayvanlar ve evcil hayvan ürünleri', 'hırdavat', 'kameralar ve optik malzemeler', 'kıyafet ve aksesuarlar', 'medya', 'mobilyalar', 'oyuncaklar ve oyunlar', 'sanat ve eğlence', 'sağlık ve güzellik', 'spor malzemeleri', 'taşıtlar ve parçalar', 'yazılım', 'yetişkinlere yönelik ürünler', 'yiyecek, i̇çecekler ve tütün mamülleri', 'i̇ş ve endüstri', 'багаж и сумки', 'бизнес и промышленность', 'дом и сад', 'животные и товары для питомцев', 'игры и игрушки', 'искусство и развлечения', 'камеры и оптика', 'канцелярские товары', 'красота и здоровье', 'мебель', 'оборудование и технические изделия', 'предметы одежды и принадлежности', 'программное обеспечение', 'продукты, напитки и табачные изделия', 'спортивные товары', 'средства информации', 'товары для взрослых', 'товары для новорожденных и маленьких детей', 'товары для церемоний и религиозных обрядов', 'транспортные средства и запчасти', 'электроника', 'aikuisille', 'ajoneuvot ja niiden osat', 'elektroniikka', 'elintarvikkeet, juomat ja tupakkatuotteet', 'eläin- ja lemmikkitarvikkeet', 'huonekalut', 'kamerat ja optiset laitteet', 'kauneus ja terveys', 'koti ja puutarha', 'lelut ja pelit', 'liiketoiminta ja teollisuus', 'matkalaukut ja kassit', 'medialaitteet', 'ohjelmistot', 'rakennustarvikkeet', 'taide ja viihde', 'toimistotarvikkeet', 'urheilutarvikkeet', 'uskonnolliset tuotteet ja seremoniatarvikkeet', 'vaatteet ja asusteet', 'vauvojen ja pikkulasten tuotteet', 'batožina a tašky', 'bábätká a batoľatá', 'dom a záhrada', 'fotoaparáty a optika', 'jedlo, nápoje a tabak', 'kancelárske potreby', 'médiá', 'náboženské a slávnostné potreby', 'nábytok', 'obchod a priemysel', 'oblečenie a doplnky', 'potreby pre zvieratá a domáce zvieratá', 'pre dospelých', 'softvér', 'technické vybavenie', 'umenie a zábava', 'vozidlá a diely', 'zdravie a krása', 'športové potreby', 'adulți', 'afaceri și industrie', 'alimente, băuturi și tutun', 'articole pentru sporturi', 'artă și divertisment', 'bagaje și genți', 'bebeluși și copii mici', 'camere foto și optică', 'casă și grădină', 'electronice', 'jucării și jocuri', 'mobilă', 'piese', 'produse generale pentru animale', 'produse pentru birou', 'religie și ceremonii', 'sănătate și frumusețe', 'vehicule și piese', 'îmbrăcăminte, încălțăminte și accesorii', 'έπιπλα', 'αθλητικά είδη', 'αποσκευές και τσάντες', 'βρέφη και νήπια', 'γραφική ύλη', 'είδη για ζώα και κατοικίδια', 'εξοπλισμός', 'επιχειρήσεις και βιομηχανίες', 'ηλεκτρονικά είδη', 'θρησκευτικά και τελετουργικά είδη', 'λογισμικό', 'οχήματα και ανταλλακτικά', 'παιχνίδια και δραστηριότητες', 'πολυμέσα', 'ρούχα και αξεσουάρ', 'σπίτι και κήπος', 'τέχνες και ψυχαγωγία', 'τρόφιμα, ποτά και είδη καπνού', 'υγεία και ομορφιά', 'φωτογραφικές μηχανές και φακοί', 'ωριμότητα', 'adathordozók', 'bútorok', 'bőröndök és táskák', 'csecsemők és kisgyermekek', 'egészség és szépségápolás', 'felnőtt', 'gépek és szerszámok', 'háziállatok és kellékeik', 'irodai kellékek', 'járművek és alkatrészek', 'játékszerek és játéktevékenységek', 'kamerák és optikai eszközök', 'művészet és szórakozás', 'otthon és kert', 'ruházat és kiegészítők', 'sportszerek', 'szoftver', 'vallás és szertartások', 'ételek, italok és dohányáru', 'üzleti és ipari termékek', 'أجهزة', 'ألعاب أطفال', 'أمتعة وحقائب', 'إلكترونيات', 'الأثاث', 'البرامج', 'الحديقة والمنزل', 'الرضيع والطفل', 'الصحة والجمال', 'الفن والترفيه', 'المأكولات والمشروبات والتبغ', 'المركبات وقطع الغيار', 'المستلزمات المكتبية', 'المناسبات الدينية والحفلات الشعائرية', 'تجاري وصناعي', 'كاميرات وأجهزة بصرية', 'للبالغين', 'مستلزمات الحيوانات والحيوانات الأليفة', 'مستلزمات رياضية', 'ملابس وإكسسوارات', 'وسائط', '五金/硬件', '交通工具/汽车/飞机/船舶', '体育用品', '保健/美容/卫生/护理', '办公用品', '动物/宠物用品', '商业/工业', '婴幼儿用品', '媒体', '宗教/仪式', '家居与园艺', '成人', '服饰与配饰', '玩具/游戏', '电子产品', '相机与光学器件', '箱包', '艺术与娱乐', '软件', '饮食/烟酒'];
// GPC-SCOPE:DATA-END
const GPC_OPT_GENDER = ['4179', '180', '1893', '5385', '1856', '2427', '5123', '175', '5841', '6277', '6460', '6170', '6870', '7471', '5207', '5114'];
export const GPC_SCOPE = {
  color:     { ids: ['166'], out: [], doc: 6324487, what: 'clothing & accessories' },
  gender:    { ids: ['166'], out: GPC_OPT_GENDER, doc: 6324479, what: 'clothing & accessories' },
  age_group: { ids: ['166'], out: GPC_OPT_GENDER.concat(['193']), doc: 6324463, what: 'clothing & accessories' },
  size:      { ids: ['1604', '187'], out: [], doc: 6324492, what: 'clothing & shoes' },
  material:  { ids: ['166'], out: [], doc: 7348545, what: 'clothing & accessories' },
  pattern:   { ids: ['166'], out: [], doc: 7348545, what: 'clothing & accessories' },
};
// mirrors norm() in tools/build_gpc_scope.py — the table is written in this exact form
export function gpcNorm(v) {
  const s = String(v == null ? '' : v).normalize('NFC').toLowerCase().replace(/^[^\p{L}\p{N}_]+/u, '');
  return s.split('>').map((p) => p.trim()).filter(Boolean).join(' > ');
}
let GPC_SETS = null;
function gpcSets() {
  if (GPC_SETS) return GPC_SETS;
  const ids = {};
  for (const k of Object.keys(GPC_IDS)) ids[k] = new Set(GPC_IDS[k].split(','));
  GPC_SETS = { ids, roots: new Set(GPC_ROOTS) };
  return GPC_SETS;
}
// one category value -> the named IDs it sits under ({} = a real category outside all of
// them), or null when the value cannot be read (blank / no locale knows its top level)
export function gpcClass(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const S = gpcSets(), hit = {};
  if (/^\d+$/.test(s)) {
    for (const k of Object.keys(S.ids)) if (S.ids[k].has(s)) hit[k] = 1;
    return hit;
  }
  const v = gpcNorm(s);
  if (!v) return null;
  const top = v.split(' > ')[0];
  if (GPC_ROOT.indexOf(top) >= 0) {
    hit['166'] = 1;
    const rest = v.slice(top.length + 3);
    if (rest) for (const k of Object.keys(GPC_TAILS)) {
      for (const t of GPC_TAILS[k]) if (rest === t || rest.startsWith(t + ' > ')) { hit[k] = 1; break; }
    }
    return hit;
  }
  return S.roots.has(top) ? hit : null;
}
export function gpcInScope(key, cls) {
  const r = GPC_SCOPE[key];
  if (!r || cls == null) return true;
  return r.ids.some((i) => cls[i]) && !r.out.some((i) => cls[i]);
}
// a per-row counter: feed it (gpc value, row) pairs, read {key: {n, f, u}} back
export function gpcScopeCounter(attrColsRef) {
  const cache = new Map(), sc = {};
  for (const k of Object.keys(GPC_SCOPE)) sc[k] = { n: 0, f: 0, u: 0 };
  return {
    add(r) {
      const cols = attrColsRef();
      const gi = cols.google_product_category;
      const gv = gi != null && gi >= 0 ? String(r[gi] == null ? '' : r[gi]) : '';
      let cls = cache.get(gv);
      if (cls === undefined) { cls = gpcClass(gv); if (cache.size < 20000) cache.set(gv, cls); }
      for (const k of Object.keys(GPC_SCOPE)) {
        if (!gpcInScope(k, cls)) continue;
        const c = sc[k];
        c.n++;
        if (cls == null) c.u++;
        const ci = cols[k];
        if (ci != null && ci >= 0 && String(r[ci] == null ? '' : r[ci]).trim() !== '') c.f++;
      }
    },
    counts: () => sc,
  };
}
// attrs[k].cov becomes the coverage OVER THE PRODUCTS IT APPLIES TO; the whole-catalogue
// reading stays on .all, the basis on .scope {n in scope, f filled in scope, u of them with
// no readable category, t products in the feed}, and .na marks an attribute no product in
// this feed calls for
export function applyGpcScope(attrs, sc, rows) {
  if (!attrs || !sc) return attrs;
  for (const key of Object.keys(GPC_SCOPE)) {
    const c = sc[key];
    if (!c) continue;
    const a = attrs[key] || (attrs[key] = { present: false });
    const n = Math.max(0, Math.round(+c.n || 0)), f = Math.min(n, Math.max(0, Math.round(+c.f || 0)));
    a.scope = { n, f, u: Math.min(n, Math.max(0, Math.round(+c.u || 0))), t: Math.max(n, Math.round(+rows || 0)) };
    if (a.present && n) { a.all = a.cov; a.cov = Math.min(100, Math.round((f / n) * 1000) / 10); }
    if (!n) a.na = true;
  }
  return attrs;
}
// what the estate index keeps per attribute: the scored coverage (null = absent OR not
// applicable) + the in-scope product count, so the page can re-score and the Playbook
// never lists an attribute no product in the feed calls for
export function scopeShare(a) {
  const c = a && a.scope;
  return c && c.t ? Math.min(1, c.n / c.t) : 1;
}
export function goldenCovIndex(attrs) {
  const cov = {}, sc = {};
  for (const s of ATTR_SPEC) {
    const a = (attrs || {})[s.key];
    cov[s.key] = a && a.present && !a.na ? a.cov : null;
    if (a && a.scope) sc[s.key] = a.scope.n;
  }
  return { cov, sc };
}

/* ---- XML snapshot collector — the ONE implementation of "stream a FeedHero XML feed
   into a scanFeed-shape raw snapshot", shared by the 4x-daily xml-scan agent
   (tools/xml_scan.mjs) and the guard pages' in-browser manual live rescan (Ray, 10 Sep
   2026: the per-feed scan button must work on XML feeds too, not only the 4x-daily run).
   Rows are aggregated INSIDE the parser callback — counts + value maps only, so a 125MB
   feed costs MBs — and the finish() assembly replicates scanFeed's countsRow/posOf/attrPos
   algorithm exactly. Alongside the snapshot it captures the /volume module's SKU id set
   ("id|category" lines, category = first chevron level of the primary product_type). */
export const VOLCAP = 40000;   // id-set cap — beyond it the capture is TRUNCATED (volume records rows only)
// NEW-PRODUCT ARRIVALS (Ray, 15 Sep 2026): c:fs_date_of_birth is FeedHero's stamp of the day a
// product ID first appeared in the feed. The collector histograms it per month (YYYY-MM) for
// every Google Shopping feed — SURVIVORS ONLY (products still in the feed today), so recent months
// are complete and older ones lower bounds. Same parsing rules as docs/arrivals_engine.js's
// dobMonth (tools/test_arrivals.mjs pins the two agree). Shopping feeds only (Ray: "just use
// Shopping feed") — a -fb market captures nothing.
export const DOB_KEY = 'fs_date_of_birth';
export function xmlCollector(meta) {
  const wantPT = !/-fb$/.test(String((meta && meta.market) || ''));
  const keys = wantPT ? LABEL_KEYS.concat(PT_KEYS) : LABEL_KEYS;
  let header = null, cols = null, attrCols = null, ptCol = -1, rows = 0;
  const vids = []; let volTrunc = false;
  let dobCol = -1; const dob = { n: 0, bad: 0, m: {}, min: null, max: null };
  const filled = {}, maps = {};          // per key: filled count + value->n map
  let attrFilled = null;                 // per attr key: filled count
  const gsc = gpcScopeCounter(() => attrCols);   // the category scope, counted per product
  // population (Ray, 18 Sep 2026): how many custom labels a SKU carries, and how many
  // product_type VALUES (the tree + every keyword slot) — histograms of count -> SKUs
  let ptSlots = [];
  const lblHist = {}, ptHist = {};
  const resolveCols = () => {
    cols = findCols(header, keys);
    // -fb feeds don't carry PT in `keys` — resolve the category column separately
    ptCol = wantPT ? cols.labels.product_type : findCols(header, PT_KEYS).labels.product_type;
    ptSlots = wantPT ? slotCols(header, 'product_type') : [];
    dobCol = wantPT ? findCols(header, [DOB_KEY]).labels[DOB_KEY] : -1;
    for (const k of keys) if (cols.labels[k] >= 0 && !maps[k]) { filled[k] = 0; maps[k] = new Map(); }
    if (wantPT) {
      attrCols = findAttrCols(header);
      attrFilled = attrFilled || {};
      for (const s of ATTR_SPEC) if (attrCols[s.key] != null && attrCols[s.key] >= 0 && attrFilled[s.key] == null) attrFilled[s.key] = 0;
    }
  };
  const onRow = (r, liveHeader) => {
    if (!header) {
      header = r;
      resolveCols();
      return;
    }
    // the parser GREW its header mid-stream (a sparse tag debuted past the sample —
    // e.g. Monsoon GB's custom_label_1, on 458 of 8,898 items, first appears at item
    // #52): adopt the live header and re-resolve every column. Rows before a column's
    // debut were empty for it by definition, so the running counts stay exact.
    if (liveHeader && liveHeader.length !== header.length) {
      header = liveHeader.slice();
      resolveCols();
    }
    const idv = String(r[cols.id] == null ? '' : r[cols.id]).trim();
    if (idv !== '') {
      rows++;
      // population: one SKU, one bucket each — labels carried, product_type values carried
      let ln = 0;
      for (const k of LABEL_KEYS) { const ci = cols.labels[k]; if (ci >= 0 && String(r[ci] == null ? '' : r[ci]).trim() !== '') ln++; }
      lblHist[ln] = (lblHist[ln] || 0) + 1;
      if (wantPT) {
        let pn = 0;
        for (const ci of ptSlots) if (String(r[ci] == null ? '' : r[ci]).trim() !== '') pn++;
        ptHist[pn] = (ptHist[pn] || 0) + 1;
      }
      if (attrFilled) gsc.add(r);
      if (vids.length < VOLCAP) {
        const pv = ptCol >= 0 ? String(r[ptCol] == null ? '' : r[ptCol]) : '';
        vids.push(idv.replace(/[|\n]/g, ' ') + '|' + pv.split('>')[0].trim().slice(0, 60));
      } else volTrunc = true;
      if (dobCol >= 0) {
        const s = String(r[dobCol] == null ? '' : r[dobCol]).trim();
        if (s) {
          const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(s), y = mm ? +mm[1] : 0, mo = mm ? +mm[2] : 0, da = mm ? +mm[3] : 0;
          if (mm && y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
            dob.n++; const k = mm[1] + '-' + mm[2]; dob.m[k] = (dob.m[k] || 0) + 1;
            const d = s.slice(0, 10); if (dob.min == null || d < dob.min) dob.min = d; if (dob.max == null || d > dob.max) dob.max = d;
          } else dob.bad++;
        }
      }
    }
    for (const k of keys) {
      const ci = cols.labels[k];
      if (ci < 0) continue;
      const v = String(r[ci] == null ? '' : r[ci]).trim();
      if (!v) continue;
      filled[k]++;
      maps[k].set(v, (maps[k].get(v) || 0) + 1);
    }
    if (attrFilled) for (const s of ATTR_SPEC) {
      const ci = attrCols[s.key];
      if (ci == null || ci < 0) continue;
      if (String(r[ci] == null ? '' : r[ci]).trim() !== '') attrFilled[s.key]++;
    }
  };
  const finish = () => {
    if (!header) throw new Error('fetch-fail: no <item> rows parsed');
    // assemble countsRow + attrPos exactly as scanFeed does (positions in query order)
    const countsRow = [String(rows)];
    const posOf = {}; posOf[cols.id] = 0;
    { let ci = 1; for (const k of keys) if (cols.labels[k] >= 0) { countsRow.push(String(filled[k])); posOf[cols.labels[k]] = ci; ci++; } }
    const attrPos = {};
    if (attrCols) for (const s of ATTR_SPEC) {
      const c = attrCols[s.key];
      if (c == null || c < 0) continue;
      if (posOf[c] != null) attrPos[s.key] = posOf[c];
      else { posOf[c] = countsRow.length; attrPos[s.key] = countsRow.length; countsRow.push(String(attrFilled[s.key] || 0)); }
    }
    const groupRowsByKey = {};
    for (const k of keys) {
      if (cols.labels[k] < 0) continue;
      groupRowsByKey[k] = [...maps[k].entries()].sort((a, b) => b[1] - a[1]).slice(0, TH.maxValues)
        .map(([v, n]) => [v, String(n)]);
    }
    const snap = snapshotFromParts({ client: meta.client, market: meta.market, fetchedAt: Date.now() }, cols, countsRow, groupRowsByKey, keys);
    if (attrCols) snap.attrs = applyGpcScope(attrsFromCounts(attrCols, attrPos, countsRow, snap.rows), gsc.counts(), snap.rows);
    // per-SKU population — only a full read can say it, so only this lane carries it (the
    // gviz lane counts columns, never rows; a sheet-backed feed's card says so)
    snap.labelPop = popProfile(lblHist);
    if (wantPT) snap.ptPop = popProfile(ptHist);
    return { snap, vol: { ids: vids.join('\n'), trunc: volTrunc, dob: dobCol >= 0 ? dob : null } };
  };
  return { onRow, finish };
}

/* ---- industry scoring profiles (Ray, Aug 2026): certain attributes are incorporated
   into the score per brand / per industry — that profile IS the industry best practice.
   `expected` attrs count toward the score even when absent from the feed (an apparel
   brand without g:color is incomplete, not exempt); `waived` attrs are excluded from
   the score entirely (size systems on a pet-supplement feed are noise, not a gap).
   The always-required seven and the gtin/mpn identifier pair can never be profiled —
   Google requires them everywhere. Defaults below mirror Google's own spec conditions;
   per-industry and per-brand overrides live in KV `goldenprofiles`. */
export const INDUSTRY = { 'Reiss': 'Fashion', 'Superdry': 'Fashion', 'Monsoon': 'Fashion',
  'Accessorize': 'Fashion', 'House of Bruar': 'Fashion', 'Visual K': 'Fashion',
  'Schuh': 'Footwear', 'YuMOVE': 'Pet Care', 'American Golf': 'Sporting Goods',
  'Hobbycraft': 'Arts & Crafts', 'Ryobi': 'Tools & DIY',
  'Estée Lauder': 'Beauty', 'Bobbi Brown': 'Beauty', 'Benefit': 'Beauty', 'Clinique': 'Beauty', 'MAC': 'Beauty', 'Jo Malone': 'Beauty' };
export const INDUSTRY_PROFILES = {
  // the apparel five — exactly Google's apparel-market conditions — score even when absent
  'Fashion':        { expected: ['color', 'size', 'gender', 'age_group', 'item_group_id'], waived: [] },
  'Footwear':       { expected: ['color', 'size', 'gender', 'age_group', 'item_group_id'], waived: [] },
  'Beauty':         { expected: ['color', 'item_group_id'], waived: ['size_type', 'size_system'] },
  'Pet Care':       { expected: [], waived: ['size_type', 'size_system', 'pattern'] },
  'Sporting Goods': { expected: ['item_group_id'], waived: [] },
  'Arts & Crafts':  { expected: [], waived: ['size_type', 'size_system'] },
  'Tools & DIY':    { expected: [], waived: ['size_type', 'size_system', 'pattern'] },
};
export function industryOf(client) { return INDUSTRY[client] || 'Retail'; }
// merged profile for one brand: industry defaults <- KV industry override <- KV brand
// override. `overrides` = the KV `goldenprofiles` value { industries: {..}, clients: {..} }.
export function profileFor(client, overrides) {
  const ind = industryOf(client);
  const o = overrides || {};
  const base = ((o.industries || {})[ind]) || INDUSTRY_PROFILES[ind] || { expected: [], waived: [] };
  const cl = (o.clients || {})[client];
  const pick = (src, k) => Array.isArray(src && src[k]) ? src[k] : null;
  const expected = pick(cl, 'expected') || pick(base, 'expected') || [];
  const waived = pick(cl, 'waived') || pick(base, 'waived') || [];
  const ok = (k) => ATTR_SPEC.some((s) => s.key === k && s.req !== 'required' && k !== 'gtin' && k !== 'mpn');
  // CONTENT-QUALITY RULES SET ASIDE FOR THIS BRAND (Ray, 21 Sep 2026: "for each problem …
  // allow a button to indicate whether the issue actually applies for the brand … Reiss,
  // brand not in title — remove the issue and have the overall score reanalyzed"): a list of
  // '<attr>:<ruleId>' tokens, brand-level and industry-level UNIONED (a brand can add to what
  // its industry set aside, never un-set it), each validated against QSPEC so a token that
  // names no rule can never reach the score. Distinct from `waived`, which drops a whole
  // attribute: this keeps the attribute in the score and drops ONE of its rules.
  const qw = [].concat(pick(base, 'qwaived') || [], pick(cl, 'qwaived') || []).map(String);
  const qwaived = qw.filter((t, i) => qw.indexOf(t) === i && qruleKnown(t));
  return { industry: ind, expected: expected.filter(ok), waived: waived.filter((k) => ok(k) && expected.indexOf(k) < 0), qwaived };
}
// '<attr>:<ruleId>' names a rule the spec actually states
export function qruleKnown(token) {
  const i = String(token).indexOf(':');
  if (i <= 0) return false;
  const q = qspecOf(String(token).slice(0, i));
  return !!q && q.rules.some((r) => r.id === String(token).slice(i + 1));
}
// the rule ids set aside for one attribute, from a profile's qwaived tokens
export function qwaivedFor(profile, key) {
  return ((profile && profile.qwaived) || []).filter((t) => String(t).indexOf(key + ':') === 0).map((t) => String(t).slice(key.length + 1));
}

// The Golden Record score — one weighted completeness number per feed, transparent parts.
// required: weight 3, a missing column counts as 0%. gtin+mpn merge into ONE identifier
// component (weight 2, best of the two — the spec accepts either; both absent = 0).
// Other cond attrs: present → weight 2; absent → excluded from the score (a pet-supplement
// feed without `color` is not incomplete) but surfaced as a flag on the page.
// rec: weight 1, absent counts as 0 — that IS the optimisation surface.
// With a profile (profileFor): `expected` attrs count-when-absent at their tier weight
// (ai joins at weight 1 only when expected), `waived` attrs drop out of the score.
// An expected REC attr also weighs 2 like the required-in-cases tier — rec attrs are
// always scored, so without the weight lift starring one would not move the number
// (Ray, 16 Sep 2026: profiling sale_price "doesn't actually do anything").
export function goldenScore(attrs, profile) {
  if (!attrs) return null;
  const exp = new Set((profile && profile.expected) || []);
  const wav = new Set((profile && profile.waived) || []);
  const parts = [];
  let idBest = null;
  for (const s of ATTR_SPEC) {
    const a = attrs[s.key] || { present: false };
    if (s.key === 'gtin' || s.key === 'mpn') {
      if (a.present && (idBest == null || a.cov > idBest)) idBest = a.cov;
      continue;
    }
    // no product in this feed sits in a category Google asks this attribute of (GPC scope)
    if (a.na) continue;
    if (s.req !== 'required' && wav.has(s.key)) continue;
    const bp = exp.has(s.key);
    // a category-scoped attribute weighs by the SHARE of the catalogue it applies to: a
    // requirement that covers 2 products of 24,000 cannot move the score like one that
    // covers all of them (an apparel feed has a share of ~1, so nothing changes there)
    const sh = scopeShare(a);
    if (s.req === 'ai') {
      // the conversational six stay out of the score unless a profile pulls one in
      if (bp) parts.push({ key: s.key, tier: s.req, cov: a.present ? a.cov : 0, w: 1, missing: !a.present, bp: true });
      continue;
    }
    if (s.req === 'required') parts.push({ key: s.key, tier: s.req, cov: a.present ? a.cov : 0, w: 3, missing: !a.present });
    else if (s.req === 'cond') {
      if (a.present) parts.push({ key: s.key, tier: s.req, cov: a.cov, w: 2 * sh, missing: false, bp: bp || undefined, share: a.scope ? sh : undefined });
      // absent: scored at 0 when the profile expects it OR the feed carries products in the
      // category Google requires it for (a known requirement is a gap, not an exemption)
      else if (bp || (a.scope && a.scope.n > 0)) parts.push({ key: s.key, tier: s.req, cov: 0, w: 2 * sh, missing: true, bp: bp || undefined, share: a.scope ? sh : undefined });
    }
    else parts.push({ key: s.key, tier: s.req, cov: a.present ? a.cov : 0, w: (bp ? 2 : 1) * sh, missing: !a.present, bp: bp || undefined, share: a.scope ? sh : undefined });
  }
  parts.push({ key: 'gtin/mpn', tier: 'cond', cov: idBest == null ? 0 : idBest, w: 2, missing: idBest == null });
  let ws = 0, sum = 0;
  for (const p of parts) { ws += p.w; sum += p.w * p.cov; }
  const score = ws ? Math.round((sum / ws) * 10) / 10 : 0;
  const reqMissing = ATTR_SPEC.filter((s) => s.req === 'required' && !(attrs[s.key] || {}).present).map((s) => s.key);
  const gone = (s) => !(attrs[s.key] || {}).present && !(attrs[s.key] || {}).na;
  const condMissing = ATTR_SPEC.filter((s) => s.req === 'cond' && gone(s)).map((s) => s.key);
  const recMissing = ATTR_SPEC.filter((s) => s.req === 'rec' && gone(s)).map((s) => s.key);
  const aiSpec = ATTR_SPEC.filter((s) => s.req === 'ai');
  const aiMissing = aiSpec.filter((s) => !(attrs[s.key] || {}).present).map((s) => s.key);
  const ai = { n: aiSpec.length - aiMissing.length, of: aiSpec.length, missing: aiMissing };
  return { score, parts, reqMissing, condMissing, recMissing, ai,
    profile: profile ? { industry: profile.industry || null, expected: (profile.expected || []).slice(), waived: (profile.waived || []).slice() } : null };
}

// coverage drop-off -> alerts, same shape as diffSnapshots so the shared mail rails
// (estateMailPlan / alertKey) work unchanged. required + cond tiers can go critical
// (products disapprove); recommended never crits — it can't take a product down.
export const ATTR_TH = { reqWarn: 3, reqCrit: 10, recWarn: 10 };
export function diffCoverage(base, cur, th) {
  th = th || ATTR_TH;
  const A = [];
  if (!base || !cur || !base.attrs || !cur.attrs) return A;
  for (const s of ATTR_SPEC) {
    const b = base.attrs[s.key] || { present: false };
    const c = cur.attrs[s.key] || { present: false };
    const disp = s.key;
    const soft = s.req === 'rec' || s.req === 'ai';   // recommended + conversational AI never crit
    // no product in this feed sits in a category Google asks this attribute of: nothing it
    // does can take a product down (GPC scope)
    if (c.na) continue;
    if (b.present && !c.present) {
      A.push({ sev: soft ? 'warn' : 'crit', code: 'attr-gone', label: s.key,
        msg: disp + ' column VANISHED from the feed — was ' + b.cov + '% filled', was: b.cov, now: 0 });
      continue;
    }
    if (!b.present && c.present) {
      A.push({ sev: 'info', code: 'attr-new', label: s.key, msg: disp + ' column appeared — ' + c.cov + '% filled', now: c.cov });
      continue;
    }
    if (!b.present || !c.present) continue;
    // a reading over the in-scope products and one over the whole catalogue are two different
    // numbers — the first scan after the scope shipped (or a lane without it) is not a drop
    if (b.na || !!b.scope !== !!c.scope) continue;
    const d = Math.round((b.cov - c.cov) * 10) / 10;
    if (d <= 0) continue;
    if (soft) {
      if (d >= th.recWarn) A.push({ sev: 'warn', code: 'attr-drop', label: s.key,
        msg: disp + ' coverage dropped ' + d + 'pp (was ' + b.cov + '%, now ' + c.cov + '%)', was: b.cov, now: c.cov });
    } else if (d >= th.reqCrit) {
      A.push({ sev: 'crit', code: 'attr-drop', label: s.key,
        msg: disp + ' coverage dropped ' + d + 'pp (was ' + b.cov + '%, now ' + c.cov + '%) — ' +
          (s.req === 'required' ? 'REQUIRED attribute: products will disapprove' : 'required in specific cases'), was: b.cov, now: c.cov });
    } else if (d >= th.reqWarn) {
      A.push({ sev: 'warn', code: 'attr-drop', label: s.key,
        msg: disp + ' coverage dropped ' + d + 'pp (was ' + b.cov + '%, now ' + c.cov + '%)', was: b.cov, now: c.cov });
    }
  }
  return A;
}
export function goldenAlertEmail(feedName, alerts, link) {
  return '🔴 Golden Record — ' + feedName + ': ' + alerts.length + ' confirmed attribute alert' + (alerts.length === 1 ? '' : 's') + '\n' +
    'Seen on two consecutive scans vs last known-good — attribute coverage per Google’s product data specification.\n' +
    alerts.map((a) => '• [' + String(a.sev).toUpperCase() + '] ' + a.msg).join('\n') +
    '\nIntentional change? Open /golden and hit "Expected — accept as known-good".' +
    (link ? '\n' + link : '');
}
export function goldenRecoveryEmail(feedName, link) {
  return '✅ Golden Record — ' + feedName + ' recovered\nEvery flagged attribute-coverage alert has cleared vs last known-good.' + (link ? '\n' + link : '');
}

/* ---- GOLDEN SCORE HISTORY (Ray, 24 Sep 2026: "Can the Golden Score module record historic
   changes in terms of improvement or deduction from the previous scan … good to show clients on
   improvement progress. At the same time, maybe also track it on a day-to-day basis, similar to
   [product] volumes").

   Before this the module kept three snapshots and no past at all: the latest, yesterday's and the
   last known-good. KV goldenhist:<client>:<mkt> is the feed's record over time:
     r  READINGS — what the score is computed FROM, never the score itself ({t, rows, cov, sc?},
        the goldenidx shape). The page re-scores every reading against the brand's CURRENT
        profile, so a change in what FeedSpark counts (an industry profile edit, a rule set aside)
        re-bases the whole line instead of reading as the feed getting better or worse.
        A reading is only recorded when the feed MOVED since the last recorded one — an attribute
        appearing / vanishing / going out of scope, or its coverage moving HIST_MOVE_PP — so four
        identical scans a day cost nothing and the log is a list of real changes. Drift below the
        threshold accumulates against the last RECORDED reading, so a slow slide is still caught.
        The last HIST_RECENT_DAYS keep every change scan by scan; older days keep their close.
     s  SCAN DAYS — the UTC days the feed was read at all. A day with no scan is a GAP on the
        chart, never a copy of the day before: a feed that stopped being read must not look flat.
     q  CONTENT QUALITY + AI-READINESS as ANALYSED ({t, q, air, tier}) — measured by the page's
        in-browser analysis, not the scan, recorded when either moves.
   No backfill beyond what the stores already hold: a fresh record is seeded from the known-good
   and the previous scan when they were measured on the same basis as today's reading (a
   snapshot from before GPC category scope is a different measurement, not a past score). */
export const HIST_MOVE_PP = 0.5;       // an attribute moving this far (pp) makes a new reading
export const HIST_RECENT_DAYS = 30;    // readings inside this window are kept scan by scan
export const HIST_MAX = 500;           // stored readings (≈ a year of daily closes + a month of scans)
export const HIST_DAYS_MAX = 400;      // scan-day calendar
export const HIST_QA_MAX = 200;        // content-quality / AI-readiness analyses
export function histDay(t) { return new Date(+t).toISOString().slice(0, 10); }
export function histReading(snap) {
  if (!snap || !snap.attrs) return null;
  const { cov, sc } = goldenCovIndex(snap.attrs);
  const c = {};
  for (const k of Object.keys(cov)) if (cov[k] != null && isFinite(cov[k])) c[k] = Math.round(cov[k] * 10) / 10;
  const r = { t: +snap.t || Date.now(), rows: Math.max(0, Math.round(+snap.rows || 0)), cov: c };
  if (Object.keys(sc).length) r.sc = sc;
  return r;
}
// what moved between two readings, biggest first: [key, from, to] — null = not in the feed,
// 'na' = in the feed's categories nobody asks for it. An attribute that appeared or vanished
// outranks any coverage move.
export function histMoved(a, b) {
  const out = [];
  if (!a || !b) return out;
  const st = (x, k) => (x.sc && x.sc[k] === 0 ? 'na' : (x.cov && x.cov[k] != null ? x.cov[k] : null));
  const keys = {};
  [a, b].forEach((x) => { Object.keys(x.cov || {}).forEach((k) => { keys[k] = 1; }); Object.keys(x.sc || {}).forEach((k) => { keys[k] = 1; }); });
  for (const k of Object.keys(keys)) {
    const x = st(a, k), y = st(b, k);
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number' && Math.abs(y - x) < 0.05) continue;
    out.push([k, x, y]);
  }
  const mag = (m) => (typeof m[1] === 'number' && typeof m[2] === 'number' ? Math.abs(m[2] - m[1]) : 1000);
  return out.sort((m, n) => mag(n) - mag(m) || (m[0] < n[0] ? -1 : 1));
}
// did the feed MOVE: a presence / scope flip, a coverage move of HIST_MOVE_PP, or a change of
// measuring basis (with vs without GPC scope — recorded so the page can refuse to compare it)
export function histChanged(a, b, pp) {
  if (!a) return true;
  if (!!a.sc !== !!b.sc) return true;
  const lim = pp == null ? HIST_MOVE_PP : pp;
  return histMoved(a, b).some((m) => typeof m[1] !== 'number' || typeof m[2] !== 'number' || Math.abs(m[2] - m[1]) >= lim);
}
export function histEmpty() { return { v: 1, r: [], s: [], q: [] }; }
// A DAY'S VALUE (Ray, 24 Sep 2026: "If there's a manual scan on any day, that new score can
// override that day"): the last MANUAL reading of the day when there is one, else the day's last
// reading. The same rule for the analyses. One function, so the store and the page can never
// pick a different reading for the same day.
export function histDayPick(list, day) {
  let last = -1, lastM = -1;
  for (let i = 0; i < list.length; i++) {
    if (histDay(list[i].t) !== day) continue;
    last = i;
    if (list[i].m) lastM = i;
  }
  return lastM >= 0 ? lastM : last;
}
function histThin(list, cut) {
  // older than the recent window, a day keeps only the reading that IS its value
  const keep = {};
  list.forEach((x) => { if (x.t < cut) { const d = histDay(x.t); if (!(d in keep)) keep[d] = histDayPick(list, d); } });
  return list.filter((x, i) => x.t >= cut || i === list.length - 1 || keep[histDay(x.t)] === i);
}
function histKeep(h, now) {
  const cut = now - HIST_RECENT_DAYS * 864e5;
  h.r = histThin(h.r, cut);
  h.q = histThin(h.q, cut);
  if (h.r.length > HIST_MAX) h.r.splice(0, h.r.length - HIST_MAX);
  if (h.s.length > HIST_DAYS_MAX) h.s.splice(0, h.s.length - HIST_DAYS_MAX);
  if (h.q.length > HIST_QA_MAX) h.q.splice(0, h.q.length - HIST_QA_MAX);
  return h;
}
// record one scan's reading → { hist, wrote } — wrote=false means nothing new (same day, no
// move), so the caller skips the KV write. opts.manual = a scan somebody ran by hand: it is
// recorded (and marked m) even when nothing moved, once per day, because it SETS its day
// (histDayPick) and a later automatic reading must not quietly replace it
export function histAdd(hist, r, opts) {
  const h = hist && hist.v === 1 ? { v: 1, r: (hist.r || []).slice(), s: (hist.s || []).slice(), q: (hist.q || []).slice() } : histEmpty();
  if (!r || !r.cov) return { hist: h, wrote: false };
  const last = h.r[h.r.length - 1];
  if (last && r.t <= last.t) return { hist: h, wrote: false };   // out of order — never rewrite the past
  const man = !!(opts && opts.manual);
  let wrote = false;
  const day = histDay(r.t);
  if (h.s[h.s.length - 1] !== day) { h.s.push(day); wrote = true; }
  const pinned = man && last && last.m && histDay(last.t) === day;
  if (histChanged(last, r) || (man && !pinned)) {
    const x = man ? Object.assign({}, r, { m: 1 }) : r;
    h.r.push(x); wrote = true;
  }
  return { hist: wrote ? histKeep(h, r.t) : h, wrote };
}
// a fresh record: the stored past readings that were measured the way today's is, oldest first,
// then today's — the known-good and the previous scan are real readings, not estimates
export function histSeed(past, cur, opts) {
  let h = histEmpty();
  (past || []).map(histReading)
    .filter((x) => x && cur && x.t < cur.t && !!x.sc === !!cur.sc)
    .sort((a, b) => a.t - b.t)
    .forEach((x) => { h = histAdd(h, x).hist; });
  return histAdd(h, cur, opts).hist;
}
// one content-quality / AI-readiness analysis → recorded when either figure moved
export function histQa(hist, p) {
  const h = hist && hist.v === 1 ? { v: 1, r: (hist.r || []).slice(), s: (hist.s || []).slice(), q: (hist.q || []).slice() } : histEmpty();
  if (!p || (p.q == null && p.air == null)) return { hist: h, wrote: false };
  const pt = { t: +p.t || Date.now() };
  if (p.q != null && isFinite(p.q)) pt.q = Math.round(p.q * 10) / 10;
  if (p.air != null && isFinite(p.air)) pt.air = Math.round(p.air * 10) / 10;
  if (p.tier != null) pt.tier = Math.max(1, Math.min(4, parseInt(p.tier, 10) || 1));
  if (p.m) pt.m = 1;                     // run by hand — it sets its day (histDayPick)
  const last = h.q[h.q.length - 1];
  if (last && pt.t <= last.t) return { hist: h, wrote: false };
  const same = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.1);
  const pinned = pt.m && last && last.m && histDay(last.t) === histDay(pt.t);
  if (last && same(last.q, pt.q) && same(last.air, pt.air) && (!pt.m || pinned)) return { hist: h, wrote: false };
  h.q.push(pt);
  return { hist: histKeep(h, pt.t), wrote: true };
}
// what the estate index carries so a row can say "▲ +1.8 since 21 Sep" without reading the
// record: the reading BEFORE the last change (hp) and when that change happened (ht)
/* ---- THE CONTENT-QUALITY STREAM, ONE IMPLEMENTATION (Ray, 24 Sep 2026: "Golden Record and
   content quality should automatically scan on a daily basis … at 9 a.m. UK time"). Until now
   the analysis lived only in /golden's qualityRun, so it happened when somebody clicked. The
   daily agent (tools/golden_daily.mjs) and the page now both feed the SAME object: the first
   row is the header, a column an XML feed grows mid-stream is named 'late' rather than scored
   partially, rows are sampled to audCap for the AI-Readiness audit, and the audit is packed to
   the shape the worker stores. FA is the Feed Lab engine (FeedAudit), handed in so this module
   never imports a browser file. */
export function packAudit(a) {
  if (!a || !a.score) return null;
  const s = a.score, t = a.titles || {}, mk = t.mask || {};
  return {
    total: Math.round(+s.total || 0), tier: +s.tier || 1, tierLabel: String(s.tierLabel || ''),
    sampled: +a.sampled || 0, rows: +a.rowCount || 0,
    pillars: (s.pillars || []).slice(0, 8).map((p) => ({ key: String(p.key || ''), label: String(p.label || ''),
      score: Math.round(+p.score || 0), weight: +p.weight || 1, summary: String(p.summary || '').slice(0, 160),
      reads: (p.reads || []).slice(0, 8).map((x) => String(x || '').slice(0, 140)) })),
    titles: { avg: +t.avg || 0, min: +t.min || 0, max: +t.max || 0, dup: +t.dup || 0, allCaps: +t.allCaps || 0,
      buckets: (t.buckets || []).slice(0, 6).map((b) => ({ b: String(b.b || ''), n: +b.n || 0 })),
      mask: { brand: Math.round(+mk.brand || 0), material: Math.round(+mk.material || 0), fit: Math.round(+mk.fit || 0),
        colour: Math.round(+mk.colour || 0), use: Math.round(+mk.use || 0) } },
  };
}
export function qualityStream(opts) {
  const o = opts || {};
  const cap = o.audCap || 30000;
  let col = null, cols = null, header = null, nRows = 0;
  const late = [], sample = [];
  return {
    onRow(r, liveHeader) {
      // the header goes in too: a repeatable attribute (product highlights) lives in several
      // columns, and the collector needs them all or it reads one value out of four
      if (!col) { header = r.slice(); cols = findAttrCols(header); col = qualityCollector(cols, { header }); return; }
      nRows++;
      if (sample.length < cap) sample.push(r);
      // an XML feed can GROW its header mid-stream when a sparse tag debuts late: every column
      // already resolved stays valid, but a free-text attribute that debuts after the first item
      // was never in the collector — record it and say so rather than scoring a partial column
      if (liveHeader && liveHeader.length !== header.length) {
        header = liveHeader.slice();
        const grown = findAttrCols(header);
        QSPEC.forEach((q) => { if (grown[q.key] >= 0 && !(cols[q.key] >= 0) && late.indexOf(q.key) < 0) late.push(q.key); });
      }
      col.onRow(r);
    },
    rows() { return nRows; },
    finish() {
      if (!col) throw new Error('the feed produced no rows');
      const snap = col.finish({ client: o.client, market: o.market, late: late.length ? late : undefined });
      if (!snap.rows) throw new Error('the feed produced no rows');
      // the SAME read, scored on the AI-Readiness ladder — one stream, two readings — under the
      // brand's industry profile, exactly as goldenScore reads it
      try {
        snap.ai = o.FA ? packAudit(o.FA.audit(header, sample, { client: o.client, rowTotalEstimate: nRows,
          channel: 'google', expected: o.expected || [], waived: o.waived || [] })) : null;
      } catch (e) { snap.ai = null; }
      return snap;
    },
  };
}
export function histIdx(h) {
  const r = (h && h.r) || [];
  if (r.length < 2) return {};
  const p = r[r.length - 2];
  const hp = { t: p.t, rows: p.rows, cov: p.cov };
  if (p.sc) hp.sc = p.sc;
  return { hp, ht: r[r.length - 1].t };
}

// The per-attribute client ask — same consultative voice as depthAskEmail: a proposal,
// not an alarm. cov = current fill % when the column exists, null when it's not in the feed.
export function attrAskEmail(client, mkt, spec, cov) {
  const loc = client + ' ' + String(mkt || '').toUpperCase();
  const disp = 'g:' + spec.key;
  const missing = cov == null;
  const tierLine = spec.req === 'required'
    ? 'a required attribute in Google’s product data specification — every product must carry it'
    : spec.req === 'cond'
      ? 'required by Google in specific cases (' + spec.note + ')'
      : spec.req === 'ai'
        ? 'one of the six conversational AI attributes Google reads for its AI and agentic shopping surfaces (' + spec.note + ')'
        : 'a recommended attribute in Google’s product data specification (' + spec.note + ')';
  const benefit = spec.req === 'required'
    ? 'Products missing it are at risk of disapproval, so closing the gap protects live coverage directly.'
    : spec.req === 'cond'
      ? 'Where the condition applies, items without it can be limited or disapproved — completing it protects eligibility and improves how precisely the campaigns can segment.'
      : spec.req === 'ai'
        ? 'These attributes feed Google’s conversational shopping experiences (AI Mode, agentic surfaces) — completing them early is a visibility advantage over competitors whose feeds stop at the classic spec.'
        : 'Filling it improves product matching and gives the Shopping campaigns more surface to segment and optimise against.';
  const subject = loc + ' — feed data: ' + (missing ? 'proposal to add ' + disp : 'proposal to lift ' + disp + ' coverage');
  const body = 'Hi team,\n\n'
    + 'A quick recommendation from our feed monitoring. '
    + (missing
      ? 'The ' + loc + ' feed does not currently carry ' + disp + '.'
      : 'In the ' + loc + ' feed, ' + disp + ' is filled on ' + cov + '% of products.')
    + ' It is ' + tierLine + '. ' + benefit + '\n\n'
    + (missing
      ? 'If the data exists in your PIM or product export, we can map and structure it into the feed from our side — happy to share the exact field format and a worked example for sign-off before anything changes in the live feed.'
      : 'We would propose a structured pass to close the gap — we can share the affected product set and the proposed values for sign-off before anything changes in the live feed.')
    + '\n\nBest regards,\nRay';
  return { subject, body };
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
      // value-level watch — the PMAX listing groups key on these exact strings.
      // Materiality: severity scales with what the campaign would feel. bigVal gates
      // crit; a partial drop needs minLost absolute SKUs gone, not just a big ratio.
      const floor = sigFloor(bRows);
      const big = bigVal(bRows), lostFloor = minLost(bRows);
      const cv = new Map((c.values || []));
      const bv = new Map((b.values || []));
      const twins = new Map();
      (c.values || []).forEach(([v2, n2]) => { const t = normVal(v2); if (!twins.has(t)) twins.set(t, [v2, n2]); });
      const renamed = new Set();   // normVal of rename TARGETS — kept out of the "new values" list
      for (const [v, n] of (b.values || [])) {
        if (n < floor) continue;
        const now = cv.get(v) || 0;
        if (now === 0) {
          // exact string gone, but a case/whitespace twin with a similar count exists and
          // wasn't already a distinct base value -> the feed regen renamed it, nothing lost
          const tw = twins.get(normVal(v));
          if (tw && !bv.has(tw[0]) && Math.abs(tw[1] - n) / n <= 0.4) {
            renamed.add(normVal(tw[0]));
            A.push({ sev: 'info', code: 'value-renamed', label: k, value: v,
              msg: CL + ' "' + v + '" -> "' + tw[0] + '" (' + n + ' -> ' + tw[1] + ' SKUs) — same value modulo case/whitespace; PMAX listing groups keyed on the OLD string still need the rename', was: n, now: tw[1] });
            continue;
          }
          if (c.truncated) {
            A.push({ sev: n >= big ? 'warn' : 'info', code: 'value-drop', label: k, value: v,
              msg: CL + ' "' + v + '" (was ' + n + ' SKUs) slipped below the guard’s tracking cut-off — this feed has more distinct values than the ' + th.maxValues + ' biggest ones the guard watches, so the value shrank sharply, was renamed, or left the feed. Open the dissection to check', was: n, now: 0 });
          } else {
            A.push({ sev: n >= big ? 'crit' : 'warn', code: 'value-gone', label: k, value: v,
              msg: CL + ' value "' + v + '" GONE - was on ' + n + ' SKUs', was: n, now: 0 });
          }
        } else if ((n - now) / n >= th.valDropWarn && (n - now) >= lostFloor) {
          A.push({ sev: 'warn', code: 'value-drop', label: k, value: v,
            msg: CL + ' "' + v + '" ' + n + ' -> ' + now + ' SKUs (-' + Math.round(((n - now) / n) * 100) + '%)', was: n, now });
        }
      }
      // new significant values — informational (someone shipped a new segmentation);
      // renamed twins are already reported above, keep them out of the "new" list
      const fresh = (c.values || []).filter(([v, n]) => !bv.has(v) && n >= sigFloor(cRows) && !renamed.has(normVal(v))).slice(0, 5);
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

/* ---------------- Content quality: how GOOD the free-text data is ----------------------
   Ray, 16 Sep 2026: "what's missing is also reviewing the data quality of each attribute,
   especially if they contain free content (title, description, product highlight, GPC,
   product type, material, pattern…) — each of these has its own standard of what good
   quality must look like (benchmark rating against Google's support page)."

   Golden Record answers "is the attribute THERE and how full is it". This answers "is what
   is in it any GOOD" — every rule below is a rule Google states on the attribute's own
   specification page, carried with the answer id so the page can cite and link it.

     sev 'fail' = a stated REQUIREMENT — breaking it risks disapproval or truncation
     sev 'warn' = a stated BEST PRACTICE — legal, but leaving performance on the table

   Rules run per SKU in the browser over the streamed feed (the worker never parses rows,
   per the Feed Lab CPU rule); qualityCollector aggregates hit counts + example offenders
   as it streams, so a 125MB feed costs megabytes, not gigabytes. */

const PROMO_RE = /\b(free\s+(?:shipping|delivery|p&p)|sale|best\s+price|lowest\s+price|cheap(?:est)?|discount(?:ed)?|clearance|buy\s+now|shop\s+now|order\s+now|limited\s+time|special\s+offer|bogof|\d+%\s*off|save\s*[£$€]\s*\d|now\s*only)\b/i;
const HTML_RE = /<\s*\/?\s*[a-z][^>]*>|&(?:nbsp|amp|lt|gt|quot|#\d+);/i;
const URL_RE = /(?:https?:\/\/|www\.)\S+/i;
// gimmicks Google names explicitly: repeated punctuation, decorative symbols, emoji
const GIMMICK_RE = /[!?]{2,}|\*{2,}|[★☆➤►◄♥♦●■→⇒✔✓✩✪]|[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u;
const PLACEHOLDER_RE = /^(?:n\/?a|none|null|nil|other|multi(?:colou?r)?|misc|unknown|tbc|-{1,}|\.+|0)$/i;
const FANCY_RE = /[\u{1D400}-\u{1D7FF}]/u;   // maths-alphanumeric "fancy" letters
const COLOUR_WORDS = /\b(black|white|red|blue|green|yellow|pink|purple|grey|gray|brown|beige|navy|cream|gold|silver|orange|ivory|tan|khaki|burgundy|teal|lilac)\b/i;
const SIZE_WORDS = /\b(xxs|xs|small|medium|large|xl|xxl|xxxl|\d{1,2}(?:\.\d)?\s?(?:cm|mm|inch|in|ml|l|g|kg)|uk\s?\d{1,2}|eu\s?\d{2})\b/i;

// "capital letters for emphasis" — 2+ consecutive shouty words, or a wholly-caps string.
// Acronyms (UK, XL, USB, 2XL) are legitimate, so a single caps token never trips it, and
// a brand that is simply STYLED in capitals (HUGO BOSS, DKNY, CALVIN KLEIN) is stripped
// out before the test: the rule is about emphasis, not about someone's logo.
export function stripBrand(v, brand) {
  const b = String(brand || '').trim();
  if (!b || b.length < 2) return String(v || '');
  return String(v || '').replace(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
}
export function shoutyCaps(v) {
  const s = String(v || '');
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 8 && letters === letters.toUpperCase()) return true;
  const ws = s.split(/\s+/).filter((w) => /[A-Za-z]{3,}/.test(w));
  let run = 0;
  for (const w of ws) {
    const l = w.replace(/[^A-Za-z]/g, '');
    if (l.length >= 3 && l === l.toUpperCase()) { run++; if (run >= 2) return true; } else run = 0;
  }
  return false;
}
// a repeatable field (highlights, details) arrives from the parsers joined on |||
export function multiVals(v) {
  return String(v == null ? '' : v).split(/\s*\|\|\|\s*|\n+/).map((x) => x.trim()).filter(Boolean);
}
const words = (v) => String(v || '').trim().split(/\s+/).filter(Boolean);

// Ray, 17 Sep 2026 (uploaded Google's official taxonomy-with-ids.en-US export, pointing at
// "Apparel & Accessories > Shoes" flagged "too broad — fewer than three levels" on a live
// scorecard): "if the final GPC (Shoes) which has no further clarification from Google, then
// that's already optimal." The shallow-GPC rule below tested only the STRING SHAPE (fewer than
// three " > "-separated levels), with no idea whether Google's fixed taxonomy actually offers a
// third level under that branch — Shoes has none, so a merchant who chose it correctly was
// scored as if a more specific option existed and they had ignored it. Google's taxonomy has 21
// top-level categories (every one branches further, so a bare top-level value always has a more
// specific option and always warns), and 192 second-level nodes, of which exactly these 52 are
// TERMINAL — no third level exists anywhere under them — derived once from the official export
// (depth-2 nodes with zero depth-3 descendants) rather than guessed. A depth-2 value NOT in this
// list still warns, because a deeper option genuinely exists there. Snapshot, not live-fetched —
// the full ~5,500-row taxonomy costs more to ship than the 192 second-level shapes are worth
// (see the rule's own comment below); re-derive this list if Ray supplies a refreshed export.
export const GPC_LEAF2 = new Set([
  'animals & pet supplies > live animals', 'apparel & accessories > shoes',
  'arts & entertainment > event tickets', 'baby & toddler > baby gift sets',
  'business & industrial > film & television', 'business & industrial > forestry & logging',
  'business & industrial > hotel & hospitality', 'business & industrial > industrial storage accessories',
  'business & industrial > janitorial carts & caddies', 'business & industrial > manufacturing',
  'business & industrial > mining & quarrying', 'electronics > gps navigation systems',
  'electronics > gps tracking devices', 'electronics > radar detectors', 'electronics > speed radars',
  'electronics > toll collection devices', 'electronics > video game consoles',
  'furniture > entertainment centers & tv stands', 'furniture > futon frames', 'furniture > futon pads',
  'furniture > futons', 'furniture > ottomans', 'furniture > room divider accessories',
  'furniture > room dividers', 'furniture > sofas', 'hardware > fuel containers & tanks',
  'hardware > small engines', 'hardware > storage tanks', 'home & garden > fireplaces',
  'home & garden > parasols & rain umbrellas', 'home & garden > umbrella sleeves & cases',
  'home & garden > wood stoves', 'luggage & bags > backpacks', 'luggage & bags > briefcases',
  'luggage & bags > cosmetic & toiletry bags', 'luggage & bags > diaper bags', 'luggage & bags > dry boxes',
  'luggage & bags > duffel bags', 'luggage & bags > fanny packs', 'luggage & bags > garment bags',
  'luggage & bags > messenger bags', 'luggage & bags > shopping totes', 'luggage & bags > suitcases',
  'luggage & bags > train cases', 'media > carpentry & woodworking project plans', 'media > sheet music',
  'office supplies > desk pads & blotters', 'office supplies > impulse sealers', 'office supplies > lap desks',
  'office supplies > name plates', 'software > video game software', 'toys & games > game timers',
]);

/* Per attribute: the spec limits Google publishes, the weight the attribute carries in the
   content-quality score, and its rules. `doc` is the support.google.com/merchants answer. */
export const QSPEC = [
  { key: 'title', doc: 6324415, w: 3, max: 150, label: 'Product title',
    spec: '1–150 characters · brand + product + distinguishing details, most important first',
    rules: [
      { id: 'len-over', sev: 'fail', label: 'over 150 characters',
        why: 'Google’s limit for [title] is 1–150 characters — longer titles are truncated.',
        test: (v) => v.length > 150 },
      { id: 'caps', sev: 'fail', label: 'capital letters for emphasis',
        why: '“Don’t use all caps” — Google names block capitals as a gimmicky way of drawing attention.',
        test: (v, r) => shoutyCaps(stripBrand(v, r.brand)) },
      { id: 'promo', sev: 'fail', label: 'promotional text',
        why: '“Don’t include promotional text such as price, sale price, sale dates, shipping, delivery date.”',
        test: (v) => PROMO_RE.test(v) },
      { id: 'gimmick', sev: 'fail', label: 'symbols / HTML / emoji',
        why: '“Don’t use gimmicky ways of drawing attention such as all caps, symbols, HTML tags.”',
        test: (v) => GIMMICK_RE.test(v) || HTML_RE.test(v) || FANCY_RE.test(v) },
      { id: 'thin', sev: 'warn', label: 'under 30 characters',
        why: 'A title this short cannot carry brand + product + variant detail, so it matches far fewer queries.',
        test: (v) => v.length < 30 },
      { id: 'short', sev: 'warn', label: 'under 70 characters — room unused',
        why: '“Use all 150 characters” and “put the most important details first” — users usually notice only the first 70.',
        test: (v) => v.length >= 30 && v.length < 70 },
      { id: 'no-brand', sev: 'warn', label: 'brand missing from the title',
        why: 'Google asks for keywords like product name and brand; the title is the strongest matching signal you control.',
        test: (v, r) => !!r.brand && v.toLowerCase().indexOf(String(r.brand).toLowerCase()) < 0 },
      { id: 'space', sev: 'warn', label: 'extra white space',
        why: '“Don’t include extra white spaces.”',
        test: (v, r, raw) => /\s{2,}/.test(raw) || raw !== raw.trim() },
      { id: 'dupe', sev: 'warn', label: 'title shared by more than one product', dupe: true,
        why: 'Google asks for “distinguishing details of each variant” — identical titles make products and variants compete as one, so every repeat counts here, whether the other row is a variant of the same product or a different product entirely.' },
    ] },
  { key: 'description', doc: 6324468, w: 3, max: 5000, label: 'Product description',
    spec: '1–5,000 characters · the important details in the first 160–500',
    rules: [
      { id: 'len-over', sev: 'fail', label: 'over 5,000 characters',
        why: 'Google’s limit for [description] is 1–5,000 characters.',
        test: (v) => v.length > 5000 },
      { id: 'html', sev: 'fail', label: 'HTML markup in the text',
        why: 'Descriptions take plain text — “use XML entities or escaped characters instead of symbols”; raw tags render literally.',
        test: (v) => HTML_RE.test(v) },
      { id: 'links', sev: 'fail', label: 'links to a site',
        why: '“Don’t include links to your store or other websites.”',
        test: (v) => URL_RE.test(v) },
      { id: 'promo', sev: 'fail', label: 'promotional text',
        why: '“Don’t include promotional text such as price, sale price, sale dates, shipping, delivery date.”',
        test: (v) => PROMO_RE.test(v) },
      { id: 'caps', sev: 'warn', label: 'capital letters for emphasis',
        why: '“Don’t use capital letters for emphasis.”',
        test: (v) => shoutyCaps(v) },
      { id: 'thin', sev: 'warn', label: 'under 160 characters',
        why: '“List the most important details in the first 160–500 characters” — a shorter description cannot.',
        test: (v) => v.length < 160 },
      { id: 'taxonomy', sev: 'warn', label: 'category path pasted in',
        why: '“Don’t include… categorization systems like Toys & Games > Dolls” — that belongs in product_type.',
        test: (v) => /\s>\s/.test(v) },
      { id: 'same-as-title', sev: 'warn', label: 'same as the title',
        why: 'A description that repeats the title adds no new matching surface for Shopping or AI answers.',
        test: (v, r) => !!r.title && v.toLowerCase() === String(r.title).trim().toLowerCase() },
      { id: 'dupe', sev: 'warn', label: 'description shared with a different product', dupe: true, variantAware: true,
        why: '“Be specific and accurate… describe only the product itself” — boilerplate shared across products describes none of them. Variants of the SAME product (item_group_id) legitimately share copy, so they are not counted here.' },
    ] },
  { key: 'product_highlight', doc: 9216100, w: 2, max: 150, multi: true, label: 'Product highlights',
    spec: '1–150 characters each · recommended 4–6, minimum 2, maximum 100',
    rules: [
      { id: 'len-over', sev: 'fail', label: 'a highlight over 150 characters',
        why: 'The limit is 1–150 characters per highlight.',
        test: (v) => multiVals(v).some((x) => x.length > 150) },
      { id: 'count-min', sev: 'fail', label: 'fewer than 2 highlights',
        why: 'Google’s stated minimum is 2 highlights per product (4–6 recommended).',
        test: (v) => multiVals(v).length < 2 },
      { id: 'promo', sev: 'fail', label: 'promotional text',
        why: '“Don’t include promotional text… such as price, sale price, sale dates, shipping.”',
        test: (v) => PROMO_RE.test(v) },
      { id: 'links', sev: 'fail', label: 'links to a site',
        why: '“Don’t include links to your store or other websites.”',
        test: (v) => URL_RE.test(v) },
      { id: 'count-low', sev: 'warn', label: 'fewer than 4 highlights',
        why: 'Google recommends 4–6 highlights — AI and agentic surfaces read these as the product’s selling benefits.',
        test: (v) => { const n = multiVals(v).length; return n >= 2 && n < 4; } },
      { id: 'caps', sev: 'warn', label: 'capital letters for emphasis',
        why: '“Don’t use capital letters for emphasis.”',
        test: (v) => shoutyCaps(v) },
      { id: 'dupe-in', sev: 'warn', label: 'the same highlight twice',
        why: '“Don’t duplicate data within the attribute or data you have already submitted in other attributes.”',
        test: (v) => { const a = multiVals(v).map((x) => x.toLowerCase()); return new Set(a).size < a.length; } },
    ] },
  { key: 'google_product_category', doc: 6324436, w: 2, depth: true, label: 'Google product category',
    spec: 'a predefined Google taxonomy value — the numeric ID or the full path, not both',
    rules: [
      // the full taxonomy is ~5,500 values and shipping it into the page would cost more
      // than it is worth, so this tests the SHAPE Google specifies — an ID, or a path
      // whose levels are separated by " > ". A bare top-level name ("Apparel &
      // Accessories") is a legitimate category, so it is shallow, never invalid.
      { id: 'not-taxonomy', sev: 'fail', label: 'not a Google taxonomy value',
        why: '“Use only a predefined Google product category” — the numeric ID or the full path, “but not both”.',
        test: (v) => PLACEHOLDER_RE.test(v) || /\|/.test(v) || /\//.test(v) ||
          (/>/.test(v) && !/\s>\s/.test(v)) || (/^\d/.test(v) && !/^\d{2,8}$/.test(v)) },
      { id: 'shallow', sev: 'warn', label: 'too broad — fewer than three levels',
        why: '“Use the most specific category possible” — “broad categories such as Electronics are often too vague for effective automated bidding.”',
        // a two-level value is only "too broad" if Google's own taxonomy actually offers a
        // third level under it — Apparel & Accessories > Shoes has none, so choosing it IS
        // the most specific category possible, not a merchant stopping short (Ray, 17 Sep
        // 2026; GPC_LEAF2 above). A one-level value always warns — every top-level category
        // branches further, so a deeper option always exists there.
        test: (v) => {
          if (/^\d{2,8}$/.test(v)) return false;
          const levels = v.split(/\s>\s/).map((x) => x.trim());
          if (levels.length >= 3) return false;
          if (levels.length === 2 && GPC_LEAF2.has(levels.join(' > ').toLowerCase())) return false;
          return true;
        } },
    ] },
  { key: 'product_type', doc: 6324406, w: 2, max: 750, depth: true, label: 'Product type',
    spec: '0–750 characters · your own taxonomy, levels separated by “ > ”',
    rules: [
      { id: 'len-over', sev: 'fail', label: 'over 750 characters',
        why: 'Google’s limit for [product_type] is 0–750 characters.',
        test: (v) => v.length > 750 },
      { id: 'sep', sev: 'fail', label: 'levels not separated by “ > ”',
        why: '“Use > to separate multiple levels… include a space before and after the > symbol.”',
        test: (v) => (/>/.test(v) && !/\s>\s/.test(v)) || (!/>/.test(v) && /\s\/\s|\||,/.test(v)) },
      { id: 'single-level', sev: 'warn', label: 'a single level, no hierarchy',
        why: '“If your own product categorization includes multiple levels, include all the levels” — “Books > Non-Fiction > Sports > Baseball” beats “Baseball”.',
        test: (v) => !/>/.test(v) },
    ] },
  { key: 'color', doc: 6324487, w: 1, max: 100, label: 'Colour',
    spec: '1–100 characters · 1 primary colour + up to 2 secondary, separated by “/”',
    rules: [
      { id: 'len-over', sev: 'fail', label: 'over 100 characters',
        why: 'The limit is 1–100 characters total, 1–40 per colour.',
        test: (v) => v.length > 100 },
      { id: 'not-colour', sev: 'fail', label: 'not a colour value',
        why: '“Don’t include a value that isn’t a colour such as variety, mens, womens, N/A”, and “don’t reference the product or image such as see image”.',
        test: (v) => PLACEHOLDER_RE.test(v) || /\b(variety|mens|womens|assorted|see\s+image|as\s+shown)\b/i.test(v) },
      { id: 'hex', sev: 'fail', label: 'hex code or number as a colour',
        why: '“Don’t use characters that aren’t alphanumeric such as #fff000” and “don’t use a number as a colour”.',
        test: (v) => /#/.test(v) || /^[\d\s]+$/.test(v) },
      { id: 'one-letter', sev: 'fail', label: 'single-letter colour',
        why: '“Include more than 1 letter and not values such as R.”',
        test: (v) => v.split('/').some((x) => /^[A-Za-z]$/.test(x.trim())) },
      { id: 'sep', sev: 'warn', label: 'colours not separated by “/”',
        why: 'Multiple colours are “separated by a slash (/)” — commas or run-together values are not read as separate colours.',
        test: (v) => /,|\s&\s|\s\+\s/.test(v) },
      { id: 'too-many', sev: 'warn', label: 'more than 3 colours',
        why: '“1 primary colour followed by up to 2 secondary colours.”',
        test: (v) => v.split('/').filter((x) => x.trim()).length > 3 },
    ] },
  { key: 'material', doc: 6324410, w: 1, max: 200, label: 'Material',
    spec: '0–200 characters · primary material + up to 2 secondary, separated by “/”',
    rules: [
      { id: 'len-over', sev: 'fail', label: 'over 200 characters',
        why: 'Google’s limit for [material] is 0–200 characters.',
        test: (v) => v.length > 200 },
      { id: 'placeholder', sev: 'fail', label: 'placeholder value',
        why: '“Don’t submit n/a, none, multi or other if material isn’t relevant to the product” — leave it out instead.',
        test: (v) => PLACEHOLDER_RE.test(v) },
      { id: 'cross-attr', sev: 'warn', label: 'a colour or size in the material field',
        why: '“Don’t include values that belong in other attributes such as colour, size, or pattern.”',
        test: (v) => COLOUR_WORDS.test(v) || SIZE_WORDS.test(v) },
      { id: 'sentence', sev: 'warn', label: 'a sentence, not a material value',
        why: 'Material takes a value like “cotton/polyester/elastane”, not prose — long strings do not match.',
        test: (v) => words(v).length > 4 || /[.;:]/.test(v) },
      { id: 'sep', sev: 'warn', label: 'materials not separated by “/”',
        why: 'Secondary materials are “each separated by a slash (/)” — commas are not parsed as separate materials.',
        test: (v) => /,|\s&\s|\s\+\s/.test(v) },
    ] },
  { key: 'pattern', doc: 6324483, w: 1, max: 100, label: 'Pattern',
    spec: '0–100 characters · one value users understand',
    rules: [
      { id: 'len-over', sev: 'fail', label: 'over 100 characters',
        why: 'Google’s limit for [pattern] is 0–100 characters.',
        test: (v) => v.length > 100 },
      { id: 'placeholder', sev: 'fail', label: 'placeholder value',
        why: '“Don’t submit n/a, none, multi or other if the pattern isn’t relevant to the product.”',
        test: (v) => PLACEHOLDER_RE.test(v) },
      { id: 'multi', sev: 'warn', label: 'more than one value',
        why: '“Submit only one value. Only one value will be accepted in the pattern field.”',
        test: (v) => !PLACEHOLDER_RE.test(v) && /\/|,|\s&\s/.test(v) },   // "n/a" is the rule above's, not this one's
      { id: 'cross-attr', sev: 'warn', label: 'a size value in the pattern field',
        why: '“Don’t include values that belong in other attributes such as colour, size, or material.”',
        test: (v) => SIZE_WORDS.test(v) },
      { id: 'internal', sev: 'warn', label: 'abbreviation or internal term',
        why: '“Use a value users will be able to understand” — “avoid abbreviations or internal terms.”',
        test: (v) => /^[A-Z0-9_-]{2,}$/.test(v) || /\d{3,}/.test(v) },
    ] },
];
export function qspecOf(key) { return QSPEC.filter((q) => q.key === key)[0] || null; }

/* Streaming aggregator — the same shape as xmlCollector: feed it rows, ask for the result.
   `cols` maps attribute key -> column index (findAttrCols output). Example offenders are
   capped per rule, and duplicate detection keeps a bounded value->count map so a 2M-row
   feed cannot blow the browser's memory. */
/* Every column a REPEATABLE attribute occupies. An XML feed that repeats an element expands
   to `name`, `name(2)`, `name(3)`…, and a CSV may ship the same shape or a |||-joined cell —
   so a quality read that resolves one column reads one value out of four. */
export function findMultiCols(headerRow) {
  const out = {};
  for (const q of QSPEC) {
    if (!q.multi) continue;
    const hits = slotCols(headerRow, q.key);
    if (hits.length) out[q.key] = hits;
  }
  return out;
}
const joinSlots = (row, idx) => (idx || []).map((i) => String(row[i] == null ? '' : row[i]).trim())
  .filter((x) => x).join('|||');

// How many VALUES a repeatable attribute carries per product, bucketed — "how many
// highlights spotted" (Ray, 17 Sep 2026: "showcase what you have done ... which is how
// many highlights you have spotted within 100. So recommendation is from 6 to 10"). Google's
// own spec (answer 9216100) is already enforced as rules above (fail <2, warn <4); this is a
// separate, descriptive read of the SHAPE of the catalogue against Ray's own house target —
// the same layering PT Guard uses for its 5-depth standard alongside Google's base spec.
// The buckets are the POPULATION keys (Ray, 18 Sep 2026: "the table breakdown for highlight
// population (1, 2, 3, 4, 5, >5)") — one product, one exact count, so the row reads like the
// PT depth table; a product with no highlight is not filled and never enters the read.
export const HL_BUCKETS = POP_KEYS;
export const HL_STD = { min: 6, max: 10 };
function hlBucket(n) { return popBucket(Math.max(1, n)); }
function hlDistOf(buckets, filled) {
  const pct = {};
  for (const b of HL_BUCKETS) pct[b] = Math.round(((buckets[b] || 0) / filled) * 1000) / 10;
  return pct;
}

const EG_CAP = 4, DUPE_CAP = 200000, GRP_CAP = 2000, ID_CAP = 4, EG_LEN = 140;
export function qualityCollector(cols, opts) {
  const o = opts || {};
  // the header is how a repeatable attribute's other columns are found; without it the read
  // falls back to the single column and SAYS SO on the snapshot rather than under-counting
  // silently (`multi` carries how many columns each repeatable attribute was read across)
  const multi = o.header ? findMultiCols(o.header) : {};
  const specs = QSPEC.filter((q) => (cols && cols[q.key] != null && cols[q.key] >= 0) ||
    (multi[q.key] && multi[q.key].length));
  // every column each attribute is read from — the slot set for a repeatable one, and the
  // single resolved column otherwise (also the fallback when no header was handed in, so a
  // caller on the old signature reads exactly what it always did)
  const idxOf = {};
  for (const q of specs) {
    idxOf[q.key] = (q.multi && multi[q.key] && multi[q.key].length) ? multi[q.key]
      : (cols && cols[q.key] != null && cols[q.key] >= 0 ? [cols[q.key]] : []);
  }
  const acc = {};
  for (const q of specs) {
    const r = { key: q.key, filled: 0, sum: 0, vals: 0, min: Infinity, max: 0, rules: {}, dupes: 0, over: false, depthSum: 0, hlBuckets: {} };
    for (const rule of q.rules) r.rules[rule.id] = { n: 0, eg: [] };
    // a duplicate is a GROUP, not a list of strings (Ray, 16 Sep 2026, reading Monsoon GB:
    // four unrelated titles under "title duplicated across products" reads as a false
    // positive, because nothing on screen said each one appears TWICE). So each repeated
    // value is kept with its repeat count and the ids of the products carrying it — the
    // evidence a human needs to confirm the finding without re-reading the feed.
    if (q.rules.some((x) => x.dupe)) { r.seen = new Map(); r.groups = new Map(); r.vals = 0; r.gover = false; }
    acc[q.key] = r;
  }
  let rows = 0;
  const cut = (v) => (v.length > EG_LEN ? v.slice(0, EG_LEN - 1) + '…' : v);
  return {
    onRow(row) {
      rows++;
      const at = (k) => (cols[k] != null && cols[k] >= 0 ? String(row[cols[k]] || '').trim() : '');
      const ctx = { brand: at('brand'), title: at('title') };
      // what names the product in a duplicate group — its id, or the page it points at
      const who = at('id') || at('link').replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
      // and what makes it the SAME product as another row: the variant family
      const fam = at('item_group_id') || who || 'r' + rows;
      for (const q of specs) {
        // A REPEATABLE ATTRIBUTE LIVES IN SEVERAL COLUMNS, and reading one of them is reading
        // one of the values (Ray, 16 Sep 2026: "each product has at least four to five
        // highlights, so why is it now showing as zero point?"). Monsoon GB ships four
        // repeated <g:product_highlight> elements per item, which the XML parser expands to
        // g:product_highlight, (2), (3), (4) — so the single-column read saw ONE value and
        // "fewer than 2 highlights" fired on the whole catalogue. The slots are joined back
        // into the ||| form every rule already splits on, so the rules are untouched.
        const raw = q.multi ? joinSlots(row, idxOf[q.key])
          : String(row[idxOf[q.key][0]] == null ? '' : row[idxOf[q.key][0]]);
        const v = raw.trim();
        const a = acc[q.key];
        if (!v) continue;                     // emptiness is Golden Record's question, not this one
        a.filled++;
        // length is PER VALUE for a repeatable attribute — "average length" on a highlight
        // means the length of a highlight, not of four of them glued together
        const lens = q.multi ? multiVals(v).map((x) => x.length) : [v.length];
        for (const L of lens) {
          a.sum += L; a.vals++;
          if (L < a.min) a.min = L;
          if (L > a.max) a.max = L;
        }
        // how many VALUES this product carries, bucketed — one product, one bucket, so the
        // distribution reads as a share of the catalogue rather than a share of values
        if (q.multi) { const b = hlBucket(lens.length); a.hlBuckets[b] = (a.hlBuckets[b] || 0) + 1; }
        // taxonomy depth — the same " > "/"/" chevron read Product Type Guard's
        // depthProfile and Feed Lab's gpcDepthAvg already use, so this number can never
        // disagree with either (Ray, 17 Sep 2026: bring PT depth into Content Quality too)
        if (q.depth) a.depthSum += pathDepth(v);
        for (const rule of q.rules) {
          if (rule.dupe) continue;
          let hit = false;
          try { hit = !!rule.test(v, ctx, raw); } catch (e) { hit = false; }
          if (!hit) continue;
          const slot = a.rules[rule.id];
          slot.n++;
          if (slot.eg.length < EG_CAP) slot.eg.push(cut(v));
        }
        if (a.seen) {
          const k = v.toLowerCase();
          const prev = a.seen.get(k);
          if (prev) {
            prev[0]++;
            // is this value shared with a DIFFERENT product, or only between variants of the
            // same one? Size variants sharing a description is normal; two separate products
            // sharing it is the finding. The same distinction the Feed Lab audit makes.
            if (!prev[3] && fam !== prev[2]) prev[3] = 1;
            let g = a.groups.get(k);
            if (!g) {
              if (a.groups.size < GRP_CAP) { g = { v: cut(v), n: 1, ids: prev[1] ? [prev[1]] : [] }; a.groups.set(k, g); }
              else a.gover = true;
            }
            if (g) { g.n++; g.x = prev[3] || 0; if (who && g.ids.length < ID_CAP) g.ids.push(who); }
          } else if (a.seen.size < DUPE_CAP) a.seen.set(k, [1, who, fam, 0]);
          else a.over = true;
        }
      }
    },
    finish(meta) {
      const attrs = {};
      for (const q of specs) {
        const a = acc[q.key];
        const dr = q.rules.filter((x) => x.dupe)[0];
        if (dr) {
          // count from the map itself, so "products involved" and "distinct values shared"
          // can each be split by whether the repeat crosses a variant family
          let dupes = 0, xdupes = 0, vals = 0, xvals = 0;
          a.seen.forEach((e) => {
            if (e[0] < 2) return;
            dupes += e[0]; vals++;
            if (e[3]) { xdupes += e[0]; xvals++; }
          });
          // Google asks the TITLE to distinguish each variant, so a title two variants share
          // is as much a finding as one two products share — that rule counts every repeat.
          // The DESCRIPTION rule is about boilerplate ("describe only the product itself"),
          // and variants of one product legitimately share copy, so it counts only the copy
          // reused across different products — the same call the AI-Readiness pillar makes.
          const across = !!dr.variantAware;
          // biggest groups first — the ones worth looking at — and the example list becomes
          // those same values, each named ONCE (it used to push the value again on every
          // repeat, so one title could fill all four slots and look like four findings)
          const gs = Array.from(a.groups.values())
            .filter((g) => (across ? g.x : true))
            .sort((x, y) => y.n - x.n).slice(0, EG_CAP);
          const slot = a.rules[dr.id];
          slot.n = across ? xdupes : dupes;
          slot.vals = across ? xvals : vals;
          slot.groups = gs;
          slot.eg = gs.map((g) => g.v);
          // what was NOT counted as a finding — context, so the number is never a mystery
          if (across && dupes > xdupes) { slot.within = dupes - xdupes; slot.withinVals = vals - xvals; }
        }
        const pct = (n) => (a.filled ? Math.round((n / a.filled) * 1000) / 10 : 0);
        const rules = {};
        for (const rule of q.rules) {
          const hit = a.rules[rule.id];
          rules[rule.id] = { n: hit.n, pct: pct(hit.n), eg: hit.eg };
          if (hit.groups) {
            rules[rule.id].groups = hit.groups; rules[rule.id].vals = hit.vals;
            if (hit.within) { rules[rule.id].within = hit.within; rules[rule.id].withinVals = hit.withinVals; }
          }
        }
        attrs[q.key] = {
          filled: a.filled, cov: rows ? Math.round((a.filled / rows) * 1000) / 10 : 0,
          avgLen: a.vals ? Math.round(a.sum / a.vals) : 0,
          minLen: a.vals ? a.min : 0, maxLen: a.max,
          rules, dupeCapped: a.over || undefined,
          // how many columns a repeatable attribute was read across, and how many values
          // that came to per filled product — the number that makes "fewer than 2
          // highlights" checkable rather than something to take on trust
          cols: q.multi ? (idxOf[q.key].length || 1) : undefined,
          perProduct: q.multi && a.filled ? Math.round((a.vals / a.filled) * 10) / 10 : undefined,
          // how many chevron levels the taxonomy value carries, on average — GPC and
          // product_type only (the two attributes with a hierarchical path shape)
          avgDepth: q.depth && a.filled ? Math.round((a.depthSum / a.filled) * 10) / 10 : undefined,
          // the SHARE of products at each highlight-count bucket — "how many highlights
          // you have spotted" — read against Ray's own 6–10 house standard, alongside
          // (never replacing) Google's stated 2-minimum/4-recommended rules above
          hlDist: q.multi && a.filled ? hlDistOf(a.hlBuckets, a.filled) : undefined,
        };
      }
      return Object.assign({ t: Date.now(), rows, attrs }, meta || {});
    },
  };
}

/* One 0–100 rating per attribute, and one for the feed. A rule's penalty is the share of
   FILLED products that break it, weighted by severity — a requirement broken on 40% of
   products costs 40 points, the same break on a best practice costs 16. Attributes weigh
   by how much of the shop window they are (title/description 3, highlights/GPC/PT 2, the
   variant trio 1) — the same shape as goldenScore, so the two numbers read alike. */
export const QW = { fail: 1, warn: 0.4 };
// `qwaived` (optional): rule ids the brand's profile set aside as NOT APPLICABLE (Ray, 21 Sep
// 2026). A waived rule costs nothing and is not a finding — it is reported apart, under
// `waived`, with the share it would have cost, so the decision stays visible and reversible
// rather than the issue silently disappearing from a score a client is shown.
export function attrQuality(key, a, qwaived) {
  const q = qspecOf(key);
  if (!q || !a || !a.filled) return null;
  const off = new Set(qwaived || []);
  let pen = 0;
  const broken = [], waived = [];
  for (const rule of q.rules) {
    const hit = (a.rules || {})[rule.id];
    if (!hit || !hit.n) continue;
    const cost = (hit.pct / 100) * QW[rule.sev] * 100;
    const row = { id: rule.id, sev: rule.sev, label: rule.label, why: rule.why,
      n: hit.n, pct: hit.pct, eg: hit.eg || [], cost: Math.round(cost * 10) / 10,
      groups: hit.groups && hit.groups.length ? hit.groups : undefined,
      vals: hit.vals || undefined, within: hit.within || undefined, withinVals: hit.withinVals || undefined };
    if (off.has(rule.id)) { waived.push(row); continue; }
    pen += cost;
    broken.push(row);
  }
  broken.sort((x, y) => y.cost - x.cost);
  return { key, score: Math.max(0, Math.round((100 - pen) * 10) / 10), broken, waived,
    cols: a.cols, perProduct: a.perProduct, avgDepth: a.avgDepth, hlDist: a.hlDist,
    filled: a.filled, cov: a.cov, avgLen: a.avgLen, minLen: a.minLen, maxLen: a.maxLen,
    fails: broken.filter((b) => b.sev === 'fail').length,
    warns: broken.filter((b) => b.sev === 'warn').length };
}
// `profile` (profileFor()'s shape, optional) waives an attribute from the score entirely —
// Ray, 17 Sep 2026: "make sure all scoring (AI readiness, content quality) always refer back
// to the industry best practice that had been set." Pet Care waives pattern/size_type/
// size_system for goldenScore; a Pet Care feed with a handful of stray `pattern` values would
// otherwise still be judged by apparel-oriented pattern rules here. Waived attributes drop out
// of both the numerator and denominator, same as goldenScore's own waived attributes.
export function qualityScore(snap, profile) {
  if (!snap || !snap.attrs) return null;
  const waived = (profile && profile.waived) || [];
  const parts = [];
  let ws = 0, sum = 0, setAside = 0;
  for (const q of QSPEC) {
    if (waived.indexOf(q.key) >= 0) continue;
    // per-rule waivers ride the same profile: the attribute stays in the score, the rule
    // the brand set aside does not (Ray, 21 Sep 2026)
    const r = attrQuality(q.key, snap.attrs[q.key], qwaivedFor(profile, q.key));
    if (!r) continue;
    r.w = q.w; r.label = q.label; r.doc = q.doc; r.spec = q.spec;
    parts.push(r); ws += q.w; sum += q.w * r.score; setAside += r.waived.length;
  }
  if (!ws) return null;
  const score = Math.round((sum / ws) * 10) / 10;
  const fails = parts.reduce((n, p) => n + p.fails, 0);
  return { score, parts, fails, setAside, verdict: qualityVerdict(score, fails) };
}
// plain-English band, said the way Ray says it to a client
export function qualityVerdict(score, fails) {
  if (fails && score < 75) return { band: 'poor', pill: '🔻 Spec violations',
    line: 'Content breaks Google’s stated requirements on a material share of the catalogue — that is disapproval and truncation risk, not a nice-to-have.' };
  if (score < 75) return { band: 'poor', pill: '🔻 Below standard',
    line: 'The data is present but thin against Google’s own guidance — the matching surface is a fraction of what it could be.' };
  if (score < 90) return { band: 'mid', pill: '⚠ Below best practice',
    line: 'Nothing here risks disapproval, but the free-text fields are not being used the way Google asks — that is headroom, measurable per rule below.' };
  return { band: 'good', pill: '✓ Meets the spec',
    line: 'The free-text attributes read the way Google’s specification asks: within limits, no promotional copy, no gimmicks, hierarchy where hierarchy is expected.' };
}

/* The client ask for one content-quality attribute — the consultative voice of the other
   composers: the rule, the number, the proposal, never an alarm. */
export function qualityAskEmail(client, mkt, r) {
  const loc = client + ' ' + String(mkt || '').toUpperCase();
  const disp = 'g:' + r.key;
  const n = (x) => Number(x).toLocaleString('en-GB');
  const lines = r.broken.slice(0, 3).map((b) => '- ' + b.label + ' — ' + b.pct + '% of products (' + n(b.n) + '). ' + b.why);
  return {
    subject: loc + ' — feed data: ' + disp + ' quality against Google’s specification',
    body: 'Hi team,\n\n'
      + 'A finding from our feed monitoring, measured against Google’s product data specification for ' + disp + '.\n\n'
      + 'Across the ' + loc + ' feed, ' + n(r.filled) + ' products carry a value and the content scores '
      + r.score + '/100 against the specification’s own rules. The largest gaps:\n\n'
      + lines.join('\n')
      + '\n\nNone of this is about whether the field is filled — it is about what is in it. '
      + (r.fails
        ? 'The points above that Google states as requirements are the priority: products breaking them carry disapproval or truncation risk.'
        : 'These are Google’s stated best practices rather than hard rules, so the gain here is matching and performance rather than compliance.')
      + '\n\nWe would propose a structured pass from our side — we can share the affected product set and the proposed values for sign-off before anything changes in the live feed.'
      + '\n\nBest regards,\nRay',
  };
}
