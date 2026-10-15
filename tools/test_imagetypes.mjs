#!/usr/bin/env node
/* tools/test_imagetypes.mjs — the image TYPE engine (docs/imagetype_engine.js)
 *
 * Every fixture is shaped on a reading taken off the live estate on 15 Oct 2026 (five GB
 * Google feeds, 380 of their own images read through docs/pixel_engine.js) but carries
 * invented values and invented brand names — no client figure belongs in git.
 *
 * The suite pins the three things that make the engine's answer trustworthy:
 *   - a mixed shot code is never counted as named (the pixel audit's whole purpose),
 *   - a lane that was measured and refused cannot creep back (no slot lane, no pixel→type lane),
 *   - a grade carries its own sample size, so three corrections never read as a verdict.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = (await import(join(ROOT, 'docs/imagetype_engine.js'))).default;

let pass = 0; const fails = [];
const ok = (name, cond, extra) => { if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : '')); };
const eq = (name, a, b) => ok(name, a === b, 'got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b));

/* ---- fixtures: pixel readings in the shapes the estate really produces ---------- */
const sweep = (fill = 99, sharp = 1100) => ({ bg: 'light', fill, sharp, w: 1920, h: 2460 });  // the pale studio sweep, most of the estate
const white = (fill = 99, sharp = 1000) => ({ bg: 'white', fill, sharp, w: 658, h: 779 });
const scene = (sharp = 3800) => ({ bg: 'scene', fill: null, sharp, w: 1920, h: 2460 });
const reads = (list) => list.map((r, i) => ({ url: 'https://cdn.example/i' + i + '.jpg', r }));

/* ================================================================ signatures */
eq('a plain sweep at full fill reads one signature', T.sigOf(sweep()), 'light/tight/calm');
eq('a low-fill plate is a different signature', T.sigOf(sweep(68, 820)), 'light/loose/calm');
eq('a very low fill reads sparse', T.sigOf(sweep(22, 500)), 'light/sparse/calm');
eq('a scene has no measurable fill, and says so rather than guessing one', T.sigOf(scene()), 'scene/n-a/dense');
eq('a busy frame is told from a calm one', T.sigOf(sweep(99, 2400)), 'light/tight/busy');
ok('an unreadable image has no signature at all', T.sigOf({ err: 'could not be read' }) === null);
ok('and neither has a missing one', T.sigOf(null) === null);

/* ================================================================ the audit */
{
  const a = T.codeAudit(reads([sweep(), sweep(98), sweep()]));
  eq('three images is a glance, not an audit', a.state, 'thin');
  ok('and it says how few it had', /only 3 images/.test(a.why), a.why);
  eq('nothing read at all is also thin', T.codeAudit([]).state, 'thin');
  ok('which says so in its own words', /none of this code/.test(T.codeAudit([]).why));
}
{
  // Schuh's shape: every image of every code on the same sweep at the same fill
  const a = T.codeAudit(reads([sweep(92, 1078), sweep(91, 1133), sweep(93, 1126), sweep(88, 849), sweep(95, 1095), sweep(93, 1216)]));
  eq('a code whose own images all look alike is consistent', a.state, 'consistent');
  ok('and the reason counts them', /of the 6 images read/.test(a.why), a.why);
  ok('a consistent code names nothing to look at', a.worst === null);
}
{
  // Monsoon's `03` shape: the background itself disagrees
  const a = T.codeAudit(reads([sweep(100, 5231), scene(), sweep(99, 1200), scene(2400), { bg: 'colour', fill: 100, sharp: 3000 }, sweep()]));
  eq('a code shot three different ways is mixed', a.state, 'mixed');
  ok('and the reason names the backgrounds that disagree', /background disagrees/.test(a.why), a.why);
  ok('it hands back an image that does not fit, to look at', typeof a.worst === 'string' && a.worst.length > 0);
  ok('the split is ordered commonest first', a.split.length > 1 && a.split[0].n >= a.split[1].n);
  eq('and the shares are of the sample, not of the feed', a.split.reduce((s, x) => s + x.n, 0), 6);
}
{
  // one background, but the frames themselves are nothing like each other
  const a = T.codeAudit(reads([sweep(99, 900), sweep(30, 900), sweep(99, 4000), sweep(45, 3800), sweep(99, 950)]));
  eq('a code can be mixed on one background', a.state, 'mixed');
  ok('and then the reason is the spread, not the backdrop', /different ways/.test(a.why), a.why);
}

/* ================================================================ the ladder */
const TAGS = {
  tok: {
    zm: { tag: 'packshot', by: 'ai', conf: 0.82, note: 'shoe alone on a pale sweep' },
    m4_zm: { tag: 'detail', by: 'manual' },
    '03': { tag: 'lifestyle', by: 'ai', conf: 0.7 },
  },
  img: { 'SKU-1#0': { tag: 'model-full', by: 'manual' } },
};
const AUD = { zm: T.codeAudit(reads([sweep(92), sweep(91), sweep(93), sweep(95)])),
  '03': T.codeAudit(reads([sweep(100, 5231), scene(), sweep(), scene(2400), { bg: 'colour', fill: 100, sharp: 3000 }])) };
{
  const v = T.resolveType({ tags: TAGS, tok: 'zm', slot: 0, id: 'SKU-1', audit: AUD.zm });
  eq('a person’s call on this image beats everything above it', v.tag, 'model-full');
  eq('and is reported as decided', v.lane, 'decided');
  eq('with no hedging on the confidence', v.conf, 1);
}
{
  const v = T.resolveType({ tags: TAGS, tok: 'm4_zm', slot: 3, id: 'SKU-9' });
  eq('a code named by hand is decided, not merely named', v.lane, 'decided');
  eq('and carries its tag', v.tag, 'detail');
}
{
  const v = T.resolveType({ tags: TAGS, tok: 'zm', slot: 0, id: 'SKU-9', audit: AUD.zm });
  eq('a model-named code is named', v.lane, 'named');
  eq('and keeps the model’s own confidence', v.conf, 0.82);
  ok('the reason says the audit agreed with it', /agree with one another/.test(v.why), v.why);
  ok('and it is not flagged mixed', !v.mixed);
}
{
  const v = T.resolveType({ tags: TAGS, tok: '03', slot: 2, id: 'SKU-9', audit: AUD['03'] });
  eq('a mixed code still reports what it was named', v.tag, 'lifestyle');
  ok('but is flagged as unsafe for all of it', v.mixed === true);
  ok('its confidence is cut, never left at the model’s word', v.conf <= 0.4, String(v.conf));
  ok('and the reason names the disagreement', /disagree/.test(v.why), v.why);
}
{
  const v = T.resolveType({ tags: TAGS, tok: 'm8_zm', slot: 2, id: 'SKU-9' });
  ok('an unnamed code is unnamed, never guessed from its neighbours', v.tag === null);
  eq('and what it needs is naming the code', v.need, 'code');
  ok('the reason names the code', /m8_zm/.test(v.why), v.why);
}
{
  const v = T.resolveType({ tags: TAGS, tok: null, slot: 1, id: 'SKU-9' });
  ok('an image on an unpatterned feed is unnamed', v.tag === null);
  eq('and needs reading on its own', v.need, 'image');
  ok('the reason is the filenames, stated plainly', /no readable shot code/.test(v.why), v.why);
}
ok('an empty context never yields a tag', T.resolveType({}).tag === null);

/* ================================================================ the feed */
// Monsoon's shape: 11 codes over 7 fields, the main field carrying several codes
const CAP = {
  imgs: 1000, learnable: true,
  slots: [300, 260, 200, 140, 70, 25, 5],
  tokens: [
    { tok: 'zm', n: 420, slots: { 0: 250, 1: 170 }, samples: [{ id: 'SKU-1', slot: 0 }, { id: 'SKU-2', slot: 1 }] },
    { tok: 'm4_zm', n: 300, slots: { 2: 180, 3: 120 }, samples: [{ id: 'SKU-3', slot: 2 }] },
    { tok: '03', n: 180, slots: { 0: 50, 2: 20, 4: 70, 5: 25, 6: 5, 1: 10 }, samples: [{ id: 'SKU-4', slot: 4 }] },
    { tok: 'm8_zm', n: 100, slots: { 1: 80, 3: 20 }, samples: [{ id: 'SKU-5', slot: 1 }] },
  ],
};
{
  const rows = T.fieldReport(CAP, TAGS, AUD);
  eq('every field the feed uses gets a row', rows.length, 7);
  eq('the main field is named for what it is in the feed', rows[0].field, 'image_link');
  eq('and the second field by its own spec name', rows[1].field, 'additional_image_link 1');
  eq('the fifth field counts from one, not from zero', rows[4].field, 'additional_image_link 4');
  const main = rows[0];
  eq('the main field holds the images the capture says it does', main.imgs, 300);
  eq('its named count is the codes that reach it, mixed ones left out', main.named, 250);
  ok('the mixed code’s images in that field are counted apart', main.mixed === 50, String(main.mixed));
  ok('named + mixed never exceeds the field', main.named + main.mixed <= main.imgs);
  eq('the share is of that field alone', main.pct, 83.3);
  eq('the field says which type it mostly carries', main.top, 'packshot');
  ok('and which codes feed it, biggest first', main.codes[0].tok === 'zm' && main.codes[0].n === 250);
  const f5 = rows.find((r) => r.slot === 5);
  eq('a field fed only by a mixed code reads zero named', f5.named, 0);
  eq('and says how many are unsafe instead', f5.mixed, 25);
  ok('a field no product uses is never invented', !rows.some((r) => r.imgs === 0));
}
{
  const rep = T.clientReport(CAP, TAGS, AUD);
  ok('a scanned feed reports as scanned', rep.scanned);
  eq('named counts only codes that are safely named', rep.named, 720);
  eq('the mixed code is counted apart, not as named', rep.mixed, 180);
  eq('the share is of every image read', rep.pct, 72);
  eq('a readable convention routes through the codes', rep.route, 'codes');
  ok('and the reason says what naming them buys', /names every image that carries them/.test(rep.why));
  eq('what is left is listed biggest first', rep.unnamed[0].tok, 'm8_zm');
  eq('the lanes are kept apart', rep.byLane.decided, 300);
  eq('with the model’s own lane counted separately', rep.byLane.named, 420);
  eq('the audit is reported too', rep.mixedCodes, 1);
  eq('and how many codes were audited at all', rep.audited, 2);
}
{
  const rep = T.clientReport(null, TAGS, AUD);
  ok('a feed nobody has scanned is never reported as named', !rep.scanned);
  eq('and the route is to scan it', rep.route, 'scan');
}
{
  // Superdry's shape: no readable code anywhere
  const flat = { imgs: 8090, learnable: false, slots: [4045, 4045], tokens: [] };
  const rep = T.clientReport(flat, {}, {});
  eq('an unpatterned feed routes per image', rep.route, 'per-image');
  ok('and says plainly that nothing groups it for free', /nothing groups the images for free/.test(rep.why), rep.why);
  eq('with none of it named', rep.named, 0);
  const plan = T.namingPlan(flat, {}, {});
  ok('the plan states the per-image cost rather than hiding it', plan.steps.some((s) => s.kind === 'image' && s.imgs === 8090));
}
{
  const plan = T.namingPlan(CAP, TAGS, AUD);
  eq('the plan leads with the code that names the most images', plan.steps[0].tok, 'm8_zm');
  eq('and counts what is left to name', plan.left, 280);
  ok('a mixed code earns its own step', plan.steps.some((s) => s.kind === 'mixed' && s.imgs === 180));
  const done = T.namingPlan({ imgs: 10, learnable: true, slots: [10], tokens: [{ tok: 'a', n: 10, slots: { 0: 10 }, samples: [] }] },
    { tok: { a: { tag: 'packshot', by: 'manual' } } }, {});
  eq('a fully named feed has no steps', done.steps.length, 0);
  ok('and says so rather than printing an empty list', /every image on this feed is named/.test(done.why));
}

/* ================================================================ the per-image lane
 * The only lane an unpatterned feed has. It must count, and it must never be added on
 * top of a code that already counted the same image. */
{
  const flat = { imgs: 8090, learnable: false, slots: [4045, 4045], tokens: [] };
  const img = {};
  for (let i = 0; i < 500; i++) img['S' + i + '#' + (i % 2)] = { tag: i % 3 ? 'packshot' : 'model-full', by: 'ai' };
  const rep = T.clientReport(flat, { tok: {}, img: img }, {});
  eq('images read one at a time are named on a feed with no codes', rep.named, 500);
  eq('and are reported on the lane a person owns', rep.byLane.decided, 500);
  eq('the types they carry are counted', rep.byTag.packshot, 333);
  const rows = T.fieldReport(flat, { tok: {}, img: img }, {});
  eq('the main field counts its own share of them', rows[0].hand, 250);
  eq('and its named share is of that field alone', rows[0].pct, 6.2);
  const plan = T.namingPlan(flat, { tok: {}, img: img }, {});
  ok('the plan asks only for what is left', plan.steps.some((x) => x.kind === 'image' && x.imgs === 7590), JSON.stringify(plan.steps));
}
{
  // a correction of an image its named code already counted must not be counted twice
  const base = T.clientReport(CAP, { tok: TAGS.tok, img: {} }, AUD);
  const withOv = T.clientReport(CAP, TAGS, AUD);
  eq('correcting an image a named code already counted never inflates the total', withOv.named, base.named);
  ok('never more named images than the feed holds', withOv.named + withOv.mixed <= withOv.imgs);
}
{
  // an image inside a MIXED code is not counted by that code, so naming it by hand does count
  const ov = { tok: TAGS.tok, img: { 'SKU-4#4': { tag: 'lifestyle', by: 'manual' } } };
  const rep = T.clientReport(CAP, ov, AUD);
  eq('naming an image inside a mixed code adds one', rep.named, T.clientReport(CAP, { tok: TAGS.tok, img: {} }, AUD).named + 1);
}
{
  const hand = T.handCounts(CAP, TAGS, AUD);
  ok('an override on a safely named code is skipped outright', !hand[0]);
}

/* ================================================================ the grade */
{
  const g = T.gradeLanes(CAP, TAGS);
  eq('only a correction over a model-named code can be graded', g.n, 1);
  ok('one correction is reported as a floor, never a verdict', /a floor, not a verdict/.test(g.why), g.why);
  eq('and the disagreement is kept', g.agree, 0);
  ok('with the case named so it can be looked at', g.cases.length === 1 && g.cases[0].model === 'packshot' && g.cases[0].person === 'model-full');
}
{
  const g = T.gradeLanes(CAP, { tok: TAGS.tok, img: {} });
  ok('with nothing corrected there is nothing to grade', g.n === 0 && g.pct === null);
  ok('and the engine says exactly that', /nothing to grade it against/.test(g.why), g.why);
}
{
  // a correction over a code a PERSON named is not evidence about the model
  const g = T.gradeLanes(CAP, { tok: { m4_zm: { tag: 'detail', by: 'manual' } }, img: { 'SKU-3#2': { tag: 'side', by: 'manual' } } });
  eq('a hand-named code is never graded against its own author', g.n, 0);
}

/* ================================================================ the estate */
{
  const roll = T.estateRoll([
    { client: 'Northwind', mkt: 'gb', kind: 'xml', cap: CAP, tags: TAGS, audits: AUD },
    { client: 'Atelier', mkt: 'gb', kind: 'xml', cap: { imgs: 8090, learnable: false, slots: [4045, 4045], tokens: [] }, tags: {}, audits: {} },
    { client: 'Harbour', mkt: 'de', kind: 'xml', cap: null, tags: {}, audits: {} },
  ]);
  eq('every feed is listed', roll.feeds.length, 3);
  eq('biggest estate first', roll.feeds[0].client, 'Atelier');
  eq('the estate total is the images, not the feeds', roll.imgs, 9090);
  eq('and the named share is over all of them', roll.pct, 7.9);
  eq('the feeds with no free grouping are counted', roll.noRoute, 1);
  eq('and so are the ones nobody has scanned', roll.unscanned, 1);
  ok('an unscanned feed never contributes a named image', roll.feeds.find((f) => f.client === 'Harbour').named === 0);
}

/* ================================================================ the refusals
 * Two lanes were measured on the real estate and refused (the file's header records the
 * figures). A later session reaching for the obvious shortcut should fail here, not ship it. */
{
  const src = readFileSync(join(ROOT, 'docs/imagetype_engine.js'), 'utf8');
  ok('no lane rests on the image field', !T.LANES.some((l) => /slot|field/i.test(l.id)));
  ok('no lane rests on the pixels alone', !T.LANES.some((l) => /pixel/i.test(l.id)));
  eq('the ladder is exactly the three rungs that can be defended', T.LANES.map((l) => l.id).join(','), 'decided,named,shot');
  ok('every lane says what it rests on', T.LANES.every((l) => l.rests && l.rests.length > 20));
  ok('the file records that the field was measured, not assumed', /THE IMAGE FIELD IS NOT THE GROUPING/.test(src));
  ok('and that pixels were measured, not assumed', /PIXELS DO NOT NAME A SHOT TYPE/.test(src));
  ok('the pixel signature is never returned as a type', !/tag:\s*sig/.test(src));
  ok('no client figure is committed with the engine', !/superdry|reiss|schuh|monsoon|accessorize/i.test(src.replace(/\*[\s\S]*?\*\//, '')));
}

if (fails.length) {
  console.log('✗ ' + fails.length + ' of ' + (pass + fails.length) + ' FAILED:');
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('✓ image type engine: ' + pass + ' checks pass');
