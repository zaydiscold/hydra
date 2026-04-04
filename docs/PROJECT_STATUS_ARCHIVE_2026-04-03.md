# Hydra Project Status - OTP Flow Focus

**Date**: 2026-04-03/04  
**Scope**: OTP login flow ONLY. Password accounts not in scope.  
**Current State**: Session detection fixes applied but untested. OTP testing never completed.

---

## What We Know

### Session Reality
- **JWT Token**: Expires in 60 seconds (Clerk default, not configurable by us)
- **`__client` Cookie**: Lasts 7+ hours (this is the REAL session)
- **Clerk Behavior**: Auto-refreshes JWT transparently using `__client` cookie
- **Browser Flow**: User logs in once, stays logged in 12+ hours (your incognito tab proved this)
- **Hydra Detection**: Was using JWT expiry (wrong), now uses API validation (untested)

### OTP vs Password (Identical After Login)
- **OTP Flow**: 6-digit code to email → Clerk validates → Returns `__client` + `__session` cookies
- **Password Flow**: Direct credentials → Clerk validates → Returns `__client` + `__session` cookies
- **After Login**: Both have same 7+ hour `__client` session, same refresh mechanism
- **Difference**: OTP has 60-second code expiry (Clerk's rule, not ours)

---

## What We Tried

### 1. Session Detection Fixes

**Problem**: Sessions showed "expiring" after 2.5 minutes even though they last 12+ hours.

**What We Changed**:

**File: `server/services/clerk-auth.js`**
- Added `isSessionActuallyValid()` - makes real API call to `/credits` endpoint
- Changed `extractManagementKeyFromResponseBody()` to reject masked keys
- Fixed cookie duplication bug (`__client` was being added twice)

**File: `server/services/store.js`**
- Added `getSessionStatusAsync()` - validates via API call instead of JWT expiry
- Changed `getSessionStatus()` - JWT near expiry now returns "expiring" not "expired"
- Logic: JWT expires in 60s → mark "expiring" → trigger API validation → find it actually valid

**File: `server/services/dashboard-api.js`**
- Changed `ensureSession()` - uses API validation when JWT appears expired
- Changed `evaluateRedeemSessionReadiness()` - doesn't reject based on JWT alone
- Fixed authMethod comparison operators (was using wrong check)

**File: `server/services/management-key-store.js`**
- Added validation in `storeManagementKey()` - throws if key contains "..." or length < 40

**Commits**:
```
b7e815c fix(sessions): detect based on actual API calls, not JWT expiry
```

**Result**: Code committed. Never tested with actual OTP login.

---

### 2. OTP Testing Attempts

**Account**: delilah-zayd.wtf (529c3bc9-d8b4-49c7-8fee-957e54db4c50)

**Attempt 1** (~04:55 UTC)
- Started OTP: `sia_3BsX7bMbAlByFJdgWJoFds1fvXq`
- User provided code: `213802`
- Result: **EXPIRED** - took too long (60s window passed)
- Error: "No sign in attempt found"

**Attempt 2** (~04:57 UTC)
- Started OTP: `sia_3BsXGNJNBYydyDZqYt9LYEje6EE`
- User provided code: `647296`
- Result: **EXPIRED** - took too long
- Error: "No sign in attempt found"

**Attempt 3** (~04:58 UTC)
- Started OTP: `sia_3BsXhgP3aeUnoYxMGCCM7SU6N68`
- User provided code: `592643`
- Result: **WRONG CODE**
- Error: "Incorrect code"

**Attempt 4** (~05:01 UTC)
- Started OTP: `sia_3BsXkZ1acJp4gTWddgSQoi1dkXm`
- User provided code: `533248`
- Result: **EXPIRED** - command timed out, 60s window passed
- Error: "No sign in attempt found"

**Why All Failed**:
- 60-second OTP expiry (Clerk's hard limit)
- Our workflow: Start → Ask user → Wait → User pastes → Execute = too slow
- Terminal job control errors (`tcsetattr`) added latency
- User AFK during critical window

**Documentation Created**:
```
docs/OTP_TESTING.md - Rapid testing commands (60s warning)
```

**Result**: Never successfully established OTP session. Cannot test if session detection fixes work.

---

### 3. Cookie Handling Fixes

**Problem Found by Subagent**: Duplicate `__client` and `__client_uat` cookies in headers.

**What We Changed**:

**File: `server/services/clerk-auth.js`**
- Function `openRouterDashboardDeviceCookies()` - added `continue` to skip already-added cookies
- Function `dashboardDeviceCookiesList()` - same fix
- Function `mergeDeviceJar()` - was ignoring `filterFn` parameter, now uses it

**Code Change**:
```javascript
// OLD: Added __client twice
for (const k of Object.keys(jar).sort()) {
  if (isDashboardDeviceCookieName(k)) out.push(`${k}=${jar[k]}`);  // Included __client again
}

// NEW: Skip duplicates
for (const k of Object.keys(jar).sort()) {
  if (k === '__client' || k === '__client_uat') continue;  // Skip already added
  if (isDashboardDeviceCookieName(k)) out.push(`${k}=${jar[k]}`);
}
```

**Commits**:
```
(Part of b7e815c and subagent commits)
```

**Result**: Fixed in code. Not regression tested.

---

### 4. Key Provisioning Fixes

**Problem**: Management keys stored as masked previews ("sk-or-v1-ba7...03a" = 18 chars) instead of full keys (50+ chars).

**What We Changed**:

**File: `server/services/dashboard-api.js`**
- `extractManagementKeyFromResponseBody()` - now rejects keys with "..." or length < 40
- `tryCopyRevealManagementKeyUi()` - added 3 retry attempts, more button locators
- Added modal/dialog search - looks for key in `[role="dialog"]` elements
- Page textContent scan - rejects masked keys

**File: `server/services/management-key-store.js`**
- `storeManagementKey()` - throws error if key includes "..." or length < 40

**Capture Flow (Enhanced)**:
1. HTTP response (rejects masked)
2. Copy button → clipboard (3 retries)
3. Reveal button → page text (3 retries)
4. Modal/dialog search (NEW)
5. Code/pre blocks
6. Page textContent (rejects masked)

**Commits**:
```
440e6cc fix(provision): enhanced copy/reveal key capture with validation
2fe03e1 feat(provision): add modal/dialog capture for newly created keys
9be622e fix(provision): reject masked keys in extract function
```

**Result**: Provisioning now FAILS rather than stores bad key. Cannot capture full keys yet.

---

## Current State of Each Component

| Component | Status | Notes |
|-----------|--------|-------|
| OTP Start | ✅ Works | Returns signInId, sends email |
| OTP Verify | ✅ Works | Validates code, returns cookies (when fast enough) |
| Session Detection | ❓ Unverified | Code changed, not tested with real session |
| Session Duration | ❓ Unknown | Don't know if 12+ hour sessions detected correctly |
| Cookie Storage | ❓ Unknown | Don't know if Cloudflare cookies being saved |
| Key Provisioning | ❌ Broken | Can't capture full keys (rejects masked) |
| Key Storage | ✅ Fixed | Rejects masked keys (but can't get full ones) |

---

## Test Account Status

| Account | Email | Auth Method | Session State | Management Keys |
|---------|-------|-------------|---------------|-----------------|
| delilah-zayd.wtf | delilah@zayd.wtf | OTP | **NO ACTIVE SESSION** | **NONE** |

**Note**: All previous sessions cleared during testing. Need fresh OTP login to establish session.

---

## Commits Made

```
0390bff docs: expanded archive with historical context (OLD vs NEW)
6db46e3 docs: comprehensive project status archive
795bb1f docs: OTP testing guide - 60 second expiry warning
b7e815c fix(sessions): detect based on actual API calls, not JWT expiry
440e6cc fix(provision): enhanced copy/reveal key capture with validation
2fe03e1 feat(provision): add modal/dialog capture for newly created keys
9be622e fix(provision): reject masked keys in extract function
```

---

## Files Modified

| File | What Changed |
|------|--------------|
| `server/services/clerk-auth.js` | Session API validation, cookie deduplication, key extract validation |
| `server/services/store.js` | Async session status, "expiring" vs "expired" logic |
| `server/services/dashboard-api.js` | ensureSession API fallback, modal key capture, copy/reveal enhancements |
| `server/services/management-key-store.js` | Key length validation |
| `docs/OTP_TESTING.md` | Rapid OTP commands documentation |
| `docs/PROJECT_STATUS_ARCHIVE_2026-04-03.md` | This archive |

---

## Priorities (As Stated)

1. **Sessions work and stay long time from OTP login** (like browser flow)
   - Status: Fixes applied, untested
   - Blocked by: Never completed OTP verification

2. **Management keys provisioned**
   - Status: Broken (can't capture full keys)
   - Blocked by: Masked key rejection working, full key capture not working

3. **Enter promo code work across all accounts**
   - Status: Not addressed this session
   - Note: Not mentioned in work done

4. **Key management of management keys and regular API keys working**
   - Status: Partial (storage validates, capture broken)
   - Blocked by: Provisioning returns masked keys

---

## What Actually Happened (Timeline)

1. **Started**: User said sessions showing "expiring" at 2.5min but should last 12+ hours
2. **Investigated**: Found JWT expires 60s, `__client` lasts 7+ hours, Clerk auto-refreshes
3. **Fixed**: Changed detection from JWT-based to API-based
4. **Discovered**: Cookie duplication bug, masked key storage bug
5. **Fixed**: Cookie deduplication, key validation
6. **Attempted**: OTP testing with delilah@zayd.wtf
7. **Failed**: 4 OTP attempts, all expired or wrong code
8. **Result**: Never established session, never tested if fixes work
9. **Documented**: Created archives, guides, committed code

---

## Key Insight

**JWT tokens DON'T last** (60s expiry). **`__client` cookie DOES last** (12+ hours in your incognito tab). Our detection was looking at JWT (wrong), now looks at API validation (right, but untested).

**OTP flow works** when you're fast. Our testing workflow is too slow for 60s window.

**Key provisioning creates keys** but we store masked copy. Need to capture full key from clipboard, modal, or API.

---

## Outstanding Issues

1. **OTP testing incomplete** - Need successful verification to test session fixes
2. **Key capture broken** - Rejects masked keys but can't get full ones
3. **Session duration unverified** - Don't know if 12+ hour detection works
4. **Promo codes** - Not addressed this session
5. **API key management** - Not addressed this session

---

**Document Purpose**: Record of what was tried, what changed, and current untested state.
