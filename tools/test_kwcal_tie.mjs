#!/usr/bin/env node
/*
 * Keyword Calendar — event ⇄ ticket tie + result-window join (Ray, 11 Sep 2026).
 *
 * Every keyword optimisation is briefed from the calendar and nowhere else, so each moment owns
 * exactly one Workflow ticket and the board must never guess which. That resolution order, and
 * the half-month window that joins a reported result batch back onto a moment, are pure logic —
 * pinned here so a later edit to docs/FeedSpark_KWCal.html can't quietly loosen them.
 *
 * The functions are lifted out of the page by name (brace-matched). If one is renamed or moved,
 * this fails loudly — which is the point: it is a tripwire, not a mirror.
 *
 * Run: node tools/test_kwcal_tie.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_KWCal.html'), 'utf8');

function lift(name) {                       // pull `function name(...){...}` out by brace matching
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(`KWCal: function ${name}() not found — did it get renamed?`);
  let depth = 0, inS = null, esc = false, line = false, block = false;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    // comments first: an apostrophe in a trailing comment must not open a "string"
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
    if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { line = true; j++; continue; }
    if (c === '/' && n === '*') { block = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error(`KWCal: unbalanced braces reading ${name}()`);
}
function liftVar(name) {
  const m = new RegExp('var ' + name + '=\\{[^}]*\\};').exec(src);
  if (!m) throw new Error(`KWCal: var ${name} not found`);
  return m[0];
}
function liftLine(name) {                   // a whole `var A=…, B=…;` statement, comment stripped
  const m = new RegExp('var ' + name + '=[^\\n]*').exec(src);
  if (!m) throw new Error(`KWCal: var ${name} not found — did it get renamed?`);
  return m[0].replace(/\s*\/\/.*$/, '');
}
function liftDecl(name) {                   // `var NAME={…}` / `var NAME=[…]` — brace-matched, so
  const at = src.indexOf('var ' + name + '=');            // nested arrays and objects survive
  if (at < 0) throw new Error(`KWCal: var ${name} not found — did it get renamed?`);
  const open = /[[{]/.exec(src.slice(at))?.index;
  const shut = src[at + open] === '[' ? ']' : '}';
  let depth = 0, inS = null, esc = false, line = false, block = false;
  for (let j = at + open; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
    if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { line = true; j++; continue; }
    if (c === '/' && n === '*') { block = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (!depth) { if (c !== shut) throw new Error(`KWCal: ${name} closed with ${c}`); return src.slice(at, j + 1) + ';'; } }
  }
  throw new Error(`KWCal: unbalanced brackets reading var ${name}`);
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LEAD_DAYS = 21;
let BRIEFS = {}, KWRES = {};
const evMkt = (brand, e) => e.mkt || 'gb';
const schedDate = (e) => { const d = new Date(e.date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - LEAD_DAYS); return d; };

// the tie is resolved for the WHOLE brand in one pass, so the resolver needs the brand's moments.
// ROSTER supplies them; with none set a query resolves against just the moment being asked about.
let ROSTER = null;
// docs/kwcal_engine.js is where the tie and the brief payload live since 14 Oct 2026 (Workflow
// loads the same file). The page keeps adapters at the old names, so lifting them still works —
// they just need the engine handed in, and the assertions below now cover BOTH halves at once.
const KWE = (await import('../docs/kwcal_engine.js')).default;
const body = [liftVar('MONI'), liftDecl('TASK_STOP'), liftLine('WFC'),
  lift('normTask'), lift('kwTask'), lift('taskWords'), lift('sigWords'), lift('nameScore'),
  lift('wfReset'), lift('wfBuild'), lift('wfAll'), lift('wfFor'), lift('wfHow'),
  lift('isKwTicket'), lift('looseKw'), lift('periodWin'),
  lift('ticketRes'), lift('roundRes'), lift('resFor')].join('\n');
const api = new Function('KWE', 'MON', 'LEAD_DAYS', 'evMkt', 'schedDate', 'getB', 'getR', 'getEvs',
  `${body}
   var BRIEFS, KWRES;
   var CLIENT=null, MKT='gb';   // the board's own pin; absent here, so every moment reads its own market
   var evsOf = getEvs;
   return { wfFor:function(b,e){ BRIEFS=getB(); wfReset(); return wfFor(b,e); },
            wfHow:function(b,e){ BRIEFS=getB(); wfReset(); return wfHow(b,e); },
            looseKw:function(b){ BRIEFS=getB(); wfReset(); return looseKw(b); },
            resFor:function(b,e){ BRIEFS=getB(); KWRES=getR(); wfReset(); return resFor(b,e); },
            periodWin:periodWin, kwTask:kwTask, normTask:normTask };`
)(KWE, MON, LEAD_DAYS, evMkt, schedDate, () => BRIEFS, () => KWRES,
  (brand) => ROSTER || (QUERY ? [QUERY] : []));
let QUERY = null;

const ask = (fn) => (brand, e) => { QUERY = e; const r = api[fn](brand, e); QUERY = null; return r; };
const wfFor = ask('wfFor'), wfHow = ask('wfHow'), resFor = ask('resFor');

let pass = 0; const fails = [];
const is = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); } else { fails.push(`${name}\n      got  ${g}\n      want ${w}`); }
};

// ---------- the tie ----------
const ev = (id, name, date, mkt) => ({ id, name, date, ...(mkt ? { mkt } : {}) });
const aw26 = ev('aw26', 'AW26 Campaign (renamed)', '2026-09-09');
const coats = ev('coats', 'Coats', '2026-10-12');
const coatsj = ev('coatsj', 'Coats & Jackets', '2026-10-19');

BRIEFS = {
  a: { id: 'a', client: 'Reiss', kw: 'aw26', task: 'Keywords Optimisation - AW26 Campaign - Marketing Planner - 0926', status: 'briefed' },
  b: { id: 'b', client: 'Reiss', task: 'Keywords Optimisation - Coats & Jackets - Marketing Planner - 1026', status: 'analysis' },
  c: { id: 'c', client: 'Schuh', kw: 'coats', task: 'Keywords Optimisation - Coats - Marketing Planner - 1026', status: 'done' },
  d: { id: 'd', client: 'Reiss', task: 'AI Keyword Optimisation — Denim - Marketing Planner - 0826', status: 'progress' },
};
is('stamped id survives a rename', wfFor('Reiss', aw26)?.id, 'a');
// Both on the board, one ticket named for the longer: the ticket is scored against every moment,
// and the one that accounts for MORE of its wording wins. ("Coats" is 100% present in "Coats &
// Jackets", so scoring the moment alone would let the short name steal it.)
ROSTER = [coats, coatsj];
is('"Coats & Jackets" resolves its own ticket', wfFor('Reiss', coatsj)?.id, 'b');
is('"Coats" cannot capture it', wfFor('Reiss', coats), null);
ROSTER = null;
is('another client’s brief never leaks in', wfFor('Reiss', ev('silk2', 'Silk', '2026-10-12')), null);
is('legacy em-dash task name still ties', wfFor('Reiss', ev('denim', 'Denim', '2026-08-21'))?.id, 'd');
is('no ticket = no tie', wfFor('Reiss', ev('zzz', 'Nothing Briefed', '2026-11-02')), null);

// the stamped id outranks a name that matches a DIFFERENT ticket
BRIEFS.e = { id: 'e', client: 'Reiss', kw: 'coats', task: 'something else entirely', status: 'live', updated: 1 };
is('stamped id outranks the name rungs', wfFor('Reiss', coats)?.id, 'e');

// newest wins when two tickets carry the same stamp
BRIEFS.f = { id: 'f', client: 'Reiss', kw: 'coats', task: 'another', status: 'done', updated: 99 };
is('newest stamped ticket wins', wfFor('Reiss', coats)?.id, 'f');

// ---------- the result window ----------
const W2 = (r) => { const w = api.periodWin(r); return w && [new Date(w.a).toISOString().slice(0, 10), new Date(w.b).toISOString().slice(0, 10), w.label]; };
const W = (p, when) => { const w = api.periodWin({ period: p, when }); return w && [new Date(w.a).toISOString().slice(0, 10), new Date(w.b).toISOString().slice(0, 10), w.label]; };
is('1st half of a month', W('Aug I', Date.UTC(2026, 7, 20)), ['2026-08-01', '2026-08-15', 'Aug 2026 · 1st half']);
is('2nd half of a month', W('Aug II', Date.UTC(2026, 7, 31)), ['2026-08-16', '2026-08-31', 'Aug 2026 · 2nd half']);
is('whole month when no numeral', W('Sep', Date.UTC(2026, 8, 30)), ['2026-09-01', '2026-09-30', 'Sep 2026']);
is('February respects the month length', W('Feb II', Date.UTC(2026, 1, 27)), ['2026-02-16', '2026-02-28', 'Feb 2026 · 2nd half']);
is('a December batch reported in January keeps its year', W('Dec II', Date.UTC(2027, 0, 6)), ['2026-12-16', '2026-12-31', 'Dec 2026 · 2nd half']);
is('an unparseable period is no window', api.periodWin({ period: 'whenever', when: Date.now() }), null);
/* A BATCH read-out is named for its theme, not its fortnight (Ray, 9 Oct 2026, the Knit Zip
   Cardigan result), so its period parses to nothing — but the email STATES its campaign window
   and the worker reads it off those words, so the board ties the round to the optimisations
   that really went live inside it rather than to none at all. */
is('a batch-named period on its own ties to nothing',
  api.periodWin({ period: 'Zip Knit Cardigan', when: Date.UTC(2026, 9, 8) }), null);
is('…but the window the email stated is used verbatim',
  W2({ period: 'Zip Knit Cardigan', win: { a: Date.UTC(2026, 8, 24), b: Date.UTC(2026, 9, 7, 23, 59, 59) } }),
  ['2026-09-24', '2026-10-07', '24 Sep – 7 Oct 2026']);
is('a stated window beats the period token, so the two can never disagree',
  W2({ period: 'Aug I', when: Date.UTC(2026, 7, 20), win: { a: Date.UTC(2026, 8, 24), b: Date.UTC(2026, 9, 7, 23, 59, 59) } })[0],
  '2026-09-24');
is('a malformed stated window falls back to the period token',
  W2({ period: 'Aug I', when: Date.UTC(2026, 7, 20), win: { a: 5, b: 5 } })[0], '2026-08-01');

// ---------- the join ----------
KWRES = { Reiss: [
  { id: 'r1', client: 'Reiss', mkt: 'gb', period: 'Aug II', when: Date.UTC(2026, 7, 31), verdict: 'positive' },
  { id: 'r2', client: 'Reiss', mkt: 'gb', period: 'Sep II', when: Date.UTC(2026, 8, 30), verdict: 'mixed' },
  { id: 'r3', client: 'Reiss', mkt: 'us', period: 'Sep II', when: Date.UTC(2026, 8, 30), verdict: 'negative' },
].map((r) => ({ ...r, __w: api.periodWin(r) })) };
is('a moment lands in the batch covering its live-by date', resFor('Reiss', aw26)?.id, 'r1');   // live-by 19 Aug
is('a later moment lands in the later batch', resFor('Reiss', coats)?.id, 'r2');                 // live-by 21 Sep
is('a moment outside every window gets nothing', resFor('Reiss', ev('x', 'X', '2026-08-21')), null); // live-by 31 Jul
is('a market-pinned moment takes its own market’s batch', resFor('Reiss', ev('y', 'Y', '2026-10-12', 'us'))?.id, 'r3');
is('a brand with no archive gets nothing', resFor('Schuh', aw26), null);

// ---------- the moment's OWN read-out beats the fortnight round ----------
// Ray, 21 Sep 2026: Vimalesh answered the Silk brief on its own thread with the numbers.
// /api/kwresults reports a whole fortnight; the ticket reports THIS optimisation.
const silk = ev('silk', 'Silk', '2026-09-09');            // live-by 19 Aug -> inside batch r1
BRIEFS.silk1 = { id: 'REIS-20260811-02', client: 'Reiss', kw: 'silk', status: 'confirmed', updated: 5,
  task: 'Keywords Optimisation - Silk - Marketing Planner - 0826',
  comms: [{ note: 'Thanks, live now', when: 1 },
          { note: 'Result: +4.63% impressions · +5.18% clicks', when: 2 }] };
is('the ticket’s own read-out wins over the round', resFor('Reiss', silk)?.txt, '+4.63% impressions · +5.18% clicks');
is('…and is marked as the moment’s own, not a batch', resFor('Reiss', silk)?.own, 1);
is('…carrying the ticket it came from', resFor('Reiss', silk)?.id, 'REIS-20260811-02');
is('…its metric lines split out for the popover', resFor('Reiss', silk)?.metrics,
   ['+4.63% impressions', '+5.18% clicks']);
is('all-positive figures read Positive', resFor('Reiss', silk)?.verdict, 'positive');

BRIEFS.silk1.comms.push({ note: 'Result: +9% impressions · -2% clicks', when: 3 });
is('the NEWEST read-out on the ticket wins', resFor('Reiss', silk)?.txt, '+9% impressions · -2% clicks');
is('a mixed read-out reads Mixed', resFor('Reiss', silk)?.verdict, 'mixed');

BRIEFS.silk1.comms = [{ note: 'Result: down 3% — rolled back', when: 2 }];
is('a prose read-out with no signed figure is Reported, never guessed',
   resFor('Reiss', silk)?.verdict, 'unknown');

// a reply that is NOT a read-out must not become one
BRIEFS.silk1.comms = [{ note: 'We will do the needful', when: 2 }];
is('a plain reply is not a result — the round answers again', resFor('Reiss', silk)?.id, 'r1');

// and another moment's ticket can never supply this one's result. BRIEFS.f already owns the
// Coats moment (newest on a tie), so the read-out goes on the ticket that actually holds it —
// anything else would be asserting against a ticket the calendar never claimed.
delete BRIEFS.silk1;
BRIEFS.f.comms = [{ note: 'Result: +99% impressions', when: 2 }];
is('a different moment’s read-out never leaks onto this card', resFor('Reiss', silk)?.id, 'r1');
is('…while its own moment does get it', resFor('Reiss', coats)?.txt, '+99% impressions');
delete BRIEFS.f.comms;

// ---------- the canonical task name (what the brief is raised as) ----------
is('house task name', api.kwTask('Reiss', ev('k', 'Coats', '2026-10-12')), 'Keywords Optimisation - Coats - Marketing Planner - 1026');
is('non-GB markets are suffixed', api.kwTask('Reiss', ev('k', 'Coats', '2026-10-12', 'us')), 'Keywords Optimisation - Coats - Marketing Planner - 1026 - US');

// ---------- the Accessorize ingest (Ray, 11 Sep 2026) ----------
/* The brand's own master marketing calendar is SEEDED into the page, not handed over as a file to
 * import — an ingest that only exists in a download is an ingest nobody can see. Five moments per
 * retail period, and the moments that turn on a date correction carry the reason. */
const seedApi = new Function(`${liftDecl('SEED')} return SEED;`)();
const ACC = seedApi.Accessorize && seedApi.Accessorize.events;
is('Accessorize is seeded', Array.isArray(ACC), true);
is('15 moments — five per retail period', ACC.length, 15);
is('every moment carries keyword themes', ACC.every((e) => Array.isArray(e.terms) && e.terms.length), true);
is('every moment has a real ISO date', ACC.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)), true);
is('every lane is one the board renders', ACC.every((e) => ['campaign','location','studio','sale'].includes(e.lane)), true);
is('ids are unique and brand-prefixed', new Set(ACC.map((e) => e.id)).size === 15 && ACC.every((e) => e.id.startsWith('acc_')), true);
const per = (a, b) => ACC.filter((e) => e.date >= a && e.date <= b).length;
is('P1 · 30 Aug – 3 Oct', per('2026-08-30', '2026-10-03'), 5);
is('P2 · 4 – 31 Oct', per('2026-10-04', '2026-10-31'), 5);
is('P3 · 1 – 28 Nov', per('2026-11-01', '2026-11-28'), 5);
// the workbook's key-dates row is carried over from 2024 — a moment whose date we moved, or that
// the client has not confirmed, must say so on the card or the caveat is lost
// NOTE the test is the CAVEAT, not the presence of a note: since 14 Oct 2026 most moments carry a
// note stating their product scope, so "has a note" stopped meaning "has a date reason".
const dateCaveat = (e) => /Date NOT confirmed|Date corrected|Moved off the/.test(e.note || '');
is('the corrected / unconfirmed dates carry their reason', ACC.filter(dateCaveat).map((e) => e.id).sort(),
  ['acc_country', 'acc_halloween', 'acc_sparkle', 'acc_xmaslaunch']);

// ---------- YuMOVE: a PRICING calendar, not a product one ----------
const YM = seedApi.YuMOVE && seedApi.YuMOVE.events;
is('YuMOVE is seeded', Array.isArray(YM), true);
is('seven moments across the promo window', YM.length, 7);
is('ids unique and brand-prefixed', new Set(YM.map((e) => e.id)).size === 7 && YM.every((e) => e.id.startsWith('ym_')), true);
is('every moment carries keyword themes', YM.every((e) => Array.isArray(e.terms) && e.terms.length), true);
is('every moment has a real ISO date', YM.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)), true);
// discount mechanics apply to the whole catalogue, so every one of these is a brand-wide window
// — a scoped sale moment would ask the AM to set a product scope that does not exist
is('every moment is brand-wide', YM.every((e) => e.brandwide === 1), true);
is('every moment is on the sale lane', YM.every((e) => e.lane === 'sale'), true);
is('the window runs 16 Nov – 1 Dec 2026',
  [YM.map((e) => e.date).sort()[0], YM.map((e) => e.date).sort().slice(-1)[0]], ['2026-11-16', '2026-12-01']);
// the source sheet prints two "30th Nov" columns; 30 Nov 2026 is the Monday, so the Sunday
// column is the 29th. The corrected moment must SAY it was corrected.
is('no moment sits on the sheet’s duplicated 30 Nov Sunday', YM.some((e) => e.date === '2026-11-29'), true);
is('…and it carries the correction on the card', /30 Nov 2026 is the Monday/.test((YM.find((e) => e.date === '2026-11-29') || {}).note || ''), true);
// the PDP default flip is a FEED fact (which price the page leads with), not just site wording
const flips = YM.filter((e) => /DEFAULT PDP OPTION FLIPS/.test(e.note || ''));
is('both PDP-default flips are called out', flips.map((e) => e.date).sort(), ['2026-11-27', '2026-12-01']);
// an inferred band start must never read as a confirmed date
is('the inferred band starts say so', YM.filter((e) => /read off the chart/.test(e.note || '')).length >= 2, true);

// ---------- the Schuh FY27 ingest (Ray, 22 Sep 2026) ----------
/* "Schuh's marketing calendar - import anyhting from Aug/26 onwards". The workbook is a
 * DAY-COLUMN grid — every activity a merged block — so an import turns on two judgements that
 * are easy to lose later: which grid block becomes which dated moment, and what was deliberately
 * left out. Both are pinned here. */
const SCH = seedApi.Schuh && seedApi.Schuh.events;
is('Schuh is seeded', Array.isArray(SCH), true);
is('40 moments', SCH.length, 40);
is('ids unique and brand-prefixed', new Set(SCH.map((e) => e.id)).size === 40 && SCH.every((e) => e.id.startsWith('sch_')), true);
is('every moment carries keyword themes', SCH.every((e) => Array.isArray(e.terms) && e.terms.length), true);
is('every moment has a real ISO date', SCH.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)), true);
is('every moment says where it came from', SCH.every((e) => e.note && e.note.length > 20), true);
is('every lane is one the board renders', SCH.every((e) => ['campaign','location','studio','sale'].includes(e.lane)), true);
// four lanes = four row-groups of the workbook; a moment drifting between them is a silent
// re-reading of the source
const lanes = SCH.reduce((o, e) => (o[e.lane] = (o[e.lane] || 0) + 1, o), {});
is('PROMOTIONS → sale', lanes.sale, 9);
is('SCHUH CAMPAIGNS · Full Price → campaign', lanes.campaign, 4);
is('BRAND PARTNERSHIPS + NEW BRANDS → studio', lanes.studio, 20);
is('BRAND / CATEGORY SEARCHES → location, one per week not one per brand word', lanes.location, 7);

// THE IMPORT WINDOW: everything whose block touches 1 Aug 2026, dated at its OWN start. A moment
// that opened earlier is kept rather than dropped — and must say so, or its date reads as the
// whole story.
const early = SCH.filter((e) => e.date < '2026-08-01');
is('the five moments that opened before August are kept', early.map((e) => e.id).sort(),
  ['sch_btsbundle', 'sch_btsscot', 'sch_btsuk', 'sch_kickers', 'sch_nikekids']);
is('…and every one of them says it opened before the window', early.every((e) => /Opened before this import window/.test(e.note)), true);
is('nothing is dated before the earliest block that reaches August', SCH.map((e) => e.date).sort()[0], '2026-06-29');

// WHERE A CELL NAMES ITS OWN DATE that date wins over the grid block, which is a content window
// drawn to fit the row. The five that differ by more than a day must report BOTH.
const named = { sch_nikekids: '2026-07-27', sch_converse: '2026-08-06', sch_uggevelina: '2026-08-20', sch_studnights: '2026-09-16', sch_nbabzorb: '2026-10-26' };
Object.keys(named).forEach((id) => {
  const e = SCH.find((x) => x.id === id) || {};
  is(`${id} sits on the date the cell names`, e.date, named[id]);
  is(`…and its note reports the grid block too`, /block|grid|reads/i.test(e.note || ''), true);
});

// BRAND-WIDE is a claim about the catalogue. The catalogue-wide offers carry it; the two scoped
// ones deliberately do not — "selected lines" is left unset rather than counted as everything.
is('only sale moments are ever brand-wide', SCH.every((e) => !e.brandwide || e.lane === 'sale'), true);
is('the catalogue-wide offers are brand-wide', SCH.filter((e) => e.brandwide).map((e) => e.id).sort(),
  ['sch_b1g10', 'sch_blackfri', 'sch_mss', 'sch_refresher', 'sch_student20', 'sch_studnights', 'sch_winter']);
is('the two scoped offers are not', SCH.filter((e) => e.lane === 'sale' && !e.brandwide).map((e) => e.id).sort(), ['sch_btsbundle', 'sch_sel30']);
is('…and the unscoped one says the calendar never named the lines',
  /does not say which/.test((SCH.find((e) => e.id === 'sch_sel30') || {}).note || ''), true);

// Black Friday 2026 is Fri 27 Nov, but Schuh opens FIVE DAYS EARLY — the feed date is Schuh's,
// not the cultural one, and a later "correction" to 27 Nov would be wrong.
const bf = SCH.find((e) => e.id === 'sch_blackfri') || {};
is('Black Friday sits on Schuh’s own start, not the cultural date', bf.date, '2026-11-22');
is('…and the card says why it is early', /five days before/.test(bf.note || ''), true);

// The search-peak lane is a FORECAST. It must read as a week, and never as a commitment.
const peaks = SCH.filter((e) => e.lane === 'location');
is('every search peak is a week-commencing moment', peaks.every((e) => e.wc === 1), true);
is('…and only they are', SCH.filter((e) => e.wc).length, peaks.length);
is('…and each says it is a forecast', peaks.every((e) => /forecast/i.test(e.note)), true);

// A UK & ROI calendar: nothing in it is German. A pinned market would brief the wrong feed.
is('no moment pins a market — they follow the board', SCH.some((e) => e.mkt), false);

// ---------- Superdry: FeedSpark's OWN focus themes (Ray, 30 Sep 2026) ----------
/* "look at superdry product types and create 4 focus themes for each month from now till january".
 * Unlike every other brand here, nothing about this seed came from the client — it is derived from
 * the live GB feed and the search-terms report, so the two things worth losing are the SHAPE
 * (4 per month, Oct 2026 → Jan 2027) and the discipline that each theme names its own evidence
 * and never claims a scope it did not measure. */
const SD = seedApi.Superdry && seedApi.Superdry.events;
is('Superdry is seeded', Array.isArray(SD), true);
is('16 themes', SD.length, 16);
is('ids unique and brand-prefixed', new Set(SD.map((e) => e.id)).size === 16 && SD.every((e) => e.id.startsWith('sd_')), true);
is('every theme carries keyword themes', SD.every((e) => Array.isArray(e.terms) && e.terms.length), true);
is('every theme has a real ISO date', SD.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)), true);
is('every theme states its evidence', SD.every((e) => e.note && e.note.length > 60), true);
is('every lane is one the board renders', SD.every((e) => ['campaign','location','studio','sale'].includes(e.lane)), true);

// FOUR A MONTH, from this month to January — the whole ask. A theme drifting into a fifth month,
// or two months sharing five, is the plan quietly changing shape.
const briefBy = (e) => schedDate(e).toISOString().slice(0, 7);   // schedDate = live − LEAD_DAYS
is('LEAD_DAYS is still 21, which is what these dates were laid out against',
  /LEAD_DAYS\s*=\s*21\b/.test(src), true);
const byMonth = SD.reduce((o, e) => (o[briefBy(e)] = (o[briefBy(e)] || 0) + 1, o), {});
is('the WORK months are Oct 2026 → Jan 2027 and nothing else', Object.keys(byMonth).sort(),
  ['2026-10', '2026-11', '2026-12', '2027-01']);
is('exactly four briefed in each', Object.keys(byMonth).sort().map((k) => byMonth[k]), [4, 4, 4, 4]);
is('nothing is born overdue — the earliest brief-by is 1 Oct 2026, after the day this shipped',
  SD.map((e) => schedDate(e).toISOString().slice(0, 10)).sort()[0],
  '2026-10-01');

// THE FINDING behind most of them is a word with real demand that is in NO title. Each of those
// themes must say so in its own note — the claim is checkable against the feed, and a later edit
// that softens it to "low coverage" loses the whole point.
const zeroWord = { sd_sweater: 'sweater', sd_longline: 'longline', sd_hoodzip: 'zipper', sd_varsity: 'letterman', sd_festive: 'fair isle' };
Object.keys(zeroWord).forEach((id) => {
  const e = SD.find((x) => x.id === id) || {};
  is(`${id} names the absent word`, new RegExp('"' + zeroWord[id] + '"').test(e.note || ''), true);
  is(`…and says it is in ZERO titles`, /ZERO titles|in no title|in ZERO of/.test(e.note || ''), true);
  is(`…and carries that word as a keyword theme`, e.terms.some((t) => t.includes(zeroWord[id].split(' ')[0])), true);
});

// SCOPE IS SEEDED FROM THE LIVE GB FEED, and it is the one thing here that could silently go
// stale. Paths must be the feed's own primary g:product_type shape, deduped, and never on a
// brand-wide theme — brandwide ignores pts, so carrying both states two different scopes.
const scoped = SD.filter((e) => Array.isArray(e.pts) && e.pts.length);
is('eleven themes carry a product-type scope', scoped.length, 11);
is('every seeded path is a chevron path of at least three levels',
  scoped.every((e) => e.pts.every((p) => p.split(' > ').length >= 3)), true);
is('every seeded path starts at a gender/Unisex root the feed actually uses',
  scoped.every((e) => e.pts.every((p) => ['Men', 'Women', 'Unisex'].includes(p.split(' > ')[0]))), true);
is('no path is repeated inside a scope', scoped.every((e) => new Set(e.pts).size === e.pts.length), true);
is('no theme is both scoped and brand-wide', SD.every((e) => !(e.brandwide && e.pts)), true);
is('the brand-wide themes are the catalogue-wide ones only', SD.filter((e) => e.brandwide).map((e) => e.id).sort(),
  ['sd_blackfri', 'sd_eoss', 'sd_forwhom']);
// the two that are deliberately left for the AM to scope say WHY — an empty scope with no reason
// reads as an oversight rather than a decision
['sd_newin', 'sd_fit'].forEach((id) => {
  const e = SD.find((x) => x.id === id) || {};
  is(`${id} carries no scope`, !e.pts && !e.brandwide, true);
  is(`…and says where its scope comes from instead`, /Playbook|TEXT filters|text filters/.test(e.note || ''), true);
});
// GB ONLY: the analysis was GB, so a scope must never be pinned to another market or claimed for one
is('no theme pins a market — GB is the board default and the only one measured', SD.some((e) => e.mkt), false);
is('no theme carries a per-market scope map it did not measure', SD.some((e) => e.ptsm), false);

// THE ORDER OF PLAY. The board buckets by brief-by, so the first card a reader meets is the one
// briefed first — and that has to be the biggest seasonal win, not whatever sorts first by name.
is('the first theme on the board is winter outerwear intent',
  SD.slice().sort((a, b) => (a.date < b.date ? -1 : 1))[0].id, 'sd_winterintent');
is('…and it is live while the season is still climbing', (SD.find((e) => e.id === 'sd_winterintent') || {}).date, '2026-10-22');

// Black Friday 2026 is Fri 27 Nov; the feed carries sale language a week early, and the festive
// knitwear must be live in NOVEMBER — a December brief misses its own season.
is('Black Friday sale language goes live a week before the day', (SD.find((e) => e.id === 'sd_blackfri') || {}).date, '2026-11-20');
is('festive knitwear is live in early November', (SD.find((e) => e.id === 'sd_festive') || {}).date, '2026-11-05');
is('…and says why it cannot wait for December', /mid-December|by mid-December|spent by/.test((SD.find((e) => e.id === 'sd_festive') || {}).note || ''), true);
is('the end-of-season sale opens on Boxing Day', (SD.find((e) => e.id === 'sd_eoss') || {}).date, '2026-12-26');

// The product_type data-quality splits the read turned up are a Product Type Guard job, not a
// keyword theme — but the two scopes that CONTAIN a split path must carry both spellings, or the
// scope silently drops products. PMAX listing groups key on the exact value.
const halfZip = SD.find((e) => e.id === 'sd_hoodzip') || {};
is('the hoodie scope carries BOTH spellings of the split type',
  ['Men > Clothing > Hoodies and Sweatshirts > Half Zip Sweats', 'Men > Clothing > Hoodies and Sweatshirts > Half zip Sweats']
    .every((p) => (halfZip.pts || []).includes(p)), true);
const knit = SD.find((e) => e.id === 'sd_sweater') || {};
is('…and so does the knitwear scope', ['Men > Clothing > Jumpers > Half Zip Sweats', 'Men > Clothing > Jumpers > Half zip Sweats']
  .every((p) => (knit.pts || []).includes(p)), true);
is('the loungewear scope carries the singular "Trouser" branch as well as "Trousers"',
  (SD.find((e) => e.id === 'sd_lounge') || {}).pts.some((p) => / > Trouser > /.test(p))
  && (SD.find((e) => e.id === 'sd_lounge') || {}).pts.some((p) => / > Trousers > /.test(p)), true);

// ---------- a scope can be SET and not yet MEASURABLE ----------
/* volOf needs the market's product-type index and returns null without one, so before anybody has
 * run ⟳ Sync product types a seeded scope read "No product scope yet" on the card and counted in
 * the "Scopes to set" KPI. An unread index is not a zero — the same rule the rest of the FCC
 * follows. ONE reader, so the card and the KPI can never disagree. */
const hasScope = new Function('KWE', `${lift('ptsOf')} ${lift('txOf')} ${lift('cndOf')} ${lift('hasScope')} return hasScope;`)(KWE);
is('a seeded GB product-type scope counts as scoped', hasScope({ pts: ['Men > Clothing > Jumpers > Cable Knit Jumper'] }, 'gb'), true);
is('…and legacy pts is GB only, as ptsOf has always had it', hasScope({ pts: ['Men > Clothing > Jumpers > Cable Knit Jumper'] }, 'de'), false);
is('a per-market scope counts for its own market', hasScope({ ptsm: { de: ['x > y > z'] } }, 'de'), true);
is('a text filter counts', hasScope({ txsm: { gb: { qs: [{ q: 'oversized', n: 12 }] } } }, 'gb'), true);
is('an attribute condition counts', hasScope({ cndm: { gb: { conds: [{ attr: 'color', vals: ['Black'] }] } } }, 'gb'), true);
is('a theme with nothing set is honestly unscoped', hasScope({}, 'gb'), false);
is('an EMPTY pts array is not a scope', hasScope({ pts: [] }, 'gb'), false);
is('an empty text-filter list is not a scope', hasScope({ txsm: { gb: { qs: [] } } }, 'gb'), false);
// both surfaces must go through it — a second, private test would drift
is('scopeBtn names a set-but-unmeasured scope instead of calling it absent',
  /if\(!v&&hasScope\(e,pmkt\)\)/.test(src) && /sync to measure/.test(src), true);
is('…and a brand-wide theme is a scope decision too, not an empty one',
  /if\(!v&&e\.brandwide\)/.test(src) && /whole catalogue \u00b7 sync to measure|whole catalogue · sync to measure/.test(src), true);
is('…and the KPI stops counting it as a scope to set', /!hasScope\(e,evMkt\(CLIENT,e\)\)\)unset\+\+/.test(src), true);
is('the pending state has its own look in both themes',
  /(^|\n)\s*\.scope\.pend\{/.test(src) && /\[data-theme=dark\] \.scope\.pend\{/.test(src), true);

// ---------- lane names are a brand's own words, and DISPLAY ONLY ----------
/* "Moments · Studio" is the wrong phrase for a Nike drop. A brand may rename its four lanes; the
 * KEYS must not move, or the colours, the stored events and the tie-matching all follow. */
let LN_CLIENT = 'Schuh';
const laneName = new Function('getC', `${liftDecl('LANE_LGND')} ${liftDecl('LANE_NAMES')} ${lift('laneName')}
   var CLIENT; return function(c, k){ CLIENT = c; return laneName(k); };`)();
is('Schuh names its own lanes', ['campaign','studio','location','sale'].map((k) => laneName('Schuh', k)),
  ['Schuh campaign', 'Brand launch', 'Search peak', 'Promotion']);
is('a brand with no map keeps the generic words', ['campaign','studio','location','sale'].map((k) => laneName('Reiss', k)),
  ['Campaign', 'Studio', 'Location', 'Sale']);
is('Superdry names its lanes for the KIND of work, not a marketing stream',
  ['campaign','studio','location','sale'].map((k) => laneName('Superdry', k)),
  ['Seasonal focus', 'Vocabulary gap', 'Catalogue sweep', 'Promotion']);
is('the all-brands overview keeps them too', laneName('*', 'studio'), 'Studio');
is('an unknown lane key never returns undefined', laneName('Schuh', 'nope'), '');
is('the lane KEYS on Schuh’s moments are the board’s own four',
  [...new Set(SCH.map((e) => e.lane))].sort(), ['campaign', 'location', 'sale', 'studio']);

// ---------- the mis-file repair ----------
/* importEvents used to honour the JSON's own "client" only when that brand already had a record,
 * so a calendar for a brand the board had never stored filed itself into whatever was ON SCREEN.
 * rehomeImports puts those events back; it must be idempotent and must not touch anything else. */
let STORE;
const rehome = new Function('getS', `${liftDecl('IMPORT_HOMES')} ${lift('rehomeImports')}
   var STORE; return function(s){ STORE = s; return rehomeImports(); };`)(() => STORE);
const misfiled = {
  Reiss: { events: [{ id: 'coats', name: 'Coats', date: '2026-10-12' }, { id: 'acc_newbag', name: 'That New-Bag Feeling — Hero Bags', date: '2026-09-02' }] },
  Schuh: { events: [{ id: 'acc_layerup', name: 'Layer It Up — Scarves', date: '2026-09-06' }] },
  _meta: { events: [{ id: 'acc_nope' }] },
};
is('both mis-filed moments move home', rehome(misfiled), 2);
is('the wrong brand is left clean', misfiled.Reiss.events.map((e) => e.id), ['coats']);
is('and keeps nothing of its own', misfiled.Schuh.events.length, 0);
is('they land on the brand the calendar named', misfiled.Accessorize.events.map((e) => e.id).sort(), ['acc_layerup', 'acc_newbag']);
is('an underscore key is never scanned', misfiled._meta.events.length, 1);
is('running it again is a no-op', rehome(misfiled), 0);
is('and never duplicates', misfiled.Accessorize.events.length, 2);
// an event already home is not "mis-filed"
const clean = { Accessorize: { events: [{ id: 'acc_newbag' }] } };
is('the home brand is never rehomed onto itself', rehome(clean), 0);

// ---------- the rolling plan window (Ray, 14 Sep 2026) ----------
/* "where is December and onwards? Please show six months from the current timeline so I can
 * track, drop, and plan ahead." The window starts at THIS month and runs winLen() months whether
 * or not they carry work — an empty month is a drop target. It may only ever GROW, so a moment
 * scheduled before this month, or dropped past the horizon, is never hidden; and it is capped so
 * a mistyped year (2062) can't render four hundred sections. */
let EVS = [], WINLS = null;
const winApi = new Function('MON', 'schedDate', 'getE', 'LS',
  `${liftLine('WIN_OPTS')}
   ${lift('nowKey')}
   ${lift('monKey')}
   ${lift('monLbl')}
   ${lift('winLen')}
   ${lift('monthRange')}
   ${lift('outsideWin')}
   var localStorage = LS, evs = getE;
   return { monthRange:monthRange, outsideWin:outsideWin, monLbl:monLbl, nowKey:nowKey, winLen:winLen };`
)(MON, schedDate, () => EVS, { getItem: () => WINLS });

const NOW = (() => { const n = new Date(); return n.getUTCFullYear() * 12 + n.getUTCMonth(); })();
const evAt = (k, id) => {                       // an event whose SCHEDULE (moment - 21d) lands in month k
  const d = new Date(Date.UTC(Math.floor(k / 12), k % 12, 25));
  d.setUTCDate(d.getUTCDate() + 21);
  return { id: id || ('m' + k), name: 'M' + k, date: d.toISOString().slice(0, 10), terms: ['x'] };
};
const rel = () => { const r = winApi.monthRange(); return [r[0] - NOW, r[1] - NOW]; };  // months from now

EVS = [];
is('an empty board still plans six months', rel(), [0, 5]);
EVS = [evAt(NOW + 1), evAt(NOW + 2)];
is('months with no work do not shrink the window', rel(), [0, 5]);
EVS = [evAt(NOW - 1), evAt(NOW + 2)];
is('it widens BACK for a moment already scheduled', rel(), [-1, 5]);
EVS = [evAt(NOW + 9)];
is('it widens FORWARD for a moment dropped past the horizon', rel(), [0, 9]);
is('nothing is outside a window that widened to fit it', winApi.outsideWin().length, 0);
EVS = [evAt(NOW - 4), evAt(NOW + 11)];
is('it widens both ways at once', rel(), [-4, 11]);

WINLS = '12';
EVS = [];
is('a 12-month plan runs twelve months', rel(), [0, 11]);
WINLS = '7';                                   // not an offered length
is('an unoffered length falls back to six', winApi.winLen(), 6);
WINLS = null;

// the guard: a mistyped year is named, not rendered
EVS = [evAt(NOW + 1), { id: 'typo', name: 'Spring Launch', date: '2062-03-01', terms: ['x'] }];
const wide = winApi.monthRange();
is('a 2062 date cannot stretch the board', wide[1] - wide[0] + 1 <= 37, true);
is('and it is named as outside the window', winApi.outsideWin().map((e) => e.id), ['typo']);

is('month labels carry the short year', winApi.monLbl(2026 * 12 + 11), 'Dec \u201926');
is('and roll into the next one', winApi.monLbl(2027 * 12 + 0), 'Jan \u201927');

/* ---- a calendar chip may not claim a stage only a TICKET can earn -----------------------
 * (Ray, 15 Sep 2026: "still not seeing Steven's brief through to my view"). The manual chip
 * used to cycle planned → intake → briefed → live → done, so a teammate could mark a moment
 * "briefed" on the shared calendar while no ticket, no Intake row and no plan row existed —
 * and it reached every other board looking exactly like real briefed work. */
{
  const api = new Function(
    liftDecl('STATES') + liftDecl('GHOST_STATES') + lift('isGhost') + lift('stOf') +
    'return { STATES, GHOST_STATES, isGhost, stOf };')();

  is('the manual cycle stops before the pipeline stages', api.STATES, ['planned', 'intake']);
  is('…and the stages only a ticket can earn are named', api.GHOST_STATES, ['briefed', 'live', 'done']);

  is('a moment claiming "briefed" with no ticket is a ghost', api.isGhost({ st: 'briefed' }, null), true);
  is('…so is one claiming live or done', [api.isGhost({ st: 'live' }, null), api.isGhost({ st: 'done' }, null)], [true, true]);
  is('a planned or intake moment is not', [api.isGhost({ st: 'planned' }, null), api.isGhost({ st: 'intake' }, null)], [false, false]);
  is('and neither is one with a real ticket', api.isGhost({ st: 'briefed' }, { id: 'IB-1', status: 'progress' }), false);

  is('a ghost never reports as a stage', api.stOf(null, { st: 'briefed' }), 'planned');
  is('a real ticket always wins', api.stOf({ status: 'running' }, { st: 'briefed' }), 'running');
  is('an honest manual state still shows', api.stOf(null, { st: 'intake' }), 'intake');
}

// ---------- tickets a colleague raised in Workflow (Ray, 15 Sep 2026) ----------
/* "you're still not able to add any activities that Steven has actioned from his end —
 * Cashmere/Merino and Gifting have been briefed successfully from his end and ASPL already
 * picked up." Every rung above matches the calendar's OWN wording, so a hand-raised ticket was
 * invisible. The word rung reads the task as words; it must claim the obvious, refuse the
 * ambiguous, and never drag in work that isn't this board's. */
const R = {                                       // a slice of the Reiss roster with real collisions
  cashmr: ev('cashmr', 'Cashmere/Merino', '2026-09-28'),
  gift:   ev('gift',   'Gifting',         '2026-10-19'),
  winter: ev('winter', 'Winterwear/Gifting/Party', '2026-10-19'),
  party:  ev('party',  'Event/Party',     '2026-10-19'),
  atel1:  ev('atel1',  'Atelier 1',       '2026-09-02'),
  atel2:  ev('atel2',  'Atelier 2',       '2026-09-30'),
  silk:   ev('silk',   'Silk',            '2026-08-30'),
};
ROSTER = Object.values(R);
const T = (id, task, extra) => ({ id, client: 'Reiss', task, status: 'briefed', cat: 'keyword', updated: 1, ...extra });
const only = (...bs) => { BRIEFS = {}; bs.forEach((b) => { BRIEFS[b.id] = b; }); };

only(T('s1', 'Cashmere Keyword Optimisation - Reiss GB', { by: 'Steven' }));
is('a hand-raised ticket naming part of the moment ties', wfFor('Reiss', R.cashmr)?.id, 's1');
is('and the card can say how it got there', wfHow('Reiss', R.cashmr), 'words');
is('no other moment picks it up', wfFor('Reiss', R.gift), null);
is('nothing is left unlinked', api.looseKw('Reiss').length, 0);

only(T('s2', 'Gifting', { status: 'progress' }));
is('a one-word ticket goes to the moment it names exactly', wfFor('Reiss', R.gift)?.id, 's2');
is('not to the longer name that merely contains the word', wfFor('Reiss', R.winter), null);

only(T('s3', 'Keyword optimisation - Party'));
is('a closer fit wins outright', wfFor('Reiss', R.party)?.id, 's3');

only(T('s4', 'Atelier refresh'));
is('a ticket two moments fit EQUALLY is claimed by neither (1)', wfFor('Reiss', R.atel1), null);
is('…nor by the other (2)', wfFor('Reiss', R.atel2), null);
is('it is surfaced instead of guessed', api.looseKw('Reiss').map((b) => b.id), ['s4']);

// a ticket that isn't keyword work has to name the moment OUTRIGHT — one shared word is not enough
only(T('s5', 'Golden Record Fix - g:silk - Reiss GB - 0926', { cat: 'technical' }));
is('a Golden Record ticket does not drift onto Silk on one shared word', wfFor('Reiss', R.silk), null);
only(T('s5b', 'Silk', { cat: 'technical' }));
is('…but one that names it outright still ties', wfFor('Reiss', R.silk)?.id, 's5b');
only(T('s6', 'Feed Fix - dup_title - Reiss GB - 0926', { cat: 'technical' }));
is('…and one that names no moment claims nothing', ROSTER.map((e) => wfFor('Reiss', e)).filter(Boolean).length, 0);
is('nor does it clutter the unlinked strip', api.looseKw('Reiss').length, 0);

// one ticket, one moment — the first moment resolved cannot leave a better-matching one empty
only(T('s7', 'Cashmere/Merino keyword optimisation'), T('s8', 'Gifting keyword optimisation'));
is('two tickets, two moments (1)', wfFor('Reiss', R.cashmr)?.id, 's7');
is('two tickets, two moments (2)', wfFor('Reiss', R.gift)?.id, 's8');

// a hand link beats every rung, and survives a rename on either side
only(T('s9', 'Something Steven called it'));
R.silk.wf = 's9';
is('a hand link is decisive', wfFor('Reiss', R.silk)?.id, 's9');
is('and says so', wfHow('Reiss', R.silk), 'linked');
R.silk.name = 'Silk & Satin';
is('a rename cannot break it', wfFor('Reiss', R.silk)?.id, 's9');
delete R.silk.wf; R.silk.name = 'Silk';
ROSTER = null;

/* ── a moment's NAME and DATE, edited by hand (Ray, 14 Oct 2026) ──────────────────────────────
 * tools/check_kwcal_edit.js drives the affordance on a real card; these are the two writers'
 * own rules, which are pure and which a rendered test can only sample. setName and setDate are
 * the ONE writer each — the card buttons and editEvent() (the only way to reach a moment sitting
 * outside the window, which has no card) both go through them, so neither path can validate
 * differently from the other. Both must REFUSE rather than drop: the editor they replace kept
 * the old value in silence on anything its regex did not like. */
{
  const said = [];
  const sandbox = { err: (m) => said.push(m) };
  const fn = new Function('S', lift('setName') + '\n' + lift('setDate') + '\n' + lift('dEdit')
    + '\nvar err=S.err;\nreturn {setName:setName,setDate:setDate,dEdit:dEdit};')(sandbox);

  const E = () => ({ name: 'Winter intent', date: '2026-11-05' });
  let e = E();
  is('a name is taken, trimmed', (fn.setName(e, '  Chunky knits  '), e.name), 'Chunky knits');
  is('an empty name is refused', fn.setName(e, '   '), false);
  is('…and the old name stands', e.name, 'Chunky knits');
  is('…out loud, never in silence', said.length > 0, true);

  e = E();
  is('an ISO date is taken', (fn.setDate(e, '2027-01-21'), e.date), '2027-01-21');
  is('a w/c prefix is the flag, never part of the date', (fn.setDate(e, 'w/c 2026-12-07'), [e.date, e.wc]).join('|'), '2026-12-07|1');
  is('…and reads back as it was typed', fn.dEdit(e), 'w/c 2026-12-07');
  is('typing it bare clears the prefix', (fn.setDate(e, '2026-12-07'), e.wc), undefined);
  // 2026-02-31 passes any shape test AND new Date() rolls it to 3 March rather than reporting it
  // invalid — so the day is round-tripped. Without this, a typo became a different real date.
  is('a day the calendar does not have is refused', fn.setDate(e, '2026-02-31'), false);
  is('…and the date stands', e.date, '2026-12-07');
  is('prose is refused', fn.setDate(e, 'next tuesday'), false);
  is('a UK-order date is refused rather than read backwards', fn.setDate(e, '07/12/2026'), false);
  is('…and the date still stands', e.date, '2026-12-07');
}

/* ── ONE implementation, two surfaces (Ray, 14 Oct 2026) ─────────────────────────────────────
 * Workflow lists the moments still to be briefed and raises them from there, so the tie and the
 * brief payload moved into docs/kwcal_engine.js and BOTH pages call in. The danger is somebody
 * re-inlining a copy into either page "to avoid the dependency" — then the board and the board's
 * own to-brief list disagree about what is briefed, and the second ticket Ray asked us never to
 * raise gets raised. So: the page must DELEGATE, and the engine must be what Workflow loads. */
{
  const wf = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_Workflow.html'), 'utf8');
  is('the calendar loads the shared engine', /<script src="\/kwcal\/engine\.js"/.test(src), true);
  is('…and Workflow loads the SAME one', /\/kwcal\/engine\.js/.test(wf), true);
  is('the calendar\u2019s tie is the engine\u2019s', /function wfBuild\(brand\)\{ return KWE\.tieBuild\(/.test(src), true);
  is('…and so is its brief payload', /KWE\.briefPayload\(/.test(src), true);
  // the worker has to SERVE it, or both pages load an empty 200 and define nothing — a failure
  // that has shipped before on this codebase (docs/IMAGES.md)
  const w = fs.readFileSync(path.join(root, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');
  is('the worker serves the engine', /path === '\/kwcal\/engine\.js'/.test(w), true);
  is('…from a real Text-module import', /import KWCAL_ENGINE_SRC from "\.\.\/\.\.\/\.\.\/docs\/kwcal_engine\.js"/.test(w), true);

  // dueList is what Workflow renders: every moment with NO ticket, soonest brief first
  const store = { Acme: { events: [
      { id: 'm1', name: 'Festive knitwear', date: '2026-11-05', terms: ['christmas jumper'] },
      { id: 'm2', name: 'Black Friday', date: '2026-11-20', brandwide: 1 },
      { id: 'm3', name: 'Already briefed', date: '2026-11-25' },
      { id: 'm4', name: 'Far future', date: '2027-06-01' } ],
    ptidx: { gb: { map: {}, __total: 1000, sat: { n: 300 } } } },
    _meta: { events: [{ id: 'x', name: 'never', date: '2026-11-01' }] } };
  const briefs = { t1: { id: 't1', client: 'Acme', kw: 'm3', task: 'anything', status: 'briefed' } };
  const due = KWE.dueList(store, briefs, { now: '2026-10-14' });
  is('a moment with a ticket is never offered again', due.some((r) => r.id === 'm3'), false);
  is('a moment beyond the window is not nagged about', due.some((r) => r.id === 'm4'), false);
  is('the rest are listed, soonest brief first', due.map((r) => r.id), ['m1', 'm2']);
  is('each row carries the date its brief is due', due[0].briefBy, '2026-10-15');
  is('…and the day it goes live', due[0].live, '2026-11-05');
  is('a brand-wide moment counts as scoped', due[1].brandwide && due[1].scoped, true);
  is('an unscoped moment says so rather than reading as zero', due[0].scoped, false);
  is('a reserved key is never read as a brand', due.some((r) => r.client === '_meta'), false);
  // overdue leads, and it is named as overdue rather than as a negative number of days
  const late = KWE.dueList(store, {}, { now: '2026-10-20' });
  is('an overdue brief leads the list', late[0].id, 'm1');
  is('…and is marked overdue', late[0].overdue, true);

  // Ray, 14 Oct 2026: "only backdated the task for anything less than 20 days late ... anything
  // else above that should just be removed from this view" — a brief-by weeks past is a wrong
  // date, not a late task, and briefing it today lands work after the moment it was for.
  const stale = { Acme: { events: [
      { id: 's1', name: 'Nine days late', date: '2026-11-01' },       // brief-by 11 Oct
      { id: 's2', name: 'Twenty days late', date: '2026-10-21' },     // brief-by 30 Sep — the edge, kept
      { id: 's3', name: 'Forty-one days late', date: '2026-09-30' },  // brief-by 9 Sep
      { id: 's4', name: 'Sixty-three days late', date: '2026-09-08' } ] } };
  const win = KWE.dueList(stale, {}, { now: '2026-10-20' });
  is('a moment nine days past its brief-by is still offered', win.some((r) => r.id === 's1'), true);
  is('…and one exactly twenty days past is kept', win.some((r) => r.id === 's2'), true);
  is('a moment whose window went weeks ago is not listed', win.map((r) => r.id).sort(), ['s1', 's2']);
  is('…and the band is told how many were dropped, never silently shortened', win.stale, 2);
  is('the cap is stated once, as the engine’s own figure', KWE.STALE_DAYS, 20);
  is('…and can be lifted for a caller that wants the whole backlog',
    KWE.dueList(stale, {}, { now: '2026-10-20', stale: 0 }).length, 4);
  // the band must READ the count, or the removal is silent on the only screen it happens on
  is('Workflow’s band names what the window dropped', /kwd-stale[\s\S]{0,600}STALE_DAYS/.test(wf), true);
  is('…and the client filter never narrows that count', /all\.stale\s*=\s*dropped/.test(wf), true);

  /* ---- THE BRIEFED HALF (Ray, 15 Oct 2026: "with keywords calendar, also shown the briefed
     events (and status)"). The two lists are one tie read twice, so a moment is in exactly one
     of them and crosses over the instant its ticket exists — that is what keeps the band from
     becoming a second record of the work. ---- */
  const bstore = { Acme: { events: [
      { id: 'b1', name: 'Festive knitwear', date: '2026-11-05', terms: ['christmas jumper'] },
      { id: 'b2', name: 'Black Friday', date: '2026-11-20' },
      { id: 'b3', name: 'Winter sale', date: '2026-12-10' },
      { id: 'b4', name: 'Nobody has briefed this', date: '2026-11-28' } ] } };
  const bbriefs = {
    t1: { id: 'REIS-1', client: 'Acme', kw: 'b1', task: 'Keywords Optimisation - Festive', status: 'confirmed', by: 'Steven' },
    t2: { id: 'REIS-2', client: 'Acme', kw: 'b2', task: 'Keywords Optimisation - BF', status: 'blocked' },
    t3: { id: 'REIS-3', client: 'Acme', kw: 'b3', task: 'Keywords Optimisation - Sale', status: 'running' },
    t4: { id: 'OTHR-1', client: 'Other brand', kw: 'b4', task: 'Keywords Optimisation - theirs', status: 'briefed' } };
  const bl = KWE.briefedList(bstore, bbriefs, {});
  is('every moment with a ticket is listed', bl.map((r) => r.id).sort(), ['b1', 'b2', 'b3']);
  is('…and one with none is not — it belongs to the to-brief list', bl.some((r) => r.id === 'b4'), false);
  is('another brand’s ticket can never claim a moment here', bl.some((r) => r.ticket === 'OTHR-1'), false);
  // the two halves PARTITION the moments: no moment in both, none in neither
  const bdue = KWE.dueList(bstore, bbriefs, { now: '2026-10-14', stale: 0, days: 0 });
  is('no moment is in both lists', bdue.filter((d) => bl.some((x) => x.id === d.id)).length, 0);
  is('…and none falls between them',
    bdue.length + bl.length, bstore.Acme.events.length);
  // the stage is the ticket's own word, read where a brief really carries it
  is('the stage is read off b.status, the field a brief carries',
    ['b1', 'b2', 'b3'].map((id) => bl.filter((r) => r.id === id)[0].stage),
    ['confirmed', 'blocked', 'running']);
  is('a brief on the legacy b.st still reads',
    KWE.briefedList(bstore, { z: { id: 'Z', client: 'Acme', kw: 'b1', st: 'progress' } }, {})[0].stage, 'progress');
  is('a ticket with no stage at all reads as intake, never undefined',
    KWE.briefedList(bstore, { z: { id: 'Z', client: 'Acme', kw: 'b1' } }, {})[0].stage, 'intake');
  // whose court — one map, the calendar's own, now in the engine
  is('each row carries whose court it sits in', bl.filter((r) => r.id === 'b2')[0].court, 'AM');
  is('…off the engine’s one COURT map', KWE.COURT.briefed, 'ASPL');
  is('…which the calendar reads rather than keeping a second copy',
    /var COURTM\s*=\s*KWE\.COURT;/.test(fs.readFileSync(path.join(root, 'docs', 'FeedSpark_KWCal.html'), 'utf8')), true);
  is('a finished stage is marked done, so the band can count what is still moving',
    bl.filter((r) => r.done).map((r) => r.id), ['b1']);
  // earliest stage first: what is waiting on somebody leads, finished work sinks
  is('the least-advanced ticket leads', bl.map((r) => r.stage), ['blocked', 'running', 'confirmed']);
  is('the ticket and who raised it travel with the row',
    [bl[2].ticket, bl[2].by], ['REIS-1', 'Steven']);
  is('a client filter narrows it the same way',
    KWE.briefedList(bstore, bbriefs, { clients: ['Nobody'] }).length, 0);

  /* ---- A TICKET'S OWN DUE DATE (Ray, 15 Oct 2026: "when writting brief - changes due date is
     not reflected btw - this ticket should be 1610 instead of the default 2610"). ---- */
  is('a ticket’s due date is read off the record the composer writes (DD/MM/YYYY)',
    KWE.dueIso({ due: '16/10/2026' }), '2026-10-16');
  is('…and printed the way the band prints a date', KWE.dueLbl('2026-10-16'), '16 Oct');
  is('a ticket with no due date reads as none, never as today', KWE.dueIso({}), '');
  is('…and a day the calendar does not have is refused, never rolled into another real day',
    [KWE.dueIso({ due: '31/02/2026' }), KWE.dueIso({ due: '20/11/26' }), KWE.dueIso({ due: 'next week' })],
    ['', '', '']);
  {
    const dstore = { Acme: { events: [{ id: 'd1', name: 'Vans x SZA', date: '2026-10-26' }] } };
    const row = KWE.briefedList(dstore,
      { z: { id: 'SCH-1', client: 'Acme', kw: 'd1', due: '16/10/2026', status: 'intake' } }, {})[0];
    is('the row carries the date the AM set, not the moment’s own', row.dueLbl, '16 Oct');
    is('…and the moment’s live date is still there beside it', row.liveLbl, '26 Oct');
    is('a ticket with no due date of its own carries none, so the row can fall back honestly',
      KWE.briefedList(dstore, { z: { id: 'S', client: 'Acme', kw: 'd1', status: 'intake' } })[0].dueLbl, '');
  }
  is('the band prints the ticket’s date and says so', /r\.dueLbl\s*\n?\s*\?\s*'Due '/.test(wf)
    && /esc\(r\.dueLbl\|\|r\.liveLbl\)/.test(wf), true);

  // and the band must RENDER it, with Workflow's own stage words and no second → Brief
  is('Workflow’s band reads the briefed half', /briefedList\(STORE/.test(wf), true);
  is('…in Workflow’s own stage vocabulary, not a copy', /window\.FCCStages/.test(wf), true);
  is('…and a briefed row opens its ticket instead of offering a second brief',
    /data-kwt[\s\S]{0,400}window\.FCCTicket/.test(wf), true);
  is('the fold’s summary names a blocked ticket, so folding can never hide one',
    /blocked[\s\S]{0,120}parts\.push/.test(wf), true);

  /* ---- HOW MANY PRODUCTS, ON THE BRIEFED ROWS TOO (Ray, 15 Oct 2026: "In the brief section of
     the key work calendar, please also keep the number of products, along with status and who is
     handling it"). Read by the SAME volOf/hasScope the to-brief half uses, so one moment cannot
     read two different figures either side of being briefed. ---- */
  {
    const sstore = { Acme: { ptidx: { gb: { map: { Jumpers: 400, Coats: 90 }, __total: 1000 } },
      events: [
        { id: 'p1', name: 'Scoped', date: '2026-11-05', ptsm: { gb: ['Jumpers', 'Coats'] } },
        { id: 'p2', name: 'Whole shop', date: '2026-11-06', brandwide: 1 },
        { id: 'p3', name: 'Unscoped', date: '2026-11-07' }] } };
    const sb = { a: { id: 'A', client: 'Acme', kw: 'p1', status: 'running' },
      b: { id: 'B', client: 'Acme', kw: 'p2', status: 'briefed' },
      c: { id: 'C', client: 'Acme', kw: 'p3', status: 'blocked' } };
    const by = {}; KWE.briefedList(sstore, sb, {}).forEach((r) => { by[r.id] = r; });
    is('a briefed row carries the products its own scope resolves to', by.p1.vol, 490);
    is('…the same figure the to-brief half reads for that scope',
      KWE.dueList({ Acme: { ptidx: sstore.Acme.ptidx, events: [sstore.Acme.events[0]] } }, {},
        { now: '2026-10-14', stale: 0, days: 0 })[0].vol, by.p1.vol);
    is('…and the hours that go with it', by.p1.hours, KWE.kwHours(490));
    is('a brand-wide moment is marked brand-wide, so the band never prints a count for it',
      [by.p2.brandwide, by.p2.scoped], [true, true]);
    is('an unscoped one reads as unscoped, never as zero products',
      [by.p3.scoped, by.p3.vol], [false, null]);
    {
      const unsynced = KWE.briefedList({ Acme: { events: [{ id: 'p1', name: 'Scoped',
        date: '2026-11-05', ptsm: { gb: ['Jumpers'] } }] } },
        { a: { id: 'A', client: 'Acme', kw: 'p1' } }, {})[0];
      is('a scope nobody has synced yet is unmeasured, never 0 products',
        [unsynced.scoped, unsynced.vol], [true, null]);
    }
    is('the status and the court are still on the row beside it',
      [by.p3.stage, by.p3.court], ['blocked', 'AM']);
    // ONE builder on the page, or the two halves can word the same scope differently
    is('the band builds the cell once for both halves',
      (wf.match(/function scopeCell\(/g) || []).length === 1
        && /\+scopeCell\(E,r,false\)/.test(wf) && /\+scopeCell\(E,r,true\)/.test(wf), true);
  }

  /* ---- EVERY SEEDED SCOPE IS A PATH THE LIVE FEED REALLY SENDS (Ray, 14 Oct 2026: "can you
     scope up by choosing products on clients product type on all the keywords themes?").
     Reiss, Accessorize and Schuh carried 64 moments with no product scope; 51 now carry the exact
     primary g:product_type paths read off their own GB feed. The check cannot come from the seed:
     each brand's census is an INDEPENDENT read committed under ops/calendars/, so a mis-spelled
     path matches nothing real rather than matching its own mis-spelling. ---- */
  const CENSUS = { Reiss: 'reiss_gb_product_types_2026-10-14', Accessorize: 'accessorize_gb_product_types_2026-10-14',
    Schuh: 'schuh_gb_product_types_2026-10-14', Monsoon: 'monsoon_gb_product_types_2026-10-14',
    Hobbycraft: 'hobbycraft_gb_product_types_2026-10-19' };
  const seedSrc = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_KWCal.html'), 'utf8');
  const seedBlk = seedSrc.slice(seedSrc.indexOf('var SEED={'), seedSrc.indexOf('\n]}};', seedSrc.indexOf('var SEED={')));
  const brandSeg = (b) => {
    const at = seedBlk.indexOf(b + ':{events:[');
    if (at < 0) return '';
    const rest = seedBlk.slice(at + b.length + 10);
    const nxt = /\w[\w ]*:\{events:\[/.exec(rest);
    return nxt ? rest.slice(0, nxt.index) : rest;
  };
  const momentsOf = (seg) => {
    const out = [];
    const re = /\{id:["']([a-z0-9_]+)["']/g; let m;   // Monsoon's seed quotes its ids with "

    while ((m = re.exec(seg))) {
      // brace-match this moment so a pts: block can never be read off its neighbour
      let d = 0, q = null, j = m.index;
      for (; j < seg.length; j++) {
        const c = seg[j];
        if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
        if (c === "'" || c === '"') q = c;
        else if (c === '{') d++;
        else if (c === '}' && --d === 0) break;
      }
      out.push({ id: m[1], src: seg.slice(m.index, j + 1) });
    }
    return out;
  };
  const ptsIn = (src) => {
    const m = /pts:\[([\s\S]*?)\]\}/.exec(src);
    return m ? JSON.parse('[' + m[1] + ']') : null;
  };
  let strays = [], seeded = 0, scopedN = 0, unscoped = [];
  Object.keys(CENSUS).forEach((brand) => {
    const cen = JSON.parse(fs.readFileSync(path.join(root, 'ops', 'calendars',
      CENSUS[brand] + '.json'), 'utf8')).product_types;
    momentsOf(brandSeg(brand)).forEach((mo) => {
      const pts = ptsIn(mo.src);
      if (!pts) { if (!/brandwide:1/.test(mo.src)) unscoped.push(brand + '/' + mo.id); return; }
      scopedN++;
      pts.forEach((pt) => { seeded++; if (!cen[pt]) strays.push(brand + '/' + mo.id + ' → ' + pt); });
      // a scope that resolves to nothing is a scope that is not set
      const n = pts.reduce((a, pt) => a + (cen[pt] ? cen[pt].skus : 0), 0);
      if (!n) strays.push(brand + '/' + mo.id + ' → resolves to 0 SKUs');
    });
  });
  is('every seeded path exists in its brand\u2019s own live-feed census', strays.slice(0, 6), []);
  is('\u2026across all four seeded brands, and there are a lot of them',
    { enough: seeded > 1400, moments: scopedN }, { enough: true, moments: 70 });
  // and a moment left without one SAYS WHY — a card reading "no scope yet" with no reason is an
  // oversight; these are decisions (a material, a collection, an arrival cohort, an unnamed line list)
  const noReason = [];
  Object.keys(CENSUS).forEach((brand) => {
    momentsOf(brandSeg(brand)).forEach((mo) => {
      if (ptsIn(mo.src) || /brandwide:1/.test(mo.src)) return;
      if (!/(Deliberately unscoped|deliberately left unscoped)/.test(mo.src)) noReason.push(brand + '/' + mo.id);
    });
  });
  is('every moment still unscoped names the reason on its own card', noReason, []);
  is('\u2026and that is the small minority of them', unscoped.length, 14);

  // A MOMENT CAN TRACK A TICKET SOMEBODY ALREADY RAISED (Ray, 22 Oct 2026: "can you add this
  // ticket as a keywords theme in Reiss ? - it's \u201cNew Arrivals\u201d and start tracking it").
  // e.wf is the rung that beats every name match, so the seed carries the ref itself: the board
  // reads that ticket's stage and Workflow's to-brief band never offers the moment a second time.
  {
    const na = momentsOf(brandSeg('Reiss')).find((m) => m.id === 'rs_newarrivals');
    is('Reiss carries the New Arrivals moment', !!na, true);
    is('\u2026pinned to the ticket Ray forwarded, by its ibfref',
      /wf:'REIS-20261019-02'/.test(na.src), true);
    // the ticket's own ibfdue is the BRIEF-BY, so the live date is LEAD_DAYS after it
    const live = /date:'(\d{4}-\d{2}-\d{2})'/.exec(na.src)[1];
    is('\u2026and files under the month its brief was due, not the month it lands',
      KWE.schedDate({ date: live }).toISOString().slice(0, 10), '2026-10-23');
  }
  // Schuh's tree puts the BRAND at its leaf (Womens > Trainers > Nike), which is why a brand
  // launch scopes by product type at all — and why a scope must never cross into a rival's rows
  const schuh = momentsOf(brandSeg('Schuh'));
  const nike = ptsIn(schuh.find((m) => m.id === 'sch_nikekids').src);
  is('a brand launch scopes to that brand\u2019s own paths', nike.every((p) => /> (Nike|Nike Jordan)$/.test(p)), true);
  is('\u2026and a kids launch never reaches the adult tree',
    nike.every((p) => /^(Kids|Babies) > /.test(p)), true, nike.slice(0, 3));
  // a split spelling in the tree is carried whole or the scope silently drops products
  const reissCoats = ptsIn(momentsOf(brandSeg('Reiss')).find((m) => m.id === 'coats').src);
  is('a scope over a split product-type spelling carries both',
    reissCoats.some((p) => /Jackets & Coats/.test(p)) && reissCoats.some((p) => /[^s] & Coats/.test(p)), true);

  // the payload a Workflow row raises IS the payload the card raises — same task, same stamp
  const e1 = store.Acme.events[0];
  const pay = KWE.briefPayload(store, 'Acme', e1, 'gb');
  is('the brief carries the moment id, which is what stops a second ticket', pay.kw, 'm1');
  is('…the house task name', pay.task, 'Keywords Optimisation - Festive knitwear - Marketing Planner - 1126');
  is('…and the keyword category', pay.cat, 'keyword');
  // and once that brief exists, the moment leaves the list — the loop Ray asked for
  const after = KWE.dueList(store, { n1: { id: 'n1', client: 'Acme', kw: 'm1', task: pay.task } }, { now: '2026-10-14' });
  is('raising it in Workflow takes it off the to-brief list', after.some((r) => r.id === 'm1'), false);
}

/* ---- a moment ADDED to the seed after the board exists (Ray, 22 Oct 2026, asking for New
   Arrivals on Reiss — a board seeded since v1). upgradeSeeds matches BY ID, so a brand-new id
   reaches a fresh board and never an old one. addSeeds adds it once, and records the offer on
   the brand's own record so an AM's deletion is never undone. Lifted by name. ---- */
{
  const SEEDO = new Function(liftDecl('SEED') + '\nreturn SEED;')();
  const add = new Function('SEED', 'STORE',
    lift('addSeeds') + '\nreturn {n:addSeeds(),STORE:STORE};');
  const older = () => ({ Reiss: { events: (SEEDO.Reiss.events || [])
    .filter((e) => e.id !== 'rs_newarrivals')
    .map((e) => ({ id: e.id, name: e.name, lane: e.lane, date: e.date })) } });

  let st = older();
  let r = add(SEEDO, st);
  const got = r.STORE.Reiss.events.find((e) => e.id === 'rs_newarrivals');
  is('a new seed moment reaches a board that already has events', !!got, true);
  is('\u2026carrying its ticket link', got.wf, 'REIS-20261019-02');
  is('\u2026and the offer is recorded against the brand',
    (r.STORE.Reiss.seeded || []).includes('rs_newarrivals'), true);
  is('a second pass adds nothing', add(SEEDO, r.STORE).n, 0);

  // the rule that matters: a moment taken OFF the board stays off it
  st = r.STORE;
  st.Reiss.events = st.Reiss.events.filter((e) => e.id !== 'rs_newarrivals');
  const r2 = add(SEEDO, st);
  is('a moment the AM deleted is never put back',
    r2.STORE.Reiss.events.some((e) => e.id === 'rs_newarrivals'), false);

  // and the rest of a seed never migrates at all: it is there to furnish an EMPTY board, so a
  // moment removed from an old board before any record existed is not resurrected on this pass
  st = older();
  st.Reiss.events = st.Reiss.events.filter((e) => e.id !== 'precol');
  r = add(SEEDO, st);
  is('a seed moment not marked late is never added to an existing board',
    r.STORE.Reiss.events.some((e) => e.id === 'precol'), false);
  is('\u2026and only the late one is recorded as offered',
    r.STORE.Reiss.seeded, ['rs_newarrivals']);
}

/* ---- the seed reaching a board that already has events (Ray, 14 Oct 2026: "i dont see products
   being selected in scopes for Schuh btw"). applySeeds writes a seed only onto an EMPTY board, so
   a scope added to the seed after a brand's KV record existed could never land. upgradeSeeds fills
   it field by field, and the rule that matters is what it must NOT do. Lifted by name, run against
   the page's own SEED. ---- */
{
  const up = new Function('SEED', 'STORE', liftDecl('SEED') + '\n' + lift('upgradeSeeds')
    + '\nreturn {n:upgradeSeeds(),STORE:STORE};');
  const SEEDO = new Function(liftDecl('SEED') + '\nreturn SEED;')();
  const seedOf = (b, id) => (SEEDO[b].events || []).find((e) => e.id === id);
  const scoped = (SEEDO.Schuh.events || []).filter((e) => e.pts && e.pts.length);
  const bare = (b) => ({ [b]: { events: (SEEDO[b].events || []).map((e) => ({
    id: e.id, name: 'x', lane: e.lane, date: e.date, terms: ['x'] })) } });

  let st = bare('Schuh');
  let r = up(SEEDO, st);
  is('every scoped Schuh moment takes the seed’s paths', r.STORE.Schuh.events
    .filter((e) => e.pts && e.pts.length).length, scoped.length);
  is('…exactly the seed’s paths', JSON.stringify(r.STORE.Schuh.events
    .find((e) => e.id === scoped[0].id).pts), JSON.stringify(scoped[0].pts));
  is('…and a brand-wide moment is marked brand-wide', r.STORE.Schuh.events
    .filter((e) => e.brandwide).length, (SEEDO.Schuh.events || []).filter((e) => e.brandwide).length);
  is('a second pass writes nothing', up(SEEDO, r.STORE).n, 0);

  // what it must never do: touch a scope, or any wording, the board already carries
  st = bare('Schuh');
  const one = st.Schuh.events.find((e) => e.id === scoped[0].id);
  one.pts = ['Mine > Own']; one.name = 'Renamed by the AM'; one.date = '2027-03-01';
  const kept = st.Schuh.events.find((e) => e.id === scoped[1].id); kept.txsm = { gb: { qs: [{ q: 'x', n: 2 }] } };
  const wide = st.Schuh.events.find((e) => e.id === scoped[2].id); wide.brandwide = 1;
  r = up(SEEDO, st);
  const ev = r.STORE.Schuh.events.reduce((a, e) => (a[e.id] = e, a), {});
  is('a scope the AM set is left alone', JSON.stringify(ev[scoped[0].id].pts), JSON.stringify(['Mine > Own']));
  is('…a text filter counts as a scope too', ev[scoped[1].id].pts, undefined);
  is('…so does brand-wide', ev[scoped[2].id].pts, undefined);
  is('a rename on the board survives', ev[scoped[0].id].name, 'Renamed by the AM');
  is('…and a re-date', ev[scoped[0].id].date, '2027-03-01');

  // the note follows only where it is the seed's own note with more added to it
  st = bare('Schuh');
  const sd = seedOf('Schuh', scoped[0].id);
  st.Schuh.events.find((e) => e.id === scoped[0].id).note = 'Something the AM wrote';
  st.Schuh.events.find((e) => e.id === scoped[1].id).note = (seedOf('Schuh', scoped[1].id).note || '').slice(0, 20);
  r = up(SEEDO, st);
  const ev2 = r.STORE.Schuh.events.reduce((a, e) => (a[e.id] = e, a), {});
  is('a note somebody else wrote is never overwritten', ev2[scoped[0].id].note, 'Something the AM wrote');
  is('…but the seed’s own note, with the scope line added, is taken',
    ev2[scoped[1].id].note, seedOf('Schuh', scoped[1].id).note);
  is('…and an empty note takes the seed’s', (up(SEEDO, bare('Schuh')).STORE.Schuh.events
    .find((e) => e.id === scoped[0].id).note || '').indexOf(sd.note), 0);

  // an empty board is applySeeds' job, not this one — and a moment the seed never had is left be
  is('an empty board is left to applySeeds', up(SEEDO, { Schuh: { events: [] } }).n, 0);
  is('a moment the seed does not carry is untouched',
    up(SEEDO, { Schuh: { events: [{ id: 'sch_am_own', name: 'AM’s own', lane: 'sale', date: '2026-12-01' }] } }).n, 0);
}


/* ---- A CONDITION EITHER LAYERS OR STANDS ON ITS OWN (Ray, 16 Oct 2026: "This shouldn't be a
   condition based on the previous condition, but should continue to have a separate future. So
   either conditional layers conditions or a separate condition"). The chain rule lives in the
   engine; the counting lives on the page, so both are lifted and run over one invented feed. ---- */
{
  const SKUC = {};
  const scope = new Function('KWE', 'SKUC',
    `${liftDecl('KW_ATTRS')}
     ${lift('txWords')} ${lift('txHit')}
     function skuCache(b,m){ var c=SKUC[b+'|'+m]; return c&&c.rows?c.rows:null; }
     ${lift('condSat')} ${lift('scopeCount')} ${lift('attrsPresent')} ${lift('attrIndex')}
     return { scopeCount:scopeCount, attrIndex:attrIndex, condSat:condSat };`)(KWE, SKUC);

  // row = [primary product_type, title+description, keyworded?, per-attr values in KW_ATTRS order]
  // colour sits at index 3 of KW_ATTRS (gender, age_group, material, color, …)
  const row = (pt, txt, col) => [pt, txt, 0, ['', '', '', col, '', '', '', '', '']];
  SKUC['Accessorize|gb'] = { rows: [
    row('Jewellery', 'halloween skull necklace', 'black'),      // the text filter finds it
    row('Jewellery', 'halloween pumpkin ring', 'orange'),       // text + colour
    row('Bags', 'everyday tote', 'black'),                      // colour only
    row('Bags', 'everyday tote', 'navy'),                       // neither
    row('Scarves', 'halloween wrap', 'navy'),                   // text only
  ] };
  const txq = ['halloween'], COL = { attr: 'color', vals: ['black', 'orange'] };

  is('the text filter alone finds three', scope.scopeCount('Accessorize', 'gb', [], txq, []).uni, 3);
  is('a condition that NARROWS takes products away',
    scope.scopeCount('Accessorize', 'gb', [], txq, [{ ...COL, join: 'and' }]).uni, 2);
  is('…and a stored condition with no join reads as narrowing, so no saved scope moves',
    scope.scopeCount('Accessorize', 'gb', [], txq, [{ ...COL }]).uni, 2);
  is('a SEPARATE condition adds its own products instead',
    scope.scopeCount('Accessorize', 'gb', [], txq, [{ ...COL, join: 'or' }]).uni, 4);
  is('…which is the union, never the whole catalogue',
    scope.scopeCount('Accessorize', 'gb', [], txq, [{ ...COL, join: 'or' }]).uni < 5, true);
  is('the text filter’s own count is unchanged by a separate condition',
    scope.scopeCount('Accessorize', 'gb', [], txq, [{ ...COL, join: 'or' }]).ns[0], 3);

  // a separate condition can itself be layered on
  const sep2 = [{ ...COL, join: 'or' }, { attr: 'gender', vals: ['x'], join: 'and' }];
  is('a condition layered onto a separate one narrows THAT chain, not the text filter',
    scope.scopeCount('Accessorize', 'gb', [], txq, sep2).uni, 3);

  // with no PT and no text, the first condition is read against the catalogue
  is('a condition with no base is the catalogue, narrowed',
    scope.scopeCount('Accessorize', 'gb', [], [], [{ ...COL }]).uni, 3);

  // the value list a separate condition is built from is the catalogue, not the chain above it
  const rows = SKUC['Accessorize|gb'].rows;
  is('a narrowing condition counts its values inside the scope',
    scope.attrIndex(rows, 'color', [], txq, [{ attr: 'color', vals: [], join: 'and' }], 0).navy, 1);
  is('…a separate one counts them across the catalogue',
    scope.attrIndex(rows, 'color', [], txq, [{ attr: 'color', vals: [], join: 'or' }], 1).navy, 2);

  // the chain rule itself
  // A FIRST CONDITION IS SEPARATE FROM THE PT/TEXT SCOPE (Ray, 16 Oct 2026: "i dont see separate
  // condition option btw" — on a scope whose only other part was a text filter)
  is('the first condition alone can stand apart from the text filter',
    scope.scopeCount('Accessorize', 'gb', [], txq, [{ ...COL, join: 'or' }]).uni, 4);
  is('…and chain 0 keeps the text filter with no condition on it',
    KWE.condChains([{ attr: 'color', join: 'or' }], true).map((c) => c.base + ':' + c.conds.length + ':' + c.live).join(' | '),
    'true:0:true | false:1:true');

  const ch = KWE.condChains([{ attr: 'a' }, { attr: 'b', join: 'or' }, { attr: 'c' }], true);
  is('a chain starts at an OR and runs to the next one', ch.length, 2);
  is('…chain 0 keeps the PT/text base', ch[0].base, true);
  is('…a later chain never does', ch[1].base, false);
  is('…and carries the conditions layered onto it', ch[1].conds.length, 2);
  is('a leading OR leaves chain 0 with nothing to do',
    KWE.condChains([{ attr: 'b', join: 'or' }], false)[0].live, false);
  is('chain indices line up with condChainOf',
    [0, 1, 2].map((i) => KWE.condChainOf([{ attr: 'a' }, { attr: 'b', join: 'or' }, { attr: 'c' }], i)).join(','),
    '0,1,1');

  // THE BRIEF IS DUE WHEN THE MOMENT GOES LIVE, not when it is briefed
  {
    const st = { A: { events: [], ptidx: { gb: { map: {}, __total: 10 } } } };
    const p1 = KWE.briefPayload(st, 'A', { id: 'x', name: 'Sparkle', date: '2026-11-08', terms: ['a'] }, 'gb');
    is('the payload carries the live-by date as the due date', p1.due, '2026-11-08');
    is('…which is NOT the brief-by date the board files it under',
      p1.due === p1.scope.match(/brief by [^\n]*/)[0], false);
    const p2 = KWE.briefPayload(st, 'A', { id: 'y', name: 'No date', date: 'next week', terms: [] }, 'gb');
    is('a moment with no readable date carries no due at all', p2.due === undefined, true);
  }

  // the brief says which kind each condition is — a reader cannot see a chip
  const bp = KWE.briefPayload({ Accessorize: { events: [], ptidx: { gb: { map: { Jewellery: 2 }, __total: 5 } } } },
    'Accessorize', { id: 'x', name: 'Halloween', date: '2026-10-25', terms: ['halloween'],
      cndm: { gb: { conds: [{ attr: 'color', vals: ['black'], join: 'and' },
                            { attr: 'material', vals: ['felt'], join: 'or' }], uni: 4 } } }, 'gb');
  is('the brief lists the conditions', bp.scope.indexOf('• color = black') > 0, true);
  is('…and a separate one as its own set', bp.scope.indexOf('OR (its own set) material = felt') > 0, true);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }
console.log('PASS');
