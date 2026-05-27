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

## Bump Rules

| Bump | Use when | Example |
| --- | --- | --- |
| Patch | Narrow bug fix, docs correction, packaging contract fix, or tiny hardening with no meaningful operator-facing behavior change. | `1.0.20 -> 1.0.21` |
| Minor | Coherent feature, UX, performance, or operator-workflow release that users should notice but that preserves compatibility. | `1.0.20 -> 1.1.0` |
| Major | Breaking local data, API, CLI, config, updater, or operator-contract change. | `1.0.20 -> 2.0.0` |

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

Keep the release notes honest: source contracts can prove the wiring, but real
sensor behavior needs packaged-app evidence on hardware that exposes one of the
supported sensor APIs.
