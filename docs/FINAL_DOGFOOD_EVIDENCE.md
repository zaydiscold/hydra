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
  `367.83 MB` across no-relaunch samples of the already-running package.
- `hydra doctor` now separates Hydra-owned process load from unrelated
  Chrome/CDP/browser-tooling load, which stayed heavy and was intentionally not
  closed.
- `hydra doctor --clean-stale-profiles` moved stale Hydra-owned Playwright
  profile directories to a timestamped temp backup with `deleted: 0`, and the
  Playwright isolation tests now clean their own temp profiles.
- Renderer timers, intervals, animation frames, and Anime.js effects are routed
  through `window.__HYDRA_RENDERER_DIAGNOSTICS__()` ownership tracking.
- The splash remains intentionally richer at 12 seconds and 92 falling words,
  but Matter.js, RAF, timers, listeners, bodies, and optional sensor instances
  are bounded by the deterministic splash-disposal contract.
- Tilt support is source-verified as opportunistic device tilt: sensor/fallback
  x input affects horizontal gravity, spawn-position bias, and initial x
  velocity. Exact MacBook hinge-angle support remains a future native HID bridge,
  not a claimed packaged feature.
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

This is not release-complete evidence. It is the current source/package-resource
and local idle-performance evidence that should feed the final manual dogfood
run.

The full operator checklist is in `docs/PACKAGED_ELECTRON_DOGFOOD.md`. For the
current published release, derive the release version from `package.json`:

```bash
HYDRA_RELEASE_VERSION="$(node -p "require('./package.json').version")"
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
