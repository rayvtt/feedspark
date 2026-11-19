/* AI shopping demand engine (UMD — window.FeedAiDemand in the browser, module.exports in node).
 *
 * Ray, 19 Nov 2026, over Superdry US's Merchant Center "AI performance" report: "I am looking for
 * instant recommendations, instant activation, things to be changed, and product SKU matching …
 * the highest long-tail search term at the moment is 'long sleeves'. The module will also be able
 * to match how many products in the catalog correspond to that search term and how they are
 * performing in terms of average ROAS across the catalog."
 *
 * Google's report says what shoppers ask its AI surfaces for, at CATEGORY level: shopping terms,
 * search intents and product attributes, each with a frequency, "Products showing" and (terms,
 * intents) a share of voice. It names no product. This engine turns it into feed work:
 *   parseExport   — the export as Google writes it (tab OR comma, four meta lines, blanks)
 *   indexProducts — the live feed, each field normalised once
 *   matchTerms    — which products SAY a term, and where (title / highlights / description /
 *                   product type / attributes), with their own Google Ads sums beside the catalogue's
 *   verdict       — hero · growth · wording gap · range gap, with the action in words
 *   labelSets     — the SKUs for AI_Hero_Terms / AI_Growth_Opportunity
 *   intentPlay / attrPlan / trend / headline
 *
 * FOUR HONESTY RULES, each pinned in tools/test_aidemand.mjs:
 *  1. A blank share of voice is NOT REPORTED, never zero; a 0 is Google's own 0 (or too few
 *     impressions to state one). Both are kept apart from a measured share.
 *  2. "Products showing" is GOOGLE's count; "in the catalogue" is OURS (the words are in the feed).
 *     They answer different questions and are never merged or reconciled.
 *  3. ROAS is a ratio of SUMS over the matched products (never a mean of ratios), read beside the
 *     same ratio over the whole feed, and null where nothing was spent.
 *  4. A term nobody's product says is not a zero-effort win: where Google shows products for it the
 *     words are missing (a wording gap); where it shows none it is a RANGE question, not a feed fix.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FeedAiDemand = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var HERO_SOV = 0.25;      // a quarter of the AI answers in the category already show the brand
  var TITLE_SHARE = 0.5;    // under half of the matching products say it in the title → a title job
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  // ---- reading the export ---------------------------------------------------------------------
  function splitLine(line, d) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === d) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }
  // "161" · "3.5k" · "1,940" · "" → 161 · 3500 · 1940 · null
  function num(v) {
    var s = String(v == null ? '' : v).trim().replace(/,/g, '');
    if (!s || s === '-' || s === '—' || s === '–') return null;
    var m = /^(-?\d+(?:\.\d+)?)\s*([kKmM]?)\s*%?$/.exec(s);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (m[2] === 'k' || m[2] === 'K') n *= 1e3;
    if (m[2] === 'm' || m[2] === 'M') n *= 1e6;
    return isFinite(n) ? n : null;
  }
  // a share: "0.25" · "25%" · "25.1" → 0.25 (a fraction), blank → null
  function frac(v) {
    var s = String(v == null ? '' : v).trim();
    var n = num(s);
    if (n == null) return null;
    if (/%\s*$/.test(s) || n > 1) n = n / 100;
    return Math.max(0, Math.min(1, n));
  }
  function isoOf(s) {
    var m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(String(s || ''));
    var mo, d, y;
    if (m) { mo = MON[m[1].toLowerCase().slice(0, 4)] || MON[m[1].toLowerCase().slice(0, 3)]; d = +m[2]; y = +m[3]; }
    else {
      m = /(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(String(s || ''));
      if (m) { mo = MON[m[2].toLowerCase().slice(0, 4)] || MON[m[2].toLowerCase().slice(0, 3)]; d = +m[1]; y = +m[3]; }
      else { m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } }
    }
    if (!mo || !d || !y) return '';
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function parsePeriod(s) {
    var parts = String(s || '').split(/\s+[–—-]\s+|\s+to\s+/);
    var from = isoOf(parts[0]), to = isoOf(parts[1] || parts[0]);
    return { label: String(s || '').trim(), from: from, to: to };
  }
  // Google writes the tab-separated export as UTF-16 (FF FE) and the comma one as UTF-8 — read the bytes, not a guess
  function decode(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    var enc = b[0] === 0xFF && b[1] === 0xFE ? 'utf-16le' : b[0] === 0xFE && b[1] === 0xFF ? 'utf-16be' : 'utf-8';
    if (enc === 'utf-8' && b.length > 3 && b[1] === 0 && b[3] === 0) enc = 'utf-16le';      // UTF-16 with no mark
    return new TextDecoder(enc).decode(b).replace(/^\uFEFF/, '');
  }
  var HEADS = { 'search term': 'terms', 'search intent': 'intents', 'attribute': 'attrs', 'product attribute': 'attrs' };

  function parseExport(text) {
    var lines = String(text == null ? '' : text).replace(/^﻿/, '').split(/\r\n|\n|\r/);
    var meta = { name: '', period: '', filters: '', colFilter: '' }, hi = -1, d = '\t', head = null;
    for (var i = 0; i < lines.length && i < 40; i++) {
      var raw = lines[i];
      if (!raw.trim()) continue;
      var cells = raw.indexOf('\t') >= 0 ? splitLine(raw, '\t') : splitLine(raw, ',');
      var k0 = (cells[0] || '').toLowerCase();
      if (HEADS[k0] && cells.length >= 2) { hi = i; d = raw.indexOf('\t') >= 0 ? '\t' : ','; head = cells; break; }
      var one = raw.replace(/^"|"$/g, '').replace(/""/g, '"').trim();
      var mm;
      if ((mm = /^Name:\s*(.*)$/i.exec(one))) meta.name = mm[1];
      else if ((mm = /^Time period:\s*(.*)$/i.exec(one))) meta.period = mm[1];
      else if ((mm = /^Filters:\s*(.*)$/i.exec(one))) meta.filters = mm[1];
      else if ((mm = /^Column filters:\s*(.*)$/i.exec(one))) meta.colFilter = mm[1];
    }
    if (hi < 0) return { ok: false, error: 'This is not a Merchant Center AI performance export — no "Search term", "Search intent" or "Attribute" column was found.' };
    var kind = HEADS[head[0].toLowerCase()];
    var low = head.map(function (h) { return h.toLowerCase(); });
    var find = function (re) { for (var j = 1; j < low.length; j++) if (re.test(low[j])) return j; return -1; };
    var cf = find(/frequency|popularity/), cp = find(/products? showing/), cs = find(/share of voice/);
    if (cf < 0) return { ok: false, error: 'The export has no frequency (or popularity) column — it cannot be ranked.' };
    var rows = [], seen = {};
    for (var r = hi + 1; r < lines.length; r++) {
      if (!lines[r].trim()) continue;
      var c = splitLine(lines[r], d), t = (c[0] || '').replace(/\s+/g, ' ').trim();
      if (!t || seen[t.toLowerCase()]) continue;
      seen[t.toLowerCase()] = 1;
      rows.push({ t: t, f: num(c[cf]), ps: cp >= 0 ? num(c[cp]) : null, sov: cs >= 0 ? frac(c[cs]) : null });
    }
    if (!rows.length) return { ok: false, error: 'The export carries a header and no rows.' };
    var per = parsePeriod(meta.period);
    var country = (/Country\s*=\s*([^;]+)/i.exec(meta.filters) || [])[1] || '';
    var category = (/Category\s*=\s*([^;]+)/i.exec(meta.filters) || [])[1] || '';
    return { ok: true, kind: kind, name: meta.name, label: per.label, from: per.from, to: per.to,
      country: country.trim().toUpperCase(), category: category.trim(), filter: meta.colFilter.trim(), rows: rows };
  }

  // ---- words ------------------------------------------------------------------------------------
  // "Long-Sleeved" and "long sleeve" are one thing to a shopper; so are "V-neck", "v neck" and "vneck".
  function stem(w) {
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
    if (w.length > 3 && /e$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  function toks(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')
      .replace(/[^a-z0-9À-ɏ]+/g, ' ').trim().split(' ').filter(Boolean).map(stem);
  }
  function normText(s) { var t = toks(s); return t.length ? ' ' + t.join(' ') + ' ' : ' '; }
  var NUMW = { '1': 'one', '2': 'two', '3': 'three', one: '1', two: '2', three: '3' };
  // every spelling of a term we accept: the words in a row, the words run together, a digit as its word
  function termForms(term) {
    var t = toks(term), out = [];
    if (!t.length) return out;
    var add = function (a) { var s = ' ' + a.join(' ') + ' '; if (out.indexOf(s) < 0) out.push(s); };
    add(t);
    if (t.length > 1 && t.join('').length <= 16) add([t.join('')]);
    var sw = t.map(function (w) { return NUMW[w] ? stem(NUMW[w]) : w; });
    if (sw.join(' ') !== t.join(' ')) add(sw);
    return out;
  }
  function says(norm, forms) { for (var i = 0; i < forms.length; i++) if (norm.indexOf(forms[i]) >= 0) return true; return false; }

  // ---- the catalogue -----------------------------------------------------------------------------
  // rows: [{ id, gid, ti, de, hl, pt, at, pd, has:{gender,color,size,material,pattern,age_group} }]
  // ads:  { <product id, any case>: [impr, clicks, cost, conv, value] }  (FeedHero Ads Traffic, 30 days)
  function indexProducts(rows, ads) {
    var A = null, k;
    if (ads) { A = {}; for (k in ads) if (Object.prototype.hasOwnProperty.call(ads, k)) A[String(k).toLowerCase()] = ads[k]; }
    var P = [], tot = { n: 0, adv: 0, impr: 0, clicks: 0, cost: 0, conv: 0, value: 0 }, groups = {};
    (rows || []).forEach(function (r) {
      if (!r || r.id == null || r.id === '') return;
      var p = { id: String(r.id), gid: String(r.gid || r.id), ti: String(r.ti || ''),
        n: { ti: normText(r.ti), hl: normText(r.hl), de: normText(String(r.de || '').slice(0, 2000)), pt: normText(r.pt), at: normText((r.at || '') + ' ' + (r.pd || '')) },
        pd: normText(r.pd), has: r.has || {}, a: A ? A[String(r.id).toLowerCase()] || null : null };
      P.push(p); tot.n++; groups[p.gid] = 1;
      if (p.a) { tot.adv++; tot.impr += +p.a[0] || 0; tot.clicks += +p.a[1] || 0; tot.cost += +p.a[2] || 0; tot.conv += +p.a[3] || 0; tot.value += +p.a[4] || 0; }
    });
    tot.groups = Object.keys(groups).length;
    tot.roas = tot.cost > 0 ? tot.value / tot.cost : null;
    tot.ads = !!A;
    return { P: P, tot: tot };
  }

  function matchOne(term, cat) {
    var forms = termForms(term), P = cat.P;
    var m = { n: 0, groups: 0, ti: 0, hl: 0, de: 0, pt: 0, at: 0, notTi: 0, idx: [], inTi: [],
      ads: { adv: 0, impr: 0, clicks: 0, cost: 0, conv: 0, value: 0, roas: null } };
    if (!forms.length) return m;
    var g = {};
    for (var i = 0; i < P.length; i++) {
      var p = P[i], n = p.n;
      var a = says(n.ti, forms), b = says(n.hl, forms), c = says(n.de, forms), d = says(n.pt, forms), e = says(n.at, forms);
      if (!(a || b || c || d || e)) continue;
      m.n++; m.idx.push(i); m.inTi.push(a ? 1 : 0); g[p.gid] = 1;
      if (a) m.ti++; else m.notTi++;
      if (b) m.hl++; if (c) m.de++; if (d) m.pt++; if (e) m.at++;
      if (p.a) { m.ads.adv++; m.ads.impr += +p.a[0] || 0; m.ads.clicks += +p.a[1] || 0; m.ads.cost += +p.a[2] || 0; m.ads.conv += +p.a[3] || 0; m.ads.value += +p.a[4] || 0; }
    }
    m.groups = Object.keys(g).length;
    m.ads.roas = m.ads.cost > 0 ? m.ads.value / m.ads.cost : null;
    return m;
  }

  // ---- the verdict: what to do about one term ------------------------------------------------------
  function verdict(row, m, tot) {
    var sov = row.sov, f = row.f || 0, kind, act, fields = [];
    var q = '“' + row.t + '”';
    if (sov != null && sov >= HERO_SOV) {
      kind = 'hero';
      act = 'Protect it: ' + (m.n ? m.ti + ' of ' + m.n + ' matching products say ' + q + ' in the title — keep it there, and label them AI_Hero_Terms so they can be given their own budget.'
        : 'Google already shows the brand for ' + q + ', yet no product in the feed uses those words — write them in before the share slips.');
      fields = m.n && m.notTi ? ['title'] : [];
    } else if (!m.n) {
      if (row.ps > 0) {
        kind = 'wording';
        act = 'Google shows ' + row.ps + ' of the brand’s products for ' + q + ', but no title, highlight, description or product type in the feed uses the words. Find the products that qualify and write the term in.';
        fields = ['title', 'product_highlight', 'description'];
      } else {
        kind = 'range';
        act = 'Shoppers ask for ' + q + ' and nothing in the catalogue matches — a range question for the client, not a feed fix.';
      }
    } else {
      kind = 'growth';
      if (m.ti / m.n < TITLE_SHARE) {
        act = 'Say it in the title: ' + m.notTi + ' of the ' + m.n + ' products that match carry ' + q + ' only outside the title. Label them AI_Growth_Opportunity.';
        fields = ['title', 'product_highlight'];
      } else if (m.hl / m.n < TITLE_SHARE) {
        act = 'Titles already say ' + q + ' (' + m.ti + ' of ' + m.n + ') — carry it into the highlights (' + m.hl + ' of ' + m.n + ' do) and a Q&A, then label them AI_Growth_Opportunity.';
        fields = ['product_highlight', 'question_and_answer'];
      } else {
        act = 'The feed already says ' + q + ' in titles and highlights — the gap is not wording. Add depth (product details, Q&A) and back these ' + m.n + ' products with budget.';
        fields = ['product_detail', 'question_and_answer'];
      }
    }
    var w = kind === 'growth' ? 1 : kind === 'wording' ? 0.7 : kind === 'range' ? 0.2 : 0.15;
    var roas = m.ads.roas, base = tot ? tot.roas : null, cmp = null;
    if (roas != null && base != null && base > 0) cmp = roas >= base * 1.1 ? 'above' : roas <= base * 0.9 ? 'below' : 'level';
    return { kind: kind, act: act, fields: fields, score: Math.round(f * (1 - (sov || 0)) * w * 1000) / 1000, cmp: cmp };
  }
  var KIND_LABEL = { hero: 'Hero', growth: 'Growth', wording: 'Wording gap', range: 'Range gap' };

  function matchTerms(rows, cat) {
    return (rows || []).map(function (r) {
      var m = matchOne(r.t, cat);
      return { row: r, m: m, v: verdict(r, m, cat.tot) };
    });
  }

  // ---- activation: the SKUs behind the two labels --------------------------------------------------
  // a product matching a hero term is a hero; everything else matching a growth term is growth
  function labelSets(res, cat) {
    var P = cat.P, hero = {}, growth = {};
    (res || []).forEach(function (x) {
      var into = x.v.kind === 'hero' ? hero : x.v.kind === 'growth' ? growth : null;
      if (!into) return;
      x.m.idx.forEach(function (i) { (into[i] = into[i] || []).push(x.row.t); });
    });
    var out = [];
    Object.keys(hero).forEach(function (i) { out.push({ id: P[i].id, ti: P[i].ti, label: 'AI_Hero_Terms', terms: hero[i] }); });
    Object.keys(growth).forEach(function (i) { if (!hero[i]) out.push({ id: P[i].id, ti: P[i].ti, label: 'AI_Growth_Opportunity', terms: growth[i] }); });
    var h = out.filter(function (o) { return o.label === 'AI_Hero_Terms'; }).length;
    return { rows: out, hero: h, growth: out.length - h };
  }
  // the products of one term, the ones NOT saying it in the title first, then by what they earn
  function termProducts(x, cat, max) {
    var P = cat.P, list = x.m.idx.map(function (i, k) { var p = P[i]; return { id: p.id, ti: p.ti, inTi: !!x.m.inTi[k], cost: p.a ? +p.a[2] || 0 : 0, value: p.a ? +p.a[4] || 0 : 0 }; });
    list.sort(function (a, b) { return (a.inTi - b.inTi) || (b.value - a.value) || (b.cost - a.cost); });
    return max ? list.slice(0, max) : list;
  }

  // ---- intents: a use-case is answered in words, not matched to a column --------------------------
  var STOP = { shopping: 1, shop: 1, for: 1, a: 1, an: 1, the: 1, specific: 1, finding: 1, find: 1, items: 1, item: 1, with: 1, other: 1,
    dressing: 1, clothing: 1, clothes: 1, attire: 1, looking: 1, buying: 1, of: 1, to: 1, and: 1, in: 1, on: 1 };
  var GENERIC = { feature: 1, features: 1, sizing: 1, size: 1, sizes: 1, style: 1, styles: 1 };
  function intentKey(t) {
    var w = String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(function (x) { return x && !STOP[x]; });
    if (!w.length || (w.length === 1 && GENERIC[w[0]])) return '';
    return w.join(' ');
  }
  var PLAYS = [
    { re: /wedding|occasion|party|formal|event|prom|date night|interview/, k: 'occasion', fields: ['product_highlight', 'question_and_answer', 'product_detail'],
      say: 'Name the occasion: one highlight written for it, a Q&A in the shopper’s words (“Can I wear this to a wedding?”) and Occasion as a product detail.' },
    { re: /siz|fit|tall|petite|plus|length|measure/, k: 'sizing', fields: ['question_and_answer', 'document_link', 'size_system', 'size_type'],
      say: 'Answer sizing in the feed: size system and size type filled, a size-guide document link, and a Q&A on fit and the model’s height and size.' },
    { re: /weather|hot|cold|rain|summer|winter|season|warm|snow/, k: 'weather', fields: ['product_highlight', 'product_detail', 'question_and_answer'],
      say: 'Say what it is for: fabric weight, breathability or warmth in a highlight, Season as a product detail, and a Q&A on when to wear it.' },
    { re: /feature|pocket|zip|hood|waterproof|stretch/, k: 'features', fields: ['product_detail', 'product_highlight'],
      say: 'Lead with the feature: a product detail per feature (pockets, lining, closure) and highlights that open on it.' },
  ];
  function intentPlay(t) {
    var s = String(t || '').toLowerCase();
    for (var i = 0; i < PLAYS.length; i++) if (PLAYS[i].re.test(s)) return PLAYS[i];
    return { k: 'usecase', fields: ['product_highlight', 'question_and_answer'], say: 'Write the use-case down: one highlight and one Q&A in the shopper’s own words.' };
  }
  function matchIntents(rows, cat) {
    return (rows || []).map(function (r) {
      var key = intentKey(r.t), m = key && cat ? matchOne(key, cat) : null;
      return { row: r, key: key, m: m, play: intentPlay(r.t) };
    });
  }

  // ---- attributes: where each one lives in a feed --------------------------------------------------
  var ATTR_FIELD = { gender: 'gender', color: 'color', colour: 'color', size: 'size', material: 'material', pattern: 'pattern', 'age group': 'age_group', age: 'age_group' };
  function attrPlan(rows, cat) {
    var P = cat ? cat.P : null, max = 0;
    (rows || []).forEach(function (r) { if (r.f > max) max = r.f; });
    return (rows || []).map(function (r) {
      var k = String(r.t || '').toLowerCase().trim(), field = ATTR_FIELD[k] || '', fill = null, n = 0;
      if (P && P.length) {
        if (field) { for (var i = 0; i < P.length; i++) if (P[i].has && P[i].has[field]) n++; }
        else { var forms = termForms(k); for (var j = 0; j < P.length; j++) if (says(P[j].pd, forms)) n++; }
        fill = n / P.length;
      }
      var how = field
        ? 'Google has a field for it — g:' + field + '. Every product should state it, in Google’s own vocabulary.'
        : 'No Google field of its own: carry it as a product detail (“' + r.t + ': …”) and say it in the title or a highlight.';
      return { row: r, rel: max ? r.f / max : 0, field: field, where: field ? 'g:' + field : 'g:product_detail', n: n, fill: fill, how: how };
    });
  }

  // ---- over time: the same term across the readings we hold ----------------------------------------
  // uploads of ONE kind → per term: its readings oldest first, first and latest share, the move in points
  function trend(uploads) {
    var ups = (uploads || []).slice().sort(function (a, b) { return a.to < b.to ? -1 : a.to > b.to ? 1 : 0; }), by = {};
    ups.forEach(function (u) {
      (u.rows || []).forEach(function (r) {
        var k = r.t.toLowerCase();
        (by[k] = by[k] || { t: r.t, pts: [] }).pts.push({ from: u.from, to: u.to, sov: r.sov, f: r.f, ps: r.ps });
      });
    });
    return Object.keys(by).map(function (k) {
      var o = by[k], known = o.pts.filter(function (p) { return p.sov != null; });
      o.first = known.length ? known[0] : null; o.last = known.length ? known[known.length - 1] : null;
      // a move needs two MEASURED readings — a blank beside a number is not a change
      o.delta = known.length > 1 ? Math.round((o.last.sov - o.first.sov) * 1000) / 10 : null;
      return o;
    }).sort(function (a, b) { return Math.abs(b.delta || 0) - Math.abs(a.delta || 0); });
  }
  function periods(uploads) { return (uploads || []).length; }

  // ---- the headline --------------------------------------------------------------------------------
  // the share of voice weighted by how often each term is asked, over the terms that REPORT one
  function headline(rows, res) {
    var w = 0, s = 0, known = 0;
    (rows || []).forEach(function (r) { if (r.sov != null && r.f != null) { w += r.f; s += r.f * r.sov; known++; } });
    var c = { hero: 0, growth: 0, wording: 0, range: 0 };
    (res || []).forEach(function (x) { c[x.v.kind]++; });
    return { terms: (rows || []).length, known: known, sov: w > 0 ? s / w : null, kinds: c };
  }

  return { HERO_SOV: HERO_SOV, TITLE_SHARE: TITLE_SHARE, KIND_LABEL: KIND_LABEL, ATTR_FIELD: ATTR_FIELD,
    decode: decode, num: num, frac: frac, parsePeriod: parsePeriod, parseExport: parseExport,
    stem: stem, toks: toks, normText: normText, termForms: termForms, says: says,
    indexProducts: indexProducts, matchOne: matchOne, verdict: verdict, matchTerms: matchTerms,
    labelSets: labelSets, termProducts: termProducts,
    intentKey: intentKey, intentPlay: intentPlay, matchIntents: matchIntents, attrPlan: attrPlan,
    trend: trend, periods: periods, headline: headline };
});
