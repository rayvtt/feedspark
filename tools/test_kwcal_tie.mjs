#!/usr/bin/env node
/*
 * Keyword Calendar — event ⇄ ticket tie + result-window join (Ray, 11 Sep 2026).
 *
 * Every keyword optimisation is briefed from the calendar and nowhere else, so each moment owns
 * exactly one Workflow ticket and the board must never guess which. That resolution order, and
 * the half-month window that joins a reported result batch back onto a moment, are pure logic —
 * pinned here so a later edit to docs/FeedSpark_KWCal.html can't quietly loosen them.
 *
 * The functions are lifted out of the page by name (brace-matched). If one is renamed or moved,
 * this fails loudly — which is the point: it is a tripwire, not a mirror.
 *
 * Run: node tools/test_kwcal_tie.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_KWCal.html'), 'utf8');

function lift(name) {                       // pull `function name(...){...}` out by brace matching
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(`KWCal: function ${name}() not found — did it get renamed?`);
  let depth = 0, inS = null, esc = false, line = false, block = false;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    // comments first: an apostrophe in a trailing comment must not open a "string"
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
    if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { line = true; j++; continue; }
    if (c === '/' && n === '*') { block = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error(`KWCal: unbalanced braces reading ${name}()`);
}
function liftVar(name) {
  const m = new RegExp('var ' + name + '=\\{[^}]*\\};').exec(src);
  if (!m) throw new Error(`KWCal: var ${name} not found`);
  return m[0];
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LEAD_DAYS = 21;
let BRIEFS = {}, KWRES = {};
const evMkt = (brand, e) => e.mkt || 'gb';
const schedDate = (e) => { const d = new Date(e.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - LEAD_DAYS); return d; };

const body = [liftVar('MONI'), lift('normTask'), lift('kwTask'), lift('wfFor'), lift('periodWin'), lift('resFor')].join('\n');
const api = new Function('MON', 'LEAD_DAYS', 'evMkt', 'schedDate', 'getB', 'getR',
  `${body}
   var BRIEFS, KWRES;
   return { wfFor:function(b,e){ BRIEFS=getB(); return wfFor(b,e); },
            resFor:function(b,e){ KWRES=getR(); return resFor(b,e); },
            periodWin:periodWin, kwTask:kwTask, normTask:normTask };`
)(MON, LEAD_DAYS, evMkt, schedDate, () => BRIEFS, () => KWRES);

let pass = 0; const fails = [];
const is = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); } else { fails.push(`${name}\n      got  ${g}\n      want ${w}`); }
};

// ---------- the tie ----------
const ev = (id, name, date, mkt) => ({ id, name, date, ...(mkt ? { mkt } : {}) });
const aw26 = ev('aw26', 'AW26 Campaign (renamed)', '2026-09-09');
const coats = ev('coats', 'Coats', '2026-10-12');
const coatsj = ev('coatsj', 'Coats & Jackets', '2026-10-19');

BRIEFS = {
  a: { id: 'a', client: 'Reiss', kw: 'aw26', task: 'Keywords Optimisation - AW26 Campaign - Marketing Planner - 0926', status: 'briefed' },
  b: { id: 'b', client: 'Reiss', task: 'Keywords Optimisation - Coats & Jackets - Marketing Planner - 1026', status: 'analysis' },
  c: { id: 'c', client: 'Schuh', kw: 'coats', task: 'Keywords Optimisation - Coats - Marketing Planner - 1026', status: 'done' },
  d: { id: 'd', client: 'Reiss', task: 'AI Keyword Optimisation — Denim - Marketing Planner - 0826', status: 'progress' },
};
is('stamped id survives a rename', api.wfFor('Reiss', aw26)?.id, 'a');
is('"Coats" cannot capture the "Coats & Jackets" ticket', api.wfFor('Reiss', coats), null);
is('"Coats & Jackets" resolves its own ticket', api.wfFor('Reiss', coatsj)?.id, 'b');
is('another client’s brief never leaks in', api.wfFor('Reiss', ev('coats', 'Coats', '2026-10-12')), null);
is('legacy em-dash task name still ties', api.wfFor('Reiss', ev('denim', 'Denim', '2026-08-21'))?.id, 'd');
is('no ticket = no tie', api.wfFor('Reiss', ev('zzz', 'Nothing Briefed', '2026-11-02')), null);

// the stamped id outranks a name that matches a DIFFERENT ticket
BRIEFS.e = { id: 'e', client: 'Reiss', kw: 'coats', task: 'something else entirely', status: 'live', updated: 1 };
is('stamped id outranks the name rungs', api.wfFor('Reiss', coats)?.id, 'e');

// newest wins when two tickets carry the same stamp
BRIEFS.f = { id: 'f', client: 'Reiss', kw: 'coats', task: 'another', status: 'done', updated: 99 };
is('newest stamped ticket wins', api.wfFor('Reiss', coats)?.id, 'f');

// ---------- the result window ----------
const W = (p, when) => { const w = api.periodWin({ period: p, when }); return w && [new Date(w.a).toISOString().slice(0, 10), new Date(w.b).toISOString().slice(0, 10), w.label]; };
is('1st half of a month', W('Aug I', Date.UTC(2026, 7, 20)), ['2026-08-01', '2026-08-15', 'Aug 2026 · 1st half']);
is('2nd half of a month', W('Aug II', Date.UTC(2026, 7, 31)), ['2026-08-16', '2026-08-31', 'Aug 2026 · 2nd half']);
is('whole month when no numeral', W('Sep', Date.UTC(2026, 8, 30)), ['2026-09-01', '2026-09-30', 'Sep 2026']);
is('February respects the month length', W('Feb II', Date.UTC(2026, 1, 27)), ['2026-02-16', '2026-02-28', 'Feb 2026 · 2nd half']);
is('a December batch reported in January keeps its year', W('Dec II', Date.UTC(2027, 0, 6)), ['2026-12-16', '2026-12-31', 'Dec 2026 · 2nd half']);
is('an unparseable period is no window', api.periodWin({ period: 'whenever', when: Date.now() }), null);

// ---------- the join ----------
KWRES = { Reiss: [
  { id: 'r1', client: 'Reiss', mkt: 'gb', period: 'Aug II', when: Date.UTC(2026, 7, 31), verdict: 'positive' },
  { id: 'r2', client: 'Reiss', mkt: 'gb', period: 'Sep II', when: Date.UTC(2026, 8, 30), verdict: 'mixed' },
  { id: 'r3', client: 'Reiss', mkt: 'us', period: 'Sep II', when: Date.UTC(2026, 8, 30), verdict: 'negative' },
].map((r) => ({ ...r, __w: api.periodWin(r) })) };
is('a moment lands in the batch covering its live-by date', api.resFor('Reiss', aw26)?.id, 'r1');   // live-by 19 Aug
is('a later moment lands in the later batch', api.resFor('Reiss', coats)?.id, 'r2');                 // live-by 21 Sep
is('a moment outside every window gets nothing', api.resFor('Reiss', ev('x', 'X', '2026-08-21')), null); // live-by 31 Jul
is('a market-pinned moment takes its own market’s batch', api.resFor('Reiss', ev('y', 'Y', '2026-10-12', 'us'))?.id, 'r3');
is('a brand with no archive gets nothing', api.resFor('Schuh', aw26), null);

// ---------- the canonical task name (what the brief is raised as) ----------
is('house task name', api.kwTask('Reiss', ev('k', 'Coats', '2026-10-12')), 'Keywords Optimisation - Coats - Marketing Planner - 1026');
is('non-GB markets are suffixed', api.kwTask('Reiss', ev('k', 'Coats', '2026-10-12', 'us')), 'Keywords Optimisation - Coats - Marketing Planner - 1026 - US');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }
console.log('PASS');
