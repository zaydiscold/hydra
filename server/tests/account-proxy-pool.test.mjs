// @platform all
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';

const dataDir = mkdtempSync(join(tmpdir(), 'hydra-account-proxies-'));

process.env.NODE_ENV = 'test';
process.env.HYDRA_DATA_DIR = dataDir;
process.env.DATABASE_URL = `file:${join(dataDir, 'hydra.db')}`;
process.env.JWT_SECRET = 'test-account-proxy-pool-secret-32chars';
delete process.env.LOCAL_STORAGE_KEY;
delete process.env.VAULT_KEY;
delete process.env.HYDRA_PROXY_SECRET;

const {
  describeProxy,
  getAccountProxyPool,
  parseProxyLine,
  parseProxyLines,
  pickAccountProxy,
  setAccountProxyPool,
  toPlaywrightProxy,
} = await import('../services/account-proxy-pool.js');
const {
  fetchOptionsWithAutomationProxy,
  mergeAutomationLaunchArgs,
  pickAutomationNetworkRoute,
} = await import('../services/automation-network.js');

test.after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test('parses ip:port:user:pass proxies and masks credentials', () => {
  const proxy = parseProxyLine('127.0.0.1:8080:zayd:secret');

  assert.equal(proxy.host, '127.0.0.1');
  assert.equal(proxy.port, 8080);
  assert.equal(proxy.username, 'zayd');
  assert.equal(proxy.password, 'secret');
  assert.equal(proxy.server, 'http://127.0.0.1:8080');
  assert.equal(describeProxy(proxy), '127.0.0.1:8080:z**d:s****t');
  assert.deepEqual(toPlaywrightProxy(proxy), {
    server: 'http://127.0.0.1:8080',
    username: 'zayd',
    password: 'secret',
  });
});

test('dedupes lines, ignores blanks/comments, and rejects invalid ports', () => {
  const proxies = parseProxyLines(`
# comment
10.0.0.1:9000:user:pass
10.0.0.1:9000:user:pass
10.0.0.2:443:user:pa:ss
`);

  assert.equal(proxies.length, 2);
  assert.equal(proxies[1].password, 'pa:ss');
  assert.throws(() => parseProxyLines('10.0.0.1:70000:user:pass'), /Line 1: Proxy port/);
  assert.throws(() => parseProxyLines('10.0.0.1:8080:user'), /Line 1: Proxy must use/);
});

test('stores proxy pool encrypted and returns masked public state', () => {
  const saved = setAccountProxyPool('10.0.0.1:9000:user:secret');

  assert.equal(saved.count, 1);
  assert.equal(saved.lines, '10.0.0.1:9000:user:secret');
  assert.equal(saved.proxies[0].masked, '10.0.0.1:9000:u**r:s****t');

  const loaded = getAccountProxyPool();
  assert.equal(loaded.count, 1);
  assert.equal(loaded.lines, '10.0.0.1:9000:user:secret');
  assert.equal(loaded.proxies[0].username, 'u**r');

  const file = join(dataDir, 'account-proxies.json.enc');
  if (process.platform !== 'win32') {
    // Windows uses ACLs rather than POSIX mode bits; chmod(0o600) is a no-op
    // there and the file reports 0o666. Owner-only enforcement is asserted
    // on POSIX hosts where chmod is effective.
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
  const picked = pickAccountProxy();
  assert.equal(picked.host, '10.0.0.1');
  assert.equal(picked.password, 'secret');

  const cleared = setAccountProxyPool('');
  assert.equal(cleared.count, 0);
  assert.equal(pickAccountProxy(), null);
});

test('automation network route is explicit for account proxies and direct mode', () => {
  setAccountProxyPool('');
  const direct = pickAutomationNetworkRoute();

  assert.equal(direct.mode, 'direct-localhost');
  assert.equal(direct.accountProxy, null);
  assert.deepEqual(direct.chromiumArgs, ['--no-proxy-server']);
  assert.equal(direct.playwrightProxy, undefined);
  assert.deepEqual(mergeAutomationLaunchArgs(['--disable-dev-shm-usage'], direct), [
    '--no-proxy-server',
    '--disable-dev-shm-usage',
  ]);
  assert.equal(fetchOptionsWithAutomationProxy({ method: 'GET' }, direct).dispatcher, undefined);

  setAccountProxyPool('10.0.0.2:9001:alice:secret');
  const proxied = pickAutomationNetworkRoute();

  assert.equal(proxied.mode, 'account-proxy');
  assert.equal(proxied.label, '10.0.0.2:9001:a***e:s****t');
  assert.deepEqual(proxied.chromiumArgs, []);
  assert.deepEqual(proxied.playwrightProxy, {
    server: 'http://10.0.0.2:9001',
    username: 'alice',
    password: 'secret',
    bypass: 'localhost,127.0.0.1,::1',
  });
  const firstFetchOptions = fetchOptionsWithAutomationProxy({ method: 'POST' }, proxied);
  const secondFetchOptions = fetchOptionsWithAutomationProxy({ method: 'POST' }, proxied);
  assert.ok(firstFetchOptions.dispatcher);
  assert.equal(firstFetchOptions.dispatcher, secondFetchOptions.dispatcher);

  setAccountProxyPool('');
});
