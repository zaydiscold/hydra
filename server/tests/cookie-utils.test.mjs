// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clerkFapiDeviceCookieHeader,
  openRouterDashboardDeviceCookies,
  openRouterPlaywrightDeviceCookies,
  parseAllDeviceCookies,
  parseClerkDeviceCookieJar,
  serializeAllDeviceCookies,
} from '../utils/cookie-utils.js';

test('Clerk device cookie parser accepts raw legacy and lone name-value cookies', () => {
  assert.deepEqual(parseClerkDeviceCookieJar('raw-client-token'), {
    __client: 'raw-client-token',
  });
  assert.deepEqual(parseClerkDeviceCookieJar('__client=client-token'), {
    __client: 'client-token',
  });
  assert.deepEqual(parseClerkDeviceCookieJar('__client=client-token; __client_uat=uat-token'), {
    __client: 'client-token',
    __client_uat: 'uat-token',
  });
});

test('dashboard cookie parser round-trips legacy raw __client storage', () => {
  const serialized = serializeAllDeviceCookies({ __client: 'raw-client-token' });

  assert.equal(serialized, 'raw-client-token');
  assert.deepEqual(parseAllDeviceCookies(serialized), {
    __client: 'raw-client-token',
  });
  assert.deepEqual(parseAllDeviceCookies('__client=client-token'), {
    __client: 'client-token',
  });
});

test('cookie headers do not double-prefix lone __client strings', () => {
  assert.equal(
    clerkFapiDeviceCookieHeader('__client=client-token'),
    '__client=client-token',
  );
  assert.equal(
    openRouterDashboardDeviceCookies('__client=client-token'),
    '__client_uat=client-token; __client=client-token',
  );
  assert.equal(
    openRouterDashboardDeviceCookies('raw-client-token'),
    '__client_uat=raw-client-token; __client=raw-client-token',
  );
});

test('Playwright cookies inherit raw legacy client values', () => {
  assert.deepEqual(openRouterPlaywrightDeviceCookies('raw-client-token'), [
    {
      name: '__client_uat',
      value: 'raw-client-token',
      domain: 'openrouter.ai',
      path: '/',
    },
  ]);
});
