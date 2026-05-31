# Accessibility Profiling Distortion

## Finding

On 2026-05-31, two native Computer Use attach attempts against the already
settled public `v1.1.4` packaged app timed out after `120s` each:

1. Attach by app path:
   `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`
2. Attach by bundle identifier: `com.zayd.hydra`

After the timed-out attempts, the external Codex Computer Use helper remained
alive and continuously requested macOS accessibility attributes from Hydra.
That polling distorted a nominal idle profile: Hydra's Electron main process
held roughly `67-70%` CPU while its GPU, network utility, and renderer
processes remained idle.

This was not a splash, renderer, timer, or animation runaway. Terminating the
stuck external helper returned the same Hydra process tree to `0.0%` sampled
CPU without relaunching Hydra.

A fresh controlled retry against the exact-public `v1.4.0` package reproduced
the same failure mode on 2026-05-31. `get_app_state("com.zayd.hydra")` timed
out after `120s`; external `SkyComputerUseService` held `30.4%` CPU; Hydra's
main process held `69.7%` CPU while its GPU, network, and renderer helpers
remained idle. Terminating only that external helper returned the unchanged
four-process Hydra tree to `0.0%` sampled CPU with zero stale Hydra Playwright
profiles.

## Why It Matters

Native accessibility attachment is not suitable for Hydra idle profiling in
this environment. A profile collected after a timed-out Computer Use attach
can falsely look like an application regression. Use an anchored process
sampler before any accessibility tooling, and discard any idle baseline if an
accessibility attach timed out or left `SkyComputerUseService` alive.

Computer Use attach failures also do not prove packaged window-control
behavior. Traffic-light controls, tray reopen, Touch ID approval, and final
interactive review remain manual evidence boundaries.

## Reproduction And Evidence

The external helper was identified with:

```bash
ps -axo pid=,ppid=,pcpu=,rss=,etime=,command= |
  rg 'SkyComputerUseService|Hydra.app'
```

The contaminated anchored profile is preserved at:

```text
/private/tmp/hydra-v114-final-idle-reprofile-20260531T121215Z
```

It began with two clean samples, then held the distorted state:

```text
2026-05-31T12:12:15Z,4,0.000,512000,0
2026-05-31T12:12:45Z,4,0.000,511872,0
2026-05-31T12:13:15Z,4,68.300,509440,0
2026-05-31T12:17:16Z,4,68.700,511200,0
```

Fields are timestamp, Hydra-owned process count, aggregate Hydra CPU percent,
aggregate Hydra RSS KiB, and stale Hydra Playwright-profile count.

A macOS stack sample of Hydra's hot main process is preserved at:

```text
/private/tmp/hydra-main-highcpu-3671.sample.txt
```

The stack traversed the accessibility request path:

```text
HIServices mshMIGPerform
_XCopyAttributeValue
_AXXMIGCopyAttributeValue
CopyAttributeValue
NSAccessibilityChildren
accessibilityWindowsAttribute
```

A second sample of the external helper is preserved at:

```text
/private/tmp/skycomputeruse-highcpu-21327.sample.txt
```

The fresh exact-public `v1.4.0` retry and recovery snapshots are preserved at:

```text
/private/tmp/hydra-v140-cua-attach-retry-20260531T151812Z
```

## Recovery

Terminate only the stuck tool-owned helper, then remeasure Hydra without
relaunching it:

```bash
kill -TERM <SkyComputerUseService-pid>
sleep 5
node bin/hydra.mjs doctor --json
```

The 2026-05-31 recovery changed Hydra from roughly `67%` CPU to `0.0%`, kept
four Hydra-owned processes, and kept zero stale Hydra Playwright profiles.
The clean post-recovery five-minute sampler is preserved at:

```text
/private/tmp/hydra-v114-post-cua-idle-reprofile-20260531T122026Z
```

All 11 samples kept four Hydra-owned processes and zero stale Hydra Playwright
profiles. CPU stayed between `0.0%` and `0.2%` (`0.091%` average), and RSS
moved from `505.36 MiB` to `507.20 MiB` (`+1.84 MiB`).

The fresh exact-public `v1.4.0` recovery snapshot kept four Hydra-owned
processes, returned aggregate Hydra CPU from `69.7%` to `0.0%`, kept RSS at
`493.77 MB`, and kept stale Hydra Playwright profiles at zero.

## v1.4.0 Route-Review Retry

The exact-public `v1.4.0` packaged app reproduced the same boundary on
2026-05-31. `get_app_state("com.zayd.hydra")` timed out after `120s`;
external `SkyComputerUseService` held `28.8%` CPU; Hydra's otherwise-idle main
process held `66.5%`; and the GPU, network, and renderer helpers remained
effectively idle. A five-second sample again traversed HIServices
`_AXXMIGCopyMultipleAttributeValues`.

Terminating only the external helper returned the unchanged four-process Hydra
tree to `0.0%` sampled CPU with zero stale Hydra Playwright profiles. Raw
owner-only evidence is under
`/private/tmp/hydra-v140-cua-route-review-retry-20260531T233933Z`.

Follow-up route control remained unavailable: Computer Use rejected `Cmd+,`
because the timed-out session never became active, and an AppKit-foregrounded
Quartz `CGEvent` scan across the safe navigation band left the packaged native
window title unchanged. Keep native interactive route review manual on this
machine unless the Computer Use accessibility attach is repaired.
