# FeedSpark FCC — Google service-account setup

One Google **service account with domain-wide delegation** lets the FCC worker act as
`ray@feedspark.com` server-side (no login pop-ups, no tokens to refresh by hand). It unlocks
three live features at once:

| Scope you grant | Unlocks |
|---|---|
| `gmail.readonly` | **Hourly email → brief intake** — client task emails appear in the Workflow "Incoming emails" stream |
| `spreadsheets` (read) | **Plan live-sync** — the dashboard refreshes from each Project-Plan tab without a git rebuild |
| `spreadsheets` (write) | **2-way status** — change a task's status in the FCC and it writes back into the brand's Project-Plan tab |

> You need a **Google Workspace admin** for step 6 (authorising the delegation). If you're not
> the admin for `feedspark.com`, send steps 6's Client-ID + scopes to whoever administers the
> Workspace. Everything else you can do yourself.

---

## 1. Create / pick a Google Cloud project
- Go to <https://console.cloud.google.com> → project picker → **New Project** → name it `FeedSpark FCC` → Create.

## 2. Enable the APIs
- **APIs & Services → Library**, then Enable each:
  - **Gmail API**
  - **Google Sheets API**
  - **Google Drive API** (only needed if you want the worker to discover sheets by name)

## 3. Create the service account
- **IAM & Admin → Service Accounts → Create service account**.
- Name: `feedspark-fcc`. Skip the optional role grants → **Done**.
- Open it and copy two things you'll need:
  - the **service-account email** — `feedspark-fcc@<project>.iam.gserviceaccount.com`
  - the numeric **Unique ID / Client ID** (Details tab) — used in step 6.

## 4. Download a JSON key
- On the service account → **Keys → Add key → Create new key → JSON → Create**.
- A `.json` file downloads. **This is the credential.** Treat it like a password — it can read
  the whole mailbox. Never commit it to git or paste it in chat.

## 5. Turn on domain-wide delegation
- On the service account → **Details → Advanced / "Enable Google Workspace Domain-wide
  Delegation"** (or it's implied by the Client ID you'll authorise next).

## 6. Authorise it in the Workspace Admin console  *(admin only)*
- Go to <https://admin.google.com> → **Security → Access and data control → API controls →
  Domain-wide delegation → Manage domain-wide delegation → Add new**.
- **Client ID**: the numeric Client ID from step 3.
- **OAuth scopes** (comma-separated) — grant only what you want live:
  ```
  https://www.googleapis.com/auth/gmail.readonly,
  https://www.googleapis.com/auth/spreadsheets
  ```
  (add `https://www.googleapis.com/auth/drive.readonly` only if you want sheet-by-name lookup)
- **Authorise.** This is what lets the service account impersonate `ray@feedspark.com`.

### If you don't have admin access
Step 6 is the **only** admin-gated action (domain-wide delegation is an org-level grant — no
one can do it without super-admin). You do everything else; send whoever administers the
`feedspark.com` Google Workspace this exact request:

> Please authorise a service account for domain-wide delegation in the Google Admin console
> (Security → Access and data control → API controls → Domain-wide delegation → Add new):
> - **Client ID:** `103082021674924980826`
> - **OAuth scopes:** `https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/spreadsheets`
> It only reads my own mailbox (`ray@feedspark.com`) and our project-plan sheets; you can revoke
> it any time by removing that row.

(Replace the Client ID with your service account's if different.) Once they confirm, continue
at Step 7 — nothing else needs the admin.

## 7. Give the credential to the FCC worker
From the repo root:
```bash
# paste the full JSON from step 4 when prompted:
wrangler secret put GOOGLE_SA_JSON
# the mailbox / sheets owner the worker should act as:
wrangler secret put GOOGLE_IMPERSONATE     # value: ray@feedspark.com
```
No redeploy needed — the worker reads the secret on the next request. Until both are set, the
Workflow "Incoming emails" stream, plan live-sync and status write-back stay in their current
"not connected" state and everything else keeps working.

---

## How the worker uses it (for reference)
1. Builds a signed JWT from the SA private key with `sub: ray@feedspark.com` and the scopes above.
2. Exchanges it at `https://oauth2.googleapis.com/token` for a short-lived access token.
3. Calls the Gmail API (`users.messages.list/get`) on a schedule to pull client task emails, and
   the Sheets API (`values.get` / `values.update`) to read plans and write status back.

## Security notes
- The JSON key lives **only** as a Worker secret. Rotate it (step 4 again, delete the old key) if
  it's ever exposed.
- Grant the narrowest scopes you need. `gmail.readonly` cannot send or delete — the FCC only
  reads. Drafting client/ASPL emails still goes through your own Gmail compose (nothing is sent
  on your behalf without you pressing send).
- Delegation is scoped to the exact Client ID + scopes you authorise in step 6; removing the row
  there instantly revokes the worker's access.
