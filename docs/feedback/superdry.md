## 2026-07-29 — round 1
### Hero
- Apply the missing required style patterns from the voice-and-numbers-style guide.
  → Added the shared Google epigraph ("The feed becomes transaction infrastructure...") as the hero's `.lede`, verbatim, matching YuMOVE and Reiss. The client-specific opening line it displaced (two years, 19 markets, 1,294 tasks, 1,746 hours) moved down into the agenda section's subtitle, so no information was lost.

### Chapter ten — AI readiness
- Apply the missing required style patterns from the voice-and-numbers-style guide.
  → Added the required rhetorical shopper-voice quote opener to the maturity-tiers section's subtitle, using the fixed four-part template reworded for Superdry's category: a jacket-fit/warmth query, since Superdry's own archive (chapter seven) shows jackets are a proven, heavily-tested product line.

### Chapter three — review & project recap
- Apply the missing required style patterns from the voice-and-numbers-style guide (bracket placeholder).
  → Fixed a leftover `[Brand]` placeholder in the recap table ("Title change — [Brand] moved to end of title") to read "brand name moved to end of title."
- Fix the category-mapping contradiction: chapter 3 marks category mapping "✓ Done — all markets" (112 tasks closed) with no caveat, while chapter 9's live GB feed audit shows only 43% of SKUs actually reach 3+ taxonomy levels.
  → This is the same bug class Ray flagged on Reiss round 1 (headline the stricter number, don't let an aggregate pass-flag stand unqualified). Added a cross-reference to chapter nine's finding directly in the recap table's outcome cell and in the "Two years of compounding foundations" card below it — both now say the 112 mapping tasks closed on the plan, but taxonomy depth hasn't fully landed on the live feed. Also strengthened chapter nine's own text to name chapter three explicitly ("chapter three's 112 category-mapping passes all reading ✓ Done"), so the two chapters cross-reference each other instead of the contradiction sitting silently in one place.

### Chapter one — service scope & scale
- Reconcile the 1,294 vs 260 task-count stat: both numbers sit in the same stats row with no explanation of why they differ.
  → Added a note directly under the stats block (same pattern as Reiss's "469 tasks is the plan's count... not the hours" reconciliation): 1,294 is the cumulative 2-year task-log count (mostly closed, rolled off day-to-day tracking); 260 is the live project plan's current tracked total (169 done · 86 open · 5 parked). Labelled explicitly as two different measures, not competing totals for the same fact.

### Skill update
- Would this recur on the next deck? Yes, twice over — both go into the skill, not just this file.
  1. **The Google epigraph and AI-landscape rhetorical-quote patterns are check-before-build items, not just a style reference to skim.** Added a line to `SKILL.md` Step 3 telling the builder to grep the new deck for `transaction infrastructure` and the shopper-quote em-dash pattern before shipping any new deck — the same two omissions that hit Superdry here are exactly the kind of thing that's easy to skip on a fresh build under brief pressure.
  2. **A completion pill in one chapter and a stricter live-feed number in a later chapter are easy to leave unconnected even when both are individually correct** — Superdry's category-mapping row and Reiss's Feed Optimisation Score bug (round 1) are the same failure shape: an earlier chapter's "Done" outlives a later chapter's stricter measurement. Added a QA step to `SKILL.md` Step 5: after the headline-vs-note check, also grep any status-pill "✓ Done" outcome text against later-chapter percentage findings on the same task family, and cross-reference if they disagree.

## 2026-08-04 — round 2
### Chapter three — review & project recap
- Recap: 4 open btw — therefore redistribute other 82 tasks into done.
  → Applied: 251 done · 4 open · 5 parked · 260 total (was 169/86/5). Updated the four stat cards in chapter three, the agenda row, and the chapter-one reconciliation note that quoted the same split. Chapter three's own recap table already showed exactly 4 non-done, non-parked rows (2 in flight + 2 open), so the table needed no status changes — but two outcome cells still quoted the old lane counts and were corrected (custom labels 16→18 of 18; keywords 20→24 of 29).
  → Knock-on fixed in the same pass, since leaving it would have reproduced round 1's exact bug (an early chapter's headline contradicting a later chapter's figures): chapter nine's six lane cells, its "other lanes" card and the headline score were all derived from done=169. Recomputed with `tools/build_plan_tasks.py`'s own `score_of()`: **92/100** (was 70). Lanes now read custom labels 18/18, testing 8/8, imagery 30/30, titles 14/14, keywords 24/29, data fields 1/5, all others closed.
  → **Two inferences, both flagged with the `?` chk badge per the style guide — Ray to confirm before this goes to the client:** (a) the 4 remaining open tasks are the data-fields lane (5 total, 1 done — lands the arithmetic exactly at 251/4/5 and matches the deck's existing P0-gap narrative); (b) the 5 parked are the keywords lane's held "mid-seasonal sale keywords — international mapping", which the recap table already shows as ⚑ Parked and which plausibly spans 5 markets. The true per-lane split of the 82 was not sourced from the plan — only the totals were given.
  → Narrative turned to the deck's advantage rather than smoothed over: with the plan side essentially complete (251/260), chapter nine's subtitle now says so plainly and hands the real read to the live GB feed audit. Titles are the sharpest example and are called out as such — 14/14 closed on the plan, but only 63% of titles land in the 80–120 char MASK band on the live feed. Same for product type: 3/3 closed, 43% depth on the feed.

### Not done this round
- `docs/plan_tasks.json` still carries the old Superdry figures (score 70, done 169, open 86) and feeds `window.PLANTASKS` across the FCC (command center, dossier, deck-builder). The deck and the FCC therefore now disagree. Not hand-edited because it is generated by `tools/build_plan_tasks.py` from `tools/plan_exports/superdry_projectplan.csv` (a stale 2020 export), and its `latest` array lists ~70 individual non-done tasks — re-deriving those per-task would mean inventing which specific tasks are open. Needs either a fresh project-plan export to re-run the pipeline, or an explicit decision to hand-patch the aggregates.

### Skill update
- Would this recur on the next deck? **Yes — added to `SKILL.md` Step 5.** A count correction never lands in one place: task-count headlines are typically restated in an agenda row, a reconciliation note, per-lane scorecard cells, a computed score, and individual table outcome cells. Round 1 fixed a cross-chapter contradiction; this round created and then fixed the same shape again from the opposite direction. The QA step now says: after changing any headline count, grep the old number AND its derived per-lane figures across the whole deck, and recompute any score derived from them with the real scoring function rather than adjusting it by eye.
