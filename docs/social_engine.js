/*! FeedSpark Social DPA engine — social_engine.js
 *
 * Ray, 8 Oct 2026: "a new feature module for all social DPA optimization, especially Meta,
 * Instagram, Pinterest, or TikTok ads … image overlay, so bring the same kind of mechanics from the
 * overlay module over. I want a preview of how it would look on each platform, side by side … the
 * ad — especially a proper dynamic product ad for Meta — should include a product title, price,
 * buttons, etc. These fields can be dynamically scheduled based on the day, weather, customer
 * behavior, or analytics. For example, a tagline could show the number of clicks over the past 30
 * days or the number of people who have viewed the product in the last 24 hours."
 *
 * WHAT THIS IS. The overlay studio (overlay_studio_engine.js) answers what a feed COULD say on a
 * picture. This engine answers the social half: how the same product reads as a dynamic product ad
 * on each network (its frame, its safe zone, its text limits, its buttons), and which words the ad
 * carries at a given moment — a schedule of rules over the day, the hour, the weather, the
 * shopper's behaviour and the product's own numbers.
 *
 * THREE HONESTY RULES, carried over from the studio because the same mistakes are available here:
 *  1. A RULE NEVER PRINTS A NUMBER IT DOES NOT HAVE. A tagline template naming {views24} on a
 *     product with no 24-hour view figure is REFUSED, with the reason, and the next rule gets its
 *     turn — the ad never reads "0 people viewed this" or "{views24} people viewed this".
 *  2. A NUMBER TOO SMALL TO BE SOCIAL PROOF IS REFUSED TOO. "2 people bought this" is an argument
 *     against buying; each metric carries a print floor (PRINT_MIN) and says so when it stands down.
 *  3. A FIGURE'S SOURCE TRAVELS WITH IT. Price and discount come from the feed, 30-day clicks from
 *     Google Ads (FeedHero's per-product read), and anything the FCC does not measure — views in the
 *     last 24 hours, the weather, the shopper's audience — is a DEMO value typed for the preview and
 *     labelled so. A demo figure on a client screen is fine; a demo figure presented as theirs is not.
 *
 * PLATFORM FIGURES ARE GUIDANCE. Safe zones and text limits below are the commonly published
 * figures (8 Oct 2026: 14% top / 20% bottom on Stories, 35% bottom on Reels, 6% each side; TikTok's
 * caption 100 characters; Pinterest title 100 with ~40 shown; Meta primary text ~125 shown, headline
 * 40). The networks move them and third-party guides disagree, so every one is stated as a guide to
 * confirm in the network's own Ads Manager preview — never as the network's rule.
 *
 * PURE + dependency-free (no DOM, no canvas, no fetch). Shared verbatim by /social (served at
 * /social/engine.js) and tools/test_social.mjs.
 */
(function (root, factory) {
  var api = factory();
  if (typeof define === 'function' && define.amd) { define(function () { return api; }); }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  root.FeedSocial = api;
}(typeof globalThis !== 'undefined' ? globalThis :
  (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var VERSION = '1.0.0';
  var s0 = function (v) { return v == null ? '' : String(v); };

  // ---------------------------------------------------------------- PLATFORMS
  // ratio = [w, h]. safe = the share of each edge the network's own interface covers (t, b, l, r).
  // fields: max = what the network accepts, shown = what a shopper sees before "… more".
  // fit: 'cover' crops the picture to the frame; 'pad' sets it inside a filled frame, which is what
  // a catalogue ad does with a square packshot in a 9:16 placement.
  var PLATFORMS = [
    { id: 'fb_feed', net: 'meta', name: 'Facebook Feed', short: 'FB Feed', ratio: [1, 1], fit: 'cover',
      safe: { t: 0, b: 0, l: 0, r: 0 },
      fields: { primary: { max: 2200, shown: 125 }, headline: { max: 40, shown: 27 }, desc: { max: 30, shown: 27 } },
      ctas: ['Shop now', 'Buy now', 'Order now', 'Get offer', 'Learn more', 'See more'],
      tokens: true, guide: 'https://www.facebook.com/business/ads-guide/update' },
    { id: 'ig_feed', net: 'meta', name: 'Instagram Feed', short: 'IG Feed', ratio: [4, 5], fit: 'cover',
      safe: { t: 0, b: 0, l: 0, r: 0 },
      fields: { primary: { max: 2200, shown: 125 }, headline: { max: 40, shown: 40 } },
      ctas: ['Shop now', 'Buy now', 'Order now', 'Get offer', 'Learn more', 'See more'],
      tokens: true, guide: 'https://www.facebook.com/business/ads-guide/update' },
    { id: 'ig_story', net: 'meta', name: 'Instagram Stories', short: 'IG Stories', ratio: [9, 16], fit: 'pad',
      safe: { t: 0.14, b: 0.20, l: 0.06, r: 0.06 },
      fields: { primary: { max: 2200, shown: 72 }, headline: { max: 40, shown: 40 } },
      ctas: ['Shop now', 'Buy now', 'Order now', 'Get offer', 'Learn more', 'See more'],
      tokens: true, guide: 'https://www.facebook.com/business/ads-guide/update' },
    { id: 'ig_reels', net: 'meta', name: 'Instagram Reels', short: 'IG Reels', ratio: [9, 16], fit: 'pad',
      safe: { t: 0.14, b: 0.35, l: 0.06, r: 0.06 },
      fields: { primary: { max: 2200, shown: 72 }, headline: { max: 40, shown: 40 } },
      ctas: ['Shop now', 'Buy now', 'Order now', 'Get offer', 'Learn more', 'See more'],
      tokens: true, guide: 'https://www.facebook.com/business/ads-guide/update' },
    { id: 'pinterest', net: 'pinterest', name: 'Pinterest', short: 'Pinterest', ratio: [2, 3], fit: 'cover',
      safe: { t: 0, b: 0, l: 0, r: 0 },
      fields: { headline: { max: 100, shown: 40 }, primary: { max: 500, shown: 50 } },
      ctas: ['Visit site', 'Shop'],
      tokens: false, guide: 'https://help.pinterest.com/en/business/article/pinterest-product-specs' },
    { id: 'tiktok', net: 'tiktok', name: 'TikTok', short: 'TikTok', ratio: [9, 16], fit: 'pad',
      safe: { t: 0.07, b: 0.25, l: 0.06, r: 0.13 },
      fields: { primary: { max: 100, shown: 100 } },
      ctas: ['Shop now', 'Order now', 'Buy now', 'Learn more'],
      tokens: false, guide: 'https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads' },
  ];
  var platformById = function (id) { for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].id === id) return PLATFORMS[i]; return null; };

  // the frame, in pixels, for a given width
  function frame(pid, w) {
    var p = platformById(pid); if (!p) return null;
    w = w || 1080;
    return { w: w, h: Math.round(w * p.ratio[1] / p.ratio[0]) };
  }
  // the rectangle the network leaves alone — where an overlay must sit to be read
  function safeRect(pid, w, h) {
    var p = platformById(pid); if (!p) return null;
    var s = p.safe, x = Math.round(w * s.l), y = Math.round(h * s.t);
    return { x: x, y: y, w: w - x - Math.round(w * s.r), h: h - y - Math.round(h * s.b) };
  }
  // what a field shows on a platform: the text as a shopper sees it, and whether it was cut or
  // would be refused. A platform with no slot for the field says so (TikTok has no headline).
  function fitField(pid, field, text) {
    var p = platformById(pid), t = s0(text).replace(/\s+/g, ' ').trim();
    var f = p && p.fields[field];
    if (!f) return { has: false, text: '', len: t.length, why: (p ? p.name : 'this platform') + ' has no ' + FIELD_LABEL[field] + ' slot' };
    var shown = t.length > f.shown ? t.slice(0, Math.max(1, f.shown - 1)).replace(/[\s,.;:–—-]+$/, '') + '…' : t;
    return { has: true, text: shown, full: t, len: t.length, shown: f.shown, max: f.max,
      cut: t.length > f.shown, over: t.length > f.max,
      why: t.length > f.max ? FIELD_LABEL[field] + ' is ' + t.length + ' characters — over the ' + f.max + ' the network accepts'
        : t.length > f.shown ? 'only the first ' + f.shown + ' of ' + t.length + ' characters show before “more”' : '' };
  }
  // a CTA the platform offers, or the nearest one it does, and the reason when they differ
  function ctaFor(pid, want) {
    var p = platformById(pid); if (!p) return { text: s0(want), same: true };
    var w = s0(want).trim().toLowerCase();
    for (var i = 0; i < p.ctas.length; i++) if (p.ctas[i].toLowerCase() === w) return { text: p.ctas[i], same: true };
    var near = /shop|buy|order|get/.test(w) ? (p.ctas.filter(function (c) { return /shop|buy/i.test(c); })[0] || p.ctas[0]) : p.ctas[0];
    return { text: near, same: false, why: p.name + ' offers no “' + want + '” button — the nearest is “' + near + '”' };
  }

  // ---------------------------------------------------------------- FIELDS + TOKENS
  var FIELDS = ['tagline', 'headline', 'primary', 'cta'];
  var FIELD_LABEL = { tagline: 'Image tagline', headline: 'Headline', primary: 'Primary text', cta: 'Button', desc: 'Description' };
  // src: feed = the product's own row · ads = Google Ads via FeedHero · demo = typed for the preview
  // · ctx = the moment being simulated. min = the PRINT FLOOR below which a number is not proof.
  var TOKENS = {
    title:    { label: 'Title',            src: 'feed', meta: '{{product.name}}' },
    brand:    { label: 'Brand',            src: 'feed', meta: '{{product.brand}}' },
    price:    { label: 'Price',            src: 'feed', meta: '{{product.current_price}}' },
    was:      { label: 'Was price',        src: 'feed', meta: '{{product.price}}' },
    pct:      { label: '% off',            src: 'feed', num: true, min: 5 },
    save:     { label: 'Saving',           src: 'feed' },
    colour:   { label: 'Colour',           src: 'feed' },
    stock:    { label: 'Units left',       src: 'master', num: true, max: 25 },
    clicks30: { label: 'Clicks, 30 days',  src: 'ads',  num: true, min: 10 },
    bought30: { label: 'Bought, 30 days',  src: 'ads',  num: true, min: 3 },
    views24:  { label: 'Viewed, 24 hours', src: 'demo', num: true, min: 10 },
    day:      { label: 'Day',              src: 'ctx' },
    weather:  { label: 'Weather',          src: 'ctx' },
    temp:     { label: 'Temperature',      src: 'ctx', num: true },
  };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var WEATHER = { sun: 'sunny', rain: 'rainy', cold: 'cold', hot: 'hot', snow: 'snowy', wind: 'windy' };
  var AUDIENCE = { prospect: 'New prospect', viewed: 'Viewed, not bought', carted: 'Added to basket', bought: 'Past buyer' };
  var DAYPARTS = [
    { id: 'morning', name: 'Morning', from: 6, to: 11, at: 9 },
    { id: 'midday', name: 'Lunch', from: 11, to: 14, at: 12 },
    { id: 'afternoon', name: 'Afternoon', from: 14, to: 17, at: 15 },
    { id: 'evening', name: 'Evening', from: 17, to: 22, at: 19 },
    { id: 'night', name: 'Late night', from: 22, to: 6, at: 23 },
  ];

  function compact(n) {
    var a = Math.abs(n);
    if (a >= 1000000) return (n / 1000000).toFixed(a >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'm';
    if (a >= 10000) return Math.round(n / 1000) + 'k';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  // the value a token resolves to at this moment, or the reason it cannot
  function tokenValue(k, facts, ctx) {
    facts = facts || {}; ctx = ctx || {};
    var T = TOKENS[k];
    if (!T) return { ok: false, why: '{' + k + '} is not a field this module knows' };
    var v;
    if (k === 'day') v = ctx.day != null ? DAYS[ctx.day] : '';
    else if (k === 'weather') v = ctx.weather ? WEATHER[ctx.weather] || ctx.weather : '';
    else if (k === 'temp') v = ctx.temp != null && ctx.temp !== '' ? ctx.temp : null;
    else v = facts[k];
    if (v == null || v === '' || (T.num && !isFinite(+v))) return { ok: false, why: T.label + ' is not measured for this product' };
    if (T.num) {
      var n = +v;
      if (T.min != null && n < T.min) return { ok: false, why: T.label + ' is ' + compact(n) + ' — under the ' + T.min + ' a shopper would read as proof' };
      if (T.max != null && n > T.max) return { ok: false, why: T.label + ' is ' + compact(n) + ' — a stock figure, not scarcity (ceiling ' + T.max + ')' };
      if (k === 'stock' && n <= 0) return { ok: false, why: 'this product is out of stock' };
      v = k === 'temp' ? Math.round(n) + '°' : compact(n);
    }
    var src = (facts.__src && facts.__src[k]) || T.src;
    return { ok: true, text: s0(v), src: src };
  }
  // fill a template; a token that cannot resolve makes the whole template stand down (rule 1)
  function fill(tpl, facts, ctx) {
    var missing = [], srcs = {};
    var text = s0(tpl).replace(/\{(\w+)\}/g, function (m, k) {
      var r = tokenValue(k, facts, ctx);
      if (!r.ok) { missing.push({ k: k, why: r.why }); return ''; }
      srcs[k] = r.src; return r.text;
    }).replace(/\s+/g, ' ').trim();
    return { ok: !missing.length && !!text, text: missing.length ? '' : text, missing: missing, srcs: srcs,
      why: missing.length ? missing.map(function (x) { return x.why; }).join('; ') : (!text ? 'the template is empty' : '') };
  }
  function tokensIn(tpl) { var o = []; s0(tpl).replace(/\{(\w+)\}/g, function (m, k) { if (o.indexOf(k) < 0) o.push(k); return m; }); return o; }
  // the template in Meta's own catalogue keywords, where Meta has one — what a dynamic ad would be
  // set up with, so the same words follow every product rather than this one product's
  function metaTemplate(tpl) {
    var off = [];
    var out = s0(tpl).replace(/\{(\w+)\}/g, function (m, k) {
      var T = TOKENS[k]; if (T && T.meta) return T.meta;
      off.push(k); return '{' + k + '}';
    });
    return { text: out, feedRule: off };
  }

  // ---------------------------------------------------------------- CONDITIONS
  // one condition against the moment (ctx) and the product (facts):
  //   {k:'day', v:[0..6]} · {k:'hours', from, to} (wraps midnight) · {k:'dom', from, to} (day of month)
  //   {k:'dates', from:'YYYY-MM-DD', to} · {k:'weather', v:['rain',…]} · {k:'temp', op, v}
  //   {k:'audience', v:['carted',…]} · {k:'metric', m:<token>, op:'>='|'<=', v}
  function inHours(h, from, to) { h = +h; return from <= to ? h >= from && h < to : h >= from || h < to; }
  function condMatch(c, ctx, facts) {
    ctx = ctx || {}; facts = facts || {};
    if (!c || !c.k) return { ok: true };
    switch (c.k) {
      case 'day': return { ok: (c.v || []).indexOf(+ctx.day) >= 0, why: 'not ' + (c.v || []).map(function (d) { return DAYS[d].slice(0, 3); }).join('/') };
      case 'hours': return { ok: inHours(ctx.hour, +c.from, +c.to), why: 'outside ' + pad2(c.from) + ':00–' + pad2(c.to) + ':00' };
      case 'dom': { var d = +ctx.dom; var ok = c.from <= c.to ? d >= c.from && d <= c.to : d >= c.from || d <= c.to; return { ok: ok, why: 'not between the ' + ord(c.from) + ' and the ' + ord(c.to) }; }
      case 'dates': { var x = s0(ctx.date); return { ok: !!x && (!c.from || x >= c.from) && (!c.to || x <= c.to), why: 'outside ' + (c.from || '…') + ' → ' + (c.to || '…') }; }
      case 'weather': return { ok: (c.v || []).indexOf(ctx.weather) >= 0, why: 'the weather is not ' + (c.v || []).map(function (w) { return WEATHER[w] || w; }).join(' or ') };
      case 'temp': { var t = +ctx.temp; if (ctx.temp == null || ctx.temp === '' || !isFinite(t)) return { ok: false, why: 'no temperature set' };
        return { ok: c.op === '<=' ? t <= +c.v : t >= +c.v, why: 'not ' + (c.op === '<=' ? 'at or under ' : 'at or over ') + c.v + '°' }; }
      case 'audience': return { ok: (c.v || []).indexOf(ctx.audience) >= 0, why: 'the shopper is not ' + (c.v || []).map(function (a) { return (AUDIENCE[a] || a).toLowerCase(); }).join(' or ') };
      case 'metric': {
        var raw = facts[c.m];
        if (raw == null || raw === '' || !isFinite(+raw)) return { ok: false, why: (TOKENS[c.m] ? TOKENS[c.m].label : c.m) + ' is not measured for this product' };
        var n = +raw; return { ok: c.op === '<=' ? n <= +c.v : n >= +c.v, why: (TOKENS[c.m] ? TOKENS[c.m].label : c.m) + ' is ' + compact(n) + ', not ' + (c.op === '<=' ? '≤ ' : '≥ ') + c.v };
      }
    }
    return { ok: false, why: 'unknown condition' };
  }
  function condLabel(c) {
    if (!c) return '';
    switch (c.k) {
      case 'day': return (c.v || []).map(function (d) { return DAYS[d].slice(0, 3); }).join(' · ');
      case 'hours': return pad2(c.from) + ':00–' + pad2(c.to) + ':00';
      case 'dom': return ord(c.from) + '–' + ord(c.to) + ' of the month';
      case 'dates': return (c.from || '…') + ' → ' + (c.to || '…');
      case 'weather': return (c.v || []).map(function (w) { return WEATHER[w] || w; }).join(' or ');
      case 'temp': return 'temp ' + (c.op === '<=' ? '≤ ' : '≥ ') + c.v + '°';
      case 'audience': return (c.v || []).map(function (a) { return AUDIENCE[a] || a; }).join(' or ');
      case 'metric': return (TOKENS[c.m] ? TOKENS[c.m].label : c.m) + ' ' + (c.op === '<=' ? '≤ ' : '≥ ') + c.v;
    }
    return '';
  }
  var pad2 = function (n) { return ('0' + (+n || 0)).slice(-2); };
  function ord(n) { n = +n; var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  // ---------------------------------------------------------------- EVALUATE
  // rules run in ORDER, first match wins per field. Every rule reports what happened to it, so the
  // page can show why the ad says what it says — the question a client asks first.
  //   state: win · shadowed (matched, an earlier rule already won the field) · off · nomatch · refused
  function evaluate(setup, facts, ctx) {
    setup = setup || {}; var rules = setup.rules || [], defs = setup.defaults || {};
    var out = {}, trace = [];
    rules.forEach(function (r, i) {
      var row = { id: r.id, i: i, name: r.name || ('Rule ' + (i + 1)), field: r.field, state: '', why: '' };
      trace.push(row);
      if (r.on === false) { row.state = 'off'; row.why = 'switched off'; return; }
      if (FIELDS.indexOf(r.field) < 0) { row.state = 'off'; row.why = 'no field'; return; }
      var fails = (r.when || []).map(function (c) { return condMatch(c, ctx, facts); }).filter(function (m) { return !m.ok; });
      if (fails.length) { row.state = 'nomatch'; row.why = fails[0].why; return; }
      var f = r.field === 'cta' ? { ok: !!s0(r.value).trim(), text: s0(r.value).trim(), srcs: {}, why: 'no button text' } : fill(r.value, facts, ctx);
      if (!f.ok) { row.state = 'refused'; row.why = f.why; return; }
      if (out[r.field]) { row.state = 'shadowed'; row.why = '“' + out[r.field].rule + '” is earlier in the list and already set this'; return; }
      row.state = 'win'; row.text = f.text;
      out[r.field] = { text: f.text, rule: row.name, id: r.id, srcs: f.srcs };
    });
    FIELDS.forEach(function (k) {
      if (out[k]) return;
      var d = defs[k];
      if (!d) { out[k] = { text: '', rule: '', def: true, srcs: {} }; return; }
      var f = k === 'cta' ? { ok: true, text: s0(d), srcs: {} } : fill(d, facts, ctx);
      out[k] = { text: f.ok ? f.text : '', rule: 'Default', def: true, srcs: f.srcs || {}, why: f.ok ? '' : f.why };
    });
    return { fields: out, trace: trace };
  }

  // THE WEEK AT A GLANCE: what one field says on each day × daypart, the moment's other parts held.
  function weekGrid(setup, facts, base, field) {
    field = field || 'tagline';
    var days = [1, 2, 3, 4, 5, 6, 0];   // Monday first, the way a UK planner reads a week
    return days.map(function (d) {
      return { day: d, name: DAYS[d], cells: DAYPARTS.map(function (p) {
        var ctx = Object.assign({}, base || {}, { day: d, hour: p.at });
        var e = evaluate(setup, facts, ctx).fields[field] || {};
        return { part: p.id, hour: p.at, text: e.text || '', rule: e.rule || '', def: !!e.def, id: e.id || '' };
      }) };
    });
  }
  // how many distinct messages a week of this schedule shows — "one rule, seven days" reads as no schedule
  function weekVariety(grid) {
    var seen = {}; (grid || []).forEach(function (r) { r.cells.forEach(function (c) { if (c.text) seen[c.text] = 1; }); });
    return Object.keys(seen).length;
  }

  // ---------------------------------------------------------------- IDEAS
  // ready-made rules an AM can drop into a schedule while demoing — each states what it needs, so a
  // client is never shown an idea their data cannot run.
  var IDEAS = [
    { id: 'proof30', name: 'Social proof — 30-day clicks', field: 'tagline', value: '{clicks30} clicks in the last 30 days',
      when: [{ k: 'metric', m: 'clicks30', op: '>=', v: 100 }], needs: 'Google Ads (FeedHero, per product)',
      blurb: 'Your own Google Ads demand said back to the shopper. Stands down on a product under 100 clicks.' },
    { id: 'hot24', name: 'Hot right now — viewed in 24 hours', field: 'tagline', value: '{views24} people viewed this today',
      when: [{ k: 'metric', m: 'views24', op: '>=', v: 50 }], needs: 'Meta pixel ViewContent or GA4 (not wired — demo figure)',
      blurb: 'Live interest. Needs a 24-hour view count per product, which the FCC does not read yet.' },
    { id: 'bought', name: 'Bestseller proof', field: 'tagline', value: '{bought30} bought this month',
      when: [{ k: 'metric', m: 'bought30', op: '>=', v: 20 }], needs: 'Google Ads conversions',
      blurb: 'The strongest claim and the one most often too small to print.' },
    { id: 'lowstock', name: 'Low stock urgency', field: 'tagline', value: 'Only {stock} left',
      when: [{ k: 'metric', m: 'stock', op: '<=', v: 10 }], needs: 'stock quantity (master feed — a FeedHero rule to carry it)',
      blurb: 'Scarcity with a real number. The feed rule is the blocker on most of the estate.' },
    { id: 'weekend', name: 'Weekend flash', field: 'tagline', value: 'Weekend offer — {pct}% off',
      when: [{ k: 'day', v: [5, 6, 0] }, { k: 'metric', m: 'pct', op: '>=', v: 10 }], needs: 'a sale price in the feed',
      blurb: 'Friday to Sunday, only on products actually discounted 10% or more.' },
    { id: 'payday', name: 'Payday', field: 'headline', value: 'Payday treat: {title}',
      when: [{ k: 'dom', from: 25, to: 28 }], needs: 'nothing — the calendar',
      blurb: 'UK payday week. Headline only, so the picture stays clean.' },
    { id: 'rain', name: 'Rainy day', field: 'tagline', value: 'Made for {weather} days',
      when: [{ k: 'weather', v: ['rain', 'wind'] }], needs: 'a weather read per market (not wired — simulated)',
      blurb: 'Weather-led copy for outerwear, umbrellas, boots. Needs a weather source behind the feed rule.' },
    { id: 'cold', name: 'Cold snap', field: 'headline', value: 'It’s {temp} out — {title}',
      when: [{ k: 'temp', op: '<=', v: 5 }], needs: 'a temperature read per market (simulated)',
      blurb: 'Knitwear and coats when it drops under 5°.' },
    { id: 'commute', name: 'Evening scroll', field: 'primary', value: 'Unwind tonight — {title}, now {price}.',
      when: [{ k: 'hours', from: 19, to: 23 }], needs: 'nothing — the clock',
      blurb: 'Copy for the evening sofa scroll, when social traffic peaks.' },
    { id: 'basket', name: 'Basket nudge', field: 'cta', value: 'Buy now',
      when: [{ k: 'audience', v: ['carted'] }], needs: 'a retargeting audience (Meta / TikTok)',
      blurb: 'A harder button for shoppers who already added it to their basket.' },
    { id: 'basketcopy', name: 'Still thinking?', field: 'primary', value: 'Still thinking it over? {title} is waiting — {price}.',
      when: [{ k: 'audience', v: ['viewed', 'carted'] }], needs: 'a retargeting audience',
      blurb: 'Retargeting copy for viewers who did not buy.' },
    { id: 'saleword', name: 'Sale price-led', field: 'headline', value: 'Now {price} (was {was})',
      when: [{ k: 'metric', m: 'pct', op: '>=', v: 5 }], needs: 'a sale price in the feed',
      blurb: 'Leads with the saving wherever the feed carries one.' },
  ];
  var ideaById = function (id) { for (var i = 0; i < IDEAS.length; i++) if (IDEAS[i].id === id) return IDEAS[i]; return null; };
  function ruleFromIdea(idea, id) {
    return { id: id || ('r' + Math.random().toString(36).slice(2, 8)), name: idea.name, field: idea.field, value: idea.value,
      when: JSON.parse(JSON.stringify(idea.when || [])), on: true, idea: idea.id };
  }

  var DEFAULTS = { tagline: '', headline: '{title}', primary: 'Shop {title} from {brand} — {price}.', cta: 'Shop now' };
  // the opening schedule: three taglines that take turns across a week (the weekend offer, live
  // interest in the evening, 30-day proof the rest of the time) and a retargeting button + copy —
  // ORDER IS THE PRIORITY, so the narrow rules sit above the broad one or they would never be seen
  function defaultSetup() {
    var rules = ['weekend', 'hot24', 'proof30', 'basket', 'basketcopy'].map(function (k, i) { return ruleFromIdea(ideaById(k), 'r' + (i + 1)); });
    rules[1].name = 'Hot tonight — viewed in 24 hours';
    rules[1].when.unshift({ k: 'hours', from: 17, to: 23 });
    return { v: 1, defaults: Object.assign({}, DEFAULTS), rules: rules };
  }

  // a stored setup is somebody else's input — keep only the shape this engine understands
  var CK = ['day', 'hours', 'dom', 'dates', 'weather', 'temp', 'audience', 'metric'];
  function cleanCond(c) {
    if (!c || CK.indexOf(c.k) < 0) return null;
    var o = { k: c.k };
    if (c.k === 'day') o.v = (Array.isArray(c.v) ? c.v : []).map(Number).filter(function (d) { return d >= 0 && d <= 6; });
    else if (c.k === 'hours') { o.from = clamp(c.from, 0, 23); o.to = clamp(c.to, 0, 24); }
    else if (c.k === 'dom') { o.from = clamp(c.from, 1, 31); o.to = clamp(c.to, 1, 31); }
    else if (c.k === 'dates') { o.from = /^\d{4}-\d{2}-\d{2}$/.test(c.from) ? c.from : ''; o.to = /^\d{4}-\d{2}-\d{2}$/.test(c.to) ? c.to : ''; }
    else if (c.k === 'weather') o.v = (Array.isArray(c.v) ? c.v : []).filter(function (w) { return WEATHER[w]; });
    else if (c.k === 'audience') o.v = (Array.isArray(c.v) ? c.v : []).filter(function (a) { return AUDIENCE[a]; });
    else if (c.k === 'temp') { o.op = c.op === '<=' ? '<=' : '>='; o.v = clamp(c.v, -40, 50); }
    else if (c.k === 'metric') { if (!TOKENS[c.m] || !TOKENS[c.m].num) return null; o.m = c.m; o.op = c.op === '<=' ? '<=' : '>='; o.v = clamp(c.v, 0, 1e9); }
    return o;
  }
  function clamp(v, a, b) { v = Math.round(+v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  function cleanSetup(s) {
    if (!s || typeof s !== 'object') return defaultSetup();
    var d = Object.assign({}, DEFAULTS);
    FIELDS.forEach(function (k) { if (s.defaults && typeof s.defaults[k] === 'string') d[k] = s.defaults[k].slice(0, 300); });
    var rules = (Array.isArray(s.rules) ? s.rules : []).slice(0, 40).map(function (r, i) {
      if (!r || FIELDS.indexOf(r.field) < 0) return null;
      return { id: s0(r.id || ('r' + i)).replace(/[^\w-]/g, '').slice(0, 24) || ('r' + i), name: s0(r.name).slice(0, 80),
        field: r.field, value: s0(r.value).slice(0, 300), on: r.on !== false, idea: s0(r.idea).slice(0, 24),
        when: (Array.isArray(r.when) ? r.when : []).slice(0, 6).map(cleanCond).filter(Boolean) };
    }).filter(Boolean);
    var o = { v: 1, defaults: d, rules: rules };
    if (s.plat && typeof s.plat === 'object') {
      o.plat = {};
      PLATFORMS.forEach(function (p) { var x = s.plat[p.id]; if (x && typeof x === 'object') o.plat[p.id] = {
        img: clamp(x.img, -1, 10), design: s0(x.design).replace(/[^\w-]/g, '').slice(0, 30), cta: s0(x.cta).slice(0, 30), off: !!x.off }; });
    }
    if (s.design) o.design = s0(s.design).replace(/[^\w-]/g, '').slice(0, 30);
    if (s.tagPos) o.tagPos = s.tagPos === 't' ? 't' : 'b';
    if (s.tagStyle) o.tagStyle = ['orange', 'dark', 'light', 'blue'].indexOf(s.tagStyle) >= 0 ? s.tagStyle : 'dark';
    if (s.imgMode) o.imgMode = s.imgMode === 'per' ? 'per' : 'same';
    return o;
  }

  // ---------------------------------------------------------------- THE BRIEF
  // the schedule in words, for a FeedHero rule / Workflow brief: what each rule writes, when, from
  // what data, and which networks it can reach as a native dynamic keyword vs only through the feed
  function briefLines(setup, opts) {
    opts = opts || {};
    var s = cleanSetup(setup), L = [];
    L.push('Social DPA schedule' + (opts.client ? ' — ' + opts.client + (opts.market ? ' ' + String(opts.market).toUpperCase() : '') : ''));
    L.push('');
    L.push('Defaults: headline “' + s.defaults.headline + '” · primary text “' + s.defaults.primary + '” · button “' + s.defaults.cta + '”' + (s.defaults.tagline ? ' · image tagline “' + s.defaults.tagline + '”' : ''));
    L.push('');
    s.rules.filter(function (r) { return r.on; }).forEach(function (r, i) {
      var toks = tokensIn(r.value), srcs = toks.map(function (k) { return TOKENS[k] ? TOKENS[k].src : '?'; });
      var m = metaTemplate(r.value);
      L.push((i + 1) + '. ' + (r.name || 'Rule') + ' → ' + FIELD_LABEL[r.field] + ': “' + r.value + '”');
      L.push('   when: ' + (r.when.length ? r.when.map(condLabel).join(' AND ') : 'always'));
      if (toks.length) L.push('   data: ' + toks.map(function (k, j) { return '{' + k + '} ' + srcs[j]; }).join(', '));
      if (r.field !== 'cta' && r.field !== 'tagline') L.push('   Meta: ' + (m.feedRule.length ? 'needs a feed field for ' + m.feedRule.map(function (k) { return '{' + k + '}'; }).join(' ') + ' (FeedHero rule)' : 'native catalogue keywords — ' + m.text));
      if (r.field === 'tagline') L.push('   image: overlay text param on the image-creator URL, re-rendered on each schedule change');
    });
    L.push('');
    L.push('A rule naming a figure the product does not have stands down and the next rule applies — no ad ever prints a missing or too-small number.');
    return L;
  }

  return {
    VERSION: VERSION, PLATFORMS: PLATFORMS, FIELDS: FIELDS, FIELD_LABEL: FIELD_LABEL, TOKENS: TOKENS, DAYS: DAYS,
    WEATHER: WEATHER, AUDIENCE: AUDIENCE, DAYPARTS: DAYPARTS, IDEAS: IDEAS, DEFAULTS: DEFAULTS,
    platformById: platformById, frame: frame, safeRect: safeRect, fitField: fitField, ctaFor: ctaFor,
    tokenValue: tokenValue, fill: fill, tokensIn: tokensIn, metaTemplate: metaTemplate,
    condMatch: condMatch, condLabel: condLabel, inHours: inHours, evaluate: evaluate,
    weekGrid: weekGrid, weekVariety: weekVariety, ideaById: ideaById, ruleFromIdea: ruleFromIdea,
    defaultSetup: defaultSetup, cleanSetup: cleanSetup, cleanCond: cleanCond, briefLines: briefLines, compact: compact,
  };
}));
