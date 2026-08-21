# Monsoon deck — feedback log

## 2026-08-21 — round 1 (Introduction deck, first build)

### Whole deck — register
- "Feedback on the language of the text within the deck: it sounds like it's being presented
  to me rather than to the client. Anything that says, for example, 'no task [or] reference
  anywhere in the project plan' does not need to be shown to the client; I should see that.
  Define which parts of the deck should be client-facing and which should be internal. If you
  need to make a note, make it more apparent so I can delete it properly."
  → Correct, and it was throughout — 20+ passages across 8 of 10 chapters written as a report
    to FeedSpark rather than copy for Monsoon. Every one rewritten as client-facing.
  → Built a real boundary rather than only rewording:
      · New `.int-note` component — red dashed panel headed "⚠ INTERNAL — NOT FOR CLIENT".
        Added to this deck AND to `docs/FeedSpark_Strategy_Review_Template.html` so every
        future deck has it.
      · Stripped from every client-bound output: `tools/deck_to_pptx.py` drops it before
        parsing; the Download-HTML builder in `worker.js` removes it. Verified — zero
        internal phrases survive into the exported .pptx.
      · Hidden by the existing ⚑ Data checks toggle for presenting.
      · `deck_audit.py` now flags this register as a HARD failure anywhere outside an
        `.int-note`, and exempts `.int-note` contents.
      · Boundary written up as SKILL.md Step 3a, with the client-facing / internal test.
  → Five internal notes now carry what Ray actually needs to action: retainer-hours
    provenance, inferred contact roles, the missing time log, the channel evidence basis,
    and the contradictory title-test pair.

### Chapter 08 — Value delivered
- The hours section was built around what the deck *couldn't* source rather than what the
  retainer bought.
  → Rewritten to lead with what 192 hours delivered (8,948 SKUs, 5 channels, 2 brands, a full
    test programme alongside BAU). The missing time log moved to an `.int-note`.

### Skill updated?
**Yes** — this recurs on every deck. SKILL.md Step 3a (the boundary + `.int-note`), the
component in the shared template, stripping in both exporters, and the audit rule. The same
defect had already shipped once on Reiss ("Assumptions flagged for Ray to confirm" reached a
presented deck), which is what makes it a systemic fix rather than a one-off edit.
