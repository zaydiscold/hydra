/**
 * Hydra Electron — Shutdown
 *
 * Clean shutdown: kill tracked children, sweep auxiliary processes,
 * graceful server shutdown, and force exit.
 */
import { killKnownHydraAuxiliaryProcesses } from '../utils/cleanupAuxProcesses.js';

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
  try {
    if (gracefulShutdown) await gracefulShutdown(reason, { exit: false, timeoutMs: 3000 });
  } catch (e) {
    console.error('[electron] gracefulShutdown threw:', e);
  }
}
