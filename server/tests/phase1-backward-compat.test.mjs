/**
 * Phase 1 Backward Compatibility Validation Tests
 * These are static source validators — no mocks, no runtime imports needed.
 * They validate the Git-persisted contracts from Phase 1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const resolve = (rel) => new URL(rel, import.meta.url);

// ───── Test helpers ─────
function readSource(relPath) {
  return readFileSync(resolve(relPath), 'utf-8');
}

function assertPatternIn(name, content, regex, msg) {
  assert.ok(regex.test(content), `${name}: ${msg}`);
}

// ───── Phase 1 Contract Tests ─────

test('server/index.js: bootstrap() returns server', () => {
  const src = readSource('../../server/index.js');
  assertPatternIn('index.js', src, /return\s+server\b/, 'bootstrap must return server');
  assertPatternIn('index.js', src, /async function bootstrap\(\s*\{/, 'bootstrap must accept options object');
  assertPatternIn('index.js', src, /port.*silent/, 'bootstrap must accept {port, silent}');
});

test('server/index.js: gracefulShutdown has exit/timeoutMs options', () => {
  const src = readSource('../../server/index.js');
  assertPatternIn('index.js', src, /exit\s*=\s*true/, 'gracefulShutdown must default exit=true');
  assertPatternIn('index.js', src, /if\s*\(\s*exit\s*\)\s*process\.exit/, 'process.exit must be guarded by if(exit)');
  assertPatternIn('index.js', src, /timeoutMs/, 'gracefulShutdown must accept timeoutMs');
});

test('server/standalone.js: exists and imports from index.js', () => {
  // standalone.js auto-starts on import (it's the terminal entry point),
  // so we validate with static analysis only — no dynamic import
  const src = readSource('../../server/standalone.js');
  assertPatternIn('standalone.js', src, /import.*bootstrap.*gracefulShutdown.*from/, 'must import from index.js');
  assertPatternIn('standalone.js', src, /process\.on.*SIGINT/, 'must register signal handler');
  assertPatternIn('standalone.js', src, /process\.on.*SIGTERM/, 'must register signal handler');
  assert.ok(true, 'standalone.js validated statically');
});

test('server/config.js: throws instead of process.exit', () => {
  const src = readSource('../../server/config.js');
  assertPatternIn('config.js', src, /throw\s+new\s+Error/, 'config.js must throw on invalid env');
  assert.ok(!src.replace(/\/\/.*$/gm, ' ').match(/process\.exit\(1\)/), 'config.js must NOT have process.exit(1)');
});

test('HYDRA_DATA_DIR: all 4 services respect env var', () => {
  const files = [
    '../../server/services/local-secrets.js',
    '../../server/services/auth.js',
    '../../server/services/proxy-gate.js',
    '../../server/services/redemption-log.js',
  ];
  for (const f of files) {
    const src = readSource(f);
    const basename = f.split('/').pop();
    assertPatternIn(basename, src, /process\.env\.HYDRA_DATA_DIR/, 'must use HYDRA_DATA_DIR');
    assertPatternIn(basename, src, /\|\|.*process\.cwd\(\).*data/, 'must fallback to cwd/data');
  }
});

test('Docker entrypoint: uses standalone.js not server/index.js', () => {
  const src = readSource('../../scripts/docker-entrypoint.sh');
  assertPatternIn('docker-entrypoint.sh', src, /server\/standalone\.js/, 'must use standalone.js');
  assert.ok(!src.match(/node\s+server\/index\.js/), 'must NOT use server/index.js');
});

test('package.json: main field is electron/main.js', () => {
  const pkg = JSON.parse(readSource('../../package.json'));
  assert.equal(pkg.main, 'electron/main.js', 'package.json main must be electron/main.js');
});

test('package.json: has all 3 Electron devDependencies', () => {
  const pkg = JSON.parse(readSource('../../package.json'));
  const deps = pkg.devDependencies || {};
  assert.ok(deps.electron, 'must have electron devDep');
  assert.ok(deps['electron-builder'], 'must have electron-builder devDep');
  assert.ok(deps['electron-log'], 'must have electron-log devDep');
});

test('package.json: has electron build scripts', () => {
  const pkg = JSON.parse(readSource('../../package.json'));
  assert.ok(pkg.scripts['dev:electron'], 'must have dev:electron script');
  assert.ok(pkg.scripts['electron:build'], 'must have electron:build script');
  assert.ok(pkg.scripts['dev'], 'must preserve dev script');
  assert.ok(pkg.scripts['start'], 'must preserve start script');
});

test('prisma/schema.prisma: has binaryTargets for cross-platform', () => {
  const src = readSource('../../prisma/schema.prisma');
  assertPatternIn('schema.prisma', src, /binaryTargets/, 'must define binaryTargets');
  assertPatternIn('schema.prisma', src, /darwin/, 'must target macos');
});

test('electron/main.js: sets HYDRA_DATA_DIR before server import', () => {
  const src = readSource('../../electron/main.js');
  assertPatternIn('main.js', src, /HYDRA_DATA_DIR/, 'must set HYDRA_DATA_DIR');
  assertPatternIn('main.js', src, /app\.getPath\('userData'\)/, 'must use userData path');
  assertPatternIn('main.js', src, /HYDRA_EMBEDDED/, 'must set HYDRA_EMBEDDED for dotenv bypass');
  assertPatternIn('main.js', src, /migrateIfNeeded/, 'must call legacy data migration');
  assertPatternIn('main.js', src, /setupAppMenu/, 'must set up app menu');
});

test('electron/preload.js: uses contextBridge', () => {
  const src = readSource('../../electron/preload.js');
  assertPatternIn('preload.js', src, /contextBridge/, 'must use contextBridge');
});

test('scripts/launch.js: in-process bootstrap, no spawn', () => {
  const src = readSource('../../scripts/launch.js');
  assertPatternIn('launch.js', src, /await bootstrap\(/, 'must call await bootstrap()');
  assert.ok(!src.replace(/\/\/.*$/gm, ' ').match(/spawn\(/), '"spawn(" must NOT appear in non-comment code');
  assertPatternIn('launch.js', src, /gracefulShutdown\('SIGINT'/, 'must use gracefulShutdown for signals');
});

// ───── Summary ─────
const suites = 0;
const testCount = 14;
console.log(`\nPhase 1 Backward Validation: ${testCount} static contract tests`);
