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

Cover these beats every run: **Google Shopping / Merchant Center · Meta catalog & DPA — and
Muse, Meta's shopping agent · Amazon Ads (AMS) & Seller Central · agentic commerce protocols
(UCP / ACP / MCP) · payments (Stripe, Visa, Mastercard, BNPL) · ChatGPT and Claude commerce moves**.

**A platform's shopping AGENT is always a feed story** (Ray, 28 Sep 2026, on Meta's Muse: "It's
huge, and what to do with it from a feed perspective as well"). When Google, Meta, OpenAI, Amazon
or Anthropic ship or extend an agent that finds and buys products, the item is not "an agent
launched" — it is what the agent READS (which catalogue, which fields), how a retailer gets in
front of it, and which of our clients can act on that this week.

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

The Routine runs as a **cloud session**, and a cloud session pushes freely only to `claude/`-prefixed
branches — a push to `main` is checked and can be refused. For ten days in September 2026 that is
exactly what happened: every run researched, wrote and reported, and the digest never left the
container. So the file travels on its own branch and a workflow lands it. **Never push to `main`
from here.**

```bash
git fetch origin main
git checkout -B claude/news-digest origin/main        # today's branch = latest main + this one file
# … write docs/news_digest.json …
git show origin/main:docs/news_digest.json > /tmp/main_digest.json
node tools/check_news.js docs/news_digest.json --against /tmp/main_digest.json --fresh --offline
node tools/check_markers.js
git add docs/news_digest.json
git commit -m "[News] Digest YYYY-MM-DD"
git push --force -u origin claude/news-digest
```

`tools/check_news.js` is the **same gate the landing workflow runs** (valid JSON, ≤ 8 items, every
`url` https, every `date` inside the 90-day window, `impact` vocabulary, a changed `id`, `generated`
newer than main's) — run it first so a refusal is seen here, not in a log nobody opens. `--offline`
skips the link check because the sandbox may block a site the workflow can reach; the workflow
checks every link for real, and a dead link refuses the digest.

The push starts `.github/workflows/news-digest.yml`, which refuses anything but that one file,
re-runs the gate against main's digest, dry-run-builds the worker, commits the file onto `main` as
`[News] Digest <id>`, dispatches the Deploy workflow and deletes the branch. **The ship signal is
the landing, not the push** — confirm it:

```bash
ID=$(node -p "require('./docs/news_digest.json').id")
for i in $(seq 1 12); do
  sleep 30; git fetch -q origin main
  git log -1 --format=%s origin/main -- docs/news_digest.json | grep -q "\[News\] Digest $ID" && { echo "landed"; break; }
done
```

If it has not landed after six minutes, say so in the report with the `id` and the gate's own output —
do not retry blindly, and do not push to `main` yourself. `bash tools/presync.sh` is not the gate
here: it runs the whole platform's harnesses, and a content-only refresh needs none of them.

## Step 5 — Report

One short paragraph: whether it **landed** (the `[News] Digest <id>` commit on `origin/main`, or
not — with the reason), how many items, the lead story, and anything you deliberately left out and
why. If the day was genuinely quiet, say so plainly — that is a useful signal, not a failure.
