// HERO SIZES + HELD-BACK PRODUCTS harness (pure node, CI-safe).
//
// Ray, 30 Sep 2026: "bring in hero size mapping per brand as well and later allow cross industry "guildlines" - (this
// is a document per brand or they can follow examples) - sit within stock management - breakdown by their product
// type" — and, the same afternoon: "download list of Range Completion > held back product IDs and Titles and Sizes and
// availablity (basically they should be products that are in stock in masterfeed but not appear in output feeds due to
// range completion held back rule)".
//
// Pins the hero-size engine (docs/herosize_engine.js) — sizes, departments, product types, the SIZE CENSUS on synthetic
// masters, the measure, the examples, the guide resolution, the document import — then the worker's own half
// (src/herosizes.js: the census it will store, the edits a signin may make), the held-back join (docs/catalog_engine.js
// feedIndex + heldBack), the agent, the route, the page, the tripwire stub, and that no census or guide is committed.
// Every product type, size, id and count here is invented.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import * as HW from '../cloudflare/feedspark-deck/src/herosizes.js';
import * as ROAS from '../cloudflare/feedspark-deck/src/roas.js';
const require = createRequire(import.meta.url);
const H = require('../docs/herosize_engine.js');
const E = require('../docs/catalog_engine.js');
const FA = require('../docs/feedlab_engine.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), SP = read('docs/FeedSpark_Stock.html'), AG = read('tools/master_stock.mjs');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why ? ' — ' + why : '')); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a master as the agent reads it: a header, then rows, through the Catalogue's own delimited parser (placed on a feed's
// product_type tree when one is given)
function csvCensus(text, tree) {
  const c = H.census(E, tree), sn = E.sniff(text.slice(0, 20000));
  const p = E.delimParser(sn.delim, (r) => c.onRow(r), sn);
  p.push(text); p.end();
  return c.finish();
}
const q = (v) => (/[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
const csv = (rows) => rows.map((r) => r.map((x) => q(String(x == null ? '' : x))).join(',')).join('\n') + '\n';

console.log('· sizes — one size, two spellings, one key');
const SK = [
  ['UK 7 (EU 40½)', 'UK 7'], ['uk7', 'UK 7'], ['EU 40½', 'EU 40.5'], ['7 ½', '7.5'], ['4,5', '4.5'], ['03', '3'],
  ['14R', '14'], ['32L', '32'], ['30/32', '30'], ['W30 L32', '30'], ['6/8', '6/8'], ['10-12', '10-12'],
  ['Medium', 'M'], ['X-Large', 'XL'], ['2XL', 'XXL'], ['3XL', 'XXXL'], ['XXXXL', '4XL'], ['XS / S', 'XS/S'], ['M / L', 'M/L'],
  ['1SIZE', 'ONE SIZE'], ['One Size', 'ONE SIZE'], ['Einheitsgröße', 'ONE SIZE'], ['TALLA ÚNICA', 'ONE SIZE'], ['Taglia unica', 'ONE SIZE'],
  ['3-4 years', '3-4 YRS'], ['Age 5', '5 YRS'], ['9 Y', '9 YRS'], ['0-3 mths', '0-3 MTHS'], ['12-18 months', '12-18 MTHS'],
  ['145', '14.5'], ['155', '15.5'], ['Size: M', 'M'], ['Taille 38', '38'], ['Größe: 40', '40'], ['', ''], ['   ', ''],
];
SK.forEach(([a, b]) => t('sizeKey(' + JSON.stringify(a) + ') = ' + JSON.stringify(b), H.sizeKey(a) === b, 'got ' + JSON.stringify(H.sizeKey(a))));
t('a size never carries a character the worker would refuse, and never runs past 24', ['EU 40⅓', 'Size™ M', 'X'.repeat(40) + 'L'].every((v) => { const k = H.sizeKey(v); return k.length <= 24 && /^[\w .\/½+&'#-]*$/.test(k); }));
t('alpha sizes sort on the run, dual sizes between their halves', eq(H.sortSizes(['XL', 'S', 'M/L', 'M', 'XXS', 'L', 'XS', 'XXL', '3XL', 'S/M']), ['XXS', 'XS', 'S', 'S/M', 'M', 'M/L', 'L', 'XL', 'XXL', '3XL']));
t('shoe sizes sort as numbers, halves in place', eq(H.sortSizes(['UK 10', 'UK 2', 'UK 2.5', 'UK 13', 'UK 1']), ['UK 1', 'UK 2', 'UK 2.5', 'UK 10', 'UK 13']));
t('months before years, each by age', eq(H.sortSizes(['12-18 MTHS', '3 YRS', '0-3 MTHS', '11-12 YRS', '2-3 YRS']), ['0-3 MTHS', '12-18 MTHS', '2-3 YRS', '3 YRS', '11-12 YRS']));
t('ONE SIZE sorts last; an unknown word after the numbers', eq(H.sortSizes(['ONE SIZE', 'LLO', '10', 'M']), ['M', '10', 'ONE SIZE', 'LLO']));
t('sizeClass: alpha, numeric (any system), ages, one size — the card\u2019s one line per kind', H.sizeClass('XS/S') === 'alpha' && H.sizeClass('XXL') === 'alpha' && H.sizeClass('10-12') === 'num' && H.sizeClass('UK 5') === 'num'
  && H.sizeClass('14.5') === 'num' && H.sizeClass('3-4 YRS') === 'age' && H.sizeClass('0-3 MTHS') === 'age' && H.sizeClass('ONE SIZE') === 'one' && H.sizeClass('LLO') === 'other');
t('page: alpha and numeric sizes on separate lines, never wrapped together (Ray, 30 Sep 2026)', /, c = HS\.sizeClass\(z\[0\]\);/.test(SP) && /'<div class="szr" data-sc="' \+ c \+ '">'/.test(SP) && /\.szr\{display:flex;flex-wrap:wrap/.test(SP));
t('sizeCore sets the system aside ("UK 10" → "10"), a bare size is itself', H.sizeCore('UK 10') === '10' && H.sizeCore('EU 40.5') === '40.5' && H.sizeCore('M') === 'M');

console.log('· departments and product types');
t('the brand’s own words: Womens / Womenswear / Men / Kids Unisex / Childrenswear / Girls', H.deptOf('Womens > Trainers') === 'women' && H.deptOf('Womenswear > Dresses') === 'women' && H.deptOf('Men > T-Shirts') === 'men'
  && H.deptOf('Kids Unisex > Toddler') === 'kids' && H.deptOf('Childrenswear > Dresses') === 'kids' && H.deptOf('Girls > Girls Junior') === 'kids');
t('"women" is never read as "men"; a plain type has no department', H.deptOf('Women') === 'women' && H.deptOf('T-Shirts') === '' && H.deptOf('Accessories') === '');
t('the columns when the path says nothing: female / mens / unisex, and a child age group wins', H.deptFromCols('female', 'adult') === 'women' && H.deptFromCols('mens', '') === 'men'
  && H.deptFromCols('Unisex', '') === 'unisex' && H.deptFromCols('female', 'children') === 'kids' && H.deptFromCols('', '') === '');
t('Superdry’s shape: a bare category + a gender column → "Men > T-Shirts"', H.typeLabel('T-Shirts', 'mens', '') === 'Men > T-Shirts');
t('Reiss’s shape: the path already names it, no prefix', H.typeLabel('Womenswear > Dresses', 'female', 'adult') === 'Womenswear > Dresses');
t('every roster language: Superdry DE\u2019s "Damen" / "Herren" keep the types apart, in the brand\u2019s own words', H.typeLabel('Jacken', 'Damen', '') === 'Damen > Jacken' && H.typeLabel('Jacken', 'Herren', '') === 'Herren > Jacken'
  && H.deptOf('Damen > Jacken') === 'women' && H.deptOf('Herren > Jacken') === 'men' && H.deptOf('Femme > Vestes') === 'women' && H.deptOf('Miehet > Takit') === 'men' && H.deptOf('Kobiety > Kurtki') === 'women'
  && H.deptOf('Killar > T-Shirts') === 'men' && H.deptOf('Tjejer > Klänningar') === 'women' && H.deptOf('Dział męski > T-Shirty') === 'men' && H.deptOf('Dział damski > Kurtki') === 'women');
t('a gender word nobody placed still separates the types; a placeholder does not', H.typeLabel('Jacken', 'Zorblax', '') === 'Zorblax > Jacken' && H.typeLabel('Jacken', 'N/A', '') === 'Jacken' && H.genderWord('123') === '');
t('a child\u2019s age group wins over the gender word (a girls\u2019 dress is not a women\u2019s dress)', H.typeLabel('Kleider', 'Damen', 'Kinder') === 'Kids > Kleider' && H.typeLabel('Dresses', 'female', 'children') === 'Kids > Dresses');
t('merchandising buckets in the other languages are not types either', !H.usableType('Alles Anzeigen') && !H.usableType('Kampagne 3') && !H.usableType('Voir tout') && !H.usableType('Näytä kaikki') && H.usableType('Jacken'));
t('two levels, a generic "Clothing" level stepped over', H.typeLabel('Women > Clothing > Dresses > Midi', '', '') === 'Women > Dresses' && H.typeLabel('Men > Shirts > Oxford', '', '') === 'Men > Shirts');
t('a row with no usable type is still counted, under its department', H.typeLabel('', 'womens', '') === 'Women > (no product type)' && H.typeLabel('', '', '') === '(no product type)');
t('not a product type: a category id, a bare department word, a merchandising bucket', !H.usableType('1234') && !H.usableType('Womens') && !H.usableType('View All') && !H.usableType('Campaign 3') && H.usableType('T-Shirts') && H.usableType('Mens > Shirts'));
t('typeKey is the label lower-cased; leafOf the last level', H.typeKey('Men > T-Shirts') === 'men > t-shirts' && H.leafOf('Women > Hoodies and Sweatshirts') === 'hoodies and sweatshirts');

console.log('· the size census — one pass over a synthetic master');
const HEAD = ['product_id', 'item_group_id', 'title', 'gender', 'category', 'type', 'size', 'availability', 'quantity'];
const M1 = [HEAD];
// Superdry-shaped: category first, a "View All" row falling through to `type`, two colours of one style under one group
[['S1', 'mens', 'T-Shirts', ['S', 'M', 'L', 'XL'], ['in stock', 'in stock', 'out of stock', 'in stock']],
 ['S2', 'mens', 'T-Shirts', ['S', 'M', 'L', 'XL'], ['out of stock', 'in stock', 'in stock', 'out of stock']],
 ['S3', 'mens', 'T-Shirts', ['M', 'L'], ['in stock', 'in stock']],
 ['S4', 'womens', 'Dresses', ['8', '10', '12', '14'], ['in stock', 'in stock', 'in stock', 'in stock']],
 ['S5', 'womens', 'Dresses', ['8', '10', '12', '14'], ['', '', 'out of stock', '']],
].forEach(([g, gen, cat, sizes, av]) => sizes.forEach((z, i) => M1.push([g + '-' + z, g, 'Style ' + g, gen, cat, 'Graphic', z, av[i], av[i] ? '' : (i === 0 ? '4' : '')])));
M1.push(['S1-M2', 'S1', 'Style S1 other colour', 'mens', 'T-Shirts', 'Graphic', 'L', 'in stock', '']);           // L of S1 in stock in another colour
M1.push(['V1-S', 'V1', 'Tee', 'mens', 'View All', 'Plain T-shirt', 'S', 'in stock', '']);                         // "View All" → the next candidate
M1.push(['B1', 'B1', 'Bag', 'womens', 'Bags', 'Bag', 'One Size', 'in stock', '']);
M1.push(['N1', 'N1', 'Gift card', '', 'Gifts', 'Card', '', 'in stock', '']);
const C1 = csvCensus(csv(M1));
const tt = (k) => C1.types.find((x) => x.k === k);
t('every row counted; sized, one-size and no-size rows told apart', C1.rows === M1.length - 1 && C1.one === 1 && C1.nos === 1 && C1.sized === M1.length - 3, JSON.stringify({ rows: C1.rows, one: C1.one, nos: C1.nos, sized: C1.sized }));
t('the census is of this shape (CENSUS_V) and names the columns it read', C1.v === H.CENSUS_V && C1.cols.pt === 'category' && C1.cols.size === 'size' && C1.cols.grp === 'item_group_id' && C1.cols.qty === 'quantity');
t('product types: gender prefixed, "View All" fell through to the next column', !!tt('Men > T-Shirts') && !!tt('Women > Dresses') && !!tt('Men > Plain T-shirt') && !tt('Men > View All'), C1.types.map((x) => x.k).join(' | '));
const TS = tt('Men > T-Shirts');
t('a type’s run is in size order with rows, in stock, out per size', eq(TS.sz.map((z) => z[0]), ['S', 'M', 'L', 'XL']) && eq(TS.sz.find((z) => z[0] === 'L'), ['L', 4, 3, 1]));
t('styles = item groups carrying a sized row; patterns count styles', TS.st === 3 && TS.pat.reduce((a, p) => a + p[1], 0) === 3);
t('one character per ladder size: 0 not made · 1 out · 2 in — a size in stock in ANY colour is in stock', TS.pat.some((p) => p[0] === '2222') && TS.pat.some((p) => p[0] === '1221') && TS.pat.some((p) => p[0] === '0220'), JSON.stringify(TS.pat));
const DR = tt('Women > Dresses');
t('no word and no quantity = 3 (not stated), never read as out; a quantity with no word is read', DR.pat.some((p) => p[0] === '2313') && DR.sz[0][2] === 2, JSON.stringify(DR.pat) + ' ' + JSON.stringify(DR.sz));
t('a one-size type has no run', tt('Women > Bags').sz.length === 0 && tt('Women > Bags').one === 1);

// shoe runs, kids by ages, the type cap
const M2 = [['id', 'item_group_id', 'gender', 'Category', 'displaySize', 'availability']];
for (let s = 0; s < 5; s++) ['UK 3 (EU 36)', 'UK 3.5 (EU 36)', 'UK 4 (EU 37)', 'UK 4.5 (EU 37½)', 'UK 5 (EU 38)', 'UK 5.5 (EU 39)', 'UK 6 (EU 39)'].forEach((z, j) => M2.push(['W' + s + j, 'W' + s, 'female', 'Womens > Runners', z, j % 3 ? 'in stock' : 'out of stock']));
for (let s = 0; s < 3; s++) ['3-4 yrs', '5-6 yrs', '7-8 yrs'].forEach((z, j) => M2.push(['K' + s + j, 'K' + s, '', 'Coats', z, 'in stock']));
const C2 = csvCensus(csv(M2));
const RN = C2.types.find((x) => x.k === 'Womens > Runners'), CO = C2.types.find((x) => x.k === 'Coats');
t('a run of half sizes is footwear even when the words never say so (Schuh’s categories)', RN && RN.fw === 1 && !CO.fw);
t('a conversion in brackets is not another size: seven UK sizes, not nine', RN && RN.sz.length === 7 && RN.sz[0][0] === 'UK 3');
t('no gender column, a run of ages → kids (Monsoon names no gender)', CO && CO.d === 'kids');
const M3 = [['id', 'item_group_id', 'product_type', 'size', 'availability']];
for (let k = 0; k < H.TYPE_CAP + 5; k++) for (let r = 0; r <= (k < H.TYPE_CAP ? 2 : 0); r++) M3.push(['T' + k + '-' + r, 'G' + k, 'Type ' + String(k).padStart(3, '0'), 'M', 'in stock']);
const C3 = csvCensus(csv(M3));
t('the biggest ' + H.TYPE_CAP + ' types are kept, the rest COUNTED (tx), never dropped silently', C3.types.length === H.TYPE_CAP && C3.tx.k === 5 && C3.tx.n === 5);
// an XML master through the Feed Lab parser (Monsoon's shape)
const X1 = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>'
  + ['8', '10', '12'].map((z, i) => '<item><g:id>X' + i + '</g:id><g:item_group_id>XG</g:item_group_id><g:product_type>Tea Dresses</g:product_type><g:size>' + z + '</g:size><g:availability>' + (i === 1 ? 'out of stock' : 'in stock') + '</g:availability></item>').join('')
  + '</channel></rss>';
const cx = H.census(E), px = FA.createXmlParser((r, h) => cx.onRow(r, h)); px.push(X1); px.end();
const CX = cx.finish();
const M4 = [['product_id', 'item_group_id', 'gender', 'category', 'type', 'size', 'availability']];
[['D1', 'Damen', 'Jacken', ['34', '36', '38']], ['D2', 'Herren', 'Jacken', ['S', 'M', 'L']], ['D3', 'Damen', 'Alles Anzeigen', ['36']]].forEach(([g, gen, cat, sizes]) => sizes.forEach((z) => M4.push([g + z, g, gen, cat, 'Bomberjacke', z, 'IN_STOCK'])));
const C4 = csvCensus(csv(M4));
t('a German master: one type per department, "Alles Anzeigen" falls through to the next column', eq(C4.types.map((x) => x.k).sort(), ['Damen > Bomberjacke', 'Damen > Jacken', 'Herren > Jacken']) && C4.types.find((x) => x.k === 'Damen > Jacken').d === 'women', C4.types.map((x) => x.k).join(' | '));
t('an XML master reads the same way (g:product_type, g:size, g:availability)', CX.types.length === 1 && CX.types[0].k === 'Tea Dresses' && eq(CX.types[0].pat, [['212', 1]]));

console.log('· product-type tiers — every master row placed on the Google feed’s own product_type tree');
// Ray, 30 Sep 2026: "can you allow tier 2, tier 3 of PT to be chosen too ? sometimes no need too much granulartiy"
const gt = (v) => String(v).replace(/>/g, '&gt;');
const FT = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>'
  + [['a1', 'GA', 'Women > Clothing > Dresses > Midi Dresses'], ['a2', 'GA', 'Women > Clothing > Dresses > Midi Dresses'], ['a3', 'GA', 'Women > Clothing > Dresses > Midi Dresses'],
     ['b1', 'GB', 'Women > Clothing > Dresses > Maxi Dresses'], ['b2', 'GB', 'Women > Clothing > Dresses > Maxi Dresses'],
     ['c1', 'GC', 'Men > Clothing > T-Shirts > Graphic T-Shirt'], ['c2', 'GC', 'Men > Clothing > T-Shirts > Graphic T-Shirt'],
     ['k1', 'GK', 'Kids > Clothing > Dresses'], ['k2', 'GK', 'Kids > Clothing > Dresses'], ['n1', 'GN', '1234']]
    .map(([id, g, pt]) => '<item><g:id>' + id + '</g:id><g:item_group_id>' + g + '</g:item_group_id><g:product_type>' + gt(pt) + '</g:product_type><g:availability>in stock</g:availability></item>').join('')
  + '</channel></rss>';
const ti = H.treeIndex(E), tp = FA.createXmlParser((r, h) => ti.onRow(r, h)); tp.push(FT); tp.end();
const TR = ti.finish();
t('the feed’s tree: g:product_type slot 1 per product, by g:id / original id / style — a category id is not a path', TR.n === 10 && TR.typed === 9 && TR.paths === 4 && TR.i.get('a1') === 'Women > Clothing > Dresses > Midi Dresses'
  && TR.o.get('c2') === 'Men > Clothing > T-Shirts > Graphic T-Shirt' && TR.g.get('gb') === 'Women > Clothing > Dresses > Maxi Dresses' && !TR.i.has('n1'), JSON.stringify({ n: TR.n, typed: TR.typed, paths: TR.paths }));
t('one string per path, however many products carry it', TR.i.get('a1') === TR.i.get('a2'));
// Superdry FR writes one type two ways ("Homme > T-Shirts" / "Homme > t-shirts", "Sweats A Capuche" / "Sweats à Capuche")
const FV = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>'
  + [['f1', 'Homme > T-Shirts > Uni'], ['f2', 'Homme > T-Shirts > Uni'], ['f3', 'Homme > t-shirts > Uni'], ['f4', 'Femme > Sweats A Capuche > Sweat'], ['f5', 'Femme > Sweats à Capuche > Sweat'], ['f6', 'Femme > Sweats à Capuche > Sweat'], ['f7', 'Femme > Pulls']]
    .map(([id, pt]) => '<item><g:id>' + id + '</g:id><g:product_type>' + gt(pt) + '</g:product_type></item>').join('')
  + '</channel></rss>';
const tv = H.treeIndex(E), pv3 = FA.createXmlParser((r, h) => tv.onRow(r, h)); pv3.push(FV); pv3.end();
const TV = tv.finish();
t('one spelling per type: case and accents are one type, under the spelling most products carry (and the re-spelled are counted)', TV.i.get('f3') === 'Homme > T-Shirts > Uni' && TV.i.get('f1') === 'Homme > T-Shirts > Uni'
  && TV.i.get('f4') === 'Femme > Sweats à Capuche > Sweat' && TV.paths === 3 && TV.fold === 2, JSON.stringify({ f3: TV.i.get('f3'), f4: TV.i.get('f4'), paths: TV.paths, fold: TV.fold }));
const MT3 = [['product_id', 'item_group_id', 'gender', 'category', 'type', 'size', 'availability']];
const put3 = (id, g, gen, cat, typ, z, av) => MT3.push([id, g, gen, cat, typ, z, av || 'in stock']);
// by id (a1-a3, b1-b2, c1-c2, k1-k2) and by style (a4, b3: the size the feed does not send, out of stock)
[['a1', '8'], ['a2', '10'], ['a3', '12']].forEach(([id, z]) => put3(id, 'GA', 'womens', 'Dresses', 'Midi', z)); put3('a4', 'GA', 'womens', 'Dresses', 'Midi', '14', 'out of stock');
[['b1', '8'], ['b2', '10']].forEach(([id, z]) => put3(id, 'GB', 'womens', 'Dresses', 'Maxi', z)); put3('b3', 'GB', 'womens', 'Dresses', 'Maxi', '12', 'out of stock');
[['c1', 'M'], ['c2', 'L']].forEach(([id, z]) => put3(id, 'GC', 'mens', 'T-Shirts', 'Tee', z));
[['k1', '3-4 years'], ['k2', '5-6 years']].forEach(([id, z]) => put3(id, 'GK', '', 'Dresses', 'Kids dress', z));
// a style the feed never sends: its master type's sent products all sit under "Women > Clothing > Dresses", split below it
[['x1', '8'], ['x2', '10'], ['x3', '12']].forEach(([id, z]) => put3(id, 'GX', 'womens', 'Dresses', 'Gown', z, 'out of stock'));
// no sent product of its type — the master's own word, where the tree has exactly one type of that name
put3('w1', 'GW', '', 'Graphic T-Shirt', '', 'L', 'out of stock');
// a word both the kids' and the women's branch use, no gender column: the run decides (ages → kids, 10 → women)
put3('y1', 'GY', '', 'Dresses', '', '7-8 years', 'out of stock'); put3('y2', 'GY2', '', 'Dresses', '', '10', 'out of stock');
// the feed has no type for it: under the feed's word for its department, else "Master only" — marked as the master's word
put3('z1', 'GZ', 'womens', 'Bralettes', '', 'S', 'in stock'); put3('z2', 'GZ2', '', 'Keyrings', '', 'M', 'in stock');
const CT = csvCensus(csv(MT3), TR);
const ck = (k) => CT.types.find((x) => x.k === k);
t('the census reads its types off the feed (src feed) and says how every row found its place', CT.src === 'feed' && CT.tree.id === 9 && CT.tree.grp === 2 && CT.tree.learn === 3 && CT.tree.word === 3 && CT.tree.own === 2 && CT.tree.fold === 0
  && CT.tree.join === 'product_id' && CT.tree.on === 'fs_data_original_id', JSON.stringify(CT.tree));
t('every row counted exactly once, on one type', CT.types.reduce((a, x) => a + x.n, 0) === MT3.length - 1 && CT.rows === MT3.length - 1);
t('by id and by style: the feed’s own leaf, the out-of-stock size included (the master’s run, not the feed’s)', eq(ck('Women > Clothing > Dresses > Midi Dresses').sz.map((z) => z[0]), ['8', '10', '12', '14']) && ck('Women > Clothing > Dresses > Midi Dresses').t === 4);
t('a style the feed never sends goes no deeper than its type’s sent products agree on (80%+): tier 3', !!ck('Women > Clothing > Dresses') && ck('Women > Clothing > Dresses').t === 3 && ck('Women > Clothing > Dresses').n === 4, CT.types.map((x) => x.k + ':' + x.n).join(' | '));
t('a master word the tree names once is placed there; a shared word goes by the run (ages → kids, 10 → women)', ck('Men > Clothing > T-Shirts > Graphic T-Shirt').n === 3 && ck('Kids > Clothing > Dresses').n === 3);
t('a type the feed has no word for: under the feed’s department, else "Master only" — and marked the master’s own (m)', ck('Women > Bralettes') && ck('Women > Bralettes').m === 1 && ck(H.MASTER_ONLY + ' > Keyrings') && ck(H.MASTER_ONLY + ' > Keyrings').m === 1
  && !ck('Women > Clothing > Dresses').m && !ck('Kids > Clothing > Dresses').m);
t('commonPath: the deepest level 80% of the sent products share, never on fewer than five', H.commonPath(new Map([['A > B > C', 4], ['A > B > D', 1]])) === 'A > B > C' && H.commonPath(new Map([['A > B > C', 3], ['A > B > D', 2]])) === 'A > B'
  && H.commonPath(new Map([['A > B', 4]])) === '' && H.commonPath(null) === '');
const CN = csvCensus(csv(MT3));
t('no tree: the master’s own types, as before (src master, no tree)', CN.src === 'master' && CN.tree === null && CN.types.some((x) => x.k === 'Women > Dresses') && !CN.types.some((x) => x.m));
const CJ = csvCensus(csv([['sku', 'size', 'category'], ['Q1', 'M', 'Tops'], ['Q2', 'L', 'Tops']]), TR);
t('a master none of whose ids or styles the feed carries falls back to its own types, never a guess', CJ.src === 'master' && CJ.types.length === 1 && CJ.types[0].k === 'Tops' && !CJ.types[0].m);
// tiers: a path cut to L levels, a shorter path its own type past its depth
const TS3 = H.tiers(CT);
t('tiers offered: every level of the tree, numbered as the tree numbers them (tier 1 = its first level)', eq(TS3.map((x) => x.t), [1, 2, 3, 4]) && eq(TS3.map((x) => x.types), [4, 5, 5, 7]) && TS3[2].ex === 'Women > Clothing > Dresses', JSON.stringify(TS3));
t('a tier only a sliver of the products reach (<1%) is not offered — they roll up into the tier above', (() => {
  const c = { types: [{ k: 'A > B', t: 2, n: 1000, sz: [['M', 1000, 1, 0]], pat: [] }, { k: 'A > B > C', t: 3, n: 5, sz: [['M', 5, 1, 0]], pat: [] }] };
  return eq(H.tiers(c).map((x) => x.t), [1, 2]);
})());
t('the tier the card opens on: the finest at which 90% of the sized products sit in at most 40 types', H.defaultTier(CT) === 4 && H.defaultTier({ types: Array.from({ length: 60 }, (_, i) => ({ k: 'Root > T' + i, t: 2, n: 10, sz: [['M', 10, 5, 5]], pat: [] })) }) === 1);
const T3 = H.tierTypes(CT, 3), DRS = T3.find((x) => x.k === 'Women > Clothing > Dresses');
t('tier 3 rolls its tier-4 types up: counts added, one ladder in size order, every stored type named', DRS && DRS.n === 4 + 3 + 4 && eq(DRS.sz.map((z) => z[0]), ['8', '10', '12', '14']) && DRS.nodes.length === 3 && DRS.t === 3
  && eq(DRS.sz.find((z) => z[0] === '10'), ['10', 4, 2, 2]), JSON.stringify(DRS && DRS.sz));
t('each style’s run re-read onto the rolled-up ladder (a style is still one style)', DRS.st === 4 && DRS.pat.reduce((a, p) => a + p[1], 0) === 4 && eq(DRS.pat.map((p) => p[0]).sort(), ['0100', '1110', '2210', '2221']), JSON.stringify(DRS.pat));
t('a rolled-up type measures exactly as its types added up', (() => {
  const hero = ['8', '10'], up = H.measure(DRS, hero), parts = DRS.nodes.map((i) => H.measure(CT.types[i], hero));
  return ['rows', 'in', 'out', 'st', 'full', 'some', 'none', 'unk'].every((k) => up[k] === parts.reduce((a, m) => a + m[k], 0));
})());
t('tier 1: the whole master in each department, nothing lost', H.tierTypes(CT, 1).reduce((a, x) => a + x.n, 0) === CT.rows && eq(H.tierTypes(CT, 1).map((x) => x.k).sort(), ['Kids', 'Master only', 'Men', 'Women']));
t('the finest types past the cap fold into their parent — never dropped (products stay counted at every coarser tier)', (() => {
  const M = [['id', 'item_group_id', 'product_type', 'size', 'availability']], F = [];
  for (let k = 0; k < H.TYPE_CAP + 20; k++) { M.push(['F' + k, 'FG' + k, 'Tops', 'M', 'in stock']); F.push('<item><g:id>F' + k + '</g:id><g:product_type>' + gt('Root > Branch' + (k % 3) + ' > Leaf ' + k) + '</g:product_type></item>'); }
  const ti2 = H.treeIndex(E), p2 = FA.createXmlParser((r, h) => ti2.onRow(r, h)); p2.push('<rss><channel>' + F.join('') + '</channel></rss>'); p2.end();
  const c = csvCensus(csv(M), ti2.finish());
  return c.types.length <= H.TYPE_CAP && c.types.reduce((a, x) => a + x.n, 0) === H.TYPE_CAP + 20 && c.tx.k === 0 && c.types.some((x) => /^Root > Branch\d$/.test(x.k));
})());

console.log('· a list set for a coarser tier reaches every finer type that sets none of its own');
const ST3 = {
  'g:Acme': { ex: 'fs-fashion-uk' },
  'm:Acme|women > clothing > dresses': { k: 'Women > Clothing > Dresses', s: ['10', '12'], src: 'set', by: 'A', at: 1 },
  'm:Acme|women > clothing > dresses > maxi dresses': { k: 'Women > Clothing > Dresses > Maxi Dresses', s: ['8'], src: 'set' },
  'm:Acme|men > clothing': { k: 'Men > Clothing', s: ['XL'], src: 'set' },
  'm:Acme|kids': { k: 'Kids', s: [], src: 'set' },
  'm:Acme|bralettes': { k: 'Bralettes', s: ['S'], src: 'doc' },
};
const CX3 = H.ctxOf(ST3, 'Acme', CT);
const hf = (k) => H.heroFor(ST3, 'Acme', CT.types.find((x) => x.k === k) || H.tierTypes(CT, 3).find((x) => x.k === k), CX3);
t('the type’s own list first', (() => { const h = hf('Women > Clothing > Dresses > Maxi Dresses'); return h.own && eq(h.s, ['8']) && !h.up; })());
t('then the nearest coarser tier that set one — named, with where it came from', (() => { const h = hf('Women > Clothing > Dresses > Midi Dresses'); return !h.own && h.dec && h.up === 'Women > Clothing > Dresses' && eq(h.s, ['10', '12']) && /\(from Women > Clothing > Dresses\)/.test(H.srcWord(h)); })());
t('a coarser list naming none of this type’s sizes does not reach it — the next source does (the example)', (() => { const h = hf('Men > Clothing > T-Shirts > Graphic T-Shirt'); return h.src === 'ex' && eq(h.s, ['M', 'L']); })());
t('"no hero sizes" recorded for a whole branch reaches every type in it, as a decision', (() => { const h = hf('Kids > Clothing > Dresses'); return h.dec && h.s.length === 0 && h.up === 'Kids'; })());
t('a list in the brand’s own words (not a path of this tree) still meets its type by the leaf', (() => { const h = hf('Women > Bralettes'); return h.own && h.how === 'leaf' && eq(h.s, ['S']); })());
t('a list set on the tree is placed EXACTLY — never leaf-matched onto another branch’s type of the same name', (() => {
  const h = H.heroFor(ST3, 'Acme', { k: 'Women > Occasion > Dresses', d: 'women', sz: [['10', 4, 2, 2], ['12', 4, 2, 2]], pat: [] }, CX3);
  return h.src === 'ex' && !h.up;
})());
const MP3 = H.map(ST3, 'Acme', CT, 3), row3 = MP3.types.find((x) => x.t.k === 'Women > Clothing > Dresses');
t('map at a tier: one row per tier-3 type, its own list, and how many types under it read a different one', MP3.types.length === T3.length && eq(row3.h.s, ['10', '12']) && row3.finer === 1, JSON.stringify({ finer: row3.finer, s: row3.h.s }));
t('a row’s figures are its types added up, each on the list that reaches IT (the maxi dresses on their own 8)', (() => {
  const want = row3.t.nodes.reduce((a, i) => { const n = CT.types[i]; return a + H.measure(n, H.heroFor(ST3, 'Acme', n, CX3).s).rows; }, 0);
  return row3.m.rows === want && row3.m.rows !== H.measure(row3.t, ['10', '12']).rows;
})());
t('the hero-stock headline is the brand’s, whatever tier is on screen', [1, 2, 3, 4, 0].every((L) => { const m = H.map(ST3, 'Acme', CT, L || undefined).sum; return m.rows === MP3.sum.rows && m.in === MP3.sum.in && m.full === MP3.sum.full; }));
t('"mapped" counts the tier on screen; an inherited list is counted as its own source (up)', MP3.sum.types === T3.length && MP3.sum.bySrc.set >= 1 && H.map(ST3, 'Acme', CT, 4).sum.bySrc.up >= 2, JSON.stringify(H.map(ST3, 'Acme', CT, 4).sum.bySrc));
t('the sheet exports the tier on screen', H.docRows(ST3, 'Acme', CT, 3).slice(1).some((r) => r[0] === 'Women > Clothing > Dresses' && r[1] === '10, 12') && !H.docRows(ST3, 'Acme', CT, 3).slice(1).some((r) => r[0] === 'Women > Clothing > Dresses > Midi Dresses'));
t('treeKeys: every path of the census at every tier (so a list on the tree is never loose)', (() => { const k = H.treeKeys(CT); return k['women'] && k['women > clothing'] && k['women > clothing > dresses > midi dresses'] && !k['bralettes']; })());

console.log('· the measure — a hero list against one type');
const MT = { k: 'Women > Dresses', sz: [['8', 10, 8, 2], ['10', 10, 6, 4], ['12', 10, 9, 1], ['14', 10, 5, 5]],
  pat: [['2222', 4], ['2122', 3], ['1111', 2], ['0330', 1], ['2000', 5]], patx: 7 };
const m1 = H.measure(MT, ['10', '12']);
t('hero-size variants: rows, in and out summed over the hero sizes only', m1.rows === 20 && m1.in === 15 && m1.out === 5 && eq(m1.hero, ['10', '12']));
t('styles: every hero size in stock (full) / some / none / stock not stated — a style never made in one is not counted', m1.st === 10 && m1.full === 4 && m1.some === 3 && m1.none === 2 && m1.unk === 1, JSON.stringify(m1));
t('styles in rarer runs the census did not keep are reported, not guessed', m1.untracked === 7 && m1.pats === true);
t('a raw size in the list is keyed first ("UK 10" and "uk10" are one size)', H.measure({ sz: [['UK 10', 4, 2, 2]], pat: [] }, ['uk10']).rows === 4);
t('no hero list = nothing measured', H.measure(MT, []).rows === 0 && H.measure(MT, []).st === 0);
t('core: the sizes nearly as many styles are made in as the most-made one (relative 80%, styles from the patterns)', eq(H.core(MT), ['8'])
  && eq(H.core({ sz: [['8', 5], ['10', 5], ['12', 5]], pat: [['111', 6], ['011', 3]] }), ['10', '12']) && eq(H.core({ sz: [['S', 3], ['M', 10], ['L', 9], ['10', 2]], pat: [] }), ['M', 'L']));

console.log('· cross-industry examples — starting points, matched by department, footwear and words');
const UK = H.EXAMPLES.find((x) => x.id === 'fs-fashion-uk'), FW = H.EXAMPLES.find((x) => x.id === 'fs-footwear'), CORE = H.EXAMPLES.find((x) => x.id === 'fs-core');
// a census type as finish() writes it: the run in size order
const ty = (k, d, sizes, fw) => ({ k, d, fw: fw ? 1 : 0, sz: H.sortSizes(sizes).map((s) => [s, 10, 5, 5]), pat: [] });
t('women’s clothing takes the women’s row: 10/12/14 and S/M/L that the type is made in', eq(H.fromExample(UK, ty('Women > Dresses', 'women', ['6', '8', '10', '12', '14', '16'])).s, ['10', '12', '14']));
t('a shoe type NEVER takes a clothing row (Monsoon’s "Heeled Shoes" once read 10/12)', eq(H.fromExample(UK, ty('Heeled Shoes', '', ['3', '4', '5', '6', '7', '8', '9', '10', '12'], 1)).s, ['5', '6', '7']));
t('a clothing type never takes a footwear row', H.fromExample(UK, ty('Women > Tops', 'women', ['4', '5', '6'])).s.length === 0);
t('a type of unknown department only takes a * row', eq(H.fromExample(UK, ty('Blouses', '', ['8', '10', '12', 'M', 'L'])).s, ['M', 'L', '10', '12']));
t('denim words pick the waist row', eq(H.fromExample(UK, ty('Men > Jeans', 'men', ['28', '30', '32', '34', '36'])).s, ['30', '32', '34']));
t('a bare size in an example meets a ladder’s "UK 5" on a shoe run', eq(H.fromExample(UK, ty('Womens > Trainers', 'women', ['UK 3', 'UK 4', 'UK 5', 'UK 6', 'UK 7'], 1)).s, ['UK 4', 'UK 5', 'UK 6']));
t('the Footwear example tells toddler / junior / youth apart by the type’s words', eq(H.fromExample(FW, ty('Girls > Girls Toddler', 'kids', ['UK 4', 'UK 5', 'UK 6', 'UK 7', 'UK 8', 'UK 9'], 1)).s, ['UK 5', 'UK 6', 'UK 7', 'UK 8'])
  && eq(H.fromExample(FW, ty('Girls > Girls Junior', 'kids', ['UK 11', 'UK 12', 'UK 13', 'UK 1', 'UK 2', 'UK 3'], 1)).s, ['UK 1', 'UK 2', 'UK 12', 'UK 13'])
  && eq(H.fromExample(FW, ty('Kids Unisex > Youth', 'kids', ['UK 2', 'UK 3', 'UK 4', 'UK 5', 'UK 6'], 1)).s, ['UK 3', 'UK 4', 'UK 5']));
t('"Core of each run" is read off the type itself', eq(H.fromExample(CORE, MT).s, H.core(MT)));
t('every example is labelled as a starting point (a note on each, "not a standard" in the engine)', H.EXAMPLES.every((x) => x.note && x.note.length > 20) && /not a standard anyone published/.test(read('docs/herosize_engine.js')));

console.log('· a brand’s guide — its own entries, then the brand it follows, then the example it follows');
const TT = ty('Women > Dresses', 'women', ['6', '8', '10', '12', '14', '16']);
const ST = {
  'g:Acme': { doc: { name: 'Acme hero sizes', url: 'https://example.com/a' }, ex: 'fs-fashion-uk', from: '' },
  'm:Acme|women > dresses': { k: 'Women > Dresses', s: ['8', '10', '12', '20'], src: 'doc', by: 'A', at: 1 },
  'm:Acme|jumpers': { k: 'Jumpers', s: ['M', 'L'], src: 'set' },
  'm:Acme|men > shorts': { k: 'Men > Shorts', s: [], src: 'set' },
  'g:Bolt': { from: 'Acme', ex: 'fs-footwear' },
  'x:acme-guide': { name: 'Acme guide', ind: 'Brand guide', rows: [{ d: 'women', fw: 0, w: 'dresse?s?', s: ['12', '14'] }] },
};
const h1 = H.heroFor(ST, 'Acme', TT);
t('its own entry wins (from its document), shown only for sizes the type is made in, the rest kept', h1.src === 'doc' && h1.own && eq(h1.s, ['8', '10', '12']) && eq(h1.all, ['8', '10', '12', '20']));
t('a document row meets the census type by its leaf ("Jumpers" → "Women > Jumpers")', H.heroFor(ST, 'Acme', ty('Women > Jumpers', 'women', ['S', 'M', 'L'])).how === 'leaf');
t('a type set to NO hero sizes is a decision, not a gap', (() => { const h = H.heroFor(ST, 'Acme', ty('Men > Shorts', 'men', ['S', 'M'])); return h.own && h.s.length === 0; })());
t('a brand that follows another takes that brand’s entry for the same type', (() => { const h = H.heroFor(ST, 'Bolt', TT); return h.src === 'brand' && h.from === 'Acme' && eq(h.s, ['8', '10', '12']); })());
t('then the example it follows', (() => { const h = H.heroFor(ST, 'Bolt', ty('Womens > Trainers', 'women', ['UK 3', 'UK 4', 'UK 5', 'UK 6'], 1)); return h.src === 'ex' && h.ex === 'fs-footwear' && eq(h.s, ['UK 4', 'UK 5', 'UK 6']); })());
t('nothing fits = not mapped, no sizes — never a guessed list', (() => { const h = H.heroFor({}, 'Nobody', TT); return h.src === '' && h.s.length === 0; })());
t('a saved team example is one more example (examplesOf) and is found by id', H.examplesOf(ST).some((x) => x.id === 'acme-guide' && x.saved) && H.exampleById(ST, 'acme-guide').name === 'Acme guide');
t('an ambiguous leaf (two departments) matches nothing', H.entryFor({ 'women > jackets': { k: 'Women > Jackets', s: ['10'] }, 'men > jackets': { k: 'Men > Jackets', s: ['M'] } }, { k: 'Jackets', d: '' }) === null);
const MP = H.map(ST, 'Acme', { types: [TT, ty('Men > Shorts', 'men', ['S', 'M']), ty('Kids > Coats', 'kids', ['3-4 YRS', '5-6 YRS']), { k: 'Women > Bags', sz: [], pat: [] }] });
t('the card’s sum: a decided "no hero sizes" type counts as mapped; a one-size type is not a sized type', MP.sum.sized === 3 && MP.sum.mapped === 3 && MP.sum.bySrc.doc === 1 && MP.sum.bySrc.set === 1 && MP.sum.bySrc.ex === 1, JSON.stringify(MP.sum));

console.log('· a brand’s document — imported, and exported as the template');
const D1 = H.parseDoc([['Acme — hero sizes 2026'], [], ['Product type', 'Hero sizes', 'Notes'], ['Womenswear > Dresses', '8, 10; 12', 'core'], ['Jeans', '26|27|28', ''], ['Womenswear > Dresses', '14', 'second row'], ['Bags', 'One Size', ''], ['View All', 'M', '']]);
t('the header is found below a title row (blank rows dropped first); sizes split on , ; | and keyed', D1.layout === 'column' && D1.header === 1 && D1.rows[0].k === 'Womenswear > Dresses' && eq(D1.rows.find((r) => r.k === 'Womenswear > Dresses').s, ['8', '10', '12', '14']) && eq(D1.rows.find((r) => r.k === 'Jeans').s, ['26', '27', '28']));
t('one-size and merchandising rows are not hero entries', D1.rows.find((r) => r.k === 'Bags').s.length === 0 && !D1.rows.some((r) => r.k === 'View All'));
const D2 = H.parseDoc([['Category', '', '', ''], ['Men > Shirts', 'M', 'L', 'XL'], ['Women > Tops', 'S', 'Medium']]);
t('or one size per cell after the type', D2.layout === 'cells' && eq(D2.rows[0].s, ['M', 'L', 'XL']) && eq(D2.rows[1].s, ['S', 'M']));
const DOCROWS = H.docRows(ST, 'Acme', { types: [TT] });
t('the export: product type, hero sizes, source, sizes made in — the file the import reads back', eq(DOCROWS[0], ['Product type', 'Hero sizes', 'Source', 'Sizes made in']) && DOCROWS[1][1] === '8, 10, 12' && DOCROWS[1][2] === 'Brand document'
  && eq(H.parseDoc(DOCROWS).rows[0].s, ['8', '10', '12']));
const XB = H.exampleFromBrand({ 'm:Acme|men > t-shirts': { k: 'Men > T-Shirts', s: ['M', 'L'], fw: 0 }, 'm:Acme|women > hoodies and sweatshirts': { k: 'Women > Hoodies and Sweatshirts', s: ['10', '12'] } }, 'Acme');
t('a brand’s own entries become an example another brand follows by the SAME leaf (any separator)', eq(H.fromExample(XB, ty('Mens > T Shirts', 'men', ['S', 'M', 'L', 'XL'])).s, ['M', 'L'])
  && eq(H.fromExample(XB, ty('Women > Hoodies & Sweatshirts', 'women', ['8', '10', '12'])).s, ['10', '12']));
t('leafWords: one phrase, an "and" that may be "&" or absent, never more than a dozen marks', H.leafWords('T-Shirts') === 'ts?\\W+shirts?' && H.leafWords('Hoodies and Sweatshirts') === 'hoodies?\\W+ands?\\W+sweatshirts?|hoodies?\\W+sweatshirts?'
  && (H.leafWords('one two three four five six seven eight') .match(/\?/g) || []).length <= 12 && new RegExp(H.leafWords('one two three four five six seven eight')).test('ones two three four five six seven eights'));
t('a saved example is accepted by the worker as written (its words pass the fragment check)', !HW.sanitizeHeroKey('x:acme-guide', XB, { brands: [], inScope: () => true, canEx: true, by: 'A', now: 1 }).error);

console.log('· the worker’s half (src/herosizes.js)');
t('ONE census shape: the engine and the worker hold the same CENSUS_V', HW.CENSUS_V === H.CENSUS_V);
const SC = HW.sanitizeCensus(C1);
t('the engine’s own census is stored as read (types, runs, patterns)', SC && SC.types.length === C1.types.length && eq(SC.types[0].sz, C1.types[0].sz) && eq(SC.types[0].pat, C1.types[0].pat) && SC.cols.pt === 'category');
t('a census of another shape is refused whole', HW.sanitizeCensus(Object.assign({}, C1, { v: 99 })) === null && HW.sanitizeCensus({ v: 1 }) === null && HW.sanitizeCensus(null) === null && HW.sanitizeCensus(Object.assign({}, C1, { v: 2 })) === null);
const SCT = HW.sanitizeCensus(CT);
t('a census on the feed’s tree is stored whole: where its types came from, each type’s depth, the master-only mark', SCT && SCT.src === 'feed' && eq(SCT.tree, CT.tree) && SCT.types.every((x, i) => x.t === CT.types[i].t && !!x.m === !!CT.types[i].m) && SCT.types.length === CT.types.length);
t('…and a census with no tree says so (src master, tree null) — a "feed" source with no tree is not believed', HW.sanitizeCensus(CN).src === 'master' && HW.sanitizeCensus(CN).tree === null && HW.sanitizeCensus(Object.assign({}, CN, { src: 'feed' })).src === 'master');
t('the census keeps up to the engine’s TYPE_CAP finest types', (() => { const c = JSON.parse(JSON.stringify(CT)); while (c.types.length < H.TYPE_CAP + 3) c.types.push(Object.assign({}, c.types[0], { k: 'Pad ' + c.types.length })); return HW.sanitizeCensus(c).types.length === H.TYPE_CAP; })());
const bad = (f) => { const c = JSON.parse(JSON.stringify(C1)); f(c); return HW.sanitizeCensus(c); };
t('a pattern that does not fit its run, in + out above rows, or a size nobody writes → refused', bad((c) => { c.types[0].pat[0][0] += '2'; }) === null && bad((c) => { c.types[0].sz[0][2] = 999; }) === null
  && bad((c) => { c.types[0].sz[0][0] = '<script>'; }) === null && bad((c) => { c.types[0].pat[0][0] = c.types[0].pat[0][0].replace(/./, '9'); }) === null);
t('the one-line summary the index carries', eq(HW.censusSummary(SC, 5), { t: 5, types: SC.types.length, sized: SC.sized, rows: SC.rows, groups: SC.groups, v: HW.CENSUS_V }));
const CTX = { brands: ['Acme', 'Bolt'], inScope: (b) => b === 'Acme', canEx: true, by: 'Ray', now: 42 };
const K = (k, v, c) => HW.sanitizeHeroKey(k, v, c || CTX);
t('a guide: stamped by and at on the server, the document link must be https', eq(K('g:Acme', { doc: { name: 'Doc', url: 'https://example.com/x' }, ex: 'fs-fashion-uk' }).value, { doc: { name: 'Doc', url: 'https://example.com/x' }, ex: 'fs-fashion-uk', from: '', note: '', by: 'Ray', at: 42 })
  && !!K('g:Acme', { doc: { name: 'Doc', url: 'http://example.com/x' } }).error && !!K('g:Acme', { doc: { url: 'javascript:alert(1)' } }).error);
t('scope: a signin writes only its own brands; only roster brands; a brand never follows itself', !!K('g:Bolt', { ex: '' }).error && !!K('g:Nobody', { ex: '' }).error && !!K('g:Acme', { from: 'Acme' }).error && !K('g:Acme', { from: 'Bolt' }).error);
t('a type entry: a lower-case key, sizes as written, a known source', !K('m:Acme|women > dresses', { k: 'Women > Dresses', s: ['10', '12'], src: 'doc' }).error && !!K('m:Acme|Women > Dresses', { s: [] }).error
  && !!K('m:Acme|x', { s: ['<b>'] }).error && K('m:Acme|x', { s: ['M', 'M'], src: 'weird' }).value.src === 'set' && eq(K('m:Acme|x', { s: ['M', 'M'] }).value.s, ['M']));
t('examples: FeedSpark’s own are read-only; saving needs the stock grant; words are a checked fragment', !!K('x:fs-fashion-uk', { name: 'x', rows: [] }).error && !!K('x:team-one', { name: 'T', rows: [{ d: '*', s: ['M'] }] }, Object.assign({}, CTX, { canEx: false })).error
  && !!K('x:team-one', { name: 'T', rows: [{ d: '*', w: '(a+)+$', s: ['M'] }] }).error && !!K('x:team-one', { name: 'T', rows: [{ d: '*', w: 'a?'.repeat(13), s: ['M'] }] }).error
  && !K('x:team-one', { name: 'T', rows: [{ d: 'women', w: 'dresse?s?\\W+mini', s: ['10'] }] }).error);
t('unknown keys are refused; null deletes', !!K('z:Acme', {}).error && K('m:Acme|x', null).value === null);
const PUT = HW.sanitizeHeroPut({ 'm:Acme|a': { s: ['M'] }, 'g:Acme': null, _deleted: ['m:Acme|b'] }, CTX);
t('a PUT: every key checked, deletions from null and _deleted, nothing written unless all pass', PUT.errors.length === 0 && eq(Object.keys(PUT.data), ['m:Acme|a']) && eq(PUT.deleted.sort(), ['g:Acme', 'm:Acme|b'])
  && HW.sanitizeHeroPut({ 'm:Bolt|a': { s: ['M'] } }, CTX).errors.length === 1 && HW.sanitizeHeroPut([], CTX).errors.length === 1);
t('reading: every example, and only the guides of brands in scope', eq(Object.keys(HW.heroView({ 'g:Acme': {}, 'm:Acme|a': {}, 'g:Bolt': {}, 'm:Bolt|a': {}, 'x:t': {} }, (b) => b === 'Acme')).sort(), ['g:Acme', 'm:Acme|a', 'x:t']));
t('the brand list says which have a document, what they follow and how many types are their own', eq(HW.guideBrands(ST, ['Acme', 'Bolt']), [{ client: 'Acme', doc: true, ex: 'fs-fashion-uk', from: '', own: 3, fromDoc: 1 }, { client: 'Bolt', doc: false, ex: 'fs-footwear', from: 'Acme', own: 0, fromDoc: 0 }]));

console.log('· held back — in stock in the master, not live in the Google feed');
const FEED = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0" xmlns:c="http://example.com/c"><channel>'
  + [['P1', 'in stock'], ['P2', 'in stock'], ['P4', 'out of stock'], ['P7', 'preorder']].map(([id, av]) => '<item><g:id>' + id.toLowerCase() + '-gb</g:id><title>t</title><g:availability>' + av + '</g:availability><c:fs_data_original_id>' + id + '</c:fs_data_original_id></item>').join('')
  + '</channel></rss>';
const fi = E.feedIndex(), fp = FA.createXmlParser(fi.onRow); fp.push(FEED); fp.end();
const FI = fi.finish();
t('the feed index: every product by g:id and by fs_data_original_id, with its availability; pre-order is live', FI.n === 4 && FI.live === 3 && FI.o.get('p4') === 'out' && FI.i.get('p1-gb') === 'in');
const MM = [['product_id', 'item_group_id', 'title', 'size', 'availability', 'quantity'],
  ['P1', 'G1', 'Tee', 'M', 'IN_STOCK', '3'], ['P2', 'G1', 'Tee', 'L', 'IN_STOCK', '1'], ['P3', 'G1', 'Tee', 'XL', 'IN_STOCK', '2'], ['P9', 'G1', 'Tee', 'S', 'NOT_AVAILABLE', '0'],
  ['P4', 'G2', 'Coat', '10', '', '5'], ['P5', 'G2', 'Coat', '12', 'out of stock', ''], ['P6', 'G2', 'Coat', '14', '', ''], ['P7', 'G3', 'Boot', 'UK 5', 'IN_STOCK', '']];
const hb = E.heldBack(FI), mp = E.delimParser(',', (r) => hb.onRow(r)); mp.push(csv(MM)); mp.end();
const HB = hb.finish();
t('the join is found by the ids the feed was built from (fs_data_original_id on product_id)', HB.ok && HB.join.h === 'product_id' && HB.join.on === 'fs_data_original_id');
t('held = in stock in the master AND not live in the feed: absent (P3) or sent out of stock (P4, a quantity with no word)', eq(HB.held.map((h) => h.id + ':' + h.why), ['P4:out', 'P3:absent']) && HB.absent === 1 && HB.out === 1, JSON.stringify(HB.held));
t('in stock in the feed or pre-ordered is live; not stated in the master is never held', !HB.held.some((h) => ['P1', 'P2', 'P6', 'P7'].indexOf(h.id) >= 0) && HB.inStock === 5 && HB.stated === 7);
t('each held product carries its style’s range completion — sizes in stock of sizes made, in the master', (() => { const p3 = HB.held.find((h) => h.id === 'P3'), p4 = HB.held.find((h) => h.id === 'P4'); return p3.rcIn === 3 && p3.rcN === 4 && p3.rc === 75 && p4.rcIn === 1 && p4.rcN === 2 && p4.rc === 50; })());
t('the lowest range completion first', HB.held[0].rc <= HB.held[1].rc);
t('every in-stock product counted by its style’s range completion, held and live apart (rcH — rules.js › rcLine reads the line off it)', JSON.stringify(HB.rcH) === JSON.stringify([[50, 1, 0], [75, 1, 2], [100, 0, 1]]), JSON.stringify(HB.rcH));
t('title, size, the master’s own word and quantity travel with each row', (() => { const p = HB.held.find((h) => h.id === 'P3'); return p.t === 'Tee' && p.s === 'XL' && p.av === 'IN_STOCK' && p.q === '2' && p.g === 'G1'; })());
const hb2 = E.heldBack(FI), mp2 = E.delimParser(',', (r) => hb2.onRow(r)); mp2.push(csv([['sku', 'title'], ['Z1', 'x'], ['Z2', 'y']])); mp2.end();
t('a master whose columns carry none of the feed’s ids is refused, never joined on a guess', hb2.finish().ok === false);

console.log('· the agent, the route, the page');
const MS = await import('./master_stock.mjs');
const zip1 = (name, data) => {
  const comp = deflateRawSync(data), n = Buffer.from(name), crc = 0;
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(0, 42);
  const off = lh.length + n.length + comp.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(ch.length + n.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([lh, n, comp, ch, n, end]));
};
const TM = MS.tallyMaster(zip1('m.csv', Buffer.from(csv(M1))));
t('the agent builds the census on the SAME pass as the stock tally (zipped CSV)', TM.n === M1.length - 1 && TM.census && TM.census.types.length === C1.types.length && eq(TM.census.types[0].sz, C1.types[0].sz));
t('its one-line log names where the types came from, the tiers, sized rows, styles and the biggest run', /the master’s own product types · tiers 1:\d+ .* sized rows · .* styles · biggest: /.test(MS.sizeLine(TM.census)));
const TMT = MS.tallyMaster(zip1('m.csv', Buffer.from(csv(MT3))), MS.treeFromText(FT));
t('the agent places the census on the Google feed’s tree when it has one (the SAME census the engine builds)', TMT.census.src === 'feed' && eq(TMT.census.tree, CT.tree) && /the Google feed’s product types \(by id 9 · style 2 · master type 6 · master only 2\) · tiers 1:4 2:5 3:5 4:7/.test(MS.sizeLine(TMT.census)), MS.sizeLine(TMT.census));
const GF = MS.googleFeeds();
t('the agent finds each roster market’s Google Shopping feed by company id (45 of 57 today), never a Meta feed', ROAS.rosterList().filter((m) => GF[m.cmpid]).length >= 40 && Object.keys(GF).every((c) => !/-fb$/.test(GF[c].mkt) && /^https:\/\/[a-z0-9.-]*feedhero\.net\//.test(GF[c].url)));
t('the agent reads the feed before its master, streamed, and a feed it cannot read never costs the master', /fd = await readFeed\(feeds\[m\.cmpid\]\.url\)/.test(AG) && /catch \(e\) \{ console\.log\('~ ' \+ tag \+ ' — Google feed not read/.test(AG) && /tallyMaster\(got\.bytes, fd && fd\.tree, fd && fd\.idx\)/.test(AG)
  && /for await \(const chunk of r\.body\)/.test(AG) && AG.indexOf('readFeed(feeds[m.cmpid].url)') < AG.indexOf('tallyMaster(got.bytes, fd && fd.tree, fd && fd.idx)'));
t('the census posts on its own ({mastersize}), one market a post, BEFORE the counts; szv only when stored', /post\(\{ mastersize: \[\{ cmpid: m\.cmpid, imp: got\.imp, census: t\.census \}\] \}\)/.test(AG) && /szv: sz \? H\.CENSUS_V : 0, sz, hbv: /.test(AG) && AG.indexOf('mastersize') < AG.indexOf('post({ masterstock'));
t('worker: the {mastersize} lane checks the roster, validates whole, one key per market', /Array\.isArray\(body\.mastersize\)/.test(WK) && /HERO\.sanitizeCensus\(e && e\.census\)/.test(WK) && /env\.EDITS\.put\('mastersize:' \+ cmpid/.test(WK) && /ROAS\.cmpidBrand\(cmpid\)/.test(WK));
t('worker: "unchanged" only when the counts AND the census are of this import and this shape, and read within the day (the feed’s tree moves on its own)', /have\.imp === rec\.lastImport && have\.szv === HERO\.CENSUS_V && have\.hbv === RULES\.HELD_V && Date\.now\(\) - \(have\.t \|\| 0\) < HERO\.CENSUS_FRESH_MS/.test(WK) && /idx\[cmpid\]\.szv = HERO\.CENSUS_V/.test(WK) && HW.CENSUS_FRESH_MS === 20 * 3600 * 1000);
t('worker: GET/PUT /api/rules/hero — scoped, the kvmerge envelope with explicit tombstones, logged', /path === '\/api\/rules\/hero'/.test(WK) && /HERO\.sanitizeHeroPut\(body, hctx\)/.test(WK) && /explicitTombstones: true/.test(WK)
  && /HERO\.heroView\(/.test(WK) && /logActivity\(ctx, env, request, 'hero-guide'/.test(WK) && /'X-Sync-Base': String\(Date\.now\(\)\)/.test(WK));
t('worker: no brand asked for = the first in scope with a census, flagged auto', /brand = mine\.find\(hasCensus\) \|\| ''; out\.auto = !!brand;/.test(WK));
t('worker: the engine is served verbatim at /stock/engine.js (a Text module by the *_engine.js rule)', /path === '\/stock\/engine\.js'/.test(WK) && /import HEROSIZE_ENGINE_SRC from "\.\.\/\.\.\/\.\.\/docs\/herosize_engine\.js"/.test(WK));
t('worker: each stock market carries its wired keys (wk) for the held-back download', /wk: \{ g: k\.g \? k\.g\.split\('\|'\)\[1\] : null/.test(WK));
t('page: the hero card, its engine, the guide store with a read-stamp, edits kept until the server confirms', /id="hmap-card"/.test(SP) && /fetch\('\/stock\/engine\.js'/.test(SP) && /'X-Sync-Base': String\(HM\.base \|\| 0\)/.test(SP) && /function hmReapply\(\)/.test(SP) && /HS\.map\(HM\.store, b, cen, tier\)/.test(SP));
t('page: a PT tier control — every tier the census offers, the count of types on each, the card’s own default until one is picked', /id="hm-tiers" role="group"/.test(SP) && /HS\.tiers\(cen\), tier = hmTier\(cen\)/.test(SP) && /HS\.defaultTier\(cen\)/.test(SP)
  && /'">Tier ' \+ x\.t \+ ' <span class="k">' \+ n0\(x\.types\) \+ '<\/span><\/button>'/.test(SP) && /\$\('#hm-tw2'\)\.hidden = ts\.length < 2;/.test(SP));
t('page: the tier is remembered per brand on this device (never shared — a list set at a tier is what the team shares)', /recall\('fcc-stock-hmtier'\)/.test(SP) && /remember\('fcc-stock-hmtier', JSON\.stringify\(m\)\)/.test(SP) && /m\[hmBrand\(\)\] = t;/.test(SP));
t('page: an inherited list says so (⤴ Tier N, where it came from in its tooltip); a row whose types read different lists says how many', /'">⤴ Tier ' \+ h\.up\.split\(' > '\)\.length \+ '<\/span>'/.test(SP) && /' types under it set their own'/.test(SP) && /function hmUp\(h\)/.test(SP));
t('page: the type’s own level in bold, its tiers above on the line under; a master-only type and a type that goes no finer are named', /var parts = t\.k\.split\(' > '\), leaf = parts\.pop\(\);/.test(SP) && />master type<\/span>/.test(SP) && />no finer type<\/span>/.test(SP) && /parts\[0\] === HS\.MASTER_ONLY/.test(SP));
t('page: figures whenever a list reaches any of the row’s types (not only its own)', /'<td class="num">' \+ \(m\.rows \? hmPcCell\(m\.in, m\.rows/.test(SP));
t('page: the import matches every tier’s types; the sheet exports the tier on screen', /HS\.tiers\(cen\)\.forEach\(function \(x\) \{ HS\.tierTypes\(cen, x\.t\)/.test(SP) && /HS\.docRows\(HM\.store, b, hmCensus\(\), hmTier\(hmCensus\(\)\)\)/.test(SP));
t('page: the note says where the types came from — the feed’s tree, how the master was placed on it, and the spellings read as one', /Product types are the Google Shopping feed’s own product_type tree: /.test(SP) && /Product types are the master’s own — no Google Shopping feed was read/.test(SP)
  && /the feed spells two ways \(case or accents\) read as one\./.test(SP));
t('page: import through the document parser, export through the sheet writer', /HS\.parseDoc\(rows\)/.test(SP) && /X\.download\(\[\{ name: 'Hero sizes'/.test(SP) && /accept="\.csv,\.xlsx,\.tsv,\.txt"/.test(SP));
t('page: the held-back list reads the Google feed and the master through the worker and joins them in the engine', /fetch\('\/api\/feed\/proxy' \+ q/.test(SP) && /fetch\('\/api\/catalog\/master\/file' \+ q/.test(SP) && /E\.feedIndex\(\)/.test(SP) && /E\.heldBack\(feed\)/.test(SP));
t('page: once per market, beside its held-back count, and in the panel; the CSV says what each row is', /hbBtn\(m, 'hb-dl'\) \+ n0\(h\.n\)/.test(SP) && /hbBtn\(m, 'btn'\)/.test(SP) && /'style range completion %', 'google feed'\]/.test(SP) && /_held_back_products\.csv/.test(SP));
t('page: the crown only ever marks a hero size', (SP.match(/class="sz hero"/g) || []).length === 1 && /\(on \? heroIcon\(\) : ''\)/.test(SP));

console.log('· the tripwire stub, the wiring, nothing committed');
const RS = require('./rules_stub.js'), RB = RS.build();
t('the stub builds its census with the REAL engine and serves the engine to the page', RB.hero && RB.hero.census.v === H.CENSUS_V && RB.hero.census.types.some((x) => x.fw) && /\/stock\/engine\.js/.test(RS.stubLines()) && /\/api\/rules\/hero/.test(RS.stubLines()));
t('the stub’s markets carry their wired keys', RB.stock.markets.every((m) => m.wk && 'g' in m.wk));
t('the stub’s census rides a synthetic Google feed tree: four tiers, a list set for a tier-2 branch, a master-only type', RB.hero.census.src === 'feed' && H.tiers(RB.hero.census).length >= 4 && RB.hero.census.types.some((x) => x.m)
  && H.map(RB.hero.store, 'Superdry', RB.hero.census, 3).types.some((x) => x.h.up === 'Men > Clothing'));
t('harness wired into qa_gate, presync and validate', /test_herosize\.mjs/.test(read('tools/qa_gate.sh')) && /test_herosize\.mjs/.test(read('tools/presync.sh')) && /test_herosize\.mjs/.test(read('.github/workflows/validate.yml')));
let tracked = '';
try { tracked = execSync('git ls-files', { cwd: new URL('..', import.meta.url).pathname }).toString(); } catch (e) { tracked = ''; }
t('no census or guide is committed (KV only)', !/mastersize|heroguide.*\.json|held_back_products/.test(tracked));
t('the examples name no client', !/superdry|reiss|schuh|monsoon|accessorize|hobbycraft|yumove/i.test(JSON.stringify(H.EXAMPLES)));
t('the roster brands the route checks exist', Object.keys(ROAS.ROAS_ROSTER).length >= 7);

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed');
process.exit(fail ? 1 : 0);
