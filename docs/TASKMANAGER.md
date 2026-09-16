# Task Manager integration — hours into the FCC, automatically (Sep 2026)

Ray's asks (16 Sep 2026): *"connect to FS's Task Manager (which has an hours report on every
task) and map it back into our system"* — and then, on how it should stay current: *"an automatic
scan or push … has to sync almost four to six times a day, right? If a brief is being sent from
FCC and users are logging hours, reporting to clients, then that sync must be automatic. I don't
need a manual push or manual pull."*

The source is the team's custom connector MCP **`feedspark-reports`** at
`mcp.dashboard.feedspark.com/mcp`. An HTML scrape of the PHP app was built first and dropped —
the MCP is first-class. The sync is the **worker's own cron**: no agent, no GitHub Action, no
Claude session anywhere in the loop.

## The source — what the MCP gives us

| Tool | Returns | Used for |
|---|---|---|
| `get_client_list` | one row per **client × market** from `sh_merchants`: `client_id` (the market's id), `client_name`, `group_name`, `country`, `primary_am`, `market_flag` (0 live · 2 FS-internal · 1 stopped), and the hours **already computed** — `allowance` (monthly retainer block), `used_hours` (this billing cycle), `balance` (remaining incl. carried), `balance_health` | the per-brand rollup (Leadership) + the market rotation |
| `get_task_list_for_client(client_id, from_date, limit)` | that market's tasks, newest first: `list_id`, `title`, `status`, `owner`, `created_on`, `time_taken` and a `raw` blob (~1.9KB) carrying `time_taken_nonbill`, `time_schedule`, `notes`, `done_id`, `onhold` / `withclient` / `test_running` flags | per-ticket hours + per-market task summaries |
| `get_tickets_for_client(ticket_client_id)` / `get_ticket_detail` | the email ticket queue | not yet |

Note the ELC group sits on `market_flag 1` (stopped) despite being worked weekly — `flag_scope
live` omits it. The fix is the flag in the TM, not a special case here.

## How the data reaches the FCC

```
 wrangler.toml [triggers] "15,45 * * * *"  ──▶  worker.js › scheduled() ──▶ tmPull(env)
                                                                              │
   tmMcp: JSON-RPC over POST (Streamable HTTP) ── Authorization: Bearer TM_MCP_TOKEN ──▶ mcp.dashboard.feedspark.com/mcp
      initialize → notifications/initialized → tools/call            (TM_MCP_AUTH names another header; TM_MCP_URL overrides)
                                                                              │
   1. get_client_list ──▶ tmparse.js › aggregateClientList ──▶ tmStore ──▶ KV tm:<client> + tmidx   (written only when a figure moved)
   2. planPulls: 4 markets on the rotation ──▶ get_task_list_for_client ──▶ summariseTasks
         ──▶ KV tmtasks:<client>  {markets:{GB:{hours, byRef, byOwner, months, recent}}}
         ──▶ KV tmhours           {<brief id>: {h, nb, sc, n, dn, st, o, tasks[], client, market}}   via the [ibfref:] token
   3. KV tmstatus  {state, at, ok_at, fails, error, auth, url, clients, markets, tasks, refs, pulled, rot}
                                                                              │
   GET /api/tm (rollup + status) · ?client= (record + task book) · ?hours=1 (ticket hours) · ?pull=1 (owner: sync now)
                                                                              │
   Leadership › Hours & commercial  ◀── block ← allowance · Used ← used_hours · balance · source line · ⟳ Sync now
   Workflow › every ticket card     ◀── ⏱ hours logged against THIS ticket · modal breakdown
```

### Why pull from the worker

- The worker already runs crons; a fourth trigger costs nothing and gets **its own subrequest
  budget** (the :00 / :30 firings are already near the cap with the guard sweeps).
- MCP over HTTP is plain JSON-RPC — the worker speaks it natively. The response may be JSON or an
  SSE frame; `parseRpc` reads both.
- The data lands in the same KV records the push lane writes, so `/api/tm` flips from `none` to
  `live` on the first pull and the pages read it unchanged.
- **No client hours live in git.** The first cut committed a snapshot of the client list and a
  baked seed so Leadership had figures before any live lane existed; with the pull automatic that
  is dead weight — and it is exactly the per-client commercial data the push classifier flagged
  on its way to GitHub. Both are gone. Before the first sync the book is empty and the pages say
  so; one `⟳ Sync now` (or the next :15 / :45) fills it.

### Cadence and cost

Every 30 minutes (:15 and :45). One firing = initialize + one client list + **4** task lists
(`TM_TASK_PULLS`, 21-day window, 200-row cap) + a handful of KV reads, and KV **writes only when
something moved** (`sigOf` change detection on every brand record, `mergeHours` on every ref).
With ~30 worked markets each is re-read every ~4h; a market whose brand has a brief in flight
scores ×2 and is read twice as often; a never-read market always leads, so nothing starves.
`?pull=1&pulls=8` on demand goes deeper.

### The credential

`TM_MCP_TOKEN` is a Worker **secret** (Ray set it in the Cloudflare dashboard, 16 Sep 2026). The
endpoint answers `401 Unauthorized` with no OAuth discovery and no `WWW-Authenticate` — a custom
check — so the header it reads must match: default `Authorization: Bearer <token>`; if the team's
server reads something else, set the plain var `TM_MCP_AUTH` to the header name (e.g.
`X-API-Key`), or `raw` when the secret already carries its scheme. A secret pasted WITH its scheme
(`Bearer abc…`, `Token abc…`) is sent as-is, never `Bearer Bearer …`. `TM_MCP_URL` overrides the
endpoint — including a query-string token (`…/mcp?token=…`) if that is what the server reads; store
it as a secret then. None of these needs a redeploy. Not an IP allowlist — worker egress IPs are
not pinnable.

**Reading the 401 (first live pull, 16 Sep 2026: "sync REFUSED … unauthorized (HTTP 401)"):** the
server rejects the credential as sent, and from outside nothing says why — no `WWW-Authenticate`,
no CORS header list, no OAuth metadata, the root redirects to `login.php`. Four causes, one
question to the team: *which header/scheme (or query param) does `/mcp` check for a machine
caller, is the token issued for that, and is there an IP allowlist?* Then: header name →
`TM_MCP_AUTH`; scheme → the full value in `TM_MCP_TOKEN`; query param → `TM_MCP_URL` secret; IP
allowlist → the team switches the FCC to token auth. ⟳ Sync now re-tests each change instantly.

### Task → ticket: the ibfref token

The Workflow composer writes `[ibfcode:<client>-<mkt>] ibfdue:DDMMYYYY [ibfref:<brief id>]` into
every `[FS Brief]` subject, and the team's TM tasks keep it — in the **title** (the brief filed as
a task), in the **notes** (a "Batch Setup - Keyword Optimisation" task quoting the brief), or both.
`ibfrefOf` reads title first, then notes; the hours of every task carrying the ref are **summed
onto that one ticket** (billable `time_taken`, `time_taken_nonbill`, `time_schedule`), owners
joined, done count kept, state = the least-finished task (done → test running → with client → on
hold → open). **Exact token only** — a task without it is the brand's own work and never lands on
a ticket. A re-read of the market replaces the ref's record; a ref the 21-day window rolled past
keeps its last value (its hours are final).

Real specimen (Reiss GB, 16 Sep 2026): `REIS-20260910-02` (Cashmere/Merino) = Steven's 0.5h +
0.25h non-bill filing task **and** Vitus's 4h + 3.75h non-bill batch set-up whose notes quote the
brief → the ticket reads **4.5h billable · 4h non-billable · 2 tasks · done**.

## The mapping — brand grain

Leadership works in one block + one used figure **per brand**; the TM reports per market (Reiss
has 21 live). `src/tmparse.js › aggregateClientList` rolls the markets up: sums of allowance /
used / balance / current / carried, the **worst** market's health as the brand's, markets ordered
by hours used, live markets only by default. `brandKey` folds `YuMove` / `YuMOVE`.

## What the pages show

**Leadership › Hours & commercial** — `block ← allowance`, `Used ← used_hours`, each with a **TM**
chip; a figure set by hand always wins and an edit clears the flag; balance readout (red when
negative). The **source line tells the truth**:

| State | Line |
|---|---|
| `ok` | *Task Manager — block + used hours on 9 clients · **LIVE** from the reports MCP, synced 12 min ago · 52 markets · ticket hours on 7 briefs* |
| `no_token` | *… automatic sync is waiting for the TM_MCP_TOKEN secret — no synced figures yet* |
| never run | *Task Manager — no synced hours yet (the figures shown are the hand-set defaults) — the automatic sync runs at :15 and :45* |
| `unauthorized` | *… sync REFUSED by the reports MCP (unauthorized (HTTP 401)) — check TM_MCP_TOKEN, or set TM_MCP_AUTH to the header it expects (sending Authorization) — showing …* |
| `unreachable` / `error` | *… sync unreachable since 3h ago (6 failed pulls: HTTP 503) — showing the last good sync, 4h ago* |

plus **⟳ Sync now** (the owner-only `?pull=1`), so nobody waits for :15 / :45.

**Workflow** — every ticket card wears **⏱ 4.5h** (tooltip: billable · non-billable · scheduled ·
tasks · owners); the modal gets a TM pill and a **Hours logged in the Task Manager** section
(date · task · owner · state · hours), read from `/api/tm?hours=1` at boot, every 5 min and on
tab-visible. Scoped like the board: a client-scoped signin sees only their clients' refs.

## The other lane

- **Push** — `POST /api/gmail/push {tmpush:[…]}` (same key + Access bypass as the XML scan) for an
  external producer such as the team's own server. It writes through the same `tmStore` as the
  pull, so the two can never disagree about where a figure lives.

## QA

`tools/test_tmmcp.mjs` (node, in qa_gate / presync / validate.yml): the pure module (JSON + SSE
parsing, auth modes, rotation, the ibfref sums on the real specimen shape), then **`tmMcp` /
`tmStore` / `tmPull` lifted out of worker.js by name** and run against an in-process stub MCP
server with a fake KV — no token, refused token (fails up, last good sync kept), the real pull
(handshake + session id, SSE + JSON results, store + index + task book + hours), a quiet re-pull
(no re-writes, rotation moves on), a 500 (unreachable), X-API-Key mode — and the cron / route /
page wiring. `tools/test_tm.mjs` still pins the rollup, the store, and that no client hours are
committed to git.

---

# The `/tasks` module — the same database, made searchable

> Ray, 16 Sep 2026: *"lets build a new module as FS Task Manager (to show all capabilities of this
> new feedspark-reports mcp please) — Allow more area where you can also create a search bar for
> each AM to work inside the pull‑in report via the MCP, and a quick pull‑out report—either a pie
> chart or any type of chart—based on the hours of billable versus non‑billable, where you reach
> inside this MCP."*

Everything above maps TM **hours** onto figures the FCC already shows — a block on Leadership, a
⏱ on a Workflow ticket. **`/tasks`** is the other half: the database itself, on one page, with a
query bar over it. Same MCP, same credential, same cron firing, its own rotation.

## All four reads have a home

| MCP read | Where it lands |
|---|---|
| `get_client_list` | **Accounts & hours balance** tab — every market, live and stopped, with its group, AMs, monthly allowance, hours used and balance. Row → drawer with that market's own hours in the window. |
| `get_task_list_for_client` | **Tasks** tab + the chart + every KPI — one row per booked task with its owner, day, status and its two hour columns. |
| `get_tickets_for_client` | **Client tickets** tab — the queue the hours lane had listed as *not yet*: subject, status, age, idle days, messages, tasks spawned, hours consumed. |
| `get_ticket_detail` | The ticket drawer — who raised the thread, when it opened, who replied last. |

## Its own rotation on the same firing

`tmPull` chases hours onto tickets inside a **21-day** window: four markets a firing, brands with
a brief in flight weighted twice. The module needs the opposite shape — **even coverage of twelve
months** across the whole book, so an AM can search it. So `tmBookPull` runs right after it on the
same `:15/:45` firing, sharing the same MCP session (one handshake, not two):

```
 tmBookPull  ─ get_client_list(flag_scope 'all')  → the roster + the Accounts tab
             ─ BOOK_MARKETS (2) × get_task_list_for_client(limit 1600)  → KV tmbook:<client>
             ─ BOOK_QUEUES  (1) × get_tickets_for_client(status 'all')  → KV tmtick:<client>
             ─ KV tmbookidx {clients, accounts, roster, queues, rot, qrot} · tmbookst {state, pulled}
```

**Stalest first, and a market never read always leads** — otherwise a market at the end of the
roster starves behind whichever ones the hot-brief rotation keeps choosing. ~39 worked markets at
2 a firing turns the whole book over roughly **twice a day**; the 12 ticket queues turn over in
about six hours. `GET /api/taskmanager?sync=N` (owner) reads N more markets now, and the page's
**⟳ Sync more** loops it until the estate is covered, so nobody waits for the cron on a fresh
deploy.

Only markets carrying a retainer block or booked hours this cycle are pulled: a stopped market
with neither has no work to find, and reading it would spend a pull a live market needs. It still
appears in the Accounts tab — the roster is kept whole.

## Nothing in git

Same rule the hours lane set: hours, task titles and client contact addresses are per-client
commercial data and live in **KV only**. `ops/reports/` is ignored wholesale, so a session that
pulls the MCP while working on the module cannot commit what it pulled by accident. The harness
asserts it.

The page is **served scoped**, not filtered in the browser: `/api/taskmanager` reads only the
client records the signin is allowed, so a client-scoped AM never receives another AM's rows at
all. The module is grantable per person (`taskmanager` in `access.js`'s `MODULES`).

## The search bar

One bar, filtering the tasks, the tickets, the chart, the breakdown strip and every KPI at once.
Bare words search the record; `field:value` narrows; `-` negates. Repeats of one field OR
together, different fields AND.

| | |
|---|---|
| `keyword optimisation` | both words appear somewhere on the row (title, notes, owner, client, market, status) |
| `"keyword optimisation"` | the exact phrase, not two loose words |
| `client:` `brand:` `account:` | the brand. Exactly, **or by prefix of 2+ characters** — `client:rei` finds Reiss, `client:eiss` finds nothing (a mid-word substring is not a name) |
| `owner:` `who:` `by:` | the person who did the work |
| `market:` `mkt:` `country:` | GB, DE, BE-NL … |
| `am:` | the account manager on the market |
| `cat:` `type:` | `opt` / `tech` / `feat` / `acct` / `other`, and their own words (`cat:optimisation`, `cat:fixes`) |
| `status:` | the database's own word (`done`, `created`) or the bucket (`open`, `hold`, `cancelled`) |
| `bill:yes` / `bill:no` | carries charged time / carries unbilled time |
| `from:` `to:` `month:` | `2026-04` or `2026-04-15`; `to:2026-06` covers the whole of June |
| `min:` `max:` | total hours on the row |
| `-call`, `-client:Schuh` | exclude |

`/` focuses it, `?q=` deep-links a view, chips run the common ones, **＋ Save this view** keeps a
query per device, and clicking a breakdown row toggles that filter in.

**`bill:yes` and `bill:no` are not opposites.** Most of the book is part charged and part not, and
such a row answers to *both*, because both are true of it. Reading `bill:no` as "nothing was
billed" would hide the majority of the very thing the module exists to show.

## The chart

The series is always **billable vs non-billable**; the axis is whatever you split by — everything
(a donut), client, who did it, type of work, month, market, AM, status, task — in four forms
(donut, stacked columns, 100% stacked, horizontal bars). It reads the **current search result**,
so it is never a different population from the table under it, and it states its conclusion in
words rather than leaving the reader to do the division.

**Pull-out exits:** `⬇ PNG` (2000px, footer-stamped with the window and the query), `⎘ Copy table`
(TSV), `⬇ CSV of these rows` (every matching task with both hour columns and its notes),
`🔗 Copy link`.

Colours are the validated pairs: billable `#2563EB` / non-billable `#ED6F0B` on light,
`#4C82E0` / `#C67B28` on dark — the pair the Product Volume module uses, so billable is the same
blue everywhere. Type-of-work dots reuse the retainer donut's palette, and the categories come
from `tools/reporthours.mjs`, so this module and the brand one-pager can never disagree about
what a task was.

## Two traps in the source, handled in the sync

- **`from_date` is not applied.** Verified 16 Sep 2026: a task list asked for `2026-07-01` came
  back with February rows; a ticket pull asked for `2026-08-01` returned 2024 threads. The window
  is applied in `packMarket` / `packQueue` and nowhere else.
- **Pulls are newest-first and capped.** A market whose deepest row starts *after* the window
  opens did not reach back far enough, and reading that as a whole year would overstate every
  total. It is stored `full: false`, shown as **partial** in the coverage drawer, and contributes
  the rows it does have.

`0000-00-00` is **undated**: counted in the totals, in no month, and the page says so. Tickets are
windowed by **last activity**, the same twelve months as the tasks, for every client alike. And
what has not been read yet is **absent, not zero** — the source line says how many markets the
book holds and how stale the oldest read is.

## Files

| File | Role |
|---|---|
| `cloudflare/feedspark-deck/src/taskbook.js` | pure: the grammar (`parseQuery`, `matchTask`, `matchTicket`), the aggregation (`summarise`, `groupBy`, `ticketStats`), and the book store (`bookWindow`, `packMarket`, `packQueue`, `bookPlan`, `queuePlan`, `rosterOf`, `assembleBook`, `bookHealth`) |
| `worker.js › tmBookPull` | the I/O: one firing's pulls into KV, on the shared MCP session |
| `worker.js › GET /api/taskmanager` | the scoped read, and `?sync=N` for the owner |
| `docs/FeedSpark_TaskManager.html` | the page |
| `tools/test_reporttasks.mjs` | 296 assertions |

**Page / engine parity.** A page cannot import the module, so it carries a behavioural twin of the
grammar between `/* ENGINE:START */` and `/* ENGINE:END */`. The harness lifts that block out by
name and runs the **same assertion table** against both, plus a term-by-term comparison over
fifteen query shapes. It then lifts **`tmBookPull` out of `worker.js` by name** and runs it
against an in-process stub MCP with a fake KV — no credential, a refused credential, the real
pull, the rotation moving on rather than re-reading, a partial pull refused as a full year, and an
unreachable endpoint that fails up rather than writing a half-built index. In qa_gate, presync and
`validate.yml`.

---

# The hours badge — the balance everywhere in the FCC (Sep 2026)

> Ray, 16 Sep 2026: *"In terms of display, this hour report should appear everywhere in Watcher,
> for example with workflow, and flag whether the client is negative or not. It should also show
> the trajectory of the past three months of client activity per hour. It would be like a hovering
> pop-up, so it doesn't clutter the current dashboard. At the same time, display it within
> brand[ dossier] and other areas in the F[C]C that are appropriate for an AM to decide whether to
> continue the task with the current hours. Obviously, there are cases where a client is negative,
> but because of relationship smoothing, the AM may still continue the task. Consider that
> perspective as well."*

The two lanes above put hours **on a figure** (Leadership) and **in a database** (`/tasks`). This
third one puts them **at the moment of the decision** — beside the ticket an AM is about to move,
the brand they are about to plan, the row they are about to brief.

## An 8px dot and one popover

`docs/hours_widget.html` is injected by the worker onto every app page, next to the editor,
presence, Feed Chat and phone layers. It renders:

- **a dot** on any element carrying `data-hrs="<client>"`, coloured by state;
- **one popover**, shared by every dot on the page, opened on hover (120 ms in / 260 ms out) or
  pinned by click, closed on Esc or an outside click, and a bottom sheet under 760px.

Nothing is added to the page's own layout — the dot is the entire footprint. That is the "doesn't
clutter the current dashboard" constraint taken literally.

**Automatic coverage.** Any module page that picks a brand from its own `<select id="brand">` gets
a badge beside the selector that follows the selection, with no change to that page: KWCal, Feed
Lab, Volume, Overlays, Schedule and AI Quote are all covered that way.

**The exception rule.** `data-hrs-flag` narrows a dot to the states worth stopping at — `tight`,
`over`, `served`, `held`. A long table repeats one client down hundreds of rows, and a healthy dot
on every one of them is decoration. The Workflow intake table and the Task Manager accounts table
use it; everywhere a client appears once uses a plain `data-hrs`.

## Six states, and why `over` is not the last word

| State | When | |
|---|---|---|
| `none` | never synced | says so — an unread client is **not** zero hours |
| `ok` | inside the block | |
| `tight` | under a quarter of the block left | the next task will likely take it under |
| `over` | negative, no decision recorded | |
| `served` | negative, **and the team chose to continue** | Ray's case |
| `held` | negative, and new work is on hold | |

**Relationship smoothing is a first-class state, not a footnote.** The balance is a fact the
reports database states; the posture is the team's decision about it, and the two are stored and
displayed apart. Without `served`, a deliberate call to carry an account through a renewal would
render as an unhandled red alarm on every page in the FCC, and AMs would learn to ignore the dot.
The popover therefore never says *stop*: it states the balance, states the decision, and leaves the
call where it belongs. Where a posture is set, an optional one-line **why** travels with it — the
judgement is the part the next person needs; the state alone only says somebody clicked a button.

The posture lives in the shared-state namespace `hourspost` (`/api/state`, `kvmerge`,
`X-Sync-Base`, client-scoped like every other Workflow route), so one AM's call is the team's call.

## The three-month trail

`tmBookPull` already reads each client's task rows; `TB.trailOf` folds them into a compact
`tmtrail` record (three months × `[billableQ, nonbillableQ, n]` quarter-hour integers) on the same
firing, and `GET /api/hours` serves it merged with the balance and the posture. The popover draws
three stacked bars — billable below, non-billable above, 2px surface gap, direct value labels,
legend carrying both numbers (which is also the relief the palette validator requires on the
light-mode orange). Palette: `#2563EB`/`#ED6F0B` light, `#4C82E0`/`#C67B28` dark — both validated.

Three honesty rules are baked into the maths, because this number is read at the moment someone
decides whether to keep working an account:

1. **The current month is partial.** It is hatched and labelled, never plotted as a finished month
   — otherwise every account looks like it fell off a cliff on the 3rd.
2. **A partly-read book is a floor, not a total.** `read`/`total` travel with the numbers, so the
   popover says "4 of 6 markets read" rather than implying the whole account.
3. **Billable and non-billable never merge**, here as everywhere else in this integration.

The trend line refuses to call a direction on fewer than two *complete* months, and treats a move
under 8% as flat.

## Where it appears

| Surface | Anchor |
|---|---|
| Workflow — every ticket card | the client chip row, always |
| Workflow — the ticket modal | the id · client · code line |
| Workflow — the intake table | the client cell, **exception only** |
| Workflow — active client-filter chips | always |
| Command Center — brand dossier | the brand name, **plus an Hours card in the portfolio band** |
| Leadership — Hours & commercial | each brand card's name |
| Playbook — the brand header | always |
| `/tasks` — accounts table | the client cell, **exception only** |
| `/tasks` — "Hours by client" | each bar's name |
| KWCal · Feed Lab · Volume · Overlays · Schedule · AI Quote | automatic, beside `select#brand` |

Client decks and the embedded Feed Chat frame are skipped — the first because this is internal
commercial data, the second because a popover inside a small iframe would be clipped.

## No client hours in git

Unchanged from the lanes above. `hours_widget.html` bakes no figures and names no clients; its only
source is `GET /api/hours`, which reads KV and is scoped per signin. `tools/test_hoursbadge.mjs`
asserts both.

## QA

`tools/test_hoursbadge.mjs` (qa_gate, presync, `validate.yml`) pins the trail maths, the posture
states, the trend's refusals, the wiring, and — because the widget cannot import the module — lifts
its hand-written engine twin out by name at `/* FCC-HOURS:ENGINE-END */` and runs it against the
**same assertion table** as `src/taskbook.js`. `tools/check_mobile.js` renders the widget with every
other injected layer at 390px.
