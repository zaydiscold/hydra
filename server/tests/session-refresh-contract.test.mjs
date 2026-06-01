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
  assert.match(storeSrc, /refreshSession\(cookieInput,\s*sessionCookie,\s*\{ signal \}\)/);
  assert.match(
    storeSrc,
    /if\s*\(result\s*&&\s*userId\s*&&\s*accountId\)\s*\{[\s\S]*updateAccountSession\([\s\S]*result\.clientCookie[\s\S]*result\.sessionExpiry/s,
    'getSessionStatusAsync must persist fresh cookies and expiry returned by refreshSession',
  );
});

test('forced live session probes expose an observation timestamp separately from historical login age', () => {
  const storeSrc = read('server/services/store.js');
  const accountController = read('server/controllers/AccountController.js');
  const sessionCli = read('bin/commands/session.js');

  assert.match(storeSrc, /observedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(storeSrc, /await updateAccountSession\(/);
  assert.match(storeSrc, /const refreshedAccount = await prisma\.account\.findFirst/);
  assert.match(storeSrc, /sessionRefreshedAt:\s*refreshedConfig\.sessionRefreshedAt/);
  assert.match(accountController, /observedAt:\s*payload\.observedAt/);
  assert.match(accountController, /sessionRefreshedAt:\s*payload\.sessionRefreshedAt/);
  assert.match(sessionCli, /report\.observedAt = live\.observedAt \?\? new Date\(\)\.toISOString\(\)/);
  assert.match(sessionCli, /report\.sessionRefreshedAt = live\.sessionRefreshedAt \|\| report\.sessionRefreshedAt/);
  assert.match(sessionCli, /Observed at:/);
});

test('cookie stack helpers keep newest device identities first and cap stored history', () => {
  const storeSrc = read('server/services/store.js');

  assert.match(storeSrc, /const MAX_STACKED_CLIENT_COOKIES\s*=\s*25/);
  assert.match(storeSrc, /function clientCookieIdentity\(cookie\)/);
  assert.match(storeSrc, /clerkFapiDeviceCookieHeader\(cookie\) \|\| cookie/);
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
  const appended = store.appendClientCookie(
    [
      { cookie: ' stale ', issuedAt: 'old' },
      { cookie: 'stale', issuedAt: 'dup' },
      { cookie: 'undefined', issuedAt: 'bad' },
    ],
    ' fresh ',
  );
  assert.deepEqual(appended.map((entry) => entry.cookie), ['fresh', 'stale']);

  const pruned = store.removeDeadClientCookies(
    [
      { cookie: '__client=device-a; __cf_bm=old', issuedAt: 'old' },
      { cookie: '__client=device-b; __cf_bm=keep', issuedAt: 'keep' },
    ],
    [{ cookie: '__client=device-a; __cf_bm=newer', issuedAt: 'dead' }],
  );
  assert.deepEqual(pruned.map((entry) => entry.cookie), ['__client=device-b; __cf_bm=keep']);

  const equivalentDashboardSnapshots = store.normalizeClientCookies({
    clientCookies: [
      { cookie: '__client=device-a; __cf_bm=latest', issuedAt: 'latest' },
      { cookie: '__client=device-a; __cf_bm=stale', issuedAt: 'stale' },
      { cookie: '__client=device-b; __cf_bm=other', issuedAt: 'other' },
    ],
  });
  assert.deepEqual(
    equivalentDashboardSnapshots.map((entry) => entry.cookie),
    ['__client=device-a; __cf_bm=latest', '__client=device-b; __cf_bm=other'],
  );
  const replacedDashboardSnapshot = store.appendClientCookie(
    equivalentDashboardSnapshots,
    '__client=device-a; __cf_bm=newest',
  );
  assert.deepEqual(
    replacedDashboardSnapshot.map((entry) => entry.cookie),
    ['__client=device-a; __cf_bm=newest', '__client=device-b; __cf_bm=other'],
  );
});

test('OTP method aliases stay compatible with legacy email_otp vault rows', async () => {
  const { isOtpAuthMethod } = await import('../utils/auth-method.js');

  assert.equal(isOtpAuthMethod('otp'), true);
  assert.equal(isOtpAuthMethod('email'), true);
  assert.equal(isOtpAuthMethod('email_otp'), true);
  assert.equal(isOtpAuthMethod('password'), false);

  const files = [
    'server/services/store.js',
    'server/services/dashboard-api.js',
    'bin/commands/session.js',
    'bin/commands/scan.js',
    'src/components/LoginAccountModal.jsx',
    'src/hooks/useBulkAuth.js',
  ];
  for (const file of files) {
    assert.match(read(file), /isOtpAuthMethod/, `${file} must use shared OTP alias recognition`);
  }
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

test('refresh controllers prune dead Clerk identities through the shared store helper', () => {
  const accountController = read('server/controllers/AccountController.js');
  const dashboardController = read('server/controllers/DashboardController.js');

  assert.match(accountController, /store\.removeDeadClientCookies\(session\.clientCookies, refreshed\.deadClientCookies\)/);
  assert.doesNotMatch(accountController, /function pruneDeadClientCookies/);
  assert.match(dashboardController, /store\.removeDeadClientCookies\(stackedCookies, refreshed\.deadClientCookies\)/);
  assert.doesNotMatch(dashboardController, /const deadSet = new Set\(refreshed\.deadClientCookies/);
});

test('metadata-only session writes do not masquerade as silent renewal', () => {
  const accountController = read('server/controllers/AccountController.js');
  const dashboardApi = read('server/services/dashboard-api.js');
  const refresher = read('server/services/session-refresher.js');

  assert.match(accountController, /updateAccountSession\(req\.user\.id, req\.params\.id, null, null, null, \{\s*replaceClientCookies: \[\],\s*markSessionRefreshed: false/);
  assert.match(accountController, /account\.sessionCookie,\s*result\.clientCookie,\s*sessionExpiry,\s*\{ markSessionRefreshed: false \}/);
  assert.match(accountController, /updateAccountSession\(req\.user\.id, req\.params\.id, null, err\.clientCookie, null, \{\s*markSessionRefreshed: false/);
  assert.match(accountController, /preserveSessionToken: true,\s*markSessionRefreshed: false/);
  assert.match(dashboardApi, /undefined, undefined, derivedExpiry, \{\s*preserveSessionToken: true,\s*markSessionRefreshed: false/);
  assert.match(refresher, /freshClientCookie,\s*null, \/\/ don't update session expiry again\s*\{\s*preserveSessionToken: true,\s*markSessionRefreshed: false/);
});

test('debug tRPC probes serialize normalized dashboard device cookies', () => {
  const debugController = read('server/controllers/DebugController.js');

  assert.match(debugController, /openRouterDashboardDeviceCookies/);
  assert.match(debugController, /clerkFapiDeviceCookieHeader/);
  assert.match(debugController, /function dashboardCookieHeader\(sessionCookie, clientCookie/);
  assert.match(debugController, /let clientCookie = session\.clientCookie/);
  assert.match(debugController, /clientCookie = refreshed\.clientCookie \?\? clientCookie/);
  assert.doesNotMatch(debugController, /__client=\$\{clientCookie\}/);
});

test('dashboard API normalizes Clerk and OpenRouter cookie headers instead of replaying raw clientCookie strings', () => {
  const dashboardApi = read('server/services/dashboard-api.js');

  assert.match(dashboardApi, /clerkFapiDeviceCookieHeader/);
  assert.match(dashboardApi, /function clerkClientCookieHeader\(sessionCookie, clientCookie\)/);
  assert.match(dashboardApi, /function dashboardCookieHeader\(sessionCookie, clientCookie\)/);
  assert.match(dashboardApi, /const cookieHeader = clerkClientCookieHeader\(sessionCookie, clientCookie\)/);
  assert.match(dashboardApi, /const cookieHeader = dashboardCookieHeader\(jwtToUse, clientCookie\)/);
  assert.doesNotMatch(dashboardApi, /['"]Cookie['"]:\s*clientCookie/);
  assert.doesNotMatch(dashboardApi, /`__session=\$\{sessionCookie\}; \$\{clientCookie\}`/);
});

test('redeem readiness considers stacked Clerk client cookies before legacy scalar state', () => {
  const dashboardApi = read('server/services/dashboard-api.js');

  assert.match(
    dashboardApi,
    /session\.clientCookies\?\.find\(\(entry\) => String\(entry\?\.cookie \|\| ''\)\.trim\(\)\)\?\.cookie\?\.trim\(\)[\s\S]*\|\| session\.clientCookie\?\.trim\(\)/,
  );
});

test('API-key Playwright fallback injects real browser cookie objects, not a serialized header string', () => {
  const dashboardApi = read('server/services/dashboard-api.js');

  assert.match(dashboardApi, /await context\.addCookies\(await playwrightCookiesForOpenRouter\(sessionCookie, clientCookie\)\)/);
  assert.doesNotMatch(dashboardApi, /openRouterDashboardDeviceCookies\(sessionCookie,\s*clientCookie\)/);
  assert.doesNotMatch(dashboardApi, /cookies\.map\(\(\[name, value\]\)/);
});

test('getFreshJwt sends normalized Clerk FAPI cookies for legacy raw client values', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          response: {
            sessions: [
              { last_active_token: { jwt: 'fresh-jwt-from-clerk' } },
            ],
          },
        };
      },
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const spec = `${new URL('../services/dashboard-api.js', import.meta.url).href}?fresh-jwt-cookie-test=${Date.now()}`;
  const { getFreshJwt } = await import(spec);

  const token = await getFreshJwt('session-cookie-for-runtime-test', 'raw-client-token');

  assert.equal(token, 'fresh-jwt-from-clerk');
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].options.headers.Cookie,
    '__session=session-cookie-for-runtime-test; __client=raw-client-token',
  );
});
