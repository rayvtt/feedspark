#!/usr/bin/env node
/* Golden Record — the META CATALOGUE audit engine (labelguard.js metaStream / metaScore / cleanMeta) and its wiring.
   Ray, 9 Oct 2026: "in golden record - let's also add in Meta audit as well (areas such as Title for Meta should be < 60
   characters) - Imagery (if there's overlay being used on Meta feed) divide a new section just on Meta alone".
   Rules are Meta's own catalogue field reference; the 60-character title is FeedSpark's standard and must say so.
   Run: node tools/test_metaaudit.mjs */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LG = await import(pathToFileURL(path.join(ROOT, 'cloudflare/feedspark-deck/src/labelguard.js')).href);
const OV = createRequire(import.meta.url)(path.join(ROOT, 'docs/overlay_engine.js'));
let fail = 0, n = 0;
const ok = (name, c, x) => { n++; if (c) console.log('   ✓ ' + name); else { fail++; console.log('   ✗ ' + name + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 400) : '')); } };

const H = ['g:id', 'g:title', 'g:description', 'g:availability', 'g:condition', 'g:price', 'g:sale_price', 'g:link', 'g:image_link', 'g:additional_image_link', 'g:brand'];
const row = (o) => H.map((h) => o[h.slice(2)] == null ? '' : o[h.slice(2)]);
const base = { id: 'A1', title: 'Linen Shirt', description: 'A relaxed linen shirt with a camp collar.', availability: 'in stock', condition: 'new', price: '79.00 GBP', link: 'https://x.example/p/1', image_link: 'https://cdn.example/1.jpg', brand: 'Northwind' };
function run(rows, classify) {
  const s = LG.metaStream({ client: 'Northwind', market: 'gb-fb', classify });
  s.onRow(H.slice());
  rows.forEach((r) => s.onRow(row(Object.assign({}, base, r))));
  return s.finish();
}

console.log('── the rules, one product at a time');
const ovl = 'https://dashboard.feedspark.com/image-creator/northwind/image_process_products_lifestyle.php?img_url_left=https%3A%2F%2Fcdn.example%2Fa.jpg&img_url_right=https%3A%2F%2Fcdn.example%2Fb.jpg';
const m = run([
  {}, // clean
  { id: 'A2', title: 'Northwind Relaxed Fit Linen Shirt in Washed Sage Green for Summer Days' },   // > 60
  { id: 'A3', title: 'x'.repeat(205) },                                                           // > 200 (and > 60)
  { id: 'A4', title: 'LINEN SHIRT SALE NOW' },                                                    // caps + promo
  { id: 'A5', description: '<p>Relaxed</p> shirt' },
  { id: 'A6', description: 'See https://x.example for more' },
  { id: 'A7', title: 'Same words here', description: 'Same words here' },
  { id: 'A8', availability: 'in_stock' },                                                        // underscore form reads as the word
  { id: 'A9', availability: 'available', condition: 'mint' },
  { id: 'A10', price: '£79' },
  { id: 'A11', sale_price: '99.00 GBP' },
  { id: 'A12', sale_price: '59.00 GBP' },
  { id: 'A13', image_link: ovl, additional_image_link: 'https://cdn.example/2.jpg,https://cdn.example/3.jpg' },
  { id: 'A14', link: 'www.example/p' , brand: '' },
  { id: 'A1' },                                                                                     // duplicate of the first
], OV.classifyOverlay);
const hit = (id) => (m.rules[id] || { n: 0 }).n;
ok('rows counted, header not', m.rows === 15, m.rows);
ok('over 60 characters (FeedSpark standard): the 72- and 205-character titles', hit('t-house') === 2, hit('t-house'));
ok('over Meta’s 200 limit: one', hit('t-max') === 1);
ok('capitals for emphasis and promotional wording in a title', hit('t-caps') === 1 && hit('t-promo') === 1, [hit('t-caps'), hit('t-promo')]);
ok('HTML, a link, the title repeated — each in the description', hit('d-html') === 1 && hit('d-link') === 1 && hit('d-same') === 1);
ok('availability: “in_stock” is the word; “available” is not', hit('v-avail') === 1);
ok('condition outside new / refurbished / used', hit('v-cond') === 1);
ok('price with a symbol and no ISO code', hit('v-price') === 1);
ok('sale price at or above the price; one below passes', hit('v-sale') === 1);
ok('a link that is not http(s)', hit('l-link') === 1);
ok('a repeated ID counts both instances', hit('v-id') === 2, hit('v-id'));
ok('brand filled on all but one', m.fields.brand.n === 14 && m.fields.brand.col === true, m.fields.brand);
ok('the overlay is read off the URL, typed by the Overlays engine', m.img.overlay === 1 && m.img.types[0] && /split/i.test(m.img.types[0].label) && m.img.types[0].family === 'image-creator', m.img);
ok('additional images averaged over every product, none counted', m.img.avgMore === Math.round((2 / 15) * 10) / 10 && m.img.noMore === 14, m.img);
ok('examples kept with the product id', m.rules['v-price'].ex[0].id === 'A10' && m.rules['v-price'].ex[0].v === '£79');
const plain = run([{ image_link: ovl }]);
ok('without the Overlays engine the FeedSpark image host alone still names an overlay', plain.img.overlay === 1 && plain.img.types[0].label === 'FeedSpark overlay');

console.log('── the score');
const sc = LG.metaScore(m);
ok('five areas weighted 3/2/1/1/1, the score their weighted mean', sc.areas.map((a) => a.w).join() === '3,2,1,1,1' &&
  Math.abs(sc.score - Math.round(sc.areas.reduce((t, a) => t + a.score * a.w, 0) / 8 * 10) / 10) < 0.11, sc.areas);
ok('broken rules sorted by cost, the house rule marked as ours', sc.broken[0].cost >= sc.broken[sc.broken.length - 1].cost && sc.broken.find((b) => b.id === 't-house').house === true);
const clean = LG.metaScore(run([{}, { id: 'B2' }]));
ok('a clean catalogue scores 100', clean.score === 100, clean);
const nocol = LG.metaScore({ rows: 10, fields: { id: { col: true, n: 10 } }, rules: {}, img: {} });
ok('a required field missing from the feed costs its share of the required area', nocol.areas[0].score === Math.round((100 / 9) * 10) / 10 && nocol.req.find((f) => f.k === 'brand').col === false, nocol.areas[0]);
ok('nothing read is no score, never zero', LG.metaScore(null) === null && LG.metaScore({ rows: 0 }) === null);

console.log('── what the worker keeps');
const c = LG.cleanMeta(Object.assign({}, m, { rules: Object.assign({}, m.rules, { evil: { n: 5 } }), junk: 1 }));
ok('unknown rule ids and keys dropped', c && !c.rules.evil && !c.junk && c.rules['t-house'].n === 2);
ok('counts clamped to the rows read', LG.cleanMeta({ rows: 10, rules: { 't-house': { n: 999 } } }).rules['t-house'].n === 10);
ok('a reading with no rows is refused', LG.cleanMeta({ rows: 0 }) === null && LG.cleanMeta(null) === null);
ok('only https example image addresses kept', LG.cleanMeta({ rows: 3, img: { types: [{ label: 'x', n: 1, eg: [{ id: 'a', url: 'javascript:alert(1)' }] }] } }).img.types[0].eg[0].url === '');

console.log('── wiring');
const W = fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');
const P = fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_GoldenRecord.html'), 'utf8');
ok('the worker serves GET/PUT /api/golden/meta, stored under the Meta feed’s key, through cleanMeta', /path === '\/api\/golden\/meta'/.test(W) && /'goldenmeta:' \+ client \+ ':' \+ fb/.test(W) && /cleanMeta\(b\)/.test(W));
ok('…refuses a Meta market as the page market (the page asks with the Google one)', /\/api\/golden\/meta'\) \{\s*if \(badClient \|\| isFb\)/.test(W));
ok('the page streams the -fb market and renders the section after the custom labels', /market=' \+ encodeURIComponent\(fb\)/.test(P) && /h \+= clSection\(k\);[^\n]*\n\s*h \+= metaSection\(k\);/.test(P));
ok('the export removes the Meta controls', /'#mt-run', '#mt-msg', '#mt-scan', '\.mt-act'/.test(P));
ok('the action plan reads the Meta score', /planBuild\(s\.attrs, prof, qd, ai, clr, mtr\)/.test(P));
ok('the served engine copy is byte-identical', fs.readFileSync(path.join(ROOT, 'docs/labelguard_engine.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/labelguard.js'), 'utf8'));
ok('the 60-character rule is labelled FeedSpark’s, Meta’s 65 and 200 quoted', /FeedSpark’s standard for Meta/.test(LG.META_RULES[0].why) && /65/.test(LG.META_RULES[0].why) && LG.META_TITLE_HOUSE === 60);

console.log(fail ? '\n✗ ' + fail + ' of ' + n + ' failed' : '\n✓ ' + n + ' Meta catalogue assertions');
process.exit(fail ? 1 : 0);
