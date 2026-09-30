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
  var CENSUS_V = 3;   // 3: types placed on the Google Shopping feed's own product_type tree, kept at their finest level
                      //    (2: departments read in every roster market's language — Superdry DE's "Damen" / "Herren")
  var TYPE_CAP = 600;     // product types kept per market at their finest level; past it the smallest fold into their parent
  var LADDER_CAP = 30;    // sizes kept per type (most-carried first, shown in size order)
  var PAT_CAP = 400;      // style patterns kept per type (most common first); the rest are counted
  var GROUP_CAP = 250000; // styles tracked across a master before patterns stop (counts never stop)
  var JOIN_SAMPLE = 4000; // master rows read before the column carrying the feed's ids is chosen (as the Catalogue does)
  var LEARN_SHARE = 0.8;  // a master type places the products the feed never sends where 80%+ of its sent products sit
  var LEARN_MIN = 5;      // … and only on the strength of at least five of them
  var MASTER_ONLY = 'Master only';   // the root a master type is filed under when the feed has no department word for it

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
  // one type name as a comparable word: letters and digits, each word without its plural s ("Maxi Dresses" = "maxi dresse")
  function wordKey(w) { return s0(w).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim().split(' ').map(function (x) { return x.replace(/s$/, ''); }).join(' '); }
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

  // ---- THE FEED'S PRODUCT-TYPE TREE — what "tier 2, tier 3 of PT" means (Ray, 30 Sep 2026: "can you allow tier 2, tier 3
  // of PT to be chosen too ? sometimes no need too much granulartiy") ---------------------------------------------------
  // A master names its types its own way — Superdry's by a category for most rows and by a leaf type for the rest, Monsoon's
  // by a flat word, Reiss's and Schuh's to two levels — so the master alone has no tier 2 or tier 3 to offer. The tree the
  // FCC calls PT is the one the Google Shopping feed sends: g:product_type slot 1, the path Product Type Guard reads
  // ("Women > Clothing > Jumpers > V-neck Jumper"). treeIndex(E).onRow(row, header?) reads that OUTPUT feed with the
  // Catalogue's own outPlan/outRow; finish() -> {n, typed, paths, o, i, g}: each product's path by its original id (o),
  // by its g:id (i) and, by majority, by its item group (g). Paths only — never a title, a price or a stock word.
  function treeUsable(v) { var p = pathOf(v); return p.length > 0 && !/^\d+$/.test(p.join('')); }
  function treeIndex(E) {
    var hdr = null, pl = null, plN = 0, n = 0, typed = 0, o = new Map(), i = new Map(), gv = new Map(), own = new Map();
    function onRow(row, h) {
      if (!hdr) { hdr = (h || row).slice(); pl = E.outPlan(hdr); plN = hdr.length; return; }
      if (h && h.length !== plN) { pl = E.outPlan(h); plN = h.length; }
      var p = E.outRow(pl, row); if (!p.id) return;
      n++;
      var raw = p.f.product_type; if (!treeUsable(raw)) return;
      var path = pathOf(raw).join(' > ').slice(0, 300);
      var s = own.get(path); if (s == null) { own.set(path, path); s = path; }   // one string per path, however many products
      typed++;
      var a = E.idKey(p.oid), c = E.idKey(p.id), g = E.idKey(p.f.item_group_id);
      if (a && !o.has(a)) o.set(a, s);
      if (c && !i.has(c)) i.set(c, s);
      if (g) { var m = gv.get(g); if (!m) gv.set(g, m = new Map()); m.set(s, (m.get(s) || 0) + 1); }
    }
    function finish() {
      var g = new Map();
      gv.forEach(function (m, k) { var best = '', bn = 0; m.forEach(function (c, p) { if (c > bn) { bn = c; best = p; } }); g.set(k, best); });
      return { n: n, typed: typed, paths: own.size, o: o, i: i, g: g };
    }
    return { onRow: onRow, finish: finish };
  }
  // the deepest level of a master type's feed paths that 80%+ of them share — where the products of that type the feed
  // never sends are placed. Nothing deeper is claimed than the products that ARE sent agree on.
  function commonPath(m) {
    if (!m) return '';
    var tot = 0; m.forEach(function (c) { tot += c; });
    if (tot < LEARN_MIN) return '';
    var best = '';
    for (var L = 1; L <= 12; L++) {
      var c = new Map(), any = false;
      m.forEach(function (n, p) { var parts = pathOf(p); if (parts.length < L) return; any = true; var k = parts.slice(0, L).join(' > '); c.set(k, (c.get(k) || 0) + n); });
      if (!any) break;
      var top = null; c.forEach(function (n, k) { if (!top || n > top[1]) top = [k, n]; });
      if (top[1] / tot < LEARN_SHARE) break;
      best = top[0];
    }
    return best;
  }

  // ---- THE CENSUS — one pass over a master ------------------------------------------------------------------------
  // census(E, tree?).onRow(row, header?) — E is the Catalogue engine (FeedCatalog); the first call is the header (the XML
  // parser's shape; wrap delimParser, whose second argument is a row index). finish() -> the stored shape:
  //   {v, rows, sized, one, nos, groups, cols:{pt,size,gender,age,grp,av,qty}, src:'feed'|'master', tree:{…}|null,
  //    types:[{k, t, d, n, in, out, one, nos, st, sz:[[size, rows, in, out]], more, pat:[[pattern, styles]], patx, m?}],
  //    tx:{n, k}}
  // A pattern is one character per ladder size: 0 not made in it · 1 out of stock · 2 in stock · 3 stock not stated.
  // A size a style carries twice (two colours under one group) is in stock when ANY of its rows is.
  // WITH A TREE (the market's Google Shopping feed, treeIndex above) every row is placed on the FEED's product_type path:
  // by its product id (the column carrying the feed's ids, found on the first 4,000 rows as the Catalogue finds it), else
  // by its style, else — a product the feed never sends, the very styles a hero-size gap hides in — where 80%+ of its
  // master type's sent products sit (commonPath), else under its master type, marked m (the master's own word, not the
  // feed's). Types are kept at their FINEST level (k = the whole path, t = its depth); every coarser tier is a roll-up of
  // them (tierTypes), so a coarse tier is complete. Without a tree the types are the master's own (typeLabel), src 'master'.
  function census(E, tree) {
    var hdr = null, pl = null, qi = -1, cols = {};
    var T = new Map(), rows = 0, sized = 0, ones = 0, nos = 0, groups = 0, grpAll = new Set(), capped = false;
    var useTree = !!(tree && tree.typed && tree.o && tree.i && tree.g), sample = useTree ? [] : null;
    var join = -1, jmap = null, jon = '', joinH = '', via = { id: 0, grp: 0, learn: 0, word: 0, own: 0 }, learn = new Map(), prov = new Map();
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
    function bucket(key) {
      var t = T.get(key);
      if (!t) { t = { k: key, n: 0, in: 0, out: 0, one: 0, nos: 0, sz: new Map(), g: new Map(), d: '' }; T.set(key, t); }
      return t;
    }
    // what the master says a row is, as keys to learn the feed's tree by: EVERY product-type column it fills (Superdry's
    // category AND its type AND its category id), each with the row's department and whether its run is a child's — so a
    // row filed under a sub-brand category ("Bench") is still placed by its type ("Puffer Jacket")
    // (and, for a row the feed never sends, the last word of each reading with its department — for wordPlace)
    function learnKeys(row, sk, label, words) {
      var c = E.cands('product_type', row, pl), out = [], g = val('gender', row), a = val('age_group', row);
      var dc = deptFromCols(g, a) || genderWord(g).toLowerCase(), kid = / (YRS|MTHS)$/.test(sk) ? '|kid' : '';
      for (var i = 0; i < c.length; i++) {
        var v = first(c[i].v); if (!usableType(v)) continue;
        var pp = pathOf(v), k = (deptOf(v) || dc) + '|' + typeKey(pp.join(' > ')) + kid;
        if (out.indexOf(k) < 0) { out.push(k); if (words) words.push({ d: deptOf(v) || dc || (kid ? 'kids' : ''), w: wordKey(pp[pp.length - 1]) }); }
      }
      if (!out.length) out.push((deptOf(label) || dc) + '|' + typeKey(label) + kid);
      return out;
    }
    // where a row sits: the feed's path, or (not placed yet) its master reading, waiting for finish() to place it
    function place(row, sk) {
      var label = typeLabel(ptOf(row), val('gender', row), val('age_group', row));
      if (!useTree) return label;
      var path = '', how = '';
      if (join >= 0) { var k = E.idKey(row[join]); if (k) { path = jmap.get(k) || ''; if (path) how = 'id'; } }
      if (!path) { var g = E.idKey(val('item_group_id', row)); if (g) { path = tree.g.get(g) || ''; if (path) how = 'grp'; } }
      var words = path ? null : [], keys = learnKeys(row, sk, label, words);
      if (!path) {
        // rows with the same master reading wait together
        var pk = '\u0001' + keys.join('\u0002');
        if (!prov.has(pk)) prov.set(pk, { keys: keys, words: words, label: label, kid: / (YRS|MTHS)$/.test(sk) });
        return pk;
      }
      via[how]++;
      keys.forEach(function (lk) { var m = learn.get(lk); if (!m) learn.set(lk, m = new Map()); m.set(path, (m.get(path) || 0) + 1); });
      return path;
    }
    function decide() {
      var s = sample; sample = null;
      var jA = E.detectJoin(pl, s, new Set(tree.o.keys())), jB = E.detectJoin(pl, s, new Set(tree.i.keys()));
      var useB = jB.hit > jA.hit * 1.2, j = useB ? jB : jA;
      if (j.col >= 0) { join = j.col; joinH = j.h; jmap = useB ? tree.i : tree.o; jon = useB ? 'g:id' : 'fs_data_original_id'; }
      s.forEach(take);
    }
    function onRow(row, h) {
      if (!hdr) { head(Array.isArray(h) ? h : row); return; }
      if (Array.isArray(h) && h.length !== hdr.length) head(h);
      if (!row || !row.some(function (x) { return s0(x).trim() !== ''; })) return;
      if (sample) { sample.push(row); if (sample.length >= JOIN_SAMPLE) decide(); return; }
      take(row);
    }
    function take(row) {
      rows++;
      var sk = sizeKey(val('size', row));
      var t = bucket(place(row, sk));
      t.n++;
      var ac = E.cands('availability', row, pl);
      var st = E.stockOf(ac.length ? first(ac[0].v) : '', qi >= 0 ? row[qi] : null);
      if (st === 'in') t.in++; else if (st === 'out') t.out++;
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
      gm[sk] = better(gm[sk] || 0, st === 'in' ? 2 : st === 'out' ? 1 : 3);
    }
    // in stock wins over out, and a reading (in or out) wins over no reading
    function better(was, ch) { return !was || ch === 2 || (was === 3 && ch === 1) ? ch : was; }
    // one type's products into another (placing a master type, folding a small type into its parent)
    function mergeInto(key, t) {
      var d = T.get(key);
      if (!d) { t.k = key; T.set(key, t); return; }
      d.n += t.n; d.in += t.in; d.out += t.out; d.one += t.one; d.nos += t.nos;
      t.sz.forEach(function (c, s) { var e = d.sz.get(s); if (!e) d.sz.set(s, c.slice()); else { e[0] += c[0]; e[1] += c[1]; e[2] += c[2]; } });
      t.g.forEach(function (gm, gk) {
        var e = d.g.get(gk);
        if (!e) d.g.set(gk, gm);
        else Object.keys(gm).forEach(function (s) { e[s] = better(e[s] || 0, gm[s]); });
      });
    }
    function finish() {
      if (sample && hdr) decide();
      var placed = via.id + via.grp, feedPre = {};
      if (useTree) {
        // every level of every path the feed itself gave — a type anywhere on it is the feed's, not the master's
        T.forEach(function (t, key) {
          if (key.charAt(0) === '\u0001') return;
          var p = pathOf(key); for (var L = 1; L <= p.length; L++) feedPre[p.slice(0, L).join(' > ')] = 1;
        });
        // the feed's own top-level word for each department ("Women", "Womens", "Womenswear", "Damen")
        var roots = {};
        T.forEach(function (t, key) {
          if (key.charAt(0) === '\u0001') return;
          var r = pathOf(key)[0], d = deptOf(r); if (!d) return;
          roots[d] = roots[d] || {}; roots[d][r] = (roots[d][r] || 0) + t.n;
        });
        // every level of the feed's tree by its own word: 'maxi dresse' -> ["Womens > Clothing > Dresses > Maxi Dresses"], and
        // how much of each level's own run is ages — so a word both a children's and a women's branch use ("Maxi Dresses"
        // on Monsoon, whose master names no gender) goes to the one whose sent products are sized like this row
        var byWord = new Map(), ages = new Map();
        Object.keys(feedPre).forEach(function (pth) {
          var w = wordKey(pathOf(pth).slice(-1)[0]), l = byWord.get(w); if (!l) byWord.set(w, l = []); l.push(pth);
        });
        T.forEach(function (t, key) {
          if (key.charAt(0) === '\u0001') return;
          var a = 0, n = 0; t.sz.forEach(function (c, sz) { n += c[0]; if (/ (YRS|MTHS)$/.test(sz)) a += c[0]; });
          var p = pathOf(key);
          for (var L = 1; L <= p.length; L++) { var k = p.slice(0, L).join(' > '), e = ages.get(k); if (!e) ages.set(k, e = [0, 0]); e[0] += n; e[1] += a; }
        });
        var wordPlace = function (ws, kid) {
          for (var i = 0; i < (ws || []).length; i++) {
            var l = (byWord.get(ws[i].w) || []).filter(function (pth) { return !ws[i].d || deptOf(pth) === ws[i].d; });
            if (l.length > 1) l = l.filter(function (pth) { var e = ages.get(pth); if (!e || !e[0]) return false; var sh = e[1] / e[0]; return kid ? sh >= 0.6 : sh < 0.4; });
            if (l.length === 1) return l[0];
          }
          return '';
        };
        var rootOf = function (d) { var m = roots[d]; if (!m) return ''; var best = '', bn = -1; Object.keys(m).forEach(function (r) { if (m[r] > bn) { bn = m[r]; best = r; } }); return best; };
        Array.from(T.keys()).forEach(function (key) {
          if (key.charAt(0) !== '\u0001') return;
          var t = T.get(key), pv = prov.get(key); T.delete(key);
          // the deepest place any of the row's master readings agrees on (80%+ of its sent products), the surer on a tie
          var cp = '', cd = 0;
          if (placed) pv.keys.forEach(function (lk) { var c = commonPath(learn.get(lk)), n = pathOf(c).length; if (n > cd) { cp = c; cd = n; } });
          if (cp) { via.learn += t.n; mergeInto(cp, t); return; }
          // no sent product to learn from: the master's own word, where the feed's tree has exactly one type of that name
          // (in the row's department) — Monsoon's "Maxi Dresses" is the feed's "Womens > … > Maxi Dresses"
          var wp = placed ? wordPlace(pv.words, pv.kid) : '';
          if (wp) { via.word += t.n; mergeInto(wp, t); return; }
          // the master's own type, under the feed's word for its department — else under "Master only", so the tiers keep
          // to the feed's own roots and a type the feed never sends is never mistaken for one of them
          var lab = pv.label, p = pathOf(lab), d = deptOf(lab) || (pv.kid ? 'kids' : ''), r = placed && d ? rootOf(d) : '';
          if (r && p.length && deptOf(p[0]) === d) p[0] = r; else if (r) p.unshift(r); else if (placed) p.unshift(MASTER_ONLY);
          via.own += t.n;
          mergeInto((p.join(' > ') || lab).slice(0, 300), t);
        });
      }
      // too many types: the smallest finest ones fold into their parent (their products stay counted at every coarser tier)
      var list = Array.from(T.values());
      while (list.length > TYPE_CAP) {
        var small = null;
        for (var i = 0; i < list.length; i++) if (pathOf(list[i].k).length > 1 && (!small || list[i].n < small.n)) small = list[i];
        if (!small) break;
        T.delete(small.k); mergeInto(pathOf(small.k).slice(0, -1).join(' > '), small);
        list = Array.from(T.values());
      }
      list.sort(function (a, b) { return b.n - a.n || (a.k < b.k ? -1 : 1); });
      var kept = list.slice(0, TYPE_CAP), rest = list.slice(TYPE_CAP);
      var src = useTree && placed ? 'feed' : 'master';
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
        var o = { k: t.k, t: pathOf(t.k).length || 1, d: deptByRun(t.k, lad, function (s) { return t.sz.get(s)[0]; }), n: t.n, in: t.in, out: t.out, one: t.one, nos: t.nos, st: st,
          sz: lad.map(function (s) { var c = t.sz.get(s); return [s, c[0], c[1], c[2]]; }),
          more: Math.max(0, all.length - lad.length), pat: keep, patx: patx };
        if (isFootwear(t.k, lad)) o.fw = 1;
        if (src === 'feed' && !feedPre[t.k]) o.m = 1;
        return o;
      });
      var tx = { n: 0, k: rest.length };
      rest.forEach(function (t) { tx.n += t.n; });
      return { v: CENSUS_V, rows: rows, sized: sized, one: ones, nos: nos, groups: Math.min(groups, GROUP_CAP), capped: capped, cols: cols, src: src,
        tree: useTree ? { feed: tree.n, typed: tree.typed, id: via.id, grp: via.grp, learn: via.learn, word: via.word, own: via.own, join: joinH.slice(0, 60), on: jon } : null,
        types: out, tx: tx };
    }
    return { onRow: onRow, finish: finish };
  }
  // who a type is for: the brand's words, else a run that is mostly ages (Monsoon names no gender)
  function deptByRun(k, lad, rowsOf) {
    var d = deptOf(k), kidRows = 0, sizedRows = 0;
    if (d) return d;
    lad.forEach(function (s) { var c = rowsOf(s); sizedRows += c; if (/ (YRS|MTHS)$/.test(s)) kidRows += c; });
    return sizedRows && kidRows / sizedRows >= 0.6 ? 'kids' : '';
  }

  // ---- TIERS — the census's types at any level of their path -------------------------------------------------------
  // A type at tier L is its path cut to L levels; a path shorter than L is its own type at every tier past its depth.
  // Stored types under one tier-L path are rolled up: counts added, their runs laid on one ladder (the most-carried sizes,
  // in size order) and each style's pattern re-read onto it — so tier 2 is its tier-3 types added together, exactly.
  function depthOf(k) { return pathOf(k).length; }
  function tierKey(k, L) { return pathOf(k).slice(0, Math.max(1, L)).join(' > '); }
  function tiers(cen) {
    var types = (cen && cen.types) || [], max = 0, out = [], all = 0;
    types.forEach(function (t) { max = Math.max(max, depthOf(t.k)); all += t.n; });
    for (var L = 1; L <= max; L++) {
      var keys = {}, sized = {}, big = {}, deep = 0;
      types.forEach(function (t) {
        var k = tierKey(t.k, L), r = t.sz.reduce(function (a, z) { return a + z[1]; }, 0);
        keys[k] = 1; if (r) { sized[k] = (sized[k] || 0) + r; }
        if (depthOf(k) === L) big[k] = (big[k] || 0) + t.n;
        if (depthOf(t.k) >= L) deep += t.n;
      });
      var ex = Object.keys(big).sort(function (a, b) { return big[b] - big[a]; })[0] || '';
      out.push({ t: L, types: Object.keys(keys).length, sized: Object.keys(sized).length, ex: ex, sizes: sized, deep: deep });
    }
    // a tier is offered when at least 1% of the products reach it — a level a handful of products are filed at is the tier
    // above it again, as far as a hero list is concerned (they roll up into it). Tiers stay numbered as the tree numbers
    // them, so "tier 3" on the card is the third level of the feed's product_type, whatever it holds.
    return out.filter(function (x, i) { return !i || x.deep >= all * 0.01; })
      .map(function (x) { return { t: x.t, types: x.types, sized: x.sized, ex: x.ex, top: top90(x.sizes) }; });
  }
  // how many types hold 90% of the sized products at a tier — the count a person has to look at to cover the range
  function top90(m) {
    var v = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b - a; }), tot = 0, acc = 0, n = 0;
    v.forEach(function (c) { tot += c; });
    for (var i = 0; i < v.length && acc < tot * 0.9; i++) { acc += v[i]; n++; }
    return n;
  }
  // the tier the card opens on before anyone picks one: the finest at which 90% of the sized products sit in at most 40
  // types — a garment category on every fashion roster brand (Superdry GB and Reiss tier 3, Schuh and Superdry DE tier 2)
  function defaultTier(cen) {
    var ts = tiers(cen), pick = ts.length ? ts[0].t : 1;
    ts.forEach(function (x) { if (x.top <= 40) pick = x.t; });
    return pick;
  }
  function tierTypes(cen, L) {
    var types = (cen && cen.types) || [], groups = new Map();
    types.forEach(function (t, i) { var k = tierKey(t.k, L); var g = groups.get(k); if (!g) groups.set(k, g = []); g.push(i); });
    var out = [];
    groups.forEach(function (ix, k) {
      var ts = ix.map(function (i) { return types[i]; });
      out.push(ts.length === 1 && ts[0].k === k ? Object.assign({}, ts[0], { t: depthOf(k), nodes: ix }) : rollUp(k, ts, ix));
    });
    return out.sort(function (a, b) { return b.n - a.n || (a.k < b.k ? -1 : 1); });
  }
  function rollUp(k, ts, ix) {
    var sz = new Map(), o = { k: k, t: depthOf(k), n: 0, in: 0, out: 0, one: 0, nos: 0, st: 0, more: 0, patx: 0, nodes: ix };
    ts.forEach(function (t) {
      o.n += t.n; o.in += t.in; o.out += t.out; o.one += t.one; o.nos += t.nos; o.more += t.more || 0; o.patx += t.patx || 0;
      (t.sz || []).forEach(function (z) { var e = sz.get(z[0]); if (!e) sz.set(z[0], e = [0, 0, 0]); e[0] += z[1]; e[1] += z[2]; e[2] += z[3]; });
    });
    var all = Array.from(sz.entries()).sort(function (a, b) { return b[1][0] - a[1][0] || cmpSize(a[0], b[0]); });
    var lad = all.slice(0, LADDER_CAP).map(function (e) { return e[0]; }).sort(cmpSize);
    o.more += Math.max(0, all.length - lad.length);
    var at = {}; lad.forEach(function (s, i) { at[s] = i; });
    o.sz = lad.map(function (s) { var c = sz.get(s); return [s, c[0], c[1], c[2]]; });
    var pats = new Map();
    ts.forEach(function (t) {
      var to = (t.sz || []).map(function (z) { return at[z[0]] != null ? at[z[0]] : -1; });
      (t.pat || []).forEach(function (p) {
        var q = new Array(lad.length + 1).join('0').split(''), any = false;
        for (var j = 0; j < to.length; j++) { var ch = p[0].charAt(j); if (ch && ch !== '0' && to[j] >= 0) { q[to[j]] = ch; any = true; } }
        if (!any) { o.patx += p[1]; return; }
        var s = q.join(''); pats.set(s, (pats.get(s) || 0) + p[1]);
      });
    });
    o.pat = Array.from(pats.entries()).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); });
    o.pat.forEach(function (p) { o.st += p[1]; });
    var ds = {}; ts.forEach(function (t) { ds[t.d || ''] = 1; });
    var one = Object.keys(ds).length === 1 ? Object.keys(ds)[0] : '';
    o.d = deptOf(k) || one || deptByRun(k, lad, function (s) { return sz.get(s)[0]; });
    if (isFootwear(k, lad) || ts.every(function (t) { return t.fw; })) o.fw = 1;
    if (ts.every(function (t) { return t.m; })) o.m = 1;
    return o;
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
  // every path of the census at every tier. An entry keyed on one of them is placed EXACTLY — a list set at tier 3 is never
  // leaf-matched onto another branch's type of the same name. Any other entry (a document's "Dresses", a list saved against
  // the master's own words before the tree) still meets a type by its leaf, as entryFor always has.
  function treeKeys(cen) {
    var s = {};
    ((cen && cen.types) || []).forEach(function (t) { var p = pathOf(t.k); for (var L = 1; L <= p.length; L++) s[typeKey(p.slice(0, L).join(' > '))] = 1; });
    return s;
  }
  // what the resolution needs, read once per card: each brand's entries split into placed and loose, the guide, the example
  function ctxOf(store, brand, cen) {
    var tk = treeKeys(cen);
    function split(b) {
      var all = entriesOf(store, b), loose = {};
      Object.keys(all).forEach(function (k) { if (!tk[k]) loose[k] = all[k]; });
      return { all: all, loose: loose };
    }
    var g = guideOf(store, brand) || {};
    return { brand: brand, tk: tk, own: split(brand), g: g, other: g.from && g.from !== brand ? split(g.from) : null, ex: g.ex ? exampleById(store, g.ex) : null };
  }
  // a type's path and every coarser tier of it, nearest first
  function chainOf(k) { var p = pathOf(k), out = []; for (var L = p.length; L >= 1; L--) out.push(p.slice(0, L).join(' > ')); return out; }
  // one brand's entry for a type: its own path (a loose entry by its leaf), then each coarser tier — where an entry reaches
  // this type only when it names a size this type is made in, or records that the whole branch has no hero sizes
  function lookup(set, t, lad) {
    var chain = chainOf(t.k);
    for (var i = 0; i < chain.length; i++) {
      var key = typeKey(chain[i]), e = set.all[key], how = 'exact';
      if (!e) { var lf = entryFor(set.loose, { k: chain[i], d: i ? deptOf(chain[i]) : t.d }); if (lf) { e = lf.e; key = lf.key; how = 'leaf'; } }
      if (!e) continue;
      var all = e.s || [], s = all.filter(function (x) { return lad[x]; });
      if (i && all.length && !s.length) continue;
      return { e: e, key: key, how: how, s: s, up: i ? chain[i] : '' };
    }
    return null;
  }
  // THE RESOLUTION, strongest first: the brand's own entry for this type (set by hand, or imported from its document), then
  // the nearest coarser tier the brand set (Ray, 30 Sep 2026: "sometimes no need too much granulartiy" — a list set for
  // "Women > Clothing" reaches every women's clothing type that does not set its own), then the brand it follows (the same
  // two steps), then the example it follows. Nothing fits = not mapped, with no sizes — never a guess.
  //   own = the entry is this type's own · up = the coarser tier it came from · dec = a decision reached it (a list, or "none")
  function heroFor(store, brand, t, ctx) {
    ctx = ctx || ctxOf(store, brand, null);
    var lad = {}; ((t && t.sz) || []).forEach(function (z) { lad[z[0]] = 1; });
    var o = lookup(ctx.own, t, lad);
    if (o) return { s: o.s, all: o.e.s || [], src: o.e.src || 'set', by: o.e.by || '', at: o.e.at || 0, key: o.key, how: o.how, own: !o.up, up: o.up, dec: true };
    if (ctx.other) {
      var b = lookup(ctx.other, t, lad);
      if (b) return { s: b.s, all: b.e.s || [], src: 'brand', from: ctx.g.from, how: b.how, up: b.up, dec: !!b.s.length || !(b.e.s || []).length };
    }
    if (ctx.ex) {
      var r = fromExample(ctx.ex, t);
      if (r.s.length) return { s: r.s, all: r.s, src: 'ex', ex: ctx.ex.id, exName: ctx.ex.name, row: r.row, dec: true };
    }
    return { s: [], all: [], src: '' };
  }
  // the whole card for one market at one tier (none = every stored type at its finest): each type with its hero list, where
  // the list came from, and its MEASURE — which is always the sum of its finest types, each measured on the list that
  // reaches IT. So a coarse row, the tiles and every other tier agree, and a finer type that sets its own list is counted
  // on its own list wherever it is added up (`finer` = how many of a row's types read a list set BELOW the row — a person's
  // decision at a finer tier; an example reading each type's own run differently is not one).
  function map(store, brand, cen, tier) {
    var ctx = ctxOf(store, brand, cen), nodes = (cen && cen.types) || [];
    var eff = nodes.map(function (t) { var h = heroFor(store, brand, t, ctx); return { h: h, m: measure(t, h.s) }; });
    var rowsOf = tier ? tierTypes(cen, tier) : nodes.map(function (t, i) { return Object.assign({}, t, { nodes: [i] }); });
    var types = rowsOf.map(function (t) {
      var h = heroFor(store, brand, t, ctx), m = { hero: h.s.slice(), rows: 0, in: 0, out: 0, st: 0, full: 0, some: 0, none: 0, unk: 0, untracked: 0, pats: false }, finer = 0;
      var below = typeKey(t.k) + ' > ';
      (t.nodes || []).forEach(function (i) {
        var e = eff[i], n = nodes[i];
        ['rows', 'in', 'out', 'st', 'full', 'some', 'none', 'unk', 'untracked'].forEach(function (k) { m[k] += e.m[k]; });
        if (e.m.pats) m.pats = true;
        if (e.h.dec && e.h.src !== 'ex' && typeKey(e.h.up || n.k).indexOf(below) === 0) finer++;
      });
      return { t: t, h: h, m: m, finer: t.nodes && t.nodes.length > 1 ? finer : 0 };
    });
    var sum = { types: types.length, sized: 0, mapped: 0, mappedRows: 0, sizedRows: 0, rows: 0, in: 0, st: 0, full: 0, bySrc: {} };
    types.forEach(function (x) {
      var sizedRows = x.t.sz.reduce(function (a, z) { return a + z[1]; }, 0);
      if (!sizedRows) return;
      sum.sized++; sum.sizedRows += sizedRows;
      // a type counts as mapped once a list reaches it — including a person's decision that it has NO hero sizes
      if (!x.h.s.length && !x.h.dec) return;
      sum.mapped++; sum.mappedRows += sizedRows;
      sum.bySrc[x.h.up ? 'up' : x.h.src] = (sum.bySrc[x.h.up ? 'up' : x.h.src] || 0) + 1;
    });
    // the hero-stock headline is the brand's, whatever the tier: every finest type on the list that reaches it
    eff.forEach(function (e) { if (!e.h.s.length) return; sum.rows += e.m.rows; sum.in += e.m.in; sum.st += e.m.st; sum.full += e.m.full; });
    return { types: types, sum: sum, tier: tier || 0 };
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
  // the brand's map as a sheet, at the tier on screen (the export is also the template a brand fills in)
  function docRows(store, brand, cen, tier) {
    var head = ['Product type', 'Hero sizes', 'Source', 'Sizes made in'];
    var body = map(store, brand, cen, tier).types.filter(function (x) { return x.t.sz.length; }).map(function (x) {
      return [x.t.k, x.h.s.join(', '), srcWord(x.h), x.t.sz.map(function (z) { return z[0]; }).join(', ')];
    });
    return [head].concat(body);
  }
  function srcWord(h) {
    if (!h || !h.src) return 'Not mapped';
    var w = h.src === 'doc' ? 'Brand document' : h.src === 'set' ? 'Set by hand' : h.src === 'core' ? 'Core of the run'
      : h.src === 'brand' ? 'Follows ' + h.from : h.src === 'ex' ? 'Example: ' + (h.exName || h.ex) : h.src;
    return h.up ? w + ' (from ' + h.up + ')' : w;
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
    census: census, measure: measure, core: core, treeIndex: treeIndex, commonPath: commonPath, MASTER_ONLY: MASTER_ONLY,
    tiers: tiers, tierTypes: tierTypes, tierKey: tierKey, defaultTier: defaultTier, treeKeys: treeKeys, chainOf: chainOf,
    EXAMPLES: EXAMPLES, fromExample: fromExample, examplesOf: examplesOf, exampleById: exampleById, exampleFromBrand: exampleFromBrand,
    guideOf: guideOf, entriesOf: entriesOf, entryFor: entryFor, ctxOf: ctxOf, heroFor: heroFor, map: map,
    parseDoc: parseDoc, docRows: docRows, srcWord: srcWord, leafWords: leafWords
  };
});
