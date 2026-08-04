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
needed; the sheets are link-shared). Each firing scans 4 feeds in rotation → the 22-feed estate
is re-checked every ~6 hours, staying far under the 50-subrequest free-plan budget even with the
plan warm in the same invocation.

**Baseline semantics (the important bit):** alerts are not "vs the previous scan" — they're vs
the **baseline**, so a feed that broke on Friday is still flagged on Monday. A clean scan rolls
the baseline forward automatically. A flagged change that was *intentional* (new season labels,
re-segmentation) is cleared by **"✓ Expected — rebaseline"** on the page, which adopts the
current snapshot as the new baseline.

## 3. What raises an alert (thresholds in `labelguard.js` `TH`)

| Signal | warn | crit |
|---|---|---|
| Label column vanished from the sheet | — | always |
| Label coverage fell (pp vs baseline) | ≥8pp | ≥25pp, or → 0% (from ≥5%) |
| A tracked value's SKU count fell | ≥50% | gone entirely |
| Feed row count fell | ≥12% | ≥30% |
| Sheet unreachable / not link-shared | always | — |

A value is *tracked* when it covers ≥0.5% of the feed (min 10 SKUs) at baseline — one-SKU values
churn daily and would be pure noise. New values / new labels are **info** (shown, never badged).
If a label carries >250 distinct values the pivot is truncated at 250 (flagged `+`), and a
disappeared tracked value downgrades to warn (it may just have slipped out of the top 250).

## 4. API

```
GET  /api/labels/estate                    → { feeds: {"client|mkt": summary}, alerts } — one call
GET  /api/labels/alerts                    → { counts: {crit, warn, feeds} } (nav badge feed)
GET  /api/labels/snapshot?client&market[&hist=1] → { snapshot, baseline, hist? }
POST /api/labels/scan?client&market        → scan now; returns { snapshot, alerts, baseT }
POST /api/labels/ack?client&market         → rebaseline ("expected change"), clears the feed's flags
GET  /api/labels/cross?client&market&by&value&vs → LIVE cross-label dissection: within by=<value>
     (CL0 = "Best Sellers") pivot the segment by another label (CL2 → women - fp / women - sale…).
     Returns { segment, labelled, unlabelled, rows: [[v,n]…], truncated }. Nothing cached —
     3 tiny gviz fetches per call (header probe, segment count, cross group-by).
```

Scans and acks are activity-logged (`label-scan` / `label-rebase`) per Access user. No open
proxy: sheet ids never come from the query — only roster clients resolve, exactly like
`/api/feed/proxy`.

## 5. The page (`/labels`)

- **01 Active alerts** — every unresolved drop-off, crit first, with per-feed
  "✓ Expected — rebaseline".
- **02 Estate health** — client cards × market rows: status pill (ok / warn / crit / stale /
  not scanned / unreachable), CL0–4 coverage bars, rows, last scan. **⚡ Scan whole estate**
  sweeps sequentially, skipping feeds fresher than 20h.
- **03 Feed dissection** — CL0–4 pivots on **one seamless row** (equal widths): value · SKUs ·
  share · Δ vs baseline, struck-out red rows for values that are GONE, CSV export. (No
  history chart by Ray's call — the scan history still accumulates in KV `labelhist:*`.)
- **Cross dissection** — click any value in any pivot → a full-width panel breaks that segment
  down **live** by another label (chips flip CL1↔CL4): Reiss GB CL0 "Best Sellers" → CL2
  women - fp 3,166 · men - fp 2,542 · women - sale 2,081… plus a "(no CLx value)" remainder
  row and its own CSV export. Every click is a fresh gviz query — never cached.
- Opening a feed auto-rescans when its snapshot is older than 20h (Feed Lab's refresh model).

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
- **Digest format:** one message per rule per check — never one ping per value. Each value
  sits on its own row wrapped in `` `code` `` markup, which renders as a highlighted token
  in both Slack and Google Chat, so the broken value is recognisable at a glance.
- Every fired ping is activity-logged (`label-alert`, user `label-guard`).

KV: rules `labelwatch` ("client|mkt|ruleId" → rule), destinations `labeldest`, email queue
`labeloutbox`, rotation cursor `labelwatchcur`. Rule + destination stores are kvmerge maps
(explicit tombstones) — concurrent edits from two tabs don't clobber.

## 7. Runbook

| Symptom | Cause | Fix |
|---|---|---|
| Feed shows **unreachable** | Sheet not link-shared (Google serves a login page) | Share → "Anyone with the link → Viewer", then Scan |
| Feed shows **not scanned** | New roster entry the cron hasn't reached yet | Click it (auto-scans) or wait ≤6h |
| Alert for an intentional change | Labels re-segmented on purpose | "✓ Expected — rebaseline" on the alert or the feed detail |
| Wrong tab scanned | `gid` missing from an attached sheet URL | Re-attach with `#gid=<n>` (wired feeds carry gid in `DEFAULT_FEEDS`) |
| CL shows `distinct 250+` | >250 distinct values (per-SKU labels) | Expected — coverage alerts still work; value-level watch covers the top 250 |
| Nav badge shows a count | ≥1 feed has active warn/crit alerts | Open `/labels`, triage, fix upstream or rebaseline |
| Watch pings but the change was planned | New season/segmentation shipped on purpose | "↻ Re-arm" the rule (re-captures the reference set) |
| Email alerts never arrive | Gmail bridge not updated / not set up | Re-paste latest `tools/gmail_push.gs` (needs `drainAlertOutbox`), GOOGLE_SETUP §8; Chat/Slack need no setup |
| Watch shows an error in §04 | Sheet unshared or label column renamed | Fix the sheet, then "Check now"; "Re-arm" if columns legitimately changed |
| Someone "optimises" scanning into full CSV parsing | — | **Never.** The gviz aggregate approach exists because a raw parse blows the worker CPU budget |

Engine unit tests: `node tools/test_labelguard.mjs` (runs in `validate.yml` on every PR).
