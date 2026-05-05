/**
 * Hydra Electron Main Process
 *
 * Thin orchestrator — imports modules from electron/app/ for each concern.
 *
 * Lifecycle:
 *   1. Wire electron-log so console.* persists to ~/Library/Logs/Hydra/main.log
 *   2. Pin platform-native data paths BEFORE any server import
 *   3. Show a splash window IMMEDIATELY (perceived startup speed)
 *   4. Quick sentinel check — does schema need re-sync? (just read a file)
 *   5. Boot the Express server (import static bootstrap + dynamic port)
 *   6. Register IPC handlers + setup app menu
 *   7. Create main window, load URL, swap splash → real window
 *   8. After window is shown: fire-and-forget firstLaunchSetup (legacy migration + schema sync)
 *   9. On quit: kill tracked child processes, run gracefulShutdown, app.exit
 */
import { app, BrowserWindow, Menu, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import log from 'electron-log/main.js';

// ─── App modules ─────────────────────────────────────────────────────────────
import { isDev, ICON_PATH, ensurePackagedRuntimeState } from './app/env.js';
import {
  getMainWindow, getSplashWindow, getGracefulShutdown, getShuttingDown, getWindowURL,
  setGracefulShutdown, setWindowURL, setForceQuit,
  killKnownHydraAuxiliaryProcesses, showAndFocusMainWindow,
  killTrackedChildren, setShuttingDown, openExternalUrl,
} from './app/state.js';
import { firstLaunchSetup, shouldSyncSchema } from './app/schemaSync.js';
import { createSplashWindow, createMainWindow } from './app/windows.js';
import { registerIpcHandlers } from './app/ipc.js';
import { createTray } from './app/tray.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.setName('Hydra');

// Single-instance lock: second double-click focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ─── 0. Persistent logging ───────────────────────────────────────────────────
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = isDev ? 'debug' : 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
Object.assign(console, log.functions);

// ─── 1. Platform init ────────────────────────────────────────────────────────
if (process.platform === 'darwin' && isDev) {
  app.dock?.setIcon(ICON_PATH);
}

app.commandLine.appendSwitch('disable-features', 'Translate');

// Second-instance handler: surface the existing window.
app.on('second-instance', showAndFocusMainWindow);

// ─── 2. App Lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // Splash IMMEDIATELY so the user sees something while we boot.
    createSplashWindow();

    await killKnownHydraAuxiliaryProcesses('startup sweep');
    await ensurePackagedRuntimeState();

    // Quick sentinel check (just read a file, no heavy work)
    const needsSync = await shouldSyncSchema();

    const server = await import('../server/index.js');
    setGracefulShutdown(server.gracefulShutdown);

    const PORT = isDev ? 3001 : 0;
    const s = await server.bootstrap({ port: PORT, silent: !isDev });
    const expressPort = s.address()?.port ?? PORT;

    const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    const url = isDev ? VITE_DEV_SERVER_URL : `http://localhost:${expressPort}`;
    setWindowURL(url);
    console.log(`[electron] Hydra UI listening at ${url}`);

    registerIpcHandlers();

    const { setupAppMenu } = await import('./menus/appMenu.js');
    setupAppMenu({
      isDev,
      openExternalUrl,
      getServerUrl: () => url,
      showAndFocusMainWindow,
      hideWindow: () => {
        const w = getMainWindow();
        if (w && !w.isDestroyed()) w.hide();
      },
      quitCompletely: () => {
        setForceQuit(true);
        app.quit();
      },
    });

    // Tray icon — keeps Hydra reachable from menu bar.
    createTray();

    const mainWindow = createMainWindow({ show: false });

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      const splash = getSplashWindow();
      if (splash && !splash.isDestroyed()) splash.close();
    });

    const loadTimeout = setTimeout(() => {
      const splash = getSplashWindow();
      if (splash && !splash.isDestroyed()) splash.close();
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    }, 15000);
    try {
      await mainWindow.loadURL(url);
    } finally {
      clearTimeout(loadTimeout);
    }

    // Run firstLaunchSetup in background after UI is live.
    if (needsSync) {
      firstLaunchSetup().catch(e => console.error('[electron] background firstLaunchSetup failed:', e));
    }
  } catch (e) {
    console.error('[electron] Failed to start Hydra:', e);
    const splash = getSplashWindow();
    if (splash && !splash.isDestroyed()) splash.close();
    dialog.showErrorBox('Hydra Startup Error', e.message || String(e));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Closing the UI window hides it so the local proxy can keep serving.
  // Quit explicitly from the menu, dock, or shutdown action to stop the server.
});

app.on('activate', () => {
  const w = getMainWindow();
  if (w && !w.isDestroyed()) {
    showAndFocusMainWindow();
    return;
  }
  const url = getWindowURL();
  if (url) {
    const newWin = createMainWindow({ show: true });
    newWin.loadURL(url).catch(loadErr => console.error('[electron] Activate loadURL failed:', loadErr.message));
  }
});

// ─── 3. Wind-down — kill children, graceful server, force exit ──────────────
async function shutdownEverything(reason) {
  if (getShuttingDown()) return;
  setShuttingDown(true);
  console.log(`[electron] shutdown initiated: ${reason}`);
  killTrackedChildren();
  await killKnownHydraAuxiliaryProcesses(reason);
  try {
    const gs = getGracefulShutdown();
    if (gs) await gs(reason, { exit: false, timeoutMs: 3000 });
  } catch (e) {
    console.error('[electron] gracefulShutdown threw:', e);
  }
}

app.on('before-quit', (event) => {
  if (getShuttingDown()) return;
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
