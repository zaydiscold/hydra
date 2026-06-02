# Hydra Versioning

Hydra uses semantic version numbers in the shape `MAJOR.MINOR.PATCH`.

## Current Release Lane

The renderer and desktop refinement shipped as `v1.4.0` on 2026-05-31. Its
stabilization patches culminated in public `v1.4.9` on 2026-06-02: artifact
parity, Bulk Auth callback truthfulness, Account Detail action repair, direct
HTTPS OTP signup boundaries, request-first management-key bootstrap, and
pending-account recovery all shipped in the `1.4.x` lane.

`v1.5.0` shipped the coherent minor release for Traffic Console pricing and
attempt telemetry, bounded proxy failover, real Command Grid/List/Map modes,
desktop density, stronger proximity navigation, Pool Manager ergonomics, Bulk
Import copy/log persistence, Touch ID defaults, and ambient graphics polish.

Tracked `package.json` and `package-lock.json` now target `1.5.6`, a focused
patch on top of the prior `v1.5.5` baseline. It keeps the Account Generator
rescue lane narrow while retaining the OpenRouter OTP handoff repair, replaces
the remaining brittle signup-shell wait with sanitized checkpoint polling, keeps
Generator cancellation cleanup abort-aware, and adds an app-owned packaged
self-capture dogfood path for machines where macOS Screen Recording or
Accessibility permissions block external capture tools.

The public `v1.4.2` desktop updater matrix contains macOS arm64, macOS Intel,
Windows x64 NSIS, Linux x64 AppImage, Windows updater metadata, Linux updater
metadata, and merged multi-architecture macOS updater metadata. Linux
publishing was restored because its package preparation and smoke contracts
were still maintained; keeping that artifact lane frozen no longer matched the
product surface.

The minor release, rather than another patch-only release, was intentional:

This is intentional release-train behavior:

- `1.0.20` was the prior package metadata and tag line before the tranche shipped.
- Every `[skip-bump]` push is still real work on `origin/master`; it is just not
  allowed to auto-publish to users yet.
- The performance tranche is being batched because the changes are connected:
  splash timing/density/tilt, finite graphics cleanup, renderer timer ownership,
  browser-profile cleanup, request-log/proxy hot-path work, auth/session
  hardening, and measured idle/process evidence.
- The release trigger carried `[bump:minor]`, which made auto-version write
  `1.1.0` from the `1.0.x` line.
- Future isolated fixes can return to patch bumps; future coherent operator-facing
  batches should select patch/minor/major based on their actual scope.

That means there can be many pushed source commits between public release
versions. A `[skip-bump]` commit is not "unreleased work floating locally"; it is
an intentional checkpoint on `origin/master` that keeps the repository backed up,
reviewable, and CI-verified while preventing auto-update users from receiving a
package before the acceptance evidence is complete.

The practical source-of-truth check is:

```bash
git fetch origin
git status --short --branch
git log --oneline --decorate --max-count=10
gh run list --branch master --limit 10
```

Expected for post-release checkpoints: local `master` equals `origin/master`,
recent commits are visible on GitHub with `[skip-bump]`, Auto-version is skipped,
and CI/Docker keep validating the remote state. The completed `v1.1.0` release
followed the intended flow: one non-`[skip-bump]` commit with `[bump:minor]`
triggered auto-version, created `chore(release): v1.1.0 [skip-bump]`, pushed tag
`v1.1.0`, and dispatched the desktop release workflow.

## Bump Rules

| Bump | Use when | Example |
| --- | --- | --- |
| Patch | Narrow bug fix, docs correction, packaging contract fix, or tiny hardening with no meaningful operator-facing behavior change. | `1.1.0 -> 1.1.1` |
| Minor | Coherent feature, UX, performance, or operator-workflow release that users should notice but that preserves compatibility. | `1.1.0 -> 1.2.0` |
| Major | Breaking local data, API, CLI, config, updater, or operator-contract change. | `1.1.0 -> 2.0.0` |

For Hydra, a minor bump is appropriate when several adjacent changes ship as one
noticeable desktop improvement. The current tranche qualifies because it combines
startup/splash UX, runtime diagnostics, browser-profile cleanup, renderer timer
ownership, auth/session hardening, packaging hygiene, and measured performance
work. Treating that as another `1.0.x` patch would understate the scope of the
release even though the app remains backward-compatible.

Patch releases remain useful for isolated rescues, such as a missing packaged
dependency, a workflow correction, or a one-line docs/runbook fix. They should
not be the default for a multi-day polish and performance release.

## Auto-Version Workflow

`.github/workflows/auto-version.yml` runs on pushes to `master` unless the
triggering commit includes `[skip-bump]` or is already a `chore(release):`
commit.

When the current `package.json` version already has a tag, the workflow bumps:

- patch by default, or with `[bump:patch]`
- minor with `[bump:minor]`
- major with `[bump:major]`

Then it writes `package.json` and `package-lock.json`, commits
`chore(release): vX.Y.Z [skip-bump]`, pushes the tag, and dispatches
`release.yml` on that tag.

If `package.json` was manually advanced but the matching tag does not exist, the
workflow treats that as a catch-up case and tags the current version as-is. That
preserves the rescue behavior that fixed the old `package.json` says `1.0.8` but
GitHub release is still `v1.0.7` failure.

## Current Performance Release Follow-Up

`1.5.6` is the current patch lane for the Account Generator signup-shell and
OTP-readiness repair, isolated-browser viewport repair, abort-aware cleanup, and
packaged self-capture evidence.
Continue using `[skip-bump]` for audit, dogfood, and isolated
documentation checkpoints after a release ships unless a real source fix must
go to users. Do not produce a second minor bump merely to record manual
evidence.

The post-`v1.4.0` stabilization tranche reached public desktop artifacts as
`v1.4.2`: request-owned cancellation and shutdown joins, bounded Windows
lifecycle smoke, hardened Docker browser fallback, passive renderer observer
cleanup, idle task-expiry disarming, idle request-log retention write
avoidance, and empty-pool health-pinger disarming. Keep the tested `v1.4.0`,
failed `v1.4.1`, and published `v1.4.2` tags immutable. The `v1.4.3` and
`v1.4.4` patches add the Touch ID/session/lifecycle closeout and Bulk Auth
redirect/dedupe hardening; `v1.4.5` is the narrow UI gate that prevents the
same Email Link callback failure from being started accidentally.
`v1.4.6` replaces the rigid splash dial-pad overlay with a faceted aperture
whose translucent wings preserve portal visibility without adding runtime
loops, renders the password fallback while native Touch ID token release is
pending, and requires explicit tenant-owner allowlist confirmation before the
dormant Email Link relay path can activate.
`v1.4.7` repairs the Account Detail renderer bindings for live-session,
snapshot, and management-key refresh actions while preserving route-owned
AbortSignal cancellation.
`v1.4.8` makes Bulk OTP return immediately after Clerk session persistence,
queues supervised management-key bootstrap in the background, preserves
requested key names, and tightens request-first OpenRouter fallback behavior.
`v1.4.9` restores pending OTP-stub visibility on Command and reuses saved
sign-in-needed accounts in the Bulk Import queue.

The `1.5.0` candidate adds priced proxy telemetry, explicit attempt outcomes,
an eight-key bounded failover default, real Command Grid/List/Map views,
sidebar labels and stronger proximity motion, forgiving Pool Manager controls,
persisted Bulk Import activity, compact density controls, and a launch-bounded
moon orbit.

The first `v1.4.1` tag exposed a pre-publication gate cycle before any desktop
artifact uploaded: `hydra audit` correctly reported that current-version Intel
artifacts were not public yet, while the CLI regression incorrectly required
them to be public before the release matrix was allowed to build them. Keep
that failed tag immutable. The repaired release-bootstrap contract ships the
same artifact-parity tranche as `v1.4.2`.

Operationally:

1. Push source, docs, and test checkpoints to `master` with `[skip-bump]`.
2. Wait for CI/Docker to go green on those checkpoints.
3. Keep `docs/RELEASE_AUDIT.md`, `docs/FINAL_DOGFOOD_EVIDENCE.md`, and
   `docs/PACKAGED_ELECTRON_DOGFOOD.md` honest about what is source-verified,
   packaged-verified, user-confirmed, or still deferred.
4. Use a normal patch bump only when an additional source fix must ship.
5. Keep the existing `v1.4.0`, failed `v1.4.1`, and later public `v1.4.x`
   tags pinned to their immutable commits.

If a future tranche changes backward compatibility, use `[bump:major]` and
document the migration. No current change requires a `2.0.0` release.

## Exact Release Commit Shape

Use a normal source/docs commit for checkpoints:

```bash
git commit -m "perf(proxy): cache client model lists [skip-bump]"
git push origin master
```

Use the final release trigger only after the acceptance list and evidence are
complete:

```bash
git commit -m "Release performance and startup tranche [bump:minor]"
git push origin master
```

The final commit message should not include `[skip-bump]`. Auto-version reads
the latest commit message, sees `[bump:minor]`, bumps the middle component, and
tags the resulting version. From the active `1.1.0` lane, a normal patch bump
produces `1.1.1`, a minor bump produces `1.2.0`, and a major bump produces
`2.0.0`.

The release trigger is deliberately commit-message based so no one has to edit
the workflow by hand for patch/minor/major releases. The only manual choice is
the bump marker in the final commit message.

## Splash Density And Tilt In The Version Notes

The user-visible splash changes belong in the minor release notes because they
are not just a patch:

- The visible splash duration is 16 seconds, 33% longer than the prior 12-second
  sequence.
- The falling-word target is a bounded 72-word unique irregular shower. It
  supersedes the denser 120-word pass after packaged profiling showed the
  tighter queue preserves the visual effect with less physics and compositor
  pressure.
- The exit begins at 13 seconds and ramps upward for three seconds with a
  delayed fade, replacing the earlier abrupt two-second gravity flip.
- Matter.js physics still runs through one owned `requestAnimationFrame` loop,
  with physics stepped at 45 Hz and painting throttled to 30 fps.
- The splash self-disposes after its visual window and reports diagnostics, so
  Matter bodies, timers, RAF, listeners, and optional sensors do not survive into
  the main app.
- Tilt support is opportunistic. The splash first uses browser/Electron sensor
  data when available: `deviceorientation`, `devicemotion`, `GravitySensor`, or
  `Accelerometer`.
- Exact MacBook lid-angle tilt is not exposed through a standard Electron API.
  It would require a native Apple HID bridge and hardware compatibility checks,
  so it remains documented as a future native enhancement rather than silently
  pretending all laptops can provide it.
- When sensor data exists, the x-axis value affects horizontal gravity, spawn
  position, and initial word velocity. When no sensor exists, Hydra uses a tiny
  randomized fallback lean so the pile still avoids looking perfectly centered.

The version note should phrase tilt as "opportunistic device tilt" rather than
"MacBook screen tilt." Browser/Electron can expose device motion/orientation on
some hardware, but normal Electron does not expose the MacBook hinge sensor.
Hydra's current implementation is still valuable because it has a graceful
fallback and because all tilt-related work is bounded by the splash disposal
contract.

Release-note wording should be precise:

- Correct: "Splash physics now supports opportunistic device tilt when Chromium
  exposes motion/orientation sensors, with a bounded fallback lean when no sensor
  exists."
- Correct: "The tilt value affects horizontal gravity, spawn x-bias, and initial
  word x velocity, then is smoothed before each Matter.js step."
- Incorrect: "Hydra reads the MacBook screen hinge angle." That is not exposed
  by Electron today and would need a native macOS HID bridge.
- Incorrect: "The splash keeps running in the background." The release must keep
  claiming the opposite only while diagnostics prove Matter, RAF, timers,
  listeners, and optional sensors are disposed.

Keep the release notes honest: source contracts can prove the wiring, but real
sensor behavior needs packaged-app evidence on hardware that exposes one of the
supported sensor APIs.
