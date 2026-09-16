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
`X-API-Key`), or `raw` when the secret already carries its scheme. `TM_MCP_URL` overrides the
endpoint. None of these needs a redeploy. Not an IP allowlist — worker egress IPs are not pinnable.

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
