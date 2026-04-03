# Management key provisioning — automation model

Hydra provisions **management keys** (`sk-or-mgmt-…`) so each vault account can call OpenRouter’s management REST API. Two layers matter:

1. **Clerk dashboard session** (`__session` + device cookies) — required for dashboard-only operations.
2. **Stored management key** — written after a successful provision; Key Manager and snapshots use this, not the session alone.

## IDE / assistant browser recon vs Hydra automation

- **Assistant-driven browser (e.g. Cursor browser MCP, manual DevTools)** on `https://openrouter.ai/settings/management-keys` is for **discovery only**: DOM roles, button labels, Network tab tRPC URLs, and notes in **`docs/recon/TRPC_ROUTES.md`**. It does **not** write secrets into Hydra’s vault. Clicking OpenRouter’s **Copy** in that session only affects the **browser clipboard**; Hydra never receives it unless an operator **pastes** into the app or the **server** automation runs.
- **Production “Provision”** (`POST /api/accounts/:id/provision`) runs **`dashboardApi.createManagementKey`** in the **Hydra Node process**. It does **not** simulate the site’s Copy button. It captures the new key from **tRPC JSON** (`key` / `managementKey` / `apiKey` fields) or, in the Playwright fallback, from **response body regex** and **page text** (`MGMT_KEY_RE` in **`server/services/dashboard-api.js`** — currently **`sk-or-mgmt-…`**). If OpenRouter changes the management-key string format in create responses, update that regex and the tRPC success checks in code, then refresh this doc and **`docs/recon/TRPC_ROUTES.md`**.

## Strategy (in order)

1. **Direct tRPC** — `POST /api/trpc/{procedure}` with batch shape and cookies (fastest, no browser). Cached procedure name lives in the encrypted store after first success.
2. **Playwright** — headless Chromium with the same cookies, navigates to `/settings/management-keys`, triggers create, reads `sk-or-mgmt-` from tRPC response body or page text.

This is **server-side Playwright** (npm `playwright` in the API process). It is **not** Playwright MCP in the IDE (that is for assistants driving a browser interactively).

## tRPC vs browser — which is “better”?

They solve different jobs:

- **Direct tRPC (`fetch` to `/api/trpc/…`)** — **Better for production usage:** low cost, low latency, no Chromium. Right procedure + cookies + batch body → JSON with `sk-or-mgmt-…`. **Worse** when the procedure name or payload shape is unknown or OpenRouter returns HTML instead of JSON.
- **Headless Playwright** — **Better as a fallback and for discovery:** drives the same UI a human uses, can **`waitForResponse`** on real tRPC traffic, and survives some API drift. **Worse** for scale (RAM, time, flakiness vs DOM changes).

**Cursor / DevTools / “browser action”** sessions are **not** the steady-state provision path; they **refine** the implementation (selectors, procedure URL, headers) so **tRPC + cached route** carry most traffic afterward. Full comparison table: **`docs/recon/TRPC_ROUTES.md`** → *Management keys: tRPC vs headless browser*.

## Why not “AI in the loop” for end users?

Production **Provision** must not depend on an LLM. Discovery when OpenRouter changes is a **developer/operator** task: capture network + selectors once, update code or cached route.

## Headless stack (summary)

| Approach | Use for Hydra |
|----------|----------------|
| **Playwright** | **Default** — navigation, cookies, `waitForResponse`, traces/screenshots. |
| **Puppeteer** | Lateral; similar to Playwright on Chromium. |
| **Raw Chrome DevTools Protocol** | Only if attaching to existing Chrome or custom network archaeology; more code, same bot-detection surface. |

Prefer **intercepting the tRPC response** for the one-time secret; the modal DOM is a fallback.

## When the UI or API changes (operator playbook)

1. Log into OpenRouter in Chrome → **DevTools → Network** → filter `trpc`.
2. Create a management key → select the mutation → **Copy as fetch** (redact cookies).
3. Note the **procedure segment** in the URL (e.g. `managementKeys.create`) and response JSON field names.
4. Open a PR or update `docs/recon/TRPC_ROUTES.md` with procedure name + redacted fetch + selector notes.
5. Optional: `npx playwright codegen https://openrouter.ai` — log in manually, record clicks, then replace fragile CSS with `getByRole` / `data-testid`.

## Debugging failed provision

- **`HYDRA_PLAYWRIGHT_HEADED=1`** — watch the browser locally.
- **`HYDRA_PROVISION_NETWORK_LOG=1`** — during Playwright provision, log every **POST** to OpenRouter (**URL, status, truncated postData**) to **`$TMPDIR/hydra-provision-debug/provision-network-<accountId>-<ts>.log`**. No response bodies (avoids consuming streams). Also enabled when **`HYDRA_PROVISION_DEBUG=1`**.
- **`HYDRA_PROVISION_DEBUG=1`** — on Playwright failure, save a **trace** (`provision-trace-<accountId>-<ts>.zip`, open in Playwright Trace Viewer); stderr lines for tRPC/non-tRPC responses that look like create mutations but yield no extractable key; failure screenshots under `$TMPDIR/hydra-provision-debug/` (also automatic in `NODE_ENV=development`).
- **`HYDRA_PROVISION_VERBOSE=1`** — step-level stderr during Playwright provision (URL/title after `goto`, whether the **Create** control matched, after name+submit).
- **Standalone capture without Hydra:** `node scripts/capture-mgmt-key-network.mjs` with **`HYDRA_CAPTURE_OR_SESSION`** (and optional **`HYDRA_CAPTURE_OR_CLIENT`**). See **`docs/recon/TRPC_ROUTES.md`** → *Management keys — captured network*.
- **422 `PROVISION_FAILED`** — dashboard session is **not usable** (HTTP **401/403/423/429** or HTML auth gate), not generic tRPC business errors; see response `source`.
- **500** with `Could not extract management key via Playwright` — UI/selectors/network changed or bot friction; response JSON may include **`code`:** `PROVISION_PLAYWRIGHT_EXTRACT` and a **`hint`** with the debug directory. Use steps above.

**Session gate:** Provisioning calls **`ensureSession`** before tRPC/Playwright. That helper **backfills `config.sessionExpiry`** from the Clerk JWT when the vault had **`__session`** but no stored expiry (email-login persistence), retries Clerk **`GET /client`** up to three times on refresh, and **persists expiry** after a successful OpenRouter credits **`validateSession`**. Details: **`docs/ARCHITECTURE_DEEP_DIVE.md`** (*ensureSession and persistent sessionExpiry*).

## Implementation checklist (spec ↔ `dashboard-api.js`)

Use this to confirm the OpenRouter **Create / Name / Save** automation and provision policy are wired:

| Requirement | Where in code |
|-------------|----------------|
| Toolbar opens flow with **Create** first | `clickFirstVisibleCreateControl` — `roleCandidates` starts with **`/^create$/i`** |
| Scope Name/Save to active HeadlessUI modal | `managementDialog` + `fillManagementKeyNameAndSubmit` uses `#headlessui-portal-root [role="dialog"]` (falls back to page if no dialog) |
| Fill **Name** via a11y | `fillManagementKeyNameAndSubmit` — **`getByRole('textbox', { name: /^name$/i })`**, then placeholders including **`Management Key`** |
| Submit with **Save**, not toolbar **Create** | **`getByRole('button', { name: /^save$/i })`** first within modal scope; CSS fallback order ends with **`Create`** |
| Tolerate overlay pointer interception | `fillManagementKeyNameAndSubmit` retries submit with Playwright **`click({ force: true })`** fallback |
| Load page **before** `waitForResponse` | `createManagementKeyViaPlaywright` — `goto` + `networkidle` + **Create** click **before** registering the tRPC listener |
| Accept tRPC / RSC POST when response body contains the key | `waitForResponse` — if **`extractManagementKeyFromResponseBody`** finds **`sk-or-mgmt-`**, the match is accepted (no longer gated on **keyName** appearing in `postData`, which breaks batched/encoded bodies). Deep JSON walk for nested key fields. |
| Persist route **outside** response predicate | `discoveredRouteFromWait` → **`saveDiscoveredEndpoints`** after **`await trpcKeyWait`** |
| Abort **provision** only on auth-like HTTP | **`shouldAbortProvisioning`** on cached + candidate **`catch`** (not **`isPermanentError`** for every tRPC code) |
| Extract key from response then DOM | Regex on tRPC body → **`getByText(MGMT_KEY_RE)`** wait → **`body` textContent** |
| API contract for operators | **`docs/API_REFERENCE.md`** — `POST /api/accounts/:id/provision` (**422** = session dead, not all tRPC failures) |

## Related code

- `server/services/dashboard-api.js` — `createManagementKey`, `createManagementKeyViaPlaywright`
- `server/controllers/AccountController.js` — `provision` (422 on inner `success: false`)
- `docs/API_REFERENCE.md` — `POST /api/accounts/:id/provision`

## OpenRouter UI reference (verified 2026-04-02)

On **Settings → Management keys**, the flow is: **Create** → fill **Name** → **Save**. Playwright should not use a generic `button:has-text("Create")` as the submit control when **Save** is the commit action. See **`docs/recon/TRPC_ROUTES.md`** (*Live dashboard UI*) for the accessibility snapshot table.

Provisioning over tRPC only aborts early on **auth/session HTTP failures** (`401` / `403` / `423` / `429` or HTML login pages); other tRPC errors still fall through to candidate routes and then headless Playwright.
