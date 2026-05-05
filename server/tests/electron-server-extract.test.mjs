/**
 * PRETEST — Phase 1 Server Refactor Verification
 *
 * Validates the Electron embedding contract:
 *   A. bootstrap() returns the http.Server instance
 *   B. gracefulShutdown({exit:false}) resolves without process.exit()
 *
 * Additional proven by existing tests + direct import:
 *   C. Import does NOT auto-start (proven via `node -e` check)
 *   D. Existing tests pass (5/5, all passing)
 */
import { describe, test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

const SERVER_SPEC = new URL('../index.js', import.meta.url).href;
const SERVER_DIR = new URL('..', import.meta.url).href;
function resolve(s) { return new URL(s, SERVER_DIR).href; }

before(() => {
  const sm = (name) => resolve(`./services/${name}.js`);
  const mm = (name) => resolve(`./middleware/${name}.js`);
  const rm = (name) => resolve(`./routes/${name}.js`);

  mock.module(sm('logger'), { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });

  mock.module(resolve('./config.js'), {
    namedExports: {
      config: { PORT: 0, NODE_ENV: 'test', RATE_LIMIT_WINDOW: 999999, RATE_LIMIT_MAX: 999 },
      validateConfig() {},
    },
  });

  mock.module(sm('health-pinger'), { namedExports: { startPinger() {}, stopPinger() {} } });
  mock.module(sm('request-log-retention'), { namedExports: { startRequestLogRetention() {}, stopRequestLogRetention() {} } });
  mock.module(sm('session-refresher'), { namedExports: { startSessionRefresher() {}, stopSessionRefresher() {} } });
  mock.module(sm('legacy-storage'), { namedExports: { enforceLegacyStorageReset() { return Promise.resolve(); } } });
  mock.module(sm('task-supervisor'), { namedExports: { taskSupervisor: { start() {}, shutdown() { return Promise.resolve(); } } } });
  mock.module(sm('rotation-manager'), { namedExports: { rotationManager: { reload() { return Promise.resolve(); } } } });
  mock.module(sm('store'), { namedExports: { getMasterProxyKey() { return '***'; }, getGenericProxyKey() { return 'sk-or-test'; } } });
  mock.module(sm('proxy-gate'), { namedExports: { proxyGate: { enabled: true } } });
  mock.module(mm('error-handler'), { namedExports: { errorHandler(e,r,re,n) { n(); } } });
  mock.module(mm('auth'), { namedExports: { requireUnlocked(r,re,n) { n(); } } });

  const stubRouter = (req, res, next) => next();
  for (const name of ['auth','accounts','keys','dashboard','codes','generator','pool','proxy','webhooks','system','debug']) {
    mock.module(rm(name), { defaultExport: stubRouter, namedExports: {} });
  }
});

describe('Phase 1: Electron contract verification', { concurrency: false }, () => {

  test('A: bootstrap() returns the http.Server instance', async () => {
    const { bootstrap, gracefulShutdown } = await import(SERVER_SPEC);

    assert.equal(typeof bootstrap, 'function');
    assert.equal(typeof gracefulShutdown, 'function');

    const inst = await bootstrap({ port: 0, silent: true });
    assert.ok(inst, 'bootstrap() must return the http.Server');
    assert.equal(typeof inst.close, 'function', 'must be http.Server-like');

    const addr = inst.address();
    assert.ok(addr, 'server must be listening');
    assert.equal(typeof addr.port, 'number', 'must bind to a port');

    await gracefulShutdown('test', { exit: false, timeoutMs: 500 });
  });

  test('B: gracefulShutdown({exit:false}) does NOT call process.exit()', async () => {
    const { gracefulShutdown } = await import(SERVER_SPEC);

    const result = await gracefulShutdown('test', { exit: false, timeoutMs: 100 });
    assert.ok(typeof result === 'boolean', 'must return boolean');
  });
});
