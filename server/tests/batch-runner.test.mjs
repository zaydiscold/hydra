// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  bindRequestAbort,
  combineAbortSignals,
  runInBatches,
} = await import('../services/batch-runner.js');

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readRepoFile(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('batch runner preserves result order across successful chunks', async () => {
  const results = await runInBatches(
    [1, 2, 3, 4],
    async (value) => value * 2,
    { concurrency: 2, delayMs: 0 },
  );

  assert.deepEqual(results, [2, 4, 6, 8]);
});

test('batch runner clears its inter-chunk wait and stops future work after abort', async () => {
  const controller = new AbortController();
  const called = [];
  const startedAt = Date.now();

  const run = runInBatches(
    [1, 2],
    async (value) => {
      called.push(value);
      if (value === 1) setTimeout(() => controller.abort(new Error('route closed')), 10);
      return value;
    },
    { concurrency: 1, delayMs: 1000, signal: controller.signal },
  );

  await assert.rejects(run, /route closed/);
  assert.deepEqual(called, [1]);
  assert.ok(Date.now() - startedAt < 500, 'abort should clear the one-second inter-chunk delay');
});

test('request abort binding ignores normal response close but propagates disconnects', () => {
  const req = new EventEmitter();
  const res = new EventEmitter();
  req.aborted = false;
  res.destroyed = false;
  res.writableEnded = true;

  const normal = bindRequestAbort(req, res, 'normal request');
  res.emit('close');
  assert.equal(normal.signal.aborted, false);
  normal.dispose();

  res.writableEnded = false;
  const disconnected = bindRequestAbort(req, res, 'bulk import request');
  req.emit('aborted');
  assert.equal(disconnected.signal.aborted, true);
  assert.match(disconnected.signal.reason.message, /bulk import request disconnected/);
  disconnected.dispose();
});

test('combined abort signal propagates task cancellation', () => {
  const requestController = new AbortController();
  const taskController = new AbortController();
  const signal = combineAbortSignals(requestController.signal, taskController.signal);

  taskController.abort(new Error('operator cancelled'));

  assert.equal(signal.aborted, true);
  assert.match(signal.reason.message, /operator cancelled/);
});

test('bulk account and redemption paths thread request and task cancellation without secret task metadata', () => {
  const accounts = readRepoFile('server/controllers/AccountController.js');
  const codes = readRepoFile('server/controllers/CodeController.js');
  const dashboard = readRepoFile('server/services/dashboard-api.js');
  const rendererApi = readRepoFile('src/api.js');

  assert.match(accounts, /bindRequestAbort\(req, res, 'bulk account import request'\)/);
  assert.match(accounts, /bindRequestAbort\(req, res, 'bulk OTP stub request'\)/);
  assert.match(accounts, /bindRequestAbort\(req, res, 'bulk account provisioning request'\)/);
  assert.match(accounts, /combineAbortSignals\(requestAbort\.signal, task\.abortController\.signal\)/);
  assert.match(accounts, /throwIfAborted\(signal\)/);
  assert.match(accounts, /throwIfAborted\(requestAbort\.signal\)/);

  assert.match(codes, /bindRequestAbort\(req, res, 'bulk code redemption request'\)/);
  assert.match(codes, /bindRequestAbort\(req, res, 'bulk matrix redemption request'\)/);
  assert.match(codes, /bulkRedeemCode\(req\.user\.id, accountIds, code, \{ signal \}\)/);
  assert.doesNotMatch(codes, /\{ operation: 'bulk_redeem', size: accountIds\.length, code \}/);

  assert.match(dashboard, /bulkRedeemCode\(userId, accountIds, code, \{ signal = null \} = \{\}\)/);
  assert.match(dashboard, /\}, \{ signal \}\);/);

  assert.match(rendererApi, /bulkAddAccounts = \(lines, signal\)/);
  assert.match(rendererApi, /provisionAll = \(signal\)/);
  assert.match(rendererApi, /bulkRedeemCode = \(accountIds, code, signal\)/);
});
