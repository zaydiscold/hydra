// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

test('refresh entrypoints pass stacked clientCookies before legacy clientCookie', () => {
  const files = [
    'server/services/dashboard-api.js',
    'server/controllers/AccountController.js',
    'server/controllers/DashboardController.js',
    'server/controllers/DebugController.js',
  ];

  for (const file of files) {
    const src = read(file);
    assert.match(
      src,
      /clientCookies\?\.(?:length|length\s*>\s*0)|normalizeClientCookies|stackedCookies/,
      `${file} must consider the stacked clientCookies field`,
    );
    assert.match(
      src,
      /refreshSession\([\s\S]{0,140}(?:clientCookies|cookieInput|refreshInput|stackedCookies)/,
      `${file} must pass stacked cookies into refreshSession`,
    );
  }
});

test('session status probes persist fresh Clerk client cookies after live refresh', () => {
  const storeSrc = read('server/services/store.js');

  assert.match(storeSrc, /const cookieStack\s*=\s*normalizeClientCookies\(config\)/);
  assert.match(storeSrc, /refreshSession\(cookieInput,\s*sessionCookie\)/);
  assert.match(
    storeSrc,
    /if\s*\(result\s*&&\s*userId\s*&&\s*accountId\)\s*\{[\s\S]*updateAccountSession\([\s\S]*result\.clientCookie[\s\S]*result\.sessionExpiry/s,
    'getSessionStatusAsync must persist fresh cookies and expiry returned by refreshSession',
  );
});

test('cookie stack helpers keep newest cookies first and cap stored history', () => {
  const storeSrc = read('server/services/store.js');

  assert.match(storeSrc, /const MAX_STACKED_CLIENT_COOKIES\s*=\s*25/);
  assert.match(storeSrc, /stack\.unshift\(\{\s*cookie:\s*trimmed,\s*issuedAt:/);
  assert.match(storeSrc, /return stack\.slice\(0,\s*MAX_STACKED_CLIENT_COOKIES\)/);
  assert.match(storeSrc, /config\.clientCookie\s*=\s*config\.clientCookies\[0\]\?\.cookie/);
});

test('cookie stack normalization is bounded and legacy-compatible', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'hydra-cookie-stack-test-'));
  process.env.DATABASE_URL = `file:${join(tempDir, 'hydra.db')}`;
  process.env.HYDRA_DATA_DIR = tempDir;
  process.env.JWT_SECRET = 'cookie-stack-test-secret-32-chars';
  process.env.NODE_ENV = 'test';

  const store = await import('../services/store.js');
  const overLimit = Array.from({ length: 30 }, (_, i) => ({ cookie: `cookie-${i}`, issuedAt: `t-${i}` }));
  const normalized = store.normalizeClientCookies({
    clientCookies: [
      { cookie: ' newest ', issuedAt: 'now' },
      { cookie: 'newest', issuedAt: 'duplicate' },
      { cookie: 'undefined', issuedAt: 'bad' },
      { cookie: '', issuedAt: 'empty' },
      ...overLimit,
    ],
    clientCookie: 'legacy-fallback',
  });

  assert.equal(normalized[0].cookie, 'newest');
  assert.equal(normalized.length, 25);
  assert.equal(normalized.filter((entry) => entry.cookie === 'newest').length, 1);
  assert.equal(normalized.some((entry) => entry.cookie === 'undefined' || entry.cookie === ''), false);
  assert.equal(store.getLatestClientCookie({ clientCookies: [{ cookie: 'stack-only', issuedAt: 'now' }] }), 'stack-only');
  const legacy = store.normalizeClientCookies({ clientCookie: ' legacy-only ', clientCookieIssuedAt: 'legacy-issued' });
  assert.deepEqual(legacy, [{ cookie: 'legacy-only', issuedAt: 'legacy-issued' }]);
});

test('session controllers use the normalized latest cookie, not only legacy clientCookie', () => {
  const storeSrc = read('server/services/store.js');
  const accountController = read('server/controllers/AccountController.js');

  assert.match(storeSrc, /clientCookie:\s*latestClientCookie/);
  assert.match(accountController, /function latestClientCookie\(session\)/);
  assert.match(accountController, /function hasRefreshCookie\(session\)/);
  assert.match(accountController, /const storedClient = latestClientCookie\(accountSession\)/);
  assert.match(accountController, /completeEmailOTP\(signInId, code, storedClient/);
  assert.match(accountController, /if \(!hasRefreshCookie\(session\)\)/);
  assert.doesNotMatch(accountController, /if \(!session\.clientCookie\)/);
});
