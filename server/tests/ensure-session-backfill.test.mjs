// @platform all
/**
 * Integration-style test: ensureSession first branch with vault-shaped session
 * (__session JWT present, sessionExpiry null) backfills without refresh/validate network.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { getJwtExpiry } from '../services/clerk-auth.js';

const STORE_SPEC = new URL('../services/store.js', import.meta.url).href;

/** Mirrors `store.resolveEffectiveSessionExpiry` for the mock (keep in sync with store.js). */
function resolveEffectiveSessionExpiry(config, sessionTokenPlain) {
  const plain = sessionTokenPlain != null ? String(sessionTokenPlain) : '';
  let jwtExp = null;
  if (plain.trim()) jwtExp = getJwtExpiry(plain);
  const stored = config.sessionExpiry;
  if (jwtExp && stored) {
    const a = new Date(jwtExp).getTime();
    const b = new Date(stored).getTime();
    if (Number.isNaN(a)) return stored;
    if (Number.isNaN(b)) return jwtExp;
    return new Date(Math.min(a, b)).toISOString();
  }
  return jwtExp || stored || null;
}

test('ensureSession backfills null sessionExpiry when JWT is still valid', async () => {
  const sessionCookie = jwt.sign({ sub: 'vault_row_test' }, 'ensure-session-test-secret', { expiresIn: '2h' });
  const updateAccountSession = mock.fn(async () => {});

  mock.module(STORE_SPEC, {
    namedExports: {
      resolveEffectiveSessionExpiry,
      getAccountWithKey: mock.fn(async () => ({
        email: 'otp-only@example.test',
        password: '',
        authMethod: 'otp',
      })),
      getAccountSession: mock.fn(async () => ({
        sessionCookie,
        sessionExpiry: null,
        clientCookie: '__client=mock',
      })),
      updateAccountSession,
    },
  });

  const { ensureSession } = await import('../services/dashboard-api.js');

  const out = await ensureSession('user-test', 'account-test');

  assert.equal(out.sessionCookie, sessionCookie);
  assert.equal(out.clientCookie, '__client=mock');
  assert.equal(updateAccountSession.mock.calls.length, 1);
  const [, , persistedCookie, persistedClient, persistedExpiry] = updateAccountSession.mock.calls[0].arguments;
  assert.equal(persistedCookie, sessionCookie);
  assert.equal(persistedClient, '__client=mock');
  assert.match(String(persistedExpiry), /^\d{4}-\d{2}-\d{2}T/);
});
