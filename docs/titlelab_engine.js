/* FeedSpark · Title Lab engine (UMD — window.FeedTitles in the browser, require() in node).
 *
 * Ray, 12 Nov 2026: "a new module just for the title. The audit will compare the master feed to the
 * output feed, showing the state of the title and how the title mask looks. It will pick any
 * attribute — brand, item type, pattern, material, color, size, age group, gender — that exists in
 * either the master or the shopping feed … if material appears in the title, it must also appear in
 * the material field … a mask, which is basically an amalgamation of attributes."
 *
 * WHAT THIS READS. One product at a time: the title the client's MASTER carries (before), the title
 * the OUTPUT feed sends (after), and the eight attributes as each side holds them in its own FIELDS.
 * It then finds each attribute's value INSIDE each title, so a title reads as a MASK — the order its
 * attributes come in, with whatever is left over as the product's own name — and so three questions
 * can be answered per attribute with a count behind each:
 *   · was it in the title before, and is it now          (what the rewrite added)
 *   · does the title agree with the field                (title says cotton → g:material says cotton)
 *   · where did the value come from                      (the client's own data, or data we populated)
 *
 * WHAT IT IS NOT. String evidence, never a model: a value is "in the title" when its words are there
 * as whole words (plural-blind, case-blind). A word the title uses that no field and no vocabulary
 * knows stays part of the name. Nothing here is guessed; an attribute nobody can locate reads absent.
 *
 * Pure: no DOM, no fetch. The page hands over E (the Catalogue engine, docs/catalog_engine.js) for
 * the master-side column reading it already does; everything else is plain data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedTitles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.0.0';

  // the eight attributes, in the order Ray named them
  var ATTRS = [
    { k: 'brand', l: 'Brand', f: 'g:brand' },
    { k: 'type', l: 'Item type', f: 'g:product_type' },
    { k: 'pattern', l: 'Pattern', f: 'g:pattern' },
    { k: 'material', l: 'Material', f: 'g:material' },
    { k: 'color', l: 'Colour', f: 'g:color' },
    { k: 'size', l: 'Size', f: 'g:size' },
    { k: 'age_group', l: 'Age group', f: 'g:age_group' },
    { k: 'gender', l: 'Gender', f: 'g:gender' }
  ];
  var KEYS = ATTRS.map(function (a) { return a.k; });
  var LABEL = { name: 'Product name' }; ATTRS.forEach(function (a) { LABEL[a.k] = a.l; });
  var BIT = {}; KEYS.forEach(function (k, i) { BIT[k] = 1 << i; });
  // the four answers to "does the title agree with the field"
  var CHECKS = [
    { k: 'agree', l: 'Title and field agree' },
    { k: 'title_only', l: 'In the title, not in the field' },
    { k: 'differ', l: 'Title and field differ' },
    { k: 'field_only', l: 'In the field, not in the title' }
  ];
  var CHK_CODE = { none: 0, agree: 1, title_only: 2, differ: 3, field_only: 4 };
  var CHK_NAME = ['none', 'agree', 'title_only', 'differ', 'field_only'];
  var KINDS = [
    { k: 'same', l: 'Unchanged' },
    { k: 'added', l: 'Attributes added' },
    { k: 'reordered', l: 'Re-ordered' },
    { k: 'reworded', l: 'Reworded' },
    { k: 'removed', l: 'Attributes removed' },
    { k: 'nobefore', l: 'No master title' }
  ];

  function s0(v) { return v == null ? '' : String(v); }
  function squash(s) { return s0(s).replace(/[\s ​]+/g, ' ').trim(); }

  // ---- words -------------------------------------------------------------------------------------
  // plural-blind, possessive-blind: "Women's" = "Womens" = "Women", "Skirts" = "Skirt", "Dresses" = "Dress"
  var ALIAS_W = { gray: 'grey', colour: 'color', pyjama: 'pajama', tshirt: 't', womenswear: 'women', menswear: 'men', childrens: 'children', kidswear: 'kid' };
  function stem(w) {
    w = s0(w).toLowerCase().replace(/['’]s$/, '').replace(/['’]/g, '');
    if (!w || /^\d/.test(w)) return w;
    if (w.length > 4 && /(sses|ches|shes|xes|zes)$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 4 && /ies$/.test(w)) w = w.slice(0, -3) + 'y';
    else if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    return ALIAS_W[w] || w;
  }
  var WORD = /[A-Za-z0-9À-ɏ]+(?:['’][A-Za-z]+)?/g;
  // a title as words, each knowing where it sits in the original string
  function toks(str) {
    var out = [], m; str = s0(str); WORD.lastIndex = 0;
    while ((m = WORD.exec(str))) out.push({ w: stem(m[0]), s: m.index, e: m.index + m[0].length });
    return out;
  }
  function words(str) { return toks(str).map(function (t) { return t.w; }); }
  // words that are grammar, not information — never a "name" on their own
  var STOP = {}; 'in,with,and,for,the,a,an,of,by,to,on,de,en,et,mit,und,fur,per,con,da,size,sz,x,amp'.split(',').forEach(function (w) { STOP[w] = 1; });
  var SIZE_MARK = {}; 'size,sz,taille,große,grosse,groesse,maat,talla,taglia,storlek'.split(',').forEach(function (w) { SIZE_MARK[w] = 1; });

  // ---- the two vocabulary attributes whose values are a fixed list ----------------------------------
  var GENDER = { female: ['women', 'woman', 'lady', 'female', 'girl'], male: ['men', 'man', 'male', 'boy', 'gent'], unisex: ['unisex'] };
  var AGE = { kids: ['kid', 'children', 'child', 'girl', 'boy', 'junior', 'youth', 'teen'], toddler: ['toddler'], infant: ['infant', 'baby'], newborn: ['newborn'], adult: ['adult'] };
  function canonGender(v) {
    var s = s0(v).toLowerCase().replace(/[^a-z]/g, '');
    if (/^(female|women|womens|woman|ladies|lady|womenswear|f|girls?|damen|femme|dames?|mujer|donna)$/.test(s)) return 'female';
    if (/^(male|men|mens|man|menswear|m|boys?|herren|homme|heren|hombre|uomo)$/.test(s)) return 'male';
    if (/^(unisex|u|both)$/.test(s)) return 'unisex';
    return '';
  }
  function canonAge(v) {
    var s = s0(v).toLowerCase().replace(/[^a-z]/g, '');
    if (/^(adult|adults|grownup)$/.test(s)) return 'adult';
    if (/^(kids|kid|children|child|junior|juniors|youth|girls?|boys?)$/.test(s)) return 'kids';
    if (/^(toddler|toddlers)$/.test(s)) return 'toddler';
    if (/^(infant|infants|baby|babies)$/.test(s)) return 'infant';
    if (/^(newborn|newborns)$/.test(s)) return 'newborn';
    return '';
  }
  var SYN_REV = { gender: {}, age_group: {} };
  Object.keys(GENDER).forEach(function (c) { GENDER[c].forEach(function (w) { SYN_REV.gender[w] = c; }); });
  Object.keys(AGE).forEach(function (c) { AGE[c].forEach(function (w) { if (!SYN_REV.age_group[w]) SYN_REV.age_group[w] = c; }); });

  // ---- a starting vocabulary for the three free-text attributes -----------------------------------------
  // The feed's OWN values do most of the work (vocabAdd); this is only what lets "Velvet" be recognised
  // as a material on a feed whose g:material column is empty everywhere — which is exactly the case
  // the title ↔ field check exists to find.
  var BASE = {
    color: 'black,white,navy,blue,red,green,grey,pink,purple,yellow,orange,brown,beige,cream,ivory,khaki,burgundy,silver,gold,tan,teal,lilac,mustard,charcoal,coral,turquoise,multi,nude,olive',
    material: 'cotton,linen,wool,leather,suede,silk,satin,velvet,denim,cashmere,polyester,viscose,nylon,fleece,corduroy,tweed,merino,lace,mesh,canvas,chiffon,jersey,faux fur,faux leather,organic cotton',
    pattern: 'striped,stripe,floral,check,checked,plaid,polka dot,spot,spotted,animal print,leopard,leopard print,camo,camouflage,tartan,paisley,gingham,printed,plain,colourblock,colour block,geometric,tie dye,embroidered'
  };
  var VOCAB_ATTRS = ['brand', 'color', 'material', 'pattern'];
  var VOCAB_MIN = 3;        // a value joins the vocabulary once this many products carry it
  var VOCAB_MAX_WORDS = 3;  // a title names an attribute in a word or three, never a sentence

  // the parts a field value can be read as: "Green/Pink" → green pink · green · pink; "Cotton 60%, Polyester 40%" → cotton · polyester
  function parts(k, v) {
    var s = squash(v); if (!s) return [];
    if (k === 'type') {
      var leaf = s.replace(/^[\s{\[(]+|[\s}\])]+$/g, '').split(/\s*(?:>|›|»|\|)\s*/).filter(Boolean).pop() || '';
      var lw = words(leaf); if (!lw.length) return [];
      var out = [lw];
      // the head noun on its own: "Midi Dresses" is in a title that says "Dress"
      if (lw.length > 1 && lw[lw.length - 1].length >= 3) out.push([lw[lw.length - 1]]);
      return out;
    }
    if (k === 'brand' || k === 'size') { var bw = words(s); return bw.length ? [bw] : []; }
    s = s.replace(/\([^)]*\)/g, ' ').replace(/\d+(\.\d+)?\s*%/g, ' ');
    var whole = words(s), list = [];
    if (whole.length && whole.length <= VOCAB_MAX_WORDS + 1) list.push(whole);
    s.split(/\s*[\/,&+;|]\s*|\s+and\s+/i).forEach(function (p) {
      var w = words(p).filter(function (x) { return !/^\d+$/.test(x); });
      if (w.length && w.length <= VOCAB_MAX_WORDS && !list.some(function (l) { return l.join(' ') === w.join(' '); })) list.push(w);
    });
    return list;
  }

  // ---- the vocabulary: built from the feed it is about to read --------------------------------------
  function vocabNew() { var V = { n: {}, set: {}, sealed: false }; VOCAB_ATTRS.forEach(function (k) { V.n[k] = new Map(); V.set[k] = new Map(); }); return V; }
  // one product's fields, both sides (side = what sides() returns)
  function vocabAdd(V, side) {
    VOCAB_ATTRS.forEach(function (k) {
      var seen = {}, f = side.f[k] || {};
      [f.f, f.m].forEach(function (v) {
        parts(k, v).forEach(function (w) {
          if (w.length > VOCAB_MAX_WORDS) return;
          var key = w.join(' '); if (seen[key] || key.length < 3 || /^\d+$/.test(key)) return; seen[key] = 1;
          V.n[k].set(key, (V.n[k].get(key) || 0) + 1);
        });
      });
    });
  }
  function vocabSeal(V) {
    VOCAB_ATTRS.forEach(function (k) {
      var set = V.set[k];
      if (BASE[k]) BASE[k].split(',').forEach(function (p) { var w = words(p); if (w.length) set.set(w.join(' '), w.length); });
      V.n[k].forEach(function (n, key) { if (n >= VOCAB_MIN) set.set(key, key.split(' ').length); });
    });
    // a brand's own words are never a colour, a material or a pattern ("Orange Label", "Gold Standard")
    V.set.brand.forEach(function (n, key) { ['color', 'material', 'pattern'].forEach(function (k) { if (!(BASE[k] || '').split(',').some(function (p) { return words(p).join(' ') === key; })) V.set[k].delete(key); }); });
    V.sealed = true; return V;
  }

  // ---- locating a value in a title --------------------------------------------------------------------
  // the first place `vw` (words) runs in `tt` (title tokens) where no word is already claimed
  function findRun(tt, vw, used, from) {
    var n = vw.length; if (!n) return -1;
    outer: for (var i = from || 0; i + n <= tt.length; i++) {
      for (var j = 0; j < n; j++) if (tt[i + j].w !== vw[j] || used[i + j]) continue outer;
      return i;
    }
    return -1;
  }
  function claim(used, i, n, k) { for (var j = 0; j < n; j++) used[i + j] = k; }
  function sizeOk(tt, i, n, vw) {
    var marked = (i > 0 && SIZE_MARK[tt[i - 1].w]) || (i > 1 && SIZE_MARK[tt[i - 2].w] && STOP[tt[i - 1].w]);
    if (marked) return 2;
    if (i + n === tt.length && i > 0) return 1;                 // the title ends on it
    var joined = vw.join(' ');
    if (n >= 2 && /[a-z]/.test(joined)) return 1;              // "3 4 years", "uk 8", "one size"
    if (n === 1 && /^[a-z]{2,}$/.test(joined) && /^(xxs|xs|sm|small|medium|med|large|xl|xxl|xxxl|2xl|3xl|4xl|os|onesize)$/.test(joined)) return 1;
    return 0;
  }

  // one title read against one product's fields. opt.side = 'f' (the output's fields first) or 'm'.
  // → { spans:[{k, s, e, v, via}], mask:[keys], sig, has (bits), found:{k:{v, via, own}} }
  function readTitle(title, f, V, opt) {
    title = s0(title);
    var tt = toks(title), used = new Array(tt.length), found = {}, spans = [];
    var first = (opt && opt.side) === 'm' ? ['m', 'f'] : ['f', 'm'];
    function put(k, i, n, via, own, ext) {
      var s = tt[i].s, e = tt[i + n - 1].e;
      if (ext != null) s = tt[ext].s;
      claim(used, ext != null ? ext : i, n + (ext != null ? i - ext : 0), k);
      found[k] = { v: title.slice(tt[i].s, e), via: via, own: own };
      spans.push({ k: k, s: s, e: e, v: title.slice(s, e), via: via });
    }
    function own(k) {
      for (var x = 0; x < 2; x++) {
        var src = first[x], v = (f[k] || {})[src]; if (!v) continue;
        var ps = parts(k, v);
        for (var p = 0; p < ps.length; p++) {
          var from = 0, i;
          while ((i = findRun(tt, ps[p], used, from)) >= 0) {
            if (k !== 'size') { put(k, i, ps[p].length, src === 'f' ? 'feed' : 'master', true); return true; }
            var ok = sizeOk(tt, i, ps[p].length, ps[p]);
            if (ok) {
              var ext = null;
              if (ok === 2) { ext = i - 1; while (ext > 0 && !SIZE_MARK[tt[ext].w]) ext--; if (!SIZE_MARK[tt[ext].w] || used[ext]) ext = null; }
              put(k, i, ps[p].length, src === 'f' ? 'feed' : 'master', true, ext); return true;
            }
            from = i + 1;
          }
        }
      }
      return false;
    }
    function syn(k, table, canon) {
      // the field's own value first, then any word the list knows (a title saying "Girls" under g:gender male is a finding)
      var c = canon((f[k] || {}).f) || canon((f[k] || {}).m), i, j;
      if (c && table[c]) for (i = 0; i < tt.length; i++) if (table[c].indexOf(tt[i].w) >= 0 && (!used[i] || used[i] === 'gender' || used[i] === 'age_group')) {
        if (!used[i]) put(k, i, 1, 'field', true); else found[k] = { v: title.slice(tt[i].s, tt[i].e), via: 'field', own: true, shared: true };
        return;
      }
      for (i = 0; i < tt.length; i++) {
        var hit = SYN_REV[k][tt[i].w]; if (!hit) continue;
        if (used[i] && used[i] !== 'gender' && used[i] !== 'age_group') continue;
        if (!used[i]) put(k, i, 1, 'vocab', false); else found[k] = { v: title.slice(tt[i].s, tt[i].e), via: 'vocab', own: false, shared: true };
        found[k].canon = hit; return;
      }
    }
    function vocab(k) {
      var set = V && V.set[k]; if (!set || !set.size) return;
      for (var n = VOCAB_MAX_WORDS; n >= 1; n--) for (var i = 0; i + n <= tt.length; i++) {
        var free = true, key = '';
        for (var j = 0; j < n; j++) { if (used[i + j]) { free = false; break; } key += (j ? ' ' : '') + tt[i + j].w; }
        if (free && set.has(key)) { put(k, i, n, 'vocab', false); return; }
      }
    }
    // order matters only for words two attributes could both claim: the field's own value always
    // wins over a vocabulary guess, brand first (a brand's words are never read as a colour)
    own('brand'); own('size'); own('color'); own('material'); own('pattern');
    syn('gender', GENDER, canonGender); syn('age_group', AGE, canonAge);
    own('type');
    ['brand', 'color', 'material', 'pattern'].forEach(function (k) { if (!found[k]) vocab(k); });
    // a size the field does not hold, said outright: "… in Size: 18"
    if (!found.size) for (var i = 0; i + 1 < tt.length; i++) if (SIZE_MARK[tt[i].w] && !used[i] && !used[i + 1] && !STOP[tt[i + 1].w]) {
      var n = 1; if (i + 2 < tt.length && !used[i + 2] && /^(\d+|year|yr|month|mth|uk|eu|us)$/.test(tt[i + 2].w)) n = 2;
      if (n === 2 && i + 3 < tt.length && !used[i + 3] && /^(year|yr|month|mth)$/.test(tt[i + 3].w)) n = 3;
      put('size', i + 1, n, 'vocab', false, i); break;
    }
    spans.sort(function (a, b) { return a.s - b.s; });
    // the mask: the attributes in the order the title says them, anything left over is the name
    var mask = [], has = 0;
    for (var t = 0; t < tt.length; t++) {
      var k = used[t] || (STOP[tt[t].w] ? null : 'name'); if (!k) continue;
      // the product name is one part of a mask however many attribute words sit inside it
      if (k === 'name' ? mask.indexOf('name') < 0 : mask[mask.length - 1] !== k) mask.push(k);
    }
    KEYS.forEach(function (k) { if (found[k]) has |= BIT[k]; });
    return { spans: spans, mask: mask, sig: mask.join('>'), has: has, found: found, n: tt.length };
  }

  // ---- does the title agree with the field ---------------------------------------------------------
  // one word of each is the same word, or the same word inflected: print / printed, stripe / striped, knit / knitted
  function near(x, y) { if (x === y) return true; var a = x.length <= y.length ? x : y, b = a === x ? y : x; return a.length >= 4 && b.length - a.length <= 3 && b.indexOf(a.replace(/e$/, '')) === 0; }
  function overlap(a, b) { var A = words(a), B = words(b); return A.some(function (w) { return B.some(function (v) { return near(w, v); }); }); }
  function check(k, fieldV, fd) {
    var has = !!squash(fieldV);
    if (k === 'gender' || k === 'age_group') {
      var canon = (k === 'gender' ? canonGender : canonAge)(fieldV);
      if (!fd) return has ? 'field_only' : 'none';
      if (!has) return 'title_only';
      if (fd.own) return 'agree';
      if (!fd.canon || !canon) return 'agree';
      // "Girls" says a child, not which age band: a title's child word agrees with kids, toddler, infant
      // and newborn alike, and differs only from adult (and an adult word only from a child field)
      if (k === 'age_group') return (fd.canon === 'adult') !== (canon === 'adult') ? 'differ' : 'agree';
      return fd.canon !== canon ? 'differ' : 'agree';
    }
    if (!fd) return has ? 'field_only' : 'none';
    if (!has) return 'title_only';
    if (fd.own && fd.via === 'feed') return 'agree';
    return overlap(fd.v, fieldV) ? 'agree' : 'differ';
  }

  // ---- the two sides of one product ----------------------------------------------------------------------
  // E = the Catalogue engine · p = its output product · cells/plan = the product's master row and the
  // master's column plan (null when the product has no master row).
  var E_ATTR = { brand: 'brand', type: 'product_type', pattern: 'pattern', material: 'material', color: 'color', size: 'size', age_group: 'age_group', gender: 'gender' };
  function sides(E, p, cells, plan) {
    function mv(a) {
      if (!cells || !plan) return { v: '', h: '' };
      var c = E.cands(a, cells, plan); if (!c.length) return { v: '', h: '' };
      var v = c[0].v; return { v: squash(E.plain(Array.isArray(v) ? v[0] : v)), h: c[0].h };
    }
    var f = {};
    KEYS.forEach(function (k) {
      var fv = p.f[E_ATTR[k]], m = mv(E_ATTR[k]);
      f[k] = { f: squash(Array.isArray(fv) ? fv[0] : fv), m: m.v, mh: m.h };
    });
    var mt = mv('title'), before = mt.v, src = before ? 'master' : '', bh = mt.h;
    // no master row: FeedSpark stamps the title it started from on every item it rewrites
    if (!before && p.otitle) { before = squash(p.otitle); src = 'stamp'; bh = 'c:fs_data_original_title'; }
    var text = '';
    if (cells) { for (var i = 0; i < cells.length && text.length < 6000; i++) if (cells[i]) text += ' ' + cells[i]; }
    return { id: p.id, after: squash(p.f.title), before: before, src: src, bh: bh, f: f, mtext: text,
      img: p.f.image_link || '', opt: p.opti && p.opti.T != null ? !!p.opti.T : null };
  }

  // ---- one product, read whole ----------------------------------------------------------------------------
  function normT(s) { return squash(s).toLowerCase(); }
  // the attributes in the order they are said, the name's own words set aside: new name words are a rewording, not a re-ordering
  function order(mask) { return mask.filter(function (k) { return k !== 'name'; }).join('>'); }
  function read(side, V) {
    var a = readTitle(side.after, side.f, V, { side: 'f' });
    var b = side.before ? readTitle(side.before, side.f, V, { side: 'm' }) : null;
    var chk = {}, prov = {}, mset = null;
    KEYS.forEach(function (k) {
      chk[k] = check(k, side.f[k].f, a.found[k]);
      var fd = a.found[k]; if (!fd) return;
      // where the value came from: the client's own data (its field, or its words anywhere in the master row), or populated
      if (side.f[k].m && overlap(fd.v, side.f[k].m)) { prov[k] = 'source'; return; }
      if (side.mtext) {
        if (!mset) { mset = {}; words(side.mtext).forEach(function (w) { mset[w] = 1; }); }
        // a one- or two-character value (a size "M", a "10") is found in any row by accident — an ID, a price — so it never counts
        if (words(fd.v).every(function (w) { return w.length > 2 && !/^\d+$/.test(w) && mset[w]; })) { prov[k] = 'source'; return; }
      } else if (b && b.found[k]) { prov[k] = 'source'; return; }
      prov[k] = side.f[k].f ? 'populated' : 'title';
    });
    var kind, added = [], removed = [];
    if (!b) kind = 'nobefore';
    else if (normT(side.after) === normT(side.before)) kind = 'same';
    else {
      KEYS.forEach(function (k) { var x = a.has & BIT[k], y = b.has & BIT[k]; if (x && !y) added.push(k); if (y && !x) removed.push(k); });
      kind = added.length ? 'added' : (removed.length ? 'removed' : (order(a.mask) !== order(b.mask) ? 'reordered' : 'reworded'));
    }
    return { id: side.id, a: a, b: b, chk: chk, prov: prov, kind: kind, added: added, removed: removed,
      la: side.after.length, lb: side.before ? side.before.length : 0 };
  }
  // the same reading, packed for a list of thirty thousand: masks as indexes, checks as one number per attribute
  function lite(rec, masks) {
    function mi(sig) { if (sig == null) return -1; var i = masks.ix.get(sig); if (i == null) { i = masks.list.length; masks.list.push(sig); masks.ix.set(sig, i); } return i; }
    var c = 0, issue = 0;
    KEYS.forEach(function (k, i) { var code = CHK_CODE[rec.chk[k]]; c += code * Math.pow(5, i); if (code === 2 || code === 3) issue++; });
    return { ma: mi(rec.a.sig), mb: rec.b ? mi(rec.b.sig) : -1, ha: rec.a.has, hb: rec.b ? rec.b.has : 0, c: c, iss: issue,
      kind: rec.kind, la: rec.la, lb: rec.lb, add: rec.added.length };
  }
  function chkOf(c, i) { return CHK_NAME[Math.floor(c / Math.pow(5, i)) % 5]; }
  function masksNew() { return { list: [], ix: new Map() }; }

  // ---- everything, added up ---------------------------------------------------------------------------------
  // rows = lite() records; recs carry nothing a client could not be shown
  var LEN_MAX = 150, LEN_SEEN = 70;
  function summary(rows, masks) {
    var S = { n: rows.length, before: 0, changed: 0, kinds: {}, la: 0, lb: 0, over: 0, overB: 0, seen: 0, attrsA: 0, attrsB: 0, issues: 0, issueRows: 0,
      attr: {}, ma: new Map(), mb: new Map() };
    KINDS.forEach(function (x) { S.kinds[x.k] = 0; });
    KEYS.forEach(function (k) { S.attr[k] = { a: 0, b: 0, added: 0, removed: 0, chk: { agree: 0, title_only: 0, differ: 0, field_only: 0, none: 0 } }; });
    function bits(n) { var c = 0; while (n) { c += n & 1; n >>= 1; } return c; }
    rows.forEach(function (r) {
      S.kinds[r.kind]++; S.la += r.la; if (r.la > LEN_MAX) S.over++; if (r.la <= LEN_SEEN) S.seen++;
      S.attrsA += bits(r.ha); S.ma.set(r.ma, (S.ma.get(r.ma) || 0) + 1);
      var hasB = r.kind !== 'nobefore';
      if (hasB) { S.before++; S.lb += r.lb; if (r.lb > LEN_MAX) S.overB++; S.attrsB += bits(r.hb); S.mb.set(r.mb, (S.mb.get(r.mb) || 0) + 1); if (r.kind !== 'same') S.changed++; }
      if (r.iss) { S.issues += r.iss; S.issueRows++; }
      KEYS.forEach(function (k, i) {
        var A = S.attr[k], x = r.ha & BIT[k], y = r.hb & BIT[k];
        if (x) A.a++; if (hasB && y) A.b++; if (hasB && x && !y) A.added++; if (hasB && y && !x) A.removed++;
        A.chk[chkOf(r.c, i)]++;
      });
    });
    function top(m) {
      var out = []; m.forEach(function (n, i) { out.push({ i: i, sig: masks.list[i], n: n }); });
      return out.sort(function (a, b) { return b.n - a.n || (a.sig < b.sig ? -1 : 1); });
    }
    S.masksA = top(S.ma); S.masksB = top(S.mb); delete S.ma; delete S.mb;
    S.avgA = S.n ? S.la / S.n : 0; S.avgB = S.before ? S.lb / S.before : 0;
    S.perA = S.n ? S.attrsA / S.n : 0; S.perB = S.before ? S.attrsB / S.before : 0;
    S.topShare = S.n && S.masksA.length ? S.masksA[0].n / S.n : 0;
    // how much of the catalogue the three biggest masks cover — "systematic" as a number
    S.top3 = S.n ? S.masksA.slice(0, 3).reduce(function (t, m) { return t + m.n; }, 0) / S.n : 0;
    return S;
  }

  // ---- words ---------------------------------------------------------------------------------------------------
  function maskLabel(sig, sep) {
    if (!sig) return 'no attribute found';
    return sig.split('>').map(function (k) { return LABEL[k] || k; }).join(sep || ' + ');
  }
  function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : 0; }
  function nf(n) { return Math.round(n).toLocaleString('en-GB'); }
  // the summary in plain words — what an AM reads out, and what ⧉ Copy summary puts on the clipboard
  function story(S, ctx) {
    ctx = ctx || {}; var out = [], who = ctx.brand ? ctx.brand + (ctx.market ? ' ' + ctx.market : '') : 'This feed';
    if (!S.n) return [who + ': no titles read yet.'];
    out.push(who + ': ' + nf(S.n) + ' titles read' + (S.before ? ', ' + nf(S.before) + (ctx.before === 'stamp' ? ' set against the original title FeedSpark stamps on each item (no master feed joined).' : ' set against the title the master feed carries.') : '. No master title could be joined, so nothing is compared with a before.'));
    if (S.before) {
      out.push(nf(S.changed) + ' of ' + nf(S.before) + ' titles (' + pct(S.changed, S.before) + '%) were rewritten: ' +
        [['added', 'gained an attribute'], ['reordered', 're-ordered'], ['reworded', 'reworded'], ['removed', 'lost an attribute']]
          .filter(function (x) { return S.kinds[x[0]]; }).map(function (x) { return nf(S.kinds[x[0]]) + ' ' + x[1]; }).join(', ') + '.');
      out.push('The average title went from ' + Math.round(S.avgB) + ' to ' + Math.round(S.avgA) + ' characters and from ' + S.perB.toFixed(1) + ' to ' + S.perA.toFixed(1) + ' attributes.');
      var add = KEYS.filter(function (k) { return S.attr[k].added; }).sort(function (a, b) { return S.attr[b].added - S.attr[a].added; });
      if (add.length) out.push('Added to titles: ' + add.slice(0, 5).map(function (k) { return LABEL[k] + ' on ' + nf(S.attr[k].added); }).join(', ') + '.');
    }
    if (S.masksA.length) out.push('The most common mask is ' + maskLabel(S.masksA[0].sig) + ' (' + pct(S.masksA[0].n, S.n) + '% of titles); the three biggest masks cover ' + pct(S.top3 * S.n, S.n) + '%.');
    if (S.over) out.push(nf(S.over) + ' titles run past Google’s ' + LEN_MAX + '-character limit.');
    var gap = KEYS.filter(function (k) { return S.attr[k].chk.title_only || S.attr[k].chk.differ; });
    if (gap.length) out.push('To look at: ' + gap.map(function (k) {
      var c = S.attr[k].chk, bits = [];
      if (c.title_only) bits.push(nf(c.title_only) + ' in the title but not in the field');
      if (c.differ) bits.push(nf(c.differ) + ' where title and field differ');
      return LABEL[k] + ' — ' + bits.join(', ');
    }).join('; ') + '.');
    else out.push('Every attribute a title names is also in its field.');
    return out;
  }

  return {
    VERSION: VERSION, ATTRS: ATTRS, KEYS: KEYS, LABEL: LABEL, BIT: BIT, CHECKS: CHECKS, KINDS: KINDS, LEN_MAX: LEN_MAX, LEN_SEEN: LEN_SEEN,
    stem: stem, toks: toks, words: words, parts: parts, canonGender: canonGender, canonAge: canonAge,
    vocabNew: vocabNew, vocabAdd: vocabAdd, vocabSeal: vocabSeal,
    readTitle: readTitle, check: check, sides: sides, read: read, lite: lite, chkOf: chkOf, masksNew: masksNew,
    summary: summary, maskLabel: maskLabel, story: story, pct: pct
  };
});
