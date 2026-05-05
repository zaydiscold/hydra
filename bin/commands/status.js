/**
 * `hydra status` — one-shot fleet overview.
 *
 * Prints a single block: account count, healthy count, total live balance,
 * proxy keys, and whether the embedded server is currently running.
 *
 * Flags:
 *   --json    Machine-readable output.
 */
import { c, json, status as statusLine, fmtBalance } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

export async function run(argv) {
  const wantJson = argv.includes('--json');

  try {
    const { store } = await loadServices();
    const user = await resolveUser();
    const accounts = await store.getAccounts(user.id);

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
    };

    if (wantJson) {
      json(summary);
    } else {
      const total = accounts.length;
      const sick = total - healthyCount;
      process.stdout.write(`${c.bold('Hydra')} ${c.dim('— fleet status')}\n\n`);
      process.stdout.write(`  ${c.dim('Accounts:')}    ${total} ${c.dim('(' + healthyCount + ' healthy, ' + sick + ' need attention)')}\n`);
      process.stdout.write(`  ${c.dim('Live balance:')} ${c.ok(fmtBalance(liveBalance))} ${c.dim('across all accounts')}\n`);
      process.stdout.write(`  ${c.dim('Active keys:')}  ${keyCount}\n`);
      process.stdout.write(`  ${c.dim('Data dir:')}     ${c.cyan(summary.dataDir)}\n\n`);
      if (sick > 0) {
        statusLine('warn', `${sick} account${sick === 1 ? '' : 's'} need attention — run \`hydra accounts\` for detail`);
      } else if (total === 0) {
        statusLine('info', 'No accounts yet — run the Generator from the UI to add one');
      } else {
        statusLine('ok', 'Fleet is healthy');
      }
    }
  } finally {
    await shutdown();
  }
}
