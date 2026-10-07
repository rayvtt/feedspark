#!/usr/bin/env node
/*
 * CALL WRAP-UP — the note back to the client after a call (Ray, 24 Sep 2026).
 *
 * "when actions are parsed from Gemini transcript and added inside the task — e.g. these
 *  hobbycraft actions from latest call two hours ago — within the playbook for hobbycraft there
 *  should be a red message: Wrap up latest call actions for client's email … After a call, an
 *  action is added to the project plan; I also need to send a wrap-up … pre-write the emails.
 *  Add a table of actions from the call after AM has tidying up, then ask AM if they want to
 *  send it, and obviously draft directly on FCC or on Gmail."
 *
 * The actions already reach the project plan. This is the other half of the same five minutes.
 * The judgements pinned here are the ones that decide whether a client ever sees something they
 * should not have: the email is built from the rows the AM LEFT TICKED and from the text they
 * EDITED, never from the raw parse — which on the real Hobbycraft call is ten internal
 * instructions, most of them truncated mid-sentence and one of them a note to ask a colleague
 * about someone's availability.
 *
 * Run: node tools/test_callwrap.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const WF = rd('docs/FeedSpark_Workflow.html');
const SS = rd('cloudflare/feedspark-deck/src/sharedstate.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  (got ' + JSON.stringify(a) + ')');

// ---- lift the engine, whole, by name -----------------------------------------------------------
const S = WF.indexOf('/* PBENGINE:START'), E = WF.indexOf('/* PBENGINE:END */');
if (S < 0 || E < 0) { console.error('✗ PBENGINE markers missing'); process.exit(1); }
const names = ['wrapCalls', 'wrapDue', 'wrapEmail', 'wrapGreet', 'wrapKey', 'WRAP_DAYS', 'WRAP_ROLE'];
let EN;
try { EN = new Function(WF.slice(S, E) + '\n;return {' + names.map((n) => n + ':' + n).join(',') + '};')(); }
catch (e) { console.error('✗ the engine does not stand on its own: ' + e.message); process.exit(1); }
const { wrapCalls, wrapDue, wrapEmail, wrapGreet, WRAP_DAYS } = EN;

const DAY = 86400000, NOW = Date.parse('2026-09-24T14:00:00Z');
/* the REAL Hobbycraft call from Ray's screenshot — truncations and all, because the truncations
   are the reason the tidy-up step exists */
const MID = 'm-hob';
const RAW = [
  ['Matt Rogers', 'Contact Support Department: Verify if the customer support'],
  ['Ray Vu',      'Check Video Feed: Verify if product videos are included in the'],
  ['Jeremy Green','Consult Alex J: Ask Alex J about the availability of'],
  ['Matt Rogers', 'Finalize Proposal: Complete and polish the deck and quote'],
];
const calls = RAW.map(([owner, task], i) => ({ id: MID + '#' + i, mid: MID, call: 'Hobbycraft x FeedSpark — catch-up',
  client: 'Hobbycraft', when: NOW - 2 * 3600000, owner, task }));
// a second, older call on the same account, and one belonging to somebody else
calls.push({ id: 'm-old#0', mid: 'm-old', call: 'Hobbycraft quarterly', client: 'Hobbycraft',
  when: NOW - 20 * DAY, owner: 'Ray', task: 'Send the Q3 deck' });
calls.push({ id: 'm-oth#0', mid: 'm-oth', call: 'Reiss sync', client: 'Reiss', when: NOW, owner: 'Ray', task: 'x' });

console.log('\n── a call is the unit a wrap-up is written about');
const g = wrapCalls(calls, 'Hobbycraft', {}, NOW);
eq(g.length, 2, 'two calls on this account, grouped by their own notes-email id');
eq(g[0].mid, MID, 'newest first — the one Ray is looking at');
eq(g[0].actions.length, 4, 'carrying every action from that call');
ok(!g.some((x) => x.client === 'Reiss'), "another account's call never appears on this brand");
eq(wrapCalls(calls, 'hobbycraft', {}, NOW).length, 2, 'the brand match is case/spacing-blind');

console.log('\n── red is earned by ONE recent unwrapped call, never by a standing backlog');
const d = wrapDue(g);
eq(d.due.length, 1, 'the 2-hour-old call is due');
eq(d.top.mid, MID, '…and it is the one the banner names');
eq(d.stale.length, 1, 'the 20-day-old one is stale, not red — the moment to wrap it has passed');
ok(WRAP_DAYS === 7, 'the window is a week (WRAP_DAYS)');
const boundary = wrapCalls([{ id: 'b#0', mid: 'b', call: 'c', client: 'H', when: NOW - 8 * DAY, task: 't' }], 'H', {}, NOW);
eq(wrapDue(boundary).due.length, 0, 'a call just past the week does not raise the alarm');
eq(wrapDue(boundary).stale.length, 1, '…but is still counted, not hidden');

console.log('\n── a wrap-up sent by ANYONE stops the whole team being asked for it');
const after = wrapDue(wrapCalls(calls, 'Hobbycraft', { [MID]: { client: 'Hobbycraft', at: NOW, by: 'Steven', to: 'j@h.co.uk', n: 3 } }, NOW));
eq(after.due.length, 0, 'the prompt clears once it is wrapped');
eq(after.done, 1, '…and the call is counted as done');

console.log('\n── the email is what the AM LEFT, never what the parser produced');
const rows = g[0].actions.map((a) => ({ on: true, owner: a.owner, task: a.task }));
rows[2].on = false;                                   // the internal "ask Alex J about availability"
rows[0].task = 'Confirm with your support team whether product videos can be supplied';
const e = wrapEmail(g[0], rows, { tone: 'consult', me: 'ray@feedspark.com', name: 'Jeremy' });
eq(e.n, 3, 'the unticked row is not counted');
ok(e.text.indexOf('Alex J') < 0, 'an internal note the AM dropped never reaches the client');
ok(e.text.indexOf('Confirm with your support team') > 0, 'the EDITED wording is what goes out');
ok(e.text.indexOf('Verify if the customer support') < 0, '…and the truncated parse does not');
ok(/^Hi Jeremy,/.test(e.text), 'it greets the contact');
ok(e.text.indexOf('Ray') > 0, 'and signs off as whoever is drafting');
/* Ray's own wrap-up subject is "Hobbycraft x FeedSpark - SEO & AI convo - Sept24": the meeting's
   own name plus the day. The brand is prefixed only when the title does not already carry it. */
ok(e.subject.indexOf('Hobbycraft x FeedSpark') === 0, 'subject leads with the meeting: ' + e.subject);
ok(/ - [A-Z][a-z]+\d{1,2}$/.test(e.subject), '…and ends on the day of the call');
ok(e.subject.indexOf('Hobbycraft') === e.subject.lastIndexOf('Hobbycraft'),
  'the brand is never printed twice — the meeting title already said it');
const eBare = wrapEmail({ ...g[0], call: 'Weekly catch-up' }, rows,
  { tone: 'consult', me: 'ray@feedspark.com', name: 'Jeremy' });
ok(eBare.subject.indexOf('Hobbycraft x FeedSpark - Weekly catch-up') === 0,
  'a meeting titled without the brand gets it prefixed: ' + eBare.subject);
const eTeam = wrapEmail(g[0], rows, { tone: 'consult', me: 'ray@feedspark.com', name: '' });
ok(/^Hi team,/.test(eTeam.text), 'a shared mailbox is greeted as the group it is, not with a bare "Hi,"');
ok(eTeam.text.indexOf('It was great speaking to everyone on the call') > 0,
  'and the opening is the one Ray writes');
ok(eTeam.text.indexOf('attached as a table') < 0, 'no table promised when none is attached');
const eTab = wrapEmail(g[0], rows, { tone: 'consult', me: 'ray@feedspark.com', table: true });
ok(eTab.text.indexOf('attached as a table') > 0, 'and promised when one is');
ok(eTab.text.indexOf('Confirm with your support team') > 0,
  'the numbered list stays in the text either way — an attachment is not always shown, never '
  + 'searchable, and never readable in a phone preview');
ok(/1\. .*\n2\. /.test(e.text), 'the actions are numbered in the order the AM left them');
ok(e.text.indexOf('(Matt Rogers)') > 0, 'each carries its owner');

const blank = wrapEmail(g[0], rows.map((r) => ({ ...r, on: false })), {});
eq(blank.n, 0, 'ticking nothing composes nothing to send');
const empty = wrapEmail(g[0], [{ on: true, task: '   ', owner: 'x' }], {});
eq(empty.n, 0, 'a row emptied to whitespace is not an action');

console.log('\n── two tones, the house rule for any client email');
const direct = wrapEmail(g[0], rows, { tone: 'direct', me: 'ray@feedspark.com', name: 'Jeremy' });
ok(direct.text !== e.text, 'direct reads differently from collaborative');
ok(direct.text.length < e.text.length, '…and shorter');
ok(direct.text.indexOf('Confirm with your support team') > 0, 'both carry the same actions');

console.log('\n── a shared mailbox is never greeted by name');
eq(wrapGreet('jeremy@hobbycraft.co.uk'), 'Jeremy', 'a person gets their name');
eq(wrapGreet('jeremy.green@hobbycraft.co.uk'), 'Jeremy', '…including firstname.lastname');
eq(wrapGreet('info@hobbycraft.co.uk'), '', '"Hi Info," is worse than no name');
eq(wrapGreet('ecommerce@hobbycraft.co.uk'), '', '…same for a team address');
eq(wrapGreet('jg2@hobbycraft.co.uk'), '', 'anything with a digit is not a first name');
eq(wrapGreet(''), '', 'no address, no greeting');

console.log('\n── the wiring a source read has to hold');
ok(/callwrap:\s*'field'/.test(SS), "the store is a TEAM namespace ('field'-scoped), not a browser note");
ok(/window\.FCCCalls\s*=\s*function/.test(WF), 'the call actions are bridged across the script blocks by name');
ok(/window\.FCCCalls\?window\.FCCCalls\(\)/.test(WF), '…and the rail reads them through that bridge');
ok(/if\(window\.FCCSolo\)window\.FCCSolo\('cw-scrim'\)/.test(WF),
  'the workbench opens through the soloModal bridge — it is in another script block');
ok(/<div class="scrim" id="cw-scrim">/.test(WF),
  'it is a .scrim, so it inherits one-modal-at-a-time and the rail-aware centring');
ok(WF.indexOf('secWrap(BRAND)+secPractice(BRAND)') > 0, 'the prompt leads the Review tab');
ok(/'\/api\/labels\/askdraft'/.test(WF) && /keys:\['callwrap\|'\+g\.mid\]/.test(WF),
  'drafting rides the shared ask rails — a Gmail DRAFT, never a send');
ok(/markOnly:true/.test(WF), 'the Gmail path records the contact without queueing a second draft');
ok(/document\.addEventListener\('fcc-calls'/.test(WF),
  'the rail re-renders when call notes land, rather than waiting for the next poll');
ok(/'<option value="'\+esc\(b\)\+'"/.test(WF),
  'the picker marks brands with a call waiting, and keeps the bare brand as the option VALUE');


console.log('\n── the action table (Ray, 24 Sep 2026: "including the screenshot")');
/* wpWrap is pure given a measuring context, so it is lifted by name and run against a stub whose
   every character is 7px wide: it pins the wrapping CONTRACT — at most the lines the row is built
   for, none of them wider than what it was given, and a cut one says so.
   It would NOT have caught the bug that shipped here, which is worth saying plainly: wpWrap did
   exactly what it was told, and what it was told was 530px for a column 442px wide, so the action
   text ran straight through the owner's name. Only a rendered look found it. What stops it coming
   back is the assertion below — that the width is DERIVED from the gap to the next column and
   never typed a second time. */
let WP = null;
const wS = WF.indexOf('function wpWrap(');
if (wS > 0) {
  const wE = WF.indexOf('\n  function wrapPng(', wS);
  try { WP = new Function(WF.slice(wS, wE) + '\n;return wpWrap;')(); } catch (e) { WP = null; }
}
ok(!!WP, 'wpWrap lifts out of the page by name');
if (WP) {
  const ctx = { measureText: (t) => ({ width: String(t).length * 7 }) };   // 7px a character
  const long = 'Confirm with your support team whether product videos can be supplied for the top '
    + '500 SKUs, and if so in what format and at what cadence, before the Christmas peak';
  const l2 = WP(ctx, long, 210, 2);
  ok(l2.length <= 2, 'a long action is held to the two lines the row is built for');
  ok(l2.every((x) => ctx.measureText(x).width <= 210),
    'and NO line is wider than the column: ' + l2.map((x) => ctx.measureText(x).width).join(' / '));
  ok(/\u2026$/.test(l2[l2.length - 1]), 'the last line says it was cut');
  eq(WP(ctx, 'Short one', 210, 2), ['Short one'], 'a short action is one line, never ellipsised');
  ok(WP(ctx, 'A medium length action that runs past one line here', 210, 2).length === 2,
    'a medium one takes the second line rather than being cut');
}
ok(/WD\.task=X\.own-GAP-X\.task/.test(WF),
  "the action column's width is DERIVED from the gap to the owner column");
ok(!/WD=\{ *task:\d/.test(WF), 'no hand-written width for it — that is how the two came to disagree');

console.log('\n── the table reaches the client, and the board it is read from');
ok(/window\.FCCPlanRow=function\(client,task\)/.test(WF),
  'the rail reads the plan row through a named bridge — the board is another script block');
ok(/normTask\(r\.task\)===want/.test(WF),
  "matched on EXACT wording: a call's actions share a prefix, and a fuzzy match would put one "
  + "action's due date beside another's text in a client email");
ok(/orig:r\.getAttribute\('data-orig'\)/.test(WF),
  'the row keeps the parsed wording apart from the wording the AM is typing, so rewriting a '
  + 'sentence never costs the row its category, due date or status');
ok(/atts:\(b64&&!big\)\?\[\{name:'call-actions\.png'/.test(WF),
  'the FCC draft carries the table as an attachment on the existing askdraft rails');
ok(/big=b64\.length>1200000/.test(WF) && /too large to attach/.test(WF),
  'and a table too big for the rails is dropped and SAID to be dropped, rather than the whole '
  + 'draft being refused for the sake of the picture');
ok(/id="cw-dl"/.test(WF) && /a\.download=/.test(WF),
  'and ⬇ Table PNG saves it for the Gmail path, where a compose link carries text and nothing else');
ok(/localStorage\.setItem\('fcc-cw-table'/.test(WF),
  'whether to attach it is a device preference, not shared state');
const PNGSRC = WF.slice(WF.indexOf('function wrapPng('), WF.indexOf('  function wrapPrev('));
ok(/Private/.test(PNGSRC), 'the image carries the house footer');
ok(!/Source|Brief this|stat-sel|it-cb/.test(PNGSRC),
  "and none of the board's internal chrome — no checkbox, Source or Brief column in the drawing");

console.log('\n' + (pass + fail) + ' assertions — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
