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
  ok('every scan offers its reading to the history', /const cur = histReading\(grSnap\);/.test(scan) && /const r = histAdd\(had, cur\);/.test(scan));
  ok('…and writes only when something is new', /if \(r\.wrote\) await env\.EDITS\.put\('goldenhist' \+ GK, JSON\.stringify\(gHist\)\);/.test(scan));
  ok('a record holding only an analysis still seeds on the first scan, and keeps its analyses',
    /if \(had && had\.r && had\.r\.length\) \{/.test(scan) && /if \(had && Array\.isArray\(had\.q\)\) gHist\.q = had\.q;/.test(scan));
  ok('a first record is seeded from the known-good AS IT WAS before this scan rolled it, and the previous scan',
    /const gBaseWas = gBase;/.test(scan) && /histSeed\(\[gBaseWas, gPrev\], cur\)/.test(scan) && scan.indexOf('const gBaseWas') < scan.indexOf('gBase = grSnap; await env.EDITS.put'));
  ok('the index carries the last move — rebuilt on a scan, carried by the ack',
    /keepQual\(gidx\[lgKey\(client, mkt\)\]\), gHist \? histIdx\(gHist\) : keepHist\(gidx\[lgKey\(client, mkt\)\]\)\);/.test(wk) &&
    /keepQual\(idx\[lgKey\(client, mkt\)\]\), keepHist\(idx\[lgKey\(client, mkt\)\]\)\);/.test(wk));
  ok('an analysis joins the history as measured', /const hq = histQa\(await env\.EDITS\.get\(hk, 'json'\), \{ t: rec\.t, q: qs \? qs\.score : null, air: ai \? ai\.total : null/.test(wk));
  ok('the page reads it from one route', /path === '\/api\/golden\/history' && request\.method === 'GET'/.test(wk) && /env\.EDITS\.get\('goldenhist:' \+ client \+ ':' \+ mkt, 'json'\)/.test(wk));
  ok('the browser engine copy is the worker\'s engine', read('docs/labelguard_engine.js') === read('cloudflare/feedspark-deck/src/labelguard.js'));
}

console.log(`\ngolden score history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
