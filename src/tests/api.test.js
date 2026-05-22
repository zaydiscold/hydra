// @platform web
/**
 * Frontend API utilities coverage.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Using dynamic import so it is evaluated after the mock is set up.
// Note: Unfortunately, node test module mocking needs exactly matching import specifiers.
// Since `src/api.js` imports `./lib/native` without `.js`, Node throws ERR_MODULE_NOT_FOUND.
// To avoid making changes to `src/api.js` we can use a loader or just test pure
// functions directly if we can't intercept the import in the standard node test runner easily.
// Instead, let's extract the functions to test if needed, or define a small `loader.mjs` for testing.
// A simpler way: we just read the file, run standard eval or new Function with the file's content
// to export these pure functions.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const apiSrc = readFileSync(join(__dirname, '../api.js'), 'utf8');

// Extract just the `formatApiErrorMessage` and `formatProvisionDetailsAppendix` functions manually for testing.
// This safely bypasses Node's ESM resolution problems with extension-less imports.
let formatApiErrorMessage;
let formatProvisionDetailsAppendix;

try {
  // Extract formatProvisionDetailsAppendix
  const appendixMatch = apiSrc.match(/export function formatProvisionDetailsAppendix\([\s\S]+?\n\}/);
  const errorMessageMatch = apiSrc.match(/export function formatApiErrorMessage\([\s\S]+?\n\}/);

  if (appendixMatch && errorMessageMatch) {
    const fnBody1 = appendixMatch[0].replace('export ', '');
    const fnBody2 = errorMessageMatch[0].replace('export ', '');
    const execute = new Function(`
      ${fnBody1}
      ${fnBody2}
      return { formatApiErrorMessage, formatProvisionDetailsAppendix };
    `);
    const fns = execute();
    formatApiErrorMessage = fns.formatApiErrorMessage;
    formatProvisionDetailsAppendix = fns.formatProvisionDetailsAppendix;
  }
} catch (e) {
  console.error('Failed to extract functions', e);
}


describe('formatApiErrorMessage', () => {
  it('should return "Request failed" if error object has no message', () => {
    assert.equal(formatApiErrorMessage({}), 'Request failed');
    assert.equal(formatApiErrorMessage(null), 'Request failed');
  });

  it('should format simple error message', () => {
    assert.equal(formatApiErrorMessage(new Error('Simple error')), 'Simple error');
  });

  it('should append server hint if provided', () => {
    const err = new Error('Base error');
    err.hint = 'Try checking your connection';
    assert.equal(
      formatApiErrorMessage(err),
      'Base error\n\nTry checking your connection'
    );
  });

  it('should append clerk debug hint if provided', () => {
    const err = new Error('Base error');
    err.clerkDebugHint = 'Clerk debug info';
    assert.equal(
      formatApiErrorMessage(err),
      'Base error\n\nClerk debug info'
    );
  });

  it('should append structured details block if provided', () => {
    const err = new Error('Base error');
    err.details = {
      stage: 'login',
      connectMode: 'headless'
    };
    const expectedDetailBlock = formatProvisionDetailsAppendix(err.details);
    assert.equal(
      formatApiErrorMessage(err),
      `Base error\n\n${expectedDetailBlock}`
    );
  });

  it('should append all parts separated by double newlines', () => {
    const err = new Error('Base error');
    err.hint = 'Server hint';
    err.clerkDebugHint = 'Clerk hint';
    err.details = { stage: 'login' };
    const expectedDetailBlock = formatProvisionDetailsAppendix(err.details);
    assert.equal(
      formatApiErrorMessage(err),
      `Base error\n\nServer hint\n\nClerk hint\n\n${expectedDetailBlock}`
    );
  });

  it('should specially handle GOOGLE_OAUTH_REQUIRES_OTP', () => {
    const err = new Error('Some prefix GOOGLE_OAUTH_REQUIRES_OTP suffix');
    err.hint = 'This hint should be ignored';

    const expected = 'This Google OAuth account requires OTP verification before provisioning.\n\n' +
                     'Steps to fix:\n' +
                     '1. Click "Authenticate" on this account\n' +
                     '2. Select "Email OTP" method\n' +
                     '3. Enter the 6-digit code from your email\n' +
                     '4. Once authenticated, retry "Provision Key"';

    assert.equal(formatApiErrorMessage(err), expected);
  });
});
