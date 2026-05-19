/**
 * `hydra codes` — promo-code preflight and redemption helpers.
 *
 * Commands:
 *   hydra codes preflight <code> [--all | --account <id> ... | <id> ...]
 *   hydra codes redeem <code> --account <id> [--yes]
 *   hydra codes bulk <file> --account <id> [--yes]
 *
 * Preflight is read-first and does not call OpenRouter. Redeem/bulk are live
 * dashboard actions and require --yes so scripts cannot accidentally burn codes.
 */
import { readFileSync } from 'node:fs';
import { c, fmtHealth, json, status, table } from '../lib/output.js';
import { loadServices, resolveUser, shutdown } from '../lib/services.js';

function hasFlag(argv, name) {
  return argv.includes(name);
}

function valuesFor(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      values.push(argv[i + 1]);
      i += 1;
    }
  }
  return values;
}

function positional(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (['--account', '--file'].includes(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function usage() {
  process.stdout.write(`Hydra codes

  hydra codes preflight <code> [--all | --account <id> ... | <id> ...]
  hydra codes redeem <code> --account <id> --yes
  hydra codes bulk <file> --account <id> --yes

Flags:
  --json        Machine-readable output
  --all         Preflight every stored account
  --account ID  Select an account; may be repeated
  --yes         Required for live redemption actions
`);
}

function resolveAccountIds(argv, code, accounts) {
  const explicit = valuesFor(argv, '--account');
  const ids = new Set(explicit);
  for (const value of positional(argv).slice(2)) {
    if (value !== code) ids.add(value);
  }

  if (hasFlag(argv, '--all') || ids.size === 0) {
    return accounts.map((account) => account.id);
  }

  return [...ids].map((value) => {
    const match = accounts.find((account) => account.id === value || account.id.startsWith(value));
    return match?.id || value;
  });
}

function summarizePreflight(result, accountsById) {
  const ready = result.ready.map((row) => ({
    accountId: row.accountId,
    email: accountsById.get(row.accountId)?.email || row.alias || row.accountId,
    status: 'ready',
    detail: row.detail,
    message: '',
  }));
  const blocked = result.blocked.map((row) => ({
    accountId: row.accountId,
    email: accountsById.get(row.accountId)?.email || row.alias || row.accountId,
    status: 'blocked',
    detail: 'blocked',
    message: row.message,
  }));
  return [...ready, ...blocked];
}

async function runPreflight(argv, user, services) {
  const wantJson = hasFlag(argv, '--json');
  const code = positional(argv)[1];
  if (!code) {
    process.stderr.write(`${c.err('✗')} code is required\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  const accounts = await services.store.getAccounts(user.id);
  const accountIds = resolveAccountIds(argv, code, accounts);
  const { preflightRedeemAccounts } = await import('../../server/services/dashboard-api.js');
  const result = await preflightRedeemAccounts(user.id, accountIds);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const rows = summarizePreflight(result, accountsById);

  if (wantJson) {
    json({ code, accountIds, ...result, rows });
    return;
  }

  process.stdout.write(`${c.bold('Hydra code preflight')} ${c.dim(code)}\n\n`);
  if (rows.length === 0) {
    status('warn', 'No accounts selected.');
    return;
  }
  table(rows.map((row) => ({
    mark: row.status === 'ready' ? fmtHealth('active') : fmtHealth('expired'),
    account: row.email,
    detail: row.detail,
    message: row.message,
  })), [
    { key: 'mark', label: '' },
    { key: 'account', label: 'ACCOUNT' },
    { key: 'detail', label: 'STATE' },
    { key: 'message', label: 'MESSAGE' },
  ]);
  process.stdout.write('\n');
  if (result.allReady) status('ok', `${result.ready.length} account${result.ready.length === 1 ? '' : 's'} ready for redemption`);
  else status('warn', `${result.blocked.length} account${result.blocked.length === 1 ? '' : 's'} blocked; fix auth before redeeming`);
}

async function runRedeem(argv, user) {
  const wantJson = hasFlag(argv, '--json');
  const code = positional(argv)[1];
  const accountId = valuesFor(argv, '--account')[0] || positional(argv)[2];
  if (!code || !accountId) {
    process.stderr.write(`${c.err('✗')} redeem requires <code> and --account <id>\n`);
    usage();
    process.exitCode = 1;
    return;
  }
  if (!hasFlag(argv, '--yes')) {
    process.stderr.write(`${c.err('✗')} redeem is a live OpenRouter action; rerun with --yes after preflight\n`);
    process.exitCode = 1;
    return;
  }

  const { redeemCode } = await import('../../server/services/dashboard-api.js');
  const result = await redeemCode(user.id, accountId, code);
  if (wantJson) json({ accountId, code, result });
  else status(result?.success === false ? 'warn' : 'ok', result?.message || `Redeemed ${code} on ${accountId}`);
}

async function runBulk(argv, user) {
  const wantJson = hasFlag(argv, '--json');
  const file = valuesFor(argv, '--file')[0] || positional(argv)[1];
  const accountIds = valuesFor(argv, '--account');
  if (!file || accountIds.length === 0) {
    process.stderr.write(`${c.err('✗')} bulk requires <file> and at least one --account <id>\n`);
    usage();
    process.exitCode = 1;
    return;
  }
  if (!hasFlag(argv, '--yes')) {
    process.stderr.write(`${c.err('✗')} bulk is a live OpenRouter action; rerun with --yes after preflight\n`);
    process.exitCode = 1;
    return;
  }

  const codes = readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const assignments = codes.flatMap((code) => accountIds.map((accountId) => ({ code, accountId })));
  const { redeemCode, classifyRedeemFailure } = await import('../../server/services/dashboard-api.js');
  const results = [];
  for (const assignment of assignments) {
    try {
      const result = await redeemCode(user.id, assignment.accountId, assignment.code);
      results.push({ ...assignment, ok: true, result });
    } catch (err) {
      const classified = classifyRedeemFailure?.(err.message, err) || {};
      results.push({ ...assignment, ok: false, error: err.message, errorCode: classified.errorCode });
    }
  }

  if (wantJson) {
    json({ file, accountIds, codes, results });
    return;
  }
  table(results.map((row) => ({
    account: row.accountId,
    code: row.code,
    status: row.ok ? c.ok('ok') : c.err('failed'),
    message: row.result?.message || row.error || '',
  })), [
    { key: 'account', label: 'ACCOUNT' },
    { key: 'code', label: 'CODE' },
    { key: 'status', label: 'STATUS' },
    { key: 'message', label: 'MESSAGE' },
  ]);
}

export async function run(argv) {
  const action = argv[0];
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    usage();
    return;
  }

  try {
    const services = await loadServices();
    const user = await resolveUser();
    if (action === 'preflight') return await runPreflight(argv, user, services);
    if (action === 'redeem') return await runRedeem(argv, user);
    if (action === 'bulk') return await runBulk(argv, user);
    process.stderr.write(`${c.err('✗')} unknown codes command: ${action}\n`);
    usage();
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}
