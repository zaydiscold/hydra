# Hydra Server Architecture

## Middleware Stack (Order Matters)

The Express middleware chain is configured in `/server/index.js` in this order:

1. **CORS** - Enables cross-origin requests
2. **JSON Parser** - Parses incoming `application/json` bodies
3. **Rate Limiting** - Applied selectively per route (see below)
4. **Authentication** - `requireUnlocked` middleware validates Bearer token JWT

The **error handler middleware** runs last as a catch-all (see Global Error Handler section).

## Route Groups & Mounting

All protected routes must use `requireUnlocked` middleware unless explicitly noted.

### Public Routes (No Auth Required)

- **Auth** - `/api/auth/*`
  - `GET /status` - Check setup/login state
  - `POST /setup` - Create password (first-time setup)
  - `POST /login` - Authenticate and receive JWT
  - `POST /nuke` - Nuclear reset (wipe database)
  - **Protected:** `POST /logout`, `POST /change-password`

- **Webhooks** - `/api/webhooks/*`
  - `POST /clerk` - Clerk authentication webhook (idempotent)

- **Proxy Status** - `/api/pool/status` (no auth)
  - Public liveness probe for Pool Manager

### Protected Routes (Require JWT)

- **Accounts** - `/api/accounts/*` (includes `POST /bulk-otp-stubs` for email-only OTP stub creation before sequential Clerk OTP; primary UI: SPA **`/bulk-auth`** — `BulkAuthWizard.jsx`)
  - CRUD, login, OTP verification, refresh, provisioning (`POST …/provision` returns **422** with `PROVISION_FAILED` when `createManagementKey` gets a permanent tRPC error; Playwright extraction failures are **500** with **`code`:** **`PROVISION_PLAYWRIGHT_EXTRACT`** and a **`hint`** to **`$TMPDIR/hydra-provision-debug/`**). **`PATCH …/:id`** may set **`managementKey`** (Key Manager paste modal → **`openrouter.getCredits`** probe; no new route). Provisioning captures created keys from **tRPC / server Playwright**, not from IDE browser clipboard — see **`MANAGEMENT_KEY_PROVISION_AUTOMATION.md`**.
  - Uses arrow wrapper pattern: `(req,res) => controller.method(req,res)`
  - **Email OTP (vault unlocked, JWT):** `POST /api/accounts/:id/otp/start` → `AccountController.startOTP` → `startEmailOTP` (Clerk `prepare_first_factor`); **`store.updateAccountSession`** is called with **`{ preserveSessionToken: true }`** so the vault **`__session`** JWT is **not** cleared when sending a code (only **`clientCookie`** is updated until **`otp/verify`** succeeds). `POST /api/accounts/:id/otp/verify` → `AccountController.verifyOTP` → `completeEmailOTP` (Clerk `attempt_first_factor` over **`clerkHttpsJson`** in `clerk-auth.js`). **HTTP routes and handlers are unchanged**; session materialization after Clerk `status=complete` is implemented entirely in `clerk-auth.js` (`resolveSessionAfterCompletedAttempt`: Set-Cookie **`__session`**, embedded JWT from **`client` / `response` / `client.sign_in`**, optional **`POST …/client/sessions/{id}/touch`**, then retried **`GET /client`**). Password login and TOTP completion use the same resolver. Persisted fields include the serialized device cookie jar (`__client` + **`__client_uat`** / **`__client_uat_*`** as returned by Clerk), encrypted **`sessionToken`** (**`__session`** JWT), and **`config.sessionExpiry`** (ISO from JWT **`exp`**, or a 24-hour fallback if **`exp`** is absent—see **`docs/ARCHITECTURE_DEEP_DIVE.md`**). **Session persistence beyond login:** `dashboard-api.ensureSession` (provision/redeem/tRPC) **backfills** missing **`sessionExpiry`** from the JWT, persists expiry after OpenRouter **`validateSession`**, and uses **multi-attempt** Clerk refresh—see **`docs/ARCHITECTURE_DEEP_DIVE.md`** (*ensureSession and persistent sessionExpiry*). With **`CLERK_DEBUG_OTP=1`**, failures on these and related account routes may include extra JSON fields (**`clerkDebugHint`**) for operator UI; see **`docs/API_REFERENCE.md`**. See **`docs/ARCHITECTURE_DEEP_DIVE.md`** and **`.env.example`** for debugging.

- **Keys** - `/api/accounts/:accountId/keys/*`
  - List, create, update, delete account keys
  - Uses `.bind(controller)` pattern

- **Dashboard** - `/api/dashboard/*`
  - Full dashboard data with live balances and key counts
  - **`GET /api/dashboard`** (and **`POST /api/dashboard/refresh`**) may **proactively refresh** Clerk sessions: for each account whose vault **`sessionStatus`** is **`expiring`** and a usable **`clientCookie`** is present, `DashboardController` calls **`clerkAuth.refreshSession`** and persists new **`sessionToken`** / **`sessionExpiry`** when Clerk returns a session—no OTP or session wipe.
  - Refresh endpoint for manual refresh

- **Codes** - `/api/codes/*`
  - Redeem single code, bulk redeem, bulk matrix operations (`dashboard-api.redeemCode`: cached tRPC → procedure candidates → Playwright with **tRPC `waitForResponse`**, failure-first UI scan, optional **credits total** poll via management key, then **`REDEEM_OUTCOME_UNKNOWN`** + **`uiFeedback`**)
  - `POST /preflight` — session readiness for selected accounts before bulk redeem
  - `GET /endpoints` — persisted OpenRouter **redeem** tRPC route discovery (not a new Hydra route; see **API_REFERENCE** Code Redemption)

- **Generator** - `/api/generator/*`
  - Signup task management (start, status, heartbeat, verify OTP, cleanup)

- **Pool** - `/api/pool/*` (most require auth)
  - Pool data (includes `modelCache` summary for CachedModel), master key derivation, network info
  - Key/account toggle, key string registration
  - Pool reload, model list refresh, traffic metrics

- **System** - `/api/system/*`
  - Background task management (list, cancel)
  - Health check endpoint

### OpenAI-Compatible Proxy

- **Proxy** - `/v1/*`
  - Validates master key (`Bearer sk-hydra-*`)
  - Rotates through pooled keys and forwards to OpenRouter
  - `GET /v1/models` is cache-first (`CachedModel`), then live OpenRouter with write-through, then static fallback; sets `X-Hydra-Models-Source`
  - Handles failover, rate-limit cooldowns, model fallback
  - Streams responses and logs all requests to database

**Optional external gateways:** Hydra does not bundle [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) or LiteLLM. For architecture choices, sidecar ports, example OpenRouter config, and borrowable feature ideas, see [`docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md`](CLIPROXYAPI_GATEWAY_SYNTHESIS.md).

### Static / SPA Fallback

- Serves `/dist` folder (production build)
- Catch-all redirects non-API GET requests to `index.html`

### Development vs production (same route map)

The **Express route map above is unchanged** between dev and prod. In **development**, operators often open the SPA from the Vite dev server (`vite.config.js` default port `5173`, overridable via `HYDRA_VITE_PORT`). The browser issues `fetch('/api/...')` to the Vite origin; Vite **proxies** `/api` to `http://localhost:3001`. If the Node server is not running, requests fail at the proxy/network layer — **no extra Hydra routes** were added for “launch” or “backend health” for that case. The React app handles messaging and copy-to-clipboard hints client-side (see **`ARCHITECTURE_DEEP_DIVE.md`** — *Development: backend-down UX*, and **`API_REFERENCE.md`** — *Frontend API client*).

## Controller Binding Pattern

**CRITICAL:** All route handlers must preserve the controller's `this` context to access instance methods.

### Correct Patterns

**Pattern 1 - Using `.bind(controller)` (recommended for simple cases)**
```javascript
import KeyController from '../controllers/KeyController.js';

router.get('/:accountId/keys', requireUnlocked, KeyController.listKeys.bind(KeyController));
```

**Pattern 2 - Arrow wrapper (recommended for instances)**
```javascript
const controller = new AccountController();

router.get('/', requireUnlocked, (req, res) => controller.getAccounts(req, res));
```

### Incorrect Pattern (Causes "Cannot read properties of undefined" Error)

```javascript
// DO NOT DO THIS
router.get('/', requireUnlocked, KeyController.listKeys);  // ❌ 'this' is lost
```

## BaseController Response Shapes

All controllers extend `BaseController` which provides standardized response methods.

### Success Response

```javascript
controller.success(res, data, statusCode = 200)
// Returns:
{
  "success": true,
  "data": { /* your data */ },
  "timestamp": "2026-04-01T12:34:56.789Z"
}
```

### Error Response

```javascript
controller.error(res, message, statusCode = 500, code = 'INTERNAL_ERROR')
// Returns:
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "timestamp": "2026-04-01T12:34:56.789Z"
}
```

### Validation Helper

```javascript
// Throws error with status 400 on validation failure
const validated = controller.validate(data, zodSchema);
```

## Global Error Handler

Middleware at the end of the chain catches all errors:

- Logs full stack trace to console (development only)
- Sends sanitized response (production hides stack)
- Response format:
  ```json
  {
    "error": "Error message",
    "status": 500,
    "stack": "..." // dev only
  }
  ```

## How to Add a New Route / Controller

### 1. Create Controller

Create `/server/controllers/MyController.js`:

```javascript
import BaseController from './BaseController.js';

export default class MyController extends BaseController {
  async myMethod(req, res) {
    try {
      // Your logic here
      const data = { /* ... */ };
      return this.success(res, data);
    } catch (err) {
      return this.error(res, err.message, 400, 'MY_ERROR_CODE');
    }
  }
}
```

### 2. Create Route File

Create `/server/routes/myroutes.js`:

```javascript
import { Router } from 'express';
import { requireUnlocked } from '../middleware/auth.js';
import MyController from '../controllers/MyController.js';

const router = Router();
const controller = new MyController();

// ✅ Use arrow wrapper for controller instances
router.get('/', requireUnlocked, (req, res) => controller.myMethod(req, res));

// ✅ OR use .bind() for static methods
// router.get('/', requireUnlocked, MyController.staticMethod.bind(MyController));

export default router;
```

### 3. Register Route in `/server/index.js`

Add to imports:
```javascript
import myRoutes from './routes/myroutes.js';
```

Add to app (before error handler):
```javascript
app.use('/api/myroutes', myRoutes);  // or '/api/prefix' as needed
```

### 4. Update this Document

After making changes to routes or controllers, update the "Route Groups & Mounting" section to reflect the new endpoints.

## Notes on Key Services

- **Auth** - `requireUnlocked` validates JWT, extracts user, attached to `req.user`
- **Rate Limiting** - Applied globally to `/api/auth/` with configurable window and max attempts
- **Logging** - All errors logged via `logger` service; proxy requests logged to database
- **Proxy** - Independent authentication via master key; rotates keys and implements failover logic
