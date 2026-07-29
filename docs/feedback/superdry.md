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
