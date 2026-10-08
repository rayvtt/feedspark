#!/usr/bin/env node
/* Overlay Design Studio engine — docs/overlay_studio_engine.js
 *
 * Every fixture below is a REAL shape read off the live estate on 7 Oct 2026 (FeedHero reports MCP
 * + the FeedHero-hosted output feeds), not a shape invented to make the engine pass:
 *   - Monsoon UK Meta output  g:price "150.00 GBP" / g:sale_price "105.00 GBP"   (Google's own order)
 *   - Monsoon UK master       g:price "£30.00" / g:was_price ""  + stock_quantity "8"
 *   - Schuh UK master         price "38" / sale_price "15.99"  — the REVERSE of Monsoon's master
 *   - YuMOVE UK master        price "18.57" / inventory_quantity "5044"
 * The Monsoon/Schuh reversal is why the price pair is resolved by value; the YuMOVE 5,044 is why
 * scarcity has a ceiling; and no output feed carries stock at all, which is why "x units left"
 * reports as master-only rather than being mocked up.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../docs/overlay_studio_engine.js');

let n = 0, fails = [];
const t = (name, fn) => { n++; try { fn(); } catch (e) { fails.push(name + ' — ' + e.message); } };
const near = (a, b, d = 0.001) => Math.abs(a - b) <= d;

/* ------------------------------------------------------------------ fixtures */
// Monsoon UK Meta output feed (g:sale_price on 23 of 60 items read)
const MON_FB_HEAD = ['g:id', 'title', 'description', 'link', 'g:image_link', 'g:additional_image_link',
  'g:availability', 'g:price', 'g:sale_price', 'g:brand', 'g:color', 'g:size', 'g:shipping', 'g:product_type'];
const monFbRow = (i) => ({
  'g:id': '200016' + i, title: 'Monsoon Mona Angel Sleeve Maxi Dress', description: 'Sheer elegance.',
  link: 'https://www.monsoon.co.uk/p' + i + '.html',
  'g:image_link': 'https://dashboard.feedspark.com/image-creator/monsoon-mix-meta/image_process_products_lifestyle.php?img_url_left=https%3A%2F%2Fwww.monsoon.co.uk%2Fa.jpg&img_url_right=https%3A%2F%2Fwww.monsoon.co.uk%2Fb.jpg&img_ver=1',
  'g:additional_image_link': 'https://www.monsoon.co.uk/b.jpg',
  'g:availability': 'in stock', 'g:price': '150.00 GBP',
  'g:sale_price': i % 3 === 0 ? '105.00 GBP' : '',          // the measured ~1-in-3 fill
  'g:brand': 'Monsoon', 'g:color': 'Navy/Green/Blue', 'g:size': '6/12/10',
  'g:shipping': '<g:country>GB</g:country><g:service>Standard</g:service><g:price>0.00 GBP</g:price>',
  'g:product_type': 'womens > tea dresses',
});
const MON_FB = Array.from({ length: 30 }, (_, i) => monFbRow(i));

// Monsoon UK MASTER (its own vocabulary: g:was_price is the reference and is mostly empty)
const MON_M_HEAD = ['g:id', 'title', 'g:availability', 'stock_quantity', 'g:price', 'g:was_price', 'g:brand', 'g:image_link'];
const MON_M = Array.from({ length: 20 }, (_, i) => ({
  'g:id': '10012361' + i, title: 'Baby Leila Corsage Velvet Party Dress Purple',
  'g:availability': 'in stock', stock_quantity: String([8, 33, 2, 140, 11][i % 5]),
  'g:price': '£30.00', 'g:was_price': i % 4 === 0 ? '£45.00' : '',
  'g:brand': 'Monsoon', 'g:image_link': 'https://www.monsoon.co.uk/01_5650.jpg',
}));

// Schuh UK MASTER — price is the RRP and sale_price is the live price: Monsoon's master reversed
const SCH_HEAD = ['id', 'item_group_id', 'colour', 'brand', 'link', 'price', 'sale_price', 'Margin',
  'title', 'availability', 'stockquantity', 'image1URL', 'image2URL', 'Shipping'];
const SCH = Array.from({ length: 20 }, (_, i) => ({
  id: '111333116036' + i, item_group_id: '1113331160', colour: 'Stone', brand: 'schuh',
  link: 'https://www.schuh.co.uk/x/', price: String(38 + i), sale_price: String(15.99 + i), Margin: '14.7',
  title: 'schuh Seoul Round Toe Court High Heels in Stone', availability: 'in_stock',
  stockquantity: String([8, 3, 19, 6, 1][i % 5]),
  image1URL: 'https://d2ob0iztsaxy5v.cloudfront.net/product/111333/1113331160_zm.jpg',
  image2URL: 'https://d2ob0iztsaxy5v.cloudfront.net/product/111333/1113331160m8_zm.jpg', Shipping: '3.99',
}));

// YuMOVE UK MASTER — inventory_quantity in the thousands
const YUM_HEAD = ['id', 'title', 'price', 'compare_at_price', 'inventory_quantity', 'vendor', 'image_link', 'availability'];
const YUM = Array.from({ length: 12 }, (_, i) => ({
  id: 'YM30-PP', title: 'Joint Support for Adult Dogs', price: '18.57', compare_at_price: '',
  inventory_quantity: String(5044 - i * 7), vendor: 'lintbells-uk',
  image_link: 'https://cdn.shopify.com/s/files/x.webp', availability: 'In stock',
}));

/* ------------------------------------------------------------------ money + numbers */
t('money reads every real form in the estate', () => {
  assert.deepEqual(S.money('150.00 GBP'), { n: 150, cur: 'GBP' });
  assert.deepEqual(S.money('£30.00'), { n: 30, cur: 'GBP' });
  assert.deepEqual(S.money('15,99 €'), { n: 15.99, cur: 'EUR' });
  assert.deepEqual(S.money('1.234,56 EUR'), { n: 1234.56, cur: 'EUR' });
  assert.deepEqual(S.money('1,234.56'), { n: 1234.56, cur: '' });
  assert.deepEqual(S.money('38'), { n: 38, cur: '' });
  assert.equal(S.money(''), null);
  assert.equal(S.money('in stock'), null);
  assert.equal(S.money('-5'), null, 'a negative is not a price');
});
t('money never reads a thousands comma as a decimal', () => {
  assert.equal(S.money('1,500').n, 1500);
  assert.equal(S.money('15,99').n, 15.99);
});
t('fmtMoney drops the pence on a whole number and keeps them otherwise', () => {
  assert.equal(S.fmtMoney(30, 'GBP'), '£30');
  assert.equal(S.fmtMoney(15.99, 'GBP'), '£15.99');
  assert.equal(S.fmtMoney(1500, 'GBP'), '£1,500');
  assert.equal(S.fmtMoney(105, 'EUR'), '€105');
  assert.equal(S.fmtMoney(105, 'AED'), 'AED 105');
});
t('compact never prints a number nobody reads', () => {
  assert.equal(S.compact(1267), '1,267');
  assert.equal(S.compact(367863), '368k');
  assert.equal(S.compact(1200000), '1.2m');
  assert.equal(S.compact(55), '55');
});
t('pctOff refuses a sale price at or above the reference', () => {
  assert.equal(S.pctOff(150, 105), 30);
  assert.equal(S.pctOff(38, 15.99), 58);
  assert.equal(S.pctOff(100, 100), null);
  assert.equal(S.pctOff(100, 120), null);
  assert.equal(S.pctOff(0, 0), null);
});
t('normKey folds every prefix the estate uses', () => {
  assert.equal(S.normKey('g:sale_price'), 'saleprice');
  assert.equal(S.normKey('c:washingInstructions'), 'washinginstructions');
  assert.equal(S.normKey('stock_quantity'), 'stockquantity');
  assert.equal(S.normKey('stockquantity'), 'stockquantity');
  assert.equal(S.normKey('image1URL'), 'image1url');
});

/* ------------------------------------------------------------------ the summoner */
t('Monsoon Meta output: Google\'s own order is read correctly', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  assert.equal(s.slots.price_was.col, 'g:price');
  assert.equal(s.slots.price_now.col, 'g:sale_price');
  assert.equal(s.cur, 'GBP');
});
t('Schuh master: the REVERSE naming is read correctly, by value', () => {
  const s = S.summon(SCH_HEAD, SCH);
  assert.equal(s.slots.price_was.col, 'price', 'Schuh\'s `price` is the RRP');
  assert.equal(s.slots.price_now.col, 'sale_price');
  assert.equal(s.pair.method, 'values', 'resolved by comparing the values, not by the names');
  assert.ok(s.pair.both >= 3 && s.pair.agree === s.pair.both, 'every row agreed');
  assert.match(s.slots.price_was.why, /higher on \d+ of \d+ rows/);
});
t('the two brands resolve to OPPOSITE columns from the same engine', () => {
  const a = S.summon(MON_FB_HEAD, MON_FB), b = S.summon(SCH_HEAD, SCH);
  assert.equal(S.normKey(a.slots.price_was.col), 'price');
  assert.equal(S.normKey(b.slots.price_was.col), 'price');
  assert.equal(S.normKey(a.slots.price_now.col), 'saleprice');
  assert.equal(S.normKey(b.slots.price_now.col), 'saleprice');
});
t('VALUES BEAT NAMES: a column named sale_price holding the higher figure is the reference', () => {
  // a data bug Google's own spec forbids (sale_price must be below price). Reading it by name would
  // print a NEGATIVE discount on a client's product image; reading it by value refuses to.
  const head = ['id', 'price', 'sale_price'];
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: 'x' + i, price: String(20 + i), sale_price: String(60 + i) }));
  const s = S.summon(head, rows);
  assert.equal(s.slots.price_was.col, 'sale_price');
  assert.equal(s.slots.price_now.col, 'price');
  const r = S.resolveFacts(rows[0], s, null, null);
  assert.ok(r.sale_pct.ok, 'a real discount is still reported');
  assert.equal(r.sale_pct.text, '67% OFF');
});
t('Monsoon master: a mostly-empty reference column is resolved AND its fill rate stated', () => {
  const s = S.summon(MON_M_HEAD, MON_M);
  assert.equal(s.slots.price_now.col, 'g:price');
  assert.equal(s.slots.price_was.col, 'g:was_price');
  assert.equal(s.pair.method, 'values', '5 rows carry both and all 5 agree — value beats fill');
  assert.match(s.slots.price_was.why, /filled on 5 of 20 rows read/, 'the gap is sized even when the pair was read by value');
  assert.match(s.slots.price_was.why, /only those products can carry a discount/);
  assert.ok(s.slots.price_was.fill < 0.3);
  assert.ok(near(s.facts.sale_pct.cov, 0.25, 0.01), 'a quarter of this catalogue can carry a discount');
});
t('a UNANIMOUS small sample is resolved by value, not by column order', () => {
  // the weakness this pins: with a 2-row sample the old floor (3 rows) fell through to the feed's
  // own column order, which read Schuh-shaped data backwards and reported a NEGATIVE discount
  const head = ['id', 'price', 'sale_price'];
  const rows = [{ id: 'a', price: '100', sale_price: '70' }, { id: 'b', price: '80', sale_price: '60' }];
  const s = S.summon(head, rows);
  assert.equal(s.pair.method, 'values');
  assert.equal(s.slots.price_was.col, 'price');
  assert.equal(s.pair.conf, 'medium', 'resolved, and honest that two rows is a small sample');
  assert.equal(S.resolveFacts(rows[0], s, null, null).sale_pct.text, '30% OFF');
});
t('a pair that genuinely cannot be told apart says so instead of guessing', () => {
  const head = ['id', 'price', 'sale_price'];
  const rows = [{ id: 'a', price: '100', sale_price: '120' }, { id: 'b', price: '100', sale_price: '80' },
    { id: 'c', price: '100', sale_price: '130' }, { id: 'd', price: '100', sale_price: '70' }];
  const s = S.summon(head, rows);
  assert.equal(s.pair.conf, 'low');
  assert.match(s.slots.price_now.why, /could not be told apart by their values/);
  assert.match(s.slots.price_now.why, /check this before showing a client/);
});
t('a one-price feed says there is nothing to strike through', () => {
  const s = S.summon(['id', 'price'], [{ id: 'a', price: '10' }, { id: 'b', price: '12' }]);
  assert.equal(s.slots.price_now.col, 'price');
  assert.equal(s.slots.price_was.col, null);
  assert.match(s.slots.price_was.why, /one price only/);
  assert.equal(s.facts.sale_pct.state, 'none');
});
t('a feed with no money column at all is refused honestly', () => {
  const s = S.summon(['id', 'title'], [{ id: 'a', title: 'x' }]);
  assert.equal(s.slots.price_now.col, null);
  assert.match(s.slots.price_now.why, /no column in this feed reads as money/);
});
t('quantity is summoned under all three real spellings', () => {
  assert.equal(S.summon(MON_M_HEAD, MON_M).slots.qty.col, 'stock_quantity');
  assert.equal(S.summon(SCH_HEAD, SCH).slots.qty.col, 'stockquantity');
  assert.equal(S.summon(YUM_HEAD, YUM).slots.qty.col, 'inventory_quantity');
});
t('an id/margin/weight column is never taken for a price', () => {
  const s = S.summon(SCH_HEAD, SCH);
  assert.notEqual(s.slots.price_now.col, 'Margin');
  assert.notEqual(s.slots.price_was.col, 'Margin');
  assert.notEqual(s.slots.price_now.col, 'id');
});
t('an empty column in the feed is reported as empty, not as absent', () => {
  const s = S.summon(['id', 'price', 'g:promotion_id'], [{ id: 'a', price: '5', 'g:promotion_id': '' }]);
  assert.equal(s.slots.promo.col, null);
  assert.match(s.slots.promo.why, /is in the feed and empty on every row read/);
});
t('free delivery is derived from the nested shipping price', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  assert.equal(s.slots.free_shipping.conf, 'high');
  assert.match(s.slots.free_shipping.why, /shipping reads 0 on \d+ of \d+ rows/);
  const sc = S.summon(SCH_HEAD, SCH);
  assert.equal(sc.slots.free_shipping.conf, 'none', 'Schuh charges 3.99');
  assert.match(sc.slots.free_shipping.why, /above zero/);
});
t('image slots follow each brand\'s own naming', () => {
  assert.equal(S.summon(MON_FB_HEAD, MON_FB).slots.image.col, 'g:image_link');
  assert.equal(S.summon(SCH_HEAD, SCH).slots.image.col, 'image1URL');
  assert.equal(S.summon(YUM_HEAD, YUM).slots.image.col, 'image_link');
});

/* ------------------------------------------------- coverage, not presence */
t('a fact states the share of the catalogue it reads on', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  const fill = MON_FB.filter((r) => r['g:sale_price']).length / MON_FB.length;
  assert.ok(near(s.facts.sale_pct.cov, fill, 0.02), 'sale_pct coverage IS the sale_price fill rate');
  assert.equal(s.facts.sale_pct.state, 'thin', 'a third of the catalogue is thin, and is said to be');
  assert.match(s.facts.sale_pct.why, /reads on 3[0-9]% of the products read/);
  assert.equal(s.facts.price_now.state, 'thin');
  assert.equal(s.facts.brand.state, 'ready');
  assert.equal(s.facts.brand.cov, 1);
});
t('a message needing nothing fits every product and says so', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  assert.equal(s.facts.sale_word.state, 'ready');
  assert.match(s.facts.sale_word.why, /needs no data/);
});

/* --------------------------------- rule 2: no output feed carries stock */
t('MASTER-ONLY: stock is reported as needing a FeedHero rule, never mocked up', () => {
  const out = S.summon(MON_FB_HEAD, MON_FB, { master: S.summon(MON_M_HEAD, MON_M).slots });
  assert.equal(out.slots.qty.col, null, 'no output feed in the estate carries stock');
  assert.equal(out.facts.units.state, 'master_only');
  assert.match(out.facts.units.why, /the master feed carries stock_quantity/);
  assert.match(out.facts.units.why, /FeedHero rule would have to pass it through/);
  assert.ok(out.facts.units.cov > 0, 'the master\'s own fill rate is carried, so the gap is sized');
});
t('with no master read either, stock is simply absent', () => {
  const out = S.summon(MON_FB_HEAD, MON_FB);
  assert.equal(out.facts.units.state, 'none');
  assert.match(out.facts.units.why, /no stock column in the output feed or the master/);
});
t('a feed that DOES carry stock reads it straight', () => {
  const s = S.summon(SCH_HEAD, SCH);
  assert.equal(s.facts.units.state, 'ready');
  assert.match(s.facts.units.why, /the output feed carries stockquantity/);
});

/* --------------------------------- rule 3: a nonsense number is refused */
t('YuMOVE\'s 5,044 in stock is not scarcity and says why', () => {
  const s = S.summon(YUM_HEAD, YUM);
  const r = S.resolveFacts(YUM[0], s, null, null);
  assert.equal(r.units.ok, false);
  assert.equal(r.units.raw, 5044);
  assert.match(r.units.why, /above the 25-unit scarcity ceiling/);
  assert.match(r.units.why, /a stock figure, not scarcity/);
  assert.equal(r.low_stock.ok, false);
});
t('Monsoon\'s 8 in stock IS scarcity', () => {
  const s = S.summon(MON_M_HEAD, MON_M);
  const r = S.resolveFacts(MON_M[0], s, null, null);
  assert.equal(r.units.text, 'Only 8 left');
  assert.equal(r.low_stock.text, 'Selling fast');
});
t('out of stock is never dressed as scarcity', () => {
  const s = S.summon(SCH_HEAD, SCH);
  const r = S.resolveFacts(Object.assign({}, SCH[0], { stockquantity: '0' }), s, null, null);
  assert.equal(r.units.ok, false);
  assert.match(r.units.why, /out of stock/);
});
t('a discount under the floor is refused with its own number', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: 'r' + i, price: '100', sale_price: String(96 + (i % 3)) }));
  const s = S.summon(['id', 'price', 'sale_price'], rows);
  assert.equal(s.slots.price_was.col, 'price');
  const r = S.resolveFacts({ id: 'a', price: '100', sale_price: '97' }, s, null, null);
  assert.equal(r.sale_pct.ok, false);
  assert.equal(r.sale_pct.raw, 3);
  assert.match(r.sale_pct.why, /under the 5% floor/);
});

/* ------------------------------------------------------------------ resolve */
t('Monsoon\'s discounted product reads 30% off and £45 off', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  const r = S.resolveFacts(MON_FB[0], s, null, null);
  assert.equal(r.sale_pct.text, '30% OFF');
  assert.equal(r.sale_amt.text, '£45 OFF');
  assert.equal(r.price_now.text, '£105');
  assert.equal(r.price_was.text, 'was £150');
  assert.equal(r.free_del.text, 'FREE DELIVERY');
  assert.equal(r.brand.text, 'MONSOON');
  assert.equal(r.colour.text, 'Navy', 'the first of a slash-joined colour list');
});
t('the same feed\'s UNdiscounted product says exactly why it has no sale message', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  const r = S.resolveFacts(MON_FB[1], s, null, null);   // g:sale_price empty
  assert.equal(r.sale_pct.ok, false);
  assert.match(r.sale_pct.why, /no live price on this product/);
  assert.equal(r.price_was.text, 'was £150', 'the reference price is still there');
});
t('Schuh\'s product reads its real 58% off', () => {
  const s = S.summon(SCH_HEAD, SCH);
  const r = S.resolveFacts(SCH[0], s, null, null);
  assert.equal(r.sale_pct.text, '58% OFF');
  assert.equal(r.price_now.text, '15.99', 'Schuh\'s master carries no currency, so none is invented');
  assert.equal(r.free_del.ok, false);
  assert.match(r.free_del.why, /delivery on this product is 3.99/);
});

/* ------------------------------------------------------------------ Ads facts */
const ADS = { clicks: 1267, impr: 367863, conv: 55.24, cost: 688.49, value: 2853.02, window: 'the last 7 days' };
t('Ads facts are off until Google Ads is read, and say why', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB, { adsWhy: 'Google Ads is read for the Google feed' });
  assert.equal(s.facts.clicks.state, 'off');
  assert.match(s.facts.clicks.why, /Google Ads is not read for this feed/);
  assert.match(s.facts.clicks.why, /Google Ads is read for the Google feed/);
  assert.equal(s.facts.clicks.src, 'ads');
});
t('Ads coverage is the share of products carrying traffic, with the window named', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB, { ads: true, adsCov: 0.41, adsWindow: 'the last 7 days' });
  assert.equal(s.facts.clicks.state, 'ready');
  assert.match(s.facts.clicks.why, /41% of the products read carry Ads traffic over the last 7 days/);
});
t('a product\'s real Ads figures become real overlay text', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB, { ads: true, adsCov: 0.41 });
  const r = S.resolveFacts(MON_FB[0], s, ADS, null);
  assert.equal(r.clicks.text, '1,267 clicks in the last 7 days');
  assert.equal(r.views.text, '368k shoppers saw this in the last 7 days');
  assert.equal(r.bought.text, '55 bought in the last 7 days');
});
t('a product with no Ads row, and one with no clicks, each say which', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB, { ads: true });
  const none = S.resolveFacts(MON_FB[0], s, null, null);
  assert.match(none.clicks.why, /no Google Ads row for this product/);
  const zero = S.resolveFacts(MON_FB[0], s, { clicks: 0, impr: 12, conv: 0, window: '7 days' }, null);
  assert.equal(zero.clicks.ok, false);
  assert.match(zero.clicks.why, /no clicks in the window/);
  assert.equal(zero.views.text, '12 shoppers saw this in 7 days');
  assert.match(zero.bought.why, /fewer than one conversion/);
});
t('a single click reads in the singular', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB, { ads: true });
  assert.equal(S.resolveFacts(MON_FB[0], s, { clicks: 1, impr: 0, conv: 0 }, null).clicks.text, '1 click');
});

/* ------------------------------------------------------------------ compose */
t('a design drops the zone whose fact is missing, and says why', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  const r = S.resolveFacts(MON_FB[1], s, null, null);     // no sale price
  const c = S.compose('corner-flash', r);
  assert.equal(c.drew, 0);
  assert.equal(c.empty, true, 'a design with its only message missing is EMPTY, never drawn blank');
  assert.equal(c.dropped.length, 1);
  assert.equal(c.dropped[0].fact, 'sale_pct');
  assert.match(c.dropped[0].why, /no live price/);
});
t('a design that drew some of its zones is not empty', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  const r = S.resolveFacts(MON_FB[0], s, null, null);     // no stock, no ads
  const c = S.compose('full-house', r);
  assert.ok(c.drew >= 2 && c.dropped.length >= 1);
  assert.equal(c.empty, false);
});
t('the control design is never empty and carries no message', () => {
  const c = S.compose('clean', {});
  assert.equal(c.wanted, 0);
  assert.equal(c.empty, false);
  assert.match(c.why, /carries no message/);
});
t('the composer\'s own wording overrides the fact, and only that fact', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  const r = S.resolveFacts(MON_FB[0], s, null, null);
  const c = S.compose('price-pair', r, { text: { price_now: 'YOURS FOR £105' } });
  const t2 = c.zones.filter((z) => z.text);
  assert.equal(t2.filter((z) => z.fact === 'price_now')[0].text, 'YOURS FOR £105');
  assert.equal(t2.filter((z) => z.fact === 'price_was')[0].text, 'was £150');
});
t('an override can fill a zone the product itself could not', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB);
  const r = S.resolveFacts(MON_FB[1], s, null, null);
  const c = S.compose('corner-flash', r, { text: { sale_pct: 'NEW IN' } });
  assert.equal(c.drew, 1);
  assert.equal(c.empty, false);
});
t('an unknown design is refused, not drawn', () => {
  const c = S.compose('no-such-design', {});
  assert.equal(c.ok, false);
});

/* ------------------------------------------- the two-up is two pictures (8 Oct 2026) */
const TWO_HEAD = ['id', 'title', 'price', 'sale_price', 'image_link', 'additional_image_link', 'availability'];
const twoRow = (i, add) => ({ id: 'T' + i, title: 'Reiss Petite Corduroy Wide Leg Trousers',
  price: '168.00 GBP', sale_price: i % 2 ? '118.00 GBP' : '', availability: 'in stock',
  image_link: 'https://xcdn.example.com/' + i + '_a.jpg', additional_image_link: add });
// half the catalogue carries a genuine second shot; a quarter repeats the packshot; a quarter carries none
const TWO = Array.from({ length: 20 }, (_, i) => twoRow(i,
  i % 4 === 2 ? 'https://xcdn.example.com/' + i + '_a.jpg' : i % 4 === 3 ? '' : 'https://xcdn.example.com/' + i + '_b.jpg,https://xcdn.example.com/' + i + '_c.jpg'));
const ONE_HEAD = ['id', 'title', 'price', 'image_link', 'availability'];
const ONE = [{ id: 'O1', title: 'One picture only', price: '20.00 GBP',
  image_link: 'https://xcdn.example.com/only.jpg', availability: 'in stock' }];

t('a repeatable image column is read as a list of URLs, deduped, in order', () => {
  assert.deepEqual(S.imgUrls('https://a/1.jpg,https://a/2.jpg'), ['https://a/1.jpg', 'https://a/2.jpg']);
  assert.deepEqual(S.imgUrls('https://a/1.jpg https://a/2.jpg'), ['https://a/1.jpg', 'https://a/2.jpg']);
  assert.deepEqual(S.imgUrls('https://a/1.jpg | https://a/1.jpg'), ['https://a/1.jpg'], 'the same picture twice is one picture');
  assert.deepEqual(S.imgUrls('not a url'), [], 'anything that is not an http URL is not an image');
  assert.deepEqual(S.imgUrls(''), []);
});
t('the second picture is the first additional image that is NOT the main one', () => {
  const s = S.summon(TWO_HEAD, TWO);
  const si = S.secondImage(TWO[0], s.slots, TWO[0].image_link);
  assert.equal(si.url, 'https://xcdn.example.com/0_b.jpg');
  assert.equal(si.n, 2, 'both additional images are counted');
  assert.equal(si.why, '');
});
t('an additional image that repeats the packshot is NOT a second picture, and says so', () => {
  const s = S.summon(TWO_HEAD, TWO);
  const si = S.secondImage(TWO[2], s.slots, TWO[2].image_link);   // additional == main
  assert.equal(si.url, '');
  assert.match(si.why, /is the same picture as its main image/);
});
t('a product with no additional image, and a feed with no such column, each say which it is', () => {
  const s = S.summon(TWO_HEAD, TWO);
  assert.match(S.secondImage(TWO[3], s.slots, TWO[3].image_link).why, /this product carries no/);
  const one = S.summon(ONE_HEAD, ONE);
  assert.match(S.secondImage(ONE[0], one.slots, ONE[0].image_link).why, /this feed carries no second image column/);
});
t('the second-image fact is measured PER PRODUCT, not by how full the column is', () => {
  const s = S.summon(TWO_HEAD, TWO);
  const f = s.facts.second_image;
  assert.equal(f.state, 'ready');
  assert.equal(Math.round(f.cov * 100), 50, 'the column is 75% full but only half the products carry a DIFFERENT picture');
  assert.match(f.why, /10 of the 20 products read/);
  const one = S.summon(ONE_HEAD, ONE);
  assert.equal(one.facts.second_image.state, 'none', 'a feed with no additional_image_link column cannot carry a two-up');
  assert.ok(S.readiness(one).gaps.some((g) => g.id === 'second_image'), 'and it is reported as a gap, never as ready');
});
t('the two-up is built from image_link AND additional_image_link', () => {
  const s = S.summon(TWO_HEAD, TWO);
  const r = S.resolveFacts(TWO[0], s, null, null);
  assert.equal(r.second_image.ok, true);
  assert.equal(r.second_image.raw, 'https://xcdn.example.com/0_b.jpg');
  const c = S.compose('split', r);
  const iz = c.zones.filter((z) => z.as === 'split')[0];
  assert.ok(iz, 'the split design carries an image zone');
  assert.equal(iz.fact, 'second_image');
  assert.equal(iz.raw, 'https://xcdn.example.com/0_b.jpg');
  assert.ok(c.drew >= 1, 'an image zone counts as drawn even though it carries no text');
  const rec = S.recipeFor(c, { client: 'Reiss', market: 'gb' });
  const left = rec.params.filter((p) => p.k === 'img_url_left')[0];
  const right = rec.params.filter((p) => p.k === 'img_url_right')[0];
  assert.equal(left.v, '{image_link}');
  assert.equal(right.v, '{additional_image_link}');
  assert.match(right.note, /the first of 2 this product carries/);
});
t('the second picture is judged against the picture the page is PAINTING, not a composite URL', () => {
  // on a feed already carrying an overlay, image_link is a composite and the page paints the source
  // decoded out of it. An additional image that repeats THAT source is not a second picture, and
  // judging it against the composite URL would have let it through.
  const comp = 'https://dashboard.feedspark.com/image-creator/monsoon-mix-meta/image_process_products_lifestyle.php'
    + '?img_url_left=https://c/9_a.jpg&img_url_right=https://c/9_b.jpg&img_ver=1';
  const row = { id: 'C9', title: 'Composite already live', price: '100.00 GBP', availability: 'in stock',
    image_link: comp, additional_image_link: 'https://c/9_a.jpg' };
  const s = S.summon(TWO_HEAD, TWO.concat([row]));
  assert.equal(S.resolveFacts(row, s, null, null).second_image.ok, true,
    'against the raw composite URL the repeat looks like a second picture');
  const r = S.resolveFacts(row, s, null, null, { mainImg: 'https://c/9_a.jpg' });
  assert.equal(r.second_image.ok, false);
  assert.match(r.second_image.why, /same picture as its main image/);
});
t('a product with no distinct second picture DROPS the two-up rather than drawing the packshot twice', () => {
  const s = S.summon(TWO_HEAD, TWO);
  const c = S.compose('split', S.resolveFacts(TWO[2], s, null, null));
  assert.equal(c.zones.filter((z) => z.as === 'split').length, 0, 'the image zone is gone, never filled with the main image');
  const d = c.dropped.filter((x) => x.fact === 'second_image')[0];
  assert.ok(d, 'the drop is reported');
  assert.match(d.why, /same picture as its main image/);
});

/* ------------------------------------------------------------------ geometry */
const allFacts = () => { const o = {}; S.FACT_IDS.forEach((f) => { o[f] = { id: f, ok: true, text: S.FACTS[f].ex, raw: 1, why: '', src: S.FACTS[f].src }; }); return o; };
t('NO zone ever leaves the image, on every design at every aspect ratio', () => {
  const r = allFacts();
  S.DESIGNS.forEach((d) => {
    const c = S.compose(d, r);
    [[1000, 1000], [600, 900], [1200, 628], [400, 400], [2000, 1000]].forEach(([w, h]) => {
      S.layout(c, w, h).boxes.filter((b) => b.text).forEach((b) => {
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h,
          d.id + ' ' + w + 'x' + h + ' ' + b.fact + ' off the image');
      });
    });
  });
});
t('NO two zones ever overlap, on every design at every aspect ratio', () => {
  const r = allFacts();
  S.DESIGNS.forEach((d) => {
    const c = S.compose(d, r);
    [[1000, 1000], [600, 900], [1200, 628], [400, 400]].forEach(([w, h]) => {
      const ov = S.overlaps(S.layout(c, w, h).boxes);
      assert.equal(ov.length, 0, d.id + ' ' + w + 'x' + h + ' overlapping zones ' + JSON.stringify(ov));
    });
  });
});
t('every zone\'s box is wide enough for the words in it', () => {
  const r = allFacts();
  S.DESIGNS.forEach((d) => {
    const c = S.compose(d, r);
    S.layout(c, 1000, 1000).boxes.filter((b) => b.text).forEach((b) => {
      assert.ok(b.fits, d.id + ' ' + b.fact + ' does not fit its box');
    });
  });
});
t('A FULL-WIDTH BAND RESERVES ITS EDGE — a bottom bar never lands on a bottom-corner tag', () => {
  // the bug this pins: with the corners placed independently of the bands, full-house drew its
  // social-proof bar straight over its price tag at every size
  const c = S.compose('full-house', allFacts());
  const L = S.layout(c, 1000, 1000);
  assert.ok(L.bot > 0, 'the bottom band is measured');
  const bl = L.boxes.filter((b) => b.at === 'bl')[0], br = L.boxes.filter((b) => b.at === 'br')[0];
  const bar = L.boxes.filter((b) => b.band)[0];
  assert.ok(bl.y + bl.h <= bar.y, 'the bottom-left pill sits above the bar');
  assert.ok(br.y + br.h <= bar.y, 'the bottom-right tag sits above the bar');
});
t('A STACK ADDS THE HEIGHTS IT HAS, not this box\'s height times its row', () => {
  // the price tag stacks a large NOW under a small WAS; multiplying by the wrong height put them
  // on top of each other at every size
  const c = S.compose('price-tag', allFacts());
  const L = S.layout(c, 1000, 1000);
  const b = L.boxes.filter((x) => x.text).sort((p, q) => p.y - q.y);
  assert.equal(b.length, 2);
  assert.ok(b[0].y + b[0].h <= b[1].y, 'the two tag rows do not touch');
  assert.notEqual(b[0].h, b[1].h, 'and they really are different heights');
});
t('a stacked anchor keeps its rows in order', () => {
  const c = S.compose('proof-stack', allFacts());
  const L = S.layout(c, 1000, 1000).boxes.filter((b) => b.text);
  assert.equal(L.length, 2);
  assert.ok(L[0].y < L[1].y, 'row 0 above row 1 at a top anchor');
});
t('geometry scales with the image, never with a fixed pixel size', () => {
  const c = S.compose('pill-badge', allFacts());
  const a = S.layout(c, 500, 500).boxes.filter((b) => b.text)[0];
  const b = S.layout(c, 1000, 1000).boxes.filter((b) => b.text)[0];
  assert.ok(near(b.fs / a.fs, 2, 0.15), 'cap height doubles with the image');
  assert.ok(near(b.w / a.w, 2, 0.15));
});
t('the frame and the split are whole-image zones carrying no text', () => {
  const f = S.layout(S.compose('frame', allFacts()), 1000, 1000).boxes.filter((b) => b.as === 'frame')[0];
  assert.equal(f.w, 1000); assert.equal(f.h, 1000); assert.ok(f.inset > 0); assert.equal(f.text, '');
  const sp = S.layout(S.compose('split', allFacts()), 1000, 1000).boxes.filter((b) => b.as === 'split')[0];
  assert.ok(sp && sp.w === 1000);
});

/* ------------------------------------------------------------------ the recipe */
t('the recipe emits the REAL image-creator script per design family', () => {
  const r = allFacts();
  const m = (id) => S.recipeFor(S.compose(id, r), { client: 'Monsoon', market: 'gb-fb' });
  assert.equal(m('split').script, 'image_process_products_lifestyle');
  assert.equal(m('price-tag').script, 'image_process_subscription_v1');
  assert.equal(m('corner-flash').script, 'image_process_engine');
  assert.equal(m('corner-flash').project, 'monsoon-gb-fb');
});
t('the lifestyle split emits the two source-image params the live feed uses', () => {
  const p = S.recipeFor(S.compose('split', allFacts()), { client: 'Monsoon' }).params.map((x) => x.k);
  assert.ok(p.includes('img_url_left') && p.includes('img_url_right'));
  assert.ok(!p.includes('img_url'), 'the single-image param is replaced, not added to');
});
t('the price tag emits the subscription overlay\'s own params', () => {
  const p = S.recipeFor(S.compose('price-tag', allFacts()), { client: 'YuMOVE' }).params;
  const k = p.map((x) => x.k);
  ['show_price', 'tags_bg_color', 'tags_font_color', 'tags_img_type'].forEach((want) => assert.ok(k.includes(want), 'missing ' + want));
  assert.equal(p.filter((x) => x.k === 'tags_img_type')[0].v, 'round_dpa');
  assert.ok(p.filter((x) => x.k === 'tags_bg_color')[0].v.indexOf('#') < 0, 'a colour is a bare hex, as the engine takes it');
});
t('the frame design asks for a frame asset', () => {
  const p = S.recipeFor(S.compose('frame', allFacts()), { client: 'Reiss' }).params;
  assert.ok(p.some((x) => x.k === 'overlay_frame'));
});
t('the recipe is a TEMPLATE — field tokens, never this one product\'s words', () => {
  const r = allFacts();
  const p = S.recipeFor(S.compose('corner-flash', r), { client: 'Monsoon' }).params;
  const txt = p.filter((x) => /^txt/.test(x.k) && !/_/.test(x.k))[0];
  assert.equal(txt.v, '{discount_pct}% OFF', 'per-product substitution, not "30% OFF" baked in');
  assert.equal(S.tokenFor({ fact: 'units' }), 'Only {stock_quantity} left');
  assert.equal(S.tokenFor({ fact: 'clicks' }), '{ads_clicks} clicks');
});
t('every param lands in the URL, encoded', () => {
  const rec = S.recipeFor(S.compose('corner-flash', allFacts()), { client: 'Monsoon', market: 'gb' });
  rec.params.forEach((p) => assert.ok(rec.url.indexOf(p.k + '=' + encodeURIComponent(p.v)) >= 0, p.k + ' not in the URL'));
  assert.ok(rec.url.startsWith('https://dashboard.feedspark.com/image-creator/monsoon-gb/'));
});
t('a ver param is always emitted so a re-render can be forced', () => {
  assert.ok(S.recipeFor(S.compose('clean', {}), {}).params.some((p) => p.k === 'ver'));
});

/* ------------------------------------------------------------------ readiness */
t('readiness splits ready from thin from gaps and counts them in words', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB, { master: S.summon(MON_M_HEAD, MON_M).slots });
  const rd = S.readiness(s);
  assert.ok(rd.ready.length > 0 && rd.thin.length > 0 && rd.gaps.length > 0);
  assert.equal(rd.ready.length + rd.thin.length + rd.gaps.length, S.FACT_IDS.length, 'every fact is in exactly one bucket');
  assert.match(rd.verdict, new RegExp('of ' + S.FACT_IDS.length + ' messages this feed can carry'));
  assert.match(rd.verdict, /on a thin share of the catalogue/);
  assert.equal(rd.masterOnly.length, 2, 'both scarcity messages need the field passing through');
  assert.match(rd.verdict, /needing a field passed through from the master/);
});
t('designsFor says which designs a feed can draw and over how much of it', () => {
  const s = S.summon(MON_FB_HEAD, MON_FB, { master: S.summon(MON_M_HEAD, MON_M).slots });
  const d = S.designsFor(s), by = {}; d.forEach((x) => { by[x.id] = x; });
  assert.equal(by['clean'].state, 'always');
  assert.equal(by['corner-flash'].state, 'thin', 'a third of the catalogue has a sale price');
  assert.equal(by['social-proof'].state, 'no', 'Ads is not read for a Meta feed');
  assert.deepEqual(by['social-proof'].missing, ['Clicks']);
  assert.equal(by['frame'].state, 'thin', 'nothing is missing — the discount band is simply on a third of the feed');
  assert.deepEqual(by['frame'].missing, [], 'thin is not the same finding as partial');
  assert.equal(by['proof-stack'].state, 'no', 'both its facts are Ads facts on a Meta feed');
  assert.equal(d.length, S.DESIGNS.length);
});
t('a feed carrying everything can draw everything', () => {
  const s = S.summon(SCH_HEAD, SCH, { ads: true, adsCov: 0.9 });
  const by = {}; S.designsFor(s).forEach((x) => { by[x.id] = x; });
  assert.equal(by['urgency'].state, 'yes', 'Schuh\'s stock column is in the feed read');
  assert.equal(by['social-proof'].state, 'yes');
  assert.ok(by['corner-flash'].cov > 0.9);
});

/* ------------------------------------------------------------------ shape */
t('the engine is pure — no DOM, canvas or fetch', () => {
  const src = require('node:fs').readFileSync(new URL('../docs/overlay_studio_engine.js', import.meta.url), 'utf8');
  [/\bdocument\./, /\bwindow\.(?!FeedOverlayStudio)/, /getContext\(/, /\bfetch\(/, /localStorage/].forEach((re) => {
    assert.ok(!re.test(src), 'the engine reaches for ' + re);
  });
});
t('it loads as a UMD module and names its version', () => {
  assert.match(S.VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(S.DESIGNS.length >= 12, 'a variety of designs, as asked');
  assert.ok(new Set(S.DESIGNS.map((d) => d.id)).size === S.DESIGNS.length, 'design ids are unique');
  S.DESIGNS.forEach((d) => {
    assert.ok(d.name && d.blurb && d.family, d.id + ' is missing its wording');
    d.zones.forEach((z) => { if (z.fact) assert.ok(S.FACTS[z.fact], d.id + ' names an unknown fact ' + z.fact); });
  });
});
t('every fact declares a source the studio can explain', () => {
  S.FACT_IDS.forEach((f) => {
    const d = S.FACTS[f];
    assert.ok(['feed', 'ads', 'master', 'none'].includes(d.src), f + ' has source ' + d.src);
    assert.ok(d.label && d.ex && d.blurb, f + ' is missing its wording');
  });
});

/* ------------------------------------------------------------------ report */
if (fails.length) { console.error('\n' + fails.length + ' of ' + n + ' FAILED:'); fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }
console.log('✓ overlay studio engine: ' + n + ' checks pass');
