# FeedSpark — Claude Code Project

Feed optimisation strategy, client decks, and tooling for FeedSpark (Dentsu network).

## Structure

```
CLAUDE.md                          ← Master context file (Claude Code reads this)
docs/
  CHAT_HISTORY.md                  ← All 12 historic chat conversations digested
  FeedSpark_Deck_LiveEdit_Feature.md ← Spec for the inline edit system
  YuMOVE_Strategy_Review_Jul26.html  ← Current WIP deck
cloudflare/
  feedspark-deck/                  ← Cloudflare Worker for live deck hosting
    wrangler.toml
    src/worker.js
reference-files/                   ← Source PDFs and templates (design system, client decks)
```

## Setup

### Deploy the Cloudflare Worker
```bash
cd cloudflare/feedspark-deck
npx wrangler deploy
```

This creates `feedspark-deck.<subdomain>.workers.dev` with:
- KV-backed edit persistence (auto-saves every 5s)
- Template push API (`PUT /api/template`)
- Edit sync API (`GET/PUT/DELETE /api/edits`)

### Add Cloudflare Access
Gate the worker URL behind email-based access to protect commercial data.

## Clients

| Client | Market | Key deliverables |
|---|---|---|
| Schuh | UK/DE | AI Readiness Scorecard, onboarding deck |
| ELC | Global (14 brands) | Retention defence, parting gift app |
| Monsoon/Accessorize | UK | Overlay debugging, AI pricing tool |
| YuMOVE | UK | Strategy review (in progress), POC scoping |
| Reiss | 29 markets | Q2-Q3 strategy review, LL case study |
| Superdry | UK | Service review |

## Design system

All materials follow the Reiss-Dentsu design system. See `CLAUDE.md` for the full spec. Key constraints: Lato font, orange `#F5A623`, no FeedSpark logo, no decorative lines.
