/**
 * Hydra Electron — Shutdown
 *
 * Clean shutdown: kill tracked children, sweep auxiliary processes,
 * graceful server shutdown, and force exit.
 */
import { killKnownHydraAuxiliaryProcesses } from '../utils/cleanupAuxProcesses.js';
import { getTray, setTray, getShuttingDown, setShuttingDown } from './state.js';

/**
 * Kill all tracked child processes (e.g. prisma db push spawns).
 * @param {Set<import('child_process').ChildProcess>} trackedChildren
 */
export function killTrackedChildren(trackedChildren) {
  for (const child of trackedChildren) {
    try {
      // #75: Windows has no SIGTERM — child.kill() with no signal name
      // defaults to SIGTERM on POSIX and TerminateProcess on Windows.
      child.kill();
    } catch { /* already dead */ }
  }
  trackedChildren.clear();
}

/**
 * Orchestrate a complete shutdown: children → aux processes → server.
 * Safe to call multiple times — second call is a no-op once shuttingDown is set.
 *
 * Reads/writes the shuttingDown flag through state.js so the caller in
 * main.js doesn't have to construct a `{value}` ref. Earlier shape took a
 * mutable `shuttingDownRef` argument; callers in main.js never passed it,
 * which produced `Cannot read properties of undefined (reading 'value')`
 * on every quit. Now self-sufficient — pass only what changes per call.
 *
 * @param {object} opts
 * @param {string} opts.reason - label for logging
 * @param {Set} opts.trackedChildren - set of tracked child processes
 * @param {Function|null} opts.gracefulShutdown - server's gracefulShutdown function
 * @returns {Promise<void>}
 */
export async function shutdownEverything({ reason, trackedChildren, gracefulShutdown }) {
  if (getShuttingDown()) return;
  setShuttingDown(true);
  console.log(`[electron] shutdown initiated: ${reason}`);
  killTrackedChildren(trackedChildren);
  await killKnownHydraAuxiliaryProcesses(reason);

  // Explicitly destroy the tray so the menu-bar slot releases immediately.
  // Without this, macOS sometimes keeps a "ghost" tray icon for a few seconds
  // after the app exits while Chromium tears down the GPU/helper processes.
  try {
    const tray = getTray();
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
      setTray(null);
    }
  } catch (e) {
    console.warn('[electron] tray destroy failed:', e.message);
  }
  try {
    if (gracefulShutdown) await gracefulShutdown(reason, { exit: false, timeoutMs: 3000 });
  } catch (e) {
    console.error('[electron] gracefulShutdown threw:', e);
  }
}
