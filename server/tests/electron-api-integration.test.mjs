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

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
  cwd: join(new URL('../..', import.meta.url).pathname),
  env: process.env,
  stdio: 'pipe',
});

const serverModule = await import('../index.js');
const { recordUpstreamSuccess } = await import('../services/upstream-health.js');
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
