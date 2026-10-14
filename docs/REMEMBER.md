# Remembered picks — the pick you made is the pick you come back to

Ray, 14 Oct 2026: *"after refreshing the page or tab, the pre-filter pre-selected option is not
saved and continues to be persisted. For example, on workflow, if I selected Monsoon on the
playbook, after refreshing the page it returned to where it was before. I want it to stay on
Monsoon even after refresh. Apply this methodology across everything else."*

## The rule

A pick a **person** makes in a **page-level picker** is written to **this device** and the next
load of the **same page** replays it **the way the person made it**. One rule, every app page.

| | |
|---|---|
| Where | `docs/keep_widget.html` — injected by the worker on every app page (never a client deck), beside the other widgets |
| Store | `localStorage` `fcc-keep:<path>` = `{ "<control>": { v, t, b? } }` — per device, never shared state (CLAUDE.md "WHAT STAYS ON THE DEVICE") |
| Kept | every `<select id>` at page level; the market chips `button[data-mkt]`; the period chips `button[data-win]` |
| Not kept | a select inside a `form`, `table`, `[role=dialog]`, `.modal`, `.scrim`, `.m-sec`, a chat log; anything under `data-no-keep`; a `multiple` select; a select with no id |
| Recorded when | the event is **trusted** (`isTrusted`) — a page setting its own default fires nothing, a replay fires an untrusted event, neither is a pick |
| Replayed how | the control is set and **its own** `change` / `click` is dispatched, so the page runs exactly the code a hand pick runs — nothing is re-implemented per page |
| Replayed when | the moment an option / chip carrying the value **exists** (the rosters fill from a fetch): a debounced MutationObserver, once per control per load, inside 20 s. A value the page no longer offers is never applied |
| A link wins | the URL the page was **opened with** names a brand / client / market (`?brand= ?client= ?market= ?mkt= ?b= ?c= ?m=`) → nothing is replayed over it (picks are still recorded). Read off the navigation entry, since several pages `replaceState` their query away before the widget runs. `?pb=1`, `?embed=`, `?view=` name nothing |
| A market is the brand's | a chip is stored **with the brand it was picked under** and replayed only under that brand — Reiss DE is not a market of Monsoon. Picking a market also confirms the brand (a linked landing sets the brand with no change event) |

Pages that already remembered their brand under their own key (Restock, Stock, Rules, Social,
AI Visibility, Feed Lab, Volume, KWCal, AI Quote) keep doing so; the layer agrees with them
because both record the same hand pick. Pages that write the URL as the reader moves (Pricer,
AI Visibility) refresh from the URL first — a link wins.

## The Workflow page keeps its own two states

They are not plain controls, so the page persists them itself and opts the controls out of the
layer with `data-no-keep` — **one writer per control**:

- **The board filter** (`fcc-it-state`): the `captureFilter()` shape the saved views already use —
  sources, statuses, clients, AMs, owners, window, search, hidden / archived / overdue — written on
  every `renderIntake()`, read back before the first render. A `?client=` / `?f=` / `?q=` deep link
  from the dossier runs after it and still wins. The Playbook rail follows the board's single
  selected client (the `fcc-clients` event), so restoring the board restores the rail.
- **The Playbook account** (`fcc-ck-brand`): written on a hand pick, when the rail follows the
  board and when a module opens the rail on an account; read back in `fillBrands()` only while
  nothing has chosen an account yet and only when the roster still carries it. This covers the
  case the board cannot: an account with no Intake rows ("not on the board").

## Opting out / in

- `data-no-keep` on a control or any ancestor: the layer leaves it alone (use it when a page
  persists the control itself).
- `<body data-keep="off">`: the layer does nothing on that page.
- A new picker needs nothing: a page-level `<select id>` or a `[data-mkt]` / `[data-win]` chip is
  remembered the day it ships.

## Harness

- `tools/test_keep.mjs` (qa_gate / presync / validate) — the rules lifted between the
  `FCC-KEEP:ENGINE` markers, the worker injection, the Workflow page's two stores, the tripwire
  widget lists.
- `tools/check_keep.js` (Playwright, presync) — a module-shaped page served over http (roster
  from a fetch, chips per brand, a select inside a modal): pick, reload, every pick back through
  the page's own handlers; a `?brand=` link wins and replays nothing even after the page stripped
  its query; a market never replayed under another brand; a brand that left the roster never
  forced; a replay never records itself. Then the real Workflow page under `file://`: the Playbook
  account, the board's client chip and the window survive a reload, and a `?client=` deep link
  still wins. Picks are made with the keyboard, because Playwright's `selectOption` dispatches an
  **untrusted** change — exactly the event the layer must ignore.
