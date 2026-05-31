# Renderer Idle Performance

## Finding

On 2026-05-31, an exact-public `v1.1.4` packaged renderer stayed hot after a
CDP-only route walk. The Electron main process and network utility were idle,
but the GPU and renderer processes held roughly `63-76%` aggregate CPU while
Settings remained visible.

Renderer-owned diagnostics were already settled: zero intervals, zero active
RAFs, zero Anime.js effects, and only the bounded upstream-health timeout.
`document.getAnimations()` isolated the remaining perpetual work to two
six-pixel `.status-dot.success` elements running the `breathe` CSS animation.

## Root Cause

Steady success, error, and warning status dots used infinite animations. The
success animation continuously changed `transform`, `opacity`, and
`box-shadow`. Even two tiny dots kept the visible packaged renderer and GPU
compositor active.

The intended visual signal does not require perpetual motion. A steady state
should look alive without continuously repainting.

## Fix

`src/index.css` now gives steady success, error, and warning dots a static
color-matched glow. Only `.status-dot.loading` keeps motion, and that pulse is
bounded to three `1.2s` cycles.

`server/tests/ui-static-contract.test.mjs` rejects future perpetual
steady-dot animations while requiring the bounded loading pulse.

## Reproduction

1. Launch the packaged app through LaunchServices with temporary CDP:

   ```bash
   open -n release/mac-arm64/Hydra.app --args --remote-debugging-port=9333
   ```

2. After splash handoff, open Settings through the packaged sidebar.
3. Query renderer animation state:

   ```js
   document.getAnimations().map((animation) => ({
     playState: animation.playState,
     target: animation.effect?.target?.className,
     name: animation.animationName,
   }))
   ```

4. Sample Hydra-owned package processes:

   ```bash
   ps -axo pcpu=,command= |
     awk '/^ *[0-9.]+ +\/Users\/zaydk\/Desktop\/hydra\/release\/mac-arm64\/Hydra.app\// { s += $1 } END { printf "%.1f\n", s+0 }'
   ```

5. Before the fix, pausing the two `breathe` animations ephemerally through
   CDP dropped aggregate Hydra CPU from roughly `64%` to `0.0-0.3%` without a
   route change or relaunch.

## Raw Evidence

The exact-public `v1.1.4` discovery and pause experiment are preserved at:

```text
/private/tmp/hydra-v114-expanded-route-diagnostics-20260531T122708Z
```

Key files:

```text
13-css-animation-state.json
14-paused-css-animations.json
15-paused-css-cpu-series.csv
```

The rebuilt local package verification is preserved at:

```text
/private/tmp/hydra-v114-status-dot-fix-runtime-20260531T123451Z
```

Key files:

```text
03-settings-runtime-state.json
04-visible-settings-cpu-series.csv
05-settings-settled-state.json
06-doctor-settled-summary.json
07-route-walk.jsonl
11-account-detail-settled-state.json
12-account-detail-doctor-summary.json
```

The rebuilt package kept its deliberately bounded post-splash ambient window:
the visible Settings sample started at `55.2%`, fell to `44.9%`, then reached
`1.6%` as startup motion settled. The next five samples were `0.0%`.
Settled Settings reported no running CSS animations, zero intervals, zero
active RAFs, and zero Anime.js effects. `hydra doctor` sampled `0.5%` CPU with
four Hydra-owned processes and zero stale Playwright profiles.

The rebuilt package also passed all eight sidebar routes plus a redacted
Account Detail reachability check. Settled Account Detail reported zero
intervals, zero active RAFs, zero Anime.js effects, and `0.7%` sampled Hydra
CPU.
