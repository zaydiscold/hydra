// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

test('refresh entrypoints pass stacked clientCookies before legacy clientCookie', () => {
  const files = [
    'server/services/dashboard-api.js',
    'server/controllers/AccountController.js',
    'server/controllers/DashboardController.js',
    'server/controllers/DebugController.js',
  ];

  for (const file of files) {
    const src = read(file);
    assert.match(
      src,
      /clientCookies\?\.(?:length|length\s*>\s*0)|normalizeClientCookies|stackedCookies/,
      `${file} must consider the stacked clientCookies field`,
    );
    assert.match(
      src,
      /refreshSession\([\s\S]{0,140}(?:clientCookies|cookieInput|refreshInput|stackedCookies)/,
      `${file} must pass stacked cookies into refreshSession`,
    );
  }
});

test('session status probes persist fresh Clerk client cookies after live refresh', () => {
  const storeSrc = read('server/services/store.js');

  assert.match(storeSrc, /const cookieStack\s*=\s*normalizeClientCookies\(config\)/);
  assert.match(storeSrc, /refreshSession\(cookieInput,\s*sessionCookie\)/);
  assert.match(
    storeSrc,
    /if\s*\(result\s*&&\s*userId\s*&&\s*accountId\)\s*\{[\s\S]*updateAccountSession\([\s\S]*result\.clientCookie[\s\S]*result\.sessionExpiry/s,
    'getSessionStatusAsync must persist fresh cookies and expiry returned by refreshSession',
  );
});

test('cookie stack helpers keep newest cookies first and cap stored history', () => {
  const storeSrc = read('server/services/store.js');

  assert.match(storeSrc, /const MAX_STACKED_CLIENT_COOKIES\s*=\s*25/);
  assert.match(storeSrc, /stack\.unshift\(\{\s*cookie:\s*trimmed,\s*issuedAt:/);
  assert.match(storeSrc, /return stack\.slice\(0,\s*MAX_STACKED_CLIENT_COOKIES\)/);
  assert.match(storeSrc, /config\.clientCookie\s*=\s*config\.clientCookies\[0\]\?\.cookie/);
});
