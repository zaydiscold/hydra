# Session Lifecycle — Hydra Knowledge Base

**Last updated:** 2026-04-08 session 17
**Purpose:** Complete documentation of how sessions are created, stored, validated, refreshed, and recovered in Hydra.

---

## Session Creation Flows

### 1. Password Login
**Path:** UI → `POST /api/accounts/:id/login` → `AccountController.login` → `clerkAuth.passwordLogin(email, password)` → Clerk FAPI `/v1/sign_ins` → `store.updateAccountSession`

**Cookies produced:** `__session` (JWT, ~2.5 min exp), `__client` (device cookie, ~7 day TTL)
**Session expiry stored:** `realisticSessionExpiry()` = `Date.now() + 7 days`

### 2. OTP Login
**Path:** UI → `POST /api/accounts/:id/otp/start` → Clerk FAPI → email sent → user enters 6-digit code → `POST /api/accounts/:id/otp/verify` → `clerkAuth.verifyOTP` → `store.updateAccountSession`

**Same cookies produced.** OTP accounts cannot auto-recover (no stored password).

### 3. Magic Link
**Path:** UI → `POST /api/accounts/:id/magic-link/send` → Clerk FAPI email_link → user clicks link → `GET /api/auth/magic-callback` → `clerkAuth.completeEmailLink` → `store.updateAccountSession`

**Auto-provisions management key after successful sign-in** if account has none.

### 4. OAuth (Google)
**Path:** Handled externally. Hydra imports the resulting `__client` + `__session` cookies.

### 5. Account Generator (Playwright)
**Path:** `server/services/account-generator.js` → Playwright browser automation → captures cookies from browser context → stores session. Uses `new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()` for expiry (fixed in session 15).

---

## Session Storage

### Where sessions live
- **SQLite via Prisma:** `Account` table → `encryptedConfig` field (AES-256-GCM blob)
- **Decrypted config object:** `{ sessionCookie, clientCookie, sessionExpiry, lastLoginAt, password?, ... }`
- **Encryption:** `storage-codec.js` using `local-secrets.js` auto-generated 256-bit key

### Key fields
| Field | What | Source |
|---|---|---|
| `sessionCookie` | `__session` JWT | Clerk FAPI response |
| `clientCookie` | Latest `__client` device cookie (legacy compatibility field) | Derived from stack head |
| `clientCookies` | Stacked `__client` cookies (`[{cookie, issuedAt}]`, newest-first) | Clerk refresh/login captures |
| `sessionExpiry` | ISO string, estimated death time | `realisticSessionExpiry()` = now + 7 days |
| `lastLoginAt` | When session was established | `Date.now()` at login time |

---

## The JWT Trap (Critical Knowledge)

**`getJwtExpiry(sessionCookie)`** decodes the `__session` JWT and returns its `exp` claim as an ISO string.

**THE TRAP:** JWT `exp` is ~2.5 minutes from issuance. This is NOT the session lifetime. The JWT is a short-lived proof token that gets refreshed silently via the `__client` cookie. The actual session lifetime is controlled by the `__client` cookie TTL (~7 days empirically).

**RULE:** Never use `getJwtExpiry()` for session lifecycle decisions. The only valid use is `account-generator.js:240` where it's used as a timing check during the Playwright flow (not for session persistence).

**History:** Before session 15, `getJwtExpiry()` was used everywhere to set `sessionExpiry`. This caused:
- All sessions appeared expired within ~2.5 minutes
- Session-refresher skipped "already expired" sessions (all of them)
- UI showed all sessions as dead
- Ghost recovery never triggered

---

## Session Validation

### Sync validation (`store.getSessionStatus`)
1. Check async cache first (populated by `getSessionStatusAsync`)
2. If cache miss → fallback to stored expiry heuristic:
   - No session cookie → `'none'`
   - Has expiry, not expired, not expiring soon → `'active'`
   - Has expiry, expiring within 24h → `'expiring'`
   - Has expiry, expired → `'expired'`
   - Has session cookie but no expiry → `'active'` (trust the cookie)

### Async validation (`store.getSessionStatusAsync`)
1. Requires `__client` cookie
2. Calls `clerkAuth.refreshSession(clientCookie, sessionCookie)`
3. If Clerk returns fresh session → `'active'`, cache for 5 minutes
4. If Clerk returns null → `'expired'`, cache result
5. On network error → `'unknown'`

**Usage split:** `GET /api/accounts/:id/session-status` is display-oriented (cached/heuristic).  
`GET /api/accounts/:id/session-check` forces a live probe and is used for session-gated action readiness.

---

## Session Refresh

### Auto-refresh (session-refresher.js)
- Runs every 6h (fixed `INTERVAL_MS` in `session-refresher.js`)
- For each account with `__client` cookie:
  - Skip if >24h from expiry
  - If expired or expiring → try `refreshSession`
  - On success → persist, log event
  - On failure → log `SESSION_REFRESH_FAILED`, continue to next account
- OTP-only accounts without `__client` → skipped

### On-demand refresh (DashboardController)
- Dashboard load triggers refresh for accounts with `'unknown'` or `'expiring'` status
- Uses `clerkAuth.refreshSession(cookieStackOrCookie, sessionCookie)` same as auto-refresh
- Prunes dead stacked cookies and persists the filtered stack
- Results cached in `getSessionStatusAsync` for 5 minutes

### ensureSession (dashboard-api.js)
- Called before any operation that needs a valid session
- Decision tree:
  1. If session valid (expiry in future) → use it
  2. If `__client` cookie exists → try `refreshSession` (ghost recovery)
  3. If password stored → try `passwordLogin` (auto-recover)
  4. If none of the above → throw "no session" error

---

## Operational Clarification: Browser Is Not Session Keepalive

Keeping an incognito/browser context open does not automatically keep Hydra sessions alive.

Hydra's long-lived behavior depends on persisted vault state (`sessionCookie`, stacked `clientCookies`, `sessionExpiry`) and refresh workflows. Browser automation is only used to capture/update those cookies, not as a live session manager.

---

## Clerk JS Version

**Current:** `process.env.HYDRA_CLERK_JS_VERSION || '5.125.7'` (set in `clerk-auth.js`)
**Used by:** `getFreshJwt` in `dashboard-api.js` to construct Clerk JS API URL for JWT refresh.
**History:** Was hardcoded as `5.0.0` in `dashboard-api.js` (fixed session 15 to use env var).

---

## Constants

| Constant | Value | File | Purpose |
|---|---|---|---|
| `CLERK_SESSION_TTL_MS` | 7 days | `clerk-auth.js` | Realistic session lifetime estimate |
| `SESSION_EXPIRING_SOON_MS` | 24h | `clerk-auth.js` | Window for "expiring" status |
| `REFRESH_WINDOW_MS` | 24h | `session-refresher.js` | When to attempt refresh |
| `SESSION_REFRESH_INTERVAL_MS` | 6h | `session-refresher.js` | Auto-refresh sweep interval |
| `ASYNC_SESSION_CACHE_MS` | 5 min | `store.js` | How long to cache async probe results |

---

## Cookie Persistence Bug — Fixed Apr 2026

**Root cause:** `getSessionStatusAsync` in `store.js` called `refreshSession` (which makes a live Clerk API call and returns a fresh `__client` cookie), but **never persisted the returned cookie back to the DB**. The 5-minute in-memory cache hid the problem. When the cache expired, the probe retried with the stale stored cookie. If Clerk had issued a fresh cookie in the previous probe cycle (and effectively "consumed" the old one), the retry failed → false `expired`.

**Observed:** Delilah account showed `expired` despite session being refreshed 4 days prior (Clerk TTL = 7 days, 3 days remaining). Session event log confirmed the Apr 10 refresh happened successfully.

**Fix:** `getSessionStatusAsync` now accepts `userId` and persists fresh cookies via fire-and-forget `updateAccountSession` when `refreshSession` succeeds. Live probe paths (`probeSessionLive`) and other authoritative session checks pass `userId` through.

**Also fixed:** Three `AccountController` refresh endpoints (lines 244, 448, 851) were calling `refreshSession(session.clientCookie)` — the legacy single string. They now use `session.clientCookies?.length > 0 ? session.clientCookies : session.clientCookie` to enable Exploit #14 stack traversal. Reference implementation: `dashboard-api.js:689`.
