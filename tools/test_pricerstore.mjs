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
// Run: node tools/test_pricerstore.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as P from '../cloudflare/feedspark-deck/src/pricerstore.js';
import { STATE_NS, clientOfEntry, scopeViewBy, scopeIncomingBy, scopeStateView, scopeStateIncoming } from '../cloudflare/feedspark-deck/src/sharedstate.js';
import { clientMatch, moduleAllowed, displayName } from '../cloudflare/feedspark-deck/src/access.js';
import { liftEnvelope, mergeIntoEnvelope } from '../cloudflare/feedspark-deck/src/kvmerge.js';
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const PS = read('cloudflare/feedspark-deck/src/pricerstore.js');
let pass = 0, fail = 0;
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
  prop: { id: 'ppab12', n: 1, label: 'Tier 1 · Google Optimise' }, option: 'go', pkgVersion: 'v1',
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
  t('a write for a foreign client is refused, "outside your clients"', !('oabcdef4' in fenced.data) && fenced.rejected[0].why === 'outside your clients');
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
  t('rollout: a foreign client\'s record is refused (the route re-injects the stored one)', !('Southwind' in fenced.data) && fenced.rejected[0].why === 'outside your clients');

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
  t('…a write over a foreign option and a new foreign option are refused and named', r.j._rejected && r.j._rejected.filter((x) => x.why === 'outside your clients').map((x) => x.k).sort().join(',') === 'onew0001,osouth01');
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
  t('rollout PUT (scoped): their client moves; a foreign client is refused', r.status === 200 && r.j.Northwind.debriefAt.by === 'Nora' && r.j._rejected.some((x) => x.k === 'Southwind' && x.why === 'outside your clients'));
  r = await call('owner', 'GET', 'rollout');
  t('…the foreign record is untouched', r.j.Southwind.next === 'Chase');

  // roadmap: house-wide
  r = await call('am', 'PUT', 'roadmap', { 'attr_rule|*': { status: 'live' }, 'alwayson|*': { status: 'planned', note: 'routing next quarter' } });
  t('roadmap: any Pricer signin writes it, stamped', r.status === 200 && r.j['attr_rule|*'].by === 'Steven' && r.j['alwayson|*'].status === 'planned');
  r = await call('scoped', 'GET', 'roadmap');
  t('roadmap: house-wide — a scoped signin reads all of it', !!r.j['attr_rule|*'] && !!r.j['alwayson|*']);
}

// ---- wiring --------------------------------------------------------------------------------------------------------------
console.log('· wiring in worker.js');
{
  t('route() hands every /api/pricer/* path to pricerRoute', /if \(path\.startsWith\('\/api\/pricer\/'\)\) return pricerRoute\(request, env, path\);/.test(WK));
  t('pricerstore + the rule-level scoping pair are imported', /import \* as PSTORE from "\.\/pricerstore\.js";/.test(WK) && /scopeViewBy, scopeIncomingBy \} from "\.\/sharedstate\.js";/.test(WK));
  const act = /const ACT = \{([\s\S]*?)\};/.exec(WK);
  const want = { ops: 'pricer-ops', price: 'pricer-price', cost: 'pricer-cost', proposals: 'pricer-prop', rollout: 'pricer-roll', roadmap: 'pricer-map' };
  t('ACT logs every store write (pricer-ops … pricer-map)', !!act && Object.keys(want).every((s) => act[1].indexOf("'/api/pricer/" + s + "': '" + want[s] + "'") >= 0));
  t('ACT covers exactly the six stores the module serves', JSON.stringify(Object.keys(P.PRICER_STORES).sort()) === JSON.stringify(Object.keys(want).sort()));
  const body = liftF('pricerRoute', 'async ');
  const gate = body.indexOf("moduleAllowed(acc.modules, 'pricer')"), mg = body.indexOf("moduleAllowed(acc.modules, 'pricer-cost')"), kv = body.indexOf('env.EDITS.get(S.kv');
  t('the pricer gate, then the Management gate, both precede the store read', gate > 0 && mg > gate && kv > mg);
  t('the KV keys are the six the spec names', JSON.stringify(Object.values(P.PRICER_STORES).map((s) => s.kv)) === JSON.stringify(['pricerops', 'pricerprice', 'pricercost', 'pricerprop', 'svcroll', 'svcmap']));
  t('scoping rules: proposals by the record\'s client, rollout by the key, the rest house-wide',
    P.PRICER_STORES.proposals.scope === 'field' && P.PRICER_STORES.rollout.scope === 'self' && ['ops', 'price', 'cost', 'roadmap'].every((s) => P.PRICER_STORES[s].scope === null));
  t('no client figure or name in the store module (synthetic names live in this harness only)', !/Northwind|Reiss|Superdry|Schuh|Monsoon/.test(PS));
}

console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
