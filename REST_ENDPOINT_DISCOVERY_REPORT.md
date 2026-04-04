# OpenRouter Management Key Creation - REST Endpoint Discovery Report

**Date:** 2026-04-03  
**Account:** cecff6a9-cbcc-4110-93ec-409299474b82 (iam@zayd.wtf)  
**Status:** ❌ NO WORKING REST ENDPOINTS FOUND

## Executive Summary

After extensive testing of 38+ REST endpoints and 22+ tRPC routes with various authentication methods (Bearer tokens, cookies, combined auth), **no working REST endpoint for OpenRouter management key creation was found**. All endpoints returned either:
- HTML redirect to login page
- 401 Unauthorized errors
- 404 Not Found errors

## Session Status

- **sessionCookie:** ✅ Present (expires 2026-04-03T23:34:56Z)
- **clientCookie:** ✅ Present
- **managementKey:** ⚠️ Present but returns 401 on API calls
- **Fresh JWT obtained:** ✅ Yes (from Clerk /client endpoint)

## Tested REST Endpoints

### Primary Candidates
| Endpoint | Methods | Auth Types | Result |
|----------|---------|------------|--------|
| `/api/v1/management-keys` | POST, GET, PUT | Bearer, Cookie, Both | ❌ HTML redirect |
| `/api/v1/keys` | POST, GET | Bearer, Cookie, Both | ❌ 401 Unauthorized |
| `/api/auth/keys` | POST | Bearer, Cookie, Both | ❌ HTML redirect |
| `/api/user/keys` | POST, GET | Bearer, Cookie, Both | ❌ HTML redirect |
| `/api/account/keys` | POST, GET | Bearer, Cookie, Both | ❌ HTML redirect |

### Alternative Patterns
| Endpoint | Methods | Auth Types | Result |
|----------|---------|------------|--------|
| `/api/management/keys` | POST | Bearer, Cookie, Both | ❌ HTML redirect |
| `/api/keys/management` | POST | Bearer, Cookie, Both | ❌ HTML redirect |
| `/api/settings/management-keys` | POST | Bearer, Cookie, Both | ❌ HTML redirect |
| `/api/dashboard/keys` | POST | Bearer, Cookie, Both | ❌ HTML redirect |
| `/api/v2/management-keys` | POST | Both | ❌ HTML redirect |
| `/api/v2/keys` | POST | Both | ❌ HTML redirect |

### Body Variations Tested
- `{ name: "Test Key" }`
- `{ label: "Test Key" }`
- `{ title: "Test Key" }`
- `{ keyName: "Test Key" }`
- `{ name: "Test Key", type: "management" }`

## Tested tRPC Routes

### Creation Routes (POST with batch format)
- `managementKeys.create` ❌
- `managementKey.create` ❌
- `keys.createManagement` ❌
- `managementKeys.createKey` ❌
- `managementKeys.createManagementKey` ❌
- `management.createManagementKey` ❌
- `management.createKey` ❌
- `apiKeys.createManagement` ❌
- `apiKeys.createManagementKey` ❌
- `settings.managementKeys.create` ❌
- `dashboard.managementKeys.create` ❌
- `management.managementKeys.create` ❌
- `admin.managementKeys.create` ❌
- `user.managementKeys.create` ❌
- `account.managementKeys.create` ❌
- `keys.management.create` ❌
- `keys.managementCreate` ❌

### List Routes (for session validation)
- `managementKeys.list` ❌
- `apiKeys.list` ❌
- `keys.list` ❌
- `user.keys` ❌
- `account.keys` ❌
- `settings.keys` ❌

All routes returned HTML (auth redirect) instead of JSON.

## Authentication Methods Tested

### 1. Bearer Token Authentication
```
Authorization: Bearer <JWT>
```
- Used fresh JWT from Clerk `/v1/client` endpoint
- Used original session cookie JWT
- Result: 401 or HTML redirect

### 2. Cookie-Based Authentication
```
Cookie: __session=<JWT>; __client=<...>; __client_uat=<...>; __cf_bm=<...>
```
- Tested with __session alone
- Tested with __session + __client
- Tested with __session + __client + __client_uat
- Tested with __session + Cloudflare cookies (__cf_bm, _cfuvid)
- Tested with complete cookie jar
- Result: HTML redirect to login

### 3. Combined Authentication
- Both Bearer header and Cookie header
- Result: Same as individual methods

### Headers Used
```
Content-Type: application/json
Origin: https://openrouter.ai
Referer: https://openrouter.ai/settings/management-keys
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...
x-trpc-source: nextjs-react (for tRPC calls)
```

## Findings

### Why No Endpoints Worked

1. **Session Validation Issues**
   - Although the JWT is not expired, it returns HTML redirects
   - This suggests the session may be invalid or revoked
   - Missing `cf_clearance` cookie may be required for dashboard access

2. **Management Key Status**
   - Existing management key returned 401 on API calls
   - Key may have been revoked or expired
   - API access is separate from dashboard session access

3. **OpenRouter Architecture Changes**
   - The dashboard may now use Next.js Server Actions
   - Traditional tRPC endpoints may have been replaced
   - Additional security measures may be in place

## Working Authentication for Dashboard

The only confirmed working authentication is through the existing Hydra implementation:

1. **OTP Authentication Flow**
   - POST `/api/accounts/:id/otp/start` - Sends OTP email
   - POST `/api/accounts/:id/otp/verify` - Verifies OTP code
   - Returns fresh session cookies that work for provisioning

2. **Browser Automation (Playwright)**
   - Uses captured cookies to navigate dashboard
   - Interacts with UI to create keys
   - Captures key from response or clipboard

## Files Created

| File | Purpose |
|------|---------|
| `test-rest-endpoints.mjs` | Tests REST endpoints with various auth methods |
| `test-trpc-routes.mjs` | Tests tRPC routes with various payloads |
| `test-session-validation.mjs` | Validates session cookies |
| `test-account-verify.mjs` | Verifies management key status |
| `test-documentation.mjs` | Generates this report |

## Recommended Next Steps

### 1. Re-authenticate via OTP
```bash
# Start OTP
curl -X POST http://localhost:3001/api/accounts/cecff6a9-cbcc-4110-93ec-409299474b82/otp/start \
  -H "Authorization: Bearer <hydra_token>"

# Verify OTP
curl -X POST http://localhost:3001/api/accounts/cecff6a9-cbcc-4110-93ec-409299474b82/otp/verify \
  -H "Authorization: Bearer <hydra_token>" \
  -H "Content-Type: application/json" \
  -d '{"signInId": "...", "code": "123456"}'
```

### 2. Capture Live Network Traffic
Use the browser automation script to capture actual dashboard requests:
```bash
# Set debug flags
export HYDRA_PROVISION_DEBUG=1
export HYDRA_PROVISION_NETWORK_LOG=1

# Run capture
node scripts/capture-mgmt-key-network.mjs
```

### 3. Check for Next.js Server Actions
Look for POST requests with:
- `Next-Action` headers
- Form-encoded body (not JSON)
- Custom action IDs

### 4. Create New Management Key via UI
If automation fails, manually create a key via the dashboard and import it into Hydra.

## Conclusion

**No working pure HTTP REST endpoint for OpenRouter management key creation was found.** The OpenRouter dashboard appears to require:

1. Valid session cookies (including Cloudflare clearance)
2. Either tRPC with specific (unknown) route names, or
3. Next.js Server Actions with custom headers

The recommended approach remains the existing Hydra implementation:
- **Primary:** tRPC with session cookies (as implemented in `dashboard-api.js`)
- **Fallback:** Browser automation with Playwright
- **Last resort:** Manual key creation and import

## Appendix: Session Details

```
Session JWT:
  Subject: user_3B0NOKKMtngPh0LnWquap1yCYw3
  Issuer: https://clerk.openrouter.ai
  Expires: 2026-04-03T23:34:56.000Z (7 hours from now)
  Issued: 2026-04-03T23:33:56.000Z
```
