#!/usr/bin/env node
/*
 * THE PORTFOLIO BAND'S THREE WEAK TILES (Ray, 16 Sep 2026).
 *
 *   "Display this better as well. For example, at the moment only Activity and Health actually
 *    look good. The other three tiles are not well presented or beautifully designed with
 *    multiple elements yet."
 *
 * Hours, Feed audit and Golden Record were each a row of bare digits. They now carry a shape in
 * the same visual language Activity and Health already set — a consumption meter, per-market
 * score bars, a score ring — and this pins the parts a redesign is most likely to get wrong:
 *
 *   · an OVER-RUN must be drawn as the fill CROSSING the marked block, not as a bar that is
 *     merely full — "spent exactly the block" and "spent twice the block" cannot look the same;
 *   · SERVED (negative, and the team decided to keep going) keeps its own colour rather than
 *     borrowing red, because a deliberate decision is not an unhandled alarm — the hours
 *     widget's own rule, and the reason the popover never says STOP;
 *   · an UNSCANNED market keeps its row and its own hatched empty track. A zero-width bar in a
 *     score column reads as a score of nought, which is exactly the lie the Golden Record
 *     averaging rule exists to prevent.
 *
 * The functions are lifted out of the page by name, so the shipped code is what runs here.
 * Run: node tools/test_dossiertiles.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CC = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');
const HW = fs.readFileSync(path.join(ROOT, 'docs', 'hours_widget.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
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
function liftVar(src, name) {
  const re = new RegExp('var ' + name + '=\\{[\\s\\S]*?\\n?\\s*\\};');
  const m = src.match(re);
  if (!m) throw new Error('not found: var ' + name);
  return m[0];
}
const pct = (h) => {
  const m = /class="dzp-bar"[^>]*>\s*<i style="width:([\d.]+)%/.exec(h);
  return m ? Number(m[1]) : null;
};

/* ============================================================== HOURS ===================== */
// the record shape /api/hours serves, and the widget's own state rule — copied in intent, then
// asserted against the widget itself below so the two can never quietly diverge
const REC = {
  Healthy:  { tracked: true, allowance: 18, used: 8.25,  balance: 16.5, markets: 6, am: 'Ray' },
  Tight:    { tracked: true, allowance: 20, used: 17,    balance: 3,    markets: 2, am: 'Steven' },
  Over:     { tracked: true, allowance: 24, used: 31.5,  balance: -7.5, markets: 3 },
  Served:   { tracked: true, allowance: 24, used: 31.5,  balance: -7.5, markets: 3,
              posture: { state: 'continue', note: 'Renewal in Nov — carrying them through it', by: 'Ray' } },
  Held:     { tracked: true, allowance: 24, used: 40,    balance: -16,  markets: 3,
              posture: { state: 'hold' } },
  Untouched:{ tracked: false },
  Exact:    { tracked: true, allowance: 10, used: 10,    balance: 0,    markets: 1 },
};
function hoursState(r) {
  r = r || {};
  const posture = (r.posture && r.posture.state) || '', bal = Number(r.balance) || 0, allowance = Number(r.allowance) || 0;
  if (!r.tracked) return 'none';
  if (bal < 0) return posture === 'continue' ? 'served' : (posture === 'hold' ? 'held' : 'over');
  if (allowance > 0 && bal < allowance * 0.25) return 'tight';
  return 'ok';
}
const H = new Function('FCCHours', 'esc', 'fmtN', `
  var window={FCCHours:FCCHours};
  ${liftVar(CC, 'HRS_ST')} ${lift(CC, 'hrsMeter')} ${lift(CC, 'hrsN')} ${lift(CC, 'portHours')}
  return { hrsMeter:hrsMeter, hrsN:hrsN, portHours:portHours, HRS_ST:HRS_ST };
`)({
  rec: (n) => (REC[n] ? { name: n, rec: REC[n] } : null),
  state: hoursState,
  verdict: (r) => 'verdict for ' + hoursState(r),
}, (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
   (n) => String(n));

console.log('\n-- the meter: the block is the track until it is spent --');
ok('under the block, the fill is the share used', pct(H.hrsMeter(8.25, 18, '#15803D')) === 45.8,
   pct(H.hrsMeter(8.25, 18, '#15803D')));
ok('…and the end of the track IS the block, so no cap line is drawn',
   !/<u /.test(H.hrsMeter(8.25, 18, '#15803D')));
ok('spending the block exactly fills it', pct(H.hrsMeter(10, 10, '#15803D')) === 100);
ok('…and still draws no cap line, because the end of the bar is the cap',
   !/<u /.test(H.hrsMeter(10, 10, '#15803D')));

console.log('\n-- AN OVER-RUN CROSSES SOMETHING, it does not just look full --');
{
  const over = H.hrsMeter(31.5, 24, '#C0392B');
  ok('the track scales to what was actually spent, so the fill is full', pct(over) === 100);
  ok('the block is marked INSIDE the bar', /<u style="left:76\.2%"/.test(over), over.match(/<u [^>]*>/));
  ok('…and the mark names the figure it stands for', /title="Block: 24h"/.test(over));
  const worse = H.hrsMeter(48, 24, '#C0392B');
  ok('the worse the over-run, the earlier the block falls', /<u style="left:50%"/.test(worse),
     worse.match(/<u [^>]*>/));
  ok('so twice the block can never look like exactly the block',
     /<u /.test(worse) && !/<u /.test(H.hrsMeter(24, 24, '#C0392B')));
}
ok('a client with no block at all draws no meter rather than an empty one', H.hrsMeter(0, 0, '#15803D') === '');
ok('the caption states both figures in words', /8\.25h used[\s\S]*18h block/.test(H.hrsMeter(8.25, 18, '#15803D')));
ok('the bar is described for a screen reader', /aria-label="8\.25 hours used of a 18 hour block"/
   .test(H.hrsMeter(8.25, 18, '#15803D')));

console.log('\n-- the card: Health’s treatment, on the figure being decided --');
{
  const good = H.portHours('Healthy');
  ok('the balance is the big number', /class="dzp-hn"[^>]*>16\.5h</.test(good), good.match(/dzp-hn[^<]*<[^<]*/));
  ok('the state is a band pill, as on Health', /class="dzp-band good">Healthy</.test(good));
  ok('the meter is on the card', /dzp-meter/.test(good));
  ok('the foot carries what the meter does not — the book read and the AM',
     /6<\/em><span class="lb">markets synced/.test(good) && /Ray<\/em><span class="lb">AM/.test(good));
  ok('the used/block figures are not repeated in the foot as well',
     (good.match(/8\.25h/g) || []).length === 1, (good.match(/8\.25h/g) || []));
  ok('the popover anchor survives the redesign', /class="dzp-hrsn" data-hrs="Healthy"/.test(good));
  ok('the widget’s own verdict sentence is still printed, never re-worded here',
     /verdict for ok/.test(good));
}
ok('running tight is a warning, not a failure', /class="dzp-band watch">Running tight</.test(H.portHours('Tight')));
ok('negative is a failure', /class="dzp-band risk">Negative</.test(H.portHours('Over')));

console.log('\n-- RELATIONSHIP SMOOTHING KEEPS ITS OWN COLOUR --');
{
  const served = H.portHours('Served');
  ok('being served is its own band, not red', /class="dzp-band served">Being served</.test(served));
  ok('…and its own colour, not the risk colour', /color:#2F6FB0/.test(served) && !/#C0392B/.test(served));
  ok('the reason the team gave travels with it — that is the part the next AM needs',
     /Renewal in Nov/.test(served));
  ok('on hold IS red, because nothing has been decided in the account’s favour',
     /class="dzp-band risk">New work on hold</.test(H.portHours('Held')));
  ok('a state with no note prints no empty quote marks', !/dzp-why/.test(H.portHours('Over')));
}
ok('a client the sync has never read renders NOTHING — not a zero-hour card',
   H.portHours('Untouched') === '');
ok('a brand the hours book does not carry at all renders nothing', H.portHours('Nobody') === '');

console.log('\n-- the state vocabulary is the widget’s, not a second opinion --');
Object.keys(H.HRS_ST).forEach((k) => {
  ok('“' + k + '” is a state hours_widget.html actually returns',
     new RegExp("return '" + k + "'|\\? '" + k + "'|: '" + k + "'|'" + k + "' :").test(HW), k);
});
ok('every state the widget can return has a card treatment',
   ['ok', 'tight', 'over', 'served', 'held'].every((s) => H.HRS_ST[s]),
   Object.keys(H.HRS_ST));

/* =========================================================== FEED AUDIT =================== */
// the audit rows are built inline in portHtml, so they are read as source rather than lifted
const AUDBLOCK = CC.slice(CC.indexOf('var satAvgA='), CC.indexOf("var sh=sug.length"));

console.log('\n-- feed audit: a bar per market --');
ok('each market gets a bar row', /class="dzp-mrow"/.test(AUDBLOCK));
ok('the bar length IS the score', /width:'\+a\.score\+'%/.test(AUDBLOCK));
ok('the bar is banded by the same thresholds as the number',
   /a\.score>=80\?'good':a\.score>=65\?'warn':'bad'/.test(AUDBLOCK));
ok('AN UNSCANNED MARKET GETS A HATCHED EMPTY TRACK, never a zero-length bar',
   /a\.score==null\?'<span class="dzp-bar none"/.test(AUDBLOCK));
ok('…and is named in words rather than scored', /not scanned/.test(AUDBLOCK));
ok('…and the hatch says why, so it is not read as a score of nought',
   /Never scanned — not a zero/.test(AUDBLOCK));
ok('keyword saturation rides the same row, separated from the score',
   /<em>· '\+sat\+'% kw<\/em>/.test(AUDBLOCK));
ok('the foot says how much of the estate has been read',
   /markets scanned|class="lb">scanned</.test(AUDBLOCK));
ok('…counting only the scanned ones', /a\.score!=null;\}\)\.length\+'\/'\+audL\.length/.test(AUDBLOCK));
ok('the cross-market saturation average is of the markets that have one',
   /satL\.length\?Math\.round\(satL\.reduce/.test(AUDBLOCK));
ok('the average is NOT repeated in the foot — it is already in the heading',
   !/class="lb">avg/.test(AUDBLOCK));
ok('the guard-alert pill is kept, and kept once',
   (AUDBLOCK.match(/guard alerts/g) || []).length === 1, (AUDBLOCK.match(/guard alert[s]?/g) || []));
ok('a brand with no wired markets says so instead of drawing an empty chart',
   /no feed markets wired/.test(AUDBLOCK));
ok('the tooltip names the market and the score', /title="'\+esc\(a\.m\.toUpperCase\(\)\)\+': '\+a\.score\+'\/100"/.test(AUDBLOCK));

/* ========================================================= GOLDEN RECORD ================== */
const GRC = {
  feeds: {
    'Reiss|gb': { client: 'Reiss', mkt: 'gb', score: 92, q: 84, air: 71, reqMissing: [], status: 'ok' },
    'Reiss|us': { client: 'Reiss', mkt: 'us', score: 84, q: 76, air: 64, reqMissing: ['gtin', 'brand'], status: 'crit' },
    'Reiss|de': { client: 'Reiss', mkt: 'de', status: 'never' },
    'Clean|gb': { client: 'Clean', mkt: 'gb', score: 96, q: 93, air: 80, reqMissing: [], status: 'ok' },
  },
};
const G = new Function('GRC', 'esc', 'fmtN', `
  ${lift(CC, 'grRows')} ${lift(CC, 'grAvg')} ${lift(CC, 'auditBand')} ${lift(CC, 'grBand')}
  ${liftVar(CC, 'GR_COL')} ${lift(CC, 'grRing')}
  ${(CC.match(/var GR_MROWS=\d+;/) || [''])[0]}
  ${lift(CC, 'grPill')} ${lift(CC, 'grMiniRow')} ${lift(CC, 'portGolden')}
  return { grRing:grRing, portGolden:portGolden };
`)(GRC, (x) => String(x == null ? '' : x), (n) => String(n));

console.log('\n-- golden record: the score as a ring, the rest as its legend --');
{
  const card = G.portGolden('Reiss');
  ok('the ring is drawn', /<svg[\s\S]*dzp-ring|dzp-ring[\s\S]*<svg/.test(card));
  ok('it uses Activity’s own two-column shape, so the card stays the same height',
     /class="dzp-act"/.test(card) && /class="dzp-leg"/.test(card));
  ok('the score is in the middle of the ring', /class="mid"><b[^>]*>88<\/b><span>record/.test(card),
     card.match(/class="mid">[\s\S]{0,60}/));
  ok('content quality is a legend row', /<b>80<\/b><span>quality/.test(card));
  ok('AI readiness is a legend row', /<b>68<\/b><span>AI ready/.test(card));
  ok('required gaps are a legend row', /<b>2<\/b><span>req gaps/.test(card));
  ok('…and are red only when there ARE gaps', /background:#C0392B"><\/i><b>2<\/b><span>req gaps/.test(card));
  ok('the unscanned market is a legend row of its own', /<b>1<\/b><span>unscanned/.test(card));
  ok('the short labels carry their full meaning as a tooltip',
     /title="Content quality/.test(card) && /never counted as zero/.test(card));
  ok('the full snapshot is still one click away', /data-gr="Reiss"/.test(card));
  ok('the heading still leads with the average', /avg 88\/100/.test(card));
}
{
  const clean = G.portGolden('Clean');
  ok('a brand with nothing missing says 0 gaps in grey, not in red',
     /background:#C9CDD4"><\/i><b>0<\/b><span>req gaps/.test(clean));
  ok('…and prints no unscanned row at all', !/unscanned/.test(clean));
  ok('a single-market brand carries no per-market row list — the ring above already IS that market',
     !/dzp-gmkts/.test(clean));
}

console.log('\n-- golden record: two LABELLED scores per market (Ray, 17 Sep 2026) --');
{
  const card = G.portGolden('Reiss');
  const rowFor = (mk) => { const m = new RegExp('<div class="dzp-grow"><span class="mk">' + mk + '</span>([\\s\\S]*?)</div>').exec(card); return m ? m[1] : ''; };
  ok('a per-market row list is drawn once a brand has more than one market', /dzp-gmkts/.test(card));
  const gb = rowFor('GB');
  ok('GB carries its own feed + content pair, not the brand average',
     /<b[^>]*>92<\/b><i>feed<\/i>/.test(gb) && /<b[^>]*>84<\/b><i>content<\/i>/.test(gb), gb);
  const us = rowFor('US');
  ok('US carries its own pair too — different numbers from GB, never repeated',
     /<b[^>]*>84<\/b><i>feed<\/i>/.test(us) && /<b[^>]*>76<\/b><i>content<\/i>/.test(us), us);
  const de = rowFor('DE');
  ok('DE (never scanned) reads "not scanned", never a blank or a zero', /not scanned/.test(de), de);
  ok('both scores name themselves so they can never be mistaken for each other',
     /<i>feed<\/i>/.test(card) && /<i>content<\/i>/.test(card));
  ok('the full meaning rides as a tooltip on each pill, same discipline as the legend above',
     /title="Feed scorecard/.test(card) && /title="Content quality score/.test(card));
}
{
  // a Reiss-sized estate (28 markets) must never turn the compact card into a wall
  const MANY = { feeds: {} };
  const codes = ['gb','us','ie','de','nl','au','ca','eu','fr','uae','at','be','ch','cz','dk','es','fi','gr','hk','it','kw','pl','pt','ro','sa','se','sg','sk'];
  codes.forEach(function (m, i) { MANY.feeds['Big|' + m] = { client: 'Big', mkt: m, score: 80 + (i % 10), q: 70 + (i % 10), air: 60, reqMissing: [], status: 'ok' }; });
  const G2 = new Function('GRC', 'esc', 'fmtN', `
    ${lift(CC, 'grRows')} ${lift(CC, 'grAvg')} ${lift(CC, 'auditBand')} ${lift(CC, 'grBand')}
    ${liftVar(CC, 'GR_COL')} ${lift(CC, 'grRing')}
    ${(CC.match(/var GR_MROWS=\d+;/) || [''])[0]}
    ${lift(CC, 'grPill')} ${lift(CC, 'grMiniRow')} ${lift(CC, 'portGolden')}
    return { portGolden:portGolden };
  `)(MANY, (x) => String(x == null ? '' : x), (n) => String(n));
  const big = G2.portGolden('Big');
  const shown = (big.match(/class="dzp-grow"/g) || []).length;
  ok('the row list caps at 8 markets, matching Feed audit’s own per-market cap', shown === 8, shown);
  ok('what got cut is NAMED, not silently dropped', /\+20 more markets — see Full snapshot/.test(big));
}

console.log('\n-- the ring is an honest proportion --');
{
  const arc = (h) => {
    const m = /stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(h);
    return m ? Math.round((Number(m[1]) / Number(m[2])) * 1000) / 10 : null;
  };
  ok('a 50 draws half the ring', arc(G.grRing(50, '#ED6F0B')) === 50, arc(G.grRing(50, '#ED6F0B')));
  ok('a 92 draws 92% of it', arc(G.grRing(92, '#15803D')) === 92);
  ok('a 0 draws none of it', arc(G.grRing(0, '#C0392B')) === 0);
  ok('the track is always drawn, so the GAP is visible — which is the thing being looked for',
     (G.grRing(92, '#15803D').match(/<circle/g) || []).length === 2);
  ok('a nonsense score is clamped rather than drawing past the ring', arc(G.grRing(140, '#15803D')) === 100);
  ok('a negative one is clamped too', arc(G.grRing(-20, '#15803D')) === 0);
  ok('the arc has no round cap, so at a high score the two ends cannot overlap into a full ring',
     !/stroke-linecap="round"/.test(G.grRing(97, '#15803D')));
}

console.log('\n-- the band’s CSS carries the new elements --');
ok('the bar has a track', /\.dzp-bar\{/.test(CC));
ok('an unscanned track is hatched, not merely pale', /\.dzp-bar\.none\{[\s\S]{0,140}repeating-linear-gradient/.test(CC));
ok('the meter’s cap mark is a rule across the bar', /\.dzp-meter u\{/.test(CC));
ok('served has its own band colour', /\.dzp-band\.served\{/.test(CC));
ok('the posture note has a style of its own', /\.dzp-why\{/.test(CC));
ok('a bar can never collapse to nothing in a narrow card', /\.dzp-bar\{[\s\S]{0,200}min-width/.test(CC));

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
