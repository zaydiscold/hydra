# Request Log Retention Idle Guard

## What Changed

`server/services/request-log-retention.js` still runs its bounded retention
cycle every 15 minutes, but idle cycles no longer issue SQLite write
statements against an empty `RequestLog` table.

The cycle now:

1. Reads the oldest row.
2. Returns immediately when the table is empty.
3. Runs age pruning only when the oldest row is older than the cutoff.
4. Reads the first row beyond the keep-count boundary.
5. Returns when the table is under the cap.
6. Runs the existing overflow delete only when an overflow row exists.

## How It Was Found

The packaged app was left idle after the demand-driven `TaskSupervisor`
scheduler repair. A source sweep found that request-log retention still ran
two SQLite delete statements every 15 minutes regardless of table contents.

Both relevant local databases were checked directly:

```bash
sqlite3 "$HOME/Library/Application Support/Hydra/hydra.db" \
  'SELECT COUNT(*) FROM RequestLog;'
sqlite3 data/hydra.db 'SELECT COUNT(*) FROM RequestLog;'
```

Both returned `0`.

## Why It Matters

An empty request-log table is a common idle state. Issuing write statements in
that state needlessly enters SQLite's write path, creates background work, and
obscures the difference between real retention activity and idle bookkeeping.
The guard preserves the cleanup contract while removing those idle writes.

## Raw Evidence

The deterministic SQLite benchmark is stored under:

```text
/private/tmp/hydra-request-log-retention-empty-table-benchmark-20260601T051408Z/summary.json
```

It records:

```text
production RequestLog rows: 0
old empty cycle: 2 write statements
guarded empty cycle: 1 indexed oldest-row read, 0 writes
20,000-cycle benchmark: 159.386ms -> 28.574ms
elapsed reduction: 82.1%
```

## Reproduce

Run the focused behavioral and static-contract suites:

```bash
npm run test:request-log-retention
npm run test:background-failure-visibility
npm run test:test-chain-completeness
node bin/hydra.mjs audit --json
git diff --check
```

`server/tests/request-log-retention.test.mjs` covers empty tables, fresh
under-cap tables, stale-row age pruning, and overflow cap pruning.

## Release Boundary

This is source and current-source package evidence. It does not replace the
public `v1.4.0` release assets or close the manual GUI, Touch ID fingerprint,
Intel, or Windows launch dogfood boundaries.
