/**
 * Hydra Electron — Runtime State Singleton
 *
 * Shared mutable state across all Electron modules.
 * Uses getter/setter pattern so imports always get current values.
 */
import { app, shell } from 'electron';
import { EXTERNAL_URL_ALLOWLIST } from './env.js';

// ─── Mutable References ──────────────────────────────────────────────────────
let _mainWindow = null;
let _splashWindow = null;
let _tray = null;
let _gracefulShutdown = null;
let _windowURL = null;
let _shuttingDown = false;
let _forceQuit = false;
let _closePromptPending = false;
export const trackedChildren = new Set();

// ─── Getters / Setters ───────────────────────────────────────────────────────
export function getMainWindow()             { return _mainWindow; }
export function getSplashWindow()           { return _splashWindow; }
export function getTray()                   { return _tray; }
export function getGracefulShutdown()       { return _gracefulShutdown; }
export function getWindowURL()              { return _windowURL; }
export function getShuttingDown()           { return _shuttingDown; }
export function getForceQuit()              { return _forceQuit; }
export function getClosePromptPending()     { return _closePromptPending; }

export function setMainWindow(w)           { _mainWindow = w; }
export function setSplashWindow(w)         { _splashWindow = w; }
export function setTray(t)                 { _tray = t; }
export function setGracefulShutdown(fn)    { _gracefulShutdown = fn; }
export function setWindowURL(url)          { _windowURL = url; }
export function setShuttingDown(v)         { _shuttingDown = v; }
export function setForceQuit(v)            { _forceQuit = v; }
export function setClosePromptPending(v)   { _closePromptPending = v; }

// ─── URL / Navigation Helpers ────────────────────────────────────────────────

/** Check if a URL is in the external allowlist (https + known hosts). */
export function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && EXTERNAL_URL_ALLOWLIST.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Safely open an external URL through the OS — blocked if not allowlisted. */
export async function openExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) {
    console.warn(`[electron] blocked external URL: ${rawUrl}`);
    return false;
  }
  await shell.openExternal(rawUrl);
  return true;
}

// ─── Process Management ──────────────────────────────────────────────────────

/** Narrow check — only matches Prisma Studio processes from this project. */
export function isHydraAuxiliaryProcess(command) {
  if (!command.includes('prisma studio')) return false;
  const dataDir = process.env.HYDRA_DATA_DIR;
  return (
    (dataDir ? command.includes(dataDir) : false) ||
    command.includes('/node_modules/.bin/prisma studio') ||
    command.includes('prisma studio --port 5555') ||
    command.includes('prisma studio --browser none')
  );
}

/** Sweep known Hydra child processes (Prisma Studio etc.) on startup / shutdown. */
export async function killKnownHydraAuxiliaryProcesses(reason) {
  if (process.platform === 'win32') return;
  try {
    const { execFile } = await import('node:child_process');
    const output = await new Promise((resolve) => {
      execFile('ps', ['-axo', 'pid=,command='], { timeout: 3000 }, (_err, stdout) => resolve(stdout || ''));
    });
    const ownPid = process.pid;
    for (const line of output.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const command = match[2];
      if (!pid || pid === ownPid || !isHydraAuxiliaryProcess(command)) continue;
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`[electron] stopped auxiliary process ${pid} (${reason}): ${command}`);
      } catch (e) {
        console.warn(`[electron] failed to stop auxiliary process ${pid}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn('[electron] auxiliary process sweep failed:', e.message);
  }
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

/** Show + focus the main window, restoring the dock if it was hidden. */
export function showAndFocusMainWindow() {
  if (process.platform === 'darwin') app.dock?.show();
  const w = getMainWindow();
  if (w && !w.isDestroyed()) {
    if (!w.isVisible()) w.show();
    if (w.isMinimized()) w.restore();
    w.focus();
  }
}

/** Kill all tracked child processes that Electron spawned. */
export function killTrackedChildren() {
  for (const child of trackedChildren) {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }
  trackedChildren.clear();
}
