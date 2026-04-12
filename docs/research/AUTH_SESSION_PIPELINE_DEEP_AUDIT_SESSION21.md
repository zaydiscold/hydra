# AUTH & SESSION PIPELINE DEEP AUDIT — Session 21

Date: 2026-04-08
Auditor: Automated deep audit of the full auth/session lifecycle

---

## Table of Contents

1. Session Lifecycle Gaps
2. Cookie Chain Analysis
3. Modern Auth Tricks
4. Race Conditions in Multi-Account Refresh
5. Encryption Key Management
6. Classic Security Tricks
7. Server Action Replay Reliability
8. Provisioning Pipeline End-to-End
9. Webhook Potential
10. Alternative Auth Approaches

---

## 1. Session Lifecycle Gaps

### Where Sessions "Die"

A Clerk session dies when the `__client` cookie expires or is revoked server-side.
The actual death points are:

**Clerk-side death:**
- `__client` cookie TTL: ~7 days (per `CLERK_SESSION_TTL_MS` at clerk-auth.js:1001)
- Server-side session revocation (user logs out, admin kills session, password change)
- JWT `exp` is ~2.5 min but is NOT the session lifetime — it's just a short-lived proof token

**Hydra-side detection:**
- `getSessionStatus()` (store.js:98) — SYNC heuristic: checks `sessionExpiry` (7-day TTL)
- `getSessionStatusAsync()` (store.js:42) — LIVE probe: calls `refreshSession()` → GET /v1/client
- `_sessionStatusCache` (store.js:11) — 5-min TTL cache for async results

### THE GAP: Asymmetric Visibility

**Gap 1 — Clerk-alive / Hydra-dead:**
If `LOCAL_SECRET` changes (nuke + restart), all encrypted sessions become unreadable.
The `readSessionPlainResult()` (store.js:133) catch block sets `decryptFailed: true`,
which cascades to `getSessionStatus()` returning 'error'. The Clerk session is alive but
Hydra considers it dead because the encrypted blob can't be read.

File: store.js:133-139
```
function readSessionPlainResult(account) {
  try {
    return { plain: decrypt(account.sessionToken) || '', decryptFailed: false };
  } catch {
    return { plain: '', decryptFailed: true };
  }
}
```

**Gap 2 — Hydra-alive / Clerk-dead:**
The 7-day `sessionExpiry` (clerk-auth.js:1001) is a HEURISTIC. If Clerk revokes a session
at day 3 (user changed password, admin action, etc.), Hydra still shows 'active' until the
next `getSessionStatusAsync()` probe or `sweepAndRefresh()` cycle.

The SYNC `getSessionStatus()` at store.js:98-131 uses `sessionExpiry` as ground truth
without any API call. On cold start, accounts can show 'active' for days after Clerk death.

**Gap 3 — Auto-refresh detection window:**
`sweepAndRefresh()` (session-refresher.js:25) runs every 6h (line 14). It only probes
accounts within 24h of expiry (line 13, `REFRESH_WINDOW_MS`). An account that dies
unexpectedly at day 3 won't be probed until it enters the 24h window (~day 6).
That's potentially 3 days of "active" status for a dead session.

### Actionable Fixes

1. **Add a `lastValidatedAt` field** to the config — tracks when `getSessionStatusAsync()` last confirmed the session. If `lastValidatedAt` is older than 12h, downgrade status to 'stale' (new state between 'active' and 'expiring').

2. **Reduce REFRESH_WINDOW_MS** from 24h to 48h — probe earlier to catch premature deaths.

3. **Add an on-demand validation endpoint** — when the proxy tries to use a key from an account, validate the session first (or use the existing `ensureSession()`).

4. **On `decryptFailed`, try `refreshSession()` with whatever `clientCookie` exists in the config** — the clientCookie might be decryptable even if the sessionToken blob isn't (since they're in different encrypted fields).

---

## 2. Cookie Chain Analysis

### The EXACT Cookie Chain

| Cookie | Set By | Domain | Purpose | Persisted In | Required For |
|--------|--------|--------|---------|-------------|-------------|
| `__client` | Clerk FAPI | clerk.openrouter.ai | Device identity, session refresh | `config.clientCookie` (encrypted) | Clerk /v1/client calls, session refresh |
| `__client_uat` | Clerk FAPI | clerk.openrouter.ai | Client update-at timestamp | `config.clientCookie` (part of string) | Clerk FAPI device cookie header |
| `__client_uat_*` | Clerk FAPI | clerk.openrouter.ai | Per-session UAT variant | `config.clientCookie` (part of string) | Clerk FAPI (same as above) |
| `__session` | Clerk FAPI | openrouter.ai | JWT session token (~2.5 min TTL) | `account.sessionToken` (encrypted) | All OR API calls, tRPC, Server Actions |
| `__cf_bm` | Cloudflare | openrouter.ai | Bot management cookie | `config.clientCookie` (if captured) | OR dashboard access (anti-bot) |
| `_cfuvid` | Cloudflare | openrouter.ai | Unique visitor ID | `config.clientCookie` (if captured) | OR dashboard access |
| `cf_clearance` | Cloudflare | openrouter.ai | Challenge clearance token | `config.clientCookie` (if captured) | OR dashboard after challenge |

### Cookie Flow During Login

1. `obtainClerkClientCookie()` (clerk-auth.js:953-995) — GET /v1/client → receives `__client` + `__client_uat` from Set-Cookie
2. `detectAuthMethod()` (clerk-auth.js:1060) — POST /v1/client/sign_ins → may update `__client`
3. `signInWithPassword()` (clerk-auth.js:1109) — POST attempt_first_factor → `__session` from Set-Cookie or embedded JWT
4. `touchClerkSession()` (clerk-auth.js:787) — POST sessions/{id}/touch → may refresh `__session`
5. `clerkGetClientSession()` (clerk-auth.js:1163) — GET /v1/client with retries → `__session` from Set-Cookie or embedded JWT

### Cookie Storage

- `__session` → stored in `account.sessionToken` (AES-256-GCM encrypted, separate column)
- All device cookies (`__client`, `__client_uat`, `__cf_bm`, `_cfuvid`, `cf_clearance`) → stored in `config.clientCookie` (AES-256-GCM encrypted, inside config JSON blob)

### Cookies We DON'T Need

None identified as clearly unnecessary. Each cookie in the jar serves a purpose:
- Clerk device cookies: mandatory for FAPI session management
- Cloudflare cookies: required for dashboard HTML access (tRPC routes can work without them per ensureSession comment at dashboard-api.js:723-724)

### Missing Cookies We SHOULD Store

1. **`__client_uat_*` (multi-session variant)** — The current `isClerkDeviceCookieName()` (clerk-auth.js:243-249) includes `__client_uat_` prefix but `serializeAllDeviceCookies()` only keeps `isDashboardDeviceCookieName()` which includes these. However, the serialization might lose less common variants.

2. **Clerk `__client` rotation tokens** — When Clerk rotates the `__client` cookie during a refresh, we update `config.clientCookie` but don't track the old value. If the new cookie fails, we lose the previous working state.

3. **No `Set-Cookie` metadata storage** — We parse expirations for CF cookies (clerk-auth.js:622-641) but don't store `Secure`, `HttpOnly`, `SameSite`, or `Domain` attributes. These matter for correct cookie replay in edge cases.

### Key Bug: `clientCookie` Format Ambiguity

The `clientCookie` field stores a flat string that can be:
- Legacy: single `__client` value (no `=` sign, no `;`)
- Modern: `__client=abc; __client_uat=123; __cf_bm=xyz`

`parseClerkDeviceCookieJar()` (clerk-auth.js:281-328) handles both, but
`parseAllDeviceCookies()` (clerk-auth.js:337-377) and the replay functions
have slightly different parsing behavior. This dual-format is a maintenance
hazard. The `;` in a cookie VALUE would break parsing (e.g., if `__cf_bm`
contains a semicolon-encoded value, the split on `;` would break it).

---

## 3. Modern Auth Tricks

### 3.1 Token Rotation Patterns

**Current state:** No token rotation. The `__client` cookie is stored once and
used until it expires. `refreshSession()` (clerk-auth.js:1491) uses `__client`
to GET /v1/client which returns a fresh `__session` JWT, but the `__client`
itself may or may not be rotated.

**What Clerk supports:** Clerk sessions have a concept of session tokens with
automatic refresh. The `__client` cookie is long-lived (~7 days). The `__session`
JWT is short-lived (~2.5 min) and auto-refreshed by the browser SDK.

**Opportunity:** After each `refreshSession()` call, check if Set-Cookie
contains a new `__client` value. If so, update the stored cookie. Currently
this IS done in `clientCookieAfterSetCookieLines()` (clerk-auth.js:607-614),
but the `sweepAndRefresh()` (session-refresher.js:66-72) already persists the
updated `clientCookie`. So token rotation IS partially implemented.

**Missing:** No proactive rotation before expiry. The refresher only probes
within 24h of expiry. A "rolling refresh" strategy would refresh sessions
every 24h regardless of expiry, keeping the `__client` cookie warm.

### 3.2 Session Binding (IP/User-Agent Fingerprinting)

**Current state:** None. The `User-Agent` is randomized per-request
(clerk-auth.js:837: `randomUserAgent()`). This means:
- Different UA strings per Clerk request → Clerk may see different "devices"
- IP binding not implemented → session cookies could be stolen and replayed from any IP

**Risk assessment:** LOW for Hydra specifically — this is a local tool, not
a public-facing service. The Clerk sessions are for OpenRouter accounts managed
by a single user on a single machine. Session theft would require local access.

**Opportunity for the proxy:** When Hydra's proxy (`:3001`) receives API requests,
it could bind the session to the requesting IP. If a different IP tries to use
the same session, flag it. However, this adds complexity for little benefit in
a single-user local tool.

### 3.3 Step-Up Auth for Destructive Operations

**Current state:** No step-up auth. Any valid Hydra JWT can trigger:
- `nukeSystem()` (auth.js:48) — destroys all data
- `deleteAccount()` (store.js:372)
- `revokeManagementKey()` (management-key-store.js:156)
- Account provisioning (creates real API keys on OpenRouter)

**Opportunity:** Add password re-verification for destructive operations:
1. Require `X-Hydra-Confirm: <password>` header for nuke/delete operations
2. Implement a "session elevation" pattern: after confirming password,
   issue a short-lived elevated JWT (5 min TTL) with `{elevated: true}` claim
3. Frontend shows a password dialog before destructive actions

**Implementation sketch:**
```js
// middleware/auth.js
export async function requireElevated(req, res, next) {
  const user = req.user;
  if (user.elevated && user.elevatedExp > Date.now()) return next();
  return res.status(403).json({ error: 'Elevated session required' });
}
```

### 3.4 Refresh Token Rotation

**Current state:** Not applicable — Clerk manages refresh tokens internally.
The `__client` cookie IS effectively the refresh token. When it expires,
the session is truly dead and requires full re-auth.

**Opportunity:** Clerk may support a "transfer" or "exchange" endpoint that
rotates the `__client` cookie without requiring re-auth. This would allow
Hydra to proactively rotate `__client` before it expires, extending sessions
indefinitely without user interaction.

---

## 4. Race Conditions in Multi-Account Refresh

### Current Architecture

`sweepAndRefresh()` (session-refresher.js:25-88):
```
for (const account of accounts) {        // SEQUENTIAL
  const result = await refreshSession()  // BLOCKING
  ...
}
```

This is a simple sequential loop over ALL accounts. If account 5's refresh
takes 10s (Playwright fallback), accounts 6-30 wait 10s.

### Timing Analysis

- `refreshSession()` → `clerkGetClientSession()` → GET /v1/client
  - Fast path: ~100-300ms (password accounts, __client alive)
  - Slow path: 3 × 150ms retries = ~450ms (client cookie alive but session needs retry)
  - OTP slow path: 8 × 500ms retries = ~4s (Clerk propagation delay)
  - Dead path: ~100ms (401 response)

For 30 accounts, worst case sequential: 30 × 4s = 120s (2 minutes)
Typical case: 30 × 300ms = 9s

### Proposed: Parallel Refresh with Concurrency Control

```js
// In session-refresher.js
import { setTimeout as sleep } from 'node:timers/promises';

const MAX_CONCURRENT_REFRESHES = 5;
const REFRESH_TIMEOUT_MS = 10_000;

async function sweepAndRefresh() {
  const accounts = await prisma.account.findMany({});
  const eligible = accounts.filter(/* same logic */);
  
  // Partition: password accounts (fast) vs OTP-only (slow/unsolvable)
  const refreshable = eligible.filter(a => getConfigForAccount(a)?.clientCookie);
  
  // Process in parallel with bounded concurrency
  const results = await Promise.allSettled(
    refreshable.map((account, i) => 
      // Stagger starts to avoid Clerk rate limiting
      sleep(i * 200).then(() => 
        Promise.race([
          refreshOneAccount(account),
          sleep(REFRESH_TIMEOUT_MS).then(() => ({ 
            accountId: account.id, 
            status: 'timeout' 
          }))
        ])
      )
    )
  );
  // ... process results
}
```

### Smart Scheduling

1. **Priority scheduling:** Refresh accounts closest to expiry first
2. **Skip accounts recently validated:** Use `_sessionStatusCache` to avoid re-probing
3. **Batch Clerk calls:** Multiple `GET /v1/client` calls can share the same
   HTTPS agent (connection pooling). Currently `clerkHttpsJson()` creates a new
   request each time — could reuse a persistent `https.Agent` with `keepAlive: true`.
4. **Rate limit awareness:** Add a per-domain rate limiter (e.g., max 3 req/s
   to clerk.openrouter.ai) to avoid triggering Clerk's rate limits

### Edge Case: Concurrent ensureSession + sweepAndRefresh

Both `ensureSession()` (dashboard-api.js:718) and `sweepAndRefresh()` can
run concurrently for the same account. This can cause:

1. **Double refresh** — both call `refreshSession()` for the same account
2. **Stale write** — the slower writer overwrites the fresher session data

**Fix:** Add a per-account refresh lock:
```js
const _refreshLocks = new Map(); // accountId → Promise
async function lockedRefresh(userId, accountId) {
  if (_refreshLocks.has(accountId)) return _refreshLocks.get(accountId);
  const p = doRefresh(userId, accountId).finally(() => _refreshLocks.delete(accountId));
  _refreshLocks.set(accountId, p);
  return p;
}
```

---

## 5. Encryption Key Management

### Current Implementation

**File:** server/services/storage-codec.js (57 lines)

```
ALGORITHM = 'aes-256-gcm'
IV_LENGTH = 16
TAG_LENGTH = 16
```

`encrypt(text)` → base64( IV + TAG + CIPHERTEXT )
`decrypt(base64)` → parse IV/TAG/CIPHERTEXT → AES-256-GCM decrypt

**Key source:** server/services/local-secrets.js
```
getStorageEncryptionKey() → Buffer.from(storageKey, 'hex')
```

Where `storageKey` is either:
1. `config.LOCAL_STORAGE_KEY` / `config.VAULT_KEY` (env var, 64-char hex)
2. Persisted in `data/local-secrets.json` (file, 0o600 permissions)
3. Auto-generated via `randomBytes(32).toString('hex')` on first run

### What Happens When LOCAL_SECRET Changes

**Disaster scenario:** If `LOCAL_STORAGE_KEY` env var is changed, or if
`data/local-secrets.json` is deleted, the encryption key changes. ALL existing
encrypted data becomes unreadable.

**Current behavior:**
- `decrypt()` throws `EncryptionError` (storage-codec.js:40-42)
- `readConfig()` catches this and throws "Local vault unreadable" (store.js:141-149)
- `readSessionPlainResult()` catches this, returns `{ plain: '', decryptFailed: true }` (store.js:133-139)
- `getAllAccountsWithKeys()` auto-purges accounts with unreadable config (store.js:272-287)

**No key rotation story exists.** There is:
- No key versioning (no metadata on which key was used to encrypt)
- No re-encryption capability
- No migration path from old key to new key
- No dual-key decryption (try old key, then new key)

### Key Derivation — Raw Key Material

**Current:** The raw 32-byte hex string is used DIRECTLY as the AES-256 key.
No HKDF, no PBKDF2, no salt, no stretching.

**Risk:** If the 64-char hex is not truly random (e.g., user-provided password),
it may have insufficient entropy. The `normalizeSecret()` function (local-secrets.js:11-20)
only validates the format (64 hex chars), not the entropy.

**Better approach:**
```js
import { hkdfSync } from 'node:crypto';
function deriveKey(masterSecret, purpose = 'storage') {
  const masterKey = Buffer.from(masterSecret, 'hex');
  return hkdfSync('sha256', masterKey, 'hydra-storage-key', purpose, 32);
}
```

This would:
1. Allow key derivation from weaker master secrets
2. Support purpose-specific keys (storage vs proxy vs management)
3. Enable key rotation: derive v2 keys from v1 keys + new salt

### Actionable: Key Rotation Implementation

1. **Add key version to encrypted blobs:**
   ```
   base64( VERSION:1 + IV + TAG + CIPHERTEXT )
   ```
   First byte = version. v1 = current format. v2 = HKDF-derived key.

2. **Add dual-decrypt on startup:**
   ```js
   function decrypt(blob) {
     const version = Buffer.from(blob, 'base64')[0];
     if (version === 0 || version > 0x30) {
       // v1: no version prefix, raw key
       return decryptV1(blob);
     }
     if (version === 1) {
       return decryptV2(blob.slice(1), getStorageEncryptionKeyV2());
     }
   }
   ```

3. **Add re-encryption endpoint:** POST /api/admin/rekey — reads all accounts
   with old key, re-encrypts with new key.

---

## 6. Classic Security Tricks

### 6.1 Timing Attacks on Password Comparison

**Current state:** SAFE. Hydra uses `bcrypt.compare()` (auth.js:98):
```js
const ok = await bcrypt.compare(password, user.passwordHash);
```

bcrypt.compare() is inherently timing-safe because it performs a full hash
computation regardless of whether the password matches. The comparison is
not short-circuited.

**SALT_ROUNDS = 12** (auth.js:10) — This is adequate. Each round doubles
the work factor. 12 rounds = ~250ms on modern hardware. Good for a local tool.
Could increase to 14 for extra safety but would slow login.

### 6.2 Session Fixation Prevention

**Current state:** VULNERABLE. The magic link flow at auth.js:27-120 accepts
a `signInId` from the URL query parameter and looks it up in `pendingMagicLinks`.
An attacker could:
1. Initiate a magic link for a victim's email
2. The victim clicks the link, completing sign-in
3. The attacker's stored `pendingMagicLinks` entry is used to access the session

**However:** The `pendingMagicLinks` entry includes `userId` and `accountId`,
and the callback writes the session to the specific account. The attacker
would need the victim to click a link that includes the attacker's accountId.

**Mitigation:** The `pendingMagicLinks` TTL of 15 min (AccountController.js:36-40)
limits the window. But there's no CSRF protection on the callback endpoint —
any website could trigger the callback URL in the victim's browser.

**Fix:** Add a `state` parameter to the magic link flow:
1. Generate a random `state` token when sending the magic link
2. Store it in `pendingMagicLinks`
3. Require `state` in the callback URL
4. Verify `state` matches before completing the sign-in

### 6.3 CSRF Token Binding to Sessions

**Current state:** NO CSRF protection. Hydra uses Bearer JWT authentication
(middleware/auth.js:3-14). Bearer tokens in the Authorization header are NOT
automatically sent by browsers, so CSRF is not a concern for API endpoints.

However, the magic link callback (auth.js:27) IS a GET endpoint that
performs state-changing operations (creates sessions, provisions keys).
This violates the HTTP spec (GET should be idempotent) and is vulnerable
to CSRF via img tags, link prefetching, etc.

**Fix:**
1. Change magic-callback from GET to POST
2. Or add a one-time `state` token that must match
3. Or add `SameSite=Strict` to any cookies set by the callback

### 6.4 HSTS Headers

**Current state:** NOT IMPLEMENTED. Hydra serves on :3001, typically behind
a reverse proxy or directly on localhost. No HSTS headers are set.

**Risk:** LOW. Hydra is a local tool accessed via localhost. HTTPS is typically
provided by the reverse proxy, not Hydra itself. Adding HSTS would be:
```js
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
```

But this only makes sense if Hydra is directly exposed via HTTPS. If behind
a proxy, the proxy should set HSTS.

### 6.5 Other Security Headers

Missing headers that should be added to Express:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### 6.6 Password Policy

**Current state:** `z.string().min(1)` (AuthController.js:7-8). The password
only needs to be at least 1 character. No complexity requirements.

**Risk:** This is intentional for a local tool where the password protects
a single-user system. However, the admin JWT is long-lived (no short TTL)
and grants full access including nuke.

**Recommendation:** At minimum, require 8 characters for the admin password.
Or document that the password is a local access control, not a security boundary.

---

## 7. Server Action Replay Reliability

### Architecture

dashboard-api.js (3236 lines) implements a multi-layer key provisioning:

1. **Server Action replay** (line 389-509) — POST to /settings/management-keys with
   `Next-Action: <hash>` header and JSON body
2. **tRPC cached route** (line 1570-1597) — uses previously discovered route
3. **tRPC candidate scan** (line 1600-1647) — tries 12 candidate route names
4. **REST API fallback** (line 1473-1540) — tries 4 REST endpoints
5. **Playwright browser automation** (line 2055+) — launches Chromium, navigates
   UI, clicks Create, captures key from DOM/network

### The Server Action Hash Problem

**Hard-coded hash:** `CREATE_MGMT_KEY_ACTION_HASH` (line 57):
```js
const CREATE_MGMT_KEY_ACTION_HASH = config.HYDRA_MGMT_KEY_SERVER_ACTION_ID 
  || '40a4728e6d23484cde9c2e629e0c0cc195dfbbd66b';
```

This hash is derived from Next.js's build ID. When OpenRouter redeploys
with a new build, this hash changes and Server Action replay breaks.

**Failure rate:** Unknown, but predictable:
- Server Action hash changes with every OpenRouter deployment
- OpenRouter likely deploys multiple times per week
- The env var `HYDRA_MGMT_KEY_SERVER_ACTION_ID` allows override, but requires manual update

**Self-healing possibilities:**

1. **Dynamic hash discovery:** Before each provision attempt, fetch the
   OpenRouter settings page HTML and extract the Next.js build manifest
   (usually in `_next/static/<buildId>/_buildManifest.js`). The Server
   Action IDs are embedded in the page's JavaScript chunks.

2. **Build manifest scraper:**
   ```js
   async function discoverServerActionHash(sessionCookie, clientCookie) {
     const page = await fetch(`${OR_BASE}/settings/management-keys`, {
       headers: { Cookie: `__session=${sessionCookie}; ${clientCookie}` }
     });
     const html = await page.text();
     // Extract Next-Action IDs from inline scripts or __NEXT_DATA__
     const match = html.match(/"actionId":"([a-f0-9]{40,})"/);
     return match?.[1] || null;
   }
   ```

3. **Fallback chain resilience:** The current 5-layer fallback is good.
   Server Action → tRPC cached → tRPC scan → REST → Playwright.
   The Playwright fallback is the most reliable (it uses the actual browser)
   but also the slowest (5-15s).

4. **Hash caching:** When Playwright succeeds, capture the Next-Action
   header from the network request and cache it for future Server Action
   replays. This is partially implemented via `saveDiscoveredEndpoints()`
   for tRPC routes, but not for Server Action hashes.

### Key Extraction Fragility

The `extractManagementKeyFromResponseBody()` function (line 141-200) uses
regex + recursive JSON search to find `sk-or-v1-*` keys. This is fragile:

1. **Masked key rejection:** Keys containing `...` are rejected (line 150-153).
   But the RSC response may contain the masked key FIRST and the full key LATER.
   The `matchAll` approach (line 148) handles this.

2. **Minimum length check:** Keys must be >= 40 chars (line 150). This is a
   heuristic — if OpenRouter changes key format, this breaks.

3. **NFC normalization:** `body.normalize('NFC')` (line 143) handles Unicode
   edge cases — good defensive practice.

### Actionable: Make Server Action Self-Healing

```js
// Add to createManagementKey() flow:
const discoveredHash = await discoverServerActionHash(sessionCookie, clientCookie);
if (discoveredHash && discoveredHash !== CREATE_MGMT_KEY_ACTION_HASH) {
  logger.info(`[PROVISION] Server Action hash changed: ${CREATE_MGMT_KEY_ACTION_HASH} → ${discoveredHash}`);
  // Cache for future use
  await store.saveDiscoveredEndpoints({ 
    mgmtKeyServerActionHash: discoveredHash 
  });
}
```

---

## 8. Provisioning Pipeline End-to-End

### Full Pipeline

```
1. Account Creation (AccountController.addAccount)
   ↓
2. Credential Attachment (AccountController.addAccountWithCredentials)
   ↓
3. Clerk Auth Detection (AccountController.detectAuth)
   ↓
4. Login/OTP (AccountController.login or startOTP + verifyOTP)
   ↓
5. Session Established (clerk-auth.js resolves __session + __client)
   ↓
6. Session Stored (store.updateAccountSession — encrypted)
   ↓
7. Key Provisioning (dashboard-api.createManagementKey)
   ↓
8. Key Persisted (management-key-store.storeManagementKey)
   ↓
9. Key Pooled (store.updateKeyPooledStatus → key enters proxy pool)
```

### Failure Points Analysis

| Step | Failure Mode | Likelihood | Impact | Robust? |
|------|-------------|-----------|--------|---------|
| 1. Account Creation | Duplicate alias/email | Medium | Low (409 error) | YES — assertAccountUniqueForUser |
| 2. Credential Attach | Invalid email format | Low | Low | PARTIAL — no email validation |
| 3. Auth Detection | Clerk FAPI down | Low | High (can't proceed) | NO — single attempt, no retry |
| 4. Login/OTP | Wrong password, 2FA required | Medium | Medium | PARTIAL — NeedSecondFactorError handled |
| 5. Session Resolve | Set-Cookie absent, no embedded JWT | Medium | High (no session) | PARTIAL — retry + touch fallback |
| 6. Session Store | Encryption failure (disk full) | Very Low | High | NO — no error recovery |
| 7. Key Provision | Server Action hash stale | Medium-High | High | YES — 5-layer fallback chain |
| 8. Key Persist | Key format invalid (masked) | Medium | Medium | YES — explicit rejection + error |
| 9. Key Pool | Key doesn't start with sk-or- | Low | Low | PARTIAL — classifyOpenRouterKey |

### Most Fragile Step: 5 → 6 (Session Resolution)

The `resolveSessionAfterCompletedAttempt()` (clerk-auth.js:1208-1256) has a
complex flow:

1. Try Set-Cookie `__session`
2. Try embedded JWT in response body
3. Try `touchClerkSession()` with `created_session_id`
4. Try `getSessionToken()` with retries

If all fail, it returns `null`, and the login throws "No __session cookie returned".
This is the most common failure point for OTP accounts, where Clerk's session
propagation has a 2-4 second delay.

The OTP path uses 8 retries × 500ms = 4s window (clerk-auth.js:1153-1154).
This is usually sufficient but can fail under high Clerk load.

### Auto-Provision After OTP

After `verifyOTP()` (AccountController.js:363-434), the system attempts
auto-provisioning SYNCHRONOUSLY (line 406):
```js
provisionResult = await dashboardApi.createManagementKey(userId, accountId);
```

**Critical race:** OTP sessions have ~60s JWT TTL (per comments at line 393).
The provisioning flow (Server Action + tRPC scan + Playwright) can take 30-60s.
If the JWT expires mid-provision, the entire chain fails.

**Mitigation:** `getFreshJwt()` (dashboard-api.js:654-695) refreshes the JWT
before each tRPC/Server Action call. But this function uses `fetch()` against
Clerk, which itself needs the `__client` cookie. If `__client` has also expired
(which shouldn't happen within 60s), this fails too.

**Better approach:** After OTP verification, IMMEDIATELY call `refreshSession()`
to get a fresh JWT with a full 2.5-min window, THEN start provisioning.

---

## 9. Webhook Potential

### Current Implementation

**File:** server/services/webhook-idempotency.js (40 lines)

```js
export async function recordWebhookEvent(eventId, payload) {
  // Deduplicates by event_id using SQLite PRIMARY KEY
  // Falls back to payload hash if no eventId
}
```

This is a DEDUPLICATION layer only. No actual webhook handling logic exists.
The `clerk_webhook_events` table exists but nothing reads from it or acts on it.

### Clerk Webhook Events

Clerk can send these webhook events:

| Event | Data | Hydra Use Case |
|-------|------|----------------|
| `session.created` | session_id, user_id, created_at, expire_at | Confirm session established, update sessionExpiry |
| `session.ended` | session_id, user_id, ended_at | Mark session as dead, trigger re-auth or removal from pool |
| `session.revoked` | session_id, user_id | Immediate session death detection — close the gap in Finding #1 |
| `user.updated` | user profile changes | Update stored email/name |
| `user.deleted` | user_id | Remove all accounts for this user (Cascade cleanup) |
| `email.created` | email_id, email_address | Track email changes |

### Highest Value: `session.ended` / `session.revoked`

This directly addresses Gap #1 from Section 1. Currently, Hydra detects
Clerk session death only during periodic sweeps. With webhooks, Hydra would
get IMMEDIATE notification when a session dies.

**Implementation:**
```js
// routes/auth.js — new endpoint
router.post('/clerk-webhook', async (req, res) => {
  const { type, data } = req.body;
  
  // Verify webhook signature
  if (!verifyClerkWebhookSignature(req)) return res.status(401).send();
  
  // Idempotency check
  const { duplicate } = await recordWebhookEvent(data.id, req.body);
  if (duplicate) return res.json({ ok: true });
  
  switch (type) {
    case 'session.ended':
    case 'session.revoked':
      // Find account with matching session, mark expired
      await markSessionExpiredByClerkSessionId(data.id);
      // Remove account's keys from proxy pool
      await removeFromProxyPoolBySessionId(data.id);
      break;
    case 'session.created':
      await updateSessionExpiryFromWebhook(data.id, data.expire_at);
      break;
  }
  
  res.json({ ok: true });
});
```

### Challenge: Clerk Session ID Mapping

Hydra doesn't currently store the Clerk `session_id` (the ID inside the JWT
payload). It would need to extract this from the JWT at login time and store
it in the account config to enable webhook → account mapping.

**Fix:** In `resolveSessionAfterCompletedAttempt()`, extract `session_id` from
the JWT payload and store it:
```js
const jwtPayload = decodeJwtPayloadUnsafe(sessionCookie);
if (jwtPayload?.sid) {
  config.clerkSessionId = jwtPayload.sid;
}
```

### Webhook Signature Verification

Clerk signs webhooks with `Svix` (a webhook signing standard). To verify:
```js
import { Webhook } from 'svix';
function verifyClerkWebhookSignature(req) {
  const wh = new Webhook(CLERK_WEBHOOK_SIGNING_KEY);
  try {
    wh.verify(req.body, {
      'svix-id': req.headers['svix-id'],
      'svix-timestamp': req.headers['svix-timestamp'],
      'svix-signature': req.headers['svix-signature'],
    });
    return true;
  } catch { return false; }
}
```

This requires the `CLERK_WEBHOOK_SIGNING_KEY` from the Clerk dashboard.

---

## 10. Alternative Auth Approaches

### 10.1 OpenRouter API Key Auth (No Clerk Needed for Key Operations)

**Current state:** Management keys (`sk-or-v1-*`) can call the OpenRouter
credits API directly (openrouter.js `getCredits()`). This works WITHOUT any
Clerk session.

**Opportunity:** For operations that ONLY need management key access (credits,
account snapshot, key listing), skip Clerk entirely. The proxy already does
this — it uses `sk-or-*` keys directly for API proxying.

**Where Clerk is still needed:**
- Creating management keys (no REST API, only dashboard UI/tRPC/Server Actions)
- Redeeming promo codes (no public API)
- Any operation on the /settings dashboard

**Recommendation:** Already partially implemented. `getBestManagementKey()` and
`getCredits()` work without Clerk. The gap is key provisioning and redemption.

### 10.2 OAuth Support

**Current state:** `detectAuthMethod()` (clerk-auth.js:1060) detects `oauth_google`
as an available strategy but doesn't implement it. Google OAuth requires browser
interaction (redirect flow) which can't be done purely via HTTP.

**Opportunity:**
1. **Playwright-based OAuth:** Already possible via the Playwright fallback.
   The browser opens the Google sign-in page, user completes OAuth in the
   browser window, Hydra captures the resulting session.

2. **Headless OAuth with stored tokens:** If the user provides a Google
   refresh token, Hydra could use it to obtain an access token and complete
   the OAuth flow programmatically. But Clerk doesn't expose a way to submit
   an OAuth access token — it expects the browser redirect.

3. **Clerk FAPI `oauth_callback`:** Clerk has an internal OAuth callback URL
   that receives the Google token. If we could replay this with a stored
   Google access token, we could automate OAuth without Playwright.

**Risk:** Google may detect automated OAuth and block the account.

### 10.3 Direct Clerk FAPI Without Browser/Playwright

**Current state:** MOST operations already work without Playwright:
- `obtainClerkClientCookie()` — pure HTTP
- `detectAuthMethod()` — pure HTTP
- `signInWithPassword()` — pure HTTP
- `startEmailOTP()` / `completeEmailOTP()` — pure HTTP
- `refreshSession()` — pure HTTP
- `sendMagicLink()` / `completeEmailLink()` — pure HTTP
- `touchClerkSession()` — pure HTTP
- Server Action replay — pure HTTP

**Only Playwright is needed for:**
- Management key creation (when Server Action + tRPC + REST all fail)
- Promo code redemption (when tRPC fails)
- Google OAuth (no alternative exists)
- Cloudflare challenge solving (headless browser can pass challenges)

**Opportunity:** Make Playwright a LAST resort, not a common path. The current
architecture already does this (Server Action first, Playwright last). But the
Server Action hash fragility means Playwright is hit more often than necessary.

### 10.4 Service Tokens / Machine-to-Machine Auth

**Current state:** Not implemented. Every Hydra operation requires either:
1. The admin JWT (for Hydra API calls)
2. A Clerk session cookie (for OpenRouter dashboard calls)

**Opportunity for Hydra's own auth:**
- Add API key auth for Hydra's proxy endpoint (`POST /v1/chat/completions`)
- Currently the proxy uses `sk-hydra-*` or `sk-proj-*` derived keys
  (store.js:672-682) — these ARE effectively service tokens

**Opportunity for OpenRouter M2M:**
- If OpenRouter adds a service account / machine-to-machine auth flow,
  Hydra could maintain sessions without Clerk cookies at all
- This would eliminate the entire session refresh pipeline for key operations

### 10.5 Hybrid Approach: Session-Free Where Possible

**Recommendation:** Split operations into two categories:

| Category | Auth Required | Clerk Session Needed? |
|----------|--------------|----------------------|
| API proxying | sk-or-* key | NO |
| Credits/balance check | sk-or-* management key | NO |
| Account snapshot | sk-or-* management key | NO |
| Key listing | sk-or-* management key | NO |
| Key creation | Dashboard session | YES |
| Promo redemption | Dashboard session | YES |
| Account creation | Dashboard session | YES |

For the YES rows, the session pipeline is critical. For the NO rows,
Clerk sessions are unnecessary. The proxy should prefer the management key
path whenever possible.

---

## Summary of Critical Findings

### HIGH PRIORITY

1. **Session lifecycle gap** — Hydra can show 'active' for days after Clerk death.
   Fix: Add webhook listener for `session.ended`/`session.revoked`.

2. **Server Action hash fragility** — Hard-coded hash breaks on every OpenRouter deploy.
   Fix: Add dynamic hash discovery from page HTML/build manifest.

3. **Encryption key rotation** — No recovery path if LOCAL_SECRET changes.
   Fix: Add key versioning + re-encryption endpoint.

4. **Sequential refresh** — 30 accounts refreshed serially = 2+ min worst case.
   Fix: Parallel refresh with concurrency control + per-account locks.

### MEDIUM PRIORITY

5. **Magic link CSRF** — GET callback performs state changes, no CSRF protection.
   Fix: Add state token + switch to POST callback.

6. **OTP provision race** — 60s JWT TTL vs 30-60s provision time.
   Fix: Refresh JWT immediately after OTP before starting provision.

7. **Missing security headers** — No HSTS, X-Frame-Options, CSP, etc.
   Fix: Add helmet or manual headers to Express.

8. **key-utils.js vs MGMT_KEY_RE prefix conflict** — `classifyOpenRouterKey()` says
   `sk-or-mgmt-` is management, but `MGMT_KEY_RE` only matches `sk-or-v1-`.
   Fix: Harmonize — OpenRouter management keys ARE `sk-or-v1-` per dashboard-api.js:45-47.

### LOW PRIORITY

9. **Password policy** — min 1 char for admin password. Increase to 8+.
10. **Cookie format dual-standard** — Legacy single-token vs modern semicolon-separated.
    Fix: Migrate all to modern format on first read.
11. **No step-up auth** — Destructive ops (nuke, delete) need only regular JWT.
    Fix: Add elevated session pattern.
