# Hydra API Reference

This document is the exact route catalog for the local Hydra server.

## Base URLs

- Local API: `http://localhost:3001/api`
- OpenAI-compatible proxy: `http://localhost:3001/v1`

## Authentication Model

- Most `/api/*` routes require a local Hydra JWT in `Authorization: Bearer <token>`.
- `GET /api/auth/status` and `POST /api/auth/nuke` are public.
- `GET /api/pool/status` is public for liveness checks.
- `POST /api/webhooks/clerk` is public for Clerk/Svix delivery.
- The proxy under `/v1/*` does not use the local JWT. It requires a derived proxy key in `Authorization: Bearer sk-hydra-...`.

## Standard Response Shape

Most controller routes return the `BaseController` JSON envelope:

```json
{
  "success": true,
  "data": {},
  "timestamp": "2026-04-01T12:00:00.000Z"
}
```

Errors typically return:

```json
{
  "success": false,
  "error": "Human readable message",
  "code": "INTERNAL_ERROR",
  "timestamp": "2026-04-01T12:00:00.000Z"
}
```

When **`CLERK_DEBUG_OTP=1`** is set in the server environment, Clerk-related failures from **`AccountController`** (e.g. **`POST /api/accounts/:id/login`**, **`otp/start`**, **`otp/verify`**, **`detect-auth`**, **`refresh`**) may also include:

```json
{
  "clerkDebugOtp": true,
  "clerkDebugHint": "Clerk trace is on (CLERK_DEBUG_OTP=1). In the terminal running the API, search for lines starting with [CLERK_DEBUG_OTP] right after this request."
}
```

The browser client merges **`clerkDebugHint`** into the displayed error string via **`formatApiErrorMessage`** in **`src/api.js`** (used by **`LoginAccountModal`** and **`BulkAuthWizard`**).

The `/v1/*` proxy uses OpenAI-style error objects instead.

## Frontend API client (`src/api.js`)

This is **not** an HTTP surface on the server; it is the browser helper every page uses for `fetch` to `/api/*`. Documented here so agent and human readers know the **client-side** contract.

- **Transport:** `fetch` to relative paths under `/api` (dev: Vite proxies `/api` → `http://localhost:3001`; production: same origin).
- **Constants (for copy UX):** `HYDRA_DEV_START_COMMAND` (`'npm run dev'`), `HYDRA_DEV_API_ONLY_COMMAND` (`'npm run server'`).
- **Network failure in development** (`import.meta.env.DEV`, e.g. Express not running): `request()` throws `Error` with a dev-specific message and may set **`err.hydraCopyCommand`** to `HYDRA_DEV_START_COMMAND`. Callers that show API errors (e.g. `BulkAuthWizard`) can forward this to [`DevBackendHint`](../src/components/DevBackendHint.jsx) for a **Copy command** button. **No** `hydraCopyCommand` in production builds for this path.
- **401 handling:** Non-auth paths clear the JWT and reload once; `/auth/*` paths surface JSON `error` without reload.
- **Clerk debug (optional):** If the JSON body includes **`clerkDebugOtp`** and **`clerkDebugHint`**, **`request()`** attaches **`err.clerkDebugHint`**; use **`formatApiErrorMessage(err)`** for full inline copy in modals and wizards.

See also **Startup Model** and **Development: backend-down UX** in [`ARCHITECTURE_DEEP_DIVE.md`](ARCHITECTURE_DEEP_DIVE.md).

## Auth Routes

Implemented in `server/routes/auth.js` and `server/controllers/AuthController.js`.

| Method | Route | Auth | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/auth/status` | Public | Check whether setup is complete, whether the current token is valid, and whether a restart is required | Returns `setup`, `authenticated`, `error`, `needsRestart` |
| `POST` | `/api/auth/setup` | Public | Create the initial local admin password | Body: `{ password }` |
| `POST` | `/api/auth/login` | Public | Log into the local dashboard and receive a JWT | Body: `{ password }` |
| `POST` | `/api/auth/logout` | JWT | Stateless logout | Frontend deletes its stored token |
| `POST` | `/api/auth/change-password` | JWT | Change the local admin password | Body: `{ currentPassword, newPassword }` |
| `POST` | `/api/auth/nuke` | Public | Wipe the local vault and data directory | Marks the app as restart required |

## System Route

Implemented in `server/index.js`.

| Method | Route | Auth | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/shutdown` | JWT | Shut down the local Hydra server | Used by the UI when the user intentionally stops the server |

## Account Routes

Implemented in `server/routes/accounts.js` and `server/controllers/AccountController.js`.

| Method | Route | Auth | Purpose | Body / Behavior |
| --- | --- | --- | --- | --- |
| `GET` | `/api/accounts` | JWT | List local account records | Returns account summaries from the encrypted local vault. Each row includes `passwordOnFile` (boolean): whether a password is stored; OTP-only rows have `false` so the UI can default to email OTP. **`sessionStatus`** uses the same semantics as **`GET /api/dashboard`** and **`GET /api/accounts/:id/session-status`** (see [DASHBOARD_ACCOUNT_STATES.md](DASHBOARD_ACCOUNT_STATES.md)). **`sessionDecryptFailed`** (boolean) is true when the encrypted **`sessionToken`** blob could not be decrypted (e.g. rotated local secrets)—distinct from **`none`**. |
| `POST` | `/api/accounts` | JWT | Add an account by management key | Body: `{ alias, managementKey }` |
| `POST` | `/api/accounts/with-credentials` | JWT | Add an account with email/password or OAuth-style credentials | Body: `{ alias, email, password, authMethod }` |
| `POST` | `/api/accounts/bulk` | JWT | Bulk import multiple accounts | Body: `{ lines }`, where each line may be `alias:email:password`, `email:password`, or a raw session cookie line |
| `POST` | `/api/accounts/bulk-otp-stubs` | JWT | Create OTP-only vault rows from emails only | Body: `{ emails: string[] }` (max 150, trimmed/lowercased). Sequential insert; no Clerk calls. Response `data`: `{ results: [{ email, success, account?, error?, skipped? }] }` — use before per-account `otp/start` + `otp/verify`. **Operator UI:** React route `/bulk-auth` (`src/pages/BulkAuthWizard.jsx`). |
| `POST` | `/api/accounts/:id/detect-auth` | JWT | Ask Clerk which auth strategies are available for the account email | Used before password/OTP fallback flows. When persisting the returned Clerk **`clientCookie`**, if the vault already has **`__session`** but **`sessionExpiry` was never stored**, the server backfills **`sessionExpiry`** from **`getJwtExpiry(sessionCookie)`** (same JWT rules as login)—**no response body change**. |
| `POST` | `/api/accounts/:id/login` | JWT | Log into the account with password | Uses stored password if omitted in body. **202** when Clerk requires a second factor: JSON `{ success, requiresTwoFactor, signInId }` and persists `__client` for the in-progress sign-in. Clients should treat 202 as “not logged in yet” and collect TOTP. |
| `POST` | `/api/accounts/:id/otp/start` | JWT | Start an email OTP sign-in flow | Body: `{ email }` optional; falls back to stored email. Persists Clerk **`clientCookie`** from the flow with **`store.updateAccountSession(..., { preserveSessionToken: true })`** so an existing vault **`__session`** JWT is **not** cleared until **`otp/verify`** succeeds (or another flow explicitly overwrites it). |
| `POST` | `/api/accounts/:id/otp/verify` | JWT | Finish email OTP or TOTP second factor | Body: `{ signInId, code }`; optional `{ totpSecondFactor: true }` to call Clerk `attempt_second_factor` (authenticator) after password login instead of `email_code`. Server-side Clerk session resolution (not a route change): see **`ARCHITECTURE_DEEP_DIVE.md`** — embedded JWT extraction, optional **`POST …/client/sessions/{id}/touch`**, retried **`GET /client`**. |
| `POST` | `/api/accounts/:id/provision` | JWT | Create a management key for one account | Body: `{ keyName? }`. Success: `data`: `{ key, source }` (`source` is e.g. `trpc-cached`, `trpc-…`, `playwright`, or future `server-action-replay`). **Release validation:** run live `curl` twice per **MANAGEMENT_KEY_PROVISION_AUTOMATION.md** → *Live verification (mandatory gate)*. **Secret handling:** tRPC JSON or server Playwright only — not IDE clipboard. **422** `PROVISION_FAILED` when the dashboard session is unusable (**HTTP 401/403/423/429** or HTML auth gate). When tRPC and Playwright both fail to capture **`sk-or-mgmt-…`**, **500** with **`code`:** **`PROVISION_KEY_NOT_CAPTURED`**, **`legacyCode`:** **`PROVISION_PLAYWRIGHT_EXTRACT`** (for older clients), **`hint`**, optional **`details`** (redacted: `stage`, `trpcLastError`, `trpcBusinessMessage` / codes, `createClicked`, `fallbacksExhausted`, `connectMode` `launch` \| `cdp`, `debugDir`), **`debugDir`**, and message often `Could not extract management key via Playwright` plus optional in-browser tRPC error text. Env: **`OR_BASE`**, **`HYDRA_PLAYWRIGHT_HEADED`**, **`HYDRA_PLAYWRIGHT_CHANNEL`**, **`HYDRA_PLAYWRIGHT_CDP_ENDPOINT`**, **`HYDRA_PROVISION_DEBUG`**, **`HYDRA_PROVISION_VERBOSE`**, **`HYDRA_PROVISION_NETWORK_LOG`**, **`HYDRA_PROVISION_SERVER_ACTION_REPLAY`** (stub; see **`.env.example`** and **MANAGEMENT_KEY_PROVISION_AUTOMATION.md**). |
| `POST` | `/api/accounts/provision-all` | JWT | Create management keys for accounts that can re-auth without UI | Body: none. Response `data`: `{ results, skipped }` — `results` are provision outcomes for accounts with a stored session cookie or password re-auth; `skipped` lists email-only / OTP rows with no session and no stored password (authenticate in Hydra first) |
| `POST` | `/api/accounts/:id/refresh` | JWT | Refresh the stored Clerk session | Uses the stored device cookie jar (`__client` / related); server **`GET`** Clerk **`/v1/client`** with the same JWT extraction path as post-login fallback, including **up to three** attempts with short backoff (see **`ARCHITECTURE_DEEP_DIVE.md`** — **`ensureSession` / refresh**). |
| `GET` | `/api/accounts/:id/session-status` | JWT | Report whether the stored session is active, expiring, expired, etc. | JSON includes **`status`**, **`sessionExpiry`**, and **`sessionDecryptFailed`** (boolean). **`status`** is one of **`active`**, **`expiring`**, **`expired`**, **`none`**, **`error`** (decrypt failure on **`sessionToken`** — see [DASHBOARD_ACCOUNT_STATES.md](DASHBOARD_ACCOUNT_STATES.md)). Does not throw on unreadable session blobs. Successful Clerk logins persist **`sessionExpiry`** (JWT **`exp`** or 24-hour fallback). Session-backed actions (**provision**, **redeem**, etc.) run **`ensureSession`** first, which may **backfill** a missing **`sessionExpiry`** from the stored JWT when the cookie is still valid—see **`ARCHITECTURE_DEEP_DIVE.md`**. |
| `PATCH` | `/api/accounts/:id` | JWT | Update alias, management key, or attach sign-in credentials | Body (all optional, merge into encrypted vault config): `alias`, `managementKey`, credentials. **`managementKey`:** Zod requires non-empty after trim; **`assertManagementKey`** does not enforce a prefix (see **`server/services/key-utils.js`**); **`openrouter.getCredits()`** is the authority — **400** if OpenRouter rejects the key. **UI:** Key Manager **`PasteManagementKeyModal`** (`src/components/PasteManagementKeyModal.jsx`) additionally requires a client-side **`sk-or-`** prefix so operators do not paste unrelated strings; that is **not** duplicated as format validation on the server beyond non-empty + live probe. **Credentials:** `email`, `password`, `authMethod` (`password` \| `otp`) — same rules as **`POST /api/accounts/with-credentials`**: do not send `password` without `email`; for password sign-in include a non-empty `password` with `authMethod: 'password'` (or omit `authMethod` when password is sent); OTP-only attach may use `email` with empty/absent password and `authMethod: 'otp'`. Changing `email` enforces uniqueness for the authenticated user **excluding this account** (**409** if another vault row already uses that email). Other stored fields (e.g. existing session, management key) are preserved unless overwritten by the patch. |
| `DELETE` | `/api/accounts/:id` | JWT | Delete the account from the local vault | Does not affect the upstream OpenRouter account |
| `GET` | `/api/accounts/:id/snapshot` | JWT | Fetch a fresh account snapshot | Returns balance + key counts from OpenRouter |

### OTP / Clerk error messages (server)

Thrown from `server/services/clerk-auth.js` and surfaced via `AccountController` as HTTP **500** (or validation **400** for bad body). Useful for support and debugging:

| Message (prefix) | Meaning |
| --- | --- |
| `OTP error: …` | Clerk returned `errors[]` on `attempt_first_factor` (wrong code, expired, etc.). |
| `Sign-in incomplete after OTP: Clerk returned no sign_in object.` | Response JSON had no `response` / `client.sign_in`. |
| `Sign-in incomplete after OTP: status=…` | `sign_in` present but `status` is not `complete` (e.g. still `needs_first_factor`). |
| `Clerk sign-in completed after OTP but no __session was returned …` | `complete` but no `__session` after full server resolution (embedded JWT, optional touch, retried **`GET /client`**). Set **`CLERK_DEBUG_OTP=1`**, confirm **`npm`** is run from the **repo root**, and see **`.env.example`** for **`CLERK_ORIGIN`** / **`CLERK_REFERER`**; operator check **`npm run check:clerk`**. |
| `2FA error: …` / `2FA complete but no session cookie or embedded JWT` | TOTP second factor path (`completeSecondFactor`) after touch + embedded JWT + retried **`GET /client`** could not produce **`__session`**. |
| `2FA incomplete: status=…` | TOTP **`attempt_second_factor`** returned a sign-in that is not **`complete`**. |
| `Sign-in incomplete: status=…` | Password first factor not complete and not `needs_second_factor`. |
| `No __session cookie returned` | Password flow reached **`complete`** but session resolution (embedded JWT, optional **`sessions/.../touch`**, retried **`GET /client`**) failed. |

**Smoke test:** with the API running from the project directory, `npm run test:otp-smoke` mints a local JWT, lists accounts, and calls `otp/start`. Optional **`HYDRA_OTP_CODE`** env (digits from the email) also runs **`otp/verify`** end-to-end.

## Key Routes

Implemented in `server/routes/keys.js` and `server/controllers/KeyController.js`.

| Method | Route | Auth | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/accounts/:accountId/keys` | JWT | List OpenRouter keys for an account | Requires a valid management key. Response merges live upstream metadata with the local vault: each key may include **`hasKeyString`** (whether an encrypted `sk-or-v1-…` is stored) and **`plaintextKey`** when present (same semantics as Pool Manager — local vault only). |
| `POST` | `/api/accounts/:accountId/keys` | JWT | Create a new OpenRouter key | Saves the raw key string locally after creation |
| `PATCH` | `/api/accounts/:accountId/keys/:hash` | JWT | Update a specific OpenRouter key | Supports name, disabled, and limit fields |
| `DELETE` | `/api/accounts/:accountId/keys/:hash` | JWT | Delete a specific OpenRouter key | Uses the management API upstream |

## Dashboard Routes

Implemented in `server/routes/dashboard.js` and `server/controllers/DashboardController.js`.

| Method | Route | Auth | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/dashboard` | JWT | Return aggregated account snapshots and totals | Staggers upstream requests to avoid bursts. Before snapshots, may **refresh** Clerk sessions for rows whose vault **`sessionStatus`** is **`expiring`** when a non-empty **`clientCookie`** exists (`clerkAuth.refreshSession` → persist new **`sessionToken`** / expiry if Clerk returns a session). Each item in `data.accounts` merges OpenRouter snapshot fields with vault metadata: `email`, `authMethod`, `passwordOnFile`, `sessionStatus` (`active` \| `expiring` \| `expired` \| `none` \| `error`), **`sessionDecryptFailed`** (boolean), `hasManagementKey`, `hasCredentials`. **`unknown`** is not produced for accounts that have a stored session token without expiry; that vault shape is reported as **`active`** (see **Session expiry** in [ARCHITECTURE_DEEP_DIVE.md](ARCHITECTURE_DEEP_DIVE.md)). Effective session timing uses **`min(JWT exp, config.sessionExpiry)`** where both exist (`store.resolveEffectiveSessionExpiry`). **`isSessionValid`** in **`clerk-auth.js`** uses the same **10-minute** “expiring soon” window as **`getSessionStatus`**. **Dashboard card status badges** (e.g. SYNCED, NEEDS KEY, SIGN IN, SESSION UNREADABLE) are **client-derived** — see [DASHBOARD_ACCOUNT_STATES.md](DASHBOARD_ACCOUNT_STATES.md). |
| `POST` | `/api/dashboard/refresh` | JWT | Force a new dashboard aggregation | Alias of the GET flow |

## Code Redemption Routes

Implemented in `server/routes/codes.js` and `server/controllers/CodeController.js`.

**Session vs management key:** Code redemption calls OpenRouter’s **dashboard** tRPC (e.g. `credits.redeemCode`) using per-account **Clerk session cookies** (`__session` / `__client_uat`), after `ensureSession()` in `server/services/dashboard-api.js`. The **management API key** is not used for the redeem **request** and cannot substitute for a dashboard session. If the account has a management key stored in Hydra, the **Playwright fallback** may poll `GET /api/v1/credits` (management API) before and after submit to detect an increase in **`total_credits`** when UI copy is ambiguous—this only **verifies** outcome; it does not perform redemption.

**tRPC `Referer`:** Redeem mutations send `Referer: https://openrouter.ai/redeem` (not the management-keys page) so batch requests are less likely to be answered as HTML by the Next.js app shell.

**Playwright fallback:** Loads `https://openrouter.ai/redeem` first and drives the live form (`textbox` name **Promo Code**, button **Redeem Code**). If that surface is missing, it falls back to **Settings → Billing/Credits** and the older modal-style selectors. After each submit, Hydra **waits for** a matching **`POST /api/trpc/*`** response whose body references the code, **parses** the tRPC batch JSON (same semantics as server-side `trpcCall`), and classifies success vs error without relying on fixed success toast copy. If that response is missing or non-JSON, it applies **failure-first** checks on dialog/body text, then **credits total** polling (when a management key exists), then legacy **success phrase** regex. **Modal/toast text** is always collected when possible into **`uiFeedback`** (truncated) for operators, especially on `REDEEM_OUTCOME_UNKNOWN`. The logged-in dashboard may submit redemption via **POST `/redeem`** (Next.js Server Actions) in the browser; Hydra still prefers **tRPC replay** when a procedure succeeds, and uses Playwright against `/redeem` when tRPC does not.

**tRPC vs browser:** **tRPC** is faster, cheaper, and better for bulk operations. **Playwright** is heavier and reserved for fallback and for **discovery** (finding procedure names, `Referer`, selectors). See the comparison table in [docs/recon/TRPC_ROUTES.md](recon/TRPC_ROUTES.md#redeem-trpc-vs-browser-automation-compare--contrast).

**Server redeem pipeline (`redeemCode` in `server/services/dashboard-api.js`):** No Hydra route changes—this is service logic only.

1. **`ensureSession(userId, accountId)`** — If this throws, `CodeController.redeem` may respond with **`REDEEM_SESSION`** (401) or **`INTERNAL_ERROR`** after `classifyRedeemFailure`; bulk/matrix catch blocks attach `errorCode` per row.
2. **Cached tRPC route** — If `getDiscoveredEndpoints().redeemCode` exists, `trpcCall(route, { code }, …, REDEEM_TRPC_HEADERS)` with **`Referer: https://openrouter.ai/redeem`**. Success → `{ success: true, result, source: 'trpc-cached' }`. On **permanent** upstream errors (`isPermanentError`: e.g. 401/403/423/429, or tRPC code other than **-32601** method-not-found), return **`redeemFailurePayload`** (classified `errorCode`) immediately; transient / wrong-shape failures fall through.
3. **Procedure candidate list** (fixed order): `credits.redeemCode`, `credits.redeem`, `credits.applyCode`, `voucher.redeem`, `code.redeem`, `promo.redeem`, `account.redeem` — same headers. First JSON success **persists** the working `route` under `redeemCode`. First **permanent** error returns failure and still records the route for debugging.
4. **`redeemCodeViaPlaywright`** — Only if steps 2–3 do not succeed without exhausting candidates.

**OpenRouter wire (external):** Redeem traffic targets **`POST https://openrouter.ai/api/trpc/{procedure}?batch=1`** (and the live site may also use **`POST /redeem`** for Server Actions in the browser). Hydra’s **replay** path does not call **`POST /redeem`** directly; Playwright drives the real UI, which may trigger either.

**tRPC route discovery (persisted, not a user-facing route):** `store.saveDiscoveredEndpoints({ redeemCode: { route, discoveredAt, lastUsed? } })` is updated when: a candidate or cached `trpcCall` succeeds; Playwright’s **`page.on('response')`** sees a matching **`POST /api/trpc/`** with the promo code in the request body; or a **`waitForResponse`** capture is parsed successfully. `GET /api/codes/endpoints` exposes this cache to the SPA.

**Playwright outcome order (`resolvePlaywrightRedeemOutcome`)** — Success is **not** defined as “anything that isn’t a known failure”; ambiguous states stay **`REDEEM_OUTCOME_UNKNOWN`** with **`uiFeedback`**.

1. **Browser tRPC response** — If the awaited **`POST /api/trpc/*`** response body parses as tRPC batch/single JSON (same rules as `trpcCall`): **`result` without `error`** → `success: true`, `verification: 'trpc_browser'`, optional `result` payload; **`error`** → `redeemFailurePayload` / **`classifyRedeemFailure`** (e.g. **`REDEEM_PROMO_INVALID`**).
2. **Failure-first UI text** — Scoped to dialog then full `body`: regex **`REDEEM_FAILURE_UI_RE`** or **`messageLooksLikeInvalidPromo`** → **`REDEEM_PROMO_INVALID`** (generic message; full copy in **`uiFeedback`** when collected).
3. **Credits total poll** — If the account has a **management key**, compare **`GET /api/v1/credits`** **`total`** (or equivalent **`total_credits`**) after **~1s** then up to **4** polls **~900ms** apart; increase → `success: true`, `verification: 'credits_total'`, `creditsBefore` / `creditsAfter`.
4. **Legacy success phrase** — **`REDEEM_SUCCESS_UI_RE`** on scoped text → `success: true`, `verification: 'ui_text'`.
5. **Else** — `success: false`, **`REDEEM_OUTCOME_UNKNOWN`**, message lists surfaces tried; **`uiFeedback`** from dialog + **`[data-sonner-toast]`** (truncated to **500** chars).

**`classifyRedeemFailure(message, err)`** (same module) maps throws and synthetic errors to **`errorCode`**: **429** → rate limit; **401/403** / HTML auth gate / session+login wording / **2FA** wording → session; **`messageLooksLikeInvalidPromo`** or **BAD_REQUEST** / **-32602** / **400** → **`REDEEM_PROMO_INVALID`**; “Could not find redeem form” → **`REDEEM_FORM_UNAVAILABLE`**; “outcome unclear” → **`REDEEM_OUTCOME_UNKNOWN`**; default → **`REDEEM_UPSTREAM`**.

**`POST /api/codes/redeem` HTTP envelope:** On normal completion, `redeemCode` **returns an object** (either `success: true` or `success: false` with `errorCode`); **`CodeController.redeem`** responds **`200`** with `{ success: true, data: <that object> }`. **Thrown** errors only for Zod validation (**`VALIDATION_ERROR`**, 400), classified session failures (**`REDEEM_SESSION`**, 401), or other server faults (**`INTERNAL_ERROR`** / 500). Bulk/matrix cells mirror the same `errorCode` / optional **`uiFeedback`** / **`verification`** fields on each result row.

| Method | Route | Auth | Purpose | Body / Behavior |
| --- | --- | --- | --- | --- |
| `POST` | `/api/codes/redeem` | JWT | Redeem one code on one account | Body: `{ accountId, code }` |
| `POST` | `/api/codes/bulk` | JWT | Redeem one code across multiple accounts | Body: `{ accountIds, code }` — runs **sequentially** per account with that account’s session |
| `POST` | `/api/codes/bulk-matrix` | JWT | Redeem many codes across many accounts | Body: `{ assignments: [{ accountId, code }, ...] }` |
| `POST` | `/api/codes/preflight` | JWT | Check which accounts can redeem without interactive login | Body: `{ accountIds }`. Response `data`: `{ allReady, ready: [{ accountId, alias, detail }], blocked: [{ accountId, alias, message }] }`. Offline heuristic aligned with **`ensureSession`**: “valid session” uses **`sessionExpiry || getJwtExpiry(__session)`** when the DB expiry is missing; then refresh cookie, session that may re-validate, or stored password + **`authMethod === 'password'`** (see **`ARCHITECTURE_DEEP_DIVE.md`**). |
| `GET` | `/api/codes/endpoints` | JWT | Return the cached tRPC discovery map | Used to remember internal OpenRouter route names |

**Redeem response `errorCode` (Hydra, on `data` when `success: false`, or on bulk-matrix rows):**

| `errorCode` | Meaning |
| --- | --- |
| `REDEEM_PROMO_INVALID` | Upstream rejected the code (invalid, expired, already used, bad request on redeem procedure, or Playwright saw an invalid-code style message). |
| `REDEEM_SESSION` | Auth/session problem (401/403, expired session, 2FA required, etc.). |
| `REDEEM_RATE_LIMIT` | HTTP 429 from OpenRouter. |
| `REDEEM_FORM_UNAVAILABLE` | Playwright could not find a redeem form. |
| `REDEEM_OUTCOME_UNKNOWN` | Playwright submitted but could not confirm success (no tRPC JSON hit, no credits increase, no success phrase); see **`uiFeedback`** for raw UI text. |
| `REDEEM_UPSTREAM` | Other upstream or transport errors. |

Optional `trpcCode` on single-redeem `data` mirrors OpenRouter’s tRPC error code when present (e.g. JSON-RPC / tRPC string codes). `POST /api/codes/redeem` still returns **HTTP 200** with `{ success: true, data: { success: false, errorCode, message, ... } }` for business failures; **HTTP 4xx/5xx** with `{ code }` is used for validation (`VALIDATION_ERROR`), hard session failure before redeem (`REDEEM_SESSION`), or server errors.

**Playwright / bulk-matrix optional fields** (when `source` is `playwright` or verification is present):

| Field | Meaning |
| --- | --- |
| `verification` | `trpc_browser` — outcome from parsed browser tRPC response; `credits_total` — `total_credits` increased after redeem (management API); `ui_text` — legacy success phrase match on dialog/body. |
| `uiFeedback` | Truncated text from dialog and/or toast surfaces for debugging and unclear outcomes. |
| `creditsBefore` / `creditsAfter` | Snapshots from `GET /api/v1/credits` when verification used **`credits_total`**. |
| `result` | On success, same as tRPC path: upstream JSON payload from redeem (e.g. credits fields) when returned by the browser tRPC response. |

### Manual verification (code redemption)

1. Start Hydra (`npm run dev`), unlock the app, ensure at least one account has a dashboard session or password auth.
2. **Preflight:** `POST /api/codes/preflight` with `{ "accountIds": ["<id>"] }` — expect `allReady: true` for session/password accounts and `blocked` entries for management-key-only rows.
3. **Single redeem:** `POST /api/codes/redeem` with `{ accountId, code }` — expect success or upstream error, not “no session”.
4. **Bulk matrix:** From the Code Redeemer UI, select accounts and codes — Run should be disabled when preflight reports blocked accounts; after fixing sessions, matrix redeem should complete per cell.

## Generator Routes

Implemented in `server/routes/generator.js` and `server/controllers/GeneratorController.js`.

| Method | Route | Auth | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/generator/start` | JWT | Start a browser-automation signup job | Creates an in-memory Playwright job |
| `GET` | `/api/generator/status/:jobId` | JWT | Poll job status | Returns `status`, `error`, `account`, and metadata |
| `POST` | `/api/generator/verify/:jobId` | JWT | Submit the OTP for a paused job | Resumes Playwright and completes signup; when the job saves **`__session`**, **`config.sessionExpiry`** is set via **`getJwtExpiry`** (not left null). |
| `DELETE` | `/api/generator/:jobId` | JWT | Cancel and clean up a job | Closes browser resources and removes the job |

## Pool Routes

Implemented in `server/routes/pool.js` and `server/controllers/PoolController.js`.

| Method | Route | Auth | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/pool/status` | Public | Liveness/status probe for the proxy stack | Used by the Pool Manager UI |
| `GET` | `/api/pool` | JWT | Load all accounts, live key metadata, pool stats, and model-cache summary | Syncs live OpenRouter keys into the local DB. Response `data.modelCache` is `{ count, updatedAt }` (ISO string or `null`) from `CachedModel` for the UI |
| `GET` | `/api/pool/master-key` | JWT | Return the derived `sk-hydra-...` key and endpoint URL | Used by external clients and the Settings page |
| `GET` | `/api/pool/network` | JWT | Return LAN IPs and LAN proxy URLs | Helpful for Cursor/Cline and other LAN clients |
| `PATCH` | `/api/pool/key/:hash` | JWT | Toggle one key in or out of the pool | Reloads the in-memory rotation manager |
| `POST` | `/api/pool/account/:accountId/toggle` | JWT | Bulk-toggle all eligible keys for one account | Only affects keys with stored raw key strings |
| `POST` | `/api/pool/key/:hash/register` | JWT | Store a raw `sk-or-v1-...` string for a key record | Validates the key against OpenRouter first |
| `POST` | `/api/pool/reload` | JWT | Manually reload the in-memory key pool | Rebuilds rotation state from the DB |
| `POST` | `/api/pool/models/refresh` | JWT | Refresh the cached OpenRouter model list | Writes to `CachedModel` via `server/services/model-cache.js`. Uses a pooled key when available; if the pool is empty, uses the first stored standard (non-provisioning) key on the user’s vault so operators can warm the cache before pooling. Response `data.count` is rows upserted. Returns `400` only when no usable key exists |
| `GET` | `/api/pool/traffic` | JWT | Return the latest request logs and 24h metrics | Feeds the Traffic Console; see [Traffic dashboard](#traffic-dashboard) below |

### Traffic dashboard

`GET /api/pool/traffic` — success payload `data` includes:

- **`logs`** — Up to 100 newest `RequestLog` rows (`model`, `status`, `latencyMs`, `promptTokens`, `completionTokens`, `createdAt`, `keyHash`). When the related `Key` row still exists, each log includes `key.name` and `key.account.alias`.
- **`metrics`** — Counts of requests in the last 24 hours grouped by HTTP `status` (used for aggregate stats on the page).

The **Traffic Console** (`src/pages/Traffic.jsx`, route `/traffic`) renders each log in a table with columns: **Timestamp** (localized short date + medium time), **Status**, **Model** (ellipsis + `title` for full id), **Account** (alias, or archived/deleted fallback if the key is gone), **Key** (key name with an 8-character `keyHash` prefix as key id), **Latency**, **Tokens** (in/out or `stream` when counts are absent).

## Proxy Routes

Implemented in `server/routes/proxy.js`. These routes are **unchanged** by optional tools such as [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) or LiteLLM: Hydra still mounts **`/v1/*`** on the Express app (port **3001** by default). For architecture choices, sidecar ports, example third-party config, and borrowable patterns, see [`CLIPROXYAPI_GATEWAY_SYNTHESIS.md`](CLIPROXYAPI_GATEWAY_SYNTHESIS.md).

| Method | Route | Auth | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/models` | `sk-hydra-...` | Return a model list compatible with OpenAI clients | **Cache-first:** if `CachedModel` has rows, returns those (includes `id`, `object`, `created`, `owned_by`, and `name`). Otherwise fetches OpenRouter `GET {OR_BASE}/api/v1/models` with a pooled key, **write-through** upserts into `CachedModel`, and returns the upstream JSON. If that fails, returns a small static fallback. Response header **`X-Hydra-Models-Source`** is `cache`, `live`, or `static` |
| Any | `/v1/*` | `sk-hydra-...` | Forward OpenAI-style traffic to OpenRouter | Handles key rotation, failover, cooldowns, and request logging |

Proxy behavior worth knowing:

- `GET /v1/models` never uses your client’s pasted keys for catalog fetch; it uses Hydra’s pool (or static fallback). Pre-populate the cache from the Pool Manager (**Refresh Models**) or let the first cache-miss trigger a live fetch and write-through.
- **Key selection** (`rotation-manager.js`): among keys not in cooldown, Hydra picks the next key using **weighted random** selection by remaining balance (`limitRemaining`); if weighting fails, it falls back to **round-robin** among available keys.
- `429` upstream → **60 seconds** cooldown on that key, then retry with another key (up to **3** upstream attempts per client request).
- `402` upstream → **10 minutes** cooldown on that key. If retries exhaust and the last failure was `402`, the client receives **503** (treated as depleted / payment required upstream).
- `401` upstream → key is **evicted** from the pool (`disabled` / removed from rotation in DB); retries use other keys.
- The proxy logs successful and failed requests to `RequestLog`.
- The proxy may fall back to a different model if a supported model returns **5xx** (limited model-id patterns); see `server/routes/proxy.js`.
- Upstream calls use a **30s** abort timeout per attempt.

## Webhook Routes

Implemented in `server/routes/webhooks.js`.

| Method | Route | Auth | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/webhooks/clerk` | Public | Accept Clerk webhook delivery | Uses an idempotency table so duplicates are ignored |

## Internal Services Behind the API

These are not routes, but they are the logic the routes call:

- `server/services/auth.js` — local password auth, JWT signing, setup state, nuking, and token validation
- `server/services/store.js` — encrypted local persistence helpers
- `server/services/openrouter.js` — OpenRouter management API wrapper
- `server/services/dashboard-api.js` — OpenRouter dashboard tRPC / Playwright for session-backed actions (e.g. code redemption); **`ensureSession`** backfills/persists **`sessionExpiry`** from the JWT when needed; management REST calls live in `openrouter.js`
- `server/services/clerk-auth.js` — Clerk sign-in, OTP, refresh, session validation; **`getJwtExpiry`** is **exported** for any code that writes **`__session`** to the vault
- `server/services/account-generator.js` — Playwright signup workflow; persists JWT-derived **`sessionExpiry`** on new accounts
- `server/services/rotation-manager.js` — pooled key selection (**weighted by balance**, round-robin fallback), cooldowns (**429** = 60s, **402** = 10m), eviction, and status reporting
- `server/services/health-pinger.js` — background key health checks
- `server/services/request-log-retention.js` — log pruning
- `server/services/webhook-idempotency.js` — webhook deduplication

## Response Expectations

When you touch one of these routes, keep the response shape consistent with the existing controller envelope.

- Success responses should preserve `{ success: true, data, timestamp }`.
- Validation failures should return a clear message and a `400` where possible.
- Auth failures should be `401`.
- Proxy failures should stay OpenAI-compatible.

## Where The UI Calls These Routes

The frontend route wrappers live in `src/api.js`. The main consumers are:

- `src/pages/Dashboard.jsx`
- `src/pages/KeyManager.jsx`
- `src/pages/PoolManager.jsx` — React route **`/pool`**. Operator help for key strings and management vs standard keys is in the **About keys** header popover (not tied to a specific API); same semantics as **`POST /api/pool/key/:hash/register`** and pool eligibility described in [Architecture deep dive](ARCHITECTURE_DEEP_DIVE.md#5-sync-and-operate-the-pool).
- `src/pages/CodeRedemption.jsx`
- `src/pages/Generator.jsx`
- `src/pages/Settings.jsx`
- `src/pages/Traffic.jsx`
- `src/pages/BulkAuthWizard.jsx` (`/bulk-auth` — `bulkOtpStubs`, `getAccounts`, `startOTP`, `verifyOTP`, `provisionManagementKey`)

If a route changes, update:

1. The controller/service
2. `src/api.js`
3. The page that uses it (e.g. `CodeRedemption.jsx` uses `preflightRedeemAccounts` and `bulkMatrixRedeem`)
4. This document

