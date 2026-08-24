/**
 * `hydra balance` — total live balance across the fleet.
 *
 * Optional first arg: an account id (full or 8-char prefix) to print only
 * that account's balance.
 *
 * Flags:
 *   --json     Machine-readable output.
 *   --refresh  Pull live credits from OpenRouter before reporting.
 */
import { c, json, fmtBalance } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

export async function run(argv) {
  const wantJson = argv.includes('--json');
  const wantRefresh = argv.includes('--refresh');
  const idArg = argv.find(a => a !== '--json' && !a.startsWith('--'));

  try {
    const { store } = await loadServices();
    const user = await resolveUser();

    // `--refresh` pulls live credits from OpenRouter first so a single command
    // answers "what is my balance right now" without opening the desktop app.
    if (wantRefresh) {
      const { runSync } = await import('./accounts.js');
      await runSync(['--yes'], { store, user, wantJson: false, quiet: true });
    }

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

    // Only accounts with a synced balance count toward the total. Treating an
    // unknown balance as $0.00 would silently under-report the fleet.
    const known = accounts.filter(a => typeof a.credits?.remaining === 'number');
    const unknown = accounts.length - known.length;
    const total = known.reduce((s, a) => s + a.credits.remaining, 0);

    if (wantJson) {
      json({
        total: Number(total.toFixed(4)),
        countedAccounts: known.length,
        unknownAccounts: unknown,
        breakdown: accounts.map(a => ({
          id: a.id,
          email: a.email,
          balance: a.credits?.remaining ?? null,
        })),
      });
    } else {
      const scope = `across ${known.length} of ${accounts.length} account${accounts.length === 1 ? '' : 's'}`;
      process.stdout.write(`${c.bold(fmtBalance(total))} ${c.dim(scope)}\n`);
      if (unknown > 0) {
        process.stdout.write(c.dim(`  ${unknown} account${unknown === 1 ? '' : 's'} unsynced (needs a management key or re-auth) — see \`hydra accounts sync --dry-run\`\n`));
      }
    }
  } finally {
    await shutdown();
  }
}
