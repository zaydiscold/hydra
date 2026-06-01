// @platform all
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.HYDRA_REQUEST_LOG_KEEP_COUNT = '2';

let rows = [];
const warnings = [];

const fakeRequestLog = {
  findFirst: mock.fn(async ({ orderBy, skip = 0 }) => {
    const direction = orderBy.createdAt;
    return rows
      .toSorted((a, b) => direction === 'asc'
        ? a.createdAt - b.createdAt
        : b.createdAt - a.createdAt)[skip] ?? null;
  }),
  deleteMany: mock.fn(async ({ where }) => {
    const cutoff = where.createdAt.lt;
    const before = rows.length;
    rows = rows.filter(row => row.createdAt >= cutoff);
    return { count: before - rows.length };
  }),
};

const executeRawUnsafe = mock.fn(async () => 0);

mock.module(new URL('../services/db.js', import.meta.url).href, {
  exports: {
    prisma: {
      requestLog: fakeRequestLog,
      $executeRawUnsafe: executeRawUnsafe,
    },
  },
});

mock.module(new URL('../services/logger.js', import.meta.url).href, {
  exports: {
    logger: {
      info() {},
      warn(message) {
        warnings.push(String(message));
      },
    },
  },
});

const { pruneRequestLogs } = await import('../services/request-log-retention.js');

function freshRow(id, offsetMs = 0) {
  return { id, createdAt: new Date(Date.now() + offsetMs) };
}

test.afterEach(() => {
  rows = [];
  warnings.length = 0;
  fakeRequestLog.findFirst.mock.resetCalls();
  fakeRequestLog.deleteMany.mock.resetCalls();
  executeRawUnsafe.mock.resetCalls();
});

test('request-log retention skips both delete paths when the table is empty', async () => {
  await pruneRequestLogs();

  assert.equal(fakeRequestLog.findFirst.mock.callCount(), 1);
  assert.equal(fakeRequestLog.deleteMany.mock.callCount(), 0);
  assert.equal(executeRawUnsafe.mock.callCount(), 0);
});

test('request-log retention skips writes while fresh rows stay below the cap', async () => {
  rows = [freshRow('fresh-1')];

  await pruneRequestLogs();

  assert.equal(fakeRequestLog.findFirst.mock.callCount(), 2);
  assert.equal(fakeRequestLog.deleteMany.mock.callCount(), 0);
  assert.equal(executeRawUnsafe.mock.callCount(), 0);
});

test('request-log retention prunes old rows before checking count overflow', async () => {
  rows = [
    freshRow('stale-1', -31 * 24 * 60 * 60 * 1000),
    freshRow('fresh-1'),
  ];

  await pruneRequestLogs();

  assert.equal(fakeRequestLog.deleteMany.mock.callCount(), 1);
  assert.equal(executeRawUnsafe.mock.callCount(), 0);
  assert.deepEqual(rows.map(row => row.id), ['fresh-1']);
});

test('request-log retention executes the raw cap delete only when overflow exists', async () => {
  rows = [
    freshRow('fresh-1', -3),
    freshRow('fresh-2', -2),
    freshRow('fresh-3', -1),
  ];

  await pruneRequestLogs();

  assert.equal(fakeRequestLog.deleteMany.mock.callCount(), 0);
  assert.equal(executeRawUnsafe.mock.callCount(), 1);
  assert.match(executeRawUnsafe.mock.calls[0].arguments[0], /OFFSET 2/);
});
