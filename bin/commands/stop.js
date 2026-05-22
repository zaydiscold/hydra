/**
 * `hydra stop` — authenticated shutdown for a running standalone server.
 */
import net from 'node:net';
import { json, status } from '../lib/output.js';

const DEFAULT_PORT = Number(process.env.HYDRA_PORT || process.env.PORT || 3001);
const SHUTDOWN_TIMEOUT_MS = 5000;

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

function probePort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(value);
    };
    sock.setTimeout(250);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

function usage() {
  process.stdout.write(`Hydra stop

  hydra stop
  hydra stop --port 3001
  hydra stop --token <jwt>
  HYDRA_TOKEN=<jwt> hydra stop
  hydra stop --json

Stops a running Hydra server through POST /api/shutdown. The endpoint is locked,
so shutdown requires a bearer token from an unlocked Hydra session.
`);
}

async function shutdownServer(port, token) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: 'SHUTDOWN_HYDRA' }),
      signal: AbortSignal.timeout(SHUTDOWN_TIMEOUT_MS),
    });
    const raw = await res.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (err) {
      body = {
        ok: false,
        error: 'NON_JSON_RESPONSE',
        message: `Shutdown endpoint returned non-JSON response: ${err?.message || err}`,
        raw: raw.slice(0, 500),
      };
    }
    return { ok: res.ok, statusCode: res.status, body };
  } catch (err) {
    return {
      ok: false,
      statusCode: 0,
      body: {
        ok: false,
        error: err?.name === 'TimeoutError' ? 'SHUTDOWN_TIMEOUT' : 'SHUTDOWN_REQUEST_FAILED',
        message: `Shutdown request failed: ${err?.message || err}`,
      },
    };
  }
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  const port = parsePort(argv);
  const token = valueAfter(argv, '--token') || process.env.HYDRA_TOKEN || null;
  const running = await probePort(port);

  if (!running) {
    const report = { running: false, stopped: false, port, error: null };
    if (wantJson) json(report);
    else status('warn', `No Hydra server is listening on 127.0.0.1:${port}.`);
    return;
  }

  if (!token) {
    const report = {
      running: true,
      stopped: false,
      port,
      error: 'AUTH_TOKEN_REQUIRED',
      hint: 'Set HYDRA_TOKEN or pass --token <jwt> from an unlocked Hydra session.',
    };
    if (wantJson) json(report);
    else {
      status('err', `Hydra is listening on 127.0.0.1:${port}, but shutdown requires a session token.`);
      process.stderr.write(`Fix: ${report.hint}\n`);
    }
    process.exitCode = 2;
    return;
  }

  const result = await shutdownServer(port, token);
  const report = {
    running: true,
    stopped: result.ok,
    port,
    statusCode: result.statusCode,
    response: result.body,
  };

  if (wantJson) json(report);
  else if (result.ok) status('ok', `Shutdown requested for Hydra on 127.0.0.1:${port}.`);
  else status('err', `Shutdown failed with HTTP ${result.statusCode}.`);

  if (!result.ok) process.exitCode = result.statusCode === 401 || result.statusCode === 403 ? 2 : 1;
}
