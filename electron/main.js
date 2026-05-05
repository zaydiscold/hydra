/**
 * Hydra Electron Main Process — Orchestrator
 *
 * Delegates to split modules under app/ and utils/.
 * All shared runtime state lives in app/state.js.
 */
import { app, dialog, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Modules ─────────────────────────────────────────────────────────────────
import {
  isDev, setupLogging, setupPlatform, setupEnvironment,
  ensurePackagedRuntimeState, ICON_PATH,
} from './app/env.js';
import {
  getMainWindow, getSplashWindow, getWindowURL, getForceQuit, getShuttingDown, getGracefulShutdown, getTray,
  setMainWindow, setSplashWindow, setWindowURL, setExpressPort, setForceQuit, setGracefulShutdown, setShuttingDown, setTray,
  openExternalUrl, showAndFocusMainWindow, trackedChildren,
} from './app/state.js';
import { createSplashWindow, createMainWindow } from './app/windows.js';
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

setupEnvironment(app);

// ─── Tray ───────────────────────────────────────────────────────────────────
function createTray() {
  const t = getTray();
  if (t && !t.isDestroyed()) return t;
  let img = nativeImage.createFromPath(ICON_PATH);
  if (img.isEmpty()) {
    // ── Programmatic fallback: 16×16 "H" icon so tray is never invisible ──
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        // Simple "H" glyph
        const hBar = (x === 2 || x === size - 3) && y >= 3 && y <= size - 4;
        const hMid = y >= 7 && y <= 9 && x >= 3 && x <= size - 4;
        if (hBar || hMid) {
          canvas[i] = 255;     // R
          canvas[i + 1] = 0;   // G
          canvas[i + 2] = 255; // B
          canvas[i + 3] = 255; // A
        } else {
          canvas[i + 3] = 0;   // transparent
        }
      }
    }
    img = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }
  img = img.resize({ width: 18, height: 18 });
  const tray = new Tray(img);
  tray.setToolTip('Hydra — local OpenRouter proxy');
  const rebuildMenu = () => {
    const url = getWindowURL();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Hydra', click: showAndFocusMainWindow },
      { type: 'separator' },
      { label: `Status: ${url ? 'proxy running' : 'starting'}`, enabled: false },
      { label: url ? `Proxy URL: ${url}/v1` : 'Proxy URL: starting', enabled: false },
      { type: 'separator' },
      { label: 'Open Logs Folder', click: () => { const { shell } = require('electron'); shell.openPath(app.getPath('logs')); } },
      { label: 'Open Data Folder', click: () => { const { shell } = require('electron'); shell.openPath(app.getPath('userData')); } },
      { type: 'separator' },
      { label: 'Hide Window', click: () => { const w = getMainWindow(); if (w && !w.isDestroyed()) w.hide(); } },
      { label: 'Quit Hydra Completely', click: () => { setForceQuit(true); app.quit(); } },
    ]));
  };
  rebuildMenu();
  // Expose rebuild so the tray can be updated when proxy status changes
  tray._hydraRebuildMenu = rebuildMenu;
  tray.on('click', showAndFocusMainWindow);
  setTray(tray);
  return tray;
}

app.on('second-instance', showAndFocusMainWindow);

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    const splash = createSplashWindow();
    setSplashWindow(splash);

    await killKnownHydraAuxiliaryProcesses('startup sweep');
    await ensurePackagedRuntimeState();

    const needsSync = await shouldSyncSchema();

    const server = await import('../server/index.js');
    setGracefulShutdown(server.gracefulShutdown);

    // Item #76: in dev we prefer port 3001 for stable URLs (Vite proxy targets,
    // bookmarks, terminal hot-pasted curl commands), but a stale Vite/Hydra
    // or any other process holding 3001 used to crash the entire app with
    // EADDRINUSE.  Fall back to an OS-assigned random port instead, log
    // clearly which port was actually selected, and surface it via state so
    // the IPC status helper can report the real listen port to renderers.
    const PREFERRED_DEV_PORT = 3001;
    const PORT = isDev ? PREFERRED_DEV_PORT : 0;
    let s;
    try {
      s = await server.bootstrap({ port: PORT, silent: !isDev });
    } catch (bootErr) {
      if (isDev && bootErr?.code === 'EADDRINUSE') {
        console.warn(`[electron] Port ${PREFERRED_DEV_PORT} already in use — falling back to random port. ` +
          'Hint: a stale Vite or Hydra dev server may still be bound. Run `lsof -i :3001` to investigate.');
        s = await server.bootstrap({ port: 0, silent: !isDev });
      } else {
        throw bootErr;
      }
    }
    const expressPort = s.address()?.port ?? PORT;
    setExpressPort(expressPort);
    if (isDev && expressPort !== PREFERRED_DEV_PORT) {
      console.log(`[electron] Hydra dev server bound to port ${expressPort} (preferred ${PREFERRED_DEV_PORT} was busy).`);
    } else {
      console.log(`[electron] Hydra dev server bound to port ${expressPort}.`);
    }

    const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    const url = isDev ? VITE_DEV_SERVER_URL : `http://localhost:${expressPort}`;
    setWindowURL(url);
    console.log(`[electron] Hydra UI listening at ${url}`);

    registerIpcHandlers();

    const { setupAppMenu } = await import('./menus/appMenu.js');
    setupAppMenu({
      isDev,
      openExternalUrl,
      getServerUrl: () => getWindowURL(),
      showAndFocusMainWindow,
      hideWindow: () => { const w = getMainWindow(); if (w && !w.isDestroyed()) w.hide(); },
      quitCompletely: () => { setForceQuit(true); app.quit(); },
      navigateToSettings: () => {
        showAndFocusMainWindow();
        const mw = getMainWindow();
        if (mw && !mw.isDestroyed()) mw.webContents.send('navigate', '/settings');
      },
    });

    createTray();

    const mainWindow = createMainWindow({ show: false, preloadPath: PRELOAD_PATH });
    setMainWindow(mainWindow);

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      const sp = getSplashWindow();
      if (sp && !sp.isDestroyed()) sp.close();
    });

    const loadTimeout = setTimeout(() => {
      const sp = getSplashWindow();
      if (sp && !sp.isDestroyed()) sp.close();
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    }, 15000);
    try { await mainWindow.loadURL(url); } finally { clearTimeout(loadTimeout); }

    if (needsSync) {
      firstLaunchSetup(trackedChildren).catch(e => {
        console.error('[electron] background firstLaunchSetup failed:', e);
        const w = getMainWindow();
        if (w && !w.isDestroyed()) {
          dialog.showErrorBox('Database Setup Error',
            'Hydra was unable to sync the database schema.\n\n' +
            'This may mean the app needs to be restarted. If the problem persists, your database may be corrupt.\n\n' +
            'Error: ' + (e.message || String(e)));
        }
      });
    }
  } catch (e) {
    console.error('[electron] Failed to start Hydra:', e);
    const sp = getSplashWindow();
    if (sp && !sp.isDestroyed()) sp.close();
    dialog.showErrorBox('Hydra Startup Error', e.message || String(e));
    app.quit();
  }
});

app.on('window-all-closed', () => {});

app.on('activate', () => {
  const w = getMainWindow();
  if (w && !w.isDestroyed()) { showAndFocusMainWindow(); return; }
  const url = getWindowURL();
  if (url) {
    const newWin = createMainWindow({ show: true, preloadPath: PRELOAD_PATH });
    setMainWindow(newWin);
    newWin.loadURL(url).catch(loadErr => {
      console.error('[electron] Activate loadURL failed:', loadErr.message);
      const mw = getMainWindow();
      if (mw && !mw.isDestroyed()) {
        dialog.showErrorBox('Hydra Window Error', `Failed to load the Hydra interface.\n\n${loadErr.message}\n\nPlease restart Hydra.`);
      }
    });
  }
});

// ─── Shutdown ──────────────────────────────────────────────────────────────
app.on('before-quit', (event) => {
  event.preventDefault();
  if (getShuttingDown()) return;
  setShuttingDown(true);
  shutdownEverything({
    reason: 'before-quit',
    trackedChildren,
    gracefulShutdown: getGracefulShutdown(),
  }).finally(() => app.exit(0));
});

process.on('uncaughtException', async (err) => {
  console.error('[electron] uncaughtException:', err);
  setShuttingDown(true);
  await shutdownEverything({
    reason: 'uncaughtException',
    trackedChildren,
    gracefulShutdown: getGracefulShutdown(),
  });
  app.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('[electron] unhandledRejection:', reason);
});
