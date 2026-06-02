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
