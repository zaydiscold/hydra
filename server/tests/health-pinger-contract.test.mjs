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

test('background health pinger validates keys without completion traffic', () => {
  const source = readRepoFile('server/services/health-pinger.js');

  assert.match(source, /const PING_PATH = '\/api\/v1\/auth\/key';/);
  assert.match(source, /method:\s*'GET'/);
  assert.match(source, /await rotationManager\.getNextKey\(\)/);
  assert.match(source, /recordUpstreamHttpResult\(\{/);
  assert.match(source, /Health check returned upstream HTTP \$\{res\.status\}; leaving key state unchanged/);
  assert.match(source, /rotationManager\.recordSuccess\(keyEntry\.hash\)/);
  assert.doesNotMatch(source, /chat\/completions/);
  assert.doesNotMatch(source, /max_tokens/);
  assert.doesNotMatch(source, /PING_MODEL/);
});
