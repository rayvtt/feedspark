/*
 * FS TASK MANAGER — the query engine and the book store behind /tasks (Ray, 16 Sep 2026).
 *
 *   "lets build a new module as FS Task Manager (to show all capabilities of this new
 *    feedspark-reports mcp please) — Allow more area where you can also create a search bar for
 *    each AM to work inside the pull-in report via the MCP, and a quick pull-out report — either
 *    a pie chart or any type of chart — based on the hours of billable versus non-billable,
 *    where you reach inside this MCP."
 *
 * The MCP exposes four reads and this module surfaces all four: the client roster
 * (get_client_list — one row per market, with its allowance and hours balance), the task list per
 * market (get_task_list_for_client — what was done, by whom, on what day, for how many billable
 * and non-billable hours), the email ticket queue (get_tickets_for_client) and a single ticket's
 * detail (get_ticket_detail).
 *
 * LIVE, NOT BAKED, AND NOTHING IN GIT. The worker reads the reports MCP itself (src/tmmcp.js,
 * the :15/:45 cron) — so the book is pulled into KV and kept there. No client hours, task titles
 * or contact addresses are committed to the repo: that is per-client commercial data, and the
 * decision that it lives in KV only was made when the sync lane shipped. The page says how much
 * of the book has been read and how long ago, rather than implying a completeness it does not
 * have.
 *
 * WHY BILLABLE AND NON-BILLABLE ARE KEPT APART AND BOTH KEPT. `time_taken` is what the client is
 * charged for; `time_taken_nonbill` is time our team spent and did not charge. Both are real
 * delivered effort, so both count toward what an account COST us — but they answer different
 * questions, so this engine never merges them into one number without also carrying the split.
 * That split is the chart Ray asked for.
 *
 * THE SEARCH BAR is a real query language, not a substring filter, because an AM's questions are
 * compound: "what non-billable work did Febin do on Reiss GB last quarter". Bare words match the
 * searchable text; `field:value` narrows; `-` negates; repeats of one field OR together while
 * different fields AND. parseQuery/matchTask below are the whole grammar, and the page and this
 * harness run the SAME functions — the page carries a behavioural twin between its ENGINE
 * markers, checked by tools/test_reporttasks.mjs.
 *
 * A COMMA IS OR, WHITESPACE IS AND (Ray, 16 Sep 2026: "this search bar allows multiple filters
 * separated by commas … 'Febin,Vitus' with no space after the comma"). Two names side by side
 * already meant "rows mentioning BOTH", which is the right default and is not changing; a list is
 * the other question — "either of these people" — and there was no way to ask it. `Febin,Vitus`
 * asks it. The comma binds ACROSS a space too, so `Febin, Vitus` is the same list: half of us type
 * the space, and silently reading that as AND would answer "no rows" to a query that plainly means
 * two people. A trailing comma mid-typing is simply not a term yet. Inside "quotes" a comma is
 * punctuation, not syntax — a quoted phrase is one literal, commas and all.
 *
 * On a FIELD the comma is the shorthand for what repeats already did: `owner:Febin,Vitus` is
 * exactly `owner:Febin owner:Vitus`. The range and bound fields (from/to/min/max) and the two-state
 * bill: inherit their existing repeat behaviour rather than inventing an alternation nobody means.
 *
 * Categories come from tools/reporthours.mjs so the Task Manager and the brand one-pager's
 * "Where the retainer went" donut can never disagree about what a task was.
 *
 * Pure module: no fetch, no KV, no DOM. The worker's tmBookPull does the I/O around it.
 */

import { classifyTask, CATS, CAT_LABEL, brandKey } from '../../../tools/reporthours.mjs';

export { CATS, CAT_LABEL, classifyTask, brandKey };

// ---------------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------------

// The reports database records a task's state as a short word. Only two appear in the live book
// ('done' and 'created'), but the others are real states in the source system, so they are
// mapped rather than assumed away. Anything unrecognised buckets as 'open' — an unknown state
// is outstanding work until someone says otherwise, which is the safe direction to be wrong in.
export const STATUS_BUCKET = {
  done: 'done', completed: 'done', closed: 'done',
  created: 'open', pending: 'open', assigned: 'open', progress: 'open', inprogress: 'open',
  onhold: 'hold', hold: 'hold', paused: 'hold', withclient: 'hold', snoozed: 'hold',
  cancelled: 'cancelled', canceled: 'cancelled', skipped: 'cancelled', deleted: 'cancelled',
};
export const BUCKET_LABEL = { done: 'Done', open: 'Open', hold: 'On hold', cancelled: 'Cancelled' };

export function bucketOf(status) {
  const k = String(status || '').toLowerCase().replace(/[\s_-]/g, '');
  return STATUS_BUCKET[k] || 'open';
}

// ---------------------------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------------------------

// '0000-00-00' is the source system's empty date. It is counted as UNDATED and never guessed
// into a month — a task with no date is a real fact about the record, not a rounding problem.
export function isoOf(v) {
  const s = String(v == null ? '' : v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.slice(0, 4) === '0000') return '';
  return s;
}
export function monthOf(v) {
  const d = isoOf(v);
  return d ? d.slice(0, 7) : '';
}
export function inWindow(iso, from, to) {
  if (!iso) return false;
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// normalising a pulled row
// ---------------------------------------------------------------------------------------------

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * One task row from get_task_list_for_client, plus the market meta the roster supplies.
 * `bill` and `nonbill` stay separate for the whole life of the record.
 */
export function normTask(row, meta) {
  const raw = (row && row.raw) || {};
  const title = String(row.title || '').trim();
  const bill = num(raw.time_taken != null ? raw.time_taken : row.time_taken);
  const nonbill = num(raw.time_taken_nonbill);
  return {
    id: num(row.list_id || raw.list_id),
    d: isoOf(row.created_on || raw.createdon),
    client: (meta && meta.client) || '',
    market: (meta && meta.market) || '',
    am: (meta && meta.am) || '',
    title,
    cat: classifyTask(title),
    owner: String(row.owner || '').trim(),
    status: String(row.status || raw.status || '').trim(),
    bucket: bucketOf(row.status || raw.status),
    bill: r2(bill),
    nonbill: r2(nonbill),
    hours: r2(bill + nonbill),
    sched: r2(num(raw.time_schedule)),
    note: String(raw.notes || '').replace(/\s+/g, ' ').trim(),
    ticket: num(raw.ticket_id) || 0,
  };
}

/** One row from get_tickets_for_client. */
export function normTicket(row) {
  return {
    id: num(row.ticket_id),
    client: String(row.client_name || '').trim(),
    am: String(row.primary_am || '').trim(),
    subject: String(row.subject || '').replace(/\s+/g, ' ').trim(),
    status: String(row.status || '').trim(),
    d: isoOf(row.received_date),
    first: isoOf(row.first_received),
    by: String(row.last_reply_by || '').trim(),
    origin: String(row.origin_type || '').trim(),
    from: String(row.origin_from || '').trim(),
    age: num(row.age_days),
    level: String(row.age_level || '').trim(),
    idle: num(row.idle_days),
    msgs: num(row.message_count),
    tasks: num(row.task_count),
    hours: r2(num(row.hours_spent)),
  };
}

// ---------------------------------------------------------------------------------------------
// the query language
// ---------------------------------------------------------------------------------------------

// field aliases → canonical key. An AM types whichever word is in their head.
export const FIELDS = {
  owner: 'owner', who: 'owner', by: 'owner',
  client: 'client', brand: 'client', account: 'client',
  market: 'market', mkt: 'market', country: 'market',
  am: 'am', manager: 'am',
  status: 'status', state: 'status',
  cat: 'cat', category: 'cat', type: 'cat',
  bill: 'bill', billable: 'bill',
  tag: 'tag', label: 'tag', tagged: 'tag',
  month: 'month',
  from: 'from', since: 'from', after: 'from',
  to: 'to', until: 'to', before: 'to',
  min: 'min', max: 'max',
};
// the category taxonomy answers to its own words as well as its keys
const CAT_ALIAS = {
  opt: 'opt', optimisation: 'opt', optimization: 'opt', optimise: 'opt',
  tech: 'tech', technical: 'tech', fix: 'tech', fixes: 'tech', broken: 'tech',
  feat: 'feat', feature: 'feat', setup: 'feat', 'set-up': 'feat', build: 'feat',
  acct: 'acct', account: 'acct', support: 'acct', admin: 'acct',
  other: 'other', unclassified: 'other',
};

// A comma inside "quotes" is punctuation; it rides through tokenization as this sentinel so the
// comma logic below can be unconditional, and is restored the moment the alternatives are cut.
const QCOMMA = '\u0000';

/**
 * Join tokens that a comma runs across, so `a, b` is the same list as `a,b` — a list typed with
 * spaces after its commas is still one list, and reading it as AND would answer nothing.
 */
export function mergeCommaRuns(toks) {
  const out = [];
  for (const t of toks) {
    const prev = out.length ? out[out.length - 1] : '';
    if (out.length && (prev.slice(-1) === ',' || t.charAt(0) === ',')) out[out.length - 1] = prev + t;
    else out.push(t);
  }
  return out;
}

/** One token's OR alternatives. Empties are dropped, so a half-typed `Febin,` is just `Febin`. */
export function splitAlts(tok) {
  return String(tok || '').split(',')
    .map((s) => s.split(QCOMMA).join(','))
    .filter((s) => s !== '');
}

/**
 * The comma rule on its own, for the plain-substring pane search: whitespace ANDs, a comma ORs.
 * Returns OR groups — every group must hit, any alternative within one will do.
 */
export function orTerms(s) {
  return mergeCommaRuns(String(s || '').toLowerCase().split(/\s+/).filter(Boolean))
    .map(splitAlts).filter((g) => g.length);
}

/**
 * Split a query string into terms, honouring "quoted phrases" and a leading - for negation.
 * Returns { text, neg, f, nf, num } where f/nf are field→[values] maps (positive / negated)
 * and num is the list of numeric bounds.
 */
export function parseQuery(q) {
  const out = { text: [], neg: [], f: {}, nf: {}, num: [], raw: String(q || '') };
  const src = String(q || '');
  const toks = [];
  let cur = '', quote = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') { quote = !quote; continue; }
    if (!quote && /\s/.test(c)) { if (cur) toks.push(cur); cur = ''; continue; }
    cur += (quote && c === ',') ? QCOMMA : c;
  }
  if (cur) toks.push(cur);

  for (const t0 of mergeCommaRuns(toks)) {
    const not = t0[0] === '-' && t0.length > 1;
    const t = not ? t0.slice(1) : t0;
    const m = t.match(/^([a-z_-]+):(.*)$/i);
    if (m && FIELDS[m[1].toLowerCase()] && m[2] !== '') {
      const k = FIELDS[m[1].toLowerCase()];
      const vals = splitAlts(m[2]);
      if (!vals.length) continue;
      // a bound is one number and a range is one date — an alternation there means nothing, so
      // those keep the first value, exactly as a repeated from:/min: already did
      if (k === 'min' || k === 'max') { out.num.push({ k, v: Number(vals[0]) || 0 }); continue; }
      const bag = not ? out.nf : out.f;
      for (let v of vals) {
        if (k === 'cat') v = CAT_ALIAS[v.toLowerCase()] || v.toLowerCase();
        else if (k === 'bill') v = /^(no|non|nonbill|non-billable|nonbillable|false|0)$/i.test(v) ? 'no' : 'yes';
        (bag[k] = bag[k] || []).push(v);
      }
      continue;
    }
    const alts = splitAlts(t.toLowerCase());
    if (alts.length) (not ? out.neg : out.text).push(alts);
  }
  return out;
}

const fold = (s) => String(s || '').toLowerCase();
// A field value matches when it equals the typed value or starts with it — "client:Rei" finds
// Reiss, "owner:Ste" finds Steven Opuni. Never a bare substring: "market:E" must not match every
// market containing an E.
const fieldHit = (val, want) => {
  const a = fold(val), b = fold(want);
  return a === b || (b.length >= 2 && a.indexOf(b) === 0);
};
const anyHit = (val, wants) => wants.some((w) => fieldHit(val, w));

/**
 * `tag:` reads a LIST, not a value — a task can carry several.
 *
 * `tag:none` (and `tag:untagged`) asks the opposite question: what has nobody judged yet. That is
 * the one an AM actually needs before trusting the displacement figure, so it is part of the
 * grammar rather than something you can only see by eye.
 */
const tagHit = (tags, wants) => wants.some((w) => {
  const b = fold(w);
  if (b === 'none' || b === 'untagged' || b === 'any') {
    return b === 'any' ? (tags || []).length > 0 : !(tags || []).length;
  }
  return (tags || []).some((g) => fieldHit(g, w));
});

/** The text a bare word searches. */
export function taskBlob(t) {
  return fold([t.title, t.note, t.owner, t.client, t.market, t.status].join('  '));
}
export function ticketBlob(t) {
  return fold([t.subject, t.client, t.from, t.status, t.by, t.origin].join('  '));
}

function numOk(t, q) {
  for (const b of q.num) {
    if (b.k === 'min' && t.hours < b.v) return false;
    if (b.k === 'max' && t.hours > b.v) return false;
  }
  return true;
}

export function matchTask(t, q) {
  const blob = taskBlob(t);
  // every group must hit (AND); any one alternative in it will do (OR). Negation is the mirror:
  // -a,b excludes a row carrying EITHER, which is what "not these two" means.
  for (const g of q.text) if (!g.some((w) => blob.indexOf(w) >= 0)) return false;
  for (const g of q.neg) if (g.some((w) => blob.indexOf(w) >= 0)) return false;
  const f = q.f, nf = q.nf;
  if (f.owner && !anyHit(t.owner, f.owner)) return false;
  if (f.client && !anyHit(t.client, f.client)) return false;
  if (f.market && !anyHit(t.market, f.market)) return false;
  if (f.am && !anyHit(t.am, f.am)) return false;
  if (f.cat && !anyHit(t.cat, f.cat)) return false;
  if (f.tag && !tagHit(t.tags, f.tag)) return false;
  if (f.status && !(anyHit(t.status, f.status) || anyHit(t.bucket, f.status))) return false;
  if (f.month && !f.month.some((m) => monthOf(t.d) === m)) return false;
  if (f.bill) {
    // bill:yes = this row carries charged time; bill:no = it carries time we did not charge.
    // A row can be both (part billed, part not) — it answers to both, which is the truth.
    const want = f.bill[f.bill.length - 1];
    if (want === 'yes' && !(t.bill > 0)) return false;
    if (want === 'no' && !(t.nonbill > 0)) return false;
  }
  if (f.from && !(t.d && t.d >= f.from[0])) return false;
  if (f.to && !(t.d && t.d <= (f.to[0].length === 7 ? f.to[0] + '-31' : f.to[0]))) return false;
  if (nf.owner && anyHit(t.owner, nf.owner)) return false;
  if (nf.client && anyHit(t.client, nf.client)) return false;
  if (nf.market && anyHit(t.market, nf.market)) return false;
  if (nf.cat && anyHit(t.cat, nf.cat)) return false;
  if (nf.tag && tagHit(t.tags, nf.tag)) return false;
  if (nf.status && (anyHit(t.status, nf.status) || anyHit(t.bucket, nf.status))) return false;
  if (!numOk(t, q)) return false;
  return true;
}

export function matchTicket(t, q) {
  const blob = ticketBlob(t);
  // every group must hit (AND); any one alternative in it will do (OR). Negation is the mirror:
  // -a,b excludes a row carrying EITHER, which is what "not these two" means.
  for (const g of q.text) if (!g.some((w) => blob.indexOf(w) >= 0)) return false;
  for (const g of q.neg) if (g.some((w) => blob.indexOf(w) >= 0)) return false;
  const f = q.f, nf = q.nf;
  if (f.client && !anyHit(t.client, f.client)) return false;
  if (f.am && !anyHit(t.am, f.am)) return false;
  if (f.status && !anyHit(t.status, f.status)) return false;
  if (f.month && !f.month.some((m) => monthOf(t.d) === m)) return false;
  if (f.from && !(t.d && t.d >= f.from[0])) return false;
  if (f.to && !(t.d && t.d <= (f.to[0].length === 7 ? f.to[0] + '-31' : f.to[0]))) return false;
  if (nf.client && anyHit(t.client, nf.client)) return false;
  if (nf.status && anyHit(t.status, nf.status)) return false;
  // owner/market/cat/bill are task dimensions; a ticket query carrying one simply has no
  // tickets to offer rather than silently ignoring the filter.
  if (f.owner || f.market || f.cat || f.bill || f.tag) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------------------------

/** Headline numbers for a set of task rows. */
export function summarise(rows) {
  const s = {
    n: rows.length, hours: 0, bill: 0, nonbill: 0, billPct: 0,
    cats: {}, buckets: {}, owners: 0, clients: 0, markets: 0, months: 0,
    first: '', last: '', undated: 0,
  };
  CATS.forEach((c) => { s.cats[c] = 0; });
  const ow = new Set(), cl = new Set(), mk = new Set(), mo = new Set();
  for (const t of rows) {
    s.hours += t.hours; s.bill += t.bill; s.nonbill += t.nonbill;
    s.cats[t.cat] = r2((s.cats[t.cat] || 0) + t.hours);
    s.buckets[t.bucket] = (s.buckets[t.bucket] || 0) + 1;
    if (t.owner) ow.add(t.owner);
    if (t.client) cl.add(t.client);
    if (t.client && t.market) mk.add(t.client + '|' + t.market);
    if (t.d) {
      mo.add(t.d.slice(0, 7));
      if (!s.first || t.d < s.first) s.first = t.d;
      if (!s.last || t.d > s.last) s.last = t.d;
    } else s.undated++;
  }
  s.hours = r2(s.hours); s.bill = r2(s.bill); s.nonbill = r2(s.nonbill);
  s.billPct = s.hours ? Math.round((s.bill / s.hours) * 1000) / 10 : 0;
  s.owners = ow.size; s.clients = cl.size; s.markets = mk.size; s.months = mo.size;
  return s;
}

// ---------------------------------------------------------------------------------------------
// TAGS — what forced the work, which is not what the work was
//
// Ray, 17 Sep 2026: "there will be a tagging system, a labeling system of which task is urgent,
// which task is from agency work, and which task is technical … the goal is to highlight how many
// hours are spent on urgent stuff that should have been spent on optimisation."
//
// This is a SECOND AXIS, deliberately not folded into `cat`. `cat` is derived from the title and
// answers WHAT THE WORK WAS (optimisation, a technical fix, set-up, account admin). A tag is a
// human's judgement about WHY IT HAPPENED and whether it should have. The two are independent:
// an urgent job can be optimisation work, and most reactive work classifies as something useful —
// which is exactly why the displacement never shows up in `cat` alone and needs its own axis.
//
// Checked against the real book before building this (Reiss GB, 1,200 rows): `priority` is the
// constant 20 on every row and `task_source` is empty, so the database does NOT already carry
// urgency. Nothing here duplicates a field that exists.
//
// KEYED ON THE TASK'S OWN list_id, never on its wording. The rotation re-reads each market about
// twice a day and re-packs every row, so a tag keyed on a title would come unstuck the first time
// anyone edited one. A row that arrives WITHOUT an id cannot be tagged — taggable() says so and
// the page shows it as such, rather than keying on something that drifts.

/** The tags a fresh FCC starts with — Ray's three. Everything else is added in the page. */
// The colours are the repo's VALIDATED categorical set (the one the Deck Generator charts use),
// in an order checked with the dataviz validator against BOTH surfaces — the first pick was two
// hues apart by ΔE 0.4 under deuteranopia, and they were Agency and Technical: Ray's two
// non-urgent tags, side by side on the same row, indistinguishable to a red-green colourblind
// reader. Urgent keeps the red because that one hue is carrying meaning.
export const TAG_PAL = ['#e34948', '#4a3aa7', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#2a78d6', '#eb6834'];
export const TAG_PAL_DARK = ['#e66767', '#9085e9', '#199e70', '#c98500', '#d55181', '#008300', '#3987e5', '#d95926'];

export const TAG_SEED = [
  { slug: 'urgent', label: 'Urgent', color: TAG_PAL[0], displaces: true,
    note: 'Dropped on us and done now. These are the hours the optimisation plan lost.' },
  { slug: 'agency', label: 'Agency work', color: TAG_PAL[1], displaces: false,
    note: 'Asked for by the agency rather than the client or our own plan.' },
  { slug: 'technical', label: 'Technical', color: TAG_PAL[2], displaces: false,
    note: 'Something broke or needed engineering, as opposed to optimising what works.' },
];

/** The dark-surface step for a light-surface tag colour (the validator wants its own steps). */
export function tagDark(hex) {
  const i = TAG_PAL.indexOf(String(hex || '').toLowerCase());
  return i >= 0 ? TAG_PAL_DARK[i] : hex;
}

export function normTagSlug(s) {
  return String(s == null ? '' : s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

/** A row can only carry a tag if the source gave it a stable id. */
export function taggable(t) { return !!(t && t.id); }

/**
 * Does one keyword rule match this task?
 *
 * Plain case-insensitive substring over the chosen field — the same thing an AM means by "tag
 * everything with 'disapproval' in it". Never a regex from the page: an AM typing `(` would
 * otherwise throw inside the render loop and blank the table.
 */
export function ruleHits(rule, t) {
  const q = String((rule && rule.q) || '').toLowerCase().trim();
  if (!q) return false;
  const on = (rule && rule.on) || 'title';
  const hay = (on === 'note' ? String(t.note || '')
    : on === 'both' ? String(t.title || '') + '  ' + String(t.note || '')
      : String(t.title || '')).toLowerCase();
  return hay.indexOf(q) >= 0;
}

/**
 * This task's tags, and where they came from.
 *
 * A HUMAN ALWAYS WINS. If someone has set this task's tags, that record IS the answer — including
 * an empty list, which means "I looked, and none of these apply". Without that rule a keyword rule
 * would re-apply its tag every render and a person could never take one off; the tag they removed
 * would silently come back and they would stop trusting the whole column.
 */
export function tagsOf(t, assign, rules) {
  const rec = assign && taggable(t) ? assign[String(t.id)] : null;   // see typeOf: id 0 is no id
  if (rec && Array.isArray(rec.tags)) return { tags: rec.tags.slice(), src: 'manual' };
  const out = [];
  for (const r of (rules || [])) {
    const slug = normTagSlug(r && r.tag);
    if (slug && out.indexOf(slug) < 0 && ruleHits(r, t)) out.push(slug);
  }
  return { tags: out, src: out.length ? 'rule' : 'none' };
}

/**
 * A HAND-SET TYPE, and why it cannot live on the record (Ray, 17 Sep 2026).
 *
 * `cat` is derived — classifyTask(title) in normTask — and packed into the KV row, so the 2x-daily
 * rotation re-derives it every time. Anything written onto the record is overwritten by the next
 * pull. The override therefore lives in its own store keyed on the task's list_id and is applied
 * AFTER unpack, which is the same shape the tags use and the only shape that survives the sync.
 *
 * IT DOES NOT FOLLOW A TAG, deliberately. Tagging something "technical" must not set its Type to
 * Technical fixes: Type is what the work WAS and a tag is why it happened, and the displacement
 * figure compares one against the other. Wire them together and the comparison measures itself —
 * urgent-tagged work would stop counting as optimisation by construction.
 *
 * THE TITLE IT WAS JUDGED AGAINST travels with it. If someone renames the task in the reports
 * database the override still applies (it is keyed on the id, not the wording) but is marked
 * STALE, because the rename may mean the work changed. Dropping it silently loses a judgement;
 * keeping it silently hides that it was made about something else. Flagging it does neither.
 */
export function typeOf(t, over) {
  // taggable(), NOT `id != null`: a row whose id is 0 has no id, and every such row would
  // otherwise share the key '0' — one override would leak onto all of them
  const rec = over && taggable(t) ? over[String(t.id)] : null;
  if (!rec || !rec.cat || CATS.indexOf(rec.cat) < 0) return { cat: t.cat, src: 'auto', stale: false };
  const was = String(rec.t == null ? '' : rec.t);
  return {
    cat: rec.cat, src: 'manual', auto: t.cat,
    stale: !!was && was !== String(t.title || ''), wasTitle: was,
  };
}

/**
 * Apply the overrides in place. `cat` is read by the search (`cat:`), every grouping, the chart and
 * the displacement headline — so overriding the field ITSELF, rather than teaching each reader
 * about overrides, is what keeps all of them telling one story.
 */
export function decorateTypes(rows, over) {
  for (const t of (rows || [])) {
    const r = typeOf(t, over);
    t.catAuto = r.src === 'manual' ? r.auto : t.cat;
    t.cat = r.cat;
    t.catSrc = r.src;
    t.catStale = r.stale;
  }
  return rows;
}

/** Stamp `tags`/`tagSrc` onto rows so the search, the chart and the table all read one answer. */
export function decorateTags(rows, assign, rules) {
  for (const t of (rows || [])) {
    const r = tagsOf(t, assign, rules);
    t.tags = r.tags; t.tagSrc = r.src;
  }
  return rows;
}

/**
 * THE HEADLINE Ray asked for: how much of this book went to work that displaced the plan.
 *
 * `displaced` is the hours carrying any tag flagged `displaces` (seeded: Urgent). It is set
 * against `opt` — the hours whose *work* classified as optimisation — because that is the thing
 * being crowded out, and `cat` already computes it from the title with no extra judgement needed.
 *
 * THE UNTAGGED SHARE TRAVELS WITH IT, always. A book that is 4% tagged would otherwise report
 * "2.1h urgent" and read like good news, when the honest reading is "2.1h of the 6% we have
 * looked at". Nothing here treats untagged as "not urgent" — untagged is UNKNOWN.
 */
export function displacement(rows, defs) {
  const disp = {};
  for (const d of (defs || [])) if (d && d.displaces) disp[normTagSlug(d.slug)] = 1;
  const o = {
    hours: 0, n: 0, dispHours: 0, dispBill: 0, dispNonbill: 0, dispN: 0,
    optHours: 0, optN: 0, taggedHours: 0, taggedN: 0, untaggedHours: 0, untaggedN: 0,
    pct: 0, coverage: 0, ratio: 0, byTag: {},
  };
  for (const t of (rows || [])) {
    const tags = (t && t.tags) || [];
    o.hours += t.hours; o.n++;
    if (tags.length) { o.taggedHours += t.hours; o.taggedN++; } else { o.untaggedHours += t.hours; o.untaggedN++; }
    if (t.cat === 'opt') { o.optHours += t.hours; o.optN++; }
    let isDisp = false;
    for (const g of tags) {
      const k = normTagSlug(g);
      const b = o.byTag[k] || (o.byTag[k] = { hours: 0, n: 0, bill: 0, nonbill: 0 });
      b.hours += t.hours; b.n++; b.bill += t.bill; b.nonbill += t.nonbill;
      if (disp[k]) isDisp = true;
    }
    if (isDisp) { o.dispHours += t.hours; o.dispBill += t.bill; o.dispNonbill += t.nonbill; o.dispN++; }
  }
  o.hours = r2(o.hours); o.dispHours = r2(o.dispHours); o.dispBill = r2(o.dispBill);
  o.dispNonbill = r2(o.dispNonbill); o.optHours = r2(o.optHours);
  o.taggedHours = r2(o.taggedHours); o.untaggedHours = r2(o.untaggedHours);
  for (const k of Object.keys(o.byTag)) {
    const b = o.byTag[k];
    b.hours = r2(b.hours); b.bill = r2(b.bill); b.nonbill = r2(b.nonbill);
  }
  // share of the WHOLE book, and how much of the book has been judged at all
  o.pct = o.hours ? Math.round((o.dispHours / o.hours) * 1000) / 10 : 0;
  o.coverage = o.hours ? Math.round((o.taggedHours / o.hours) * 1000) / 10 : 0;
  o.ratio = o.optHours ? Math.round((o.dispHours / o.optHours) * 100) / 100 : 0;
  return o;
}

/** Rows a rule would newly touch — what the rule builder previews before anything is saved. */
export function rulePreview(rows, rule, assign) {
  let hits = 0, held = 0, hours = 0;
  for (const t of (rows || [])) {
    if (!ruleHits(rule, t)) continue;
    hits++;
    const rec = assign && taggable(t) ? assign[String(t.id)] : null;
    if (rec && Array.isArray(rec.tags)) held++;            // a human already decided this one
    else hours += t.hours;
  }
  return { hits: hits, held: held, hours: r2(hours) };
}

// The dimensions the chart and the breakdown panels can split by. `total` is the single-bucket
// case — that is the donut.
export const DIMS = [
  { k: 'total', label: 'Everything' },
  { k: 'client', label: 'Client' },
  { k: 'owner', label: 'Who did it' },
  { k: 'cat', label: 'Type of work' },
  { k: 'month', label: 'Month' },
  { k: 'market', label: 'Market' },
  { k: 'am', label: 'Account manager' },
  { k: 'bucket', label: 'Status' },
  { k: 'task', label: 'Task' },
  { k: 'tag', label: 'Tag' },
];

function dimKey(t, dim) {
  if (dim === 'total') return 'All work';
  if (dim === 'month') return monthOf(t.d) || '(undated)';
  if (dim === 'cat') return t.cat;
  if (dim === 'market') return (t.client && t.market) ? t.client + ' ' + t.market : (t.market || '(none)');
  if (dim === 'task') return t.title || '(untitled)';
  return t[dim] || '(none)';
}

/**
 * The buckets one task falls in. Every dimension but `tag` puts a task in exactly one — a task has
 * one owner, one month, one client. TAGS ARE THE EXCEPTION: a job can be both urgent and technical,
 * and forcing a primary tag would quietly drop the second fact the person recorded.
 *
 * So a multi-tagged task lands in EVERY one of its buckets, its hours counted in each. The bucket
 * hours therefore sum to more than the book, and groupBy reports that as `multi` so the surface
 * reading it can say so. Silently double-counted hours under a chart titled "hours" is the kind of
 * number someone takes into a client conversation.
 */
function dimKeys(t, dim) {
  if (dim !== 'tag') return [dimKey(t, dim)];
  const tags = (t && t.tags) || [];
  return tags.length ? tags.slice() : ['(untagged)'];
}

/**
 * Split rows by one dimension into billable / non-billable hour pairs, biggest first.
 * `cap` folds the tail into one honest "Other (N more)" row rather than hiding it — a chart
 * that drops its tail overstates every bar left standing.
 */
/**
 * A SECOND AND THIRD SPLIT, nested (Ray, 17 Sep 2026: "allow secondary and tertiary axis split as
 * well, so you can see more granular breakdown, almost like AdWord campaigns").
 *
 * AdWords nests ROWS — Campaign → Ad group → Keyword — and keeps the metrics in the columns. That
 * is the shape copied here, and it decides the one thing that could have gone wrong: the extra
 * dimensions nest the rows, they do NOT become the series. Colour already means billable vs
 * non-billable on every surface of this module; handing level 2 a colour ramp would overload the
 * one encoding the whole chart is about. So every node, at every depth, still carries its own
 * billable/non-billable split.
 *
 * CAPS PER LEVEL, because the cross product is what kills a view like this: client × owner × task
 * is thousands of rows, and a chart that renders them all is unreadable before it is slow. Each
 * level keeps its biggest and folds the rest into one honest "Other (N more)" node — which keeps
 * ITS OWN CHILDREN, so drilling into Other is still truthful.
 *
 * CHILDREN DO NOT ALWAYS SUM TO THEIR PARENT, and that is not a bug to paper over: `tag` is
 * multi-valued (a task can be urgent AND technical), so nesting through it places one task in
 * several children. `multi` rides on the tree so the surface can say so.
 */
export const NEST_CAPS = [12, 8, 6];

function tally(rows) {
  let bill = 0, nonbill = 0, hours = 0;
  for (const t of rows) { bill += t.bill; nonbill += t.nonbill; hours += t.hours; }
  return {
    n: rows.length, bill: r2(bill), nonbill: r2(nonbill), hours: r2(hours),
    billPct: hours ? Math.round((bill / hours) * 1000) / 10 : 0,
  };
}

/** One level: bucket the rows by `dim`, biggest first, the tail folded into one node. */
function nodesAt(rows, dim, cap) {
  const m = new Map();
  let placements = 0;
  for (const t of rows) {
    for (const k of dimKeys(t, dim)) {
      placements++;
      let b = m.get(k);
      if (!b) { b = { k, rows: [] }; m.set(k, b); }
      b.rows.push(t);
    }
  }
  let out = [...m.values()].map((b) => Object.assign(tally(b.rows), { k: b.k, rows: b.rows }));
  if (dim === 'month') out.sort((a, b) => String(a.k).localeCompare(String(b.k)));
  else out.sort((a, b) => (b.hours - a.hours) || (b.n - a.n) || String(a.k).localeCompare(String(b.k)));
  if (cap && out.length > cap && dim !== 'month') {
    const keep = out.slice(0, cap - 1), rest = out.slice(cap - 1);
    // the fold keeps the folded rows, so its own children stay real rather than a dead end
    const rws = [];
    for (const x of rest) for (const t of x.rows) rws.push(t);
    keep.push(Object.assign(tally(rws), {
      k: 'Other (' + rest.length + ' more)', rows: rws, fold: rest.length,
    }));
    out = keep;
  }
  return { nodes: out, placements };
}

/**
 * The tree. `dims` is 1–3 dimension keys; 'total' and blanks are ignored, and a dimension repeated
 * at a deeper level is dropped (splitting owner within owner yields one child per parent and says
 * nothing).
 */
export function groupNested(rows, dims, caps) {
  const use = [];
  for (const d of (dims || [])) {
    if (!d || d === 'total' || use.indexOf(d) >= 0) continue;
    use.push(d);
    if (use.length === 3) break;
  }
  if (!use.length) return Object.assign([], { dims: [], multi: false, folded: 0 });
  const cap = caps || NEST_CAPS;
  let multi = false, folded = 0;

  const build = (rws, depth) => {
    const { nodes, placements } = nodesAt(rws, use[depth], cap[depth] || 0);
    if (placements > rws.length) multi = true;
    for (const nd of nodes) {
      if (nd.fold) folded += nd.fold;
      nd.depth = depth;
      nd.kids = depth + 1 < use.length ? build(nd.rows, depth + 1) : [];
      delete nd.rows;                       // the tree is read, not carried around
    }
    return nodes;
  };
  const tree = build(rows, 0);
  return Object.assign(tree, { dims: use, multi, folded });
}

/** The tree flattened for a table or an export: one row per node, parents before their children. */
export function flattenNested(tree, out, trail) {
  out = out || []; trail = trail || [];
  for (const nd of (tree || [])) {
    const path = trail.concat([nd.k]);
    out.push({
      k: nd.k, path, depth: nd.depth || 0, n: nd.n, bill: nd.bill, nonbill: nd.nonbill,
      hours: nd.hours, billPct: nd.billPct, fold: nd.fold || 0, leaf: !(nd.kids && nd.kids.length),
    });
    if (nd.kids && nd.kids.length) flattenNested(nd.kids, out, path);
  }
  return out;
}

/* MONTH x CATEGORY, for the line form (Ray, 17 Sep 2026: "I like pie charts, donut charts, and
   line charts … merge the lines together and dissect them more easily side by side").

   A line needs an ORDERED x, and month is the only ordered dimension in this book — so the line
   form always reads months across the bottom and puts the chosen split in the SERIES. That makes
   it the one form here where colour means IDENTITY rather than billable vs non-billable, which is
   why the page says so in the legend and every point keeps its own billable split in the tooltip:
   the module's rule is that the two never MERGE, not that they must always be the colours.

   UNDATED ROWS ARE NOT PLOTTED, and are counted back. A task with no date has no place on a time
   axis, and dropping it silently would leave the lines summing to less than the book with nothing
   on screen saying why.

   A MONTH A SERIES MISSED IS A ZERO, NOT A GAP. The months come from the whole view, so every
   series is read against the same x — two lines with different gaps would otherwise read as the
   same shape at different speeds. */
export function seriesByMonth(rows, dim, cap = 6) {
  const months = new Set();
  const byKey = new Map();
  let undated = 0, placements = 0, dated = 0;
  for (const t of rows) {
    const m = monthOf(t.d);
    if (!m) { undated++; continue; }
    dated++;
    months.add(m);
    for (const k of dimKeys(t, dim)) {
      placements++;
      let s = byKey.get(k);
      if (!s) { s = { k, hours: 0, bill: 0, nonbill: 0, n: 0, pts: new Map() }; byKey.set(k, s); }
      s.hours += t.hours; s.bill += t.bill; s.nonbill += t.nonbill; s.n++;
      let p = s.pts.get(m);
      if (!p) { p = { hours: 0, bill: 0, nonbill: 0, n: 0 }; s.pts.set(m, p); }
      p.hours += t.hours; p.bill += t.bill; p.nonbill += t.nonbill; p.n++;
    }
  }
  const ms = [...months].sort();
  let all = [...byKey.values()]
    .sort((a, b) => (b.hours - a.hours) || (b.n - a.n) || String(a.k).localeCompare(String(b.k)));
  let folded = 0;
  // the tail folds into ONE line rather than being dropped — the same rule the bars follow, so a
  // total read off the lines still matches the total read off the columns
  if (cap && all.length > cap) {
    const keep = all.slice(0, cap - 1), rest = all.slice(cap - 1);
    folded = rest.length;
    const o = { k: `Other (${rest.length} more)`, hours: 0, bill: 0, nonbill: 0, n: 0, pts: new Map(), fold: rest.length };
    for (const s of rest) {
      o.hours += s.hours; o.bill += s.bill; o.nonbill += s.nonbill; o.n += s.n;
      for (const [m, p] of s.pts) {
        let q = o.pts.get(m);
        if (!q) { q = { hours: 0, bill: 0, nonbill: 0, n: 0 }; o.pts.set(m, q); }
        q.hours += p.hours; q.bill += p.bill; q.nonbill += p.nonbill; q.n += p.n;
      }
    }
    all = keep.concat([o]);
  }
  const series = all.map((s) => ({
    k: s.k, hours: r2(s.hours), bill: r2(s.bill), nonbill: r2(s.nonbill), n: s.n, fold: s.fold || 0,
    billPct: s.hours ? Math.round((s.bill / s.hours) * 1000) / 10 : 0,
    points: ms.map((m) => {
      const p = s.pts.get(m);
      return p
        ? { m, hours: r2(p.hours), bill: r2(p.bill), nonbill: r2(p.nonbill), n: p.n }
        : { m, hours: 0, bill: 0, nonbill: 0, n: 0 };
    }),
  }));
  return { months: ms, series, undated, folded, multi: placements > dated, placements };
}

export function groupBy(rows, dim, cap) {
  const m = new Map();
  let placements = 0;
  for (const t of rows) {
    for (const k of dimKeys(t, dim)) {
      placements++;
      let g = m.get(k);
      if (!g) { g = { k, n: 0, bill: 0, nonbill: 0, hours: 0 }; m.set(k, g); }
      g.n++; g.bill += t.bill; g.nonbill += t.nonbill; g.hours += t.hours;
    }
  }
  let out = [...m.values()].map((g) => ({
    k: g.k, n: g.n, bill: r2(g.bill), nonbill: r2(g.nonbill), hours: r2(g.hours),
    billPct: g.hours ? Math.round((g.bill / g.hours) * 1000) / 10 : 0,
  }));
  // months read in time order; everything else reads biggest-first
  if (dim === 'month') out.sort((a, b) => String(a.k).localeCompare(String(b.k)));
  else out.sort((a, b) => (b.hours - a.hours) || (b.n - a.n) || String(a.k).localeCompare(String(b.k)));
  // a tag dimension can place one task in several buckets, so the bucket hours legitimately sum
  // to more than the book. Say so rather than letting a chart imply otherwise.
  out.multi = placements > rows.length;
  out.placements = placements;
  if (cap && out.length > cap && dim !== 'month') {
    const keep = out.slice(0, cap - 1), rest = out.slice(cap - 1);
    const fold0 = rest.reduce((s, x) => ({
      n: s.n + x.n, bill: s.bill + x.bill, nonbill: s.nonbill + x.nonbill, hours: s.hours + x.hours,
    }), { n: 0, bill: 0, nonbill: 0, hours: 0 });
    keep.push({
      k: 'Other (' + rest.length + ' more)', n: fold0.n, bill: r2(fold0.bill),
      nonbill: r2(fold0.nonbill), hours: r2(fold0.hours),
      billPct: fold0.hours ? Math.round((fold0.bill / fold0.hours) * 1000) / 10 : 0, fold: rest.length,
    });
    out = keep;
  }
  return out;
}

/** Plain-English read of a billable share, so the chart states its own conclusion. */
export function billVerdict(billPct) {
  if (billPct >= 85) return 'Almost everything delivered here was charged for.';
  if (billPct >= 70) return 'Most of this effort was charged for.';
  if (billPct >= 55) return 'A meaningful slice of this effort went unbilled.';
  if (billPct >= 40) return 'Close to half of this effort was never charged for.';
  return 'Most of this effort was delivered without being charged for.';
}

// ---------------------------------------------------------------------------------------------
// tickets
// ---------------------------------------------------------------------------------------------

// Ticket states as the source system spells them. 'ignored' is the queue's word for a thread
// nobody closed and nobody is working — it is reported as its own state rather than folded into
// open or closed, because which of those it really is is exactly the question an AM has.
export const TICKET_LIVE = ['open', 'reopened'];

export function ticketStats(rows) {
  const s = { n: rows.length, live: 0, closed: 0, ignored: 0, hours: 0, tasks: 0, msgs: 0,
    stale: 0, byStatus: {}, oldest: 0 };
  for (const t of rows) {
    s.byStatus[t.status] = (s.byStatus[t.status] || 0) + 1;
    if (TICKET_LIVE.indexOf(t.status) >= 0) s.live++;
    else if (t.status === 'closed') s.closed++;
    else if (t.status === 'ignored') s.ignored++;
    s.hours += t.hours; s.tasks += t.tasks; s.msgs += t.msgs;
    if (t.idle >= 30 && TICKET_LIVE.indexOf(t.status) >= 0) s.stale++;
    if (t.idle > s.oldest) s.oldest = t.idle;
  }
  s.hours = r2(s.hours);
  return s;
}

// ---------------------------------------------------------------------------------------------
// roster
// ---------------------------------------------------------------------------------------------

/** Hours balance health, in the source system's own words plus ours. */
export function balanceState(allowance, balance) {
  if (balance < 0) return 'over';
  if (allowance > 0 && balance > allowance * 2) return 'banked';
  return 'ok';
}

// ---------------------------------------------------------------------------------------------
// THE BOOK STORE — what the worker's tmBookPull writes into KV, and what /api/taskmanager serves
// ---------------------------------------------------------------------------------------------

export const BOOK_MONTHS = 12;      // the window the module reads
export const BOOK_PULL_LIMIT = 1600; // rows per get_task_list_for_client — deep enough for a busy market
export const BOOK_MARKETS = 2;      // markets read per cron firing (the whole book turns over ~2×/day)
export const BOOK_QUEUES = 1;       // ticket queues read per cron firing
export const BOOK_ROW_CAP = 1200;   // rows kept per market — a guard, not a normal limit

/** The 12-month window, ending today. */
export function bookWindow(now, months) {
  const d = new Date(now || Date.now());
  const to = d.toISOString().slice(0, 10);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - ((months || BOOK_MONTHS) - 1));
  return { from: d.toISOString().slice(0, 10), to };
}

// A stored row. Strings are inline rather than dictionary-encoded: the dictionary existed only to
// shrink a committed file, and there is no committed file — KV has room, and a flat row is one
// less thing that can be wrong when a market is written by one firing and read by another.
//   [ day, owner, title, status, catIndex, billQ, nonbillQ, schedQ, listId, ticketId, note ]
// Hours are quarter-hours (×4) because that is the granularity the source books in, so they stay
// exact integers instead of accumulating float dust across four thousand rows.
export function packRow(t) {
  const a = [t.d, t.owner, t.title, t.status, CATS.indexOf(t.cat),
    Math.round(t.bill * 4), Math.round(t.nonbill * 4), Math.round(t.sched * 4),
    t.id, t.ticket, t.note];
  while (a.length && (a[a.length - 1] === '' || a[a.length - 1] === 0)) a.pop();
  return a;
}
export function unpackRow(a, client, market, am) {
  const bill = (a[5] || 0) / 4, nb = (a[6] || 0) / 4;
  return { d: a[0] || '', client: client, market: market, am: am || '',
    owner: a[1] || '', title: a[2] || '', status: a[3] || '',
    cat: CATS[a[4]] || 'other', bucket: bucketOf(a[3] || ''),
    bill: bill, nonbill: nb, hours: Math.round((bill + nb) * 100) / 100,
    sched: (a[7] || 0) / 4, id: a[8] || 0, ticket: a[9] || 0, note: a[10] || '' };
}

/**
 * One market's pull → the record KV keeps.
 *
 * TWO TRAPS IN THE SOURCE, handled here rather than trusted:
 *  - `from_date` is NOT applied by the server (verified 16 Sep 2026: a task list asked for
 *    2026-07-01 came back with February rows). The window is applied HERE.
 *  - Pulls are newest-first and capped by `limit`, so a market whose deepest row starts AFTER the
 *    window opens did not reach back far enough. That is recorded as `full: false` and the page
 *    says so, rather than a part-year being read as a whole one.
 */
export function packMarket(rows, meta, win, now) {
  const all = (Array.isArray(rows) ? rows : []).map((r) => normTask(r, meta));
  const dated = all.map((t) => t.d).filter(Boolean).sort();
  const deepest = dated[0] || '';
  const inWin = all.filter((t) => t.d && t.d >= win.from && t.d <= win.to);
  const kept = inWin.slice(0, BOOK_ROW_CAP);
  let bill = 0, nonbill = 0;
  kept.forEach((t) => { bill += t.bill; nonbill += t.nonbill; });
  return {
    cid: meta.cid || 0, am: meta.am || '', at: now || Date.now(),
    from: win.from, to: win.to, deepest: deepest,
    // truncated === the pull did not reach the window start, so this market is PARTIAL
    full: !deepest || deepest <= win.from,
    pulled: all.length, n: kept.length, capped: inWin.length > kept.length,
    bill: Math.round(bill * 100) / 100, nonbill: Math.round(nonbill * 100) / 100,
    rows: kept.map(packRow),
  };
}

/** One ticket queue's pull → the record KV keeps. Windowed by LAST ACTIVITY, like the tasks. */
export function packQueue(rows, client, win, now) {
  const all = (Array.isArray(rows) ? rows : []).map(normTicket);
  const inWin = all.filter((t) => t.d && t.d >= win.from && t.d <= win.to);
  const dated = all.map((t) => t.d).filter(Boolean).sort();
  return {
    client: client, at: now || Date.now(), from: win.from, to: win.to,
    pulled: all.length, n: inWin.length, deepest: dated[0] || '',
    rows: inWin.slice(0, 600).map((t) => [t.id, t.subject, t.status, t.d, t.first, t.by,
      t.origin, t.from, t.age, t.level, t.idle, t.msgs, t.tasks, Math.round(t.hours * 4)]),
  };
}
export function unpackTicket(a, client, am) {
  return { id: a[0], client: client, subject: a[1] || '', status: a[2] || '', d: a[3] || '',
    first: a[4] || '', by: a[5] || '', origin: a[6] || '', from: a[7] || '', age: a[8] || 0,
    level: a[9] || '', idle: a[10] || 0, msgs: a[11] || 0, tasks: a[12] || 0,
    hours: (a[13] || 0) / 4, am: am || '' };
}

/**
 * Which markets to read next.
 *
 * STALEST FIRST, and a market never read always leads — otherwise a market at the end of the
 * roster starves behind whichever ones the hot-brief rotation keeps choosing. This is deliberately
 * NOT tmmcp's planPulls: that one weights markets with a brief in flight, because it is chasing
 * hours onto tickets inside a 21-day window. The book wants EVEN coverage of twelve months, so
 * every market gets its turn at the same rate.
 */
export function bookPlan(markets, seen, n, now) {
  const list = (Array.isArray(markets) ? markets : []).filter((m) => m && m.id && m.client);
  const at = (m) => (seen && seen[m.id]) || 0;
  return list.slice().sort((a, b) => (at(a) - at(b)) || (a.id - b.id)).slice(0, Math.max(0, n | 0));
}

/** The same, for the ticket queues (keyed by the queue id, one per client). */
export function queuePlan(queues, seen, n) {
  const list = (Array.isArray(queues) ? queues : []).filter((q) => q && q.tid && q.client);
  const at = (q) => (seen && seen[q.tid]) || 0;
  return list.slice().sort((a, b) => (at(a) - at(b)) || (a.tid - b.tid)).slice(0, Math.max(0, n | 0));
}

/** get_client_list rows → the market roster the book reads, and the queues behind it. */
export function rosterOf(rows) {
  const markets = [], queues = {}, accounts = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || r.client_id == null) return;
    const client = String(r.client_name || r.group_name || '').replace(/\s+/g, ' ').trim();
    if (!client || client.indexOf(':') >= 0 || client.indexOf('|') >= 0) return;
    const market = String(r.country || r.market_name || '').trim().toUpperCase() || '?';
    const a = {
      cid: +r.client_id, tid: +r.ticket_client_id || 0, client: client, market: market,
      name: String(r.market_name || ''), group: String(r.group_name || ''),
      flag: r.market_flag == null ? 0 : +r.market_flag, status: String(r.client_status || ''),
      type: String(r.client_type || ''), am: String(r.primary_am || '').trim(),
      am2: String(r.secondary_am || '').trim(),
      allowance: n2(r.allowance), used: n2(r.used_hours), balance: n2(r.balance),
      health: String(r.balance_health || ''), since: String(r.market_created || '').slice(0, 10),
    };
    accounts.push(a);
    // A market is worth reading when it carries a retainer block or booked hours this cycle.
    // A stopped market with neither has no work to find, and reading it would spend a pull that
    // a live market needs.
    if (a.allowance > 0 || a.used > 0) markets.push({ id: a.cid, client: client, market: market, am: a.am });
    if (a.tid && !queues[a.tid]) queues[a.tid] = { tid: a.tid, client: client };
  });
  return { markets: markets, queues: Object.keys(queues).map((k) => queues[k]), accounts: accounts };
}
function n2(v) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }

/**
 * Every stored market record → the payload the page reads.
 *
 * The reports database spells the same brand two ways depending on which table you ask — the
 * client master says "American Golf" and "YuMove", the ticket queue says "American golf" and
 * "Yumove". Folding case, spacing, accents and punctuation joins them; left unfolded a brand
 * appears twice in every filter and its tickets never meet its tasks.
 */
export function assembleBook(books, queues, accounts, now) {
  const canon = {}, amOf = {};
  (accounts || []).forEach((a) => { if (a.client) { canon[brandKey(a.client)] = a.client; if (a.am) amOf[a.client + '|' + a.market] = a.am; } });
  const name = (n) => canon[brandKey(n)] || String(n || '');
  const rows = [], coverage = [];
  (books || []).forEach((b) => {
    if (!b || !b.markets) return;
    const client = name(b.client);
    Object.keys(b.markets).forEach((mk) => {
      const m = b.markets[mk];
      if (!m) return;
      coverage.push({ client: client, market: mk, cid: m.cid || 0, at: m.at || 0, n: m.n || 0,
        pulled: m.pulled || 0, deepest: m.deepest || '', full: m.full !== false, capped: !!m.capped });
      const am = amOf[client + '|' + mk] || m.am || '';
      (m.rows || []).forEach((r) => rows.push(unpackRow(r, client, mk, am)));
    });
  });
  const tickets = [], tcov = [];
  (queues || []).forEach((q) => {
    if (!q) return;
    const client = name(q.client);
    tcov.push({ client: client, at: q.at || 0, n: q.n || 0, pulled: q.pulled || 0, deepest: q.deepest || '' });
    const am = (accounts || []).filter((a) => a.client === client)[0];
    (q.rows || []).forEach((r) => tickets.push(unpackTicket(r, client, am ? am.am : '')));
  });
  rows.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.id - a.id));
  tickets.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.id - a.id));
  coverage.sort((a, b) => (a.client + a.market < b.client + b.market ? -1 : 1));
  const win = bookWindow(now, BOOK_MONTHS);
  return { from: win.from, to: win.to, months: BOOK_MONTHS, at: now || Date.now(),
    rows: rows, tickets: tickets, accounts: (accounts || []).map((a) => Object.assign({}, a, { client: name(a.client) })),
    coverage: coverage, ticketCoverage: tcov };
}

/** How much of the book has actually been read — the page states this rather than implying it. */
export function bookHealth(coverage, roster, now) {
  const cov = coverage || [], total = (roster && roster.length) || cov.length;
  const at = cov.map((c) => c.at).filter(Boolean).sort();
  const partial = cov.filter((c) => c.full === false).length;
  return { read: cov.length, total: total, partial: partial,
    oldest: at[0] || 0, newest: at[at.length - 1] || 0,
    complete: total > 0 && cov.length >= total,
    staleHours: at[0] ? Math.round(((now || Date.now()) - at[0]) / 36e5) : 0 };
}

// ---------------------------------------------------------------------------------------------
// THE HOURS TRAIL — "the trajectory of the past three months of client activity per hour"
// ---------------------------------------------------------------------------------------------

export const TRAIL_MONTHS = 3;

/** The last N calendar months, oldest first, as 'YYYY-MM'. */
export function trailMonths(now, n) {
  const d = new Date(now || Date.now());
  d.setUTCDate(1);
  const out = [];
  for (let i = (n || TRAIL_MONTHS) - 1; i >= 0; i--) {
    const x = new Date(d.getTime());
    x.setUTCMonth(x.getUTCMonth() - i);
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

/**
 * One client's book → the compact trail the hours popover draws, everywhere in the FCC.
 *
 * Three honesty rules are baked in, because this number is read at the moment an AM decides
 * whether to keep working an account:
 *  - THE CURRENT MONTH IS PARTIAL. It is flagged, not quietly plotted as a completed month —
 *    otherwise every trend reads as a cliff on the 3rd of the month.
 *  - A PARTLY-READ BOOK IS A FLOOR, NOT A TOTAL. `read` / `total` travel with the numbers so
 *    the popover can say "4 of 6 markets" rather than implying the whole account.
 *  - HOURS STAY SPLIT. Billable and non-billable are two numbers here as everywhere else.
 */
export function trailOf(book, total, now, months) {
  const keys = trailMonths(now, months || TRAIL_MONTHS);
  const cur = keys[keys.length - 1];
  const m = {};
  keys.forEach((k) => { m[k] = [0, 0, 0]; });
  let read = 0, at = 0, all = 0;
  const markets = (book && book.markets) || {};
  Object.keys(markets).forEach((mk) => {
    const rec = markets[mk];
    if (!rec) return;
    read++;
    if (rec.at > at) at = rec.at;
    (rec.rows || []).forEach((r) => {
      const day = r[0] || '';
      if (!day) return;
      const key = day.slice(0, 7);
      all += ((r[5] || 0) + (r[6] || 0)) / 4;
      const cell = m[key];
      if (!cell) return;
      cell[0] += r[5] || 0;
      cell[1] += r[6] || 0;
      cell[2] += 1;
    });
  });
  return { m, months: keys, current: cur, read, total: total == null ? read : total,
    at, windowHours: Math.round(all * 100) / 100 };
}

/**
 * Read a trail as hours. Kept beside trailOf so the worker, the harness and the widget cannot
 * disagree about what a quarter-hour integer means.
 */
export function trailRows(trail) {
  const keys = (trail && trail.months) || [];
  return keys.map((k) => {
    const c = (trail.m && trail.m[k]) || [0, 0, 0];
    const bill = (c[0] || 0) / 4, nonbill = (c[1] || 0) / 4;
    return { month: k, bill, nonbill, hours: Math.round((bill + nonbill) * 100) / 100,
      n: c[2] || 0, partial: k === trail.current };
  });
}

// ---------------------------------------------------------------------------------------------
// the verdict an AM actually needs
// ---------------------------------------------------------------------------------------------

// The posture an AM has taken on an account, as opposed to what its balance says. Ray, 16 Sep
// 2026: "there are cases where a client is negative, but because of relationship smoothing, the
// AM may still continue the task." So the badge never says STOP — it says what is true (the
// balance) and what the team decided (the posture), and leaves the call where it belongs.
export const POSTURES = {
  continue: { label: 'Continue', short: 'Continuing', note: 'Work continues regardless of the balance — a deliberate call.' },
  hold: { label: 'Hold new work', short: 'On hold', note: 'No new work until the balance is settled.' },
  watch: { label: 'Just watching', short: 'Watching', note: 'No decision taken — the balance is being watched.' },
};

/**
 * The state the dot shows. `over` is a fact about the balance; it is NOT an instruction, and a
 * posture of `continue` softens it to `served` precisely so a deliberate decision stops looking
 * like an unhandled alarm on every page in the FCC.
 */
export function hoursState(rec) {
  const r = rec || {};
  const posture = (r.posture && r.posture.state) || '';
  const bal = Number(r.balance) || 0;
  const allowance = Number(r.allowance) || 0;
  if (!r.tracked) return 'none';
  if (bal < 0) return posture === 'continue' ? 'served' : (posture === 'hold' ? 'held' : 'over');
  if (allowance > 0 && bal < allowance * 0.25) return 'tight';
  return 'ok';
}

export const STATE_LABEL = {
  none: 'No hours synced',
  ok: 'Within the retainer',
  tight: 'Close to the block',
  over: 'Over the retainer',
  served: 'Over — being served anyway',
  held: 'Over — new work on hold',
};

/** One sentence an AM can act on, balance and decision together. */
export function hoursVerdict(rec) {
  const r = rec || {};
  const st = hoursState(r);
  const bal = Number(r.balance) || 0;
  const h = (n) => (Math.round(Math.abs(n) * 100) / 100).toLocaleString();
  if (st === 'none') return 'No hours have been synced for this client yet.';
  if (st === 'ok') return h(bal) + ' hours left against a ' + h(r.allowance) + '-hour block.';
  if (st === 'tight') return 'Only ' + h(bal) + ' hours left of the ' + h(r.allowance) + '-hour block — the next piece of work will likely take it under.';
  if (st === 'served') return h(bal) + ' hours over, and the team has decided to keep going anyway.';
  if (st === 'held') return h(bal) + ' hours over, and new work is on hold until it is settled.';
  return h(bal) + ' hours over the block — worth a decision before the next task.';
}

/** Is the trail rising, flat or falling? Two complete months are the minimum to say anything. */
export function trailTrend(rows) {
  const done = (rows || []).filter((r) => !r.partial);
  if (done.length < 2) return { dir: 'flat', pct: 0, enough: false };
  const a = done[done.length - 2].hours, b = done[done.length - 1].hours;
  if (!a && !b) return { dir: 'flat', pct: 0, enough: true };
  const pct = a ? Math.round(((b - a) / a) * 100) : 100;
  return { dir: pct > 8 ? 'up' : pct < -8 ? 'down' : 'flat', pct, enough: true };
}
