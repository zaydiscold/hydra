# Recommended Code Fixes - Test #2 Findings

## Critical Fix #1: Response Stream Race Condition

**File:** `server/services/dashboard-api.js`
**Lines:** 1068-1141, 1328-1332

**Problem:** Multiple handlers call `response.text()` on the same response, causing empty bodies.

**Fix:** Add response body caching mechanism:

```javascript
// Add near top of file with other constants
const responseBodyCache = new WeakMap();

async function getResponseBody(response) {
  if (responseBodyCache.has(response)) {
    return responseBodyCache.get(response);
  }
  const body = await response.text();
  responseBodyCache.set(response, body);
  return body;
}

// In waitForResponse predicate (line ~1080), replace:
const body = await response.text();
// With:
const body = await getResponseBody(response);

// In redeem flow (line ~1331), replace:
const body = await response.text();
// With:
const body = await getResponseBody(response);
```

---

## Critical Fix #2: Account Generator Cookie Capture

**File:** `server/services/account-generator.js`
**Lines:** 152-156

**Problem:** Only captures `__session` and `__client_uat`, missing Cloudflare cookies.

**Fix:** Capture all cookies:

```javascript
// Replace lines 152-156 with:
const cookies = await context.cookies('https://openrouter.ai');
const sessionCookie = cookies.find(c => c.name === '__session')?.value;

// Build full cookie jar like clerk-auth.js does
const jar = {};
for (const c of cookies) {
  if (c.name !== '__session' && c.value) {
    jar[c.name] = c.value;
  }
}
// Serialize using same format as clerk-auth.js
const clientCookie = Object.entries(jar)
  .map(([k, v]) => `${k}=${v}`)
  .join('; ');
```

---

## High Priority Fix #3: Add Cloudflare Cookie Awareness

**File:** `server/services/clerk-auth.js`
**Lines:** 871-881 (refreshSession)

**Problem:** Session refresh doesn't check Cloudflare cookie expiration.

**Fix:** Add CF cookie validation:

```javascript
export async function refreshSession(clientCookie) {
  try {
    const result = await clerkGetClientSession(clientCookie, {
      debugPhase: 'refresh',
      maxAttempts: GET_CLIENT_MAX_ATTEMPTS,
      retryMs: GET_CLIENT_RETRY_MS,
    });
    
    // Check if we have Cloudflare cookies
    const jar = parseAllDeviceCookies(clientCookie);
    const hasCfCookies = Object.keys(jar).some(k => 
      k === '__cf_bm' || k === '_cfuvid' || k === 'cf_clearance'
    );
    
    if (!hasCfCookies && result) {
      console.warn('[CLERK] Session refreshed but missing Cloudflare cookies - may need re-auth');
    }
    
    return result;
  } catch {
    return null;
  }
}
```

---

## Medium Priority Fix #4: HTML Response Detection Improvement

**File:** `server/services/dashboard-api.js`
**Lines:** 478-485

**Problem:** Only checks content-type, doesn't verify body is actually HTML.

**Fix:** Also check response body:

```javascript
const contentType = res.headers.get('content-type') || '';
if (contentType.includes('text/html')) {
  // Peek at body to confirm it's actually HTML
  const peek = await res.clone().text();
  const looksLikeHtml = peek.trim().startsWith('<') || peek.includes('<!DOCTYPE');
  
  if (looksLikeHtml) {
    const err = new Error(`tRPC route ${route} returned HTML — likely wrong format or auth failed`);
    err.isHtml = true;
    err.httpStatus = res.status;
    throw err;
  }
  // If not actually HTML, continue to parse as JSON
}
```

---

## Medium Priority Fix #5: Add Cookie Format Validation

**File:** `server/services/clerk-auth.js`
**Lines:** 133-149

**Problem:** No validation that generated cookie string is properly formatted.

**Fix:** Add validation and URL encoding:

```javascript
export function openRouterDashboardDeviceCookies(stored) {
  const jar = parseAllDeviceCookies(stored);
  const out = [];
  const uat = jar.__client_uat;
  const client = jar.__client;
  const legacySingle = Object.keys(jar).length === 1 && client && !uat;
  
  if (uat) out.push(`__client_uat=${encodeURIComponent(uat)}`);
  else if (legacySingle) out.push(`__client_uat=${encodeURIComponent(client)}`);
  if (client && client !== uat) out.push(`__client=${encodeURIComponent(client)}`);
  
  for (const k of Object.keys(jar).sort()) {
    if (k === '__client' || k === '__client_uat') continue;
    if (isDashboardDeviceCookieName(k)) {
      out.push(`${k}=${encodeURIComponent(jar[k])}`);
    }
  }
  
  const result = out.join('; ');
  
  // Validate format
  if (result && !/^[^=;]+=[^;]*(; [^=;]+=[^;]*)*$/.test(result)) {
    console.error('[CLERK] Generated malformed cookie string:', result);
  }
  
  return result;
}
```

---

## Low Priority Fix #6: Remove Hardcoded Values

**File:** `server/services/dashboard-api.js`, `server/services/clerk-auth.js`

**Problem:** Magic numbers throughout code.

**Fix:** Create config constants:

```javascript
// Add to server/config.js
export const TIMING = {
  KEYSTROKE_DELAY_MS: 40,
  KEYSTROKE_JITTER_MS: 10,
  OVERLAY_DISMISS_RETRY: 3,
  PROVISION_RESPONSE_TIMEOUT_MS: 50000,
  PROVISION_KEY_WAIT_TIMEOUT_MS: 15000,
  FALLBACK_DELAY_MS: 2000,
};

export const SESSION = {
  DEFAULT_TTL_MS: 24 * 60 * 60 * 1000, // 24h
  EXPIRING_SOON_MS: 10 * 60 * 1000,    // 10min
  MAX_GET_CLIENT_ATTEMPTS: 3,
  OTP_MAX_GET_CLIENT_ATTEMPTS: 8,
};
```

---

## Testing Recommendations

### Unit Tests to Add:

1. **Cookie Parsing:**
```javascript
// Test parseAllDeviceCookies edge cases
test('handles duplicate cookie names', () => { ... });
test('handles empty/undefined input', () => { ... });
test('handles malformed cookie strings', () => { ... });
test('preserves Cloudflare cookies', () => { ... });
```

2. **Cookie Serialization:**
```javascript
// Test round-trip serialization
test('serialize then parse preserves all cookies', () => { ... });
test('handles special characters in values', () => { ... });
```

3. **Response Body Extraction:**
```javascript
// Test race condition prevention
test('multiple reads return same body', async () => { ... });
test('cache cleanup prevents memory leak', () => { ... });
```

4. **HTML Detection:**
```javascript
test('detects actual HTML response', () => { ... });
test('allows JSON with wrong content-type', () => { ... });
```

---

## Monitoring Checklist

Add metrics/logging for:

1. [ ] Provisioning success rate by method (tRPC vs Playwright)
2. [ ] Cookie composition logging (with redacted values)
3. [ ] Session refresh outcomes
4. [ ] HTML response frequency by account age
5. [ ] Response stream consumption errors
6. [ ] Cloudflare cookie presence in requests

---

## Migration Script for Pre-Fix Accounts

```javascript
// Run once to detect accounts needing re-auth
async function findAccountsNeedingReauth() {
  const accounts = await prisma.account.findMany();
  const needsReauth = [];
  
  for (const account of accounts) {
    const config = readConfig(account);
    const jar = parseAllDeviceCookies(config.clientCookie || '');
    
    const hasCfCookies = Object.keys(jar).some(k => 
      k === '__cf_bm' || k === '_cfuvid' || k === 'cf_clearance'
    );
    
    if (!hasCfCookies) {
      needsReauth.push({
        id: account.id,
        alias: account.alias,
        reason: 'missing_cloudflare_cookies'
      });
    }
  }
  
  return needsReauth;
}
```

---

## Summary of Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `dashboard-api.js` | Critical | Response cache, HTML detection |
| `account-generator.js` | Critical | Capture all cookies |
| `clerk-auth.js` | High | CF cookie awareness, validation |
| `config.js` | Medium | Extract hardcoded values |
| `store.js` | Low | Cookie metadata tracking |
