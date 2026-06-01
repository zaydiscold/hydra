# Request Log Retention Demand Scheduler

## What Changed

`server/services/request-log-retention.js` no longer owns a recurring
15-minute timer after its startup prune confirms that `RequestLog` is empty.

The retention worker now:

1. Runs one quiet startup prune.
2. Disarms when the table is empty.
3. Rearms when buffered non-stream proxy logging accepts a row.
4. Rearms when SSE placeholder logging attempts a direct row create.
5. Keeps the existing 15-minute cadence while retained rows exist.
6. Retries after prune errors and clears timers during shutdown.

The existing 30-day and `KEEP_COUNT` cleanup rules are unchanged.

## How It Was Found

After the empty-table SQLite write guard shipped in `v1.4.2`, a second source
sweep reviewed the remaining recurring scheduler ownership:

```bash
rg -n 'setInterval\\(|setTimeout\\(|scheduleNext|INTERVAL_MS|intervalMs|startupDelay' \
  server electron src scripts bin -g '!dist/**' -g '!release/**'
sqlite3 "$HOME/Library/Application Support/Hydra/hydra.db" \
  'SELECT COUNT(*) FROM RequestLog;'
```

The production database returned `0`, but the retention worker still scheduled
one oldest-row read every 15 minutes after learning that no rows existed.

## Why It Matters

The previous guard removed idle SQLite writes. This follow-up removes the
remaining empty-table timer wakeups without weakening cleanup once real proxy
traffic exists. Retention ownership now follows the data that requires it.

## Raw Evidence

The deterministic lifecycle evidence is stored under:

```text
/private/tmp/hydra-request-log-retention-demand-scheduler-20260601T.KJsakO/summary.json
```

It records:

```text
production RequestLog rows: 0
legacy empty-table recurring wakeups per hour: 4
current empty-table recurring wakeups per hour: 0
empty startup prune disarms: true
new proxy activity rearms: true
shutdown clears traffic-driven timer: true
focused tests: 8 passed, 0 failed
```

## Reproduce

Run:

```bash
npm run test:request-log-retention
npm run test:request-log-buffer
npm run test:background-failure-visibility
npm run test:ci
npm run lint
npm run gate
npm run build
node bin/hydra.mjs audit --json
git diff --check
```

`server/tests/request-log-retention-lifecycle.test.mjs` covers empty startup
disarming, proxy-activity rearming, and shutdown clearing.

## Release Boundary

This is a `[skip-bump]` source checkpoint after public `v1.4.2`. The rebuilt
local arm64 package is current-source dogfood evidence, not a replacement
public artifact. Manual GUI, Touch ID fingerprint, Intel, and real Windows
desktop dogfood boundaries remain explicit.
