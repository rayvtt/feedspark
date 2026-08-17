/*
 * Gmail → brief matcher: applies inbox replies to the Workflow's brief tickets with the
 * SAME semantics as the page's manual paste-router (routeUpdate), so an ASPL reply in
 * Gmail moves the ticket automatically:
 *   - find the ticket by [ibfcode:…] token, by brief id (XX-12345678-01), or (last resort)
 *     by task-wording similarity (Sørensen–Dice, stricter server-side than the page)
 *   - "done/delivered/completed…"  → done (or analysis when the task is a test)
 *   - "is now live / please live it" on a TEST brief → run starts: due → +run-SLA
 *     (keyword 14d / title test 21d / other tests 14d) and stage → analysis; once live,
 *     stale ibfdue tokens quoted in later replies can no longer move the due
 *   - Ray's own reply saying "please live it" counts too (the only self-mail not skipped)
 *   - a read-out reply on a live/analysis test ("Result: …", a signed %-figure, "no lift")
 *     files as a Result: comm — the page folds it into the Test register and it unlocks the
 *     client confirmation; first result only, and never from the go-live message itself
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
// go-live signal for TEST briefs — mirrors the page's LIVE_RE. Going live starts the run:
// due re-dates to +run-SLA (the analysis date) and the ticket moves to analysis.
const LIVE_RE = /\b(is (now )?live|now live|gone live|went live|going live|set (it )?live|pushed (it )?live|please live it|live it please|test (is )?(now )?running)\b/i;
// a read-out reply on a live/analysis test ticket. Never guessed: an explicit "result: …",
// a signed %-figure (optionally near a metric word), or an explicit no-lift call.
const RESULT_RE = /\bresults?\s*[:\-–]\s*([^\n]{3,140})/i;
const UPLIFT_RE = /([+-]\s?\d+(?:\.\d+)?\s?%[^.;\n]{0,60})/;
const NOLIFT_RE = /\b(no (?:up)?lift|flat result|no significant (?:change|difference|impact))\b[^.;\n]{0,60}/i;
// result-context cue: a FORMAL read-out ("Please find below the results…") files even on a
// ticket that never got its go-live (historic briefs sat in briefed/progress); projection talk
// without the cue never counts on a not-yet-live ticket.
const RESULT_CTX_RE = /\b(results?|read-?out|came out|we saw)\b/i;
// the ASPL result-email house style writes UNSIGNED prose figures — "a 9.55% uplift in
// impressions and a 2.76% uplift in clicks" — so collect every %-plus-direction-word mention
// (both "9.55% uplift in X" and "uplift of 9.55% in X") and compose one compact read-out.
// A bare % with no direction word ("50% tested") never counts.
const UPLIFT_ALL_RE = /(\d+(?:\.\d+)?)\s*%\s*(?:up-?lift|lift|increase|improvement|growth|gain|drop|decrease|decline)(?:\s+in\s+([a-z]{2,20}(?:\s+rate)?))?/gi;
const UPLIFT_OF_RE = /(?:up-?lift|lift|increase|improvement|gain|drop|decrease|decline)\s+of\s+(\d+(?:\.\d+)?)\s*%(?:\s+in\s+([a-z]{2,20}(?:\s+rate)?))?/gi;
function extractResult(text) {
  text = String(text || '');
  let m = RESULT_RE.exec(text); if (m) return m[1].trim();
  const parts = [];
  for (const re of [UPLIFT_ALL_RE, UPLIFT_OF_RE]) {
    re.lastIndex = 0; let u;
    while ((u = re.exec(text)) && parts.length < 4) {
      const sign = /(drop|decrease|decline)/i.test(u[0]) ? '-' : '+';
      parts.push(sign + u[1] + '%' + (u[2] ? (' ' + u[2].trim()) : ''));
    }
  }
  if (parts.length) return parts.join(' · ');
  m = UPLIFT_RE.exec(text); if (m) return m[1].replace(/\s+/g, ' ').trim();
  m = NOLIFT_RE.exec(text); if (m) return m[0].trim();
  return '';
}
// run SLAs (days) by brief kind — the worker uses the page's defaults (the page panel's
// per-device overrides live in localStorage and can't reach here)
const RUNSLA_DEF = { keyword: 14, title_test: 21, test: 14 };
function analysisKind(b) {
  const t = (b && b.task) || '';
  if (/\btitle/i.test(t) && /\btest/i.test(t)) return 'title_test';
  if (/\bkeyword/i.test(t)) return 'keyword';
  if (/\btest/i.test(t)) return 'test';
  return '';
}
function dd8Of(ms) {
  const d = new Date(ms);
  return ('0' + d.getDate()).slice(-2) + ('0' + (d.getMonth() + 1)).slice(-2) + d.getFullYear();
}

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

// Automated matching is TOKEN-ONLY: [ibfcode:…] or a brief id, subject taking priority over
// the body. No wording-similarity fallback here — unattended fuzzy matching mis-filed real
// replies (the page's paste-router keeps its fuzzy match because a human confirms it there).
// A body carrying several different codes with none in the subject (digests, forwards) is
// ambiguous and is skipped rather than guessed.
function codeIn(s) { const m = /ibfcode:([a-z0-9-]+)/i.exec(s || ''); return m ? m[1].toLowerCase() : ''; }
function refsIn(s) { return Array.from(new Set((String(s || '').match(/ibfref:([a-z0-9-]+)/gi) || []).map((x) => x.slice(7)))); }
function findBrief(briefs, subject, snippet) {
  // ibfref = the ticket's UNIQUE ref, stamped into every brief's subject + body — always wins,
  // and it is DECISIVE: a message stamped with a ref that resolves to no tracked ticket belongs
  // to a brief FCC never saved (Gmail-drafted, never ＋Saved) — it must be SKIPPED, never
  // fuzzy-filed onto a sibling ticket via the shared ibfcode (the Superdry Dress mis-track).
  const resolveRef = (r) => briefs[r] || briefs[r.toUpperCase()] || null;
  const sRefs = refsIn(subject);
  if (sRefs.length) return sRefs.length === 1 ? resolveRef(sRefs[0]) : null;
  const bRefs = refsIn(snippet);
  if (bRefs.length) return bRefs.length === 1 ? resolveRef(bRefs[0]) : null;   // several refs = digest/forward — ambiguous
  const arr = Object.keys(briefs).map((k) => briefs[k]);
  const byCode = (c) => {
    const hits = arr.filter((b) => (b.code || '').toLowerCase() === c);
    if (!hits.length) return null;
    if (hits.length > 1) {
      hits.sort((x, y) => taskDice(subject + ' ' + snippet, y.task) - taskDice(subject + ' ' + snippet, x.task));
      // similarity floor: with several tickets sharing the code, an unrelated forward
      // ("Fwd: Back To School…" carrying only ibfcode) must not attach to the closest-sounding one
      if (taskDice(subject + ' ' + snippet, hits[0].task) < 0.35) return null;
    }
    return hits[0];
  };
  const subjCode = codeIn(subject);
  if (subjCode) { const b = byCode(subjCode); if (b) return b; }
  const subjId = ID_RE.exec(subject || '');
  if (subjId && briefs[subjId[1]]) return briefs[subjId[1]];
  const bodyCodes = Array.from(new Set((String(snippet || '').match(/ibfcode:([a-z0-9-]+)/gi) || []).map((s) => s.slice(8).toLowerCase())));
  if (bodyCodes.length === 1) { const b = byCode(bodyCodes[0]); if (b) return b; }
  if (bodyCodes.length > 1) return null;   // ambiguous — never guess unattended
  const bodyId = ID_RE.exec(snippet || '');
  if (bodyId && briefs[bodyId[1]]) return briefs[bodyId[1]];
  return null;
}

// Conversations share a subject once the reply prefixes are stripped — the SAME normalisation
// the Workflow page uses to group its triage queue into threads. Server-side it lets a triage
// decision made on a conversation be inherited by replies that arrive later.
export function mailThreadKey(subject) {
  return String(subject || '').toLowerCase()
    .replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim();
}

// ---- inbound triage: which client is an email about, and is it BRIEFABLE (an action
// request that should become a Workflow ticket) vs FYI noise? Pure heuristics, unit-tested.
const ACTION_RES = [
  [/\b(can|could|would|will) you\b/i, 'asks you directly'],
  [/\bplease\b/i, '"please"'],
  [/\b(need|needs|needed|required|require|request(ing|ed)?)\b/i, 'need/request'],
  [/\b(add|remove|update|fix|change|amend|swap|upload|implement|activate|pause|switch|set ?up|turn (on|off)|exclude|include)\b/i, 'action verb'],
  [/\b(by (mon|tues|wednes|thurs|fri|satur|sun)day|by eod|eod\b|eow\b|asap\b|urgent(ly)?|deadline|today|tomorrow)\b/i, 'deadline pressure'],
  [/\?/, 'question'],
];
const FEED_RE = /\b(feed|title|titles|description|image|label|labels|gtin|attribute|product type|campaign|shopping|merchant|gmc|dpa|meta|supplemental|disapprov|keyword)\b/i;
const NOISE_RE = /\b(no-?reply|noreply|newsletter|unsubscribe|notification|billing|invoice paid|receipt|out of office|automatic reply)\b/i;
// the team's own domains — mail FROM these is internal, never client intake (Ray's rule:
// capture what lands at ray@feedspark.com from OUTSIDE feedspark/aroxo/feedhero)
const INTERNAL_RE = /@([a-z0-9.-]*\.)?(feedspark\.com|aroxo\.com|feedhero\.net)\b/i;

// ---- client auto-detect: use every cue the email carries, most reliable first ----------
//   1. dossier domain map (authoritative — covers brands whose company domain differs from
//      the brand, e.g. YuMOVE mail arriving from @lintbells.com)
//   2. the sender domain's own label vs the client roster (jane@reiss.com → Reiss, no
//      dossier entry needed; freemail domains are skipped)
//   3. the sender display name ("Jane from Reiss <jane@gmail.com>")
//   4. a brand mention in subject/snippet (word-boundary, plus accent/space-folded)
// Names are folded for comparison ("Estée Lauder" ↔ esteelauder.com); names shorter than
// 4 chars (ELC) only ever match as exact words — never by containment.
const FREEMAIL_RE = /^(gmail|googlemail|outlook|hotmail|live|yahoo|ymail|icloud|me|aol|protonmail|proton|msn|mail)$/;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
function domainLabel(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (!parts.length) return '';
  let cut = 1;   // drop the TLD; also drop a functional 2nd level before a short ccTLD (schuh.co.uk → schuh)
  if (parts.length >= 3 && parts[parts.length - 1].length <= 3 && /^(co|com|org|net|ac|gov|ltd|plc|edu)$/.test(parts[parts.length - 2])) cut = 2;
  return fold(parts.slice(0, parts.length - cut).pop() || '');
}
export function detectClientEx(msg, clientDoms, clientNames) {
  const from = String(msg.from || '');
  const emDom = ((/@([a-z0-9.-]+)/i.exec(from) || [])[1] || '').toLowerCase();
  const names = clientNames || Object.keys(clientDoms || {});
  const nameByFold = (tok) => { if (!tok || tok.length < 3) return '';
    for (const name of names) { const nm = fold(name); if (nm.length >= 4 && (tok.includes(nm) || (tok.length >= 4 && nm.includes(tok)))) return name; } return ''; };
  // 1. dossier domain on the SENDER (authoritative)
  for (const name of Object.keys(clientDoms || {})) {
    const d = String(clientDoms[name] || '').toLowerCase().replace(/^www\./, '');
    if (d && emDom.endsWith(d)) return { client: name, via: 'sender domain' };
  }
  // 2. Facebook/Meta alias in the recipients — mail to Facebook always carries the brand
  //    in the alias local part (case++reissuk@facebook.com, monsoon@pages.fb.com)
  const rcpts = (String(msg.to || '') + ',' + String(msg.cc || '')).toLowerCase();
  for (const m of rcpts.matchAll(/([a-z0-9._+\-]+)@([a-z0-9.-]*(?:facebook|fb|meta)\.com)\b/g)) {
    for (const piece of m[1].split(/[+._\-]+/)) { const hit = nameByFold(fold(piece)); if (hit) return { client: hit, via: 'facebook alias' }; }
    const hitWhole = nameByFold(fold(m[1])); if (hitWhole) return { client: hitWhole, via: 'facebook alias' };
  }
  // 3. a recipient on a client's own domain (dossier map first, then the domain label)
  for (const m of rcpts.matchAll(/@([a-z0-9.-]+)/g)) {
    const dom = m[1].replace(/[>,;\s].*$/, '');
    for (const name of Object.keys(clientDoms || {})) {
      const d = String(clientDoms[name] || '').toLowerCase().replace(/^www\./, '');
      if (d && dom.endsWith(d)) return { client: name, via: 'recipient domain' };
    }
    const rl = domainLabel(dom);
    if (rl && !FREEMAIL_RE.test(rl)) { const hit = nameByFold(rl); if (hit) return { client: hit, via: 'recipient domain' }; }
  }
  // 4. the sender domain's own label (jane@reiss.com — no dossier entry needed)
  const label = domainLabel(emDom);
  if (label && !FREEMAIL_RE.test(label)) { const hit = nameByFold(label); if (hit) return { client: hit, via: 'sender domain' }; }
  // 5. the sender display name ("Jane from Reiss <jane@gmail.com>")
  const disp = fold(from.split('<')[0]);
  if (disp) for (const name of names) { const nm = fold(name); if (nm.length >= 4 && disp.includes(nm)) return { client: name, via: 'sender name' }; }
  // 6. a brand mention in subject/snippet
  const text = String(msg.subject || '') + ' ' + String(msg.snippet || ''), ftext = fold(text);
  for (const name of names) {
    if (new RegExp('\\b' + name.replace(/[.^$*+?()[\]{}|\\]/g, '\\$&') + '\\b', 'i').test(text)) return { client: name, via: 'brand mention' };
    const nm = fold(name);
    if (nm.length >= 4 && ftext.includes(nm)) return { client: name, via: 'brand mention' };
  }
  return { client: '', via: '' };
}
export function detectClient(msg, clientDoms, clientNames) { return detectClientEx(msg, clientDoms, clientNames).client; }

// msg: {from, subject, snippet}; clientDoms: {Brand: "domain.com"}; clientNames: [Brand,...]
export function classifyInbound(msg, clientDoms, opts) {
  opts = opts || {};
  const from = String(msg.from || ''), text = (String(msg.subject || '') + ' ' + String(msg.snippet || ''));
  const ex = detectClientEx(msg, clientDoms, opts.clientNames || Object.keys(clientDoms || {}));
  const client = ex.client;
  // platform notifications addressed to a brand's Facebook/Meta alias are client work
  // (Commerce Manager feed rejections, case updates) — only THAT cue overrides the noise gate
  const noisy = (opts.selfRe && opts.selfRe.test(from)) || INTERNAL_RE.test(from) || NOISE_RE.test(from + ' ' + String(msg.subject || ''));
  if (noisy && !(client && ex.via === 'facebook alias')) {
    return { client: '', briefable: false, score: 0, hints: ['noise/self'] };
  }
  const hints = [];
  let score = 0;
  for (const [re, label] of ACTION_RES) { if (re.test(text)) { score++; hints.push(label); } }
  const feedy = FEED_RE.test(text);
  if (feedy) { score++; hints.push('feed-related'); }
  // briefable = a real ask: at least two action signals, or one + feed vocabulary + a known client
  const briefable = score >= 3 || (score >= 2 && (feedy || !!client));
  return { client, via: ex.via, briefable, score, hints: hints.slice(0, 5) };
}

// briefs: the plain briefs map (will be mutated); messages: [{id, from, subject, snippet, date(ms)}]
// opts: { selfRe?: RegExp (senders to skip, e.g. the account that SENDS the briefs), now?: ms, aspl?: [names] }
export function matchGmailToBriefs(briefs, messages, opts) {
  opts = opts || {};
  const now = opts.now || 0;
  const selfRe = opts.selfRe || null;
  const moved = [], loggedTo = [], repaired = [], results = [];
  let matched = 0, skipped = 0;

  for (const msg of messages || []) {
    const from = String(msg.from || '');
    const text = (String(msg.subject || '') + ' ' + String(msg.snippet || '')).trim();
    // our own outgoing mail is skipped — EXCEPT a reply where Ray himself gives the go-live
    // ("please live it"): that instruction is authoritative for starting a test's run
    if (selfRe && selfRe.test(from)) {
      const selfGoLive = /^\s*re:/i.test(String(msg.subject || '')) && LIVE_RE.test(text);
      if (!selfGoLive) { skipped++; continue; }
    }
    if (!text) { skipped++; continue; }
    const b = findBrief(briefs, msg.subject, msg.snippet);
    if (!b) {
      // repair (rolling re-push): a message the strict matcher now rejects — unknown/ambiguous
      // ibfref, or under the similarity floor — never belonged on any ticket; strip any comm a
      // laxer era filed for it (mid-tagged comms only ever come from this matcher).
      if (opts.repair && msg.id) {
        for (const k of Object.keys(briefs)) { const ob = briefs[k]; if (!ob || !ob.comms || !ob.comms.length) continue;
          const before = ob.comms.length;
          ob.comms = ob.comms.filter((c) => c.mid !== msg.id);
          if (ob.comms.length !== before) { ob.updated = now; repaired.push({ from: ob.id, to: '', mid: msg.id }); }
        }
      }
      skipped++; continue;
    }
    b.comms = b.comms || [];
    // repair (rescan): an ibfref match is authoritative — pull this message's comm off any
    // OTHER ticket it was fuzzy-filed onto in the ibfcode era, before the skip check runs.
    if (opts.repair && msg.id) {
      const rm = /ibfref:([a-z0-9-]+)/i.exec(String(msg.subject || '') + ' ' + String(msg.snippet || ''));
      if (rm && ((briefs[rm[1]] || briefs[rm[1].toUpperCase()]) === b)) {
        for (const k of Object.keys(briefs)) { const ob = briefs[k]; if (ob === b || !ob || !ob.comms || !ob.comms.length) continue;
          const before = ob.comms.length;
          ob.comms = ob.comms.filter((c) => c.mid !== msg.id);
          if (ob.comms.length !== before) { ob.updated = now; repaired.push({ from: ob.id, to: b.id, mid: msg.id }); }
        }
      }
    }
    if (msg.id && b.comms.some((c) => c.mid === msg.id)) {   // already logged…
      // …but stored comms are cut at 600 chars and the formal read-out template puts its
      // figures just past that, so a rolling re-push (full 1200-char snippet) is the second
      // chance: if the ticket still lacks a Result:, scan the fresh text and UPGRADE the comm.
      if (analysisKind(b) && !(b.comms || []).some((c) => /^Result:/.test(c.note || ''))
          && !(LIVE_RE.test(text) && !b.liveAt)
          && (b.liveAt || b.status === 'analysis' || b.status === 'done' || RESULT_CTX_RE.test(String(msg.snippet || '')))) {
        const rvU = extractResult(String(msg.snippet || ''));
        if (rvU) {
          const c0 = b.comms.find((c) => c.mid === msg.id);
          c0.note = 'Result: ' + rvU.slice(0, 140); c0.done = true;
          results.push({ id: b.id, result: rvU.slice(0, 140) });
          if (b.status === 'briefed' || b.status === 'progress' || b.status === 'done') {
            (b.hist = (b.hist && b.hist.length) ? b.hist : [{ s: b.status, t: b.created || now }]).push({ s: 'analysis', t: now });
            b.status = 'analysis';
            moved.push({ id: b.id, stage: 'analysis' });
          }
          b.updated = now;
          if (loggedTo.indexOf(b.id) < 0) loggedTo.push(b.id);
        }
      }
      skipped++; continue;
    }

    matched++;
    let sender = from.replace(/<[^>]*>/, '').trim() || from;
    (opts.aspl || []).forEach((n) => { if (new RegExp('\\b' + n + '\\b', 'i').test(text)) sender = n; });
    const done = DONE_RE.test(text), blocked = BLOCK_RE.test(text), prog = PROG_RE.test(text);
    const golive = LIVE_RE.test(text) && !!analysisKind(b);
    // an ASPL read-out reply on a live/analysis test ticket files as a Result: comm — the page
    // then treats it exactly like a manually logged result (register back-fill, confirmation
    // unlock, chase-analysis escalation cleared). First result only; never on the go-live msg.
    let rv = '';
    if (!golive && analysisKind(b)
        && (b.liveAt || b.status === 'analysis' || b.status === 'done' || RESULT_CTX_RE.test(String(msg.snippet || '')))
        && !(b.comms || []).some((c) => /^Result:/.test(c.note || ''))) {
      rv = extractResult(String(msg.snippet || ''));
    }
    b.comms.push({ from: sender.slice(0, 60), note: rv ? ('Result: ' + rv.slice(0, 140)) : String(msg.snippet || msg.subject || '').slice(0, 600), done: done || !!rv, when: msg.date || now, mid: msg.id || '' });

    let to = '';
    if (golive && b.status !== 'confirmed' && !b.liveAt) {
      // the test just went live: record it, start the run clock, re-date the due to the
      // analysis date (+run-SLA) and move the ticket to analysis
      b.liveAt = msg.date || now;
      b.due = dd8Of(b.liveAt + (RUNSLA_DEF[analysisKind(b)] || 14) * 86400000);
      if (b.status !== 'analysis') to = 'analysis';
    }
    else if (done && b.status !== 'confirmed' && b.status !== 'done' && b.status !== 'analysis') to = isTest(b) ? 'analysis' : 'done';
    else if (blocked && (b.status === 'briefed' || b.status === 'progress')) to = 'blocked';
    else if (prog && (b.status === 'intake' || b.status === 'briefed')) to = 'progress';
    if (to) {
      (b.hist = (b.hist && b.hist.length) ? b.hist : [{ s: b.status || 'intake', t: b.created || now }]).push({ s: to, t: now });
      b.status = to;
      moved.push({ id: b.id, stage: to });
    }
    if (rv) {
      results.push({ id: b.id, result: rv.slice(0, 140) });
      // a result pulls an in-flight test into its Analysis step (page parity); confirmed stays closed
      if (b.status === 'briefed' || b.status === 'progress' || b.status === 'done') {
        (b.hist = (b.hist && b.hist.length) ? b.hist : [{ s: b.status, t: b.created || now }]).push({ s: 'analysis', t: now });
        b.status = 'analysis';
        moved.push({ id: b.id, stage: 'analysis' });
      }
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
    // once live, the analysis date owns the due — replies quote the original brief, whose
    // subject still carries the OLD ibfdue token, and that must never claw the date back
    if (!b.liveAt && dd8 && validDD(dd8) && dd8 !== b.due) b.due = dd8;
    b.updated = now;
    if (loggedTo.indexOf(b.id) < 0) loggedTo.push(b.id);
  }
  return { matched, skipped, moved, loggedTo, repaired, results };
}
