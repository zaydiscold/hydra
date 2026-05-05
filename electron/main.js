/**
 * Hydra Electron Main Process
 *
 * Responsibilities:
 *   1. Set platform-native data paths BEFORE any server import
 *   2. Migrate legacy data on first launch
 *   3. Import and bootstrap the Express server
 *   4. Create BrowserWindow with preload script
 *   5. Set up macOS app menu
 *   6. Handle app lifecycle with graceful shutdown
 */
import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// ─── 1. Environment Setup (MUST be before any server import) ───────────────
process.env.HYDRA_DATA_DIR = app.getPath('userData');
process.env.DATABASE_URL = 'file:' + path.join(app.getPath('userData'), 'hydra.db');
process.env.HYDRA_EMBEDDED = '1';

// ─── 2. State ──────────────────────────────────────────────────────────────
let mainWindow = null;
let gracefulShutdown = null;

// ─── 3. First-Launch: Migrate legacy data ──────────────────────────────────
async function firstLaunchSetup() {
  // Migrate legacy data FIRST (so existing hydra.db gets copied before any push)
  try {
    const { migrateIfNeeded } = await import('./utils/migrateLegacyData.js');
    await migrateIfNeeded();
  } catch (err) {
    console.warn('[electron] Legacy data migration skipped:', err.message);
  }

  // Only push schema if NO database exists yet (migration didn't bring one, or fresh install)
  const { existsSync } = await import('node:fs');
  const dbPath = path.join(app.getPath('userData'), 'hydra.db');
  if (!existsSync(dbPath)) {
    const { execSync } = await import('node:child_process');
    try {
      execSync('npx prisma db push --accept-data-loss --skip-generate', {
        cwd: process.cwd(),
        stdio: 'pipe',
        timeout: 15000,
      });
      console.log('[electron] Fresh database created');
    } catch (err) {
      console.warn('[electron] Prisma db push failed:', err.message);
    }
  }
}

// ─── 4. Preload path ────────────────────────────────────────────────────────
const preloadPath = path.join(__dirname, 'preload.js');

// ─── 5. App Lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await firstLaunchSetup();

    // Set up macOS app menu
    const { setupAppMenu } = await import('./menus/appMenu.js');
    setupAppMenu();

    // Import and bootstrap server
    const server = await import('../server/index.js');
    gracefulShutdown = server.gracefulShutdown;

    const port = isDev ? 3001 : await server.bootstrap({ port: 33100, silent: false }).then(s => s.address().port);

    if (isDev) {
      await server.bootstrap({ port, silent: false });
    }

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
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      show: false,
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });

    await mainWindow.loadURL(url);
  } catch (err) {
    console.error('[electron] Failed to start Hydra:', err);
    dialog.showErrorBox('Hydra Startup Error', err.message || String(err));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = new BrowserWindow({
      width: 1440, height: 900,
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.loadURL('http://localhost:3001');
  }
});

// ─── 6. Before-Quit: graceful shutdown then force exit ────────────────────
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
