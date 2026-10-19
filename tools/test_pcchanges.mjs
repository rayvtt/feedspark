#!/usr/bin/env node
/* Golden Record — CHANGES ACROSS YOUR PORTFOLIO (Ray, 19 Oct 2026: "monitor the changes on my entire account's
   portfolio … on a weekly basis, how many brands I have worked on, how many fields I worked on … just for the
   account manager").

   Pins the engine's window read (labelguard histWindow / qaFieldMoves / weekRange), the worker route that serves it
   per feed, and the page's counting — lifted out of the page by name and run over the route's own output.

   Run: node tools/test_pcchanges.mjs
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LG = await import(path.join(ROOT, 'cloudflare/feedspark-deck/src/labelguard.js'));
let fail = 0, n = 0;
const ok = (name, cond, extra) => { n++; if (cond) console.log('  ✓ ' + name); else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const T = (d, h) => Date.parse(d + 'T' + String(h || 12).padStart(2, '0') + ':00:00Z');

console.log('-- weekRange: Monday-start calendar weeks');
ok('a Wednesday sits in the week from its Monday, up to today', JSON.stringify(LG.weekRange('2026-10-21', 0)) === '{"from":"2026-10-19","to":"2026-10-21"}', LG.weekRange('2026-10-21', 0));
ok('last week runs Monday to Sunday', JSON.stringify(LG.weekRange('2026-10-21', 1)) === '{"from":"2026-10-12","to":"2026-10-18"}', LG.weekRange('2026-10-21', 1));
ok('a Sunday is the end of its own week, not the start of the next', LG.weekRange('2026-10-18', 0).from === '2026-10-12');

console.log('-- histWindow: the Golden Score over a week');
const prof = LG.profileFor('Northwind', {});
const base = { t: T('2026-10-10'), rows: 1000, cov: { id: 100, title: 100, description: 100, link: 100, image_link: 100, availability: 100, price: 100, brand: 100, gtin: 80, material: 40, pattern: 20 } };
const mid = { t: T('2026-10-13'), rows: 1000, cov: Object.assign({}, base.cov, { material: 70 }) };
const end = { t: T('2026-10-16'), rows: 1000, cov: Object.assign({}, base.cov, { material: 92, pattern: 20.3, product_highlight: 60 }) };
const hist = { v: 1, r: [base, mid, end], s: ['2026-10-10', '2026-10-13', '2026-10-16'], q: [] };
const w = LG.histWindow(hist, prof, { from: '2026-10-12', to: '2026-10-18' });
ok('the base is the last reading BEFORE the week, the close its last reading in it',
  w.gs && w.gs.state === 'moved' && w.gs.from === LG.histScore(base, prof) && w.gs.to === LG.histScore(end, prof), w.gs);
ok('a field that moved is named with its from → to; a 0.3-point wobble is not',
  w.gs.fields.some((m) => m[0] === 'material' && m[1] === 40 && m[2] === 92) && !w.gs.fields.some((m) => m[0] === 'pattern'), w.gs.fields);
ok('a field that appeared counts', w.gs.fields.some((m) => m[0] === 'product_highlight' && m[1] == null && m[2] === 60));
ok('the scan days inside the week are counted', w.scans === 2, w.scans);
ok('a market that moved is changed', w.changed === true);
const quiet = LG.histWindow(hist, prof, { from: '2026-10-19', to: '2026-10-25' });
ok('a week with no reading is no change, never a zero score', quiet.gs === null && quiet.changed === false, quiet);
const fresh = LG.histWindow({ v: 1, r: [end], s: [], q: [] }, prof, { from: '2026-10-12', to: '2026-10-18' });
ok('a feed first read inside the week is NEW — its whole record is not a week of work', fresh.gs.state === 'new' && !fresh.changed && fresh.gs.fields.length === 0, fresh.gs);
const basisEnd = Object.assign({}, end, { sc: { color: 500 } });
const bas = LG.histWindow({ v: 1, r: [base, basisEnd], s: [], q: [] }, prof, { from: '2026-10-12', to: '2026-10-18' });
ok('two readings on different bases are never compared', bas.gs.state === 'basis' && !bas.changed, bas.gs);
const live = LG.histWindow({ v: 1, r: [base], s: [], q: [] }, prof, { from: '2026-10-12', to: '2026-10-18', live: end });
ok('the estate index’s live reading closes the week when it is newer than the record', live.gs.state === 'moved' && live.gs.to === LG.histScore(end, prof));
ok('a bad window reads nothing', LG.histWindow(hist, prof, { from: '2026-10-18', to: '2026-10-12' }).gs === null);

console.log('-- histWindow: the two analyses');
const matRule = (LG.qspecOf('material').rules[0] || {}).id;
const qa1 = { t: T('2026-10-09'), q: 61, air: 50, qa: { material: { s: 52, f: 800, b: { [matRule]: 420 } }, title: { s: 90, f: 1000, b: { caps: 10 } } }, ap: { taxonomy: 40, titles: 70 } };
const qa2 = { t: T('2026-10-15'), q: 67, air: 52, m: 1, qa: { material: { s: 96, f: 800, b: { [matRule]: 30 } }, title: { s: 90.2, f: 1000, b: { caps: 9 } } }, ap: { taxonomy: 52, titles: 70 } };
const wq = LG.histWindow({ v: 1, r: [], s: [], q: [qa1, qa2] }, prof, { from: '2026-10-12', to: '2026-10-18' });
ok('content quality from → to with its Δ', wq.q && wq.q.state === 'moved' && wq.q.from === 61 && wq.q.to === 67 && wq.q.d === 6, wq.q);
ok('…the field that moved with the product values it fixed; a 0.2 wobble is not a field',
  wq.q.fields.length === 1 && wq.q.fields[0].k === 'material' && wq.q.fields[0].fixed === 390, wq.q.fields);
ok('AI-readiness names its pillar', wq.air.fields.length === 1 && wq.air.fields[0].k === 'taxonomy' && wq.air.fields[0].d === 12, wq.air.fields);
ok('an analysis run by hand inside the week is counted', wq.hand === 1, wq.hand);
const old = LG.histWindow({ v: 1, r: [], s: [], q: [{ t: T('2026-10-09'), q: 61 }, { t: T('2026-10-15'), q: 67 }] }, prof, { from: '2026-10-12', to: '2026-10-18' });
ok('analyses from before field detail still give their move — and say they cannot name fields', old.q.d === 6 && old.q.fields.length === 0 && old.q.detail === false, old.q);

console.log('-- the browser copy and the worker');
ok('the browser copy of the engine is the engine', fs.readFileSync(path.join(ROOT, 'docs/labelguard_engine.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/labelguard.js'), 'utf8'));
const W = fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');
ok('the route reads every feed through histWindow under the brand’s profile', /path === '\/api\/golden\/changes'[^]*?histWindow\(hists\[i\], pf, \{ from, to, live \}\)/.test(W));
ok('it shares the portfolio trend’s feed list (same scope, same AM)', (W.match(/await goldenFeedList\(env, acc\)/g) || []).length === 2 && /async function goldenFeedList\(env, acc\)[^]*?clientMatch\(acc\.clients, f\.client\)/.test(W));

console.log('-- the page: what it counts');
const P = fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_GoldenRecord.html'), 'utf8');
const lift = (name) => {
  const i = P.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  let d = 0, j = P.indexOf('{', i);
  for (let k = j; k < P.length; k++) { if (P[k] === '{') d++; else if (P[k] === '}') { d--; if (!d) return P.slice(i, k + 1); } }
  throw new Error('unclosed ' + name);
};
const ctx = {};
vm.createContext(ctx);
vm.runInContext(lift('pcTotals') + ';' + lift('pcRange') + ';' + lift('pcDay'), ctx);
const feeds = [
  Object.assign({ client: 'Northwind', mkt: 'gb' }, w),
  Object.assign({ client: 'Northwind', mkt: 'de' }, quiet),
  Object.assign({ client: 'Atelier', mkt: 'gb' }, wq),
  Object.assign({ client: 'Harbour', mkt: 'gb' }, fresh),
];
const t = ctx.pcTotals(feeds);
ok('brands changed counts each brand once, of every brand in view', t.brands === 2 && t.brandsAll === 3, t);
ok('markets changed of markets in view', t.mk === 2 && t.mkAll === 4, t);
ok('feed fields and content fields are counted apart, with the product values fixed', t.gsF === w.gs.fields.length && t.qF === 1 && t.fixed === 390, t);
ok('Golden Score up / down counts markets', t.gsUp === 1 && t.gsDn === 0, t);
ok('a market first read this week is counted as new, not as changed', t.fresh === 1, t);
const r = ctx.pcRange('w1');
ok('the page’s week matches the engine’s', JSON.stringify(r) === JSON.stringify(LG.weekRange(new Date().toISOString().slice(0, 10), 1)), r);
ok('the section folds and remembers it on this device', /id="pc-h" role="button" tabindex="0" aria-expanded="true"/.test(P) && /localStorage\.setItem\('gr-pc-fold'/.test(P));
ok('it is the AM’s, never a client screen share', /body\.demo #sec-pc\{display:none!important\}/.test(P));

console.log(fail ? '\n✗ ' + fail + ' of ' + n + ' failed' : '\n✓ ' + n + ' — changes across the portfolio: read per feed, counted per brand');
process.exit(fail ? 1 : 0);
