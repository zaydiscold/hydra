#!/usr/bin/env node
/**
 * Hydra CLI — global `hydra` after `npm link` in this repo.
 *   hydra              → show help + usage
 *   hydra serve        → standalone Express server (server/standalone.js)
 *   hydra start        → production-style launch (launch.js)
 *   hydra dev          → Vite + Express (npm run dev)
 *   hydra doctor       → print system info
 *   hydra logs         → print last 50 lines of log file
 *   hydra logs --tail  → follow appended log lines
 *   hydra data-dir     → print resolved data directory path
 *   hydra version      → print version from package.json
 *   hydra help         → usage
 */
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync, readdirSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { platform, arch, hostname, totalmem, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const [, , sub] = process.argv;
const cliArgs = process.argv.slice(3);
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const wantJson = cliArgs.includes('--json');
const quiet = cliArgs.includes('--quiet');

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
  return resolve(root, 'data');
}

function getLogPath() {
  if (process.env.HYDRA_DATA_DIR) {
    return join(resolve(process.env.HYDRA_DATA_DIR), 'hydra.log');
  }
  return join(getDataDir(), 'hydra.log');
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function valueAfter(argv, flag) {
  const i = argv.indexOf(flag);
  if (i >= 0) return argv[i + 1] || null;
  const prefix = `${flag}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function positiveIntFlag(argv, flag, fallback) {
  const raw = valueAfter(argv, flag);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5000) {
    throw new Error(`invalid ${flag} value: ${raw}`);
  }
  return value;
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

/** Read the last N lines without loading a large log file into memory. */
function tailLinesSync(file, lineCount = 50) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const chunkSize = 8192;
    let pos = size;
    let text = '';
    let seen = 0;
    while (pos > 0 && seen <= lineCount) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const buf = Buffer.allocUnsafe(readSize);
      readSync(fd, buf, 0, readSize, pos);
      const part = buf.toString('utf-8');
      text = part + text;
      seen += (part.match(/\n/g) || []).length;
    }
    const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
    return lines.slice(Math.max(0, lines.length - lineCount));
  } finally {
    closeSync(fd);
  }
}

function readFromOffsetSync(file, offset) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return { text: '', offset: size };
    const readSize = size - offset;
    const buf = Buffer.allocUnsafe(readSize);
    readSync(fd, buf, 0, readSize, offset);
    return { text: buf.toString('utf-8'), offset: size };
  } finally {
    closeSync(fd);
  }
}

function followLogFile(file, offset) {
  let currentOffset = offset;
  let exiting = false;
  const flushNewContent = () => {
    if (exiting) return;
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size < currentOffset) currentOffset = 0;
    if (size === currentOffset) return;
    const result = readFromOffsetSync(file, currentOffset);
    currentOffset = result.offset;
    if (result.text) process.stdout.write(result.text);
  };

  return new Promise(() => {
    const interval = setInterval(flushNewContent, 100);
    const watcher = watch(file, { persistent: true }, flushNewContent);
    const cleanup = (code = 0) => {
      exiting = true;
      clearInterval(interval);
      watcher.close();
      process.exit(code);
    };
    process.once('SIGINT', () => cleanup(0));
    process.once('SIGTERM', () => cleanup(143));
  });
}

function pathExists(p) {
  return existsSync(p);
}

function findBundledChromium(rootDir) {
  const candidates = [
    join(rootDir, 'build/electron/chromium.zip'),
    join(rootDir, 'release/mac-arm64/Hydra.app/Contents/Resources/chromium.zip'),
    join(rootDir, 'release/mac/Hydra.app/Contents/Resources/chromium.zip'),
    join(rootDir, 'release/linux-unpacked/resources/chromium.zip'),
    join(rootDir, 'release/win-unpacked/resources/chromium.zip'),
    join(rootDir, 'build/electron/chromium/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(rootDir, 'build/electron/chromium/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(rootDir, 'build/electron/chromium/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(rootDir, 'build/electron/chromium/chrome-linux/chrome'),
    join(rootDir, 'build/electron/chromium/chrome-win/chrome.exe'),
    join(rootDir, 'release/mac-arm64/Hydra.app/Contents/Resources/chromium/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(rootDir, 'release/mac/Hydra.app/Contents/Resources/chromium/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(rootDir, 'release/linux-unpacked/resources/chromium/chrome-linux/chrome'),
    join(rootDir, 'release/win-unpacked/resources/chromium/chrome-win/chrome.exe'),
  ];
  return candidates.find(pathExists) || null;
}

function probePortSync(port) {
  try {
    execFileSync(process.execPath, [
      '-e',
      `const net=require('net');const s=net.createConnection(${Number(port)},'127.0.0.1');let done=false;function end(ok){if(done)return;done=true;s.destroy();process.exit(ok?0:1)}s.setTimeout(250);s.on('connect',()=>end(true));s.on('timeout',()=>end(false));s.on('error',()=>end(false));`,
    ], { timeout: 1000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ─── Subcommands ──────────────────────────────────────────────────────────────

if (sub === 'help' || sub === '-h' || sub === '--help') {
  console.log(`Hydra CLI

  Manager
    hydra status              Fleet overview: account count, healthy, balance
    hydra accounts            List every account with health, balance, age
    hydra account <id>        Show redacted account details
    hydra balance [id]        Total live balance, or balance for one account
    hydra accounts purge      Dry-run or delete inert placeholder accounts
    hydra keys                List stored management keys
    hydra session <id>        Show stored session readiness for one account
    hydra proxy status        Show local proxy URL, gate, and masked keys
    hydra proxy keys new      Rotate local proxy keys with --yes
    hydra scan --quick        Closed-app fleet health scan
    hydra export              Export redacted fleet metadata
    hydra import <file>       Validate a redacted export with --dry-run
    hydra db reset            Move local DB files into a reset backup with --yes
    hydra codes               Preflight and redeem promo codes from the CLI
    hydra unlock              Issue a bearer token from the local password
    hydra ai models           List locally cached OpenRouter models
    hydra openrouter          Direct OpenRouter API probes and chat
    hydra api-map             List Hydra's local API surface from openapi/hydra-api.openapi.json
    hydra audit               Read-only release checklist snapshot

  Process
    hydra serve [--port N]    Start standalone Express server without Electron
    hydra stop [--port N]     Stop running server via authenticated /api/shutdown
    hydra start               Start production-style server (launch.js)
    hydra dev                 Start Vite + Express for development
    hydra logs [--lines N]    Print the last N log lines (default 50)
    hydra logs --tail         Follow appended log lines until interrupted

  System
    hydra doctor              Print system info
    hydra data-dir            Print the resolved data directory path
    hydra version             Print version from package.json
    hydra help                Show this help

  Flags (most manager commands)
    --json                    Machine-readable JSON output
    --tag <name>              Filter api-map by tag

Install once from the repo root:
  npm link       (or: npm run link)

This links \`hydra\` globally to this clone so it works from any directory.
Run it again to update if you switch branches or pull updates.`);
  process.exit(0);
}

// ─── Manager subcommands (lazy-loaded — only pay the import cost when used) ──
const managerCommands = new Set(['status', 'accounts', 'account', 'balance', 'keys', 'session', 'proxy', 'scan', 'export', 'import', 'db', 'codes', 'serve', 'stop', 'unlock', 'ai', 'openrouter', 'audit']);
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

if (sub === 'api-map') {
  const specPath = join(root, 'openapi', 'hydra-api.openapi.json');
  const tagIndex = cliArgs.indexOf('--tag');
  const tagFilter = tagIndex >= 0 ? cliArgs[tagIndex + 1] : null;
  if (!existsSync(specPath)) {
    console.error(`Hydra API map not found at ${specPath}. Run: npm run openapi:hydra`);
    process.exit(1);
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
  const rows = [];
  for (const [apiPath, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods || {})) {
      const tag = operation.tags?.[0] || 'uncategorized';
      if (tagFilter && tag !== tagFilter) continue;
      rows.push({
        method: method.toUpperCase(),
        path: apiPath,
        tag,
        summary: operation.summary || '',
        auth: operation.security?.length === 0 ? 'public' : 'locked',
      });
    }
  }
  rows.sort((a, b) => a.tag.localeCompare(b.tag) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  if (wantJson) {
    printJson({
      source: specPath,
      total: rows.length,
      tags: [...new Set(rows.map((row) => row.tag))],
      routes: rows,
    });
    process.exit(0);
  }

  const tagLine = tagFilter ? ` tag=${tagFilter}` : '';
  console.log(`Hydra API Map${tagLine}`);
  console.log('────────────────');
  if (rows.length === 0) {
    console.log('No routes matched.');
    process.exit(0);
  }
  const width = rows.reduce((max, row) => Math.max(max, `${row.method} ${row.path}`.length), 0);
  let currentTag = null;
  for (const row of rows) {
    if (row.tag !== currentTag) {
      currentTag = row.tag;
      console.log(`\n${currentTag}`);
    }
    const route = `${row.method} ${row.path}`.padEnd(width);
    console.log(`  ${route}  ${row.auth.padEnd(6)}  ${row.summary}`);
  }
  process.exit(0);
}

if (sub === 'start') {
  runNodeLaunch();
} else if (sub === 'dev') {
  runNpmDev();
} else if (sub === 'doctor') {
  const dataDir = getDataDir();
  const dbPath = join(dataDir, 'hydra.db');
  const secretsPath = join(dataDir, 'local-secrets.json');
  const chromiumPath = findBundledChromium(root);
  const port = Number(process.env.HYDRA_PORT || process.env.PORT || 3001);
  const portOpen = probePortSync(port);
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
    if (process.platform === 'win32') {
      // Windows: use wmic to get free space
      const drive = dataDir.charAt(0).toUpperCase() + ':';
      const out = execFileSync('wmic', ['LogicalDisk', 'where', `DeviceID='${drive}'`, 'get', 'FreeSpace', '/value'], {
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
      const out = execFileSync('df', ['-k', dataDir], { timeout: 5000, encoding: 'utf-8' });
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

  const report = {
    version: getPkgVersion(),
    node: process.version,
    os: `${platform()} ${arch()}`,
    hostname: hostname(),
    cpus: cpus().length,
    totalMemoryGb: Number((totalmem() / 1024 / 1024 / 1024).toFixed(1)),
    root,
    dataDir,
    dataDirSize,
    diskFree,
    checks: {
      db: { ok: pathExists(dbPath), path: dbPath },
      secrets: { ok: pathExists(secretsPath), path: secretsPath },
      chromium: { ok: Boolean(chromiumPath), path: chromiumPath },
      port: { ok: portOpen, port, url: portOpen ? `http://127.0.0.1:${port}/v1` : null },
    },
  };

  if (wantJson) {
    printJson(report);
    process.exit(0);
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
Root:           ${root}

Checks
  DB:           ${report.checks.db.ok ? 'ok' : 'missing'} (${dbPath})
  Secrets:      ${report.checks.secrets.ok ? 'ok' : 'missing'} (${secretsPath})
  Chromium:     ${report.checks.chromium.ok ? 'ok' : 'missing'}
  Port ${port}:     ${portOpen ? 'listening' : 'closed'}`);
  process.exit(0);
} else if (sub === 'logs') {
  const wantTail = cliArgs.includes('--tail') || cliArgs.includes('-f');
  let lineCount;
  try {
    lineCount = positiveIntFlag(cliArgs, '--lines', 50);
  } catch (err) {
    console.error(`✗ logs: ${err.message}`);
    process.exit(1);
  }
  if (wantJson && wantTail) {
    console.error('✗ logs: --json cannot be combined with --tail');
    process.exit(1);
  }
  if (!process.env.HYDRA_DATA_DIR && !quiet) {
    console.warn('HYDRA_DATA_DIR is not set; using default data directory');
  }
  const logPath = getLogPath();
  if (!existsSync(logPath)) {
    if (wantJson) printJson({ path: logPath, exists: false, lines: [] });
    else console.log(`Log file not found at: ${logPath}`);
    process.exit(0);
  }
  const lastLines = tailLinesSync(logPath, lineCount);
  if (wantJson) {
    printJson({ path: logPath, exists: true, lines: lastLines });
  } else {
    if (!quiet) console.log(`Last ${lastLines.length} lines of ${logPath}:`);
    console.log(lastLines.join('\n'));
    if (wantTail) {
      if (!quiet) console.log(`Following ${logPath}; press Ctrl+C to stop.`);
      await followLogFile(logPath, statSync(logPath).size);
    }
  }
  process.exit(process.exitCode ?? 0);
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
  console.log(`Hydra CLI\n\n  Usage: hydra <command>\n\n  Run 'hydra help' for full usage, or 'hydra serve' to launch the closed-app server.`);
  process.exit(0);
}
