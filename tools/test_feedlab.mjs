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

console.log(`\nFeed Lab AI-readiness model: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
