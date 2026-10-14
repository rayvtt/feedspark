/*
 * Test Lab — the Playbook's test proposals, and the competitor read behind them.
 *
 * Ray, 14 Oct 2026: "the playbook and the workflow should be a bit smarter … more proactive
 * information about testing proposals, with specifics. One specific could be: 'How about we test
 * A/B testing image position this month?' because I have seen other brands achieve a certain
 * uplift over the last three months. So be specific about the type of actions as well. Also
 * consider competitors for the brands and how they are performing in ad and visual displays on
 * Google Shopping and Meta. Let's be super innovative in testing, because the current top three
 * actions are based only on existing data, which isn't aggressive enough for our clients."
 *
 * Three things the Top-3 actions could not say, said here:
 *   1. A SPECIFIC TEST — the library below is twenty-odd named A/B tests, each with the field it
 *      moves, the split, the metric, the duration and the platform page the idea rests on.
 *   2. WHAT THE BOOK HAS PROVED — every brand's A/B test archive and every keyword-result round is
 *      read into one evidence table by test FAMILY, so a proposal to Monsoon can say "Reiss GB saw
 *      +12.4% CTR on this in August" (named inside the FCC; a client brief names the industry).
 *      A figure is only ever one the archive recorded — nothing here invents an uplift.
 *   3. WHAT COMPETITORS ARE DOING — a read of the Google Shopping results for the brand's own
 *      category queries (SerpApi, the same key AI Visibility uses): which merchants show, how
 *      they title, whether they badge a sale, where our price sits. The read turns into SIGNALS
 *      that promote specific tests (they badge sales, we don't → test sale_price presentation).
 *      Meta's ad creatives are not readable without a Meta Ad Library token — stated, never faked.
 *
 * AGGRESSIVE BY DESIGN: a test the brand has run in the last six months is not re-proposed; a test
 * NOBODY in the book has run earns an innovation bonus, and one of the three is always a first
 * for the book when a ready one exists — "based only on existing data" is exactly the trap.
 * HONEST BY DESIGN: a test the feed cannot carry yet (no Meta feed, no second image, no sale
 * prices) is listed with what unblocks it, never in the three.
 *
 * Pure: no fetch, no KV. The worker route (/api/testlab) gathers the stores and calls proposeTests;
 * tools/test_testlab.mjs runs this module and the lifted route against stubs.
 */
import { abDate } from './abtests.js';

export const TL_WINDOW_DAYS = 92;     // "over the last three months"
export const TL_RECENT_DAYS = 183;    // a brand that ran a family inside six months is not re-proposed
export const TL_TOP = 3;
export const COMP_TTL_MS = 24 * 3600 * 1000;   // one Shopping read per market per day unless forced
export const COMP_QUERIES = 6;                 // category queries per read (one SerpApi search each)
export const COMP_ROWS = 40;                   // Shopping rows kept per query

// ---- the library --------------------------------------------------------------------------------------------
// surf: google | meta | both · field: what the test changes · fam: the archive words that make an
// earlier test evidence FOR this one · need: readiness checks (below) · src: the page the idea rests on
export const TESTS = [
  { k: 'img_lifestyle', n: 'Lifestyle main image', surf: 'google', field: 'g:image_link',
    hyp: 'A lifestyle shot as the main image out-clicks the packshot on Shopping, where every neighbour is a packshot.',
    how: 'Split the catalogue by item group (50/50, same categories each side); swap g:image_link to the lifestyle shot on the test side; four weeks.',
    metric: 'CTR, then conversion rate', fam: /lifestyle|packshot|main image|image position|hero (shot|image)|imagery|image test/i,
    need: ['img2'], src: 'Google — image_link spec, answer 6324350' },
  { k: 'img_meta', n: 'Lifestyle catalogue image on Meta', surf: 'meta', field: 'image_link (Meta feed)',
    hyp: 'In the Meta feed a lifestyle picture reads as content, not an ad; the packshot reads as a shop.',
    how: 'Two product sets (same categories); the test set carries the lifestyle shot as image_link; four weeks on the same campaign.',
    metric: 'CTR and ROAS by product set', fam: /meta.*(image|lifestyle)|(image|lifestyle).*meta|dpa image/i,
    need: ['fb', 'img2'], src: 'Meta — catalogue image specs' },
  { k: 'ovl_price_meta', n: 'Price-tag overlay on Meta', surf: 'meta', field: 'image_link (Meta feed, FeedSpark overlay)',
    hyp: 'A price tag drawn on the catalogue image lifts CTR on Meta, where the card shows no price until tapped.',
    how: 'Overlay on half the item groups (FeedSpark image creator, price tag); four weeks.',
    metric: 'CTR, then cost per purchase', fam: /overlay|price tag/i,
    need: ['fb', 'noOvlFb'], src: 'FeedSpark Overlays — Design studio' },
  { k: 'ovl_promo_meta', n: '“% off” flash on sale lines (Meta)', surf: 'meta', field: 'image_link (Meta feed, FeedSpark overlay)',
    hyp: 'Lines on sale sell faster when the picture says so; the discount is already in the feed.',
    how: 'Sale lines only, split 50/50; the test side carries a corner flash reading the real discount; three weeks.',
    metric: 'Purchases per impression on sale lines', fam: /overlay.*(sale|promo|off)|(sale|promo).*overlay|flash/i,
    need: ['fb', 'sale'], src: 'FeedSpark Overlays — Design studio' },
  { k: 'twoup_meta', n: 'Product × lifestyle two-up (Meta)', surf: 'meta', field: 'image_link (Meta feed, composed from image_link + additional_image_link)',
    hyp: 'One frame showing the product and it worn/used answers the two questions a scroller has.',
    how: 'Item groups with a distinct second image, split 50/50; the test side carries the composed frame; four weeks.',
    metric: 'CTR by product set', fam: /two-?up|split image|product.*lifestyle/i,
    need: ['fb', 'img2'], src: 'FeedSpark Overlays — Product × lifestyle split' },
  { k: 'title_mask', n: 'MASK title structure', surf: 'google', field: 'g:title',
    hyp: 'Brand + Material + Fit + Colour + Use-case at 80–120 characters matches more long-tail queries than the site title.',
    how: 'Split by item group; rewrite the test side to MASK; four weeks; hold keywords constant.',
    metric: 'Impressions and clicks, then CTR', fam: /title|mask/i, title: true,
    need: [], src: 'Google — title best practice, answer 6324415' },
  { k: 'title_benefit', n: 'Benefit-led title copy', surf: 'google', field: 'g:title',
    hyp: 'A benefit phrase (“joint support”, “rain-ready”) in the title lifts clicks where the product name alone says nothing.',
    how: 'Top-selling 300 products split 50/50; the test side carries one benefit phrase after the product name; four weeks.',
    metric: 'CTR, then conversion rate', fam: /benefit/i, need: [], src: 'YuMOVE — benefit copy +24.7% (FeedSpark archive)' },
  { k: 'title_brand', n: 'Brand name in the title', surf: 'google', field: 'g:title',
    hyp: 'A brand shoppers search for by name earns clicks when the title leads with it; an unknown one loses characters.',
    how: 'Split by item group; the test side carries the brand first; three weeks.',
    metric: 'CTR on branded vs generic queries', fam: /brand (inclusion|in title|first)|brand name/i, need: [], src: 'Google — title best practice' },
  { k: 'title_order', n: 'Product type first vs brand first', surf: 'google', field: 'g:title',
    hyp: 'The first 35 characters are what Shopping shows on mobile; leading with the product type matches the query shoppers typed.',
    how: 'Split by item group; one side brand-first, the other type-first, same words; four weeks.',
    metric: 'CTR on mobile', fam: /title order|word order|type first|front-?load/i, need: [], src: 'Google — title truncation on mobile' },
  { k: 'kw_theme', n: 'Seasonal keyword injection', surf: 'google', field: 'g:product_type 2–10',
    hyp: 'The words shoppers use this season (“wedding guest”, “longline puffer”) are not in the catalogue; keyword slots carry them without touching the title.',
    how: 'One category, split 50/50; the test side gets the season’s themes in product_type 2–10; four weeks.',
    metric: 'Impressions on new queries, clicks', fam: /keyword/i, need: ['kw'], src: 'FeedSpark — Keyword calendar' },
  { k: 'hl_six', n: 'Six product highlights per product', surf: 'google', field: 'g:product_highlight',
    hyp: 'Highlights feed the “About this product” panel and the AI answers; six specific ones beat two generic ones.',
    how: 'Top 500 products split 50/50; the test side gets 6 highlights written from the PDP; four weeks.',
    metric: 'Conversion rate, then CTR', fam: /highlight/i, need: ['hl'], src: 'Google — product_highlight, answer 9216100' },
  { k: 'detail_three', n: 'Three real product details', surf: 'google', field: 'g:product_detail',
    hyp: 'Section:attribute:value details (neckline, closure, heel height) are what the filters and AI Mode read; care lines are not.',
    how: 'One category split 50/50; the test side gets three describing details per product; four weeks.',
    metric: 'Impressions on filtered queries, conversion rate', fam: /product detail|details/i, need: ['detail'], src: 'Google — product_detail, answer 9218260' },
  { k: 'desc_160', n: 'Key facts in the first 160 characters', surf: 'google', field: 'g:description',
    hyp: 'Google reads the opening of the description for the listing; a feature-first opening beats brand prose.',
    how: 'Split by item group; the test side opens with fabric, fit and use in the first 160 characters; four weeks.',
    metric: 'Conversion rate', fam: /description/i, need: [], src: 'Google — description spec, answer 6324468' },
  { k: 'sale_badge', n: 'Sale price with strike-through', surf: 'google', field: 'g:sale_price + g:sale_price_effective_date',
    hyp: 'A sale_price in the feed earns the price-drop badge and the strike-through; a lowered g:price earns nothing.',
    how: 'Lines on sale split 50/50; the test side sends g:price at full with g:sale_price, the control sends the discounted g:price alone; three weeks.',
    metric: 'CTR, then conversions on sale lines', fam: /sale price|strike|price drop|sale badge/i, need: ['sale'], src: 'Google — sale_price, answer 6324471' },
  { k: 'cl_newin', n: 'New-in custom label for bidding', surf: 'google', field: 'g:custom_label_0',
    hyp: 'Arrivals under 30 days old convert differently; a label lets the campaign bid them apart.',
    how: 'Label every product by first-seen date (new / 30–90 / older); split the campaign on it; four weeks.',
    metric: 'ROAS by label', fam: /new in|new-in|custom label|arrivals/i, need: ['arrivals'], src: 'Google — custom_label, answer 6324473' },
  { k: 'cl_perf', n: 'Performance-tier custom labels', surf: 'google', field: 'g:custom_label_1',
    hyp: 'Heroes, steady sellers and zombies want different bids; one label from the last 30 days of Ads data gives the campaign that split.',
    how: 'Label by clicks and conversions per product (FeedHero rule); split the listing groups on it; four weeks.',
    metric: 'ROAS, zombie share', fam: /zombie|performance (label|tier)|hero product/i, need: [], src: 'FeedSpark — Custom label strategy' },
  { k: 'gpc_deep', n: 'Deepest Google category', surf: 'google', field: 'g:google_product_category',
    hyp: 'A leaf category tells Google what the product is before the title has to; a two-level one leaves it guessing.',
    how: 'One top-level category split 50/50; the test side mapped to the deepest leaf; four weeks.',
    metric: 'Impressions, CTR', fam: /gpc|google (product )?category|taxonomy/i, need: ['gpc'], src: 'Google — google_product_category, answer 6324436' },
  { k: 'pt_five', n: 'Five-level product type', surf: 'google', field: 'g:product_type',
    hyp: 'Listing groups and the free product-type signal both read the path; five levels is the industry standard (30–40% of volume).',
    how: 'One department split by item group; the test side carries a five-level path; four weeks.',
    metric: 'Impressions, clicks', fam: /product type|pt depth|taxonomy/i, need: ['ptDepth'], src: 'Google — product_type, answer 6324406' },
  { k: 'conv_qa', n: 'Q&A conversational attribute on best sellers', surf: 'google', field: 'question_and_answer (supplemental source)',
    hyp: 'The AI surfaces answer with the product that answers the question; nobody in the category supplies Q&A yet.',
    how: 'Top 200 sellers; write 3 Q&As each from the PDP and reviews; supplemental feed; measure AI Mode / AI Overviews visibility before and after over six weeks.',
    metric: 'AI visibility (named / cited), then clicks', fam: /q ?& ?a|question|conversational/i, need: ['conv0'], src: 'Google — conversational attributes, answer 17085370' },
  { k: 'variant_card', n: 'One card per style (item_group_title + variant_option)', surf: 'google', field: 'item_group_title + variant_option',
    hyp: 'AI surfaces show a style as one product with its options; without the two fields every colour competes with itself.',
    how: 'Styles with 3+ variants split 50/50; the test side carries both fields; six weeks.',
    metric: 'AI visibility, then CTR', fam: /item_group_title|variant_option|variant card/i, need: ['grp', 'conv0'], src: 'Google — conversational attributes, answer 17085370' },
  { k: 'colour_plain', n: 'Plain colour vs brand colour name', surf: 'google', field: 'g:color + g:title',
    hyp: '“Navy” matches the query; “Midnight Fog” matches nothing. Keep the brand name on site, send the plain one.',
    how: 'Products with a non-standard colour name, split 50/50; the test side sends the plain colour in g:color and the title; four weeks.',
    metric: 'Impressions, CTR', fam: /colou?r/i, need: [], src: 'Google — color spec, answer 6324487' },
  { k: 'll_titles', n: 'Local-language titles on EU markets', surf: 'google', field: 'g:title (non-EN markets)',
    hyp: 'A German shopper searches in German; an English title on the DE feed matches only the brand query.',
    how: 'One non-EN market; split by item group; the test side carries local-language titles; four weeks.',
    metric: 'Impressions, CTR', fam: /local language|language|ll vs en|translat/i, need: ['nonEn'], src: 'Reiss — Local Language case study (FeedSpark archive)' },
  { k: 'ratings_feed', n: 'Product ratings feed', surf: 'google', field: 'product ratings feed (reviews)',
    hyp: 'Stars on the Shopping card are the one thing on it the feed cannot fake; competitors with stars win the glance.',
    how: 'Submit the product ratings feed from the review platform; measure the rated vs unrated products over six weeks.',
    metric: 'CTR of rated products', fam: /rating|review/i, need: [], src: 'Google — product ratings program' },
  { k: 'hero_sizes', n: 'Hero-size stock threshold', surf: 'google', field: 'availability (stock rule)',
    hyp: 'Spend on a style missing its hero sizes is spend on a return; holding it back until the run is whole lifts ROAS.',
    how: 'Split styles 50/50; the test side goes out of stock when a hero size is missing (FeedHero rule); four weeks.',
    metric: 'ROAS, return rate', fam: /hero size|range completion|stock threshold/i, need: [], src: 'FeedSpark — Stock levers' },
];

// ---- readiness: what the brand's feeds carry today ----------------------------------------------------------
// ctx.feeds = [{ mkt, fb, cov:{attr: pct|null}, rows, ai, ovlFb, lang, arrivals }] — built by the route from
// goldenidx / overlayidx / voldobidx / DEFAULT_FEEDS. A check either passes or names what unblocks it.
const COV = (ctx, k, min, any) => {
  const vals = (ctx.feeds || []).map((f) => (f.cov || {})[k]).filter((v) => typeof v === 'number');
  if (!vals.length) return { ok: false, why: 'no Golden Record scan of this brand yet' };
  const hit = vals.some((v) => v >= min);
  return any ? { ok: hit, why: hit ? '' : 'no market carries ' + k + ' on ' + min + '% or more' } : { ok: hit };
};
export const NEEDS = {
  fb: (ctx) => ((ctx.feeds || []).some((f) => f.fb)) ? { ok: true } : { ok: false, why: 'no Meta catalogue feed is wired for this brand' },
  img2: (ctx) => {
    const r = COV(ctx, 'additional_image_link', 40, true);
    return r.ok ? r : { ok: false, why: r.why && /no Golden/.test(r.why) ? r.why : 'fewer than 40% of products carry a second image on any market' };
  },
  noOvlFb: (ctx) => {
    const fbs = (ctx.feeds || []).filter((f) => f.fb);
    if (!fbs.length) return { ok: false, why: 'no Meta catalogue feed is wired for this brand' };
    return fbs.some((f) => !f.ovlFb) ? { ok: true } : { ok: false, why: 'every Meta feed already carries an overlay — test a different design instead' };
  },
  sale: (ctx) => { const r = COV(ctx, 'sale_price', 5, true); return r.ok ? r : { ok: false, why: r.why || 'no market carries sale prices on 5% of products' }; },
  kw: (ctx) => {
    const vals = (ctx.feeds || []).map((f) => (f.cov || {}).keywords).filter((v) => typeof v === 'number');
    if (!vals.length) return { ok: true };   // not measured: the calendar decides
    return vals.some((v) => v < 85) ? { ok: true } : { ok: false, why: 'every market is already keyworded on 85% or more' };
  },
  hl: (ctx) => { const v = (ctx.feeds || []).map((f) => (f.cov || {}).hl_depth).filter((x) => typeof x === 'number'); return (!v.length || v.some((x) => x < 80)) ? { ok: true } : { ok: false, why: 'highlights already run at 4+ per product on every market' }; },
  detail: (ctx) => { const v = (ctx.feeds || []).map((f) => (f.cov || {}).detail_depth).filter((x) => typeof x === 'number'); return (!v.length || v.some((x) => x < 70)) ? { ok: true } : { ok: false, why: 'product details already run at 3+ per product' }; },
  gpc: (ctx) => { const v = (ctx.feeds || []).map((f) => (f.cov || {}).google_product_category).filter((x) => typeof x === 'number'); return (!v.length || v.some((x) => x < 100)) ? { ok: true } : { ok: true }; },
  ptDepth: () => ({ ok: true }),
  conv0: (ctx) => ((ctx.feeds || []).every((f) => !(f.ai > 0))) ? { ok: true } : { ok: false, why: 'the brand already carries conversational attributes — measure those first' },
  grp: (ctx) => { const r = COV(ctx, 'item_group_id', 30, true); return r.ok ? r : { ok: false, why: 'fewer than 30% of products carry an item_group_id' }; },
  nonEn: (ctx) => ((ctx.feeds || []).some((f) => f.lang && f.lang !== 'en')) ? { ok: true } : { ok: false, why: 'every market of this brand is English-speaking' },
  arrivals: (ctx) => ((ctx.feeds || []).some((f) => f.arrivals > 0)) ? { ok: true } : { ok: false, why: 'no new-product arrivals read yet (Product Volume)' },
};
export function readiness(test, ctx) {
  const whys = [];
  for (const k of test.need || []) {
    const fn = NEEDS[k]; if (!fn) continue;
    const r = fn(ctx || {});
    if (!r.ok) whys.push(r.why || k);
  }
  return whys.length ? { ok: false, why: whys.join('; ') } : { ok: true, why: '' };
}

// ---- evidence: the whole book's archive, by family ----------------------------------------------------------
export function familyOf(test) {
  const words = [test.type, test.batch].filter(Boolean).join(' ');
  for (const t of TESTS) if (t.fam.test(words)) return t.k;
  if (test.title) return 'title_mask';
  return null;
}
const UP_METRICS = ['ctr', 'clicks', 'conversions', 'revenue', 'cvr', 'impressions'];
export function bestMetric(metrics) {
  let best = null;
  UP_METRICS.forEach((k) => {
    const v = metrics && metrics[k];
    if (typeof v === 'number' && isFinite(v) && (best == null || v > best.pct)) best = { metric: k, pct: v };
  });
  return best;
}
export function testWhen(t) {
  const d = abDate(t && t.live) || abDate(t && t.reportDate);
  return d ? d.getTime() : 0;
}
// a keyword-result line → {metric, pct} or null ("Clicks: 5.18% Increase", "+24.7% clicks", "CTR down 3%")
export function kwFigure(line) {
  const s = String(line || '');
  const m = /([+-]?\d+(?:\.\d+)?)\s*%/.exec(s); if (!m) return null;
  let pct = parseFloat(m[1]); if (!isFinite(pct)) return null;
  const word = /impression|click|ctr|conversion|revenue|cvr|roas|cost/i.exec(s);
  const metric = word ? word[0].toLowerCase().replace(/s$/, '') : 'uplift';
  if (metric === 'cost') return null;
  if (!/^[+-]/.test(m[1]) && /decreas|down|drop|lower|fell|-\s*\d/i.test(s)) pct = -pct;
  return { metric: metric === 'click' ? 'clicks' : metric === 'conversion' ? 'conversions' : metric, pct: Math.round(pct * 10) / 10 };
}
/* book = [{ brand, industry, tests }] (each brand's archive as /api/abtests serves it), kw = the
   kwresults archive. → { fam: { n, wins, recent, best } } where recent = wins inside the window,
   best-first, each {brand, industry, mkt, when, pct, metric, name}. */
export function evidenceBook(book, kw, nowMs, windowDays) {
  const now = nowMs || Date.now(), win = (windowDays || TL_WINDOW_DAYS) * 86400000;
  const out = {};
  const slot = (k) => out[k] || (out[k] = { n: 0, wins: 0, recent: [], older: [], brands: {} });
  (book || []).forEach((b) => {
    (b.tests || []).forEach((t) => {
      const k = familyOf(t); if (!k) return;
      const e = slot(k); e.n++; e.brands[b.brand] = Math.max(e.brands[b.brand] || 0, testWhen(t));
      const bm = bestMetric(t.metrics);
      const won = t.verdict === 'positive' || (t.winner && t.winner.group === 'test');
      if (!won || !bm || bm.pct <= 0) return;
      e.wins++;
      const rec = { brand: b.brand, industry: b.industry || '', mkt: String(t.country || '').toUpperCase(), when: testWhen(t), pct: bm.pct, metric: bm.metric, name: t.batch || t.type || '' };
      (rec.when && now - rec.when <= win ? e.recent : e.older).push(rec);
    });
  });
  (kw || []).forEach((r) => {
    if (!r || !r.brand) return;
    const e = slot('kw_theme'); e.n++; e.brands[r.brand] = Math.max(e.brands[r.brand] || 0, +r.when || 0);
    if (r.verdict === 'negative') return;
    let best = null;
    (r.metrics || []).forEach((l) => { const f = kwFigure(l); if (f && f.pct > 0 && (!best || f.pct > best.pct)) best = f; });
    if (!best) return;
    e.wins++;
    const rec = { brand: r.brand, industry: r.industry || '', mkt: String(r.mkt || '').toUpperCase(), when: +r.when || 0, pct: best.pct, metric: best.metric, name: r.period || '' };
    (rec.when && now - rec.when <= win ? e.recent : e.older).push(rec);
  });
  Object.keys(out).forEach((k) => {
    out[k].recent.sort((a, b) => b.pct - a.pct); out[k].older.sort((a, b) => b.when - a.when || b.pct - a.pct);
    out[k].best = out[k].recent[0] || null;
  });
  return out;
}

// ---- the competitor read: Google Shopping results for the brand's own category queries ----------------------
const fold = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const GENERIC = /^(all|view all|new in|new|sale|outlet|clothing|accessories|womens?|mens?|kids?|children|boys?|girls?|home|shop|products?|collection)$/i;
// the phrases a shopper would type, off the PT snapshot's [[path, n]] rows — leaves, biggest first
export function compQueries(ptValues, n) {
  const want = n || COMP_QUERIES, seen = {}, out = [];
  const ranked = (ptValues || []).filter((x) => x && x[0]).slice().sort((a, b) => (b[1] || 0) - (a[1] || 0));
  for (const row of ranked) {
    if (out.length >= want) break;
    const segs = String(row[0]).split(/\s*(?:>|\/|\|)\s*/).map((s) => s.trim()).filter(Boolean);
    while (segs.length > 1 && GENERIC.test(segs[segs.length - 1])) segs.pop();
    const leaf = segs[segs.length - 1]; if (!leaf || GENERIC.test(leaf) || leaf.length < 3 || leaf.length > 40) continue;
    const dept = segs.slice(0, -1).map((s) => s.toLowerCase()).find((s) => /^(women|woman|womens|men|mens|man|kids|girls|boys|baby)/.test(s)) || '';
    let q = leaf.toLowerCase();
    if (dept && q.indexOf(dept.replace(/s$/, '')) < 0) q = dept.replace(/s$/, '') + 's ' + q;
    const k = fold(q); if (seen[k]) continue; seen[k] = 1;
    out.push({ q, src: row[0], v: row[1] || 0 });
  }
  return out;
}
// SerpApi engine=google_shopping → the rows we keep (nothing of the raw page is stored)
export function normShopping(j, q) {
  const rows = [];
  const list = (j && Array.isArray(j.shopping_results)) ? j.shopping_results : [];
  list.slice(0, COMP_ROWS).forEach((r, i) => {
    if (!r) return;
    const price = typeof r.extracted_price === 'number' ? r.extracted_price : null;
    const old = typeof r.extracted_old_price === 'number' ? r.extracted_old_price : null;
    rows.push({
      pos: +r.position || (i + 1), m: String(r.source || '').slice(0, 80), t: String(r.title || '').slice(0, 200),
      p: price, old, sale: !!(old && price && old > price) || /sale|off/i.test(String(r.tag || '')),
      rating: typeof r.rating === 'number' ? r.rating : null, reviews: typeof r.reviews === 'number' ? r.reviews : null,
      img: /^https:\/\//.test(String(r.thumbnail || '')) ? String(r.thumbnail).slice(0, 500) : '',
      link: /^https?:\/\//.test(String(r.product_link || r.link || '')) ? String(r.product_link || r.link).slice(0, 500) : '',
      ad: /sponsored|^ad$/i.test(String(r.tag || '')) || !!r.sponsored,
    });
  });
  return { q, n: rows.length, rows };
}
function isOurs(row, brandKey, domainKey) {
  const m = fold(row.m), l = fold(row.link);
  return !!brandKey && (m.indexOf(brandKey) >= 0 || (domainKey && l.indexOf(domainKey) >= 0));
}
function leadsWithType(title, brandKey) {
  const first = fold(String(title || '').split(/\s+/).slice(0, 2).join(''));
  return !(brandKey && first.indexOf(brandKey) === 0);
}
function median(a) { const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; }
/* reads = [{q, n, rows}] for ONE market → the summary the rail shows and the SIGNALS that promote tests */
export function compSummary(reads, brand, domain) {
  const bk = fold(brand), dk = fold(String(domain || '').replace(/^www\./, '').split('.')[0]);
  const merchants = {}, ours = { n: 0, top3: 0, pos: [], sale: 0, prices: [], lens: [], rated: 0, typeFirst: 0 };
  let total = 0, theirs = 0, theirSale = 0, theirRated = 0, theirTypeFirst = 0;
  const theirPrices = [], theirLens = [], theirThumbs = [], ourThumbs = [];
  (reads || []).forEach((rd) => (rd.rows || []).forEach((r) => {
    total++;
    if (isOurs(r, bk, dk)) {
      ours.n++; if (r.pos <= 3) ours.top3++; ours.pos.push(r.pos); if (r.sale) ours.sale++;
      if (r.p != null) ours.prices.push(r.p); ours.lens.push(r.t.length); if (r.rating != null) ours.rated++;
      if (leadsWithType(r.t, bk)) ours.typeFirst++;
      if (r.img && ourThumbs.length < 8) ourThumbs.push({ img: r.img, t: r.t, q: rd.q });
      return;
    }
    theirs++;
    const key = fold(r.m) || 'unknown';
    const m = merchants[key] || (merchants[key] = { m: r.m || 'unknown', n: 0, top3: 0, sale: 0, rated: 0, typeFirst: 0, prices: [], lens: [], qs: {}, img: '' });
    m.n++; if (r.pos <= 3) m.top3++; if (r.sale) m.sale++; if (r.rating != null) m.rated++;
    if (leadsWithType(r.t, fold(r.m))) m.typeFirst++;
    if (r.p != null) m.prices.push(r.p); m.lens.push(r.t.length); m.qs[rd.q] = 1;
    if (!m.img && r.img) m.img = r.img;
    if (r.sale) theirSale++; if (r.rating != null) theirRated++; if (leadsWithType(r.t, fold(r.m))) theirTypeFirst++;
    if (r.p != null) theirPrices.push(r.p); theirLens.push(r.t.length);
    if (r.img && theirThumbs.length < 12) theirThumbs.push({ img: r.img, m: r.m, t: r.t, q: rd.q, sale: r.sale, p: r.p });
  }));
  const list = Object.values(merchants).map((m) => ({
    m: m.m, n: m.n, share: total ? Math.round((m.n / total) * 1000) / 10 : 0, top3: m.top3, queries: Object.keys(m.qs).length,
    sale: m.n ? Math.round((m.sale / m.n) * 100) : 0, rated: m.n ? Math.round((m.rated / m.n) * 100) : 0,
    typeFirst: m.n ? Math.round((m.typeFirst / m.n) * 100) : 0, priceMed: median(m.prices), lenMed: median(m.lens), img: m.img,
  })).sort((a, b) => b.n - a.n || b.top3 - a.top3).slice(0, 12);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const us = { n: ours.n, share: total ? Math.round((ours.n / total) * 1000) / 10 : 0, top3: ours.top3, posMed: median(ours.pos),
    sale: pct(ours.sale, ours.n), rated: pct(ours.rated, ours.n), typeFirst: pct(ours.typeFirst, ours.n), priceMed: median(ours.prices), lenMed: median(ours.lens), thumbs: ourThumbs };
  const them = { n: theirs, sale: pct(theirSale, theirs), rated: pct(theirRated, theirs), typeFirst: pct(theirTypeFirst, theirs), priceMed: median(theirPrices), lenMed: median(theirLens), thumbs: theirThumbs };
  const signals = [];
  if (theirs >= 10) {
    if (them.sale >= 25 && (us.sale == null || us.sale < 10)) signals.push({ k: 'sale_badge', why: 'competitors badge a sale on ' + them.sale + '% of their Shopping results; ' + (us.n ? 'you on ' + (us.sale || 0) + '%' : 'you show none') });
    if (them.rated >= 40 && (us.rated == null || us.rated < 15)) signals.push({ k: 'ratings_feed', why: 'competitors show star ratings on ' + them.rated + '% of results; ' + (us.n ? 'you on ' + (us.rated || 0) + '%' : 'you show none') });
    if (them.typeFirst >= 60 && us.n && (us.typeFirst || 0) < 40) signals.push({ k: 'title_order', why: 'competitors lead ' + them.typeFirst + '% of their titles with the product type; you lead with the brand on ' + (100 - (us.typeFirst || 0)) + '%' });
    if (us.lenMed != null && them.lenMed != null && us.lenMed < them.lenMed - 15) signals.push({ k: 'title_mask', why: 'your titles run ' + us.lenMed + ' characters against competitors’ ' + them.lenMed });
    if (us.n === 0) signals.push({ k: 'kw_theme', why: 'the brand does not appear in the Shopping results for its own top categories' });
  }
  return { total, queries: (reads || []).map((r) => ({ q: r.q, n: r.n })), merchants: list, us, them, signals };
}

// ---- Google Ads Auction Insights — the competitor read that needs no API (Ray, 14 Oct 2026: "is there a
// way to bypass the competitor mapping without API?" → "i think Google Ads Auction insight") ----------------
// The AM downloads the Auction Insights report from the Google Ads UI (Shopping campaigns: Display URL
// domain · Impression share · Overlap rate · Outranking share; Search adds Position above / Top of page /
// Abs. top of page) as CSV or Excel; the page reads the file into rows (docs/xlsx_engine.js readFile) and
// PUTs the rows here. The report's own figures, never re-derived: "< 10%" is kept as a floor (lt), "--" is
// null, a fraction from an Excel cell (0.4523) is the same 45.23%. A segmented export (a Campaign / Ad group
// column) is folded per domain, the strongest figure kept and the count said.
export const AUC_MAX_ROWS = 400;   // rows the page may send — a report lists tens of domains, never hundreds
const AUC_COLS = [
  ['d', /display url domain|domain/i], ['is', /impression share|impr\.? share/i], ['ov', /overlap rate/i],
  ['or', /outranking share/i], ['pa', /position above rate/i], ['top', /top of page rate/i], ['atop', /abs\.? top of page/i],
];
export function aucPct(v) {
  if (v == null || v === '') return { v: null };
  if (typeof v === 'number') return isFinite(v) ? { v: Math.round((v <= 1 ? v * 100 : v) * 100) / 100 } : { v: null };
  const s = String(v).trim();
  if (!s || /^-+$/.test(s) || /^n\/?a$/i.test(s)) return { v: null };
  const m = /^(<|>)?\s*([\d.,]+)\s*%?$/.exec(s.replace(/\s/g, ''));
  if (!m) return { v: null };
  const n = parseFloat(m[2].replace(/,/g, '')); if (!isFinite(n)) return { v: null };
  return m[1] === '<' ? { v: n, lt: true } : m[1] === '>' ? { v: n, gt: true } : { v: Math.round(n * 100) / 100 };
}
export function parseAuction(rows) {
  const R = Array.isArray(rows) ? rows : [];
  let head = -1, map = null;
  for (let i = 0; i < Math.min(R.length, 30); i++) {
    const r = Array.isArray(R[i]) ? R[i] : []; const m = {};
    r.forEach((c, j) => { const t = String(c == null ? '' : c); AUC_COLS.forEach(([k, re]) => { if (map === null && m[k] == null && re.test(t)) m[k] = j; }); });
    if (m.d != null && m.is != null) { head = i; map = m; break; }
  }
  if (head < 0) return { ok: false, error: 'no Auction Insights header — the file needs a "Display URL domain" column beside "Impression share"' };
  let range = '';
  for (let i = 0; i < head; i++) { const t = (R[i] || []).map((c) => String(c == null ? '' : c)).join(' ').trim(); if (/\d{4}/.test(t) && /[-–]/.test(t)) range = t.slice(0, 80); }
  const segCol = (R[head] || []).findIndex((c) => /^(campaign|ad group|device|day|week|month)/i.test(String(c || '')));
  const by = {}, order = [];
  for (let i = head + 1; i < R.length; i++) {
    const r = R[i]; if (!Array.isArray(r)) continue;
    const dRaw = String(r[map.d] == null ? '' : r[map.d]).trim(); if (!dRaw || /^total/i.test(dRaw)) continue;
    const you = /^you$/i.test(dRaw);
    const d = you ? 'You' : dRaw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 120);
    const e = by[d] || (by[d] = { d, you, n: 0 }); if (!by[d].n) order.push(d); e.n++;
    ['is', 'ov', 'or', 'pa', 'top', 'atop'].forEach((k) => {
      if (map[k] == null) return; const p = aucPct(r[map[k]]);
      if (p.v == null) return;
      if (e[k] == null || p.v > e[k]) { e[k] = p.v; if (p.lt) e[k + 'Lt'] = true; else delete e[k + 'Lt']; }
    });
  }
  const list = order.map((d) => by[d]);
  if (!list.length) return { ok: false, error: 'the header was found but no domain rows followed it' };
  const you = list.find((x) => x.you) || null;
  const comps = list.filter((x) => !x.you).sort((a, b) => (b.is || 0) - (a.is || 0));
  return { ok: true, range, segmented: segCol >= 0, you, comps: comps.slice(0, 60), cols: Object.keys(map).filter((k) => k !== 'd') };
}
export function cleanAuction(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.comps)) return null;
  const num = (x) => (typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(100, x)) : null);
  const row = (r) => { if (!r || !r.d) return null; const o = { d: String(r.d).slice(0, 120), you: !!r.you, n: Math.max(1, Math.round(+r.n) || 1) };
    ['is', 'ov', 'or', 'pa', 'top', 'atop'].forEach((k) => { const n = num(r[k]); if (n != null) { o[k] = n; if (r[k + 'Lt']) o[k + 'Lt'] = true; } }); return o; };
  return { v: 1, at: +v.at || 0, mkt: String(v.mkt || '').slice(0, 12), range: String(v.range || '').slice(0, 80), segmented: !!v.segmented,
    you: v.you ? row(v.you) : null, comps: v.comps.slice(0, 60).map(row).filter(Boolean), by: String(v.by || '').slice(0, 80) };
}
/* the signals an Auction Insights read promotes — ads outcomes, so they name the tests that move eligibility
   (keywords, titles) and bidding (performance labels), never a creative test the report cannot see */
export function auctionSignals(a) {
  const out = [];
  if (!a || !a.comps || !a.comps.length) return out;
  const top = a.comps[0], you = a.you;
  const yi = you && typeof you.is === 'number' ? you.is : null;
  if (yi != null && typeof top.is === 'number' && top.is > yi + 5) {
    out.push({ k: 'kw_theme', why: top.d + ' wins ' + top.is + '% impression share against your ' + yi + '% (Auction Insights' + (a.range ? ', ' + a.range : '') + ') — eligibility is what keywords lift' });
    out.push({ k: 'title_mask', why: top.d + ' is in ' + top.is + '% of the auctions you could enter, you in ' + yi + '% — richer titles match more of them' });
  }
  const outranked = a.comps.filter((c) => typeof c.or === 'number' && c.or < 40 && typeof c.ov === 'number' && c.ov >= 20);
  if (outranked.length) out.push({ k: 'cl_perf', why: 'you outrank ' + outranked.slice(0, 3).map((c) => c.d + ' only ' + c.or + '%').join(', ') + ' of the time where you both show — a performance-tier label lets the campaign bid the heroes apart' });
  if (yi != null && yi < 20 && a.comps.length >= 3) out.push({ k: 'sale_badge', why: 'your impression share is ' + yi + '% among ' + a.comps.length + ' competitors — a price-drop badge earns the auctions a bid cannot' });
  return out;
}

// ---- the proposals -------------------------------------------------------------------------------------------
const MMYY = (ms) => { const d = new Date(ms); return String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2); };
const MON = (ms) => new Date(ms).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
export function surfWord(s) { return s === 'meta' ? 'Meta' : s === 'google' ? 'Google Shopping' : 'Google Shopping + Meta'; }
/* brand: name · ctx: { industry, feeds, archive (this brand's tests), kw (this brand's rounds),
   briefs (open test tickets' task names), comp: {signals:[]} } · ev: evidenceBook() output */
export function proposeTests(brand, ctx, ev, opts) {
  opts = opts || {}; ctx = ctx || {}; ev = ev || {};
  const now = opts.now || Date.now(), recent = (opts.recentDays || TL_RECENT_DAYS) * 86400000;
  const ran = {};   // family → last time THIS brand ran it
  (ctx.archive || []).forEach((t) => { const k = familyOf(t); if (k) ran[k] = Math.max(ran[k] || 0, testWhen(t)); });
  (ctx.kw || []).forEach((r) => { ran.kw_theme = Math.max(ran.kw_theme || 0, +r.when || 0); });
  const briefed = {};
  (ctx.briefs || []).forEach((task) => { TESTS.forEach((t) => { if (String(task || '').toLowerCase().indexOf(t.n.toLowerCase()) >= 0) briefed[t.k] = task; }); });
  const sig = {}; ((ctx.comp && ctx.comp.signals) || []).forEach((s) => { sig[s.k] = s.why; });
  const ind = ctx.industry || '';
  const out = TESTS.map((t) => {
    const e = ev[t.k] || { n: 0, wins: 0, recent: [], older: [], brands: {} };
    const rd = readiness(t, ctx);
    const peers = e.recent.filter((r) => r.brand !== brand);
    const same = peers.filter((r) => r.industry && r.industry === ind);
    const older = e.older.filter((r) => r.brand !== brand);
    const first = !e.n;                       // nobody in the book has run it
    const mine = ran[t.k] || 0, recentMine = mine && now - mine <= recent;
    let score = 0, evKind, evLine;
    if (same.length) { score += 40; evKind = 'peer'; }
    else if (peers.length) { score += 30; evKind = 'peer'; }
    else if (older.length) { score += 15; evKind = 'book'; }
    else if (first) { score += 22; evKind = 'first'; }
    else { score += 8; evKind = 'none'; }
    const best = (same[0] || peers[0] || older[0]) || null;
    if (best) evLine = best.brand + (best.mkt ? ' ' + best.mkt : '') + ' +' + best.pct + '% ' + best.metric + (best.when ? ' (' + MON(best.when) + ')' : '')
      + (e.recent.length > 1 ? ' · ' + e.recent.length + ' wins across the book in 3 months' : (evKind === 'book' ? ' · older than 3 months' : ''));
    else evLine = first ? 'no FeedSpark result yet — this would be the book’s first, which is the point' : (e.n + ' run' + (e.n === 1 ? '' : 's') + ' in the book, no recorded uplift yet');
    if (sig[t.k]) { score += 20; evLine = 'Competitors: ' + sig[t.k] + ' · ' + (best ? evLine : (first ? 'no FeedSpark result yet — a first for the book' : evLine)); if (evKind === 'none' || evKind === 'first') evKind = 'comp'; }
    if (rd.ok) score += 25;
    if (!mine) score += 6; else if (!recentMine) score += 2;
    const status = briefed[t.k] ? 'briefed' : recentMine ? 'ran' : rd.ok ? 'ready' : 'blocked';
    const say = sayLine(brand, t, best, first, ind, sig[t.k], rd);
    const scope = briefScope(t, best, first, ind, sig[t.k], ctx);
    return { k: t.k, n: t.n, surf: t.surf, field: t.field, hyp: t.hyp, how: t.how, metric: t.metric, src: t.src,
      title: 'How about we A/B test ' + t.n.toLowerCase().replace(/^“/, '“') + ' this month?',
      ev: evLine, evKind, first, peers: (same.length ? same : peers).slice(0, 3), ready: rd, status, score,
      ranAt: mine || 0, briefedAs: briefed[t.k] || null, say,
      brief: { cat: 'test', task: 'A/B Test - ' + t.n + ' - ' + brand + ' - ' + MMYY(now), scope } };
  });
  const live = out.filter((p) => p.status === 'ready').sort((a, b) => b.score - a.score || a.n.localeCompare(b.n));
  const top = live.slice(0, TL_TOP);
  // the innovation quota: one of the three is a first for the book when a ready first exists
  if (top.length === TL_TOP && !top.some((p) => p.first)) {
    const f = live.find((p) => p.first && top.indexOf(p) < 0);
    if (f) top[TL_TOP - 1] = f;
  }
  const rest = out.filter((p) => top.indexOf(p) < 0).sort((a, b) => {
    const o = { ready: 0, blocked: 1, briefed: 2, ran: 3 };
    return o[a.status] - o[b.status] || b.score - a.score || a.n.localeCompare(b.n);
  });
  return { top, rest, counts: { ready: live.length, blocked: out.filter((p) => p.status === 'blocked').length, briefed: out.filter((p) => p.status === 'briefed').length, ran: out.filter((p) => p.status === 'ran').length } };
}
function sayLine(brand, t, best, first, ind, sig, rd) {
  const on = surfWord(t.surf);
  let s = '';
  if (sig) s += 'On ' + on + ' ' + sig + '. ';
  if (best) s += (best.brand === brand ? 'You' : best.brand) + ' saw +' + best.pct + '% ' + best.metric + ' on ' + t.n.toLowerCase() + (best.when ? ' in ' + MON(best.when) : '') + '. ';
  else if (first) s += 'Nobody in our book has tested ' + t.n.toLowerCase() + ' yet — ' + brand + ' would be first. ';
  s += t.hyp + ' ' + t.how.replace(/^Split/, 'We would split').replace(/^Two product sets/, 'We would run two product sets').replace(/^Overlay/, 'We would overlay').replace(/^Label/, 'We would label').replace(/^Submit/, 'We would submit').replace(/^Top/, 'We would take the top').replace(/^One/, 'We would take one').replace(/^Lines/, 'We would take the lines').replace(/^Sale lines/, 'We would take the sale lines').replace(/^Products/, 'We would take the products').replace(/^Styles/, 'We would take the styles').replace(/^Item groups/, 'We would take the item groups');
  if (!rd.ok) s += ' (Not yet: ' + rd.why + '.)';
  return s;
}
// the brief body — a client-facing document, so a peer is an INDUSTRY, never a name (Ray, 8 Oct 2026)
function briefScope(t, best, first, ind, sig, ctx) {
  const L = ['Test: ' + t.n + ' (' + surfWord(t.surf) + ')', 'Field: ' + t.field, 'Hypothesis: ' + t.hyp, 'Design: ' + t.how, 'Primary metric: ' + t.metric,
    'Success: the test side beats control on the primary metric at 95% confidence; losers revert, winners roll out to the whole catalogue.'];
  if (best) L.push('Evidence: a ' + (best.industry || 'FeedSpark') + ' account saw +' + best.pct + '% ' + best.metric + (best.when ? ' (' + MON(best.when) + ')' : '') + ' on the same test.');
  else if (first) L.push('Evidence: a first for FeedSpark — no prior result; the hypothesis rests on ' + t.src + '.');
  if (sig) L.push('Competitor read (Google Shopping): ' + sig + '.');
  L.push('Source: ' + t.src);
  const mk = (ctx.feeds || []).map((f) => String(f.mkt || '').toUpperCase()).filter((m) => m && !/-FB$/.test(m));
  if (mk.length) L.push('Markets wired: ' + mk.join(', '));
  return L.join('\n');
}

// ---- what the store accepts ----------------------------------------------------------------------------------
// a stored read (compwatch:<client>:<mkt>) checked whole on the way in — the page never sees a raw SerpApi page
const numOr = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
export function cleanRow(r, i) {
  if (!r || typeof r !== 'object') return null;
  const t = String(r.t || '').slice(0, 200); if (!t) return null;
  return { pos: Math.max(1, Math.min(200, Math.round(+r.pos) || (i + 1))), m: String(r.m || '').slice(0, 80), t,
    p: numOr(r.p), old: numOr(r.old), sale: !!r.sale, rating: numOr(r.rating), reviews: numOr(r.reviews),
    img: /^https:\/\//.test(String(r.img || '')) ? String(r.img).slice(0, 500) : '',
    link: /^https?:\/\//.test(String(r.link || '')) ? String(r.link).slice(0, 500) : '', ad: !!r.ad };
}
export function cleanRead(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.reads)) return null;
  const reads = v.reads.slice(0, 12).map((r) => {
    const rows = (Array.isArray(r && r.rows) ? r.rows : []).slice(0, COMP_ROWS).map(cleanRow).filter(Boolean);
    return { q: String((r && r.q) || '').slice(0, 120), n: rows.length, rows };
  }).filter((r) => r.q);
  return { v: 1, at: +v.at || 0, mkt: String(v.mkt || '').slice(0, 12), reads, n: reads.reduce((a, r) => a + r.n, 0) };
}
