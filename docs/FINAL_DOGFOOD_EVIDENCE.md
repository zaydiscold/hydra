# Final Dogfood Evidence

The final Hydra dogfood pass needs packaged Electron and live-account evidence
that Codex cannot safely infer from source tests. Use the checked-in preflight
to create a redacted evidence artifact after you run the real app.

Current pre-dogfood performance evidence from 2026-05-26 and 2026-05-27 is in
`docs/RELEASE_AUDIT.md`. Source and local runtime measurements currently show:

- Dashboard metadata/status shaping is down 61.1% in the local DB microbench.
- Proxy retry body encoding is down 86.9% in the request-body benchmark.
- Vault status-total rendering is down 96.0% in the synthetic 5000-account
  benchmark.
- Session refresher selected reads are down 13.4%.
- Rebuilt packaged macOS arm64 launches repeatedly settled back to near-zero
  idle CPU after the splash/main transition.
- The 2026-05-27 five-minute packaged idle profiles kept the four Hydra-owned
  processes around `0.0%` to `0.2%` CPU, with RSS dropping from `423.23 MB` to
  `414.91 MB`, from `421.53 MB` to `399.09 MB`, and from `402.78 MB` to
  `367.83 MB` across no-relaunch samples of the already-running package. A
  later fresh no-relaunch sample in
  `/private/tmp/hydra-profile-20260527T174343Z-fresh-current` kept Hydra at
  `0.0%` CPU with RSS dropping from `298.69 MB` to `277.45 MB`; the follow-up
  `/private/tmp/hydra-profile-20260527T175641Z-goal-item1` sample again kept
  Hydra at `0.0%` CPU with RSS dropping from `278.92 MB` to `249.23 MB` and
  preserved full before/after process grep output. The later
  `/private/tmp/hydra-profile-20260527T183654Z-seek-improvement` sample kept
  `hydraPlaywrightProfiles.count` at `0` and sampled Hydra at `0.0%` CPU /
  `250.31 MB` RSS before and `0.5%` CPU / `256.70 MB` RSS after. The fresh
  `/private/tmp/hydra-profile-20260527T185734Z-fresh-goal-item1` sample kept
  Hydra at `0.0%` CPU before/after, with RSS dropping from `248.41 MB` to
  `205.78 MB` and full `ps-grep-before.txt` / `ps-grep-after.txt` artifacts.
  A resumed 2026-05-30 five-minute sample in
  `/private/tmp/hydra-profile-20260531T031156Z-visible-timers-resume`
  preserved the changed sandbox boundary: direct `ps` / `top` probes and
  `hydra doctor` process enumeration returned `EPERM`, while doctor still
  verified `hydraPlaywrightProfiles.count: 0` before and after.
- `hydra doctor` now separates Hydra-owned process load from unrelated
  Chrome/CDP/browser-tooling load, which stayed heavy and was intentionally not
  closed.
- `hydra doctor --clean-stale-profiles` moved stale Hydra-owned Playwright
  profile directories to a timestamped temp backup with `deleted: 0`, and the
  Playwright isolation tests now clean their own temp profiles.
- Renderer timers, intervals, animation frames, and Anime.js effects are routed
  through `window.__HYDRA_RENDERER_DIAGNOSTICS__()` ownership tracking.
- The splash now lasts 16 seconds with a bounded 72-word unique irregular shower,
  then uses a staged three-second accelerating portal orbit with an initial
  inward lift, delayed welcome-card reveal, and delayed canvas fade. The
  falling phase keeps floor and side-wall collision, but removes the top wall
  that overlapped new spawns. One-shot parent shattering prevents repeated
  letter clones inside a single collision event. Portal entry disables glyph
  collision response while retaining independent bodies. Matter.js, RAF, timers, listeners,
  bodies, and optional sensor instances remain bounded by the deterministic
  splash-disposal contract.
- Tilt support is source-verified as opportunistic device tilt: sensor/fallback
  x input affects horizontal gravity, spawn-position bias, and initial x
  velocity. Exact MacBook hinge-angle support remains a future native HID bridge,
  not a claimed packaged feature.
- Versioning for this tranche resolved as intended: checkpoint commits used
  `[skip-bump]`, the release trigger used `[bump:minor]`, and the batched
  performance/splash/runtime work shipped as `v1.1.0`.
- A redirected temp package build found and fixed a packaging hygiene issue where
  stale `release/**` output could be copied into `Resources/app/release/**` when
  output was redirected outside the repo. A follow-up temp package build passed
  `electron:smoke`, source inspection, no-nested-`release` inspection, and
  deep codesign verification.
- The newest server cleanup pass converts task expiry and magic-link cleanup
  work away from permanent intervals: task expiry now uses one unref'd timeout
  and waits for active sweeps during shutdown, task shutdown caps unref and clear
  their timeout handle after fast cleanup, and magic-link cleanup only schedules
  a timeout when a pending magic-link entry exists. These are source and
  audit-contract wins until the package is rebuilt and relaunched.
- Streaming proxy responses now start their `RequestLog` placeholder write in
  parallel instead of awaiting that Prisma create before `forwardSseStream()`,
  removing one DB write from the chat/SSE pre-first-byte path while preserving
  final usage and latency updates. Synthetic 5ms-placeholder timing reduced the
  isolated pre-forward wait from `6.237ms` average to `0.026ms` average
  (`99.6%`) over `200` rounds.
- Traffic refresh now runs the latest-log read and 24h status aggregation in
  parallel. Local SQLite/Prisma timing on the current dev DB reduced the
  measured query-composition wait from `0.231ms` average to `0.174ms` average
  (`24.7%`) over `50` rounds; synthetic 8ms/11ms read timing reduced the
  isolated gate from `22.273ms` average to `11.354ms` average (`49.0%`) over
  `200` rounds.
- The model-list proxy path now uses a 30-second in-process cache with explicit
  invalidation after model refresh. Local timing with `372` cached models
  reduced repeated model-list reads from `0.976ms` average cold DB-backed to
  `0.0003ms` average warm in-process over `100` rounds.
- The Pool Manager model picker now uses the same invalidated 30-second
  in-process cache. Local timing with `372` cached models reduced repeated
  `/api/pool/models` reads from a direct-Prisma `1.548ms` average in the
  comparison run to `0.000419ms` warm in-process (`99.973%`) over `200` rounds.
- Packaged-window screenshot capture is partially verified without browser
  substitution: CoreGraphics found the already-running packaged Hydra dashboard
  window (`CGWindowID 31589`, title `Hydra — Dashboard`), `screencapture -l`
  captured that Electron window, and ImageMagick redacted local account data.
  Redacted artifact:
  `docs/evidence/hydra-packaged-dashboard-20260527T183013Z-redacted.png`
  (`sha256 05a5b416c73edf9c1278e8d5ad562552733cb6f6d41c4c2512f45e386d9db076`).
  This is not the complete packaged screenshot audit: Computer Use timed out
  twice, System Events lacked Accessibility permission, and only the Dashboard
  route was captured.
- Automation network routing is now shared by Playwright and non-Playwright
  OpenRouter automation: Server Action/tRPC/REST probes and Playwright
  fallbacks use one per-task route, either `account-proxy` from the encrypted
  account proxy pool or explicit `direct-localhost` with Chromium
  `--no-proxy-server`. Reusing the task route's undici dispatcher reduced
  repeated proxy HTTP-probe setup from `33.231ms` to `0.141ms` over `1000`
  rounds (`99.576%`).
- Renderer auto-refresh timers now pause at scheduling time while hidden. App
  upstream health, Dashboard metrics, Traffic logs, and Vault refresh moved to
  `useVisibleRecurringTask`; a deterministic 30-minute hidden-window count
  drops those refresh timer wakeups from `129` to `0`.
- Docker build context now excludes `release/`. After the public `v1.1.0` ARM
  archive was downloaded locally, the measured `docker compose build` context
  dropped from `304.28 MB` to `2.02 MB` (`99.3%`) once desktop archives and
  extracted app resources stopped entering container builds.
- Targeted Desktop cleanup left one launchable Hydra bundle under `~/Desktop`:
  `release/mac-arm64/Hydra.app`. Extra/stale bundles and superseded installers
  were moved reversibly to
  `/private/tmp/hydra-desktop-duplicates-20260531T031455Z`.
- Session-memory hardening now retains distinct Clerk device identities instead
  of raw transient dashboard snapshots. Sanitized forced probes after the
  change confirmed `4/4` selected stored logins active and redeem-ready,
  including one active login without a management key; each active cookie stack
  persisted from `25` equivalent snapshots to `1`.
- The rebuilt and published `v1.1.0` macOS arm64 package passes packaged-resource smoke
  and strict codesign verification. Packaged-source inspection confirms the
  `16000ms` splash, 72-word unique target, staged `3000ms` non-colliding portal orbit, and bounded
  `18500ms` self-disposal. Docker image smoke also passed after redirecting
  sandbox-blocked Buildx activity state to `/private/tmp/hydra-buildx`.
- `v1.1.0` is now published with macOS arm64, macOS Intel, Windows x64, Linux,
  and merged updater metadata. The published macOS arm64 zip was extracted into
  `release/mac-arm64/Hydra.app` after reversibly moving the prior bundle aside;
  it is the only Desktop `Hydra.app`, reports version `1.1.0`, and passes deep
  strict codesign verification. The existing Hydra process was intentionally
  not closed or relaunched.
- A fresh no-relaunch profiling attempt after that on-disk install could not
  enumerate live processes in the resumed sandbox: direct `ps` returned
  `operation not permitted`, `pgrep` returned `Cannot get process list`, and
  `top` could not reach `sysmond`. `hydra doctor --json` preserved the stable
  unavailable schema with `reason="spawnSync ps EPERM"` and still reported
  `hydraPlaywrightProfiles.count: 0`. Treat this as a measurement boundary, not
  as packaged-GUI evidence for the newly installed release.
- A final no-launch local verification pass completed without starting Hydra:
  lint, the full test suite, the `12/12` gate, OpenAPI generation
  (`83 operations`), `git diff --check`, Docker smoke, and Electron smoke
  against the installed published `v1.1.0` app resources all passed. The
  resumed checkout initially selected its older
  `Hydra-1.0.20-mac-arm64.zip` archive during Electron smoke. The source lane
  was then aligned to `1.1.0`, the stale ARM zip/blockmap and updater metadata
  were moved reversibly into `/private/tmp`, and the public `v1.1.0` ARM
  zip/blockmap plus `latest-mac.yml` were downloaded into `release/`.
  Follow-up `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed
  directly against `release/Hydra-1.1.0-mac-arm64.zip`. Tagged release run
  `26702889329` remains the authoritative cross-target release matrix.
- A full `/Users/zaydk/Desktop` inventory found exactly one installed
  `Hydra.app`: `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.
  Computer Use did not list Hydra among running apps. The packaged GUI pass
  therefore remains pending an explicitly authorized launch.

This is not release-complete evidence. It is the current source/package-resource
and local idle-performance evidence that should feed the final manual dogfood
run.

The full operator checklist is in `docs/PACKAGED_ELECTRON_DOGFOOD.md`. For the
current published release, derive the release version from GitHub. This remains
correct even when a resumed sandbox cannot refresh local Git metadata and its
checked-out `package.json` is stale:

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

Run from the repo root after the packaged app pass:

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

Add the other manual flags only after you actually perform those checks:

- `--manual=touch-id`
- `--manual=live-account-flows`
- `--manual=screenshots-redacted`
- `--manual=windows-launch`

For a different release, substitute `--version=<version>`,
`--artifact-dir=<dir>`, and `--app=<path/to/Hydra.app>` with the downloaded
release artifact directory and extracted packaged app path.

Unknown `--manual=<id>` values are recorded in the evidence file and prevent `complete=true`. Treat that as a typo or stale runbook until corrected.

The default output is `docs/DOGFOOD_EVIDENCE.json` when `--write-evidence` is passed without a path. The example above uses an explicit path so the evidence location is unambiguous. `hydra audit` reads `docs/DOGFOOD_EVIDENCE.json` by default, or `HYDRA_DOGFOOD_EVIDENCE=/path/to/evidence.json` when you want to audit a downloaded or temporary evidence file.

The evidence records checklist status, artifact presence, `hydra audit` summary, Docker reachability, optional app-open status, and optional `--launch-diagnostics` results for the Electron runtime, LaunchServices, Finder AppleEvents, and Hydra's packaged app handoff. Use `--version=<semver>` when local package metadata lags the release under test, `--artifact-dir=<dir>` for downloaded GitHub release assets, and `--app=<path/to/Hydra.app>` for an extracted release app; by default the script uses local `package.json`, local `release/` artifacts, and `release/mac-arm64/Hydra.app`. It does not read the local database, cookies, screenshots, API keys, Clerk session IDs, local secrets, or account email contents.

Do not paste API keys, cookies, tokens, real account data, or private screenshots into this file. It is a status artifact, not a log dump.

This evidence file is not release-complete by itself. The release remains not complete while `hydra audit` has missing/blocker evidence or any required manual check is absent. Existing audit deferred items are expected before this file is written; `hydra audit` reads the completed evidence file afterward to clear the manual dogfood items.

## v1.1.3 Packaged Splash Evidence

- The rebuilt macOS arm64 app was launched for a direct Electron CDP capture of
  the splash renderer. This avoids the macOS transparent-window compositor
  edge case and keeps Desktop contents out of the artifact.
- `videos/hydra_splash.gif` is the reviewed capture: `15.6s`, `156` frames,
  `960x583`, approximately `12 MB`.
- Packaged runtime diagnostics reported `target=72`, `queueLength=72`,
  `shatteredWordCount=72`, `duplicateShatterSkips=0`,
  `peakDynamicBodyCount=556`, `portalCollisionDisabled=true`,
  `renderFrames=408`, `physicsSteps=716`, `timers=0`, `rafActive=false`,
  `matterCleared=true`, and `disposed=true`.
- The randomized final run stayed `84.5%` below the pathological pre-guard
  `3582` dynamic-body peak. The unique queue, one-shot shatter guard, removed
  ceiling collider, and collision-free portal phase remain in source even
  when a healthy run does not reproduce the protected failure paths.
- Public `v1.1.3` verification passed through Auto-version run `26709320831`,
  CI run `26709320818`, Docker run `26709320837`, and desktop release run
  `26709323849`. The release publishes macOS arm64, macOS Intel x64, and
  Windows x64 NSIS artifacts plus updater metadata; Linux remains frozen.
- The downloaded public ARM zip passed packaged Electron smoke and SHA-512
  verification against `latest-mac.yml`. Its app bundle was installed
  reversibly at the sole canonical Desktop path, force-registered through
  LaunchServices, and launched. Follow-up `hydra doctor --json` reported
  `version=1.1.3`, four Hydra-owned processes, `0.4%` sampled Hydra CPU, and
  zero stale Hydra Playwright profiles after splash teardown.

## v1.1.3 Packaged Bridge Repair Evidence

- A fresh five-minute idle profile of the public app kept four Hydra-owned
  processes and zero Hydra Playwright profiles for all 11 samples. RSS changed
  by `+1.72 MB`; instantaneous Hydra CPU ended at `0.0%`. A separate clean
  quit captured zero owned processes before the LaunchServices relaunch.
- Direct packaged Electron CDP instrumentation found a real native bridge bug:
  public `v1.1.3` loaded its localhost renderer without exposing
  `window.hydraNative`. Both sandboxed preload scripts incorrectly used ESM
  imports.
- The local repair converts both preloads to Electron's sandbox-compatible
  `require('electron')` form and adds a regression contract. See
  `docs/PRELOAD_BRIDGE.md`.
- Rebuilt local package dogfood verified `window.hydraSplash` during splash,
  the full `window.hydraNative` surface after handoff, and visible Settings
  controls for `Touch ID Unlock`, `AVAILABLE`, the enabled vault-unlock
  checkbox, and `Test Prompt`.
- Hardware Touch ID approval, lock/unlock, public patch artifact verification,
  full redacted screenshots, live account flows, and Windows-host launch
  remain explicit manual boundaries.

## v1.1.4 Public Bridge Verification

- Auto-version run `26710107156`, CI run `26710107146`, Docker run
  `26710107166`, and desktop release run `26710112876` passed. The desktop
  release publishes macOS arm64, macOS Intel x64, and Windows x64 NSIS
  artifacts plus merged updater metadata; Linux remains intentionally frozen.
- The exact downloaded public ARM zip passed strict deep codesign, packaged
  Electron smoke, GitHub SHA-256 digest verification, and SHA-512 verification
  against merged `latest-mac.yml`. Its app bundle reports `1.1.4`.
- The prior local rebuilt app, stale local ARM archives, stale updater
  metadata, and obsolete local unpacked Windows folder were moved reversibly
  to `/Users/zaydk/.Trash/hydra-pre-public-v114-20260531T103957Z`. The public
  app is installed at the sole Spotlight path:
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.
- Temporary packaged Electron CDP instrumentation verified splash
  `window.hydraSplash`, the complete replacement-renderer `window.hydraNative`
  bridge, packaged `appVersion() === "1.1.4"`, and visible Settings controls
  for `AVAILABLE`, the enabled Touch ID vault-unlock checkbox, and
  `Test Prompt`.
- A public-artifact route walk across Dashboard, Pool, Traffic, Settings, and
  Dashboard again reported zero intervals, zero active RAFs, zero active
  Anime effects, and only bounded route-owned timeouts. The temporary debug
  launch quit cleanly and Hydra was reopened normally. Settled
  `hydra doctor --json` reported four Hydra-owned processes, `0.0%` sampled
  Hydra CPU, and zero stale Hydra Playwright profiles.
- Fingerprint approval, Touch ID lock/unlock, duplicate-keychain-prompt
  observation, live account flows, final human screenshot review, and a real
  Windows-host installer launch remain explicit manual boundaries.

## v1.1.4 Packaged Screenshot And Idle Evidence

- A fresh five-minute idle profile of the exact public app sampled the settled
  package every 30 seconds with no UI interaction. All 11 samples reported four
  Hydra-owned processes and zero Hydra Playwright profiles. CPU stayed between
  `0.0%` and `0.3%` (`0.03%` average, ending at `0.0%`); RSS moved from
  `575.92 MB` to `577.41 MB` (`+1.48 MiB`). Raw local samples are in
  `/private/tmp/hydra-v114-idle-profile-20260531T9PltYn`.
- An independent five-minute recheck after repository screenshot review again
  kept four Hydra-owned processes and zero Hydra Playwright profiles across all
  11 samples. CPU stayed between `0.0%` and `0.7%` (`0.082%` average, ending at
  `0.0%`); RSS fell from `592.53 MiB` to `553.19 MiB` (`-39.34 MiB`). Raw
  local samples are in `/private/tmp/hydra-v114-idle-recheck-20260531T113620Z`.
- Native packaged Electron screenshots now cover first-run Vault setup,
  Dashboard, Vault, Pool, Settings Touch ID, and a Traffic console populated
  with six synthetic rows in a disposable isolated profile. The Traffic rows
  cover `200`, `429`, and `502` statuses and visible latency values without
  touching the live database.
- Dashboard, Vault, and Pool private fields were blurred or replaced in the
  renderer before `/usr/sbin/screencapture -l <CGWindowID>` wrote the native
  packaged-window PNG. A repository visual-review pass also replaced the
  Settings image's machine-specific local and LAN endpoint values with
  explicit redaction labels. The isolated setup and Traffic profiles plus the
  pre-redaction Settings image were moved reversibly to `~/.Trash`.
- Repository CLI images cover `hydra status`, `hydra proxy status`, and a
  compact `hydra doctor --json` excerpt. They were rendered from fresh
  privacy-safe command output because Terminal AppleEvents, Computer Use
  Terminal access, and post-exit native Terminal capture were
  permission-constrained.
- macOS Vision OCR reported zero email markers, key prefixes, credential
  assignments, or long token-shaped strings across all nine PNGs. ImageMagick
  reported nonblank color variance for every artifact. The manifest and SHA-256
  hashes are in `docs/evidence/README.md`.
- `docs/DOGFOOD_EVIDENCE.json` now records all six downloaded public desktop
  artifacts and the three empirically verified manual flags:
  `packaged-gui-launch`, `splash-unlock-dashboard`, and
  `screenshots-redacted`. `hydra audit --json` remains honestly incomplete at
  `31 ok / 5 deferred / 0 missing / 0 blockers` because its conservative gate
  waits for the complete manual checklist before promoting any manual item.
- The repository screenshot set received a direct visual integrity review.
  Native window-control interaction, full interactive route/dead-button
  review, live account flows, Touch ID fingerprint approval and unlock, and
  Windows-host installer launch remain explicit manual boundaries.
- Hosted Windows release workflow run `26711936191` passed shared verification,
  macOS arm64 package smoke, macOS Intel x64 package smoke, and Windows x64 NSIS
  package smoke. Its Windows-only launch gate started the real
  `release/win-unpacked/Hydra.exe` with isolated app data, observed four owned
  processes after `25,000ms` (main, GPU, network utility, renderer), and
  verified zero packaged-process survivors after cleanup. This materially
  tightens Windows release evidence without claiming the still-manual NSIS
  install/open UX pass.

## Native Accessibility Profiling Guardrail

- Two Computer Use attaches against the settled exact-public `v1.1.4` package
  timed out after `120s` each and left the external `SkyComputerUseService`
  helper continuously requesting macOS accessibility attributes.
- The resulting sampler is not a valid idle baseline: Hydra's Electron main
  process held roughly `67-70%` CPU while GPU, network utility, and renderer
  processes remained idle. Terminating only the stuck external helper returned
  the same four-process Hydra tree immediately to `0.0%` sampled CPU with zero
  stale Hydra Playwright profiles.
- A clean five-minute post-recovery sampler then kept four Hydra-owned
  processes and zero stale Hydra Playwright profiles across all 11 samples.
  CPU stayed between `0.0%` and `0.2%` (`0.091%` average); RSS moved from
  `505.36 MiB` to `507.20 MiB` (`+1.84 MiB`). Raw local samples are in
  `/private/tmp/hydra-v114-post-cua-idle-reprofile-20260531T122026Z`.
- `docs/ACCESSIBILITY_PROFILING_DISTORTION.md` records the local raw evidence,
  stack signature, exact recovery command, and the rule to profile before any
  accessibility attach. Computer Use is not used as packaged interaction
  evidence in this environment.

## Renderer Idle Performance Follow-Up

- A CDP-only exact-public `v1.1.4` route walk exposed a separate visible-route
  renderer cost after native accessibility polling was removed. Settings had
  zero intervals, zero active RAFs, and zero Anime.js effects, but two
  six-pixel success dots still ran an infinite `breathe` CSS animation.
- Pausing those two animations ephemerally dropped aggregate Hydra CPU from
  roughly `64%` to `0.0-0.3%` without a route change or relaunch.
- The local patch replaces steady success, error, and warning animations with
  static color-matched glows and bounds transient loading-dot motion to three
  `1.2s` cycles. Rebuilt packaged Settings settled to five consecutive `0.0%`
  samples after the bounded startup visual window; `hydra doctor` then sampled
  `0.5%` CPU with four Hydra-owned processes and zero stale profiles.
- The rebuilt package passed Dashboard, Bulk OTP, Vault, Pool Manager, Redeem,
  Generator, Traffic, Settings, and a redacted Account Detail reachability
  check. `docs/RENDERER_IDLE_PERFORMANCE.md` records exact reproduction,
  package-local raw evidence paths, the design choice, and verification.

## v1.1.5 Public Steady-Dot Verification

- Auto-version run `26712858914`, CI run `26712858931`, Docker run
  `26712858933`, and desktop release run `26712864469` passed. The desktop
  matrix includes macOS arm64, macOS Intel x64, and Windows x64 NSIS; the
  Windows lane also passed packaged executable launch-and-cleanup smoke.
- The exact downloaded public ARM zip SHA-256 matched GitHub asset digest
  `b64cd8f285d605e80416e4c9a7d4937076672801fe22b61f1a8d904d7454d341`.
  Its SHA-512 matched `latest-mac.yml`, strict deep codesign passed, and
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke` passed after
  installation.
- The pre-public local package was moved reversibly to
  `/Users/zaydk/.Trash/hydra-pre-public-v115-20260531T125225Z`. Desktop scan,
  Spotlight, and LaunchServices now resolve one canonical bundle:
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`, version `1.1.5`.
- A normal no-CDP launch settled without intervention. The exact-public
  five-minute profile at
  `/private/tmp/hydra-v115-public-idle-profile-20260531T125505Z` kept four
  Hydra-owned processes and zero stale Hydra Playwright profiles through all
  11 samples. CPU stayed between `0.0%` and `0.5%` (`0.136%` average); RSS
  moved from `569.73 MiB` to `575.33 MiB` (`+5.59 MiB`). A follow-up
  `hydra doctor --json` sampled `0.0%` CPU.
- Local Docker smoke could not rerun because Docker Desktop's daemon is
  stopped. Hosted Docker runtime smoke and registry push are green in run
  `26712858933`.
- An independent exact-public five-minute reprofile at
  `/private/tmp/hydra-v115-public-idle-reprofile-20260531T130940Z` again kept
  four Hydra-owned processes and zero stale profiles through all 11 samples.
  CPU stayed between `0.0%` and `0.3%` (`0.036%` average); RSS reclaimed
  `42.09 MiB`.
- A controlled LaunchServices cycle at
  `/private/tmp/hydra-v115-public-splash-teardown-20260531T131517Z` captured
  raw `ps -ax | grep -iE 'chrome|chromium|playwright|electron|hydra'`
  inventories plus anchored Hydra-owned subsets. The owned process count moved
  `4 -> 0 -> 4 -> 4` across settled app, quit, splash-active, and
  post-transition states. Splash renderer PID `54141` was replaced by main
  renderer PID `54169`; after the bounded startup window, the replacement tree
  settled to `0.0%` CPU with zero stale profiles.
- `docs/DOGFOOD_EVIDENCE.json` was regenerated against all six public `v1.1.5`
  desktop distributables. It preserves only the three empirically verified
  manual flags: `packaged-gui-launch`, `splash-unlock-dashboard`, and
  `screenshots-redacted`. Machine-specific paths were sanitized before
  check-in. Window controls, interactive dead-button review, Touch ID hardware,
  live account flows, and real Windows NSIS install/open UX remain false.
- A packaged-only CDP route pass at
  `/private/tmp/hydra-v115-public-route-walk-20260531T132145Z` mounted
  Dashboard, Bulk OTP, Vault, Pool Manager, Redeem, Generator, Traffic,
  Settings, and a redacted Account Detail route without printing account
  contents. The exact public bridge reports app version `1.1.5` and available
  macOS Touch ID.
- Settled Settings reported zero intervals, zero active RAFs, zero Anime
  effects, one bounded `App.upstreamHealth` timeout, and only a finished
  one-shot `fadeIn`; its CPU decay stayed between `0.0%` and `1.6%`, ending at
  `0.2%`. Account Detail's mount-only four `ScrambleText.reveal` intervals and
  one `AnimeText.scanline` effect cleared after six seconds; its CPU decay
  stayed between `0.0%` and `0.8%`, ending at `0.0%`.
- The temporary packaged-Electron debug session closed cleanly, Hydra-owned
  processes reached zero, port `9333` closed, and a normal no-debug
  LaunchServices reopen settled to four processes, `0.0%` CPU, and zero stale
  profiles.
- A third untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-public-idle-reprofile-20260531T133222Z` sampled the
  already-settled canonical app every 30 seconds for five minutes. All 11
  samples reported four Hydra-owned processes, zero stale profiles, and
  `0.000%` sampled CPU. RSS reclaimed `94.98 MiB` during the run. Follow-up
  inventory found no stuck accessibility helper, no debug listener on `9333`,
  one LaunchServices registration for `com.zayd.hydra` version `1.1.5`, and
  the same sole canonical `Hydra.app` through Spotlight and targeted
  filesystem scans.
- A native CoreGraphics-only calm-startup observation at
  `/private/tmp/hydra-v115-public-calm-launch-20260531T133924Z` quit the old
  canonical four-process tree to zero, launched the same app through
  LaunchServices, observed the splash-to-Dashboard window handoff, and
  reported `security_prompt_count=0` across 55 seconds. No native window owner
  or title matched `SecurityAgent`, Keychain, `CoreServicesUIAgent`, or
  authorization. The settled app returned to four owned processes with zero
  stale profiles. Chromium startup remains isolated through
  `password-store=basic` and macOS `use-mock-keychain`; biometric auth-token
  release remains independently fail-closed.
- A sanitized production-path session recheck at
  `/private/tmp/hydra-live-session-recheck-20260531T134828Z` ran
  `hydra session <id> --refresh --json` sequentially over all `12` stored rows.
  Owner-only redacted evidence reports `4` live-active Clerk logins, `0`
  expired, `0` errors, `8` rows with no active stored login, and `4`
  redeem-ready rows without storing account identities, cookies, tokens, or
  key material. One active login has no management key, preserving the
  login-truth versus key-storage distinction.
- A temporary packaged-only CDP pass at
  `/private/tmp/hydra-v115-public-session-ui-20260531T134932Z` clicked Account
  Detail's read-only Clerk re-probe action and rendered coherent current copy:
  `LIVE CLERK CHECK JUST NOW`, `Login works now`,
  `Next local renewal checkpoint: 7.0d`,
  `Interactive sign-in 7w ago · last silent renewal just now`, and the
  explanatory sentence that the checkpoint is a stored renewal estimate, not
  total login lifetime. The debug session closed, port `9333` closed, and the
  normal LaunchServices reopen settled to four owned processes, `0.0%` sampled
  CPU, and zero stale profiles.
- Exact-public Windows transfer inspection downloaded
  `Hydra-1.1.5-win-x64.exe` and `latest.yml`. The installer SHA-256 matched the
  GitHub asset digest
  `7f1a74c576710be9a2fd0fe8883aca501c9e53c1d84cd8404650367b308944b5`;
  its recomputed SHA-512 base64 matched `latest.yml`. Nested NSIS extraction
  found the x64 GUI executable, updater handoff module, packaged dashboard,
  Windows Prisma engine, Chromium archive, empty database, and Prisma schema.
  Electron source files, renderer assets, and source maps match the public
  macOS package after normalizing Windows line endings. The NSIS uninstaller
  ICO is byte-identical to the six-size source ICO, and `Hydra.exe` contains
  UTF-16LE `Frostbyte Technology` and `Developed by Zayd / Cold` strings.
  Release run `26712864469` independently passed Windows NSIS smoke plus
  packaged executable launch-and-cleanup. Real NSIS install/open UX remains a
  real-Windows-desktop manual boundary.
- The intermittent repeated-label splash report was rechecked against source.
  The splash has one recursive scheduler, one monotonic queue index, no refill
  path, `85/85` unique corpus labels, a `72`-entry no-repeat launch queue, and
  the one-shot parent `kind="shattered"` guard before glyph creation. The UI
  contract now rejects corpus-label duplication as well as a refill regression.
- A fourth untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-public-idle-reprofile-20260531T140919Z` sampled the
  already-settled canonical app every 30 seconds for five minutes with zero UI
  interaction. All 11 samples reported four Hydra-owned processes and zero
  stale profiles. Sampled CPU stayed at `0.000%` throughout; RSS moved from
  `577.23 MiB` to `579.20 MiB` (`+1.97 MiB`). Raw before/after inventories
  contain only the expected main, GPU, network-utility, and renderer
  processes.
- Follow-up hygiene checkpoint `86efec9` preserved public desktop version
  `v1.1.5`. Auto-version run `26715063086` skipped as intended, CI run
  `26715063087` passed, and Docker workflow run `26715063084` passed both
  runtime smoke and the registry image push.
- Windows manual evidence is now explicitly fail-closed. The generator,
  checked-in redacted manifest, and packaged-app runbook require a real Windows
  desktop OS version plus NSIS installer install/open result before
  `--manual=windows-launch` can be claimed. Hosted unpacked-app startup and
  cleanup smoke remains useful narrower evidence.
- A post-audit-parser untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-post-audit-parser-idle-reprofile-20260531T1429XX.Bb0Hqz`
  sampled the already-settled canonical app every 30 seconds for five minutes
  with zero UI interaction. All 11 samples reported four Hydra-owned processes
  and zero stale profiles. Sampled CPU stayed between `0.0%` and `0.1%`
  (`0.009%` average); RSS fell from `585.61 MiB` to `483.14 MiB`
  (`-102.47 MiB`). Raw before/after inventories contain only the expected main,
  GPU, network-utility, and renderer processes.
- A fifth untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-fifth-untouched-idle-reprofile-20260531T144321Z`
  again kept four Hydra-owned processes and zero stale profiles through all 11
  30-second samples. CPU stayed between `0.0%` and `0.2%` (`0.018%` average);
  RSS moved from `492.86 MiB` to `492.20 MiB` (`-0.66 MiB`). The first attempted
  sampler was discarded to Trash because its filter counted its own wrapper;
  this retained run anchors the executable command column and preserves raw
  before/after inventories.
- A timeout-race cleanup pass removed avoidable post-operation wakeups from
  management-key Playwright capture and SQLite schema self-heal, and made the
  delayed packaged updater check non-pinning. A 200-round synthetic resource
  probe at
  `/private/tmp/hydra-timeout-race-cleanup-benchmark-20260531T144529Z`
  recorded `200` pending timeout resources for the old fast-winner shape and
  `0` for the cleared shape.
- A temporary arm64 package built from that patch at
  `/private/tmp/hydra-package-timeout-cleanup-20260531T144838Z` passed packaged
  resource smoke, strict deep signature verification, and bundled-source
  inspection for all three cleanup contracts without replacing or launching
  the canonical Spotlight app. It was then moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-timeout-cleanup-20260531T144838Z`;
  Spotlight continues to resolve only the canonical public app.
- Performance checkpoint `0e01a0a` preserved public desktop release `v1.1.5`.
  Auto-version run `26715823083` skipped as intended, CI run `26715823077`
  passed, and Docker workflow run `26715823067` passed both runtime smoke and
  registry image push.
- The Docker-checkpoint parser now tolerates wrapped Markdown whitespace after
  `hydra audit` stayed pinned to older run `26715063084` when the newest run ID
  wrapped onto the next line. Its CLI contract now requires newest recorded
  checkpoint run `26715823067`; syntax, CLI (`46/46`), lint, full test, gate,
  OpenAPI, canonical arm64 Electron smoke, and diff checks passed.
- A sixth untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-sixth-untouched-idle-reprofile-20260531T145521Z`
  again kept four Hydra-owned processes and zero stale profiles through all 11
  30-second samples. CPU stayed between `0.0%` and `0.1%` (`0.018%` average);
  RSS moved from `479.42 MiB` to `480.66 MiB` (`+1.23 MiB`). Raw before/after
  inventories preserve the expected Hydra subset and the unrelated
  machine-global browser-tooling context.
- Pool Manager route exit now aborts its five-call data batch and bounded
  status probe, clears the tracked status timeout in `finally`, ignores late
  responses, and aborts superseded refreshes. A 200-route synthetic unmount
  probe at
  `/private/tmp/hydra-pool-route-unmount-benchmark-20260531T151453Z`
  recorded `1200` pending requests and `200` timeout resources after old-shape
  unmount versus `0` and `0` after owned cleanup; the new path raised `400`
  abort signals and canceled all `1200` simulated requests.
- The Pool Manager lifecycle patch passed UI static (`34/34`), lint, full test,
  build, OpenAPI, corrected serial gate (`12/12`), and diff checks. A temporary
  arm64 package at
  `/private/tmp/hydra-package-pool-route-abort-20260531T151623Z` passed
  packaged resource smoke, strict deep signature verification, and bundled
  inspection for both abort refs and all six signal-aware endpoints. It was
  moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-pool-route-abort-20260531T151623Z`;
  Spotlight continues to resolve only the canonical public app.
- A seventh untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-seventh-untouched-idle-reprofile-20260531T151122Z`
  kept four Hydra-owned processes and zero stale profiles through all 11
  30-second samples. CPU stayed between `0.0%` and `0.2%` (`0.036%` average);
  RSS moved from `470.03 MiB` to `477.84 MiB` (`+7.81 MiB`) while isolated
  package verification also ran.
- Renderer visible-refresh work now aborts end to end on hide or unmount:
  shared scheduled tasks receive an abort signal, dashboard/traffic/vault and
  app-shell health reads propagate it, canceled API retry delays clear their
  tracked timeout, late writes are ignored, and Vault/Dashboard status
  fan-outs stop dequeuing accounts after cancellation. A 200-surface
  synthetic hide probe at
  `/private/tmp/hydra-visible-refresh-abort-benchmark-20260531T152945Z`
  recorded `800` pending requests and `800` timeout resources for the old
  timer-only shape versus `0` and `0` for the abort-linked path; all `800`
  simulated requests were canceled.
- The visible-refresh lifecycle patch passed UI static (`35/35`), focused
  background lifecycle (`28/28`), lint, full test, build, OpenAPI, serial gate
  (`12/12`), and diff checks. A temporary arm64 package at
  `/private/tmp/hydra-package-visible-refresh-abort-final-20260531T153523Z`
  passed
  packaged resource smoke, strict deep signature verification, and bundled
  renderer inspection. It was moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-visible-refresh-abort-final-20260531T153523Z`;
  Spotlight continues to resolve only the canonical public app.
- An eighth untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-eighth-untouched-idle-reprofile-20260531T152450Z`
  kept four Hydra-owned processes through all 11 30-second samples. CPU
  stayed between `0.0%` and `0.1%` (`0.009%` average); RSS moved from
  `483.89 MiB` to `478.02 MiB` (`-5.88 MiB`) while source verification ran.
- Bulk Auth wizard unmount now aborts active Magic Link status probes,
  live-session confirmation probes, bulk-stub requests, Magic Link send/resend
  requests, and staggered send delays. A 200-wizard synthetic teardown probe
  at `/private/tmp/hydra-bulk-auth-unmount-benchmark-20260531T154607Z`
  recorded `2400` timeout resources and `600` pending requests after old-shape
  unmount versus `0` and `0` after owned cleanup; the new path aborted all
  `600` simulated requests.
- The Bulk Auth lifecycle patch passed focused background lifecycle (`28/28`),
  UI static (`35/35`), lint, full test, build, OpenAPI (`83 operations`),
  serial gate (`12/12`), and diff checks. A temporary arm64 package at
  `/private/tmp/hydra-package-bulk-auth-abort-20260531T154837Z` passed packaged
  resource smoke, strict deep signature verification, and bundled renderer
  inspection for the lifecycle cancellation markers. It was moved reversibly
  to `/Users/zaydk/.Trash/hydra-package-bulk-auth-abort-20260531T154837Z`;
  Spotlight continues to resolve only the canonical public app.
- A ninth untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-ninth-untouched-idle-reprofile-20260531T154248Z`
  kept four Hydra-owned processes through all 11 30-second samples. CPU
  stayed between `0.0%` and `0.2%` (`0.045%` average); RSS moved from
  `448.22 MiB` to `453.06 MiB` (`+4.84 MiB`) while source verification ran.
- Code Redeemer route exit now aborts account load, redemption-history load,
  session preflight, and bulk-matrix redemption requests. Account-selection
  changes also abort superseded debounced preflights. A 200-route synthetic
  teardown probe at
  `/private/tmp/hydra-code-redeemer-unmount-benchmark-20260531T155946Z`
  recorded `1400` pending request timeout resources after old-shape unmount
  versus `0` after owned cleanup; all `1400` simulated requests were aborted.
  This proves lifecycle teardown ownership, not a live redemption outcome.
- The Code Redeemer lifecycle patch passed focused background lifecycle
  (`29/29`), UI static (`35/35`), lint, full test, build, OpenAPI (`83
  operations`), serial gate (`12/12`), and diff checks. A temporary arm64
  package at
  `/private/tmp/hydra-package-code-redeemer-abort-20260531T160131Z` passed
  packaged resource smoke, strict deep signature verification, and bundled
  renderer inspection. It was moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-code-redeemer-abort-20260531T160131Z`;
  Spotlight continues to resolve only the canonical public app.
- A tenth untouched exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-tenth-untouched-idle-reprofile-20260531T155621Z`
  kept four Hydra-owned processes and zero stale profiles through all 11
  30-second samples. CPU stayed between `0.0%` and `0.3%` (`0.045%` average);
  RSS moved from `457.22 MiB` to `460.89 MiB` (`+3.67 MiB`) while source
  verification ran.
- Account Detail reads now belong to the resolved account route: route cleanup
  or an account-ID switch aborts account metadata, snapshot, management-key
  list, live-session probe, reveal, and key-test reads. The old mount-only
  initial-load guard is account-ID scoped so a reused detail route reloads the
  selected account. The same boundary clears account-specific modal, reveal,
  copied, transient-timer, and key-test UI state while suppressing late UI
  writes from server-completing mutations and login/create-key modal callbacks
  after navigation. A 200-route synthetic switch probe at
  `/private/tmp/hydra-account-detail-route-switch-benchmark-20260531T161135Z`
  recorded one old-shape account load with `1200` detached request timeout
  resources versus all `200` account loads, `0` pending timeout resources, and
  `1200` aborts for the route-owned shape. This proves lifecycle ownership and
  the reload guard, not a live API outcome.
- The Account Detail lifecycle patch passed focused background lifecycle
  (`30/30`), UI static (`35/35`), lint, full test, build, OpenAPI (`83
  operations`), serial gate (`12/12`), and diff checks. A temporary arm64
  package at
  `/private/tmp/hydra-package-account-detail-abort-final-modal-20260531T183457Z`
  passed
  packaged resource smoke, strict deep signature verification, and bundled
  renderer inspection. It was moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-account-detail-abort-final-modal-20260531T183457Z`;
  Spotlight continues to resolve only the canonical public app.
- An eleventh exact-public `v1.1.5` profile at
  `/private/tmp/hydra-v115-eleventh-untouched-idle-reprofile-20260531T161135Z`
  preserved two bounded perturbations while isolated packaging continued:
  first-sample Hydra CPU was `41.6%`, one packaging-time sample reached `13.0%`
  with five processes, and the other nine samples stayed between `0.0%` and
  `0.1%`. The run ended with four Hydra-owned processes, zero stale profiles,
  and RSS moving from `468.95 MiB` to `464.53 MiB` (`-4.42 MiB`). A quiet
  follow-up profile is required before treating this run as an idle baseline.
- A twelfth exact-public `v1.1.5` profile at
  `/private/tmp/hydra-v115-twelfth-untouched-idle-reprofile-20260531T161844Z`
  became a hibernate/resume profile when the host slept between
  `2026-05-31T16:21:14Z` and `2026-05-31T18:25:39Z`; `pmset -g log` confirmed
  `hibernate user wake`. Four Hydra-owned processes and zero stale profiles
  remained bounded through all 11 samples. Pre-sleep CPU stayed between
  `0.0%` and `0.2%`, the first resume sample measured `42.9%`, and subsequent
  samples returned to `0.0-0.1%`. RSS dropped from `461.38 MiB` to
  `247.06 MiB` across hibernation. This is resume evidence, not a continuous
  idle baseline; a fresh post-package profile remains required.
- A thirteenth uninterrupted exact-public `v1.1.5` post-wake idle reprofile at
  `/private/tmp/hydra-v115-thirteenth-untouched-idle-reprofile-20260531T182947Z`
  kept four Hydra-owned processes and zero stale profiles through all 11
  30-second samples after packaging stopped. CPU stayed between `0.0%` and
  `0.3%` (`0.036%` average); RSS moved from `249.00 MiB` to `261.56 MiB`
  (`+12.58 MiB`). This is the quiet post-wake baseline.
- Generator task cleanup now covers the route-exit race where
  `/generator/start` resolves after its owning screen has unmounted. The late
  task is released with keepalive cleanup, an on-screen returned task is
  claimed before React effects run, rapid Start clicks are gated, and late OTP
  responses cannot mutate a replaced screen. A 200-surface synthetic teardown
  probe at
  `/private/tmp/hydra-generator-start-unmount-benchmark-20260531T184541Z`
  recorded `400` old-shape orphan tasks after two rapid Start clicks per
  surface versus `0` owned-path orphan tasks, with `200` duplicate starts
  prevented, `200` late cleanup requests, and `200` stale writes suppressed.
  This proves renderer lifecycle ownership, not a live browser-signup outcome.
- The Generator late-start patch passed focused lifecycle (`31/31`), UI static
  (`35/35`), lint, full test, build, OpenAPI (`83 operations`), serial gate
  (`12/12`), audit (`31 ok / 5 deferred / 0 missing / 0 blockers`), and diff
  checks. A temporary arm64 package at
  `/private/tmp/hydra-package-generator-late-start-20260531T184800Z` passed
  explicit-resource package smoke, strict deep signature verification, and
  bundled renderer inspection. It moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-generator-late-start-20260531T184800Z`.
- A fourteenth uninterrupted exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-fourteenth-untouched-idle-reprofile-20260531T184117Z`
  kept four Hydra-owned processes and zero stale profiles through all 11
  30-second samples. CPU stayed between `0.0%` and `0.2%` (`0.018%` average);
  RSS stayed exactly `261.75 MiB` from first to last sample (`0 KiB` drift).
- A fifteenth uninterrupted exact-public `v1.1.5` post-package idle reprofile
  at
  `/private/tmp/hydra-v115-fifteenth-untouched-idle-reprofile-20260531T185018Z`
  kept four Hydra-owned processes and zero stale profiles through all 11
  30-second samples after the isolated Generator package build stopped.
  Sampled CPU stayed exactly `0.0%` (`0.000%` average and maximum); RSS moved
  from `261.77 MiB` to `261.73 MiB` (`-32 KiB`).
- Ordinary `/v1` proxy requests now abort active OpenRouter work when their
  client disconnects, stop before selecting another retry key, and clear
  unref'd connect/body timeout handles. SSE close handling now aborts the
  fetch controller as well as canceling the response body. A 200-client
  synthetic teardown probe at
  `/private/tmp/hydra-proxy-client-disconnect-benchmark-20260531T185826Z`
  modeled disconnects during pending upstream work. The old shape left `200`
  upstream requests and `200` timeout handles pending and could reach `600`
  attempts after failures; the owned path aborted all `200`, left `0` pending
  upstreams and timeout handles, and issued `0` retries after disconnect. This
  proves request-lifecycle ownership, not a live OpenRouter traffic outcome.
- The ordinary proxy disconnect patch passed focused background lifecycle
  (`32/32`), lint, full test, build, OpenAPI (`83 operations`), serial gate
  (`12/12`), audit (`31 ok / 5 deferred / 0 missing / 0 blockers`), and diff
  checks. A temporary arm64 package at
  `/private/tmp/hydra-package-proxy-client-disconnect-20260531T190432Z` passed
  explicit-resource package smoke, strict deep signature verification, and
  bundled proxy-source inspection, then moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-proxy-client-disconnect-20260531T190432Z`.
- A sixteenth uninterrupted exact-public `v1.1.5` idle reprofile at
  `/private/tmp/hydra-v115-sixteenth-untouched-idle-reprofile-20260531T190601Z`
  kept four Hydra-owned processes and zero stale profiles through all 11
  30-second samples. CPU stayed between `0.0%` and `0.1%` (`0.009%` average);
  RSS moved from `319.20 MiB` to `317.50 MiB` (`-1.70 MiB`). This is
  exact-public idle evidence, not packaged evidence for the pending renderer
  source changes.
- The pending renderer source pass restores the detailed three-headed dragon
  master for platform icons, app chrome, and sidebar branding; extends bounded
  proximity fields across adjacent dashboard, sidebar, and Settings actions;
  normalizes Settings card/action dimensions; and changes the splash ivy into
  segmented neuron-like branches with a lower-work `30 Hz` post-collision
  portal phase. Focused source checks passed. A rebuilt package and packaged
  visual review remain required before these source changes count as manual
  GUI evidence.
- The pending 1.3.0 source lane also restores hosted Linux x64 AppImage
  publication, makes `npm start` browser-free unless the operator explicitly
  passes `--browser`, enables Electron sandboxing globally before readiness,
  removes blocked remote-font and inline-data-favicon startup requests, names
  the existing 24-hour desktop unlock window in Settings, and gives the
  collision-free portal a decaying upward release across nine initial organic
  branches. Focused syntax, workflow (`17/17`), UI static (`38/38`), and
  Electron main-process (`29/29`) checks passed. This is source evidence until
  a rebuilt LaunchServices package passes smoke and Computer Use review.
- Dashboard account cards now layer bounded directional attraction onto the
  existing pink proximity response: nearby cards move at most `10px` on x and
  `8px` on y toward the pointer without grid reflow. This remains pending
  packaged Computer Use review with the nine-account grid.
- Native-only rebuilt-package verification for the pending `1.3.0` lane used
  normal LaunchServices `open -n`, package smoke, strict deep codesign, icon
  comparison, Spotlight uniqueness, and Computer Use. The splash capture
  visibly contained individualized falling letters, nine segmented stems, and
  the centered `Welcome, Zayd Khan` overlay. After handoff Computer Use exposed
  the `Hydra - Dashboard` native window but captured only its renderer
  background layer, so the nine-card magnetic response remains explicit
  user-facing visual acceptance. No browser harness, browser MCP, CDP port, or
  remote-debug launch was used.
- The same native launch logged finite splash diagnostics:
  `target=72`, `queueLength=72`, `shatteredWordCount=72`,
  `duplicateShatterSkips=0`, `peakDynamicBodyCount=551`,
  `portalCollisionDisabled=true`, `portalLiftApplied=true`,
  `renderFrames=408`, `physicsSteps=668`, `timers=0`, `rafActive=false`, and
  `matterCleared=true`.
- `/private/tmp/hydra-130-post-attraction-idle-20260531T124106` sampled the
  settled rebuilt package every 30 seconds for five uninterrupted minutes.
  All 11 samples retained four Hydra-owned processes and zero stale profiles.
  Nine samples read `0.0%` aggregate Hydra CPU, but samples `04` and `06`
  reported `97.1%` and `44.6%`; RSS moved from `537.41 MiB` to `622.81 MiB`.
  The tree remained bounded, but a fresh untouched reprofile is required before
  this pending package counts as calm-idle evidence.
- `/private/tmp/hydra-130-second-untouched-idle-reprofile-20260531T124730`
  then sampled the same settled rebuilt package every 30 seconds for another
  five uninterrupted minutes while the machine was otherwise left quiet. All
  11 samples retained four Hydra-owned processes and zero stale profiles.
  Aggregate Hydra CPU stayed between `0.0%` and `0.1%` (`0.018%` average);
  RSS moved from `619.48 MiB` to `622.59 MiB` (`+3.11 MiB`). This is the calm
  idle follow-up; the earlier spike run remains documented above.
- The living design guide now documents the sidebar proximity field,
  account-grid magnetic channel, Settings/action proximity groups, Anime.js
  split-text lifecycle, falling-glyph queue and one-shot shatter guard,
  collision-free portal cadence, disposal diagnostics, and reduced-motion
  contract.
- The exact-local `1.3.0` package rebuilt from a clean release output after the
  source checkpoint passed hosted CI run `26722842203` and hosted Docker run
  `26722842195`. Package smoke, strict deep codesign, restored-icon comparison,
  manifest/bundle version checks, Spotlight uniqueness, and LaunchServices
  registration passed. The superseded generated `1.1.5` local release moved
  reversibly to
  `/Users/zaydk/.Trash/hydra-pre-v130-local-release-20260531T130106`.
- `/private/tmp/hydra-130-versioned-native-launch-20260531T130322` records the
  exact-local `1.3.0` native launch: zero Hydra-owned processes before normal
  LaunchServices `open -n`, four during splash, and four after handoff. Debug
  ports `9333` and `9334` had no listeners. Computer Use captured
  individualized falling letters, nine segmented stems, centered
  `Welcome, Zayd Khan`, and visible `V1.3.0`. After handoff it exposed the
  `Hydra — Dashboard` title plus native controls but captured only the
  background layer, preserving the explicit user-facing nine-card visual
  acceptance boundary.
- Exact-local `1.3.0` splash diagnostics remained finite:
  `target=72`, `queueLength=72`, `shatteredWordCount=72`,
  `duplicateShatterSkips=0`, `peakDynamicBodyCount=551`,
  `portalCollisionDisabled=true`, `portalLiftApplied=true`,
  `renderFrames=409`, `physicsSteps=672`, `timers=0`, `rafActive=false`, and
  `matterCleared=true`. Settled doctor output reported four owned processes,
  `0.0%` CPU, `535.14 MB` RSS, and zero stale profiles.

## v1.3.0 Public Desktop Release

- Public release `v1.3.0` is live from commit
  `a00d9c298eb9d31641f80f82d95df84f16d1079d`. Auto-version run
  `26723122013`, master CI run `26723122028`, Docker run `26723122021`, and
  desktop release run `26723127043` all passed.
- The release contains macOS arm64 zip/blockmap, macOS Intel zip/blockmap,
  Windows x64 NSIS installer/blockmap, Linux x64 AppImage, Windows
  `latest.yml`, Linux `latest-linux.yml`, and merged multi-architecture
  `latest-mac.yml`. All ten downloaded public assets matched their GitHub
  SHA-256 digests. Both public macOS archives matched the SHA-512 values in the
  merged updater manifest.
- The downloaded public arm64 archive passed deep strict codesign and
  explicit-resource `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`.
  The prior source-built bundle moved reversibly to
  `/Users/zaydk/.Trash/hydra-local-mac-arm64-before-public-v130-20260531T131638`;
  the exact public bundle is now installed at
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`. Spotlight and
  LaunchServices return only that canonical bundle at version `1.3.0`.
- `/private/tmp/hydra-v130-public-native-launch-20260531T131731` records a
  normal no-debug LaunchServices launch. CoreGraphics exposed one on-screen
  `Hydra - Dashboard` window at `1440x900`; settled doctor output reported four
  owned processes, `0.0%` CPU, `604.50 MB` RSS, and zero stale profiles. No
  listener existed on debug ports `9333` or `9334`.
- The exact-public splash logged finite disposal:
  `target=72`, `queueLength=72`, `shatteredWordCount=72`,
  `duplicateShatterSkips=0`, `peakDynamicBodyCount=547`,
  `portalCollisionDisabled=true`, `portalLiftApplied=true`,
  `renderFrames=416`, `physicsSteps=668`, `timers=0`, `rafActive=false`, and
  `matterCleared=true`.
- `docs/DOGFOOD_EVIDENCE.json` was regenerated against the public `1.3.0`
  artifacts and sanitized before check-in. Only `packaged-gui-launch` is
  checked: Computer Use listed the exact-public app but could not attach to its
  CoreGraphics Dashboard window (`cgWindowNotFound`). The earlier exact-local
  Computer Use splash capture remains useful implementation evidence, but it is
  not promoted into public screenshot acceptance. Interactive screenshot
  review, account-grid magnetic-response review, full navigation, live
  OTP/redemption/proxy flows, Touch ID fingerprint approval, and real Windows
  NSIS install/open UX remain explicit manual boundaries.

## v1.3.0 Post-Closeout Profile

- `/private/tmp/hydra-v130-public-post-closeout-idle-profile-20260531T132928`
  sampled the untouched exact-public canonical package every 30 seconds for
  five minutes. All 11 samples retained four Hydra-owned processes and zero
  stale profiles. Aggregate CPU stayed between `0.0%` and `0.4%` (`0.091%`
  average), `33.2%` below the exact-public `v1.1.5` calm baseline. RSS moved
  from `604.80 MiB` to `606.66 MiB` (`+1.86 MiB`). Before/after broad process
  inventories, Hydra-owned subsets, doctor snapshots, and `summary.json` remain
  preserved locally; the Hydra-owned PID set was unchanged.
- The exact-public splash remained bounded after handoff:
  `target=72`, `queueLength=72`, `shatteredWordCount=72`,
  `duplicateShatterSkips=0`, `peakDynamicBodyCount=547`,
  `portalCollisionDisabled=true`, `portalLiftApplied=true`,
  `renderFrames=416`, `physicsSteps=668`, `timers=0`, `rafActive=false`,
  `disposed=true`, and `matterCleared=true`.
- `docs/evidence/hydra-v130-packaged-dashboard-privacy-redacted.png` came from
  native CoreGraphics enumeration plus `/usr/sbin/screencapture -l 2589`, not
  Chrome or a localhost browser. All content below the native titlebar was
  pixelated before check-in. ImageMagick reports a nonblank `3016x1936` image
  with `6443` colors; Tesseract OCR found zero credential-shaped or
  endpoint-shaped hits. This is packaged-app provenance proof only. It does not
  promote the deferred interactive route-review checkbox.

## v1.4.0 Public Desktop Release

- Public release `v1.4.0` is live from release commit
  `700999bcb0a54afa7e8f9379fb01d69c6b49e10d`. Auto-version run
  `26724119200`, master CI run `26724119194`, Docker run `26724119196`, and
  desktop release run `26724123318` passed.
- The release contains macOS arm64 zip/blockmap, macOS Intel zip/blockmap,
  Windows x64 NSIS installer/blockmap, Linux x64 AppImage, Windows
  `latest.yml`, Linux `latest-linux.yml`, and merged multi-architecture
  `latest-mac.yml`. All ten downloaded public assets matched GitHub SHA-256
  digests. Both Mac archives, the Windows installer, and the Linux AppImage
  matched their updater SHA-512 entries.
- The downloaded public arm64 archive passed deep strict codesign and
  explicit-resource `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`.
  The prior canonical app moved reversibly to Trash; the exact public bundle is
  installed at `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`.
  Spotlight returns only that canonical bundle at version `1.4.0`.
- `/private/tmp/hydra-v140-public-native-launch-20260531T140421` records a
  normal no-debug LaunchServices launch. CoreGraphics exposed one on-screen
  `Hydra — Dashboard` window at `1440x900`; no listener existed on debug ports
  `9333` or `9334`. A settled doctor snapshot reported four owned processes,
  `0.0%` CPU, `591.00 MB` RSS, and zero stale profiles.
- `docs/DOGFOOD_EVIDENCE.json` was regenerated against the public `1.4.0`
  artifacts and sanitized before check-in. Only `packaged-gui-launch` is
  checked. Interactive route review, account-grid magnetic-response review,
  live OTP/redemption/proxy flows, Touch ID fingerprint approval, and real
  Windows NSIS install/open UX remain explicit manual boundaries.
- `/private/tmp/hydra-v140-public-post-closeout-idle-profile-20260531T141703`
  sampled the untouched exact-public `v1.4.0` canonical package every 30
  seconds for five minutes. All 11 samples retained the same four Hydra-owned
  PIDs and zero stale profiles. Aggregate CPU stayed between `0.0%` and `0.1%`
  (`0.064%` average), `53.2%` below the exact-public `v1.1.5` calm public
  baseline; RSS moved from `600.36 MiB` to `593.58 MiB` (`-6.78 MiB`).
  Before/after broad process inventories, anchored Hydra-owned subsets, doctor
  snapshots, and `summary.json` remain preserved locally.
- `/private/tmp/hydra-live-session-recheck-v140-20260531T212329Z/redacted-summary.json`
  is an owner-only (`0600`) aggregate from 12 sequential production
  `store.probeSessionLive()` calls through `hydra session <id> --refresh
  --json`. All 12 probes completed without failures or decrypt errors: four
  logins remained active and redeem-ready, eight remained explicit OTP re-auth
  candidates, active cookie stacks stayed at one Clerk identity, and one
  active login remained intentionally independent of management-key state.
  The artifact contains no account identifiers or secret material.
- The post-closeout local verification chain passed `npm run lint`, full
  `npm test`, `npm run gate` (`12/12`), `npm run build`,
  `npm run openapi:hydra` (`83 operations`), `git diff --check`, strict deep
  `codesign`, corrected explicit-resource ARM package smoke against the
  already SHA-verified public zip, and `hydra audit` (`31 ok / 5 deferred /
  0 missing / 0 blockers`). Local Docker Desktop is stopped; hosted Docker run
  `26724119196` remains the current runtime-smoke and registry-push evidence.
- Evidence-checkpoint commit `dea4c5ff8969cd033084ad30c5976faba87c0b95`
  used `[skip-bump]`; Auto-version run `26724970520` skipped as intended, CI
  run `26724970519` passed, and Docker run `26724970530` passed both image push
  and hosted runtime smoke. This supersedes `26724119196` as the latest hosted
  Docker evidence.
- Local Docker Desktop was started for a fresh hardened-image pass. The first
  rebuild exposed 16 missing Chromium shared libraries and a `187.54 MB`
  context transfer. `Dockerfile` now uses `npx playwright install --with-deps
  chromium`; `.dockerignore` excludes `build/`, `videos/`, and
  `splash-previews/`; and transitive overrides pin fixed `qs@6.15.2` plus
  `tmp@0.2.7`. The uncached context fell to `361.39 kB` (`99.8%`), full and
  production npm audits report zero vulnerabilities, direct `ldd` reports no
  missing Chromium libraries, headless Playwright Chromium launches, and
  `npm run docker:smoke -- --start` returns HTTP `200` before cleaning compose
  resources.
- The Docker-hardening acceptance-item-11 rerun passed the literal ordered
  chain: lint, full tests, gate (`12/12`), explicit-resource ARM package smoke,
  local Docker smoke, and OpenAPI regeneration (`83 operations`). The
  temporary already-verified public zip symlink used by package smoke moved
  reversibly to Trash afterward.
- First Docker-hardening checkpoint `938180501985fad29b68d1ea3554130bbf65a0b4`
  used `[skip-bump]`; CI run `26725445054` passed, Auto-version run
  `26725445052` skipped, and Docker workflow run `26725445050` passed runtime
  smoke plus registry push.
- A stricter local Docker pass then removed Playwright's unused `323 MB`
  headless-shell directory and `19 MB` of apt indexes, set
  `HYDRA_PLAYWRIGHT_CHANNEL=chromium` for full-Chromium new-headless mode, and
  repaired Hydra's shared browser helper to use the supported
  `chromium.launchPersistentContext(profileDir, options)` API. The stronger
  `npm run docker:smoke` now launches that Hydra-owned isolated browser path
  before passing. Build-only smoke left no compose resources or
  `hydra_default` network; `npm run docker:smoke -- --start` launched the
  browser, started Hydra, received HTTP `200`, and tore compose down. Direct
  inspection reported no missing Chromium libraries and an image reduction
  from `1,151,831,905` to `1,021,264,136` bytes (`11.3%`).
- Trimmed Docker-browser checkpoint `c3a3636809329781e6064b2751fee3623d1dff3f`
  used `[skip-bump]`; Auto-version run `26725827316` skipped, CI run
  `26725827309` passed, and Docker workflow run `26725827291` passed runtime
  smoke plus registry image push.
