---
name: feedspark-deck-generator
description: Builds a full, on-brand FeedSpark client deck (Strategy Review, Onboarding, Intro, etc.) from a brief produced by the FCC Deck Generator (/deck-builder), or from plain-English instructions naming a client and a set of sections. Turns a bullet-point outline into real, polished HTML — the same chapter/card/tier/table components already used in the YuMOVE deck — wired into the live worker and populated with the client's actual numbers from the ATRT plan data AND, when attached, a live product-feed export analysed directly (title/attribute/taxonomy/image scoring), not placeholder copy. Use this whenever Ray pastes a "Deck brief" or "Deck Build Brief" block (starts with "# [Client] — [Deck type] deck" or "FEEDSPARK — DECK BUILD BRIEF", has an outline/section list), attaches a feed export (.xlsx/.csv) alongside a deck request, or asks to "build/generate/create the deck for [client]", "turn this brief into a deck", "make the Strategy Review for [client]", or similar — even if he doesn't say the word "skill". The Deck Generator module only produces a rough in-browser mockup and the brief text; this skill produces the real, client-ready, fully-editable deck file.
---

# FeedSpark Deck Generator

Turns a deck brief into a real deck: a new HTML file in `docs/`, built from the same
component library as `docs/YuMOVE_Strategy_Review_Jul26.html`, wired into the Cloudflare
Worker so it's live and editable (text edit + Design mode) exactly like every other deck.

## Why this exists

`docs/FeedSpark_DeckBuilder.html` (served at `/deck-builder`) lets Ray compose an outline —
pick a client, a deck type, drag sections into order — and either preview a rough mockup
in the browser (generic bullet content, not on-brand) or copy a **brief**: a short markdown
spec naming the client, deck type, look-back window, ordered section list, and (if the
client has a linked plan) live score/task numbers. The brief ends with an explicit handoff
line: *"Send back to draft each section with Tachyon."* That handoff is this skill — take
the brief, and build the actual deck the DeckBuilder only sketches.

## Step 1 — Read the brief

A brief looks like this (client name, deck type and outline vary):

```
# Reiss — Strategy Review deck

- Client: Reiss
- Deck type: Strategy Review
- Look-back: Full FY
- Sections: 9

## Outline
1. **Review & project recap** — What we set out to do and what we delivered this period
2. **Look-back period** — Timeline of the tasks and milestones in the selected window
...

## Live data to weave in (from the plan)
- Feed-optimisation score: 65/100
- Tasks: 446 total · 263 done · 176 open
```

If Ray instead just says "build the Reiss deck" or similar without a formal brief, treat it
as an implicit brief: client = Reiss, deck type = Strategy Review (the default unless he
says otherwise), sections = the "strategy" preset in `FeedSpark_DeckBuilder.html`
(`recap, lookback, wins, score, airead, cases, roadmap`) unless he names different ones.

Match each outline line back to a **section id** using `references/section-patterns.md` —
match on the bold label text (e.g. "Review & project recap" → `recap`). If the brief's
labels don't match any known section, ask rather than guessing what component to build.

Some briefs ("FEEDSPARK — DECK BUILD BRIEF" format) explicitly name **two data streams**
and attach a live product-feed export (`.xlsx`/`.csv`, ~thousands of SKUs) alongside the
project-plan snapshot. Treat any attached feed export as **Stream B** and analyse it for
real — see Step 2a below — it's not optional colour, it's usually the more current and
more precise source for every feed-quality claim in the deck. A brief mentioning
"python-pptx" or "the previewer" is reusing generic boilerplate from CLAUDE.md's general
build-pipeline section — it doesn't mean switch output formats. The explicit goal line
("matching the deck... live at /deck/yumove") is the actual instruction: build the same
live, worker-hosted HTML system every other deck uses, not a PPTX file.

## Step 2 — Resolve the client's real data

Placeholder copy (`[Client]`, `[N]`, "illustrative") is exactly what this skill exists to
avoid. Before writing a single section, gather what's actually known about this client:

1. **CLAUDE.md** — the "Active client accounts" section has narrative facts for existing
   accounts (market, feed count, SKU count, retainer hours, prior deliverables, named
   contacts, proven test results). This is the highest-quality source for prose and for
   any header/hero facts (market, cycle, contacts).
2. **`docs/plan_tasks.json`** — keyed by client name (exact match, e.g. `"Reiss"`), gives
   `score` (0-100), `total`/`done`/`open`/`hold` task counts, `cats` (per-lane totals —
   title, keyword, data, image, custom_label, technical, channel, test, opt, account,
   product_type — each with total/done), `vol` (a monthly done/open trend, last N months),
   and `latest` (a list of the ~30 most recent tasks with category, owner and status). This
   is the primary source for the "Feed optimisation score", "Look-back period", "Review &
   project recap" and "wins" sections — read it with Python/`jq`, don't guess the shape.
3. **The brief's own "Live data to weave in" block**, if present — treat these numbers as
   the authoritative snapshot for the deck's headline stats (they may be more current than
   what's in git), but cross-check they're consistent with `plan_tasks.json`.
4. **`tools/plan_exports/<client>_projectplan.csv`** — only fall back to this raw export if
   a client has no entry in `plan_tasks.json` yet. It's a messy pivot-table dump, not clean
   data; if you need it, `tools/parse_projectplan.py` and `tools/build_plan_tasks.py` show
   how it's normally parsed into `plan_tasks.json` — consider running that pipeline instead
   of hand-parsing the CSV. **It's also worth a direct `grep` even when you're not building
   `plan_tasks.json`** — a client's project plan often has line items an aggregate summary
   drops (e.g. Reiss's own inline "A/B Testing" section, itemised tests with results in the
   task text itself), and this file already has it committed — no live Drive call needed.

**A named sub-tab you can't select isn't the same as data you can't reach.** The Drive tools
available here (`read_file_content`, `download_file_content`, `get_file_metadata`) return one
default sheet per spreadsheet file with no way to pick a specific tab by name/gid — if a brief
or a plan note references a specific tab (e.g. an "A/B Test Archive" tab living inside the
Project Plan spreadsheet), expect that tab specifically to stay out of reach even once Drive
access itself is working. Don't stop at "the tab isn't reachable, here's a placeholder" —
mine the sheet/CSV content you *can* get (the tab that does come through, or the local
`plan_exports` CSV) for the same information under a different name; a task log's own
line items often carry real test names, dates and outcomes an archive tab would also hold,
just less neatly organised. If genuinely nothing usable turns up, say so and ask Ray to
share the specific tab as its own link/export — that sidesteps the tool limitation entirely.

5. **An A/B test archive export**, if attached — a per-test log (one row per test, control vs.
   test group) is a stronger source than any task-log status pill, because it carries the
   actual quantified result, not just "Done"/"Reading". Parse it with `openpyxl` the same way
   as a feed export and compute real aggregates (win rate, average lift, best/worst, broken
   down by market/category) rather than reporting each test as a bare win/loss pill — the
   aggregate is what makes 40+ scattered tests read as a track record instead of a wall of
   rows. **Don't trust an auto-generated report's own narrative conclusion at face value** —
   these exports are often templated (the same boilerplate paragraph copy-pasted per row with
   numbers substituted in), and the template wording can say "uplift" for a negative number or
   assert a framing ("Test Group performs better") that doesn't actually match that row's own
   signed figures. Read the raw numbers, not the prose wrapped around them, and describe what
   they actually show.

If a client has no linked plan and no CLAUDE.md entry (a prospect deck), say so plainly and
either ask Ray for the missing facts or write clearly-marked placeholders — never invent
numbers, test results, or client facts that aren't sourced from somewhere above.

**A feed export is a sample, not a catalogue, unless the brief says otherwise.** A brief
attaching a feed export rarely states it covers every SKU/brand/market the account actually
runs (e.g. a ~5,000-row export against a client known to run tens of thousands of SKUs
across many markets/feeds) — treat any count derived from that export (SKU total, brand
list, distinct product groups) as scoped to the sample until the brief or CLAUDE.md
confirms it's the full live feed. Say "in this sample"/"in this export," not "across the
account," and mark derived breakdowns (e.g. brand share) as unconfirmed rather than
presenting them as the account's true mix. This applies to every deck built from an
attached export, not just Reiss.

### Step 2a — Analyse an attached product feed (Stream B), when present

A live feed export is ground truth about the catalogue *today* — the project plan only
tells you what tasks were closed, not what's actually live on every SKU. Load it with
`openpyxl`/`pandas` (install if missing) and score it directly rather than summarising a
few sample rows from memory:

- **Title structure (MASK)** — Brand + Material + Fit + Colour + Use-case, 80–120 chars.
  Compute the real length distribution and the % actually landing in that band. Don't
  trust an internal "optimised" flag alone (e.g. a `c:fs_data_opti`-style column) at face
  value — it usually means "process has run," which can be true even when the structural
  target (length, MASK component coverage) isn't met yet. Report both if they diverge; that
  gap is itself a real, deck-worthy finding.
- **Attribute completeness** — fill rate for GTIN/identifier, colour, material, size,
  gender, age group, item-group ID, condition, pattern. Compare against any previously
  reported Golden Record % — they're different methodologies measuring related things, not
  the same number; explain the difference rather than picking one silently.
- **Taxonomy depth** — GPC (`google_product_category`) and custom `product_type` depth
  (count segments split on `>`), separately — they're often not the same depth.
  - **Imagery** — count of populated image fields per SKU vs. the slots available.
- **Custom labels** — how many of the available label slots are actually populated, and
  what real values they carry (bestseller flags, sub-brand/collab lines, etc. — these often
  surface genuinely useful scope facts, like a multi-brand portfolio hiding inside one
  feed).
- **Conversational-attribute coverage** — check whether `question_and_answer`,
  `item_group_title`, `variant_option`, `popularity_rank`, `related_product`,
  `document_link` exist as columns at all. Their total absence is itself a fact worth
  stating plainly (0%, confirmed from the schema — not inferred).
- **Cross-check Stream A against Stream B wherever the deck asserts a % done or a fix
  landed.** If the plan says a problem is "fixed," verify it in the feed (e.g. re-measure
  the specific defect rate before/after) rather than reporting the plan's claim unchecked —
  a verified before/after number is a far stronger deck moment than a task-status pill, and
  catching a genuine divergence (a tool built but not yet rolled out across the catalogue,
  for instance) is exactly the kind of insight a plan-only deck can't produce.
- **Where Stream A (tasks) and Stream B (feed) disagree, lead with the feed** — say so
  explicitly in the deck rather than silently picking a number, and explain *why* they
  diverge (usually: a task closes when a tool/process ships, not when it's been applied to
  every SKU). That explanation is more valuable to Ray than either number alone.
- Pull a **real SKU** from the export for any illustrative example (Tachyon output, an
  attribute code sample) instead of inventing one — it reads as authentic because it is.

## Step 3 — Build the deck

Use `docs/FeedSpark_Strategy_Review_Template.html` as the structural base — it already has
the full design system (CSS, topbar, hero, chapter divider, all component classes) with
`[Client]`-style placeholders. Read it and `docs/YuMOVE_Strategy_Review_Jul26.html` side by
side: the template shows the placeholder shape, YuMOVE shows what a fully-populated example
of the same component looks like in practice.

The template is a fixed 7-chapter Strategy Review. **A brief's outline can have a different
number of sections in a different order** — don't force-fit it into the template's 7 slots.
Instead:

1. Copy the template's `<head>` (fonts, full `<style>` block) and the closing `<script>`
   block verbatim — these are the design system and the interaction layer, not per-deck.
2. Build the hero using the client's real name/market/cycle (from Step 2).
3. For each outline section, in order, write a chapter `<div class="chapter" id="cN">...`
   + following `<section>` block(s), numbered `01, 02, ... ` sequentially by outline
   position (not by the section's position in the reference table). Use
   `references/section-patterns.md` to pick which existing component pattern fits that
   section id, and adapt the real example from YuMOVE/the template — same classes
   (`.stats`, `.card`, `.tier`, `.mo`, `.pipe-card`, `.proto`, table + `.pill`, etc.) so
   Design mode and the row drag-and-drop work on it exactly like every other deck.
4. Populate the topbar `.tb-nav` links to match however many chapters you actually built —
   this is the most common thing to forget when the section count differs from 7.
5. If the outline includes `conv` (Google conversational attributes), keep the interactive
   Q&A panel and its `DATA` object at the bottom of the script — rewrite the six entries
   with this client's real product/category language. If `conv` isn't in the outline, cut
   the whole interactive-panel section rather than leaving a dead/empty one in.
6. Do not leave any `[bracket placeholder]` text in the output — grep for `\[` before
   moving on; every remaining bracket should be a deliberate content gap you've flagged to
   Ray, not an oversight.

Save the file as `docs/<Client>_Strategy_Review_<Period>.html` (mirror the existing naming:
`docs/YuMOVE_Strategy_Review_Jul26.html`). Use the actual look-back/period label from the
brief for `<Period>`.

## Step 4 — Wire it into the worker

Follow the exact pattern already used for every other deck in
`cloudflare/feedspark-deck/src/worker.js`:

1. Add an `import DECK_<CLIENT> from "../../../docs/<filename>";` alongside the existing
   deck imports.
2. Add a `'/deck/<slug>': { html: DECK_<CLIENT>, slug: '<slug>' },` entry to the `PAGES`
   map, where `<slug>` is the lowercase-hyphenated client name — the same slugify logic the
   dossier's "Generate deck" button already uses (`name.toLowerCase().replace(/[^a-z0-9]+/g,'-')`).
   If the dossier already generated a `/deck/<slug>` link for this client via the dynamic
   template fallback, use that exact slug so the existing link keeps working.
3. Leave `getEditorScript()` and everything else in the worker untouched — every page it
   serves already gets the full text-edit + Design-mode widget for free; you don't need to
   do anything extra to make the new deck editable.

## Step 5 — QA before pushing

- `node --input-type=module --check < cloudflare/feedspark-deck/src/worker.js` — the worker
  is a shared file every deck depends on; a syntax error here breaks the whole site, not
  just the new deck.
- Sanity-check the new HTML: no stray `[bracket]` placeholders, no leftover mentions of a
  different client (e.g. grep for "YuMOVE" if you built the file by adapting YuMOVE's
  markup), topbar nav count matches chapter count, chapter numbers are sequential.
- **Headline number must match its own note.** In any scorecard-style block (`.sc-cell`,
  `.stat`, or similar) where a big headline number sits above a smaller explanatory note,
  check they're describing the same metric — not a process-completion flag headlined next
  to a note that actually describes a different, stricter outcome measurement (or vice
  versa). If two related-but-different numbers exist for the same claim (a "processed" flag
  vs. an actual structural pass rate; "has at least one" vs. a true average fill rate), the
  honest/stricter one is the headline and the softer one moves into the note as context —
  never the other way round. This caught a real bug in the Reiss deck's Feed Optimisation
  Score chapter (round 1 feedback) and is worth checking on every scorecard-style section,
  not just when feedback flags it.
- Preview if the tooling is available (`tools/preview_tmpl.py` / `tools/preview_simple.py`
  per `tools/README.md`) — Claude Code on the web usually doesn't have LibreOffice/
  `pdftoppm`, but the Pillow-based previewer works without them.

## Step 6 — Ship it

This repo has multiple sessions/agents pushing to `main` concurrently — `git fetch origin
main` and rebase immediately before every commit, and again immediately before every push,
not just once at the start. See `docs/WAYS_OF_WORKING.md` for the fuller git-conventions
context. Small, scoped commits (the new deck file; the worker.js wiring can be the same
commit or a separate one) make a late-breaking conflict a clean rebase instead of a mess.

After pushing, tell Ray the deck's live URL (`/deck/<slug>`) and flag anything you couldn't
source real data for (Step 2's "never invent numbers" rule) so he knows what still needs a
human answer before it goes in front of the client.

## Step 7 — Handling a feedback-loop prompt

Every deck has a 💬 Feedback mode: Ray leaves notes anchored to specific chapters/blocks,
then "Generate rework prompt" compiles them into a markdown block starting `# <slug> deck —
feedback round, <date>`, with a `## <chapter title>` heading per chapter and his notes as
bullets underneath. When a prompt in that shape lands in a session, do all three of these —
not just the deck rework:

1. **Rework the deck.** Open `docs/<Client>_...html`, find each chapter the feedback names,
   apply the change. Same QA pass as Step 5 (bracket check, nav-count check, worker syntax
   check) before pushing — a feedback round is still a push to the shared file.
2. **Save the round as a markdown file**, so there's a durable record of what was asked for
   and what changed — feedback given verbally in a chat only exists in that chat's history,
   which isn't where anyone will look for it later. Append to (creating if absent)
   `docs/feedback/<slug>.md`:
   ```markdown
   ## <date> — round N
   ### <Chapter title>
   - <note text, verbatim from the prompt>
     → <one line: what you changed, or why you didn't>
   ```
   Keep one file per deck slug, newest round at the bottom, so the log reads as a history of
   the deck's evolution. This is a real content file, not KV — commit and push it with the
   deck change.
3. **Update the skill, not just the deck, when the feedback would recur.** Ask: if Ray gave
   this same note on the *next* deck, would it still apply? If yes — a component pattern
   that's consistently wrong, a data source that should be checked earlier, a QA gap that
   let something through — fix it in `SKILL.md` or `references/section-patterns.md`, not
   only in this one deck file. If a note is genuinely one-off (a client-specific fact, a
   wording preference for this deck only), say so in the markdown log instead of forcing a
   skill change that wouldn't generalise. Every feedback round should end with an explicit
   yes/no on this, in the summary you give Ray — not silently skipped.
