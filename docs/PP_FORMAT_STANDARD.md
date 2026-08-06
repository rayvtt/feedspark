# FeedSpark Project-Plan format — the **Reiss** standard

The Command Center reads every brand's **Project Plan** tab live. To show tasks tidily —
and to file historic work away automatically — each plan should follow the current Reiss
layout below (the one with a **Due Date** column, not the old WEEK-grid version).

---

## 1. Columns — one header row, then task rows

| Order | Header | Contents |
|---|---|---|
| Task | **Areas to optimised** | the task, one per row |
| Owner | **Task Owner** | a person — Ray / Ezgi / Steven… (never the literal word "Owner") |
| Priority | **Priority** | High / Medium / Low |
| Status | **Status** | one of the fixed set in §3 |
| Due | **Due Date** | `DD/MM/YYYY` — **filled on every task** |

- **Drop** the old `WEEK 10 / WEEK 11 …` timeline grid and the unused `Time Required`
  column. The single **Due Date** column replaces them.
- A leading task-number column (`1.1`, `1.2` …) is fine — the FCC auto-aligns it.
- The FCC finds each column by its **header name**, so keep the headers spelled as above.

## 2. Section dividers = **coloured** rows

Group tasks under **coloured** header rows (blue / grey fill) — a month or a workstream.
**The FCC skips any filled (non-white) row**, so it never imports a divider as a task.

- Give every section / divider / sub-header row a **background fill**.
- Leave real task rows on a **white / transparent** background.
- Optionally label the section with its month as **`MM-YY`** (e.g. `07-26`).

This is what stops "Action Plan" / "Keep up action for w/c…" being imported as tasks.

## 3. Status — use exactly these five

**Open · In Progress · On Hold · With Client · Done**

Colour-code the cells if you like; the FCC reads the text. Status is **2-way** — change it
in the FCC and it writes straight back to this cell.

## 4. Due Date is the one that matters

The **"latest 2 months per brand"** view and the tidy-away of historic tasks key **entirely
off the Due Date column**. A task with no due date can't be filed into a month, so it shows
regardless of the filter. **Every task needs a `DD/MM/YYYY` date.** (In the FCC you can type
`DDMM` and it writes `DD/MM/YYYY` back here.)

---

## Tidy checklist (worst → best, from the current data)

| Brand | State | Action |
|---|---|---|
| **Superdry** | 70 tasks, **no dates at all** (lane-based) | add a Due Date column + fill it — biggest win |
| **YuMOVE** | stale 2025 dates lingering | refresh dues to current |
| **Schuh** | dated, mostly historic/done | confirm Due Date filled going forward |
| **Hobbycraft** | dated, tidy | keep as-is |
| **Monsoon / Accessorize** | current (Apr–Jul 2026) | keep as-is |
| **Reiss** | ✅ the base | — |

## Why each rule exists (how the FCC reads it)

- **Coloured rows** → skipped, so only real tasks import.
- **Due Date (DD/MM/YYYY)** per task → month grouping + the latest-2-months filter + the
  intake Due column.
- **Header names** (Task Owner / Status / Due Date) → 2-way edits from the FCC write back to
  the right cell.
- The tab must be shared with the **service account as Editor** for live sync + write-back.
