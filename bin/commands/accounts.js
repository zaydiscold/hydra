/**
 * `hydra accounts` — list every account with health, balance, session, age.
 *
 * Flags:
 *   --json    Machine-readable output.
 */
import { c, table, json, fmtBalance, fmtAge, fmtHealth } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

export async function run(argv) {
  const wantJson = argv.includes('--json');

  try {
    const { store } = await loadServices();
    const user = await resolveUser();
    const accounts = await store.getAccounts(user.id);

    if (wantJson) {
      json({
        accounts: accounts.map(a => ({
          id: a.id,
          email: a.email,
          alias: a.alias,
          health: a.sessionStatus,
          balance: a.credits?.remaining ?? null,
          sessionStatus: a.sessionStatus,
          hasManagementKey: a.hasManagementKey,
          ageMs: a.createdAt ? Date.now() - new Date(a.createdAt).getTime() : null,
        })),
      });
      return;
    }

    if (accounts.length === 0) {
      process.stdout.write(c.dim('  (no accounts yet — run the Generator from the UI)\n'));
      return;
    }

    const rows = accounts.map(a => ({
      id: a.id.slice(0, 8),
      email: a.email || a.alias || c.dim('—'),
      health: fmtHealth(a.sessionStatus),
      balance: a.credits?.remaining,
      session: a.sessionStatus || 'unknown',
      keys: a.keys?.active ?? 0,
      age: a.createdAt,
    }));

    table(rows, [
      { key: 'id', label: 'ID' },
      { key: 'email', label: 'EMAIL' },
      { key: 'health', label: '' },
      { key: 'balance', label: 'BALANCE', align: 'right', fmt: fmtBalance },
      { key: 'session', label: 'SESSION' },
      { key: 'keys', label: 'KEYS', align: 'right' },
      { key: 'age', label: 'AGE', fmt: fmtAge },
    ]);

    const healthy = accounts.filter(a => a.sessionStatus === 'active').length;
    const total = accounts.reduce((s, a) => s + (a.credits?.remaining ?? 0), 0);
    process.stdout.write('\n');
    process.stdout.write(c.dim(`  ${accounts.length} account${accounts.length === 1 ? '' : 's'} · ${healthy} healthy · ${fmtBalance(total)} total live balance\n`));
  } finally {
    await shutdown();
  }
}
