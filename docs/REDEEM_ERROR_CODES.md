# Redeem Error Codes

Stable Hydra error codes returned by `/api/codes/redeem` and bulk-matrix operations.
These map OpenRouter's raw text responses into consistent, actionable classifications.

## Code Structure

| Constant | Error Code | Meaning | Example OpenRouter Message |
|----------|-----------|---------|---------------------------|
| `PROMO_INVALID` | `REDEEM_PROMO_INVALID` | Code doesn't exist, expired, or already used | "This code is invalid", "code not found", "already used" |
| `MAX_USES` | `REDEEM_MAX_USES` | Code valid but reached max redemptions | "code has reached maximum redemptions" |
| `SESSION` | `REDEEM_SESSION` | Account session expired or auth issue | "session expired", "unauthorized", "2FA required" |
| `RATE_LIMIT` | `REDEEM_RATE_LIMIT` | Too many requests (OpenRouter 429) | "too many requests", HTTP 429 |
| `FORM_UNAVAILABLE` | `REDEEM_FORM_UNAVAILABLE` | OpenRouter page structure changed | "Could not find redeem form" |
| `OUTCOME_UNKNOWN` | `REDEEM_OUTCOME_UNKNOWN` | Code may have applied but couldn't confirm | "outcome unclear" |
| `UPSTREAM` | `REDEEM_UPSTREAM` | Unclassified / network / parsing error | Everything else |

## Endpoint Reconnaissance

The following endpoints were probed to map OpenRouter's redeem surface. No dedicated REST API
endpoint exists for code redemption — the flow is entirely web-based behind Clerk authentication.

| Endpoint | Method | Status | Content-Type | Notes |
|----------|--------|--------|-------------|-------|
| `/redeem` | `POST` | **Works** (auth required) | `text/plain` (RSC) | **Server Action** — primary redeem path. Requires `Next-Action` header + `__session` cookie. Body: `["CODE"]` (JSON array). |
| `/redeem` | `GET` | 307 → `/sign-in` | `text/plain` | Next.js page route. Redirects unauthenticated users to Clerk sign-in with `redirect_url` param. `x-clerk-auth-status: signed-out`. |
| `/api/redeem` | `GET` | 200 | `text/html` | **NOT an API endpoint.** Routed as `/[maker-id]/[slug]` (maker page). Returns HTML, not JSON. `x-matched-path: /[maker-id]/[slug]`. |
| `/api/trpc/*?batch=1` | `POST` | **Works** (auth required) | `application/json` | tRPC batch endpoint. 22 candidate route names tried. Body: `{"0":{"code":"..."}}`. Requires `__session` cookie. |
| `/api/v1/redeem` | `GET` | 404 | `text/html` | No API route. `x-matched-path: /_not-found`. |
| `/api/v1/credits/redeem` | `POST` | 404 | `application/json` | No API route. Hits the API router but returns JSON 404. |
| `/api/v1/credits/apply` | `POST` | 404 | `application/json` | No API route. Same as above. |
| `/api/codes/redeem` | `GET` | 404 | `text/html` | No API route. `x-matched-path: /_not-found`. |

### OpenAPI Spec Analysis

From `https://openrouter.ai/openapi.json` (40 total paths):
- **Credits-related paths:** `/credits` (GET), `/credits/coinbase` (POST, deprecated)
- **Redeem/code paths:** **None.** Zero redeem, code, coupon, gift, or promo endpoints exist in the official OpenAPI specification.
- **Conclusion:** Code redemption is not a public API. It's a Next.js Server Action behind Clerk auth.

## Server Action Flow (Primary Redeem Path)

The fastest, pure-HTTP redemption path uses OpenRouter's Next.js Server Actions:

```
POST https://openrouter.ai/redeem
Headers:
  Content-Type: text/plain;charset=UTF-8
  Next-Action: 402002bec2b81db80981bde049958688557404e07a
  Cookie: __session=<clerk-jwt>; __client_uat=<timestamp>
Body:
  ["ROUTE75-9BGQCV"]
```

### How It Works

1. **Server Action ID** (`Next-Action` header) is a content-addressed hash that identifies the React Server Action handler. This hash is self-healing — when the action is redeployed, the hash changes and OpenRouter returns a 404. Hydra discovers the new hash on 404 by fetching the redeem page and extracting the latest `Next-Action` value from the RSC payload.

2. **Body format:** JSON array of one string — `["CODE"]`. This is the RSC serialization format for a Server Action call with a single argument.

3. **Response format:** RSC wire format — newline-separated JSON lines terminated by an end marker. Success/error messages are embedded in the RSC payload and must be parsed out.

4. **Auth:** Requires a valid Clerk `__session` JWT cookie. Without it, the request returns a 307 redirect to sign-in.

### vs. tRPC

| Aspect | Server Action | tRPC |
|--------|--------------|------|
| Method | `POST /redeem` | `POST /api/trpc/{route}?batch=1` |
| Header | `Next-Action: <hash>` | Standard fetch |
| Body | `["CODE"]` (JSON array) | `{"0":{"code":"CODE"}}` (batch JSON) |
| Response | RSC wire format (newline-JSON) | Standard tRPC/JSON-RPC |
| Speed | Fastest | Fast |
| Reliability | Hash can drift on deploy | Route names more stable |
| Discovery | Parse from page HTML | Try 22 candidates |

## Redeem Flow Priority

```
1. Server Action (POST /redeem, Next-Action header) — fastest, pure HTTP
2. Cached tRPC route — discovered from previous successful redeem
3. 22 tRPC candidate routes — tried in sequence
4. REST API probes — /api/*/redeem endpoints
5. Playwright browser — ultimate fallback (headless Chrome)
```

## Code Format (OpenRouter)

```
ROUTE75-9BGQCV
└─┬──┘ └──┬──┘
  │       └─ 6-char alphanumeric (0-9, A-Z)
  └─ campaign prefix (ROUTE75 confirmed, ROUTE100 suspected)
```

**Space:** 36^6 = 2,176,782,336 per campaign

### Algorithm Analysis

- **No checksum detected:** Luhn (mod-10, mod-36), Verhoeff, Damm, ISBN-10, CRC-8, CRC-16, Fletcher-16, Adler-32, XOR, weighted sums, and positional checksums all **fail** against `9BGQCV`.
- **HMAC analysis:** SHA-256 of `(seed + counter)` for 33 seed/counter combos — zero matches. Brute-force to 100,000 counters also negative.
- **Likely generation:** Random or HMAC-based (cryptographic, not reversible). No structural pattern observable from a single known code.
- **Search space optimization:** If codes are consonants-only, space shrinks from 2.18B to ~40.8M (98% reduction). However, `9BGQCV` contains digits, so this constraint is not confirmed.

## Response Shape

### Success
```json
{
  "success": true,
  "source": "server-action",
  "creditsAdded": 5.00,
  "message": "Code applied successfully"
}
```

### Error
```json
{
  "success": false,
  "error": "code has reached maximum redemptions",
  "errorCode": "REDEEM_MAX_USES",
  "source": "server-action"
}
```

## Detection Regex Patterns

### `REDEEM_MAX_USES`
```
/\b(maximum|max)\s+(redemptions|uses|claims|times)\b/
/\b(reached|hit|at)\s+(its\s+)?(max|limit|cap)\b/
```

### `REDEEM_PROMO_INVALID`
```
/invalid|not found|already used|expired|doesn't exist/i
```

### `REDEEM_SESSION`
```
/session expired|unauthorized|2fa required|cloudflare challenge/i
HTTP 401, 403
```

### `REDEEM_RATE_LIMIT`
```
/rate limit|too many requests/i
HTTP 429
```

## Adding New Error Patterns

When new OpenRouter error messages are discovered, update both:
1. `server/services/dashboard-api.js` — `classifyRedeemFailure()` function
2. `scripts/test-redeem-surface.mjs` — `classifyError()` function (keep in sync)

Add the detection BEFORE the `messageLooksLikeInvalidPromo()` check,
since max-uses and form-unavailable are distinct states.

## Anti-Bot Observations

- **Cloudflare:** All endpoints served through Cloudflare (`cf-ray` header on all responses). No CAPTCHA on sign-in (password flow), only on sign-up.
- **Clerk:** CDN-based bot detection triggers on **sign-ups only**, not sign-ins. Password auth is safe.
- **Rate limiting:** No `X-RateLimit-*` headers observed. Rate limiting is handled at Cloudflare level. Short bursts tolerated; sustained triggering gets 429.
- **Browser headers:** `sec-ch-ua`, `sec-fetch-*`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` sent by real browsers. Mobile user-agent recommended as extra precaution.
- **CSP:** Extensive Content-Security-Policy including Clerk, Stripe, Cloudflare, PostHog, Datadog, Algolia. `script-src` includes `unsafe-eval` and `unsafe-inline`.
