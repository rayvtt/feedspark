/*
 * RULES + STOCK (Ray, 28 Sep 2026: "besides ROAS, let's try to bring other data points from FeedHero
 * reports MCPs as well. For example, 'Rules' … There's a ton of rules for each client of mine, and
 * each rule is intended towards a certain type optimization or a feature setup. I'm most interested
 * in stock management related rules, so can you please try and bring it in and make sense of it? The
 * new module can be called rules and another is stock management - taking into consideration from
 * rules").
 *
 * SOURCE = the FeedHero_reports MCP's `rule_report` tool — the SAME server and the SAME token as
 * ROAS (roas.js), so the roster is ROAS_ROSTER and nothing outside it is pulled, stored or shown.
 * A row is what FeedHero's Rule Manager lists: rule name, target field (label + database name),
 * System/User, batch, runtime, "impacted items" (N of M products), created/modified on/by, status
 * and the issues FeedHero's own cron flagged ("Not impacting any items", "Target column missing",
 * "Dependent column missing"). Rows arrive IN THE ORDER THE RULES RUN, which matters: two rules
 * writing the same field are a chain and the last writer wins.
 *
 * WHAT IT DOES NOT CARRY: a rule's conditions. "Stock < 11 -> OOS" is a rule NAME; the report never
 * says what the rule actually tests. So every reading here is taken from what a rule WRITES (its
 * target field — a machine name, stable) and what its name SAYS (the team's own words), and the
 * page says so. A numeric cut-off is read out of a name only where the name states one, and is
 * always shown next to the name it came from — never presented as the rule's logic.
 *
 * PURE + dependency-free so the worker (rulesPull / /api/rules*), the tripwire stub and the harness
 * (tools/test_rules.mjs) run the same code.
 */

const s0 = (v) => String(v == null ? '' : v);
const r1 = (n) => Math.round(n * 10) / 10;
const DAY = 86400000;

export const RULES_PAGE = 200;          // FeedHero's page_size ceiling
export const RULES_MAX_PAGES = 3;       // 600 rules a market; Reiss GB runs 311 — a capped market says so
export const RULES_PULLS = 8;           // markets per firing: 8 x (≤3 MCP pages + 2 KV) + ~5 ≤ the ~50-subrequest budget
export const RULES_STALE_MS = 20 * 3600000;   // a market's rules are re-read once a day; the :40 firing goes back to ROAS once none is older
export const RULES_MINUTE = 40;         // the half of the 10,40 firing rules may take (the :10 half is always ROAS)

// ---- the rule inside FeedHero (Ray, 28 Sep 2026: "for all rules-related info, can you also add a
// button to pop out to see the actual rule inside FeedHero") ----------------------------------------
// The report hands back no link to the Rule Manager's own editor, and guessing one would send people to
// a page that may not exist. What FeedHero DOES publish is the report's own web view, and the MCP's
// `web_url` states its shape exactly: company=<cmpid> plus f[<column>]=<text> per column filter (every
// filter "contains", form-encoded). So a rule opens as its own row on FeedHero's site — narrowed by
// name AND target field, since a name alone can match a longer sibling — behind FeedHero's own login,
// which sends the reader back to this exact view once signed in. A field alone opens every rule that
// writes it (a chain, in run order); neither opens the market's whole report.
export const FEEDHERO_REPORT = 'https://mcp.feedhero.net/reports/rule-report';
export function feedheroUrl(cmpid, name, field) {
  const q = new URLSearchParams();
  q.set('company', s0(cmpid));
  if (name) q.set('f[rule_name]', s0(name));
  if (field) q.set('f[target_field]', s0(field));   // a field alone = every rule writing it, in run order
  return FEEDHERO_REPORT + '?' + q.toString();
}

// ---- parsing (FeedHero formats everything for display) ------------------------------------------
// "7,849 of 16,979" -> {n, of}; anything else -> nulls (never a guessed zero)
export function parseImpact(v) {
  const m = /^\s*([\d,]+)\s+of\s+([\d,]+)\s*$/.exec(s0(v));
  if (!m) return { n: null, of: null };
  return { n: +m[1].replace(/,/g, ''), of: +m[2].replace(/,/g, '') };
}
// "0.3 sec" / "12.5 secs" / "2 mins" / "1 min 5 secs" / "-" -> seconds or null
export function parseRuntime(v) {
  const s = s0(v).toLowerCase(); let t = 0, hit = false;
  s.replace(/([\d.]+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g, (_, n, u) => {
    hit = true; const x = parseFloat(n) || 0;
    t += /^h/.test(u) ? x * 3600 : /^m/.test(u) ? x * 60 : x; return '';
  });
  return hit ? r1(t) : null;
}
// "19/08/2021 at 12:22 PM" -> epoch ms (read as UTC — the report never states a zone; day precision is what every surface uses)
export function parseWhen(v) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(s0(v));
  if (!m) return null;
  let h = +(m[4] || 0); const mi = +(m[5] || 0), ap = (m[6] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
  const t = Date.UTC(+m[3], +m[2] - 1, +m[1], h, mi);
  return isNaN(t) ? null : t;
}
// FeedHero's own issue strings -> stable codes
export function issueCodes(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((x) => {
    const s = s0(x).toLowerCase();
    if (/not impacting/.test(s)) out.push('none');
    else if (/target column/.test(s)) out.push('target');
    else if (/dependent column/.test(s)) out.push('dep');
    else if (s) out.push('other');
  });
  return out;
}

// ---- one rule, compact (what the index and the page carry) ---------------------------------------
// i = run order within the market (0-based), n name, t target label, d target db name, ty S|U,
// b batch ('' = All products), rt runtime s, imp/of impacted, co/cb created on/by, mo/mb modified
// on/by (mo falls back to co), iss issue codes, fam family, ch channel, sk stock mechanism|null,
// dr drivers, cut cut-offs, tag flags
export function normRule(row, i) {
  row = row || {};
  const n = s0(row.rule_name).trim(), d = s0(row.target_db).trim().toLowerCase(), t = s0(row.target_field).trim() || d;
  const imp = parseImpact(row.impacted_items);
  const co = parseWhen(row.created_on), mo = parseWhen(row.modified_on);
  const b = s0(row.batch_id).trim();
  const r = {
    id: s0(row.rule_id), i: i | 0, n, t, d,
    ty: /system/i.test(s0(row.rule_type)) ? 'S' : 'U',
    b: /^all products$/i.test(b) ? '' : b,
    rt: parseRuntime(row.runtime), imp: imp.n, of: imp.of,
    co, cb: s0(row.created_by).trim(), mo: mo || co, mb: s0(row.modified_by).trim() || s0(row.created_by).trim(),
    iss: issueCodes(row.rule_issues),
  };
  r.fam = family(r); r.ch = channel(r); r.sk = stockKind(r); r.dr = drivers(r); r.cut = cutoffs(r.n); r.tag = tags(r);
  return r;
}

// ---- FAMILY: what a rule is FOR, read off the field it writes ------------------------------------
export const FAMILIES = [
  { k: 'title', label: 'Titles', q: 'Product names, short / social / channel titles and the title-building fields' },
  { k: 'desc', label: 'Descriptions & highlights', q: 'Descriptions, product highlights, product detail and sales-feature copy' },
  { k: 'taxonomy', label: 'Product type & category', q: 'product_type, Google category and the internal category fields' },
  { k: 'attr', label: 'Attributes', q: 'Colour, size, gender, age group, material, pattern, brand, variants' },
  { k: 'ident', label: 'Identifiers', q: 'GTIN, MPN, IDs and item groups' },
  { k: 'labels', label: 'Custom labels & bidding', q: 'Custom labels and numbers every channel buys against' },
  { k: 'price', label: 'Pricing & promotions', q: 'Price, sale price, markdown, promotion IDs, unit pricing' },
  { k: 'stock', label: 'Stock & availability', q: 'Availability, stock quantity, range completion, hero sizes, local inventory, lifecycle' },
  { k: 'excl', label: 'Exclusions', q: 'Which products a feed or destination leaves out' },
  { k: 'media', label: 'Images & overlays', q: 'Image links, overlays, image cycling, video' },
  { k: 'links', label: 'Links & tracking', q: 'Product URLs, parameters, redirects, canonical links' },
  { k: 'kw', label: 'Keywords', q: 'Keyword strings and backup keywords' },
  { k: 'ship', label: 'Shipping', q: 'Delivery country, service and price' },
  { k: 'perf', label: 'Performance & ranking', q: 'Clicks, impressions, bestseller and conversion ranks read into the feed' },
  { k: 'other', label: 'Other', q: 'Everything the classifier cannot place — listed, never hidden' },
];
export function family(r) {
  const d = s0(r.d);
  if (/(^|_)(stock|avail|availability|range|rc|quantity|qty)(_|$)|stock|range_completion|avail_percent|hero_size|older_than|(^|_)pre_\d{4}|pickup/.test(d)) return 'stock';
  if (/exclu|(^|_)exclude|excl_|eligible|destination/.test(d)) return 'excl';
  if (/custom_label|custom_number|(^|_)cl_?\d|_cl\d|(^|_)label|_label|bidding|margin|(^|_)gag$/.test(d)) return 'labels';
  if (/price|(^|_)sale|discount|markdown|promo|unit_pricing|loyalty|display_ads_value|currency/.test(d)) return 'price';
  if (/impression|click|conversion|(^|_)conv(_|$)|bestsell|best_sell|(^|_)rank|rank(_|$)|rankby|popularity|revenue|(^|_)roas/.test(d)) return 'perf';
  if (/title|product_name|(^|_)name$|in_title|(^|_)p_name/.test(d)) return 'title';
  if (/desc|highlight|(^|_)hls?(_|$)|pd_attr|product_detail|sales_feature/.test(d)) return 'desc';
  if (/product_type|category|item_type|catalogue|(^|_)gpc|(^|_)cat(_|$)|sub_cat|product_class/.test(d)) return 'taxonomy';
  if (/keyword/.test(d)) return 'kw';
  if (/image|(^|_)img|overlay|video/.test(d)) return 'media';
  if (/url|link|redirect|canonical|store_code|(^|_)utm|tracking/.test(d)) return 'links';
  if (/gtin|mpn|(^|_)id$|_ids?$|(^|_)sku|stylecode|optioncode|item_group_id|productid|itemno|igid|identifier/.test(d)) return 'ident';
  if (/colou?r|gender|age_group|size|material|pattern|brand|condition|variant|option|item_group/.test(d)) return 'attr';
  if (/deliver|shipping|(^|_)ship/.test(d)) return 'ship';
  if (/offer|savings|(^|_)cost/.test(d)) return 'price';
  return 'other';
}

// ---- CHANNEL: which feed a field serves (a base field serves every channel) ----------------------
export const CHANNELS = [
  { k: 'all', label: 'Every channel' }, { k: 'google', label: 'Google' }, { k: 'meta', label: 'Meta / social' },
  { k: 'aff', label: 'Affiliates' }, { k: 'tiktok', label: 'TikTok' }, { k: 'pin', label: 'Pinterest' },
];
export function channel(r) {
  // "ig_id…" is an ITEM GROUP id (ig_id_colour_stock), not Instagram — folded out before the channel read
  const s = (s0(r.d) + ' ' + s0(r.n).toLowerCase()).replace(/(^|[_ ])ig[_ ]?id(?![a-z])/g, '$1itemgroupid');
  if (/(^|[_ ])(fb|meta|social|facebook|instagram|ig)([_ ]|$)|meta_|_meta|fb_|facebook/.test(s)) return 'meta';
  if (/awin|partnerize|olapic|linkshare|rakuten|affiliate/.test(s)) return 'aff';
  if (/tik_?tok/.test(s)) return 'tiktok';
  if (/(^|_)pin_|pinterest/.test(s)) return 'pin';
  if (/(^|_)gb_|google|gmc|adwords|(^|_)lia|pickup|(^|[_ ])css([_ ]|$)|shopping/.test(s)) return 'google';
  return 'all';
}

// ---- STOCK MECHANISM: how a rule takes part in stock management ----------------------------------
// Read from the target first (what the rule writes), then from the name (what it says it reads)
// where the target is a label or an exclusion field, which carry no stock meaning on their own.
export const MECHANISMS = [
  { k: 'avail', label: 'Availability', q: 'What each channel is told is in or out of stock' },
  { k: 'threshold', label: 'Stock thresholds', q: 'Stock quantity maths and low-stock cut-offs' },
  { k: 'range', label: 'Range completion', q: 'Size-curve completeness and colour depth' },
  { k: 'hero', label: 'Hero sizes', q: 'The core, best-selling sizes a market is told to protect — split out from range completion' },
  { k: 'label', label: 'Stock labels', q: 'Custom labels that bid by stock depth or range completion' },
  { k: 'excl', label: 'Stock exclusions', q: 'Products pulled from a channel for stock reasons' },
  { k: 'local', label: 'Local inventory', q: 'Store pickup, pickup SLA and store-coded links (LIA)' },
  { k: 'life', label: 'Lifecycle', q: 'New-in, aged and pre-season stock, clearance' },
];
const STOCKWORD = /stock|avail|\boos\b|out of stoc|in stock|sold ?out|quantit|\bqty\b|range completion|\brc\b|hero size|size curve|inventor|units?\b/i;
const LIFEWORD = /new in|newin|new arrival|older than|\baged\b|pre[- ]?\d{4}|clearance|end of line|discontinu|season|last chance/i;
export function stockKind(r) {
  const d = s0(r.d), n = s0(r.n);
  if (/pickup|store_code|(^|_)lia(_|$)|local_inv|ship_to_store/.test(d) || /\blia\b|ship to store|store pickup|click (&|and) collect/i.test(n)) return 'local';
  const isLabel = /custom_label|custom_number|(^|_)cl_?\d|_cl\d|(^|_)label|_label/.test(d);
  const isExcl = /exclu|(^|_)exclude|excl_|destination|eligible/.test(d);
  if (isExcl) {
    if (/range|(^|_)rc(_|$)|stock|quantity|qty|avail/.test(d) || STOCKWORD.test(n)) return 'excl';
    if (/older_than|pre_\d{4}/.test(d) || LIFEWORD.test(n)) return 'life';
    return null;
  }
  if (isLabel) {
    if (/stock|range|(^|_)rc(_|$)|avail/.test(d) || STOCKWORD.test(n)) return 'label';
    if (LIFEWORD.test(n)) return 'life';
    return null;
  }
  if (/older_than|(^|_)pre_\d{4}|new_?in|arrival|season|clearance/.test(d)) return 'life';
  if (/stock_status|availability|(^|_)avail$|_avail$/.test(d)) return 'avail';
  // HERO SIZES (Ray, 28 Sep 2026: "add hero sizes in the stock control for each market … because
  // it's different from range completion"): a rule that WRITES the hero-size flag itself (field, or
  // the name says so) is its own mechanism, not folded into range completion's size-curve reading —
  // read from the field first, same as every other mechanism here.
  if (/hero_size/.test(d) || /hero size/i.test(n)) return 'hero';
  if (/range|(^|_)rc(_|$)|rc_percent|avail_percent|colour_stock|quantity_rank/.test(d)) return 'range';
  if (/stock|quantity|(^|_)qty/.test(d)) return 'threshold';
  return null;
}
// what the rule's NAME says it reads — shown as chips, never as the rule's logic
export const DRIVERS = { rc: 'range completion', qty: 'stock quantity', hero: 'hero sizes', scrape: 'site scrape', manual: 'a manual list', date: 'dates / age', price: 'price' };
export function drivers(r) {
  const n = s0(r.n).toLowerCase(), out = [];
  if (/range completion|\brc\b|size curve/.test(n)) out.push('rc');
  if (/stock\s*[<>=]|quantit|\bqty\b|\bunits?\b|stock count|stock num/.test(n)) out.push('qty');
  if (/hero size/.test(n)) out.push('hero');
  if (/scrap/.test(n)) out.push('scrape');
  if (/manual|client list|\blist\b|ad ?hoc|inclusion/.test(n)) out.push('manual');
  if (/\bdate\b|older than|months?\b|pre[- ]?\d{4}|new in|season/.test(n)) out.push('date');
  return out;
}
// numeric cut-offs a name states ("Stock < 11 -> OOS", "RC > 65%", "Empty < 0.26 RC", "quantity with 3 or less")
export function cutoffs(name) {
  const n = s0(name), out = [];
  const seen = {}; const add = (m, op, v) => { const k = m + op + v; if (seen[k] || !isFinite(v)) return; seen[k] = 1; out.push({ m, op, v }); };
  const op = (s) => ({ '<': '<', '>': '>', '<=': '≤', '>=': '≥', '=<': '≤', '=>': '≥', '=': '=' }[s] || s);
  let m;
  const rs = /\b(stock|quantity|qty|units?)\b\s*(<=|>=|=<|=>|<|>|=)\s*(\d+)/gi; while ((m = rs.exec(n))) add('stock', op(m[2]), +m[3]);
  const rl = /(\d+)\s*(or less|or fewer|and below|and under|or below)/gi;
  while ((m = rl.exec(n))) if (/stock|quantit|qty|units?/i.test(n)) add('stock', '≤', +m[1]);
  const pc = (x) => { const v = parseFloat(x); return v > 0 && v < 1 ? Math.round(v * 100) : v; };
  const rr = /\b(rc|range completion)\b\s*(<=|>=|<|>|=)\s*(\d*\.?\d+)\s*%?/gi; while ((m = rr.exec(n))) add('rc', op(m[2]), pc(m[3]));
  const rr2 = /(<=|>=|<|>)\s*(\d*\.?\d+)\s*%?\s*(rc|range completion)\b/gi; while ((m = rr2.exec(n))) add('rc', op(m[1]), pc(m[2]));
  return out;
}
export function cutText(c) { return (c.m === 'rc' ? 'RC ' : 'stock ') + c.op + ' ' + c.v + (c.m === 'rc' ? '%' : ''); }

// ---- TAGS: what a rule's name says about its own life -------------------------------------------
// temp  = the team marked it temporary / one-off / ad hoc
// ab    = an A/B test (title tests mostly) — expected to conclude
// review= the name asks for a review cadence (daily / weekly / monthly) — checked against its last change
// promo = names a dated campaign or promotion (Eid, Black Friday, "May Promo", "25% Off")
export function tags(r) {
  const n = s0(r.n), out = [];
  // the NAME only: a `*_temp` target is a working column (a staging field other rules build from), not a temporary rule
  if (/\b(temp|temporar\w*|tmp|one[- ]?off|ad ?hoc|delete later|remove later)\b/i.test(n)) out.push('temp');
  if (/\ba\s*\/\s*b\b|\bab\b|\btest group\b|\bcontrol group\b|\b(title|titles|overlay|price|image|description)s? test\b/i.test(n)) out.push('ab');
  if (/\b(daily|weekly|monthly)\b/i.test(n) && /review|update|check|refresh/i.test(n)) out.push('review');
  if (/black friday|\bbf\b|cyber|xmas|christmas|\beid\b|ramadan|easter|valentine|mother'?s day|father'?s day|summer sale|winter sale|\bpromo\b|\d+\s*% off|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(uary|ruary|ch|il|e|y|ust|tember|ober|ember)?\s+(promo|sale|launch|campaign)/i.test(n)) out.push('promo');
  return out;
}
// a campaign year the name states ("Easter 2024", "Black Friday 2025") — null when none
export function yearIn(name) {
  const m = /\b(20\d\d)\b/.exec(s0(name));
  return m ? +m[1] : null;
}
export function reviewDays(name) {
  const n = s0(name).toLowerCase();
  return /\bdaily\b/.test(n) ? 1 : /\bweekly\b/.test(n) ? 7 : /\bmonthly\b/.test(n) ? 31 : null;
}

// ---- one market ----------------------------------------------------------------------------------
export function normRules(rows) { return (Array.isArray(rows) ? rows : []).map((row, i) => normRule(row, i)).filter((r) => r.n || r.d); }

// fields written by more than one rule, in run order — the last writer wins
export function chains(rules, min) {
  const by = {};
  (rules || []).forEach((r) => { (by[r.d] = by[r.d] || { d: r.d, t: r.t, fam: r.fam, rules: [] }).rules.push(r); });
  return Object.keys(by).map((k) => by[k]).filter((c) => c.rules.length >= (min || 2))
    .map((c) => Object.assign(c, { rules: c.rules.slice().sort((a, b) => a.i - b.i) }))
    .sort((a, b) => b.rules.length - a.rules.length || a.t.localeCompare(b.t));
}
// same name + same field twice in one market
export function duplicates(rules) {
  const seen = {}, out = [];
  (rules || []).forEach((r) => { const k = r.d + '|' + r.n.toLowerCase(); (seen[k] = seen[k] || []).push(r); });
  Object.keys(seen).forEach((k) => { if (seen[k].length > 1) out.push(seen[k]); });
  return out;
}
// the compact stock row the index carries (the Stock page reads only the index)
export function stockRow(r) {
  return { id: r.id, i: r.i, n: r.n, t: r.t, d: r.d, ty: r.ty, b: r.b, imp: r.imp, of: r.of, mo: r.mo, mb: r.mb, co: r.co, iss: r.iss, ch: r.ch, sk: r.sk, dr: r.dr, cut: r.cut, tag: r.tag };
}
export function marketSummary(rules, now) {
  now = now || Date.now();
  const fam = {}, mech = {}, iss = { none: 0, target: 0, dep: 0, other: 0 };
  let sys = 0, user = 0, temp = 0, ab = 0, promoDormant = 0, rt = 0, last = null, lastBy = '', changed30 = 0, items = null;
  (rules || []).forEach((r) => {
    fam[r.fam] = (fam[r.fam] || 0) + 1;
    if (r.sk) mech[r.sk] = (mech[r.sk] || 0) + 1;
    r.iss.forEach((c) => { iss[c] = (iss[c] || 0) + 1; });
    if (r.ty === 'S') sys++; else user++;
    if (r.tag.indexOf('temp') >= 0) temp++;
    if (r.tag.indexOf('ab') >= 0) ab++;
    if (r.tag.indexOf('promo') >= 0 && r.iss.indexOf('none') >= 0) promoDormant++;
    rt += r.rt || 0;
    if (r.of != null && (items == null || r.of > items)) items = r.of;
    if (r.mo && (!last || r.mo > last)) { last = r.mo; lastBy = r.mb; }
    if (r.mo && now - r.mo <= 30 * DAY) changed30++;
  });
  const ch = chains(rules, 2);
  return {
    n: (rules || []).length, items, sys, user, fam, mech, iss, temp, ab, promoDormant, rt: r1(rt), last, lastBy, changed30,
    dupes: duplicates(rules).length,
    top: ch.slice(0, 5).map((c) => ({ d: c.d, t: c.t, n: c.rules.length })),
    stock: (rules || []).filter((r) => r.sk).map(stockRow),
    recent: (rules || []).filter((r) => r.mo && now - r.mo <= 30 * DAY).sort((a, b) => b.mo - a.mo).slice(0, 12)
      .map((r) => ({ i: r.i, n: r.n, t: r.t, fam: r.fam, mo: r.mo, mb: r.mb, new: r.co && Math.abs(r.co - r.mo) < 60000 })),
  };
}

// ---- estate (the index rows, already client-scoped) ----------------------------------------------
export function estate(rows) {
  const e = { markets: 0, brands: 0, n: 0, sys: 0, user: 0, fam: {}, mech: {}, iss: { none: 0, target: 0, dep: 0, other: 0 }, temp: 0, ab: 0, changed30: 0, dupes: 0, stockMarkets: 0, stockRules: 0 };
  const brands = {};
  (rows || []).forEach((m) => {
    if (!m || !m.client) return;
    e.markets++; brands[m.client] = 1;
    e.n += m.n || 0; e.sys += m.sys || 0; e.user += m.user || 0; e.temp += m.temp || 0; e.ab += m.ab || 0; e.changed30 += m.changed30 || 0; e.dupes += m.dupes || 0;
    Object.keys(m.fam || {}).forEach((k) => { e.fam[k] = (e.fam[k] || 0) + m.fam[k]; });
    Object.keys(m.mech || {}).forEach((k) => { e.mech[k] = (e.mech[k] || 0) + m.mech[k]; });
    Object.keys(m.iss || {}).forEach((k) => { e.iss[k] = (e.iss[k] || 0) + m.iss[k]; });
    const sn = (m.stock || []).length; e.stockRules += sn; if (sn) e.stockMarkets++;
  });
  e.brands = Object.keys(brands).length;
  return e;
}

// ---- findings: RULE HYGIENE (the Rules page) -----------------------------------------------------
// sev: 3 act now · 2 review · 1 worth knowing. Every finding names the market and the rules.
export const SEV = { 3: 'Act now', 2: 'Review', 1: 'Worth knowing' };
export function rulesFindings(markets, now) {
  now = now || Date.now();
  const out = [];
  (markets || []).forEach((m) => {
    const rules = m.rules || [];
    const where = { client: m.client, market: m.market, cmpid: m.cmpid };
    const broken = rules.filter((r) => r.iss.indexOf('target') >= 0 || r.iss.indexOf('dep') >= 0);
    if (broken.length) out.push(Object.assign({ k: 'broken', sev: 3, n: broken.length, rules: broken.map(pick),
      t: broken.length + ' rule' + pl(broken.length) + ' writing a column the feed does not have',
      why: 'FeedHero flags "target / dependent column missing": the rule runs and changes nothing. Either the column was renamed or the rule should be removed.' }, where));
    const review = rules.filter((r) => r.tag.indexOf('review') >= 0 && reviewDays(r.n) && r.mo && now - r.mo > reviewDays(r.n) * DAY * 2);
    if (review.length) out.push(Object.assign({ k: 'review', sev: 3, n: review.length, rules: review.map(pick),
      t: review.length + ' rule' + pl(review.length) + ' asking for a regular review, last changed ' + ago(Math.min.apply(null, review.map((r) => r.mo)), now),
      why: 'The rule\'s own name sets the cadence ("review weekly", "update weekly"); its last change is more than twice that long ago.' }, where));
    const promo = rules.filter((r) => r.tag.indexOf('promo') >= 0 && r.iss.indexOf('none') >= 0);
    if (promo.length) out.push(Object.assign({ k: 'promo', sev: 2, n: promo.length, rules: promo.map(pick),
      t: promo.length + ' campaign rule' + pl(promo.length) + ' still active and touching nothing',
      why: 'Named for a dated campaign or promotion and impacting no items — it ran its course. Pausing it keeps the rule list honest and the run shorter.' }, where));
    const yr = new Date(now).getUTCFullYear();
    const past = rules.filter((r) => r.tag.indexOf('promo') >= 0 && yearIn(r.n) && yearIn(r.n) < yr && r.iss.indexOf('none') < 0 && r.imp > 0);
    if (past.length) out.push(Object.assign({ k: 'pastpromo', sev: 2, n: past.length, rules: past.map(pick),
      t: past.length + ' rule' + pl(past.length) + ' named for a past year\'s campaign still labelling ' + past.reduce((a, r) => a + (r.imp || 0), 0).toLocaleString('en-GB') + ' product' + pl(past.reduce((a, r) => a + (r.imp || 0), 0)),
      why: 'The name dates the campaign ("Black Friday 2025", "Easter 2024"); the rule still writes onto live products. Either it was re-used and renamed nowhere, or last year\'s label is still steering this year\'s bids.' }, where));
    const temp = rules.filter((r) => r.tag.indexOf('temp') >= 0 && r.co && now - r.co > 30 * DAY);
    if (temp.length) out.push(Object.assign({ k: 'temp', sev: 2, n: temp.length, rules: temp.map(pick),
      t: temp.length + ' "temporary" rule' + pl(temp.length) + ' still active, oldest from ' + ago(Math.min.apply(null, temp.map((r) => r.co)), now),
      why: 'The team named these temporary, one-off or ad hoc. A temporary rule that outlives its reason quietly becomes the feed\'s logic.' }, where));
    const ab = rules.filter((r) => r.tag.indexOf('ab') >= 0 && r.mo && now - r.mo > 90 * DAY);
    if (ab.length) out.push(Object.assign({ k: 'ab', sev: 1, n: ab.length, rules: ab.map(pick),
      t: ab.length + ' A/B test rule' + pl(ab.length) + ' unchanged for over 90 days',
      why: 'A test that has not moved in a quarter has either been read (fold the winner in) or forgotten.' }, where));
    const dormant = rules.filter((r) => r.iss.length === 1 && r.iss[0] === 'none' && r.tag.indexOf('promo') < 0);
    if (dormant.length >= 3) out.push(Object.assign({ k: 'dormant', sev: 1, n: dormant.length, rules: dormant.map(pick),
      t: dormant.length + ' rules not impacting any items',
      why: 'Some are legitimate (a guard that fires only when something breaks); a long list is usually retired logic still running.' }, where));
    const dup = duplicates(rules);
    if (dup.length) out.push(Object.assign({ k: 'dupe', sev: 1, n: dup.length, rules: [].concat.apply([], dup).map(pick),
      t: dup.length + ' rule name' + pl(dup.length) + ' used twice on the same field',
      why: 'Two rules with one name on one field — the later one wins, and nobody can tell which from the list.' }, where));
    const longc = chains(rules, 6);
    if (longc.length) out.push(Object.assign({ k: 'chain', sev: 1, n: longc.length, rules: [],
      fields: longc.map((c) => ({ t: c.t, d: c.d, n: c.rules.length })),
      t: longc.length + ' field' + pl(longc.length) + ' written by 6 or more rules',
      why: 'Order matters: the last rule to write a field wins. A long chain is where a change upstream gets silently overwritten.' }, where));
  });
  return out.sort((a, b) => b.sev - a.sev || b.n - a.n);
}

// ---- STOCK: coverage, cut-offs and findings (the Stock page reads the index only) ----------------
// markets = index rows {client, market, cmpid, stock:[...], n, updated}
export function stockMatrix(markets) {
  const brands = {};
  (markets || []).forEach((m) => {
    if (!m || !m.client) return;
    const b = brands[m.client] || (brands[m.client] = { client: m.client, markets: [], mech: {} });
    const mech = {};
    (m.stock || []).forEach((r) => { mech[r.sk] = (mech[r.sk] || 0) + 1; });
    Object.keys(mech).forEach((k) => { b.mech[k] = (b.mech[k] || 0) + 1; });
    b.markets.push({ market: m.market, cmpid: m.cmpid, n: (m.stock || []).length, mech, read: !!m.updated });
  });
  return Object.keys(brands).sort().map((k) => brands[k]);
}
export function stockCutoffs(markets) {
  const out = [];
  (markets || []).forEach((m) => (m.stock || []).forEach((r) => (r.cut || []).forEach((c) => out.push({ client: m.client, market: m.market, cmpid: m.cmpid, sk: r.sk, ch: r.ch, rule: r.n, t: r.t, i: r.i, m: c.m, op: c.op, v: c.v, imp: r.imp, of: r.of }))));
  return out.sort((a, b) => a.client.localeCompare(b.client) || a.market.localeCompare(b.market) || a.i - b.i);
}
// HERO SIZES — THE RUNS TABLE (Ray, 28 Sep 2026: "add hero sizes in the stock control for each
// market and runs table as well, because it's different from range completion"): every rule on the
// 'hero' mechanism, market by market, in FeedHero's own RUN ORDER — the thing the coverage count
// and the mechanism chip cannot show on their own: which rule, in what position, is deciding a
// market's hero sizes. Same shape as stockCutoffs so the page can render it the same way.
export function heroRuns(markets) {
  const out = [];
  (markets || []).forEach((m) => {
    if (!m || !m.client) return;
    (m.stock || []).filter((r) => r.sk === 'hero').forEach((r) => out.push({
      client: m.client, market: m.market, cmpid: m.cmpid, i: r.i, n: r.n, t: r.t, d: r.d,
      ch: r.ch, b: r.b, imp: r.imp, of: r.of, mo: r.mo, mb: r.mb, iss: r.iss, cut: r.cut,
    }));
  });
  return out.sort((a, b) => a.client.localeCompare(b.client) || a.market.localeCompare(b.market) || a.i - b.i);
}
export function stockFindings(markets, now) {
  now = now || Date.now();
  const out = [];
  const ms = (markets || []).filter((m) => m && m.client);
  ms.forEach((m) => {
    const st = m.stock || [];
    const where = { client: m.client, market: m.market, cmpid: m.cmpid };
    const broken = st.filter((r) => r.iss.indexOf('target') >= 0 || r.iss.indexOf('dep') >= 0);
    if (broken.length) out.push(Object.assign({ k: 'broken', sev: 3, n: broken.length, rules: broken.map(pick),
      t: broken.length + ' stock rule' + pl(broken.length) + ' writing a column the feed does not have',
      why: 'A stock rule that writes nothing is a stock control that is not there — the channel is being told whatever the source says.' }, where));
    const review = st.filter((r) => r.tag.indexOf('review') >= 0 && reviewDays(r.n) && r.mo && now - r.mo > reviewDays(r.n) * DAY * 2);
    if (review.length) out.push(Object.assign({ k: 'review', sev: 3, n: review.length, rules: review.map(pick),
      t: review.length + ' stock rule' + pl(review.length) + ' marked for regular review, last changed ' + ago(Math.min.apply(null, review.map((r) => r.mo)), now),
      why: 'Its own name sets the cadence. A manual stock inclusion left unreviewed keeps advertising whatever it held when it was last touched.' }, where));
    const dormant = st.filter((r) => r.iss.indexOf('none') >= 0);
    if (dormant.length) out.push(Object.assign({ k: 'dormant', sev: 2, n: dormant.length, rules: dormant.map(pick),
      t: dormant.length + ' stock rule' + pl(dormant.length) + ' not impacting any items',
      why: 'A stock guard can legitimately sit idle (nothing below the cut-off today) — worth one look to be sure it is idle, not broken.' }, where));
    const temp = st.filter((r) => r.tag.indexOf('temp') >= 0 && r.co && now - r.co > 30 * DAY);
    if (temp.length) out.push(Object.assign({ k: 'temp', sev: 2, n: temp.length, rules: temp.map(pick),
      t: temp.length + ' temporary stock rule' + pl(temp.length) + ' still active',
      why: 'Named temporary or ad hoc; still shaping what shoppers are shown as in stock.' }, where));
    const stale = st.filter((r) => r.mo && now - r.mo > 365 * DAY && (r.sk === 'threshold' || r.sk === 'range' || r.sk === 'excl'));
    if (stale.length) out.push(Object.assign({ k: 'stale', sev: 1, n: stale.length, rules: stale.map(pick),
      t: stale.length + ' stock threshold / range / exclusion rule' + pl(stale.length) + ' unchanged for over a year',
      why: 'Thresholds and range-completion levels set a year ago were set for last year\'s range depth. Still right?' }, where));
  });
  // brand-level: a mechanism most of a brand's read markets run that this market does not
  stockMatrix(ms).forEach((b) => {
    const read = b.markets.filter((x) => x.read);
    if (read.length < 2) return;
    MECHANISMS.forEach((mk) => {
      const runs = read.filter((x) => x.mech[mk.k]);
      if (runs.length < 2 || runs.length < read.length / 2 || runs.length === read.length) return;
      const lack = read.filter((x) => !x.mech[mk.k]);
      out.push({ k: 'gap', sev: mk.k === 'local' ? 1 : 2, client: b.client, market: lack.map((x) => x.market).join(' · '), cmpid: null, mk: mk.k, n: lack.length, rules: [],
        t: b.client + ': ' + lack.length + ' market' + pl(lack.length) + ' without ' + mk.label.toLowerCase() + ' that ' + runs.length + ' of its ' + read.length + ' markets run',
        why: mk.k === 'local' ? 'Local inventory only belongs where the brand has stores in that market — confirm before adding.' : 'The brand runs this stock control in most of its markets. The ones without it may be showing stock the others would hide.' });
    });
  });
  // cut-off inconsistency: one mechanism + metric set at different values across a brand's markets
  const cuts = stockCutoffs(ms), by = {};
  cuts.forEach((c) => { const k = c.client + '|' + c.sk + '|' + c.m + '|' + c.op; (by[k] = by[k] || []).push(c); });
  Object.keys(by).forEach((k) => {
    const list = by[k], vals = Array.from(new Set(list.map((c) => c.v)));
    const mkts = Array.from(new Set(list.map((c) => c.market)));
    if (vals.length < 2 || mkts.length < 2) return;
    const c0 = list[0];
    out.push({ k: 'cutoff', sev: 1, client: c0.client, market: mkts.join(' · '), cmpid: null, n: vals.length, rules: list.map((c) => ({ i: c.i, n: c.rule, t: c.t, market: c.market, cmpid: c.cmpid })),
      t: c0.client + ': ' + (c0.m === 'rc' ? 'range-completion' : 'stock') + ' cut-off set differently across markets (' + vals.sort((a, b) => a - b).map((v) => c0.op + ' ' + v + (c0.m === 'rc' ? '%' : '')).join(', ') + ')',
      why: 'Could be deliberate (market range depth differs). If it is not, one market is hiding or showing stock the others would not.' });
  });
  return out.sort((a, b) => b.sev - a.sev || b.n - a.n);
}

// the plain-English line a market's stock setup reads as — built from its rules, one clause per mechanism
export function stockSentence(stock) {
  const by = {};
  (stock || []).forEach((r) => { (by[r.sk] = by[r.sk] || []).push(r); });
  const parts = [];
  MECHANISMS.forEach((mk) => {
    const list = by[mk.k]; if (!list) return;
    const cuts = [].concat.apply([], list.map((r) => r.cut || [])).map(cutText);
    const chs = Array.from(new Set(list.map((r) => r.ch).filter((c) => c !== 'all')));
    parts.push(mk.label + ' (' + list.length + (cuts.length ? ' · ' + Array.from(new Set(cuts)).join(', ') : '') + (chs.length ? ' · ' + chs.map((c) => (CHANNELS.find((x) => x.k === c) || {}).label).join(', ') : '') + ')');
  });
  return parts.length ? parts.join(' · ') : 'No stock rules — every channel is told whatever the source feed says.';
}

function pick(r) { return { i: r.i, n: r.n, t: r.t, mo: r.mo, mb: r.mb, imp: r.imp, of: r.of, iss: r.iss }; }
function pl(n) { return n === 1 ? '' : 's'; }
export function ago(t, now) {
  if (!t) return 'never';
  const d = Math.floor(((now || Date.now()) - t) / DAY);
  if (d < 1) return 'today'; if (d < 2) return 'yesterday'; if (d < 60) return d + ' days ago';
  const mo = Math.round(d / 30.4); if (mo < 24) return mo + ' months ago';
  return Math.round(d / 365) + ' years ago';
}
// rotation: the markets whose rules are older than RULES_STALE_MS (never read leads)
// A failed firing backs off RULES_BACKOFF_MS before the :40 half is taken again — the same token
// feeds ROAS, and a rules error that kept claiming the slot would starve ROAS of half its firings.
export const RULES_BACKOFF_MS = 3 * 3600000;
export function rulesDue(st, roster, now) {
  now = now || Date.now();
  if (st && st.state && st.state !== 'ok' && st.at && now - st.at < RULES_BACKOFF_MS) return false;
  const rot = (st && st.rot) || {};
  return (roster || []).some((m) => !rot[m.cmpid] || now - rot[m.cmpid] > RULES_STALE_MS);
}

// ---- the index entry one market writes (rulesidx[cmpid]) -----------------------------------------
// The summary + the stock rows + the market's own hygiene findings (each finding's rule list cut to
// FIND_KEEP, with `more` saying how many were left out — the drill-down carries them all). The
// findings are computed ONCE at pull time off the full rule list, so the book never needs a
// second read of every market's record.
export const FIND_KEEP = 8;
export function trimFinding(f, keep) {
  const k = keep || FIND_KEEP, list = f.rules || [];
  return Object.assign({}, f, { rules: list.slice(0, k), more: Math.max(0, list.length - k) });
}
export function idxEntry(m, rules, meta, now) {
  now = now || Date.now();
  const total = meta && meta.total != null ? +meta.total : (rules || []).length;
  const where = { client: m.client, market: m.market, cmpid: m.cmpid };
  return Object.assign({}, where, { updated: now, total, capped: total > (rules || []).length }, marketSummary(rules, now),
    { find: rulesFindings([Object.assign({ rules: rules || [] }, where)], now).map((f) => trimFinding(f)) });
}
// one row per brand for the book's brand table
export function brandsOf(rows) {
  const by = {};
  (rows || []).forEach((m) => {
    if (!m || !m.client) return;
    const b = by[m.client] || (by[m.client] = { client: m.client, markets: 0, n: 0, user: 0, sys: 0, stock: 0, idle: 0, broken: 0, changed30: 0, last: null, lastBy: '', find: 0, act: 0 });
    b.markets++; b.n += m.n || 0; b.user += m.user || 0; b.sys += m.sys || 0; b.stock += (m.stock || []).length;
    b.idle += (m.iss && m.iss.none) || 0; b.broken += ((m.iss && m.iss.target) || 0) + ((m.iss && m.iss.dep) || 0);
    b.changed30 += m.changed30 || 0;
    if (m.last && (!b.last || m.last > b.last)) { b.last = m.last; b.lastBy = m.lastBy || ''; }
    (m.find || []).forEach((f) => { b.find++; if (f.sev === 3) b.act++; });
  });
  return Object.keys(by).sort().map((k) => by[k]);
}

// ---- AD SPEND KEPT OFF LOW-STOCK PRODUCTS (Ray, 28 Sep 2026: "stock management … is going to be a
// key feature to actually sell to clients … focus on stock threshold and range completion … pull
// AdWords data based on impressions, clicks, CPC … calculate, when I hover over each of these stock
// features, how much that would save clients in ad spend … Use a forecast method — 5 %, 10 %,
// conservative or aggressive — probably based on CPC, per day or per month") -----------------------
//
// THE MODEL, and why it is this one. A stock rule that holds a product back (sets it out of stock,
// excludes it, empties the label a campaign bids on) keeps that product from buying clicks it could
// not convert — sizes missing, a unit or two left. What those clicks would have cost is the market's
// OWN price for traffic: CPC, 30-day spend and clicks read from FeedHero's Google Ads report, divided
// by the market's REAL catalogue — READ OFF THE LIVE OUTPUT FEED ITSELF (Ray, 28 Sep 2026, on Reiss
// GB's forecast panel: "spend per product per day should be base on the volume of output feeds (the
// feed URLs rather than the products impacted number in the rule) — Reiss GB Shopping should have
// 22,657 SKUs instead of 60,235"). FeedHero's OWN 'skus' figure on the roas_dashboard report is Ads
// TRAFFIC, not the catalogue — the ROAS module's own docs note a market can carry "Unlisted SKUs in
// Ads traffic" (real spend on SKUs the feed does not currently hold, docs/ROAS.md §2), which is
// exactly how a Total row reads more SKUs than the feed serves. So the denominator here is the SAME
// row count the Product Volume module already keeps per feed (voldobidx — the 4x-daily xml-scan
// agent's own read of the feed URL, Shopping feeds only, one more KV get on the stock route), never
// FeedHero's Ads-traffic count and never a rule's own impacted/of figure — a market whose feed has
// not been scanned yet is unpriced, the same honest gap as no Google Ads read:
//
//   spend per product per day  =  30-day Google Ads spend ÷ products in the LIVE OUTPUT FEED ÷ 30
//                              =  (clicks ÷ feed products ÷ 30)  ×  CPC   — the same number, shown both ways
//   saved per day              =  products held back × spend per product per day × scenario %
//
// The scenario is the share of the held-back products assumed to have drawn the market's average
// traffic had they been live: Conservative 5 %, Aggressive 10 % (Ray's two), adjustable. A share, not
// a multiplier on spend, because a low-stock product would not out-earn an average one — Google ranks
// on performance — so assuming all of them would draw average traffic overstates it, and a figure a
// client can take apart is worth more than a large one. Per day, or per month (30 days = the window).
//
// WHAT IS NEVER SIZED — said on screen, never a guessed number:
//   · a rule that RELEASES products ("Include hero size low RC", an "[inclusion]" list) — the
//     exception that keeps products live is not a saving;
//   · a rule that writes EVERY product (impacted N of N) — it sets each one in or out, and the report
//     says how many it wrote, not how many it held back;
//   · a rule that COMPUTES a value other rules act on (range-completion %, hero-size flags, stock
//     counts) — the blocking happens in the rule that reads it;
//   · a rule that only MIRRORS a state products are already in ("Not available to Zero" writes a stock
//     count of 0 onto products already marked unavailable — they were not advertised either way);
//   · a rule that holds products back on ANOTHER channel (Meta, affiliates…) — FeedHero's ad-spend
//     read is Google Ads, and Google's price for a click is not Meta's;
//   · a market missing either read it needs — FeedHero's Google Ads spend/clicks, or the live
//     output feed's own row count (never FeedHero's Ads-traffic SKU figure — see above).
export const SV_SCENARIOS = [
  { k: 'cons', label: 'Conservative', pct: 5 },
  { k: 'aggr', label: 'Aggressive', pct: 10 },
];
export const SV_WINDOW_DAYS = 30;          // FeedHero's 30-day window — the month the figures are read over
const RELEASE = /\binclu(de|ded|des|sion)\b|\bre-?add|\bre-?instate|\ballow(ed)?\b|\bwhitelist/i;
const BLOCKWORD = /\boos\b|out of stoc|->\s*0\b|to zero|not available|unavailable|\bexclu|\bremov|\bhide|\bblock|\bempty\b|\bpause/i;
const AVAILFIELD = /stock_status|availability|(^|_)avail$|_avail$/;
const QTYFIELD = /stock|quantity|(^|_)qty/;
const MIRROR = /^\s*(not available|unavailable|out of stock|oos|sold out)\b.*(\bto\b|->)\s*(zero|0)\b/i;
export const SV_CHANNELS = ['google', 'all'];   // the channels Google Ads' price for a click applies to
// what a stock rule does to products, and how many it holds back — {kind, n, why}
//   kind: 'blocked' (n held back) · 'none' (a blocking rule holding nothing back today) · 'releases' ·
//         'all' (writes every product — count not reported) · 'calc' (computes a value) · 'mirror'
//         (restates a state products are already in) · 'channel' (holds back on a channel Google Ads
//         does not price) · null (not a threshold / range-completion rule at all)
export function heldBack(r) {
  if (!r || !r.sk) return null;
  const d = s0(r.d), n = s0(r.n), dr = r.dr || [], cut = r.cut || [];
  const rcOrQty = dr.indexOf('rc') >= 0 || dr.indexOf('qty') >= 0 || dr.indexOf('hero') >= 0 || cut.length > 0;
  // Ray: "all the stock-related exclusions — stock threshold, range completion, etc. — focus on stock
  // threshold and range completion": thresholds, range completion, hero sizes (split from range
  // completion but the same "holds products back on low stock" question), and any stock rule driven
  // by either (a stock exclusion is already a rule the classifier placed for stock reasons)
  if (!(r.sk === 'threshold' || r.sk === 'range' || r.sk === 'hero' || r.sk === 'excl' || rcOrQty)) return null;
  if (RELEASE.test(n)) return { kind: 'releases', n: r.imp, why: 'Its name says it lets products back in — the exception that keeps them live, not a saving.' };
  const isExcl = /exclu|(^|_)exclude|excl_|destination|eligible/.test(d);
  const blocks = isExcl
    || (AVAILFIELD.test(d) && (rcOrQty || BLOCKWORD.test(n)))
    || (QTYFIELD.test(d) && (BLOCKWORD.test(n) || cut.length > 0))
    || (r.sk === 'label' && BLOCKWORD.test(n));
  if (!blocks) return { kind: 'calc', n: null, why: 'It works out a value (range completion, hero sizes, stock counts) that other rules act on — the saving sits in the rule that holds products back.' };
  if (SV_CHANNELS.indexOf(r.ch || 'all') < 0) return { kind: 'channel', n: r.imp, why: 'It holds products back on ' + (r.ch === 'meta' ? 'Meta' : r.ch === 'aff' ? 'affiliate feeds' : r.ch === 'tiktok' ? 'TikTok' : r.ch === 'pin' ? 'Pinterest' : 'another channel') + '. FeedHero\u2019s ad-spend read is Google Ads, and a Google click is not priced like one there.' };
  if (MIRROR.test(n)) return { kind: 'mirror', n: r.imp, why: 'Its name says it restates a state the products are already in (unavailable \u2192 zero stock) \u2014 they were not being advertised either way.' };
  if (r.imp == null) return { kind: 'all', n: null, why: 'FeedHero did not report how many products it changed.' };
  if (r.of && r.imp >= r.of) return { kind: 'all', n: null, why: 'It writes every product (' + r.imp.toLocaleString('en-GB') + ' of ' + r.of.toLocaleString('en-GB') + '), setting each one in or out — the report counts what it wrote, not what it held back.' };
  if (!r.imp) return { kind: 'none', n: 0, why: 'It is holding nothing back on its last run.' };
  return { kind: 'blocked', n: r.imp, why: null };
}
// a market's price for traffic: CPC/spend/clicks off its ROAS index entry (the 30-day Total), the
// SKU denominator off `feed` — {n: row count, t: when scanned}, the market's voldobidx entry (the
// live output feed's own row count, NEVER FeedHero's Ads-traffic 'skus' figure — see above) — null
// when either the Google Ads read or the feed-row read is missing
export function adsBasis(e, feed) {
  const t = e && (e.w30 || (e.spend ? e : null));
  const sk = feed && feed.n > 0 ? feed.n : null;
  if (!t || !t.spend || !(t.spend.n > 0) || !(t.clicks > 0) || !sk) return null;
  const days = SV_WINDOW_DAYS, sp = t.spend.n, ck = t.clicks;
  return {
    cur: t.spend.cur || (e && e.cur) || '', days, spend: sp, clicks: ck, impr: t.impr || 0, skus: sk,
    cpc: sp / ck, clicksDay: ck / sk / days, spendDay: sp / sk / days,   // unrounded — the page rounds for display only
    zombie: t.zombiePct == null ? null : t.zombiePct, crPct: t.crPct == null ? null : t.crPct,
    updated: (e && e.updated) || null, feedAt: (feed && feed.t) || null,
  };
}
// the saving — the ONE formula the page's twin (svCalc) is held to
export function savingFor(n, basis, pct, days) {
  if (!basis || !(n > 0)) return 0;
  return n * basis.spendDay * (pct / 100) * (days || 1);
}
// A market's figure is its LARGEST blocking rule, never the sum of them: two stock rules can hold back
// the same product (a threshold AND a range-completion exclusion), and the report does not say which
// products each one holds. So the market reads "at least", and the book adds markets, never rules.
export function svFloor(stock) {
  let best = null;
  (stock || []).forEach((r) => {
    const h = r && (r.hb || heldBack(r));
    if (h && h.kind === 'blocked' && h.n > 0 && (!best || h.n > best.n)) best = { n: h.n, i: r.i, rule: r.n };
  });
  return best;
}
// the book's headline: per CURRENCY (money never crosses one), each market's floor at pct over days
export function svBook(markets, pct, days) {
  const byCur = {}; let sized = 0, unpriced = 0;
  (markets || []).forEach((m) => {
    const f = svFloor(m.stock);
    if (!f) return;
    if (!m.ads) { unpriced++; return; }
    const c = m.ads.cur || '';
    const b = byCur[c] || (byCur[c] = { cur: c, amt: 0, markets: 0, n: 0 });
    b.amt += savingFor(f.n, m.ads, pct, days); b.markets++; b.n += f.n; sized++;
  });
  return { byCur: Object.keys(byCur).map((k) => byCur[k]).sort((a, b) => b.amt - a.amt), sized, unpriced };
}
// one market as GET /api/rules/stock serves it — the worker and tools/rules_stub.js both call this, so
// the tripwires' synthetic book can never drift from the real shape. `hb` rides on every stock row and
// `ads` is the market's price for traffic: its ROAS index entry for spend/clicks/CPC, its voldobidx
// entry (`feedIdx`, {rows,t} — the live output feed's own row count) for the SKU denominator, null
// when either is unread.
export function stockView(r, roasEntry, feedIdx, avail) {
  return { client: r.client, market: r.market, cmpid: r.cmpid, updated: r.updated, n: r.n, items: r.items,
    stock: (r.stock || []).map((x) => Object.assign({}, x, { hb: heldBack(x) })), sentence: stockSentence(r.stock),
    ads: adsBasis(roasEntry, feedIdx && { n: feedIdx.rows, t: feedIdx.t }), av: availView(avail) };
}

// ---- WHICH SCANNED FEED IS WHICH MARKET — joined on the FeedHero company id --------------------------
// The scan indexes (voldobidx, feedavail) key a feed as it is WIRED — 'Reiss|gb', 'Superdry|befr',
// 'Reiss|gb-fb' — while the roster names a market its own way ('GB', 'BE-FR'), so a label is never
// matched to a label (the first cut of the SKU denominator did, and 'Reiss|GB' found nothing). Every
// FeedHero output lives at /output_feeds/<cc>/<cmpid>/<hash>/<file> — the same read as the Catalogue's
// catCmpid — and a Meta (-fb) feed sits under its Google market's cmpid, so one company id names both.
// list = [{client, mkt, url}] (the wired XML feeds) -> { cmpid: { g: 'Client|mkt', fb: 'Client|mkt-fb' } }
export function feedKeys(list) {
  const out = {};
  (list || []).forEach((f) => {
    const m = f && f.url ? /\/output_feeds\/[a-z]+\/([a-z0-9_]+)\//i.exec(String(f.url)) : null;
    if (!m || !f.client || !f.mkt) return;
    const cmpid = m[1].toLowerCase(), ch = /-fb$/i.test(String(f.mkt)) ? 'fb' : 'g';
    const e = out[cmpid] || (out[cmpid] = {});
    if (!e[ch]) e[ch] = f.client + '|' + f.mkt;
  });
  return out;
}

// ---- AVAILABILITY, MASTER → FEED (Ray, 30 Sep 2026: "In the stock management module, bring in the
// availability ratio between master feed and output feeds as well (instock & outofstock)"). Three readings
// of one market, each a COUNT of products by the stock it states: the MASTER as the client sent it
// (FeedHero's own import, read by tools/master_stock.mjs — the availability word, or the quantity where a
// row has no word) and each OUTPUT feed FeedSpark sends from it (Google, Meta — counted on the 4x-daily
// xml-scan stream). The distance between them is what the stock rules did, so each is kept whole and
// nothing is joined or inferred: a product the master has out of stock and the feed does not carry is
// not called "excluded" here, because two counts cannot say which products they are.
//   in    in stock                       pre   pre-order, backorder, available for order — sellable, not on the shelf
//   out   out of stock, sold out, discontinued, not available
//   none  no reading (no word, no quantity) other a word nobody recognised — kept, never guessed into a bucket
export const AV_KEYS = ['in', 'out', 'pre', 'none', 'other'];
export function availSide(x) {
  const n = x ? Math.max(0, Math.round(+x.n || 0)) : 0;
  if (!(n > 0)) return null;
  const o = { n, t: +x.t || null };
  AV_KEYS.forEach((k) => { o[k] = Math.min(n, Math.max(0, Math.round(+x[k] || 0))); });
  o.inPct = (o.in / n) * 100; o.outPct = (o.out / n) * 100;
  return o;
}
// a = { master, g, fb, wired: {g, fb} } — the two indexes' entries (masteravail[cmpid], feedavail[client|mkt])
// and whether the market HAS a Google / Meta feed wired, so "no Meta feed" is never read as "not scanned yet"
export function availView(a) {
  if (!a) return null;
  const master = availSide(a.master), g = availSide(a.g), fb = availSide(a.fb), m = master ? a.master : null, w = a.wired || {};
  return { master, g, fb, wired: { g: !!w.g, fb: !!w.fb },
    via: (m && m.via) || null, imp: (m && m.imp) || null, col: (m && m.col) || '', qcol: (m && m.qcol) || '' };
}
// the book for one channel ('g' | 'fb'): markets whose master AND that feed are both read, their counts
// summed (a count carries no currency, so it can cross markets); a market read on one side only is
// counted apart (`one`), never half-added into a ratio it would skew
export function availBook(markets, ch) {
  const c = ch === 'fb' ? 'fb' : 'g', b = { markets: 0, one: 0, master: { n: 0, in: 0, out: 0 }, feed: { n: 0, in: 0, out: 0 } };
  (markets || []).forEach((mk) => {
    const av = mk && mk.av, ms = av && av.master, fd = av && av[c];
    if (ms && fd) { b.markets++; ['n', 'in', 'out'].forEach((k) => { b.master[k] += ms[k]; b.feed[k] += fd[k]; }); }
    else if (ms || fd) b.one++;
  });
  return b;
}
