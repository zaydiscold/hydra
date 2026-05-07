# Hydra — Claude Code Instructions

## 🏗️ Current State (2026-05-06)

**Hydra is shipping as a native Electron desktop app.** The Docker path still
exists in-repo but is no longer the primary distribution channel.

**Branch:** `master` | **DMG output:** ~272 MB / app size ~683 MB (Chromium for Playwright is the bulk; lazy-download is a planned win — see ROADMAP_NEXT)

### Major architectural pieces

- **Process model:** `electron/main.js` boots an embedded Express server on a
  random `127.0.0.1:<port>` (preferred 3001 in dev), then opens a BrowserWindow
  pointed at it. Closing the window keeps the proxy alive in the tray; "Quit
  Hydra" actually shuts it down via `before-quit` → `shutdownEverything`.
- **Renderer ↔ main bridge:** `electron/preload.js` exposes `window.hydraNative`,
  but renderer code MUST use **`src/lib/native.js`** (`native.X()` / `tryNative()` /
  `useNativeInfo()` / `isElectron()`). The wrapper unwraps the `{ok, data, error}`
  Result envelope and throws a typed `NativeError` on failure — never call the
  bridge directly.
- **State:** Mutable singletons in `electron/app/state.js`. IPC handlers in
  `electron/app/ipc.js` read state directly (no callback args). Adding a new IPC?
  Register it there + `preload.js` + `src/lib/native.js`'s `native` facade.

### What just shipped (latest session, 2026-05-06)

- ✅ **Splash min-visible time** bumped to 7 s (`SPLASH_MIN_VISIBLE_MS` in
  `electron/main.js` paired with the `fillbar` keyframe in
  `electron/app/windows.js` — keep both in lockstep).
- ✅ **Renderer Result-type wrapper** (`src/lib/native.js`) — all renderer
  bridge calls go through it. Old direct `window.hydraNative.*` is forbidden.
- ✅ **Startup error dialog** with Open Logs / Copy Details / Quit buttons
  (`electron/app/startupError.js`). Replaces every `dialog.showErrorBox` call
  in `main.js`.
- ✅ **Help menu polish** — Documentation, Report Issue, Diagnostics (`⌘D`),
  Show Logs Folder, Show Data Folder, Build Info (with copy).
- ✅ **macOS code-sign + notarize plumbing** (`electron/builders/notarize.cjs`,
  wired into `electron-builder.yml` `afterSign`). No-op without `APPLE_ID` /
  `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` env vars.
- ✅ **Opt-in Sentry crash telemetry** (`electron/app/telemetry.js`).
  Off by default; gated on `HYDRA_SENTRY_DSN` env var + Settings toggle.
  PII scrubbing for `sk-or-…`, `sk-hydra-…`, `__session=`, `__client=`,
  `Bearer …`, and home-directory paths.
- ✅ **Touch ID biometric unlock** (`electron/app/biometric.js`). Uses
  Electron's built-in `systemPreferences.promptTouchID()` — no external dep.
  Settings toggle gates the persisted auth token via Touch ID prompt on read.
  Windows Hello stubbed for later, Linux not supported.
- ✅ **User preferences store** (`electron/app/userPrefs.js`). JSON-backed
  key/value at `userData/preferences.json` (mode 0600, atomic rename).
  Used for `telemetryEnabled`, `biometricEnabled`, future theme/UI toggles.
- ✅ **Bug fixes:**
  - `native:hide-window` / `native:quit-app` IPC handlers were silently
    no-op (callbacks never wired). Now read state directly.
  - `handleShutdownConfirmed` no longer triggers the Keep-Running prompt
    after killing the server — routes through `quitApp()` instead.
  - Hardcoded `:3001/v1` fallback in Settings + appMenu now reads the live
    port via `native.status()`.
  - Magic-link callback HTML escapes `pending.email` and `err.message`
    (was a reflected-XSS vector).
  - `/api/shutdown` response now uses `{ok, data}` envelope (was
    `{success, message}` — last outlier in the API).
  - `userPrefs.js` rename failures now invalidate the cache (was leaving
    stale in-memory state if disk write failed).

### Where to pick up

- `docs/ROADMAP_NEXT.md` — only one item left planned: the **first-launch
  onboarding wizard (#7)**. Everything else has shipped.
- `docs/_archive/2026-05-06-reviews/` — full punch lists from the security,
  perf, sweep, and swarm reviews. All flagged criticals + highs are addressed
  in current code; remaining items are low-priority polish tracked in the
  swarm doc.
- `docs/_archive/historical/` — completed plans (Implementation, Electron
  Master Plan, Project Status April 2026, SitRep, Docker Plan). Reference
  only — code state is current truth.

---

## Do not be lazy

Do not be lazy. We are the hardest workers; that's what separates the boys from the men. If you see something wrong, fix it — don't note it, don't table it, fix it. A loose wire left alone doesn't stay loose — it arcs, it shorts, it takes down the whole circuit. Every skipped fix is technical debt that compounds. Every "good enough" is a lie you'll pay for later. Be paranoid. Assume something is wrong. Check the wiring.

## Agent reading order

1. Read this file for repo-level rules.
2. Read `~/.claude/plans/hydra_plan.md` for the current living plan and research log.
3. Read task-relevant docs and code before making changes.

## gstack

gstack is installed globally at `~/.claude/skills/gstack`. Also installed in Hermes.

**Browser tools — use in this order:**
1. `/browse` (gstack) — fast headless Chromium, ~100ms/cmd, best for QA/scraping/testing
2. `mcp__chrome-devtools__*` — DevTools protocol, good for JS eval, network inspection
3. `mcp__claude-in-chrome__*` — only when login session is strictly required (has access to your Chrome cookies/sessions); slower
4. `mcp__executeautomation-playwright-server__*` — Playwright MCP, full browser automation
5. CamoFox — if installed, use for fingerprint-resistant browsing

**Never use** `mcp__claude-in-chrome__*` for basic browsing — use `/browse` instead. Reserve chrome-in-claude for authenticated sessions only.

Available gstack skills:
`/office-hours` `/plan-ceo-review` `/plan-eng-review` `/plan-design-review` `/design-consultation` `/design-shotgun` `/design-html` `/review` `/ship` `/land-and-deploy` `/canary` `/benchmark` `/browse` `/connect-chrome` `/qa` `/qa-only` `/design-review` `/setup-browser-cookies` `/setup-deploy` `/retro` `/investigate` `/document-release` `/codex` `/cso` `/autoplan` `/plan-devex-review` `/devex-review` `/careful` `/freeze` `/guard` `/unfreeze` `/gstack-upgrade` `/learn` `/pair-agent` `/health` `/checkpoint`

## Master Plan
**→ `~/.claude/plans/hydra_plan.md`** — the living todo/plan/research log. Always read this before starting work. Append new findings, mark completed items, keep it current.

**When the user says "display plan", "show plan", "show status", "what's the plan", or similar:** read `~/.claude/plans/hydra_plan.md` and output a status table grouped by P0/P1/P2/P3/P4 showing ✅ done / 🟡 in progress / ❌ not started for every item.

## Critical Rules

### Route/Controller Binding
ALL Express route handlers that call controller methods MUST use one of these patterns:
- `controller.method.bind(controller)` — for singleton-exported controllers
- `(req, res) => controller.method(req, res)` — for instance-per-file controllers

**Never** pass a bare method reference like `Controller.method` without `.bind()`. In ES module strict mode, `this` will be `undefined` inside the handler, causing `TypeError: Cannot read properties of undefined (reading '...')` for any `this.success()` / `this.error()` call.

### API Key Validation
Do not add format-based pre-validation for OpenRouter management keys or standard keys beyond checking that the value is non-empty. Let the OpenRouter API be the authority — it returns descriptive errors if a key is invalid.

### Encrypted Account Data
`store.getAllAccountsWithKeys()` and related functions use `readConfig()` / `readSessionToken()` which decrypt AES-256-GCM blobs. These can fail if secrets have been rotated. Handle failures per-account (skip corrupt record, don't throw for the whole list).

### Renderer ↔ Native Bridge
- Never call `window.hydraNative.X()` directly from `src/`. Always use `src/lib/native.js`:
  - `native.X()` — throws `NativeError` on `{ok:false}`, returns unwrapped data on success
  - `tryNative(call)` — returns `null` on failure (use for "best effort" reads)
  - `useNativeInfo()` — React hook for the common version+platform+paths triple
  - `isElectron()` — boolean check for "are we in the packaged shell"
- Adding a new IPC handler? Touch all four files in lockstep:
  1. `electron/app/ipc.js` — register `ipcMain.handle('native:foo', ...)` returning `ok(...)` / `err(...)` from the helpers in that file
  2. `electron/preload.js` — expose `foo: () => ipcRenderer.invoke('native:foo', ...)` on the `hydraNative` contextBridge
  3. `src/lib/native.js` — add `foo: (...args) => invokeNative('foo', ...args)` to the `native` facade
  4. Bump CLAUDE.md if the surface is user-visible

### User Preferences
Device-local UX prefs (telemetry consent, biometric, theme) live in `userData/preferences.json` via `electron/app/userPrefs.js`. NOT in the encrypted vault — these are device choices, not account data. Add new keys to the `DEFAULTS` map in that file; unknown keys are rejected at write time.

## When to Update Docs

After making changes to:
- Server routes → update `docs/SERVER_ARCHITECTURE.md`
- API contracts → update `docs/API_REFERENCE.md`
- Architecture/services → update `docs/ARCHITECTURE_DEEP_DIVE.md`
- Project structure → update `docs/PROJECT_STRUCTURE.md`
- **`/v1` proxy, rotation policy, or optional gateway/sidecar documentation** → update `docs/API_REFERENCE.md` (proxy tables + behavior), `docs/ARCHITECTURE_DEEP_DIVE.md` (proxy/rotation), and `docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md` when the operator story or runbook changes; keep `SERVER_ARCHITECTURE.md` / `PROJECT_STRUCTURE.md` / root `README.md` links consistent if you add or rename docs.

Also update the **relevant** doc(s) under `docs/` when a change is **material** to **UX**, **operator workflows**, or **audit/observability surfaces** (dashboards, tables, wizards, log viewers)—even when no HTTP route or JSON response shape changes.

When making changes to server routes or controllers, update `docs/SERVER_ARCHITECTURE.md`. If you change **`/v1` proxy** behavior, contracts, or rotation policy, also update `docs/API_REFERENCE.md` (Proxy Routes + behavior bullets), `docs/ARCHITECTURE_DEEP_DIVE.md` (proxy/rotation sections), and—when the optional gateway story or sidecar runbook changes—`docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md` plus cross-links in `SERVER_ARCHITECTURE.md` / `PROJECT_STRUCTURE.md` as needed.

When changing operator-facing UI or workflows in a material way (pages, tables, observability/audit views, multi-step flows), update the relevant `docs/*.md` files—typically `docs/API_REFERENCE.md`, `docs/PROJECT_STRUCTURE.md`, and any architecture or security doc that describes that surface.

## Research & Recon Documentation (MANDATORY)

Every discovery — endpoint, session quirk, auth loophole, creative technique, UI trick — MUST be documented in `docs/`. Context windows die; files live. Use all available system tools for research: MCP servers, browser automation, DevTools, network capture, CLI recon tools.

Each finding needs: what, how, why it matters, raw evidence (redact secrets), reproducibility. Write for a skilled operator who's never seen the system.

**Triggers:** undocumented endpoints, auth/session mechanics differing from docs, creative approaches, rate limits or fingerprinting, reusable patterns, cookie/token scope discoveries.

## Docs Map

**Live (current truth):**

- [**Architecture Deep Dive**](docs/ARCHITECTURE_DEEP_DIVE.md) — best starting point: routes, services, proxying, aggregation, automation.
- [**Project Structure**](docs/PROJECT_STRUCTURE.md) — Electron-first directory map and runtime flow.
- [**Server Architecture**](docs/SERVER_ARCHITECTURE.md) — middleware stack, route bindings, controller patterns, response shapes.
- [**API Reference**](docs/API_REFERENCE.md) — internal server routes and data models. Response envelope: `{ok, data, error?, code?}`.
- [**Electron Migration Status**](docs/ELECTRON_MIGRATION_STATUS.md) — current packaging status + what's validated.
- [**Packaging**](docs/PACKAGING.md) — `electron:build` pipeline, signing, notarization, smoke checks.
- [**IDEAS / running plan**](docs/IDEAS.md) — single source of truth for "what's not done yet" (replaces the older ROADMAP_NEXT). Items move out as they ship.
- [**Security**](docs/SECURITY.md) — AES-256-GCM encryption, local auth, telemetry policy.
- [**CLIProxyAPI & gateway synthesis**](docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md) — Hydra vs sidecar vs LiteLLM decision; optional CLIProxyAPI ports/config.
- [**Dashboard Account States**](docs/DASHBOARD_ACCOUNT_STATES.md) — card badge logic, session labels.
- [**Management Key Provision**](docs/MANAGEMENT_KEY_PROVISION_AUTOMATION.md) — operator playbook for key provisioning.
- [**Server Action Capture/Replay**](docs/SERVER_ACTION_CAPTURE_REPLAY.md) — Next.js SA hash capture.
- [**Cookie & Session Tricks**](docs/COOKIE_SESSION_TRICKS.md) — living hive mind of auth/cookie exploits and techniques.
- [**Session Lifecycle**](docs/SESSION_LIFECYCLE.md) — session creation, storage, validation, refresh flows.
- [**Browser Isolation**](docs/BROWSER_ISOLATION.md) — Playwright profile isolation guarantees.
- [**Development**](docs/DEVELOPMENT.md) — Prisma, environment, build scripts.

**Archived (`docs/_archive/`):**

- `_archive/historical/` — completed plans (Implementation, Electron Master Plan, Project Status April 2026, SitRep, Docker Plan). Reference only — every actionable item has been verified shipped or extracted into `docs/IDEAS.md`.
- `_archive/2026-04-27/` — Electron-migration sprint archive (PAIN_POINTS, SKEPTIC_AUDIT, LINT_AUDIT, session notes). All TODOs / phases shipped; remaining ideas extracted into `docs/IDEAS.md`.
- `_archive/2026-05-06-reviews/` — security/perf/sweep/swarm review punch lists from the 2026-05-06 audit. All criticals + highs are addressed; remaining LOW polish tracked in IDEAS.
- `_archive/recon-html/` — captured HTML from OpenRouter recon (large; rarely needed).

## Parallel Work (Multi-Lane Plans)

When a plan splits into mostly independent streams (e.g. a small util module, a modal, a page refactor, doc updates), dispatch parallel subagents so lanes run together rather than one agent doing everything in order. After merges, run a short reconciliation pass: docs match validation and copy, `PROJECT_STRUCTURE.md` lists new files, `npm run lint`.

## Stack

- **Shell**: Electron 28 (Chromium 120), bound to single-instance lock
- **Backend**: Node.js + Express 5 embedded in main process, Prisma/SQLite, Zod validation
- **Frontend**: React 19 + Vite, no UI framework, neo-brutalist Vanilla CSS
- **Auth**: JWT (stateless), AES-256-GCM encrypted local storage; optional Touch ID gate
- **Port**: random `127.0.0.1:<port>` in packaged builds (preferred 3001 in dev). Read live port via `native.status()` from the renderer.

## Start Dev

```bash
npm run dev:electron   # recommended — Vite HMR inside the Electron window
npm run dev            # legacy browser-mode dev (Vite 5173 + Express 3001)
node server/standalone.js  # server only, no Electron
```

## Password Recovery (when login breaks)

The local password is stored as a bcrypt hash in `data/hydra.db`. If the UI shows "Invalid credentials" and `1111` doesn't work, reset it:

```bash
node -e "
const { PrismaClient } = require('./node_modules/.prisma/client');
const bcrypt = require('./node_modules/bcryptjs');
const p = new PrismaClient({ datasources: { db: { url: 'file:$(pwd)/data/hydra.db' } } });
bcrypt.hash('1111', 12).then(hash =>
  p.user.updateMany({ data: { passwordHash: hash } })
    .then(r => { console.log('Reset OK, rows:', r.count); p.\$disconnect(); })
).catch(e => { console.error(e.message); p.\$disconnect(); });
"
```

**Why this breaks:** The password can be changed via Settings in the UI. There's no "forgot password" flow — the only in-app recovery is Nuclear Reset (wipes all data). Use the command above instead.

**Two DB files:** `data/hydra.db` is the live DB (set in `.env` via `DATABASE_URL`). `data/dev.db` is an old artifact — ignore it.

## Cookie & Session Probe — Critical Implementation Notes

**`getSessionStatusAsync` in `server/services/store.js`:** This is the per-account live probe called by `GET /api/accounts/:id/session-check`. It passes the full `clientCookies` stack to `refreshSession` (Exploit #14 stack traversal) and **persists the fresh `__client` cookie** returned by Clerk back to the DB (fire-and-forget via `updateAccountSession`). This prevents false `expired` reports caused by stale stored cookies after a probe cycle.

**`AccountController` refresh endpoints (lines 244, 448, 851):** Must use `session.clientCookies?.length > 0 ? session.clientCookies : session.clientCookie` — the full stack, not the legacy single-string `session.clientCookie`. `dashboard-api.js` is the reference implementation for this pattern.

**`src/utils/cardHealth.js`:** Single source of truth for card health status (healthy/partial/dead). Imported by `AccountCard.jsx` — do not inline health logic in the component. Both the status dot AND the border color are derived from this util.

## Learned Workspace Facts

- **Dashboard account cards:** Per-account badges (SYNCED, NEEDS KEY, SIGN IN, etc.) and "synced / need attention" counts are derived in the client from `GET /api/dashboard` fields — see `docs/DASHBOARD_ACCOUNT_STATES.md`.
- **Pool Manager + models:** **Sync from OpenRouter** reloads account/key metadata (management API). **Refresh Models** calls `POST /api/pool/models/refresh` and updates `CachedModel`. The proxy `GET /v1/models` prefers DB cache, then live OR fetch (write-through), then static fallback; responses may include `X-Hydra-Models-Source` (`cache`, `live`, or `static`).
- A **management key** enables OpenRouter's management API but does not supply raw standard API key strings. **"Need key string"** means standard key material is not stored locally.
- **Session vs management key:** Clerk `__session` (dashboard) is required to *create* a management key via tRPC HTTP or browser UI automation (Playwright). That path is NOT the IDE Playwright MCP — see `docs/MANAGEMENT_KEY_PROVISION_AUTOMATION.md`.
- **Provision order:** `createManagementKey` always tries cookie-authenticated tRPC HTTP first, then Server Action stub, then browser automation. Failures surface `PROVISION_KEY_NOT_CAPTURED` with structured `details` (`stage`, `phasesTried`, `trpcLastRoute`, etc.).
- **`sessionExpiry` is realistic Clerk session TTL (~7 days), NOT the JWT `exp` (~2.5 min).** Never use `getJwtExpiry()` for session lifecycle. The only valid use is `account-generator.js:240`. See `docs/SESSION_LIFECYCLE.md`.
- **`getSessionStatus`** reports `active` / `expiring` / `expired` / `none` — not `unknown` for "token without expiry".
- **`npm run dev`** runs `scripts/free-dev-ports.mjs` first to release listeners on ports 3001/5173. Vite uses `strictPort: true`. Run `npm` from the repository root.
- **Zod 4** exposes validation problems on `issues`, not `errors`. Use `err.issues ?? err.errors ?? []` (see `BaseController.validate`).
- **Clerk FAPI from Node:** Session-critical hops use `clerkHttpsJson` in `server/services/clerk-auth.js` (raw `https`) so `res.headers['set-cookie']` is always visible; Undici `fetch` can omit `Set-Cookie`. The persisted `clientCookie` is a device cookie jar (`__client`, `__client_uat`, etc.) merged from `Set-Cookie` and replayed on later FAPI and dashboard requests.
- **Email OTP send:** Clerk expects `prepare_first_factor` with `strategy: email_code` + `email_address_id`. Do not use `attempt_first_factor` without a `code` as the send step.
- **Bulk code redemption** uses per-account dashboard session (`ensureSession` → tRPC), not the management API. `POST /api/codes/preflight` flags session gaps before `POST /api/codes/bulk`.
- **Provision management key:** Treat inner `success: false` as failure — do not toast success from `source` alone when the payload says the operation failed.
- **Management key docs vs runtime:** Opening the OpenRouter management-keys page in an IDE browser records selectors/tRPC for `docs/recon/`; it does NOT store keys in Hydra. `POST /api/accounts/:id/provision` captures the key from upstream JSON or page text, not the site's Copy button.
- **Optional CLIProxyAPI / LiteLLM** are NOT part of the Hydra process; documented as optional sidecars in `docs/CLIPROXYAPI_GATEWAY_SYNTHESIS.md`. Hydra's OpenAI-compatible entry remains `http://localhost:3001/v1` with `sk-hydra-...`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your FIRST action. Do NOT answer directly, do NOT use other tools first. The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
