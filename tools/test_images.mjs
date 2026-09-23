#!/usr/bin/env node
/* Image Library engine harness — pins the shot-token reading Ray's ask turns on (the brand
 * can't say which image is flat-lay and which is on-model, so the URL has to), the slot
 * model (image_link + additional_image_link 1..10), the grouping choice and the honest
 * refusal on feeds whose filenames carry no convention. Runs in qa_gate + validate.yml.
 *   node tools/test_images.mjs
 * Optional: IMAGE_FIXTURE=/path/to/feed.xml streams a real export through
 * FeedAudit.createXmlParser + the collector and prints the summary (never asserted). */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const I = require('../docs/image_engine.js');
const FA = require('../docs/feedlab_engine.js');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };

/* Real URL shapes, taken from the live feeds on 15 Sep 2026 — every retailer encodes the
 * shot differently, which is the whole reason the token is DIFFERENCED rather than parsed. */
const MON = (p, sku, n) => `https://www.monsoon.co.uk/on/demandware.static/-/Sites-monsoon-master-catalog/default/dw37d80ee1/images/large/${p}_${sku}_${n}.jpg`;
const SCH = (sku, v) => `https://d2ob0iztsaxy5v.cloudfront.net/product/834100/${sku}${v}_zm.jpg?v=20251811`;
const REI = (sku, n) => `https://xcdn.next.co.uk/common/items/default/default/itemimages/3_4Ratio/product/lge/${sku}${n}.jpg?v=141025`;
const SUP = (id) => `http://images.laguna-live.sd.co.uk/upload922336895566${id}.jpg?format=jpg&width=658`;

console.log('· filename stem — the query string never decides the shot');
t('cache-buster stripped', I.fileStem(REI('Y76182s', '2')) === 'Y76182s2', I.fileStem(REI('Y76182s', '2')));
t('extension stripped, path segment kept', I.fileStem('https://x/a/b/01_999_1.jpg') === '01_999_1');
t('render params stripped', I.fileStem(SUP('524368')) === 'upload922336895566524368');
t('empty / null safe', I.fileStem('') === '' && I.fileStem(null) === '' && I.shotTokens([]).length === 0);

console.log('· shot tokens — Monsoon (Demandware: the code is the filename PREFIX)');
{
  const u = [MON('01', '20001600003', 1), MON('21', '20001600003', 1), MON('22', '20001600003', 1), MON('24', '20001600003', 1)];
  const k = I.shotTokens(u);
  t('one token per image, in feed order', k.length === 4);
  t('the varying prefix is the token', JSON.stringify(k) === '["01","21","22","24"]', JSON.stringify(k));
  t('the SKU never leaks into the token', !k.some((x) => /20001600003/.test(x)));
}
console.log('· shot tokens — Accessorize (prefix AND index move together)');
{
  const k = I.shotTokens([MON('01', '30005360022', 1), MON('02', '30005360022', 2), MON('05', '30005360022', 5)]);
  t('both moving parts are kept, joined', JSON.stringify(k) === '["01|1","02|2","05|5"]', JSON.stringify(k));
  t('head collapses the drifting index', k.map(I.headOf).join(',') === '01,02,05');
}
console.log('· shot tokens — Schuh (the code is a SUFFIX on the SKU)');
{
  const k = I.shotTokens([SCH('8341007080', ''), SCH('8341007080', 'm1'), SCH('8341007080', 'm4'), SCH('8341007080', 'm8')]);
  t('m1 / m4 / m8 read out', k.slice(1).join(',') === 'm1_zm,m4_zm,m8_zm', JSON.stringify(k));
  t('the image that IS the stem is the primary marker', k[0] === 'zm' || k[0] === '·', k[0]);
}
console.log('· shot tokens — Reiss (a bare trailing index)');
{
  const k = I.shotTokens([REI('Y76182s', ''), REI('Y76182s', '2'), REI('Y76182s', '3'), REI('Y76182s', '5')]);
  t('primary is ·, the rest are their index', JSON.stringify(k) === '["·","2","3","5"]', JSON.stringify(k));
}
console.log('· shot tokens — degenerate inputs');
t('a single image yields the primary marker', JSON.stringify(I.shotTokens([MON('01', '1', 1)])) === '["·"]');
t('no shared stem at all yields nulls, never a guess',
  I.shotTokens(['https://a/zzzz.jpg', 'https://b/qqqq.jpg']).every((x) => x === null));
t('identical URLs do not crash', I.shotTokens([REI('A', ''), REI('A', '')]).length === 2);

console.log('· the collector on the Feed Lab parser contract');
const hdr = ['g:id', 'g:title', 'g:link', 'g:image_link', 'g:additional_image_link', 'additional_image_link|||2', 'g:additional_image_link(3)', 'g:product_type'];
function run(rows, header) {
  const c = I.imageCollector({ client: 'T', market: 'gb' });
  c.onRow(header || hdr);
  rows.forEach((r) => c.onRow(r));
  return c.finish();
}
{
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const sku = 20001600000 + i;
    rows.push([`p${i}`, `Product ${i}`, `https://m.co/p${i}`,
      MON('01', sku, 1), MON('21', sku, 6), MON('02', sku, 2), MON('03', sku, 3), 'Dresses > Midi']);
  }
  const cap = run(rows);
  t('rows and images counted', cap.rows === 120 && cap.imgs === 480, JSON.stringify([cap.rows, cap.imgs]));
  t('every product had an image', cap.withImg === 120);
  t('slot occupancy across 4 slots', cap.slots.slice(0, 4).every((n) => n === 120) && cap.slots.slice(4).every((n) => n === 0), JSON.stringify(cap.slots));
  t('|||2 and (3) both resolve as additional slots', cap.addlSlots === 3, String(cap.addlSlots));
  t('four shot codes, one per column', cap.tokens.length === 4, JSON.stringify(cap.tokens.map((x) => x.tok)));
  t('codes are 01 / 21 / 02 / 03', cap.tokens.map((x) => x.tok).sort().join(',') === '01,02,03,21');
  t('each code carries 120 images', cap.tokens.every((x) => x.n === 120));
  t('the feed is learnable at 100% cover', cap.learnable && cap.tokCover === 1, JSON.stringify([cap.learnable, cap.tokCover]));
  t('samples carry id, title and slot', cap.tokens[0].samples[0].id === 'p0' && cap.tokens[0].samples[0].slot === 0);
  t('samples carry the product type for context', cap.tokens[0].samples[0].pt === 'Dresses > Midi');
  t('sample count is capped', cap.tokens[0].samples.length === I.TOK_SAMPLES);
  t('a token knows which slots it appears in', Object.keys(cap.tokens.find((x) => x.tok === '01').slots).join() === '0');
}
console.log('· an unpatterned feed is refused, not fudged');
{
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push([`s${i}`, `SD ${i}`, '', SUP(500000 + i * 7), SUP(500003 + i * 7), '', '', '']);
  const cap = run(rows);
  t('opaque hashed filenames are NOT learnable', !cap.learnable, JSON.stringify([cap.tokCover, cap.tokKept]));
  t('it still reports the images it read', cap.imgs === 400 && cap.withImg === 200);
  t('the weak codes are flagged as rare', cap.tokens.some((x) => x.weak));
}
console.log('· head vs full grouping — the page tags codes, so fewer is better');
{
  const rows = [];
  for (let i = 0; i < 200; i++) {
    const sku = 30005360000 + i;
    // the trailing index drifts with the slot, exactly as Accessorize's does
    rows.push([`a${i}`, `A ${i}`, '', MON('01', sku, 1), MON('02', sku, (i % 3) + 2), MON('05', sku, (i % 4) + 5), '', '']);
  }
  const cap = run(rows);
  t('head grouping chosen', cap.grouping === 'head', cap.grouping);
  t('three codes, not nine', cap.tokens.filter((x) => !x.weak).length === 3, JSON.stringify(cap.tokens.map((x) => x.tok + ':' + x.n)));
  t('all images explained', cap.tokCover === 1 && cap.learnable);
}
console.log('· a clean head vocabulary survives a full-token bag that overflows');
{
  // Monsoon's real shape: eleven heads, but hundreds of full tokens once the trailing image
  // index drifts. The full bag hits the cap; that must NOT make the feed unlearnable, because
  // the page groups by head. (Regression: a single shared overflow flag failed exactly here.)
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const sku = 20001600000 + i;
    rows.push([`m${i}`, `M ${i}`, '', MON('01', sku, i % 9), MON('21', sku, (i % 7) + 1),
      MON('02', sku, (i % 11) + 1), MON('03', sku, (i % 13) + 1), '']);
  }
  const cap = run(rows);
  t('head grouping chosen over the overflowing full bag', cap.grouping === 'head', cap.grouping);
  t('four codes, all the images', cap.tokens.filter((x) => !x.weak).length === 4 && cap.tokCover === 1,
    JSON.stringify([cap.tokens.length, cap.tokCover]));
  t('still learnable', cap.learnable && !cap.overflow, JSON.stringify([cap.learnable, cap.overflow]));
}
console.log('· products with no images, and duplicate images');
{
  const cap = run([
    ['a', 'A', '', '', '', '', '', ''],
    ['b', 'B', '', REI('B1', ''), REI('B1', ''), '', '', ''],
    ['c', 'C', '', REI('C1', ''), REI('C1', '2'), '', '', ''],
  ]);
  t('an image-less product is counted in rows, not in withImg', cap.rows === 3 && cap.withImg === 2, JSON.stringify([cap.rows, cap.withImg]));
  t('a product repeating one image is flagged', cap.dupRows === 1, String(cap.dupRows));
  t('hasImage true when the column exists', cap.hasImage === true);
}
console.log('· a feed with no image_link column at all');
{
  const cap = run([['a', 'A', 'https://x/a']], ['g:id', 'g:title', 'g:link']);
  t('reported honestly, never crashed', cap.hasImage === false && cap.imgs === 0 && cap.tokens.length === 0);
}
console.log('· the XML header may grow mid-stream (liveHeader)');
{
  const c = I.imageCollector({ client: 'T', market: 'gb' });
  const h1 = ['g:id', 'g:image_link'];
  const h2 = ['g:id', 'g:image_link', 'g:additional_image_link'];
  c.onRow(h1);
  c.onRow(['p0', REI('A', '')], h1);
  c.onRow(['p1', REI('B', ''), REI('B', '2')], h2);
  const cap = c.finish();
  t('the later slot is picked up once the header grows', cap.imgs === 3 && cap.slots[1] === 1, JSON.stringify(cap.slots));
}
console.log('· tagging — a rule on the code, an override on the image');
{
  const tags = { tok: { '01': { tag: 'packshot', by: 'ai', conf: .9 }, '21': { tag: 'model-full', by: 'manual' } },
    img: { 'p7#0': { tag: 'lifestyle', by: 'manual' } } };
  t('a code rule answers for every image carrying it', I.tagFor(tags, '01', 0, 'p3').tag === 'packshot');
  t('a per-image override beats its code', I.tagFor(tags, '01', 0, 'p7').tag === 'lifestyle');
  t('the override is scoped to that slot', I.tagFor(tags, '01', 1, 'p7').tag === 'packshot');
  t('an untagged code answers null, never a guess', I.tagFor(tags, '99', 0, 'p3') === null);
  t('provenance survives', I.tagFor(tags, '01', 0, 'p3').by === 'ai' && I.tagFor(tags, '21', 0, 'p3').by === 'manual');
  const cap = { imgs: 300, tokens: [{ tok: '01', n: 100 }, { tok: '21', n: 100 }, { tok: '99', n: 100 }] };
  const cv = I.coverageOf(cap, tags);
  t('coverage counts only tagged codes', cv.tagged === 200 && cv.pct === 66.7, JSON.stringify(cv));
  t('coverage splits by tag', cv.byTag.packshot === 100 && cv.byTag['model-full'] === 100);
  t('no tags at all = 0%, never NaN', I.coverageOf(cap, null).pct === 0);
}
console.log('· the taxonomy the tags come from');
t('every entry has an id, a label and a hint', I.TAXONOMY.length >= 10 && I.TAXONOMY.every((x) => x.id && x.label && x.hint));
t('ids are unique', new Set(I.TAXONOMY.map((x) => x.id)).size === I.TAXONOMY.length);
t('Ray\'s two examples are in the standard list',
  I.TAXONOMY.some((x) => /flat-lay/i.test(x.label)) && I.TAXONOMY.some((x) => /upper body/i.test(x.label)));
t('eleven slots — image_link plus ten', I.MAX_SLOTS === 11);
t('a vocabulary no one could tag is not called learnable', I.LEARN_MAX_CODES <= 20);

/* optional: stream a real export */
const FIX = process.env.IMAGE_FIXTURE;
if (FIX && existsSync(FIX)) {
  console.log('· fixture: ' + FIX);
  const col = I.imageCollector({ client: 'fixture', market: 'gb' });
  const parser = FA.createXmlParser((r, h) => col.onRow(r, h));
  parser.push(readFileSync(FIX, 'utf-8')); parser.end();
  const cap = col.finish();
  console.log('   rows=' + cap.rows + ' images=' + cap.imgs + ' per product=' + (cap.imgs / (cap.withImg || 1)).toFixed(1)
    + ' grouping=' + cap.grouping + ' learnable=' + cap.learnable + ' cover=' + Math.round(cap.tokCover * 100) + '%');
  console.log('   ' + cap.tokens.slice(0, 12).map((x) => x.tok + '×' + x.n).join(' '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
