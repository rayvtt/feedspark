---
name: feedspark-deck-generator
description: Builds a full, on-brand FeedSpark client deck (Strategy Review, Onboarding, Intro, etc.) from a brief produced by the FCC Deck Generator (/deck-builder), or from plain-English instructions naming a client and a set of sections. Turns a bullet-point outline into real, polished HTML — the same chapter/card/tier/table components already used in the YuMOVE deck — wired into the live worker and populated with the client's actual numbers from the ATRT plan data, not placeholder copy. Use this whenever Ray pastes a "Deck brief" block (starts with "# [Client] — [Deck type] deck", has a "## Outline" list and optionally a "## Live data to weave in" block), or asks to "build/generate/create the deck for [client]", "turn this brief into a deck", "make the Strategy Review for [client]", or similar — even if he doesn't say the word "skill". The Deck Generator module only produces a rough in-browser mockup and the brief text; this skill produces the real, client-ready, fully-editable deck file.
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
   of hand-parsing the CSV.

If a client has no linked plan and no CLAUDE.md entry (a prospect deck), say so plainly and
either ask Ray for the missing facts or write clearly-marked placeholders — never invent
numbers, test results, or client facts that aren't sourced from somewhere above.

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
