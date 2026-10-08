# Social DPA — `/social`

> Ray, 8 Oct 2026: "a new feature module for all social DPA optimization, especially Meta, Instagram,
> Pinterest, or TikTok ads … image overlay, so bring the same kind of mechanics from the overlay module
> over. I want a preview of how it would look on each platform, side by side … the ad — especially a
> proper dynamic product ad for Meta — should include a product title, price, buttons, etc. These fields
> can be dynamically scheduled based on the day, weather, customer behavior, or analytics … a tagline
> could show the number of clicks over the past 30 days or the number of people who have viewed the
> product in the last 24 hours."

One product, shown as a dynamic product ad on six placements at once — **Facebook Feed (1:1 / 4:5),
Instagram Feed (4:5), Instagram Stories (9:16), Instagram Reels (9:16), Pinterest (2:3), TikTok (9:16)** —
each in its network's own chrome (Sponsored header, headline, price, button), with a FeedSpark image
overlay painted **inside that network's safe zone**, and a schedule of rules that decides what the
tagline, headline, primary text and button say at a given moment.

## Files

| | |
|---|---|
| `docs/FeedSpark_Social.html` | the page (served at `/social`, grantable module `social`) |
| `docs/social_engine.js` | UMD `FeedSocial`, pure: platforms, safe zones, field limits, button mapping, tokens, conditions, `evaluate`, `weekGrid`, ideas, `cleanSetup`, `briefLines` — served verbatim at `/social/engine.js` |
| `docs/overlay_studio_engine.js` | reused as-is: the field summoner, the overlay designs, `compose` + `layout` (the Overlays Design studio's engine) |
| `tools/test_social.mjs` | engine + wiring harness (qa_gate / presync / CI) |
| `tools/check_social.js` | Playwright tripwire on the real page (presync) |
| `tools/social_stub.js` | engines + empty roster for check_mobile / check_darkmode / check_social |

## What it reads

* **The product** — a 400-row sample of the live output feed (`/api/feed/proxy`, Feed Lab parser),
  bound by the Overlays studio's summoner so a price pair is resolved by value, not column name. A
  Meta (`-fb`) market is preferred when the brand has one — it is the feed a social DPA runs on.
* **The pictures** — `image_link` (the source decoded out of any overlay already live) plus each
  distinct `additional_image_link`, through `/api/catalog/img` so the canvas is same-origin and the
  PNG export works. "Same image everywhere" or "A picture per network" (plus a session-only upload).
* **Clicks + conversions over 30 days** — ⚡ Google Ads · 30 days reads FeedHero's per-product Ads
  Traffic report (`/api/catalog/ads?period=30_days`, the Catalogue's lane). A Meta market reads its
  Google market's report.
* **Not read by the FCC** — views in the last 24 hours, the weather, the shopper's audience. They are
  typed for the preview and labelled **demo / simulated** on screen. In production: Meta pixel
  ViewContent or GA4, a weather source per market, the networks' retargeting audiences.
* **🎭 Demo products** — six products drawn by the page itself (no client picture, every figure demo).
  The page opens on them when no brand is picked or the feed can't be read.

## The schedule

Rules run **top to bottom, first match wins per field**. A rule = field (tagline / headline / primary
text / button) + a template (`{clicks30} clicks in the last 30 days`) + conditions ANDed: day of week,
hours (wraps midnight), day of month (payday), date range, weather, temperature, shopper audience, a
product number (`clicks30 ≥ 100`). Every rule card states, for the moment on screen, whether it is
**showing now**, **not now** (and which condition failed), **matched — an earlier rule wins**, or
**stood down**.

Three honesty rules (engine `fill` / `tokenValue`):

1. A template naming a figure the product does not have **stands down** and the next rule applies —
   an ad never reads "0 people viewed this" or "{views24} people viewed this".
2. A figure too small to be proof stands down too (print floors: views 10, clicks 10, bought 3,
   discount 5%; stock above 25 is a stock figure, not scarcity).
3. Every figure carries its source (feed / Google Ads / master / demo / simulated) everywhere it shows.

The opening schedule: weekend offer (Fri–Sun, ≥10% off) → live interest in the evening (17–23,
views ≥ 50) → 30-day clicks (≥ 100) → "Buy now" for basket abandoners → retargeting copy. It takes three
turns across a week. **The week at a glance** shows any field per day × daypart; **▶ Play the week**
walks the previews through it. **Optimisation ideas** = twelve ready-made rules (payday, rainy day, cold
snap, low stock, bestseller, evening scroll …), each saying what data it needs and whether this product
can carry it.

## Platform figures are a guide

Safe zones (Stories 14% top / 20% bottom, Reels 35% bottom, 6% sides; TikTok ~7% top / 25% bottom / 13%
right) and text limits (Meta primary ~125 shown, headline 40; Pinterest title 100 / ~40 shown; TikTok ad
text 100) are the commonly published figures as of Oct 2026 — third-party guides disagree and the
networks move them, so the page states them as a guide to confirm in each network's Ads Manager preview.

## How it ships

* Headline / primary text map onto Meta's catalogue keywords where one exists (`{{product.name}}`,
  `{{product.current_price}}`, `{{product.brand}}`, `{{product.price}}`); every other token is a feed
  field written by a FeedHero rule on the schedule, landing at the next catalogue fetch.
* The image tagline is a text parameter on FeedSpark's image-creator URL, re-rendered on each change.
* ⧉ Copy schedule / → Brief turn the schedule into words (data source per token, the Meta route) and
  file `Social DPA - Dynamic schedule - <Brand> <MKT> - MMYY` into Workflow (cat technical).

## Storage

One schedule per brand in shared state namespace **`socialdpa`** (`'self'`-scoped: the key is the
brand), via `/api/state` — the team's plan, not one screen's. localStorage keeps a device mirror
(`fcc-soc-setup:<brand>`) and per-device view prefs (`fcc-soc-fold`, `fcc-soc-plats`, `fcc-soc-brand`,
`fcc-soc-mkt`). The demo schedule stays on the device.
