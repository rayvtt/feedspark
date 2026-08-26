/*
 * FCC per-user access scoping (Ray, Aug 2026): "individual access for each of the users,
 * with a designated Workflow view for their managed client only."
 *
 * Model — three tiers, resolved per request from the verified Cloudflare Access identity:
 *   owner     the account owner (OWNER_EMAIL): full house, and the only editor of the
 *             directory (the Workflow 👥 Access panel → PUT /api/access).
 *   scoped    a signin with assigned clients — via a directory row, OR the client-team
 *             alias auto-rule: an email whose local part IS a client name sees that client
 *             (houseofbruar@feedspark.com → House of Bruar, schuh@ → Schuh) with zero
 *             config. Their Workflow (briefs, email intake, call actions, triage) is
 *             filtered SERVER-SIDE to those clients; other modules stay open to them.
 *   open      everyone else behind Access (unassigned staff): today's full view. Scoping
 *             only ever narrows — a wrong or stale directory row can't widen anything.
 *
 * The directory lives in KV `accessdir` (owner-edited, replaces the git seed once saved).
 * Matching is slug-based (case + accent + punctuation folded) so 'House of Bruar',
 * 'houseofbruar' and 'Estée Lauder'/'esteelauder' all line up.
 */

// git seed: in effect until the owner first saves the panel. Radostina co-manages
// House of Bruar with Ray — her row works for whichever address she signs in with
// alongside the houseofbruar@ alias the auto-rule already covers.
export const ACCESS_SEED = {
  'radostina@feedspark.com': { name: 'Radostina', clients: ['House of Bruar'] },
};

// 'Estée Lauder' -> 'esteelauder', 'House of Bruar' -> 'houseofbruar'
export function clientSlug(name) {
  return String(name || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

// client-team alias auto-rule: local part of the email folded == a known client name.
// Personal signins aren't client-named, so they fall through to the directory.
export function aliasClient(email, clientNames) {
  const e = String(email || '');
  const at = e.indexOf('@');
  if (at < 1) return null;
  const local = clientSlug(e.slice(0, at));
  if (!local) return null;
  for (const n of clientNames || []) { if (clientSlug(n) === local) return n; }
  return null;
}

// one signin -> its scope. dir = stored directory (null -> git seed); clientNames = the
// known client roster the alias rule matches against. clients:null = full house.
export function resolveAccess(email, owner, dir, clientNames) {
  if (owner) return { email, owner: true, clients: null, name: 'Owner' };
  const d = dir || ACCESS_SEED;
  const row = d[String(email || '').toLowerCase()];
  if (row && Array.isArray(row.clients) && row.clients.length) {
    return { email, owner: false, clients: row.clients.slice(0, 20).map(String), name: String(row.name || '') };
  }
  const ali = aliasClient(email, clientNames);
  if (ali) return { email, owner: false, clients: [ali], name: '' };
  return { email, owner: false, clients: null, name: '' };
}

// does this client name fall inside the scope? clients:null = full house = everything.
// An EMPTY/missing name never matches a real scope: unattributed rows stay owner-side.
export function clientMatch(clients, name) {
  if (!clients) return true;
  const s = clientSlug(name);
  if (!s) return false;
  return clients.some((c) => clientSlug(c) === s);
}

// GET /api/briefs for a scoped signin: just their clients' briefs
export function scopeBriefsView(data, clients) {
  const out = {};
  for (const k of Object.keys(data || {})) {
    const b = data[k];
    if (b && clientMatch(clients, b.client)) out[k] = b;
  }
  return out;
}

// PUT /api/briefs for a scoped signin, BEFORE the kvmerge pass. The writer only ever saw
// the scoped view, and this store deletes by absence (X-Sync-Base) — so every brief the
// writer can't see must be re-injected as-stored or their save would tombstone the whole
// rest of the board. Also the fence: a brief can't be created for, moved to, or edited
// under a foreign client — those keys keep their stored value.
export function scopeBriefsIncoming(curData, body, clients) {
  const inc = {};
  for (const k of Object.keys(body || {})) {
    if (k === '_deleted' || k.charAt(0) === '_') continue;
    const stored = (curData || {})[k];
    if (stored !== undefined && !clientMatch(clients, stored && stored.client)) { inc[k] = stored; continue; }
    if (body[k] && clientMatch(clients, body[k].client)) inc[k] = body[k];
    else if (stored !== undefined) inc[k] = stored;
  }
  for (const k of Object.keys(curData || {})) {
    if (inc[k] === undefined && !clientMatch(clients, (curData[k] || {}).client)) inc[k] = curData[k];
  }
  return inc;
}

// intake emails / call actions for a scoped signin: their clients' rows only —
// unattributed rows (no detected client) stay with the full-house views
export function scopeRows(rows, clients) {
  if (!clients) return rows || [];
  return (rows || []).filter((r) => r && clientMatch(clients, r.client));
}

// PUT /api/access body -> stored directory. Whole-map replace, owner-only, small N.
export function sanitizeDir(body) {
  const src = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const out = {};
  for (const k of Object.keys(src).slice(0, 80)) {
    const email = String(k || '').trim().toLowerCase().slice(0, 120);
    if (email.indexOf('@') < 1) continue;
    const row = src[k] || {};
    const clients = (Array.isArray(row.clients) ? row.clients : [])
      .map((c) => String(c || '').trim().slice(0, 60)).filter(Boolean).slice(0, 20);
    out[email] = { name: String(row.name || '').slice(0, 48), clients };
  }
  return out;
}
