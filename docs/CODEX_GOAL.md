# Hydra — Goal Sheet

Ship a working, polished Electron desktop app that runs on macOS and Windows. Full-stack MVP. Every feature works. No dead buttons, no silent failures, no half-baked flows. Think Karpathy-level engineering rigor meets Levelsio ship-it energy — one clean artifact that just works.

---

## Crunch List — User-Added Must Finish

- **Primary focus for the next 4-5 hours: performance and efficiency release.**
  Before the next version release, spend the main effort finding and fixing
  avoidable CPU, RAM, fan, and smoothness problems instead of shipping another
  feature batch. Treat the user's report as true: launching/running Hydra can
  make the computer fans throb, so Hydra is likely keeping heavier work alive
  than it needs to.
  - Hunt for live Chrome/Chromium/Playwright instances, browser contexts,
    background workers, orphan processes, timers, polling loops, SSE streams,
    file watchers, database loops, and startup tasks that remain alive after
    the UI no longer needs them.
  - Make splash/graphics polished but finite: animations should stop, pause,
    or be torn down after the splash/main transition; no runaway canvas,
    Anime.js, requestAnimationFrame, interval, timeout, or Matter.js physics
    tasks should survive past their visual purpose.
  - Keep the front splash feeling rich: the current target is a 16 second
    visible splash with a bounded 72-word unique irregular shower, a staged 3
    second portal exit, and a pile that visibly biases left or right when real
    laptop/device tilt data is exposed, with a tiny fallback side lean when no
    sensor exists. The lower queue replaces the superseded 120-word pass after
    packaged profiling showed the tighter density preserves the visual effect
    with less physics and compositor pressure.
  - Look broadly for CPU/RAM wins and smoother perceived performance in the
    Electron main process, renderer, embedded API server, proxy/router,
    account automation, request logging, health polling, and dashboard refresh
    paths.
  - Target at least a 20% reduction in avoidable idle CPU/RAM pressure where
    measurable, or document the baseline, the fix, and why a 20% target is not
    honestly measurable from the current environment.
  - Ship the performance fixes together as one coherent version release, with
    source contracts/tests and `docs/RELEASE_AUDIT.md` evidence updated before
    dogfood/screenshots.
  - Versioning policy for this tranche: keep incremental commits on `master`
    with `[skip-bump]`; once all 12 acceptance items and final gates are green,
    cut the release as a minor bump using `[bump:minor]` so the performance,
    splash-density, tilt, runtime-diagnostics, and auth/session hardening work
    lands as `1.1.0` if the package is still in the `1.0.x` lane. See
    `docs/VERSIONING.md`.
- Keep local source, packaged app resources, and remote `master` aligned. If local HEAD is stale or stashed work leaves the packaged app behind, bring the working tree/build artifact back to the latest pushed source before dogfooding.
- Fix the packaged Electron startup crash from `electron-updater` ESM import mismatch:
  `SyntaxError: The requested module 'electron-updater' does not provide an export named 'autoUpdater'`.
- Investigate the macOS crash report with `EXC_CRASH (SIGABRT)` in `HIServices`/`_RegisterApplication`/`NSApplication sharedApplication`; distinguish app code crashes from sandbox/LaunchServices handoff failures with real evidence.
- Restore and verify Touch ID controls in Settings. The Settings page must visibly expose biometric unlock status, opt-in toggle, and a test prompt when macOS reports biometric support.
- Stop annoying duplicate keychain prompts on launch. Hydra should not ask for keychain access twice every startup; identify whether the prompts come from auth-token persistence, Electron safeStorage/keychain use, auto-update, Sentry, or another native bridge path, then cache/debounce/sequence access so launch is calm while still failing closed for protected secrets.
- Integrate per-task random proxy-pool rotation for account automation. Settings must accept one proxy per line in `ip:port:user:pass` format, include a Save button, store the list encrypted, work with an empty list, and auto-distribute saved proxies to newly started tasks.
- Apply proxy rotation to new account signup tasks and every browser-backed add-code/code-redemption task. Look backward for issues that may arise: proxy format validation, secret redaction, encrypted storage permissions, random distribution, no-proxy fallback, Playwright cleanup, task metadata/log redaction, and whether any non-browser HTTP code-redemption path needs explicit proxy-agent support before claiming complete coverage.
- Keep the README professional and navigable: add better grouping, top navigation links, and separation for quickstart, hardening scripts, CLI/API usage, router/runtime hardening, and deep reference material.
- Screenshot plan, after the current source hardening/dogfood pass: refresh media from the packaged Electron app only, not a browser target. Do not expose full API keys, cookies, tokens, personal secrets, or private account data.
- Required screenshot set: Vault setup first-run password screen, Dashboard fleet overview with seeded/redacted balances and health, Pool proxy/router status with local base URL and pooled-key health, Traffic request-log panel with bounded activity and latency/status rows, and CLI terminal captures for `hydra status`, `hydra doctor --json`, and `hydra proxy status`.
- Current media scope: keep the packaged splash GIF in the README and leave the
  existing packaged Electron gallery captures alone. The superseded Remotion
  showreel workspace is not part of the current release lane.
- Continue the optimization/code-health pass for the long-running API router: reduce RAM and allocations, avoid redundant objects/buffers/I/O/API calls/database queries, cache where appropriate, improve concurrency without races, remove blocking paths, DRY duplicated logic, split deeply nested/monolithic functions, replace magic numbers/strings with constants/config, remove dead code/obsolete comments, and keep modern syntax/type-safety discipline.

---

## The Bar

- The app launches, splashes, unlocks, and lands on Dashboard without hiccups on both macOS and Windows
- Every page looks intentional — the UI is already pretty good, just tighten anything loose
- Every button does what it says and gives feedback while doing it
- Single account login, bulk OTP login, session storage, code redemption — all work reliably across multiple accounts with different session states
- No memory leaks, no orphaned processes, no runaway Playwright instances
- `npm run electron:build` produces a clean installable artifact. `npm run electron:smoke` passes. That's the product.

## Verification Pass — Prove What Was Already Done

- Treat every completed-looking change as untrusted until it is verified against the actual app, package, CLI, Docker runtime, or CI workflow it claims to support
- Current active scope now includes source/code-verifiable hardening plus packaged Electron-only dogfood. Do not use Chrome, browser tabs, Vite previews, or browser screenshots as release evidence. Any app interaction must target the packaged Electron app only, preferably through LaunchServices (`open -n .../Hydra.app`) and macOS app control.
- Re-run the relevant gates after code, packaging, or runtime changes: `npm test`, `npm run lint`, `npm run gate`, `npm run electron:build`, `npm run electron:smoke`, and Docker smoke when Docker is running
- Browser/Vite renderer checks are not part of the active plan. Manual/user feedback is allowed during packaged Electron dogfood: ask the user targeted questions, let them try flows in the Electron app, and fold their reports back into source fixes/tests.
- Verify generated artifacts directly: inspect release outputs, signing state, bundled Chromium layout, packaged resources, installer/zip contents, and architecture targets
- Cross-device launch promises (Intel macOS and Windows install/launch) are deferred from the active Codex plan; keep package/resource contracts test-covered, but do not chase manual launch gaps here.
- Keep `docs/RELEASE_AUDIT.md` current with each verified item, exact commands run, dates, evidence, blockers, and anything still unproven
- Do not mark the goal complete until every explicit requirement in this file maps to concrete current evidence; uncertainty counts as not done

## Execution Order

1. Finish code-verifiable hardening: source fixes, contracts, tests, lint/build failures, package-resource issues, CLI/audit gaps, OpenRouter API coverage, static UI polish, Docker/CI definitions, docs drift, and deterministic security or reliability issues that can be proven without manually driving the GUI.
2. Fold in the newest code-first scope before any screenshot/dogfood work:
   Command Center Dashboard polish from the third local design concept,
   streamlined account cards, working fleet-health donut/activity feed data,
   direct OpenRouter CLI/API hardening, bulk code redemption tests, route/API
   learning docs, and privacy/secrets checks before GitHub push.
3. Keep updating `docs/RELEASE_AUDIT.md` and the API/CLI learning docs as each
   source/build item becomes verified, and keep
   `node bin/hydra.mjs audit --json` aligned with that evidence where the audit
   scope applies.
4. Before pushing to GitHub, run the relevant test suite, explicitly test or
   source-contract-test bulk code redemption behavior, and scan staged changes
   for secrets, local runtime data, packaged artifacts, personal tokens,
   cookies, private keys, `.env` files, local databases, and user-private data.
5. Run packaged Electron-only dogfood after code-side checks and GitHub hygiene
   are green. Keep screenshot auditing last and Electron-only. Use user
   interview/report loops during dogfood for subjective UI flow, polish, and
   launch/window-control feedback.

---

## Engineering Review — Fix What's Broken

- SSE proxy truncation is fixed in `server/lib/sse-stream.js`: truncated or errored upstream SSE streams append a `STREAM_INTERRUPTED` frame plus `[DONE]`; `server/tests/sse-stream.test.mjs` covers clean completion, premature close, and mid-stream upstream error
- Renderer IPC calls now go through `src/lib/native.js`, which unwraps `{ok, data}` and throws on `{ok:false}`; `server/tests/electron-ipc-contract.test.mjs` scans the renderer tree for direct bridge calls
- Corrupt `local-secrets.json` is quarantined/regenerated for JSON and invalid-hex corruption; owner-only atomic writes preserve warnings for directory fsync/temp-file cleanup fallbacks; `server/tests/local-secrets.test.mjs` covers import-time recovery, owner-only atomic writes, and fallback warning visibility
- Server shutdown awaits background services, task cleanup, magic-link cleanup stop, session refresher stop, and Prisma disconnect; Prisma disconnect failures now log warning evidence while still resetting the lazy proxy lifecycle; `server/tests/electron-launch-compat.test.mjs` covers `gracefulShutdown({ exit:false })`, `server/tests/background-failure-visibility.test.mjs` covers the magic-link cleanup lifecycle contract, and `server/tests/db-proxy-cache.test.mjs` covers the Prisma disconnect visibility/reset contract
- Playwright generator resources have task cleanup hooks plus defensive close-on-launch-failure cleanup; stale Playwright profile sweeps now log path-level stat/remove failures instead of only incrementing counters; Electron auxiliary-process sweeps cover Windows with PowerShell/CIM process enumeration and `taskkill /T /F`, while packaged orphan-process dogfood remains tracked in `docs/RELEASE_AUDIT.md`
- Session refresher stop awaits in-flight sweeps before shutdown continues; `server/services/session-refresher.js` carries the contract
- Async cached `computeSchemaContentHash()` is implemented and covered by `server/tests/schema-hash.test.mjs`
- Schema sync sentinel reads now distinguish normal first-launch missing files from unreadable `.schema-mtimes`/`.schema-version` state, logging warning evidence before falling back to a sync decision; `server/tests/schema-hash.test.mjs` covers this contract
- Schema self-heal backups are pruned to the newest five roots with WAL/SHM sidecars, and self-heal WAL checkpoint/prune/lock-cleanup fallbacks now log warning evidence instead of disappearing behind best-effort cleanup; `server/tests/schema-self-heal-backups.test.mjs` covers copy, pruning, and fallback visibility behavior
- `validateConfig()` now returns the parsed config object, and `server/tests/config-validation.test.mjs` covers the contract
- `JWT_SECRET` is trimmed and must be at least 32 characters; whitespace-only secrets are rejected by `server/config.js` and `server/tests/config-validation.test.mjs`
- Single-instance lock failure now calls `app.quit()` and skips lifecycle registration instead of racing `process.exit(0)`
- Splash window uses `alwaysOnTop: false`; `scripts/integration-gate.mjs` checks the contract
- `npm run dev:electron` uses `scripts/dev-electron.mjs`, keeps Vite/Electron env in sync, and sets `VITE_DEV_SERVER_URL`
- Tray menu rebuilds on `proxyGate.onChange()` via `bindTrayProxyState`; packaged tray dogfood remains tracked in `docs/RELEASE_AUDIT.md`
- Clipboard actions in Account Detail, Pool Manager, Created Key, and Bulk OTP export now await copy failures and surface copied/copy-failed feedback; `server/tests/ui-static-contract.test.mjs` locks this down
- AppChrome window controls now call Electron through `tryNative()` instead of empty rejection catches; `server/tests/electron-ipc-contract.test.mjs` verifies renderer native calls stay behind the wrapper
- TaskSupervisor background sweeps, queue drains, Playwright resource closes, and task cleanup failures now log contextual warnings instead of empty-catching; `server/tests/task-supervisor.test.mjs` is wired into `npm test`
- Dashboard balance-cache persistence, Account Generator Playwright cleanup, and request-log retention shutdown wait failures are logged as non-fatal warnings; `server/tests/background-failure-visibility.test.mjs` is wired into `npm test`
- Account Generator cleanup failures and Code Redeemer history-load failures now stay visible through contextual warnings, warning toasts/status text, and `server/tests/ui-static-contract.test.mjs` static coverage
- OpenRouter Playwright automation soft failures in management-key provisioning,
  code redemption, and key sync now log contextual evidence for overlay
  dismissal, copy/reveal clicks, clipboard permission grants, network logging,
  page-title/URL reads, iframe scans, DOM key scans, browser clipboard-read
  denials, tracing/debug capture, server-action hash discovery/probe failures,
  forced-click retries for management-key form submission, profile/key-sync tRPC
  fallback failures, redeem tRPC outcome parse failures, redeem credits-preflight
  failures, and browser close failures;
  `server/tests/background-failure-visibility.test.mjs` covers the management-key
  automation slice
- Vault session/provisioning probe failures, Settings clipboard fallback failures, and DevBackendHint command-copy failures now surface visible feedback instead of false copied/unknown states; `server/tests/ui-static-contract.test.mjs` covers these contracts
- Dashboard pool-sync/status probes, Account Detail live-session probes, and Pool Manager optional model/sync/proxy probes now log contextual warning evidence; user-initiated provisioning/session checks also surface warning toasts instead of silently falling back to stale state; `server/tests/ui-static-contract.test.mjs` covers these contracts
- Pool Manager clipboard failures now log copy-target context in addition to visible copy-failed button state, and invalid non-JSON API responses preserve status, route, and parse cause through `INVALID_API_RESPONSE`; auth endpoint 401s also preserve invalid-response evidence instead of mislabeling malformed server responses as bad credentials. `server/tests/ui-static-contract.test.mjs` covers these contracts
- Diagnostics health/proxy refresh failures, support-bundle copy failures, native folder-open failures, CreatedKey add-to-pool failures, and RegisterKey clipboard-read failures now surface visible feedback; `server/tests/ui-static-contract.test.mjs` and `server/tests/electron-ipc-contract.test.mjs` cover these contracts
- Native menu/tray actions now avoid fire-and-forget OS work: tray/help folder opens log `shell.openPath()` failures, Build Info and Copy Proxy URL use checked clipboard writes, and preload exposes a narrow menu-event bridge so renderer toasts show Copy Proxy URL success/not-ready and menu clipboard failures; `electron/tests/main-process.test.mjs`, `server/tests/electron-ipc-contract.test.mjs`, and `server/tests/ui-static-contract.test.mjs` cover the contract
- Electron startup/runtime best-effort failures now leave evidence: log rotation/write/close failures, packaged disk-space probe failures, invalid DB backup/removal failures, missing startup timing marks, and uncaught-exception telemetry capture failures are logged or added to startup summaries instead of disappearing; `electron/tests/main-process.test.mjs` and `server/tests/electron-data-path.test.mjs` cover these contracts
- Legacy Electron data migration now distinguishes true missing files from unreadable database/path state, logs unexpected inspection failures, refuses to promote a legacy DB with no Account table, keeps cleanup disconnect failures visible, and avoids overwriting newer userData sidecar files; `electron/tests/main-process.test.mjs` covers the source contract
- App-shell lifecycle fallbacks now stay visible: upstream-health refresh failures log warnings, logout failure clears the local session but warns the user, native hide/quit/shutdown fallbacks log context, and API shutdown failures log before window close; `server/tests/ui-static-contract.test.mjs` covers these renderer contracts
- Settings preference toggles now have source-level persistence coverage: biometric and telemetry toggles load through native `prefsGetAll`, write through `prefsSet` before local UI state updates, Electron persists them through `preferences.json`, and `server/tests/ui-static-contract.test.mjs` plus `server/tests/user-prefs.test.mjs` cover the renderer/native/persistence chain
- Magic-link callback auto-provisioning and opener notification failures now log contextual warnings instead of disappearing behind best-effort catches; `server/tests/background-failure-visibility.test.mjs` covers the source contract
- Management-key duplicate scans now log account/key-row context when an existing encrypted management-key row is unreadable, then continue scanning instead of hiding corruption evidence; `server/tests/management-key-backfill.test.mjs` covers the source contract
- Corrupt-account purge failures and redemption-history alias/read/write failures now emit contextual log evidence instead of silent controller/service catches; `server/tests/background-failure-visibility.test.mjs` covers these contracts
- Account bulk-dedup preload failures, silent-refresh fallback failures, pool status fallback, pool sync-key registration fallback, Pool Manager key-validation parse/hash-shape anomalies, and Dashboard session-status fallback now log contextual evidence while preserving their non-fatal behavior; malformed OpenRouter key-validation JSON now blocks pooling instead of accepting an unverified response. `server/tests/background-failure-visibility.test.mjs` covers these contracts
- Debug vampire-mode profile preload fallbacks now log non-OK profile responses, invalid profile JSON, and fetch failures before proceeding with the empty-bio no-op path; `server/tests/background-failure-visibility.test.mjs` covers this private recon contract
- Session lifetime probe token-decrypt and live-refresh probe failures now log account-level evidence instead of downgrading to unknown/error without context; `server/tests/background-failure-visibility.test.mjs` covers this contract
- Proxy gate persisted-state read and shape failures now log when Hydra defaults the proxy gate back to enabled, so a disabled proxy cannot fail open after restart without evidence; `server/tests/proxy-gate.test.mjs` covers this contract
- OpenRouter upstream reachability now classifies 5xx HTTP responses as offline/degraded instead of painting the desktop banner green; 401/402/429 still count as reachable because they prove network/API contact. `server/tests/upstream-health.test.mjs` and `server/tests/health-pinger-contract.test.mjs` cover this contract
- Proxy RequestLog fallback writes now log secondary DB-write failures when Hydra retries without `keyHash`, so usage-log degradation leaves evidence for both the primary and fallback write paths; `server/tests/background-failure-visibility.test.mjs` covers this contract
- Proxy rotation weighted-selection failures now log throttled warning evidence and fall back to round-robin instead of silently masking malformed balance metadata; `server/tests/background-failure-visibility.test.mjs` covers this source contract
- Proxy `/v1/models` static fallbacks now log whether the live OpenRouter model-list request returned a non-OK status or the cache/live lookup path threw, so SDK clients still get a usable static model list without hiding degraded upstream/cache state; `server/tests/background-failure-visibility.test.mjs` covers this source contract
- Store-layer local-state fallbacks now log account/key-scoped evidence for live session probe errors, stored session-token decrypt failures, uniqueness checks that skip unreadable accounts, and encrypted API-key decrypt failures while preserving non-fatal UI/API behavior; `server/tests/background-failure-visibility.test.mjs` covers this source contract
- Legacy storage reset probes now log field-level unreadable ciphertext evidence for account config, account session tokens, and stored key material before triggering the legacy reset/block path; `server/tests/background-failure-visibility.test.mjs` covers this source contract
- OpenRouter account/key requests and model-list cache refreshes are timeout bounded with `AbortSignal.timeout(30000)`; account snapshot fallbacks log when credits or key-list lookups fail before returning safe zero/empty defaults, so account metadata degradation does not look like a real empty account without evidence; `server/tests/background-failure-visibility.test.mjs` covers this contract
- CLI status/doctor/logs/data-dir/stop degraded paths now stay explicit for closed-app automation: top-level system commands default to the same repo `data/` runtime as service-backed commands unless `HYDRA_DATA_DIR` is set, `hydra doctor --json` recognizes packaged `chromium.zip` resources, separates Hydra-owned app/browser automation processes from unrelated Chrome/Playwright/Electron tooling in `otherBrowserToolProcesses`, `hydra status --json` includes a `warnings` channel for proxy metadata degradation, and `hydra stop` bounds shutdown requests, preserves non-JSON response bodies, and reports timeout/request failures without hanging or hiding endpoint evidence; `server/tests/cli.test.mjs` covers the source contract
- Test-chain completeness is enforced by `server/tests/test-chain-completeness.test.mjs`, which fails if normal `server/tests/*.test.mjs` or `electron/tests/*.test.mjs` files are not reachable from `npm test`
- Fast-winner timeout competitors are now cleared instead of remaining pending
  after their useful work has already finished: management-key Playwright
  network capture uses `waitWithClearedTimeout()`, SQLite schema self-heal uses
  `withStatementTimeout()`, and the delayed packaged update check is unref'd.
  `server/tests/background-failure-visibility.test.mjs` and
  `electron/tests/main-process.test.mjs` lock down the cleanup contracts.

---

## Visual Polish — Source-Pass First, Electron Screenshot Audit Very Last

- Primary page headers use the shared `AnimeText` component with Anime.js
  `splitText().addEffect()` cleanup, including char, word, and line split
  modes; `server/tests/ui-static-contract.test.mjs` locks down the current
  page-header coverage and reduced-motion-safe cleanup pattern
- Route-aware document/window titles now map the active app route to concrete
  labels like `Hydra — Pool Manager`, `Hydra — Account Detail`, and
  `Hydra — Diagnostics`; `server/tests/ui-static-contract.test.mjs` covers the
  source contract
- Check empty states: Dashboard with zero accounts, Pool Manager with no keys — should be helpful guidance, not blank
- Check loading states: every async operation should show progress, not leave the user staring at nothing
- Check error states: meaningful messages with clear next steps, not stack traces or cryptic codes
- Verify the neo-brutalist/cyberpunk identity carries through every page, not just the splash
- Keep source-level UI contracts useful, but do not burn time in browser attachment loops while code-verifiable blockers remain
- The real screenshot audit is the last item in final acceptance and must run against packaged Electron only. Do not use Chrome or `vite preview` screenshots as release evidence.

---

## Splash and Startup Flow

- The splash → unlock → dashboard chain is the first impression. It has to be seamless
- Splash animation plays, transitions to password input (not a separate window), user types password, hits Continue, main window opens to Dashboard
- If the server fails to start, show a real error dialog (Open Logs / Copy Details / Quit) not a bare `dialog.showErrorBox`; Open Logs / Copy Details failures must be logged and surfaced instead of silently reporting success
- First-time users now get a guided setup path instead of an "Invalid credentials" dead end: set local password, optionally paste an OpenRouter management key, see the short launch tour, then enter Dashboard; `server/tests/ui-static-contract.test.mjs` locks this source contract down
- Splash/main handoff no longer depends only on `ready-to-show`: if `loadURL()` succeeds before `ready-to-show`, Electron shows/focuses the main window instead of leaving an invisible app, and the `activate` path now creates hidden replacement windows until `ready-to-show` or successful `loadURL`; `electron/tests/main-process.test.mjs` covers the no-blank startup/activate contract
- Splash greeting personalization remains best-effort, but macOS full-name lookup failures and username fallback failures now log diagnostic evidence instead of disappearing during startup; `electron/tests/main-process.test.mjs` covers this source contract

---

## Session and Auth Integrity

- `getSessionStatusAsync` persists fresh Clerk client cookies and expiry after live refresh; `server/tests/session-refresh-contract.test.mjs` verifies the source contract
- `clientCookies` stack traversal is used before legacy `clientCookie` in refresh entrypoints; `server/tests/session-refresh-contract.test.mjs` scans the relevant files
- Session refresh contract is unified around stacked cookie input plus live-probe persistence; focused regression coverage passed on 2026-05-16
- Clerk/dashboard cookie utilities now round-trip raw legacy `__client` values and lone `__client=value` strings without double-prefixing headers, and DebugController's private probes use the same Clerk/dashboard serializers as production paths instead of ad hoc `__client=${value}` construction; `server/tests/cookie-utils.test.mjs` and `server/tests/session-refresh-contract.test.mjs` cover this
- Test biometric-gated auth tokens: enable Touch ID, lock, unlock via Touch ID, verify session resumes
- Biometric-gated auth-token release now fails closed: when `biometricEnabled`
  is true, `native:auth-token:get` always calls `promptBiometric('Unlock
  Hydra')` and returns `null` on cancel, failure, or unavailable hardware
  instead of releasing the persisted token. Touch ID availability and prompt
  failures now log typed diagnostic evidence, and `server/tests/electron-ipc-contract.test.mjs`
  plus `electron/tests/main-process.test.mjs` lock this source contract down.
- Local Hydra unlock cookies are now server-issued `HttpOnly` cookies instead
  of renderer-written JS-readable cookies. Renderer requests explicitly send
  same-origin cookies, legacy JS cookies are only cleared, and
  `server/tests/auth-cookie.test.mjs` plus `server/tests/electron-data-path.test.mjs`
  lock the cookie, native auth-token, and no-`safeStorage`/`keytar` contracts.
- Clerk webhook handler for `session.ended`/`session.revoked` clears matching local sessions by Clerk `sid` while account events avoid storing the full `sid`; `server/tests/clerk-webhook-session-revoke.test.mjs` covers both event types and the redaction contract

---

## OpenRouter and Hydra API Mapping

Hydra is a private local app. Do not upload Hydra, register Hydra, publish a
Hydra library package, or run public Printing Press ship/publish flows. Use the
Printing Press style only as a methodology: map the surfaces, keep the map
executable, and turn the useful parts into Hydra-native CLI commands that work
while the Electron app is closed.

- Keep a private OpenAPI-style map for Hydra's own Express routes.
- Map relevant OpenRouter/Clerk/dashboard behaviors only when they make Hydra's
  local orchestration smarter.
- Prefer Hydra-owned CLI commands over generated public-library tooling.
- Do not add Hydra to any public/shared Printing Press library or catalog.
- Do not treat public-library generation, upload, or sync as a Hydra release
  task.
- Document every private API-map discovery in `docs/`, including exact commands,
  why it matters, and redacted evidence.
- Treat live OpenRouter/Clerk actions as guarded operations with explicit
  preflight state and no silent writes.

---

## Private API-Map CLI Methodology

Private-app scope note: Hydra should not be uploaded or registered as a public Printing Press library package. Use the Printing Press methodology to keep a local API map and to guide Hydra-native CLI/MCP design.

2026-05-16 correction: remove any interpretation that Hydra needs Printing
Press upload, library publishing, public endpoint-tool generation, or shared
catalog sync. Those are explicitly out of scope for this private app. The only
kept piece is the methodology: source-derived API mapping, local OpenAPI output,
closed-app CLI commands, tests, and repo-local documentation.

- Generate an OpenAPI spec from Hydra's Express routes (reference `docs/API_REFERENCE.md`): `npm run openapi:hydra` writes `openapi/hydra-api.openapi.json`.
- Cover local routes: auth, accounts, keys, codes, generator, pool, proxy, dashboard, system, debug, webhooks, shutdown.
- Keep the private API inventory usable while Hydra is closed: `hydra api-map`, `hydra api-map --json`, and `hydra api-map --tag accounts`.
- Use Printing Press as a methodology only. Do not upload/register Hydra, do not add it to the public library, and do not run public ship/publish flows for this private app.
- Cross-reference with `docs/HYDRA_CLI_AND_AI_API_PLAN.md` and `docs/HYDRA_API_MAP.md`; the API map guides future direct-import CLI commands.
- New CLI/API-map work is only done when it lands as repo-owned code, tests, and
  docs. The expected loop is: update route map, implement a curated `hydra`
  subcommand, test closed-app behavior, document the exact evidence.

---

## Expand the Hydra CLI

- **P1:** `hydra accounts add` and `hydra accounts add --bulk N` remain future; `hydra codes preflight`, guarded `hydra codes redeem <code> --account <id> --yes`, and guarded `hydra codes bulk <file> --account <id> --yes` are implemented, with live redemption dogfood still tracked in `docs/RELEASE_AUDIT.md`
- **P2:** `hydra scan --quick`, `hydra session <id> --refresh`, `hydra export`, `hydra import --dry-run`, guarded redacted metadata import via `hydra import --yes`, reversible `hydra db reset --yes`, `hydra accounts sync`, conservative `hydra accounts purge --dead`, `hydra keys provision <id>`, and `hydra keys rotate <id>` are implemented with redaction, dry-run, and/or `--yes` guards; broader live scan remains future
- **P3:** `hydra ai chat "<prompt>"`, `hydra ai models`, and `hydra proxy keys new` are implemented for the local proxy path; live chat success still requires `hydra serve` plus pooled keys
- **P4:** `hydra serve`, guarded `hydra stop`, `hydra logs --tail`, and non-persistent `hydra unlock` are implemented; persistent unlock socket/daemon caching is optional future work
- **Release audit:** `hydra audit` and `hydra audit --json` are implemented as
  read-only closed-app checks over the goal sheet, release audit, package
  scripts, workflows, release artifacts, Docker docs, Windows auxiliary-process
  cleanup, filesystem/migration-lock hardening, biometric fail-closed auth-token
  gating, Settings preference persistence, native menu/tray feedback, and known
  blockers; the audit also tracks non-fatal fallback visibility for redemption,
  store, proxy model-list, proxy rotation, and schema-sync recovery paths
- **P5:** `hydra mcp` is implemented as a private local stdio MCP server so Claude Code/Cursor get fleet management as native tools without publishing raw endpoint tools. It exposes curated read-only wrappers for `hydra status`, `hydra proxy status`, `hydra api-map`, `hydra audit`, and `hydra doctor`; mutating/live flows remain behind the existing guarded CLI commands.
- Scripting-facing commands should support stable `--json`; `--quiet` is used only where streaming/script output needs it
- `hydra doctor --json` is implemented for DB, secrets, packaged Chromium zip/resources, ports, disk space, and runtime data-dir checks

---

## Security — Quick Pass

- `VITE_DEV_SERVER_URL` is validated to loopback only by `electron/app/env.js`; `server/tests/electron-url-allowlist.test.mjs` locks this down
- Express CORS no longer trusts every loopback browser origin. It accepts no-origin calls, exact same-origin app requests, the configured Vite dev port outside production, and explicit `HYDRA_CORS_ORIGINS`; `server/tests/electron-api-integration.test.mjs` covers same-origin/Vite acceptance and arbitrary-loopback rejection
- Auth cookie parsing is defensive: malformed percent-encoded cookie values log a redacted warning and flow through the normal 401 path instead of throwing inside middleware; the unlock cookie is server-issued with `HttpOnly`, `SameSite=Lax`, `Path=/`, and 24-hour TTL; `server/tests/auth-cookie.test.mjs` covers extraction, cookie options, and `requireUnlocked`
- JWT secret file writes are owner-only and generated by `electron/app/env.js`; broader packaged-runtime dogfood remains in `docs/RELEASE_AUDIT.md`
- `setWindowOpenHandler` is restricted to the current app port by `electron/app/windows.js`; `server/tests/electron-url-allowlist.test.mjs` covers it
- `native:get-paths` returns redacted availability metadata, and app-owned folder opening goes through `native:open-app-location`
- Migration lock and runtime data directory permissions are owner-only; stale
  migration locks are broken before acquiring, and the schema lock has a
  Windows PID-liveness path. Data-dir chmod repair failures and stale-lock
  unlink failures now log warning evidence instead of disappearing behind
  best-effort catches; `server/tests/filesystem-permissions.test.mjs` covers
  these contracts
- `local-secrets.json` persistence uses an owner-only temp file, `fsync`, atomic rename, and best-effort directory `fsync`; directory fsync and temp-file cleanup failures now log warnings while preserving the original write error; `server/tests/local-secrets.test.mjs` covers the contract

---

## Performance — Quick Wins

- Async cached `computeSchemaContentHash()` is implemented in `electron/app/schemaHash.js`; `server/tests/schema-hash.test.mjs` verifies repeated callers reuse the cache
- Prisma proxy bound-method caching is implemented in `server/services/db.js`; `server/tests/db-proxy-cache.test.mjs` verifies cache reuse, reset after disconnect, and warning evidence when disconnect fails
- Splash compositor load is reduced in `electron/app/windows.js` by using one canvas paint path and a single SVG bracket layer; packaged GUI screenshot dogfood is still tracked in `docs/RELEASE_AUDIT.md`
- `electron-log` was removed from the Electron main path and replaced by the file tee in `electron/app/env.js`
- Packaged runtime `node:fs` dynamic imports are consolidated in `electron/app/env.js`; `server/tests/electron-data-path.test.mjs` guards against reintroducing nested dynamic fs imports
- Prisma client runtime pruning is implemented in `electron/builders/afterPack.js`; packaged artifact size/signing evidence remains in `docs/RELEASE_AUDIT.md`
- Bounded timeout races in management-key automation and SQLite schema
  self-heal clear and unref their timeout competitors after a fast winner; the
  delayed updater check is also unref'd. A 200-round synthetic resource probe
  recorded `200` pending timeout resources for the old fast-winner shape and
  `0` for the cleared shape.
- Renderer visible-refresh work is abort-linked end to end: hiding or
  unmounting a surface now aborts the shared scheduler's in-flight task,
  dashboard/traffic/vault page loads suppress late state updates, vault and
  dashboard session-status fan-outs stop dequeuing after abort, and API retry
  delays clear their tracked timeout when canceled. A 200-surface synthetic
  probe recorded `800` pending requests and `800` timeout resources after hide
  for the old timer-only shape versus `0` and `0` for the owned-abort shape.
- Code Redeemer route work is abort-linked end to end: route unmount aborts
  account load, redemption-history load, session preflight, and bulk-matrix
  redemption requests; account-selection changes abort the superseded
  debounced preflight request; and canceled work does not write stale state or
  toasts after navigation. A 200-route synthetic teardown probe recorded
  `1400` pending request timeout resources for the old detached shape versus
  `0` for the owned-abort path, which raised all `1400` simulated aborts.
- Account Detail reads are account-route scoped end to end: navigating away or
  switching account IDs aborts account metadata, snapshot, management-key list,
  live-session probe, reveal, and key-test reads; the account-ID reload guard
  replaces the old mount-only guard so a reused route cannot keep showing the
  previous account. The same boundary clears account-specific modal, reveal,
  copy, transient-timer, and key-test UI state and suppresses late UI writes
  from server-completing mutations and modal callbacks after navigation. A
  200-route synthetic switch probe recorded one old-shape account load with
  `1200` detached request timeout resources versus `200` account loads, `0`
  pending timeout resources, and `1200` raised aborts for the route-owned
  shape.
- Generator task ownership now survives the Start-response race: route exit or
  page hide marks the owning surface closed before cleanup, a late
  `/generator/start` response is immediately released with keepalive cleanup,
  and an on-screen response claims its task ref before React effects run.
  Duplicate Start and OTP submissions are gated while their requests are in
  flight, and late OTP responses cannot write into a replaced surface. A
  200-surface synthetic teardown probe at
  `/private/tmp/hydra-generator-start-unmount-benchmark-20260531T184541Z`
  modeled two rapid Start clicks per surface. The old shape left `400` orphan
  tasks after unmount; the owned path started `200`, prevented `200` duplicate
  starts, issued `200` late-response cleanups, suppressed `200` stale writes,
  and left `0` orphan tasks.
- Ordinary `/v1` proxy requests now own their upstream fetch lifecycle: client
  abort or response close aborts the active OpenRouter controller, the retry
  loop stops before choosing another key after disconnect, and connect/body
  timeout handles are unref'd and cleared. SSE close handling now aborts the
  fetch controller as well as canceling its response body. A 200-client
  synthetic teardown probe at
  `/private/tmp/hydra-proxy-client-disconnect-benchmark-20260531T185826Z`
  modeled disconnects during an upstream request. The old shape left `200`
  pending upstreams and `200` pending timeout handles and could reach `600`
  attempts after failures; the owned path aborted all `200`, left `0` pending
  upstreams and timeout handles, and issued `0` retries after disconnect.
- The current renderer design source pass restores the curated detailed
  three-headed Hydra raster for Dock/taskbar platform icons, app chrome, and
  sidebar branding while keeping the simplified generated H micro-mark
  separate for tiny surfaces. `npm run icons:generate` now regenerates platform
  icons from `public/hydra_dragon.png` without overwriting that master.
  Proximity response expands through dashboard command/empty actions, sidebar
  footer controls, and Settings action groups while keeping RAF batching,
  reduced-motion reset, and stable dimensions. Settings top cards align to
  equal rows and uniform action sizes. Splash branches switch from smooth
  splines to irregular neuron-like segments with one SVG-level glow; portal
  physics drops to the existing `30 Hz` paint cadence after collision masks
  disable and steering reuses the painted body snapshot.
- The 1.3.0 desktop refinement closes the remaining source-lane packaging and
  startup gaps: `npm start` no longer opens a browser unless `--browser` is
  explicitly passed for web-mode development; tag releases once again publish
  Linux x64 AppImage plus `latest-linux.yml`; Electron globally enables
  renderer sandboxing before readiness while each BrowserWindow keeps
  `sandbox:true`; the packaged renderer removes its blocked Google Fonts fetch
  and CSP-rejected data favicon; Settings names the 24-hour password-unlock
  window; and portal entry applies a collision-free upward release while nine
  bounded initial branches fill the neuron-like field. Three.js was reviewed
  against its manual-disposal guidance and intentionally not added because the
  finite 2D Matter/canvas scene already owns the correct lifecycle.

---

## Cleanup — Pull the Weeds

- `server/scripts/`, `scratch/`, and `videos/` audited on 2026-05-31: `scratch/`
  and `.scratch/` are absent; `server/scripts/` is down to the documented
  session lifetime probe after removing the dead `verify-fix.js`; `videos/`
  retains the packaged splash GIF and current packaged Electron gallery
  captures, while the superseded Remotion showreel workspace was moved
  reversibly to Trash
- `data/dev.db` was moved out of the runtime data directory to `/private/tmp/hydra-cleanup/data-dev.db-20260516`
- `.gitignore` covers generated/temp files including local DBs, build outputs, scratchpads, Playwright MCP captures, temp/quarantine files, local secrets temps, DB backups, and the root-scoped `.hydra-ci-data/` directory written by the isolated local CI runner
- Stale doc references were cleaned: `PROJECT_STRUCTURE.md` points at `desktop/entitlements.mac.plist`, and `ELECTRON_TROUBLESHOOTING.md` now describes the real packaged/dev port behavior
- Dependency audit is clean again as of 2026-05-18 19:52 PDT: a fresh `npm_config_cache=/private/tmp/hydra-npm-cache npm audit --json` found 0 vulnerabilities after the earlier moderate `brace-expansion@5.0.5` advisory under `@sentry/electron -> @sentry/node -> minimatch` was fixed by updating the nested lockfile entry to `brace-expansion@5.0.6`
- `scripts/free-dev-ports.mjs` now covers the default preview port 4173 and `HYDRA_EXTRA_DEV_PORTS`, and logs Unix/Windows inspect/kill failures with port/PID/error details instead of silently ignoring failed cleanup; `node --check scripts/free-dev-ports.mjs` and `npm run test:workflow-contract` passed on 2026-05-18
- Unused `react-window` and `react-virtualized-auto-sizer` dependencies were
  removed after the research plan confirmed the app does not use virtualization
  today; re-add virtualization only when a concrete large-list implementation
  lands
- `scripts/smoke-electron-package.mjs` now validates `HYDRA_BUILD_TARGET` against the packaged Chromium archive child (`chrome-mac-arm64`, `chrome-mac-x64`/`chrome-mac`, `chrome-linux`, or `chrome-win`) instead of accepting any Chromium-looking payload; it also validates the packaged app shell without launching the GUI by checking macOS `Info.plist`/`PkgInfo`, `CFBundleExecutable`, `CFBundlePackageType`, `CFBundleIdentifier`, main/helper executables, Windows/Linux main executables, rejecting nested `.app` bundles under `Resources`, and checking the distributable release artifact itself (macOS zip contents, Windows installer presence, Linux AppImage executable); PR and release workflows pass the matrix build target into `npm run electron:smoke`, and `server/tests/workflow-contract.test.mjs` locks down target-specific smoke, package-shell, artifact coverage, and actionable target-cache guidance from `scripts/prepare-electron-resources.mjs`
- `scripts/prepare-electron-resources.mjs` now distinguishes a local missing Chromium cache from a cross-target cache miss, tells the operator which runner/machine must build `darwin-arm64`, `darwin-x64`, `win32-x64`, or `linux-x64`, and names `PLAYWRIGHT_BROWSERS_PATH` as the explicit cache override; `HYDRA_BUILD_TARGET=win32-x64 npm run electron:prepare` failed intentionally on this Apple Silicon Mac on 2026-05-18 with that guidance, then `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:prepare` passed to restore the local staged ARM resources
- A Windows x64 NSIS artifact was refreshed on 2026-05-19 after staging Playwright's Windows payload into an isolated `/private/tmp/hydra-pw-cross` cache and redirecting Electron/electron-builder caches to `/private/tmp`; `release/Hydra-1.0.7-win-x64.exe` and its blockmap exist, `HYDRA_BUILD_TARGET=win32-x64 npm run electron:smoke` passed, and `file release/win-unpacked/Hydra.exe` reports `PE32+ executable (GUI) x86-64`. Actual Windows install/launch dogfood still requires Windows.
- `scripts/smoke-electron-package.mjs` now requires target-specific Prisma engines and the Windows installer blockmap during package smoke: Windows packages must contain `query_engine-windows.dll.node`, macOS ARM packages must contain the `darwin-arm64` Prisma engine, macOS Intel packages must contain the `darwin` Prisma engine, and `win32-x64` smoke requires the current-version Windows installer blockmap such as `release/Hydra-1.0.7-win-x64.exe.blockmap`. `HYDRA_BUILD_TARGET=win32-x64 npm run electron:smoke`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, `npm run test:workflow-contract`, `npm run test:cli`, and `npm run lint` passed after this hardening.
- Intel macOS packaging is kept on the generic `npm run electron:build:mac-x64` path. Build it on an Intel Mac or Intel macOS CI runner, then run `HYDRA_BUILD_TARGET=darwin-x64 npm run electron:smoke` and `codesign --verify --deep --strict --verbose=2 release/mac/Hydra.app` before publishing.
- The macOS Intel artifact was refreshed locally on 2026-05-18 with a staged `chrome-mac-x64` Playwright cache; `npm run electron:build:mac-x64`, `HYDRA_BUILD_TARGET=darwin-x64 npm run electron:smoke`, `file release/mac/Hydra.app/Contents/MacOS/Hydra`, and `codesign --verify --deep --strict --verbose=2 release/mac/Hydra.app` passed. Final Intel GUI dogfood still needs a real Intel Mac or compatible runner, but the x64 artifact is current.
- A 2026-05-18 crash report from Hydra showed `EXC_CRASH (SIGABRT)` in macOS `HIServices` `_RegisterApplication` with `Parent Process: node`, consistent with launching the packaged executable directly instead of opening the `.app` through LaunchServices. Packaged GUI dogfood must use `npm run electron:open:mac-arm64` / `open -n release/mac-arm64/Hydra.app`; `scripts/open-packaged-app.mjs`, `server/tests/workflow-contract.test.mjs`, and `hydra audit --json` lock down that LaunchServices path and warn against spawning `Contents/MacOS/Hydra` directly. A fresh 2026-05-18 17:17 PDT retry still hit sandbox LaunchServices `kLSNoExecutableErr` after bundle preflight OK; codesign and plist checks passed, opener diagnostics showed arm64 Mach-O, only `com.apple.provenance` xattrs and no `com.apple.quarantine`, Computer Use denied `com.zayd.hydra`, and Computer Use `list_apps` did not show Hydra running, so packaged GUI dogfood remains an external/manual Electron-app blocker rather than a browser task.
- `scripts/open-packaged-app.mjs` now preflights the packaged `.app` before LaunchServices handoff by checking `CFBundlePackageType=APPL`, reading `CFBundleExecutable`, and verifying the declared executable exists and is executable. It also prints package diagnostics in one place: bundle identifier, main executable type, root/executable xattrs, quarantine status, `codesign --verify --deep --strict`, `codesign -dv --verbose=4`, LaunchServices output, and process lookup after a successful `open`. `node --check scripts/open-packaged-app.mjs`, `npm run test:workflow-contract`, and `npm run lint` passed on 2026-05-18; the current sandbox still fails at the LaunchServices layer after printing bundle/executable OK.
- `scripts/smoke-electron-package.mjs` now chooses resources from `HYDRA_BUILD_TARGET` before falling back to mtime, so ARM smoke cannot accidentally inspect the newer x64 package when both artifacts exist. It also verifies the packaged macOS window source still uses `frame: useNativeMacChrome` and rejects `titleBarStyle`/`trafficLightPosition` overrides in the built app resources. `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, `HYDRA_BUILD_TARGET=darwin-x64 npm run electron:smoke`, and `HYDRA_BUILD_TARGET=win32-x64 npm run electron:smoke` passed on 2026-05-18 after this hardening.
- `docs/PACKAGED_ELECTRON_DOGFOOD.md` is the final acceptance runbook for packaged app dogfood. It requires LaunchServices app launch, forbids browser/Vite screenshots as blocker-closing evidence, keeps screenshot audit last, and gives an evidence table for native window controls, navigation, live OTP, bulk OTP, redemption, proxy/SSE, Windows installer, Docker runtime, tray/menu, Touch ID, no-network recovery, and screenshots.
- `npm run gate` and `npm run build` passed again on 2026-05-18 17:06 PDT after the packaged dogfood runbook, audit, package-smoke, and docs consistency updates.
- `scripts/generate-icons.mjs`, `scripts/testing/test-trpc-routes.mjs`, `electron/tests/path-allowlist.test.mjs`, and `server/tests/playwright-isolation.test.mjs` no longer hide utility/probe/test-cleanup failures behind empty catches; the tRPC probe imports server services from the repo root, reports Clerk JWT refresh fallback and malformed JSON parse failures, and `server/tests/workflow-contract.test.mjs` locks down the utility source contracts
- Packaged macOS GUI chrome was promoted to a live goal blocker on 2026-05-18 after the user observed the app open on screen but could not close, move, grab the top bar, or see the red/yellow/green traffic-light controls. `electron/app/windows.js` now uses a standard native macOS frame with no hidden-inset titlebar override, and `src/App.jsx` returns no renderer-owned AppChrome on Mac so AppKit owns the red/yellow/green controls and titlebar drag area. Renderer-owned window controls remain only for non-Mac platforms.
- `npm run lint`, `npm run build`, `node --check scripts/free-dev-ports.mjs`, `npm run test:workflow-contract`, `npm run test:electron-main-process`, `npm run test:ui-static`, `ELECTRON_CACHE=/private/tmp/hydra-electron-cache npm run electron:build:mac-arm64`, `HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke`, and `codesign --verify --deep --strict --verbose=2 release/mac-arm64/Hydra.app` passed on 2026-05-18; packaged GUI dogfood and final Electron-only screenshot audit remain tracked in `docs/RELEASE_AUDIT.md`
- `npm run gate`, full `npm test`, `git diff --check`, and `node bin/hydra.mjs audit --json` passed on 2026-05-18 after the dev-port cleanup hardening, utility/test cleanup visibility pass, package rebuild, native macOS titlebar fix, CLI runtime-diagnostics consistency pass, target-specific Chromium smoke hardening, package-shell smoke hardening, Windows artifact smoke, macOS Intel x64 refresh, final dogfood-runbook wiring, and dependency-audit lockfile fix. Full `npm test` passed again on 2026-05-19 after adding the private `hydra mcp` stdio server and wiring `test:mcp` into the main test chain. `node bin/hydra.mjs audit --json` now reports `complete=false`, `checked=32`, `ok=28`, `deferred=4`, `missing=0`, and `blockers=0`; packaged GUI dogfood, live MVP dogfood, packaged screenshot audit, and Docker runtime smoke remain deferred/manual evidence gaps instead of being treated as finished. Fresh 2026-05-19 probes show LaunchServices failing for both Calculator and Hydra from this shell, and Docker Desktop not running with sandbox-denied log access.
- Docker image construction passed after moving the builder and runtime images to `node:22-bookworm`; local Docker runtime availability remains an environment dependency tracked in `docs/RELEASE_AUDIT.md`
- Bulk Auth wizard work now has an owned lifecycle boundary: route unmount aborts
  active Magic Link status probes, live-session confirmation probes, bulk-stub
  requests, and send/resend requests; it also cancels staggered Magic Link send
  delays immediately instead of leaving detached timers behind. The lifecycle
  ref resets on mount so React remounts do not inherit stale unmounted state.
  A 200-wizard synthetic unmount probe at
  `/private/tmp/hydra-bulk-auth-unmount-benchmark-20260531T154607Z` recorded
  `2400` timeout resources and `600` pending requests after old-shape unmount
  versus `0` and `0` after owned cleanup; the new path aborted all `600`
  simulated requests. Focused lifecycle (`28/28`), UI static (`35/35`), lint,
  full test, build, OpenAPI, serial gate (`12/12`), diff, isolated arm64 package
  smoke, strict deep codesign, bundled marker inspection, and Spotlight
  uniqueness checks passed. The temporary package moved reversibly to
  `/Users/zaydk/.Trash/hydra-package-bulk-auth-abort-20260531T154837Z`.

---

## CI/CD Pipeline

- `.github/workflows/release.yml` on `v*` tag push
- Matrix: macOS-latest (ARM), windows-2022, ubuntu-22.04
- Release workflow builds with `electron-builder --publish never`, runs package smoke, then uploads verified artifacts with `gh release upload`
- CI job on every PR: lint + test + gate + electron:smoke
- `server/tests/workflow-contract.test.mjs` is wired into `npm test` and locks
  the CI/release/package-smoke workflow contracts for Node 24, GitHub Actions
  Node 24 runtime opt-in, Windows x64 NSIS, macOS zips, Linux AppImage,
  artifact upload, and packaged smoke

---

## Tests — Fill the Gaps

- `npm test` now runs every normal `server/tests/*.test.mjs` file through package scripts; dormant auth-cookie, gzip middleware, ErrorBoundary sanitization, Prisma error classification, phase-1 compatibility, management-key backfill, and Electron Prisma-asar tests are wired into the main chain
- Workflow contract coverage is implemented in `server/tests/workflow-contract.test.mjs` so the PR package-smoke matrix and release artifact matrix cannot silently drop Windows packaging, Node 24 runtime coverage, packaged resource smoke, or artifact upload
- Preload/IPC bridge contract tests are implemented: `server/tests/electron-ipc-contract.test.mjs` verifies every `native:*` handler returns a Result envelope and renderer calls use the wrapper
- Session-refresh and dashboard-data regression coverage is implemented through `server/tests/session-refresh-contract.test.mjs`, `server/tests/session-expiry-effective.test.mjs`, `server/tests/ensure-session-backfill.test.mjs`, and `server/tests/electron-api-integration.test.mjs`; live OTP dogfood remains tracked in `docs/RELEASE_AUDIT.md`
- UI static contracts include first-run setup wizard, persisted Settings preference-toggle coverage, dense app-shell polish, and the Anime.js `signal` text treatment using `splitText().addEffect()` plus `splitter.revert()` cleanup; `npm run test:ui-static` passed with 18 tests on 2026-05-18 after the shell polish and Dashboard text-effect update
- The living design-engineering reference now records the sidebar proximity
  field, bounded account-grid magnetic response, Settings/action-group motion,
  Anime.js split-text cleanup, falling-glyph one-shot shatter guard,
  collision-free portal cadence, deterministic disposal diagnostics, and
  reduced-motion invariants in `docs/DESIGN_ENGINEERING.md`.
- A pending-`1.3.0` rebuilt-package idle reprofile at
  `/private/tmp/hydra-130-second-untouched-idle-reprofile-20260531T124730`
  retained four Hydra-owned processes and zero stale profiles across all 11
  30-second samples. Aggregate Hydra CPU stayed between `0.0%` and `0.1%`
  (`0.018%` average); RSS moved by `+3.11 MiB`.
- The exact-local `1.3.0` arm64 package rebuilt cleanly after the hosted source
  checkpoint, passed explicit-resource package smoke, strict deep codesign,
  restored-icon comparison, manifest/bundle version checks, Spotlight
  uniqueness, and LaunchServices registration. Native-only Computer Use
  captured the versioned splash and exposed the replacement Dashboard title
  plus native controls after handoff. Exact-local raw evidence is under
  `/private/tmp/hydra-130-versioned-native-launch-20260531T130322`.
- Public `v1.3.0` is published from release commit
  `a00d9c298eb9d31641f80f82d95df84f16d1079d`. Auto-version run
  `26723122013`, master CI run `26723122028`, hosted Docker run
  `26723122021`, and desktop matrix run `26723127043` passed. The downloaded
  public asset matrix matches GitHub SHA-256 digests, both macOS archives match
  merged updater SHA-512 values, and the exact-public arm64 zip is installed as
  the sole Spotlight/LaunchServices Hydra bundle. Its no-debug native launch
  settled to four owned processes at `0.0%` CPU with zero stale profiles.
  Computer Use could list the canonical app but could not attach to the public
  Dashboard CoreGraphics window, so interactive screenshot and magnetic-grid
  acceptance remain explicit user-facing boundaries.
- `/private/tmp/hydra-v130-public-post-closeout-idle-profile-20260531T132928`
  sampled the untouched exact-public `v1.3.0` package every 30 seconds for five
  minutes. All 11 samples retained four Hydra-owned processes and zero stale
  profiles. Aggregate CPU stayed between `0.0%` and `0.4%` (`0.091%` average),
  `33.2%` below the exact-public `v1.1.5` calm baseline; RSS moved by
  `+1.86 MiB`. The same native-only pass produced
  `docs/evidence/hydra-v130-packaged-dashboard-privacy-redacted.png` through
  CoreGraphics and `/usr/sbin/screencapture -l`, with all content below the
  titlebar pixelated before check-in and zero credential-shaped or
  endpoint-shaped OCR hits. This preserves provenance without claiming the
  deferred interactive route review.
- Public `v1.4.0` is published from release commit
  `700999bcb0a54afa7e8f9379fb01d69c6b49e10d`. Auto-version run
  `26724119200`, master CI run `26724119194`, hosted Docker run
  `26724119196`, and desktop matrix run `26724123318` passed. The downloaded
  public asset matrix matches GitHub SHA-256 digests; both Mac archives, the
  Windows installer, and the Linux AppImage match updater SHA-512 values. The
  exact-public arm64 zip passed strict deep codesign and explicit-resource
  package smoke before installation as the sole Spotlight Hydra bundle.
- `/private/tmp/hydra-v140-public-native-launch-20260531T140421` records the
  no-debug exact-public `v1.4.0` LaunchServices launch. CoreGraphics exposed one
  `Hydra — Dashboard` window at `1440x900`, no listener existed on `9333` or
  `9334`, and a settled doctor snapshot reported four owned processes at
  `0.0%` CPU, `591.00 MB` RSS, and zero stale profiles. The checked-in dogfood
  manifest was regenerated conservatively with only `packaged-gui-launch`
  verified; interactive route review, magnetic-grid visual review, live
  account flows, Touch ID fingerprint approval, and real Windows NSIS
  install/open UX remain explicit manual boundaries.
- `/private/tmp/hydra-v140-public-post-closeout-idle-profile-20260531T141703`
  sampled the untouched exact-public `v1.4.0` package every 30 seconds for five
  minutes. All 11 samples retained the same four Hydra-owned PIDs and zero
  stale profiles. Aggregate CPU stayed between `0.0%` and `0.1%` (`0.064%`
  average), `53.2%` below the exact-public `v1.1.5` calm public baseline; RSS
  moved from `600.36 MiB` to `593.58 MiB` (`-6.78 MiB`). Before/after broad
  process inventories, anchored Hydra-owned subsets, doctor snapshots, and
  `summary.json` remain preserved locally.
- `/private/tmp/hydra-live-session-recheck-v140-20260531T212329Z/redacted-summary.json`
  is an owner-only (`0600`) aggregate from 12 sequential production
  `store.probeSessionLive()` calls through `hydra session <id> --refresh
  --json`. All 12 probes completed without failures or decrypt errors: four
  logins remained active and redeem-ready, eight remained explicit OTP re-auth
  candidates, active cookie stacks stayed at one Clerk identity, and one
  active login remained intentionally independent of management-key state.
  The artifact contains no account identifiers or secret material.
- The exact-public `v1.4.0` post-closeout local verification chain passed
  `npm run lint`, full `npm test`, `npm run gate` (`12/12`), `npm run build`,
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
- A fresh untouched exact-public `v1.4.0` post-native-capture sampler at
  `/private/tmp/hydra-v140-post-native-anchor-idle-reprofile-20260531T224017Z`
  retained four packaged Hydra processes and zero stale Hydra Playwright
  profiles across 11 samples over five minutes. CPU stayed between `0.0%` and
  `0.7%` (`0.082%` average, `0.0%` ending); RSS moved from `498.50 MiB` to
  `499.22 MiB` (`+0.72 MiB`). No Computer Use attach occurred during this
  valid calm-runtime pass.
- Hosted Windows lifecycle smoke now covers the generated NSIS artifact
  instead of only `release/win-unpacked/Hydra.exe`: isolated silent install,
  installed-app startup, owned-process cleanup, copied-uninstaller execution,
  and zero-residue verification. Checkpoint
  `e0a887b02f5da8d20c555022013396213e8732c3` timeout-bounds slow hosted NSIS
  extraction at five minutes and uninstall at one minute. Timeout-bounded
  release dispatch `26726921936` passed Linux AppImage, both macOS zips, and
  Windows x64 NSIS; the Windows log retained each real executable tree for
  `25,000ms`, cleaned both trees, and removed the temporary install directory.
  CI run `26726917980` and Docker runtime-smoke/registry run `26726917984`
  passed. Interactive NSIS installer click-through remains a real Windows
  desktop manual boundary.
- `hydra audit` now parses documented `Docker workflow run` checkpoints with
  whitespace-tolerant matching so normal Markdown wrapping cannot silently
  leave stale runtime-smoke evidence in CLI output. The CLI regression derives
  the newest documented checkpoint and requires the reported Docker evidence
  to match it; current output records `26726917984`.
- A fresh untouched exact-public `v1.4.0` post-parser sampler at
  `/private/tmp/hydra-v140-post-audit-parser-idle-reprofile-20260531T231558Z`
  retained four packaged Hydra processes and zero stale Hydra Playwright
  profiles across 11 samples over five minutes. CPU stayed between `0.0%` and
  `0.1%` (`0.009%` average, `0.0%` ending); RSS moved from `502.16 MiB` to
  `500.19 MiB` (`-1.97 MiB`). No Computer Use attach occurred during this
  valid calm-runtime pass.
- The exact final local acceptance-item-11 chain passed against the downloaded
  public `Hydra-1.4.0-mac-arm64.zip` asset after SHA-256 verification at
  `320bb60fc3400449fb9c34d4003c5afd9811337c3c9e8cf08f074921fa5e4dac`:
  `npm run lint && npm test && npm run gate &&
  HYDRA_BUILD_TARGET=darwin-arm64 npm run electron:smoke && npm run
  docker:smoke && npm run openapi:hydra`. Gate remained `12/12`, strict deep
  `codesign` passed, Docker smoke rebuilt the production image and launched
  the isolated full-Chromium path, OpenAPI retained `83 operations`,
  `docker compose ps --all` returned no residual services, and the temporary
  public-zip symlink moved reversibly to Trash afterward. Docker Desktop was
  restored to its prior stopped state through `docker desktop stop`.
- Exact-final-chain evidence checkpoint
  `c0bce57a814b9e3cf066959f5cce68c2ea6ac198` used `[skip-bump]`;
  Auto-version run `26727636115` skipped, CI run `26727636112` passed, and
  Docker workflow run `26727636121` passed runtime smoke plus registry image
  push.
- A final exact-public `v1.4.0` Computer Use route-review retry reproduced the
  known native accessibility blocker: `get_app_state("com.zayd.hydra")`
  timed out after `120s`, external `SkyComputerUseService` held `28.8%` CPU,
  and Hydra's otherwise-idle main process held `66.5%`. Terminating only the
  external helper returned the unchanged four-process tree to `0.0%` sampled
  CPU and zero stale profiles. AppKit foreground activation plus Quartz safe
  clicks could not drive the route, and Computer Use follow-up input was
  unavailable because the attach never became active. Raw owner-only evidence
  is under
  `/private/tmp/hydra-v140-cua-route-review-retry-20260531T233933Z`.
- Native CoreGraphics screenshot provenance was refreshed after recovery:
  packaged window `2637` (`Hydra — Dashboard`, `1440x900 @ 36,34`) produced
  one owner-only `2880x1800` Retina capture outside Git under
  `/private/tmp/hydra-v140-native-dashboard-refresh-20260531T234102Z`,
  SHA-256
  `a404d421b26765396677c9d0708a3985c942ae0ab778971b0b99abb9db014036`.
  This does not promote the still-manual interactive route review.
- A final server-runtime ownership sweep found one additional request-log
  shutdown bug: an already-active buffered flush made
  `flushRequestLogBuffer()` return immediately, allowing
  `stopRequestLogBuffer()` to advance without joining the database write.
  `server/services/request-log-buffer.js` now owns one shared `flushPromise`,
  joins concurrent flush and stop callers, emits bounded timeout-warning
  evidence with remaining queue length, and exposes `flushInFlight` in its
  snapshot. `npm run test:request-log-buffer` passed `5/5`, including the
  active-join regression and forced `25ms` timeout-warning path. Full `npm
  test`, lint, Vite build, gate (`12/12`), and OpenAPI generation (`83
  operations`) also passed before rebuilding.
- The hardened current-source local arm64 package rebuilt successfully.
  Package smoke and strict deep `codesign` passed; inspection of the packaged
  server copy confirmed the request-log ownership fix. Its local zip checksum
  is `192ab474457a1bd25cabc113e9b81982959a3161cfc644f81df7844ae53049f8`;
  this is current-source local evidence, not a new published artifact.
  LaunchServices evidence is under
  `/private/tmp/hydra-v140-request-log-current-source-launch-20260531T235242Z`.
- A five-minute untouched post-rebuild profile under
  `/private/tmp/hydra-v140-request-log-post-rebuild-idle-reprofile-20260531T235339Z`
  retained four packaged processes and zero stale Hydra Playwright profiles
  across all 11 samples. CPU stayed between `0.0%` and `2.4%` (`0.227%`
  average, `0.0%` ending), including the first startup-settling sample; RSS
  moved from `590.58 MiB` to `591.83 MiB` (`+1.25 MiB`). The post-sampler
  doctor snapshot remained calm at four processes, `0.0%` CPU, `592.25 MB`
  RSS, and zero stale profiles. No Computer Use helper remained, Docker
  Desktop remained stopped, and a targeted Desktop search found only the
  canonical `release/mac-arm64/Hydra.app`.
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
- The next runtime ownership sweep found that `rotationManager.cancelReload()`
  discarded its dedupe promise before a non-abortable Prisma-backed pool
  reload necessarily finished unwinding, while graceful shutdown did not
  await cancellation. The manager now owns one coalesced reload promise,
  aborts stale work for a fresh rerun, joins cold-load and reload promises
  during cancellation, and logs non-abort unwind failures. Shutdown awaits the
  join before continuing. New direct rotation-manager regressions passed
  `3/3`; background visibility contracts passed `32/32`; lint, full `npm
  test`, Vite build, gate (`12/12`), OpenAPI generation (`83 operations`), and
  diff check passed before packaging.
- The pre-rebuild package quit natively in one second with broad before/after
  inventories under
  `/private/tmp/hydra-v140-rotation-rebuild-shutdown-20260601T001750Z`. The
  hardened current-source local arm64 package rebuilt successfully; package
  smoke, strict deep `codesign`, bundle-version inspection, and embedded-source
  inspection passed. The local zip checksum is
  `5843e00514abc9932ddeb3dba83cc37a5bdcc618ae10eaac935608aa6dd372fc`;
  this is current-source local evidence, not a new published artifact.
  LaunchServices handoff evidence is under
  `/private/tmp/hydra-v140-rotation-current-source-launch-20260601T001924Z`.
- The first post-rebuild untouched profile under
  `/private/tmp/hydra-v140-rotation-post-rebuild-idle-reprofile-20260601T002013Z`
  retained four processes and zero stale profiles across 11 samples while
  launch settling moved from `4.5%` to `0.9%` CPU (`1.0%` average) and RSS
  dropped `24.25 MiB`. A short main-process stack sample under
  `/private/tmp/hydra-v140-rotation-hot-split-20260601T002143Z` was
  predominantly parked in `CFRunLoop`/`mach_msg`, not spinning in JS or
  HIServices. A denser settled follow-up under
  `/private/tmp/hydra-v140-rotation-dense-idle-20260601T002536Z` captured 12
  samples at `0.0...0.2%` CPU (`0.025%` average, `0.0%` ending), with four
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
  `codesign` passed afterward. Temporary package-smoke symlinks to the local
  current-source zip and blockmap were moved reversibly to
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
- A continuation idle profile under
  `/private/tmp/hydra-v140-continuation-idle-reprofile-20260601T015213Z`
  retained four packaged processes and zero Hydra Playwright profiles across
  11 samples. Aggregate CPU ended at `0.000%` but included one `23.300%`
  transient; the follow-up main stack sample was parked in
  `CFRunLoop`/`mach_msg`, and the concurrent doctor snapshot recorded `186`
  externally owned browser-tool processes at `290.6%` aggregate CPU.
- The shared batch runner now makes inter-chunk waits abort-aware and unref'd.
  Client disconnects and task-supervisor cancellation stop future account
  import, OTP-stub, provisioning, bulk-redemption, matrix-redemption, and
  dashboard-runner chunks. Renderer helpers accept request signals, and
  bulk-redemption task metadata no longer retains the raw code. New direct
  regressions passed `5/5`; the benchmark at
  `/private/tmp/hydra-batch-disconnect-benchmark-20260601T020048Z/summary.txt`
  reduced `200` post-disconnect worker calls to `0`, with all `200` synthetic
  requests aborted and settlement reduced from `102.030ms` to `7.247ms`.
  Background visibility contracts passed `32/32`, UI static contracts passed
  `39/39`, chain completeness passed `1/1`, and the full no-Docker source
  chain passed lint, full `npm test`, Vite build, gate (`12/12`), OpenAPI
  generation (`83 operations`), and diff check.
- Pre-rebuild native shutdown removed all four packaged Hydra processes in one
  second with evidence under
  `/private/tmp/hydra-v140-batch-abort-rebuild-shutdown-20260601T020334Z`.
  Current-source arm64 rebuild, ARM package smoke, strict deep `codesign`,
  bundle version (`1.4.0`), and embedded abort-wiring inspection passed. The
  local zip SHA-256 is
  `8bb94844319f96edecabd94059139e28c9508aafa326ed7f6476e174684c4700`.
  LaunchServices handoff evidence is under
  `/private/tmp/hydra-v140-batch-abort-current-source-launch-20260601T020511Z`.
  Generated packaging byproducts moved reversibly to
  `~/.Trash/hydra-batch-abort-current-source-package-20260601T021151Z`.
- The untouched post-rebuild profile under
  `/private/tmp/hydra-v140-batch-abort-post-rebuild-quiet-idle-20260601T020610Z`
  retained four packaged processes across 11 samples. Aggregate Hydra CPU
  stayed exactly `0.000%`; RSS moved from `603520 KiB` to `609472 KiB`
  (`+5952 KiB`). The broad sampler matcher counted its own shell command once;
  authoritative `hydra doctor --json` reported zero Hydra Playwright profiles.
- The detached-batch final literal local chain passed lint, full `npm test`,
  gate (`12/12`), ARM package smoke, Docker smoke with a rebuilt production
  image and successful isolated full-Chromium Playwright launch, OpenAPI
  generation (`83 operations`), and diff check in order. Strict deep
  `codesign` passed afterward. `docker compose ps --all` returned no services,
  no `hydra_default` network remained, and Docker Desktop stopped cleanly in
  one second. Temporary package-smoke symlinks moved reversibly to
  `~/.Trash/hydra-batch-abort-final-smoke-links-20260601T021709Z`;
  `release/` again contains only `mac-arm64/Hydra.app`, Spotlight resolves
  exactly that one Hydra bundle, and the rebuilt package remains live with
  four owned processes.
- CLI command tests are implemented in `server/tests/cli.test.mjs`; `npm run test:cli` passed with 43 tests on 2026-05-19, including the closed-app `hydra audit` evidence checks, guarded redacted metadata import, reversible DB reset, system-command data-dir consistency, packaged Chromium zip doctor detection, status warning-channel, log-tail follow behavior, local `/v1` AI chat, direct OpenRouter-compatible `ai chat --route direct`, `hydra openrouter models/key/credits`, lazy direct-OpenRouter cache writes, and stop timeout/non-JSON source-contract coverage. `server/tests/mcp-cli.test.mjs` additionally covers `hydra mcp --list-tools` and framed stdio JSON-RPC `initialize`/`tools/list`/`tools/call`.
- API integration tests now boot a real Express server on port 0 and assert concrete auth/proxy/shutdown HTTP contracts; `npm run test:api-integration` passed on 2026-05-16
- Browser isolation regression test asserts default launches do not use real Chrome, every managed `userDataDir` is fresh under the OS temp dir and never points at real Chrome/Chromium profile dirs, packaged mode extracts archived Chromium into userData, and stale profile sweep failures keep path-level warning evidence; `npm run test:browser-isolation` passed on 2026-05-17

---

## Manual Acceptance — Deferred From Codex Scope

- Packaged GUI dogfood, screenshot auditing, Intel launch, and Windows launch are currently deferred from the Codex plan at the user's request.
- If this scope is reopened later, it must target the packaged Electron app only. Chrome, `vite preview`, localhost browser tabs, and browser-only screenshots remain development aids and must not close Electron acceptance evidence.
- The active Codex work should continue with code-verifiable fixes: CLI/API behavior, OpenRouter endpoint coverage, static UI quality, lint/build/test failures, source contracts, package-resource smoke checks, docs drift, and audit consistency.
