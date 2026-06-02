// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:/tmp/hydra-clerk-email-otp-signup-boundary.db';
process.env.JWT_SECRET = 'test-clerk-email-otp-signup-boundary-secret';

const { startEmailOTP } = await import('../services/clerk-auth.js');

test('existing-account OTP helper stops before direct Clerk sign_up preparation', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });

    if (calls.length === 1) {
      return {
        headers: {
          'set-cookie': ['__client=test-client-cookie; Path=/; SameSite=Lax'],
        },
        async text() {
          return '';
        },
      };
    }

    if (calls.length === 2) {
      return {
        headers: {},
        async json() {
          return {
            client: {
              sign_up: { id: 'signup_test_new_account' },
            },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch after signup boundary: ${url}`);
  };

  try {
    await assert.rejects(
      startEmailOTP('new-account@example.test'),
      (err) => {
        assert.equal(err.code, 'SIGNUP_INTERACTIVE_REQUIRED');
        assert.equal(err.status, 409);
        assert.equal(err.extra?.fallback, 'generator');
        assert.match(err.message, /Use Account Generator for signup/);
        return true;
      },
    );

    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/client\?_clerk_js_version=/);
    assert.match(calls[1].url, /\/client\/sign_ins\?_clerk_js_version=/);
    assert.equal(calls[1].method, 'POST');
    assert.equal(
      calls.some(({ url }) => url.includes('/prepare_email_address_verification')),
      false,
      'unknown email must not attempt direct Clerk sign_up preparation',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
