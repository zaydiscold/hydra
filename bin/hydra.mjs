#!/usr/bin/env node
/**
 * Hydra CLI — global `hydra` after `npm link` in this repo.
 *   hydra              → show help + usage
 *   hydra start        → production-style launch (launch.js)
 *   hydra dev          → Vite + Express (npm run dev)
 *   hydra doctor       → print system info
 *   hydra logs         → print last 50 lines of log file
 *   hydra data-dir     → print resolved data directory path
 *   hydra version      → print version from package.json
 *   hydra help         → usage
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, platform, arch, hostname, totalmem, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const [, , sub] = process.argv;
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function runNodeLaunch() {
  const child = spawn(process.execPath, ['launch.js'], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function runNpmDev() {
  const child = spawn(npmCmd, ['run', 'dev'], {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function getDataDir() {
  if (process.env.HYDRA_DATA_DIR) return resolve(process.env.HYDRA_DATA_DIR);
  const p = platform();
  if (p === 'darwin') return resolve(homedir(), 'Library', 'Application Support', 'Hydra');
  if (p === 'win32') return resolve(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Hydra');
  return resolve(homedir(), '.config', 'hydra');
}

function getLogPath() {
  if (process.env.HYDRA_DATA_DIR) {
    return join(resolve(process.env.HYDRA_DATA_DIR), 'hydra.log');
  }
  return join(getDataDir(), 'hydra.log');
}

/**
 * Recursively compute the total size of a directory (in bytes).
 * Uses iterative DFS to avoid stack overflow on deep trees.
 */
function dirSizeSync(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      continue; // skip inaccessible directories
    }
    for (const name of entries) {
      const full = join(current, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) {
          stack.push(full);
        } else {
          total += st.size;
        }
      } catch {
        // skip inaccessible files
      }
    }
  }
  return total;
}

function getPkgVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  return pkg.version || 'unknown';
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

if (sub === 'help' || sub === '-h' || sub === '--help') {
  console.log(`Hydra CLI

  Manager
    hydra status              Fleet overview: account count, healthy, balance
    hydra accounts            List every account with health, balance, age
    hydra balance [id]        Total live balance, or balance for one account

  Process
    hydra start               Start production-style server (launch.js)
    hydra dev                 Start Vite + Express for development
    hydra logs                Print last 50 lines of the log file

  System
    hydra doctor              Print system info
    hydra data-dir            Print the resolved data directory path
    hydra version             Print version from package.json
    hydra help                Show this help

  Flags (most manager commands)
    --json                    Machine-readable JSON output

Install once from the repo root:
  npm link       (or: npm run link)

This links \`hydra\` globally to this clone so it works from any directory.
Run it again to update if you switch branches or pull updates.`);
  process.exit(0);
}

// ─── Manager subcommands (lazy-loaded — only pay the import cost when used) ──
const managerCommands = new Set(['status', 'accounts', 'balance']);
if (managerCommands.has(sub)) {
  const mod = await import(`./commands/${sub}.js`);
  const argv = process.argv.slice(3);
  try {
    await mod.run(argv);
    process.exit(process.exitCode ?? 0);
  } catch (err) {
    if (err.code === 'NO_USER') {
      console.error(`✗ ${err.message}`);
      process.exit(2);
    }
    console.error(`✗ ${sub}: ${err.message}`);
    if (process.env.HYDRA_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

if (sub === 'start') {
  runNodeLaunch();
} else if (sub === 'dev') {
  runNpmDev();
} else if (sub === 'doctor') {
  const dataDir = getDataDir();
  let dataDirSize = 'N/A';
  let diskFree = 'N/A';
  try {
    if (existsSync(dataDir)) {
      const sizeBytes = dirSizeSync(dataDir);
      dataDirSize = `${(sizeBytes / 1024 / 1024).toFixed(2)} MB (recursive content size)`;
    } else {
      dataDirSize = 'data dir does not exist yet';
    }
  } catch (e) {
    dataDirSize = `error: ${e.message}`;
  }

  // Get free disk space on the volume containing dataDir.
  try {
    const { execSync } = await import('node:child_process');
    if (process.platform === 'win32') {
      // Windows: use wmic to get free space
      const drive = dataDir.charAt(0).toUpperCase() + ':';
      const out = execSync(`wmic LogicalDisk where "DeviceID='${drive}'" get FreeSpace /value`, {
        timeout: 5000,
        encoding: 'utf-8',
        windowsHide: true,
      });
      const match = out.match(/FreeSpace=(\d+)/);
      if (match) {
        diskFree = `${(Number(match[1]) / 1024 / 1024 / 1024).toFixed(2)} GB free`;
      }
    } else {
      // macOS/Linux: use df
      const out = execSync(`df -k "${dataDir}"`, { timeout: 5000, encoding: 'utf-8' });
      const lines = out.trim().split('\n');
      if (lines.length >= 2) {
        const cols = lines[1].split(/\s+/);
        // df -k output: Filesystem 1K-blocks Used Available Use% Mounted on
        if (cols.length >= 4) {
          const availKb = Number(cols[3]);
          if (!isNaN(availKb)) {
            diskFree = `${(availKb / 1024 / 1024).toFixed(2)} GB free`;
          }
        }
      }
    }
  } catch {
    diskFree = 'unavailable (permissions or platform limitation)';
  }

  console.log(`Hydra System Info
─────────────────
Node.js:        ${process.version}
OS:             ${platform()} ${arch()}
Hostname:       ${hostname()}
CPUs:           ${cpus().length} cores
Total Memory:   ${(totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB
Data Directory: ${dataDir}
Data Dir Size:  ${dataDirSize}
Disk Free:      ${diskFree}
Root:           ${root}`);
  process.exit(0);
} else if (sub === 'logs') {
  if (!process.env.HYDRA_DATA_DIR) {
    console.warn('HYDRA_DATA_DIR is not set; using default data directory');
  }
  const logPath = getLogPath();
  if (!existsSync(logPath)) {
    console.log(`Log file not found at: ${logPath}`);
    process.exit(0);
  }
  const content = readFileSync(logPath, 'utf-8');
  const lines = content.split('\n');
  const last50 = lines.slice(Math.max(0, lines.length - 50));
  console.log(`Last ${last50.length} lines of ${logPath}:`);
  console.log(last50.join('\n'));
  process.exit(0);
} else if (sub === 'data-dir') {
  console.log(getDataDir());
  process.exit(0);
} else if (sub === 'version') {
  console.log(getPkgVersion());
  process.exit(0);
} else if (sub) {
  console.error(`Unknown command: ${sub}\nRun hydra help for usage.`);
  process.exit(1);
} else {
  // Default: show help (use `hydra start` for production server)
  console.log(`Hydra CLI\n\n  Usage: hydra <command>\n\n  Run 'hydra help' for full usage, or 'hydra start' to launch the server.`);
  process.exit(0);
}
