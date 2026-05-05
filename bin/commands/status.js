/**
 * `hydra status` — one-shot fleet + proxy overview.
 *
 * Prints account stats AND proxy state (keys, gate, default URL) so an
 * operator can see at a glance: how many accounts, how much balance,
 * is the proxy answering, what URL/key to point a client at.
 *
 * Detects whether a Hydra server process is currently bound to the
 * default port — best-effort TCP probe with a tight 250 ms timeout.
 *
 * Flags:
 *   --json    Machine-readable output.
 */
import net from 'node:net';
import { c, json, status as statusLine, fmtBalance } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

const DEFAULT_PROXY_PORT = Number(process.env.HYDRA_PORT) || 3001;

/** Best-effort: is anything listening on a localhost port? 250 ms timeout. */
function probePort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (val) => { if (done) return; done = true; sock.destroy(); resolve(val); };
    sock.setTimeout(250);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

/** Mask a key like `sk-hydra-aBc...XyZ` so we don't leak it in logs. */
function maskKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 12) return key;
  return key.slice(0, 8) + '…' + key.slice(-4);
}

export async function run(argv) {
  const wantJson = argv.includes('--json');

  try {
    const { store } = await loadServices();
    const user = await resolveUser();
    const accounts = await store.getAccounts(user.id);

    // Proxy state — pulled directly from store/proxy-gate (same modules the
    // server uses), so the answer is correct even when the server isn't
    // running yet (just the keys+gate, not the live port).
    let masterKey = null, genericKey = null, gateEnabled = null;
    try {
      const masterFn = store.getMasterProxyKey || (await import('../../server/services/store.js')).getMasterProxyKey;
      const genericFn = store.getGenericProxyKey || (await import('../../server/services/store.js')).getGenericProxyKey;
      masterKey = typeof masterFn === 'function' ? masterFn() : null;
      genericKey = typeof genericFn === 'function' ? genericFn() : null;
    } catch { /* keys not derivable yet */ }
    try {
      const { proxyGate } = await import('../../server/services/proxy-gate.js');
      gateEnabled = proxyGate?.enabled ?? null;
    } catch { /* gate not loaded */ }

    const portOpen = await probePort(DEFAULT_PROXY_PORT);
    const proxyUrl = portOpen ? `http://localhost:${DEFAULT_PROXY_PORT}/v1` : null;

    const healthyCount = accounts.filter(a =>
      a.sessionStatus === 'active' && a.hasManagementKey
    ).length;
    const liveBalance = accounts.reduce((sum, a) =>
      sum + (a.credits?.remaining ?? 0), 0);
    const keyCount = accounts.reduce((sum, a) =>
      sum + (a.keys?.active ?? 0), 0);

    const summary = {
      accounts: accounts.length,
      healthy: healthyCount,
      liveBalance: Number(liveBalance.toFixed(2)),
      activeKeys: keyCount,
      dataDir: process.env.HYDRA_DATA_DIR,
      proxy: {
        running: portOpen,
        url: proxyUrl,
        port: DEFAULT_PROXY_PORT,
        gateEnabled,
        masterKey: maskKey(masterKey),
        genericKey: maskKey(genericKey),
      },
    };

    if (wantJson) {
      json(summary);
      return;
    }

    const total = accounts.length;
    const sick = total - healthyCount;

    process.stdout.write(`${c.bold('Hydra')} ${c.dim('— manager status')}\n\n`);

    // Fleet block
    process.stdout.write(`${c.bold('  Fleet')}\n`);
    process.stdout.write(`    ${c.dim('Accounts:')}     ${total} ${c.dim('(' + healthyCount + ' healthy, ' + sick + ' need attention)')}\n`);
    process.stdout.write(`    ${c.dim('Live balance:')} ${c.ok(fmtBalance(liveBalance))}\n`);
    process.stdout.write(`    ${c.dim('Active keys:')}  ${keyCount}\n`);

    // Proxy block
    process.stdout.write(`\n${c.bold('  Proxy')}\n`);
    if (portOpen) {
      process.stdout.write(`    ${c.dim('Status:')}       ${c.ok('● running')} ${c.dim('on port ' + DEFAULT_PROXY_PORT)}\n`);
      process.stdout.write(`    ${c.dim('URL:')}          ${c.cyan(proxyUrl)}\n`);
    } else {
      process.stdout.write(`    ${c.dim('Status:')}       ${c.dim('○ not running')} ${c.dim('(no listener on :' + DEFAULT_PROXY_PORT + ')')}\n`);
      process.stdout.write(`    ${c.dim('Hint:')}         ${c.dim('start with `hydra` (production) or `hydra dev`')}\n`);
    }
    if (gateEnabled === false) {
      process.stdout.write(`    ${c.dim('Gate:')}         ${c.warn('● disabled')} ${c.dim('(operator turned off — /v1 returns 503)')}\n`);
    } else if (gateEnabled === true) {
      process.stdout.write(`    ${c.dim('Gate:')}         ${c.ok('● enabled')}\n`);
    }
    if (masterKey) {
      process.stdout.write(`    ${c.dim('Hydra key:')}    ${c.dim(maskKey(masterKey))}\n`);
    }

    // Footer
    process.stdout.write(`\n${c.bold('  Storage')}\n`);
    process.stdout.write(`    ${c.dim('Data dir:')}     ${c.cyan(summary.dataDir)}\n\n`);

    if (sick > 0) {
      statusLine('warn', `${sick} account${sick === 1 ? '' : 's'} need attention — run \`hydra accounts\` for detail`);
    } else if (total === 0) {
      statusLine('info', 'No accounts yet — open the Generator in the UI to add one');
    } else {
      statusLine('ok', 'Fleet is healthy');
    }
  } finally {
    await shutdown();
  }
}
