/**
 * Hydra Electron — IPC Handlers
 *
 * Registers all main-process IPC handlers with Result-type responses.
 * { ok: true, data } on success / { ok: false, error, code } on failure.
 *
 * Window/quit operations read directly from `app/state.js` rather than
 * accepting callbacks from `main.js`. Earlier the API took
 * `{ onHideWindow, onQuitApp }` callbacks but `main.js` called
 * `registerIpcHandlers()` with no arguments — so every `hide-window`
 * and `quit-app` IPC silently returned a `NO_HANDLER` error, breaking
 * the renderer's hide-to-background and quit flows. Reading from state
 * makes the wiring explicit and impossible to forget.
 */
import { app, ipcMain, shell } from 'electron';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWindowURL, getExpressPort, getMainWindow, setForceQuit } from './state.js';
import { isPathInAllowlist } from './path-allowlist.js';
import { canPromptBiometric, describeBiometricSupport, promptBiometric } from './biometric.js';
import { getAllPrefs, getPref, setPref } from './userPrefs.js';
import { setTelemetryEnabled } from './telemetry.js';

function ok(data) { return { ok: true, data }; }
function err(message, code) { return { ok: false, error: message, code }; }

const AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function authTokenPath() {
  return path.join(app.getPath('userData'), 'renderer-auth-token.json');
}

function authTokenExpiryFromRecord(record) {
  if (!record || typeof record !== 'object') return 0;
  if (typeof record.expiresAt === 'string') {
    const expiresAt = Date.parse(record.expiresAt);
    if (Number.isFinite(expiresAt)) return expiresAt;
  }
  if (typeof record.updatedAt === 'string') {
    const updatedAt = Date.parse(record.updatedAt);
    if (Number.isFinite(updatedAt)) return updatedAt + AUTH_TOKEN_TTL_MS;
  }
  return 0;
}

async function readAuthTokenRecord() {
  const raw = await readFile(authTokenPath(), 'utf-8').catch((e) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (!raw) return null;
  return JSON.parse(raw);
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
 * Register all IPC handlers. No arguments — handlers source their state
 * from `app/state.js` so the wiring is uniform across call sites.
 */
export function registerIpcHandlers() {
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
      serverUrl: getWindowURL() ?? null,
      // Item #76: surface the actual chosen Express port (may differ from
      // the dev preferred 3001 if EADDRINUSE forced a random-port fallback).
      expressPort: getExpressPort(),
      embedded: process.env.HYDRA_EMBEDDED === '1',
      packaged: app.isPackaged,
    }); } catch (e) { return err(e.message); }
  });

  ipcMain.handle('native:open-path', async (_event, targetPath) => {
    if (typeof targetPath !== 'string') return err('targetPath must be a string', 'BAD_ARG');
    // Reject empty/whitespace-only paths explicitly. shell.openPath('') on
    // macOS opens `cwd` (typically the user's home dir) — silently exposing
    // browse access the allowlist was supposed to gate. The allowlist's
    // realpathSync would throw on '' but only AFTER an attacker-controlled
    // log line, so reject up front for defense in depth.
    if (targetPath.trim() === '') return err('targetPath cannot be empty', 'BAD_ARG');
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
      // #11 — biometric gate: if the user enabled biometric unlock, the
      // auth-token-on-disk only releases AFTER a successful Touch ID prompt.
      // On denial or cancel we return null so the renderer falls back to
      // the password screen (no error toast — denial is a normal flow).
      const biometricOn = await getPref('biometricEnabled');
      if (biometricOn && canPromptBiometric()) {
        try {
          await promptBiometric('Unlock Hydra');
        } catch {
          return ok(null); // user cancelled / failed — fall back to password
        }
      }
      const parsed = await readAuthTokenRecord();
      if (!parsed) return ok(null);
      const token = typeof parsed?.token === 'string' ? parsed.token : null;
      if (!token) return ok(null);
      const expiresAt = authTokenExpiryFromRecord(parsed);
      if (!expiresAt || expiresAt <= Date.now()) {
        await rm(authTokenPath(), { force: true });
        return ok(null);
      }
      return ok(token);
    } catch (e) {
      return err(e.message, 'TOKEN_READ_FAILED');
    }
  });

  ipcMain.handle('native:auth-token:status', async () => {
    try {
      const parsed = await readAuthTokenRecord();
      const tokenPresent = typeof parsed?.token === 'string' && parsed.token.length > 0;
      const expiresAtMs = tokenPresent ? authTokenExpiryFromRecord(parsed) : 0;
      const expiresAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
      const now = Date.now();
      const expired = tokenPresent && (!expiresAtMs || expiresAtMs <= now);
      return ok({
        present: tokenPresent && !expired,
        expired,
        expiresAt,
        ttlSeconds: tokenPresent && expiresAtMs ? Math.max(0, Math.floor((expiresAtMs - now) / 1000)) : 0,
        path: authTokenPath(),
        biometricGate: Boolean(await getPref('biometricEnabled')),
      });
    } catch (e) {
      return err(e.message, 'TOKEN_STATUS_FAILED');
    }
  });

  ipcMain.handle('native:auth-token:set', async (_event, token) => {
    if (typeof token !== 'string' || !token) return err('token must be a non-empty string', 'BAD_ARG');
    try {
      const file = authTokenPath();
      const now = Date.now();
      await writeFile(file, JSON.stringify({
        token,
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + AUTH_TOKEN_TTL_MS).toISOString(),
        ttlSeconds: AUTH_TOKEN_TTL_MS / 1000,
      }), { mode: 0o600 });
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
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return err('main window not available', 'NO_WINDOW');
    try {
      win.hide();
      // On macOS we also drop the dock icon — matches the user's "keep
      // running in background" expectation. Tray icon stays so the user
      // can re-summon the window. Mirrors the same logic in the close
      // handler in `windows.js` to keep both paths consistent.
      if (process.platform === 'darwin' && app.dock?.hide) app.dock.hide();
      return ok(true);
    } catch (e) {
      return err(e.message, 'HIDE_FAILED');
    }
  });

  ipcMain.handle('native:quit-app', async () => {
    try {
      // Force-quit semantics: bypass the close-handler dialog in
      // windows.js (which would otherwise re-prompt with Keep
      // Running / Quit). The user already opted into Quit by invoking
      // this IPC, so going through the full shutdown chain via
      // app.quit() (which fires before-quit → shutdownEverything) is
      // the correct path.
      setForceQuit(true);
      app.quit();
      return ok(true);
    } catch (e) {
      return err(e.message, 'QUIT_FAILED');
    }
  });

  // ── User preferences (telemetry, biometric, theme, etc.) ──────────────
  ipcMain.handle('native:prefs:get-all', async () => {
    try { return ok(await getAllPrefs()); }
    catch (e) { return err(e.message, 'PREFS_READ_FAILED'); }
  });
  ipcMain.handle('native:prefs:set', async (_event, key, value) => {
    if (typeof key !== 'string') return err('key must be a string', 'BAD_ARG');
    try {
      await setPref(key, value);
      // Telemetry has live-side-effects (Sentry init / disable) so we
      // forward to the dedicated setter when that key changes. Other
      // keys are read on demand and don't need notification.
      if (key === 'telemetryEnabled') await setTelemetryEnabled(value);
      return ok(true);
    } catch (e) {
      return err(e.message, 'PREFS_WRITE_FAILED');
    }
  });

  // ── Biometric (#11) ────────────────────────────────────────────────────
  ipcMain.handle('native:biometric:describe', async () => {
    try { return ok(describeBiometricSupport()); }
    catch (e) { return err(e.message, 'BIOMETRIC_DESCRIBE_FAILED'); }
  });
  ipcMain.handle('native:biometric:prompt', async (_event, reason) => {
    try {
      await promptBiometric(typeof reason === 'string' ? reason : undefined);
      return ok(true);
    } catch (e) {
      return err(e?.message || 'biometric prompt failed', e?.code || 'BIOMETRIC_DENIED');
    }
  });
}
