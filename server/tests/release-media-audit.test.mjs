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

test('release media audit checks screenshot artifacts without reading secrets', () => {
  const source = readRepoFile('scripts/audit-release-media.mjs');
  const pkg = JSON.parse(readRepoFile('package.json'));

  assert.match(source, /schema:\s*'hydra\.release-media-audit\.v1'/);
  assert.match(source, /videos\/assets\/vault\.png/);
  assert.match(source, /videos\/assets\/dashboard\.png/);
  assert.match(source, /videos\/assets\/pool\.png/);
  assert.match(source, /videos\/assets\/traffic\.png/);
  assert.match(source, /videos\/hydra_showreel\.gif/);
  assert.match(source, /videos\/hydra_showreel\.mp4/);
  assert.match(source, /openrouter-key/);
  assert.match(source, /hydra-proxy-key/);
  assert.match(source, /clerk-session/);
  assert.match(source, /uuid/);
  assert.match(source, /email/);
  assert.match(source, /commandExists\('tesseract'\)/);
  assert.match(source, /scanText\(fileStrings\(path\)\)/);
  assert.match(source, /ocrImage\(path, tesseractAvailable\)/);
  assert.match(source, /--json/);
  assert.match(source, /process\.exitCode = 1/);
  assert.doesNotMatch(source, /readFileSync\([^)]*(hydra\.db|Cookies|local-secrets|jwt-secret|\.env)/);

  assert.equal(pkg.scripts['media:audit'], 'node scripts/audit-release-media.mjs');
  assert.equal(pkg.scripts['test:release-media-audit'], 'node --test server/tests/release-media-audit.test.mjs');
  assert.match(pkg.scripts.test, /test:release-media-audit/);
});
