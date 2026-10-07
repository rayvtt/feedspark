/* AI Visibility engine (UMD — window.AIVis in the browser, module.exports in node).
 *
 * Ray, 29 Sep 2026: "lets build 2 AI Surface visibility tracker real-time" — does a client's brand,
 * site and products turn up when a shopper asks an AI answer engine (ChatGPT, Google AI Mode,
 * Google AI Overviews, Perplexity, Claude) the questions the client's catalogue answers?
 *
 * The worker only ASKS (src/aivis.js — one question to one surface, streamed back as the answer, the
 * sources it cited, the searches it ran). EVERYTHING that reads an answer lives here, so it runs the
 * same in the page, in the harness (tools/test_aivis.mjs) and on a stored run re-read later with a
 * different competitor list:
 *   suggestQueries  — shopper questions from the brand's own product-type tree (the PT Guard store)
 *   analyse         — is the brand named, where in the answer, is its own site cited, who else is
 *   summarise       — visibility, share of voice, own-site citation, position, per surface and overall
 *   classify        — whose site a cited domain is: own · competitor · retailer · publisher · forum …
 *   candidates      — brand-looking names the answers lean on that nobody is tracking yet
 *
 * THREE RULES keep the numbers honest:
 *   1. A BRANDED question never counts toward visibility or share of voice — "Is Reiss good?" names
 *      Reiss by construction; it is asked for what the engine SAYS and CITES, not whether it names it.
 *   2. An answer the surface did not give (Google showed no AI Overview, the request failed) is NOT
 *      "not mentioned" — it is left out of every rate and counted on its own.
 *   3. Nothing here guesses a price: an estimated cost exists only where the billing is known
 *      (Claude's published token + search rates); the other surfaces bill on their own plans.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  try { root.AIVis = api; } catch (e) {}
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1';

  // ---- domains -------------------------------------------------------------------------------------------
  // two-level public suffixes the estate's markets (and their press) use — enough to find the brand label
  var SFX2 = { 'co.uk': 1, 'org.uk': 1, 'ac.uk': 1, 'gov.uk': 1, 'me.uk': 1, 'ltd.uk': 1, 'plc.uk': 1, 'com.au': 1, 'net.au': 1,
    'org.au': 1, 'co.nz': 1, 'com.sg': 1, 'com.hk': 1, 'co.jp': 1, 'co.za': 1, 'com.br': 1, 'com.mx': 1, 'co.in': 1, 'com.tr': 1,
    'co.il': 1, 'com.cn': 1, 'co.kr': 1, 'com.sa': 1, 'com.kw': 1, 'com.my': 1, 'com.ph': 1, 'co.th': 1, 'com.ar': 1 };
  function hostOf(u) {
    var s = String(u || '').trim();
    var m = s.toLowerCase().match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@\/?#]*@)?([^\/?#:]+)/);
    return m ? m[1].replace(/^www\d?\./, '').replace(/\.$/, '') : '';
  }
  function regDomain(h) {
    var p = String(h || '').split('.').filter(Boolean);
    if (p.length < 2) return p.join('.');
    var last2 = p.slice(-2).join('.');
    return SFX2[last2] && p.length >= 3 ? p.slice(-3).join('.') : last2;
  }
  function regLabel(h) { return regDomain(h).split('.')[0] || ''; }
  function slug(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/\+/g, 'and').replace(/[^a-z0-9]/g, '');
  }
  // tracking junk the surfaces add to a link (ChatGPT's utm_source, Google's srsltid) — two citations of one
  // page must read as one page
  var JUNK = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|srsltid|ref|ref_src|mc_cid|mc_eid|_ga|igshid)$/i;
  function cleanUrl(u) {
    var s = String(u || '').trim();
    if (!/^https?:\/\//i.test(s)) return s;
    var hash = s.indexOf('#'); if (hash >= 0) s = s.slice(0, hash);
    var q = s.indexOf('?');
    if (q < 0) return s;
    var kept = s.slice(q + 1).split('&').filter(function (kv) { return kv && !JUNK.test(kv.split('=')[0]); });
    return s.slice(0, q) + (kept.length ? '?' + kept.join('&') : '');
  }
  function pathOf(u) {
    var s = cleanUrl(u).replace(/^https?:\/\/[^\/]+/i, '');
    var q = s.indexOf('?'); if (q >= 0) s = s.slice(0, q);
    s = s.toLowerCase().replace(/\/+$/, '');
    try { s = decodeURIComponent(s); } catch (e) {}
    return s || '/';
  }

  // whose site a domain is. The lists name only multi-brand retailers, publishers and forums a shopping answer
  // leans on; anything else is "other" — never guessed into a class
  var RETAIL = ['amazon', 'ebay', 'johnlewis', 'selfridges', 'harrods', 'next', 'asos', 'zalando', 'very', 'argos', 'boots',
    'marksandspencer', 'harveynichols', 'libertylondon', 'farfetch', 'netaporter', 'mytheresa', 'matchesfashion', 'endclothing',
    'jdsports', 'footlocker', 'office', 'sportsdirect', 'tkmaxx', 'walmart', 'target', 'etsy', 'notonthehighstreet',
    'petsathome', 'zooplus', 'viovet', 'petplanet', 'medicanimal', 'therange', 'dunelm', 'theworks', 'houseoffraser', 'flannels',
    'debenhams', 'otto', 'aboutyou', 'bol', 'fnac', 'elcorteingles', 'nordstrom', 'macys', 'bloomingdales', 'saksfifthavenue',
    'costco', 'bestbuy', 'lookfantastic', 'cultbeauty', 'sephora', 'superdrug', 'wayfair', 'hobbycraft', 'americangolf',
    'golfsupport', 'scottsdalegolf', 'onlinegolf', 'clubhousegolf', 'zappos', 'idealo', 'pricerunner', 'google', 'shopstyle', 'lyst'];
  var PRESS = ['vogue', 'gq', 'gqmagazine', 'elle', 'harpersbazaar', 'independent', 'telegraph', 'theguardian', 'dailymail',
    'standard', 'glamourmagazine', 'glamour', 'cosmopolitan', 'marieclaire', 'whowhatwear', 'esquire', 'which', 'bbc',
    'nytimes', 'forbes', 'businessinsider', 'goodhousekeeping', 'womanandhome', 'stylist', 'refinery29', 'instyle',
    'hellomagazine', 'thesun', 'mirror', 'express', 'metro', 'thetimes', 'ft', 'vanityfair', 'tatler', 'grazia', 'allure',
    'byrdie', 'highsnobiety', 'hypebeast', 'menshealth', 'womenshealthmag', 'runnersworld', 'golfmonthly', 'todaysgolfer',
    'golfdigest', 'mygolfspy', 'nationalclubgolfer', 'thesprucepets', 'petmd', 'akc', 'rover', 'bluecross', 'pdsa', 'rspca',
    'dogstrust', 'wirecutter', 'rtings', 'techradar', 'goodto', 'realhomes', 'idealhome', 'countryliving', 'housebeautiful',
    'mensjournal', 'insider', 'usatoday', 'cnn', 'nbcnews', 'people', 'rollingstone', 'fashionbeans', 'thekitchn',
    'thestrategist', 'nymag', 'bustle', 'popsugar', 'shape', 'self', 'prevention', 'healthline', 'verywellhealth'];
  var SOCIAL = ['reddit', 'quora', 'youtube', 'tiktok', 'instagram', 'facebook', 'pinterest', 'mumsnet', 'twitter', 'x',
    'threads', 'medium', 'substack', 'tumblr', 'netmums', 'styleforum', 'discord', 'linkedin'];
  var REVIEW = ['trustpilot', 'reviewsio', 'feefo', 'sitejabber', 'yelp', 'productreview', 'reviewcentre'];
  var REF = ['wikipedia', 'wikihow', 'britannica', 'wiktionary'];
  var CLS = {};
  RETAIL.forEach(function (k) { CLS[k] = 'retail'; }); PRESS.forEach(function (k) { CLS[k] = 'press'; });
  SOCIAL.forEach(function (k) { CLS[k] = 'social'; }); REVIEW.forEach(function (k) { CLS[k] = 'review'; }); REF.forEach(function (k) { CLS[k] = 'ref'; });
  var CLASSES = [
    { k: 'own', n: 'Your site' }, { k: 'comp', n: 'Competitor' }, { k: 'retail', n: 'Retailer / marketplace' },
    { k: 'press', n: 'Publisher / review' }, { k: 'social', n: 'Forum / social' }, { k: 'review', n: 'Review site' },
    { k: 'ref', n: 'Reference' }, { k: 'other', n: 'Other site' }];

  // the brand being tracked: its name, aliases, its own domains — a domain whose registrable label IS the brand
  // (schuh.co.uk, schuh.ie, uk.accessorize.com) is its own site with no configuration
  function brandCtx(name, opt) {
    opt = opt || {};
    var names = [name].concat(opt.aliases || []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    var doms = (opt.domains || []).map(function (d) { return regDomain(hostOf(d)); }).filter(Boolean);
    var comps = (opt.comps || []).map(function (c) {
      c = typeof c === 'string' ? { n: c } : (c || {});
      var cn = [c.n].concat(c.a || []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
      return { n: String(c.n || '').trim(), names: cn, slug: slug(c.n), d: (c.d || []).map(function (d) { return regDomain(hostOf(d)); }).filter(Boolean) };
    }).filter(function (c) { return c.n && c.slug !== slug(name); });
    return { n: String(name || '').trim(), names: names, slug: slug(name), d: doms, comps: comps };
  }
  function classify(h, ctx) {
    var host = hostOf(h), rd = regDomain(host), lab = slug(regLabel(host));
    if (!host) return 'other';
    if (ctx) {
      if ((ctx.d || []).indexOf(rd) >= 0 || (ctx.slug && lab === ctx.slug)) return 'own';
      for (var i = 0; i < (ctx.comps || []).length; i++) {
        var c = ctx.comps[i];
        if (c.d.indexOf(rd) >= 0 || (c.slug && lab === c.slug)) return 'comp';
      }
    }
    return CLS[lab] || 'other';
  }
  function compOfHost(h, ctx) {
    var host = hostOf(h), rd = regDomain(host), lab = slug(regLabel(host));
    for (var i = 0; i < ((ctx && ctx.comps) || []).length; i++) {
      var c = ctx.comps[i];
      if (c.d.indexOf(rd) >= 0 || (c.slug && lab === c.slug)) return c.n;
    }
    return null;
  }

  // ---- names in an answer ----------------------------------------------------------------------------------
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // a common word that is also a brand (Next, Office, Coast, Boots) is only a mention when it is capitalised
  var COMMON = { next: 1, office: 1, coast: 1, east: 1, oasis: 1, boots: 1, very: 1, target: 1, whistles: 1, jigsaw: 1, phase: 1,
    range: 1, therange: 1, joules: 1, monsoon: 1, accessorize: 1, superdry: 0, arket: 0, cos: 1, dune: 1, clarks: 0, seasalt: 1, white: 1,
    whitestuff: 1, mango: 1, gap: 1, river: 1, riverisland: 1, oliver: 1, fossil: 1, pandora: 1, apple: 1, style: 1 };
  function nameRe(n) {
    var body = reEsc(n.trim()).replace(/\s+/g, '\\s+').replace(/'/g, "['’]?").replace(/&/g, '(?:&|and)');
    var strict = COMMON[slug(n)] === 1 || n.replace(/[^A-Za-z0-9]/g, '').length <= 3;
    return { re: new RegExp('(?<![\\p{L}\\p{N}])' + body + '(?![\\p{L}\\p{N}])', strict ? 'gu' : 'giu'), strict: strict };
  }
  // every tracked brand the text names, in the order it first names them
  function mentions(text, ctx) {
    var t = String(text || ''), out = [];
    var all = [{ n: ctx.n, names: ctx.names, own: true }].concat((ctx.comps || []).map(function (c) { return { n: c.n, names: c.names, own: false }; }));
    all.forEach(function (b) {
      var best = -1;
      b.names.forEach(function (nm) {
        if (!nm) return;
        var R = nameRe(nm), m;
        R.re.lastIndex = 0;
        while ((m = R.re.exec(t))) {
          // strict names must start upper-case where they appear (Next, not "next")
          if (R.strict && !/^[\p{Lu}\p{N}]/u.test(m[0])) continue;
          if (best < 0 || m.index < best) best = m.index;
          break;
        }
      });
      if (best >= 0) out.push({ n: b.n, own: b.own, at: best });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    out.forEach(function (m, i) { m.rank = i + 1; });
    return out;
  }
  function snippet(text, at) {
    var t = String(text || '');
    if (at == null || at < 0) return '';
    var a = Math.max(t.lastIndexOf('\n', at), t.lastIndexOf('. ', at) + 1, at - 160, 0);
    var b = t.indexOf('\n', at); if (b < 0 || b - at > 220) b = Math.min(t.length, at + 220);
    var dot = t.indexOf('. ', at); if (dot > at && dot < b) b = dot + 1;
    return t.slice(a, b).replace(/\*\*|__|#+\s/g, '').replace(/\s+/g, ' ').trim();
  }
  // a question that names the brand is BRANDED — asked for what the engine says, never counted as visibility
  function isBranded(q, ctx) {
    if (q && (q.type === 'brand')) return true;
    var t = typeof q === 'string' ? q : (q && q.q) || '';
    return mentions(t, { n: ctx.n, names: ctx.names, comps: [] }).length > 0;
  }

  // ---- brand-looking names nobody is tracking yet --------------------------------------------------------------
  var NOT_BRAND = /^(best|top|budget|premium|luxury|value|overall|price|prices|pros|cons|why|what|how|where|when|note|notes|tip|tips|tl;?dr|summary|verdict|bottom line|key|features|feature|option|options|materials?|sizing|fit|quality|care|conclusion|recommendations?|alternatives?|runner[- ]up|honou?rable mentions?|for|the|a|an|uk|us|eu|sale|new|mid[- ]range|high[- ]street|high[- ]end|designer|sustainable|ethical|affordable|investment|classic|casual|formal|men|women|womens|mens|kids|size|colour|color|style|styles|brand|brands|retailer|retailers|online|in[- ]store|delivery|returns|shipping|warranty|comfort|durability|cashmere|merino|wool|leather|cotton|linen|silk|denim|dresses|jumpers|shoes|boots|trainers|sneakers|jackets|coats|shirts)$/i;
  function candidates(text, ctx) {
    var t = String(text || ''), seen = {}, out = [];
    var tracked = {}; if (ctx) [ctx].concat(ctx.comps || []).forEach(function (b) { (b.names || [b.n]).forEach(function (n) { tracked[slug(n)] = 1; }); });
    function add(raw) {
      var n = String(raw || '').replace(/[*_`#]/g, '').replace(/\s*\(.*$/, '').replace(/[:–—\-,.]+$/, '').trim();
      if (n.length < 2 || n.length > 36 || !/^[\p{Lu}\p{N}]/u.test(n)) return;
      if (n.split(/\s+/).length > 4) return;
      if (NOT_BRAND.test(n) || NOT_BRAND.test(n.split(/\s+/)[0])) return;
      var k = slug(n); if (!k || tracked[k] || seen[k]) return;
      seen[k] = 1; out.push(n);
    }
    var m, re1 = /\*\*([^*\n]{2,40})\*\*/g;
    while ((m = re1.exec(t))) add(m[1].split(/\s[–—-]\s|:\s/)[0]);
    var re2 = /^\s*(?:\d+[.)]|[-*•])\s+([^\n:–—]{2,40}?)\s*(?:[:–—]|\s-\s)/gm;
    while ((m = re2.exec(t))) add(m[1]);
    return out;
  }

  // ---- products: a cited product page, or a product named by its own title ------------------------------------
  function titleCore(title, ctx) {
    var t = ' ' + String(title || '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ') + ' ';
    (ctx ? ctx.names : []).forEach(function (n) { t = t.split(' ' + String(n).toLowerCase() + ' ').join(' '); });
    var w = t.trim().split(/\s+/).filter(function (x) { return /\p{L}/u.test(x); }).slice(0, 3);
    var c = w.join(' ');
    return w.length >= 2 && c.length >= 12 ? c : '';
  }
  // rows: [{id, t (title), l (link)}] from the brand's own feed
  function prodIndex(rows, ctx) {
    var byPath = {}, cores = {}, n = 0;
    (rows || []).forEach(function (r) {
      if (!r || !r.id) return; n++;
      if (r.l) { var p = pathOf(r.l); if (p && p !== '/' && !byPath[p]) byPath[p] = r; }
      var c = titleCore(r.t, ctx);
      if (c) { if (!cores[c]) cores[c] = { c: c, p: r, n: 0 }; cores[c].n++; }
    });
    return { n: n, byPath: byPath, cores: Object.keys(cores).map(function (k) { return cores[k]; }) };
  }
  function prodHits(res, idx, ctx) {
    if (!idx || !idx.n) return [];
    var out = [], got = {};
    (res.cites || []).concat(res.results || []).forEach(function (c) {
      if (classify(c.u, ctx) !== 'own') return;
      var p = idx.byPath[pathOf(c.u)];
      if (p && !got[p.id]) { got[p.id] = 1; out.push({ id: p.id, t: p.t, l: p.l, how: 'linked' }); }
    });
    var low = ' ' + String(res.text || '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ') + ' ';
    idx.cores.forEach(function (c) {
      if (got[c.p.id] || low.indexOf(' ' + c.c + ' ') < 0) return;
      got[c.p.id] = 1; out.push({ id: c.p.id, t: c.p.t, l: c.p.l, how: 'named', v: c.n });
    });
    return out.slice(0, 12);
  }

  // ---- one answer --------------------------------------------------------------------------------------------
  // r = the stored cell {qid, q, type, s, ok, none, err, text, cites:[{u,t}], results:[{u,t}], searches:[]}
  function analyse(r, ctx, idx) {
    r = r || {};
    var out = { s: r.s, qid: r.qid, ok: !!r.ok, none: !!r.none, err: r.err || null, branded: isBranded({ q: r.q, type: r.type }, ctx) };
    if (!out.ok || out.none) return out;
    var men = mentions(r.text, ctx), own = null;
    men.forEach(function (m) { if (m.own && !own) own = m; });
    out.named = !!own; out.pos = own ? own.rank : null; out.of = men.length;
    out.men = men.map(function (m) { return m.n; });
    out.comps = men.filter(function (m) { return !m.own; }).map(function (m) { return m.n; });
    out.snip = own ? snippet(r.text, own.at) : '';
    var dom = {}, order = [];
    function put(u, cited) {
      var h = hostOf(u); if (!h) return;
      var rd = regDomain(h);
      if (!dom[rd]) { dom[rd] = { h: rd, cls: classify(h, ctx), cited: false, seen: false, comp: compOfHost(h, ctx) }; order.push(rd); }
      if (cited) dom[rd].cited = true; else dom[rd].seen = true;
    }
    (r.cites || []).forEach(function (c) { put(c.u, true); });
    (r.results || []).forEach(function (c) { put(c.u, false); });
    out.doms = order.map(function (k) { return dom[k]; });
    out.ownCited = out.doms.some(function (d) { return d.cls === 'own' && d.cited; });
    out.ownSeen = out.doms.some(function (d) { return d.cls === 'own'; });
    out.nCites = (r.cites || []).length;
    out.cands = candidates(r.text, ctx);
    out.prods = prodHits(r, idx, ctx);
    return out;
  }

  // ---- a run (or any set of answers) --------------------------------------------------------------------------
  function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 : null; }
  function blank() { return { n: 0, ans: 0, none: 0, err: 0, u: 0, named: 0, posSum: 0, posN: 0, cited: 0, sovOwn: 0, sovAll: 0, prods: 0 }; }
  function summarise(an, ctx) {
    var S = { all: blank() }, brands = {}, doms = {}, cands = {}, prods = {};
    function bump(o, a) {
      o.n++;
      if (!a.ok) { o.err++; return; }
      if (a.none) { o.none++; return; }
      o.ans++;
      if (a.ownCited) o.cited++;
      if (a.prods && a.prods.length) o.prods++;
      if (a.branded) return;
      o.u++;
      if (a.named) { o.named++; if (a.pos) { o.posSum += a.pos; o.posN++; } }
      o.sovAll += (a.men || []).length; if (a.named) o.sovOwn++;
    }
    [ctx.n].concat((ctx.comps || []).map(function (c) { return c.n; })).forEach(function (n, i) { brands[n] = { n: n, own: i === 0, u: 0, pos: 0, posN: 0 }; });
    (an || []).forEach(function (a) {
      if (!a) return;
      bump(S.all, a);
      if (a.s) { S[a.s] = S[a.s] || blank(); bump(S[a.s], a); }
      if (!a.ok || a.none) return;
      if (!a.branded) (a.men || []).forEach(function (n, i) { var b = brands[n]; if (b) { b.u++; b.pos += i + 1; b.posN++; } });
      (a.doms || []).forEach(function (d) {
        var x = doms[d.h] || (doms[d.h] = { h: d.h, cls: d.cls, comp: d.comp, cited: 0, seen: 0 });
        if (d.cited) x.cited++; else x.seen++;
      });
      if (!a.branded) (a.cands || []).forEach(function (n) { var k = slug(n); (cands[k] = cands[k] || { n: n, c: 0 }).c++; });
      (a.prods || []).forEach(function (p) { var x = prods[p.id] || (prods[p.id] = { id: p.id, t: p.t, l: p.l, c: 0, how: p.how }); x.c++; if (p.how === 'linked') x.how = 'linked'; });
    });
    function fin(o) {
      return { n: o.n, ans: o.ans, none: o.none, err: o.err, u: o.u, named: o.named, cited: o.cited, prods: o.prods,
        vis: pct(o.named, o.u), sov: pct(o.sovOwn, o.sovAll), cite: pct(o.cited, o.ans), pos: o.posN ? Math.round((o.posSum / o.posN) * 10) / 10 : null };
    }
    var out = { by: {} };
    Object.keys(S).forEach(function (k) { if (k === 'all') out.all = fin(S.all); else out.by[k] = fin(S[k]); });
    var tot = 0; Object.keys(brands).forEach(function (k) { tot += brands[k].u; });
    out.brands = Object.keys(brands).map(function (k) { var b = brands[k]; return { n: b.n, own: b.own, u: b.u, sov: pct(b.u, tot), vis: pct(b.u, out.all.u), pos: b.posN ? Math.round((b.pos / b.posN) * 10) / 10 : null }; })
      .sort(function (a, b) { return b.u - a.u || (a.own ? -1 : 1); });
    out.doms = Object.keys(doms).map(function (k) { return doms[k]; }).sort(function (a, b) { return b.cited - a.cited || b.seen - a.seen || (a.h < b.h ? -1 : 1); });
    out.cands = Object.keys(cands).map(function (k) { return cands[k]; }).filter(function (c) { return c.c >= 1; }).sort(function (a, b) { return b.c - a.c || (a.n < b.n ? -1 : 1); }).slice(0, 24);
    out.prods = Object.keys(prods).map(function (k) { return prods[k]; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 40);
    return out;
  }
  // the small record a run carries in its KV metadata (≤1 KB): per surface + overall, nothing else
  function compact(sum) {
    function c(o) { return o ? { n: o.n, a: o.ans, u: o.u, v: o.vis, s: o.sov, c: o.cite, p: o.pos } : null; }
    var out = { all: c(sum && sum.all), by: {} };
    Object.keys((sum && sum.by) || {}).forEach(function (k) { out.by[k] = c(sum.by[k]); });
    return out;
  }

  // ---- shopper questions from the brand's own category tree ----------------------------------------------------
  var GENDER = { women: "women's", womens: "women's", "women's": "women's", ladies: "women's", woman: "women's", men: "men's", mens: "men's",
    "men's": "men's", man: "men's", kids: "kids'", "kids'": "kids'", children: "children's", girls: "girls'", boys: "boys'", baby: 'baby',
    damen: 'Damen', herren: 'Herren', kinder: 'Kinder', 'mädchen': 'Mädchen', jungen: 'Jungen' };
  var GENERIC = /^(all|all products|other|others|misc|miscellaneous|view all|shop all|sonstige|alle|new|new in|sale|clearance|outlet|default|uncategori[sz]ed|products?|home|root|\d+)$/i;
  function leafPhrase(path, lang) {
    var segs = String(path || '').split(/\s*(?:>|\/|\|)\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    while (segs.length > 1 && GENERIC.test(segs[segs.length - 1])) segs.pop();
    if (!segs.length || GENERIC.test(segs[segs.length - 1])) return '';
    var leaf = segs[segs.length - 1], g = '';
    for (var i = 0; i < segs.length - 1; i++) { var k = segs[i].toLowerCase(); if (GENDER[k] != null) { g = GENDER[k]; break; } }
    var p = lang === 'de' ? leaf : leaf.split(/\s+/).map(function (w) { return /^[A-Z0-9&'-]{2,5}$/.test(w) && /[A-Z]{2}/.test(w) ? w : w.toLowerCase(); }).join(' ');
    var gs = g.toLowerCase().replace(/['’]s?$|s['’]$/, '');
    if (g && p.toLowerCase().indexOf(gs) < 0) p = g + ' ' + p;
    return p.length >= 3 && p.length <= 60 ? p : '';
  }
  var TPL = {
    en: { cat: 'What are the best {p} to buy online {in}?', buy: 'Where is the best place to buy {p} {in}?',
      known: 'What is {b} known for, and is it worth buying from?', vs: 'Which is better for {p}: {b} or {c}?', good: 'Is {b} a good place to buy {p}?' },
    de: { cat: 'Was sind die besten {p}, die man {in} online kaufen kann?', buy: 'Wo kauft man {p} {in} am besten online?',
      known: 'Wofür ist {b} bekannt, und lohnt sich ein Kauf dort?', vs: 'Was ist besser für {p}: {b} oder {c}?', good: 'Ist {b} eine gute Adresse für {p}?' } };
  function fill(t, o) { return t.replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? '' : o[k]; }).replace(/\s+([?,])/g, '$1').replace(/\s{2,}/g, ' ').trim(); }
  // pt: [[path, count], …] (the PT Guard pivot); meta: the market ({lang, in, inL}); n = unbranded questions
  function suggestQueries(pt, ctx, meta, n) {
    meta = meta || {}; n = n || 6;
    var lang = meta.lang === 'de' ? 'de' : 'en', T = TPL[lang];
    var inP = lang === 'de' ? (meta.inL || meta.in || '') : (meta.in || '');
    var ranked = (pt || []).filter(function (x) { return x && x[0]; }).slice().sort(function (a, b) { return (b[1] || 0) - (a[1] || 0); });
    var seen = {}, phrases = [];
    for (var i = 0; i < ranked.length && phrases.length < n; i++) {
      var p = leafPhrase(ranked[i][0], lang);
      if (!p) continue;
      var k = slug(p); if (seen[k] || (ctx && slug(p) === ctx.slug)) continue;
      seen[k] = 1; phrases.push({ p: p, src: ranked[i][0], v: ranked[i][1] || 0 });
    }
    var out = [];
    phrases.forEach(function (ph, i) {
      var type = i % 3 === 2 ? 'buy' : 'cat';
      out.push({ id: 'q' + slug(type + ph.p).slice(0, 40), q: fill(T[type], { p: ph.p, in: inP }), type: type, src: ph.src, v: ph.v });
    });
    if (ctx && ctx.n) {
      out.push({ id: 'qbknown', q: fill(T.known, { b: ctx.n }), type: 'brand' });
      var top = phrases[0], comp = (ctx.comps || [])[0];
      if (top) out.push({ id: 'qbvs', q: comp ? fill(T.vs, { p: top.p, b: ctx.n, c: comp.n }) : fill(T.good, { b: ctx.n, p: top.p }), type: 'brand' });
    }
    return out;
  }

  // ---- cost: only where the billing is published --------------------------------------------------------------
  // Claude: tokens at the model's list rate + $10 per 1,000 web searches. The other surfaces bill on their
  // own plans (OpenAI tokens + tool calls, Perplexity per request, SerpApi per search) — never guessed here.
  var RATES = { 'claude-opus-5-5': { i: 4, o: 20 }, 'claude-sonnet-5-5': { i: 2, o: 10 } };
  function costOf(s, usage, model) {
    if (s !== 'claude' || !usage) return null;
    var r = RATES[model] || RATES['claude-opus-5-5'];
    return Math.round((((usage.i || 0) * r.i + (usage.o || 0) * r.o) / 1e6 + (usage.ws || 0) * 0.01) * 1000) / 1000;
  }
  // what a Claude answer costs before it is asked, from a typical shopping answer (≈20k tokens of search results
  // in, ≈1.5k out, two searches) — a planning figure, printed as one
  var CLAUDE_TYPICAL = 0.12;

  // ---- starter competitor lists — public brand names only, for the AM to edit -----------------------------------
  var COMP_SEEDS = {
    'reiss': ['Whistles', 'Hobbs', 'Jigsaw', 'Ted Baker', 'Karen Millen', 'COS', 'Arket', 'Me+Em', 'Sandro', 'Massimo Dutti'],
    'superdry': ['Jack Wills', 'Fat Face', 'Hollister', 'Abercrombie & Fitch', "Levi's", 'Tommy Hilfiger', 'The North Face', 'Barbour'],
    'schuh': ['Office', 'JD Sports', 'Foot Locker', 'Kurt Geiger', 'Clarks', 'Dune', 'Deichmann', 'Size?'],
    'monsoon': ['Phase Eight', 'Boden', 'Joules', 'Hobbs', 'Coast', 'Seasalt', 'White Stuff', 'East'],
    'accessorize': ["Claire's", 'Oliver Bonas', 'Pandora', 'Radley', 'Fossil', 'Joules', 'Next'],
    'yumove': ['Seraquin', 'Cosequin', 'Synoquin', 'Pooch & Mutt', 'Protexin', 'Nutramax'],
    'hobbycraft': ['The Range', 'Wool Warehouse', 'Create and Craft', 'Cass Art', 'Dunelm', 'Michaels'],
    'americangolf': ['Golf Support', 'Scottsdale Golf', 'Online Golf', 'Clubhouse Golf', 'Golfbidder'],
    'houseofbruar': ['Johnstons of Elgin', 'Barbour', 'Brora', 'Cordings', 'Schöffel', 'Really Wild']
  };
  function compSeed(client) { return (COMP_SEEDS[slug(client)] || []).map(function (n) { return { n: n }; }); }

  // ---- CSV of a run, one row per answer ------------------------------------------------------------------------
  function csvRows(cells, an, surfaceName) {
    var head = ['Question', 'Type', 'Surface', 'Answered', 'Brand named', 'Position', 'Brands named (in order)', 'Own site cited', 'Sources cited', 'Cited domains', 'Products', 'Searches run'];
    var rows = (cells || []).map(function (c, i) {
      var a = an[i] || {};
      var st = !c.ok ? 'error: ' + (c.err || '') : (c.none ? 'no answer shown' : 'yes');
      return [c.q, a.branded ? 'branded' : (c.type || 'custom'), surfaceName ? surfaceName(c.s) : c.s, st,
        a.ok && !a.none ? (a.named ? 'yes' : 'no') : '', a.pos || '', (a.men || []).join(' · '), a.ok && !a.none ? (a.ownCited ? 'yes' : 'no') : '',
        a.nCites == null ? '' : a.nCites, (a.doms || []).filter(function (d) { return d.cited; }).map(function (d) { return d.h; }).join(' · '),
        (a.prods || []).map(function (p) { return p.id; }).join(' · '), (c.searches || []).join(' · ')];
    });
    return { head: head, rows: rows };
  }

  return { VERSION: VERSION, hostOf: hostOf, regDomain: regDomain, regLabel: regLabel, slug: slug, cleanUrl: cleanUrl, pathOf: pathOf,
    CLASSES: CLASSES, classify: classify, brandCtx: brandCtx, mentions: mentions, snippet: snippet, isBranded: isBranded, candidates: candidates,
    titleCore: titleCore, prodIndex: prodIndex, prodHits: prodHits, analyse: analyse, summarise: summarise, compact: compact,
    leafPhrase: leafPhrase, suggestQueries: suggestQueries, TPL: TPL, costOf: costOf, CLAUDE_TYPICAL: CLAUDE_TYPICAL,
    COMP_SEEDS: COMP_SEEDS, compSeed: compSeed, csvRows: csvRows };
});
