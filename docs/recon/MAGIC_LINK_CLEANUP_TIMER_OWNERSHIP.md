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

## Packaged Runtime Evidence

The rebuilt macOS ARM package passed:

```bash
HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app
shasum -a 256 server/services/magic-link-manager.js \
  release/mac-arm64/Hydra.app/Contents/Resources/app/server/services/magic-link-manager.js
```

The source and embedded manager hashes matched:

```text
8c68abd03aa8051ec1d2804d47e5c07d8506052666180bd26d10cac9185064ab
```

The generated zip SHA-256 before reversible metadata cleanup was:

```text
5b68bab15511dedbf81ef016c766907144bc17b924d21b32299ca8535b969875
```

LaunchServices evidence:

```text
/private/tmp/hydra-v147-magic-link-early-disarm-launch-20260601T235711Z
near-launch  4 processes  97.9% CPU   430489600 bytes RSS  0 stale profiles
plus-15s     4 processes  173.8% CPU  754450432 bytes RSS  0 stale profiles
plus-30s     4 processes  4.1% CPU    648937472 bytes RSS  0 stale profiles
```

The splash log reported a finite teardown: `target=72`, `queueLength=72`,
`shatteredWordCount=72`, `duplicateShatterSkips=0`, `timers=0`, inactive RAF,
cleared Matter state, disabled portal collision response, and applied portal
lift.

Untouched five-minute idle profile:

```text
/private/tmp/hydra-v147-magic-link-early-disarm-idle-profile-20260601T235802Z
samples=11 owned=4 profiles=0 cpu_min=0.000 cpu_max=0.200 cpu_avg=0.027 cpu_end=0.000 rss_start=648937472 rss_end=533970944 rss_delta=-114966528
```

The final literal chain passed lint, full `npm test`, gate (`12/12`), OpenAPI
regeneration (`84` operations, no tracked drift), diff hygiene, audit, and
local Docker smoke with a real containerized Playwright Chromium launch.
Teardown left no `hydra_default` network and `docker desktop stop` removed the
Desktop runtime in one second.
