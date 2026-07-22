# Section → component pattern map

Every id below is one of `FeedSpark_DeckBuilder.html`'s `SECTIONS` entries — match a brief's
outline label back to its id, then open the referenced file/anchor for a real, working
example of the markup to adapt. `YuMOVE` = `docs/YuMOVE_Strategy_Review_Jul26.html`,
`Template` = `docs/FeedSpark_Strategy_Review_Template.html`. Where a pattern has no direct
precedent in either file, build it from the listed classes — they're already fully styled
and already work with Design mode / text-edit / row drag-and-drop, so reuse them rather than
inventing new markup.

| id | Label | Pattern | Where to look |
|---|---|---|---|
| `scope` | Service scope & scale | `.stats` (5-tile) + 2-col: a `.tbl-wrap table` (channel/feeds/focus) beside a `.card` with `.bars`/`.track`/`.fill` hour breakdown, then a `.note` | YuMOVE/Template Ch.1 — near-verbatim, same id and label |
| `stack` | Unit / tech stack | `.grid-3` or `.grid-4` of `.card`s, one per stack layer (FeedHero, Tachyon, scraping/supplemental feeds, output channels) | No direct precedent — model the card copy on Ch.3's automation table rows (Layer/Source/How it works), one card per layer instead of one row |
| `recap` | Review & project recap | `.grid-4` summary tiles (Done/Blocked/In progress/Open, real counts) + `.tbl-wrap table` action-by-action with `.pill` status + 2× `.card` insight callouts | YuMOVE/Template Ch.2 — near-verbatim |
| `lookback` | Look-back period | `.bars`/`.track`/`.fill` monthly trend (done vs open per month) — same pattern as Ch.1's hour bars, driven by `plan_tasks.json`'s `vol` array | Ch.1's `.bars` block for the visual pattern; data from `plan_tasks.json[client].vol` |
| `value` | Value delivered | `.stats` (5-tile: total hrs / billable / non-billable / % invested / tasks) + `.grid-2` of `.card`s (the invested-hours story + a protection-work stat grid) + a `.note` flagging any £ valuation for Ray | Superdry Ch.5 — the defense-deck value section; hours from an attached hour-log/work archive, never a £ figure invented |
| `wins` | Number of wins / results | Either the `#testChart` CTR-uplift bar list (`.track`/`.fill.green`) **or** a `.tbl-wrap table` test archive (Test/Market/What it told us/Result `.pill`) when tests are directional not all-quantified + a `.grid-2` (pattern card + external benchmark stat grid) | YuMOVE "TEST RESULTS VISUALISED" (bar-chart form); Superdry Ch.7 (archive-table form — use when only some tests have a hard %) |
| `auto` | Automation & pick readiness | `.tbl-wrap table` (Layer/Source/How it works/State, `.pill`) + `.callout` | YuMOVE/Template Ch.3 — near-verbatim |
| `airead` | AI readiness | `.tiers` maturity ladder (Stage 0 → Tier 3, `.tier.here` marks current) + `.sc-grid` scorecard | YuMOVE/Template Ch.6 "Maturity" + "AI Scorecard" |
| `landscape` | The AI landscape | `.stats` (5-tile industry stats — these are reusable across every client, not client-specific) + `.grid-3` cards + `.proto` protocol cards (UCP/MCP/ACP) | YuMOVE/Template Ch.4 — near-verbatim, industry stats can be copied as-is |
| `fit` | Tech fit | `.grid-3`/`.grid-4` of `.card`s or `.proto`-style cards, one differentiator each | No chapter precedent — start from `CONTENT.fit`'s bullets in `FeedSpark_DeckBuilder.html` (Tachyon+FeedHero end-to-end, proven across categories, Golden Record 99.9% target, one partner per channel) and turn each into its own card |
| `spark` | Spark AI engine (Tachyon) | `.flow` 4-step process (`.flow-step`, numbered `01`-`04`) + example `.card` with a dark code-style example block | YuMOVE/Template Ch.5, Capability 1 (and 2/3 for description enrichment / visual harvest if there's room) |
| `conv` | Google conversational attributes | The `.agent`/`.qs`/`.q`/`.agent-r` interactive Q&A panel, backed by the `DATA` object in the closing `<script>` | YuMOVE/Template Ch.6 "Deep dive" — rewrite all 6 `DATA` entries with this client's product language, keep the code structure (it's Google's real attribute spec) |
| `score` | Feed optimisation score | `.sc-grid` (6 cells) driven by `plan_tasks.json[client].cats` — one cell per lane that has a non-zero total, `done/total` as the percentage | YuMOVE/Template Ch.6 scorecard for markup; real lane data from `plan_tasks.json` |
| `channels` | Channel coverage | `.tbl-wrap table` (Channel/Status/Coverage/Notes) with `.pill` (live/optimised/missing) | Ch.1's channel table for the base pattern, expanded to every channel FeedSpark covers (Shopping/PMax, Meta, Pinterest/TikTok/Snapchat, Affiliate/LIA) |
| `cases` | Case studies / test wins | `.grid-3`/`.grid-4` of `.card`s, one proof point each, or reuse the `wins` bar-chart pattern if the case studies are this client's own tests | Ch.2's insight cards + the external-benchmark stat grid in the "TEST RESULTS VISUALISED" section |
| `roadmap` | Roadmap / next quarter | `.road` month cards (`.mo`, `.mo.peak` for the peak month) + the testing-matrix `.tbl-wrap table` with the Priority `.pill` column | YuMOVE/Template Ch.7 — near-verbatim, including the Priority-tier pattern (High/Medium/Low pills, grouped not just listed) |
| `team` | Team & ways of working | `.contacts`/`.ct` cards (name/role/email — reuse the closing-slide pattern) + a short `.card` on how work moves | The `.close`/`.contacts` markup at the bottom of every deck; real names from CLAUDE.md's account entry for this client |
| `comm` | Commercials / pricing | `.stats` or a small `.grid-3` of `.card`s (retainer, scheduled hrs, ad-hoc hrs) + bullets on add-on scope | No chapter precedent — model on Ch.1's stat-tile pattern; real figures from CLAUDE.md if documented, otherwise flag as needing Ray's input (never invent pricing) |

## Notes

- **Industry-wide stats are safe to reuse verbatim** across clients (Gartner -25% search
  volume drop, 43k ChatGPT carousel study, PayPal 95%/20% machine-readable stat, etc.) —
  these aren't client claims, they're cited third-party research already used in YuMOVE.
- **Client-specific numbers are never reused across clients** — CTR uplifts, task counts,
  scores, contacts, retainer figures must come from Step 2's sources for *this* client.
- **`conv` and `spark` reference Google's actual attribute spec** (`question_and_answer`,
  `item_group_title`, `variant_option`, `popularity_rank`, `related_product`,
  `document_link`) — keep the attribute names and feed-syntax examples accurate; only the
  surrounding "why it matters for this client" prose should change per client.
