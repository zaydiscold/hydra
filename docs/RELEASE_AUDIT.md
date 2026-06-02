# Hydra Release Audit

Last updated: 2026-06-01
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
| Multi-arch macOS updater metadata | Release workflow includes `mac-update-metadata` and `scripts/merge-mac-update-yml.mjs`; workflow contract requires merged `latest-mac.yml` with arm64 and x64 files. v1.0.17 release artifact inspection verified `latest-mac.yml`, `latest.yml`, and `latest-linux.yml` were published with macOS arm64/x64 and Windows artifacts. | Verified by release |
| CLI/API closed-app commands | `hydra status`, `doctor`, `api-map`, `proxy`, `audit`, `mcp`, code redemption, import/export, scan, keys, and lifecycle commands are covered by CLI tests and docs. | Source verified |
| Docker runtime documentation | `docs/DOCKER.md` documents bounded smoke timeouts, `HYDRA_DOCKER_BUILD_TIMEOUT_MS`, and `docker compose down --remove-orphans`. | Verified by audit |
| Release artifacts | GitHub release v1.4.7 is public and contains macOS arm64 zip/blockmap, macOS Intel zip/blockmap, Windows NSIS/blockmap, Linux x64 AppImage, merged `latest-mac.yml`, Windows `latest.yml`, and Linux `latest-linux.yml`. Release workflow run `26782121839` passed shared gates, package smoke on every target, the hosted Windows unpacked and NSIS-installed executable lifecycle gate, artifact uploads, and macOS updater-metadata merge. Live GitHub asset inspection verified all ten expected public assets and SHA-256 digests. Real Intel GUI and user-driven Windows UX remain target-runner or user-run evidence only. | Asset presence verified; v1.4.7 released |
| macOS package library validation | PR #21 added `com.apple.security.cs.disable-library-validation` to `desktop/entitlements.mac.plist` and package-smoke coverage. The exact-local public `v1.4.7` macOS arm64 app verifies with `codesign --verify --deep --strict`; release-matrix package smoke passed on macOS arm64 and macOS Intel. | Verified by release artifact dogfood |
| Packaged Electron GUI dogfood | Must launch packaged Electron, navigate real app surfaces, verify no dead buttons/silent failures, and keep secrets redacted. | Not Yet Verified |
| Live MVP dogfood | Live OTP/login, redemption, proxy rotation, and real-key paths require real credentials/accounts/codes. | Not Yet Verified |
| Packaged screenshot plan | Current gallery and splash media come from packaged Electron only and stay redacted; final interactive human visual review remains manual. The superseded Remotion lane is out of scope. | Partially verified |
| Docker runtime smoke | GitHub Actions run `26782109931` passed both `Runtime Smoke` and `Build & Push` for the `v1.4.7` release commit. Prior stricter local `npm run docker:smoke -- --start` evidence built the trimmed image, launched full Chromium through Hydra's own persistent-context resolver, started the compose service, received HTTP `200`, and cleaned up compose resources. Direct post-build `ldd` reported no missing Chromium libraries. | Verified locally and by CI runtime smoke |
| Session probe log privacy | Runtime log inspection on 2026-05-20 showed historical `[SESSION_PROBE]` lines with account aliases and full Clerk session IDs. `server/services/session-refresher.js` now redacts probe aliases and session IDs while preserving account-id failure evidence, `server/tests/background-failure-visibility.test.mjs` locks the contract, and `hydra audit` tracks `session-probe-redaction`. | Source verified |
| Final dogfood evidence capture | `npm run dogfood:final -- --write-evidence` now writes a redacted `hydra.final-dogfood-evidence.v1` JSON artifact with explicit `--manual=<id>` confirmations. `server/tests/final-dogfood-evidence.test.mjs` locks that it records checklist status only and does not read local DB/cookies/secrets. | Source verified |
| Idle backend performance pass | PR #18 merged as master f74c195 and v1.0.9 includes delayed session/request-log startup sweeps, opt-in session-lifetime probe, relaxed task-supervisor sweep interval, and removed eager renderer live-probe fan-out from dashboard/vault/account-detail page load. CI, Electron package smoke, Docker, and release automation passed after merge. | Verified by CI/release |
| Splash/browser/router/renderer performance and efficiency pass | Current local performance pass makes splash graphics finite and throttled, keeps the front splash at 16s with a bounded 72-word unique irregular shower and a staged 3s accelerating portal orbit, one-shot guards parent shattering, removes the ceiling collider that overlapped fresh top-edge spawns, disables collision response only after portal entry, strengthens real/fallback tilt lean through gravity plus spawn/velocity bias, stops Matter/RAF/timers/listeners on unload or after the visual window, removes Hydra-owned Playwright temp profile dirs after browser automation, stops request-log flush wakeups when the queue is empty, converts renderer health/dashboard/vault/traffic/generator polling to non-overlapping one-shot timers, collapses bulk magic-link polling to one shared guarded poller, exposes `window.__HYDRA_RENDERER_DIAGNOSTICS__` for Hydra-owned timers/intervals/RAFs/Anime.js effects, and adds `hydra doctor` performance diagnostics for stale Hydra Playwright profiles plus Hydra-owned process CPU/RAM snapshots where the OS permits `ps`. `hydra doctor --clean-stale-profiles` moves stale Hydra-owned profile dirs to a timestamped temp backup and reports `deleted: 0`; `hydra doctor` now separates unrelated browser tooling into `otherBrowserToolProcesses` for fan-pressure context. | Source verified; local macOS arm64 runtime sampled; full GUI/live dogfood still deferred |
| Auto-version release dispatch | PR #19 merged as master 0b49f5a with `[skip-bump]`; Auto-version run 26238251024 skipped as intended, CI run 26238251136 passed, Docker run 26238251146 passed, and the workflow now dispatches `release.yml` after auto-version tags so future versions do not require manual rescue. The workflow now also supports deliberate `[bump:minor]` and `[bump:major]` release markers instead of forcing every shipped tranche through patch-only `1.0.x` bumps. | Source verified |

## Acceptance Snapshot — 2026-06-01

| # | Acceptance item | Current evidence | State |
| --- | --- | --- | --- |
| 1 | Five-minute idle CPU improvement or honest unmeasurable boundary | Fresh exact-public-`v1.1.4` profiling sampled the already-settled packaged app every 30 seconds for five minutes: four Hydra-owned processes and zero Hydra Playwright profiles throughout, `0.0-0.3%` instantaneous CPU (`0.03%` average, ending at `0.0%`), and `575.92 MB -> 577.41 MB` RSS (`+1.48 MiB`). A later independent recheck again kept four processes and zero profiles across all 11 samples, with `0.0-0.7%` CPU (`0.082%` average) and RSS falling from `592.53 MiB` to `553.19 MiB` (`-39.34 MiB`). The exact-public `v1.1.5` steady-dot repair repeated the same 11-sample no-interaction profile at `0.0-0.5%` CPU (`0.136%` average) with `+5.59 MiB` RSS drift. The fresh exact-public `v1.3.0` post-closeout pass retained four processes and zero profiles across all 11 samples at `0.0-0.4%` CPU (`0.091%` average, `33.2%` below the `v1.1.5` calm public baseline) with `604.80 MiB -> 606.66 MiB` RSS (`+1.86 MiB`). The exact-public `v1.4.0` post-closeout pass retained the same four-process PID set and zero profiles across all 11 samples at `0.0-0.1%` CPU (`0.064%` average, `53.2%` below the `v1.1.5` calm public baseline) with `600.36 MiB -> 593.58 MiB` RSS (`-6.78 MiB`). The post-release canonical `v1.4.6` profile under `/private/tmp/hydra-v146-post-release-readonly-idle-lwlq2dbC` retained the same four-process shape and zero profiles across 11 samples over `394` seconds at `0.0-0.1%` CPU (`0.009%` average, ending at `0.0%`) with `474.31 MB -> 487.17 MB` RSS (`+13484032` bytes). The exact-public `v1.4.7` post-closeout profile under `/private/tmp/hydra-v147-public-post-closeout-idle-profile-20260601T213205Z` captured a native `4 -> 0 -> 4` relaunch, then retained the same four settled PIDs and zero profiles across 11 samples at exactly `0.0%` aggregate CPU with `655867904 -> 626966528` bytes RSS (`-28901376`). | Verified |
| 2 | No orphan browser/helper processes after owning surface | Exact-public-`v1.1.5` LaunchServices relaunch evidence captured four owned processes before quit, zero after quit, one splash renderer during animation, and one replacement main renderer after teardown. The canonical `v1.4.6` post-release profile retained exactly four Hydra-owned processes and zero Hydra Playwright profiles throughout. The exact-public `v1.4.7` profile under `/private/tmp/hydra-v147-public-post-closeout-idle-profile-20260601T213205Z` repeats the native `4 -> 0 -> 4` lifecycle and preserves raw broad `ps -ax -o pid,ppid,stat,%cpu,%mem,rss,etime,command \| grep -iE 'chrome\|chromium\|playwright\|electron\|hydra'` snapshots before and after the soak plus owner-aware per-sample doctor JSON. | Verified |
| 3 | No runaway renderer/Matter/Anime/timer loops after unmount | Canonical `v1.4.6` packaged splash diagnostics report a bounded `72/72` shower, `0` duplicate skips, collision-free lifted portal entry, `timers=0`, `rafActive=false`, `bodyCount=0`, `dynamicBodyCount=0`, and Matter cleared after teardown. Exact-public-`v1.1.5` route instrumentation mounted Dashboard, Bulk OTP, Vault, Pool Manager, Redeem, Generator, Traffic, Settings, and Account Detail. Settled Settings and Account Detail each reported `0` intervals, `0` active RAFs, `0` Anime effects, and only the bounded `App.upstreamHealth` timeout. Account Detail's mount-only `ScrambleText.reveal` intervals and `AnimeText.scanline` effect cleared after the visual window. | Verified |
| 4 | `electron-updater` ESM import crash fixed; packaged smoke green | Default import/destructure source contract passes; public `v1.4.7` Release Desktop Apps run `26782121839` passed package smoke on Linux x64, macOS arm64, macOS Intel x64, and Windows x64 NSIS artifacts. | Verified |
| 5 | HIServices `SIGABRT` root-caused | Crash excerpt and LaunchServices-vs-direct-executable evidence are recorded below; packaged launch must use LaunchServices. | Verified |
| 6 | Touch ID controls visible and biometric path end-to-end | The exact public `v1.1.5` packaged app exposes `window.hydraNative`; native describe returned `{ available: true, platform: "darwin", label: "Touch ID" }`. The packaged Settings screenshot visibly renders `AVAILABLE`, the enabled `Require Touch ID when unlocking the vault` checkbox, and `Test Prompt`. Test Prompt approval, lock, and unlock still require the user's fingerprint. | Partial — hardware prompt dogfood required |
| 7 | Duplicate keychain prompts eliminated without weakening fail-closed behavior | Auth cookie/keychain source contracts isolate Chromium with `password-store=basic` / `--use-mock-keychain` and keep biometric release fail-closed. A fresh exact-public `v1.1.5` LaunchServices relaunch quit the old four-process tree to zero, opened the canonical app, settled to the expected four-process tree, and produced zero native `SecurityAgent`, Keychain, `CoreServicesUIAgent`, or authorization dialog windows during a 55-second CoreGraphics observation. | Verified |
| 8 | Per-task encrypted random account-proxy rotation | Settings/API encrypted storage, empty-list fallback, signup, browser redemption, HTTP redemption, and shared route reuse are covered by integration/contracts and measured dispatcher reuse. | Verified |
| 9 | README clean, navigable, no Remotion references; audit anchors match | README navigation and release docs are reconciled; `rg -n "Remotion\|remotion" README.md` returns no matches; CLI audit remains `31 ok / 5 deferred / 0 missing / 0 blockers`. | Verified |
| 10 | Every named long-running path measured or justified | Embedded server, proxy/router, automation, request-log buffering, health polling, and dashboard refresh are mapped with measurements below. | Verified |
| 11 | Final lint/test/gate/smoke/Docker/OpenAPI gates green | Public `v1.4.7` package proof passed local focused renderer/session tests, `npm run lint`, `npm run build`, `npm run test:dogfood-evidence` (`1/1`), `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, strict deep codesign, and embedded-source inspection. Public release run `26782121839` passed shared `test:ci`, lint, gate, and the cross-platform desktop matrix; CI run `26782110073` passed; Docker run `26782109931` passed runtime smoke and registry push. Post-release docs checkpoint `46b4bf1` also passed CI run `26783649083` and Docker build/push plus runtime-smoke run `26783649114`; Auto-version run `26783649079` skipped as intended. The final local literal chain now also passes in order: `npm run lint && npm test && npm run gate && HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke && npm run docker:smoke && npm run openapi:hydra`. | Verified |
| 12 | Final dogfood evidence refreshed with packaged-app screenshots | The exact public `v1.1.4` package has native-window captures for first-run Vault setup, Dashboard, Vault, Pool, Settings Touch ID, and a synthetic-data Traffic console, plus rendered privacy-safe CLI captures for `hydra status`, `hydra proxy status`, and a compact `hydra doctor --json` excerpt. The exact-public `v1.3.0` canonical app adds a native CoreGraphics Dashboard privacy proof with all content below the titlebar pixelated before check-in. OCR found zero credential-shaped or endpoint-shaped hits and ImageMagick reported nonblank color variance. Computer Use attached successfully to the exact-public `v1.4.7` bundle and verified Dashboard plus the repaired Account Detail actions; final redacted screenshot review remains explicit. | Partial — interactive human visual review required |

## Current Verified Evidence

- GitHub Actions run 26193855786 on PR #7 verified current packaged artifacts across target runners: macos-14 --mac zip --arm64 built Hydra-1.0.7-mac-arm64.zip with target=darwin-arm64 and packaged resource contract OK; macos-15-intel --mac zip --x64 copied chrome-mac-x64, built Hydra-1.0.7-mac-x64.zip with target=darwin-x64, verified libquery_engine-darwin.dylib.node, and ended electron:smoke with packaged resource contract OK; windows-latest --win nsis --x64 built Hydra-1.0.7-win-x64.exe with target=win32-x64 and packaged resource contract OK.

- GitHub release v1.0.9 published on 2026-05-21 after manual `release.yml` dispatch run 26237123866. Asset inspection verified `Hydra-1.0.9-mac-arm64.zip`, `Hydra-1.0.9-mac-arm64.zip.blockmap`, `Hydra-1.0.9-mac-x64.zip`, `Hydra-1.0.9-mac-x64.zip.blockmap`, `Hydra-1.0.9-win-x64.exe`, `Hydra-1.0.9-win-x64.exe.blockmap`, `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.

- GitHub release v1.0.10 published on 2026-05-21 after Auto-version run 26244056269 bumped package.json from 1.0.9 to 1.0.10 and dispatched Release Desktop Apps run 26244070167. The release workflow passed lint/test/gate plus Linux AppImage, macOS arm64 zip, Windows NSIS, macOS Intel zip, and merged macOS updater metadata. Asset inspection verified `Hydra-1.0.10-mac-arm64.zip`, `Hydra-1.0.10-mac-arm64.zip.blockmap`, `Hydra-1.0.10-mac-x64.zip`, `Hydra-1.0.10-mac-x64.zip.blockmap`, `Hydra-1.0.10-win-x64.exe`, `Hydra-1.0.10-win-x64.exe.blockmap`, `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.

- GitHub release v1.0.11 published on 2026-05-21 after the matter-js splash rebuild landed on master as 29476a7 and Auto-version bumped package metadata to 1.0.11. Release Desktop Apps run 26253083109 passed lint/test/gate plus Linux AppImage, macOS arm64 zip, Windows NSIS, macOS Intel zip, and merged macOS updater metadata. Asset inspection verified `Hydra-1.0.11-mac-arm64.zip`, `Hydra-1.0.11-mac-arm64.zip.blockmap`, `Hydra-1.0.11-mac-x64.zip`, `Hydra-1.0.11-mac-x64.zip.blockmap`, `Hydra-1.0.11-win-x64.exe`, `Hydra-1.0.11-win-x64.exe.blockmap`, `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.

- GitHub release v1.0.12 published on 2026-05-21. Asset inspection with `gh release view v1.0.12` verified `Hydra-1.0.12-mac-arm64.zip`, `Hydra-1.0.12-mac-arm64.zip.blockmap`, `Hydra-1.0.12-mac-x64.zip`, `Hydra-1.0.12-mac-x64.zip.blockmap`, `Hydra-1.0.12-win-x64.exe`, `Hydra-1.0.12-win-x64.exe.blockmap`, `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.

- v1.0.13 was superseded on 2026-05-21 after Release Desktop Apps run 26263856695 failed in `lint, test, gate` because `server/tests/final-dogfood-evidence.test.mjs` still expected the old literal `--version=1.0.11` dogfood runbook text. The source contract was corrected to accept the version-generic runbook example, `npm run test:dogfood-evidence` passed locally, follow-up CI run 26263952381 passed, and Docker run 26263952295 passed both Build & Push and Runtime Smoke.

- GitHub release v1.0.14 published on 2026-05-22 after Auto-version bumped package metadata to 1.0.14 from the dogfood contract fix. Release Desktop Apps run 26263959073 passed `lint, test, gate`, Windows x64 NSIS, Linux x64 AppImage, macOS arm64 zip, macOS Intel x64 zip, and merged macOS updater metadata. Asset inspection with `gh release view v1.0.14` verified `Hydra-1.0.14-mac-arm64.zip`, `Hydra-1.0.14-mac-arm64.zip.blockmap`, `Hydra-1.0.14-mac-x64.zip`, `Hydra-1.0.14-mac-x64.zip.blockmap`, `Hydra-1.0.14-win-x64.exe`, `Hydra-1.0.14-win-x64.exe.blockmap`, `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.

- GitHub release v1.0.17 published on 2026-05-22 from master `9fdafa67813977cc071043885fff8fdaca5a93b8`. Release Desktop Apps run 26282532092 completed successfully and asset inspection with `gh release view v1.0.17` verified `Hydra-1.0.17-mac-arm64.zip`, `Hydra-1.0.17-mac-arm64.zip.blockmap`, `Hydra-1.0.17-mac-x64.zip`, `Hydra-1.0.17-mac-x64.zip.blockmap`, `Hydra-1.0.17-win-x64.exe`, `Hydra-1.0.17-win-x64.exe.blockmap`, `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.

- v1.0.17 packaged startup bug found on 2026-05-26 during real macOS arm64 GUI launch from `/private/tmp/hydra-v1017-dogfood.P63LvH/extracted-mac-arm64/Hydra.app`. Startup error dialog reported: `Phase: whenReady-bootstrap`, `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dotenv' imported from .../Hydra.app/Contents/Resources/app/server/config.js`. Root cause: `server/config.js` imports `dotenv/config`, but `dotenv` was only present as a dev/optional transitive lockfile entry and was omitted from the production `node_modules` electron-builder shipped. Fix: promote `dotenv@^16.6.1` to production `dependencies` and harden `scripts/smoke-electron-package.mjs` so `electron:smoke` imports packaged `Resources/app/server/config.js` with production env before declaring the package valid. Regression evidence: `ELECTRON_APP_RESOURCES=/private/tmp/hydra-v1017-dogfood.P63LvH/extracted-mac-arm64/Hydra.app/Contents/Resources npm run electron:smoke` reproduced the same `ERR_MODULE_NOT_FOUND`; after rebuilding local macOS arm64 with `npm run electron:build:mac-arm64`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed and logged `[electron-smoke] packaged server config import OK`. The rebuilt app contains `Resources/app/node_modules/dotenv/package.json` version `16.6.1`. Verification for the fix passed: full `npm test`, `npm run test:workflow-contract`, `npm run test:dogfood-evidence`, `npm run lint`, `npm run gate`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, `npm run openapi:hydra`, and `git diff --check`.

- Rebuilt local macOS arm64 packaged GUI launch on 2026-05-26 used `node scripts/open-packaged-app.mjs release/mac-arm64/Hydra.app`; LaunchServices accepted the package, `pgrep` found `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app/Contents/MacOS/Hydra` plus GPU/network/renderer helpers, `hydra.log` recorded `[PINGER]`, `[RETENTION]`, `[AUTO-REFRESH]`, and `[POOL]` startup initialization at 12:15, and the user confirmed the packaged splash/falling animation looked beautiful. This verifies the missing-`dotenv` bootstrap crash is gone in the rebuilt local artifact and gives user-observed splash quality evidence. It still does not close full packaged GUI dogfood because app-control timed out on Hydra's accessibility tree and no complete route/window-control/live-flow pass was captured.

- 2026-05-26 performance research pass used primary/current docs before code changes: Electron's performance guide (`https://www.electronjs.org/docs/latest/tutorial/performance`) emphasizes repeated profiling, avoiding main-process blocking, and moving/defering CPU-heavy work; Electron BrowserWindow docs (`https://www.electronjs.org/docs/latest/api/browser-window`) document background throttling/Page Visibility behavior and recommend pausing expensive hidden work; Matter.js Runner docs (`https://brm.io/matter-js/docs/classes/Runner.html`) describe Runner as an optional browser game loop and explicitly allow direct `Engine.update` stepping when owning the loop; Playwright browser/context lifecycle docs (`https://playwright.dev/docs/api/class-browser`) reinforce explicit browser/context closure for owned automation. Changes below follow those rules: one owned splash frame loop, no hidden/idle animation loops, no duplicate cold pool loads, fewer dashboard DB passes, and less repeated proxy serialization.

- 2026-05-26 local engine/graphics performance patch, pre-release: splash now caps the canvas backing store at `2,800,000` pixels, removes Matter.Runner's separate RAF loop, steps `Engine.update()` inside Hydra's one owned RAF at 45 Hz with a two-step catch-up cap, paints at 30 fps, and still tears down timers, RAF, resize listeners, Matter bodies, and the engine via `disposeHydraSplash()` on unload or after 12.5 seconds. Renderer ambient chrome animations now settle after 12 seconds or immediately when the document is hidden. Dashboard now uses the already-hydrated `getAllAccountsWithKeys()` rows for metadata and display session status instead of issuing `store.getAccounts()` plus one `getStoredSessionStatusPayload()` DB read per account on the normal hot path. Vault status totals now read status from each iterated account instead of doing a nested `accounts.find()` during each filter pass. Bulk magic-link polling now batches completed rows behind one `api.getAccounts()` refresh instead of doing one account-list refresh per completed email. Proxy request body serialization now shallow-copies once, caches encoded bodies per request/fallback model, and avoids `JSON.parse(JSON.stringify(...))` inside retry attempts. Session refresher/probe DB scans now select only `id`, `userId`, `alias`, `config`, and `sessionToken`. Rotation manager cold loads are deduped by `_loadPromise` so concurrent first proxy requests do not start/abort duplicate reloads. Request-log buffer shutdown now clears its one-shot timer with `clearTimeout()`.

- 2026-05-26 measured local hot-path evidence: dashboard metadata/status shaping on the local DB (`13` accounts, `40` measured rounds after `5` warmups) improved from `oldAvgMs=4.479` / `oldMedianMs=4.360` to `newAvgMs=1.741` / `newMedianMs=1.697`, a `61.1%` reduction. Proxy body encoding synthetic retry benchmark (`120,658` byte chat body, `3` attempts/request, `1000` requests) improved from `253.200ms` to `33.222ms`, an `86.9%` reduction. Vault status-total synthetic render benchmark (`5000` accounts, `50` rounds) improved from `oldAvgMs=60.892` / `oldMedianMs=60.694` to `newAvgMs=2.430` / `newMedianMs=2.395`, a `96.0%` reduction with matching checksums. Session refresher selected-column scan benchmark (`13` accounts, `100` rounds) improved from `0.364ms` full row reads to `0.315ms` selected reads, a `13.4%` reduction; this is small but positive and trims encrypted/local fields the sweep does not use. Focused verification passed: `node --test electron/tests/main-process.test.mjs server/tests/ui-static-contract.test.mjs server/tests/background-failure-visibility.test.mjs` (`79` tests), `node --test server/tests/background-failure-visibility.test.mjs server/tests/proxy-gate.test.mjs` (`28` tests), `npm run lint`, `npm run build`, `npm run electron:build:mac-arm64`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `git diff --check`. Final current-source verification after the `ScrambleText` cleanup also passed: `npm run lint`, full `npm test`, `npm run gate`, `npm run openapi:hydra`, `npm run electron:build:mac-arm64`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `git diff --check`.

- 2026-05-26 icon refresh: `scripts/generate-hydra-source-icon.mjs` now generates the source 1024px `public/hydra_dragon.png` and matching `public/favicon.svg`; `npm run icons:generate` then regenerates Linux `desktop/icons/icon.png`, Windows `desktop/icons/icon.ico`, and macOS `desktop/icons/icon.icns` from that source. The new mark is a cleaner neon Hydra badge with a readable `H` silhouette for Dock/taskbar scale instead of the previous high-detail raster dragon, reducing small-size visual noise while keeping the cyan/magenta identity. Regeneration evidence: `npm run icons:generate` passed and wrote the 512px PNG, six-size ICO, and ICNS iconset. Package evidence: after `npm run electron:build:mac-arm64`, `cmp -s desktop/icons/icon.icns release/mac-arm64/Hydra.app/Contents/Resources/icon.icns` returned `0`, proving the packaged macOS app contains the regenerated ICNS. Relaunch evidence: `npm run electron:open:mac-arm64` handed the rebuilt package to LaunchServices, `codesign --verify` passed, and the post-splash `t+50s` sample showed Hydra main, GPU, network, and renderer helpers all at `0.0%` CPU with RSS approximately `193488`, `113232`, `52416`, and `117792` KB respectively. A second requested relaunch against the same rebuilt package also passed LaunchServices/codesign; at `t+50s`, Hydra main, GPU, network, and renderer helpers were again all `0.0%` CPU with RSS approximately `209632`, `126592`, `52704`, and `129104` KB respectively.

- 2026-05-26 follow-up profiling pass against the running packaged `v1.0.19` app sampled Hydra main, GPU, network, and renderer helpers at `0.0%` CPU after `02:48` elapsed, with RSS approximately `164208`, `90544`, `51088`, and `107008` KB respectively. The broad process grep still showed heavy non-Hydra Chrome activity, including the user's main Google Chrome process at `64.6%` CPU and Chrome GPU helper at `10.4%` CPU; those processes were not Hydra-owned and were left untouched. Source timer sweep converted five short-lived renderer feedback timers into owned cleanup paths: `CreateKeyModal` copy reset, Account Detail copied-key reset, Account Detail key-test status expiry, Settings copy reset, and Code Redemption post-run history refresh. This is primarily an unmount-safety fix for acceptance item 3, not an idle CPU win, because these timers only exist after direct user actions. Follow-up relaunch evidence: `npm run electron:open:mac-arm64` handed the rebuilt package to LaunchServices, and the post-splash `t+50s` sample showed Hydra main, GPU, network, and renderer helpers all at `0.0%` CPU with RSS approximately `193632`, `116384`, `52320`, and `128928` KB respectively. Verification passed: full `npm test`, `npm run test:ui-static` with the new `short-lived renderer feedback timers are cleared on unmount` contract, `npm run lint`, `npm run gate`, `npm run openapi:hydra`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `git diff --check`.

- 2026-05-26 process-diagnostics/runtime cleanup pass: `node bin/hydra.mjs doctor --json --clean-stale-profiles` moved 9 stale `hydra-pw-profile-*` dirs, all `0 B`, into `/var/folders/jp/srqsp2ts3rv7qxvsdx4s1n480000gn/T/hydra-profile-cleanups/cleanup-2026-05-26T20-56-06-480Z` with `deleted: 0`, and a follow-up doctor run reported `hydraPlaywrightProfiles.count: 0`. Packaged macOS arm64 relaunch via `npm run electron:open:mac-arm64` handed the rebuilt app to LaunchServices. The pre-launch broad browser/tool grep counted 343 matches with an empty Hydra-owned subset; at splash-active `t+8s` it counted the Hydra main process plus GPU/network/renderer helpers, with GPU and renderer doing the expected splash work; at `t+25s` and `t+300s`, the sampler found no Hydra-owned process remaining. The stricter `hydra doctor --json` classifier then reported `hydraProcesses.count: 0`, `totalCpuPercent: 0`, `totalRss: 0 B`, while separately reporting 329 unrelated browser-tool processes using `86.7%` CPU and `15.49 GB` RSS, led by the user's main Google Chrome process. This verifies the fan-pressure diagnostic can now distinguish Hydra-owned work from unrelated Chrome/CDP/browser-tool load and that this launch did not leak a Hydra-owned helper after exit; it is not a full GUI route dogfood claim.

- 2026-05-26 five-minute packaged idle profile and splash density follow-up: `/private/tmp/hydra-profile-20260526T213336Z` contains exact `ps -ax -o pid,ppid,stat,%cpu,%mem,rss,etime,command | grep -iE 'chrome|chromium|playwright|electron|hydra'` snapshots before launch, at `t+8s`, at `t+25s`, and at `t+300s`, plus Hydra-owned subsets and `hydra doctor --json` reports. Summary: before launch the corrected doctor later reported `hydraProcesses.count: 0`; splash-active showed expected visual load (`hydraCpuPercent: 217.4`, `hydraRss: 617.55 MB`); post-splash fell to `4.0%` / `421.13 MB`; five-minute idle was `0.6%` / `388.14 MB` while unrelated browser tooling was still `97.3%` CPU / `15.64 GB` RSS. The first doctor summary overcounted one profiler shell as Hydra because its awk pattern mentioned `hydra-pw-profile-*`; `bin/hydra.mjs` now requires a browser-like executable token before treating a `hydra-pw-profile-*` command line as Hydra-owned browser automation. Re-check after quitting the profiled app reported `hydraProcesses.count: 0`, `totalCpuPercent: 0`, `totalRss: 0 B`, and `hydraPlaywrightProfiles.count: 0`, with unrelated browser tooling still separated. Splash UX changes for the next package: `SPLASH_MIN_VISIBLE_MS` is now `12000`, the progress bar is 12s, the fall phase lasts until the exit flip at `10000ms`, `HYDRA_SPLASH_TARGET` is 92 words (+15% from 80), self-dispose is `14500ms`, and `window.__HYDRA_SPLASH_DIAGNOSTICS__` tracks timers, RAF, body counts, render frames, physics steps, Matter cleanup, and tilt source. Local tilt probing (`ioreg -r -c AppleSMCMotionSensor` and `system_profiler SPMotionSensorDataType`) returned no motion-sensor data on this Mac, so real laptop-tilt gravity is event-gated behind `deviceorientation`/`devicemotion` when the runtime exposes it and otherwise falls back to a tiny randomized side lean. Verification so far: `node --check electron/app/windows.js`, `node --check electron/main.js`, `node --check bin/hydra.mjs`, `npm run test:electron-main-process`, `npm run test:ui-static`, `npm run test:cli`, and direct `node bin/hydra.mjs doctor --json`.

- 2026-05-26 final packaged splash/runtime verification: after the deterministic splash-dispose change, final source verification passed `npm run lint`, full `npm test`, `npm run openapi:hydra`, `npm run gate`, `node --check electron/app/windows.js`, `node --check electron/main.js`, focused `npm run test:electron-main-process`, and `git diff --check`. The rebuilt package passed `npm run electron:build:mac-arm64`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app`. Packaged-source inspection verified `SPLASH_MIN_VISIBLE_MS = 12000`, `HYDRA_SPLASH_TARGET=92`, `window.__HYDRA_DISPOSE_SPLASH__`, direct `splashDiagnostics` return logging, and the `hydra-splash-diagnostics` IPC fallback inside `release/mac-arm64/Hydra.app/Contents/Resources/app/electron`. Relaunch via `npm run electron:open:mac-arm64` handed PID `76236` to LaunchServices; after splash dismissal, `node bin/hydra.mjs doctor --json` reported `hydraProcesses.count: 4`, `totalCpuPercent: 0`, `totalRss: 582.31 MB`, `hydraPlaywrightProfiles.count: 0`, while `otherBrowserToolProcesses` separately reported unrelated Chrome/CDP load. The Electron main log at `~/Library/Logs/Hydra/main.log` recorded `[hydra-splash] diagnostics` with `durationMs:12000`, `exitMs:10000`, `target:92`, `timers:0`, `rafActive:false`, `disposeReason:"main-destroy"`, `renderFrames:299`, `physicsSteps:518`, `matterCleared:true`, and fallback tilt gravity `0.035`, proving the splash Matter world/RAF/timers/listeners are torn down before the main window takes over.

- 2026-05-27 splash tilt follow-up: the already-landed density pass keeps the requested 12s splash and 92-word target (+15% over the prior 80-word runtime). The tilt path now tries Chromium Generic Sensor support (`window.GravitySensor || window.Accelerometer`) in addition to `deviceorientation` and `devicemotion`, records `tilt.sensorApi` / `tilt.error` in `window.__HYDRA_SPLASH_DIAGNOSTICS__`, and stops the sensor instance during deterministic splash disposal. Local Mac probes still returned no `AppleSMCMotionSensor` data, so this machine can only verify the fallback path. `docs/SPLASH_TILT_RESEARCH.md` records the boundary: real left/right lean is cleanly sensor-gated; exact MacBook lid-angle requires a separate native HID bridge and hardware/model checks. Verification passed: `node --check electron/app/windows.js`, `npm run test:ui-static`, and `npm run test:electron-main-process`.

- 2026-05-27 continuation evidence: `/private/tmp/hydra-profile-20260527T025801Z` contains a five-minute packaged idle profile for LaunchServices PID `76236`. The before snapshot at `09:34` elapsed showed the four Hydra-owned processes at `0.1%` CPU / `405.88 MB` RSS and three empty stale `hydra-pw-profile-*` dirs; the after snapshot at `14:35` elapsed showed Hydra at `0.0%` CPU / `401.22 MB` RSS and `hydraPlaywrightProfiles.count: 0`. During the pass, `node bin/hydra.mjs doctor --json --clean-stale-profiles` moved nine empty Hydra-owned profile dirs into `/var/folders/jp/srqsp2ts3rv7qxvsdx4s1n480000gn/T/hydra-profile-cleanups/cleanup-2026-05-27T03-01-57-567Z` with `deleted: 0`, and a follow-up `find ... -name 'hydra-pw-profile-*'` returned no remaining profile dirs. Unrelated browser tooling stayed separated from Hydra: the after doctor report still showed non-Hydra Chrome/CDP at `126.8%` CPU / `17.02 GB` RSS, led by the user's Google Chrome process and `chrome-devtools-mcp`; those were not closed. Test hygiene fix: `server/tests/playwright-isolation.test.mjs` now cleans the profile dirs created by its default launch-option checks and its packaged-child Chromium probe, and a clean rerun of `npm run test:browser-isolation` left no `hydra-pw-profile-*` dirs behind. Auth/session fix: `src/api.js` now awaits `clearToken()` on protected-route `401` before reloading, so the packaged renderer cannot reload while a stale native Electron unlock token is still being cleared. Verification passed: `npm run test:electron-data-path`, `node --experimental-test-module-mocks --test server/tests/auth-cookie.test.mjs server/tests/session-refresh-contract.test.mjs server/tests/session-expiry-effective.test.mjs server/tests/electron-api-integration.test.mjs`, `npm run test:browser-isolation`, full `npm test`, `npm run lint`, `npm run build`, `npm run gate`, `npm run openapi:hydra`, and `git diff --check`.

- 2026-05-27 second five-minute idle profile, no relaunch: `/private/tmp/hydra-profile-20260527T031058Z-continuation` sampled the already-running packaged LaunchServices PID `76236` from `22:33` to `27:34` elapsed without closing the user's unrelated sessions. `hydra doctor --json` reported the same four Hydra-owned processes at `0.0%` CPU both before and after, with RSS dropping from `423.23 MB` to `414.91 MB` and `hydraPlaywrightProfiles.count: 0` throughout. The broad non-Hydra browser/tool bucket remained separate and heavy (`101.7%` CPU / `16.67 GB` RSS before, `98.5%` CPU / `16.02 GB` RSS after), confirming the fan-pressure suspects are still mostly outside Hydra while Hydra is idle. This is idle/runtime evidence for the existing running package; the new Generic Sensor splash source still needs a package rebuild/relaunch before it can be claimed as packaged evidence.

- 2026-05-27 third five-minute idle profile, no relaunch: `/private/tmp/hydra-profile-20260527T033124Z-goal-continuation` sampled the same already-running packaged LaunchServices PID `76236` from `42:57` to `47:57` elapsed without closing unrelated sessions. `hydra doctor --json` reported four Hydra-owned processes at `0.1%` CPU both before and after, with RSS dropping from `421.53 MB` to `399.09 MB` and `hydraPlaywrightProfiles.count: 0` throughout. The separated non-Hydra browser-tool bucket remained the real fan-pressure source (`109.6%` CPU / `14.09 GB` RSS before, `165.4%` CPU / `7.96 GB` RSS after). This is still evidence for the older running package, not the newest source-only renderer diagnostics or splash-tilt refinement.

- 2026-05-27 fourth five-minute idle profile, no relaunch: `/private/tmp/hydra-profile-20260527T041356Z-post-dddb558` sampled the already-running packaged `release/mac-arm64/Hydra.app` from `04:13:56Z` to `04:18:59Z` without closing or relaunching any user sessions. `hydra doctor --json` reported four Hydra-owned processes at `0.2%` CPU before and after, with RSS dropping from `402.78 MB` to `367.83 MB` and `hydraPlaywrightProfiles.count: 0` throughout. The separated non-Hydra browser/tool bucket remained heavy and intentionally untouched (`88%` CPU / `11.35 GB` RSS before, `81%` CPU / `13.80 GB` RSS after). Full `ps` and `top` before/after snapshots are in the profile directory. This confirms the already-running package remained idle and orphan-free for Hydra-owned profiles; it does not prove the newest source-only task-supervisor and magic-link cleanup timer changes inside a rebuilt package until rebuild/relaunch.

- 2026-05-27 fresh no-relaunch idle profile after the model-list cache commit: `/private/tmp/hydra-profile-20260527T174343Z-fresh-current` sampled the already-running packaged `release/mac-arm64/Hydra.app` from `17:43:43Z` to `17:51:12Z` without closing the existing Hydra session. `hydra doctor --json` reported four Hydra-owned processes at `0.0%` CPU before and after, with RSS dropping from `298.69 MB` to `277.45 MB` and `hydraPlaywrightProfiles.count: 0` throughout. The separated non-Hydra browser/tool bucket remained the larger system load (`74.7%` CPU / `13.98 GB` RSS before, `86.4%` CPU / `15.06 GB` RSS after). Full `ps`, `top`, doctor before/after JSON, and `summary.json` are in the profile directory. This is honest idle evidence for the already-running packaged app and confirms Hydra-owned idle pressure remained near zero; it is not a rebuilt-current-source GUI launch because the user asked not to close the open app session.

- 2026-05-27 follow-up five-minute idle profile after the Pool Manager model-cache source pass: `/private/tmp/hydra-profile-20260527T175641Z-goal-item1` sampled the already-running packaged `release/mac-arm64/Hydra.app` from `17:56:41Z` to `18:01:46Z` without closing or relaunching the existing app session. `summary.json` reports four Hydra-owned processes at `0.0%` CPU before and after, RSS dropping from `278.92 MB` to `249.23 MB`, and `hydraPlaywrightProfiles.count: 0` throughout. The separated non-Hydra browser/tool bucket remained outside Hydra and heavy (`83.9%` CPU / `13.32 GB` RSS before, `88.3%` CPU / `13.33 GB` RSS after). Full before/after `ps -ax | grep -iE 'chrome|chromium|playwright|electron|hydra'` output is preserved as `ps-grep-before.txt` (`342` lines) and `ps-grep-after.txt` (`339` lines), with `top` and doctor before/after snapshots in the same directory. This is another honest no-relaunch idle/process sample; it does not claim rebuilt-current-source packaged GUI dogfood.

- 2026-05-27 packaged-window screenshot capture, partial only: Computer Use failed to attach to the running packaged app by both app name and exact path, timing out after `120s` each, and System Events could list the Hydra process but failed window-level access with `osascript is not allowed assistive access`. A CoreGraphics window enumeration still found the packaged app dashboard window (`CGWindowID 31589`, owner `Hydra`, title `Hydra — Dashboard`, bounds `1440x900 @ 36,34`), and `screencapture -l 31589` captured only that Electron window. The raw capture contained local account aliases/emails, so it was not committed; ImageMagick redacted account panels into `docs/evidence/hydra-packaged-dashboard-20260527T183013Z-redacted.png` (`sha256 05a5b416c73edf9c1278e8d5ad562552733cb6f6d41c4c2512f45e386d9db076`). This proves the packaged-app screenshot capture path without browser substitution, but the full packaged screenshot audit remains deferred because only Dashboard was captured and GUI route control is still blocked by the app-control permissions above.

- 2026-05-27 follow-up no-relaunch idle profile after the packaged screenshot and automation-network pass: `/private/tmp/hydra-profile-20260527T183654Z-seek-improvement` sampled the already-running packaged `release/mac-arm64/Hydra.app` from `18:36:54Z` to `18:41:58Z`. Corrected `summary.json` reports four Hydra-owned processes at `0.0%` CPU / `250.31 MB` RSS before and `0.5%` CPU / `256.70 MB` RSS after, with `hydraPlaywrightProfiles.count: 0` throughout. The non-Hydra browser/tool bucket remained separate (`99.4%` CPU / `14.11 GB` RSS before, `97.2%` CPU / `13.44 GB` RSS after). The profile directory preserves full before/after process greps (`346` and `345` lines), `top`, and doctor JSON. This is another honest already-running-package sample, not a rebuilt-current-source packaged GUI launch.

- 2026-05-27 fresh no-relaunch idle profile after the automation-route commit: `/private/tmp/hydra-profile-20260527T185734Z-fresh-goal-item1` sampled the already-running packaged `release/mac-arm64/Hydra.app` from `18:57:34Z` to `19:02:38Z` with no UI interaction and without closing/relaunching the existing app. `summary.json` reports four Hydra-owned processes at `0.0%` CPU before and after, RSS dropping from `248.41 MB` to `205.78 MB`, and `hydraPlaywrightProfiles.count: 0` throughout. Full `ps -ax -o pid,ppid,stat,%cpu,%mem,rss,etime,command | grep -iE 'chrome|chromium|playwright|electron|hydra'` snapshots are preserved as `ps-grep-before.txt` (`344` process rows after the header) and `ps-grep-after.txt` (`346` rows after the header); parsed broad process totals show non-Hydra browser/tooling at `95.9%` CPU / `12.97 GB` RSS before and `248.6%` CPU / `13.66 GB` RSS after, while Hydra's own rows remained `0.0%` CPU. This again supports acceptance item 1/2 for the already-running package but is not rebuilt-current-source GUI evidence.

- 2026-05-30 resumed five-minute no-relaunch profile after the visible-only renderer refresh source pass: `/private/tmp/hydra-profile-20260531T031156Z-visible-timers-resume` sampled the existing packaged `v1.0.20` session from `03:11:56Z` to `03:16:56Z` without closing or relaunching Hydra. The resumed workspace sandbox denied direct process enumeration: `ps` and `top` both returned `operation not permitted`, while `hydra doctor --json` recorded `performance.hydraProcesses.unavailable=true` with reason `spawnSync ps EPERM` before and after. The same doctor snapshots still verified `hydraPlaywrightProfiles.count: 0`, `totalBytes: 0`, and `error: null` throughout. The profile directory preserves the attempted `ps`, `top`, doctor, stderr, and `summary.json` artifacts. This is an honest unmeasurable-here process-profile finding for the resumed sandbox, not a replacement for the earlier unrestricted before/after `ps` evidence or rebuilt-current-source GUI dogfood.

- 2026-05-30 duplicate Desktop bundle cleanup: targeted `find /Users/zaydk/Desktop -maxdepth 5 -type d -name 'Hydra.app'` found three launchable bundles under the repo: ignored top-level `Hydra.app` (`1.0.20`), canonical `release/mac-arm64/Hydra.app` (`1.0.20`), and stale Intel `release/mac/Hydra.app` (`1.0.7`). To prevent launching stale splash code, the extra top-level app, stale Intel extracted bundle, and superseded release installers were moved reversibly to `/private/tmp/hydra-desktop-duplicates-20260531T031455Z`; no files were deleted. A repeat Desktop scan returned exactly one launchable bundle: `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`. The current ARM zip and blockmap remain under `release/` for package smoke and rebuild verification.

- 2026-05-27 renderer runtime diagnostics follow-up: `src/lib/runtimeDiagnostics.js` now exposes `window.__HYDRA_RENDERER_DIAGNOSTICS__()` with active counts by owner for Hydra-owned timeouts, intervals, animation frames, and Anime.js effects. Renderer code no longer calls raw `setTimeout`, `setInterval`, or `requestAnimationFrame` directly outside that diagnostics module: app toasts, ambient-motion settling, upstream health, dashboard metrics, traffic, vault refresh, generator status/heartbeat, bulk magic-link polling/send delays, pool proxy timeout, settings hash/copy feedback, account-detail transient status, code redemption debounce/history refresh, OtpTab export-copy feedback, ScrambleText, and AnimeText now go through tracked wrappers or `useOwnedTimeouts(owner)`. A direct source sweep verified `rg -n "setTimeout\\(|clearTimeout\\(|setInterval\\(|clearInterval\\(|requestAnimationFrame\\(|cancelAnimationFrame\\(" src --glob '!src/lib/runtimeDiagnostics.js' --glob '!**/*.min.js'` returns no matches. Verification passed: `npm run test:ui-static`, `npm run lint`, `npm run build`, full `npm test`, `npm run gate`, `npm run openapi:hydra`, and `git diff --check`. This is source/bundle evidence; packaged runtime diagnostics still need rebuild/relaunch before they count as GUI evidence.

- 2026-05-27 splash density/tilt refinement: the front splash remains `SPLASH_MIN_VISIBLE_MS = 12000` with `HYDRA_SPLASH_TARGET=92` (+15% over the prior 80-word runtime). The tilt path now applies the sensor/fallback x value to horizontal gravity, spawn-position bias (`W() * 0.18`), and initial word x velocity, then smooths the gravity value each frame so the pile leans and packs toward the lower side instead of simply drifting after spawn. Static contracts now lock the denser duration/target and the stronger lean wiring. This is source evidence until the macOS package is rebuilt and relaunched.

- 2026-05-27 versioning documentation/update: `docs/VERSIONING.md` now defines Hydra's patch/minor/major rules, documents why incremental performance-work commits remain `[skip-bump]`, and records that the final performance/splash/runtime-diagnostics tranche should ship as a minor release (`1.1.0` if package metadata remains in the `1.0.x` lane). The auto-version workflow now honors `[bump:minor]` and `[bump:major]` commit markers while preserving the old catch-up behavior for manually advanced package versions without tags. `README.md` links the versioning policy from the release gates section, and `server/tests/workflow-contract.test.mjs` locks the minor/major workflow behavior.

- 2026-05-27 redirected-package-output finding: a safety build into `/private/tmp/hydra-package-bf10e28-20260527T034840Z` exposed that `electron-builder` could copy stale `release/mac/Hydra.app` output into `Resources/app/release/...` when the output directory is redirected outside the repo `release/` directory. Codesign then failed on the nested stale app bundle. Fix: `electron-builder.yml` now explicitly excludes `!release/**`, and `server/tests/workflow-contract.test.mjs` locks that packaged apps cannot embed previous distributables when output is redirected. Follow-up build into `/private/tmp/hydra-package-bf10e28-fixed-20260527T035132Z` succeeded, `ELECTRON_APP_RESOURCES=... npm run electron:smoke` passed, `test ! -e .../Resources/app/release` confirmed no nested app/release directory, packaged source inspection found `HYDRA_SPLASH_TARGET=92`, `tiltBias=hydraSplashTiltGravityX*(W()*0.18)`, `hydraSplashLeanX`, and `__HYDRA_RENDERER_DIAGNOSTICS__`, and `codesign --verify --deep --strict --verbose=2` reported the temp app valid on disk. This protects both local temp-build verification and future release hygiene.

- 2026-05-27 dogfood/version evidence docs follow-up: `docs/FINAL_DOGFOOD_EVIDENCE.md` now summarizes the current 2026-05-27 performance, cleanup, renderer diagnostics, splash density/tilt, and temp-package hygiene evidence instead of only the older 2026-05-26 baseline. `docs/VERSIONING.md` now explicitly documents why the current coherent performance/UX tranche should ship as `1.1.0` via `[bump:minor]`, while interim source/doc/test checkpoints continue to use `[skip-bump]` and remain pushed to `origin/master`. `README.md` now links the versioning, splash tilt, and release audit docs from the release gate section so the release train and tilt mechanics are discoverable without opening every doc.

- 2026-05-27 health-pinger idle/shutdown follow-up: the OpenRouter key-health worker no longer uses a permanent `setInterval`; it schedules one unref'd `setTimeout` at a time, waits until the startup delay before the first ping, reschedules only after the previous ping finishes, and aborts/awaits any in-flight fetch during graceful shutdown. `gracefulShutdown()` now cancels rotation-manager reloads before awaiting `stopPinger()`, so an in-flight pinger cannot keep shutdown stuck behind a background pool reload. Source contracts lock the startup-delay env controls, one-shot timer, abort-on-stop, and no-`setInterval` behavior.

- 2026-05-27 request-log-retention idle follow-up: the RequestLog retention worker now follows the same one-shot scheduling pattern. It keeps the quiet startup delay, prunes once, schedules the next prune only after the previous prune finishes, and clears timeout-based startup/repeat handles during shutdown. This removes another fixed server-side interval from idle Hydra while preserving bounded retention cleanup and stop-time waiting for in-flight DB work.

- 2026-05-27 session-refresher timer follow-up: the six-hour Clerk session refresher no longer keeps a fixed `setInterval`. It preserves the five-minute quiet startup delay, runs one refresh sweep, schedules the next sweep only after the previous sweep resolves, and clears timeout handles on stop. The in-flight sweep promise now resets after completion while `stopSessionRefresher()` still awaits any active sweep, so shutdown keeps the previous DB-write safety without leaving a stale promise or interval behind.

- 2026-05-27 task-supervisor timer follow-up: task expiry sweeps no longer run from a permanent `setInterval`. `TaskSupervisor` now schedules one unref'd timeout, starts the next expiry pass only after the previous `expireTasks()` promise settles, and awaits any active expiry sweep during shutdown before rejecting queued work and cancelling active tasks. This removes another always-on server wakeup while keeping expired-task cleanup and shutdown resource-release behavior explicit.

- 2026-05-27 task-supervisor shutdown-timeout follow-up: the shutdown cancellation cap no longer leaves a bare `setTimeout` alive after fast task cleanup wins the `Promise.race`. `withClearedTimeout()` unrefs the cap timer and clears it in `finally`, so normal graceful shutdown cannot keep the Node process alive for the full five-second safety window after cleanup has already completed.

- 2026-05-27 magic-link cleanup timer follow-up: pending magic-link cleanup no longer starts a minute-by-minute interval at server boot. `trackPendingMagicLink()` records a pending sign-in and schedules a single unref'd timeout for the next expiry; when there are no pending magic links, there is no cleanup timer. Startup still calls `startMagicLinkCleanup()`, but idle Hydra now does zero magic-link cleanup wakeups until a real magic-link flow creates work.

- 2026-05-27 streaming proxy first-byte follow-up: SSE/chat streaming no longer awaits the `RequestLog` placeholder DB create before calling `forwardSseStream()`. The placeholder write starts in parallel as `requestLogPromise`, the stream begins forwarding immediately after upstream headers/body are ready, and final usage/latency logging waits for the placeholder only after forwarding settles. This removes one Prisma write from the streaming pre-first-byte path while preserving final request-log updates. Synthetic timing probe with a 5ms placeholder-write delay (`200` rounds) reduced pre-forward wait from `6.237ms` average / `6.208ms` median / `8.022ms` p95 to `0.026ms` average / `0.020ms` median / `0.065ms` p95, a `99.6%` reduction in this isolated pre-forward gate.

- 2026-05-27 traffic backend query follow-up: `/api/pool/traffic` now runs the latest-100 `RequestLog.findMany()` and 24h `RequestLog.groupBy()` in one `Promise.all()` because the two reads are independent. This reduces Traffic refresh latency to the slower query instead of the sum of both. Local SQLite/Prisma probe on the current dev DB (`50` rounds) improved from `0.231ms` average / `0.224ms` median / `0.348ms` p95 sequential to `0.174ms` average / `0.157ms` median / `0.248ms` p95 parallel, a `24.7%` reduction on this small local dataset. Synthetic timing probe with 8ms log-read and 11ms metrics-read delays (`200` rounds) reduced the combined wait from `22.273ms` average / `22.133ms` median / `23.542ms` p95 to `11.354ms` average / `11.342ms` median / `12.079ms` p95, a `49.0%` reduction in the isolated query-composition gate.

- 2026-05-27 model-list cache follow-up: `/v1/models` and `/v1/free/models` now read OpenAI-style cached model rows through `getCachedClientModels()`, a 30-second in-process cache that clears whenever `upsertModelsFromUpstream()` refreshes the SQLite table. This removes repeated `CachedModel.findMany()` calls from SDK model-list probes while keeping refresh invalidation explicit. Local SQLite/Prisma timing on the current dev DB (`372` cached models, `100` rounds) improved from `0.976ms` average / `0.943ms` median / `1.281ms` p95 for cold DB-backed reads to `0.0003ms` average / `0.0002ms` median / `0.0004ms` p95 for warm in-process reads.

- 2026-05-27 Pool Manager model-list cache follow-up: `/api/pool/models` now reads the same cached-model table through `getCachedPoolModels()`, a 30-second in-process cache that is cleared by the same `clearClientModelCache()` invalidation path after upstream model refreshes. This removes repeated `CachedModel.findMany()` work from Pool Manager model-picker refreshes while preserving sorted `{ id, name, ctx }` output. Baseline direct Prisma timing on the current dev DB (`372` cached models, `200` rounds) averaged `0.856ms` with `0.813ms` median and `1.122ms` p95. The post-change probe measured direct reads at `1.548ms` average / `1.457ms` median / `2.704ms` p95 in the same run, and warm `getCachedPoolModels()` reads at `0.000419ms` average / `0.000209ms` median / `0.001083ms` p95, a `99.973%` average reduction for repeated Pool Manager model-list reads after the one cold cache fill.

- 2026-05-27 automation network cohesion follow-up: Playwright and non-Playwright OpenRouter automation now share `server/services/automation-network.js`, which chooses one route per task: `account-proxy` when the encrypted account proxy pool returns a proxy, or explicit `direct-localhost` when the pool is empty. The same route feeds Server Action, tRPC, REST, and Playwright fallback paths for management-key creation, code redemption, API-key sync, and signup fallback. When direct, Chromium launches with `--no-proxy-server`; when proxied, Playwright receives the same account proxy plus a `localhost,127.0.0.1,::1` bypass so local Hydra/loopback traffic stays direct. The route object also reuses one undici `ProxyAgent` across the task's HTTP probes instead of allocating a dispatcher per request. Local dispatcher setup benchmark (`1000` rounds) reduced repeated HTTP-probe option setup from `33.231ms` when constructing a new `ProxyAgent` each time to `0.141ms` with route reuse, a `99.576%` setup-overhead reduction. Verification passed: `node --check server/services/automation-network.js`, `node --check server/services/account-generator.js`, `node --check server/services/dashboard-api.js`, `npm run test:account-proxy-pool`, and `npm run test:background-failure-visibility`.
- 2026-06-01 account-proxy acceptance recheck: direct source inspection reconfirmed that one random `automationRoute` is selected per task and reused by signup, Server Action redemption, cached and candidate tRPC redemption, REST redemption probes, and Playwright redemption fallback. `npm run test:account-proxy-pool` passed `5/5`; `npm run test:background-failure-visibility` passed `33/33`; real Express integration passed `10/10`; renderer static coverage passed `46/46`; lint, production build, diff hygiene, and dogfood-evidence validation passed. Settings copy now names both direct HTTPS and browser fallback redemption coverage instead of understating the non-browser route, and `server/tests/ui-static-contract.test.mjs` locks the wording. The read-only post-copy profile under `/private/tmp/hydra-v147-post-proxy-copy-profile-20260601T230014Z` sampled the still-installed exact-public `v1.4.7` package 11 times at 30-second intervals: four Hydra-owned processes and zero stale profiles throughout, `0.0-0.3%` CPU (`0.036%` average, `0.0%` end), and `513490944 -> 513835008` bytes RSS (`+344064`). This is conservative running-package no-regression evidence; the copy-only source patch is not claimed as released.
- 2026-06-01 README proxy-coverage reconciliation: the public highlight and Desktop App operator note now state that the encrypted pool selects one random route per task and reuses it across direct HTTPS probes and browser fallback. `bin/commands/audit.js` requires those phrases in addition to the existing navigation, badge, Touch ID, 24-hour unlock, versioning, screenshot-secrecy, and no-Remotion anchors. `rg -n "Remotion|remotion" README.md` returned no matches; focused `hydra audit` CLI tests passed `2/2`; lint, production build, dogfood-evidence validation, and diff hygiene passed. The read-only post-change profile under `/private/tmp/hydra-v147-post-readme-proxy-profile-20260601T230704Z` sampled the still-installed exact-public `v1.4.7` package 11 times at 30-second intervals: four Hydra-owned processes and zero stale profiles throughout, `0.0-0.1%` CPU (`0.009%` average, `0.0%` end), and `514457600 -> 516734976` bytes RSS (`+2277376`). This is conservative running-package no-regression evidence; the README/audit source patch is not claimed as released.
- 2026-06-01 final-source literal-chain retry for commit `c705753`: `npm run lint`, full `npm test`, and `npm run gate` passed before ARM smoke correctly refused to run without a distributable archive in the intentionally cleaned local `release/` tree. The exact public `Hydra-1.4.7-mac-arm64.zip` was downloaded into `/private/tmp/hydra-v147-public-arm-smoke-retry-20260601T231534Z`; its local SHA-256 `0d4ea5946c547a8d9cfb0df578e41d1850fe95dbb903346f41f3de94b79989c1` matched GitHub's published digest. A temporary symlink exposed that verified archive to the smoke contract, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed, and strict deep `codesign --verify` passed. The symlink moved back into the evidence directory. Docker Desktop was started only for the local runtime check: `npm run docker:smoke` passed compose validation, image build, and a real containerized Playwright Chromium launch; it left no Hydra containers or `hydra_default` network. The daemon socket stopped first; `docker desktop stop` then removed the remaining Desktop helper processes in one second. `npm run openapi:hydra` regenerated `84` operations without tracked drift. Final read-only state: `release/` contains only `mac-arm64/Hydra.app`, Spotlight resolves exactly that app, and `hydra doctor --json` reports four owned processes, `0.0%` CPU, and zero stale profiles.

- 2026-05-27 visible-only renderer refresh follow-up: App upstream health, Dashboard metrics, Traffic logs, and Vault account refresh now share `src/hooks/useVisibleRecurringTask.js`, which clears the tracked timeout when `document.hidden` becomes true and does not schedule the next refresh until the page is visible again. This preserves one-shot non-overlapping refresh behavior while removing hidden-window wakeups that previously fired just to check `document.hidden`. Deterministic wakeup-count probe over a 30-minute hidden window: `App.upstreamHealth` old `60` → new `0`, `useTraffic.autoRefresh` old `60` → new `0`, `useMetrics.autoRefresh` old `6` → new `0`, and `Vault.autoRefresh` old `3` → new `0`, reducing the combined hidden refresh timer wakeups from `129` to `0` (`100%`). Verification passed: `node --check src/hooks/useVisibleRecurringTask.js` and `npm run test:ui-static`.

- 2026-05-31 embedded API server measured-no-win follow-up: a real ephemeral `server/index.js` bootstrap against a temporary Prisma SQLite database completed in `9.282ms`. After `20` warmups, `300` sequential `GET /api/auth/status` requests averaged `0.278ms`, with `0.262ms` median and `0.378ms` p95. The first probe intentionally exposed the configured global API throttle after request `100`; the corrected measurement raised `RATE_LIMIT_MAX` only inside the isolated benchmark so the sample measured Express route handling instead of policy throttling. No embedded-server code change is justified from this profile: the measured unauthenticated status route is already sub-millisecond, while the material wins are in downstream proxy, persistence, health-polling, and dashboard-refresh paths documented above.

- 2026-05-31 acceptance item 10 subsystem map: every named long-running path now has measured evidence or an explicit measured-no-win result. Embedded API server: measured-no-win above (`9.282ms` real ephemeral boot; `/api/auth/status` `0.278ms` average). Proxy/router: body-encoding retry work fell `86.9%`, SSE placeholder pre-forward wait fell `99.6%`, and cached model-list reads fell to `0.0003ms` average. Account automation: shared per-task network-route reuse reduced repeated proxy-dispatcher setup `99.576%`. Request-log buffering: the old permanent one-second flush interval implied `60` empty wakeups per idle minute after traffic drained; the current `ensureTimer()` path schedules only while queue work exists, so drained-queue idle wakeups are `0`, and the SSE placeholder measurement separately proves the first-byte improvement. Health polling: hidden renderer upstream-health wakeups fell from `60` to `0` over a deterministic 30-minute hidden-window probe; the server health pinger also moved from a permanent interval to one awaited unref'd timeout. Dashboard refresh: metadata/status shaping fell `61.1%`, and hidden `useMetrics.autoRefresh` wakeups fell from `6` to `0` over 30 minutes.

- 2026-05-26 login/session/cookie audit pass: Clerk login state is stored as encrypted `sessionToken` plus encrypted config carrying `clientCookie`, `clientCookies[]`, `sessionExpiry`, and optional Cloudflare cookie expirations. Session display uses cached live-probe truth when present, otherwise the realistic stored `sessionExpiry` heuristic; manual probes and action paths use `refreshSession()` with the stacked `clientCookies[]` newest-first. Hardening added in this pass: `normalizeClientCookies()` now trims, dedupes, rejects empty/`undefined` entries, accepts legacy string stacks, and caps stored history at 25 entries; hydrated account/session objects now synthesize legacy-compatible `clientCookie` from the latest stack entry when the old scalar field is blank; AccountController OTP verification, ghost recovery, and silent refresh use the normalized latest cookie instead of gating only on `session.clientCookie`. This closes a stack-only compatibility hole where a valid `clientCookies[]` array could exist but legacy `clientCookie` was absent. Verification passed: full `npm test`; `npm run test:session-refresh-contract` now includes direct bounded-stack and controller-normalization tests; focused `npm run test:auth-cookie`, `npm run test:ensure-session-backfill`, and `npm run test:webhooks` also passed.

- 2026-05-30 session-truth and memory hardening pass: sanitized direct-store inspection found four cached-active accounts at the 25-entry cookie-stack cap. Each account had 25 distinct raw snapshots but exactly one Clerk identity, proving transient dashboard/Cloudflare churn was filling fallback memory without adding another login path. `normalizeClientCookies()` and `appendClientCookie()` now retain genuinely distinct Clerk identities while replacing equivalent transient snapshots. Historical `email_otp` and `email` vault aliases now route through the same OTP decisions as canonical `otp` in server, CLI, and renderer code. Bulk magic-link completion requires an active `checkSessionLive()` result and isolates per-row probe failures. OTP account generation now persists refreshed device cookies after long-lived activation. Post-hardening forced Clerk probes under `/private/tmp/hydra-live-session-probes-20260531T032710Z-post-hardening` confirmed `4/4` stored logins active and redeem-ready, including one live login without a management key; all four active cookie stacks persisted from `25` to `1`. Durable operator notes: `docs/SESSION_TRUTH.md`. Focused verification passed: syntax checks, `npm run test:session-refresh-contract`, `npm run test:background-failure-visibility`, and `npm run lint`.

- 2026-05-30 splash elegance refinement and duplicate-app cleanup: targeted `~/Desktop` scans found three launchable Hydra bundles: current arm64 `release/mac-arm64/Hydra.app`, ignored top-level `Hydra.app`, and stale Intel `release/mac/Hydra.app`. All noncanonical bundles plus superseded installers were moved reversibly to `/private/tmp/hydra-desktop-duplicates-20260531T031455Z`; exactly one Desktop Hydra bundle remains. Source splash timing is now `16000ms` (+33%), with 120 falling words, a staged `3000ms` eased upward flight, delayed field fade, and bounded `18500ms` self-disposal. Focused splash verification passed: syntax checks, `npm run test:ui-static`, `npm run test:electron-main-process`, `node bin/hydra.mjs audit --json`, and `git diff --check`. Packaged GUI visual dogfood remains deferred because the user asked not to close or relaunch the existing app session.
- 2026-05-31 splash scale refinement: each falling word initially sampled one bounded scale multiplier in `[0.75, 1.50]` before its Matter body was created. The final `v1.1.3` portal choreography follow-up below widens that range while keeping the same inherited glyph-body sizing contract.
- 2026-05-31 splash portal refinement: the final three-second exit no longer flips gravity upward. After the words land and shatter, the existing individual glyph bodies accelerate into a tightening clockwise orbit around viewport center: orbit radius eases from `46%` to `19%` of the shorter screen dimension while tangential speed rises from `3.2` to `19.0`. The greeting card stays above the canvas with a restrained portal glow and the canvas fades only during the final `300ms`. Matter cleanup remains bounded by the existing deterministic splash teardown.
- 2026-05-31 splash portal graphics pass: the portal stays inside the existing single owned canvas/RAF rather than adding a second WebGL renderer. During the bounded three-second orbit, canvas rendering layers a radial cyan/purple/pink glow, four independently rotating dashed elliptical rings, eighteen orbiting light motes, and glyph-level pulse depth via alpha, scale, and colored shadow blur. This spends graphics detail where it is visible while keeping Matter ownership, 30 fps paint cap, and deterministic teardown unchanged.
- 2026-05-31 `v1.1.3` patch-lane handoff: tracked `package.json` and `package-lock.json` advance from `1.1.0` to `1.1.3` for the desktop Search cleanup, live-session metadata repair, splash portal and size randomization, proximity polish, product signature, updater handoff, Windows lane hardening, and packaged splash README media tranche. `docs/VERSIONING.md` records that the next normal patch after this tranche is `1.1.4`.
- 2026-05-31 packaged splash README capture: the earlier `1.1.1` draft capture was reviewed and replaced during the final `1.1.3` portal pass. The final `videos/hydra_splash.gif` is a cropped packaged-app recording that excludes the macOS menu bar, Dock, and the user's desktop content. Prior uploaded showreel GIF/MP4 and discarded full-screen capture takes were moved reversibly to `/Users/zaydk/.Trash/hydra-old-media-20260531T081004Z`.
- 2026-05-31 forced-update maintenance hardening: Hydra has no application-license database or local entitlement token to rotate. Its update-sensitive local state is the signed/notarized bundle, updater metadata, owner-only runtime secrets, schema state, and legacy-data normalization. Before `electron-updater` calls `quitAndInstall(false, true)`, `electron/app/updateHandoff.js` now atomically writes an owner-only `pending-update-handoff.json` with source and target versions. On the first launch of the installed target, `electron/main.js` runs `firstLaunchSetup(trackedChildren)` before embedded-server import/bootstrap even if the Prisma schema fingerprint is unchanged, then archives completion as owner-only `last-update-handoff.json` and removes the pending marker. A marker-write failure blocks the forced restart and surfaces a visible error instead of silently installing without maintenance.
- 2026-05-31 Windows `v1.1.3` release-lane hardening: the tag-release workflow keeps Windows x64 NSIS on `windows-2022`, runs target-specific `electron:prepare`, packages with `--win nsis --x64`, runs `electron:smoke`, and uploads the installer, blockmap, and `latest.yml` only after smoke passes. Package smoke verifies `Hydra.exe`, `query_engine-windows.dll.node`, the Windows Chromium archive, the distributable installer/blockmap, and the new updater-maintenance handoff module. Linux remains available as historical releases but was removed from the active tag-release matrix so `v1.1.3` refreshes macOS and Windows only. Windows install/launch remains explicitly unverified on this Mac; the hosted Windows package runner is the release-time executable contract boundary.
- 2026-05-31 product attribution and Windows graphics contract: package metadata now names `Frostbyte Technology — Developed by Zayd / Cold`; About and Build Info expose the same credit; Windows `legalTrademarks` embeds `Hydra by Frostbyte Technology. Developed by Zayd / Cold.` The Windows executable, NSIS installer, and NSIS uninstaller all continue to use `desktop/icons/icon.ico`. Local inspection reports a six-size Windows ICO, and `server/tests/workflow-contract.test.mjs` locks the executable/installer/uninstaller artwork plus attribution wiring. Final Windows rendering remains a hosted-runner artifact-inspection boundary because this Mac cannot launch NSIS.
- 2026-05-31 `v1.1.3` final design/session refinement: the forced Clerk probe contract now waits for refreshed session material to persist, reloads the account row, and returns the current `sessionExpiry` plus `sessionRefreshedAt`; Account Detail and Vault merge that metadata immediately. UI copy separates live Clerk truth, interactive sign-in age, last silent renewal, and the next local renewal checkpoint so a seven-week-old but currently renewable login no longer reads as if it expires in a couple of days. Dashboard account cards and primary sidebar navigation now use restrained Euclidean proximity fields with one tracked RAF per field, compositor-only CSS variables, leave/unmount reset, and reduced-motion bypass. `docs/DESIGN_ENGINEERING.md` records the splash portal, proximity, session-copy, and product-signature decisions. The renderer shell and splash carry a subtle non-visible `data-studio="frostbyte-zayd-cold"` signature while release metadata remains the canonical product credit.
- 2026-05-31 `v1.1.3` portal choreography follow-up after packaged frame review: the shower remains capped at `120` word bodies rather than increasing collision load. Recursive tracked timeouts replace the fixed 100ms spawn interval with uneven `34..296ms` cadence; weighted spawn lanes, stronger lateral entry velocity, and the widened `0.86..1.90` word-scale multiplier make the shower less uniform while raising the minimum scale above the prior `0.75` floor. The welcome rectangle stays hidden until the three-second portal begins and now reads `Welcome, <name>`. Portal glyphs receive a stronger initial inward lift before their tangential orbit accelerates, and per-glyph canvas shadow blur is sampled on every fifth glyph only, reducing repeated paint pressure while keeping the portal glow.
- 2026-05-31 `v1.1.3` splash fluidity follow-up after packaged GUI review: the user-observed top-quarter gravity pause was traced to a real collider overlap: fresh words spawn around `-bh * 0.6`, while the old `400px` ceiling wall occupied `-400..0px`. The ceiling is removed because the downward shower needs only floor and side walls. The bounded word target drops from `120` to `88`. At portal entry, every dynamic glyph receives `collisionFilter.mask=0` and `isSensor=true`, preserving independent Matter-integrated orbit motion while skipping dense glyph-pair response during the spin. Splash diagnostics now report `peakDynamicBodyCount` and `portalCollisionDisabled` so the final packaged pass can prove the optimized phase transition.
- 2026-05-31 `v1.1.3` repeated-glyph root cause and dial-pad overlay follow-up: packaged diagnostics after the first fluidity pass reported `target:88`, `peakDynamicBodyCount:3582`, and `portalCollisionDisabled:true`. The abnormal peak matched the user-visible same-word/same-color clone glitch. Root cause: one word parent can appear in multiple pairs inside the same Matter `collisionStart` event; removing it from the world does not mutate the already-built pair list, so the old loop could call `shatter()` repeatedly. `shatter()` now marks the parent `kind="shattered"` before adding glyphs and diagnostics count skipped duplicate calls. The queue uses `72` unique shuffled entries rather than repeating to fill a larger target. The welcome overlay now uses a nine-cell dial-pad grid: denser north/west/center/east/south glass panes and translucent corners preserve portal visibility around a stable center cross. The ivy rig also moves from six heavier primary stems to five slimmer stems with calmer fork angles and smaller buds.

- 2026-05-30 resumed-sandbox publish boundary: source, docs, and local tests can be edited, but Git metadata writes are denied in this resumed shell. `touch .git/.codex-write-probe` and `git add` both fail with `Operation not permitted`; `ps` and `top` process enumeration are also denied. While verifying that boundary, full CLI coverage exposed an unavailable-process JSON-shape inconsistency in `hydra doctor`; `bin/hydra.mjs` now returns zeroed Hydra and unrelated-browser process totals when process enumeration is unavailable, preserving the stable diagnostics schema. The verified patch is published through a clean `/private/tmp` clone so the remote still receives a normal reviewed Git commit and the `[bump:minor]` workflow can produce `1.1.0`; the blocked source checkout remains dirty until refreshed from a shell with normal repo metadata access. Fresh packaged GUI profiling also remains deferred because the user asked not to close or relaunch the existing app session.

- 2026-05-30 final local verification for the pending minor tranche: clean full `npm test` passed after the diagnostics schema fix; `npm run build`, `npm run gate`, and `npm run openapi:hydra` passed; initial `npm run docker:smoke` reached Docker Desktop but Buildx could not update sandbox-blocked `~/.docker/buildx/activity`, and the corrected `BUILDX_CONFIG=/private/tmp/hydra-buildx npm run docker:smoke` retry passed config, daemon, and image build. `npm run electron:build:mac-arm64` rebuilt the current package; `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` and `codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app` passed. Packaged-source inspection confirmed `SPLASH_MIN_VISIBLE_MS = 16000`, `HYDRA_SPLASH_TARGET=120`, `HYDRA_SPLASH_EXIT_FLIGHT_MS=3000`, and `HYDRA_SPLASH_DISPOSE_MS=18500`. A final targeted `find /Users/zaydk/Desktop -maxdepth 5 -type d -name 'Hydra.app' -print` returned exactly `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.

- 2026-05-26 auth-cookie/keychain follow-up: the local Hydra unlock cookie is now server-issued with `HttpOnly`, `SameSite=Lax`, `Path=/`, and the same 24-hour max age as the JWT. Renderer requests now explicitly use `credentials: 'same-origin'` so the HttpOnly cookie still authenticates same-origin/local API calls, while `src/api.js` no longer writes a fresh JS-readable `document.cookie` copy of `hydra_token` after login/setup. `clearLegacyAuthCookie()` remains only to expire older JS-readable cookies from previous builds. Static contracts also verify native auth-token IPC does not import Electron `safeStorage`, `keytar`, or macOS Keychain APIs, while Electron startup and Playwright automation continue to carry `password-store=basic` / `--use-mock-keychain` isolation. Verification passed: focused `npm run test:auth-cookie`, `npm run test:electron-data-path`, `npm run test:session-refresh-contract`, `npm run test:electron-main-process`, and `npm run test:browser-isolation`; then full `npm test`, `npm run lint`, `npm run build`, `npm run gate`, `npm run openapi:hydra`, `npm run electron:build:mac-arm64`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `git diff --check`.

- 2026-05-26 cookie/session follow-up: `server/utils/cookie-utils.js` now parses both legacy raw `__client` values and lone `__client=value` strings consistently for Clerk FAPI, dashboard fetches, and Playwright cookies, preventing double-prefix headers such as `__client=__client=value` and preserving raw legacy round trips from `serializeAllDeviceCookies()`. Debug/research endpoints now build Clerk and dashboard cookie headers through `clerkFapiDeviceCookieHeader()` and `openRouterDashboardDeviceCookies()` instead of hardcoding `__client=${value}`, and `trpcProbe` uses a refreshed client cookie for the probes after pre-refresh. Store cookie-stack replacement/append paths now normalize, trim, dedupe, and cap replacement stacks before writing. Clerk `session.revoked` and `session.ended` webhooks both clear matching local sessions, but account events no longer store the full Clerk `sid`. Verification passed: `node --check bin/hydra.mjs`, `node --check server/controllers/DebugController.js`, `npm run test:cookie-utils`, `npm run test:session-refresh-contract`, `npm run test:webhooks`, `npm run test:auth-cookie`, `npm run test:cli`, a direct `hydra doctor --json` classifier check, full `npm test`, `npm run lint`, `npm run build`, `npm run gate`, `npm run openapi:hydra`, `npm run electron:build:mac-arm64`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `git diff --check`.

- 2026-05-26 login/session triple-check follow-up: local Hydra unlock auth now tries bearer and HttpOnly cookie candidates in order, so a stale native/localStorage bearer token no longer masks a still-valid server-issued unlock cookie during `/api/auth/status` or protected API calls. `/api/auth/logout` is now idempotent/public so the server can always expire the HttpOnly cookie even after the JWT has already expired. OpenRouter dashboard REST fallbacks and Clerk JWT refresh now build cookie headers through `dashboardCookieHeader()` / `clerkClientCookieHeader()` instead of replaying raw `clientCookie` strings, closing the raw legacy `__client` edge for `getFreshJwt()`, management-key REST probes, and redemption REST probes. The API-key sync Playwright fallback now injects browser cookie objects from `playwrightCookiesForOpenRouter()` instead of treating a serialized header string as `[name, value]` pairs. Verification passed: `node --check server/services/dashboard-api.js`, `node --check server/middleware/auth.js`, `node --check server/controllers/AuthController.js`, `node --check server/routes/auth.js`, `npm run test:auth-cookie`, `npm run test:auth-status`, `npm run test:cookie-utils`, `npm run test:session-refresh-contract`, `npm run test:ensure-session-backfill`, `npm run test:webhooks`, `npm run test:cli`, full `npm test`, `npm run lint`, `npm run build`, `npm run gate`, `npm run openapi:hydra`, `npm run electron:build:mac-arm64`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `git diff --check`.

- 2026-05-26 renderer timer ownership follow-up: added `src/hooks/useOwnedTimeouts.js` and moved more short-lived UI timers behind unmount cleanup for app-level toast expiry/dedupe, Pool Manager copy/model-copy feedback, Diagnostics support-bundle copy feedback, CreatedKeyModal copy feedback, DevBackendHint copy feedback, RegisterKeyModal focus delay, and OtpTab export-copy reset. This broadens acceptance item 3 coverage beyond startup/splash timers into normal navigation surfaces, preventing stale setState after route changes and keeping transient timers tied to the surface that created them. Verification passed: `npm run test:ui-static`, `npm run lint`, and `npm run build`.

- 2026-05-26 release workflow regression found from GitHub runs 26472384793 (`v1.0.19`) and 26472810187 (`v1.0.20`): Windows x64 package smoke failed in `assertPackagedServerConfigImports()` with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because the smoke script passed raw `D:\a\hydra\...server\config.js` into dynamic `import()`. On Windows, Node ESM treats the drive letter as protocol `d:`. Fix: `scripts/smoke-electron-package.mjs` now converts the packaged config path with `pathToFileURL(configPath).href` before invoking the child import. `server/tests/workflow-contract.test.mjs` now asserts that packaged config smoke uses a file URL so this Windows-only release failure cannot regress silently. Verification passed: `npm run test:workflow-contract`, `npm run test:cross-platform`, and `ELECTRON_APP_RESOURCES="$PWD/release/mac-arm64/Hydra.app/Contents/Resources" npm run electron:smoke` against the existing unpacked macOS resources. Local `npm run docker:smoke` still remains environment-blocked at `docker info` with `Cannot connect to the Docker daemon at unix:///Users/zaydk/.docker/run/docker.sock. Is the docker daemon running?`.

- Remote post-push evidence for commit `d131861` (`Harden session cookie stacks and timer cleanup [skip-bump]`): Auto-version run 26473377173 skipped as intended, CI run 26473377122 passed `lint`, `build`, `test:ci`, and `gate`, and Docker run 26473377044 passed both Runtime Smoke and Build & Push. No new release tag was created because this was an incremental hardening commit, not the final 12/12 acceptance release.

- 2026-05-26 packaged idle sample after rebuilding and launching `release/mac-arm64/Hydra.app`: `t+8s` during splash/main transition still showed expected visual load (`GPU helper 52.8%`, renderer `13.7%`); `t+20s` fell to `GPU 3.4%`, renderer `6.8%`; `t+45s` showed Hydra main, GPU, network, and renderer processes all at `0.0%` CPU with RSS approximately `185520`, `107504`, `51536`, and `140352` KB respectively. A stricter five-minute post-splash idle sample ran from `2026-05-26T19:45:58Z` to `2026-05-26T19:50:58Z`; Hydra main sampled at `0.1%` CPU / `170656` KB RSS, and the GPU, network, and renderer helpers sampled at `0.0%` CPU with `96336`, `51216`, and `111120` KB RSS respectively. After the later `ScrambleText` interval cleanup, `npm run electron:open:mac-arm64` launched the rebuilt current-source package through LaunchServices; at `t+18s` the splash/transition path still showed active visual work (`GPU helper 47.5%`, renderer `14.4%`), and at `t+48s` Hydra main, GPU, network, and renderer helpers were all back to `0.0%` CPU with RSS approximately `176832`, `104480`, `51168`, and `127024` KB respectively.

- Local macOS Intel rebuild attempt on 2026-05-26 failed before packaging because this Apple Silicon host only had Playwright `chrome-mac-arm64` in `/Users/zaydk/Library/Caches/ms-playwright/chromium-1208`; `scripts/prepare-electron-resources.mjs` correctly refused `HYDRA_BUILD_TARGET=darwin-x64` without `chrome-mac-x64`/`chrome-mac` and printed target-runner guidance. The Intel artifact must be rebuilt by CI's Intel runner or a host with the x64 Playwright payload; this was a correct guardrail, not a package-source failure.

- Local Docker smoke on 2026-05-26 remains environment-blocked, including the rerun after the icon/Vault tranche: `npm run docker:smoke` successfully printed `docker compose config`, but `docker info` failed with `Cannot connect to the Docker daemon at unix:///Users/zaydk/.docker/run/docker.sock. Is the docker daemon running?`. Use GitHub Actions Docker smoke or a local Docker Desktop session for final Docker evidence.

- Current v1.0.14 dogfood preflight on 2026-05-21 downloaded release assets into `/private/tmp/hydra-v1014-dogfood.WvHFWG`, extracted the macOS arm64 app with `ditto`, and verified the app reports CFBundleShortVersionString `1.0.14`, CFBundleExecutable `Hydra`, and passes `codesign --verify --deep --strict --verbose=2`. `npm run dogfood:final -- --write-evidence=/private/tmp/hydra-v1014-dogfood.WvHFWG/hydra-final-dogfood-current.json --version=1.0.14 --artifact-dir=/private/tmp/hydra-v1014-dogfood.WvHFWG --app=/private/tmp/hydra-v1014-dogfood.WvHFWG/extracted-mac-arm64/Hydra.app --launch-diagnostics` verified all six versioned release artifacts plus the packaged app path and wrote redacted evidence with `complete=false`. With `HYDRA_DOGFOOD_EVIDENCE=/private/tmp/hydra-v1014-dogfood.WvHFWG/hydra-final-dogfood-current.json`, `hydra audit` still reports `31 ok / 5 deferred / 0 missing / 0 blockers`, because no manual packaged GUI, live account, screenshot, Touch ID, or Windows launch checks were claimed. LaunchServices/Finder diagnostics remain environment-blocked from this shell: Electron runtime `--version` aborts with `SIGABRT`, Calculator and Hydra LaunchServices both return `kLSNoExecutableErr`, and Finder AppleEvent handoff cannot reach Finder/HIServices.

- v1.0.14 updater metadata and Windows payload inspection on 2026-05-21 matched release assets downloaded into `/private/tmp/hydra-v1014-dogfood.WvHFWG`. Recomputed SHA-512 base64 values matched `latest-mac.yml` for both `Hydra-1.0.14-mac-arm64.zip` and `Hydra-1.0.14-mac-x64.zip`, and matched `latest.yml` for `Hydra-1.0.14-win-x64.exe`. `7z l Hydra-1.0.14-win-x64.exe` identified an NSIS-3 Unicode package with `$PLUGINSDIR/app-64.7z`; nested payload inspection found `Hydra.exe`, `resources/app/package.json`, `resources/app/dist/index.html`, `resources/app/electron/app/windows.js`, `resources/app/electron/vendor/matter.min.js`, `resources/app/node_modules/.prisma/client/query_engine-windows.dll.node`, `resources/chromium.zip`, `resources/data/empty-hydra.db`, and `resources/prisma/schema.prisma`. This verifies package contents and updater metadata only; Windows installer install/launch still needs a Windows host or runner dogfood check.

- v1.0.11 splash/package verification on 2026-05-21 confirmed the runtime splash source uses vendored `electron/vendor/matter.min.js`, full-viewport `.outer`/canvas geometry, collision-start shattering for word bodies, `TARGET=80`, intro gravity `1.0` with scale `0.0012`, and exit gravity `-1.45`. `node --check electron/app/windows.js`, `node --check electron/app/autoUpdate.js`, and `node --check scripts/splash-variants.mjs` passed locally. The v1.0.11 macOS arm64 release artifact contains `Hydra.app/Contents/Resources/app/electron/vendor/matter.min.js` at 83,476 bytes, reports CFBundleShortVersionString `1.0.11`, passes `codesign --verify --deep --strict --verbose=2 Hydra.app`, and `ELECTRON_RUN_AS_NODE=1 Hydra.app/Contents/MacOS/Hydra -e "console.log(process.versions.electron + ' ' + process.arch)"` prints `42.1.0 arm64`. `latest-mac.yml` matches the downloaded mac arm64 zip SHA-512, and `latest.yml` matches the downloaded Windows NSIS SHA-512. Local `npm run electron:smoke` passed against the existing mac arm64 packaged resource contract; local `npm run docker:smoke` remained blocked because Docker Desktop's daemon socket was unreachable, while GitHub Docker run 26253074104 passed on master.

- Current v1.0.11 dogfood preflight on 2026-05-21 downloaded release assets into `/private/tmp/hydra-v1011-dogfood.bwFBBB`, extracted the macOS arm64 app with `ditto`, and ran `npm run dogfood:final -- --write-evidence=/private/tmp/hydra-v1011-dogfood.bwFBBB/hydra-final-dogfood-current.json --version=1.0.11 --artifact-dir=/private/tmp/hydra-v1011-dogfood.bwFBBB --app=/private/tmp/hydra-v1011-dogfood.bwFBBB/extracted-mac-arm64-2/Hydra.app --launch-diagnostics`. The preflight verified all six versioned release artifacts are present (`Hydra-1.0.11-mac-arm64.zip`, arm64 blockmap, mac x64 zip, x64 blockmap, Windows NSIS, Windows blockmap) and wrote redacted evidence. It still preserved `complete=false`: current `hydra audit` reports `deferred=5` after splitting Touch ID hardware dogfood and Windows installer launch dogfood into explicit evidence items, Docker daemon is unreachable locally, and LaunchServices/Finder handoff failed for both Calculator and Hydra with the existing shell-level `kLSNoExecutableErr`/Finder AppleEvent errors. A Computer Use retry against `/private/tmp/hydra-v1011-dogfood.bwFBBB/extracted-mac-arm64-2/Hydra.app` was denied by MCP elicitation for `com.zayd.hydra`, and `list_apps` timed out after 120 seconds. This is current artifact evidence and environment/app-control blocker evidence, not packaged GUI completion evidence.
- The final dogfood evidence tool was hardened on 2026-05-21 so `evidence.complete` also requires every versioned release artifact to be present and the packaged macOS `.app` path to exist, in addition to `hydra audit` having zero missing/blocker evidence and every explicit manual checkbox being verified. It intentionally does not require `hydra audit complete=true` before writing evidence, because `hydra audit` reads the completed evidence file afterward to clear manual dogfood items. `npm run test:dogfood-evidence`, `node --check scripts/final-dogfood-check.mjs`, `git diff --check`, and a fresh `npm run dogfood:final -- --write-evidence=/private/tmp/hydra-v1011-dogfood.bwFBBB/hydra-final-dogfood-current.json --version=1.0.11 --artifact-dir=/private/tmp/hydra-v1011-dogfood.bwFBBB --app=/private/tmp/hydra-v1011-dogfood.bwFBBB/extracted-mac-arm64-2/Hydra.app` passed; the preflight now reports `[OK] Packaged macOS app path - directory present` and still refuses completion while manual items are unchecked.
- `hydra audit` now reads redacted dogfood evidence from `docs/DOGFOOD_EVIDENCE.json` by default or `HYDRA_DOGFOOD_EVIDENCE=/path/to/evidence.json` for temporary/downloaded artifacts. It only promotes the packaged GUI, live MVP, packaged screenshot audit, Touch ID hardware dogfood, and Windows installer launch dogfood items when the evidence schema matches `hydra.final-dogfood-evidence.v1`, the evidence version matches `package.json`, all six release artifacts are marked present, the packaged app path is marked present, and the relevant manual IDs are explicitly verified. `node --test --test-name-pattern="hydra audit" server/tests/cli.test.mjs` passed after adding coverage for matching evidence promotion and stale-version rejection.
- `scripts/final-dogfood-check.mjs` now records unknown `--manual=<id>` values under `checks.unknownManualIds`, prints them as `[WAIT] Unknown manual check id(s)`, and refuses `complete=true` while any are present. `server/tests/final-dogfood-evidence.test.mjs` covers the source contract so typoed manual evidence cannot silently look complete.
- `hydra audit` also rejects evidence with non-empty `checks.unknownManualIds`, even when all known manual checkboxes are true. `server/tests/cli.test.mjs` covers a typoed `windows-lanch` evidence file and verifies packaged GUI, live MVP, screenshot, Touch ID, and Windows launch items all remain deferred.
- `hydra audit` also requires dogfood evidence to carry `complete: true`; it does not merely recompute the currently known fields. `server/tests/cli.test.mjs` covers otherwise-valid evidence with `complete:false` so future completion criteria added to `scripts/final-dogfood-check.mjs` cannot be silently bypassed by audit.
- Full CLI regression after the dogfood evidence/audit hardening passed on 2026-05-21: `npm run test:cli` completed 46/46 tests in 339915.931375ms, including the new matching-evidence promotion, stale-version rejection, unknown-manual-ID rejection, and `complete:false` rejection contracts.
- Fresh release gate after the dogfood evidence/audit hardening passed on 2026-05-21: `npm run gate` completed 12/12 checks, including server import/no auto-start, bootstrap/graceful shutdown, config load, ephemeral server boot/close, Electron main/preload patterns, electron-builder Prisma asar config, package Electron scripts/deps, desktop icons, and built Vite `dist/index.html`.
- Full `npm test` was rerun after the dogfood evidence/audit hardening. The run passed through pretest Prisma push/generate, server/unit suites, API integration, browser isolation, MCP, full CLI 46/46, UI static 24/24, Docker smoke contracts, and dogfood evidence, then exposed one stale workflow-contract assertion that still expected the old dogfood completion-rule text. After updating `server/tests/workflow-contract.test.mjs` to the stricter rule, `npm run test:workflow-contract` passed 13/13 and the remaining tail (`npm run test:gzip-middleware && npm run test:error-boundary-sanitization && npm run test:prisma-error-classification && npm run test:phase1-backward-compat && npm run test:electron`) passed, including the complete Electron chain.
- Clean full `npm test` rerun after the workflow-contract fix passed end-to-end on 2026-05-21. It completed pretest Prisma push/generate, every normal server/Electron test script in the package chain, full `npm run test:cli` with 46/46 tests in 335386.030042ms, UI static 24/24, workflow contract 13/13, and the complete Electron test chain without failures.
- Current local package-resource smoke after the clean full test rerun passed on 2026-05-21: `npm run electron:smoke` verified `release/mac-arm64/Hydra.app`, packaged shell/resources, release artifact presence, Prisma schema/migrations/empty DB, `libquery_engine-darwin-arm64.dylib.node`, bundled Chromium, and 80 MB app size. This remains package-resource evidence only, not GUI dogfood.
- Fresh production renderer build after the clean full test and package-smoke passes completed on 2026-05-21: `npm run build` ran Vite production build successfully, transformed 112 modules, and produced `dist/index.html` plus hashed JS/CSS assets.

- 2026-05-21 performance and efficiency pass started from the user's fan/CPU report. Source changes now cap splash Matter.js physics at 45 Hz with `Run.create({delta:1000/45})`, cap canvas drawing to 30 fps with `HYDRA_SPLASH_RENDER_FRAME_MS=1000/30`, and add `disposeHydraSplash()` to clear timers, cancel RAF, remove resize listeners, stop the Matter runner, and clear the engine on `beforeunload` or after 12.5 seconds. Playwright launch sites in account signup, management-key provisioning, code redemption, and key sync now call `cleanupEphemeralProfileDir(profileDir)` after browser close, and dashboard browser launch failures clean the profile before rethrow, so repeated browser automation cannot accumulate Hydra-owned temp profiles. The request-log buffer now uses a one-shot unref'd flush timer instead of a permanent 1-second interval after first traffic, so an idle API router stops waking up just to find an empty queue. Renderer polling now avoids overlapping async work: app upstream-health polling, dashboard metrics, traffic history, vault refresh, and generator status/heartbeat polling use in-flight guards and one-shot timers rather than blind intervals. Bulk magic-link auth now uses one shared poller with per-email in-flight guards instead of starting one interval per email row. `hydra doctor --json` now reports stale `hydra-pw-profile-*` temp profile counts/sizes and, on hosts where `ps` is allowed, Hydra/Chromium/Playwright process CPU/RAM snapshots so fan-pressure reports have a concrete local measurement surface. `hydra doctor --clean-stale-profiles` moves stale Hydra-owned profile dirs into `hydra-profile-cleanups/cleanup-*` under the temp dir and reports `deleted: 0`, so operator cleanup remains reversible. Verification: `node --check electron/app/windows.js`, `node --check server/services/dashboard-api.js`, `node --check server/services/account-generator.js`, `npm run test:electron-main-process`, `npm run test:browser-isolation`, `npm run test:background-failure-visibility`, and `git diff --check` passed locally. Expected effect is at least 25% less active splash physics work, 50% less splash canvas draw work during the visual window, no persistent request-log empty-queue wakeup after proxy traffic drains, no overlapping renderer dashboard/traffic/generator polls during slow local API responses, no N-interval multiplier during bulk magic-link sign-in batches, and bounded cleanup for graphics/browser automation; exact CPU/RAM percent still needs packaged GUI measurement from an unsandboxed app session.
- Local performance cleanup evidence on 2026-05-21: `node bin/hydra.mjs doctor --json --clean-stale-profiles` moved 9 stale Hydra Playwright profile dirs into `/var/folders/jp/srqsp2ts3rv7qxvsdx4s1n480000gn/T/hydra-profile-cleanups/cleanup-2026-05-21T22-52-13-663Z` with `deleted: 0`, and a follow-up `node bin/hydra.mjs doctor --json` reported `performance.hydraPlaywrightProfiles.count: 0`. Process CPU/RAM inspection remains unavailable in this sandbox because `ps` returns `EPERM`, but the normal-terminal measurement path is implemented. After widening an overloaded local mock timeout in the OpenRouter CLI contract, full `npm run test:cli` passed with 45/45 tests in 337876.92675ms; `npm run test:background-failure-visibility`, `npm run test:electron-main-process`, `npm run lint`, and `node bin/hydra.mjs audit --json` also passed.
- Full regression evidence for this tranche: `npm test` passed end-to-end on 2026-05-21, including pretest Prisma push/generate, server/unit suites, full `npm run test:cli` with 45/45 tests in 374777.699625ms, UI static contracts, Docker smoke contracts, final dogfood evidence contracts, workflow contracts, gzip middleware, error-boundary sanitization, Prisma error classification, phase-1 backward compatibility, and the complete Electron test chain.
- Current local gate evidence for this performance tranche: `npm run build` passed and produced `dist/index.html` plus hashed renderer assets; after build completed, `npm run gate` passed 12/12 checks including server import/bootstrap/shutdown, config load, ephemeral server boot/close, Electron main/preload patterns, builder config, icons, and built Vite dist. Focused regression checks also passed: `npm run test:browser-isolation`, `npm run test:request-log-buffer`, and `npm run test:ui-static`.
- Electron package-resource evidence for this performance tranche: `npm run electron:prepare` completed on macOS arm64, rebuilt the empty Prisma database, copied Playwright Chromium `chrome-mac-arm64`, rewrote Chromium symlinks, found the Chromium binary, and archived `build/electron/chromium.zip`. Ordered follow-up `npm run electron:smoke` passed against `release/mac-arm64/Hydra.app`, verifying packaged shell/resources, release artifact, Prisma schema/migrations/empty DB, `libquery_engine-darwin-arm64.dylib.node`, bundled Chromium, and 80 MB app size. This is package-resource evidence only; it is not packaged GUI dogfood.

- v1.0.10 macOS arm64 release dogfood on 2026-05-21 downloaded `Hydra-1.0.10-mac-arm64.zip` to `/private/tmp/hydra-v1010-dogfood.3kv3Wj`, extracted `Hydra.app`, and verified the specific v1.0.9 startup blocker is fixed. `codesign --verify --deep --strict --verbose=2 Hydra.app` passed, Info.plist reported CFBundleShortVersionString `1.0.10`, CFBundleExecutable `Hydra`, and CFBundlePackageType `APPL`, `codesign -d --entitlements :- Hydra.app/Contents/MacOS/Hydra` included `com.apple.security.cs.disable-library-validation`, and `ELECTRON_RUN_AS_NODE=1 Hydra.app/Contents/MacOS/Hydra -e "console.log(process.versions.electron + ' ' + process.arch)"` printed `42.1.0 arm64` instead of the v1.0.9 dyld Team ID mismatch.

- v1.0.10 packaged GUI LaunchServices probe on 2026-05-21 still did not prove renderer/window launch from this sandbox. `/usr/bin/open -n /private/tmp/hydra-v1010-dogfood.3kv3Wj/Hydra.app` and `node scripts/open-packaged-app.mjs /private/tmp/hydra-v1010-dogfood.3kv3Wj/Hydra.app` returned `kLSNoExecutableErr`, while the scripted preflight verified CFBundleExecutable `Hydra`, Mach-O arm64 executable type, no quarantine xattr, and `codesign --verify --deep --strict` valid-on-disk. The same probe recorded Calculator/Finder AppleEvent baseline failures (`kLSNoExecutableErr`, `com.apple.hiservices-xpcservice` connection invalid), so this remains environment/app-control evidence, not packaged GUI completion evidence.

- Fresh master dogfood evidence tooling was verified on 2026-05-21 from `/private/tmp/hydra-master-dogfood-tool.07Sszg` against downloaded v1.0.10 release assets in `/private/tmp/hydra-v1010-dogfood.3kv3Wj`. `node scripts/final-dogfood-check.mjs --version=1.0.10 --artifact-dir=/private/tmp/hydra-v1010-dogfood.3kv3Wj --app=/private/tmp/hydra-v1010-dogfood.3kv3Wj/Hydra.app --write-evidence=/private/tmp/hydra-v1010-final-dogfood-master.json --launch-diagnostics` verified all six release artifacts are present and wrote redacted evidence while preserving `complete=false` because the manual packaged GUI, live MVP, screenshot, and Windows launch checkboxes are unchecked.

- v1.0.10 updater metadata was checked on 2026-05-21 from downloaded release assets. `latest-mac.yml` contains both `Hydra-1.0.10-mac-arm64.zip` and `Hydra-1.0.10-mac-x64.zip`; local SHA-512 recomputation matched the YAML entries for both macOS zips, and `latest.yml` matched the local SHA-512 for `Hydra-1.0.10-win-x64.exe`. `spctl --assess --type execute --verbose=4 /private/tmp/hydra-v1010-dogfood.3kv3Wj/Hydra.app` still returned `internal error in Code Signing subsystem`, so Gatekeeper/notarization remains unproven for the ad-hoc macOS package even though deep codesign verification and Electron Framework loading pass.

- v1.0.10 Windows NSIS payload inspection on 2026-05-21 used `7z l /private/tmp/hydra-v1010-dogfood.3kv3Wj/Hydra-1.0.10-win-x64.exe` and nested inspection of `$PLUGINSDIR/app-64.7z`. The installer is an NSIS-3 Unicode package with `app-64.7z`; the payload contains `Hydra.exe`, `resources/app/package.json`, `resources/app/dist/index.html`, `resources/app/electron/app/windows.js`, `resources/app/node_modules/.prisma/client/query_engine-windows.dll.node`, `resources/chromium.zip`, `resources/data/empty-hydra.db`, and `resources/prisma/schema.prisma`. No local `wine`, `wine64`, `qemu-system-x86_64`, `powershell`, or `pwsh` binary is available, so Windows install/launch remains target-host evidence only.

- PR #18 `Reduce idle backend work` merged on 2026-05-21 as master f74c195 with CI and Electron package smoke green across macOS arm64, macOS Intel, Windows NSIS, and Linux AppImage. The patch reduces idle backend churn by delaying session-refresh and request-log startup sweeps, making session lifetime probing opt-in, relaxing task-supervisor polling from 5s to 30s, limiting dashboard proactive refresh to expiring sessions, and removing eager live-session probe fan-out from dashboard, vault, and account-detail initial renders.

- Auto-version created tag v1.0.9 from master 27703a0 on 2026-05-21. Because tags pushed with GitHub's default token do not reliably trigger a second workflow, release run 26237123866 was manually dispatched for v1.0.9 and completed successfully. PR #19 `Fix auto-version release dispatch [skip-bump]` then merged as master 0b49f5a; Auto-version run 26238251024 skipped as intended, CI run 26238251136 passed, and Docker run 26238251146 passed. Future auto-version tags now explicitly dispatch `release.yml`.

- Fresh macOS arm64 package build on 2026-05-20 from current master succeeded in /private/tmp/hydra-master-audit-1779315452 after forcing Prisma caches into /private/tmp. Commands: HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:prepare, HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:build, HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke. Smoke verified packaged shell, release zip, Prisma engine, bundled Chromium, and 80 MB app size.
- Packaged app LaunchServices dogfood attempt on 2026-05-20 did not prove GUI launch: scripts/open-packaged-app.mjs verified bundle executable, quarantine absence, and codesign valid-on-disk for release/mac-arm64/Hydra.app, then LaunchServices returned kLSNoExecutableErr. Baseline open of Calculator.app failed with the same LaunchServices error and Finder AppleEvent lookup also failed, so this is recorded as a shell/LaunchServices handoff blocker rather than a Hydra bundle crash.
- Fresh macOS arm64 package build on 2026-05-20 from remote master 989cfe3bad1957d55a6a24b3c8221dec635b85d6 succeeded in /private/tmp/hydra-master-989cfe3-1779324824 with XDG_CACHE_HOME and PRISMA_ENGINES_CACHE_DIR pointed at /private/tmp. The clean bundle was copied into release/mac-arm64/Hydra.app after moving a previously merged-invalid bundle aside. HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke passed from the repo release directory, codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app passed, ELECTRON_RUN_AS_NODE=1 release/mac-arm64/Hydra.app/Contents/MacOS/Hydra reported Electron 42.1.0 on arm64, and Info.plist reports CFBundleShortVersionString/CFBundleVersion 1.0.8.
- Packaged app LaunchServices retry on 2026-05-20 after the clean 1.0.8 bundle copy still did not prove GUI launch: scripts/open-packaged-app.mjs again verified bundle executable, executable Mach-O type, quarantine absence, codesign valid-on-disk, codesign details, and designated requirement, then LaunchServices returned kLSNoExecutableErr. Follow-up probes confirmed /System/Applications/Calculator.app/Contents/MacOS/Calculator exists and Info.plist names CFBundleExecutable=Calculator, yet /usr/bin/open, clean-env open, and launchctl asuser $(id -u) /usr/bin/open all returned the same kLSNoExecutableErr for Calculator and Hydra. This is recorded as environment/app-control evidence, not as a known invalid Hydra bundle.
- Computer Use app-control retry on 2026-05-20 listed Hydra's bundle identifier in the recent-app registry, but get_app_state for release/mac-arm64/Hydra.app was denied by MCP elicitation for com.zayd.hydra. Codex still cannot inspect the packaged GUI window, navigation state, or screenshot surfaces directly from this session.
- Direct executable retry on 2026-05-20 reproduced the user's native abort before Hydra JS logging: release/mac-arm64/Hydra.app/Contents/MacOS/Hydra exited 134 with signal 6 in HIServices/_RegisterApplication, and stock Electron runtime probes also failed before printing --version on Electron 42.1.0, 42.2.0, and 40.10.1. That keeps packaged GUI dogfood deferred until a working Aqua/LaunchServices session or user-run app-control evidence is available; it is not yet proof of a renderer, server, updater, or app-code crash.
- Docker runtime check on 2026-05-20 remained blocked locally because docker info could not connect to unix:///Users/zaydk/.docker/run/docker.sock; Docker daemon was not reachable on this Mac shell. GitHub Actions run 26196262336 then closed target-runner runtime evidence: Runtime Smoke ran npm run docker:smoke -- --start, built and started the compose service with HYDRA_LISTEN_HOST=0.0.0.0, received the local health endpoint response, cleaned up compose resources, and Build & Push passed.
- macOS Intel package build was not attempted as local release evidence on Apple Silicon after prepare-electron-resources correctly refused HYDRA_BUILD_TARGET=darwin-x64 without a chrome-mac-x64/chrome-mac Playwright cache. CI artifact inspection downloaded the green PR #5 macOS Intel zip/blockmap and Windows NSIS/blockmap, but the extracted Intel app was unsigned in the downloaded artifact context, so mac-intel-current remains unverified locally.

- PR #4 `Show splash auto-update progress` merged on 2026-05-20 with CI and Electron package smoke green on macOS arm64, macOS Intel, Windows NSIS, and Linux AppImage.
- PR #5 `Harden cross-platform CI tests and badges` merged on 2026-05-20 with CI, Electron package smoke, and release packaging verification green across the same target matrix.
- Fresh master audit command run on 2026-05-20 from `/private/tmp/hydra-master-audit-1779314773` returned `complete: false` because release artifacts, packaged GUI dogfood, live MVP dogfood, screenshot audit, Docker runtime, and previously missing docs were not all verified.
- Targeted checks run on fresh master: `npm run test:cross-platform` passed, `npm run test:workflow-contract` passed, and `node bin/hydra.mjs audit --json` produced the blocker inventory above.

- Final dogfood evidence capture hardening on 2026-05-20: `scripts/final-dogfood-check.mjs --write-evidence` writes a redacted JSON checklist, supports explicit `--manual=<id>` confirmations for packaged GUI/live/screenshot/Windows checks, handles absolute evidence paths correctly, and keeps `complete=false` unless both `hydra audit` and every manual item are complete.
- Session probe log privacy hardening on 2026-05-20: local runtime log inspection found historical `[SESSION_PROBE]` entries containing account aliases and full Clerk `sid` values. The source now masks aliases and Clerk session IDs in active/expired/error/rotation probe logs, keeps account-id failure evidence for debugging, adds a background-failure visibility contract, and adds `session-probe-redaction` to `hydra audit`.
- Final dogfood evidence probe on 2026-05-20 wrote /private/tmp/hydra-local-dogfood-openapp-clean.json with version 1.0.8 and complete=false; it preserves the unchecked manual checklist for packaged GUI launch/window controls/splash navigation/dead-button navigation/Touch ID/live account flows/screenshots/Windows launch. This is evidence that the release preflight is honest, not release-complete evidence.
- Final dogfood launch-diagnostics probe on 2026-05-20 wrote /private/tmp/hydra-final-launch-diagnostics.json with redacted `checks.launchDiagnostics` entries for Baseline Electron runtime --version, Calculator LaunchServices, Calculator Finder AppleEvent, Hydra LaunchServices, and Hydra Finder AppleEvent. The JSON evidence records the same environment-level failures without reading local secrets, DBs, cookies, screenshots, or account data.
- Full `npm test` passed on 2026-05-20 after wiring launch diagnostics into final dogfood evidence. The chain covered test-chain completeness, cross-platform contracts, account proxy pool, API integration, CLI, UI static contracts, Docker smoke script contracts, final dogfood evidence, workflow contracts, and Electron main-process/path/Prisma packaging contracts.
- `npm run lint` passed on 2026-05-20 after the final dogfood launch-diagnostics evidence update.
- `npm run build` passed on 2026-05-20 after the final dogfood launch-diagnostics evidence update; Vite built the production renderer bundle successfully.
- `npm run gate` passed on 2026-05-20 with 12/12 integration-gate checks passing, including server import, bootstrap/shutdown, config loading, ephemeral server boot, Electron main/preload patterns, builder config, icons, package scripts, and built Vite dist.
- `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed on 2026-05-20 against release/mac-arm64/Hydra.app and release/Hydra-1.0.8-mac-arm64.zip, verifying the packaged shell, release artifact, Prisma schema/migrations/empty DB, darwin-arm64 Prisma engine, bundled Chromium, and 80 MB app size.
- `npm run openapi:hydra` passed on 2026-05-20 and rewrote `openapi/hydra-api.openapi.json` with 83 operations and no tracked diff, confirming the checked-in Hydra local API map is current.
- Media scope reconciliation on 2026-05-31: README keeps the packaged splash GIF
  and existing packaged Electron gallery captures. The superseded tracked
  `videos/remotion-project/` workspace was moved reversibly to Trash and the
  audit fallback no longer accepts an obsolete README Remotion section.

## Not Yet Verified

- Launch packaged Electron via LaunchServices and dogfood splash, unlock, Dashboard, Settings Touch ID, proxy pool, traffic, CLI/router surfaces, and window/menu actions.
- Run live account/login/OTP/code redemption/proxy rotation flows with safe test data.
- Capture the required packaged Electron screenshots with no API keys, cookies, tokens, or personal account data visible.

## Blockers

- Packaged GUI dogfood needs app-control or user-run evidence.
- Live MVP flows need credentials/accounts/codes.
- Final screenshot review must wait until packaged Electron dogfood and
  redaction checks are ready.
- GitHub issue #22 tracks the remaining current-release manual dogfood evidence checklist.

## v1.1.0 Release Packaging Follow-Up

- Release run `26702260689` was canceled on 2026-05-31 after all four desktop target runners stalled in `npm run electron:prepare`. Linux x64, Windows x64, macOS Intel, and macOS arm64 each reached 100% while downloading Playwright Chromium `1208`, then produced no progress until cancellation. Shared `lint`, `test`, and `gate` verification had already passed.
- First release-repair attempt: Hydra packages the full Playwright Chromium runtime and does not consume the separate Chromium headless-shell payload, so `scripts/prepare-electron-resources.mjs` was narrowed to `playwright install chromium --no-shell`. This removed unused work but did not clear the hosted-runner extraction stall; the direct-download native-extraction repair below supersedes that intermediate implementation.
- Follow-up release run `26702709698` confirmed the narrower Playwright invocation still remained pinned in `electron:prepare` across all four hosted targets, while a complete cold-cache local install and archive finished in seconds. The cache-miss branch now downloads the revision-matched Chrome-for-Testing archive directly from Playwright's CDN and extracts it with native platform tooling (`unzip` on Unix, PowerShell `Expand-Archive` on Windows), bypassing the hosted-runner extraction stall while preserving the same `chromium-<revision>` cache layout.
- Final release run `26702889329` passed on 2026-05-31 from tagged commit `63984106bd6bd06b200753374eacd8aad8f24229`: shared `lint`, `test`, and `gate`, Linux x64 AppImage, Windows x64 NSIS, macOS arm64 zip, macOS Intel x64 zip, and merged macOS updater metadata all completed successfully. Public release `v1.1.0` contains the Linux metadata, Windows installer/blockmap, both macOS zip/blockmap pairs, and updater metadata. Downloaded `latest-mac.yml` reports version `1.1.0` and contains both `Hydra-1.1.0-mac-arm64.zip` and `Hydra-1.1.0-mac-x64.zip`.
- The published `Hydra-1.1.0-mac-arm64.zip` was downloaded and extracted on the Desktop host without relaunching or closing the user's existing Hydra session. The prior canonical bundle was reversibly moved to `/private/tmp/hydra-desktop-duplicates-20260531T031455Z/Hydra-pre-v1.1.0-20260531T042315Z.app`; `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app` is now the only Desktop `Hydra.app`, reports `CFBundleShortVersionString=1.1.0`, and passes `codesign --verify --deep --strict --verbose=2`.
- Fresh no-relaunch profiling attempt on 2026-05-31 preserved the current sandbox boundary after installing the published `v1.1.0` bundle on disk: direct `ps -ax | grep -iE 'chrome|chromium|playwright|electron|hydra'` failed with `operation not permitted: ps`, `pgrep` failed with `Cannot get process list`, and `top` failed with `sysmon request failed with error: sysmond service not found`. `node bin/hydra.mjs doctor --json` still completed and returned a stable unavailable-process schema with `performance.hydraProcesses.unavailable=true`, `reason="spawnSync ps EPERM"`, and `hydraPlaywrightProfiles.count=0`. This is an honestly documented measurement boundary for the resumed sandbox, not proof that the newly installed `v1.1.0` splash/runtime instrumentation executed inside the already-running pre-relaunch process.
- Final no-launch local verification on 2026-05-31 passed without starting Hydra: `npm run lint`, full `npm test`, `npm run gate` (`12 passed, 0 failed`), `npm run openapi:hydra` (`83 operations`), `git diff --check`, `BUILDX_CONFIG=/private/tmp/hydra-buildx npm run docker:smoke`, and `ELECTRON_APP_RESOURCES="$PWD/release/mac-arm64/Hydra.app/Contents/Resources" HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`. Docker smoke completed config, daemon, and image-build checks. Electron smoke used the installed published `v1.1.0` app resources, but the stale local checkout selected its older local `release/Hydra-1.0.20-mac-arm64.zip` archive for archive lookup because local Git metadata writes remain sandbox-blocked. Tagged GitHub release matrix run `26702889329` remains the authoritative successful `v1.1.0` archive smoke across macOS arm64 and x64.
- Fresh Desktop inventory after the no-launch verification found exactly one `Hydra.app` under `/Users/zaydk/Desktop`: `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`. A Computer Use running-app inventory did not list Hydra, confirming that the sole published bundle is installed but not running. The remaining packaged GUI dogfood must therefore begin with an explicitly authorized launch; no implicit relaunch was performed.
- Fresh no-launch keychain attribution audit on 2026-05-31 confirmed the code-side startup path is intentionally narrow. `electron/main.js` calls `setupPlatform()` before `app.whenReady()` lifecycle work; `electron/app/env.js` sets Chromium `password-store=basic` and macOS `use-mock-keychain` before Chromium startup because Hydra does not use Chromium's password manager. `electron/app/ipc.js` does not import `safeStorage`, `keytar`, or `SecKeychain`; persisted Hydra auth-token release stays owner-file based and, when the user explicitly enables Touch ID, fails closed behind `promptBiometric('Unlock Hydra')`. `electron/app/telemetry.js` keeps Sentry opt-in, DSN-gated, and lazy-imported; `electron/app/autoUpdate.js` does not read Hydra secrets or keychain state. Server-side Playwright launches independently include `--use-mock-keychain`. Focused verification passed: `npm run test:electron-main-process` (`27/27`) and `node --test server/tests/electron-data-path.test.mjs server/tests/electron-ipc-contract.test.mjs server/tests/playwright-isolation.test.mjs` (`25/25`). This attributes the duplicate-prompt prevention to Chromium password-store isolation without weakening biometric fail-closed semantics. Item 7 still needs one fresh packaged startup observation before it can be marked fully verified.
- Fresh no-launch timer-ownership audit on 2026-05-31 verified the current renderer and installed published bundle before packaged runtime interaction. `rg -n "setTimeout\\(|clearTimeout\\(|setInterval\\(|clearInterval\\(|requestAnimationFrame\\(|cancelAnimationFrame\\(" src --glob '!src/lib/runtimeDiagnostics.js' --glob '!**/*.min.js'` returned no matches, so active renderer surfaces still route owned timers, intervals, RAFs, and Anime effects through the diagnostics wrappers. The installed `release/mac-arm64/Hydra.app/Contents/Resources/app/electron/app/windows.js` contains `HYDRA_SPLASH_DURATION_MS=16000`, `HYDRA_SPLASH_EXIT_MS=13000`, `HYDRA_SPLASH_EXIT_FLIGHT_MS=3000`, `HYDRA_SPLASH_DISPOSE_MS=18500`, `HYDRA_SPLASH_TARGET=120`, `window.__HYDRA_SPLASH_DIAGNOSTICS__`, `window.__HYDRA_DISPOSE_SPLASH__`, and the explicit `disposeHydraSplash("timeout")` safety path. Matter's independent Runner loop remains intentionally unused. Verification passed: `npm run test:ui-static` (`30/30`), `npm run test:background-failure-visibility` (`27/27`), `node --check src/hooks/useVisibleRecurringTask.js`, `node --check src/lib/runtimeDiagnostics.js`, and `node --check electron/app/windows.js`. This is current source and packaged-source proof for item 3. Fresh published-`v1.1.0` post-splash runtime diagnostics still require the explicitly authorized packaged launch.
- Fresh no-launch Touch ID package-source audit on 2026-05-31 verified that the installed published `v1.1.0` bundle carries the complete UI and bridge path. The bundled Settings source map contains the visible `AVAILABLE` / `UNAVAILABLE` status display, the `Require ${resolvedBiometricInfo.label} when unlocking the vault` opt-in checkbox, and the `Test Prompt` button wired to `native.biometricPrompt('Test biometric unlock')`. Packaged `electron/preload.js` exposes `biometricDescribe` and `biometricPrompt`; packaged `electron/app/ipc.js` exposes the describe/prompt handlers and keeps persisted auth-token release gated by `getPref('biometricEnabled')`; packaged `electron/app/biometric.js` maps macOS support to `systemPreferences.canPromptTouchID()` and prompts through `systemPreferences.promptTouchID()`. Focused verification passed through the repo-supported commands: `npm run test:user-prefs` (`3/3`) and `npm run test:electron-ipc-contract` (`4/4`), in addition to the current `npm run test:ui-static` (`30/30`) pass. Item 6 remains partial until the explicitly authorized packaged app session verifies status rendering, enable, test prompt, lock, and Touch ID unlock end-to-end on hardware.
- 2026-05-31 session-age UX follow-up: the user-facing login age formatter now validates stored timestamps before formatting and keeps old login labels compact instead of leaking redundant raw hour counts. Focused `npm run test:time-utils` coverage proves `1h` stays `1h ago`, `23h` stays `23h ago`, `24h` becomes `1d ago`, both `900h` and `1000h` become `5w ago`, `90d` becomes `3mo ago`, `800d` becomes `2y ago`, and invalid timestamps render no malformed `NaNy ago` copy. `npm run test:test-chain-completeness` passed after wiring the new test into the normal `npm test` chain; `npm run test:session-refresh-contract` (`11/11`), `npm run lint`, and `git diff --check` also passed. `docs/SESSION_TRUTH.md` records the display contract alongside the existing `4/4` forced live-login probe evidence and the explicit separation between login-session truth and management-key storage.
- The scoped session-age follow-up was published to `master` as commit `81e924d7bacdfd0bc9d614f45b34ff5af82efcd4` with exactly five changed files: `src/utils/time.js`, `server/tests/time-utils.test.mjs`, `package.json`, `docs/SESSION_TRUTH.md`, and `docs/RELEASE_AUDIT.md`. Before publication, the full local no-launch chain passed: `npm run lint`, full `npm test`, `npm run gate` (`12/12`), installed-resource Electron smoke, Docker image smoke, `npm run openapi:hydra` (`83 operations`), and `git diff --check`. GitHub CI run `26703860110` passed `lint`, build, `test:ci`, gate, and final build. Docker workflow run `26703860118` passed both runtime smoke and the registry image push. Auto-version run `26703860114` skipped as intended for the `[skip-bump]` checkpoint.
- 2026-05-31 closed-app verifier honesty follow-up: `hydra audit --json` previously reported `release/Hydra-1.0.20-mac-arm64.zip` without explaining that the resumed local manifest remains on the `1.0.20` source lane while the sole installed published app reports `1.1.0`. `bin/commands/audit.js` now labels that zip as the local-manifest workspace artifact, reads `release/mac-arm64/Hydra.app/Contents/Info.plist` with `plutil` when available, and appends the installed bundle version. The Docker audit evidence also keeps the older full compose-start proof from run `26196262336` while appending the newest recorded checkpoint run parsed from this audit (`26703860118`, runtime smoke plus registry image push). Focused verification passed: `node --check bin/commands/audit.js`, `npm run test:cli` (`46/46`), `node bin/hydra.mjs audit --json`, and `git diff --check`. Current audit output remains honest at `31 ok / 5 deferred / 0 missing / 0 blockers`: local workspace zip `1.0.20`, installed app `1.1.0`, and remaining manual GUI evidence explicitly deferred.
- 2026-05-31 active release-lane alignment: after the published `v1.1.0` minor release, tracked `package.json` and `package-lock.json` were advanced from the prior `1.0.20` source lane to `1.1.0`. `docs/VERSIONING.md` now teaches the active lane explicitly: the next normal patch is `1.1.1`, a future coherent compatible batch is `1.2.0`, and only a breaking contract change should use `2.0.0`. `hydra audit --json` now accepts recorded `v1.1.0` release-matrix evidence when a resumed workspace does not retain a local `Hydra-1.1.0-mac-arm64.zip`, while still appending the installed bundle version from `release/mac-arm64/Hydra.app`. The stale local `1.0.20` ARM zip/blockmap and updater metadata were moved reversibly to `/private/tmp/hydra-desktop-duplicates-20260531T031455Z/release-pre-source-lane-align-20260531T052201Z`; the public `v1.1.0` ARM zip/blockmap plus `latest-mac.yml` were downloaded into `release/`. Focused verification passed: `node --check bin/commands/audit.js`, `npm run test:cli` (`46/46`), `npm run test:workflow-contract` (`13/13`), `node bin/hydra.mjs audit --json` (`31 ok / 5 deferred / 0 missing / 0 blockers`), `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` against `release/Hydra-1.1.0-mac-arm64.zip`, `node bin/hydra.mjs doctor --json` (`version=1.1.0`, zero Hydra Playwright profiles, process enumeration still honestly unavailable as `spawnSync ps EPERM`), and `git diff --check`. This keeps closed-app verification honest without falling back into new `1.0.x` releases.
- 2026-05-31 Docker context follow-up after local `v1.1.0` archive alignment: downloading the public ARM release zip exposed that `.dockerignore` did not exclude `release/`, so `docker compose build` transferred `304.28 MB` of context. `.dockerignore` now excludes `release`, keeping desktop installers, archives, and extracted app resources out of the container build context. The focused `npm run test:docker-smoke` contract now checks that exclusion (`5/5`), and a corrected `BUILDX_CONFIG=/private/tmp/hydra-buildx npm run docker:smoke` rerun passed with a `2.02 MB` context transfer: a `99.3%` reduction.
- 2026-05-31 GitHub Actions runtime follow-up: remote CI run `26704298008` and Docker workflow run `26704298028` both passed for the `v1.1.0` source-lane alignment checkpoint, including Docker runtime smoke and the registry image push. Those runs surfaced GitHub's Node 20 JavaScript-action deprecation warning for the remaining `actions/checkout@v4` and `actions/setup-node@v4` references. The CI, Docker, release, Electron smoke, auto-version, and stale-branch-cleanup workflows now use the official `actions/checkout@v6` and `actions/setup-node@v6` action-runtime lanes while continuing to provision Node 24 for Hydra commands.
- 2026-05-31 macOS Search cleanup: targeted filesystem inventory found only `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app` under Desktop, Applications, user Applications, and Downloads; Spotlight `mdfind 'kMDItemFSName == "Hydra.app"c'` returned that same sole bundle. `lsregister -dump` exposed stale `com.zayd.hydra` LaunchServices registrations for removed test bundles at `1.0.7`, `1.0.9`, `1.0.10`, `1.0.11`, and `1.0.17`, explaining why macOS Search could route to an old launch record even though the bundle no longer existed. The stale Hydra paths were unregistered individually, the remaining reversible temp backup folder was moved to `/Users/zaydk/.Trash/hydra-stale-bundles-20260531T075725Z`, and the current bundle was force-registered without launching it. Follow-up LaunchServices inventory reports exactly one `com.zayd.hydra` registration: `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`, version `1.1.0`.
- 2026-05-31 session-observation UX hardening: a forced `GET /api/accounts/:id/session-check` Clerk probe now returns an explicit `observedAt` timestamp separately from historical `lastLoginAt`. CLI `hydra session <id> --refresh --json` exposes `observedAt`; Account Detail shows when the live result was observed; Vault live-check hover text includes the live-probe timestamp; compact account surfaces label old historical values as `login 5w ago` rather than presenting an unlabeled age. Hydra intentionally does not discard a login solely because it began 1,000 hours ago: action gates use the forced Clerk probe for current truth, while age stays compact historical context.
- 2026-05-31 final packaged splash capture: the rebuilt macOS arm64 app was launched with Electron remote debugging enabled only for the capture run, and the splash renderer was recorded directly through CDP `Page.captureScreenshot`. This avoided macOS transparent-window compositor failures and kept the Desktop out of the repository artifact. The checked-in `videos/hydra_splash.gif` is the resulting 15.6 second, 156 frame, 960x583 preview. Representative fall, settle, portal, dial-grid greeting, and post-transition frames were inspected before encoding.
- 2026-05-31 final splash runtime diagnostics from that packaged capture: `target=72`, `queueLength=72`, `shatteredWordCount=72`, `duplicateShatterSkips=0`, `peakDynamicBodyCount=556`, `portalCollisionDisabled=true`, `renderFrames=408`, `physicsSteps=716`, `timers=0`, `rafActive=false`, `matterCleared=true`, and `disposed=true`. The randomized run stayed 84.5% below the pathological pre-guard peak of `3582` dynamic bodies. The one-shot shatter guard remains necessary even though this final run did not encounter a duplicate collision pair. Portal entry disables collision masks before swirl acceleration, the removed ceiling collider eliminates the top-quarter pause, and the 72-item unique queue prevents repeated word batches.
- 2026-05-31 `v1.1.3` publication follow-up: the first Auto-version run reached the annotated-tag step but failed before creating `v1.1.3` because the GitHub-hosted runner had no committer identity configured. `.github/workflows/auto-version.yml` now configures the repository-local `hydra-bot` name and noreply address before `git tag -a`, and the workflow contract test requires that ordering so future catch-up tags do not regress.
- 2026-05-31 public `v1.1.3` verification: repaired Auto-version run `26709320831`, CI run `26709320818`, Docker run `26709320837`, and desktop release run `26709323849` all passed. The public release contains macOS arm64 zip/blockmap, macOS Intel x64 zip/blockmap, Windows x64 NSIS installer/blockmap, `latest-mac.yml`, and `latest.yml`; Linux remains intentionally frozen. Downloaded `latest-mac.yml` reports `version: 1.1.3` and both macOS URLs. The downloaded public ARM zip passed `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and its recomputed SHA-512 matched `latest-mac.yml`.
- 2026-05-31 canonical local install verification: the prior local ARM bundle and archive were moved reversibly to `/Users/zaydk/.Trash/hydra-v113-pre-public-install-20260531T095826Z`, the exact downloaded public `Hydra.app` was installed at `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`, force-registered with LaunchServices, and opened through `open -n`. The installed bundle reports `1.1.3`, passes `codesign --verify --deep --strict --verbose=2`, and is the sole filesystem and Spotlight `Hydra.app`. LaunchServices reports one `com.zayd.hydra` registration at that path and version. Live `hydra doctor --json` reported `version=1.1.3`, four Hydra-owned processes, `0.4%` sampled Hydra CPU, and zero stale Hydra Playwright profiles after the splash-to-dashboard transition.
- 2026-05-31 fresh public-`v1.1.3` idle and teardown profile: `/private/tmp/hydra-v113-idle-profile-20260531T100715Z` sampled the settled packaged app every 30 seconds for five minutes. Hydra remained at four owned processes and zero Hydra Playwright profiles for all 11 samples. Instantaneous Hydra CPU ranged from `0.0%` to `15.8%` (`3.32%` average, ending at `0.0%`); RSS moved from `569.22 MB` to `570.94 MB` (`+1.72 MB`). A separate LaunchServices relaunch captured four owned processes before quit, zero after quit, one splash renderer at `t+8s`, and one replacement main renderer after teardown. The post-transition window stayed between `0.0%` and `0.7%` CPU after settling. Raw machine-local inventories remain under `/private/tmp/hydra-v113-splash-teardown.3uv20x`; public docs intentionally omit unrelated Chrome process command lines.
- 2026-05-31 packaged bridge dogfood found and repaired a real desktop-only defect. Direct Electron CDP instrumentation against the public `v1.1.3` main renderer showed `typeof window.hydraNative === "undefined"`, which hid native Settings sections and disabled renderer-to-main actions. Both sandboxed preloads used ESM imports even though Electron sandboxed preloads run as plain JavaScript without an ESM context. `electron/preload.js` and `electron/splashPreload.js` now use `const { contextBridge, ipcRenderer } = require('electron')`; `server/tests/electron-ipc-contract.test.mjs` rejects regressions. `docs/PRELOAD_BRIDGE.md` records reproduction, root cause, raw redacted evidence, and verification steps.
- 2026-05-31 repaired local package bridge verification: `ELECTRON_CACHE=/private/tmp/hydra-electron-cache npm run electron:build:mac-arm64`, strict deep codesign, and ARM archive smoke passed. LaunchServices plus temporary Electron CDP instrumentation verified splash `window.hydraSplash` exposes `onUpdateProgress`, `offUpdateProgress`, and `reportDiagnostics`; main `window.hydraNative` exposes all native methods; native biometric describe returns `available=true`, `platform=darwin`, `label=Touch ID`; and packaged Settings renders `Touch ID Unlock`, `AVAILABLE`, an enabled `Require Touch ID when unlocking the vault` checkbox, and `Test Prompt`. Route instrumentation mounted Dashboard, Pool, Traffic, Settings, and Dashboard again with no persistent intervals or RAFs; the one short Pool `AnimeText.scanline` effect disappeared after unmount. Full local verification passed: `npm run lint`, full `npm test`, `npm run gate`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, `npm run openapi:hydra`, `node bin/hydra.mjs audit --json`, and `git diff --check`.
- 2026-05-31 public `v1.1.4` preload-repair publication: Auto-version run `26710107156`, CI run `26710107146`, Docker run `26710107166`, and desktop release run `26710112876` all passed. Docker workflow run `26710107166` passed both runtime smoke and the registry image push. The desktop release published macOS arm64 zip/blockmap, macOS Intel x64 zip/blockmap, Windows x64 NSIS installer/blockmap, merged `latest-mac.yml`, and Windows `latest.yml`; Linux remains intentionally frozen. The merged macOS updater file reports `version: 1.1.4` and both architecture URLs. The downloaded public ARM zip SHA-256 matched GitHub asset digest `dcd8fc86d6ab8ad554913ec8df879efa46856a06cde279809e907743a85bf333`, its SHA-512 matched `latest-mac.yml`, strict deep codesign passed, and `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed against the installed public artifact.
- 2026-05-31 canonical public `v1.1.4` install: the prior local rebuilt ARM app, stale local ARM archives, stale updater metadata, and obsolete local unpacked Windows folder were moved reversibly to `/Users/zaydk/.Trash/hydra-pre-public-v114-20260531T103957Z`. The exact downloaded public app is installed at `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`, reports `CFBundleShortVersionString=1.1.4`, passes strict deep codesign, and is the sole Spotlight `Hydra.app`. LaunchServices was force-registered to that one canonical path and reports `com.zayd.hydra` version `1.1.4`.
- 2026-05-31 exact-public-`v1.1.4` runtime dogfood: temporary LaunchServices/CDP instrumentation verified the splash bridge exposes `onUpdateProgress`, `offUpdateProgress`, and `reportDiagnostics`; the replacement Dashboard renderer exposes the complete `window.hydraNative` bridge; `appVersion()` returns `1.1.4`; the packaged server reports `embedded=true` and `packaged=true`; Touch ID describe reports `available=true`, `platform=darwin`, `label=Touch ID`; and Settings visibly renders `AVAILABLE`, the enabled vault-unlock checkbox, and `Test Prompt`. A public-artifact route walk across Dashboard, Pool, Traffic, Settings, and Dashboard again reported zero intervals, zero active RAFs, zero active Anime effects, and only bounded route-owned timeouts. The temporary debug launch quit cleanly with its CDP port closed, and the app was reopened normally. Follow-up `hydra doctor --json` reported `version=1.1.4`, four Hydra-owned processes, `0.0%` sampled Hydra CPU, and zero stale Hydra Playwright profiles.
- 2026-05-31 fresh exact-public-`v1.1.4` idle profile: `/private/tmp/hydra-v114-idle-profile-20260531T9PltYn` sampled the already-settled packaged app every 30 seconds for five minutes with no UI interaction. All 11 samples reported four Hydra-owned processes and zero Hydra Playwright profiles. Instantaneous CPU stayed between `0.0%` and `0.3%` (`0.03%` average, ending at `0.0%`); RSS moved from `575.92 MB` to `577.41 MB` (`+1.48 MiB`). A later normal no-debug relaunch settled back to `0.0%` sampled CPU / `567.45 MB`, with four owned processes, zero stale profiles, and the temporary CDP port closed.
- 2026-05-31 exact-public-`v1.1.4` packaged screenshot evidence: native CoreGraphics window capture plus `/usr/sbin/screencapture -l <CGWindowID>` wrote first-run setup, Dashboard, Vault, Pool, Settings Touch ID, and Traffic console PNGs under `docs/evidence/`. First-run setup used an isolated temporary Electron `--user-data-dir`; the Traffic screenshot used a second isolated profile seeded with six synthetic `RequestLog` rows covering `200`, `429`, and `502` statuses plus visible latencies. Both disposable profiles were moved reversibly to `~/.Trash`. Dashboard, Vault, and Pool sensitive fields were blurred or replaced in the live renderer before native capture; no raw private screenshot was written into the repo. Three CLI images were rendered from fresh privacy-safe command output because Terminal AppleEvents, Computer Use Terminal access, and post-exit native Terminal capture were permission-constrained. `docs/evidence/README.md` records artifact hashes and methods. macOS Vision OCR reported zero email markers, key prefixes, credential assignments, or long token-shaped strings across all nine repository PNGs; ImageMagick reported nonblank color variance for each file. Computer Use still times out against Hydra after `120s`, so final human visual review remains a manual boundary.
- 2026-05-31 redacted dogfood evidence refresh: all six public `v1.1.4` desktop artifacts were downloaded into `/private/tmp/hydra-v114-dogfood-evidence.A3QYV4`, and `docs/DOGFOOD_EVIDENCE.json` was generated with only the empirically verified manual flags: `packaged-gui-launch`, `splash-unlock-dashboard`, and `screenshots-redacted`. Machine-specific paths were sanitized before check-in. `hydra audit --json` intentionally remains `31 ok / 5 deferred / 0 missing / 0 blockers`: its conservative evidence gate does not promote individual manual items until the complete manual checklist is present. Window-control interaction, full dead-button navigation, live OTP/redemption/proxy/SSE flows, Touch ID fingerprint approval and unlock, Windows-host launch, and final human visual review remain explicit boundaries.
- 2026-05-31 repository screenshot visual-review follow-up: direct inspection of the nine `v1.1.4` evidence images found one privacy issue in `docs/evidence/hydra-v114-packaged-settings-touch-id.png`: the Settings endpoint card still exposed machine-specific local and LAN endpoint values. The pre-redaction PNG was moved reversibly to `~/.Trash`, both endpoint lines were replaced with explicit redaction labels, and the public-safe replacement now hashes to `ede54b6d508f1956f036421e6ce4aeb17c20a0c3ff544707ec141329b621a782`. Setup, Dashboard, Vault, Pool, Settings, Traffic, and all three CLI images were visually inspected for layout integrity. Full interactive route/dead-button review remains a separate manual boundary.
- 2026-05-31 exact-public-`v1.1.4` idle recheck after screenshot review: `/private/tmp/hydra-v114-idle-recheck-20260531T113620Z` sampled the already-settled canonical package every 30 seconds for five minutes with zero UI interaction. All 11 samples reported four Hydra-owned processes and zero Hydra Playwright profiles. CPU stayed between `0.0%` and `0.7%` (`0.082%` average, ending at `0.0%`); RSS fell from `592.53 MiB` to `553.19 MiB` (`-39.34 MiB`). The first attempted recheck sampler was discarded to `~/.Trash` because its unanchored filter counted its own wrapper; this recorded profile uses an anchored Hydra executable-path match.
- 2026-05-31 hosted Windows packaged-executable launch gate: master checkpoint `6740af459a8ffa1070094cfe3f9aa59f99e63ef3` adds `scripts/smoke-windows-launch.mjs`, wired after target-specific Windows package smoke and before release upload. Release workflow dispatch `26711936191` passed shared `lint, test, gate`, macOS arm64 zip smoke, macOS Intel x64 zip smoke, and Windows x64 NSIS smoke. On hosted `windows-2022`, the Windows-only gate launched the real `release/win-unpacked/Hydra.exe` with isolated app data, kept it alive for `25,000ms`, enumerated four owned `Hydra.exe` processes (main, GPU, network utility, renderer), terminated the packaged process tree with `taskkill.exe /PID <pid> /T /F`, and logged zero packaged-process survivors after cleanup. Push checkpoint CI run `26711931947` and Docker run `26711931970` also passed, including Docker runtime smoke and registry push. This closes the hosted unpacked-executable startup/cleanup evidence gap while keeping the actual NSIS install/open UX pass an explicit real-Windows-desktop manual boundary.
- 2026-05-31 native accessibility profiling guardrail: two Computer Use attaches against the already-settled exact-public `v1.1.4` package timed out after `120s` each, first by app path and then by bundle identifier `com.zayd.hydra`. The external `SkyComputerUseService` helper remained alive at roughly `29%` CPU and continuously requested macOS accessibility attributes. Hydra's Electron main process consequently held roughly `67-70%` CPU while its GPU, network utility, and renderer processes remained idle. A macOS stack sample traversed `HIServices mshMIGPerform`, `_XCopyAttributeValue`, `_AXXMIGCopyAttributeValue`, `CopyAttributeValue`, `NSAccessibilityChildren`, and `accessibilityWindowsAttribute`. Terminating only the stuck external helper returned the same four-process Hydra tree immediately to `0.0%` sampled CPU with zero stale Hydra Playwright profiles and no Hydra relaunch. The contaminated sampler at `/private/tmp/hydra-v114-final-idle-reprofile-20260531T121215Z` is intentionally not an app-idle baseline. `docs/ACCESSIBILITY_PROFILING_DISTORTION.md` records the exact reproduction, raw local evidence paths, recovery command, and profiling rule. Native window-control interaction remains a manual boundary because this environment's Computer Use attach path both times out and perturbs measurement.
- 2026-05-31 clean post-accessibility recovery profile: `/private/tmp/hydra-v114-post-cua-idle-reprofile-20260531T122026Z` sampled the same already-settled exact-public `v1.1.4` app every 30 seconds for five minutes after only the stuck external Computer Use helper was terminated. All 11 samples reported four Hydra-owned processes and zero Hydra Playwright profiles. CPU stayed between `0.0%` and `0.2%` (`0.091%` average, ending at `0.0%`); RSS moved from `505.36 MiB` to `507.20 MiB` (`+1.84 MiB`). This clean anchored rerun confirms the earlier `67-70%` contaminated state was external accessibility polling, not a Hydra-owned idle regression.
- 2026-05-31 renderer steady-dot efficiency repair: CDP-only route instrumentation against the exact-public `v1.1.4` package exposed a separate visible-renderer cost after the native accessibility helper was removed. Settings reported zero intervals, zero active RAFs, and zero Anime.js effects, but `document.getAnimations()` isolated two six-pixel `.status-dot.success` elements running the infinite `breathe` CSS animation. GPU and renderer processes held roughly `63-76%` aggregate Hydra CPU. Pausing those two animations ephemerally dropped Hydra to `0.0-0.3%` without a route change or relaunch. `src/index.css` now replaces perpetual steady success/error/warning animation with static color-matched glows and bounds transient `.status-dot.loading` motion to three `1.2s` cycles; `server/tests/ui-static-contract.test.mjs` rejects regressions. A locally rebuilt arm64 package passed strict deep codesign and `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`. Through LaunchServices plus temporary CDP, rebuilt Settings preserved the intentional bounded startup visual window (`55.2%`, `44.9%`, `1.6%`) and then settled to five consecutive `0.0%` samples; `hydra doctor` reported four Hydra-owned processes, `0.5%` sampled CPU, and zero stale profiles. The rebuilt package also passed Dashboard, Bulk OTP, Vault, Pool Manager, Redeem, Generator, Traffic, Settings, and redacted Account Detail route reachability with no renderer errors. Raw local evidence is under `/private/tmp/hydra-v114-expanded-route-diagnostics-20260531T122708Z` and `/private/tmp/hydra-v114-status-dot-fix-runtime-20260531T123451Z`; `docs/RENDERER_IDLE_PERFORMANCE.md` records reproduction and evidence.
- 2026-05-31 public `v1.1.5` steady-dot publication: Auto-version run `26712858914`, CI run `26712858931`, Docker run `26712858933`, and desktop release run `26712864469` all passed. The desktop release published macOS arm64 zip/blockmap, macOS Intel x64 zip/blockmap, Windows x64 NSIS installer/blockmap, merged `latest-mac.yml`, and Windows `latest.yml`; Linux remains intentionally frozen. Windows x64 NSIS also passed the hosted unpacked-executable launch-and-cleanup gate before upload. The downloaded public ARM zip SHA-256 matched GitHub asset digest `b64cd8f285d605e80416e4c9a7d4937076672801fe22b61f1a8d904d7454d341`, its SHA-512 matched `latest-mac.yml`, strict deep codesign passed, and `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed after installation.
- 2026-05-31 canonical public `v1.1.5` install and idle profile: the pre-public local rebuilt package was moved reversibly to `/Users/zaydk/.Trash/hydra-pre-public-v115-20260531T125225Z`. The exact downloaded public app is installed at `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`, reports `CFBundleShortVersionString=1.1.5`, and is the sole Desktop and Spotlight `Hydra.app`. LaunchServices was force-registered to that one canonical path and reports `com.zayd.hydra` version `1.1.5`. After a normal no-CDP LaunchServices launch and bounded startup decay, `/private/tmp/hydra-v115-public-idle-profile-20260531T125505Z` sampled the settled package every 30 seconds for five minutes with zero UI interaction. All 11 samples reported four Hydra-owned processes and zero Hydra Playwright profiles. CPU stayed between `0.0%` and `0.5%` (`0.136%` average); RSS moved from `569.73 MiB` to `575.33 MiB` (`+5.59 MiB`). A follow-up `hydra doctor --json` sampled `0.0%` CPU with four owned processes and zero stale profiles.
- 2026-05-31 exact-public-`v1.1.5` independent idle reprofile: `/private/tmp/hydra-v115-public-idle-reprofile-20260531T130940Z` sampled the already-settled public app every 30 seconds for another five minutes with zero UI interaction. All 11 samples again reported four Hydra-owned processes and zero Hydra Playwright profiles. CPU stayed between `0.0%` and `0.3%` (`0.036%` average); RSS fell from `572.59 MiB` to `530.50 MiB` (`-42.09 MiB`). This second public-artifact run confirms the static steady-dot repair remains settled independently of the first install profile.
- 2026-05-31 exact-public-`v1.1.5` splash teardown profile: `/private/tmp/hydra-v115-public-splash-teardown-20260531T131517Z` captured the required raw `ps -ax | grep -iE 'chrome|chromium|playwright|electron|hydra'` inventories plus anchored Hydra-owned subsets. The settled app had four owned processes at `0.0%`; LaunchServices quit reduced the Hydra-owned count to zero; a normal `open -n release/mac-arm64/Hydra.app` relaunch showed four owned processes during the visual splash window; and post-transition inventory again contained four owned processes. Splash renderer PID `54141` was replaced by main renderer PID `54169`, proving the owning renderer tore down instead of leaking. A later settled snapshot returned the replacement four-process tree to `0.0%` CPU, and `hydra doctor --json` reported zero stale Hydra Playwright profiles.
- 2026-05-31 conservative `v1.1.5` dogfood evidence refresh: all six public desktop distributables were downloaded into a temporary verification directory and `npm run dogfood:final -- --write-evidence=docs/DOGFOOD_EVIDENCE.json --version=1.1.5 --artifact-dir=<temporary-public-release-download> --app=release/mac-arm64/Hydra.app --manual=packaged-gui-launch --manual=splash-unlock-dashboard --manual=screenshots-redacted` regenerated the checked-in redacted manifest. Machine-specific paths were sanitized before check-in. The manifest verifies the macOS arm64 zip/blockmap, macOS Intel x64 zip/blockmap, Windows x64 NSIS installer/blockmap, and canonical packaged app path while preserving only the three empirically verified manual flags. Audit remains intentionally `31 ok / 5 deferred / 0 missing / 0 blockers`.
- 2026-05-31 splash-density living-doc reconciliation: `docs/CODEX_GOAL.md` and `docs/VERSIONING.md` now name the shipped bounded 72-word unique irregular shower instead of the superseded 120-word pass. The lower queue preserves the visual portal effect while reducing physics and compositor pressure; source, static contract, README, and final dogfood evidence already agreed on `HYDRA_SPLASH_TARGET=72`.
- 2026-05-31 exact-public-`v1.1.5` packaged route and renderer-lifecycle pass: the canonical public app was reopened temporarily through LaunchServices with `--remote-debugging-port=9333`; no Computer Use accessibility attach was used. Packaged `window.hydraNative.appVersion()` returned `1.1.5`, and `biometricDescribe()` returned `available=true`, `platform=darwin`, `label=Touch ID`. Sanitized sidebar instrumentation mounted Dashboard, Bulk OTP, Vault, Pool Manager, Redeem, Generator, Traffic, and Settings with the expected active control and route title. Settled Settings reported zero intervals, zero active RAFs, zero Anime effects, one bounded `App.upstreamHealth` timeout, and only a finished one-shot `fadeIn`; its eight-sample CPU decay stayed between `0.0%` and `1.6%`, ending at `0.2%`. Dashboard exposed nine structural `.account-card` elements without printing account data; clicking the first reached redacted `/account/<redacted>` and title `Hydra — Account Detail`. Account Detail mount effects were intentionally visible in the first sample (`ScrambleText.reveal=4`, `AnimeText.scanline=1`) and cleared after six seconds to zero intervals, zero active RAFs, and zero Anime effects; its eight-sample CPU decay stayed between `0.0%` and `0.8%`, ending at `0.0%`. The temporary browser session closed, Hydra-owned processes reached zero, port `9333` closed, and a normal no-debug LaunchServices reopen settled to four owned processes, `0.0%` CPU, and zero stale Hydra Playwright profiles. Raw sanitized local evidence is under `/private/tmp/hydra-v115-public-route-walk-20260531T132145Z`.
- 2026-05-31 exact-public-`v1.1.5` third untouched idle reprofile: `/private/tmp/hydra-v115-public-idle-reprofile-20260531T133222Z` sampled the already-settled canonical public app every 30 seconds for five minutes with zero UI interaction. All 11 samples reported four Hydra-owned processes and zero Hydra Playwright profiles. Sampled CPU stayed at `0.000%` for every sample; RSS fell from `569.20 MiB` to `474.22 MiB` (`-94.98 MiB`). A follow-up inventory found no stuck `SkyComputerUseService`, no listener on temporary debug port `9333`, one LaunchServices registration for `com.zayd.hydra` at `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app` version `1.1.5`, and that same sole `Hydra.app` through Spotlight and targeted filesystem scans.
- 2026-05-31 exact-public-`v1.1.5` calm-startup observation: `/private/tmp/hydra-v115-public-calm-launch-20260531T133924Z` used CoreGraphics window inventory only, without Computer Use or accessibility attachment. The already-running canonical app exposed one Dashboard window; `osascript -e 'tell application id "com.zayd.hydra" to quit'` reduced the old owned process tree from four to zero; `open -n release/mac-arm64/Hydra.app` then showed the expected splash window and replacement Dashboard window. Across the 55-second observer window, the corrected security-dialog filter reported `security_prompt_count=0`: no native window owner or title matched `SecurityAgent`, Keychain, `CoreServicesUIAgent`, or authorization. After startup, `hydra doctor --json` reported public version `1.1.5`, four owned processes, and zero stale profiles. Source attribution remains Chromium startup keychain isolation through `password-store=basic` and macOS `use-mock-keychain`; biometric auth-token release remains independently fail-closed. A user click through macOS Search remains useful as an extra UI-path confirmation, not a code-side release blocker.
- 2026-05-31 exact-public-`v1.1.5` live-session truth recheck: a sequential sanitized `hydra session <id> --refresh --json` sweep exercised production `store.probeSessionLive()` across all `12` stored rows without printing account IDs, aliases, emails, cookies, session tokens, or management keys. Owner-only local evidence at `/private/tmp/hydra-live-session-recheck-20260531T134828Z/redacted-summary.json` reports `4` live-active Clerk logins, `0` expired, `0` errors, `8` rows with no active stored login, and `4` redeem-ready rows. One active login has no management key, reconfirming that login truth is independent of management-key truth. Active rows persisted one-entry Clerk identity stacks, just-now silent-renewal timestamps, and `7.0d` next local renewal checkpoints. A temporary packaged-only CDP pass under `/private/tmp/hydra-v115-public-session-ui-20260531T134932Z` clicked the read-only Account Detail `Re-probe session status from Clerk` action and rendered coherent copy: `LIVE CLERK CHECK JUST NOW`, `Login works now`, `Next local renewal checkpoint: 7.0d`, `Interactive sign-in 7w ago · last silent renewal just now`, followed by the clarification that the checkpoint is a stored renewal estimate rather than total login lifetime. The temporary debug session closed, owned processes reached zero, port `9333` closed, and a normal no-debug LaunchServices reopen settled to four owned processes, `0.0%` sampled CPU, and zero stale profiles. This verifies current stored-login truth and copy semantics; new OTP login, bulk OTP isolation, code redemption, and proxy/SSE dogfood remain manual live-flow boundaries.
- 2026-05-31 exact-public-`v1.1.5` Windows transfer inspection: downloaded `Hydra-1.1.5-win-x64.exe` SHA-256 `7f1a74c576710be9a2fd0fe8883aca501c9e53c1d84cd8404650367b308944b5` matched the GitHub asset digest, and its recomputed SHA-512 base64 matched `latest.yml`. Nested NSIS extraction found `Hydra.exe`, `resources/app/package.json`, `resources/app/electron/app/windows.js`, `resources/app/electron/app/updateHandoff.js`, `resources/app/dist/index.html`, `resources/app/node_modules/.prisma/client/query_engine-windows.dll.node`, `resources/chromium.zip`, `resources/data/empty-hydra.db`, and `resources/prisma/schema.prisma`. The packaged Electron source files, non-map renderer assets, and source maps match the canonical public macOS package after Windows-line-ending normalization. The extracted NSIS uninstaller ICO is byte-identical to the six-size source ICO. Packaged metadata reports version `1.1.5`, author `Frostbyte Technology — Developed by Zayd / Cold`, updater provider `github`, owner `zaydiscold`, repo `hydra`, and UTF-16LE executable inspection finds both `Frostbyte Technology` and `Developed by Zayd / Cold`. Public desktop release run `26712864469` passed Windows NSIS package smoke plus hosted packaged-executable launch-and-cleanup before upload. Real NSIS install/open UX remains an explicit real-Windows-desktop manual boundary.
- 2026-05-31 intermittent repeated-label splash recheck: the shipped source has one recursive scheduler, one monotonic `spawnIdx`, no refill path, an `85/85` unique-label corpus, a bounded `72`-entry shuffled slice, and the one-shot `kind="shattered"` mutation before glyph creation. The existing root cause remains the repaired pre-guard Matter collision-batch clone path, not intended design. `server/tests/ui-static-contract.test.mjs` now rejects duplicate corpus labels or a corpus too small to fill the bounded queue without refill.
- 2026-05-31 isolated local-CI secret hygiene follow-up: `scripts/run-ci-tests.mjs` intentionally writes disposable runtime state under repo-root `.hydra-ci-data/`, but the directory itself was not ignored even though it contains generated `local-secrets.json`. `.gitignore` now root-scopes `/.hydra-ci-data/`, `server/tests/workflow-contract.test.mjs` requires both the isolated runner path and ignore rule, and the existing local directory was moved reversibly to Trash. This prevents generated CI-only storage keys from surfacing as untracked staging candidates without weakening test isolation.
- 2026-05-31 exact-public-`v1.1.5` fourth untouched idle reprofile:
  `/private/tmp/hydra-v115-public-idle-reprofile-20260531T140919Z` sampled the
  already-settled canonical app every 30 seconds for five minutes with zero UI
  interaction. All 11 samples reported four Hydra-owned processes and zero
  stale profiles. Sampled CPU stayed at `0.000%` throughout; RSS moved from
  `577.23 MiB` to `579.20 MiB` (`+1.97 MiB`). Raw before/after process
  inventories contain only the expected main, GPU, network-utility, and
  renderer processes.
- 2026-05-31 hygiene-checkpoint hosted verification: checkpoint
  `86efec93f166e2a324c77164edc1f6b9c872473c` passed local lint, full
  `npm test`, `npm run gate`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run
  electron:smoke`, `npm run openapi:hydra`, and `git diff --check`.
  Auto-version run `26715063086` skipped as intended, CI run `26715063087`
  passed, and Docker workflow run `26715063084` passed both runtime smoke and
  the registry image push. This is a `[skip-bump]` documentation and hygiene
  checkpoint; public desktop release remains `v1.1.5`.
- 2026-05-31 Windows manual-evidence fail-closed follow-up:
  `scripts/final-dogfood-check.mjs`, `docs/DOGFOOD_EVIDENCE.json`, and
  `docs/PACKAGED_ELECTRON_DOGFOOD.md` now require a real Windows desktop OS
  version plus NSIS installer install/open result before
  `--manual=windows-launch` can be claimed. Hosted unpacked-app smoke remains
  useful narrower evidence, but it no longer reads as an interchangeable
  manual Windows runner pass. The runbook also records current public
  `v1.1.5` Windows release run `26712864469` and parser-fix Docker workflow run
  `26715233046`; `server/tests/final-dogfood-evidence.test.mjs` rejects stale
  `Windows host or runner` wording in the checked-in manifest.
- 2026-05-31 exact-public-`v1.1.5` post-audit-parser idle reprofile:
  `/private/tmp/hydra-v115-post-audit-parser-idle-reprofile-20260531T1429XX.Bb0Hqz`
  sampled the already-settled canonical app every 30 seconds for five minutes
  with zero UI interaction. All 11 samples reported four Hydra-owned
  processes and zero stale profiles. Sampled CPU stayed between `0.0%` and
  `0.1%` (`0.009%` average); RSS fell from `585.61 MiB` to `483.14 MiB`
  (`-102.47 MiB`). Raw before/after inventories contain only the expected main,
  GPU, network-utility, and renderer processes.
- 2026-05-31 fast-winner timeout cleanup follow-up: management-key Playwright
  network capture and SQLite schema self-heal previously used bare
  `Promise.race()` timeout competitors. If useful work won quickly, those
  timeout handles remained pending until their `8s` or `15s` cap elapsed.
  `server/services/dashboard-api.js` now uses `waitWithClearedTimeout()` and
  `server/lib/db-self-heal.js` now uses `withStatementTimeout()`; both unref the
  timeout and clear it in `finally`. The delayed packaged update check in
  `electron/app/autoUpdate.js` is also unref'd. A 200-round synthetic
  `process.getActiveResourcesInfo()` probe at
  `/private/tmp/hydra-timeout-race-cleanup-benchmark-20260531T144529Z`
  recorded `200` pending timeout resources for the old fast-winner shape and
  `0` additional pending timeout resources for the cleared shape.
  `server/tests/background-failure-visibility.test.mjs` and
  `electron/tests/main-process.test.mjs` lock down the source contracts.
- 2026-05-31 exact-public-`v1.1.5` fifth untouched idle reprofile:
  `/private/tmp/hydra-v115-fifth-untouched-idle-reprofile-20260531T144321Z`
  sampled the already-settled canonical app every 30 seconds for five minutes
  with zero UI interaction. All 11 samples reported four Hydra-owned processes
  and zero stale profiles. Sampled CPU stayed between `0.0%` and `0.2%`
  (`0.018%` average); RSS moved from `492.86 MiB` to `492.20 MiB`
  (`-0.66 MiB`). Raw before/after inventories contain only the expected main,
  GPU, network-utility, and renderer processes. The first attempted sampler was
  moved reversibly to Trash because its unanchored filter counted its own
  wrapper command; this recorded profile anchors the executable command column.
- 2026-05-31 temporary patched-package proof: an arm64 build from the timeout
  cleanup source was written outside the repo at
  `/private/tmp/hydra-package-timeout-cleanup-20260531T144838Z`.
  `ELECTRON_APP_RESOURCES=<temp-app>/Contents/Resources
  HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed, strict deep
  `codesign --verify` passed, and direct bundled-source inspection found
  `waitWithClearedTimeout()`, `withStatementTimeout()`, and
  `updateCheckTimer.unref?.()`. The canonical public Spotlight app was not
  replaced or relaunched. After verification, the temporary package was moved
  reversibly to
  `/Users/zaydk/.Trash/hydra-package-timeout-cleanup-20260531T144838Z`;
  Spotlight still resolves only
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.
- 2026-05-31 fast-winner-timeout checkpoint hosted verification: checkpoint
  `0e01a0a404c18a79dcb9d7fb341758e523a033ce` passed local lint, full
  `npm test`, `npm run gate`, patched temporary-package
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, `npm run
  openapi:hydra`, strict deep temp-package codesign, staged credential/local
  artifact scans, and `git diff --check`. Auto-version run `26715823083`
  skipped as intended, CI run `26715823077` passed, and Docker workflow run
  `26715823067` passed both runtime smoke and the registry image push. This is
  a `[skip-bump]` performance checkpoint; public desktop release remains
  `v1.1.5`.
- 2026-05-31 Docker-checkpoint parser whitespace follow-up: after hosted proof
  wrapped the newest Docker run ID onto the next Markdown line, `hydra audit`
  remained pinned to older run `26715063084`. `bin/commands/audit.js` now
  accepts Markdown whitespace between `run`, the backticked ID, and `passed`;
  `server/tests/cli.test.mjs` requires newest recorded checkpoint run
  `26715823067`. Verification passed: `node --check bin/commands/audit.js`,
  `npm run test:cli` (`46/46`), `npm run lint`, full `npm test`, `npm run
  gate`, `npm run openapi:hydra`, canonical
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `git diff
  --check`.
- 2026-05-31 exact-public-`v1.1.5` sixth untouched idle reprofile:
  `/private/tmp/hydra-v115-sixth-untouched-idle-reprofile-20260531T145521Z`
  sampled the already-settled canonical app every 30 seconds for five minutes
  with zero UI interaction after the parser follow-up. All 11 samples reported
  four Hydra-owned processes and zero stale profiles. Sampled CPU stayed
  between `0.0%` and `0.1%` (`0.018%` average); RSS moved from `479.42 MiB`
  to `480.66 MiB` (`+1.23 MiB`). Raw before/after inventories preserve the
  expected Hydra main, GPU, network-utility, and renderer process subset plus
  unrelated machine-global browser tooling for honest workstation context.
- 2026-05-31 Pool Manager route-lifecycle cleanup: `src/hooks/usePools.js`
  now owns abort controllers for both the five-call Pool Manager data batch
  and its bounded proxy-status probe. Starting a replacement refresh aborts
  prior work; route unmount aborts both controllers; late responses are
  ignored; and the tracked five-second status timeout is cleared in `finally`.
  `src/api.js` passes optional abort signals through `/pool`, `/pool/status`,
  `/pool/master-key`, `/pool/models`, `/pool/sync-status`, and
  `/system/proxy-status`. A 200-route synthetic unmount probe at
  `/private/tmp/hydra-pool-route-unmount-benchmark-20260531T151453Z`
  recorded `1200` pending requests and `200` timeout resources after unmount
  for the old shape versus `0` pending requests and `0` timeout resources for
  the owned-abort shape; the new cleanup raised `400` abort signals and
  canceled all `1200` simulated requests.
- 2026-05-31 Pool Manager route-lifecycle verification: `npm run
  test:ui-static` passed (`34/34`), `npm run lint`, full `npm test`, `npm run
  build`, `npm run openapi:hydra`, `git diff --check`, and corrected serial
  `npm run gate` (`12/12`) passed. The first gate attempt intentionally ran
  beside Vite build and observed `dist/index.html` during Vite's replacement
  window; the serial retry passed after build completed. A temporary patched
  arm64 package at
  `/private/tmp/hydra-package-pool-route-abort-20260531T151623Z` passed
  `ELECTRON_APP_RESOURCES=<temp-app>/Contents/Resources
  HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, strict deep
  `codesign --verify`, and bundled renderer inspection for both abort refs and
  all six signal-aware endpoints. It was moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-pool-route-abort-20260531T151623Z`;
  Spotlight still resolves only the canonical public app.
- 2026-05-31 exact-public-`v1.1.5` seventh untouched idle reprofile:
  `/private/tmp/hydra-v115-seventh-untouched-idle-reprofile-20260531T151122Z`
  sampled the already-settled canonical app every 30 seconds for five minutes
  with zero UI interaction while source verification and isolated packaging
  continued. All 11 samples reported four Hydra-owned processes and zero stale
  profiles. Sampled CPU stayed between `0.0%` and `0.2%` (`0.036%` average);
  RSS moved from `470.03 MiB` to `477.84 MiB` (`+7.81 MiB`). Raw
  before/after inventories preserve the Hydra-owned subset and unrelated
  machine-global browser-tooling context.
- 2026-05-31 renderer visible-refresh lifecycle cleanup:
  `src/hooks/useVisibleRecurringTask.js` now gives each scheduled task an
  abort signal and aborts in-flight work when its document becomes hidden or
  its owner unmounts. `src/api.js` propagates optional signals through
  `/dashboard`, `/accounts/:id/session-status`, `/pool/traffic`, and
  `/system/health`; its tracked retry delay now clears immediately when
  canceled. Dashboard, Traffic, Vault, and app-shell upstream-health reads
  suppress late writes after unmount or abort. Vault and Dashboard
  session-status fan-outs stop dequeuing new accounts after cancellation.
  A 200-surface synthetic hide probe at
  `/private/tmp/hydra-visible-refresh-abort-benchmark-20260531T152945Z`
  recorded `800` pending requests and `800` timeout resources for the old
  timer-only shape versus `0` pending requests and `0` timeout resources for
  the abort-linked shape; the owned path canceled all `800` simulated
  requests.
- 2026-05-31 renderer visible-refresh lifecycle verification: `npm run
  test:ui-static` passed (`35/35`), the focused background lifecycle suite
  passed (`28/28`), `npm run lint`, full `npm test`, `npm run build`, `npm run
  openapi:hydra`, serial `npm run gate` (`12/12`), and `git diff --check`
  passed. A temporary patched arm64 package at
  `/private/tmp/hydra-package-visible-refresh-abort-final-20260531T153523Z`
  passed
  `ELECTRON_APP_RESOURCES=<temp-app>/Contents/Resources
  HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, strict deep
  `codesign --verify`, and bundled renderer inspection for the scheduler,
  abort refs, abort-aware retry marker, and signal-aware endpoints. It was
  moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-visible-refresh-abort-final-20260531T153523Z`;
  Spotlight still resolves only the canonical public app. `bin/commands/audit.js`
  now recognizes the stronger hidden-branch `clear(); abort();` contract and
  requires scheduled task signal propagation; `node --check
  bin/commands/audit.js`, `npm run test:cli` (`46/46`), and `hydra audit
  --json` (`31 ok / 5 deferred / 0 missing / 0 blockers`) passed after the
  verifier alignment update.
- 2026-05-31 exact-public-`v1.1.5` eighth untouched idle reprofile:
  `/private/tmp/hydra-v115-eighth-untouched-idle-reprofile-20260531T152450Z`
  sampled the already-settled canonical app every 30 seconds for five minutes
  with zero UI interaction while source verification continued. All 11
  samples reported four Hydra-owned processes. Sampled CPU stayed between
  `0.0%` and `0.1%` (`0.009%` average); RSS moved from `483.89 MiB` to
  `478.02 MiB` (`-5.88 MiB`). Raw before/after inventories preserve the
  Hydra-owned subset and unrelated machine-global browser-tooling context.
- 2026-05-31 Bulk Auth wizard lifecycle cleanup: `src/hooks/useBulkAuth.js`
  now owns an abort controller for its mounted lifetime and cancels active
  Magic Link status probes, live-session confirmation probes, bulk-stub
  requests, Magic Link send/resend requests, and staggered send delays on
  unmount. Late responses do not write state or logs after abort, poll
  in-flight state resets in `finally`, and mount resets the unmounted guard so
  React remounts do not inherit stale state. `src/api.js` passes optional
  abort signals through `/accounts/bulk-otp-stubs`,
  `/accounts/:id/session-check`, `/accounts/:id/magic-link/send`, and
  `/accounts/:id/magic-link/status/:signInId`.
- 2026-05-31 Bulk Auth wizard lifecycle benchmark and package proof: a
  200-wizard synthetic unmount probe at
  `/private/tmp/hydra-bulk-auth-unmount-benchmark-20260531T154607Z` recorded
  `2400` timeout resources and `600` pending requests after old-shape unmount
  versus `0` timeout resources and `0` pending requests after owned cleanup;
  the new path aborted all `600` simulated requests. Focused background
  lifecycle (`28/28`), UI static (`35/35`), lint, full `npm test`, build,
  OpenAPI generation (`83 operations`), serial gate (`12/12`), and diff
  checks passed. A temporary arm64 package at
  `/private/tmp/hydra-package-bulk-auth-abort-20260531T154837Z` passed
  packaged resource smoke, strict deep codesign, and bundled renderer
  inspection for the lifecycle ref, stagger-delay cancel set, delay helper,
  abort marker, and all four signal-aware endpoint markers. It was moved
  reversibly to
  `/Users/zaydk/.Trash/hydra-package-bulk-auth-abort-20260531T154837Z`;
  Spotlight still resolves only
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.
- 2026-05-31 exact-public-`v1.1.5` ninth untouched idle reprofile:
  `/private/tmp/hydra-v115-ninth-untouched-idle-reprofile-20260531T154248Z`
  sampled the already-settled canonical app every 30 seconds for five minutes
  with zero UI interaction while source verification continued. All 11
  samples reported four Hydra-owned processes. Sampled CPU stayed between
  `0.0%` and `0.2%` (`0.045%` average); RSS moved from `448.22 MiB` to
  `453.06 MiB` (`+4.84 MiB`). Raw before/after inventories preserve the
  Hydra-owned subset and unrelated machine-global browser-tooling context.
- 2026-05-31 Code Redeemer route-lifecycle cleanup: `src/pages/CodeRedemption.jsx`
  now owns an abort controller for its mounted lifetime and passes the signal
  through account load, redemption-history load, run-time session preflight,
  and bulk-matrix redemption. Account-selection changes also abort the
  superseded debounced preflight request instead of only suppressing its late
  write. Aborted work does not update route state, log a false history error,
  or emit stale toasts after navigation. `src/api.js` passes optional abort
  signals through `/accounts`, `/codes/history`, `/codes/preflight`, and
  `/codes/bulk-matrix`.
- 2026-05-31 Code Redeemer lifecycle benchmark and package proof: a 200-route
  synthetic teardown probe at
  `/private/tmp/hydra-code-redeemer-unmount-benchmark-20260531T155946Z`
  modeled four route-owned requests and three superseded preflight requests
  per mounted route. The old detached shape left `1400` pending requests and
  `1400` timeout resources after unmount; the owned-abort path left `0` and
  `0`, aborting all `1400` simulated requests. This proves teardown ownership,
  not a live redemption outcome. Focused background lifecycle (`29/29`), UI
  static (`35/35`), lint, full `npm test`, build, OpenAPI generation (`83
  operations`), serial gate (`12/12`), and diff checks passed. A temporary
  arm64 package at
  `/private/tmp/hydra-package-code-redeemer-abort-20260531T160131Z` passed
  packaged resource smoke, strict deep codesign, and bundled renderer
  inspection for the abort marker, both Code Redeemer timer owners, and all
  three code endpoint markers. It was moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-code-redeemer-abort-20260531T160131Z`;
  Spotlight still resolves only
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.
- 2026-05-31 exact-public-`v1.1.5` tenth untouched idle reprofile:
  `/private/tmp/hydra-v115-tenth-untouched-idle-reprofile-20260531T155621Z`
  sampled the already-settled canonical app every 30 seconds for five minutes
  with zero UI interaction while source verification continued. All 11
  samples reported four Hydra-owned processes and zero stale profiles. Sampled
  CPU stayed between `0.0%` and `0.3%` (`0.045%` average); RSS moved from
  `457.22 MiB` to `460.89 MiB` (`+3.67 MiB`). Raw before/after inventories
  preserve the Hydra-owned subset and unrelated machine-global
  browser-tooling context.
- 2026-05-31 Account Detail account-route lifecycle cleanup:
  `src/pages/AccountDetail.jsx` now owns an abort controller per resolved
  account ID and passes its signal through account metadata, account snapshot,
  management-key list, forced live-session probe, management-key reveal, and
  key-test reads. Route cleanup aborts detached reads and suppresses late
  writes, logs, and toasts. It also clears account-specific modals, reveals,
  copy badges, key-test badges, and transient timers. Server-side mutations
  still complete, but a route that has already been replaced cannot emit late
  UI writes or launch follow-up reads against the next account. Login and
  create-key modal callbacks carry the rendered account-route signal too, so a
  child completion cannot borrow a newer route's controller. The old mount-only
  initial-load boolean is replaced with an account-ID reload guard, so reusing
  the mounted detail component for another account cannot leave the previous
  account visible. `src/api.js` passes optional abort signals through
  `/accounts`, `/accounts/:id/snapshot`,
  `/accounts/:id/management-key`, `/accounts/:id/management-keys`,
  `/accounts/:id/session-check`, and `/accounts/:id/keys/:hash/test`.
- 2026-05-31 Account Detail lifecycle benchmark and package proof: a 200-route
  synthetic switch probe at
  `/private/tmp/hydra-account-detail-route-switch-benchmark-20260531T161135Z`
  modeled six account-scoped reads per account. The old mount-only shape
  started one account load and left `1200` pending requests plus `1200` timeout
  resources after route switches; the account-route-owned shape started all
  `200` account loads, left `0` pending requests and `0` timeout resources, and
  aborted all `1200` superseded requests. This proves route lifecycle
  ownership and the account-ID reload guard, not a live API outcome. Focused
  background lifecycle (`30/30`), UI static (`35/35`), lint, full `npm test`,
  build, OpenAPI generation (`83 operations`), serial gate (`12/12`), and diff
  checks passed. A temporary arm64 package at
  `/private/tmp/hydra-package-account-detail-abort-final-modal-20260531T183457Z`
  passed
  packaged resource smoke, strict deep codesign, and bundled renderer
  inspection for `AbortController`, `Request aborted`, and all Account Detail
  read endpoint markers. It was moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-account-detail-abort-final-modal-20260531T183457Z`;
  Spotlight still resolves only
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.
- 2026-05-31 exact-public-`v1.1.5` eleventh untouched idle reprofile:
  `/private/tmp/hydra-v115-eleventh-untouched-idle-reprofile-20260531T161135Z`
  sampled the already-settled canonical app every 30 seconds for five minutes
  while isolated source/package verification continued. All 11 samples ended
  with four Hydra-owned processes and zero stale profiles. The run preserved
  two real bounded perturbations instead of smoothing them away: its first
  sample measured `41.6%` Hydra-owned CPU, and a packaging-time sample measured
  five processes at `13.0%`; the remaining nine samples stayed between `0.0%`
  and `0.1%`. RSS moved from `468.95 MiB` to `464.53 MiB` (`-4.42 MiB`).
  Because the run overlapped packaging, a quiet follow-up profile is required
  before treating it as an idle baseline.
- 2026-05-31 exact-public-`v1.1.5` twelfth resume profile:
  `/private/tmp/hydra-v115-twelfth-untouched-idle-reprofile-20260531T161844Z`
  started as a quiet follow-up, but the host hibernated between
  `2026-05-31T16:21:14Z` and `2026-05-31T18:25:39Z`. `pmset -g log`
  subsequently reported `hibernate user wake`, so this run is retained as
  resume evidence rather than mislabeled as a continuous idle baseline. All
  11 samples reported four Hydra-owned processes and zero stale profiles.
  Pre-sleep samples stayed between `0.0%` and `0.2%`; the first resume sample
  measured `42.9%`, then the remaining samples returned to `0.0-0.1%`.
  RSS moved from `461.38 MiB` to `247.06 MiB` across hibernation
  (`-214.31 MiB`). A fresh uninterrupted post-package profile is still
  required for the quiet baseline.
- 2026-05-31 exact-public-`v1.1.5` thirteenth untouched post-wake idle
  reprofile:
  `/private/tmp/hydra-v115-thirteenth-untouched-idle-reprofile-20260531T182947Z`
  sampled the already-settled canonical app every 30 seconds for five
  uninterrupted minutes after packaging stopped. All 11 samples reported four
  Hydra-owned processes and zero stale profiles. Sampled CPU stayed between
  `0.0%` and `0.3%` (`0.036%` average); RSS moved from `249.00 MiB` to
  `261.56 MiB` (`+12.58 MiB`). This is the quiet post-wake idle baseline that
  the packaging-overlapped eleventh run and hibernate-interrupted twelfth run
  could not honestly provide.
- 2026-05-31 Generator late-start lifecycle cleanup: `src/pages/Generator.jsx`
  now marks its surface closed before route-exit or page-hide cleanup, releases
  a task returned by `/generator/start` after that boundary with keepalive
  cleanup, and claims an on-screen returned task ref immediately before React
  effects run. Start and OTP requests each have an in-flight gate, so rapid
  clicks cannot create duplicate browser jobs or submit the same OTP twice.
  OTP responses arriving after route replacement do not write stale UI state
  or toasts. A 200-surface synthetic teardown probe at
  `/private/tmp/hydra-generator-start-unmount-benchmark-20260531T184541Z`
  modeled two rapid Start clicks per surface. The old detached shape left
  `400` orphan tasks after unmount; the owned path started `200`, prevented
  `200` duplicate starts, issued `200` late cleanup requests, suppressed `200`
  late writes, and left `0` orphan tasks. This proves renderer lifecycle
  ownership and duplicate-click gating, not a live browser-signup outcome.
- 2026-05-31 Generator late-start package proof: focused background lifecycle
  (`31/31`), UI static (`35/35`), lint, full `npm test`, build, OpenAPI
  generation (`83 operations`), serial gate (`12/12`), audit
  (`31 ok / 5 deferred / 0 missing / 0 blockers`), and diff checks passed. A
  temporary arm64 package at
  `/private/tmp/hydra-package-generator-late-start-20260531T184800Z` passed
  packaged resource smoke against its explicit unpacked resources, strict deep
  codesign, and bundled renderer inspection for `Late-start cleanup failed`,
  `client_disconnect`, `Starting...`, `[VERIFYING]`, and `/generator/start`.
  Its zip and blockmap were generated before the directory moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-generator-late-start-20260531T184800Z`.
- 2026-05-31 exact-public-`v1.1.5` fourteenth untouched idle reprofile:
  `/private/tmp/hydra-v115-fourteenth-untouched-idle-reprofile-20260531T184117Z`
  sampled the already-settled canonical app every 30 seconds for five
  uninterrupted minutes while source verification continued. All 11 samples
  reported four Hydra-owned processes and zero stale profiles. Sampled CPU
  stayed between `0.0%` and `0.2%` (`0.018%` average); RSS stayed exactly
  `261.75 MiB` from first to last sample (`0 KiB` drift). The raw before/after
  inventories remain in the profile directory.
- 2026-05-31 exact-public-`v1.1.5` fifteenth untouched post-package idle
  reprofile:
  `/private/tmp/hydra-v115-fifteenth-untouched-idle-reprofile-20260531T185018Z`
  sampled the already-settled canonical app every 30 seconds for five
  uninterrupted minutes after the isolated Generator package build stopped.
  All 11 samples reported four Hydra-owned processes and zero stale profiles.
  Sampled CPU stayed exactly `0.0%` (`0.000%` average and maximum); RSS moved
  from `261.77 MiB` to `261.73 MiB` (`-32 KiB`). The raw before/after process
  inventories remain in the profile directory.
- 2026-05-31 ordinary `/v1` proxy disconnect lifecycle cleanup:
  `server/routes/proxy.js` now aborts its active OpenRouter controller when the
  client request aborts or response closes, stops before selecting another key
  after disconnect, unrefs and clears connect/body timeout handles, and
  strengthens SSE close handling by aborting the fetch controller as well as
  canceling its response body. A 200-client synthetic teardown probe at
  `/private/tmp/hydra-proxy-client-disconnect-benchmark-20260531T185826Z`
  modeled disconnects while upstream work remained pending. The old shape left
  `200` upstream requests and `200` timeout handles pending and could reach
  `600` attempts after disconnected failures; the owned path aborted all
  `200`, left `0` pending upstreams and timeout handles, and issued `0` retries
  after disconnect. This proves request-lifecycle ownership, not a live
  OpenRouter traffic outcome.
- The ordinary proxy disconnect patch passed focused background lifecycle
  (`32/32`), lint, full test, build, OpenAPI (`83 operations`), serial gate
  (`12/12`), audit (`31 ok / 5 deferred / 0 missing / 0 blockers`), and diff
  checks. A temporary arm64 package at
  `/private/tmp/hydra-package-proxy-client-disconnect-20260531T190432Z` passed
  explicit-resource package smoke, strict deep signature verification, and
  bundled proxy-source inspection. It moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-proxy-client-disconnect-20260531T190432Z`.
- 2026-05-31 exact-public-`v1.1.5` sixteenth untouched idle reprofile:
  `/private/tmp/hydra-v115-sixteenth-untouched-idle-reprofile-20260531T190601Z`
  sampled the already-settled canonical app every 30 seconds for five
  uninterrupted minutes. All 11 samples reported four Hydra-owned processes
  and zero stale profiles. Sampled CPU stayed between `0.0%` and `0.1%`
  (`0.009%` average); RSS moved from `319.20 MiB` to `317.50 MiB`
  (`-1.70 MiB`). This is exact-public idle evidence collected while source UI
  work proceeded, not packaged evidence for the pending visual patch.
- 2026-05-31 renderer design source pass: restored the curated detailed
  three-headed Hydra raster from history as `public/hydra_dragon.png`,
  regenerated the macOS ICNS, Windows multi-resolution ICO, and Linux PNG, and
  separated the compact generated H micro-mark so `npm run icons:generate`
  cannot overwrite the detailed master. Renderer chrome and sidebar branding
  now use the restored dragon. The RAF-throttled, reduced-motion-safe proximity
  field now covers dashboard account cards, command actions, empty-state
  actions, primary and footer sidebar controls, and Settings action clusters.
  Settings top-row cards use equal rows, aligned footers, and uniform action
  minimum sizes. Splash branches now use neuron-like irregular segments with
  one SVG-level glow; after portal collision masks are disabled, Matter steps
  at the existing `30 Hz` paint cadence and steering reuses the one painted
  body snapshot. Focused UI (`36/36`), Electron main-process (`28/28`), syntax,
  icon regeneration, audit, and diff checks passed. A rebuilt package and
  packaged visual review remain required before this source pass closes manual
  GUI evidence.
- 2026-05-31 1.3.0 desktop refinement source pass: removed implicit browser
  launch from `npm start` and kept browser opening behind the explicit
  `--browser` web-development flag; restored hosted Linux x64 AppImage and
  `latest-linux.yml` publication beside macOS and Windows; globally enabled
  Electron sandboxing before app readiness; replaced the CSP-rejected inline
  data favicon with the same-origin detailed Hydra raster; removed the blocked
  Google Fonts stylesheet request; exposed the existing 24-hour desktop unlock
  window in Settings; expanded the organic splash field from five to nine
  primary stems; and added a decaying collision-free upward lift before the
  accelerating portal settles into orbit. Primary-source review covered
  Electron sandbox/security, Anime.js React cleanup, Three.js manual disposal,
  and electron-builder cross-platform packaging guidance. Three.js was
  intentionally not added because the finite 2D canvas/Matter effect does not
  benefit from a second WebGL lifecycle. Focused syntax, workflow (`17/17`),
  UI static (`38/38`), and Electron main-process (`29/29`) checks passed.
  Rebuilt package smoke, Computer Use desktop review, full gates, hosted CI,
  hosted Docker, and tagged `1.3.0` release validation remain required.
- 2026-05-31 account-grid attraction refinement: the existing Dashboard
  proximity field now adds an account-only directional pull capped at `10px`
  horizontally and `8px` vertically. Nearby account cards drift toward the
  cursor while their established pink hover treatment brightens; the CSS grid
  itself does not reflow. The shared hook still batches pointer updates through
  one tracked RAF, resets on pointer leave or unmount, and disables the effect
  under reduced motion.
- 2026-05-31 native-only rebuilt-package verification for the pending `1.3.0`
  source lane: the arm64 package passed explicit-resource
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, strict deep
  `codesign`, restored-icon byte comparison, and Spotlight uniqueness.
  `/private/tmp/hydra-130-native-launch-20260531T124003` records zero
  Hydra-owned processes before normal LaunchServices `open -n`, four during
  splash, and four after handoff with the splash renderer replaced by the main
  renderer. Computer Use captured the actual packaged splash with individualized
  falling letters, nine segmented branch stems, and `Welcome, Zayd Khan`.
  After handoff Computer Use exposed the native `Hydra - Dashboard` window and
  controls but captured only the renderer background layer, so interactive
  nine-card magnetic response remains explicit user-facing visual acceptance.
  No browser harness, browser MCP, CDP port, or remote-debug launch was used.
- 2026-05-31 pending-`1.3.0` splash diagnostics from the same native package:
  `target=72`, `queueLength=72`, `shatteredWordCount=72`,
  `duplicateShatterSkips=0`, `peakDynamicBodyCount=551`,
  `portalCollisionDisabled=true`, `portalLiftApplied=true`,
  `renderFrames=408`, `physicsSteps=668`, `timers=0`, `rafActive=false`, and
  `matterCleared=true`. This proves the new collision-free release lift ran and
  the splash owner cleaned up after handoff.
- 2026-05-31 pending-`1.3.0` untouched post-attraction idle profile:
  `/private/tmp/hydra-130-post-attraction-idle-20260531T124106` sampled the
  settled rebuilt package every 30 seconds for five uninterrupted minutes.
  All 11 samples reported four Hydra-owned processes and zero stale profiles.
  Sampled aggregate Hydra CPU ranged from `0.0%` to `97.1%` (`12.882%`
  average); RSS moved from `537.41 MiB` to `622.81 MiB` (`+85.41 MiB`).
  Nine samples read `0.0%`; samples `04` and `06` reported `97.1%` and `44.6%`.
  The process tree stayed bounded, but the two spikes require another profile
  pass before this pending source lane is promoted as calm-idle evidence.
- 2026-05-31 pending-`1.3.0` second untouched idle reprofile:
  `/private/tmp/hydra-130-second-untouched-idle-reprofile-20260531T124730`
  sampled the same settled rebuilt package every 30 seconds for five
  uninterrupted minutes while the machine was otherwise left quiet. All 11
  samples reported four Hydra-owned processes and zero stale profiles. Sampled
  aggregate Hydra CPU stayed between `0.0%` and `0.1%` (`0.018%` average);
  RSS moved from `619.48 MiB` to `622.59 MiB` (`+3.11 MiB`). This is the calm
  idle follow-up for the pending source lane. The earlier spike run remains
  recorded above rather than being discarded.
- 2026-05-31 design-engineering documentation refresh: `docs/DESIGN_ENGINEERING.md`
  now records the reusable proximity implementation map, sidebar and account
  tuning caps, stable-geometry rule, Anime.js split-text ownership and cleanup,
  falling-glyph/portal invariants, and the reduced-motion contract. These are
  maintained implementation rules, not release-note-only descriptions.
- 2026-05-31 exact-local-`1.3.0` package verification: after the source
  checkpoint passed hosted CI run `26722842203` and hosted Docker run
  `26722842195`, the old generated `1.1.5` local release directory moved
  reversibly to
  `/Users/zaydk/.Trash/hydra-pre-v130-local-release-20260531T130106`.
  `npm version 1.3.0 --no-git-tag-version --allow-same-version` updated both
  manifests, `npm run electron:build:mac-arm64` rebuilt from a clean output
  lane, explicit-resource `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`
  passed, strict deep codesign passed, the packaged ICNS matched the restored
  source icon byte-for-byte, and the bundle reports `1.3.0`. The old Trash
  bundle was unregistered explicitly; Spotlight and LaunchServices now return
  only `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.
- 2026-05-31 exact-local-`1.3.0` native LaunchServices verification:
  `/private/tmp/hydra-130-versioned-native-launch-20260531T130322` records zero
  Hydra-owned processes before normal `open -n`, four during splash, and four
  after handoff. No listener existed on debug ports `9333` or `9334`.
  Computer Use captured the actual packaged splash with individualized letters,
  nine segmented stems, centered `Welcome, Zayd Khan`, and visible `V1.3.0`.
  The replacement window title became `Hydra — Dashboard`, native
  close/full-screen/minimize controls remained exposed, and settled doctor
  output reported four owned processes, `0.0%` CPU, `535.14 MB` RSS, and zero
  stale profiles. Computer Use still captured only the background layer after
  handoff, so interactive nine-card magnetic review remains a user-facing
  visual acceptance item.
- 2026-05-31 exact-local-`1.3.0` splash teardown diagnostics:
  `target=72`, `queueLength=72`, `shatteredWordCount=72`,
  `duplicateShatterSkips=0`, `peakDynamicBodyCount=551`,
  `portalCollisionDisabled=true`, `portalLiftApplied=true`,
  `renderFrames=409`, `physicsSteps=672`, `timers=0`, `rafActive=false`, and
  `matterCleared=true`.
- 2026-05-31 public `v1.3.0` desktop publication: auto-version run
  `26723122013`, master CI run `26723122028`, Docker run `26723122021`, and
  desktop release run `26723127043` passed. The release published macOS arm64
  zip/blockmap, macOS Intel zip/blockmap, Windows x64 NSIS installer/blockmap,
  Linux x64 AppImage, merged `latest-mac.yml`, Windows `latest.yml`, and Linux
  `latest-linux.yml`. Windows also passed the hosted unpacked-executable
  launch-and-cleanup gate before upload. All ten downloaded public assets
  matched their GitHub SHA-256 digests; both macOS archives matched the merged
  updater manifest SHA-512 values.
  Docker workflow run `26723122021` passed both runtime smoke and registry image push.
- 2026-05-31 canonical exact-public `v1.3.0` install: the source-built arm64
  bundle moved reversibly to
  `/Users/zaydk/.Trash/hydra-local-mac-arm64-before-public-v130-20260531T131638`.
  The downloaded public arm64 zip was extracted into
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`, deep strict
  codesign and explicit-resource package smoke passed, and the installed bundle
  reports version `1.3.0`. Spotlight returns only that one `Hydra.app`, and
  LaunchServices is registered to the same canonical path.
- 2026-05-31 exact-public `v1.3.0` native launch:
  `/private/tmp/hydra-v130-public-native-launch-20260531T131731` records a
  normal no-debug LaunchServices launch. CoreGraphics reported one on-screen
  `Hydra - Dashboard` window at `1440x900`; the settled package held four
  Hydra-owned processes at `0.0%` CPU and `604.50 MB` RSS with zero stale Hydra
  Playwright profiles. Debug ports `9333` and `9334` had no listener. Computer
  Use listed the canonical Hydra bundle as running but could not attach to its
  CoreGraphics window (`cgWindowNotFound`), so this is exact-public native
  launch evidence, not a replacement for the deferred interactive screenshot
  and account-grid magnetic-response review.
- 2026-05-31 exact-public `v1.3.0` splash teardown diagnostics remained finite:
  `target=72`, `queueLength=72`, `shatteredWordCount=72`,
  `duplicateShatterSkips=0`, `peakDynamicBodyCount=547`,
  `portalCollisionDisabled=true`, `portalLiftApplied=true`,
  `renderFrames=416`, `physicsSteps=668`, `timers=0`, `rafActive=false`, and
  `matterCleared=true`.
- 2026-05-31 conservative public `v1.3.0` dogfood evidence refresh: all public
  desktop distributables were downloaded into a temporary verification
  directory and `npm run dogfood:final -- --write-evidence=docs/DOGFOOD_EVIDENCE.json
  --version=1.3.0 --artifact-dir=<temporary-public-release-download>
  --app=release/mac-arm64/Hydra.app --manual=packaged-gui-launch` regenerated
  the checked-in redacted manifest. Machine-specific paths were sanitized
  before check-in. The manifest intentionally preserves only the empirically
  verified exact-public GUI-launch checkbox; splash/dashboard screenshots,
  full navigation, live account flows, Touch ID fingerprint approval, and real
  Windows NSIS install/open UX remain explicit manual boundaries.
- 2026-05-31 exact-public `v1.3.0` post-closeout idle profile:
  `/private/tmp/hydra-v130-public-post-closeout-idle-profile-20260531T132928`
  sampled the untouched canonical package every 30 seconds for five minutes.
  All 11 samples retained four Hydra-owned processes and zero stale profiles.
  Aggregate CPU stayed between `0.0%` and `0.4%` (`0.091%` average), which is
  `33.2%` below the `v1.1.5` calm public baseline. RSS moved from `604.80 MiB`
  to `606.66 MiB` (`+1.86 MiB`). The directory preserves before/after broad
  process inventories, Hydra-owned subsets, all doctor snapshots, and
  `summary.json`; the Hydra-owned PID set was unchanged before and after.
- 2026-05-31 exact-public `v1.3.0` native Dashboard privacy proof:
  LaunchServices surfaced the canonical package, CoreGraphics enumerated
  Dashboard window `2589`, and `/usr/sbin/screencapture -l 2589` produced the
  raw private capture outside the repository under the post-closeout profile
  directory. `docs/evidence/hydra-v130-packaged-dashboard-privacy-redacted.png`
  pixelates all content below the native titlebar. Its SHA-256 is
  `d09cb79b6c2a819eb3eb7957f6fd33464193d492cfa74bf8aae6badd96e27c6c`;
  ImageMagick reports `3016x1936` and `6443` colors; Tesseract OCR found zero
  credential-shaped or endpoint-shaped hits. This is native packaged-app
  provenance evidence, not a browser substitution and not a replacement for
  the deferred interactive route review.
- 2026-05-31 pending-`v1.4.0` renderer/media consolidation: Dashboard derived
  fleet state now memoizes account filters, activity shaping, and health
  calculations; each account card compares only its own aggregate-state slices;
  Pool Manager exports stable callbacks into memoized account/key rows; and the
  README restores the Apple-style product reel above the focused splash GIF.
  `docs/DESIGN_ENGINEERING.md` records the render-budget and two-layer media
  rationale. Local verification passed `npm run lint`, full `npm test`,
  `npm run build`, gate (`12/12`), OpenAPI generation (`83 operations`),
  `hydra audit` (`31 ok / 5 deferred / 0 missing / 0 blockers`), and
  `git diff --check`. A temporary redirected arm64 package under
  `/private/tmp/hydra-package-v140-preflight-20260531T134810` passed
  explicit-resource `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`,
  strict deep codesign, and nested-release-output exclusion without replacing
  the installed exact-public `v1.3.0` app.
- 2026-05-31 public `v1.4.0` renderer/media publication: auto-version run
  `26724119200`, master CI run `26724119194`, Docker workflow run
  `26724119196`, and desktop release run `26724123318` passed. The desktop
  release published macOS arm64 zip/blockmap, macOS Intel zip/blockmap,
  Windows x64 NSIS installer/blockmap, Linux x64 AppImage, merged
  `latest-mac.yml`, Windows `latest.yml`, and Linux `latest-linux.yml`.
  Windows also passed the hosted unpacked-executable launch-and-cleanup gate.
  All ten downloaded public assets matched GitHub SHA-256 digests, and the
  released arm64 Mac, Intel Mac, Windows, and Linux binaries matched their
  updater-manifest SHA-512 values.
  Docker workflow run `26724119196` passed both runtime smoke and registry image push.
- 2026-05-31 canonical exact-public `v1.4.0` install and native launch: the
  previous canonical app moved reversibly to Trash, the downloaded arm64 zip
  installed at `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`, and
  strict deep codesign plus explicit-resource package smoke passed. Spotlight
  returns only that canonical `Hydra.app`, which reports version `1.4.0`.
  `/private/tmp/hydra-v140-public-native-launch-20260531T140421` records a
  normal no-debug LaunchServices launch: four Hydra-owned processes, no
  listeners on `9333` or `9334`, and one CoreGraphics
  `Hydra — Dashboard` window at `1440x900`. A settled follow-up doctor snapshot
  reported four Hydra-owned processes at `0.0%` CPU, `591.00 MB` RSS, and zero
  stale Hydra Playwright profiles.
- 2026-05-31 conservative public `v1.4.0` dogfood evidence refresh:
  `docs/DOGFOOD_EVIDENCE.json` was regenerated against the downloaded public
  distributables and sanitized before check-in. Only `packaged-gui-launch`
  remains checked. Interactive route review, account-grid magnetic-response
  review, live OTP/redemption/proxy flows, Touch ID fingerprint approval, and
  real Windows NSIS install/open UX remain explicit manual boundaries.
- 2026-05-31 exact-public `v1.4.0` post-closeout idle profile:
  `/private/tmp/hydra-v140-public-post-closeout-idle-profile-20260531T141703`
  sampled the untouched canonical package every 30 seconds for five minutes.
  All 11 samples retained the same four Hydra-owned PIDs and zero stale Hydra
  Playwright profiles. Aggregate CPU stayed between `0.0%` and `0.1%`
  (`0.064%` average), which is `53.2%` below the exact-public `v1.1.5` calm
  public baseline. RSS moved from `600.36 MiB` to `593.58 MiB` (`-6.78 MiB`).
  The local evidence directory preserves before/after broad process
  inventories, anchored Hydra-owned subsets, doctor snapshots, all samples,
  and `summary.json`.
- 2026-05-31 exact-public `v1.4.0` live-session recheck:
  `/private/tmp/hydra-live-session-recheck-v140-20260531T212329Z/redacted-summary.json`
  is an owner-only (`0600`) aggregate from 12 sequential
  `hydra session <id> --refresh --json` calls through the production
  `store.probeSessionLive()` path. All 12 probes completed without decrypt or
  command failures: four logins were active and redeem-ready, eight remained
  explicit OTP re-auth candidates, every active row retained a one-entry Clerk
  identity stack and a `7.0d` renewal checkpoint, and one active login remained
  intentionally independent of management-key state. The artifact contains no
  account IDs, aliases, emails, cookies, tokens, or management keys.
- 2026-05-31 exact-public `v1.4.0` post-closeout verification: `npm run lint`,
  full `npm test`, `npm run gate` (`12/12`), `npm run build`,
  `npm run openapi:hydra` (`83 operations`), `git diff --check`, strict deep
  `codesign`, and `node bin/hydra.mjs audit --json` (`31 ok / 5 deferred /
  0 missing / 0 blockers`) passed. The first explicit-resource ARM package
  smoke correctly reported that the cleaned local release directory no longer
  held the public zip; the corrected rerun temporarily symlinked the already
  SHA-verified public `Hydra-1.4.0-mac-arm64.zip`, passed
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and moved the
  symlink reversibly to Trash. Local `docker info` remains unavailable because
  Docker Desktop is stopped; hosted Docker run `26724119196` remains the
  current runtime-smoke and registry-push evidence.
- 2026-05-31 exact-public `v1.4.0` evidence-checkpoint push: commit
  `dea4c5ff8969cd033084ad30c5976faba87c0b95` used `[skip-bump]`;
  Auto-version run `26724970520` skipped as intended, CI run `26724970519`
  passed, and Docker run `26724970530` passed both image push and hosted
  runtime smoke. The newer hosted Docker run supersedes `26724119196` as the
  latest runtime-smoke and registry-push evidence.
- 2026-05-31 local Docker hardening follow-up: starting Docker Desktop exposed
  a seven-week-old local compose service, which was removed with
  `docker compose down --remove-orphans`. The initial image rebuild also
  exposed a real browser-fallback gap: Chromium downloaded successfully but
  `ldd` reported 16 missing Linux shared libraries, and Playwright warned that
  the host dependencies were absent. Current Playwright guidance for custom
  images uses `npx playwright install --with-deps`; `Dockerfile` now runs
  `npx playwright install --with-deps chromium`. A rebuilt image passed direct
  `ldd` (`none` missing), headless Chromium launch (`playwright-launch=ok`),
  and `npm run docker:smoke -- --start`: compose build, container start,
  health endpoint HTTP `200`, and teardown all completed. `docker compose ps
  --all` was empty afterward.
- 2026-05-31 Docker context and dependency-audit follow-up: the first local
  rebuild transferred `187.54 MB` because ignored desktop output had expanded
  beyond the previously excluded `release/` directory. `.dockerignore` now
  excludes `build/`, `videos/`, and `splash-previews/`, reducing the uncached
  transfer to `361.39 kB` (`99.8%`). Fresh npm audit surfaced a production
  `qs` advisory and a dev-only `tmp` advisory; explicit overrides now pin
  fixed `qs@6.15.2` and `tmp@0.2.7`. Both `npm audit --omit=dev --json` and
  full `npm audit --json` report zero vulnerabilities. The Docker regression
  suite now locks the context exclusions and `--with-deps` layer.
- 2026-05-31 Docker-hardening acceptance-item-11 rerun: with the already
  SHA-verified public arm64 zip temporarily linked for explicit-resource
  package smoke, the literal ordered chain `npm run lint && npm test && npm
  run gate && HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke && npm run
  docker:smoke && npm run openapi:hydra` passed. The gate reported `12/12`,
  package smoke verified the canonical exact-public `v1.4.0` app resources,
  Docker smoke rebuilt the hardened image with a `78.39 kB` warm context
  transfer, and OpenAPI regenerated `83 operations`. The temporary zip symlink
  moved reversibly to Trash after the run.
- 2026-05-31 first Docker-hardening checkpoint publication: commit
  `938180501985fad29b68d1ea3554130bbf65a0b4` used `[skip-bump]`;
  Auto-version run `26725445052` skipped as intended, CI run `26725445054`
  passed, and Docker workflow run `26725445050` passed both runtime smoke and
  registry image push.
- 2026-05-31 Docker payload and browser-fallback hardening follow-up: local
  image inspection found `929 MB` under `/root/.cache/ms-playwright`, including
  an unused `323 MB` `chromium_headless_shell-1208` directory, plus `19 MB` of
  apt indexes. Rebuilding with `npx playwright install --with-deps chromium
  --no-shell` removed the shell payload and reduced apt indexes to `4 kB`.
  Playwright's default `headless: true` path then correctly failed because it
  still requests the skipped shell. Current Playwright docs identify
  `channel: 'chromium'` as the full-Chromium new-headless opt-in; the corrected
  direct container probe passed with that channel.
- 2026-05-31 shared Playwright-launch repair: the stricter Docker probe exposed
  that Hydra's browser resolver passed `userDataDir` into `chromium.launch()`,
  which Playwright rejects with `userDataDir option is not supported in
  browserType.launch`. `server/lib/playwright-browser.js` now owns
  `launchChromiumPersistentContext()`, passing the Hydra-owned profile as the
  first argument to `chromium.launchPersistentContext()` and cleaning it on
  launch failure. Signup fallback, management-key capture, code-redemption
  fallback, and API-key sync all use the shared supported path; the intentional
  CDP opt-in path still uses `browser.newContext()`. `npm run
  test:browser-isolation` now covers persistent-profile argument placement and
  failed-launch cleanup.
- 2026-05-31 trimmed Docker runtime proof: `Dockerfile` sets
  `HYDRA_PLAYWRIGHT_CHANNEL=chromium`; `npm run docker:smoke` launches Hydra's
  own full-Chromium persistent-context path in an ephemeral `docker run`
  before passing; `npm run docker:smoke -- --start` additionally started the
  compose service, received HTTP `200`, and removed it. Build-only smoke left
  no compose resources and no `hydra_default` network. Direct image inspection
  found only `602 MB` full Chromium, `3.3 MB` FFmpeg, `4 kB` apt indexes, and
  no missing shared libraries. The inspected image changed from
  `1,151,831,905` to `1,021,264,136` bytes, removing `130,567,769` bytes
  (`11.3%`) after layer compression.
- 2026-05-31 trimmed Docker-browser checkpoint publication: commit
  `c3a3636809329781e6064b2751fee3623d1dff3f` used `[skip-bump]`;
  Auto-version run `26725827316` skipped as intended, CI run `26725827309`
  passed, and Docker workflow run `26725827291` passed both runtime smoke and
  registry image push.
- 2026-05-31 exact-public `v1.4.0` native accessibility retry: a controlled
  `get_app_state("com.zayd.hydra")` attempt against the settled canonical
  package again timed out after `120s`. The external
  `SkyComputerUseService` helper held `30.4%` CPU and continuously requested
  macOS accessibility attributes; Hydra's main process consequently held
  `69.7%` CPU while its GPU, network, and renderer helpers remained idle.
  Terminating only the external helper returned the unchanged four-process
  Hydra tree to `0.0%` sampled CPU with `493.77 MB` RSS and zero stale Hydra
  Playwright profiles. Raw owner-only evidence is under
  `/private/tmp/hydra-v140-cua-attach-retry-20260531T151812Z`; the profiling
  rule remains: discard measurements after a timed-out accessibility attach.
- 2026-05-31 exact-public `v1.4.0` native Dashboard privacy proof:
  CoreGraphics selected the exact `Hydra` window owner and
  `/usr/sbin/screencapture -x -o -l 2637` captured the canonical packaged
  Dashboard without browser tooling or window shadow. The raw account-bearing
  capture remains owner-only outside the repository.
  `docs/evidence/hydra-v140-packaged-dashboard-privacy-redacted.png`
  pixelates every pixel below the renderer titlebar before check-in. Its
  SHA-256 is
  `74789ea47e6a33fff972ac15a40667fe0e99af786aae9e13b3cc65cd3f92fc0f`;
  ImageMagick reports `2880x1800`, `3737` colors, and nonzero variance;
  Tesseract OCR found zero credential-shaped or endpoint-shaped hits. This is
  packaged-app provenance evidence, not a replacement for the deferred
  interactive route review.
- 2026-05-31 native-capture evidence-checkpoint publication: commit
  `8ef60095487bc6f45e3573ad52a11c8a8378ba87` used `[skip-bump]`;
  Auto-version run `26726418555` skipped as intended, CI run `26726418554`
  passed, and Docker workflow run `26726418536` passed both runtime smoke and
  registry image push.
- 2026-05-31 exact-public `v1.4.0` post-capture calm-runtime proof:
  `/private/tmp/hydra-v140-post-native-anchor-idle-reprofile-20260531T224017Z`
  sampled the untouched canonical packaged app every 30 seconds for five
  minutes after the native screenshot checkpoint. All 11 samples retained
  four Hydra-owned processes and zero stale Hydra Playwright profiles.
  Aggregate CPU stayed between `0.0%` and `0.7%` (`0.082%` average, `0.0%`
  ending); RSS moved from `498.50 MiB` to `499.22 MiB` (`+0.72 MiB`). This
  fresh sample was collected without attaching Computer Use and confirms the
  prior attach-induced spike was external instrumentation distortion.
- 2026-05-31 hosted Windows NSIS lifecycle hardening: checkpoint
  `811b5d6e4269c17097872d7d431edbdd9bdc6351` extended
  `scripts/smoke-windows-launch.mjs` beyond the unpacked app. Release workflow
  dispatch `26726712898` passed shared gates, Linux AppImage, both macOS zip
  lanes, Windows package smoke, unpacked `Hydra.exe` startup/cleanup, silent
  NSIS install into an isolated temporary directory, installed `Hydra.exe`
  startup/cleanup, copied-uninstaller execution, and residue rejection. The
  hosted `windows-2022` log recorded both real executable trees alive for
  `25,000ms` and the final line `NSIS silent install, installed-app launch,
  cleanup, and uninstall left no residue`.
- 2026-05-31 bounded Windows lifecycle follow-up: the first hosted silent NSIS
  extraction took about `102s`, so checkpoint
  `e0a887b02f5da8d20c555022013396213e8732c3` added an explicit five-minute
  install timeout and one-minute uninstall timeout. Timeout-bounded release
  workflow dispatch `26726921936` passed Linux AppImage, macOS arm64 zip,
  macOS Intel x64 zip, Windows x64 NSIS package smoke, unpacked startup/cleanup,
  silent NSIS install, installed-app startup/cleanup, copied-uninstaller
  execution, and zero-residue verification. Its final Windows install
  completed in about `63s`, below the new bound. Auto-version run
  `26726917968` skipped as intended; CI run `26726917980` passed; Docker
  workflow run `26726917984` passed both runtime smoke and registry image push.
  The audit parser now tolerates Markdown whitespace inside `Docker workflow
  run` evidence phrases, and its CLI regression derives the newest documented
  checkpoint instead of accepting any stale run ID. The actual interactive
  NSIS installer install/open UX remains a real Windows desktop manual
  boundary.
- 2026-05-31 post-parser exact-public calm-runtime proof:
  `/private/tmp/hydra-v140-post-audit-parser-idle-reprofile-20260531T231558Z`
  sampled the untouched canonical packaged app every 30 seconds for five
  minutes after the audit parser fix. All 11 samples retained four Hydra-owned
  processes and zero stale Hydra Playwright profiles. Aggregate CPU stayed
  between `0.0%` and `0.1%` (`0.009%` average, `0.0%` ending); RSS moved from
  `502.16 MiB` to `500.19 MiB` (`-1.97 MiB`). No Computer Use accessibility
  attach occurred during this valid sample.
- 2026-05-31 exact-final-chain local rerun: the published
  `Hydra-1.4.0-mac-arm64.zip` release asset was downloaded and verified at
  SHA-256
  `320bb60fc3400449fb9c34d4003c5afd9811337c3c9e8cf08f074921fa5e4dac`.
  The literal ordered acceptance chain passed: `npm run lint && npm test &&
  npm run gate && HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke &&
  npm run docker:smoke && npm run openapi:hydra`. Gate remained `12/12`,
  package smoke used the verified published zip, Docker smoke rebuilt the
  production image and launched Hydra's isolated full-Chromium persistent
  context, and OpenAPI regeneration retained `83 operations`. Strict deep
  `codesign` passed, `docker compose ps --all` returned no services, and the
  temporary public-zip symlink moved reversibly to Trash afterward. Docker
  Desktop was restored to its prior stopped state through `docker desktop
  stop`.
- 2026-05-31 exact-final-chain evidence-checkpoint publication: commit
  `c0bce57a814b9e3cf066959f5cce68c2ea6ac198` used `[skip-bump]`;
  Auto-version run `26727636115` skipped as intended, CI run `26727636112`
  passed, and Docker workflow run `26727636121` passed both runtime smoke and
  registry image push.
- 2026-05-31 exact-public `v1.4.0` native route-review retry: Computer Use
  `get_app_state("com.zayd.hydra")` again timed out after `120s`. The external
  `SkyComputerUseService` helper held `28.8%` CPU while Hydra's otherwise-idle
  main process held `66.5%`; GPU, network, and renderer helpers remained
  effectively idle. A five-second stack sample again traversed HIServices
  `_AXXMIGCopyMultipleAttributeValues`. Terminating only the external helper
  returned the unchanged four-process Hydra tree to `0.0%` sampled CPU with
  zero stale Hydra Playwright profiles. A Computer Use `Cmd+,` fallback was
  correctly rejected because the timed-out session never became active.
  AppKit foreground activation plus a Quartz `CGEvent` safe-band click scan
  (`x=68`, `y=430...580`) also left the native title unchanged, so it cannot
  close route-review evidence. Owner-only raw retry evidence is under
  `/private/tmp/hydra-v140-cua-route-review-retry-20260531T233933Z`.
- 2026-05-31 exact-public `v1.4.0` fresh native screenshot provenance:
  CoreGraphics enumerated one packaged window (`CGWindowID 2637`, owner
  `Hydra`, title `Hydra — Dashboard`, bounds `1440x900 @ 36,34`) after the
  failed accessibility attach was recovered. `/usr/sbin/screencapture -x -o
  -l 2637` wrote a `2880x1800` Retina frame with SHA-256
  `a404d421b26765396677c9d0708a3985c942ae0ab778971b0b99abb9db014036`.
  The raw account-bearing image remains owner-only outside Git under
  `/private/tmp/hydra-v140-native-dashboard-refresh-20260531T234102Z`. This
  refresh proves current packaged-app Dashboard provenance without promoting
  the still-blocked interactive visual-review checkbox.
- 2026-05-31 request-log shutdown drain hardening: a final runtime ownership
  sweep found that `stopRequestLogBuffer()` could call
  `flushRequestLogBuffer()` while a flush was already active and receive an
  immediate return instead of joining the active database write. Shutdown
  could consequently advance toward Prisma disconnect without waiting for
  buffered request logs. `server/services/request-log-buffer.js` now owns the
  active flush through one shared `flushPromise`, makes concurrent flush and
  stop callers join it, and leaves a bounded shutdown-timeout warning with the
  remaining queue length if the drain exceeds its limit. The buffer snapshot
  now exposes `flushInFlight`. `npm run test:request-log-buffer` passed all
  five focused tests, including an already-active flush join and a forced
  `25ms` timeout warning path. Full `npm test`, `npm run lint`, `npm run
  build`, `npm run gate` (`12/12`), and `npm run openapi:hydra` (`83
  operations`) also passed before packaging.
- 2026-05-31 current-source `v1.4.0` native rebuild after request-log
  hardening: `ELECTRON_CACHE=/private/tmp/hydra-electron-cache npm run
  electron:build:mac-arm64` rebuilt the local package. `HYDRA_BUILD_TARGET=
  darwin-arm64 npm run electron:smoke` and strict deep `codesign` passed.
  Packaged-source inspection confirmed `flushPromise`, the bounded timeout
  warning, and `flushInFlight` inside
  `release/mac-arm64/Hydra.app/Contents/Resources/app/server/services/request-log-buffer.js`.
  The current-source local arm64 zip hashes to
  `192ab474457a1bd25cabc113e9b81982959a3161cfc644f81df7844ae53049f8`;
  it is local rebuild evidence, not a replacement for the published `v1.4.0`
  asset. LaunchServices launch evidence is under
  `/private/tmp/hydra-v140-request-log-current-source-launch-20260531T235242Z`.
- 2026-05-31 current-source request-log post-rebuild calm-runtime proof:
  `/private/tmp/hydra-v140-request-log-post-rebuild-idle-reprofile-20260531T235339Z`
  sampled the untouched rebuilt package every 30 seconds for five minutes.
  All 11 samples retained four Hydra-owned processes and zero stale Hydra
  Playwright profiles. CPU stayed between `0.0%` and `2.4%` (`0.227%`
  average, `0.0%` ending), including the first startup-settling sample; RSS
  moved from `590.58 MiB` to `591.83 MiB` (`+1.25 MiB`). A post-sampler doctor
  snapshot reported four processes, `0.0%` CPU, `592.25 MB` RSS, zero stale
  profiles, no Computer Use helper, and Docker Desktop still stopped.
- 2026-05-31 request-log-hardening final local chain: the literal ordered
  acceptance sequence passed against the rebuilt current-source local
  package: `npm run lint && npm test && npm run gate &&
  HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke && npm run
  docker:smoke && npm run openapi:hydra`. Gate remained `12/12`, package smoke
  exercised the rebuilt arm64 app and zip, Docker smoke rebuilt the production
  image and launched Hydra's isolated full-Chromium persistent context, and
  OpenAPI generation retained `83 operations`. Strict deep `codesign` passed,
  `docker compose ps --all` returned no services, no `hydra_default` network
  remained, and Docker Desktop was restored to its stopped state through
  `docker desktop stop`.
- 2026-05-31 request-log-hardening checkpoint publication: commit
  `fb4a3be7a811e439ecf859c1c096bb30504494c5` used `[skip-bump]`;
  Auto-version run `26728333080` skipped as intended, CI run `26728333078`
  passed, and Docker workflow run `26728333077` passed both runtime smoke and
  registry image push.
- 2026-06-01 post-cleanup exact-local calm-runtime baseline:
  `/private/tmp/hydra-v140-post-cleanup-idle-reprofile-20260601T001229Z`
  sampled the untouched canonical packaged app every 30 seconds for five
  minutes after local packaging byproducts moved reversibly to Trash. All 11
  samples retained four Hydra-owned processes and zero stale Hydra Playwright
  profiles. CPU stayed between `0.0%` and `0.3%` (`0.036%` average, `0.0%`
  ending); RSS moved from `474.34 MiB` to `479.52 MiB` (`+5.17 MiB`).
- 2026-06-01 rotation-pool shutdown ownership hardening: the next runtime
  ownership sweep found that `rotationManager.cancelReload()` aborted its
  controller but immediately discarded `_loadPromise`, while
  `gracefulShutdown()` invoked cancellation without awaiting it. Because
  Prisma reads are not abortable in flight, shutdown could advance toward
  disconnect while an eager or cold-load pool reload was still unwinding; a
  later caller could also start duplicate work. `server/services/rotation-manager.js`
  now owns one coalesced `_reloadPromise`, aborts stale work when a newer
  reload arrives, performs one fresh rerun, joins cold-load and reload promises
  during cancellation, and logs non-abort unwind failures. `server/index.js`
  now awaits `rotationManager.cancelReload()` before later shutdown steps.
  New `server/tests/rotation-manager.test.mjs` regressions passed `3/3`:
  shutdown joins an active DB-backed reload, concurrent reloads coalesce into
  one fresh rerun, and non-abort unwind failures stay visible. Background
  visibility contracts passed `32/32`; lint, full `npm test`, Vite build,
  serial gate (`12/12`), OpenAPI generation (`83 operations`), and diff check
  passed before packaging.
- 2026-06-01 rotation-pool current-source package proof: the pre-rebuild
  package quit through native app shutdown in one second with broad before and
  after inventories under
  `/private/tmp/hydra-v140-rotation-rebuild-shutdown-20260601T001750Z`.
  `ELECTRON_CACHE=/private/tmp/hydra-electron-cache npm run
  electron:build:mac-arm64` rebuilt the local package. ARM package smoke,
  strict deep `codesign`, bundle-version inspection, and packaged-source
  inspection passed; the embedded server copy contains the coalesced reload
  loop and awaited shutdown join. The current-source local arm64 zip hashes to
  `5843e00514abc9932ddeb3dba83cc37a5bdcc618ae10eaac935608aa6dd372fc`;
  it is local rebuild evidence, not a replacement for the published `v1.4.0`
  asset. LaunchServices handoff evidence is under
  `/private/tmp/hydra-v140-rotation-current-source-launch-20260601T001924Z`.
- 2026-06-01 rotation-pool post-rebuild profile: the first untouched
  five-minute pass under
  `/private/tmp/hydra-v140-rotation-post-rebuild-idle-reprofile-20260601T002013Z`
  retained four packaged processes and zero stale Hydra Playwright profiles
  across 11 samples. Its launch-settling window moved from `4.5%` to `0.9%`
  CPU (`1.0%` average) while RSS dropped from `619.94 MiB` to `595.69 MiB`
  (`-24.25 MiB`). Because the final reading was still above the established
  calm baseline, a short native stack sample was captured under
  `/private/tmp/hydra-v140-rotation-hot-split-20260601T002143Z`; the main
  process was predominantly parked in `CFRunLoop`/`mach_msg`, not a persistent
  JS spin or HIServices attach loop. A denser settled follow-up under
  `/private/tmp/hydra-v140-rotation-dense-idle-20260601T002536Z` then captured
  12 samples over about one minute: four processes, zero stale profiles,
  `0.0...0.2%` CPU (`0.025%` average, `0.0%` ending). This is the valid
  post-settle calm-runtime result.
- 2026-06-01 rotation-pool-hardening final local chain: the literal ordered
  acceptance sequence passed: lint, full `npm test`, serial gate (`12/12`),
  ARM package smoke, Docker smoke against the rebuilt production image with
  the isolated full-Chromium persistent-context path, and OpenAPI generation
  (`83 operations`). A final strict deep `codesign` passed. `docker compose ps
  --all` returned no services, no `hydra_default` network remained, and Docker
  Desktop was restored to its stopped state in one second.
- Rotation-pool-hardening checkpoint
  `924e55186bda95eec7a6746814b4f85374cef581` used `[skip-bump]`;
  Auto-version run `26729047216` skipped, CI run `26729047218` passed, and
  Docker workflow run `26729047213` passed both runtime smoke and registry
  image push.
- 2026-06-01 release-audit truth hardening: the post-cleanup closed-app audit
  exposed two stale-evidence parser bugs. Its local-archive fallback still
  hard-coded `v1.1.0`, and its documented Docker-checkpoint matcher failed
  when Markdown wrapped between `registry` and `image`. `hydra audit` now
  derives the recorded public release from the current package version,
  requires the current release audit to name the macOS arm64, macOS Intel, and
  Windows artifact groups, and tolerates Markdown whitespace throughout the
  Docker image-push phrase. Focused CLI verification passed `46/46`. The full
  no-container chain passed: lint, full `npm test`, gate (`12/12`), OpenAPI
  generation (`83 operations`), and diff check. Closed-app audit remains
  honest at `31 ok / 5 deferred / 0 missing / 0 blockers`; its ARM evidence
  now names public `v1.4.0`, and its Docker evidence selects run
  `26729047213`.
- Release-audit truth-hardening checkpoint
  `8c7293c59d1898272ff14ec7cb8b834c39158007` used `[skip-bump]`;
  Auto-version run `26729401085` skipped, CI run `26729401072` passed, and
  Docker workflow run `26729401071` passed both runtime smoke and registry
  image push.
- 2026-06-01 current-release audit completion pass: `hydra audit` now reports
  macOS ARM, macOS Intel, Intel-current, and Windows NSIS artifact evidence
  from recorded public `v1.4.0` release-matrix proof instead of allowing the
  Intel-current claim to rest on historical `v1.0.7` CI evidence. README
  release-train copy now distinguishes the historical first `v1.1.0`
  performance tranche from the current refined `v1.4.0` desktop release and
  active `1.4.x` lane. Focused CLI verification passed `46/46`; `rg -n
  'Remotion|remotion' README.md` returned no matches.
- 2026-06-01 current-release audit quiet profile:
  `/private/tmp/hydra-v140-post-audit-current-artifacts-quiet-idle-20260601T005910Z`
  sampled the untouched canonical packaged app every 30 seconds for five
  minutes after the CLI/README fix, with no concurrent local tests or git
  activity. All 11 samples retained four Hydra-owned processes and zero stale
  Hydra Playwright profiles. Aggregate Hydra CPU stayed exactly `0.000%` in
  every sample; RSS moved from `499952 KiB` to `500864 KiB` (`+912 KiB`).
  Broad before/after `ps -ax | grep -iE
  'chrome|chromium|playwright|electron|hydra'` inventories are preserved in
  that profile directory. A preliminary overlapping sampler is preserved
  separately under
  `/private/tmp/hydra-v140-post-audit-loop-idle-20260601T005352Z` and is not
  used as the authoritative quiet-runtime result.
- 2026-06-01 current-release audit final local chain: the public
  `Hydra-1.4.0-mac-arm64.zip` downloaded from GitHub matched its published
  SHA-256 digest exactly:
  `320bb60fc3400449fb9c34d4003c5afd9811337c3c9e8cf08f074921fa5e4dac`.
  The literal ordered acceptance sequence passed: lint, full `npm test`,
  serial gate (`12/12`), ARM package smoke against that exact public zip,
  Docker smoke with a rebuilt production image and successful isolated
  full-Chromium launch, and OpenAPI generation (`83 operations`). A final
  strict deep `codesign` passed. `docker compose ps --all` returned no
  services, no `hydra_default` network remained, and Docker Desktop stopped
  cleanly in one second. The temporary public-zip symlink and downloaded smoke
  input directory were moved reversibly out of the workspace into Trash;
  `release/` again contains only `mac-arm64/Hydra.app`.
- Current-release artifact-proof checkpoint
  `51fff07eff4500dee848f74036de94749df6f277` used `[skip-bump]`;
  Auto-version run `26730026832` skipped, CI run `26730026830` passed, and
  Docker workflow run `26730026837` passed both runtime smoke and registry
  image push.
- 2026-06-01 Docker audit predicate completion: the `docker-runtime` audit row
  previously required the original full compose-start baseline but only
  appended the newest parsed Docker checkpoint as informational evidence.
  `bin/commands/audit.js` now requires both the original end-to-end baseline
  and at least one newer recorded Docker checkpoint run before the row can
  pass. The CLI regression locks that conjunction into the audit source
  contract and still requires newest-checkpoint evidence. Syntax validation,
  focused CLI verification (`46/46`), closed-app audit (`31 ok / 5 deferred /
  0 missing / 0 blockers`), and diff check passed. The complete no-Docker
  source chain then passed: lint, full `npm test`, gate (`12/12`), OpenAPI
  generation (`83 operations`), and diff check.
- Docker-audit-predicate checkpoint
  `81989ec6766c1d82f464d99905b521dea03728ea` used `[skip-bump]`;
  Auto-version run `26730171287` skipped, CI run `26730171273` passed, and
  Docker workflow run `26730171272` passed both runtime smoke and registry
  image push. GitHub emitted its upstream Node 20 action-runtime deprecation
  warning for the current `docker/build-push-action@v6`,
  `docker/login-action@v3`, `docker/metadata-action@v5`, and
  `docker/setup-buildx-action@v3` releases while forcing them onto Node 24;
  the Hydra-owned workflow remains green.
- 2026-06-01 multi-proxy selector verification hardening: the account proxy
  pool already selected one automation route per task and threaded it through
  signup, management-key Server Action and REST paths, redemption Server
  Action retries, tRPC migration calls, REST probes, API-key sync, and
  Playwright fallback. Its unit proof only stored one proxy, however, so it
  could not deterministically demonstrate multi-entry distribution.
  `server/services/account-proxy-pool.js` now exposes the small
  `pickProxyIndex(proxyCount, entropy)` boundary while production
  `pickAccountProxy()` still supplies `randomBytes(4)` per new task. The proxy
  regression passes controlled entropy values ending in `0` and `1` through a
  two-entry encrypted pool, proving both entries are selectable; it also
  rejects short entropy and retains the empty-pool behavior. Focused proxy
  tests passed `5/5`, background visibility contracts passed `32/32`, CLI
  tests passed `46/46`, and closed-app audit remained honest at `31 ok / 5
  deferred / 0 missing / 0 blockers`. The complete no-Docker source chain
  passed: lint, full `npm test`, Vite build, gate (`12/12`), OpenAPI generation
  (`83 operations`), and diff check.
- 2026-06-01 multi-proxy selector current-source package proof: broad
  before/after `ps -ax | grep -iE
  'chrome|chromium|playwright|electron|hydra'` shutdown inventories are
  preserved under
  `/private/tmp/hydra-v140-proxy-selector-rebuild-shutdown-20260531T183049Z`.
  Native app quit removed all packaged Hydra-owned processes in two seconds;
  unrelated Chrome and MCP browser processes remain visible in both broad
  captures. The current-source arm64 package rebuilt successfully. ARM package
  smoke, strict deep `codesign`, bundle-version inspection (`1.4.0`), and
  embedded-source inspection passed; the local zip hashed to
  `5e9eaa8927814110a601582c3f083377ce0652dfb899795ada1f1b8cfc7f322c`.
  That zip is local rebuild evidence, not a replacement for the public
  `v1.4.0` asset. LaunchServices relaunch evidence is under
  `/private/tmp/hydra-v140-proxy-selector-current-source-launch-20260531T183234Z`.
  Generated zip, blockmap, updater metadata, and builder-debug byproducts were
  moved reversibly to
  `~/.Trash/hydra-proxy-selector-current-source-package-20260531T183913Z`;
  `release/` again contains only `mac-arm64/Hydra.app`.
- 2026-06-01 multi-proxy selector post-rebuild profile:
  `/private/tmp/hydra-v140-proxy-selector-post-rebuild-quiet-idle-20260531T183255Z`
  sampled the untouched rebuilt package every 30 seconds for five minutes
  after a 30-second splash-settle window. All 11 samples retained four
  Hydra-owned processes and zero active Hydra Playwright profiles. Aggregate
  Hydra CPU stayed between `0.000%` and `0.700%` (`0.073%` average, `0.000%`
  ending); RSS moved from `632720 KiB` to `608544 KiB` (`-24176 KiB`) while
  launch allocations settled. Broad before/after inventories are preserved in
  that profile directory.
- 2026-06-01 multi-proxy selector literal local chain: the final ordered
  local verification passed lint, full `npm test`, gate (`12/12`), ARM package
  smoke, Docker smoke with a rebuilt production image and successful isolated
  full-Chromium Playwright launch, OpenAPI generation (`83 operations`), and
  diff check. Strict deep `codesign` passed after the chain. The package smoke
  used reversible workspace symlinks to the current-source local zip and
  blockmap already preserved under
  `~/.Trash/hydra-proxy-selector-current-source-package-20260531T183913Z`;
  those temporary links were moved back out of the workspace to
  `~/.Trash/hydra-proxy-selector-final-smoke-link-20260601T014406Z` and
  `~/.Trash/hydra-proxy-selector-final-smoke-blockmap-link-20260601T014406Z`.
  `docker compose ps --all` returned no services, no `hydra_default` network
  remained, Docker Desktop stopped cleanly in one second, and `release/` again
  contains only `mac-arm64/Hydra.app`. Spotlight resolves exactly that one
  `com.zayd.hydra` bundle.
- Multi-proxy selector checkpoint
  `a17067108bc0802a9bf259736b3698a55d380190` used `[skip-bump]`;
  Auto-version run `26730889924` skipped, CI run `26730889905` passed, and
  Docker workflow run `26730889927` passed both runtime smoke and registry
  image push. GitHub again emitted its upstream Node 20 action-runtime
  deprecation warning for the current `docker/build-push-action@v6`,
  `docker/login-action@v3`, `docker/metadata-action@v5`, and
  `docker/setup-buildx-action@v3` releases while forcing them onto Node 24;
  the Hydra-owned workflow remains green.
- 2026-06-01 detached-batch cancellation baseline:
  `/private/tmp/hydra-v140-continuation-idle-reprofile-20260601T015213Z`
  sampled the untouched packaged app every 30 seconds for five minutes before
  this hardening pass. All 11 samples retained four Hydra-owned processes and
  zero Hydra Playwright profiles. Aggregate Hydra CPU was `0.000%` in 10
  samples and briefly reached `23.300%` in one split sample before ending at
  `0.000%`; RSS moved from `489968 KiB` to `495504 KiB` (`+5536 KiB`).
  A short main-process stack sample after the transient peak found AppKit
  parked in `CFRunLoop`/`mach_msg`, not a persistent JS spin. The simultaneous
  doctor snapshot recorded `186` non-Hydra browser-tool processes at
  `290.6%` aggregate CPU, so the retained peak is treated as an observed but
  externally contaminated transient, not attributed to detached Hydra work
  without evidence.
- 2026-06-01 detached-batch cancellation hardening: the shared
  `runInBatches()` delay previously had no abort owner, so a disconnected
  client or canceled supervisor task could leave future account and
  code-redemption chunks queued behind a detached timeout. Bulk account
  import, OTP stubs, provisioning, code redemption, matrix redemption, the
  dashboard bulk runner, and the renderer request helpers now propagate
  disconnect and task-cancel signals. Batch sleeps are abort-aware and
  unref'd. Bulk-code task metadata also no longer stores the raw redemption
  code. Direct regressions passed `5/5`; background visibility contracts
  passed `32/32`; UI static contracts passed `39/39`; chain completeness
  passed `1/1`; and the full no-Docker source chain passed lint, full
  `npm test`, Vite build, gate (`12/12`), OpenAPI generation (`83
  operations`), and diff check.
- 2026-06-01 detached-batch teardown benchmark:
  `/private/tmp/hydra-batch-disconnect-benchmark-20260601T020048Z/summary.txt`
  exercised `200` canceled two-chunk batch surfaces with a `100ms`
  inter-chunk delay. The prior shape launched `200` post-disconnect worker
  chunks and settled in `102.030ms`; the hardened runner launched `0`,
  aborted all `200`, and settled in `7.247ms`.
- 2026-06-01 detached-batch current-source package proof: native quit removed
  all four packaged Hydra-owned processes in one second with inventories under
  `/private/tmp/hydra-v140-batch-abort-rebuild-shutdown-20260601T020334Z`.
  The arm64 package rebuilt successfully. ARM package smoke, strict deep
  `codesign`, bundle-version inspection (`1.4.0`), and embedded abort-wiring
  inspection passed. The local zip SHA-256 is
  `8bb94844319f96edecabd94059139e28c9508aafa326ed7f6476e174684c4700`;
  it is local current-source proof, not a replacement public asset.
  LaunchServices relaunch evidence is under
  `/private/tmp/hydra-v140-batch-abort-current-source-launch-20260601T020511Z`.
  Generated zip, blockmap, updater metadata, and builder-debug byproducts were
  moved reversibly to
  `~/.Trash/hydra-batch-abort-current-source-package-20260601T021151Z`;
  `release/` again contains only `mac-arm64/Hydra.app`.
- 2026-06-01 detached-batch post-rebuild quiet profile:
  `/private/tmp/hydra-v140-batch-abort-post-rebuild-quiet-idle-20260601T020610Z`
  sampled the untouched rebuilt package every 30 seconds for five minutes
  after the splash-settle window. All 11 samples retained four Hydra-owned
  processes. Aggregate Hydra CPU stayed exactly `0.000%`; RSS moved from
  `603520 KiB` to `609472 KiB` (`+5952 KiB`). The sampler's broad raw matcher
  counted its own shell command once; the authoritative `hydra doctor --json`
  follow-up reported zero Hydra Playwright profiles and four calm Hydra
  processes.
- 2026-06-01 detached-batch final literal local chain: lint, full `npm test`,
  serial gate (`12/12`), ARM package smoke, Docker smoke with a rebuilt
  production image and successful isolated full-Chromium Playwright launch,
  OpenAPI generation (`83 operations`), and diff check passed in order.
  Strict deep `codesign` passed afterward. `docker compose ps --all` returned
  no services and no `hydra_default` network remained; postcondition evidence
  is under
  `/private/tmp/hydra-v140-batch-abort-docker-postconditions-20260601T021656Z`.
  Docker Desktop stopped cleanly in one second with evidence under
  `/private/tmp/hydra-v140-batch-abort-docker-stop-20260601T021709Z`.
  Temporary package-smoke symlinks moved reversibly to
  `~/.Trash/hydra-batch-abort-final-smoke-links-20260601T021709Z`.
  `release/` again contains only `mac-arm64/Hydra.app`; Spotlight resolves
  exactly that one `com.zayd.hydra` bundle, and the rebuilt app remains live
  with four owned processes.
- Detached-batch cancellation checkpoint
  `219ae795501614b7040b63b8502b7d2135367111` used `[skip-bump]`;
  Auto-version run `26731750366` skipped, CI run `26731750346` passed, and
  Docker workflow run `26731750318` passed both runtime smoke and registry
  image push. GitHub again emitted its upstream Node 20 action-runtime
  deprecation warning for the current `docker/build-push-action@v6`,
  `docker/login-action@v3`, `docker/metadata-action@v5`, and
  `docker/setup-buildx-action@v3` releases while forcing them onto Node 24;
  the Hydra-owned workflow remains green.
- 2026-06-01 request-owned upstream cancellation hardening: shared abort
  helpers now own client disconnects, timeout timers, retry sleeps, active
  refresher sweeps, and optional Playwright context teardown. Signals are
  threaded through OpenRouter, Clerk auth, dashboard JWT self-healing,
  password/OTP and magic-link flows, management-key provisioning, code
  redemption, account generation, diagnostic probes, model-list refresh,
  proxy fallback, and session-refresh shutdown. Focused request-cancellation
  tests passed `3/3`; detached-batch tests passed `5/5`; background visibility
  contracts passed `32/32`; session-refresh contracts passed `12/12`; UI
  static contracts passed `39/39`; chain completeness passed `1/1`; and the
  complete no-Docker source chain passed lint, full `npm test`, Vite build,
  gate (`12/12`), OpenAPI generation (`83 operations`), and diff check.
- 2026-06-01 request-cancellation benchmark:
  `/private/tmp/hydra-openrouter-disconnect-benchmark-20260531T195305/summary.txt`
  exercised `200` canceled OpenRouter retry surfaces with a `500ms` delay.
  The prior shape launched `200` post-disconnect retries, made `400` fetches,
  and settled in `525.428ms`; the hardened path made `200` fetches, aborted
  all `200` surfaces, avoided every post-disconnect fetch, and settled in
  `16.496ms`.
- 2026-06-01 request-owned current-source package proof: native quit removed
  all four Hydra-owned package processes immediately with evidence under
  `/private/tmp/hydra-v140-request-ownership-rebuild-shutdown-20260531T195438`.
  The ARM app rebuilt and passed package smoke, strict deep `codesign`, and
  bundle-version inspection (`1.4.0`). The local zip SHA-256 is
  `c3700c1a52d44f9a2638c1f71ce0114aeccc030f8eb0d23f0ee96aa454a98844`;
  it is local current-source proof, not a replacement public asset.
  LaunchServices relaunch evidence is under
  `/private/tmp/hydra-v140-request-ownership-current-source-launch-20260531T195645`.
  Generated zip, blockmap, updater metadata, and builder-debug byproducts
  moved reversibly to
  `~/.Trash/hydra-request-ownership-current-source-package-20260531T200313`;
  `release/` again contains only `mac-arm64/Hydra.app`, and Spotlight resolves
  exactly that one Hydra bundle.
- 2026-06-01 request-owned post-rebuild quiet profile:
  `/private/tmp/hydra-v140-request-ownership-post-rebuild-quiet-idle-20260531T195735`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across 11 settled samples. Aggregate CPU averaged `0.436%` and ended at
  `0.000%`; RSS moved from `635088 KiB` to `604096 KiB` (`-30992 KiB`).
  `hydra doctor --json` separately reported four owned processes at `0%` CPU
  and zero Hydra Playwright profiles. It also recorded unrelated external
  browser-tool pressure, which is not attributed to Hydra.
- 2026-06-01 request-ownership audit predicate repair: the source hardening
  correctly added a signal argument to proxy-aware management-key,
  redemption, and Playwright paths, but the closed-app audit still matched the
  old call shape. The predicate and CLI regression now require the
  signal-aware form. The repaired audit returns `31 ok / 5 deferred /
  0 missing / 0 blockers` with `complete=false`.
- Request-ownership checkpoint
  `fced9d6443cb852a8d1229c7289f7b81a75477b7` used `[skip-bump]`;
  Auto-version run `26732648111` skipped, CI run `26732648116` passed, and
  Docker workflow run `26732648112` passed both runtime smoke and registry
  image push. GitHub again emitted its upstream Node 20 action-runtime
  deprecation warning for the current Docker helper actions while forcing
  them onto Node 24; the Hydra-owned workflow remains green.
- 2026-06-01 shared health-probe ownership hardening: `/api/system/health`
  now binds renderer disconnects and passes an abort signal into the deduped
  OpenRouter reachability probe. The probe tracks live subscribers, rejects
  abandoned callers immediately, preserves a shared fetch while any caller
  remains, and aborts upstream only when its final subscriber detaches.
  Focused OpenRouter cancellation tests passed `5/5`; API integration passed
  `7/7`; background visibility contracts passed `32/32`; and the complete
  no-Docker source chain passed lint, full `npm test`, Vite build, gate
  (`12/12`), OpenAPI generation (`83 operations`), and diff check.
- 2026-06-01 health-surface disconnect benchmark:
  `/private/tmp/hydra-health-probe-disconnect-benchmark-20260601T031358Z/summary.txt`
  exercised `200` abandoned health surfaces. The prior shared fetch remained
  alive for `503.711ms`; the subscriber-owned path rejected all `200`
  callers, stopped in `23.931ms`, and removed `479.780ms` of detached tail.
- 2026-06-01 Diagnostics route ownership hardening: Settings Diagnostics now
  aborts its previous health and proxy requests before starting a refresh,
  aborts pending HTTP work on unmount, and suppresses late native bridge state
  writes after navigation. Its deterministic teardown benchmark at
  `/private/tmp/hydra-diagnostics-unmount-benchmark-20260601T032542Z/summary.txt`
  reduced `400` pending post-unmount requests to `0`, aborted all `400`, and
  suppressed `200` stale page writes.
- 2026-06-01 quiet background health loading hardening: package profiling
  exposed routine upstream polling mounting the animated foreground progress
  bar every 30 seconds. The background banner now uses a quiet health helper;
  foreground requests and user-triggered Diagnostics refreshes retain loading
  feedback. Dead `.edm-bar` infinite-animation CSS with no renderer owner was
  removed. The event benchmark at
  `/private/tmp/hydra-background-health-loading-benchmark-20260601T033914Z/summary.txt`
  removes `400` loading events and `200` animated progress mounts across
  `200` background polls.
- 2026-06-01 quiet-health current-source package proof: native quit removed
  all four prior package processes immediately with inventories under
  `/private/tmp/hydra-v140-quiet-health-rebuild-shutdown-20260601T034025Z`.
  ARM rebuild, package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), embedded source-map inspection, and LaunchServices relaunch
  passed. The local zip SHA-256 was
  `f4bead3fafecd3c3f45ddd4d27783579f78ef479d0028155934e65521f80231b`;
  it is local current-source proof, not a replacement public asset.
  LaunchServices evidence is under
  `/private/tmp/hydra-v140-quiet-health-current-source-launch-20260601T034214Z`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-quiet-health-current-source-package-20260601T034844Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly that one bundle, and local Docker remains stopped.
- 2026-06-01 quiet-health post-rebuild profile:
  `/private/tmp/hydra-v140-quiet-health-post-rebuild-idle-20260601T034327Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across 11 untouched samples over five minutes. CPU ranged from `0.000%` to
  `0.100%`, averaged `0.009%`, and ended at `0.000%`; RSS moved from
  `605104 KiB` to `607424 KiB` (`+2320 KiB`). This replaces the intermediate
  Diagnostics-build profile under
  `/private/tmp/hydra-v140-diagnostics-post-rebuild-idle-20260601T033118Z`,
  which honestly recorded a `6.818%` average and `9.400%` ending CPU before
  the quiet-loading fix.
- Health-probe checkpoint `2348d0268fd9957d2243d665be07c54fdf378d70`,
  Diagnostics checkpoint `a7376c66803833d58e95ef256a55d7bbc5f0d24e`,
  and quiet-loading checkpoint
  `e583326c89f35da0d8f30a81fc4d16625395546c` used `[skip-bump]`.
  Their Auto-version runs skipped. The newest CI run `26733857394` passed,
  and newest Docker workflow `26733857387` passed runtime smoke and registry
  image push.
- 2026-06-01 passive-observer loading hardening: the quiet-request split now
  covers scheduled dashboard metrics, pool sync status, traffic, vault
  account refresh, cached session-status fallbacks, magic-link claim and live
  confirmation polling, generator status and heartbeat polling, debounced
  Code Redeemer session preflight, and delayed post-run redemption-history
  reconciliation. Foreground start, verify, refresh, sync, provision, redeem,
  and explicit live-session actions keep the animated loading default.
  UI static contracts passed `40/40`; background visibility contracts passed
  `32/32`; CLI contracts passed `46/46`; lint, full `npm test`, Vite build,
  gate (`12/12`), OpenAPI route-map test, and diff check passed.
- 2026-06-01 passive-observer loading benchmark:
  `/private/tmp/hydra-passive-observer-loading-benchmark-20260601T035300Z/summary.json`
  models `200` cycles for each patched observer class. The prior paths emitted
  `5600` global loading events; the quiet paths emit `0`, while foreground
  requests still track loading by default.
- 2026-06-01 passive-observer current-source package proof: native quit
  removed all four prior package processes in one second with evidence under
  `/private/tmp/hydra-v140-passive-observer-rebuild-shutdown-20260601T040100Z`.
  ARM rebuild, package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), and embedded source-map inspection passed. The local ARM zip
  SHA-256 was
  `e2fa276b3610dc83a648904d681077b37b6c64b8cabcb7b520bb8d215f48bbe1`;
  it is local current-source proof, not a replacement public asset.
  LaunchServices evidence is under
  `/private/tmp/hydra-v140-passive-observer-current-source-launch-20260601T040400Z`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-passive-observer-current-source-package-20260601T040400Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly that one Hydra application bundle, and local Docker remains
  stopped.
- 2026-06-01 passive-observer post-rebuild profile:
  `/private/tmp/hydra-v140-passive-observer-post-rebuild-idle-20260601T040500Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across 11 untouched samples over five minutes. CPU ranged from `0.000%` to
  `0.300%`, averaged `0.027%`, and ended at `0.000%`; RSS moved from
  `634976 KiB` to `603984 KiB` (`-30992 KiB`).
- Passive-observer checkpoint `ceeeb5da21a13244dae3ea035cbdad53059e350b`
  used `[skip-bump]`; Auto-version run `26734396984` skipped, CI run
  `26734396983` passed, and Docker workflow run `26734396980` passed runtime
  smoke and registry image push. The quiet-helper change exposed stale
  closed-app audit predicates for bulk magic-link and Code Redeemer observer
  paths; those predicates and the CLI regression now require the quiet form.
  The repaired audit returns `31 ok / 5 deferred / 0 missing / 0 blockers`
  with `complete=false`.
- 2026-06-01 final exact-payload refresh: after the audit/docs checkpoint
  `9d5db1c6a7b4c470460e59d8d18fb9d1863f5b88`, the ARM package rebuilt once
  more and again passed package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), and embedded renderer source-map inspection. The final local ARM
  zip SHA-256 was
  `d568d3394737b7dd541de1148e99f74efa3bf6163980b2ae5c1b09b59e648cea`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-passive-observer-final-package-20260601T041500Z`.
  LaunchServices evidence is under
  `/private/tmp/hydra-v140-passive-observer-final-launch-20260601T041500Z`:
  the app launched `0 -> 4` processes in three seconds and all four settled
  at `0.0%` CPU with zero Hydra Playwright profiles. Packaged `docs/` and
  `bin/` are intentionally excluded, so this documentation-only hash note
  does not stale the desktop payload.
- Audit/docs checkpoint `9d5db1c6a7b4c470460e59d8d18fb9d1863f5b88`
  used `[skip-bump]`; Auto-version run `26734703372` skipped, CI run
  `26734703373` passed, and Docker workflow run `26734703374` passed runtime
  smoke and registry image push.
- 2026-06-01 actionable recovery-frame animation hardening: persistent
  offline and restart-required load frames no longer keep the indeterminate
  meter sweeping forever. Error and warning tones settle to a completed
  static meter while ordinary loading states retain the bounded visual cue.
  `server/tests/ui-static-contract.test.mjs` locks the distinction down.
  The deterministic benchmark under
  `/private/tmp/hydra-recovery-frame-animation-benchmark-20260601T042618Z`
  reduces persistent recovery-meter animations from `2` to `0` while
  preserving the normal loading animation. UI static contracts passed
  `41/41`; lint, full `npm test`, build, gate (`12/12`), OpenAPI generation
  (`83 operations`), audit, and diff check passed before the package rebuild.
- 2026-06-01 recovery-frame current-source package proof: native quit removed
  the prior four package processes immediately with evidence under
  `/private/tmp/hydra-v140-recovery-frame-rebuild-shutdown-20260601T042730Z`.
  ARM rebuild, package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), and embedded renderer CSS inspection passed. The local ARM zip
  SHA-256 was
  `873f89009841808a761ceb276de34e8471eceb024d5e1a2c2191718dcbbf4641`;
  it is current-source local proof, not a replacement public asset.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-recovery-frame-package-20260601T042948Z`; `release/` again
  contains only `mac-arm64/Hydra.app`, Spotlight resolves exactly that one
  bundle, and local Docker remains stopped.
- 2026-06-01 recovery-frame post-rebuild profile:
  `/private/tmp/hydra-v140-recovery-frame-idle-reprofile-20260601T043139Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across 11 untouched samples over five minutes. CPU ranged from `0.000%` to
  `0.100%`, averaged `0.009%`, and ended at `0.000%`; RSS moved from
  `606336 KiB` to `610896 KiB` (`+4560 KiB`).
- 2026-06-01 rebuilt-package Touch ID inspection and Computer Use retry: the
  packaged preload, IPC handlers, and biometric implementation still expose
  the fail-closed auth-token gate, macOS `canPromptTouchID()` /
  `promptTouchID()` path, Settings status, opt-in toggle, `Test Prompt`, and
  24-hour unlock-token copy. The focused desktop isolation chain passed
  `28/28`. After the clean idle profile, one controlled
  `get_app_state("com.zayd.hydra")` retry again timed out after `120s`.
  External `SkyComputerUseService` held `28.9%` CPU and Hydra's otherwise
  idle main process held `67.3%`; its GPU, network, and renderer helpers
  stayed idle. Five-second samples traversed HIServices accessibility
  attribute enumeration. Terminating only the external helper restored the
  unchanged four-process Hydra tree immediately to `0.0%` CPU with zero
  stale profiles. Evidence is under
  `/private/tmp/hydra-v140-recovery-frame-cua-retry-20260601T043921Z`.
  Fingerprint approval and interactive route review remain manual.
- Recovery-frame checkpoint `4f87073cfeee4be4406763270c00659004cbe3df`
  used `[skip-bump]`; Auto-version run `26735571431` skipped, CI run
  `26735571409` passed, and Docker workflow run `26735571435` passed runtime
  smoke and registry image push.
- 2026-06-01 hidden fallback-glyph cleanup: the React `HydraLoadFrame`
  fallback used by offline, restart-required, and shutdown surfaces no longer
  allocates a permanently hidden letter-rain subtree. The removed code built
  `34` hidden spans for a default frame and `18` for a compact frame even
  though `.hydra-letter-rain { display: none; }` prevented either subtree
  from rendering. The real Electron splash remains separate and unchanged at
  its bounded `72`-word target. The deterministic benchmark under
  `/private/tmp/hydra-hidden-fallback-glyph-benchmark-20260601T045446616Z/summary.json`
  records default fallback hidden nodes `34 -> 0`, compact fallback hidden
  nodes `18 -> 0`, dead CSS removal, and the untouched real splash. UI static
  contracts now pass `42/42`; lint, full `npm test`, build, gate (`12/12`),
  OpenAPI generation (`83 operations`), audit, and diff check passed before
  the package rebuild.
- 2026-06-01 hidden fallback-glyph current-source package proof: native quit
  removed all four prior package processes immediately with evidence under
  `/private/tmp/hydra-v140-hidden-glyph-rebuild-shutdown-20260601T045550Z`.
  ARM rebuild, package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), packaged renderer inspection for the absent hidden-glyph path,
  and packaged splash inspection for the retained `HYDRA_SPLASH_TARGET=72`
  passed. The local ARM zip SHA-256 was
  `cba6300b961fe2aded319a0e015a7a45986f165e9f910915720f2ab0f88cc1a0`;
  it is current-source local proof, not a replacement public asset.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-hidden-fallback-glyph-package-20260601T045724Z`;
  `release/` again contains only `mac-arm64/Hydra.app`.
- 2026-06-01 hidden fallback-glyph post-rebuild profile:
  `/private/tmp/hydra-v140-hidden-glyph-post-rebuild-idle-20260601T050012Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across 11 untouched samples over five minutes. CPU ranged from `0.000%` to
  `4.100%`, averaged `1.655%`, and ended at `1.000%`; RSS moved from
  `606160 KiB` to `610528 KiB` (`+4368 KiB`). This does not claim an idle-CPU
  reduction from DOM removal. A short attribution pass under
  `/private/tmp/hydra-v140-hidden-glyph-transient-attribution-20260601T050202Z`
  found brief low pulses and otherwise-zero snapshots; an eight-second native
  main-process sample under
  `/private/tmp/hydra-v140-hidden-glyph-main-stack-20260601T050302Z` was
  idle-dominant. The follow-up sweep found a separate server-side cost:
  `TaskSupervisor` still arms a 30-second expiry timeout while its task map is
  empty. That demand-driven scheduler repair is the next code checkpoint.
- Hidden fallback-glyph checkpoint
  `4d370181e93b11bfa4408a80dc236e455840cb28` used `[skip-bump]`;
  Auto-version run `26736288813` skipped, CI run `26736288818` passed, and
  Docker workflow run `26736288832` passed runtime smoke and registry image
  push.
- 2026-06-01 demand-driven task-expiry scheduler: `TaskSupervisor` no longer
  arms a 30-second expiry timeout against an empty task map. Server startup
  stays disarmed while idle; task registration arms the existing one-shot
  expiry path; archiving the final active task clears it again; shutdown
  still clears the timer and waits for any already-running sweep. The
  deterministic lifecycle benchmark under
  `/private/tmp/hydra-task-supervisor-demand-driven-benchmark-20260601T050815Z/summary.json`
  records empty-task wakeups per hour `120 -> 0`, no idle timer after start,
  an armed timer after registration, no timer after final archive, and
  preserved active-task expiry cadence. The required recon note is
  `docs/recon/TASK_SUPERVISOR_IDLE_SCHEDULER.md`. Focused task lifecycle tests
  passed `4/4`, background visibility contracts passed `32/32`, and the
  complete source chain passed lint, full `npm test`, build, gate (`12/12`),
  OpenAPI generation (`83 operations`), audit, and diff check before rebuild.
- 2026-06-01 task-scheduler current-source package proof: native quit removed
  all four prior package processes immediately with evidence under
  `/private/tmp/hydra-v140-task-supervisor-rebuild-shutdown-20260601T050928Z`.
  ARM rebuild, package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), embedded demand-driven scheduler inspection, packaged
  hidden-glyph absence, and retained `HYDRA_SPLASH_TARGET=72` passed. The
  local ARM zip SHA-256 was
  `df686f29f2f482383841e2ffe05bb64bae73c952d99e08afc49c996ce330fd0b`;
  it is current-source local proof, not a replacement public asset.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-task-supervisor-package-20260601T051122Z`; `release/` again
  contains only `mac-arm64/Hydra.app`, Spotlight resolves exactly that one
  bundle, and Docker Desktop remains stopped.
- 2026-06-01 task-scheduler LaunchServices and post-rebuild profile:
  `/private/tmp/hydra-v140-task-supervisor-current-source-launch-20260601T051136Z`
  recorded splash-active CPU at three seconds, handoff CPU at 20 seconds, and
  the settled four-process package at `0.100%` CPU with zero stale profiles
  and no Computer Use helper by 35 seconds. Native splash diagnostics remained
  finite: target and queue length `72`, shattered words `72`, duplicate skips
  `0`, portal collision disabled, lift applied, timers `0`, RAF inactive,
  Matter cleared. The untouched five-minute profile under
  `/private/tmp/hydra-v140-task-supervisor-post-rebuild-idle-20260601T051236Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across all 11 samples. CPU ranged from `0.000%` to `0.100%`, averaged
  `0.009%`, and ended at `0.000%`; RSS moved from `605696 KiB` to
  `602400 KiB` (`-3296 KiB`).
- Task-scheduler checkpoint
  `b1577fd2938848fd292b6945c064fb3fff4bd91b` used `[skip-bump]`;
  Auto-version run `26736665665` skipped, CI run `26736665670` passed, and
  Docker workflow run `26736665671` passed runtime smoke and registry image
  push.
- 2026-06-01 request-log retention idle guard: the 15-minute retention cycle
  now stops after one oldest-row read when `RequestLog` is empty, skips age
  deletion while the oldest row is fresh, and skips cap deletion while the
  table stays below `KEEP_COUNT`. Existing stale-row and overflow cleanup
  remain intact. Both production and repo-local databases held zero request
  logs during inspection. The deterministic SQLite benchmark under
  `/private/tmp/hydra-request-log-retention-empty-table-benchmark-20260601T051408Z/summary.json`
  records idle writes `2 -> 0` and 20,000 empty cycles
  `159.386ms -> 28.574ms` (`82.1%` lower elapsed time). The required recon
  note is `docs/recon/REQUEST_LOG_RETENTION_IDLE_GUARD.md`. Focused retention
  tests passed `4/4`, background visibility contracts passed `32/32`, and
  the complete source chain passed lint, full `npm test`, build, gate
  (`12/12`), OpenAPI generation (`83 operations`), audit, and diff check.
- 2026-06-01 request-log retention current-source package proof: native quit
  removed all four prior package processes immediately with evidence under
  `/private/tmp/hydra-v140-request-log-retention-rebuild-shutdown-20260601T052441Z`.
  ARM rebuild, package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), embedded retention-guard inspection, packaged hidden-glyph
  absence, and retained `HYDRA_SPLASH_TARGET=72` passed. The local ARM zip
  SHA-256 was
  `a257f62ba968eb8f9f48bd62f734aab19a42a66a6e7dcec36c6be19af62495fc`;
  it is current-source local proof, not a replacement public asset.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-request-log-retention-package-20260601T052618Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly that one bundle, and Docker Desktop remains stopped.
- 2026-06-01 request-log retention LaunchServices proof:
  `/private/tmp/hydra-v140-request-log-retention-current-source-launch-20260601T052630Z`
  recorded splash-active CPU at three seconds, handoff CPU at 20 seconds, and
  the settled four-process package at `0.000%` CPU with zero stale profiles
  and no Computer Use helper by 35 seconds. Native splash diagnostics remained
  finite: target and queue length `72`, shattered words `72`, duplicate skips
  `0`, portal collision disabled, lift applied, timers `0`, RAF inactive, and
  Matter cleared.
- 2026-06-01 request-log retention post-rebuild profile:
  `/private/tmp/hydra-v140-request-log-retention-post-rebuild-idle-20260601T052729Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across all 11 untouched samples over five minutes. CPU ranged from `0.000%`
  to `0.700%`, averaged `0.064%`, and ended at `0.000%`; RSS moved from
  `610080 KiB` to `614928 KiB` (`+4848 KiB`).
- Request-log retention checkpoint
  `6f2fc6d40b39d3c364ea294caec91ef002ba8c41` used `[skip-bump]`;
  Auto-version run `26737110121` skipped, CI run `26737110128` passed, and
  Docker workflow run `26737110126` passed runtime smoke and registry image
  push.
- 2026-06-01 empty-pool health-pinger scheduler: the five-minute OpenRouter
  key-health timeout is now demand-driven. The rotation manager publishes
  pool replacements after reload, drop, and eviction; pinger startup
  subscribes to pool changes; an empty pool stays disarmed; the first pooled
  key rearms the existing delayed probe; final-key removal clears the timer;
  and shutdown unsubscribes. Production inspection found `13` stored keys and
  `0` active pooled keys. The deterministic lifecycle benchmark under
  `/private/tmp/hydra-health-pinger-empty-pool-benchmark-20260601T053640Z/summary.json`
  records empty-pool wakeups per hour `12 -> 0`, no timer against an empty
  pool, a timer after first-key arrival, no timer after final-key removal, and
  preserved delayed-probe semantics while keys exist. The required recon note
  is `docs/recon/EMPTY_POOL_HEALTH_PINGER_SCHEDULER.md`. Focused pinger tests
  passed `4/4`, rotation-manager lifecycle tests passed `4/4`, background
  visibility contracts passed `32/32`, and the complete source chain passed
  lint, full `npm test`, build, gate (`12/12`), OpenAPI generation
  (`83 operations`), audit, and diff check.
- 2026-06-01 empty-pool health-pinger current-source package proof: native
  quit removed all four prior package processes immediately with evidence
  under
  `/private/tmp/hydra-v140-empty-pool-health-pinger-rebuild-shutdown-20260601T053814Z`.
  ARM rebuild, package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), embedded pinger guard, rotation notifier, retained
  request-log-retention guard, and retained `HYDRA_SPLASH_TARGET=72` passed.
  The local ARM zip SHA-256 was
  `b7e3aebc871f1ad2e3b74882a4ac662a783cca49d24a28d9e590c41d33dbfe6f`;
  it is current-source local proof, not a replacement public asset.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-empty-pool-health-pinger-package-20260601T053957Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly that one bundle, and Docker Desktop remains stopped.
- 2026-06-01 empty-pool health-pinger LaunchServices proof:
  `/private/tmp/hydra-v140-empty-pool-health-pinger-current-source-launch-20260601T054009Z`
  recorded splash-active CPU at three seconds, handoff CPU at 20 seconds, and
  the settled four-process package at `0.000%` CPU with zero stale profiles
  and no Computer Use helper by 35 seconds. Native splash diagnostics remained
  finite: target and queue length `72`, shattered words `72`, duplicate skips
  `0`, portal collision disabled, lift applied, timers `0`, RAF inactive, and
  Matter cleared.
- 2026-06-01 empty-pool health-pinger post-rebuild profile:
  `/private/tmp/hydra-v140-empty-pool-health-pinger-post-rebuild-idle-20260601T054117Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across all 11 untouched samples over five minutes. CPU ranged from `0.000%`
  to `0.300%`, averaged `0.027%`, and ended at `0.300%`; RSS moved from
  `604464 KiB` to `608976 KiB` (`+4512 KiB`).
- 2026-06-01 Node module-mock harness migration: all test mocks now use the
  current `exports` object and `exports.default` spelling instead of Node's
  deprecated `namedExports` and `defaultExport` options. Repository search
  records deprecated option occurrences `68 -> 0` across `13` test files.
  The shared test-chain completeness suite now recursively rejects either
  deprecated spelling across `server/tests`, `electron/tests`, and `scripts`.
  The focused completeness suite passed `2/2`; the complete source chain then
  passed full `npm test`, lint, build, integration gate (`12/12`), OpenAPI
  generation (`83 operations`), dogfood preflight, audit, and diff check.
  Affected module-mock suites retain only Node's expected experimental-module
  warning. The recon note is
  `docs/recon/NODE_MOCK_MODULE_OPTIONS_MIGRATION.md`.
- Empty-pool health-pinger checkpoint
  `d844e1015e39939f2214b3eda9ec25295aa56ce6` used `[skip-bump]`;
  Auto-version run `26737565499` skipped, CI run `26737565488` passed, and
  Docker workflow run `26737565491` passed runtime smoke and registry image
  push.
- Node module-mock harness checkpoint
  `655273c1e7042f75dea7783c05e7b1adea274c18` used `[skip-bump]`;
  Auto-version run `26737753990` skipped, CI run `26737754008` passed, and
  Docker workflow run `26737754000` passed runtime smoke and registry image
  push.
- Node module-mock guard checkpoint
  `9d9afb50a9776a9f356e9b9f18ad7c4f86e313dc` used `[skip-bump]`;
  Auto-version run `26737940920` skipped, CI run `26737940926` passed, and
  Docker workflow run `26737940921` passed runtime smoke and registry image
  push.
- 2026-06-01 release-bootstrap audit contract: Auto-version run `26738144380`
  created immutable tag `v1.4.1`, but Release Desktop Apps run `26738151871`
  stopped in shared `test:ci` before packaging. `hydra audit` correctly
  reported that the new-version Intel artifact was not public yet; the CLI
  regression incorrectly required public `v1.4.1` Intel and Windows evidence
  before the release workflow could build those artifacts. The regression now
  accepts hosted package-smoke evidence during the pre-publication gate while
  preserving `mac-intel-current` as `missing` until current public release
  evidence is recorded. The recon note is
  `docs/recon/RELEASE_BOOTSTRAP_AUDIT_CONTRACT.md`.
- Release-bootstrap repair checkpoint
  `5857ff4ce330fec3016862fc1390e4ce9eabd1f1` used `[skip-bump]`;
  Auto-version run `26738319746` skipped, CI run `26738319743` passed, and
  Docker workflow run `26738319737` passed runtime smoke and registry image
  push.
- 2026-06-01 public `v1.4.2` artifact-parity closeout: release commit
  `ff63fdd6ef49509e8ed0b44c07aac0b0fc2e4b95` is tagged `v1.4.2` and Release
  Desktop Apps run `26738568988` passed shared gates, Linux x64 AppImage,
  macOS arm64 zip, macOS Intel zip, Windows x64 NSIS, the hosted unpacked and
  NSIS-installed Windows lifecycle gate, uploads, and merged macOS updater
  metadata. Live GitHub inspection found all ten expected assets. Downloaded
  `latest-mac.yml`, `latest.yml`, and `latest-linux.yml` report `1.4.2` and
  point to the correct released artifacts; the macOS manifest lists both
  architectures. The downloaded arm64 zip SHA-256
  `243ad57e19bc2b6e8d25511443f79bd71fb1e41aecbbcd64f29478deeabecfe7`
  matches GitHub, its SHA-512 matches `latest-mac.yml`, and the extracted app
  passed strict deep `codesign` plus explicit-resource package smoke. Native
  quit removed the stale local `1.4.0` app before it moved reversibly to
  `~/.Trash/hydra-local-v140-replaced-20260601T063234Z/Hydra.app`. The
  canonical `release/mac-arm64/Hydra.app` now reports `1.4.2`; LaunchServices
  relaunch settled to four Hydra-owned processes at `0.1%` aggregate CPU and
  `618.70 MB` RSS with zero Hydra Playwright profiles; Spotlight resolves only
  that canonical bundle; and `release/` again contains only
  `mac-arm64/Hydra.app`.
- 2026-06-01 exact-public `v1.4.2` idle baseline:
  `/private/tmp/hydra-v142-public-fresh-idle-20260601T.msrEg0` retained four
  Hydra-owned processes and zero Hydra Playwright profiles across 11 untouched
  samples over five minutes. CPU ranged from `0.000%` to `0.500%`, averaged
  `0.100%`, and ended at `0.000%`; RSS changed by `+2992 KiB`.
- 2026-06-01 request-log retention demand scheduler: the worker now disarms
  after its startup prune confirms that `RequestLog` is empty. Buffered
  non-stream logging and direct SSE placeholder logging rearm the existing
  15-minute retention cadence when traffic creates work. Fresh retained rows,
  stale-row deletion, overflow deletion, error retry, and shutdown clearing
  remain intact. Production inspection found `0` request-log rows. The
  deterministic lifecycle evidence under
  `/private/tmp/hydra-request-log-retention-demand-scheduler-20260601T.KJsakO/summary.json`
  records empty-table recurring wakeups per hour `4 -> 0`, empty startup
  disarming, traffic-driven rearming, and shutdown clearing. The recon note is
  `docs/recon/REQUEST_LOG_RETENTION_DEMAND_SCHEDULER.md`. Focused retention
  tests passed `8/8`, buffer tests passed `5/5`, background contracts passed
  `32/32`, and full `npm run test:ci`, lint, build, gate (`12/12`), OpenAPI
  generation (`83 operations`), audit, and diff check passed.
- 2026-06-01 request-log retention demand-scheduler current-source package
  proof: native quit removed all four prior exact-public package processes
  with evidence under
  `/private/tmp/hydra-v142-retention-demand-rebuild-shutdown-20260601T.1DlSuZ`.
  The prior exact-public bundle moved reversibly to
  `~/.Trash/hydra-public-v142-before-retention-demand-20260601T064759Z`.
  ARM rebuild, package smoke, strict deep `codesign`, bundle version (`1.4.2`),
  embedded notifier inspection, packaged renderer presence, and retained
  `HYDRA_SPLASH_TARGET=72` passed. The current-source local ARM zip SHA-256 was
  `80dbd0ddbf08a32d39926b7fa3190d114e20de09af41f0142d0bc7438c248329`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-retention-demand-package-20260601T064937Z`; `release/` again
  contains only `mac-arm64/Hydra.app`, Spotlight resolves exactly one Hydra
  bundle, and Docker Desktop remains stopped.
- 2026-06-01 request-log retention demand-scheduler LaunchServices and
  post-rebuild profile: LaunchServices evidence under
  `/private/tmp/hydra-v142-retention-demand-current-source-launch-20260601T.VRmXux`
  records four settled processes at `0.000%` CPU and zero stale profiles by
  35 seconds. Splash teardown remained finite with `72/72` shuffled words,
  zero duplicate skips, collision-free lifted portal entry, timers `0`, RAF
  inactive, and Matter cleared. The untouched five-minute profile under
  `/private/tmp/hydra-v142-retention-demand-post-rebuild-idle-20260601T.ijYy3n`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across 11 samples. CPU peaked at `4.600%` in sample `00`, stayed at
  `0.000%` for all ten subsequent samples including the startup-prune window,
  and ended at `0.000%`; RSS changed by `+4912 KiB`.
- 2026-06-01 request-log retention scheduler checkpoint:
  `c0a8c27f5ac5f754d695d04fb8f90c7f5d849d8b` used `[skip-bump]`;
  Auto-version run `26740075092` skipped, CI run `26740075081` passed, and
  Docker workflow run `26740075047` passed runtime smoke plus registry image
  push.
- 2026-06-01 request-log retention audit-contract hardening: `hydra audit`
  now requires the empty-table disarm path, traffic-driven notifier export,
  buffered-log notifier call, direct-SSE notifier call, retained-row cadence,
  error retry, and shutdown clear. `npm run test:cli` passed `46/46`.
- 2026-06-01 audit-contract current-source ARM package proof: native quit
  evidence under
  `/private/tmp/hydra-v142-audit-retention-contract-rebuild-shutdown-20260601T.swVAL6`
  records all four prior package processes exiting. ARM rebuild, package
  smoke, strict deep `codesign`, bundle version (`1.4.2`), and embedded
  production notifier inspection passed. The local zip SHA-256 was
  `33db71e47bf19cd92f04a2140f6d695e68930b3d8fc9b020721ebcdb28d9b769`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-audit-retention-contract-package-20260601T070443Z`.
- 2026-06-01 audit-contract LaunchServices proof:
  `/private/tmp/hydra-v142-audit-retention-contract-launch-20260601T.Qkdbo7`
  records one canonical Spotlight bundle, four settled Hydra-owned processes
  at `0.000%` CPU and `593.34 MB` RSS, and zero Hydra Playwright profiles.
  Splash teardown again reports `72/72` shuffled words, zero duplicate skips,
  collision-free lifted portal entry, timers `0`, inactive RAF, and cleared
  Matter state. The immediately preceding untouched five-minute runtime
  profile remains the relevant idle evidence because this second rebuild only
  tightens the shipped repository audit contract.
- 2026-06-01 session-refresh dead-cookie pruning: the six-hour auto-refresher
  now persists an empty Clerk device-cookie stack after proving all stored
  identities dead, preserving the stored session token while intentionally
  leaving `sessionRefreshedAt` unchanged. Forced live probes and automation
  refreshes use the same identity-aware pruning helper after an older stacked
  identity succeeds. Deterministic `npm run test:session-refresher-pruning`
  evidence records future retries `25 -> 0`; session contracts passed `12/12`,
  background contracts passed `32/32`, cancellation contracts passed `5/5`,
  chain completeness passed `2/2`, CLI passed `46/46`, lint passed, audit
  remained `31 ok / 5 deferred / 0 missing / 0 blockers`, and diff hygiene
  passed. The recon note is
  `docs/recon/SESSION_REFRESH_DEAD_COOKIE_PRUNING.md`.
- 2026-06-01 session-pruning current-source ARM package proof: native quit
  evidence under
  `/private/tmp/hydra-v142-session-pruning-rebuild-shutdown-20260601T.ZrqqTS`
  records all four prior package processes exiting. ARM rebuild, package
  smoke, strict deep `codesign`, bundle version (`1.4.2`), and embedded
  production source inspection passed. The local zip SHA-256 was
  `08ac0a0d8e5ed2cde472e409062a40d9d02cd2fa9e2d164be681e3c1369a08a3`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-session-pruning-package-20260601T071712Z`.
- 2026-06-01 session-pruning LaunchServices and soak proof:
  `/private/tmp/hydra-v142-session-pruning-current-source-launch-20260601T.ykgIT2`
  records one canonical Spotlight bundle, four settled Hydra-owned processes
  at `0.000%` CPU and `587.33 MB` RSS, zero Hydra Playwright profiles, and
  finite splash teardown with `72/72` shuffled words, zero duplicate skips,
  lifted collision-free portal entry, timers `0`, inactive RAF, and cleared
  Matter state. The untouched rebuilt-package profile under
  `/private/tmp/hydra-v142-session-pruning-post-rebuild-idle-20260601T.2OCWjF`
  retained four processes and zero profiles across 11 samples. CPU ranged
  `0.000-0.400%`, averaged `0.055%`, and ended at `0.000%`; RSS changed by
  `+5144576` bytes.
- 2026-06-01 Touch ID unlock-token order refinement for `v1.4.3`: the native
  auth-token IPC now validates that `renderer-auth-token.json` exists, contains
  a non-empty token, and is inside its 24-hour expiry before prompting Touch
  ID. This preserves the expected per-relaunch Touch ID gate while a saved
  token is valid, but avoids a pointless prompt followed by password when the
  token is missing or expired. Source contracts passed:
  `npm run test:electron-ipc-contract` (`5/5`),
  `npm run test:electron-main-process` (`29/29`),
  `npm run test:ui-static` (`42/42`), and `npm run test:cli` (`46/46`).
  The recon note is `docs/recon/TOUCH_ID_UNLOCK_TOKEN_ORDER.md`.
- 2026-06-01 packaged lifecycle hardening for `v1.4.3`: LaunchServices dogfood
  found a zero-code voluntary app exit without a crash report. `main.log` also
  hid shutdown breadcrumbs because the file tee closed on `before-quit` before
  later lifecycle handlers could write. The log stream now closes on
  `will-quit`, Electron logs app/window/IPC/process lifecycle sources, and the
  lock-holder process keeps one ref'd one-minute lifecycle timer so the
  packaged app cannot fall out of the Node event loop after idle timers are
  intentionally unref'd. Focused contracts passed
  `npm run test:electron-main-process` (`29/29`) and
  `npm run test:ui-static` (`42/42`). The recon note is
  `docs/recon/ELECTRON_LIFECYCLE_KEEPALIVE_AND_QUIT_TRACING.md`.
- 2026-06-01 close-to-background hardening for `v1.4.3`: the controlled
  background soak under
  `/private/tmp/hydra-v143-final-controlled-background-soak-20260601T.9yB5Ve`
  proved the remaining `4 -> 0` process drop came from the main-window close
  modal selecting `Quit Hydra` (`close-dialog-response` `1`), not from a crash
  or event-loop fallthrough. The normal close handler is now background-only:
  it prevents default close, logs `close-kept-running-in-background`, hides the
  macOS Dock icon, destroys the renderer, and keeps the embedded proxy alive.
  Full shutdown still requires explicit tray/menu/sidebar Quit actions. Focused
  `npm run test:electron-main-process` passed `30/30` with a regression that
  forbids the close modal from reappearing.
- 2026-06-01 final `v1.4.3` source, package, and LaunchServices proof:
  full `npm run test:ci` passed all scripts, including session-refresh,
  session-pruning, CLI (`46/46`), UI static (`42/42`), Docker workflow
  contracts, dogfood evidence, workflow contracts, gzip, error-boundary,
  backward-compat, and Electron contracts. `npm run lint`, `npm run build`,
  `npm run gate` (`12/12` after the intentionally sequential rerun), OpenAPI
  generation (`83 operations`), `npm run test:dogfood-evidence`, `npm run
  test:workflow-contract`, and `git diff --check` passed on the final source.
  The rebuilt ARM package passed `HYDRA_BUILD_TARGET=darwin-arm64 npm run
  electron:smoke`, strict deep `codesign`, bundle version `1.4.3`, and embedded
  production-source inspection for the Touch ID token-order gate, explicit
  reauth cookie-stack reset, `markSessionRefreshed: false` metadata writes,
  lifecycle keepalive, and `close-kept-running-in-background`. The local ARM
  zip SHA-256 before byproduct cleanup was
  `e6411adac7db1586ff49548bd45e6c2e694eb5797e195e616ac93da259ea1b7a`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-v143-final-package-byproducts-20260601T090057Z`, leaving
  `release/` with only the canonical unpacked app. LaunchServices soak evidence
  under `/private/tmp/hydra-v143-final-close-background-launch-20260601T.Mb2rht`
  kept exactly four Hydra-owned processes and zero Hydra Playwright profiles for
  all 11 samples over the five-minute idle window; CPU ranged `0.0-6.8%`,
  averaged `0.8%`, and ended at `0.0%`; RSS changed by `-183943168` bytes.
  Splash teardown remained finite with 72 queued/shattered words, zero duplicate
  shatter skips, timers `0`, inactive RAF, lifted collision-free portal entry,
  and cleared Matter state.
- 2026-06-01 public `v1.4.3` release closeout: GitHub release v1.4.3 is public
  at `https://github.com/zaydiscold/hydra/releases/tag/v1.4.3`, published
  `2026-06-01T09:12:34Z` from commit
  `201c35b3080890a18068f614a34aa869f1cea2fa`. Auto-version run
  `26745750077`, CI run `26745750087`, Docker workflow run `26745750037`, and
  Release Desktop Apps run `26745761313` all completed successfully. The public
  asset list contains macOS arm64 zip/blockmap, macOS Intel zip/blockmap,
  Windows NSIS/blockmap, Linux x64 AppImage, merged `latest-mac.yml`, Windows
  `latest.yml`, and Linux `latest-linux.yml`:
  `Hydra-1.4.3-mac-arm64.zip`,
  `Hydra-1.4.3-mac-arm64.zip.blockmap`,
  `Hydra-1.4.3-mac-x64.zip`, `Hydra-1.4.3-mac-x64.zip.blockmap`,
  `Hydra-1.4.3-win-x64.exe`, `Hydra-1.4.3-win-x64.exe.blockmap`,
  `Hydra-1.4.3-linux-x86_64.AppImage`, `latest-mac.yml`, `latest.yml`, and
  `latest-linux.yml`. The release workflow passed shared `lint`, `test:ci`,
  and `gate`, Linux AppImage build/smoke/upload, macOS arm64 build/smoke/upload,
  macOS Intel build/smoke/upload, Windows NSIS build/smoke plus hosted unpacked
  and NSIS-installed executable lifecycle check, and final macOS updater
  metadata merge.
- 2026-06-01 post-release `v1.4.3` docs closeout and fresh read-only profile:
  commit `92b159adc233ee3a7fe8231f40129d77f627a45f` recorded the public release
  closeout with `[skip-bump]`; Auto-version run `26746458475` skipped as
  intended, CI run `26746458503` passed, and Docker workflow run `26746458547`
  passed both runtime smoke and registry image push (`Build & Push`). A fresh
  five-minute sampler of the already-running packaged app wrote raw evidence to
  `/private/tmp/hydra-v143-post-release-readonly-profile-20260601T092809Z`.
  All 11 samples retained four Hydra-owned processes and zero stale Hydra
  Playwright profiles. CPU ranged `0.0-0.2%`, averaged `0.036%`, and ended at
  `0.0%`; RSS moved from `482131968` to `485949440` bytes (`+3817472`). Strict
  deep codesign still passed for `release/mac-arm64/Hydra.app`, and the bundle
  reports version `1.4.3`. This refresh does not close the remaining manual
  packaged GUI, live-flow, screenshot, Touch ID hardware, or real Windows UX
  dogfood items.
- 2026-06-01 `v1.4.4` Bulk Auth import repair: the user-visible failure was
  traced to two real wiring defects. First, Bulk Email Link created local OTP
  stubs and then fired one high-cost Clerk email-link send per row, which let a
  normal 13-row paste self-trigger Hydra's `12/min` high-cost limiter and then
  upstream Clerk rate limits. Second, the email-link `redirect_url` used the
  local Hydra host, but OpenRouter's Clerk instance rejects localhost callback
  URLs for OpenRouter-origin `email_link` requests. The repair adds
  `GET /api/accounts/magic-link/capability`, preflights Email Link before any
  row is created or replaced, requires `HYDRA_MAGIC_LINK_CALLBACK_ORIGIN` to be
  public HTTPS before contacting Clerk, sends Email Link rows one at a time
  with a `6500ms` spacing, removes the high-cost limiter from the local
  `/api/accounts/bulk-otp-stubs` vault-write route, preserves repeated pasted
  emails in the text box, and adds a shared Force Replace toggle that converts
  an existing account back to a pending OTP stub while preserving management-key
  records and invalidating stale session-status cache. The direct OTP tab
  remains the pure HTTPS import path.
- 2026-06-01 `v1.4.4` Bulk Auth verification: focused contracts passed
  `npm run test:background-failure-visibility` (`33/33`),
  `npm run test:ui-static` (`44/44`), `npm run test:api-integration` (`9/9`),
  `npm run test:session-refresh-contract` (`14/14`), `npm run test:auth-status`
  plus `npm run test:auth-cookie` (`1/1` + `9/9`), and `npm run test:cli`
  (`46/46`). The full `npm test` chain passed after the new OpenAPI route was
  added to `scripts/generate-hydra-openapi.mjs`; `npm run lint`, `npm run
  build`, `npm run gate` (`12/12`), `npm run openapi:hydra` (`84 operations`),
  `git diff --check`, and `HYDRA_DOCKER_BUILD_TIMEOUT_MS=3600000 npm run
  docker:smoke` also passed. Local packaging rebuilt `release/mac-arm64/Hydra.app`
  as version `1.4.4`; `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`,
  strict deep `codesign --verify --deep --strict`, embedded server/renderer
  source inspection for the capability endpoint and UI copy, and LaunchServices
  relaunch all passed. After splash settled, the local four-process app tree
  sampled at approximately `0.0-0.6%` per owned process, with no extra browser
  process opened. The local ARM zip SHA-256 before cleanup was
  `eaca25ec73182672456b0fe09c1031e0a4f5b8200efad648b7e9fa7014a6310f`.
- 2026-06-01 public `v1.4.4` release closeout: GitHub release v1.4.4 is public
  at `https://github.com/zaydiscold/hydra/releases/tag/v1.4.4`, published
  `2026-06-01T17:06:22Z` from commit
  `bb0dda874853502732769982f83fc941c3fd0168`. Auto-version run
  `26769595632`, CI run `26769595644`, Docker workflow run `26769595972`, and
  Release Desktop Apps run `26769608095` all completed successfully. Docker
  workflow run `26769595972` passed both runtime smoke and registry image push.
  The public asset list contains macOS arm64 zip/blockmap, macOS Intel
  zip/blockmap, Windows NSIS/blockmap, Linux x64 AppImage, merged
  `latest-mac.yml`, Windows `latest.yml`, and Linux `latest-linux.yml`:
  `Hydra-1.4.4-mac-arm64.zip`,
  `Hydra-1.4.4-mac-arm64.zip.blockmap`,
  `Hydra-1.4.4-mac-x64.zip`, `Hydra-1.4.4-mac-x64.zip.blockmap`,
  `Hydra-1.4.4-win-x64.exe`, `Hydra-1.4.4-win-x64.exe.blockmap`,
  `Hydra-1.4.4-linux-x86_64.AppImage`, `latest-mac.yml`, `latest.yml`, and
  `latest-linux.yml`. The release workflow passed shared `lint`, `test:ci`,
  and `gate`, Linux AppImage build/smoke/upload, macOS arm64 build/smoke/upload,
  macOS Intel build/smoke/upload, Windows NSIS build/smoke plus hosted unpacked
  and NSIS-installed executable lifecycle check, and final macOS updater
  metadata merge.
- 2026-06-01 `v1.4.5` Bulk Auth Email Link ergonomics: the server-side
  `v1.4.4` protection already stopped Clerk calls when
  `HYDRA_MAGIC_LINK_CALLBACK_ORIGIN` was missing or local-only. The follow-up
  UI now makes that state visible before the operator can start a batch:
  `src/hooks/useBulkAuth.js` tracks `magicLinkCapability`, refreshes it on Bulk
  Auth mount and before send/resend, and `src/components/EmailLinkTab.jsx`
  renders a callback-status banner with a `Recheck` action. When capability is
  explicitly unavailable, the `Send Magic Links` button is disabled and the
  button copy points to OTP or callback configuration. This keeps the direct
  OTP import path active while preventing a repeat of the row-by-row
  redirect/rate-limit failure loop.
- 2026-06-01 `v1.4.5` local verification: package metadata was bumped to
  `1.4.5`; focused checks passed `npm run test:ui-static -- --test-name-pattern='bulk|Magic Link|force|email'`
  (`44/44`), `npm run test:background-failure-visibility -- --test-name-pattern='bulk import|magic-link capability'`
  (`33/33`), `npm run test:api-integration -- --test-name-pattern='magic-link capability|bulk OTP'`
  (`9/9`), `npm run lint`, `npm run gate` (`12/12`), `npm run test:cli`
  (`46/46`), full `npm run test:ci`, `git diff --check`, and
  `npm run test:dogfood-evidence` (`1/1`). The canonical local macOS ARM
  package rebuilt as bundle version `1.4.5`;
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, strict deep
  `codesign --verify --deep --strict`, embedded renderer inspection for
  `bulk-auth-email-link-capability` and `Use OTP or configure callback`, and
  LaunchServices relaunch all passed. The local ARM zip SHA-256 is
  `fe64d4266122e486347cf3c3c6850097a3a6dd144946477b70c5f4240ca118a2`.
  A five-minute idle sample at
  `/private/tmp/hydra-1.4.5-bulk-auth-idle-20260601T172922Z` recorded 11
  samples from `2026-06-01T17:29:22.767Z` through
  `2026-06-01T17:34:23.644Z`, one stable four-process Hydra tree, `0.0%`
  aggregate Hydra CPU at every sample, RSS moving from `519.64 MB` to
  `520.83 MB` (`+1.19 MB`), and zero stale Hydra Playwright profiles in the
  settled post-launch doctor snapshot. The stale local `1.4.4` macOS archive
  and blockmap were moved reversibly to
  `~/.Trash/hydra-old-release-artifacts-20260601T173035Z`.
- 2026-06-01 public `v1.4.5` release closeout: GitHub release v1.4.5 is public
  at `https://github.com/zaydiscold/hydra/releases/tag/v1.4.5`, published
  `2026-06-01T17:40:39Z` from commit
  `fdb725cf1c421f787a0aba1b0ba78090d8b79316`. Auto-version run
  `26771322922`, CI run `26771322926`, Docker workflow run `26771322892`, and
  Release Desktop Apps run `26771336388` all completed successfully. Docker
  workflow run `26771322892` passed both runtime smoke and registry image push.
  The public asset list contains macOS arm64 zip/blockmap, macOS Intel
  zip/blockmap, Windows NSIS/blockmap, Linux x64 AppImage, merged
  `latest-mac.yml`, Windows `latest.yml`, and Linux `latest-linux.yml`:
  `Hydra-1.4.5-mac-arm64.zip`
  (`sha256:d72d67d41a53524feef4ed512113bd5984c269eced6f1a49d8e4a2a7b65e2411`),
  `Hydra-1.4.5-mac-arm64.zip.blockmap`,
  `Hydra-1.4.5-mac-x64.zip`
  (`sha256:154e9303c32fb8f568c78431dfb06675c387fbcf6ba926a2f4f5caa04005cfd7`),
  `Hydra-1.4.5-mac-x64.zip.blockmap`, `Hydra-1.4.5-win-x64.exe`
  (`sha256:3f2d05ef1430a01ed17386a07efa78df193d3fd564ef0126e8ec09957632e945`),
  `Hydra-1.4.5-win-x64.exe.blockmap`,
  `Hydra-1.4.5-linux-x86_64.AppImage`
  (`sha256:ed79d0d04a6c22488baeacd6d3ff255caa4991f8f41235981f86b3ee085ab248`),
  `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`. The release workflow
  passed shared `lint`, `test:ci`, and `gate`, Linux AppImage build/smoke/upload,
  macOS arm64 build/smoke/upload, macOS Intel build/smoke/upload, Windows NSIS
  build/smoke plus hosted unpacked and NSIS-installed executable lifecycle
  check, and final macOS updater metadata merge.
- 2026-06-01 `v1.4.6` Email Link truthfulness and callback hardening: the final
  source review found that the dormant Email Link sender still passed Clerk a
  callback containing `signInId=pending`, then constructed the real callback
  only after Clerk had already sent the email. The repair generates a random
  24-byte base64url `linkId` before sending, keeps account and Clerk attempt
  identifiers server-side, indexes pending work by both renderer-poll
  `signInId` and callback `linkId`, atomically claims the public callback, and
  clears both indexes together after completion, failure, or expiry. Capability preflight now also requires
  `HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED=1`; a syntactically valid
  public tunnel is no longer presented as sufficient. This matches Clerk's
  tenant-owner redirect allowlist and same-device/browser security model.
  OpenRouter users are directed to Bulk OTP, which remains the supported direct
  HTTPS import lane. Focused source verification passed syntax checks,
  `npm run test:background-failure-visibility` (`33/33`), `npm run
  test:ui-static` (`45/45`), `npm run test:api-integration --
  --test-name-pattern='magic-link capability|magic-link callback indexes|bulk
  OTP'` (`10/10`), `npm run openapi:hydra` (`84 operations`), and `git diff
  --check`. Packaged runtime proof is recorded below.
- 2026-06-01 `v1.4.6` canonical ARM package proof: full `npm run test:ci`,
  `npm run lint`, `npm run gate` (`12/12`), `npm run test:cli` (`46/46`),
  `npm run test:dogfood-evidence` (`1/1`), and
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed. The rebuilt
  local app reports bundle version `1.4.6`; strict deep
  `codesign --verify --deep --strict` passed, and embedded-source inspection
  confirmed the allowlist-confirmation gate, opaque callback `linkId`, and
  atomic one-time callback claim shipped inside the bundle. The local ARM zip
  SHA-256 before reversible byproduct cleanup was
  `6947a5134ef02a508c84195580a94ec5377e42dfbb480f62dc7193aec16f0482`.
  LaunchServices opened the canonical app without a browser. CoreGraphics saw
  one `Hydra — Dashboard` window at `1440x900`; after the expected startup
  compositor tail settled, `hydra doctor` reported exactly four Hydra-owned
  processes, `0.4%` aggregate CPU, `600.50 MB` RSS, and zero stale Hydra
  Playwright profiles.
- 2026-06-01 public `v1.4.6` release closeout: GitHub release v1.4.6 is public
  at `https://github.com/zaydiscold/hydra/releases/tag/v1.4.6`, published
  `2026-06-01T20:07:19Z` from commit
  `3bffb18239e666c486574928fd240ab496f53870`. Auto-version run
  `26778835765`, CI run `26778835658`, Docker workflow run `26778835668`, and
  Release Desktop Apps run `26778847890` all completed successfully. Docker
  workflow run `26778835668` passed both runtime smoke and registry image push.
  The public asset list contains macOS arm64 zip/blockmap, macOS Intel
  zip/blockmap, Windows NSIS/blockmap, Linux x64 AppImage, merged
  `latest-mac.yml`, Windows `latest.yml`, and Linux `latest-linux.yml`:
  `Hydra-1.4.6-mac-arm64.zip`
  (`sha256:17b7f7ab3fdbfd3834b7ea36cd07258a1eecc1d8ca7c61c720f1b9f2b0f4d344`),
  `Hydra-1.4.6-mac-arm64.zip.blockmap`,
  `Hydra-1.4.6-mac-x64.zip`
  (`sha256:79c4f30c226ad51f35925ba07e282d069afa94bc12433ec2f90611e09aba8d4b`),
  `Hydra-1.4.6-mac-x64.zip.blockmap`, `Hydra-1.4.6-win-x64.exe`
  (`sha256:e6fde27826755a2c33d5116ff93d4e8614087a75bbefebe4bc841251ca147c78`),
  `Hydra-1.4.6-win-x64.exe.blockmap`,
  `Hydra-1.4.6-linux-x86_64.AppImage`
  (`sha256:1d3e20516dab9de566116bfadac7348f0eb3f7ea5021f79e4ae1fb0d3fd79af8`),
  `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`. The release workflow
  passed shared `lint`, `test:ci`, and `gate`, Linux AppImage build/smoke/upload,
  macOS arm64 build/smoke/upload, macOS Intel build/smoke/upload, Windows NSIS
  build/smoke plus hosted unpacked and NSIS-installed executable lifecycle
  check, and final macOS updater metadata merge. Downloaded `latest-mac.yml`
  lists both macOS architectures.
- 2026-06-01 post-release branch-cleanup repair: scheduled stale-branch-cleanup
  run `26776565868` failed when the repository correctly contained only
  protected `master`; `grep -Ev` returned its normal no-match status under
  `set -o pipefail`. Commit `7257498` makes the empty sweep an explicit success.
  Manual workflow dispatch `26778878591`, closeout CI run `26778879503`, and
  closeout Docker run `26778879520` all passed.
- 2026-06-01 post-release `v1.4.6` read-only idle profile:
  `/private/tmp/hydra-v146-post-release-readonly-idle-lwlq2dbC` sampled the
  already-running canonical package 11 times across `394` seconds with a
  minimum `30`-second pause between snapshots plus native `top` collection.
  The same four Hydra-owned processes and zero Hydra Playwright profiles
  remained present throughout. Aggregate Hydra CPU stayed between `0.0%` and
  `0.1%`, averaged `0.009%`, and ended at `0.0%`; RSS moved from `474.31 MB`
  to `487.17 MB` (`+13484032` bytes). The directory preserves broad
  `ps -ax -o pid,ppid,stat,%cpu,%mem,rss,etime,command | grep -iE
  'chrome|chromium|playwright|electron|hydra'` before/after inventories,
  per-sample doctor JSON, full process snapshots, native `top` samples, and
  `summary.json`. Unrelated Chrome load remained separate from Hydra-owned
  rows.
- 2026-06-01 post-release local Search cleanup: targeted filesystem and
  Spotlight scans already resolved only
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`, but LaunchServices
  still remembered eight historical Hydra bundles under `~/.Trash`. Each stale
  Trash registration was unregistered with `lsregister -u`, the canonical
  `1.4.6` app was force-registered with `lsregister -f`, and the follow-up
  LaunchServices plus Spotlight inventories each report only the canonical
  bundle. No app bundle or Trash backup was deleted.
- 2026-06-01 post-release timer-ownership sweep: `rg` across production
  Electron, server, renderer, CLI, and script sources found one unconditional
  packaged-idle timer that remained armed: `electron/main.js` started one
  ref'd `60_000ms` lifecycle interval in the single-instance lock holder and
  cleared it during shutdown. Earlier LaunchServices dogfood reproduced a
  voluntary zero-code package exit after the other Node-side idle timers were
  deliberately unref'd, so removing the lifecycle hold would be unsafe.
  The narrower fix preserves one ref'd hold but replaces the recurring minute
  interval with a renewed `24 * 60 * 60 * 1000ms` timeout. A deterministic
  one-day scheduler comparison reports `1440 -> 1` keepalive wakeups
  (`-1439`, `99.931%` reduction). `npm run test:electron-main-process`
  passed `31/31`, including a regression contract that rejects a return to
  `lifecycleKeepAliveTimer = setInterval`; `hydra audit --json` remains
  `31 ok / 5 deferred / 0 missing / 0 blockers`. The root-cause evidence and
  shutdown contract remain documented in
  `docs/recon/ELECTRON_LIFECYCLE_KEEPALIVE_AND_QUIT_TRACING.md`.
- 2026-06-01 lifecycle-timeout rebuilt-package proof: native quit moved the
  previous exact-public `v1.4.7` package `4 -> 0` in one second with zero stale
  profiles before preserving it reversibly under
  `~/.Trash/hydra-v147-public-before-keepalive-timeout-20260601T233950Z`.
  The current-source ARM rebuild passed package smoke, strict deep codesign,
  and embedded-source inspection: packaged `electron/main.js` hashes exactly
  with source and contains `LIFECYCLE_KEEPALIVE_RENEW_MS = 24 * 60 * 60 *
  1000`, the timeout arm, and no recurring keepalive interval. The local ARM
  zip SHA-256 before reversible metadata cleanup was
  `e1a72cf3cf5dfe99c6a141a82e3756041e3284f3de4543a37fac0ebebdacb8b3`.
  Native LaunchServices evidence under
  `/private/tmp/hydra-v147-keepalive-timeout-launch-20260601T234132Z`
  records one `keepalive-started` line with `renewMs=86400000`, splash CPU
  decay `226.9% -> 1.5% -> 0.0%`, bounded `72/72` shatter completion, timers
  `0`, inactive RAF, disabled portal collisions, lifted portal entry, and
  cleared Matter state. Broad before/after process inventories are preserved
  there. The untouched rebuilt-package profile under
  `/private/tmp/hydra-v147-keepalive-timeout-idle-profile-20260601T234217Z`
  retained exactly four Hydra-owned processes and zero stale profiles across
  all 11 30-second samples: CPU stayed `0.0-0.1%`, averaged `0.036%`, and
  ended at `0.0%`; RSS moved `617644032 -> 607289344` bytes (`-10354688`).
- 2026-06-01 lifecycle-timeout literal-chain closeout: final source checkpoint
  `893978a` passed `npm run lint`, full `npm test`, `npm run gate` (`12/12`),
  rebuilt ARM `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`,
  strict deep codesign, and `npm run openapi:hydra` (`84` operations, no
  tracked drift). Docker Desktop was started temporarily and became ready in
  two seconds; `npm run docker:smoke` passed compose validation, production
  image build, and a real containerized Playwright Chromium launch. Bounded
  teardown left no `hydra_default` network, `docker desktop stop` removed the
  Desktop runtime helpers in one second, and Hydra returned to four owned
  processes at `0.0%` CPU with zero stale profiles.
- 2026-06-01 magic-link cleanup early-disarm follow-up: source tracing found
  that callback completion removed both pending-link indexes through
  `forgetPendingMagicLink()` but left the previously armed 15-minute expiry
  timeout in place. The manager now recalculates cleanup after external
  removals; batch expiry sweeps suppress per-row reschedules and perform one
  final reschedule after the sweep. A read-only
  `getMagicLinkCleanupSnapshot()` surface and the deterministic benchmark under
  `/private/tmp/hydra-magic-link-cleanup-early-disarm-20260601T235215Z`
  prove `scheduled=false -> true -> false` across idle, tracked-link, and
  early-completion states, avoiding one residual wakeup after the last link
  completes. Real Express API integration passed `11/11`, background
  ownership contracts passed `33/33`, lint passed, and `hydra audit --json`
  remains `31 ok / 5 deferred / 0 missing / 0 blockers`. The durable note is
  `docs/recon/MAGIC_LINK_CLEANUP_TIMER_OWNERSHIP.md`. The rebuilt ARM package
  passed smoke, strict deep codesign, and embedded-source hash equality; the
  generated zip SHA-256 before reversible metadata cleanup was
  `5b68bab15511dedbf81ef016c766907144bc17b924d21b32299ca8535b969875`.
  LaunchServices evidence under
  `/private/tmp/hydra-v147-magic-link-early-disarm-launch-20260601T235711Z`
  records one canonical Spotlight app, four owned processes, zero stale
  profiles, finite splash teardown, and CPU decay
  `97.9% -> 173.8% -> 4.1%` across launch, `+15s`, and `+30s`. The untouched
  rebuilt-package profile under
  `/private/tmp/hydra-v147-magic-link-early-disarm-idle-profile-20260601T235802Z`
  retained four processes and zero stale profiles across 11 samples:
  CPU stayed `0.0-0.2%`, averaged `0.027%`, and ended at `0.0%`; RSS moved
  `648937472 -> 533970944` bytes (`-114966528`). The final literal chain
  passed lint, full `npm test`, gate (`12/12`), OpenAPI regeneration (`84`
  operations, no tracked drift), diff hygiene, audit, and local Docker smoke
  with a real containerized Playwright Chromium launch. Teardown left no
  `hydra_default` network and `docker desktop stop` removed the Desktop
  runtime in one second.
- 2026-06-02 proximity-field geometry-cache follow-up: source tracing found
  that `useProximityField()` already throttled pointer floods behind one
  tracked RAF, but each painted frame still re-queried all targets and called
  `getBoundingClientRect()` after compositor transforms had changed. The
  shared hook now snapshots target geometry once per pointer pass and
  invalidates it for viewport resize, field resize, child-list changes, leave,
  and unmount. Lazy observer attachment preserves correctness for
  conditionally mounted account grids, and cleanup disconnects both observers.
  The deterministic nine-card grid benchmark under
  `/private/tmp/hydra-proximity-geometry-cache-20260602T001207Z` reduces
  geometry reads from `1080 -> 9` across 120 pointer frames (`-1071`,
  `99.167%`). UI static contracts passed `46/46`, lint passed, build passed,
  diff hygiene passed, and `hydra audit --json` remains
  `31 ok / 5 deferred / 0 missing / 0 blockers`. The rebuilt ARM package
  passed smoke, strict deep codesign, and compiled-renderer hash equality;
  its local archive SHA-256 before reversible metadata cleanup was
  `3e1022b3437179e43f7d630ec502ffde3b550d474103d729ee848137fc611a8e`.
  LaunchServices evidence under
  `/private/tmp/hydra-v147-proximity-geometry-cache-launch-20260602T001517Z`
  records one canonical Spotlight bundle, four owned processes, zero stale
  profiles, finite splash teardown, and launch CPU decay from `97.8%` to
  `186.1%` to `4.2%` at near-launch, `+15s`, and `+30s`. The untouched
  five-minute idle profile under
  `/private/tmp/hydra-v147-proximity-geometry-cache-idle-profile-20260602T001609Z`
  retained four owned processes and zero profiles across all `11` samples;
  CPU ranged `0.0-0.3%` (`0.045%` average, ending `0.0%`) while RSS fell
  `30,294,016` bytes. A final literal recheck passed lint, full `npm test`,
  gate `12/12`, OpenAPI generation (`84 operations`, no tracked drift), diff
  hygiene, audit, and local Docker smoke with a rebuilt image and real
  containerized Playwright Chromium launch. Teardown left no `hydra_default`
  network and `docker desktop stop` removed the Desktop runtime in one
  bounded stop. The durable note is
  `docs/recon/PROXIMITY_FIELD_GEOMETRY_CACHE.md`.
- 2026-06-02 OpenRouter Email Link owner-boundary follow-up: current Clerk
  documentation, live machine state, and Hydra's callback contract were
  rechecked before attempting any relay setup. OpenRouter owns the Clerk
  tenant, so Hydra users cannot add a callback allowlist entry; a generic
  Cloudflare or Tailscale tunnel would still be rejected and would expose
  unnecessary ingress. No tunnel was started and no `.env` opt-in was forged.
  The Bulk Import tab now says `Owner-only; use OTP`, the backend error says
  Email Link cannot be self-enabled for OpenRouter accounts, and `.env.example`
  reserves the relay variables for a genuinely owner-controlled Clerk tenant.
  The broad `.env.*` ignore rule now explicitly unignores that placeholder-only
  template so the operator guidance ships with the repo.
  Focused UI contracts passed `46/46`, API integration passed `11/11`,
  background contracts passed `33/33`, lint passed, build passed, and diff
  hygiene passed. The rebuilt ARM package passed smoke, strict deep codesign,
  and embedded Bulk Import renderer hash equality. Its local archive SHA-256
  before reversible cleanup was
  `461bf8e32d93582544eb87042ed4a62deb418ae1d2ddc1123371cf61a66f61e1`.
  LaunchServices reopened the sole Spotlight bundle; the bounded startup
  sample settled from `53.8%` CPU at `+30s` to `0.3%` at `+65s`, with four
  owned processes and zero stale profiles. A final literal recheck passed
  lint, full `npm test`, gate `12/12`, OpenAPI generation (`84 operations`,
  no tracked drift), diff hygiene, audit, and local Docker smoke with a
  rebuilt image and real containerized Playwright Chromium launch. Teardown
  left no `hydra_default` network and stopped Docker Desktop cleanly. The
  durable note is
  `docs/recon/BULK_AUTH_IMPORT_REDIRECT_AND_DEDUPE.md`.
- 2026-06-01 post-release literal-gate recheck: `npm run lint`, full
  `npm test`, and `npm run gate` (`12/12`) passed against the docs-reconciled
  `v1.4.6` tree. Bare `HYDRA_BUILD_TARGET=darwin-arm64 npm run
  electron:smoke` first stopped honestly because reversible local cleanup had
  removed the generated ARM archive metadata while retaining only the
  canonical unpacked app. The retry downloaded the public
  `Hydra-1.4.6-mac-arm64.zip` into
  `/private/tmp/hydra-v146-public-smoke.YWFXbR`, verified SHA-256
  `17b7f7ab3fdbfd3834b7ea36cd07258a1eecc1d8ca7c61c720f1b9f2b0f4d344`,
  temporarily linked that exact archive into `release/`, passed package smoke,
  and moved the temporary workspace symlink reversibly to `~/.Trash` on shell
  exit. `release/` again contains only `mac-arm64/Hydra.app`. `npm run
  openapi:hydra` regenerated `84 operations` with no tracked diff. Local
  `npm run docker:smoke` could not complete: after Docker Desktop was started
  and passed five consecutive `docker info` probes, two bounded compose-build
  attempts both reached `npx playwright install --with-deps chromium
  --no-shell`, then Docker Desktop exited and BuildKit returned
  `Unavailable: error reading from server: EOF`. This is recorded as local
  Docker Desktop instability rather than a Hydra runtime pass. Hosted workflow
  `26780700648` remains the current final-commit Docker proof: both `Build &
  Push` and `Runtime Smoke` completed successfully.
- 2026-06-01 conservative public-`v1.4.6` dogfood manifest refresh: all six
  versioned desktop artifacts were downloaded from the public GitHub release
  into a temporary verification directory and matched GitHub SHA-256 digests.
  `npm run dogfood:final -- --write-evidence=docs/DOGFOOD_EVIDENCE.json
  --version=1.4.6 --artifact-dir=<temporary-public-release-download>
  --app=release/mac-arm64/Hydra.app --manual=packaged-gui-launch` regenerated
  the checked-in redacted manifest. Machine-specific paths were sanitized
  before check-in. LaunchServices opened the canonical app without a browser;
  CoreGraphics saw one `Hydra — Dashboard` window at `1440x900`, Spotlight
  resolved only `release/mac-arm64/Hydra.app`, strict deep codesign passed,
  and the settled doctor snapshot reported four Hydra-owned processes, zero
  stale Hydra Playwright profiles, and `0.0%` aggregate CPU. Audit remains
  intentionally honest at `31 ok / 5 deferred / 0 missing / 0 blockers`.
  Window controls, splash/unlock review, route navigation, Touch ID fingerprint
  approval, live account flows, final redacted screenshot review, and
  interactive Windows launch remain explicit manual boundaries.
- 2026-06-01 `v1.4.7` Account Detail action repair: packaged Electron dogfood
  found that the read-only live-session probe displayed a cached-session
  warning while the CLI refresh and direct embedded HTTP session-check route
  both returned a live active session. The renderer passed React click events
  into AbortSignal-aware callbacks through direct `onClick={callback}`
  bindings. `src/pages/AccountDetail.jsx` now uses explicit zero-argument
  wrappers for both session probes, both snapshot refreshes, and all six
  management-key refresh controls. `server/tests/ui-static-contract.test.mjs`
  locks the ten wrapped call sites. Focused verification passed
  `test:ui-static` (`46/46`), request cancellation (`5/5`), session refresh
  contract (`14/14`), lint, build, and diff hygiene. The redacted reproduction
  and root cause are recorded in
  `docs/recon/ACCOUNT_DETAIL_ABORT_SIGNAL_CLICK_BINDINGS.md`.
- 2026-06-01 public `v1.4.7` release closeout: GitHub release v1.4.7 is public
  at `https://github.com/zaydiscold/hydra/releases/tag/v1.4.7`, published
  `2026-06-01T21:10:05Z` from release commit
  `d7fb68fab49c075f830bc65a36f336c291aefe4d`. Auto-version run
  `26782109972`, CI run `26782110073`, Docker workflow run `26782109931`, and
  Release Desktop Apps run `26782121839` all completed successfully. The
  public asset list contains all ten expected assets. SHA-256 digests for the
  primary distributables are macOS ARM
  `0d4ea5946c547a8d9cfb0df578e41d1850fe95dbb903346f41f3de94b79989c1`,
  macOS Intel
  `3062dbe6157cd1986278b924c735a50261e1d72d4c2d0cf7a19079a14a854e4c`,
  Windows NSIS
  `06841a55e45e24947d5b4617f9bd84b22d93894013a60038115a2ea38d517697`,
  and Linux AppImage
  `2bafa168e5216902798d4df7a843d4746efa2ee383fdec6c0bc388a873a16cb0`.
  Downloaded merged `latest-mac.yml` lists both macOS architectures.
- 2026-06-01 exact-public-`v1.4.7` local package proof: the previous canonical
  bundle moved reversibly to `~/.Trash`, the public ARM zip matched its GitHub
  digest, and that extracted public bundle is now the sole local canonical
  `release/mac-arm64/Hydra.app`. It reports bundle version `1.4.7`, passes
  strict deep codesign and `HYDRA_BUILD_TARGET=darwin-arm64 npm run
  electron:smoke`, and embeds the repaired zero-argument Account Detail
  wrappers. LaunchServices opened the app without a browser. Before Computer
  Use attachment, the untouched settled doctor snapshot reported four
  Hydra-owned processes, `0.2%` aggregate CPU, `597.75 MB` RSS, and zero stale
  Hydra Playwright profiles. Computer Use then verified the exact public app
  changing the session row from cached active to `[LIVE] ACTIVE` with a
  just-now Clerk check, and both management-key reload and account snapshot/API
  key refresh completed without the prior warning. Spotlight resolves only the
  canonical app. Real Touch ID fingerprint approval, live OTP/redemption/proxy
  completion, redacted screenshot review, and interactive Windows desktop UX
  remain explicit manual boundaries.
- 2026-06-01 exact-public-`v1.4.7` untouched idle profile:
  `/private/tmp/hydra-v147-public-post-closeout-idle-profile-20260601T213205Z`
  records a native LaunchServices `4 -> 0 -> 4` lifecycle against the sole
  canonical public ARM bundle with no Computer Use attachment. Splash work
  decayed from `124.6%` aggregate Hydra CPU at `t+5s` to `57.1%` at `t+20s`
  and `0.0%` at `t+35s`. The following 11 samples at 30-second intervals
  retained the same four settled PIDs and zero stale Hydra Playwright
  profiles. Idle CPU stayed exactly `0.0%`; RSS moved from `655867904` to
  `626966528` bytes (`-28901376`). Unrelated browser-tool pressure varied
  independently and is recorded separately in the owner-aware doctor
  snapshots rather than attributed to Hydra.
- 2026-06-01 exact-public-`v1.4.7` final local item-11 chain: commit
  `0be26982601b2b533fc64badd228ced10baef0f8` passed the literal required
  sequence in order: `npm run lint && npm test && npm run gate &&
  HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke && npm run
  docker:smoke && npm run openapi:hydra`. Package smoke temporarily linked
  the downloaded public ARM archive after SHA-256
  `0d4ea5946c547a8d9cfb0df578e41d1850fe95dbb903346f41f3de94b79989c1`
  matched GitHub. Docker smoke rebuilt the production image and launched
  Hydra's isolated full-Chromium persistent context. OpenAPI retained `84
  operations`. `docker compose ps --all` returned no services, no
  `hydra_default` network remained, the temporary archive workspace and
  smoke log moved reversibly to
  `~/.Trash/hydra-v147-final-local-chain-20260601T215008Z`, and Docker
  Desktop returned to its prior stopped state. The documentation-reconciled
  successor repeated the same literal chain before push.
- 2026-06-01 exact-public-`v1.4.7` packaged native-accessibility retry:
  `get_app_state("com.zayd.hydra")` timed out after `120s` twice. Each failed
  attach left an external `SkyComputerUseService` helper alive and raised the
  unchanged four-process Hydra tree from idle to `68.8%` and `67.5%`
  aggregate CPU respectively. Terminating only the external helper returned
  the same four Hydra PIDs immediately to `0.0%` with zero stale profiles
  after each retry. CoreGraphics still found one packaged
  `Hydra - Dashboard` window and captured it without browser tooling. The
  private raw capture moved reversibly to
  `~/.Trash/hydra-v147-private-native-capture-20260601T220405Z`; its redacted
  structural derivative remains under
  `/private/tmp/hydra-v147-cua-timeout-recovery-20260601T220102Z`, SHA-256
  `cbd66508eb94e9a58016ebb82dace2b26c472ea695939a307508ce21de603de6`.
  The redacted image is `3016x1936`, contains `413` colors with nonzero
  variance, and returned no Vision OCR text. This is current native capture
  and environment-blocker evidence, not interactive route, screenshot-review,
  or physical Touch ID completion.
- 2026-06-01 exact-public-`v1.4.7` Bulk Email Link relay setup attempt: the
  operator asked Hydra to configure the public HTTPS callback after seeing the
  capability banner. A fresh machine-state check found `cloudflared 2026.3.0`
  installed but no `~/.cloudflared/` identity, `cloudflared tunnel list`
  blocked on the missing origin certificate, and unauthenticated Wrangler.
  More importantly, Clerk's current redirect documentation still requires a
  `redirect_url` on the instance domain, one of its subdomains, or the same
  requesting origin. Live `curl -sSIL` probes confirmed OpenRouter uses
  `https://clerk.openrouter.ai` and that OpenRouter's same-origin
  `/auth?callback_url=...` handoff exists, but OpenRouter documents that
  surface as OAuth PKCE API-key authorization. It does not return the Clerk
  `__clerk_ticket` required by Hydra's `/api/auth/magic-callback` session
  completion route. The local Printing Press OpenRouter map likewise exposes
  `/auth/keys/code` and `/auth/keys` for PKCE API keys, not a supported Clerk
  login-session import endpoint. No tunnel was started and no `.env` value was
  changed: writing `HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED=1` without a
  tenant-owner allowlist entry would be false and would re-enable rejected
  Clerk requests. Bulk OTP remains the supported direct-HTTPS OpenRouter
  import path. Reproduction commands and external references are recorded in
  `docs/recon/BULK_AUTH_IMPORT_REDIRECT_AND_DEDUPE.md`.
- 2026-06-01 exact-public-`v1.4.7` post-relay-docs runtime recheck:
  `/private/tmp/hydra-v147-post-relay-docs-fresh-profile-20260601T222048Z`
  records another native LaunchServices `4 -> 0 -> 4` lifecycle against the
  sole Spotlight-resolved canonical public ARM bundle. No Computer Use or
  browser attachment touched the run. Splash work decayed from `130.9%`
  aggregate Hydra CPU at `t+5s` to `60.5%` at `t+20s` and `0.0%` at `t+35s`.
  The following 11 samples at 30-second intervals retained exactly four
  Hydra-owned processes and zero stale Hydra Playwright profiles. Idle CPU
  stayed within `0.0-0.6%`, averaged `0.109%`, and ended at `0.0%`; RSS moved
  from `658194432` to `629342208` bytes (`-28852224`). Raw owner-aware doctor
  JSON, owned-process TSVs, and broad process inventories before quit, after
  quit, after splash, and after idle remain under the profile directory.
- 2026-06-01 exact-public-`v1.4.7` native screenshot refresh:
  `/private/tmp/hydra-v147-native-screenshot-refresh-20260601T223151Z`
  records a CoreGraphics-only LaunchServices lifecycle with no browser,
  accessibility, or Computer Use attachment. The running public bundle moved
  `4 -> 0 -> 4` owned processes with zero stale Hydra Playwright profiles.
  CoreGraphics observed packaged splash window `4033` and replacement
  Dashboard window `4036`; `/usr/sbin/screencapture -x -o -l <CGWindowID>`
  captured only those Electron windows. The repository-safe splash hashes to
  `3a608664fffde2b2976be1e1aacd9ca445056997854411396472c25f13b350fd`.
  The Dashboard proof pixelates every pixel below its native titlebar before
  check-in and hashes to
  `c655726b575915159731242ebed34df96407f38b4cd6fb1a6c8e50750ed229e2`.
  Vision and Tesseract scans found zero email markers, key prefixes,
  credential assignments, endpoint strings, or long token-shaped strings in
  either safe artifact. ImageMagick reported nonblank variance for both. The
  two private raw captures moved reversibly to
  `~/.Trash/hydra-v147-private-native-screenshot-refresh-20260601T223151Z`.
  This refresh strengthens packaged screenshot provenance without claiming
  the still-manual interactive human visual review.
- 2026-06-01 exact-public-`v1.4.7` Touch ID metadata recheck: a read-only local
  pass confirmed owner-only `0600` permissions for both `preferences.json` and
  `renderer-auth-token.json`, `biometricEnabled=true`, a present non-empty
  saved token, and an unexpired `2026-06-02T08:00:41.726Z` token deadline with
  `33853` seconds remaining at observation time. Typed log aggregation found
  `40` historical biometric gate denials between
  `2026-05-31T10:23:08.963Z` and `2026-06-01T10:07:10.265Z`; every outcome was
  `BIOMETRIC_CANCELLED`. There were zero persisted-token read failures, zero
  persisted-token validation failures, and zero failed token-clear records.
  This confirms the expected fail-closed behavior: a valid saved token plus an
  enabled Touch ID preference should prompt once per relaunch, while
  cancellation intentionally leaves the password screen visible. Successful
  fingerprint approval followed by token release remains a user-run hardware
  boundary. The durable note is
  `docs/recon/TOUCH_ID_UNLOCK_TOKEN_ORDER.md`.
- 2026-06-01 Bulk OTP guidance follow-up: source review found one stale
  renderer hint in `src/utils/auth.js` that recommended Email Link generically
  when Clerk rejected `email_code` or reported an unavailable strategy. That
  contradicted Hydra's fail-closed OpenRouter callback capability check. The
  hint now tells the operator to check the account sign-in method and use Email
  Link only when its capability banner says ready. Static coverage locks both
  the new copy and removal of the stale recommendation. The same pass corrected
  the adjacent rate-limit hint grammar and locks that wording too. Focused verification
  passed real Express API integration (`10/10`), renderer/static plus
  cancellation contracts (`89/89`), lint, build, and diff hygiene. The
  read-only post-fix profile under
  `/private/tmp/hydra-v147-post-bulk-guidance-profile-20260601T224033Z`
  sampled the still-installed exact-public `v1.4.7` package 11 times at
  30-second intervals: four Hydra-owned processes and zero stale profiles
  throughout, `0.0-0.4%` CPU (`0.036%` average, `0.0%` end), and
  `621101056 -> 523845632` bytes RSS (`-97255424`). This is honest
  no-regression evidence for the running public package; the copy-only source
  patch is not claimed as released. The durable note is
  `docs/recon/BULK_AUTH_IMPORT_REDIRECT_AND_DEDUPE.md`. A second read-only
  follow-up profile after the adjacent grammar lock sampled the same installed
  package 11 times with four owned processes, zero stale profiles,
  `0.0-0.4%` CPU (`0.073%` average, `0.0%` end), and
  `509345792 -> 513179648` bytes RSS (`+3833856`).
- 2026-06-01 final evidence reconciliation: `docs/DOGFOOD_EVIDENCE.json` now
  records the already-passed local `npm run docker:smoke` lane truthfully:
  compose validation, image build, a real containerized Playwright Chromium
  launch, no remaining Hydra container or network, and a complete Docker
  Desktop helper shutdown. No manual acceptance flag was promoted. A final
  read-only exact-public `v1.4.7` profile under
  `/private/tmp/hydra-v147-post-final-docs-idle-profile-20260601T232514Z`
  retained four Hydra-owned processes and zero stale Hydra Playwright profiles
  across all 11 samples. It captured one isolated `46.2%` CPU spike before
  returning to low idle and ending at `0.0%`; RSS moved
  `465502208 -> 470351872` bytes (`+4849664`). The full sample series and
  broad process inventories remain in that profile directory.
- 2026-06-02 `v1.4.8` Bulk OTP signup-boundary candidate: Bulk OTP and the
  account-card Authenticate modal continue to share direct HTTPS
  `POST /api/accounts/:id/otp/start` and
  `POST /api/accounts/:id/otp/verify` contracts for existing OpenRouter
  accounts. Bulk OTP now stops before direct Clerk `sign_up` preparation for
  an unknown email, returns structured `SIGNUP_INTERACTIVE_REQUIRED`, and
  offers a Generator handoff for the required interactive signup boundary.
  The renderer no longer presents Email Link as an OpenRouter setup path; it
  remains an owner-only advanced relay for compatible Clerk tenants. Focused
  verification passed signup-boundary `1/1`, UI static `46/46`, background
  visibility `33/33`, API integration `11/11`, lint, full `npm test`,
  production build, and diff hygiene. The rebuilt ARM package passed smoke,
  strict deep codesign, bundle-version inspection, and embedded-source
  inspection. Its archive SHA-256 before reversible cleanup was
  `6a051e0f0f9f1f9c844c0600832e34629e9d1bd4b104259934d50b83ae577ba7`.
  LaunchServices reopened the sole Desktop-tree canonical bundle with four
  owned processes and zero stale profiles; CPU decayed from `270.2%` at
  `+5s` to `60.5%` at `+15s`, then `0.0%` at `+20s` and `+30s`. Finite splash
  teardown retained `target=72`, `duplicateShatterSkips=0`, `timers=0`,
  `rafActive=false`, `bodyCount=0`, and `matterCleared=true`. Hosted Intel,
  Windows, and Linux artifact publication remains pending until the
  `v1.4.8` GitHub release workflow completes. The durable note is
  `docs/recon/BULK_AUTH_IMPORT_REDIRECT_AND_DEDUPE.md`.
- 2026-06-02 final `v1.4.8` auth, session, and OpenRouter fallback
  reconciliation: OTP verification now returns as soon as the authenticated
  Clerk session is persisted and starts management-key provisioning as a
  supervised `otp_auto_provision` task, so sequential Bulk OTP advances
  without waiting for isolated Chromium fallback. The renderer uses quiet OTP
  APIs, reports the queued provision task immediately, polls supervised task
  state, updates its activity log, and accepts Enter-key submission. Requested
  labels such as `hydra-148` survive provisioning and encrypted persistence.
  Existing placeholder aliases matching `Hydra Account <number>` migrate
  uniqueness-safely to email-derived labels such as `zayd-zayd.world`, while
  custom aliases remain untouched. Account Detail suppresses `[UNLOCK] Re-auth`
  after a successful live Clerk probe; interactive-login age remains
  historical context rather than a claim that the current cookie is expired.
  A guarded live probe proved the old `delilah-zayd.wtf` Clerk session active
  with one normalized cookie identity and redeem-ready state. A second active
  no-key account passed dry-run provisioning, then completed one guarded
  `--yes --name hydra-148` provision through the retained isolated Playwright
  UI fallback and stored one active redacted `hydra-148` row. No credential
  material was printed. Comparing Hydra with the local Printing Press
  OpenRouter package and current OpenRouter docs corrected metadata probes to
  canonical `GET /api/v1/key` with legacy `/api/v1/auth/key` fallback only on
  canonical `404`, removed documented API-key creation route
  `POST /api/v1/keys` from session-based management-key mint probes, bounded a
  stale Server Action self-heal to one attempt, skips equivalent tRPC fan-out
  after generic HTML `404`, and learns the current `Next-Action` ID from the
  working UI fallback for later direct replay. The redacted recon note is
  `docs/recon/OPENROUTER_KEY_ENDPOINTS_AND_PROVISION_FALLBACKS.md`.
  Final-source verification passed lint, full `npm test`, production build,
  gate `12/12`, OpenAPI regeneration (`84` operations), diff hygiene, ARM
  package smoke, strict deep codesign, bundle-version inspection, and embedded
  source inspection. The superseding ARM archive SHA-256 before reversible
  cleanup was
  `294024c55ea3e84e3b4bd25fe294cb063c49f4d905a7c5ad2c269176d23679e1`.
  Archive byproducts and the prior ARM bundle moved reversibly to `~/.Trash/`;
  `release/` contains only the canonical unpacked app and Spotlight resolves
  only that bundle. A fresh LaunchServices run held four owned processes and
  zero stale profiles throughout. Splash work sampled `76.9%`, `259.3%`,
  `74.5%`, and `31.6%` CPU at `+5s`, `+15s`, `+30s`, and `+35s`, then settled
  to `0.0%` at both `+60s` and `+90s`. Hosted publication then completed
  successfully in GitHub Actions run `26792860931`: Linux AppImage, macOS ARM
  zip, macOS Intel zip, Windows NSIS installer, their updater blockmaps, and
  merged Linux/macOS/Windows updater metadata are public on the non-draft,
  non-prerelease `v1.4.8` GitHub release. The Windows runner passed package
  smoke plus launch-and-cleanup proof for both unpacked and NSIS-installed
  executables. CI run `26792854933`, Docker run `26792854912`, and Auto-version
  run `26792854913` also completed successfully.
- 2026-06-02 post-`v1.4.8` management-key bootstrap hardening candidate:
  current OpenRouter docs still require an existing management key for
  `POST /api/v1/keys`, so that documented route cannot bootstrap Hydra's first
  management key from a Clerk session. Source review found that the private
  dashboard Server Action lane still attempted speculative write probes after
  drift. Hydra now performs one confirmed HTTPS Server Action write, fails
  closed if a successful write response does not expose the one-time key, and
  moves directly to one isolated UI learner on `404`. The learner captures
  `Next-Action` at browser-context scope and persists it for subsequent direct
  replay. The local database had zero active no-key accounts, so no redundant
  upstream key was minted to fabricate live evidence. Source-only verification
  passed syntax, lint, full `npm test`, production build, gate `12/12`, OpenAPI
  regeneration (`84` operations), focused background contracts `34/34`,
  focused cancellation plus background contracts `39/39`, diff hygiene, and
  audit `30 ok / 5 deferred / 1 missing / 0 blockers`. The remaining local
  audit miss is the intentionally absent macOS Intel artifact in the ARM-only
  local release tree. The
  already-running exact-public `v1.4.8` package remained at four Hydra-owned
  processes with zero stale Hydra Playwright profiles and `0.1%` sampled CPU;
  this is runtime-baseline evidence, not evidence that the unbuilt candidate
  executed inside the packaged app. The durable note is
  `docs/recon/OPENROUTER_KEY_ENDPOINTS_AND_PROVISION_FALLBACKS.md`.
- 2026-06-02 post-`v1.4.8` request-first bootstrap package verification:
  checkpoint `c5284c9` removed speculative management-key write probes while
  retaining one confirmed HTTPS Server Action write and one isolated UI
  learner fallback. Native quit evidence under
  `/private/tmp/hydra-http-bootstrap-rebuild-shutdown-20260602T020908Z`
  records `4 -> 0` packaged processes in the first sample with zero stale
  Hydra Playwright profiles. The rebuilt ARM package passed resource smoke,
  strict deep codesign, bundle-version inspection (`1.4.8`), and embedded
  source inspection. Its local archive SHA-256 before reversible cleanup was
  `d3edcafa129b25bc1ae42e8978de76a58c44e696cb78e355fa22973f35f9a87c`.
  Generated archive metadata and the prior public ARM bundle moved
  reversibly to `~/.Trash/`; `release/` again contains only the canonical
  unpacked app and Spotlight resolves only that bundle. LaunchServices
  evidence under
  `/private/tmp/hydra-v148-http-bootstrap-current-source-launch-20260602T021059Z`
  records four owned processes and zero profiles throughout, with CPU decay
  from `247.0%` at `+5s` to `2.5%` at `+20s` and `0.0%` at `+35s`, `+60s`,
  and `+90s`. Splash diagnostics remained finite: `72/72` shuffled words,
  zero duplicate shatter skips, collision-free lifted portal entry, timers
  `0`, inactive RAF, and cleared Matter state. The untouched five-minute
  profile under
  `/private/tmp/hydra-v148-http-bootstrap-post-rebuild-idle-profile-20260602T021306Z`
  retained exactly four processes and zero profiles across all `11` samples;
  CPU ranged `0.0-0.2%`, averaged `0.027%`, and ended at `0.0%`; RSS moved
  `508329984 -> 487489536` bytes (`-20840448`). This proves the bounded
  candidate is packaged and idle-clean. A future active no-key account is
  still required to prove the learned direct replay live without minting a
  redundant upstream key. The final documented-tree chain passed lint, full
  `npm test`, gate `12/12`, OpenAPI regeneration (`84` operations), diff
  hygiene, and audit `30 ok / 5 deferred / 1 missing / 0 blockers`. Docker
  smoke passed after Docker Desktop reached a stable daemon state: compose
  validation, rebuilt production image, real containerized Playwright
  Chromium launch, and cleanup all completed. Teardown left no Hydra compose
  service or `hydra_default` network and stopped Docker Desktop again. Public
  checkpoint verification also passed: CI run `26794501452` closed green,
  Docker workflow run `26794501428` passed runtime smoke plus registry image
  push, and Auto-version run `26794501427` correctly skipped.
- 2026-06-02 `v1.4.9` pending-account visibility and Bulk OTP recovery patch:
  live packaged-vault inspection found `14` saved account rows while the
  dashboard rendered only `9`; the other `5` were valid encrypted
  `pendingVerification` OTP stubs hidden by the old dashboard read. Bulk OTP
  dedupe could see those rows, but returned `Dup skip` instead of placing
  sign-in-needed rows back into the sequential queue. The dashboard now
  includes pending rows as lightweight local-only cards, labels them
  `OTP SIGN-IN PENDING`, and routes them back to Bulk OTP without issuing
  upstream balance requests for keyless stubs. Bulk import reuses saved rows
  that still need sign-in, preserves Force replace for explicit reset, and
  reports live saved duplicates as `Saved active skip`. The recovery button
  explicitly requests pending rows. Focused verification passed API
  integration `11/11`, UI/background contracts `80/80`, lint, syntax, and
  diff hygiene. Hosted package matrix run `26794714439` also passed Linux x64,
  macOS ARM, and macOS Intel smoke against checkpoint `0701ca0`; the Intel lane
  built and smoked `Hydra-1.4.8-mac-x64.zip`. A follow-up local pulse sample
  under
  `/private/tmp/hydra-v148-http-bootstrap-post-matrix-pulse-20260602T024111Z`
  retained four owned processes and zero profiles across `13` samples; CPU
  ranged `0.0-0.5%`, averaged `0.069%`, and ended at `0.0%`.
  The final local ARM package passed renderer build, packaged-resource smoke,
  strict deep codesign, and plist version checks at `1.4.9`; its generated zip
  SHA-256 before reversible metadata cleanup was
  `472f1e34ec00d87d12653a075579d7068f595049df9fa5260fd1cf1adce78b66`.
  LaunchServices evidence under
  `/private/tmp/hydra-v149-final-launch-20260602T055722Z` recorded the expected
  four-process tree and zero stale profiles after finite splash teardown. The
  final process exit was intentional, not a crash: Electron logged
  `lifecycle:tray-quit-click` followed by `exitCode=0`, and macOS produced no
  Hydra diagnostic report.
- 2026-06-02 `1.5.0` priced-routing and desktop-operator refinement candidate:
  the old proxy loop rotated keys but stopped after three attempts and Traffic
  Console displayed raw status rows without the decision context. Hydra now
  uses an eight-key bounded eligible-key failover default, configurable with
  `HYDRA_PROXY_MAX_KEY_ATTEMPTS` and clamped to `32`; emits
  `X-Hydra-Attempts` and `X-Hydra-Rotated`; records attempt, outcome, exact
  upstream cost, and cost provenance; retains OpenRouter catalog prompt,
  completion, and request prices; and renders explicit route plus input/output
  price columns. Exact upstream `usage.cost` wins, while catalog-only splits
  render as marked estimates. Client-visible OpenRouter `404` remains an
  `upstream_response` because changing credentials cannot repair an invalid
  model or endpoint; key-level `429` records cooldown and continues to another
  eligible key. The deprecated `stream_options.include_usage` injection is
  removed because current OpenRouter usage accounting is automatic. Command
  now has real persisted Grid/List/Map views; the sidebar has visible labels,
  stronger bounded proximity response, Settings beside lock/quit, and
  Generator at the bottom of the main workflow stack; Pool Manager gets larger
  key hitboxes, account-level pool toggles, and a subdued Paste Key action;
  Bulk Import copy is shorter and OTP/relay activity logs survive route
  changes through session storage; Settings gets Standard/Compact density; Code
  Redeemer tightens its textarea; and the Jupiter-like ambient planet gains a
  launch-bounded reduced-motion-safe moon orbit. Focused verification passed
  schema sync, syntax, telemetry `5/5`, request-log buffer `5/5`, background
  contracts `34/34`, UI contracts `47/47`, chain completeness `2/2`, lint,
  production renderer build, and diff hygiene. The durable release inventory is
  `docs/releases/1.5.0.md`; routing recon is
  `docs/recon/TRAFFIC_ROUTING_AND_PRICING.md`. Full source, CLI/API, package,
  native spot, and hosted PR matrix evidence must still be appended before
  merge. The local package lane is now complete: full `npm test`, gate `12/12`,
  OpenAPI regeneration (`84` operations), ARM package smoke, strict deep
  codesign, and LaunchServices native spot checks passed. The generated ARM
  zip SHA-256 before reversible metadata cleanup was
  `016010d098faf19cbe8659b10880cf8dfa6ef54cd83e32d8c7fd16ed54cdc6bc`.
  Splash diagnostics reported finite teardown with `timers=0`,
  `rafActive=false`, `bodyCount=0`, and `matterCleared=true`; the settled
  packaged runtime reported four Hydra-owned processes, zero stale Playwright
  profiles, `0.0%` aggregate CPU, and `528.55 MB` RSS. Native checks covered
  all `13` Dashboard accounts, Grid/List/Map, Traffic, Pool Manager, Settings
  density switching, and the shortened Bulk OTP surface. Hosted PR checks
  remain the merge boundary.
- 2026-06-02 final `1.5.0` Generator OTP and startup-reveal package proof:
  Account Generator now defaults its isolated signup browser to visible mode
  for upstream human verification, reports `manual_verification` instead of
  hanging silently, sanitizes OTP input to six digits, supports Enter-submit,
  and explicitly clicks Clerk's visible OTP submit control before falling back
  to Enter. No real signup was started from the supplied `admin@preheat.cc`
  credentials during this verification because the upstream OTP/human
  verification step belongs to the operator. The final source patch also
  hardened the splash-to-main handoff after LaunchServices exposed an
  intermittent invisible-window reveal: startup now waits briefly for macOS
  Dock presentation, shows inactive, activates/focuses, logs
  `main-window:startup-reveal`, and retries visibility if macOS keeps the
  window hidden. Focused main-process regression passed `31/31`, package smoke
  passed, strict deep codesign passed, bundle version reported `1.5.0`, and
  embedded-source inspection found the Generator, splash timing, and reveal
  anchors inside the packaged app. The final local ARM zip SHA-256 is
  `49d191e7a9cfb72193abf5b10e4cb96c18c9bb0bee35d687b019f7ddce63ab44`.
  LaunchServices opened the exact rebuilt bundle without a browser; splash
  diagnostics stayed finite with `durationMs=16000`, `exitMs=11750`,
  `portalMs=4250`, `timers=0`, `rafActive=false`, `bodyCount=0`, and
  `matterCleared=true`. The reveal log reported `visible=true` at initial
  loadURL fallback, `+300ms`, and `+1200ms`. The first post-splash sample
  caught the expected compositor tail, then the untouched idle sample settled
  to four Hydra-owned processes, zero stale Playwright profiles, `0.0%`
  aggregate CPU, and `591.64 MB` RSS. Local notarization remains deferred
  because Apple signing credentials are absent; local ad-hoc codesign is valid.
- 2026-06-02 `1.5.1` Account Generator OTP timeout rescue: source trace of the
  reported `Timeout 30000ms exceeded` path found that browser signup checked
  for human verification only after the full 30-second OTP wait failed. Hydra
  now polls the isolated browser every `350ms`, reports `manual_verification`
  immediately when CAPTCHA, Cloudflare, or similar security UI is visible,
  broadens OTP detection to Clerk segmented fields plus single six-digit and
  generic code/numeric inputs, fills both OTP layouts, and submits the visible
  Clerk control before Enter fallback. The renderer uses
  `submitGeneratorOtpQuiet()` so OTP submit no longer raises the app-wide
  loading veil, and the Generator page now shows a normal **Submit code**
  button with clearer status copy. No supplied signup password was used to
  create a live upstream account during verification. Evidence passed: syntax
  check, background contracts, UI static contracts, request-cancellation
  contracts, Clerk signup-boundary contract, lint, renderer build, gate, OpenAPI
  generation, Clerk connectivity, and diff hygiene. Clerk bootstrap returned
  HTTP `200` and set the expected `__client` cookie. Detailed recon lives in
  `docs/recon/GENERATOR_OTP_TIMEOUT_AND_MANUAL_VERIFICATION.md`. Local ARM
  packaging passed renderer build, resource prep, package smoke, plist version
  `1.5.1`, strict deep codesign, and embedded-source inspection; the ARM zip
  SHA-256 is
  `728c2a618f5cbc225b271a14cc9a5f0d021668ef0f3afe8fa1a92a251d091984`.
  Local Intel packaging was not faked on Apple Silicon: package prep correctly
  refused `darwin-x64` because the local Playwright cache contains only the ARM
  Chromium payload. The Intel artifact remains assigned to the hosted Intel
  macOS runner. GitHub release v1.5.1 is public after Release Desktop Apps run
  `26814812863`; the run passed shared lint/test/gate, macOS arm64 zip smoke,
  macOS Intel x64 zip smoke, Windows NSIS build/smoke plus hosted
  unpacked/installed executable launch, Linux AppImage smoke, artifact uploads,
  and merged macOS updater metadata. Public asset inspection verified macOS
  arm64 zip/blockmap, macOS Intel zip/blockmap, Windows NSIS/blockmap, Linux
  x64 AppImage, `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.
- 2026-06-02 post-release `1.5.1` renderer diagnostics bridge: the packaged
  GUI now asks the renderer for `window.__HYDRA_RENDERER_DIAGNOSTICS__()` after
  the main window reveal and writes a redacted `[hydra-renderer] diagnostics`
  snapshot to the Electron log at `+2s` and `+10s`. The log includes only
  counts and owner buckets for tracked timeouts, intervals, RAFs, and Anime.js
  effects; it does not include account, token, cookie, or renderer-state
  payloads. Static Electron contracts now lock the bridge, scheduled snapshots,
  and unref'd diagnostic timers. Focused verification passed
  `npm run test:electron-main-process` (`31/31`). The broad source chain passed
  `npm run lint`, full `npm test`, `npm run gate`, and `npm run openapi:hydra`
  (`84` operations). The first combined Docker smoke attempt stopped because
  Docker Desktop was closed; after launching Docker Desktop, `npm run
  docker:smoke` passed compose config, daemon detection, image build, and a real
  Playwright Chromium launch inside `ghcr.io/zaydiscold/hydra:latest`. The
  rebuilt local ARM package passed `HYDRA_BUILD_TARGET=darwin-arm64 npm run
  electron:smoke`, strict deep codesign, plist version `1.5.1`, embedded-source
  inspection for `hydra-renderer`, and produced ARM zip SHA-256
  `ac554a004d9d4fd38fd06b38a44d3c31802b8380bd71a0df712d6e2997e60583`.
  LaunchServices evidence under
  `/private/tmp/hydra-v151-renderer-diag-20260602T111704Z` recorded a clean
  closed baseline (`doctor-before-launch.json`: zero Hydra processes, zero
  profiles), finite splash teardown in `main.log.after-launch-copy`
  (`timers=0`, `rafActive=false`, `bodyCount=0`, `matterCleared=true`,
  `queueLength=72`, `shatteredWordCount=72`, `duplicateShatterSkips=0`), and
  renderer diagnostics at `2026-06-02T11:17:26Z` and `2026-06-02T11:17:34Z`
  with `intervals.active=0`, `animationFrames.active=0`,
  `animations.active=0`, and three expected top-level owned one-shot timeouts
  (`App.ambientMotion`, `App.upstreamHealth`, `useMetrics.autoRefresh`).
  Five-minute idle sampling from `2026-06-02T11:17:40Z` through
  `2026-06-02T11:22:43Z` stayed on one four-process Hydra tree with zero stale
  profiles; CPU was `0.0-0.4%`, averaged `0.045%`, ended at `0.0%`, and RSS
  dropped `104,906,752` bytes. Native quit then returned to zero Hydra-owned
  processes and zero profiles. Raw broad process grep files are preserved as
  `ps-before-launch.txt` (`265` lines), `ps-after-splash-teardown.txt`
  (`273`), `ps-after-profile.txt` (`273`), and `ps-after-native-quit.txt`
  (`270`). Packaged screenshot evidence is still explicitly not promoted:
  `screencapture` produced a black image and Computer Use timed out twice
  against both `Hydra` and the explicit app bundle path, so this environment did
  not produce a trustworthy refreshed packaged screenshot.
