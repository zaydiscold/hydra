# Traffic Routing And Pricing Recon

Date: 2026-06-02
Candidate: `1.5.0`

## What Was Found

Hydra was rotating credentials on key-level OpenRouter `429` responses, but the
old router stopped after three attempts and the Traffic Console rendered raw
rows without explaining the route decision. A user-visible sequence of three
same-second `429` rows was rotation evidence, but it looked like an inert
router because no attempt number or outcome was visible.

A separate `404` row is a different class of failure. OpenRouter returned a
client-visible model or endpoint rejection. Rotating credentials cannot repair
that request, so Hydra should report the upstream response without penalizing
the selected key.

OpenRouter's current model catalog exposes prompt, completion, and request
prices. Current response usage accounting can also expose an exact total
`usage.cost`. Hydra previously discarded both price surfaces.

## How It Was Investigated

1. Read `server/routes/proxy.js`, `server/services/rotation-manager.js`,
   `server/services/model-cache.js`, `server/services/request-log-buffer.js`,
   `server/controllers/PoolController.js`, and `src/pages/Traffic.jsx`.
2. Compared the user-provided redacted Traffic Console rows:

   ```text
   200 aion-labs/aion-1.0-mini
   404 google/gemini-2.0-flash-lite-001
   429 meta-llama/llama-3.2-3b-instruct:free account A
   429 meta-llama/llama-3.2-3b-instruct:free account B
   429 meta-llama/llama-3.2-3b-instruct:free account C
   ```

3. Confirmed the old hard-coded retry ceiling in source: `MAX_RETRIES = 3`.
4. Read the official OpenRouter API references:
   - https://openrouter.ai/docs/api/reference/models/list-models
   - https://openrouter.ai/docs/api/reference/overview
   - https://openrouter.ai/docs/use-cases/usage-accounting
5. Added dynamic telemetry tests and static proxy contracts, then ran the
   focused regression lane.

## Why It Matters

Operators need to distinguish three situations quickly:

- **Credential cooldown**: Hydra should rotate and tell you which attempt ran.
- **Pool exhaustion**: Hydra should state that its bounded failover budget or
  eligible set was exhausted instead of pretending the pool is empty.
- **Model or endpoint rejection**: Hydra should preserve the `404` truth
  because another credential will not fix the request.

Price provenance also matters. Exact upstream totals and catalog estimates
must not be presented as the same kind of fact.

## Implementation

- `HYDRA_PROXY_MAX_KEY_ATTEMPTS` now defaults to `8` and clamps at `32`.
- Each request log stores `attempt`, `outcome`, `totalCost`, and `costSource`.
- Cached OpenRouter models retain `promptPrice`, `completionPrice`, and
  `requestPrice`.
- Exact `usage.cost` is stored as `openrouter_usage` when upstream returns it.
- Traffic Console calculates visible input/output splits from cached catalog
  rates and marks fallback estimates with `~`.
- Response headers expose `X-Hydra-Attempts` and `X-Hydra-Rotated`.
- Deprecated `stream_options.include_usage` injection was removed because
  current OpenRouter usage accounting is automatic.

## Reproduce

Run the source contracts:

```bash
npm run test:proxy-telemetry
npm run test:request-log-buffer
npm run test:background-failure-visibility
npm run test:ui-static
```

For a live operator check, point an OpenAI-compatible client at Hydra, issue a
request, then open **Traffic Console**. A successful request should show
`served`, its attempt number, tokens when returned, and either exact upstream
cost or a marked catalog estimate. A rate-limited credential should show
`key_rate_limited`; a client-visible `404` should show `upstream_response`.

Do not paste real Hydra keys, OpenRouter keys, account emails, Clerk cookies,
or live request bodies into docs.
