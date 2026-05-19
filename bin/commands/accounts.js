/**
 * `hydra accounts` — list every account with health, balance, session, age.
 * `hydra accounts purge --dead` — remove inert local placeholder rows.
 * `hydra accounts sync` — preflight or run live OpenRouter metadata sync.
 *
 * Flags:
 *   --json       Machine-readable output.
 *   --dry-run    Show purge candidates without deleting them.
 *   --yes        Required for deletion.
 */
import { c, table, json, fmtBalance, fmtAge, fmtHealth } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

function usage() {
  process.stdout.write(`Hydra accounts

  hydra accounts                          List local accounts
  hydra accounts --json                   List local accounts as JSON
  hydra accounts sync --dry-run           Show accounts ready for live sync
  hydra accounts sync --account <id> --dry-run
  hydra accounts sync --yes               Sync balances/key metadata via management keys
  hydra accounts purge --dead --dry-run   Show inert placeholder rows
  hydra accounts purge --dead --yes       Delete inert placeholder rows

Purge is intentionally conservative. It only targets local placeholder accounts
with no email, no auth method, no stored password, no session material, no
client-cookie stack, and no management key. OTP/password accounts that can be
reauthenticated are kept.
`);
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function valueFor(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function resolveAccountSelection(accounts, accountArg) {
  if (!accountArg) return accounts;
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
  return matches;
}

function isDeadPurgeCandidate(account, detail) {
  const sessionCookie = typeof detail.sessionCookie === 'string' ? detail.sessionCookie.trim() : '';
  const clientCookies = Array.isArray(detail.clientCookies) ? detail.clientCookies : [];
  const hasClientCookie = clientCookies.some((entry) => String(entry?.cookie || entry || '').trim());
  const email = typeof account.email === 'string' ? account.email.trim() : '';
  const authMethod = typeof account.authMethod === 'string' ? account.authMethod.trim() : '';

  return !email
    && !authMethod
    && !account.passwordOnFile
    && !account.hasManagementKey
    && !sessionCookie
    && !hasClientCookie;
}

function syncReadiness(account) {
  if (account.hasManagementKey) {
    return { ready: true, detail: 'management_key_available', message: 'Account has a stored management key.' };
  }
  return {
    ready: false,
    detail: 'missing_management_key',
    message: 'Provision or paste a management key before syncing OpenRouter balance/key metadata.',
  };
}

async function runSync(argv, { store, user, wantJson }) {
  if (hasFlag(argv, 'help') || hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    usage();
    return;
  }

  const dryRun = hasFlag(argv, '--dry-run');
  const confirmed = hasFlag(argv, '--yes') || hasFlag(argv, '-y');
  const accountArg = valueFor(argv, '--account') || argv.find((arg) => !arg.startsWith('--')) || null;

  if (!dryRun && !confirmed) {
    const report = {
      ok: false,
      error: 'CONFIRMATION_REQUIRED',
      hint: 'Run hydra accounts sync --dry-run first, then add --yes for live OpenRouter sync.',
    };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} accounts sync is a live OpenRouter action; rerun with --dry-run or --yes\n`);
    process.exitCode = 2;
    return;
  }

  let selected;
  const accounts = await store.getAccounts(user.id);
  try {
    selected = resolveAccountSelection(accounts, accountArg);
  } catch (err) {
    const report = { ok: false, error: err.code || 'ACCOUNT_ERROR', message: err.message };
    if (wantJson) json(report);
    else process.stderr.write(`${c.err('✗')} ${err.message}\n`);
    process.exitCode = 2;
    return;
  }

  const rows = selected.map((account) => {
    const readiness = syncReadiness(account);
    return {
      accountId: account.id,
      account: account.email || account.alias || account.id,
      ready: readiness.ready,
      detail: readiness.detail,
      message: readiness.message,
      sessionStatus: account.sessionStatus,
      hasManagementKey: account.hasManagementKey,
    };
  });

  if (dryRun) {
    const report = {
      ok: rows.every((row) => row.ready),
      dryRun: true,
      scanned: selected.length,
      ready: rows.filter((row) => row.ready).length,
      blocked: rows.filter((row) => !row.ready).length,
      accounts: rows,
    };
    if (wantJson) {
      json(report);
      return;
    }
    table(rows.map((row) => ({
      mark: row.ready ? fmtHealth('active') : fmtHealth('expired'),
      account: row.account,
      state: row.detail,
      message: row.message,
    })), [
      { key: 'mark', label: '' },
      { key: 'account', label: 'ACCOUNT' },
      { key: 'state', label: 'STATE' },
      { key: 'message', label: 'MESSAGE' },
    ]);
    return;
  }

  const results = [];
  const { getBestManagementKey } = await import('../../server/services/management-key-store.js');
  const openrouter = await import('../../server/services/openrouter.js');
  for (const row of rows) {
    if (!row.ready) {
      results.push({ ...row, ok: false, skipped: true });
      continue;
    }
    try {
      const bestKey = await getBestManagementKey(row.accountId);
      if (!bestKey?.key) throw new Error('No active management key found.');
      const snapshot = await openrouter.getAccountSnapshot(bestKey.key);
      await store.updateAccountBalance(row.accountId, {
        remaining: snapshot.credits?.remaining,
        total: snapshot.credits?.total,
      });
      await store.syncKeysFromOpenRouter(user.id, row.accountId, snapshot.keys?.list || []);
      await store.updateAccountLastSync(user.id, row.accountId);
      results.push({
        ...row,
        ok: true,
        credits: snapshot.credits || null,
        keys: {
          total: snapshot.keys?.total || 0,
          active: snapshot.keys?.active || 0,
          disabled: snapshot.keys?.disabled || 0,
        },
      });
    } catch (err) {
      results.push({ ...row, ok: false, error: err.message });
    }
  }

  const report = {
    ok: results.every((row) => row.ok || row.skipped),
    dryRun: false,
    scanned: selected.length,
    synced: results.filter((row) => row.ok).length,
    skipped: results.filter((row) => row.skipped).length,
    failed: results.filter((row) => row.error).length,
    accounts: results,
  };

  if (wantJson) {
    json(report);
    return;
  }

  table(results.map((row) => ({
    account: row.account,
    status: row.ok ? c.ok('synced') : row.skipped ? c.warn('skipped') : c.err('failed'),
    keys: row.keys?.total ?? 0,
    balance: row.credits?.remaining,
    message: row.error || row.message || '',
  })), [
    { key: 'account', label: 'ACCOUNT' },
    { key: 'status', label: 'STATUS' },
    { key: 'keys', label: 'KEYS', align: 'right' },
    { key: 'balance', label: 'BALANCE', align: 'right', fmt: fmtBalance },
    { key: 'message', label: 'MESSAGE' },
  ]);
}

async function runPurge(argv, { store, user, wantJson }) {
  if (hasFlag(argv, 'help') || hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
    usage();
    return;
  }

  const deadOnly = hasFlag(argv, '--dead');
  if (!deadOnly) {
    const payload = {
      ok: false,
      error: 'DEAD_FILTER_REQUIRED',
      hint: 'Run hydra accounts purge --dead --dry-run first.',
    };
    if (wantJson) json(payload);
    else process.stderr.write(`${c.err('✗')} accounts purge requires --dead\n`);
    process.exitCode = 2;
    return;
  }

  const dryRun = hasFlag(argv, '--dry-run');
  const confirmed = hasFlag(argv, '--yes');
  if (!dryRun && !confirmed) {
    const payload = {
      ok: false,
      error: 'CONFIRMATION_REQUIRED',
      hint: 'Run hydra accounts purge --dead --dry-run to inspect candidates, then add --yes to delete them.',
    };
    if (wantJson) json(payload);
    else process.stderr.write(`${c.err('✗')} accounts purge requires --dry-run or --yes\n`);
    process.exitCode = 2;
    return;
  }

  const accounts = await store.getAccounts(user.id);
  const candidates = [];
  for (const account of accounts) {
    const detail = await store.getAccountWithKey(user.id, account.id);
    if (isDeadPurgeCandidate(account, detail)) {
      candidates.push({
        id: account.id,
        alias: account.alias,
        email: account.email || null,
        sessionStatus: account.sessionStatus,
        createdAt: account.createdAt,
        reason: 'placeholder_without_credentials_session_or_keys',
      });
    }
  }

  const deleted = [];
  if (confirmed) {
    for (const candidate of candidates) {
      await store.deleteAccount(user.id, candidate.id);
      deleted.push(candidate.id);
    }
  }

  const report = {
    ok: true,
    dryRun: !confirmed,
    filter: 'dead',
    scanned: accounts.length,
    candidates: candidates.length,
    deleted: deleted.length,
    accounts: candidates,
  };

  if (wantJson) {
    json(report);
    return;
  }

  if (candidates.length === 0) {
    process.stdout.write(c.dim('  (no dead placeholder accounts found)\n'));
    return;
  }

  table(candidates.map((candidate) => ({
    id: candidate.id.slice(0, 8),
    alias: candidate.alias || c.dim('—'),
    session: candidate.sessionStatus || 'unknown',
    reason: candidate.reason,
    age: candidate.createdAt,
  })), [
    { key: 'id', label: 'ID' },
    { key: 'alias', label: 'ALIAS' },
    { key: 'session', label: 'SESSION' },
    { key: 'reason', label: 'REASON' },
    { key: 'age', label: 'AGE', fmt: fmtAge },
  ]);

  process.stdout.write('\n');
  if (confirmed) {
    process.stdout.write(c.warn(`  Deleted ${deleted.length} dead placeholder account${deleted.length === 1 ? '' : 's'}.\n`));
  } else {
    process.stdout.write(c.dim(`  Dry run only. Add --yes to delete ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}.\n`));
  }
}

export async function run(argv) {
  const wantJson = argv.includes('--json');

  try {
    const { store } = await loadServices();
    const user = await resolveUser();

    if (argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
      usage();
      return;
    }

    if (argv[0] === 'purge') {
      await runPurge(argv.slice(1), { store, user, wantJson });
      return;
    }

    if (argv[0] === 'sync') {
      await runSync(argv.slice(1), { store, user, wantJson });
      return;
    }

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
