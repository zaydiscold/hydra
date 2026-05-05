/**
 * Electron data path contract.
 *
 * Services that persist local app state must resolve their data directory from
 * HYDRA_DATA_DIR first, then fall back to ./data for terminal/dev use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

test('persistent services use shared data-dir helper', () => {
  const dataDirSrc = readFileSync(resolve(ROOT, 'server/lib/data-dir.js'), 'utf-8');
  assert.match(
    dataDirSrc,
    /process\.env\.HYDRA_DATA_DIR\s*\|\|[^;\n]*(?:path\.)?(?:join|resolve)\(\s*process\.cwd\(\)\s*,\s*['"]data['"]\s*\)/s,
    'data-dir helper must prefer HYDRA_DATA_DIR before falling back to process.cwd()/data',
  );

  for (const file of [
    'server/services/local-secrets.js',
    'server/services/auth.js',
    'server/services/proxy-gate.js',
    'server/services/redemption-log.js',
  ]) {
    const src = readFileSync(resolve(ROOT, file), 'utf-8');
    assert.match(src, /from ['"]\.\.\/lib\/data-dir\.js['"]/, `${file} must import the shared data-dir helper`);
  }
});

test('Electron pins HYDRA_DATA_DIR before server import', () => {
  const envSrc = readFileSync(resolve(ROOT, 'electron/app/env.js'), 'utf-8');
  const mainSrc = readFileSync(resolve(ROOT, 'electron/main.js'), 'utf-8');

  assert.match(envSrc, /process\.env\.HYDRA_DATA_DIR\s*=\s*appRef\.getPath\(['"]userData['"]\)/);
  assert.match(envSrc, /process\.env\.DATABASE_URL\s*=/);
  assert.match(envSrc, /process\.env\.HYDRA_EMBEDDED\s*=\s*['"]1['"]/);
  assert.match(mainSrc, /await ensurePackagedRuntimeState\(\)/);
  assert.ok(
    mainSrc.indexOf('await ensurePackagedRuntimeState()') < mainSrc.indexOf("import('../server/index.js')"),
    'Electron must set runtime env before importing the server',
  );
});
