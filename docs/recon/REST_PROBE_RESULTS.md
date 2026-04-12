# REST Probe Results — EXPLOIT #12

## Summary

REST fallback probes added for both **key creation** and **credit redemption** using session JWT as Bearer token. These probes fire when the primary methods (Server Actions, tRPC) fail, before falling back to Playwright browser automation.

## Implementation

### Files Modified

- `server/services/dashboard-api.js`

### New Functions

#### `tryRestApiRedeemCode(sessionCookie, clientCookie, code)`

Probes 17 REST endpoints with session JWT Bearer auth, attempting code redemption via pure HTTP (no browser).

**Endpoints probed:**

| # | URL | Body |
|---|-----|------|
| 1 | `POST /api/v1/credits/redeem` | `{ code }` |
| 2 | `POST /api/v1/credits/redeem` | `{ promoCode: code }` |
| 3 | `POST /api/v1/credits/redeem` | `{ code, type: 'promo' }` |
| 4 | `POST /api/v1/credits/apply` | `{ code }` |
| 5 | `POST /api/v1/credits/promo` | `{ code }` |
| 6 | `POST /api/v1/voucher/redeem` | `{ code }` |
| 7 | `POST /api/v1/coupon/redeem` | `{ code }` |
| 8 | `POST /api/v1/promo/redeem` | `{ code }` |
| 9 | `POST /api/v1/promo/apply` | `{ code }` |
| 10 | `POST /api/v1/code/redeem` | `{ code }` |
| 11 | `POST /api/v1/code/apply` | `{ code }` |
| 12 | `POST /api/v1/account/redeem` | `{ code }` |
| 13 | `POST /api/v1/account/credits/redeem` | `{ code }` |
| 14 | `POST /api/v1/user/redeem` | `{ code }` |
| 15 | `POST /api/v1/user/credits/redeem` | `{ code }` |
| 16 | `POST /api/credits/redeem` | `{ code }` |
| 17 | `POST /api/redeem` | `{ code }` |

**Auth pattern:** `Authorization: Bearer <session JWT>` + `Cookie: <client cookies>` + `Origin: https://openrouter.ai` + `Referer: https://openrouter.ai/redeem`

**Success detection:** Response is 2xx with JSON containing `success: true`, `redeemed: true`, `applied: true`, `credits`, `balance`, or a success-related message string.

**Returns:** `{ success, result?, error?, source: 'rest-api', probedEndpoints: [...], probedUrl? }`

#### Expanded `tryRestApiCreateKey` endpoints

The existing key creation probe now also tries these additional REST endpoints after the original 4:

| # | URL | Body |
|---|-----|------|
| 5 | `POST /api/v1/keys` | `{ name: keyName }` |
| 6 | `POST /api/v1/keys` | `{ name: keyName, type: 'management' }` |
| 7 | `POST /api/v1/keys/create` | `{ name: keyName }` |
| 8 | `POST /api/v1/account/keys` | `{ name: keyName, type: 'management' }` |
| 9 | `POST /api/v1/user/keys` | `{ name: keyName }` |
| 10 | `POST /api/v1/settings/keys` | `{ name: keyName }` |

## Integration Points

### `redeemCode()` flow (updated order)

1. Server Action (pure HTTP, Next-Action header)
2. Cached tRPC route (from Discovery table)
3. tRPC candidate routes (19 variants)
4. **REST API probe** ← NEW (EXPLOIT #12)
5. Playwright browser automation (last resort)

### `createManagementKey()` flow (unchanged order)

1. Server Action replay
2. Cached tRPC route
3. tRPC candidate routes
4. REST API probe (existing + expanded endpoints)
5. Playwright browser automation

## Logging

All probe attempts and results are logged to stderr:

- `[tryRestApiRedeemCode] Trying POST <url> body=...` — attempt
- `[tryRestApiRedeemCode] <url> → HTTP <status> <statusText> body=...` — result with body preview
- `[tryRestApiRedeemCode] <url> error: <message>` — network error
- `[dashboard-api] REST redeem probe summary (N endpoints):` — summary table
- `[tryRestApiCreateKey] <url> → HTTP <status> <statusText>` — key creation probe result

Even 404s are logged — they tell us which endpoints don't exist, narrowing the search space.

## Reconnaissance Value

Every HTTP status code is intelligence:

| Status | Meaning |
|--------|---------|
| 200/201 | Endpoint exists and responded — parse for key/credit data |
| 401 | Endpoint exists but JWT auth rejected — session may be invalid |
| 403 | Endpoint exists but authorization denied — wrong role/permissions |
| 404 | Endpoint does not exist — eliminate from future probes |
| 405 | Endpoint exists but method not allowed — try different HTTP method |
| 422/400 | Endpoint exists but body format wrong — adjust payload |
| 500 | Server error — endpoint exists, may be unstable |

## Why It Matters

- **Redemption now has 5 fallback layers** (SA → cached tRPC → tRPC candidates → REST → Playwright), up from 4. The REST probe costs nothing (pure HTTP) and could unlock a path that bypasses tRPC/SA entirely.
- **Every HTTP status code is intelligence.** A 405 on `/api/v1/credits/redeem` means the endpoint exists but method is wrong — try PUT or GET. A 422 means the endpoint exists but the body format is wrong. Over time, these probes map OR's actual API surface.
- **Key creation REST probe expanded from 4 to 10 endpoints.** The original 4 probes were too narrow — OR may use `/api/v1/keys`, `/api/v1/account/keys`, or `/api/v1/settings/keys` for key management depending on the key type.
- **Zero additional latency for the happy path.** REST probes only fire when SA and tRPC both fail. In the common case (SA works), these probes are never executed.

## Evidence

Probe results are logged to stderr with full HTTP status + body preview:
- `[tryRestApiRedeemCode] POST <url> → HTTP 404 Not Found body=<!doctype html>...` — endpoint doesn't exist
- `[tryRestApiCreateKey] POST <url> → HTTP 405 Method Not Allowed` — endpoint exists, wrong method
- All 17 redemption + 10 key creation endpoints have been probed in development

## Reproducibility

```bash
# Test a single REST redemption probe manually
curl -s -w "\nHTTP %{http_code}" \
  -X POST https://openrouter.ai/api/v1/credits/redeem \
  -H "Authorization: Bearer <session-jwt>" \
  -H "Cookie: __client=<device-cookie>" \
  -H "Origin: https://openrouter.ai" \
  -H "Referer: https://openrouter.ai/redeem" \
  -H "Content-Type: application/json" \
  -d '{"code":"SKU-xxx"}'

# Test a single REST key creation probe manually
curl -s -w "\nHTTP %{http_code}" \
  -X POST https://openrouter.ai/api/v1/keys \
  -H "Authorization: Bearer <session-jwt>" \
  -H "Cookie: __client=<device-cookie>" \
  -H "Origin: https://openrouter.ai" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-key"}'
```

## Cross-References

- Global exploit note #63 — original proposal for REST redemption probes
- `docs/recon/TRPC_ROUTES.md` — tRPC candidate routes (alternative fallback layer)
- `docs/SERVER_ACTION_CAPTURE_REPLAY.md` — primary Server Action path (first fallback layer)

## Notes

- Probes use `getFreshJwt()` to obtain a fresh JWT before each probe session, since OTP sessions have 60s JWTs.
- The `Referer: /redeem` header is included on redemption probes to mimic the browser context.
- Body preview is capped at 500 chars to avoid log flooding.
- The `probedEndpoints` array in the return value enables post-hoc analysis of every attempt.
