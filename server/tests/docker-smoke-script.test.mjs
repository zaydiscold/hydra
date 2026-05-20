// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf-8');
}

test('docker smoke runner uses bounded docker compose steps', () => {
  const src = read('scripts/docker-smoke.mjs');

  assert.match(src, /DEFAULT_TIMEOUTS/, 'must define explicit per-step timeouts');
  assert.match(src, /HYDRA_DOCKER_.*_TIMEOUT_MS/, 'must allow timeout overrides');
  assert.match(src, /spawn\(command/, 'must execute docker without shell chaining');
  assert.match(src, /child\.kill\('SIGTERM'\)/, 'must terminate hung docker child processes');
  assert.match(src, /'compose', 'config'/, 'must validate compose config');
  assert.match(src, /'info'/, 'must check Docker daemon availability');
  assert.match(src, /'compose', 'build'/, 'must build the Docker image');
  assert.match(src, /api\/auth\/status/, 'start smoke must probe Hydra health endpoint');
  assert.match(src, /'compose', 'ps', '-a'/, 'must collect compose state on failed start smoke');
  assert.match(src, /'compose', 'logs'/, 'must collect logs on failed start smoke');
  assert.match(src, /'compose', 'down', '--remove-orphans'/, 'must remove created containers after start smoke');
});

test('package docker:smoke uses the bounded runner', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['docker:smoke'], 'node scripts/docker-smoke.mjs');
});
