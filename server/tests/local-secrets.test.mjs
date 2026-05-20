// @platform all
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const VALID_SECRET = 'a'.repeat(64);

async function importLocalSecretsWith(dataDir) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    HYDRA_DATA_DIR: dataDir,
    JWT_SECRET: 'test-local-secrets-jwt-secret-32chars',
    DATABASE_URL: 'file:./prisma/dev.db',
  };
  delete env.LOCAL_STORAGE_KEY;
  delete env.VAULT_KEY;
  delete env.HYDRA_PROXY_SECRET;

  return execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    [
      "const mod = await import('./server/services/local-secrets.js');",
      "console.log(JSON.stringify(mod.getLocalSecretsInfo()));",
    ].join(' '),
  ], {
    cwd: ROOT,
    env,
  });
}

async function readSecrets(dataDir) {
  return JSON.parse(await fsp.readFile(path.join(dataDir, 'local-secrets.json'), 'utf8'));
}

test('corrupt JSON local secrets are quarantined and regenerated during import', async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hydra-local-secrets-json-'));
  await fsp.writeFile(path.join(dataDir, 'local-secrets.json'), '{not json', 'utf8');

  const { stdout } = await importLocalSecretsWith(dataDir);
  const info = JSON.parse(stdout.trim().split('\n').at(-1));
  const secrets = await readSecrets(dataDir);
  const entries = await fsp.readdir(dataDir);

  assert.equal(info.storageKeyLength, 64);
  assert.match(secrets.storageKey, /^[0-9a-f]{64}$/);
  assert.match(secrets.proxySecret, /^[0-9a-f]{64}$/);
  assert.ok(entries.some((name) => name.startsWith('local-secrets.json.corrupt-')));
});

test('invalid persisted hex local secrets are quarantined and regenerated during import', async () => {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hydra-local-secrets-hex-'));
  await fsp.writeFile(path.join(dataDir, 'local-secrets.json'), JSON.stringify({
    storageKey: 'short',
    proxySecret: VALID_SECRET,
  }), 'utf8');

  await importLocalSecretsWith(dataDir);
  const secrets = await readSecrets(dataDir);
  const entries = await fsp.readdir(dataDir);

  assert.match(secrets.storageKey, /^[0-9a-f]{64}$/);
  assert.match(secrets.proxySecret, /^[0-9a-f]{64}$/);
  assert.notEqual(secrets.storageKey, 'short');
  assert.ok(entries.some((name) => name.startsWith('local-secrets.json.corrupt-')));
});

test('local secrets persistence uses fsynced temp file and atomic rename', () => {
  const source = readFileSync(path.join(ROOT, 'server/services/local-secrets.js'), 'utf8');

  assert.match(source, /const tempPath = `\$\{SECRETS_PATH\}\.tmp-/);
  assert.match(source, /openSync\(tempPath,\s*['"]wx['"],\s*0o600\)/);
  assert.match(source, /fsyncSync\(fd\)/);
  assert.match(source, /renameSync\(tempPath,\s*SECRETS_PATH\)/);
  assert.match(source, /fsyncDataDirBestEffort\(\)/);
  assert.match(source, /unlinkSync\(tempPath\)/);
  assert.doesNotMatch(source, /openSync\(SECRETS_PATH,\s*['"]w['"]/);
});

test('local secrets cleanup and directory fsync fallbacks leave warning evidence', () => {
  const source = readFileSync(path.join(ROOT, 'server/services/local-secrets.js'), 'utf8');

  assert.match(source, /Directory fsync skipped for \$\{DATA_DIR\}/);
  assert.match(source, /Directory fsync handle close failed for \$\{DATA_DIR\}/);
  assert.match(source, /Temp secrets file close failed after write error for \$\{tempPath\}/);
  assert.match(source, /Temp secrets file cleanup failed for \$\{tempPath\}/);
  assert.doesNotMatch(source, /catch \{ \/\* ignore close errors in best effort path \*\/ \}/);
  assert.doesNotMatch(source, /catch \{ \/\* preserve original error \*\/ \}/);
  assert.doesNotMatch(source, /catch \{ \/\* temp file may not exist \*\/ \}/);
});
