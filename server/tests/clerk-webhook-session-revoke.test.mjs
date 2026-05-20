import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
const PRISMA_CLI = fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url));

const ROOT = resolve(import.meta.dirname, '..', '..');
const tempDir = mkdtempSync(join(tmpdir(), 'hydra-webhook-revoke-'));
const dbPath = join(tempDir, 'hydra.db');

process.env.DATABASE_URL = `file:${dbPath}`;
process.env.HYDRA_DATA_DIR = tempDir;
process.env.JWT_SECRET = 'test-webhook-secret-32-chars-long';
process.env.NODE_ENV = 'test';

execFileSync(process.execPath, [PRISMA_CLI,
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
const store = await import('../services/store.js');
const { disconnectPrisma } = await import('../services/db.js');
const webhookRoutes = (await import('../routes/webhooks.js')).default;

function fakeJwt(payload) {
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.sig`;
}

async function startWebhookServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks', webhookRoutes);
  return await new Promise((resolvePromise) => {
    const server = app.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

test.after(async () => {
  await disconnectPrisma();
});

test('Clerk session.revoked webhook clears matching local account session', async () => {
  const token = await auth.signup('1111');
  const user = await auth.validateToken(token);
  const account = await store.addAccountWithCredentials(user.id, 'A1', 'a1@example.com', '', 'otp');

  await store.updateAccountSession(
    user.id,
    account.id,
    fakeJwt({ sid: 'sess_to_revoke', sub: 'user_123' }),
    '__client=client_before_revoke',
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    { isNewLogin: true },
  );

  assert.notEqual((await store.getAccountSession(user.id, account.id)).sessionCookie, '');

  const server = await startWebhookServer();
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/clerk`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'evt-session-revoked-1',
      },
      body: JSON.stringify({
        type: 'session.revoked',
        data: { id: 'sess_to_revoke' },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.action, { type: 'session_revoke', matched: 1, revoked: 1 });
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const session = await store.getAccountSession(user.id, account.id);
  assert.equal(session.sessionCookie, '');
  assert.equal(session.sessionExpiry, null);
});
