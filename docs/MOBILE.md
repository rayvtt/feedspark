# Phone layer — the FCC on a mobile, mirroring the desktop (Sep 2026)

Ray's ask (15 Sep 2026): *"complete overhaul for UX UI for mobile version, please? MIRROR desktop
setting."* The rule that follows from it: **a phone gets every module, control and setting the desktop
has** — laid out for a thumb, never trimmed. The old narrow-screen CSS did the opposite: on most pages
the topbar became a 630px column of icons, some pages dropped the module menu entirely, and Golden
Record hid its per-attribute actions under 900px.

## What ships — one shared layer, injected on every app page

`docs/mobile_widget.html` (`FCC-MOBILE`), injected by the worker after the other widgets, for every
signin. Everything lives under one `@media (max-width:760px)` block plus a small script.

| Surface | Desktop | Phone |
|---|---|---|
| Module menu | icon row in the topbar (`#tb-modules`, the nav-parity node) | the **same node** becomes a fixed **bottom bar**: icon + label tap targets (70×58), horizontally scrollable, the current module centred; same anchors, same order, the viewer's own ▦ bundling (`apps_widget`) |
| Collapse menu (`#nav-collapse`) | hides the icon row | hides the bar (mirror); the ▦ sheet still lists every module |
| ▦ menu | dropdown | bottom sheet listing **All modules** with labels + bundled tools + Customize menu; carries the home page's signed-in identity (`.tb-who`) |
| Presence popover, view-as pill, customizer | popovers | bottom sheets above the bar |
| Topbar | wordmark · tag · menu · ▦ · presence · theme · VI | one 52px row: wordmark · collapse · ▦ · presence (2 avatars) · theme · VI; backdrop blur off (it would become the containing block of the fixed bar) |
| Feed Chat bubble | bottom-right | raised above the bar |
| Hidden-under-900px controls | — | shown again: `.at-note/.at-act` (Golden Record), `.bs-ctx` (brief composer rail), `.wf-go` (home CTA), AI Quote rate/line columns, court sub-labels |
| Wide content | — | **pan, don't crush**: the sweep wraps any table or block wider than the screen (or with a `min-width` past it) in a `.fcc-mpan` scrolling frame with scroll shadows; re-runs on DOM mutations and resize |
| Layout | multi-column splits | `.split*`, `.cols`, `.grid-2`, `.road`, `.courts`, dossier columns → one column; sticky side rails become plain blocks; KPIs 2-up |
| Inputs / buttons | — | inputs 16px (no iOS zoom on focus), checkboxes 18px, buttons ≥36px |

## Tripwires

- `tools/check_mobile.js` (Playwright, in presync after the dark tripwire; `--shots <dir>` saves
  screenshots): every app page at 390×844 must show **no sideways overflow**, a **header ≤ 64px**, the
  **module bar carrying every module** (bar + ▦ sheet), and **every control visible on the 1400px
  render visible on the phone**. Fix a page in the layer or in its own CSS — never by hiding the control.
- `tools/test_mobile.mjs` (node, in qa_gate / presync / validate.yml): pins the bar rule, the mirror
  rules, the sweep, and the worker / tripwire wiring.

## Adding a page or a module

Nothing to do for the bar: it is the nav-parity node, so a module added to every page's nav (check_nav)
appears on the phone bar automatically. A new page only needs the shared chrome (`.topbar-in`,
`#tb-modules`) — the layer does the rest. If a page grows a wide workbench, let the sweep pan it; if it
grows a two-column split, add its class to the one-column list in the layer.

## The skim view — every section one tap row (Sep 2026)

Ray's ask (18 Sep 2026, holding up the Meta Ads Manager app on an iPhone 16 Pro): *"the whole dashboard is
not functional on mobile users … it only shows what necessary to be shown … only necessary information for AM
to make decisions while using mobile phone and make it as on the go as possible … if you go on the desktop
view that would be more if needed. Allow using a lot of collapse and expand feature."* The mirror rule stands
(nothing is removed); what changes is the DEPTH at which the desktop's content sits: one tap down.

`docs/digest_widget.html` (`FCC-DIGEST`), injected after the phone layer for every signin. Under 760px:

| | |
|---|---|
| What stays on the first screen | the hero (eyebrow, title, its ⓘ), the KPI strip as a **3-up summary band** (`.kpis` on every module, the home `.statstrip`, Leadership's hub as one row of tiles), any status card without a heading (Workflow's Gmail sync panel) |
| What folds | **every section** — a block that contains its heading (`section.cat`, `.card`, `.panel`: Golden Record, Command Center, Volume, Task Manager) and a heading that sits above its content as siblings (Workflow's h2s, Leadership, KWCal). The section's OWN heading becomes the tap row: chevron · title · a **digest** read off the content (the page's `data-m-digest` word if set, else KPI headlines with their colour, `.al-row` alert counts, table rows, repeated items). Its buttons (the page's `i` popover, the ⓘ explainer, a `▸ Show` the page already owns) stay in the row and never toggle the fold. A heading the page already folds keeps its own button — styled into the row rhythm, a tap on the row forwards to it |
| Default | **closed** when the page has two or more sections (one section is nothing to skim among); a section that appears **after** boot opens — it arrived because the reader did something (Feed Lab's post-scan sections, AI Quote's chosen types); a `#hash` into a folded section opens it |
| Memory | per device, `localStorage fcc-m-open` (what one screen opened is not a team fact); an expand/collapse made this visit holds through the boot window |
| Long tables | 8 rows behind **Show all N rows** (cap at 10), lifted for good once tapped |
| Controls | **Expand all / Collapse all** above the first row; `window.FCCDigest` = `state() · expandAll() · collapseAll() · apply() · open(el)` |
| Never | inside the topbar/bar, a dialog or rail, the print sheet, the chat card / embed, the hero; `data-no-digest` on an element opts its subtree out |

Nothing moves in the DOM and the fold is a class the desktop media query never applies, so the desktop is
byte-identical. Census at ship (390px, folded → open): Leadership 979px → 5,694px, Roadmap 844 → 9,862,
Task Library 909 → 9,822, Readiness 844 → 6,332, Workflow one screen with five rows (Intake · 113 rows,
Timeline · 44 items …); KWCal, Feed Lab (pre-scan), Schedule and Templates carry one section and stay open.

Tripwire: `tools/check_mobile.js` rule 6 — on a fresh device every page with ≥2 sections opens with all of
them folded (asserted at first paint); it then calls `FCCDigest.expandAll({silent:true,caps:true})` before
the desktop-parity count, so the fold can never hide a control from rule 4. `tools/test_mobile.mjs` pins the
rules above. Adding a page: nothing — a section with an h2/h3 folds; give a block `data-m-digest="…"` to
say what its row should read, `data-no-digest` to keep it open.
