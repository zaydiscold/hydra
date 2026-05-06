/**
 * Regression: the Prisma proxy should bind each function once per client
 * instance, then rebuild the cache after disconnect.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const PRISMA_SPEC = '@prisma/client';

let constructCount = 0;

class FakePrismaClient {
  constructor() {
    constructCount += 1;
    this.instanceId = constructCount;
    this.$disconnect = mock.fn(async () => {});
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
