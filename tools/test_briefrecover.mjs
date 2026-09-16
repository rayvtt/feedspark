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
import { briefFromEmail, recoverBriefsFromEmail } from '../cloudflare/feedspark-deck/src/briefmatch.js';

let pass = 0; const fails = [];
const is = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); } else { fails.push(`${name}\n      got  ${g}\n      want ${w}`); }
};

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

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }
console.log('PASS');
