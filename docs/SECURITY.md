# FCC security — the register

Ray, 8 Oct 2026: "Perform a complete security check and enforcement across FCC, and make sure it will be
safe from bot attacks or any type of attack." This file is the register: the model, every control the
worker enforces, what the audit found and left alone, and the settings that live in the Cloudflare
dashboard rather than in this repository. The enforcement is `cloudflare/feedspark-deck/src/security.js`
(pure, every rule unit-tested) wired into the worker's `fetch()` entry; the harness is
`tools/test_security.mjs` (qa_gate / presync / validate). The first pass — escaping, headers, CSP, SRI —
was PR #528 (24 Sep 2026): `tools/test_escaping.mjs`, `tools/check_csp.js`.

## The model

The FCC is one Cloudflare Worker (`feedspark`) behind Cloudflare Access (Zero Trust). The Workers layer is
**Public** — never flip it to Restricted, it intercepts before Zero Trust and silently kills the agents'
push lane. Auth is Access: a site-wide Allow app and ONE path-scoped **Bypass** for `/api/gmail/push`,
which the agents (Apps Script, xml-scan, golden-daily, master-stock) reach with the `GMAIL_PUSH_KEY`
secret. The worker learns who is asking from the headers Access injects
(`Cf-Access-Authenticated-User-Email`, `Cf-Access-Client-Id`), and every scoped route and owner gate
resolves off that identity (`who()` → `accessOf()` → `clientMatch` / `realOwner`).

The audit's one systemic finding: **an anonymous request used to resolve to full access.** `who()` returned
`unknown`, `resolveAccess` treated an unassigned signin as "scoping only narrows" and handed back the whole
house. Access made that unreachable on the main hostname — but not on a Workers **preview URL**, a route
added to another hostname, or a policy edited by mistake. The gate below closes it at the worker.

## What the worker enforces (every request, before any route reads anything)

| # | Control | Where | Rule |
|---|---|---|---|
| 1 | **Identity gate** | `SEC.idGate` in `fetch()` | No identity → **401** on every path except the public lanes: `/api/version`, `/api/news`, `/api/gmail/push` (key-gated) and CORS `OPTIONS`. A refused API call gets JSON `{code:'no_identity'}`, a refused page a plain sign-in page. `ALLOW_ANONYMOUS=1` (a Worker var) is the only escape hatch, for an emergency, never the default. |
| 1b | **Directory gate** (Ray, 8 Oct 2026: "only personnel with access been created in the workflow section pls") | `SEC.dirGate` in `fetch()` | Past Access, a signin must ALSO have a row the owner created in **Workflow → 👥 Individual access** (KV `accessdir`, the git seed until first saved). The owner always passes; an unlisted signin, a client-team alias without a row and a service token get **403** with a page that names the fix. The old "unassigned → full house" default is gone. `ALLOW_UNLISTED=1` is the escape hatch. One KV get per non-public request. |
| 2 | **Verified identity** (opt-in) | `resolveIdentity` → `SEC.verifyAccessJwt` | With `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` set, the worker verifies `Cf-Access-Jwt-Assertion` (or the `CF_Authorization` cookie) — RS256 against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached an hour, re-read once on an unknown `kid`), audience, `exp`/`nbf` — and the identity is the **token's** email, never the header's. A missing/invalid token, or an unreachable certs endpoint, is `unknown` → 401 (fail closed). Unset, the headers are trusted as before. |
| 3 | **Body caps** | `SEC.bodyGate` | `Content-Length` over the lane's cap → **413** before the body is read: 4 MB default, 26 MB `/api/materials`, 48 MB `/api/gmail/push` (the xml-scan agent's batches of 8 snapshots). Undeclared lengths pass (Cloudflare bounds a request at 100 MB). |
| 4 | **Push key, constant time** | `SEC.safeEqual` | The `X-FCC-Push-Key` compare runs over the longer string and folds the length into the result — no early return that times where the first wrong byte is. |
| 5 | **Push brake** | `push-fail` throttle, per `cf-connecting-ip` | 20 wrong keys in 10 minutes → **429** for the rest of the window, read before the key is compared. KV-backed fixed window (`rl:push-fail:<ip>`), a KV error never blocks. |
| 6 | **Money-route throttle** | per identity | `/api/claude` 120, `/api/aivis/ask` 300, `/api/i18n` 60 per 10 minutes — a compromised or runaway signin cannot burn the Anthropic / OpenAI / SerpApi budget. 429 with `retryS`. |
| 7 | **Redirect-checked outbound fetch** | `SEC.fetchWithin` | The image proxy (`/api/catalog/img`) and the PDP fetch (`/api/golden/pdp/fetch`) follow redirects **by hand**: every hop is resolved against the previous URL and held to the same allow-list (the feed's own image hosts / product host), ≤5 hops; a hop off the list is refused with its host named and never fetched. `redirect:'follow'` is gone from the worker (the harness fails on it). |
| 8 | **CORS to self** | `SEC.tightenHeaders` in `secHeaders` | `Access-Control-Allow-Origin: *` on every JSON answer is rewritten to the request's own origin + `Vary: Origin`. The FCC is same-origin; nothing else reads its JSON. |
| 9 | **No shared caching of API answers** | same | Every `/api/` answer without a cache directive leaves `Cache-Control: no-store`. |
| 10 | **Headers** (PR #528) | `secHeaders` | CSP (`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, scripts only self + cdnjs with SRI), `X-Frame-Options`, `nosniff`, `Referrer-Policy: same-origin` (client names ride in query strings), `Permissions-Policy`, HSTS. |
| 11 | **View-as cookie** | `docs/FeedSpark_Workflow.html`, `docs/viewas_widget.html` | `fcc-viewas` is set and cleared with `Secure; SameSite=Lax`. It is honoured by the server only when the real Access identity is the owner, so it can never widen access. |

Already in place and re-checked: the feed proxy resolves a sheet/XML source only from the dossier or
`DEFAULT_FEEDS` (never a URL from the query; XML hosts allow-listed to `*.feedhero.net`); the master
file streams only from `https://*.feedhero.net/import_feeds/<cmpid>/` and FeedHero's URLs never reach
the browser; every outbound proxy forces its own content-type with `nosniff`; owner gates
(`/activity`, `/leadership`, `/api/activity`, reminders) resolve through `realOwner` so a view-as preview
is denied like the person previewed; scoped data routes re-inject foreign records before a kvmerge so a
scoped whole-map save cannot tombstone the rest of the board; the 15 page escapers are one shape
(`tools/test_escaping.mjs`); the repository carries no client hours, no client figures and no secret
(the harness sweeps every tracked file for key shapes and refuses a `[vars]` entry that looks like one).

## Left alone, and why

- **`'unsafe-inline'` / `'unsafe-eval'` in the CSP.** Every page is one file with inline script blocks
  and nine pages use `eval`/`new Function` for lifted engines. Dropping the two keywords means serving
  the engines as `<script src>` and moving every inline block out — a page-by-page refactor, not a
  security fix to rush. Escaping is what stops an injected handler; the CSP stops a script from a host
  we never named. Tracked as the next step.
- **Any signin can `DELETE /api/edits`** and write to every shared kvmerge store. By design — the FCC
  is a team tool with per-client scoping, not per-user ownership; every write is in the activity log.
- **`/api/version` and `/api/news` stay public.** The deploy check and the git-bundled digest carry no
  client data.

## In the Cloudflare dashboard (Ray — nothing here is changed by code)

1. **Turn on verified identity.** Zero Trust → Access → Applications → the site-wide FCC app →
   Overview → copy the **Application Audience (AUD) Tag**. Then
   `wrangler secret put ACCESS_AUD` (paste it) and `wrangler secret put ACCESS_TEAM_DOMAIN`
   (the team name, e.g. `feedspark` for `feedspark.cloudflareaccess.com`). No redeploy; the worker
   starts verifying on the next request. If sign-ins start failing, check the AUD, or remove the two
   secrets to fall back to header trust.
2. **Disable Workers Preview URLs.** Workers & Pages → `feedspark` → Settings → Domains & Routes →
   Preview URLs → off. A version preview is a different hostname and is not behind the Access app.
   (The identity gate now answers 401 there anyway; off is one hostname fewer.)
3. **Keep the Workers toggle Public.** Settings → Domains & Routes — never "Restricted" (it sits in
   front of Zero Trust and kills the agents' bypass lane).
4. **Access policy hygiene.** The Allow policy should name the FeedSpark identity provider (not a
   one-time-PIN for any email); session duration 24h or less; the Bypass app scoped to exactly
   `/api/gmail/push`. Consider a **service token** for the agents and a second Bypass-free policy
   later — the key lane stays because Apps Script cannot hold a service token.
5. **WAF / Bot Fight Mode / rate limiting rules need a zone.** `*.workers.dev` has none. If bot traffic
   ever matters, put the worker on a custom hostname under a FeedSpark-owned zone (e.g.
   `fcc.feedspark.com`) — then Bot Fight Mode, managed WAF rules and zone rate-limiting rules all
   apply in front of the worker, and Access binds to the same hostname. Today Access itself absorbs
   bots: every anonymous request gets the login page from Cloudflare's edge before the worker runs.

## Running the check

```
node tools/test_security.mjs     # 89 assertions: the gate module, the lifted identity resolver on a signed token, the wiring, the repo sweep
node tools/test_escaping.mjs     # PR #528: the fifteen page escapers
node tools/check_csp.js          # PR #528: every page under the real CSP (Playwright)
```
