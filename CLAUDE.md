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
GET  /api/kwresults?client=      → scheduled keyword-optimisation RESULTS archive (Ray's ask 27 Aug): Dino Kumar's daily result updates to clients (subject '<Brand> <MKT> x Feedspark - <Mon I/II> - Keyword Optimisation') are captured by a third gmail_push.gs search (internal-sender carve-out — the inbox capture excludes @feedspark.com, these come FROM the team; long snippet like call notes), parsed at push time by parseKwResult (brand/market/period + best-effort %-metric lines + raw body head archived as the safety net; parser is synthetic-until-first-real-specimen) into KV kwresults (mid-deduped ≤400, pre-capture triage copies lifted out, never triage items); the CC brand dossier renders the archive as '📈 Optimisation results' (grouped per batch, rows expand to metric lines + raw email) for future deck-making
GET  /api/gmail/intake          → captured-email queue for the Workflow triage panel (KV gmailinbox; back-fills missing clients on read; each item carries its triage decision) + `calls` (KV callactions → Workflow Intake rows, source chip = simple "📞 Call" with the meeting named in the tooltip; client = detected only — cue ladder action-line brand > meeting title > RAW EMAIL SUBJECT + recipients > body head (Ray 9 Sep: "Monsoon x cate.com x Fispar" subjects parse the client directly; a Gemini-sender email with a notes-shaped body is call notes even when the subject is just the meeting name), detector roster = dossier ∪ DEFAULT_FEEDS estate so a wired brand without a dossier card still attributes, and unattributed stored rows BACK-FILL on every intake read (title+task rescan, tools/test_callclient.mjs in qa_gate); client-attributed actions AUTO-ADOPT into the client's Project Plan sheet via adoptIntoPlan (Ray's rule 21 Aug) so they carry a real status dropdown + editable due — 📞 origin survives the sheet round-trip via fcc-csrc, CSRC doubles as the once-only guard; unattributed rows stay KV-only; delete/hide stick via DELETED/HIDDEN and deleted rows never adopt; WRITE-VERIFIED (26 Aug): every sheet append is confirmed — MANUAL rows carry w:1 only on an {ok:true} response, resyncPlanWrites re-sends unconfirmed rows once per session batched per client, appendPlanRows skips tasks already in the tab so retries never double-append, and the saved brand roster (fcc-wf-brands) UNIONS with ALL_BRANDS so a newly-onboarded client can never be invisible to adoptCalls)
POST /api/gmail/dismiss         → triage decision memory (KV gmaildismissed): reasons task/briefed/notask/techam, undo:true restores; decided emails never re-enter the queue. Triage rule: emails are NEVER auto-tasks — → Task files to Intake (client = detected only, sender into the task name), ✕ Not a task clears
GET|POST /api/gmail/techam      → TechAM delegation (Ray's way of working, Aug 2026): the TechAM team answers common client-email requests A2Z, so the triage panel's → TechAM button queues the ORIGINAL message for a real Gmail FORWARD from Ray's mailbox (KV techamq drained by gmail_push.gs message.forward; address asked once, remembered in techamcfg), files the task into the brand's plan via adoptIntoPlan BORN DONE with owner TechAM (their lane isn't progress-tracked; TechAM is in the page's FS_PEOPLE Owner-filter roster), and records dismissal reason techam
GET  /feedlab (+/feedlab/engine.js) → Feed Lab module: animated live-feed dissection (audit, AI-readiness score, recs). Worker only STREAMS the sheet CSV (/api/feed/proxy?client=); the browser runs feedlab_engine.js and PUTs the audit to /api/feed/audit (KV feedaudit:<client> + :hist). Feed wiring: worker `DEFAULT_FEEDS` = the committed master feed-market map (imported from Ray's sheet `1eiqTbLC0fpJfjVyeJaf72kYfLPgGLDWUfXB38bRDfak` — ESTATE XML MIGRATION (Ray, 9 Sep 2026, from his uploaded FeedHero export — ops/feeds/feedhero_selection_2026-09-09.json is the committed record): EVERY Google-channel feed except House of Bruar gb/us/eu now imports from its realtime FeedHero XML — 46 {xml} feeds: Schuh gb/de/ie, YuMOVE, Monsoon, Accessorize, Hobbycraft, American Golf, Superdry gb/ie/de/fr/nl + NEW us/es/dk/benl/befr, Reiss all 28 markets (gb/us/ie/de/nl/au/ca/eu/fr/uae + NEW at/be/ch/cz/dk/es/fi/gr/hk/it/kw/pl/pt/ro/sa/se/sg/sk); per market the export's exact-'Google Shopping' row wins over localized variants; xmlRef also allows bare feedhero.net (reiss_us/eu); old sheets stay ONLY for cross-check — keep {xml} entries through any re-import. Sheets-only guards (Label/PT/Golden, gviz) now cover just the -fb Meta feeds + HoB until the XML scan lane is built; the cron sweep filters src.id so XML never burns rotation slots; Meta `<mkt>-fb` — META XML MIGRATION (Ray, 9 Sep 2026, second FeedHero export; record ops/feeds/feedhero_meta_selection_2026-09-09.json): 16 -fb feeds now realtime FeedHero XML (Schuh gb/de/ie, Monsoon gb, Accessorize gb, Superdry gb, Reiss gb/ca/de/ie/us + NEW au/eu/nl/sa/uae — Reiss gb-fb's Florere sub-brand variant feed deliberately not wired); still sheet-backed from the Meta tab gid 908873996: Hobbycraft gb-fb, Superdry ie/de/fr/nl-fb, HoB gb/us-fb); a source is a sheet {id,gid} OR a FeedHero-hosted XML feed {xml} (host-allowlisted `*.feedhero.net`, realtime, browser engine sniffs XML vs CSV from first bytes; Label Guard skips XML — gviz is sheets-only); `/api/feed/clients` bootstraps the Feed Lab selector + CC dossier (FEEDWIRED counts); ad-hoc attach in the CC dossier (⚡, link-shared Google Sheet or FeedHero XML URL) OVERRIDES the wired entry per market. New sheet rows → re-import into DEFAULT_FEEDS. COLUMN-E MIGRATION (Ray's workflow, 9 Sep 2026): the master sheet's column E "Google Shopping URL" holds each feed's FeedHero XML URL — Ray fills it at his own pace; `node tools/sync_feedmap.mjs` migrates DEFAULT_FEEDS to {xml} for every filled row (joins rows to the map BY SHEET ID, live-verifies each URL serves XML, line-level splice keyed on the sheet id so {xml} entries can never be reverted by a re-run; DRY=1 = report only; a wired XML gone from column E is a warning, never an auto-revert). Each migrated feed leaves the sheets-only guards (Label/PT/Golden — gviz) until the XML scan lane is built. Docs: docs/FEEDLAB.md
GET  /labels (+/api/labels/*)   → Label Guard module: g:custom_label_0..4 capture (value/volume pivots per client×market) + drop-off monitoring vs a known-good BASELINE — PMAX listing groups key on these exact values, so drops are flagged (crit/warn) on /labels AND as a badge on every app page's nav; cron sweeps 4 feeds at :00 + 4 more at :30 when the watch pass leaves budget (42-feed estate ≈5–6h) via Google gviz group-by queries (the worker never parses raw feed CSVs); "Expected — accept as known-good" (POST /api/labels/ack) accepts intentional changes; VERIFY-VANISHED (Ray, Sep 2026): vanished-column alerts (label-gone/cov-zero here + /ptypes, attr-gone on /golden) carry a "⟳ Verify — fresh scan" button — one manual re-scan confirms the wipe or clears a bad read (recovered column self-clears via the baseline roll; unstable-read skips surfaced honestly); ASK-THE-CLIENT (Ray's rule: confirm a drop is expected BEFORE acting): every alert row + per-client bundle button composes a pre-filled professional client email with a canvas-rendered before/after breakdown PNG per alert — "Create Gmail draft" queues it via POST /api/labels/askdraft (KV labeldrafts, drained by gmail_push.gs into GMAIL DRAFTS — never auto-sends; mailto + image-download fallback), contact remembered per client (labelaskcfg), alerts stamped "✉ asked" (labelasked; cleared by ack/recovery); Δ columns read vs YESTERDAY by default (labelday auto-capture) with a compact header toggle to vs LAST KNOWN-GOOD (estate alerts always fire vs last known-good; watches fire vs their own pinned reference, moved only by Re-arm); click any pivot value → LIVE cross-label dissection (GET /api/labels/cross: CL0 "Best Sellers" → CL2 women-fp/women-sale volumes), CL0–4 panes on one seamless row, sortable headers (value/skus/Δ) + 🔍 value filter across panes; CUSTOM WATCHES (🔔 alert builder, /api/labels/watch|dest kvmerge stores): pin exact values/cross breakdowns per feed → per-rule schedule: cron (:30) live-checks hourly or 0 7,17 * * * checks twice daily (07:00/17:00 GMT) and fires HIGH-PRIO pings to Google Chat/Slack webhooks direct or email via the Gmail bridge (KV labeloutbox drained by gmail_push.gs drainAlertOutbox); fire on transition, re-ping 24h while broken, ✅ on recovery, "Re-arm" accepts planned changes; daily 07:00 GMT status-report email (labelreportcfg, /api/labels/report[/send]); Facebook/Meta catalogue feeds ride the same rails via market suffix -fb — two colour-coded sets, Google green vs Facebook blue (XML SCAN LANE, Ray 9 Sep 2026 'fetch four times a day for every URL': .github/workflows/xml-scan.yml (cron 4x/day UTC + dispatch, secret FCC_PUSH_KEY = the GMAIL_PUSH_KEY value) runs tools/xml_scan.mjs — fetches every wired {xml} feed, aggregates per-row INSIDE the parser callback (a 125MB feed costs MBs), assembles the scanFeed-shape snapshot with labelguard.js's OWN exports (findCols/snapshotFromParts/attrsFromCounts), and POSTs batches of 8 to /api/gmail/push {xmlscan} (existing bypass + push key; worker validates the feed is a WIRED {xml} source and forces identity fields) → the shared processScanSnapshot runs the SAME baseline/day-ref/alert/two-strike processing as the gviz sweep (worker refactor: runLabelScan = fetch + processScanSnapshot; markScanUnreachable shared; push-lane catastrophic readings are HELD via labelpend: until a confirming re-push agrees on rows — the agent retries immediately on retry:true). Estate grids on /labels /ptypes /golden list XML feeds first-class again; the gviz cron sweep still covers the sheet-backed rest (HoB google gb/us/eu + HoB gb/us-fb + Hobbycraft gb-fb + Superdry ie/de/fr/nl-fb); custom 🔔 watches remain gviz-live = sheet-only; MANUAL LIVE RESCAN (Ray, 10 Sep 2026: the per-feed scan button must not depend on the 4x-daily run): on the sheets-only refusal the guard pages (/labels /ptypes /golden) stream the wired FeedHero XML IN-BROWSER — Feed Lab parser + labelguard's shared xmlCollector, served at /labels/engine.js from docs/labelguard_engine.js, a committed byte-identical copy of src/labelguard.js enforced by tools/check_lgcopy.js in qa_gate/presync/validate — and POST the computed snapshot {snap, vol} to /api/labels/scanpush (Access-gated, ACT 'label-scan-live'): applyPushedSnapshot forces identity, must resolve an {xml} source (dossier-attached XML included), runs the SAME processScanSnapshot + volTrack as the agent lane, and a catastrophic reading is HELD (202 retry) until the page's automatic second stream agrees; scan-all stays cron-only). Docs: docs/LABELGUARD.md
GET  /ptypes (+/api/ptypes/*)   → Product Type Guard module: primary g:product_type capture (category-tree pivot per client×market, top 250 paths) + drop-off monitoring vs last known-good, Google Shopping feeds ONLY (-fb excluded; primary column resolves bare g:product_type OR slot-1 g:product_type(1); numbered keyword slots 2..10 excluded by design) — PT drives PMAX listing-group splits, so drops flag on /ptypes AND the nav badge (pt counts ride the same /api/labels/alerts call); ZERO extra scan slots: runLabelScan captures PT in the same pass (+1 gviz group-by) into ptype:/ptypebase:/ptypeday:/ptypeidx/ptypealerts; Δ vs yesterday toggle ↔ vs known-good (sessionStorage pt-ref), "Expected — accept as known-good" (POST /api/ptypes/ack), live cross-dissection PT value → CL0-4 (GET /api/ptypes/cross), sortable headers + 🔍 path filter; DEPTH GRANULARITY KPI: SKU-weighted % of the catalogue at 3/4/5-level chevron paths (depthProfile, / fallback; avg levels; stored on ptypeidx at scan time) — colour-ramped stacked depth bar + chips on the PT card, mini bars on estate rows, styled hover card breakdowns on estate market rows, the scanned date, the brand h3 and the PT name; ✉ EMAIL on confirmed warning (KV ptypealertcfg via /api/ptypes/alertcfg — OPT-IN, OFF by default since Ray dropped the automated alert emails Aug 2026; page re-enable stamps v2, legacy configs never email; same rule on goldenalertcfg): estate warn/crit emails a per-feed digest through the Gmail-bridge outbox only on its 2nd consecutive sighting (estateMailPlan — one garbage read never emails), once per incident, ✅ on recovery; daily report gains a PRODUCT TYPE ALERTS section; 5-DEPTH STANDARD (Ray: 30–40% of volume at 5-level paths is the industry standard): depthStandard verdict pill (✓/⚠ below/🔻 shallow) on the PT card + hover-card footer, below-standard feeds get ✉ Propose depth optimisation — depthAskEmail composer on Label Guard's shared ask rails (askdraft → Gmail Drafts, contact memory labelaskcfg, ✉ asked stamp ptdepth|client|mkt) + default-on checkbox files "PT Depth Optimisation" into the client's Project Plan via POST /api/ptypes/plantask (worker PLAN_SHEETS → appendPlanRows) so it rides Intake → Project Plan → pipeline like the Gmail triage. Docs: docs/LABELGUARD.md §8
GET  /golden (+/api/golden/*)   → Golden Record module: attribute coverage vs GOOGLE'S PRODUCT DATA SPEC (answer 7052112, roster vetted Aug 2026) — ATTR_SPEC three tiers: REQUIRED (id/title/description/link/image_link/availability/price), REQUIRED-IN-CASES (brand new-products, gtin/mpn identifier pair, condition used-only, item_group_id variants, color/size/gender/age_group = the apparel five, flagged hard) and RECOMMENDED (gpc, product_type, sale_price, additional_image_link, product_highlight, product_detail, material, pattern, size_type, size_system = the optimisation surface); captured in runLabelScan on the SAME multi-count gviz query (ZERO extra subrequests, Google feeds only, count() formula-blank caveat accepted); stores golden:/goldenbase:/goldenday:/goldenidx/goldenalerts, three-reference model + ack (POST /api/golden/ack) like the sibling guards; goldenScore = weighted completeness (required ×3 missing-column=0, cond ×2 present-only with gtin+mpn merged best-of-two, rec ×1) vs the 99.9% Golden Record target; diffCoverage drop alerts (req/cond crit ≥10pp or column VANISHED — products disapprove; warn ≥3pp; rec warn-only ≥10pp), two-strike email via goldenalertcfg, GOLDEN RECORD ALERTS section in the daily report, gr counts + grClients on /api/labels/alerts (nav badge dots /golden); page = score DIAL + plain-English verdict, three tier sections (spec badges, fill bars, Δ vs yesterday ↔ known-good toggle gr-ref, spec-condition notes, "not in feed" soft vs hard-red on required+apparel), estate scorecard with per-market scores + "N req missing" pills, ⚡ estate rescan, CSV, and 🎭 demo mode (industry aliases, gr-demo) for client screen shares — policy page cited in hero + footer; CONVERSATIONAL AI SIX as a fourth tier (req:'ai': question_and_answer, document_link, related_product, item_group_title, variant_option, popularity_rank — Optional on the same spec page, usually supplemental-source, warn-only alerts): own AI-readiness KPI "N of 6 live" (verdict + tier header + goldenidx.ai), NEVER counted into goldenScore; PER-ATTRIBUTE ACTIONS on every row: ✉ Ask client (attrAskEmail composer, missing vs low-coverage variants, shared askdraft rails, stamps grattr|client|mkt|attr, default-on checkbox files "Golden Record Fix - g:<attr>" via POST /api/golden/plantask → PLAN_SHEETS/appendPlanRows) and → Brief (/workflow?brief= deep-link cat technical + the same plantask write keepalive) — both paths ride Intake → Project Plan → pipeline like the Gmail triage; actions hidden in demo; INDUSTRY SCORING PROFILES (Ray: certain attributes incorporated into scoring per brand/industry = the industry best practice): engine INDUSTRY (client→industry) + INDUSTRY_PROFILES defaults (apparel five expected for Fashion/Footwear, apparel-only recs waived for Pet Care etc.), profileFor merges defaults ← KV industry override ← KV brand override (goldenprofiles, GET/PUT /api/golden/profile; required seven + gtin/mpn untouchable), goldenScore(attrs, profile): expected counts-when-absent at tier weight (AI six opt-in-able at ×1), waived excluded; scan stores industry + per-attr cov map on goldenidx → the page computes INDUSTRY BENCHMARKS from the estate itself (verdict line "avg X · best Y (Brand)" + best-practice tick on every fill bar at industry-best coverage); ⚖ "<Industry> best practice" chip + ⚙ tri-state editor (default → ★ scored → waived, brand vs whole-industry scope, reset), ★ marks scored attrs, hard not-in-feed flags follow the profile. Docs: docs/LABELGUARD.md §9
GET  /kwcal (+ GET|PUT /api/kwcal) → Keyword Optimisation Calendar: each brand's shared marketing calendar (lanes: campaign / moments-location / moments-studio / sale) drives a month-by-month AI keyword-optimisation schedule — every moment derives a KW task ~3 weeks ahead (LEAD_DAYS=21) with draft keyword themes; ⚡ Measure impact streams /api/feed/proxy through the Feed Lab parser IN-BROWSER and counts SKUs matching each moment's terms (title+product_type substring; sale windows are brand-wide = whole catalogue; per-event mkt honoured, e.g. Black Friday USA→us); → Brief deep-links /workflow?brief= (cat keyword); status chips planned→intake→briefed→live→done; store = kvmerge per client key (events + measured), Reiss seeded in-page from the brand's shared Jul–Dec 2026 calendar (SEED applied only when KV lacks the client); v3 REDESIGN (Ray): FS-STANDARD roadmap layout (month sections + uniform cards — never mirror the client's slide; their calendar links per brand via calImg and opens SIDE-BY-SIDE 🗂 for transcription cross-check); card declutter (themes collapse to one tag); scope = real product_type values via searchable MULTISELECT picker (⚙ Set scope — word-search over the ptidx built by ⟳ Sync product types, one stream per market, 400+-PT-friendly, ✨ Suggest-from-themes preselect matching PT NAME or per-PT word-bags crawled from titles+descriptions during sync (idx.bags); MARKET-BASED: market chips from /api/feed/markets, scopes stored per market (e.ptsm{mkt:[pts]}, legacy pts=gb), volumes/sync/picker/brief all follow the board market, pinned e.mkt wins); volumes are EXACT PT counts (sale windows brand-wide); scope has TWO combinable methods — PT multiselect AND free-text filters matched against title+description (picker text section: Enter adds, themes as one-click +chips, per-term SKU counts, e.txsm{mkt:{qs:[{q,n}],uni}} where uni = UNIQUE SKUs matching PTs ∪ terms so combined totals never double-count; counts run off an in-memory per-SKU cache window.__skucache built during ⟳ Sync and auto-streamed once on demand via ensureCache — never persisted to KV); KEYWORD SATURATION audit: optimised keywords land in numbered product_type fields (g:product_type2..10 — ALL FeedSpark feeds use this; normKey forms product_type2 / _2 / |||N all detected, EXCLUDED from scope candidates since they are keywords not the category tree), saturated = ≥1 populated → always-on per-brand/market KPI '% Keyword saturation' (ptidx[mkt].sat{n,cols}, refreshed by both sync and ensureCache streams), overview rows badge '% keyworded', picker foot shows 'N not yet keyworded' for the scope, per-event lift stored (e.satm{mkt:{unsat}}) and the brief gains 'Keyword saturation (MKT): x% — N in-scope SKUs still to keyword; landing this brief lifts the brand to ~y%' (each event = a step toward 100%); the → Brief auto-fills everything (moment, land + brief-by dates, themes, PTs + SKUs + % of feed, text filters + unique total); client calendar side-by-side defaults to a git-bundled slide when KV has no calImg (CALSEED map ↔ worker /kwcal/cal/* Data modules from docs/calseed/ — Reiss planner seeded; in-page URL/upload overrides); ▦ ALL-BRANDS OVERVIEW (selector option '*'): one view of every brand's schedule — month strips of task chips, global KPIs, per-task popover with → Brief / ⏰ Chase (Workflow deep-link, cat account) / ✉ Ask client (drafted mailto) / advance-status; stages auto-badge LIVE from /api/briefs when a pipeline brief's task carries 'AI Keyword Optimisation — <name>' (WF wins over the manual chip); ⬇ CLIENT PDF (Ray, 11 Sep 2026: 'a button to export into PDF so we can share with clients'): the roadmap exports as a print-ready client document — browser print-to-PDF, no library. The live board can't be printed (it's a horizontally-scrolling month grid carrying internal-only detail), so renderPdfDoc() builds a SEPARATE client-facing document into #pdf-doc from the same data and the @media print block shows only that: branded header, four KPIs (optimisations, products in scope, keyword saturation, live-or-complete), month sections of cards (moment, optimisation-live-by + marketing-moment dates, pinned market, product scope in plain words, full theme list, four-word client status), a 'How this roadmap is built' methodology card and the Private & Confidential footer. CLIENT-SAFE BY CONSTRUCTION — the hours & resourcing rail (owners/effort), → Brief links, edit controls and the PT/text-filter jargon are never written into it, and the '*' all-brands overview cannot export (one client must never see another's roadmap). Internal stages collapse to Scheduled / In progress / Live / Complete; colours are hard-coded so the PDF is on-brand from either theme; renderPdfDoc() runs on every render so a native Cmd/Ctrl+P prints the client doc too; CLOSED LOOP — moment ⇄ ticket ⇄ result (Ray, 11 Sep 2026: 'the status of each event or team is connected, changed and updated, and aligns with the brief inside Workflow … all of these events will be briefed specifically using the keyword calendar only … refreshed throughout the weeks and the month — including result'): every optimisation is briefed from THIS calendar and nowhere else, so each moment owns exactly ONE ticket and the board never guesses which — → Brief puts the moment's id in the deep-link payload (kw:e.id) and the Workflow composer stamps it on the saved brief (b.kw, threaded via window.__kwId: cleared in prefill, set by the deep link, consumed on save, kept through later edits), so the tie survives a rename, a market change and a re-brief; wfFor resolves strongest-evidence-first (stamped id → regenerated house task name → the moment name ENDING its task segment, never bare containment, which let 'Coats' capture 'Coats & Jackets'), newest wins on a tie and a foreign client's brief can never leak in. A briefed moment's chip is therefore LIVE FROM THE PIPELINE and renders as a LINK to /workflow carrying the stage plus WHOSE COURT it sits in (COURTM = Workflow's own stage→team map: AM / ASPL / Client) — the stage moves in Workflow, never on the calendar, so the old phantom click (which cycled a hidden e.st the render then ignored) is gone; only un-briefed moments keep a manual chip, and the overview popover swaps '↻ Advance status' for '🎫 Open in Workflow' once a ticket exists. RESULTS close the loop: /api/kwresults is Dino's scheduled result archive per brand × market × HALF-MONTH round, carrying no moment id — so periodWin parses the period token ('Aug II' + the email date, with the Dec-reported-in-Jan year roll) into its window and resFor ties a round to every optimisation whose live-by date falls inside it, which is the real relationship (one round reports a fortnight's work); the card gets a verdict chip → metric popover, the KPIs gain 'Results reported' + 'Not yet briefed', the overview badges 📈, and the client PDF prints the verdict per moment but the round's NUMBERS ONCE per round with a 'Covers: …' line, so a shared round never reads as several separate results. LIVE REFRESH: liveTick re-pulls /api/briefs + /api/kwresults every 90s and on tab-visible, re-rendering only when the signature actually moved and never while a scope picker or popover is open. Harness: tools/test_kwcal_tie.mjs (pure node, lifts the functions out of the page by name) pins the precedence, the collision guard and the window maths — wired into qa_gate, presync and validate.yml
GET  /volume (+/api/volume)     → Product Volume module (Ray, 9 Sep 2026: 'document the daily product volume … 300 new products coming in and 900 going out … like Merchant Center'): GMC-style daily in/out churn per brand×market for AMs — the xml-scan agent captures each feed's full SKU id set as 'id|category' lines (category = first chevron level of primary product_type; VOLCAP 40k, over = truncated → rows-only) alongside every snapshot; the worker's volTrack (rides only CONFIRMED scans — catastrophic holds never write) keeps the day's CLOSING set in KV volids:<client>:<mkt> (same-day scans replace it) and on the first scan of a new UTC day set-diffs yesterday-close vs today into volhist: entries {d, rows, in, out, cats top-12} (cap 60 days) — close-to-close, so intraday flapping never double-counts; GET /api/volume?client=&market= serves hist + the labelhist rows-per-scan series + tracked kind (xml|sheet). The page (docs/FeedSpark_Volume.html): mirrored daily bar chart (in above / out below one zero axis, validated palette light #2563EB/#ED6F0B · dark #4C82E0/#C67B28, hover tooltip, day-click scopes the Category-movers table), total-SKUs trend, ⊞ table view, and the 'How these volume movements are tracked' methodology card (Ray's ask). Sheet-backed feeds show rows-history only with an honest XML-needed note; history accrues from first scan (no backfill — id sets didn't exist before 9 Sep 2026)
GET  /overlays (+/api/overlays, /api/overlays/scanpush, /overlays/engine.js) → Image Overlays module (Ray, 10 Sep 2026: 'when you scan the feed for each client that has overlay service on, especially the Meta feed, the image link starts with dashboard.feedspark.com — render the type of overlay live on each client and render the image; the clue is in the URL string'): docs/overlay_engine.js (UMD, shared by the xml-scan agent, the page's live scan and tools/test_overlays.mjs — wired in qa_gate + validate.yml) reads every image_link + additional_image_link; a FeedSpark image host (dashboard./lia. feedspark.com, feed5.com) = overlay service ON; classifyOverlay decodes the TYPE off the URL string — engine path (image-creator/<project>/<script>.php: image_process_products_lifestyle = 'Product × Lifestyle split', dynamic-overlay-engine/<brand>/image_process_engine = 'Dynamic overlay engine · frame <asset>', image_process_subscription_v1 + show_price = 'Subscription v1 · price tag', lia …/feedspark-meta-dynamic-v2/meta_catelog_call = 'Meta dynamic template v2'; unseen scripts get a DERIVED label, never hidden) + recipe readouts from the params (img_url_left/right = the two composed sources, img_ver/ver = version, tag colours/style, frame asset, template id/hash); overlayCollector counts per type + keeps 16 rendered samples {id,ti,link,url,src,ver}. The 4x-daily xml_scan.mjs captures `ovl` on the SAME stream as snap/vol and the worker's overlayTrack (confirmed scans only, via applyPushedSnapshot) stores overlay:<c>:<m> (whole capture) + overlayhist:<c>:<m> (counts per scan, ≤120) + the one-read estate index overlayidx; GET /api/overlays = full roster (feedRoster) ∪ index so never-scanned feeds show honestly, ?client=&market= = capture + hist; POST /api/overlays/scanpush = the page's ⚡ live in-browser scan (streams /api/feed/proxy through FeedAudit XML/CSV sniff + the collector, works on sheet feeds too, ACT 'overlay-scan-live'). Page docs/FeedSpark_Overlays.html: estate table (Meta first, coverage bars blue=Meta/orange=Google, type chips, ⚡ per row + 'Scan all Meta feeds' queue), KPIs, per-type cards (label, family chip, version chips, decoded recipe, URL template, lazy gallery of the LIVE overlay images), lightbox = composite vs the source inputs (left/right) + recipe + product link, coverage trend per scan, methodology card. Estate truth 10 Sep 2026: Monsoon gb-fb 329/1593 (products×lifestyle split) + YuMOVE gb 85/85 (subscription tag ×60, dynamic engine ×15, lia meta-dynamic ×10); every other wired feed serves the client's plain CDN image
GET  /playbook (+GET /api/playbook) → Playbook — AM MEETING COPILOT (Ray, 11 Sep 2026: 'a module for AMs to use during meetings … assimilate and assess all tasks across every brand for multiple clients from multiple industries … if there is an overlay BAU task on Accessorize, suggest it to Hobbycraft … a search bar on a blank canvas: "what should I do for Accessorize?" → a checklist of tasks completed over the last month/3/6/12'): one scoped read of every client's project-plan tasks, classified into 16 feed-optimisation strategies (Custom Labels, Image & Overlays, Titles, Keyword Opt, Descriptions & Highlights, Golden Record attrs, Product Type, Stock & Range, A/B, Events & Seasonal, Search Intent, AI-Ready & Conversational, Competitor, Channels & Markets, Feed Health, Account) by an in-page rare-token classifier calibrated to real plan vocabulary (roundel/cycler/hero sizes/range completion/OOS/EOSS/conversational/CL0-5/bestseller/GEO intent/AB test) — its OWN taxonomy so the worker's coarse classifyCat is untouched; editable ⚙ Tune (rename/keywords/hide, localStorage fcc-pb-tax, KV-sync fast-follow). Blank-canvas search resolves a brand (plain or 'what should I do for X') → RETROSPECTIVE (completed work grouped by category, 1m/3m/6m/12m/all window toggle, expandable ✓ checklist + in-flight strip — recency by PLAN DATE / month-section, since plans carry NO completion timestamp; stated on the page; lane sheets = all-time) + PROSPECTIVE cross-pollination (categories proven on ≥2 peer brands the viewed brand is absent/thin on, ranked by peer count × volume, example plays from the top peer, → Brief deep-links /workflow?brief= to file into the plan → Intake pipeline; only proposable cats cross-pollinate, not BAU admin). Data = baked window.PLANTASKS (instant, build_plan_tasks.py splice — Playbook page added to the splice list) MERGED with GET /api/playbook: a SCOPED server-side crawl reading the cron-warmed planlive:<id> caches for every PLAN_SHEETS brand in scope (clientMatch(acc.clients …); owner = full book; a scoped AM sees only their clients), deduped by sheet id (shared workbooks keep the per-brand baked split), tasks compacted {t,o,b,d}, NO cold Sheets fetch (fast + bounded). Nav link on every page (parity tripwire); deep link /playbook?b=<Brand>. Docs: docs/PLAYBOOK.md
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
GET|PUT /api/access             → INDIVIDUAL ACCESS (Ray, Aug 2026): per-user client-scoped Workflow. `?me=1` = caller's own scope (any signin); bare GET/PUT = the directory, owner-only (KV `accessdir`; git seed in src/access.js = Radostina→House of Bruar until first save; owner edits via the 👥 Access button in Workflow's intake live-bar). Scope resolution (src/access.js): owner → full house; directory row OR client-team ALIAS auto-rule (email local part slug-matches a client name: houseofbruar@feedspark.com → House of Bruar, zero config, accent/case-folded) → scoped; unassigned → full house (scoping only NARROWS). Enforcement is SERVER-SIDE on the Workflow data routes: /api/briefs GET filtered + PUT re-injects foreign briefs before the kvmerge pass (a scoped whole-map save of a partial view would otherwise tombstone the rest of the board — tools/test_access.mjs pins this, wired into qa_gate/presync/validate); /api/gmail/intake items+calls filtered (unattributed rows stay owner-side); dismiss/calls-PUT/techam 403 outside scope. Workflow page mirrors it: 🔒 badge, client roster locked, plan rows filtered via inScopeClient. MODULE ACCESS (Ray, Sep 2026: "select individual module access for each person"): a directory row ALSO carries `modules` — the grantable feature modules (`MODULES` in access.js: workflow, deck-builder, feedlab, labels, ptypes, golden, volume, overlays, kwcal, aiquote, pricer, playbook) that signin may open. Absent/null = ALL (every existing signin unaffected); [] = none (landing only); owner = all. Enforced SERVER-SIDE on page serves (accessOf → `moduleDeniedHtml` 403 for a route in `MODULE_PATHS` outside the grant; the landing `/` is never blocked) and mirrored in the chrome by `MODGATE` — an injected `window.__FCCMOD` (the caller's granted slugs, or null=all) + a tiny script that hides ungranted `.tb-modules` links at runtime, so the STATIC nav stays byte-identical (check_nav parity holds). /leadership + /activity are NOT grantable — they stay owner-only. Client scope (`clientMatch`) and module grant are independent (a full-house signin can still be module-restricted). The 👥 panel gains per-person module chips (All/None); `/api/access` GET ships the `MODULES` registry, `?me=1` carries `modules`; sanitizeDir validates slugs. Seeded: Andrew (andrew@aroxo.com) — listed, unrestricted, tune in the panel. tools/test_access.mjs pins the dimension. 👁 VIEW-AS (owner preview): 👁 on an Access-panel row sets cookie `fcc-viewas=<email>` (2h max-age) → the worker — ONLY when the real Access identity is OWNER_EMAIL (viewAsOf; inert for everyone else, can never widen) — resolves accessOf AND every owner gate (realOwner: /activity, /leadership, /api/activity, pushlog, tasks/remind → 403 + exit link via viewAsExitHtml) as that signin, so Ray sees exactly their FCC; /api/access?me=1 carries viewAs{real,as} → injected docs/viewas_widget.html renders the fixed "Viewing as X · scope [Exit]" pill on every app page (inert without server confirmation); previewing yourself = no-op
GET|POST /api/claude            → Tachyon copilot proxy to Claude Messages API (needs ANTHROPIC_API_KEY secret)
```
- **Injected on app pages** (not client decks): the live editor widget, **FCC-PRESENCE**
  (`docs/presence_widget.html` — Google-Docs-style live avatars in the topbar: each open page
  heartbeats `POST /api/presence` per minute while visible, worker stamps the Access identity
  into KV `presence`, avatars = active ≤3min with green dot + name·page·ago tooltip; popover
  shows ONLY who is ACTUALLY LIVE right now — no always-on watchlist (Ray, Sep 2026: "only
  allow me to see who is actually live and using the dashboard"), so an offline teammate simply
  doesn't appear; heartbeats deliberately NOT in the activity log), the **Feed Chat bubble** (docs/feedchat_widget.html — the chatbot
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
