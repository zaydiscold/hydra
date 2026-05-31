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

## Public v1.1.5 Verification

The published `Hydra-1.1.5-mac-arm64.zip` SHA-256 matched GitHub asset digest
`b64cd8f285d605e80416e4c9a7d4937076672801fe22b61f1a8d904d7454d341`.
Its SHA-512 matched `latest-mac.yml`, strict deep codesign passed, and
`HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed after the
exact-public zip was installed.

The canonical app was opened normally through LaunchServices without CDP or
Computer Use. After the bounded startup decay, the exact-public sampler at
`/private/tmp/hydra-v115-public-idle-profile-20260531T125505Z` kept four
Hydra-owned processes and zero stale Playwright profiles through all 11
30-second samples. CPU stayed between `0.0%` and `0.5%` (`0.136%` average);
RSS moved from `569.73 MiB` to `575.33 MiB` (`+5.59 MiB`). A follow-up
`hydra doctor --json` sampled `0.0%` Hydra CPU.

A fourth untouched exact-public follow-up at
`/private/tmp/hydra-v115-public-idle-reprofile-20260531T140919Z` sampled the
same already-settled canonical app every 30 seconds for five minutes with zero
UI interaction. All 11 samples reported four Hydra-owned processes and zero
stale profiles. Sampled CPU stayed at `0.000%` throughout; RSS moved from
`577.23 MiB` to `579.20 MiB` (`+1.97 MiB`). Raw before/after inventories
contain only the expected main, GPU, network-utility, and renderer processes.

## Public v1.1.5 Route Recheck

A second packaged-only CDP pass against the installed public app is preserved
at:

```text
/private/tmp/hydra-v115-public-route-walk-20260531T132145Z
```

The pass mounted Dashboard, Bulk OTP, Vault, Pool Manager, Redeem, Generator,
Traffic, Settings, and a redacted Account Detail route. Settled Settings
reported zero intervals, zero active RAFs, zero Anime.js effects, one bounded
`App.upstreamHealth` timeout, and only a finished one-shot `fadeIn`. Its
eight-sample CPU decay stayed between `0.0%` and `1.6%`, ending at `0.2%`.

Account Detail intentionally mounted four `ScrambleText.reveal` intervals and
one `AnimeText.scanline` effect. Six seconds later, diagnostics reported zero
intervals, zero active RAFs, and zero Anime.js effects. Its eight-sample CPU
decay stayed between `0.0%` and `0.8%`, ending at `0.0%`.

The temporary packaged-Electron debug session then closed cleanly:
Hydra-owned processes reached zero, port `9333` closed, and a normal no-debug
LaunchServices reopen settled to four owned processes, `0.0%` CPU, and zero
stale profiles.
