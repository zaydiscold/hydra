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
4. The stale-hash self-heal attempted candidate Server Action hashes with
   live POST requests. Management-key creation is not idempotent, so a
   candidate probe can itself mint an orphan key.
5. The Clerk-session bootstrap lane retained speculative tRPC and legacy REST
   POST fan-out after the observed Server Action failed. Those requests added
   latency and could write upstream state without improving the known-good
   path.

## How It Was Found

The endpoint boundary was compared against both the local Printing Press
OpenRouter package and current OpenRouter documentation:

```text
/Users/zaydk/Desktop/printing-press-research/printing-press-library/library/ai/openrouter/spec.json
https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
https://openrouter.ai/docs/guides/overview/auth/management-api-keys
https://openrouter.ai/docs/api/api-reference/api-keys/create-keys
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

A follow-up source and local-state review on 2026-06-02 used redacted discovery
metadata only:

```text
hasLearnedManagementKeyAction=false
hasCachedTrpcCreateRoute=false
active session rows with no stored management key=0
```

The local database therefore had no safe no-key fixture for another live
bootstrap replay. No extra upstream key was minted just to manufacture a test.

## Why It Matters

Hydra needs separate, explicit layers:

1. Current official OpenRouter API paths for API-key metadata and management
   operations.
2. Clerk-session dashboard automation for creating a management key.
3. Compatibility fallbacks for dashboard drift.

Conflating `POST /api/v1/keys` with management-key minting can store the wrong
kind of credential. Repeating stale Server Action payloads, probing candidate
write actions, or spraying undocumented POST routes adds latency and can mint
orphan credentials.

## Implemented Boundary

- Standard API-key validation now calls `GET /api/v1/key` first and retries
  legacy `GET /api/v1/auth/key` only when the canonical path returns `404`.
- Management-key bootstrap now performs exactly one confirmed direct HTTPS
  Server Action write with body `[{"name":"<label>"}]`.
- A successful Server Action response without an extractable one-time key
  fails closed. Hydra does not retry a write that may already have succeeded.
- A stale management-key Server Action `404` skips speculative hash probes,
  tRPC POST fan-out, and legacy REST POST fan-out. Hydra moves directly to one
  isolated UI learner fallback.
- The working isolated UI fallback captures the current `Next-Action` header,
  now at browser-context scope, stores it in Hydra discovery state, and reuses
  it for later fast HTTPS replay.
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
Follow-up local learned action row: absent
Follow-up safe no-key live fixture: absent
Focused source contract: 34/34 pass
Packaged runtime after edit: 4 Hydra-owned processes, 0 stale Playwright profiles
```

The full one-time management key, Clerk cookies, JWTs, and request secrets are
intentionally excluded.

## Current-Source Package Verification

Checkpoint `c5284c9` was rebuilt into the canonical local ARM package after a
native `4 -> 0` quit. Resource smoke, strict deep codesign, bundle version
`1.4.8`, and embedded-source inspection passed. The local archive SHA-256
before reversible cleanup was:

```text
d3edcafa129b25bc1ae42e8978de76a58c44e696cb78e355fa22973f35f9a87c
```

LaunchServices evidence is under:

```text
/private/tmp/hydra-v148-http-bootstrap-current-source-launch-20260602T021059Z
/private/tmp/hydra-v148-http-bootstrap-post-rebuild-idle-profile-20260602T021306Z
```

The bounded splash settled from `247.0%` aggregate Hydra CPU at `+5s` to
`2.5%` at `+20s` and `0.0%` at `+35s`. The following untouched five-minute
profile retained exactly four Hydra-owned processes and zero stale Playwright
profiles across all `11` samples. CPU ranged `0.0-0.2%`, averaged `0.027%`,
and ended at `0.0%`; RSS moved `508329984 -> 487489536` bytes.

This proves the thinner bootstrap source is packaged and idle-clean. It does
not claim a new live direct replay: the local database still has no active
no-key account, and Hydra intentionally did not mint a redundant upstream key
to fabricate one. The final documented-tree chain passed lint, full
`npm test`, gate `12/12`, OpenAPI generation (`84` operations), diff hygiene,
audit, and Docker smoke with a rebuilt production image plus a real
containerized Playwright Chromium launch. Cleanup left no Hydra compose
service or `hydra_default` network and stopped Docker Desktop. Public
checkpoint CI run `26794501452` and Docker workflow run `26794501428`
passed; Auto-version run `26794501427` correctly skipped.

## Reproduction

1. Choose an account with a live Clerk session and no stored management key.
2. Run the guarded dry-run command and confirm `ready=true`.
3. Run the guarded `--yes --name <label>` command once.
4. Inspect `hydra keys --account <prefix> --json`.
5. Confirm the stored metadata has the requested label and a redacted source.
6. If direct replay drifts again, enable `HYDRA_PROVISION_NETWORK_LOG=1` and
   confirm that the single UI learner fallback records the current
   `next-action` value without logging response bodies or credential values.
7. On the next no-key account, run a second guarded provision and confirm
   `source=server-action`. That proves the learned action replay without
   launching Chromium.
