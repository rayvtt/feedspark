# FeedSpark — Chat History Digest

All conversations from the Claude Chat project, chronologically. Each entry captures what was built, key decisions made, and learnings for future work.

---

## 1. Schuh — AI Readiness Scorecard (May 2026)

**Built:** 10-slide PPTX — AI readiness audit for Schuh's Google Shopping feed across EN/DE markets.

**Key outputs:**
- Six-dimension scoring: attribute completeness, title quality, description richness, image coverage, structured data, conversational readiness
- Converse Chuck Taylor All Star Hi as worked example (Product ID 1924667070)
- Golden Record slide with percentage scores per attribute
- Google's conversational attributes added as slide 10 (six-card grid)
- Description dimension separated into Tachyon AI-branded slide with four-section RAG rating

**Learnings:**
- Schuh site is Cloudflare-protected — can't fetch product images directly
- Nike open CDN works for standard Converse catalogue shots
- Use `pdftoppm -f N -l N` for single-slide QA instead of full deck render
- Unused image relationships in slide `.rels` files are harmless

---

## 2. Schuh — Onboarding Deck (May 2026)

**Built:** 12-slide PPTX — onboarding pack for the Schuh account.

**Key outputs:**
- Technical implementation flow, monthly service table (UK/IE/DE, 46hrs)
- Ways of working, reporting protocols, task prioritisation
- Current project plan pulled live from Google Sheet
- A/B testing results summary

**Data source:** Google Sheet `1rbr8FwZagdZdctR_fNesixm4-uDWG1VJPnBCJBdjSxc`

---

## 3. ELC — Competitive Defence vs Intelligent Reach (June 2026)

**Built:** 5-slide PPTX + 2 email variants defending FeedSpark's position against Intelligent Reach.

**Key outputs:**
- 5-year compounding timeline slide
- Fully managed partnership matrix (per-brand service table from Google Sheet)
- A/B test learning library (including negative learnings)
- Platform vs Partnership comparison (green ✓ vs red ✗)
- Two email variants to Jessica Olivia

**Data source:** Google Sheet `1KWrB4IpHGRUnlhVjWP4hpyhpBGs5c-JM_cBa7mj6J0Y` (gid=1574286896)

**Decision:** Cost-of-switching slide quantifies re-onboarding in hours and revenue regression.

---

## 4. ELC — Retention Defence Deck (June 2026)

**Built:** 10-slide PPTX — "what you'd be giving up" positioning.

**Key outputs:**
- Five-year infrastructure stack across 14 brands
- Bespoke title masks and undocumented keyword franchise maps
- A/B learning library with positive wins and negative learnings
- Three critical real-time operational dependencies
- Automation engine documentation
- Interconnected dependency web diagram
- Scale-back off-ramp (By Kilian and Frédéric Malle precedent)
- Two standalone pricing slides: self-managed £498/pcm, DPA overlay £300/pcm

**Decision:** Ray confirmed deck was good. Discount ladder (10/20/30% at 5+/10+/15+ brands) is proposed, not sourced — Ray to confirm.

---

## 5. ELC — Parting Gift Web App (June 2026)

**Built:** Gated HTML web app documenting 30+ feed issues across ELC's portfolio.

**Key outputs:**
- Entry-code gate (ELC2026, ESTEELAUDER, FEEDSPARK)
- Google-style search bar with animated FeedSpark rocket
- Three area-selector cards: Technical, Optimisation, Account Management
- 33 total issues with RAG severity system
- Six conversational AI attributes badged "NEW · GOOGLE AI"
- Win-back upsell section with real competitor quote

**Decision:** Three additional Technical issues added (product launch delays, Meta pixel variant ID mismatches, UK virtual gift sets). Duplicate request detected and blocked.

---

## 6. Monsoon — Overlay Debugging Communications (June 2026)

**Built:** Three email draft iterations explaining why the Dress overlay stopped rendering.

**Root cause:** Monsoon's image_link and image_link_1 URLs keep changing, wiping image type classification that the Dress overlay rule depends on.

**Solution proposed:** Remap overlay logic to trigger off any URL in image_link/image_link_1 directly, removing image type dependency.

**Learning:** Always offer two variants — fuller contextual version and shorter direct one — for Ray to choose.

---

## 7. Monsoon — AI Optimisation Pricing Tool (June 2026)

**Built:** Self-contained HTML web app for proposing and pricing AI Optimisation.

**Key features:**
- Login gate, dashboard of proposals, 4-tab editor, localStorage persistence, Chart.js
- AI tier pricing: Basic £0.10, Standard £0.50, Advanced £1.00 per SKU
- Product release velocity from DoB (Date-of-Birth) data
- Draggable task library of 51 retainer scope tasks
- Per-cohort AI tier assignment (0–3 / 3–6 / 6–12 / 12+ months)
- Before vs Now billing comparison (combined 59h retainer vs hours + AI recurring)

**Decision:** AI introduction should scale the retainer DOWN (AI absorbs in-house testing/content work).

**Repo prepared:** index.html, CLAUDE.md, README.md, .gitignore, GitHub Actions deploy workflow.

**Security flag:** Client-side login is not real security. Cloudflare Pages + Access recommended over public GitHub Pages.

---

## 8. YuMOVE — AI Testing Proposal Email (June 2026)

**Built:** Two email variants replying to YuMOVE's four questions post-demo.

**Key distinctions flagged:**
- Conversational attributes ≠ GPC mapping — separate concepts, should not be conflated
- The linked Google support page (answer/17085370) covers conversational attributes, not GPC
- POC fee left as placeholder for Ray to decide

**Decision:** Don't send the conversational attributes link in response to GPC question — would muddy the answer.

---

## 9. Monsoon — Duplicate Email (June 2026)

Duplicate of conversation #8 (YuMOVE email). Identified and flagged.

---

## 10. Meta Commerce Manager — International Catalogue Deck (June 2026)

**Built:** 6-slide PPTX on Meta's international catalogue architecture.

**Key content:**
- Single main catalogue with country/language feed overrides
- Country feeds as supplementary overrides matched by product ID
- Which fields can be overridden
- Commerce Manager setup steps
- Benefits and watch-outs

**Learning:** Ray corrected initial misframe (Claude included Google AI content alongside Meta). The subject is international catalogue setup, not AI. Source from Meta's actual help pages, not assumptions.

---

## 11. Reiss — Local Language Case Study (July 2026)

**Built:** 5-slide PPTX — standalone case study for LL vs EN Shopping campaigns.

**Key outputs:**
- 16 EU/ME markets performance data
- 11/16 markets showing stronger LL traffic
- 10/16 generating majority revenue via LL
- NPV vs 1.5x target combo chart
- Recommendation to pause DK, SE, SA
- Cost efficiency comparison (FR, IT, DE)

**Decision:** Strip internal jargon (period codes, source citations) — this is a standalone case study for client audiences, not a review of source material.

**Flag:** Absolute revenue figures appropriate for internal use; replace with ratio-based stats before repurposing for pitching other clients.

---

## 12. YuMOVE — Strategy Review Jul 2026 (current)

**Built:** HTML landing page — 7-chapter strategy review + 14-test matrix.

**Key content:**
- Chapters: Scope → Work Review → Automation → AI Landscape → Tachyon → Conversational Attributes → Roadmap
- Visualised A/B test results (8 tests, bar chart)
- Three data pipelines (Google Gemini, ChatGPT Shopping, Perplexity)
- Three agentic protocols (UCP, MCP, ACP)
- AI citation evidence (35% more clicks for cited brands, 83% ChatGPT-Shopping Graph overlap)
- Six testable theories on attribute impact
- Interactive panel: dog-owner questions → conversational attribute mapping
- AI Readiness Scorecard (6-cell grid with data-check flags)
- 14-test matrix for Q3/Q4
- Inline edit + JSON patch sync system

**Parked edits (awaiting Ray's edited HTML):**
- Stat 5 correction: "15m" → "15-min feed refresh" or "20% feed retrieval share"
- Source footnote line for all five stats
- Delete the "practical point for YuMOVE" note below three pipeline cards

**Infrastructure:**
- KV namespace `FEEDSPARK_DECK_EDITS` created (id: `d93b5ac576c74f0d8a315c5b92dc8e16`)
- Worker code written, needs deployment via wrangler
