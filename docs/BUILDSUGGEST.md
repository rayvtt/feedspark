# Suggested next builds — the Build Log's own backlog, ranked (Sep 2026)

Ray's ask (22 Sep 2026): *"within Build Log also start suggesting the top five new features to build
for FCC to improve revenue, churn, client retention, AM efficiency, increase billable hours, or
reduce the time taken for each account work."*

The obvious build is a wishlist in git. It would be wrong within a week: it would suggest the same
five features whatever the book was doing, and nothing on it could be argued with. So a suggestion
here is **derived** — every candidate play carries a rule that reads the FCC's own live stores and
either produces a number or produces nothing.

## Where it lives

| | |
|---|---|
| Engine | `cloudflare/feedspark-deck/src/buildsuggest.js` — pure: no fetch, no KV, no DOM |
| Route | `GET /api/buildsuggest`, owner-only like the rest of the Build Log |
| Panel | the first panel on `/activity#build`, above the queue it feeds |
| Harness | `tools/test_buildsuggest.mjs` in qa_gate, presync and CI |

## The three rules that make it trustworthy

1. **An unread signal is never a zero.** A store nobody has synced comes back as `unread` with the
   reason, not as a play scoring nothing. "No negative balances" and "the Task Manager has never
   synced" are opposite findings, and the panel must never print one when it means the other. The
   same rule the guards, the Playbook and the hours badge already follow.
2. **Nothing already somebody's job is suggested.** Every rule carries distinctive `keys`, matched
   against the build queue, the open PRs and everything merged. Queueing a play from the panel
   writes the rule's own title into the queue, which is what makes it drop off the next load.
3. **The ranking is stated, not hidden.** `BASIS` is one object the engine and the panel share, so
   the footer can print the formula the score was computed with.

```
score = lever weight × evidence size × effort factor

lever    revenue 1.00 · churn 1.00 · retention 0.95 · billable 0.90 · efficiency 0.80 · time 0.80
size     the measured number ÷ the rule's own full-marks threshold, capped at 1
effort   S 1.00 (days) · M 0.72 (1–2 weeks) · L 0.45 (a month+)
```

Evidence size is measured against a threshold written into each rule, so a play cannot out-score
another by measuring itself in a bigger unit. The effort factor is deliberately steep: two small
builds that land next week beat one large one that lands at Christmas.

## The candidate plays

Ten today. The list is **fixed and finite on purpose** — an LLM asked to invent features would
invent the numbers under them too, which is the one thing no figure in this codebase is allowed to
be. The panel prints how many candidates it ranked, so a reader can see a backlog being prioritised
rather than an oracle. Add a rule to add a play.

| Play | Lever | Reads |
|---|---|---|
| Over-servicing report | Revenue | `tmidx` — hours delivered beyond the block |
| Skip win-back | Churn risk | `schedskip` — scheduled optimisation skipped |
| Quote chase | Revenue | saved quotes with no stage change for a fortnight |
| Invoice handoff | Revenue | saved quotes at Delivered, not yet Billed |
| Auto-chase | AM efficiency | briefs that have not moved a stage in ten days |
| Gap-to-quote | Billable hours | `goldenidx` required and conditional gaps |
| Content-quality fix packs | Billable hours | `goldenidx` content-quality scores under 75 |
| Coverage sweep | Time per account | wired Shopping feeds never scanned |
| Quiet-account radar | Retention | accounts with no brief raised in sixty days |
| Arrivals auto-brief | Billable hours | `voldobidx` arrivals in the last complete month |

Arrivals read the **last complete month** and never the running one, which is a part-month by
definition and would make every account look like it had fallen off a cliff.

## Adding a play

Append a rule to `RULES` with an `id`, a `lever` from Ray's six, an `effort`, a `title`, one
sentence of `what`, the `keys` that identify it in a queue entry or a PR title, a `full` threshold,
and a `read(sig, now)` that returns either `{unread: 'why'}` or `{n, unit, why, src}`. Two things
the harness will hold you to: the keys must match the rule's own title, and they must not match any
other rule's title. It caught exactly that collision on the first run, where one play's title ended
with another play's dedupe key.
