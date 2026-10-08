// SOCIAL DPA harness (pure node, CI-safe). Ray, 8 Oct 2026: "a new feature module for all social DPA
// optimization, especially Meta, Instagram, Pinterest, or TikTok ads … a preview of how it would look on each
// platform, side by side … fields can be dynamically scheduled based on the day, weather, customer behavior, or
// analytics. For example, a tagline could show the number of clicks over the past 30 days or the number of
// people who have viewed the product in the last 24 hours."
//
// Pins the engine (docs/social_engine.js): the platform frames and safe zones, what each network shows of a
// field, the button mapping, the token fill and its three honesty rules (a missing figure stands a rule down,
// a figure too small to be proof stands it down, every figure carries its source), every condition kind, the
// first-match-wins evaluation with a reason for every rule, the week grid, the ideas, the stored-setup
// sanitiser and the brief; then the Overlays studio's layout placed INSIDE each network's safe zone (nothing
// the overlay draws may sit under a network's own buttons); then the wiring — route, served engine, Text-module
// glob, grantable module, migration board + its page twin + its assessment row, shared-state namespace, the nav
// on every page, the stub and the gates.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MODULES, MODULE_PATHS } from '../cloudflare/feedspark-deck/src/access.js';
import { MIG_SEED } from '../cloudflare/feedspark-deck/src/migration.js';
import { STATE_NS, clientOfEntry } from '../cloudflare/feedspark-deck/src/sharedstate.js';
const require = createRequire(import.meta.url);
const SOC = require('../docs/social_engine.js');
const STU = require('../docs/overlay_studio_engine.js');
const { covered } = require('./check_textmodules.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), PG = read('docs/FeedSpark_Social.html'), TX = read('docs/FeedSpark_Transformation.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + (typeof why === 'string' ? why : JSON.stringify(why)) : '')); } };

const F = { title: 'Northwind Trail Runner', brand: 'Northwind', price: '£57.60', was: '£72', pct: 20, save: '£14.40', colour: 'Navy',
  clicks30: 1267, bought30: 55, views24: 312, stock: 6, __src: { views24: 'demo' } };
const SAT_EVE = { day: 6, hour: 20, dom: 10, date: '2026-10-10', weather: 'rain', temp: 4, audience: 'prospect' };
const TUE_AM = { day: 2, hour: 9, dom: 6, date: '2026-10-06', weather: 'sun', temp: 16, audience: 'prospect' };

console.log('· the networks');
t('six placements: FB Feed, IG Feed, IG Stories, IG Reels, Pinterest, TikTok', SOC.PLATFORMS.map((p) => p.id).join() === 'fb_feed,ig_feed,ig_story,ig_reels,pinterest,tiktok');
t('frames: 1:1, 4:5, 9:16, 9:16, 2:3, 9:16', SOC.PLATFORMS.map((p) => p.ratio.join(':')).join() === '1:1,4:5,9:16,9:16,2:3,9:16');
t('a 9:16 frame at 1080 wide is 1920 tall', SOC.frame('tiktok', 1080).h === 1920 && SOC.frame('pinterest', 1000).h === 1500);
t('Stories keep 14% top / 20% bottom clear; Reels 35% at the bottom; 6% each side', (() => { const s = SOC.platformById('ig_story').safe, r = SOC.platformById('ig_reels').safe; return s.t === 0.14 && s.b === 0.2 && r.b === 0.35 && s.l === 0.06 && r.r === 0.06; })());
t('TikTok keeps its right-hand rail clear (wider right margin than left)', SOC.platformById('tiktok').safe.r > SOC.platformById('tiktok').safe.l);
t('the feed placements have no safe zone — the whole frame is the creative', SOC.safeRect('fb_feed', 1000, 1000).w === 1000 && SOC.safeRect('fb_feed', 1000, 1000).y === 0);
t('the safe rectangle of Reels at 1080×1920: 65px in, 269px down, 979px tall', (() => { const r = SOC.safeRect('ig_reels', 1080, 1920); return r.x === 65 && r.y === 269 && r.h === 979 && r.w === 950; })(), SOC.safeRect('ig_reels', 1080, 1920));
t('every network links its own spec page (https)', SOC.PLATFORMS.every((p) => /^https:\/\//.test(p.guide)));
t('the page says the figures are a GUIDE to confirm in each network’s preview', /a guide to confirm in each network/.test(PG));

console.log('· what each network shows of a field');
{
  const long = 'Northwind Trail Runner — Recycled Mesh, Navy';     // 44 characters, the demo title
  const fb = SOC.fitField('fb_feed', 'headline', long);
  t('FB Feed shows 27 of a headline, cut with an ellipsis', fb.cut && fb.text.length <= 27 && /…$/.test(fb.text), fb.text);
  t('…and a 44-character headline is OVER the 40 Meta accepts — said, not hidden', fb.over && /over the 40/.test(fb.why));
  t('a short headline fits untouched', (() => { const x = SOC.fitField('ig_feed', 'headline', 'Trail Runner'); return !x.cut && !x.over && x.text === 'Trail Runner'; })());
  t('TikTok has no headline slot — and says so rather than dropping it silently', (() => { const x = SOC.fitField('tiktok', 'headline', 'x'); return x.has === false && /no Headline slot/.test(x.why); })());
  t('TikTok ad text: 100 characters', SOC.platformById('tiktok').fields.primary.max === 100);
  t('Pinterest title: 100 max, about 40 shown', SOC.platformById('pinterest').fields.headline.max === 100 && SOC.platformById('pinterest').fields.headline.shown === 40);
  t('whitespace is collapsed before counting', SOC.fitField('ig_feed', 'headline', '  a   b ').len === 3);
}
console.log('· buttons');
t('a button the network offers comes back as itself', SOC.ctaFor('fb_feed', 'shop now').text === 'Shop now' && SOC.ctaFor('fb_feed', 'shop now').same);
t('Pinterest has no “Shop now” — mapped to its nearest, with the reason', (() => { const c = SOC.ctaFor('pinterest', 'Shop now'); return !c.same && c.text === 'Shop' && /Pinterest offers no/.test(c.why); })());
t('TikTok has no “Get offer” — mapped to a shop/buy button', /Shop now|Buy now/.test(SOC.ctaFor('tiktok', 'Get offer').text));

console.log('· tokens: the three honesty rules');
t('a template fills from the product', SOC.fill('{clicks30} clicks in the last 30 days', F, TUE_AM).text === '1,267 clicks in the last 30 days');
t('RULE 1 — a figure the product does not have stands the template down (no "{views24}", no "0")', (() => { const r = SOC.fill('{views24} viewed today', Object.assign({}, F, { views24: null }), {}); return !r.ok && r.text === '' && /not measured/.test(r.why); })());
t('RULE 2 — a figure too small to be proof stands it down: 3 views, 2 bought', (() => { const a = SOC.fill('{views24} viewed', Object.assign({}, F, { views24: 3 }), {}), b = SOC.fill('{bought30} bought', Object.assign({}, F, { bought30: 2 }), {}); return !a.ok && /under the 10/.test(a.why) && !b.ok && /under the 3/.test(b.why); })());
t('…and a stock figure above the scarcity ceiling is not “Only 5044 left”', (() => { const r = SOC.fill('Only {stock} left', Object.assign({}, F, { stock: 5044 }), {}); return !r.ok && /not scarcity/.test(r.why); })());
t('…out of stock is not scarcity either', !SOC.fill('Only {stock} left', Object.assign({}, F, { stock: 0 }), {}).ok);
t('…a 3% discount is under the 5% floor', !SOC.fill('{pct}% off', Object.assign({}, F, { pct: 3 }), {}).ok);
t('RULE 3 — every figure carries its source: Google Ads, feed, demo', (() => { const r = SOC.fill('{clicks30} {price} {views24}', F, {}); return r.srcs.clicks30 === 'ads' && r.srcs.price === 'feed' && r.srcs.views24 === 'demo'; })());
t('the page’s own source can override the token default (a demo product is all demo)', SOC.fill('{title}', Object.assign({}, F, { __src: { title: 'demo' } }), {}).srcs.title === 'demo');
t('the moment fills too: day, weather, temperature', SOC.fill('{day}, {weather}, {temp}', F, SAT_EVE).text === 'Saturday, rainy, 4°');
t('large numbers are compact: 23,400 → 23k, 1,267 stays 1,267', SOC.compact(23400) === '23k' && SOC.compact(1267) === '1,267');
t('an unknown token is refused, never printed', !SOC.fill('{nope}', F, {}).ok);
t('Meta catalogue keywords: {title} → {{product.name}}, {price} → {{product.current_price}}', SOC.metaTemplate('{title} — {price}').text === '{{product.name}} — {{product.current_price}}');
t('…a field Meta has no keyword for is named as needing a feed rule', SOC.metaTemplate('{clicks30} clicks').feedRule.join() === 'clicks30');

console.log('· conditions');
const C = (c, ctx, f) => SOC.condMatch(c, ctx, f || F).ok;
t('day of week', C({ k: 'day', v: [5, 6, 0] }, SAT_EVE) && !C({ k: 'day', v: [5, 6, 0] }, TUE_AM));
t('hours, including a window across midnight (22:00–06:00)', C({ k: 'hours', from: 17, to: 23 }, SAT_EVE) && !C({ k: 'hours', from: 17, to: 23 }, TUE_AM) && C({ k: 'hours', from: 22, to: 6 }, { hour: 2 }) && !C({ k: 'hours', from: 22, to: 6 }, { hour: 12 }));
t('day of month (payday 25th–28th), and one across the month end', C({ k: 'dom', from: 25, to: 28 }, { dom: 26 }) && !C({ k: 'dom', from: 25, to: 28 }, { dom: 10 }) && C({ k: 'dom', from: 28, to: 2 }, { dom: 1 }));
t('date range (a campaign window)', C({ k: 'dates', from: '2026-11-20', to: '2026-11-30' }, { date: '2026-11-27' }) && !C({ k: 'dates', from: '2026-11-20', to: '2026-11-30' }, { date: '2026-12-01' }));
t('weather', C({ k: 'weather', v: ['rain', 'wind'] }, SAT_EVE) && !C({ k: 'weather', v: ['rain'] }, TUE_AM));
t('temperature, and a moment with no temperature does not match', C({ k: 'temp', op: '<=', v: 5 }, SAT_EVE) && !C({ k: 'temp', op: '<=', v: 5 }, TUE_AM) && !C({ k: 'temp', op: '<=', v: 5 }, {}));
t('shopper audience', C({ k: 'audience', v: ['carted'] }, { audience: 'carted' }) && !C({ k: 'audience', v: ['carted'] }, SAT_EVE));
t('a product number, and a number the product does not have does not match', C({ k: 'metric', m: 'clicks30', op: '>=', v: 100 }, {}) && !C({ k: 'metric', m: 'clicks30', op: '>=', v: 100 }, {}, { clicks30: 40 }) && !C({ k: 'metric', m: 'views24', op: '>=', v: 1 }, {}, {}));
t('every condition has a label', ['day', 'hours', 'dom', 'dates', 'weather', 'temp', 'audience', 'metric'].every((k) => SOC.condLabel(SOC.cleanCond({ k: k, v: k === 'day' ? [1] : k === 'weather' ? ['rain'] : k === 'audience' ? ['viewed'] : 3, m: 'clicks30', from: 1, to: 2 }))));

console.log('· evaluate: first match wins, every rule says why');
{
  const st = SOC.defaultSetup();
  const sat = SOC.evaluate(st, F, SAT_EVE), tue = SOC.evaluate(st, F, TUE_AM), tueEve = SOC.evaluate(st, F, Object.assign({}, TUE_AM, { hour: 20 }));
  t('Saturday evening: the weekend offer wins the tagline', sat.fields.tagline.text === 'Weekend offer — 20% off', sat.fields.tagline);
  t('…the evening rule matched too, and says an earlier rule won', sat.trace[1].state === 'shadowed' && /earlier/.test(sat.trace[1].why));
  t('Tuesday evening: live interest (views in 24 hours)', tueEve.fields.tagline.text === '312 people viewed this today', tueEve.fields.tagline);
  t('Tuesday morning: 30-day clicks', tue.fields.tagline.text === '1,267 clicks in the last 30 days');
  t('…the weekend rule says why it is not showing ("not Fri/Sat/Sun")', tue.trace[0].state === 'nomatch' && /Fri/.test(tue.trace[0].why));
  t('no views figure on Tuesday evening → the views rule is not a match and 30-day clicks show instead', SOC.evaluate(st, Object.assign({}, F, { views24: null }), Object.assign({}, TUE_AM, { hour: 20 })).fields.tagline.text === '1,267 clicks in the last 30 days');
  t('a rule whose template cannot fill STANDS DOWN (refused) and the next applies', (() => {
    const s2 = { defaults: SOC.DEFAULTS, rules: [{ id: 'a', field: 'tagline', value: '{views24} viewed', when: [] }, { id: 'b', field: 'tagline', value: '{clicks30} clicks', when: [] }] };
    const e = SOC.evaluate(s2, Object.assign({}, F, { views24: 4 }), TUE_AM); return e.trace[0].state === 'refused' && e.fields.tagline.id === 'b'; })());
  t('the basket audience gets the harder button and the retargeting copy', (() => { const e = SOC.evaluate(st, F, Object.assign({}, TUE_AM, { audience: 'carted' })); return e.fields.cta.text === 'Buy now' && /Still thinking/.test(e.fields.primary.text); })());
  t('a prospect gets the defaults: “Shop now” and the default primary text', tue.fields.cta.text === 'Shop now' && tue.fields.cta.def && tue.fields.primary.text === 'Shop Northwind Trail Runner from Northwind — £57.60.');
  t('a switched-off rule never sets a field', (() => { const s3 = SOC.cleanSetup(st); s3.rules[0].on = false; return SOC.evaluate(s3, F, SAT_EVE).fields.tagline.text !== 'Weekend offer — 20% off'; })());
  t('no tagline rule matching + an empty default = NO tagline (the image stays clean)', SOC.evaluate({ defaults: SOC.DEFAULTS, rules: [] }, F, TUE_AM).fields.tagline.text === '');
  t('a default that cannot fill is empty and says why — never a template on the ad', (() => { const e = SOC.evaluate({ defaults: Object.assign({}, SOC.DEFAULTS, { headline: '{views24} viewed' }), rules: [] }, Object.assign({}, F, { views24: null }), TUE_AM); return e.fields.headline.text === '' && /not measured/.test(e.fields.headline.why); })());
}

console.log('· the week at a glance');
{
  const g = SOC.weekGrid(SOC.defaultSetup(), F, TUE_AM, 'tagline');
  t('seven days, Monday first, five dayparts each', g.length === 7 && g[0].name === 'Monday' && g[6].name === 'Sunday' && g.every((r) => r.cells.length === 5));
  t('the opening schedule takes three turns across a week — not one message seven days', SOC.weekVariety(g) === 3, SOC.weekVariety(g));
  t('Friday is the weekend offer at every daypart; Monday evening is live interest', g[4].cells.every((c) => /Weekend/.test(c.text)) && /viewed/.test(g[0].cells[3].text));
  t('a week grid can be read for the button too', SOC.weekGrid(SOC.defaultSetup(), F, Object.assign({}, TUE_AM, { audience: 'carted' }), 'cta')[0].cells[0].text === 'Buy now');
}

console.log('· ideas');
t('a dozen ready-made rules, each with a blurb and what it needs', SOC.IDEAS.length >= 10 && SOC.IDEAS.every((d) => d.blurb && d.needs && SOC.FIELDS.indexOf(d.field) >= 0));
t('the ideas cover day, hours, payday, weather, temperature, audience and product numbers', ['day', 'hours', 'dom', 'weather', 'temp', 'audience', 'metric'].every((k) => SOC.IDEAS.some((d) => d.when.some((c) => c.k === k))));
t('the two Ray named are there: 30-day clicks and 24-hour views', !!SOC.ideaById('proof30') && /clicks30/.test(SOC.ideaById('proof30').value) && /views24/.test(SOC.ideaById('hot24').value));
t('…and the 24-hour idea says it is NOT wired (a demo figure)', /not wired/.test(SOC.ideaById('hot24').needs));
t('a rule from an idea is a copy — editing it never edits the idea', (() => { const r = SOC.ruleFromIdea(SOC.ideaById('weekend'), 'x'); r.when[0].v.push(1); return SOC.ideaById('weekend').when[0].v.length === 3; })());

console.log('· a stored setup is somebody else\'s input');
{
  const dirty = { defaults: { headline: 'H'.repeat(900), cta: 'Shop now', evil: 1 }, rules: [{ id: 'a<b>', field: 'tagline', value: 'x', when: [{ k: 'day', v: [9, 2, -1] }, { k: 'metric', m: 'title', v: 1 }, { k: 'bogus' }, { k: 'hours', from: 30, to: -4 }] }, { field: 'nope' }],
    plat: { tiktok: { img: 99, design: 'pill badge!', cta: 'Buy now' }, myspace: { img: 1 } }, tagPos: 'x', tagStyle: 'neon', imgMode: 'per' };
  const c = SOC.cleanSetup(dirty);
  t('a 900-character default is clipped to 300; an unknown default key dropped', c.defaults.headline.length === 300 && !('evil' in c.defaults));
  t('a rule with an unknown field is dropped; an id is reduced to safe characters', c.rules.length === 1 && c.rules[0].id === 'ab');
  t('conditions: days outside 0–6 dropped, a non-numeric metric and an unknown kind dropped, hours clamped', (() => { const w = c.rules[0].when; return w.length === 2 && w[0].v.join() === '2' && w[1].from === 23 && w[1].to === 0; })(), c.rules[0].when);
  t('per-network: only known networks, image index clamped, design id stripped', !c.plat.myspace && c.plat.tiktok.img === 10 && c.plat.tiktok.design === 'pillbadge');
  t('tagline position / style fall back to known values', c.tagPos === 'b' && c.tagStyle === 'dark' && c.imgMode === 'per');
  t('nothing stored at all → the opening schedule', SOC.cleanSetup(null).rules.length === SOC.defaultSetup().rules.length);
  t('a clean setup round-trips unchanged', JSON.stringify(SOC.cleanSetup(SOC.cleanSetup(SOC.defaultSetup()))) === JSON.stringify(SOC.cleanSetup(SOC.defaultSetup())));
}

console.log('· the brief');
{
  const L = SOC.briefLines(SOC.defaultSetup(), { client: 'Northwind', market: 'gb-fb' });
  t('names the client + market, the defaults and every rule that is on', /Northwind GB-FB/.test(L[0]) && L.some((l) => /^Defaults:/.test(l)) && L.filter((l) => /^\d+\. /.test(l)).length === 5);
  t('says when each rule applies and where its data comes from', L.some((l) => /when: Fri · Sat · Sun AND % off ≥ 10/.test(l)) && L.some((l) => /\{views24\} demo/.test(l)) && L.some((l) => /\{clicks30\} ads/.test(l)));
  t('says how a headline/primary rule reaches Meta: native keywords or a feed rule', L.some((l) => /Meta: native catalogue keywords|Meta: needs a feed field/.test(l)));
  t('closes on the honesty rule', /no ad ever prints a missing or too-small number/.test(L[L.length - 1]));
}

console.log('· the overlay sits INSIDE each network\'s safe zone (the Overlays studio\'s own geometry)');
{
  const des = STU.designById('full-house');
  const res = { sale_pct: { ok: true, text: '20% OFF' }, low_stock: { ok: true, text: 'Selling fast' }, free_del: { ok: true, text: 'FREE DELIVERY' }, price_now: { ok: true, text: '£57.60' }, clicks: { ok: true, text: '1,267 clicks in 30 days' }, __tag: { ok: true, text: '312 people viewed this today' } };
  const zones = des.zones.concat([{ at: 'b', as: 'bar', fact: '__tag', size: 'sm', fg: '#fff', bg: '#000' }]);
  let ok = true, bad = '';
  SOC.PLATFORMS.forEach((p) => {
    const fr = SOC.frame(p.id, 1080), sr = SOC.safeRect(p.id, fr.w, fr.h);
    const L = STU.layout(STU.compose({ id: 'x', zones }, res, {}), sr.w, sr.h);
    L.boxes.filter((b) => b.text).forEach((b) => {
      const x = sr.x + b.x, y = sr.y + b.y;
      if (x < sr.x - 0.5 || y < sr.y - 0.5 || x + b.w > sr.x + sr.w + 0.5 || y + b.h > sr.y + sr.h + 0.5) { ok = false; bad = p.id + ':' + b.fact; }
    });
    if (STU.overlaps(L.boxes).length) { ok = false; bad = p.id + ' overlap'; }
  });
  t('every box of the busiest design + the tagline lies in the safe rectangle, none overlapping, on all six', ok, bad);
  t('the page lays the overlay out on the SAFE rectangle and translates it into place', /STU\.layout\(comp, sr\.w, sr\.h\)/.test(PG) && /g\.translate\(sr\.x, sr\.y\)/.test(PG));
}

console.log('· the page');
t('sources are labelled on screen: feed / Google Ads / demo / simulated', /class="sb demo"/.test(PG) && /simulated moment/.test(PG) && /'Google Ads'/.test(PG));
t('24-hour views are a DEMO figure, with what would make them real', /ViewContent or GA4/.test(PG));
t('the demo products are DRAWN in the page — no client picture on a demo', /function drawProduct\(/.test(PG) && /function demoShot\(/.test(PG));
t('a Meta catalogue market reads its Google market’s Ads report', /S\.mkt\.replace\(\/-fb\$\/, ''\)/.test(PG) && /period=30_days/.test(PG));
t('the schedule is the TEAM’s: shared state ns socialdpa, with a device mirror', /\/api\/state\?ns=socialdpa/.test(PG) && /fcc-soc-setup:/.test(PG));
t('every section folds: a tile per section, Fold all, per-device memory', (PG.match(/<section class="card[^"]*" id="sec-[a-z]+" data-fold>/g) || []).length === 7 && /id="fold-all"/.test(PG) && /fcc-soc-fold/.test(PG));
t('…the fold toggle sits inside the heading, so the phone skim view leaves it to the page', (PG.match(/<h3 class="fhw"><button class="fhd" type="button" aria-expanded=/g) || []).length === 7);
t('the shared demo images are never handed one onload each (a second caller would steal the first)', /im\.decode\(\)/.test(PG) && !/im\.onload = function \(\) \{ res\(im\); \}; im\.onerror/.test(PG));
t('every network can take its own picture, or an upload', /data-pimg/.test(PG) && /Upload…/.test(PG) && /imgMode === 'per'/.test(PG));
t('→ Brief carries the schedule into Workflow (cat technical)', /Social DPA - Dynamic schedule - /.test(PG) && /cat: 'technical'/.test(PG));
t('the overlay designs are the studio’s own (one catalogue, no copy)', /STU\.DESIGNS\.map/.test(PG) && !/var DESIGNS\s*=/.test(PG));

console.log('· wiring');
t('the page is served at /social', /'\/social':\s+\{ html: SOCIAL_PAGE, slug: 'social' \}/.test(WK) && /import SOCIAL_PAGE from "\.\.\/\.\.\/\.\.\/docs\/FeedSpark_Social\.html"/.test(WK));
t('the engine is served verbatim at /social/engine.js', /path === '\/social\/engine\.js'/.test(WK) && /new Response\(SOCIAL_ENGINE_SRC/.test(WK));
t('the engine is a Text module (the *_engine.js glob)', covered('docs/social_engine.js'));
t('a grantable module', MODULES.some((m) => m.slug === 'social' && m.path === '/social') && MODULE_PATHS['/social'] === 'social');
t('on the migration board + its page twin + an assessment row', MIG_SEED.some((m) => m.p === '/social') && /\{p:'\/social',n:'Social DPA',w:3/.test(TX) && /\{id:'social',p:'\/social'/.test(TX));
t('shared-state namespace socialdpa, keyed by the brand (scoped per signin)', STATE_NS.socialdpa === 'self' && clientOfEntry('socialdpa', 'Reiss', {}) === 'Reiss');
{
  const pages = fs.readdirSync(new URL('../docs/', import.meta.url)).filter((f) => /^FeedSpark_.*\.html$/.test(f) && read('docs/' + f).indexOf('tb-modules') >= 0);
  t('the nav carries /social on every nav-bearing page (' + pages.length + ')', pages.every((f) => read('docs/' + f).indexOf('href="/social" class="tbm') >= 0));
  t('…marked .on only on its own page', /href="\/social" class="tbm on"/.test(PG) && pages.filter((f) => /href="\/social" class="tbm on"/.test(read('docs/' + f))).length === 1);
}
t('the stub feeds the phone + dark tripwires', /require\('\.\/social_stub\.js'\)/.test(read('tools/check_mobile.js')) && /require\('\.\/social_stub\.js'\)/.test(read('tools/check_darkmode.js')));
t('the harness runs in qa_gate, presync and CI', /node tools\/test_social\.mjs/.test(read('tools/qa_gate.sh')) && /node tools\/test_social\.mjs/.test(read('tools/presync.sh')) && /run: node tools\/test_social\.mjs/.test(read('.github/workflows/validate.yml')));
t('the browser tripwire runs in presync', /node tools\/check_social\.js/.test(read('tools/presync.sh')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
