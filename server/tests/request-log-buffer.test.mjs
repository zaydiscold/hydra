// @platform all
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let createdRows = [];
let createError = null;
let fallbackError = null;
const warnings = [];
const errors = [];

const fakeRequestLog = {
  create: mock.fn(async ({ data }) => {
    if (data.keyHash && createError) throw createError;
    if (!data.keyHash && fallbackError) throw fallbackError;
    createdRows.push(data);
    return { id: `log-${createdRows.length}`, ...data };
  }),
};

mock.module(new URL('../services/db.js', import.meta.url).href, {
  namedExports: {
    prisma: {
      requestLog: fakeRequestLog,
    },
  },
});

mock.module(new URL('../services/logger.js', import.meta.url).href, {
  namedExports: {
    logger: {
      warn: (message) => warnings.push(String(message)),
      error: (message) => errors.push(String(message)),
    },
  },
});

const {
  enqueueRequestLog,
  flushRequestLogBuffer,
  getRequestLogBufferSnapshot,
  stopRequestLogBuffer,
} = await import('../services/request-log-buffer.js');

test.afterEach(async () => {
  createError = null;
  fallbackError = null;
  createdRows = [];
  warnings.length = 0;
  errors.length = 0;
  await stopRequestLogBuffer();
  fakeRequestLog.create.mock.resetCalls();
});

test('request-log buffer batches proxy log writes off the hot path', async () => {
  const accepted = enqueueRequestLog({
    keyHash: 'hash-1',
    model: 'openai/gpt-4o-mini',
    status: 200,
    latencyMs: 42,
    tokens: { prompt_tokens: 10, completion_tokens: 20 },
    clientHint: 'cursor',
  });

  assert.equal(accepted, true);
  assert.equal(getRequestLogBufferSnapshot().queued, 1);
  assert.equal(createdRows.length, 0, 'enqueue should not synchronously write SQLite rows');

  await flushRequestLogBuffer();

  assert.deepEqual(createdRows, [{
    keyHash: 'hash-1',
    model: 'openai/gpt-4o-mini',
    status: 200,
    latencyMs: 42,
    clientHint: 'cursor',
    promptTokens: 10,
    completionTokens: 20,
  }]);
  assert.equal(getRequestLogBufferSnapshot().queued, 0);
});

test('request-log buffer falls back to null keyHash for stale key references', async () => {
  createError = new Error('foreign key mismatch');

  enqueueRequestLog({
    keyHash: 'stale-key',
    model: 'anthropic/claude-sonnet-4-5',
    status: 429,
    latencyMs: 99,
  });

  await flushRequestLogBuffer();

  assert.equal(fakeRequestLog.create.mock.callCount(), 2);
  assert.equal(createdRows.length, 1);
  assert.equal(createdRows[0].keyHash, null);
  assert.equal(createdRows[0].model, 'anthropic/claude-sonnet-4-5');
});

test('request-log buffer is bounded and reports dropped rows', () => {
  let accepted = 0;
  for (let i = 0; i < 2100; i += 1) {
    if (enqueueRequestLog({
      keyHash: null,
      model: 'load-test',
      status: 200,
      latencyMs: i,
    })) {
      accepted += 1;
    }
  }

  const snapshot = getRequestLogBufferSnapshot();
  assert.equal(accepted, snapshot.maxQueue);
  assert.equal(snapshot.queued, snapshot.maxQueue);
  assert.ok(snapshot.dropped > 0);
  assert.ok(warnings.some((line) => line.includes('Queue full; dropped')));
});
