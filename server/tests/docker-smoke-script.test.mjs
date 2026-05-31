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
  assert.match(src, /probePlaywrightChromium/, 'must launch Playwright Chromium from the built container');
  assert.match(src, /'run',\s+'--rm',\s+'--entrypoint',\s+'node',\s+'ghcr\.io\/zaydiscold\/hydra:latest'/, 'browser probe must use an ephemeral docker run without creating compose resources');
  assert.match(src, /launchOptions\.channel !== 'chromium'/, 'must reject a Docker browser launch that is not pinned to full Chromium');
  assert.match(src, /cleanupEphemeralProfileDir\(profileDir\)/, 'must clean the Docker browser probe profile');
  assert.match(src, /api\/auth\/status/, 'start smoke must probe Hydra health endpoint');
  assert.match(src, /'compose', 'ps', '-a'/, 'must collect compose state on failed start smoke');
  assert.match(src, /'compose', 'logs'/, 'must collect logs on failed start smoke');
  assert.match(src, /'compose', 'down', '--remove-orphans'/, 'must remove created containers after start smoke');
});

test('docker compose publishes a reachable server listener', () => {
  const compose = read('docker-compose.yml');

  assert.match(compose, /3001:3001/, 'compose must publish the Hydra HTTP port');
  assert.match(compose, /HYDRA_LISTEN_HOST=0\.0\.0\.0/, 'container server must bind beyond loopback for published ports');
});

test('docker workflow runs a runtime smoke before publishing', () => {
  const workflow = read('.github/workflows/docker.yml');

  assert.match(workflow, /runtime-smoke:/, 'workflow must include a Docker runtime smoke job');
  assert.match(workflow, /node-version:\s*24/, 'runtime smoke must use the supported Node runtime');
  assert.match(workflow, /npm ci/, 'runtime smoke must install the project before invoking npm scripts');
  assert.match(workflow, /npm run docker:smoke -- --start/, 'runtime smoke must start the container and hit the health endpoint');
});

test('package docker:smoke uses the bounded runner', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['docker:smoke'], 'node scripts/docker-smoke.mjs');
});

test('Docker build context excludes desktop release artifacts', () => {
  const dockerignore = read('.dockerignore');
  assert.match(dockerignore, /^release$/m, 'release archives and extracted desktop apps must stay out of Docker build context');
  assert.match(dockerignore, /^build$/m, 'Electron build output must stay out of Docker build context');
  assert.match(dockerignore, /^videos$/m, 'README media must stay out of Docker build context');
  assert.match(dockerignore, /^splash-previews$/m, 'splash review captures must stay out of Docker build context');
});

test('custom Docker runtime installs Playwright Chromium system dependencies', () => {
  const dockerfile = read('Dockerfile');
  assert.match(
    dockerfile,
    /HYDRA_PLAYWRIGHT_CHANNEL=chromium/,
    'Docker runtime must opt into full Chromium new-headless mode when skipping headless shell',
  );
  assert.match(
    dockerfile,
    /RUN npx playwright install --with-deps chromium --no-shell\s+\\\s+&& rm -rf \/var\/lib\/apt\/lists\/\*/,
    'custom Node runtime must install Linux shared libraries, skip unused headless shell, and remove apt indexes',
  );
});
