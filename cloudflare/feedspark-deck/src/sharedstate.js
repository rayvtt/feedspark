/*
 * SHARED WORKING STATE (Ray, 15 Sep 2026: "when Steven or any other user in the FCC uses the
 * keyword calendar or any button or briefing, the updates are not seen by everyone but only by
 * themselves because the data is saved locally … ensure this dashboard works simultaneously for
 * all users and that nothing is kept for a specific user only, except me").
 *
 * The Workflow board's project-plan overlays — a task's status, owner, due date, rename, the
 * rows someone added by hand, deleted, hid or set recurring, the email/call origin chips, the
 * learned sender→brand map and the SLA thresholds — all lived in localStorage. They are WORK,
 * not preferences: Steven marking a task done, or adding a row, changed nothing for anyone else
 * and vanished with his browser profile.
 *
 * Each namespace is its own kvmerge envelope under `state:<ns>`, so two people editing different
 * namespaces (or different keys in one) never contend, and deletion-by-absence is disambiguated
 * by the writer's X-Sync-Base read stamp exactly as /api/briefs does.
 *
 * What stays on the device is only what describes THIS screen: theme, nav collapse, panel
 * open/closed, chart size, a demo toggle, a personal filter. Those are listed in
 * docs/WAYS_OF_WORKING.md and are deliberately never in here.
 */

// how a namespace's entries map onto a client, so a scoped signin sees and writes only theirs.
//   'key'   — the key is "<client>|<task>"
//   'self'  — the key IS the client name
//   'field' — the value carries .client
//   null    — house-wide config, never client-filtered
export const STATE_NS = {
  taskstatus:  'key',    // client|task -> status word
  taskdue:     'key',    // client|task -> ISO date
  taskowner:   'key',    // client|task -> owner name
  taskrename:  'key',    // client|task -> new task title
  deleted:     'key',    // client|task -> 1
  hidden:      'key',    // client|task -> 1
  recur:       'key',    // client|task -> cadence
  esrc:        'key',    // client|task -> 1  (came from an email)
  csrc:        'key',    // client|task -> {call,when}
  manual:      'field',  // rowId -> {client,task,…} added by hand
  wfremoved:   'self',   // client -> 1 (dropped from the board)
  senderbrand: null,     // sender email -> brand (a learned mapping, house-wide)
  runsla:      null,     // stage -> days (the team's SLA, house-wide)
  pbtax:       null,     // Playbook category -> {name,kw,hide} — the AMs' shared taxonomy
};

export function isStateNs(ns) { return Object.prototype.hasOwnProperty.call(STATE_NS, ns); }

// the client an entry belongs to, or '' when the namespace is house-wide
export function clientOfEntry(ns, key, val) {
  const how = STATE_NS[ns];
  if (how === 'key') return String(key || '').split('|')[0];
  if (how === 'self') return String(key || '');
  if (how === 'field') return String((val && val.client) || '');
  return '';
}

// a scoped signin's view: house-wide namespaces whole, client-keyed ones filtered
export function scopeStateView(ns, data, clients, match) {
  if (!clients || !STATE_NS[ns]) return data || {};
  const out = {};
  for (const k of Object.keys(data || {})) {
    if (match(clients, clientOfEntry(ns, k, data[k]))) out[k] = data[k];
  }
  return out;
}

// their PUT is a whole-map save of a PARTIAL view against a delete-by-absence store, so
// re-inject every foreign entry before the merge or their save would wipe everyone else's.
export function scopeStateIncoming(ns, cur, incoming, clients, match) {
  if (!clients || !STATE_NS[ns]) return incoming || {};
  const out = {};
  for (const k of Object.keys(cur || {})) {
    if (!match(clients, clientOfEntry(ns, k, cur[k]))) out[k] = cur[k];       // not theirs — keep
  }
  for (const k of Object.keys(incoming || {})) {
    const c = clientOfEntry(ns, k, incoming[k]);
    if (match(clients, c)) out[k] = incoming[k];                              // theirs — accept
  }
  return out;
}
