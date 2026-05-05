/**
 * `hydra balance` — total live balance across the fleet.
 *
 * Optional first arg: an account id (full or 8-char prefix) to print only
 * that account's balance.
 *
 * Flags:
 *   --json    Machine-readable output.
 */
import { c, json, fmtBalance } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

export async function run(argv) {
  const wantJson = argv.includes('--json');
  const idArg = argv.find(a => a !== '--json' && !a.startsWith('--'));

  try {
    const { store } = await loadServices();
    const user = await resolveUser();
    const accounts = await store.getAccounts(user.id);

    if (idArg) {
      const acct = accounts.find(a => a.id === idArg || a.id.startsWith(idArg));
      if (!acct) {
        process.stderr.write(`${c.err('✗')} no account matches ${c.bold(idArg)}\n`);
        process.exitCode = 1;
        return;
      }
      const v = acct.credits?.remaining ?? null;
      if (wantJson) json({ id: acct.id, email: acct.email, balance: v });
      else process.stdout.write(`${c.bold(acct.email || acct.alias)}  ${c.ok(fmtBalance(v))}\n`);
      return;
    }

    const total = accounts.reduce((s, a) => s + (a.credits?.remaining ?? 0), 0);

    if (wantJson) {
      json({
        total: Number(total.toFixed(4)),
        breakdown: accounts.map(a => ({
          id: a.id,
          email: a.email,
          balance: a.credits?.remaining ?? null,
        })),
      });
    } else {
      process.stdout.write(`${c.bold(fmtBalance(total))} ${c.dim('across ' + accounts.length + ' account' + (accounts.length === 1 ? '' : 's'))}\n`);
    }
  } finally {
    await shutdown();
  }
}
