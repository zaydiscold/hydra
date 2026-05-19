/**
 * `hydra session <id>` — closed-app session readiness for one account.
 *
 * This command reads stored session metadata without printing session/client
 * cookies. It does not launch Electron. Add --refresh to force a live Clerk
 * session probe through the same service path used by the UI's Check Session.
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
  process.stdout.write(`Hydra session

  hydra session <account-id-prefix>
  hydra session <account-id-prefix> --json
  hydra session <account-id-prefix> --refresh
  hydra session <account-id-prefix> --refresh --json

Shows stored session status, expiry, cookie-stack count, and reauth hints.
Session tokens and client cookies are never printed.
Without --refresh, this is a cached/local display read. With --refresh, Hydra
forces a live Clerk probe when stored session material exists.
`);
}

function summarize(account, session) {
  const clientCookieCount = Array.isArray(session.clientCookies)
    ? session.clientCookies.length
    : Number(Boolean(session.clientCookie));
  const hasSessionCookie = Boolean(String(session.sessionCookie || '').trim());
  const hasClientCookie = clientCookieCount > 0;
  const canPasswordReauth = Boolean(account.email && account.passwordOnFile && account.authMethod === 'password');
  const canOtpReauth = Boolean(account.email && account.authMethod === 'otp');
  let redeemReadiness = 'blocked';
  let hint = 'No dashboard session and no stored reauth path.';

  if (hasSessionCookie && account.sessionStatus !== 'expired') {
    redeemReadiness = 'ready';
    hint = 'Stored dashboard session is available.';
  } else if (hasClientCookie) {
    redeemReadiness = 'refreshable';
    hint = 'Stored Clerk client cookie can be tried for refresh.';
  } else if (canPasswordReauth) {
    redeemReadiness = 'reauth_password';
    hint = 'Stored password auth can reauthenticate before live actions.';
  } else if (canOtpReauth) {
    redeemReadiness = 'reauth_otp';
    hint = 'OTP auth can reauthenticate, but requires a live OTP flow.';
  }

  return {
    id: account.id,
    email: account.email,
    alias: account.alias,
    authMethod: account.authMethod,
    sessionStatus: account.sessionStatus,
    sessionExpiry: session.sessionExpiry || account.sessionExpiry || null,
    sessionRefreshedAt: account.sessionRefreshedAt || null,
    lastLoginAt: account.lastLoginAt || null,
    hasSessionCookie,
    hasClientCookie,
    clientCookieCount,
    hasManagementKey: account.hasManagementKey,
    passwordOnFile: account.passwordOnFile,
    canPasswordReauth,
    canOtpReauth,
    redeemReadiness,
    hint,
    live: false,
  };
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  const refresh = hasFlag(argv, '--refresh');
  const idArg = positional(argv)[0];
  if (!idArg) {
    process.stderr.write(`${c.err('✗')} account id prefix is required\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const { store } = await loadServices();
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
    const session = await store.getAccountSession(user.id, account.id);
    const report = summarize(account, session);
    if (refresh) {
      const live = await store.probeSessionLive(user.id, account.id);
      report.sessionStatus = live.status;
      report.sessionExpiry = live.sessionExpiry || report.sessionExpiry;
      report.sessionDecryptFailed = Boolean(live.sessionDecryptFailed);
      report.live = true;
      if (live.status === 'active') {
        report.redeemReadiness = 'ready';
        report.hint = 'Live Clerk probe succeeded.';
      } else if (live.status === 'none') {
        report.redeemReadiness = report.canPasswordReauth ? 'reauth_password' : report.canOtpReauth ? 'reauth_otp' : 'blocked';
        report.hint = report.canPasswordReauth
          ? 'No stored dashboard session. Stored password auth can reauthenticate before live actions.'
          : report.canOtpReauth
            ? 'No stored dashboard session. OTP auth can reauthenticate, but requires a live OTP flow.'
            : 'No stored dashboard session and no stored reauth path.';
      } else if (live.status === 'expired') {
        report.redeemReadiness = report.hasClientCookie ? 'refreshable' : report.canPasswordReauth ? 'reauth_password' : report.canOtpReauth ? 'reauth_otp' : 'blocked';
        report.hint = 'Live Clerk probe did not confirm an active session.';
      }
    }

    if (wantJson) {
      json(report);
      return;
    }

    process.stdout.write(`${c.bold('Hydra session')} ${c.dim(account.id)}\n\n`);
    process.stdout.write(`  ${c.dim('Account:')}        ${account.email || account.alias || account.id}\n`);
    process.stdout.write(`  ${c.dim('Status:')}         ${fmtHealth(report.sessionStatus)} ${report.sessionStatus || 'unknown'}\n`);
    process.stdout.write(`  ${c.dim('Probe:')}          ${report.live ? 'live Clerk probe' : 'cached/local metadata'}\n`);
    process.stdout.write(`  ${c.dim('Readiness:')}      ${report.redeemReadiness}\n`);
    process.stdout.write(`  ${c.dim('Session expiry:')} ${report.sessionExpiry || 'unknown'}\n`);
    process.stdout.write(`  ${c.dim('Client cookies:')} ${report.clientCookieCount}\n`);
    process.stdout.write(`  ${c.dim('Password auth:')}  ${report.canPasswordReauth ? 'available' : 'not available'}\n`);
    process.stdout.write(`  ${c.dim('Management key:')} ${report.hasManagementKey ? 'stored' : 'missing'}\n\n`);
    status(report.redeemReadiness === 'blocked' ? 'warn' : 'ok', report.hint);
  } finally {
    await shutdown();
  }
}
