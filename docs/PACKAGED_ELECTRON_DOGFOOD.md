# Packaged Electron Dogfood

This is the final acceptance runbook for Hydra's packaged desktop app. It is
not a browser QA plan. Chrome, `vite preview`, localhost browser tabs, and
browser-only screenshots do not close release blockers here.

Run this only after source-level hardening, package smoke, lint, build, tests,
CLI audit, and docs updates are current.

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
| Windows installer launch | Install and launch the current `release/Hydra-<version>-win-x64.exe` or CI release artifact on Windows; record OS and result | pending |
| Docker runtime | `npm run docker:smoke` passes against a live Docker daemon | pending |
| Screenshot audit | Last step only: packaged Electron screenshots across representative sizes are reviewed for layout/color/text issues | pending |

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
