// @platform all
// Salvaged from the deleted ui-static-contract source-mirror suite: this is the
// one genuine behavior test it contained — a real unit test of the bulk-email
// parsing/dedup helpers in src/utils/auth.js (not a source-string assertion).
import test from 'node:test';
import assert from 'node:assert/strict';

test('bulk email parsing dedupes case-insensitively and preserves unused remainders', async () => {
  const { parseEmailEntries, remainingEmailTextAfterUse } = await import('../../src/utils/auth.js');

  const parsed = parseEmailEntries('A@Example.com\na@example.com\nb@example.com');
  assert.deepEqual(parsed.emails, ['a@example.com', 'b@example.com']);
  assert.deepEqual(parsed.duplicates, ['a@example.com']);

  assert.equal(
    remainingEmailTextAfterUse('a@example.com\na@example.com\nb@example.com', ['a@example.com']),
    'a@example.com\nb@example.com',
  );
});
