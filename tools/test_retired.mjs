#!/usr/bin/env node
/* Retired clients (Ray, 13 Oct 2026: "why i still see House of Bruar in these modules").
   The pure module, the purge LIFTED out of worker.js and run against an in-memory KV, and the
   wiring that keeps the live Task Manager / Scheduled-work lanes from writing a retired client back.
   No real client name is used: the fixtures retire an invented one ("Northwind Outdoor"). */
import fs from 'node:fs';
import * as RET from '../cloudflare/feedspark-deck/src/retired.js';
import { liftEnvelope } from '../cloudflare/feedspark-deck/src/kvmerge.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const LP = read('docs/FeedSpark_Leadership.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + JSON.stringify(why) : '')); } };

console.log('── the list');
const L = RET.cleanList(['Northwind Outdoor', { n: 'northwind-outdoor' }, '', null, { n: '  Atelier   Home ', by: 'ray@feedspark.com', at: 5 }]);
t('one name, however it is spelt — case, spaces and punctuation folded', L.length === 2 && L[0].n === 'Northwind Outdoor' && L[1].n === 'Atelier Home', L);
const S = RET.retiredSet(L);
t('isRetired matches the folded name and nothing else', RET.isRetired(S, 'NORTHWIND OUTDOOR') && RET.isRetired(S, 'NorthwindOutdoor') && !RET.isRetired(S, 'Northwind') && !RET.isRetired(S, '') && !RET.isRetired(new Set(), 'Northwind Outdoor'));

console.log('── each store shape');
const k = RET.stripKeyed({ 'Northwind Outdoor|gb': 1, 'Northwind Outdoor|gb-fb': 2, 'Reiss|gb': 3, Northwindoutdoor: 4 }, S);
t('a client|market index loses every market of the retired client, nothing else', k.n === 3 && JSON.stringify(Object.keys(k.out)) === '["Reiss|gb"]', k);
const f = RET.purgeValue({ key: 'schedskip', kind: 'field', field: 'clients' }, { at: 1, clients: { 'Northwind Outdoor': {}, Schuh: {} } }, S);
t('a sub-map (schedskip.clients) is purged in place, the rest of the record kept', f.n === 1 && f.out.at === 1 && Object.keys(f.out.clients).join() === 'Schuh');
const bk = RET.purgeValue({ key: 'tmbookidx', kind: 'book' }, { at: 9, clients: { 'Northwind Outdoor': {}, Reiss: {} }, accounts: [{ client: 'Northwind Outdoor' }, { client: 'Reiss' }], roster: [{ client: 'Northwind Outdoor' }], queues: [{ client: 'Reiss' }], rot: { 1: 2 } }, S);
t('the Task Manager book index loses the client from clients, accounts, roster and queues', bk.n === 3 && bk.out.at === 9 && Object.keys(bk.out.clients).join() === 'Reiss' && bk.out.accounts.length === 1 && !bk.out.roster.length && bk.out.queues.length === 1 && bk.out.rot[1] === 2, bk);
const env = liftEnvelope({ 'Northwind Outdoor': { dom: 'x' }, Schuh: { dom: 'y' } }, 0);
const tb = RET.tombstoneEnvelope(env, S, 'self', 100);
t('the dossier store TOMBSTONES the client (a stale tab cannot write it back)', tb.n === 1 && !tb.out.data['Northwind Outdoor'] && tb.out.meta['Northwind Outdoor'].del === 1 && tb.out.meta['Northwind Outdoor'].t === 100 && tb.out.data.Schuh);
const be = RET.tombstoneEnvelope(liftEnvelope({ 'NWO-1': { client: 'Northwind Outdoor' }, 'REIS-1': { client: 'Reiss' } }, 0), S, 'value', 100);
t('the brief pipeline tombstones the client’s tickets by their .client', be.n === 1 && !be.out.data['NWO-1'] && be.out.meta['NWO-1'].del === 1 && be.out.data['REIS-1']);
const ro = RET.stripRoster({ markets: [{ client: 'Northwind Outdoor', id: 1 }, { client: 'Reiss', id: 2 }], queues: [{ client: 'Northwind Outdoor' }], accounts: [{ client: 'Reiss' }] }, S);
t('a Task Manager roster loses the client before any market is read', ro.markets.length === 1 && ro.markets[0].client === 'Reiss' && !ro.queues.length && ro.accounts.length === 1);
t('every store the modules read from is on the purge list', ['labelidx', 'ptypeidx', 'goldenidx', 'voldobidx', 'overlayidx', 'imageidx', 'feedavail', 'labelalerts', 'ptypealerts', 'goldenalerts', 'tmidx', 'tmtrail', 'schedskip', 'tmbookidx', 'clients', 'briefs'].every((x) => RET.PURGE_STORES.some((s) => s.key === x)));

console.log('── the purge, lifted out of worker.js, against an in-memory KV');
function lift(name) {
  const i = WK.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  let d = 0, j = WK.indexOf('{', i);
  for (; j < WK.length; j++) { if (WK[j] === '{') d++; else if (WK[j] === '}' && --d === 0) break; }
  return WK.slice(i, j + 1);
}
const kv = new Map(Object.entries({
  goldenidx: JSON.stringify({ 'Northwind Outdoor|gb': { score: 80 }, 'Reiss|gb': { score: 90 } }),
  tmidx: JSON.stringify({ 'Northwind Outdoor': { used: 4 }, Schuh: { used: 2 } }),
  clients: JSON.stringify({ __v: 2, data: { 'Northwind Outdoor': { dom: 'nw.example' }, Reiss: {} }, meta: { 'Northwind Outdoor': { t: 1 }, Reiss: { t: 1 } } }),
  labelidx: JSON.stringify({ 'Reiss|gb': {} }),
  [RET.RETIRED_KEY]: JSON.stringify([{ n: 'Northwind Outdoor' }]),
}));
const ENV = { EDITS: { get: async (k2, ty) => { const v = kv.get(k2); return v == null ? null : (ty === 'json' ? JSON.parse(v) : v); }, put: async (k2, v) => { kv.set(k2, v); } } };
// eslint-disable-next-line no-new-func
const mk = new Function('RET', 'liftEnvelope', lift('retiredSetOf') + '\n' + lift('purgeRetired') + '\nreturn { retiredSetOf, purgeRetired };');
const W = mk(RET, liftEnvelope);
const set = await W.retiredSetOf(ENV);
const rep = await W.purgeRetired(ENV, set, 500);
const g = JSON.parse(kv.get('goldenidx')), tm = JSON.parse(kv.get('tmidx')), cl = JSON.parse(kv.get('clients'));
t('the Golden index and Task Manager hours lose the client, keep everyone else', !g['Northwind Outdoor|gb'] && g['Reiss|gb'] && !tm['Northwind Outdoor'] && tm.Schuh, { g, tm });
t('the dossier record is tombstoned in the envelope', !cl.data['Northwind Outdoor'] && cl.meta['Northwind Outdoor'].del === 1 && cl.data.Reiss);
t('the report names each store and how many entries it lost; an untouched store is not rewritten', rep.goldenidx === 1 && rep.tmidx === 1 && rep.clients === 1 && rep.labelidx === undefined && kv.get('labelidx') === JSON.stringify({ 'Reiss|gb': {} }), rep);
const again = await W.purgeRetired(ENV, set, 600);
t('a second run finds nothing left (re-runnable, idempotent)', Object.keys(again).length === 0, again);

console.log('── wiring');
t('owner-only GET/POST /api/retired, undo takes it off the list only', /path === '\/api\/retired'/.test(WK) && /if \(!realOwner\(env, request\)\) return json\(\{ error: 'restricted to the account owner' \}, 403\);\s*let list = RET\.cleanList/.test(WK) && /if \(b\.undo\)/.test(WK));
t('the Task Manager hours lane skips a retired client (pull + store)', /RET\.isRetired\(gone, r\.client_name\)/.test(WK) && /if \(RET\.isRetired\(gone, client\)\) \{ results\.push\(\{ client, retired: true \}\)/.test(WK));
t('the Task Manager book reads no retired market', /const roster = RET\.stripRoster\(TB\.rosterOf\(rows\), await retiredSetOf\(env\)\);/.test(WK));
t('the Scheduled-work route drops the client by brand AND by its sheet name', /RET\.isRetired\(gone, r\.b\) \|\| RET\.isRetired\(gone, r\.c\)/.test(WK));
t('the feed roster never lists a retired client', /if \(RET\.isRetired\(gone, c\)\) continue;/.test(WK));
t('Leadership carries the owner’s Retire control, confirming before it runs', /id="retired"/.test(LP) && /fetch\('\/api\/retired'/.test(LP) && /confirm\('Retire '/.test(LP));
t('no client name is written into the code to do it', !/retiredSetOf[\s\S]{0,400}'[A-Z][a-z]+ of [A-Z]/.test(WK) && !/RETIRED_SEED/.test(read('cloudflare/feedspark-deck/src/retired.js')));
t('the harness runs in qa_gate, presync and CI', /node tools\/test_retired\.mjs/.test(read('tools/qa_gate.sh')) && /node tools\/test_retired\.mjs/.test(read('tools/presync.sh')) && /node tools\/test_retired\.mjs/.test(read('.github/workflows/validate.yml')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
