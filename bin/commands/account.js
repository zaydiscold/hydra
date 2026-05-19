/**
 * `hydra account <id>` — redacted detail view for one account.
 *
 * Joins local account/session/key metadata without printing passwords, session
 * cookies, management keys, or API key plaintext.
 */
import { c, fmtHealth, json, status } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function positional(argv) {
  return argv.filter((arg) => !arg.startsWith('--'));
}

function usage() {
  process.stdout.write(`Hydra account

  hydra account <account-id-prefix>
  hydra account <account-id-prefix> --json

Shows redacted local account details. Secrets are never printed.
`);
}

function clientCookieCount(session = {}) {
  return Array.isArray(session.clientCookies)
    ? session.clientCookies.length
    : Number(Boolean(session.clientCookie));
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  const idArg = positional(argv)[0];
  if (!idArg) {
    process.stderr.write(`${c.err('✗')} account id prefix is required\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const { db, store } = await loadServices();
    const user = await resolveUser();
    const accounts = await store.getAccounts(user.id);
    const matches = accounts.filter((account) => account.id === idArg || account.id.startsWith(idArg));
    if (matches.length === 0) {
      process.stderr.write(`${c.err('✗')} no account matches ${c.bold(idArg)}\n`);
      process.exitCode = 1;
      return;
    }
    if (matches.length > 1) {
      process.stderr.write(`${c.err('✗')} account prefix ${c.bold(idArg)} matches ${matches.length} accounts; use more characters\n`);
      process.exitCode = 1;
      return;
    }

    const account = matches[0];
    const [storedSession, managementKeyCount, apiKeyStats] = await Promise.all([
      store.getAccountSession(user.id, account.id),
      db.prisma.managementKey.count({ where: { accountId: account.id } }),
      db.prisma.key.groupBy({
        by: ['disabled', 'isPooled'],
        where: { accountId: account.id },
        _count: { hash: true },
      }),
    ]);
    const session = storedSession || {};
    const apiKeyRecords = apiKeyStats.reduce((sum, row) => sum + row._count.hash, 0);
    const activeApiKeyRecords = apiKeyStats
      .filter((row) => !row.disabled)
      .reduce((sum, row) => sum + row._count.hash, 0);
    const pooledApiKeyRecords = apiKeyStats
      .filter((row) => row.isPooled)
      .reduce((sum, row) => sum + row._count.hash, 0);

    const report = {
      id: account.id,
      alias: account.alias,
      email: account.email,
      authMethod: account.authMethod,
      sessionStatus: account.sessionStatus,
      sessionExpiry: session.sessionExpiry || account.sessionExpiry || null,
      sessionRefreshedAt: account.sessionRefreshedAt || null,
      lastLoginAt: account.lastLoginAt || null,
      clientCookieCount: clientCookieCount(session),
      hasSessionCookie: Boolean(String(session.sessionCookie || '').trim()),
      hasManagementKey: account.hasManagementKey,
      managementKeyRecords: managementKeyCount,
      apiKeyRecords,
      activeApiKeyRecords,
      pooledApiKeyRecords,
      passwordOnFile: account.passwordOnFile,
      createdAt: account.createdAt,
    };

    if (wantJson) {
      json(report);
      return;
    }

    process.stdout.write(`${c.bold('Hydra account')} ${c.dim(report.id)}\n\n`);
    process.stdout.write(`  ${c.dim('Email:')}            ${report.email || 'unknown'}\n`);
    process.stdout.write(`  ${c.dim('Alias:')}            ${report.alias || 'unknown'}\n`);
    process.stdout.write(`  ${c.dim('Auth method:')}      ${report.authMethod || 'unknown'}\n`);
    process.stdout.write(`  ${c.dim('Session:')}          ${fmtHealth(report.sessionStatus)} ${report.sessionStatus || 'unknown'}\n`);
    process.stdout.write(`  ${c.dim('Session expiry:')}   ${report.sessionExpiry || 'unknown'}\n`);
    process.stdout.write(`  ${c.dim('Client cookies:')}   ${report.clientCookieCount}\n`);
    process.stdout.write(`  ${c.dim('Management keys:')}  ${report.managementKeyRecords}\n`);
    process.stdout.write(`  ${c.dim('API key records:')}  ${report.apiKeyRecords} (${report.activeApiKeyRecords} active, ${report.pooledApiKeyRecords} pooled)\n`);
    process.stdout.write(`  ${c.dim('Password auth:')}    ${report.passwordOnFile ? 'stored' : 'not stored'}\n\n`);
    status('ok', 'Account detail is redacted; no secrets printed.');
  } finally {
    await shutdown();
  }
}
