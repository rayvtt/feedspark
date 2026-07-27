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
  if (!out.length) return;
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-FCC-Push-Key': KEY },
    payload: JSON.stringify({ messages: out }),
    muteHttpExceptions: true
  });
  console.log('FCC push: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
}
