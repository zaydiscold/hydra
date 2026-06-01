// @platform all
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.HYDRA_REQUEST_LOG_RETENTION_STARTUP_DELAY_MS = '5';
process.env.HYDRA_REQUEST_LOG_RETENTION_INTERVAL_MS = '35';

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

mock.module(new URL('../services/db.js', import.meta.url).href, {
  exports: {
    prisma: {
      requestLog: fakeRequestLog,
      $executeRawUnsafe: mock.fn(async () => 0),
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

const {
  getRequestLogRetentionSnapshot,
  noteRequestLogActivity,
  startRequestLogRetention,
  stopRequestLogRetention,
} = await import('../services/request-log-retention.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.afterEach(async () => {
  await stopRequestLogRetention();
  rows = [];
  warnings.length = 0;
  fakeRequestLog.findFirst.mock.resetCalls();
  fakeRequestLog.deleteMany.mock.resetCalls();
});

test('empty startup prune disarms recurring request-log retention wakeups', async () => {
  startRequestLogRetention();
  await wait(90);

  assert.equal(fakeRequestLog.findFirst.mock.callCount(), 1);
  assert.deepEqual(getRequestLogRetentionSnapshot(), {
    started: true,
    stopping: false,
    startupScheduled: false,
    pruneScheduled: false,
    pruneInFlight: false,
  });
});

test('new proxy activity rearms retention after an empty-table disarm', async () => {
  startRequestLogRetention();
  await wait(20);
  assert.equal(getRequestLogRetentionSnapshot().pruneScheduled, false);

  rows = [{ id: 'fresh-1', createdAt: new Date() }];
  noteRequestLogActivity();
  assert.equal(getRequestLogRetentionSnapshot().pruneScheduled, true);

  await wait(50);
  assert.ok(fakeRequestLog.findFirst.mock.callCount() >= 3);
  assert.equal(getRequestLogRetentionSnapshot().pruneScheduled, true);
});

test('stopping retention clears a traffic-driven prune timer', async () => {
  startRequestLogRetention();
  await wait(20);
  noteRequestLogActivity();
  assert.equal(getRequestLogRetentionSnapshot().pruneScheduled, true);

  await stopRequestLogRetention();

  assert.deepEqual(getRequestLogRetentionSnapshot(), {
    started: false,
    stopping: true,
    startupScheduled: false,
    pruneScheduled: false,
    pruneInFlight: false,
  });
});
