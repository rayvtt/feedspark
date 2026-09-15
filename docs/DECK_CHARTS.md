# Work-volume charts — the Deck Generator's chart workbench

Ray, 15 Sep 2026: *"Within the deck-generator module, could you also build a chart generator for
any kind of work-volumes type analysis? For example, I'm looking at Reiss for the past six months
of work. With the data knowledge of all the current workstreams — project plans, emails, calls,
and scheduled work — the chart can be almost customised, edited, personalised for AMs easily to
see the breakdown of volumes for each area and be elaborated as possible too."*

Lives on **`/deck-builder`** (section *Work-volume charts*). API: **`GET /api/volumes`**.

## The data — `/api/volumes?client=<Brand>&months=<1–24>[&end=YYYY-MM]`

One brand, one fixed window of months ending at `end` (default: this month). Six streams, each
counted per month with its own breakdown dimensions (`src/volumes.js`, pure; harness
`tools/test_volumes.mjs`):

| stream | source | month from | dims | extra |
|---|---|---|---|---|
| **plan** — project-plan tasks | cron-warmed `planlive:<sheet>` | the row's Due date or its month section | category · status · owner | cold cache → the page falls back to the baked `PLANTASKS` monthly volume (status only) and says so |
| **emails** — captured client emails | KV `gmailinbox` + `gmaildismissed` | mail date | triage decision · kind | capture began Aug 2026, rolling 120 messages |
| **calls** — call-notes action items | KV `callactions` | meeting date | meeting · owner | |
| **briefs** — Workflow tickets | KV `briefs` | created | stage · category · source | |
| **schedule** — the ASPL weekly schedule | the shared `scheduleTabs` loader (live / snapshot) | the week | task · decision · market | **hour sums**: offered · delivered · skipped |
| **results** — keyword-optimisation result rounds | KV `kwresults` | mail date | market · verdict | |

Dates arrive in six shapes (epoch ms, ISO, `DD/MM/YYYY`, `Jul 25` section labels, Sheets serials,
RFC-2822 headers); `monthKey` reads all of them and anything unreadable is counted as **undated**,
never guessed. Records outside the window are counted as `outside`. Every response is scoped to
the signin's clients (`clientMatch`), and nothing is written.

## The workbench

- **Brand** follows the deck's client until you pick another; **window** 3 / 6 / 12 months.
- **View**: *Volume by stream* (six fixed series) or any *stream × dimension* (top seven values,
  the rest folded into *Other*), plus *Schedule · hours offered · delivered · skipped*.
- **Form**: stacked columns (default), lines, 100% stacked, horizontal totals.
- **Series chips** and the **legend** hide / show a series; **value labels** and the **table**
  toggle; hover any month for the tooltip.
- **Title** and **subtitle** are editable in place; **notes** travel with the chart into the
  brief as the speaker line.
- **📌 Pin to build brief** snapshots the chart (spec + numbers). `Generate build brief` then
  appends *## Work-volume charts* with one markdown table per pin, which the `/deck-generator`
  skill builds as **native PowerPoint charts** (Step 1a in the skill). The in-browser preview
  gains one slide per pin.
- **⬇ PNG** (2000 × 980, footer stamped), **⎘ Copy table** (TSV for Sheets / PowerPoint),
  **🔗 Copy link** (`?chart=<spec>` deep link that reopens this exact chart), **💾 presets**
  (named, per device — like the rest of the generator's composition).

Palette: the dataviz skill's validated six-slot categorical set, with its own dark-surface steps
(light: `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300`; dark: `#3987e5 #d95926 #199e70
#c98500 #d55181 #008300`). Three light slots sit under 3:1 on white, so direct value labels
and the table view are always available (the relief rule). Stream colours are fixed by slot, so
hiding a series never repaints the survivors.
