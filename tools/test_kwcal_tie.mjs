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
const body = [liftVar('MONI'), liftDecl('TASK_STOP'), liftLine('WFC'),
  lift('normTask'), lift('kwTask'), lift('taskWords'), lift('sigWords'), lift('nameScore'),
  lift('wfReset'), lift('wfBuild'), lift('wfAll'), lift('wfFor'), lift('wfHow'),
  lift('isKwTicket'), lift('looseKw'), lift('periodWin'),
  lift('ticketRes'), lift('roundRes'), lift('resFor')].join('\n');
const api = new Function('MON', 'LEAD_DAYS', 'evMkt', 'schedDate', 'getB', 'getR', 'getEvs',
  `${body}
   var BRIEFS, KWRES;
   var evsOf = getEvs;
   return { wfFor:function(b,e){ BRIEFS=getB(); wfReset(); return wfFor(b,e); },
            wfHow:function(b,e){ BRIEFS=getB(); wfReset(); return wfHow(b,e); },
            looseKw:function(b){ BRIEFS=getB(); wfReset(); return looseKw(b); },
            resFor:function(b,e){ BRIEFS=getB(); KWRES=getR(); wfReset(); return resFor(b,e); },
            periodWin:periodWin, kwTask:kwTask, normTask:normTask };`
)(MON, LEAD_DAYS, evMkt, schedDate, () => BRIEFS, () => KWRES,
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
const W = (p, when) => { const w = api.periodWin({ period: p, when }); return w && [new Date(w.a).toISOString().slice(0, 10), new Date(w.b).toISOString().slice(0, 10), w.label]; };
is('1st half of a month', W('Aug I', Date.UTC(2026, 7, 20)), ['2026-08-01', '2026-08-15', 'Aug 2026 · 1st half']);
is('2nd half of a month', W('Aug II', Date.UTC(2026, 7, 31)), ['2026-08-16', '2026-08-31', 'Aug 2026 · 2nd half']);
is('whole month when no numeral', W('Sep', Date.UTC(2026, 8, 30)), ['2026-09-01', '2026-09-30', 'Sep 2026']);
is('February respects the month length', W('Feb II', Date.UTC(2026, 1, 27)), ['2026-02-16', '2026-02-28', 'Feb 2026 · 2nd half']);
is('a December batch reported in January keeps its year', W('Dec II', Date.UTC(2027, 0, 6)), ['2026-12-16', '2026-12-31', 'Dec 2026 · 2nd half']);
is('an unparseable period is no window', api.periodWin({ period: 'whenever', when: Date.now() }), null);

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
is('the corrected / unconfirmed dates carry their reason', ACC.filter((e) => e.note).map((e) => e.id).sort(),
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

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }
console.log('PASS');
