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
**Late-debut sparse tags (the Monsoon GB false-vanish, 10 Sep 2026):** the XML parser
settles its union header over the first 50 items — but a sparse field can debut
arbitrarily late (Monsoon's `custom_label_1` lives on 458 of 8,898 items and first
appears at item #52), which read as `label-gone` while the live feed carried it intact.
The parser now **grows its header** whenever a new tag debuts mid-stream (earlier rows
were empty for that column by definition, so counts stay exact) and passes the live
header to consumers; `xmlCollector` re-resolves its columns on growth. One fix covers
the 4x-daily agent, the in-browser live rescan AND the ⟳ Verify path (shared code:
`tools/xml_scan.mjs` + `/labels/engine.js` both run `xmlCollector`). Regression-tested
end-to-end (real parser → real collector, sparse label debuting past the sample) and
validated against the live Monsoon feed (458 = HIGH 142 / MEDIUM 129 / LOW 115 /
EXCLUDE 72, matching Ray's manual export exactly).
**Manual verify (Ray, Sep 2026):** every *vanished-column* alert (`label-gone` / `cov-zero`
on /labels and /ptypes, `attr-gone` on /golden) carries a **"⟳ Verify — fresh scan"**
button — one click re-scans that live feed and either **confirms** the wipe ("still gone —
the drop is real") or **clears the flag** ("it was a bad read": a clean scan rolls the
baseline forward, so a recovered column clears itself). An unstable-read skip is surfaced
honestly ("previous state kept, try again shortly") — the PT/GR scan routes return the
`skipped` reason instead of a misleading error.

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

### 5a. Label population — labels carried per SKU, and cards that fold (18 Sep 2026)

Ray, sending the PT depth granularity card: *"I want this feature to be the table breakdown for
highlight population (1, 2, 3, 4, 5, >5) applied to label cards and product types as well, and
the [Golden Record scorecard's expand and collapse — all and individual] too."*

- **The population card.** Above the CL0–4 cards the feed dissection now opens with *Label
  population — labels carried per SKU · SKU-weighted*: one row per bucket (1 … 5 labels),
  the share of profiled SKUs as a bar and a number, then *avg N labels per SKU · N SKUs
  profiled · N carry none (x%)* and the share carrying 3+ of the five — the segmentation PMAX
  listing groups can split on. It is the depth card's own row format (`popCard()`), the same
  colour ramp, so the three surfaces read alike.
- **Where the number comes from.** `xmlCollector` counts, per SKU, how many of
  `custom_label_0..4` are filled and hands `popProfile()` the histogram → `snap.labelPop`
  `{pct{1..5,6+}, avg, skus, zero, max}`. Only a full read can say it, so it rides the XML lanes
  (the 4x-daily agent, ↻ Scan live feed) — the gviz lane counts columns, never rows, so a
  sheet-backed feed's card says *"this snapshot came from column counts … wire the FeedHero
  XML"* rather than drawing a table nobody measured. The worker's `splitRaw` keeps `labelPop`
  on the `labels:` store (and `ptPop` on the `ptype:` store), each through `cleanPop()` — fixed
  bucket keys, every number clamped — since the push lanes hand over a profile a browser computed.
- **Every brand card folds on its own.** The card header is a 36px clickable row — chevron,
  brand, and a summary that survives the fold (feeds, scanned count, crit/warn flags, so closing
  a brand can never hide a live drop-off); **⊖ Collapse all / ⊕ Expand all** in the section
  header does every card at once, the button always naming the action still available;
  remembered per device in `localStorage lg-collapse` (a viewing preference, never shared state);
  the `?client=` deep link opens a folded card before it scrolls to and outlines it.

Harness: `tools/test_guardcards.mjs` (Playwright, presync) renders both guard pages against a
stubbed estate — the table's rows, shares and footer, the sheet-backed note, the individual and
all-cards fold, the reload, the deep link — and `/golden`'s highlight row; `tools/test_labelguard.mjs`
pins `popProfile`/`cleanPop`/`slotCols`, the collector's `labelPop`/`ptPop` on a real XML stream,
and the worker split.

### 5c. ⬇ HTML · all markets — one file per brand (21 Sep 2026)

Ray: *"Is there a way to get data shown for clients with multi-market such as Schuh, Superdry,
or Reiss? A downloaded CSV or HTML would be fine, but not too techy. I like the current filter
section view … HTML would be best because it can be interactive."*

The dissection (§03) reads one feed; a 28-market brand is 28 clicks and nothing side by side.
Two doors open the same export — `⬇ HTML` on every brand card in the estate, and
`⬇ HTML · all markets` beside `⤓ CSV` in the dissection header — and `brandExport(client)`
gathers every market's snapshot (the ones the page already holds, plus one
`/api/labels/snapshot` fetch per scanned market it does not; a never-scanned market has nothing
to fetch and is listed as such), `lgxRecord()` reduces them to exactly what the dissection
draws, and `lgxHtml()` writes **one self-contained file**:

- the data embedded (`window.LGX`), a small script (`LGX_APP`, serialised from the page with
  `.toString()` so it is real, parsed code rather than a string) drawing it — no fetch, no FCC
  chrome, no module nav, nothing of the worker; labels are spoken as CL0–CL4, never as
  `custom_label_n`; the FeedSpark · Private & Confidential footer;
- **Across markets** — one row per market: SKUs, coverage per label side by side (green ≥95 /
  amber ≥60 / red), labels per SKU, scanned date, flags; a row click opens that market;
- **Compare markets side by side** — a comparison the reader BUILDS (Ray, 30 Sep 2026: *"allow
  customization of side-by-side comparison. For example, selected market. If I want to see a
  custom label 2 only across different 5 markets side by side, I'm allowed to do that as well"*):
  - **Label** — one of CL0–CL4 (only labels some scanned market carries are offered);
  - **Markets** — a chip per market, ticked = a column; quick picks All · Google · Meta · Clear;
    a never-scanned market is listed but cannot be picked. Columns always sit in the estate's own
    order whatever order they were ticked in, so two readers building the same view see the same
    table. Clear says "pick at least one market" rather than drawing an empty table;
  - **Show** — SKUs · Share (of that market's catalogue) · Both; **Rows** — every value · in every
    market · missing somewhere. "In every market" is judged over the picked markets that CARRY
    the label — a market without CL3 would otherwise make every CL3 value "missing";
  - each column header states how filled the label is in that market, and a market without the
    label keeps its column and says "no CL3" (or "CL3 vanished") with dashes, never zeros;
  - **Spread** = the widest gap in share between the picked markets that carry the label (a
    market lacking the value counts 0%) — sort by it and the values the markets use most
    differently come first. Every header sorts (value A→Z, any market, total, spread); default
    is total, biggest first; 25 rows then show-all;
  - a summary line names the label, the exact markets and how many values are shared / missing;
  - **⤓ CSV · this comparison** — exactly the rows on screen: `value` then `<MKT>_skus`,
    `<MKT>_share_pct` per picked market (`GB-FB` for the catalogue), `total_skus`, `spread_pp`,
    `in_markets`; the file name carries the label and the markets;
  - the view lives in the address (`#l=2&m=0,3,5&show=pct&rows=gap&sort=spread~-1`), so a reload
    or a bookmark of the file comes back on it; the controls are hidden in print, the summary is not.

  Per-market counts are keyed by the market's POSITION in the file, never its code — GB and
  GB-FB share "GB";
- **market tabs** in the estate's own order (Google A→Z, then Facebook) with a flag dot, the
  never-scanned market present but disabled; each market = the dissection as on the page: the
  label population card (or the honest sheet-backed note), the five panes as value · SKUs ·
  share · Δ with the share bar, GONE rows struck through, the market's live alerts, and the
  reference the Δ reads — named per market (`yesterday` where a daily capture exists, else
  `last known-good`, following the page's toggle);
- the same 🔍 filter across every pane AND the matrix, sortable headers, show-all;
- **⤓ CSV inside the file** — this market / all markets — the page's own CSV columns plus
  `market` and `channel` (`market,channel,label,value,skus,share_pct,reference,reference_skus,delta`),
  so one download gives both formats; 🖨 Print.

Demo mode masks the file exactly as it masks the screen (`dispClient` / `maskText` run at
export time). Harness `tools/check_lgexport.js` (presync) drives the real page, opens the
downloaded file in a second page and uses it as a client would; `LGX_KEEP=1` keeps the file for
a visual pass.

**Every closing tag in the file builder is escaped** (`<\/script><\/body><\/html>`). The worker
injects its widgets and the live editor at the FIRST `</body>` it finds in the served page, so a
literal one inside the builder's string put the injection in the middle of it and took the whole
page's script down — `/labels` shipped dead for an hour on 21 Sep 2026 while every block parsed on
its own. `tools/check_inline_scripts.js` now parses each app page as the worker serves it and
refuses a `</body>` that is not the document's own closing tag.

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

### 5d. Scan scope — all brands, one brand, one market (7 Oct 2026)

Ray, over a /labels "Done — 0 scanned, 73 fresh (skipped)": *"allow scan per brand (all markets) /
all brands / single market"*.

The estate button had ONE scope and TWO traps. On /labels it skipped every feed read in the last
20 h, so a catch-up run after a fix scanned nothing. And on all three guard pages it POSTed only
the server scan, which refuses a FeedHero XML feed (`gviz cannot query XML`) — so the XML markets,
most of the estate, were counted as scanned and never read.

The section header of /labels, /ptypes and /golden now carries:

- **Brand** — *All brands · N feeds* or one brand · N markets.
- **Market** — with a brand picked, *All markets* or one market.
- **skip feeds read in the last 20 h** — OFF by default: every pick is a FORCED read.
- **⚡ Scan …** — the button names the scope (*Scan whole estate* / *Scan Reiss — 39 markets* /
  *Scan Reiss · DE*); **⏹ Stop** finishes the feed in hand and stops; the scope locks while it runs.
- **⚡ Scan** on every brand card — that brand, every market.

Each feed takes the SAME path as the per-feed button: the server scan, and on its XML refusal the
live stream in the browser (`xmlLiveScan` → `/api/labels/scanpush`), so a held catastrophic
reading reads *held — two live reads disagreed* rather than *scanned*. /golden reads content
quality on the same pass, as its estate scan already did. The done line names the scope and every
outcome: scanned, skipped, failed (named), held, not reached, and how long it took.

ONE block (`/* ---- SCAN SCOPE`) sits on all three pages, identical but for the route each scans
through and its page wording (`scDisp` / `scMkt` / `scOne` / `scWhat`). Tripwire
`tools/check_scanscope.js` (Playwright, presync) holds the three blocks equal and drives each
page: picker contents, all brands forced, XML refusals streamed and pushed, the skip, a brand, a
market, Stop, the card button, and the controls inside a 390px screen.

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
  **OPT-IN — off by default** since Ray dropped the automated alert emails, Aug 2026; a
  deliberate ✉ re-enable on the page is required, and configs saved before the opt-in
  change never email): an estate warn/crit emails a per-feed digest via the same Gmail
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
- **Industry scoring profiles + benchmarks** (Ray, Aug 2026: "allow certain attributes …
  incorporated into scoring per brand / per industry and then use that as industry best
  practices"): `INDUSTRY` (client → industry) + `INDUSTRY_PROFILES` defaults in the engine —
  per industry, `expected` attrs count toward the score **even when absent** (the apparel
  five for Fashion/Footwear — exactly Google's apparel conditions), `waived` attrs drop out
  entirely (size systems on Pet Care). `profileFor(client, overrides)` merges committed
  defaults ← KV industry override ← KV brand override (`goldenprofiles`, GET/PUT
  `/api/golden/profile`); the required seven and the gtin/mpn pair can never be profiled.
  `goldenScore(attrs, profile)` scores to that profile — an expected conversational AI attr
  joins at ×1, so a brand can opt the AI six into its number, and an **expected REC attr
  lifts to weight ×2** (rec attrs always score, so without the weight lift ★ would be a
  no-op — Ray, 16 Sep 2026: profiling sale_price "doesn't actually do anything"). The scan
  stores the industry + a per-attribute coverage map on `goldenidx`, so the page computes
  **industry benchmarks from the estate itself**: an "Industry benchmark — Fashion (N estate
  feeds): avg X · best Y (Brand)" line on the verdict and a best-practice tick on every fill
  bar at the industry's best observed coverage. Page: ⚖ "<Industry> best practice" chip + ⚙
  editor (tri-state chips default → ★ scored → waived, brand vs whole-industry scope, reset
  to defaults), ★ marks scored attrs, waived rows grey out, hard "not in feed" flags follow
  the profile. **The always-required roster is shown, not just stated** (Ray, 17 Sep 2026:
  "update scoring profile too pls ? gtin not on there and dont know what else"): the editor's
  own hint text already said "the required seven and gtin/mpn always score", but `profOk()`
  deliberately excludes those from every toggleable tier — which meant the UI never actually
  showed them, reading as an omission rather than a deliberate rule. A new "Always required —
  never toggleable" section lists the required seven plus a merged `gtin / mpn` chip (the same
  best-of-two pairing `goldenScore` itself scores) as locked `<span>` chips — dashed border,
  no pointer cursor, no click handler — so nothing in the score can read as silently missing
  from its own editor, and nothing invites a click that would silently do nothing. Harness:
  `tools/test_grprofile.mjs` (Playwright, in presync — renders the real editor and asserts the
  roster is present, correctly named, and genuinely non-interactive). **⬇ PDF = one continuous vertical page** (Ray, 16 Sep 2026: "should all fit
  in 1 vertical page"): the scorecard used to slice across A4 breaks — 5–9 sheets, the first
  mostly blank because a tier that would not fit was pushed whole, and every attribute row
  double-height because the spec note had no print column and wrapped. `exportPdf` now lays
  the page out exactly as it prints (`body.pdf`, pinned to the 186mm printable column = 703
  CSS px at 96dpi), measures it, and injects `@page{size:210mm <content>mm}` so the browser
  writes ONE tall sheet at full legibility (no scaling); rows are single-line with the spec
  note beside them, a bare Ctrl+P gets the same document via `beforeprint`, `afterprint`
  tears it down, and an absurdly long document (>4800mm, PDF's own ceiling is 5080mm) falls
  back to plain A4 pagination. **The content-quality read prints with it** (Ray, 16 Sep
  2026: "ensure that PDF downloads include this after the Analyse Content Quality button is
  clicked … make sure it is one or two pages"): the section is inside the scorecard, so it
  flows into the same sheet — score, verdict, every attribute row with its worst rule, hit
  rate and requirement/best-practice counts, plus any rule rows left expanded on screen, which
  is the replication Ray asked for. Print COMPACTS chrome, never content (tier padding, the
  dial, the type scale), which brought the document from 2.00 to ~1.5 A4 lengths WITH the new
  section; past three A4 lengths — every rule expanded, say — it paginates as ordinary A4
  rather than becoming a metre-long strip. Twice now the page's own ≤900px responsive rules
  have silently emptied columns of the PDF (the spec note, then the worst-rule summary and hit
  counts) because the printable column is 703px: `body.pdf` re-shows them, and
  **`tools/check_grpdf.js`** (Playwright, in presync) is the tripwire — it renders the REAL
  PDF, counts its pages, and measures AT THE PRINTABLE WIDTH, because measuring at desktop
  width would pass on exactly the bug it exists to catch. **⬇ PDF is one click, no dialog** (Ray,
  17 Sep 2026: *"PDF download for Golden Record to shre to client still not seamless btw — shall
  we also add html download while you fix pdf download?"*): the layout fix above solved
  fidelity, but `⬇ PDF` still called `window.print()`, so "Save as PDF" stayed a manual step in
  the browser's own dialog (and could default to a physical printer) — page JS has no way to
  skip that dialog. `exportPdf` now rasterises the SAME `body.pdf` layout with `html2canvas`
  and packages it into a real file with `jsPDF` (both loaded from cdnjs on first use, ~400KB
  combined), then calls `.save()` — a genuine one-click download. The capture happens at the
  page's NATURAL 960px width rather than the print zoom (a new `.pdf.pdfshot{zoom:1}` override
  cancels it) since screenshot libraries' support for CSS `zoom` is inconsistent; the final PDF
  page is sized to the captured image's own aspect ratio, so it stays the SAME one-continuous-
  sheet document the print path already produces. **The real bug QA caught**: `html2canvas`
  measures text against its OWN font-loading state, separate from the browser's live layout —
  capturing before the Lato webfont's bold 900-weight (used only by headings hidden until
  `preparePdf()` reveals them, so its fetch hadn't even started) finished loading ran every
  word together with no space, readable in the visual QA pass but easy to miss in a structural
  test; `exportPdf` now force-loads all three weights (`document.fonts.load()`) before
  capturing. If the CDN can't be reached, the OLD dialog-based route is the fallback — the
  button always produces something, never fails silently — and a failed load is never
  remembered forever, so the next click retries fresh rather than assuming the CDN is still
  down. **⬇ HTML** sits beside it: a genuinely zero-dialog alternative that clones the whole
  page (same `<style>` block the live view uses, so it can never drift from what `/golden`
  itself renders), strips every `<script>` (a static snapshot shouldn't call the FCC's own
  APIs) and lays out at the same natural size — one self-contained file, opens in any browser,
  no FCC login needed. **The client documents are simpler than the AM's screen** (Ray, 18 Sep
  2026, reading the ⬇ HTML before sending it to a client: *"Let's remove a few things so it's
  not too complicated for the client to read. Keep the content quality score description, but
  remove the weight. The 1.4 × 1.6 factor is not necessary. Also, within AI readiness, show the
  scoring bars in green, yellow, and red, because now they're empty. Remove the pillar heat map
  for now; it's too complicated for multi-market clients. Also remove the 'two scores' question
  from every HTML, and remove the element that sends code or feedback to Claude"*). Both client
  documents — the PDF and the HTML — share `body.pdf`, so ONE rule drops the pillar **weights**
  (the dots under each tile; the WEIGHT chip is simply never written), the **pillar heatmap**
  and the **"Two scores, two questions"** reconciliation band; the live page keeps all three
  (they are the AM's tools). The HTML export goes further and REMOVES those nodes, so the file
  carries no hidden copy of what the client was not meant to read. The scoring **descriptions
  are kept without their factors**: `clientCopy()` is true only while the export is recording
  the pop-ups (SCCAP), and every builder reads it — "weight ×1.6" is not passed, the weighted
  list of pillars and the "×3 / ×2 / ×1" attribute weights are written as an ordering in words,
  "×1.0 / ×0.4" as "full cost / a fraction of it", and the conversational tier's sub no longer
  carries "(×2.4)" on any surface (the pop-up has it). **The bars were empty** because their
  width was set by `airAnimate()` — script, which the file has none of. The pillar and MASK
  bars now carry their width INLINE and the pillar bar's background is the number's own band
  (`airCol`: green ≥80, amber 60–79, deep orange 40–59, red under 40, so bar and figure can
  never disagree); the grow-in became a CSS `@keyframes pgrow` from 0, which needs no script
  either, and `body.pdf` sets `animation:none` because html2canvas renders a FRESH clone where
  the animation would restart from 0 and the capture would take every bar mid-grow. **The
  injected chrome is removed, not hidden**: the live editor's ✎ handle, its "Send an element to
  Claude Code" panel and 💬 Feedback panel (the element Ray saw), the Tachyon copilot, the Feed
  Chat bubble, the view-as pill, the app switcher, the nav customiser and the ⓘ instruction
  toggles were all cloned into the file with their scripts left behind — `body.pdf` hid most of
  them, but a hidden panel is still in the source of a document a client opens and the ✎ handle
  was not hidden at all. Every HTML comment goes too (each injected layer opens with a note on
  what it is and what it talks to). Harness: `tools/check_grpdf.js` now renders the page AS
  THE WORKER SERVES IT (the widgets injected, like check_mobile) for the export block and
  asserts every item above — descriptions kept, no `weight ×`/`×n.n`/`(×` anywhere, eight
  inline-width bars in the right band, no heatmap, no reconciliation band, no editor/Tachyon/
  Feed Chat/instruction chrome, no comments, and that the file never mentions Claude at all —
  while the print measurements stay on the bare page (the phone layer's ≤760px rules would
  fire on the 703px print viewport, a resize the real one-click PDF never makes).
  `GRPDF_KEEP=/path.html` keeps the export for a visual pass. **The inlined method reads at the
  pop-up's own size** (Ray, 21 Sep 2026, on the downloaded HTML: *"the text … is strangely bigger
  than rest — can you mirror the same text size/font as rest of audit"*): the pop-up's type scale
  lives on `.sc-box` (12.5px / 1.55, `ul`/`li` rules scoped to it), and the body element sets no
  font-size — so the same prose inlined by `popDet` as a `<details>` body fell back to the
  browser's 16px beside a 12px audit. `popDet` now stamps the body `xd-pop`, which carries the
  pop-up's scale (`.xd-pop{font-size:12.5px;line-height:1.55}` + the shared `ul`/`li` rules) so
  it reads identically wherever it is inlined — section headline, pillar tile, attribute row.
  `tools/check_grpdf.js` RENDERS the exported file and asserts the computed size at all three
  places is 12.5px and no larger than the audit row beside it. **The download follows the
  interface exactly** (Ray, 21 Sep 2026, sending the on-screen scoring pop-up: *"just follow the
  audit golden score interface exactly for the download (i like this)"*): the export had its own
  fold-out styling — wash-coloured bars labelled "How g:title is scored" on a white, 960px print
  layout — where the screen has a wash background, a 1180px column, the white header band with
  its dial and chips, and a pop-up CARD. Now `body.xhtml` keeps the screen's own look (wash
  background, the `.wrap` column, the header band flush in the panel card exactly as on screen,
  the active Δ-reference as the chip it is — the other toggle button goes, since no script can
  flip it; the PDP-sample and ⚙ profile buttons go too) and every inlined scoring box IS the
  pop-up card: `popDet` writes the pop-up's OWN header into the summary — its own title
  ("Content quality — the headline", "AI-readiness — the headline", "g:title — content quality"),
  the score at 22px, the tier / verdict chip — over the pop-up's body, on a white 14px-radius
  card with the card shadow. A pillar tile folds its card behind the tile's own 10.5px "how it's
  scored" chip (`mode 'chip'`: the header moves inside, `.pillars{align-items:start}` so an opened
  card grows its own tile only, the way a floating pop-up moves nothing). The rendered-export
  block in `tools/check_grpdf.js` asserts the header sizes (16px title, 22px score), the white
  card on the wash page, the attribute card's title, the chip, the single Δ chip and the absent
  buttons; `tools/check_grhtml.js` looks for the pop-up titles. Harness: the one-click-download and CDN-fallback blocks in
  `tools/check_grpdf.js` (stubbed `html2canvas`/`jsPDF` pin the glue — button → libs → capture →
  package → save → restore — a fidelity check on the real libraries is the separate PDF-content
  QA pass, not a structural assertion). **⚡ Scan whole estate now scans content quality too**
  (Ray, 17 Sep 2026: *"scan whole estate > will also scan content quality too for all
  estate"*): the estate rescan already force-rescanned every feed's score, labels, product
  types and attribute coverage in one gviz pass, but left content quality to per-feed manual
  "Analyse Content Quality" clicks — a freshly force-rescanned estate could still show a stale
  or entirely missing quality reading. Each feed in the `#scan-all` loop now runs `qualityRun()`
  — the SAME in-browser stream + PUT the per-feed button uses — immediately after its
  `/api/golden/scan` call, so a feed scanned from the estate button reads identically to one
  scanned by hand; one feed's content-quality write failing never halts the rest of the
  estate, matching the existing score-scan step's own silent-continue. Harness:
  `tools/test_grscanall.mjs` (a genuine trap caught while writing it: the boot-time GET that
  loads a feed's already-stored quality reading and the qualityRun PUT that saves a fresh one
  share the exact same `/api/golden/quality` path — a test stub that doesn't check the HTTP
  method miscounts the page's own unrelated boot read as a scan-all-triggered write). **Profile edits re-score the whole brand instantly** (Ray, 16 Sep 2026): the
  page live-derives every estate score from that same stored cov map + the *current* profile
  (`rescoreEstate` — cov stores `null` for absent vs fill % for present, exactly the attrs
  shape `goldenScore` needs), so saving a profile re-runs the dial, every market on the
  brand's estate card and the industry benchmark in one paint — industry scope re-scores
  every brand in the industry, no rescan; feeds indexed before the cov map existed keep
  their scan-time score until their next scan.
- No custom watch rules for PT v1 — estate alerts + badge + emails cover the drop-off case;
  watches can be extended to PT later on the same `labelwatch` rails.

### 8a. product_type depth card, and cards that fold (18 Sep 2026; card swapped 22 Sep 2026)

The same fold-behaviour ask as §5a, on the product-type page — but not the same card. It
shipped 18 Sep 2026 as a population card (how MANY product_type values a SKU carries: the
category tree plus every keyword slot 2–10, one row per bucket 1…5/6+, `snap.ptPop`), the same
shape as Label Guard's own §5a card. Ray, 22 Sep 2026, screenshotting it: *"PT guard does not
need this breakdown. It doesn't make sense anyway. Instead, replace it with the PT depth
granularity chart."* Keyword-slot population is a keyword-saturation question (KWCal already
owns it), not a product-type-tree question — so the full-width card in that slot was retired
and replaced with `ptDepthCard(dp)`: the SAME `depthProfile()` SKU-weighted read already driving
the compact header bar/chips (§ above), rendered full-width in the shared `popCard()` row
format — one row per chevron-depth bucket (1…5, 6+ levels), buckets 3/4/5 highlighted (the
depths the compact chips already call out), footer stating the 5-level share against the
30–40% industry standard and the 1–2-level shallow share. No *carry none* line: a present
`product_type` column always resolves to a depth of at least 1, unlike a population count.

Because `depthProfile()` reads the value/count PIVOT every scan already carries (`L.values`)
rather than a separately-pushed per-SKU field, a sheet-backed (gviz) feed now gets the FULL
depth card too — no "wire the FeedHero XML" fallback, unlike Label Guard's population card
which stays XML-only (`labelPop` is never captured off a gviz read). `ptPopCard()` and its
call site are gone from the page; the underlying capture — `xmlCollector` resolving every
product_type column through `slotCols()` into `snap.ptPop`, and the worker's `splitRaw` filing
it onto the `ptype:` store — is UNTOUCHED, since Ray's ask named the card, not the data
pipeline. The estate cards still fold exactly as on `/labels` — header row, ⊖/⊕ all,
`localStorage pt-collapse`, the deep link opens a folded card — and the folded summary carries
the brand's average tree depth beside its markets and flags.

## 9. Golden Record (`/golden`) — attribute coverage vs Google's product data spec

The third guard on the same rails: every Google Shopping feed scored live for **attribute
completeness against Google's product data specification**
(support.google.com/google-ads/answer/7052112 — the roster was vetted against the policy
page, Aug 2026). Built client-demo-ready (Ray's brief: "group them all into required vs.
recommended attributes vetted against Google's policy page … design this module nicely and
prep for client demo").

- **The roster** (`ATTR_SPEC`, engine): three tiers exactly as the spec draws them —
  **required** (id, title, description, link, image_link, availability, price — required on
  every product), **required in specific cases** (brand for new products; gtin/mpn as the
  identifier pair; condition if used/refurbished; item_group_id for variants + free
  listings; color/size/gender/age_group for apparel in UK/DE/FR/US/JP/BR — flagged as the
  apparel five) and **recommended** (google_product_category, product_type, sale_price,
  additional_image_link, product_highlight, product_detail, material, pattern, size_type,
  size_system — the optimisation surface). Account-level attributes (shipping, tax) are
  deliberately absent — they live in Merchant Center, not the feed. Repeatable fields
  resolve their slot-1 numbered headers (`additional_image_link(1)` etc.).
- **Zero extra subrequests**: the roster rides `runLabelScan`'s existing multi-count gviz
  query (extra `count()` aggregates on the same request; columns already counted — id,
  product_type — reuse their position). Same caveat as the raw count() column elsewhere:
  formula-blank `""` cells read as filled.
- **Golden Record score** (`goldenScore`): weighted completeness — required ×3 (a missing
  column counts 0), conditional ×2 when present (absent = excluded from the score but
  flagged on the page; a pet-supplement feed without `color` is not incomplete), gtin+mpn
  merge into ONE identifier component (best of the two), recommended ×1 (absent = 0 — that
  IS the optimisation surface). Reported against FeedSpark's 99.9% Golden Record target.
- **Stores + alerts**: `golden:`/`goldenbase:`/`goldenday:`/`goldenidx`/`goldenalerts` —
  the same three-reference model as §2/§8, ack via `POST /api/golden/ack`. `diffCoverage`
  fires on coverage drops vs last known-good: required + conditional tiers can go **crit**
  (≥10pp drop, or the column vanishing — products disapprove), warn at ≥3pp; recommended
  warns at ≥10pp and never crits. Two-strike email-on-confirmed-warning rides
  `estateMailPlan` (KV `goldenalertcfg`, **opt-in — off by default**, same rule as §8), the daily report
  gains a GOLDEN RECORD ALERTS section, and the nav badge dots `/golden` from the same
  `/api/labels/alerts` call (`gr` counts, `grClients` split for the dossier).
- **The conversational AI six** (Ray, Aug 2026: "add 6 conversational attributes that
  Google asked for"): question_and_answer, document_link, related_product,
  item_group_title, variant_option, popularity_rank — all Optional on the same spec page,
  read by Google's AI Mode / agentic shopping surfaces, usually submitted via a
  SUPPLEMENTAL data source (absence from the primary feed is the expected start state).
  Tracked as a fourth tier (`req: 'ai'`): their own **AI-readiness KPI** ("N of 6 live" on
  the verdict, the tier header and `goldenidx.ai`) that is **never counted into
  goldenScore** — the Golden Record number stays the classic spec, the six are the
  frontier story. Coverage drops on them alert warn-only, like recommended.
- **Per-attribute actions** (every row, all four tiers): **✉ Ask client** opens a
  composer prefilled by `attrAskEmail` (missing vs low-coverage variants, tier-aware
  benefit line, consultative voice) on Label Guard's shared ask rails — Create Gmail draft
  via `POST /api/labels/askdraft` (contact memory `labelaskcfg`, `✉ asked` stamps keyed
  `grattr|client|mkt|attr`) or Open-in-Gmail + markOnly; the default-on checkbox files
  "Golden Record Fix - g:&lt;attr&gt;" into the client's Project Plan via
  `POST /api/golden/plantask` (worker-side `PLAN_SHEETS` → `appendPlanRows`). **→ Brief**
  deep-links `/workflow?brief=` prefilled (cat technical, scope = current fill / tier /
  target) AND fires the same plan-task write (keepalive — it survives the navigation), so
  both paths land the fix in Intake → Project Plan → pipeline like the Gmail triage.
  Action buttons and the composer hide in demo mode.
- **The page** (`/golden`): score dial + plain-English verdict per feed, the four tier
  sections with spec badges and per-attribute fill bars / Δ vs yesterday ↔ known-good /
  spec-condition notes, "not in feed" flags (hard red-dashed on required + apparel attrs,
  soft on genuinely conditional ones), estate scorecard with per-market scores and
  "N req missing" pills, ⚡ whole-estate rescan, ⬇ CSV export + ⬇ PDF (a branded,
  print-optimised client presentation of the scorecard — FeedSpark header, dial + verdict,
  the four tier sections, confidentiality footer; browser print-to-PDF, aliases apply when
  demo mode is on), and the same 🎭 demo mode as
  §5b (industry aliases, gr-demo sessionStorage key) for client-facing screen shares. The
  policy page is cited in the hero and footer.
- **Each estate card collapses on its own** (Ray, 17 Sep 2026: *"Golden record in the dossier
  scorecard; allow button to expand or collapse 'all' or individual brand option"*) — a large
  book means a long scroll of market rows for brands nobody is looking at right now. Clicking a
  card's header (a whole 36px row — the chevron, the brand, and a summary that stays even when
  the card is shut: score, market count, and any `N req` / `N crit` / `N warn`, so folding a
  brand away can never hide a live alert) folds just that one card; **⊖ Collapse all / ⊕ Expand
  all** in the section header does every card at once — the label is always the action still
  available, matching the same toggle language as the AI Quote finance tracker's row detail. The
  choice is a viewing preference for this screen, so it lives on the device (`localStorage
  gr-collapse`) like `gr-ref`/`gr-demo`, never shared team state, and survives a reload. The
  `?client=` deep-link the dossier's Golden Record snapshot and the other guard pages use opens a
  folded card before scrolling to and outlining it — a link that exists to be looked at can never
  land on a card closed shut.
- **Two scores per market, carefully told apart** (Ray, 17 Sep 2026: *"Surface content quality
  score directly in the dossier scorecard as well, next to the normal score. So there should be
  two scores appearing for each market, each brand. Obviously, carefully label them so we don't
  mistake. Feed scorecard and content quality score"*). Each `.est-mkt` row previously showed only
  `f.score` (the Golden Record completeness score); the SAME `/api/golden/estate` payload already
  carries `f.q` (content quality, written onto `goldenidx` by the `/api/golden/quality` PUT
  handler this section §9.6 describes) — nothing new to fetch, just a read the row wasn't using.
  Both now render side by side as a captioned pair — a bold number over a short uppercase label
  (`feed` / `content`), each with its own full-sentence tooltip on hover — rather than two bare
  numbers a reader could swap by mistake. Both use the same `scoreCol()` bands the rest of the
  page already uses for these two figures, so there is one colour legend to learn, not two. A
  market not yet analysed for content quality shows only the feed score (never a fabricated
  content figure); a market never scanned at all shows neither.

Engine unit tests: `node tools/test_labelguard.mjs` (runs in `validate.yml` on every PR).

### 9.9 GPC category scope — an attribute scores only where Google asks for it (23 Sep 2026)

Ray, on Hobbycraft's scorecard (material 47.9%, pattern 43.9%): *"for standard GPC material,
that attribute is not required. So by that logic, it should not be cumulated or counted toward
the score."* Until then every attribute was scored over **every product in the feed**, so a craft
catalogue was marked down for yarn without a gender and a golf retailer for clubs without a size.

**What Google actually conditions on category.** The premise that each of the ~5,600 GPCs has
its own attribute list is not how the Merchant Center spec works — it has no per-category list
for general categories. Six attributes carry a category condition, each read off its own help
page on 23 Sep 2026:

| Attribute | Asked of | Source |
|---|---|---|
| `color` | Clothing & Accessories (ID 166) | answer 6324487 |
| `gender` | 166, except 16 named sub-categories (pinback buttons, watch bands, keychains…) | answer 6324479 |
| `age_group` | the same, plus cufflinks (193) | answer 6324463 |
| `size` | Clothing (1604) and Shoes (187) | answer 6324492 |
| `material`, `pattern` | 166 — Google's clothing best practice names them (answer 7348545); anywhere else only "for products that vary by material/pattern" (6324410 / 6324483) | |

**The rule.** Each of these is scored over the products in its category: `attrs[k].cov` is the
coverage of those products, `.all` keeps the whole-catalogue reading, `.scope {n, f, u, t}` says
how many products it applies to, how many carry it, how many of those have no readable category,
and how many are in the feed. Three consequences:

- **None in scope → not applicable** (`.na`): out of the score even when the profile ★ stars it,
  never listed missing, never alerted on, and the row says "no clothing & accessories products —
  not scored" with no ask/brief buttons.
- **Weighted by share**: a scoped attribute's weight is multiplied by `n / t`, so 2 clothing
  products in 24,000 cannot move the score the way the whole catalogue does. An all-apparel feed
  has a share of ~1 and scores exactly as before.
- **A known requirement is a gap**: a `cond` attribute ABSENT on products Google requires it for
  now counts at 0, whether or not the industry profile expected it.

A product with **no readable category** (blank, or a top level no locale's taxonomy knows) stays
IN scope — the scope only narrows the score where the feed itself says so.

**Reading the category.** The estate ships Google's taxonomy in seven languages (en-GB "Clothing
& Accessories", en-US "Apparel & Accessories", de-DE, fr-FR, nl-NL, da-DK, es-ES), so the engine
carries every locale's path for the IDs above (`GPC_ROOT` / `GPC_TAILS`), their numeric subtrees
(`GPC_IDS`) and every locale's top-level names (`GPC_ROOTS`), all generated from Google's own
`taxonomy-with-ids.<locale>.txt` by `python3 tools/build_gpc_scope.py` (26 locales; re-run it and
copy `labelguard.js` to `docs/labelguard_engine.js` if Google ships a new taxonomy).

**Where it is measured.** Per product, so only the full-read lanes carry it: the 4×-daily XML
agent and the in-browser ↻ rescan (`xmlCollector` → `gpcScopeCounter` → `applyGpcScope`). The
gviz sweep counts columns, not products, so a sheet-backed feed (House of Bruar) keeps the
whole-catalogue reading until its FeedHero XML is wired. The estate index keeps the scoped
coverage plus `sc` (the in-scope counts) through `goldenCovIndex`, so the page's re-score and the
Playbook read the same basis; `diffCoverage` never compares a scoped reading with a
whole-catalogue baseline, so the first scan after this shipped raises no drop alerts.

**Live effect (23 Sep 2026, before → after).** Hobbycraft GB 82.7 → 90.9 on its own profile (2
clothing products in 24,413; size not applicable); American Golf GB 78.7 → 80.4 (golf clubs no
longer counted for size / age group); Accessorize GB 90.6 → 90.1 (size now asked of its 1,269
clothing and shoe products, not its bags and jewellery); YuMOVE 87.6 → 89.4; Monsoon, Reiss,
Schuh and Superdry move by 0.2 or less.

Pinned in `tools/test_labelguard.mjs`: the classifier on every language and form the estate
ships (including the stray `{` on eight Reiss markets and numeric IDs), Google's exemptions, the
collector on a real XML stream, the not-applicable / share / known-gap rules, the alert guard, and
the /golden page's twin scoring every case exactly as the engine does — directly and through the
estate index round trip.

### 9.10 One audit colour legend (23 Sep 2026)

Ray, on the Playbook rail painting 76.7% completeness red: *"golden record and bar color should be
a bit more forgiving (< 70 red, 70-85 orange, 85 - 95 yellow, 95-100 green) - apply across all
audit."* Every completeness, coverage and content-quality number on the FCC now uses one function,
`auditBand(v)`:

| Band | Range |
|---|---|
| green | 95 and above |
| yellow | 85 to under 95 |
| orange | 70 to under 85 |
| red | under 70 |

It sits on `/golden` (the dial, estate cards, attribute fill bars, content-quality score and bars),
`/feedlab` (attribute coverage), the dossier's Golden Record card and the Playbook rail inside
Workflow. Pages cannot import each other, so `tools/test_bands.mjs` lifts every copy and runs one
boundary table through them.

AI-readiness keeps its own ladder on purpose. Its colours are its tiers (40 / 60 / 80), and a feed
without the conversational six tops out at 79.3, so the 95-green legend would turn the whole estate
red. The harness pins that scale unchanged.

The same Playbook panel read coverage as a fraction (floors 0.99 / 0.9 / 0.6) while the index stores
percentages. Every real reading cleared the floors, so "Weakest first" only ever listed an attribute
under 1%, printed ×100. The floors, the bars and the "worst N%" figure now read percentages.

### 9.11 Score history — improvement and deduction, day by day (24 Sep 2026)

Ray: *"Can the Golden Score module record historic changes in terms of improvement or deduction
from the previous scan? That would be good to show clients on improvement progress. At the same
time, maybe also track it on a day-to-day basis, similar to [product] volumes."*

Before this the module kept no past at all, only three snapshots: the latest, yesterday's and
the last known-good. Now each feed has a record over time.

**The store.** `goldenhist:<client>:<mkt>` (engine: `labelguard.js` `histAdd` / `histSeed` /
`histQa` / `histIdx`) holds three lists:

| Key | What it holds | When it is written |
|---|---|---|
| `r` readings | `{t, rows, cov, sc?}`: the coverage the score is computed **from**, never the score itself | When the feed moved since the last recorded reading: an attribute appeared, vanished or changed scope, or its coverage moved 0.5pp (`HIST_MOVE_PP`) |
| `s` scan days | the UTC days the feed was read at all | The first scan of each day |
| `q` analyses | `{t, q, air, tier}`: content quality and AI-readiness, as analysed | When either figure moved (written by the `/api/golden/quality` PUT) |

Four identical scans a day write nothing after the first. Drift below the threshold builds up
against the last *recorded* reading, so a slow slide is still caught. The last 30 days
(`HIST_RECENT_DAYS`) keep every move, scan by scan. Older days keep only their close, the last
reading of the day. The record is capped at 500 readings, 400 scan days and 200 analyses. A busy
feed's full year is under 400KB.

**Every reading is re-scored.** The page scores each reading against the brand's **current**
profile, using the same `goldenScore` + `attrsFromCov` the estate uses. An industry-profile edit
or a waived attribute therefore re-bases the whole line. It never reads as the feed improving or
slipping. A reading measured on another basis is never compared across. (That means a snapshot
from before GPC category scope, where `!!sc` differs.) The line breaks there and the log says
"measured on a new basis".

**No invented past.** A new record is seeded from the known-good snapshot as it stood before
this scan rolled it, and from the previous scan. Both are real readings, used only when they
were measured on today's basis. A day nobody scanned is a **gap** in the chart, never a copy of
the day before, because a feed that stopped being read must not look flat.

**The card** sits under the scorecard header. Range chips 30 days / 90 days / 1 year / All sit
top-right; the choice is remembered per device (`gr-hist-rng`). The card has four parts:

- **KPIs:** Golden Score now (as the dial), the last change and its date, and the move over the
  window. When the record is shorter than the window, that last tile reads "Since tracking
  began", never "90 days". Content quality and AI-readiness appear with their move since the
  analysis before the window.
- **Chart, top plot:** the daily close as a line — since 7 Oct 2026 **three lines on one chart**,
  the Golden Score, content quality and AI-readiness (see *Three scores, one chart* below). It is
  zoomed to the data, since a line needs no zero baseline.
- **Chart, bottom plot:** the day's move against the previous measured day, one row per score.
  Improvement is drawn above its row's zero line and deduction below it. A measured day with no
  change is a dot on the line. The two plots share the calendar but never a y-axis.
- **Hover and change log:** hovering a day names what moved that day. The change log lists
  every recorded move in the window, newest first: the score from → to, the Δ, and the
  attributes that moved (`g:color ▼ −10pp`, `g:product_highlight added (60%)`), with the
  analyses interleaved. It shows six rows, with "Show all N" behind a button.

**The estate row** shows the last move under the feed score (`FEED ▲1.8`). `goldenidx` carries
the reading before the last change (`hp`) and when it changed (`ht`). A scan rebuilds both from
the record, the ack carries them unchanged (`keepHist`), and both ends are re-scored to today's
profile.

**Client documents.** The card prints in the PDF and the ⬇ HTML. It keeps the active range as a
plain chip. The other range chips, the Show-all button, the tooltip and the hover targets are
removed. A card with nothing to show yet (fewer than two readings and no analyses) is dropped
from both client documents.

Route: `GET /api/golden/history?client=&market=` → `{hist}`. Harnesses:
`tools/test_goldenhist.mjs` (engine, worker wiring, the page's `histMoved` twin;
qa_gate/presync/validate) and `tools/check_grhist.js` (Playwright, presync). The Playwright check
renders a forty-day record and asserts:

- deductions draw below the line;
- gaps are gaps;
- waiving the attributes that moved re-bases the history;
- the download keeps the chart and drops the furniture;
- the card works in dark mode and at 390px.

### 9.12 Daily at 12:00 UK, and a hand-run scan sets its day (24 Sep 2026; moved to noon 7 Oct 2026)

Ray: *"Golden Record and content quality should automatically scan on a daily basis, then at 9
a.m. UK time, so every day there's a tracker. If there's a manual scan on any day, that new score
can override that day. So let's do that for all clients."*

The feed score already had an automatic lane, the 4x-daily xml-scan. Content quality and
AI-readiness had none: they ran only when somebody pressed **Analyse**. So the history only moved
on days a person remembered to run them.

**Moved to 12:00 UK (7 Oct 2026).** Ray: *"can golden score be scanned each day at 12:00 pm UK
time ? because sometimes 9AM, not all output feeds have been refreshed (every market/ every
client)"*. A reading taken before a client's output feed has rebuilt for the day records
yesterday's feed under today's date, so the run now waits until noon.

**The daily run.** `.github/workflows/golden-daily.yml` fires at :07 and :37 past 11:00, 12:00,
13:00 and 14:00 UTC, and `tools/golden_daily.mjs` decides whether to run. Cron speaks UTC and the
UK moves between GMT and BST, so the script runs once the London clock has reached 12:00
(`RUN_HOUR`) and today's noon run is not yet on the worker's ledger. In summer the 11:07 UTC
firing is 12:07 London; in winter the 12:07 UTC firing is. The other firings are catch-up for a
late or dropped run, and do nothing once the day is done. A manual dispatch can force a run. A
single-feed dispatch (`only`) never marks the day done.

**Why off the hour, and eight firings.** GitHub delays scheduled runs at busy times and drops
some, worst at the start of the hour; its own docs say to schedule at another minute. On the old
`'0 8,9,10 * * *'` schedule only one of the three daily firings ever arrived, 4–7 hours late: from
25 Sep to 6 Oct 2026 the "09:00" run started between 13:40 and 17:47 London. The `:07`/`:37`
slots with three hours of catch-up give the noon run a much better chance of landing near noon.
GitHub still decides when a scheduled run actually starts, so the chip's "last …" time is the
truth about when it ran.

Only a run that **finished from 12:00 London** counts as the day's run (`runDone`, read off the
ledger's own time). One on the ledger from earlier the same day — a forced dispatch, or the 09:00
run on the day the schedule moved — read the feeds before they refreshed, which is exactly the
reading the noon run exists to replace, so it does not stand in for it.

The script reads every wired Google Shopping feed once: 49 today, never a `-fb` Meta feed. XML
feeds stream from FeedHero. House of Bruar's three sheet feeds come through Google's public CSV
export, the same source the feed proxy reads. Off that one stream it pushes:

| Push | What it carries | Where it lands |
|---|---|---|
| `{xmlscan}` | the snapshot (XML feeds) | the Golden Score, exactly as the 4x-daily agent sends it |
| `{goldenscan}` | a scan request (sheet feeds) | the worker's own gviz scan |
| `{goldenqual}` | content quality + AI-readiness | `storeGoldenQuality` |
| `{goldendaily}` | the day, then the run's totals | the ledger `goldendaily`; the first call returns every brand's scoring profile |

The quality reading is computed with `labelguard.js` **`qualityStream`** (plus `packAudit`). That
is the one implementation /golden's Analyse button now runs too: `qualityRun` was moved onto it,
so a hand-run analysis and the automatic one can never read a feed two ways.

**A hand-run scan sets its day.** Every write records who took the reading:

- **Analyses.** `storeGoldenQuality` is the one writer for both the page's PUT (manual) and the
  agent's push (auto). It refuses to store an automatic reading over a hand-run one taken the
  same day. `goldenidx` carries `qSrc` (`'m'` or `'a'`), and `QUAL_KEEP` keeps it across scans.
- **Scans.** Every scan button a person presses passes `manual` through `runLabelScan` /
  `applyPushedSnapshot` → `processScanSnapshot` → `histAdd`. That covers `/api/golden/scan`,
  `/api/labels/scan`, `/api/ptypes/scan` and `/api/labels/scanpush`.
- **In the record.** A hand-run reading is recorded, marked `m`, even when nothing moved (once
  a day).
- **Picking the day.** `histDayPick` (engine, with a page twin) makes a day's value its last
  hand-run reading when there is one, and otherwise its last reading.

The record still keeps every later truthful reading; only the day's value follows the person's
scan. Old days thin down to that same reading.

The estate dial and the feed score on `goldenidx` still show the latest scan. They are
monitoring, not the daily tracker.

**The card.**

- All three are drawn day by day on one chart (below). Until 7 Oct 2026 a metric switch
  (`gr-hist-met`) showed one at a time.
- A day with no analysis is a gap in the chart.
- A day set by hand wears a ring on the line, and its change-log row reads "✋ by hand".
- The header chip reads "⏱ auto 12:00 UK · last …", from the ledger the estate route now
  returns.
- A single reading with no scanned neighbour is drawn as a point. Before, it vanished.

**Harnesses.** `tools/test_goldenhist.mjs` covers:

- the day rule and the hand-run pin;
- `qualityStream` against the collector written out by hand;
- the one-writer rule and the manual flags;
- the agent's London clock (summer and winter), its gate, its roster and its workflow.

`tools/check_grhist.js` renders a hand-run day followed by an automatic one, and the content
quality view.

### 9.14 Keywords in the Golden Score (30 Sep 2026)

Ray: *"add keywords fields (product_type2,3,4,5,6,7,8,9) to the golden score mix also?"*

FeedSpark's keyword injection writes phrases into the numbered `g:product_type` slots. Slot 1 (or
the bare column) is the category tree and slots 2–10 hold the keywords. The Golden Score now carries
one attribute for them, **keywords**: the share of products carrying at least one keyword phrase.

**A filled slot is not a keyword.** Sampled on the live estate before building:

| Feed | Real keyword coverage | "Any slot filled" | Why they differ |
|---|---|---|---|
| Schuh GB | 36.7% | 100% | a 32-character hex id in slot 2 on every product |
| Reiss GB | 22.3% | 100% | the same id in slot 2 |
| Hobbycraft GB | 49.8% | 99.7% | the same id in slot 2 |
| YuMOVE GB | 10.6% | 75.3% | `#N/A` in slot 2 on 65% |

So a value only counts when it is a phrase. `kwValueKind` (labelguard.js) rejects a hex id of 24+
characters and spreadsheet placeholders (`#N/A`, `N/A`, `null`, `-`, `0`, `#REF!` …). The row names
how many products carry an id, so the reading explains itself.

**Three states, never blurred:**

- **Measured** — the XML scan reads every product (`xmlCollector` → `keywordAttr`: coverage,
  keyword strings in total and per SKU, products carrying an id). Every XML lane measures it: the
  4×-daily agent, the 12:00 UK run and the page's live scan.
- **Absent** — the feed has no keyword slots at all. Scored at 0, like any recommended attribute
  the feed does not carry. The sheet (gviz) lane can say this much from the header.
- **Not measured** — the sheet lane when keyword slots exist (a column count cannot tell a phrase
  from an id), and every snapshot or reading from before 30 Sep. Left OUT of the score, never
  counted as missing. In the index this is the key being absent from `cov`; measured-absent is `null`.

**Keyword strings per SKU, not slots.** Ray, same day, on the first version's *"3.5 phrases per
keyworded product"*: *"keywords look like multiple phrases separated by chevrons … some products
don't have keywords at all. You could say, on average, how many keyword strings there are per SKU."*
Each slot is a chain, e.g. `superdry hoodie > purple hoodie > mens hoodie > …`, so the first version
was counting filled slots (about 3 on Superdry GB) where the keyworded products carry about 23
strings each. `kwStrings` counts the strings between chevrons (an id or a placeholder inside a chain
is not counted either), and `keywordAttr` reports `strings` (the catalogue's total) and `perSku`,
which is the total divided by EVERY SKU. Products with no keywords count as none, because an average
over only the keyworded products describes a catalogue that does not exist. The row reads *"8.2
keyword strings per SKU"* and the tooltip shows the sum. A snapshot scanned before the string count
carries the old slot figure (`per`), which the page never shows as strings; it reads *"strings per
SKU counted on the next XML scan"* until the next scan. Coverage and the score are unchanged by this.

Live on 30 Sep 2026 (full feeds, the collector as shipped):

| Feed | SKUs | Keyworded | Keyword strings | Per SKU | (per keyworded SKU) |
|---|---|---|---|---|---|
| Superdry GB | 25,695 | 10,658 (41.5%) | 275,576 | **10.7** | 25.9 |
| Schuh GB | 21,972 | 8,071 (36.7%) | 180,170 | **8.2** | 22.3 |
| Reiss GB | 24,048 | 5,342 (22.2%) | 186,236 | **7.7** | 34.9 |
| Hobbycraft GB | 24,648 | 12,283 (49.8%) | 178,491 | **7.2** | 14.5 |
| Accessorize GB | 4,254 | 1,153 (27.1%) | 29,699 | **7.0** | 25.8 |
| American Golf GB | 7,783 | 1,228 (15.8%) | 13,168 | **1.7** | 10.7 |
| Monsoon GB | 10,627 | 550 (5.2%) | 11,179 | **1.1** | 20.3 |
| YuMOVE GB | 85 | 9 (10.6%) | 63 | **0.7** | 7.0 |

The last column is shown here only to explain the gap. The page prints the per-SKU figure.

**Scoring.** `rec` tier, ×1; ★ in the profile editor lifts it to ×2, and it can be waived per brand
or industry. It is `house: true`: the page badges it **FeedSpark**, never as a Google specification
attribute. Its row has one action, **→ Brief**, which opens a keyword brief (`cat keyword`, task
*Keywords Optimisation - Catalogue coverage - <Brand> <MKT> - …*). There is no client ask and no PDP
scan, because keywords are FeedSpark's own work.

**History.** Readings from before 30 Sep never read keywords, so `histBasis` (engine) and `hBase`
(page twin) include "which derived attributes were read". The first measured scan is a change of
measurement: recorded, never drawn as a move. The estate's last-move chip, the Score history card and
Leadership's portfolio all start the comparison there. `diffCoverage` raises nothing against a
baseline that never measured keywords.

**Live impact on 30 Sep 2026** (default profiles): Golden Scores move 1 to 2.2 points (Schuh GB
86.6 → 85.6, Reiss GB 91.7 → 90.2, YuMOVE GB 89.9 → 87.7, Monsoon GB 93.8 → 92.0).

**The Keyword Calendar reads the same rule.** Its saturation counted any filled slot, which is why
Reiss read "100% keyword saturation" on 21 Sep. Both of its stream loops now use `kwKind` (a twin of
`kwValueKind`, held to one table by tools/test_labelguard.mjs). A stored reading without `v:2` says
it was measured before ids were excluded until it is re-synced.

**Harnesses.** tools/test_labelguard.mjs (the value table, slot resolution, the collector on a real
XML stream, the three states through index/history/score, basis, alerts, the KWCal twin) and
tools/check_grkw.js (Playwright, presync: the row in each state, the dial against the engine's
score, → Brief opening a keyword brief).

### 9.15 Depth in the score — images, highlights and details per product (7 Oct 2026)

> **One row per field (8 Oct 2026, Ray: "merge - highlight per product > into g:product_highlight, same for details
> too - and the pop up table happen when hover those merged fields instead").** Where the scan counted them per
> product, the g:product_highlight and g:product_detail rows ARE the depth reading (`DEP_MERGE`): named as the field,
> scored on how many each product carries, the breakdown on hover over the name or the bar, the field's own 🔎 PDP
> action kept. A scan that could not count them shows the plain filled-or-not row, with no "not measured" twin
> beside it. Images per product stays its own row — it counts the main image too, so it is not g:additional_image_link.
>
> **A pop-up chart, not a card under every row (8 Oct 2026, Ray: "these bar charts of tier population should be a pop
> up chart followed the design from Product Type (it's easier to see and cleaner)").** On screen the breakdown opens
> from the depth row's own bar — hover or focus shows it, a tap pins it (a phone has no hover), Esc or a click
> elsewhere closes it, and it follows its bar while the page scrolls — in Product Type Guard's dark depth card: one
> row per bucket, label · bar · share, the buckets at full credit in white, the average + share at target and the
> scoring note under them (`depRows`/`DEPTIP`, the shared `.dptip`). The client documents cannot hover, so the PDF
> and ⬇ HTML print the same rows inline (`.dep-card`, `body:not(.pdf)` hides it on screen) and the file loses the
> pop-up's hooks. Harness: `tools/check_grdepth.js`.
>
> **Card layout (8 Oct 2026, Ray: "these texts should sit in expandable — the coloured segments should stay on the
> same line").** Each depth card is the bar, ONE line of legend chips (0 … 6+, never wrapping; it pans on a phone)
> and a fold, *How it's scored · full credit at N+*, holding the explanation, what the feed carries today and the
> examples by product type. The PDF / print copy opens every fold (`preparePdf`), the ⬇ HTML keeps them as native
> `<details>` a client can open. Pinned in `tools/check_grdepth.js`.

Ray: *"this golden score will be the entire new base … image population … at least four plus …
100% score … product details … separated from product highlight … please give me more scoring logic
and let me approve if it should be in the golden score or not."* He approved five changes:

- **images per product**
- **highlights per product**
- **product details per product**
- **lifestyle_image_link**
- **size_system** as best practice for apparel

All five score at ×1, like the other recommended fields. He did not approve "valid values". Main-image
quality is phase 2, once a scheduled image scan exists.

**A filled column is not a full one.** A product with ONE extra image has `additional_image_link`
filled. A product with two highlights has `product_highlight` filled. A product whose only "details"
are washing instructions has `product_detail` filled. Presence scored all three as done. Each now gets
a DEPTH twin (ATTR_SPEC `of`), read product by product on the XML scan:

| Row | Counts, per product | Full credit | Standard |
|---|---|---|---|
| images per product (`img_depth`) | distinct images: the main image plus every additional one (a cell with several comma-separated URLs is split; the same URL twice counts once) | 4+ | FeedSpark's. Google allows the main image plus up to 10 more and names no count |
| highlights per product (`hl_depth`) | distinct highlights (repeated tags or the `\|\|\|` list form; blanks and repeats dropped) | 4+ | Google's own 4–6 (answer 9216100) |
| details per product (`detail_depth`) | details that describe the product | 3+ | FeedSpark's |

**Each product earns** `min(count ÷ target, 1)`, and the row's score is that credit averaged over
EVERY product, with a product carrying none counted as 0. So 3 of 4 images scores 75%, and 2 of 3
details scores 67%. A card under each row breaks the catalogue down by count, 0 … 6+, with the buckets
at full credit marked.

**What a detail is.** Google (answer 9218260) asks product details not to repeat other attributes or
carry promotion, and not to repeat themselves. `detailKind` therefore does not count:

- a line repeating another attribute (colour, size, brand, price, availability …)
- a material or pattern line that only repeats the product's own `g:material` or `g:pattern`
- a line repeated within the product
- a line with no name or no value

Care lines (washing, cleaning) are left out by FeedSpark's rule: the details that matter are the ones
Google's AI reads, such as sleeve length, neckline, fit and fastening. The row counts how many lines it
set aside, and the card names the details the feed does carry, with examples per product type.

**One fact, one weight.** When a depth twin was measured, it scores INSTEAD of its presence row
(`goldenScore` skips the presence key). The presence row stays on the page, since "is it in the feed
at all?" is still worth seeing, and wears **scored by depth ↓**. When the twin was NOT measured (a
sheet-read feed, or a snapshot from before 7 Oct), the presence row scores as it always did. The depth
row then reads "not measured … g:<attr> scores until the next XML scan" with no actions, never
"missing". `histBasis` includes the derived keys, so the first depth-measured scan is a change of
measurement and never drawn as a move. `diffCoverage` raises no alert on a depth key appearing or
going.

**The profiles.** Fashion and Footwear star `size_system` (Google, answer 6324502: "Submit this
attribute for all apparel products") and `img_depth`. `lifestyle_image_link` is a recommended field
for every industry except those it does not fit: it is waived for Footwear, Beauty, Pet Care,
Sporting Goods, Arts & Crafts, Tools & DIY and Retail. **A saved profile predates a new default:**
the ⚙ editor saves a brand's whole list, so a record saved before 7 Oct would silently hide the new
defaults. Every record now carries `v`, stamped by the worker on save. `profileLayer` (engine), and
its page twin `layerOf` reading the `upgrade` table served on GET /api/golden/profile, lays each later
version's changes over an older record. A choice the record made explicitly the other way stands.

**On the page.** Each depth row is named in words (never a `g:` key) and badged with whose standard
it is: **FeedSpark** for images and details, **Google 4–6** for highlights. Its note reads e.g.
*"4.1 images per product · 82% carry 4+"*, and its tooltip gives the arithmetic. The row's actions
are ✉ Ask client and → Brief, with no PDP scan, because a product page holds one product, not a
count:

- **✉ Ask client** composes a per-product proposal (`perProductAskEmail`): *"proposal to add more
  images per product"*.
- **→ Brief** opens a brief in words (*Golden Record Fix - Images per product - <Brand> <MKT> - MMYY*,
  `cat image` for images, `cat data` for the others). The worker files the same words.

The CSV names the rows (`images_per_product` …). The ⬇ HTML and PDF carry the rows and their cards.
`cleanDepth` (worker) checks a pushed depth reading whole before it is stored.

**Live impact, 7 Oct 2026** (the full GB Shopping feeds through the shipped collector, the engine
before and after, default profiles):

| Feed | Before | After | Images / product | Highlights / product | Details / product |
|---|---|---|---|---|---|
| Monsoon GB | 91.9 | 86.1 | 4.1 (91.5%) | 3.4 (78%) | 0.5 (2.2%) |
| Accessorize GB | 89.0 | 84.3 | 3.6 (81.1%) | 2.8 (68.8%) | 0.5 (2.0%) |
| Superdry GB | 89.2 | 83.9 | 2.0 (50%) | 1.3 (26.9%) | none in feed |
| Reiss GB | 90.2 | 86.7 | 5.9 (99.9%) | 1.5 (33.5%) | none in feed |
| Schuh GB | 85.5 | 84.1 | 4.0 (100%) | 0.5 (9.9%) | none in feed |
| Hobbycraft GB | 90.9 | 90.6 | 3.2 (68.3%) | 2.9 (47.2%) | 0.1 (0.4%) |
| American Golf GB | 77.9 | 77.9 | 4.2 (80.3%) | 0.7 (16.8%) | none in feed |
| YuMOVE GB | 88.4 | 88.1 | 1.0 (25%) | 1.3 (32.9%) | none in feed |

Where the Fashion points went:

- **lifestyle_image_link** costs about 1.9 points. No feed in the estate carries it.
- **size_system ★** costs about 1.8. No feed carries it either.
- **images per product** costs 1.7 on Superdry (2 images per product) and slightly lifts Reiss and
  Schuh (4 or more on every product).
- **details per product** costs Monsoon 2 points. Its `product_detail` is filled on 98.8% of
  products, but almost every line is a care instruction or repeats another attribute, so it averages
  0.5 real details per product.

**Harnesses.**

- tools/test_labelguard.mjs: the readers, depthAttr, cleanDepth, the collector on a real XML stream,
  the score with and without depth, profile layering, the client ask, and the page twin's score and
  ask held to the engine's.
- tools/check_grdepth.js (Playwright, presync): the rows, badges, notes, cards, the dial against the
  engine, not measured, Pet Care, a v1 profile, ask, brief, CSV, HTML, PDF and 390px.
- tools/check_grkw.js: the profile route is now stubbed as the worker answers it.

### 9.12a Three scores, one chart (7 Oct 2026)

Ray, on the Score history card: *"merge 3 scores as 3 lines chart in 1 graph pls"*.

The card used to show one score at a time behind a Golden Score · Content quality · AI-readiness
switch, so the three were never seen together. Now the switch is gone and the chart draws all
three.

- **One calendar.** Each score is still read by `histModel`, one metric at a time — the twin that
  `tools/test_goldenhist.mjs` holds to the engine. `histModelAll` then lays all three on the
  earliest window start any of them needs (`startAt`), so a day sits in the same column on every
  line.
- **One axis.** All three are scores out of 100, so they share one y-axis, zoomed to the combined
  range. There is never a second scale.
- **Colour is the score.** Each line, its points and its row of bars wear the score's own colour:
  Golden Score `--hs-gs` (#2563EB / dark #4C82E0, the FCC chart pair), content quality `--hs-q`
  (#ED6F0B / dark #C67B28) and AI-readiness `--hs-air` (#1BAF7A / dark #199E70, the reference
  palette's third slot). The three validate all-pairs in both themes. The light aqua sits under
  3:1 on white, so every line is also named at its right end (latest value + name) and in the key.
- **Direction is position.** The day-on-day plot has one row per score. A bar above its row is an
  improvement, below it a deduction. Each row has its own stated scale (`±0.5`, `±10`, …),
  because the Golden Score moves in tenths while an analysis can move eight points, and one shared
  scale would flatten every score move to a dash.
- **No line is ever gapped (Ray, 7 Oct 2026: *"ensure all lines are not gapped, must show
  consistent line DoD"*).** A day a score was not measured CARRIES its last reading (`histCarry`):
  the line runs on, its day-on-day row shows a HOLLOW mark (not measured, nothing moved), and the
  hover says which day's reading it carries. A reading from before the window seeds the first
  days; nothing is drawn before a score's first reading. The one join that is not a carry — a
  Golden Score read on a new basis (keywords from 30 Sep 2026) — is DASHED, and the key names it
  only when one is on the chart: the two ends were measured differently and are not compared, but
  the line does not stop. `histModel` itself is unchanged, so the engine twin and Leadership's
  tiles (which still show an unmeasured day as a gap) read the same measured days.
- **Rings stay per line.** A day set by a run by hand wears a ring on that score's line.
- **One hover, all three.** Hovering a day reads every score that day: its value, its move against
  the day it was last measured, and — for the Golden Score — the attributes that moved it.
- **One change log.** Score moves and analyses are listed together, newest first. The header
  counts both ("6 score changes · 3 analyses in view").
  An analysis is TWO rows (Ray, 8 Oct 2026: "Content Quality in 1 row and AI Readiness in 1 row, unit
  changes each individual row") — each score with its own from → to and Δ, never paired in one cell.
- **AI-readiness keeps its tier ladder** on the AI card and in the KPI. On this chart it wears its
  series colour like the other two, since colour here names the score, not its band.
- **Client documents** carry the three lines, the rows of bars and the log. The range is the only
  chip.
- **Leadership's tiles** still set the window they open on (`gr-hist-rng`). The `gr-hist-met`
  they also write is no longer read; all three scores are always drawn.

`tools/check_grhist.js` renders it: three lines in three colours on one axis with no switch, each
named at its end, each bar inside its own score's row, the gaps and rings per line, the hover
reading all three, the merged log, the client download and the dark steps.

### 9.12b Every market at the foot of the client documents (7 Oct 2026)

Ray: *"For multi-market clients, when you download the HTML or report card, at bottom there should
be an overview of all the market scores as well."*

The ⬇ PDF and ⬇ HTML read ONE market. A brand on 28 markets sent its client a file that never said
how the other 27 stood. Now both documents (and a bare Ctrl+P) end with an **All markets** table,
written by `mktOverview()` into `#print-mkts` at the moment an export starts (`fillPrint`, the one
call all three exits share).

- **One row per Google Shopping market of the brand**, in the estate scorecard's order: Golden
  Score, content quality, AI-readiness (with its tier name), products, required attributes
  missing (named) and the day it was scanned. Each score has a short bar on one track length, so
  a fill always means its number.
- **The report's own market prints the document's numbers** — the dial, the content-quality
  headline and the AI ring above it — not the estate index's copy, so one file never shows two
  figures for one market. It is marked *this report*.
- **A dash is a dash.** A market scanned but not analysed shows a dash for content quality and
  AI-readiness; a market never scanned says *not scanned yet*. Never a zero.
- **Averages read only the markets that carry each score**, and say how many (*of 3*) when that is
  not all of them. Products are summed over the scanned markets; the required-missing cell counts
  the markets missing one.
- **A single-market brand gets nothing** — the document above already is its only market.
- **Never on screen.** The estate scorecard is this table for the AM. Demo mode masks the brand
  name here too.

`tools/check_grmkts.js` (Playwright, presync) renders a four-market brand — one analysed, one
analysed elsewhere, one scanned only, one never scanned — and checks the Ctrl+P layout, the
one-click PDF capture, the HTML file (position, figures, no buttons), that the table fits the
PDF's 960px column on one line per row, demo mode and the single-market case.

### 9.12c The Catalogue's modules at the end of the ⬇ HTML, picked by the AM (7 Oct 2026)

Ray: *"within Golden Score record, at bottom, pull in modules dashboard from Catalogue (module) also, and
Leave AM to actually select which module of the dashboard is shown inside the HTML download. For example,
with content depth, there could be multiple content depths displayed on the dashboard. It could be images
per product, highlight per product, length, or description length. All this would be added at the end of
the HTML, and AM can also have the option of not including it if it's not needed."*

- **A card under the scorecard** (`#catx`, on screen only) offers *Show the Catalogue dashboard for
  <Brand> <MKT>*. It loads on demand, because the Catalogue streams the feed and the master — not a cost
  to pay on every visit to /golden.
- **The real Catalogue, framed.** `/catalog?embed=mods&client=&market=` shows the module grid alone
  (`html.emb`): no topbar, hero, KPI band, table or injected layer, and no Fee check (a calculator, not a
  reading). It is the same page and the same engine, so a module reads here exactly as it reads there.
  Nothing the frame does is remembered on the device: every Catalogue preference is read through an
  in-memory layer (`EMB`/`MEM`) and written only there, the module set starts complete, the frame keeps the
  address it was opened on (rewriting it would drop `embed=mods`), and the phone's skim view and the ⓘ
  collapse stand down (`data-no-digest`, `data-no-collapse`) so the cards stay whole. The frame is capped at
  860px and scrolls inside its card.
- **A long card scrolls, it is never cropped (8 Oct 2026).** The file is read at the client's width, so a
  ten-row ROAS list or the stock matrix with its legend can run past the 340px every card keeps. The square
  stays and the card's body scrolls inside it, with a thin scrollbar (Ray: "i like the balance square sizes so
  maybe make it scrollable").
- **One tick per card, per measure.** Each card gets an *In ⬇ HTML* tick. A card with a measure (Content
  depth, Catalogue mix, ROAS by, Optimised vs not) is ticked per measure, so images per product and
  highlights per product are two picks. Image pixels' scan-count select is a control, not a measure.
  The picks are chips on the card, each with ✕, plus *Clear all*.
- **Nothing is carried until something is ticked.** The picks live per device (`gr-catx`) and outlive the
  market, so a set chosen once applies to the next brand.
- **The export.** ⬇ HTML reads each pick in order: it sets the measure, waits for the card to finish
  reading (and for a measure list that is only built once the feed is read), and copies the card as drawn,
  with every control, link, id, click hook and "click to list" tooltip removed. The cards go into a
  script-free frame (`sandbox=""`, `srcdoc`) with the Catalogue's own stylesheet, so neither page's CSS can
  restyle the other's. The grid keeps a fixed column count and the Catalogue's fixed card height, so the
  frame holds the whole grid at any window width. The section sits after the all-markets table and before
  the footer. The frame is put back on the measures the AM left it on.
- **A pick that cannot go in is named on the card** (*Left out of the last download, not on this market's
  Catalogue: …*), never silently dropped. A signin without the Catalogue (or a page that did not load) says
  so at once and offers the button again.
- **The PDF does not carry the modules.** It is a picture of the page, and a frame is not.

`tools/check_grcatx.js` (Playwright, presync) serves both real pages over HTTP and runs the Catalogue on
the synthetic Northwind set: the card, the frame (this market, grid alone, every module, no Fee check,
reading but never writing the device's preferences), ticking two measures of one card, the file (position,
the three picks in order, a chart in each, no control or hook, the stylesheet, one row, no inner scroll at
two window widths), the frame put back, ✕ and Clear all, a saved set exported with the frame closed, and a
signin without the Catalogue.

### 9.12e ⬇ PDF is the ⬇ HTML on paper (8 Oct 2026)

Ray: *"can the PDF download format be adapted to latest update and ensure design is consistent?"* The PDF
used to rasterise the live page under `body.pdf`, an older layout that had drifted from the ⬇ HTML (which
follows the interface: the wash page, the header band with its dial, the pop-up cards, the all-markets table,
the Catalogue modules). Now both are ONE document. `exportDoc(k, cx, paper)` builds it — ⬇ HTML saves it, ⬇ PDF:

- keeps the file's own folds (each section's method open, attributes and pillars folded on their score and worst
  rule — fully open ran past four A4 lengths and printed every finding twice), opens the depth explanations, and
  strips a closed fold to its summary line, because html2canvas paints a closed `<details>`' body anyway, straight
  over the next section (found in the first real render);
- drops what cannot work on paper (`body.xpaper`): fold chevrons, the "how it's scored" chips that cannot open;
- lays the document out in an offscreen frame at the file's own width (`PDF_W` 1220), waits for Lato, draws the
  Catalogue frame into an image in place (a canvas cannot see inside a frame — the frame is opened
  `allow-same-origin`, still with no scripts, and its cards grow to their content: a row stretches to its tallest,
  so the squares stay even and nothing is cut where nobody can scroll), and rasterises the whole thing onto one
  continuous 210mm sheet. The live page is never touched; the render frame is removed after the save.

The Catalogue modules now travel in the PDF too (they did not before). The print dialog stays the fallback when
the libraries cannot load, and a bare Ctrl+P still prints the page's own `body.pdf` layout. The Catalogue section
sits on the scorecard's column in both files (it hung off the page edge). Harness: `tools/check_grpdf.js` asserts
what html2canvas is handed (the export document, not the live page; folds; no pop-up hooks; the wash page; the
frame cleared), and with `GRPDF_LIBS=<dir>` runs the REAL html2canvas + jsPDF (`GRPDF_SHOT` keeps the page image);
`tools/check_grcatx.js` with `GRPDF_LIBS` proves the picked cards are drawn into the PDF.

### 9.12d Every scorecard section folds (7 Oct 2026)

Ray, over a screenshot of the "Two scores, two questions" card: *"make these boxes collapsible as
well"* — the estate cards already folded; the scorecard's own boxes did not, so a feed's card ran
to eight full sections whether or not the AM needed them.

Every `.tier` box on the scorecard — Score history, the four spec tiers, Content quality,
AI-readiness and Two scores — now folds on its own: a chevron (`.tfold`, `aria-expanded`) at the
front of the header, and a click anywhere on the header that is not one of its own controls
(ⓘ Scoring logic, Re-analyse, the history range chips keep doing their job). **⊖ Fold all
sections / ⊕ Open all sections** sits beside ⚙ and always names the action still available.

- **A fold never hides a finding.** The header stays: badge, title and what the section found —
  `avg fill`, `4 of 6 live`, `⚠ N fields read differently` — and Content quality / AI-readiness,
  whose headline number lives in the body, carry it into the header while folded (`.tf-sum`).
- **Defaults:** "Two scores, two questions" starts folded (it explains how the two sections
  score; it is not a finding about the feed); every other section starts open.
- **A device preference**, like `gr-collapse` for the estate cards: `localStorage gr-tfold`
  `{key: 1|0}`, never shared state. Keys: `hist req cond rec ai qual air recon` (the four tiers by
  `data-tf`, the rest by their ids). An explicit open of a default-folded section is remembered.
- **Re-applied on every render** (`renderDetail` → `tfApply`) and when the history card redraws
  itself in place (`histRedraw`).
- **Exports always print open:** the fold rule is `body:not(.pdf)`, so ⬇ PDF, ⬇ HTML and Ctrl+P
  paint every section; `.tfold`, `#tf-all` and `.tf-sum` are hidden in `body.pdf` and removed from
  the HTML file.
- **Phone:** the skim view hands a tap on a heading that already toggles to that heading's
  `[aria-expanded]` button, so the header's own handler stands down when the skim view has claimed
  the heading — one tap is one toggle.

Tripwire `tools/check_grfold.js` (Playwright, presync) renders the real page: every section
carries the chevron, the fresh-device defaults read off the paint, header click / chevron /
header controls, the stored choice and a reload, fold-all / open-all, the folded headers keeping
their score, the print layout and the downloaded HTML opened in a browser with every section open,
and at 390px one tap = one toggle (negative control: with the stand-down guard removed, a heading
the skim view claims folds and re-opens on one tap).

### 9.13 The portfolio trend on Leadership (24 Sep 2026)

Ray: *"Should there be an additional interface for AM only to view these charts across their
portfolio at once?"*, then *"can you build on leadership"*.

The Score history card shows one feed. **Leadership › Golden Record — portfolio trend** puts every
Google Shopping feed's line on one screen, filtered by the account's AM.

**Nothing is scored on Leadership.** `GET /api/golden/portfolio?days=30|90|365` runs each feed's
record (`goldenhist`) through the engine's `histSeries` under the brand's current profile. The
engine now holds `attrsFromCov` (the page's twin) and `histScore`, so the server scores a stored
reading exactly as the page does. The estate index's own reading closes each line, so a tile ends
at the score the estate scorecard shows. A day reads exactly as it does on the card:

- **Golden Score:** the day's reading (a hand-run one first). On a day the feed was scanned
  without moving, the last reading carries. A day nobody scanned is a gap.
- **Content quality and AI-readiness:** the day's analysis, or a gap.
- **Basis:** a reading measured on another basis than the latest (before GPC category scope) is
  left out, so no tile draws a jump nobody made.

Leading days with no value are trimmed off, so a young record costs a few numbers, not a year of
nulls. Each series carries a summary per metric: now, first value in the window, the change and
its direction. A move under `PORTFOLIO_FLAT` (0.5) reads as flat.

**The AM** is the Task Manager's (`tmidx`, the same name the hours badge shows), matched on the
folded client name. A brand the Task Manager has not reached is listed under "No AM on record",
never guessed. The route is scoped per signin like every client list (scoping only narrows).

**The page.**

- One row of filters: AM (with counts), score (Golden Score · Content quality · AI-readiness),
  window (30 days by default · 90 days · 1 year), Movers first / By account, ⊞ Table. All
  remembered per device (`fcc-lead-gp`). A remembered AM who no longer has a feed falls back to
  All rather than an empty grid.
- A strip: the average, then Improved / Declined / Flat / No reading. Until a feed has two
  measured days there is nothing to compare, so those three print a dash, not a zero.
- One tile per feed: account · market · AM, today's value in the audit colour legend
  (AI-readiness on its tier ladder), the change since the first measured day in the window in the
  Score history card's own blue / orange pair, and a small line.
- **One calendar for every tile.** The x-axis is the whole window with today on the right, so a
  record that began last week starts near the right edge. Each tile's y-range is its own, at least
  four points tall, so the printed change is the headline, not the slope.
- Movers first: drops (biggest first), gains, flat, one reading, then none. Within the quiet
  groups the lowest score leads.
- Hover gives a crosshair and the day's value. Clicking a tile opens `/golden#<client>|<mkt>` with
  its Score history card on the same score and window.
- An unauthenticated read (the Access login page, HTML with a 200) reads as a failed read, never
  as an empty book.

**Harnesses.** `tools/test_goldenhist.mjs` covers:

- the series rules;
- the page's own `histModel`, lifted from /golden and run on the same record: every day of all
  three scores must match;
- the route and the page wiring.

`tools/check_leadgp.js` (Playwright, presync) builds the payload with the real engine and uses
the real Leadership page: order, gaps, the shared calendar, the AM filter, the score and window
switches, the table, hover, the click-through, the empty and error states, dark mode and 390px.
`tools/test_bands.mjs` lifts Leadership's copy of the colour legend.

### 9.7 AI-Readiness on the scorecard (`/golden`, under content quality)

Ray, 16 Sep 2026: *"bring in the AI readiness score on the feed lab section … anything from the
feed lab section that is colour-coded or nicely presented should be included … you can bring in
title anatomy to be nested after title content quality scan … the most important item is the AI
readiness score."*

Feed Lab already computes this — one weighted score across eight pillars, the four-tier ladder,
and the MASK title anatomy — so the scorecard **reuses that engine rather than growing a second
opinion**: the same `feedlab_engine` `audit()` the `/feedlab` page calls, run on the SAME stream
the content-quality read is already pulling. One fetch, two readings, and the same feed reports
the same number on both pages.

- **Sampling:** rows are collected to `AUD_CAP` (30,000) with `rowTotalEstimate` set to the true
  row count — the contract `audit()` documents, so every count it reports is scaled back to the
  whole feed and a 125MB feed costs a bounded slice of memory rather than all of it.
- **Stored** with the quality reading (`goldenqual:`), trimmed by `packAudit` to what the card
  renders — total, tier, the eight pillars, the title anatomy. The worker re-validates that shape
  (pillars capped at 8, numbers clamped, strings cut) so the store cannot be widened from the
  browser, and puts `air` / `airTier` on `goldenidx`.
- **Card:** the Feed Lab visual language, same class names — the conic-gradient ring coloured by
  band, the `Tier N · Label` pill with "+N points to Tier N+1", the four-rung ladder with YOU ARE
  HERE, and the eight pillar cards (score, bar, weight dots, one-line rationale). A footnote says
  plainly that the pillars are weighted, so the headline is not their average.
- **Title anatomy** nests under the `g:title` row of the content-quality read — the MASK spectrum
  (Brand / Material / Fit / Colour / Use-case, each with its share and SKU count) and the length
  histogram with the 80–120 window marked — because that is the anatomy of the titles whose
  CONTENT the rules directly above it just judged.
- **Pillar heatmap** (Ray: *"the pillar heatmap is great too"*): under the pillar cards, this
  brand's analysed markets × the eight pillars, the Feed Lab grid scoped to one brand — same
  colour scale, the weakest cell across the brand ringed and named in the subtitle ("weakest: DE
  Agentic at 31"), and a row click opens that market's scorecard. It reads off the estate index,
  which carries each analysed feed's per-pillar scores (`airP`), so a market nobody has analysed
  says "—" rather than pretending to a number; it appears once a second market has been analysed
  (one market is a card, not a heatmap). A finished analysis mirrors onto its own estate row
  exactly what the worker writes to `goldenidx`, so the feed joins the grid immediately rather
  than after a reload.
- **In the PDF — the page SCALED, not a second design** (Ray, 16 Sep 2026: *"PDF export still
  doesn't reflect exact same visual as FCC"*): print used to restyle twenty-odd properties on
  the way to paper — smaller dial, tighter rows, cut type scale, different grid columns — which
  made the download a compact variant of the scorecard rather than the scorecard. `body.pdf` now
  lays the page out at its DESKTOP width (960px) and scales the whole document with `zoom` so
  that width lands exactly on the 186mm printable column: every size, space, colour and column
  ratio survives, only the ruler changes. `zoom` and not `transform:scale` — transform is
  paint-time, so Chrome paginates on the unscaled height (the lesson the keyword-calendar PDF
  already learned). The only print rules left hide interactive chrome, restore the page's own
  ≤900px responsive rules to their desktop form (the print viewport is 703px, so they would
  otherwise hand the client a phone layout on paper), and frame the document with its header and
  footer. `tools/check_grpdf.js` reads the type scale, padding and dial on screen and again in
  print mode and fails on any difference beyond zoom rounding, so a compact variant cannot creep
  back. It prints with everything else. Print pins the card's desktop geometry
  (`body.pdf .score-grid`, `.ladder`): the ≤900px rules stack the ring above the ladder, which is
  right on a phone but would make the measured sheet shorter than the printed document — the same
  trap that had already eaten the spec note and the quality findings. The full document — four
  spec tiers, content quality, AI-readiness — lands at roughly two A4 lengths on its single sheet,
  and `tools/check_grpdf.js` asserts the score, the ladder and all eight pillars are present.

**The scorecard header rides with you** (Ray, 16 Sep 2026: *"when using the Golden Score card and
scrolling down to review the feed scorecard, make sure this section stays frozen when scrolling
down"*). The brand, the dial, the Δ reference and the actions pin under the topbar — whose height
is *measured*, not assumed, since the topbar is sticky itself and grows with the phone layer and
the view-as pill. Once pinned the block **condenses** (dial 150 → 74px, verdict paragraph away,
206 → ~120px): a header frozen at full height is a wall across the viewport, not a help, and what
stays is what you need while reading rows. The stuck state is read off the element's own position
on each animation frame rather than tracked with a sentinel — `renderDetail` rewrites the panel
whenever the profile, the reference or a finished analysis changes, and an observer bound to the
old nodes would watch a detached element while the visible one never condensed. Under 760px it
scrolls away like anything else (the viewport is the scarce thing on a phone, and every control
stays on the page — the phone tripwire's rule). Printing takes the page **at rest**: `body.pdf`
un-pins it and the condensing pass stands down, or the PDF would carry whatever size the dial
happened to be when the reader hit ⬇ PDF.

### 9.8 Two scores, two questions (`/golden`, under AI-Readiness)

Ray, 16 Sep 2026: *"there's definitely a discrepancy between the scoring of content quality
versus AI readiness. For example, the description for Superdry GB has a content quality score of
60.1, but the AI readiness score is 89. Is there a different scoring matrix for each? Also, if
you go through taxonomy depth, AI readiness is only 49, whereas the product type / Google product
category is rated almost 100 in content quality. How do we bring this together and flag IF there
is different scoring logic between the two sections."*

There is, deliberately — and the answer is not to average them. **Content quality** scores
PRODUCTS against rules Google *states*: a floor (does this risk disapproval, or leave stated
guidance unused). **AI-Readiness** scores the feed against the agentic ladder: a ceiling (how far
toward best-in-class), blending coverage, depth and uniqueness inside each pillar. A field can
pass every stated rule and still be shallow; a field can be complete, long and legal and still be
boilerplate. Both are computed from the **same single read of the same products at the same
moment**, so a gap between them is a finding about the feed, never a disagreement between tools.

**One real inconsistency, fixed.** Chasing Ray's description case down to the live Superdry GB
feed exposed a genuine difference in *method*, not just in question: the AI pillar judged
duplication per `item_group_id` (size variants legitimately share copy) while the content-quality
rule counted every repeat. 99.7% against 55%, for the same field on the same read. The rule is now
variant-aware (§9.6) and the description reading moves 60.1 → 67.6.

**The rest of each gap is explained, not removed.** The band lists each field pair with both
numbers, the gap, and what each side is measuring — the live worst-breaking rule on one side, the
pillar's own summary on the other — and flags any gap of 15 points or more:

| pair | quality measures | the pillar measures |
| --- | --- | --- |
| `g:title` ↔ Title anatomy | the stated rules (150-char cap, capitals, promotional copy, a shared title) | length against Google's 70/150 edges and the MASK slots the title carries |
| `g:description` ↔ Descriptions | the share of PRODUCTS sharing copy with a different product | the share of DISTINCT copy reused — and only a fifth of the pillar, next to coverage (½) and length against Google's 160–500 (³⁄₁₀) |
| `g:google_product_category` + `g:product_type` ↔ Taxonomy depth | whether each value is SHAPED as Google specifies (a taxonomy value, a " > " path, not too broad) | the SAME chevron depth (`pathDepth`), graded per product — an ID, 3+ levels or a branch Google ends at is full credit, two levels half, one a quarter, missing nothing |
| `g:color` `g:material` `g:pattern` ↔ Attribute completeness | whether the values that are there are usable | weighted COVERAGE of the variant attributes |
| `g:product_highlight` ↔ Structured detail | the stated highlight rules (≥2, ≤100, 150 chars each) | highlights per product against Google's recommended four, product_detail coverage, description length against 160–500 |

**17 Sep 2026 — the two sections read depth with ONE function.** Ray, on Schuh GB: *"product type is
after scan for content quality; it says average 3.3 level depth while AI readiness in structured
detail tiles only says product type 2.2 level depth so consistency is not adhered."* The tile was
counting filled keyword slots (`product_type(2..10)`) and had lost the category column altogether
on XML feeds; the Feed Lab engine now resolves the primary column exactly as `KEY_ALIASES` does and
counts levels with `pathDepth` ported verbatim, `tools/test_feedlab.mjs` asserts the two engines
return the same `avgDepth` on the same rows, and the Structured detail tile no longer states a
product_type depth of its own (Taxonomy depth owns it). Every other pillar was vetted against the
published specs at the same time — `docs/FEEDLAB.md` §5 has the per-pillar account — and the
explanatory subtext under both sections is gone: a pillar tile and a content-quality row are a
name, a number and a bar, and each opens a **scoring pop-up** (the formula, this feed's own
readings, the rules with their severities and hit rates, the Google / OpenAI / Anthropic page each
threshold comes from, and a box naming anything that is FeedSpark's own standard). Both sections
carry an **ⓘ Scoring logic** button for the headline.

Superdry GB, as it stands: description 67.6 vs 89 (different denominators — one boilerplate
paragraph on thousands of products is thousands of products but a single value); GPC + product
type 99.6 vs 49 (every path clears the stated minimum while the catalogue stays shallow);
title 94.6 vs 71 (breaks no rule, carries few MASK slots).

**Which to use.** Content quality for what to fix and what to brief — every finding quotes a rule
Google publishes, so it survives a conversation with the client. AI-Readiness for what to sell and
where the feed sits on the ladder the readiness decks speak. A wide gap is the useful case: it
names a field that is compliant and underused, or complete and not yet correct. The band prints
with the rest of the scorecard.

## 9.6 Content quality — is the data any GOOD? (`/golden`, the fifth section)

Ray, 16 Sep 2026: *"what's missing is also reviewing the data quality of each attribute,
especially if they contain free content (title, description, product highlight, GPC, product
type, material, pattern…) — each of these has its own standard of what good quality must look
like (benchmark rating against Google's support page)."*

Golden Record's four tiers answer **is the attribute there, and how full is it**. This answers
**is what's in it worth having** — and it is measured, not asserted: every rule is one Google
states on that attribute's own specification page, carried in the engine with the answer id so
each finding quotes and links its source.

- **Roster (`QSPEC`, 8 attributes / 46 rules):** `title` (6324415), `description` (6324468),
  `product_highlight` (9216100), `google_product_category` (6324436), `product_type` (6324406),
  `color` (6324487), `material` (6324410), `pattern` (6324483).
- **Two severities, never blurred:** `fail` = a stated REQUIREMENT (over the character limit,
  promotional text, block capitals, HTML, links, placeholder values, a non-colour in `color`) —
  disapproval or truncation risk; `warn` = a stated BEST PRACTICE (a title under 70 characters,
  fewer than 4 highlights, a category under three levels, a single-level product_type,
  duplicated copy) — legal, but performance left on the table.
- **Judgement calls the rules make carefully:** capitals are read as *emphasis*, so the brand is
  stripped first — HUGO BOSS is a logo, `SALE NOW ON` is a shout (`stripBrand` + `shoutyCaps`);
  a bare top-level GPC name is *shallow*, never *invalid* (the full 5,500-value taxonomy is not
  worth shipping into the page, so the rule tests the SHAPE Google specifies); `n/a` is caught
  once, by the placeholder rule, and never double-counted as a multi-value pattern.
- **Scoring:** a rule costs the share of *filled* products that break it, weighted by severity
  (`QW` fail 1.0 / warn 0.4) — a requirement broken on 40% of products costs 40 points, the same
  break on a best practice costs 16. Attributes weigh 3 (title, description) / 2 (highlights,
  GPC, product type) / 1 (colour, material, pattern), the same shape as `goldenScore` so the two
  numbers read alike. Bands: ≥90 ✓ meets the spec, 75–89 ⚠ below best practice, <75 🔻.
- **Where the data comes from:** the BROWSER streams the feed once through `qualityCollector`
  (the worker never parses a feed — the Feed Lab CPU rule), scoring every row as it arrives;
  duplicate detection is a bounded value→count map and example offenders are capped at 4 per
  rule, so a 125MB feed costs megabytes. What is stored (`PUT /api/golden/quality` →
  `goldenqual:<client>:<mkt>`) is the compact aggregate — hit counts, percentages, a handful of
  example values — and the worker keeps only attributes and rule ids the spec knows, so a client
  cannot widen the store. The feed's quality score rides onto `goldenidx` (`q`, `qFails`, `qT`) —
  and **every scan that rebuilds the entry carries it forward** (`keepQual`, with `air` /
  `airTier` / `airP`): before 21 Sep 2026 `processScanSnapshot` and the ack rebuilt the entry
  from the scan alone, so each cron / agent / estate pass wiped the content score and the dossier
  scorecard read FEED only within an hour (Ray: "why content quality score isn't saved?"). The
  reading stays what it was until the next analysis; `qT` dates it.
- **Page:** a fifth section under the four tiers — headline score + plain-English verdict, a row
  per attribute (score, bar, worst rule, requirement/best-practice counts), click a row to expand
  every broken rule with Google's own wording, the offending values, the hit rate, and a link to
  the specification page. Per attribute: **✉ Ask client** (`qualityAskEmail` on the shared
  askdraft rails) and **→ Brief** (a Workflow deep-link that also files "Content Quality -
  g:<attr>" into the client's Project Plan), hidden in 🎭 demo mode and in the PDF.
- **Honest about what it did not read:** a free-text column that debuts deeper in an XML feed
  than the first product was never in the header when the stream started (the Monsoon
  `custom_label_1` lesson), so it is named as *not measured this run* rather than scored from a
  partial column.
- **A duplicate is a GROUP, not a list of strings** (Ray, 16 Sep 2026, reading Monsoon GB:
  *"the issue you highlighted — titles duplicated across products — is not correct"*). The count
  was right: 76 of 9,664 products across 35 shared titles, verified against the live feed, real
  products with different PDPs carrying an identical title. The *evidence* was wrong — four
  different-looking titles listed under one finding, with nothing saying each of them appears
  twice, reads as a false positive. The collector now keeps each repeated value with its repeat
  count and the ids of the products carrying it (`groups: [{v, n, ids}]`, biggest first, capped
  at 4 groups × 4 ids; `vals` = how many distinct values are shared), and the example list names
  a value ONCE instead of pushing it again on every repeat. The page renders `×4 <title>` with
  the product ids under it, the hit column reads *76 products / 35 values*, and a caption states
  the test: one whole value, matched case-insensitively.
- **Variant-aware, where Google is** (16 Sep 2026, and most of why the two sections disagreed —
  see §9.8). Google asks the **title** to carry "distinguishing details of each variant", so a
  title two rows share is a finding however they are related, and that rule counts every repeat.
  The **description** rule is about boilerplate ("describe only the product itself"), and
  variants of one product legitimately share copy — so it counts only copy reused across
  *different* `item_group_id`s, the same call the Feed Lab audit makes, and reports the rest as
  context ("a further N products share copy only with variants of the same product — expected,
  and not counted above"). Measured on the live Superdry GB feed: 99.7% of products before,
  81.0% after, with 4,858 products across 1,136 values correctly set aside. Every group is
  labelled *different products* or *variants of one product*.
- **A repeatable attribute is read across EVERY column it occupies** (Ray, 16 Sep 2026: *"I
  don't think a highlight quality scan is accurate because when I look inside Monsoon Shopping
  UK, each product has at least four to five highlights, so why is it now showing as zero
  point?"*). He was right. Monsoon GB ships four repeated `<g:product_highlight>` elements per
  item; the Feed Lab XML parser expands them to `g:product_highlight`, `(2)`, `(3)`, `(4)`; and
  the quality read resolved ONE column, saw one value, and fired *"fewer than 2 highlights"* on
  100% of the catalogue — scoring the attribute 0/100 off a feed that meets the spec. The
  collector now joins every slot column (plus any `|||` form) back into the list the rules
  already split on, so no rule changed, and length is measured **per value** rather than across
  four glued together. Each row prints what it counted — *"read across 10 columns — 4.1 values
  per product"* — because a count nobody can check is a count nobody should trust. Live Monsoon
  GB: `g:product_highlight` **0 → 91.1**, content quality **79.2 → 91.4**, 4.1 highlights per
  product. Without a header the collector keeps the old single-column behaviour exactly, and
  the harness pins both paths.
- **The scan shows its progress** (Ray, same day: *"ensure this scanning is high quality and
  takes as long as needed, you don't need to rush it — allow the user to see a progress bar"*).
  Nothing is sampled or cut short: every product is scored. `qualityRun` hands its caller a
  progress record (phase · bytes read · bytes expected · products scored) rather than a
  sentence, and the band under the section draws **% · MB of MB · products scored** with an ETA
  computed from the rate measured so far — no guess before ~1.5s of reading. The size comes from
  `x-feed-bytes`, which the feed proxy forwards from the upstream XML feed (informational only —
  *never* as `content-length`, which truncates a decoded stream). A sheet export declares no
  size, and a feed that outruns its declared size can't be trusted either, so both fall back to
  an indeterminate bar that says *size not declared* rather than inventing a percentage.
- **Taxonomy depth for GPC and product_type** (Ray, 17 Sep 2026: *"bringing PT depth (seperated
  by >) in the Content Quality for product type as well pls and GPC"*). Content Quality already
  had a `shallow`/`single-level` warn rule for these two attributes (fewer than three levels, no
  hierarchy at all), but that only says whether a path clears a threshold — not how deep the
  catalogue actually goes. Both attributes now carry `depth: true` on their `QSPEC` entry, and
  the collector accumulates each value's chevron/slash depth via the SAME `pathDepth` read
  Product Type Guard's `depthProfile` and Feed Lab's `gpcDepthAvg` already use — so this number
  can never disagree with either sibling surface. `avgDepth` (one decimal) rides through
  `attrQuality`/`qualityScore` alongside `avgLen`, is allow-listed through the `/api/golden/
  quality` PUT sanitizer the same way `cols`/`perProduct` are, and prints on the row's detail —
  *"Measured: average length 47 chars (47–47) · averaging 4 levels deep"* — in both the
  broken-rule state and the "every rule passes" state. A bare numeric GPC id or an unseparated
  product_type value reads as depth 1, matching how Feed Lab already treats them.
- **GPC's "too broad" rule knows which branches actually end** (Ray, 17 Sep 2026, uploading
  Google's official `taxonomy-with-ids.en-US` export after a live scorecard flagged "Apparel &
  Accessories > Shoes" "too broad — fewer than three levels": *"if the final GPC (Shoes) which
  has no further clarification from Google, then that's already optimal"*). The `shallow` rule
  tested only the STRING SHAPE — fewer than three `" > "`-separated levels — with no way to know
  whether Google's fixed taxonomy actually offers a third level under that branch; Shoes has
  none, so choosing it correctly still read as a merchant stopping short. `GPC_LEAF2` (a Set of
  52 lowercased `"top > second"` strings, derived once from the official export by finding every
  second-level node with zero third-level descendants — Google's 21 top-level categories all
  branch further, so a bare one-level value still always warns) is consulted before the rule
  fires: a two-level value only warns when a deeper option genuinely exists. Snapshot, not
  live-fetched, for the same reason the rule's own comment already gives for not shipping the
  full ~5,500-row taxonomy — re-derive the list if Ray supplies a refreshed export. Harness: the
  GPC "too broad" block in `tools/test_labelguard.mjs` (Shoes exempted case-insensitively,
  Clothing — a real non-leaf — still caught, a bare top-level value still caught).
- **How many highlights spotted, out of 100** (Ray, 17 Sep 2026: *"showcase what you have done ...
  which is how many highlights you have spotted within 100. So recommendation is from 6 to 10"*).
  Google's own spec (answer 9216100) is a 2-minimum with 4–6 recommended, up to a ceiling of 100 —
  already enforced above as the `count-min` (fail, <2) and `count-low` (warn, <4) rules. This is a
  separate, purely descriptive read of the SHAPE of the catalogue against Ray's own house target of
  6–10, layered on top of Google's base spec the same way Product Type Guard layers its 5-depth
  standard on top of Google's own required attributes — never replacing the base rule, never
  inventing a pass/fail threshold Ray didn't give (he named a range, not a target coverage %, so the
  card states the observed share rather than judging it ✓/⚠). `qualityCollector` buckets every
  product's highlight COUNT (not each highlight value) — **exact counts since 18 Sep 2026**: `1`,
  `2`, `3`, `4`, `5`, `6+`, the population keys (Ray: *"the table breakdown for highlight population
  (1, 2, 3, 4, 5, >5)"*; the five coarse bands 0-1/2-3/4-5/6-10/11+ are gone) — and reports the
  SHARE of filled products in each (`hlDist`), rounded to one decimal. Rendered on the
  `product_highlight` row as the **population table** — `popCard()`, the PT depth card's own row
  format (one row per bucket, label · bar · %), the same card `/labels` and `/ptypes` draw — with
  `6+ highlights (our target)` marked, a footer of avg per product · products profiled, and a
  verdict line separating Google's stated 4–6 (the share at 4+) from FeedSpark's own 6–10 house
  target (the share at 6+). (The earlier stacked bar was a workaround for the page's vertical
  `.thist`/`.thb` histogram rendering at 0px — a pre-existing CSS bug, still left alone.) `hlDist`
  is allow-listed through the `/api/golden/quality` PUT sanitizer with its fixed bucket keys, each
  independently clamped, the same discipline as `cols`/`perProduct`/`avgDepth`.
- **Content quality follows the same industry profile as `goldenScore`** (Ray, 17 Sep 2026,
  screenshot of a Pet Care brand's AI-Readiness pillar scoring 30/100 off empty apparel fields:
  *"make sure all scoring (AI readiness, content quality) always refer back to the industry best
  practice that had been set"*). `qualityScore(snap, profile)` now takes the same `profile` shape
  `goldenScore` already consults (§8's industry scoring profiles) and skips any `QSPEC` attribute
  named in `profile.waived` before scoring it — dropped from both the numerator and denominator,
  same as `goldenScore`'s own waived attributes. An attribute nobody fills already scored `null`
  (excluded) before this change — the fix only matters when an industry-waived attribute (`pattern`
  for Pet Care) carries a handful of stray values that would otherwise still be judged by
  apparel-oriented rules. Every page call site now threads `profileForC(client)` through: the three
  `LGQ.qualityScore(...)` calls (the scorecard section, the per-attribute ask/brief lookup, the
  quality↔AI reconciliation band) and the nested Feed Lab `audit()` call that produces the AI-
  Readiness card also pass `expected`/`waived` — see `FEEDLAB.md`'s "Attribute completeness follows
  the industry best-practice profile" for the AI-Readiness half of this fix (cond-tier vs rec-tier
  attributes are excluded by two different rules, not one blanket waive-list check), which applies
  identically whether that engine is reached nested inside `/golden` or from `/feedlab` itself.
  Harness: the industry-profile block in `tools/test_labelguard.mjs` (a waived attribute drops from
  `qualityScore`'s parts entirely; the other parts are untouched; no profile passed keeps the old
  behaviour byte-for-byte) and `tools/test_feedlab.mjs`.

- **Does this issue apply to the brand? — per-rule waivers** (Ray, 21 Sep 2026: *"within golden
  record content quality analysis. For each problem, for example under Title, allow a button to
  indicate whether the issue actually applies for the brand. For instance, I'm looking at Reiss,
  brand not in title mistake where the title is not applicable, so it should be possible to remove
  the issue and have the overall score reanalyzed"*). An attribute waiver drops a whole attribute;
  this drops ONE of its rules for ONE brand, and keeps the decision visible. **Store**: the brand's
  scoring profile — the same `goldenprofiles` KV record the ⚙ editor keeps — gains `qwaived`, a
  list of `<attr>:<ruleId>` tokens (`title:no-brand`). `profileFor` unions the industry-level and
  brand-level lists (a brand can add to what its industry set aside, never un-set it) and validates
  every token with `qruleKnown` against `QSPEC`, so a token naming no rule never reaches a score;
  `qwaivedFor(profile, key)` hands an attribute its own rule ids. **Engine**: `attrQuality(key, a,
  qwaived)` costs a set-aside rule nothing and drops it from `broken`, `fails` and `warns`, but
  reports it APART under `waived` with the share it would have cost — the issue does not silently
  disappear from a score a client is shown. `qualityScore(snap, profile)` threads the profile's
  tokens through and carries `setAside` (how many rules were set aside across the feed). **Route**:
  `PUT /api/golden/profile {scope:'client', name, qrule:'title:no-brand', waive:true|false}` toggles
  one token; the ⚙ editor's whole-record save and its ↺ reset both PRESERVE `qwaived`, since the
  editor never sees it (a decision made row by row cannot be wiped by a control that never showed
  it). **The stored headline follows**: on every profile PUT the worker re-scores each stored
  `goldenqual:<c>:<m>` reading of the affected brand(s) — the whole industry for an industry-scope
  save — against the new profile and rewrites `goldenidx` `q`/`qFails`, returning the moved figures
  as `requal`, which the page mirrors onto the estate in place; and the `/api/golden/quality` PUT
  now scores with `profileFor` too (before this the index carried the unprofiled score while the
  page showed the profiled one — the dossier and the one-pager read the index). **Page**: every
  rule row in an expanded attribute carries `✕ Doesn't apply to <Brand>` (`qualityWaive`); the
  set-aside rules sit under the findings in a dashed block "Set aside for <Brand> as not applicable
  — N rules the team judged not to apply, not counted in the score", struck through, each with
  `↩ Applies to <Brand> again`; the row's summary gains an "N set aside" chip; the attribute pop-up
  reads "set aside for <Brand> · x% not counted" on that rule instead of pretending it passes, and
  the headline pop-up says how many rules were set aside (or that none were). The button is an AM
  action — hidden in demo, hidden in the PDF and removed from the ⬇ HTML — while the set-aside block
  itself stays in the client copy, because the score it explains is the one the client reads. The
  Ask-client email and the → Brief read `broken`, so neither raises a rule the brand set aside.
  Harness: `tools/test_labelguard.mjs` — the engine (cost comes back at 0.4 × share for a best
  practice, reported apart, counts exclude it, a waived rule the feed does not break is nothing, no
  third argument = old behaviour, the profile reaches the attribute, the headline re-analyses,
  nothing else moves, a waived attribute still wins, the client email never names it; `profileFor`
  unions/dedupes/validates; `qruleKnown` + `qwaivedFor`) and the page/worker wiring.

## 9.5 PDP recovery scan — "missing data can be sourced from the PDP" (Ray, 14 Sep 2026)

**Why.** The Golden Record gaps are rarely gaps on the client's site: a 14 Sep 2026 probe of the
eight wired GB brands (three product pages each) found the composition, colour name, pattern,
fit/care rows, key-feature bullets, size guides and FAQ pairs sitting in the visible
"Fabric & Details / Composition & Care / Key features" sections — while the schema.org JSON-LD
mostly mirrors what the feed already sends (brand, sku, price, availability, images, breadcrumb).
So the scanner reads both, and it reads them in the **browser**: the worker never parses a
product page (same rule as the feeds — Feed Lab / Label Guard / Overlays run their engines
client-side; the worker only proxies bytes).

**Where.** `/golden` → every non-required attribute row carries **🔎 PDP** next to ✉ Ask client
and → Brief; the scorecard header carries **🔎 Scan PDPs** (every gap at once). Both open the
pop-up scanner: focus attribute (or every gap) · sample 10 / 25 / 50 · "AI read of the details
text" (on when the worker has `ANTHROPIC_API_KEY`, greyed otherwise) · Start.

**How (`docs/pdp_engine.js`, served at `/golden/pdp-engine.js`, harness `tools/test_pdpharvest.mjs`).**
1. `sampler(n, attr)` on the Feed Lab parser contract: the page streams `/api/feed/proxy`
   (XML or CSV, sniffed from the first bytes; header may grow mid-stream) into two reservoirs —
   rows **blank in the focus attribute first**, any row as the fill — reading at most 60k rows /
   48 MB.
2. Each sampled `link` goes through `GET /api/golden/pdp/fetch?client=&market=&url=`. **No open
   proxy:** the client/market must resolve to a wired or dossier-attached feed and the URL's host
   must equal that feed's own product host (learned once from the feed head — the first product
   `<link>` / link column — cached a day in `pdphost:<c>:<m>`; `www.` is the only tolerated
   variance, look-alike and sub-domains are refused). The fetch is bounded (9 s, redirects
   followed, HTML only, body read to 1.5 MB in the browser) and identifies itself honestly —
   UA `FeedSparkPDPScan/1.0` + `x-feedspark-scan` (the reachable sites serve it identically to a
   browser). A 403/429/503 is reported as **blocked** with the allowlisting ask.
3. `extract(html, url, row)` — JSON-LD (Product / ProductGroup / variants / offers /
   BreadcrumbList / FAQPage / positiveNotes) → OpenGraph `product:` meta → microdata → GA4
   dataLayer items → embedded JSON keys → the visible details text (label:value rows,
   composition lines → dominant fibre, pattern vocabulary, fastening/neckline/sleeve/care rows →
   `section:attribute:value` product_detail, feature bullets → product_highlight, size-guide /
   care / ingredients / PDF links → document_link). Every value carries `src` + the `ev` line it
   came from. **Identifiers are variant facts:** gtin/mpn/size come only from the variant that
   IS the feed row (sku/mpn/gtin match or the `?variant=` id in the link) or from a single-SKU
   page — a page-level barcode on a multi-variant page is another SKU's (YuMOVE's 30-bite
   barcode would have landed on the 90-bite row). A retailer SKU is accepted as MPN only for
   own-brand products (Monsoon sells Monsoon; Stromberg at American Golf is not). Recommendation
   blocks are a **signal** for related_product, never a value.
4. Optional AI pass: `llmPrompt` batches five products' details excerpts (≤3.5k chars each) into
   one `/api/claude` call asking for strict JSON with a **verbatim evidence quote per attribute**;
   `mergeLlm` drops any value whose quote is not in the page text, enforces Google's vocabularies
   (gender / age_group / size_type / size_system), never takes identifiers, and never overrides a
   rule-found value.
5. `matrix(results)` — per attribute: blank in feed · found on PDP · rate · examples with source
   and evidence · signals apart; the page adds the **estimated Golden Record uplift** (the
   sample's recovery rate applied to the feed's blank share, re-scored with the brand's profile).
   Exits: **⬇ Supplemental CSV** (`id` + `g:` columns of the recovered values — a Merchant Center
   supplemental source or a FeedHero rule input), **→ Brief** (Workflow deep-link, cat technical,
   files "Golden Record PDP Recovery - <Brand> <MKT> - MMYY" via `plantask?attr=pdp`), **✉ Ask
   client** (the evidence-led proposal on the shared askdraft rails). The sample is stored per feed
   (`PUT /api/golden/pdp` → `goldenpdp:<c>:<m>`, ≤60 rows) and reopens from the scorecard chip.

**Estate truth (probe, 14 Sep 2026).** Server-fetchable: Accessorize, Monsoon, Superdry, YuMOVE,
American Golf (HTTP 200, 0.3–1.7 s). Blocked by bot walls: Reiss (Akamai), Schuh, Hobbycraft
(Cloudflare) — those need the client to allowlist the scanner; the page says so on an all-blocked
run. Phase 2 (not built): full-catalogue harvest on the GitHub Actions agent lane.

