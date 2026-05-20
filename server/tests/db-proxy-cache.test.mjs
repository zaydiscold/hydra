// @platform all
/**
 * Regression: the Prisma proxy should bind each function once per client
 * instance, then rebuild the cache after disconnect.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const PRISMA_SPEC = '@prisma/client';

let constructCount = 0;
let disconnectError = null;

class FakePrismaClient {
  constructor() {
    constructCount += 1;
    this.instanceId = constructCount;
    this.$disconnect = mock.fn(async () => {
      if (disconnectError) throw disconnectError;
    });
  }

  ping() {
    return this.instanceId;
  }
}

mock.module(PRISMA_SPEC, {
  defaultExport: { PrismaClient: FakePrismaClient },
  namedExports: { PrismaClient: FakePrismaClient },
});

const { prisma, disconnectPrisma } = await import('../services/db.js');

test('prisma proxy caches bound methods per client and resets after disconnect', async () => {
  const ping1 = prisma.ping;
  const ping2 = prisma.ping;

  assert.equal(constructCount, 1, 'client should initialize once for repeated accesses');
  assert.strictEqual(ping1, ping2, 'bound method should be cached');
  assert.equal(ping1(), 1, 'bound method should stay attached to the first client');

  await disconnectPrisma();

  const ping3 = prisma.ping;
  assert.equal(constructCount, 2, 'client should reinitialize after disconnect');
  assert.notStrictEqual(ping3, ping1, 'cache should be rebuilt for the new client');
  assert.equal(ping3(), 2, 'rebuilt bound method should target the new client');
});

test('prisma disconnect failures are visible and still reset the proxy lifecycle', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  disconnectError = new Error('disconnect refused');

  try {
    await disconnectPrisma();
  } finally {
    disconnectError = null;
    console.warn = originalWarn;
  }

  assert.ok(
    warnings.some((line) => line.includes('[db] Prisma disconnect failed: disconnect refused')),
    'disconnect failure should leave warning evidence',
  );

  const pingAfterFailure = prisma.ping;
  assert.equal(pingAfterFailure(), constructCount, 'proxy should reinitialize after failed disconnect');
});
