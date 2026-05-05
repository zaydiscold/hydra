/**
 * Hydra Electron Main Process
 *
 * Responsibilities:
 *   1. Set platform-native data paths BEFORE any server import
 *   2. Import and bootstrap the Express server
 *   3. Create BrowserWindow (Vite URL in dev, Express URL in prod)
 *   4. Handle app lifecycle with graceful shutdown
 */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const isDev = !app.isPackaged;

// ─── 1. Environment Setup (MUST be before any server import) ───────────────
process.env.HYDRA_DATA_DIR = app.getPath('userData');
process.env.DATABASE_URL = 'file:' + path.join(app.getPath('userData'), 'hydra.db');

// ─── 2. State ──────────────────────────────────────────────────────────────
let mainWindow = null;
let gracefulShutdown = null;

// ─── 3. App Lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    const server = await import('../server/index.js');
    gracefulShutdown = server.gracefulShutdown;

    const port = isDev ? 3001 : 33100;
    await server.bootstrap({ port, silent: false });

    const url = isDev
      ? 'http://localhost:5173'
      : `http://localhost:${port}`;

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      title: 'Hydra',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
      show: false,
    });

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    await mainWindow.loadURL(url);
  } catch (err) {
    console.error('Failed to start Hydra:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    const port = isDev ? 3001 : 33100;
    const url = isDev
      ? 'http://localhost:5173'
      : `http://localhost:${port}`;

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadURL(url);
  }
});

// ─── 4. Before-Quit: graceful shutdown then force exit ────────────────────
app.on('before-quit', (event) => {
  event.preventDefault();

  (async () => {
    try {
      if (gracefulShutdown) {
        await gracefulShutdown('before-quit', { exit: false });
      }
    } catch (err) {
      console.error('[electron] Graceful shutdown failed:', err);
    }
    app.exit(0);
  })();
});
