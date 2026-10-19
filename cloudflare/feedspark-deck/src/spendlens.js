/*
 * SPEND LENS — where a market's Google Ads money sits against what it returns
 * (Ray, 19 Oct 2026, sending the Field Breakdown pivot for Reiss UK: "can you bring in Playbook -
 *  a few interesting RoAS improvement or spend optiimser tactics from field breakdown ? … you can
 *  see on RoAS avg: Textured, Striped, Checked, Colourblock has way better ROAS compared to Plain
 *  where most Spend is at").
 *
 * The finding Ray is pointing at is not about patterns: it is the SHAPE of a cut — most of the
 * money on the value that returns least, while several values of the same field return far more on
 * very little. That shape is readable on any cut of the catalogue, so this engine takes a cut and
 * names what is wrong with how the spend sits in it.
 *
 * WHERE THE NUMBERS COME FROM. /breakdown reads any field by streaming the whole feed into the
 * browser and joining Google Ads onto it per product — the right instrument for a question nobody
 * anticipated, and far too heavy for a rail that has to open in a moment. So the rail reads
 * FeedHero's OWN cuts, the same `roas_dashboard` aggregations /roas's Segment select reads
 * (/api/roas/live, cached six hours in KV), which means the rail and the ROAS module can never
 * disagree about a value's spend or return. What FeedHero does not cut — g:pattern among them —
 * stays /breakdown's to answer, and the rail says so rather than pretending the list is the feed.
 *
 * THREE RULES, each of which is why a figure here can be read out to a client:
 *  · MONEY NEVER CROSSES A CURRENCY. A cut is one market, so one currency; a cut whose spending
 *    rows carry two is refused with the reason, never blended.
 *  · EVERY RATE IS COMPUTED FROM THE ROWS SHOWN (revenue ÷ spend), never read off a field, so the
 *    blended figure and the rows a reader is comparing against it always add up.
 *  · A RETURN READ ON TOO LITTLE TRAFFIC IS NOT A FINDING. A value needs real clicks and a real
 *    share of the spend before its ROAS is allowed to propose anything; everything under that is
 *    counted and named as not enough to act on, never dropped silently and never ranked.
 *
 * PURE + dependency-free (no fetch, no KV) so the worker route and tools/test_spendlens.mjs run
 * the SAME code — the roas.js / testlab.js pattern.
 */
const s0 = (v) => (v == null ? '' : String(v));
const r2 = (n) => Math.round(n * 100) / 100;

export const SL_VERSION = 1;

// The cuts a spend decision actually turns on, in the order the rail reads them. Each is one of
// FeedHero's own aggregations (the allow-list on /api/roas/live), so nothing here asks FeedHero a
// question it has not been set up to answer — and a cut it has NOT been set up for comes back as
// that answer and is named, never guessed at.
export const SL_CUTS = [
  { k: 'Category', n: 'product category' },
  { k: 'Brand', n: 'brand' },
  { k: 'Colour', n: 'colour' },
  { k: 'Gender', n: 'gender' },
  { k: 'Age_group', n: 'age group' },
  { k: 'Price_type', n: 'full price or sale' },
  { k: 'Product_age', n: 'how new the product is' },
  { k: 'Custom_label_0', n: 'custom label 0' },
];
export const SL_CUT_KEYS = SL_CUTS.map((c) => c.k);
export function cutName(k) { const c = SL_CUTS.find((x) => x.k === k); return c ? c.n : s0(k).replace(/_/g, ' ').toLowerCase(); }

// The markets a rail reads on open: the three carrying the most spend. Reiss runs 28 — reading
// every cut of every one of them would be 200+ reads for a panel, and the money is not there.
export const SL_MARKETS = 3;

export const SL_MIN_CLICKS = 100;     // under this a value's return is a small sample, not a finding
export const SL_MIN_SHARE = 0.002;    // …and under 0.2% of the cut's spend there is nothing to move
export const SL_WIN = 1.35;           // "far better" = 35% above what the cut returns as a whole
export const SL_LAG = 0.92;           // …and "trailing" = 8% below it
export const SL_SMALL = 0.08;         // a starved value carries under 8% of the cut's spend
export const SL_BIG = 0.2;            // a value worth calling concentrated carries a fifth of it
export const SL_MOVE = 0.1;           // the arithmetic the rail shows moves a TENTH of the laggard's spend

// FeedHero's own pseudo-row: Ads traffic on SKUs the feed it holds does not carry. Real spend, but
// not a value of any cut — it is its own finding, so it never enters a cut's arithmetic.
export function isUnlisted(cat) { return /^unlisted skus in ads traffic$/i.test(s0(cat).trim()); }
// FeedHero's bucket for a product the cut cannot place. Counted and named, never read as a value
// somebody chose — "optimise Unsorted" is not an action.
export function isUnsorted(cat) { const t = s0(cat).trim().toLowerCase(); return t === 'unsorted' || t === '(not set)' || t === 'not set' || t === ''; }

const money = (m) => (m && typeof m.n === 'number' ? m.n : 0);
const cur = (m) => (m && m.cur) || null;

/* ---- ONE CUT OF ONE MARKET -------------------------------------------------------------------
 * rows: normalised roas_dashboard rows (src/roas.js normRow) for one aggregation.
 * Returns the reading, or { ok:false, why } — a refusal always says what it was.
 */
export function cutRead(agg, rows, opts) {
  opts = opts || {};
  const all = (Array.isArray(rows) ? rows : []).filter((r) => r && r.category);
  const unl = all.filter((r) => isUnlisted(r.category));
  let vals = all.filter((r) => !isUnlisted(r.category));
  // THE CATEGORY CUT IS A TREE: FeedHero gives every level its own aggregate row, so "Women" and
  // "Women > Dresses" both appear and adding them up counts the dresses twice. Only the top level
  // partitions the catalogue, so only the top level is compared.
  let treeTrimmed = 0;
  if (agg === 'Category') {
    const before = vals.length;
    vals = vals.filter((r) => s0(r.category).indexOf('>') < 0);
    treeTrimmed = before - vals.length;
  }
  const unsorted = vals.filter((r) => isUnsorted(r.category));
  vals = vals.filter((r) => !isUnsorted(r.category));
  const spending = vals.filter((r) => money(r.spend) > 0);
  if (!spending.length) return { ok: false, agg, why: 'no value of this cut carries any spend' };
  const curs = [...new Set(spending.map((r) => cur(r.spend)).filter(Boolean))];
  if (curs.length > 1) return { ok: false, agg, why: 'this cut reports in ' + curs.join(' and ') + ' — money is never blended across a currency', curs };
  const c = curs[0] || null;
  const spend = r2(spending.reduce((a, r) => a + money(r.spend), 0));
  const rev = r2(spending.reduce((a, r) => a + money(r.revenue), 0));
  const blended = spend > 0 ? r2((rev / spend) * 100) : null;
  const list = spending.map((r) => ({
    v: s0(r.category), spend: money(r.spend), rev: money(r.revenue),
    roas: money(r.spend) > 0 ? r2((money(r.revenue) / money(r.spend)) * 100) : null,
    clicks: r.clicks || 0, impr: r.impr || 0, skus: r.skus || 0,
    share: spend > 0 ? money(r.spend) / spend : 0,
  })).sort((a, b) => b.spend - a.spend);
  // what is too small to act on is COUNTED, not dropped: the rail says how much of the cut it is
  const thin = list.filter((x) => x.clicks < SL_MIN_CLICKS || x.share < SL_MIN_SHARE);
  const solid = list.filter((x) => thin.indexOf(x) < 0);
  return { ok: true, agg, cur: c, spend, rev, blended, n: list.length,
    list, solid, thin: thin.length, thinSpend: r2(thin.reduce((a, x) => a + x.spend, 0)),
    unlisted: unl.length ? { spend: r2(unl.reduce((a, r) => a + money(r.spend), 0)), rev: r2(unl.reduce((a, r) => a + money(r.revenue), 0)), cur: cur(unl[0].spend) } : null,
    unsorted: unsorted.length ? { n: unsorted.length, spend: r2(unsorted.reduce((a, r) => a + money(r.spend), 0)) } : null,
    treeTrimmed };
}

/* ---- THE TACTICS -----------------------------------------------------------------------------
 * A finite, named set. Each one either produces a finding off this market's own figures or
 * produces nothing — there is no tactic here that can be proposed without evidence.
 */
export const SL_TACTICS = [
  { k: 'starved', t: 'Move spend onto the values that return', why: 'Several values of this field return far more than the field does as a whole, on a sliver of the money.' },
  { k: 'laggard', t: 'Most of the money sits on the weakest value', why: 'The biggest-spending value of this field returns less than the field does as a whole.' },
  { k: 'dead', t: 'Spend that returned nothing', why: 'Values carrying real spend and no revenue at all over the window.' },
  { k: 'unlisted', t: 'Spend on products the feed no longer carries', why: 'Google Ads is still serving products this market’s feed does not hold.' },
];
export function tacticOf(k) { return SL_TACTICS.find((t) => t.k === k) || null; }

const fmtMoney = (c, n) => (c || '') + Math.round(n).toLocaleString('en-GB');
const fmtPct = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-GB') + '%');
const fmtShare = (f) => (f * 100 < 1 ? (Math.round(f * 1000) / 10) : Math.round(f * 100)) + '%';

// one cut reading -> the findings it supports, biggest money first
export function cutFindings(read, market) {
  if (!read || !read.ok || !read.blended) return [];
  const out = [], c = read.cur, name = cutName(read.agg);
  const top = read.list[0];
  // A LAGGARD IS JUDGED AGAINST THE REST OF ITS FIELD, NOT AGAINST THE FIELD INCLUDING ITSELF.
  // The whole point of this finding is a value carrying most of the money — which drags the
  // blended figure onto itself, so "below the field" could almost never fire against exactly the
  // case worth raising (Ray's own: the biggest-spending value at 86% of the spend reads within a
  // whisker of a blend it IS). The rest of the field is the honest comparison, and it is what the
  // evidence line states, beside the field's own figure.
  const rest = top ? { spend: r2(read.spend - top.spend), rev: r2(read.rev - top.rev) } : null;
  const restRoas = rest && rest.spend > 0 ? r2((rest.rev / rest.spend) * 100) : null;
  const lag = top && top.share >= SL_BIG && top.roas != null && restRoas != null && top.roas <= restRoas * SL_LAG ? top : null;

  // (1) STARVED WINNERS — ranked by what the gap is worth: the spend on the value × how far its
  // return runs ahead of the field. That is arithmetic on two readings, never a forecast.
  const wins = read.solid.filter((x) => x.roas != null && x.roas >= read.blended * SL_WIN && x.share <= SL_SMALL)
    .map((x) => Object.assign({ worth: r2(x.spend * (x.roas / read.blended - 1)) }, x))
    .sort((a, b) => b.worth - a.worth).slice(0, 4);
  if (wins.length) {
    const lead = wins[0];
    // the swing is stated as what it IS: a tenth of the laggard's spend, earning the winner's own
    // return instead of the laggard's. Both numbers are on the screen; nothing is predicted.
    let swing = null;
    if (lag) {
      const mv = r2(lag.spend * SL_MOVE);
      swing = { mv, cur: c, from: r2(mv * (lag.roas / 100)), to: r2(mv * (lead.roas / 100)), fromV: lag.v, toV: lead.v };
    }
    out.push({ k: 'starved', market, agg: read.agg, cur: c, worth: wins.reduce((a, x) => a + x.worth, 0),
      head: wins.map((x) => x.v).slice(0, 4).join(', ') + ' return more than ' + name + ' does as a whole',
      ev: wins.map((x) => x.v + ' ' + fmtPct(x.roas) + ' on ' + fmtMoney(c, x.spend)).join(' · ')
        + ' — against ' + fmtPct(read.blended) + ' across ' + fmtMoney(c, read.spend),
      swing, vals: wins, blended: read.blended });
  }

  // (2) THE MONEY ON THE LAGGARD — Ray's own reading of the Reiss pivot
  if (lag) {
    out.push({ k: 'laggard', market, agg: read.agg, cur: c, worth: r2(lag.spend * (1 - lag.roas / restRoas)),
      head: fmtShare(lag.share) + ' of the ' + name + ' spend sits on ' + lag.v + ', which returns less than the rest',
      ev: lag.v + ' ' + fmtPct(lag.roas) + ' on ' + fmtMoney(c, lag.spend) + ' of ' + fmtMoney(c, read.spend)
        + ' — the rest of the field returns ' + fmtPct(restRoas) + ' on ' + fmtMoney(c, rest.spend)
        + ' (the field as a whole ' + fmtPct(read.blended) + ')',
      vals: [lag], rest: Object.assign({ roas: restRoas }, rest), blended: read.blended });
  }

  // (3) SPEND THAT RETURNED NOTHING
  const dead = read.solid.filter((x) => x.rev <= 0);
  if (dead.length) {
    const sp = r2(dead.reduce((a, x) => a + x.spend, 0));
    out.push({ k: 'dead', market, agg: read.agg, cur: c, worth: sp,
      head: fmtMoney(c, sp) + ' on ' + dead.length + ' ' + name + ' value' + (dead.length === 1 ? '' : 's') + ' returned nothing',
      ev: dead.slice(0, 5).map((x) => x.v + ' ' + fmtMoney(c, x.spend)).join(' · ') + (dead.length > 5 ? ' · +' + (dead.length - 5) + ' more' : ''),
      vals: dead.slice(0, 8), blended: read.blended });
  }
  return out.sort((a, b) => b.worth - a.worth);
}

// the market's own unlisted spend — read off the market's Total row set, not off a cut, so it is
// raised once per market however many cuts have been read
export function unlistedFinding(market, unl, totalSpend) {
  if (!unl || !(unl.spend > 0)) return null;
  const c = unl.cur;
  return { k: 'unlisted', market, agg: null, cur: c, worth: unl.spend,
    head: fmtMoney(c, unl.spend) + ' is being spent on products this feed no longer carries',
    ev: fmtMoney(c, unl.spend) + (totalSpend > 0 ? ' of ' + fmtMoney(c, totalSpend) + ' (' + fmtShare(unl.spend / totalSpend) + ')' : '')
      + ' went to SKUs Google Ads is still serving and the market’s feed does not hold'
      + (unl.rev > 0 ? ' — they returned ' + fmtMoney(c, unl.rev) : ' — they returned nothing'),
    vals: [], blended: null };
}

/* ---- the whole account ------------------------------------------------------------------------
 * markets: [{ market, cmpid, spend, cur, unlisted }] spend-ranked, from the ROAS index.
 * reads:   { '<market>|<agg>': cutRead-input rows | {missing:true} | null (never read) }
 */
export function accountLens(markets, reads, opts) {
  opts = opts || {};
  const want = (opts.cuts || SL_CUT_KEYS);
  const out = [], toRead = [], refused = [], cuts = [];
  (markets || []).forEach((m) => {
    want.forEach((agg) => {
      const r = reads ? reads[m.market + '|' + agg] : null;
      if (!r) { toRead.push({ market: m.market, agg }); return; }
      if (r.missing) { refused.push({ market: m.market, agg, why: 'FeedHero has not set this cut up for ' + m.market }); return; }
      const read = cutRead(agg, r.rows, opts);
      if (!read.ok) { refused.push({ market: m.market, agg, why: read.why }); return; }
      cuts.push({ market: m.market, agg, read, at: r.at || 0 });
      cutFindings(read, m.market).forEach((f) => out.push(f));
    });
    const u = unlistedFinding(m.market, m.unlisted, m.spend);
    if (u) out.push(u);
  });
  // ONE finding of a kind per market: the same shape read on four cuts of the same catalogue is
  // one thing to do, not four, so the richest reading of each kind leads and the rest ride with it.
  const seen = Object.create(null), top = [], also = [];
  out.sort((a, b) => b.worth - a.worth).forEach((f) => {
    const key = f.market + '|' + f.k;
    if (seen[key]) { also.push(f); return; }
    seen[key] = 1; top.push(f);
  });
  return { top, also, cuts, toRead, refused, markets: (markets || []).map((m) => m.market) };
}

// the brief a finding raises — the words that reach the ticket, never a figure nobody can check
export function briefOf(f, client) {
  const t = tacticOf(f.k);
  const where = f.agg ? cutName(f.agg) : 'the market';
  return {
    task: 'Spend Lens - ' + (t ? t.t : f.k) + ' - ' + client + ' ' + s0(f.market).toUpperCase(),
    cat: f.k === 'unlisted' ? 'technical' : 'account',
    scope: [t ? t.why : '', 'Where: ' + client + ' ' + s0(f.market).toUpperCase() + (f.agg ? ' · by ' + where : ''),
      'What the read says: ' + f.ev,
      f.swing ? 'For scale: moving a tenth of ' + f.swing.fromV + '’s spend (' + fmtMoney(f.swing.cur, f.swing.mv) + ') to ' + f.swing.toV + '’s own return is ' + fmtMoney(f.swing.cur, f.swing.to) + ' instead of ' + fmtMoney(f.swing.cur, f.swing.from) + ' — arithmetic on two readings, not a forecast.' : '',
      'Read from FeedHero’s Google Ads report over the last 30 days.'].filter(Boolean).join('\n'),
  };
}
