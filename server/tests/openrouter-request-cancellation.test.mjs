// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sleepWithSignal } from '../lib/abort.js';
import { getCredits } from '../services/openrouter.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readRepoFile(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('OpenRouter rate-limit retry wait stops immediately when the client disconnects', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  const startedAt = Date.now();

  globalThis.fetch = async () => {
    calls += 1;
    return new Response('', { status: 429 });
  };

  try {
    const request = getCredits('sk-or-v1-test', { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('client disconnected')), 10);

    await assert.rejects(request, /client disconnected/);
    assert.equal(calls, 1, 'abort must prevent the next upstream retry');
    assert.ok(Date.now() - startedAt < 250, 'abort must clear the 500ms retry delay');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shared abort-aware sleep clears an owned timer', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const wait = sleepWithSignal(1000, controller.signal);

  setTimeout(() => controller.abort(new Error('teardown requested')), 10);

  await assert.rejects(wait, /teardown requested/);
  assert.ok(Date.now() - startedAt < 250, 'abort must clear the one-second timer');
});

test('account, code, session, and provisioning paths preserve request ownership', () => {
  const account = readRepoFile('server/controllers/AccountController.js');
  const code = readRepoFile('server/controllers/CodeController.js');
  const dashboardController = readRepoFile('server/controllers/DashboardController.js');
  const dashboardApi = readRepoFile('server/services/dashboard-api.js');
  const clerk = readRepoFile('server/services/clerk-auth.js');
  const debugController = readRepoFile('server/controllers/DebugController.js');
  const generator = readRepoFile('server/services/account-generator.js');
  const managementKeyStore = readRepoFile('server/services/management-key-store.js');
  const modelCache = readRepoFile('server/services/model-cache.js');
  const openrouter = readRepoFile('server/services/openrouter.js');
  const poolController = readRepoFile('server/controllers/PoolController.js');
  const proxy = readRepoFile('server/routes/proxy.js');
  const refresher = readRepoFile('server/services/session-refresher.js');
  const store = readRepoFile('server/services/store.js');

  assert.match(openrouter, /combineAbortSignals\(signal, AbortSignal\.timeout\(timeoutMs\)\)/);
  assert.match(openrouter, /sleepWithSignal\(RETRY_DELAYS\[attempt\] \|\| 2000, signal\)/);

  assert.match(account, /bindRequestAbort\(req, res, 'account password login request'\)/);
  assert.match(account, /bindRequestAbort\(req, res, 'account OTP verify request'\)/);
  assert.match(account, /bindRequestAbort\(req, res, 'account magic-link request'\)/);
  assert.match(account, /bindRequestAbort\(req, res, 'live session probe request'\)/);
  assert.match(account, /createManagementKey\(req\.user\.id, account\.id, undefined, \{ signal \}\)/);
  assert.match(code, /bindRequestAbort\(req, res, 'code redemption request'\)/);
  assert.match(code, /redeemCode\(req\.user\.id, accountId, code, \{ signal: requestAbort\.signal \}\)/);
  assert.match(code, /redeemCode\(req\.user\.id, accountId, code, \{ signal \}\)/);
  assert.match(dashboardController, /refreshSession\(refreshInput, account\.sessionCookie, \{\s*signal: requestAbort\.signal,/);
  assert.match(debugController, /bindRequestAbort\(req, res, 'debug tRPC probe request'\)/);
  assert.match(debugController, /await sleepWithSignal\(200, requestAbort\.signal\)/);

  assert.match(clerk, /CLERK_REQUEST_TIMEOUT_MS = 15_000/);
  assert.match(clerk, /sleepWithSignal\(ms, signal\)/);
  assert.match(clerk, /refreshSession\(clientCookie, sessionCookie, \{ signal = null \} = \{\}\)/);
  assert.match(store, /probeSessionLive\(userId, id, \{ signal = null \} = \{\}\)/);

  assert.match(dashboardApi, /getFreshJwt\(sessionCookie, clientCookie, \{ signal = null \} = \{\}\)/);
  assert.match(dashboardApi, /discoverServerActionHashes\(pageUrl, accountProxy = null, signal = null\)/);
  assert.match(dashboardApi, /selfHealHash\(kind, testUrl, baseHeaders, body, accountProxy = null, signal = null\)/);
  assert.match(dashboardApi, /createManagementKey\(userId, accountId, keyName = 'Hydra Auto Key', \{ signal = null \} = \{\}\)/);
  assert.match(dashboardApi, /Provision abort context close failed/);
  assert.match(dashboardApi, /Redeem abort browser close failed/);
  assert.match(dashboardApi, /getUserProfile\(sessionCookie, clientCookie, \{ signal = null \} = \{\}\)/);

  assert.match(generator, /const signal = task\.abortController\.signal/);
  assert.match(generator, /completeEmailOTP\(signInId, otpCode, clientCookie, \{ isSignUp, signal \}\)/);
  assert.match(generator, /await sleepWithSignal\(1000, signal\)/);
  assert.match(generator, /`Hydra Gen \$\{accountAlias\}`,\s*\{ signal \},/);
  assert.doesNotMatch(generator, /new Promise\(r => setTimeout\(r, 1000\)\)/);

  assert.match(refresher, /_lifecycleController\?\.abort\(new Error\('Session refresher shutdown requested'\)\)/);
  assert.match(refresher, /refreshSession\(entry\.cookie, sessionCookie, \{ signal \}\)/);
  assert.match(refresher, /refreshSession\(cookieStack, rawJwt, \{ signal \}\)/);
  assert.match(refresher, /await _sessionProbePromise/);

  assert.match(modelCache, /fetchOpenRouterModelsList\(apiKey, \{ signal = null \} = \{\}\)/);
  assert.match(modelCache, /combineAbortSignals\(signal, AbortSignal\.timeout\(MODEL_LIST_TIMEOUT_MS\)\)/);
  assert.match(poolController, /fetchOpenRouterModelsList\(apiKey, \{ signal: requestAbort\.signal \}\)/);
  assert.match(proxy, /fetchOpenRouterModelsList\(keyEntry\.keyString, \{ signal: requestAbort\.signal \}\)/);
  assert.match(managementKeyStore, /createManagementKey\(deviceId, accountId, name, \{ signal \}\)/);
});
