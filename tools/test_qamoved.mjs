#!/usr/bin/env node
/* Golden Record — WHY AN ANALYSIS MOVED (Ray, 19 Oct 2026, over Reiss DK's content quality ▲ +6: "detail, in the most
   minimal way possible, why the content quality score has increased … figure out how many fields have been changed").

   The engine keeps, on every analysis in the history record, each content-quality field's score and the products
   breaking each rule (qa) and each AI-readiness pillar's score (ap). The page reads a move off the two analyses it
   compares. This pins both halves: what is stored (and what is refused), and what the change log says.

   Run: node tools/test_qamoved.mjs
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LG = await import(path.join(ROOT, 'cloudflare/feedspark-deck/src/labelguard.js'));
let fail = 0, n = 0;
const ok = (name, cond, extra) => { n++; if (cond) console.log('  ✓ ' + name); else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };

console.log('-- the engine: what an analysis keeps');
const qs = { score: 82.7, parts: [
  { key: 'title', score: 90.1, filled: 1000, broken: [{ id: 'caps', n: 120 }, { id: 'thin', n: 40 }] },
  { key: 'material', score: 58, filled: 800, broken: [{ id: 'notmat', n: 0 }] },
] };
const matRule = (LG.qspecOf('material').rules[0] || {}).id;
qs.parts[1].broken = [{ id: matRule, n: 420 }];
const ai = { total: 62, pillars: [{ key: 'titles', score: 70 }, { key: 'taxonomy', score: 40 }] };
const det = LG.histQaDetail(qs, ai);
ok('each field keeps its score, the products it was read on and the products breaking each rule',
  det.qa.title.s === 90.1 && det.qa.title.f === 1000 && det.qa.title.b.caps === 120 && det.qa.material.b[matRule] === 420, det.qa);
ok('each AI-readiness pillar keeps its score', det.ap.titles === 70 && det.ap.taxonomy === 40, det.ap);
const r1 = LG.histQa(null, Object.assign({ t: Date.UTC(2026, 9, 15, 12), q: 82.7, air: 62, tier: 3 }, det));
const p1 = r1.hist.q[0];
ok('histQa writes the detail onto the analysis point', r1.wrote && p1.qa && p1.ap && p1.qa.material.s === 58, p1);
const bad = LG.histQa(null, { t: Date.UTC(2026, 9, 15, 12), q: 80, qa: { nofield: { s: 9, b: {} }, title: { s: 140, f: -3, b: { caps: 5, madeup: 9 } } }, ap: { 'Bad Key!': 4, titles: 900 } });
const bp = bad.hist.q[0];
ok('a field the spec does not know is refused, a rule it does not know is dropped, figures are clamped',
  !bp.qa.nofield && bp.qa.title.s === 100 && bp.qa.title.f === 0 && bp.qa.title.b.caps === 5 && !('madeup' in bp.qa.title.b), bp.qa);
ok('a pillar key that is not a key is refused, a score is clamped', !('Bad Key!' in bp.ap) && bp.ap.titles === 100, bp.ap);
const plain = LG.histQa(null, { t: Date.UTC(2026, 9, 15, 12), q: 80 }).hist.q[0];
ok('an analysis with no detail stays exactly as it was', !('qa' in plain) && !('ap' in plain), plain);

console.log('-- the worker passes it');
const W = fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');
ok('storeGoldenQuality hands histQa the detail', /histQa\(await env\.EDITS\.get\(hk, 'json'\), Object\.assign\(\{[^]*?\}, histQaDetail\(qs, ai\)\)\)/.test(W));
ok('the browser copy of the engine is the engine', fs.readFileSync(path.join(ROOT, 'docs/labelguard_engine.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/labelguard.js'), 'utf8'));

console.log('-- the page: what the change log says');
const P = fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_GoldenRecord.html'), 'utf8');
const lift = (name) => {
  const i = P.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  let d = 0, j = P.indexOf('{', i);
  for (let k = j; k < P.length; k++) { if (P[k] === '{') d++; else if (P[k] === '}') { d--; if (!d) return P.slice(i, k + 1); } }
  throw new Error('unclosed ' + name);
};
const AIRP = P.match(/var AIRP_LBL = \{[^}]*\};/)[0];
const ctx = { LGQ: { qspecOf: LG.qspecOf }, SPEC: [], fmt: (x) => Number(x).toLocaleString('en-GB'), esc: (x) => String(x) };
vm.createContext(ctx);
vm.runInContext(['hDelta', 'hSigned', 'hCls', 'qaRuleLbl', 'qaMoved', 'qaSummary', 'hMoveTxt'].map(lift).join('\n') + '\n' + AIRP, ctx);
const after = LG.histQaDetail({ parts: [
  { key: 'title', score: 90.3, filled: 1000, broken: [{ id: 'caps', n: 118 }, { id: 'thin', n: 40 }] },
  { key: 'material', score: 96, filled: 800, broken: [{ id: matRule, n: 30 }] },
] }, { pillars: [{ key: 'titles', score: 70 }, { key: 'taxonomy', score: 52 }] });
const a = Object.assign({ t: 1 }, det), b = Object.assign({ t: 2 }, after);
const mv = ctx.qaMoved(a, b, 'q');
ok('the field that moved is named, a 0.2 wobble is not', mv.length === 1 && mv[0].k === 'material' && mv[0].d === 38, mv);
ok('…with the rule that moved it: products breaking it before → after', mv[0].rule && mv[0].rule.id === matRule && mv[0].rule.a === 420 && mv[0].rule.b === 30, mv[0].rule);
const t = ctx.hMoveTxt(mv[0]);
ok('the chip reads field, move and products fixed', /^g:material ▲ \+38 \(390 fixed\)$/.test(t.t), t.t);
ok('its tooltip names the rule in Google’s words and the counts', /g:material 58 → 96 · “.+”: 420 → 30 products/.test(t.tip), t.tip);
ok('the row summary counts the fields — one field\'s chip already carries its count', ctx.qaSummary(mv) === '1 field moved', ctx.qaSummary(mv));
const two = mv.concat([{ qa: 'q', k: 'title', from: 80, to: 85, d: 5, rule: { id: 'caps', a: 200, b: 50 } }]);
ok('…and across two or more adds up the product values that now pass', ctx.qaSummary(two) === '2 fields moved · 540 product values now pass', ctx.qaSummary(two));
const am = ctx.qaMoved(a, b, 'air');
ok('AI-readiness names the pillar that moved, in words', am.length === 1 && ctx.hMoveTxt(am[0]).t === 'Taxonomy depth ▲ +12', am.map((x) => ctx.hMoveTxt(x).t));
ok('an older analysis with no detail explains nothing rather than inventing', ctx.qaMoved({ q: 80 }, b, 'q').length === 0);
ok('the change log falls back to its plain line and says when detail starts', /which fields moved is recorded from the next analysis on/.test(P));
ok('the day hover reads the same moves', /e\.moved = qf \? qaMoved\(prev\.r, close, qf\)/.test(P) && /inWin\[0\]\.moved = qf \? qaMoved\(before, inWin\[0\]\.r, qf\)/.test(P));

console.log(fail ? '\n✗ ' + fail + ' of ' + n + ' failed' : '\n✓ ' + n + ' — why an analysis moved: stored with it, read back field by field');
process.exit(fail ? 1 : 0);
