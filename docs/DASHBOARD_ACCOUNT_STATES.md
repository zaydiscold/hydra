# Dashboard account state (vault session vs management key vs UI)

This document describes how Hydra labels **OpenRouter accounts** on the **Dashboard** and how that relates to stored vault data and API responses.

## Two different credentials

1. **Management API key** — Stored in encrypted account config. Used for OpenRouter **management REST** calls (balances, list/create keys, etc.). Without it, `GET /api/dashboard` cannot fetch a snapshot for that row; the API returns `status: 'error'` and an error message such as “No management key — provision one first”.

2. **Dashboard (Clerk) session** — Session cookies in encrypted `sessionToken` (and optional legacy `config.sessionCookie`) plus optional `sessionExpiry` in config. Required for **session-backed** flows (e.g. provisioning a management key via the live dashboard, code redemption via tRPC). See **Code Redemption** in [API_REFERENCE.md](API_REFERENCE.md): the management key does **not** replace a dashboard session for those paths. If tRPC automation fails, Hydra may run **server-side** Playwright (local Chromium in the API process)—not the IDE’s Playwright MCP—to complete provisioning; see **ARCHITECTURE_DEEP_DIVE.md** (provision section).

## `sessionStatus` (server: `getSessionStatus` in `server/services/store.js`)

Computed for each account from encrypted **`sessionToken`** (and optional legacy **`config.sessionCookie`**) plus **`config.sessionExpiry`**, with decrypt failures surfaced separately.

| Value | Meaning |
| --- | --- |
| `none` | No non-empty session token in the vault (and no legacy **`config.sessionCookie`**). |
| `active` | A session token exists **and** either effective expiry is in the future, or expiry is missing / not a valid date (legacy row)—Hydra treats “token but no usable expiry” as **active** so the UI does not show a false “needs sign-in” after OTP. New logins set **`sessionExpiry`** from the Clerk JWT **`exp`** or a **24-hour** fallback (**`getJwtExpiry`** in **`server/services/clerk-auth.js`**). |
| `expiring` | Effective expiry is within the next **2.5 minutes** (still valid). Same window as **`SESSION_EXPIRING_SOON_MS`** in **`clerk-auth.js`**. Clerk JWTs expire quickly (~1-5 min) but sessions auto-refresh; this is a UI warning, not a failure. |
| `expired` | Effective expiry is in the past. |
| `error` | Decrypting **`sessionToken`** failed (**`sessionDecryptFailed: true`**). Distinct from **`none`** (no session vs unreadable blob). |

**`unknown`:** The current server does **not** return **`unknown`**. Older documentation described “token without **`sessionExpiry`**” as **`unknown`**; that case is now **`active`**. The client **`accountNeedsSession`** helper still treats **`unknown`** as needing attention when **`hasCredentials`** is true, for compatibility with any stale data or future API changes.

## `sessionDecryptFailed` and dashboard rows

**`GET /api/accounts`** and merged **`GET /api/dashboard`** account objects include **`sessionDecryptFailed`** when the AES blob for **`sessionToken`** cannot be decrypted (e.g. local secrets rotated). The UI should not treat this like **`none`**—use the **SESSION UNREADABLE** card state (**`accountDashboardCard.js`**) and a red session dot (**`error`**).

## Effective expiry: JWT vs stored `sessionExpiry`

**`store.resolveEffectiveSessionExpiry(config, sessionTokenPlain)`** returns **`min(JWT exp, config.sessionExpiry)`** when both are present (so a short-lived JWT cannot be masked by a long stored date). **`getSessionStatus`**, **`getAllAccountsNeedingRefresh`**, and **`dashboard-api.ensureSession`** / preflight paths use this (or equivalent) so the dashboard dot and **`ensureSession`** agree.

## Server-side session healing (`ensureSession`)

List/dashboard **`sessionStatus`** can show **`active`** when a token exists but **`config.sessionExpiry`** is missing (legacy row). **`isSessionValid(effectiveExpiry)`** checks if the JWT has not yet expired (any remaining time). The **`SESSION_EXPIRING_SOON_MS`** (2.5 min) threshold is for UI warnings only—sessions are usable until JWT actually expires.

**`server/services/dashboard-api.js`** **`ensureSession`** now:

- Derives validity from **`resolveEffectiveSessionExpiry`** + **`isSessionValid`** (see **`clerk-auth.js`**).
- **Writes** the derived ISO expiry via **`store.updateAccountSession`** when it was missing but the JWT is still valid (**backfill**).
- After **`validateSession`** (OpenRouter credits probe) succeeds, **always persists** **`getJwtExpiry(sessionCookie)`** so refresh failures do not leave an unbounded “no expiry” vault state.

**`POST /api/codes/preflight`** uses the same effective-expiry rule for its offline “session valid” check. No HTTP route shape changes—behavior is service-layer only. Full sequence: [ARCHITECTURE_DEEP_DIVE.md](ARCHITECTURE_DEEP_DIVE.md) (*ensureSession and persistent sessionExpiry*).

## When Hydra asks for a session (`accountNeedsSession`)

Implemented in `src/utils/accountSession.js`:

- **`error`** → needs session (vault session unreadable).
- `expired` or `none` → needs session.
- If `options.hasCredentials` is true, **`unknown`** (if ever seen) also counts as needing session.

**Key-only accounts** (management key import, no email/password/OTP in vault): `hasCredentials` is false, so a hypothetical **`unknown`** alone would **not** force the “Authenticate” path; the dashboard card can still show **SYNCED** when the snapshot succeeds.

## Session dot colors (`Dashboard.jsx` → `SessionDot`)

The dot is **only** the Clerk **`sessionStatus`**; it is **not** the SYNCED / NEEDS KEY shield.

| Dot | When |
| --- | --- |
| **Green** (pulsar) | `active` — JWT in vault and not expired. |
| **Yellow** | `expiring`, **or** `none` with **both** management key **and** credentials on file (session not stored yet — use Authenticate; common if password sign-in stopped at 2FA until verify completes). |
| **Cyan** (soft glow) | `none`, management key, **no** credentials — **key-only** import; snapshot is via API only, not a bug. |
| **Red** | `expired` or `error` (decrypt failure). |
| **Grey** | `none` and **no** management key — need key or sign-in. |

## Dashboard card badge (client-derived)

The UI does **not** use a server field for the badge label. `src/utils/accountDashboardCard.js` derives it from each `GET /api/dashboard` account row, **highest priority first**:

1. **`sessionDecryptFailed`** or **`sessionStatus === 'error'`** — **SESSION UNREADABLE** (vault decrypt failure).
2. **`status === 'error'`** — **NEEDS KEY** if there is no management key (or error text matches management key), else **SYNC FAILED**.
3. **`hasCredentials` and session needs attention** (per `accountNeedsSession` above) — **SESSION UNCLEAR** if `sessionStatus === 'unknown'`, else **SIGN IN**.
4. **`sessionStatus === 'expiring'`** and snapshot OK — **EXPIRING** (warning, but still usable).
5. **`status === 'ok'`** and **`hasManagementKey`** — **SYNCED** (success).

`isReady` is true for cases (4) and (5); the Dashboard **Accounts** stat uses **synced** / **need attention** counts from this helper.

## Proactive refresh on dashboard load

**`DashboardController.getDashboard`** ( **`GET /api/dashboard`** and **`POST /api/dashboard/refresh`** ) walks accounts with **`sessionStatus === 'expiring'`** and a non-empty **`clientCookie`**, calls **`clerkAuth.refreshSession`**, and persists results via **`store.updateAccountSession`**. This does **not** invoke OTP or clear sessions; it only extends sessions Clerk is willing to refresh.

## OTP start and `preserveSessionToken`

**`POST /api/accounts/:id/otp/start`** updates the Clerk device cookie jar in the vault with **`store.updateAccountSession(..., { preserveSessionToken: true })`**, so sending a code does **not** wipe the encrypted **`__session`** JWT until **`otp/verify`** (or another login path) succeeds.

## Key Manager

**Why this is separate from Dashboard badges:** Key Manager (`/keys`, `KeyManager.jsx`) loads rows from **`GET /api/accounts`** only—it does not use **`GET /api/dashboard`** snapshots. Lane labels and primary actions therefore come from **`getKeyManagerAccountState`** in `src/utils/keyManagerAccountState.js`, while “SIGN IN / SYNCED / …” on the Dashboard still come from **`accountDashboardCard.js`**. Both surfaces share **`accountNeedsSession`** (`src/utils/accountSession.js`) so “expired / none / unknown+hasCredentials” behaves consistently.

### Lanes (`/keys`)

| Lane | Detection | Typical next step |
| --- | --- | --- |
| **Email sign-in** | `hasCredentials` | Valid session → **Provision Key** (automation). Expired/missing session → **Authenticate** (OTP/password), then provision. |
| **API key import** | `!hasCredentials` and not `oauth` | No auto-provision: **Paste management key** (`PATCH /api/accounts/:id` with `managementKey`) or add/fix account on Dashboard. |
| **Session import** | `authMethod === 'oauth'`, no email | No **Authenticate** modal. Refresh session via Dashboard or **Paste management key**. |

Internal lane keys are **`credentials`**, **`key_import`**, and **`oauth_session`** (`getKeyManagerLane`); UI copy uses **`KEY_MANAGER_LANE_LABELS`**.

### Session → management key → standard keys

1. **Clerk session in vault** — For **`hasCredentials`** accounts, **`canProvision`** requires a session that **`accountNeedsSession`** does *not* treat as missing/expired. Without that, the row must **Authenticate** first (when **`canAuthenticate`** / email present) or use another path.
2. **Management key** — OpenRouter management REST (balances, list/create keys) needs a key Hydra treats as valid for that API (typically **`sk-or-mgmt-…`** from **Provision** automation). Automation fills this when **`canProvision`** is true; otherwise the operator pastes via **Paste management key** (modal) or Dashboard import.
3. **Standard keys** — After the management key exists, Key Manager can list/create **standard** keys (`sk-or-v1-…`) for traffic/routing. Session without management key does not unlock those APIs.

### Paste management key

When **`needsKey && !canProvision`**, **`canPasteManagementKey`** is true and the UI opens **`PasteManagementKeyModal.jsx`**. The modal requires a non-empty value starting with **`sk-or-`** (so **`sk-or-mgmt-…`**, **`sk-or-v1-…`**, or future OpenRouter prefixes are accepted for paste UX). It calls **`PATCH /api/accounts/:id`** with **`managementKey`**; the server checks non-empty + **`openrouter.getCredits()`** — OpenRouter decides if the key works for management calls. This covers key-import lanes, OAuth session-import rows without a path to automation, and any case where provisioning is blocked but the operator has a key string from OpenRouter.

**Contrast with Provision:** **`POST /api/accounts/:id/provision`** never uses the browser Copy button; it captures the created management key from **tRPC** or **server Playwright** (see **`MANAGEMENT_KEY_PROVISION_AUTOMATION.md`**).

## Related files

- `server/controllers/DashboardController.js` — Builds each account row for `GET /api/dashboard`.
- `src/pages/Dashboard.jsx` — Account grid, stats, action buttons.
- `src/utils/accountDashboardCard.js` — Badge + readiness.
- `src/utils/accountSession.js` — Shared “needs session” predicate for Dashboard, Key Manager, Account Detail, Bulk OTP merge.
- `src/utils/keyManagerAccountState.js` — Key Manager lanes, `canProvision` / `canPasteManagementKey` / `canAuthenticate`.
- `src/pages/KeyManager.jsx` — Keys UI, empty states, header CTAs.
- `src/components/PasteManagementKeyModal.jsx` — Paste OpenRouter **`sk-or-…`** keys when **`canPasteManagementKey`**; server validates via **`getCredits`**.
- `server/services/dashboard-api.js` — **`ensureSession`**, **`preflightRedeemAccounts`** (effective JWT expiry when DB expiry missing).
- `server/services/clerk-auth.js` — **`getJwtExpiry`** (exported), **`isSessionValid`**, **`refreshSession`**, **`validateSession`**.
