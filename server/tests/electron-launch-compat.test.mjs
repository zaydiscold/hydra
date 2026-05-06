/**
 * Launch Compatibility Test
 * ==========================
 *
 * Validates the backward-compatibility path that `npm start` and
 * `server/standalone.js` (not yet created) will depend on:
 *
 * 1. Server can start on a configurable port (via bootstrap() + PORT env)
 * 2. gracefulShutdown({ exit: false }) cleans up without calling process.exit()
 * 3. Port 0 (random port) binding works and the actual port is discoverable
 *    through server.address().port
 *
 * Design notes:
 *   - Uses mock.module() to replace heavy dependencies (db.js, config.js,
 *     logger.js, all background services) so bootstrap() can run in isolation.
 *   - Route modules and their controller/service chains are also mocked to
 *     prevent import-time crashes from un-mocked named exports.
 *   - The mutable mockConfig object lets us change PORT between test runs.
 *   - gracefulShutdown sets a module-scoped `shutdownInFlight` flag that never
 *     resets, so only the first call actually runs the full close path;
 *     subsequent calls return `true` immediately. This is acceptable because
 *     we only need to verify the close path once, and the port-0 test uses
 *     direct server closure as a fallback.
 */

import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';

// ---------------------------------------------------------------------------
// 0.  Persistent test environment
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

process.env.DATABASE_URL = 'file:./test-compat-launch.db';
process.env.JWT_SECRET     = 'test-compat-secret-hydra';
process.env.NODE_ENV       = 'test';

// ---------------------------------------------------------------------------
// 1.  Mutable config object — tests change PORT before each bootstrap() call
// ---------------------------------------------------------------------------

const mockConfig = {
  PORT: 0,
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./test-compat-launch.db',
  JWT_SECRET: 'test-compat-secret-hydra',
  HYDRA_MASTER_JWT_TTL: '30d',
  LOCAL_STORAGE_KEY: undefined,
  VAULT_KEY: undefined,
  HYDRA_PROXY_SECRET: undefined,
  HYDRA_RESET_LEGACY_STORAGE: false,
  RATE_LIMIT_WINDOW: 15 * 60 * 1000,
  RATE_LIMIT_MAX: 100,
  PROXY_RATE_LIMIT_WINDOW: 60 * 1000,
  PROXY_RATE_LIMIT_MAX: 60,
  OR_BASE: 'https://openrouter.ai',
  CLERK_ORIGIN: 'https://openrouter.ai',
  CLERK_REFERER: 'https://openrouter.ai/sign-in',
  HYDRA_PLAYWRIGHT_HEADED: false,
  HYDRA_PLAYWRIGHT_CHANNEL: undefined,
  HYDRA_PLAYWRIGHT_EXECUTABLE_PATH: undefined,
  HYDRA_PLAYWRIGHT_CDP_ENDPOINT: undefined,
  HYDRA_PROVISION_DEBUG: false,
  HYDRA_PROVISION_NETWORK_LOG: false,
  HYDRA_PROVISION_VERBOSE: false,
  HYDRA_PROVISION_SERVER_ACTION_REPLAY: false,
  HYDRA_MGMT_KEY_SERVER_ACTION_ID: undefined,
  HYDRA_REDEEM_ACTION_HASH: undefined,
};

// ---------------------------------------------------------------------------
// 2.  Module-level mocks — intercept BEFORE the first import of server/index.js
// ---------------------------------------------------------------------------

function noop() {}
function emptyRouter() { return Router(); }

const quietLogger = { info: noop, error: noop, warn: noop, debug: noop };

// Config module ------------------------------------------------
mock.module(new URL('../config.js', import.meta.url).href, {
  namedExports: {
    config: mockConfig,
    validateConfig: () => true,
    USER_AGENT: 'test-compat-agent',
    randomUserAgent: () => 'test-compat-agent',
    CLERK_BASE: 'https://clerk.openrouter.ai/v1',
    OR_BASE: 'https://openrouter.ai',
    CLERK_ORIGIN: 'https://openrouter.ai',
    CLERK_REFERER: 'https://openrouter.ai/sign-in',
  },
});

// Logger module ------------------------------------------------
mock.module(new URL('../services/logger.js', import.meta.url).href, {
  namedExports: { logger: quietLogger },
  defaultExport: quietLogger,
});

// Database module (PrismaClient instantiation) -----------------
mock.module(new URL('../services/db.js', import.meta.url).href, {
  namedExports: { prisma: {} },
});

// Auth middleware (needs services/auth.js import) --------------
mock.module(new URL('../middleware/auth.js', import.meta.url).href, {
  namedExports: {
    requireUnlocked: (req, res, next) => next(),
  },
});

// Background services ------------------------------------------
mock.module(new URL('../services/health-pinger.js', import.meta.url).href, {
  namedExports: { startPinger: noop, stopPinger: noop },
});

mock.module(new URL('../services/request-log-retention.js', import.meta.url).href, {
  namedExports: { startRequestLogRetention: noop, stopRequestLogRetention: noop },
});

mock.module(new URL('../services/task-supervisor.js', import.meta.url).href, {
  namedExports: {
    taskSupervisor: {
      start: noop,
      shutdown: async () => {},
    },
  },
});

mock.module(new URL('../services/legacy-storage.js', import.meta.url).href, {
  namedExports: {
    enforceLegacyStorageReset: async () => {},
  },
});

mock.module(new URL('../services/store.js', import.meta.url).href, {
  namedExports: {
    getMasterProxyKey:        () => 'sk-hydra-test',
    getGenericProxyKey:       () => 'sk-hydra-test',
    invalidateSessionStatusCache: noop,
  },
});

mock.module(new URL('../services/session-refresher.js', import.meta.url).href, {
  namedExports: { startSessionRefresher: noop, stopSessionRefresher: noop },
});

mock.module(new URL('../services/proxy-gate.js', import.meta.url).href, {
  namedExports: {
    proxyGate: { enabled: true },
  },
});

mock.module(new URL('../services/rotation-manager.js', import.meta.url).href, {
  namedExports: {
    rotationManager: {
      reload: async () => {},
      cancelReload: () => {},
      ensureLoaded: async () => {},
      pool: [],
    },
  },
});

// Route modules — mock as empty routers so controller/service
// chains aren't triggered at import time.
mock.module(new URL('../routes/auth.js',      import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/accounts.js',  import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/keys.js',      import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/dashboard.js', import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/codes.js',     import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/generator.js', import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/pool.js',      import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/proxy.js',     import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/webhooks.js',  import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/system.js',    import.meta.url).href, { defaultExport: Router() });
mock.module(new URL('../routes/debug.js',     import.meta.url).href, { defaultExport: Router() });

// Error handler middleware (imports logger — already mocked) ----
// No mock needed, it works fine.

// ---------------------------------------------------------------------------
// 3.  Import the server module (mocks are now active)
// ---------------------------------------------------------------------------

const mod = await import('../index.js');
const { app, bootstrap, gracefulShutdown } = mod;

// ---------------------------------------------------------------------------
// 4.  Lifecycle helpers
// ---------------------------------------------------------------------------

function getPort() {
  const srv = getServer();
  const addr = srv?.address();
  if (!addr) return null;
  if (typeof addr === 'string') return addr;    // unix socket
  return addr.port;
}

function getServer() {
  return mod.server;
}

async function closeServerDirectly() {
  const srv = getServer();
  if (!srv?.address()) return;
  await new Promise((resolve, reject) => {
    srv.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// 5.  Tests
// ---------------------------------------------------------------------------

/** Reset environment after all tests. */
after(async () => {
  await closeServerDirectly();
  Object.assign(process.env, ORIGINAL_ENV);
});

test('server can start on a configurable port', async () => {
  const targetPort = 31789;
  mockConfig.PORT = targetPort;

  await bootstrap();

  const addr = getServer().address();
  assert.ok(addr, 'server.address() should return a value after bootstrap');
  assert.equal(addr.port, targetPort, `server should bind to ${targetPort}`);
});

test('gracefulShutdown({ exit: false }) cleans up without killing the process', async () => {
  // Server is already running from the previous test on port 31789.
  // gracefulShutdown will close it, set shutdownInFlight, and return true.

  const result = await gracefulShutdown('test-launch-compat', { exit: false });

  // If gracefulShutdown had called process.exit(), we'd never reach this line.
  assert.strictEqual(result, true,
    'gracefulShutdown({ exit: false }) should resolve with true on clean close');

  // Verify the server is actually closed.
  // After close, server._handle is null (internal Node state).
  assert.ok(
    !getServer()._handle || getServer()._handle === null,
    'HTTP server should be closed after gracefulShutdown',
  );
});

test('server binds to port 0 (random port) and port is discoverable', async () => {
  // shutdownInFlight is true from the previous test, so a second
  // bootstrap() call still works (bootstrap replaces the `server`
  // variable with a new listen() call).
  mockConfig.PORT = 0;

  await bootstrap();

  const port = getPort();
  assert.ok(port !== null, 'server.address() should return a value');
  assert.ok(typeof port === 'number', `port should be a number, got ${typeof port}`);
  assert.ok(port > 0, `resolved port should be > 0, got ${port}`);
  assert.notEqual(port, 0, 'port 0 (EPHEMERAL) must resolve to a real OS-assigned port');

  // Close the server directly (gracefulShutdown would return true immediately
  // because shutdownInFlight is already true).
  await closeServerDirectly();

  // Verify closure
  assert.ok(!getServer()._handle || getServer()._handle === null,
    'server should be fully closed');
});
