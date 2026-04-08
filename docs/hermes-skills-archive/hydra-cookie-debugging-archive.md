---
name: hydra-openrouter-cookie-debugging
title: Hydra/OpenRouter Cookie & Session Debugging
description: Fixes for Cloudflare/Clerk cookie handling, OTP flows, and session management in Hydra router
version: 1.0.0
tags: [hydra, openrouter, clerk, cookies, otp, security-research]
---

# Hydra/OpenRouter Cookie & Session Debugging

## Problem Context
Hydra router integration with OpenRouter's Clerk authentication requires careful cookie handling for:
- Cloudflare cookies (`__cf_bm`, `_cfuvid`, `cf_clearance`)
- Clerk session cookies (`__session`, `__client`, `__client_uat`)
- OTP-based account creation and session management

## Common Issues & Fixes

### 1. Duplicate Cookie Bug
**Symptom**: Duplicate `__client`/`__client_uat` in cookie output.
**Fix**: Skip already-added cookies in the loop:
```javascript
for (const k of Object.keys(jar).sort()) {
  if (k === '__client' || k === '__client_uat') continue;
  if (isDashboardDeviceCookieName(k)) out.push(`${k}=${jar[k]}`);
}
```

### 2. filterFn Not Passed
**Symptom**: Cloudflare cookies lost during merge.
**Fix**: Pass `filterFn` to `mergeDeviceJar()`:
```javascript
function mergeDeviceJar(priorJar, lines, filterFn = isClerkDeviceCookieName) {
  const next = { ...priorJar };
  mergeDeviceCookiesFromParsed(next, parseCookies(lines), filterFn);
  return next;
}
```

### 3. Short-Lived OTP Sessions
**Symptom**: OTP-created sessions expire in 1-5 minutes, not days.
**Fix**: Detect short sessions and refresh:
```javascript
const ONE_HOUR = 60 * 60 * 1000;
if (expiryMs - nowMs < ONE_HOUR && session.clientCookie) {
  const refreshed = await refreshSession(session.clientCookie);
  if (refreshed && refreshedExpiryMs - nowMs > ONE_HOUR) {
    // Use refreshed long-lived session
  }
}
```

### 4. Cookie Validation Breaking Flows
**CRITICAL LESSON**: Aggressive cookie validation breaks existing functionality.
- Don't validate cookie names/values unless absolutely necessary
- Don't reject cookies with `;` in values (they're valid)
- Don't check header sizes unless causing actual errors
- **OTP flows will break** if you add strict validation

## OTP Flow (Working)
```
POST /api/accounts/bulk-otp-stubs  → Create account stub
POST /api/accounts/:id/otp/start   → Calls startEmailOTP(email)
                                   → Clerk sends email with code
POST /api/accounts/:id/otp/verify  → Calls completeEmailOTP(signInId, code, clientCookie)
                                   → Returns sessionCookie, clientCookie
```

## Debugging Steps
1. Check `/tmp/hydra-dev.log` for `[CLERK_DEBUG_OTP]` traces
2. Verify `clientCookie` contains `__cf_bm` and `_cfuvid`
3. Check session expiry: `new Date(sessionExpiry).getTime() - Date.now()`
4. If short-lived (< 1 hour), `refreshSession()` should get long-lived one

## Pitfalls to Avoid
- Don't add validation without testing OTP flows
- Watch for duplicate function definitions in clerk-auth.js
- Cloudflare cookies MUST be preserved for tRPC calls
- Don't use `:has-text()` selectors in `page.waitForFunction()` (invalid DOM)