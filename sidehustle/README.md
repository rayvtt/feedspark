# Side Hustle — Decision Doc v1

**Objective:** a side income that *compounds with Claude's capability curve* — every model upgrade should raise output quality or margin with zero extra hours from Ray. Ray is the brand, QA and sales layer; Claude is the production engine.

**Filter applied to every idea:** (1) Does AI getting better make this *stronger*, not obsolete? (2) Does it monetise skills Ray already has at "Chief of Pricing" standard? (3) Does it avoid a head-on collision with FeedSpark/Dentsu?

---

## ⚠️ Gate zero — before anything is sold

Ray is client-facing at a Dentsu-network agency. Standard Dentsu-style contracts contain **moonlighting, non-compete and IP-assignment clauses**. Two hard rules until the contract is checked (or written clearance obtained):

1. **Nothing retailer-facing in feed optimisation.** Selling feed audits, feed fixes, or "AI-ready feed" services to *any* retailer — however small — is competing in kind with the employer. That includes reusing Feed Lab / FCC code: it was built in the context of FeedSpark work and is arguably employer IP.
2. **Everything below assumes a different buyer or a different product.** The shortlist is ranked partly on conflict risk for exactly this reason.

Action for Ray (30 min, human-only): re-read the employment contract's outside-work + IP clauses. If ambiguous, a one-line email to HR asking about "writing/consulting outside the ad-tech client space" settles it cheaply.

---

## Shortlist — scored

Scoring 1–5. **Speed** = time to first £. **Ceiling** = realistic 18-month monthly revenue. **AI-leverage** = how much of the work Claude does today, and how directly model upgrades raise quality/margin. **Conflict** = 5 is safest.

| # | Idea | Buyer | Speed | Ceiling | AI-leverage | Conflict | Verdict |
|---|------|-------|-------|---------|-------------|----------|---------|
| 1 | **Deck-as-a-service** — brief in, client-ready strategy/pitch deck out in 24–48h | Freelance consultants, fractional execs, small agencies | 5 | 3 (£2–4k/mo) | 5 | 4 | ✅ **Cash engine — start here** |
| 2 | **Agentic-commerce newsletter** — "what ChatGPT Shopping / Google AI Mode / UCP-ACP-MCP mean for ecommerce", weekly | Ecommerce operators, PPC folk | 2 | 3 (£1–3k/mo sponsors + paid tier) | 4 | 5 | ✅ **Compounding asset — start in parallel** |
| 3 | Practitioner toolkit — pricing calculators, audit checklists, proposal templates sold on Gumroad | Freelance feed/PPC specialists | 3 | 2 (£500–1.5k/mo) | 4 | 3 | ⏸ Later — natural upsell once #2 has an audience; needs clean-room rebuilds, no FeedSpark work product |
| 4 | Self-serve feed AI-readiness audit SaaS | SMB retailers | 2 | 5 (£10k+/mo) | 5 | **1** | ❌ Best pure business, worst conflict. Parked unless Ray ever leaves — then it's the obvious play |
| 5 | Shopify app — conversational attributes / Q&A generator | SMB retailers | 1 | 4 | 5 | 1 | ❌ Same conflict + app-store review overhead |
| 6 | Micro-consulting calls (Intro.co / Clarity-style) on feed strategy | Startups, VCs doing diligence | 4 | 2 | 2 | 2 | ❌ Sells hours (doesn't scale with the model) and sells the employer's exact expertise |

---

## Recommendation — two-track

### Track 1 · Cash engine: **DeckSmith** (working name) — productised deck service

**The pitch:** *"Send a bullet-point brief. Get back a polished, branded, client-ready deck in 48 hours. £195 flat."* Fixed price, fixed turnaround, no meetings.

**Why this one:**
- It is literally the pipeline this repo already proves out — brief → structured outline → on-brand HTML/PPTX with QA rendering — pointed at a *non-competing* buyer. Consultants and freelancers routinely pay £150–500 or burn a weekend making mediocre slides.
- **Purest AI-leverage on the list.** Today Claude does ~80% of the production (structure, copy, layout, build, QA render); Ray does taste, brand-matching and dispatch — call it 45–60 min per deck. Every model generation shrinks Ray's minutes per deck. That *is* "a hustle that keeps up with my evolution": the margin expands as I improve, without Ray adding hours.
- Buyer is other B2B service people, not retailers — no client overlap with FeedSpark. The skill (making decks fast) is generic; no FeedSpark code or client material gets reused. Build the delivery pipeline fresh in a separate private repo.
- First revenue is realistically **inside 2–3 weeks**, which matters: a side hustle that pays early survives; one that doesn't gets abandoned.

**Unit economics:** £195/deck, ~45–60 min of Ray-time → effective £200–260/hr, ~10x his FeedSpark ratecard-equivalent. 4 decks/mo = £780; 15/mo ≈ £2,900 and roughly a Saturday morning of actual Ray-hours. Add a £395 "deck + 30-min walkthrough" tier for the ~20% who want a human.

**Risks, honestly:** it's a crowded-looking space (Canva, "AI deck" tools) — the differentiator is *finished, taste-checked, brand-matched* output, not a template engine; that's exactly the gap the AI tools leave. Ceiling is capped by positioning (~£3–4k/mo) unless it moves upmarket. Fine — that's what Track 2 is for.

### Track 2 · Compounding asset: **the agentic-commerce newsletter**

Weekly, short, opinionated: what UCP/ACP/MCP, ChatGPT Shopping, Perplexity and Google AI Mode actually mean for people who sell things online. Ray already does this research *as his job* — the marginal cost of publishing the non-confidential layer of it is one hour a week, and Claude drafts from his bullet notes.

- **Zero conflict — arguably career-positive.** Thought leadership in the employer's space is the one side project agencies tend to like. (Still disclose it; it makes gate zero easier, not harder.)
- Slow money (sponsors + paid tier at ~5k subscribers, 6–12 months out) but it compounds: it becomes the distribution channel for idea #3, the credibility layer for everything, and — if Ray ever leaves — the launch audience for idea #4, the real business on this list.
- AI-leverage grows every cycle: research sweeps, draft, edit-to-voice are already Claude-native tasks.

**Why both:** Track 1 pays this quarter and proves the "Claude as production engine" model with real customers. Track 2 is the asset that's worth something in two years. One without the other is either a treadmill or a hobby.

---

## 30-day launch plan (Track 1, with Track 2 riding along)

| Week | Claude builds (in-session) | Ray does (human-only, ~2–3 h/wk) |
|------|---------------------------|----------------------------------|
| 1 | Landing page (offer, 3 sample decks, Stripe payment link, brief-intake form) in a **new private repo** on its own Cloudflare account — clean IP separation from this repo. Three portfolio decks in distinct visual styles on fictional companies. | Contract check (gate zero). Pick the name, buy the domain (~£10). Approve samples. |
| 2 | Delivery pipeline: brief → outline → deck → QA render → PDF/PPTX handoff, templated per brand kit. Newsletter issue #1 drafted from Ray's notes. | Soft launch: one LinkedIn post + 10 DMs to freelance consultants/agency friends. **Goal: 2 paid decks, even discounted — the point is testing turnaround for real.** Publish issue #1. |
| 3 | Turn week-2 friction into automation: intake form → structured brief, brand-kit capture, revision-round flow (one round included, £45 after). | Deliver, collect testimonials, iterate offer/pricing on real signal. Issue #2. |
| 4 | Simple ops dashboard (orders, status, revenue). Draft the month-2 plan from actual numbers. | Decide from data: raise price, keep pushing, or kill. **Kill criterion, agreed now: fewer than 3 paid decks by day 30 → stop, fold effort into Track 2, re-rank the list.** Issue #3. |

Total cash at risk: ~£30 (domain + Stripe fees). Total Ray-hours: ~10 over the month.

---

## What "keeps up with Claude's growth" means here, concretely

- **Today:** Claude drafts and builds; Ray reviews everything before it ships. ~1 Ray-hour per deck, per issue.
- **Each model upgrade:** the review pass shrinks; the tail work (brand-kit ingestion, revision handling, ops) moves from Ray to sessions/Routines. Margin widens with no new hours.
- **The test I'd hold us to:** if a Claude upgrade doesn't visibly cut Ray-minutes-per-unit or lift output quality within a month of release, the hustle is mis-designed — revisit this doc.

---

## Decision needed from Ray

1. Gate zero: contract check — go/no-go on selling anything at all.
2. Track 1 name + domain (I'll shortlist names on request).
3. Green-light week 1 → I build the landing page, samples and pipeline in the next session.

*v1 — 2 Aug 2026. Terse corrections welcome; I'll rebuild accordingly.*
