# Voice, numbers &amp; narrative style

Rules distilled from a close, line-by-line comparison of `docs/YuMOVE_Strategy_Review_Jul26.html`
(the client-approved master template) and `docs/Reiss_Strategy_Review_FY2526.html` (the same house
style put through 6 rounds of real client feedback — `docs/feedback/reiss.md`), then **adversarially
verified**: every rule below was checked by an independent agent told to try to refute it, not confirm
it, by grepping the actual deck text for the cited quote and for counter-examples elsewhere in the same
files. 36 candidate rules were generated; 19 survived verification. The other 17 sounded plausible but
turned out to be overgeneralized from 1-2 cherry-picked examples, contradicted by other content in the
same deck, or built on a mislabeled/mismatched quote — those are not repeated here, because a skill
file with confident-sounding wrong guidance is worse than no guidance. Use this alongside
`section-patterns.md` (which component to use) — this file is about how the words inside that
component should read.

**Read this before drafting prose for a new deck build (Step 3) — next up: Superdry.**

## Voice &amp; language

- **Frame recommendations and commercial/scope asks as explicit, non-committal proposals with a named
  owner — never as settled decisions.** For an ask on the client's side: imperative verb phrase +
  em-dash + owner name. For anything commercial or not yet signed off: "proposal, not a locked plan" /
  "needs [Ray] to confirm" language.
  *"Sign off the Ingredient Matrix — Simon"* (YuMOVE) · *"This is a proposal, not a locked plan: the
  market order groups by language/region similarity for a realistic operational flow, and the hour
  breakdown is FeedSpark's estimate — neither is something Reiss has signed off on yet."* (Reiss) ·
  *"Rate and total cost need Ray to confirm; the hours above are the estimate, not a price."* (Reiss)

- **Status pills use sentence case, never Title Case, from a fixed glyph vocabulary:** `✓` = done/
  automated, `⚑` = blocked/awaiting a named party, plain text = open/in-progress. Chapter eyebrows are
  always "Chapter " + the lowercase spelled-out ordinal, with zero exceptions across either deck's full
  chapter list. Note this is scoped to *status* pills specifically — the same `.pill` CSS class also
  carries percentages, TRUE/FALSE flags, and priority ratings that don't follow this glyph vocabulary at
  all, so don't over-apply the rule to every pill in the deck.
  *"✓ Done"*, *"⚑ Awaiting YuMOVE"*, *"⚑ Awaiting Kinase"*, *"In progress"*, *"Open"* (YuMOVE) ·
  *"⚑ Awaiting NEXT"*, *"✓ Automated"* (Reiss) · *"Chapter one"* ... *"Chapter seven"* (both, and Reiss
  runs on through *"Chapter sixteen"*)

- **Open an AI-landscape chapter's subtitle with a rhetorical shopper-voice quote in quotation marks,
  before any data lands, using the same fixed four-part template reworded for the client's product
  category:** (1) a shopper query in quotes, (2) em-dash, (3) the fixed clause *"might be answered from
  training data, a live web crawl, or the Merchant Center feed"*, (4) a closing "the only way to win is
  [rich, accurate, consistent product data]" line. Only the query's subject and light phrasing change.
  *"'My 11-year-old lab is stiff getting up in the morning, what should I give her?' — A query about dog
  joint supplements might be answered from training data, a live web crawl, or your Merchant Center
  feed. The only way to win is to ensure all three pipelines contain rich, accurate, consistent product
  data."* (YuMOVE) · *"'What should I wear to a summer wedding that isn't too formal?' — a query like
  this might be answered from training data, a live web crawl, or the Merchant Center feed. The only way
  to win is rich, accurate, consistent product data across all three."* (Reiss)

- **Don't apply a strict rule about second- vs. third-person address to the client** — verification found
  both decks use "your"/"you" liberally in ordinary body copy (not just rhetorical shopper quotes), right
  alongside third-person-by-name sentences, sometimes in the very same paragraph. Either register is fine;
  match whichever the surrounding paragraph is already using rather than forcing a switch.

- **A card title (`h4` inside `.card`) should state a finding, not label a topic** — a full clause with a
  verb that says what the card found, not what it's about. (One specific phrasing — "The one that ___" —
  appears once in each deck; it's a nice option, not a template to force onto every card.)
  *"6,936 SKUs are live with zero description — and it's not a backlog"* (Reiss)

## Numbers &amp; data presentation

- **Always pair a percentage with its underlying raw count (or vice versa)**, even for a very small or
  very large denominator, so the reader can judge sample size alongside the rate, not just the rate
  alone.
  *"duplicates are now down to 0.1% (4 rows, 2 pairs)"* (Reiss) · *"123 SKUs (0.6%) show a GPC ↔ internal
  category mismatch"* / *"Only 1,058 SKUs (5.5%) carry keyword enrichment"* (Reiss)

- **Flag any number that hasn't been verified against a live audit with the small bordered `?` chk badge
  appended directly to the figure** (`<span class="chk">?</span>`), and say explicitly in the section
  intro that it's an estimate awaiting audit. YuMOVE uses this heavily (7 instances — most of a whole
  scorecard chapter built on plan estimates, explicitly framed as "the first deliverable on the roadmap"
  being an actual audit); Reiss uses it once, more narrowly, to flag a single *inferred* logical claim
  rather than an un-audited stat. Same mechanism, different intensity — reach for it whenever a number in
  the deck hasn't actually been checked against live data yet, not only for whole-chapter estimate blocks.
  *"~30%<span class="chk">?</span>"* / *"Description richness"*, with the chapter intro: *"Estimated from
  the project plan and the Jul-25 deck. An actual Golden Record audit against the live feed is the first
  deliverable on the roadmap."* (YuMOVE)

## Narrative arc

- **Open the hero with a third-party authority quote — Google, not FeedSpark — before any client-specific
  content.** Both decks use the exact same epigraph, word-for-word, right after the hero's h1/client name:
  *"The feed becomes transaction infrastructure - In agentic commerce, a feed error can affect not only
  visibility but also the agent's recommendation, cart logic, displayed total, legal notice and ability to
  complete checkout. Accuracy, identifiers and policy data become commercial controls"* — Google. Reuse
  this exact quote on every new deck; it's a shared, deliberate opening, not something to rewrite per
  client.

- **Write each chapter's subtitle as the specific claim that chapter is about to prove with evidence, not
  a generic label for what the chapter covers.** The reader should know the finding before the first slide
  of data.
  *"179,646 live SKUs, audited directly by FeedHero — the widest, most current data in this deck."*
  (Reiss, the strongest example of this pattern in either deck)

- **Report a weak or negative result alongside the wins, explicitly labelled as such** — don't fold it
  into an aggregate "wins" narrative or leave it out.
  *"EU is the only market where keyword tests trend negative (2 of 6 positive, avg −4.6%/−5.7%), the
  opposite of GB and DE."* (Reiss) · YuMOVE's own test chart plots two real results (+2.15%, +1%)
  honestly in a separate grey "Marginal" tier, distinct from the green "Strong signal" wins above them.

- **Frame urgency/opportunity as a structural, externally-sourced market gap — never as a sales pitch —
  and close the deck itself with a plain "Questions?" plus named contacts, nothing else.** Both decks'
  close footer is structurally identical: eyebrow "Thank you", h2 "Questions?", a contacts block, and
  "FeedSpark · Private &amp; Confidential" — no final recap-of-value or hard-sell slide.
  *"95% of merchants see AI agent traffic on their sites, but only 20% have machine-readable catalogues
  (PayPal, Consensus Miami, May 2026). The gap is the opportunity. Every attribute YuMOVE populates that
  competitors don't is a structural advantage that compounds as AI surfaces grow."* (YuMOVE) — Reiss uses
  the same externally-cited approach elsewhere (a Gartner-sourced search-decline stat), just not this
  identical sentence.

- **A "The through-line" callout, once, near the close of the deck, ties the year's real wins to what's
  being proposed next.** This is a single closing-synthesis callout, not a recurring motif repeated across
  chapters — both decks use it exactly once, right before (or as) the final pitch.
  *"Every win this year — brand in title, benefit copy, spelled-out ingredients, deeper taxonomy — points
  the same direction: fuller, more decomposable data wins. The conversational attributes and Tachyon
  pipeline are the next honest step on that line, not a different strategy."* (YuMOVE) · *"Every verified
  lever this year — de-duplicated titles, the live Keyword Planner tool, 100% image coverage — is the same
  fuller, more decomposable data pattern that Tier 2 and the conversational attributes scale up next. The
  feed audit didn't find a new strategy to pursue; it found exactly how far the current one has reached,
  and where it hasn't yet."* (Reiss)

- **YuMOVE-only, worth adopting on the next deck (Reiss doesn't have this): end the roadmap arc with a
  short, direct, numbered list of decisions the client itself must make to unblock scoped work** — named
  owner, one-line consequence — instead of leaving those items buried only in an internal task table.
  *"Three things we need from YuMOVE"* / *"Each unblocks a workstream that's already scoped and waiting."*
  / *"Sign off the Ingredient Matrix — Simon"* → *"Unblocks the active-ingredient title test and the
  seasonal symptom automation."* (YuMOVE)

## Patterns proven by Reiss's real client feedback — required on every new deck, not optional

Reiss has been live and iterated on through 6 real feedback rounds; YuMOVE's copy is still fresh from its
first delivery and hasn't been pushed on the same way. Everything below is something Ray already asked
for once on Reiss (see `docs/feedback/reiss.md`) — treat it as a checklist for Superdry so he doesn't have
to ask for it again.

- **When two data sources give different numbers for what looks like the same fact, never silently pick
  one.** Name both sources, state both figures, and either explain why they measure different
  populations/definitions, or say plainly that the disagreement itself is the finding. State the
  reconciliation rule once, up front, for the whole deck.
  *"Sixteen sections, four sources: the project plan (what shipped, what's next), a live 4,999-SKU feed
  export analysed directly, FeedHero's own full-catalogue audit of GB/DE/FR, and FeedHero's live per-SKU
  AI flags off today's actual GB feed. Where they disagree, the most direct measurement wins."* ·
  *"Reading three sources together, not picking one... Why GB reads 60,345 here and 19,372 in chapter 08:
  they measure different populations, not different facts. This audit covers the full catalogue; the live
  Shopping feed carries in-stock items only... that only happens if the feed is filtered."*

- **When a plan/log task count and an hours/ticket count both describe "how much work happened," label
  one explicitly as an initiative count and the other as a ticket/hours count so they read as
  complementary granularity, not conflicting totals** — this was a real bug Ray flagged on Reiss (round 1:
  "This section in general is not reflected and actually raises more issue").
  *"469 tasks is the plan's count of tracked initiatives — not the hours behind them. FeedHero's own
  operational time log shows 735 completed tickets and 1,182.25 hours delivered across GB/DE/FR/IE over
  the same window (chapter 01) — a more granular, ticket-level record than the plan's initiative list, not
  a different number for the same thing."*

- **When a completion/pass flag and a stricter quality threshold disagree, headline the stricter number
  and demote the lenient pass-flag into a contrast note or card — never blend or hide the gap.** This is
  the exact bug from Reiss feedback round 1 (a 47.8% "processed" flag headlined next to a note that
  actually described a much lower 6.3% true-completion number) — check every scorecard-style block for
  this before shipping.
  *"FeedHero's Title flag reads 100% pass across all 19,372 SKUs. Measured against FeedSpark's own
  recommended 80–120 character MASK range, only 1.3% of titles actually land inside it — mean length is 53
  characters. Passing FeedHero's check and being AI-ready length are two different bars; this feed clears
  the first and not yet the second."*

- **When a fix or metric is confirmed in one market/segment but not another, state the split explicitly in
  both the status pill and the note — never let a single "Done" imply universal completion.**
  *"Verified working in GB: 0.1% duplicates remain — but FR's live audit (chapter 07) still shows 9%
  duplicate titles, so the fix hasn't fully reached every market yet."* / status pill: *"GB done, FR
  open"*

- **Call out the exception rate hiding underneath an aggregate TRUE/pass flag, don't let the aggregate
  flag stand unqualified** — including when the exception reflects imperfectly on FeedSpark's own prior
  claim in an earlier chapter. Naming that kind of contradiction in a section heading, not smoothing it
  over, is itself part of the house style.
  *"Chapter 07's structured-data readiness table marks name, description, image as TRUE for Reiss'
  schema.org feed — true in aggregate, but 35.8% of live SKUs are the exception underneath that TRUE."*
  (card headed *"Undermines the AI-readiness claim in chapter 07"*)

- **When the deck states a fact that's actually inferred/derived, not read directly from a system, mark it
  with the `?` chk badge and ask explicitly for it to be verified before the deck goes in front of the
  client** — don't present an inference with the same confidence as a directly-sourced figure.
  *"...the filter is inferred from the feed, not read from FeedHero's config."* `<span class="chk">?</span>`
  *"Worth confirming against FeedHero's own export before it goes in front of the client"*

- **Cross-reference the same underlying finding across multiple chapters and count how many independent
  sources corroborate it**, rather than leaving supporting data siloed in the one chapter that first
  surfaced it.
  *"Three independent signals — a task-log gap, an underperforming A/B test, and now a full-catalogue
  content audit — all pointing at the same non-GB markets."*

- **When an identical rate recurs across multiple independently-audited slices (markets, channels,
  brands), state that consistency itself as evidence of one shared structural cause** rather than treating
  each occurrence as a separate local issue.
  *"Confirmed at scale: the live FeedHero audit (chapter 07) shows 'Broken size runs' — this same Item
  Group ID issue — at 43–44% in GB, DE and FR alike. That consistency across three independently-audited
  markets is itself evidence this is one structural NEXT-side issue, not three separate local problems."*
