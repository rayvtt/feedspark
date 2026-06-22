# FeedSpark — AI Optimisation Proposal Builder

Internal tool for FeedSpark account managers to model and recommend **AI Optimisation** plans
alongside existing client retainers. Single self-contained `index.html` — no build step, no
backend. Open it in a browser; the login password is `a`.

> ⚠️ **Confidential — do not host publicly.**
> This file embeds FeedSpark commercial data (per-SKU AI pricing, ratecard, named clients,
> release volumes). The login is client-side only and visible in source. Keep the repo
> **private** and serve the live site **behind real authentication** (e.g. Cloudflare Access).

## Run locally
Just open `index.html` in any modern browser. Or serve it:
```bash
python3 -m http.server 8080   # then visit http://localhost:8080
```

## What it does
A four-tab workflow: **Brands & Catalogue** → **Current Retainer** (ratecard, scale-down, and a
drag-in task library) → **AI Optimisation** (per-cohort tiers by product Date-of-Birth, run-rate
on new releases, billing) → **Proposal & Recommendation** (Before-vs-Now billing per month/year,
tier options, deliverables). Full model notes are in [`CLAUDE.md`](./CLAUDE.md).

Proposals are saved in the browser's `localStorage` (per browser, not synced, not in the repo).

## Deploy

**Recommended — Cloudflare Pages + Access** (free, auto-deploys on push, real auth gate):
connect the repo in Cloudflare → Pages, framework preset **None**, build output `/`, then put
**Cloudflare Access** in front so only your team can open it.

**GitHub Pages** (via the included Action): in repo **Settings → Pages**, set
**Source: GitHub Actions**. Every push to `main` deploys `index.html` at the site root.
Note: a GitHub Pages URL is reachable by anyone who has it — there is no auth gate, so only use
this if you accept that. Private-repo Pages requires GitHub Pro or above.

## Develop with Claude Code
```bash
cd feedspark-ai-proposal
claude
```
`CLAUDE.md` gives Claude the model, design system, and the QA checklist. Describe a change in
plain English; commit and push; the host redeploys automatically.

## QA before committing
- `node --check` on the embedded `<script>` must pass.
- Every `onclick/onchange/...` handler is a defined function; every `getElementById` id exists.
- Spot-check defaults: retainer 59h → 29h (£4,314 → £2,121/mo), AI catalogue one-off ~£9,474,
  run-rate ~£1,225/mo at Advanced.

## Tech
Vanilla HTML/CSS/JS, single file. Only external dependency is Chart.js (CDN). Design system:
navy `#1a365d`, blue `#2563eb`, orange `#F5A623` / `#ED6F0B`.
