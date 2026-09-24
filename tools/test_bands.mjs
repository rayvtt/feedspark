#!/usr/bin/env node
/* ONE COLOUR LEGEND ACROSS EVERY AUDIT (Ray, 23 Sep 2026, on the Workflow Playbook's Golden Record
   bar painting 76.7% red: "golden record and bar color should be a bit more forgiving (< 70 red,
   70-85 orange, 85 - 95 yellow, 95-100 green) - apply across all audit").

   Every surface that colours a completeness / coverage / content-quality number carries the SAME
   auditBand function: /golden (the dial, estate cards, attribute fill bars, content-quality score
   and bars), /feedlab (attribute coverage), the Command Center dossier's Golden Record card, and the
   Playbook rail inside Workflow. Pages cannot import each other, so this harness LIFTS every copy
   by name and runs them through one table — a page that drifts fails here, not on Ray's screen.

   AI-readiness is deliberately NOT on this legend: its colours ARE its tier ladder (40 / 60 / 80 =
   Structured / Enriched / Agentic-ready) and the conversational pillar caps a feed without the six
   AI attributes at 79.3, so the 95-green legend would paint the whole estate red. Pinned below so
   a later sweep cannot fold it in by accident.

   Run: node tools/test_bands.mjs   (qa_gate / presync / validate) */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};
const read = (f) => readFileSync(new URL('../docs/' + f, import.meta.url), 'utf8');
const PAGES = {
  golden: read('FeedSpark_GoldenRecord.html'),
  feedlab: read('FeedSpark_FeedLab.html'),
  dossier: read('FeedSpark_Command_Center.html'),
  playbook: read('FeedSpark_Workflow.html'),
};
const lift = (src, name) => {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) ?\\{[^\\n]*\\}'));
  if (!m) throw new Error('not found: ' + name);
  return m[0];
};

console.log('── the legend: <70 red · 70–85 orange · 85–95 yellow · 95+ green');
const TABLE = [[0, 'red'], [45, 'red'], [69.9, 'red'], [70, 'orange'], [76.7, 'orange'], [84.9, 'orange'],
  [85, 'yellow'], [90, 'yellow'], [94.9, 'yellow'], [95, 'green'], [99.9, 'green'], [100, 'green'], [null, ''], [NaN, '']];
const fns = {};
for (const [k, src] of Object.entries(PAGES)) {
  fns[k] = new Function(lift(src, 'auditBand') + '; return auditBand;')();
  const bad = TABLE.filter(([v, want]) => fns[k](v) !== want);
  ok(k + ': every boundary lands in the right band', bad.length === 0, bad);
}

console.log('── /golden');
{
  const g = PAGES.golden;
  const scoreCol = new Function(lift(g, 'auditBand') + ';' + g.match(/var BAND_COL = \{[^}]+\};/)[0] +
    g.match(/function scoreCol\(s\) \{[\s\S]*?\n  \}/)[0] + '; return scoreCol;')();
  ok('the score colour reads the legend (dial, estate cards, content-quality score)',
    scoreCol(96) === 'var(--good)' && scoreCol(90) === '#F5A623' && scoreCol(76.7) === '#ED6F0B' && scoreCol(60) === 'var(--risk)' && scoreCol(null) === 'var(--muted)');
  ok('attribute fill bars are banded, not the old full / low pair', /var cls = ' class="b-' \+ auditBand\(a\.cov\) \+ '"';/.test(g) && !/class="full"/.test(g));
  ok('…and all four band classes are styled', ['b-green', 'b-yellow', 'b-orange', 'b-red'].every((c) => g.includes('.at-bar i.' + c + '{')));
  ok('content-quality bars read the legend', /function qualBand\(s\) \{ return 'b-' \+ auditBand\(s\); \}/.test(g) &&
    ['b-yellow', 'b-orange', 'b-red'].every((c) => g.includes('.qz-bar i.' + c + '{')));
  ok('AI-readiness keeps its tier colours (40 / 60 / 80)', /function airCol\(s\) \{ return s < 40 \? 'var\(--risk\)' : \(s < 60 \? 'var\(--orange-deep\)' : \(s < 80 \? 'var\(--orange\)' : 'var\(--good\)'\)\); \}/.test(g));
}

console.log('── /feedlab');
{
  const f = PAGES.feedlab;
  ok('attribute coverage rows are banded', /class="arow b-'\+auditBand\(pct\)\+'"/.test(f));
  ok('…the bar AND the percentage carry the band colour', ['b-green', 'b-yellow', 'b-orange', 'b-red'].every((c) => f.includes('.arow.' + c + ' .afill{') && f.includes('.arow.' + c + ' .apc{')));
  ok('the AI-readiness headline keeps its tier colours', /function scoreColor\(s\)\{return s<40\?'var\(--risk\)':s<60\?'var\(--orange-deep\)':s<80\?'var\(--orange\)':'var\(--good\)'\}/.test(f));
}

console.log('── the dossier Golden Record card');
{
  const d = PAGES.dossier;
  const grBand = new Function(lift(d, 'auditBand') + ';' + lift(d, 'grBand') + '; return grBand;')();
  const want = [[96, 'good'], [90, 'mid'], [76.7, 'warn'], [60, 'bad'], [null, '']];
  ok('grBand = the legend under the card\'s own class names', want.every(([v, c]) => grBand(v) === c), want.map(([v]) => grBand(v)));
  ok('the ring, legend and per-market pills have a yellow to draw', /var GR_COL=\{good:'#15803D',mid:'#F5A623',warn:'#ED6F0B',bad:'#C0392B'\};/.test(d) &&
    d.includes('.dzp-as.mid{') && d.includes('.grm-k b.mid{'));
}

console.log('── the Playbook rail (the screenshot)');
{
  const w = PAGES.playbook;
  const pbBand = new Function(lift(w, 'auditBand') + ';' + lift(w, 'pbBand') + '; return pbBand;')();
  ok('76.7% completeness is ORANGE, not red', pbBand(76.7) === 'warn');
  ok('the band classes follow the legend', pbBand(96) === 'good' && pbBand(88) === 'mid' && pbBand(69) === 'crit');
  ok('the completeness bar and the weakest-first bars read it', /\+bar\(avg,pbBand\(avg\)\)/.test(w) && /bar\(w\.cov,pbBand\(w\.cov\)\)/.test(w));
  ok('yellow is styled in both themes', /\.ck-bar\.mid i\{background:#F5A623\}/.test(w) && /\[data-theme=dark\] \.ck-bar\.mid i\{/.test(w));
  ok('coverage is read as the PERCENTAGE the index stores — floors, bars and the worst figure',
    /var PB_FLOOR=\{req:99,cond:90,rec:60\};/.test(w) && !/cov\*100/.test(w) && !/worst\*100/.test(w));
}

console.log(`\naudit colour bands: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
