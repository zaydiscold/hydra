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
  const openrouter = readRepoFile('server/services/openrouter.js');

  assert.match(source, /fetchKeyMetadataResponse\(keyEntry\.keyString, \{/);
  assert.match(source, /baseUrl: `\$\{OR_BASE\}\/api\/v1`/);
  assert.match(openrouter, /export const KEY_METADATA_PATH = '\/key';/);
  assert.match(openrouter, /export const LEGACY_KEY_METADATA_PATH = '\/auth\/key';/);
  assert.match(openrouter, /if \(canonical\.status !== 404\) return canonical;/);
  assert.match(openrouter, /trying legacy \$\{LEGACY_KEY_METADATA_PATH\}/);
  assert.match(source, /HYDRA_HEALTH_PING_STARTUP_DELAY_MS/);
  assert.match(source, /HYDRA_HEALTH_PING_INTERVAL_MS/);
  assert.match(source, /await rotationManager\.getNextKey\(\)/);
  assert.match(source, /recordUpstreamHttpResult\(\{/);
  assert.match(source, /Health check returned upstream HTTP \$\{res\.status\}; leaving key state unchanged/);
  assert.match(source, /rotationManager\.recordSuccess\(keyEntry\.hash\)/);
  assert.match(source, /timer = setTimeout\(\(\) => \{/);
  assert.match(source, /scheduleNextPing\(PING_INTERVAL_MS\)/);
  assert.match(source, /rotationManager\.pool\.length === 0/);
  assert.match(source, /unsubscribePoolChange = rotationManager\.onPoolChange\(syncScheduledPing\)/);
  assert.match(source, /if \(pool\.length === 0\) \{\s*clearScheduledPing\(\)/);
  assert.match(source, /activeController\?\.abort\(\)/);
  assert.match(source, /await pingPromise\.catch/);
  assert.doesNotMatch(source, /setInterval/);
  assert.doesNotMatch(source, /clearInterval/);
  assert.doesNotMatch(source, /chat\/completions/);
  assert.doesNotMatch(source, /max_tokens/);
  assert.doesNotMatch(source, /PING_MODEL/);
});
