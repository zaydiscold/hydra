# Request Cancellation Recon

Date: 2026-06-01

## What Was Found

Hydra already canceled detached bulk chunks after a renderer disconnect, but
several request-owned auth and upstream paths could still outlive the request
that started them. The remaining paths included OpenRouter retries, Clerk
fetches, dashboard JWT self-healing, management-key provisioning, code
redemption, Playwright fallback work, diagnostic probes, model-list refresh,
and the session refresher's active sweep.

The release audit also encoded the older four-argument proxy-redemption call
shape. Adding the request signal correctly changed those call sites, but the
stale predicate made the encrypted proxy-pool row appear missing until its
source contract was updated.

## How It Was Found

The audit started from direct source inspection and a scan for raw retry
timers, direct fetch calls, and lifecycle loops. Focused regression tests,
`npm test`, `npm run gate`, `npm run openapi:hydra`, `git diff --check`, ARM
package smoke, strict deep `codesign`, LaunchServices startup, `hydra doctor`,
and Spotlight lookup were then run against the exact pushed source.

The deterministic retry benchmark is preserved at:

```text
/private/tmp/hydra-openrouter-disconnect-benchmark-20260531T195305/summary.txt
```

## Why It Matters

A renderer disconnect must end work that no longer has an owner. Otherwise a
closed command screen can leave retry timers, Clerk requests, Playwright
fallback contexts, or refresher passes consuming resources and mutating state.
The audit predicate repair matters separately: the closed-app audit must fail
only for real missing release work, not because its static evidence parser
drifted behind a hardened function signature.

## Raw Evidence

The OpenRouter benchmark exercised `200` canceled surfaces with a `500ms`
retry delay:

```json
{
  "oldElapsedMs": 525.428,
  "oldFetchCalls": 400,
  "oldPostDisconnectRetries": 200,
  "newElapsedMs": 16.496,
  "newFetchCalls": 200,
  "newAbortCount": 200,
  "avoidedPostDisconnectFetches": 200
}
```

The rebuilt package launched through LaunchServices with evidence under:

```text
/private/tmp/hydra-v140-request-ownership-current-source-launch-20260531T195645
```

Its settled short profile is preserved under:

```text
/private/tmp/hydra-v140-request-ownership-post-rebuild-quiet-idle-20260531T195735
```

Across 11 samples, the package retained four Hydra-owned processes, averaged
`0.436%` aggregate CPU, ended at `0.000%`, moved from `635088 KiB` to
`604096 KiB` RSS, and retained zero Hydra Playwright profiles. `hydra doctor`
also recorded four owned processes at `0%` CPU and zero Hydra Playwright
profiles. It separately reported unrelated external browser-tool pressure;
that pressure is not attributed to Hydra.

After the predicate repair, the closed-app audit returned:

```text
31 ok / 5 deferred / 0 missing / 0 blockers
complete=false
```

The five deferred rows remain packaged GUI dogfood, live MVP dogfood,
packaged screenshot audit, Touch ID dogfood, and Windows launch dogfood.

## Reproduce

```bash
npm run test:openrouter-request-cancellation
npm run test:batch-runner
npm run test:background-failure-visibility
npm run test:session-refresh-contract
npm run test:ui-static
npm run test:test-chain-completeness
npm run test:cli
npm run lint
npm test
npm run build
npm run gate
npm run openapi:hydra
git diff --check
HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app
node bin/hydra.mjs audit --json
mdfind "kMDItemFSName == 'Hydra.app'cd"
```

## Public Release Boundary

Checkpoint `fced9d6443cb852a8d1229c7289f7b81a75477b7` is pushed to `master`.
Auto-version run `26732648111` skipped because the commit used `[skip-bump]`,
CI run `26732648116` passed, and Docker workflow run `26732648112` passed
runtime smoke and registry image push.

The rebuilt local ARM zip SHA-256 was:

```text
c3700c1a52d44f9a2638c1f71ce0114aeccc030f8eb0d23f0ee96aa454a98844
```

That hash is local current-source package proof only. Public `v1.4.0` assets
remain the previously published Mac, Windows, and Linux artifacts because the
five manual acceptance rows remain deferred.

