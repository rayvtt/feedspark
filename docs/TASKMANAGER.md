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

## Tags — why the work happened

> Ray, 17 Sep 2026: *"within the task manager hours, there will be a tagging system, a labeling
> system of which task is urgent, which task is from agency work, and which task is technical …
> the goal is to highlight how many hours are spent on urgent stuff that should have been spent on
> optimisation. Later on, I will do mass tagging across all rows if possible or by either keyword
> or using Excel that I can import and export."*

**This is a second axis, and keeping it apart from `cat` is the whole point.** The **Type** column
is read off the title and says *what the work was* — optimisation, a technical fix, set-up, account
admin. A **tag** is a person's judgement about *why it happened*. They are independent: an urgent
job is usually still useful work, which is exactly why the displacement never shows up in `cat`
alone and needs its own column.

**Nothing here duplicates a field the database already has.** Checked first, against Reiss GB over
1,200 rows: `priority` is the constant `20` on every row and `task_source` is empty. The reports
database does not record urgency, so the judgement has to come from a person.

**Tags key on the task's own `list_id`** (100% populated and unique in the live book), never on its
wording. The rotation re-reads each market about twice a day and re-packs every row from scratch, so
a tag keyed on a title would come unstuck the first time anyone edited one. A row that arrives
without an id reads **`no id`** rather than being keyed on something that drifts.

### The headline

*Where the hours went* sits above the chart and reads the **current search**, so narrowing to a
client or a quarter re-asks the question of that slice:

| | |
|---|---|
| **Urgent** | hours carrying any tag flagged *displaces the plan* |
| **Optimisation** | hours whose *work* classified as optimisation (`cat:opt`) |
| **Ratio** | reactive hours per hour of optimisation |
| **Judged** | how much of the book anyone has actually tagged |

**Coverage travels with every figure.** A book that is 4% tagged would otherwise report "2.1 h
urgent" and read like good news. Under 50% coverage the verdict says the number is a **floor, not
the answer**, and untagged is always stated as **not yet judged** — never as "not urgent".

### A human always beats a rule

Set a task's tags by hand and that record *is* the answer — **including an empty list**, which means
"I looked, and none of these apply". Without that rule a keyword rule would re-apply its tag on
every render and nobody could ever take one off; the tag they removed would quietly come back and
they would stop trusting the column.

**Clear** is therefore a separate control from unticking: it removes the record entirely and hands
the row back to the rules. Those are different intentions and the menu keeps them apart.

### Mass tagging

- **From the search.** The search already resolves a row set, so the bulk bar acts on **whatever is
  on screen** — there is no second selection model to drift out of step with the filter. It states
  the row count and the hours before doing anything.
- **By keyword.** A rule is a plain substring over the title, the notes, or both — *never* a regex
  typed into the page, since an AM entering `(` would throw inside the render loop and blank the
  table. Every rule previews what it would tag **and how many rows it will leave alone** because a
  person already decided them. The dialog also lists the book's own highest-hour task titles, so a
  rule comes off real vocabulary rather than a guess.
- **By spreadsheet.** See below.

### One task, several tags

A job can be both urgent and technical, and forcing a primary tag would drop the second fact the
person recorded. So the `tag` chart dimension is **multi-valued**: a task lands in every one of its
buckets, untagged gets its own bucket, and `groupBy` returns `multi`/`placements` so the surface can
say the hours legitimately sum to more than the book. Silently double-counted hours under a heading
that reads "hours" is the kind of number someone takes into a client conversation.

### The Excel round trip

The export already carried **Task id**; it now carries **Tags** too, and the import keys on the id —
never the title, which whoever edits the sheet may well reword.

`⇧ Import tags` reads **.xlsx** (the engine gained a reader: ZIP central directory, `deflate-raw`
via `DecompressionStream`, shared and inline strings) or **.csv** (quoted commas, doubled quotes,
CRLF, and a header row sitting below a title row).

**It previews before it writes.** A sheet coming back from someone's laptop can hold a stale copy of
the book, a filtered subset, or a column of typos, and applying it blind would overwrite the team's
judgements with no way back. The diff is shown — what changes, which task ids are not in this book,
which tag names do not exist here — and nothing is saved until it is confirmed. **Rows the file does
not mention are never touched**, so importing a filtered sheet cannot wipe the rest of the book.

### Where tags live

Shared state, like every other team-visible decision: `tmtags` (`taskId → {client, tags, by, at}`,
`field`-scoped so a client-scoped signin stays inside their own clients) and the house-wide
`tmtagdef` (the vocabulary and the rules), over `/api/state` with kvmerge, `X-Sync-Base` and a
retrying push. A displacement figure that differed from screen to screen would be worse than none.

## The search bar

One bar, filtering the tasks, the tickets, the chart, the breakdown strip and every KPI at once.
Bare words search the record; `field:value` narrows; `-` negates. Repeats of one field OR
together, different fields AND. **A space means AND, a comma means OR.**

| | |
|---|---|
| `keyword optimisation` | both words appear somewhere on the row (title, notes, owner, client, market, status) |
| `Febin,Vitus` | **either** — every row naming one of them |
| `tag:` `label:` | the judgement tag — `tag:urgent,agency`, `tag:none` (nobody has judged it), `tag:any` |
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

### A comma is OR, a space is AND

> Ray, 16 Sep 2026: *"This search bar allows multiple filters separated by commas. For example, I
> want to filter Febin and Vitus. The search bar should accommodate `Febin,Vitus` with no space
> after the comma."*

Two names side by side already meant *rows naming **both***, which is the right default and has not
changed. A **list** is the other question — *either of these people* — and there was no way to ask
it. `Febin,Vitus` asks it.

Four decisions inside that, each one a way it could have been annoying instead of useful:

- **The comma binds across a space.** `Febin, Vitus` is the same list as `Febin,Vitus`. Half of us
  type the space out of habit, and silently reading that as AND would answer *"no rows"* to a query
  that plainly means two people — the worst possible failure, because it looks like an empty result
  rather than a misunderstanding.
- **A trailing comma is not a term yet.** `Febin,` — someone mid-typing — is just `Febin`, never a
  filter that matches nothing.
- **A lone `,` filters nothing**, rather than filtering everything out. The row count chip and the
  footer label key on the *parsed terms*, not the raw box, so the page never says
  *"45 of 45 matching ,"* — claiming a filter that is not narrowing anything.
- **Inside `"quotes"` a comma is punctuation.** A quoted phrase is one literal, commas and all —
  that is what quoting means. It rides through tokenisation on a sentinel character and comes back
  out as a comma.

On a **field** the comma is simply the shorthand for repeating it: `owner:Febin,Vitus` is exactly
`owner:Febin owner:Vitus`, and each alternative goes through the category alias map
(`cat:technical,feature` → `tech`, `feat`) rather than just the first. The **range and bound**
fields — `from:` `to:` `min:` `max:` — and the two-state `bill:` keep their existing repeat
behaviour instead of inventing an alternation nobody means: an "either 2 or 5 hours minimum" is not
a question an AM asks.

**One definition serves both boxes.** The plain-substring pane filter under the tab header reads the
engine's own `orTerms`, so a comma cannot mean one thing there and another in the grammar bar above
it — the same rule that keeps the two surfaces from naming one task two ways.

**`bill:yes` and `bill:no` are not opposites.** Most of the book is part charged and part not, and
such a row answers to *both*, because both are true of it. Reading `bill:no` as "nothing was
billed" would hide the majority of the very thing the module exists to show.

## The chart

The axis is whatever you split by — everything, client, who did it, type of work, month, market,
AM, status, task, tag — and it reads the **current search result**, so it is never a different
population from the table under it, and it states its conclusion in words rather than leaving the
reader to do the division.

### Seven forms, each offered only where it tells the truth

> Ray, 17 Sep 2026: *"Can you allow more different types of charts? I like pie charts, donut
> charts, and line charts. What I want to see is merge the lines together and dissect them more
> easily side by side."*

| Form | Reads | Offered on |
|---|---|---|
| Stacked columns · 100% · Horizontal bars | billable vs non-billable per group | any split |
| **Donut** | on *Everything*, the billable share; on a split, each group's share of the hours | any split |
| **Pie** | share of the hours, biggest first from twelve o'clock, tail folded to `Other` | a split |
| **Line over months** | every series on ONE set of axes — "merge the lines together" | any split |
| **Side by side** | small multiples: one donut per group, compared at a glance | a split, or a nested one |
| Nested breakdown | the indented AdWords reading | a nested split |

The selector is **rebuilt** from what the current split can carry rather than greyed out over a
stale label, so no form ever names something other than what is on screen.

**The line** needs an ordered x, and month is the only ordered dimension in this book — so it
always reads months across the bottom and puts the split in the series. Undated rows are **not
plotted** and the verdict says how many; a month a series missed is drawn as a **zero, not a
gap**, or two lines with different gaps would read as the same shape at different speeds. There is
**one y-axis**, never two. Its table and its CSV are the **cross-tab it was drawn from**, not the
split's totals.

**Side by side** ranks the children **once across the whole tree** and every ring reads that map,
so a client is the same colour in every donut — colouring each ring by position would make Reiss
blue in one and Superdry blue in the next, which is the one thing a side-by-side comparison must
not do.

**Colour:** bars, columns and the total donut keep the rule that colour means billable vs
non-billable. Pie, line and the nested comparison colour by **identity** — there is no other way
to tell two lines apart — so the legend names the encoding, the swatches move to the categories,
and the two figures stay as plain rows. The two numbers still never merge; only the encoding
changes, and every hover keeps the billable split in words.

### One colour per thing, everywhere

> Ray, 17 Sep 2026: *"Make sure legend colors are consistent across sections of the task
> manager—for example, urgent in green versus urgent in red—and allow an option to show the legend
> directly on the chart as well, so I don't have to do side by side. Anything untagged could be a
> dotted line, dimmed and slightly more hidden."*

`keyColour(dim, key, rank, fold)` decides every mark, and **rank is the last resort**:

| The thing | Its colour | Where it already had one |
|---|---|---|
| A **tag** | the colour its vocabulary gives it | the *Where the hours went* bar and legend |
| A **type of work** | `--c-opt … --c-other` | the Type chip on every table row |
| A client, owner, market | the validated categorical set, by rank | nowhere — it has no colour of its own |
| A **fold** | one grey | a remainder is not a category |

A tag also reads as its **name**, not its slug ("Urgent", not `urgent`), because a chart under a
card saying "Urgent" is the same inconsistency in words that the rank palette was in colour.

**Untagged is drawn as the gap it is** — never a hue: a dotted pattern on rings and slices, a
**dashed, dimmed line** on the time chart, a dotted swatch and a faded row in both legends. It
keeps its true size, because shrinking the part nobody has judged would be the dishonest kind of
hiding.

**Legend on chart** (toggle, default on, remembered per device) draws the key *inside* the SVG, so
the eye never travels to the rail — and so the **⬇ PNG carries it**, which it never did before: a
downloaded pie used to be a set of unnamed wedges. One list feeds both legends, so the rail and the
chart can never name the same colour differently; with the legend on the chart, the end-of-line
labels stand down (the same names twice is clutter) and when they are drawn, two lines finishing
together are pushed apart rather than printed on top of each other.

### Side by side, expanded

> Ray, 18 Sep 2026: *"when our side by side donut chart, clicking on any chart will expand it as
> the main chart on the screen and showcase the different split legend in animation pls"*

A grid of 40px rings answers *"which of these is different"*; it cannot answer *"what is IN this
one"*, because at that size the slices carry no labels and several are a pixel wide. **Clicking any
cell** promotes it to the whole stage at a size where every slice has its name, hours and share —
and the legend arrives as the ring draws, so the eye is led from the shape to the names instead of
hunting for them. `← All groups` or **Esc** returns.

- **The whole cell is the target**, not the ring: a 12px slice is not something a hand can hit, and
  the label under it is part of the thing being pointed at. The arcs keep their own hover tooltips.
- **The animation is a class on the wrapper, and every animated element also carries its final
  state as an ordinary SVG attribute.** `⬇ PNG` serialises the node away from the page's stylesheet
  where no keyframe can run — without that rule the export would rasterise frame zero, a ring
  hidden behind its own dash offset, and hand someone a blank donut. `prefers-reduced-motion` gets
  the finished figure, not a slower one.
- **Narrow cards get their own geometry** — ring above, legend across the full width beneath —
  because a 720-wide viewBox on a 360px screen halves every font and lands the legend at ~6px.
- **It is a view, not a preference.** The split, the form, the measure or the untagged rule drop
  it; the search deliberately does not (narrowing while reading one group is staying on that
  group), and a key that no longer exists falls back to the grid rather than erroring.

The expansion also surfaced a collision worth naming: a cell can carry both the engine's own
`Other (N more)` fold *and* the children that fell outside the shared colour key. Invisible in a
40px ring; unanswerable once every slice is labelled. The second is now **"Everything else here"**.

### One control scale

> Ray, 18 Sep 2026: *"the box and button in the task manager are not equal size, so it looks messy
> … when we improve any feature or develop a certain module, review the entire page UX/UI and
> ensure these elements are not outdated. It should stay consistent."*

Measured before the fix, this one page carried **ten distinct control heights** and three pill
styles differing only by a pixel of padding (`.btn.sm` 4⁄9, `.chip` 5⁄10, `.pq-x` 4⁄10). Nobody
chose those differences — they are what a page accumulates when each feature styles its own
control, and an eye reads them as mess long before it can name why.

Two roles, two sizes:

| Role | Height | What wears it |
|---|---|---|
| **Field** | 34px | `select`, text input, full-size `.btn` — something you open, type in or press |
| **Pill** | 30px | `.btn.sm`, `.chip`, `.pq-x` — a small toggle or an exit |

Height is set **explicitly**, not left to padding: padding + line-height + font-size lands on a
different total for every font size, which is precisely how ten heights happened. Legitimately
distinct components are exempt **by name** — `.tab` (a tab bar is its own component), `#q` (the
page's one hero field), the 34px icon buttons, and the small marks that are not controls at all
(`.fh-dot`, `.instr-tgl`, `.tg-add`), which the phone layer also exempts from its 36px tap-target
rule. Under 760px that rule wins, as it should.

**The tripwire keeps it that way.** `tools/check_mobile.js` already renders every app page at
1400px, so its desktop pass now also measures control geometry and fails when a page carries more
than the two sizes. It is enforced on the pages whose scale has been set (`SCALED` in that file —
add a page there in the PR that tidies it) and **reported** for the rest with each page's own
number, so the next module worked on has a target rather than a surprise failure about somebody
else's change. Today's map: Task Manager 2 · Workflow 5 · FeedChat / Label Guard / Pricer / Task
Library 3 · Golden Record / PT Guard / Schedule / Templates / Volume 1.

### Include, and what a percentage is a share of

> Ray, 18 Sep 2026, over a Type of work › Task chart: *"Allow percentage labels to be changed from
> numbers to percentages as well, and then percentage of which attributes. For example … I want to
> see how many out of 63.75 hours of keywords optimisation are accumulated to the total of billable
> optimisation work type"*, then *"then option to hide non-billable also from dissectment"*.

Those are **one feature**, because a percentage means nothing until you name its denominator — and
the denominator is exactly what the second ask changes. So there is one **measure**, and the label
is a share of that:

| Include | The marks are | A label reads |
|---|---|---|
| Billable + non-billable *(default)* | the stacked pair, as before | the row's **total** against a total |
| Billable only | the blue segment | the row's **billable** against a billable total |
| Non-billable only | the orange segment | the row's **non-billable** against a non-billable total |

**Labels**: `Hours` · `% of its parent` · `% of the whole chart` · `None`.

Ray's question is therefore two picks — **Include → Billable only**, **Labels → % of its parent** —
and Keyword optimisation reads **20.4%**: its 63.75 billable hours as a share of billable
Optimisation. `% of its parent` is offered only under a nested split (on a flat one it would mean
the whole view, which is already its own option); a pick that stops being offered falls back to
`% of the whole chart`, the same question one level up, never silently to hours.

Four rules keep it honest:

1. **The measure re-ranks — it is not a coat of paint.** `mOf` in `src/taskbook.js` decides which
   number sorts the rows and therefore which survive the cap. Paint over a series without
   re-ranking and a row with 40 h of it sits below one with 4 h that happened to carry more
   non-billable, and the fold keeps the wrong twelve. A chart ordered by a number it does not draw
   is worse than no ordering at all.
2. **Nothing is discarded.** Every node still carries `bill`, `nonbill` and `hours`, so the
   tooltips, the ⊞ table, the CSV and the legend all still state the split. The hidden series
   **keeps its legend row** — dimmed, marked *· hidden*, with its hours — because a figure that
   vanishes from the screen is a figure someone goes looking for.
3. **The basis is never left to be inferred.** It rides the card **subtitle** (*"billable hours
   only · labels show billable hours as a share of their parent"*) rather than the verdict, because
   the verdict collapses behind the card's ⓘ and a percentage whose meaning can be folded away is
   one someone will read wrong. The PNG footer stamps the same sentence; every hover keeps the raw
   hours.
4. **A nested child divides by the parent it actually hangs under**, keyed on its full path — never
   on a node name that can repeat elsewhere in the tree. Top-level rows divide by the view, so they
   sum to 100%, and each parent's children sum to 100% of it.

**100% stacked** leaves the form list while a series is hidden: that form *is* the billable split,
so with one series put away it would draw every column full and say nothing. Both picks are
remembered per device (`fcc-tm-meas`, `fcc-tm-lab`) and ride `🔗 Copy link` as `?meas=&lab=`, where
an explicit link beats the remembered preference.

### Hide Not yet tagged

> Ray, 17 Sep 2026: *"btw [Not yet tagged] can be excluded from showing when dissect by Tag"*

On a part-judged book the untagged bucket is usually the biggest thing on the chart, and it is the
one bucket that says nothing about the work — it says nobody has looked yet. It swamps the tags
either side of it and the split stops answering the question it was asked. **Hide Not yet tagged**
(tickbox, default on, remembered per device) takes those rows out, and appears **only when a tag is
one of the three split levels** — every other dimension puts a task in exactly one bucket and has no
untagged remainder, so on those the control is hidden rather than sitting there inert.

Three rules keep it from becoming a number that quietly went missing:

1. **The row leaves, not the bucket.** `chartPop()` filters the population once, and the chart, its
   legend, its table, the TSV, the CSV and the PNG all read it — so a nested parent still sums to
   its children, and the "N h in view" headline can never count hours that are not drawn.
2. **It is said out loud.** The verdict line always names what was left out — *"Not yet tagged is
   hidden: 57 rows (108 h) are not in this split"* — the PNG footer stamps *untagged rows not
   shown*, and the CSV filename gains `-tagged`. A search that has nothing but untagged rows says
   so, with the way back.
3. **The displacement card is untouched.** Coverage, and what has not been judged, is the question
   that card exists to answer; this toggle governs the chart below it and nothing else.

### Account type

**Split by → Account type** is the *other* type the database holds: `client_type` from the accounts
read, the shape of the engagement, as distinct from *Type of work* (what the job was, read off its
title). A task carries no such field, so it is joined on: the exact client × market first, then the
brand when only one type is on record for it, then an honest `(not set)` — never guessed from a
sibling market that disagrees.

**Pull-out exits:** `⬇ PNG` (2000px, footer-stamped with the window and the query), `⎘ Copy table`
(TSV), `⬇ CSV of these rows` (every matching task with both hour columns and its notes),
`🔗 Copy link`.

Colours are the validated pairs: billable `#2563EB` / non-billable `#ED6F0B` on light,
`#4C82E0` / `#C67B28` on dark — the pair the Product Volume module uses, so billable is the same
blue everywhere. The categorical set the identity forms use is the repo's validated eight in the
Deck Generator's order (`#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #4a3aa7 #e34948`, with
its own dark steps), so one rank means one colour across the FCC; a fold is grey, because a
remainder is not a category. Both sets pass the dataviz validator in both themes — the light set's
contrast warning is answered by the value labels, the legend and the ⊞ table. Type-of-work dots reuse the retainer donut's palette, and the categories come
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


---

## The card, read rather than shouted (Sep 2026)

> Ray, 16 Sep 2026: *"fix the highlight / bold maybe? streamlines ux/ui and not too much trailing
> buttons/texts please"*

Every element on the chart card was set at weight 800–900 — the title, the control labels, the
legend, the axis, the value labels, the breakdown rows. When everything is bold nothing leads, and
the eye has no entry point. The card now has **three levels**, with weight rather than size doing
the work:

| Level | What | Weight |
|---|---|---|
| The finding | value labels, legend totals, breakdown numbers | 800, full ink |
| The subject | series and group names | 600, `--ink-2` |
| The scaffolding | control labels, axis ticks, percentages, captions | 600–700, `--muted` |

**The trailing row is gone.** The four exits (PNG · Table · CSV · Link) moved into the card header,
right-aligned beside the title, as quiet ghost buttons — exits belong beside the thing they export,
not stacked under the verdict where they read as its conclusion. The verdict itself lost its filled
banner and two thirds of its words: the legend already prints the split and its percentage an inch
to the right, so the line now says only what nothing else does — how big the book in view is, and
what the split *means*.

**One vocabulary per screen.** `cols()` and `hbars()` printed the raw group key, so the axis read
`opt · acct · tech · feat` while the legend beside it read *Optimisation · Account & support ·
Technical fixes · Feature & set-up* — the same five groups, named two ways, on one card. A single
`dimLabel()` now feeds the axis, the tooltips, the legend, the table, the TSV and the PNG.

Two mark-spec corrections came with it: stacked segments gained the 2px surface gap (taken out of
the upper segment, so the bar's top — the value the axis is read against — does not move), and the
`% billable` column in the legend gained a caption, because it means *billable share within each
group* while the two rows above it mean *share of the total*, and unlabelled the two read as one.

## Excel downloads

> Ray, 16 Sep 2026: *"allows excel downloads on Tasks / Client tickets / Account & hours balance"*

A **⇩ Excel** button sits on the tab pane, so it always exports the tab you are looking at.

`docs/xlsx_engine.js` (`FeedXlsx`, served at `/xlsx/engine.js`) is a minimal XLSX **table** writer —
an .xlsx is a ZIP of XML parts, so there is no library. It is deliberately *not* the AI Quote's
writer: that one is a replica of Finance's own quote book (fixed columns A–O, their widths, a
drawing part, the wordmark). This one writes a table — arbitrary typed columns, a frozen filterable
header, as many sheets as you hand it — so any page with rows can download one.

Three rules, each a way a spreadsheet of commercial figures could otherwise mislead:

1. **It exports what is on screen** — the same filtered, sorted population the table under the
   button is showing, not the whole book and not the 200 rows the page happened to have painted.
2. **Billable and non-billable stay split**, with the total beside them, so a column sums to
   something true whichever one the reader drags into a pivot.
3. **The search travels with it.** A second sheet records the query, the window, how many markets
   had been read and how stale the oldest read was — these files get emailed on, and a figure cut
   from a partly-read book needs to say so wherever it lands.

**Types are the point.** A CSV hands Excel a wall of text and lets it guess. Here a date is a date
serial, hours are numbers on a `#,##0.00` format, and text is an inline string — so the date column
sorts and the hours column sums without anyone retyping it. And absence is absence: an empty value
writes **no cell at all**, never a zero; the database's `0000-00-00` is dropped rather than kept as
text (which would quietly turn a date column into a text column), while a date that merely cannot be
parsed *is* kept as text rather than silently lost. Those are opposite cases and get opposite
treatment.

QA: `tools/test_xlsx.mjs` (qa_gate, presync, `validate.yml`) unzips the real bytes and pins the
container, the part manifest, the sheet-name rules Excel enforces silently, the cell types, the
absent-is-absent rule, XML escaping (a single control character refuses a whole workbook) and the
page wiring. The three exports were also driven end-to-end in a real browser and the workbooks
re-opened with `openpyxl`.


## A filter and a bottom line on the pane

> Ray, 16 Sep 2026: *"Under the task box, include a search bar. It should display the list of
> tasks, and at the bottom show the total hours of billable and non-billable for filtered
> searches."*

**The filter is not a second copy of the top bar.** That one is a grammar (`client:` `owner:`
`bill:` `from:`) driving the chart, the KPIs and every tab at once. This one is a quick narrow over
the rows already in front of you — plain substring, every word must appear somewhere in the row,
no syntax — and it **composes** with the top bar rather than replacing it, so a scoped search stays
scoped. `Esc` or **Clear** drops it; the counter reads `44 of 220`.

**The totals row sums the whole filtered set, not the visible slice.** The table paints 200 rows at
a time, so a footer summed from what is on screen would quietly report a fraction of the search as
its total — 252 h beside a search that actually found 275 h. It sums the filtered array and, when
the list is capped, says so in the row itself: *"220 rows — totalled in full, not just the 200
shown"*. The footer is sticky, so you can read what the rows come to without arriving at the end of
them.

Billable and non-billable are totalled **separately** with the total beside them, on the same
palette as the chart. Tickets and accounts get the same treatment for the columns that can honestly
be added — never `Age` or `Idle`, because adding those together is arithmetic on a number that
means nothing summed.

One resolver (`paneRows`) feeds the table, the totals **and** the Excel export, so a download can
never be a different population from the screen. An empty result distinguishes its two causes: the
top bar matched nothing, or it matched and *this* filter narrowed it to nothing — saying "no task
matches" when a filter two lines above is the reason sends people back to the wrong control.

QA: `tools/test_reporttasks.mjs` lifts `pqMatch` and `footHtml` out of the page by name and pins the
filter (case, multi-word AND, display-label matching on Type, per-tab fields) and the totals — in
particular that 220 rows total 275 h while only 200 are painted, that the split is never merged, and
that an empty list produces no totals row at all rather than a row of zeroes.

### Decimal alignment in the hours columns

> Ray, 17 Sep 2026: *"why these numbers are not aligned vertically, you kept making this issue btw."*

`table.st td.num` was already `text-align:right` with `font-variant-numeric:tabular-nums`, so every
digit is the same width and every cell's *right edge* lines up — that part was never the bug.
Right-aligning stops there, though: it lines cells up on their **last character**, not on the ones
digit, and `hrs()` prints a bare `1` for a whole hour but `0.5` for a half — three characters
shorter. Stack those in one column and the "1" sits two character-widths to the right of where a
"1.00" would put its ones digit, so the column reads crooked even though every cell is individually
right-aligned correctly. It is the same shape of bug wherever an hours column stacks rows: the
Tasks table, the ⊞ breakdown table (twice — the flat and the nested-split views), the Tickets and
Accounts tables, and each one's totals footer.

`hrsCell(n)` fixes every value to the quarter-hour grain the data is actually booked in
(`.00`/`.25`/`.50`/`.75` via `.toFixed(2)`), so every value in a stacked column is the same width and
the decimal points land in the same place — `0.50` under `1.00` under `0.75`. `hrs()` itself is
unchanged and still used for one-off figures that never stack against a sibling (KPI tiles, chart
labels, drawer stats, tooltips), where trimming the trailing zero reads better and there is no
column to misalign. The `·` placeholder for an absent/zero value is deliberately a different glyph
and does not try to match the digit columns — it means *no hours here*, not *zero hours here*.

QA: `tools/test_reporttasks.mjs` lifts `hrsCell` out of the page by name and pins the fixed-decimal
output, then asserts every `td.num` cell that prints an hours figure calls `hrsCell` rather than the
bare `hrs()` — so the bug can't come back one column at a time the way it kept doing.

---

## Ticket hours off the whole book (Sep 2026)

> Ray, 16 Sep 2026: *"crawl the entire TM data, use the [ibfref] to match with the tickets that have
> been raised and brief from the FCC workflow, and bring over the billable, non-billable, and total
> hours to show case in either Brief Ledger and on Workflow individual task"*

The `[ibfref:]` match already existed and Workflow ticket cards already wore a `⏱` chip — but
`tmhours` was built **only** from `tmPull`'s 21-day window, so a ticket worked across months
reported a fraction of itself. Meanwhile `tmBookPull` was already holding **twelve months** of rows
for the hours trail and doing nothing with the tokens in them.

So the harvest rides those rows: `TMM.summariseTasks` over the same `trows` the crawl already
fetched, merged into `tmhours`. **No extra MCP call.**

### The two-lane rule

Two lanes now read the same tasks, and left alone they would fight over one record:

| Lane | Look-back | Why it exists |
|---|---|---|
| `tmPull` | 21 days (`TM_TASK_DAYS`) | a brief raised this morning shows hours within the hour |
| `tmBookPull` | 12 months (`TM_BOOK_DAYS`) | even coverage of the whole estate |

Whichever fired last would win, and the narrow lane would keep shrinking a ref back to just its
recent tasks — a ticket's hours would flicker between the truth and a fraction of it every half
hour. So **the window travels with the record and the wider read wins**: a narrower lane may
*create* a ref the crawl has not reached yet, but never *overwrite* what it found. The fast lane
still gives a brand-new brief its figure immediately; the crawl's fuller number replaces it as soon
as it arrives, and nothing flickers afterwards.

A record stored before this rule existed carries no window and is treated as the narrowest
possible, so the first crawl to reach it corrects it.

### The Brief Ledger

The board card and the modal already showed hours; the **ledger** — the flat register of every brief
ever sent, and the place you go to ask what a run of work came to — carried none. It now has a
sortable `⏱ Hours` column showing the **total**, with billable · non-billable · scheduled · tasks ·
owners in the tooltip. Billable and non-billable are never merged.

A ticket with no Task Manager task against it shows a **dash, not a zero**. On a register people
total by eye, "nobody has booked time to this yet" and "this cost nothing" are different facts, and
a zero would state the second while meaning the first. Unbooked rows sort below zero.

QA: `tools/test_tmmcp.mjs` (45 → 54) pins the window rule in both directions (the narrow lane
blocked, the wide lane free, an equal re-read still updating, the pre-rule migration, and the old
unwindowed signature still working), that the crawl harvests off rows it already holds, that the two
look-backs are named constants, and the ledger column's shape — including the dash.
