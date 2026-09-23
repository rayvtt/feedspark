#!/usr/bin/env node
/*
 * GOLDEN RECORD SNAPSHOT IN THE BRAND DOSSIER (Ray, 16 Sep 2026).
 *
 *   "bring the golden record report entirely over to brand[ dossier] as well, maybe in a pop-up
 *    snapshot similar to the retainer pop-up. Locate it somewhere inside brand dossier."
 *
 * One read of /api/golden/estate — the same goldenidx the /golden module renders from, so a
 * figure in the dossier and a figure in the module can never disagree.
 *
 * THE RULE THIS PINS HARDEST: a market nobody has scanned is NOT a zero. Averaging an unscanned
 * market in as 0 reports a healthy brand as failing; averaging it as 100 hides a real gap. It is
 * named as unscanned and left out of every average.
 *
 * Run: node tools/test_goldensnap.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CC = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');
const GR = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_GoldenRecord.html'), 'utf8');
const WK = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
function liftVar(src, name) {
  const re = new RegExp('var ' + name + '=\\{[\\s\\S]*?\\n?\\s*\\};');
  const m = src.match(re);
  if (!m) throw new Error('not found: var ' + name);
  return m[0];
}
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced: ' + name);
}

// the real estate shape the worker serves, including a market that has never been scanned
const FEEDS = {
  'Reiss|gb': { client: 'Reiss', mkt: 'gb', score: 89, q: 82, ai: 2, air: 71, airTier: 2, reqMissing: [], condMissing: ['gtin'], status: 'ok', nCrit: 0, nWarn: 1 },
  'Reiss|us': { client: 'Reiss', mkt: 'us', score: 74, q: 68, ai: 1, air: 64, airTier: 1, reqMissing: ['gtin', 'brand'], status: 'crit', nCrit: 2, nWarn: 0 },
  'Reiss|de': { client: 'Reiss', mkt: 'de', status: 'never' },
  'Schuh|gb': { client: 'Schuh', mkt: 'gb', score: 95, q: 91, ai: 4, status: 'ok' },
};
const api = new Function('GRC', 'esc', 'fmtN', `
  ${lift(CC, 'grRows')} ${lift(CC, 'grAvg')} ${lift(CC, 'auditBand')} ${lift(CC, 'grBand')}
  ${liftVar(CC, 'GR_COL')} ${lift(CC, 'grRing')}
  ${(CC.match(/var GR_MROWS=\d+;/) || [''])[0]}
  ${lift(CC, 'grPill')} ${lift(CC, 'grMiniRow')} ${lift(CC, 'portGolden')}
  return { grRows:grRows, grAvg:grAvg, grBand:grBand, portGolden:portGolden };
`)({ feeds: FEEDS }, (x) => String(x), (n) => String(n));

console.log('\n-- the brand’s own markets, and only those --');
const rows = api.grRows('Reiss');
ok('every market for the brand is picked up', rows.length === 3, rows.map((r) => r.m));
ok('another brand never leaks in', !rows.some((r) => r.m === 'gb' && r.score === 95),
   rows.map((r) => [r.m, r.score]));
ok('a brand with no feeds gets nothing', api.grRows('Nobody').length === 0);
ok('markets are ordered', rows.map((r) => r.m).join(',') === 'de,gb,us', rows.map((r) => r.m));

console.log('\n-- UNSCANNED IS NOT ZERO --');
ok('the unscanned market is present, not dropped', rows.some((r) => r.m === 'de'));
ok('…and carries no score rather than a 0', rows.find((r) => r.m === 'de').score === null,
   rows.find((r) => r.m === 'de'));
ok('the average is of the SCANNED markets only', api.grAvg(rows, 'score') === 82, api.grAvg(rows, 'score'));
ok('…which is not what counting it as zero would give', api.grAvg(rows, 'score') !== 54);
ok('content quality averages the same way', api.grAvg(rows, 'q') === 75, api.grAvg(rows, 'q'));
ok('AI readiness too', api.grAvg(rows, 'air') === 68, api.grAvg(rows, 'air'));
ok('an all-unscanned brand averages to null, never 0',
   api.grAvg([{ score: null }, { score: null }], 'score') === null);

console.log('\n-- the band card --');
const card = api.portGolden('Reiss');
ok('the card renders', /Golden Record/.test(card));
ok('it leads with the average', /avg 82\/100/.test(card), card.slice(0, 120));
ok('it counts required attributes missing across the brand', /<b>2<\/b><span>req gaps/.test(card),
   card.match(/req gaps/));
ok('it says how many markets are unscanned', /<b>1<\/b><span>unscanned/.test(card)
   && /1 market never scanned/.test(card));
ok('it offers the full snapshot', /data-gr="Reiss"/.test(card));
ok('a brand with no Golden Record feeds renders nothing at all', api.portGolden('Nobody') === '');
{
  const none = new Function('GRC', 'esc', 'fmtN', `
    ${lift(CC, 'grRows')} ${lift(CC, 'grAvg')} ${lift(CC, 'auditBand')} ${lift(CC, 'grBand')}
    ${liftVar(CC, 'GR_COL')} ${lift(CC, 'grRing')}
  ${(CC.match(/var GR_MROWS=\d+;/) || [''])[0]}
  ${lift(CC, 'grPill')} ${lift(CC, 'grMiniRow')} ${lift(CC, 'portGolden')}
    return portGolden;`)({ feeds: { 'X|gb': { client: 'X', mkt: 'gb', status: 'never' } } },
    (x) => String(x), (n) => String(n))('X');
  ok('a brand wired but never scanned says so instead of showing a 0',
     /no market scanned yet/.test(none) && !/avg 0/.test(none), none.slice(0, 160));
}

console.log('\n-- bands are the module’s own --');
// the FCC-wide audit legend (Ray, 23 Sep 2026): <70 red · 70–85 orange · 85–95 yellow · 95+ green
ok('95+ is green (good)', api.grBand(95) === 'good' && api.grBand(100) === 'good');
ok('85–95 is yellow (mid)', api.grBand(85) === 'mid' && api.grBand(94.9) === 'mid');
ok('70–85 is orange (warn)', api.grBand(70) === 'warn' && api.grBand(84.9) === 'warn');
ok('under 70 is red (bad)', api.grBand(69.9) === 'bad' && api.grBand(0) === 'bad');
ok('no score has no band', api.grBand(null) === '');

console.log('\n-- the popup --');
ok('it exists', /function grOpen\(/.test(CC));
ok('Esc closes it', /function grKey\(ev\)\{ if\(ev\.key==='Escape'\)grClose\(\)/.test(CC));
ok('the backdrop closes it', /grm-bg'\)\.onclick=grClose/.test(CC));
ok('it links into the module for the same brand', /\/golden\?client='\+encodeURIComponent\(name\)/.test(CC));
ok('it names the unscanned markets in the table', /not scanned<\/td>/.test(CC));
ok('it states the unscanned rule in plain words', /never counted as zero/.test(CC));
ok('it is opened by delegation, so a re-render keeps working', /closest\('\[data-gr\]'\)/.test(CC));
ok('one popup at a time', /function grOpen\(name\)\{\s*grClose\(\);/.test(CC));

console.log('\n-- the read is shared and expires like the rest of the band --');
ok('it reads the estate endpoint', /\/api\/golden\/estate/.test(CC));
ok('the worker serves it', /path === '\/api\/golden\/estate'/.test(WK));
ok('one read serves every brand', /GRC=\(j&&j\.feeds\)/.test(CC));
ok('it has a freshness stamp', /PSTAMP=\{briefs:0,alerts:0,kw:0,gr:0\}/.test(CC));
ok('…and is expired by the refresh', /PSTAMP\.kw=PSTAMP\.gr=0/.test(CC));
ok('a failed refresh keeps the last good data', /GRC\|\|\{feeds:\{\}\}/.test(CC));

console.log('\n-- /golden honours ?client= like its sibling guards --');
// the literal string used to run straight through; the per-brand collapse (17 Sep 2026) now
// splices a conditional " collapsed" class in between the two halves — same markup, split source
ok('estate cards carry their client', /class="est-card[\s\S]{0,60}" data-client="/.test(GR));
ok('it reads ?client=', /\[\?&\]client=\(\[\^&\]\+\)/.test(GR));
ok('it scrolls to the brand', /scrollIntoView/.test(GR));
ok('the name is folded', /replace\(\/\[\^a-z0-9\]\/g,''\)/.test(GR));
ok('nothing is hidden on a guard page', !/display:none[\s\S]{0,40}est-card/.test(GR));
ok('it gives up rather than spinning', /tries<20/.test(GR));

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
