/*
 * New-product ARRIVALS harness (Ray, 15 Sep 2026): first-seen dates (c:fs_date_of_birth) →
 * per month / quarter / year + the run-rate forecast. Pins (1) the engine's maths on a fixed
 * clock, (2) that labelguard's xmlCollector histograms the field off a real XML stream with the
 * SAME parsing as the engine (Shopping feeds only — a -fb market captures nothing), (3) the
 * worker's dobStore (lifted by name) — sanitising, the per-feed record, the estate index, the
 * -fb refusal. Run: node tools/test_arrivals.mjs   (pure node — part of qa_gate / presync / validate)
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as LG from '../cloudflare/feedspark-deck/src/labelguard.js';
const require = createRequire(import.meta.url);
const AR = require('../docs/arrivals_engine.js');
const FA = require('../docs/feedlab_engine.js');
let passed = 0, failed = 0;
function ok(c, l, info) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ FAIL: ' + l + (info ? '  → ' + String(info).slice(0, 400) : '')); } }
const eq = (l, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), l, JSON.stringify(a) + ' vs ' + JSON.stringify(b));

console.log('— engine: parsing —');
eq('dobMonth: a plain date', AR.dobMonth('2026-05-22'), '2026-05');
eq('dobMonth: a timestamp starting with the date', AR.dobMonth('2025-11-03 14:22:01'), '2025-11');
eq('dobMonth: junk / out-of-range → null', [AR.dobMonth(''), AR.dobMonth('22/05/2026'), AR.dobMonth('2026-13-01'), AR.dobMonth('1999-01-01')], [null, null, null, null]);
ok('isDobHeader resolves c:fs_date_of_birth type="string" / fs_date_of_birth / g:fs_date_of_birth', AR.isDobHeader('c:fs_date_of_birth type="string"') && AR.isDobHeader('fs_date_of_birth') && AR.isDobHeader('g:FS_Date_Of_Birth') && !AR.isDobHeader('c:fs_something'));
const col = AR.dobCollector(); ['2026-09-01', '2026-09-14', '2026-08-03', 'bad', '', '2025-12-31'].forEach((v) => col.add(v));
eq('collector: n / bad / months / min / max', col.finish(), { n: 4, bad: 1, m: { '2026-09': 2, '2026-08': 1, '2025-12': 1 }, min: '2025-12-31', max: '2026-09-14' });

console.log('\n— engine: stats on a fixed clock (15 Sep 2026) —');
const NOW = new Date('2026-09-15T10:00:00Z');
// a feed born Jan 2026: 100/mo Jan–Mar, 200/mo Apr–Jun, 300 Jul, 330 Aug, 90 so far in Sep
const M = { '2026-01': 100, '2026-02': 100, '2026-03': 100, '2026-04': 200, '2026-05': 200, '2026-06': 200, '2026-07': 300, '2026-08': 330, '2026-09': 90 };
const st = AR.stats({ n: 1620, m: M }, NOW, 3000);
eq('months: 24 entries ending at the current month, the current one partial', [st.months.length, st.months[23].k, st.months[23].complete, st.months[23].n], [24, '2026-09', false, 90]);
ok('observed starts at the first first-seen month (Dec 2025 unobserved, Jan 2026 observed)', st.months.find((x) => x.k === '2025-12').observed === false && st.months.find((x) => x.k === '2026-01').observed === true);
eq('lastFull = Aug 2026 (330); fullMonths = 8', [st.lastFull.k, st.lastFull.n, st.fullMonths], ['2026-08', 330, 8]);
ok('m3 = mean(Jun, Jul, Aug) = 276.67 · m6 = mean(Mar..Aug) = 221.67', Math.abs(st.m3 - 830 / 3) < 0.01 && Math.abs(st.m6 - 1330 / 6) < 0.01, st.m3 + ' ' + st.m6);
eq('y12 = the 8 complete months (1,530) — y12Months says 8, never a fake 12', [st.y12, st.y12Months], [1530, 8]);
eq('forecast = round(m3) per month, ×3, ×12, basis "the last 3 complete months"', st.forecast, { month: 277, quarter: 830, year: 3320, basis: 'the last 3 complete months' });
eq('quarters: calendar, current flagged partial', st.quarters, [{ q: '2026 Q1', n: 300, partial: false }, { q: '2026 Q2', n: 600, partial: false }, { q: '2026 Q3', n: 720, partial: true }]);
eq('years: 2026 partial', st.years, [{ y: '2026', n: 1620, partial: true }]);
ok('coverage = n / rows = 54%', Math.abs(st.coverage - 0.54) < 0.001, st.coverage);
const st2 = AR.stats({ n: 40, m: { '2026-09': 40 } }, NOW, 40);
eq('a feed with only the current (partial) month forecasts off "the current month so far"', [st2.forecast.month, st2.forecast.basis, st2.lastFull, st2.m3], [40, 'the current month so far', null, null]);
eq('no data → no forecast, honest nulls', [AR.stats(null, NOW, 0).forecast, AR.stats({ m: {} }, NOW, 10).y12], [null, null]);

console.log('\n— collector inside labelguard.xmlCollector over a real XML stream —');
const item = (id, dob, extra) => '<item><g:id>' + id + '</g:id><g:title>T</g:title><g:product_type>Women &gt; Dresses</g:product_type>'
  + (dob != null ? '<c:fs_date_of_birth type="string">' + dob + '</c:fs_date_of_birth>' : '') + (extra || '') + '</item>';
let xml = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0" xmlns:c="http://base.google.com/cns/1.0"><channel>';
for (let i = 1; i <= 30; i++) xml += item('a' + i, '2026-08-' + String(1 + (i % 28)).padStart(2, '0'));
for (let i = 1; i <= 12; i++) xml += item('b' + i, '2026-09-0' + (1 + (i % 9)));
xml += item('c1', 'not a date') + item('c2', null) + item('c3', '2024-02-29');
xml += '</channel></rss>';
const run = (market) => { const c = LG.xmlCollector({ client: 'Reiss', market }); const p = FA.createXmlParser(c.onRow);
  for (let o = 0; o < xml.length; o += 501) p.push(xml.slice(o, o + 501)); p.end(); return c.finish(); };
const g = run('gb');
eq('Shopping feed: 45 rows; dob n=43 (30 Aug + 12 Sep + 1 Feb-2024), 1 bad, min/max', [g.snap.rows, g.vol.dob.n, g.vol.dob.bad, g.vol.dob.m['2026-08'], g.vol.dob.m['2026-09'], g.vol.dob.m['2024-02'], g.vol.dob.min, g.vol.dob.max],
  [45, 43, 1, 30, 12, 1, '2024-02-29', '2026-09-09']);
ok('the collector and the engine agree on every value', (() => { const c = AR.dobCollector(); for (let i = 1; i <= 30; i++) c.add('2026-08-' + String(1 + (i % 28)).padStart(2, '0')); for (let i = 1; i <= 12; i++) c.add('2026-09-0' + (1 + (i % 9))); c.add('not a date'); c.add('2024-02-29'); const e = c.finish(); return JSON.stringify(e) === JSON.stringify(g.vol.dob); })(), JSON.stringify(g.vol.dob));
ok('the id set / labels capture is untouched by the new field', g.vol.ids.split('\n').length === 45 && g.snap.labels.product_type.filled === 45);
const fb = run('gb-fb');
ok('a Meta (-fb) feed captures NO first-seen histogram (Shopping feeds only)', fb.vol.dob === null && fb.snap.rows === 45);
const noField = (() => { const c = LG.xmlCollector({ client: 'X', market: 'gb' }); const p = FA.createXmlParser(c.onRow); p.push('<rss><channel>' + '<item><g:id>1</g:id><g:title>T</g:title></item>'.repeat(3) + '</channel></rss>'); p.end(); return c.finish(); })();
ok('a feed without the field → dob null (never an empty histogram mistaken for zero arrivals)', noField.vol.dob === null);

console.log('\n— worker: dobStore lifted by name —');
const src = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
const a = src.indexOf('const DOB_MONTHS_CAP'), b = src.indexOf('\n// ---- Daily product-volume tracking', a);
if (a < 0 || b < 0) { console.error('✗ dobStore block not found in worker.js'); process.exit(1); }
const { dobStore } = new Function(src.slice(a, b) + '\nreturn { dobStore };')();
const store = {};
const env = { EDITS: { get: async (k, t) => (store[k] == null ? null : (t === 'json' ? JSON.parse(store[k]) : store[k])), put: async (k, v) => { store[k] = v; } } };
const r1 = await dobStore(env, 'Reiss', 'gb', 45, g.vol.dob);
const rec = JSON.parse(store['voldob:Reiss:gb']), idx = JSON.parse(store['voldobidx']);
eq('per-feed record: rows + histogram + n/min/max, stamped', [r1, rec.rows, rec.n, rec.m['2026-08'], rec.min, typeof rec.t], [{ n: 43, months: 3 }, 45, 43, 30, '2024-02-29', 'number']);
ok('estate index carries the feed (client|mkt) with its months', idx['Reiss|gb'] && idx['Reiss|gb'].m['2026-09'] === 12 && idx['Reiss|gb'].rows === 45 && idx['Reiss|gb'].client === 'Reiss');
ok('a -fb market is refused; junk histograms are refused', (await dobStore(env, 'Reiss', 'gb-fb', 45, g.vol.dob)) === null && (await dobStore(env, 'Reiss', 'gb', 45, { m: 'nope' })) === null && (await dobStore(env, 'Reiss', 'gb', 45, null)) === null);
const r2 = await dobStore(env, 'Reiss', 'gb', 10, { n: 'x', m: { '2026-09': '7', 'bad-key': 5, '2026-08': -3, '2020-01': 2.4 }, min: '2020-01-05', max: 'nope' });
eq('sanitising: bad keys dropped, negatives dropped, values rounded, n recomputed, max invalid → null', [r2, JSON.parse(store['voldob:Reiss:gb']).m, JSON.parse(store['voldob:Reiss:gb']).n, JSON.parse(store['voldob:Reiss:gb']).max], [{ n: 9, months: 2 }, { '2020-01': 2, '2026-09': 7 }, 9, null]);
ok('the index keeps the OTHER feeds when one is re-stored', Object.keys(JSON.parse(store['voldobidx'])).length === 1);

console.log('\nRESULT: ' + (failed ? 'FAIL — ' + failed + ' failed, ' : 'PASS — ') + passed + ' assertions');
process.exit(failed ? 1 : 0);
