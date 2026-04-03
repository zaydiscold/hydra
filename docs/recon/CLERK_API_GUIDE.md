# Clerk FAPI — Programmatic Authentication Guide
> OpenRouter uses Clerk for auth. This documents how to automate it.

## What is Clerk?

Clerk is an authentication-as-a-service platform. OpenRouter's production instance is hosted at:
- **Frontend API (FAPI):** `https://clerk.openrouter.ai`
- **Published Key:** `pk_live_*` (not needed for FAPI calls, only SDK init)

The FAPI is what browsers call when you log in on openrouter.ai. Since it's just HTTP+cookies, we call it directly without a browser for email+password accounts.

---

## Authentication Flows

### Flow A: Email + Password (Fully Scriptable, ~100ms)

```javascript
// server/services/clerk-auth.js
import { CookieJar } from 'tough-cookie';
import fetch from 'node-fetch';

const CLERK_BASE = 'https://clerk.openrouter.ai/v1';

export async function signInWithPassword(email, password) {
  const jar = new CookieJar();
  
  // 1. Create client session
  const clientRes = await fetch(`${CLERK_BASE}/client`, { credentials: 'include' });
  // Manually handle cookies: extract __client from set-cookie headers
  
  // 2. Start sign-in with email identifier
  const signInRes = await fetch(`${CLERK_BASE}/client/sign_ins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': clientCookie },
    body: `identifier=${encodeURIComponent(email)}`
  });
  const { response: sia } = await signInRes.json();
  // sia.status === 'needs_first_factor'
  // sia.id === 'sia_xxx'
  
  // 3. Submit password
  const authRes = await fetch(`${CLERK_BASE}/client/sign_ins/${sia.id}/attempt_first_factor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': clientCookie },
    body: `strategy=password&password=${encodeURIComponent(password)}`
  });
  
  // 4. Extract __session JWT from set-cookie
  const sessionCookie = extractCookie(authRes.headers.get('set-cookie'), '__session');
  return sessionCookie; // Use this for all dashboard calls
}
```

### Flow B: Google OAuth (Requires Playwright — one-time setup)

```
1. Launch Playwright with page.on('response', ...) to intercept cookies
2. Navigate to: https://accounts.openrouter.ai (Clerk-hosted OAuth page)
   OR: use /v1/client/sign_ins/{sia_id}/prepare_first_factor
       with strategy=oauth_google + redirect_url=<our callback>
3. Playwright handles: Google login page → consent → redirect back to OpenRouter
4. Intercept the __session cookie from the final redirect
5. Store in vault. Reuse until expiry. Then redo Step 1-4.
```

```javascript
// Using Playwright for OAuth accounts
import { chromium } from 'playwright';

export async function signInWithGoogle(email) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Intercept all API calls to discover internal endpoints
  page.on('response', async (res) => {
    if (res.url().includes('openrouter.ai/api')) {
      console.log(res.request().method(), res.url());
      // Cache discovered endpoints for pure HTTP reuse
    }
  });
  
  // Navigate to OAuth flow
  await page.goto('https://openrouter.ai/sign-in');
  await page.click('[data-strategy="oauth_google"]');
  // Handle Google login
  await page.fill('input[type="email"]', email);
  await page.click('button[type="submit"]');
  // Wait for redirect back to OpenRouter
  await page.waitForURL('**/openrouter.ai/**');
  
  // Extract session cookie
  const cookies = await context.cookies('https://openrouter.ai');
  const session = cookies.find(c => c.name === '__session');
  
  await browser.close();
  return session.value;
}
```

### Flow C: Email OTP (Semi-automated — user provides code once)

```javascript
// Step 1: Trigger OTP email
const siaId = await startSignIn(email);
const emailId = getEmailId(strategies);
await fetch(`${CLERK_BASE}/client/sign_ins/${siaId}/prepare_first_factor`, {
  method: 'POST',
  body: `strategy=email_code&email_address_id=${emailId}`
});

// Step 2: User provides 6-digit code from email
// (show input in Hydra UI)

// Step 3: Submit code
const session = await fetch(`${CLERK_BASE}/client/sign_ins/${siaId}/attempt_first_factor`, {
  method: 'POST',
  body: `strategy=email_code&code=${userCode}`
});
```

---

## Session Cookie Lifecycle

| Cookie | Purpose | Expires |
|--------|---------|---------|
| `__client` | Clerk client identity | Long-lived (~months) |
| `__session` | Active session JWT | ~1 hour (auto-refreshable) |

**Refreshing:** Call `GET /v1/client` with existing `__client` cookie to check session status. If expired, re-auth.

### Session activation after `complete` (Hydra parity)

Some responses return `status: complete` on the sign-in object but omit **`__session`** in `Set-Cookie` until the Clerk browser SDK runs **`setActive`**, which issues:

`POST /v1/client/sessions/{session_id}/touch?_clerk_js_version=…`

with **`Origin`** / **`Referer`** matching the hosted app (e.g. openrouter.ai). **Hydra** (`server/services/clerk-auth.js`) mirrors this when the sign-in JSON includes **`created_session_id`** or **`createdSessionId`**: **POST touch** with the full **device cookie jar** (not only **`__client`**—also **`__client_uat`** / **`__client_uat_*`** as Clerk sets them), then **GET /v1/client** (with short retries) until **`__session`** appears or an embedded session JWT is found in **`client`**, Client-shaped **`response`**, top-level **`response`**, or **`client.sign_in`**. The vault persists that jar as **`clientCookie`** for replay on FAPI and dashboard requests. See **`docs/ARCHITECTURE_DEEP_DIVE.md`**. Debug without logging cookie values: **`CLERK_DEBUG_OTP=1`** (also in **`.env.example`**); API errors may include **`clerkDebugHint`** for the UI when debug is on.

---

## Using the Session for Dashboard Operations

Once you have `__session`, use it as a cookie for any authenticated openrouter.ai endpoint:

```javascript
const response = await fetch('https://openrouter.ai/api/internal/something', {
  headers: {
    'Cookie': `__session=${sessionJwt}; __client=${clientCookie}`,
    'Content-Type': 'application/json',
  }
});
```

---

## Detecting Auth Method Per Account

Call `GET /v1/client/sign_ins` then `POST` with the identifier. The `supported_first_factors` response tells you what auth methods the account has:

```json
// Email + Password account:
"supported_first_factors": [
  { "strategy": "password" },                      ← Can automate fully
  { "strategy": "email_code", "email_address_id": "idn_xxx" },
  { "strategy": "email_link", "email_address_id": "idn_xxx" }
]

// Google OAuth account:
"supported_first_factors": [
  { "strategy": "email_code", "email_address_id": "idn_xxx" },
  { "strategy": "email_link", "email_address_id": "idn_xxx" },
  { "strategy": "oauth_google" }                   ← Needs Playwright once
]
```

**No `password` in strategies = OAuth-only account.**

---

## TOTP 2FA Handling

If account has 2FA enabled, after first factor you get `status: "needs_second_factor"`:

```javascript
await fetch(`${CLERK_BASE}/client/sign_ins/${siaId}/attempt_second_factor`, {
  method: 'POST',
  body: `strategy=totp&code=${totpCode}`
});
```

Hydra will need to store TOTP secrets to fully automate this. Otherwise, prompt user once per session.

---

## Tested Accounts

| Account | Method | Result |
|---------|--------|--------|
| `zaydkhan3@gmail.com` | Google OAuth | Reaches `needs_first_factor` with `email_code` + `oauth_google`. No password. |
| `iam@zayd.wtf` | **Password** | Reaches `needs_first_factor` with **`password`** strategy. Fully automatable. |
