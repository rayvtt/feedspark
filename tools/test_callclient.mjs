#!/usr/bin/env node
// Call-notes client attribution (Ray, 9 Sep 2026): "the Gemini note is sent to me with the
// subject as Monsoon x cate.com x Fispar — please also parse the client name directly."
//
// Pins the three fixes end to end against the REAL parser + detector:
//   1. a notes email whose subject is JUST the meeting name still parses as call notes
//      (Gemini sender + notes-shaped body — no "Notes by Gemini" marker needed);
//   2. the client cue ladder reaches the raw subject: meeting title → SUBJECT → body head,
//      with an action-line brand still winning;
//   3. the roster the detector sees is dossier ∪ wired estate, so a brand with a live feed
//      but no dossier card (the live Monsoon miss) attributes anyway.
// Run: node tools/test_callclient.mjs   (pure node; wired into qa_gate)
import { parseGeminiNotes, detectClientEx } from '../cloudflare/feedspark-deck/src/briefmatch.js';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ FAIL: ' + l); } };

// the wired-estate roster (what DEFAULT_FEEDS contributes even with an empty dossier)
const ESTATE = ['Reiss', 'Schuh', 'YuMOVE', 'Monsoon', 'Accessorize', 'Hobbycraft', 'Superdry', 'House of Bruar', 'American Golf'];
const DOMS = {};

// ---- Ray's specimen: subject IS the meeting name, no notes marker in it ----
const MONSOON = {
  id: 'm-mon-1', from: 'Gemini <gemini-noreply@google.com>', to: 'ray@feedspark.com',
  subject: 'Monsoon x cate.com x Fispar',
  date: Date.now(),
  snippet: 'Notes by Gemini\nMeeting records\n\nSuggested next steps\n* Dino to rebuild the dress overlay rule for the SS27 range.\n* Ray will share the keyword saturation read-out by Friday.\n\nThis content was auto-generated on 9 Sep 2026.',
};
const g = parseGeminiNotes(MONSOON);
ok(!!g, 'subject-only meeting name still parses as call notes (Gemini sender + notes body)');
ok(g && g.actions.length === 2, 'both action items extracted (' + (g ? g.actions.length : 0) + ')');

// the ladder exactly as the worker runs it: title → raw subject (+recipients) → body head
function ladder(m, gg, names) {
  const ex0 = detectClientEx({ subject: gg.call, snippet: '' }, DOMS, names);
  const exS = ex0.client ? ex0 : detectClientEx({ subject: String(m.subject || ''), to: m.to, cc: m.cc, snippet: '' }, DOMS, names);
  return exS.client ? exS : detectClientEx({ subject: gg.call, snippet: String(m.snippet || '').slice(0, 600) }, DOMS, names);
}
ok(g && ladder(MONSOON, g, ESTATE).client === 'Monsoon', "Ray's specimen attributes to Monsoon from the subject line");
ok(g && ladder(MONSOON, g, ESTATE).client === 'Monsoon' && ESTATE.indexOf('cate.com') < 0, 'partner tokens (cate.com / Fispar) never mis-match');

// ---- estate roster: Monsoon detectable even with NO dossier card at all ----
ok(detectClientEx({ subject: 'Monsoon x cate.com x Fispar', snippet: '' }, {}, ESTATE).client === 'Monsoon',
  'wired-estate roster alone is enough (dossier card not required)');
ok(detectClientEx({ subject: 'Monsoon x cate.com x Fispar', snippet: '' }, {}, []).client === '',
  'sanity: with no roster at all nothing matches');

// ---- classic form keeps working: quoted title carries the brand ----
const CLASSIC = {
  id: 'm-hob-1', from: 'Gemini <gemini-noreply@google.com>', to: 'ray@feedspark.com',
  subject: 'Notes by Gemini: “HoB x Gains x FS - Meta overlay”',
  snippet: 'Notes by Gemini\n\nSuggested next steps\n* Steven to re-run the Meta catalogue diagnostic.\n\nThis content was auto-generated on 9 Sep 2026.',
};
const g2 = parseGeminiNotes(CLASSIC);
ok(g2 && ladder(CLASSIC, g2, ESTATE).client === 'House of Bruar', 'quoted-title form still attributes (HoB abbreviation)');

// ---- an action-line brand still beats the subject brand ----
const act = detectClientEx({ subject: 'Reiss to confirm the DE feed cutover date', snippet: '' }, DOMS, ESTATE);
ok(act.client === 'Reiss', 'action-line brand detection unchanged (wins over the call-level pick in the worker)');

// ---- the read-time back-fill shape: meeting title + task text vs the estate roster ----
const stored = { call: 'Monsoon x cate.com x Fispar', task: 'Rebuild the dress overlay rule', client: '' };
const exC = detectClientEx({ subject: (stored.call || '') + ' · ' + (stored.task || ''), snippet: '' }, DOMS, ESTATE);
ok(exC.client === 'Monsoon', 'stored unattributed call rows back-fill from their meeting title');
const keep = { call: 'Weekly ops sync', task: 'Circulate minutes', client: '' };
ok(detectClientEx({ subject: (keep.call || '') + ' · ' + (keep.task || ''), snippet: '' }, DOMS, ESTATE).client === '',
  'a genuinely client-less call stays unattributed (owner-side)');

console.log('\nRESULT: ' + (fail ? 'FAIL — ' + fail + ' failed, ' : 'PASS — ') + pass + ' assertions');
process.exit(fail ? 1 : 0);
