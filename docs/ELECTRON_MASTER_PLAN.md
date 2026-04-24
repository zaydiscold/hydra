# Hydra Electron Master Plan

**Status:** Ready for review — **PLANNING COMPLETE, NO CODE CHANGES YET** | **Target:** Electron as the PRIMARY runtime  
**Date:** 2026-04-21 | **Risk Level:** High (native modules + data migration + ESM)

> ⚠️ **PICKUP NOTE:** All documentation and codebase auditing is complete. Every pain point is marked with `// ─── ELECTRON_MIGRATION ───` comments in the source code. The next step is **Agent A: Server Extract** — see Section 10 below.
>
> To pick up: start with `server/index.js` — remove `bootstrap()` auto-call, remove signal handlers, refactor `gracefulShutdown()` to accept `{ exit }` option. Then dispatch remaining agents.
>
> **Doc links:** [ELECTRON_PAIN_POINTS.md](./ELECTRON_PAIN_POINTS.md) — 16 issues, exact file:line numbers, recommended fixes.

---

## 0. Executive Summary

Hydra becomes a native desktop application. The end state: users double-click `Hydra.app` (macOS) or `Hydra.exe` (Windows). No terminal, no `npm install`, no browser tab. All data stays local in platform-native paths.

**Current state:** Node.js Express backend + Vite React frontend. `npm run dev` runs both; browser hits `localhost:5173`.

**Target state:** Electron main process runs Express internally. Renderer is the React app. Dev loop uses Vite HMR inside the Electron window. Production serves built `dist/` from embedded Express.

**This plan is the single source of truth.** It replaces `ELECTRON_PLAN.md` and `ELECTRON_MIGRATION_PLAN.md`.

---

## 1. Critical Constraints & Non-Negotiables

### 1.1. Server ignorance
The `server/` directory must never know Electron exists. No `if (process.versions.electron)`. All adaptation happens by:
- Setting `process.env` before importing server modules
- Passing options into exported server functions
- Handling lifecycle externally in `electron/main.js`

### 1.2. Backward compatibility (terminal path)
`npm run dev` (browser-based) and `npm start` (`scripts/launch.js`) must continue working. We are NOT killing the browser path. Electron is primary for distribution; browser stays for emergencies and contributors who don't want Electron.

### 1.3. Data preservation
Existing users have `./data/hydra.db`, `./data/local-secrets.json`, etc. We cannot lose this. One-time migration on first Electron launch.

### 1.4. Native modules must work
Prisma (SQLite bindings), bcryptjs (optional native), Playwright (Chromium downloads) all have native/binary dependencies. These fail catastrophically if mishandled in Electron's asar packaging.

---

## 2. Architecture (End State)

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Node.js Runtime (same as current Node 20+)         │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  Express Server (embedded, no separate proc) │   │   │
│  │  │  • API routes (/api/*)                        │   │   │
│  │  │  • Proxy server (/v1/*)                       │   │   │
│  │  │  • Prisma + SQLite (userData/hydra.db)        │   │   │
│  │  │  • Playwright automation (dashboard tRPC)     │   │   │
│  │  │  • Winston logging (console only, no files)   │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  Electron Lifecycle                           │   │   │
│  │  │  • app.whenReady → bootstrap server           │   │   │
│  │  │  • window-all-closed → gracefulShutdown       │   │   │
│  │  │  • before-quit → cleanup + exit               │   │   │
│  │  │  • IPC handlers (minimal, secure)             │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│              loadURL()  │  (dev: localhost:5173)           │
│              or file:// │  (prod: localhost:{randomPort})   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Renderer Process (Chromium)                         │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  React 19 SPA (identical to current)         │   │   │
│  │  │  • Vite HMR in dev mode                      │   │   │
│  │  │  • Static build in prod mode                 │   │   │
│  │  │  • Calls API via fetch() → localhost         │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  Preload Script (contextIsolation=true)      │   │   │
│  │  │  • Exposes: appVersion, platform, openPath   │   │   │
│  │  │  • NO fs, NO child_process, NO require()     │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key design decision: No IPC for API calls
The frontend still calls `fetch('/api/...')` to `localhost`. The Express server runs in the same process, so latency is zero. This means:
- `src/api.js` needs almost no changes
- No complex IPC bridge for every API endpoint
- The only IPC is for native affordances (version, open folder, etc.)

---

## 3. The Directory Layout (After Refactor)

```
hydra/
├── package.json                    # Modified: Electron deps + scripts
├── vite.config.js                  # Unchanged (base: './' critical for prod)
│
├── electron/                       # NEW — Electron shell only
│   ├── main.js                     # Main process entry
│   ├── preload.js                  # Secure renderer bridge
│   ├── electron.vite.config.js     # Bundler config for main/preload
│   ├── utils/
│   │   ├── paths.js                # userData, logs, temp paths
│   │   ├── getFreePort.js          # TCP port discovery
│   │   └── migrateLegacyData.js    # One-time data migration
│   ├── menus/
│   │   ├── appMenu.js              # macOS app menu template
│   │   └── contextMenu.js          # Right-click context menu
│   └── builders/
│       ├── entitlements.mac.plist  # macOS code signing
│       └── afterPack.js            # Post-pack native module fixup
│
├── desktop/                        # NEW — Desktop assets only
│   └── icons/
│       ├── icon.png                # 1024x1024 source
│       ├── icon.icns               # macOS bundle (generated)
│       └── icon.ico                # Windows bundle (generated)
│
├── src/                            # UNCHANGED — React frontend
│   ├── App.jsx
│   ├── api.js                      # May need base URL adjustment
│   └── ...
│
├── server/                         # MODIFIED — Embeddable, no auto-run
│   ├── index.js                    # Exports bootstrap(), no auto-call
│   ├── config.js                   # Reads env (set by electron/main.js)
│   ├── services/
│   │   ├── local-secrets.js        # Use HYDRA_DATA_DIR env
│   │   ├── proxy-gate.js           # Use HYDRA_DATA_DIR env
│   │   ├── auth.js                 # Use HYDRA_DATA_DIR env
│   │   ├── redemption-log.js       # Use HYDRA_DATA_DIR env
│   │   ├── dashboard-api.js        # tmpdir for debug (OK, stays in /tmp)
│   │   └── account-generator.js    # Playwright launch args
│   └── ...                         # Other files unchanged
│
├── prisma/                         # UNCHANGED
│   └── schema.prisma
│
├── scripts/                        # MODIFIED
│   ├── launch.js                   # Preserved for terminal path
│   ├── free-dev-ports.mjs          # Preserved
│   └── generate-icons.mjs          # NEW: PNG → icns/ico
│
├── dist/                           # UNCHANGED — Vite build output
├── data/                           # LEGACY — Migrated on first Electron run
└── docs/
    ├── ELECTRON_MASTER_PLAN.md     # This file
    └── ELECTRON_TROUBLESHOOTING.md # NEW (Agent E)
```

---

## 4. Code Changes Detail

### 4.1. server/index.js — The Big One

**Current sins:**
1. `bootstrap()` called at module load time (line 183)
2. `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` registered globally
3. `gracefulShutdown()` calls `process.exit()` unconditionally
4. Hardcoded `config.PORT` in `app.listen()`
5. `distPath` resolved relative to `__dirname` (OK, but verify in asar)

**Target state:**
```js
// server/index.js

// ... existing imports and middleware setup unchanged ...

let server = null;
let shutdownInFlight = false;

// --- REMOVE the auto-bootstrap call at bottom ---
// REMOVE: bootstrap();
// REMOVE: process.on('SIGINT', ...);
// REMOVE: process.on('SIGTERM', ...);

// gracefulShutdown now accepts options
async function gracefulShutdown(source = 'unknown', { exit = true, timeoutMs = 5000 } = {}) {
  if (shutdownInFlight) return;
  shutdownInFlight = true;

  logger.info(`[SHUTDOWN] Starting graceful shutdown (${source})`);
  stopPinger();
  stopRequestLogRetention();
  stopSessionRefresher();

  try {
    await taskSupervisor.shutdown();
  } catch (err) {
    logger.error(`[SHUTDOWN] Task supervisor shutdown failed: ${err.message}`);
  }

  if (!server) {
    if (exit) process.exit(0);
    return;
  }

  return new Promise((resolve) => {
    server.close((err) => {
      if (err) {
        logger.error(`[SHUTDOWN] HTTP server close failed: ${err.message}`);
        if (exit) process.exit(1);
        resolve(false);
        return;
      }
      logger.info('[SHUTDOWN] Hydra stopped cleanly');
      if (exit) process.exit(0);
      resolve(true);
    });

    setTimeout(() => {
      logger.warn('[SHUTDOWN] Forced exit after timeout');
      if (exit) process.exit(1);
      resolve(false);
    }, timeoutMs).unref();
  });
}

// bootstrap now accepts options
async function bootstrap(options = {}) {
  const port = options.port ?? config.PORT;
  const host = options.host ?? '0.0.0.0';
  const dataDir = options.dataDir; // NOT defaulted here — caller must provide or env must be set

  // If dataDir is passed, override env for services that read it
  if (dataDir) {
    process.env.HYDRA_DATA_DIR = dataDir;
  }

  try {
    validateConfig();
    await enforceLegacyStorageReset();
  } catch (err) {
    logger.error(err.message);
    throw err; // Don't process.exit() — let caller handle
  }

  taskSupervisor.start();
  startPinger();
  startRequestLogRetention();
  startSessionRefresher();

  rotationManager.reload().catch(err => {
    logger.warn(`[POOL] Eager load failed: ${err.message}`);
  });

  return new Promise((resolve, reject) => {
    server = app.listen(port, host, () => {
      logger.info(`🐉 Hydra Server live on port ${port}`);
      // ... existing proxy key logging ...
      resolve({ port, host });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

// Export for embedders
export { app, bootstrap, gracefulShutdown, server };
export default { app, bootstrap, gracefulShutdown };
```

**Verification:** After this change, `node server/index.js` should do NOTHING. It should not start a server. Only `node scripts/launch.js` and `electron/main.js` should call `bootstrap()`.

### 4.2. server/services/local-secrets.js

**Current:** `const DATA_DIR = path.join(process.cwd(), 'data');`

**Target:**
```js
function getDataDir() {
  return process.env.HYDRA_DATA_DIR || path.join(process.cwd(), 'data');
}

const DATA_DIR = getDataDir();
const SECRETS_PATH = path.join(DATA_DIR, 'local-secrets.json');
```

Same pattern for `proxy-gate.js`, `auth.js`, `redemption-log.js`.

### 4.3. server/config.js

**Current:** Reads all env vars at module load. Uses `process.exit(1)` on validation failure.

**Target:**
- Keep `dotenv/config` import for backward compatibility
- `process.exit(1)` on failure is OK for CLI, but in Electron it would kill the entire app. We need to handle this.
- Solution: Don't change `config.js` much. Instead, in `electron/main.js`, set all required env vars BEFORE importing `server/index.js` (which imports `config.js`). If validation fails, catch the error in main.js and show a native dialog.

```js
// electron/main.js
import { dialog } from 'electron';

try {
  const { bootstrap } = await import('../server/index.js');
  await bootstrap({ ... });
} catch (err) {
  dialog.showErrorBox('Hydra Failed to Start', err.message);
  app.quit();
}
```

### 4.4. server/services/logger.js

**Current:** Console-only. Good — no file writes. No changes needed.

### 4.5. server/services/dashboard-api.js (Playwright debug)

**Current:** Writes screenshots and traces to `os.tmpdir()/hydra-provision-debug/`.

**Analysis:** This is fine. `os.tmpdir()` works in Electron. However, in production (asar), Playwright's bundled Chromium may not be where it expects. We need to verify Playwright can find its browser binaries when the app is packaged.

**Critical:** Playwright downloads Chromium to `node_modules/playwright/.local-browsers/` by default. In a packaged Electron app, `node_modules` may be inside an asar archive. Playwright's `chromium.launch()` will fail with `browserType.launch: Executable doesn't exist` if the binary path is wrong.

**Mitigation:**
1. Ensure `playwright` is in `asarUnpack` in `electron-builder.yml`
2. OR set `PLAYWRIGHT_BROWSERS_PATH=0` to use local install
3. OR bundle Chromium separately and use `executablePath`

Best approach: `asarUnpack` + ensure Playwright's postinstall runs.

### 4.6. Prisma / server/services/db.js

**Current:**
```js
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
export const prisma = new PrismaClient();
```

**Trap:** Prisma Client reads `DATABASE_URL` from env at import time (via `prisma/schema.prisma` `url = env("DATABASE_URL")`). If we set `DATABASE_URL` in `electron/main.js` before importing `server/index.js` (which imports `db.js`), it works. But we must verify the import order.

**Another trap:** `prisma generate` creates `node_modules/.prisma/client/` with native bindings. This must be in `asarUnpack`.

### 4.7. vite.config.js

**Current:** `base: './'` — this is CRITICAL. Without it, production builds use absolute paths (`/assets/...`) which fail when loaded from `file://` or `localhost:{randomPort}`. Keep this.

### 4.8. src/api.js

**Current:** Uses relative URLs (`/api/...`, `/v1/...`). These work because Vite's dev server proxies them to `localhost:3001`.

**In Electron dev:** Vite dev server still runs on `localhost:5173`, so the proxy still works. No change needed.

**In Electron prod:** Express serves both the API and the static `dist/` files on the same origin (`localhost:{randomPort}`). So `fetch('/api/...')` works without a base URL. No change needed.

---

## 5. The Electron Main Process (Detailed)

### 5.1. electron/main.js

```js
/**
 * Hydra Electron Main Process
 * 
 * Responsibilities:
 *   1. Set platform-native data paths BEFORE any server import
 *   2. Import and bootstrap the Express server
 *   3. Create BrowserWindow
 *   4. Handle app lifecycle without orphan processes
 *   5. Provide minimal IPC bridge
 */
import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// ─── 1. Paths (MUST be first) ──────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const LOGS_DIR = app.getPath('logs');
const TEMP_DIR = app.getPath('temp');

// ─── 2. Environment Setup (MUST be before any server import) ───────────────
process.env.HYDRA_DATA_DIR = USER_DATA;
process.env.DATABASE_URL = `file:${path.join(USER_DATA, 'hydra.db')}`;
process.env.NODE_ENV = isDev ? 'development' : 'production';
// Ensure Playwright can find browsers if unpacked
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

// ─── 3. State ──────────────────────────────────────────────────────────────
let mainWindow = null;
let expressServerInfo = null;
let isQuitting = false;

// ─── 4. Port Discovery ─────────────────────────────────────────────────────
function findFreePort(start = 33100) {
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

// ─── 5. Window Factory ─────────────────────────────────────────────────────
async function createMainWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Hydra',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      allowRunningInsecureContent: false,
      webSecurity: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
  });

  await win.loadURL(url);

  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ─── 6. App Lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // One-time data migration
    const { migrateIfNeeded } = await import('./utils/migrateLegacyData.js');
    await migrateIfNeeded();

    // Import server AFTER env is set
    const { bootstrap, gracefulShutdown } = await import('../server/index.js');

    if (isDev) {
      // Dev: Vite runs externally on 5173 (started by concurrently)
      // We start Express on a free port and the renderer loads from Vite
      const expressPort = await findFreePort(33100);
      expressServerInfo = await bootstrap({
        port: expressPort,
        host: '127.0.0.1',
        dataDir: USER_DATA,
      });
      mainWindow = await createMainWindow('http://localhost:5173');
    } else {
      // Production: Express serves dist/ on a free port
      const expressPort = await findFreePort(33100);
      expressServerInfo = await bootstrap({
        port: expressPort,
        host: '127.0.0.1',
        dataDir: USER_DATA,
      });
      mainWindow = await createMainWindow(`http://localhost:${expressPort}`);
    }

    buildMenu();
  } catch (err) {
    dialog.showErrorBox('Hydra Failed to Start', `${err.message}\n\n${err.stack || ''}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const url = isDev
      ? 'http://localhost:5173'
      : `http://localhost:${expressServerInfo?.port ?? 33100}`;
    mainWindow = await createMainWindow(url);
  }
});

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();

  try {
    const { gracefulShutdown } = await import('../server/index.js');
    await gracefulShutdown('before-quit', { exit: false, timeoutMs: 3000 });
  } catch (err) {
    console.error('[electron] Graceful shutdown failed:', err);
  }
  app.exit(0);
});

// ─── 7. IPC (minimal) ──────────────────────────────────────────────────────
ipcMain.handle('native:get-version', () => app.getVersion());
ipcMain.handle('native:get-paths', () => ({
  userData: USER_DATA,
  logs: LOGS_DIR,
  temp: TEMP_DIR,
}));
ipcMain.handle('native:open-path', (_, targetPath) => {
  shell.openPath(targetPath);
});

// ─── 8. Menu ───────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'Hydra',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
```

### 5.2. electron/preload.js

```js
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hydraNative', {
  appVersion: () => ipcRenderer.invoke('native:get-version'),
  appPaths: () => ipcRenderer.invoke('native:get-paths'),
  openPath: (targetPath) => ipcRenderer.invoke('native:open-path', targetPath),
  platform: process.platform,
});
```

### 5.3. electron/utils/migrateLegacyData.js

```js
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const LEGACY_DIR = path.join(process.cwd(), 'data');

export async function migrateIfNeeded() {
  const userData = process.env.HYDRA_DATA_DIR;
  if (!userData) return;

  // If userData already has files, migration already happened
  if (existsSync(userData) && readdirSync(userData).length > 0) return;

  // If legacy dir doesn't exist, nothing to migrate
  if (!existsSync(LEGACY_DIR)) {
    mkdirSync(userData, { recursive: true });
    return;
  }

  mkdirSync(userData, { recursive: true });

  const files = readdirSync(LEGACY_DIR);
  for (const file of files) {
    const src = path.join(LEGACY_DIR, file);
    const dest = path.join(userData, file);
    const stats = statSync(src);
    if (stats.isFile()) {
      copyFileSync(src, dest);
    }
  }

  console.log(`[MIGRATION] Copied ${files.length} files from ${LEGACY_DIR} to ${userData}`);
}
```

---

## 6. Build Configuration

### 6.1. package.json (scripts and deps)

```json
{
  "name": "hydra",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "electron/main.js",
  "scripts": {
    "dev": "concurrently -n vite,electron -c cyan,magenta \"vite --host\" \"wait-on http://localhost:5173 && electron . --dev\"",
    "dev:web": "node scripts/free-dev-ports.mjs && concurrently -n server,client -c blue,green \"node server/index.js\" \"vite --host\"",
    "start": "node scripts/launch.js",
    "build": "vite build",
    "preview": "npm run build && electron .",
    "electron:build": "npm run build && electron-builder",
    "electron:build:mac": "npm run build && electron-builder --mac",
    "electron:build:win": "npm run build && electron-builder --win",
    "electron:build:linux": "npm run build && electron-builder --linux",
    "postinstall": "electron-builder install-app-deps && npx prisma generate",
    "icons:generate": "node scripts/generate-icons.mjs"
  },
  "dependencies": {
    "@prisma/client": "^6.19.2",
    "axios": "^1.14.0",
    "bcryptjs": "^3.0.3",
    "cheerio": "^1.2.0",
    "cors": "^2.8.6",
    "electron-log": "^5.0.0",
    "electron-updater": "^6.3.0",
    "express": "^5.2.1",
    "express-rate-limit": "^8.3.2",
    "jsonwebtoken": "^9.0.3",
    "node-fetch": "^2.7.0",
    "p-limit": "^7.3.0",
    "playwright": "^1.58.2",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router-dom": "^7.13.2",
    "uuid": "^13.0.0",
    "winston": "^3.19.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.7.0",
    "concurrently": "^8.2.2",
    "electron": "^35.0.0",
    "electron-builder": "^26.0.0",
    "electron-vite": "^3.0.0",
    "eslint": "^9.39.4",
    "prisma": "^6.19.2",
    "vite": "^5.4.21",
    "wait-on": "^8.0.0"
  }
}
```

**Note:** `electron-log` and `electron-updater` added now (deps) so we don't need another migration later. They're lightweight.

### 6.2. electron-builder.yml

```yaml
appId: com.hydra.app
productName: Hydra
copyright: Copyright © 2026
asar: true
asarUnpack:
  - node_modules/@prisma/client/**
  - node_modules/.prisma/**
  - node_modules/playwright/.local-browsers/**
  - prisma/**

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

extraResources:
  - from: "./"
    to: "./"
    filter:
      - "data/**"

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
      arch: [x64]
  icon: desktop/icons/icon.ico
  publisherName: Hydra

linux:
  target:
    - target: AppImage
      arch: [x64]
  icon: desktop/icons/icon.png
  category: Utility

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: always
  createStartMenuShortcut: true
  license: LICENSE.txt
```

### 6.3. electron.vite.config.js

```js
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import path from 'node:path';

export default defineConfig({
  main: {
    entry: 'electron/main.js',
    outDir: 'electron-dist/main',
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    entry: 'electron/preload.js',
    outDir: 'electron-dist/preload',
    plugins: [externalizeDepsPlugin()],
  },
});
```

**Wait — do we even need electron-vite?** Let's reconsider. Our main process imports `../server/index.js` which is pure ESM. Electron supports ESM natively since v28+ IF we use `"type": "module"` and load via `import`. But `electron-builder` may have issues with ESM entry points.

**Decision:** Skip `electron-vite` for now. Use raw ESM in Electron main. This avoids another build tool. Electron 35 fully supports ESM main entry points. The tradeoff is slightly slower startup (no bundling), but our server code isn't huge.

If we hit issues with `electron-builder` + ESM, we add `electron-vite` later. Let's start simple.

**Revised:** No `electron.vite.config.js`. Just ensure `package.json` `"main"` points to `electron/main.js` and Electron handles ESM.

---

## 7. Dev Workflow (The Daily Loop)

### 7.1. Primary dev command
```bash
npm run dev
```
What happens:
1. `concurrently` starts Vite dev server on `localhost:5173`
2. `wait-on` polls until `http://localhost:5173` responds
3. Electron starts, `main.js` sets env vars, imports server, starts Express on `localhost:33100`
4. Electron window opens and loads `http://localhost:5173`
5. Frontend HMR works as usual — edit `src/`, window updates instantly

### 7.2. Server restart on change
Unlike the browser path where you manually restart `npm run dev`, in Electron dev, backend changes require a full Electron restart (Ctrl+R in DevTools won't reload the main process). We can add `nodemon` or `electron-reload` later. For now, developers restart `npm run dev` when editing `server/`.

### 7.3. Browser fallback (for debugging)
```bash
npm run dev:web
```
The old `npm run dev` behavior. Useful for debugging in real Chrome DevTools or when Electron is being weird.

---

## 8. Testing Strategy

### 8.1. Test matrix

| Test | Tool | When |
|------|------|------|
| Server unit tests | Node built-in test runner | `npm test` |
| Server still embeddable | Import test | After server refactor |
| Electron launches | Playwright for Electron | CI + manual |
| API works in Electron | HTTP smoke test | CI |
| Playwright in packaged app | Manual / CI | Before release |
| Data migration | Unit test | After migration util |
| Build succeeds | `electron-builder` | CI |

### 8.2. Automated tests

**`electron/tests/server-embed.test.mjs`**
```js
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';

process.env.HYDRA_DATA_DIR = path.join(os.tmpdir(), 'hydra-test-' + Date.now());
process.env.DATABASE_URL = `file:${path.join(process.env.HYDRA_DATA_DIR, 'hydra.db')}`;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';

const { bootstrap, gracefulShutdown } = await import('../../server/index.js');

await test('bootstrap starts on specified port', async () => {
  const info = await bootstrap({ port: 0, host: '127.0.0.1', dataDir: process.env.HYDRA_DATA_DIR });
  assert.ok(info.port > 0);
  await gracefulShutdown('test', { exit: false });
});
```

**`electron/tests/migration.test.mjs`**
- Creates fake legacy data dir
- Calls `migrateIfNeeded()`
- Asserts files copied to userData
- Asserts idempotent (second call does nothing)

**`electron/tests/window.test.mjs`** (uses Playwright for Electron)
```js
import { _electron as electron } from 'playwright';

const app = await electron.launch({ args: ['.'], env: { ...process.env, NODE_ENV: 'test' } });
const window = await app.firstWindow();
await window.waitForLoadState('domcontentloaded');
assert.ok(await window.title().then(t => t.includes('Hydra')));
```

### 8.3. CI workflow (`.github/workflows/electron.yml`)

```yaml
name: Electron
on: [push, pull_request]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run test:electron:unit
      - run: npm run build
      - run: npm run electron:build
        if: matrix.os == 'macos-latest'
```

---

## 9. Risk Register (Self-Critical)

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | **ESM entry point fails in Electron** | Medium | App won't start | Test on Electron 35 before committing; fallback to `electron-vite` bundler |
| 2 | **Prisma can't find query engine in asar** | High | All DB ops fail | `asarUnpack` for `@prisma/client` + `.prisma`; test in packaged build |
| 3 | **Playwright can't find Chromium in asar** | High | Provisioning fails | `asarUnpack` for `playwright/.local-browsers`; set `PLAYWRIGHT_BROWSERS_PATH=0` |
| 4 | **process.exit() in server kills Electron** | Medium | App crashes on any error | Audit ALL `process.exit()` in server; refactor to throw/callback |
| 5 | **Signal handlers conflict** | Medium | Shutdown hangs or crashes | Remove `process.on('SIGINT')` from server; handle only in Electron main |
| 6 | **Data migration corrupts or misses files** | Low | Data loss | Atomic copy (not move); verify checksums; backup first |
| 7 | **Port collision on 33100** | Low | Startup fail | Dynamic port discovery; retry logic |
| 8 | **__dirname resolution breaks in asar** | Medium | Static files not served | Use `app.getAppPath()` in Electron; verify distPath resolution |
| 9 | **macOS Gatekeeper blocks unsigned app** | High | Users can't open | Document right-click → Open; plan for code signing ($99/year) |
| 10 | **Windows Defender false positive** | Medium | App quarantined | Code signing helps; avoid suspicious APIs |
| 11 | **bcryptjs native binding mismatch** | Low | Auth fails | bcryptjs is pure JS (no native bindings), so this is safe |
| 12 | **Vite proxy config assumes port 3001** | Low | Dev API calls fail | Express in dev runs on random port, but frontend calls relative URLs. Vite proxy only needed in `dev:web` mode |
| 13 | **Electron main process size bloat** | Medium | 200MB+ download | `electron-builder` prunes devDeps; dedupe; use dmg/zip compression |
| 14 | **Logger writes to console only — no log files** | Low | Hard to debug user issues | Add `electron-log` later to write to userData/logs |
| 15 | **import.meta.url === process.argv[1] check fails** | Low | Server auto-starts in Electron | Just remove auto-bootstrap entirely; don't use guards |

---

## 10. Subagent Task Decomposition (12 Agents)

Each agent receives this plan section, the current codebase, and produces a PR-ready branch.

### Agent A: Server Extract (Phase 1)
**Task:** Make `server/index.js` embeddable.
**Files:** `server/index.js`
**Deliverables:**
- Remove `bootstrap()` auto-call
- Remove `process.on('SIGINT')` and `process.on('SIGTERM')`
- Refactor `gracefulShutdown({ exit, timeoutMs })`
- Export `bootstrap`, `gracefulShutdown`, `app`
- Ensure `node server/index.js` does NOT start a server (verify)
- Update `scripts/launch.js` to call `bootstrap()` explicitly
- All existing tests pass

### Agent B: Data Path Abstraction (Phase 2)
**Task:** Abstract all `process.cwd()/data` references.
**Files:** `server/services/local-secrets.js`, `server/services/proxy-gate.js`, `server/services/auth.js`, `server/services/redemption-log.js`
**Deliverables:**
- Each service reads `process.env.HYDRA_DATA_DIR` || `process.cwd()/data`
- No behavior change when env is not set (terminal path preserved)
- Unit test for each service verifying env override works

### Agent C: Electron Main Shell (Phase 3)
**Task:** Create the Electron main process.
**Files:** `electron/main.js`, `electron/utils/paths.js`, `electron/utils/getFreePort.js`, `electron/utils/migrateLegacyData.js`
**Deliverables:**
- `main.js` imports server, sets env, starts Express, opens window
- `getFreePort()` works with retry
- `migrateLegacyData()` copies legacy data safely
- `npm run dev` opens Electron window with Vite HMR
- Graceful shutdown on quit (no orphan processes)

### Agent D: Preload & IPC (Phase 4)
**Task:** Secure preload bridge.
**Files:** `electron/preload.js`, `electron/main.js` (IPC handlers)
**Deliverables:**
- `preload.js` exposes minimal API via `contextBridge`
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- IPC handlers: `get-version`, `get-paths`, `open-path`
- No `fs`, `child_process`, or `require` exposed

### Agent E: Menu & Native UX (Phase 5)
**Task:** Native menus and window chrome.
**Files:** `electron/menus/appMenu.js`, `electron/menus/contextMenu.js`
**Deliverables:**
- App menu (macOS: Hydra, Edit, View, Window)
- Context menu for text editing
- `hiddenInset` title bar on macOS
- Proper dock icon behavior (macOS)

### Agent F: Package & Build Config (Phase 6)
**Task:** npm scripts and electron-builder config.
**Files:** `package.json`, `electron-builder.yml`, `scripts/generate-icons.mjs`
**Deliverables:**
- All scripts defined and working
- `electron-builder.yml` with correct `asarUnpack`
- Icon generation script (PNG → icns + ico)
- `postinstall` hook for native deps
- `npm run electron:build` produces `.dmg` on mac

### Agent G: Icon & Asset Pipeline (Phase 7)
**Task:** Generate and verify icons.
**Files:** `desktop/icons/`, `scripts/generate-icons.mjs`
**Deliverables:**
- Source icon (1024x1024 PNG) — use existing favicon or generate
- `icon.icns` for macOS
- `icon.ico` for Windows
- `icon.png` for Linux
- Verify icons appear in built app

### Agent H: Server Unit Tests (Phase 8)
**Task:** Verify server refactor didn't break anything.
**Files:** `electron/tests/server-embed.test.mjs`, updates to existing tests
**Deliverables:**
- Test that `bootstrap({ port, dataDir })` works
- Test that `gracefulShutdown({ exit: false })` doesn't call `process.exit()`
- All existing `npm run test:*` scripts pass
- New test: import server in a subprocess and verify it doesn't auto-start

### Agent I: Electron Integration Tests (Phase 9)
**Task:** Test Electron app with Playwright for Electron.
**Files:** `electron/tests/window.test.mjs`, `electron/tests/migration.test.mjs`
**Deliverables:**
- Window opens and loads UI
- API responds to requests from renderer
- Data migration works correctly
- Playwright-for-Electron test passes in CI

### Agent J: Playwright in Packaged App (Phase 10)
**Task:** Verify Playwright automation works in built app.
**Files:** Manual testing script
**Deliverables:**
- Build the app
- Trigger a management key provision
- Verify Playwright launches Chromium successfully
- If fails, debug and fix `asarUnpack` or `PLAYWRIGHT_BROWSERS_PATH`

### Agent K: CI/CD Pipeline (Phase 11)
**Task:** GitHub Actions for Electron builds.
**Files:** `.github/workflows/electron.yml`
**Deliverables:**
- CI runs on push/PR for macOS, Windows, Linux
- Builds Electron artifact
- Runs integration tests
- Uploads `.dmg`/`.exe` as artifacts on tags

### Agent L: Documentation & Troubleshooting (Phase 12)
**Task:** Update all docs.
**Files:** `README.md`, `docs/ELECTRON_MASTER_PLAN.md` (mark complete), `docs/ELECTRON_TROUBLESHOOTING.md`
**Deliverables:**
- `README.md` has Electron install instructions
- `docs/DEVELOPMENT.md` updated with Electron dev workflow
- Troubleshooting guide for common issues (Gatekeeper, antivirus, data migration)
- Archive old Electron plans

---

## 11. Execution Order & Dependencies

```
Phase 1 (Agent A) ──→ Phase 2 (Agent B)
     │                    │
     └────────────────────┘
              │
              ▼
     Phase 3 (Agent C) ──┬──→ Phase 4 (Agent D)
     (main shell)         │    (preload)
              │           ├──→ Phase 5 (Agent E)
              │           │    (menus)
              │           └──→ Phase 6 (Agent F)
              │                (build config)
              │
              ▼
     Phase 7 (Agent G) ──→ Phase 8 (Agent H)
     (icons/assets)        (server tests)
              │                    │
              └────────────────────┘
                       │
                       ▼
     Phase 9 (Agent I) ──→ Phase 10 (Agent J)
     (integration tests)   (Playwright packaging)
              │                    │
              └────────────────────┘
                       │
                       ▼
     Phase 11 (Agent K) ──→ Phase 12 (Agent L)
     (CI/CD)                (docs)
```

**Critical path:** A → B → C → F → J. Everything else can run in parallel or shortly after.

---

## 12. Verification Checklist (Definition of Done)

- [ ] `npm run dev:web` works exactly as before (browser path preserved)
- [ ] `npm start` (`scripts/launch.js`) works exactly as before
- [ ] `npm run dev` opens Electron window, loads UI, HMR works
- [ ] `npm run preview` opens Electron window with production build
- [ ] `npm run electron:build` produces `.dmg` (mac) or `.exe` (win)
- [ ] Built app opens on a clean machine WITHOUT Node.js installed
- [ ] Built app persists data across restarts
- [ ] First launch copies legacy `./data/` to `userData`
- [ ] Second launch uses `userData` (no re-copy)
- [ ] Graceful shutdown: no orphan Node processes after quit
- [ ] Playwright provisioning works in built app
- [ ] All existing tests pass (`npm run test:*`)
- [ ] New Electron tests pass (`npm run test:electron:*`)
- [ ] CI passes on macOS and Windows
- [ ] `server/` has ZERO Electron-specific code
- [ ] `src/` has ZERO Electron-specific code (only uses `window.hydraNative` if needed)
- [ ] Code signing documented (even if not implemented yet)
- [ ] README has install instructions for end users

---

## 13. Known Issues & Gotchas (From Research)

### 13.1. ESM in Electron main
Electron 28+ supports ESM, but `electron-builder` may have issues detecting the entry point. We may need `"main": "electron/main.js"` and ensure the file has `.js` extension (not `.mjs`). Since `package.json` already has `"type": "module"`, `.js` is treated as ESM.

### 13.2. `__dirname` in ESM
We use `const __dirname = dirname(fileURLToPath(import.meta.url));` — this works in both development and packaged apps. BUT in asar, `fileURLToPath(import.meta.url)` may return an asar-path. For loading `preload.js`, we use `path.join(__dirname, 'preload.js')` which works because both files are in the same directory structure inside the asar.

### 13.3. `app.getAppPath()` vs `__dirname`
For loading `dist/` files, `server/index.js` uses `join(__dirname, '..', 'dist')`. In a packaged app, `__dirname` is inside the asar. This should work because `dist/` is also inside the asar. But if we use `asarUnpack` for `dist/` (we shouldn't), paths break. Keep `dist/` inside asar.

### 13.4. Playwright browser downloads
Playwright downloads browsers on `npm install` via postinstall. In CI, this adds time. For packaged apps, the browsers must be included. `asarUnpack` for `playwright/.local-browsers` ensures they're real files.

### 13.5. macOS code signing without Apple ID
Without signing, macOS shows "cannot be opened because the developer cannot be verified." Users must right-click → Open. This is acceptable for v1. Plan for signing in v2.

### 13.6. Windows: long path names
`node_modules` paths can exceed 260 chars on Windows, breaking `electron-builder`. Use `buildDependenciesFirst: true` and ensure npm flattens where possible.

### 13.7. Linux: AppImage permissions
AppImages need `chmod +x` and may need FUSE. Document this.

---

## 14. Appendix: Decisions Log

| Decision | Alternatives | Why chosen |
|----------|-------------|------------|
| Electron, not Tauri | Tauri, Neutralinojs, PWA | Native Node/Prisma/Playwright stack; no Rust rewrite |
| ESM main process | CJS + electron-vite bundler | Simpler; Electron 35 supports ESM natively; avoid extra build tool |
| No IPC for API calls | IPC bridge for every endpoint | `fetch()` to localhost works; zero frontend changes |
| Express in main process | Express in hidden renderer | Main process is the canonical Node runtime; cleaner |
| Dynamic port (33100+) | Hardcoded 3001 | Avoids conflicts; user may already have 3001 |
| `asarUnpack` for native deps | No asar (slower) | Prisma + Playwright need real filesystem access |
| Browser path preserved | Kill browser dev | Contributors may not want Electron overhead; debugging |
| Console-only logs | File-based logs (winston) | `electron-log` can be added later; simpler now |

---

**Ready for review. Once approved, dispatch Agent A to begin.**
