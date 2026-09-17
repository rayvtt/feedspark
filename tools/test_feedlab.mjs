/*
 * Feed Lab AI-READINESS MODEL harness (Ray, 16 Sep 2026: "label architecture that involves
 * custom labels is not necessarily usable for AI, so I don't know what's in there … include
 * the most important factor for AI readiness, probably the conversational attribute that
 * Google mentioned — when you fix this, obviously fix Feed Lab as well").
 *
 * The scoring model had never been pinned by a test, and this change rewrote it, so the
 * assertions below are the model's contract:
 *   1. custom labels are MEASURED but carry NO weight — Google's own spec for
 *      [custom_label_0-4] (answer 6324473) says the values "won't be shown to customers"
 *      and exist for "reporting and bidding" in Performance Max / Shopping / Demand Gen;
 *   2. conversational attributes (answer 17085370) are the HEAVIEST pillar, scored on
 *      COVERAGE, with the two variant-only fields excluded from a feed without variants;
 *   3. the weight is set so everything else tops out below Tier 4 — a feed with none of
 *      the attributes Google built for agentic surfaces cannot read as "Agentic-ready";
 *   4. no pillar double-counts the conversational six.
 * Both /feedlab and /golden read this one engine, so this covers both surfaces.
 * Run: node tools/test_feedlab.mjs   (pure node — part of qa_gate / presync / validate)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const FA = require('../docs/feedlab_engine.js');
let pass = 0, fail = 0;
const ok = (c, l, info) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ FAIL: ' + l + (info !== undefined ? '  → ' + String(info).slice(0, 300) : '')); } };
const eq = (l, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), l, JSON.stringify(a) + ' vs ' + JSON.stringify(b));

const HEAD = ['id', 'title', 'description', 'link', 'image_link', 'additional_image_link', 'availability', 'price',
  'brand', 'gtin', 'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'material', 'pattern',
  'google_product_category',
  // numbered slots are how a real FeedSpark feed ships these — slots('name(n)') in the engine
  'product_type', 'product_type(1)', 'product_type(2)', 'product_type(3)',
  'product_highlight(1)', 'product_highlight(2)', 'product_highlight(3)', 'product_highlight(4)',
  'additional_image_link(1)', 'additional_image_link(2)', 'additional_image_link(3)',
  'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4',
  'question_and_answer', 'document_link', 'related_product', 'item_group_title', 'variant_option', 'popularity_rank'];
const col = {}; HEAD.forEach((h, i) => { col[h] = i; });

// a solid feed: everything a merchant normally ships, nothing conversational
const DESC = 'A longline coat cut from an Italian wool blend with a notch lapel and welt pockets. It falls below the knee, is half lined and true to size, and is finished with horn-effect buttons for a tailored winter silhouette that layers easily over knitwear through the season and beyond.';
function product(i, over) {
  const r = new Array(HEAD.length).fill('');
  r[col.id] = 'SKU' + i;
  r[col.title] = 'Reiss Margot Wool Blend Longline Coat in Camel, Regular Fit, UK Size ' + (6 + (i % 12));
  r[col.description] = DESC + ' Reference ' + i + '.';
  r[col.link] = 'https://example.com/p/' + i;
  r[col.image_link] = 'https://cdn.example.com/' + i + '.jpg';
  r[col['additional_image_link(1)']] = 'https://cdn.example.com/' + i + '-b.jpg';
  r[col['additional_image_link(2)']] = 'https://cdn.example.com/' + i + '-c.jpg';
  r[col['additional_image_link(3)']] = 'https://cdn.example.com/' + i + '-d.jpg';
  r[col.availability] = 'in stock'; r[col.price] = '298.00 GBP';
  r[col.brand] = 'Reiss'; r[col.gtin] = '501234567890' + (i % 10); r[col.condition] = 'new';
  r[col.item_group_id] = 'G' + Math.floor(i / 4);
  r[col.color] = 'Camel'; r[col.size] = 'M'; r[col.gender] = 'female'; r[col.age_group] = 'adult';
  r[col.material] = 'wool'; r[col.pattern] = 'Plain';
  r[col.google_product_category] = 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets';
  r[col.product_type] = 'Women > Coats & Jackets > Wool Coats';
  r[col['product_type(1)']] = 'Women > Coats & Jackets > Wool Coats';
  r[col['product_type(2)']] = 'Women > Outerwear > Longline > Camel';
  r[col['product_type(3)']] = 'wool coat > winter coat > tailored coat';
  r[col['product_highlight(1)']] = 'Italian wool blend';
  r[col['product_highlight(2)']] = 'Half lined to the knee';
  r[col['product_highlight(3)']] = 'Notch lapel with welt pockets';
  r[col['product_highlight(4)']] = 'Horn-effect buttons';
  for (let c = 0; c < 5; c++) r[col['custom_label_' + c]] = 'band-' + (i % 4);
  if (over) Object.keys(over).forEach((k) => { r[col[k]] = over[k]; });
  return r;
}
const run = (rows, opts) => FA.audit(HEAD, rows, Object.assign({ client: 'Reiss', channel: 'google' }, opts || {}));
const pillarsOf = (a) => { const m = {}; a.score.pillars.forEach((p) => { m[p.key] = p; }); return m; };

const N = 200;
const bare = []; for (let i = 0; i < N; i++) bare.push(product(i));
const A = run(bare);
const P = pillarsOf(A);

console.log('— custom labels: measured, never scored —');
ok(!P.labels, 'there is no "labels" pillar in the score at all', Object.keys(P));
ok(A.labelArchitecture && A.labelArchitecture.scored === false, 'the label reading is still returned, flagged not scored', A.labelArchitecture);
ok(A.labelArchitecture.score > 0, 'and it is a real number, not a stub — "I do not know what is in there" is answered', A.labelArchitecture);
ok(/won|never shown|bidding|reporting|campaign/i.test(A.labelArchitecture.why), 'it carries the reason, in Google’s own terms', A.labelArchitecture.why);
ok(Array.isArray(A.labels) && A.labels.length === 5, 'the per-label detail still rides along for Label Guard', A.labels && A.labels.length);
{
  // the decisive test: wipe every custom label and the AI score must not move
  const noLabels = bare.map((r) => { const c = r.slice(); for (let i = 0; i < 5; i++) c[col['custom_label_' + i]] = ''; return c; });
  const B = run(noLabels);
  eq('emptying all five custom labels changes the AI-readiness score by nothing',
    Math.round(A.score.total), Math.round(B.score.total));
  ok(B.labelArchitecture.score === 0 && Math.round(B.score.total) === Math.round(A.score.total),
    'label architecture drops to 0 while the headline holds', [B.labelArchitecture.score, Math.round(B.score.total)]);
}

console.log('\n— conversational attributes: the heaviest pillar —');
ok(P.conversational, 'the pillar exists', Object.keys(P));
eq('it is the heaviest weight in the model', P.conversational.weight,
  Math.max.apply(null, A.score.pillars.map((p) => p.weight)));
ok(P.conversational.weight >= 2, 'and it is decisively the heaviest (×2 or more)', P.conversational.weight);
eq('a feed with none of them scores zero on it', P.conversational.score, 0);
ok(/none of the 6/.test(P.conversational.summary), 'the card says so in words', P.conversational.summary);
ok(A.conversational.present === 0 && A.conversational.of === 6, 'the audit reports the count honestly', A.conversational);
ok(A.score.total < 80 && A.score.tier < 4,
  'THE CEILING: an otherwise strong feed with no conversational attributes cannot be Agentic-ready', A.score.total);
{
  // ceiling proof — even a perfect-everything-else feed stays under Tier 4
  let wTot = 0, wConv = 0;
  A.score.pillars.forEach((p) => { wTot += p.weight; if (p.key === 'conversational') wConv = p.weight; });
  const ceiling = 100 * (wTot - wConv) / wTot;
  ok(ceiling < 80, 'the weight is set so the rest of the model tops out below 80 (' + ceiling.toFixed(1) + ')', ceiling);
}
{
  // coverage, not presence: the same attribute on 4% of the feed is a pilot, not a capability
  const thin = bare.map((r, i) => { const c = r.slice(); if (i < 8) c[col.question_and_answer] = '"Is it warm?":"Yes."'; return c; });
  const half = bare.map((r, i) => { const c = r.slice(); if (i < N / 2) c[col.question_and_answer] = '"Is it warm?":"Yes."'; return c; });
  const all = bare.map((r) => { const c = r.slice(); c[col.question_and_answer] = '"Is it warm?":"Yes."'; return c; });
  const [t, h, f] = [thin, half, all].map((rows) => pillarsOf(run(rows)).conversational.score);
  ok(t < h && h < f, 'the score rises with COVERAGE, not with the attribute merely appearing', [t, h, f]);
  eq('one of six at full coverage is one sixth of the pillar', f, 17);
}
{
  // all six, fully covered
  const full = bare.map((r) => {
    const c = r.slice();
    c[col.question_and_answer] = '"Is it warm?":"Yes, it is lined."';
    c[col.document_link] = 'https://example.com/care.pdf';
    c[col.related_product] = 'often_bought_with:gtin:5012345678901';
    c[col.item_group_title] = 'Margot Wool Blend Longline Coat';
    c[col.variant_option] = 'size:M';
    c[col.popularity_rank] = '91.2';
    return c;
  });
  const F = run(full), FP = pillarsOf(F);
  eq('all six at full coverage = 100 on the pillar', FP.conversational.score, 100);
  ok(F.score.total > A.score.total + 15, 'and it is worth a lot: the same feed jumps',
    [Math.round(A.score.total), Math.round(F.score.total)]);
  ok(F.score.tier === 4, 'that feed reaches Agentic-ready', [F.score.total, F.score.tier]);
  ok(!F.issues.some((x) => x.code === 'conv-missing' || x.code === 'conv-partial'), 'and neither conversational finding fires');
}
{
  // the variant pair cannot apply to a feed without variants, so it is not counted against it
  const noVar = bare.map((r) => { const c = r.slice(); c[col.item_group_id] = ''; return c; });
  const V = run(noVar);
  eq('a feed with no variants is judged on four conversational attributes, not six', V.conversational.of, 4);
  ok(/no variants in this feed/.test(pillarsOf(V).conversational.summary), 'and the card says why', pillarsOf(V).conversational.summary);
  const noVarFour = noVar.map((r) => {
    const c = r.slice();
    c[col.question_and_answer] = '"Is it warm?":"Yes."'; c[col.document_link] = 'https://example.com/c.pdf';
    c[col.related_product] = 'substitute:gtin:5012345678901'; c[col.popularity_rank] = '88.0';
    return c;
  });
  eq('so shipping those four scores the pillar in full', pillarsOf(run(noVarFour)).conversational.score, 100);
}

console.log('\n— no double counting, and the rest of the model —');
{
  const full = bare.map((r) => { const c = r.slice(); c[col.question_and_answer] = '"Is it warm?":"Yes."'; c[col.document_link] = 'https://example.com/c.pdf'; c[col.related_product] = 'substitute:gtin:5012345678901'; c[col.item_group_title] = 'Margot Coat'; c[col.variant_option] = 'size:M'; c[col.popularity_rank] = '91.2'; return c; });
  const FP = pillarsOf(run(full));
  ['identity', 'titles', 'descriptions', 'attributes', 'taxonomy', 'media', 'ai'].forEach((k) => {
    ok(FP[k].score === P[k].score, 'adding the six moves ONLY the conversational pillar — ' + k + ' is unchanged',
      [k, P[k].score, FP[k].score]);
  });
}
eq('eight pillars, so every stored per-pillar map and the estate heatmap still fit', A.score.pillars.length, 8);
ok(A.score.pillars.every((p) => p.summary && p.label && p.key), 'every pillar names itself and explains its number');
ok(P.ai.label === 'Structured detail' && /highlights/.test(P.ai.summary),
  'the old "agentic readiness" pillar is now honestly named for what it reads', P.ai);
{
  const miss = A.issues.filter((x) => x.code === 'conv-missing')[0];
  ok(miss && miss.sev === 'crit', 'a feed with none of them raises a CRITICAL finding, not an aside', miss && miss.sev);
  ok(miss && /AI Mode in Search/.test(miss.detail), 'quoting Google’s own reason for the attributes', miss && miss.detail);
  const rec = A.recs.filter((x) => /conversational/i.test(x.service))[0];
  ok(rec && rec.impact === 3, 'and the top-impact recommendation is to ship them', rec && rec.impact);
  ok(rec && /supplemental data source|Merchant API/.test(rec.detail), 'by the route Google documents', rec && rec.detail);
}
{
  // Meta channel still works and still excludes labels
  const M = run(bare, { channel: 'meta' });
  ok(!pillarsOf(M).labels, 'the Meta reading has no label pillar either');
  ok(pillarsOf(M).conversational, 'and still weighs conversational attributes');
}

console.log('\n— Attribute completeness follows the SAME industry profile as goldenScore —');
console.log('  (Ray, 17 Sep 2026, YuMOVE/Pet Care screenshot: "make sure all scoring … always refer back to the industry best practice")');
{
  // a Pet Care-shaped feed: the apparel-five COLUMNS genuinely don't exist (not merely blank —
  // has() reads column presence, matching a real feed that never ships g:color at all), pattern
  // dropped too — but item_group_id and material (Pet Care's own default profile: expected: [],
  // waived: [size_type, size_system, pattern]) are still shipped
  const dropped = ['color', 'size', 'gender', 'age_group', 'pattern'];
  const keepIdx = []; HEAD.forEach((h, i) => { if (dropped.indexOf(h) < 0) keepIdx.push(i); });
  const petHeader = keepIdx.map((i) => HEAD[i]);
  const project = (rows) => rows.map((r) => keepIdx.map((i) => r[i]));
  const petRows = project(bare);
  const petCare = FA.audit(petHeader, petRows, { client: 'YuMOVE', channel: 'google', expected: [], waived: ['size_type', 'size_system', 'pattern'] });
  const unprofiled = FA.audit(petHeader, petRows, { client: 'YuMOVE', channel: 'google' });
  ok(pillarsOf(unprofiled).attributes.score >= 70,
    'even with no profile passed at all, the cond-tier apparel five are excluded by default (goldenScore\'s own baseline for an unprofiled/Retail client — never expected unless an industry says so)',
    pillarsOf(unprofiled).attributes);
  ok(pillarsOf(unprofiled).attributes.score < pillarsOf(petCare).attributes.score,
    'but pattern (rec-tier) is only excluded once a profile actually waives it — an unprofiled call still dings the un-waived rec gap',
    [pillarsOf(unprofiled).attributes.score, pillarsOf(petCare).attributes.score]);
  ok(pillarsOf(petCare).attributes.score >= 90,
    'with Pet Care\'s own profile, the same feed reads as complete — color/size/gender/age_group are cond-tier and simply not expected, pattern is waived', pillarsOf(petCare).attributes);
  ok(!/color|size(?!_)|gender|age_group|pattern/.test(pillarsOf(petCare).attributes.summary),
    'the pillar summary stops naming gaps the profile does not consider gaps', pillarsOf(petCare).attributes.summary);
  ok(!petCare.issues.some((x) => x.code === 'attr-pattern'), 'the pattern issue is silenced once it is waived', petCare.issues.map((x) => x.code));
  ok(!petCare.recs.some((x) => /pattern/i.test(x.title)), 'and so is the pattern recommendation', petCare.recs.map((x) => x.title));

  // material is deliberately NOT in Pet Care's waived list (Ray's own default profile keeps
  // it as a cross-industry optimisation surface) — a Pet Care feed missing it should still
  // be marked down, proving the fix does not over-exempt
  const noMatIdx = []; petHeader.forEach((h, i) => { if (h !== 'material') noMatIdx.push(i); });
  const petHeaderNoMaterial = noMatIdx.map((i) => petHeader[i]);
  const petRowsNoMaterial = petRows.map((r) => noMatIdx.map((i) => r[i]));
  const petCareNoMaterial = FA.audit(petHeaderNoMaterial, petRowsNoMaterial, { client: 'YuMOVE', channel: 'google', expected: [], waived: ['size_type', 'size_system', 'pattern'] });
  ok(pillarsOf(petCareNoMaterial).attributes.score < pillarsOf(petCare).attributes.score,
    'material is NOT waived for Pet Care — losing it still costs the pillar, even under the profile',
    [pillarsOf(petCareNoMaterial).attributes.score, pillarsOf(petCare).attributes.score]);

  // a profile that EXPECTS one of the apparel five (Fashion's own default) still marks it
  // missing when the feed has none of it — expected attrs count-when-absent, never a free pass
  const fashionProfiled = FA.audit(petHeader, petRows, { client: 'Reiss', channel: 'google', expected: ['color', 'size', 'gender', 'age_group', 'item_group_id'], waived: [] });
  ok(pillarsOf(fashionProfiled).attributes.score < pillarsOf(petCare).attributes.score,
    'an industry that EXPECTS the apparel five still scores their absence as a real gap',
    [pillarsOf(fashionProfiled).attributes.score, pillarsOf(petCare).attributes.score]);
}

console.log('\n— ONE depth, two sections (Ray, 17 Sep 2026: Schuh GB content quality 3.3 levels vs the tile’s "2.2") —');
{
  // the SAME rows through both engines: labelguard's content-quality collector and this audit.
  // XML-shaped header — the first product_type is BARE and the keyword slots are (2), (3):
  // that is exactly how the FeedHero feeds (Schuh, Reiss, Superdry…) arrive, and exactly the
  // shape on which the tile used to count filled slots and call it depth
  const LG = await import('../cloudflare/feedspark-deck/src/labelguard.js');
  const XH = ['id', 'title', 'description', 'link', 'image_link', 'brand', 'price', 'availability', 'google_product_category',
    'product_type', 'product_type(2)', 'product_type(3)', 'product_type(4)', 'product_highlight', 'product_highlight(2)', 'product_highlight(3)', 'product_highlight(4)',
    'additional_image_link', 'additional_image_link(2)', 'item_group_id'];
  const xc = {}; XH.forEach((h, i) => { xc[h] = i; });
  const PATHS = ['Womens > Shoes > Trainers', 'Mens > Boots > Chelsea Boots > Leather', 'Kids > Shoes', 'Womens > Shoes > Trainers > Low Top > Canvas', 'Accessories'];
  const xrows = [];
  for (let i = 0; i < 100; i++) {
    const r = new Array(XH.length).fill('');
    r[xc.id] = 'X' + i; r[xc.title] = 'Schuh Converse Chuck Taylor All Star Ox Canvas Trainers in White, Low Top, UK ' + (3 + (i % 9));
    r[xc.description] = DESC; r[xc.link] = 'https://x.com/' + i; r[xc.image_link] = 'https://x.com/' + i + '.jpg';
    r[xc.brand] = 'Converse'; r[xc.price] = '60.00 GBP'; r[xc.availability] = 'in stock';
    r[xc.google_product_category] = 'Apparel & Accessories > Shoes';
    r[xc.product_type] = PATHS[i % PATHS.length];            // the category tree
    r[xc['product_type(2)']] = 'chuck taylor'; r[xc['product_type(3)']] = 'white trainers';   // keyword injection
    if (i % 2) r[xc['product_type(4)']] = 'canvas shoes';
    r[xc.product_highlight] = 'Canvas upper'; r[xc['product_highlight(2)']] = 'Rubber sole';
    r[xc['product_highlight(3)']] = 'Lace fastening'; r[xc['product_highlight(4)']] = 'Ortholite insole';
    r[xc.additional_image_link] = 'https://x.com/' + i + '-b.jpg'; r[xc['additional_image_link(2)']] = 'https://x.com/' + i + '-c.jpg';
    r[xc.item_group_id] = 'G' + Math.floor(i / 9);
    xrows.push(r);
  }
  const X = FA.audit(XH, xrows, { client: 'Schuh', channel: 'google' });
  const cols = LG.findCols(XH, ['product_type', 'google_product_category', 'title', 'description', 'brand', 'id', 'link', 'item_group_id']).labels;
  const qc = LG.qualityCollector(cols, { header: XH });
  xrows.forEach((r) => qc.onRow(r));
  const snap = qc.finish({ client: 'Schuh', market: 'gb' });
  eq('product_type depth: the AI-readiness tile and the content-quality row read the SAME number off the same rows',
    X.taxonomy.ptDepthAvg, snap.attrs.product_type.avgDepth);
  eq('and so does GPC depth', X.taxonomy.gpcDepthAvg, snap.attrs.google_product_category.avgDepth);
  ok(X.taxonomy.ptDepthAvg > 2.5 && X.taxonomy.ptDepthAvg < 3.5, 'it is the chevron depth of the PRIMARY path (3.2 here), not a count of keyword slots', X.taxonomy.ptDepthAvg);
  ok(X.taxonomy.ptSlotsAvg > 3, 'the keyword-slot count is still reported, named as assignments', X.taxonomy.ptSlotsAvg);
  eq('the primary column resolved is the bare g:product_type, as labelguard resolves it', X.taxonomy.ptPrimary, 'product_type');
  eq('pathDepth is labelguard’s, verbatim (chevron, slash fallback, bare = 1)',
    ['a > b > c', 'a / b', 'a', ' x > > y ', ''].map(FA.pathDepth), ['a > b > c', 'a / b', 'a', ' x > > y ', ''].map(LG.pathDepth));
  eq('the 52 terminal two-level GPC branches are the SAME list in both engines', FA.GPC_LEAF2.slice().sort(), Array.from(LG.GPC_LEAF2).sort());
  ok(!/product_type/.test(pillarsOf(X).ai.summary) && !/levels deep/.test(pillarsOf(X).ai.summary),
    'the Structured detail tile no longer states a product_type depth of its own — Taxonomy depth owns it', pillarsOf(X).ai.summary);
  ok(pillarsOf(X).taxonomy.summary.indexOf('avg ' + snap.attrs.product_type.avgDepth + ' levels') >= 0 &&
    (pillarsOf(X).taxonomy.reads || []).join(' ').indexOf('averaging ' + snap.attrs.product_type.avgDepth + ' levels') >= 0,
    'the Taxonomy tile states the shared number — the one the content-quality row prints', [pillarsOf(X).taxonomy.summary, pillarsOf(X).taxonomy.reads]);

  // slot one is the BARE column: the four highlights Monsoon ships are four, not three
  eq('a bare first column counts as slot one — four highlights read as four', X.highlights.avg, 4);
  eq('and two additional images read as two', X.media.addlAvg, 2);
}

console.log('\n— every tile vetted against the published specs —');
{
  const V = pillarsOf(A);
  ok(FA.BASIS && ['conversational', 'identity', 'titles', 'descriptions', 'attributes', 'taxonomy', 'media', 'ai'].every((k) => FA.BASIS[k] && FA.BASIS[k].f.length && FA.BASIS[k].src.length),
    'every pillar carries a formula and at least one published source in the engine', Object.keys(FA.BASIS || {}));
  ok(Object.keys(FA.BASIS).every((k) => FA.BASIS[k].src.every((s) => /^https:\/\/(support\.google\.com|developers\.openai\.com|claude\.com)\//.test(s[1]))),
    'every source is Google, OpenAI or Anthropic — no unsourced claim', Object.keys(FA.BASIS).map((k) => FA.BASIS[k].src.map((s) => s[1])));
  ok(A.score.pillars.every((p) => Array.isArray(p.reads) && p.reads.length >= 2 && p.reads.every((x) => typeof x === 'string' && x.length <= 140)),
    'every pillar hands the pop-up its live reads — short strings, never HTML', A.score.pillars.map((p) => p.reads));
  // identity: condition is optional for new goods (Google 6324469, OpenAI feed) — measured, not scored
  const noCond = bare.map((r) => { const c = r.slice(); c[col.condition] = ''; return c; });
  eq('emptying condition on every product moves Identity & trust by nothing', pillarsOf(run(noCond)).identity.score, V.identity.score);
  const noLink = bare.map((r) => { const c = r.slice(); c[col.link] = ''; return c; });
  ok(pillarsOf(run(noLink)).identity.score < V.identity.score, 'while emptying link — required by both — costs it', [pillarsOf(run(noLink)).identity.score, V.identity.score]);
  ok(/condition .*measured, not scored/.test(V.identity.reads.join(' | ')), 'and the pop-up says so', V.identity.reads);
  // media: Google accepts http or https — not a score input, not an issue
  const http = bare.map((r) => { const c = r.slice(); c[col.image_link] = c[col.image_link].replace('https://', 'http://'); return c; });
  const H = run(http);
  eq('http image links move Media richness by nothing', pillarsOf(H).media.score, V.media.score);
  ok(!H.issues.some((x) => x.code === 'img-http'), 'and raise no finding', H.issues.map((x) => x.code));
  ok(H.media.httpsPct === 0, 'the reading is still there for anyone who wants it', H.media.httpsPct);
  // taxonomy: a numeric GPC ID and a terminal two-level branch are the MOST specific value Google offers
  const gpcId = bare.map((r) => { const c = r.slice(); c[col.google_product_category] = '5322'; return c; });
  const gpcLeaf = bare.map((r) => { const c = r.slice(); c[col.google_product_category] = 'Apparel & Accessories > Shoes'; return c; });
  const gpcTwo = bare.map((r) => { const c = r.slice(); c[col.google_product_category] = 'Apparel & Accessories > Clothing'; return c; });
  const gpcOne = bare.map((r) => { const c = r.slice(); c[col.google_product_category] = 'Apparel & Accessories'; return c; });
  const tx = (rows) => pillarsOf(run(rows)).taxonomy.score;
  eq('a numeric GPC ID earns full credit (Google resolves it to its exact node)', tx(gpcId), V.taxonomy.score);
  eq('"Apparel & Accessories > Shoes" — a branch Google’s taxonomy ends at — earns full credit, as it passes the content-quality "too broad" rule', tx(gpcLeaf), V.taxonomy.score);
  ok(tx(gpcTwo) < tx(gpcLeaf) && tx(gpcOne) < tx(gpcTwo), 'a two-level path with a deeper option is half, a bare top-level a quarter', [tx(gpcOne), tx(gpcTwo), tx(gpcLeaf)]);
  // structured detail: product_detail — the attribute Google names beside highlights for AI surfaces — now counts
  const withPd = bare.map((r) => r.concat(['Composition:Outer:100% wool'])), HPD = HEAD.concat(['product_detail']);
  const D = FA.audit(HPD, withPd, { client: 'Reiss', channel: 'google' });
  ok(pillarsOf(D).ai.score > V.ai.score, 'adding product_detail lifts Structured detail', [V.ai.score, pillarsOf(D).ai.score]);
  ok(D.attributes.some((x) => x.key === 'product_detail' && x.pct === 100), 'and it appears in attribute coverage', D.attributes.filter((x) => x.key === 'product_detail'));
  ok(pillarsOf(D).taxonomy.score === V.taxonomy.score && pillarsOf(D).descriptions.score === V.descriptions.score, 'moving nothing else');
  // descriptions: Google's own 160–500, not a house 300
  const d150 = bare.map((r) => { const c = r.slice(); c[col.description] = DESC.slice(0, 150); return c; });
  const d300 = bare.map((r) => { const c = r.slice(); c[col.description] = DESC.slice(0, 300); return c; });
  const d500 = bare.map((r) => { const c = r.slice(); c[col.description] = (DESC + ' ' + DESC).slice(0, 520); return c; });
  const ds = (rows) => pillarsOf(run(rows)).descriptions.score;
  ok(ds(d150) < ds(d300) && ds(d300) < ds(d500), 'length credit is nothing under 160, growing to full at 500', [ds(d150), ds(d300), ds(d500)]);
  ok(run(d150).issues.some((x) => x.code === 'desc-thin' && /160/.test(x.title)), 'the thin-description finding names Google’s 160', run(d150).issues.filter((x) => x.code === 'desc-thin').map((x) => x.title));
  // titles: Google's edges — 150 max, first 70 noticed, under 30 cannot carry the essentials
  const t60 = bare.map((r) => { const c = r.slice(); c[col.title] = c[col.title].slice(0, 60); return c; });
  const t100 = bare.map((r) => { const c = r.slice(); c[col.title] = c[col.title].slice(0, 100); return c; });
  const PAD = ' with a great many extra words appended to carry this title well past the one hundred and fifty character limit Google states';
  const t160 = bare.map((r) => { const c = r.slice(); c[col.title] = (c[col.title] + PAD).slice(0, 160); return c; });
  const ts = (rows) => pillarsOf(run(rows)).titles.score;
  ok(ts(t60) < ts(t100) && ts(t160) < ts(t100), 'full credit 70–150, half 30–69, none over 150', [ts(t60), ts(t100), ts(t160)]);
  // the ceiling still holds under the vetted model
  let wTot = 0, wConv = 0;
  A.score.pillars.forEach((p) => { wTot += p.weight; if (p.key === 'conversational') wConv = p.weight; });
  ok(100 * (wTot - wConv) / wTot < 80, 'weights unchanged: everything but the conversational six still tops out under 80', 100 * (wTot - wConv) / wTot);
}

console.log(`\nFeed Lab AI-readiness model: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
