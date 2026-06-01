# Packaged Electron Dogfood

This is the final acceptance runbook for Hydra's packaged desktop app. It is
not a browser QA plan. Chrome, `vite preview`, localhost browser tabs, and
browser-only screenshots do not close release blockers here.

Run this only after source-level hardening, package smoke, lint, build, tests,
CLI audit, and docs updates are current.

## Current Release Quick Path

For the current published release, derive the version from GitHub and download
the matching Release artifacts. This keeps the manual pass tied to the same
package set verified in `docs/RELEASE_AUDIT.md`, even when a resumed sandbox
cannot refresh local Git metadata and its checked-out `package.json` is stale.

```bash
HYDRA_RELEASE_VERSION="$(
  gh release view --repo zaydiscold/hydra --json tagName \
    --jq '.tagName | ltrimstr("v")'
)"
HYDRA_RELEASE_SLUG="${HYDRA_RELEASE_VERSION//./}"
DOGFOOD_DIR="$(mktemp -d "/private/tmp/hydra-v${HYDRA_RELEASE_SLUG}-manual.XXXXXX")"
gh release download "v$HYDRA_RELEASE_VERSION" --repo zaydiscold/hydra --dir "$DOGFOOD_DIR"
ditto -x -k "$DOGFOOD_DIR/Hydra-$HYDRA_RELEASE_VERSION-mac-arm64.zip" "$DOGFOOD_DIR/extracted-mac-arm64"
open -n "$DOGFOOD_DIR/extracted-mac-arm64/Hydra.app"
```

After the real packaged app pass, write evidence with only the flags that were
actually verified:

```bash
npm run dogfood:final -- \
  --write-evidence="/private/tmp/hydra-final-dogfood-v$HYDRA_RELEASE_VERSION.json" \
  --version="$HYDRA_RELEASE_VERSION" \
  --artifact-dir="$DOGFOOD_DIR" \
  --app="$DOGFOOD_DIR/extracted-mac-arm64/Hydra.app" \
  --launch-diagnostics \
  --manual=packaged-gui-launch \
  --manual=window-controls \
  --manual=splash-unlock-dashboard \
  --manual=navigation-dead-buttons
```

Add `--manual=touch-id`, `--manual=live-account-flows`,
`--manual=screenshots-redacted`, and `--manual=windows-launch` only after those
specific checks are done. The script records unknown manual IDs and refuses
`complete=true`, so typoed flags do not silently close blockers.

## Launch Rules

Use LaunchServices for macOS GUI dogfood:

```bash
npm run electron:open:mac-arm64
```

That command now prints the relevant package diagnostics before opening:
`CFBundlePackageType`, `CFBundleExecutable`, bundle identifier, executable
Mach-O type, root/executable xattrs including quarantine when present,
`codesign --verify --deep --strict`, `codesign -dv --verbose=4`, LaunchServices
output, and a post-handoff process lookup when `open` succeeds.

Do not run:

```bash
release/mac-arm64/Hydra.app/Contents/MacOS/Hydra
```

Direct executable launches can abort during macOS application registration and
do not represent a normal packaged app launch.

Before counting a launch failure as a Hydra bug, record:

- `npm run electron:open:mac-arm64` output
- If the launcher did not already print them, `codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app` and `plutil -p release/mac-arm64/Hydra.app/Contents/Info.plist`
- whether another system app, such as Calculator, opens from the same shell

## Evidence Template

Capture machine-readable evidence after the packaged GUI run is actually
performed. Pass only the `--manual=<id>` flags that were truly verified:

```bash
npm run dogfood:final -- \
  --write-evidence=/private/tmp/hydra-final-dogfood.json \
  --version=<version> \
  --artifact-dir=/path/to/downloaded/release-assets \
  --app=/path/to/extracted/Hydra.app \
  --manual=packaged-gui-launch \
  --manual=window-controls \
  --manual=splash-unlock-dashboard \
  --manual=navigation-dead-buttons \
  --manual=touch-id \
  --manual=live-account-flows \
  --manual=screenshots-redacted \
  --manual=windows-launch
```

Then copy the relevant summary into `docs/RELEASE_AUDIT.md`.

| Check | Required evidence | Result |
| --- | --- | --- |
| Launch through LaunchServices | `npm run electron:open:mac-arm64` succeeds and Hydra appears as a running app | pending |
| Native macOS window controls | Red/yellow/green traffic lights are visible, clickable, and not covered by renderer UI | pending |
| Window drag/move | Dragging the native titlebar moves the window | pending |
| Splash to unlock | Splash appears, unlock/setup screen appears, and Dashboard loads without blank-window fallback | pending |
| Dashboard navigation | Dashboard, Vault, Pool, Traffic, Codes, Generator, Settings, and Account Detail routes open from the packaged app | pending |
| Dead-button pass | Every visible primary action either performs work, shows disabled/preflight state, or surfaces a clear error/toast | pending |
| Session persistence | Quit/relaunch preserves expected local unlock/session behavior | pending |
| Session expiry/re-auth | Expired or invalid session state routes to visible re-auth/setup behavior | pending |
| Tray/menu behavior | Close/hide/reopen/quit paths work, Help menu actions respond, and no orphan Hydra/Chromium children remain | pending |
| Touch ID | Enable, disable, and unlock behavior is verified on macOS hardware with Touch ID available | pending |
| No-network recovery | Network-disabled and backend-killed states show actionable recovery UI, not blank screens | pending |
| Live OTP | At least one live OpenRouter/Clerk OTP login completes in the packaged app | pending |
| Bulk OTP isolation | Multi-account bulk OTP run keeps account states isolated and visible | pending |
| Code redemption | Single and bulk redemption paths are verified with live or controlled redeemable codes | pending |
| Proxy rotation/SSE | `/v1/chat/completions` with real pooled keys streams and rotates as expected | pending |
| Windows installer launch | Install and launch the current `release/Hydra-<version>-win-x64.exe` or CI release artifact on a real Windows desktop; record OS and result. Hosted `windows-2022` unpacked and NSIS-installed executable lifecycle smoke passed for public `v1.4.7` in release run `26782121839`. | pending |
| Docker runtime | Hosted Docker workflow run `26782109931` passed `Runtime Smoke` and `Build & Push` for the `v1.4.7` release trigger. The final local item-11 chain also passed `npm run docker:smoke`: production image rebuild, Hydra-owned isolated full-Chromium launch, zero compose services, zero `hydra_default` network residue, then Docker Desktop restored to stopped. | verified hosted and locally |
| Screenshot audit | Last step only: packaged Electron screenshots across representative sizes are reviewed for layout/color/text issues | pending |

Manual flag mapping:

Current exact-public `v1.4.7` note: Computer Use accessibility attachment
timed out twice after `120s` and distorted the otherwise-idle Hydra main
process until the external helper was terminated. Native CoreGraphics capture
still works without browser tooling, but interactive route walking remains a
manual boundary on this machine. See `docs/ACCESSIBILITY_PROFILING_DISTORTION.md`.

| Manual flag | Requires |
| --- | --- |
| `--manual=packaged-gui-launch` | Packaged app launched from `.app`/LaunchServices in a real GUI session and Hydra is visible/running. |
| `--manual=window-controls` | Traffic lights, drag, close/minimize/zoom, tray reopen, and quit behavior were tried in the packaged app. |
| `--manual=splash-unlock-dashboard` | Splash appeared, unlock/setup path completed or behaved correctly, and Dashboard loaded without a blank fallback. |
| `--manual=navigation-dead-buttons` | Main routes opened and visible actions either worked, showed disabled/preflight state, or surfaced a clear error/toast. |
| `--manual=touch-id` | Touch ID enable, test, disable, and unlock behavior were verified on macOS Touch ID hardware. |
| `--manual=live-account-flows` | Live OTP/login, bulk OTP isolation, code redemption, and proxy/SSE request paths were exercised with safe test data. |
| `--manual=screenshots-redacted` | Packaged Electron screenshots were captured after functional dogfood and checked for secrets. |
| `--manual=windows-launch` | Current Windows NSIS artifact installed and launched on Windows; OS/version/result recorded. |

Hosted Windows automation is a narrower release gate than the manual flag.
Public desktop release workflow run `26738568988` built the `v1.4.2` Windows
package, passed target-specific filesystem smoke, exercised unpacked and
NSIS-installed executable lifecycle checks with isolated app data, and
verified cleanup before publishing the installer. Keep
`--manual=windows-launch` unchecked until the NSIS installer is installed,
opened, and visually reviewed in a real Windows desktop session.

## Screenshot Rules

Screenshot audit is last. Functional packaged-app dogfood comes first.

Valid screenshot evidence:

- Captured from the packaged Electron app
- Names the app build/artifact used
- Covers representative desktop sizes and main routes
- Notes any visual defect with the route, viewport, and expected fix

Invalid screenshot evidence:

- Chrome
- `vite preview`
- localhost browser tabs
- source-only component screenshots
- screenshots taken before functional dogfood is attempted

## v1.1.4 Screenshot Checkpoint

The exact public `v1.1.4` arm64 package now has a privacy-checked screenshot
checkpoint under `docs/evidence/`. Packaged Electron native-window captures
cover first-run Vault setup, Dashboard, Vault, Pool, Settings Touch ID, and a
Traffic console seeded with synthetic rows inside a disposable isolated
profile. Privacy-safe rendered CLI artifacts cover `hydra status`,
`hydra proxy status`, and a compact `hydra doctor --json` excerpt.

The repository manifest at `docs/evidence/README.md` records capture methods,
SHA-256 hashes, and the privacy checks. macOS Vision OCR found zero
credential-shaped hits and ImageMagick found nonblank color variance for all
nine PNGs. A direct repository visual-review pass also replaced
machine-specific local and LAN endpoint values in the Settings image with
explicit redaction labels. Computer Use still times out against Hydra, so this
checkpoint does not replace the final interactive route review.

## v1.3.0 Dashboard Privacy Proof

The exact-public `v1.3.0` canonical app adds
`docs/evidence/hydra-v130-packaged-dashboard-privacy-redacted.png`. The image
came from native CoreGraphics enumeration plus `/usr/sbin/screencapture -l`,
not Chrome or a localhost browser. Its raw private image remains outside the
repository under
`/private/tmp/hydra-v130-public-post-closeout-idle-profile-20260531T132928`.
All content below the titlebar was pixelated before check-in. Tesseract OCR
found zero credential-shaped or endpoint-shaped hits; ImageMagick reported a
nonblank `3016x1936` image with `6443` colors. This proves current packaged-app
capture provenance without promoting the deferred interactive visual-review
checkbox.

## v1.4.0 Public Desktop Closeout

Public release workflow run `26724123318` passed shared gates, package smoke
for macOS arm64, macOS Intel, Windows x64 NSIS, and Linux x64 AppImage, the
hosted Windows unpacked-executable launch-and-cleanup check, artifact uploads,
and merged macOS updater metadata. All ten downloaded public assets matched
their GitHub SHA-256 digests. The updater SHA-512 values matched both Mac
archives, the Windows installer, and the Linux AppImage.

The downloaded public arm64 zip passed strict deep codesign and
explicit-resource package smoke before installation. The previous canonical
app moved reversibly to Trash; `release/mac-arm64/Hydra.app` now reports
`1.4.0`, Spotlight resolves only that app, and a normal no-debug
LaunchServices launch surfaced one native `Hydra — Dashboard` window at
`1440x900`. A settled doctor snapshot reported four Hydra-owned processes at
`0.0%` CPU, `591.00 MB` RSS, and zero stale Hydra Playwright profiles.

This closes machine-verifiable release evidence only. Interactive route
review, account-grid magnetic-response review, Touch ID fingerprint approval,
live OTP/redemption/proxy flows, and real Windows NSIS install/open UX remain
manual boundaries.

## v1.4.2 Artifact-Parity Closeout

The post-`v1.4.0` stabilization tranche is public as immutable patch release
`v1.4.2`. Release Desktop Apps run `26738568988` passed shared gates, Linux
x64 AppImage smoke, macOS arm64 smoke, macOS Intel smoke, Windows x64 NSIS
smoke, hosted unpacked and NSIS-installed Windows executable lifecycle checks,
artifact uploads, and merged macOS updater metadata.

Live GitHub inspection found all ten expected assets. Downloaded updater
manifests report `1.4.2`, reference the correct platform artifacts, and keep
both macOS architectures. The downloaded public arm64 zip SHA-256
`243ad57e19bc2b6e8d25511443f79bd71fb1e41aecbbcd64f29478deeabecfe7`
matches GitHub; its SHA-512 matches `latest-mac.yml`; and its extracted app
passed strict deep `codesign` plus explicit-resource package smoke.

Native quit removed the stale local `1.4.0` package before it moved reversibly
to `~/.Trash/hydra-local-v140-replaced-20260601T063234Z/Hydra.app`. The exact
public `1.4.2` package now occupies `release/mac-arm64/Hydra.app`. A
LaunchServices relaunch settled to four Hydra-owned processes at `0.1%`
aggregate CPU and `618.70 MB` RSS with zero Hydra Playwright profiles.
Spotlight resolves exactly the canonical bundle and `release/` contains only
`mac-arm64/Hydra.app`.

This closes machine-verifiable artifact parity only. Interactive route review,
account-grid magnetic-response review, Touch ID fingerprint approval, live
OTP/redemption/proxy flows, and real Windows NSIS visual UX remain manual
boundaries.

## Native Accessibility Profiling Guardrail

Do not run Computer Use before collecting Hydra idle measurements in this
environment. Two `get_app_state` attempts against the exact-public `v1.1.4`
package timed out after `120s` and left `SkyComputerUseService` polling macOS
accessibility attributes. Hydra's main process then held roughly `67-70%` CPU
until the stuck external helper was terminated, after which the same packaged
app returned immediately to `0.0%` sampled CPU without relaunch.

Treat any idle profile collected after a timed-out accessibility attach as
contaminated. Collect the anchored baseline first, confirm
`SkyComputerUseService` is not stuck, and keep native traffic-light controls,
tray reopen, Touch ID approval, and final interactive review as manual
evidence. See `docs/ACCESSIBILITY_PROFILING_DISTORTION.md` for the exact
reproduction, raw local evidence paths, stack signature, and recovery command.
