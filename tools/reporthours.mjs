/*
 * WHERE THE RETAINER WENT — classifying delivered hours (Ray, 16 Sep 2026).
 *
 *   "a pie chart that highlights the importance of technical issue and feature support versus
 *    optimization, and show the hours spent on each task for each client … Most of our clients
 *    should spend most of their retainer time on optimisation instead of technical strategy or
 *    support."
 *
 * Source is the FeedSpark reports database (the sh_merchants task list), which records every
 * task against a client market with the hours actually taken — `time_taken` (billable) and
 * `time_taken_nonbill`. BOTH are real delivered effort: non-billable hours are hours our team
 * spent that the client was not charged for, and leaving them out would understate exactly the
 * thing Ray wants shown. They are summed for the mix and reported apart so the split stays
 * visible.
 *
 * FOUR CATEGORIES, in Ray's own framing:
 *   opt   Optimisation      — work that moves performance: keywords, titles, data fields,
 *                             custom labels, product types, categories, image optimisation
 *   tech  Technical fixes   — something is broken: disapprovals, GMC errors, scraping, feed
 *                             checks, availability/price mismatches
 *   feat  Feature & set-up  — new capability: new feeds and markets, overlays, dev work,
 *                             batch and rule set-up, hosting
 *   acct  Account & support — calls, QBRs, reporting, plan upkeep, inbound client tickets
 *
 * PRECEDENCE IS THE WHOLE GAME. The rules are tried in order and the FIRST match wins, because
 * the obvious keyword is often the wrong one:
 *   - "Project & Optimisation Plan Update" contains "Optimisation" but is plan admin, so the
 *     account rules run BEFORE the optimisation rules.
 *   - "Scraping changes" and "Virtual Products monitoring (scrape)" are plumbing, not content.
 *   - "Batch Report" is reporting; "Batch set-up" is build. One word apart, two categories.
 *   - "Image optimisations" is optimisation; "DPA Image Overlay" is the overlay service.
 * A title that matches nothing is 'other' and is NEVER folded into a category to flatter the
 * mix — an unclassified slice that grows is the signal to extend this table.
 *
 * Pure module: no fetch, no fs. tools/test_reporthours.mjs pins it on real titles.
 */

export const CATS = ['opt', 'tech', 'feat', 'acct', 'other'];
export const CAT_LABEL = {
  opt: 'Optimisation', tech: 'Technical fixes', feat: 'Feature & set-up',
  acct: 'Account & support', other: 'Other',
};

// [pattern, category] — FIRST MATCH WINS, so order is meaning.
export const RULES = [
  // ---- account, reporting and planning -----------------------------------------------------
  // first, because several of these carry the word "optimisation" while being pure admin
  [/\bproject\s*(&|&amp;|and)?\s*(optimisation\s*)?plan\b|\bplan update\b/i, 'acct'],
  [/\bqbr\b|quarterly business review/i, 'acct'],
  // any call, its prep and its wrap-up — the meeting itself is account time whoever booked it
  [/\bcalls?\b|\bcatch ?up\b|\bmeeting\b|\bhuddle\b/i, 'acct'],
  [/general account management|account management|\bam work\b|\bclients? email chase\b/i, 'acct'],
  [/\bbatch report\b|\breport(ing)? analysis\b|weekly product report|\bdata insights\b/i, 'acct'],
  [/^email ticket:|^fw:|^re:|\bdata request\b|\burgent requests?\b/i, 'acct'],
  // decks and slides are the materials we take INTO those meetings. NOT "planner": the word
  // appears in "Reiss' Keyword Planner" and in every brief named "… - Marketing Planner - 0926",
  // which are keyword optimisation, not admin.
  [/\bstrategy\b|\bdecks?\b|\bslides?\b|\bppt\b|year review|\bbilling\b/i, 'acct'],

  // ---- technical: something is broken -------------------------------------------------------
  [/disapprov|\bgmc\b|merchant centre|merchant center|account issue/i, 'tech'],
  [/scrap(e|ing)|virtual products monitoring/i, 'tech'],
  [/urgent feed|feed issue|feeds? (check|review)|\bfeed error/i, 'tech'],
  [/products? (availability|price) check|\bembargo\b|\bshipping\b/i, 'tech'],
  [/duplicate titles fix|irrelevant keywords|mismatch|\binvestigation\b|\bissues?\b/i, 'tech'],

  // ---- feature and set-up: new capability ---------------------------------------------------
  [/\bnew feeds?\b|\bnew markets?\b|market launch|feed hosti?ng|pinterest feed/i, 'feat'],
  [/overlay|image cycler|\bdpa\b|\bppc\b/i, 'feat'],
  [/\bdev work\b|rule setup|rule set-?up|batch set-?up|exclusion setup|exclusion set-?up/i, 'feat'],
  [/\bsetup\b|\bset-?up\b|\bmigration\b|\bhosting\b|\bintegration\b|\bconfiguration\b/i, 'feat'],
  [/\bimport\b|output feed|\bfeed tag\b|\bapi\b/i, 'feat'],

  // ---- optimisation: the work that moves performance ----------------------------------------
  [/keyword|\bkw\b/i, 'opt'],
  [/\btitles?\b|\baot\b|aot\s*titles?|\baotitles?\b/i, 'opt'],
  [/\blabels?\b|\bproduct sets?\b|\bstock\b|\brange\b|search term|\bpromo\b|\bdelivery\b/i, 'opt'],
  [/\banalysis\b|\baudit\b|\bcomparison\b|\bmock-?ups?\b|\bimages?\b/i, 'opt'],
  [/data field|\bdata tagging\b|\bgtin\b|product highlight|\bhighlights?\b/i, 'opt'],
  [/custom label|\bcl\d\b|essentials custom/i, 'opt'],
  [/product type|\bpts?\b\b|category mapping|\bcategor(y|ies)\b|\bgpc\b/i, 'opt'],
  [/optimis|optimiz|\ba\/?b test\b|\bimage (label|testing|optimis)/i, 'opt'],
  [/merchant promotion|\balp\b|competitor|search intent|range completion/i, 'opt'],

  // LAST: a bare "Fixes" with no other clue. It sits here, after the optimisation rules, because
  // "PT Fixes" and "Product Type Fixes" are work on the category tree — putting this any earlier
  // filed a fifth of the product-type effort under Technical fixes and flattered the mix.
  [/\bfix(es|ing|ed)?\b|\bcorrections?\b|\brepair\b/i, 'tech'],
];

/*
 * The reports database and the FCC spell the same brand differently — "Jomalone" against
 * "Jo Malone", "YuMove" against "YuMOVE". Folding case, spacing, accents and punctuation makes
 * both pairs identical, so the dossier resolves its own name against the snapshot without a
 * hand-maintained alias table, and a brand added to the dossier tomorrow needs no rebuild.
 * The page carries a copy of this fold; tools/test_reporthours.mjs pins them to the same answer.
 */
export function brandKey(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

export function classifyTask(title) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'other';
  for (const [re, cat] of RULES) { re.lastIndex = 0; if (re.test(t)) return cat; }
  return 'other';
}

// "Keyword optimisation - 4" is the fourth run of Keyword optimisation, not its own kind of
// work, so runs fold together for the per-task table. The batch number is kept nowhere: what
// the reader wants is "keyword optimisation: 11 runs, 46 hours".
export function taskKey(title) {
  return String(title || '')
    .replace(/&amp;/g, '&')
    .replace(/\s*[-–]\s*\d+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function monthKey(d) {
  const s = String(d || '');
  // the source writes 0000-00-00 for a task that never carried a real date — never guess one
  if (!/^\d{4}-\d{2}/.test(s) || s.slice(0, 4) === '0000') return '';
  return s.slice(0, 7);
}

function blank() { return { opt: 0, tech: 0, feat: 0, acct: 0, other: 0 }; }
const r2 = (n) => Math.round(n * 100) / 100;

/*
 * rows: [{ title, created_on, status, owner, market, bill, nonbill }]
 * opts: { from, to }  — inclusive YYYY-MM-DD bounds. The source ignores its own from_date
 *       parameter (verified 16 Sep 2026: asking for 2026-07-01 returned rows from February),
 *       so the window is applied HERE and nowhere else.
 */
export function aggregate(rows, opts) {
  const o = opts || {};
  const from = o.from || '0000-00-00', to = o.to || '9999-12-31';
  const cats = blank(), billCats = blank();
  const months = {}, tasks = {}, markets = {}, owners = {};
  let n = 0, undated = 0, bill = 0, nonbill = 0, first = '', last = '';

  (rows || []).forEach((r) => {
    const d = String(r.created_on || '').slice(0, 10);
    const mk = monthKey(d);
    if (!mk) { undated++; return; }
    if (d < from || d > to) return;
    const b = Number(r.bill) || 0, nb = Number(r.nonbill) || 0;
    const h = b + nb;
    const cat = classifyTask(r.title);
    n++; bill += b; nonbill += nb;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
    cats[cat] += h; billCats[cat] += b;
    if (!months[mk]) months[mk] = blank();
    months[mk][cat] += h;
    const k = taskKey(r.title);
    if (!tasks[k]) tasks[k] = { t: k, cat, n: 0, h: 0, b: 0, nb: 0 };
    tasks[k].n++; tasks[k].h += h; tasks[k].b += b; tasks[k].nb += nb;
    if (r.market) markets[r.market] = (markets[r.market] || 0) + h;
    if (r.owner) owners[r.owner] = (owners[r.owner] || 0) + h;
  });

  const total = CATS.reduce((s, c) => s + cats[c], 0);
  const mix = {};
  // percentages of the WHOLE, including 'other', so the pie can never add up to more than it is
  CATS.forEach((c) => { mix[c] = total ? r2(cats[c] / total * 100) : 0; });
  CATS.forEach((c) => { cats[c] = r2(cats[c]); billCats[c] = r2(billCats[c]); });
  Object.keys(months).forEach((m) => CATS.forEach((c) => { months[m][c] = r2(months[m][c]); }));

  const taskRows = Object.values(tasks)
    .map((t) => ({ ...t, h: r2(t.h), b: r2(t.b), nb: r2(t.nb) }))
    .filter((t) => t.h > 0)
    .sort((a, b2) => b2.h - a.h || a.t.localeCompare(b2.t));

  return {
    tasks: n, undated, hours: r2(total), bill: r2(bill), nonbill: r2(nonbill),
    cats, billCats, mix, months, taskRows,
    markets: Object.fromEntries(Object.entries(markets).map(([k, v]) => [k, r2(v)])),
    owners: Object.fromEntries(Object.entries(owners).map(([k, v]) => [k, r2(v)])),
    first, last,
  };
}

// The headline the pie exists to deliver: is this account spending its retainer on optimisation?
// Ray's bar is "most of their retainer time", so the verdict is read off the optimisation share
// against the rest, not against an arbitrary target.
export function mixVerdict(mix) {
  const opt = (mix && mix.opt) || 0;
  if (opt >= 50) return { v: 'good', s: 'Optimisation-led' };
  if (opt >= 35) return { v: 'ok', s: 'Balanced' };
  if (opt > 0) return { v: 'warn', s: 'Running on fixes and support' };
  return { v: 'none', s: 'No hours recorded' };
}
