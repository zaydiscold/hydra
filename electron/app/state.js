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
let _forceQuit = false;
let _closePromptPending = false;
let _shuttingDown = false;
export const trackedChildren = new Set();

export function getMainWindow()          { return _mainWindow; }
export function getSplashWindow()        { return _splashWindow; }
export function getTray()                { return _tray; }
export function getGracefulShutdown()    { return _gracefulShutdown; }
export function getWindowURL()           { return _windowURL; }
export function getForceQuit()           { return _forceQuit; }
export function getClosePromptPending()  { return _closePromptPending; }
export function getShuttingDown()        { return _shuttingDown; }

export function setMainWindow(w)         { _mainWindow = w; }
export function setSplashWindow(w)       { _splashWindow = w; }
export function setTray(t)               { _tray = t; }
export function setGracefulShutdown(fn)  { _gracefulShutdown = fn; }
export function setWindowURL(url)        { _windowURL = url; }
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
export function showAndFocusMainWindow() {
  const { app } = require('electron');
  if (process.platform === 'darwin') app.dock?.show();
  const w = getMainWindow();
  if (w && !w.isDestroyed()) {
    if (!w.isVisible()) w.show();
    if (w.isMinimized()) w.restore();
    w.focus();
  }
}
