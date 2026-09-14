/*
 * Product-volume churn harness: lifts volTrack out of worker.js by name and drives it with
 * a fake KV + a controllable clock. Pins the 14 Sep 2026 fix — Accessorize read "0 in / 0 out"
 * every day while its SKU count moved, because only the FIRST scan of a day was diffed and
 * later scans overwrote the close. Now the previous day's close is a stored baseline and every
 * scan re-diffs against it (running close-to-close).
 * Run: node tools/test_volume.mjs   (pure node — part of qa_gate / presync / validate)
 */
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
const a = src.indexOf('async function volTrack('), b = src.indexOf('\n// One pushed raw snapshot', a);
if (a < 0 || b < 0) { console.error('✗ volTrack not found in worker.js'); process.exit(1); }
const volTrack = new Function('return (' + src.slice(a, b) + ')')();

let passed = 0, failed = 0;
function ok(c, l) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ FAIL: ' + l); } }

// controllable clock (volTrack reads new Date())
const RealDate = Date; let NOWISO = '2026-09-10T02:15:00Z';
globalThis.Date = class extends RealDate { constructor(...x) { if (x.length) super(...x); else super(NOWISO); } static now() { return new RealDate(NOWISO).getTime(); } };
const at = (iso) => { NOWISO = iso; };

// fake KV
const store = {};
const env = { EDITS: { get: async (k, t) => (store[k] == null ? null : (t === 'json' ? JSON.parse(store[k]) : store[k])), put: async (k, v) => { store[k] = v; } } };
const set = (ids) => ({ ids: ids.map((x) => (Array.isArray(x) ? x.join('|') : x + '|Bags')).join('\n'), trunc: false });
const hist = () => JSON.parse(store['volhist:Acc:gb'] || '[]');
const last = () => { const h = hist(); return h[h.length - 1]; };

// ---- day 1: first-ever capture → rows only; a same-day rescan updates rows only ----
await volTrack(env, 'Acc', 'gb', 5, set([1, 2, 3, 4, 5]));
ok(hist().length === 1 && last().d === '2026-09-10' && last().rows === 5 && last().in === undefined, 'day 1 first capture: rows-only entry, no in/out invented');
at('2026-09-10T14:15:00Z');
await volTrack(env, 'Acc', 'gb', 6, set([1, 2, 3, 4, 5, 6]));
ok(hist().length === 1 && last().rows === 6 && last().in === undefined, 'day 1 same-day rescan: rows updated, still no baseline → no diff');
ok(!store['volbase:Acc:gb'], 'no baseline exists until a day rolls');

// ---- day 2: first scan rolls yesterday's CLOSE (ids 1..6) into the baseline ----
at('2026-09-11T02:15:00Z');
await volTrack(env, 'Acc', 'gb', 6, set([1, 2, 3, 4, 5, 6]));
const base = JSON.parse(store['volbase:Acc:gb']);
ok(base.d === '2026-09-10' && base.ids.split('\n').length === 6, 'day 2 first scan: previous-day close pinned as the baseline');
ok(last().d === '2026-09-11' && last().in === 0 && last().out === 0, 'day 2 first scan: unchanged overnight → 0 in / 0 out (honest)');

// ---- THE BUG: intraday movement on day 2 must land in the day's in/out ----
at('2026-09-11T14:15:00Z');
await volTrack(env, 'Acc', 'gb', 7, set([[1, 'Bags'], [2, 'Bags'], [3, 'Bags'], [4, 'Bags'], [7, 'Hats'], [8, 'Hats'], [9, 'Scarves']]));
ok(hist().filter((h) => h.d === '2026-09-11').length === 1, 'day 2 rescan: one entry per day (overwritten, not appended)');
ok(last().in === 3 && last().out === 2 && last().rows === 7, 'day 2 rescan: intraday change measured vs the baseline → 3 in / 2 out (was 0/0 before the fix)');
const cats = Object.fromEntries(last().cats.map((c) => [c.c, c]));
ok(cats.Hats && cats.Hats.in === 2 && cats.Scarves && cats.Scarves.in === 1 && cats.Bags && cats.Bags.out === 2, 'day 2 rescan: category movers follow the moved ids (Hats +2, Scarves +1, Bags −2)');
at('2026-09-11T20:15:00Z');
await volTrack(env, 'Acc', 'gb', 7, set([[1, 'Bags'], [2, 'Bags'], [3, 'Bags'], [4, 'Bags'], [7, 'Hats'], [8, 'Hats'], [9, 'Scarves']]));
ok(last().in === 3 && last().out === 2, 'day 2 close: re-diffing an unchanged set is idempotent');
ok(JSON.parse(store['volbase:Acc:gb']).d === '2026-09-10', 'baseline stays yesterday’s close all day (same-day scans never move it)');

// ---- day 3: baseline rolls to day 2's close; the day starts at 0 and builds again ----
at('2026-09-12T02:15:00Z');
await volTrack(env, 'Acc', 'gb', 7, set([[1, 'Bags'], [2, 'Bags'], [3, 'Bags'], [4, 'Bags'], [7, 'Hats'], [8, 'Hats'], [9, 'Scarves']]));
ok(JSON.parse(store['volbase:Acc:gb']).d === '2026-09-11' && last().d === '2026-09-12' && last().in === 0 && last().out === 0, 'day 3 first scan: baseline rolled to day-2 close, fresh day starts 0/0');
at('2026-09-12T08:15:00Z');
await volTrack(env, 'Acc', 'gb', 8, set([[1, 'Bags'], [2, 'Bags'], [3, 'Bags'], [4, 'Bags'], [7, 'Hats'], [8, 'Hats'], [9, 'Scarves'], [10, 'Hats']]));
ok(last().in === 1 && last().out === 0 && last().rows === 8, 'day 3 later scan: +1 measured against the day-2 close');

// ---- truncation never fakes churn ----
at('2026-09-13T02:15:00Z');
await volTrack(env, 'Acc', 'gb', 50000, { ids: '', trunc: true });
ok(last().d === '2026-09-13' && last().trunc === true && last().in === undefined, 'truncated capture: rows-only entry flagged trunc');
at('2026-09-14T02:15:00Z');
await volTrack(env, 'Acc', 'gb', 8, set([1, 2, 3, 4, 7, 8, 9, 10]));
ok(last().d === '2026-09-14' && last().in === undefined, 'the day after a truncated close: no baseline to trust → rows-only, no invented churn');

// ---- guards ----
ok((await volTrack(env, 'Acc', 'gb', 8, null)) === null, 'no vol payload → no-op');
ok(hist().length <= 60, 'history capped');

console.log('\nRESULT: ' + (failed ? 'FAIL — ' + failed + ' failed, ' : 'PASS — ') + passed + ' assertions');
process.exit(failed ? 1 : 0);
