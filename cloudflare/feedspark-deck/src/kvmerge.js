/*
 * Per-key merge for the FCC's whole-map KV stores (/api/clients, /api/briefs).
 *
 * Why: those endpoints used to PUT the entire map — last writer wins, so two open
 * tabs (or two people) silently clobbered each other's dossier edits and briefs.
 * This merges instead: each key carries a server-side timestamp, deletions become
 * tombstones, and "key absent from the incoming map" is disambiguated with the
 * writer's read-time (X-Sync-Base): absent + stored-newer-than-base = the writer
 * never saw it → KEEP; absent + stored-older = the writer deleted it → tombstone.
 *
 * Envelope stored in KV (never returned to clients):
 *   { __v: 2, data: { key: value }, meta: { key: { t: ms, del?: 1 } } }
 * Legacy plain maps (v1) are lifted on first touch; a v1 `_deleted` array becomes
 * tombstones. Clients keep reading/writing PLAIN maps — the envelope is internal.
 *
 * Known residual race: two PUTs inside the same few ms can still interleave
 * (KV has no transactions); the minutes-long stale-tab window this fixes is the
 * real-world failure mode. See docs/WAYS_OF_WORKING.md → Overlap safeguards.
 */

// lift a legacy plain map (v1) into the v2 envelope; idempotent for v2 input
export function liftEnvelope(stored, now) {
  if (stored && stored.__v === 2) {
    return { __v: 2, data: stored.data || {}, meta: stored.meta || {} };
  }
  const env = { __v: 2, data: {}, meta: {} };
  const src = stored || {};
  for (const k of Object.keys(src)) {
    if (k === '_deleted' || k.charAt(0) === '_') continue;
    env.data[k] = src[k];
    env.meta[k] = { t: 0 };                       // t:0 = "older than any client read"
  }
  for (const name of (src._deleted || [])) {
    if (!env.meta[name]) env.meta[name] = { t: 0 };
    env.meta[name].del = 1;
    delete env.data[name];
  }
  return env;
}

// merge an incoming plain map into the envelope.
//   base: the X-Sync-Base ms the writer got on GET (0/absent = conservative: no
//         absence-based deletions — unions only).
//   opts.explicitTombstones: the store signals deletions via a `_deleted` array
//         (the dossier store), so absence NEVER deletes — only the array does.
export function mergeIntoEnvelope(env, incoming, base, now, opts) {
  opts = opts || {};
  const inc = incoming || {};
  const incDeleted = Array.isArray(inc._deleted) ? inc._deleted : [];

  // 1. upserts: any key present in the incoming map
  for (const k of Object.keys(inc)) {
    if (k === '_deleted' || k.charAt(0) === '_') continue;   // reserved/meta keys
    const cur = env.data[k];
    const changed = JSON.stringify(cur) !== JSON.stringify(inc[k]);
    const wasDel = env.meta[k] && env.meta[k].del;
    // a tombstone NEWER than the writer's read wins over their stale copy of the key
    // (they never saw the deletion); a writer whose read post-dates the deletion is
    // deliberately re-adding (e.g. dossier un-delete) and wins over the tombstone.
    if (wasDel && ((env.meta[k].t || 0) > base)) continue;
    if (changed || wasDel) {
      env.data[k] = inc[k];
      env.meta[k] = { t: now };                    // re-adding clears any tombstone
    }
  }

  // 2. deletions
  if (opts.explicitTombstones) {
    // dossier store: `_deleted` array is the only delete signal
    for (const name of incDeleted) {
      if (inc[name] !== undefined) continue;       // present in data wins over its own tombstone
      env.meta[name] = { t: now, del: 1 };
      delete env.data[name];
    }
  } else if (base > 0) {
    // briefs store: deletion = absence, but only for keys the writer had actually seen
    for (const k of Object.keys(env.data)) {
      if (inc[k] !== undefined) continue;
      const t = (env.meta[k] && env.meta[k].t) || 0;
      if (t <= base) { env.meta[k] = { t: now, del: 1 }; delete env.data[k]; }
      // t > base → written after this client's read → they never saw it → keep
    }
  }
  return env;
}

// the plain map clients consume (GET response / PUT echo)
export function envelopeToClient(env, opts) {
  opts = opts || {};
  const out = {};
  for (const k of Object.keys(env.data)) out[k] = env.data[k];
  if (opts.explicitTombstones) {
    const dead = Object.keys(env.meta).filter((k) => env.meta[k].del);
    if (dead.length) out._deleted = dead;
  }
  return out;
}
