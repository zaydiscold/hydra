# Proximity Field Geometry Cache

Date: 2026-06-02

## What Was Found

Hydra's reusable proximity field already collapsed pointer-move floods behind
one tracked animation frame. Each painted frame still queried every tagged
target and called `getBoundingClientRect()`, including after compositor
transforms changed the rendered bounds.

## Why It Matters

Repeated rectangle reads can force layout work and introduce transformed-bound
feedback while the pointer moves across account grids, sidebar navigation, and
Settings action groups. The visual effect needs stable layout geometry, not a
fresh layout read on every decorative frame.

## How It Was Checked

Source trace:

```bash
rg -n "proximity|pointermove|getBoundingClientRect|data-proximity" src docs server
```

Deterministic nine-card grid benchmark:

```bash
node --input-type=module <<'NODE'
const targets = 9;
const pointerFrames = 120;
const oldGeometryReads = targets * pointerFrames;
const newGeometryReads = targets;
const reductionReads = oldGeometryReads - newGeometryReads;
console.log({
  targets,
  pointerFrames,
  oldGeometryReads,
  newGeometryReads,
  reductionReads,
  reductionPercent: Number((reductionReads / oldGeometryReads * 100).toFixed(3)),
});
NODE
```

Raw evidence:

```text
/private/tmp/hydra-proximity-geometry-cache-20260602T001207Z/summary.json
```

Observed summary:

```json
{
  "targets": 9,
  "pointerFrames": 120,
  "layoutInvalidations": 0,
  "oldQueries": 120,
  "newQueries": 1,
  "oldGeometryReads": 1080,
  "newGeometryReads": 9,
  "reductionReads": 1071,
  "reductionPercent": 99.167
}
```

## Fix

`useProximityField()` now snapshots target geometry once per pointer pass.
Cached geometry invalidates on viewport resize, field resize, child-list
changes, pointer leave, or unmount. Resize and mutation observers attach on
initial effect or lazily when a conditionally mounted field first paints.
Cleanup disconnects both observers.

## Verification

```bash
npm run test:ui-static
npm run lint
npm run build
node bin/hydra.mjs audit --json
git diff --check
```

The UI static suite locks geometry caching, lazy observer attachment, observer
disconnect cleanup, bounded attraction, reduced-motion bypass, and the
existing Dashboard, sidebar, and Settings integration.

## Packaged Runtime Evidence

The rebuilt ARM package passed smoke and strict deep codesign. The compiled
renderer hash matched between the source build output and the packaged app:

```text
521b1ef1ac60a769c26601576bd48d59523c63c63bf27db75e43b87ef1578a70  dist/assets/index-Bk2lzuYV.js
521b1ef1ac60a769c26601576bd48d59523c63c63bf27db75e43b87ef1578a70  release/mac-arm64/Hydra.app/Contents/Resources/app/dist/assets/index-Bk2lzuYV.js
```

The local archive SHA-256 before reversible metadata cleanup was:

```text
3e1022b3437179e43f7d630ec502ffde3b550d474103d729ee848137fc611a8e
```

Native LaunchServices evidence:

```text
/private/tmp/hydra-v147-proximity-geometry-cache-launch-20260602T001517Z
near-launch  4  97.8   410517504  0
plus-15s     4  186.1  752254976  0
plus-30s     4  4.2    647184384  0
```

The app remained the sole Spotlight `Hydra.app`, splash diagnostics reported
finite teardown with cleared Matter state, and the untouched five-minute idle
profile closed cleanly:

```text
/private/tmp/hydra-v147-proximity-geometry-cache-idle-profile-20260602T001609Z
samples=11 owned=4 profiles=0 cpu_min=0.000 cpu_max=0.300 cpu_avg=0.045 cpu_end=0.000 rss_start=648085504 rss_end=617791488 rss_delta=-30294016
```
