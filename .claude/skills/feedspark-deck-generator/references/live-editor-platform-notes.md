# Live-editor platform notes

Hard-won lessons from a single incident-heavy day on the Reiss deck (28 Jul 2026) that
apply to **every** live deck's edit layer, not just Reiss. `SKILL.md` Step 7 points here —
read this before touching a live deck's structure, its KV edit overlay, or
`cloudflare/feedspark-deck/src/worker.js`'s editor/edits code.

The single root cause behind most of this day's damage: **`data-eid` (and every other
persistence id — `data-rid`, `data-tid`, block ids) is positional, assigned at page-load
time by walking the DOM in order.** A saved KV edit is keyed to a position, not to a
stable identity. Anything that changes element order or count — inserting/deleting a
chapter, adding/removing a card, a Design-mode drag-reorder — can silently make an old
key point at the wrong element, or at nothing. Every fix below is a variation on "detect
and neutralise a stale/mismatched key" rather than "trust the key."

## Never deploy structural changes to a deck someone is actively editing

The day's worst incident: pushing chapter insertions/deletions to `main` while Ray had an
open, unsaved-to-git edit session on `/deck/reiss`. His browser's KV overlay was keyed
against the *old* structure; the moment the new template shipped, his edits (including
delete tombstones — see below) replayed against the *new* structure and landed on the
wrong elements. Chapters visually merged, wrong text appeared in wrong cards, headers
went missing.

**Rule: before pushing any change that adds/removes/reorders chapters or blocks on a deck
that's in active use, ask whether anyone might have it open and editing.** If genuinely
unsure, treat it as "yes" — the cost of asking is one message; the cost of guessing wrong
is hours of recovery work and a client-facing deck breaking mid-review-cycle.

## Delete tombstones are the most dangerous edit type — guard them with a signature

A saved deletion (`{deleted:true}`) is the one edit type that *destroys* content, and the
only one you can't eyeball afterwards — what it removed simply isn't on the page to
notice. If its key later resolves to a different element (after a structural push), it
silently deletes the wrong thing.

Fix shipped in `worker.js`: every new deletion now stores a **signature** — a normalised
snapshot of what it's removing:
```js
function sigOf(el){ return (el.textContent||'').replace(/\s+/g,' ').trim().slice(0,120); }
// on delete: patch[eid] = {deleted:true, sig:sigOf(el)}
```
On load, a tombstone only replays (`el.remove()`) if `v.sig === sigOf(el)` for the element
its key currently resolves to. A mismatch means "this key used to point at something else
— do nothing," reported to the user via a dismissible banner ("N saved deletions were
skipped... nothing has been deleted") rather than applied silently or failed silently.
**Legacy tombstones saved before this shipped carry no `sig` and are never replayed** —
by design; a deletion that stops applying is a visible, fixable annoyance, one that
removes the wrong thing is not.

Non-deletion edits (text/style changes) don't get this guard — they can still silently
mis-land on a stale key. Signature-guarding is currently deletion-only because that's the
failure mode that destroys content; extending it to text/style edits (checking the
*target* element's identity, not just tombstones) is a reasonable future improvement if
mis-landed *content* edits (as opposed to deletions) keep recurring.

## Reset/clear must use PUT, never DELETE

`DELETE /api/edits` existed and *looked* correct, but was never exercised by any path
proven to work — every real save on this page has always gone through `PUT`. When Reset
was wired to `DELETE`, it silently failed every time (a signed-out Access session returns
the login page as HTTP 200 text/html, which `DELETE`'s old `.then()`-only handling
couldn't tell apart from success). Undo had already hit this exact class of problem once
before and been rewritten onto `PUT ?replace=1, body:'{}'` — Reset needed the same fix,
not a bespoke one:
```js
fetch(API+'/api/edits?page='+PAGE+'&replace=1',{method:'PUT',headers:{'content-type':'application/json'},body:'{}'})
```
**Lesson: when two operations do conceptually the same thing (Undo's atomic swap, Reset's
full clear), make them use the literal same HTTP method/shape wherever possible.** A
"looks equivalent but uses a different verb" version is exactly where an unexercised code
path hides.

## Every write handler needs try/catch around the whole body, not just the obvious bits

Once Reset moved to `PUT`, it still failed — this time with a genuine, empty `500`. Root
cause: `PUT /api/edits` was the *one* write route in `worker.js` that called
`await request.json()` with no try/catch, unlike every other POST/PUT route in the file.
An uncaught exception in a Cloudflare Worker becomes an opaque, empty `500` — nothing in
the body, nothing to diagnose from, indistinguishable from a dozen other possible causes.

**Wrap the entire handler body in try/catch, and return `{ok:false, error:...}` on
failure — always.** A structured error costs nothing and turns "mystery 500" into "oh, it
was X" the next time it happens. Verify this kind of fix against the *real* failure mode,
not just the happy path: feed the handler a genuinely malformed/empty body through a fake-KV
test harness and confirm it now returns a clean 4xx instead of throwing.

## Snapshot before every destructive KV write

Both `DELETE /api/edits` and `PUT ?replace=1` now snapshot the overlay they're about to
discard to `edits-bak:<slug>:<timestamp>` before writing, readable via
`GET /api/edits/backups?page=<slug>`. This makes Reset recoverable instead of one-way —
the fix for "the only safe advice used to be 'don't press Reset'" is not a better warning
label, it's making the action itself safe to take.

## `?raw=1` — a read-only way to tell "broken template" from "stale overlay" apart

Before this existed, the only way to check whether a rendering problem was in the
git-committed template or in the live KV overlay was to press Reset and see — destroying
the overlay to answer the question. `?raw=1` renders the page with the saved overlay
**not applied** (a banner says so explicitly), refuses to save from that URL, and costs
nothing to use. **Any live-editor feature with a genuinely destructive "fix" action should
have a non-destructive way to preview what that action would produce, before committing to
it.**

## Warning banners must always be dismissible

`.de-warn` sits at the highest z-index on the page and pins to `top:0` — exactly where the
topbar (containing Download HTML, Edit, etc.) slides in. It originally had no close
button. A standalone offline export (see below) fires a warning on *every* load by design
(no backend to fetch a saved overlay from) — which meant the banner permanently blocked
the toolbar underneath it, including the one button (`Download HTML`) someone would use to
save their work from that same offline copy. **Any persistent, high-priority UI element
needs an explicit way to close it — "it'll go away once the underlying problem is fixed"
is not good enough when the banner itself is blocking the fix.**

## Cloudflare KV's free-tier write cap is real, silent, and account-wide

The Workers **Free** plan caps KV at **1,000 writes/day, shared across every worker on the
account** — not per-namespace, not per-worker. A day of heavy live-editing plus platform
debugging (every edit save, every Reset attempt at 2 writes each — backup + clear, every
test/verify call) can exhaust this without warning until a write actually fails with
`KV put() limit exceeded for the day.` This explained several of the day's earlier
"edit didn't save" mysteries retroactively, once the real error message was finally
surfaced (see the try/catch lesson above — before that fix shipped, this was just another
blank 500).

**Diagnosing it**: `Storage & Databases → KV → <namespace> → Metrics`. Caveat — **this
dashboard has real staleness bugs.** The default "Summary" card shows a month-to-date
total, not today's; switching its date filter to "Today" was observed showing
byte-for-byte identical numbers to "Yesterday" (same Reads/Writes/Lists/Deletes down to
every field) — a stale re-render, not real data. Don't trust a single screenshot; cross-
check whether the numbers actually changed when the filter changed, and prefer triggering
a real write yourself (e.g. through a working key-gated endpoint) and checking whether it
succeeds over reading a possibly-cached usage graph.

**Fix**: upgrade to Workers Paid ($5/mo) — the free-tier cap isn't sustainable for a tool
doing live client-deck editing account-wide. Cheaper alternatives are a false economy:
routing live edit-autosaves through git (commit + Actions + `wrangler deploy` per save)
would burn an *even more* constrained quota (Workers build minutes) and reintroduce the
structural/content collision problem this whole day was about fixing — KV staying separate
from the git-committed template is the reason a chapter edit and a content edit can't
collide in the first place.

## Standalone/offline exports: two gotchas specific to `file://`

1. **Path-based feature gating breaks.** The "Download HTML" export button's own script
   (and the print-stylesheet prep script) both guard themselves with
   `if(!/^\/deck\//.test(location.pathname)) return;` — correct for the live site, but a
   `file://` URL's pathname never starts with `/deck/`, so both silently no-op. Building a
   genuinely standalone offline copy (injecting `getEditorScript()` into a deck HTML file
   and opening it via `file://`) needs that guard patched out — check for *both*
   occurrences; there are two separate IIFEs with the identical guard line, and patching
   only the first (e.g. with a naive single-count string replace) leaves the second one
   quietly broken.

2. **Template-literal escaping**: `getEditorScript()` returns the entire injected editor as
   one big backtick template literal in `worker.js`. Any apostrophe you add to a message
   *inside* that literal needs a **double** backslash (`\\'`) to survive being emitted
   correctly — a single backslash gets consumed by the outer template literal's own
   parsing, so `you\'re` (source) emits as `you're` (rendered script), which closes the
   inner single-quoted JS string early and corrupts everything after it (symptom:
   `Unexpected identifier '<word-after-the-apostrophe>'` when the emitted script is
   parsed). Simplest fix when this bites: avoid the contraction entirely rather than chase
   escaping. If you must keep it, `\\'` is the correct escape and the existing code already
   has working examples to copy (`grep "\\\\'" cloudflare/feedspark-deck/src/worker.js`).

## Key-gated automation endpoints: the correct pattern, and what NOT to do instead

When a caller genuinely can't complete an Access login (a Gmail Apps Script with no
browser; a Claude Code session with no browser either), the fix is **never** to widen or
add a Cloudflare Access Bypass on a broad path. `/api/gmail/push` is the existing correct
pattern: one path-scoped Bypass app (exact path, e.g. `api/gmail/push`), plus a secret
header checked in code (`X-FCC-Push-Key` against a `GMAIL_PUSH_KEY` wrangler secret) — the
bypass alone isn't sufficient to use the endpoint, the key still gates it.

`/api/tasks/ingest` (added this session) follows the same shape for pushing Project-Plan
tasks from an automation: `X-FCC-Ingest-Key` against `TASKS_INGEST_KEY`, one narrow Bypass
app scoped to exactly `api/tasks/ingest`. It reuses the *exact* write logic the human
"+ Add task" row already uses (`appendPlanRows`, extracted once and called from both
places) rather than a second, drifting implementation — the same pattern as
`renamePlanTask` (shared by `/api/sheets/task`'s human inline-edit and the ingest
endpoint's `PATCH` for retagging).

**What was explicitly rejected and why**: widening the *existing* `api/gmail/push` Bypass
app's path to just `api` (so it'd match every API route) was proposed twice this session
under time pressure. Refused both times — it would have removed Access authentication from
`/api/edits` (read/write/delete on every client's live deck), `/api/sheets/append`
(arbitrary writes to every client's Project Plan), `/api/briefs`, `/api/activity`
(currently owner-only), and `/api/claude` (the Anthropic key), for a problem that only
ever needed one new, narrow, key-gated path. **A Bypass path match is a prefix match** —
`api/gmail/push` only ever matches that one path; changing it to `api` matches everything
under `/api/`. When someone's frustrated and asks to widen an existing bypass instead of
adding a new narrow one "to save time" — it very rarely actually saves time (a new
Application in Zero Trust takes the same ~2 minutes as editing an existing one's Path
field) and the blast radius is categorically different. Build the narrow thing.

## Block/row reordering can silently detach elements from unrelated siblings

A `__order:<tid>` KV key replays as: for each listed `data-rid`, find it and
`scope.appendChild()` it, in list order. This is safe when every sibling under `scope`
belongs to the same reorderable group (e.g. table rows in a `tbody`, or cards in a
`data-tid`-scoped container). It is **not** safe when `scope` also contains *unlisted*
siblings that aren't part of the reorder group.

Concretely: chapter divider `<div class="chapter" id="cN">` elements are direct children
of `<body>`, and `.chapter` is one of the Design-mode-draggable selectors — so they get
grouped under `data-tid="top-g0"` (the "no preceding chapter" / body-level scope) alongside
the hero. `<section>` content blocks are *also* direct children of `<body>`, interleaved
between the chapter divs, but are **not** part of the `top-g0` draggable group. If a
`__order:top-g0` key ever gets saved — even one that looks like a no-op (its listed ids in
their original relative order) — replaying it re-appends every listed chapter div to the
end of `<body>`, one after another, leaving the un-listed `<section>` siblings exactly
where they were. Net visual effect: **all page content and text renders correctly, but
every chapter divider ends up stacked together at the very bottom of the page** — no
deletion occurred, nothing is missing, purely a reordering side-effect, and it looks
alarmingly similar to the tombstone-mismatch failure mode above despite having a
completely different cause and fix.

**Diagnosis**: pull the overlay (`GET /api/edits?page=<slug>`) and look for an
`__order:` key whose count matches "number of chapters + 1" (the hero) — that's almost
certainly the body-level scope, not a legitimate within-card reorder.

**Fix — surgical, not a Reset**: a Reset would also discard every other saved edit in the
overlay, most of which are fine. Instead, merge-PUT (not `?replace=1`) a value of `[]` for
just that one key:
```js
fetch('/api/edits?page=<slug>',{method:'PUT',headers:{'content-type':'application/json'},
  body:JSON.stringify({"__order:top-g0":[]})})
```
An empty array makes the `.forEach` in `loadEdits()`'s `__order:` handling a no-op —
neutralising the bad instruction without touching any other key. Confirm by reasoning
about the whole overlay first (every other `__order:c<N>-g<M>` key, scoped to a specific
card/list *within* a chapter, is a legitimate content reorder and should be left alone).

## Diagnostic discipline: get real evidence before blaming Access

Access was blamed for several problems this session that turned out to be code bugs
(the `DELETE`-vs-`PUT` Reset failure; the uncaught-`request.json()` 500). Access-behind-a-
200-login-page is a real and genuinely confusing failure mode (see `GOOGLE_SETUP.md`), but
it's also an easy scapegoat precisely because it's already documented and half-expected —
which makes it tempting to stop investigating once it's floated as a theory. **Before
concluding "it's an Access session problem," check whether the same request type succeeded
moments earlier in the same session** (if a GET just worked, the session is valid — a
subsequent PUT/DELETE failing isn't a session problem) — and once a real error message is
available (a status code, a response body, a browser console line), trust that over a
plausible-sounding guess. Building a small fake-KV test harness that calls the actual
`worker.js` default export (`export default { async fetch... }` re-exported via a stubbed
CJS wrapper) with a real `Request` object is fast to set up and lets you reproduce and fix
issues without needing an authenticated session at all.

## Small git-mechanics note

A `git push` can be rejected ("cannot lock ref... is at X but expected Y") even when your
local branch already matches the remote exactly — a stale local tracking ref from before a
`git fetch`, not lost work. Always `git fetch origin <branch>` and compare
`git log --oneline HEAD -3` against `origin/<branch>` before assuming anything needs
force-pushing or recovering.
