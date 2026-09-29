# Superdry Service Review (defence deck) — build log

Deck: `docs/Superdry_Service_Review_Sep26.html` → `docs/materials/Superdry_Service_Review_Sep26.pptx`
(Service / Defence Review, Sep 2026; 11 chapters; 19 markets; hours window Oct 2024 – Sep 2026.)

Ray, 29 Sep 2026: *"redo a new service defender deck for Superdry … defend FeedSpark services and the
work we have put in so far, trying to pull in any sign of uplift in performance or data transformation,
and covering the market. hours reports (back dated 2 years since 2025) - on the overview level as well"*

## The brief already existed, in Superdry's own plan workbook

The `Vendor Review` tab of the project plan is Ray's own sketch of this deck — and it names the client's
position: **"the marketing team is smaller, spend is also [reduced]"**. Superdry is reviewing vendors.
His slide plan (challenges → value of feed management → success stories → our values → account overview
YoY → technical complexity → value vs cost) and his key messages ("SD online presence continuously rely
on feed", "SD current time spent should be at least 80% optimisation") shaped chapters 02, 04 and 09.
Reading that tab before writing was worth more than any other single step.

## The centrepiece: the before/after is inside the feed

Every FeedSpark output feed carries `c:fs_data_original_title` — the title the retailer supplies — beside
the `title` it ships. So the transformation is directly measurable on the same products, same file, same
moment, with no sampling:

| market | SKUs | supplied | in MASK 80–120 | shipped | in MASK | rewritten | highlights | keywords |
|---|---|---|---|---|---|---|---|---|
| GB | 25,699 | 29.1 | 0.0% | 83.1 | **62.7%** | 100% | 29.4% | 41.0% |
| IE | 23,510 | 29.1 | 0.0% | 83.2 | **63.0%** | 100% | 29.5% | 41.2% |
| US | 14,647 | 28.9 | 0.0% | 83.2 | **62.5%** | 100% | 25.2% | 46.3% |
| DE | 25,818 | 35.8 | 0.0% | 71.4 | 24.3% | 100% | **0%** | **0%** |
| FR | 25,762 | 34.6 | 0.0% | 68.4 | 14.2% | 100% | **0%** | **0%** |
| NL | 24,360 | 33.3 | 0.0% | 51.4 | 0.4% | 100% | **0%** | **0%** |

**Not one supplied title, in any market, reaches the band. Nearly two thirds of the English ones do.**
GB adds +54.0 characters per product on all 25,699. The English/European split is the roadmap in one table.

## Judgement calls worth remembering

- **Never annualise Superdry's last-30-days.** September is the low month for an outerwear business: the
  year is ~2.3× the annualised 30-day figure in *both* spend and revenue, so the ratio is sound and the
  year is the honest number. (Opposite shape to Hobbycraft, where the *year* was the suspect figure.)
- **Three single-group tests are on batches of 7, 21 and 45 products** and return +14,047%, +165% and
  +1,566%. Arithmetically true, statistically meaningless — excluded from every figure, and flagged
  internally in case Superdry has seen them quoted before.
- **Brand-in-title is a per-category setting, not a rule.** The same test run the same day won on
  T-shirts (+10.2% impr / +27.8% clicks) and lost on Dresses (−7.5% / −8.0%).
- **The biggest change to this feed has never been measured.** Five title-optimisation tests and three
  image-tagging tests all closed "no performance data detected". Chapter 03 proves the change; chapter 06
  says plainly that we cannot yet put an uplift number on it. That honesty is the point of a defence deck.
- **"80% optimisation" is not what the log says.** Ray's own target note says it should be ≥80%; the
  four-year read is **54%** (2,056.75 of 3,793 hours), account management 22%. The deck leads with 54%
  and explains it — the nineteen-market support load — rather than quoting the friendlier target.
- **FeedHero's audit says "Product name missing, 22,368 (39%)"** while the live output feed has a title on
  100%. That is the inbound master feed before the rules run, not the shipped feed. Flagged internally,
  not used as a client-facing number.

## Sources read

| Source | What only it gave |
| --- | --- |
| FS reports MCP, 19 `get_task_list_for_client` pulls | 2,846 tasks and **3,793 hours** back to Jul 2022, per market, per month |
| `get_client_list` | 42 h/month contracted across 7 markets; **12 markets with no retainer**; GB at −97.75 h |
| FeedHero `client_list` | 19 instances, **53 live feeds**, **1,774 active rules** (+675 paused) |
| FeedHero `rule_report` | What the rules actually rewrite, field by field, 58,838 products each; 7 of 210 GB rules dormant (all seasonal) |
| FeedHero `roas_dashboard` | GB £16.18m on £1.68m (965.6% ROAS); 920.8M impressions and 334,866 conversions across four markets |
| FeedHero `audit_issues` | Yesterday's scan: highlights, pattern, size-type, trash products, **no custom alerts configured** |
| FeedHero `search_terms` | **58% of the top 1,000 terms are not in any title; 31% match nothing at all** |
| Plan workbook `AB Test Archive` | 40 tests, Jan 2025 → Sep 2026, with figures |
| Plan workbook `Vendor Review` | Ray's own brief for this deck, and the client's position |
| Six live output feeds | The before/after table above |

`ops/` holds no Superdry hours or client figures — per CLAUDE.md, none of this is committed; the deck
carries what belongs in a client document and this log carries the method.
