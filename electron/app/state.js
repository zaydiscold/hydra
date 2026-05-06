/**
 * Hydra Electron — Shared Runtime State
 *
 * Mutable singleton shared between main.js and app modules.
 */
import { shell } from 'electron';
import { EXTERNAL_URL_ALLOWLIST } from './env.js';

// ─── Mutable state (getter/setter pattern) ───────────────────────────────────
let _mainWindow = null;
let _splashWindow = null;
let _tray = null;
let _gracefulShutdown = null;
let _windowURL = null;
let _expressPort = null;
let _forceQuit = false;
let _closePromptPending = false;
let _shuttingDown = false;
export const trackedChildren = new Set();

export function getMainWindow()          { return _mainWindow; }
export function getSplashWindow()        { return _splashWindow; }
export function getTray()                { return _tray; }
export function getGracefulShutdown()    { return _gracefulShutdown; }
export function getWindowURL()           { return _windowURL; }
export function getExpressPort()         { return _expressPort; }
export function getForceQuit()           { return _forceQuit; }
export function getClosePromptPending()  { return _closePromptPending; }
export function getShuttingDown()        { return _shuttingDown; }

export function setMainWindow(w)         { _mainWindow = w; }
export function setSplashWindow(w)       { _splashWindow = w; }
export function setTray(t)               { _tray = t; }
export function setGracefulShutdown(fn)  { _gracefulShutdown = fn; }
export function setWindowURL(url)        { _windowURL = url; }
export function setExpressPort(p)        { _expressPort = p; }
export function setForceQuit(v)          { _forceQuit = v; }
export function setClosePromptPending(v) { _closePromptPending = v; }
export function setShuttingDown(v)       { _shuttingDown = v; }

// ─── External URL Helpers ────────────────────────────────────────────────────
function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && EXTERNAL_URL_ALLOWLIST.has(parsed.hostname);
  } catch { return false; }
}

export async function openExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) {
    console.warn(`[electron] blocked external URL: ${rawUrl}`);
    return false;
  }
  await shell.openExternal(rawUrl);
  return true;
}

// ─── Window Helpers ──────────────────────────────────────────────────────────
/**
 * Show + focus the main window. If the window was destroyed (e.g. user picked
 * "Keep Running in Background", which now destroys the renderer to free
 * ~250 MB instead of just hiding it), respawn a fresh window and load the
 * cached URL. Tray clicks and second-instance launches both call this.
 */
export async function showAndFocusMainWindow() {
  const { app } = await import('electron');
  if (process.platform === 'darwin') app.dock?.show();
  const w = getMainWindow();
  if (w && !w.isDestroyed()) {
    if (!w.isVisible()) w.show();
    if (w.isMinimized()) w.restore();
    w.focus();
    return;
  }
  // No live window — spawn a fresh one. Lazy-import windows.js to avoid
  // a circular state ↔ windows dependency at module load time.
  const url = getWindowURL();
  if (!url) {
    console.warn('[electron] tray click: no windowURL cached, cannot respawn');
    return;
  }
  const { createMainWindow } = await import('./windows.js');
  const fresh = createMainWindow({ show: true });
  setMainWindow(fresh);
  fresh.loadURL(url).catch(err => console.error('[electron] respawn loadURL failed:', err.message));
}
