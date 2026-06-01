# Session Refresh Dead Cookie Pruning

## What Was Found

The six-hour auto-refresher already tried stacked Clerk device cookies
newest-first and removed failed identities from its in-memory working stack.
When an older identity succeeded, it persisted the trimmed stack. When every
identity failed, it logged `SESSION_REFRESH_FAILED` but left the exhausted
stack stored on disk.

That meant each later six-hour sweep retried the same known-dead identities.
The worst stored stack is bounded at `25`, but bounded repeated waste is still
waste and leaves stale refresh material visible to later code paths.

## How It Was Found

The source sweep used:

```bash
rg -n 'setInterval\(|setTimeout\(|scheduleNext|INTERVAL_MS|startupDelay' \
  server electron src scripts bin -g '!dist/**' -g '!release/**'
sed -n '1,430p' server/services/session-refresher.js
rg -n 'updateAccountSession\(|replaceClientCookies|deadClientCookies' \
  server tests docs
```

Tracing `server/services/session-refresher.js` showed that the successful
refresh branch persisted `replaceClientCookies: liveStack`, while the
all-dead branch only logged and continued.

## What Changed

`server/services/store.js` now exports `removeDeadClientCookies()`. It compares
Clerk device identities instead of raw snapshots so transient dashboard and
Cloudflare cookie churn cannot preserve a dead identity under a slightly
different serialized value.

The store live-probe path and both automation refresh paths use the shared
helper after fallback success.

The auto-refresher all-dead path persists `replaceClientCookies: []` with:

```text
preserveSessionToken: true
markSessionRefreshed: false
```

The first flag avoids destroying a stored proof token during metadata cleanup.
The second keeps `sessionRefreshedAt` semantically honest: pruning failed
refresh material is not a successful silent renewal.

## Why It Matters

The change removes repeated Clerk requests for identities already proven dead,
shrinks stale local auth state, and prevents failed maintenance from appearing
as a successful renewal in the session UI.

## Raw Evidence

`server/tests/session-refresher-pruning.test.mjs` creates an isolated account
with `25` dead Clerk device identities. Its first sweep:

```text
refresh attempts: 25
stored replacement stack: 0
markSessionRefreshed: false
SESSION_REFRESH_FAILED events: 1
```

Its second sweep records:

```text
additional refresh attempts: 0
additional metadata writes: 0
```

The test uses synthetic cookie names and prints no production secrets.

## Reproduce

Run:

```bash
npm run test:session-refresher-pruning
npm run test:session-refresh-contract
npm run test:background-failure-visibility
npm run test:openrouter-request-cancellation
npm run test:test-chain-completeness
npm run test:cli
npm run lint
node bin/hydra.mjs audit --json
git diff --check
```

## Release Boundary

This is a `[skip-bump]` source checkpoint after public `v1.4.2`. The
current-source ARM package passed rebuild, smoke, strict deep `codesign`,
embedded-source inspection, LaunchServices launch, and an untouched
five-minute profile. Across 11 samples the package retained four Hydra-owned
processes, zero Hydra Playwright profiles, `0.055%` average CPU, `0.000%` end
CPU, and `+5144576` bytes RSS drift. Manual GUI, Touch ID fingerprint, Intel,
and real Windows desktop dogfood boundaries remain explicit.
