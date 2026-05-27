# Hydra Versioning

Hydra uses semantic version numbers in the shape `MAJOR.MINOR.PATCH`.

## Current Release Lane

The current working package version is still in the `1.0.x` lane because the
ongoing performance, splash, auth/session, and dogfood evidence work is being
committed incrementally with `[skip-bump]`. Those commits keep GitHub and local
source synchronized without publishing a half-complete desktop release.

The next complete performance release should be a **minor** release, not another
patch-only release. If `package.json` is still at `1.0.20` when the final gate is
ready, the intended release is `1.1.0`.

This is intentional release-train behavior:

- `1.0.20` is the latest package metadata and tag line at the time of this doc
  update, not the target size for the next user-visible release.
- Every `[skip-bump]` push is still real work on `origin/master`; it is just not
  allowed to auto-publish to users yet.
- The performance tranche is being batched because the changes are connected:
  splash timing/density/tilt, finite graphics cleanup, renderer timer ownership,
  browser-profile cleanup, request-log/proxy hot-path work, auth/session
  hardening, and measured idle/process evidence.
- The final release commit for this tranche should carry `[bump:minor]`, which
  makes auto-version write `1.1.0` from the current `1.0.x` line.
- Do not cut another patch just because `package.json` currently says `1.0.x`.
  Patch is for isolated fixes; this is now a coherent performance and UX train.

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

Expected during the tranche: local `master` equals `origin/master`, recent
commits are visible on GitHub with `[skip-bump]`, Auto-version is skipped for
those checkpoints, and CI/Docker keep validating the remote state. Expected at
the end: one non-`[skip-bump]` commit with `[bump:minor]` triggers auto-version,
creates `chore(release): v1.1.0 [skip-bump]`, pushes tag `v1.1.0`, and dispatches
the desktop release workflow.

## Bump Rules

| Bump | Use when | Example |
| --- | --- | --- |
| Patch | Narrow bug fix, docs correction, packaging contract fix, or tiny hardening with no meaningful operator-facing behavior change. | `1.0.20 -> 1.0.21` |
| Minor | Coherent feature, UX, performance, or operator-workflow release that users should notice but that preserves compatibility. | `1.0.20 -> 1.1.0` |
| Major | Breaking local data, API, CLI, config, updater, or operator-contract change. | `1.0.20 -> 2.0.0` |

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

## Current Performance Release Plan

The final performance release should not be cut until the 12-item acceptance
list in `docs/CODEX_GOAL.md` is empirically green and `docs/RELEASE_AUDIT.md`
contains measured evidence.

For this tranche, the final release commit should include `[bump:minor]` and
should not include `[skip-bump]`. Incremental source/doc/test commits before
that point should continue using `[skip-bump]`.

Operationally:

1. Push source, docs, and test checkpoints to `master` with `[skip-bump]`.
2. Wait for CI/Docker to go green on those checkpoints.
3. Keep `docs/RELEASE_AUDIT.md`, `docs/FINAL_DOGFOOD_EVIDENCE.md`, and
   `docs/PACKAGED_ELECTRON_DOGFOOD.md` honest about what is source-verified,
   packaged-verified, user-confirmed, or still deferred.
4. When the acceptance list is actually complete, make one final release commit
   with `[bump:minor]` and no `[skip-bump]`.
5. Let auto-version bump `1.0.x -> 1.1.0`, tag the release, and dispatch the
   desktop release workflow.

If the final tranche changes backward compatibility before release, replace
`[bump:minor]` with `[bump:major]` and document the migration. No current change
requires that.

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
tags the resulting version. If the current package metadata is still `1.0.20`,
that produces `1.1.0`, not `1.0.21`.

The release trigger is deliberately commit-message based so no one has to edit
the workflow by hand for patch/minor/major releases. The only manual choice is
the bump marker in the final commit message.

## Splash Density And Tilt In The Version Notes

The user-visible splash changes belong in the minor release notes because they
are not just a patch:

- The visible splash duration is 12 seconds.
- The falling-word target is 92 words, a 15% density increase over the prior
  80-word runtime.
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
