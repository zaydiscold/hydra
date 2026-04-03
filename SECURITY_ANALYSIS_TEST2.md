# Hydra Cookie Fixes - End-to-End Security Analysis Report (Test #2)

**Analysis Date:** April 3, 2026  
**Analyst:** Security Testing Agent  
**Scope:** Hydra Router Cookie Handling, Provision Mechanism, Session Management  

---

## Executive Summary

This report documents a rigorous end-to-end security analysis of the Hydra cookie fixes. The recent fixes addressed:
1. Duplicate cookies bug (__client/__client_uat added twice)
2. mergeDeviceJar() Cloudflare cookie filtering
3. HTML-to-JSON conversion issues
4. Session persistence to database

**Overall Risk Assessment: MEDIUM** - Several edge cases and potential failure modes identified that could impact security and reliability.

---

## 1. Critical Code Paths Analyzed

### 1.1 Provision Mechanism Flow (dashboard-api.js)

**Primary Flow:**
```
ensureSession() → tRPC attempt → Playwright fallback → Key extraction → Persist to DB
```

**Key Functions:**
- `trpcCall()` (line 468-533): Makes tRPC calls with cookie headers
- `createManagementKey()` (line 632-741): Main provisioning logic
- `createManagementKeyViaPlaywright()` (line 992-1389): Browser automation fallback

### 1.2 Cookie Handling Flow (clerk-auth.js)

**Critical Functions:**
- `parseAllDeviceCookies()` (line 104-117): Parses all cookies from stored string
- `openRouterDashboardDeviceCookies()` (line 133-149): Builds cookie header for tRPC
- `openRouterPlaywrightDeviceCookies()` (line 152-169): Builds cookie array for Playwright
- `clientCookieAfterSetCookieLines()` (line 200-207): Merges Set-Cookie into stored jar
- `mergeDeviceJar()` (line 171-175): Merges cookie lines with filter function

---

## 2. Issues Identified

### 2.1 🔴 HIGH: Response Stream Race Condition (Line 1080, 1331)

**Location:** `dashboard-api.js:1080`, `dashboard-api.js:1331`

**Issue:** Multiple handlers call `response.text()` on the same response object:
1. `provisionKeyWait` predicate (line 1080) consumes body
2. `redeemCodeViaPlaywright` response handler (line 1331) also consumes body

**Risk:** If both handlers fire on the same response, the second call will receive empty body because Playwright response streams can only be consumed once.

**Evidence:**
```javascript
// Line 1080 in waitForResponse predicate
const body = await response.text();  // Consumes stream
const key = extractManagementKeyFromResponseBody(body);

// Line 1331 in redeem flow
const body = await response.text();  // Will be empty if line 1080 already consumed it
```

**Mitigation Status:** The code comment at line 1286-1289 acknowledges this issue but doesn't prevent the race condition between different waiters.

**Recommendation:** 
- Use `page.waitForEvent('response')` with a shared response cache
- Or clone the response before reading

---

### 2.2 🟡 MEDIUM: Cookie String Formatting Edge Cases

**Location:** `clerk-auth.js:openRouterDashboardDeviceCookies()` (line 133-149)

**Issue:** The function builds cookie string manually, but doesn't handle edge cases:

1. **Empty jar returns empty string** - May cause issues if Cloudflare cookies exist but Clerk cookies don't
2. **Legacy single cookie handling** - Logic at line 138-140 may add duplicate __client_uat
3. **No URL encoding** - Cookie values aren't URL-encoded when concatenated

**Code:**
```javascript
const legacySingle = Object.keys(jar).length === 1 && client && !uat;
if (uat) out.push(`__client_uat=${uat}`);
else if (legacySingle) out.push(`__client_uat=${client}`);  // Potential duplicate
if (client && client !== uat) out.push(`__client=${client}`);
```

**Risk:** Malformed Cookie header could cause:
- Server rejection
- Session validation failures
- Security bypass if cookies are misinterpreted

**Recommendation:**
- Add URL encoding for cookie values
- Add validation that cookies are properly formatted
- Log warning if cookie string appears malformed

---

### 2.3 🟡 MEDIUM: Hardcoded Values and Magic Numbers

**Multiple locations identified:**

| Location | Value | Risk |
|----------|-------|------|
| clerk-auth.js:503 | `DEFAULT_SESSION_TTL_MS = 86400000` (24h) | May not match server-side TTL |
| clerk-auth.js:887 | `SESSION_EXPIRING_SOON_MS = 10 * 60 * 1000` (10min) | Arbitrary threshold |
| dashboard-api.js:1139 | `timeout: 50000` (50s) | No justification for value |
| dashboard-api.js:757 | `for (let i = 0; i < 3; i++)` | Magic number for retry |
| dashboard-api.js:948 | `delay: 40` (40ms keystroke delay) | May be detectable as automation |

**Risk:** Hardcoded values may:
- Not match upstream service behavior
- Make fingerprinting easier for bot detection
- Cause timing-related flakiness

**Recommendation:**
- Move to configuration with documented rationale
- Add jitter to delays (e.g., 40ms ± 10ms)

---

### 2.4 🟡 MEDIUM: Insufficient Cookie Expiration Handling

**Location:** `store.js:resolveEffectiveSessionExpiry()` (line 14-27)

**Issue:** The function takes the minimum of JWT exp and stored expiry, but doesn't consider:
1. Cloudflare cookie expiration (`__cf_bm` typically 30 min)
2. Clerk device cookie rotation
3. Session invalidation events from Clerk webhooks

**Risk:** Session appears valid in Hydra but fails on OpenRouter due to expired Cloudflare challenge cookie.

**Code:**
```javascript
// Only considers JWT and stored - no Cloudflare awareness
if (jwtExp && stored) {
  return new Date(Math.min(a, b)).toISOString();
}
```

**Recommendation:**
- Track Cloudflare cookie expiration separately
- Add proactive refresh before CF cookies expire
- Listen to Clerk webhook session events

---

### 2.5 🟢 LOW: Error Handling Gaps in Key Extraction

**Location:** `dashboard-api.js:extractManagementKeyFromResponseBody()` (line 88-125)

**Issue:** Function silently returns null for:
- Non-string bodies (line 89)
- JSON parse failures (line 121)
- Missing key pattern (line 124)

**Risk:** Silent failures make debugging difficult. Management key creation could fail without clear logs.

**Recommendation:**
- Add debug-level logging for each failure path
- Distinguish between "no key in response" vs "response unreadable"

---

### 2.6 🟡 MEDIUM: tRPC HTML Response Detection

**Location:** `dashboard-api.js:trpcCall()` (line 478-485)

**Issue:** HTML response detection is basic and could be bypassed:

```javascript
const contentType = res.headers.get('content-type') || '';
if (contentType.includes('text/html')) {
  const err = new Error(`tRPC route ${route} returned HTML...`);
  err.isHtml = true;
  err.httpStatus = res.status;
  throw err;
}
```

**Attack Scenario:**
1. Attacker causes tRPC endpoint to return `text/html; charset=utf-8` with management key in body
2. Code throws error and falls back to Playwright
3. But legitimate JSON response with unusual content-type would also throw

**Risk:** False positives causing unnecessary Playwright fallbacks.

**Recommendation:**
- Also check response body starts with `{` or `[` for JSON
- Log full response preview when content-type mismatch occurs

---

### 2.7 🟡 MEDIUM: Account Generator Cookie Extraction Gap

**Location:** `account-generator.js:153-156`

**Issue:** Only extracts `__session` and `__client_uat`, missing Cloudflare cookies:

```javascript
const cookies = await context.cookies('https://openrouter.ai');
const sessionCookie = cookies.find(cookie => cookie.name === '__session')?.value;
const clientCookie = cookies.find(cookie => cookie.name === '__client_uat')?.value;
```

**Impact:** New accounts created after the cookie fix won't have Cloudflare cookies captured, causing the same HTML response issues the fix was meant to address.

**Risk:** Accounts created via generator may experience provisioning failures due to missing CF cookies.

**Recommendation:**
- Extract ALL cookies from context, not just Clerk ones
- Use `parseAllDeviceCookies()` pattern in account generator

---

### 2.8 🟢 LOW: Duplicate Cookie Key Handling

**Location:** `clerk-auth.js:parseAllDeviceCookies()` (line 104-117)

**Issue:** If input string has duplicate cookie names, last one wins:

```javascript
for (const part of t.split(';')) {
  // ...
  if (k && v && k !== '__session') jar[k] = v;  // Overwrites
}
```

**Risk:** If Cloudflare sends multiple `__cf_bm` cookies (valid in some scenarios), only the last is kept.

**Recommendation:**
- Document behavior
- Add warning log if duplicates detected

---

### 2.9 🟡 MEDIUM: Missing Cookie Attribute Preservation

**Issue:** Cookie attributes (Secure, HttpOnly, SameSite, Path, Domain) are not preserved when storing to database.

**Risk:**
- Cookies replayed without proper attributes may be rejected
- Security attributes lost on restoration
- Domain mismatches between clerk.openrouter.ai and openrouter.ai

**Evidence:**
```javascript
// parseAllDeviceCookies only extracts name=value
const jar = {};
for (const part of t.split(';')) {
  const eq = part.indexOf('=');
  // ... extracts only name and value
}
```

**Recommendation:**
- Store full Set-Cookie header lines
- Parse and respect cookie attributes on replay

---

## 3. Race Conditions and Timing Issues

### 3.1 Response Handler Registration Order

**Location:** `dashboard-api.js:1023-1045` and `1068-1141`

**Issue:** Multiple response handlers registered in sequence:

```javascript
// Handler 1: Network logging (line 1023)
page.on('response', async (response) => { ... });

// Handler 2: Key extraction (line 1068, via waitForResponse)
const provisionKeyWait = page.waitForResponse(...);
```

**Risk:** Handler order isn't guaranteed. If network logging handler (which doesn't consume body) runs after key extraction, no issue. But if multiple key extraction handlers exist, they race for the body.

**Current Status:** Code acknowledges issue at line 1286-1289 but doesn't prevent it.

---

### 3.2 Session Refresh Timing

**Location:** `clerk-auth.js:refreshSession()` (line 871-881)

**Issue:** Session refresh has no retry logic:

```javascript
export async function refreshSession(clientCookie) {
  try {
    return await clerkGetClientSession(clientCookie, {...});
  } catch {
    return null;  // Silent failure
  }
}
```

**Risk:** Transient network failures cause immediate fallback to full re-auth, which may trigger 2FA prompts.

**Recommendation:**
- Add retry with exponential backoff
- Log refresh attempts

---

## 4. Account Lifecycle Issues

### 4.1 Accounts Created BEFORE vs AFTER Cookie Fix

**BEFORE Fix:**
- Account records contain only `__client` cookie
- No Cloudflare cookies in database
- tRPC calls may receive HTML responses
- Provisioning falls back to Playwright (which works)

**AFTER Fix:**
- Account records contain all cookies (Clerk + Cloudflare)
- tRPC calls receive proper JSON
- Provisioning faster via tRPC

**Migration Risk:** Old accounts never get Cloudflare cookies unless user re-authenticates. The `ensureSession()` flow doesn't refresh Cloudflare cookies.

**Recommendation:**
- Add migration logic to detect missing CF cookies
- Force re-auth for accounts missing CF cookies when tRPC fails with HTML

---

## 5. Database Persistence Issues

### 5.1 Cookie Storage Format

**Location:** `store.js:updateAccountSession()` (line 281-311)

**Issue:** Cookies stored as simple string in `config.clientCookie`:

```javascript
if (clientCookie != null && String(clientCookie).trim() !== '' && String(clientCookie).trim() !== 'undefined') {
  config.clientCookie = String(clientCookie).trim();
}
```

**Risk:**
- No versioning of cookie format
- No indication of which cookies are present
- Migration difficult if format changes

**Recommendation:**
- Add metadata about cookie composition
- Store timestamp of last cookie update

---

## 6. Debug and Observability Gaps

### 6.1 Insufficient Logging in Critical Paths

**Identified gaps:**
1. No logging when Cloudflare cookies are missing (should warn)
2. No metric on tRPC vs Playwright success rates
3. No tracking of cookie refresh operations
4. No visibility into why key extraction failed

**Recommendation:**
- Add structured logging for all cookie operations
- Emit metrics for provisioning method success rates

---

## 7. Security Recommendations Summary

### Immediate Actions (High Priority)

1. **Fix response stream race condition**
   - Shared response cache or body cloning
   - File: `dashboard-api.js`

2. **Update account generator to capture all cookies**
   - Use `parseAllDeviceCookies()` pattern
   - File: `account-generator.js`

3. **Add migration for pre-fix accounts**
   - Detect missing CF cookies
   - Force re-auth when needed
   - File: `clerk-auth.js`, `dashboard-api.js`

### Medium Priority

4. **Add cookie expiration awareness**
   - Track CF cookie TTL
   - Proactive refresh
   - File: `clerk-auth.js`, `store.js`

5. **Improve error handling**
   - Distinguish failure modes
   - Add debug logging
   - File: `dashboard-api.js`

6. **Remove hardcoded values**
   - Move to config
   - Add jitter
   - File: `dashboard-api.js`, `clerk-auth.js`

### Low Priority

7. **Preserve cookie attributes**
   - Store full Set-Cookie headers
   - Respect attributes on replay
   - File: `clerk-auth.js`

8. **Add metrics and observability**
   - Structured logging
   - Success rate metrics
   - File: `dashboard-api.js`, `clerk-auth.js`

---

## 8. Test Coverage Gaps

**Missing Tests:**
1. Cookie string edge cases (empty, malformed, duplicate names)
2. Cloudflare cookie rotation/expiration
3. Response stream consumption race condition
4. Account migration scenarios (pre-fix → post-fix)
5. tRPC HTML response handling
6. Session refresh transient failures
7. Key extraction failure modes

---

## 9. Conclusion

The Hydra cookie fixes address the immediate issues but introduce several edge cases and potential race conditions. The most critical issue is the **response stream race condition** which could cause intermittent provisioning failures.

**Recommended Next Steps:**
1. Implement high-priority fixes immediately
2. Add comprehensive test coverage for cookie handling
3. Set up monitoring for provisioning success rates
4. Plan migration strategy for pre-fix accounts

**Risk Score:** 6.5/10 (Medium-High)
- Immediate security risk: Low
- Reliability risk: Medium
- Technical debt: High

---

## Appendix: Files Modified/Reviewed

**Core Files:**
- `/server/services/dashboard-api.js` (1773 lines reviewed)
- `/server/services/clerk-auth.js` (918 lines reviewed)
- `/server/services/store.js` (564 lines reviewed)
- `/server/services/account-generator.js` (254 lines reviewed)
- `/server/services/key-utils.js` (19 lines reviewed)

**Test Files:**
- `/test.js`, `/test2.js`, `/test3.js`, `/test4.js`
- `/verify_final.js`

**Documentation:**
- `/FIXES_SUMMARY.md`
- `/CLAUDE.md`
