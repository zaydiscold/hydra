import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('electron', {
  namedExports: {
    app: {
      isPackaged: false,
      getAppPath() {
        return process.cwd();
      },
      getPath(name) {
        return name === 'logs' ? '/tmp/hydra-test-logs' : '/tmp/hydra-test-user-data';
      },
      once() {},
      commandLine: { appendSwitch() {} },
      dock: { setIcon() {} },
    },
  },
});

const { isAllowedLocalUiUrl, resolveDevServerUrl } = await import('../../electron/app/env.js');

test('Electron local UI allowlist only permits loopback HTTP(S) on the current app port', () => {
  assert.equal(isAllowedLocalUiUrl('http://localhost:3001/dashboard', 3001), true);
  assert.equal(isAllowedLocalUiUrl('http://127.0.0.1:3001/settings', 3001), true);
  assert.equal(isAllowedLocalUiUrl('http://[::1]:3001/traffic', 3001), true);

  assert.equal(isAllowedLocalUiUrl('http://localhost:9222/json/version', 3001), false);
  assert.equal(isAllowedLocalUiUrl('http://127.0.0.1:5173/dashboard', 3001), false);
  assert.equal(isAllowedLocalUiUrl('file:///etc/passwd', 3001), false);
  assert.equal(isAllowedLocalUiUrl('https://openrouter.ai', 3001), false);
  assert.equal(isAllowedLocalUiUrl('javascript:alert(1)', 3001), false);
});

test('Electron dev server URL falls back when VITE_DEV_SERVER_URL is not loopback', () => {
  const fallback = 'http://localhost:3001';

  assert.equal(resolveDevServerUrl('http://localhost:5173', fallback), 'http://localhost:5173');
  assert.equal(resolveDevServerUrl('https://example.com', fallback), fallback);
  assert.equal(resolveDevServerUrl('file:///tmp/index.html', fallback), fallback);
});
