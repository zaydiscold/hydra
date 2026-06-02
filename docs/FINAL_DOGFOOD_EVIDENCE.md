# Final Dogfood Evidence

The final Hydra dogfood pass needs packaged Electron and live-account evidence
that Codex cannot safely infer from source tests. Use the checked-in preflight
to create a redacted evidence artifact after you run the real app.

Current pre-dogfood performance evidence from 2026-05-26 and 2026-05-27 is in
`docs/RELEASE_AUDIT.md`. Source and local runtime measurements currently show:

- 2026-06-02 current `v1.5.5` packaged continuous-profile pass is recorded in
  `docs/RELEASE_AUDIT.md` and preserved under
  `/private/tmp/hydra-v155-continuous-profile-20260602T140853Z`. The run started
  from zero Hydra-owned processes, launched `release/mac-arm64/Hydra.app`
  through LaunchServices, captured broad
  `ps -ax -o pid,ppid,stat,%cpu,%mem,rss,etime,command | grep -iE 'chrome|chromium|playwright|electron|hydra'`
  output before launch, during splash, after splash teardown, and after the
  five-minute idle window, and sampled `hydra doctor --json` plus `top` for the
  Hydra-owned PIDs.
- The `v1.5.5` splash sample at `t+8s` showed expected visual load (`176.9%`
  aggregate across GPU/renderer work, four Hydra-owned processes, zero stale
  Playwright profiles). The no-interaction idle window then held four
  Hydra-owned processes and zero stale Hydra Playwright profiles for all 11
  samples from `t+35s` through `t+335s`. Idle CPU ranged from `0.0%` to `0.4%`,
  averaged `0.0727%`, ended at `0.0%`, and RSS moved from `668418048` to
  `591642624` bytes (`-76775424` bytes).
- The same `v1.5.5` relaunch logged finite splash teardown:
  `timers=0`, `rafActive=false`, `bodyCount=0`, `dynamicBodyCount=0`,
  `matterCleared=true`, `target=72`, `duplicateShatterSkips=0`,
  `portalCollisionDisabled=true`, and `portalLiftApplied=true`. Renderer
  diagnostics at `loadURL-resolved+10s` reported `intervals.active=0`,
  `animationFrames.active=0`, and `animations.active=0`; the only active
  renderer timeouts were the expected owned one-shots
  `App.ambientMotion`, `App.upstreamHealth`, and `useMetrics.autoRefresh`.
- 2026-06-02 post-release `v1.5.1` packaged renderer diagnostics were rebuilt
  and profiled under
  `/private/tmp/hydra-v151-renderer-diag-20260602T111704Z`. The exact local ARM
  package passed `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`,
  strict deep codesign, plist version `1.5.1`, and embedded-source inspection
  for `[hydra-renderer] diagnostics`; zip SHA-256:
  `ac554a004d9d4fd38fd06b38a44d3c31802b8380bd71a0df712d6e2997e60583`.
  LaunchServices startup logged finite splash teardown with `timers=0`,
  `rafActive=false`, `bodyCount=0`, and `matterCleared=true`.
- The new packaged renderer diagnostics logged `intervals.active=0`,
  `animationFrames.active=0`, and `animations.active=0` at both `+2s` and
  `+10s` after main reveal. The only active renderer timers were three expected
  top-level owned one-shots: `App.ambientMotion`, `App.upstreamHealth`, and
  `useMetrics.autoRefresh`.
- The same rebuilt package stayed stable for an untouched five-minute idle
  profile: 11 samples from `2026-06-02T11:17:40Z` to
  `2026-06-02T11:22:43Z`, one four-process Hydra tree, zero stale Playwright
  profiles, CPU `0.0-0.4%`, average `0.045%`, ending `0.0%`, and RSS down
  `104,906,752` bytes. Native quit returned to zero Hydra-owned processes and
  zero profiles.
- Raw process grep artifacts for that run are preserved in the temp evidence
  directory as `ps-before-launch.txt`, `ps-after-splash-teardown.txt`,
  `ps-after-profile.txt`, and `ps-after-native-quit.txt`.
- Current `v1.5.1` packaged screenshot evidence is refreshed without browser
  substitution:
  `docs/evidence/hydra-v151-packaged-dashboard-privacy-redacted.png`. The raw
  capture came from the packaged `Hydra — Dashboard` CoreGraphics window
  (`CGWindowID 6905`) after LaunchServices startup. `/usr/sbin/screencapture -l`
  failed with `could not create image from window`, so the working native path
  used direct CoreGraphics window-image capture for the same packaged window,
  then pixelated/blurred all content below the titlebar. SHA-256:
  `bff154ff91ad5fba41f90b5c138987098fac6671043d160ec72bc3613e9f25af`.
  ImageMagick reported nonblank variance; Tesseract OCR found only harmless
  glyph noise and no email, endpoint, key, or credential-shaped text.
- Local `v1.5.6` packaged screenshot evidence now has an app-owned capture
  path for machines where macOS capture permissions block `screencapture`,
  Computer Use, or System Events:
  `docs/evidence/hydra-v156-packaged-dashboard-self-capture-redacted.png`.
  The raw private PNG was written by the packaged Electron main process through
  `webContents.capturePage()` after a LaunchServices relaunch with
  `--self-capture=/private/tmp/hydra-v156-self-capture-20260602T143316Z/hydra-v156-dashboard-raw.png`.
  The checked-in image was downscaled to `1440x900` and pixelated across the
  account/content region. SHA-256:
  `c0c4d7e415417bf00b1ff06ae66b9d35523b9f35e66754171ba3507d20c9bdd9`.
  ImageMagick reported `mean=0.0939336 stdev=0.0609961`; Tesseract OCR found
  no email, endpoint, key, session, password, or credential-shaped text.
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
- A fresh exact-public `v1.4.0` native accessibility retry reproduced the
  existing Computer Use profiling distortion: `get_app_state("com.zayd.hydra")`
  timed out after `120s`, the external `SkyComputerUseService` helper held
  `30.4%` CPU, and Hydra's main process held `69.7%` CPU while the other
  packaged helpers stayed idle. Terminating only that external helper returned
  the unchanged four-process Hydra tree to `0.0%` sampled CPU with zero stale
  profiles. Owner-only raw snapshots are under
  `/private/tmp/hydra-v140-cua-attach-retry-20260531T151812Z`.
- Native CoreGraphics enumeration then selected the exact packaged `Hydra`
  owner and captured Dashboard window `2637` without shadow or browser
  substitution. The raw account-bearing capture remains owner-only outside
  the repository. The checked-in
  `docs/evidence/hydra-v140-packaged-dashboard-privacy-redacted.png` image
  pixelates everything below the titlebar, hashes to
  `74789ea47e6a33fff972ac15a40667fe0e99af786aae9e13b3cc65cd3f92fc0f`,
  has nonzero ImageMagick variance, and returned zero Tesseract OCR matches
  for credential-shaped or endpoint-shaped text. This is packaged provenance
  proof only; interactive route review and Touch ID approval remain manual.
- Native-capture evidence checkpoint
  `8ef60095487bc6f45e3573ad52a11c8a8378ba87` used `[skip-bump]`;
  Auto-version run `26726418555` skipped, CI run `26726418554` passed, and
  Docker workflow run `26726418536` passed both runtime smoke and registry
  image push.
- A second untouched calm-runtime pass under
  `/private/tmp/hydra-v140-post-native-anchor-idle-reprofile-20260531T224017Z`
  sampled the canonical exact-public package every 30 seconds for five
  minutes after native capture. All 11 samples retained four Hydra-owned
  processes and zero stale Hydra Playwright profiles. CPU stayed between
  `0.0%` and `0.7%` (`0.082%` average, `0.0%` ending); RSS moved from
  `498.50 MiB` to `499.22 MiB` (`+0.72 MiB`). No Computer Use attach occurred
  during this pass.
- Hosted release workflow dispatch `26726712898` then exercised the real
  Windows NSIS lifecycle on `windows-2022`: unpacked `Hydra.exe` stayed alive
  for `25,000ms` and left no packaged processes; the generated
  `Hydra-1.4.0-win-x64.exe` installed silently into an isolated temporary
  directory; installed `Hydra.exe` stayed alive for `25,000ms` and left no
  packaged processes; a copied uninstaller removed the install tree with no
  residue. Because the first silent extraction needed about `102s`,
  checkpoint `e0a887b02f5da8d20c555022013396213e8732c3` bounded install at
  five minutes and uninstall at one minute.
- Timeout-bounded release dispatch `26726921936` passed Linux AppImage,
  macOS arm64 zip, macOS Intel x64 zip, and the timeout-bounded Windows x64
  NSIS lane. Its Windows log repeated unpacked startup/cleanup, silent install,
  installed-app startup/cleanup, copied-uninstaller execution, and zero-residue
  verification; final silent install completed in about `63s`. Auto-version
  run `26726917968` skipped, CI run `26726917980` passed, and Docker run
  `26726917984` passed runtime smoke plus registry push. This closes hosted
  silent NSIS lifecycle proof without claiming the still-manual interactive
  Windows installer click-through.
- A third untouched exact-public `v1.4.0` calm-runtime pass under
  `/private/tmp/hydra-v140-post-audit-parser-idle-reprofile-20260531T231558Z`
  sampled the canonical package every 30 seconds for five minutes after the
  audit parser fix. All 11 samples retained four Hydra-owned processes and
  zero stale Hydra Playwright profiles. CPU stayed between `0.0%` and `0.1%`
  (`0.009%` average, `0.0%` ending); RSS moved from `502.16 MiB` to
  `500.19 MiB` (`-1.97 MiB`). No Computer Use attach occurred.
- The exact final local acceptance-item-11 chain passed against the published
  arm64 zip after SHA-256 verification at
  `320bb60fc3400449fb9c34d4003c5afd9811337c3c9e8cf08f074921fa5e4dac`:
  `npm run lint && npm test && npm run gate &&
  HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke && npm run
  docker:smoke && npm run openapi:hydra`. Gate remained `12/12`, packaged
  smoke exercised the verified public artifact, Docker smoke rebuilt the
  production image and launched the isolated full-Chromium path, and OpenAPI
  generation retained `83 operations`. Strict deep `codesign` passed,
  `docker compose ps --all` returned no residual services, and the temporary
  public-zip symlink moved reversibly to Trash afterward. Docker Desktop was
  restored to its prior stopped state through `docker desktop stop`.
- Exact-final-chain evidence checkpoint
  `c0bce57a814b9e3cf066959f5cce68c2ea6ac198` used `[skip-bump]`;
  Auto-version run `26727636115` skipped, CI run `26727636112` passed, and
  Docker workflow run `26727636121` passed runtime smoke plus registry image
  push.
- A final exact-public `v1.4.0` Computer Use route-review retry remained
  blocked: `get_app_state("com.zayd.hydra")` timed out after `120s`, external
  `SkyComputerUseService` held `28.8%` CPU, and Hydra's otherwise-idle main
  process held `66.5%`. Terminating only the external helper returned the
  unchanged four-process Hydra tree to `0.0%` sampled CPU and zero stale
  profiles. Owner-only raw evidence, including a five-second HIServices stack
  sample and the rejected follow-up input attempt, is under
  `/private/tmp/hydra-v140-cua-route-review-retry-20260531T233933Z`.
- After recovery, native CoreGraphics enumeration selected one packaged
  Dashboard window (`CGWindowID 2637`, owner `Hydra`, title `Hydra —
  Dashboard`, bounds `1440x900 @ 36,34`). `/usr/sbin/screencapture -x -o -l
  2637` wrote an owner-only `2880x1800` Retina frame outside Git at
  `/private/tmp/hydra-v140-native-dashboard-refresh-20260531T234102Z`; its
  SHA-256 is
  `a404d421b26765396677c9d0708a3985c942ae0ab778971b0b99abb9db014036`.
  This is fresh packaged-app screenshot provenance, not a substitute for the
  remaining human route review.
- A final runtime ownership sweep found that request-log shutdown could skip
  joining an already-active buffer flush. The buffer now owns a shared
  `flushPromise`; concurrent flush and stop callers join it; a bounded timeout
  path emits a warning with remaining queued rows; and snapshots expose
  `flushInFlight`. `npm run test:request-log-buffer` passed `5/5`, including
  the active-join regression and a forced `25ms` timeout-warning regression.
  Full `npm test`, lint, Vite build, gate (`12/12`), and OpenAPI regeneration
  (`83 operations`) passed before the package rebuild.
- The current-source local arm64 package was rebuilt after that hardening.
  Package smoke and strict deep `codesign` passed; packaged-source inspection
  confirmed the new request-log ownership code. The rebuilt local
  `Hydra-1.4.0-mac-arm64.zip` hashes to
  `192ab474457a1bd25cabc113e9b81982959a3161cfc644f81df7844ae53049f8`.
  It is current-source local evidence, not the published `v1.4.0` release
  artifact. LaunchServices launch evidence is under
  `/private/tmp/hydra-v140-request-log-current-source-launch-20260531T235242Z`.
- `/private/tmp/hydra-v140-request-log-post-rebuild-idle-reprofile-20260531T235339Z`
  sampled the untouched rebuilt package every 30 seconds for five minutes.
  All 11 samples retained four Hydra-owned processes and zero stale Hydra
  Playwright profiles. CPU stayed between `0.0%` and `2.4%` (`0.227%`
  average, `0.0%` ending), including the first startup-settling sample; RSS
  moved from `590.58 MiB` to `591.83 MiB` (`+1.25 MiB`). The post-sampler
  doctor snapshot remained calm at four processes, `0.0%` CPU, `592.25 MB`
  RSS, and zero stale profiles. No Computer Use helper remained, Docker
  Desktop remained stopped, and a targeted Desktop search found only
  `release/mac-arm64/Hydra.app`.
- The request-log-hardening literal final acceptance chain passed:
  `npm run lint && npm test && npm run gate &&
  HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke && npm run
  docker:smoke && npm run openapi:hydra`. Gate remained `12/12`, package smoke
  exercised the rebuilt local arm64 app and zip, Docker smoke rebuilt the
  production image and launched Hydra's isolated full-Chromium persistent
  context, and OpenAPI generation retained `83 operations`. Strict deep
  `codesign` passed, `docker compose ps --all` returned no services, no
  `hydra_default` network remained, and Docker Desktop was restored to its
  stopped state through `docker desktop stop`.
- Request-log-hardening checkpoint
  `fb4a3be7a811e439ecf859c1c096bb30504494c5` used `[skip-bump]`;
  Auto-version run `26728333080` skipped, CI run `26728333078` passed, and
  Docker workflow run `26728333077` passed both runtime smoke and registry
  image push.
- A post-cleanup untouched exact-local baseline under
  `/private/tmp/hydra-v140-post-cleanup-idle-reprofile-20260601T001229Z`
  retained four packaged processes and zero stale Hydra Playwright profiles
  across 11 samples over five minutes. CPU stayed between `0.0%` and `0.3%`
  (`0.036%` average, `0.0%` ending); RSS moved from `474.34 MiB` to
  `479.52 MiB` (`+5.17 MiB`).
- The next ownership sweep found that `rotationManager.cancelReload()` could
  discard its dedupe promise before a non-abortable Prisma-backed pool reload
  finished unwinding, while graceful shutdown did not await cancellation. The
  manager now owns a coalesced reload promise, aborts stale work for one fresh
  rerun, joins cold-load and reload promises during cancellation, and logs
  non-abort unwind failures. Shutdown awaits that join before continuing.
  Direct rotation-manager regressions passed `3/3`; background visibility
  contracts passed `32/32`; lint, full test, build, gate (`12/12`), OpenAPI
  generation (`83 operations`), and diff check passed before packaging.
- The pre-rebuild package quit natively in one second with broad before/after
  inventories under
  `/private/tmp/hydra-v140-rotation-rebuild-shutdown-20260601T001750Z`. The
  current-source local arm64 package rebuilt successfully; package smoke,
  strict deep `codesign`, bundle-version inspection, and embedded-source
  inspection passed. The local zip checksum is
  `5843e00514abc9932ddeb3dba83cc37a5bdcc618ae10eaac935608aa6dd372fc`;
  it is current-source local evidence, not a new published artifact.
  LaunchServices handoff evidence is under
  `/private/tmp/hydra-v140-rotation-current-source-launch-20260601T001924Z`.
- The first post-rebuild untouched profile under
  `/private/tmp/hydra-v140-rotation-post-rebuild-idle-reprofile-20260601T002013Z`
  retained four processes and zero stale profiles across 11 samples while
  launch settling moved from `4.5%` to `0.9%` CPU (`1.0%` average) and RSS
  dropped `24.25 MiB`. A short stack sample under
  `/private/tmp/hydra-v140-rotation-hot-split-20260601T002143Z` found the main
  process predominantly parked in `CFRunLoop`/`mach_msg`, not spinning in JS
  or HIServices. A denser settled follow-up under
  `/private/tmp/hydra-v140-rotation-dense-idle-20260601T002536Z` then captured
  12 samples at `0.0...0.2%` CPU (`0.025%` average, `0.0%` ending), with four
  processes and zero stale profiles throughout.
- The rotation-pool-hardening final local chain passed in literal order:
  lint, full `npm test`, serial gate (`12/12`), ARM package smoke, Docker
  smoke against the rebuilt production image with the isolated full-Chromium
  persistent-context path, and OpenAPI generation (`83 operations`). A final
  strict deep `codesign` passed. `docker compose ps --all` returned no
  services, no `hydra_default` network remained, and Docker Desktop stopped
  cleanly in one second.
- Rotation-pool-hardening checkpoint
  `924e55186bda95eec7a6746814b4f85374cef581` used `[skip-bump]`;
  Auto-version run `26729047216` skipped, CI run `26729047218` passed, and
  Docker workflow run `26729047213` passed both runtime smoke and registry
  image push.
- The final post-cleanup closed-app audit sweep repaired two release-truth
  parser bugs: the local-archive fallback no longer hard-codes `v1.1.0`, and
  the documented Docker-checkpoint matcher now tolerates Markdown whitespace
  throughout `registry image push`. `hydra audit` derives the recorded public
  release from current package metadata and requires recorded macOS arm64,
  macOS Intel, and Windows artifact groups. Focused CLI verification passed
  `46/46`; lint, full `npm test`, gate (`12/12`), OpenAPI generation (`83
  operations`), and diff check passed. Closed-app audit remains `31 ok / 5
  deferred / 0 missing / 0 blockers`, with public `v1.4.0` ARM evidence and
  newest recorded Docker run `26729047213`.
- Release-audit truth-hardening checkpoint
  `8c7293c59d1898272ff14ec7cb8b834c39158007` used `[skip-bump]`;
  Auto-version run `26729401085` skipped, CI run `26729401072` passed, and
  Docker workflow run `26729401071` passed both runtime smoke and registry
  image push.
- `hydra audit` now reports macOS ARM, macOS Intel, Intel-current, and Windows
  NSIS artifacts from recorded public `v1.4.0` release-matrix proof instead of
  allowing Intel-current to rest on historical `v1.0.7` CI evidence. README
  release-train copy now separates the first `v1.1.0` performance tranche from
  the current refined `v1.4.0` desktop release and active `1.4.x` lane.
  Focused CLI verification passed `46/46`; README has no Remotion matches.
- A quiet post-fix profile under
  `/private/tmp/hydra-v140-post-audit-current-artifacts-quiet-idle-20260601T005910Z`
  sampled the untouched packaged app every 30 seconds for five minutes with no
  concurrent local tests or git activity. All 11 samples retained four
  Hydra-owned processes and zero stale profiles. CPU stayed exactly `0.000%`
  throughout; RSS moved from `499952 KiB` to `500864 KiB` (`+912 KiB`).
  Broad before/after process inventories are preserved in that directory.
- The current-release audit final local chain used the exact public
  `Hydra-1.4.0-mac-arm64.zip`; its GitHub-published and downloaded SHA-256
  digests matched at
  `320bb60fc3400449fb9c34d4003c5afd9811337c3c9e8cf08f074921fa5e4dac`.
  Lint, full `npm test`, gate (`12/12`), ARM package smoke, Docker smoke with
  a rebuilt production image and successful isolated full-Chromium launch,
  and OpenAPI generation (`83 operations`) passed in literal order. Strict
  deep `codesign` passed afterward. `docker compose ps --all` returned no
  services, no `hydra_default` network remained, and Docker Desktop stopped
  cleanly in one second. The temporary public-package symlink and downloaded
  smoke inputs were moved reversibly to Trash; `release/` again contains only
  `mac-arm64/Hydra.app`.
- Current-release artifact-proof checkpoint
  `51fff07eff4500dee848f74036de94749df6f277` used `[skip-bump]`;
  Auto-version run `26730026832` skipped, CI run `26730026830` passed, and
  Docker workflow run `26730026837` passed both runtime smoke and registry
  image push.
- The Docker audit predicate now requires both the original full
  compose-start baseline and at least one newer recorded Docker workflow
  checkpoint before `docker-runtime` can pass; the newest parsed checkpoint
  remains visible in the evidence string. Syntax validation, CLI verification
  (`46/46`), closed-app audit (`31 ok / 5 deferred / 0 missing / 0 blockers`),
  and diff check passed. The complete no-Docker source chain then passed:
  lint, full `npm test`, gate (`12/12`), OpenAPI generation (`83 operations`),
  and diff check.
- Docker-audit-predicate checkpoint
  `81989ec6766c1d82f464d99905b521dea03728ea` used `[skip-bump]`;
  Auto-version run `26730171287` skipped, CI run `26730171273` passed, and
  Docker workflow run `26730171272` passed both runtime smoke and registry
  image push. GitHub's remaining Node 20 action-runtime warning belongs to the
  current upstream Docker helper actions, which GitHub forced onto Node 24;
  the Hydra-owned workflow remains green.
- Multi-proxy selector verification now has deterministic two-entry proof.
  Production still uses `randomBytes(4)` for each new task route; the new
  selector boundary lets the regression prove entropy values ending in `0`
  and `1` select both stored proxies, rejects short entropy, and keeps an
  empty pool valid. Focused proxy tests passed `5/5`, background visibility
  contracts passed `32/32`, CLI tests passed `46/46`, and the full no-Docker
  source chain passed lint, full `npm test`, Vite build, gate (`12/12`),
  OpenAPI generation (`83 operations`), and diff check.
- Broad shutdown inventories for the pre-rebuild package are preserved under
  `/private/tmp/hydra-v140-proxy-selector-rebuild-shutdown-20260531T183049Z`.
  Native quit removed all packaged Hydra-owned processes in two seconds.
  Current-source arm64 package rebuild, package smoke, strict deep `codesign`,
  bundle version (`1.4.0`), and embedded-selector inspection passed. The local
  zip SHA-256 is
  `5e9eaa8927814110a601582c3f083377ce0652dfb899795ada1f1b8cfc7f322c`;
  it is local rebuild proof, not a new public artifact. LaunchServices relaunch
  evidence is under
  `/private/tmp/hydra-v140-proxy-selector-current-source-launch-20260531T183234Z`.
  Generated packaging byproducts were moved reversibly to Trash; `release/`
  again contains only `mac-arm64/Hydra.app`.
- The untouched post-rebuild profile under
  `/private/tmp/hydra-v140-proxy-selector-post-rebuild-quiet-idle-20260531T183255Z`
  sampled the rebuilt package every 30 seconds for five minutes after a
  30-second splash-settle window. All 11 samples retained four Hydra-owned
  processes and zero active Hydra Playwright profiles. CPU stayed between
  `0.000%` and `0.700%` (`0.073%` average, `0.000%` ending); RSS moved from
  `632720 KiB` to `608544 KiB` (`-24176 KiB`).
- The multi-proxy selector final literal local chain passed lint, full
  `npm test`, gate (`12/12`), ARM package smoke, Docker smoke with a rebuilt
  production image and successful isolated full-Chromium Playwright launch,
  OpenAPI generation (`83 operations`), and diff check in order. Strict deep
  `codesign` passed afterward. Package smoke consumed reversible symlinks to
  the current-source local zip and blockmap already retained in Trash; the
  temporary links were then moved reversibly to
  `~/.Trash/hydra-proxy-selector-final-smoke-link-20260601T014406Z` and
  `~/.Trash/hydra-proxy-selector-final-smoke-blockmap-link-20260601T014406Z`.
  Compose retained no services or `hydra_default` network, Docker Desktop
  stopped cleanly in one second, `release/` again contains only
  `mac-arm64/Hydra.app`, and Spotlight resolves exactly that one installed
  Hydra bundle.
- Multi-proxy selector checkpoint
  `a17067108bc0802a9bf259736b3698a55d380190` used `[skip-bump]`;
  Auto-version run `26730889924` skipped, CI run `26730889905` passed, and
  Docker workflow run `26730889927` passed both runtime smoke and registry
  image push. GitHub's remaining Node 20 action-runtime warning belongs to the
  current upstream Docker helper actions, which GitHub forced onto Node 24;
  the Hydra-owned workflow remains green.
- Before detached-batch cancellation hardening, an untouched five-minute
  packaged profile under
  `/private/tmp/hydra-v140-continuation-idle-reprofile-20260601T015213Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles.
  Aggregate CPU ended calm at `0.000%` but included one `23.300%` transient;
  the follow-up stack sample found the main process parked in
  `CFRunLoop`/`mach_msg`, while the simultaneous doctor snapshot recorded
  `186` externally owned browser-tool processes at `290.6%` aggregate CPU.
- The shared batch runner now owns abort-aware, unref'd inter-chunk delays and
  stops future work after client disconnect or supervisor cancellation.
  Account import, OTP stubs, provisioning, bulk redemption, matrix redemption,
  the dashboard bulk runner, and renderer request helpers thread the signals.
  Raw bulk-redemption codes are no longer retained in task metadata. Direct
  regressions passed `5/5`, and the deterministic canceled-work benchmark at
  `/private/tmp/hydra-batch-disconnect-benchmark-20260601T020048Z/summary.txt`
  reduced `200` post-disconnect worker chunks to `0`, aborting all `200`
  synthetic surfaces and settling in `7.247ms` instead of `102.030ms`.
- Native shutdown inventories are under
  `/private/tmp/hydra-v140-batch-abort-rebuild-shutdown-20260601T020334Z`;
  four packaged processes exited in one second. The current-source arm64 app
  rebuilt successfully and passed ARM package smoke, strict deep `codesign`,
  bundle-version inspection (`1.4.0`), and embedded abort-wiring inspection.
  The local zip SHA-256 is
  `8bb94844319f96edecabd94059139e28c9508aafa326ed7f6476e174684c4700`.
  LaunchServices relaunch evidence is under
  `/private/tmp/hydra-v140-batch-abort-current-source-launch-20260601T020511Z`.
  Packaging byproducts were moved reversibly to
  `~/.Trash/hydra-batch-abort-current-source-package-20260601T021151Z`;
  `release/` again contains only `mac-arm64/Hydra.app`.
- The rebuilt untouched package profile under
  `/private/tmp/hydra-v140-batch-abort-post-rebuild-quiet-idle-20260601T020610Z`
  retained four packaged processes across 11 samples over five minutes.
  Aggregate Hydra CPU stayed exactly `0.000%`; RSS moved from `603520 KiB` to
  `609472 KiB` (`+5952 KiB`). The broad sampler matcher counted its own shell
  once; authoritative `hydra doctor --json` reported zero Hydra Playwright
  profiles.
- The detached-batch final literal local chain passed lint, full `npm test`,
  gate (`12/12`), ARM package smoke, Docker smoke with a rebuilt production
  image and successful isolated full-Chromium Playwright launch, OpenAPI
  generation (`83 operations`), and diff check in order. Strict deep
  `codesign` passed afterward. Compose retained no services or
  `hydra_default` network; evidence is under
  `/private/tmp/hydra-v140-batch-abort-docker-postconditions-20260601T021656Z`.
  Docker Desktop stopped cleanly in one second. Temporary package-smoke
  symlinks moved reversibly to
  `~/.Trash/hydra-batch-abort-final-smoke-links-20260601T021709Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly that one Hydra bundle, and the rebuilt package remains live with
  four owned processes.
- Detached-batch cancellation checkpoint
  `219ae795501614b7040b63b8502b7d2135367111` used `[skip-bump]`;
  Auto-version run `26731750366` skipped, CI run `26731750346` passed, and
  Docker workflow run `26731750318` passed both runtime smoke and registry
  image push. GitHub's remaining Node 20 action-runtime warning belongs to the
  current upstream Docker helper actions, which GitHub forced onto Node 24;
  the Hydra-owned workflow remains green.
- Request-owned upstream work now shares abort ownership across OpenRouter
  retries, Clerk auth, dashboard JWT repair, account generation,
  management-key provisioning, code redemption, diagnostic probes,
  model-list refresh, proxy fallback, Playwright context cleanup, and the
  session refresher's active pass. The benchmark under
  `/private/tmp/hydra-openrouter-disconnect-benchmark-20260531T195305/summary.txt`
  reduced `200` post-disconnect retries to `0`, reduced fetches from `400` to
  `200`, aborted all `200` synthetic surfaces, and reduced settlement from
  `525.428ms` to `16.496ms`.
- Native shutdown evidence is under
  `/private/tmp/hydra-v140-request-ownership-rebuild-shutdown-20260531T195438`;
  four packaged processes exited immediately. The ARM package rebuilt and
  passed package smoke, strict deep `codesign`, and bundle version (`1.4.0`).
  The local zip SHA-256 is
  `c3700c1a52d44f9a2638c1f71ce0114aeccc030f8eb0d23f0ee96aa454a98844`.
  LaunchServices relaunch evidence is under
  `/private/tmp/hydra-v140-request-ownership-current-source-launch-20260531T195645`.
  Generated package byproducts moved reversibly to
  `~/.Trash/hydra-request-ownership-current-source-package-20260531T200313`;
  `release/` again contains only `mac-arm64/Hydra.app`, and Spotlight resolves
  exactly that one Hydra bundle.
- The settled short profile under
  `/private/tmp/hydra-v140-request-ownership-post-rebuild-quiet-idle-20260531T195735`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across 11 samples. CPU averaged `0.436%` and ended at `0.000%`; RSS moved
  from `635088 KiB` to `604096 KiB` (`-30992 KiB`). `hydra doctor --json`
  independently recorded four owned processes at `0%` CPU and zero Hydra
  Playwright profiles. Its reported external browser-tool load remains
  separately owned and is not attributed to Hydra.
- The signal-aware source change exposed a stale audit matcher for the proxy
  pool evidence row. The repaired predicate and CLI regression return the
  closed-app audit to `31 ok / 5 deferred / 0 missing / 0 blockers` with
  `complete=false`.
- Request-ownership checkpoint
  `fced9d6443cb852a8d1229c7289f7b81a75477b7` used `[skip-bump]`;
  Auto-version run `26732648111` skipped, CI run `26732648116` passed, and
  Docker workflow run `26732648112` passed both runtime smoke and registry
  image push.
- Shared health probes now bind renderer disconnects without breaking
  deduplication: abandoned callers reject immediately, the shared OpenRouter
  fetch stays alive while any subscriber remains, and the final subscriber
  owns upstream abort. The benchmark under
  `/private/tmp/hydra-health-probe-disconnect-benchmark-20260601T031358Z/summary.txt`
  reduced detached settlement from `503.711ms` to `23.931ms` for `200`
  abandoned surfaces.
- Settings Diagnostics now aborts superseded and unmounted health/proxy
  requests and suppresses late native bridge writes after navigation. The
  benchmark under
  `/private/tmp/hydra-diagnostics-unmount-benchmark-20260601T032542Z/summary.txt`
  reduced `400` pending requests to `0`, aborted all `400`, and suppressed
  `200` stale page writes.
- The rebuilt Diagnostics package exposed a separate recurring compositor
  wakeup honestly recorded under
  `/private/tmp/hydra-v140-diagnostics-post-rebuild-idle-20260601T033118Z`:
  four Hydra processes and zero Hydra Playwright profiles remained stable,
  but CPU averaged `6.818%` and ended at `9.400%`. Routine 30-second
  background health refreshes were mounting the animated foreground progress
  bar. The app now uses a quiet health helper for that background path while
  foreground requests retain loading feedback. The unused `.edm-bar`
  infinite-animation rule was removed.
- The loading-event benchmark under
  `/private/tmp/hydra-background-health-loading-benchmark-20260601T033914Z/summary.txt`
  removes `400` loading events and `200` animated progress mounts across
  `200` background polls.
- Quiet-health shutdown evidence is under
  `/private/tmp/hydra-v140-quiet-health-rebuild-shutdown-20260601T034025Z`;
  four package processes exited immediately. Current-source ARM rebuild,
  package smoke, strict deep `codesign`, bundle version (`1.4.0`), embedded
  source-map inspection, and LaunchServices relaunch passed. The local zip
  SHA-256 was
  `f4bead3fafecd3c3f45ddd4d27783579f78ef479d0028155934e65521f80231b`.
  Launch evidence is under
  `/private/tmp/hydra-v140-quiet-health-current-source-launch-20260601T034214Z`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-quiet-health-current-source-package-20260601T034844Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly that one bundle, and local Docker is stopped.
- The final untouched profile under
  `/private/tmp/hydra-v140-quiet-health-post-rebuild-idle-20260601T034327Z`
  retained four Hydra processes and zero Hydra Playwright profiles across 11
  five-minute samples. CPU ranged from `0.000%` to `0.100%`, averaged
  `0.009%`, and ended at `0.000%`; RSS moved from `605104 KiB` to
  `607424 KiB` (`+2320 KiB`).
- Checkpoints `2348d0268fd9957d2243d665be07c54fdf378d70`,
  `a7376c66803833d58e95ef256a55d7bbc5f0d24e`, and
  `e583326c89f35da0d8f30a81fc4d16625395546c` used `[skip-bump]`.
  The newest CI run `26733857394` passed, and Docker workflow
  `26733857387` passed runtime smoke and registry image push.
- Passive observer loading is now quiet across scheduled dashboard, pool
  sync, traffic, vault, cached session-status, magic-link, generator, and
  Code Redeemer reconciliation paths. Explicit operator actions retain
  foreground loading feedback. The deterministic benchmark under
  `/private/tmp/hydra-passive-observer-loading-benchmark-20260601T035300Z/summary.json`
  removes `5600` global loading events across `200` modeled cycles per
  observer class while preserving the foreground default.
- Native shutdown evidence is under
  `/private/tmp/hydra-v140-passive-observer-rebuild-shutdown-20260601T040100Z`;
  four package processes exited in one second. Current-source ARM rebuild,
  package smoke, strict deep `codesign`, bundle version (`1.4.0`), embedded
  source-map inspection, and LaunchServices relaunch passed. The local ARM
  zip SHA-256 was
  `e2fa276b3610dc83a648904d681077b37b6c64b8cabcb7b520bb8d215f48bbe1`.
  Launch evidence is under
  `/private/tmp/hydra-v140-passive-observer-current-source-launch-20260601T040400Z`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-passive-observer-current-source-package-20260601T040400Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly that one Hydra application bundle, and local Docker is stopped.
- The final untouched package profile under
  `/private/tmp/hydra-v140-passive-observer-post-rebuild-idle-20260601T040500Z`
  retained four Hydra processes and zero Hydra Playwright profiles across 11
  five-minute samples. CPU ranged from `0.000%` to `0.300%`, averaged
  `0.027%`, and ended at `0.000%`; RSS moved from `634976 KiB` to
  `603984 KiB` (`-30992 KiB`).
- Passive-observer checkpoint `ceeeb5da21a13244dae3ea035cbdad53059e350b`
  used `[skip-bump]`; Auto-version run `26734396984` skipped, CI run
  `26734396983` passed, and Docker workflow `26734396980` passed runtime
  smoke and registry image push. The quiet-helper update exposed stale
  closed-app audit matchers; the corrected predicate and CLI regression
  restore `31 ok / 5 deferred / 0 missing / 0 blockers` with
  `complete=false`.
- After audit/docs checkpoint `9d5db1c6a7b4c470460e59d8d18fb9d1863f5b88`,
  the ARM package rebuilt once more from the final desktop payload and passed
  package smoke, strict deep `codesign`, bundle version (`1.4.0`), and
  embedded renderer map inspection. The final local ARM zip SHA-256 was
  `d568d3394737b7dd541de1148e99f74efa3bf6163980b2ae5c1b09b59e648cea`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-passive-observer-final-package-20260601T041500Z`.
  Launch evidence is under
  `/private/tmp/hydra-v140-passive-observer-final-launch-20260601T041500Z`:
  `0 -> 4` processes in three seconds, then four processes at `0.0%` CPU and
  zero Hydra Playwright profiles after settling. Packaged `docs/` and `bin/`
  are intentionally excluded, so this documentation-only note does not stale
  the desktop payload.
- Audit/docs checkpoint `9d5db1c6a7b4c470460e59d8d18fb9d1863f5b88`
  used `[skip-bump]`; Auto-version run `26734703372` skipped, CI run
  `26734703373` passed, and Docker workflow `26734703374` passed runtime
  smoke and registry image push.
- Persistent offline and restart-required recovery frames now settle to a
  completed static meter instead of sweeping forever. Normal loading states
  keep the indeterminate meter. The benchmark under
  `/private/tmp/hydra-recovery-frame-animation-benchmark-20260601T042618Z`
  records `2 -> 0` persistent recovery-meter animations while preserving the
  loading cue; UI static contracts passed `41/41`.
- Native shutdown evidence is under
  `/private/tmp/hydra-v140-recovery-frame-rebuild-shutdown-20260601T042730Z`;
  four package processes exited immediately. The current-source ARM package
  rebuilt and passed package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), and embedded renderer CSS inspection. The local ARM zip SHA-256
  was
  `873f89009841808a761ceb276de34e8471eceb024d5e1a2c2191718dcbbf4641`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-recovery-frame-package-20260601T042948Z`; `release/` again
  contains only `mac-arm64/Hydra.app`, Spotlight resolves exactly one Hydra
  bundle, and Docker is stopped.
- The untouched rebuilt-package profile under
  `/private/tmp/hydra-v140-recovery-frame-idle-reprofile-20260601T043139Z`
  retained four Hydra-owned processes and zero Hydra Playwright profiles
  across 11 five-minute samples. CPU ranged from `0.000%` to `0.100%`,
  averaged `0.009%`, and ended at `0.000%`; RSS moved from `606336 KiB` to
  `610896 KiB` (`+4560 KiB`).
- Rebuilt-package inspection verified the Touch ID bridge, fail-closed token
  gate, native macOS prompt path, Settings controls, and 24-hour password
  token wording. The focused desktop isolation chain passed `28/28`.
  Hardware approval remains manual: a post-baseline Computer Use retry again
  timed out after `120s`, left external `SkyComputerUseService` at `28.9%`
  CPU, and drove Hydra's main process to `67.3%` through HIServices
  accessibility enumeration. Terminating only the external helper restored
  the unchanged four-process app immediately to `0.0%` CPU with zero stale
  profiles. Raw owner-only evidence is under
  `/private/tmp/hydra-v140-recovery-frame-cua-retry-20260601T043921Z`.
- Recovery-frame checkpoint `4f87073cfeee4be4406763270c00659004cbe3df`
  used `[skip-bump]`; Auto-version run `26735571431` skipped, CI run
  `26735571409` passed, and Docker workflow `26735571435` passed runtime
  smoke and registry image push.
- Offline, restart-required, and shutdown fallback frames no longer allocate
  permanently hidden glyph spans. The benchmark under
  `/private/tmp/hydra-hidden-fallback-glyph-benchmark-20260601T045446616Z/summary.json`
  records default fallback hidden nodes `34 -> 0` and compact fallback hidden
  nodes `18 -> 0`; the separate real Electron splash remains unchanged at its
  bounded `72`-word target. UI static contracts now pass `42/42`.
- Native shutdown evidence is under
  `/private/tmp/hydra-v140-hidden-glyph-rebuild-shutdown-20260601T045550Z`;
  four package processes exited immediately. The current-source ARM package
  rebuilt and passed package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), packaged renderer inspection for the absent hidden-glyph path,
  and packaged splash inspection for the retained target. The local ARM zip
  SHA-256 was
  `cba6300b961fe2aded319a0e015a7a45986f165e9f910915720f2ab0f88cc1a0`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-hidden-fallback-glyph-package-20260601T045724Z`;
  `release/` again contains only `mac-arm64/Hydra.app`.
- The untouched rebuilt-package profile under
  `/private/tmp/hydra-v140-hidden-glyph-post-rebuild-idle-20260601T050012Z`
  retained four Hydra-owned processes and zero stale profiles across 11
  five-minute samples. CPU ranged from `0.000%` to `4.100%`, averaged
  `1.655%`, and ended at `1.000%`; RSS changed by `+4368 KiB`. The structural
  DOM cleanup is not presented as an idle-CPU reduction. Short transient
  attribution is under
  `/private/tmp/hydra-v140-hidden-glyph-transient-attribution-20260601T050202Z`,
  and an idle-dominant eight-second main-process sample is under
  `/private/tmp/hydra-v140-hidden-glyph-main-stack-20260601T050302Z`. The
  follow-up sweep found a separate empty-task `TaskSupervisor` expiry wakeup
  to remove in the next code checkpoint.
- Hidden fallback-glyph checkpoint
  `4d370181e93b11bfa4408a80dc236e455840cb28` used `[skip-bump]`;
  Auto-version run `26736288813` skipped, CI run `26736288818` passed, and
  Docker workflow `26736288832` passed runtime smoke and registry image push.
- `TaskSupervisor` expiry scheduling is now demand-driven. Idle startup no
  longer arms the 30-second task-expiry timeout; task registration arms it;
  archiving the final active task clears it; shutdown still clears the timer
  and waits for an active sweep. The benchmark under
  `/private/tmp/hydra-task-supervisor-demand-driven-benchmark-20260601T050815Z/summary.json`
  records empty-task wakeups per hour `120 -> 0` while preserving active-task
  expiry cadence. The recon note is
  `docs/recon/TASK_SUPERVISOR_IDLE_SCHEDULER.md`. Focused lifecycle tests
  passed `4/4`, background visibility contracts passed `32/32`, and the
  complete source chain passed before rebuild.
- Native shutdown evidence is under
  `/private/tmp/hydra-v140-task-supervisor-rebuild-shutdown-20260601T050928Z`;
  four package processes exited immediately. The current-source ARM package
  rebuilt and passed package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), embedded demand-driven scheduler inspection, packaged
  hidden-glyph absence, and retained splash target. The local ARM zip SHA-256
  was
  `df686f29f2f482383841e2ffe05bb64bae73c952d99e08afc49c996ce330fd0b`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-task-supervisor-package-20260601T051122Z`; `release/` again
  contains only `mac-arm64/Hydra.app`, Spotlight resolves exactly one Hydra
  bundle, and Docker Desktop remains stopped.
- LaunchServices evidence under
  `/private/tmp/hydra-v140-task-supervisor-current-source-launch-20260601T051136Z`
  records four settled processes at `0.100%` CPU, zero stale profiles, and no
  Computer Use helper by 35 seconds. Splash teardown stayed finite with
  `72/72` shuffled words, zero duplicate skips, collision-free lifted portal
  entry, timers `0`, inactive RAF, and cleared Matter state. The untouched
  rebuilt-package profile under
  `/private/tmp/hydra-v140-task-supervisor-post-rebuild-idle-20260601T051236Z`
  retained four Hydra-owned processes and zero stale profiles across 11
  five-minute samples. CPU ranged from `0.000%` to `0.100%`, averaged
  `0.009%`, and ended at `0.000%`; RSS changed by `-3296 KiB`.
- Task-scheduler checkpoint
  `b1577fd2938848fd292b6945c064fb3fff4bd91b` used `[skip-bump]`;
  Auto-version run `26736665665` skipped, CI run `26736665670` passed, and
  Docker workflow `26736665671` passed runtime smoke and registry image push.
- Request-log retention now avoids both SQLite delete paths while its table is
  empty, avoids age deletion while the oldest row is fresh, and avoids cap
  deletion while the table stays below `KEEP_COUNT`. Both inspected local
  databases held zero request logs. The benchmark under
  `/private/tmp/hydra-request-log-retention-empty-table-benchmark-20260601T051408Z/summary.json`
  records idle writes `2 -> 0` and 20,000 empty cycles
  `159.386ms -> 28.574ms` (`82.1%` lower elapsed time). The recon note is
  `docs/recon/REQUEST_LOG_RETENTION_IDLE_GUARD.md`. Focused retention tests
  passed `4/4`, background visibility contracts passed `32/32`, and the
  complete source chain passed before rebuild.
- Native shutdown evidence is under
  `/private/tmp/hydra-v140-request-log-retention-rebuild-shutdown-20260601T052441Z`;
  four package processes exited immediately. The current-source ARM package
  rebuilt and passed package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), embedded retention-guard inspection, packaged hidden-glyph
  absence, and retained splash target. The local ARM zip SHA-256 was
  `a257f62ba968eb8f9f48bd62f734aab19a42a66a6e7dcec36c6be19af62495fc`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-request-log-retention-package-20260601T052618Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly one Hydra bundle, and Docker Desktop remains stopped.
- LaunchServices evidence under
  `/private/tmp/hydra-v140-request-log-retention-current-source-launch-20260601T052630Z`
  records four settled processes at `0.000%` CPU, zero stale profiles, and no
  Computer Use helper by 35 seconds. Splash teardown stayed finite with
  `72/72` shuffled words, zero duplicate skips, collision-free lifted portal
  entry, timers `0`, inactive RAF, and cleared Matter state.
- The untouched rebuilt-package profile under
  `/private/tmp/hydra-v140-request-log-retention-post-rebuild-idle-20260601T052729Z`
  retained four Hydra-owned processes and zero stale profiles across 11
  five-minute samples. CPU ranged from `0.000%` to `0.700%`, averaged
  `0.064%`, and ended at `0.000%`; RSS changed by `+4848 KiB`.
- Request-log retention checkpoint
  `6f2fc6d40b39d3c364ea294caec91ef002ba8c41` used `[skip-bump]`;
  Auto-version run `26737110121` skipped, CI run `26737110128` passed, and
  Docker workflow `26737110126` passed runtime smoke and registry image push.
- OpenRouter background health checks are now demand-driven while the pooled
  key set is empty. Rotation-manager reload, drop, and eviction publish pool
  replacements; pinger startup subscribes; first-key arrival rearms the
  delayed probe; final-key removal disarms it; shutdown unsubscribes. The
  production DB held `13` stored keys and `0` active pooled keys. The
  lifecycle benchmark under
  `/private/tmp/hydra-health-pinger-empty-pool-benchmark-20260601T053640Z/summary.json`
  records empty-pool wakeups per hour `12 -> 0` while preserving delayed
  probing when keys exist. The recon note is
  `docs/recon/EMPTY_POOL_HEALTH_PINGER_SCHEDULER.md`. Focused pinger tests
  passed `4/4`, rotation-manager tests passed `4/4`, background contracts
  passed `32/32`, and the complete source chain passed before rebuild.
- Native shutdown evidence is under
  `/private/tmp/hydra-v140-empty-pool-health-pinger-rebuild-shutdown-20260601T053814Z`;
  four package processes exited immediately. The current-source ARM package
  rebuilt and passed package smoke, strict deep `codesign`, bundle version
  (`1.4.0`), embedded pinger guard, rotation notifier, retained retention
  guard, and retained splash target. The local ARM zip SHA-256 was
  `b7e3aebc871f1ad2e3b74882a4ac662a783cca49d24a28d9e590c41d33dbfe6f`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-empty-pool-health-pinger-package-20260601T053957Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly one Hydra bundle, and Docker Desktop remains stopped.
- LaunchServices evidence under
  `/private/tmp/hydra-v140-empty-pool-health-pinger-current-source-launch-20260601T054009Z`
  records four settled processes at `0.000%` CPU, zero stale profiles, and no
  Computer Use helper by 35 seconds. Splash teardown stayed finite with
  `72/72` shuffled words, zero duplicate skips, collision-free lifted portal
  entry, timers `0`, inactive RAF, and cleared Matter state.
- The untouched rebuilt-package profile under
  `/private/tmp/hydra-v140-empty-pool-health-pinger-post-rebuild-idle-20260601T054117Z`
  retained four Hydra-owned processes and zero stale profiles across 11
  five-minute samples. CPU ranged from `0.000%` to `0.300%`, averaged
  `0.027%`, and ended at `0.300%`; RSS changed by `+4512 KiB`.
- The Node module-mock harness now uses current `exports` and
  `exports.default` options throughout. Deprecated `namedExports` and
  `defaultExport` occurrences dropped `68 -> 0` across `13` test files; the
  shared test-chain completeness suite now recursively rejects either stale
  spelling across `server/tests`, `electron/tests`, and `scripts`. The focused
  completeness suite passed `2/2`; the complete source chain then passed full
  `npm test`, lint, build, integration gate (`12/12`), OpenAPI generation
  (`83 operations`), dogfood preflight, audit, and diff check. Affected
  module-mock suites retain only Node's expected experimental-module warning.
  The recon note is `docs/recon/NODE_MOCK_MODULE_OPTIONS_MIGRATION.md`.
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
- Auto-version run `26738144380` created immutable tag `v1.4.1`, but Release
  Desktop Apps run `26738151871` stopped in shared `test:ci` before packaging.
  The audit remained honest: current-version Intel artifact evidence was
  missing because no `v1.4.1` artifact had uploaded yet. The CLI regression now
  permits historical hosted package-smoke evidence during the pre-publication
  gate while continuing to require recorded current public evidence after
  publication. The repaired artifact-parity tranche advances as `v1.4.2`.
- Release-bootstrap repair checkpoint
  `5857ff4ce330fec3016862fc1390e4ce9eabd1f1` used `[skip-bump]`;
  Auto-version run `26738319746` skipped, CI run `26738319743` passed, and
  Docker workflow run `26738319737` passed runtime smoke and registry image
  push.
- Public artifact-parity patch `v1.4.2` published on 2026-06-01 from immutable
  release commit `ff63fdd6ef49509e8ed0b44c07aac0b0fc2e4b95`. Auto-version run
  `26738561372`, CI run `26738561386`, Docker workflow run `26738561364`, and
  Release Desktop Apps run `26738568988` passed. The release matrix published
  Linux x64 AppImage, macOS arm64 zip, macOS Intel zip, Windows x64 NSIS,
  platform blockmaps, Linux and Windows updater metadata, and merged
  dual-architecture macOS updater metadata. Live asset inspection found all
  ten expected public files with GitHub SHA-256 digests; downloaded updater
  manifests report `1.4.2` and reference the expected platform artifacts.
- The downloaded exact-public `Hydra-1.4.2-mac-arm64.zip` SHA-256 is
  `243ad57e19bc2b6e8d25511443f79bd71fb1e41aecbbcd64f29478deeabecfe7`,
  matching GitHub. Its SHA-512 matches `latest-mac.yml`. The extracted app
  reports `1.4.2` and passed strict deep `codesign` plus explicit-resource
  package smoke. Native quit removed the stale local `1.4.0` package before it
  moved reversibly to
  `~/.Trash/hydra-local-v140-replaced-20260601T063234Z/Hydra.app`; the exact
  public `1.4.2` package now occupies the canonical path. A LaunchServices
  relaunch settled to four Hydra-owned processes at `0.1%` aggregate CPU and
  `618.70 MB` RSS with zero Hydra Playwright profiles. Spotlight resolves
  exactly the canonical bundle and `release/` contains only
  `mac-arm64/Hydra.app`.
- The untouched exact-public `v1.4.2` baseline under
  `/private/tmp/hydra-v142-public-fresh-idle-20260601T.msrEg0` retained four
  Hydra-owned processes and zero Hydra Playwright profiles across 11
  five-minute samples. CPU ranged from `0.000%` to `0.500%`, averaged
  `0.100%`, and ended at `0.000%`; RSS changed by `+2992 KiB`.
- Request-log retention is now demand-driven after an empty startup prune.
  Buffered non-stream logging and direct SSE placeholder logging rearm the
  existing 15-minute cadence when work appears; retained rows preserve cleanup
  scheduling; shutdown still clears and joins active work. Production
  inspection found `0` request-log rows. Deterministic lifecycle evidence
  under
  `/private/tmp/hydra-request-log-retention-demand-scheduler-20260601T.KJsakO/summary.json`
  records empty-table recurring wakeups per hour `4 -> 0`, activity rearming,
  and shutdown clearing. The recon note is
  `docs/recon/REQUEST_LOG_RETENTION_DEMAND_SCHEDULER.md`. Focused retention
  tests passed `8/8`, buffer tests passed `5/5`, background contracts passed
  `32/32`, and the complete source chain passed.
- Native quit evidence under
  `/private/tmp/hydra-v142-retention-demand-rebuild-shutdown-20260601T.1DlSuZ`
  records four prior exact-public processes exiting. The prior bundle moved
  reversibly to
  `~/.Trash/hydra-public-v142-before-retention-demand-20260601T064759Z`.
  Current-source ARM rebuild, smoke, strict deep `codesign`, bundle version
  (`1.4.2`), embedded notifier inspection, packaged renderer presence, and
  retained splash target passed. The local zip SHA-256 was
  `80dbd0ddbf08a32d39926b7fa3190d114e20de09af41f0142d0bc7438c248329`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-retention-demand-package-20260601T064937Z`.
- LaunchServices evidence under
  `/private/tmp/hydra-v142-retention-demand-current-source-launch-20260601T.VRmXux`
  records four settled processes at `0.000%` CPU and zero profiles by 35
  seconds. Splash teardown stayed finite with `72/72` shuffled words, zero
  duplicate skips, collision-free lifted portal entry, timers `0`, inactive
  RAF, and cleared Matter state. The untouched rebuilt-package profile under
  `/private/tmp/hydra-v142-retention-demand-post-rebuild-idle-20260601T.ijYy3n`
  retained four processes and zero profiles across 11 samples: CPU peaked at
  `4.600%` in sample `00`, remained `0.000%` for all ten later samples, and
  ended at `0.000%`; RSS changed by `+4912 KiB`.
- Request-log retention scheduler checkpoint
  `c0a8c27f5ac5f754d695d04fb8f90c7f5d849d8b` used `[skip-bump]`;
  Auto-version run `26740075092` skipped, CI run `26740075081` passed, and
  Docker workflow run `26740075047` passed runtime smoke plus registry image
  push.
- The CLI audit now requires the demand-driven request-log worker's empty-table
  disarm and both traffic-driven notifier paths. `npm run test:cli` passed
  `46/46` after this source-contract hardening.
- Native quit evidence under
  `/private/tmp/hydra-v142-audit-retention-contract-rebuild-shutdown-20260601T.swVAL6`
  records the four prior package processes exiting. ARM rebuild, smoke, strict
  deep `codesign`, bundle version (`1.4.2`), and embedded production notifier
  inspection passed. The local zip SHA-256 was
  `33db71e47bf19cd92f04a2140f6d695e68930b3d8fc9b020721ebcdb28d9b769`.
  Generated byproducts moved reversibly to
  `~/.Trash/hydra-audit-retention-contract-package-20260601T070443Z`.
- LaunchServices evidence under
  `/private/tmp/hydra-v142-audit-retention-contract-launch-20260601T.Qkdbo7`
  records one canonical Spotlight bundle, four settled Hydra-owned processes
  at `0.000%` CPU and `593.34 MB` RSS, and zero Hydra Playwright profiles.
  Splash teardown again reports `72/72` shuffled words, zero duplicate skips,
  collision-free lifted portal entry, timers `0`, inactive RAF, and cleared
  Matter state. The immediately preceding five-minute profile remains the
  relevant idle-runtime evidence because this pass only tightens the
  repository audit contract.
- Session-refresh dead-cookie pruning now stores an empty Clerk device-cookie
  stack after the six-hour worker proves all identities dead. The
  metadata-only write preserves the stored session token and does not stamp a
  false silent-renewal time. Forced live probes and automation refreshes also
  use the shared identity-aware pruning helper after fallback success.
  Deterministic `npm run test:session-refresher-pruning` evidence records
  future retries `25 -> 0`; focused session, background, cancellation,
  chain-completeness, CLI, lint, audit, and diff checks passed. The recon note
  is `docs/recon/SESSION_REFRESH_DEAD_COOKIE_PRUNING.md`.
- Session-pruning current-source ARM package proof: native quit evidence under
  `/private/tmp/hydra-v142-session-pruning-rebuild-shutdown-20260601T.ZrqqTS`
  records all four prior package processes exiting. ARM rebuild, package
  smoke, strict deep `codesign`, bundle version (`1.4.2`), and embedded
  production source inspection passed. The local zip SHA-256 was
  `08ac0a0d8e5ed2cde472e409062a40d9d02cd2fa9e2d164be681e3c1369a08a3`.
  Generated byproducts moved reversibly to
  `~/.Trash/hydra-session-pruning-package-20260601T071712Z`.
- Session-pruning LaunchServices and soak proof:
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
- Touch ID unlock-token order refinement for `v1.4.3`: source inspection and
  contracts now require native token presence and expiry validation before a
  biometric prompt can appear. Expected operator behavior is explicit: Touch
  ID prompts once per relaunch only while a valid 24-hour saved token exists;
  missing, expired, unavailable, or cancelled paths fall back to password.
  Focused verification passed `test:electron-ipc-contract` (`5/5`),
  `test:electron-main-process` (`29/29`), `test:ui-static` (`42/42`), and
  `test:cli` (`46/46`). Hardware approval remains a user-run manual boundary.
- Packaged lifecycle hardening for `v1.4.3`: LaunchServices dogfood found a
  zero-code voluntary app exit with no crash report and no source-level
  breadcrumb. Follow-up tracing showed the file log stream closed on
  `before-quit`, hiding shutdown evidence. The app now keeps the log stream
  open until `will-quit`, records app/window/IPC/process lifecycle sources, and
  starts one ref'd one-minute lifecycle keepalive in the lock-holder process so
  packaged Hydra cannot exit just because idle timers are unref'd. Temporary
  no-biometric comparison evidence lives under
  `/private/tmp/hydra-v143-no-biometric-soak-20260601T.UZsfzO` and
  `/private/tmp/hydra-v143-instrumented-exit-trace-20260601T.bVyT25`.
  Focused contracts passed `test:electron-main-process` (`29/29`) and
  `test:ui-static` (`42/42`). The recon note is
  `docs/recon/ELECTRON_LIFECYCLE_KEEPALIVE_AND_QUIT_TRACING.md`.
- Post-release lifecycle keepalive refinement: the lock-holder still retains a
  ref'd Node-side hold so the packaged app cannot fall out of the event loop,
  but `electron/main.js` now renews one 24-hour timeout instead of waking a
  no-op interval every minute. A deterministic one-day scheduler comparison
  records `1440 -> 1` keepalive wakeups (`-1439`, `99.931%` reduction).
  `npm run test:electron-main-process` passed `31/31`, including the contract
  that rejects a recurring keepalive interval. The rebuilt ARM package passed
  package smoke, strict deep codesign, and embedded-source hash equality.
  Native LaunchServices evidence under
  `/private/tmp/hydra-v147-keepalive-timeout-launch-20260601T234132Z`
  records one `keepalive-started` line with `renewMs=86400000`, splash CPU
  decay `226.9% -> 1.5% -> 0.0%`, bounded `72/72` teardown, timers `0`,
  inactive RAF, and cleared Matter state. The untouched rebuilt-package profile
  under
  `/private/tmp/hydra-v147-keepalive-timeout-idle-profile-20260601T234217Z`
  retained four Hydra-owned processes and zero stale profiles across all 11
  samples: CPU stayed `0.0-0.1%`, averaged `0.036%`, and ended at `0.0%`; RSS
  moved `617644032 -> 607289344` bytes (`-10354688`).
  The same source checkpoint passed lint, full `npm test`, gate (`12/12`),
  rebuilt ARM package smoke, strict deep codesign, OpenAPI regeneration (`84`
  operations, no drift), and local Docker smoke with a real containerized
  Playwright Chromium launch. `docker desktop stop` removed Docker Desktop
  runtime helpers in one second; no `hydra_default` network remained.
- Magic-link cleanup early-disarm follow-up: callback completion now
  recalculates the demand-driven expiry timer instead of leaving a 15-minute
  timeout armed after the final pending link is forgotten. The deterministic
  benchmark under
  `/private/tmp/hydra-magic-link-cleanup-early-disarm-20260601T235215Z`
  records `scheduled=false -> true -> false` across idle, tracked-link, and
  early-completion states, avoiding one residual wakeup. Real Express API
  integration passed `11/11`, background ownership contracts passed `33/33`,
  and lint passed. The rebuilt ARM package passed smoke, strict deep codesign,
  and embedded-source hash equality. LaunchServices evidence under
  `/private/tmp/hydra-v147-magic-link-early-disarm-launch-20260601T235711Z`
  records one canonical Spotlight app, four owned processes, zero stale
  profiles, bounded splash teardown, and CPU decay
  `97.9% -> 173.8% -> 4.1%` across launch, `+15s`, and `+30s`. The untouched
  rebuilt-package profile under
  `/private/tmp/hydra-v147-magic-link-early-disarm-idle-profile-20260601T235802Z`
  retained four owned processes and zero stale profiles across 11 samples:
  CPU stayed `0.0-0.2%`, averaged `0.027%`, and ended at `0.0%`; RSS moved
  `648937472 -> 533970944` bytes (`-114966528`). The final literal chain
  passed lint, full `npm test`, gate (`12/12`), OpenAPI regeneration (`84`
  operations, no tracked drift), diff hygiene, audit, and local Docker smoke
  with a real containerized Playwright Chromium launch. Teardown left no
  `hydra_default` network and `docker desktop stop` removed the Desktop
  runtime in one second. The durable note is
  `docs/recon/MAGIC_LINK_CLEANUP_TIMER_OWNERSHIP.md`.
- Proximity-field geometry-cache follow-up: the tracked-RAF pointer field now
  snapshots target geometry once per pointer pass and invalidates only on
  viewport resize, field resize, child-list changes, leave, or unmount. This
  removes repeated `getBoundingClientRect()` layout reads after compositor
  transforms change while preserving the existing account-grid attraction,
  sidebar nudge, Settings groups, and reduced-motion bypass. The deterministic
  nine-card benchmark under
  `/private/tmp/hydra-proximity-geometry-cache-20260602T001207Z` reduces
  geometry reads from `1080 -> 9` across 120 pointer frames (`-1071`,
  `99.167%`). UI static contracts passed `46/46`, lint passed, build passed,
  diff hygiene passed, and audit remains
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
- OpenRouter Email Link owner-boundary follow-up: current Clerk documentation,
  live machine state, and Hydra's callback contract were rechecked before
  attempting any relay setup. OpenRouter owns the Clerk tenant, so Hydra users
  cannot add a callback allowlist entry; a generic Cloudflare or Tailscale
  tunnel would still be rejected and would expose unnecessary ingress. No
  tunnel was started and no `.env` opt-in was forged. The Bulk Import tab now
  says `Owner-only; use OTP`, the backend error says Email Link cannot be
  self-enabled for OpenRouter accounts, and `.env.example` reserves the relay
  variables for a genuinely owner-controlled Clerk tenant. The broad
  `.env.*` ignore rule now explicitly unignores that placeholder-only template
  so the operator guidance ships with the repo. Focused UI
  contracts passed `46/46`, API integration passed `11/11`, background
  contracts passed `33/33`, lint passed, build passed, and diff hygiene passed.
  The rebuilt ARM package passed smoke, strict deep codesign, and embedded
  Bulk Import renderer hash equality. Its local archive SHA-256 before
  reversible cleanup was
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
- Close-to-background release blocker for `v1.4.3`: the controlled background
  soak under
  `/private/tmp/hydra-v143-final-controlled-background-soak-20260601T.9yB5Ve`
  proved the remaining app disappearance was the normal window-close modal
  selecting `Quit Hydra`, not a crash. Normal close is now background-only,
  logs `close-kept-running-in-background`, hides the macOS Dock icon, destroys
  the renderer to free Chromium memory, and leaves full shutdown to explicit
  tray/menu/sidebar Quit actions. `test:electron-main-process` now includes a
  regression contract for no close-modal quit path and passed `30/30`.
- Final `v1.4.3` local package proof: native baseline had zero Hydra-owned
  processes and zero stale profiles, the prior local bundle moved reversibly to
  `~/.Trash/hydra-v143-before-close-background-rebuild-20260601T085913Z`, and
  the rebuilt ARM package passed `HYDRA_BUILD_TARGET=darwin-arm64 npm run
  electron:smoke`, strict deep `codesign`, bundle version `1.4.3`, and embedded
  source inspection for the Touch ID token-order gate, explicit reauth cookie
  stack reset, metadata-only session writes, lifecycle keepalive, and
  close-to-background marker. The local ARM zip SHA-256 before byproduct cleanup
  was `e6411adac7db1586ff49548bd45e6c2e694eb5797e195e616ac93da259ea1b7a`.
  Generated archive byproducts moved reversibly to
  `~/.Trash/hydra-v143-final-package-byproducts-20260601T090057Z`; `release/`
  again contains only `mac-arm64/Hydra.app`.
- Final `v1.4.3` LaunchServices soak:
  `/private/tmp/hydra-v143-final-close-background-launch-20260601T.Mb2rht`
  records the rebuilt package launched through `open -n` and staying at exactly
  four Hydra-owned processes for all 11 samples over the five-minute idle
  window, with zero Hydra Playwright profiles. CPU ranged `0.0-6.8%`, averaged
  `0.8%`, and ended at `0.0%`; RSS changed by `-183943168` bytes. The final
  splash diagnostics reported the bounded 16-second splash, 72 queued/shattered
  words, zero duplicate shatter skips, timers `0`, inactive RAF, collision-free
  lifted portal entry, and cleared Matter state. The final log window contains
  no new close-dialog quit path after the rebuilt launch.
- Public `v1.4.3` release publication: GitHub release
  `https://github.com/zaydiscold/hydra/releases/tag/v1.4.3` was published on
  2026-06-01 with all ten expected release assets: macOS arm64 zip/blockmap,
  macOS Intel zip/blockmap, Windows NSIS/blockmap, Linux x64 AppImage,
  `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`. Release Desktop Apps
  run `26745761313` passed shared lint/test/gate, package smoke on every
  desktop target, the hosted Windows unpacked and NSIS-installed executable
  lifecycle check, artifact uploads, and macOS updater metadata merge. CI run
  `26745750087`, Docker workflow run `26745750037`, and Auto-version run
  `26745750077` also completed successfully.
- Post-release `v1.4.3` closeout verification: docs closeout commit
  `92b159adc233ee3a7fe8231f40129d77f627a45f` kept version `1.4.3` and used
  `[skip-bump]`; Auto-version run `26746458475` skipped, CI run `26746458503`
  passed, and Docker workflow run `26746458547` passed both `Build & Push` and
  `Runtime Smoke`. A fresh read-only five-minute profile of the already-running
  packaged app under
  `/private/tmp/hydra-v143-post-release-readonly-profile-20260601T092809Z`
  retained four Hydra-owned processes and zero stale profiles across all 11
  samples. CPU ranged `0.0-0.2%`, averaged `0.036%`, and ended at `0.0%`; RSS
  moved from `482131968` to `485949440` bytes (`+3817472`). Strict deep
  `codesign` still passed for `release/mac-arm64/Hydra.app`, and the bundle
  reports `1.4.3`. Manual packaged GUI, live-flow, screenshot, Touch ID hardware,
  and real Windows UX dogfood boundaries remain explicit.
- `v1.4.4` Bulk Auth package proof: the canonical local macOS ARM package was
  rebuilt from the Bulk Auth redirect/dedupe patch and relaunched through
  LaunchServices. `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`,
  strict deep codesign, bundle version `1.4.4`, and embedded source inspection
  all passed. The launched package exposes the new
  `/api/accounts/magic-link/capability` server route and the renderer bundle
  contains the `Public callback`, `direct HTTPS code import`, `Force replace
  matching saved emails`, and `Use OTP or configure a public callback` UI copy.
  A settled process snapshot after splash reported the expected four Hydra-owned
  processes with low aggregate CPU. The local ARM zip SHA-256 before cleanup was
  `eaca25ec73182672456b0fe09c1031e0a4f5b8200efad648b7e9fa7014a6310f`.
- Public `v1.4.4` release publication: GitHub release
  `https://github.com/zaydiscold/hydra/releases/tag/v1.4.4` was published on
  2026-06-01 from commit `bb0dda874853502732769982f83fc941c3fd0168`.
  Auto-version run `26769595632`, CI run `26769595644`, Docker workflow run
  `26769595972`, and Release Desktop Apps run `26769608095` all passed. The
  public release contains macOS arm64 zip/blockmap, macOS Intel zip/blockmap,
  Windows NSIS/blockmap, Linux x64 AppImage, merged `latest-mac.yml`, Windows
  `latest.yml`, and Linux `latest-linux.yml`; the release workflow also passed
  the hosted Windows unpacked and NSIS-installed executable lifecycle check plus
  the final macOS updater metadata merge.
- `v1.4.6` callback hardening source proof: Hydra no longer advertises a generic
  public tunnel as an OpenRouter Email Link fix. Clerk callback enablement
  requires both a public HTTPS relay and explicit tenant-owner allowlist
  confirmation; the OpenRouter desktop lane remains Bulk OTP over direct HTTPS.
  The dormant compatible-tenant callback path now sends a pre-generated opaque
  `linkId`, keeps Clerk and account identifiers server-side, atomically claims
  the callback, and clears its callback and renderer-poll indexes together.
  Dynamic API integration coverage
  proves paired cleanup on both expiry and successful completion. The tracked
  OpenAPI callback contract now exposes only `linkId`.
- `v1.4.5` Bulk Auth UI gate proof: the local package was rebuilt from the
  Email Link capability-banner patch. The Email Link tab now surfaces
  `magicLinkCapability`, offers `Recheck`, and disables `Send Magic Links` with
  `Use OTP or configure callback` when the server reports the callback cannot
  work. Focused verification passed UI static `44/44`, background visibility
  `33/33`, API integration `9/9`, lint, gate `12/12`, and CLI `46/46`.
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, strict deep
  codesign, bundle version `1.4.5`, and embedded renderer inspection all
  passed. LaunchServices opened the rebuilt local app, and the five-minute
  idle sample in
  `/private/tmp/hydra-1.4.5-bulk-auth-idle-20260601T172922Z` recorded the
  expected four Hydra-owned processes, `0.0%` aggregate CPU across all 11
  samples, RSS `519.64 MB -> 520.83 MB`, and no stale Hydra Playwright
  profiles in the settled post-launch doctor snapshot.
- Public `v1.4.5` release publication: GitHub release
  `https://github.com/zaydiscold/hydra/releases/tag/v1.4.5` was published on
  2026-06-01 from commit `fdb725cf1c421f787a0aba1b0ba78090d8b79316`.
  Auto-version run `26771322922`, CI run `26771322926`, Docker workflow run
  `26771322892`, and Release Desktop Apps run `26771336388` all passed. The
  public release contains macOS arm64 zip/blockmap, macOS Intel zip/blockmap,
  Windows NSIS/blockmap, Linux x64 AppImage, merged `latest-mac.yml`, Windows
  `latest.yml`, and Linux `latest-linux.yml`; the release workflow also passed
  the hosted Windows unpacked and NSIS-installed executable lifecycle check plus
  the final macOS updater metadata merge.
- Final `v1.4.6` local package proof: the canonical macOS ARM bundle rebuilt
  from the faceted splash-overlay, Touch ID bootstrap, and Email Link
  truthfulness patch. Full `npm run test:ci`, lint, gate `12/12`, CLI `46/46`,
  dogfood-evidence `1/1`, package smoke, strict deep codesign, bundle version
  `1.4.6`, and embedded-source inspection all passed. The embedded compatible-
  tenant Email Link path contains the explicit tenant-owner allowlist gate,
  random opaque callback `linkId`, and atomic one-time callback claim. The local
  ARM zip SHA-256 before reversible cleanup was
  `6947a5134ef02a508c84195580a94ec5377e42dfbb480f62dc7193aec16f0482`.
  LaunchServices opened the packaged app without a browser; CoreGraphics saw
  one `Hydra — Dashboard` window at `1440x900`. After startup settled,
  `hydra doctor` reported the expected four Hydra-owned processes, `0.4%`
  aggregate CPU, `600.50 MB` RSS, and zero stale Hydra Playwright profiles.
- Public `v1.4.6` release publication: GitHub release
  `https://github.com/zaydiscold/hydra/releases/tag/v1.4.6` was published on
  2026-06-01 from commit `3bffb18239e666c486574928fd240ab496f53870`.
  Auto-version run `26778835765`, CI run `26778835658`, Docker workflow run
  `26778835668`, and Release Desktop Apps run `26778847890` all passed. The
  public release contains macOS arm64 zip/blockmap, macOS Intel zip/blockmap,
  Windows NSIS/blockmap, Linux x64 AppImage, merged `latest-mac.yml`, Windows
  `latest.yml`, and Linux `latest-linux.yml`; the downloaded macOS updater
  metadata lists both architectures. The release workflow also passed the
  hosted Windows unpacked and NSIS-installed executable lifecycle check.
- Post-release cleanup-workflow proof: commit `7257498` makes an empty
  stale-branch sweep succeed when only protected `master` remains. Manual
  stale-branch-cleanup dispatch `26778878591`, closeout CI run `26778879503`,
  and closeout Docker workflow run `26778879520` passed.
- Post-release `v1.4.6` read-only runtime and Search cleanup proof:
  `/private/tmp/hydra-v146-post-release-readonly-idle-lwlq2dbC` sampled the
  already-running canonical package 11 times across `394` seconds with a
  minimum `30`-second pause plus native `top` collection. The same four
  Hydra-owned processes and zero stale profiles remained present throughout;
  aggregate CPU stayed `0.0-0.1%`, averaged `0.009%`, and ended at `0.0%`;
  RSS moved `474.31 MB -> 487.17 MB`. Broad before/after process inventories,
  per-sample doctor JSON, full `ps`, native `top`, and `summary.json` remain
  under the profile directory. Follow-up local cleanup unregistered eight
  stale LaunchServices records for historical `~/.Trash` bundles,
  force-registered the canonical `1.4.6` app, and left both LaunchServices
  and Spotlight resolving only
  `/Users/zaydk/Desktop/hydra/release/mac-arm64/Hydra.app`. No bundle or Trash
  backup was deleted.
- Conservative public-`v1.4.6` dogfood manifest refresh: all six versioned
  desktop artifacts were downloaded from the public GitHub release and
  matched GitHub SHA-256 digests before
  `docs/DOGFOOD_EVIDENCE.json` was regenerated. The checked-in manifest is
  sanitized and asserts only `packaged-gui-launch`: LaunchServices opened the
  canonical app without a browser, CoreGraphics saw one `Hydra — Dashboard`
  window at `1440x900`, Spotlight resolved only the canonical bundle, strict
  deep codesign passed, and the settled doctor snapshot reported four
  Hydra-owned processes, zero stale profiles, and `0.0%` aggregate CPU. The
  manifest deliberately leaves window controls, splash/unlock review, route
  navigation, Touch ID fingerprint approval, live account flows, screenshot
  review, and interactive Windows launch unchecked. Closed-app audit remains
  `31 ok / 5 deferred / 0 missing / 0 blockers`.
- `v1.4.7` Account Detail binding repair: packaged Electron dogfood reproduced
  a renderer-only live-session warning while CLI refresh and the direct
  embedded HTTP session-check route both returned a live active session. React
  click events were being forwarded as AbortSignals by direct callback
  bindings. The repair uses explicit zero-argument wrappers for live-session,
  snapshot, and management-key refresh actions and locks all ten affected
  Account Detail call sites with a renderer static contract.
- Public `v1.4.7` release publication: GitHub release
  `https://github.com/zaydiscold/hydra/releases/tag/v1.4.7` was published on
  2026-06-01 from commit `d7fb68fab49c075f830bc65a36f336c291aefe4d`.
  Auto-version run `26782109972`, CI run `26782110073`, Docker workflow run
  `26782109931`, and Release Desktop Apps run `26782121839` passed. The public
  release contains all ten expected Linux, macOS ARM, macOS Intel, Windows, and
  updater-metadata assets; merged `latest-mac.yml` lists both architectures.
- Exact-public-`v1.4.7` local package proof: the downloaded public ARM zip
  matched GitHub SHA-256
  `0d4ea5946c547a8d9cfb0df578e41d1850fe95dbb903346f41f3de94b79989c1`.
  Its extracted app is the sole canonical `release/mac-arm64/Hydra.app`,
  reports `1.4.7`, passes strict deep codesign and ARM package smoke, and
  settled before Computer Use attachment to four Hydra-owned processes,
  `0.2%` aggregate CPU, and zero stale profiles. Computer Use verified the
  public package's live Clerk probe, management-key reload, and account
  snapshot/API-key refresh actions. Spotlight resolves only the canonical app.
  Hardware Touch ID approval, full live OTP/redemption/proxy flows, redacted
  screenshot review, and interactive Windows desktop UX remain manual.
- Exact-public-`v1.4.7` untouched idle profile:
  `/private/tmp/hydra-v147-public-post-closeout-idle-profile-20260601T213205Z`
  records a native LaunchServices `4 -> 0 -> 4` lifecycle without Computer
  Use attachment. Splash work decayed from `124.6%` aggregate Hydra CPU at
  `t+5s` to `57.1%` at `t+20s` and `0.0%` at `t+35s`. The following 11
  samples at 30-second intervals retained the same four settled PIDs and zero
  stale Hydra Playwright profiles. Idle CPU stayed exactly `0.0%`; RSS moved
  from `655867904` to `626966528` bytes (`-28901376`). Owner-aware doctor
  snapshots record unrelated browser-tool pressure separately.
- Exact-public-`v1.4.7` final local item-11 chain: commit
  `0be26982601b2b533fc64badd228ced10baef0f8` passed `npm run lint`, full
  `npm test`, gate, exact-public ARM package smoke, real local Docker image
  build plus Hydra-owned isolated full-Chromium launch, and OpenAPI generation
  (`84 operations`) in the required order. The public ARM archive matched
  GitHub SHA-256
  `0d4ea5946c547a8d9cfb0df578e41d1850fe95dbb903346f41f3de94b79989c1`.
  Compose retained no services or `hydra_default` network afterward. The
  downloaded archive workspace and smoke log moved reversibly to
  `~/.Trash/hydra-v147-final-local-chain-20260601T215008Z`, Docker Desktop
  returned to its prior stopped state, and the documentation-reconciled
  successor repeated the same literal chain before push.
- Exact-public-`v1.4.7` packaged native-accessibility retry: Computer Use
  attachment timed out after `120s` twice and left external
  `SkyComputerUseService` helpers alive. Hydra's unchanged four-PID tree
  recovered `68.8% -> 0.0%` and `67.5% -> 0.0%` after terminating only those
  external helpers; stale Hydra Playwright profiles stayed at zero. Native
  CoreGraphics captured the packaged `Hydra - Dashboard` window without
  browser tooling. The private raw image moved reversibly to
  `~/.Trash/hydra-v147-private-native-capture-20260601T220405Z`. A redacted
  structural derivative remains under
  `/private/tmp/hydra-v147-cua-timeout-recovery-20260601T220102Z`, SHA-256
  `cbd66508eb94e9a58016ebb82dace2b26c472ea695939a307508ce21de603de6`,
  `3016x1936`, `413` colors, nonzero variance, and no Vision OCR text.
  Interactive route review, screenshot approval, and physical Touch ID remain
  manual.
- Exact-public-`v1.4.7` post-relay-docs runtime recheck:
  `/private/tmp/hydra-v147-post-relay-docs-fresh-profile-20260601T222048Z`
  records a second native LaunchServices `4 -> 0 -> 4` lifecycle against the
  sole canonical public ARM bundle, with no Computer Use or browser attachment.
  Splash CPU decayed `130.9% -> 60.5% -> 0.0%` at `t+5s`, `t+20s`, and
  `t+35s`. Eleven following samples at 30-second intervals retained exactly
  four Hydra-owned processes and zero stale profiles. Idle CPU ranged
  `0.0-0.6%`, averaged `0.109%`, and ended at `0.0%`; RSS moved
  `658194432 -> 629342208` bytes (`-28852224`). Raw doctor JSON,
  owned-process TSVs, broad process inventories, and Spotlight resolution
  before and after the run remain under the profile directory.
- Exact-public-`v1.4.7` native screenshot refresh:
  `/private/tmp/hydra-v147-native-screenshot-refresh-20260601T223151Z`
  records a CoreGraphics-only LaunchServices `4 -> 0 -> 4` lifecycle with no
  browser, accessibility, or Computer Use attachment. Packaged splash window
  `4033` and replacement Dashboard window `4036` were captured through
  `/usr/sbin/screencapture -x -o -l <CGWindowID>`. The checked-in splash image
  hashes to
  `3a608664fffde2b2976be1e1aacd9ca445056997854411396472c25f13b350fd`.
  The checked-in Dashboard proof pixelates every pixel below the native
  titlebar and hashes to
  `c655726b575915159731242ebed34df96407f38b4cd6fb1a6c8e50750ed229e2`.
  Vision and Tesseract reported zero secret-shaped or endpoint-shaped hits,
  ImageMagick reported nonblank variance for both safe artifacts, and the
  private raws moved reversibly to
  `~/.Trash/hydra-v147-private-native-screenshot-refresh-20260601T223151Z`.
  Interactive human visual review remains manual.
- Exact-public-`v1.4.7` Touch ID metadata recheck: owner-only local inspection
  confirmed `0600` preferences and renderer-token files,
  `biometricEnabled=true`, a present non-empty saved token, and an unexpired
  `2026-06-02T08:00:41.726Z` deadline with `33853` seconds remaining at
  observation time. Typed log aggregation found `40` historical prompt
  denials, all `BIOMETRIC_CANCELLED`, with zero persisted-token read failures,
  zero validation failures, and zero failed clear records. This is expected
  fail-closed evidence: a valid token prompts once per relaunch while
  cancellation intentionally leaves password visible. Successful fingerprint
  approval and release of the saved token remain a user-run hardware boundary.
- Bulk OTP guidance follow-up: `src/utils/auth.js` no longer recommends Email
  Link generically after `email_code` or strategy failures. The hint now tells
  operators to check the account sign-in method and use Email Link only when
  its capability banner says ready. The adjacent rate-limit hint grammar was
  corrected and locked as well. Focused verification passed real Express
  integration (`10/10`), renderer/static plus cancellation contracts
  (`89/89`), lint, build, and diff hygiene. The conservative post-fix profile
  under `/private/tmp/hydra-v147-post-bulk-guidance-profile-20260601T224033Z`
  sampled the still-installed exact-public `v1.4.7` package 11 times:
  four owned processes, zero stale profiles, `0.0-0.4%` CPU (`0.036%`
  average, `0.0%` end), and `621101056 -> 523845632` bytes RSS
  (`-97255424`). This records running-package no-regression evidence without
  claiming that the copy-only source patch has shipped. A second read-only
  follow-up profile after the adjacent grammar lock retained four processes
  and zero stale profiles across 11 more samples at `0.0-0.4%` CPU (`0.073%`
  average, `0.0%` end) with `509345792 -> 513179648` bytes RSS (`+3833856`).
- Account-proxy acceptance copy recheck: Settings now tells operators that the
  encrypted per-task pool applies to direct HTTPS and browser fallback paths,
  matching the existing shared `automationRoute` wiring. Focused proxy tests
  passed `5/5`, background contracts passed `33/33`, real Express integration
  passed `10/10`, and renderer static coverage passed `46/46`. The read-only
  post-copy profile under
  `/private/tmp/hydra-v147-post-proxy-copy-profile-20260601T230014Z` sampled
  the still-installed exact-public `v1.4.7` package 11 times: four owned
  processes, zero stale profiles, `0.0-0.3%` CPU (`0.036%` average,
  `0.0%` end), and `513490944 -> 513835008` bytes RSS (`+344064`). This is
  running-package no-regression evidence; the source copy patch is not claimed
  as released.
- README proxy-coverage reconciliation: the public overview and Desktop App
  operator note now describe the encrypted pool as one random route per task,
  reused across direct HTTPS probes and browser fallback. The CLI audit locks
  those phrases and `rg -n "Remotion|remotion" README.md` returns no matches.
  The read-only post-change profile under
  `/private/tmp/hydra-v147-post-readme-proxy-profile-20260601T230704Z` sampled
  the still-installed exact-public `v1.4.7` package 11 times: four owned
  processes, zero stale profiles, `0.0-0.1%` CPU (`0.009%` average,
  `0.0%` end), and `514457600 -> 516734976` bytes RSS (`+2277376`). This is
  running-package no-regression evidence; the source/docs patch is not claimed
  as released.
- Final-source literal-chain retry for `c705753`: lint, full `npm test`, and
  gate passed. The intentionally cleaned local release tree did not contain an
  ARM zip, so the exact public `Hydra-1.4.7-mac-arm64.zip` was downloaded into
  `/private/tmp/hydra-v147-public-arm-smoke-retry-20260601T231534Z`. Its local
  SHA-256
  `0d4ea5946c547a8d9cfb0df578e41d1850fe95dbb903346f41f3de94b79989c1`
  matched GitHub's published digest. A temporary release-tree symlink allowed
  ARM package smoke to pass and then moved back into the evidence directory;
  strict deep codesign passed. Docker Desktop was started only for
  `npm run docker:smoke`, which passed image build and a real containerized
  Playwright Chromium launch and left no Hydra container or network. The
  daemon socket stopped first; `docker desktop stop` then removed the remaining
  Desktop helper processes in one second. OpenAPI regeneration retained `84`
  operations without tracked drift. Final state: one canonical Spotlight-visible app, four Hydra-owned
  processes, `0.0%` CPU, and zero stale profiles.
- Final evidence reconciliation: `docs/DOGFOOD_EVIDENCE.json` now records the
  passed local Docker lane instead of its earlier pre-smoke unavailable state.
  The checked-in record remains redacted and no interactive/manual checkbox was
  promoted. A final read-only exact-public `v1.4.7` profile under
  `/private/tmp/hydra-v147-post-final-docs-idle-profile-20260601T232514Z`
  retained four Hydra-owned processes and zero stale Hydra Playwright profiles
  across all 11 samples. It captured one isolated `46.2%` CPU spike, returned
  to low idle on the next sample, and ended at `0.0%`; RSS moved
  `465502208 -> 470351872` bytes (`+4849664`). The full samples and broad
  process inventories remain under that profile directory.
- `1.5.0` candidate source checkpoint: priced routing now records per-attempt
  outcome and cost provenance, OpenRouter catalog prices survive model-cache
  refresh, the local proxy defaults to eight bounded eligible-key attempts,
  and Traffic Console exposes route attempts plus input/output prices. Desktop
  refinements add real Command Grid/List/Map views, labeled sidebar hover
  targets, stronger bounded proximity motion, forgiving Pool Manager toggles,
  persisted Bulk Import logs, density controls, compact Code Redeemer spacing,
  and a launch-bounded moon orbit. Focused verification passed schema sync,
  syntax, telemetry `5/5`, request-log buffering `5/5`, background contracts
  `34/34`, UI contracts `47/47`, test-chain completeness `2/2`, lint,
  production renderer build, and diff hygiene. This is source evidence only;
  append native packaged-app and hosted PR matrix evidence after those lanes
  run.
- `1.5.0` local ARM package checkpoint: full `npm test`, gate `12/12`, OpenAPI
  regeneration (`84` operations), `electron:smoke`, and strict deep codesign
  passed. LaunchServices opened the canonical `release/mac-arm64/Hydra.app`
  bundle as version `1.5.0`. Native Computer Use spot checks covered the
  `13`-account Dashboard, functional Grid/List/Map switching, topology Map,
  Traffic routing/spend surface, Pool Manager account-level routing controls,
  Settings Standard/Compact density switching, and shortened Bulk OTP copy.
  Splash teardown was finite (`timers=0`, `rafActive=false`, `bodyCount=0`,
  `matterCleared=true`). The settled packaged runtime had four Hydra-owned
  processes, zero stale Playwright profiles, `0.0%` aggregate CPU, and
  `528.55 MB` RSS. The generated ARM zip SHA-256 before reversible metadata
  cleanup was
  `016010d098faf19cbe8659b10880cf8dfa6ef54cd83e32d8c7fd16ed54cdc6bc`.
  Hosted PR CI, Docker runtime, and cross-platform package lanes remain the
  merge boundary.
- `1.5.0` final Generator OTP and LaunchServices reveal checkpoint: the
  superseding local ARM package includes the visible Generator browser default,
  manual-verification state, sanitized six-digit OTP panel, Enter-submit form,
  and explicit Clerk OTP submit-control click. The supplied signup credentials
  were not used to create a live upstream account during verification because
  the remaining OTP/human-verification step is operator-owned. The same rebuild
  fixes an intermittent splash-to-main reveal race by restoring macOS Dock
  presentation, activating/focusing the app, logging deterministic
  `main-window:startup-reveal` evidence, and retrying hidden-window show
  attempts. Package smoke, strict deep codesign, bundle version checks, and
  embedded-source inspection passed. The final ARM zip SHA-256 is
  `49d191e7a9cfb72193abf5b10e4cb96c18c9bb0bee35d687b019f7ddce63ab44`.
  LaunchServices opened the rebuilt app without a browser; splash diagnostics
  reported `durationMs=16000`, `exitMs=11750`, `portalMs=4250`, `timers=0`,
  `rafActive=false`, `bodyCount=0`, and `matterCleared=true`. Startup reveal
  reported `visible=true` at the initial loadURL fallback, `+300ms`, and
  `+1200ms`. A later untouched idle sample settled to four Hydra-owned
  processes, zero stale Playwright profiles, `0.0%` aggregate CPU, and
  `591.64 MB` RSS. Local notarization remains deferred because Apple signing
  credentials are absent; local ad-hoc codesign is valid.
- `1.5.6` packaged self-capture checkpoint: after the Generator OTP handoff
  hardening, local package metadata was advanced to `1.5.6` and the macOS ARM
  package was rebuilt from source. `HYDRA_BUILD_TARGET=darwin-arm64 npm run
  electron:smoke` passed, strict deep codesign passed, the bundle reported
  `CFBundleShortVersionString=1.5.6`, and the rebuilt zip SHA-256 was
  `3a892bf939c06525a6c0b0365c44719a97b5f511389821b5906789779f9e7267`.
  The first self-capture launch proved the flag reached the packaged process
  but correctly rejected `/private/tmp` because only `os.tmpdir()` and Hydra
  logs were accepted. The app gate was tightened to accept `/tmp` and
  `/private/tmp`, covered by `npm run test:electron-main-process`, rebuilt,
  smoke-tested, codesigned, and embedded-source inspected. LaunchServices then
  opened `release/mac-arm64/Hydra.app` with
  `--hydra-self-capture=/private/tmp/hydra-v156-self-capture-20260602T143316Z/hydra-v156-dashboard-raw.png`
  and `--hydra-self-capture-delay-ms=3500`; the packaged Electron main process
  wrote a `2880x1800` raw PNG via `webContents.capturePage()`. The raw stayed
  in `/private/tmp`; the checked-in redacted proof is
  `docs/evidence/hydra-v156-packaged-dashboard-self-capture-redacted.png`
  (`sha256 c0c4d7e415417bf00b1ff06ae66b9d35523b9f35e66754171ba3507d20c9bdd9`).
  This gives a packaged screenshot path that avoids Chrome, Vite preview,
  Browser Harness, System Events, and macOS Screen Recording prompts.
- `1.5.6` final Generator signup-shell hardening checkpoint: the remaining
  reported `Timeout 30000ms exceeded` came from a stale packaged flow that
  still trusted a blind Playwright signup-shell wait. The final patch replaces
  that shell wait with 500ms sanitized checkpoint polling, raises page defaults
  to the known startup/OTP windows, keeps hydrate/form/OTP delays abort-aware,
  trims whitespace-only Generator aliases before start, and keeps active
  Generator controls as equal-width compact buttons with the shorter
  **Show browser** label. Focused verification passed
  `node --check server/services/account-generator.js`,
  `npm run test:background-failure-visibility`, and `npm run test:ui-static`.
  Final source verification then passed the full `npm test` chain,
  `npm run lint`, `npm run build`, `npm run gate`, `npm run openapi:hydra`,
  `node bin/hydra.mjs audit --json`, and `git diff --check`.
  The final local ARM package passed `npm run electron:build:mac-arm64`,
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, strict deep
  codesign, bundle version `1.5.6`, and embedded-source inspection for
  `SIGNUP_SHELL_CHECK_INTERVAL_MS`, `GENERATOR_SIGNUP_SHELL_TIMEOUT`,
  `page.setDefaultTimeout`, abort-aware form helpers, and the supervisor-backed
  cancellation log reason. The final local ARM zip SHA-256 is
  `93f4c7e519a30b5da69ac6d69104b2960bf3f31634b3b9afc9b2cc43f00cf4ad`.
  LaunchServices opened the exact rebuilt package; splash diagnostics remained
  finite (`durationMs=16000`, `exitMs=11750`, `portalMs=4250`, `timers=0`,
  `rafActive=false`, `bodyCount=0`, `matterCleared=true`) and renderer
  diagnostics settled to three bounded timeouts with no active RAFs or Anime
  effects. A live packaged private-API Generator start for a redacted supplied alias
  on `127.0.0.1:52388` reached `status=entering_email`,
  `mode=browser_signup`, `checkpoint.state=manual_verification`, and
  `url=https://openrouter.ai/sign-up`; bounded cleanup succeeded and the fresh
  log ended with `Launch stopped ... bounded_packaged_handoff_test`. The
  process table returned to the expected four Hydra-owned Electron processes
  with no spawned OpenRouter browser left behind. A local
  `npm run electron:build:mac-x64` attempt stopped at the intended
  target-payload guard because this Apple Silicon machine only has ARM
  Playwright Chromium, so Intel packaging remains a GitHub macOS Intel runner
  responsibility. Upstream human verification and final OTP entry remain
  operator-owned.
- `1.5.6` public artifact closeout: Auto-version run `26829069491`, CI run
  `26829069694`, Docker run `26829069056`, and Release Desktop Apps run
  `26829086902` all passed. The release matrix produced and smoke-verified
  macOS arm64 zip, macOS Intel x64 zip, Linux x64 AppImage, and Windows x64 NSIS
  artifacts; the Windows lane also launched both unpacked and NSIS-installed
  executables and proved cleanup. GitHub release `v1.5.6` is public with macOS
  arm64 zip/blockmap, macOS Intel zip/blockmap, Windows NSIS/blockmap, Linux
  AppImage, `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`.
- `1.5.7` Generator OTP-submit rescue: the local OTP verify endpoint is no
  longer high-cost limited, six-digit OTP validation is explicit, the renderer
  enters `submitting_otp` optimistically before the quiet request returns, stale
  OTP checkpoints are hidden during finalization, duplicate submits are
  idempotent, and `otpAcceptedAt` is recorded at server acceptance. Focused
  checks passed `node --check` for the touched Generator server modules,
  `npm run test:background-failure-visibility` (`34/34`),
  `npm run test:ui-static` (`48/48`), `npm run lint`, `npm run build`,
  `npm run gate` (`12/12`), full `npm test`, and
  `node bin/hydra.mjs audit --json`. The local ARM package passed
  `npm run electron:build:mac-arm64`,
  `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, strict deep
  codesign, bundle version `1.5.7`, and embedded-source inspection for both
  server and renderer OTP-submit changes. The local ARM zip SHA-256 is
  `0dbda1ab09a220ec7a02c3a27aad287cfbe39b6ca1d7d35071fc6b3d2449e8d3`.
  A source-dev live Generator smoke reached OpenRouter's current
  manual-verification boundary for a redacted supplied alias, rendered
  active-job controls correctly, then cancelled and removed the isolated
  Playwright profile. The source-dev page proof is
  `docs/evidence/hydra-v157-generator-dev-initial.png`
  (`sha256 a41c33c6c1eb766df52333ecddf09ad93bdbe3fb3e54b2595c465bf671bd95de`).
- `1.5.7` public artifact closeout: Auto-version run `26831257982`, CI run
  `26831257315`, Docker run `26831257935`, and Release Desktop Apps run
  `26831277740` all passed. The release matrix produced and smoke-verified
  macOS arm64 zip, macOS Intel x64 zip, Linux x64 AppImage, and Windows x64
  NSIS artifacts; the Windows lane also launched both unpacked and
  NSIS-installed executables and proved cleanup. GitHub release `v1.5.7` is
  public with macOS arm64 zip/blockmap, macOS Intel zip/blockmap, Windows
  NSIS/blockmap, Linux AppImage, `latest-mac.yml`, `latest.yml`, and
  `latest-linux.yml`.
