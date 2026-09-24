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
ok(e.subject.indexOf('Hobbycraft') === 0 && /wrap-up/.test(e.subject), 'subject names the account and what it is: ' + e.subject);
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

console.log('\n' + (pass + fail) + ' assertions — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
