// @platform all
/**
 * Electron API integration coverage.
 *
 * This used to silently pass when the server was offline by catching fetch
 * failures and asserting true. Keep this self-contained instead: create a temp
 * SQLite DB, boot the real Express app on port 0, assert concrete HTTP
 * contracts, then shut it down through gracefulShutdown({ exit:false }).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const PRISMA_CLI = fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url));

const dataDir = mkdtempSync(join(tmpdir(), 'hydra-api-integration-'));
const dbPath = join(dataDir, 'hydra.db');

process.env.NODE_ENV = 'test';
process.env.HYDRA_DATA_DIR = dataDir;
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.JWT_SECRET = 'test-api-integration-jwt-secret-32chars';
process.env.HYDRA_DISABLE_PROXY_RATELIMIT = '1';
delete process.env.LOCAL_STORAGE_KEY;
delete process.env.VAULT_KEY;
delete process.env.HYDRA_PROXY_SECRET;

execFileSync(process.execPath, [PRISMA_CLI, 'db', 'push', '--skip-generate'], {
  cwd: fileURLToPath(new URL('../..', import.meta.url)),
  env: process.env,
  stdio: 'pipe',
});

const serverModule = await import('../index.js');
const { recordUpstreamSuccess } = await import('../services/upstream-health.js');
const {
  claimPendingMagicLinkCallback,
  forgetPendingMagicLink,
  getMagicLinkCleanupSnapshot,
  pendingMagicLinkCallbacks,
  pendingMagicLinks,
  startMagicLinkCleanup,
  stopMagicLinkCleanup,
  sweepExpiredMagicLinks,
  trackPendingMagicLink,
} = await import('../services/magic-link-manager.js');
let baseUrl;
let authToken;

before(async () => {
  const server = await serverModule.bootstrap({ port: 0, silent: true });
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'server must bind to a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await serverModule.gracefulShutdown('electron-api-integration-test', { exit: false, timeoutMs: 1000 });
  rmSync(dataDir, { recursive: true, force: true });
});

async function getJson(path, init) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const json = await res.json();
  return { res, json };
}

async function getAuthToken() {
  if (authToken) return authToken;
  const setup = await getJson('/api/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'health-test-pass' }),
  });
  assert.equal(setup.res.status, 200);
  authToken = setup.json.data.token;
  assert.ok(authToken, 'setup must return a bearer token for protected routes');
  return authToken;
}

test('GET /api/auth/status returns setup state from a real server', async () => {
  const { res, json } = await getJson('/api/auth/status');

  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.setup, false);
  assert.equal(json.data.hasUser, false);
  assert.equal(json.data.hasAccounts, false);
  assert.equal(json.data.authenticated, false);
});

test('GET /api/system/health returns real process uptime and server clock facts', async () => {
  const token = await getAuthToken();

  recordUpstreamSuccess({ statusCode: 204 });
  const before = Date.now();
  const { res, json } = await getJson('/api/system/health', {
    headers: { authorization: `Bearer ${token}` },
  });
  const after = Date.now();

  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.equal(typeof json.data.uptime, 'number');
  assert.ok(json.data.uptime >= 0);
  assert.equal(json.data.pid, process.pid);
  assert.equal(json.data.upstream.status, 'online');
  assert.equal(json.data.upstream.lastStatusCode, 204);

  const serverNow = Date.parse(json.data.serverNow);
  const startedAt = Date.parse(json.data.startedAt);
  assert.ok(serverNow >= before && serverNow <= after, 'server clock must be current response time');
  assert.ok(startedAt <= serverNow, 'startedAt must not be after serverNow');

  const derivedStartedAt = serverNow - json.data.uptime * 1000;
  assert.ok(Math.abs(startedAt - derivedStartedAt) < 5, 'startedAt must derive from process.uptime()');
});

test('account proxy pool endpoints store encrypted proxies and return masked public state', async () => {
  const token = await getAuthToken();

  const saved = await getJson('/api/system/account-proxies', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ proxies: '127.0.0.1:8080:user:secret' }),
  });
  assert.equal(saved.res.status, 200);
  assert.equal(saved.json.success, true);
  assert.equal(saved.json.data.count, 1);
  assert.equal(saved.json.data.proxies[0].masked, '127.0.0.1:8080:u**r:s****t');
  assert.equal(saved.json.data.proxies[0].password, undefined);

  const loaded = await getJson('/api/system/account-proxies', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(loaded.res.status, 200);
  assert.equal(loaded.json.data.count, 1);
  assert.equal(loaded.json.data.lines, '127.0.0.1:8080:user:secret');

  const invalid = await getJson('/api/system/account-proxies', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ proxies: '127.0.0.1:99999:user:secret' }),
  });
  assert.equal(invalid.res.status, 400);
  assert.match(invalid.json.error, /Line 1: Proxy port/);
});

test('magic-link capability fails closed unless an allowlisted public HTTPS callback is confirmed', async () => {
  const token = await getAuthToken();
  const previous = process.env.HYDRA_MAGIC_LINK_CALLBACK_ORIGIN;
  const previousConfirmed = process.env.HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED;

  try {
    delete process.env.HYDRA_MAGIC_LINK_CALLBACK_ORIGIN;
    delete process.env.HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED;
    const missing = await getJson('/api/accounts/magic-link/capability', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(missing.res.status, 200);
    assert.equal(missing.json.success, true);
    assert.equal(missing.json.data.available, false);
    assert.equal(missing.json.data.code, 'MAGIC_LINK_CALLBACK_UNAVAILABLE');
    assert.equal(missing.json.data.fallback, 'otp');

    process.env.HYDRA_MAGIC_LINK_CALLBACK_ORIGIN = 'http://127.0.0.1:3001';
    const local = await getJson('/api/accounts/magic-link/capability', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(local.res.status, 200);
    assert.equal(local.json.data.available, false);

    process.env.HYDRA_MAGIC_LINK_CALLBACK_ORIGIN = 'https://hydra.example.test/public';
    const unconfirmed = await getJson('/api/accounts/magic-link/capability', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(unconfirmed.res.status, 200);
    assert.equal(unconfirmed.json.data.available, false);

    process.env.HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED = '1';
    const configured = await getJson('/api/accounts/magic-link/capability', {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(configured.res.status, 200);
    assert.equal(configured.json.data.available, true);
    assert.equal(configured.json.data.callbackOrigin, 'https://hydra.example.test/public');
    assert.equal(configured.json.data.callbackPath, '/api/auth/magic-callback');
  } finally {
    if (previous === undefined) delete process.env.HYDRA_MAGIC_LINK_CALLBACK_ORIGIN;
    else process.env.HYDRA_MAGIC_LINK_CALLBACK_ORIGIN = previous;
    if (previousConfirmed === undefined) delete process.env.HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED;
    else process.env.HYDRA_MAGIC_LINK_CALLBACK_ALLOWLIST_CONFIRMED = previousConfirmed;
  }
});

test('magic-link callback indexes clear together on completion and expiry', () => {
  pendingMagicLinks.clear();
  pendingMagicLinkCallbacks.clear();

  trackPendingMagicLink('signin-expired', {
    linkId: 'callback-expired',
    createdAt: Date.now() - (16 * 60 * 1000),
  });
  assert.equal(pendingMagicLinks.get('signin-expired')?.linkId, 'callback-expired');
  assert.equal(pendingMagicLinkCallbacks.get('callback-expired')?.signInId, 'signin-expired');
  assert.equal(sweepExpiredMagicLinks(), 1);
  assert.equal(pendingMagicLinks.has('signin-expired'), false);
  assert.equal(pendingMagicLinkCallbacks.has('callback-expired'), false);

  trackPendingMagicLink('signin-complete', { linkId: 'callback-complete' });
  assert.equal(claimPendingMagicLinkCallback('callback-complete')?.signInId, 'signin-complete');
  assert.equal(claimPendingMagicLinkCallback('callback-complete'), null);
  forgetPendingMagicLink('signin-complete');
  assert.equal(pendingMagicLinks.has('signin-complete'), false);
  assert.equal(pendingMagicLinkCallbacks.has('callback-complete'), false);
});

test('magic-link cleanup timer disarms after the last pending link is forgotten early', () => {
  stopMagicLinkCleanup();
  pendingMagicLinks.clear();
  pendingMagicLinkCallbacks.clear();
  startMagicLinkCleanup();

  trackPendingMagicLink('signin-early-complete', { linkId: 'callback-early-complete' });
  assert.deepEqual(getMagicLinkCleanupSnapshot(), {
    started: true,
    scheduled: true,
    pending: 1,
    callbacks: 1,
  });

  forgetPendingMagicLink('signin-early-complete');
  assert.deepEqual(getMagicLinkCleanupSnapshot(), {
    started: true,
    scheduled: false,
    pending: 0,
    callbacks: 0,
  });
});

test('bulk OTP stubs reuse saved emails that need sign-in and expose pending rows on the dashboard', async () => {
  const token = await getAuthToken();
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };

  const created = await getJson('/api/accounts/with-credentials', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      alias: 'bulk-duplicate-source',
      email: 'duplicate@example.test',
      authMethod: 'otp',
    }),
  });
  assert.equal(created.res.status, 201);

  const reused = await getJson('/api/accounts/bulk-otp-stubs', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      emails: ['duplicate@example.test', 'fresh@example.test'],
      forceReplace: false,
    }),
  });
  assert.equal(reused.res.status, 201);
  assert.equal(reused.json.success, true);
  const reusedRows = reused.json.data.results;
  assert.equal(reusedRows.length, 2);
  assert.equal(reusedRows.find((row) => row.email === 'duplicate@example.test')?.reused, true);
  assert.equal(reusedRows.find((row) => row.email === 'fresh@example.test')?.success, true);

  const pendingAccounts = await getJson('/api/accounts', { headers });
  assert.equal(
    pendingAccounts.json.data.some((account) => account.email === 'fresh@example.test'),
    false,
    'unfinished OTP stubs stay out of generic account reads',
  );
  const pendingRecoveryAccounts = await getJson('/api/accounts?includePending=true', { headers });
  assert.equal(
    pendingRecoveryAccounts.json.data.some((account) => account.email === 'fresh@example.test'),
    true,
    'OTP recovery reads include unfinished stubs explicitly',
  );

  const dashboard = await getJson('/api/dashboard', { headers });
  assert.equal(dashboard.res.status, 200);
  assert.equal(dashboard.json.success, true);
  const pendingDashboardRow = dashboard.json.data.accounts.find((account) => account.email === 'fresh@example.test');
  assert.equal(pendingDashboardRow?.pendingVerification, true);
  assert.equal(pendingDashboardRow?.status, 'pending');
  assert.deepEqual(pendingDashboardRow?.credits, { total: 0, used: 0, remaining: 0 });
  assert.deepEqual(pendingDashboardRow?.keys, { total: 0, active: 0, disabled: 0, list: [] });

  const replaced = await getJson('/api/accounts/bulk-otp-stubs', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      emails: ['duplicate@example.test'],
      forceReplace: true,
    }),
  });
  assert.equal(replaced.res.status, 201);
  assert.equal(replaced.json.success, true);
  assert.equal(replaced.json.data.results[0].success, true);
  assert.equal(replaced.json.data.results[0].replaced, true);
  assert.equal(replaced.json.data.results[0].account.email, 'duplicate@example.test');
  assert.equal(replaced.json.data.results[0].account.alias, 'bulk-duplicate-source');

  const legacy = await getJson('/api/accounts/with-credentials', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      alias: 'Hydra Account 91',
      email: 'legacy@example.test',
      authMethod: 'otp',
    }),
  });
  assert.equal(legacy.res.status, 201);

  const migrated = await getJson('/api/accounts', { headers });
  assert.equal(migrated.res.status, 200);
  assert.equal(
    migrated.json.data.find((account) => account.email === 'legacy@example.test')?.alias,
    'legacy-example.test',
  );
});

test('protected account routes reject anonymous requests', async () => {
  const { res, json } = await getJson('/api/accounts');

  assert.equal(res.status, 401);
  assert.equal(json.error, 'Not authenticated');
});

test('CORS accepts same-origin/Vite dev origins but not arbitrary loopback ports', async () => {
  const sameOrigin = await fetch(`${baseUrl}/api/auth/status`, {
    headers: { origin: baseUrl },
  });
  assert.equal(sameOrigin.headers.get('access-control-allow-origin'), baseUrl);

  const viteDevOrigin = 'http://localhost:5173';
  const viteDev = await fetch(`${baseUrl}/api/auth/status`, {
    headers: { origin: viteDevOrigin },
  });
  assert.equal(viteDev.headers.get('access-control-allow-origin'), viteDevOrigin);

  const arbitraryLoopback = await fetch(`${baseUrl}/api/auth/status`, {
    headers: { origin: 'http://localhost:65534' },
  });
  assert.equal(arbitraryLoopback.headers.get('access-control-allow-origin'), null);
});

test('proxy routes reject missing Hydra proxy credentials', async () => {
  const { res, json } = await getJson('/v1/models');

  assert.equal(res.status, 401);
  assert.equal(json.error.code, 'invalid_api_key');
});

test('embedded shutdown endpoint requires auth before confirmation token', async () => {
  process.env.HYDRA_EMBEDDED = '1';
  const { res, json } = await getJson('/api/shutdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'SHUTDOWN_HYDRA' }),
  });

  assert.equal(res.status, 401);
  assert.equal(json.error, 'Not authenticated');
});
