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
- Strategy Review Jul 2026 deck — delivered, **client-approved (raving reviews)**; now the **master Strategy Review deck template** (clone per client). Live at `/deck/yumove`.
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
- **Client decks (.pptx)** follow the **core deck template** instead:
  `reference-files/deck-templates/FeedSpark_Core_Deck_Template.pptx` (Inter; slate `#0F172A`;
  orange `#F7941E`; 18 named layouts) — see "Client decks" below.

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

### Client decks — .pptx ONLY (Aug 2026)
**Every new client deck ships as PowerPoint (`.pptx`) — HTML is no longer an output option**
(Ray's standing rule). Builds run through the `/deck-generator` skill: sections are authored
with the HTML component library as an internal intermediate, then exported via
`tools/deck_to_pptx.py --audit` onto the machine template `tools/templates/feedspark_deck.pptx`.
Design/element/colour/text/voice are governed by the **core deck template**
`reference-files/deck-templates/FeedSpark_Core_Deck_Template.pptx` (the Ray-approved Superdry
Strategy Review 2024–2026); Ray deposits further reference `.pptx` files (per deck type or per
client) into `reference-files/deck-templates/` — read that folder before any deck build, and
mirror new deposits into the Deck Generator module's `TEMPLATES` panel
(`docs/FeedSpark_DeckBuilder.html`). New decks are NOT wired into the worker's `/deck/` pages.

### HTML decks (legacy live decks only — no new ones)
Decks already live before the pptx-only rule (e.g. `/deck/yumove`) keep the inline edit +
JSON patch sync system:
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

### ⚠️ Access architecture (Jul 2026 — affects EVERY session's live checks)
- The Worker URL is **Public at the Workers layer** (Settings → Domains & Routes). Auth lives in
  **Zero Trust**: a site-wide Access app (Allow) + ONE path-scoped **Bypass** app for
  `/api/gmail/push` (key-gated — the Apps Script can't log in through Access).
- **NEVER flip the Workers toggle back to "Restricted"** — it intercepts BEFORE Zero Trust, which
  silently kills the Gmail-push bypass (the script then gets the login page as an HTTP 200).
- Consequence for sessions/CI: **any unauthenticated HTTP request to ANY page/API returns the
  Access LOGIN PAGE with HTTP 200 text/html.** A 200 — or scraped HTML — is NEVER proof a deploy
  is live and never real page content. Verify-live = green Deploy Action + Cloudflare MCP
  `workers_get_worker_code` bundle grep (+ `/api/version` by a logged-in human). Playwright/curl
  against the live host from a session will hit the login page — test pages via `file://` with
  stubbed fetches instead.

### Worker API (multi-page command center)
```
GET  /                          → command center landing page (git-bundled + injected editor + Tachyon)
GET  /workflow                  → Workflow control center (brief pipeline: Client→AM→ASPL)
GET  /leadership                → Ray-only dashboard (OWNER_EMAIL-gated like /activity): book health, commercial burn-down, retention radar + hub for the modules folded under it — /leadership/readiness, /leadership/library, /leadership/roadmap (same gate; legacy /readiness /library /roadmap 301 here)
GET  /deck-builder              → Deck Generator module (brief output = .pptx build on the core deck template; shows the reference-files/deck-templates/ library)
GET  /activity                  → user activity log + Build Log tab (OWNER-only: gated to OWNER_EMAIL via Cloudflare Access identity); /buildlog 301s here
GET  /api/activity?days=N       → activity feed (owner-only 403 otherwise); all API mutations + page views are logged per Access user
POST /api/gmail/push            → Gmail→FCC sync (no-admin path): Apps Script in Ray's mailbox pushes (a) brief replies — briefmatch.js moves ticket stages, TOKEN-ONLY matching (ibfcode/brief-id, never fuzzy unattended) — and (b) the inbox capture: every email to ray@feedspark.com NOT from @feedspark.com/@aroxo.com/@feedhero.net, classified (client via detectClient cue ladder: dossier dom → sender-domain label → display name → brand mention; ⚡ briefable score) — and (c) Gemini/Meet call-notes emails ("Notes by Gemini"/transcripts, pushed with a 9000-char snippet): parseGeminiNotes extracts the meeting title + action items (Suggested-next-steps section, "<Name> to/will …" owner extraction) into KV callactions (mid-deduped, ≤300) — Ray's carve-out from the emails-are-never-auto-tasks rule; the notes email never enters the triage queue. Auth = GMAIL_PUSH_KEY secret + Access bypass on this exact path (GOOGLE_SETUP.md §8)
GET  /api/gmail/intake          → captured-email queue for the Workflow triage panel (KV gmailinbox; back-fills missing clients on read; each item carries its triage decision) + `calls` (KV callactions → Workflow Intake rows, source chip = simple "📞 Call" with the meeting named in the tooltip; client = detected only — action-line brand beats meeting-title brand; client-attributed actions AUTO-ADOPT into the client's Project Plan sheet via adoptIntoPlan (Ray's rule 21 Aug) so they carry a real status dropdown + editable due — 📞 origin survives the sheet round-trip via fcc-csrc, CSRC doubles as the once-only guard; unattributed rows stay KV-only; delete/hide stick via DELETED/HIDDEN and deleted rows never adopt)
POST /api/gmail/dismiss         → triage decision memory (KV gmaildismissed): reasons task/briefed/notask/techam, undo:true restores; decided emails never re-enter the queue. Triage rule: emails are NEVER auto-tasks — → Task files to Intake (client = detected only, sender into the task name), ✕ Not a task clears
GET|POST /api/gmail/techam      → TechAM delegation (Ray's way of working, Aug 2026): the TechAM team answers common client-email requests A2Z, so the triage panel's → TechAM button queues the ORIGINAL message for a real Gmail FORWARD from Ray's mailbox (KV techamq drained by gmail_push.gs message.forward; address asked once, remembered in techamcfg), files the task into the brand's plan via adoptIntoPlan BORN DONE with owner TechAM (their lane isn't progress-tracked; TechAM is in the page's FS_PEOPLE Owner-filter roster), and records dismissal reason techam
GET  /feedlab (+/feedlab/engine.js) → Feed Lab module: animated live-feed dissection (audit, AI-readiness score, recs). Worker only STREAMS the sheet CSV (/api/feed/proxy?client=); the browser runs feedlab_engine.js and PUTs the audit to /api/feed/audit (KV feedaudit:<client> + :hist). Feed wiring: worker `DEFAULT_FEEDS` = the committed master feed-market map (imported from Ray's sheet `1eiqTbLC0fpJfjVyeJaf72kYfLPgGLDWUfXB38bRDfak` — 44 feeds × 9 brands, all sheets: Google = Schuh gb/de/ie, YuMOVE, Monsoon, Accessorize, Hobbycraft, Superdry gb/ie/de/fr/nl, House of Bruar gb/us/eu, American Golf, Reiss gb/us/ie/de/nl/au/ca/eu/fr/uae; Meta `<mkt>-fb` from the sheet's Meta tab gid 908873996 = Schuh gb/de/ie, Monsoon gb, Accessorize gb, Hobbycraft gb, Superdry gb/ie/de/fr/nl, HoB gb/us, Reiss gb/ca/de/ie/us — Reiss gb-fb's old FeedHero XML replaced by its Meta-tab sheet); a source is a sheet {id,gid} OR a FeedHero-hosted XML feed {xml} (host-allowlisted `*.feedhero.net`, realtime, browser engine sniffs XML vs CSV from first bytes; Label Guard skips XML — gviz is sheets-only); `/api/feed/clients` bootstraps the Feed Lab selector + CC dossier (FEEDWIRED counts); ad-hoc attach in the CC dossier (⚡, link-shared Google Sheet or FeedHero XML URL) OVERRIDES the wired entry per market. New sheet rows → re-import into DEFAULT_FEEDS. Docs: docs/FEEDLAB.md
GET  /labels (+/api/labels/*)   → Label Guard module: g:custom_label_0..4 capture (value/volume pivots per client×market) + drop-off monitoring vs a known-good BASELINE — PMAX listing groups key on these exact values, so drops are flagged (crit/warn) on /labels AND as a badge on every app page's nav; cron sweeps 4 feeds at :00 + 4 more at :30 when the watch pass leaves budget (42-feed estate ≈5–6h) via Google gviz group-by queries (the worker never parses raw feed CSVs); "Expected — accept as known-good" (POST /api/labels/ack) accepts intentional changes; ASK-THE-CLIENT (Ray's rule: confirm a drop is expected BEFORE acting): every alert row + per-client bundle button composes a pre-filled professional client email with a canvas-rendered before/after breakdown PNG per alert — "Create Gmail draft" queues it via POST /api/labels/askdraft (KV labeldrafts, drained by gmail_push.gs into GMAIL DRAFTS — never auto-sends; mailto + image-download fallback), contact remembered per client (labelaskcfg), alerts stamped "✉ asked" (labelasked; cleared by ack/recovery); Δ columns read vs YESTERDAY by default (labelday auto-capture) with a compact header toggle to vs LAST KNOWN-GOOD (estate alerts always fire vs last known-good; watches fire vs their own pinned reference, moved only by Re-arm); click any pivot value → LIVE cross-label dissection (GET /api/labels/cross: CL0 "Best Sellers" → CL2 women-fp/women-sale volumes), CL0–4 panes on one seamless row, sortable headers (value/skus/Δ) + 🔍 value filter across panes; CUSTOM WATCHES (🔔 alert builder, /api/labels/watch|dest kvmerge stores): pin exact values/cross breakdowns per feed → per-rule schedule: cron (:30) live-checks hourly or 0 7,17 * * * checks twice daily (07:00/17:00 GMT) and fires HIGH-PRIO pings to Google Chat/Slack webhooks direct or email via the Gmail bridge (KV labeloutbox drained by gmail_push.gs drainAlertOutbox); fire on transition, re-ping 24h while broken, ✅ on recovery, "Re-arm" accepts planned changes; daily 07:00 GMT status-report email (labelreportcfg, /api/labels/report[/send]); Facebook/Meta catalogue feeds ride the same rails via market suffix -fb — two colour-coded sets, Google green vs Facebook blue (all wired -fb feeds are now sheet-backed and fully monitored; ad-hoc FeedHero XML attaches stay Feed Lab-only — gviz cannot query XML). Docs: docs/LABELGUARD.md
GET  /ptypes (+/api/ptypes/*)   → Product Type Guard module: primary g:product_type capture (category-tree pivot per client×market, top 250 paths) + drop-off monitoring vs last known-good, Google Shopping feeds ONLY (-fb excluded; primary column resolves bare g:product_type OR slot-1 g:product_type(1); numbered keyword slots 2..10 excluded by design) — PT drives PMAX listing-group splits, so drops flag on /ptypes AND the nav badge (pt counts ride the same /api/labels/alerts call); ZERO extra scan slots: runLabelScan captures PT in the same pass (+1 gviz group-by) into ptype:/ptypebase:/ptypeday:/ptypeidx/ptypealerts; Δ vs yesterday toggle ↔ vs known-good (sessionStorage pt-ref), "Expected — accept as known-good" (POST /api/ptypes/ack), live cross-dissection PT value → CL0-4 (GET /api/ptypes/cross), sortable headers + 🔍 path filter; DEPTH GRANULARITY KPI: SKU-weighted % of the catalogue at 3/4/5-level chevron paths (depthProfile, / fallback; avg levels; stored on ptypeidx at scan time) — colour-ramped stacked depth bar + chips on the PT card, mini bars on estate rows, styled hover card breakdowns on estate market rows, the scanned date, the brand h3 and the PT name; ✉ EMAIL on confirmed warning (KV ptypealertcfg via /api/ptypes/alertcfg, default on → OWNER_EMAIL): estate warn/crit emails a per-feed digest through the Gmail-bridge outbox only on its 2nd consecutive sighting (estateMailPlan — one garbage read never emails), once per incident, ✅ on recovery; daily report gains a PRODUCT TYPE ALERTS section; 5-DEPTH STANDARD (Ray: 30–40% of volume at 5-level paths is the industry standard): depthStandard verdict pill (✓/⚠ below/🔻 shallow) on the PT card + hover-card footer, below-standard feeds get ✉ Propose depth optimisation — depthAskEmail composer on Label Guard's shared ask rails (askdraft → Gmail Drafts, contact memory labelaskcfg, ✉ asked stamp ptdepth|client|mkt) + default-on checkbox files "PT Depth Optimisation" into the client's Project Plan via POST /api/ptypes/plantask (worker PLAN_SHEETS → appendPlanRows) so it rides Intake → Project Plan → pipeline like the Gmail triage. Docs: docs/LABELGUARD.md §8
GET  /golden (+/api/golden/*)   → Golden Record module: attribute coverage vs GOOGLE'S PRODUCT DATA SPEC (answer 7052112, roster vetted Aug 2026) — ATTR_SPEC three tiers: REQUIRED (id/title/description/link/image_link/availability/price), REQUIRED-IN-CASES (brand new-products, gtin/mpn identifier pair, condition used-only, item_group_id variants, color/size/gender/age_group = the apparel five, flagged hard) and RECOMMENDED (gpc, product_type, sale_price, additional_image_link, product_highlight, product_detail, material, pattern, size_type, size_system = the optimisation surface); captured in runLabelScan on the SAME multi-count gviz query (ZERO extra subrequests, Google feeds only, count() formula-blank caveat accepted); stores golden:/goldenbase:/goldenday:/goldenidx/goldenalerts, three-reference model + ack (POST /api/golden/ack) like the sibling guards; goldenScore = weighted completeness (required ×3 missing-column=0, cond ×2 present-only with gtin+mpn merged best-of-two, rec ×1) vs the 99.9% Golden Record target; diffCoverage drop alerts (req/cond crit ≥10pp or column VANISHED — products disapprove; warn ≥3pp; rec warn-only ≥10pp), two-strike email via goldenalertcfg, GOLDEN RECORD ALERTS section in the daily report, gr counts + grClients on /api/labels/alerts (nav badge dots /golden); page = score DIAL + plain-English verdict, three tier sections (spec badges, fill bars, Δ vs yesterday ↔ known-good toggle gr-ref, spec-condition notes, "not in feed" soft vs hard-red on required+apparel), estate scorecard with per-market scores + "N req missing" pills, ⚡ estate rescan, CSV, and 🎭 demo mode (industry aliases, gr-demo) for client screen shares — policy page cited in hero + footer. Docs: docs/LABELGUARD.md §9
GET  /kwcal (+ GET|PUT /api/kwcal) → Keyword Optimisation Calendar: each brand's shared marketing calendar (lanes: campaign / moments-location / moments-studio / sale) drives a month-by-month AI keyword-optimisation schedule — every moment derives a KW task ~3 weeks ahead (LEAD_DAYS=21) with draft keyword themes; ⚡ Measure impact streams /api/feed/proxy through the Feed Lab parser IN-BROWSER and counts SKUs matching each moment's terms (title+product_type substring; sale windows are brand-wide = whole catalogue; per-event mkt honoured, e.g. Black Friday USA→us); → Brief deep-links /workflow?brief= (cat keyword); status chips planned→intake→briefed→live→done; store = kvmerge per client key (events + measured), Reiss seeded in-page from the brand's shared Jul–Dec 2026 calendar (SEED applied only when KV lacks the client); v3 REDESIGN (Ray): FS-STANDARD roadmap layout (month sections + uniform cards — never mirror the client's slide; their calendar links per brand via calImg and opens SIDE-BY-SIDE 🗂 for transcription cross-check); card declutter (themes collapse to one tag); scope = real product_type values via searchable MULTISELECT picker (⚙ Set scope — word-search over the ptidx built by ⟳ Sync product types, one stream per market, 400+-PT-friendly, ✨ Suggest-from-themes preselect matching PT NAME or per-PT word-bags crawled from titles+descriptions during sync (idx.bags); MARKET-BASED: market chips from /api/feed/markets, scopes stored per market (e.ptsm{mkt:[pts]}, legacy pts=gb), volumes/sync/picker/brief all follow the board market, pinned e.mkt wins); volumes are EXACT PT counts (sale windows brand-wide); scope has TWO combinable methods — PT multiselect AND free-text filters matched against title+description (picker text section: Enter adds, themes as one-click +chips, per-term SKU counts, e.txsm{mkt:{qs:[{q,n}],uni}} where uni = UNIQUE SKUs matching PTs ∪ terms so combined totals never double-count; counts run off an in-memory per-SKU cache window.__skucache built during ⟳ Sync and auto-streamed once on demand via ensureCache — never persisted to KV); KEYWORD SATURATION audit: optimised keywords land in numbered product_type fields (g:product_type2..10 — ALL FeedSpark feeds use this; normKey forms product_type2 / _2 / |||N all detected, EXCLUDED from scope candidates since they are keywords not the category tree), saturated = ≥1 populated → always-on per-brand/market KPI '% Keyword saturation' (ptidx[mkt].sat{n,cols}, refreshed by both sync and ensureCache streams), overview rows badge '% keyworded', picker foot shows 'N not yet keyworded' for the scope, per-event lift stored (e.satm{mkt:{unsat}}) and the brief gains 'Keyword saturation (MKT): x% — N in-scope SKUs still to keyword; landing this brief lifts the brand to ~y%' (each event = a step toward 100%); the → Brief auto-fills everything (moment, land + brief-by dates, themes, PTs + SKUs + % of feed, text filters + unique total); client calendar side-by-side defaults to a git-bundled slide when KV has no calImg (CALSEED map ↔ worker /kwcal/cal/* Data modules from docs/calseed/ — Reiss planner seeded; in-page URL/upload overrides); ▦ ALL-BRANDS OVERVIEW (selector option '*'): one view of every brand's schedule — month strips of task chips, global KPIs, per-task popover with → Brief / ⏰ Chase (Workflow deep-link, cat account) / ✉ Ask client (drafted mailto) / advance-status; stages auto-badge LIVE from /api/briefs when a pipeline brief's task carries 'AI Keyword Optimisation — <name>' (WF wins over the manual chip)
GET  /feedchat                  → Feed Chat ENGINE page — OUT of the module nav (Aug 2026): surfaced instead as the FLOATING BUBBLE bottom-right on every app page (docs/feedchat_widget.html injection; click → chat window HOVERS the current page, iframe of /feedchat?embed=1 which strips topbar/hero/foot; 3 window sizes S/M/L remembered in localStorage fcc-feedchat-size; Esc/✕ close, full-screen on phones; the page stays URL-reachable for QA/deep links). The chatbot itself: AM chatbot over the live feeds — plain-English questions ("is there duplicated title in Reiss UK Shopping feed?") routed to DETERMINISTIC checks (dup title/id/image, missing_<field>, title_len, caps, html_desc, kw_sat, price_zero, audit); /api/claude parses intent + composes the 2-3-sentence verdict (heuristic parser fallback when no key — answers stay computed either way); the browser streams /api/feed/proxy once per brand|market into window.__feedchatcache ({id,ti,de≤400,im,pr,sp,br,gt,pt,av,kw} rows; numbered product_type 2..10 = kw flag, excluded from PT winner pick), every number computed in-page never by the LLM; answer bubble = verdict + stat tiles + offender table + ⬇ full offenders CSV (blob) + → Brief this fix (/workflow?brief= cat technical, task 'Feed Fix - <check> - <Brand> <MKT> - MMYY'); multi-turn context (LAST client/market: "and in DE?" reuses the brand); suggestion chips bypass parsing (structured); unknown brand → roster nudge; the check library is a VISIBLE question stack (QSTACK grouped clickable questions — in the welcome, on 'help'/what-can-you intents, and appended brand-scoped under every default audit when a brand is mentioned vaguely; chips one-click run with brand prefilled); the stack is AM-EDITABLE in-page (✎ Edit questions: reword, per-question alt phrasings, ＋ Add onto any existing check id, hide/show — shared via KV qbank on /api/feedchat kvmerge, git QSTACK = seed) and routing is £0-FIRST: precise keyword rules → bankRoute (rare-token-weighted match over wording+alts, brand/market stripped then resolved separately, unknown-brand "in the X feed" guard nudges instead of silently using context) → /api/claude ONLY for phrasing neither matches when a key exists (free routes also skip the composed verdict) — the module never NEEDS the Anthropic key
GET|POST /api/tasks/remind      → due-today task reminders (owner-only): the 12:00 GMT cron firing emails each owner (ray/steven — OWNER_EMAILS in taskremind.js) their plan tasks due TODAY whose status is still Open-bucket (taskremind.js mirrors the PAGE's bucketOf — Briefed ≠ open; month-section yyyy-mm-01 dates are never deadlines); runs off the plan warm's freshly parsed tasks, once per UTC day (KV taskremday), delivered via the Label Guard outbox/Gmail bridge with day-scoped ids (double-send impossible) + `sig` field. GET = dry preview, POST = fire now ({force} re-runs)
GET  /api/buildlog              → Build Log feed (GitHub PRs/branches/overlap, KV-cached 10 min; optional GITHUB_TOKEN secret)
GET|PUT /api/buildqueue         → Build Log "not built yet" queue (kvmerge-backed, concurrency-safe)
GET  /deck/yumove               → YuMOVE strategy deck (git-bundled + injected editor)
GET  /api/edits?page=<slug>     → return a page's saved edits as JSON
PUT  /api/edits?page=<slug>     → save an edit patch (merges with existing)
DELETE /api/edits?page=<slug>   → clear a page's saved edits
GET  /api/template              → info only; pages are git-bundled (push to main to change them)
GET|PUT /api/briefs             → Workflow brief pipeline store (KV `briefs`; per-key merged via kvmerge.js + X-Sync-Base — same for /api/clients)
GET|POST /api/claude            → Tachyon copilot proxy to Claude Messages API (needs ANTHROPIC_API_KEY secret)
```
- **Injected on app pages** (not client decks): the live editor widget, **FCC-PRESENCE**
  (`docs/presence_widget.html` — Google-Docs-style live avatars in the topbar: each open page
  heartbeats `POST /api/presence` per minute while visible, worker stamps the Access identity
  into KV `presence`, avatars = active ≤3min with green dot + name·page·ago tooltip; popover
  ALWAYS lists the adoption watchlist Stephen + Matt with last-seen; heartbeats deliberately
  NOT in the activity log), the **Feed Chat bubble** (docs/feedchat_widget.html — the chatbot
  hovering bottom-right, see /feedchat above) + the **Tachyon copilot**
  (`docs/tachyon_widget.html`, reads `window.PLANTASKS`, calls `/api/claude`).
- **Secrets**: `ANTHROPIC_API_KEY` powers Tachyon (`wrangler secret put ANTHROPIC_API_KEY`); both
  the copilot and Gmail/plan live-sync degrade gracefully until their credential is set.
- **Pages = git**: `docs/FeedSpark_Command_Center.html` (`/`) and `docs/YuMOVE_Strategy_Review_Jul26.html`
  (`/deck/yumove`) are imported into the worker as Text modules (root `wrangler.toml` `rules`).
  **Add a page = add an import + one line in the worker's `PAGES` map.** Push to `main` → **GitHub Actions
  runs `wrangler deploy`** → live. No `PUT /api/template`. `wrangler.toml` lives at the **repo root** (deploy
  from root). KV edits are namespaced per page (`edits:<slug>`), so pages never collide.

### Deploy pipeline (GitHub Actions) — ALWAYS verify end-to-end
Deploys run via **GitHub Actions `wrangler deploy`** on every push to `main` (`.github/workflows/deploy.yml`);
a green run means the new version is live (synchronous edge publish — no CF git-integration build/promote
stall, no "nudge" commits). PRs are gated by `validate.yml` (dry-run build + inline-script check). Full
root-cause history, protocol + runbook: [`docs/DEPLOY_PROTOCOL.md`](./docs/DEPLOY_PROTOCOL.md).

> ⚠️ **A feature is NOT done until it is confirmed LIVE on the FCC — always watch the deploy end-to-end.**
> Never report a change as shipped on the strength of a merge alone. After merging to `main`:
> 1. Confirm the **Deploy** Action run went **green** (GitHub Actions tab / `actions_list`).
> 2. Confirm the worker actually re-published — its Cloudflare `modified_on` advanced (Cloudflare MCP
>    `workers_list`) or the Deploy run succeeded.
> 3. Verify the live build at **`/api/version`** — the returned `sha` matches the merge commit.
> 4. Sanity-check the actual page/feature is present.
>
> If a deploy fails, read the Action log, fix forward, and re-verify — don't leave a feature half-published.
> (Access-gated endpoints can't be curled from CI, so `modified_on` + a green run are the machine-checkable
> signals; `/api/version` is the human check once logged in.)

### Multi-session development (4–5 parallel Claude Code sessions)
Trunk-based: each session = its **own short-lived branch** off latest `main` (`claude/<module>-<slug>`),
small module-prefixed PRs (`[Workflow] …`), never a shared branch. Default one session per module
(Workflow / Command Center / Deck Gen / Worker / other pages) as a **guideline**; crossing is fine if you
check open PRs + `claude/*` branches first and **sequence** same-file edits. A `SessionStart` hook
(`.claude/settings.json`) auto-fetches main + reports in-flight `claude/*` branches + overlap at
session start. Before every PR: **`/presync`** (pre-approved skill) or
**`bash tools/presync.sh`** (merges latest main + re-validates); unattended builds gate on
**`bash tools/qa_gate.sh`** (validation-only, exit 0 = shippable — use as the `/goal` stop
condition). Every `create_pull_request` triggers a hook nudging `subscribe_pr_activity` (PR
babysitting by default). Overlap safeguards, both inside presync:
the **overwrite tripwire** (`docs/feature_manifest.json` checked by `tools/check_markers.js` — when you
ship a feature into a shared file, add its marker in the same PR) and the **overlap detector**
(`tools/overlap.sh` — also run it at task START; 🔥 hot-file overlap = sequence, don't parallel-edit).
**Nav-parity tripwire (Ray's standing rule): the module menu stays IDENTICAL on every app page** —
`tools/check_nav.js` (in presync + qa_gate + validate.yml) fails the build if any page's `.tb-modules`
nav drifts from `docs/FeedSpark_Workflow.html` (the canonical). Adding a module = add its link to
EVERY nav-bearing page in the same PR, `.on` only on the page's own link.
If presync's merge touched a file you're editing, re-run your QA — a clean git merge is not an intact
feature. **Merge autonomy (Ray's standing rule): NEVER wait for Ray to merge.** Once presync +
`validate.yml` are green, the session opens **and merges** its own PR (squash) immediately — human
approval is not a gate; the only reason to hold a merge is 🔥 overlap sequencing with another session.
After merge: verify LIVE per the rule above, then restart the branch from latest main.
Full protocol: [`docs/WAYS_OF_WORKING.md`](./docs/WAYS_OF_WORKING.md).

### Brand dossier — portfolio band (Aug 2026)
Each dossier card opens with an async **portfolio band** (`dz-port`, filled by `portFill`):
**Activity** (PLANTASKS record — total/open/done-30d/overdue + briefs in flight from `/api/briefs`
+ kw moments from `/api/kwcal`), **Health** (composite 0–100, transparent named deductions:
overdue, guard alerts via `/api/labels/alerts?by=client` — worker splits `labelalerts`/`ptypealerts`
keys per client — audit avg, keyword saturation, plan score), **Feed audit** (per wired market:
Feed Lab score via `/api/feed/audit` + % keyworded, honest "not scanned"), and **Suggested next
moves** — ranked P1–P3 deterministic rules deep-linking /labels /ptypes /workflow /feedlab /kwcal.
All computed, £0, cached per session; existing dossier blocks (score panel, tests, materials,
attach flows) unchanged.

### Command center data — ATRT Tracker
- The command center (`/`) shows **live workload**, **tests running** and **accounts & project plans**
  sourced from the **ATRT Tracker** (Google Sheet `1p_cPSRjmK16CDpLryoOBaOUjG3ZvnL-k4ORHhaHI5AE`):
  tab 1 = task/interaction log (per client, task, AM, AE, due, status; arrives by email/ad-hoc or monthly call),
  tab 2 = accounts & project-plan links.
- Committed record: `docs/atrt_data.json`. Sync tool: `tools/sync_atrt.py` splices the `<!-- ATRT:LOG -->`,
  `<!-- ATRT:TESTS -->`, `<!-- ATRT:PLANS -->` marked regions in `docs/FeedSpark_Command_Center.html`.
- **Refresh:** re-pull the sheet (Google Drive `read_file_content`) → save as a `.txt` →
  `python tools/sync_atrt.py <txt>` → commit → push (auto-deploys). Only the marked regions change.

---

## Key technical concepts

- **Conversational attributes** (Google, 2026): question_and_answer, document_link, related_product, item_group_title, variant_option, popularity_rank — submitted via supplemental data source
- **AI-Ready Feeds**: FeedSpark framework for preparing product data for agentic commerce (ChatGPT Shopping, Perplexity, Google AI Mode)
- **Agentic commerce protocols**: UCP (Google), MCP (Anthropic/Shopify), ACP (OpenAI/ChatGPT)
- **Golden Record**: 99.9% attribute completeness target across all feed dimensions
- **MASK structuring**: Title format — Brand + Material + Fit + Colour + Use-case (80-120 chars)
- **GPC**: Google Product Category — fixed taxonomy, not generated by AI
