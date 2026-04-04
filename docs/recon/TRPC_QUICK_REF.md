# OpenRouter tRPC Endpoint - Quick Reference

## TL;DR

**The tRPC endpoint URL IS correct:** `https://openrouter.ai/api/trpc/{procedure}?batch=1`

**HTML responses indicate authentication failure, not wrong URL.**

---

## The Real Endpoint

| Component | Value |
|-----------|-------|
| Base URL | `https://openrouter.ai` |
| tRPC Path | `/api/trpc/{procedure}` |
| Batch Query | `?batch=1` |
| Full Example | `https://openrouter.ai/api/trpc/managementKeys.create?batch=1` |

---

## Why You Get HTML

### Response Headers (Unauthenticated Request)

```
x-matched-path: /[maker-id]/[slug]/[tab]     ← Next.js catch-all caught it
x-clerk-auth-status: signed-out              ← Auth failed
x-clerk-auth-reason: session-token-and-uat-missing  ← Missing session
```

**Translation:** Without valid `__session` cookie, Next.js treats `/api/trpc/*` as a page route and returns the SPA HTML.

---

## Required for JSON Response

### Cookies (All Required)
- `__session` - Clerk JWT session token
- `__client` - Clerk device ID
- `__client_uat` - Clerk user auth timestamp
- `__cf_bm` (optional but recommended) - Cloudflare bot management

### Headers
```javascript
{
  'Content-Type': 'application/json',
  'Cookie': '__session=...; __client=...; __client_uat=...',
  'Origin': 'https://openrouter.ai',
  'Referer': 'https://openrouter.ai/settings/management-keys',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...',
  'x-trpc-source': 'nextjs-react',  // Required!
}
```

### Body (tRPC v10 Batch Format)
```javascript
{
  "0": {
    "json": {
      "name": "Management Key Name"
    }
  }
}
```

---

## Procedure Names for Management Key Creation

**Primary:**
- `managementKeys.create` - Create management key
- `managementKeys.list` - List existing keys

**Alternatives (tried if primary fails):**
- `managementKey.create`
- `management.createManagementKey`
- `apiKeys.createManagement`

---

## Alternative Paths Tested (Don't Work)

| Path | Result |
|------|--------|
| `/trpc/{procedure}` | HTML (same issue) |
| `/api/internal/trpc/{procedure}` | 404 |
| `/api/edge/trpc/{procedure}` | HTML (same issue) |
| `/_next/data/...` | HTML |
| `/api/rpc` | HTML |

---

## The Solution

**Don't change the URL. Fix the authentication.**

The current Hydra implementation in `dashboard-api.js` is correct:
1. URL: `https://openrouter.ai/api/trpc/${route}?batch=1`
2. Headers: Include `x-trpc-source: nextjs-react`
3. Cookies: Include full Clerk device cookie jar

If you're getting HTML:
1. Session is expired (JWT `exp` claim exceeded)
2. Missing `__client` or `__client_uat` cookies
3. Cloudflare blocking (need fresh `__cf_bm`)

---

## Files Reference

- `~/Desktop/hydra/server/services/dashboard-api.js:948` - `trpcCall()` function
- `~/Desktop/hydra/docs/recon/TRPC_ROUTES.md` - Full tRPC documentation
- `~/Desktop/hydra/docs/recon/TRPC_ENDPOINT_DISCOVERY.md` - This discovery report

---

**Verdict:** The endpoint is `/api/trpc/{procedure}`. The HTML response is an authentication issue, not a routing issue.
