# Electron Lifecycle Keepalive and Quit Tracing

Date: 2026-06-01

## What Was Found

Packaged LaunchServices dogfood exposed a zero-exit-code Hydra shutdown without
a crash report. The app launched, destroyed the splash, showed the main window,
then disappeared from `hydra doctor` and macOS RunningBoard as a voluntary exit.

The first package had no source-level shutdown evidence because the Electron log
tee closed `main.log` on `before-quit` before later lifecycle handlers could
write their breadcrumbs. That hid legitimate quit-path diagnostics.

After lifecycle tracing landed, a later five-minute soak caught a second,
clearer issue: the main-window close handler still opened a modal with
`Keep Running in Background` and `Quit Hydra`. During dogfood, the modal path
selected response `1`, which set `forceQuit=true` and shut down the proxy. That
is technically a voluntary quit, but it is the wrong default for Hydra because
normal window close should never be able to take down the local routing layer.

## Why It Matters

Hydra is a local proxy and account manager. Closing silently is worse than a
visible failure because the menu-bar proxy disappears while appearing healthy
during the initial launch window. Release dogfood needs to distinguish:

- user-requested quit
- renderer crash
- window close to background
- OS signal or Apple Event termination
- Node event-loop fallthrough

## How It Was Checked

Commands used:

```bash
open -n /Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app
node bin/hydra.mjs doctor --json
/usr/bin/log show --style compact --last 30m --predicate 'process == "Hydra" OR eventMessage CONTAINS[c] "com.zayd.hydra" OR eventMessage CONTAINS[c] "Hydra.app"'
tail -120 "$HOME/Library/Logs/Hydra/main.log"
```

Temporary no-biometric comparison runs toggled
`~/Library/Application Support/Hydra/preferences.json` to
`"biometricEnabled": false` and restored the original file before exit.

Evidence paths:

```text
/private/tmp/hydra-v143-touchid-final-soak-20260601T.QkFn3i
/private/tmp/hydra-v143-no-biometric-soak-20260601T.UZsfzO
/private/tmp/hydra-v143-instrumented-exit-trace-20260601T.bVyT25
/private/tmp/hydra-v143-final-controlled-background-soak-20260601T.9yB5Ve
/private/tmp/hydra-v143-final-close-background-launch-20260601T.Mb2rht
```

Observed examples:

- Touch ID enabled package: `4 -> 0` owned processes during soak; no crash
  report.
- Touch ID disabled package: `4 -> 0` by the 40-second sample; no crash report.
- Instrumented package before keepalive: all sampled checks remained at four
  processes through sample 12, then macOS recorded another voluntary exit
  immediately after the sample window. The lack of lifecycle breadcrumbs proved
  the log stream was closing too early for quit-path proof.
- Final controlled background soak before the close-path repair: the lifecycle
  log showed `main-window:close-requested`, `main-window:close-dialog-response`
  with `response:1`, `main-window:close-dialog-quit-selected`, and then
  `lifecycle:before-quit`, proving a close-dialog quit path rather than a crash
  or event-loop fallthrough.
- Final rebuilt package after the close-path repair: 11 LaunchServices samples
  over five minutes stayed at exactly four Hydra-owned processes and zero Hydra
  Playwright profiles. CPU ranged `0.0-6.8%`, averaged `0.8%`, and ended at
  `0.0%`. Splash teardown remained bounded: 72 queued/shattered words, zero
  duplicate shatter skips, timers `0`, inactive RAF, collision-free lifted
  portal entry, and cleared Matter state.

## Fix

`electron/app/env.js` now closes the log stream on `will-quit` rather than
`before-quit`, preserving `before-quit` breadcrumbs.

`electron/main.js` now starts a single ref'd one-minute lifecycle keepalive in
the lock-holder process. This prevents the packaged main process from exiting
only because every other Node-side timer was intentionally unref'd for idle
efficiency.

`electron/main.js`, `electron/app/windows.js`, and `electron/app/ipc.js` now
log source-level lifecycle paths:

- app `before-quit`, `will-quit`, `quit`, `window-all-closed`
- process `beforeExit`, `exit`, `SIGTERM`, `SIGINT`, `SIGHUP`
- tray/menu quit requests
- native IPC hide/quit/close requests
- main-window show/hide/close/background-destroy/renderer-gone/load-fail events

`electron/app/windows.js` no longer shows a quit modal on ordinary window
close. Normal close is now background-only: it prevents default close, logs
`close-kept-running-in-background`, hides the macOS Dock icon, destroys the
renderer to free Chromium memory, and keeps the embedded proxy alive. Full
shutdown remains available through explicit native quit actions, which set
`forceQuit` before `app.quit()`.

No secrets are logged.

## Reproduce

1. Build the ARM package.
2. Launch through LaunchServices only:

```bash
open -n /Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app
```

3. Sample owned processes:

```bash
node bin/hydra.mjs doctor --json
```

4. Inspect logs:

```bash
tail -120 "$HOME/Library/Logs/Hydra/main.log"
```

Expected behavior after the fix: a stable packaged idle run keeps four Hydra
processes and zero Hydra Playwright profiles; any future quit path leaves a
specific lifecycle breadcrumb before shutdown.
