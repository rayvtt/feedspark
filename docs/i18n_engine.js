/* FeedSpark — UI language engine (docs/i18n_engine.js)
 * ------------------------------------------------------------------
 * UMD, dependency-free, browser + node. Served verbatim at /i18n/engine.js and unit-tested
 * in node (tools/test_i18n.mjs) — the owner-only language widget runs this exact file.
 *
 * What it answers (Ray, 15 Sep 2026): "build completely a VI (Vietnamese) toggle for my
 * view only". The FCC is ~20 pages of English chrome rendered by inline scripts; nothing
 * is templated for translation. So the widget translates the DOM: every text node and
 * every title / placeholder / aria-label / alt it can see, restoring the exact original
 * on the way back. This engine is the pure part — what to skip, how to key a string,
 * how numbers ride through, how a dictionary answers.
 *
 * API:
 *   I18N.norm(s)                 -> whitespace-collapsed, trimmed key
 *   I18N.skip(s)                 -> true for strings that must never be translated: URLs,
 *                                   emails, bare numbers/dates, codes, g: attribute names,
 *                                   single characters, symbol-only tokens
 *   I18N.tpl(s)                  -> { key, nums } — digits become {n} so "12 of 40 done"
 *                                   answers from the single entry "{n} of {n} done"
 *   I18N.fill(t, nums)           -> puts the numbers back into a translated template
 *   I18N.lookup(dict, s)         -> translated string or null (exact → templated →
 *                                   case-folded; surrounding whitespace preserved)
 *   I18N.protect(s)              -> the spans a translator must leave verbatim (brand /
 *                                   product / attribute tokens) — the worker prompt uses it
 *   I18N.VERSION
 */
(function (root, factory) {
  var api = factory();
  try { root.I18N = api; } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
}(typeof globalThis !== 'undefined' ? globalThis :
  (typeof self !== 'undefined' ? self : this), function () {
  'use strict';
  var VERSION = '1.0.0';

  // tokens that are never language: product / client / platform names, attribute keys
  var KEEP = ['FeedSpark', 'FeedHero', 'Tachyon', 'Feed Lab', 'Feed Chat', 'Label Guard', 'PT Guard', 'Golden Record', 'Playbook',
    'Reiss', 'Schuh', 'Superdry', 'Accessorize', 'Monsoon', 'Hobbycraft', 'YuMOVE', 'Ryobi', 'Benefit Cosmetics', 'Clinique', 'MAC',
    'AllSaints', 'Estee Lauder', 'Estée Lauder', 'Bobbi Brown', 'Jo Malone', 'American Golf', 'House of Bruar',
    'Google', 'Meta', 'Facebook', 'Pinterest', 'Shopify', 'PMax', 'PMAX', 'Merchant Center', 'Gmail', 'Cloudflare', 'Akamai',
    'ChatGPT', 'Perplexity', 'Gemini', 'Klaviyo', 'GMC', 'CTR', 'CVR', 'ROAS', 'CPC', 'SKU', 'SKUs', 'GTIN', 'MPN', 'GPC', 'PDP', 'ASPL', 'TechAM', 'KV', 'XML', 'CSV', 'PDF', 'AM', 'AMs'];
  // whole-word matches only: 'Meta' must not claim 'metadata', 'MAC' must not claim 'MACHINE'
  var KEEP_RE = new RegExp('(^|[^A-Za-z])(' + KEEP.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')(?![A-Za-z])', 'g');

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  // strings that carry no language: identifiers, URLs, emails, numbers, dates, codes, glyphs
  function skip(s) {
    s = norm(s);
    if (s.length < 2) return true;
    if (!/[A-Za-zÀ-ɏ]{2}/.test(s)) return true;          // needs two letters somewhere
    if (/^https?:\/\//i.test(s) || /^www\./i.test(s) || /\S+@\S+\.\S+/.test(s)) return true;
    if (/^g:[a-z_0-9]+([–-]\d+)?(\(\d+\))?$/i.test(s)) return true;   // g:material, g:product_type(2), g:custom_label_0–4
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(s)) return true;         // question_and_answer, item_group_title
    if (/^[A-Z]{2}$/.test(s)) return true;                            // market codes: GB, US, DE
    if (/^[A-Z0-9][A-Z0-9_\-:.\/]{2,}$/.test(s) && !/[a-z]/.test(s) && s.length <= 14) return true; // codes: YMDCR15, SV131275
    if (/^\d[\d.,:%\/\-\s]*[a-zA-Z%]{0,3}$/.test(s)) return true;  // 12.5%, 3/9, 07:00, 45h
    if (/^\{\{.*\}\}$/.test(s) || /^\[[^\]]+\]$/.test(s)) return true; // template tokens, [Client]
    if (KEEP.indexOf(s) >= 0) return true;
    return false;
  }

  // numbers become {n} so one entry covers every count; the numbers ride back in order
  var NUM = /\d[\d,.]*(?=\D|$)/g;
  function tpl(s) {
    var nums = [];
    var key = norm(s).replace(NUM, function (m) { nums.push(m); return '{n}'; });
    return { key: key, nums: nums };
  }
  function fill(t, nums) {
    var i = 0;
    return String(t == null ? '' : t).replace(/\{n\}/g, function () { return i < nums.length ? nums[i++] : ''; });
  }

  // dictionary answer for a DOM string: exact → number-template → case-insensitive; the
  // string's own leading / trailing whitespace is kept so inline layout never shifts
  function lookup(dict, raw) {
    if (!dict) return null;
    var s = String(raw == null ? '' : raw);
    var lead = (s.match(/^\s*/) || [''])[0], trail = (s.match(/\s*$/) || [''])[0];
    var k = norm(s);
    if (!k || KEEP.indexOf(k) >= 0) return null;
    var out = null;
    // an explicit entry wins over the skip heuristics (the seed may name OPEN / WIP / [Client]);
    // a protected brand / product token never translates, whatever the dictionary says
    if (Object.prototype.hasOwnProperty.call(dict, k)) out = dict[k];
    else if (skip(k)) return null;
    if (out == null) { var t = tpl(k); if (t.nums.length && Object.prototype.hasOwnProperty.call(dict, t.key)) out = fill(dict[t.key], t.nums); }
    if (out == null) { var lc = k.toLowerCase(); var ck = dict.__lc && dict.__lc[lc]; if (ck != null) { out = dict[ck]; if (out && k === k.toUpperCase() && k.length <= 24) out = out.toUpperCase(); } }
    if (out == null || out === '' || out === k) return null;
    return lead + out + trail;
  }
  // build the case-folded index once per dictionary (kept on the dict itself)
  function index(dict) {
    var lc = {};
    Object.keys(dict).forEach(function (k) { if (k.charAt(0) !== '_') lc[k.toLowerCase()] = k; });
    try { Object.defineProperty(dict, '__lc', { value: lc, enumerable: false, configurable: true, writable: true }); } catch (e) { dict.__lc = lc; }
    return dict;
  }

  // the verbatim spans inside a string (for the translator's instructions + a post-check)
  function protect(s) {
    var out = [], m; KEEP_RE.lastIndex = 0;
    while ((m = KEEP_RE.exec(String(s || '')))) out.push(m[2]);
    return out;
  }
  // Vietnamese has no plural inflection: a protected 'SKUs' / 'AMs' legitimately comes back
  // as 'SKU' / 'AM', so a plural whose singular is also protected compares as the singular
  function canon(t) { return (/s$/.test(t) && KEEP.indexOf(t.slice(0, -1)) >= 0) ? t.slice(0, -1) : t; }
  // a translation that dropped a protected token is refused (the caller keeps English)
  function keepsProtected(src, dst) {
    var p = protect(src).map(canon), have = protect(dst).map(canon);
    for (var i = 0; i < p.length; i++) if (have.indexOf(p[i]) < 0) return false;
    var tn = (String(src).match(/\{n\}/g) || []).length, dn = (String(dst || '').match(/\{n\}/g) || []).length;
    return tn === dn;
  }

  return { VERSION: VERSION, KEEP: KEEP, norm: norm, skip: skip, tpl: tpl, fill: fill, lookup: lookup, index: index, protect: protect, keepsProtected: keepsProtected };
}));
