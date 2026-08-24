/**
 * `hydra serve` — run the standalone Express server without opening Electron.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, json } from '../lib/output.js';
import { readRuntimePortStateSync } from '../lib/runtime-port.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const DEFAULT_PORT = Number(process.env.HYDRA_PORT || process.env.PORT || 3001);

function valueAfter(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function parsePort(argv) {
  const raw = valueAfter(argv, '--port') || String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid --port value: ${raw}`);
  }
  return port;
}

function usage() {
  process.stdout.write(`Hydra serve

  hydra serve
  hydra serve --port 3001
  hydra serve --background
  hydra serve --json

Starts server/standalone.js directly, so the /api and /v1 surfaces are available
while the Electron app is closed. This does not open Chrome, Vite, or Electron.
Use --background to detach it and write logs to the active Hydra data directory.
`);
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const port = parsePort(argv);
  const report = {
    action: 'serve',
    port,
    entrypoint: 'server/standalone.js',
    url: `http://127.0.0.1:${port}`,
    proxyUrl: `http://127.0.0.1:${port}/v1`,
    background: hasFlag(argv, '--background'),
  };

  if (!hasFlag(argv, '--json')) {
    process.stdout.write(`${c.bold('Hydra serve')}\n\n`);
    process.stdout.write(`  ${c.dim('Entrypoint:')} ${report.entrypoint}\n`);
    process.stdout.write(`  ${c.dim('API:')}        ${c.cyan(report.url)}\n`);
    process.stdout.write(`  ${c.dim('Proxy:')}      ${c.cyan(report.proxyUrl)}\n\n`);
  } else if (!hasFlag(argv, '--background')) {
    json(report);
  }

  const background = hasFlag(argv, '--background');
  // Match manager commands: when Electron has run, its runtime state points
  // at the real Application Support vault. A closed-window proxy must use the
  // same accounts and encrypted secrets, not a fresh repo-local database.
  const runtime = readRuntimePortStateSync({ root });
  const runtimeDataDir = runtime?.path ? dirname(runtime.path) : null;
  const dataDir = process.env.HYDRA_DATA_DIR || runtimeDataDir || join(root, 'data');
  const databaseUrl = process.env.DATABASE_URL || `file:${resolve(dataDir, 'hydra.db')}`;
  const logPath = join(dataDir, 'hydra-serve.log');
  if (background) mkdirSync(dataDir, { recursive: true });
  const stdio = background
    ? ['ignore', openSync(logPath, 'a'), openSync(logPath, 'a')]
    : (hasFlag(argv, '--json') ? ['inherit', 'pipe', 'inherit'] : 'inherit');
  const child = spawn(process.execPath, ['server/standalone.js'], {
    cwd: root,
    stdio,
    detached: background,
    env: {
      ...process.env,
      PORT: String(port),
      HYDRA_DATA_DIR: dataDir,
      DATABASE_URL: databaseUrl,
    },
  });
  if (background) {
    // A detached child can fail before the parent returns, leaving the user
    // with a convincing PID but no proxy. Hold briefly for bootstrap errors.
    const exitedEarly = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 900);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
      child.once('error', (err) => {
        clearTimeout(timer);
        resolve({ error: err.message });
      });
    });
    if (exitedEarly) {
      throw new Error(`background server exited during startup (${exitedEarly.error || exitedEarly.signal || `code ${exitedEarly.code}`}). Check ${logPath}`);
    }
    child.unref();
    if (hasFlag(argv, '--json')) json({ ...report, pid: child.pid, logPath });
    else process.stdout.write(`${c.ok('✓')} Hydra is routing in the background (pid ${child.pid})\n  Proxy: ${report.proxyUrl}\n  Logs:  ${logPath}\n`);
    return;
  }
  if (hasFlag(argv, '--json') && child.stdout) {
    child.stdout.on('data', (chunk) => process.stderr.write(chunk));
  }

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once('SIGINT', () => forward('SIGINT'));
  process.once('SIGTERM', () => forward('SIGTERM'));

  await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 0;
      resolve();
    });
    child.on('error', (err) => {
      process.stderr.write(`${c.err('✗')} failed to start Hydra server: ${err.message}\n`);
      process.exitCode = 1;
      resolve();
    });
  });
}
