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
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const PRISMA_CLI = fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url));

const dataDir = mkdtempSync(join(tmpdir(), 'hydra-api-integration-'));
const dbPath = join(dataDir, 'hydra.db');
const upstreamRequests = [];

function sendUpstreamJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readUpstreamBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const upstreamServer = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/api/v1/models') {
    return sendUpstreamJson(res, 200, {
      object: 'list',
      data: [
        {
          id: 'hydra/synthetic-free:free',
          name: 'Hydra Synthetic Free',
          context_length: 8192,
          pricing: {
            prompt: '0.000001',
            completion: '0.000002',
            request: '0',
          },
        },
      ],
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/chat/completions') {
    const body = await readUpstreamBody(req);
    const authorization = String(req.headers.authorization || '');
    upstreamRequests.push({
      authorization,
      model: body?.model,
      path: url.pathname,
    });

    if (body?.model === 'hydra/synthetic-failover' && authorization.includes('sk-or-v1-alpha')) {
      return sendUpstreamJson(res, 429, {
        error: {
          message: 'Synthetic key rate limit exceeded',
          code: 'rate_limit',
        },
      }, {
        'retry-after': '1',
      });
    }

    return sendUpstreamJson(res, 200, {
      id: 'chatcmpl-hydra-synthetic',
      object: 'chat.completion',
      model: body?.model || 'hydra/synthetic-free:free',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
        cost: 0.000009,
      },
    });
  }

  return sendUpstreamJson(res, 404, { error: { message: 'not found' } });
});

await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
const upstreamAddress = upstreamServer.address();
assert.ok(upstreamAddress && typeof upstreamAddress === 'object', 'synthetic upstream must bind to a TCP port');

process.env.NODE_ENV = 'test';
process.env.HYDRA_DATA_DIR = dataDir;
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.JWT_SECRET = 'test-api-integration-jwt-secret-32chars';
process.env.HYDRA_DISABLE_PROXY_RATELIMIT = '1';
process.env.OR_BASE = `http://127.0.0.1:${upstreamAddress.port}`;
delete process.env.LOCAL_STORAGE_KEY;
delete process.env.VAULT_KEY;
delete process.env.HYDRA_PROXY_SECRET;

execFileSync(process.execPath, [PRISMA_CLI, 'db', 'push', '--skip-generate'], {
  cwd: fileURLToPath(new URL('../..', import.meta.url)),
  env: process.env,
  stdio: 'pipe',
});

const serverModule = await import('../index.js');
const { prisma } = await import('../services/db.js');
const { recordUpstreamSuccess } = await import('../services/upstream-health.js');
const {
  flushRequestLogBuffer,
  stopRequestLogBuffer,
} = await import('../services/request-log-buffer.js');
const {
  getMasterProxyKey,
  saveKey,
  updateKeyPooledStatus,
} = await import('../services/store.js');
const { rotationManager } = await import('../services/rotation-manager.js');
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
  await stopRequestLogBuffer();
  await serverModule.gracefulShutdown('electron-api-integration-test', { exit: false, timeoutMs: 1000 });
  await new Promise((resolve, reject) => upstreamServer.close((err) => (err ? reject(err) : resolve())));
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

test('proxy actively rotates pooled keys and traffic logs preserve attempts and pricing', async () => {
  const token = await getAuthToken();
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };

  const accountAlpha = await getJson('/api/accounts/with-credentials', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      alias: 'synthetic-alpha',
      email: 'synthetic-alpha@example.test',
      authMethod: 'otp',
    }),
  });
  assert.equal(accountAlpha.res.status, 201);

  const accountBeta = await getJson('/api/accounts/with-credentials', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      alias: 'synthetic-beta',
      email: 'synthetic-beta@example.test',
      authMethod: 'otp',
    }),
  });
  assert.equal(accountBeta.res.status, 201);

  const user = await prisma.user.findFirst();
  assert.ok(user?.id, 'seeded user must exist before pool setup');

  await saveKey(user.id, accountAlpha.json.data.id, {
    hash: 'hash-alpha-synthetic',
    name: 'alpha synthetic key',
    key: 'sk-or-v1-alpha',
    limit: null,
    limitRemaining: 10,
    isProvisioningKey: false,
  });
  await saveKey(user.id, accountBeta.json.data.id, {
    hash: 'hash-beta-synthetic',
    name: 'beta synthetic key',
    key: 'sk-or-v1-beta',
    limit: null,
    limitRemaining: 10,
    isProvisioningKey: false,
  });
  await updateKeyPooledStatus(user.id, 'hash-alpha-synthetic', true);
  await updateKeyPooledStatus(user.id, 'hash-beta-synthetic', true);
  await prisma.cachedModel.upsert({
    where: { id: 'hydra/synthetic-failover' },
    update: {
      promptPrice: 0.000001,
      completionPrice: 0.000002,
      requestPrice: 0,
    },
    create: {
      id: 'hydra/synthetic-failover',
      name: 'Hydra Synthetic Failover',
      promptPrice: 0.000001,
      completionPrice: 0.000002,
      requestPrice: 0,
    },
  });
  await rotationManager.reload();

  upstreamRequests.length = 0;
  const originalRandom = Math.random;
  Math.random = () => 0;
  let proxyResponse;
  let proxyJson;
  try {
    proxyResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${getMasterProxyKey()}`,
        'content-type': 'application/json',
        'user-agent': 'curl/8.7.1 hydra-integration',
      },
      body: JSON.stringify({
        model: 'hydra/synthetic-failover',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    proxyJson = await proxyResponse.json();
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(proxyResponse.status, 200);
  assert.equal(proxyJson.model, 'hydra/synthetic-failover');
  assert.equal(proxyResponse.headers.get('x-hydra-attempts'), '2');
  assert.equal(proxyResponse.headers.get('x-hydra-rotated'), 'true');
  assert.equal(proxyResponse.headers.get('x-hydra-key-hash'), 'hash-bet');
  assert.deepEqual(
    upstreamRequests.map((request) => request.authorization),
    ['Bearer sk-or-v1-alpha', 'Bearer sk-or-v1-beta'],
  );

  await flushRequestLogBuffer();
  const traffic = await getJson('/api/pool/traffic', { headers });
  assert.equal(traffic.res.status, 200);
  assert.equal(traffic.json.success, true);

  const logs = traffic.json.data.logs.filter((log) => log.model === 'hydra/synthetic-failover');
  const success = logs.find((log) => log.status === 200);
  const rateLimited = logs.find((log) => log.status === 429);
  assert.ok(success, 'successful rotated request must be visible in Traffic logs');
  assert.ok(rateLimited, 'failed first attempt must be visible in Traffic logs');

  assert.equal(success.keyHash, 'hash-beta-synthetic');
  assert.equal(success.key.account.alias, 'synthetic-beta');
  assert.equal(success.attempt, 2);
  assert.equal(success.outcome, 'served');
  assert.equal(success.promptTokens, 2);
  assert.equal(success.completionTokens, 3);
  assert.equal(success.totalCost, 0.000009);
  assert.equal(success.costSource, 'openrouter_usage');
  assert.equal(success.inputCost, 0.000002);
  assert.equal(success.outputCost, 0.000006);
  assert.equal(success.estimatedCost, 0.000008);
  assert.equal(success.pricing.promptPerToken, 0.000001);
  assert.equal(success.pricing.completionPerToken, 0.000002);

  assert.equal(rateLimited.keyHash, 'hash-alpha-synthetic');
  assert.equal(rateLimited.key.account.alias, 'synthetic-alpha');
  assert.equal(rateLimited.attempt, 1);
  assert.equal(rateLimited.outcome, 'key_rate_limited');
  assert.equal(rateLimited.totalCost, null);
  assert.equal(rateLimited.costSource, null);

  assert.equal(traffic.json.data.routing.totalPooled, 2);
  assert.equal(traffic.json.data.routing.activeCooldowns, 1);
  assert.equal(traffic.json.data.routing.available, 1);
  assert.equal(traffic.json.data.routing.maxKeyAttempts, 8);

  rotationManager.cooldowns.clear();
  rotationManager.failureCounts.clear();
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
