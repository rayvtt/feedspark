# Services & Pricer — audit → package proposal → debrief → rollout

Ray, 7 Oct 2026: *"attach and transform /pricer a little bit"* — the Pricer becomes the tool AMs use to take a
client from the Golden Record audit to a priced services proposal, debrief them, and track the services rollout.

Live at `/pricer` (module slug `pricer`, nav link unchanged; h1, topbar tag and footer read **Services & Pricer**).
Engine `docs/pricer_engine.js` (UMD `PricerEngine` v2.0.0, served at `/pricer/engine.js`). Stores in KV only — no
client figure or price is in git. Harnesses: `tools/test_pricer.mjs` (engine), `tools/test_pricerstore.mjs`
(the six stores), `tools/check_pricer.js` (Playwright, the page). `tools/pricer_stub.js` hands the browser
tripwires a synthetic book ("Northwind", "Thornfield" — invented brands, made-up figures).

Every figure is **ex VAT**. One-off and monthly are **always shown apart**. Nothing annual, no ×12.

---

## 1. The page, top to bottom

| # | Section | What it does |
|---|---|---|
| 0 | **Client bar** (the hero, never folded) | Source — **Stored** · **⚡ Live** · **⇪ File**; the client (`<select id="brand">`, so the hours badge follows it); one chip per **Google Shopping** market (a Meta `-fb` market is never listed — the bar says how many it left out), each with its status (`stored` · `counting… n%` · `live ✓` · `failed` · `never scanned`) and, when selected, its **language group**; the client's derived **stage**, its **AM** (Task Manager) and the **next step**. A failed count (or a live read that returns no products) offers a **typed parent count**. Deep link `?client=&market=gb,de&pkg=go%2Bar` — the page also accepts `pkg=go+ar` (a `+` in a query string reads as a space, so the page maps it back), `t1` and `t2`. In ⇪ File a **client-scoped signin** is told up front that a prospect proposal needs an unscoped signin, and 💾 Save is disabled there. |
| 1 | **Audit** | Eight readings per market — read the feed (SKUs · parents · variants per product), Golden coverage (re-scored under the brand's *current* profile), content quality, taxonomy depth, keywords, AI-readiness + conversational n/6, new products a month, packages. A reading nobody has made says *why* ("not measured — …"), never 0. |
| 2 | **Proposal** | **What changes in the feed** first: a Today · Tier 1 · Tier 2 switch over ONE of the client's own products (picked off the live/file stream — the one with the most gaps, its own image and values; every field one line) beside one column of the market's own coverage per attribute, every row one line so the whole card fits one screen. Under a tier each field the option fills shows a **Spark AI example value for that product** (Ray, 7 Oct 2026: "allow actual data being populated … pattern for this trouser would be: plain … keywords: FS 10+ strings") — one `/api/claude` call per product on the first tier switch, cached for the session, sent the product's image and its own feed row and asked for strict JSON: a MASK title, an enriched description, a Google taxonomy path, a 4–5 level product_type, 10–14 keyword strings, colour / material / pattern / gender / age group / size type / size system, 4–6 highlights, product details, two Q&As, the item group title — only from facts in the image or the row, null otherwise. It never generates an identifier, a size or a price, and the four fields built in FeedHero or scraped (document link, related products, variant options, popularity rank) show HOW, not a value; the card says the values are an example ASPL and the AM review, and until Spark AI answers (no Claude key, or an error) every field shows an example **built from the product's own row** (`pvDerive`: a MASK title from brand · who · material · colour · product; the row's product_type one level deeper; 10–14 keyword strings made only of the row's own words; colour / material from the column, else the title/description/composition — the largest share wins; pattern from the words, else *Plain*, said so in the tooltip; size type from the words, size system from the market; highlights from the description's own sentences; product_detail XML read as section: attribute: value) — never a GPC, identifier, size or price. The product image sits in its own column, drawn at its own aspect (contain, up to 360px tall), never cropped. A field in the option whose line is still *price to follow* shows its example tagged **✦ T1 · £ tbc** while the bars and the score stay on what is priced — the bars fill, the Golden Score counts up — drawn as /golden's own score ring (Ray, 8 Oct 2026: "if it's score, mirror the circle score from golden score module": the same r52 arc on a 120 box, 11 stroke, round cap from twelve o'clock, coloured by the audit band) — and the rows an option fills sweep as you switch; the filled attributes are the engine's own (`projected.fixed`), an unfilled row says who closes it (the projection's gap tags). Then Tier cards, **written for a head of marketing** (Ray, 7 Oct 2026: "too much text — repackage / revisualise, expandable details if needed — fast / bite-size"): each card leads with three things — the Golden Score as a bar from now to after with the 99% line marked (a pill counts the fields still below it, named in its tooltip), *what you get* as chips of a number and a few words (`12 titles rewritten`, `38 colour · material · pattern values £ tbc`; the bundle shows *✓ Everything in Tier 1, plus* and only what it adds), and the two prices with one line each — then one line for new products, the saving, the time to live and how many lines are still to price; **every working figure is folded under ▸ See the breakdown** (block maths, rates, the line table with → Brief, the fixes, what Ray confirms). The cards are **Tier 1 · Google-ready** (*Google Optimise — eligible + everything Google recommends*), **Tier 2 · AI-ready** (*Google-ready + AI Readiness — the bundle*, one quote over the union), and **AI-ready only** (*AI Readiness without Tier 1*) when every market already projects Golden 95+ (or the AM ticks it). Per card: Golden now → after per market, one-off and monthly apart, both hourly rates labelled, **every new product £** (a market whose new products an AI Quote bundle already covers reads *covered by QT…*), the honest always-on line, the **test package** line when one is chosen, every line with its need, £ and status, the unsized / unpriced lines with their **fix**, and the blockers. An option with nothing sized reads **not sized — see below**, never £0 (the step-8 line and the phone digest say the same). ⧉ Copy (the email, guarded) · ⧉ Options · 💾 Save as proposal · ✉ Debrief · ⚙ Customise. |
| 3 | **Debrief kit** | Talk track (5 bullets), the client's own offending products (`goldenqual` examples), flags to raise first, the email in two tones (direct / consultative). Exits: ✉ Create Gmail draft (existing `/api/labels/askdraft`), ↗ Open in Gmail (compose link with the account AM on **CC** unless that is you), ⧉ Copy, → Deck brief (copies a brief for the Deck generator). |
| 4 | **Services rollout** | Stage KPIs and one row per account (My accounts by default): **From** (scheduled work + skip rate, AI briefs, retainer balance) → **To** (latest proposal, chosen?), stage + days in it, next step + due (overdue in red), always-on. A row click loads the client. Rows become cards on a phone. |
| 5 | **Roadmap & quick wins** (folded) | Line × industry delivery status, editable and stamped; `quickWins()` read off the book with *Load client*; the **delivery plan** (`DELIVERY_PLAN`). |
| 6 | **Rate card — three teams** | Tabs **ASPL** · **London AM** · **Management 🔒** · **Spark AI** (read-only). Every cell's tooltip says who set it and when. |
| 7 | **Custom quote** (folded) | The original per-optimisation builder, unchanged in behaviour (scaffolds and the monthly refresh select kept); "ex VAT" and "Spark AI" in its client copy; it now prices off the **same** composed rate card and redraws whenever that card moves (a store load, a cell edit, the 90 s poll), so the figure on screen is the one ⧉ Copy quote and 💾 Save carry. |
| 8 | **AI briefs — delivery tracking** (folded) | Title-scanned briefs, token economics, per-brand totals; its averages are the rate card's *actuals*. The *Tachyon task* dropdown offers every id the engine tags (the catalogue plus the package rows, so an attribute-population brief reads as itself, never *— pick —*). |
| 9 | **Saved proposals & quotes** | Proposals grouped by proposal id, each **counted once** (`countedOption`: the chosen option, else the lowest-numbered); legacy custom quotes below. |

---

## 2. The audit — three lanes, one AUDIT

`PricerEngine.auditStored` / `auditMerge` normalise every lane to one shape (spec §2).

- **Stored** — KV reads only, instant: `/api/golden/estate` (coverage, GPC scope, AI-readiness),
  `/api/golden/quality` (content-quality rule hits, examples, highlight distribution), `/api/ptypes/estate`
  (product-type depth), `/api/volume/arrivals` (first-seen dates), `/api/golden/profile`, `/api/golden/pdp`.
  Where a stored reading cannot count exactly the need is a **bound** (*at least … up to …*), a **ratio** (an SKU
  count taken to parents at the exact S/P) or an **SKU ceiling** (parents not counted yet) — each shown as a chip.
- **⚡ Live** — the stored paint first, then the market's wired feed is streamed **once** (the existing parent-count
  stream, `countParents`) and fanned out: `parentCounter` (the custom quote), the engine's `needCollector`
  (exact needs per parent), labelguard's `xmlCollector` (coverage, GPC scope, keywords, dates) and — only when the
  market has no stored content-quality reading — labelguard's `qualityStream`. Markets stream one at a time; each
  client|market is read once a session. A parser handing a row NUMBER as its second argument is never mistaken for a
  live header.
- **⇪ File** — a prospect's CSV / TSV / XML is read in the browser (UTF-8, falling back to Windows-1252; sniffed by
  `FeedCatalog.sniff`), scored under the **industry the AM picks**. New products a month read the file's own
  first-seen dates, or say plainly they are FeedSpark's 10.5% a year working estimate.

labelguard is loaded by `fetch('/labels/engine.js')` → Blob → `import()` (the `/golden` loader); the other engines
are fetched and run, so the browser tripwires serve them from a stub.

**Gaps are not zeros.** An unmeasured need makes a line **not sized**; an unset unit price makes it **not priced**.
Both are listed with their fix and kept out of every total; the headline reads *from £X · N not sized · M not priced*.

---

## 3. The packages

`PricerEngine.packageQuote` — §4.1 of the spec, line for line:

- **Unit = the parent product** (distinct `g:item_group_id`); attribute population is priced per **value**.
- **One volume factor per proposal**, β = tieredUnits(Pβ)/Pβ over the weighted parent count, applied to every
  generation line. Markets sharing a language: the lead (largest) is written, the rest at the **re-use %**.
- **Set-up hours rounded to blocks once** over the whole option, at the Pricer block (Management's `_g|blockGBP`).
  The conversational six use **Spark AI's own engine** (a verbatim twin of the AI Quote's `aimBuild`) at Spark AI's
  rates — both rates are printed on the card, never a silent one.
- **Monthly** = monitoring blocks (or absorbed) + **every new parent through the full package** (Management's floor
  applies) + Spark AI's monthly. *Every new product £* is printed per market. The always-on line names today's
  mechanism (the AM's weekly / fortnightly / monthly ASPL run) and says *on arrival* only once roadmap key
  `alwayson|*` is **live**.
- **Client-safe guard**: while any blocker stands (draft rates, an unsized / unpriced / estimated line that is
  included, an unconfirmed roadmap status, re-use unset across two same-language markets), client copy shows
  **[£ to confirm — Ray]** for every figure and "Mark sent" is disabled. Saving is always allowed; a saved option
  records `clientSafe` and its `blockers`.

**Customise** (⚙): lines on/off and scope (products needing it · every product), description target in
characters (160 / 300 / 500 / 1,000), highlights to 6+ (house) or 4+ (Google's floor), product-type depth 3/4/5,
conversational routes per attribute, highlight sources (description, source feed, product page — disabled when the
PDP blocks the scanner — reviews, which needs a client reviews feed), new products priced as incomplete as today or
every attribute, retainer hours (with the Task Manager balance beside it), today's run, include contracted, offer
AI-ready only, and a **test package** — None / 2 / 3 / 4 tests a month. Every Customise setting (and the language
groups) belongs to ONE client: loading another client starts from the defaults, and ↺ Reset restores every group,
the highlight sources included.

**Test packages.** *Each test changes one thing on a set of products — a title pattern, a keyword theme, an
attribute or an image — runs it against a control on Google Shopping, and reports back; a winner rolls out, a loser
is rolled back.* A package rides on any option as a flat monthly line (no one-off, outside β, the bundle % and the
floor). Its price is Management's (`_g|test2`, `_g|test3`, `_g|test4` in `pricerprice`); until Management enters one
it reads the DRAFT default (£800 / £1,140 / £1,440 a month) and the proposal is not client-safe. The client email,
⧉ Options and the talk track name it when it is on.

**Tier 3 · AI-Intel Refresher** (`go+ar+rf` — Ray, 8 Oct 2026: *"a tier-three product of AI-ready datasets, such as data
fields like Q&A, keywords … refreshed on a monthly or quarterly basis, depending on the marketing event / customer
questions / AI-visibility monitor / customer reviews"*). Tier 2's lines unchanged (one-off identical, the bundle % is
Tier 2's), plus a recurring refresh: the ticked fields (Keywords · Q&A · Product highlights by default, Descriptions
optional) regenerated over 25 / 50 / 100% of the catalogue each refresh, read against the ticked signals (marketing
calendar moments · customer questions & search terms · AI-visibility monitor · customer reviews). Price per field =
`_g|rfPct` (Management, DRAFT 50% until set — the guard holds the figure back) × that field's own generation price
(Q&A at Spark AI's per-field rate) × the catalogue × β. A quarterly refresh is charged a quarter at a time and counted
as a third of it in the monthly total, so the options compare on one footing. Not costed yet (out of both sides of
the margin, like test packages); an unsized feed reads "not sized", never £0. Settings live in ⚙ Customise and travel
with the saved option (`opts.popts.refresh`); `?pkg=t3` highlights the card.
Renamed **Tier 3 · AI-Intel Refresher** (Ray, 8 Oct 2026). The refreshed fields are its **Dynamic fields** — 3 by
default (Keywords · Q&A · Highlights), up to 6 with Descriptions, Titles and Product details — counted in the preview's
KPI row when Tier 3 is on screen. The preview card carries no explanatory note or footnote any more: where an example
value comes from is the product image's tooltip.

---

**Five example products, prepared ahead** (Ray, 8 Oct 2026: *"pre-loaded population for 5 products examples per
brands ahead to run this audit live with client — and ideally all missing have to be filled when Tier 2 AI-ready is
selected"*). The live read keeps the FIVE products with the most gaps (one per item group / title stem); ‹ › steps
through them. **⟳ Prepare examples** keeps this market's five with their example values (Spark AI's when connected,
else built from the row) in KV `pricerex:<client>` via `/api/pricer/examples` (GET ?client=, PUT one market; Pricer
gate + client scope; product data in KV only). **Prepare every brand** does each brand's lead market (GB first) in
turn, skipping one prepared in the last 14 days. A prepared market opens at once — in Stored mode too — with no feed
read and no Spark AI call, the chip reading "✓ pre-loaded <date> · <who>". On the product card **Tier 2 leaves
nothing missing**: a gap no priced line closes is filled by the Spark AI work already contracted ("✓ contracted") or
in the Tier 2 delivery (tooltip says so, Google's own value — unisex / adult / regular — where the product names
none); the bars and the Golden Score still move only with priced lines.

---

**The optimisation bank** (Ray, 8 Oct 2026: *"a bank of different optimisation to be allocated flexibly between tiers
… when added / removed / changed between tiers it should be reflected in the audit + pricing quote"*). One registry,
the **Optimisation bank** section on the page, KV `pricerbank` (`/api/pricer/bank`, house-wide, Management-written):
every built-in package line with its tier (T1 / T2 / T3 / Off) and the phrase a Head of Marketing reads ("+4
highlights per product", "+5–8 product details per product" …); optimisations the team adds (`x_<slug>`: the feed
fields they fill, £ a product, set-up hours, £ a month, a delivery status — no price reads "not priced", never £0;
planned / building reads coming); and **services** that write no feed field — Stock range completion ("Stock RC%")
and Restock alerts are seeded into Tier 2, "included" until Management sets a monthly £. `packageQuote` reads the
bank for every option (`bankOf`, `inOption` — a tier carries every tier below it), so a move shows on the tier cards,
the preview (Today / Tier 1 / Tier 2 / **Tier 3**, with a "What <tier> gives" strip and ↻ on refreshed fields), the
projection and its gap tags ("in Tier 3"), the quote, ⚙ Customise's line list and the client copy at once. A team-added
feed line is priced like generation over the products its fields leave empty; services are out of both sides of the
margin.

---

## 4. Saving, options and buy-in

**💾 Save as proposal** stores every shown tier as an **option** of ONE proposal (`prop {id, n, label}`), each
with its own `SVC123456` reference (`-2`, `-3` the same day) — a frozen snapshot the page renders and exports
from (`snapshotOption`; cost figures never travel). An option over 60 KB is refused before the save (too many
markets in one go) and names the tier that is over.

Per option: **✓ Chosen** (choosing un-chooses its siblings — a sibling then reads *Not taken*, never Declined),
**Mark sent** (disabled while not client-safe), **Declined**, **✎ New version** (loads it back into the bar; the
next save writes the replacement at the same option number and stamps the old one `superseded`), **✕** (a
`deleted` stamp — out of the pipeline). **➕ Add option** on a proposal makes the next save add the shown tiers to
it. On a prospect's (⇪ File) option both return to ⇪ File with the prospect's name, market and industry filled in
and ask for its feed file again; a save is refused if the client on the bar is not the proposal's own. Gmail draft /
Open in Gmail from a saved, client-safe proposal record `sentAt`.

**The debrief email.** The client contact belongs to the client it was filled for — loading another client brings
that client's remembered contact (or an empty field), and an address another client is remembered by is asked about
before anything is drafted to it. An email the AM edited is **kept** when the figures move (the kit says so and
offers ↺ Regenerate); a tone or source switch asks before replacing it. ✉ Create Gmail draft refuses a body over
8,000 characters (the Drafts bridge keeps no more) and points at ↗ Open in Gmail / ⧉ Copy.

The client's **stage is derived**, never written (`rolloutStage`): Declined › Always-on live › Agreed (any chosen) ›
Proposal sent › Debriefed › Audit ready › Not started.

---

## 5. The three-team price card

| Tab | Who | Fields (KV store) |
|---|---|---|
| **ASPL** | the AI team | set-up hours, lead days, attended minutes / 100, tokens / product (`pricerops`); tracked tokens / product from the AI-briefs averages beside it; hours per FeedHero rule, set-up hours per extra language (`_g`) |
| **London AM** | London | QC h, PM h, monitoring h / month, QC share %, QC minutes, note (`pricerops`) |
| **Management 🔒** | owner or the opt-in **`pricer-cost`** grant | £ / unit, block £ + hours, the volume ladder, Tier 2 bundle % (generation only), re-use %, monthly floor, package version, the **test packages** (2 / 3 / 4 tests a month, £ a month) (`pricerprice`); cost rates, £ per million tokens + as-of date, overhead %, target margin (`pricercost`); outputs per row (loaded cost, list margin, floor check at the lowest ladder band, suggested £, set-up cost) and the current build's Tier 2 margins (`costModel`, Spark AI left out of both sides) |
| **Spark AI** | read-only | Spark AI's rate card as `/aiquote` keeps it |

Every value is `{v, by, at}` per `<row>|<field>`, stamped by the server, so ASPL and London editing the same row at
the same moment never clobber each other. The legacy `tachyonrates` card is read as a **fallback only** — the page
no longer writes it. Per field the first number wins: team store → legacy card → tracked actuals (with the toggle
on) → the catalogue default (`composeRates`). The custom quote prices off the same composition.

**Access** — every Pricer signin reads the sell price; only Management writes it; cost is never read for an AM
signin (the worker refuses with 403 before touching the key) and the Management tab is not drawn.

---

## 6. Stores and routes (worker)

`/api/pricer/{ops, price, cost, proposals, rollout, roadmap}` — kvmerge maps under `X-Sync-Base`, each saved as a
whole map with retry and backoff (an edit made during a save is re-applied on the merged answer, so a colleague's
key is never deleted by our next save). A key a colleague changed after this page loaded is **kept** by the server
and listed in `_rejected` (*changed by … since you loaded — reload to edit it*); the page reports only the keys it
changed itself and re-adopts the merged map. A 400 / 403 / 413 (the proposals store full) is said once and never
retried. `proposals` is client-scoped by the record's own client, `rollout` by its key; `roadmap` is house-wide. See `cloudflare/feedspark-deck/src/pricerstore.js`.

---

## 7. How the change is delivered

`PricerEngine.DELIVERY_PLAN` (rendered read-only in section 5): this PR ships proposals from stored scans plus the
automatic live count, the three-team price card, the debrief kit and the rollout tracker. Then Ray / Management,
ASPL, London AM and the team each have a short list (below); the "Next" and "Later" items follow.

---

## 8. Open items for Ray

1. **Set the package prices (≈15 min, Management tab):** the `attr_pop` unit price (attribute population is
   *not priced* until then), the Tier 2 bundle %, the re-use % for same-language markets, the monthly floor, a
   package version and the three test-package prices (draft £800 / £1,140 / £1,440 a month until confirmed).
2. **One published hourly rate, or two labelled?** Today a proposal can carry the Pricer block (£585 / 8h default)
   for set-up and Spark AI's own rate for the conversational lines; both are printed. Management's call.
3. **"Spark AI" in client copy** — confirm the name (it matches the AI Quote and the website).
4. **Description target: 500 characters, or 500 words?** The page measures characters (Google's 1–5,000, key facts
   in the first 160–500); "500 words" is flagged on every debrief until confirmed.
5. **ASPL** to enter attended minutes, tokens per product and hours per FeedHero rule for the package lines;
   **London AM** to enter QC share, QC minutes and PM hours — this clears the draft flags.
6. **Team** to confirm delivery status per line × industry and `alwayson|*` in the roadmap grid — an unconfirmed
   line stays a blocker on client copy.
7. **Grant `pricer-cost`** to whoever in Management should see cost and margin (👥 Access panel, an opt-in chip).
8. **AI-Intel Refresher price:** confirm `_g|rfPct` (draft 50% of each field's generation price, per refresh) and the
   default fields (Keywords · Q&A · Highlights).
8. **The Gmail Drafts bridge** does not carry a CC yet: ↗ Open in Gmail does. Adding it means the next
   `tools/gmail_push.gs` paste (a follow-up).
