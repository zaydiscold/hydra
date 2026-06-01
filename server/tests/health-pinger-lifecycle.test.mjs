// @platform all
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.HYDRA_HEALTH_PING_STARTUP_DELAY_MS = '300000';
process.env.HYDRA_HEALTH_PING_INTERVAL_MS = '300000';

let poolListener = null;
const rotationManager = {
  pool: [],
  ensureLoaded: mock.fn(async () => {}),
  getNextKey: mock.fn(async () => null),
  evict: mock.fn(async () => {}),
  applyCooldown: mock.fn(),
  recordSuccess: mock.fn(),
  onPoolChange(listener) {
    poolListener = listener;
    return () => {
      if (poolListener === listener) poolListener = null;
    };
  },
};

function replacePool(pool) {
  rotationManager.pool = pool;
  poolListener?.(pool);
}

mock.module(new URL('../services/rotation-manager.js', import.meta.url).href, {
  exports: { rotationManager },
});

mock.module(new URL('../services/logger.js', import.meta.url).href, {
  exports: {
    logger: {
      info() {},
      warn() {},
    },
  },
});

mock.module(new URL('../config.js', import.meta.url).href, {
  exports: {
    config: { PORT: 3460 },
    OR_BASE: 'https://openrouter.ai',
  },
});

mock.module(new URL('../services/upstream-health.js', import.meta.url).href, {
  exports: {
    recordUpstreamFailure() {},
    recordUpstreamHttpResult() {
      return true;
    },
  },
});

const {
  getHealthPingerSnapshot,
  startPinger,
  stopPinger,
} = await import('../services/health-pinger.js');

test.afterEach(async () => {
  await stopPinger();
  replacePool([]);
});

test('health pinger stays disarmed while the pool is empty', async () => {
  startPinger();

  assert.deepEqual(getHealthPingerSnapshot(), {
    scheduled: false,
    pingInFlight: false,
    subscribed: true,
  });
});

test('health pinger rearms when a key appears and disarms when the pool empties', async () => {
  startPinger();

  replacePool([{ hash: 'key-1', keyString: 'sk-or-v1-test' }]);
  assert.equal(getHealthPingerSnapshot().scheduled, true);

  replacePool([]);
  assert.equal(getHealthPingerSnapshot().scheduled, false);
});

test('health pinger removes its pool subscription during shutdown', async () => {
  startPinger();
  await stopPinger();

  replacePool([{ hash: 'key-1', keyString: 'sk-or-v1-test' }]);
  assert.deepEqual(getHealthPingerSnapshot(), {
    scheduled: false,
    pingInFlight: false,
    subscribed: false,
  });
});
