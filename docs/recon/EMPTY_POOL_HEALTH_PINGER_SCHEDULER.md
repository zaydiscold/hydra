# Empty-Pool Health Pinger Scheduler

## What Changed

`server/services/health-pinger.js` no longer owns a five-minute background
timer while the OpenRouter rotation pool is empty.

`server/services/rotation-manager.js` now publishes pool-size changes whenever
reload, drop, or eviction replaces the in-memory pool. The health pinger
subscribes during startup and unsubscribes during shutdown.

The pinger now:

1. Stays disarmed while no pooled keys exist.
2. Arms its existing delayed probe when the first pooled key appears.
3. Keeps the existing interval cadence while pooled keys remain available.
4. Clears its timer when the final pooled key is dropped or evicted.
5. Removes its listener and timer during shutdown.

## How It Was Found

After the request-log retention idle guard was packaged and profiled, a source
sweep searched recurring server timers:

```bash
rg -n 'setInterval\\(|setTimeout\\(|scheduleNext|INTERVAL_MS|intervalMs|startupDelay' \
  server electron src scripts bin -g '!dist/**' -g '!release/**'
```

The sweep found that `health-pinger.js` scheduled a probe every five minutes
even when `rotationManager.pool.length === 0`. The production DB was checked
directly:

```bash
sqlite3 "$HOME/Library/Application Support/Hydra/hydra.db" \
  'SELECT COUNT(*), SUM(CASE WHEN isPooled = 1 AND disabled = 0 THEN 1 ELSE 0 END) FROM Key;'
```

It returned `13|0`: thirteen stored keys and zero active pooled keys.

## Why It Matters

The health pinger exists to validate pooled OpenRouter keys without spending
completion tokens. When no pooled keys exist, a timer wakeup cannot produce a
useful probe. Making ownership demand-driven removes idle wakeups without
weakening the live health path once a key becomes available.

## Raw Evidence

The deterministic lifecycle benchmark is stored under:

```text
/private/tmp/hydra-health-pinger-empty-pool-benchmark-20260601T053640Z/summary.json
```

It records:

```text
production stored keys: 13
production active pooled keys: 0
old empty-pool wakeups per hour: 12
new empty-pool wakeups per hour: 0
timer armed with empty pool: false
timer armed after first key: true
timer armed after final key removal: false
```

## Reproduce

Run:

```bash
npm run test:health-pinger
npm run test:rotation-manager
npm run test:background-failure-visibility
npm run test:test-chain-completeness
node bin/hydra.mjs audit --json
git diff --check
```

`server/tests/health-pinger-lifecycle.test.mjs` covers empty-pool startup,
first-key rearming, final-key disarming, and shutdown unsubscribe behavior.

## Release Boundary

This is source evidence until the current-source package is rebuilt and
profiled. It does not replace the public `v1.4.0` release assets or close the
manual GUI, Touch ID fingerprint, Intel, or Windows launch dogfood boundaries.
