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

let pass = 0; const fails = []; let phMapReal = null;
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

/* ================================================================ the photograph lane
 * (Ray, 11 Nov 2026: "use maybe the easiest model to identify each different type of image
 * tag … product filter can be grouped based on image URL / itemgroup id / item id")
 *
 * The fixture is the SHAPE the estate's unpatterned feeds really have — five size variants
 * of two styles, every variant repeating its style's two photographs, one of them served
 * twice under a different render query — with invented brands and invented filenames. It
 * pins the three things that could go quietly wrong: the unit (a photograph, not a slot),
 * the grouping (a view, never the unit), and the batch mapping (a verdict can never land on
 * the picture beside the one it was about).
 */
{
  const u = (n, q) => 'https://cdn.example/upload' + n + '.jpg' + (q || '');
  // style A: 3 variants, each carrying the same 2 photographs (the second under a query)
  // style B: 2 variants, each carrying the same 2 photographs
  const rows = [
    { id: 'A-S', ti: 'Everest Jacket S', grp: 'A', urls: [u(1), u(2, '?width=658')], slots: [0, 1] },
    { id: 'A-M', ti: 'Everest Jacket M', grp: 'A', urls: [u(1), u(2, '?width=900')], slots: [0, 1] },
    { id: 'A-L', ti: 'Everest Jacket L', grp: 'A', urls: [u(1), u(2)], slots: [0, 1] },
    { id: 'B-S', ti: 'Harbour Coat S', grp: 'B', urls: [u(3), u(4)], slots: [0, 1] },
    { id: 'B-M', ti: 'Harbour Coat M', grp: 'B', urls: [u(3), u(4)], slots: [0, 1] },
  ];

  /* ---- the key: a render query is not a different photograph ---- */
  eq('the query comes off the key', T.photoKey(u(2, '?width=658')), 'cdn.example/upload2.jpg');
  eq('so two render sizes of one picture are one photograph', T.photoKey(u(2, '?width=658')), T.photoKey(u(2, '?width=900')));
  eq('a fragment comes off too', T.photoKey(u(2, '#x')), 'cdn.example/upload2.jpg');
  eq('the protocol comes off, so http and https are one photograph',
    T.photoKey('http://cdn.example/upload2.jpg'), T.photoKey('https://cdn.example/upload2.jpg'));
  eq('an HTML-escaped ampersand is read as the separator it is',
    T.photoKey('https://cdn.example/u.jpg?a=1&amp;b=2'), 'cdn.example/u.jpg');
  eq('nothing in, nothing out', T.photoKey(null), '');

  /* ---- the unit: photographs, not slots ---- */
  const idx = T.photoIndex(rows);
  eq('ten image slots', idx.slots, 10);
  eq('but only four distinct photographs', idx.photos, 4);
  eq('style A’s packshot fills three slots', idx.map['cdn.example/upload1.jpg'].n, 3);
  eq('and so does its second shot, across three render sizes', idx.map['cdn.example/upload2.jpg'].n, 3);
  eq('the index keeps which products carry it', idx.map['cdn.example/upload1.jpg'].ids.join(','), 'A-S,A-M,A-L');
  ok('and which slots it sits in', idx.map['cdn.example/upload2.jpg'].slots['1'] === 1);
  ok('a photograph keeps one real URL to fetch', /^https:/.test(idx.map['cdn.example/upload2.jpg'].url));
  eq('an empty read is an empty index, not a crash', T.photoIndex([]).photos, 0);
  eq('and so is no read at all', T.photoIndex(null).photos, 0);

  /* ---- the ladder, for one photograph ---- */
  const photos = { 'cdn.example/upload1.jpg': { tag: 'packshot', by: 'ai', t: 1, conf: 0.9 },
                   'cdn.example/upload3.jpg': { tag: 'model-full', by: 'manual', t: 2 } };
  eq('a model read of the photograph is the shot lane', T.photoTag('cdn.example/upload1.jpg', { photos }).lane, 'shot');
  eq('a hand tag on the photograph is decided', T.photoTag('cdn.example/upload3.jpg', { photos }).lane, 'decided');
  eq('and it is certain, as a decision is', T.photoTag('cdn.example/upload3.jpg', { photos }).conf, 1);
  eq('a photograph nobody has named says which read would settle it',
    T.photoTag('cdn.example/upload4.jpg', { photos }).need, 'image');
  eq('and names no type', T.photoTag('cdn.example/upload4.jpg', { photos }).tag, null);
  // the code lane still answers underneath: a photograph with no tag of its own inherits
  // its shot code's verdict exactly as the field report already reads it
  const viaCode = T.photoTag('cdn.example/upload4.jpg',
    { photos, tok: 'zm', tags: { tok: { zm: { tag: 'detail', by: 'ai', t: 1 } } }, audits: { zm: { state: 'consistent' } } });
  eq('a photograph with no tag of its own falls back to its shot code', viaCode.tag, 'detail');
  eq('and the verdict says so', viaCode.lane, 'named');
  // and the photograph's own tag BEATS the code's, because it is about this picture
  const beats = T.photoTag('cdn.example/upload1.jpg',
    { photos, tok: 'zm', tags: { tok: { zm: { tag: 'detail', by: 'ai', t: 1 } } }, audits: { zm: { state: 'consistent' } } });
  eq('the photograph’s own reading wins over its code’s', beats.tag, 'packshot');

  /* ---- the report counts decisions, and the slots they cover ---- */
  const rep = T.photoReport(rows, { photos });
  eq('two of the four photographs are named', rep.named, 2);
  eq('which is half the library', rep.pct, 50);
  eq('but covers five of the ten slots', rep.slotsNamed, 5);
  eq('two decisions are still to make', rep.left, 2);
  eq('and the report says what kind of read would make them', rep.need.image, 2);
  eq('slots per photograph is stated, since both numbers are true of this feed', rep.perPhoto, 2.5);

  /* ---- grouping is a view, never the unit ---- */
  eq('the engine offers exactly the ways Ray named, and no more',
    T.PHOTO_GROUPINGS.map((g) => g.id).join(','), 'item,group,photo,code');
  const byPhoto = T.groupRows(rows, 'photo');
  eq('by image URL: one row per photograph, each decision shown exactly once', byPhoto.length, 4);
  ok('every row carries one picture', byPhoto.every((g) => g.photos.length === 1));
  ok('and says what that one decision covers', /3 image slots/.test(byPhoto[0].sub), byPhoto[0].sub);
  const byItem = T.groupRows(rows, 'item');
  eq('by item id: one row per product', byItem.length, 5);
  eq('each carrying its own two images', byItem[0].photos.length, 2);
  const byGrp = T.groupRows(rows, 'group');
  eq('by item group: one row per style', byGrp.length, 2);
  eq('style A lists its two photographs once, not six times', byGrp[0].photos.length, 2);
  ok('and says how many variants it stands for', /3 variants/.test(byGrp[0].sub));
  const byCode = T.groupRows(rows, 'code', { 'cdn.example/upload1.jpg': 'zm', 'cdn.example/upload3.jpg': 'zm' });
  const zm = byCode.find((g) => g.key === 'zm');
  eq('by shot code: the two photographs carrying that code', zm.photos.length, 2);
  ok('and the rest are named as having none, never dropped', byCode.some((g) => g.key === '(no shot code)'));
  eq('every grouping is over the same photographs', [
    new Set(byItem.flatMap((g) => g.photos.map((p) => p.key))).size,
    new Set(byGrp.flatMap((g) => g.photos.map((p) => p.key))).size,
    new Set(byPhoto.flatMap((g) => g.photos.map((p) => p.key))).size,
    new Set(byCode.flatMap((g) => g.photos.map((p) => p.key))).size,
  ].join(','), '4,4,4,4');
  ok('a style with no item group is named, not filed under a blank',
    T.groupRows([{ id: 'X', urls: [u(9)], slots: [0] }], 'group')[0].key === '(no item group)');

  /* ---- what a run costs: stated before it spends, and in the cheap model ---- */
  const e = T.runEstimate(1000, { batch: 10 });
  eq('a thousand photographs in batches of ten is a hundred calls', e.calls, 100);
  eq('on the cheapest model that can see', e.model, 'claude-haiku-5-5');
  ok('which is pennies, not tens of dollars', e.usd < 0.2, 'got $' + e.usd);
  ok('while the heavy model is two orders dearer',
    T.runEstimate(1000, { batch: 1, model: 'claude-opus-5' }).usd > e.usd * 50);
  ok('batching is what makes the clock bearable',
    T.runEstimate(1000, { batch: 1 }).minutes > e.minutes * 8);
  eq('the clock comes from the worker’s own throttle, not a guess', T.CALL_LIMIT, 120);
  eq('over its own window', T.CALL_WINDOW_MIN, 10);
  ok('the real spend is read off an answer’s own token counts, never the estimate',
    Math.abs(T.runCost({ input_tokens: 1e6, output_tokens: 1e6 }, 'claude-haiku-5-5') - 0.6) < 1e-9);
  eq('an answer with no usage costs nothing it cannot prove', T.runCost(null, 'claude-haiku-5-5'), 0);
}

/* ======================================= the batch mapping, LIFTED FROM THE PAGE
 * The one thing about a batched read that can go wrong without anyone seeing it: ten
 * pictures ride one call, and a verdict that lands one tile across is a confidently wrong
 * label. phMap lives in docs/FeedSpark_Images.html between PHMAP markers and is lifted by
 * name here, so the page's own code is what is tested rather than a copy of it. */
{
  const page = readFileSync(join(ROOT, 'docs/FeedSpark_Images.html'), 'utf8');
  const m = /\/\* PHMAP:START[\s\S]*?\n(  function phMap\([\s\S]*?\n  \})\n/.exec(page);
  ok('phMap is liftable from the page', !!m);
  const phMap = m ? new Function(m[1] + '; return phMap;')() : null;
  phMapReal = phMap;

  const tax = [{ id: 'packshot' }, { id: 'model-full' }, { id: 'detail' }];
  const batch = [1, 2, 3, 4].map((n) => ({ key: 'k' + n, url: 'https://cdn.example/' + n + '.jpg' }));
  const say = (o) => JSON.stringify(o);

  if (phMap) {
    /* ---- the straightforward answer ---- */
    const a = phMap(batch, say({ tags: [{ i: 1, tag: 'packshot', conf: 0.9 }, { i: 2, tag: 'model-full', conf: 0.8 },
      { i: 3, tag: 'detail' }, { i: 4, tag: 'packshot' }] }), tax);
    eq('four verdicts name four pictures', a.named, 4);
    eq('and none is left over', a.missed, 0);
    eq('verdict 2 lands on picture 2', a.patch.k2.tag, 'model-full');
    eq('and carries the model as its lane', a.patch.k2.by, 'ai');
    eq('with the confidence it gave', a.patch.k1.conf, 0.9);

    /* ---- THE RULE: an unnamed picture never inherits its neighbour's tag ---- */
    const b = phMap(batch, say({ tags: [{ i: 1, tag: 'packshot' }, { i: 4, tag: 'detail' }] }), tax);
    eq('two verdicts name two pictures', b.named, 2);
    eq('and the two the model skipped are reported as skipped', b.missed, 2);
    eq('picture 1 is named', b.patch.k1.tag, 'packshot');
    ok('picture 2 is NOT named', b.patch.k2 === undefined);
    ok('picture 3 is NOT named', b.patch.k3 === undefined);
    eq('picture 4 is named, from its own number and not its position in the answer', b.patch.k4.tag, 'detail');

    /* ---- a verdict out of range, a repeat, and a word off the list ---- */
    const c = phMap(batch, say({ tags: [{ i: 9, tag: 'detail' }, { i: 0, tag: 'detail' }, { i: 2, tag: 'packshot' }] }), tax);
    eq('a verdict about a picture not in the batch is dropped', c.named, 1);
    ok('and lands on nothing', c.patch.k9 === undefined && c.patch.k1 === undefined);
    eq('the one real verdict still lands', c.patch.k2.tag, 'packshot');
    const d = phMap(batch, say({ tags: [{ i: 1, tag: 'packshot' }, { i: 1, tag: 'detail' }] }), tax);
    eq('a repeated number keeps the first answer', d.patch.k1.tag, 'packshot');
    eq('and counts once', d.named, 1);
    const e2 = phMap(batch, say({ tags: [{ i: 1, tag: 'On Model - Half' }, { i: 2, tag: 'product-model-fullbody' }] }), tax);
    eq('a word that is not in the vocabulary is refused, not stored', e2.named, 0);
    ok('so the library cannot drift to four spellings of two shot types', Object.keys(e2.patch).length === 0);

    /* ---- answers that are not answers ---- */
    eq('no text names nothing', phMap(batch, '', tax).named, 0);
    eq('prose names nothing', phMap(batch, 'I think these are all packshots.', tax).named, 0);
    eq('broken JSON names nothing', phMap(batch, '{"tags":[{"i":1,', tax).named, 0);
    eq('and every picture is reported as still to name', phMap(batch, 'nonsense', tax).missed, 4);
    eq('an answer wrapped in prose is still read', phMap(batch,
      'Here you go:\n{"tags":[{"i":3,"tag":"detail"}]}\nHope that helps.', tax).patch.k3.tag, 'detail');
    eq('an empty vocabulary refuses everything', phMap(batch, say({ tags: [{ i: 1, tag: 'packshot' }] }), []).named, 0);
  }

  /* ---- and the page spends on the cheap model, with the vocabulary enforced both ways ---- */
  ok('the page names photographs with the cheapest model that can see', /AI_MODEL='claude-haiku-5-5'/.test(page));
  ok('the model is told it may answer only with an id from the list', /Never invent an id that is not in the list/.test(page));
  ok('and told to leave a picture out rather than guess', /leave that photograph out of the array rather than guessing/.test(page));
  ok('every picture is numbered in the request', /Photograph '\+\(i\+1\)/.test(page));
  ok('a run says what it would cost before it spends anything', /confirm\('Name '\+fmt\(todo\.length\)/.test(page));
  ok('and the real spend is read off the answer’s own usage', /PHSPEND\.usd\+=E\.runCost\(d\.usage/.test(page));
  ok('the tag is keyed on the photograph, never on a product-slot', /data-phsel=/.test(page) && !/data-phsel="'\+esc\(r\.id\)/.test(page));
  ok('the grouping picker is the engine’s own list', /E&&E\.PHOTO_GROUPINGS/.test(page));
  ok('the photograph store is its own key, so the cheap tag read stays cheap', /\/api\/images\/photos/.test(page));
  ok('tags are saved as deltas, not as the whole map', /photos:\{p:patch\|\|\{\}\}/.test(page));
  ok('a hand tag is marked as one', /by:'manual'/.test(page));
  ok('the card folds like every other section', /pertag:0/.test(page));
  /* ONE reader and ONE resolver, so the head, the fold line, the tile and the filter can
   * never disagree about whether a picture is named — which is exactly what a second count
   * on the page would produce the first time a photograph was named through its shot code */
  ok('the head\u2019s counts come from the engine\u2019s own reader', /E\.photoReport\(rows,/.test(page));
  ok('and the page keeps no second count of its own', !/named\+\+; slots\+=PHIDX/.test(page));
  ok('the tile, the filter and the run all read one resolver', (page.match(/phRes\(/g) || []).length >= 4);
  ok('which is the engine\u2019s ladder, not a local rule', /E\.photoTag\(k,\{photos:/.test(page));
  ok('so a photograph already named through its code is never paid for twice',
    /var todo=PHIDX\.keys\.filter\(function\(k\)\{ var v=phRes\(k\); return !\(v&&v\.tag\); \}\)/.test(page));
  ok('and the tile names which lane named it', /v\.lane==='decided'\?'\u270e'/.test(page));
  ok('and its head states the unit, since slots and photographs are both true of a feed',
    /distinct photograph/.test(page) && /image slot/.test(page));

  /* ---- the worker keeps it in its own key, checks it whole, and never trims silently ---- */
  const w = readFileSync(join(ROOT, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');
  ok('the route exists on both methods', /path === '\/api\/images\/photos' && \(request\.method === 'GET' \|\| request\.method === 'PUT'\)/.test(w));
  ok('in its own KV key', /'imgphotos:' \+ client/.test(w));
  ok('apart from the shot-code tags every page load reads', /'imgtags:' \+ client/.test(w));
  ok('merged per key, so two AMs never clobber each other', /Object\.assign\(\{\}, cur\.p \|\| \{\}/.test(w));
  ok('a pushed store is checked whole', /function sanitizeImagePhotos/.test(w));
  ok('the cap keeps the NEWEST decisions and says how many it dropped', /dropped\+\+/.test(w) && /dropped: dropped \|\| undefined/.test(w));
  ok('and the action is logged like every other mutation', /'\/api\/images\/photos': 'image-photo-tags'/.test(w));
}

/* ================= NEGATIVE CONTROL: the batch bug, planted on purpose
 * The mapping assertions above only mean something if they FAIL on the obvious wrong
 * implementation — reading the answer by its POSITION in the array rather than by the
 * number each picture was given, which is what makes a model that skips one picture label
 * every picture after it with its neighbour's tag. */
{
  const page = readFileSync(join(ROOT, 'docs/FeedSpark_Images.html'), 'utf8');
  const m = /\/\* PHMAP:START[\s\S]*?\n(  function phMap\([\s\S]*?\n  \})\n/.exec(page);
  const bent = m && m[1]
    .replace('var i=Math.round(+(x&&x.i));', 'var i=ai+1;')                       // position, not the number
    .replace('arr.forEach(function(x){', 'arr.forEach(function(x,ai){');
  const bad = bent ? new Function(bent + '; return phMap;')() : null;
  const tax = [{ id: 'packshot' }, { id: 'model-full' }, { id: 'detail' }];
  const batch = [1, 2, 3, 4].map((n) => ({ key: 'k' + n, url: 'https://cdn.example/' + n + '.jpg' }));
  const skipped = JSON.stringify({ tags: [{ i: 1, tag: 'packshot' }, { i: 4, tag: 'detail' }] });
  ok('the planted bug is really planted', !!bad && bent !== m[1]);
  if (bad) {
    const r = bad(batch, skipped, tax);
    ok('and it DOES mislabel: picture 2 takes picture 4’s tag', r.patch.k2 && r.patch.k2.tag === 'detail');
    ok('while picture 4, the one the model actually named, is left unnamed', r.patch.k4 === undefined);
    ok('so the page’s own mapping is the thing being relied on, not this one',
      phMapReal && phMapReal(batch, skipped, tax).patch.k2 === undefined);
  }
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
