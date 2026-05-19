# 🏛️ Project Structure

Hydra is a **single Electron desktop application**. The codebase is organized into three co-located layers that ship together as one signed bundle: the renderer UI (`src/`), the embedded Express server (`server/`), and the Electron shell that hosts both (`electron/`). There is no separately-deployed frontend or backend — the React UI talks to `127.0.0.1:<port>` inside the same process tree, and that port is never exposed beyond the local machine.

```
┌─────────────────────────── Hydra.app (Electron) ───────────────────────────┐
│                                                                            │
│   electron/main.js  ──┬── BrowserWindow (renders src/)                     │
│                       │       │                                            │
│                       │       └── window.hydraNative (preload bridge)      │
│                       │                                                    │
│                       └── child: Express (server/) on 127.0.0.1:<port>     │
│                              │                                             │
│                              └── Prisma → userData/hydra.db (SQLite)       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

In dev (`npm run dev:electron`), the renderer source is served by Vite at `localhost:5173` and loaded into the Electron window via HMR. In production, the Vite-built `dist/` bundle is served by the embedded Express server on a random local port and loaded into the same Electron window.

## 📂 Directory Map

### 🌐 Renderer / UI (`/src`)

The frontend is a single-page application (SPA) built with React 19 and Vite. It uses a custom Vanilla CSS design system for its Neo-Brutalist aesthetic.

- **`App.jsx`** — Main entry point, routing configuration, and global state providers. It also composes the global space-themed layers (`edm-bar`, `starfield`, `nebula-glow`, `meteor-container`, and `planet` shapes) so the background scene is always present behind the app. On **SERVER OFFLINE** (e.g. `getAuthStatus` / `GET /api/auth/status` fails because Express is down), the dev build shows [`DevBackendHint`](../src/components/DevBackendHint.jsx) with **`npm run dev`** copy affordance.
- **`api.js`** — Centralized **`fetch`**-based API client for `/api/*`. In Vite dev, network failures (backend not running) throw with a dev-specific message and optional **`hydraCopyCommand`** for clipboard UX — see [`API_REFERENCE.md`](API_REFERENCE.md) (*Frontend API client*) and [`ARCHITECTURE_DEEP_DIVE.md`](ARCHITECTURE_DEEP_DIVE.md) (*Development: backend-down UX*). Idempotent GET requests retry transient network/5xx/429 failures once. Exports **`HYDRA_DEV_START_COMMAND`** / **`HYDRA_DEV_API_ONLY_COMMAND`** for consistent copy text.
- **`index.css`** — The core Design System (48kB+ of custom tokens, layout utilities, and animations), including the layered space background and the meteor/EDM animation timings. **Page headers:** `.page-header` defaults to a horizontal flex row (title on the left, actions on the right). For pages that only need a title plus a long intro paragraph—no right-side actions—use **`page-header page-header--intro`** and wrap the heading and body copy in one container; use **`.page-header__lede`** / **`.page-header__lede--note`** for intro text (sans, readable line length). Putting `<h1>`/`<h2>` and `<p>` as *direct* siblings under the default `.page-header` squeezes them into two columns and breaks the title. **Pool help popover:** **`.pool-help-trigger`** / **`.pool-help-panel`** — cyan-themed header control on **Pool Manager** (`/pool`) for management-key vs standard-key guidance (replaces a full-width `.info-banner` that broke layout when mixed inline nodes were flex children).
- **`pages/`** — High-level views (Dashboard, Key Manager, Pool Manager, etc.). **`BulkAuthWizard.jsx`** — Bulk OTP sign-in: paste emails → `POST /api/accounts/bulk-otp-stubs` → sequential Clerk email OTP per row (`otp/start`, `otp/verify`) and optional provision. **React Router path:** `/bulk-auth` (sidebar: **Bulk OTP**). Wired in `src/App.jsx`.
- **`utils/keyManagerAccountState.js`** — Key Manager lane typing (`credentials` / `key_import` / `oauth_session`) and CTA flags via **`getKeyManagerAccountState`** (`canProvision`, **`canPasteManagementKey`**, **`canAuthenticate`**); consumed by **`KeyManager.jsx`** with **`GET /api/accounts`**. See **`DASHBOARD_ACCOUNT_STATES.md`** (*Key Manager*).
- **`components/LoginAccountModal.jsx`** — Per-account login: password, email OTP (`startOTP` / `verifyOTP` in `src/api.js`), TOTP after password **202**. Requires vault unlock (local JWT on requests).

### Email OTP login (quick map)

1. **Single account:** `src/components/LoginAccountModal.jsx` → `src/api.js` (`startOTP`, `verifyOTP`).
2. **Bulk (many emails):** `src/pages/BulkAuthWizard.jsx` (route `/bulk-auth`) → `src/api.js` (`bulkOtpStubs`, merge-existing OTP queue helper) → same per-account `startOTP` / `verifyOTP` as each row is processed.
3. Routes: `server/routes/accounts.js` → `AccountController` (`bulkOtpStubs` for stubs; `startOTP`, `verifyOTP` for Clerk OTP; `login` for password + 2FA). **No new or removed account routes** for Clerk session hardening—behavior is in the service layer.
4. Clerk: `server/services/clerk-auth.js` — `startEmailOTP`; after factors with `status=complete`, **`resolveSessionAfterCompletedAttempt`** (password, OTP, 2FA) resolves **`__session`** from cookies, embedded JWT (**`sessionJwtFromClerkClientPayload`**), optional **`POST …/client/sessions/{id}/touch`**, then **`getSessionToken`** / **`clerkGetClientSession`** (retried **`GET /v1/client`**). **`refreshSession`** calls the same **`clerkGetClientSession`** with **up to three** attempts (not a single **`GET /client`**). **`getJwtExpiry`** is **exported** for other services that write sessions. Env **`CLERK_DEBUG_OTP=1`**: logs for OTP attempts and **`GET /client`** (see **`ARCHITECTURE_DEEP_DIVE.md`**); **`AccountController`** may add **`clerkDebugHint`** to error JSON; **`src/api.js`** **`formatApiErrorMessage`** shows it in OTP/login UI.
5. Vault: encrypted account rows hold device cookie jar (`clientCookie`: merged **`__client`**, **`__client_uat`**, **`__client_uat_*`**), encrypted **`sessionToken`** (Clerk **`__session`** JWT), and **`config.sessionExpiry`** (JWT **`exp`** or 24h fallback via **`getJwtExpiry`** in **`clerk-auth.js`**). **`dashboard-api.ensureSession`** backfills missing **`sessionExpiry`** from the JWT when the cookie is still valid and persists expiry after credits **`validateSession`**—see **`ARCHITECTURE_DEEP_DIVE.md`**. **`store.getSessionStatus`** maps vault state to dashboard **`sessionStatus`** (**`none`** / **`active`** / **`expiring`** / **`expired`**); token-without-expiry legacy rows are **`active`**, not **`unknown`**—see **`docs/DASHBOARD_ACCOUNT_STATES.md`**.

**Scripts:** `scripts/otp-start-smoke.mjs` — `npm run test:otp-smoke` (optional `HYDRA_OTP_CODE` for verify). `scripts/check-clerk-connectivity.mjs` — `npm run check:clerk` (TLS + `Set-Cookie` visibility to `clerk.openrouter.ai`; honors `CLERK_ORIGIN` / `CLERK_REFERER` from `.env`).
- **`components/`** — Reusable UI elements (Icons, Error Boundaries, Scramble Text effects). **`DevBackendHint.jsx`** — When the API is unreachable in dev, shows guidance plus optional **Copy command** (`data-testid="copy-dev-command"`); used from **`App.jsx`** (offline gate) and **`BulkAuthWizard.jsx`** (bulk OTP flow errors).

### ⚙️ Embedded Server (`/server`)

The Express server is **not** a separately-deployed backend — it runs as a child of the Electron main process, bound to `127.0.0.1` on a port chosen at boot (preferred 3001 in dev; OS-assigned in packaged builds). It manages the local SQLite database via Prisma and handles all encrypted storage. The same code can be run standalone via `node server/standalone.js` for diagnostics, but the shipping app always boots it inside Electron.

- **`index.js`** — Server initialization and middleware pipeline.
- **`routes/`** — API endpoint definitions (RESTful structure).
- **`controllers/`** — Business logic for each route category.
- **`services/`** — Core utilities (AES encryption, OpenRouter API wrappers, proxy logic). Key additions: `proxy-gate.js` (in-memory proxy kill switch, shared by `index.js` middleware and `SystemController`), `rotation-manager.js` (tracks `lastSyncAt` per pool reload for sync-status endpoint).
- **`middleware/`** — Authentication (JWT), logging (Winston), and rate limiting. `rate-limiters.js` contains shared high-cost route limiters for bulk auth, provisioning, redeem, generator, and shutdown paths.
- **`validators/`** — Zod schemas for request validation.

### 🖥️ Desktop Shell (`/electron`)

The Electron shell that wraps the web app as a native desktop application.

- **`main.js`** — Electron main process: sets platform-native paths, starts embedded Express server, creates BrowserWindow, handles app lifecycle (`window-all-closed`, `before-quit`, `activate`). Splash → main serialization with 10 s minimum visible time.
- **`preload.js`** — Secure renderer bridge via `contextBridge`. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Surfaces: `appVersion`, redacted `appPaths`, `status`, `platform`, allowlisted `openPath`, `openAppLocation`, auth-token CRUD, `hideWindow`, `quitApp`, `prefsGetAll/Set`, `biometricDescribe/Prompt`, `onNavigate`. **Renderer must access via `src/lib/native.js`, never directly.**
- **`app/state.js`** — Mutable runtime singleton (mainWindow, splashWindow, tray, expressPort, forceQuit flag, etc.).
- **`app/ipc.js`** — All IPC handlers, returning `{ok, data}` / `{ok, error, code}` envelopes. Reads window/tray refs from `state.js` directly.
- **`app/windows.js`** — Splash + main window factories. Splash CSS `fillbar` keyframe must stay in lockstep with `SPLASH_MIN_VISIBLE_MS` in `main.js` (currently 10 s).
- **`app/windowActions.js`** — Shared external URL opening and show/focus/respawn behavior.
- **`app/schemaSync.js`** — Boot-time schema sync orchestrator (hash, lock, self-heal).
- **`app/shutdown.js`** — `shutdownEverything` orchestration: tracked-children kill → server graceful → tray destroy.
- **`app/startupError.js`** — Rich startup-failure dialog with **Open Logs Folder / Copy Details / Quit** buttons.
- **`app/userPrefs.js`** — JSON-backed key/value store at `userData/preferences.json` for device-local UX prefs (telemetry, biometric, theme). Ensures the userData directory is mode 0700 on POSIX and writes preferences atomically with file mode 0600.
- **`app/telemetry.js`** — Opt-in Sentry crash reporting. No-op without `HYDRA_SENTRY_DSN` env var + Settings toggle. PII scrubbing.
- **`app/biometric.js`** — Touch ID prompt via `systemPreferences.promptTouchID()` (no native dep). Windows Hello stubbed for later.
- **`utils/migrateLegacyData.js`** — One-time migration from `./data/` to platform `userData` on first Electron launch.
- **`menus/appMenu.js`** — macOS app menu (Hydra / Edit / View / Window / Help). Help menu surfaces Diagnostics (`⌘D`), logs/data folders, build info.
- **`builders/afterPack.js`** — Post-packaging hook: copies `.prisma/client` into the packaged app, prunes foreign engines, verifies the engine binary.
- **`builders/notarize.cjs`** — `afterSign` hook for macOS notarization. No-op without `APPLE_ID` env vars.
- **`tests/main-process.test.mjs`** — Test suite for Electron main process.

### 🪞 Renderer Native Bridge Layer (`/src/lib`)

- **`native.js`** — Single source of truth for Electron bridge access. Exports `native.*` (throws on failure), `tryNative(fn)` (returns null on failure), `useNativeInfo()` (React hook), `isElectron()` (predicate), `NativeError` / `NotInElectronError` typed exceptions. Eliminates the silent-failure pattern where renderer code naively read `result?.data ?? null`.
- **`client-logger.js`** — Renderer-side leveled logger that proxies to console.

### 🎨 Desktop Assets (`/desktop`)

Platform-specific assets and build resources for the Electron desktop build.

- **`icons/icon.png`** — 1024x1024 source icon.
- **`icons/icon.icns`** — macOS icon bundle.
- **`icons/icon.ico`** — Windows icon bundle.
- **`icons/README.md`** — Icon generation notes.
- **`desktop/entitlements.mac.plist`** — macOS code signing entitlements (build resources copy).

### 🗄️ Database (`/prisma`)

- **`schema.prisma`** — The source of truth for the local data model (User, Account, Key, RequestLog).

---

## 🛠️ Key Components & Pages

### Pages

- **Dashboard** — Aggregate fleet overview and balance tracking.
- **Bulk OTP** (`/bulk-auth`) — `BulkAuthWizard.jsx`: paste emails, create OTP stubs, walk accounts one-by-one (email code + verify + optional key provision).
- **Pool Manager** (`/pool`, `PoolManager.jsx`) — API key pooling, rotation toggles, master endpoint card, model-cache hints. **About keys** in the page header opens a popover (Escape / outside click to dismiss) explaining management keys, when `sk-or-v1-…` appears, and pasting from OpenRouter’s keys page. The sidebar **Legend** defers the long form to **About keys**.
- **Key Manager** — Centralized management of account-level API keys.
- **Code Redemption** (`CodeRedemption.jsx`) — Bulk promo code matrix; **`StatusCell`** shows **`verification`** (e.g. `trpc_browser`, `credits_total`), credit deltas, tooltips with **`uiFeedback`** on unclear Playwright outcomes. API: `POST /api/codes/*` (see **API_REFERENCE** *Code Redemption Routes* for pipeline, **`errorCode`** values, and removed reliance on fixed success modal copy).
- **Traffic** — Traffic Console (`/traffic`): live proxy observability from `GET /api/pool/traffic` — recent `RequestLog` rows with date/time, status, model, account alias, key name + hash prefix, latency, and token counts plus 24h volume/error stats.

### Components

- **Icons.jsx** — Custom SVG icon set tailored for the space-age aesthetic.
- **ScrambleText.jsx** — High-intensity visual effect for loading and transitions.
- **ErrorBoundary.jsx** — Safety wrapper for resilient UI rendering.
- **PasteManagementKeyModal.jsx** — Modal to paste an OpenRouter **management** key (**`sk-or-…`**, currently **`sk-or-v1-…`**) into the vault (**`updateAccount`** / **`PATCH /api/accounts/:id`**) when Key Manager cannot auto-provision (**`canPasteManagementKey`**). Client checks the **`sk-or-`** prefix for UX; server uses **`assertManagementKey`** (non-empty) and **`openrouter.getCredits()`** before persisting (OpenRouter is authority on invalid keys).

---

## 🚀 Lifecycle & Build

- **`launch.js`** — A multi-platform bootloader that checks for dependencies and starts the production environment.
- **`bin/hydra.mjs`** — Optional global CLI after `npm link` in the repo root: `hydra start`, `hydra dev`, `hydra status/accounts/balance`, `hydra doctor --json`, `hydra logs --json`, `hydra data-dir`, `hydra version`.
- **`Launch Hydra.command`** — macOS shortcut for running this repo clone in production-style mode.
- **`vite.config.js`** — Build configuration for the frontend assets.
- **`electron-builder.yml`** — Electron packaging configuration (dmg, nsis, AppImage).
- **`electron/main.js`** — Electron entry point (`"main"` in package.json).
- **`scripts/prepare-electron-resources.mjs`** — Generates packaged Electron resources (`empty-hydra.db` and bundled Playwright Chromium) before `electron-builder`.
- **`scripts/smoke-electron-package.mjs`** — Validates the unpacked package contract: Prisma engine, migrations/schema, empty DB, Chromium, and app size.
- **`scripts/diagnostics/mem-watcher.sh`** — macOS memory sampler for launch/performance checks. It is read-only and writes a local `mem-watch-*.log`.

## 🔁 Runtime Flow

**Production (the way users run Hydra):** double-click `Hydra.app` (or `Hydra-<version>-win-x64.exe` / `Hydra.AppImage`) → Electron main process boots, picks a free port, starts Express bound to `127.0.0.1`, opens BrowserWindow against the embedded server, and parks a tray icon. The window can be closed without exiting; the proxy stays alive in the menu bar / system tray until the user picks **Quit Hydra** or the tray's **Quit Hydra Completely** item.

**Dev (the way contributors run Hydra):**

- `npm run dev:electron` — recommended. Vite HMR inside the Electron window. This is the only loop that exercises the same shell users will ship.
- `npm run dev` — legacy browser-mode dev loop. Vite client on `http://localhost:5173` + Express on `http://localhost:3001` in the user's default browser. Useful for rapid CSS iteration but does **not** reflect production behavior (no preload bridge, no native menu, no tray).
- `npx electron .` — runs the packaged-style Electron flow against `dist/` (requires `npm run build` first).
- Frontend edits under `src/` hot-reload through Vite in either mode.
- Server edits under `server/` require restarting the dev process.
- `npm start` (`scripts/launch.js`) — production-style terminal startup that serves the built client from `dist/` over Express. Retained for support / headless diagnostics but not the shipping path.
- For a deeper explanation of how routes, services, proxying, and aggregation interact, read `ARCHITECTURE_DEEP_DIVE.md`.
- For CLIProxyAPI / LiteLLM comparison, sidecar ports, and gateway synthesis, read `CLIPROXYAPI_GATEWAY_SYNTHESIS.md`.
- For management-key provisioning (tRPC vs server Playwright, operator capture playbook, env debug flags, **live curl verification gate**), read `MANAGEMENT_KEY_PROVISION_AUTOMATION.md`.
