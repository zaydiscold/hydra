// Keep Prisma's SQLite schema engine reliable on macOS hosts where it can
// otherwise exit with an empty "Schema engine error". See prisma/orm#29355.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prisma = resolve(root, 'node_modules/prisma/build/index.js');
const env = { ...process.env, RUST_LOG: 'info' };

for (const args of [['db', 'push', '--skip-generate'], ['generate']]) {
  execFileSync(process.execPath, [prisma, ...args], { cwd: root, env, stdio: 'inherit' });
}
