/**
 * FeedSpark FCC — Gmail → briefs status sync (the NO-ADMIN path).
 *
 * Runs INSIDE your own Google account (script.google.com) — you authorise it yourself,
 * so no Workspace super-admin, no domain-wide delegation, no OAuth app verification,
 * and the grant never expires. Every 15 minutes it finds recent brief-thread messages
 * ([FS Brief] subjects / ibfcode tokens) and POSTs them to the FCC worker, which matches
 * them to Workflow tickets and moves stages (done/blocked/progress/due) automatically.
 *
 * SETUP (one-time, ~4 minutes) — full detail in docs/GOOGLE_SETUP.md §8:
 *  1. Create the shared secret and give it to the worker (repo root):
 *       openssl rand -hex 24            # copy the value
 *       wrangler secret put GMAIL_PUSH_KEY
 *  2. Cloudflare Zero Trust → Access → Applications → Add (Self-hosted):
 *       domain: feedspark.ray-vtt.workers.dev   path: api/gmail/push
 *       policy: Action = Bypass · Include = Everyone
 *     (Apps Script can't log in through Access; the shared secret is the gate instead.)
 *  3. Go to https://script.google.com → New project → paste THIS file →
 *     set KEY below to the secret from step 1 → Run ▶ pushBriefReplies once →
 *     approve the Gmail permission prompt (it's your own account).
 *  4. Left sidebar ⏰ Triggers → Add trigger:
 *       function pushBriefReplies · time-driven · minutes timer · every 5 minutes
 *       (5 min is Apps Script's floor and uses ~3% of the daily trigger quota — pick
 *       15/30 min if you prefer; Run ▶ in the editor fires an instant sync any time).
 *  Done. Replies now move tickets in /workflow; every sync shows in /activity as
 *  "gmail-sync".
 *
 *  Filing/archiving is SAFE: GmailApp.search covers All Mail, so archived or
 *  labelled-away threads are still picked up. Only Trash/Spam are excluded — if a
 *  reply was deleted before a sync saw it, use the Workflow's paste-router as the
 *  catch-all. The 7-day window + message-id dedupe (server-side) mean the trigger
 *  can be down for days and replies are still applied exactly once when it returns.
 */

var ENDPOINT = 'https://feedspark.ray-vtt.workers.dev/api/gmail/push';
var KEY = 'PASTE_THE_GMAIL_PUSH_KEY_VALUE_HERE';
var QUERY = 'newer_than:7d ("ibfcode:" OR subject:"[FS Brief]")';
var MAX_THREADS = 50, MAX_MESSAGES = 150, MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Run ALL feeds (point the 5-min trigger at THIS): brief-reply sync + inbox intake
// + Label Guard alert-email drain.
function syncFCC() { pushBriefReplies(); pushInbox(); drainAlertOutbox(); }

// ---- Label Guard email alerts: the worker can't send mail, so it queues alert emails
// in KV (labeloutbox) and THIS drains the queue through your own mailbox. Poll → send
// via GmailApp → ack exactly what was sent (so a failed send is retried next cycle).
// Zero extra setup: same endpoint, same key, same Access bypass as the pushes above.
function drainAlertOutbox() {
  var res = UrlFetchApp.fetch(ENDPOINT, { method: 'post', contentType: 'application/json',
    headers: { 'X-FCC-Push-Key': KEY }, payload: JSON.stringify({ outboxPoll: 1 }), muteHttpExceptions: true });
  var p = null; try { p = JSON.parse(res.getContentText()); } catch (e) {}
  if (!p || !p.ok) { if (res.getResponseCode() !== 200) console.error('✗ FCC outbox poll failed: HTTP ' + res.getResponseCode()); return; }
  var queue = p.outbox || [];
  if (!queue.length) return;
  var sent = [];
  queue.forEach(function (m) {
    try {
      // sig: the queueing module signs its own mail (task reminders, reports); Label Guard
      // alerts predate the field and keep the classic footer
      GmailApp.sendEmail(m.to, m.subject, m.body + '\n\n' + (m.sig || '— FeedSpark Label Guard (automated alert)'));
      sent.push(m.id);
    } catch (e) { console.error('✗ alert email to ' + m.to + ' failed: ' + e); }
  });
  if (!sent.length) return;
  UrlFetchApp.fetch(ENDPOINT, { method: 'post', contentType: 'application/json',
    headers: { 'X-FCC-Push-Key': KEY }, payload: JSON.stringify({ outboxAck: sent }), muteHttpExceptions: true });
  console.log('✓ Label Guard alert emails sent: ' + sent.length);
}

// ---- inbox intake: recent incoming mail → the Workflow's "Incoming emails" stream.
// The worker classifies each message (which client, briefable/action-request vs FYI),
// so send everything recent and let the server triage.
function pushInbox() {
  // Ray's rule: everything sent to ray@feedspark.com from OUTSIDE the team
  // (not @feedspark.com / @aroxo.com / @feedhero.net). No in:inbox restriction —
  // archived/filed mail is still captured; the worker filters noise + classifies.
  var threads = GmailApp.search('newer_than:2d to:ray@feedspark.com -from:feedspark.com -from:aroxo.com -from:feedhero.net', 0, 40);
  // Gemini/Meet call-notes emails are FROM google.com noreply addresses and can reach you
  // via a calendar alias rather than to:ray@ — a second targeted search catches them. The
  // worker parses their action items into Workflow Intake rows (📞 Call source), which
  // needs the FULL notes body, so these push a much longer snippet than ordinary mail.
  var notes = GmailApp.search('newer_than:2d from:google.com (subject:"notes by gemini" OR subject:"meeting notes" OR subject:"meeting summary" OR subject:transcript)', 0, 10);
  var out = [], seen = {};
  var collect = function (t) {
    t.getMessages().forEach(function (m) {
      if (out.length >= 90) return;
      var id = m.getId(); if (seen[id]) return; seen[id] = 1;
      var when = m.getDate().getTime();
      if (Date.now() - when > 2 * 24 * 60 * 60 * 1000) return;
      var subj = m.getSubject() || '', from = m.getFrom() || '';
      var isNotes = /notes by gemini|meeting (notes|summary|recap)|transcript/i.test(subj) || /(gemini|meet)[a-z.\-]*noreply@google\.com/i.test(from);
      out.push({ id: id, from: from, to: m.getTo(), cc: m.getCc(), subject: subj,
        snippet: (m.getPlainBody() || '').slice(0, isNotes ? 9000 : 500), date: when });
    });
  };
  threads.forEach(collect); notes.forEach(collect);
  if (!out.length) { console.log('FCC inbox: nothing new'); return; }
  var res = UrlFetchApp.fetch(ENDPOINT, { method: 'post', contentType: 'application/json',
    headers: { 'X-FCC-Push-Key': KEY }, payload: JSON.stringify({ inbox: out }), muteHttpExceptions: true });
  var body = res.getContentText(); var p = null; try { p = JSON.parse(body); } catch (e) {}
  if (p && p.ok) console.log('✓ FCC inbox OK — sent ' + out.length + ' · new ' + p.added + ' · briefable ' + p.briefable);
  else console.error('✗ FCC inbox push failed: HTTP ' + res.getResponseCode() + ' ' + body.slice(0, 200));
}

function pushBriefReplies() {
  var threads = GmailApp.search(QUERY, 0, MAX_THREADS);
  var out = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (out.length >= MAX_MESSAGES) return;
      var when = m.getDate().getTime();
      if (Date.now() - when > MAX_AGE_MS) return;
      out.push({
        id: m.getId(),
        from: m.getFrom(),
        subject: m.getSubject(),
        snippet: (m.getPlainBody() || '').slice(0, 1200),
        date: when
      });
    });
  });
  if (!out.length) { console.log('FCC push: nothing to send (no brief-thread messages in the window)'); return; }
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-FCC-Push-Key': KEY },
    payload: JSON.stringify({ messages: out }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode(), body = res.getContentText();
  var parsed = null; try { parsed = JSON.parse(body); } catch (e) {}
  if (parsed && parsed.ok) {
    console.log('✓ FCC push OK — sent ' + out.length + ' · matched ' + parsed.matched + ' · moved ' + ((parsed.moved || []).length) + ' ' + JSON.stringify(parsed.moved || []));
  } else if (body.indexOf('Cloudflare Access') >= 0 || body.charAt(0) === '<') {
    // a 200 here is the ACCESS LOGIN PAGE, not the worker — the push never arrived
    console.error('✗ BLOCKED BY CLOUDFLARE ACCESS (HTTP ' + code + ' is the login page, NOT success). Fix the bypass: Zero Trust → Access → Applications → self-hosted app · domain feedspark.ray-vtt.workers.dev · path api/gmail/push (own path field, no leading slash) · policy Action=Bypass, Include=Everyone. See docs/GOOGLE_SETUP.md §8.');
  } else {
    console.error('✗ FCC push failed: HTTP ' + code + ' ' + body.slice(0, 300) + (code === 401 ? '  → KEY here does not match the GMAIL_PUSH_KEY secret' : code === 503 ? '  → GMAIL_PUSH_KEY secret not set on the worker yet' : ''));
  }
}
