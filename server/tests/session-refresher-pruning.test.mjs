// @platform all
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.HYDRA_SESSION_LIFETIME_PROBE = '0';

const account = {
  id: 'account-dead-stack',
  userId: 'user-1',
  alias: 'dead-stack@example.test',
  config: 'encrypted-config',
  sessionToken: 'encrypted-session',
};
const initialClientCookies = Array.from({ length: 25 }, (_, index) => ({
  cookie: `__client=dead-device-${index}`,
  issuedAt: `issued-${index}`,
}));
let storedConfig = {
  sessionExpiry: new Date(Date.now() - 60_000).toISOString(),
  clientCookies: initialClientCookies,
};
const sessionUpdates = [];
const accountEvents = [];

const refreshSession = mock.fn(async () => null);

mock.module(new URL('../services/db.js', import.meta.url).href, {
  exports: {
    prisma: {
      account: {
        findMany: mock.fn(async () => [account]),
      },
    },
  },
});

mock.module(new URL('../services/store.js', import.meta.url).href, {
  exports: {
    async updateAccountSession(...args) {
      sessionUpdates.push(args);
      const options = args[5] || {};
      if (Array.isArray(options.replaceClientCookies)) {
        storedConfig = {
          ...storedConfig,
          clientCookies: options.replaceClientCookies,
          clientCookie: options.replaceClientCookies[0]?.cookie || '',
        };
      }
    },
    async logAccountEvent(...args) {
      accountEvents.push(args);
    },
    getLatestClientCookie() {
      return storedConfig.clientCookies[0]?.cookie || '';
    },
    normalizeClientCookies(config = {}) {
      return Array.isArray(config.clientCookies)
        ? config.clientCookies.map((entry) => ({ ...entry }))
        : [];
    },
  },
});

mock.module(new URL('../services/clerk-auth.js', import.meta.url).href, {
  exports: {
    refreshSession,
    extractNewClientCookie() {
      return null;
    },
  },
});

mock.module(new URL('../services/logger.js', import.meta.url).href, {
  exports: {
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  },
});

mock.module(new URL('../services/storage-codec.js', import.meta.url).href, {
  exports: {
    decrypt() {
      return '';
    },
    decryptConfig() {
      return storedConfig;
    },
    encryptConfig(config) {
      return config;
    },
  },
});

const { sweepAndRefresh } = await import('../services/session-refresher.js');

test('session refresher prunes exhausted cookie stacks without recording a false renewal', async () => {
  await sweepAndRefresh();

  assert.equal(refreshSession.mock.callCount(), 25);
  assert.equal(sessionUpdates.length, 1);
  assert.deepEqual(sessionUpdates[0], [
    account.userId,
    account.id,
    undefined,
    undefined,
    undefined,
    {
      preserveSessionToken: true,
      replaceClientCookies: [],
      markSessionRefreshed: false,
    },
  ]);
  assert.equal(accountEvents.length, 1);
  assert.equal(accountEvents[0][2], 'SESSION_REFRESH_FAILED');

  await sweepAndRefresh();

  assert.equal(refreshSession.mock.callCount(), 25);
  assert.equal(sessionUpdates.length, 1);
});
