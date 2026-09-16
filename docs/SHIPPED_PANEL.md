# The shipped panel — the build log, without leaving the page (Sep 2026)

> Ray, 16 Sep 2026: *"Build a new feature… a pop-up module (right hand panel slide) for the
> activity build log that shows all the most recent build logs that have been completed, because
> I'm working on multiple features across multiple modules, so sometimes I forget what has actually
> been done. Bring the shipped PRs onto a right-hand side panel when each feature is complete, and
> then prompt the user to close the tab."*

## The problem is not "where is the build log"

It is already on `/activity`. The problem is that the answer is needed **while working on something
else**, in one of a dozen open tabs, and navigating away to find it loses the place. So this is the
same data as the Build Log tab, reachable without leaving the page: a handle on the right edge, a
panel that slides over.

`docs/shipped_widget.html`, injected on every app page **for the real owner only** — the build log
lives behind the owner-gated `/activity` board, so its slide-over inherits the same gate. Client
decks and the embedded Feed Chat frame are skipped.

## "Prompt the user to close the tab"

This is the part that earns the feature. A merged PR means the session that raised it is finished,
and its tab is dead weight still drawing attention. The panel remembers which PR numbers this screen
has been shown and puts anything that shipped since then in its own band at the top — **naming the
branch**, which is what identifies the tab to close:

> ✓ Done 3m ago — that session is finished, you can close its tab.
> `claude/ledger-hours`

It **prompts**; it never closes a tab, navigates, or blocks the page with a dialog.

## Two rules that keep it from becoming noise

1. **First run is silent.** Announcing forty historic PRs as "new" the first time the widget loads
   would teach you to ignore the badge on day one. The first read seeds the seen-set and says
   nothing.
2. **It never nags.** The handle carries a count only while something is genuinely unseen, and
   *opening the panel is the acknowledgement* — there is no separate "mark as read". A later
   re-read does not re-announce the same batch.

## Where the state lives

The seen-set is `localStorage` (`fcc-shipped-seen`), deliberately **not** shared state. What one
screen has been shown is not a team fact — it belongs with the theme and the nav collapse on the
documented "stays on the device" list. Ray on one machine having dismissed a batch should not stop
it appearing on another.

## Data

`GET /api/buildlog` — the same endpoint the Build Log tab reads (GitHub PRs + branches, KV-cached
10 min). One source, two surfaces. Polled every 5 minutes and on tab-visible; polling faster would
only re-read the same cached snapshot. When GitHub is unreachable the worker serves its last
snapshot and the panel **says so**, rather than implying nothing has shipped.

The footer carries what is still in build and a link to the full board.

## QA

`tools/test_shipped.mjs` (qa_gate, presync, `validate.yml`) lifts the widget's helpers by name and
pins the title parsing, the first-run silence, the "only what is new" rule, the branch prompt, the
slide-over mechanics, the stale-snapshot honesty and the owner-only wiring. Driven end-to-end in a
real browser in both themes: first load silent, two merges arriving mid-session, the badge, the
panel naming the branch, and the badge clearing on open and staying clear on re-read.
