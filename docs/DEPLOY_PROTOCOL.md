# FeedSpark FCC — Deploy Protocol

How the `feedspark` worker gets to production, why it used to break, and the rules that keep it
boring. Written after a run of stalled Cloudflare builds cost real time on 2026‑07‑23.

---

## 1. What went wrong (the review)

**Symptom.** After a burst of merges to `main` (PRs #49→#52, four merges inside ~35 min), the live
site kept serving the **pre‑#49 build**. It took **three empty "nudge" commits** (`a6d9a34`,
`995c64a`, `1db4aaa`) over ~17 min to force Cloudflare to promote the current code.

**Root cause — not the build, the promote.** The worker itself compiles fine (a `wrangler deploy
--dry-run` bundles cleanly, ~1.2 MB). The failure was in **Cloudflare's git‑integration "Workers
Builds"**, which splits *build* from *promote* and, under rapid successive pushes, debounces/queues
and can leave the newest commit un‑promoted — so the edge serves a stale version. Compounding it:

| Weak spot | Consequence |
|---|---|
| Build/promote decoupled (CF git integration) | Newest push silently not promoted → **stale serve** |
| No re‑trigger except a new commit | "Fix" was **empty nudge commits** (noise in history) |
| No build visibility | Only way to know it stalled was eyeballing the live site |
| No pre‑merge check | A broken change *could* reach `main` and wedge the pipeline |
| Very high merge cadence | ~50 PRs in 2 days; bursts amplify the debounce/stale bug |

**Evidence.** `git log` shows the three `chore: … nudge Cloudflare rebuild` commits clustered right
after #49–#52; the worker's last real deploy timestamp trailed the pushes until the nudges landed.

---

## 2. The new protocol

**Principle: one deterministic deploy path that couples build → promote, with a way to *see* what's
live.**

### Pipeline (in the repo)
1. **Deploy on push to `main` via GitHub Actions** — `.github/workflows/deploy.yml` runs
   `wrangler deploy`. `wrangler deploy` publishes to the edge **synchronously**: the step's exit
   code is authoritative — **green = the new version is live.** There is no separate "promote" that
   can stall. A **"Run workflow"** button (workflow_dispatch) re‑deploys on demand — *no more empty
   nudge commits.*
2. **Validate before merge** — `.github/workflows/validate.yml` runs on every PR: it dry‑run‑builds
   the worker **and** syntax‑checks all dashboard pages' inline scripts
   (`tools/check_inline_scripts.js`). A change that can't build can't merge.
3. **Version stamp** — the deploy stamps `GIT_SHA` / `GIT_REF` / `BUILT_AT` into the worker, exposed
   at **`GET /api/version`**. Answers "is my push live?" in one request instead of guessing.
4. **Serialize deploys** — a `concurrency` group means rapid merges deploy in order, last‑wins, no
   race.

### One‑time setup (≈5 min, then never again)
1. Repo → **Settings → Secrets and variables → Actions** → add:
   - `CLOUDFLARE_API_TOKEN` — a token with the **Edit Cloudflare Workers** permission
   - `CLOUDFLARE_ACCOUNT_ID`
2. Cloudflare dashboard → the `feedspark` worker → **disconnect the git‑integration build**, so
   Actions is the *only* deploy path (no double‑deploy race). Until the token is set, the deploy
   job is a green no‑op, so nothing breaks in the meantime.

---

## 3. Day‑to‑day rules

- **Never hand‑nudge with empty commits.** If a deploy needs re‑running, use Actions → Deploy →
  **Run workflow**.
- **Confirm what's live** after a merge: open `/api/version` (you're logged in via Access) and check
  `sha` matches the commit you expect. Or watch the green check in the Actions tab.
- **Batch rapid edits.** Four one‑line PRs in ten minutes is four builds racing each other. Group
  related changes into one PR / one merge where you can — fewer builds, fewer surprises.
- **A red deploy is a stop.** If the Deploy action fails, read its log (it's the real error now, not
  a black box) and fix forward; don't merge more on top.
- **Pages are code.** `docs/*.html` app pages are bundled into the worker as Text modules, so a
  page change deploys the same way — the validation check covers their inline scripts.

## 4. If something still looks stale (runbook)
1. Actions tab → is the latest **Deploy** green? If red → open the log, fix the error, re‑run.
2. If green but the site looks old → hard‑refresh (the worker sends `no‑store`, but the browser/CDN
   edge cache can lag a few seconds); then check `/api/version`.
3. `/api/version` sha ≠ your commit → re‑run **Deploy** (workflow_dispatch). If it still mismatches,
   the CF git‑integration build is probably still connected and racing — disconnect it (setup step 2).
4. Still stuck → `wrangler deployments list` from the repo root shows the last deployments and who/
   what triggered them.

---

## 5. Optional hardening (later)
- **Automated liveness check** in the deploy job (curl `/api/version`, assert `sha == github.sha`).
  It needs a **Cloudflare Access service token** (the app is Access‑gated, so an unauthenticated
  curl 302s), added to the Access policy + stored as GH secrets. Worth it once the pipeline is
  otherwise stable; skipped for now to keep setup to two secrets.
- **Staging environment** (`wrangler deploy --env staging` on PRs) if you ever want to click‑test a
  change before it hits the live command centre.
