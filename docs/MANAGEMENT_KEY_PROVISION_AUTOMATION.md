# Management key provisioning — automation model

Hydra provisions **management keys** (currently returned as full `sk-or-v1-…`
strings) so each vault account can call OpenRouter’s management REST API. Two
layers matter:

1. **Clerk dashboard session** (`__session` + device cookies) — required for dashboard-only operations.
2. **Stored management key** — written after a successful provision; Key Manager and snapshots use this, not the session alone.

## IDE / assistant browser recon vs Hydra automation

- **Assistant-driven browser (e.g. Cursor browser MCP, manual DevTools)** on `https://openrouter.ai/settings/management-keys` is for **discovery only**: DOM roles, button labels, Network tab tRPC URLs, and notes in **`docs/recon/TRPC_ROUTES.md`**. It does **not** write secrets into Hydra’s vault. Clicking OpenRouter’s **Copy** in that session only affects the **browser clipboard**; Hydra never receives it unless an operator **pastes** into the app or the **server** automation runs.
- **Production “Provision”** (`POST /api/accounts/:id/provision`) runs **`dashboardApi.createManagementKey`** in the **Hydra Node process**. It does **not** simulate the site’s Copy button. It captures the new key from **Server Action/RSC text**, **tRPC JSON** (`key` / `managementKey` / `apiKey` fields), a REST fallback, or, in the Playwright fallback, from **response body regex** and **page text** (`MGMT_KEY_RE` in **`server/services/dashboard-api.js`** — currently **`sk-or-v1-…`**). If OpenRouter changes the management-key string format in create responses, update that regex and the tRPC success checks in code, then refresh this doc and **`docs/recon/TRPC_ROUTES.md`**.

## Strategy (in order)

1. **Server Action replay** — direct `POST /settings/management-keys` with the captured `Next-Action` ID and RSC response parsing. This is the first path in current code.
2. **Direct tRPC** — `POST /api/trpc/{procedure}` with batch shape and cookies. Cached procedure name lives in the encrypted store after first success.
3. **REST session-token fallback** — uses the session JWT as a bearer token when OpenRouter accepts that shape.
4. **Playwright** — Chromium launch **or** attach to your Chrome via **`HYDRA_PLAYWRIGHT_CDP_ENDPOINT`** (e.g. start Chrome with `--remote-debugging-port=9222`), same cookies, `/settings/management-keys`, then response + DOM extraction.

This is **server-side Playwright** (npm `playwright` in the API process). It is **not** Playwright MCP in the IDE (that is for assistants driving a browser interactively).

**Step logs in development:** with **`NODE_ENV=development`**, provision emits the same step-level stderr as **`HYDRA_PROVISION_VERBOSE=1`** without setting extra env vars (still no response bodies).

## tRPC vs browser — which is “better”?

They solve different jobs:

- **Server Action replay** — **Best current production path:** low cost, low latency, no Chromium, and matches the current OpenRouter management-key creation surface.
- **Direct tRPC (`fetch` to `/api/trpc/…`)** — **Useful fallback:** low cost, low latency, no Chromium. Right procedure + cookies + batch body → JSON with `sk-or-v1-…`. **Worse** when the procedure name or payload shape is unknown or OpenRouter returns HTML instead of JSON.
- **Headless Playwright** — **Better as a fallback and for discovery:** drives the same UI a human uses, can **`waitForResponse`** on real tRPC traffic, and survives some API drift. **Worse** for scale (RAM, time, flakiness vs DOM changes).

**Cursor / DevTools / “browser action”** sessions are **not** the steady-state provision path; they **refine** the implementation (Server Action hash, selectors, procedure URL, headers) so direct replay paths carry most traffic afterward. Full comparison table: **`docs/recon/TRPC_ROUTES.md`** → *Management keys: tRPC vs headless browser*.

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
- **`HYDRA_PLAYWRIGHT_CDP_ENDPOINT=http://127.0.0.1:9222`** — attach Playwright to an existing Chrome (remote debugging); often fewer headless/bot issues than bundled Chromium. Start Chrome with remote debugging enabled, then provision.
- **`HYDRA_PROVISION_NETWORK_LOG=1`** — during Playwright provision, log every **POST** to OpenRouter (**URL, status, truncated postData**) to **`$TMPDIR/hydra-provision-debug/provision-network-<accountId>-<ts>.log`**. No response bodies (avoids consuming streams). Also enabled when **`HYDRA_PROVISION_DEBUG=1`**.
- **`HYDRA_PROVISION_DEBUG=1`** — on Playwright failure, save a **trace** (`provision-trace-<accountId>-<ts>.zip`, open in Playwright Trace Viewer); stderr lines for tRPC/non-tRPC responses that look like create mutations but yield no extractable key; failure screenshots under `$TMPDIR/hydra-provision-debug/` (also automatic in `NODE_ENV=development`).
- **`HYDRA_PROVISION_VERBOSE=1`** — step-level stderr during Playwright provision (URL/title after `goto`, whether the **Create** control matched, after name+submit). Redundant in **`NODE_ENV=development`** (step logs default on).
- **Operator one-liner (max noise):** `HYDRA_PROVISION_DEBUG=1 HYDRA_PROVISION_VERBOSE=1 npm run server` (or your process manager) while reproducing a failed provision.
- **Standalone capture without Hydra:** `node scripts/capture-mgmt-key-network.mjs` with **`HYDRA_CAPTURE_OR_SESSION`** (and optional **`HYDRA_CAPTURE_OR_CLIENT`**). See **`docs/recon/TRPC_ROUTES.md`** → *Management keys — captured network*.
- **422 `PROVISION_FAILED`** — dashboard session is **not usable** (HTTP **401/403/423/429** or HTML auth gate), not generic tRPC business errors; see response `source`.
- **500** when no **`sk-or-v1-…`** was captured after Server Action, tRPC, REST, and browser UI automation — response JSON includes **`code`:** **`PROVISION_KEY_NOT_CAPTURED`**, **`legacyCode`:** **`PROVISION_PLAYWRIGHT_EXTRACT`** (historical alias for older clients), **`hint`**, **`details`** (redacted: `stage` e.g. **`browser_ui`**, `phasesTried`, `trpcLastRoute`, `trpcLastError`, optional dashboard mutation fields, `createClicked`, `connectMode` `launch` \| `cdp`, `pageUrlAtFailure`, `debugDir`), and **`debugDir`**. Message may still contain historical “HTTP (tRPC) and browser UI automation” wording. Use steps above.

**Session gate:** Provisioning calls **`ensureSession`** before Server Action, tRPC, REST, and Playwright. That helper uses the stored realistic **`config.sessionExpiry`** when present, refreshes via **`__client`** when needed, and only writes a derived fallback expiry for legacy rows that had a usable session but no stored expiry. Details: **`docs/ARCHITECTURE_DEEP_DIVE.md`** (*ensureSession and persistent sessionExpiry*).

## Mitigation backlog (H1–H10)

Delivery-oriented checklist aligned with `server/services/dashboard-api.js` — try order in code is roughly **H8 → H10 → H7 → DOM/extraction → H2 → H1** (see `createManagementKey` / `createManagementKeyViaPlaywright`).

| ID | Angle | What Hydra does |
|----|--------|------------------|
| H1 | Headless / bot friction | `playwrightProvisionLaunchOptions`: `--disable-blink-features=AutomationControlled`, optional **`HYDRA_PLAYWRIGHT_CHANNEL=chrome`** (system Chrome), optional **`HYDRA_PLAYWRIGHT_CDP_ENDPOINT`** (`connectOverCDP` to your Chrome) |
| H2 | Incomplete cookies | `__session` + `openRouterPlaywrightDeviceCookies` on `OR_HOSTNAME`; re-login if upstream 403 |
| H3 | Key not in `response.text()` shape | `waitForResponse` consumes body once (network log does **not** read bodies) |
| H4 | Key only in DOM | `getByText`, `code`/`pre`, `innerText`, input `.value` scan |
| H5 | iframe | Child `frame` `innerText` scan for `sk-or-v1-` |
| H6 | Clipboard-only | `grantPermissions` + copy/reveal controls |
| H7 | Double body read | Only `waitForResponse` predicate calls `response.text()` for tRPC POSTs |
| H8 | Wrong `OR_BASE` | `logProvisionOpenRouterBase` + hostname warning |
| H9 | Unicode | `String.normalize('NFC')` before regex in extractors |
| H10 | Business error masked | `parseTrpcRedeemHttpBody` on error-shaped responses → appended to final throw |

## Implementation checklist (spec ↔ `dashboard-api.js`)

Use this to confirm the OpenRouter **Create / Name / Save** automation and provision policy are wired:

| Requirement | Where in code |
|-------------|----------------|
| Toolbar opens flow with **Create** first | `clickFirstVisibleCreateControl` — prefers **`main` / `[role="main"]`** exact **Create**, then `roleCandidates` starting with **`/^create$/i`** |
| Scope Name/Save to active HeadlessUI modal | `managementDialog` + `fillManagementKeyNameAndSubmit` uses `#headlessui-portal-root [role="dialog"]` (falls back to page if no dialog) |
| Fill **Name** via a11y | `fillManagementKeyNameAndSubmit` — **`getByRole('textbox', { name: /^name$/i })`**, then placeholders including **`Management Key`** |
| Submit with **Save**, not toolbar **Create** | **`getByRole('button', { name: /^save$/i })`** first within modal scope; CSS fallback order ends with **`Create`** |
| Tolerate overlay pointer interception | `fillManagementKeyNameAndSubmit` retries submit with Playwright **`click({ force: true })`** fallback |
| Register `waitForResponse` **before** Create + fill | `createManagementKeyViaPlaywright` — `goto` + `networkidle`, then start the POST listener, then **Create** → **Name** → **Save** (avoids missing early mutations) |
| Accept tRPC / RSC POST when response body contains the key | `waitForResponse` — if **`extractManagementKeyFromResponseBody`** finds **`sk-or-v1-`**, the match is accepted (no longer gated on **keyName** appearing in `postData`, which breaks batched/encoded bodies). Deep JSON walk for nested key fields. |
| Persist route **outside** response predicate | `discoveredRouteFromWait` → **`saveDiscoveredEndpoints`** after **`await trpcKeyWait`** |
| Abort **provision** only on auth-like HTTP | **`shouldAbortProvisioning`** on cached + candidate **`catch`** (not **`isPermanentError`** for every tRPC code) |
| Extract key from response then DOM | Regex on tRPC body → **`getByText(MGMT_KEY_RE)`** wait → **`code`/`pre`** → **`body` textContent** → input value scan |
| API contract for operators | **`docs/API_REFERENCE.md`** — `POST /api/accounts/:id/provision` (**422** = session dead, not all tRPC failures) |

## Related code

- `server/services/dashboard-api.js` — `createManagementKey`, `createManagementKeyViaPlaywright`
- `server/controllers/AccountController.js` — `provision` (422 on inner `success: false`)
- `docs/API_REFERENCE.md` — `POST /api/accounts/:id/provision`

## OpenRouter UI reference (verified 2026-04-02)

On **Settings → Management keys**, the flow is: **Create** → fill **Name** → **Save**. Playwright should not use a generic `button:has-text("Create")` as the submit control when **Save** is the commit action. See **`docs/recon/TRPC_ROUTES.md`** (*Live dashboard UI*) for the accessibility snapshot table.

Provisioning over tRPC only aborts early on **auth/session HTTP failures** (`401` / `403` / `423` / `429` or HTML login pages); other tRPC errors still fall through to candidate routes and then headless Playwright.

## Live verification (mandatory gate)

Automated tests and lint **do not** prove provisioning. A change or release candidate is only validated when this passes against a **real** vault account with a **working OpenRouter dashboard session**.

### Prerequisites

1. Hydra API running (e.g. `http://localhost:3001`).
2. **Hydra JWT** after unlocking the vault (same token the UI uses for `/api/*`).
3. **Account id** (`uuid`) for an account that has **`sessionCookie`** (and device cookies as stored) for OpenRouter — use **`GET /api/accounts`** or the UI.

### Provision (curl)

Replace `ACCOUNT_ID` and `TOKEN`:

```bash
export HYDRA_JWT='paste-hydra-jwt-here'
curl -sS -X POST "http://localhost:3001/api/accounts/ACCOUNT_ID/provision" \
  -H "Authorization: Bearer $HYDRA_JWT" \
  -H "Content-Type: application/json" \
  -d '{"keyName":"Live verify"}'
```

### Success signal

- **HTTP 200** and JSON **`data.key`** (or equivalent) containing **`sk-or-v1-…`**, **or** subsequent **`GET /api/accounts/:id/snapshot`** (or account detail) shows a stored management key.
- **422** **`PROVISION_FAILED`** means dashboard session is dead — re-authenticate in Hydra, then retry.

### Repeatability (“best” path)

Run the **same** `curl` **twice** on the same account (you may use distinct `keyName` values if the UI creates a new key each time). **Both** must succeed to treat the current codepath as **reliable**. If **direct tRPC** (`source` like `trpc-…`) and **Playwright** both work, prefer **tRPC-first** for operations; keep Playwright as fallback.

### Debug env (optional)

| Variable | Use |
|----------|-----|
| `HYDRA_PROVISION_DEBUG=1` | Traces, screenshots on failure under `$TMPDIR/hydra-provision-debug/` |
| `HYDRA_PROVISION_VERBOSE=1` | Step stderr (URL, Create matched, after submit) |
| `HYDRA_PROVISION_NETWORK_LOG=1` | POST URL/status/postData log (no response bodies) |
| `HYDRA_PLAYWRIGHT_HEADED=1` | Visible browser |
| `HYDRA_PLAYWRIGHT_CHANNEL=chrome` | System Chrome instead of bundled Chromium |
| `HYDRA_PLAYWRIGHT_CDP_ENDPOINT` | e.g. `http://127.0.0.1:9222` — attach to your Chrome (`connectOverCDP`) |
| `HYDRA_PROVISION_SERVER_ACTION_REPLAY=1` | Reserved compatibility flag; current code attempts Server Action replay first regardless |
| `HYDRA_MGMT_KEY_SERVER_ACTION_ID` | Optional Next.js Server Action ID override for create (capture with `scripts/capture-mgmt-key-network.mjs`) |

## H1–H10 live checklist (one angle per row)

Use this when isolating failures. **PASS** for a row means: live provision **and** `sk-or-v1-…` returned/stored **while** the “watch for” signal matches that angle (e.g. H10: tRPC business message appears in the thrown error).

| ID | Hypothesis (why it fails) | Maximize / what to set | Watch for (PASS evidence) |
|----|---------------------------|-------------------------|-----------------------------|
| H1 | Headless bot friction | `HYDRA_PLAYWRIGHT_CHANNEL=chrome`, `HYDRA_PLAYWRIGHT_CDP_ENDPOINT`, or `HYDRA_PLAYWRIGHT_HEADED=1` | Verbose steps complete; no **`PROVISION_KEY_NOT_CAPTURED`** (legacy **`PROVISION_PLAYWRIGHT_EXTRACT`**) without a prior session **422** |
| H2 | Bad or incomplete cookies | Re-login in Hydra; ensure `__session` + device cookies on `OR_HOSTNAME` | Not **422** `PROVISION_FAILED` with session-dead `source`; upstream allows key extraction |
| H3 | Response body consumed twice | Keep `HYDRA_PROVISION_NETWORK_LOG` on (it must not read bodies) | Key found in `waitForResponse` path; no empty second read |
| H4 | Key only in DOM | `HYDRA_PROVISION_VERBOSE=1` | Regex/DOM ladder finds `sk-or-v1-` after tRPC miss |
| H5 | Key in iframe | Same as H4 + traces | Child `frame` scan finds key in stderr path “iframe” / frame iteration |
| H6 | Clipboard-only reveal | Headed often helps | `grantPermissions` + copy/reveal path; clipboard read succeeds |
| H7 | Double body read bug | Do not add code that reads `response.text()` outside the waiter | Single consumer of body in waiter predicate |
| H8 | Wrong `OR_BASE` / host | Check `logProvisionOpenRouterBase` stderr | Hostname warning **absent**; `OR_BASE` is `https://openrouter.ai` (or expected www) |
| H9 | Unicode normalization | Rare | NFC-normalized match succeeds in logs |
| H10 | tRPC business error hidden | Inspect **500** message | Message includes tRPC error text from `parseTrpcRedeemHttpBody` (not generic only) |

## Verification log (operator)

| Date | Operator | Account | Result | Notes |
|------|------------|-----------|--------|--------|
| _Pending_ | | | | Run live curl twice; record HTTP status, `source`, and whether `sk-or-v1-` persisted. |

If **all** live attempts fail after session refresh, capture **`HYDRA_PROVISION_DEBUG=1`** artifacts, update **`docs/recon/TRPC_ROUTES.md`** from DevTools / `scripts/capture-mgmt-key-network.mjs`, and escalate with OpenRouter (product/API) with redacted logs.
