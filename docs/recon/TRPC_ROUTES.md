# OpenRouter tRPC Routes — Discovered
> Gathered: 2026-03-30 | Method: URL probing

## Background

OpenRouter uses **tRPC** (TypeScript RPC framework) for its internal dashboard API calls. These are the routes the React dashboard frontend calls to perform operations that aren't in the public REST API (`/api/v1/*`).

The tRPC endpoints live at `/api/trpc/{route}` and require:
1. A valid `__session` cookie (from Clerk authentication)
2. Proper tRPC batch request format
3. Correct Content-Type headers

**These are NOT publicly documented.** We discovered them through URL probing and will need to intercept actual dashboard network calls (via Playwright or Chrome DevTools MCP) to capture the exact request/response shapes.

---

## Discovered tRPC Routes

All of these return HTTP 200 (rather than 404), confirming they are registered routes:

### Credits & Code Redemption
| Route | Probable Purpose | Priority |
|-------|-----------------|----------|
| `credits.redeem` | Redeem a promo/credit code | 🔴 HIGH |
| `credits.redeemCode` | Alternate redeem endpoint | 🔴 HIGH |
| `credits.applyCode` | Apply code to account | 🔴 HIGH |
| `credits.addCredits` | Add credits (payment?) | 🟡 MEDIUM |
| `credits.balance` | Get credit balance | 🟢 LOW (have REST API) |

### Account & User
| Route | Probable Purpose | Priority |
|-------|-----------------|----------|
| `user.me` | Current user profile | 🟡 MEDIUM |
| `account.redeem` | Account-level code redemption | 🔴 HIGH |
| `code.redeem` | Generic code redemption | 🔴 HIGH |
| `voucher.redeem` | Voucher redemption | 🔴 HIGH |
| `promo.redeem` | Promo code redemption | 🔴 HIGH |

### Key Management
| Route | Probable Purpose | Priority |
|-------|-----------------|----------|
| `keys.create` | Create API key | 🟢 LOW (have REST API) |
| `managementKeys.create` | **Create management key** | 🔴 HIGH — THIS IS THE ONE |
| `managementKey.create` | Alternate naming | 🟡 tried in Hydra candidates |
| `keys.createManagement` | Alternate naming | 🟡 tried |
| `managementKeys.createKey` | Alternate naming | 🟡 tried |
| `management.createManagementKey` | Alternate naming | 🟡 tried |
| `apiKeys.createManagement` | Alternate naming | 🟡 tried in Hydra candidates |

Hydra’s `createManagementKey()` in `server/services/dashboard-api.js` tries these in order after the cached route (if any). It also tries **`{ name }`** and **`{ label }`** payloads per route when replaying tRPC.

---

## Live dashboard UI — Management Keys (accessibility snapshot)

**Captured:** 2026-04-02 · **URL:** `https://openrouter.ai/settings/management-keys` · **Method:** Cursor IDE browser (logged-in session).

This capture is **documentation for selectors and UX**; it does **not** connect to Hydra’s SQLite vault. End-user automation is **`POST /api/accounts/:id/provision`** → **`server/services/dashboard-api.js`** (tRPC + optional **server** Playwright). See **`docs/MANAGEMENT_KEY_PROVISION_AUTOMATION.md`** (*IDE / assistant browser recon vs Hydra automation*).

Useful for server-side Playwright selectors when the DOM drifts:

| Control | A11y role / name | Notes |
|--------|-------------------|--------|
| Open create flow | `button` **Create** | Primary toolbar action; exact name is `Create`, not “Create management key”. |
| Key label field | `textbox` **Name** | Placeholder text includes **Management Key** (e.g. `e.g. "Management Key"`). |
| Submit | `button` **Save** | Prefer **Save** over **Create** so the script does not hit the toolbar Create again. |
| Dismiss | `button` **Close** | Present while the create/edit surface is open. |

Hydra’s `dashboard-api.js` matches this order: prefer `getByRole('textbox', { name: /^name$/i })`, then `getByRole('button', { name: /^save$/i })`, with CSS fallbacks.

### Management keys: tRPC vs headless browser (compare / contrast)

OpenRouter does **not** document a public REST endpoint to **create** a management key; the dashboard uses **internal** calls (historically **`POST /api/trpc/{procedure}?batch=1`**). Hydra mirrors that with **`trpcCall`** first, then **Chromium + Playwright** if replay fails.

| | **Direct tRPC** (`createManagementKey` → `trpcCall`) | **Playwright** (`createManagementKeyViaPlaywright`) |
|---|------------------------------------------------------|------------------------------------------------------|
| **Role in Hydra** | **Primary** — cached procedure, then named candidates | **Fallback** — after all tRPC attempts miss or return unusable JSON |
| **Cost / latency** | One **`fetch`** per try; milliseconds, tiny memory | Launches browser, navigation, **~seconds**, **hundreds of MB** RAM per run |
| **Bulk / many accounts** | Reasonable to call sequentially per account | **Expensive** — avoid N parallel browsers; Hydra runs one provision at a time per request |
| **What breaks it** | Wrong procedure name, batch/superjson shape change, new required headers, session as HTML | DOM/a11y rename (**Create** / **Name** / **Save**), layout changes, anti-bot friction |
| **Secret capture** | Parse JSON body for `sk-or-mgmt-…` fields (`key`, `managementKey`, etc.) | Prefer **`waitForResponse`** on **`/api/trpc/`** POST whose body includes the key **name**, then regex on response text; else scrape page text / visible key |
| **Discovery** | First success (or Playwright interception) **persists** `createManagementKey.route` in the vault for next time | Manual or IDE browser sessions are for **capturing** procedure URLs, headers, and **accessibility names** — not for every user click in production; they also **do not** store the created key in Hydra (use **Provision** or **`PATCH`** paste) |

**Verdict:** **tRPC is better for steady-state operation** (cheaper, faster, simpler). The **browser** (DevTools Network, Cursor browser snapshot, `playwright codegen`) is **better for discovery and refinement** when the internal API or UI drifts — i.e. it “refunds” tooling by turning a one-time human observation into code + cached route. **Playwright inside the API** stays as the **reliability net** when replay is wrong but the session is still valid.

---

## Live dashboard UI — Redeem (accessibility snapshot)

**Captured:** 2026-04-02 · **URL:** `https://openrouter.ai/redeem` · **Method:** Cursor IDE browser (logged-in session).

| Control | A11y role / name | Notes |
|--------|-------------------|--------|
| Code field | `textbox` **Promo Code** | Placeholder e.g. `ABCDEF`; analytics tag `first_field_id=code`. |
| Submit | `button` **Redeem Code** | While submitting, label may show **Redeeming...**. |

**Network (browser):** Submitting the form issues **POST** to `https://openrouter.ai/redeem` (Next.js / RSC-style handler), not necessarily `/api/trpc/...` in the tab’s network log. Hydra’s **server-side** redeem still uses **`POST /api/trpc/{procedure}?batch=1`** with `{ "0": { "json": { "code": "..." } } }` when that path returns JSON.

**Hydra server:** `redeemCode()` passes **`Referer: …/redeem`** on all redeem tRPC calls (see `REDEEM_TRPC_HEADERS` in `server/services/dashboard-api.js`). Playwright tries **`/redeem` first**, then billing/credits modal fallbacks.

---

## Redeem: tRPC vs browser automation (compare / contrast)

OpenRouter’s **logged-in** redeem UI today often talks to the app via **POST `/redeem`** (Next.js Server Actions / RSC), while Hydra’s **preferred** automation path is still **`POST /api/trpc/{procedure}?batch=1`** with session cookies—the same internal RPC the dashboard may call from other surfaces. They are **not** the same wire format.

| | **tRPC replay** (`redeemCode` → `trpcCall`) | **Playwright** (`redeemCodeViaPlaywright`) |
|---|---------------------------------------------|--------------------------------------------|
| **Role in Hydra** | **Primary** — try cached route, then candidate procedures | **Fallback** — only after tRPC fails or returns unusable responses |
| **Cost** | One lightweight `fetch` per attempt | Chromium launch, navigation, waits; **much** higher CPU/RAM and latency |
| **Bulk redeem** | Scales reasonably (sequential HTTP per account) | **Bad** at volume — Hydra runs Playwright **one account at a time** on purpose to avoid OOM |
| **Stability** | Breaks if OpenRouter renames procedures, changes batch/superjson shape, or tightens headers | Breaks if copy, layout, or accessibility names change (e.g. “Promo Code”, “Redeem Code”) |
| **Truth source** | Procedure name + JSON body from discovery cache or prior successful interception | Matches **exact** user-visible flow; good when tRPC is undocumented or returns HTML |
| **Browser / manual session** | Used to **discover** procedure names, confirm `Referer`, and validate `{ code }` input — not required every redeem | Used to **refine selectors** and to **record** tRPC URLs when the page fires `/api/trpc/*` during submit |

**Verdict:** Prefer **tRPC** whenever it returns JSON and a known-good procedure. Use the **browser** (manual DevTools, IDE browser, or Playwright) to **refine** the tool—capture routes, headers, and selectors—then rely on tRPC for day-to-day usage. Playwright remains the **reliability net** when the internal API drifts.

**Hydra implementation note:** Playwright no longer relies on a single success toast string. After submit, `resolvePlaywrightRedeemOutcome` uses **`waitForResponse`** on matching **`POST /api/trpc/*`**, parses batch JSON like `trpcCall`, then failure-first dialog/body text, then **`GET /api/v1/credits`** **total** polling when a management key exists, then a legacy success regex, else **`REDEEM_OUTCOME_UNKNOWN`** with **`uiFeedback`**. Cached route discovery, full **`errorCode`** table, optional response fields, and **`POST /api/codes/redeem`** HTTP envelope: [API_REFERENCE.md](../API_REFERENCE.md#code-redemption-routes) (*Code Redemption Routes*).

---

## Why They Return HTML

When calling these without proper session cookies and tRPC headers, Next.js serves the React SPA HTML instead of a JSON API response. This is because:

1. Next.js catch-all route `[[...slug]].tsx` matches everything
2. The tRPC middleware only activates with proper request format
3. Without auth, Cloudflare or Next.js middleware redirects/serves the SPA

## How to Actually Call Them

The correct tRPC call format (to be confirmed by network interception):

```javascript
// tRPC v10 batch format
const response = await fetch('https://openrouter.ai/api/trpc/credits.redeemCode?batch=1', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': `__session=${sessionJwt}; __client=${clientCookie}`,
    'Referer': 'https://openrouter.ai/redeem',
    'Origin': 'https://openrouter.ai',
    'x-trpc-source': 'nextjs-react',
    // May need additional headers like x-trpc-source, etc.
  },
  body: JSON.stringify({
    "0": {
      "json": {
        "code": "PROMO-CODE-HERE"
      }
    }
  })
});
```

## Discovery Strategy

To capture the **exact** request format:

### Option 1: Playwright Network Interception (Recommended)
```javascript
const page = await browser.newPage();
page.on('request', (req) => {
  if (req.url().includes('/api/trpc/')) {
    console.log('tRPC Call:', {
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      body: req.postData(),
    });
  }
});
// Navigate to /redeem and /settings/management-keys, observe calls
```

### Option 2: Chrome DevTools MCP (If Playwright Unavailable)
Use the Chrome DevTools MCP `list_network_requests` tool to capture requests while manually navigating the dashboard.

### Option 3: Reverse-Engineer the JS Bundle
Inspect `/_next/static/chunks/*.js` for tRPC router definitions and mutation schemas. The trpc client setup will show the exact route names and input types.

---

## Management keys — captured network (operator paste)

**Purpose:** When headless provision fails with “Could not extract management key via Playwright”, capture the **real** wire format from the same stack Hydra uses (Playwright in Node), then paste a **sanitized** summary here so `trpcCall` candidates and Playwright waiters stay aligned.

### How to capture

1. **From Hydra (recommended):** set `HYDRA_PROVISION_NETWORK_LOG=1` (or `HYDRA_PROVISION_DEBUG=1`, which enables the same logging path). Run **Provision** once with `HYDRA_PLAYWRIGHT_HEADED=1` if you need to watch the browser. Logs are written under **`$TMPDIR/hydra-provision-debug/provision-network-<accountId>-<ts>.log`** — lines are **POST URL**, **status**, and **truncated `postData` only** (no response bodies).
2. **Standalone script (no Hydra API / DB):** from the repo root, export a live dashboard session and run:
   ```bash
   HYDRA_CAPTURE_OR_SESSION='<__session JWT>' \
   HYDRA_CAPTURE_OR_CLIENT='<optional device jar, same as vault clientCookie>' \
   HYDRA_PLAYWRIGHT_HEADED=1 \
   node scripts/capture-mgmt-key-network.mjs
   ```
   Output: stdout plus **`$TMPDIR/hydra-provision-debug/capture-mgmt-<ts>.log`**.

### Paste template (replace with your capture; redact secrets)

<!-- Example shape only — replace with a real run’s POST line + sanitized JSON. -->

| Field | Value |
|--------|--------|
| **Captured** | YYYY-MM-DD |
| **Method** | `POST` |
| **URL** | e.g. `https://openrouter.ai/api/trpc/managementKeys.create?batch=1` *or* a non-tRPC app route |
| **Query** | e.g. `batch=1` |
| **Body (sanitized)** | e.g. `{ "0": { "json": { "name": "…" } } }` — redact tokens; note if the field is `label` instead of `name` |
| **Notes** | e.g. batched path `managementKeys.create,managementKeys.list` → Hydra normalizes to one procedure for cache |

---

## Key Insight: managementKeys.create

The `managementKeys.create` tRPC route means **management key creation CAN be automated** without clicking through the UI. Once we have:
1. A valid `__session` cookie
2. The exact tRPC request format for `managementKeys.create`

...we can create management keys programmatically for all accounts, eliminating the "manual step" entirely.

## Key Insight: Multiple Redeem Routes

There are FIVE different redeem-related routes (`credits.redeem`, `credits.redeemCode`, `credits.applyCode`, `account.redeem`, `code.redeem`, `voucher.redeem`, `promo.redeem`). Only one of these is likely the real one — the others may be aliases or different code types. The discovery session will determine which is active.
