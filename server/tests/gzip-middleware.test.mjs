// @platform all
/**
 * Regression: the Express bootstrap should gzip static assets while leaving
 * API responses untouched.
 */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Router } from 'express';
import { readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST_ASSETS = resolve(ROOT, 'dist', 'assets');

function makeRouterWithStatus() {
  const router = Router();
  router.get('/status', (_req, res) => {
    res.json({ success: true, data: { ok: true } });
  });
  return router;
}

function emptyRouter() {
  return Router();
}

function requestBuffer(url, headers = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = http.request(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolveRequest({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

function findCompressibleAsset() {
  const entries = readdirSync(DIST_ASSETS).sort();
  for (const name of entries) {
    if (!name.endsWith('.js') && !name.endsWith('.css') && !name.endsWith('.map')) continue;
    const full = join(DIST_ASSETS, name);
    try {
      if (statSync(full).size > 1024) return name;
    } catch {
      /* skip */
    }
  }
  throw new Error(`No compressible dist asset found in ${DIST_ASSETS}`);
}

process.env.DATABASE_URL = 'file:./test-gzip.db';
process.env.JWT_SECRET = 'test-gzip-secret-hydra';
process.env.NODE_ENV = 'test';

const mockConfig = {
  PORT: 0,
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./test-gzip.db',
  JWT_SECRET: 'test-gzip-secret-hydra',
  HYDRA_MASTER_JWT_TTL: '24h',
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

const quietLogger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
};

mock.module(new URL('../config.js', import.meta.url).href, {
  namedExports: {
    config: mockConfig,
    validateConfig: () => true,
    USER_AGENT: 'test-gzip-agent',
    randomUserAgent: () => 'test-gzip-agent',
    CLERK_BASE: 'https://clerk.openrouter.ai/v1',
    OR_BASE: 'https://openrouter.ai',
    CLERK_ORIGIN: 'https://openrouter.ai',
    CLERK_REFERER: 'https://openrouter.ai/sign-in',
  },
});

mock.module(new URL('../services/logger.js', import.meta.url).href, {
  namedExports: { logger: quietLogger },
  defaultExport: quietLogger,
});

mock.module(new URL('../services/db.js', import.meta.url).href, {
  namedExports: { prisma: {} },
});

mock.module(new URL('../middleware/auth.js', import.meta.url).href, {
  namedExports: {
    requireUnlocked: (_req, _res, next) => next(),
  },
});

mock.module(new URL('../services/health-pinger.js', import.meta.url).href, {
  namedExports: { startPinger() {}, stopPinger() {} },
});

mock.module(new URL('../services/request-log-retention.js', import.meta.url).href, {
  namedExports: { startRequestLogRetention() {}, stopRequestLogRetention() {} },
});

mock.module(new URL('../services/task-supervisor.js', import.meta.url).href, {
  namedExports: {
    taskSupervisor: {
      start() {},
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
    getMasterProxyKey: () => 'sk-hydra-test',
    getGenericProxyKey: () => 'sk-hydra-test',
  },
});

mock.module(new URL('../services/session-refresher.js', import.meta.url).href, {
  namedExports: { startSessionRefresher() {}, stopSessionRefresher: async () => {} },
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
      cancelReload() {},
      ensureLoaded: async () => {},
      pool: [],
    },
  },
});

mock.module(new URL('../routes/auth.js', import.meta.url).href, {
  defaultExport: makeRouterWithStatus(),
});
for (const route of ['accounts', 'keys', 'dashboard', 'codes', 'generator', 'pool', 'proxy', 'webhooks', 'system', 'debug']) {
  mock.module(new URL(`../routes/${route}.js`, import.meta.url).href, {
    defaultExport: emptyRouter(),
  });
}

const { bootstrap, gracefulShutdown } = await import('../index.js');

let activeServer = null;

before(async () => {
  activeServer = await bootstrap({ port: 0, silent: true });
});

after(async () => {
  if (activeServer) {
    await gracefulShutdown('test', { exit: false, timeoutMs: 1000 });
    activeServer = null;
  }
});

test('static assets are served with gzip when accepted', async () => {
  const port = activeServer.address().port;
  const asset = findCompressibleAsset();
  const res = await requestBuffer(`http://127.0.0.1:${port}/assets/${asset}`, {
    'Accept-Encoding': 'gzip',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.equal(res.body[0], 0x1f);
  assert.equal(res.body[1], 0x8b);
});

test('api responses are not gzip-wrapped by the static middleware', async () => {
  const port = activeServer.address().port;
  const res = await requestBuffer(`http://127.0.0.1:${port}/api/auth/status`, {
    'Accept-Encoding': 'gzip',
  });

  assert.equal(res.statusCode, 200);
  assert.ok(!res.headers['content-encoding'], 'API responses should not be gzip encoded');
  assert.match(res.body.toString('utf-8'), /"success":true/);
});
