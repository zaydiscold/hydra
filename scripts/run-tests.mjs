// Run the normal test chain with Prisma's macOS SQLite workaround inherited
// by every child process. The command is fixed by package.json, not user input.
import { spawnSync } from 'node:child_process';

const [, , command, action, script] = process.argv;
if (command !== 'npm' || action !== 'run' || script !== 'test:chain') {
  throw new Error('Expected: node scripts/run-tests.mjs npm run test:chain');
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm test');
const result = spawnSync(process.execPath, [npmCli, 'run', 'test:chain'], {
  env: { ...process.env, RUST_LOG: 'info' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
