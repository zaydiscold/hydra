# OpenRouter Key Endpoints And Provision Fallbacks

Date: 2026-06-02

## What Was Found

Hydra had three related OpenRouter key-path issues:

1. Standard API-key metadata probes still used the legacy
   `GET /api/v1/auth/key` path. The current documented path is
   `GET /api/v1/key`.
2. The Clerk-session management-key fallback probed
   `POST /api/v1/keys`. OpenRouter documents that route for creating a
   model-access API key when the caller already has a management key. It is not
   a management-key mint endpoint.
3. A live management-key provision proved that OpenRouter's previously
   captured Next.js Server Action ID had drifted. The retained isolated
   Chromium UI fallback still completed successfully, but Hydra spent time on
   equivalent stale-hash payloads and an absent tRPC surface first.

## How It Was Found

The endpoint boundary was compared against both the local Printing Press
OpenRouter package and current OpenRouter documentation:

```text
/Users/zaydk/Desktop/printing-press-research/printing-press-library/library/ai/openrouter/spec.json
https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
https://openrouter.ai/docs/guides/overview/auth/management-api-keys
```

The local Printing Press spec exposes:

```text
GET  /key
GET  /keys
POST /keys
```

Then the guarded Hydra CLI path was exercised against one local active-session,
no-key account:

```text
node bin/hydra.mjs session <redacted-account-prefix> --refresh --json
node bin/hydra.mjs keys provision <redacted-account-prefix> --dry-run --json
node bin/hydra.mjs keys provision <redacted-account-prefix> --yes --name hydra-148 --json
node bin/hydra.mjs keys --account <redacted-account-prefix> --json
```

Secrets were not printed. The final redacted result reported
`source=playwright`, `keyStored=true`, and a stored active row named
`hydra-148`.

## Why It Matters

Hydra needs separate, explicit layers:

1. Current official OpenRouter API paths for API-key metadata and management
   operations.
2. Clerk-session dashboard automation for creating a management key.
3. Compatibility fallbacks for dashboard drift.

Conflating `POST /api/v1/keys` with management-key minting can store the wrong
kind of credential. Repeating stale Server Action payloads or spraying tRPC
routes after OpenRouter has returned generic `404` HTML adds latency without
adding resilience.

## Implemented Boundary

- Standard API-key validation now calls `GET /api/v1/key` first and retries
  legacy `GET /api/v1/auth/key` only when the canonical path returns `404`.
- Management-key mint fallback no longer probes documented API-key creation
  route `POST /api/v1/keys`.
- A stale management-key Server Action `404` performs one bounded self-heal
  attempt, then skips equivalent payload retries.
- A generic tRPC-surface `404` skips equivalent candidate fan-out while
  preserving the next distinct fallback layers.
- The working isolated UI fallback captures the current `Next-Action` header,
  stores it in Hydra discovery state, and reuses it for later fast HTTPS
  replay.
- Requested labels such as `hydra-148` survive capture and local encrypted
  persistence unchanged.

## Raw Redacted Evidence

```text
Live Clerk probe: active
Provision preflight: ready via session_validate
Direct Server Action: 404 with stale captured ID
Self-heal scan: no bundle candidate
Retained isolated UI fallback: success
Stored row: name=hydra-148 status=active source=playwright
```

The full one-time management key, Clerk cookies, JWTs, and request secrets are
intentionally excluded.

## Reproduction

1. Choose an account with a live Clerk session and no stored management key.
2. Run the guarded dry-run command and confirm `ready=true`.
3. Run the guarded `--yes --name <label>` command once.
4. Inspect `hydra keys --account <prefix> --json`.
5. Confirm the stored metadata has the requested label and a redacted source.
6. If direct replay drifts again, enable `HYDRA_PROVISION_NETWORK_LOG=1` and
   confirm that UI fallback records the current `next-action` value without
   logging response bodies or credential values.
