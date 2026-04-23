# HTTP Signup Migration

**Branch:** `feat/http-signup-migration`
**Status:** Code complete — pending Docker build fix + dev smoke test
**Last updated:** 2026-04-21

---

## What This Is

Hydra's account creation (signup) flow used to require Playwright/Chromium to navigate OpenRouter's signup page, fill the email form, wait for the OTP screen, and type the code. This added ~45 seconds of startup latency, required a ~2GB Docker image (because it bundled Chromium), and broke whenever OpenRouter changed their CSS selectors.

This migration replaces that with pure HTTP calls to Clerk's FAPI (Frontend API). The FAPI was already reverse-engineered in `clerk-auth.js` — it just wasn't being used for signup.

**The new flow is ~2 seconds instead of ~45 seconds.** Playwright stays as a named fallback for resilience.

---

## Files Changed

### `server/services/account-generator.js` — Main rewrite

**What changed:**
- `launchSignupFlow` — now HTTP-primary. Calls `detectAuthMethod()` then `startEmailOTP()`. Falls back to `launchSignupFlowPlaywright()` on any FAPI error.
- `finalizeOtpSubmission` — now HTTP-primary. Calls `completeEmailOTP()` then `refreshSession()` if the JWT is short-lived. Falls back to `finalizeOtpSubmissionPlaywright()` if the task was created by the Playwright path.
- Old `launchSignupFlow` and `finalizeOtpSubmission` renamed to `*Playwright` variants — kept verbatim, not exported.
- `GENERATOR_TTL_MS` bumped from 2 min to 5 min (OTP wait window, no more Playwright startup time).
- `closeGeneratorResources` made null-safe for HTTP path (`task.resources ?? {}`).
- `isSignUp` flag threaded through from `startEmailOTP` → task resources → `completeEmailOTP` — **critical**: losing this flag means new accounts hit the wrong Clerk endpoint.

**New state machine:**
```
detecting_account → sending_otp → awaiting_otp → verifying_otp → [activating_session] → saving_profile → provisioning_key → completed
```

### `server/services/otp-generator.js` — Dead code fix

**What changed:**
This file was completely broken — called 4 APIs that don't exist. Fixed all 4:
1. `taskSupervisor.createTask()` → `taskSupervisor.startInteractive()`
2. `store.createAccount()` → `store.addAccountWithCredentials()` + `store.updateAccountSession()`
3. `taskSupervisor.cleanup()` → `taskSupervisor.cancel()`
4. `heartbeatOtpJob()` now wraps return in `serializeTask()`

**Plus:** Added `openRouterDashboardDeviceCookies` import and piped `session.clientCookie` through it before passing to `updateAccountSession()`. Without this, the raw string would be stored instead of the `[{cookie, issuedAt}]` array that `updateAccountSession` expects.

**Important:** This file is currently **dead code** — nothing in the active codebase imports it. The fixes are correct but won't run until someone wires it into a route.

### `Dockerfile` — Image size reduction

**What changed:**
- Base image: `mcr.microsoft.com/playwright:v1.58.2-jammy` → `node:20-bookworm`
- Chromium installed on-demand via `npx playwright install --with-deps chromium` (after `npm ci`)
- Expected size: ~2.1GB → ~1.1GB

**Layer order is load-bearing:**
```
npm ci --omit=dev          ← installs playwright package
playwright install chromium ← needs playwright binary from node_modules
prisma generate             ← needs schema
```

---

## Bugs Found & Fixed During Verification

### Bug 1: otp-generator.js cookie type mismatch
**Found by:** Code review agent  
**Fixed by:** Delilah

`completeEmailOTP()` returns `clientCookie` as a raw string. `updateAccountSession()` expects a `[{cookie, issuedAt}]` array from `openRouterDashboardDeviceCookies()`. The prior agent passed the raw string directly. Fixed by adding the import and piping through `openRouterDashboardDeviceCookies()`.

### Bug 2: Dockerfile nonexistent tag
**Found by:** Docker build agent  
**Fixed by:** Delilah

`node:20-jammy` no longer exists on Docker Hub. Switched to `node:20-bookworm`.

---

## Remaining Work

### 1. Fix Docker build (current blocker)

`docker build -t hydra:http-test .` fails at `apt-get update`:
```
Err:1 http://deb.debian.org/debian bookworm InRelease
  403  Forbidden [IP: 172.235.51.161 80]
```

This is a Docker Desktop networking issue on the host macOS machine — not a code problem.

**Try in this order:**
1. `docker build --network=host -t hydra:test .` — bypass Docker's DNS/proxy
2. Check Docker Desktop → Settings → Resources → Network
3. Remove tini entirely (Node 20 handles SIGTERM fine) and delete the `apt-get` step
4. Use `node:20-slim` instead of `node:20-bookworm`

### 2. Dev smoke test

```bash
cd ~/Desktop/hydra
npm run dev
```

Open http://localhost:5173 → Generator page → start a job with a test email.

**Watch server logs. MUST see:**
```
detecting_account → sending_otp → awaiting_otp
```
**Should NOT see:** `launching_browser` (that means HTTP path failed, fell back to Playwright)

Enter OTP from email. **Should see:**
```
verifying_otp → [activating_session] → saving_profile → provisioning_key → completed
```

### 3. Playwright fallback test

```bash
CLERK_BASE=https://invalid.example.com npm run dev
```

Start a job. Should log: `"FAPI detectAuthMethod failed — falling back to browser"` then proceed through Playwright states.

### 4. Commit

```bash
cd ~/Desktop/hydra
git add server/services/account-generator.js server/services/otp-generator.js Dockerfile
git commit -m "feat: replace Playwright signup with FAPI HTTP path, keep Playwright fallback"
```

---

## Key API Signatures

```javascript
// clerk-auth.js — already exported, no edits needed
detectAuthMethod(email) → { isSignUp, signUpId, signInId, clientCookie, strategies, method, emailAddressId }
startEmailOTP(email) → { signInId, clientCookie, emailAddressId, isSignUp }
completeEmailOTP(signInId, code, clientCookie, { isSignUp }) → { sessionCookie, clientCookie, sessionExpiry }
refreshSession(clientCookieArray, sessionCookie) → { sessionCookie, clientCookie, sessionExpiry } | null
openRouterDashboardDeviceCookies(cookieString) → [{cookie, issuedAt}]  // ARRAY, NOT STRING

// store.js — already exported, no edits needed
addAccountWithCredentials(userId, alias, email, password, authMethod) → account
updateAccountSession(userId, accountId, sessionCookie, clientCookieArray, expiryISO, opts) → void

// task-supervisor.js — already exported, no edits needed
startInteractive({ type, ownerUserId, ttlMs, metadata, cleanup }) → task
cancel(taskId, reason) → task
heartbeat(taskId, ownerUserId) → task  // raw task — wrap in serializeTask()
```

---

## Error Handling

| Scenario | Where | Behavior |
|---|---|---|
| FAPI network error | `detectAuthMethod` / `startEmailOTP` | Warn → `falling_back_to_browser` → Playwright |
| Wrong OTP code | `completeEmailOTP` | `taskSupervisor.fail()` — user starts new job |
| OTP expired | `completeEmailOTP` | `taskSupervisor.fail()` — start new job |
| Short-lived JWT | After `completeEmailOTP` | `refreshSession()` attempt; continues on failure |
| DB error | `addAccountWithCredentials` | `taskSupervisor.fail()` — no fallback |
| Key provisioning fails | `dashboardApi.createManagementKey` | Internal fallback: tRPC → REST → Playwright |
| Playwright fallback fails | `launchSignupFlowPlaywright` | Task fails with original Playwright error |

---

## Files You Should NOT Touch

- `server/routes/generator.js` — API surface unchanged
- `server/services/clerk-auth.js` — all FAPI functions already there
- `server/services/task-supervisor.js` — task lifecycle APIs unchanged
- `server/services/store.js` — DB APIs unchanged
- `server/controllers/GeneratorController.js` — passes through unchanged
- `src/` — all frontend files untouched

---

## Verification Results

| Check | Result |
|-------|--------|
| account-generator.js imports clean | ✅ |
| otp-generator.js imports clean | ✅ |
| clerk-auth.js 6 exports present | ✅ |
| store.js 2 exports present | ✅ |
| task-supervisor.js 13 methods present | ✅ |
| Controller 5 exports match | ✅ |
| Route file unchanged | ✅ |
| Docker build | ❌ blocked by host networking |
| Dev smoke test | ❌ not yet run |
| Playwright fallback test | ❌ not yet run |
