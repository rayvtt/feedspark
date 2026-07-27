/*
 * Gmail → brief matcher: applies inbox replies to the Workflow's brief tickets with the
 * SAME semantics as the page's manual paste-router (routeUpdate), so an ASPL reply in
 * Gmail moves the ticket automatically:
 *   - find the ticket by [ibfcode:…] token, by brief id (XX-12345678-01), or (last resort)
 *     by task-wording similarity (Sørensen–Dice, stricter server-side than the page)
 *   - "done/delivered/completed…"  → done (or analysis when the task is a test)
 *   - "blocked/waiting on/stuck…"  → blocked (from briefed|progress)
 *   - "started/in progress/eta…"   → progress (from intake|briefed)
 *   - ibfdue:DDMMYYYY (or an "eta 12/8" mention) → updates the due date
 *   - every matched message is appended to the ticket's comms; stage moves append to hist
 * Forward-only (a later "started" never regresses a done ticket), idempotent (message ids
 * are remembered on the comms entries), and self-sent brief emails are skipped.
 * Pure module — no KV, no fetch — so it is unit-testable outside the worker.
 */

const DONE_RE = /\b(done|finished|complete|completed|delivered|live|actioned|signed[\s-]?off)\b/i;
const BLOCK_RE = /\b(blocked|blocker|waiting on|on hold|stuck|dependency)\b/i;
const PROG_RE = /\b(started|in progress|underway|working on|wip|eta|will complete|picking (this|it) up)\b/i;
const ID_RE = /\b([A-Z]{2,4}-\d{8}-\d{2})\b/;

function bigrams(s) {
  s = String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
export function taskDice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const m = {}; A.forEach((g) => { m[g] = (m[g] || 0) + 1; });
  let hit = 0; B.forEach((g) => { if (m[g] > 0) { m[g]--; hit++; } });
  return (2 * hit) / (A.length + B.length);
}

function isTest(b) { return /\btest/i.test((b && b.task) || ''); }
function validDD(dd8) {
  if (!/^\d{8}$/.test(dd8 || '')) return false;
  const d = +dd8.slice(0, 2), m = +dd8.slice(2, 4), y = +dd8.slice(4);
  return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2020 && y <= 2100;
}

function findBrief(briefs, text) {
  const arr = Object.keys(briefs).map((k) => briefs[k]);
  const cm = /ibfcode:([a-z0-9-]+)/i.exec(text);
  if (cm) {
    const c = cm[1].toLowerCase();
    const hits = arr.filter((b) => (b.code || '').toLowerCase() === c);
    if (hits.length) {
      if (hits.length > 1) hits.sort((x, y) => taskDice(text, y.task) - taskDice(text, x.task));
      return hits[0];
    }
  }
  const im = ID_RE.exec(text);
  if (im && briefs[im[1]]) return briefs[im[1]];
  let best = null, bs = 0;
  arr.forEach((b) => { if (b.status === 'confirmed') return; const s = taskDice(text, b.task); if (s > bs) { bs = s; best = b; } });
  return bs >= 0.55 ? best : null;   // page uses 0.45; snippets are shorter, so be stricter
}

// briefs: the plain briefs map (will be mutated); messages: [{id, from, subject, snippet, date(ms)}]
// opts: { selfRe?: RegExp (senders to skip, e.g. the account that SENDS the briefs), now?: ms, aspl?: [names] }
export function matchGmailToBriefs(briefs, messages, opts) {
  opts = opts || {};
  const now = opts.now || 0;
  const selfRe = opts.selfRe || null;
  const moved = [], loggedTo = [];
  let matched = 0, skipped = 0;

  for (const msg of messages || []) {
    const from = String(msg.from || '');
    if (selfRe && selfRe.test(from)) { skipped++; continue; }        // our own outgoing brief
    const text = (String(msg.subject || '') + ' ' + String(msg.snippet || '')).trim();
    if (!text) { skipped++; continue; }
    const b = findBrief(briefs, text);
    if (!b) { skipped++; continue; }
    b.comms = b.comms || [];
    if (msg.id && b.comms.some((c) => c.mid === msg.id)) { skipped++; continue; }   // already logged

    matched++;
    let sender = from.replace(/<[^>]*>/, '').trim() || from;
    (opts.aspl || []).forEach((n) => { if (new RegExp('\\b' + n + '\\b', 'i').test(text)) sender = n; });
    const done = DONE_RE.test(text), blocked = BLOCK_RE.test(text), prog = PROG_RE.test(text);
    b.comms.push({ from: sender.slice(0, 60), note: String(msg.snippet || msg.subject || '').slice(0, 600), done, when: msg.date || now, mid: msg.id || '' });

    let to = '';
    if (done && b.status !== 'confirmed' && b.status !== 'done' && b.status !== 'analysis') to = isTest(b) ? 'analysis' : 'done';
    else if (blocked && (b.status === 'briefed' || b.status === 'progress')) to = 'blocked';
    else if (prog && (b.status === 'intake' || b.status === 'briefed')) to = 'progress';
    if (to) {
      (b.hist = (b.hist && b.hist.length) ? b.hist : [{ s: b.status || 'intake', t: b.created || now }]).push({ s: to, t: now });
      b.status = to;
      moved.push({ id: b.id, stage: to });
    }
    let dd8 = '';
    const dm = /ibfdue:(\d{8})/.exec(text);
    if (dm) dd8 = dm[1];
    else {
      const em = /\beta\b[^\d]{0,8}(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/i.exec(text);
      if (em) {
        const y = em[3] ? ((('' + em[3]).length === 2) ? ('20' + em[3]) : ('' + em[3])) : ('' + new Date(now || Date.now()).getFullYear());
        dd8 = ('0' + em[1]).slice(-2) + ('0' + em[2]).slice(-2) + y;
      }
    }
    if (dd8 && validDD(dd8) && dd8 !== b.due) b.due = dd8;
    b.updated = now;
    if (loggedTo.indexOf(b.id) < 0) loggedTo.push(b.id);
  }
  return { matched, skipped, moved, loggedTo };
}
