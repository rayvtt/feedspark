# FeedSpark FCC — Label Guard

How the Label Guard module (`/labels`) captures **g:custom_label_0–4 across every wired Shopping
feed**, per client per market, and flags drop-offs against a known-good baseline **before they
break the PMAX campaigns keyed on those values** — and how to keep it boring.

---

## 1. Why this module exists

PMAX listing groups are segmented on the **exact string values** of custom labels
(`bestseller`, `clearance`, margin buckets, seasonal cohorts…). When an upstream feed refresh
silently drops a label column, empties it, or renames a value, the campaigns that key on it break
with **no warning in any Google UI** — and the first visible symptom is cratered performance on
spend worth hundreds of thousands of pounds. Nobody can foresee when that happens; the fix is a
watcher that notices **within hours, not weeks**.

Label Guard:

1. **Captures** the full value/volume pivot of every custom label on every wired feed
   (client × market — same roster as Feed Lab: `DEFAULT_FEEDS` ∪ dossier-attached).
2. **Baselines** the last known-good state per feed.
3. **Diffs** every scan against that baseline and raises severity-ranked alerts.
4. **Flags** across the whole FCC: a red/amber count badge on the ⛨ nav icon of every app page,
   the full board at `/labels`.

## 2. Architecture — Google does the pivot, not the worker

The worker **never parses a raw feed CSV** (the Feed Lab CPU rule, see `docs/FEEDLAB.md` §6).
Instead each scan sends the pivot to Google's gviz query endpoint:

```
/gviz/tq?tqx=out:csv&headers=1&gid=<gid>&tq=
    select U, count(A) where U is not null and U != ''
    group by U order by count(A) desc limit 250
```

so Google's servers aggregate 60k rows into ≤250, and the worker parses tiny CSVs. Per feed:
**1 header probe + 1 multi-`count()` query + 1 group-by per present label ≤ 7 subrequests** —
cheap enough for the hourly cron and any manual "scan whole estate" click.

```
 Google Sheet (link-shared feed export)
        │  gviz/tq aggregate CSVs (≤250 rows each)
        ▼
 worker: runLabelScan  ──▶ scanFeed()        (src/labelguard.js — pure, node-tested)
        │                  diffSnapshots(baseline, snapshot) -> alerts
        ▼
 KV (FEEDSPARK_DECK_EDITS)
   labels:<client>:<mkt>      latest snapshot (per-label values + SKU volumes)
   labelbase:<client>:<mkt>   BASELINE — last known-good; alerts diff against THIS
   labelhist:<client>:<mkt>   [{t,rows,cov,crit,warn}] capped 120
   labelidx                   estate index (one read boots the /labels board)
   labelalerts                active alerts by "client|mkt"
   labelcron                  hourly sweep rotation cursor
```

**Scheduling:** the existing hourly cron (`wrangler.toml [triggers]`) now runs
`labelCronSweep(env)` before the plan-cache warm — **unconditionally** (no `GOOGLE_SA_JSON`
needed; the sheets are link-shared). The :00 firing scans 4 feeds in rotation, and since the Meta
import (42 sheet feeds) the :30 firing advances the same rotation by another 4 whenever its watch
pass leaves budget (≤4 hourly rules checked) → the estate is re-checked every **~5–6 hours**,
staying under the 50-subrequest free-plan budget even with the
plan warm in the same invocation.

**The three references (canonical terminology — the important bit):**

| Reference | Stored at | Moves when | Used for |
|---|---|---|---|
| **Yesterday** | `labelday:` | First scan of each UTC day promotes the outgoing snapshot | Δ columns on the dissection tables (display default) |
| **Last known-good** | `labelbase:` | Rolls forward on every clean scan; freezes while broken; "✓ Expected — accept as known-good" adopts the current state | Estate alerts (§01, badge, report) |
| **Pinned watch reference** | `rule.ref` | Only when the rule is armed or **Re-arm**ed | Custom watch rules (§06) |

Estate alerts are not "vs the previous scan" — they fire vs **last known-good**, so a feed that
broke on Friday is still flagged on Monday and a slow decay can't hide behind a daily reset. A
flagged change that was *intentional* (new season labels, re-segmentation) is cleared by
**"✓ Expected — accept as known-good"** on the page, which adopts the current snapshot as the
new known-good state.

## 2b. Channels — Google Shopping vs Facebook/Meta

A Facebook catalogue feed rides the SAME rails (Meta feeds carry `custom_label_0..4` too):
attach it under the market code with the **`-fb` suffix** — `gb` = Google Shopping GB,
`gb-fb` = Facebook GB — either in `DEFAULT_FEEDS` or via the dossier's feeds map. Every KV
key, sweep, watch, cross query and report flows through unchanged. The page splits the two
sets visually: **Google green** `#34A853` chips (G) vs **Facebook blue** `#1877F2` chips (f),
Google rows first within each client card; digests and the report name the channel
("Visual K · GB · Facebook"). Note: `-fb` markets also appear in Feed Lab's selector (shared
roster) — harmless, its audit simply scores the Meta feed against Google heuristics.
**Sheet-backed `-fb` feeds only:** a FeedHero-hosted **XML** source (`{xml}`, ad-hoc attach) is
Feed Lab-only — gviz cannot query XML, so Label Guard skips it with a
clear diagnostic. To label-monitor a Facebook feed, attach it as a link-shared Google Sheet
export under `<mkt>-fb`.

## 3. What raises an alert (thresholds in `labelguard.js` `TH`)

| Signal | warn | crit |
|---|---|---|
| Label column vanished from the sheet | — | always |
| Label coverage fell (pp vs last known-good) | ≥8pp | ≥25pp, or → 0% (from ≥5%) |
| A tracked value's SKU count fell | ≥50% **and** ≥`minLost` SKUs lost | — |
| A tracked value gone entirely | below `bigVal` | at/above `bigVal` |
| Feed row count fell | ≥12% | ≥30% |
| Sheet unreachable / not link-shared | always | — |

A value is *tracked* when it covers ≥0.5% of the feed (min 10 SKUs) at the last known-good state — one-SKU values
churn daily and would be pure noise. **Materiality floors (Aug 2026 noise pass):** severity
scales with what a campaign would feel — `bigVal` = 1% of rows clamped to [25, 200] SKUs gates
crit on disappearances; a partial drop additionally needs `minLost` = 0.25% of rows clamped to
[15, 75] **absolute** SKUs lost before it warns (a 12→5 niche value is churn, not an event).
New values / new labels are **info** (shown, never badged). A value that "vanishes" while a
case/whitespace twin with a similar count appears is a **feed-regen rename** → `value-renamed`
info (the message reminds that PMAX listing groups keyed on the old string still need updating),
not a crit. If a label carries >250 distinct values the pivot is truncated at 250 (flagged `+`),
and a disappeared tracked value downgrades to warn at/above `bigVal`, info below (it may just
have slipped out of the top 250).

**Unstable-read guard:** a catastrophic reading on the estate sweep (rows-drop crit, or ≥6
crits at once) must be confirmed by an immediate same-invocation re-read; if the second read
disagrees on row count by >15% the scan is SKIPPED (activity-logged, previous state kept) —
a throttled/partial gviz answer can no longer poison the alert board until the next rotation.
Custom watches keep their own two-strike + implausibility guards; this is the sweep's equivalent.
The same differ serves the Product Type Guard, so `/ptypes` alerts get every floor above too.

## 4. API

```
GET  /api/labels/estate                    → { feeds: {"client|mkt": summary}, alerts } — one call
GET  /api/labels/alerts                    → { counts: {crit, warn, feeds} } (nav badge feed)
GET  /api/labels/snapshot?client&market[&hist=1] → { snapshot, baseline, hist? }
POST /api/labels/scan?client&market        → scan now; returns { snapshot, alerts, baseT }
POST /api/labels/ack?client&market         → accept as known-good ("expected change"), clears the feed's flags
GET  /api/labels/cross?client&market&by&value&vs → LIVE cross-label dissection: within by=<value>
     (CL0 = "Best Sellers") pivot the segment by another label (CL2 → women - fp / women - sale…).
     Returns { segment, labelled, unlabelled, rows: [[v,n]…], truncated }. Nothing cached —
     3 tiny gviz fetches per call (header probe, segment count, cross group-by).
```

Scans and acks are activity-logged (`label-scan` / `label-rebase`) per Access user. No open
proxy: sheet ids never come from the query — only roster clients resolve, exactly like
`/api/feed/proxy`.

## 5. The page (`/labels`)

- **01 Active alerts** — every unresolved drop-off vs last known-good, crit first, with per-feed
  "✓ Expected — accept as known-good". **Every alert row is clickable** → an inline before/after
  diff of exactly what fired: the affected measure and the label's values as a
  **Known-good · Yesterday · Now** table (Δ vs known-good badges, the alert's own value pinned
  and highlighted, biggest movers next, new values shown with a "—" known-good column). Data
  comes from the one `/api/labels/snapshot` call (it returns all three states); the feed name
  still opens the full dissection, ✓ still accepts.
- **02 Estate health** — client cards × market rows: status pill (ok / warn / crit / stale /
  not scanned / unreachable), CL0–4 coverage bars, rows, last scan. **⚡ Scan whole estate**
  sweeps sequentially, skipping feeds fresher than 20h.
- **03 Feed dissection** — CL0–4 pivots on **one seamless row** (equal widths): value · SKUs ·
  share · **Δ vs yesterday** by default, with a compact segmented toggle in the header to flip
  the Δ columns to **vs known-good** (persisted per tab, `sessionStorage lg-ref`; the yesterday
  chip is disabled until the first daily capture exists). Struck-out red rows are values on the
  active reference that are GONE from the live feed; CSV export names its reference column
  (`yesterday_skus` / `known_good_skus`). The daily reference is automatic for every account and
  every label: the first scan of each UTC day promotes the outgoing snapshot to KV
  `labelday:<client>:<mkt>`, freezing yesterday's closing state for the whole day (day one falls
  back to last known-good). Estate alerts always fire vs last known-good regardless of the
  toggle — the header notes this whenever the Δ columns read vs yesterday — so alarms never fade
  just because a day ticked over. (No history chart by Ray's call — scan history still
  accumulates in KV `labelhist:*`.) Every breakdown table sorts by clicking its column headers
  (value A–Z / SKUs / Δ, click again to flip; cross tables too), and the 🔍 filter input in the
  detail header searches values across all panes at once, lifting the row caps while active.
  Same controls on `/ptypes` (§8).
- **Cross dissection** — click any value in any pivot → a full-width panel breaks that segment
  down **live** by another label (chips flip CL1↔CL4): Reiss GB CL0 "Best Sellers" → CL2
  women - fp 3,166 · men - fp 2,542 · women - sale 2,081… plus a "(no CLx value)" remainder
  row and its own CSV export. Every click is a fresh gviz query — never cached.
- Opening a feed auto-rescans when its snapshot is older than 20h (Feed Lab's refresh model).

## 5b. Demo mode — the anonymised client-facing view

**🎭 Demo mode** (toggle in §02, sticky sessionStorage) turns `/labels` into a screen-shareable
demo: every client identity becomes an **industry alias** ("Fashion B", "Footwear A" — letters
stable by sorted name within industry, map in the page's `INDUSTRY`), client-name traces are
scrubbed from displayed label values, alert text and tooltips, and the **alert-routing section
(webhooks/emails) hides entirely**. A banner marks the state, with an **industry filter** so a
fashion client sees fashion peers, and Exit demo restores everything. Display-layer only —
keys, API calls and data untouched; volumes stay real (that's the demo). New clients default
to industry "Retail" until added to the map. NOTE: this anonymises Ray's own logged-in view
for live demos — it is NOT a client-accessible URL; that would need its own Cloudflare Access
policy and a server-side masking layer (deliberately out of scope).

## 6. Custom alerts — the watch builder (§04 on the page)

Beyond the estate-wide baseline monitoring, Ray can pin the **exact values PMAX depends on**
and route a **high-priority ping** the moment one drops off a live check:

- **Create a watch** with the 🔔 buttons in the dissection: on a **label card** (watches all
  the label's significant values) or on the **cross panel** (watches a breakdown — e.g.
  Reiss GB CL0 "Best Sellers" → all 8 CL2 values, *and* the segment itself vanishing).
  The rule pins the values on screen as its **reference set**; "↻ Re-arm" re-captures it.
- **Destinations** (§04 left panel): Google Chat webhook (space → Apps & integrations →
  Webhooks), Slack Incoming Webhook, or an email address. Chat/Slack are pinged straight
  from the worker; **email** is queued to KV `labeloutbox` and sent from Ray's own mailbox
  by the Gmail bridge (`tools/gmail_push.gs` — its 5-min trigger polls
  `/api/gmail/push {outboxPoll:1}`, sends via GmailApp, acks with `{outboxAck:[ids]}`;
  re-paste the latest script once). The `@all` option prepends `<!channel>` / `<users/all>`
  on non-recovery pings.
- **Cadence — per rule:** `hourly` (the `30 * * * *` cron) or `twice daily` at **07:00 &
  17:00 GMT** (its own `0 7,17 * * *` cron firing) — pick in the builder, or toggle on the
  rule row ("hourly ⏱" ↔ "07:00 & 17:00 GMT ⏱"). Each firing has its own subrequest budget
  (~2–3 gviz fetches per rule; >10 rules rotate). "Check now" / "Run all checks now" fire
  on demand regardless of schedule. Note: twice-daily rules confirm a two-strike drop-off
  on the NEXT scheduled check — detection latency up to ~10h vs ~1h on hourly.
- **Thresholds:** per rule — GONE only, −10/−20/−30/−50/−75%, or a **custom 1–99%**; the
  threshold on an existing rule is click-to-edit (the "gone or −X% ✎" text on its row).
- **Fire semantics — two-strike confirmation:** the FIRST sighting of a drop-off marks the
  value **suspect** (amber, silent); only a **second consecutive** bad check fires the ping.
  Feed sheets are rewritten in place upstream — a check landing mid-refresh sees columns
  momentarily empty, and without the confirmation step that pinged 8 false "GONE"s on Reiss
  GB day one. A transient gap self-clears silently; a real wipe pings one check later.
  Confirmed values **re-ping every 24h while still broken** and send a ✅ recovery notice
  when back. A cross watch whose whole segment vanishes sends ONE `segment-gone` ping.
- **Impossible-answer guard:** Google has served the worker self-contradictory responses
  ("the segment counts 9,000+ SKUs" + "that segment has zero values", recurring across
  consecutive checks — throttling of Cloudflare's shared egress IPs fits). A check whose
  answer contradicts itself is re-queried once after a 10s pause and, if still
  contradictory, **skipped with a diagnostic** (`check skipped` in the rule row +
  activity log) — it never confirms an alert. Genuine full-label wipes stay covered by
  the baseline sweep's label-gone / cov-zero CRIT (different query, different schedule).
  Watch queries are also staggered 500ms apart to avoid drawing throttled responses.
- **Digest format:** one message per rule per check — never one ping per value. Each value
  sits on its own row wrapped in `` `code` `` markup, which renders as a highlighted token
  in both Slack and Google Chat, so the broken value is recognisable at a glance.
- Every fired ping is activity-logged (`label-alert`, user `label-guard`).
- **Emailed status report** (§04, under destinations): one plain-text email — all watch rules
  (down / suspect / ok, worst first), estate health, active baseline alerts, board link —
  to any address (default ray@feedspark.com). Daily after the **07:00 GMT** check (17:00
  optional) so it always reflects fresh data, or **Send now**. Delivery rides the same
  Gmail-bridge outbox as alert emails. Settings: KV `labelreportcfg`;
  API `GET/PUT /api/labels/report` + `POST /api/labels/report/send`.

KV: rules `labelwatch` ("client|mkt|ruleId" → rule), destinations `labeldest`, email queue
`labeloutbox`, rotation cursor `labelwatchcur`. Rule + destination stores are kvmerge maps
(explicit tombstones) — concurrent edits from two tabs don't clobber.

## 7. Runbook

| Symptom | Cause | Fix |
|---|---|---|
| Feed shows **unreachable** | Sheet not link-shared (Google serves a login page) | Share → "Anyone with the link → Viewer", then Scan |
| Feed shows **not scanned** | New roster entry the cron hasn't reached yet | Click it (auto-scans) or wait ≤6h |
| Alert for an intentional change | Labels re-segmented on purpose | "✓ Expected — accept as known-good" on the alert or the feed detail |
| Wrong tab scanned | `gid` missing from an attached sheet URL | Re-attach with `#gid=<n>` (wired feeds carry gid in `DEFAULT_FEEDS`) |
| CL shows `distinct 250+` | >250 distinct values (per-SKU labels) | Expected — coverage alerts still work; value-level watch covers the top 250 |
| Nav badge shows a count | ≥1 feed has active warn/crit alerts | Open `/labels`, triage, fix upstream or accept as known-good |
| Watch pings but the change was planned | New season/segmentation shipped on purpose | "↻ Re-arm" the rule (re-captures the reference set) |
| Email alerts never arrive | Gmail bridge not updated / not set up | Re-paste latest `tools/gmail_push.gs` (needs `drainAlertOutbox`), GOOGLE_SETUP §8; Chat/Slack need no setup |
| Watch shows an error in §04 | Sheet unshared or label column renamed | Fix the sheet, then "Check now"; "Re-arm" if columns legitimately changed |
| Whole estate needs a rescan NOW (fix shipped, re-segmentation landed) | Rotation would take ~5–6h to cover everything | `/ptypes` ⚡ **Scan whole estate** force-rescans all 42 feeds (labels + PT in one pass, ~3 min; the `/labels` button skips feeds fresher than 20h). Hands-free: the **Estate rescan** GitHub Action (workflow_dispatch) — needs a Cloudflare Access service token in repo secrets `FCC_ACCESS_CLIENT_ID`/`_SECRET` |
| Someone "optimises" scanning into full CSV parsing | — | **Never.** The gviz aggregate approach exists because a raw parse blows the worker CPU budget |

## 8. Product Type Guard (`/ptypes`) — sibling module, same rails

Monitors the **primary `g:product_type`** (the category tree) the exact same way the custom
labels are monitored — PMAX listing-group splits and the keyword programme hang off it.
Its Active-alerts rows are **clickable** exactly like Label Guard's (§5 01): inline
Known-good · Yesterday · Now diff with the fired path pinned, biggest movers next, fed by
the one `/api/ptypes/snapshot` call. Differences from Label Guard, everything else identical:

- **One field, one wide pivot** (top 250 category paths by volume, `+`-flagged when truncated;
  default 30 rows with show-all). Cross-dissection goes PT value → CL0–4 breakdown
  (`/api/ptypes/cross`, one side must be `product_type`).
- **Google Shopping channel only** — `-fb` markets are excluded from the PT estate.
- **Numbered keyword slots excluded by design**: keyword fields live in slots 2+ —
  `product_type(2)`/`_2`/`|||2` and up — and `normHeader` keeps them distinct so they can
  never match. The **primary** column resolves under both estate conventions: bare
  `g:product_type` (YuMOVE, HoB) or **slot 1** `g:product_type(1)` (Reiss, Superdry, Schuh,
  American Golf) via a key alias in `findCols`; bare wins if both exist.
- **Zero extra scan slots**: `runLabelScan` captures PT during the same pass (shared header
  probe + counts query, one extra group-by ≈ +1 subrequest per Google feed) into its own
  stores — `ptype:` / `ptypebase:` (last known-good) / `ptypeday:` (yesterday) / `ptypeidx` /
  `ptypealerts` — so PT alerts, ack ("✓ Expected — accept as known-good" on `/ptypes`,
  `POST /api/ptypes/ack`) and the Δ-reference toggle behave exactly like §2/§5, without
  mixing streams: `/labels` stays label-pure, `/ptypes` PT-pure, and the injected nav badge
  dots each page from the one `/api/labels/alerts` call (its `pt` counts field).
- **Depth granularity KPI** (the "how granular is the taxonomy" number for Google): SKU-weighted
  % of the catalogue at **3-, 4- and 5-level** chevron paths (`depthProfile` — `>` split, `/`
  fallback, avg levels; computed at scan time onto `ptypeidx`). Presented as a colour-ramped
  **stacked depth bar** (darker = deeper) + chevron chips on the PT card, **mini stacked bars on
  every estate market row**, and a styled hover card (per-depth bars, 3/4/5 emphasised, avg +
  SKUs profiled) on the market rows, the scanned date, the brand heading and the PT name —
  aria-labels keep the chevron-separated text form.
- **Email on confirmed warning** (✉ toggle + recipient in `/ptypes` §01, KV `ptypealertcfg`,
  default on → `OWNER_EMAIL`): an estate warn/crit emails a per-feed digest via the same Gmail
  bridge outbox Label Guard uses — but only on its **second consecutive sighting**
  (`estateMailPlan`: one garbage read — mid-refresh sheet, gviz throttling — never emails),
  once per continuous incident, with a ✅ when the feed clears. The daily 07:00 report also
  gains a PRODUCT TYPE ALERTS section (`buildReport` `ptAlerts` input).
- **5-depth standard + the client ask** (Ray's rule: the industry standard is **30–40% of
  product volume at 5-level paths** — accounts sitting too shallow get a proposal, not silence):
  `depthStandard` (engine, `DEPTH_STD`) grades each profile — `ok` (5-level ≥30%), `below`
  (5-level <30%) or `shallow` (>50% of volume at 1–2 levels) — rendered as a verdict pill next
  to the depth chips (`✓ 5-depth std` / `⚠ below 5-depth std` / `🔻 shallow tree`) and as a
  footer line on every depth hover card. Below-standard feeds get **✉ Propose depth
  optimisation**: an in-page composer pre-filled by `depthAskEmail` (consultative client email
  quoting the feed's 1–2/3/4/5-level split vs the benchmark, shallow vs below variants) riding
  Label Guard's shared ask rails — "Create Gmail draft" queues via `POST /api/labels/askdraft`
  (KV `labeldrafts` → Gmail bridge → Drafts, never auto-sends; contact remembered per client in
  `labelaskcfg`, stamp `✉ asked` in `labelasked` keyed `ptdepth|client|mkt`), "Open in Gmail
  now" deep-links compose + `markOnly` stamps. The default-on checkbox also files the task —
  `POST /api/ptypes/plantask` (worker-side `PLAN_SHEETS` lookup → `appendPlanRows`) appends
  "PT Depth Optimisation (3-4-5 level granularity) - Client MKT - Mon YYYY" into the client's
  Project Plan sheet, so the proposal rides Intake → Project Plan → pipeline like the Gmail
  triage.
- No custom watch rules for PT v1 — estate alerts + badge + emails cover the drop-off case;
  watches can be extended to PT later on the same `labelwatch` rails.

Engine unit tests: `node tools/test_labelguard.mjs` (runs in `validate.yml` on every PR).
