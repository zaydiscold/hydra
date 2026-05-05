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

## Adding New Error Patterns

When new OpenRouter error messages are discovered, update both:
1. `server/services/dashboard-api.js` — `classifyRedeemFailure()` function
2. `scripts/test-redeem-surface.mjs` — `classifyError()` function (keep in sync)

Add the detection BEFORE the `messageLooksLikeInvalidPromo()` check,
since max-uses and form-unavailable are distinct states.
