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
import path from 'node:path';
import fs from 'node:fs';

function ok(data) { return { ok: true, data }; }
function err(message, code) { return { ok: false, error: message, code }; }

function isPathAllowed(target) {
  if (typeof target !== 'string' || target.length === 0) return false;
  // #5: Use realpathSync to resolve symlinks. path.resolve() alone does not
  // follow symlinks, so a symlink in Downloads pointing to /etc could bypass
  // the allowlist check.
  let normalized;
  try {
    normalized = fs.realpathSync(target);
  } catch {
    // realpathSync throws if the path doesn't exist — reject.
    return false;
  }
  const allowed = [
    app.getPath('userData'),
    app.getPath('logs'),
    app.getPath('downloads'),
    app.getPath('documents'),
  ].map(root => {
    try { return fs.realpathSync(root); } catch { return root; }
  });
  return allowed.some(root => normalized === root || normalized.startsWith(root + path.sep));
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
        home: app.getPath('home'),
        logs: app.getPath('logs'),
        downloads: app.getPath('downloads'),
        documents: app.getPath('documents'),
        serverUrl: windowURL,
      });
    } catch (e) { return err(e.message); }
  });

  ipcMain.handle('native:get-status', async () => {
    try { return ok({
      serverUrl: windowURL,
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
