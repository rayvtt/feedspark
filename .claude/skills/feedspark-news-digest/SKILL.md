---
name: feedspark-news-digest
description: Researches the day's genuinely material updates across Google Shopping/Merchant Center, Meta commerce, Amazon Ads, agentic-commerce protocols and payments (plus OpenAI/ChatGPT and Anthropic/Claude commerce moves), then rewrites docs/news_digest.json and ships it so the FCC pops the digest to AMs. Use when the daily news Routine fires, when Ray asks to "run the news digest", "refresh the FCC news", "what changed in the industry today", or when a digest needs correcting or re-issuing.
---

# FeedSpark industry news digest

Regenerates `docs/news_digest.json`, which the Command Center fetches from `/api/news` and
pops to the AM once per digest `id`. This file is the **only** thing this skill writes —
never touch other files while running it, because several other sessions are usually mid-flight
in this repo.

## Why this exists

AMs were finding out about platform changes from clients. The digest puts the day's material
changes in front of them when they open the FCC, with the "so what for us" already written —
so it survives being skimmed in ten seconds.

The bar is **material change**, not coverage. A quiet day ships three items. Padding a slow day
with filler is how a newsletter gets ignored — and once AMs learn to dismiss it unread, the
feature is dead. Ship short instead.

## Step 1 — Research

Work the source list below. Prioritise primary/official sources; use trade press to *catch*
things, then follow through to the primary source for the link where one exists.

**Official / primary**
1. Google Merchant Center announcements changelog — https://support.google.com/merchants/announcements/6192467
2. Merchant API latest updates — https://developers.google.com/merchant/api/latest-updates
3. Google Ads & Commerce blog — https://blog.google/products/ads-commerce/
4. Google Search Central blog — https://developers.google.com/search/blog
5. Meta for Developers changelog — https://developers.facebook.com/docs/graph-api/changelog
6. Amazon Ads news — https://advertising.amazon.com/library/news
7. OpenAI news — https://openai.com/news
8. Anthropic news — https://www.anthropic.com/news
9. Stripe newsroom + agentic commerce docs — https://stripe.com/newsroom · https://docs.stripe.com/agentic-commerce
10. Shopify changelog — https://changelog.shopify.com

**Trade press (for detection and context)**
11. Search Engine Land — product feed: https://searchengineland.com/topic/product-feed · Shopping: https://searchengineland.com/library/platforms/google/google-ads/google-shopping
12. Search Engine Roundtable — https://www.seroundtable.com (fastest on GMC/feed incidents)
13. PYMNTS — https://www.pymnts.com (payments + agentic commerce)
14. Search Engine Journal ecommerce — https://www.searchenginejournal.com

Cover these beats every run: **Google Shopping / Merchant Center · Meta catalog & DPA ·
Amazon Ads (AMS) & Seller Central · agentic commerce protocols (UCP / ACP / MCP) · payments
(Stripe, Visa, Mastercard, BNPL) · ChatGPT and Claude commerce moves**.

## Step 2 — Filter

Keep an item only if an AM could act on it or a client could raise it. Drop vendor marketing,
listicles, "X predictions for next year", and anything already carried in a previous digest
(read the existing `docs/news_digest.json` first and dedupe against it).

**Nothing older than three months** (Ray's rule, 18 Sep 2026). Check every item's own publication
or effective date against today minus 90 days and drop it if it falls outside, however important it
still seems — something that mattered and is older than that has either been carried already or
belongs in a briefing, not a daily digest. Two corollaries worth stating, because the first edition
broke both:

- **Evergreen documentation guidance is not news.** If a page has no date of its own, it does not
  go in. Stamping today's date on a platform's standing advice to make it qualify is the same
  dishonesty as inventing a figure.
- **Date the item, not the day you found it.** A March announcement rediscovered in September is a
  March item, and it fails the bar.

Rank by what it does to *our* work, not by how big the headline is:
- `high` — something is breaking, a deadline has passed or is imminent, or it changes what we sell
- `med` — changes how we execute, or what we say to clients
- `watch` — directional; useful in a QBR or a pitch, no action this week

Cap at **8 items**. If more than 8 clear the bar, the weakest ones were not `high`.

## Step 3 — Write it

Rewrite `docs/news_digest.json` whole. Schema:

```json
{
  "_comment": "keep the existing comment line",
  "id": "YYYY-MM-DD",
  "generated": "<ISO timestamp>",
  "headline": "the single most important thing, in plain words",
  "intro": "one sentence framing the edition (optional, omit on routine days)",
  "items": [{
    "title": "…", "source": "…", "url": "https://…", "date": "YYYY-MM-DD",
    "impact": "high|med|watch", "tags": ["Google","Feed pipeline"],
    "what": "1–2 sentences: what actually changed",
    "sowhat": "1–2 sentences: what it means for FeedSpark or a named client. This is the whole point of the digest."
  }]
}
```

Rules that matter:
- **`id` must change** when there is new content — it is what re-prompts every AM. Same-day
  correction: use `YYYY-MM-DD-2`.
- **Every item needs a real, reachable `https://` URL.** No invented links, ever.
- **Never invent or estimate a figure.** If a number is only in secondary coverage, either
  attribute it in the text or leave it out. An AM may quote this to a client.
- `sowhat` names a client or a workstream wherever it honestly can (see CLAUDE.md for the live
  account list). Generic "brands should prepare for AI" lines are worse than no item.
- Keep the whole file under ~200 lines. This is a pop-up, not a report.

## Step 4 — Ship it

```bash
bash tools/presync.sh          # merges latest main, dry-run build, inline-script + marker checks
```

`news_digest.json` is bundled into the worker as a Text module, so **malformed JSON breaks the
build** — presync's dry-run is what catches that. Do not skip it, and do not push on a red run.

Then commit and push straight to `main` (`docs/news_digest.json` is touched by nothing else, so
there is no clobber risk and no PR is needed for a content-only refresh):

```bash
git add docs/news_digest.json
git commit -m "[News] Digest YYYY-MM-DD"
git push -u origin main
```

Push to `main` triggers the Deploy Action. Then verify it actually went live per CLAUDE.md's
rule — a green Deploy run plus the worker's Cloudflare `modified_on` advancing. Do not report
the digest as shipped on the strength of a push alone.

If `main` has moved under you, rebase and re-run presync rather than force-anything.

## Step 5 — Report

One short paragraph: how many items, the lead story, and anything you deliberately left out and
why. If the day was genuinely quiet, say so plainly — that is a useful signal, not a failure.
