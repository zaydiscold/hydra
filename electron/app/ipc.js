/**
 * Hydra Electron — IPC Handlers
 *
 * Registers all native: prefixed IPC handlers with Result-type
 * pattern ({ok, data} / {ok: false, error, code}) and arg validation.
 */
import { ipcMain, app, shell } from 'electron';
import path from 'node:path';
import { getMainWindow, getWindowURL, setForceQuit } from './state.js';

function ok(data) { return { ok: true, data }; }
function err(message, code) { return { ok: false, error: message, code }; }

function isPathAllowed(target) {
  if (typeof target !== 'string' || target.length === 0) return false;
  const normalized = path.resolve(target);
  const allowed = [app.getPath('userData'), app.getPath('logs'), app.getPath('downloads'), app.getPath('documents')];
  return allowed.some(root => normalized === root || normalized.startsWith(root + path.sep));
}

export function registerIpcHandlers() {
  ipcMain.handle('native:get-version', async () => {
    try { return ok(app.getVersion()); } catch (e) { return err(e.message); }
  });

  ipcMain.handle('native:get-paths', async () => {
    try {
      return ok({
        userData: app.getPath('userData'),
        home: app.getPath('home'),
        logs: app.getPath('logs'),
        downloads: app.getPath('downloads'),
        documents: app.getPath('documents'),
        serverUrl: getWindowURL(),
      });
    } catch (e) { return err(e.message); }
  });

  ipcMain.handle('native:get-status', async () => ok({
    serverUrl: getWindowURL(),
    embedded: process.env.HYDRA_EMBEDDED === '1',
    packaged: app.isPackaged,
  }));

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
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      return ok(true);
    }
    return err('main window is not available', 'NO_WINDOW');
  });

  ipcMain.handle('native:quit-app', async () => {
    setForceQuit(true);
    app.quit();
    return ok(true);
  });
}
