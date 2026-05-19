/**
 * `hydra unlock` — local password login for CLI/server lifecycle operations.
 */
import { stdin as input } from 'node:process';
import { c, json, status } from '../lib/output.js';
import { loadServices, shutdown } from '../lib/services.js';

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function valueAfter(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

function maskToken(token) {
  if (!token || token.length < 16) return 'issued';
  return `${token.slice(0, 12)}...${token.slice(-8)}`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of input) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8').trim();
}

function usage() {
  process.stdout.write(`Hydra unlock

  hydra unlock --password <password>
  HYDRA_PASSWORD=<password> hydra unlock --json
  printf '%s' "$HYDRA_PASSWORD" | hydra unlock --stdin --token-only

Verifies the local Hydra password and issues a bearer token for locked local
server endpoints such as hydra stop. Passwords are never printed.
`);
}

export async function run(argv) {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    return;
  }

  const wantJson = hasFlag(argv, '--json');
  const tokenOnly = hasFlag(argv, '--token-only');
  let password = valueAfter(argv, '--password') || process.env.HYDRA_PASSWORD || '';
  if (!password && hasFlag(argv, '--stdin')) password = await readStdin();

  if (!password) {
    const report = {
      ok: false,
      error: 'PASSWORD_REQUIRED',
      hint: 'Pass --password <password>, set HYDRA_PASSWORD, or pipe the password with --stdin.',
    };
    if (wantJson) json(report);
    else {
      status('err', 'Hydra password is required.');
      process.stderr.write(`Fix: ${report.hint}\n`);
    }
    process.exitCode = 2;
    return;
  }

  try {
    await loadServices();
    const { login } = await import('../../server/services/auth.js');
    const token = await login(password);
    const report = {
      ok: true,
      token,
      tokenType: 'Bearer',
      env: `HYDRA_TOKEN=${token}`,
      usage: 'HYDRA_TOKEN=<token> hydra stop',
    };

    if (tokenOnly) {
      process.stdout.write(`${token}\n`);
      return;
    }
    if (wantJson) {
      json(report);
      return;
    }

    process.stdout.write(`${c.bold('Hydra unlocked')}\n\n`);
    process.stdout.write(`  ${c.dim('Token:')} ${maskToken(token)}\n`);
    process.stdout.write(`  ${c.dim('Use:')}   HYDRA_TOKEN=<token> hydra stop\n\n`);
    status('ok', 'Bearer token issued. Use --json or --token-only when piping.');
  } catch (err) {
    const report = {
      ok: false,
      error: err.message || 'Unlock failed',
    };
    if (wantJson) json(report);
    else status('err', report.error);
    process.exitCode = 2;
  } finally {
    await shutdown();
  }
}
