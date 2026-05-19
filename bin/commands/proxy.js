/**
 * `hydra proxy status` — focused local proxy status for scripts/operators.
 */
import net from 'node:net';
import { c, json, status } from '../lib/output.js';
import { loadServices, shutdown } from '../lib/services.js';

const DEFAULT_PROXY_PORT = Number(process.env.HYDRA_PORT || process.env.PORT || 3001);

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function maskKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
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
  process.stdout.write(`Hydra proxy

  hydra proxy status
  hydra proxy status --json
  hydra proxy keys new --yes
  hydra proxy keys new --yes --json

Shows local /v1 listener state, proxy gate state, and masked Hydra proxy keys.

proxy keys new rotates the local proxy secret. Existing sk-hydra-* and
sk-proj-* clients must be updated after rotation.
`);
}

export async function run(argv) {
  const action = argv[0] || 'status';
  if (action === 'help' || action === '--help' || action === '-h') {
    usage();
    return;
  }
  if (action === 'keys' && argv[1] === 'new') {
    await rotateProxyKeys(argv.slice(2));
    return;
  }
  if (action !== 'status') {
    process.stderr.write(`${c.err('✗')} unknown proxy command: ${action}\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  try {
    const { store } = await loadServices();
    const [{ proxyGate }, running] = await Promise.all([
      import('../../server/services/proxy-gate.js'),
      probePort(DEFAULT_PROXY_PORT),
    ]);
    const report = {
      running,
      port: DEFAULT_PROXY_PORT,
      url: running ? `http://localhost:${DEFAULT_PROXY_PORT}/v1` : null,
      gateEnabled: proxyGate.enabled,
      hydraKey: maskKey(store.getMasterProxyKey()),
      genericKey: maskKey(store.getGenericProxyKey()),
    };

    if (wantJson) {
      json(report);
      return;
    }

    process.stdout.write(`${c.bold('Hydra proxy')}\n\n`);
    process.stdout.write(`  ${c.dim('Listener:')} ${running ? c.ok('running') : c.dim('closed')} ${c.dim(`:${DEFAULT_PROXY_PORT}`)}\n`);
    process.stdout.write(`  ${c.dim('Gate:')}     ${report.gateEnabled ? c.ok('enabled') : c.warn('disabled')}\n`);
    if (report.url) process.stdout.write(`  ${c.dim('URL:')}      ${c.cyan(report.url)}\n`);
    process.stdout.write(`  ${c.dim('Hydra key:')} ${report.hydraKey || 'unavailable'}\n`);
    process.stdout.write(`  ${c.dim('Generic:')}   ${report.genericKey || 'unavailable'}\n\n`);
    status(running && report.gateEnabled ? 'ok' : 'warn', running ? 'Proxy state read from local services.' : 'Proxy is not listening right now.');
  } finally {
    await shutdown();
  }
}

async function rotateProxyKeys(argv) {
  const wantJson = hasFlag(argv, '--json');
  const confirmed = hasFlag(argv, '--yes') || hasFlag(argv, '-y');

  if (!confirmed) {
    const message = 'proxy key rotation requires --yes because existing proxy clients will stop working';
    if (wantJson) {
      json({
        ok: false,
        error: 'CONFIRMATION_REQUIRED',
        message,
        command: 'hydra proxy keys new --yes',
      });
    } else {
      process.stderr.write(`${c.err('✗')} ${message}\n`);
      process.stderr.write(`  run: ${c.cyan('hydra proxy keys new --yes')}\n`);
    }
    process.exitCode = 2;
    return;
  }

  try {
    const { store } = await loadServices();
    const { rotateProxySecret } = await import('../../server/services/local-secrets.js');
    const oldHydraKey = store.getMasterProxyKey();
    const oldGenericKey = store.getGenericProxyKey();

    rotateProxySecret();

    const hydraKey = store.getMasterProxyKey();
    const genericKey = store.getGenericProxyKey();
    const report = {
      ok: true,
      rotated: true,
      hydraKey,
      genericKey,
      previous: {
        hydraKey: maskKey(oldHydraKey),
        genericKey: maskKey(oldGenericKey),
      },
      warning: 'Existing proxy clients must be updated with the new key.',
    };

    if (wantJson) {
      json(report);
      return;
    }

    process.stdout.write(`${c.bold('Hydra proxy keys rotated')}\n\n`);
    process.stdout.write(`  ${c.dim('Hydra key:')}   ${hydraKey}\n`);
    process.stdout.write(`  ${c.dim('Generic key:')} ${genericKey}\n\n`);
    status('warn', report.warning);
  } finally {
    await shutdown();
  }
}
