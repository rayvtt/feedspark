# Retainer hours — where the time actually went

> Ray, 16 Sep 2026: *"a pie chart that highlights the importance of technical issue and feature
> support versus optimization, and show the hours spent on each task for each client … Most of our
> clients should spend most of their retainer time on optimisation instead of technical strategy
> or support."*

The brand one-pager's section 2 opens with **Where the retainer went**: a donut of every hour our
team booked against the account over the last 12 months, split four ways, with the verdict stated
in words and a **Hours by task** table underneath listing what was actually done and what each
piece of it cost.

## The four categories

| Slice | What it is | Examples from the real data |
|---|---|---|
| **Optimisation** | work that moves performance | Keyword optimisation, Title optimisation, Data field update, Custom Label update, Product Type Optimisation, Category mapping, Image optimisations |
| **Technical fixes** | something is broken | Disapprovals, GMC Fixing, GMC Account Issue, Scraping changes, Urgent Feed issues, Mismatched Price Issue |
| **Feature & set-up** | new capability | New Feeds, New Markets, DPA Image Overlay, Dev Work, Output feed exclusion setup, access configuration |
| **Account & support** | running the relationship | General account management, Client call, QBR, Batch Report, Project & Optimisation Plan Update, inbound Email tickets |

A title matching none of them is **Other** and is never folded into a category to flatter the mix.
`Other` is drawn in the pie for the same reason — hiding it would overstate every other slice.
If `Other` climbs on an account, that is the signal to extend `RULES` in `tools/reporthours.mjs`,
not to ignore it.

### Precedence is the whole game

Rules are tried in order and the **first match wins**, because the obvious keyword is often the
wrong one. Every one of these was a real misclassification before it was pinned as a test:

- `Project & Optimisation Plan Update` carries the word *Optimisation* and is plan admin → the
  account rules run **before** the optimisation rules.
- `PT Fixes` and `Product Type Fixes` are work on the category tree, not faults → the bare
  `Fixes` rule runs **last**, after optimisation. Earlier, it filed a fifth of the product-type
  effort under Technical fixes.
- `Reiss' Keyword Planner` and `[FS Brief] … Keywords Optimisation - Marketing Planner - 0926`
  are keyword work → *planner* is deliberately **not** an account keyword.
- `Batch Report` is reporting, `Batch set-up` is build. One word apart, two categories.
- `Image optimisations` is optimisation, `DPA Image Overlay` is the overlay service.
- A call about keywords is still a call.

## Billable and non-billable

Both `time_taken` and `time_taken_nonbill` count toward the mix. Non-billable hours are hours our
team spent that the client was not charged for — leaving them out would understate exactly the
thing this chart exists to show. The sheet states the non-billable figure explicitly rather than
burying it.

## Where the data comes from, and why it is baked

The source is the FeedSpark reports database (`sh_merchants` task list), reached through an MCP
server that **only a Claude session can call** — the Cloudflare worker has no route to it and no
credential for it. So the ingest follows the same shape as the ATRT tracker and the
scheduled-work snapshot: a session pulls, a tool aggregates, the committed JSON is the record.
The sheet always prints the window it is reading, because a snapshot that silently ages is worse
than no snapshot.

### Refreshing it

1. In a session, per fee-earning market (`get_client_list` gives the roster and `client_id`s;
   markets with `allowance > 0` or `used_hours > 0` are the ones that carry work):

   ```
   get_task_list_for_client(client_id, limit 700+)
   ```

   Oversized results are written to disk by the harness — that is the intended path, and the
   reason a 12-month estate pull costs almost nothing to ingest.

2. Aggregate and splice:

   ```bash
   node tools/build_report_hours.mjs --pulls <dir> --clients <clients.json> --months 12
   ```

### Two traps in the source, both handled

- **`from_date` is not applied.** Verified 16 Sep 2026: asking for `2026-07-01` returned rows from
  February. The window is applied in `aggregate()` and nowhere else.
- **Pulls are newest-first and capped by `limit`.** A busy market needs a limit deep enough to
  reach the window's start; the builder **refuses** to write a client whose deepest pull begins
  after the window opens, rather than reporting a partial year as a full one.

Dates of `0000-00-00` are counted as undated and never guessed into a month.

## Files

| File | Role |
|---|---|
| `tools/reporthours.mjs` | pure: `classifyTask`, `taskKey`, `monthKey`, `aggregate`, `mixVerdict`, `brandKey` |
| `tools/build_report_hours.mjs` | reads pulls → `docs/reports_hours.json` → splices `window.FSHOURS` |
| `tools/test_reporthours.mjs` | 92 assertions on real titles, the precedence traps and the baked snapshot |
| `docs/reports_hours.json` | the committed record |

The reports database spells brands its own way (`Jomalone`, `YuMove`). `brandKey` folds case,
spacing, accents and punctuation so the dossier resolves its own name without an alias table; the
page carries the same fold and the harness pins them to the same answer.
