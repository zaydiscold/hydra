# Task Supervisor Idle Scheduler Recon

Date: 2026-06-01

## What Was Found

Hydra's server-side `TaskSupervisor` started a one-shot expiry scheduler during
server bootstrap even when no tasks existed. Each empty sweep rescheduled the
next timeout 30 seconds later. The scheduler avoided overlap, but it still woke
the embedded server `120` times per hour while idle.

The repaired scheduler is demand-driven. Server startup leaves it disarmed
while the task map is empty. Registering a task arms the existing one-shot
expiry timeout. Archiving the final active task clears the timer again.
Shutdown still clears the timer and waits for any already-running sweep.

## How It Was Found

A rebuilt-package idle profile retained four Hydra-owned processes and zero
stale Playwright profiles but exposed bounded recurring CPU pulses. A timer
ownership sweep found the unconditional task-expiry startup path:

```bash
rg -n "setInterval|setTimeout|scheduleNextSweep|expireTasks" server src electron
sed -n '1,470p' server/services/task-supervisor.js
```

The repair was verified with the focused lifecycle suite and complete source
chain:

```bash
npm run test:task-supervisor
npm run test:background-failure-visibility
npm test
npm run lint
npm run build
npm run gate
npm run openapi:hydra
node bin/hydra.mjs audit --json
git diff --check
```

## Why It Matters

Expiry enforcement is useful only while work exists. Keeping an idle timeout
alive adds unnecessary embedded-server wakeups and makes packaged-app CPU
profiles noisier without improving correctness. Demand-driven ownership keeps
the same active-task safety contract and removes the empty-task cost.

## Raw Evidence

The deterministic lifecycle benchmark is preserved at:

```text
/private/tmp/hydra-task-supervisor-demand-driven-benchmark-20260601T050815Z/summary.json
```

It records:

```json
{
  "expiryIntervalMs": 30000,
  "oldEmptyTaskWakeupsPerHour": 120,
  "newEmptyTaskWakeupsPerHour": 0,
  "idleTimerArmedAfterStart": false,
  "timerArmedAfterRegistration": true,
  "timerArmedAfterFinalArchive": false,
  "activeTaskExpiryCadencePreserved": true
}
```

Native shutdown evidence for the package rebuild is under:

```text
/private/tmp/hydra-v140-task-supervisor-rebuild-shutdown-20260601T050928Z
```

LaunchServices relaunch evidence is under:

```text
/private/tmp/hydra-v140-task-supervisor-current-source-launch-20260601T051136Z
```

The untouched five-minute post-rebuild profile is preserved at:

```text
/private/tmp/hydra-v140-task-supervisor-post-rebuild-idle-20260601T051236Z
```

Its 11 samples retained four Hydra-owned processes and zero Hydra Playwright
profiles. Aggregate CPU ranged from `0.000%` to `0.100%`, averaged `0.009%`,
and ended at `0.000%`. RSS moved from `605696 KiB` to `602400 KiB`
(`-3296 KiB`).

## Reproduce

```bash
ELECTRON_CACHE=/private/tmp/hydra-electron-cache npm run electron:build:mac-arm64
HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app
open -n "$PWD/release/mac-arm64/Hydra.app"
node bin/hydra.mjs doctor --json
```

## Public Release Boundary

This is current-source local package proof. Public `v1.4.0` release assets stay
unchanged while the conservative manual acceptance rows remain deferred.
