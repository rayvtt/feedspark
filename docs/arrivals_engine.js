/*
 * FeedSpark arrivals engine — new products per month / quarter / year, read off the feed's
 * OWN first-seen dates: c:fs_date_of_birth, FeedHero's stamp of the day a product ID first
 * appeared in the feed (Ray, 15 Sep 2026: "start using that to forecast and approximate how
 * many products arrive per year per quarter per month for all my accounts"). Shopping feeds only.
 *
 * One file, four lanes: the xml-scan agent's capture (via labelguard's xmlCollector, which
 * histograms the field with the same parsing rules), the /volume page, the quote generator's
 * new-product forecast, and tools/test_arrivals.mjs. UMD — `require()` in node, window.FeedArrivals
 * in the browser (served verbatim at /volume/engine.js).
 *
 * SURVIVORS ONLY — the caveat every number carries: a month counts the products STILL in the
 * feed today whose ID was born that month. Recent months are therefore complete; older months
 * are lower bounds (whatever has since sold through or been delisted is gone from the count).
 * The forecast rests on the last COMPLETE months (a month counts once it is over), never on
 * the current partial month.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedArrivals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.0.0';
  var FIELD = 'fs_date_of_birth';   // the header key after g:/c: prefix + ` type="…"` suffix are stripped
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ym(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  // "2026-05-22" (or a longer timestamp starting that way) → "2026-05"; anything else → null
  function dobMonth(v) {
    var m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v));
    if (!m) return null;
    var y = +m[1], mo = +m[2], da = +m[3];
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    return m[1] + '-' + m[2];
  }
  function dobDay(v) { return dobMonth(v) ? String(v).trim().slice(0, 10) : null; }
  // the per-feed histogram builder: add(value) per row → finish() = {n, bad, m:{YYYY-MM:n}, min, max}
  function dobCollector() {
    var m = {}, n = 0, bad = 0, min = null, max = null;
    return {
      add: function (v) {
        var s = String(v == null ? '' : v).trim(); if (!s) return;
        var k = dobMonth(s); if (!k) { bad++; return; }
        n++; m[k] = (m[k] || 0) + 1;
        var d = s.slice(0, 10); if (min == null || d < min) min = d; if (max == null || d > max) max = d;
      },
      finish: function () { return { n: n, bad: bad, m: m, min: min, max: max }; }
    };
  }
  // does a header name resolve to the first-seen field? (c:fs_date_of_birth type="string" → fs_date_of_birth)
  function isDobHeader(h) {
    return String(h == null ? '' : h).replace(/^\uFEFF/, '').trim().replace(/\s+type=.*$/i, '').replace(/^[gc]:/i, '').toLowerCase() === FIELD;
  }
  function addMonths(key, delta) { var y = +key.slice(0, 4), mo = +key.slice(5, 7) - 1 + delta; return ym(new Date(Date.UTC(y, mo, 1))); }
  function quarterOf(key) { return key.slice(0, 4) + ' Q' + (Math.floor((+key.slice(5, 7) - 1) / 3) + 1); }
  function sum(arr) { var s = 0; arr.forEach(function (x) { s += x.n; }); return s; }
  // stats(dob, now, rows) → everything the page and the quote show.
  //   months   — the last 24 calendar months ending at the current one: {k, n, complete, observed}
  //              complete = the month is over; observed = at or after the earliest first-seen month
  //   lastFull — the most recent complete observed month; m3 / m6 — mean of the last 3 / 6 of them
  //   y12      — total over the last 12 complete observed months (y12Months says how many there were)
  //   quarters — calendar quarters (last 8, current flagged partial); years — calendar years
  //   forecast — {month, quarter, year, basis}: the run-rate is m3 (or, with no complete month yet, the
  //              current month so far), × 3 and × 12 — transparent, never a fitted curve
  function stats(dob, now, rows) {
    var m = (dob && dob.m) || {};
    var keys = Object.keys(m).filter(function (k) { return /^\d{4}-\d{2}$/.test(k); }).sort();
    var cur = ym(now || new Date()), first = keys.length ? keys[0] : null;
    var months = [];
    for (var i = 23; i >= 0; i--) { var k = addMonths(cur, -i); months.push({ k: k, n: +m[k] || 0, complete: k < cur, observed: first != null && k >= first }); }
    var full = months.filter(function (x) { return x.complete && x.observed; });
    var avg = function (arr) { return arr.length ? sum(arr) / arr.length : null; };
    var l3 = full.slice(-3), l6 = full.slice(-6), l12 = full.slice(-12);
    var m3 = avg(l3), m6 = avg(l6), y12 = l12.length ? sum(l12) : null;
    var lastFull = full.length ? full[full.length - 1] : null, thisMonth = months[months.length - 1];
    var qmap = {}, qorder = [];
    keys.forEach(function (k) { var q = quarterOf(k); if (!qmap[q]) { qmap[q] = { q: q, n: 0 }; qorder.push(q); } qmap[q].n += +m[k] || 0; });
    var curQ = quarterOf(cur);
    var quarters = qorder.slice(-8).map(function (q) { return { q: q, n: qmap[q].n, partial: q === curQ }; });
    var yr = {}, yorder = [];
    keys.forEach(function (k) { var y = k.slice(0, 4); if (!yr[y]) { yr[y] = { y: y, n: 0 }; yorder.push(y); } yr[y].n += +m[k] || 0; });
    var years = yorder.map(function (y) { return { y: y, n: yr[y].n, partial: y === cur.slice(0, 4) }; });
    var rate = m3 != null ? m3 : (thisMonth.observed && thisMonth.n > 0 ? thisMonth.n : null);
    var forecast = rate == null ? null : { month: Math.round(rate), quarter: Math.round(rate * 3), year: Math.round(rate * 12),
      basis: l3.length ? ('the last ' + l3.length + ' complete month' + (l3.length === 1 ? '' : 's')) : 'the current month so far' };
    var total = 0; keys.forEach(function (k) { total += +m[k] || 0; });
    var n = (dob && dob.n != null) ? +dob.n : total;
    var coverage = (rows > 0 && n != null) ? n / rows : null;
    return { field: FIELD, months: months, lastFull: lastFull, thisMonth: thisMonth, m3: m3, m6: m6, y12: y12, y12Months: l12.length,
      quarters: quarters, years: years, forecast: forecast, first: first, last: keys.length ? keys[keys.length - 1] : null,
      n: n, rows: rows || null, coverage: coverage, fullMonths: full.length };
  }
  return { VERSION: VERSION, FIELD: FIELD, dobMonth: dobMonth, dobDay: dobDay, isDobHeader: isDobHeader, dobCollector: dobCollector, stats: stats, quarterOf: quarterOf, addMonths: addMonths };
});
