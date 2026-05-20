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
| Release artifacts | Current CI runner evidence from PR #7 covers macOS arm64 zip, macOS Intel zip, and Windows NSIS package smoke. Local arm64 build/smoke also passed; local Intel/Windows launch remains target-runner evidence only. | Verified for package-resource contract |
| Packaged Electron GUI dogfood | Must launch packaged Electron, navigate real app surfaces, verify no dead buttons/silent failures, and keep secrets redacted. | Not Yet Verified |
| Live MVP dogfood | Live OTP/login, redemption, proxy rotation, and real-key paths require real credentials/accounts/codes. | Not Yet Verified |
| Screenshot and Remotion plan | Must capture from packaged Electron only, redact secrets, render Remotion still before final media. | Not Yet Verified |
| Docker runtime smoke | GitHub Actions run 26196262336 `Runtime Smoke` ran `npm run docker:smoke -- --start` on Ubuntu, built the compose image, started the container, received a local health endpoint response, cleaned up compose resources, and the sibling `Build & Push` job passed. | Verified by CI runtime smoke |
| Session probe log privacy | Runtime log inspection on 2026-05-20 showed historical `[SESSION_PROBE]` lines with account aliases and full Clerk session IDs. `server/services/session-refresher.js` now redacts probe aliases and session IDs while preserving account-id failure evidence, `server/tests/background-failure-visibility.test.mjs` locks the contract, and `hydra audit` tracks `session-probe-redaction`. | Source verified |

## Current Verified Evidence

- GitHub Actions run 26193855786 on PR #7 verified current packaged artifacts across target runners: macos-14 --mac zip --arm64 built Hydra-1.0.7-mac-arm64.zip with target=darwin-arm64 and packaged resource contract OK; macos-15-intel --mac zip --x64 copied chrome-mac-x64, built Hydra-1.0.7-mac-x64.zip with target=darwin-x64, verified libquery_engine-darwin.dylib.node, and ended electron:smoke with packaged resource contract OK; windows-latest --win nsis --x64 built Hydra-1.0.7-win-x64.exe with target=win32-x64 and packaged resource contract OK.

- Fresh macOS arm64 package build on 2026-05-20 from current master succeeded in /private/tmp/hydra-master-audit-1779315452 after forcing Prisma caches into /private/tmp. Commands: HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:prepare, HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:build, HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke. Smoke verified packaged shell, release zip, Prisma engine, bundled Chromium, and 80 MB app size.
- Packaged app LaunchServices dogfood attempt on 2026-05-20 did not prove GUI launch: scripts/open-packaged-app.mjs verified bundle executable, quarantine absence, and codesign valid-on-disk for release/mac-arm64/Hydra.app, then LaunchServices returned kLSNoExecutableErr. Baseline open of Calculator.app failed with the same LaunchServices error and Finder AppleEvent lookup also failed, so this is recorded as a shell/LaunchServices handoff blocker rather than a Hydra bundle crash.
- Direct executable retry on 2026-05-20 reproduced the user's native abort before Hydra JS logging: release/mac-arm64/Hydra.app/Contents/MacOS/Hydra exited 134 with signal 6 in HIServices/_RegisterApplication, and stock Electron runtime probes also failed before printing --version on Electron 42.1.0, 42.2.0, and 40.10.1. That keeps packaged GUI dogfood deferred until a working Aqua/LaunchServices session or user-run app-control evidence is available; it is not yet proof of a renderer, server, updater, or app-code crash.
- Docker runtime check on 2026-05-20 remained blocked locally because docker info could not connect to unix:///Users/zaydk/.docker/run/docker.sock; Docker daemon was not reachable on this Mac shell. GitHub Actions run 26196262336 then closed target-runner runtime evidence: Runtime Smoke ran npm run docker:smoke -- --start, built and started the compose service with HYDRA_LISTEN_HOST=0.0.0.0, received the local health endpoint response, cleaned up compose resources, and Build & Push passed.
- macOS Intel package build was not attempted as local release evidence on Apple Silicon after prepare-electron-resources correctly refused HYDRA_BUILD_TARGET=darwin-x64 without a chrome-mac-x64/chrome-mac Playwright cache. CI artifact inspection downloaded the green PR #5 macOS Intel zip/blockmap and Windows NSIS/blockmap, but the extracted Intel app was unsigned in the downloaded artifact context, so mac-intel-current remains unverified locally.

- PR #4 `Show splash auto-update progress` merged on 2026-05-20 with CI and Electron package smoke green on macOS arm64, macOS Intel, Windows NSIS, and Linux AppImage.
- PR #5 `Harden cross-platform CI tests and badges` merged on 2026-05-20 with CI, Electron package smoke, and release packaging verification green across the same target matrix.
- Fresh master audit command run on 2026-05-20 from `/private/tmp/hydra-master-audit-1779314773` returned `complete: false` because release artifacts, packaged GUI dogfood, live MVP dogfood, screenshot audit, Docker runtime, and previously missing docs were not all verified.
- Targeted checks run on fresh master: `npm run test:cross-platform` passed, `npm run test:workflow-contract` passed, and `node bin/hydra.mjs audit --json` produced the blocker inventory above.

- Session probe log privacy hardening on 2026-05-20: local runtime log inspection found historical `[SESSION_PROBE]` entries containing account aliases and full Clerk `sid` values. The source now masks aliases and Clerk session IDs in active/expired/error/rotation probe logs, keeps account-id failure evidence for debugging, adds a background-failure visibility contract, and adds `session-probe-redaction` to `hydra audit`.

## Not Yet Verified

- Launch packaged Electron via LaunchServices and dogfood splash, unlock, Dashboard, Settings Touch ID, proxy pool, traffic, CLI/router surfaces, and window/menu actions.
- Run live account/login/OTP/code redemption/proxy rotation flows with safe test data.
- Capture the required packaged Electron screenshots with no API keys, cookies, tokens, or personal account data visible.
- Render the Remotion still and only then a GitHub-friendly final preview artifact.

## Blockers

- Packaged GUI dogfood needs app-control or user-run evidence.
- Live MVP flows need credentials/accounts/codes.
- Screenshot/Remotion evidence must wait until packaged Electron dogfood and redaction checks are ready.
