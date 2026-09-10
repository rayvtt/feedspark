#!/usr/bin/env node
/* Overlays engine harness — pins the URL-string classification Ray specified (the overlay
 * TYPE is read from the image_link URL: host + image-creator path + params) and the feed
 * collector's counting on the Feed Lab parser contract. Runs in qa_gate + validate.yml.
 *   node tools/test_overlays.mjs
 * Optional: OVERLAY_FIXTURE=/path/to/feed.xml streams a real FeedHero export through
 * FeedAudit.createXmlParser + the collector and prints the summary (never asserted). */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const O = require('../docs/overlay_engine.js');
const FA = require('../docs/feedlab_engine.js');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };

const MONSOON = 'https://dashboard.feedspark.com/image-creator/monsoon-mix-meta/image_process_products_lifestyle.php?img_url_left=https://www.monsoon.co.uk/on/demandware.static/-/Sites-monsoon-master-catalog/default/dw37d80ee1/images/large/01_20001600003_1.jpg&img_url_right=https://www.monsoon.co.uk/on/demandware.static/-/Sites-monsoon-master-catalog/default/dw83f749f5/images/large/21_20001600003_1.jpg&img_ver=1';
const ENGINE = 'https://dashboard.feedspark.com/image-creator/dynamic-overlay-engine/yumove/image_process_engine.php?img_url=https://cdn.shopify.com/s/files/1/0103/3784/5303/files/Digestive_Rapid.webp?v=1772186897&width=1000&width=1000&img_ver=1&overlay_img_pos=2&overlay_frame=white_1000_yumove_1_1726228743.png&ver=3';
const SUBS = 'https://dashboard.feedspark.com/image-creator/yumove/image_process_subscription_v1.php?img_url=https://cdn.shopify.com/s/files/1/0103/3784/5303/files/Skin_Coat.webp?v=1771338896&width=1000&show_price=10.00&tags_font_color=FFFFFF&tags_bg_color=036121&tags_img_type=round_dpa&img_ver=10';
const LIA = 'https://lia.feedspark.com/feedspark-meta-dynamic-v2/meta_catelog_call.php?report_template_id=1784723570&image_version=1&cache=1&template_hash=eae0f46b&img_url=https://cdn.shopify.com/s/files/1/0103/3784/5303/files/BundleDigestive_Updated.webp?v=1772202733';
const FEED5 = 'https://dashboard.feed5.com/image-creator/reiss-meta/image_process_sale_badge.php?img_url=https://x.com/a.jpg&discount=30';
const PLAIN = 'https://www.monsoon.co.uk/on/demandware.static/-/Sites-monsoon-master-catalog/default/dwa6c9ec2d/images/large/21_56100070009_6.jpg';

console.log('· host detection');
t('dashboard.feedspark.com is an overlay host', O.isOverlayUrl(MONSOON));
t('lia.feedspark.com is an overlay host', O.isOverlayUrl(LIA));
t('dashboard.feed5.com (Ray\'s sibling domain) is an overlay host', O.isOverlayUrl(FEED5));
t('client CDN image is not', !O.isOverlayUrl(PLAIN) && O.classifyOverlay(PLAIN) === null);
t('look-alike host (feedspark.com.evil.io) is not', !O.isOverlayUrl('https://dashboard.feedspark.com.evil.io/x.php'));
t('empty / null safe', !O.isOverlayUrl('') && !O.isOverlayUrl(null) && O.classifyOverlay(undefined) === null);

console.log('· Monsoon Meta — products × lifestyle split (Ray\'s example)');
{
  const c = O.classifyOverlay(MONSOON);
  t('family image-creator, project monsoon-mix-meta', c.family === 'image-creator' && c.project === 'monsoon-mix-meta', JSON.stringify([c.family, c.project]));
  t('label reads the type off the script name', c.label === 'Product × Lifestyle split', c.label);
  t('layout = split (left + right sources)', c.layout === 'split' && c.sources.length === 2, JSON.stringify([c.layout, c.sources.length]));
  t('left/right sources decoded in order', /01_20001600003_1/.test(c.sources[0]) && /21_20001600003_1/.test(c.sources[1]));
  t('version 1 read from img_ver', c.ver === '1');
  t('key = host + path (query-free, stable per recipe)', c.key === 'dashboard.feedspark.com/image-creator/monsoon-mix-meta/image_process_products_lifestyle.php', c.key);
  const labels = c.recipe.map((r) => r.label);
  t('recipe readouts: Left image · Right image · Version', labels.join('·') === 'Left image·Right image·Version', labels.join('·'));
}

console.log('· YuMOVE — dynamic overlay engine with a frame asset');
{
  const c = O.classifyOverlay(ENGINE);
  t('label names the engine + frame (upload stamp stripped)', c.label === 'Dynamic overlay engine · frame white 1000 yumove 1', c.label);
  t('project keeps the brand path', c.project === 'dynamic-overlay-engine/yumove', c.project);
  t('single source image, shopify ?v= kept intact', c.layout === 'single' && c.sources[0] === 'https://cdn.shopify.com/s/files/1/0103/3784/5303/files/Digestive_Rapid.webp?v=1772186897', c.sources[0]);
  t('duplicate width param collapses to one readout', c.recipe.filter((r) => r.k === 'width').length === 1);
  t('image position + engine version decoded', c.recipe.some((r) => r.label === 'Image position' && r.v === '2') && c.recipe.some((r) => r.label === 'Engine version' && r.v === '3'));
}

console.log('· YuMOVE — subscription price-tag overlay');
{
  const c = O.classifyOverlay(SUBS);
  t('label: Subscription v1 · price tag', c.label === 'Subscription v1 · price tag', c.label);
  t('hex colours prettified', c.recipe.some((r) => r.k === 'tags_font_color' && r.v === '#FFFFFF') && c.recipe.some((r) => r.k === 'tags_bg_color' && r.v === '#036121'));
  t('tag style round_dpa → Round DPA', c.recipe.some((r) => r.k === 'tags_img_type' && r.v === 'Round DPA'));
  t('version 10', c.ver === '10');
}

console.log('· lia — Meta dynamic template');
{
  const c = O.classifyOverlay(LIA);
  t('family meta-dynamic, label v2', c.family === 'meta-dynamic' && c.label === 'Meta dynamic template v2', JSON.stringify([c.family, c.label]));
  t('template id + hash in the recipe', c.recipe.some((r) => r.label === 'Template id' && r.v === '1784723570') && c.recipe.some((r) => r.label === 'Template hash' && r.v === 'eae0f46b'));
  t('cache=1 reads as Cached yes', c.recipe.some((r) => r.label === 'Cached' && r.v === 'yes'));
}

console.log('· unseen future script still classifies (derived label, never hidden)');
{
  const c = O.classifyOverlay(FEED5);
  t('sale_badge → "Sale Badge"', c.label === 'Sale Badge', c.label);
  t('discount param surfaced', c.recipe.some((r) => r.label === 'Discount' && r.v === '30'));
  const bare = O.classifyOverlay('https://dashboard.feedspark.com/image-creator/superdry-meta/');
  t('bare project path falls back to the project name', bare && bare.label === 'Superdry', bare && bare.label);
  const q = O.parseQuery('img_url=https://a.com/x.jpg?a=1&b=2&width=5');
  t('a source URL carrying its own & is glued back', q.length === 2 && q[0].v === 'https://a.com/x.jpg?a=1&b=2' && q[1].k === 'width', JSON.stringify(q));
}

console.log('· collector on the Feed Lab parser contract (CSV header + rows)');
{
  const col = O.overlayCollector({ client: 'Monsoon', market: 'gb-fb' });
  col.onRow(['id', 'title', 'link', 'g:image_link', 'additional_image_link', 'additional_image_link|||2']);
  col.onRow(['1', 'Dress A', 'https://m.co/1', MONSOON, PLAIN, '']);
  col.onRow(['2', 'Dress B', 'https://m.co/2', PLAIN, '', '']);
  col.onRow(['3', 'Dress C', 'https://m.co/3', MONSOON.replace('img_ver=1', 'img_ver=2'), LIA, '']);
  col.onRow(['4', 'Dress D', 'https://m.co/4', '', '', SUBS]);
  col.onRow(['5', 'Dress E', 'https://m.co/5', ENGINE, '', '']);
  const s = col.finish();
  t('rows counted', s.rows === 5, s.rows);
  t('3 of 5 image_links are overlays', s.ovl === 3, s.ovl);
  t('2 rows carry an overlay in additional_image_link (incl. the |||2 slot)', s.addl === 2, s.addl);
  t('plain hosts recorded for context', s.plain === 1 && s.hosts[0][0] === 'www.monsoon.co.uk', JSON.stringify(s.hosts));
  t('types sorted by volume, split first', s.types[0].script === 'image_process_products_lifestyle' && s.types[0].n === 2, JSON.stringify(s.types.map((x) => [x.script, x.n, x.addl])));
  t('additional-slot overlays counted on their own type', s.types.some((x) => x.script === 'image_process_subscription_v1' && x.n === 0 && x.addl === 1));
  t('version spread per type', s.types[0].vers['1'] === 1 && s.types[0].vers['2'] === 1, JSON.stringify(s.types[0].vers));
  t('samples carry id/title/link/url/sources', s.types[0].samples.length === 2 && s.types[0].samples[0].id === '1' && s.types[0].samples[0].src.length === 2 && s.types[0].samples[0].link === 'https://m.co/1');
  t('identity from meta', s.client === 'Monsoon' && s.market === 'gb-fb' && s.hasImage === true);
}

console.log('· collector: XML header growing mid-stream re-resolves columns');
{
  const col = O.overlayCollector({ client: 'X', market: 'gb' });
  const h1 = ['g:id', 'g:title'];
  col.onRow(h1.slice(), h1);
  col.onRow(['1', 'A'], h1);
  const h2 = ['g:id', 'g:title', 'g:image_link'];
  col.onRow(['2', 'B', MONSOON], h2);   // image_link debuts past the sample
  const s = col.finish();
  t('late-debut image_link column adopted', s.rows === 2 && s.ovl === 1 && s.hasImage, JSON.stringify([s.rows, s.ovl, s.hasImage]));
}
{
  const col = O.overlayCollector({ client: 'X', market: 'gb' });
  col.onRow(['id', 'title']);
  col.onRow(['1', 'A']);
  const s = col.finish();
  t('feed without an image column reports hasImage:false, zero overlays', s.hasImage === false && s.ovl === 0);
  let threw = false; try { O.overlayCollector({}).finish(); } catch (e) { threw = /fetch-fail/.test(String(e.message)); }
  t('empty stream throws fetch-fail', threw);
}

console.log('· sample cap');
{
  const col = O.overlayCollector({ client: 'X', market: 'gb-fb' });
  col.onRow(['id', 'image_link']);
  for (let i = 0; i < 40; i++) col.onRow([String(i), MONSOON]);
  const s = col.finish();
  t('samples capped at ' + O.SAMPLES + ' while n counts all', s.types[0].samples.length === O.SAMPLES && s.types[0].n === 40);
}

// optional real fixture — stream through FeedAudit's XML parser exactly as the agent does
const FX = process.env.OVERLAY_FIXTURE;
if (FX && existsSync(FX)) {
  const col = O.overlayCollector({ client: 'fixture', market: 'gb-fb' });
  const p = FA.createXmlParser(col.onRow);
  const txt = readFileSync(FX, 'utf8');
  for (let i = 0; i < txt.length; i += 65536) p.push(txt.slice(i, i + 65536));
  p.end();
  const s = col.finish();
  console.log('· fixture ' + FX + ': rows ' + s.rows + ' · overlays ' + s.ovl + ' · addl ' + s.addl + ' · types ' + s.types.map((x) => x.label + ' ×' + x.n + (x.addl ? ' (+' + x.addl + ' addl)' : '')).join(', '));
  console.log('  hosts ' + JSON.stringify(s.hosts) + ' · first sample ' + JSON.stringify(s.types[0] && s.types[0].samples[0]).slice(0, 300));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
