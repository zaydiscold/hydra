/**
 * `hydra scan --quick` — closed-app fleet health pass.
 *
 * Reads local DB/session metadata only. It does not launch Electron and does
 * not make live OpenRouter/Clerk calls.
 */
import { c, fmtHealth, json, status, table } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function usage() {
  process.stdout.write(`Hydra scan

  hydra scan --quick
  hydra scan --quick --json

Closed-app fleet health scan. Reads local account/session/key metadata only.
`);
}

function readinessFor(account, session) {
  const clientCookieCount = Array.isArray(session.clientCookies)
    ? session.clientCookies.length
    : Number(Boolean(session.clientCookie));
  const hasSessionCookie = Boolean(String(session.sessionCookie || '').trim());
  if (hasSessionCookie && account.sessionStatus !== 'expired') return 'ready';
  if (clientCookieCount > 0) return 'refreshable';
  if (account.passwordOnFile && account.authMethod === 'password') return 'reauth_password';
  if (account.email && account.authMethod === 'otp') return 'reauth_otp';
  return 'blocked';
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }
  if (!hasFlag(argv, '--quick')) {
    process.stderr.write(`${c.err('✗')} only quick local scans are implemented right now; run: hydra scan --quick\n`);
    process.exitCode = 1;
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  try {
    const { store } = await loadServices();
    const user = await resolveUser();
    const accounts = await store.getAccounts(user.id);
    const rows = [];
    for (const account of accounts) {
      const session = await store.getAccountSession(user.id, account.id);
      const clientCookieCount = Array.isArray(session.clientCookies)
        ? session.clientCookies.length
        : Number(Boolean(session.clientCookie));
      rows.push({
        id: account.id,
        shortId: account.id.slice(0, 8),
        email: account.email,
        alias: account.alias,
        sessionStatus: account.sessionStatus || 'unknown',
        sessionExpiry: session.sessionExpiry || account.sessionExpiry || null,
        clientCookieCount,
        hasManagementKey: account.hasManagementKey,
        passwordOnFile: account.passwordOnFile,
        redemptionReadiness: readinessFor(account, session),
      });
    }

    const summary = {
      accounts: rows.length,
      activeSessions: rows.filter((row) => row.sessionStatus === 'active').length,
      expiringSessions: rows.filter((row) => row.sessionStatus === 'expiring').length,
      inactiveSessions: rows.filter((row) => !['active', 'expiring'].includes(row.sessionStatus)).length,
      managementKeys: rows.filter((row) => row.hasManagementKey).length,
      redemptionReady: rows.filter((row) => row.redemptionReadiness === 'ready').length,
      redemptionBlocked: rows.filter((row) => row.redemptionReadiness === 'blocked').length,
    };

    if (wantJson) {
      json({ summary, accounts: rows });
      return;
    }

    process.stdout.write(`${c.bold('Hydra quick scan')}\n\n`);
    if (rows.length === 0) {
      status('warn', 'No accounts found.');
      return;
    }
    table(rows.map((row) => ({
      mark: fmtHealth(row.sessionStatus),
      id: row.shortId,
      account: row.email || row.alias || row.id,
      session: row.sessionStatus,
      cookies: row.clientCookieCount,
      key: row.hasManagementKey ? 'yes' : 'no',
      redeem: row.redemptionReadiness,
    })), [
      { key: 'mark', label: '' },
      { key: 'id', label: 'ID' },
      { key: 'account', label: 'ACCOUNT' },
      { key: 'session', label: 'SESSION' },
      { key: 'cookies', label: 'COOKIES', align: 'right' },
      { key: 'key', label: 'MGMT' },
      { key: 'redeem', label: 'REDEEM' },
    ]);
    process.stdout.write('\n');
    status(summary.redemptionBlocked > 0 ? 'warn' : 'ok', `${summary.activeSessions}/${summary.accounts} active sessions, ${summary.managementKeys} with management keys, ${summary.redemptionBlocked} redemption-blocked`);
  } finally {
    await shutdown();
  }
}
