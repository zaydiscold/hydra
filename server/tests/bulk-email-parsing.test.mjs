// @platform all
// Salvaged from the deleted ui-static-contract source-mirror suite: this is the
// one genuine behavior test it contained — a real unit test of the auth parsing
// and operation helpers in src/utils/auth.js (not a source-string assertion).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAuthOperationGuard,
  isCompleteOtpCode,
  normalizeOtpCode,
  parseEmailEntries,
  remainingEmailTextAfterUse,
} from '../../src/utils/auth.js';

test('bulk email parsing dedupes case-insensitively and preserves unused remainders', () => {
  const parsed = parseEmailEntries('A@Example.com\na@example.com\nb@example.com');
  assert.deepEqual(parsed.emails, ['a@example.com', 'b@example.com']);
  assert.deepEqual(parsed.duplicates, ['a@example.com']);

  assert.equal(
    remainingEmailTextAfterUse('a@example.com\na@example.com\nb@example.com', ['a@example.com']),
    'a@example.com\nb@example.com',
  );
});

test('OTP normalization accepts pasted codes but keeps only six digits', () => {
  assert.equal(normalizeOtpCode(' 12-34 56 '), '123456');
  assert.equal(normalizeOtpCode('123456789'), '123456');
  assert.equal(normalizeOtpCode('abc'), '');
  assert.equal(isCompleteOtpCode('123456'), true);
  assert.equal(isCompleteOtpCode('12345'), false);
  assert.equal(isCompleteOtpCode('12345x'), false);
});

test('auth operation guard invalidates stale async completions', () => {
  const guard = createAuthOperationGuard();
  const passwordLogin = guard.begin();
  assert.equal(guard.isCurrent(passwordLogin), true);

  const otpStart = guard.begin();
  assert.equal(guard.isCurrent(passwordLogin), false);
  assert.equal(guard.isCurrent(otpStart), true);

  guard.invalidate();
  assert.equal(guard.isCurrent(otpStart), false);
});
