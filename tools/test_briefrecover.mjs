#!/usr/bin/env node
/*
 * The brief email is the backup copy of the ticket (Ray, 16 Sep 2026).
 *
 * "when Steven starts briefing using the FCC module, but also includes me in the brief email so
 *  I receive a copy — would you be able to scan that and log it back in the FCC from Steven's
 *  work?"  Yes: the Apps Script already searches `subject:"[FS Brief]"`, so those messages
 * already reach the worker. They were dropped because the reply matcher skips our own outgoing
 * mail and because no ticket existed to match. This rebuilds the ticket from the email.
 *
 * The fixture is the REAL message from Ray's screenshot (subject verbatim) plus the body
 * bodyOf() writes, so a change to either format fails here rather than in his inbox.
 *
 * Run: node tools/test_briefrecover.mjs
 */
import { briefFromEmail, recoverBriefsFromEmail, matchGmailToBriefs } from '../cloudflare/feedspark-deck/src/briefmatch.js';
import { readFileSync } from 'node:fs';

let pass = 0; const fails = [];
const is = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); } else { fails.push(`${name}\n      got  ${g}\n      want ${w}`); }
};
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name); } else fails.push(name); };

// verbatim from the Gmail screenshot
const SUBJ = '[FS Brief] Reiss · Keywords Optimisation - Cashmere/Merino - Marketing Planner - 0926 · [ibfcode:reiss-gb] ibfdue:15092026 [ibfref:REIS-20260910-02]';
const BODY = [
  '[ibfcode:reiss-gb] ibfdue:15092026 [ibfref:REIS-20260910-02]',
  '',
  'FEEDSPARK BRIEF — REIS-20260910-02',
  'Client:    Reiss  [reiss-gb]',
  'Due:       15 September 2026  (15092026)',
  'AM:        Ray · London',
  'Source:    Project plan (monthly)',
  'Priority:  High',
  '──────────────────────────────',
  'TASK',
  'Keywords Optimisation - Cashmere/Merino - Marketing Planner - 0926',
  '',
  'SCOPE / DETAIL',
  '1,451 products · Cashmere & Merino product types',
  'Themes: cashmere, merino, knitwear, jumper',
  '',
  'DEFINITION OF DONE',
  'Keywords live in g:product_type2..10, feed pushed',
  '',
  'ASSETS / LINKS',
  'https://example.com/keywords.xlsx',
  '──────────────────────────────',
  'ASPL team — reply-all to this thread to update status.',
].join('\n');
const MSG = { id: 'm1', from: 'Steven <steven@feedspark.com>', subject: SUBJ, snippet: BODY, date: 1757462400000 };

// ---------- the parse ----------
const r = briefFromEmail(MSG);
is('the ticket id comes off the ibfref', r && r.id, 'REIS-20260910-02');
is('the client comes off the body, not the slug', r && r.client, 'Reiss');
is('the market comes off the code', r && r.market, 'gb');
is('the task is the TASK section verbatim', r && r.task, 'Keywords Optimisation - Cashmere/Merino - Marketing Planner - 0926');
is('the due date is un-packed from ibfdue', r && r.due, '15/09/2026');
is('scope survives', r && /1,451 products/.test(r.scope), true);
is('definition of done survives', r && /feed pushed/.test(r.dod), true);
is('assets survive', r && /keywords\.xlsx/.test(r.assets), true);
is('priority survives', r && r.priority, 'High');
is('who briefed it comes off the sender', r && r.by, 'Steven');

// ---------- what it must refuse ----------
is('a REPLY is a status update, not the brief', briefFromEmail({ ...MSG, subject: 'RE: ' + SUBJ }), null);
is('a forward too', briefFromEmail({ ...MSG, subject: 'Fwd: ' + SUBJ }), null);
is('an ordinary email is not a brief', briefFromEmail({ ...MSG, subject: 'Re: catch up tomorrow', snippet: 'hi' }), null);
is('no ibfref → no id to trust', briefFromEmail({ ...MSG, subject: '[FS Brief] Reiss · Titles · [ibfcode:reiss-gb]', snippet: 'TASK\nTitles' }), null);
is('two ibfrefs → ambiguous, never guess',
  briefFromEmail({ ...MSG, subject: SUBJ + ' [ibfref:REIS-20260910-03]' }), null);
is('no ibfcode → no market, no ticket', briefFromEmail({ ...MSG, subject: '[FS Brief] Reiss · X · [ibfref:REIS-1]', snippet: 'TASK\nX' }), null);

// ---------- create-only ----------
let store = {};
is('a missing ticket is rebuilt', recoverBriefsFromEmail(store, [MSG]).map((x) => x.id), ['REIS-20260910-02']);
is('it lands in ASPL’s court — the email going out IS the briefing', store['REIS-20260910-02'].status, 'briefed');
is('it is marked as rebuilt from the email', store['REIS-20260910-02'].rec, 'email');
is('and carries who briefed it', store['REIS-20260910-02'].by, 'Steven');
is('running it again creates nothing', recoverBriefsFromEmail(store, [MSG]), []);

// a ticket that has since MOVED must never be reset by its own original email
store['REIS-20260910-02'].status = 'analysis';
store['REIS-20260910-02'].comms = [{ t: 'read-out attached' }];
recoverBriefsFromEmail(store, [MSG]);
is('an existing ticket is never touched', store['REIS-20260910-02'].status, 'analysis');
is('…and keeps its history', store['REIS-20260910-02'].comms.length, 1);

// the two Ray actually lost, recovered together, from one sync
store = {};
const GIFT = {
  id: 'm2', from: 'Steven <steven@feedspark.com>', date: 1757721600000,
  subject: '[FS Brief] Reiss · Keywords Optimisation - Gifting - Marketing Planner - 1026 · [ibfcode:reiss-gb] ibfdue:29092026 [ibfref:REIS-20260910-03]',
  snippet: ['[ibfcode:reiss-gb] ibfdue:29092026 [ibfref:REIS-20260910-03]', '', 'Client:    Reiss  [reiss-gb]',
    'Priority:  Normal', 'TASK', 'Keywords Optimisation - Gifting - Marketing Planner - 1026', '', 'SCOPE / DETAIL', 'Gifting range'].join('\n'),
};
is('both of the lost briefs come back in one pass',
  recoverBriefsFromEmail(store, [MSG, GIFT]).map((x) => x.task.split(' - ')[1]).sort(), ['Cashmere/Merino', 'Gifting']);
is('and the store now has exactly those two', Object.keys(store).sort(), ['REIS-20260910-02', 'REIS-20260910-03']);

// ---------- THE 8 SEP SUPERDRY BRIEF (Ray, 23 Sep 2026) ----------
/* "This brief sent by Steven using FCC is not in my brief ledger. Why? every brief sent out by
   anyone using FCC have to be documented in my view brief ledger."
   Three links, each on its own enough to lose it. The fixture is the REAL thread: Steven's
   original of 8 Sep with Ray copied, and vimalesh's read-out on the same thread today. */
const DAY = 86400000, NOW = Date.parse('2026-09-23T12:00:00Z');
const SUP_SUBJ = '[FS Brief] Superdry · Keyword Optimisation for Everest Jackets in CL3 · [ibfcode:superdry-gb] ibfdue:13092026 [ibfref:SUPE-20260908-01]';
const SUP_ORIG = {
  id: 'sup1', from: 'Steven Opuni <steven@feedspark.com>', subject: SUP_SUBJ, date: NOW - 15 * DAY,
  snippet: ['[ibfcode:superdry-gb] ibfdue:13092026 [ibfref:SUPE-20260908-01]', '',
    'FEEDSPARK BRIEF — SUPE-20260908-01', 'Client:    Superdry  [superdry-gb]',
    'Due:       Sun, 13 September 2026  (13092026)', 'AM:        Ray · London',
    'Source:    Email (ad-hoc)', 'Priority:  Normal', '',
    'TASK', 'Keyword Optimisation for Everest Jackets in CL3', '',
    'SCOPE / DETAIL',
    'Keyword optimisation — inject high-volume/search-intent terms into products labeled "Everest Jackets" in UK custom label 3', '',
    'DEFINITION OF DONE',
    'Keywords live, mapped to the right attribute, QA\'d against duplicate/over-stuffing rules; before/after sample shared.'].join('\n'),
};
const SUP_REPLY = {
  id: 'sup2', from: 'vimalesh <vimalesh@feedspark.com>', subject: 'Re: ' + SUP_SUBJ, date: NOW - 4 * 3600000,
  snippet: ['Hi Ray,', '', 'Please find below the results of the Keywords Optimisation Test,', '',
    'Batch Size: 992 Products', 'Total uplift: 207%'].join('\n'),
};

// [1] the Apps Script's own gate, lifted by name — it decides which messages ever reach the worker
const gs = readFileSync(new URL('./gmail_push.gs', import.meta.url), 'utf8');
/* lifted by NAME, so a rename or a deletion reports itself instead of crashing the run */
const isBriefOriginal = (function () {
  const at = gs.indexOf('function isBriefOriginal');
  if (at < 0) return null;
  const end = gs.indexOf('\n}', at);
  if (end < 0) return null;
  try { return new Function(gs.slice(at, end + 2) + '\nreturn isBriefOriginal;')(); } catch (e) { return null; }
})();
ok(!!isBriefOriginal, 'the Apps Script carries the isBriefOriginal gate');
is('the brief original is recognised as the brief', !!isBriefOriginal && isBriefOriginal(SUP_SUBJ), true);
is('its reply is not — a reply is a status update', !!isBriefOriginal && isBriefOriginal(SUP_REPLY.subject), false);
const briefAge = /BRIEF_MAX_AGE_MS = (\d+)/.exec(gs);
ok(briefAge && +briefAge[1] * 24 * 3600000 > 15 * DAY,
  'and a 15-day-old original clears the age gate its thread already passed');
ok(/isBriefOriginal\(subj\) \? BRIEF_MAX_AGE_MS : MAX_AGE_MS/.test(gs),
  'the gate is applied per message in pushBriefReplies — replies keep the 7-day window');

// [2] recover BEFORE match, or the reply in the same batch hits a store with no ticket in it
const batch = [SUP_ORIG, SUP_REPLY];
let st = {};
recoverBriefsFromEmail(st, batch, { now: NOW });
matchGmailToBriefs(st, batch, { now: NOW, selfRe: /ray@feedspark\.com/i, aspl: ['Dinesh', 'Thia', 'Mariraj', 'Muji', 'vimalesh'] });
const T = st['SUPE-20260908-01'];
ok(!!T, 'the ticket Ray could not find is rebuilt from its own brief email');
is('with the task Steven wrote', T && T.task, 'Keyword Optimisation for Everest Jackets in CL3');
is('the client off the body’s Client: line', T && T.client, 'Superdry');
is('and the scope, which a 1200-char snippet would have cut off',
  !!(T && /custom label 3/.test(T.scope || '')), true);
ok(T && (T.comms || []).length > 0,
  'and it carries the read-out from its own thread — not stranded at Briefed with nothing under it');

// the pre-fix order, recorded verbatim: this is what lost it
let pre = {};
matchGmailToBriefs(pre, batch, { now: NOW, selfRe: /ray@feedspark\.com/i, aspl: ['vimalesh'] });
recoverBriefsFromEmail(pre, batch, { now: NOW });
is('matching first rebuilt the same ticket…', Object.keys(pre), ['SUPE-20260908-01']);
is('…but silently dropped the reply, and message-id dedupe means it never comes back',
  (pre['SUPE-20260908-01'].comms || []).length, 0);

// [3] the worker calls them in that order on BOTH lanes
const wk = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
const order = [...wk.matchAll(/(recoverBriefsFromEmail|matchGmailToBriefs)\(briefs, messages/g)].map((m) => m[1]);
is('every lane recovers before it matches', order,
  ['recoverBriefsFromEmail', 'matchGmailToBriefs', 'recoverBriefsFromEmail', 'matchGmailToBriefs']);

// [4] the retroactive sweep exists and is resumable — nothing above reaches backwards
ok(/function backfillBriefs\(/.test(gs), 'backfillBriefs() sweeps the briefs sent before any of this');
ok(/props\.setProperty\(BRIEF_BACKFILL_PROP/.test(gs), 'it saves its cursor every page, so a timeout never restarts the year');
ok(/subject:"\[FS Brief\]" after:/.test(gs), 'it searches on the brief subject, from a dated floor');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }
console.log('PASS');
