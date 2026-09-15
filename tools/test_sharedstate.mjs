#!/usr/bin/env node
/*
 * Shared working state (Ray, 15 Sep 2026: "the updates are not seen by everyone but only by
 * themselves because the data is saved locally … nothing is kept for a specific user only").
 *
 * The Workflow overlays moved from each person's localStorage into KV. Two properties have to
 * hold or the move makes things WORSE than the bug it fixes:
 *   1. a scoped signin sees only their clients' entries, and
 *   2. their whole-map save — a PARTIAL view of a delete-by-absence store — can never wipe
 *      everyone else's. (/api/briefs learned this the hard way; tools/test_access.mjs pins it
 *      there, this pins it here.)
 *
 * Run: node tools/test_sharedstate.mjs
 */
import { STATE_NS, isStateNs, clientOfEntry, scopeStateView, scopeStateIncoming } from '../cloudflare/feedspark-deck/src/sharedstate.js';
import { clientMatch } from '../cloudflare/feedspark-deck/src/access.js';
import { liftEnvelope, mergeIntoEnvelope } from '../cloudflare/feedspark-deck/src/kvmerge.js';

let pass = 0; const fails = [];
const is = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓ ' + name); } else { fails.push(`${name}\n      got  ${g}\n      want ${w}`); }
};

// ---------- which client an entry belongs to ----------
is('a client|task key names its client', clientOfEntry('taskstatus', 'Reiss|Coats', 'Done'), 'Reiss');
is('a task containing a pipe does not confuse it', clientOfEntry('taskdue', 'Reiss|A|B', 'x'), 'Reiss');
is('wfremoved is keyed BY the client', clientOfEntry('wfremoved', 'Schuh', 1), 'Schuh');
is('a manual row carries its client in the value', clientOfEntry('manual', 'r1', { client: 'Monsoon', task: 'T' }), 'Monsoon');
is('house-wide namespaces belong to nobody', clientOfEntry('senderbrand', 'a@b.com', 'Reiss'), '');
is('an unknown namespace can never become a KV key', isStateNs('../secrets'), false);
is('…but a real one can', isStateNs('taskowner'), true);

// ---------- a scoped signin's view ----------
const OWNED = ['House of Bruar'];
const status = { 'House of Bruar|Titles': 'Done', 'Reiss|Coats': 'Open', 'Schuh|Denim': 'Briefed' };
is('a scoped AM sees only their client', Object.keys(scopeStateView('taskstatus', status, OWNED, clientMatch)), ['House of Bruar|Titles']);
is('the owner (no scope) sees everything', Object.keys(scopeStateView('taskstatus', status, null, clientMatch)).length, 3);
is('house-wide config is never filtered',
  scopeStateView('senderbrand', { 'a@b.com': 'Reiss' }, OWNED, clientMatch), { 'a@b.com': 'Reiss' });

// ---------- the trap: a partial view saved whole ----------
// the scoped AM edits their own row and saves the map they can see — two keys they never saw
// must survive, or one AM's save silently deletes the rest of the board
const theirSave = { 'House of Bruar|Titles': 'Briefed' };
const merged = scopeStateIncoming('taskstatus', status, theirSave, OWNED, clientMatch);
is('their own edit lands', merged['House of Bruar|Titles'], 'Briefed');
is('every foreign entry is re-injected', Object.keys(merged).sort(), ['House of Bruar|Titles', 'Reiss|Coats', 'Schuh|Denim']);

// and through the real merge, with absence-deletion armed (a live X-Sync-Base)
const now = Date.now();
let envx = liftEnvelope(null, now);
envx = mergeIntoEnvelope(envx, status, 0, now - 1000, {});
envx = mergeIntoEnvelope(envx, merged, now, now, {});
is('after the KV merge the board is intact', Object.keys(envx.data).sort(), ['House of Bruar|Titles', 'Reiss|Coats', 'Schuh|Denim']);
is('and carries their change', envx.data['House of Bruar|Titles'], 'Briefed');

// the SAME save WITHOUT the re-injection is the bug this guards against
let bad = liftEnvelope(null, now);
bad = mergeIntoEnvelope(bad, status, 0, now - 1000, {});
bad = mergeIntoEnvelope(bad, theirSave, now, now, {});
is('un-scoped, that save would have wiped the rest', Object.keys(bad.data), ['House of Bruar|Titles']);

// a scoped AM cannot write into another client, however they spell the key
const sneaky = { 'House of Bruar|Titles': 'Done', 'Reiss|Coats': 'Done' };
const guarded = scopeStateIncoming('taskstatus', status, sneaky, OWNED, clientMatch);
is('a foreign key in their payload is ignored, not applied', guarded['Reiss|Coats'], 'Open');

// deletion still works INSIDE their own scope
const dropped = scopeStateIncoming('hidden', { 'House of Bruar|A': 1, 'Reiss|B': 1 }, {}, OWNED, clientMatch);
is('they can clear their own entry', Object.keys(dropped), ['Reiss|B']);

// ---------- every namespace is classified ----------
const KNOWN = ['key', 'self', 'field', null];
is('no namespace has an unknown scoping rule',
  Object.keys(STATE_NS).filter((n) => KNOWN.indexOf(STATE_NS[n]) < 0), []);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }
console.log('PASS');
