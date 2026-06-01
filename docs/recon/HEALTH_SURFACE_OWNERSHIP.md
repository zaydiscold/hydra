# Health Surface Ownership Recon

Date: 2026-06-01

## What Was Found

Hydra's OpenRouter reachability probe was bounded and deduplicated, but the
shared upstream fetch did not know when every renderer request that subscribed
to it had disconnected. A closed health surface could therefore leave the
probe alive until timeout.

The Settings Diagnostics panel had a related renderer ownership gap. Repeated
refreshes could overlap, and navigation away from Settings did not abort the
panel's pending `/api/system/health` and `/api/system/proxy-status` requests.
Native Electron bridge promises are not abortable, so late completions also
needed a current-route guard before writing React state.

A package profile after those fixes exposed a separate presentation-layer
wakeup. The authenticated app shell refreshed upstream health in the
background every 30 seconds through the same request helper as foreground
actions. That toggled the animated global progress bar for routine background
work. The stylesheet also retained an unused `.edm-bar` infinite animation
rule with no renderer owner.

## How It Was Found

The investigation started with a raw timer and network-ownership sweep:

```bash
rg -n "setInterval|setTimeout|fetch\\(|getSystemHealth|getProxyStatus|useVisibleRecurringTask" src server electron
npm run test:openrouter-request-cancellation
npm run test:ui-static
node bin/hydra.mjs audit --json
```

Each source fix was rebuilt into `release/mac-arm64/Hydra.app`, launched
through LaunchServices, and measured without UI interaction:

```bash
npm run electron:build:mac-arm64
HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app
open -n "$PWD/release/mac-arm64/Hydra.app"
```

The package profile sampled Hydra-owned process count, aggregate CPU, RSS, and
temporary Hydra Playwright profile count every 30 seconds for five minutes.
Broad before/after process inventories and `hydra doctor --json` snapshots
were captured separately so unrelated browser pressure was not attributed to
Hydra.

## Why It Matters

Renderer-owned work must stop when its last owner leaves. Otherwise Settings
navigation, repeated Diagnostics refreshes, or a closed health surface can
leave detached network work and stale state writes behind.

Background status polling should also stay visually quiet. Mounting an
animated foreground progress bar for a routine health refresh creates UI
flicker and unnecessary compositor activity even though the user did not
start an action.

## Raw Evidence

The shared-probe benchmark is preserved at:

```text
/private/tmp/hydra-health-probe-disconnect-benchmark-20260601T031358Z/summary.txt
```

It exercised `200` abandoned health surfaces:

```json
{
  "oldElapsedMs": 503.711,
  "newElapsedMs": 23.931,
  "newRejectedCallers": 200,
  "avoidedDetachedTailMs": 479.78
}
```

The Diagnostics teardown benchmark is preserved at:

```text
/private/tmp/hydra-diagnostics-unmount-benchmark-20260601T032542Z/summary.txt
```

It exercised `200` unmounted Diagnostics pages with two requests each:

```json
{
  "oldPendingAfterUnmount": 400,
  "oldStalePageWrites": 200,
  "newPendingAfterUnmount": 0,
  "newAbortedRequests": 400,
  "newSuppressedStalePageWrites": 200,
  "avoidedDetachedTailMs": 486.885
}
```

The quiet-loading event benchmark is preserved at:

```text
/private/tmp/hydra-background-health-loading-benchmark-20260601T033914Z/summary.txt
```

For `200` routine background polls, the prior shape emitted `400` loading
events and mounted the animated progress bar `200` times. The quiet path emits
zero background loading events while foreground requests retain the visible
loading default.

The intermediate package profile that exposed the compositor wakeup is:

```text
/private/tmp/hydra-v140-diagnostics-post-rebuild-idle-20260601T033118Z
```

Its 11 samples retained four Hydra processes and zero Hydra Playwright
profiles, but aggregate CPU averaged `6.818%` and ended at `9.400%`.

The current quiet-health package profile is:

```text
/private/tmp/hydra-v140-quiet-health-post-rebuild-idle-20260601T034327Z
```

Its 11 samples retained four Hydra processes and zero Hydra Playwright
profiles. Aggregate CPU ranged from `0.000%` to `0.100%`, averaged `0.009%`,
and ended at `0.000%`. RSS moved from `605104 KiB` to `607424 KiB`
(`+2320 KiB`).

## Reproduce

```bash
npm run test:openrouter-request-cancellation
npm run test:ui-static
npm run test:api-integration
npm run test:background-failure-visibility
npm run test:test-chain-completeness
npm run lint
npm test
npm run build
npm run gate
npm run openapi:hydra
git diff --check
HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app
node bin/hydra.mjs audit --json
mdfind "kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == 'Hydra'"
```

## Public Release Boundary

The pushed source checkpoints are:

```text
2348d0268fd9957d2243d665be07c54fdf378d70  shared health-probe ownership
a7376c66803833d58e95ef256a55d7bbc5f0d24e  Diagnostics route ownership
e583326c89f35da0d8f30a81fc4d16625395546c  quiet background health loading
```

The current local ARM zip SHA-256 was:

```text
f4bead3fafecd3c3f45ddd4d27783579f78ef479d0028155934e65521f80231b
```

That hash is local current-source package proof only. Public `v1.4.0` assets
remain the previously published Mac, Windows, and Linux artifacts because the
five manual acceptance rows remain deferred.

## Passive Observer Follow-Up

The first quiet-health patch removed the app-shell health-poll animation.
The follow-up sweep found the same foreground-loading coupling in other
passive observers: scheduled dashboard and pool-sync refreshes, traffic,
vault account refresh, cached session-status fallbacks, magic-link claim and
live confirmation polling, generator status and heartbeat polling, debounced
Code Redeemer preflight, and delayed post-run redemption-history
reconciliation. These paths now use dedicated quiet API helpers. Operator
actions retain the foreground loading default.

The event model is preserved at:

```text
/private/tmp/hydra-passive-observer-loading-benchmark-20260601T035300Z/summary.json
```

Across `200` modeled cycles per observer class, the prior paths emitted
`5600` global loading events. The quiet paths emit `0`, while foreground
requests still track loading by default.

Current-source package proof is preserved under:

```text
/private/tmp/hydra-v140-passive-observer-rebuild-shutdown-20260601T040100Z
/private/tmp/hydra-v140-passive-observer-current-source-launch-20260601T040400Z
/private/tmp/hydra-v140-passive-observer-post-rebuild-idle-20260601T040500Z
```

Native quit removed all four old package processes in one second. ARM
rebuild, package smoke, strict deep `codesign`, bundle version (`1.4.0`),
embedded source-map inspection, and LaunchServices relaunch passed. The
five-minute untouched profile retained four Hydra-owned processes and zero
Hydra Playwright profiles; CPU ranged from `0.000%` to `0.300%`, averaged
`0.027%`, and ended at `0.000%`. RSS moved from `634976 KiB` to
`603984 KiB` (`-30992 KiB`).

The pushed source checkpoint is:

```text
ceeeb5da21a13244dae3ea035cbdad53059e350b  quiet passive observer loading
```

Auto-version run `26734396984` skipped, CI run `26734396983` passed, and
Docker workflow run `26734396980` passed runtime smoke and registry image
push. The source update exposed stale closed-app audit predicates for the
older helper names. The predicate and CLI regression now require the quiet
form and return `31 ok / 5 deferred / 0 missing / 0 blockers` with
`complete=false`.

After audit/docs checkpoint `9d5db1c6a7b4c470460e59d8d18fb9d1863f5b88`,
the ARM desktop payload rebuilt once more. Package smoke, strict deep
`codesign`, bundle version (`1.4.0`), and embedded renderer-map inspection
passed. The final local ARM zip SHA-256 was:

```text
d568d3394737b7dd541de1148e99f74efa3bf6163980b2ae5c1b09b59e648cea
```

Generated archive byproducts moved reversibly to
`~/.Trash/hydra-passive-observer-final-package-20260601T041500Z`. Final
LaunchServices evidence is under
`/private/tmp/hydra-v140-passive-observer-final-launch-20260601T041500Z`:
the app launched `0 -> 4` processes in three seconds and settled with four
processes at `0.0%` CPU plus zero Hydra Playwright profiles. Packaged `docs/`
and `bin/` are intentionally excluded, so this documentation-only note does
not stale the desktop payload.

Auto-version run `26734703372` skipped, CI run `26734703373` passed, and
Docker workflow run `26734703374` passed runtime smoke and registry image
push.
