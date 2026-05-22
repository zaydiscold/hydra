// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function readRepoFile(path) {
  return readFileSync(join(ROOT, path), 'utf-8');
}

// Since the API functions are tightly coupled to native modules that don't load in Node,
// we will extract and test the function statically.
test('formatProvisionDetailsAppendix formats API errors correctly', () => {
  const apiSrc = readRepoFile('src/api.js');

  // Extract the function using regex
  const match = apiSrc.match(/export function formatProvisionDetailsAppendix\(details\) {([\s\S]*?)\n}/);
  assert.ok(match, 'formatProvisionDetailsAppendix should exist in src/api.js');

  const functionBody = match[1];

  // Create a runnable function
  const formatProvisionDetailsAppendix = new Function('details', functionBody);

  // Test case 1: Null/undefined/non-objects
  assert.equal(formatProvisionDetailsAppendix(null), '');
  assert.equal(formatProvisionDetailsAppendix(undefined), '');
  assert.equal(formatProvisionDetailsAppendix('string'), '');
  assert.equal(formatProvisionDetailsAppendix(123), '');

  // Test case 2: Full details object
  const details = {
    stage: 'test_stage',
    phasesTried: ['phase_1', 'phase_2'],
    trpcLastRoute: '/api/route',
    trpcLastHttp: 500,
    trpcLastCode: 'INTERNAL_SERVER_ERROR',
    connectMode: 'headless',
    pageUrlAtFailure: 'http://example.com/login',
    trpcLastError: 'network timeout',
    trpcBusinessMessage: 'invalid key',
    trpcBusinessCode: 'KEY_INVALID',
    createClicked: true,
    fallbacksExhausted: true,
    debugDir: '/tmp/debug'
  };

  const formatted = formatProvisionDetailsAppendix(details);
  const expected = `Stage: test_stage
Phases tried: phase_1 → phase_2
Last tRPC route (HTTP): /api/route
Last tRPC HTTP: 500 (code INTERNAL_SERVER_ERROR)
Browser: headless
Page URL at failure: http://example.com/login
Last tRPC (HTTP phase): network timeout
Dashboard mutation error: invalid key
Dashboard mutation code: KEY_INVALID
Create control clicked: true
Fallbacks: true
Artifacts: /tmp/debug`;

  assert.equal(formatted, expected);

  // Test case 3: Partial details object (trpcLastHttp without trpcLastCode)
  const partialDetails1 = {
    trpcLastHttp: 404
  };
  assert.equal(formatProvisionDetailsAppendix(partialDetails1), 'Last tRPC HTTP: 404');

  // Test case 4: Partial details object (trpcLastCode without trpcLastHttp)
  const partialDetails2 = {
    trpcLastCode: 'NOT_FOUND'
  };
  assert.equal(formatProvisionDetailsAppendix(partialDetails2), 'Last tRPC HTTP: — (code NOT_FOUND)');
});
