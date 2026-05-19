/**
 * `hydra keys` — read-only management-key inventory.
 *
 * This intentionally never prints decrypted key material. It reads the
 * ManagementKey table and joins account display data from store.getAccounts().
 */
import { c, fmtAge, json, table } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function valueFor(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function usage() {
  process.stdout.write(`Hydra keys

  hydra keys                  List stored management keys
  hydra keys --account <id>   Filter by account id prefix
  hydra keys provision <id> --dry-run
  hydra keys provision <id> --yes [--name "Hydra CLI Key"]
  hydra keys rotate <id> --dry-run
  hydra keys rotate <id> --yes [--name "Hydra CLI Rotated Key"]
  hydra keys --json           Machine-readable output

Key material is never printed by this command.
`);
}

function parseMetadata(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { parseError: true };
  }
}

function positional(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (['--account', '--name'].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function firstAccountArg(argv) {
  return valueFor(argv, '--account') || positional(argv)[1] || null;
}

function clientCookieCount(session = {}) {
  if (Array.isArray(session.clientCookies)) {
    return session.clientCookies.filter((entry) => String(entry?.cookie || entry || '').trim()).length;
  }
  return Number(Boolean(String(session.clientCookie || '').trim()));
}

function evaluateProvisionReadiness(account, session) {
  if (account.managementKey) {
    return {
      ready: false,
      detail: 'already_has_management_key',
      message: 'Account already has an active management key.',
    };
  }

  if (String(session.sessionCookie || '').trim()) {
    return { ready: true, detail: 'session_validate', message: 'Stored dashboard session can be validated before provisioning.' };
  }

  if (clientCookieCount(session) > 0) {
    return { ready: true, detail: 'client_refresh', message: 'Stored Clerk client cookie can be tried for session refresh.' };
  }

  if (account.email && account.password && account.authMethod === 'password') {
    return { ready: true, detail: 'password_reauth', message: 'Stored password auth can be used to reauthenticate before provisioning.' };
  }

  return {
    ready: false,
    detail: 'blocked',
    message: 'No dashboard session, client cookie, or stored password auth path. Re-authenticate this account in Hydra first.',
  };
}

async function resolveAccount(store, userId, accountArg) {
  if (!accountArg) {
    const err = new Error('keys provision requires an account id prefix');
    err.code = 'ACCOUNT_REQUIRED';
    throw err;
  }
  const accounts = await store.getAccounts(userId);
  const matches = accounts.filter((account) => account.id === accountArg || account.id.startsWith(accountArg));
  if (matches.length === 0) {
    const err = new Error(`no account matches ${accountArg}`);
    err.code = 'ACCOUNT_NOT_FOUND';
    throw err;
  }
  if (matches.length > 1) {
    const err = new Error(`account prefix ${accountArg} is ambiguous`);
    err.code = 'ACCOUNT_AMBIGUOUS';
    throw err;
  }
  return matches[0];
}

async function runProvision(argv, { store, user }) {
  const wantJson = hasFlag(argv, '--json');
  const dryRun = hasFlag(argv, '--dry-run');
  const confirmed = hasFlag(argv, '--yes') || hasFlag(argv, '-y');
  const accountArg = firstAccountArg(argv);

  let account;
  try {
    account = await resolveAccount(store, user.id, accountArg);
  } catch (err) {
    const report = { ok: false, error: err.code || 'ACCOUNT_ERROR', message: err.message };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  const [detail, session] = await Promise.all([
    store.getAccountWithKey(user.id, account.id),
    store.getAccountSession(user.id, account.id),
  ]);
  const readiness = evaluateProvisionReadiness(detail, session);
  const report = {
    ok: readiness.ready,
    dryRun: !confirmed,
    accountId: account.id,
    account: account.email || account.alias || account.id,
    ready: readiness.ready,
    detail: readiness.detail,
    message: readiness.message,
    session: {
      hasSessionCookie: Boolean(String(session.sessionCookie || '').trim()),
      clientCookieCount: clientCookieCount(session),
      sessionExpiry: session.sessionExpiry || null,
    },
    existingManagementKey: Boolean(detail.managementKey),
  };

  if (!confirmed) {
    if (!dryRun) {
      report.ok = false;
      report.error = 'CONFIRMATION_REQUIRED';
      report.hint = 'Run hydra keys provision <id> --dry-run first, then add --yes to create a live OpenRouter management key.';
      if (wantJson) json(report);
      else {
        process.stderr.write(`${c.err('✗')} keys provision is a live OpenRouter action; rerun with --dry-run or --yes\n`);
      }
      process.exitCode = 2;
      return;
    }

    if (wantJson) json(report);
    else {
      process.stdout.write(`${c.bold('Hydra key provision preflight')}\n\n`);
      process.stdout.write(`  ${c.dim('Account:')} ${report.account}\n`);
      process.stdout.write(`  ${c.dim('State:')}   ${readiness.ready ? c.ok(readiness.detail) : c.warn(readiness.detail)}\n`);
      process.stdout.write(`  ${c.dim('Message:')} ${readiness.message}\n`);
    }
    return;
  }

  if (!readiness.ready) {
    report.ok = false;
    report.error = 'PREFLIGHT_BLOCKED';
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${readiness.message}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const { createManagementKey } = await import('../../server/services/dashboard-api.js');
    const keyName = valueFor(argv, '--name') || 'Hydra CLI Key';
    const result = await createManagementKey(user.id, account.id, keyName);
    const liveReport = {
      ok: result?.success !== false,
      accountId: account.id,
      account: report.account,
      keyStored: Boolean(result?.key),
      source: result?.source || null,
      message: result?.message || 'Management key provisioned and stored.',
    };
    if (wantJson) json(liveReport);
    else process.stdout.write(`${c.ok('✓')} ${liveReport.message}\n`);
  } catch (err) {
    const liveReport = {
      ok: false,
      error: err.code || 'PROVISION_FAILED',
      accountId: account.id,
      message: err.message,
    };
    if (wantJson) json(liveReport);
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 1;
  }
}

async function runRotate(argv, { store, user }) {
  const wantJson = hasFlag(argv, '--json');
  const dryRun = hasFlag(argv, '--dry-run');
  const confirmed = hasFlag(argv, '--yes') || hasFlag(argv, '-y');
  const accountArg = firstAccountArg(argv);

  let account;
  try {
    account = await resolveAccount(store, user.id, accountArg);
  } catch (err) {
    const report = { ok: false, error: err.code || 'ACCOUNT_ERROR', message: err.message };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  const { getBestManagementKey } = await import('../../server/services/management-key-store.js');
  const [detail, session, currentKey] = await Promise.all([
    store.getAccountWithKey(user.id, account.id),
    store.getAccountSession(user.id, account.id),
    getBestManagementKey(account.id),
  ]);
  const readiness = evaluateProvisionReadiness({ ...detail, managementKey: null }, session);
  const hasCurrentKey = Boolean(currentKey?.id);
  const ready = hasCurrentKey && readiness.ready;
  const detailCode = !hasCurrentKey ? 'missing_management_key' : readiness.detail;
  const message = !hasCurrentKey
    ? 'Account has no active management key to rotate.'
    : readiness.message;
  const report = {
    ok: ready,
    dryRun: !confirmed,
    accountId: account.id,
    account: account.email || account.alias || account.id,
    ready,
    detail: detailCode,
    message,
    currentKeyId: currentKey?.id || null,
    session: {
      hasSessionCookie: Boolean(String(session.sessionCookie || '').trim()),
      clientCookieCount: clientCookieCount(session),
      sessionExpiry: session.sessionExpiry || null,
    },
  };

  if (!confirmed) {
    if (!dryRun) {
      report.ok = false;
      report.error = 'CONFIRMATION_REQUIRED';
      report.hint = 'Run hydra keys rotate <id> --dry-run first, then add --yes to create a replacement key and locally revoke the prior row.';
      if (wantJson) json(report);
      else process.stderr.write(`${c.err('✗')} keys rotate is a live OpenRouter action; rerun with --dry-run or --yes\n`);
      process.exitCode = 2;
      return;
    }

    if (wantJson) json(report);
    else {
      process.stdout.write(`${c.bold('Hydra key rotation preflight')}\n\n`);
      process.stdout.write(`  ${c.dim('Account:')} ${report.account}\n`);
      process.stdout.write(`  ${c.dim('State:')}   ${ready ? c.ok(detailCode) : c.warn(detailCode)}\n`);
      process.stdout.write(`  ${c.dim('Message:')} ${message}\n`);
    }
    return;
  }

  if (!ready) {
    report.ok = false;
    report.error = 'PREFLIGHT_BLOCKED';
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${message}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const { createManagementKey } = await import('../../server/services/dashboard-api.js');
    const { revokeManagementKey } = await import('../../server/services/management-key-store.js');
    const keyName = valueFor(argv, '--name') || 'Hydra CLI Rotated Key';
    const result = await createManagementKey(user.id, account.id, keyName);
    if (result?.success === false || !result?.key) {
      throw new Error(result?.message || 'Replacement management key was not captured.');
    }
    await revokeManagementKey(currentKey.id);
    const liveReport = {
      ok: true,
      accountId: account.id,
      account: report.account,
      keyStored: true,
      previousKeyRevokedLocally: true,
      previousKeyId: currentKey.id,
      source: result?.source || null,
      message: 'Management key rotated; previous local row marked revoked.',
    };
    if (wantJson) json(liveReport);
    else process.stdout.write(`${c.ok('✓')} ${liveReport.message}\n`);
  } catch (err) {
    const liveReport = {
      ok: false,
      error: err.code || 'ROTATE_FAILED',
      accountId: account.id,
      message: err.message,
    };
    if (wantJson) json(liveReport);
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 1;
  }
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  const accountFilter = valueFor(argv, '--account');

  try {
    const { db, store } = await loadServices();
    const user = await resolveUser();

    if (argv[0] === 'provision') {
      await runProvision(argv, { store, user });
      return;
    }

    if (argv[0] === 'rotate') {
      await runRotate(argv, { store, user });
      return;
    }

    const accounts = await store.getAccounts(user.id);
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const selectedAccount = accountFilter
      ? accounts.find((account) => account.id === accountFilter || account.id.startsWith(accountFilter))
      : null;

    if (accountFilter && !selectedAccount) {
      process.stderr.write(`${c.err('✗')} no account matches ${c.bold(accountFilter)}\n`);
      process.exitCode = 1;
      return;
    }

    const rows = await db.prisma.managementKey.findMany({
      where: selectedAccount ? { accountId: selectedAccount.id } : { account: { userId: user.id } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        accountId: true,
        name: true,
        status: true,
        metadata: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const shaped = rows.map((row) => {
      const account = accountsById.get(row.accountId);
      return {
        id: row.id,
        shortId: row.id.slice(0, 8),
        accountId: row.accountId,
        account: account?.email || account?.alias || row.accountId,
        name: row.name,
        status: row.status,
        metadata: parseMetadata(row.metadata),
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    if (wantJson) {
      json({ keys: shaped, count: shaped.length });
      return;
    }

    if (shaped.length === 0) {
      process.stdout.write(c.dim('  (no management keys stored)\n'));
      return;
    }

    table(shaped, [
      { key: 'shortId', label: 'ID' },
      { key: 'account', label: 'ACCOUNT' },
      { key: 'name', label: 'NAME' },
      { key: 'status', label: 'STATUS' },
      { key: 'lastUsedAt', label: 'LAST USED', fmt: fmtAge },
      { key: 'createdAt', label: 'AGE', fmt: fmtAge },
    ]);
    process.stdout.write('\n');
    process.stdout.write(c.dim(`  ${shaped.length} management key${shaped.length === 1 ? '' : 's'} · secret values hidden\n`));
  } finally {
    await shutdown();
  }
}
