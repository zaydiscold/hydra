/**
 * Debug — check if server gets set after bootstrap
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';

process.env.DATABASE_URL = 'file:./test-compat-launch.db';
process.env.JWT_SECRET     = 'test-compat-secret-hydra';
process.env.NODE_ENV       = 'test';

const mockConfig = { PORT: 31789, NODE_ENV: 'test', DATABASE_URL: 'file:x', JWT_SECRET: 's',
  HYDRA_MASTER_JWT_TTL: '30d', RATE_LIMIT_WINDOW: 900000, RATE_LIMIT_MAX: 100,
  OR_BASE: 'https://openrouter.ai', CLERK_ORIGIN: 'https://openrouter.ai',
  CLERK_REFERER: 'https://openrouter.ai/sign-in', HYDRA_RESET_LEGACY_STORAGE: false,
};

function noop() {}
const q = { info: noop, error: noop, warn: noop, debug: noop };

const configSpec = new URL('../config.js', import.meta.url).href;
mock.module(configSpec, {
  namedExports: {
    config: mockConfig, validateConfig: () => true,
    USER_AGENT: 'a', randomUserAgent: () => 'a',
    CLERK_BASE: 'https://clerk.openrouter.ai/v1',
    OR_BASE: 'https://openrouter.ai', CLERK_ORIGIN: 'a', CLERK_REFERER: 'a',
  },
});
mock.module(new URL('../services/logger.js', import.meta.url).href, {
  namedExports: { logger: q }, defaultExport: q,
});
mock.module(new URL('../services/db.js', import.meta.url).href, { namedExports: { prisma: {} } });
mock.module(new URL('../middleware/auth.js', import.meta.url).href, {
  namedExports: { requireUnlocked: (r, s, n) => n() },
});
mock.module(new URL('../services/health-pinger.js', import.meta.url).href, { namedExports: { startPinger: noop, stopPinger: noop } });
mock.module(new URL('../services/request-log-retention.js', import.meta.url).href, { namedExports: { startRequestLogRetention: noop, stopRequestLogRetention: noop } });
mock.module(new URL('../services/task-supervisor.js', import.meta.url).href, { namedExports: { taskSupervisor: { start: noop, shutdown: async () => {} } } });
mock.module(new URL('../services/legacy-storage.js', import.meta.url).href, { namedExports: { enforceLegacyStorageReset: async () => {} } });
mock.module(new URL('../services/store.js', import.meta.url).href, { namedExports: { getMasterProxyKey: () => 'k', getGenericProxyKey: () => 'k' } });
mock.module(new URL('../services/session-refresher.js', import.meta.url).href, { namedExports: { startSessionRefresher: noop, stopSessionRefresher: noop } });
mock.module(new URL('../services/proxy-gate.js', import.meta.url).href, { namedExports: { proxyGate: { enabled: true } } });
mock.module(new URL('../services/rotation-manager.js', import.meta.url).href, { namedExports: { rotationManager: { reload: async () => {}, ensureLoaded: async () => {}, pool: [] } } });

const emptyRouter = Router();
const routeFiles = ['auth','accounts','keys','dashboard','codes','generator','pool','proxy','webhooks','system','debug'];
for (const f of routeFiles) {
  mock.module(new URL(`../routes/${f}.js`, import.meta.url).href, { defaultExport: emptyRouter });
}

const mod = await import('../index.js');

console.log('=== pre-bootstrap ===');
console.log('server is null?', mod.server === null);
console.log('module has bootstrap:', typeof mod.bootstrap);

await mod.bootstrap();

console.log('=== post-bootstrap ===');
console.log('server is null?', mod.server === null);
console.log('server:', mod.server);
if (mod.server) {
  console.log('address:', mod.server.address());
}

test('just works', () => {
  assert.ok(mod.server, 'server should not be null after bootstrap');
  if (mod.server) {
    const addr = mod.server.address();
    assert.ok(addr, 'should have address');
    console.log('port:', addr.port);
  }
});
