# Scheduled Work — the ASPL weekly schedule as a skip cadence

Ray, 15 Sep 2026: *"Scheduled Work vs. Workflow work (PT = product type, KWs = keywords, Titles =
Titles Optimisation) … each week will be dated in hidden sheets … I want, when accessing this old
document, to keep track of the clients that are in my brand dossier, see the cadence of which
column P 'AM status' indicated a skip, track how many consecutive months the task was skipped for
my clients, and showcase that using the new module called Schedule Work or fit that nicely under
Intake."*

Page: **`/schedule`** (module nav, grantable as `schedule`). Hand-off band under Intake in
`/workflow`. API: **`GET /api/schedule`** (`?lite=1`, `?refresh=1`).

## The source

One Google Sheet owned by the content team — *Scheduled Title and Keyword Optimisation*
(`16yYMQ50__qv-9V-mtIebm8Ih0-2huE452bgRz3f70Tw`). Every week the ASPL team lists each
client × market × task with the hours left in the client's bucket; the AM answers **Go ahead** or
**Skip**. None of this ever enters Intake (project plans, calls, emails) — it is the other stream.

Two eras live in the workbook (77 tabs on 15 Sep 2026):

| era | tabs | week lives in | AM's call | outcome |
|---|---|---|---|---|
| consolidated (visible) | `Content-team-task-summary` — one row per client × task × week since 26 Jun 2025 | column `Dates` | **`AM Status`** (column P) | `Reason` for go-aheads on negative hours |
| weekly (76 hidden) | `KWs 1906`, `Titles 0201`, `PTs 1206` … back to `Kws 1411` (14 Nov 2024); `Keywords` / `Titles` undated | **the tab name only** — DDMM, no year | `AM Confirmation` | `Final Status` (Approved / Cancelled) |

The hidden tabs were the question ("let me know if you could access that"): **yes.** The Drive
text export flattens every tab into one table and loses the names, but the xlsx export keeps names
and hidden flags, and the Sheets API (service account) returns hidden tabs like any other.

## Reading it — `src/schedwork.js` (pure; harness `tools/test_schedule.mjs`)

- **Columns by name, never position.** Twenty header layouts across the weekly tabs. `resolveHeader`
  finds the row carrying `Client`/`Clients` and maps Task Name / Task Type / Time schedule / Time /
  Days left / Batch size / Dates / AM Status / AM Confirmation / Final Status / Reason / the comment
  columns (ASPL Comments, Zoe/Xiaoli Comment, AM Comment).
- **Week.** `Dates` cell (ISO, DD/MM/YYYY or a Sheets serial) on the consolidated tab; for a weekly
  tab, DDMM from its name dated as the most recent such date **on or before the anchor** — the
  consolidated tab's first week (26 Jun 2025) — so `Titles 2606` is that same week and `Kws 1411` is
  Nov 2024. Undated tabs parse (log only) and never enter the cadence.
- **The AM's word.** Precedence `AM Status` → `AM Confirmation` → `Final Status` (the ASPL outcome
  only stands in when both AM columns are blank). *Skip / Cancelled / No / Not for this week /
  Ignore / "we can skip (BF batch separately)"* → **skip**; *Go ahead / go head / Yes / OK /
  Approved / please go ahead* → **go**; a bracketed note ("(no confirmation but no hrs - xiaoli)")
  is not a decision.
- **Task kind** off the task name: Keywords · Titles (incl. "Data field and title") · Product Type
  (incl. "PT Fixes") · Data tagging · Social titles · Short titles; the weekly tab prefix is the
  fallback.
- **Reason class** off the explicit `Reason` (outranks) or the hours comment: negative hours · low
  hours · seasonal batch instead · client-defined batch · migration · account paused · cross/upsell
  · performance issues · risk mitigation · relationship concerns.
- **Brand.** `"Reiss - DE"`, `"Accessorize - GB (Mon)"`, `"Harvey Nichols - GB - EN"`,
  `"[merged] Benefit Cosmetics - GB"` → name + market (+ group, merged flag). Matched to the FCC
  roster (brand dossier KV ∪ `PLAN_SHEETS` ∪ `DEFAULT_FEEDS`) with accents/case/spacing ignored
  and a first-word rule (Benefit Cosmetics → Benefit, MAC Cosmetics → MAC, Ryobi Tools → Ryobi).
  Unmatched names stay **sheet-only** clients behind the *whole sheet* toggle — never guessed.

### The cadence (`buildCadence`)

Per brand × market × kind:

- **A skipped month** = the task was scheduled that month and the AM never said Go (every
  scheduled week was a skip, or Cancelled with no AM word).
- **A month with no row** is *not scheduled* — neither a skip nor a break in the streak (4-weekly
  cadences miss calendar months; that must not reset the count).
- **Streak** = trailing *decided* months that were skipped, counted back from the latest one, ended
  by the first month that went ahead; undecided months are passed over. Also: streak in weeks,
  `since`, `hoursSkipped` (the "4 hours" of every skipped week inside the streak — scheduled work the
  retainer did not take), last go-ahead, skip rate (skips ÷ decided), latest week + reason.
- **Brand summary** = worst streak, tasks on a streak, hours skipped, markets, last decided month.
  A brand or task whose last decided month is more than two months before the sheet's latest month
  is *dropped from the schedule* (hidden unless *show dropped* is ticked).

Real reading on 15 Sep 2026 (snapshot): 2,666 scheduled rows over 98 weeks; the worst dossier
streaks were Reiss EU Keywords (14 months, since Aug 2025), Superdry GB Keywords (13), Reiss NL
Keywords (12), Superdry GB Titles (12), Estée Lauder GB Titles (10), Schuh GB Social titles (10).

## Live vs snapshot

`/api/schedule` reads the sheet **live through the service account** when the sheet is shared
with it (one metadata call + `values:batchGet` of every tab, `UNFORMATTED_VALUE` so dates arrive as
serials; cached in KV `schedwork` for 6 h; `?refresh=1` re-reads; a failed refresh serves the last
good read as *live-stale*). Until it is shared, the **committed snapshot** is served and the page
says so, naming the service-account email to share with (Viewer is enough — nothing here writes).

Rebuild the snapshot from an xlsx export of the sheet (File → Download → Microsoft Excel keeps
tab names + hidden flags):

```bash
pip install openpyxl
python3 tools/schedule_ingest.py "~/Downloads/Scheduled Title and Keyword Optimisation.xlsx" ops/schedule/scheduled_work_$(date +%F).json
# then point the worker import at the new file and run node tools/test_schedule.mjs
```

Rows are **scoped per signin** like every Workflow route (`clientMatch`): a scoped AM sees only their
clients' cadence; sheet-only clients belong to the full-house views.

## Where it shows

- **`/schedule`** — source line · KPIs (brands on the schedule vs the dossier, tasks on a streak,
  longest current streak, latest week skip·go, hours of scheduled work skipped in 90 days) · brand
  cards · the cadence table (12-month strip per task, streak, since, last go-ahead, skip rate, hours,
  latest week + reason) · row → drawer with every week on record (the AM's verbatim word, the ASPL
  outcome, hours, hours left in the bucket, days to renewal, comment). Filters: brand (dossier
  first), task kind chips, market, minimum streak, search, *whole sheet*, *show dropped*. Deep link
  `?b=<Brand>&k=<kind>&min=<n>`.
- **`/workflow`, under Intake** — the *⏭ Scheduled work* band: how many dossier brands have a
  scheduled task skipped this month, one chip per brand with its worst streak, each a link into
  `/schedule?b=`. Read-only; the pipeline never files these.
