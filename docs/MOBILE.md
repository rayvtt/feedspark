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
