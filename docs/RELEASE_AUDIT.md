# Hydra Release Audit

Last updated: 2026-05-20
Scope: source-verifiable release readiness for the Electron desktop app, plus explicit blockers for work that still requires packaged app, live account, Docker daemon, or screenshot evidence.

## Prompt-to-Artifact Checklist

| Requirement | Evidence | State |
| --- | --- | --- |
| Goal sheet is tracked and explicit | `docs/CODEX_GOAL.md` contains the Hydra objective, crunch list, verification pass, and execution order. | Verified |
| Packaged updater import crash fixed | `electron/app/autoUpdate.js` default-imports `electron-updater` and destructures `autoUpdater`; main-process tests forbid the named ESM import crash. | Verified |
| Splash auto-update is visible and aggressive | PR #4 merged: updater check delay reduced to 500ms, splash preload receives progress, splash shows update progress, and downloaded updates silently install while splash is visible. | Verified by CI/Electron smoke |
| Touch ID and keychain startup behavior | Settings/native preference and biometric fail-closed contracts are covered by `server/tests/ui-static-contract.test.mjs`, `server/tests/user-prefs.test.mjs`, `server/tests/electron-ipc-contract.test.mjs`, and Electron main-process contracts. | Source verified; live Touch ID prompt still needs packaged dogfood |
| Account proxy pool rotation | Audit reports encrypted Settings/API proxy storage and random proxy selection for signup, management-key, HTTP redemption, REST redemption, and Playwright redemption paths. | Source verified |
| README badges and grouping | PR #5 merged with top badges and grouped README navigation. | Verified by CI |
| Cross-platform Windows test hardening | PR #5 merged: `test:ci`, `cross-platform-contract`, POSIX mode guard, path normalization, and Windows smoke fixes. | Verified by CI/Electron smoke |
| Multi-arch macOS updater metadata | Release workflow includes `mac-update-metadata` and `scripts/merge-mac-update-yml.mjs`; workflow contract requires merged `latest-mac.yml` with arm64 and x64 files. | Source verified; next tag must produce real release metadata |
| CLI/API closed-app commands | `hydra status`, `doctor`, `api-map`, `proxy`, `audit`, `mcp`, code redemption, import/export, scan, keys, and lifecycle commands are covered by CLI tests and docs. | Source verified |
| Docker runtime documentation | `docs/DOCKER.md` documents bounded smoke timeouts, `HYDRA_DOCKER_BUILD_TIMEOUT_MS`, and `docker compose down --remove-orphans`. | Verified by audit |
| Release artifacts | Expected local files: macOS arm64 zip/blockmap, macOS x64 zip/blockmap, Windows x64 NSIS/blockmap. | Not Yet Verified in this source tarball |
| Packaged Electron GUI dogfood | Must launch packaged Electron, navigate real app surfaces, verify no dead buttons/silent failures, and keep secrets redacted. | Not Yet Verified |
| Live MVP dogfood | Live OTP/login, redemption, proxy rotation, and real-key paths require real credentials/accounts/codes. | Not Yet Verified |
| Screenshot and Remotion plan | Must capture from packaged Electron only, redact secrets, render Remotion still before final media. | Not Yet Verified |
| Docker runtime smoke | Requires reachable local Docker daemon. | Not Yet Verified |

## Current Verified Evidence

- PR #4 `Show splash auto-update progress` merged on 2026-05-20 with CI and Electron package smoke green on macOS arm64, macOS Intel, Windows NSIS, and Linux AppImage.
- PR #5 `Harden cross-platform CI tests and badges` merged on 2026-05-20 with CI, Electron package smoke, and release packaging verification green across the same target matrix.
- Fresh master audit command run on 2026-05-20 from `/private/tmp/hydra-master-audit-1779314773` returned `complete: false` because release artifacts, packaged GUI dogfood, live MVP dogfood, screenshot audit, Docker runtime, and previously missing docs were not all verified.
- Targeted checks run on fresh master: `npm run test:cross-platform` passed, `npm run test:workflow-contract` passed, and `node bin/hydra.mjs audit --json` produced the blocker inventory above.

## Not Yet Verified

- Build and inspect current local packaged artifacts for macOS arm64, macOS x64, and Windows x64 outputs, or attach CI artifact evidence from a tagged release.
- Launch packaged Electron via LaunchServices and dogfood splash, unlock, Dashboard, Settings Touch ID, proxy pool, traffic, CLI/router surfaces, and window/menu actions.
- Run live account/login/OTP/code redemption/proxy rotation flows with safe test data.
- Capture the required packaged Electron screenshots with no API keys, cookies, tokens, or personal account data visible.
- Render the Remotion still and only then a GitHub-friendly final preview artifact.
- Run Docker runtime smoke when Docker is reachable.

## Blockers

- Packaged GUI dogfood needs app-control or user-run evidence.
- Live MVP flows need credentials/accounts/codes.
- Docker runtime smoke needs a reachable local Docker daemon.
- Screenshot/Remotion evidence must wait until packaged Electron dogfood and redaction checks are ready.
