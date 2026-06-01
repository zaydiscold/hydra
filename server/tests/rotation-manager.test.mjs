// @platform all
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let getPooledKeysImpl = async () => [];
const warnings = [];

mock.module(new URL('../services/db.js', import.meta.url).href, {
  namedExports: {
    prisma: {
      user: {
        findFirst: mock.fn(async () => ({ id: 'user-1' })),
      },
    },
  },
});

mock.module(new URL('../services/logger.js', import.meta.url).href, {
  namedExports: {
    logger: {
      info() {},
      warn(message) {
        warnings.push(String(message));
      },
    },
  },
});

mock.module(new URL('../services/store.js', import.meta.url).href, {
  namedExports: {
    getPooledKeys: (...args) => getPooledKeysImpl(...args),
  },
});

const { RotationManager } = await import('../services/rotation-manager.js');

test.afterEach(() => {
  getPooledKeysImpl = async () => [];
  warnings.length = 0;
});

test('cancelReload waits for an already-active database-backed reload', async () => {
  const gate = Promise.withResolvers();
  let entered = false;
  getPooledKeysImpl = async () => {
    entered = true;
    await gate.promise;
    return [];
  };

  const manager = new RotationManager();
  manager.userId = 'user-1';
  const reload = manager.reload().catch((err) => err);
  while (!entered) await new Promise((resolve) => setImmediate(resolve));

  let stopSettled = false;
  const stop = manager.cancelReload().then(() => {
    stopSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopSettled, false, 'shutdown must join the active pool reload');

  gate.resolve();
  const reloadOutcome = await reload;
  await stop;
  assert.equal(reloadOutcome.name, 'AbortError');
  assert.equal(manager._reloadController, null);
  assert.equal(manager._reloadPromise, null);
});

test('concurrent reload requests coalesce into one fresh rerun', async () => {
  const firstGate = Promise.withResolvers();
  const secondGate = Promise.withResolvers();
  let calls = 0;
  getPooledKeysImpl = async () => {
    calls += 1;
    if (calls === 1) {
      await firstGate.promise;
      return [{ hash: 'stale', limitRemaining: 1 }];
    }
    await secondGate.promise;
    return [{ hash: 'fresh', limitRemaining: 2 }];
  };

  const manager = new RotationManager();
  manager.userId = 'user-1';
  const firstReload = manager.reload();
  while (calls < 1) await new Promise((resolve) => setImmediate(resolve));
  const secondReload = manager.reload();

  firstGate.resolve();
  while (calls < 2) await new Promise((resolve) => setImmediate(resolve));
  secondGate.resolve();
  await Promise.all([firstReload, secondReload]);

  assert.equal(calls, 2);
  assert.deepEqual(manager.pool.map((entry) => entry.hash), ['fresh']);
  assert.equal(manager._reloadPromise, null);
  assert.equal(manager._reloadController, null);
});

test('cancelReload logs non-abort unwind failures without hiding them', async () => {
  const gate = Promise.withResolvers();
  let entered = false;
  getPooledKeysImpl = async () => {
    entered = true;
    await gate.promise;
    throw new Error('reload database failure');
  };

  const manager = new RotationManager();
  manager.userId = 'user-1';
  const reload = manager.reload().catch((err) => err);
  while (!entered) await new Promise((resolve) => setImmediate(resolve));
  const stop = manager.cancelReload();
  gate.resolve();
  await Promise.all([reload, stop]);

  assert.ok(warnings.some((line) => line.includes('Shutdown waited on failed reload: reload database failure')));
});
