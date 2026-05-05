/**
 * Hydra Electron Main Process — Orchestrator
 *
 * Lifecycle:
 *   1. Setup logging, platform, single-instance lock, environment
 *   2. Show a splash window IMMEDIATELY (perceived startup speed)
 *   3. Quick sentinel check — does schema need re-sync? (just read a file)
 *   4. Boot the Express server (import static bootstrap + dynamic port)
 *   5. Register IPC handlers + setup app menu
 *   6. Create main window, load URL, swap splash → real window
 *   7. After window is shown: fire-and-forget firstLaunchSetup (legacy migration + schema sync, non-blocking)
 *   8. On quit: kill tracked child processes, run gracefulShutdown, app.exit
 *
 * Delegates implementation to split modules under app/ and utils/.
 */
import { app, dialog, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Modules ─────────────────────────────────────────────────────────────────
import {
  isDev, setupLogging, setupPlatform, setupEnvironment,
  ensurePackagedRuntimeState, ICON_PATH, LOCAL_UI_HOSTS, EXTERNAL_URL_ALLOWLIST,
} from './app/env.js';
import {
  createSplashWindow as createSplash,
  showAndFocusMainWindow as showAndFocus,
  createMainWindow as createWin,
} from './app/windows.js';
import { registerIpcHandlers } from './app/ipc.js';
import { shouldSyncSchema, firstLaunchSetup } from './app/schemaSync.js';
import { shutdownEverything } from './app/shutdown.js';
import { killKnownHydraAuxiliaryProcesses } from './utils/cleanupAuxProcesses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// ─── Init ────────────────────────────────────────────────────────────────────
app.setName('Hydra');
setupLogging();
setupPlatform();

// Single-instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Environment (MUST be before any server import)
setupEnvironment(app);

// ─── Runtime State ──────────────────────────────────────────────────────────
let mainWindow = null;
let splashWindow = null;
let tray = null;
let gracefulShutdown = null;
let windowURL = null;
let forceQuit = false;
let closePromptPending = false;
const shuttingDownRef = { value: false };
const trackedChildren = new Set();

// ─── External URL helpers ───────────────────────────────────────────────────
function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && EXTERNAL_URL_ALLOWLIST.has(parsed.hostname);
  } catch { return false; }
}

async function openExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) {
    console.warn(`[electron] blocked external URL: ${rawUrl}`);
    return false;
  }
  await shell.openExternal(rawUrl);
  return true;
}

// ─── Tray ───────────────────────────────────────────────────────────────────
function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  let img = nativeImage.createFromPath(ICON_PATH);
  if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Hydra — local OpenRouter proxy');
  const rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Show Hydra', click: () => showAndFocus(mainWindow) },
      { type: 'separator' },
      { label: `Status: ${windowURL ? 'proxy running' : 'starting'}`, enabled: false },
      { label: windowURL ? `Proxy URL: ${windowURL}/v1` : 'Proxy URL: starting', enabled: false },
      { type: 'separator' },
      { label: 'Open Logs Folder', click: () => shell.openPath(app.getPath('logs')) },
      { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
      { type: 'separator' },
      {
        label: 'Hide Window',
        click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); },
      },
      {
        label: 'Quit Hydra Completely',
        click: () => { forceQuit = true; app.quit(); },
      },
    ]);
    tray.setContextMenu(menu);
  };
  rebuildMenu();
  tray.on('click', () => showAndFocus(mainWindow));
  return tray;
}

// ─── Second-instance handler ────────────────────────────────────────────────
app.on('second-instance', () => { showAndFocus(mainWindow); });

// ─── Window close handler (keep-proxy dialog) ──────────────────────────────
async function onMainWindowClose(event, win) {
  if (forceQuit || shuttingDownRef.value) return;
  event.preventDefault();
  if (closePromptPending) return;
  closePromptPending = true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Keep Proxy Running', 'Quit Hydra', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Keep Hydra running?',
    message: 'Keep Hydra running in the background?',
    detail: 'The window will close, but the local server and proxy stay online. Choose Quit Hydra to stop the proxy.',
  });
  closePromptPending = false;
  if (win.isDestroyed()) return;
  if (response === 0) {
    win.hide();
    return;
  }
  if (response === 1) {
    forceQuit = true;
    app.quit();
  }
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // Splash IMMEDIATELY so the user sees something while we boot.
    splashWindow = createSplash();
    splashWindow.once('closed', () => { splashWindow = null; });

    await killKnownHydraAuxiliaryProcesses('startup sweep');
    await ensurePackagedRuntimeState();

    // Quick sentinel check (just read a file, no heavy work)
    const needsSync = await shouldSyncSchema();

    const server = await import('../server/index.js');
    gracefulShutdown = server.gracefulShutdown;

    const PORT = isDev ? 3001 : 0;
    const s = await server.bootstrap({ port: PORT, silent: !isDev });
    const expressPort = s.address()?.port ?? PORT;

    const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    windowURL = isDev ? VITE_DEV_SERVER_URL : `http://localhost:${expressPort}`;
    console.log(`[electron] Hydra UI listening at ${windowURL}`);

    // IPC handlers
    registerIpcHandlers({
      windowURL,
      onHideWindow: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      },
      onQuitApp: () => {
        forceQuit = true;
        app.quit();
      },
    });

    // App menu
    const { setupAppMenu } = await import('./menus/appMenu.js');
    setupAppMenu({
      isDev,
      openExternalUrl,
      getServerUrl: () => windowURL,
      showAndFocusMainWindow: () => showAndFocus(mainWindow),
      hideWindow: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      },
      quitCompletely: () => {
        forceQuit = true;
        app.quit();
      },
    });

    // Tray icon
    createTray();

    // Main window
    mainWindow = createWin({
      preloadPath: PRELOAD_PATH,
      windowURL,
      openExternalUrl,
      onClose: onMainWindowClose,
    });
    mainWindow.on('closed', () => { mainWindow = null; });

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

    // Fire-and-forget firstLaunchSetup in background, but surface failures visibly
    if (needsSync) {
      firstLaunchSetup(trackedChildren).catch(e => {
        console.error('[electron] background firstLaunchSetup failed:', e);
        // Bug #35: show a dialog so the user knows something went wrong
        // instead of seeing silent 500s with no explanation.
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showErrorBox(
            'Database Setup Error',
            'Hydra was unable to sync the database schema.\n\n' +
            'This may mean the app needs to be restarted. If the problem persists, ' +
            'your database may be corrupt.\n\n' +
            'Error: ' + (e.message || String(e)),
          );
        }
      });
    }
  } catch (e) {
    console.error('[electron] Failed to start Hydra:', e);
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    dialog.showErrorBox('Hydra Startup Error', e.message || String(e));
    app.quit();
  }
});

// ─── macOS dock / window lifecycle ─────────────────────────────────────────
app.on('window-all-closed', () => {
  // Closing the UI window hides it so the local proxy can keep serving.
  // Quit explicitly from the menu, dock, or shutdown action to stop the server.
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showAndFocus(mainWindow);
    return;
  }
  if (windowURL) {
    mainWindow = createWin({
      preloadPath: PRELOAD_PATH,
      windowURL,
      openExternalUrl,
      onClose: onMainWindowClose,
      show: true,
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.loadURL(windowURL).catch(loadErr =>
      console.error('[electron] Activate loadURL failed:', loadErr.message));
  }
});

// ─── Shutdown ──────────────────────────────────────────────────────────────
app.on('before-quit', (event) => {
  if (shuttingDownRef.value) return;
  event.preventDefault();
  shutdownEverything({
    reason: 'before-quit',
    trackedChildren,
    gracefulShutdown,
    shuttingDownRef,
  }).finally(() => app.exit(0));
});

process.on('uncaughtException', async (err) => {
  console.error('[electron] uncaughtException:', err);
  await shutdownEverything({
    reason: 'uncaughtException',
    trackedChildren,
    gracefulShutdown,
    shuttingDownRef,
  });
  app.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('[electron] unhandledRejection:', reason);
  // Don't exit on unhandled rejections — many are benign — but DO log loudly.
});
