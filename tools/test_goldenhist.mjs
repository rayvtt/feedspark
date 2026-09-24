#!/usr/bin/env node
/* GOLDEN SCORE HISTORY — the engine, the worker's wiring and the page's twin (Ray, 24 Sep 2026:
   "Can the Golden Score module record historic changes in terms of improvement or deduction from
   the previous scan … good to show clients on improvement progress … also track it on a
   day-to-day basis, similar to [product] volumes").

   What has to stay true, and why each one matters:
     · a reading is what the score is computed FROM, never the score — so the page can re-score
       the whole record against today's profile and a profile edit never reads as the feed moving;
     · a scan that moved nothing on a day already recorded writes NOTHING — four identical scans a
       day must not cost four KV writes or fill the change log with non-events;
     · drift below the threshold accumulates against the last RECORDED reading — a slow slide is
       still caught;
     · a day nobody scanned is absent from the calendar, so the chart can draw it as a gap;
     · a snapshot measured on another basis (before GPC category scope) never seeds the past.
   The page's histMoved is a hand-written twin of the engine's: lifted by name and run against the
   same table, so the change log can never describe a move differently from the one recorded.

   Run: node tools/test_goldenhist.mjs   (qa_gate / presync / validate) */
import { readFileSync } from 'node:fs';
import * as LG from '../cloudflare/feedspark-deck/src/labelguard.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};
const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const DAY = 864e5;
const T0 = Date.UTC(2026, 8, 1, 9);                     // 1 Sep 2026 09:00 UTC
const snap = (t, cov, extra) => {
  const attrs = {};
  Object.keys(cov).forEach((k) => { attrs[k] = cov[k] == null ? { present: false } : { present: true, cov: cov[k] }; });
  return Object.assign({ t, rows: 1000, attrs }, extra || {});
};
const COV = { id: 100, title: 100, description: 95, link: 100, image_link: 100, availability: 100, price: 100, brand: 100, material: 40 };

console.log('── a reading');
{
  const r = LG.histReading(snap(T0, Object.assign({}, COV, { pattern: null, color: 88.349 })));
  ok('carries the coverage the score is computed from, not the score', r && r.cov.material === 40 && !('score' in r), r);
  ok('an attribute not in the feed is simply absent from the map', !('pattern' in r.cov));
  ok('coverage is kept to one decimal', r.cov.color === 88.3, r.cov.color);
  ok('rows and time ride along', r.rows === 1000 && r.t === T0);
  ok('no category-scope map on a reading measured without one', !('sc' in r));
  const s2 = snap(T0, COV);
  s2.attrs.size = { present: false, na: true, scope: { n: 0, f: 0, u: 0, t: 1000 } };
  s2.attrs.color = { present: true, cov: 50, scope: { n: 20, f: 10, u: 0, t: 1000 } };
  const r2 = LG.histReading(s2);
  ok('a scoped reading keeps its in-scope counts — 0 is what makes an attribute "not applicable"', r2.sc && r2.sc.size === 0 && r2.sc.color === 20, r2.sc);
  ok('…and never a coverage for an attribute nobody is asked for', !('size' in r2.cov));
  ok('a snapshot with no attributes is no reading', LG.histReading(null) === null && LG.histReading({ t: 1 }) === null);
}

console.log('── what moved');
{
  const a = { t: 1, rows: 1, cov: { material: 40, color: 90, title: 100 } };
  const b = { t: 2, rows: 1, cov: { material: 55, color: 89.97, pattern: 20 } };
  const mv = LG.histMoved(a, b);
  ok('an attribute that appeared or vanished outranks any coverage move',
    mv[0][0] === 'pattern' && mv[0][1] === null && mv[0][2] === 20 && mv[1][0] === 'title' && mv[1][2] === null, mv);
  ok('then coverage moves, biggest first', mv[2][0] === 'material' && mv[2][1] === 40 && mv[2][2] === 55, mv);
  ok('rounding noise is not a move', !mv.some((m) => m[0] === 'color'), mv);
  const na = LG.histMoved({ t: 1, cov: {}, sc: { size: 5 } }, { t: 2, cov: {}, sc: { size: 0 } });
  ok('an attribute going out of scope is a move of its own kind', na.length === 1 && na[0][0] === 'size' && na[0][1] === null && na[0][2] === 'na', na);
}

console.log('── did the feed move');
{
  const a = { t: 1, rows: 1, cov: { material: 40 } };
  ok('0.4pp is below the recording threshold', !LG.histChanged(a, { t: 2, cov: { material: 40.4 } }));
  ok('0.5pp is a move', LG.histChanged(a, { t: 2, cov: { material: 40.5 } }));
  ok('an attribute appearing is a move whatever its coverage', LG.histChanged(a, { t: 2, cov: { material: 40, pattern: 1 } }));
  ok('a change of measuring basis is recorded (so the page can refuse to compare it)', LG.histChanged(a, { t: 2, cov: { material: 40 }, sc: { color: 3 } }));
  ok('the first reading always records', LG.histChanged(undefined, a));
  ok('the threshold is the one documented', LG.HIST_MOVE_PP === 0.5);
}

console.log('── recording scans');
{
  const R = (t, patch) => LG.histReading(snap(t, Object.assign({}, COV, patch || {})));
  let h = null, writes = 0;
  const add = (r) => { const x = LG.histAdd(h, r); h = x.hist; if (x.wrote) writes++; return x.wrote; };
  ok('the first scan writes the day and the reading', add(R(T0)) && h.r.length === 1 && h.s.length === 1);
  ok('three more identical scans that day write NOTHING', !add(R(T0 + 6 * 3600e3)) && !add(R(T0 + 12 * 3600e3)) && !add(R(T0 + 13 * 3600e3)) && writes === 1, writes);
  ok('a move later the same day records a reading, not a second day', add(R(T0 + 14 * 3600e3, { material: 55 })) && h.r.length === 2 && h.s.length === 1);
  ok('the next day with no move adds the DAY only — the chart knows it was scanned', add(R(T0 + DAY, { material: 55 })) && h.r.length === 2 && h.s.length === 2);
  ok('a day nobody scanned never appears in the calendar', !h.s.includes(LG.histDay(T0 + 2 * DAY)) && add(R(T0 + 3 * DAY, { material: 55 })) && h.s.length === 3);
  add(R(T0 + 4 * DAY, { material: 55.3 }));
  add(R(T0 + 5 * DAY, { material: 55.6 }));
  ok('drift under the threshold accumulates against the last RECORDED reading — a slow slide is caught',
    h.r.length === 3 && h.r[2].cov.material === 55.6, h.r.map((x) => x.cov.material));
  const before = JSON.stringify(h);
  ok('a reading older than the last one never rewrites the past', !LG.histAdd(h, R(T0 + 2 * DAY, { material: 99 })).wrote && JSON.stringify(h) === before);
  ok('the record never mutates what it was handed', (() => { const src = LG.histAdd(null, R(T0)).hist; const snapBefore = JSON.stringify(src); LG.histAdd(src, R(T0 + DAY, { material: 70 })); return JSON.stringify(src) === snapBefore; })());
}

console.log('── keeping a year of it');
{
  let h = null;
  // four scans a day for 400 days, the feed moving every scan
  for (let d = 0; d < 400; d++) {
    for (let s = 0; s < 4; s++) {
      h = LG.histAdd(h, LG.histReading(snap(T0 + d * DAY + s * 6 * 3600e3, Object.assign({}, COV, { material: (d * 4 + s) % 2 ? 40 : 60 })))).hist;
    }
  }
  const last = h.r[h.r.length - 1].t, cut = last - LG.HIST_RECENT_DAYS * DAY;
  const recent = h.r.filter((x) => x.t >= cut), old = h.r.filter((x) => x.t < cut);
  const perDay = {};
  old.forEach((x) => { const d = LG.histDay(x.t); perDay[d] = (perDay[d] || 0) + 1; });
  ok('the last month keeps every move, scan by scan', recent.length >= LG.HIST_RECENT_DAYS * 4 - 4, recent.length);
  ok('older days keep ONE reading — the day\'s close', Object.keys(perDay).every((d) => perDay[d] === 1), Object.values(perDay).slice(0, 5));
  ok('…the LAST reading of that day', old.every((x) => new Date(x.t).getUTCHours() === 3 || new Date(x.t).getUTCHours() === 15 || new Date(x.t).getUTCHours() === 21), old.slice(0, 3).map((x) => new Date(x.t).getUTCHours()));
  ok('the record is capped', h.r.length <= LG.HIST_MAX && h.s.length <= LG.HIST_DAYS_MAX, [h.r.length, h.s.length]);
  const bytes = JSON.stringify(h).length;
  ok('a year of a busy feed stays a modest KV value', bytes < 400000, bytes);
}

console.log('── a fresh record, seeded from the past the stores already hold');
{
  const cur = LG.histReading(snap(T0 + 5 * DAY, COV));
  const base = snap(T0, Object.assign({}, COV, { material: 20 }));
  const prev = snap(T0 + 4 * DAY, Object.assign({}, COV, { material: 30 }));
  const h = LG.histSeed([prev, base], cur);
  ok('the known-good and the previous scan become real past readings, oldest first',
    h.r.length === 3 && h.r[0].cov.material === 20 && h.r[1].cov.material === 30 && h.r[2].cov.material === 40, h.r.map((x) => x.cov.material));
  ok('…and their days are scan days', h.s.length === 3);
  const scoped = snap(T0 + 5 * DAY, COV);
  scoped.attrs.color = { present: true, cov: 50, scope: { n: 20, f: 10, u: 0, t: 1000 } };
  const h2 = LG.histSeed([base, prev], LG.histReading(scoped));
  ok('a snapshot measured before category scope never seeds a scoped record — a different measurement is not a past score', h2.r.length === 1, h2.r.length);
  const h3 = LG.histSeed([null, snap(T0 + 9 * DAY, COV)], cur);
  ok('nothing missing or newer than today\'s reading is seeded', h3.r.length === 1);
}

console.log('── content quality and AI-readiness, as analysed');
{
  let h = LG.histAdd(null, LG.histReading(snap(T0, COV))).hist;
  let x = LG.histQa(h, { t: T0 + 1000, q: 72.44, air: 55, tier: 2 });
  ok('the first analysis is recorded', x.wrote && x.hist.q.length === 1 && x.hist.q[0].q === 72.4 && x.hist.q[0].tier === 2, x.hist.q);
  h = x.hist;
  ok('the same figures again are not a new point', !LG.histQa(h, { t: T0 + 2000, q: 72.4, air: 55 }).wrote);
  x = LG.histQa(h, { t: T0 + 3000, q: 80.5, air: 55 });
  ok('a moved figure is', x.wrote && x.hist.q.length === 2);
  ok('an analysis never touches the readings or the scan days', x.hist.r.length === h.r.length && x.hist.s.length === h.s.length);
  ok('nothing to record without a figure', !LG.histQa(h, { t: T0 + 4000 }).wrote);
}

console.log('── what the estate index carries');
{
  ok('one reading has no previous move', JSON.stringify(LG.histIdx({ r: [{ t: 1, cov: {} }] })) === '{}');
  const i = LG.histIdx({ r: [{ t: 1, rows: 5, cov: { a: 1 } }, { t: 2, rows: 6, cov: { a: 2 }, sc: { b: 0 } }, { t: 3, rows: 7, cov: { a: 3 } }] });
  ok('the reading BEFORE the last change, and when it changed', i.hp.t === 2 && i.hp.cov.a === 2 && i.hp.sc.b === 0 && i.ht === 3, i);
}

console.log('── the page reads a move exactly as the engine records it');
{
  const page = read('docs/FeedSpark_GoldenRecord.html');
  const m = page.match(/  function histMoved\(a, b\) \{[\s\S]*?\n  \}\n/);
  ok('the page carries its own histMoved', !!m);
  const twin = m ? new Function(m[0] + '; return histMoved;')() : null;
  const TABLE = [
    [{ cov: { material: 40, color: 90, title: 100 } }, { cov: { material: 55, color: 89.97, pattern: 20 } }],
    [{ cov: {}, sc: { size: 5 } }, { cov: {}, sc: { size: 0 } }],
    [{ cov: { a: 10, b: 20 }, sc: { a: 3 } }, { cov: { a: 10, b: 25 }, sc: { a: 0 } }],
    [{ cov: { x: 1 } }, { cov: { x: 1 } }],
    [null, { cov: {} }],
  ];
  const diff = TABLE.map(([a, b]) => [JSON.stringify(LG.histMoved(a, b)), JSON.stringify(twin ? twin(a, b) : null)]).filter(([x, y]) => x !== y);
  ok('same table, same answer, same order', twin && diff.length === 0, diff);
  ok('the page re-scores every reading with the SAME goldenScore + attrsFromCov the estate uses',
    /function hScore\(r, prof\) \{ return r \? goldenScore\(attrsFromCov\(r\.cov, r\.sc, r\.rows\), prof\) : null; \}/.test(page));
  ok('a reading on another basis is never compared', /function hBasis\(a, b\) \{ return !!\(a && a\.sc\) === !!\(b && b\.sc\); \}/.test(page));
  ok('the estate row\'s last move follows the same two rules', /function estMove\(f\)[\s\S]{0,400}!!f\.hp\.sc !== !!f\.sc[\s\S]{0,200}goldenScore\(attrsFromCov\(f\.hp\.cov, f\.hp\.sc, f\.hp\.rows\), profileForC\(f\.client\)\)/.test(page));
  ok('the card sits in the scorecard and is wired after every render', /h \+= histSection\(k, s\);/.test(page) && /wire\(k, s\);\n    histWire\(k\);/.test(page));
  ok('the client download keeps the chart and drops the hover furniture', /'\.hs\.hs-empty', '\.hs-tip', '\.hs-more', '\.hs-svg \.hit',/.test(page) && /\.hs-rng button'\), function \(b\)/.test(page));
  ok('the PDF hides the same furniture', /body\.pdf \.hs-rng button:not\(\.on\),body\.pdf \.hs-more,body\.pdf \.hs-tip,body\.pdf \.hs\.hs-empty\{display:none!important\}/.test(page));
  ok('the bars are the Product Volume pair, light and dark', /\.hs\{--hup:#2563EB;--hdn:#ED6F0B\}/.test(page) && /\[data-theme=dark\] \.hs\{--hup:#4C82E0;--hdn:#C67B28\}/.test(page));
}

console.log('── the worker writes it');
{
  const wk = read('cloudflare/feedspark-deck/src/worker.js');
  const scan = wk.slice(wk.indexOf('// ---- Golden Record stores (Google feeds only)'), wk.indexOf('return { snapshot: snap, alerts, baseT: base.t, pt, gr };'));
  ok('every scan offers its reading to the history', /const cur = histReading\(grSnap\);/.test(scan) && /const r = histAdd\(had, cur, \{ manual: !!\(opts && opts\.manual\) \}\);/.test(scan));
  ok('…and writes only when something is new', /if \(r\.wrote\) await env\.EDITS\.put\('goldenhist' \+ GK, JSON\.stringify\(gHist\)\);/.test(scan));
  ok('a record holding only an analysis still seeds on the first scan, and keeps its analyses',
    /if \(had && had\.r && had\.r\.length\) \{/.test(scan) && /if \(had && Array\.isArray\(had\.q\)\) gHist\.q = had\.q;/.test(scan));
  ok('a first record is seeded from the known-good AS IT WAS before this scan rolled it, and the previous scan',
    /const gBaseWas = gBase;/.test(scan) && /histSeed\(\[gBaseWas, gPrev\], cur, \{ manual: !!\(opts && opts\.manual\) \}\)/.test(scan) && scan.indexOf('const gBaseWas') < scan.indexOf('gBase = grSnap; await env.EDITS.put'));
  ok('the index carries the last move — rebuilt on a scan, carried by the ack',
    /keepQual\(gidx\[lgKey\(client, mkt\)\]\), gHist \? histIdx\(gHist\) : keepHist\(gidx\[lgKey\(client, mkt\)\]\)\);/.test(wk) &&
    /keepQual\(idx\[lgKey\(client, mkt\)\]\), keepHist\(idx\[lgKey\(client, mkt\)\]\)\);/.test(wk));
  ok('an analysis joins the history as measured', /const hq = histQa\(await env\.EDITS\.get\(hk, 'json'\), \{ t: rec\.t, q: qs \? qs\.score : null, air: ai \? ai\.total : null/.test(wk));
  ok('the page reads it from one route', /path === '\/api\/golden\/history' && request\.method === 'GET'/.test(wk) && /env\.EDITS\.get\('goldenhist:' \+ client \+ ':' \+ mkt, 'json'\)/.test(wk));
  ok('the browser engine copy is the worker\'s engine', read('docs/labelguard_engine.js') === read('cloudflare/feedspark-deck/src/labelguard.js'));
}

console.log('── a scan run by hand sets its day (Ray, 24 Sep 2026)');
{
  const R = (t, patch) => LG.histReading(snap(t, Object.assign({}, COV, patch || {})));
  let h = LG.histAdd(null, R(T0)).hist;
  let x = LG.histAdd(h, R(T0 + DAY + 3600e3), { manual: true });
  ok('a hand-run scan is recorded even when nothing moved — it pins its day', x.wrote && x.hist.r.length === 2 && x.hist.r[1].m === 1, x.hist.r.map((r) => r.m || 0));
  h = x.hist;
  ok('a second hand-run scan the same day with nothing new writes nothing', !LG.histAdd(h, R(T0 + DAY + 2 * 3600e3), { manual: true }).wrote);
  x = LG.histAdd(h, R(T0 + DAY + 5 * 3600e3, { material: 60 }));
  ok('an automatic scan later that day that DID move is still recorded — the record keeps the truth', x.wrote && x.hist.r.length === 3 && !x.hist.r[2].m);
  h = x.hist;
  ok('…but the day\'s VALUE is the hand-run reading', LG.histDayPick(h.r, LG.histDay(T0 + DAY)) === 1);
  ok('a day with no hand-run reading takes its last', LG.histDayPick([{ t: T0 }, { t: T0 + 3600e3 }], LG.histDay(T0)) === 1);
  ok('a day with nothing on it has no pick', LG.histDayPick(h.r, LG.histDay(T0 + 9 * DAY)) === -1);
  // thinning a day older than the recent window keeps the reading that IS its value
  let old = LG.histEmpty();
  old.r = [{ t: T0, cov: { a: 1 }, m: 1 }, { t: T0 + 3600e3, cov: { a: 9 } }];
  old = LG.histAdd(old, { t: T0 + 60 * DAY, rows: 1, cov: { a: 50 } }).hist;
  ok('thinning an old day keeps its hand-run reading, not its last', old.r.length === 2 && old.r[0].m === 1 && old.r[0].cov.a === 1, old.r);
  const qa = LG.histQa(LG.histQa(null, { t: T0, q: 70 }).hist, { t: T0 + 3600e3, q: 70, m: true });
  ok('a hand-run analysis identical to the automatic one is still recorded, marked', qa.wrote && qa.hist.q.length === 2 && qa.hist.q[1].m === 1);
  ok('the store and the page pick a day the same way', /function histDayPick\(list, day\) \{[\s\S]{0,300}if \(list\[i\]\.m\) lastM = i;[\s\S]{0,80}return lastM >= 0 \? lastM : last;/.test(read('docs/FeedSpark_GoldenRecord.html')));
}

console.log('── one content-quality stream, two lanes');
{
  const FA = (await import('node:module')).createRequire(import.meta.url)('../docs/feedlab_engine.js');
  const H = ['id', 'title', 'description', 'link', 'image_link', 'price', 'availability', 'brand', 'product_highlight', 'product_highlight(2)', 'google_product_category'];
  const ROWS = [];
  for (let i = 0; i < 40; i++) ROWS.push(['p' + i, 'Linen Shirt ' + (i % 5 ? 'Blue' : 'BLUE SALE'), 'A breathable linen shirt for warm days, cut for an easy fit and finished with mother-of-pearl buttons.',
    'https://x/p' + i, 'https://x/i' + i + '.jpg', '40 GBP', 'in_stock', 'Acme', 'Breathable linen', i % 3 ? 'Relaxed fit' : '', 'Apparel & Accessories > Clothing > Shirts & Tops']);
  // the lane the page used to run inline, written out by hand — the stream must equal it
  const cols = LG.findAttrCols(H), col = LG.qualityCollector(cols, { header: H });
  ROWS.forEach((r) => col.onRow(r));
  const byHand = col.finish({ client: 'Acme', market: 'gb' });
  const qs = LG.qualityStream({ FA, client: 'Acme', market: 'gb', expected: [], waived: [] });
  qs.onRow(H); ROWS.forEach((r) => qs.onRow(r));
  const viaStream = qs.finish();
  const strip = (o) => JSON.stringify(Object.assign({}, o, { ai: undefined, t: undefined }));
  ok('qualityStream reads a feed exactly as the collector does', strip(viaStream) === strip(byHand));
  ok('…and scores the same rows on the AI-readiness ladder, packed to the stored shape',
    viaStream.ai && viaStream.ai.total > 0 && viaStream.ai.pillars.length === 8 && viaStream.ai.titles && 'mask' in viaStream.ai.titles, viaStream.ai && viaStream.ai.total);
  ok('it counts rows as it goes (the page\'s progress bar reads this)', qs.rows() === ROWS.length);
  const g = LG.qualityStream({ FA, client: 'Acme', market: 'gb' });
  g.onRow(H.slice(0, 8)); g.onRow(ROWS[0].slice(0, 8)); g.onRow(ROWS[1].slice(0, 8), H);
  ok('a column an XML feed grows mid-stream is named late, never scored on part of the feed', (g.finish().late || []).includes('product_highlight'));
  let threw = false; try { LG.qualityStream({}).finish(); } catch (e) { threw = /no rows/.test(e.message); }
  ok('an empty feed is refused, not stored as a zero', threw);
  const page = read('docs/FeedSpark_GoldenRecord.html');
  ok('the page\'s Analyse button runs the SAME stream', /var qs = LG\.qualityStream\(\{ FA: FA, client: p\.client, market: p\.mkt, audCap: AUD_CAP,/.test(page) && /var snap = qs\.finish\(\);/.test(page) && !/function packAudit\(a\) \{/.test(page));
  ok('…and so does the daily agent', /qualityStream\(\{ FA, client: feed\.client, market: feed\.mkt, audCap: AUD_CAP,/.test(read('tools/golden_daily.mjs')));
}

console.log('── the worker: one writer, and an automatic reading never overrides a hand-run day');
{
  const wk = read('cloudflare/feedspark-deck/src/worker.js');
  const fn = wk.slice(wk.indexOf('async function storeGoldenQuality('), wk.indexOf('async function goldenRoutes('));
  ok('the page\'s PUT and the agent\'s push share ONE writer', /const r = await storeGoldenQuality\(env, client, mkt, b, \{ auto: false \}\);/.test(wk) && /await storeGoldenQuality\(env, client, mkt, e\.snap, \{ auto: true \}\);/.test(wk));
  ok('an automatic reading is not stored over a hand-run one from the same day',
    /if \(cur && cur\.qSrc === 'm' && cur\.qT && histDay\(cur\.qT\) === histDay\(Date\.now\(\)\)\) \{/.test(fn) && fn.indexOf("cur.qSrc === 'm'") < fn.indexOf("EDITS.put('goldenqual:'"));
  ok('the index says who took the reading, and a scan carries it forward', /idx\[key\]\.qSrc = auto \? 'a' : 'm';/.test(fn) && /const QUAL_KEEP = \['q', 'qFails', 'qT', 'qSrc',/.test(wk));
  ok('the analysis lands in the history marked by who ran it', /m: !auto \}\);/.test(fn));
  ok('every scan button a person presses is a hand-run scan',
    (wk.match(/runLabelScan\(env, client, mkt, \{ manual: true \}\)/g) || []).length === 3 &&
    /applyPushedSnapshot\(env, client, mkt, snap, body\.vol, undefined, undefined, \{ manual: true \}\)/.test(wk));
  ok('…the cron sweep and the agents are not', /try \{ await runLabelScan\(env, f\.client, f\.mkt\); \} catch \(e\) \{\}/.test(wk) && /const r = await runLabelScan\(env, client, mkt\);\n/.test(wk));
  ok('the flag reaches the history', /histAdd\(had, cur, \{ manual: !!\(opts && opts\.manual\) \}\)/.test(wk) && /runLabelScan\(env, client, mkt, opts\)/.test(wk) && /processScanSnapshot\(env, client, mkt, snap, \{ wantPT, rescan: null, manual: !!\(opts && opts\.manual\) \}\)/.test(wk));
  ok('the daily run has a ledger, and hands the agent every brand\'s scoring profile', /if \(body\.goldendaily && typeof body\.goldendaily === 'object'\) \{/.test(wk) && /return json\(\{ ok: true, day, done: !!\(cur && cur\.day === day\), last: cur, profiles \}\);/.test(wk));
  ok('the estate route carries the ledger so the card can say when it last ran', /return json\(\{ feeds, alerts, daily \}\);/.test(wk));
  ok('sheet-backed Google feeds get their score from the worker\'s own gviz scan', /if \(Array\.isArray\(body\.goldenscan\)\) \{/.test(wk));
  ok('a Meta feed is never taken as a Golden Record feed', (wk.match(/\/-fb\$\/\.test\(mkt\)\) \{ results\.push\(\{ client, mkt, error: 'bad client\/market' \}\)/g) || []).length === 2);
}

console.log('── the agent runs once a day, from 09:00 London');
{
  const A = await import('./golden_daily.mjs');
  const at = (iso) => A.londonClock(new Date(iso));
  ok('in summer 08:00 UTC is 09:00 London', at('2026-07-01T08:00:00Z').hour === 9 && at('2026-07-01T08:00:00Z').day === '2026-07-01');
  ok('in winter 09:00 UTC is 09:00 London', at('2026-12-01T09:00:00Z').hour === 9 && at('2026-12-01T08:00:00Z').hour === 8);
  ok('the London date is the day the run files under — 23:30 UTC in summer is already tomorrow', at('2026-07-01T23:30:00Z').day === '2026-07-02');
  ok('before 09:00 London it waits', !A.shouldRun(at('2026-12-01T08:00:00Z'), false, false));
  ok('from 09:00 it runs', A.shouldRun(at('2026-07-01T08:00:00Z'), false, false) && A.shouldRun(at('2026-12-01T09:00:00Z'), false, false));
  ok('a late firing is the catch-up for a missed or failed run', A.shouldRun(at('2026-07-01T09:00:00Z'), false, false));
  ok('once today is on the ledger every later firing does nothing', !A.shouldRun(at('2026-07-01T09:00:00Z'), true, false));
  ok('a forced dispatch runs regardless', A.shouldRun(at('2026-12-01T06:00:00Z'), true, true));
  const feeds = A.googleFeeds(read('cloudflare/feedspark-deck/src/worker.js'));
  ok('every wired Google Shopping feed, never a Meta one', feeds.length >= 40 && !feeds.some((f) => /-fb$/.test(f.mkt)), feeds.length);
  ok('sheet-backed ones read Google\'s public CSV export, as the feed proxy does', feeds.filter((f) => f.kind === 'sheet').every((f) => /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/export\?format=csv&gid=/.test(f.url)) && feeds.some((f) => f.kind === 'sheet'));
  ok('a client name with a space is read whole', feeds.some((f) => f.client === 'House of Bruar'));
  const wf = read('.github/workflows/golden-daily.yml');
  ok('the workflow fires at 08:00, 09:00 and 10:00 UTC and lets the script decide', /cron: '0 8,9,10 \* \* \*'/.test(wf) && /node tools\/golden_daily\.mjs/.test(wf) && /FCC_PUSH_KEY: \$\{\{ secrets\.FCC_PUSH_KEY \}\}/.test(wf));
  ok('a one-feed dispatch never marks the day done', /if \(!ONLY\) await post\(\{ goldendaily: \{ day: clock\.day, finish: true,/.test(read('tools/golden_daily.mjs')));
}

console.log('── the portfolio view: every feed day by day, off the same engine (Ray, 24 Sep 2026)');
{
  const R = (t, patch, m) => Object.assign(LG.histReading(snap(t, Object.assign({}, COV, patch || {}))), m ? { m: 1 } : {});
  const prof = LG.profileFor('Reiss', {});
  const iso = (t) => LG.histDay(t);
  const today = iso(T0 + 9 * DAY);
  // 1–10 Sep: scanned every day but the 5th; material moves on the 3rd; on the 7th an automatic
  // scan reads 90, then a hand-run one reads 20 — the day is the hand-run one
  const h = { v: 1, r: [R(T0), R(T0 + 2 * DAY, { material: 70 }), R(T0 + 6 * DAY, { material: 90 }), R(T0 + 6 * DAY + 3600e3, { material: 20 }, true)],
    s: [0, 1, 2, 3, 5, 6, 7, 8, 9].map((d) => iso(T0 + d * DAY)),
    q: [{ t: T0, q: 70, air: 55, tier: 2 }, { t: T0 + 4 * DAY, q: 75 }, { t: T0 + 4 * DAY + 60e3, q: 60, air: 57 }, { t: T0 + 4 * DAY + 120e3, q: 72, m: 1 }] };
  const s = LG.histSeries(h, prof, { days: 30, today });
  const sc = (r) => LG.goldenScore(LG.attrsFromCov(r.cov, r.sc, r.rows), prof).score;
  ok('the series starts at the first measured day, not thirty days of nothing', s.start === iso(T0) && s.gs.length === 10, [s.start, s.gs.length]);
  ok('a day is the score of that day\'s reading, re-scored under the brand\'s profile', s.gs[0] === sc(h.r[0]) && s.gs[2] === sc(h.r[1]));
  ok('a scanned day with no move carries the last reading', s.gs[1] === s.gs[0] && s.gs[3] === s.gs[2]);
  ok('a day nobody scanned is a gap, never a copy', s.gs[4] === null, s.gs);
  ok('a hand-run reading sets its day over an automatic one', s.gs[6] === sc(h.r[3]) && s.gs[6] !== sc(h.r[2]), [s.gs[6], sc(h.r[2]), sc(h.r[3])]);
  ok('content quality is the day\'s analysis — hand-run first — and a gap on a day with none', s.q[0] === 70 && s.q[4] === 72 && s.q[1] === null, s.q);
  ok('AI-readiness reads the analyses that carry it', s.air[0] === 55 && s.air[4] === 57, s.air);
  ok('the summary is first → last measured day in the window', s.sum.gs.from === s.gs[0] && s.sum.gs.now === s.gs[9] && s.sum.gs.fromD === iso(T0) && s.sum.gs.nowD === today && s.sum.gs.n === 9, s.sum.gs);
  ok('…its direction ignores a move under half a point', LG.PORTFOLIO_FLAT === 0.5 && s.sum.q.dir === 'up' && s.sum.q.delta === 2, s.sum.q);
  ok('the latest AI tier rides along', s.tier === 2);
  // the estate's own reading closes the line where the estate's score is
  const live = { t: T0 + 9 * DAY + 3600e3, rows: 1000, cov: Object.assign({}, COV, { material: 20.3 }) };
  const sl = LG.histSeries(h, prof, { days: 30, today, live });
  ok('the index\'s current reading closes today at the estate\'s own score', sl.gs[9] === sc(live), [sl.gs[9], sc(live)]);
  // a basis change: the line keeps only what was measured the way today's reading is
  const hb = { v: 1, r: [R(T0), Object.assign(R(T0 + 3 * DAY), { sc: { color: 20 } })], s: [0, 1, 2, 3].map((d) => iso(T0 + d * DAY)), q: [] };
  const sb = LG.histSeries(hb, prof, { days: 30, today: iso(T0 + 3 * DAY) });
  ok('a reading on another basis is left out, not drawn as a jump nobody made — the line starts where today\'s measurement does',
    sb.start === iso(T0 + 3 * DAY) && sb.gs.length === 1 && sb.gs[0] != null && sb.sum.gs.delta === null, [sb.start, sb.gs]);
  const empty = LG.histSeries(null, prof, { days: 30, today });
  ok('no record is no series — nothing invented', empty.start === null && empty.sum.gs.now === null && empty.sum.q.now === null);
  const big = { v: 1, r: [], s: [], q: [] };
  for (let d = 0; d < 365; d++) { big.r.push(R(T0 + d * DAY, { material: 40 + (d % 7) })); big.s.push(iso(T0 + d * DAY)); }
  const t0 = Date.now(); const sy = LG.histSeries(big, prof, { days: 365, today: iso(T0 + 364 * DAY) }); const ms = Date.now() - t0;
  ok('a year of daily readings is 365 values and cheap to build (49 feeds in one request)', sy.gs.length === 365 && ms < 200, ms);
  ok('the window is bounded', LG.histSeries(big, prof, { days: 99999, today: iso(T0 + 364 * DAY) }).days === LG.HIST_DAYS_MAX);

  // THE PAGE'S OWN HISTORY MODEL READS THE SAME DAYS — lifted by name from /golden, run on the same
  // record: a tile on Leadership can never disagree with the Score history card it opens
  const page = read('docs/FeedSpark_GoldenRecord.html');
  const cut = (a, b) => { const i = page.indexOf(a), j = page.indexOf(b, i); if (i < 0 || j < 0) throw new Error('page block not found: ' + a); return page.slice(i, j); };
  const twin = new Function(cut('  var SPEC = [', '  // the category each scoped') + cut('  function scopeShare(a)', '  // industry benchmark from the estate index') +
    cut('  function attrsFromCov(cov, sc, rows)', '  function rescoreEstate()') + cut('  function hDay(t)', '  function histChart(m)') +
    '; return { goldenScore: goldenScore, attrsFromCov: attrsFromCov, histModel: histModel };')();
  const profs = [prof, LG.profileFor('YuMOVE', {}), { expected: ['material', 'pattern'], waived: ['size_type'] }];
  ok('the engine\'s attrsFromCov is the page\'s, reading for reading, under every profile',
    h.r.concat([live, Object.assign(R(T0), { sc: { color: 0, size: 12 } })]).every((r) => profs.every((p) => LG.histScore(r, p) === twin.goldenScore(twin.attrsFromCov(r.cov, r.sc, r.rows), p))));
  const diffs = [];
  for (const met of ['gs', 'q', 'air']) {
    const m = twin.histModel(h, null, prof, '30', today, met), eng = LG.histSeries(h, prof, { days: 30, today });
    m.days.forEach((d) => {
      const i = Math.round((Date.parse(d.d) - Date.parse(eng.start)) / DAY);
      const e = i >= 0 && i < eng[met].length ? eng[met][i] : null;
      const p = d.scanned ? d.score : null;
      if (e !== p) diffs.push([met, d.d, e, p]);
    });
  }
  ok('Leadership\'s series and the Score history card read every day identically (all three scores)', diffs.length === 0, diffs.slice(0, 5));

  const wk = read('cloudflare/feedspark-deck/src/worker.js');
  const route = wk.slice(wk.indexOf("if (path === '/api/golden/portfolio'"), wk.indexOf("if (path === '/api/golden/alertcfg')"));
  ok('one route serves the whole book, through the engine, under each brand\'s current profile',
    route.length > 0 && /histSeries\(hists\[i\], pf, \{ days, today, live \}\)/.test(route) && /profileFor\(f\.client, overrides\)/.test(route));
  ok('…closed by the estate index\'s own reading', /const live = x && x\.cov && x\.t \? \{ t: x\.t, rows: x\.rows, cov: x\.cov, sc: x\.sc \} : null;/.test(route));
  ok('…only the windows the page offers', /\[30, 90, 365\]\.indexOf\(want\) >= 0 \? want : 90/.test(route));
  ok('…Google Shopping feeds only', (route.match(/-fb\$\//g) || []).length >= 2);
  ok('…scoped per signin, which only ever narrows', /!acc\.clients \|\| clientMatch\(acc\.clients, f\.client\)/.test(route));
  ok('…the AM is the Task Manager\'s, and a brand it has not reached has none — never guessed',
    /env\.EDITS\.get\('tmidx', 'json'\)/.test(route) && /return k\.length === 1 \? tmBy\[k\[0\]\] : null;/.test(route));

  const ld = read('docs/FeedSpark_Leadership.html');
  ok('Leadership reads the route and scores nothing itself', /fetch\('\/api\/golden\/portfolio\?days='\+r\)/.test(ld) && !/function goldenScore/.test(ld));
  ok('the section sits on Leadership with its filters, strip and grid', /<section id="golden-pf" class="gp">/.test(ld) && /id="gp-bar"/.test(ld) && /id="gp-roll"/.test(ld) && /id="gp-body"/.test(ld));
  ok('improvement and deduction wear the Score history card\'s own pair, light and dark',
    /\.gp\{--gup:#2563EB;--gdn:#ED6F0B\}/.test(ld) && /\[data-theme=dark\] \.gp\{--gup:#4C82E0;--gdn:#C67B28\}/.test(ld));
  ok('a tile opens the feed\'s card on the score and window being read', /localStorage\.setItem\('gr-hist-met',st\.met\); localStorage\.setItem\('gr-hist-rng',st\.rng\);/.test(ld) && /href="\/golden#'\+encodeURIComponent\(f\.client\+'\|'\+f\.mkt\)/.test(ld));
  ok('the page\'s flat threshold is the engine\'s', new RegExp('var FLAT=' + LG.PORTFOLIO_FLAT + ';').test(ld));
}

console.log(`\ngolden score history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
