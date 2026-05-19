import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const tempDir = mkdtempSync(join(tmpdir(), 'hydra-auth-status-'));
const dbPath = join(tempDir, 'hydra.db');

process.env.DATABASE_URL = `file:${dbPath}`;
process.env.JWT_SECRET = 'test-auth-status-secret-32-chars-long';
process.env.NODE_ENV = 'test';

execFileSync('npx', [
  'prisma',
  'db',
  'push',
  '--skip-generate',
  '--schema',
  resolve(ROOT, 'prisma/schema.prisma'),
], {
  cwd: ROOT,
  env: process.env,
  stdio: 'pipe',
});

const auth = await import('../services/auth.js');
const { disconnectPrisma } = await import('../services/db.js');

test.after(async () => {
  await disconnectPrisma();
});

test('setup status treats local password setup as complete before accounts exist', async () => {
  assert.deepEqual(await auth.getSetupStatus(), {
    setup: false,
    hasUser: false,
    hasAccounts: false,
    needsFirstAccount: false,
    bootstrapRequired: false,
  });

  const token = await auth.signup('1111');
  assert.equal(typeof token, 'string');

  assert.deepEqual(await auth.getSetupStatus(), {
    setup: true,
    hasUser: true,
    hasAccounts: false,
    needsFirstAccount: true,
    bootstrapRequired: false,
  });
});
