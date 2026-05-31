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
