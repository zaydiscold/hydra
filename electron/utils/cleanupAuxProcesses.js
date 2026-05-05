/**
 * Hydra Electron — Auxiliary Process Cleanup
 *
 * Uses `ps` to find and terminate leftover Hydra auxiliary processes
 * (e.g., prisma studio) that may be lingering from a previous run.
 */
import { execFile } from 'node:child_process';
import { APP_ROOT } from '../app/env.js';

/**
 * Check if a process command line matches a known Hydra auxiliary process.
 * @param {string} command - the full command string from `ps -axo command=`
 * @returns {boolean}
 */
export function isHydraAuxiliaryProcess(command) {
  if (!command.includes('prisma studio')) return false;
  return (
    command.includes(APP_ROOT) ||
    command.includes('/node_modules/.bin/prisma studio') ||
    command.includes('prisma studio --port 5555') ||
    command.includes('prisma studio --browser none')
  );
}

/**
 * Kill any lingering Hydra auxiliary processes (e.g. prisma studio).
 * Skips the current process (ownPid). Windows is a no-op.
 *
 * @param {string} reason - label for logging (e.g. 'startup sweep', 'shutdown')
 * @returns {Promise<void>}
 */
export async function killKnownHydraAuxiliaryProcesses(reason) {
  if (process.platform === 'win32') return;
  try {
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
