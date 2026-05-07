/**
 * Hydra Electron — Shutdown
 *
 * Clean shutdown: kill tracked children, sweep auxiliary processes,
 * graceful server shutdown, and force exit.
 */
import { killKnownHydraAuxiliaryProcesses } from '../utils/cleanupAuxProcesses.js';
import { getTray, setTray, getShuttingDown, setShuttingDown } from './state.js';
// IMPORTANT: server/lib/playwright-browser.js statically imports
// `server/config.js`, which Zod-validates `process.env.DATABASE_URL` at
// module-evaluation time. If we static-imported it here, the chain
//   main.js → shutdown.js → playwright-browser.js → server/config.js
// would evaluate Zod BEFORE `setupEnvironment(app)` ran in main.js,
// crashing the packaged app on launch with "DATABASE_URL undefined".
// We DYNAMICALLY import inside the function instead — by the time
// shutdownEverything actually fires, setupEnvironment has long since set
// every env var the server config schema needs.

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
  // Pair the orphan-process sweep with an orphan-profile-dir sweep. After
  // SIGTERM goes out above, the Chromium children get ~50ms to flush their
  // sqlite + pref files, then their userDataDir is fair game for cleanup.
  // Best-effort — failures are logged + tolerated.
  // Lazy-imported (see top-of-file comment) so the static import chain
  // doesn't pull server/config.js before env vars are set.
  try {
    const { sweepStaleEphemeralProfiles } = await import('../../server/lib/playwright-browser.js');
    sweepStaleEphemeralProfiles();
  } catch (e) {
    console.warn('[electron] profile-dir sweep failed:', e.message);
  }

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
