/**
 * Hydra Electron — Auxiliary Process Cleanup
 *
 * Finds and terminates leftover Hydra auxiliary processes (e.g. prisma studio
 * and bundled Playwright Chromium) that may be lingering from a previous run.
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
 *      the bundled/extracted Chromium path (build/electron/chromium/... in
 *      dev packaging work, userData/Hydra/chromium/... in packaged runtime)
 *      OR the Playwright cache path (~/.cache/ms-playwright/...).
 *
 * @param {string} command - the full command string from `ps -axo command=`
 * @returns {boolean}
 */
export function isHydraAuxiliaryProcess(command) {
  if (!command) return false;

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
  // The packaged Chromium ships as chromium.zip and extracts to the Hydra
  // userData dir on first use. The build-time/dev binary may also live under
  // build/electron/chromium while preparing packages. Match both.
  const isChromiumForTesting = (
    command.includes('Google Chrome for Testing') ||
    command.includes('chrome-mac-arm64/Google Chrome for Testing') ||
    command.includes('chrome-mac-x64/Google Chrome for Testing')
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

function execFileText(command, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true }, (_err, stdout) => resolve(stdout || ''));
  });
}

async function listProcesses() {
  if (process.platform === 'win32') {
    const script = [
      'Get-CimInstance Win32_Process',
      '| Select-Object ProcessId,CommandLine',
      '| ConvertTo-Json -Compress',
    ].join(' ');
    const output = await execFileText('powershell.exe', ['-NoProfile', '-Command', script], 5000);
    if (!output.trim()) return [];
    try {
      const parsed = JSON.parse(output);
      return (Array.isArray(parsed) ? parsed : [parsed])
        .map((row) => ({
          pid: Number(row.ProcessId),
          command: String(row.CommandLine || ''),
        }))
        .filter((row) => Number.isFinite(row.pid) && row.command);
    } catch (e) {
      console.warn('[electron] Windows process list parse failed:', e.message);
      return [];
    }
  }

  const output = await execFileText('ps', ['-axo', 'pid=,command='], 3000);
  return output
    .split('\n')
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter(Boolean);
}

async function terminateProcess(pid) {
  if (process.platform === 'win32') {
    await execFileText('taskkill.exe', ['/PID', String(pid), '/T', '/F'], 5000);
    return;
  }
  process.kill(pid, 'SIGTERM');
}

/**
 * Kill any lingering Hydra auxiliary processes (e.g. prisma studio).
 * Skips the current process (ownPid).
 *
 * @param {string} reason - label for logging (e.g. 'startup sweep', 'shutdown')
 * @returns {Promise<void>}
 */
export async function killKnownHydraAuxiliaryProcesses(reason) {
  try {
    const ownPid = process.pid;
    for (const { pid, command } of await listProcesses()) {
      if (!pid || pid === ownPid || !isHydraAuxiliaryProcess(command)) continue;
      try {
        await terminateProcess(pid);
        console.log(`[electron] stopped auxiliary process ${pid} (${reason}): ${command}`);
      } catch (e) {
        console.warn(`[electron] failed to stop auxiliary process ${pid}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn('[electron] auxiliary process sweep failed:', e.message);
  }
}
