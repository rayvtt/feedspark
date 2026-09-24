#!/usr/bin/env node
/*
 * Playbook panel — Workflow's right-hand rail (Ray, 16 Sep 2026).
 *
 * "Let's elevate the workflow like a playbook … the playbook will generate in real time: first,
 *  what the clients are doing well and what they are not doing; second, product volumes for new
 *  products. If a new product accounts for 10% to 20% of total, it should be highlighted because
 *  it indicates a new collection that needs immediate attention. Third, include golden records of
 *  all audit attributes that are not working well … Delete the separate playbook module and
 *  incorporate it into the workflow as the right-hand panel."
 *
 * This is read out loud on client calls, so the judgements it makes are pinned here: which
 * practices count as landing, what "not doing" is allowed to mean, the 10–20% collection band,
 * which month arrivals are read from, and which attributes count as not working.
 *
 * The engine is lifted out of the page between its PBENGINE markers — rename or move it and this
 * fails loudly, which is the point. The second half asserts the module was really retired: the
 * page deleted, the route redirected, the nav swapped on every page, the grant folded away.
 *
 * Run: node tools/test_playbook_panel.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WF = rd('docs/FeedSpark_Workflow.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, m + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

// ---- lift the engine ---------------------------------------------------------------------------
const S = WF.indexOf('/* PBENGINE:START'), E = WF.indexOf('/* PBENGINE:END */');
if (S < 0 || E < 0 || E < S) { console.error('✗ PBENGINE markers missing from docs/FeedSpark_Workflow.html'); process.exit(1); }
const block = WF.slice(S, E);
const names = ['pbClassify', 'pbCats', 'pbIndex', 'pbPractice', 'pbBand', 'pbArrivals', 'pbWeak', 'PB_TAX', 'PB_TIER',
  'pbRaise', 'pbCatMix', 'pbLastOpt', 'pbAgeDays', 'PB_RAISE_OPTS', 'PB_RAISE_DEF', 'PB_BACKLOG_MONTHS', 'pbSpark', 'pbActions'];
const EN = new Function(block + '\n;return {' + names.map((n) => n + ':' + n).join(',') + '};')();
const { pbSpark, pbActions } = EN;
const { pbClassify, pbCats, pbIndex, pbPractice, pbBand, pbArrivals, pbWeak, PB_TAX, PB_TIER,
  pbRaise, pbCatMix, pbLastOpt, pbAgeDays, PB_RAISE_OPTS, PB_RAISE_DEF, PB_BACKLOG_MONTHS } = EN;

console.log('\n── the classifier');
eq(pbClassify('Keywords Optimisation - Cashmere - Marketing Planner - 0926'), 'keyword', 'a keyword optimisation is a keyword task');
eq(pbClassify('Sale roundel overlay refresh'), 'image', 'a roundel overlay is image work');
eq(pbClassify('Backfill gtin across the DE feed'), 'golden', 'gtin backfill is Golden Record work');
eq(pbClassify('Monthly catch-up'), 'general', 'text matching nothing is general, never forced into a category');
eq(pbClassify('Custom label rebuild', { hide: { labels: 1 } }), 'general', 'a hidden category is not classified into');
eq(pbClassify('Ship the widget', { extra: { image: ['widget'] } }), 'image', 'a tuned extra term classifies');

console.log('\n── practices: done is the plan bucket, not a guess');
const TASKS = [
  { t: 'Title rewrite GB', b: 'done' }, { t: 'Title rewrite DE', b: 'done' },
  { t: 'Title rewrite IE', b: 'done' }, { t: 'Title rewrite FR', b: 'done' }, { t: 'Title rewrite US', b: 'open' },
  { t: 'Custom label CL2 rebuild', b: 'open' }, { t: 'Custom label CL3 rebuild', b: 'open' },
  { t: 'Custom label CL4 rebuild', b: 'done' },
];
const cats = pbCats(TASKS);
eq(cats.title.all, 5, 'five title tasks bucketed');
eq(cats.title.done, 4, 'four of them finished');
eq(cats.labels.open.length, 2, 'the unfinished ones are kept by name, not just counted');

const IDX = pbIndex({
  Reiss: { tasks: TASKS },
  Schuh: { tasks: [{ t: 'Overlay roundel A', b: 'done' }, { t: 'Overlay roundel B', b: 'done' }] },
  Monsoon: { tasks: [{ t: 'Image cycler set-up', b: 'done' }, { t: 'Image cycler refresh', b: 'open' }] },
  YuMOVE: { tasks: [{ t: 'Search intent map', b: 'done' }] },
});
const P = pbPractice(cats, IDX, 'Reiss');
ok(P.well.length === 1 && P.well[0].k === 'title', 'landing = 3+ finished AND 80%+ through');
ok(P.slip.length === 1 && P.slip[0].k === 'labels' && P.slip[0].open === 2, 'stalling = 2+ tasks under 60% through, counted by what is open');
ok(P.gap.some((g) => g.k === 'image' && g.peers === 2), '"not doing" needs TWO peer accounts actually running the play');
ok(!P.gap.some((g) => g.k === 'intent'), 'one peer with a single task is not evidence of a practice');
ok(!P.gap.some((g) => g.k === 'account' || g.k === 'tech'), 'BAU admin is never cross-pollinated onto a client call');
ok(!pbPractice(pbCats([{ t: 'Overlay roundel A', b: 'done' }, { t: 'Overlay roundel B', b: 'done' }]), IDX, 'Schuh').gap.some((g) => g.k === 'image'),
  'a brand is never its own peer — work it already does is not a gap');

console.log('\n── new products: the 10–20% collection band, exactly as asked');
eq(pbBand(0), 'steady', 'nothing new is steady');
eq(pbBand(4.9), 'steady', 'under 5% is steady');
eq(pbBand(5), 'watch', '5% starts building');
eq(pbBand(9.9), 'watch', '9.9% is still building, not a collection');
eq(pbBand(10), 'collection', '10% IS a collection landing — the lower edge Ray named');
eq(pbBand(19.9), 'collection', 'the whole 10–20% band is a collection');
// above the band is the SAME signal louder, so it is still highlighted — never dropped off the top
eq(pbBand(20), 'major', '20%+ is a major drop, still highlighted');
eq(pbBand(35), 'major', 'a third of the catalogue arriving at once is the loudest case there is');

const NOW = Date.UTC(2026, 8, 16);                       // 16 Sep 2026
const dob = { rows: 10000, m: { '2026-06': 300, '2026-07': 1200, '2026-08': 1500, '2026-09': 90 } };
const a = pbArrivals(dob, NOW);
eq(a.month, '2026-08', 'arrivals read the last COMPLETE month, never the running one');
eq(a.n, 1500, 'that month’s count');
eq(Math.round(a.pct * 10) / 10, 15, '15% of the catalogue');
eq(a.band, 'collection', '15% highlights as a collection');
ok(pbArrivals(null, NOW) === null, 'no histogram = no answer (never a zero)');
ok(pbArrivals({ rows: 10, m: { '2026-09': 5 } }, NOW) === null, 'a feed with only the running month has no complete month yet');
eq(pbArrivals({ rows: 0, m: { '2026-08': 5 } }, NOW).pct, 0, 'an empty catalogue never divides by zero');

console.log('\n── Golden Record: what is not working');
const rec = {
  score: 88,
  reqMissing: ['image_link'],
  condMissing: ['gtin'],
  recMissing: ['product_highlight'],
  // PERCENTAGES, the unit goldenidx actually stores (the fixture used fractions, which is how a
  // floor written as 0.6 passed here while every real reading cleared it — 23 Sep 2026)
  cov: { id: 100, title: 100, description: 97, price: 100, brand: 100, color: 72, product_type: 55, material: 90,
    question_and_answer: 2, image_link: null },
};
const W = pbWeak(rec);
const keys = W.map((w) => w.k);
eq(keys[0], 'image_link', 'a MISSING required attribute is the worst thing on the feed');
ok(keys.indexOf('description') > 0 && keys.indexOf('description') < keys.indexOf('product_type'),
  'a required attribute under 99% outranks a thin recommended one');
ok(keys.includes('gtin'), 'a missing conditional attribute is listed');
ok(keys.includes('color'), 'a conditional attribute under 90% is listed');
ok(keys.includes('product_type'), 'a recommended attribute under 60% is listed');
ok(!keys.includes('material'), 'a recommended attribute at 90% is fine — not everything is a problem');
ok(!keys.includes('title') && !keys.includes('price'), 'a fully-filled required attribute is not listed');
ok(!keys.includes('question_and_answer'), 'the conversational AI six are supplemental by design — never scored as a failure here');
eq(keys.filter((k) => k === 'image_link').length, 1, 'a missing attribute is listed once, not again from the coverage map');
ok(pbWeak(null).length === 0, 'an unscanned feed yields nothing — absent is not zero');
ok(Object.keys(PB_TIER).filter((k) => PB_TIER[k] === 'req').length === 7, 'Google’s seven always-required attributes');

console.log('\n\u2500\u2500 the bottom line: top 3 actions');
/* Ray, 18 Sep 2026: "when you say completeness across ten markets is 76.7%, that's great, but at
   the bottom line, nominate the top three actions you would potentially take for each account,
   and then have AM talk to the clients about it." */
{
  const G = (mkt, req, cond, cov) => ({ mkt, score: 70, reqMissing: req || [], condMissing: cond || [], cov: cov || {} });
  const gold = [
    G('gb', ['mpn'], [], { gtin: 42, item_group_id: 71 }),
    G('de', ['mpn'], [], { gtin: 55, item_group_id: 80 }),
    G('fr', [], [], { gtin: 60, item_group_id: 88 }),
  ];
  const raises = [{ mkt: 'us', n: 7049, age: 78, since: true, rows: 23409, pct: 30 }];
  const practice = { gap: [{ k: 'golden', peers: 5 }], slip: [{ k: 'test', open: 3, rate: 0.4 }] };

  const a = pbActions(gold, raises, practice, 'Superdry', {});
  eq(a.length, 3, 'three actions, never more');
  eq(a[0].p, 1, 'a REQUIRED attribute outranks everything — products are refused today');
  ok(/mpn/.test(a[0].title), 'and it names the attribute: ' + a[0].title);
  eq(a[1].kind, 'raise', 'the new-product backlog comes next, ahead of a conditional attribute');
  ok(a.every((x) => x.p <= 3), 'nothing ranks outside P1-P3');
  ok(a.map((x) => x.p).join('') === '122', 'ranked by cost of ignoring: ' + a.map((x) => 'P' + x.p).join(' '));

  /* THE TRAP THIS EXISTS TO CATCH. An earlier cut derived the evidence line and the client line
     from different counts and produced "2 markets missing it entirely" over "missing on 5 of your
     markets" — read out on a client call, that ends the AM's credibility. Count, sentence and the
     market chip must all describe ONE population. */
  a.forEach((x) => {
    const evN = (x.ev.match(/^([\d,]+)/) || [])[1];
    if (!evN) return;
    ok(x.say.indexOf(evN) >= 0,
      x.key + ': the client line quotes the same figure as the evidence (' + evN + ')');
  });
  const mpn = a.find((x) => x.key === 'attr:mpn');
  eq(mpn.mkts.length, 2, 'the market chip names exactly the markets the count is about');
  ok(mpn.mkts.join(',') === 'gb,de', 'and they are the ones actually missing it: ' + mpn.mkts.join(','));

  console.log('\n\u2500\u2500 absent and thin are different problems');
  const thin = pbActions([G('gb', [], [], { gtin: 42 }), G('de', [], [], { gtin: 70 })], [], {}, 'X', {});
  ok(/below spec, worst 42%/.test(thin[0].ev), 'a thin attribute reports its worst coverage: ' + thin[0].ev);
  ok(!/missing/.test(thin[0].ev), 'and is never described as missing');
  eq(thin[0].mkts.length, 2, 'both thin markets are named');
  /* a conditional attribute is required only WHERE IT APPLIES, so it must not inherit the flat
     "can be refused" a required one earns — that is overclaiming to a client. */
  ok(!/can be refused/.test(thin[0].say), 'a conditional attribute never claims products "can be refused"');
  const req = pbActions([G('gb', ['title'], [], {})], [], {}, 'X', {});
  ok(/can be refused/.test(req[0].say), 'a REQUIRED one does say so — that is the whole point');

  console.log('\n\u2500\u2500 nothing is padded to reach three');
  eq(pbActions([], [], {}, 'X', {}).length, 0, 'a clean account gets no actions at all');
  eq(pbActions([G('gb', ['mpn'], [], {})], [], {}, 'X', {}).length, 1, 'one real action stays one');
  const gapOnly = pbActions([], [], { gap: [{ k: 'golden', peers: 5 }] }, 'X', {});
  eq(gapOnly[0].p, 3, 'a capability gap is P3 — worth raising, never urgent');

  console.log('\n\u2500\u2500 every action is actionable');
  a.forEach((x) => {
    ok(!!x.brief, x.key + ' carries a brief');
    ok(typeof x.say === 'string' && x.say.length > 30, x.key + ' carries a client line');
    ok(!/\bg:/.test(x.say), x.key + ': the client line has no g: field names in it');
    ok(!/\breq\b|\bcond\b|tier/.test(x.say), x.key + ': nor tier jargon');
  });
}

console.log('\n\u2500\u2500 the counters name their unit');
/* Ray, same day: "the enterprise channels market 18 to 18 — what does that mean?" A bare pair on
   a row called "Channels & Markets" reads as MARKETS, which is the one thing it is not. */
ok(WF.indexOf("+r.done+'/'+r.all+' <small>tasks</small>") >= 0, 'the Landing row says what 18/18 counts');
ok(/project-plan tasks in this practice are done/.test(WF), 'and spells it out in full on hover');

console.log('\n\u2500\u2500 the 12-month sparkline, and the red that left with it');
/* Ray, 17 Sep 2026, sending the Volume module's own estate sparkline: "these new products alert
   on the Playbook banner - can you replace with these bar chart instead and no need red
   highlights". The rows used to be an amber wash, a red wash over it for a backlog, and a filled
   NEW COLLECTION pill — which on a 28-market brand all sitting at 12-13% painted EVERY row the
   same colour, so the highlight discriminated nothing. */
{
  const N = Date.UTC(2026, 8, 17);                       // 17 Sep 2026
  const sp = pbSpark({ rows: 10000, m: { '2026-09': 90, '2026-08': 1500, '2026-06': 300 } }, N);
  eq(sp.months.length, 12, 'twelve months come back');
  eq(sp.months[11].k, '2026-09', 'the last one is the running month');
  ok(sp.months[11].cur === true, 'and it is flagged as running, never plotted as finished');
  ok(sp.months.slice(0, 11).every((x) => !x.cur), 'no other month is');
  eq(sp.months[0].k, '2025-10', 'the window opens 11 months back');

  // THE TRAP: dob.m only holds months that HAD arrivals. Slicing its keys would draw twelve bars
  // that look consecutive and are not — July is missing here, and must still take a slot.
  const keys = sp.months.map((x) => x.k);
  eq(keys.indexOf('2026-07') >= 0, true, 'a month absent from the histogram still gets its slot');
  eq(sp.months[keys.indexOf('2026-07')].n, 0, 'and reads zero, not a gap that closes up');
  eq(sp.months[keys.indexOf('2026-08')].n, 1500, 'a month that had arrivals carries its count');
  eq(sp.peak, 1500, 'the peak scales the bars');

  // a window that crosses the year boundary
  const y = pbSpark({ m: { '2025-12': 40 } }, Date.UTC(2026, 1, 3));
  eq(y.months.map((x) => x.k).join(','),
    '2025-03,2025-04,2025-05,2025-06,2025-07,2025-08,2025-09,2025-10,2025-11,2025-12,2026-01,2026-02',
    'the calendar walk crosses a year end correctly');
  eq(y.peak, 40, 'peak still found across the boundary');

  ok(pbSpark(null, N) === null && pbSpark({}, N) === null,
    'a feed with no first-seen histogram draws nothing rather than an empty chart');
  const zero = pbSpark({ m: {} }, N);
  eq(zero.peak, 0, 'an all-zero feed has no peak to divide by — the renderer floors it at 1');
}

console.log('\n\u2500\u2500 the red highlights really are gone');
ok(!/\.ck-row\.hot\b/.test(WF), 'no .ck-row.hot rule survives');
ok(!/\.ck-row\.raise\{/.test(WF), 'no .ck-row.raise wash survives');
ok(!/ck-raised[^}]*color:var\(--risk/.test(WF), 'the cohort summary is no longer red');
ok(!/ck-why\{[^}]*--risk/.test(WF), 'nor is the per-market backlog line');
ok(!/class="ck-pill '\+\(a\.band/.test(WF), 'the per-row band pill is gone from the arrivals row');
ok(/ck-spark/.test(WF) && /sparkHtml\(sp\)/.test(WF), 'the row draws the sparkline instead');
/* ONE arrivals visual across the FCC: the rail borrows the Volume module's marks rather than
   inventing a second set that could disagree with the page it links to. */
const VOL = rd('docs/FeedSpark_Volume.html');
ok(/\.ck-spark i\{[^}]*#2563EB/.test(WF) && /--vin[^;]*:\s*#2563EB/i.test(VOL) || /#2563EB/.test(VOL),
  'it uses the Volume module\'s validated blue');
ok(/\[data-theme=dark\] \.ck-spark i\{[^}]*#4C82E0/.test(WF), 'and its validated dark step');
ok(/\.ck-spark i\.cur\{opacity:\.45\}/.test(WF), 'running month at the same .45 the estate table uses');
ok(/still running/.test(WF), 'and the copy says the current month is still running');

console.log('\n\u2500\u2500 the raise: a backlog, not a calendar artefact');
// Ray, 17 Sep 2026: "raise when a certain amount of time passes and a new product comes into the
// feed and need to be looked at / briefed directly into Intake for optimisation such as (titles,
// keywords)". The tempting rule — age the last complete month's cohort — can only ever be 0–30
// days old, so a 30-day threshold would fire on one day a month. These pin the rule that replaced it.
const FEED = (m, rows) => ({ client: 'Reiss', mkt: 'gb', dob: { rows: rows || 10000, m } });
const MONTHS = { '2026-05': 200, '2026-06': 300, '2026-07': 400, '2026-08': 1500, '2026-09': 90 };
eq(pbLastOpt([{ t: 'Title rewrite GB', d: '2026-06' }, { t: 'Overlay refresh', d: '2026-08' }]), '2026-06',
  'the anchor is the last TITLE or KEYWORD task — overlay work is not title work');
eq(pbLastOpt([{ t: 'Keywords Optimisation - Cashmere', d: '2026-07-14' }, { t: 'Title sweep', d: '2026-05' }]), '2026-07',
  'a full date resolves to its month, and the newest wins');
eq(pbLastOpt([]), '', 'a brand with no plan read has no anchor');

const R = pbRaise(FEED(MONTHS), [{ t: 'Title rewrite', d: '2026-06' }], 21, NOW);
eq(R.n, 1900, 'the backlog is every month AFTER the last optimisation — Jul + Aug, not one cohort');
eq(R.from, '2026-07', 'aged from the OLDEST month still unworked');
eq(R.to, '2026-08', 'up to the last complete one');
eq(R.age, pbAgeDays('2026-07', NOW), 'and the age is how long that oldest month has been waiting');
ok(R.age > 30, 'which can exceed a month — the whole point of not using the calendar cohort');
eq(R.since, '2026-06', 'the raise names what it is measured against');
ok(R.months.indexOf('2026-09') < 0, 'the RUNNING month is never counted — a part-month is not a finished one');
ok(pbRaise(FEED(MONTHS), [{ t: 'Keyword sweep', d: '2026-09' }], 21, NOW) === null,
  'work done this month clears the backlog — nothing to raise');
ok(pbRaise(FEED(MONTHS), [{ t: 'Title rewrite', d: '2026-08' }], 21, NOW) === null,
  'and work in the last complete month leaves nothing after it');
const NOPLAN = pbRaise(FEED(MONTHS), [], 21, NOW);
ok(NOPLAN && NOPLAN.since === '' && NOPLAN.n > 0,
  'a brand with NO title or keyword task on record is raised, never quietly assumed covered');
ok(pbRaise(FEED({ '2026-08': 1500 }), [], 30, NOW) === null,
  'a cohort younger than the threshold is not raised');
ok(pbRaise(FEED({ '2019-04': 9000 }), [], 21, NOW) === null,
  'arrivals older than the backlog window are a catalogue rewrite, not new-product work');
ok(pbRaise({ client: 'Reiss', mkt: 'gb' }, [], 21, NOW) === null, 'an unscanned feed raises nothing');
eq(PB_RAISE_DEF, 21, 'the default threshold is the FCC\u2019s own keyword lead time');
ok(PB_RAISE_OPTS.indexOf(PB_RAISE_DEF) >= 0 && PB_BACKLOG_MONTHS >= 3, 'the offered thresholds include the default');
// monotonic: a longer threshold can only ever raise fewer markets, so the chips cannot surprise
ok(PB_RAISE_OPTS.slice().sort((a, b) => a - b).every((d, i, arr) =>
  i === 0 || !pbRaise(FEED(MONTHS), [], d, NOW) || !!pbRaise(FEED(MONTHS), [], arr[i - 1], NOW)),
  'raising at a longer threshold implies raising at a shorter one');

console.log('\n\u2500\u2500 where they landed: the product-type breakdown');
const day = (back) => new Date(NOW - back * 86400000).toISOString().slice(0, 10);
const HIST = [
  { d: day(40), cats: [{ c: 'Ancient', in: 999 }] },                       // outside the window
  { d: day(5), cats: [{ c: 'Dresses', in: 60 }, { c: 'Knitwear', in: 30 }, { c: 'Bags', in: 10 }] },
  { d: day(2), cats: [{ c: 'Dresses', in: 40 }, { c: 'Shoes', in: 20 }, { c: 'Denim', in: 5 },
    { c: 'Hats', in: 4 }, { c: 'Belts', in: 3 }, { c: 'Scarves', in: 2 }] },
];
const MIX = pbCatMix(HIST, 30, NOW);
eq(MIX.total, 174, 'arrivals are summed across the window');
ok(!MIX.rows.some((r) => r.c === 'Ancient'), 'and only inside it — a day older than the window is not counted');
eq(MIX.rows[0].c, 'Dresses', 'biggest category first');
eq(MIX.rows[0].n, 100, 'summed across days, not taken from the latest one');
eq(Math.round(MIX.rows[0].share), 57, 'with its share of the window');
eq(MIX.rows[MIX.rows.length - 1].c, 'Other', 'the tail folds into Other rather than running to 40 rows');
ok(MIX.rows[MIX.rows.length - 1].other === true, 'and says so, so nobody reads it as a real category');
eq(MIX.rows.length, 6, 'five named categories plus Other');
eq(MIX.rows.reduce((a, r) => a + r.n, 0), MIX.total, 'Other carries the remainder exactly — the shares still add up');
ok(pbCatMix([], 30, NOW) === null, 'no history is no answer (never an empty chart implying zero)');
ok(pbCatMix([{ d: day(1), cats: [{ c: 'X', in: 0 }] }], 30, NOW) === null, 'and a window with no arrivals is the same');

console.log('\n── the panel is wired into Workflow');
ok(/id="fcc-hrs-dock"/.test(WF), 'the retainer read-out has a home in the LEFT rail');
ok(/id="ck-r-body"/.test(WF) && /id="ck-brand"/.test(WF), 'the playbook is the RIGHT rail, with its own account picker');
ok(/body\.ck-l-on\{padding-left/.test(WF) && /body\.ck-r-on\{padding-right/.test(WF),
  'both rails PUSH the page — the complaint was that the popover covered the tasks and brands');
ok(/\/api\/playbook/.test(WF) && /\/api\/volume\/arrivals/.test(WF) && /\/api\/golden\/estate/.test(WF),
  'all three sections read live routes, not baked figures');
ok(PB_TAX.length >= 16, 'the strategy taxonomy came across whole');
ok(/id="ck-tabs"/.test(WF) && /data-tab="volume"/.test(WF),
  'New products is a panel of its own beside the review, in the rail that already pushes the page');
ok(/window\.FCCBrief\s*=\s*briefFromModule/.test(WF),
  'one entry into the composer — the rail and the module deep links call the same function');
ok(/function openBrief\(\)\{/.test(WF),
  'and it did not shadow the composer\u2019s own opener (a second openBrief silently broke ＋ New brief)');
ok(/data-brief="title"/.test(WF) && /data-brief="keyword"/.test(WF),
  'a raised market is briefed for titles or keywords straight from the row');
// Ray, 17 Sep 2026: "if the brand is selected, can the filter also be applied in the intake and
// vice versa?" — ONE client filter on the page, written from both ends, never a second one.
ok(/window\.FCCFilterClient\s*=\s*filterToClient/.test(WF),
  'the panel filters Intake through one named entry point');
ok(/function filterToClient\(name\)\{[\s\S]{0,420}itState\.clients=\[name\]/.test(WF),
  'and it writes the SAME itState.clients the chips and the \u25be menu write');
ok(/if\(!allIntake\(\)\.some\(function\(r\)\{ return r\.client===name; \}\)\)return false;/.test(WF),
  'a brand the board does not carry is refused, not silently self-cleaned by the filter control');
ok(/sel\.addEventListener\('change',function\(\)\{ BRAND=sel\.value; render\(\); syncBoard\(\); \}\)/.test(WF),
  'only a REAL pick propagates — opening the rail must not re-filter the board behind the reader');
ok(/NOBOARD\)parts\.push\('not on the board'\)/.test(WF),
  'and when the board cannot follow, the panel says so');
// Ray, 17 Sep 2026: "2 panels button should be independent of each other — when a tab is clicked
// on Playbook the Retainer panel popped up again even though [I] clicked ✕ to close". render()
// refreshes the dock's contents on every tab click; treating that as a request to OPEN re-opened
// a rail the reader had just shut, and persisted it.
ok(/e\.detail&&e\.detail\.user&&!isOpen\('l'\)\)openRail\('l',true\)/.test(WF),
  'only a user-initiated dock request may open the retainer rail');
const HW2 = rd('docs/hours_widget.html');
ok(/function dockShow\(name, opts\)/.test(HW2) && /user: !!\(opts && opts\.user\)/.test(HW2),
  'the widget marks which dock calls came from a click');
ok(/if \(dockShow\(name, \{ user: true \}\)\) return;/.test(HW2),
  'a dot click is the one that carries it');
ok(!/dockShow\(nm, ?\{ ?user/.test(HW2) && !/dockShow\(key, ?\{ ?user/.test(HW2),
  'the refresh and posture-save paths stay housekeeping, so neither re-opens a closed rail');

console.log('\n── the standalone module is really gone');
ok(!fs.existsSync(path.join(root, 'docs/FeedSpark_Playbook.html')), 'the /playbook page is deleted');
const W2 = rd('cloudflare/feedspark-deck/src/worker.js');
ok(!/PLAYBOOK_PAGE/.test(W2), 'the worker no longer imports a playbook page');
ok(/path === '\/playbook'[\s\S]{0,220}Location: '\/workflow\?pb=1'/.test(W2), '/playbook 301s onto the rail, so old links still land');
ok(/\/api\/playbook' && request\.method === 'GET'/.test(W2), 'the crawl that feeds it survives — only the page went');
ok(/h\.replace\(\/\[\?#\]\.\*\$\/,""\)/.test(W2), 'MODGATE strips a query string before reading a nav link’s module slug');
const acc = rd('cloudflare/feedspark-deck/src/access.js');
ok(!/slug: 'playbook'/.test(acc), 'the Playbook is no longer separately grantable — it rides the workflow grant');

const navPages = fs.readdirSync(path.join(root, 'docs')).filter((f) => /^FeedSpark_.*\.html$/.test(f))
  .filter((f) => /tb-nav tb-modules/.test(rd('docs/' + f)));
ok(navPages.length >= 20, 'every app page was checked (' + navPages.length + ')');
const bad = navPages.filter((f) => { const s = rd('docs/' + f); return /href="\/playbook"/.test(s) || !/href="\/workflow\?pb=1"/.test(s); });
ok(bad.length === 0, 'no page still links the retired module, and every page carries the new Playbook icon' + (bad.length ? ' — ' + bad.join(', ') : ''));
const act = navPages.filter((f) => { const s = rd('docs/' + f); const n = s.match(/<nav class="tb-nav tb-modules"[^>]*>([\s\S]*?)<\/nav>/)[1];
  return n.indexOf('href="/workflow?pb=1"') < n.indexOf('href="/activity"'); });
ok(act.length === 0, 'the Playbook icon sits NEXT TO the Activity/Build Log icon, as asked');

const HW = rd('docs/hours_widget.html');
ok(/function dockShow\(/.test(HW) && /fcc-hrs-dock/.test(HW), 'the hours widget can render into a page’s own panel');
ok(/function hoverOpen\(b\) \{ if \(dockEl\(\)\) return;/.test(HW),
  'once docked, HOVER opens nothing — the read-out never covers the board again');
ok(/\.fh-body \.fh-pill/.test(HW), 'the popover’s styling is shared with the docked home, not duplicated');

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (fail ? fail + ' failed, ' : '') + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
