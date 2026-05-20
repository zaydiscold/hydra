// @platform all
/**
 * Regression: vault rows with __session JWT but sessionExpiry null must not be treated as dead.
 * ensureSession / preflight use sessionExpiry || getJwtExpiry(sessionCookie) before isSessionValid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { getJwtExpiry, isSessionValid } from '../services/clerk-auth.js';

test('isSessionValid rejects missing expiry', () => {
  assert.equal(isSessionValid(null), false);
  assert.equal(isSessionValid(undefined), false);
  assert.equal(isSessionValid(''), false);
});

test('effective expiry null || getJwtExpiry(jwt) is valid when exp is far future', () => {
  const sessionCookie = jwt.sign({ sub: 'acct_test' }, 'unit-test-secret', { expiresIn: '2h' });
  const sessionExpiry = null;
  const effective = sessionExpiry || getJwtExpiry(sessionCookie);
  assert.equal(typeof effective, 'string');
  assert.equal(isSessionValid(effective), true);
});

test('getJwtExpiry returns ISO string for minted three-segment JWT', () => {
  const sessionCookie = jwt.sign({ foo: 1 }, 'x', { expiresIn: '90m' });
  const iso = getJwtExpiry(sessionCookie);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotThrow(() => new Date(iso).getTime());
});
