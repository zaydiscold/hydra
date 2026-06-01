# Magic-Link Cleanup Timer Ownership

Date: 2026-06-01

## What Was Found

Hydra already scheduled magic-link cleanup only when pending links existed, but
an early completion path left the existing expiry timeout armed until the
original 15-minute deadline. `forgetPendingMagicLink()` removed both indexes
without recalculating the cleanup timer.

## Why It Matters

The residual timeout was bounded and unref'd, but it was still unnecessary
background work after the final pending link completed. Magic-link cleanup
should be demand-driven: zero pending links means zero cleanup wakeups.

## How It Was Checked

Source trace:

```bash
rg -n "forgetPendingMagicLink|claimPendingMagicLinkCallback|sweepExpiredMagicLinks|trackPendingMagicLink" server src scripts
```

Deterministic benchmark:

```bash
node --input-type=module <<'NODE'
const manager = await import('./server/services/magic-link-manager.js');
manager.stopMagicLinkCleanup();
manager.pendingMagicLinks.clear();
manager.pendingMagicLinkCallbacks.clear();
manager.startMagicLinkCleanup();
console.log(manager.getMagicLinkCleanupSnapshot());
manager.trackPendingMagicLink('signin-benchmark', { linkId: 'callback-benchmark' });
console.log(manager.getMagicLinkCleanupSnapshot());
manager.forgetPendingMagicLink('signin-benchmark');
console.log(manager.getMagicLinkCleanupSnapshot());
manager.stopMagicLinkCleanup();
NODE
```

Raw evidence:

```text
/private/tmp/hydra-magic-link-cleanup-early-disarm-20260601T235215Z/summary.json
```

Observed snapshots:

```json
{
  "idleBefore": { "started": true, "scheduled": false, "pending": 0, "callbacks": 0 },
  "armed": { "started": true, "scheduled": true, "pending": 1, "callbacks": 1 },
  "idleAfter": { "started": true, "scheduled": false, "pending": 0, "callbacks": 0 },
  "avoidedResidualWakeupsAfterEarlyCompletion": 1
}
```

## Fix

`forgetPendingMagicLink()` now reschedules cleanup after external removals.
Expiry sweeps remove rows with `reschedule: false` and perform one final
reschedule after the batch, avoiding repeated timer churn. The manager exposes
`getMagicLinkCleanupSnapshot()` for read-only lifecycle evidence.

## Verification

```bash
npm run test:api-integration
npm run test:background-failure-visibility
npm run lint
node bin/hydra.mjs audit --json
git diff --check
```

The real Express API suite includes a dynamic regression proving early
completion disarms the last pending cleanup timer.
