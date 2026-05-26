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
- Remotion plan: use refreshed Electron screenshots as assets under `videos/`, create a short 20-30 second product-facing composition covering vault setup, dashboard, proxy pool, traffic, CLI automation, and local API router. Render a still first with `npx remotion still <composition-id> --scale=0.25 --frame=30`, then render final MP4/GIF only if artifact size is GitHub-friendly and reference it from README.
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

- Generate an OpenAPI spec from Hydra's Express routes (reference `docs/API_REFERENCE.md`): `npm run openapi:hydra` writes `docs/hydra-api.openapi.json`.
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

---

## Cleanup — Pull the Weeds

- `server/scripts/`, `scratch/`, and `videos/` audited on 2026-05-16: `scratch/` and `.scratch/` are absent; `server/scripts/` is down to the documented session lifetime probe after removing the dead `verify-fix.js`; `videos/` is tracked showreel/Remotion source and is retained
- `data/dev.db` was moved out of the runtime data directory to `/private/tmp/hydra-cleanup/data-dev.db-20260516`
- `.gitignore` covers generated/temp files including local DBs, build outputs, scratchpads, Playwright MCP captures, temp/quarantine files, local secrets temps, and DB backups
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
- CLI command tests are implemented in `server/tests/cli.test.mjs`; `npm run test:cli` passed with 43 tests on 2026-05-19, including the closed-app `hydra audit` evidence checks, guarded redacted metadata import, reversible DB reset, system-command data-dir consistency, packaged Chromium zip doctor detection, status warning-channel, log-tail follow behavior, local `/v1` AI chat, direct OpenRouter-compatible `ai chat --route direct`, `hydra openrouter models/key/credits`, lazy direct-OpenRouter cache writes, and stop timeout/non-JSON source-contract coverage. `server/tests/mcp-cli.test.mjs` additionally covers `hydra mcp --list-tools` and framed stdio JSON-RPC `initialize`/`tools/list`/`tools/call`.
- API integration tests now boot a real Express server on port 0 and assert concrete auth/proxy/shutdown HTTP contracts; `npm run test:api-integration` passed on 2026-05-16
- Browser isolation regression test asserts default launches do not use real Chrome, every managed `userDataDir` is fresh under the OS temp dir and never points at real Chrome/Chromium profile dirs, packaged mode extracts archived Chromium into userData, and stale profile sweep failures keep path-level warning evidence; `npm run test:browser-isolation` passed on 2026-05-17

---

## Manual Acceptance — Deferred From Codex Scope

- Packaged GUI dogfood, screenshot auditing, Intel launch, and Windows launch are currently deferred from the Codex plan at the user's request.
- If this scope is reopened later, it must target the packaged Electron app only. Chrome, `vite preview`, localhost browser tabs, and browser-only screenshots remain development aids and must not close Electron acceptance evidence.
- The active Codex work should continue with code-verifiable fixes: CLI/API behavior, OpenRouter endpoint coverage, static UI quality, lint/build/test failures, source contracts, package-resource smoke checks, docs drift, and audit consistency.
