# FeedSpark — Claude Code Project

## Who is Ray

Ray works at FeedSpark, a feed optimisation agency within the Dentsu network. Senior client-facing role spanning account management, commercial strategy, and business development. Manages enterprise-level product feed programmes and builds client-facing proposals, retention materials, and strategy decks. Positions FeedSpark's proprietary tooling (Tachyon AI, FeedHero) in competitive situations.

Ray's communication style is terse and iterative — short corrections with an expectation that Claude infers the full implication and rebuilds accordingly. He frames outputs at "Chief of Pricing / Sales Director" standard, expecting client-ready deliverables rather than rough drafts.

---

## FeedSpark service framework

Core: Google Shopping feed optimisation across titles, descriptions, attributes, product highlights, and structured data. AI capabilities (Tachyon AI) as a key differentiator.

Adjacent services: DPA creative, scraping, PPC overlays, Meta Commerce Manager feed architecture, custom labels, image cycling.

Proprietary tools:
- **Tachyon AI** — LLM-powered intent generation, description enrichment, visual attribute harvest from product imagery
- **FeedHero** — Feed management platform for rules, alerts, custom labels, keyword injection, A/B testing

---

## Active client accounts

### Schuh
- UK footwear retailer, EN/DE markets
- AI Readiness Scorecard delivered (10-slide deck)
- Converse Chuck Taylor as worked example product
- Onboarding deck delivered (12 slides, 46 total hours across UK/IE/DE)
- Google Sheets project plan: `1rbr8FwZagdZdctR_fNesixm4-uDWG1VJPnBCJBdjSxc`
- Team: schuh@feedspark.com, Ray, Steven, Venki, Dino, Mike, Gary, Adriana, Mo, Isa, Matt, Will

### Estée Lauder Companies (ELC)
- Multi-brand luxury beauty portfolio, 14+ brands across 5 fiscal cycles
- Account at risk — retention work completed (defence deck, parting gift web app)
- 30+ feed issues documented across Technical/Optimisation/Account Management
- Google's conversational AI attributes positioned as differentiator
- Google Sheets project plan: `1KWrB4IpHGRUnlhVjWP4hpyhpBGs5c-JM_cBa7mj6J0Y` (gid=1574286896)
- Contacts: Jessica Olivia, Cox Tara, Alexandra Perez, Carman Wong, Aysia Bailey
- Pricing: self-managed £498/pcm per brand; DPA/PPC overlay £300/pcm base

### Monsoon / Accessorize
- Two brands under one account
- Monsoon: 12,314 SKUs, 32hr retainer
- Accessorize: 5,414 SKUs, 27hr retainer
- Ratecard: £585+VAT per 8-hour block (£73.125/hr)
- AI Optimisation pricing tool built (HTML web app with retainer comparison, per-cohort AI tier assignment, task library)
- Dress overlay debugging: image_link URL rotation wiping image type tags
- Deployment target: Cloudflare Pages + Access (confidential commercial data)

### YuMOVE (Lintbells)
- Pet supplements, UK market
- Google Shopping + Meta, 2 active channels
- 24hrs scheduled + 21hrs ad-hoc per month
- Strategy Review Jul 2026 deck (HTML landing page) — in progress
- Key tests completed: brand inclusion wins, benefit copy +24.7%, "Multivitamins" +126.62%, health conditions +30%
- POC scoping: test SKUs, timeline, success metrics, sign-off flow
- Google Sheets project plan: `1RMTN99Cw0J3l5mORwYPpITnoi5HCPt7tET4u8rQbsq0` (gid=841484251)
- Contacts: Simon (YuMOVE), Becca (bundles), Kinase (agency)

### Reiss
- UK fashion retailer, 29 markets, 60 feeds
- Q2→Q3 2026 Strategy Review delivered (23-slide deck)
- AI Readiness: Tier 1 (titles & data fields), climbing to Tier 2
- Golden Record Scorecard: 88.6% attribute completeness
- Tachyon pipeline live: intent generation → Shopping Graph matching → roundel overlay
- Local Language case study: 16 EU/ME markets, LL vs EN Shopping campaigns

### Superdry
- Service review deck (SharePoint): `ms-powerpoint:ofe|u|https://aroxo-my.sharepoint.com/personal/ray_aroxo_onmicrosoft_com/Documents/Superdry%20X%20FeedSpark%20Service%20Review%20V2.pptx`

---

## Design system (all FeedSpark materials)

Source: Reiss–Dentsu introduction PDF (Mar 2026). This is the governing design reference — only use elements, colours, and fonts from this PDF.

- **Colours:** Orange `#F5A623` (primary), deep orange `#ED6F0B`, charcoal `#333333` (body text), white `#FFFFFF` backgrounds, light grey `#F5F5F5` / `#F7F7F5` card backgrounds
- **Typography:** Lato (Google Fonts)
- **Cards:** White with `#E6E6E6` borders and drop shadows
- **Footer:** "FeedSpark · Private & Confidential" left-aligned, page number right-aligned
- **Prohibited:** No FeedSpark logo, no page number circles, no random decorative lines in slide bodies. Orange accents only where purposeful. Clean white backgrounds throughout.

---

## Build pipelines

### PPTX (pptxgenjs)
```bash
export NODE_PATH=$(npm root -g)
node build.js
python /path/to/rezip.py output.pptx
python /path/to/soffice.py --headless --convert-to pdf output.pptx
pdftoppm -jpeg -r 130 output.pdf slide  # full deck QA
pdftoppm -jpeg -r 130 -f 4 -l 4 output.pdf slide  # single slide QA
```

> ⚠️ **In Claude Code (web/cloud), LibreOffice (`soffice`) and `pdftoppm` are UNAVAILABLE** — the
> pipeline above only runs where those binaries exist. In Code, build decks with **`python-pptx`**
> and QA them with the bundled Pillow previewer (renders `.pptx` → PNG, flags text overflow):
> ```bash
> python tools/preview_tmpl.py deck.pptx /tmp/qa   # -> /tmp/qa_1.png, _2.png, ...
> ```
> Full pipeline + gotchas: [`tools/README.md`](./tools/README.md).

Key gotchas:
- Shadow objects need a factory function (`makeShadow`) to avoid mutation
- Smart quotes in XML stored as hex entities (`&#x201C;` / `&#x201D;`) — use encoded form in replacements
- Icons: `react-icons/fa` rasterised to PNG via `sharp` + `ReactDOMServer`, passed as base64 data URIs
- `pres.layout` must be set before adding slides (default is 10" × 5.625")
- Hex colors: never `#`, never 8 digits

### PPTX (XML editing)
```bash
python unpack.py input.pptx unpacked/
# Edit XML files
python pack.py unpacked/ output.pptx
```
- Slide order: controlled by `<p:sldIdLst>` in `ppt/presentation.xml` (not filename)
- Inserting a slide requires: new XML + `[Content_Types].xml` Override + `ppt/_rels/presentation.xml.rels` Relationship + `<p:sldId>` entry
- Source files with `.pdf` extension may be zip-packaged exports — use `unzip` not PDF parsers

### HTML decks
All HTML strategy decks include the inline edit + JSON patch sync system:
- Edit mode toggle, export/import edits, download clean HTML, data-check flags
- See `docs/FeedSpark_Deck_LiveEdit_Feature.md` for full spec
- **Parallel editing** (Ray edits copy live; Claude Code edits structure): `docs/WAYS_OF_WORKING.md`.
  Merge exported edit patches onto a template with `tools/apply_edits.py`; live host = `cloudflare/feedspark-deck/`
- Cloudflare Pages + Access for confidential commercial data (not public GitHub Pages)

### Google Drive
- Use file ID (alphanumeric string between `/d/` and `/edit`) for API calls
- Read with `Google Drive:read_file_content` using the raw file ID

---

## Email drafting rules

- Always offer two tone variants: confident/direct vs collaborative/consultative
- Flag technical distinctions proactively before drafting (e.g. conversational attributes vs GPC mapping are separate concepts)
- Source info from authoritative platform docs (Meta Business Help Center, Google Merchant Center) — not from memory
- Defer to Ray on commercial variables (POC fees, pricing) — flag items for him to confirm, don't invent figures

---

## Cloudflare infrastructure

### FeedSpark-specific (do NOT use NAC resources)
- KV namespace: `FEEDSPARK_DECK_EDITS` (id: `d93b5ac576c74f0d8a315c5b92dc8e16`)
- Worker: `feedspark` (dir `cloudflare/feedspark-deck/`) at `feedspark.ray-vtt.workers.dev` — the command center (landing hub at `/` + strategy decks at `/deck/<slug>`) with live-edit KV persistence
- Requires Cloudflare Access gating for commercial data

### Worker API (multi-page command center)
```
GET  /                          → command center landing page (git-bundled + injected editor)
GET  /deck/yumove               → YuMOVE strategy deck (git-bundled + injected editor)
GET  /api/edits?page=<slug>     → return a page's saved edits as JSON
PUT  /api/edits?page=<slug>     → save an edit patch (merges with existing)
DELETE /api/edits?page=<slug>   → clear a page's saved edits
GET  /api/template              → info only; pages are git-bundled (push to main to change them)
```
- **Pages = git**: `docs/FeedSpark_Command_Center.html` (`/`) and `docs/YuMOVE_Strategy_Review_Jul26.html`
  (`/deck/yumove`) are imported into the worker as Text modules (root `wrangler.toml` `rules`).
  **Add a page = add an import + one line in the worker's `PAGES` map.** Push to `main` → Cloudflare
  rebuilds → live. No `PUT /api/template`. `wrangler.toml` lives at the **repo root** (deploy from root).
  KV edits are namespaced per page (`edits:<slug>`), so pages never collide.

---

## Key technical concepts

- **Conversational attributes** (Google, 2026): question_and_answer, document_link, related_product, item_group_title, variant_option, popularity_rank — submitted via supplemental data source
- **AI-Ready Feeds**: FeedSpark framework for preparing product data for agentic commerce (ChatGPT Shopping, Perplexity, Google AI Mode)
- **Agentic commerce protocols**: UCP (Google), MCP (Anthropic/Shopify), ACP (OpenAI/ChatGPT)
- **Golden Record**: 99.9% attribute completeness target across all feed dimensions
- **MASK structuring**: Title format — Brand + Material + Fit + Colour + Use-case (80-120 chars)
- **GPC**: Google Product Category — fixed taxonomy, not generated by AI
