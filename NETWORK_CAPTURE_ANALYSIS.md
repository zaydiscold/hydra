# OpenRouter Management Key Creation - Network Capture Analysis

**Captured:** April 3, 2026 at 16:52 UTC  
**Account ID:** cecff6a9-cbcc-4110-93ec-409299474b82  
**User ID:** 26d94c8c-5294-4841-855c-2ae12d4490fe  
**Session Status:** Active (Expires: 2026-04-03T23:34:56.000Z)

---

## Summary

The OpenRouter dashboard uses **Next.js Server Actions** for management key creation and related operations. No traditional REST or tRPC endpoints were detected for the creation flow.

### Key Findings:

1. **API Pattern:** Next.js Server Actions (NOT tRPC or REST)
2. **Endpoint:** `POST https://openrouter.ai/settings/management-keys`
3. **Action ID:** `00ba0cca67cdca18c29a01625210c65fbda7039b6d`
4. **Content-Type:** `text/plain;charset=UTF-8`
5. **Request Body:** `[]` (empty JSON array initially, then mutation data)

---

## Server Action Details

### Endpoint
```
POST https://openrouter.ai/settings/management-keys
```

### Headers
```
next-action: 00ba0cca67cdca18c29a01625210c65fbda7039b6d
referer: https://openrouter.ai/settings/management-keys
content-type: text/plain;charset=UTF-8
accept: text/x-component
user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36...
```

### Request Body
```
[]
```

The initial request body is an empty array `[]`. After form submission, it likely contains the form data encoded for the Server Action.

### Response Format
The response uses Next.js's RSC (React Server Components) format:
```
0:{"a":"$@1","f":"","b":"xWSzrlPZHs55IwnKpwsGN"}
1:{"__kind":"OK","data":{...user data...}}
```

---

## Additional API Endpoints Discovered

### 1. Provider Preferences API
```
GET https://openrouter.ai/api/internal/v1/provider-preferences
GET https://openrouter.ai/api/internal/v1/provider-preferences?includeGuardrails=true
```
Returns available AI providers and user preferences.

### 2. Frontend Models API
```
GET https://openrouter.ai/api/frontend/models
```
Returns available models with pricing and capabilities.

### 3. Frontend Providers API
```
GET https://openrouter.ai/api/frontend/all-providers
```
Returns all provider information including data policies.

### 4. Ingest/Surveys API
```
GET https://openrouter.ai/ingest/api/surveys/?token=phc_7T...57.2
```
User feedback/survey system.

### 5. Cloudflare RUM
```
POST https://openrouter.ai/cdn-cgi/rum
```
Real User Monitoring telemetry.

---

## Next.js RSC (React Server Components) Pattern

The dashboard heavily uses Next.js's RSC protocol with:
- `rsc: 1` header for RSC requests
- `next-router-prefetch: 1` for prefetching
- `next-router-state-tree` with encoded router state
- `next-url` indicating the current route

Example RSC Request:
```
GET https://openrouter.ai/apps?_rsc=35ma2
Headers:
  rsc: 1
  next-router-prefetch: 1
  next-router-state-tree: %5B%22%22%2C%7B%22children%22... (encoded state)
  next-url: /settings/management-keys
```

---

## How to Replicate the Server Action

### 1. Required Headers
```javascript
const headers = {
  'next-action': '00ba0cca67cdca18c29a01625210c65fbda7039b6d',
  'content-type': 'text/plain;charset=UTF-8',
  'accept': 'text/x-component',
  'referer': 'https://openrouter.ai/settings/management-keys',
  'origin': 'https://openrouter.ai',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36...',
  // ... other standard headers
};
```

### 2. Cookie Authentication
The request requires the `__session` cookie (JWT) from Clerk authentication:
```
Cookie: __session=<fresh_jwt>; __client=<client_data>; __client_uat=<timestamp>; __cf_bm=<cf_cookie>
```

### 3. Request Body Format
For Server Actions, the body appears to be encoded arguments:
```
[]  // Empty initially for loading state
```

For mutations, likely a serialized array of arguments.

### 4. Expected Response
Success responses use Next.js's custom format:
```
0:{"a":"$@1","f":"","b":"<cache_key>"}
1:{"__kind":"OK","data":{...}}
```

---

## Session Management

### Clerk Integration
The dashboard uses Clerk for authentication:

1. **Client endpoint:**
   ```
   GET https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0
   ```

2. **Environment endpoint:**
   ```
   GET https://clerk.openrouter.ai/v1/environment?__clerk_api_version=2025-11-10&_clerk_js_version=5.125.7
   ```

### Cookie Requirements
- `__session` - Clerk session JWT
- `__client` - Client identifier
- `__client_uat` - Client updated at timestamp
- `__cf_bm` - Cloudflare bot management
- `_cfuvid` - Cloudflare user identifier

---

## Security Considerations

1. **Action ID:** The `next-action` header contains a hashed action identifier that may change between deployments
2. **CSRF Protection:** The `next-router-state-tree` contains encoded state that may include CSRF tokens
3. **Replay Protection:** Server Actions likely include nonce or timestamp validation

---

## Recommendations for Implementation

### Option 1: Use Server Actions Directly
- Capture the exact action ID from the dashboard HTML
- Replicate the full header set including state tree
- Parse the RSC response format

### Option 2: Use Public API
Consider if OpenRouter exposes a public REST API for management keys that would be more stable than internal Server Actions.

### Option 3: Browser Automation
Use Playwright or Puppeteer to interact with the actual UI, ensuring all JavaScript and state management works correctly.

---

## Files Generated

1. `/tmp/01-management-keys-page.png` - Initial page load
2. `/tmp/02-create-dialog.png` - Create button clicked, dialog opened
3. `/tmp/03-form-filled.png` - Form with test key name filled
4. `/tmp/captured-requests.json` - Full network capture (if script completes)

---

## Next Steps

1. **Capture the actual mutation** - The script was blocked by a modal overlay. Complete the capture by:
   - Waiting for modal animations to complete
   - Using force click to bypass overlay checks
   - Or intercepting the request before it's sent

2. **Decode the action payload** - Understand how form data is serialized for the Server Action

3. **Handle RSC responses** - Parse the React Server Components response format to extract the created key

4. **Test the endpoint** - Make direct requests to verify the endpoint works outside the browser context

---

## Technical Notes

### Next.js Server Actions Background
Server Actions in Next.js allow server-side mutations to be called directly from components. They:
- Use a special `next-action` header with a hashed action ID
- Send serialized arguments in the request body
- Return RSC-formatted responses
- Are automatically generated by Next.js during build

### Action ID Generation
The action ID (`00ba0cca67cdca18c29a01625210c65fbda7039b6d`) is a hash that:
- Is generated at build time
- May change between deployments
- Can be found in the page's JavaScript bundle
- Is required for the Server Action to be invoked

---

*Report generated by Hydra Network Capture Tool*
*Account: cecff6a9-cbcc-4110-93ec-409299474b82*
