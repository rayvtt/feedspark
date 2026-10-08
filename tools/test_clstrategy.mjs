#!/usr/bin/env node
/* Custom label STRATEGY (Ray, 8 Oct 2026: "the custom label strategy must be diverse, dynamic, and KPI-oriented … scan the
   custom label values to understand what they represent, identify the strategy type, and score against it").
   The engine half: labelguard.js clValueKind / clLabelKind / clMoved / clStrategy on value shapes the estate carries.
   Run: node tools/test_clstrategy.mjs */
import * as LG from '../cloudflare/feedspark-deck/src/labelguard.js';
let fail = 0, pass = 0;
const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

console.log('── a value names its strategy');
const T = [['Best Sellers', 'perf'], ['bestseller', 'perf'], ['Zombie 1', 'perf'], ['High ROAS', 'perf'], ['Top 100', 'perf'],
  ['RC 80%+', 'stock'], ['Range Completion <50%', 'stock'], ['Low stock', 'stock'], ['Hero Sizes', 'stock'], ['Broken size run', 'stock'],
  ['High margin', 'margin'], ['GP Band A', 'margin'], ['£50-100', 'price'], ['Under 25', 'price'], ['Premium', 'price'],
  ['New In', 'life'], ['SS26', 'life'], ['Carryover', 'life'], ['Clearance', 'life'], ['Black Friday', 'promo'], ['Sale', 'promo'],
  ['Womens', 'merch'], ['Dresses', 'merch'], ['Off White', 'merch'],
  ['High', 'level'], ['Medium', 'level'], ['low', 'level'], ['45%', 'pct'], ['80-100%', 'pct'],
  ['#N/A', 'none'], ['', 'none'], ['a3f9c1d2e4b5a6f7c8d9e0f1', 'none'], ['3', 'none'], ['null', 'none']];
for (const [v, k] of T) ok('"' + v + '" → ' + k, LG.clValueKind(v) === k, LG.clValueKind(v));

console.log('── a label is the strategy its products mostly carry');
const L = (vals, extra) => Object.assign({ present: true, filled: vals.reduce((a, v) => a + v[1], 0), cov: 80, distinct: vals.length, values: vals }, extra || {});
let c = LG.clLabelKind(L([['High', 300], ['Medium', 500], ['Low', 200]]), 'custom_label_2');
ok('bare high / medium / low reads as margin — and says it is inferred', c.kind === 'margin' && c.inferred, c);
c = LG.clLabelKind(L([['High', 300], ['Low', 200]]), 'stock_level');
ok('…unless the column names what is high (stock), then it is that and not inferred', c.kind === 'stock' && !c.inferred, c);
c = LG.clLabelKind(L([['20%', 100], ['60%', 300], ['100%', 600]]), 'custom_label_1');
ok('bare percentages read as range completion, inferred', c.kind === 'stock' && c.inferred, c);
c = LG.clLabelKind(L([['Best Sellers', 400], ['Zombies', 300], ['Womens', 50]]), 'x');
ok('a label of best sellers and zombies is performance', c.kind === 'perf' && c.share > 90, c);
c = LG.clLabelKind(L([['New In', 300], ['Sale', 300], ['Womens', 300]]), 'x');
ok('a label no strategy covers half of is unclear, with its reason', c.kind === 'unclear' && /half/.test(c.why), c);
c = LG.clLabelKind(L([['a3f9c1d2e4b5a6f7c8d9e0f1', 900]]), 'x');
ok('a label of ids names nothing — unclear, never guessed', c.kind === 'unclear' && /ids/.test(c.why), c);
ok('a label not in the feed is empty', LG.clLabelKind({ present: false }).kind === 'empty');

console.log('── moved: the share of products that changed segment');
ok('400 → 300 best sellers and 300 → 400 zombies on 700 = 14.3%', LG.clMoved(L([['Best Sellers', 300], ['Zombies', 400]]), L([['Best Sellers', 400], ['Zombies', 300]])) === 14.3);
ok('identical readings moved 0', LG.clMoved(L([['a', 5]]), L([['a', 5]])) === 0);
ok('no reference → not measurable (null)', LG.clMoved(L([['a', 5]]), null) === null);

console.log('── the score');
const now = Date.now();
const snap = { t: now, rows: 1000, labels: {
  custom_label_0: L([['Best Sellers', 300], ['Zombies', 400]], { cov: 70 }),
  custom_label_1: L([['RC 80%+', 600], ['RC <50%', 300]], { cov: 90 }),
  custom_label_2: L([['High', 300], ['Medium', 500], ['Low', 200]], { cov: 100 }),
  custom_label_3: L([['Womens', 600], ['Mens', 400]], { cov: 100 }),
  custom_label_4: { present: false } } };
const ref = { t: now - 7 * 864e5, labels: JSON.parse(JSON.stringify(snap.labels)) };
ref.labels.custom_label_0.values = [['Best Sellers', 400], ['Zombies', 300]];
let r = LG.clStrategy(snap, ref);
ok('three KPI strategies found: performance, stock, margin', ['perf', 'stock', 'margin'].every((k) => r.kinds[k]) && r.have.length === 3, r.have);
ok('strategies = (30 + 25 + 20) / 100 × 60 = 45', r.parts.strat === 45, r.parts);
ok('diversity: three or more = 15', r.parts.div === 15);
ok('reach = the KPI labels\' average coverage (70, 90, 100 → 86.7%) → 8.7 of 10', r.parts.reach === 8.7, r.parts);
ok('dynamism: 1 of 3 KPI labels moved → 5 of 15', r.parts.dyn === 5, r.parts);
ok('score = the four parts added', r.score === Math.round((45 + 15 + 8.7 + 5) * 10) / 10, r.score);
ok('the gender label is descriptive, named as such', r.descr.indexOf(3) >= 0 && r.slots[3].kind === 'merch');
ok('CL4 not in the feed is a free slot', r.spare.indexOf(4) >= 0);
ok('price is the strategy still missing (lifecycle too)', r.missing.indexOf('price') >= 0 && r.missing.indexOf('life') >= 0, r.missing);
r = LG.clStrategy(snap, null);
ok('with no earlier reading, dynamism is NOT MEASURED (null), never a zero', r.parts.dyn === null && r.refT === null);
ok('…and the other 85 points are scaled to 100', r.score === Math.round((45 + 15 + 8.7) / 85 * 100 * 10) / 10, r.score);
r = LG.clStrategy(snap, { t: now + 1, labels: snap.labels });
ok('a "reference" newer than the reading is not a reference', r.parts.dyn === null);
const flat = { t: now, rows: 100, labels: { custom_label_0: L([['Womens', 50]]), custom_label_1: { present: false } } };
r = LG.clStrategy(flat, null);
ok('labels with no KPI signal score 0 and say so', r.score === 0 && r.verdict.pill === 'No KPI strategy', r);
ok('the verdict bands: 85+ KPI-driven, 60+ partly, under 60 descriptive', LG.clVerdict(90, 3).pill === 'KPI-driven' && LG.clVerdict(70, 2).pill === 'Partly KPI-driven' && LG.clVerdict(40, 1).pill === 'Mostly descriptive');
ok('no snapshot → null', LG.clStrategy(null) === null);

console.log('── what the AM sets for a brand (Ray: "customizable for the account manager … saved going forward")');
// a feed shaped like Superdry GB's (the value WORDS as the feed carries them; the counts invented)
const sd = { t: now, rows: 1000, labels: {
  custom_label_0: L([['FULL', 550], ['SALE', 450]], { cov: 100 }),
  custom_label_1: L([['Lightweight Jackets', 40], ['Zombie', 25], ['Everest', 15]], { cov: 8 }),
  custom_label_2: L([['Hoodies & Sweatshirts', 300], ['T-Shirts', 250], ['Jackets & Coats', 250]], { cov: 99 }),
  custom_label_3: L([['Female', 560], ['Male', 430], ['Unisex', 10]], { cov: 100 }),
  custom_label_4: { present: false } } };
let a = LG.clStrategy(sd, null);
ok('FULL / SALE reads as a promotion label (full price vs on sale)', a.slots[0].kind === 'promo', a.slots[0]);
ok('a label of jackets that also carries "Zombie" names the performance signal beside it', a.slots[1].kind === 'merch' && a.slots[1].also.some((x) => x.k === 'perf' && x.v === 'Zombie'), a.slots[1]);
ok('the category and gender labels are descriptive', a.slots[2].kind === 'merch' && a.slots[3].kind === 'merch');
const cfg = { slots: { 1: 'perf' }, strat: { perf: 'need', margin: 'need', life: 'need', price: 'elsewhere', stock: 'na' } };
a = LG.clStrategy(sd, null, cfg);
ok('the AM sets CL1 as performance: it counts, marked set by hand, the reading kept beside it', a.slots[1].kind === 'perf' && a.slots[1].set && a.slots[1].auto === 'merch' && !a.slots[1].inferred, a.slots[1]);
ok('"carried elsewhere" counts as carried, with no label behind it', a.carried.indexOf('price') >= 0 && a.elsewhere.indexOf('price') >= 0 && !a.kinds.price);
ok('"not relevant" leaves the denominator: (30 perf + 5 promo + 10 price) ÷ (100 − 25 stock) × 60 = 36', a.parts.strat === 36, a.parts);
ok('…and is never a gap', a.missing.indexOf('stock') < 0 && a.na.indexOf('stock') >= 0);
ok('the priorities still open are margin and lifecycle — performance is now carried', a.priority.join() === 'margin,life', a.priority);
ok('diversity counts what is carried, against what is still expected', a.parts.div === 15, a.parts);
ok('reach reads the label-carried strategies only (perf 8% + promo 100%)', a.reach === 54, a.reach);
ok('the record says it was customised', a.custom === true && LG.clStrategy(sd, null).custom === false);
ok('a slot set on a label the feed does not carry is ignored', LG.clStrategy(sd, null, { slots: { 4: 'margin' } }).slots[4].kind === 'empty');
ok('"none" marks a slot as no strategy', LG.clStrategy(sd, null, { slots: { 0: 'none' } }).slots[0].kind === 'unclear');
const cc = LG.cleanClCfg({ slots: { 0: 'perf', 1: 'bogus', 9: 'margin', '2': 'stock' }, strat: { perf: 'need', margin: 'x', merch: 'na', stock: 'elsewhere' }, by: 'a@b', at: 5, extra: 1 });
ok('a stored record carries only known slots, kinds and states', JSON.stringify(cc) === JSON.stringify({ slots: { 0: 'perf', 2: 'stock' }, strat: { perf: 'need', stock: 'elsewhere' }, by: 'a@b', at: 5 }), cc);
ok('no record = the automated reading, exactly', JSON.stringify(LG.clStrategy(snap, ref, null).parts) === JSON.stringify(LG.clStrategy(snap, ref).parts));

console.log(fail ? '\n✗ custom label strategy: ' + fail + ' failed, ' + pass + ' passed' : '\n✓ custom label strategy: ' + pass + ' passed');
process.exit(fail ? 1 : 0);
