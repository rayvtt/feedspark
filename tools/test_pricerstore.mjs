// SERVICES & PRICER — the store harness (pure node, CI-safe). 7 Oct 2026.
//
// Pins the server half of the transformed /pricer: src/pricerstore.js (the six stores' key grammar, allow-lists
// and sanitizers — unknown keys refused, ranges enforced, the ladder ascending and open-ended, {by, at} stamped by
// the SERVER and only on a value that moved, a refused key keeping its stored value, proposals frozen once saved,
// the rollout and roadmap shapes), the kvmerge trap the `_g|` / `_c|` rows would fall into without the KV-boundary
// swap, the catalogue ids held equal to docs/pricer_engine.js, and the worker's pricerRoute LIFTED out of worker.js
// and driven against a stub KV and a stubbed accessOf — the `pricer` gate, the cost store refused BEFORE its key is
// read, price writes for Management only, proposals and rollout scoped per signin with every foreign record
// re-injected — plus the rule-level scoping pair in src/sharedstate.js held to the pre-change functions verbatim.
// Fix round 1 (7 Oct 2026) pins, each on the shape that failed: a stale whole-map save no longer overwrites a value
// written after the writer's read (two tabs, cells / proposals / rollout / roadmap, a clear, a key removed since),
// a deleted option sheds its snapshot and a 30-day-old one is purged (a store past 20 MB recovers by deleting),
// the scoped prospect refusal says why, the test-package prices (_g|test2-4) on the price allow-list, the ladder
// rising as stored, and /api/tachyon/rates PUT held to Management (tachyonRatesRoute lifted and run).
// Run: node tools/test_pricerstore.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as P from '../cloudflare/feedspark-deck/src/pricerstore.js';
import { STATE_NS, clientOfEntry, scopeViewBy, scopeIncomingBy, scopeStateView, scopeStateIncoming } from '../cloudflare/feedspark-deck/src/sharedstate.js';
import { clientMatch, moduleAllowed, displayName } from '../cloudflare/feedspark-deck/src/access.js';
import { liftEnvelope, mergeIntoEnvelope, envelopeToClient } from '../cloudflare/feedspark-deck/src/kvmerge.js';
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const PS = read('cloudflare/feedspark-deck/src/pricerstore.js');
let pass = 0, fail = 0;
const rj0 = (r) => (r && r.rejected && r.rejected[0]) || {};   // a refusal that may not exist (so the pre-fix code fails, never throws)
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + (typeof why === 'string' ? why : JSON.stringify(why)) : '')); } };
const NOW = Date.UTC(2026, 9, 7, 9);
const ctx = { now: NOW, by: 'Steven', inScope: () => true };

// ---- the catalogue ids, held equal to the engine the page runs ------------------------------------------------------
console.log('· the ids the stores accept are the engine\'s');
{
  const E = require('../docs/pricer_engine.js');
  const cat = (E.CATALOG || []).map((r) => r.id);
  const pkg = Array.isArray(E.PKG_ROWS) ? E.PKG_ROWS.map((r) => r.id) : null;
  t('PricerEngine.PKG_ROWS exists (the package-only rows, outside CATALOG so AI Quote is unaffected)', !!pkg, 'docs/pricer_engine.js has no PKG_ROWS export yet');
  t('PRICER_IDS === CATALOG ids ∪ PKG_ROWS ids, in that order', JSON.stringify(P.PRICER_IDS) === JSON.stringify(cat.concat(pkg || [])), { store: P.PRICER_IDS, engine: cat.concat(pkg || []) });
  const L = E.PKG_LINES;
  const lineKeys = Array.isArray(L) ? L.map((l) => l && l.key) : (L && typeof L === 'object' ? Object.keys(L) : null);
  t('PKG_LINE_KEYS === PricerEngine.PKG_LINES keys (what a roadmap status can be set for)', !!lineKeys && JSON.stringify(P.PKG_LINE_KEYS) === JSON.stringify(lineKeys), { store: P.PKG_LINE_KEYS, engine: lineKeys });
  t('pricerstore.js never imports the docs engine as code (it is bundled as TEXT)', !/from\s+["'][^"']*docs\//.test(PS) && !/require\(/.test(PS));
}

// ---- 17. the rate-card cells ----------------------------------------------------------------------------------------
console.log('· rate-card cells: allow-lists, ranges, the ladder, server stamps');
{
  const r = P.sanitizeCellPut('ops', {
    'title_gen|aspl': { v: 7 }, 'title_gen|aMin': '12.345', 'attr_pop|tokPerP': 1800, 'desc_gen|note': ' ASPL batch of 200 ',
    '_g|ruleH': 2, '_g|langSetupH': { v: 4 },
    'bogus|aspl': 3, 'title_gen|bogus': 3, '_g|aspl': 3, 'title_gen|unit': 0.1, 'title_gen': 1, 'title_gen|aspl|x': 1,
    'title_gen|qc': 1001, 'title_gen|pm': -1, 'title_gen|mon': 'lots', 'title_gen|qcPct': 101, 'title_gen|qcMin': 601,
    'title_gen|lead': true, 'keywords|note': 'x'.repeat(201),
    _rejected: [{ k: 'old' }], _deleted: ['title_gen|aspl'],
  }, {}, ctx);
  const rk = r.rejected.map((x) => x.k);
  t('accepted cells land as {v, by, at} with the server\'s by + now', JSON.stringify(r.data['title_gen|aspl']) === JSON.stringify({ v: 7, by: 'Steven', at: NOW }));
  t('a numeric string is coerced and rounded to the field\'s precision (aMin 2 dp)', r.data['title_gen|aMin'].v === 12.35);
  t('a bare value and a {v} wrapper both read', r.data['attr_pop|tokPerP'].v === 1800 && r.data['_g|langSetupH'].v === 4);
  t('text is trimmed', r.data['desc_gen|note'].v === 'ASPL batch of 200');
  t('the house-wide ops rows (_g|ruleH, _g|langSetupH) are accepted', r.data['_g|ruleH'].v === 2);
  t('unknown keys are refused, never written: an unknown id, field, a row field on _g, a price field in ops, no field, two pipes',
    ['bogus|aspl', 'title_gen|bogus', '_g|aspl', 'title_gen|unit', 'title_gen', 'title_gen|aspl|x'].every((k) => rk.includes(k) && !(k in r.data)));
  t('ranges enforced: over the top, negative, not a number, a boolean, QC share over 100, QC minutes over 600',
    ['title_gen|qc', 'title_gen|pm', 'title_gen|mon', 'title_gen|lead', 'title_gen|qcPct', 'title_gen|qcMin'].every((k) => rk.includes(k) && !(k in r.data)));
  t('a note longer than 200 characters is refused, not cut', rk.includes('keywords|note'));
  t('the reply meta keys (_rejected, _deleted) are never read as cells', !rk.includes('_rejected') && !rk.includes('_deleted'));
  t('every refusal says why', r.rejected.every((x) => typeof x.why === 'string' && x.why.length > 4));

  const cur = { 'title_gen|aspl': { v: 6, by: 'Ana', at: 111 }, 'title_gen|qc': { v: 3, by: 'Ana', at: 111 }, 'title_gen|pm': { v: 2, by: 'Ana', at: 111 } };
  const r2 = P.sanitizeCellPut('ops', { 'title_gen|aspl': { v: 6, by: 'Mallory', at: 999 }, 'title_gen|qc': { v: 4, by: 'Mallory', at: 999 }, 'title_gen|pm': 'two' }, cur, ctx);
  t('an UNCHANGED value keeps its stored stamp — a client-sent by/at is ignored', r2.data['title_gen|aspl'] === cur['title_gen|aspl']);
  t('a CHANGED value is re-stamped by the server, never by the payload', JSON.stringify(r2.data['title_gen|qc']) === JSON.stringify({ v: 4, by: 'Steven', at: NOW }));
  t('an invalid value KEEPS the stored value (a whole-map save can never delete a row by sending it malformed)', r2.data['title_gen|pm'] === cur['title_gen|pm'] && r2.rejected.some((x) => x.k === 'title_gen|pm'));
  const r3 = P.sanitizeCellPut('ops', { 'title_gen|aspl': null, 'title_gen|qc': '' }, cur, ctx);
  t('null or \'\' is a clear — the key is left out so the read stamp decides', !('title_gen|aspl' in r3.data) && !('title_gen|qc' in r3.data) && !r3.rejected.length);

  const pr = P.sanitizeCellPut('price', {
    'attr_pop|unit': 0.123456, 'title_gen|unit': 101, '_g|blockGBP': 585, '_g|blockGBP_': 1, '_g|blockH': 25, '_g|bundlePct': 51,
    '_g|reusePct': 60, '_g|floorMonthly': 250, '_g|pkgVersion': 'v2026.10', 'title_gen|aspl': 3, '_c|rateAm': 40,
  }, {}, ctx);
  const pk = pr.rejected.map((x) => x.k);
  t('price: unit to 4 dp', pr.data['attr_pop|unit'].v === 0.1235);
  t('price: unit over £100, block hours over 24, bundle over 50%, an ops field, a cost field — all refused',
    ['title_gen|unit', '_g|blockH', '_g|bundlePct', 'title_gen|aspl', '_c|rateAm', '_g|blockGBP_'].every((k) => pk.includes(k)));
  t('price: the house commercials land', pr.data['_g|blockGBP'].v === 585 && pr.data['_g|reusePct'].v === 60 && pr.data['_g|floorMonthly'].v === 250 && pr.data['_g|pkgVersion'].v === 'v2026.10');
  t('price: a version label over 20 characters is refused', P.sanitizeCellPut('price', { '_g|pkgVersion': 'x'.repeat(21) }, {}, ctx).rejected.length === 1);

  const tiers = (v) => P.sanitizeCellPut('price', { '_g|tiers': v }, {}, ctx);
  const good = tiers([{ upTo: 5000, x: 1 }, { upTo: '20000', x: 0.8 }, { upTo: 50000, x: 0.65 }, { upTo: null, x: 0.5 }]);
  t('ladder: an ascending, open-ended ladder lands (numeric strings read)', JSON.stringify(good.data['_g|tiers'].v) === JSON.stringify([{ upTo: 5000, x: 1 }, { upTo: 20000, x: 0.8 }, { upTo: 50000, x: 0.65 }, { upTo: null, x: 0.5 }]));
  t('ladder: one open band is a flat rate', tiers([{ upTo: null, x: 1 }]).data['_g|tiers'].v.length === 1);
  t('ladder: descending bounds refused', !!tiers([{ upTo: 20000, x: 1 }, { upTo: 5000, x: 0.8 }, { upTo: null, x: 0.5 }]).rejected.length);
  t('ladder: equal bounds refused', !!tiers([{ upTo: 5000, x: 1 }, { upTo: 5000, x: 0.8 }, { upTo: null, x: 0.5 }]).rejected.length);
  t('ladder: a last band with a bound refused (volume past it would be unpriced)', !!tiers([{ upTo: 5000, x: 1 }, { upTo: 20000, x: 0.8 }]).rejected.length);
  t('ladder: an open band before the last refused', !!tiers([{ upTo: null, x: 1 }, { upTo: null, x: 0.8 }]).rejected.length);
  t('ladder: a multiplier over 1 refused', !!tiers([{ upTo: null, x: 1.2 }]).rejected.length);
  t('ladder: more than six bands refused', !!tiers([1, 2, 3, 4, 5, 6].map((u) => ({ upTo: u * 1000, x: 1 })).concat([{ upTo: null, x: 0.5 }])).rejected.length);
  t('ladder: empty / not a list refused', !!tiers([]).rejected.length && !!tiers({ upTo: null }).rejected.length);

  const co = P.sanitizeCellPut('cost', { '_c|rateAspl': 22.5, '_c|rateAm': 1001, '_c|gbpPerMTok': 2.34567, '_c|tokAsOf': '2026-10-07',
    '_c|ohPct': 35, '_c|marginPct': 96, 'title_gen|unit': 1, '_g|blockGBP': 585, '_c|tokAsOf2': '2026-10-07' }, {}, ctx);
  const ck = co.rejected.map((x) => x.k);
  t('cost: rates, token cost (4 dp), overhead land', co.data['_c|rateAspl'].v === 22.5 && co.data['_c|gbpPerMTok'].v === 2.3457 && co.data['_c|ohPct'].v === 35 && co.data['_c|tokAsOf'].v === '2026-10-07');
  t('cost: a rate over 1000, a margin over 95%, anything outside _c refused', ['_c|rateAm', '_c|marginPct', 'title_gen|unit', '_g|blockGBP', '_c|tokAsOf2'].every((k) => ck.includes(k)));
  t('cost: tokAsOf must be a REAL date', !!P.sanitizeCellPut('cost', { '_c|tokAsOf': '2026-02-30' }, {}, ctx).rejected.length && !!P.sanitizeCellPut('cost', { '_c|tokAsOf': '7/10/2026' }, {}, ctx).rejected.length);
  t('cellSpec answers nothing for a store it does not know', P.cellSpec('roadmap', 'title|*') === null && P.cellSpec('ops', '__proto__|aspl') === null && P.cellSpec('ops', 'title_gen|constructor') === null);
}

// ---- the kvmerge trap -------------------------------------------------------------------------------------------------
console.log('· the KV boundary: kvmerge never writes a key that starts with "_"');
{
  const inc = { '_g|blockGBP': { v: 585, by: 'Ray', at: NOW }, 'title_gen|unit': { v: 0.08, by: 'Ray', at: NOW } };
  const raw = mergeIntoEnvelope(liftEnvelope(null, NOW), inc, 0, NOW, {});
  t('without the swap the house-wide row is silently DROPPED by the merge (the trap)', !('_g|blockGBP' in raw.data) && 'title_gen|unit' in raw.data);
  const ok = mergeIntoEnvelope(liftEnvelope(null, NOW), P.toStore(inc), 0, NOW, {});
  t('toStore writes it as ~g| and fromStore reads it back as _g|', ok.data['~g|blockGBP'].v === 585 && P.fromStore(ok.data)['_g|blockGBP'].v === 585);
  t('ordinary keys pass the boundary untouched', P.toStoreKey('title_gen|unit') === 'title_gen|unit' && P.fromStoreKey('Northwind') === 'Northwind');
  t('a client name can never start with ~ or _ (so the swap cannot collide with a rollout key)', P.cleanClient('~Northwind') === null && P.cleanClient('_x') === null && P.cleanClient(' Northwind ') === 'Northwind');
}

// ---- proposals ---------------------------------------------------------------------------------------------------------
console.log('· proposal options: the snapshot, frozen once saved; the buy-in stamped by the server');
const OPT = (over) => Object.assign({
  ref: 'SVC123456', client: 'Northwind', markets: ['gb', 'de'], t: NOW - 1000, by: 'whoever',
  prop: { id: 'ppab12', n: 1, label: 'Tier 1 · Google-ready' }, option: 'go', pkgVersion: 'v1',
  audit: { gb: { src: 'stored', S: 1000, P: 400 } }, rates: { rows: {}, g: {} }, opts: {}, aimSources: {},
  pq: { oneOff: { total: 1 }, monthly: { total: 1 } }, clientSafe: false, blockers: ['draft rates'],
}, over || {});
{
  const c = P.cleanOption(OPT(), undefined, ctx);
  t('a new option is accepted', c.ok, c.why);
  t('…its creator is the server\'s word, not the payload\'s', c.v.by === 'Steven');
  t('…and it carries lu {by, at}', JSON.stringify(c.v.lu) === JSON.stringify({ by: 'Steven', at: NOW }));
  t('…keeping the page\'s plausible t', c.v.t === NOW - 1000);
  const bad = (over, label) => { const r = P.cleanOption(OPT(over), undefined, ctx); t('refused: ' + label, !r.ok && typeof r.why === 'string', r); };
  bad({ ref: 'QT123456' }, 'a ref that is not SVC + 6 digits');
  bad({ client: '' }, 'no client');
  bad({ client: 'North:wind' }, 'a client name carrying a separator');
  bad({ markets: ['gb-fb'] }, 'a Meta -fb market');
  bad({ markets: [] }, 'no markets');
  bad({ prop: { id: 'x1', n: 1, label: '' } }, 'a prop id that is not pp…');
  bad({ prop: { id: 'ppab12', n: 7, label: '' } }, 'option number 7');
  bad({ option: 'premium' }, 'an option outside go / go+ar / ar');
  bad({ pq: null }, 'no pq snapshot');
  bad({ clientSafe: 'yes' }, 'clientSafe not a boolean');
  bad({ blockers: 'draft' }, 'blockers not a list');
  bad({ pq: { pad: 'x'.repeat(61 * 1024) } }, 'a record over 60 KB');
  bad({ chosen: 'yes' }, 'a chosen stamp that is not a stamp');
  bad({ superseded: { ref: 'nope' } }, 'superseded naming no proposal ref');

  const stored = c.v;
  const echo = P.cleanOption(JSON.parse(JSON.stringify(stored)), stored, ctx);
  t('re-saving the record you read changes nothing — same object, lu untouched', echo.ok && echo.v === stored && !echo.note);
  const later = { now: NOW + 5000, by: 'Ray', inScope: () => true };
  const ch = P.cleanOption(Object.assign(JSON.parse(JSON.stringify(stored)), { chosen: { t: NOW + 4000, by: 'Mallory' } }), stored, later);
  t('✓ Chosen: lands with the page\'s t (newest chosen wins across two AMs) and the SERVER\'s by', ch.ok && ch.v.chosen.t === NOW + 4000 && ch.v.chosen.by === 'Ray');
  t('…and bumps lu', ch.v.lu.by === 'Ray' && ch.v.lu.at === NOW + 5000);
  const echo2 = P.cleanOption(JSON.parse(JSON.stringify(ch.v)), ch.v, { now: NOW + 9000, by: 'Steven', inScope: () => true });
  t('a stamp re-saved as stored keeps its recorder (never re-attributed to whoever saved next)', echo2.v === ch.v && echo2.v.chosen.by === 'Ray');
  const un = JSON.parse(JSON.stringify(ch.v)); delete un.chosen;
  t('un-choosing (chosen absent) clears it — the toggle', !('chosen' in P.cleanOption(un, ch.v, later).v));
  const fr = P.cleanOption(Object.assign(JSON.parse(JSON.stringify(stored)), { pq: { oneOff: { total: 999999 } }, client: 'Southwind', sentAt: { via: 'gmail' } }), stored, later);
  t('a saved option\'s snapshot is FROZEN — pq and client keep their stored value', fr.ok && fr.v.pq.oneOff.total === 1 && fr.v.client === 'Northwind');
  t('…the buy-in still moves (sentAt stamped)', fr.v.sentAt && fr.v.sentAt.via === 'gmail' && fr.v.sentAt.by === 'Ray');
  t('…and the reply says the snapshot is frozen', /frozen/.test(fr.note || '') && /pq/.test(fr.note) && /client/.test(fr.note));
  const rl = P.cleanOption(Object.assign(JSON.parse(JSON.stringify(stored)), { prop: Object.assign({}, stored.prop, { label: 'Tier 1 — revised' }) }), stored, later);
  t('the option\'s own label may be renamed', rl.v.prop.label === 'Tier 1 — revised' && rl.v.prop.id === 'ppab12' && !rl.note);
  const del = P.cleanOption(Object.assign(JSON.parse(JSON.stringify(stored)), { deleted: true }), stored, later);
  t('deleted: true becomes a {t, by} tombstone (truthy, so the engine\'s !deleted still reads)', del.v.deleted && del.v.deleted.by === 'Ray' && del.v.deleted.t === NOW + 5000);

  const sp = P.sanitizeProposalPut({ oabcdef1: OPT(), 'bad id': OPT(), Oabcdef2: OPT(), oabcdef3: OPT({ ref: 'x' }) }, {}, ctx);
  t('proposal keys: o + 6–20 lowercase letters/digits', 'oabcdef1' in sp.data && !('bad id' in sp.data) && !('Oabcdef2' in sp.data));
  t('an invalid option with nothing stored is simply refused', !('oabcdef3' in sp.data) && sp.rejected.some((x) => x.k === 'oabcdef3'));
  const fenced = P.sanitizeProposalPut({ oabcdef4: OPT({ client: 'Southwind' }) }, {}, { now: NOW, by: 'Nora', inScope: (cl) => cl === 'Northwind' });
  t('a write for a foreign client is refused, "outside your clients"', !('oabcdef4' in fenced.data) && /^outside your clients/.test(rj0(fenced).why));
  t('…and the reason says it plainly: the account it names, and that a prospect needs an unscoped signin (finding 34)',
    /"Southwind" is not one of your accounts/.test(rj0(fenced).why) && /prospect proposal needs an unscoped signin/.test(rj0(fenced).why), rj0(fenced).why);
  const over = P.sanitizeProposalPut({ oabcdef5: OPT({ client: 'Northwind' }) }, { oabcdef5: OPT({ client: 'Southwind' }) }, { now: NOW, by: 'Nora', inScope: (cl) => cl === 'Northwind' });
  t('…a write over a STORED foreign option is refused without ever naming the account it belongs to',
    !('oabcdef5' in over.data) && /^outside your clients/.test(rj0(over).why) && !/Southwind/.test(rj0(over).why), rj0(over).why);
}

// ---- rollout + roadmap ------------------------------------------------------------------------------------------------
console.log('· the services rollout and the delivery roadmap');
{
  const r = P.sanitizeRolloutPut({
    Northwind: { debriefAt: { t: NOW - 50 }, next: ' Send Tier 2 ', nextDue: '2026-10-14', alwaysOn: { on: true, mechanism: 'fortnightly', t: NOW }, am: 'Steven', junk: 1 },
    'North|wind': {}, Bad1: { nextDue: '2026-13-01' }, Bad2: { next: 'x'.repeat(161) }, Bad3: { declined: { why: 'x'.repeat(201) } }, Bad4: 'nope',
  }, {}, ctx);
  const n = r.data.Northwind;
  t('a rollout record lands; text trimmed; unknown fields dropped', n && n.next === 'Send Tier 2' && n.nextDue === '2026-10-14' && n.am === 'Steven' && !('junk' in n));
  t('its stamps are the server\'s (debriefAt, alwaysOn)', n.debriefAt.by === 'Steven' && n.alwaysOn.by === 'Steven' && n.alwaysOn.on === true && n.alwaysOn.mechanism === 'fortnightly');
  t('…and it carries lu', n.lu.by === 'Steven' && n.lu.at === NOW);
  t('refused: a key that is not a client name, a non-date, next over 160, a decline reason over 200, a non-object',
    ['North|wind', 'Bad1', 'Bad2', 'Bad3', 'Bad4'].every((k) => !(k in r.data) && r.rejected.some((x) => x.k === k)));
  const echo = P.sanitizeRolloutPut({ Northwind: JSON.parse(JSON.stringify(n)) }, { Northwind: n }, { now: NOW + 1, by: 'Ray', inScope: () => true });
  t('re-saving the rollout record you read keeps it as stored', echo.data.Northwind === n);
  const fenced = P.sanitizeRolloutPut({ Southwind: { next: 'x' } }, { Southwind: { next: 'y' } }, { now: NOW, by: 'Nora', inScope: (c) => c === 'Northwind' });
  t('rollout: a foreign client\'s record is refused (the route re-injects the stored one)', !('Southwind' in fenced.data) && /^outside your clients/.test(rj0(fenced).why));

  const m = P.sanitizeRoadmapPut({
    'title|*': { status: 'live', note: '' }, 'conv|Fashion': { status: 'pilot', note: 'Northwind first' }, 'alwayson|*': { status: 'building' },
    'attr_rule|Arts & Crafts': { status: 'live' }, 'bogus|*': { status: 'live' }, 'title|': { status: 'live' }, 'desc|*': { status: 'soon' },
    'gpc|*': { status: 'live', note: 'x'.repeat(201) }, 'highlights|Fash|ion': { status: 'live' },
  }, {}, ctx);
  t('roadmap: a line × industry (or *) and the always-on routing land, stamped', m.data['title|*'].by === 'Steven' && m.data['conv|Fashion'].note === 'Northwind first' && m.data['alwayson|*'].status === 'building' && m.data['attr_rule|Arts & Crafts']);
  t('roadmap: an unknown line, an empty industry, a status outside live/pilot/building/planned, a note over 200, a pipe in the industry — refused',
    ['bogus|*', 'title|', 'desc|*', 'gpc|*', 'highlights|Fash|ion'].every((k) => !(k in m.data)));
  const keep = P.sanitizeRoadmapPut({ 'title|*': { status: 'live', note: '', by: 'Mallory', at: 1 } }, { 'title|*': { status: 'live', note: '', by: 'Ana', at: 5 } }, ctx);
  t('roadmap: an unchanged status keeps its stamp', keep.data['title|*'].by === 'Ana' && keep.data['title|*'].at === 5);
  t('roadmap keys: every package line + alwayson', JSON.stringify(P.ROADMAP_KEYS) === JSON.stringify(P.PKG_LINE_KEYS.concat(['alwayson'])));

  t('sanitizePut: a body that is not an object is an error', !!P.sanitizePut('ops', [], {}, ctx).error && !!P.sanitizePut('ops', null, {}, ctx).error);
  const many = {}; for (let i = 0; i < 201; i++) many['_c|x' + i] = 1;
  t('sanitizePut: more keys than the store allows is an error (nothing saved)', /too many keys/.test(P.sanitizePut('cost', many, {}, ctx).error || ''));
  t('sanitizePut: an unknown store is an error', !!P.sanitizePut('nope', {}, {}, ctx).error);
}

// ---- fix round 1: a stale copy never wins (finding 13) -----------------------------------------------------------------
console.log('· a stale copy never wins: a value written after the writer\'s read keeps its stored value (finding 13)');
{
  const base = NOW - 10000;
  const st = { now: NOW, by: 'Steven', base, inScope: () => true };
  const cur = {
    'title_gen|aMin': { v: 45, by: 'Ana', at: NOW - 5000 },        // Ana, AFTER Steven's read
    'title_gen|qcPct': { v: 10, by: 'Ana', at: NOW - 20000 },      // Ana, BEFORE Steven's read
    'title_gen|qc': { v: 2, by: 'Steven', at: NOW - 4000 },        // Steven himself, in another tab, after this tab's read
  };
  // Steven's stale tab: he edits qcPct; his whole map still carries aMin = 30 as he read it, stamp and all
  const r = P.sanitizeCellPut('ops', { 'title_gen|aMin': { v: 30, by: 'Ana', at: NOW - 30000 }, 'title_gen|qcPct': { v: 20 }, 'title_gen|qc': { v: 1, by: 'Steven', at: NOW - 30000 } }, cur, st);
  t('a cell a colleague changed AFTER the read keeps the colleague\'s value AND stamp (was: reverted to 30, credited to Steven)', r.data['title_gen|aMin'] === cur['title_gen|aMin'], r.data['title_gen|aMin']);
  t('…and is named in rejected: "changed by Ana since you loaded — reload to edit it"', r.rejected.some((x) => x.k === 'title_gen|aMin' && x.why === 'changed by Ana since you loaded — reload to edit it'), r.rejected);
  t('a change on top of the latest value (stored before the read) is accepted and stamped by the server', r.data['title_gen|qcPct'].v === 20 && r.data['title_gen|qcPct'].by === 'Steven' && r.data['title_gen|qcPct'].at === NOW);
  t('the same person in another tab is just as stale — named "you in another tab", the newer value kept',
    r.data['title_gen|qc'] === cur['title_gen|qc'] && r.rejected.some((x) => x.k === 'title_gen|qc' && /^changed by you in another tab since you loaded/.test(x.why)));
  const eq = P.sanitizeCellPut('ops', { 'title_gen|aMin': { v: 45, by: 'Mallory', at: 1 } }, cur, st);
  t('a value EQUAL to the newer stored one is untouched — stamp kept, nothing refused', eq.data['title_gen|aMin'] === cur['title_gen|aMin'] && !eq.rejected.length);
  const clr = P.sanitizeCellPut('ops', { 'title_gen|aMin': null, 'title_gen|qcPct': '' }, cur, st);
  t('clearing a value written after the read is refused (kept, named); clearing an older one is a clear',
    clr.data['title_gen|aMin'] === cur['title_gen|aMin'] && clr.rejected.length === 1 && rj0(clr).k === 'title_gen|aMin' && !('title_gen|qcPct' in clr.data));
  const fresh = P.sanitizeCellPut('ops', { 'desc_gen|aMin': 12 }, cur, st);
  t('a genuinely new key is accepted', fresh.data['desc_gen|aMin'].v === 12 && !fresh.rejected.length);
  const zero = P.sanitizeCellPut('ops', { 'title_gen|qcPct': 25, 'desc_gen|aMin': 12 }, cur, Object.assign({}, st, { base: 0 }));
  t('a writer with read stamp 0 has read nothing: every stamped value is newer — refused; a new key still lands',
    zero.data['title_gen|qcPct'] === cur['title_gen|qcPct'] && rj0(zero).k === 'title_gen|qcPct' && zero.data['desc_gen|aMin'].v === 12);
  const nob = P.sanitizeCellPut('ops', { 'title_gen|aMin': 30 }, cur, { now: NOW, by: 'Steven' });
  t('a unit-level caller that passes no base gets no check (the route always passes one)', nob.data['title_gen|aMin'].v === 30);
  const ab = P.sanitizePut('ops', { 'title_gen|qcPct': cur['title_gen|qcPct'] }, cur, st);
  t('keys the writer LEFT OUT that were written after its read are named too (kvmerge keeps them) — never an older one',
    ab.rejected.some((x) => x.k === 'title_gen|aMin' && /Ana/.test(x.why)) && ab.rejected.some((x) => x.k === 'title_gen|qc') && !ab.rejected.some((x) => x.k === 'title_gen|qcPct'), ab.rejected);
  t('the stale check runs for the price and cost stores too (one sanitizer)',
    rj0(P.sanitizeCellPut('price', { 'title_gen|unit': 0.05 }, { 'title_gen|unit': { v: 0.08, by: 'Ray', at: NOW - 1 } }, st)).why === 'changed by Ray since you loaded — reload to edit it'
    && P.sanitizeCellPut('cost', { '_c|ohPct': 20 }, { '_c|ohPct': { v: 35, by: 'Andy', at: NOW - 1 } }, st).rejected.length === 1);

  // roadmap — same rule on {status, note, by, at}
  const rm = P.sanitizeRoadmapPut({ 'title|*': { status: 'pilot', note: '', by: 'Ana', at: 1 }, 'gpc|*': { status: 'live' }, 'conv|*': null },
    { 'title|*': { status: 'live', note: '', by: 'Ana', at: NOW - 1 }, 'gpc|*': { status: 'planned', note: '', by: 'Ana', at: NOW - 99999 }, 'conv|*': { status: 'live', note: '', by: 'Ana', at: NOW - 1 } }, st);
  t('roadmap: a status changed after the read stays; an older one moves; a clear of a newer one is refused',
    rm.data['title|*'].status === 'live' && rm.data['gpc|*'].status === 'live' && rm.data['gpc|*'].by === 'Steven' && rm.data['conv|*'].status === 'live'
    && rm.rejected.map((x) => x.k).sort().join(',') === 'conv|*,title|*', rm);

  // proposals — a stale copy without the owner's ✓ Chosen can no longer clear it
  const o1 = P.cleanOption(OPT(), undefined, { now: NOW - 50000, by: 'Ray', inScope: () => true }).v;
  const chosen = Object.assign({}, o1, { chosen: { t: NOW - 3000, by: 'Ray' }, lu: { by: 'Ray', at: NOW - 3000 } });
  const stale = JSON.parse(JSON.stringify(o1));                        // Nora's copy: read before Ray chose it
  const pr = P.sanitizeProposalPut({ oabc1234: stale }, { oabc1234: chosen }, { now: NOW, by: 'Nora', base, inScope: () => true });
  t('proposals: a stale copy no longer clears a colleague\'s ✓ Chosen, nor re-stamps lu',
    pr.data.oabc1234 === chosen && pr.data.oabc1234.chosen.by === 'Ray' && pr.data.oabc1234.lu.by === 'Ray', pr.data.oabc1234);
  t('…and says so', pr.rejected.length === 1 && rj0(pr).why === 'changed by Ray since you loaded — reload to edit it');
  const pr2 = P.sanitizeProposalPut({ oabc1234: Object.assign(JSON.parse(JSON.stringify(chosen)), { sentAt: { via: 'gmail' } }) }, { oabc1234: chosen }, { now: NOW, by: 'Nora', base: NOW - 1000, inScope: () => true });
  t('proposals: a change made on top of the latest copy is accepted (read after Ray\'s click)', pr2.data.oabc1234.sentAt.by === 'Nora' && pr2.data.oabc1234.chosen.by === 'Ray' && !pr2.rejected.length);
  const pr3 = P.sanitizeProposalPut({ oabc1234: JSON.parse(JSON.stringify(chosen)) }, { oabc1234: chosen }, { now: NOW, by: 'Nora', base, inScope: () => true });
  t('proposals: an exact echo of the newer record is untouched, never refused', pr3.data.oabc1234 === chosen && !pr3.rejected.length);

  // rollout — same rule on lu
  const ro = { next: 'Debrief Tuesday', debriefAt: { t: NOW - 2000, by: 'Ana' }, lu: { by: 'Ana', at: NOW - 2000 } };
  const rr = P.sanitizeRolloutPut({ Northwind: { next: 'Chase' } }, { Northwind: ro }, st);
  t('rollout: a stale record does not wipe a colleague\'s debrief stamp written after the read', rr.data.Northwind === ro && rj0(rr).why === 'changed by Ana since you loaded — reload to edit it');
}

// ---- fix round 1: the proposals store can shrink (findings 14 + 30, server half) ----------------------------------------
console.log('· a deleted option sheds its snapshot, an old one leaves the map, and the store can recover from full (findings 14, 30)');
{
  const pad = { gb: { src: 'stored', S: 1000, P: 400, pad: 'x'.repeat(12000) } };
  const live = P.cleanOption(OPT({ audit: pad, pq: { label: 'Tier 2 · AI-ready', oneOff: { total: 4200, lines: ['x'.repeat(500)] }, monthly: { total: 650 } } }), undefined, { now: NOW - 90000, by: 'Ray', inScope: () => true }).v;
  const before = JSON.stringify(live).length;
  const later = { now: NOW, by: 'Steven', base: NOW - 1000, inScope: () => true };
  const del = P.cleanOption(Object.assign(JSON.parse(JSON.stringify(live)), { deleted: { t: NOW - 10 } }), live, later);
  const after = JSON.stringify(del.v).length;
  t('✕ Delete: the record keeps who / what / when and sheds audit, rates, opts, aimSources, blockers',
    del.ok && ['audit', 'rates', 'opts', 'aimSources', 'blockers'].every((f) => !(f in del.v)) && del.v.ref === live.ref && del.v.client === 'Northwind' && del.v.prop.id === 'ppab12' && del.v.option === 'go', del.v && Object.keys(del.v));
  t('…the pq keeps its label and the two totals only', JSON.stringify(del.v.pq) === JSON.stringify({ label: 'Tier 2 · AI-ready', oneOff: { total: 4200 }, monthly: { total: 650 } }), Object.keys(del.v.pq || {}));
  t('…stamped deleted + lu by the server', del.v.deleted.by === 'Steven' && del.v.lu.by === 'Steven' && del.v.lu.at === NOW);
  t('…and it is a fraction of the size (was: deleting ADDED bytes)', after < before / 5, { before, after });
  t('isShed reads it', typeof P.isShed === 'function' && P.isShed(del.v) && !P.isShed(live));
  const echo = P.cleanOption(JSON.parse(JSON.stringify(del.v)), del.v, { now: NOW + 5, by: 'Ray', base: NOW + 1, inScope: () => true });
  t('re-saving the shed record changes nothing — same object, no "frozen" note', echo.ok && echo.v === del.v && !echo.note);
  const full = P.cleanOption(Object.assign(JSON.parse(JSON.stringify(live)), { deleted: { t: NOW - 10 } }), del.v, { now: NOW + 5, by: 'Steven', base: NOW + 1, inScope: () => true });
  t('the deleting tab\'s own full copy landing after the shed (a pending re-apply) is not a "frozen" warning', full.ok && full.v === del.v && !full.note, full.note);
  const und = P.sanitizeProposalPut({ oabc1234: Object.assign(JSON.parse(JSON.stringify(del.v)), { deleted: null }) }, { oabc1234: del.v }, { now: NOW + 5, by: 'Ray', base: NOW + 1, inScope: () => true });
  t('a shed option cannot be un-deleted into a live option with no snapshot — refused, kept deleted',
    und.data.oabc1234 === del.v && /cannot be restored/.test(rj0(und).why), und.rejected);
  // an option deleted BEFORE this fix still carries its snapshot: the next save sheds it as housekeeping
  const legacy = Object.assign(JSON.parse(JSON.stringify(live)), { deleted: { t: NOW - 7000, by: 'Ray' }, lu: { by: 'Ray', at: NOW - 7000 } });
  const hk = P.sanitizeProposalPut({ oabc1234: JSON.parse(JSON.stringify(legacy)) }, { oabc1234: legacy }, { now: NOW, by: 'Nora', base: NOW - 9000, inScope: () => true });
  t('an option deleted before the fix is shed on the next save — keeping its lu (housekeeping, not an edit), never refused as stale',
    !('audit' in hk.data.oabc1234) && hk.data.oabc1234.lu.by === 'Ray' && hk.data.oabc1234.deleted.by === 'Ray' && !hk.rejected.length, hk.rejected);
  // purge: deleted more than 30 days ago and still deleted in this copy → left out (absence under the read stamp removes it)
  const old = Object.assign({}, del.v, { deleted: { t: NOW - P.DELETED_PURGE_MS - 1000, by: 'Ray' } });
  const pg = P.sanitizeProposalPut({ oabc1234: JSON.parse(JSON.stringify(old)), oabc5678: JSON.parse(JSON.stringify(del.v)) }, { oabc1234: old, oabc5678: del.v }, { now: NOW, by: 'Nora', base: NOW - 1, inScope: () => true });
  t('a shed option deleted over 30 days ago leaves the map (left out, listed as purged); a recent one stays', !('oabc1234' in pg.data) && (pg.purged || []).join() === 'oabc1234' && pg.data.oabc5678 === del.v);
  // the key cap: shed options do not count, so the save that purges them is never itself refused
  const cur = {}, body = {};
  for (let i = 0; i < 1500; i++) { const k = 'oshed' + String(i).padStart(4, '0'); cur[k] = del.v; body[k] = del.v; }
  body.onewone1 = OPT();
  const cap = P.sanitizePut('proposals', body, cur, { now: NOW, by: 'Ray', base: NOW, inScope: () => true });
  t('1,500 shed options + 1 new: not "too many keys" (was: every save refused for good)', !cap.error && !!(cap.data && cap.data.onewone1), cap.error);
  const live1501 = {}; for (let i = 0; i < 1501; i++) live1501['olive' + String(i).padStart(4, '0')] = OPT();
  const full1501 = P.sanitizePut('proposals', live1501, {}, { now: NOW, by: 'Ray', base: NOW, inScope: () => true });
  t('1,501 live options: refused — and the reason says the store is full and what frees it', /too many keys/.test(full1501.error) && /proposals store is full/.test(full1501.error) && /delete options/.test(full1501.error), full1501.error);
}

// ---- fix round 1: the test packages are Management prices (addition B) ---------------------------------------------------
console.log('· the test-package prices: _g|test2 / test3 / test4 on the price store (addition B)');
{
  const r = P.sanitizeCellPut('price', { '_g|test2': 800, '_g|test3': '1140', '_g|test4': { v: 1440 }, '_g|test1': 1, '_g|test5': 1, 'title_gen|test2': 1 }, {}, ctx);
  const cv = (k) => r.data[k] || {};
  t('£ a month for 2, 3 and 4 tests land, stamped by the server', cv('_g|test2').v === 800 && cv('_g|test3').v === 1140 && cv('_g|test4').v === 1440 && cv('_g|test2').by === 'Steven');
  t('there is no 1- or 5-test package, and a test price is house-wide (never on a row)', ['_g|test1', '_g|test5', 'title_gen|test2'].every((k) => r.rejected.some((x) => x.k === k)));
  t('0 is a price (a free trial package is a decision); over £100,000 or negative is refused',
    (P.sanitizeCellPut('price', { '_g|test2': 0 }, {}, ctx).data['_g|test2'] || {}).v === 0
    && P.sanitizeCellPut('price', { '_g|test3': 100001 }, {}, ctx).rejected.length === 1 && P.sanitizeCellPut('price', { '_g|test4': -1 }, {}, ctx).rejected.length === 1);
  t('the test prices are price-store cells, never ops or cost', P.cellSpec('ops', '_g|test2') === null && P.cellSpec('cost', '_c|test2') === null && !!P.cellSpec('price', '_g|test4'));
}

// ---- Tier 3 · AI-Intel Refresher (Ray, 8 Oct 2026) ------------------------------------------------------------------------------------
console.log('· AI-Intel Refresher: _g|rfPct on the price store, and a Tier 3 option saves');
{
  const r = P.sanitizeCellPut('price', { '_g|rfPct': 40, 'title_gen|rfPct': 1 }, {}, ctx);
  t('the refresh % lands on the price store, stamped by the server', (r.data['_g|rfPct'] || {}).v === 40 && (r.data['_g|rfPct'] || {}).by === 'Steven');
  t('the refresh % is house-wide and never over 100 or below 0',
    r.rejected.some((x) => x.k === 'title_gen|rfPct') && P.sanitizeCellPut('price', { '_g|rfPct': 101 }, {}, ctx).rejected.length === 1 && P.sanitizeCellPut('price', { '_g|rfPct': -1 }, {}, ctx).rejected.length === 1);
  t('the refresh % is Management\'s (price), never ops or cost', P.cellSpec('ops', '_g|rfPct') === null && P.cellSpec('cost', '_c|rfPct') === null);
  t('go+ar+rf is a proposal option', P.PROPOSAL_OPTIONS.indexOf('go+ar+rf') >= 0);
  const t3 = P.cleanOption(OPT({ option: 'go+ar+rf', prop: { id: 'ppab13', n: 3, label: 'Tier 3 · AI-Intel Refresher' }, opts: { popts: { refresh: { cadence: 'quarterly', share: 50, fields: ['qa'], signals: ['reviews'] } } } }), undefined, ctx);
  t('…and a Tier 3 option saves with its refresh settings', t3.ok && t3.v.option === 'go+ar+rf' && t3.v.opts.popts.refresh.cadence === 'quarterly', t3.why);
}

// ---- pre-loaded examples (Ray, 8 Oct 2026: five products per brand, prepared ahead) ---------------------------------------------
console.log('· pre-loaded examples: cleanExamples + the /api/pricer/examples route');
const J = JSON.stringify;
{
  const prod = (i, ex) => ({ p: { id: 'NW-' + i, title: 'Northwind item ' + i, image_link: 'https://img.northwind.invalid/' + i + '.jpg', description: 'x'.repeat(5000), gtin: '5012345678900', hl: 3, hlv: ['a', 'b'], kw: ['k'] }, ex, src: 'ai' });
  const c = P.cleanExamples({ products: [prod(1, { title: 'A title', keywords: ['a', 'b'], gtin: '123', question_and_answer: [{ q: 'Q?', a: 'A.', evil: 'x' }] }), prod(2, null)] });
  t('five products at most, each with its row trimmed to the preview\'s fields', c.ok && c.v.length === 2 && c.v[0].p.description.length === 1200 && !('gtin' in c.v[0].p), c.why);
  t('…the example keeps only what the tiers write — never an identifier', c.ok && c.v[0].ex.title === 'A title' && !('gtin' in c.v[0].ex) && J(c.v[0].ex.question_and_answer) === J([{ q: 'Q?', a: 'A.' }]));
  t('…a product with no example is "derived", never "ai"', c.ok && c.v[1].ex === null && c.v[1].src === 'derived');
  t('six products, no products, or a row without an id is refused',
    !P.cleanExamples({ products: [1, 2, 3, 4, 5, 6].map((i) => prod(i, null)) }).ok && !P.cleanExamples({ products: [] }).ok && !P.cleanExamples({ products: [{ p: { title: 'no id' } }] }).ok);
  t('an image that is not http(s) is dropped', P.cleanExamples({ products: [{ p: { id: 'x', title: 'y', image_link: 'javascript:alert(1)' } }] }).v[0].p.image_link === undefined);
  const W = fs.readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
  t('the worker routes /api/pricer/examples through the Pricer gate and the client scope, one KV key per client',
    /if \(name === 'examples'\) return pricerExamplesRoute\(request, env\);/.test(W) && /async function pricerExamplesRoute/.test(W) && /moduleAllowed\(acc\.modules, 'pricer'\)/.test(W.split('async function pricerExamplesRoute')[1].slice(0, 400)) && /'pricerex:' \+ client/.test(W) && /clientMatch\(acc\.clients, c\)/.test(W.split('async function pricerExamplesRoute')[1].slice(0, 600)));
}

// ---- the optimisation bank (Ray, 8 Oct 2026) ------------------------------------------------------------------------------------
console.log('· the optimisation bank: pricerbank, Management-written, one entry per optimisation');
{
  const S = P.PRICER_STORES.bank;
  t('the bank is its own house-wide store, read by every Pricer signin, written by Management', S && S.kv === 'pricerbank' && S.scope === null && S.mgmtWrite === true && S.mgmtRead === false);
  const r = P.sanitizePut('bank', {
    highlights: { pkg: 'go', gives: '+4 highlights per product' },
    keywords: { pkg: 'tier9' },
    title: { pkg: 'go', unit: 5 },
    client: { pkg: 'go' },
    x_size_chart: { label: 'Size chart links', kind: 'feed', pkg: 'ar', fields: ['document_link'], unit: '0.05', setupH: 2, status: 'pilot', gives: 'a size chart on every product' },
    x_nameless: { pkg: 'ar' },
    x_stock_rc: { del: true },
    x_mine: { del: true },
    x_restock: { monthly: 150 },
  }, {}, Object.assign({}, ctx, { base: 0 }));
  const d = r.data, why = (k) => (r.rejected.filter((x) => x.k === k)[0] || {}).why || '';
  t('a package line moves tier and rewords what it gives, stamped by the server', d.highlights && d.highlights.pkg === 'go' && d.highlights.gives === '+4 highlights per product' && d.highlights.by === 'Steven');
  t('an unknown tier, a price on a package line and "client to supply" are refused', /pkg must be/.test(why('keywords')) && /only carries its tier/.test(why('title')) && /unknown key/.test(why('client')));
  t('a new optimisation lands with its fields, price, status and phrase (numbers read as numbers)', d.x_size_chart && d.x_size_chart.unit === 0.05 && d.x_size_chart.setupH === 2 && d.x_size_chart.status === 'pilot' && J(d.x_size_chart.fields) === J(['document_link']));
  t('a new optimisation needs a name; only a seed is removed with del', /needs a name/.test(why('x_nameless')) && d.x_stock_rc && d.x_stock_rc.del === true && /only a seeded/.test(why('x_mine')));
  t('a seeded service takes a monthly £ without restating its name', d.x_restock && d.x_restock.monthly === 150);
  const W = fs.readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
  t('ACT logs bank writes', /'\/api\/pricer\/bank': 'pricer-bank'/.test(W));
  const ER = createRequire(import.meta.url)('../docs/pricer_engine.js');
  t('the store\'s tiers, seeds and built-in keys are the engine\'s', J(P.BANK_TIERS) === J(ER.BANK_TIERS) && J(P.BANK_SEEDS) === J(Object.keys(ER.BANK_SEED)));
}

// ---- the ladder rounding (found by the review's route probe) ---------------------------------------------------------------
console.log('· the volume ladder rises as STORED, not as typed');
{
  t('5000.2 then 5000.4 would both store as 5000 — refused', !P.cleanTiers([{ upTo: 5000.2, x: 1 }, { upTo: 5000.4, x: 0.8 }, { upTo: null, x: 0.5 }]).ok);
  t('a bound that rounds to 0 is refused', !P.cleanTiers([{ upTo: 0.3, x: 1 }, { upTo: null, x: 0.5 }]).ok);
  t('a ladder that rises in whole products still lands, rounded', JSON.stringify(P.cleanTiers([{ upTo: 4999.6, x: 1 }, { upTo: null, x: 0.5 }]).v) === JSON.stringify([{ upTo: 5000, x: 1 }, { upTo: null, x: 0.5 }]));
}

// ---- 19. the scoping pair, held to the pre-change functions ------------------------------------------------------------
console.log('· sharedstate: scopeViewBy / scopeIncomingBy — identical to the functions they replaced');
{
  // the pre-change implementations, verbatim (sharedstate.js before 7 Oct 2026), so "identical behaviour" is checked
  // against what shipped rather than against the new code reading itself
  function OLD_clientOfEntry(ns, key, val) {
    const how = STATE_NS[ns];
    if (how === 'key') return String(key || '').split('|')[0];
    if (how === 'self') return String(key || '');
    if (how === 'field') return String((val && val.client) || '');
    return '';
  }
  function OLD_scopeStateView(ns, data, clients, match) {
    if (!clients || !STATE_NS[ns]) return data || {};
    const out = {};
    for (const k of Object.keys(data || {})) { if (match(clients, OLD_clientOfEntry(ns, k, data[k]))) out[k] = data[k]; }
    return out;
  }
  function OLD_scopeStateIncoming(ns, cur, incoming, clients, match) {
    if (!clients || !STATE_NS[ns]) return incoming || {};
    const out = {};
    for (const k of Object.keys(cur || {})) { if (!match(clients, OLD_clientOfEntry(ns, k, cur[k]))) out[k] = cur[k]; }
    for (const k of Object.keys(incoming || {})) { const c = OLD_clientOfEntry(ns, k, incoming[k]); if (match(clients, c)) out[k] = incoming[k]; }
    return out;
  }
  // the test_sharedstate fixtures, widened to every scoping shape
  const OWNED = ['House of Bruar'];
  const FX = {
    key: { cur: { 'House of Bruar|Titles': 'Done', 'Reiss|Coats': 'Open', 'Schuh|Denim': 'Briefed' }, inc: { 'House of Bruar|Titles': 'Briefed', 'Reiss|Coats': 'Done', 'houseofbruar|New': 'Open' } },
    self: { cur: { 'House of Bruar': 1, Schuh: 1, Reiss: { state: 'hold' } }, inc: { Reiss: 1, 'House of Bruar': { state: 'continue' } } },
    field: { cur: { r1: { client: 'Monsoon', task: 'T' }, r2: { client: 'House of Bruar', task: 'U' }, r3: { task: 'no client' } }, inc: { r2: { client: 'House of Bruar', task: 'U2' }, r4: { client: 'Reiss' }, r5: { client: 'House of Bruar' } } },
    none: { cur: { 'a@b.com': 'Reiss' }, inc: { 'c@d.com': 'Schuh' } },
  };
  const js = JSON.stringify;
  let same = 0, diff = [];
  const nsList = Object.keys(STATE_NS).concat(['unknownns', 'constructor', '__proto__']);
  for (const ns of nsList) {
    const how = STATE_NS[ns];
    const fx = FX[how === 'key' || how === 'self' || how === 'field' ? how : 'none'];
    for (const scope of [OWNED, null, [], ['Reiss', 'Schuh']]) {
      const pairs = [
        [OLD_scopeStateView(ns, fx.cur, scope, clientMatch), scopeStateView(ns, fx.cur, scope, clientMatch)],
        [OLD_scopeStateIncoming(ns, fx.cur, fx.inc, scope, clientMatch), scopeStateIncoming(ns, fx.cur, fx.inc, scope, clientMatch)],
        [OLD_scopeStateView(ns, null, scope, clientMatch), scopeStateView(ns, null, scope, clientMatch)],
        [OLD_scopeStateIncoming(ns, null, undefined, scope, clientMatch), scopeStateIncoming(ns, null, undefined, scope, clientMatch)],
        [OLD_clientOfEntry(ns, Object.keys(fx.cur)[0], fx.cur[Object.keys(fx.cur)[0]]), clientOfEntry(ns, Object.keys(fx.cur)[0], fx.cur[Object.keys(fx.cur)[0]])],
      ];
      pairs.forEach(([a, b], i) => { if (js(a) === js(b)) same++; else diff.push(ns + '#' + i + ' ' + js(scope)); });
    }
  }
  t('scopeStateView / scopeStateIncoming / clientOfEntry agree with the shipped versions on every namespace × scope (' + same + ' comparisons)', !diff.length, diff.slice(0, 5));
  // and the rule-level pair is the same function the namespaces now route through
  t('scopeViewBy(rule) === scopeStateView(ns) for each rule', js(scopeViewBy('field', FX.field.cur, OWNED, clientMatch)) === js(scopeStateView('manual', FX.field.cur, OWNED, clientMatch))
    && js(scopeViewBy('self', FX.self.cur, OWNED, clientMatch)) === js(scopeStateView('wfremoved', FX.self.cur, OWNED, clientMatch))
    && js(scopeViewBy('key', FX.key.cur, OWNED, clientMatch)) === js(scopeStateView('taskstatus', FX.key.cur, OWNED, clientMatch)));
  t('scopeIncomingBy re-injects every foreign record (the tombstone trap) for a store that is not a state namespace',
    js(Object.keys(scopeIncomingBy('field', { a: { client: 'Southwind' }, b: { client: 'Northwind' } }, { b: { client: 'Northwind', x: 1 } }, ['Northwind'], clientMatch)).sort()) === js(['a', 'b']));
  t('a house-wide rule (null) is never filtered', js(scopeViewBy(null, { k: 1 }, OWNED, clientMatch)) === js({ k: 1 }));
}

// ---- 18. the routes, lifted out of worker.js -------------------------------------------------------------------------
console.log('· pricerRoute — lifted from worker.js, against a stub KV and a stubbed accessOf');
const liftF = (name, prefix) => { const a = WK.indexOf((prefix || '') + 'function ' + name + '('); const b = WK.indexOf('\n}\n', a); if (a < 0 || b < 0) throw new Error('cannot lift ' + name); return WK.slice(a, b + 2); };
const ACCS = {
  owner:   { email: 'ray@feedspark.com', owner: true, clients: null, modules: null, name: 'Ray' },
  am:      { email: 'steven@feedspark.com', owner: false, clients: null, modules: null, name: 'Steven' },
  wfonly:  { email: 'wf@feedspark.com', owner: false, clients: null, modules: ['workflow'], name: 'Wf' },
  mgmt:    { email: 'andy@feedspark.com', owner: false, clients: null, modules: ['pricer', 'pricer-cost'], name: 'Andy' },
  costonly:{ email: 'cfo@feedspark.com', owner: false, clients: null, modules: ['pricer-cost'], name: 'Cfo' },
  scoped:  { email: 'nora@feedspark.com', owner: false, clients: ['Northwind'], modules: null, name: 'Nora' },
};
const KV = new Map(); const GETS = []; const PUTS = [];
const env = { EDITS: {
  get: async (k, type) => { GETS.push(k); const v = KV.get(k); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); },
  put: async (k, v) => { PUTS.push(k); KV.set(k, v); },
} };
const accessOf = async (e, req) => ACCS[req.headers.get('x-test-who')];
const pricerRoute = new Function('PSTORE', 'accessOf', 'moduleAllowed', 'clientMatch', 'displayName', 'liftEnvelope', 'mergeIntoEnvelope', 'scopeViewBy', 'scopeIncomingBy', 'CORS',
  liftF('json') + '\n' + liftF('pricerRoute', 'async ') + '\nreturn pricerRoute;')(P, accessOf, moduleAllowed, clientMatch, displayName, liftEnvelope, mergeIntoEnvelope, scopeViewBy, scopeIncomingBy, {});
async function call(who, method, store, body, base) {
  const headers = { 'x-test-who': who, 'content-type': 'application/json' };
  if (base != null) headers['X-Sync-Base'] = String(base);
  const req = new Request('https://fcc.test/api/pricer/' + store, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const res = await pricerRoute(req, env, '/api/pricer/' + store);
  let j = null; try { j = await res.json(); } catch (e) {}
  return { status: res.status, j, base: +res.headers.get('X-Sync-Base') || 0 };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{
  let r;
  // the module gate
  GETS.length = 0;
  r = await call('wfonly', 'GET', 'ops');
  t('a signin without the pricer grant gets 403 on /api/pricer/ops', r.status === 403 && !GETS.includes('pricerops'), r);
  r = await call('wfonly', 'PUT', 'roadmap', { 'title|*': { status: 'live' } });
  t('…and on every store, writes included (roadmap PUT)', r.status === 403 && !PUTS.length);
  r = await call('costonly', 'GET', 'cost');
  t('pricer-cost WITHOUT pricer is still refused (every store needs the pricer grant first)', r.status === 403);

  // the cost store: refused before its key is ever read
  GETS.length = 0;
  r = await call('am', 'GET', 'cost');
  t('cost GET: 403 for an UNRESTRICTED non-owner (pricer-cost is opt-in)', r.status === 403 && /Management/.test(r.j.error), r);
  t('…refused BEFORE any EDITS.get(\'pricercost\')', !GETS.includes('pricercost'), GETS);
  GETS.length = 0;
  r = await call('am', 'PUT', 'cost', { '_c|rateAm': 40 });
  t('cost PUT: 403 for a non-management signin, again before the key is read and with nothing written', r.status === 403 && !GETS.includes('pricercost') && !PUTS.includes('pricercost'));
  r = await call('mgmt', 'PUT', 'cost', { '_c|rateAm': 40, '_c|ohPct': 35, '_c|marginPct': 40, '_c|tokAsOf': '2026-10-07' });
  t('cost PUT: the pricer-cost grant writes it, stamped by the server', r.status === 200 && r.j['_c|rateAm'].v === 40 && r.j['_c|rateAm'].by === 'Andy', r);
  t('…stored under the KV-safe key (~c|), served back as _c|', KV.has('pricercost') && '~c|rateAm' in JSON.parse(KV.get('pricercost')).data && !('_rejected' in r.j));
  r = await call('owner', 'GET', 'cost');
  t('cost GET: the owner reads it', r.status === 200 && r.j['_c|ohPct'].v === 35 && r.base > 0);

  // price: everyone reads, Management writes
  GETS.length = 0; const putsBefore = PUTS.length;
  r = await call('am', 'PUT', 'price', { 'title_gen|unit': 0.09 });
  t('price PUT: 403 for a non-management signin — before the store is read, nothing written', r.status === 403 && /Management/.test(r.j.error) && !GETS.includes('pricerprice') && PUTS.length === putsBefore, r);
  r = await call('owner', 'PUT', 'price', { 'title_gen|unit': 0.09, '_g|blockGBP': 585, '_g|tiers': [{ upTo: 5000, x: 1 }, { upTo: null, x: 0.5 }], 'title_gen|unit2': 1 });
  t('price PUT: the owner writes it', r.status === 200 && r.j['title_gen|unit'].v === 0.09 && r.j['_g|blockGBP'].by === 'Ray' && r.j['_g|tiers'].v.length === 2, r);
  t('…a refused key comes back in _rejected beside the merged map', Array.isArray(r.j._rejected) && r.j._rejected[0].k === 'title_gen|unit2' && !('title_gen|unit2' in r.j));
  r = await call('am', 'GET', 'price');
  t('price GET: any Pricer signin reads the sell price', r.status === 200 && r.j['_g|blockGBP'].v === 585);
  r = await call('mgmt', 'PUT', 'price', Object.assign({}, r.j, { '_g|bundlePct': 10 }), r.base);
  t('price PUT: the pricer-cost grant writes it too; the untouched cells keep the owner\'s stamp', r.status === 200 && r.j['_g|bundlePct'].by === 'Andy' && r.j['_g|blockGBP'].by === 'Ray');

  // ops: any Pricer signin, whole-map under X-Sync-Base
  r = await call('am', 'GET', 'ops');
  t('ops GET: X-Sync-Base is handed out', r.status === 200 && r.base > 0);
  r = await call('am', 'PUT', 'ops', { 'title_gen|aMin': 45, 'attr_pop|tokPerP': 1200, '_g|ruleH': 2 }, r.base);
  t('ops PUT: an unrestricted AM writes the ops half', r.status === 200 && r.j['title_gen|aMin'].by === 'Steven' && r.j['_g|ruleH'].v === 2);
  await sleep(2);
  const opsBase = (await call('am', 'GET', 'ops')).base;
  r = await call('am', 'PUT', 'ops', { 'title_gen|aMin': 'forty', 'attr_pop|tokPerP': 1200 }, opsBase);
  t('ops PUT under the read stamp: a cell left out is deleted (absence), a malformed one KEEPS its stored value', r.status === 200 && !('_g|ruleH' in r.j) && r.j['title_gen|aMin'].v === 45 && r.j._rejected.some((x) => x.k === 'title_gen|aMin'), r.j);
  r = await call('am', 'PUT', 'ops', 'not json');
  t('ops PUT: a body that is not JSON is a 400', r.status === 400);
  r = await call('am', 'PUT', 'ops', [1, 2]);
  t('ops PUT: a body that is not a map is a 400', r.status === 400 && /object/.test(r.j.error));
  r = await call('am', 'POST', 'ops', {});
  t('POST is not a method here (405)', r.status === 405);
  r = await call('am', 'GET', 'nope');
  t('an unknown store is a 404', r.status === 404);
  r = await call('am', 'GET', '__proto__');
  t('…prototype names included', r.status === 404);

  // proposals: scoped 'field'
  const north = OPT(), south = OPT({ ref: 'SVC654321', client: 'Southwind', prop: { id: 'ppcd34', n: 1, label: '' } });
  r = await call('owner', 'PUT', 'proposals', { onorth01: north, osouth01: south });
  t('proposals: the owner saves options for two clients', r.status === 200 && r.j.onorth01 && r.j.osouth01 && r.j.onorth01.by === 'Ray');
  await sleep(2);
  r = await call('scoped', 'GET', 'proposals');
  t('proposals GET: a scoped signin sees only their client\'s options', r.status === 200 && Object.keys(r.j).join(',') === 'onorth01', r.j && Object.keys(r.j));
  const sb = r.base;
  const mine = Object.assign(JSON.parse(JSON.stringify(r.j.onorth01)), { chosen: { t: Date.now() } });
  r = await call('scoped', 'PUT', 'proposals', { onorth01: mine, osouth01: Object.assign({}, south, { declined: true }), onew0001: OPT({ client: 'Southwind' }) }, sb);
  t('proposals PUT (scoped): their own option moves, stamped by them', r.status === 200 && r.j.onorth01.chosen && r.j.onorth01.chosen.by === 'Nora', r.j);
  t('…a write over a foreign option and a new foreign option are refused and named', r.j._rejected && r.j._rejected.filter((x) => /^outside your clients/.test(x.why)).map((x) => x.k).sort().join(',') === 'onew0001,osouth01');
  t('…and the reply is still their scoped view', !('osouth01' in r.j) && !('onew0001' in r.j));
  r = await call('owner', 'GET', 'proposals');
  t('proposals: the foreign option SURVIVES the scoped whole-map save, untouched (re-injected before the merge)', r.j.osouth01 && !r.j.osouth01.declined && !r.j.onew0001 && r.j.onorth01.chosen);
  await sleep(2);
  const sb2 = (await call('scoped', 'GET', 'proposals')).base;
  r = await call('scoped', 'PUT', 'proposals', {}, sb2);
  t('proposals PUT (scoped): emptying their view deletes only their own option', r.status === 200 && !Object.keys(r.j).filter((k) => k.charAt(0) !== '_').length);
  r = await call('owner', 'GET', 'proposals');
  t('…every other client\'s option is still there', !!r.j.osouth01 && !r.j.onorth01);

  // rollout: scoped 'self'
  r = await call('owner', 'PUT', 'rollout', { Northwind: { next: 'Debrief', nextDue: '2026-10-10' }, Southwind: { next: 'Chase', am: 'Ray' } });
  t('rollout: the owner writes two clients', r.status === 200 && r.j.Northwind.next === 'Debrief' && r.j.Southwind.lu.by === 'Ray');
  await sleep(2);
  r = await call('scoped', 'GET', 'rollout');
  t('rollout GET: a scoped signin sees only their client (scoped by the KEY)', Object.keys(r.j).join(',') === 'Northwind');
  r = await call('scoped', 'PUT', 'rollout', { Northwind: Object.assign({}, r.j.Northwind, { debriefAt: true }), Southwind: { next: 'hijack' } }, r.base);
  t('rollout PUT (scoped): their client moves; a foreign client is refused', r.status === 200 && r.j.Northwind.debriefAt.by === 'Nora' && r.j._rejected.some((x) => x.k === 'Southwind' && /^outside your clients/.test(x.why)));
  r = await call('owner', 'GET', 'rollout');
  t('…the foreign record is untouched', r.j.Southwind.next === 'Chase');

  // roadmap: house-wide
  r = await call('am', 'PUT', 'roadmap', { 'attr_rule|*': { status: 'live' }, 'alwayson|*': { status: 'planned', note: 'routing next quarter' } });
  t('roadmap: any Pricer signin writes it, stamped', r.status === 200 && r.j['attr_rule|*'].by === 'Steven' && r.j['alwayson|*'].status === 'planned');
  r = await call('scoped', 'GET', 'roadmap');
  t('roadmap: house-wide — a scoped signin reads all of it', !!r.j['attr_rule|*'] && !!r.j['alwayson|*']);
}

// ---- fix round 1, through the real route ---------------------------------------------------------------------------------
console.log('· fix round 1 through pricerRoute: two tabs, a stale whole-map save, a full store, a scoped prospect');
{
  let r;
  ACCS.ana = { email: 'ana@feedspark.com', owner: false, clients: null, modules: null, name: 'Ana' };
  const strip = (m) => { const o = Object.assign({}, m); delete o._rejected; return o; };

  // finding 13 — the review's probe P1: Steven's tab is stale; he edits a DIFFERENT field on the same row
  KV.delete('pricerops');
  await call('owner', 'PUT', 'ops', { 'title_gen|aMin': 30, 'title_gen|qcPct': 10 });
  await sleep(2);
  const steven = await call('am', 'GET', 'ops');                       // Steven reads aMin = 30
  await sleep(2);
  const anaV = await call('ana', 'GET', 'ops');
  r = await call('ana', 'PUT', 'ops', Object.assign(strip(anaV.j), { 'title_gen|aMin': { v: 45 } }), anaV.base);
  t('Ana saves aMin = 45', r.j['title_gen|aMin'].v === 45 && r.j['title_gen|aMin'].by === 'Ana');
  await sleep(2);
  const sm = strip(steven.j); sm['title_gen|qcPct'] = { v: 20 };
  r = await call('am', 'PUT', 'ops', sm, steven.base);
  t('Steven\'s stale whole-map save leaves Ana\'s aMin = 45 and her stamp (was: 30, credited to Steven)', r.j['title_gen|aMin'].v === 45 && r.j['title_gen|aMin'].by === 'Ana', r.j['title_gen|aMin']);
  t('…his own edit lands', r.j['title_gen|qcPct'].v === 20 && r.j['title_gen|qcPct'].by === 'Steven');
  t('…and the reply names aMin: "changed by Ana since you loaded — reload to edit it"', (r.j._rejected || []).some((x) => x.k === 'title_gen|aMin' && x.why === 'changed by Ana since you loaded — reload to edit it'), r.j._rejected);
  // the page's own pending re-apply rides the base its save just returned — never refused
  const b1 = r.base;
  r = await call('am', 'PUT', 'ops', Object.assign(strip(r.j), { 'title_gen|qcPct': { v: 22 } }), b1);
  t('a second save on the base the first one returned (the page\'s pending re-apply) is accepted, nothing refused', r.j['title_gen|qcPct'].v === 22 && !r.j._rejected, r.j._rejected);
  // a key a colleague removed after the read: the writer's copy is dropped by kvmerge — and now said so
  await sleep(2);
  const nowStale = r.base;
  const anaV2 = await call('ana', 'GET', 'ops');
  const anaMap = strip(anaV2.j); delete anaMap['title_gen|qcPct'];
  await call('ana', 'PUT', 'ops', anaMap, anaV2.base);                 // Ana clears qcPct (absence)
  await sleep(2);
  r = await call('am', 'PUT', 'ops', { 'title_gen|aMin': { v: 45, by: 'Ana', at: 1 }, 'title_gen|qcPct': { v: 23 } }, nowStale);
  t('editing a cell a colleague REMOVED since the read: not resurrected, and named "removed since you loaded"',
    !('title_gen|qcPct' in r.j) && (r.j._rejected || []).some((x) => x.k === 'title_gen|qcPct' && /^removed since you loaded/.test(x.why)), r.j);
  // no read stamp at all = read nothing
  r = await call('am', 'PUT', 'ops', { 'title_gen|aMin': 50 });
  t('a save that sends no X-Sync-Base cannot overwrite a stamped value (it read nothing)', r.j['title_gen|aMin'].v === 45 && r.j._rejected.some((x) => x.k === 'title_gen|aMin'));

  // finding 13 — probe P2: a stale proposals tab declines option 2; option 1's ✓ Chosen survives
  KV.delete('pricerprop');
  const o1 = OPT({ prop: { id: 'ppab12', n: 1, label: 'Tier 1 · Google-ready' } });
  const o2 = OPT({ ref: 'SVC123456-2', prop: { id: 'ppab12', n: 2, label: 'Tier 2 · AI-ready' }, option: 'go+ar' });
  await call('owner', 'PUT', 'proposals', { onorth0001: o1, onorth0002: o2 });
  await sleep(2);
  const nora = await call('scoped', 'GET', 'proposals');
  await sleep(2);
  const ov = await call('owner', 'GET', 'proposals');
  const c1 = JSON.parse(JSON.stringify(ov.j.onorth0001)); c1.chosen = { t: Date.now() };
  r = await call('owner', 'PUT', 'proposals', Object.assign(strip(ov.j), { onorth0001: c1 }), ov.base);
  t('Ray marks option 1 ✓ Chosen', r.j.onorth0001.chosen && r.j.onorth0001.chosen.by === 'Ray');
  await sleep(2);
  const nm = strip(nora.j); const d2 = JSON.parse(JSON.stringify(nm.onorth0002)); d2.declined = { t: Date.now() }; nm.onorth0002 = d2;
  r = await call('scoped', 'PUT', 'proposals', nm, nora.base);
  t('Nora\'s stale tab declines option 2 — it lands', r.j.onorth0002.declined && r.j.onorth0002.declined.by === 'Nora');
  t('…and option 1 KEEPS Ray\'s ✓ Chosen and lu (was: chosen cleared, lu "Nora")', r.j.onorth0001.chosen && r.j.onorth0001.chosen.by === 'Ray' && r.j.onorth0001.lu.by === 'Ray', r.j.onorth0001);
  t('…named for the page, which shows it only if Nora had changed it herself', (r.j._rejected || []).some((x) => x.k === 'onorth0001' && x.why === 'changed by Ray since you loaded — reload to edit it'));

  // finding 34 (server half) — a scoped signin's prospect is refused with a reason the page can show as it stands
  r = await call('scoped', 'PUT', 'proposals', Object.assign(strip(r.j), { oacme00001: OPT({ client: 'Acme Prospect', prop: { id: 'ppacme1', n: 1, label: '' } }) }), r.base);
  const why = ((r.j._rejected || []).find((x) => x.k === 'oacme00001') || {}).why || '';
  t('a scoped signin\'s prospect proposal is refused, and the reason names it and says it needs an unscoped signin',
    !('oacme00001' in r.j) && /^outside your clients — "Acme Prospect" is not one of your accounts/.test(why) && /unscoped signin/.test(why), why);
  r = await call('owner', 'GET', 'proposals');
  t('…nothing was written for it', !r.j.oacme00001);

  // findings 14 + 30 — fill the store past 20 MB, then recover by deleting (which now frees the bytes)
  KV.delete('pricerprop');
  const big = { gb: { src: 'stored', S: 1000, P: 400, pad: 'x'.repeat(58 * 1024) } };
  const envx = { __v: 2, data: {}, meta: {} };
  const T0 = Date.now() - 60000;
  for (let i = 0; i < 345; i++) {
    const k = 'ofull' + String(i).padStart(4, '0');
    envx.data[k] = P.cleanOption(OPT({ audit: big }), undefined, { now: T0, by: 'Ray', inScope: () => true }).v;
    envx.meta[k] = { t: T0 };
  }
  KV.set('pricerprop', JSON.stringify(envx));
  const fullSize = KV.get('pricerprop').length;
  const g = await call('owner', 'GET', 'proposals');
  r = await call('owner', 'PUT', 'proposals', Object.assign(strip(g.j), { onewbig01: OPT() }), g.base);
  t('a store past 20 MB answers 413 — "the proposals store is full … Delete options nobody needs" (the page stops on it)',
    r.status === 413 && /proposals store is full/.test(r.j.error) && /Delete options nobody needs/.test(r.j.error), { status: r.status, size: fullSize, error: r.j && r.j.error });
  const delAll = strip(g.j);
  Object.keys(delAll).forEach((k) => { delAll[k] = Object.assign(JSON.parse(JSON.stringify(delAll[k])), { deleted: { t: Date.now() } }); });
  r = await call('owner', 'PUT', 'proposals', delAll, g.base);
  const shrunk = KV.get('pricerprop').length;
  t('deleting the options is itself a save that fits: 200, every option still listed (deleted)', r.status === 200 && Object.keys(strip(r.j)).length === 345 && !!(strip(r.j).ofull0000 || {}).deleted);
  t('…and the store SHRANK to a fraction (was: soft delete kept every snapshot, so nothing could ever be freed)', shrunk < fullSize / 20, { fullSize, shrunk });
  r = await call('owner', 'PUT', 'proposals', Object.assign(strip(r.j), { onewbig01: OPT() }), r.base);
  t('…so the next proposal saves', r.status === 200 && !!r.j.onewbig01);
  // 30 days on, a deleted option leaves the map on the next save (tombstoned under the read stamp)
  const env2 = JSON.parse(KV.get('pricerprop'));
  const o0 = env2.data.ofull0000;
  if (o0 && o0.deleted) o0.deleted.t = Date.now() - P.DELETED_PURGE_MS - 60000;
  KV.set('pricerprop', JSON.stringify(env2));
  const g2 = await call('owner', 'GET', 'proposals');
  r = await call('owner', 'PUT', 'proposals', strip(g2.j), g2.base);
  const env3 = JSON.parse(KV.get('pricerprop'));
  t('an option deleted over 30 days ago is purged on the next save — gone from the map, a tombstone in its place',
    r.status === 200 && !r.j.ofull0000 && !env3.data.ofull0000 && env3.meta.ofull0000 && env3.meta.ofull0000.del === 1 && !!r.j.ofull0001);
}

// ---- finding 15 — the legacy rate card's PUT is Management's -------------------------------------------------------------
console.log('· /api/tachyon/rates: GET open, PUT owner or pricer-cost only (finding 15)');
{
  const json = (data, status = 200, extra) => new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, extra || {}) });
  const mapStore = new Function('liftEnvelope', 'mergeIntoEnvelope', 'envelopeToClient', 'json',
    liftF('mapStoreRoute', 'async ') + '\nreturn mapStoreRoute;')(liftEnvelope, mergeIntoEnvelope, envelopeToClient, json);
  let ratesRoute;
  try {
    ratesRoute = new Function('accessOf', 'moduleAllowed', 'mapStoreRoute', 'json',
      liftF('tachyonRatesRoute', 'async ') + '\nreturn tachyonRatesRoute;')(accessOf, moduleAllowed, mapStore, json);
  } catch (e) { ratesRoute = async (req) => mapStore(env, req, 'tachyonrates', {}); }   // no gated handler: the pre-fix route
  const rc = async (who, method, body) => {
    const req = new Request('https://fcc.test/api/tachyon/rates', { method, headers: { 'x-test-who': who, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await ratesRoute(req, env);
    let j = null; try { j = await res.json(); } catch (e) {}
    return { status: res.status, j };
  };
  KV.delete('tachyonrates');
  let r = await rc('owner', 'PUT', { title_gen: { unit: 0.08 } });
  t('the owner writes the legacy card', r.status === 200 && r.j.title_gen.unit === 0.08);
  const putsBefore = PUTS.length;
  r = await rc('am', 'PUT', { title_gen: { unit: 0.0001 } });
  t('an AM without pricer-cost is refused (was: any signin could price every un-entered row at £0.0001)', r.status === 403 && /Management/.test(r.j.error) && PUTS.length === putsBefore, r);
  r = await rc('scoped', 'PUT', { title_gen: { unit: 0.0001 } });
  t('…a scoped signin too', r.status === 403);
  r = await rc('am', 'GET');
  t('GET stays open — the AI Quote and composeRates still read it', r.status === 200 && r.j.title_gen.unit === 0.08);
  r = await rc('mgmt', 'PUT', { title_gen: { unit: 0.09 } });
  t('the pricer-cost grant writes it (the same rule as the sell price)', r.status === 200 && r.j.title_gen.unit === 0.09);
  t('route() hands /api/tachyon/rates to the gated handler, not straight to mapStoreRoute',
    /if \(path === '\/api\/tachyon\/rates'\) \{\s*const r = await tachyonRatesRoute\(request, env\);/.test(WK) && !/'tachyonrates', \{\}\);\s*if \(r\) return r;/.test(WK.slice(WK.indexOf("path === '/api/tachyon/rates'"), WK.indexOf("path === '/api/tachyon/rates'") + 200)));
}

// ---- wiring --------------------------------------------------------------------------------------------------------------
console.log('· wiring in worker.js');
{
  t('route() hands every /api/pricer/* path to pricerRoute', /if \(path\.startsWith\('\/api\/pricer\/'\)\) return pricerRoute\(request, env, path\);/.test(WK));
  t('pricerstore + the rule-level scoping pair are imported', /import \* as PSTORE from "\.\/pricerstore\.js";/.test(WK) && /scopeViewBy, scopeIncomingBy \} from "\.\/sharedstate\.js";/.test(WK));
  const act = /const ACT = \{([\s\S]*?)\};/.exec(WK);
  const want = { ops: 'pricer-ops', price: 'pricer-price', cost: 'pricer-cost', proposals: 'pricer-prop', rollout: 'pricer-roll', roadmap: 'pricer-map', bank: 'pricer-bank' };
  t('ACT logs every store write (pricer-ops … pricer-map)', !!act && Object.keys(want).every((s) => act[1].indexOf("'/api/pricer/" + s + "': '" + want[s] + "'") >= 0));
  t('ACT covers exactly the seven stores the module serves (the six + the optimisation bank)', JSON.stringify(Object.keys(P.PRICER_STORES).sort()) === JSON.stringify(Object.keys(want).sort()));
  const body = liftF('pricerRoute', 'async ');
  const gate = body.indexOf("moduleAllowed(acc.modules, 'pricer')"), mg = body.indexOf("moduleAllowed(acc.modules, 'pricer-cost')"), kv = body.indexOf('env.EDITS.get(S.kv');
  t('the pricer gate, then the Management gate, both precede the store read', gate > 0 && mg > gate && kv > mg);
  t('the KV keys are the six the spec names + the optimisation bank', JSON.stringify(Object.values(P.PRICER_STORES).map((s) => s.kv)) === JSON.stringify(['pricerops', 'pricerprice', 'pricercost', 'pricerprop', 'svcroll', 'svcmap', 'pricerbank']));
  t('scoping rules: proposals by the record\'s client, rollout by the key, the rest house-wide',
    P.PRICER_STORES.proposals.scope === 'field' && P.PRICER_STORES.rollout.scope === 'self' && ['ops', 'price', 'cost', 'roadmap'].every((s) => P.PRICER_STORES[s].scope === null));
  t('no client figure or name in the store module (synthetic names live in this harness only)', !/Northwind|Reiss|Superdry|Schuh|Monsoon/.test(PS));
}

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
