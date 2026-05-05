# Hydra Electron Migration Plan

> **⚠️ SUPERSEDED** — This document has been superseded by [ELECTRON_MASTER_PLAN.md](./ELECTRON_MASTER_PLAN.md) and [ELECTRON_MIGRATION_STATUS.md](./ELECTRON_MIGRATION_STATUS.md). The implementation is complete. This file is kept for historical reference only.

**Status:** ✅ Done | **Priority:** P1 (completed) | **Complexity:** High (7-10 phases)
**Prerequisite:** Docker plan is ✅ complete. Production static-file serving is battle-tested.
**Goal:** Native desktop app (.dmg, .exe, .AppImage) with zero terminal exposure. All data stays local. Dev experience preserved.

---

## 0. Philosophy & Constraints

### What we are NOT doing
- We are NOT rewriting the frontend in native UI (Swift, WinUI, etc.). React + Vite stays.
- We are NOT moving to a serverless architecture. Express + Prisma + SQLite stays.
- We are NOT breaking the existing `npm run dev` workflow. Browser-based dev remains first-class.

### What we ARE doing
- Wrapping the proven production build in an Electron shell.
- Moving data from `process.cwd()/data` to platform-native `userData` paths.
- Making the Express server embeddable and gracefully startable/stoppable from Node.
- Adding Electron-native affordances: dock icon, menu bar, auto-updater hooks, deep links.
- Creating a test matrix that validates the Electron build without human clicking.

### The Dev Build Question — Answered

**Q:** For dev, do we run Electron apps for both frontend and backend? Or frontend split from backend like now?

**A:** Hybrid. Three dev modes:

| Mode | Command | What runs | Use case |
|------|---------|-----------|----------|
| **Web dev** (current) | `npm run dev` | Vite 5173 + Express 3001, browser tab | Daily frontend/backend iteration. Fastest HMR. |
| **Electron dev** | `npm run electron:dev` | Vite 5173 + Express (in main process) + Electron window loading `localhost:5173` | Testing Electron APIs, IPC, native menus, window behavior. |
| **Electron prod-smoke** | `npm run electron:preview` | Express (in main process) serving built `dist/` + Electron window | Verifying the exact artifact users will install. |

This preserves the existing `npm run dev` ergonomics while giving Electron-specific dev paths. No one is forced into Electron during daily work.

---

## 1. Pre-Migration Audit (Phase 0) — Do First

Before any file moves, establish a baseline.

### 1.1. Lock the API surface
Run a full audit of `server/index.js` → routes → controllers → services. Document every:
- Import from `node:` modules (these work in Electron main process)
- Import from third-party modules with native bindings (bcryptjs, Prisma, Playwright)
- Filesystem writes outside `data/` (any temp files, debug traces, screenshots)
- Network assumptions (hardcoded `localhost:3001`, `process.env.PORT`)
- Process signal handlers (`SIGINT`, `SIGTERM`)

**Output:** `docs/electron-audit/API_SURFACE_AUDIT.md`

### 1.2. Data path inventory
Find every place that writes to disk:
- `server/services/local-secrets.js` → `process.cwd()/data/local-secrets.json`
- `server/services/proxy-gate.js` → `process.cwd()/data/proxy-gate.json`
- Prisma → `DATABASE_URL` (currently `data/hydra.db` or `prisma/dev.db`)
- Playwright debug traces → `$TMPDIR/hydra-provision-debug/`
- Any `fs.writeFileSync` in services/controllers

**Output:** `docs/electron-audit/DATA_PATH_INVENTORY.md`

### 1.3. Environment variable audit
List every `process.env.*` read in the server. In Electron, some env vars won't exist (e.g., no shell `export`). Determine which must be:
- Hardcoded defaults
- Set by `electron/main.js` before server bootstrap
- Configurable via a settings UI (future)

**Output:** `docs/electron-audit/ENV_INVENTORY.md`

---

## 2. Directory Restructure (Phase 1) — Zero Behavior Change

This phase moves files to make room for Electron without changing any runtime logic. It is purely structural.

### 2.1. New top-level layout

```
hydra/
├── electron/                    # NEW — Electron shell code
│   ├── main.js                  # Main process entry
│   ├── preload.js               # Secure renderer bridge
│   ├── utils/
│   │   ├── getFreePort.js       # Find open TCP port
│   │   ├── paths.js             # userData / logs / temp paths
│   │   └── migrateLegacyData.js # One-time data migration helper
│   ├── menus/
│   │   ├── appMenu.js           # macOS app menu
│   │   ├── dockMenu.js          # macOS dock menu
│   │   └── trayMenu.js          # System tray menu (optional)
│   └── builders/
│       ├── mac.js               # mac-specific build hooks
│       └── win.js               # win-specific build hooks
│
├── desktop/                     # NEW — Desktop-specific assets
│   ├── icons/
│   │   ├── icon.png             # 1024x1024 source
│   │   ├── icon.icns            # macOS icon bundle
│   │   └── icon.ico             # Windows icon bundle
│   └── entitlements.mac.plist   # macOS code signing entitlements
│
├── src/                         # UNCHANGED — React frontend
├── server/                      # UNCHANGED — Express backend
├── prisma/                      # UNCHANGED — Database schema
├── scripts/                     # MODIFIED — launch.js stays, Electron scripts added
├── dist/                        # UNCHANGED — Vite build output
├── data/                        # LEGACY — will be migrated at runtime
├── docs/                        # UNCHANGED
└── package.json                 # MODIFIED — Electron deps + scripts
```

### 2.2. Why `desktop/` instead of `assets/`

`assets/` is overloaded (Vite public assets, branding, etc.). `desktop/` is unambiguous: these files only exist for the desktop build.

### 2.3. Refactor rule: server must not know about Electron

The `server/` directory must remain ignorant of Electron. No `if (process.versions.electron)` in server code. All Electron-specific adaptation happens in `electron/main.js` by:
- Setting environment variables before `server/index.js` is imported
- Passing configuration into exported server functions
- Handling lifecycle events externally

---

## 3. Server Extract & Export (Phase 2) — Make Embeddable

Currently `server/index.js` calls `bootstrap()` at module load time and binds `process.on('SIGINT', ...)` globally. This is hostile to embedding. We must make it callable.

### 3.1. Changes to `server/index.js`

**Current problem:**
```js
// Line 183: bootstrap() called immediately
bootstrap();

// Lines 185-191: global signal handlers
process.on('SIGINT', () => { ... });
process.on('SIGTERM', () => { ... });
```

**Target state:**
```js
// Export everything needed by embedders
export { app, gracefulShutdown, bootstrap, getServerInstance };
export default { app, gracefulShutdown, bootstrap };
```

**Refactor steps (exact):**
1. Move `bootstrap()` call and signal handlers behind a `if (require.main === module)` guard… except we're ESM. Use `import.meta.url === pathToFileURL(process.argv[1])` pattern.
2. Alternatively: remove auto-bootstrap entirely. Update `package.json` scripts to call an explicit entry point.
3. Make `bootstrap()` accept an options object:
   ```js
   async function bootstrap(options = {}) {
     const port = options.port ?? config.PORT;
     const host = options.host ?? '0.0.0.0';
     const dataDir = options.dataDir ?? path.join(process.cwd(), 'data');
     // ... use dataDir for all path construction
   }
   ```
4. `gracefulShutdown` must accept an optional callback instead of calling `process.exit()`:
   ```js
   async function gracefulShutdown(source = 'unknown', { exit = true } = {}) {
     // ... existing cleanup ...
     if (exit) process.exit(0);
   }
   ```

### 3.2. Changes to `server/config.js`

Currently reads `DATABASE_URL` from `.env` via `dotenv/config`. In Electron, we may need to override this before Prisma loads.

**Target state:**
- Keep `dotenv/config` for backward compatibility.
- Allow `config.js` to accept overrides via a `setConfigOverride(key, value)` function.
- Or simpler: set `process.env.DATABASE_URL` in `electron/main.js` BEFORE importing `server/index.js`. ESM imports are top-level, so order matters.

**Critical:** Because ESM runs imports sequentially, `electron/main.js` must:
```js
import { app } from 'electron';
import path from 'node:path';

// 1. Set paths BEFORE any server import
const userData = app.getPath('userData');
process.env.DATABASE_URL = `file:${path.join(userData, 'hydra.db')}`;
process.env.HYDRA_DATA_DIR = userData;

// 2. NOW import server (which imports config, which reads env)
const { bootstrap, gracefulShutdown } = await import('../server/index.js');
```

### 3.3. Changes to `server/services/local-secrets.js`

Replace hardcoded `process.cwd()`:
```js
// OLD
const DATA_DIR = path.join(process.cwd(), 'data');

// NEW
const DATA_DIR = process.env.HYDRA_DATA_DIR
  ? path.join(process.env.HYDRA_DATA_DIR)
  : path.join(process.cwd(), 'data');
```

Do the same audit for every service that writes to disk. Candidates:
- `server/services/local-secrets.js`
- `server/services/proxy-gate.js`
- Any debug/trace services

### 3.4. Verification for Phase 2

Run the existing test suite after the refactor:
```bash
npm run test:session-expiry
npm run test:ensure-session-backfill
npm run test:otp-smoke
```

Also manually verify:
```bash
npm run dev        # still works in browser
npm start          # launch.js production path still works
```

---

## 4. Electron Main Process (Phase 3)

### 4.1. `electron/main.js` — full specification

```js
/**
 * Hydra Electron Main Process
 * Responsibilities:
 *   - Set platform-native data paths
 *   - Start embedded Express server on random free port
 *   - Open BrowserWindow
 *   - Handle app lifecycle (quit, relaunch, OS events)
 *   - Forward logs to Electron's crashReporter (future)
 */
import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// ─── Paths ──────────────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const LOGS_DIR = app.getPath('logs');
const TEMP_DIR = app.getPath('temp');

// ─── Environment Setup (MUST happen before server import) ────────────────────
process.env.HYDRA_DATA_DIR = USER_DATA;
process.env.DATABASE_URL = `file:${path.join(USER_DATA, 'hydra.db')}`;
process.env.NODE_ENV = isDev ? 'development' : 'production';

// In dev, if Vite is running, we'll load from it. In prod, Express serves dist/.
const VITE_DEV_URL = 'http://localhost:5173';

// ─── Server Import (after env setup) ─────────────────────────────────────────
const { bootstrap, gracefulShutdown } = await import('../server/index.js');

// ─── State ───────────────────────────────────────────────────────────────────
let mainWindow = null;
let expressServer = null;
let expressPort = null;

// ─── Port Discovery ──────────────────────────────────────────────────────────
function findFreePort(start = 3001) {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(start, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(findFreePort(start + 1));
      else reject(err);
    });
  });
}

// ─── Window Factory ──────────────────────────────────────────────────────────
function createMainWindow(portOrUrl) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Hydra',
    show: false, // show after load to avoid flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      allowRunningInsecureContent: false,
      webSecurity: true,
    },
    // macOS aesthetics
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    transparent: false,
  });

  // Load URL
  const target = typeof portOrUrl === 'number'
    ? `http://localhost:${portOrUrl}`
    : portOrUrl;
  win.loadURL(target);

  // Show when ready
  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // One-time legacy data migration (from ./data to userData)
  const { migrateIfNeeded } = await import('./utils/migrateLegacyData.js');
  await migrateIfNeeded();

  if (isDev) {
    // Dev mode: assume Vite is running OR start Express ourselves
    expressPort = await findFreePort(3001);
    await bootstrap({ port: expressPort, host: '127.0.0.1', dataDir: USER_DATA });

    // Try Vite first; fall back to Express-served dist
    try {
      await fetch(VITE_DEV_URL);
      mainWindow = createMainWindow(VITE_DEV_URL);
    } catch {
      mainWindow = createMainWindow(expressPort);
    }
  } else {
    // Production: Express serves dist/
    expressPort = await findFreePort(3001);
    await bootstrap({ port: expressPort, host: '127.0.0.1', dataDir: USER_DATA });
    mainWindow = createMainWindow(expressPort);
  }

  buildMenu();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void gracefulShutdown('window-all-closed', { exit: false });
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const target = isDev ? VITE_DEV_URL : `http://localhost:${expressPort}`;
    mainWindow = createMainWindow(target);
  }
});

app.on('before-quit', async (event) => {
  event.preventDefault();
  await gracefulShutdown('before-quit', { exit: false });
  app.exit(0);
});

// ─── IPC Handlers ────────────────────────────────────────────────────────────
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:get-paths', () => ({
  userData: USER_DATA,
  logs: LOGS_DIR,
  temp: TEMP_DIR,
}));

// Future: native notifications, auto-updater, deep links
```

### 4.2. `electron/preload.js` — security bridge

```js
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hydraNative', {
  appVersion: () => ipcRenderer.invoke('app:get-version'),
  appPaths: () => ipcRenderer.invoke('app:get-paths'),
  platform: process.platform,
});
```

**Why this matters:** The renderer (React app) cannot access `fs`, `path`, or `process.env` directly. If the frontend ever needs native info (e.g., display app version, open logs folder), it goes through this bridge.

### 4.3. `electron/utils/migrateLegacyData.js` — data migration

On first Electron launch, if `userData/` is empty but `process.cwd()/data/` exists (user previously ran Hydra via terminal), copy the files over:

```js
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export async function migrateIfNeeded() {
  const legacyDir = path.join(process.cwd(), 'data');
  const userData = process.env.HYDRA_DATA_DIR;

  if (!existsSync(userData) || readdirSync(userData).length === 0) {
    if (existsSync(legacyDir)) {
      mkdirSync(userData, { recursive: true });
      for (const file of readdirSync(legacyDir)) {
        copyFileSync(path.join(legacyDir, file), path.join(userData, file));
      }
      console.log(`[MIGRATION] Copied legacy data from ${legacyDir} to ${userData}`);
    }
  }
}
```

---

## 5. Package.json & Build Configuration (Phase 4)

### 5.1. Dependency changes

```json
{
  "devDependencies": {
    "electron": "^35.0.0",
    "electron-builder": "^26.0.0",
    "electron-vite": "^3.0.0",
    "concurrently": "^8.2.2"
  }
}
```

**Why electron-vite?** It handles ESM in the main process (Electron main is traditionally CJS), provides HMR for the preload script, and bundles the main process code. Since our server is pure ESM, we need this.

### 5.2. Script changes

```json
{
  "main": "electron/main.js",
  "scripts": {
    "dev": "node scripts/free-dev-ports.mjs && concurrently -n server,client -c blue,green \"node server/index.js\" \"vite --host\"",
    "start": "node scripts/launch.js",

    "electron:dev": "concurrently -n vite,electron -c cyan,magenta \"vite --host\" \"electron --inspect=5858 .\"",
    "electron:preview": "npm run build && electron .",
    "electron:build": "npm run build && electron-builder",
    "electron:build:mac": "npm run build && electron-builder --mac",
    "electron:build:win": "npm run build && electron-builder --win",
    "electron:build:linux": "npm run build && electron-builder --linux",

    "postinstall": "electron-builder install-app-deps && npx prisma generate"
  }
}
```

### 5.3. `electron-builder.yml`

```yaml
appId: com.hydra.app
productName: Hydra
copyright: Copyright © 2026
asar: true
asarUnpack:
  - 'node_modules/playwright/**'
  - 'node_modules/@prisma/client/**'
  - 'node_modules/.prisma/**'
  - 'prisma/**/*'

directories:
  output: release
  buildResources: desktop

files:
  - dist/**/*
  - server/**/*
  - prisma/**/*
  - electron/**/*
  - node_modules/**/*
  - package.json

# Exclude heavy dev artifacts
extraResources:
  - from: 'data/'
    to: 'data/'
    filter: ['**/*']

mac:
  target:
    - target: dmg
      arch: [x64, arm64]
  icon: desktop/icons/icon.icns
  category: public.app-category.utilities
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: desktop/entitlements.mac.plist
  entitlementsInherit: desktop/entitlements.mac.plist
  darkModeSupport: true

win:
  target:
    - target: nsis
      arch: [x64, ia32]
  icon: desktop/icons/icon.ico
  publisherName: Hydra

linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  icon: desktop/icons/icon.png
  category: Utility

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: always
  createStartMenuShortcut: true
```

**Critical `asarUnpack`:** Prisma and Playwright have native binaries that must exist as real files on disk, not inside the asar archive. Without this, `prisma db push` and `chromium.launch()` will fail with cryptic ENOENT errors.

---

## 6. Testing Strategy (Phase 5)

### 6.1. Test pyramid for Electron

| Level | Tool | What it tests | CI? |
|-------|------|---------------|-----|
| Unit | Node built-in test runner | Path resolution, env override, migration logic | ✅ Yes |
| Integration | Playwright (Electron variant) | Window opens, Express responds, navigation works | ✅ Yes |
| E2E | Playwright + electron-to-chromium | Full flows: login → create account → proxy request | ⚠️ Heavy, run on release builds |
| Smoke | Shell script | Build completes, binary launches, exits 0 | ✅ Yes |

### 6.2. Automated tests to create

**`electron/tests/paths.test.mjs`**
- Verify `getPaths()` returns platform-expected structure
- Verify `migrateIfNeeded()` copies legacy data correctly
- Verify `findFreePort()` actually finds an open port

**`electron/tests/bootstrap.test.mjs`**
- Import `server/index.js` with overridden `DATABASE_URL`
- Confirm bootstrap starts on specified port
- Confirm gracefulShutdown closes without `process.exit()`

**`electron/tests/window.test.mjs` (uses Playwright for Electron)**
```js
import { _electron as electron } from 'playwright';
const app = await electron.launch({ args: ['.'] });
const window = await app.firstWindow();
await window.waitForLoadState('domcontentloaded');
await expect(window).toHaveTitle(/Hydra/);
```

### 6.3. CI workflow (`.github/workflows/electron.yml`)

```yaml
name: Electron Build
on: [push, pull_request]
jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
      - run: npx playwright install chromium
      - run: npm run test:electron:unit
      - run: npm run test:electron:integration
      - run: npm run electron:build
```

---

## 7. Data Migration & Backward Compatibility (Phase 6)

### 7.1. The problem

Existing users have `data/hydra.db`, `data/local-secrets.json`, etc. in their repo root. Electron moves these to platform-specific paths. We cannot lose their data.

### 7.2. Migration matrix

| Previous usage | New path (macOS) | New path (Windows) | Migration trigger |
|----------------|------------------|--------------------|-------------------|
| `./data/hydra.db` | `~/Library/Application Support/Hydra/hydra.db` | `%APPDATA%/Hydra/hydra.db` | First Electron launch |
| `./data/local-secrets.json` | `~/Library/Application Support/Hydra/local-secrets.json` | `%APPDATA%/Hydra/local-secrets.json` | First Electron launch |
| `./prisma/dev.db` | Same as above | Same as above | If `./data/` empty, check `./prisma/` |
| `.env` | NOT migrated (Electron uses defaults + env) | NOT migrated | Manual re-entry if needed |

### 7.3. Terminal usage still works

The `npm run dev` and `npm start` paths are preserved. They continue using `./data/` and `.env` as before. Electron is additive, not replacing the terminal workflow.

---

## 8. Native Platform Integration (Phase 7) — Post-MVP

These are NOT in the initial Electron build. They are stretch goals after the app launches and works.

| Feature | Implementation | Priority |
|---------|----------------|----------|
| Auto-updater | `electron-updater` + GitHub Releases | P2 |
| System tray | `Tray` API, hide window instead of quit | P2 |
| Native notifications | `Notification` API for proxy alerts | P3 |
| Deep links | `app.setAsDefaultProtocolClient('hydra')` | P3 |
| Touch ID / Windows Hello | `systemPreferences.canPromptTouchID()` | P3 |
| Menu bar (macOS) | `buildFromTemplate` with Edit/View/Window | P2 |
| Crash reporting | `crashReporter.start()` + Sentry | P3 |

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Prisma native binaries fail in asar | High | Build crash | `asarUnpack` for `@prisma/client` and `.prisma` |
| Playwright fails to launch Chromium in Electron | Medium | Feature loss | `asarUnpack` for `playwright`, test in CI |
| Data migration loses user DB | Low | Catastrophic | Backup before migrate; atomic copy; verify checksum |
| `process.exit()` in server kills Electron | Medium | App crash | Refactor `gracefulShutdown` to accept `{ exit: false }` |
| ESM import order (env before config) | Medium | Wrong DB path | Explicit import sequencing in `electron/main.js`; test |
| Port 3001 conflict in Electron | Low | Startup fail | Dynamic port discovery; update renderer URL |
| macOS code signing gatekeeper | Medium | User friction | Document right-click → Open; add signing later |
| Electron main process size bloat | Medium | 200MB+ binary | `electron-builder` prunes dev deps; dedupe |

---

## 10. Subagent Task Decomposition

The following tasks can be dispatched to parallel subagents. Each is self-contained and produces verifiable output.

### Agent A: Structural Refactor (Phases 1-2)
**Goal:** Restructure directories and make server embeddable without breaking existing flows.
**Inputs:** This plan, existing `server/index.js`, `server/config.js`, `server/services/local-secrets.js`
**Outputs:**
- PR with directory restructure
- `server/index.js` exports `bootstrap` and `gracefulShutdown`
- `server/services/local-secrets.js` uses `HYDRA_DATA_DIR`
- All existing tests pass
- `npm run dev` and `npm start` still work

### Agent B: Electron Shell (Phase 3)
**Goal:** Create the Electron main process, preload, and utilities.
**Inputs:** Phase 1-2 output, this plan section 4
**Outputs:**
- `electron/main.js` with dynamic port, window factory, lifecycle
- `electron/preload.js` with secure bridge
- `electron/utils/getFreePort.js`, `paths.js`, `migrateLegacyData.js`
- `npm run electron:dev` works (window opens, loads UI)

### Agent C: Build & Packaging (Phase 4)
**Goal:** Configure electron-builder, icons, and packaging scripts.
**Inputs:** Phase 3 output, this plan section 5
**Outputs:**
- `package.json` scripts and dependencies
- `electron-builder.yml`
- `desktop/icons/` with `.icns` and `.ico` generated from PNG
- `npm run electron:build` produces `.dmg` (or `.exe` on Windows)
- Verify the built app launches on a clean machine

### Agent D: Testing & CI (Phase 5)
**Goal:** Write automated tests for the Electron build.
**Inputs:** Phase 3 output, this plan section 6
**Outputs:**
- `electron/tests/paths.test.mjs`
- `electron/tests/bootstrap.test.mjs`
- `electron/tests/window.test.mjs` (Playwright for Electron)
- `.github/workflows/electron.yml`
- All tests pass in CI

### Agent E: Documentation & Migration (Phase 6-7)
**Goal:** Document the migration path, update all docs, verify data migration.
**Inputs:** All previous phases
**Outputs:**
- Updated `README.md` with Electron install instructions
- Updated `docs/ELECTRON_PLAN.md` → mark complete, link to new docs
- `docs/ELECTRON_TROUBLESHOOTING.md`
- `docs/electron-audit/*.md` cleanup
- Verified data migration from legacy `./data/` to `userData`

---

## 11. Execution Order

```
Phase 0 (Audit)        ──► Phase 1 (Restructure)
                                │
                                ▼
Phase 2 (Server Refactor) ◄───┘
        │
        ▼
Phase 3 (Electron Shell)
        │
        ├──► Parallel: Agent B (shell) + Agent C (build config prep)
        │
        ▼
Phase 4 (Build Integration)
        │
        ▼
Phase 5 (Testing)
        │
        ├──► Parallel: Agent D (tests) + Agent E (docs)
        │
        ▼
Phase 6 (Data Migration)
        │
        ▼
Phase 7 (Polish) — stretch goals
```

**Critical path:** Phase 0 → 1 → 2 → 3 → 4 → 5. Phase 6 runs during 3-5. Phase 7 is post-launch.

---

## 12. Verification Checklist (Before Marking Done)

- [ ] `npm run dev` works exactly as before (browser, no Electron)
- [ ] `npm start` works exactly as before (production server)
- [ ] `npm run electron:dev` opens native window, loads UI, HMR works
- [ ] `npm run electron:preview` opens native window with production build
- [ ] `npm run electron:build` produces `.dmg` (mac) or `.exe` (win)
- [ ] Built app opens on a machine WITHOUT Node.js installed
- [ ] Built app persists data across restarts
- [ ] Data migration copies legacy `./data/` to `userData` on first launch
- [ ] Graceful shutdown: closing window kills Express, no orphan processes
- [ ] Playwright provisioning works inside Electron build
- [ ] All existing Node tests pass (`npm run test:*`)
- [ ] All new Electron tests pass (`npm run test:electron:*`)
- [ ] CI passes on macOS, Windows, Linux
- [ ] `server/` directory has ZERO references to Electron APIs
- [ ] `src/` React app has ZERO references to Electron APIs (uses preload bridge only)

---

## 13. Appendix: Design Decisions Contested

### A. Why not Tauri?
Tauri is lighter (~3MB vs ~150MB) but requires Rust. Our backend is Node.js/Express with Playwright and Prisma native bindings. Porting to Rust or running Node sidecar in Tauri defeats the purpose. Electron's bundled Chromium also guarantees the exact browser environment our CSS targets.

### B. Why not neutralinojs?
Neutralinojs uses the system browser. Our app uses advanced CSS (backdrop-filter, custom animations) that may render differently across Safari, Chrome, Edge. Electron bundles Chromium for consistency.

### C. Why keep `npm run dev` in browser?
Electron startup adds ~2-3 seconds. Frontend iteration needs sub-second HMR. Forcing Electron for daily dev would slow down the team. Electron is for distribution, not development.

### D. Why ESM in Electron main?
Our entire server is ESM (`"type": "module"`). Using CJS in Electron main would require transpilation or awkward dynamic imports. `electron-vite` handles ESM bundling for the main process.

### E. Why `electron-builder` over `@electron/packager` + `electron-winstaller`?
`electron-builder` is one-stop: code signing, auto-updater support, multi-platform from one config. It's the industry standard for a reason.

---

*Plan created: 2026-04-21*
*Next step: Run Phase 0 audit, then dispatch Agent A for structural refactor.*
