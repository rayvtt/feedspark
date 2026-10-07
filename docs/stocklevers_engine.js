/*
 * FeedSpark stock levers — BAU ↔ SALE (Ray, 5 Oct 2026: "summarise a stock management dashboard for Superdry
 * (specifically) eahc of those markets have got quite aan interesting mix of stock levers : 1 . Range Completion
 * (20-40%, currently at 35%) - 2. Stock unit exclusion for Everest (previously >5 units per size, now N/A) - 3. Hero
 * Sizes (current activated, follow the mapping above) - build an facilitor interface to action BAU vs. SALE perido").
 *
 * A LEVER is one stock control a brand flexes between business as usual and a sale period. EVERY brand carries the same
 * four (Ray, 7 Oct 2026: "every client should have these stock levers: 1. range completion 2. hero sizes 3. stock
 * quantity threshold 4. stock based exclusion"): the range-completion line under which a style is held back, hero-size
 * protection, the stock quantity under which a product goes out of stock, and a stock-based exclusion (a minimum of
 * units per size, for a range where the lever names one — Superdry's Everest). A brand with no plan saved still reads
 * all four off its rules. The FCC cannot change a FeedHero rule — the rule report is read-only — so this is a FACILITATOR: it reads
 * what each market runs today off its own FeedHero rules (and, for range completion, the line the master-stock agent
 * MEASURED from the products, /stock §3i), holds the brand's BAU and SALE value for each lever (and a market's own
 * where it differs), plans the sale periods, and turns a switch into the exact list of rules to change in which markets
 * — to brief, to copy, and to mark done, so the whole team sees which markets are in which mode.
 *
 * One file, two lanes: the /stock page (window.StockLevers, served verbatim at /stock/levers.js) and
 * tools/test_stocklevers.mjs. The worker's half — what a signin may store, the seeded plan — is
 * cloudflare/feedspark-deck/src/stocklevers.js.
 *
 * NOTHING HERE IS A GUESS. A value nobody set reads "not set", a market whose rules are unread reads "not read", and a
 * reading names the rule it comes from.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockLevers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '2.0.0';
  // the levers EVERY brand carries (Ray, 7 Oct 2026: "every client should have these stock levers: 1. range completion
  // 2. hero sizes 3. stock quantity threshold 4. stock based exclusion") — in his order; keys are the store's, labels the
  // card's. Each reads the rules of ONE stock mechanism (src/rules.js MECHANISMS), so a lever and its column in "Which
  // stock controls each market runs" can never be read off different rules.
  //   kind: pct (a %, inside the brand's band), units (a count, or off = N/A), onoff
  //   a units lever's number is said ONE way per lever (op): the threshold "< N units" (out of stock below N), the
  //   exclusion "> N units per size" (kept only above N — Ray's own words for Superdry's Everest)
  var LEVERS = [
    { k: 'rc', label: 'Range completion', kind: 'pct', unit: '%', mech: ['range'],
      q: 'The range-completion line: a style whose share of sizes in stock falls below it is held back' },
    { k: 'hero', label: 'Hero sizes', kind: 'onoff', mech: ['hero'],
      q: 'Hero-size protection: the sizes a market keeps live, from the brand’s hero-size mapping' },
    { k: 'thresh', label: 'Stock quantity threshold', short: 'Stock threshold', kind: 'units', op: '<', unit: 'units', mech: ['threshold'],
      q: 'A product or size goes out of stock below this many units' },
    { k: 'excl', label: 'Stock-based exclusion', short: 'Stock exclusion', kind: 'units', op: '>', unit: 'units per size', mech: ['excl'],
      q: 'A size is left out of the feed unless it carries more than this many units — for the range the lever names' }
  ];
  var LEVER = {}; LEVERS.forEach(function (l) { LEVER[l.k] = l; });
  // a key the store held before the four levers: Superdry's "Stock unit exclusion for Everest" (5 Oct 2026) was the
  // `units` lever — it IS the stock-based exclusion, and is read as one wherever it is found (plan, own values, records)
  var LEGACY = { units: 'excl' };
  function keyOf(k) { return LEGACY[k] || k; }
  function isUnits(lk) { return !!LEVER[lk] && LEVER[lk].kind === 'units'; }
  var DRIFT_PP = 2;   // a measured range-completion line this far from the target (points) is off target

  function s0(v) { return v == null ? '' : String(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  // a value: a number (% or units), 'on', 'off', or null (nobody has set it)
  function isSet(v) { return v === 'on' || v === 'off' || num(v) != null; }
  function same(a, b) { return isSet(a) && isSet(b) && String(a) === String(b); }
  function fmtVal(lk, v) {
    lk = keyOf(lk);
    if (!isSet(v)) return 'not set';
    if (v === 'off') return isUnits(lk) ? 'N/A' : 'off';
    if (v === 'on') return 'on';
    var l = LEVER[lk] || {};
    return l.kind === 'pct' ? v + '%' : l.kind === 'units' ? l.op + ' ' + v + ' ' + l.unit : String(v);
  }
  // ---- A STOCK CUT-OFF, SAID TWO WAYS ------------------------------------------------------------------------------
  // A rule's name states its cut-off its own way ("Stock < 11 -> OOS", "quantity with 3 or less", "> 5 units per size"),
  // the plan states it the lever's way. Both reduce to the fewest units a product needs to STAY live (ml) — a name
  // states the held-back side with < ≤ = (stock < 11 → out: live from 11), the kept side with > ≥ (> 5 kept: live from 6).
  // The cell prints the rule's own words; ml is only what is compared, so "≤ 3" and the plan's "< 4" are one setting.
  function mlOf(op, v) { return op === '<' ? v : op === '≥' ? v : v + 1; }
  function planMl(lk, v) { return num(v) == null ? null : LEVER[lk].op === '<' ? v : v + 1; }
  function fromMl(lk, ml) { return LEVER[lk].op === '<' ? ml : ml - 1; }
  function cutWord(c) { return c ? c.op + ' ' + c.v : ''; }

  // ---- THE STORE (KV stocklevers — one kvmerge map, a key per decision) ------------------------------------------------
  //   'p:<Brand>'          the brand's plan: {levers:[{k, bau, sale, lo?, hi?, scope?, was?, note?, rule?:{n, mk, d}}],
  //                        note, by, at} — rule = the ONE FeedHero rule the lever is read from: its name, the market it
  //                        was picked in, the field it writes
  //   'm:<Brand>|<MKT>'    a market's own values where they differ: {lv:{<k>:{bau?, sale?}}, by, at}
  //   'e:<Brand>|<id>'     a sale period: {name, from, to (YYYY-MM-DD), mk:[markets], sale:{st, by, at}, bau:{st, by, at}, by, at}
  //                        st: planned → briefed → done
  //   'r:<Brand>|<id>'     a RECORD, kept by hand (Ray, 6 Oct 2026: "maybe there should be a manual table as well to keep
  //                        record of it"): {d (YYYY-MM-DD), mk:[markets], k, mode ('bau'|'sale'|''), v, was?, note, src?,
  //                        by, at, ed?} — what was set in FeedHero, on which day, where, and who wrote it down. It never
  //                        moves a reading: the matrix says what the rules read, the record says what a person set.
  function planOf(store, brand) { var p = store && store['p:' + brand]; return p && Array.isArray(p.levers) ? p : null; }
  // the brand's four levers in their fixed order, whether or not anybody has saved a plan — what the plan holds for a
  // lever, else nothing set (a brand with no plan still reads every lever off its rules); a legacy key is read as the
  // lever it now is, and the first entry for a lever wins
  function planLevers(plan) {
    var held = {};
    ((plan && plan.levers) || []).forEach(function (l) {
      var k = l && keyOf(l.k); if (!k || !LEVER[k] || held[k]) return;
      var o = {}; Object.keys(l).forEach(function (x) { o[x] = l[x]; }); o.k = k; held[k] = o;
    });
    return LEVERS.map(function (L) { return held[L.k] || { k: L.k, bau: null, sale: null }; });
  }
  function leverOf(plan, lk) { return planLevers(plan).filter(function (x) { return x.k === lk; })[0]; }
  function marketOf(store, brand, mk) { return (store && store['m:' + brand + '|' + mk]) || null; }
  // a market's own values for one lever (a legacy key read as the lever it is now)
  function ownOf(mo, lk) {
    var lv = mo && mo.lv; if (!lv) return null;
    if (lv[lk]) return lv[lk];
    for (var k in LEGACY) if (LEGACY[k] === lk && lv[k]) return lv[k];
    return null;
  }
  function periodsOf(store, brand) {
    var pre = 'e:' + brand + '|', out = [];
    Object.keys(store || {}).forEach(function (k) { var e = store[k]; if (k.indexOf(pre) === 0 && e && e.from && e.to) out.push(Object.assign({ id: k.slice(pre.length) }, e)); });
    return out.sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : (a.id < b.id ? -1 : 1); });
  }
  // the brand's records, newest day first (the newest written first within a day)
  function recordsOf(store, brand) {
    var pre = 'r:' + brand + '|', out = [];
    Object.keys(store || {}).forEach(function (k) { var e = store[k]; if (k.indexOf(pre) === 0 && e && e.d && LEVER[keyOf(e.k)]) out.push(Object.assign({ id: k.slice(pre.length) }, e, { k: keyOf(e.k) })); });
    return out.sort(function (a, b) { return a.d > b.d ? -1 : a.d < b.d ? 1 : ((b.at || 0) - (a.at || 0)) || (a.id < b.id ? -1 : 1); });
  }
  // the newest record for one market and lever — null when nobody recorded one
  function lastRecord(recs, mk, lk) {
    for (var i = 0; i < (recs || []).length; i++) if (recs[i].k === lk && (recs[i].mk || []).indexOf(mk) >= 0) return recs[i];
    return null;
  }
  // a switch made, as records: one per change in its list (the markets, the lever, from → to, in the mode switched to),
  // frozen the day it is written — a plan edited later never rewrites what was recorded
  function switchRecords(sw, p, today) {
    return (sw && sw.changes || []).map(function (c) {
      var r = { d: today, mk: c.mk.slice(), k: c.k, mode: sw.dir, v: c.to, note: (p ? p.name + ' — ' : '') + (sw.dir === 'sale' ? 'switch to SALE' : 'back to BAU'), src: p ? 'e:' + p.id + '|' + sw.dir : '' };
      if (isSet(c.from)) r.was = c.from;
      return r;
    });
  }
  // one record in words: "35% → 20% (SALE)"
  function recordWord(r) { return (isSet(r.was) ? fmtVal(r.k, r.was) + ' → ' : '') + fmtVal(r.k, r.v) + (r.mode ? ' (' + r.mode.toUpperCase() + ')' : ''); }

  // a lever's value in one market and one mode: the market's own, else the brand's
  function valueOf(plan, mo, lk, mode) {
    var own = ownOf(mo, lk);
    if (own && own[mode] !== undefined && own[mode] !== null) return own[mode];
    var l = leverOf(plan, lk);
    return l ? (l[mode] === undefined ? null : l[mode]) : null;
  }
  function ownSet(mo, lk) { var o = ownOf(mo, lk); return !!(o && (isSet(o.bau) || isSet(o.sale))); }

  // ---- WHAT A MARKET RUNS TODAY — read off its own FeedHero rules ------------------------------------------------------
  // m = one market as /api/rules/stock serves it: {market, cmpid, stock:[rows], av:{held:{line, stated}}}
  //   → {state, val, how, rules, why}
  //   state: on · off · paused · part (a rule runs but nothing sets what it reads) · none (the market runs no rule for it)
  //   val:   the reading's number (rc: the measured line, else a cut-off a rule name states) — null when none
  var PAUSE = /\b(pause[ds]?|paused|disable[ds]?|suspend(ed)?|stop(ped)?|switch(ed)? off|turn(ed)? off|temporar(il)?y (pause|off|stop))\b/i;
  // a range-completion rule by its NAME as well as its mechanism: the rules engine files most of them under availability
  // (the field they write — Superdry's "Range Completion by Availability", "Range Completion < 0.21 ( 20% completion)")
  var RC_NAME = /\b(range[\s-]*completion|rc)\b/i, HERO_NAME = /\bhero\b/i;
  // a percentage a range-completion rule's name states without a comparison ("Range Completion (BAU & Peak) - 20%")
  function namePct(n) { var m = /(\d{1,2}(?:\.\d+)?)\s*%/.exec(s0(n)); return m ? +m[1] : null; }
  // a lever is read on the Google Shopping side: a rule for Meta or the affiliates, or a label that only names a level, is
  // not the lever (Superdry's "Social: RC > 65% -> out of stock" is Meta's own line)
  function gch(r) { return !r.ch || r.ch === 'all' || r.ch === 'google'; }
  function pick(r) { return { i: r.i, n: r.n, t: r.t, d: r.d, imp: r.imp, of: r.of, mo: r.mo, mb: r.mb, cut: r.cut || [] }; }
  function wordIn(name, scope) {
    var w = s0(scope).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return !!w && (' ' + s0(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ').indexOf(' ' + w + ' ') >= 0;
  }
  function scopeOk(r, lever) { var sc = lever && lever.scope; return !sc || wordIn(r.n, sc) || wordIn(r.b, sc); }
  // the first stock cut-off a rule's name states ("Stock < 11 -> OOS"), with the units it keeps a product live from
  function stockCut(r) {
    var c = ((r && r.cut) || []).filter(function (x) { return x.m === 'stock' && num(x.v) != null; })[0];
    return c ? { op: c.op, v: c.v, ml: mlOf(c.op, c.v), rule: r.n } : null;
  }
  // WHETHER A STOCK RULE HOLDS PRODUCTS BACK — the rules engine's own answer (src/rules.js heldBack, served on every stock
  // row as hb) when the route sent it, else the same reading of the rule's field and name. A stock threshold is a rule that
  // holds stock back: one that only works out a number other rules act on (Schuh's "Calculate stock count details"), that
  // restates a state ("Not available to Zero") or that lets products back in is a threshold-field rule, not a threshold.
  var RELEASE = /\binclu(de|ded|des|sion)\b|\bre-?add|\bre-?instate|\ballow(ed)?\b|\bwhitelist/i;
  var BLOCKWORD = /\boos\b|out of stoc|->\s*0\b|to zero|not available|unavailable|\bexclu|\bremov|\bhide|\bblock|\bempty\b|\bpause/i;
  var MIRROR = /^\s*(not available|unavailable|out of stock|oos|sold out)\b.*(\bto\b|->)\s*(zero|0)\b/i;
  function holdKind(r) {
    if (r && r.hb && r.hb.kind) return r.hb.kind;
    var d = s0(r && r.d), n = s0(r && r.n), cut = (r && r.cut) || [];
    if (RELEASE.test(n)) return 'releases';
    var blocks = /exclu|(^|_)exclude|excl_|destination|eligible/.test(d) || (/stock_status|availability|(^|_)avail$|_avail$/.test(d) && (cut.length > 0 || BLOCKWORD.test(n)))
      || (/stock|quantity|(^|_)qty/.test(d) && (BLOCKWORD.test(n) || cut.length > 0));
    if (!blocks) return 'calc';
    return MIRROR.test(n) ? 'mirror' : 'blocked';
  }
  function holds(r) { var k = holdKind(r); return k !== 'calc' && k !== 'mirror' && k !== 'releases'; }
  var ASIDE = { calc: 'works out a stock figure other rules act on', mirror: 'restates availability as zero stock', releases: 'lets products back in' };
  // the rules that READ as a lever in a market (no connection made), on the Google side: range completion by its
  // mechanism or its name; a hero-size rule; a stock quantity threshold = a threshold rule that holds stock back, or an
  // availability rule whose name states a stock cut-off; a stock-based exclusion = an exclusion rule for stock reasons (an
  // exclusion BY range completion is the range-completion lever's). A units lever scoped to a range ("Everest") reads only
  // the rules that name it.
  // A units lever scoped to a range ("Stock-based exclusion · Everest") reads the rules naming that range on ANY field that
  // holds stock back — a threshold field, an exclusion field, or availability with a stock cut-off — because a range's own
  // unit rule is the scoped lever whichever field the team wrote it on; the other units lever then leaves those rules to it
  // (lever.sib = the other units levers' ranges, set by sibbed()), so one rule never reads as two levers.
  function cands(lk, m, lever) {
    var st = (m && m.stock) || [];
    lk = keyOf(lk);
    var rcOrHero = function (r) { return RC_NAME.test(s0(r.n)) || HERO_NAME.test(s0(r.n)); };
    if (lk === 'rc') return st.filter(function (r) { return gch(r) && r.sk !== 'label' && (r.sk === 'range' || RC_NAME.test(s0(r.n))) && !HERO_NAME.test(s0(r.n)); });
    if (lk === 'hero') return st.filter(function (r) { return gch(r) && (r.sk === 'hero' || HERO_NAME.test(s0(r.n))); });
    if (lk !== 'thresh' && lk !== 'excl') return [];
    var sc = s0(lever && lever.scope).trim(), sib = (lever && lever.sib) || [];
    var onStock = function (r) { return r.sk === 'threshold' || r.sk === 'excl' || (r.sk === 'avail' && !!stockCut(r)); };
    return st.filter(function (r) {
      if (!gch(r) || rcOrHero(r) || !holds(r)) return false;
      if (sc) return onStock(r) && (wordIn(r.n, sc) || wordIn(r.b, sc));
      if (sib.some(function (w) { return wordIn(r.n, w) || wordIn(r.b, w); })) return false;
      return lk === 'thresh' ? r.sk === 'threshold' || (r.sk === 'avail' && !!stockCut(r)) : r.sk === 'excl';
    });
  }
  // the levers as they are READ: each units lever told the ranges the other units levers are scoped to
  function sibbed(levs) {
    var sc = {};
    (levs || []).forEach(function (l) { if (isUnits(l.k) && s0(l.scope).trim()) sc[l.k] = s0(l.scope).trim(); });
    return (levs || []).map(function (l) {
      if (!isUnits(l.k)) return l;
      var o = {}; Object.keys(l).forEach(function (x) { o[x] = l[x]; });
      o.sib = Object.keys(sc).filter(function (k) { return k !== l.k; }).map(function (k) { return sc[k]; });
      return o;
    });
  }
  // a units lever's mechanism rules that were SET ASIDE as not holding stock back — named, so a market whose coverage
  // column counts a threshold rule while its lever reads none says why
  function aside(lk, m) {
    var mech = keyOf(lk) === 'thresh' ? 'threshold' : keyOf(lk) === 'excl' ? 'excl' : '';
    return ((m && m.stock) || []).filter(function (r) { return mech && gch(r) && r.sk === mech && !holds(r); })
      .map(function (r) { return { i: r.i, n: r.n, why: ASIDE[holdKind(r)] || '' }; });
  }

  // ---- ONE RULE PER LEVER (Ray, 6 Oct 2026: "the same rules (same rule name) will be applied/copied across all different
  // markets. Each individual stock lever will be connected to one rule, and that rule could be spotted or aggregated across
  // different markets. For example, with Superdry UK and range completion, there are currently two overlapping logics rule
  // on the dashboard; there should be only one that makes sense at any time. Allow a connection between a lever and a rule
  // in a specific market, and then that same rule can be spotted or monitored across the remaining markets").
  // The plan's lever carries rule:{n, mk, d} — the rule's NAME, picked as market mk runs it, and the FIELD it writes (d).
  // Every market's reading then comes from that ONE rule in it, alone; a market without it reads MISSING — never another
  // rule's value in its place.
  // WHICH rule is "that rule" in another market (Ray, 6 Oct 2026, on Superdry FR: "i see this rule … but system is not
  // picking it up"): the copies DRIFT in name — Superdry's hold rule is "Range Completion by Availability" in GB, ES and
  // BE-NL, "Range Completion based Availability" in FR, DE, DK, FI and nine more, "Availability by Range completion" in IE,
  // "Range Completion (BAU & Peak) - 20%" in IT and NL — while its JOB never moves: every one writes Availability. So a
  // market's copy is, in order: the same name writing the same field; else the one rule doing the same job — reading as
  // the lever and writing that field (the closest name when more than one does); else none. NO and PL even carry ONE name
  // on two rules (one writes Availability, the other RC Availability) — the field is what tells them apart.
  // A name is compared as FeedHero copies it: case, spacing and typographic quotes / dashes set aside, every word kept.
  function nameKey(n) {
    var s = s0(n); if (s.normalize) s = s.normalize('NFKC');
    return s.toLowerCase().replace(/[‘’‚‛`]/g, "'").replace(/[“”„]/g, '"').replace(/[‐-―−]/g, '-').replace(/\s+/g, '');
  }
  function sameName(a, b) { return !!nameKey(a) && nameKey(a) === nameKey(b); }
  function boundOf(lever) { return lever && lever.rule && s0(lever.rule.n).trim() ? lever.rule : null; }
  // how alike two names are — the share of their words in common, the joining words ("by", "based on") set aside
  var STOPW = { by: 1, based: 1, on: 1, the: 1, of: 1, with: 1, and: 1, for: 1, a: 1, an: 1, to: 1, in: 1 };
  function nameToks(n) { var s = s0(n); if (s.normalize) s = s.normalize('NFKC'); var o = {}; s.toLowerCase().split(/[^a-z0-9%]+/).forEach(function (w) { if (w && !STOPW[w]) o[w] = 1; }); return o; }
  function nameSim(a, b) {
    var A = nameToks(a), B = nameToks(b), u = {}, n = 0;
    Object.keys(A).forEach(function (w) { u[w] = 1; if (B[w]) n++; }); Object.keys(B).forEach(function (w) { u[w] = 1; });
    var t = Object.keys(u).length; return t ? n / t : 0;
  }
  // a market's copy of the connected rule: {r, mt: 'name' | 'job'}, or null
  function findRule(lk, m, lever, bd) {
    var st = (m && m.stock) || [];
    var named = st.filter(function (r) { return sameName(r.n, bd.n) && (!bd.d || r.d === bd.d); });
    if (named.length) return { r: named[0], mt: 'name' };
    if (!bd.d) return null;   // a field nobody knows: the name alone
    var pool = cands(lk, m, lever).filter(function (r) { return r.d === bd.d; });
    // a rule picked from "every stock rule" does not read as the lever: its copy writes the same field under a near name
    if (!pool.length) pool = st.filter(function (r) { return r.d === bd.d && nameSim(r.n, bd.n) >= 0.5; });
    if (!pool.length) return null;
    pool = pool.slice().sort(function (a, b) { return nameSim(b.n, bd.n) - nameSim(a.n, bd.n) || (a.i || 0) - (b.i || 0); });
    return { r: pool[0], mt: 'job', of: pool.length };
  }
  // the connected rule's FIELD, read off the market it was picked in when the plan does not carry it (a lever connected
  // before the field was stored) — never written back, and a rule that market no longer runs keeps the name alone
  function resolved(lever, markets) {
    var bd = boundOf(lever); if (!bd || bd.d) return lever;
    var ms = (markets || []).filter(function (x) { return x && x.market === bd.mk; }).concat(markets || []), r = null;
    for (var i = 0; i < ms.length && !r; i++) r = ((ms[i] && ms[i].stock) || []).filter(function (y) { return sameName(y.n, bd.n); })[0] || null;
    if (!r || !r.d) return lever;
    var o = {}; Object.keys(lever).forEach(function (k) { o[k] = lever[k]; });
    o.rule = { n: bd.n, mk: bd.mk, d: r.d };
    return o;
  }
  function reading(lk, m, lever) {
    lk = keyOf(lk);
    var bd = boundOf(lever);
    if (bd) return bound(lk, m, lever, bd);
    var rd = loose(lk, m, lever);
    // more than one rule reads as the lever and none is connected — the overlap the connection exists to end
    if (rd.rules && rd.rules.length > 1) rd.overlap = rd.rules.length;
    return rd;
  }
  // a connected lever: the one rule of that name, or missing (the rules that would otherwise read as it named beside it)
  function bound(lk, m, lever, bd) {
    var cand = cands(lk, m, lever), f = findRule(lk, m, lever, bd);
    if (!f) {
      var oth = cand.map(pick);
      return { state: isUnits(lk) ? 'off' : 'none', val: null, how: '', rules: [], bound: bd.n, miss: true, others: oth,
        why: '“' + bd.n + '” is not in this market' + (bd.d ? ', nor a rule doing its job' : '') + (oth.length ? ' — it runs ' + (oth.length === 1 ? '“' + oth[0].n + '”' : oth.length + ' other rules that read as this lever') + ' instead' : '') };
    }
    var r = f.r, others = cand.filter(function (x) { return x !== r; }).map(pick);
    var base = { rules: [pick(r)], bound: bd.n, mt: f.mt, as: f.mt === 'job' ? r.n : '', others: others, idle: r.imp === 0 };
    var put = function (o) { Object.keys(o).forEach(function (k) { base[k] = o[k]; }); return base; };
    if (lk === 'rc') {
      var held = m && m.av && m.av.held, line = held && held.state === 'ok' && held.line ? held.line : null;
      var st0 = null; (r.cut || []).forEach(function (c) { if (c.m === 'rc' && !st0) st0 = { rule: r.n, op: c.op, v: c.v }; });
      if (!st0) { var np = namePct(r.n); if (np != null && np > 0 && np < 100) st0 = { rule: r.n, op: '', v: np }; }
      if (line) return put({ state: 'on', val: line.x, lo: line.lo, hi: line.hi, how: 'line', stated: st0 ? [st0] : [], why: 'The line measured from the products the Google feed is not sent — the connected rule runs here' });
      if (st0) return put({ state: 'on', val: st0.v, how: 'name', stated: [st0], why: 'The cut-off the connected rule’s name states — no line could be measured' });
      return put({ state: 'on', val: null, how: 'rules', stated: [], why: 'The connected rule runs; its cut-off is not in its name and no line could be measured' });
    }
    if (isUnits(lk)) {
      var uc = stockCut(r);
      return put({ state: 'on', val: uc ? fromMl(lk, uc.ml) : null, cut: uc, ml: uc ? uc.ml : null, how: uc ? 'name' : 'rules', why: uc ? 'The cut-off the connected rule’s name states' : 'The connected rule runs; its cut-off is not in its name' });
    }
    if (lk === 'hero') {
      if (PAUSE.test(s0(r.n))) return put({ state: 'paused', val: null, how: 'rules', pause: [pick(r)], why: 'The connected rule pauses hero sizes' });
      return put({ state: 'on', val: null, how: 'rules', why: 'Hero sizes run on the connected rule' });
    }
    return put({ state: 'none', val: null, how: '', why: '' });
  }
  // no rule connected: every rule that reads as the lever, as before
  function loose(lk, m, lever) {
    var rs = cands(lk, m, lever);
    if (lk === 'rc') {
      var rr = rs, held = m && m.av && m.av.held, line = held && held.state === 'ok' && held.line ? held.line : null;
      var stated = [];
      rr.forEach(function (r) { (r.cut || []).forEach(function (c) { if (c.m === 'rc') stated.push({ rule: r.n, op: c.op, v: c.v }); }); });
      if (!stated.length) rr.forEach(function (r) { var v = namePct(r.n); if (v != null && v > 0 && v < 100) stated.push({ rule: r.n, op: '', v: v }); });
      if (!rr.length) return { state: 'none', val: null, how: '', rules: [], why: 'No range-completion rule runs in this market' };
      if (line) return { state: 'on', val: line.x, lo: line.lo, hi: line.hi, how: 'line', rules: rr.map(pick), stated: stated, why: 'The line measured from the products the Google feed is not sent' };
      if (stated.length) return { state: 'on', val: stated[0].v, how: 'name', rules: rr.map(pick), stated: stated, why: 'The cut-off a rule’s name states — no line could be measured' };
      return { state: 'on', val: null, how: 'rules', rules: rr.map(pick), stated: [], why: 'Range-completion rules run; their cut-off is not in a name and no line could be measured' };
    }
    if (isUnits(lk)) {
      var scope = lever && lever.scope, ur = rs, word = lk === 'thresh' ? 'stock quantity threshold' : 'stock-based exclusion';
      if (!ur.length) {
        var ad = aside(lk, m);
        return { state: 'off', val: null, how: '', rules: [], aside: ad,
          why: 'No ' + word + (scope ? ' for ' + scope : '') + ' holds products back here' + (ad.length ? ' — ' + ad.slice(0, 3).map(function (x) { return '“' + x.n + '” ' + x.why; }).join('; ') : '') };
      }
      var cut = null; ur.forEach(function (r) { if (!cut) cut = stockCut(r); });
      return { state: 'on', val: cut ? fromMl(lk, cut.ml) : null, cut: cut, ml: cut ? cut.ml : null, how: cut ? 'name' : 'rules', rules: ur.map(pick),
        why: cut ? 'The cut-off a rule’s name states' : 'A ' + word + ' runs; its cut-off is not in its name' };
    }
    if (lk === 'hero') {
      var hr = rs;
      if (!hr.length) return { state: 'none', val: null, how: '', rules: [], why: 'No hero-size rule runs in this market' };
      var pause = hr.filter(function (r) { return PAUSE.test(s0(r.n)); });
      var setr = hr.filter(function (r) { return pause.indexOf(r) < 0 && (/hero_size/i.test(s0(r.d)) || /\bset\b.*hero|hero size values/i.test(s0(r.n))); });
      var keep = hr.filter(function (r) { return pause.indexOf(r) < 0 && setr.indexOf(r) < 0; });
      if (pause.length) return { state: 'paused', val: null, how: 'rules', rules: hr.map(pick), pause: pause.map(pick), why: 'A rule that pauses hero sizes is active: “' + pause[0].n + '”' };
      if (!setr.length) return { state: 'part', val: null, how: 'rules', rules: hr.map(pick), why: '“' + hr[0].n + '” runs, but no rule here sets the hero sizes it reads' };
      return { state: 'on', val: null, how: 'rules', rules: hr.map(pick), why: 'Hero sizes are set by “' + setr[0].n + '”' + (keep.length ? ' and kept live by “' + keep[0].n + '”' : '') };
    }
    return { state: 'none', val: null, how: '', rules: [], why: '' };
  }
  // the rules a lever can be connected to, as ONE market runs them: those that read as the lever first, the one the most
  // markets run first among them (the rule that was copied), then FeedHero's run order; every other stock rule after them
  // when asked. Each names the markets where it would be found (carry) and those running it under the same name (same).
  function ruleChoices(lk, markets, mk, lever, all) {
    var m = (markets || []).filter(function (x) { return x.market === mk; })[0]; if (!m) return [];
    var cand = cands(lk, m, lever), pool = all ? (m.stock || []).slice() : cand.slice(), seen = {};
    return pool.filter(function (r) { var k = nameKey(r.n) + '|' + s0(r.d); if (!nameKey(r.n) || seen[k]) return false; seen[k] = 1; return true; }).map(function (r) {
      var bx = { n: r.n, d: r.d }, carry = [], same = [];
      (markets || []).forEach(function (x) { var f = x && findRule(lk, x, lever, bx); if (f) { carry.push(x.market); if (f.mt === 'name') same.push(x.market); } });
      return { n: r.n, i: r.i, t: r.t, d: r.d, imp: r.imp, of: r.of, ch: r.ch || '', sk: r.sk || '', fits: cand.indexOf(r) >= 0, carry: carry, same: same };
    }).sort(function (a, b) { return (b.fits ? 1 : 0) - (a.fits ? 1 : 0) || b.carry.length - a.carry.length || (a.i || 0) - (b.i || 0); });
  }
  // does the market run its target? null = it does (or there is no target to hold it to)
  function drift(lk, rd, tgt) {
    lk = keyOf(lk);
    if (!isSet(tgt) || !rd) return null;
    if (lk === 'rc') {
      if (tgt === 'off') return rd.state === 'on' ? { why: 'Range-completion rules still run' } : null;
      if (rd.state === 'none') return { why: rd.miss ? 'The connected rule “' + rd.bound + '” is not in this market' : 'No range-completion rule runs here' };
      if (rd.val == null) return null;   // a line nobody could measure is not a drift
      return Math.abs(rd.val - tgt) > DRIFT_PP ? { why: (rd.how === 'line' ? 'Measured ≈' : 'A rule name states ') + rd.val + '% — the target is ' + tgt + '%' } : null;
    }
    if (isUnits(lk)) {
      var word = lk === 'thresh' ? 'stock quantity threshold' : 'stock-based exclusion';
      if (tgt === 'off') return rd.state === 'on' ? { why: 'A ' + word + ' still runs' + (rd.cut ? ' (stock ' + cutWord(rd.cut) + ')' : '') + ' — the target is N/A' } : null;
      if (rd.state !== 'on') return { why: (rd.miss ? 'The connected rule “' + rd.bound + '” is not in this market' : 'No ' + word + ' runs here') + ' — the target is ' + fmtVal(lk, tgt) };
      // compared as the units a product needs to stay live, so a name's "≤ 3" and a plan's "< 4" are one setting; a
      // cut-off nobody states is not a drift
      return rd.ml != null && rd.ml !== planMl(lk, tgt) ? { why: 'A rule name states stock ' + cutWord(rd.cut) + ' — the target is ' + fmtVal(lk, tgt) } : null;
    }
    if (lk === 'hero') {
      if (tgt === 'on' && rd.state !== 'on') return { why: rd.miss ? 'The connected rule “' + rd.bound + '” is not in this market' : rd.state === 'paused' ? rd.why : rd.state === 'part' ? rd.why : 'No hero-size rule runs here' };
      if (tgt === 'off' && (rd.state === 'on' || rd.state === 'part')) return { why: 'Hero sizes are still set here' };
      return null;
    }
    return null;
  }

  // ---- PERIODS — when a market should be in SALE, and whether the switch was made ------------------------------------
  function ymd(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function stOf(step) { return (step && step.st) || 'planned'; }
  function covers(p, mk) { return !p.mk || !p.mk.length || p.mk.indexOf(mk) >= 0; }
  // a market's mode: SALE once a period's switch to SALE is marked done and its switch back is not; the date says what
  // it SHOULD be — the two disagreeing is the nudge
  function modeOf(periods, mk, today) {
    var on = null, due = null;
    (periods || []).forEach(function (p) {
      if (!covers(p, mk)) return;
      if (stOf(p.sale) === 'done' && stOf(p.bau) !== 'done') on = p;
      if (today >= p.from && today <= p.to) due = p;
    });
    return { mode: on ? 'sale' : 'bau', p: on, expect: due ? 'sale' : 'bau', due: due };
  }
  // the next step of a period, as of today: switch to SALE (from its start), back to BAU (at its end), or nothing
  function nextStep(p, today) {
    if (stOf(p.sale) !== 'done') {
      var d = days(today, p.from);
      return { dir: 'sale', on: p.from, days: d, late: d < 0 && today <= p.to ? -d : 0, missed: today > p.to };
    }
    if (stOf(p.bau) !== 'done') { var e = days(today, p.to); return { dir: 'bau', on: p.to, days: e, late: e < 0 ? -e : 0 }; }
    return { dir: null };
  }

  // ---- THE SWITCH LIST — what to change in FeedHero to move markets from one mode to the other ------------------------
  // grouped by lever and change, so 19 markets moving 35% → 20% read as ONE line naming the markets and each market's
  // own rule; a lever whose target in the mode switched to is not set is listed as a blocker, never assumed
  function switchList(plan, store, brand, markets, mks, dir) {
    var from = dir === 'sale' ? 'bau' : 'sale', to = dir, groups = {}, order = [], unset = {};
    var byMk = {}; (markets || []).forEach(function (m) { byMk[m.market] = m; });
    var levs = sibbed(planLevers(plan).map(function (l) { return resolved(l, markets); }));
    (mks || []).forEach(function (mk) {
      var mo = marketOf(store, brand, mk), m = byMk[mk];
      levs.forEach(function (l) {
        var a = valueOf(plan, mo, l.k, from), b = valueOf(plan, mo, l.k, to);
        // every brand carries all four levers; one with no value in either mode is not part of this market's plan, so a
        // switch neither changes it nor waits on it
        if (!isSet(a) && !isSet(b)) return;
        if (!isSet(b)) { (unset[l.k] = unset[l.k] || []).push(mk); return; }
        if (same(a, b)) return;
        var rd = m ? reading(l.k, m, l) : null;
        // a market that runs no rule for it has nothing to change — unless it is MISSING the lever's connected rule, which
        // is the change to make first (copy the rule there), so it stays on the list, flagged
        if (rd && rd.state === 'none' && !rd.miss && !isUnits(l.k)) return;
        var key = l.k + '|' + String(a) + '|' + String(b);
        if (!groups[key]) { groups[key] = { k: l.k, label: LEVER[l.k].label + (l.scope ? ' · ' + l.scope : ''), from: a, to: b, mk: [], rules: {}, rule: boundOf(l) ? boundOf(l).n : '', miss: [] }; order.push(key); }
        groups[key].mk.push(mk);
        groups[key].rules[mk] = rd ? (l.k === 'hero' && rd.pause && dir === 'bau' ? rd.pause : rd.rules).map(function (r) { return r.n; }) : [];
        if (rd && rd.miss) groups[key].miss.push(mk);
      });
    });
    var out = order.map(function (k) { return groups[k]; });
    var blocked = Object.keys(unset).map(function (k) { return { k: k, label: LEVER[k].label, mk: unset[k] }; });
    return { dir: dir, changes: out, blocked: blocked };
  }
  // the switch as brief lines (the Workflow composer's scope, ≤2000 characters): one line per change, its markets, the rule
  // names to edit (each market's own where they differ), then what is not set yet
  function briefLines(sw, brand, p) {
    var L = [];
    L.push((sw.dir === 'sale' ? 'Switch to SALE' : 'Back to BAU') + ' — ' + brand + (p ? ' — ' + p.name + ' (' + p.from + ' → ' + p.to + ')' : ''));
    sw.changes.forEach(function (c) {
      L.push('• ' + c.label + ': ' + fmtVal(c.k, c.from) + ' → ' + fmtVal(c.k, c.to) + ' — ' + c.mk.join(', '));
      var names = {};
      c.mk.forEach(function (mk) { (c.rules[mk] || []).forEach(function (n) { (names[n] = names[n] || []).push(mk); }); });
      Object.keys(names).forEach(function (n) { L.push('    in FeedHero: “' + n + '”' + (names[n].length < c.mk.length ? ' (' + names[n].join(', ') + ')' : '')); });
      if (c.miss && c.miss.length) L.push('    ⚠ the connected rule “' + c.rule + '” is not in ' + c.miss.join(', ') + ' — copy it there first');
      else if (!Object.keys(names).length) L.push('    in FeedHero: no rule runs it yet — set it up');
    });
    sw.blocked.forEach(function (b) { L.push('⚠ ' + b.label + ': the ' + (sw.dir === 'sale' ? 'SALE' : 'BAU') + ' value is not set — ' + b.mk.join(', ')); });
    if (!sw.changes.length && !sw.blocked.length) L.push('Nothing to change — every lever reads the same in both modes.');
    var s = L.join('\n');
    return s.length > 1990 ? s.slice(0, 1985) + ' …' : s;
  }

  // ---- THE DASHBOARD MODEL — every market × lever, the mode, the periods ---------------------------------------------
  //   markets: /api/rules/stock's markets for the brand · roster: every market of the brand (read or not)
  function model(store, brand, markets, roster, today) {
    var plan = planOf(store, brand), periods = periodsOf(store, brand), byMk = {};
    (markets || []).forEach(function (m) { byMk[m.market] = m; });
    var mks = (roster && roster.length ? roster : (markets || []).map(function (m) { return m.market; })).slice();
    // all four levers for every brand, a plan or not — each units lever told the ranges the other is scoped to, so a
    // range's own rule reads under its scoped lever only
    var levers = sibbed(planLevers(plan).map(function (l) { return resolved(l, markets); }));
    var rows = mks.map(function (mk) {
      var m = byMk[mk] || null, mo = marketOf(store, brand, mk), md = modeOf(periods, mk, today);
      var cells = {};
      levers.forEach(function (l) {
        var rd = m ? reading(l.k, m, l) : null;
        var tgt = valueOf(plan, mo, l.k, md.mode);
        var oc = ownOf(mo, l.k);
        // own: the market has a value of its own for this lever (either mode) · tgtOwn: the target IN FORCE is the market's
        // own — a market with its own BAU is still held to the brand's SALE value during a sale, and says so
        cells[l.k] = { rd: rd, bau: valueOf(plan, mo, l.k, 'bau'), sale: valueOf(plan, mo, l.k, 'sale'), tgt: tgt, own: ownSet(mo, l.k), tgtOwn: !!(oc && isSet(oc[md.mode])), ownSale: oc && oc.sale !== undefined ? oc.sale : undefined, drift: rd ? drift(l.k, rd, tgt) : null };
      });
      return { market: mk, cmpid: m ? m.cmpid : null, read: !!m, mode: md.mode, expect: md.expect, p: md.p, due: md.due, cells: cells };
    });
    var sum = { markets: rows.length, read: rows.filter(function (r) { return r.read; }).length, sale: 0, late: 0, drift: 0, unset: [] };
    rows.forEach(function (r) {
      if (r.mode === 'sale') sum.sale++;
      if (r.mode !== r.expect) sum.late++;
      if (levers.some(function (l) { return r.cells[l.k].drift; })) sum.drift++;
    });
    // a lever is PLANNED once it has a value in either mode; the SALE values still to set are those of planned levers
    sum.planned = levers.filter(function (l) { return isSet(l.bau) || isSet(l.sale); }).map(function (l) { return l.k; });
    levers.forEach(function (l) { if (sum.planned.indexOf(l.k) >= 0 && !isSet(l.sale)) sum.unset.push(l.k); });
    // each connected rule across the brand's markets: found · missing · not read yet; and, for a lever with none, where more
    // than one rule reads as it
    var spread = {};
    levers.forEach(function (l) {
      var o = { n: boundOf(l) ? boundOf(l).n : '', mk: boundOf(l) ? s0(boundOf(l).mk) : '', d: boundOf(l) ? s0(boundOf(l).d) : '', found: [], missing: [], unread: [], overlap: [], alias: [] };
      rows.forEach(function (r) {
        var rd = r.cells[l.k] && r.cells[l.k].rd;
        if (!rd) { o.unread.push(r.market); return; }
        if (o.n) { (rd.miss ? o.missing : o.found).push(r.market); if (rd.mt === 'job') o.alias.push({ mk: r.market, n: rd.as }); }
        else if (rd.overlap) o.overlap.push(r.market);
      });
      spread[l.k] = o;
    });
    return { plan: plan, levers: levers, rows: rows, spread: spread, periods: periods.map(function (p) { return Object.assign({}, p, { next: nextStep(p, today) }); }), records: recordsOf(store, brand), sum: sum, today: today };
  }

  // ---- A SALE VALUE TO CONSIDER — never set without a click -----------------------------------------------------------
  // only what the brand's own rules or plan say: a range-completion line a market's rule names for a peak or sale ("Range
  // Completion (BAU & Peak) - 20%"), else the band's floor; a units cut-off the lever ran before ("previously > 5 units per
  // size"). Hero sizes: none — nothing in the rules says which way a sale should take them.
  function suggest(plan, markets, lk) {
    lk = keyOf(lk);
    var l = leverOf(plan, lk);
    if (!l) return null;
    if (lk === 'rc') {
      var hits = {};
      (markets || []).forEach(function (m) {
        ((m && m.stock) || []).forEach(function (r) {
          var n = s0(r.n); if (!RC_NAME.test(n) || !/\b(peak|sale|promo|black friday|bf)\b/i.test(n)) return;
          var v = null; (r.cut || []).forEach(function (c) { if (c.m === 'rc' && v == null) v = c.v; });
          if (v == null) v = namePct(n);
          if (v == null || !(v > 0 && v < 100)) return;
          var h = hits[v] || (hits[v] = { mk: [], n: n });
          if (h.mk.indexOf(m.market) < 0) h.mk.push(m.market);
        });
      });
      var best = Object.keys(hits).sort(function (a, b) { return hits[b].mk.length - hits[a].mk.length || +a - +b; })[0];
      if (best != null) return { v: +best, why: '“' + hits[best].n + '” in ' + list(hits[best].mk, 4) };
      if (num(l.lo) != null) return { v: l.lo, why: 'the band’s floor' };
      return null;
    }
    if (isUnits(lk)) {
      var m2 = /(\d+)/.exec(s0(l.was));
      return m2 ? { v: +m2[1], why: 'what it ran at before (' + s0(l.was) + ')' } : null;
    }
    return null;
  }
  function list(a, max) { a = a || []; return a.length <= (max || 4) ? a.join(', ') : a.slice(0, max || 4).join(', ') + ' + ' + (a.length - (max || 4)) + ' more'; }
  // a market kept as it runs today: its own BAU for every lever its reading can say — the decision that its mix is the plan.
  // A lever nobody plans that the market does not run stays out of it: absence is not a decision, and writing "N/A" for
  // it would make every switch wait on a SALE value for a lever the brand never uses
  function adopt(row) {
    var lv = {};
    Object.keys(row.cells || {}).forEach(function (lk) {
      var c = row.cells[lk], rd = c.rd; if (!rd) return;
      var v = null;
      if (lk === 'rc') v = rd.val != null ? rd.val : null;
      else if (isUnits(lk)) v = rd.state === 'on' ? rd.val : 'off';
      else if (lk === 'hero') v = rd.state === 'on' ? 'on' : 'off';
      if (v === 'off' && !isSet(c.bau) && !isSet(c.sale)) return;
      if (v != null) lv[lk] = { bau: v, sale: c.ownSale !== undefined ? c.ownSale : null };
    });
    return lv;
  }

  // ---- THE SUMMARY — the dashboard in words, for an email or a call --------------------------------------------------
  // each lever: the plan, then the markets grouped by what they run (named, never a count alone)
  function readWord(lk, rd) {
    lk = keyOf(lk);
    if (!rd) return 'not read yet';
    if (rd.miss) return isUnits(lk) ? 'the connected rule is not here (N/A)' : 'the connected rule is not here';
    if (lk === 'rc') {
      if (rd.state === 'none') return 'no range-completion rule';
      if (rd.val == null) return 'runs, no stated line';
      return rd.val + '% ' + (rd.how === 'line' ? 'measured from the products' : 'in a rule name');
    }
    if (isUnits(lk)) return rd.state === 'on' ? (rd.cut ? 'stock ' + cutWord(rd.cut) + ' in a rule name' : 'runs, no stated cut-off') : 'no ' + (lk === 'thresh' ? 'stock threshold' : 'stock exclusion') + ' (N/A)';
    if (lk === 'hero') return rd.state === 'on' ? 'on' : rd.state === 'paused' ? 'paused by a rule' : rd.state === 'part' ? 'kept live, but no rule sets them' : 'no hero-size rule';
    return '';
  }
  function groups(M, lk) {
    var g = {}, order = [];
    M.rows.forEach(function (r) { var c = r.cells[lk]; var w = readWord(lk, c && c.rd); if (!g[w]) { g[w] = []; order.push(w); } g[w].push(r.market); });
    return order.map(function (w) { return { w: w, mk: g[w] }; }).sort(function (a, b) { return b.mk.length - a.mk.length; });
  }
  function summaryText(M, brand, today) {
    var L = [brand + ' — stock levers, ' + (today || M.today)];
    M.levers.forEach(function (l) {
      var lab = LEVER[l.k].label + (l.scope ? ' · ' + l.scope : '');
      var plan = 'BAU ' + fmtVal(l.k, l.bau) + ' · SALE ' + fmtVal(l.k, l.sale) + (l.k === 'rc' && num(l.lo) != null && num(l.hi) != null ? ' (band ' + l.lo + '–' + l.hi + '%)' : '') + (l.was ? ' (was ' + l.was + ')' : '');
      var sp = M.spread && M.spread[l.k];
      var ex = sp && sp.n ? [sp.alias.length ? sp.alias.length + ' under another name' : '', sp.missing.length ? 'missing: ' + list(sp.missing, 8) : ''].filter(Boolean).join('; ') : '';
      L.push('• ' + lab + ': ' + plan + (sp && sp.n ? ' — rule “' + sp.n + '”, in ' + sp.found.length + ' of ' + (sp.found.length + sp.missing.length) + ' markets' + (ex ? ' (' + ex + ')' : '') : ' — no rule connected'));
      groups(M, l.k).forEach(function (x) { L.push('    ' + x.w + ' — ' + x.mk.join(', ')); });
    });
    var off = M.rows.filter(function (r) { return M.levers.some(function (l) { return r.cells[l.k].drift; }); });
    L.push(off.length ? '• Off plan: ' + off.length + ' of ' + M.rows.length + ' markets — ' + list(off.map(function (r) { return r.market; }), 8) : '• Every market runs its plan.');
    var ps = M.periods.filter(function (p) { return p.next.dir; });
    ps.forEach(function (p) { L.push('• ' + p.name + ' (' + p.from + ' → ' + p.to + '): ' + (p.next.dir === 'sale' ? 'switch to SALE ' : 'back to BAU ') + (p.next.missed ? 'missed — the period ended ' + p.to : p.next.days > 0 ? 'in ' + p.next.days + ' days' : p.next.days === 0 ? 'today' : p.next.late + ' days late') + ' · ' + list(p.mk, 6)); });
    if (!M.periods.length) L.push('• No sale period planned.');
    var rec = M.records || [];
    if (rec.length) {
      L.push('• Recorded:');
      rec.slice(0, 5).forEach(function (r) { L.push('    ' + r.d + ' — ' + (LEVER[r.k] || {}).label + ' ' + recordWord(r) + ' — ' + list(r.mk, 6) + (r.note ? ' · ' + r.note : '') + (r.by ? ' · ' + r.by : '')); });
      if (rec.length > 5) L.push('    + ' + (rec.length - 5) + ' more in the record');
    }
    return L.join('\n');
  }

  return { VERSION: VERSION, LEVERS: LEVERS, LEVER: LEVER, LEGACY: LEGACY, DRIFT_PP: DRIFT_PP, isSet: isSet, same: same, fmtVal: fmtVal,
    keyOf: keyOf, isUnits: isUnits, planLevers: planLevers, leverOf: leverOf, ownOf: ownOf, stockCut: stockCut, holdKind: holdKind, aside: aside,
    mlOf: mlOf, planMl: planMl, fromMl: fromMl, cutWord: cutWord,
    planOf: planOf, marketOf: marketOf, periodsOf: periodsOf, valueOf: valueOf, reading: reading, drift: drift, namePct: namePct,
    ymd: ymd, days: days, modeOf: modeOf, nextStep: nextStep, switchList: switchList, briefLines: briefLines, model: model,
    suggest: suggest, adopt: adopt, readWord: readWord, groups: groups, summaryText: summaryText,
    recordsOf: recordsOf, lastRecord: lastRecord, switchRecords: switchRecords, recordWord: recordWord,
    cands: cands, sibbed: sibbed, nameKey: nameKey, sameName: sameName, boundOf: boundOf, ruleChoices: ruleChoices, nameSim: nameSim, findRule: findRule, resolved: resolved };
});
