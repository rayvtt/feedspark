/*! FeedSpark Overlay Design Studio engine — overlay_studio_engine.js
 *
 * Ray, 7 Oct 2026: "within image overlays - build a design module to see if client's images would
 * look like with our FeedSpark smart overlay (giving a variety of different overlay designs such as
 * promotional messages (sale ... % off, x units left, x clicks over past 30 days) - pulling in
 * messaging based on feeds & adwords data using a module to summon fields and make it techy".
 *
 * WHAT THIS IS. /overlays reads what overlay is ALREADY live on a feed (overlay_engine.js decodes
 * the image-creator URL). This engine answers the other question — what a feed COULD say, and what
 * it would look like — so an AM can show a client a design before anybody builds it.
 *
 * WHY A FIELD SUMMONER AND NOT A FIELD MAP. Measured on the live estate, 7 Oct 2026: the master
 * feeds disagree completely (Monsoon g:price + g:was_price, Schuh price + sale_price where `price`
 * is the RRP, YuMOVE price + compare_at_price), and the two columns mean OPPOSITE things on
 * Monsoon and Schuh. A name list would print a wrong discount on half the estate, and a wrong
 * discount on a client's own product image is the worst thing this module could do. So the pair is
 * resolved BY VALUE: whichever column is consistently the higher is the was-price. The reading
 * carries its own evidence (rows compared, how many agreed) because a resolution nobody can check
 * is a resolution nobody should trust.
 *
 * THREE HONESTY RULES, each measured rather than assumed:
 *  1. A FACT STATES ITS COVERAGE. g:sale_price fills 11/60 of Schuh GB and 22/60 of Monsoon GB, so
 *     a "% OFF" design covers a fifth to a third of those catalogues. The studio says so; it never
 *     draws a design over a feed it would only fit a fraction of without naming the fraction.
 *  2. A FACT NOT IN THE FEED IS NOT MOCKED UP. Stock quantity is in Monsoon's and Schuh's MASTER
 *     feeds (stock_quantity / stockquantity) and in NO output feed the overlay engine reads — so
 *     "x units left" is previewed from the master with the real number and reported as needing a
 *     FeedHero rule to carry the field into the output feed before it could ship. Inventing a
 *     number to fill a design is the one thing a preview must never do.
 *  3. A NUMBER THAT WOULD READ AS NONSENSE IS REFUSED. YuMOVE's inventory_quantity is 5,044 — "Only
 *     5044 left" is not scarcity, so a scarcity fact has a plausibility ceiling and says why it
 *     stood down rather than printing it.
 *
 * PURE + dependency-free. No DOM, no canvas, no fetch — the geometry is pure so the harness can
 * assert that no zone leaves the image, no two zones overlap and every line fits its box, which is
 * where overlay bugs actually live. The painting is the page's (canvas), the layout is here.
 *
 * Shared verbatim by: the /overlays Design studio section, and tools/test_ovstudio.mjs.
 */
(function (root, factory) {
  var api = factory();
  if (typeof define === 'function' && define.amd) { define(function () { return api; }); }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  root.FeedOverlayStudio = api;
}(typeof globalThis !== 'undefined' ? globalThis :
  (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var VERSION = '1.0.0';

  // ---------------------------------------------------------------- helpers
  var s0 = function (v) { return v == null ? '' : String(v); };
  function normKey(k) {
    // the feed's own spelling, reduced to something comparable: g:/c:/fs: prefixes off, the XML
    // parser's repeat suffix off (additional_image_link_2 / (2)), separators out
    return s0(k).trim().toLowerCase()
      .replace(/^(g|c|fs|mi|b):/, '')
      .replace(/[\s_\-.]+/g, '');
  }
  function nkBase(k) {
    // the slot name without a repeat index, so image1url and image2url share a base
    return normKey(k).replace(/\((\d+)\)$/, '').replace(/(\d+)$/, '');
  }

  var CUR_SYM = { GBP: '\u00a3', EUR: '\u20ac', USD: '$', AUD: '$', CAD: '$', SEK: 'kr', DKK: 'kr', PLN: 'z\u0142', CHF: 'CHF', AED: 'AED', SAR: 'SAR', HKD: '$', SGD: '$', CZK: 'K\u010d', RON: 'lei' };
  var SYM_CUR = { '\u00a3': 'GBP', '\u20ac': 'EUR', '$': 'USD' };

  // "150.00 GBP" | "£30.00" | "15,99 €" | "38" -> { n, cur } | null.  A money column is the one
  // place this engine must not be clever: a wrong read is a wrong price on a client's picture.
  function money(v) {
    var s = s0(v).trim();
    if (!s) return null;
    var cur = '';
    var m = s.match(/\b([A-Z]{3})\b/); if (m && CUR_SYM[m[1]]) cur = m[1];
    if (!cur) { for (var sym in SYM_CUR) { if (s.indexOf(sym) >= 0) { cur = SYM_CUR[sym]; break; } } }
    var num = s.replace(/[A-Za-z\u00a3\u20ac$\s]/g, '');
    if (!num) return null;
    // 1.234,56 (continental) vs 1,234.56 — decide on which separator comes last
    var lastC = num.lastIndexOf(','), lastD = num.lastIndexOf('.');
    if (lastC >= 0 && lastD >= 0) num = lastC > lastD ? num.replace(/\./g, '').replace(',', '.') : num.replace(/,/g, '');
    else if (lastC >= 0) num = (num.length - lastC - 1) === 3 ? num.replace(/,/g, '') : num.replace(',', '.');
    var n = parseFloat(num);
    if (!isFinite(n) || n < 0) return null;
    return { n: Math.round(n * 100) / 100, cur: cur };
  }
  function fmtMoney(n, cur) {
    if (n == null || !isFinite(n)) return '';
    var sym = CUR_SYM[cur] || '';
    var whole = Math.abs(n - Math.round(n)) < 0.005;
    var body = whole ? String(Math.round(n)) : n.toFixed(2);
    body = body.replace(/\B(?=(\d{3})+(?!\d))/, ',');
    if (!sym) return body + (cur ? ' ' + cur : '');
    return /^[A-Z]{2,}$/.test(sym) ? sym + ' ' + body : sym + body;
  }
  function intOf(v) {
    var s = s0(v).replace(/[,\s]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var n = Math.round(parseFloat(s));
    return isFinite(n) ? n : null;
  }
  function compact(n) {
    if (n == null) return '';
    var a = Math.abs(n);
    if (a >= 1000000) return (n / 1000000).toFixed(a >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'm';
    if (a >= 10000) return Math.round(n / 1000) + 'k';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pctOff(was, now) {
    if (was == null || now == null || was <= 0 || now < 0 || now >= was) return null;
    return Math.round(((was - now) / was) * 100);
  }

  // ---------------------------------------------------------------- SLOTS
  // A slot is a RAW fact a feed column can carry. `names` are the spellings seen across the live
  // estate (Google/Meta output feeds + the FeedHero masters, read 7 Oct 2026) — a name match is a
  // nomination, never a binding on its own: every slot is also checked against its own values.
  var SLOTS = {
    id:        { label: 'Product ID',    kind: 'text',  names: ['id', 'productid', 'itemid', 'sku'] },
    title:     { label: 'Title',         kind: 'text',  names: ['title', 'name', 'producttitle', 'shorttitle'] },
    brand:     { label: 'Brand',         kind: 'text',  names: ['brand', 'vendor', 'manufacturer'] },
    image:     { label: 'Image',         kind: 'url',   names: ['imagelink', 'image', 'imageurl', 'mainimage', 'image1url', 'imagelink1'] },
    image2:    { label: 'Second image',  kind: 'url',   names: ['additionalimagelink', 'image2url', 'additionalimage', 'lifestyleimage'] },
    priceA:    { label: 'Price column',  kind: 'money', names: ['price', 'rrp', 'listprice', 'fullprice', 'wasprice', 'regularprice', 'originalprice', 'compareatprice'] },
    priceB:    { label: 'Second price',  kind: 'money', names: ['saleprice', 'nowprice', 'currentprice', 'specialprice', 'discountprice', 'offerprice'] },
    qty:       { label: 'Stock units',   kind: 'int',   names: ['stockquantity', 'quantity', 'qty', 'stock', 'inventoryquantity', 'availablequantity', 'stocklevel', 'inventory'] },
    avail:     { label: 'Availability',  kind: 'text',  names: ['availability', 'instock', 'stockstatus'] },
    colour:    { label: 'Colour',        kind: 'text',  names: ['color', 'colour'] },
    size:      { label: 'Size',          kind: 'text',  names: ['size', 'displaysize'] },
    shipping:  { label: 'Shipping',      kind: 'text',  names: ['shipping', 'shippingprice', 'deliverycost'] },
    promo:     { label: 'Promotion',     kind: 'text',  names: ['promotionid', 'promoid', 'promotion'] },
    group:     { label: 'Variant group', kind: 'text',  names: ['itemgroupid', 'groupid', 'parentid'] },
  };
  var PRICE_SLOTS = ['priceA', 'priceB'];

  // ---------------------------------------------------------------- FACTS
  // A fact is a MESSAGE an overlay can carry. `needs` are slots; `src` says where it comes from so
  // the studio can tell a feed fact from an Ads fact from a master-only fact without guessing.
  var SCARCITY_MAX = 25;    // above this "Only N left" is not scarcity — it is a stock figure (YuMOVE: 5,044)
  var SALE_MIN_PCT = 5;     // under this a "% OFF" flash is noise, and rounds to a number nobody acts on

  var FACTS = {
    sale_pct:  { label: '% off',            src: 'feed',   needs: ['price_was', 'price_now'], ex: '30% OFF',        blurb: 'The discount as a percentage — the single most-used promotional overlay.' },
    sale_amt:  { label: 'Amount off',       src: 'feed',   needs: ['price_was', 'price_now'], ex: '\u00a345 OFF',   blurb: 'The saving in money, which reads stronger than a percentage on a high ticket.' },
    price_now: { label: 'Price',            src: 'feed',   needs: ['price_now'],              ex: '\u00a3105',      blurb: 'The price the shopper pays.' },
    price_was: { label: 'Was price',        src: 'feed',   needs: ['price_was'],              ex: 'was \u00a3150',  blurb: 'The reference price, struck through beside the live one.' },
    units:     { label: 'Units left',       src: 'master', needs: ['qty'],                    ex: 'Only 8 left',    blurb: 'Scarcity. Real in the master feed, not carried into the output feed — see the readiness note.' },
    low_stock: { label: 'Low stock',        src: 'master', needs: ['qty'],                    ex: 'Selling fast',   blurb: 'Scarcity without a number, which survives a stock figure moving between scans.' },
    clicks:    { label: 'Clicks',           src: 'ads',    needs: ['ads_clicks'],             ex: '1,267 clicks',   blurb: 'Google Ads clicks on this product over the window — social proof from spend we already have.' },
    views:     { label: 'Shoppers saw it',  src: 'ads',    needs: ['ads_impr'],              ex: '368k saw this',  blurb: 'Google Ads impressions. The biggest number on the card, and the softest claim.' },
    bought:    { label: 'Bought',           src: 'ads',    needs: ['ads_conv'],              ex: '55 bought',      blurb: 'Google Ads conversions — the strongest proof, and the one that is often too small to print.' },
    free_del:  { label: 'Free delivery',    src: 'feed',   needs: ['free_shipping'],          ex: 'FREE DELIVERY',  blurb: 'Derived from the shipping price being zero.' },
    brand:     { label: 'Brand',            src: 'feed',   needs: ['brand'],                  ex: 'MONSOON',        blurb: 'The brand name, for a frame or a header band.' },
    colour:    { label: 'Colour',           src: 'feed',   needs: ['colour'],                 ex: 'Navy Blue',      blurb: 'A plain attribute, useful on a variant-level card.' },
    promo:     { label: 'Promotion',        src: 'feed',   needs: ['promo'],                  ex: 'SALE',           blurb: 'The feed\'s own promotion id or promo label, so the overlay follows the campaign.' },
    sale_word: { label: 'SALE',             src: 'none',   needs: [],                         ex: 'SALE',           blurb: 'A fixed word. Needs no data, so it fits every product — and says nothing specific.' },
  };
  var FACT_IDS = Object.keys(FACTS);

  // ------------------------------------------------------- the summoner
  // header = the feed's own column names (XML tag names or CSV headings), rows = sampled rows as
  // objects keyed by those same names. Returns, per slot, the column it resolved to, how, how
  // confidently, and the evidence — then, per fact, whether this feed can say it and over how much
  // of the catalogue.
  function summon(header, rows, opts) {
    opts = opts || {};
    header = (header || []).map(s0).filter(Boolean);
    rows = rows || [];
    var byNorm = {};
    header.forEach(function (h) { var k = normKey(h); if (!byNorm[k]) byNorm[k] = h; });

    // fill + parse rate per column, measured not assumed
    var stat = {};
    header.forEach(function (h) {
      var filled = 0, mon = 0, ints = 0, urls = 0, samples = [], sum = 0;
      for (var i = 0; i < rows.length; i++) {
        var v = s0(rows[i] && rows[i][h]).trim();
        if (!v) continue;
        filled++;
        if (samples.length < 4) samples.push(v.slice(0, 60));
        var m = money(v); if (m) { mon++; sum += m.n; }
        if (intOf(v) != null) ints++;
        if (/^https?:\/\//i.test(v)) urls++;
      }
      stat[h] = { n: rows.length, filled: filled, fill: rows.length ? filled / rows.length : 0,
        money: filled ? mon / filled : 0, int: filled ? ints / filled : 0, url: filled ? urls / filled : 0,
        avg: mon ? sum / mon : null, samples: samples };
    });

    var slots = {}, used = {};
    function bind(slot, col, conf, why) {
      slots[slot] = { col: col, conf: conf, why: why, fill: col ? stat[col].fill : 0,
        filled: col ? stat[col].filled : 0, n: rows.length, samples: col ? stat[col].samples : [] };
      if (col) used[col] = slot;
    }
    // 1. name nomination, checked against the column's own values
    Object.keys(SLOTS).forEach(function (slot) {
      if (PRICE_SLOTS.indexOf(slot) >= 0) return;           // the pair is resolved below, by value
      var def = SLOTS[slot], hit = null, how = '';
      for (var i = 0; i < def.names.length && !hit; i++) {
        var want = def.names[i];
        if (byNorm[want]) { hit = byNorm[want]; how = 'exact'; break; }
      }
      if (!hit) {
        // a base match (image1url -> image, additional_image_link_2 -> additionalimagelink)
        for (var j = 0; j < def.names.length && !hit; j++) {
          var wn = def.names[j];
          for (var k = 0; k < header.length; k++) {
            if (nkBase(header[k]) === nkBase(wn) || normKey(header[k]) === nkBase(wn)) { hit = header[k]; how = 'near'; break; }
          }
        }
      }
      if (!hit) { bind(slot, null, 'none', 'no column in this feed is named for it'); return; }
      var st = stat[hit], conf = how === 'exact' ? 'high' : 'medium', why = how === 'exact' ? 'the feed names it ' + hit : 'nearest column ' + hit;
      if (!st.filled) { conf = 'none'; why = hit + ' is in the feed and empty on every row read'; bind(slot, null, conf, why); return; }
      if (def.kind === 'int' && st.int < 0.6) { conf = 'low'; why = hit + ' does not read as a whole number (' + Math.round(st.int * 100) + '% of filled rows do)'; }
      if (def.kind === 'url' && st.url < 0.6) { conf = 'low'; why = hit + ' does not read as a URL'; }
      bind(slot, hit, conf, why);
    });

    // 2. THE PRICE PAIR, BY VALUE. This is the one resolution that cannot be done by name: the
    //    output feeds follow Google's spec (price = reference, sale_price = live) while the masters
    //    do not agree with each other at all, and Schuh's master is the exact reverse of Monsoon's.
    var moneyCols = header.filter(function (h) {
      // a money column: parses as money on most filled rows, and is not an id/qty/weight/ratio
      if (used[h]) return false;
      var nb = normKey(h);
      if (/^(id|gtin|mpn|sku|barcode|quantity|qty|stock|weight|grams|margin|position|percentage|ratio|rate)/.test(nb)) return false;
      return stat[h].filled > 0 && stat[h].money >= 0.8;
    });
    var named = function (h, list) { var nb = normKey(h); return list.some(function (w) { return nb === w; }); };
    // prefer the columns a feed actually names as prices, in the spec's own vocabulary
    var cands = moneyCols.slice().sort(function (a, b) {
      var sa = (named(a, SLOTS.priceA.names) || named(a, SLOTS.priceB.names)) ? 1 : 0;
      var sb = (named(b, SLOTS.priceA.names) || named(b, SLOTS.priceB.names)) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return stat[b].filled - stat[a].filled;
    });
    var pair = pricePair(cands, rows, stat);
    bind('price_now', pair.now, pair.now ? pair.conf : 'none', pair.whyNow);
    bind('price_was', pair.was, pair.was ? pair.conf : 'none', pair.whyWas);
    var cur = pair.cur || '';
    if (!cur && pair.now) { for (var r = 0; r < rows.length && !cur; r++) { var mm = money(rows[r][pair.now]); if (mm && mm.cur) cur = mm.cur; } }

    // 3. derived slots
    var freeN = 0, freeSeen = 0;
    if (slots.shipping && slots.shipping.col) {
      rows.forEach(function (rw) {
        var v = s0(rw[slots.shipping.col]); if (!v) return;
        freeSeen++;
        // g:shipping nests a <g:price>0.00 GBP</g:price>; a CSV column is the number itself
        var m2 = v.match(/(\d[\d.,]*)\s*[A-Z]{0,3}\s*$/) || v.match(/price>\s*([\d.,]+)/i);
        var n2 = m2 ? money(m2[1]) : money(v);
        if (n2 && n2.n === 0) freeN++;
      });
    }
    slots.free_shipping = { col: slots.shipping ? slots.shipping.col : null, conf: freeSeen ? (freeN ? 'high' : 'none') : 'none',
      why: freeSeen ? (freeN ? 'shipping reads 0 on ' + freeN + ' of ' + freeSeen + ' rows read' : 'every shipping price read is above zero') : 'no shipping column in this feed',
      fill: freeSeen ? freeN / freeSeen : 0, filled: freeN, n: rows.length, samples: slots.shipping ? slots.shipping.samples : [] };

    // 4. per-fact readiness. Ads facts are not in the feed at all, so they are reported as the
    //    separate source they are rather than as a missing column.
    var adsOn = !!opts.ads, adsCov = opts.adsCov == null ? null : opts.adsCov, adsWin = opts.adsWindow || '';
    var masterSlots = opts.master || null;   // { qty: {col, fill, …} } when a master read is available
    var facts = {};
    FACT_IDS.forEach(function (f) {
      var def = FACTS[f], need = def.needs, miss = [], cov = 1, why = [];
      if (!need.length) { facts[f] = { id: f, state: 'ready', cov: 1, why: 'needs no data — it fits every product', src: def.src }; return; }
      if (def.src === 'ads') {
        if (!adsOn) { facts[f] = { id: f, state: 'off', cov: 0, src: 'ads', why: 'Google Ads is not read for this feed' + (opts.adsWhy ? ' \u2014 ' + opts.adsWhy : '') }; return; }
        facts[f] = { id: f, state: adsCov === 0 ? 'none' : 'ready', cov: adsCov == null ? null : adsCov, src: 'ads',
          why: adsCov == null ? 'Google Ads is read for this feed' + (adsWin ? ' over ' + adsWin : '') :
            Math.round(adsCov * 100) + '% of the products read carry Ads traffic' + (adsWin ? ' over ' + adsWin : '') };
        return;
      }
      if (def.src === 'master') {
        var mq = masterSlots && masterSlots.qty;
        var inOut = slots.qty && slots.qty.col;
        facts[f] = { id: f, src: 'master',
          state: inOut ? 'ready' : (mq && mq.col ? 'master_only' : 'none'),
          cov: inOut ? slots.qty.fill : (mq ? mq.fill : 0),
          why: inOut ? 'the output feed carries ' + slots.qty.col
            : (mq && mq.col ? 'the master feed carries ' + mq.col + ', the output feed carries no stock column \u2014 a FeedHero rule would have to pass it through before this could ship'
              : 'no stock column in the output feed or the master') };
        return;
      }
      need.forEach(function (sl) {
        var got = slots[sl];
        if (!got || !got.col || got.conf === 'none') { miss.push(sl); why.push((SLOTS[sl] ? SLOTS[sl].label : sl) + ': ' + ((got && got.why) || 'not in this feed')); return; }
        cov = Math.min(cov, got.fill);
      });
      facts[f] = { id: f, src: def.src, state: miss.length ? 'none' : (cov < 0.5 ? 'thin' : 'ready'), cov: miss.length ? 0 : cov,
        why: miss.length ? why.join('; ') : 'reads on ' + Math.round(cov * 100) + '% of the products read' };
    });

    return { slots: slots, facts: facts, cur: cur, rows: rows.length, cols: header.length, pair: pair };
  }

  // Resolve WHICH of two money columns is the reference price, by what they hold.
  function pricePair(cands, rows, stat) {
    if (!cands.length) return { now: null, was: null, conf: 'none', whyNow: 'no column in this feed reads as money', whyWas: 'no column in this feed reads as money', cur: '' };
    if (cands.length === 1) {
      var only = cands[0];
      return { now: only, was: null, conf: 'high', method: 'single',
        whyNow: only + ' is the only money column in this feed', whyWas: 'this feed carries one price only \u2014 nothing to strike through', cur: curOf(rows, only) };
    }
    var a = cands[0], b = cands[1], both = 0, aHigh = 0, bHigh = 0, eq = 0;
    for (var i = 0; i < rows.length; i++) {
      var ma = money(rows[i][a]), mb = money(rows[i][b]);
      if (!ma || !mb) continue;
      both++;
      if (ma.n > mb.n) aHigh++; else if (mb.n > ma.n) bHigh++; else eq++;
    }
    var cur = curOf(rows, a) || curOf(rows, b);
    // a clear majority on a real sample, OR a unanimous reading on a small one — either beats the
    // feed's column order, which is the one thing that carries no information about which is which
    var unanimous = both >= 1 && (aHigh === both || bHigh === both);
    if ((both >= 3 && (aHigh > bHigh * 2 || bHigh > aHigh * 2)) || unanimous) {
      var wasC = aHigh > bHigh ? a : b, nowC = aHigh > bHigh ? b : a, agree = Math.max(aHigh, bHigh);
      var conf = both >= 3 ? 'high' : both >= 2 ? 'medium' : 'low';
      // a reference price on a fraction of the catalogue is the decision-relevant number, so it is
      // stated even when the pair was resolved by value rather than by fill
      var sparse = stat[wasC].filled < stat[wasC].n ? ', filled on ' + stat[wasC].filled + ' of ' + stat[wasC].n + ' rows read \u2014 only those products can carry a discount' : '';
      return { now: nowC, was: wasC, conf: conf, method: 'values', both: both, agree: agree,
        whyNow: nowC + ' is the lower of the two on ' + agree + ' of ' + both + ' row' + (both === 1 ? '' : 's') + ' carrying both \u2014 read as the live price',
        whyWas: wasC + ' is the higher on ' + agree + ' of ' + both + ' row' + (both === 1 ? '' : 's') + ' carrying both \u2014 read as the reference price' + sparse, cur: cur };
    }
    // they rarely co-occur (Monsoon: g:sale_price on a third of rows) — the always-filled one is
    // the live price, and the sparse one is the reference, with its fill rate stated
    var fa = stat[a].filled, fb = stat[b].filled;
    if (fa !== fb) {
      var full = fa > fb ? a : b, sparse = fa > fb ? b : a;
      // Google's spec: when both exist, price is the reference and sale_price is live. A feed where
      // the sparse column is the SALE column therefore has the pair the other way round.
      var sparseIsSale = /sale|now|special|offer|discount/.test(normKey(sparse));
      var nowCol = sparseIsSale ? sparse : full, wasCol = sparseIsSale ? full : sparse;
      return { now: nowCol, was: wasCol, conf: both >= 3 ? 'medium' : 'low', method: 'fill', both: both,
        whyNow: nowCol + ' read as the live price (' + (sparseIsSale ? 'the feed names it a sale price' : 'filled on ' + stat[nowCol].filled + ' of ' + stat[nowCol].n + ' rows') + ')',
        whyWas: wasCol + ' read as the reference price, filled on ' + stat[wasCol].filled + ' of ' + stat[wasCol].n + ' rows read \u2014 only those products can carry a discount',
        cur: cur };
    }
    return { now: a, was: b, conf: 'low', method: 'order', both: both,
      whyNow: a + ' and ' + b + ' could not be told apart by their values \u2014 check this before showing a client',
      whyWas: 'unresolved \u2014 ' + b + ' taken as the reference price on the feed\'s own column order', cur: cur };
  }
  function curOf(rows, col) { for (var i = 0; i < rows.length; i++) { var m = money(rows[i][col]); if (m && m.cur) return m.cur; } return ''; }

  // ------------------------------------------------- resolve one product
  // row = one product keyed by the feed's own column names. ads = { clicks, impr, conv, cost, value,
  // window } for THAT product, or null. master = { qty: n } when the master was read for it.
  function resolveFacts(row, sum, ads, master, opts) {
    opts = opts || {};
    row = row || {}; ads = ads || null; master = master || null;
    var S = sum.slots || {}, cur = opts.cur || sum.cur || '';
    var get = function (slot) { var b = S[slot]; return b && b.col ? s0(row[b.col]).trim() : ''; };
    var now = money(get('price_now')), was = money(get('price_was'));
    if (now && now.cur) cur = now.cur;
    var qty = intOf(get('qty'));
    if (qty == null && master && master.qty != null) qty = intOf(master.qty);
    var out = {};
    var put = function (id, text, raw, why) { out[id] = { id: id, ok: !!text, text: text || '', raw: raw, why: why || '', src: FACTS[id].src }; };

    var pct = was && now ? pctOff(was.n, now.n) : null;
    if (pct == null) put('sale_pct', '', null, !was ? 'no reference price on this product' : !now ? 'no live price on this product' : 'the live price is not below the reference price');
    else if (pct < SALE_MIN_PCT) put('sale_pct', '', pct, pct + '% off is under the ' + SALE_MIN_PCT + '% floor \u2014 too small to put on a picture');
    else put('sale_pct', pct + '% OFF', pct);

    var amt = was && now && was.n > now.n ? Math.round((was.n - now.n) * 100) / 100 : null;
    if (amt == null) put('sale_amt', '', null, out.sale_pct.why || 'no saving on this product');
    else put('sale_amt', fmtMoney(amt, cur) + ' OFF', amt);

    put('price_now', now ? fmtMoney(now.n, cur) : '', now ? now.n : null, now ? '' : 'no live price on this product');
    put('price_was', was ? 'was ' + fmtMoney(was.n, cur) : '', was ? was.n : null, was ? '' : 'no reference price on this product');

    if (qty == null) { put('units', '', null, 'no stock figure for this product'); put('low_stock', '', null, 'no stock figure for this product'); }
    else if (qty <= 0) { put('units', '', qty, 'this product is out of stock'); put('low_stock', '', qty, 'this product is out of stock'); }
    else if (qty > SCARCITY_MAX) { put('units', '', qty, qty + ' in stock is above the ' + SCARCITY_MAX + '-unit scarcity ceiling \u2014 that is a stock figure, not scarcity'); put('low_stock', '', qty, qty + ' in stock is not low'); }
    else { put('units', 'Only ' + qty + ' left', qty); put('low_stock', 'Selling fast', qty); }

    var aw = ads && ads.window ? ' in ' + ads.window : '';
    put('clicks', ads && ads.clicks > 0 ? compact(ads.clicks) + ' click' + (ads.clicks === 1 ? '' : 's') + aw : '', ads ? ads.clicks : null,
      !ads ? 'no Google Ads row for this product' : ads.clicks > 0 ? '' : 'this product had no clicks in the window');
    put('views', ads && ads.impr > 0 ? compact(ads.impr) + ' shoppers saw this' + aw : '', ads ? ads.impr : null,
      !ads ? 'no Google Ads row for this product' : 'this product had no impressions in the window');
    var cv = ads ? Math.round(ads.conv || 0) : null;
    put('bought', cv > 0 ? compact(cv) + ' bought' + aw : '', cv,
      !ads ? 'no Google Ads row for this product' : cv > 0 ? '' : 'fewer than one conversion in the window \u2014 too small to print');

    var shipV = get('free_shipping') || get('shipping');
    var shipM = shipV ? (shipV.match(/price>\s*([\d.,]+)/i) ? money(shipV.match(/price>\s*([\d.,]+)/i)[1]) : money((shipV.match(/(\d[\d.,]*)\s*[A-Z]{0,3}\s*$/) || [])[1] || shipV)) : null;
    put('free_del', shipM && shipM.n === 0 ? 'FREE DELIVERY' : '', shipM ? shipM.n : null,
      !shipV ? 'no shipping price for this product' : 'delivery on this product is ' + (shipM ? fmtMoney(shipM.n, cur) : shipV.slice(0, 24)));

    var br = get('brand'); put('brand', br ? br.toUpperCase().slice(0, 24) : '', br, br ? '' : 'no brand on this product');
    var cl = get('colour'); put('colour', cl ? cl.split(/[\/|,]/)[0].trim().slice(0, 20) : '', cl, cl ? '' : 'no colour on this product');
    var pr = get('promo'); put('promo', pr ? pr.toUpperCase().slice(0, 18) : '', pr, pr ? '' : 'no promotion on this product');
    put('sale_word', 'SALE', 'SALE');
    return out;
  }

  // ---------------------------------------------------------------- DESIGNS
  // Each design is a declarative set of zones. `maps` names the real FeedSpark image-creator script
  // the design corresponds to, so what the studio shows a client is what the engine would be asked
  // to build — see overlay_engine.js, which decodes those same scripts off live feeds.
  //   at:  tl tr bl br t b c            — where on the image
  //   as:  flash ribbon pill bar tag strip burst frame band
  var DESIGNS = [
    { id: 'corner-flash', name: 'Corner flash', family: 'promo', maps: 'image_process_engine',
      blurb: 'A filled corner triangle. The loudest shape at thumbnail size, which is where a Shopping card is read.',
      zones: [{ at: 'tl', as: 'flash', fact: 'sale_pct', size: 'lg', fg: '#FFFFFF', bg: '#ED6F0B' }] },
    { id: 'pill-badge', name: 'Pill badge', family: 'promo', maps: 'image_process_engine',
      blurb: 'A rounded badge clear of the product. Reads as the retailer speaking, not as part of the garment.',
      zones: [{ at: 'tl', as: 'pill', fact: 'sale_pct', size: 'md', fg: '#FFFFFF', bg: '#ED6F0B' }] },
    { id: 'ribbon', name: 'Diagonal ribbon', family: 'promo', maps: 'image_process_engine',
      blurb: 'A banner across the corner. Carries more words than a pill without covering the centre.',
      zones: [{ at: 'tr', as: 'ribbon', fact: 'sale_pct', size: 'md', fg: '#FFFFFF', bg: '#F5A623' }] },
    { id: 'burst', name: 'Starburst', family: 'promo', maps: 'image_process_engine',
      blurb: 'The classic sale burst. Use it where the catalogue photography is plain enough to carry it.',
      zones: [{ at: 'tr', as: 'burst', fact: 'sale_pct', size: 'md', fg: '#FFFFFF', bg: '#D7263D' }] },
    { id: 'price-tag', name: 'Price tag', family: 'price', maps: 'image_process_subscription_v1',
      blurb: 'The shape the subscription overlay already serves on YuMOVE: a tag carrying the live price with the reference struck through.',
      zones: [{ at: 'br', as: 'tag', fact: 'price_now', size: 'lg', fg: '#FFFFFF', bg: '#333333' },
              { at: 'br', as: 'tag', fact: 'price_was', size: 'sm', fg: '#FFFFFF', bg: '#333333', strike: true, row: 1 }] },
    { id: 'price-pair', name: 'Was / now pair', family: 'price', maps: 'image_process_subscription_v1',
      blurb: 'Both prices on a band across the foot of the image, the live one over the reference struck through. The most honest promotional overlay, and the one most likely to survive a price-mismatch check.',
      zones: [{ at: 'b', as: 'bar', fact: 'price_was', size: 'sm', fg: '#FFFFFF', bg: '#333333', strike: true },
              { at: 'b', as: 'bar', fact: 'price_now', size: 'md', fg: '#F5A623', bg: '#333333' }] },
    { id: 'urgency', name: 'Urgency strip', family: 'scarcity', maps: 'image_process_engine',
      blurb: 'A strip under the product carrying scarcity. Needs stock in the output feed — see the readiness panel.',
      zones: [{ at: 'b', as: 'strip', fact: 'units', size: 'md', fg: '#FFFFFF', bg: '#D7263D' }] },
    { id: 'scarcity-pill', name: 'Selling fast', family: 'scarcity', maps: 'image_process_engine',
      blurb: 'Scarcity without a number, so it cannot go stale between scans.',
      zones: [{ at: 'tr', as: 'pill', fact: 'low_stock', size: 'sm', fg: '#FFFFFF', bg: '#D7263D' }] },
    { id: 'social-proof', name: 'Social proof bar', family: 'ads', maps: 'image_process_engine',
      blurb: 'What our own Google Ads spend already knows about this product, said back to the shopper.',
      zones: [{ at: 'b', as: 'bar', fact: 'clicks', size: 'sm', fg: '#FFFFFF', bg: '#2563EB' }] },
    { id: 'proof-stack', name: 'Proof stack', family: 'ads',  maps: 'image_process_engine',
      blurb: 'Two Ads facts stacked. Drops to one, or to nothing, on a product with no traffic.',
      zones: [{ at: 'tl', as: 'pill', fact: 'views', size: 'sm', fg: '#FFFFFF', bg: '#2563EB' },
              { at: 'tl', as: 'pill', fact: 'bought', size: 'sm', fg: '#FFFFFF', bg: '#1E4FB8', row: 1 }] },
    { id: 'frame', name: 'Branded frame', family: 'brand', maps: 'image_process_engine',
      blurb: 'The dynamic overlay engine\'s frame asset: a border with a header band. Dresses a whole feed consistently.',
      zones: [{ at: 'frame', as: 'frame', fg: '#F5A623' },
              { at: 't', as: 'band', fact: 'brand', size: 'md', fg: '#FFFFFF', bg: '#F5A623' },
              { at: 'b', as: 'band', fact: 'sale_pct', size: 'sm', fg: '#333333', bg: '#FFFFFF' }] },
    { id: 'split', name: 'Product \u00d7 lifestyle', family: 'compose', maps: 'image_process_products_lifestyle',
      blurb: 'The two-up composition already live on Monsoon\'s Meta feed: the packshot beside a lifestyle shot, with one message across the join.',
      zones: [{ at: 'split', as: 'split' },
              { at: 'b', as: 'bar', fact: 'sale_pct', size: 'md', fg: '#FFFFFF', bg: '#ED6F0B' }] },
    { id: 'full-house', name: 'Everything on', family: 'stress',  maps: 'image_process_engine',
      blurb: 'Every corner used at once. Not a design to ship \u2014 it is here to show how much a card can carry before it stops reading.',
      zones: [{ at: 'tl', as: 'pill', fact: 'sale_pct', size: 'sm', fg: '#FFFFFF', bg: '#ED6F0B' },
              { at: 'tr', as: 'pill', fact: 'low_stock', size: 'sm', fg: '#FFFFFF', bg: '#D7263D' },
              { at: 'bl', as: 'pill', fact: 'free_del', size: 'sm', fg: '#333333', bg: '#FFFFFF' },
              { at: 'br', as: 'tag', fact: 'price_now', size: 'md', fg: '#FFFFFF', bg: '#333333' },
              { at: 'b', as: 'bar', fact: 'clicks', size: 'sm', fg: '#FFFFFF', bg: '#2563EB' }] },
    { id: 'clean', name: 'No overlay', family: 'control', maps: null,
      blurb: 'The image as the client ships it. The control every design is judged against.', zones: [] },
  ];
  var designById = function (id) { for (var i = 0; i < DESIGNS.length; i++) { if (DESIGNS[i].id === id) return DESIGNS[i]; } return null; };

  // ------------------------------------------------- compose a design
  // A zone whose fact does not resolve is DROPPED and says why. A design is `empty` when it wanted
  // text and got none — a design drawn with its message missing would read as a working overlay.
  function compose(design, resolved, opts) {
    opts = opts || {};
    design = typeof design === 'string' ? designById(design) : design;
    if (!design) return { ok: false, zones: [], dropped: [], why: 'unknown design' };
    var over = opts.text || {};         // per-fact wording override from the composer
    var zones = [], dropped = [], wanted = 0;
    design.zones.forEach(function (z, i) {
      if (!z.fact) { zones.push(Object.assign({}, z, { i: i, text: '' })); return; }
      wanted++;
      var r = resolved[z.fact];
      var txt = over[z.fact] != null ? s0(over[z.fact]) : (r ? r.text : '');
      if (!txt) { dropped.push({ fact: z.fact, label: FACTS[z.fact] ? FACTS[z.fact].label : z.fact, why: (r && r.why) || 'not available on this product' }); return; }
      zones.push(Object.assign({}, z, { i: i, text: txt, fact: z.fact, raw: r ? r.raw : null }));
    });
    var drew = zones.filter(function (z) { return z.text; }).length;
    return { ok: true, id: design.id, name: design.name, family: design.family, maps: design.maps,
      zones: zones, dropped: dropped, wanted: wanted, drew: drew,
      empty: wanted > 0 && drew === 0,
      why: wanted === 0 ? 'this design carries no message' : drew === 0 ? 'nothing this design needs is on this product' : '' };
  }

  // ------------------------------------------------- pure geometry
  // Boxes in IMAGE pixels, so the page paints at any size. Kept pure and tested: an overlay bug is
  // almost always a box off the edge, two boxes on top of each other, or a line too long for its box.
  var PAD = 0.035;            // margin from the edge, as a share of the short side
  var SIZE = { sm: 0.040, md: 0.055, lg: 0.075 };     // cap height as a share of the short side
  // Mean glyph width over cap height, measured against Lato 800 in a browser: "30% OFF" renders
  // 178px where 0.60 predicted 151, and an UNDER-estimate is the costly direction — the painter
  // cuts to the box, so a tight box ellipsises a seven-character message. A generous box only
  // adds a little fill around short text.
  var CHAR_W = 0.72;
  // A message is first set SMALLER to fit its shape and only clipped when even the floor is too
  // wide. An overlay running off the picture is the commonest way one stops reading, and it is
  // exactly what a long Google Ads window ("1,267 clicks in Last 7 Days (30/09/2026 - 06/10/2026)")
  // does to a corner pill.
  var MIN_SHRINK = 0.55;
  function fitText(text, fs0, maxW, extra) {
    var fs = fs0, floor = Math.max(7, Math.round(fs0 * MIN_SHRINK)), padX, tw, bw;
    for (;;) {
      padX = Math.round(fs * 0.55);
      tw = Math.round(String(text).length * CHAR_W * fs);
      bw = tw + padX * 2 + (extra || 0);
      if (bw <= maxW || fs <= floor) break;
      fs = Math.max(floor, Math.round(fs * 0.92));
    }
    return { fs: fs, padX: padX, padY: Math.round(fs * 0.42), tw: tw, bw: Math.min(bw, maxW), fits: bw <= maxW };
  }
  function layout(composed, w, h) {
    w = w || 1000; h = h || 1000;
    var S = Math.min(w, h), pad = Math.round(PAD * S);
    var zs = (composed.zones || []), boxes = [];
    var isBand = function (z) { return z.as === 'bar' || z.as === 'strip' || z.as === 'band'; };

    // PASS 1 — the full-width bands. They own their edge of the image outright, so they are placed
    // first and the corners are then kept out of the strip they take: a bottom bar drawn over a
    // bottom-corner price tag is the single most common way an overlay stops being readable.
    var topH = 0, botH = 0;
    zs.forEach(function (z) {
      if (!z.text || !isBand(z) || (z.at !== 't' && z.at !== 'b')) return;
      var m = fitText(z.text, Math.round(SIZE[z.size || 'md'] * S), w);
      var bh = m.fs + m.padY * 2;
      var y = z.at === 't' ? topH : h - botH - bh;
      if (z.at === 't') topH += bh; else botH += bh;
      boxes.push({ i: z.i, as: z.as, at: z.at, x: 0, y: y, w: w, h: bh, fs: m.fs,
        padX: Math.round(m.fs * 0.7), padY: m.padY, maxW: w - Math.round(m.fs * 1.4),
        text: z.text, fact: z.fact, fg: z.fg, bg: z.bg, strike: !!z.strike,
        band: true, fits: m.fits, row: 0 });
    });
    var top = topH, bot = botH;

    // PASS 2 — everything else, inside what the bands left
    var rows = {};
    zs.forEach(function (z) {
      if (z.as === 'frame') { boxes.push({ i: z.i, as: 'frame', x: 0, y: 0, w: w, h: h, inset: Math.round(0.022 * S), fg: z.fg, text: '' }); return; }
      if (z.as === 'split') { boxes.push({ i: z.i, as: 'split', x: 0, y: 0, w: w, h: h, text: '' }); return; }
      if (!z.text) return;
      if (isBand(z) && (z.at === 't' || z.at === 'b')) return;    // done in pass 1
      // a tag's words start AFTER its hole, so the box has to allow for it or the text runs out
      var fs0 = Math.round(SIZE[z.size || 'md'] * S);
      var extra = z.as === 'tag' ? Math.round(fs0 * 1.1) : 0;
      var m = fitText(z.text, fs0, w - pad * 2, extra);
      var fs = m.fs, padX = m.padX, bh = fs + m.padY * 2;
      var bw = m.tw + padX * 2 + (z.as === 'tag' ? Math.round(fs * 1.1) : 0);
      if (z.as === 'ribbon' || z.as === 'flash' || z.as === 'burst') bw = Math.max(bw, Math.round(0.30 * S));
      bw = Math.min(bw, w - pad * 2);
      var key = z.at, st8 = rows[key] || { k: 0, px: 0 };
      // the stack is the SUM of what is already at this anchor, never this box's own height times
      // the row index — two zones of different sizes (the price tag's big NOW over its small WAS)
      // land on top of each other the moment the index is multiplied by the wrong one
      var k = st8.k, stack = st8.px;
      rows[key] = { k: k + 1, px: stack + bh + Math.round(fs * 0.22) };
      var yTop = top + pad, yBot = h - bot - pad;      // the usable band
      var x, y;
      if (z.at === 'tl') { x = pad; y = yTop + stack; }
      else if (z.at === 'tr') { x = w - pad - bw; y = yTop + stack; }
      else if (z.at === 'bl') { x = pad; y = yBot - bh - stack; }
      else if (z.at === 'br') { x = w - pad - bw; y = yBot - bh - stack; }
      else if (z.at === 't') { x = Math.round((w - bw) / 2); y = yTop + stack; }
      else if (z.at === 'b') { x = Math.round((w - bw) / 2); y = yBot - bh - stack; }
      else { x = Math.round((w - bw) / 2); y = Math.round((h - bh) / 2) + stack; }
      // never off the image, and never into a band: the margin is a preference, these are not
      x = Math.max(0, Math.min(x, w - bw));
      y = Math.max(top, Math.min(y, h - bot - bh));
      boxes.push({ i: z.i, as: z.as, at: z.at, x: x, y: y, w: bw, h: bh, fs: fs, padX: padX, padY: m.padY,
        maxW: bw - padX * 2 - (z.as === 'tag' ? Math.round(fs * 1.1) : 0),
        text: z.text, fact: z.fact, fg: z.fg, bg: z.bg, strike: !!z.strike,
        fits: m.fits && bw >= m.tw + padX * 2 + (z.as === 'tag' ? Math.round(fs * 1.1) : 0), row: k });
    });
    return { w: w, h: h, pad: pad, top: top, bot: bot, boxes: boxes };
  }
  // do any two text boxes overlap? (the harness's real question)
  function overlaps(boxes) {
    var t = (boxes || []).filter(function (b) { return b.text; }), out = [];
    for (var i = 0; i < t.length; i++) for (var j = i + 1; j < t.length; j++) {
      var a = t[i], b = t[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push([a.i, b.i]);
    }
    return out;
  }

  // ------------------------------------------------- the recipe (techy)
  // What FeedSpark's image-creator would be asked for. Params are the REAL ones overlay_engine.js
  // decodes off live feeds — a studio that invented its own vocabulary would not be a brief.
  function recipeFor(composed, opts) {
    opts = opts || {};
    var project = opts.project || (opts.client ? slug(opts.client) + (opts.market ? '-' + String(opts.market).toLowerCase() : '') : 'client-project');
    var script = composed.maps || 'image_process_engine';
    var host = opts.host || 'dashboard.feedspark.com';
    var base = 'https://' + host + '/image-creator/' + project + '/' + script + '.php';
    var P = [], tz = (composed.zones || []).filter(function (z) { return z.text; });
    P.push({ k: 'img_url', v: '{image_link}', note: 'the product image, from the feed' });
    if (script === 'image_process_products_lifestyle') {
      P[0] = { k: 'img_url_left', v: '{image_link}', note: 'the packshot' };
      P.push({ k: 'img_url_right', v: '{additional_image_link}', note: 'the lifestyle shot' });
    }
    if (script === 'image_process_subscription_v1') {
      P.push({ k: 'show_price', v: '1', note: 'draw the price tag' });
      var tag = tz.filter(function (z) { return z.as === 'tag'; })[0] || tz[0];
      if (tag) { P.push({ k: 'tags_bg_color', v: hex(tag.bg), note: 'tag fill' }); P.push({ k: 'tags_font_color', v: hex(tag.fg), note: 'tag text' }); }
      P.push({ k: 'tags_img_type', v: 'round_dpa', note: 'the rounded DPA tag shape' });
    }
    if (composed.id === 'frame') P.push({ k: 'overlay_frame', v: project + '-frame.png', note: 'the frame asset, to be supplied' });
    tz.forEach(function (z, i) {
      var n = tz.length > 1 ? String(i + 1) : '';
      P.push({ k: 'txt' + n, v: tokenFor(z), note: FACTS[z.fact] ? FACTS[z.fact].label + ' \u2014 ' + z.at : z.at });
      P.push({ k: 'txt' + n + '_pos', v: z.at, note: 'placement' });
      if (z.bg) P.push({ k: 'txt' + n + '_bg', v: hex(z.bg), note: 'fill' });
      if (z.fg) P.push({ k: 'txt' + n + '_fg', v: hex(z.fg), note: 'text' });
    });
    P.push({ k: 'ver', v: String(opts.ver || 1), note: 'bump to force a re-render of every image' });
    return { script: script, project: project, base: base, params: P,
      url: base + '?' + P.map(function (p) { return p.k + '=' + encodeURIComponent(p.v); }).join('&'),
      note: 'Field tokens in braces are substituted per product by the image engine. Every value above is a real image-creator parameter \u2014 /overlays decodes these same ones off the feeds already running.' };
  }
  function tokenFor(z) {
    // the overlay text as a template the engine can fill per product, not this one product's words
    var map = { sale_pct: '{discount_pct}% OFF', sale_amt: '{discount_amount} OFF', price_now: '{sale_price}', price_was: 'was {price}',
      units: 'Only {stock_quantity} left', low_stock: 'Selling fast', clicks: '{ads_clicks} clicks', views: '{ads_impressions} shoppers saw this',
      bought: '{ads_conversions} bought', free_del: 'FREE DELIVERY', brand: '{brand}', colour: '{color}', promo: '{promotion_id}', sale_word: 'SALE' };
    return map[z.fact] || z.text;
  }
  var hex = function (c) { return s0(c).replace(/^#/, '').toUpperCase(); };
  var slug = function (s) { return s0(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

  // ------------------------------------------------- the readiness read
  // One sentence per fact for the panel, plus the brief-worthy gaps. This is what turns the studio
  // from a mock-up into something an AM can act on.
  function readiness(sum) {
    var facts = (sum && sum.facts) || {}, ready = [], thin = [], gaps = [];
    FACT_IDS.forEach(function (f) {
      var r = facts[f]; if (!r) return;
      var row = { id: f, label: FACTS[f].label, src: FACTS[f].src, state: r.state, cov: r.cov, why: r.why };
      if (r.state === 'ready') ready.push(row);
      else if (r.state === 'thin') thin.push(row);
      else gaps.push(row);
    });
    var masterOnly = gaps.filter(function (g) { return g.state === 'master_only'; });
    return { ready: ready, thin: thin, gaps: gaps, masterOnly: masterOnly,
      verdict: ready.length + ' of ' + FACT_IDS.length + ' messages this feed can carry'
        + (thin.length ? ', ' + thin.length + ' on a thin share of the catalogue' : '')
        + (masterOnly.length ? ', ' + masterOnly.length + ' needing a field passed through from the master' : '') };
  }
  // which designs this feed can actually draw, and over how much of it
  function designsFor(sum) {
    return DESIGNS.map(function (d) {
      var need = {}, cov = 1, miss = [];
      d.zones.forEach(function (z) { if (z.fact) need[z.fact] = 1; });
      Object.keys(need).forEach(function (f) {
        var r = sum.facts[f];
        if (!r || r.state === 'none' || r.state === 'off') { miss.push(FACTS[f].label); return; }
        if (r.cov != null) cov = Math.min(cov, r.cov);
      });
      var any = Object.keys(need).length;
      return { id: d.id, name: d.name, family: d.family, blurb: d.blurb, maps: d.maps,
        needs: Object.keys(need), missing: miss, cov: any ? cov : 1,
        state: !any ? 'always' : miss.length >= any ? 'no' : miss.length ? 'partial' : (cov < 0.5 ? 'thin' : 'yes') };
    });
  }

  return {
    VERSION: VERSION, SLOTS: SLOTS, FACTS: FACTS, FACT_IDS: FACT_IDS, DESIGNS: DESIGNS,
    SCARCITY_MAX: SCARCITY_MAX, SALE_MIN_PCT: SALE_MIN_PCT, PAD: PAD, SIZE: SIZE,
    normKey: normKey, nkBase: nkBase, fitText: fitText, MIN_SHRINK: MIN_SHRINK, money: money, fmtMoney: fmtMoney, intOf: intOf, compact: compact, pctOff: pctOff,
    summon: summon, pricePair: pricePair, resolveFacts: resolveFacts,
    designById: designById, compose: compose, layout: layout, overlaps: overlaps,
    recipeFor: recipeFor, tokenFor: tokenFor, readiness: readiness, designsFor: designsFor,
  };
}));
