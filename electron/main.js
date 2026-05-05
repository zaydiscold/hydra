/**
 * Hydra Electron Main Process
 *
 * Lifecycle:
 *   1. Wire electron-log so console.* persists to ~/Library/Logs/Hydra/main.log
 *   2. Pin platform-native data paths BEFORE any server import
 *   3. Show a splash window IMMEDIATELY (perceived startup speed)
 *   4. Quick sentinel check — does schema need re-sync? (just read a file)
 *   5. Boot the Express server (import static bootstrap + dynamic port)
 *   6. Register IPC handlers + setup app menu
 *   7. Create main window, load URL, swap splash → real window
 *   8. After window is shown: fire-and-forget firstLaunchSetup (legacy migration + schema sync, non-blocking)
 *   9. On quit: kill tracked child processes, run gracefulShutdown, app.exit
 */
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import log from 'electron-log/main.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
app.setName('Hydra');

// Single-instance lock: a second double-click of Hydra.app focuses the
// existing window instead of spawning another Electron + Express that fights
// for the same DB lock and local server.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ─── 0. Persistent logging (file + rotating) ────────────────────────────────
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = isDev ? 'debug' : 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
Object.assign(console, log.functions);

// ─── 1. Paths and constants ─────────────────────────────────────────────────
const APP_ROOT = isDev ? path.resolve(__dirname, '..') : app.getAppPath();
const RESOURCES_PATH = isDev ? APP_ROOT : process.resourcesPath;
const SCHEMA_PATH = path.join(isDev ? APP_ROOT : RESOURCES_PATH, 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = path.join(isDev ? APP_ROOT : RESOURCES_PATH, 'prisma', 'migrations');
const PRISMA_BIN = path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
const ICON_PATH = path.join(__dirname, '..', 'desktop', 'icons', 'icon.png');

if (process.platform === 'darwin' && isDev) {
  app.dock?.setIcon(ICON_PATH);
}

// Disable browser features we do not use. Keep GPU compositing enabled:
// this UI is CSS-heavy, and software compositing makes window open/paint feel laggy.
app.commandLine.appendSwitch('disable-features', 'Translate');

// ─── 2. Environment Setup (MUST be before any server import) ────────────────
process.env.HYDRA_DATA_DIR = app.getPath('userData');
process.env.DATABASE_URL = 'file:' + path.join(app.getPath('userData'), 'hydra.db');
process.env.HYDRA_EMBEDDED = '1';
if (!isDev && !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

// ─── 3. State ───────────────────────────────────────────────────────────────
let mainWindow = null;
let splashWindow = null;
let tray = null;
let gracefulShutdown = null;
let windowURL = null;
let shuttingDown = false;
let forceQuit = false;
const trackedChildren = new Set();  // every spawn'd subprocess we want to tear down

/** Show + focus the main window, restoring the dock if it was hidden. */
function showAndFocusMainWindow() {
  if (process.platform === 'darwin') app.dock?.show();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

/** Build the macOS menu-bar Tray icon so the proxy stays reachable when the window is hidden. */
function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  // The full 512×512 icon would look comically large in the tray; use it
  // as a base and let macOS scale + render it as a regular (color) image.
  // For a proper template image, ship a separate 22×22 black-on-transparent PNG.
  let img = nativeImage.createFromPath(ICON_PATH);
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Hydra — local OpenRouter proxy');
  const rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Show Hydra', click: showAndFocusMainWindow },
      { type: 'separator' },
      { label: 'Open Logs Folder', click: () => shell.openPath(app.getPath('logs')) },
      { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      {
        label: 'Quit Hydra',
        click: () => {
          forceQuit = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
  };
  rebuildMenu();
  tray.on('click', showAndFocusMainWindow);
  return tray;
}

// Second-instance handler: when the user double-clicks Hydra.app while it's
// already running, surface the existing window instead of doing nothing.
app.on('second-instance', () => {
  showAndFocusMainWindow();
});

// ─── 4. Schema sync with sentinel (skip on every-launch tax) ───────────────
//
// Hash schema.prisma content + migration SQL filenames against a sentinel
// in userData. Content-hash is more reliable than mtime, which can change
// for non-content reasons (packaging normalizes timestamps, git ops, etc.).
/**
 * Hash schema.prisma + every migration's SQL into one sha256.
 * Skips top-level files in `migrations/` (e.g. `migration_lock.toml`) by
 * stat-checking each entry — only iterates the timestamp-prefixed migration
 * *directories*. The previous version called `readdirSync(migration_lock.toml)`
 * which threw `ENOTDIR`.
 */
async function computeSchemaContentHash() {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  hash.update(readFileSync(SCHEMA_PATH));
  const entries = readdirSync(MIGRATIONS_DIR).sort();
  for (const name of entries) {
    const full = path.join(MIGRATIONS_DIR, name);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { /* skip dangling */ }
    if (!isDir) continue;
    const files = readdirSync(full).sort();
    for (const f of files) {
      hash.update(name + '/' + f);
      hash.update(readFileSync(path.join(full, f)));
    }
  }
  return hash.digest('hex');
}

async function shouldSyncSchema() {
  try {
    const currentHash = await computeSchemaContentHash();
    const { readFileSync } = await import('node:fs');
    const sentinel = path.join(app.getPath('userData'), '.schema-version');
    const stored = readFileSync(sentinel, 'utf-8').trim();
    return stored !== currentHash;
  } catch {
    return true;
  }
}

async function markSchemaSynced() {
  try {
    const currentHash = await computeSchemaContentHash();
    const { writeFileSync } = await import('node:fs');
    const sentinel = path.join(app.getPath('userData'), '.schema-version');
    writeFileSync(sentinel, currentHash);
  } catch (e) {
    console.warn('[electron] failed to write schema-version sentinel:', e.message);
  }
}

async function syncSchemaWithFallback() {
  if (!(await shouldSyncSchema())) {
    console.log('[electron] schema unchanged — skipping sync');
    return;
  }
  console.log('[electron] schema changed — syncing');

  const { execFile } = await import('node:child_process');
  const { existsSync } = await import('node:fs');

  const tryPushAsync = (label, bin, args, cwd) => new Promise((resolve) => {
    const child = execFile(bin, args, { cwd, env: process.env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn(`[electron] schema sync via ${label} failed: ${err.message}${stderr ? '\n' + stderr.trim() : ''}`);
        resolve(false);
      } else {
        console.log(`[electron] schema synced (${label})`);
        resolve(true);
      }
    });
    trackedChildren.add(child);
    child.on('exit', () => trackedChildren.delete(child));
  });

  // 1. Local prisma binary
  if (existsSync(PRISMA_BIN)) {
    if (await tryPushAsync('local prisma', PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
      await markSchemaSynced();
      return;
    }
  } else {
    console.warn(`[electron] local prisma not found at ${PRISMA_BIN}`);
  }

  // 2. npx (dev only — packaged apps rarely have npx on PATH)
  if (isDev) {
    if (await tryPushAsync('npx', 'npx', ['prisma', 'db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
      await markSchemaSynced();
      return;
    }
  }

  // 3. Self-heal: replay migration SQL idempotently
  console.warn('[electron] falling back to db-self-heal');
  try {
    const { runSelfHeal } = await import('../server/lib/db-self-heal.js');
    const dbPath = path.join(app.getPath('userData'), 'hydra.db');
    const summary = await runSelfHeal({ dbPath, migrationsDir: MIGRATIONS_DIR, log: (m) => console.log(m) });
    console.log(`[electron] db-self-heal: ${summary.applied} applied, ${summary.skipped} already present, ${summary.errors} errors`);
    if (summary.errors === 0) await markSchemaSynced();
    if (summary.errors > 0) console.error('[electron] db-self-heal errors:\n  ' + summary.errorDetails.join('\n  '));
  } catch (e) {
    console.error('[electron] db-self-heal failed completely:', e.message);
  }
}

async function firstLaunchSetup() {
  try {
    const { migrateIfNeeded } = await import('./utils/migrateLegacyData.js');
    await migrateIfNeeded();
  } catch (e) {
    console.warn('[electron] Legacy data migration skipped:', e.message);
  }
  await syncSchemaWithFallback();
}

// ─── 5. Splash window — paints in <100 ms ────────────────────────────────────
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 340,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const glyphs = Array.from({ length: 22 }, (_, i) => {
    const x = 3 + ((i * 17) % 94);
    const duration = 4.6 + ((i % 6) * 0.45);
    const delay = -((i * 0.41) % 4.8);
    const opacity = 0.16 + ((i % 5) * 0.04);
    const text = i % 3 === 0 ? 'HYDRA' : i % 3 === 1 ? 'PROXY' : '01011';
    return `<span style="--x:${x};--t:${duration}s;--d:${delay}s;--o:${opacity}">${text}</span>`;
  }).join('');

  const splashHTML = `
    <!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'"><style>
      html,body{margin:0;height:100%;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter',sans-serif;color:#f8fbff;overflow:hidden}
      .frame{position:absolute;inset:10px;border-radius:22px;background:linear-gradient(145deg,rgba(8,11,20,.96),rgba(16,4,28,.98) 50%,rgba(4,21,29,.96));border:1px solid rgba(255,255,255,.12);box-shadow:0 28px 90px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.12);overflow:hidden}
      .frame:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 24% 20%,rgba(88,166,255,.22),transparent 28%),radial-gradient(circle at 78% 18%,rgba(255,77,109,.18),transparent 30%),linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px);background-size:auto,auto,100% 7px;pointer-events:none}
      .rain{position:absolute;inset:-140px 0 0;mask-image:linear-gradient(transparent,#000 16%,#000 76%,transparent)}
      .rain span{position:absolute;left:calc(var(--x) * 1%);top:-160px;width:18px;color:rgba(130,226,255,var(--o));font:700 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;text-orientation:upright;writing-mode:vertical-rl;text-shadow:0 0 18px rgba(77,208,255,.72);animation:fall var(--t) linear infinite;animation-delay:var(--d)}
      .content{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
      .mark{position:relative;width:116px;height:116px;margin:0 auto 20px;border-radius:30px;background:linear-gradient(135deg,rgba(255,77,109,.92),rgba(121,92,255,.86) 48%,rgba(48,213,200,.88));box-shadow:0 20px 56px rgba(83,77,255,.28),0 0 0 1px rgba(255,255,255,.22) inset;display:grid;place-items:center}
      .mark:before{content:"";position:absolute;inset:10px;border-radius:24px;background:rgba(4,7,13,.72);box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
      .mark:after{content:"H";position:relative;font-size:60px;font-weight:900;color:#fff;text-shadow:0 0 26px rgba(255,255,255,.62)}
      h1{font-size:42px;font-weight:850;letter-spacing:0;margin:0 0 7px;background:linear-gradient(90deg,#fff,#9de9ff 46%,#ff8fa3);-webkit-background-clip:text;background-clip:text;color:transparent}
      .sub{font-size:13px;font-weight:600;color:rgba(232,242,255,.68);margin-bottom:22px}
      .bar{width:154px;height:5px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;margin:0 auto}
      .bar i{display:block;width:48%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#4dd0ff,#ff4d6d);box-shadow:0 0 18px rgba(77,208,255,.8);animation:sweep 1.35s ease-in-out infinite}
      @keyframes fall{from{transform:translateY(0)}to{transform:translateY(560px)}}
      @keyframes sweep{0%{transform:translateX(-110%)}55%{transform:translateX(105%)}100%{transform:translateX(230%)}}
    </style></head><body><div class="frame"><div class="rain">${glyphs}</div><div class="content"><div><div class="mark"></div><h1>HYDRA</h1><div class="sub">Starting local proxy</div><div class="bar"><i></i></div></div></div></div></body></html>`;
  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHTML));
  splashWindow.once('closed', () => { splashWindow = null; });
}

// ─── 6. IPC handlers — Result-type pattern + arg validation ────────────────
function ok(data) { return { ok: true, data }; }
function err(message, code) { return { ok: false, error: message, code }; }

function isPathAllowed(target) {
  if (typeof target !== 'string' || target.length === 0) return false;
  const normalized = path.resolve(target);
  const allowed = [app.getPath('userData'), app.getPath('logs'), app.getPath('downloads'), app.getPath('documents')];
  return allowed.some(root => normalized === root || normalized.startsWith(root + path.sep));
}

function registerIpcHandlers() {
  ipcMain.handle('native:get-version', async () => { try { return ok(app.getVersion()); } catch (e) { return err(e.message); } });
  ipcMain.handle('native:get-paths', async () => {
    try {
      return ok({
        userData: app.getPath('userData'),
        home: app.getPath('home'),
        logs: app.getPath('logs'),
        downloads: app.getPath('downloads'),
        documents: app.getPath('documents'),
      });
    } catch (e) { return err(e.message); }
  });
  ipcMain.handle('native:open-path', async (_event, targetPath) => {
    if (typeof targetPath !== 'string') return err('targetPath must be a string', 'BAD_ARG');
    if (!isPathAllowed(targetPath)) return err(`path not in allowlist: ${targetPath}`, 'PATH_DENIED');
    try {
      const r = await shell.openPath(targetPath);
      if (r) return err(r, 'OPEN_FAILED');
      return ok(true);
    } catch (e) { return err(e.message, 'OPEN_FAILED'); }
  });
  ipcMain.handle('native:platform', async () => ok(process.platform));
  ipcMain.handle('native:hide-window', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      return ok(true);
    }
    return err('main window is not available', 'NO_WINDOW');
  });
  ipcMain.handle('native:quit-app', async () => {
    forceQuit = true;
    app.quit();
    return ok(true);
  });
}

function createMainWindow({ show = false } = {}) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Hydra',
    icon: ICON_PATH,
    backgroundColor: '#0a0014',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
    show,
  });

  win.on('close', (event) => {
    if (forceQuit || shuttingDown) return;

    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Keep Proxy Running', 'Quit Hydra', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Keep Hydra running?',
      message: 'Keep Hydra running in the background?',
      detail: 'The window will close, but the local server and proxy stay online. Choose Quit Hydra to stop the proxy.',
    });

    if (choice === 0) {
      win.hide();
      return;
    }

    if (choice === 1) {
      forceQuit = true;
      app.quit();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

// ─── 7. App Lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // Splash IMMEDIATELY so the user sees something while we boot.
    createSplashWindow();

    // Quick sentinel check (just read a file, no heavy work)
    const needsSync = await shouldSyncSchema();

    const server = await import('../server/index.js');
    gracefulShutdown = server.gracefulShutdown;

    const PORT = isDev ? 3001 : 0;
    const s = await server.bootstrap({ port: PORT, silent: !isDev });
    const expressPort = s.address()?.port ?? PORT;

    const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    windowURL = isDev ? VITE_DEV_SERVER_URL : `http://localhost:${expressPort}`;

    registerIpcHandlers();

    const { setupAppMenu } = await import('./menus/appMenu.js');
    setupAppMenu();

    // Tray icon — keeps Hydra reachable from the menu bar even when the
    // main window is hidden ("Keep Proxy Running" in the close dialog).
    createTray();

    mainWindow = createMainWindow({ show: false });

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    });

    const loadTimeout = setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    }, 15000);
    try {
      await mainWindow.loadURL(windowURL);
    } finally {
      clearTimeout(loadTimeout);
    }

    // ─── Now run firstLaunchSetup in background ───
    // Server is up, window is shown — migrate/sync in background
    if (needsSync) {
      firstLaunchSetup().catch(e => console.error('[electron] background firstLaunchSetup failed:', e));
    }
  } catch (e) {
    console.error('[electron] Failed to start Hydra:', e);
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    dialog.showErrorBox('Hydra Startup Error', e.message || String(e));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Closing the UI window hides it so the local proxy can keep serving.
  // Quit explicitly from the menu, dock, or shutdown action to stop the server.
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showAndFocusMainWindow();
    return;
  }
  if (windowURL) {
    mainWindow = createMainWindow({ show: true });
    mainWindow.loadURL(windowURL).catch(loadErr => console.error('[electron] Activate loadURL failed:', loadErr.message));
  }
});

// ─── 8. Wind-down — kill children, graceful server, force exit ──────────────
function killTrackedChildren() {
  for (const child of trackedChildren) {
    try {
      child.kill('SIGTERM');
    } catch { /* already dead */ }
  }
  trackedChildren.clear();
}

async function shutdownEverything(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[electron] shutdown initiated: ${reason}`);
  killTrackedChildren();
  try {
    if (gracefulShutdown) await gracefulShutdown(reason, { exit: false, timeoutMs: 3000 });
  } catch (e) {
    console.error('[electron] gracefulShutdown threw:', e);
  }
}

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shutdownEverything('before-quit').finally(() => app.exit(0));
});

// Catch crashes too — don't leave a half-running server when the GUI dies.
process.on('uncaughtException', async (err) => {
  console.error('[electron] uncaughtException:', err);
  await shutdownEverything('uncaughtException');
  app.exit(1);
});
process.on('unhandledRejection', async (reason) => {
  console.error('[electron] unhandledRejection:', reason);
  // Don't exit on unhandled rejections — many are benign — but DO log loudly.
});
