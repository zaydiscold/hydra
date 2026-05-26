// @platform all
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  extractAuthTokenCandidates,
  setAuthTokenCookie,
  clearAuthTokenCookie,
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

test('extractAuthTokenCandidates keeps bearer first but preserves cookie fallback', () => {
  const req = {
    headers: {
      authorization: 'Bearer stale-header-token',
      cookie: `${AUTH_TOKEN_COOKIE}=valid-cookie-token`,
    },
  };

  assert.deepEqual(extractAuthTokenCandidates(req), ['stale-header-token', 'valid-cookie-token']);
});

test('extractAuthToken falls back to hydra_token cookie', () => {
  const req = {
    headers: {
      cookie: `theme=dark; ${AUTH_TOKEN_COOKIE}=cookie-token%2Fwith%2Fchars`,
    },
  };

  assert.equal(extractAuthToken(req), 'cookie-token/with/chars');
});

test('malformed cookie encoding does not throw during token extraction', () => {
  const req = {
    headers: {
      cookie: `${AUTH_TOKEN_COOKIE}=bad%ZZtoken`,
    },
  };

  assert.equal(extractAuthToken(req), 'bad%ZZtoken');
});

test('requireUnlocked rejects malformed cookie tokens as normal auth misses', async () => {
  const req = {
    headers: {
      cookie: `${AUTH_TOKEN_COOKIE}=bad%ZZtoken`,
    },
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let calledNext = false;

  await requireUnlocked(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Not authenticated' });
  assert.equal(validateCalls.at(-1), 'bad%ZZtoken');
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

test('requireUnlocked falls back to valid HttpOnly cookie when bearer token is stale', async () => {
  const req = {
    headers: {
      authorization: 'Bearer stale-header-token',
      cookie: `${AUTH_TOKEN_COOKIE}=valid-cookie-token`,
    },
  };
  const res = {
    status() {
      throw new Error('status should not be called when cookie fallback authenticates');
    },
  };
  let calledNext = false;

  await requireUnlocked(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.deepEqual(req.user, { id: 'user-1', username: 'admin' });
  assert.deepEqual(validateCalls.slice(-2), ['stale-header-token', 'valid-cookie-token']);
});

test('auth token cookie is HttpOnly and scoped to same-site localhost routes', () => {
  const calls = [];
  const res = {
    cookie(name, value, options) {
      calls.push({ type: 'set', name, value, options });
    },
    clearCookie(name, options) {
      calls.push({ type: 'clear', name, options });
    },
  };

  setAuthTokenCookie(res, 'server-token');
  clearAuthTokenCookie(res);

  assert.deepEqual(calls[0], {
    type: 'set',
    name: AUTH_TOKEN_COOKIE,
    value: 'server-token',
    options: {
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
    },
  });
  assert.deepEqual(calls[1], {
    type: 'clear',
    name: AUTH_TOKEN_COOKIE,
    options: {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
    },
  });
});

test('logout route clears HttpOnly cookies even after token expiry', () => {
  const routeSource = readFileSync(resolve(import.meta.dirname, '../routes/auth.js'), 'utf8');

  assert.match(routeSource, /router\.post\('\/logout', AuthController\.logout\.bind\(AuthController\)\)/);
  assert.doesNotMatch(routeSource, /router\.post\('\/logout', requireUnlocked/);
});
