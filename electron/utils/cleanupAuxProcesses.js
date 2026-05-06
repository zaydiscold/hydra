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
 *
 * Two classes of orphan we sweep:
 *   1. `prisma studio` — local DB inspector, always launched as a child.
 *   2. Playwright Chromium — Hydra's account-generator + dashboard-api
 *      use `chromium.launch()` to drive OpenRouter signup. If Hydra is
 *      force-quit / OOM-killed / kernel-panicked while a task is running,
 *      Chromium is reparented to launchd and lives forever — invisible
 *      (no UI), unkillable by Cmd+Q, and capable of ballooning to many
 *      GB of memory if a page has a runaway loop. We recognize them by
 *      the bundled-Chromium path (build/electron/chromium/...) OR the
 *      Playwright cache path (~/.cache/ms-playwright/...).
 *
 * @param {string} command - the full command string from `ps -axo command=`
 * @returns {boolean}
 */
export function isHydraAuxiliaryProcess(command) {
  // 1. prisma studio
  if (command.includes('prisma studio')) {
    return (
      command.includes(APP_ROOT) ||
      command.includes('/node_modules/.bin/prisma studio') ||
      command.includes('prisma studio --port 5555') ||
      command.includes('prisma studio --browser none')
    );
  }

  // 2. Playwright Chromium orphans
  // The bundled Chromium ships at `Hydra.app/Contents/Resources/app/chromium/...`
  // (see scripts/prepare-electron-resources.mjs). The dev-mode binary lives
  // in `~/.cache/ms-playwright/chromium-XXXX/...`. Match both.
  const isChromiumForTesting = (
    command.includes('Google Chrome for Testing') ||
    command.includes('chrome-mac-arm64/Google Chrome for Testing')
  );
  if (isChromiumForTesting) {
    // Be conservative: only kill Chromiums whose path traces back to Hydra.
    // We don't want to kill the user's actual Chrome browser or another
    // Playwright project's instance.
    return (
      command.includes('/build/electron/chromium/') ||
      command.includes('/Hydra.app/Contents/Resources/app/chromium/') ||
      command.includes('Hydra/chromium/') ||
      // Dev-mode: cmdline includes a `--user-data-dir` under playwright cache
      // AND a node parent that ran from our project — but matching the parent
      // pid via ps is brittle. Conservative: only sweep packaged paths.
      command.includes(APP_ROOT + '/node_modules/playwright')
    );
  }

  return false;
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
