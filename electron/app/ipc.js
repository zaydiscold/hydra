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
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWindowURL, getExpressPort } from './state.js';
import { isPathInAllowlist } from './path-allowlist.js';

function ok(data) { return { ok: true, data }; }
function err(message, code) { return { ok: false, error: message, code }; }

function authTokenPath() {
  return path.join(app.getPath('userData'), 'renderer-auth-token.json');
}

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

  ipcMain.handle('native:auth-token:get', async () => {
    try {
      const raw = await readFile(authTokenPath(), 'utf-8').catch((e) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (!raw) return ok(null);
      const parsed = JSON.parse(raw);
      return ok(typeof parsed?.token === 'string' ? parsed.token : null);
    } catch (e) {
      return err(e.message, 'TOKEN_READ_FAILED');
    }
  });

  ipcMain.handle('native:auth-token:set', async (_event, token) => {
    if (typeof token !== 'string' || !token) return err('token must be a non-empty string', 'BAD_ARG');
    try {
      const file = authTokenPath();
      await writeFile(file, JSON.stringify({ token, updatedAt: new Date().toISOString() }), { mode: 0o600 });
      await chmod(file, 0o600).catch(() => {});
      return ok(true);
    } catch (e) {
      return err(e.message, 'TOKEN_WRITE_FAILED');
    }
  });

  ipcMain.handle('native:auth-token:clear', async () => {
    try {
      await rm(authTokenPath(), { force: true });
      return ok(true);
    } catch (e) {
      return err(e.message, 'TOKEN_CLEAR_FAILED');
    }
  });

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
