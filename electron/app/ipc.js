/**
 * Hydra Electron — IPC Handlers
 *
 * Registers all main-process IPC handlers with Result-type responses.
 * { ok: true, data } on success / { ok: false, error, code } on failure.
 *
 * Callers pass callbacks for hide-window and quit-app so the orchestrator
 * (main.js) can manage its own state (mainWindow ref, forceQuit flag).
 */
import { app, ipcMain, shell } from 'electron';

import { getWindowURL, getExpressPort } from './state.js';
import { isPathInAllowlist } from './path-allowlist.js';

function ok(data) { return { ok: true, data }; }
function err(message, code) { return { ok: false, error: message, code }; }

function isPathAllowed(target) {
  return isPathInAllowlist(target, [
    app.getPath('userData'),
    app.getPath('logs'),
    app.getPath('downloads'),
    app.getPath('documents'),
  ]);
}

/**
 * Register all IPC handlers.
 *
 * @param {object} opts
 * @param {string|null} opts.windowURL - the current server URL
 * @param {Function} opts.onHideWindow - () => void (hide the main window)
 * @param {Function} opts.onQuitApp - () => void (quit the app)
 */
export function registerIpcHandlers({ windowURL, onHideWindow, onQuitApp } = {}) {
  ipcMain.handle('native:get-version', async () => {
    try { return ok(app.getVersion()); } catch (e) { return err(e.message); }
  });

  ipcMain.handle('native:get-paths', async () => {
    try {
      return ok({
        userData: app.getPath('userData'),
        logs: app.getPath('logs'),
      });
    } catch (e) { return err(e.message); }
  });

  ipcMain.handle('native:get-status', async () => {
    try { return ok({
      serverUrl: getWindowURL() ?? windowURL ?? null,
      // Item #76: surface the actual chosen Express port (may differ from
      // the dev preferred 3001 if EADDRINUSE forced a random-port fallback).
      expressPort: getExpressPort(),
      embedded: process.env.HYDRA_EMBEDDED === '1',
      packaged: app.isPackaged,
    }); } catch (e) { return err(e.message); }
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
    if (onHideWindow) {
      onHideWindow();
      return ok(true);
    }
    return err('hide-window handler not configured', 'NO_HANDLER');
  });

  ipcMain.handle('native:quit-app', async () => {
    if (onQuitApp) {
      onQuitApp();
      return ok(true);
    }
    return err('quit-app handler not configured', 'NO_HANDLER');
  });
}
