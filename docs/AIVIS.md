# AI visibility — `/aivis`

Ray, 29 Sep 2026: *"lets build 2 AI Surface visibility tracker real-time"* (idea #2 of the five modules
that would make the FCC most competitive).

When a shopper asks an AI answer engine the questions a client's catalogue answers, is the client's
brand named, how early, is its own site cited, and who else is? This page asks, live, and reads every
answer as it arrives.

## Surfaces

Each surface is switched on by its own Worker secret. A surface whose secret is missing is listed as
**not connected** and is never asked.

| Surface | Read through | Model (override var) | Secret |
|---|---|---|---|
| ChatGPT | OpenAI Responses API + `web_search` tool | `gpt-5.5` (`AIVIS_OPENAI_MODEL`) | `OPENAI_API_KEY` |
| Google AI Mode | SerpApi `engine=google_ai_mode` — Google's own page | — | `SERPAPI_KEY` |
| AI Overviews | SerpApi `engine=google` → `ai_overview` (+ the `page_token` follow-up) | — | `SERPAPI_KEY` |
| Perplexity | Agent API `/v1/agent` + `web_search` (Sonar chat completions ended 27 Sep 2026) | `perplexity/sonar` (`AIVIS_PPLX_MODEL`) | `PERPLEXITY_API_KEY` |
| Claude | Messages API, `web_search_20260209` called directly, streamed | `claude-opus-5-5` (`AIVIS_CLAUDE_MODEL`) | `ANTHROPIC_API_KEY` |

Set a secret with `wrangler secret put <NAME>` from the repo root. No redeploy is needed.

Every surface is asked as a shopper in the market's country (the search location, SerpApi `gl`/`hl`)
and is given the date. **ChatGPT's search location falls back to the United States when none is
sent**, so the market's location is always sent.

## How a run works

1. **Questions.** Questions come from the brand's own product-type tree (the PT Guard store,
   `/api/ptypes/snapshot`).
   - The top leaves become shopper phrases, e.g. *"What are the best women's cashmere jumpers to buy
     online in the UK?"*.
   - Every third question asks where to buy.
   - Two **branded** questions close the set: what the brand is known for, and the brand against its
     first competitor.
   - Questions are in English, or in German for DE/AT/CH. Every question is editable in Setup.
2. **⚡ Ask live.** Every enabled question is asked on every connected surface. At most 4 are in
   flight, with at most 2 per surface.
   - Each is one `POST /api/aivis/ask`, which the worker answers as **NDJSON while it happens**:
     `start` → `search` (the query run) → `sources` (results read) → `text` (the answer as it is
     written, streamed on Claude) → `done`.
   - A 10-second heartbeat keeps a whole-answer surface's connection alive.
3. **The grid.** Each cell moves from queued to asking (spinner, the live search) to answered, with a
   verdict of *#2 of 4* / *not named* / *no AI answer* / *failed*.
   - Click a cell to open the answer drawer. On a running cell it shows the answer being written.
4. **Saving.** The run is saved as answers land (at most every 5 seconds, one save at a time), and
   once more when it finishes.
   - **⏹ Stop** keeps the answers already in. A question cut off by Stop is dropped, never saved as a
     failure.

## Reading an answer (`docs/aivis_engine.js`, in the browser)

- **Named / position:** every tracked brand the answer names, in the order it first names them.
  Position is the brand's rank among them.
  - A brand name that is also a common word (Next, Office, Coast) counts only when capitalised.
  - `&` matches "and".
- **Own site:** a cited domain whose registrable label *is* the brand (schuh.co.uk, schuh.ie,
  uk.accessorize.com) is the brand's own site with no setup; so is any domain listed in Setup.
  - ⚡ Match adds the feed's own product host.
  - A site that was **read but not cited** is told apart from one that was cited.
- **Whose site:** every cited domain is one of *own · competitor · retailer / marketplace ·
  publisher / review · forum / social · review site · reference · other*. The lists name only
  multi-brand retailers, publishers and forums; anything else is "other", never guessed into a class.
- **Products:** after ⚡ Match against the feed, a cited product page is matched on its path (with
  tracking parameters stripped). A product named by its title core (brand removed, first three words)
  is matched too.
- **Also named, not tracked:** brand-looking names from bold text and list heads that nobody tracks
  yet. **＋ Track** adds one to share of voice at once.

### The three honesty rules

1. **A branded question never counts toward visibility or share of voice.** "Is Reiss good?" names
   Reiss by construction. It is asked for what the engine says and cites.
2. **A surface that showed no answer is not "not named".** No AI Overview on the page, or a failed
   request, is left out of every rate and counted on its own.
3. **Cost only where the billing is published.**
   - Claude is estimated at list price ($4 / $20 per MTok on Opus 5.5, plus $10 per 1,000 searches).
   - The other surfaces bill on their own plans and show no figure.
   - Before a run of more than 30 answers the page asks first, quoting Claude's planning figure (about
     $0.12 an answer).

**Answers and rates**

- **Visibility** = unbranded answers naming the brand ÷ unbranded answers.
- **Share of voice** = the brand's mentions ÷ every tracked brand's mentions, each brand counted once
  per unbranded answer.
- **Own site cited** = answers citing the brand's site ÷ answers.

## Storage — KV only, nothing in git

| Key | Holds |
|---|---|
| `aiviscfg:<client>` | questions per market, competitors, own domains and aliases (shared with the team) |
| `aivisrun:<client>:<id>` | every answer of one run (text ≤6,000 chars, ≤30 cites, ≤40 results); the run's headline rides the key's **metadata**, so the history lists without reading a value; 400-day TTL |

## Routes

```
GET  /api/aivis                    surfaces (secret NAMES, never values), markets, every brand + its last run
GET  /api/aivis?client=[&market=]  setup + run history + the latest run in full
GET  /api/aivis?client=&run=       one run in full
PUT  /api/aivis?client=            save the setup                               (aivis grant)
PUT  /api/aivis/run?client=        save a run                                   (aivis grant)
DELETE /api/aivis/run?client=&run= remove a run — its author or the owner       (aivis grant)
POST /api/aivis/ask                one question × one surface, streamed NDJSON (aivis grant)
```

Scope: every route uses the same scoping as the other modules (`accessOf` + `clientMatch`).
Asking and saving need the `aivis` module grant, because asking spends money. Meta catalogue markets
(`-fb`) are refused, since they have no shopper question.

## What an API answer is not

Answers through an API are close to, not identical with, what a signed-in shopper sees in each app:
the apps add their own instructions, memory and personalisation. Google AI Mode and AI Overviews are
read from Google's own results page, so they are the closest to what a shopper sees.

## Harness

- `tools/test_aivis.mjs` (node; in qa_gate, presync and validate) covers:
  - the reading engine;
  - each surface adapter against stub responses shaped on the provider's documented payload, including
    a Claude stream with a `pause_turn` sent back unchanged and SerpApi's token-only AI Overview;
  - the `/api/aivis` route lifted out of worker.js and run against a stub KV.
- `tools/check_aivis.js` (Playwright; in presync) drives the real page on the synthetic Northwind book
  of `tools/aivis_stub.js`, with a streaming ask stub. It checks:
  - the grid and KPIs, which must equal an independent count;
  - the drawer, a live run (the concurrency caps, save as answers land), stop, track and match;
  - the 390px sheet.
- `check_mobile` / `check_darkmode` get the same synthetic book.
