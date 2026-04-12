# Root Script Scan — Recon Data Extracted Before Deletion

Scanned: 2026-04-11  
Source: Dead scripts in `scripts/` (not referenced in package.json)

---

## tRPC Routes Discovered

From `scripts/automated-test.js`:

| Route | Method | Body Format |
|-------|--------|-------------|
| `/trpc/managementKeys.create` | POST | `{"0":{"json":{"name":"..."}}}` |
| `/trpc/managementKey.create` | POST | `{"0":{"json":{"name":"..."}}}` |
| `/api/trpc/user.info` | GET | — |

From `scripts/check-all-sessions.mjs`:

| Route | Method | Notes |
|-------|--------|-------|
| `/api/trpc/user.info` | GET | Returns user info JSON if session valid |
| `/api/health` | GET | Returns redirect/HTML if not authed |

---

## REST Endpoints Attempted

From `scripts/automated-test.js`:

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/v1/management-keys` | POST | JSON body `{name: "..."}` — likely returns HTML |
| `/api/management-keys` | POST | JSON body `{name: "..."}` — likely returns HTML |

---

## Required Headers for tRPC / Management-Key Requests

From `scripts/automated-test.js`:

```
Cookie: __session=<jwt>; <clientCookie>
Content-Type: application/json
Accept: application/json
Origin: https://openrouter.ai
Referer: https://openrouter.ai/settings/management-keys
```

---

## Next.js Server Action Header

From `scripts/capture-mgmt-key-network.mjs`:

- Header `Next-Action` contains the server action ID
- Captured on POST requests to `/settings/management-keys`
- Env vars for replay:
  - `HYDRA_MGMT_KEY_SERVER_ACTION_ID` — the captured Next-Action ID
  - `HYDRA_PROVISION_SERVER_ACTION_REPLAY=1` — enable replay mode

---

## Clerk API Endpoints

From `scripts/check-all-sessions.mjs` & `scripts/automated-test.js`:

```
GET https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0
Cookie: __session=<jwt>; <deviceCookies>
Origin: https://openrouter.ai
```

Response structure: `response.sessions[0].last_active_token.jwt`

---

## Cookie Names (Clerk + Cloudflare)

From `scripts/security-test-cookies.mjs` & `scripts/security-test-merge.mjs`:

**Clerk cookies:**
- `__client` — primary device cookie
- `__client_uat` — user authentication token
- `__client_uat_*` — additional UAT variants

**Cloudflare cookies (must be preserved for dashboard access):**
- `__cf_bm` — Cloudflare bot management
- `_cfuvid` — Cloudflare unique visitor ID
- `cf_clearance` — Cloudflare challenge clearance

**Key functions in `clerk-auth.js`:**
- `parseClerkDeviceCookieJar()` — Clerk-only parsing
- `openRouterDashboardDeviceCookies()` — Clerk + CF, deduplicated
- `openRouterPlaywrightDeviceCookies()` — Cookie array for Playwright context
- `clerkFapiDeviceCookieHeader()` — Clerk-only for FAPI calls
- `getJwtExpiry()` — Extract exp claim from JWT
- `isSessionValid()` — Check session validity (10-min buffer)

---

## Hydra API Routes Used by Dead Scripts

From `scripts/emergency-relogin.mjs` & `scripts/emergency-reprovision.mjs`:

| Route | Method | Notes |
|-------|--------|-------|
| `/api/auth/login` | POST | Admin auth: `{password}` |
| `/api/accounts` | GET | List all accounts |
| `/api/accounts/:id/session-status` | GET | Check session validity |
| `/api/accounts/:id/detect-auth` | POST | Detect auth method |
| `/api/accounts/:id/login` | POST | Login: `{password}` |
| `/api/accounts/:id/provision` | POST | Provision key: `{keyName}` |
| `/api/accounts/:id/management-keys` | GET | List management keys |

---

## Why It Matters

- **tRPC route names** (`managementKeys.create`, `managementKey.create`, `user.info`) confirm the exact OR API surface for server-side replay. Without these names, the 24-candidate brute-force list is the only alternative.
- **Server Action header** (`Next-Action`) is the key that unlocks pure-HTTP key provisioning and code redemption. The env var pattern (`HYDRA_MGMT_KEY_SERVER_ACTION_ID`) is now the primary provisioning path.
- **Clerk API response shape** (`response.sessions[0].last_active_token.jwt`) documents how to extract fresh JWTs without Playwright.
- **Cookie names** document the full Clerk + CF cookie surface. Knowing that `__client` is ground-truth and `__client_uat` variants are cross-tab signals only prevents wasted storage and incorrect auth decisions.
- **Hydra API routes used by dead scripts** confirms which internal endpoints are battle-tested (login, session-status, provision, management-keys) vs. which are untested.

## Evidence

All data extracted from source code of the scripts listed above before deletion. Cross-referenced against:
- `clerk-auth.js` — confirms `parseClientCookie()`, `isClerkSessionCookie()` behavior
- `dashboard-api.js` — confirms `MGMT_KEY_RE`, `dashboardHeaders()`, Server Action replay path
- `proxy.js` — confirms CF cookie handling in upstream requests

## Reproducibility

The original scripts have been deleted. However, the same data can be re-extracted by:
1. Capturing a live OR dashboard network session in DevTools
2. Examining `/_next/static/chunks/*.js` for tRPC route names
3. Running `clerk-auth.js` functions against a live Clerk session
4. Grep the current codebase: `grep -rn "trpc/" server/services/dashboard-api.js`

---

*These scripts have been deleted. All useful recon data is preserved above.*
