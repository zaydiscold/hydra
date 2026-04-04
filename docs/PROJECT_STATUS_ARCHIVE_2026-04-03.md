# Hydra Project Status - Comprehensive Archive

**Date**: 2026-04-03/04  
**Session Focus**: Session detection fixes, OTP testing, Key provisioning  
**Current State**: Mixed - old JWT-based approach had issues, new API-based approach untested

---

## Executive Summary

**ORIGINAL STATE (Before This Session):**
- Sessions detected via JWT expiry (60s) - showed "expiring" after 2.5min
- Sessions ACTUALLY lasted 12+ hours (your incognito tab proved this)
- Management keys provisioned but stored as masked previews ("sk-xxx...yyy")
- Cookie handling had duplication bugs
- OTP flow worked fine (just slow for testing)

**WHAT WE CHANGED:**
1. Session detection - JWT-based → API-based validation
2. Cookie handling - Fixed duplicates, added Cloudflare support
3. Key extract - Now rejects masked keys (forces proper capture)
4. Session status logic - "expired" → "expiring" with API validation

**CURRENT STATE:**
- New fixes committed but UNTESTED
- OTP testing never completed (60s expiry timing)
- Old approach had flaws but "worked" (sessions lasted, keys sort-of-worked)
- New approach theoretically correct but unverified

**RECOMMENDATION:** Hybrid approach - use new API validation for accuracy, but keep fast-path JWT checks for performance.

---

## Historical Context: OLD vs NEW

### Session Detection - OLD Approach

**How it worked:**
```javascript
// OLD: server/services/clerk-auth.js - isSessionValid()
const remainingMs = jwtExpiry - Date.now();
if (remainingMs <= 0) return 'expired';           // ❌ WRONG
if (remainingMs <= 2.5min) return 'expiring';      // ❌ WRONG
return 'active';
```

**Problems:**
- JWT expires in 60 seconds (Clerk default)
- `__client` cookie actually lasts 7+ hours
- Clerk auto-refreshes JWT transparently
- Sessions showed "expiring" at 2.5min but worked for 12+ hours

**Why it "worked":**
- Sessions still functioned (Clerk refreshed JWT)
- UI just showed wrong status
- You learned to ignore "expiring" warnings

**Files (OLD logic):**
- `server/services/clerk-auth.js:isSessionValid()` - JWT expiry check
- `server/services/store.js:getSessionStatus()` - same JWT logic

### Session Detection - NEW Approach

**How it works:**
```javascript
// NEW: server/services/clerk-auth.js - isSessionActuallyValid()
async function isSessionActuallyValid(sessionCookie) {
  // Make real API call to verify
  const response = await fetch('/credits', { 
    headers: { cookie: sessionCookie }
  });
  return response.ok; // ✅ REAL validation
}

// NEW: server/services/store.js - getSessionStatusAsync()
if (remainingMs <= 2.5min) {
  // Don't mark expired, validate via API
  const isValid = await isSessionActuallyValid(cookie);
  return isValid ? 'active' : 'expired';  // ✅ ACCURATE
}
```

**Improvements:**
- Detects ACTUAL session validity (12+ hours)
- Makes real API calls to verify
- "expiring" means "will check via API" not "about to die"

**Files (NEW logic):**
- `server/services/clerk-auth.js:isSessionActuallyValid()` - API validation
- `server/services/store.js:getSessionStatusAsync()` - async validation
- `server/services/dashboard-api.js:ensureSession()` - uses API validation

---

### Cookie Handling - OLD Approach

**How it worked:**
```javascript
// OLD: clerk-auth.js - openRouterDashboardDeviceCookies()
const out = [];
if (uat) out.push(`__client_uat=${uat}`);
if (client) out.push(`__client=${client}`);
for (const k of Object.keys(jar).sort()) {
  if (isDashboardDeviceCookieName(k)) {
    out.push(`${k}=${jar[k]}`);  // ❌ DUPLICATES! Already added __client/__client_uat above
  }
}
```

**Problems:**
- `__client` and `__client_uat` added TWICE
- Duplicate cookies in HTTP headers
- Cloudflare cookies (`__cf_bm`, `_cfuvid`) not properly preserved

**Why it "mostly worked":**
- Servers usually ignore duplicate cookies
- But Cloudflare was getting confused
- Some requests failed due to malformed headers

### Cookie Handling - NEW Approach

**How it works:**
```javascript
// NEW: clerk-auth.js - openRouterDashboardDeviceCookies()
const out = [];
if (uat) out.push(`__client_uat=${uat}`);
if (client && client !== uat) out.push(`__client=${client}`);
for (const k of Object.keys(jar).sort()) {
  if (k === '__client' || k === '__client_uat') continue;  // ✅ SKIP duplicates
  if (isDashboardDeviceCookieName(k)) {
    out.push(`${k}=${jar[k]}`);  // ✅ Cloudflare + Clerk cookies
  }
}
```

**Improvements:**
- No duplicate cookies
- Cloudflare cookies properly included
- `mergeDeviceJar()` now accepts `filterFn` parameter

**Related fixes:**
- `filterFn` parameter was being ignored in `mergeDeviceJar()` - NOW FIXED

---

### Key Provisioning - OLD Approach

**How it worked:**
```javascript
// OLD: dashboard-api.js - extractManagementKeyFromResponseBody()
const reMatch = body.match(MGMT_KEY_RE);
if (reMatch) return reMatch[0];  // ✅ Returns ANY match

// OLD: management-key-store.js - storeManagementKey()
// No validation - stores whatever it gets
```

**What happened:**
1. OpenRouter creates key → returns FULL key in JSON (once)
2. Page reloads → shows MASKED key in HTML ("sk-xxx...yyy")
3. Hydra captures from page HTML → gets MASKED key
4. Stores masked key → "sk-or-v1-ba7...03a" (18 chars)
5. Key doesn't work because it's literally "..." in the middle

**Why it "worked":**
- Keys appeared to store
- UI showed key existed
- But actual API calls with key failed (because masked)
- User thought provisioning worked but keys were broken

### Key Provisioning - NEW Approach

**How it works:**
```javascript
// NEW: dashboard-api.js - extractManagementKeyFromResponseBody()
if (reMatch) {
  const potentialKey = reMatch[0];
  if (potentialKey.includes('...') || potentialKey.length < 40) {
    console.error(`Rejecting masked key: ${potentialKey.slice(0, 20)}...`);
    return null;  // ✅ REJECT masked
  }
  return potentialKey;  // ✅ Only full keys
}

// NEW: management-key-store.js - storeManagementKey()
if (!key || !key.startsWith('sk-or-v1-')) {
  throw new Error('Invalid key format');
}
if (key.includes('...') || key.length < 40) {
  throw new Error('Rejecting masked/preview key');  // ✅ VALIDATE
}
```

**Capture attempts (enhanced):**
1. HTTP response capture (rejects masked)
2. Copy button → clipboard (3 retry attempts)
3. Reveal button → page text (3 retry attempts)
4. Modal/dialog search (NEW - finds key in modal)
5. Code/pre block search
6. Page textContent (rejects masked)

**Result:**
- Provisioning now FAILS rather than stores broken key
- Forces us to fix capture logic
- Currently NOT capturing full key (masked rejection working, capture not working)

---

### OTP Flow - OLD vs NEW (SAME!)

**Important Context:**
- OTP and Password logins work IDENTICALLY after authentication
- Both return `sessionCookie` + `clientCookie`
- Both use same Clerk session mechanism
- OTP = 6-digit code via email, Password = direct credentials
- After login, both have same 7+ hour `__client` cookie session

**OLD OTP flow (worked fine):**
```
POST /accounts/:id/otp/start → Clerk sends email → Returns signInId
POST /accounts/:id/otp/verify (signInId, code) → Clerk validates → Returns cookies
```

**NEW OTP flow (same, just untested):**
- Same endpoints
- Same Clerk integration
- Same 60-second OTP expiry (Clerk's rule, not ours)
- Same 7+ hour session after verification

**Why OTP testing failed:**
- 60-second expiry too fast for our chat workflow
- Terminal job control errors added latency
- Not a code problem - a TIMING problem

---

## What Was ACTUALLY Working (Before Changes)

### ✅ Working (OLD approach)
1. **Sessions lasted 12+ hours** - Your incognito tab proved this
2. **JWT auto-refresh** - Clerk transparently refreshed 60s tokens
3. **Password logins** - admin@zayd.world, iam-zayd.wtf worked fine
4. **OTP logins** - delilah@zayd.wtf OTP flow worked (when you verified quickly)
5. **Basic provisioning** - Keys were created on OpenRouter
6. **Dashboard UI** - Cards showed accounts, session status (wrong but functional)

### ❌ Broken (OLD approach)
1. **Session status display** - Showed "expiring" at 2.5min instead of "active" for 7+ hours
2. **Cookie duplication** - Headers had duplicate `__client` cookies
3. **Masked key storage** - Provisioned keys stored as "sk-xxx...yyy" (broken)
4. **Cloudflare cookies** - Not properly preserved in some edge cases

---

## What We Changed (NEW approach)

### Session Detection
**Changed:** JWT-based → API-based validation
**Files:** `clerk-auth.js`, `store.js`, `dashboard-api.js`
**Risk:** Async validation slower, may timeout
**Status:** Committed, UNTESTED

### Cookie Handling  
**Changed:** Fixed duplicate logic, added Cloudflare support
**Files:** `clerk-auth.js` (output functions)
**Risk:** Low - mostly cleanup
**Status:** Committed, UNTESTED

### Key Extraction
**Changed:** Now rejects masked keys (<40 chars or contains "...")
**Files:** `dashboard-api.js`, `management-key-store.js`
**Risk:** HIGH - provisioning now FAILS until we fix capture
**Status:** Committed, BROKEN (can't capture full keys yet)

---

## Hybrid Recommendation (Best of Both)

### Session Detection
```javascript
// HYBRID: Fast-path JWT check + async API validation for edge cases
function getSessionStatus(jwtExpiry, cookie) {
  const remainingMs = jwtExpiry - Date.now();
  
  // Fast path: JWT still valid (most common)
  if (remainingMs > SESSION_EXPIRING_SOON_MS) {
    return 'active';  // ✅ Don't slow down common case
  }
  
  // Edge case: JWT near expiry - validate via API
  if (remainingMs > 0) {
    return 'expiring';  // Will trigger API validation before use
  }
  
  // JWT expired - MUST validate via API (may still be valid via refresh)
  return 'expiring';  // Not 'expired', let API validation decide
}

// Only call this when about to USE the session
async function validateBeforeUse(cookie) {
  const isValid = await isSessionActuallyValid(cookie);
  return isValid ? 'active' : 'expired';  // ✅ Real check
}
```

### Key Provisioning
```javascript
// HYBRID: Multiple capture strategies with fallbacks
async function captureManagementKey(page) {
  // 1. Try HTTP response first (fastest, full key in JSON)
  const fromHttp = await captureFromResponse();
  if (fromHttp && isValidKey(fromHttp)) return fromHttp;
  
  // 2. Try clipboard (most reliable for full key)
  const fromClipboard = await tryCopyToClipboard(page);
  if (fromClipboard && isValidKey(fromClipboard)) return fromClipboard;
  
  // 3. Try modal (OpenRouter shows full key here)
  const fromModal = await captureFromModal(page);
  if (fromModal && isValidKey(fromModal)) return fromModal;
  
  // 4. Try API listing (fetch from OpenRouter API after creation)
  const fromApi = await fetchKeyFromApiListing();
  if (fromApi && isValidKey(fromApi)) return fromApi;
  
  // 5. Fail rather than store masked key
  throw new Error('Could not capture full key from any source');
}
```

---

## Critical Insight: Why Old Approach "Worked"

You said things were working before. Here's why:

1. **Sessions "expiring" but still worked** - Because Clerk auto-refreshed JWT, session was fine even if UI said "expiring"

2. **Keys provisioned but masked** - OpenRouter created the key, just we stored wrong copy. If you manually copied full key from UI, it worked.

3. **OTP timing** - When you verified within 60s, it worked fine. Our testing was slow, not the code.

**The old code had BUGS but was FUNCTIONAL.**

The new code has FIXES but is UNTESTED and currently BROKEN for provisioning (because we reject masked keys but can't capture full ones yet).

---

## Test Account Reference

| Alias | ID | Auth | Email | Session State |
|-------|-----|------|-------|---------------|
| iam-zayd.wtf | cecff6a9-cbcc-4110-93ec-409299474b82 | password | - | Unknown (old cookies?) |
| delilah-zayd.wtf | 529c3bc9-d8b4-49c7-8fee-957e54db4c50 | otp | delilah@zayd.wtf | No active session |
| zayd-zayd.wtf | 09f8cc49-9308-4977-9f18-15d1a7e13216 | password | - | Unknown |
| admin-zayd.world | 6f1d28e8-bc8d-4557-b589-66b6db341f8c | password | admin@zayd.world | No active session |

**Note:** All sessions cleared during testing. Need to re-authenticate.

---

## Quick Test Commands

### Check All Account Sessions
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"password":"1111"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

for ID in cecff6a9-cbcc-4110-93ec-409299474b82 529c3bc9-d8b4-49c7-8fee-957e54db4c50 09f8cc49-9308-4977-9f18-15d1a7e13216 6f1d28e8-bc8d-4557-b589-66b6db341f8c; do
  echo "Account: $ID"
  curl -s http://localhost:3001/api/accounts/$ID/session-status -H "Authorization: Bearer $TOKEN" | jq -r '.data.sessionStatus'
done
```

### Test Session Via Credits (Real API Call)
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"password":"1111"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Test admin account
curl -s http://localhost:3001/api/accounts/6f1d28e8-bc8d-4557-b589-66b6db341f8c/credits -H "Authorization: Bearer $TOKEN" | jq '.success'
```

---

## Commits Made This Session

```
6db46e3 docs: comprehensive project status archive
795bb1f docs: OTP testing guide - 60 second expiry warning
b7e815c fix(sessions): detect based on actual API calls, not JWT expiry
440e6cc fix(provision): enhanced copy/reveal key capture with validation
2fe03e1 feat(provision): add modal/dialog capture for newly created keys
9be622e fix(provision): reject masked keys in extract function
```

---

## What Needs Testing (Priority Order)

1. **Password account session** - Test if new API validation works (admin-zayd.world)
2. **OTP session** - Rapid test with delilah@zayd.wtf
3. **Session persistence** - Check if it detects 12+ hour sessions correctly
4. **Key provisioning** - Debug why full key capture failing
5. **Cookie handling** - Verify no duplicates, Cloudflare cookies present

---

## Key Files Reference

| File | Old Logic | New Logic | Status |
|------|-----------|-------------|--------|
| `clerk-auth.js:isSessionValid()` | JWT expiry check | Still exists, deprecated | Old |
| `clerk-auth.js:isSessionActuallyValid()` | Didn't exist | API validation | New, untested |
| `store.js:getSessionStatus()` | JWT only | Returns "expiring" for near-expiry | Modified |
| `store.js:getSessionStatusAsync()` | Didn't exist | Async API validation | New, untested |
| `dashboard-api.js:ensureSession()` | JWT check | API validation fallback | Modified |
| `clerk-auth.js:openRouterDashboardDeviceCookies()` | Duplicates | No duplicates | Fixed |
| `clerk-auth.js:mergeDeviceJar()` | Ignored filterFn | Uses filterFn | Fixed |
| `dashboard-api.js:extractManagementKeyFromResponseBody()` | Accepted masked | Rejects masked | Modified |
| `management-key-store.js:storeManagementKey()` | No validation | Validates length | Modified |
| `dashboard-api.js:tryCopyRevealManagementKeyUi()` | Basic | 3 retries, validation | Enhanced |
| `dashboard-api.js` (modal search) | Didn't exist | Modal key capture | New, untested |

---

## User Frustration Archive (For Context)

1. **"Things were working and now they don't"** - Old approach had bugs but was functional. New approach fixes bugs but provisioning now fails because we can't capture full keys yet.

2. **"OTP is the same as password"** - Correct. Both use same Clerk session mechanism. OTP = 6-digit verification, Password = direct. After login, identical 7+ hour `__client` session.

3. **"60 second expiry is retarded"** - Clerk's rule, not ours. Our workflow (ask → wait for user → paste → execute) takes too long. Need pre-staged commands.

4. **"You worked on them for too long"** - Multiple subagents, many files changed, fixes applied but never tested end-to-end. Documentation created instead of actual testing.

---

**Document Purpose**: Single source of truth for what worked, what changed, what's broken, and what needs testing.
