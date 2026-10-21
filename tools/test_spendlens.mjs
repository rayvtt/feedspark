#!/usr/bin/env node
/*
 * SPEND LENS — the engine, and the wiring that carries it (Ray, 19 Oct 2026, sending the Field
 * Breakdown pivot for Reiss UK: "can you bring in Playbook - a few interesting RoAS improvement or
 * spend optiimser tactics from field breakdown ? … you can see on RoAS avg: Textured, Striped,
 * Checked, Colourblock has way better ROAS compared to Plain where most Spend is at").
 *
 * The fixture is the SHAPE of Ray's own screenshot — a pattern cut whose money sits on the value
 * that returns least while four values return far more on very little — with INVENTED figures:
 * no client's spend or revenue is committed to this repository.
 *
 * Run: node tools/test_spendlens.mjs
 */
import * as SL from '../cloudflare/feedspark-deck/src/spendlens.js';
import * as ROAS from '../cloudflare/feedspark-deck/src/roas.js';
import { readFileSync } from 'fs';

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const is = (n, a, b) => ok(n + ' = ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b), a);

// a roas_dashboard row as FeedHero prints one, through the SAME normaliser the worker uses
const R = (cat, spend, rev, clicks) => ROAS.normRow({ cmpid: 'c1', category: cat, spend: '£' + spend.toFixed(2),
  revenue: '£' + rev.toFixed(2), clicks: String(clicks), impressions: String(clicks * 20), skus: '40', roas: ((rev / (spend || 1)) * 100).toFixed(2) + '%' });

// the shape Ray screenshotted: most of the money on the weakest value, four strong ones starved
const PATTERN = [
  R('Plain', 22894, 353_000, 70000),
  R('Knitted', 1498, 22980, 5000),
  R('Textured', 664, 10904, 2400),
  R('Quilted', 509, 15150, 1800),
  R('Colourblock', 198, 6617, 700),
  R('Striped', 320, 6170, 1100),
  R('Woven', 404, 3527, 1300),
  R('Dust', 140, 0, 400),            // spend, nothing back
  R('Speck', 3, 90, 9),              // too little traffic to judge — counted, never ranked
  ROAS.normRow({ cmpid: 'c1', category: 'Unlisted SKUs in Ads traffic', spend: '£30147.00', revenue: '£120000.00', clicks: '40000' }),
];

console.log('\n1) one cut, read as a whole');
const r = SL.cutRead('Colour', PATTERN);
ok('the read stands', r.ok, r);
is('one currency, named', r.cur, '£');
ok('the unlisted row is kept OUT of the cut — it is not a value anyone chose',
  r.spend === 26630 && r.list.every((x) => !/unlisted/i.test(x.v)), [r.spend, r.list.map((x) => x.v)]);
ok('…and reported on its own', r.unlisted && r.unlisted.spend === 30147, r.unlisted);
ok('the blended return is worked out from the rows shown, not read off a field',
  Math.abs(r.blended - (r.rev / r.spend) * 100) < 0.01, [r.blended, r.rev, r.spend]);
ok('a value with too little traffic is counted, never ranked', r.thin === 1 && !r.solid.some((x) => x.v === 'Speck'), [r.thin, r.solid.map((x) => x.v)]);
ok('the biggest spender leads the list', r.list[0].v === 'Plain', r.list.map((x) => x.v));

console.log('\n2) money never crosses a currency');
const mixed = [R('A', 100, 300, 500), ROAS.normRow({ cmpid: 'c1', category: 'B', spend: '€200.00', revenue: '€900.00', clicks: '900' })];
const mr = SL.cutRead('Colour', mixed);
ok('a cut reporting in two currencies is refused', !mr.ok, mr);
ok('…and the refusal says which two', /£/.test(mr.why) && /€/.test(mr.why), mr.why);

console.log('\n3) the category cut is a tree, so only its top level is compared');
const tree = [R('Women', 1000, 3000, 4000), R('Women > Dresses', 600, 2400, 2500), R('Men', 400, 800, 1500)];
const tr = SL.cutRead('Category', tree);
is('the deeper level is left out rather than counted twice', tr.spend, 1400);
is('…and the page is told how many rows that was', tr.treeTrimmed, 1);
ok('any other cut keeps every value', SL.cutRead('Brand', tree).spend === 2000, SL.cutRead('Brand', tree).spend);

console.log('\n4) the findings — Ray’s own reading of the pivot');
const f = SL.cutFindings(r, 'GB');
const star = f.find((x) => x.k === 'starved'), lag = f.find((x) => x.k === 'laggard'), dead = f.find((x) => x.k === 'dead');
ok('the starved winners are named', !!star, f.map((x) => x.k));
ok('…and they are the ones that really beat the field', star.vals.every((v) => v.roas >= r.blended * SL.SL_WIN), star.vals.map((v) => [v.v, v.roas]));
ok('…each carrying a sliver of the spend', star.vals.every((v) => v.share <= SL.SL_SMALL), star.vals.map((v) => v.share));
ok('…and none of them is the thin one', !star.vals.some((v) => v.v === 'Speck'), star.vals.map((v) => v.v));
ok('the concentration on the weakest value is named', !!lag && lag.vals[0].v === 'Plain', lag && lag.head);
ok('…with its share and the REST of the field’s return beside it, not a blend it dominates',
  /86%/.test(lag.head) && /rest of the field returns/.test(lag.ev)
  && lag.rest.roas > lag.vals[0].roas && lag.rest.roas > r.blended, [lag.head, lag.ev, lag.rest]);
ok('spend that returned nothing is its own finding', !!dead && dead.vals[0].v === 'Dust', dead && dead.head);
ok('the swing is arithmetic on two readings, both on screen',
  star.swing && star.swing.fromV === 'Plain' && Math.abs(star.swing.mv - 2289.4) < 1
  && star.swing.to > star.swing.from, star.swing);
ok('findings are ranked by the money at stake', f[0].worth >= f[f.length - 1].worth, f.map((x) => [x.k, x.worth]));

console.log('\n5) nothing is proposed without evidence');
const flat = [R('A', 1000, 3000, 5000), R('B', 900, 2700, 4500), R('C', 800, 2400, 4000)];
const fr = SL.cutRead('Brand', flat);
is('a cut where every value returns the same raises nothing', SL.cutFindings(fr, 'GB').length, 0);
const none = SL.cutRead('Brand', [R('A', 0, 0, 0)]);
ok('a cut with no spend at all is refused with its reason', !none.ok && /no value/.test(none.why), none);

console.log('\n6) the whole account');
const lens = SL.accountLens(
  [{ market: 'gb', cmpid: 'c1', spend: 26630, cur: '£', unlisted: { spend: 30147, rev: 120000, cur: '£' } },
   { market: 'de', cmpid: 'c2', spend: 400, cur: '€' }],
  { 'gb|Colour': { rows: PATTERN, at: 1 }, 'gb|Brand': { rows: flat, at: 1 }, 'gb|Gender': { missing: true } });
ok('a cut nobody has read is NAMED, never read as nothing wrong',
  lens.toRead.some((t) => t.market === 'gb' && t.agg === 'Price_type') && lens.toRead.some((t) => t.market === 'de'), lens.toRead.length);
ok('a cut FeedHero has not set up is an answer, with its reason',
  lens.refused.some((x) => x.agg === 'Gender' && /not set this cut up/.test(x.why)), lens.refused);
ok('the unlisted spend is the market’s own finding, raised once',
  lens.top.filter((x) => x.k === 'unlisted').length === 1, lens.top.map((x) => x.k));
ok('one finding of a kind per market leads, the rest ride with it',
  new Set(lens.top.map((x) => x.market + '|' + x.k)).size === lens.top.length, lens.top.map((x) => x.market + '|' + x.k));
ok('every finding names the market it is about', lens.top.every((x) => x.market), lens.top);

console.log('\n7) the brief says what the finding says');
const b = SL.briefOf(star, 'Reiss');
ok('the task names the account and the market', /Reiss GB/.test(b.task) && /Spend Lens/.test(b.task), b.task);
ok('the scope carries the evidence verbatim', b.scope.indexOf(star.ev) >= 0, b.scope);
ok('…and says the swing is arithmetic, not a forecast', /not a forecast/.test(b.scope), b.scope);
ok('an unlisted finding briefs as technical work',
  SL.briefOf(lens.top.find((x) => x.k === 'unlisted'), 'Reiss').cat === 'technical');

console.log('\n8) the wiring — route, rail, and no client figures in git');
const wk = readFileSync('cloudflare/feedspark-deck/src/worker.js', 'utf8');
ok('the worker imports the engine', /import \* as SL from "\.\/spendlens\.js"/.test(wk));
ok('the route is there, GET and POST', /path === '\/api\/spendlens' && \(request\.method === 'GET' \|\| request\.method === 'POST'\)/.test(wk));
// the GET half is everything after the POST branch closes — it must touch no MCP call at all,
// or opening the Playbook would quietly spend on every account somebody looked at
{
  const body = (wk.split("path === '/api/spendlens'")[1] || '').split("if (path === '/api/testlab'")[0];
  const getHalf = body.split('const reads = {}, unl = {};')[1] || '';
  const postHalf = body.split('const reads = {}, unl = {};')[0] || '';
  ok('the GET half never calls the MCP — it reads only what is already stored',
    !!getHalf && getHalf.indexOf('mcp.call(') < 0 && getHalf.indexOf('roaslive:') > 0);
  ok('…and the MCP read is behind the POST', /request\.method === 'POST'/.test(postHalf) && postHalf.indexOf('mcp.call(') > 0);
  ok('the POST writes the same records /roas/live caches, so nothing is read twice',
    /expirationTtl: 86400/.test(postHalf) && /roaslive:/.test(postHalf));
  ok('…and skips a cut already read inside its six hours', /6 \* 3600000/.test(postHalf));
}
ok('it reads the SAME roaslive: records /roas/live writes — not a second store',
  /roaslive:' \+ m\.cmpid \+ ':' \+ agg/.test(wk));
ok('the ROAS index is read by the FeedHero company id, never a roster label',
  /ROAS\.windowTotal\(idx\[m\.cmpid\], win\)/.test(wk));
ok('it is scoped per signin like every other account route',
  /spendlens[\s\S]{0,900}clientMatch\(acc\.clients, who0\)/.test(wk));
ok('the brief is the engine’s words', /SL\.briefOf\(f, who0\)/.test(wk));
const pg = readFileSync('docs/FeedSpark_Workflow.html', 'utf8');
ok('the rail draws the section', /function secSpend\(/.test(pg) && /secActions\(BRAND\)\+secSpend\(BRAND\)/.test(pg));
ok('…and wires it', /wireSpend\(BRAND\)/.test(pg) && /function wireSpend\(/.test(pg));
ok('→ Brief goes through the page’s own composer, never a reload',
  /data-sl=/.test(pg) && /SLLIST\[\+b\.getAttribute\('data-sl'\)\][\s\S]{0,200}window\.FCCBrief/.test(pg));
ok('the section points at /breakdown for the fields FeedHero does not cut, on ITS own parameter',
  /\/breakdown\?brand='\+encodeURIComponent\(brand\)/.test(pg) && !/\/breakdown\?client=/.test(pg));
ok('no client spend or revenue is committed with the engine',
  !/£\s?\d{3,}|€\s?\d{3,}/.test(readFileSync('cloudflare/feedspark-deck/src/spendlens.js', 'utf8')));

console.log(fail ? '\nFAIL (' + fail + ')' : '\nPASS');
process.exit(fail ? 1 : 0);
