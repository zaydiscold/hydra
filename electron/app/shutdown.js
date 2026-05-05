/**
 * Hydra Electron — Shutdown
 *
 * Clean shutdown: kill tracked children, sweep auxiliary processes,
 * graceful server shutdown, and force exit.
 */
import { killKnownHydraAuxiliaryProcesses } from '../utils/cleanupAuxProcesses.js';
import { getTray, setTray } from './state.js';

/**
 * Kill all tracked child processes (e.g. prisma db push spawns).
 * @param {Set<import('child_process').ChildProcess>} trackedChildren
 */
export function killTrackedChildren(trackedChildren) {
  for (const child of trackedChildren) {
    try {
      child.kill('SIGTERM');
    } catch { /* already dead */ }
  }
  trackedChildren.clear();
}

/**
 * Orchestrate a complete shutdown: children → aux processes → server.
 * Safe to call multiple times — second call is a no-op once shuttingDown is set.
 *
 * @param {object} opts
 * @param {string} opts.reason - label for logging
 * @param {Set} opts.trackedChildren - set of tracked child processes
 * @param {Function|null} opts.gracefulShutdown - server's gracefulShutdown function
 * @param {{value: boolean}} opts.shuttingDownRef - mutable flag to prevent double-shutdown
 * @returns {Promise<void>}
 */
export async function shutdownEverything({ reason, trackedChildren, gracefulShutdown, shuttingDownRef }) {
  if (shuttingDownRef.value) return;
  shuttingDownRef.value = true;
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
