// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getUpstreamHealth,
  recordUpstreamFailure,
  recordUpstreamHttpResult,
  recordUpstreamSuccess,
  resetUpstreamHealthForTest,
  shouldProbeUpstream,
} from '../services/upstream-health.js';

test.beforeEach(() => {
  resetUpstreamHealthForTest();
});

test('upstream health starts unknown', () => {
  assert.deepEqual(getUpstreamHealth(), {
    status: 'unknown',
    checkedAt: null,
    lastOnlineAt: null,
    lastErrorAt: null,
    lastError: null,
    consecutiveFailures: 0,
  });
});

test('records successful OpenRouter reachability', () => {
  recordUpstreamSuccess({ statusCode: 429 });

  const health = getUpstreamHealth();
  assert.equal(health.status, 'online');
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastError, null);
  assert.equal(health.lastStatusCode, 429);
  assert.match(health.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(health.lastOnlineAt, health.checkedAt);
});

test('classifies OpenRouter HTTP status without painting 5xx green', () => {
  assert.equal(recordUpstreamHttpResult({ statusCode: 429 }), true);
  assert.equal(getUpstreamHealth().status, 'online');

  assert.equal(recordUpstreamHttpResult({ statusCode: 502, source: 'OpenRouter test probe' }), false);

  const health = getUpstreamHealth();
  assert.equal(health.status, 'offline');
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastStatusCode, 502);
  assert.equal(health.lastError, 'OpenRouter test probe returned HTTP 502');
});

test('records failed OpenRouter reachability', () => {
  recordUpstreamFailure(new Error('fetch failed'));
  recordUpstreamFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }));

  const health = getUpstreamHealth();
  assert.equal(health.status, 'offline');
  assert.equal(health.consecutiveFailures, 2);
  assert.equal(health.lastError, 'OpenRouter connectivity check timed out');
  assert.match(health.lastErrorAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('marks stale online state as unknown without losing evidence', () => {
  recordUpstreamSuccess({ statusCode: 200 });
  const fresh = getUpstreamHealth({ staleAfterMs: 1_000, now: Date.now() });
  const stale = getUpstreamHealth({
    staleAfterMs: 1_000,
    now: Date.parse(fresh.checkedAt) + 2_000,
  });

  assert.equal(stale.status, 'unknown');
  assert.equal(stale.stale, true);
  assert.equal(stale.lastOnlineAt, fresh.lastOnlineAt);
});

test('requests a probe only after the minimum interval', () => {
  assert.equal(shouldProbeUpstream(), true);
  recordUpstreamSuccess({ statusCode: 200 });

  const checkedAt = Date.parse(getUpstreamHealth().checkedAt);
  assert.equal(shouldProbeUpstream({ minIntervalMs: 60_000, now: checkedAt + 30_000 }), false);
  assert.equal(shouldProbeUpstream({ minIntervalMs: 60_000, now: checkedAt + 61_000 }), true);
});
