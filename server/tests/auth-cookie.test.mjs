import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const validateCalls = [];

mock.module(new URL('../services/auth.js', import.meta.url).href, {
  namedExports: {
    validateToken: async (token) => {
      validateCalls.push(token);
      return token === 'valid-cookie-token' ? { id: 'user-1', username: 'admin' } : null;
    },
  },
});

const {
  AUTH_TOKEN_COOKIE,
  extractAuthToken,
  requireUnlocked,
} = await import('../middleware/auth.js');

test('extractAuthToken prefers Authorization bearer token over cookie', () => {
  const req = {
    headers: {
      authorization: 'Bearer header-token',
      cookie: `${AUTH_TOKEN_COOKIE}=cookie-token`,
    },
  };

  assert.equal(extractAuthToken(req), 'header-token');
});

test('extractAuthToken falls back to hydra_token cookie', () => {
  const req = {
    headers: {
      cookie: `theme=dark; ${AUTH_TOKEN_COOKIE}=cookie-token%2Fwith%2Fchars`,
    },
  };

  assert.equal(extractAuthToken(req), 'cookie-token/with/chars');
});

test('requireUnlocked accepts cookie token', async () => {
  const req = {
    headers: {
      cookie: `${AUTH_TOKEN_COOKIE}=valid-cookie-token`,
    },
  };
  const res = {
    status() {
      throw new Error('status should not be called for a valid cookie token');
    },
  };
  let calledNext = false;

  await requireUnlocked(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.deepEqual(req.user, { id: 'user-1', username: 'admin' });
  assert.equal(validateCalls.at(-1), 'valid-cookie-token');
});
