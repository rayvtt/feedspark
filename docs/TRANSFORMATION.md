# FCC AI transformation — migration register and plan

Ray, 24 Sep 2026: *"Every data set for each product we build will have to move onto the FeedHero or
FeedSpark server … deploy a few agents to work on a month-by-month migration roadmap until
completion … develop a roadmap for a live dashboard migration so I can keep track with my management
and senior team … an internal roadmap to get all account managers to use the dashboard … 70% of our
FCC will be a fixed module … 20–30% customization."*

**The live tracker is `/transformation`.** This document holds the evidence behind it. It was
produced by three read-only audits of the code on 24 Sep 2026: a dependency inventory, a module
classification and a target-architecture design. Line numbers drift, so use the named functions.

---

## 1. The tracker (`/transformation`)

- **Content lives in git.** The months, milestones, decisions, KPIs, risks, the 70/30 model and
  the options are defined in the page itself, between `/* RM:START */` and `/* RM:END */`. Change
  the plan through a PR.
- **Status lives in KV `transform`.** This covers status, owner, notes, decisions as recorded,
  measured KPIs, risk ratings, AM names and role holders. It is served by `GET|PUT /api/transform`,
  which uses kvmerge per key with `X-Sync-Base`, the same concurrency rule as the build queue. Two
  managers editing different rows both keep their changes. Every change is stamped with the
  editor's name and the time.
- **Access is opt-in.** `transformation` is the only module with `optIn: true` in
  `src/access.js`. An unrestricted signin (modules `null`, which is every AM who was never dialled
  down) does **not** receive it. Only the owner and a directory row that names it can open the page
  or call the API.
  - To grant Andy or Matt: open 👥 Access in Workflow, find their row (or add it), tick
    **🔒 Transformation**, then Save.
  - The All/None button never ticks this chip.
- **⧉ Copy status update** produces a plain-text update for the management email: overall
  progress, this month, late, blocked, decisions due, red risks. **⬇ CSV** exports every milestone.
- **No money on the page.** The page is read by the people the programme rate will be
  negotiated with, so `tools/test_transform.mjs` fails on any `£` figure or rate wording in it.
  Commercial terms for running the programme are kept outside the repo.
- **Harness:** `tools/test_transform.mjs` checks the roadmap shape (every month has a gate, every
  owner is a role), the progress maths, the status update, the opt-in gate and the no-£ rule. It
  runs in qa_gate, presync and validate. The page also passes check_nav, check_mobile,
  check_darkmode and check_csp.

---

## 2. Recommended path: staged (option C)

| | A · Transfer ownership | B · Re-host on FeedSpark servers | **C · Staged (recommended)** |
|---|---|---|---|
| What | Repo to a FeedSpark GitHub org; FeedSpark Cloudflare account (Workers Paid); Access on FeedSpark's Google Workspace; `fcc.feedspark.com` | Node or workerd on FeedSpark Linux; KV → MySQL/Postgres; crons → server cron; FeedSpark SSO | A first, then the **data** moves to a FeedSpark database behind a storage adapter, one family at a time; moving the **compute** is a separate decision in April |
| Effort | 3–4 person-weeks | 16–24 person-weeks + IT build | A + 10–12 person-weeks |
| Risk | Low | High: big-bang on one developer, no staging today | Medium-low: every step reversible |

**Why C:**
- A removes most of the personal-account risk within weeks, before peak.
- The costly and risky part of B is data plus identity. An adapter makes that incremental.
- Moving compute off Cloudflare has the lowest value and the highest cost, so leadership decides
  it in April with real data.
- The paid Workers plan also lifts the 50-subrequest cap the scans are built around, and dual-write
  needs that headroom.

**Timing.** Black Friday is 27 Nov 2026 and FeedSpark's clients are retailers. From
**13 Nov to 8 Jan** there are no cut-overs, because the feed guards matter most in peak. That makes
completion end of March 2027, with April for hypercare. If the April compute decision is "move to
FeedSpark servers", add April–June 2027.

---

## 3. Dependency register

### 3.1 Personal-account dependencies (KPI baseline: 7; target 0)
1. The repository `rayvtt/feedspark` (personal GitHub). It is also hard-coded in `/api/buildlog`.
2. The Cloudflare account behind `feedspark.ray-vtt.workers.dev`: worker, KV namespace, Zero Trust apps.
3. The `ray-vtt.workers.dev` host, hard-coded in **11 files**: worker email links, `taskremind.js`,
   `tools/{xml_scan,golden_daily,estate_rescan,plan_ingest}.mjs` (`FCC_HOST`), `tools/gmail_push.gs`,
   and docs.
4. **The Apps Script in Ray's own mailbox** (`tools/gmail_push.gs`). It pushes inbox capture, brief
   replies, call notes and keyword results, and it **sends** every alert, report and reminder
   email, creates the drafts, and forwards to TechAM, all as Ray.
5. Gmail API domain-wide delegation impersonating `ray@feedspark.com` (`GOOGLE_IMPERSONATE`,
   `GMAIL_SELF`).
6. The Google service account's GCP project (owner unconfirmed).
7. The Anthropic API key's account (owner unconfirmed).

### 3.2 Secrets (17, all to be re-issued into FeedSpark custody)
- **Worker:** `ANTHROPIC_API_KEY`, `GOOGLE_SA_JSON`, `GOOGLE_IMPERSONATE`, `GMAIL_PUSH_KEY`,
  `GMAIL_SELF`, `TASKS_INGEST_KEY`, `TM_MCP_TOKEN` / `TM_MCP_AUTH` / `TM_MCP_URL`,
  `ROAS_MCP_TOKEN` / `ROAS_MCP_AUTH` / `ROAS_MCP_URL`, `GITHUB_TOKEN`.
- **GitHub Actions:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FCC_PUSH_KEY` (the same
  value as `GMAIL_PUSH_KEY`), `FCC_ACCESS_CLIENT_ID` / `FCC_ACCESS_CLIENT_SECRET`.
- **Apps Script:** the push key is pasted into the script body.

### 3.3 Scheduled jobs (8 to re-home)

| Job | Schedule (UTC) | Runs |
|---|---|---|
| Worker cron | `0 * * * *` | Label Guard sweep + plan-sheet warm; 12:00 due reminders |
| Worker cron | `30 * * * *` | hourly custom watches (+ sweep) |
| Worker cron | `0 7,17 * * *` | twice-daily watches + report email |
| Worker cron | `15,45 * * * *` | Task Manager pull (feedspark-reports MCP) + book rotation |
| Worker cron | `10,40 * * * *` | ROAS pull (FeedHero reports MCP) |
| Actions | `xml-scan.yml`, 4× a day | every FeedHero XML feed → `/api/gmail/push {xmlscan}` |
| Actions | `golden-daily.yml`, 08–10 UTC | content quality + AI-readiness at 09:00 UK |
| Apps Script | every 5–15 min | `syncFCC()` in Ray's mailbox |

Also: `deploy.yml` (push to main), `validate.yml` (PRs), and the manual `estate-rescan.yml` and
`plan-ingest.yml`. The news-digest Routine pushes straight to main.

### 3.4 The live store
- There is one KV namespace (`EDITS`), with **no wrapper**: 393 direct calls, all in `worker.js`
  (242 get, 133 put, 15 delete, 3 list). The pure `src/*.js` modules never touch KV.
- It holds about 100 key families. Grouped:
  - **Commercial / personal (sensitive):**
    - `briefs`, `clients` (contacts), `accessdir`, `state:<ns>` (22 namespaces incl. `hourspost`)
    - `tm:*` / `tmtasks:*` / `tmbook:*` / `tmtick:*` / `tmhours` / `tmtrail` (retainer hours)
    - `roas:*`
    - `aiquote*`, `tachyon*` (pricing)
    - `materials` + `matblob:*` (binary decks)
    - `gmailinbox`, `callactions`, `kwresults`, `labeloutbox`, `labeldrafts`, `techamq`
    - `labeldest` (webhook URLs)
    - `act:*` (activity log, user emails, 90-day TTL, **value in metadata**)
  - **Feed-scan state (low sensitivity, alert-critical):**
    - `label*`, `ptype*`, `golden*`, `overlay*`, `image*`, `vol*`, `feedaudit*` per client × market
    - their `*idx` / `*alerts` singletons
  - **Caches:** `planlive:*` (TTL), `buildlog:gh` (TTL), `presence`, `pdphost:*`.
- **KV features in use:** TTL on 7 families, `list({prefix,cursor})` returning **metadata**
  (`act:`), binary values, and prefix listing. It does **not** use getWithMetadata, cacheTtl or
  bulk operations. All of these map cleanly onto SQL.

### 3.5 Data committed to git (moves with the repo; DPIA item)
- **Client decks and pricing:** `docs/materials/*.pptx` (2.5 MB, 5 bundled into the worker) and
  `reference-files/` (2.5 MB, incl. a client quote workbook).
- **Client operational data:**
  - `tools/plan_exports/*.csv` (1.2 MB)
  - `ops/schedule/*.json`, `ops/ingest`, `ops/calendars`
  - `docs/reports_hours.json`, `docs/plan_tasks.json`
  - `docs/feedback/`, `docs/meetings/`, `docs/calseed/`
  - the client strategy-review HTML decks
- **Staff emails:** in `ACCESS_SEED` and `taskremind.js`.
- **Git history** keeps every earlier version of all of the above.

---

## 4. Storage adapter (how the data moves without a rewrite)

- **Adapter.** A new `src/store.js` mirrors the KV surface exactly: `get(key,type)`,
  `put(key,value,{expirationTtl,metadata})`, `delete`, and `list({prefix,cursor,limit})`. It also
  adds `merge()`, which wraps kvmerge; on SQL that runs as one transaction (`SELECT … FOR UPDATE`)
  and closes kvmerge's documented same-millisecond race.
- **Installed once.** `fetch()` and `scheduled()` call `env = withStore(env)`, so the 393 call
  sites stay unchanged. The six source-grep tripwires that match on the literal `env.EDITS` keep
  passing.
- **Backends:** `KvBackend`, `SqlBackend` (Hyperdrive or a FeedSpark data API), `BlobBackend`
  (object storage for `matblob:` and anything over ~1 MB), and `DualBackend`.
- **Schema.** `kv_item(key PK binary-collated, family, value, vtype, metadata JSON, expires_at,
  updated_at, version)`.
  - A reaper job enforces TTLs.
  - Binary collation keeps `list` in the same order as KV.
- **Per-family modes** are set in a `STORE_MODES` var, so no deploy is needed to change them:
  `kv` → `dual_write` → `shadow_read` → `sql_primary` → `sql`.
  - **Backfill** runs *after* dual-write starts, with version-guarded upserts.
  - A **nightly reconciler** publishes parity per family.
- **Gate per family:** at least 14 days of shadow reads at ≥ 99.9% parity, with qa_gate green.
- **Rollback:**
  - From `sql_primary`, the mode flips back and KV is still current.
  - After `sql`, KV stays read-only for 90 days and a reverse export exists.
- **Cut-over order, lowest blast radius first:**
  1. caches
  2. feed-scan state
  3. settings and outboxes
  4. activity log
  5. commercial data

---

## 5. AM operating model: 70% fixed, 30% customisable

### 5.1 Classification

Measured by code size across 19 pages and 11 widgets (≈ 4.1 MB), the split is
**fixed 68% · configurable 31% · extension 1%**.

- **Fixed core** (same for everyone; change by reviewed PR only):
  - Feed Lab, Label Guard, PT Guard, Golden Record
  - Product volume, Overlays, Image library
  - Keyword calendar, Scheduled work
  - AI Quote, Pricer, Deck generator, Feed Chat
  - Leadership and Activity
  - platform chrome: hours badge, phone layer, presence, sign-in, instructions collapse
- **Configurable core** (same code, per-AM settings):
  - Command center and brand dossier
  - Workflow and the Playbook
  - FS Task Manager
  - the menu layout
- **AM modules** (the growth zone):
  - `/x/<name>` modules built from a checked JSON definition (cards, tables, charts, filters)
    over approved, client-scoped data sources. No AM-supplied scripts.
  - ROAS is the reference shape: one read-only view over one data source.

### 5.2 Mechanisms that already exist
- Per-user module grants and client scoping (`src/access.js`, 👥 Access).
- View-as.
- Shared-state namespaces.
- The nav customiser.
- Task Manager saved views.
- The build queue and suggestions.
- Per-page feedback.

### 5.3 Missing before AMs can build their own
1. **A custom-module spec and renderer.** There is no `/x/<slug>` route that renders a validated
   definition, and no dynamic registry: `MODULES` is static, and `check_nav` requires an identical
   static nav, so AM modules belong in the ▦ apps bundle.
2. **Scoped data providers.**
   - `/api/clients`, `/api/kwcal`, `/api/labels/*`, `/api/golden/*`, `/api/aiquote`,
     `/api/tachyon/*` and `/api/feed/*` return every client.
   - `get_ticket_detail` is never called.
   - Desk Manager is not connected at all.
   - The ROAS roster is fixed in code.
3. **Server-side per-AM settings.** Personal state is either one browser's localStorage or
   house-wide. Nothing like `prefs:<email>` exists.
4. **Scope comes from a hand-kept list.** The Task Manager's `primary_am` is not used to derive
   it.
5. **A wishlist with a requester.** The queue lives on the owner-only `/activity`.
6. **A promotion path** (draft → shared → candidate → core) with a harness requirement.
7. **A team-lead role.** Today there is only one owner.

### 5.4 Ray-only assumptions that break with five more AMs
- **One owner.** `OWNER_EMAIL` alone manages access and sees Leadership, Activity and the
  presence roster.
- **Open by default.** A signin without a directory row sees **every client**. Set each new AM's
  profile before they first sign in.
- **One mailbox.** Intake, brief sync, call notes and TechAM forwards come only from Ray's mailbox.
- **Plan sheets are hard-coded twice:** `PLAN_SHEETS` in `worker.js` and `PLANSHEET` in
  Workflow.
- **Hard-coded people:**
  - Workflow: `DEFAULT_AM='Ray'`, `FS_AMS`, `AM_OF`, `FS_PEOPLE`, and email templates signed "Ray"
  - KWCal: `KW_PEOPLE`
  - taskremind: `OWNER_EMAILS`
- **Alerts default to the owner's address,** with one global config per guard.
- **Copy edits are global.** The live editor is not owner-gated: one AM's wording change applies
  to everyone.

---

## 6. Security findings from the audit
- **The worker trusts `Cf-Access-Authenticated-User-Email` without verifying
  `Cf-Access-Jwt-Assertion`.** This is safe only while every request passes through Cloudflare
  Access. It is fixed in October ("Verify the sign-in token"), before any non-Cloudflare host is
  possible.
- **Two bypass paths are gated by shared keys only:** `/api/gmail/push` (which multiplexes about
  10 lanes) and `/api/tasks/ingest`. Rotate both keys at the transfer.
- **There is no staging environment.** Every merge to `main` deploys to production. Staging
  arrives in November.
