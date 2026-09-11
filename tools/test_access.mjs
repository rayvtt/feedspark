/*
 * Access-scoping harness: the per-user Workflow scope (src/access.js) against the REAL
 * kvmerge engine — especially the trap this module exists for: a scoped signin's PUT is a
 * whole-map save of a PARTIAL view against a delete-by-absence store, so without the
 * re-injection pass their save would tombstone every other client's briefs.
 * Run: node tools/test_access.mjs   (pure node, no browser — also part of the gates)
 */
import { ACCESS_SEED, clientSlug, aliasClient, resolveAccess, clientMatch,
  scopeBriefsView, scopeBriefsIncoming, scopeRows, sanitizeDir, viewAsEmail,
  MODULES, MODULE_PATHS, moduleAllowed } from '../cloudflare/feedspark-deck/src/access.js';
import { liftEnvelope, mergeIntoEnvelope, envelopeToClient } from '../cloudflare/feedspark-deck/src/kvmerge.js';

let passed = 0, failed = 0;
function ok(c, l) { if (c) { passed++; console.log('  ✓ ' + l); } else { failed++; console.log('  ✗ FAIL: ' + l); } }

const NAMES = ['House of Bruar', 'Reiss', 'Schuh', 'Estée Lauder', 'YuMOVE'];

/* ---- resolution: who gets which view ---- */
ok(clientSlug('Estée Lauder') === 'esteelauder' && clientSlug('House of Bruar') === 'houseofbruar', 'slug folds case, accents and punctuation');
ok(aliasClient('HouseOfBruar@feedspark.com', NAMES) === 'House of Bruar', 'client-team alias auto-rule (case-insensitive)');
ok(aliasClient('esteelauder@feedspark.com', NAMES) === 'Estée Lauder', 'alias rule survives the accent fold');
ok(aliasClient('radostina@feedspark.com', NAMES) === null, 'a personal signin is not an alias');
const rado = resolveAccess('radostina@feedspark.com', false, null, NAMES);
ok(!rado.owner && rado.clients && rado.clients[0] === 'House of Bruar', 'seed: Radostina -> House of Bruar (until the owner saves)');
ok(resolveAccess('ray@feedspark.com', true, null, NAMES).clients === null, 'owner: full house');
ok(resolveAccess('steven@feedspark.com', false, null, NAMES).clients === null, 'unassigned signin: full house (scoping only narrows)');
const dirOver = { 'radostina@feedspark.com': { name: 'Rado', clients: ['Reiss'] } };
ok(resolveAccess('radostina@feedspark.com', false, dirOver, NAMES).clients[0] === 'Reiss', 'a stored directory replaces the git seed');
ok(resolveAccess('houseofbruar@feedspark.com', false, dirOver, NAMES).clients[0] === 'House of Bruar', 'alias rule still works alongside a stored directory');
ok(ACCESS_SEED['radostina@feedspark.com'].clients[0] === 'House of Bruar', 'the seed itself names House of Bruar');

/* ---- view + row filters ---- */
const HOB = ['House of Bruar'];
const BRIEFS = {
  b1: { client: 'House of Bruar', task: 'Rewrite titles' },
  b2: { client: 'Reiss', task: 'Roundel overlay' },
  b3: { client: 'houseofbruar', task: 'Slug-form client name' },
};
const view = scopeBriefsView(BRIEFS, HOB);
ok(Object.keys(view).sort().join(',') === 'b1,b3', 'briefs view: their clients only (slug-matched)');
ok(clientMatch(null, 'Reiss') === true && clientMatch(HOB, '') === false, 'null scope sees all; empty client never matches a real scope');
const rows = scopeRows([{ client: 'House of Bruar', s: 'o' }, { client: 'Reiss' }, { task: 'no client' }], HOB);
ok(rows.length === 1 && rows[0].client === 'House of Bruar', 'intake/call rows: theirs only; unattributed stays owner-side');
ok(scopeRows([{ client: 'Reiss' }], null).length === 1, 'null scope passes rows through untouched');

/* ---- THE trap: scoped PUT against the delete-by-absence store, end to end ---- */
// stored board: 2 HoB briefs + 2 foreign; writer read at base=1000 (has seen everything)
const now0 = 1000;
let envx = liftEnvelope(null, now0);
envx = mergeIntoEnvelope(envx, {
  h1: { client: 'House of Bruar', task: 'a', status: 'intake' },
  h2: { client: 'House of Bruar', task: 'b', status: 'briefed' },
  r1: { client: 'Reiss', task: 'x', status: 'intake' },
  s1: { client: 'Schuh', task: 'y', status: 'done' },
}, 0, now0, {});
const base = 2000;
// Radostina's board only ever held h1+h2. She edits h1, deletes h2, tries to add a Reiss
// brief (out of scope) and to hijack r1 (stored foreign) — all in one whole-map PUT.
const body = {
  h1: { client: 'House of Bruar', task: 'a', status: 'briefed' },
  nR: { client: 'Reiss', task: 'smuggled', status: 'intake' },
  r1: { client: 'Reiss', task: 'hijacked', status: 'done' },
};
const inc = scopeBriefsIncoming(envx.data, body, HOB);
const merged = mergeIntoEnvelope(envx, inc, base, 3000, {});
const out = envelopeToClient(merged, {});
ok(out.r1 && out.r1.task === 'x' && out.s1 && out.s1.task === 'y', 'foreign briefs SURVIVE a scoped whole-map save (the tombstone trap)');
ok(out.h1 && out.h1.status === 'briefed', 'their own edit lands');
ok(out.h2 === undefined && merged.meta.h2 && merged.meta.h2.del === 1, 'their own deletion still works (absence -> tombstone)');
ok(out.nR === undefined, 'a brief cannot be created for a foreign client');
ok(out.r1.status === 'intake', 'a stored foreign brief cannot be edited from a scoped signin');
const asOwner = scopeBriefsView(merged.data, null);
ok(Object.keys(asOwner).length === 3, 'the owner still sees the whole board after the scoped save');
// second save, nothing changed client-side: nothing new deleted
const merged2 = mergeIntoEnvelope(merged, scopeBriefsIncoming(merged.data, { h1: out.h1 }, HOB), 4000, 5000, {});
ok(merged2.data.r1 && merged2.data.s1, 'idempotent: a repeat scoped save keeps the board intact');

/* ---- a brief moved out of scope stays put ---- */
const inc2 = scopeBriefsIncoming(merged.data, { h1: { client: 'Reiss', task: 'a', status: 'briefed' } }, HOB);
ok(inc2.h1 && inc2.h1.client === 'House of Bruar', 'reassigning your brief to a foreign client is a no-op (kept as stored)');

/* ---- directory sanitizer ---- */
const dir = sanitizeDir({ ' Rado@FeedSpark.com ': { name: 'Radostina', clients: ['House of Bruar', '', 42] },
  'notanemail': { clients: ['X'] }, _junk: { clients: ['Y'] } });
ok(Object.keys(dir).length === 1 && dir['rado@feedspark.com'] && dir['rado@feedspark.com'].clients.length === 2,
  'sanitizer: emails lowercased/trimmed, junk rows dropped, clients coerced to strings');
ok(dir['rado@feedspark.com'].clients[1] === '42', 'non-string client coerced, empties dropped');

/* ---- 👁 view-as cookie parser (owner-only gating itself lives in the worker's viewAsOf) ---- */
const OWN = 'ray@feedspark.com';
ok(viewAsEmail('fcc-viewas=radostina%40feedspark.com', OWN) === 'radostina@feedspark.com', 'view-as: cookie parses + decodes');
ok(viewAsEmail('theme=dark; fcc-viewas=Steven@FeedSpark.com; other=1', OWN) === 'steven@feedspark.com', 'view-as: found mid-header, lowercased');
ok(viewAsEmail('fcc-viewas=ray%40feedspark.com', OWN) === null, 'view-as: previewing yourself is a no-op (owner stays owner)');
ok(viewAsEmail('fcc-viewas=notanemail', OWN) === null && viewAsEmail('', OWN) === null && viewAsEmail(null, OWN) === null, 'view-as: junk / absent cookie -> null');
ok(viewAsEmail('xfcc-viewas=a@b.com', OWN) === null, 'view-as: name must match exactly (no prefix bleed)');

/* ---- module-access dimension (Ray, Sep 2026: "select individual module access for each person") ---- */
ok(moduleAllowed(null, 'labels') === true && moduleAllowed(undefined, 'labels') === true, 'modules null/absent = all granted (owner or unconfigured)');
ok(moduleAllowed(['labels', 'playbook'], 'labels') === true && moduleAllowed(['labels', 'playbook'], 'aiquote') === false, 'a module list is exact membership');
ok(moduleAllowed([], 'labels') === false, 'empty module list locks every module');
const NAMES2 = ['House of Bruar', 'Reiss', 'Schuh'];
const andrew = resolveAccess('andrew@aroxo.com', false, null, NAMES2);
ok(andrew.clients === null && andrew.modules === null && andrew.name === 'Andrew', 'seed: Andrew is listed, full house, all modules (unrestricted until tuned in the panel)');
const dirMod = { 'sam@feedspark.com': { name: 'Sam', modules: ['feedlab', 'playbook'] },
  'jo@feedspark.com': { name: 'Jo', clients: ['Reiss'], modules: ['labels'] } };
const sam = resolveAccess('sam@feedspark.com', false, dirMod, NAMES2);
ok(sam.clients === null && sam.modules.join(',') === 'feedlab,playbook', 'a full-house signin can still be module-restricted');
const jo = resolveAccess('jo@feedspark.com', false, dirMod, NAMES2);
ok(jo.clients[0] === 'Reiss' && jo.modules.join(',') === 'labels', 'client scope + module restriction are independent');
ok(resolveAccess('ray@feedspark.com', true, dirMod, NAMES2).modules === null, 'owner: all modules');
const dm = sanitizeDir({ 'a@b.com': { name: 'A', clients: ['Reiss'], modules: ['labels', 'bogus', 'playbook'] },
  'c@d.com': { name: 'C', modules: [] }, 'e@f.com': { name: 'E', clients: ['Schuh'] } });
ok(dm['a@b.com'].modules.join(',') === 'labels,playbook', 'sanitizer: unknown module slugs dropped');
ok(Array.isArray(dm['c@d.com'].modules) && dm['c@d.com'].modules.length === 0, 'sanitizer: empty module list preserved (a locked signin)');
ok(dm['e@f.com'].modules === undefined, 'sanitizer: a row with no modules key stays unrestricted (all)');
ok(MODULE_PATHS['/labels'] === 'labels' && MODULE_PATHS['/playbook'] === 'playbook', 'MODULE_PATHS maps a route to its slug');
ok(MODULE_PATHS['/leadership'] === undefined && MODULE_PATHS['/activity'] === undefined && MODULE_PATHS['/'] === undefined, 'leadership / activity / landing are NOT grantable modules');
ok(MODULES.length === 12 && MODULES.every((m) => m.slug && m.label && m.path), 'twelve grantable modules, each {slug,label,path}');

console.log('\nRESULT: ' + (failed ? 'FAIL — ' + failed + ' failed, ' : 'PASS — ') + passed + ' assertions');
process.exit(failed ? 1 : 0);
