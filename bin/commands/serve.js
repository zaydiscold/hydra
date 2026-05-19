/**
 * `hydra serve` — run the standalone Express server without opening Electron.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, json } from '../lib/output.js';

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
  hydra serve --json

Starts server/standalone.js directly, so the /api and /v1 surfaces are available
while the Electron app is closed. This does not open Chrome, Vite, or Electron.
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
  };

  if (hasFlag(argv, '--json')) {
    json(report);
  } else {
    process.stdout.write(`${c.bold('Hydra serve')}\n\n`);
    process.stdout.write(`  ${c.dim('Entrypoint:')} ${report.entrypoint}\n`);
    process.stdout.write(`  ${c.dim('API:')}        ${c.cyan(report.url)}\n`);
    process.stdout.write(`  ${c.dim('Proxy:')}      ${c.cyan(report.proxyUrl)}\n\n`);
  }

  const child = spawn(process.execPath, ['server/standalone.js'], {
    cwd: root,
    stdio: hasFlag(argv, '--json') ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
    },
  });
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
