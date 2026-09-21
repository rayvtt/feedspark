#!/usr/bin/env node
/*
 * THE KEYWORD CALENDAR'S KPI BAND AND MARKET LIST (Ray, 21 Sep 2026: "This section on keyword
 * calendar is so messy … the numbers also don't make sense. Why the 100% keyword saturation? …
 * the list of market should be cleaned up").
 *
 * Two things were wrong and one was unreadable:
 *  1. The stage tiles were NOT a partition — they covered intake/briefed/progress and
 *     live/done/confirmed, while COURTM also has running, analysis and blocked. A moment at
 *     Test running counted as briefed (so left "not yet briefed") and appeared in NO tile:
 *     14 scheduled over 1 + 1 + 9 = 11, three optimisations simply missing from the band.
 *  2. The market chips listed every WIRED feed including `-fb`, where the numbered
 *     g:product_type slots keywords live in do not exist in the Meta catalogue spec.
 *  3. Saturation asserted a headline with its counts in a tooltip and no date.
 *
 * The band's own arithmetic is lifted out of the page by name so the partition can never
 * silently lose a stage again. Wired into qa_gate, presync and validate.yml.
 */
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../docs/FeedSpark_KWCal.html', import.meta.url), 'utf8');

let pass = 0; const fails = [];
const is = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); }
  else fails.push(`${name}\n      got  ${g}\n      want ${w}`);
};
const ok = (name, cond) => is(name, !!cond, true);

// ---------- the stage vocabulary the board can actually produce ----------
const courtm = /var COURTM=\{([^}]*)\}/.exec(html);
ok('COURTM found', courtm);
const STAGES = courtm[1].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean);
ok('COURTM names the stages this test knows about',
  ['intake', 'briefed', 'progress', 'blocked', 'done', 'running', 'analysis', 'confirmed']
    .every((s) => STAGES.includes(s)));

// ---------- lift the band's bucket arithmetic ----------
const lift = (re, what) => { const m = re.exec(html); if (!m) throw new Error('could not lift ' + what); return m[0]; };
const buckets = lift(/ {2}var bNot=[\s\S]*?var bOther=E\.length-acc;/, 'the KPI buckets');
const band = new Function('st', 'E', `${buckets} return {bNot,bAspl,bAm,bDone,acc,bOther};`);

// every stage the board can produce, one moment each, PLUS the un-briefed state
const one = {}; STAGES.concat(['planned', 'live']).forEach((s) => { one[s] = 1; });
const total = Object.values(one).reduce((a, b) => a + b, 0);
const r = band(one, { length: total });
is('every stage lands in a bucket — nothing falls out of the band', r.bOther, 0);
is('…and the buckets sum to the total beside them', r.acc, total);

// the exact shape Ray screenshotted: 14 scheduled, one briefed, one done, three at
// running/analysis, nine never briefed
const ray = { planned: 9, briefed: 1, running: 2, analysis: 1, done: 1 };
const rr = band(ray, { length: 14 });
is('Ray’s board reconciles: 9 + 3 + 1 + 1 = 14', rr.acc, 14);
is('…nothing stranded', rr.bOther, 0);
is('…the two Test-running moments are WITH ASPL', rr.bAspl, 3);      // briefed 1 + running 2
is('…the one in analysis is with the AM', rr.bAm, 1);
// the OLD arithmetic, verbatim, so the regression is recorded as the sum it actually was
const oldBand = (st) => ({
  inflight: (st.intake || 0) + (st.briefed || 0) + (st.progress || 0),
  complete: (st.live || 0) + (st.done || 0) + (st.confirmed || 0),
  notBriefed: 14 - (14 - (st.planned || 0)),   // E.length - briefed
});
const o = oldBand(ray);
is('the old band put 1 in flight and 1 complete', [o.inflight, o.complete], [1, 1]);
is('…against 9 not briefed, so 3 of 14 appeared in no tile at all',
  14 - o.notBriefed - o.inflight - o.complete, 3);
is('…the three being exactly the running + analysis moments',
  (ray.running || 0) + (ray.analysis || 0), 3);

// an unknown stage is SHOWN, never dropped
const odd = band({ planned: 1, sometime_new: 2 }, { length: 3 });
is('a stage the band does not name is surfaced, not silently lost', odd.bOther, 2);

// ---------- the market list ----------
ok('the chip list drops -fb feeds', /var ks=all\.filter\(function\(m\)\{ return !\/-fb\$\/i\.test\(m\); \}\);/.test(html));
ok('…and says how many it dropped rather than removing them silently', /MKTFB=all\.length-ks\.length/.test(html) && /Meta feed'\+\(MKTFB===1\?'':'s'\)\+' not shown/.test(html));
ok('the long list folds behind one button', /MKT_SHOW=12/.test(html) && /data-mkall=/.test(html));
ok('…and the board’s own market is never folded away',
  /if\(!MKTALL&&show\.indexOf\(MKT\)<0\)show=show\.slice\(0,MKT_SHOW-1\)\.concat\(\[MKT\]\)/.test(html));

// ---------- saturation states what it counted ----------
ok('saturation prints its counts on the tile, not only in a tooltip', /class="kq2">'\+esc\(sub\)/.test(html));
ok('…names how many keyword columns it read', /read across '\+cols\+' keyword column/.test(html));
ok('…dates the reading and warns when it is stale', /var stale=\(age!=null&&age>14\)/.test(html));
ok('…and flags the every-SKU-one-slot shape as something to CHECK, not an error',
  /var thin=\(sp>=99&&cols<=1\)/.test(html) && /more likely a second category path/.test(html));

// the two bands share one container, so the per-brand band's stacked layout must not leak
// into the all-brands overview (a flat row inside display:block stacks vertically)
ok('the per-brand band stacks', /\$\('#kpis'\)\.className='kpis stacked';/.test(html));
ok('…and the all-brands overview puts the flat class back', /\$\('#kpis'\)\.className='kpis';/.test(html));
ok('both rows are closed', (html.match(/\+'<\/div><div class="kgrp-h">Measures<\/div><div class="kgrp">'/g) || []).length === 1
  && /\+'<\/div>';\n\}/.test(html));

console.log(fails.length ? `\n${pass} passed, ${fails.length} failed` : `\n${pass} passed, 0 failed`);
fails.forEach((f) => console.log('  ✗ ' + f));
if (fails.length) process.exit(1);
console.log('PASS');
