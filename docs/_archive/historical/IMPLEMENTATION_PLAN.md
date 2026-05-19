# OpenRouter Multi-Account Manager — Implementation Plan

> **Historical note:** This document is a **recon + design artifact**. Hydra shipped with **Prisma + SQLite**: each `Account` row stores an **encrypted `sessionToken`** column (Clerk **`__session`** JWT bytes) and **encrypted `config` JSON** (email, `clientCookie`, `sessionExpiry`, credentials metadata, etc.). The older **file vault** (`data/vault.enc` + PBKDF2) and some diagrams below describe pre-ship intent, not the live schema. For current storage and session semantics, prefer **`docs/PROJECT_STRUCTURE.md`**, **`docs/ARCHITECTURE_DEEP_DIVE.md`** (Session expiry), and **`docs/DASHBOARD_ACCOUNT_STATES.md`**.
>
> **Naming:** In service code and this plan, **`sessionCookie`** usually means the **plain** `__session` JWT string—the same value **encrypted** into **`Account.sessionToken`**. Legacy optional **`config.sessionCookie`** may still exist on old rows; **`getSessionStatus`** prefers the decrypted **`sessionToken`**.
>
> **Last updated:** 2026-04-02  
> **Status:** Historical / planning — implementation has diverged; use cross-links above for truth.  
> **Project location:** local Hydra repository
> **Reference docs:** `docs/recon/OPENROUTER_RECON.md`, `docs/recon/CLERK_API_GUIDE.md`, `docs/recon/TRPC_ROUTES.md`

---

## What This Is

A web app that manages 20+ OpenRouter accounts from a single dashboard. It automates everything that currently requires manual browser visits:

- **Checking balances** across all accounts at a glance
- **Creating/managing API keys** (CRUD) per account
- **Creating management keys** programmatically (no manual dashboard visit)
- **Redeeming promo/credit codes** across accounts in bulk
- **Session management** — auto-login, session refresh, health monitoring

The app runs locally. Express backend + React/Vite frontend. Data encrypted at rest.

---

## Naming — Rename from "Hydra"

> [!IMPORTANT]
> The project is currently named "Hydra" but the user wants something more straightforward. Suggestions:
> - **ORFleet** — "OpenRouter Fleet" — managing a fleet of accounts
> - **RouteVault** — vault of router accounts + encrypted storage
> - **ORControl** — control panel for OpenRouter
> - **Fleet** — simple, clean
> 
> **Decision needed:** Pick a name or suggest your own. For now, the codebase still says "Hydra" — a global find-replace handles the rename.

---

## Decisions Already Made

| Question | Answer |
|----------|--------|
| CLI or Web UI? | **Web UI only** |
| Auto-refresh? | **Every 5 min while app is open** + manual refresh button. No background persistence when browser tab is closed. |
| Unified API proxy? | **Deferred.** Not in this version. |
| Specific model optimization? | **No.** Not needed right now. |
| Storage? | **Shipped:** SQLite + Prisma, per-account **`sessionToken`** + **`config`** ciphertext columns (see **`docs/PROJECT_STRUCTURE.md`**). The **`data/vault.enc`** file tree below is **not** the live persistence model. |

---

## The Golden Findings (Why This Works)

These are the key discoveries from infrastructure recon. **Read these — they are the entire foundation.**

### 1. Clerk FAPI — Sign In Without a Browser

OpenRouter delegates all authentication to **Clerk**, a third-party auth-as-a-service provider. Clerk runs a "Frontend API" (FAPI) at `clerk.openrouter.ai` that is meant to be called by browser JavaScript — but it's just HTTP with cookies. We call it from Node.js directly.

**What is Clerk?** It's like Auth0 or Firebase Auth. OpenRouter doesn't run its own login system — they pay Clerk to handle it. Clerk manages user accounts, passwords, OAuth flows, email OTPs, and session JWTs. The FAPI endpoint OpenRouter uses is `https://clerk.openrouter.ai/v1/*`.

**The sign-in flow (3 HTTP calls, ~100ms total for password accounts):**

```
1. GET  https://clerk.openrouter.ai/v1/client
   → Sets __client cookie in response
   → This cookie identifies our "device" to Clerk

2. POST https://clerk.openrouter.ai/v1/client/sign_ins
   Body: identifier=iam@zayd.wtf  (x-www-form-urlencoded)
   Cookie: __client=<from step 1>
   → Returns sign_in_attempt object with:
     - id: "sia_xxx" (sign-in attempt ID)
     - status: "needs_first_factor"
     - supported_first_factors: [{strategy: "password"}, {strategy: "email_code", ...}]
   → The strategies tell us HOW this account authenticates

3. POST https://clerk.openrouter.ai/v1/client/sign_ins/sia_xxx/attempt_first_factor
   Body: strategy=password&password=MyP4ssw0rd  (x-www-form-urlencoded)
   Cookie: __client=<from step 1>
   → On success: status "complete"
   → Sets __session cookie = JWT token
   → This JWT is valid for ALL openrouter.ai dashboard operations
```

**Server-side implementation notes:** In Node.js, read response `Set-Cookie` values with `headers.getSetCookie()` (one string per cookie). Do not rely on `headers.get('set-cookie')` alone—Undici’s `fetch` often omits or merges `Set-Cookie` in ways that break parsing. The first `GET /v1/client` should include `Origin: https://openrouter.ai` and `Referer: https://openrouter.ai/sign-in`; without them, Clerk may not issue `__client` (only intermediary cookies).

**Live test results from this session:**

| Email | Strategies Returned | What This Means |
|-------|-------------------|----------------|
| `iam@zayd.wtf` | `password`, `email_code`, `email_link` | ✅ Has password → **pure HTTP, no browser, fully automatable** |
| `zaydkhan3@gmail.com` | `email_code`, `email_link`, `oauth_google` | ⚠️ Google OAuth only, no password → needs browser or Google auth library |

**Key security detail:** Clerk has `captcha_on_signin: false` for this instance. No CAPTCHA challenge on login. We can sign in freely and repeatedly.

### 2. Google OAuth Accounts — Three Strategies (Best to Worst)

For accounts that only have Google OAuth (no password set):

**Strategy A: Add a password to the account (Best — One-Time Fix)**  
If the user has access to the account, they can add a password through OpenRouter settings or Clerk's account management. This converts it to a password account — pure HTTP forever after. Check if Clerk's FAPI supports `POST /v1/me/change_password` or similar.

**Strategy B: Use `google-auth-library` npm package (Good — Pure HTTP)**  
Google publishes an official Node.js library for programmatic OAuth. We can:
1. Perform Google OAuth outside of a browser using their API
2. Get the OAuth token/code
3. Pass it to Clerk's FAPI endpoint to complete the sign-in:
   ```
   POST /v1/client/sign_ins/sia_xxx/attempt_first_factor
   Body: strategy=oauth_google&token=<google_oauth_token>
   ```
This needs investigation — Clerk may or may not accept a raw Google token via FAPI. If it does, this is fully scriptable.

**Strategy C: Playwright headless Chrome (Fallback — Works but Heavy)**  
Launch headless Chrome, navigate to OpenRouter sign-in, click "Continue with Google", complete Google's login UI, intercept the resulting `__session` cookie. Cache it. Only repeat when session expires.

```javascript
import { chromium } from 'playwright';

async function googleOAuth(email, googlePassword) {
  const browser = await chromium.launch({ 
    headless: true,
    channel: 'chrome',  // Real Chrome binary to avoid Google bot detection
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 ...',  // Random realistic UA
  });
  const page = await context.newPage();
  
  // BONUS: Intercept all network calls to discover tRPC endpoints
  page.on('response', async (res) => {
    if (res.url().includes('/api/trpc/') || res.url().includes('/api/internal/')) {
      // Cache the URL, method, request body shape
      discoveredEndpoints.push({ url: res.url(), method: res.request().method() });
    }
  });
  
  await page.goto('https://openrouter.ai/sign-in');
  await page.click('button:has-text("Continue with Google")');
  
  // Google's login pages
  await page.fill('input[type="email"]', email);
  await page.click('#identifierNext');
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.fill('input[type="password"]', googlePassword);
  await page.click('#passwordNext');
  
  // Wait for redirect back to OpenRouter
  await page.waitForURL('https://openrouter.ai/**', { timeout: 30000 });
  
  // Extract cookies
  const cookies = await context.cookies('https://openrouter.ai');
  const session = cookies.find(c => c.name === '__session');
  const client = cookies.find(c => c.name === '__client');
  
  await browser.close();
  return { session: session.value, client: client.value };
}
```

**Strategy D: Email OTP (Semi-Automated)**  
Even Google OAuth accounts have `email_code` as a fallback strategy. We can:
1. Trigger an OTP email via Clerk FAPI
2. Show a prompt in our UI for the user to paste the 6-digit code from their email
3. Submit the code via FAPI to get the session

This is the simplest fallback — no browser, no Google auth library, just one manual step per session.

### 3. tRPC Routes — The Hidden Dashboard API

OpenRouter's React dashboard makes tRPC calls to perform internal operations. We discovered these routes exist (all return HTTP 200 rather than 404):

**Code Redemption Routes (one or more of these is the real one):**
- `credits.redeem`
- `credits.redeemCode`
- `credits.applyCode`
- `account.redeem`
- `code.redeem`
- `voucher.redeem`
- `promo.redeem`

**Management Key Creation:**
- `managementKeys.create` — **THIS IS THE BIG ONE.** This means management key creation is a tRPC mutation, not a REST endpoint. We can call it with a valid `__session` cookie.

**Other useful routes:**
- `user.me` — user profile
- `credits.balance` — balance (redundant with REST API but useful)
- `keys.create` — alternate key creation route

**The problem:** We don't yet know the exact tRPC request format (input schema, batch format, required headers). These routes serve HTML when called without proper auth/headers because Next.js catch-all routing takes over.

**The solution:** A one-time discovery session (see "Endpoint Discovery Protocol" below).

### 4. Code Redemption — The Multi-Tier Strategy

The user wants to redeem promo codes across accounts. OpenRouter has **no public API for this**. Our strategy, from best to worst:

**Tier 1: tRPC Direct Call (Best — Pure HTTP, ~50ms)**  
Once we capture the exact format of the `credits.redeemCode` (or whichever route is active) tRPC call from a real dashboard session, we can replay it:
```javascript
await fetch('https://openrouter.ai/api/trpc/credits.redeemCode?batch=1', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': `__session=${jwt}; __client=${clientCookie}`,
    // Possibly x-trpc-source or other headers — to be discovered
  },
  body: JSON.stringify({ "0": { "json": { "code": "PROMO-CODE-HERE" } } })
});
```

**Tier 2: Playwright Form Injection (Fallback — ~2s per code)**  
If tRPC replay doesn't work (e.g., CSRF token, Cloudflare challenge), use Playwright:
```javascript
await page.goto('https://openrouter.ai/redeem');
// Find the code input field and submit button
await page.fill('input[name="code"]', 'PROMO-CODE-HERE');  // selector TBD from discovery
await page.click('button[type="submit"]');
// Check for success/error message
```

**Tier 3: Chrome DevTools MCP (Alternative to Playwright)**  
If Playwright is unavailable or the Antigravity browser gets fixed, use the Chrome DevTools MCP tools (`mcp_chrome-devtools_fill`, `mcp_chrome-devtools_click`) to fill and submit the code form in a real Chrome session.

**All tiers require a valid `__session` cookie first** — which comes from the Clerk auth flow above.

### 5. Management Key Creation — Same Pattern

**Tier 1: tRPC `managementKeys.create` direct call** — Pure HTTP once we know the schema  
**Tier 2: Playwright on `/settings/management-keys`** — Navigate, click "Create", copy the key  
**Tier 3: Chrome DevTools MCP** — Same as Tier 2 but via MCP tools

---

## Endpoint Discovery Protocol

Before we can use Tier 1 (tRPC direct calls) for code redemption and management key creation, we need to capture the exact request format. This is a **one-time operation** — once we have the format, we cache it and reuse forever.

### How to Discover

**Method 1: Playwright Network Interception (Preferred)**

```javascript
// discovery-session.js — run once, cache results
const { chromium } = require('playwright');

async function discoverEndpoints(email, password) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const discovered = {};

  page.on('request', (req) => {
    if (req.url().includes('/api/trpc/')) {
      discovered[req.url()] = {
        method: req.method(),
        headers: req.headers(),
        body: req.postData(),
        timestamp: new Date().toISOString(),
      };
      console.log(`[CAPTURED] ${req.method()} ${req.url()}`);
      if (req.postData()) console.log(`  Body: ${req.postData()}`);
    }
  });

  // 1. Log in
  await page.goto('https://openrouter.ai/sign-in');
  // ... complete login
  
  // 2. Navigate to /settings/management-keys and create a test key
  await page.goto('https://openrouter.ai/settings/management-keys');
  // ... click create, observe the tRPC call
  
  // 3. Navigate to /redeem and submit a test code
  await page.goto('https://openrouter.ai/redeem');
  // ... fill form, submit, observe the tRPC call
  
  // 4. Save discovered endpoints
  fs.writeFileSync('docs/recon/DISCOVERED_ENDPOINTS.json', JSON.stringify(discovered, null, 2));
  
  await browser.close();
}
```

**Method 2: Chrome DevTools MCP**

If Playwright isn't working, use the Chrome DevTools MCP:
1. `mcp_chrome-devtools_navigate_page` to openrouter.ai/sign-in
2. Log in manually or via `mcp_chrome-devtools_fill` + `mcp_chrome-devtools_click`
3. Navigate to /settings/management-keys
4. `mcp_chrome-devtools_list_network_requests({ resourceTypes: ["fetch", "xhr"] })` to see all API calls
5. `mcp_chrome-devtools_get_network_request({ reqid: N })` to see exact request/response shapes
6. Repeat for /redeem page

**Method 3: Bundle Reverse-Engineering**

Inspect Next.js JS bundles at `/_next/static/chunks/*.js` for tRPC router definitions. The tRPC client setup will contain the exact route names and Zod input schemas.

```bash
# Download and search JS chunks for tRPC routes
curl -s 'https://openrouter.ai' | grep -oP '/_next/static/chunks/[^"]+\.js' | head -20
# Then search each chunk for 'managementKeys' or 'redeem'
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    React/Vite Frontend                    │
│  Dashboard | Keys | Code Redeemer | Settings             │
└─────────────────────────┬────────────────────────────────┘
                          │ REST API (/api/*)
┌─────────────────────────▼────────────────────────────────┐
│                    Express Backend                        │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │                  Auth Engine                       │  │
│  │                                                    │  │
│  │  clerk-auth.js:                                    │  │
│  │    signInWithPassword(email, pass) → __session     │  │
│  │    signInWithOTP(email) → trigger OTP email        │  │
│  │    completeOTP(siaId, code) → __session            │  │
│  │    signInWithGoogle(email, pass) → __session        │  │
│  │    refreshSession(accountId) → new __session       │  │
│  │    detectAuthMethod(email) → 'password'|'google'   │  │
│  │                                                    │  │
│  │  Priority: HTTP → google-auth-library → Playwright │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Dashboard API Client                  │  │
│  │                                                    │  │
│  │  dashboard-api.js:                                 │  │
│  │    createManagementKey(session) → sk-or-mgmt-xxx   │  │
│  │    redeemCode(session, code) → success/error       │  │
│  │    getProfile(session) → user info                 │  │
│  │    discoverEndpoints(session) → cached routes      │  │
│  │                                                    │  │
│  │  Uses: cached tRPC routes → fallback to Playwright │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │              OpenRouter REST Client                │  │
│  │                                                    │  │
│  │  openrouter.js (already built):                    │  │
│  │    getCredits(mgmtKey) → balance                   │  │
│  │    getKeys(mgmtKey) → key list                     │  │
│  │    createKey(mgmtKey, opts) → new key              │  │
│  │    updateKey(mgmtKey, hash, opts) → updated key    │  │
│  │    deleteKey(mgmtKey, hash) → deleted              │  │
│  │                                                    │  │
│  │  Auth: Authorization: Bearer sk-or-mgmt-xxx        │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Encrypted Vault                       │  │
│  │                                                    │  │
│  │  store.js + Prisma (shipped):                      │  │
│  │    AES-256-GCM on sessionToken + config columns    │  │
│  │    JWT gate + master password → decrypt per row    │  │
│  │    (PBKDF2 file vault below = original plan only)   │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Vault Schema (Extended)

The current vault stores `{ id, alias, managementKey, createdAt }` per account. We need to extend it:

```javascript
{
  accounts: [
    {
      // Existing
      id: "hex16",                              // random 16-char hex ID
      alias: "Personal",                         // user-assigned name
      managementKey: "sk-or-mgmt-xxx",          // OpenRouter management key
      createdAt: "2026-03-30T00:00:00Z",

      // NEW — Credentials (for automated login)
      email: "iam@zayd.wtf",                    // OpenRouter account email
      password: "encrypted_in_vault",            // for password-strategy accounts
      googlePassword: null,                      // for Google OAuth accounts (optional)
      authMethod: "password",                    // "password" | "google" | "github" | "otp"

      // NEW — Clerk session cache (conceptual; see “As implemented” below)
      // Plain __session JWT string; in DB: encrypted into Account.sessionToken
      sessionCookie: "eyJhbG...",                  // or full "__session=..." — same idea as decrypted sessionToken
      clientCookie: "__client=...; __client_uat=...", // device jar; lives in encrypted config JSON
      sessionExpiry: "2026-03-31T01:00:00Z",     // ISO in config; from JWT exp or 24h fallback (getJwtExpiry)
      clerkEmailAddressId: "idn_xxx",            // needed for OTP flow

      // NEW — Status tracking
      lastSync: "2026-03-30T23:00:00Z",          // last successful data refresh
      has2FA: false,                              // TOTP 2FA enabled?
      totpSecret: null,                           // for fully automated 2FA
    }
  ],

  // NEW — Cached tRPC endpoint schemas (from discovery session)
  discoveredEndpoints: {
    redeemCode: {
      url: "https://openrouter.ai/api/trpc/credits.redeemCode",
      method: "POST",
      bodyTemplate: { "0": { "json": { "code": "__CODE__" } } },
      headers: { "x-trpc-source": "nextjs-react" },
      discoveredAt: "2026-03-30T00:00:00Z",
    },
    createManagementKey: {
      url: "https://openrouter.ai/api/trpc/managementKeys.create",
      method: "POST",
      bodyTemplate: { "0": { "json": { "name": "__NAME__" } } },
      headers: {},
      discoveredAt: "2026-03-30T00:00:00Z",
    }
  },

  settings: {
    refreshInterval: 300000,   // 5 minutes in ms
    theme: "dark",
  }
}
```

**As implemented (Hydra today):** One row per account in SQLite. **`sessionToken`**: AES-GCM blob for the Clerk session JWT. **`config`**: AES-GCM JSON with **`clientCookie`**, **`sessionExpiry`**, **`email`**, **`password`**, **`authMethod`**, **`managementKey`**, etc. **`store.getSessionStatus`** drives dashboard **`sessionStatus`** (`active` \| `expiring` \| `expired` \| `none`). Successful logins always set **`sessionExpiry`** (JWT **`exp`** or fallback). **`updateAccountSession(userId, id, …)`** writes the encrypted column and config.

---

## Proposed Changes — File by File

### Phase 1: Auth Engine

---

#### [NEW] `server/services/clerk-auth.js`

The core authentication service. Handles all Clerk FAPI interactions.

**Functions:**

```javascript
// Detect what auth methods an account supports
// Calls: GET /v1/client → POST /v1/client/sign_ins with identifier only
// Returns: { method: 'password'|'google'|'otp', strategies: [...], emailAddressId: 'idn_xxx' }
export async function detectAuthMethod(email)

// Full password sign-in (3 HTTP calls, ~100ms)
// Returns: { sessionCookie, clientCookie, sessionExpiry } — sessionCookie = plain __session JWT (stored via encrypt → Account.sessionToken)
export async function signInWithPassword(email, password)

// Trigger OTP email to user's inbox
// Returns: { siaId, emailAddressId } — user must provide 6-digit code
export async function startEmailOTP(email)

// Complete OTP sign-in with user-provided code
// Returns: { sessionCookie, clientCookie, sessionExpiry } (same sessionCookie semantics as above)
export async function completeEmailOTP(siaId, code, clientCookie)

// Handle TOTP 2FA second factor
// Returns: { sessionCookie, clientCookie, sessionExpiry }
export async function completeSecondFactor(siaId, totpCode, clientCookie)

// Refresh an expired session using cached __client cookie
// Returns: new { sessionCookie, sessionExpiry } or null if re-auth needed (sessionCookie → sessionToken column)
export async function refreshSession(clientCookie)

// Check if a session is still valid (hasn't expired)
export function isSessionValid(sessionExpiry)
```

**Dependencies:** `node-fetch` (or native fetch), `tough-cookie` (cookie jar management), `fetch-cookie` (fetch wrapper with cookie support).

**Clerk FAPI base:** `https://clerk.openrouter.ai/v1`

**Important implementation detail:** All Clerk FAPI calls use `application/x-www-form-urlencoded` for the request body (NOT JSON). This is because Clerk's FAPI is modeled after browser form submissions.

---

#### [NEW] `server/services/google-auth.js`

Handles Google OAuth accounts. Tries pure HTTP first, falls back to Playwright.

**Functions:**

```javascript
// Strategy B: Use google-auth-library to get OAuth token, then pass to Clerk
// If Clerk accepts raw Google tokens via FAPI, this is fully scriptable
export async function signInWithGoogleHTTP(email, googlePassword)

// Strategy C: Playwright headless — launch browser, complete Google OAuth, extract cookies
// Also runs endpoint discovery as a bonus (intercepts all tRPC calls)
export async function signInWithGooglePlaywright(email, googlePassword)

// Convenience: tries HTTP first, falls back to Playwright
export async function signInWithGoogle(email, googlePassword)
```

**Dependencies:** `google-auth-library` (Google's official Node.js OAuth library), `playwright` (fallback).

**Google bot detection notes:**
- Use `channel: 'chrome'` (real Chrome binary, not Chromium)
- Random viewport + user agent
- `slowMo: 50` to simulate human timing
- If Google blocks: the `google-auth-library` approach bypasses their UI entirely

---

#### [NEW] `server/services/dashboard-api.js`

Calls OpenRouter's internal tRPC endpoints using a valid `__session` cookie.

**Parameter note:** **`sessionCookie`** arguments are the **JWT string** for `__session` (equivalent to decrypted **`Account.sessionToken`**), not necessarily a `Cookie:` header line.

**Functions:**

```javascript
// Create a management key for an account
// Uses: cached tRPC route for managementKeys.create
// Fallback: Playwright on /settings/management-keys
export async function createManagementKey(sessionCookie, clientCookie, keyName)

// Redeem a promo/credit code
// Uses: cached tRPC route for credits.redeemCode
// Fallback: Playwright form injection on /redeem
export async function redeemCode(sessionCookie, clientCookie, code)

// Get user profile info
export async function getUserProfile(sessionCookie, clientCookie)

// One-time endpoint discovery session — Playwright intercepts all tRPC calls
// Saves results to vault.discoveredEndpoints
export async function discoverEndpoints(sessionCookie, clientCookie)
```

**Implementation pattern for each function:**
```javascript
async function redeemCode(session, client, code) {
  const cached = store.getDiscoveredEndpoints().redeemCode;
  
  if (cached) {
    // Tier 1: Direct tRPC call
    try {
      const body = JSON.parse(JSON.stringify(cached.bodyTemplate));
      body["0"].json.code = code;
      const res = await fetch(cached.url + '?batch=1', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cookie': `__session=${session}; __client_uat=${client}`,
          ...cached.headers 
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('tRPC direct failed, falling back to Playwright');
    }
  }
  
  // Tier 2: Playwright injection
  return await redeemCodeViaPlaywright(session, client, code);
}
```

---

#### [MODIFY] `server/services/store.js`

Extend with new fields and methods.

**As implemented:** `updateAccountSession(userId, id, sessionCookie, clientCookie, sessionExpiry)` encrypts **`sessionCookie`** into **`sessionToken`** and merges **`clientCookie`** / **`sessionExpiry`** into encrypted **`config`**. `getAccountSession(userId, id)` returns `{ sessionCookie, clientCookie, sessionExpiry }` using **`readSessionToken`**. Account list payloads include **`sessionStatus`** from **`getSessionStatus`**.

**New methods (plan / partial):**
```javascript
// Account credentials (signatures match async Prisma helpers in shipped code)
export function addAccountWithCredentials(userId, alias, email, password, authMethod)
export function updateAccountSession(userId, id, sessionCookie, clientCookie, sessionExpiry)
export function getAccountSession(userId, id)  // returns plain session JWT + client jar + expiry

// Endpoint cache
export function getDiscoveredEndpoints()
export function saveDiscoveredEndpoints(endpoints)

// Bulk operations
export function getAllAccountsNeedingRefresh()  // sessions expiring within 10 min
```

---

### Phase 2: API Routes

---

#### [MODIFY] `server/routes/accounts.js`

New and modified endpoints:

```
POST   /api/accounts                    — Add account (with credentials OR management key)
POST   /api/accounts/bulk               — Bulk add: [{alias, email, password}, ...]
POST   /api/accounts/:id/detect-auth    — Detect auth method for an email (calls Clerk)
POST   /api/accounts/:id/login          — Sign in and cache session
POST   /api/accounts/:id/otp/start      — Trigger OTP email
POST   /api/accounts/:id/otp/verify     — Complete OTP with 6-digit code
POST   /api/accounts/:id/provision      — Create management key (using session cookie)
POST   /api/accounts/:id/refresh        — Refresh session cookie
GET    /api/accounts/:id/session-status — Is the session valid/expiring/expired?
```

#### [NEW] `server/routes/codes.js`

```
POST   /api/codes/redeem                — Redeem code on a single account
POST   /api/codes/bulk                  — Redeem code across multiple accounts
GET    /api/codes/history               — Redemption attempt log
```

#### [NEW] `server/routes/discovery.js`

```
POST   /api/discovery/run               — Run endpoint discovery session (Playwright)
GET    /api/discovery/status            — Current discovered endpoints
```

#### [MODIFY] `server/routes/dashboard.js`

Add auto-refresh logic:
```
GET    /api/dashboard                   — All accounts + balances + key counts
POST   /api/dashboard/refresh           — Force refresh all
GET    /api/dashboard/health            — Session health for all accounts
```

---

### Phase 3: Frontend UI

The current UI has: Dashboard, AccountDetail, KeyManager, CodeRedemption, Settings. These need to be enhanced with the new auth flows and endpoint discovery.

---

#### [MODIFY] `src/App.jsx`

Already rebuilt with new nav items. Needs:
- Rename from "Hydra" to chosen name
- Add nav item for "Discovery" or "Setup" (endpoint discovery)

#### [MODIFY] `src/pages/Dashboard.jsx`

Already rebuilt with:
- Auth method badges (🔑 Password / 🔷 Google / ✉️ OTP) per account card
- Session health dots (green/yellow/red) per account
- Quick action buttons (refresh, login, provision)

Still needs:
- Auto-refresh every 5 minutes via `setInterval` (clear on unmount)
- "Provision All" button for batch management key creation
- Bulk import button (paste email:password per line)

#### [MODIFY] `src/pages/KeyManager.jsx`

Already has account selector sidebar + key CRUD table. Functionally complete pending backend.

#### [MODIFY] `src/pages/CodeRedemption.jsx`

Already has codes × accounts matrix with status cells. Needs backend wiring.

#### [NEW] `src/pages/Onboarding.jsx`

Add Account Wizard with steps:

```
Step 1: Enter credentials
  - Email + Password (for password accounts)
  - Email only (will detect auth method)
  - Management Key only (skip auth, just manage existing)

Step 2: Auth detection & login
  - Auto-detects strategy via Clerk FAPI
  - If password → signs in automatically
  - If Google OAuth → offers OTP fallback or Playwright option
  - If OTP → sends code, shows input field for 6-digit code
  - Shows session status

Step 3: Management key provisioning
  - If account has no management key → attempts to create one via tRPC
  - If tRPC not discovered yet → offers to run discovery session
  - If discovery fails → asks for manual management key input
  - If management key already exists → shows it

Step 4: Confirmation
  - Shows account summary
  - Balance check
  - Key count
  - Session expiry
```

#### [NEW] `src/pages/Setup.jsx` (or rename to BulkImport)

For first-time setup with 20+ accounts:

```
1. Paste block of "email:password" lines (one per line)
2. Click "Import All"
3. System processes each account:
   - Detects auth method
   - Signs in (password → auto, OAuth → prompts for OTP one by one)
   - Creates management key
   - Shows progress bar with per-account status
```

#### [MODIFY] `src/pages/Settings.jsx`

Add sections:
- **Discovered Endpoints:** Show cached tRPC routes, "Re-discover" button
- **Bulk Operations:** Export all account data (encrypted), import from backup
- **Session Management:** "Refresh All Sessions" button, session health overview

---

## Dependencies to Add

```json
{
  "dependencies": {
    "tough-cookie": "^4.1.3",          // Cookie jar for HTTP auth
    "fetch-cookie": "^3.0.0",          // Fetch wrapper with cookie support
    "playwright": "^1.45.0",            // Google OAuth + endpoint discovery
    "google-auth-library": "^9.0.0"    // Google programmatic OAuth (Strategy B)
  }
}
```

**Note:** `playwright` is heavy (~200MB for browser binary). Consider making it an optional dependency installed only when Google OAuth or endpoint discovery is needed. The core password auth flow has zero heavy dependencies.

---

## File Tree After Implementation

```
hydra/
├── docs/
│   ├── AGENTS.md                          — Agent briefing doc
│   └── recon/
│       ├── OPENROUTER_RECON.md            — Full infrastructure map
│       ├── CLERK_API_GUIDE.md             — Clerk FAPI auth flows
│       ├── TRPC_ROUTES.md                 — Discovered tRPC routes
│       └── DISCOVERED_ENDPOINTS.json      — Cached tRPC schemas (generated)
├── server/
│   ├── index.js                           — Express entry point (existing)
│   ├── middleware/
│   │   └── auth.js                        — Vault auth middleware (existing)
│   ├── routes/
│   │   ├── accounts.js                    — Account CRUD + auth flows (modify)
│   │   ├── codes.js                       — Code redemption routes (new)
│   │   ├── dashboard.js                   — Dashboard aggregation (modify)
│   │   ├── discovery.js                   — Endpoint discovery routes (new)
│   │   └── keys.js                        — API key CRUD (existing)
│   └── services/
│       ├── clerk-auth.js                  — Clerk FAPI auth engine (new)
│       ├── dashboard-api.js               — tRPC/Playwright operations (new)
│       ├── google-auth.js                 — Google OAuth handler (new)
│       ├── openrouter.js                  — Management API client (existing)
│       └── store.js                       — Encrypted vault (modify)
├── src/
│   ├── App.jsx                            — App shell + nav (modify)
│   ├── api.js                             — Frontend API client (modify)
│   ├── index.css                          — Design system (modify)
│   └── pages/
│       ├── AccountDetail.jsx              — Account drill-down (existing)
│       ├── CodeRedemption.jsx             — Bulk code × accounts (modify)
│       ├── Dashboard.jsx                  — Main dashboard (modify)
│       ├── KeyManager.jsx                 — Key CRUD per account (modify)
│       ├── Onboarding.jsx                 — Add account wizard (new)
│       ├── Setup.jsx                      — Bulk import (new)
│       └── Settings.jsx                   — Settings + discovery (modify)
├── prisma/                                — Schema + SQLite (live persistence)
├── data/                                  — Optional local artifacts; not the primary vault in shipped Hydra
│   ├── vault.enc                          — Legacy plan: encrypted file vault (if ever used)
│   └── vault.salt                         — Legacy plan: PBKDF2 salt
├── package.json
├── vite.config.js
└── index.html
```

---

## Implementation Order

```
1. clerk-auth.js          — Password auth flow (pure HTTP, test with iam@zayd.wtf)
2. store.js extensions    — Extended vault schema for credentials + sessions
3. accounts.js routes     — /detect-auth, /login, /otp/start, /otp/verify
4. Dashboard.jsx updates  — Session dots, auth badges, auto-refresh
5. google-auth.js         — Google OAuth (google-auth-library → Playwright fallback)
6. dashboard-api.js       — tRPC code redemption + mgmt key creation
7. discovery.js           — Endpoint discovery session
8. codes.js routes        — Code redemption API + bulk redemption
9. CodeRedemption.jsx     — Wire up to backend
10. Onboarding.jsx        — Add account wizard
11. Setup.jsx             — Bulk import
12. Settings.jsx updates  — Discovery status, session management
```

Steps 1-4 are the critical path — they deliver functional multi-account management with auto-login for password accounts. Steps 5-7 unlock Google OAuth accounts and the tRPC automation. Steps 8-12 are the UI polish.

---

## Verification Plan

### Automated (During Development)

1. **Clerk auth test:** Sign in with `iam@zayd.wtf` using clerk-auth.js → verify `__session` cookie returned
2. **Session persistence:** After login, vault row has non-empty encrypted **`sessionToken`** and **`config.sessionExpiry`** set (JWT **`exp`** or 24h fallback); **`GET /api/accounts`** shows **`sessionStatus`** **`active`** / **`expiring`** / **`expired`** / **`none`** — not **`unknown`** for “token without expiry” (see **`docs/DASHBOARD_ACCOUNT_STATES.md`**).
3. **Session use:** Use `__session` to call `GET /api/v1/credits` → verify balance returned
4. **Auth detection:** Call `detectAuthMethod('zaydkhan3@gmail.com')` → verify returns `google`
5. **Management API:** Use existing management key to call `GET /api/v1/keys` → verify key list
6. **Vault roundtrip:** Store credentials → lock vault → unlock → verify credentials intact

### Manual (User Testing)

1. Add `iam@zayd.wtf` with password → verify auto-login + balance shown
2. Add a Google OAuth account → verify OTP fallback flow works
3. Redeem a real promo code → verify credits increase
4. Create management key for an account that doesn't have one → verify key works
5. Bulk import 5 accounts → verify all show on dashboard

---

## Reference: Quick Cheat Sheet for Agents

**To sign in with a password account:**
```bash
# 1. Get client
curl -s -c /tmp/clerk.txt https://clerk.openrouter.ai/v1/client

# 2. Start sign-in
curl -s -b /tmp/clerk.txt -c /tmp/clerk.txt \
  -X POST https://clerk.openrouter.ai/v1/client/sign_ins \
  -d 'identifier=iam@zayd.wtf'

# 3. Complete with password (replace sia_xxx with the ID from step 2)
curl -s -b /tmp/clerk.txt -c /tmp/clerk.txt \
  -X POST https://clerk.openrouter.ai/v1/client/sign_ins/sia_xxx/attempt_first_factor \
  -d 'strategy=password&password=THE_PASSWORD'

# 4. Check session (look for __session in cookies)
cat /tmp/clerk.txt | grep __session
```

**To use the session:**
```bash
curl -s -H 'Cookie: __session=JWT_HERE' https://openrouter.ai/api/v1/credits
```

**Important URLs:**
- Clerk FAPI: `https://clerk.openrouter.ai/v1/`
- Sign-in page: `https://openrouter.ai/sign-in`
- Management keys page: `https://openrouter.ai/settings/management-keys`
- Code redemption page: `https://openrouter.ai/redeem`
- GraphQL: `https://openrouter.ai/graphql` (needs auth, introspection worth trying)
- Status: `https://status.openrouter.ai`

**Management API (once you have a management key):**
```bash
curl -s -H 'Authorization: Bearer sk-or-mgmt-xxx' https://openrouter.ai/api/v1/credits
curl -s -H 'Authorization: Bearer sk-or-mgmt-xxx' https://openrouter.ai/api/v1/keys
```
