/*
 * FeedSpark hero-size engine — each brand's HERO SIZES, mapped by the brand's own product types and
 * measured against its master feed (Ray, 30 Sep 2026: "bring in hero size mapping per brand as well
 * and later allow cross industry "guildlines" - (this is a document per brand or they can follow
 * examples) - sit within stock management - breakdown by their product type").
 *
 * WHY THE FCC HOLDS THE MAP. FeedHero's rules decide which sizes are hero ("Set Hero size values" on ten
 * Superdry markets, "Set hero sizes" on Accessorize, "Include Hero size low RC" on Monsoon), but the rule
 * report never carries a rule's conditions and no output feed exports the flag. So the list lives where a
 * person can see it: one GUIDE per brand, per product type, taken from the brand's own document or from an
 * example the brand follows (a FeedSpark starting point, or another brand's guide).
 *
 * WHY IT IS MEASURED. A guide is only useful beside the stock it protects. The master-stock agent reads
 * every roster master once a day (tools/master_stock.mjs) and, on the SAME pass as its availability count,
 * builds a SIZE CENSUS: per product type, every size the type is made in with how many rows carry it and
 * how many are in stock, plus each style's size run as a pattern — so the page can say, for ANY hero list
 * a person ticks, what share of hero-size variants is in stock and how many styles have every hero size
 * they carry in stock, without re-reading the feed.
 *
 * One file, three lanes: the agent (require), the /stock page (window.HeroSizes, served verbatim at
 * /stock/engine.js) and tools/test_herosize.mjs. The census takes the Catalogue's engine as an argument
 * (docs/catalog_engine.js — its column plan, candidates and stock reading), so a master row is read the
 * same way on every surface that reads one.
 *
 * NOTHING HERE IS A CLAIM ABOUT A BRAND. The examples are starting points to adapt, labelled as such
 * everywhere they show; a type nobody has mapped reads "not mapped", never a guessed list.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HeroSizes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.0.0';
  // the census SHAPE — the worker's sanitiser (src/herosizes.js CENSUS_V) holds the same number, and the
  // agent re-reads a master whose stored census is of an older shape even when its import has not moved
  var CENSUS_V = 2;   // 2: departments read in every roster market's language (Superdry DE's "Damen" / "Herren")
  var TYPE_CAP = 80;      // product types kept per market (biggest first); the rest are counted, not listed
  var LADDER_CAP = 30;    // sizes kept per type (most-carried first, shown in size order)
  var PAT_CAP = 400;      // style patterns kept per type (most common first); the rest are counted
  var GROUP_CAP = 250000; // styles tracked across a master before patterns stop (counts never stop)

  function s0(v) { return v == null ? '' : String(v); }
  function first(v) { return Array.isArray(v) ? (v.length ? v[0] : '') : v; }
  function squash(s) { return s0(s).replace(/[\s ​]+/g, ' ').trim(); }
  function light(s) {
    return squash(s0(first(s)).replace(/<[^>]*>/g, ' ').replace(/&frac12;|&#189;|&#x0*bd;/gi, '½')
      .replace(/&amp;/gi, '&').replace(/&nbsp;|&#160;/gi, ' ').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"'));
  }

  // ---- SIZES ------------------------------------------------------------------------------------------------
  // sizeKey(raw) -> the size a guide talks about. Light on purpose: the brand's own label survives, only what
  // makes two spellings of ONE size differ goes — a conversion in brackets ("UK 7 (EU 40½)" -> "UK 7"), a fit
  // or leg letter after a number ("14R", "32L" -> "14", "32"), a waist/leg pair ("30/32", "W30 L32" -> "30"),
  // a leading zero ("03" -> "3"), a written-out alpha ("Medium" -> "M", "2XL" -> "XXL") and one-size words.
  var ONE = /^(ONE ?SIZE|1 ?SIZE|ONESIZE|ONE-SIZE|OS|O\/S|NO ?SIZE|NS|N\/A|TU|T\.U\.?|TAILLE UNIQUE|EINHEITSGR(?:Ö|OE)(?:SS|ß)E|EINE GR(?:Ö|OE)(?:SS|ß)E|TALLA [ÚU]NICA|TAGLIA UNICA|ONE SIZE FITS ALL|OSFA|STANDARD|UNI)$/;
  var WORDS = { 'EXTRA SMALL': 'XS', 'X-SMALL': 'XS', 'X SMALL': 'XS', 'XX-SMALL': 'XXS', 'XX SMALL': 'XXS', 'SMALL': 'S', 'MEDIUM': 'M', 'LARGE': 'L',
    'X-LARGE': 'XL', 'X LARGE': 'XL', 'EXTRA LARGE': 'XL', 'XX-LARGE': 'XXL', 'XX LARGE': 'XXL', 'XXX-LARGE': 'XXXL', 'XXX LARGE': 'XXXL' };
  var SYS = ['UK', 'EU', 'US', 'FR', 'IT', 'DE', 'AU', 'JP', 'MX', 'BR', 'CN'];
  function num(t) {
    return s0(t).replace(/\s*½/g, '.5').replace(/(\d),(\d)/g, '$1.$2').replace(/\b0+(\d)/g, '$1')
      .replace(/\s*[-–]\s*/g, '-').replace(/\s*\/\s*/g, '/').replace(/\.0\b/g, '');
  }
  function sizeKey(v) {
    var s = light(v).replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    s = squash(s).toUpperCase();
    if (ONE.test(s)) return 'ONE SIZE';
    s = s.replace(/^(SIZE|GR(?:Ö|OE)(?:SS|ß)E|TAILLE|TALLA|TAGLIA|MAAT|STØRRELSE)\s*[:\-]?\s*/, '').replace(/[.,;:]+$/, '').trim();
    if (!s) return '';
    if (ONE.test(s) || /^([ÚU]NICA|UNIQUE|UNICA)$/.test(s)) return 'ONE SIZE';
    // only what a size is written with survives (the worker refuses anything else), spaced the one way
    s = s.replace(/[^A-Z0-9 .,\/½+&'#-]/g, '').replace(/\s*\/\s*/g, '/').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!s) return '';
    if (ONE.test(s)) return 'ONE SIZE';
    if (WORDS[s]) return WORDS[s];
    var m = /^(\d)\s*X\s*(L|S)$/.exec(s);
    if (m) { var n = +m[1]; return n >= 2 && n <= 3 ? new Array(n + 1).join('X') + m[2] : n + 'X' + m[2]; }
    m = /^(X{4,})(L|S)$/.exec(s); if (m) return m[1].length + 'X' + m[2];
    m = /^(?:AGE\s*)?(\d{1,2})(?:\s*[-–\/]\s*(\d{1,2}))?\s*(Y|YR|YRS|YEAR|YEARS|J|JAHRE|ANS|AÑOS|ANOS|ANNI|ÅR|JR|JAAR)\.?$/.exec(s);
    if (m) return +m[1] + (m[2] ? '-' + +m[2] : '') + ' YRS';
    m = /^AGE\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/.exec(s);
    if (m) return +m[1] + (m[2] ? '-' + +m[2] : '') + ' YRS';
    m = /^(\d{1,2})(?:\s*[-–\/]\s*(\d{1,2}))?\s*(M|MTH|MTHS|MONTH|MONTHS|MOIS|MONATE|MESES|MESI|MDR|MND)\.?$/.exec(s);
    if (m) return +m[1] + (m[2] ? '-' + +m[2] : '') + ' MTHS';
    m = /^W\s*(\d{2})(?:\s*\/?\s*L\s*\d{2})?$/.exec(s); if (m) return m[1];
    m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(s); if (m && +m[1] >= 24 && +m[1] <= 44 && +m[2] >= 26 && +m[2] <= 38) return m[1];   // waist/leg
    m = /^(\d{1,3}(?:[.,]\d)?|\d{1,3}\s*½)\s*(R|L|S|T|P|REG|REGULAR|LONG|SHORT|TALL|PETITE)$/.exec(s); if (m) s = m[1];
    if (/^1[3-8]5$/.test(s)) return s.slice(0, 2) + '.5';   // a shirt collar written without its point ("155" = 15½)
    m = new RegExp('^(' + SYS.join('|') + ')\\s*(\\d.*)$').exec(s);
    if (m) return m[1] + ' ' + num(m[2]);
    if (/^\d/.test(s)) return num(s);
    return s;
  }
  // where a size sits on a run: months, years, alpha, numbers (per sizing system), one size, anything else
  function alphaRank(t) {
    if (t === 'S') return 0; if (t === 'M') return 1; if (t === 'L') return 2;
    var m = /^(X*)(S|L)$/.exec(t); if (m) return m[2] === 'L' ? 2 + m[1].length : -m[1].length;
    m = /^(\d)X(S|L)$/.exec(t); if (m) return m[2] === 'L' ? 2 + +m[1] : -+m[1];
    return null;
  }
  function sizeRank(k) {
    var s = s0(k), m;
    if (s === 'ONE SIZE') return [6, 0, 0, s];
    if ((m = /^(\d+)(?:-\d+)? MTHS$/.exec(s))) return [1, 0, +m[1], s];
    if ((m = /^(\d+)(?:-\d+)? YRS$/.exec(s))) return [2, 0, +m[1], s];
    var a = alphaRank(s); if (a != null) return [3, 0, a, s];
    var p = s.split(/[\/-]/);
    if (p.length === 2) { var a1 = alphaRank(p[0]), a2 = alphaRank(p[1]); if (a1 != null && a2 != null) return [3, 0, a1 + 0.5, s]; }
    if ((m = new RegExp('^(?:(' + SYS.join('|') + ') )?(\\d+(?:\\.\\d+)?)').exec(s))) return [4, m[1] ? SYS.indexOf(m[1]) + 1 : 0, +m[2], s];
    return [7, 0, 0, s];
  }
  function cmpSize(a, b) {
    var x = sizeRank(a), y = sizeRank(b);
    for (var i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0;
  }
  function sortSizes(list) { return (list || []).slice().sort(cmpSize); }
  // which kind of size it is — the card keeps each kind on its own line (Ray, 30 Sep 2026: "numeric and alphabet
  // sizes stay on separate rows"): alpha (XS … XXL, S/M), numeric (6 … 20, 24 … 40, UK 5, EU 38), ages, one size, other
  function sizeClass(k) {
    var r = sizeRank(k)[0];
    return r === 1 || r === 2 ? 'age' : r === 3 ? 'alpha' : r === 4 ? 'num' : r === 6 ? 'one' : 'other';
  }
  // the number a size carries once its system is set aside — how an example's bare "10" meets a ladder's "UK 10"
  function sizeCore(k) { return s0(k).replace(new RegExp('^(' + SYS.join('|') + ') '), ''); }

  // ---- DEPARTMENT + PRODUCT TYPE -------------------------------------------------------------------------------
  // who a type is for — read from the brand's own words first (its path), then the gender / age columns.
  // Kids before women before men: "Girls" is a kids' department, and "women" contains "men".
  // In every language the roster ships (Superdry's gender column says "Damen" / "Herren" in DE, "Femme" / "Homme" in FR,
  // "Naiset" / "Miehet" in FI …): a word the census cannot place still separates the types (see typeLabel), it just
  // cannot pick an example's department row.
  var DEPT_RE = [
    ['kids', /\b(kids?|kidswear|child(?:ren)?'?s?|childrenswear|girls?|girlswear|boys?|boyswear|junior|juniors|baby|babies|babywear|toddlers?|infants?|kinder|kinderen|enfants?|fille|filles|gar[çc]ons?|m[äa]dchen|jungen|meisjes|jongens|ni[ñn][oa]s|beb[ée]s?|bambin[io]|ragazz[io]|b[øo]rn|barn|pige|drenge|flickor|pojkar|jenter|gutter|lapset|tyt[öo]t|pojat|dzieci|dziewcz[ęe]ta|ch[łl]opcy|crian[çc]as|youth|teens?|newborn|children)\b/i],
    ['women', /\b(wom[ae]n'?s?|womenswear|ladies|lady|female|damen|dames|femmes?|mujer(?:es)?|donna|donne|kvinder|kvinner|kvinnor|dam|dame|naiset|naisten|kobiety|damskie|damska|damski|tjejer|mulher(?:es)?)\b/i],
    ['men', /\b(m[ae]n'?s?|menswear|male|herren|heren|hommes?|hombres?|uomo|uomini|herre|herr|m[æa]nd|menn|m[äa]n|miehet|miesten|m[ęe][żz]czy[źz]ni|m[ęe]skie|m[ęe]ska|m[ęe]ski|killar|hom[ae]ns?)\b/i],
    ['unisex', /\b(unisex)\b/i]
  ];
  var DEPT_LABEL = { kids: 'Kids', women: 'Women', men: 'Men', unisex: 'Unisex' };
  function deptOf(text) {
    var s = s0(text);
    for (var i = 0; i < DEPT_RE.length; i++) if (DEPT_RE[i][1].test(s)) return DEPT_RE[i][0];
    return '';
  }
  function deptFromCols(gender, age) {
    var a = light(age).toLowerCase(), g = light(gender).toLowerCase().replace(/[^a-z]/g, '');
    var kid = /^(kids?|child|children|toddler|infant|newborn|baby|youth|junior|teen)/.test(a.replace(/[^a-z]/g, '')) || deptOf(a) === 'kids';
    var d = /^(f|female|women|womens|woman|ladies|lady|w)$/.test(g) ? 'women' : /^(m|male|men|mens|man)$/.test(g) ? 'men'
      : /^(u|unisex|both|all)$/.test(g) ? 'unisex' : /^(girl|girls|boy|boys|kids|kid|children|child)$/.test(g) ? 'kids' : deptOf(light(gender));
    if (kid) return 'kids';
    return d;
  }
  // the gender column's own word, when it is a word (not an id, not a placeholder) — the prefix a type takes in the
  // brand's language when the census cannot place it in English
  function genderWord(gender) {
    var w = light(gender);
    if (!w || w.length > 20 || /\d/.test(w) || /^(n\/?a|none|null|unknown|other|all|any|default|-)$/i.test(w)) return '';
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  var GENERIC = /^(clothing|apparel|footwear|accessories|bekleidung|kleidung|v[êe]tements|kleding|ropa|abbigliamento|t[øo]j|kl[äa]der)$/i;
  var NOT_A_TYPE = /^(view all|all|all products|shop all|new in|new|sale|clearance|outlet|campaign\s*\d*|featured|gifts?|default|none|null|n\/a|-|alles anzeigen|neuheiten|kampagne\s*\d*|voir tout|nouveaut[ée]s|campagne\s*\d*|soldes|ver todo|novedades|campa[ñn]a\s*\d*|rebajas|vedi tutto|novit[àa]|campagna\s*\d*|saldi|alle bekijken|alles bekijken|nieuw|vis alle|visa alla|nyheder|nyheter|kampanj[ea]?\s*\d*|udsalg|rea|n[äa]yt[äa] kaikki|uutuudet|ale|zobacz wszystko|poka[żz] wszystko|nowo[śs]ci|kampania\s*\d*|wyprzeda[żz]|ver tudo|campanha\s*\d*|promo[çc][õo]es)$/i;
  function pathOf(v) { return light(v).split(/\s*(?:>|›|»|\|)\s*/).map(squash).filter(Boolean); }
  // a candidate is not a product type when it is only a number (a category id), only a department word
  // ("Womens" on Superdry's category column) or a merchandising bucket ("View All", "Campaign 3")
  function usableType(v) {
    var p = pathOf(v); if (!p.length) return false;
    var s = p.join(' > ');
    if (/^\d+$/.test(s.replace(/\s*>\s*/g, ''))) return false;
    if (p.length === 1 && (NOT_A_TYPE.test(s) || (deptOf(s) && s.replace(DEPT_RE[0][1], '').replace(DEPT_RE[1][1], '').replace(DEPT_RE[2][1], '').replace(DEPT_RE[3][1], '').replace(/[^a-z]/gi, '') === ''))) return false;
    return true;
  }
  // the product type a guide is written against: the brand's own path to two levels (a generic middle level
  // such as "Clothing" is stepped over), prefixed with the department from the gender / age columns only when
  // the path names none — Superdry's "T-Shirts" + gender "mens" -> "Men > T-Shirts"; Reiss's path already says it
  function typeLabel(pt, gender, age) {
    var p = pathOf(pt);
    if (p.length > 2 && GENERIC.test(p[1])) p = [p[0]].concat(p.slice(2));
    p = p.slice(0, 2);
    // English words keep the English label (GB's "mens" → "Men"); any other word keeps the brand's own ("Damen", "Homme")
    var own = deptOf(p.join(' ')), col = deptFromCols(gender, age), word = genderWord(gender);
    var english = /^(f|female|women|womens|woman|ladies|lady|w|m|male|men|mens|man|u|unisex|both|girl|girls|boy|boys|kids|kid|children|child)$/i.test(light(gender).replace(/[^a-z]/gi, ''));
    // a child's age group wins over the gender word (a girls' dress is not a women's dress)
    var kidAge = deptFromCols('', age) === 'kids';
    var pre = own ? '' : kidAge ? DEPT_LABEL.kids : col && (english || !word) ? DEPT_LABEL[col] : word || '';
    if (!p.length) return pre ? pre + ' > (no product type)' : '(no product type)';
    return ((pre ? pre + ' > ' : '') + p.join(' > ')).slice(0, 160);
  }
  function typeKey(label) { return squash(label).toLowerCase(); }
  function leafOf(label) { var p = pathOf(label); return p.length ? p[p.length - 1].toLowerCase() : ''; }

  // FOOTWEAR is read from the type's words, else from its run: a run of half sizes (UK 4.5, 5.5 …) is a shoe run —
  // Schuh's categories never say "shoes", and a shoe type must never take a dress size from an example
  var FOOT = 'shoe|shoes|trainer|trainers|sneaker|sneakers|boot|boots|sandal|sandals|heel|heels|heeled|flat|flats|loafer|loafers|slipper|slippers|pump|pumps|ballerina|ballerinas|footwear|flip flop|flip flops|espadrille|espadrilles|mule|mules|clog|clogs|schuh|schuhe|stiefel|chaussures?|zapat[oa]s?|scarpe|sko|schoenen|brogue|brogues|derby|oxford|oxfords|wellies|wellington';
  var FOOT_RE = new RegExp('\\b(' + FOOT + ')\\b', 'i');
  function isFootwear(label, lad) {
    if (FOOT_RE.test(s0(label))) return true;
    var halves = 0, small = 0;
    (lad || []).forEach(function (z) { var m = /^(?:UK |EU |US )?(\d{1,2})(\.5)?$/.exec(s0(z)); if (m && +m[1] <= 15) { small++; if (m[2]) halves++; } });
    return halves >= 3 && halves / Math.max(1, small) >= 0.2;
  }

  // ---- THE CENSUS — one pass over a master ------------------------------------------------------------------------
  // census(E).onRow(row, header?) — E is the Catalogue engine (FeedCatalog); the first call is the header (the XML
  // parser's shape; wrap delimParser, whose second argument is a row index). finish() -> the stored shape:
  //   {v, rows, sized, one, nos, groups, cols:{pt,size,gender,age,grp,av,qty},
  //    types:[{k, d, n, in, out, one, nos, st, sz:[[size, rows, in, out]], more, pat:[[pattern, styles]], patx}],
  //    tx:{n, k}}
  // A pattern is one character per ladder size: 0 not made in it · 1 out of stock · 2 in stock · 3 stock not stated.
  // A size a style carries twice (two colours under one group) is in stock when ANY of its rows is.
  function census(E) {
    var hdr = null, pl = null, qi = -1, cols = {};
    var T = new Map(), rows = 0, sized = 0, ones = 0, nos = 0, groups = 0, grpAll = new Set(), capped = false;
    function head(h) {
      hdr = h.slice(); pl = E.plan(hdr); qi = E.qtyCol(hdr);
      var at = function (k) { var l = pl.attr[k] || []; return l.length ? s0(hdr[l[0]]).slice(0, 60) : ''; };
      cols = { pt: at('product_type'), size: at('size'), gender: at('gender'), age: at('age_group'), grp: at('item_group_id'), av: at('availability'), qty: qi >= 0 ? s0(hdr[qi]).slice(0, 60) : '' };
    }
    function val(k, row) { var c = E.cands(k, row, pl); return c.length ? light(first(c[0].v)) : ''; }
    function ptOf(row) {
      var c = E.cands('product_type', row, pl);
      for (var i = 0; i < c.length; i++) { var v = first(c[i].v); if (usableType(v)) return v; }
      return '';
    }
    function onRow(row, h) {
      if (!hdr) { head(Array.isArray(h) ? h : row); return; }
      if (Array.isArray(h) && h.length !== hdr.length) head(h);
      if (!row || !row.some(function (x) { return s0(x).trim() !== ''; })) return;
      rows++;
      var label = typeLabel(ptOf(row), val('gender', row), val('age_group', row));
      var t = T.get(label);
      if (!t) { t = { k: label, n: 0, in: 0, out: 0, one: 0, nos: 0, sz: new Map(), g: new Map(), d: '' }; T.set(label, t); }
      t.n++;
      var ac = E.cands('availability', row, pl);
      var st = E.stockOf(ac.length ? first(ac[0].v) : '', qi >= 0 ? row[qi] : null);
      if (st === 'in') t.in++; else if (st === 'out') t.out++;
      var sk = sizeKey(val('size', row));
      if (!sk) { t.nos++; nos++; return; }
      if (sk === 'ONE SIZE') { t.one++; ones++; return; }
      sized++;
      var c = t.sz.get(sk); if (!c) t.sz.set(sk, c = [0, 0, 0]);
      c[0]++; if (st === 'in') c[1]++; else if (st === 'out') c[2]++;
      if (capped) return;
      var gid = val('item_group_id', row);
      if (!gid) return;
      var gk = gid.toLowerCase();
      var gm = t.g.get(gk);
      if (!gm) {
        if (!grpAll.has(gk)) { grpAll.add(gk); groups++; if (groups > GROUP_CAP) { capped = true; return; } }
        t.g.set(gk, gm = {});
      }
      var ch = st === 'in' ? 2 : st === 'out' ? 1 : 3, was = gm[sk] || 0;
      // in stock wins over out, and a reading (in or out) wins over no reading
      if (!was || ch === 2 || (was === 3 && ch === 1)) gm[sk] = ch;
    }
    function finish() {
      var list = Array.from(T.values()).sort(function (a, b) { return b.n - a.n || (a.k < b.k ? -1 : 1); });
      var kept = list.slice(0, TYPE_CAP), rest = list.slice(TYPE_CAP);
      var out = kept.map(function (t) {
        var all = Array.from(t.sz.entries()).sort(function (a, b) { return b[1][0] - a[1][0] || cmpSize(a[0], b[0]); });
        var lad = all.slice(0, LADDER_CAP).map(function (e) { return e[0]; }).sort(cmpSize);
        var at = {}; lad.forEach(function (s, i) { at[s] = i; });
        var pats = new Map(), st = 0;
        t.g.forEach(function (gm) {
          var p = new Array(lad.length + 1).join('0').split(''), any = false;
          Object.keys(gm).forEach(function (s) { if (at[s] != null) { p[at[s]] = String(gm[s]); any = true; } });
          if (!any) return;
          st++;
          var k = p.join(''); pats.set(k, (pats.get(k) || 0) + 1);
        });
        var pl2 = Array.from(pats.entries()).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
        var keep = pl2.slice(0, PAT_CAP), patx = 0;
        pl2.slice(PAT_CAP).forEach(function (e) { patx += e[1]; });
        // who it is for: the brand's words, else a run that is mostly ages (Monsoon names no gender)
        var d = deptOf(t.k), kidRows = 0, sizedRows = 0;
        lad.forEach(function (s) { var c = t.sz.get(s)[0]; sizedRows += c; if (/ (YRS|MTHS)$/.test(s)) kidRows += c; });
        if (!d && sizedRows && kidRows / sizedRows >= 0.6) d = 'kids';
        var o = { k: t.k, d: d, n: t.n, in: t.in, out: t.out, one: t.one, nos: t.nos, st: st,
          sz: lad.map(function (s) { var c = t.sz.get(s); return [s, c[0], c[1], c[2]]; }),
          more: Math.max(0, all.length - lad.length), pat: keep, patx: patx };
        if (isFootwear(t.k, lad)) o.fw = 1;
        return o;
      });
      var tx = { n: 0, k: rest.length };
      rest.forEach(function (t) { tx.n += t.n; });
      return { v: CENSUS_V, rows: rows, sized: sized, one: ones, nos: nos, groups: Math.min(groups, GROUP_CAP), capped: capped, cols: cols, types: out, tx: tx };
    }
    return { onRow: onRow, finish: finish };
  }

  // ---- THE MEASURE — a hero list against one type of the census ----------------------------------------------------
  // rows / in / out = the hero-size VARIANTS; styles = those carrying at least one hero size, split by whether every
  // hero size they carry is in stock (full), some are (some), none are (none) or the stock is not stated (unk).
  // A style never made in a hero size is a range decision, not a stock gap — it is not counted against the style.
  function measure(t, hero) {
    var want = {}; (hero || []).forEach(function (s) { want[sizeKey(s) || s] = 1; });
    var idx = []; ((t && t.sz) || []).forEach(function (z, i) { if (want[z[0]]) idx.push(i); });
    var o = { hero: idx.map(function (i) { return t.sz[i][0]; }), rows: 0, in: 0, out: 0, st: 0, full: 0, some: 0, none: 0, unk: 0, untracked: (t && t.patx) || 0, pats: !!(t && t.pat && t.pat.length) };
    idx.forEach(function (i) { o.rows += t.sz[i][1]; o.in += t.sz[i][2]; o.out += t.sz[i][3]; });
    ((t && t.pat) || []).forEach(function (p) {
      var car = 0, inn = 0, un = 0;
      idx.forEach(function (i) { var ch = p[0].charAt(i); if (ch && ch !== '0') { car++; if (ch === '2') inn++; else if (ch === '3') un++; } });
      if (!car) return;
      o.st += p[1];
      if (inn === car) o.full += p[1]; else if (inn) o.some += p[1]; else if (un) o.unk += p[1]; else o.none += p[1];
    });
    return o;
  }
  // the core of a type's run — the sizes the most styles are made in: a size carried by at least `share` (80%) of
  // as many styles as the most-carried size (rows, when the master names no style). Relative, because a type that
  // mixes alpha and numeric styles (Reiss's tops) has no size ANY 80% of its styles share. Offered as a suggestion
  // a person applies, or as the "Core of each run" example a brand chooses to follow — never assumed.
  function core(t, share) {
    share = share == null ? 0.8 : share;
    if (!t || !t.sz || !t.sz.length) return [];
    var car = t.sz.map(function (z) { return z[1]; });
    if (t.pat && t.pat.length) {
      car = t.sz.map(function () { return 0; });
      t.pat.forEach(function (p) { for (var i = 0; i < t.sz.length; i++) if (p[0].charAt(i) !== '0') car[i] += p[1]; });
    }
    var top = Math.max.apply(null, car);
    return top > 0 ? t.sz.filter(function (z, i) { return car[i] / top >= share; }).map(function (z) { return z[0]; }) : [];
  }

  // ---- CROSS-INDUSTRY EXAMPLES — starting points a brand can follow until its own document says otherwise ----------
  // Each row: who it is for (d — kids / women / men / * for a type whose department is not known), whether it is for
  // footwear (fw — a shoe type only ever takes a footwear row, and a clothing type never does), optional words the
  // type must carry (w — denim, toddler …) and the sizes it names across the sizing systems a brand may use. A type
  // takes the FIRST row that fits AND names at least one size the type is made in; only those sizes count. A type
  // whose department is unknown only takes a * row. Labelled as examples on every surface: they are where FeedSpark
  // starts a conversation with a brand, not a standard anyone published.
  var DENIM = 'jean|jeans|denim';
  var TODDLER = 'toddler|toddlers|infant|infants|baby|babies|babywear|first walkers?|pre ?walkers?|newborn';
  var JUNIOR = 'junior|juniors|older|big kids?';
  var YOUTH = 'youth|teen|teens|senior';
  var EXAMPLES = [
    { id: 'fs-fashion-uk', name: 'Fashion · UK & IE sizing', ind: 'Fashion', note: 'A FeedSpark starting point for UK sizing: the middle of each run. Adapt it to the brand’s own sell-through.',
      rows: [
        { d: 'kids', fw: 1, w: TODDLER, s: ['UK 5', 'UK 6', 'UK 7', 'UK 8', '5', '6', '7', '8'] },
        { d: 'kids', fw: 1, s: ['UK 11', 'UK 12', 'UK 13', 'UK 1', 'UK 2', '11', '12', '13', '1', '2'] },
        { d: 'kids', s: ['4-5 YRS', '5-6 YRS', '6-7 YRS', '7-8 YRS', '8-9 YRS', '4 YRS', '5 YRS', '6 YRS', '7 YRS', '8 YRS', '9 YRS'] },
        { d: 'women', fw: 1, s: ['UK 4', 'UK 5', 'UK 6', '4', '5', '6'] },
        { d: 'men', fw: 1, s: ['UK 8', 'UK 9', 'UK 10', '8', '9', '10'] },
        { d: '*', fw: 1, s: ['UK 5', 'UK 6', 'UK 7', '5', '6', '7'] },
        { d: 'women', w: DENIM, s: ['26', '27', '28', '29', '10', '12'] },
        { d: 'men', w: DENIM, s: ['30', '32', '34'] },
        { d: 'women', s: ['10', '12', '14', 'S', 'M', 'L', '10-12', 'S/M', 'M/L'] },
        { d: 'men', s: ['M', 'L', 'XL', '38', '40', '42', '15.5', '16', 'M/L'] },
        { d: '*', s: ['M', 'L', '10', '12'] }
      ] },
    { id: 'fs-fashion-eu', name: 'Fashion · EU sizing', ind: 'Fashion', note: 'The same starting point in EU sizes, for the continental markets. Adapt it to the brand’s own sell-through.',
      rows: [
        { d: 'kids', fw: 1, w: TODDLER, s: ['EU 21', 'EU 22', 'EU 23', 'EU 24', 'EU 25', '21', '22', '23', '24', '25'] },
        { d: 'kids', fw: 1, s: ['EU 29', 'EU 30', 'EU 31', 'EU 33', 'EU 34', '29', '30', '31', '33', '34'] },
        { d: 'kids', s: ['110', '116', '122', '128', '4-5 YRS', '5-6 YRS', '6-7 YRS', '7-8 YRS', '4 YRS', '5 YRS', '6 YRS', '7 YRS', '8 YRS'] },
        { d: 'women', fw: 1, s: ['EU 37', 'EU 38', 'EU 39', '37', '38', '39'] },
        { d: 'men', fw: 1, s: ['EU 42', 'EU 43', 'EU 44', '42', '43', '44'] },
        { d: '*', fw: 1, s: ['EU 38', 'EU 39', 'EU 40', '38', '39', '40'] },
        { d: 'women', w: DENIM, s: ['26', '27', '28', '29'] },
        { d: 'men', w: DENIM, s: ['30', '32', '34'] },
        { d: 'women', s: ['38', '40', '42', 'S', 'M', 'L'] },
        { d: 'men', s: ['M', 'L', 'XL', '48', '50', '52'] },
        { d: '*', s: ['M', 'L', '38', '40'] }
      ] },
    { id: 'fs-footwear', name: 'Footwear', ind: 'Footwear', note: 'A FeedSpark starting point for a footwear retailer: the central UK and EU sizes for each department.',
      rows: [
        { d: 'kids', fw: 1, w: TODDLER, s: ['UK 5', 'UK 6', 'UK 7', 'UK 8', 'EU 22', 'EU 23', 'EU 24', 'EU 25'] },
        { d: 'kids', fw: 1, w: YOUTH, s: ['UK 3', 'UK 4', 'UK 5', 'EU 36', 'EU 37', 'EU 38'] },
        { d: 'kids', fw: 1, w: JUNIOR, s: ['UK 12', 'UK 13', 'UK 1', 'UK 2', 'EU 31', 'EU 32', 'EU 33', 'EU 34'] },
        { d: 'kids', fw: 1, s: ['UK 11', 'UK 12', 'UK 13', 'UK 1', 'UK 2', 'EU 29', 'EU 30', 'EU 31', 'EU 33', 'EU 34'] },
        { d: 'women', fw: 1, s: ['UK 4', 'UK 5', 'UK 6', 'EU 37', 'EU 38', 'EU 39', '4', '5', '6'] },
        { d: 'men', fw: 1, s: ['UK 8', 'UK 9', 'UK 10', 'EU 42', 'EU 43', 'EU 44', '8', '9', '10'] },
        { d: '*', fw: 1, s: ['UK 6', 'UK 7', 'UK 8', 'EU 39', 'EU 40', 'EU 41', '6', '7', '8'] }
      ] },
    { id: 'fs-core', name: 'Core of each run', ind: 'Any', rule: 'core', note: 'Read from the brand’s own master: the sizes nearly as many of a product type’s styles are made in as its most-made size. Useful where no document exists yet — it measures the range, not what sells.' }
  ];
  // a row's words, compiled once; a fragment that does not compile fits nothing (a saved example is shared data)
  var WRE = {};
  function wordsFit(label, w) {
    if (!w) return true;
    if (!(w in WRE)) { try { WRE[w] = new RegExp('\\b(' + w + ')\\b', 'i'); } catch (e) { WRE[w] = null; } }
    return !!WRE[w] && WRE[w].test(s0(label).slice(0, 160));
  }
  // does an example row fit a type? department (a type of unknown department takes * rows only), footwear, words
  function rowFits(r, t) {
    var d = t.d || deptOf(t.k), fw = !!t.fw;
    if (!!r.fw !== fw) return false;
    if (d) { if (r.d && r.d !== '*' && r.d !== d) return false; }
    else if (r.d && r.d !== '*') return false;
    return wordsFit(t.k, r.w);
  }
  // one example applied to one census type -> the sizes (in ladder order) or [] when no row fits. A bare size in an
  // example ("10") meets a ladder's "UK 10" — the row already decided the kind of run it is talking about.
  function fromExample(ex, t) {
    if (!ex || !t || !t.sz) return { s: [], row: -1 };
    if (ex.rule === 'core') return { s: core(t), row: -1 };
    var lad = t.sz.map(function (z) { return z[0]; });
    var rows = ex.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!rowFits(r, t)) continue;
      var want = {};
      (r.s || []).forEach(function (x) { want[x] = 1; });
      var hit = lad.filter(function (z) { return want[z] || (want[sizeCore(z)] && sizeCore(z) !== z); });
      if (hit.length) return { s: hit, row: i };
    }
    return { s: [], row: -1 };
  }

  // ---- THE GUIDE STORE — one shared map, a key per decision so two people editing different types never collide --
  //   'g:<Brand>'          the brand's guide: {doc:{name,url}, ex, from, note, by, at}
  //   'm:<Brand>|<type>'   one product type's hero list: {k (label as written), s:[sizes], src:'set'|'doc'|'core'|'ex', by, at}
  //   'x:<id>'             an example a person saved from a brand's guide: {name, ind, note, rows, by, at}
  function guideOf(store, brand) { return (store && store['g:' + brand]) || null; }
  function entriesOf(store, brand) {
    var out = {}, pre = 'm:' + brand + '|';
    Object.keys(store || {}).forEach(function (k) { if (k.indexOf(pre) === 0 && store[k]) out[k.slice(pre.length)] = store[k]; });
    return out;
  }
  function examplesOf(store) {
    var list = EXAMPLES.slice();
    Object.keys(store || {}).forEach(function (k) {
      var x = store[k];
      if (k.indexOf('x:') === 0 && x && x.name) list.push({ id: k.slice(2), name: x.name, ind: x.ind || 'Brand guide', note: x.note || '', rows: x.rows || [], saved: true, by: x.by, at: x.at });
    });
    return list;
  }
  function exampleById(store, id) { return examplesOf(store).filter(function (x) { return x.id === id; })[0] || null; }
  // a stored entry for this type: the exact type, else the same leaf in the same department (a document's
  // "Dresses" row meeting the census's "Women > Dresses"), else the leaf alone when only one entry has it
  function entryFor(map, t) {
    if (!map || !t) return null;
    var k = typeKey(t.k); if (map[k]) return { key: k, e: map[k], how: 'exact' };
    var leaf = leafOf(t.k), d = t.d || deptOf(t.k), same = [], any = [];
    Object.keys(map).forEach(function (key) {
      var e = map[key]; if (!e) return;
      var lab = e.k || key;
      if (leafOf(lab) !== leaf) return;
      any.push(key);
      var ed = deptOf(lab);
      if (!ed || !d || ed === d) same.push(key);
    });
    if (same.length === 1) return { key: same[0], e: map[same[0]], how: 'leaf' };
    if (!same.length && any.length === 1) return { key: any[0], e: map[any[0]], how: 'leaf' };
    return null;
  }
  // THE RESOLUTION, strongest first: the brand's own entry (set by hand, or imported from its document), then the
  // brand it follows, then the example it follows. Nothing fits = not mapped, with no sizes — never a guess.
  function heroFor(store, brand, t) {
    var lad = {}; ((t && t.sz) || []).forEach(function (z) { lad[z[0]] = 1; });
    var own = entryFor(entriesOf(store, brand), t);
    if (own) return { s: (own.e.s || []).filter(function (x) { return lad[x]; }), all: own.e.s || [], src: own.e.src || 'set', by: own.e.by || '', at: own.e.at || 0, key: own.key, how: own.how, own: true };
    var g = guideOf(store, brand) || {};
    if (g.from && g.from !== brand) {
      var o = entryFor(entriesOf(store, g.from), t);
      if (o) return { s: (o.e.s || []).filter(function (x) { return lad[x]; }), all: o.e.s || [], src: 'brand', from: g.from, how: o.how };
    }
    if (g.ex) {
      var ex = exampleById(store, g.ex);
      if (ex) { var r = fromExample(ex, t); if (r.s.length) return { s: r.s, all: r.s, src: 'ex', ex: ex.id, exName: ex.name, row: r.row }; }
    }
    return { s: [], all: [], src: '' };
  }
  // the whole card for one market: every type with its hero list, its measure and where the list came from
  function map(store, brand, cen) {
    var types = ((cen && cen.types) || []).map(function (t) {
      var h = heroFor(store, brand, t);
      return { t: t, h: h, m: measure(t, h.s) };
    });
    var sum = { types: types.length, sized: 0, mapped: 0, mappedRows: 0, sizedRows: 0, rows: 0, in: 0, st: 0, full: 0, bySrc: {} };
    types.forEach(function (x) {
      var sizedRows = x.t.sz.reduce(function (a, z) { return a + z[1]; }, 0);
      if (!sizedRows) return;
      sum.sized++; sum.sizedRows += sizedRows;
      // a type counts as mapped once a list reaches it — including a person's decision that it has NO hero sizes
      if (!x.h.s.length && !x.h.own) return;
      sum.mapped++; sum.mappedRows += sizedRows;
      sum.bySrc[x.h.src] = (sum.bySrc[x.h.src] || 0) + 1;
      if (!x.h.s.length) return;
      sum.rows += x.m.rows; sum.in += x.m.in; sum.st += x.m.st; sum.full += x.m.full;
    });
    return { types: types, sum: sum };
  }

  // ---- A BRAND'S DOCUMENT — a sheet of product types and their hero sizes -------------------------------------------
  // Two layouts, found by the header: a "Hero sizes" column (sizes split on , ; | or new lines), or a type column
  // followed by one size per cell. The first row naming a type-like column is the header; rows above it are a title.
  function splitSizes(v) { return light(v).split(/\s*[,;|\n]\s*|\s{2,}/).map(sizeKey).filter(function (s) { return s && s !== 'ONE SIZE'; }); }
  function parseDoc(rows) {
    rows = (rows || []).filter(function (r) { return Array.isArray(r) && r.some(function (c) { return s0(c).trim() !== ''; }); });
    var hi = -1, ti = -1, si = -1;
    for (var i = 0; i < Math.min(rows.length, 12) && hi < 0; i++) {
      rows[i].forEach(function (c, j) {
        var h = s0(c).toLowerCase().replace(/[^a-z]/g, '');
        if (ti < 0 && /^(producttype|product|type|category|categorypath|department|productcategory|range|family)$/.test(h)) ti = j;
        if (si < 0 && /hero|keysize|coresize|sizes?$/.test(h) && !/^(producttype|product|type|category)$/.test(h)) si = j;
      });
      if (ti >= 0) hi = i; else si = -1;
    }
    if (hi < 0) { hi = -1; ti = 0; si = -1; }
    var out = [], seen = {};
    rows.slice(hi + 1).forEach(function (r) {
      var k = squash(light(r[ti]));
      if (!k || !usableType(k)) return;
      var sizes = si >= 0 && si !== ti ? splitSizes(r[si]) : r.slice(ti + 1).map(sizeKey).filter(function (s) { return s && s !== 'ONE SIZE'; });
      var uniq = []; sizes.forEach(function (s) { if (uniq.indexOf(s) < 0) uniq.push(s); });
      var key = typeKey(k);
      if (seen[key] != null) { out[seen[key]].s = sortSizes(out[seen[key]].s.concat(uniq.filter(function (s) { return out[seen[key]].s.indexOf(s) < 0; }))); return; }
      seen[key] = out.length;
      out.push({ k: k, s: sortSizes(uniq) });
    });
    return { rows: out, layout: si >= 0 && si !== ti ? 'column' : 'cells', header: hi };
  }
  // the brand's map as a sheet (the export is also the template a brand fills in)
  function docRows(store, brand, cen) {
    var head = ['Product type', 'Hero sizes', 'Source', 'Sizes made in'];
    var body = ((cen && cen.types) || []).filter(function (t) { return t.sz.length; }).map(function (t) {
      var h = heroFor(store, brand, t);
      return [t.k, h.s.join(', '), srcWord(h), t.sz.map(function (z) { return z[0]; }).join(', ')];
    });
    return [head].concat(body);
  }
  function srcWord(h) {
    if (!h || !h.src) return 'Not mapped';
    return h.src === 'doc' ? 'Brand document' : h.src === 'set' ? 'Set by hand' : h.src === 'core' ? 'Core of the run'
      : h.src === 'brand' ? 'Follows ' + h.from : h.src === 'ex' ? 'Example: ' + (h.exName || h.ex) : h.src;
  }
  // a type's leaf as the words an example row asks for: each word with an optional plural and ANY separator between
  // ("T-Shirts" = "T Shirt"), and an "and" that may also be written "&" or left out ("Hoodies and Sweatshirts" =
  // "Hoodies & Sweatshirts"). Kept inside what the worker lets through (letters, digits, spaces, ?, |, \W+ and at
  // most a dozen ?) — a long leaf keeps its plural marks on the last word only.
  function leafWords(leaf) {
    var w = s0(leaf).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    if (!w.length) return '';
    var alts = [w], bare = w.filter(function (x) { return x !== 'and'; });
    if (bare.length && bare.length < w.length) alts.push(bare);
    var marks = alts.reduce(function (a, x) { return a + x.length; }, 0), each = marks <= 12;
    return alts.map(function (ws) {
      return ws.map(function (x, i) { var stem = x === 'and' ? 'and' : x.replace(/s$/, ''); return stem + (each || i === ws.length - 1 ? 's?' : (x === stem ? '' : 's')); }).join('\\W+');
    }).join('|');
  }
  // a brand's own entries turned into an example other brands can follow (rows keyed by department + the type's leaf)
  function exampleFromBrand(store, brand, name) {
    var map2 = entriesOf(store, brand), rows = [];
    Object.keys(map2).forEach(function (k) {
      var e = map2[k]; if (!e || !e.s || !e.s.length) return;
      var lab = e.k || k, d = deptOf(lab) || '*', leaf = leafOf(lab);
      rows.push({ d: d, fw: e.fw ? 1 : 0, w: leafWords(leaf) || null, s: e.s.slice() });
    });
    // most specific first: a row with words before a department-only row
    rows.sort(function (a, b) { return (b.w ? 1 : 0) - (a.w ? 1 : 0); });
    return { name: name || brand + ' guide', ind: 'Brand guide', note: 'Saved from ' + brand + '’s own hero-size guide.', rows: rows.slice(0, 200) };
  }

  return {
    VERSION: VERSION, CENSUS_V: CENSUS_V, TYPE_CAP: TYPE_CAP, LADDER_CAP: LADDER_CAP, PAT_CAP: PAT_CAP,
    sizeKey: sizeKey, sizeRank: sizeRank, cmpSize: cmpSize, sortSizes: sortSizes, sizeCore: sizeCore, sizeClass: sizeClass,
    deptOf: deptOf, deptFromCols: deptFromCols, genderWord: genderWord, usableType: usableType, typeLabel: typeLabel, typeKey: typeKey, leafOf: leafOf,
    census: census, measure: measure, core: core,
    EXAMPLES: EXAMPLES, fromExample: fromExample, examplesOf: examplesOf, exampleById: exampleById, exampleFromBrand: exampleFromBrand,
    guideOf: guideOf, entriesOf: entriesOf, entryFor: entryFor, heroFor: heroFor, map: map,
    parseDoc: parseDoc, docRows: docRows, srcWord: srcWord, leafWords: leafWords
  };
});
