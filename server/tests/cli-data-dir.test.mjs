// @platform all
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { resolveCliDataDir } from '../../bin/lib/runtime-port.js';

test('CLI selects an existing packaged app vault before repository data', () => {
  const home = mkdtempSync(join(tmpdir(), 'hydra-cli-data-dir-'));
  try {
    const repo = join(home, 'repo');
    const app = join(home, 'Library', 'Application Support', 'hydra');
    mkdirSync(join(repo, 'data'), { recursive: true });
    mkdirSync(app, { recursive: true });
    writeFileSync(join(repo, 'data', 'hydra.db'), 'dev');
    writeFileSync(join(app, 'hydra.db'), 'app');
    writeFileSync(join(app, 'local-secrets.json'), '{}');
    assert.equal(resolveCliDataDir({ root: repo, env: { HOME: home }, platformName: 'darwin' }), app);
    assert.equal(resolveCliDataDir({ root: repo, env: { HOME: home, HYDRA_DATA_DIR: join(repo, 'data') }, platformName: 'darwin' }), join(repo, 'data'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('CLI retains repository fallback when no packaged vault exists', () => {
  const home = mkdtempSync(join(tmpdir(), 'hydra-cli-data-dir-'));
  try {
    const repo = join(home, 'repo');
    assert.equal(resolveCliDataDir({ root: repo, env: { HOME: home }, platformName: 'darwin' }), join(repo, 'data'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('data-dir and database reset preview select the same existing vault', () => {
  const home = mkdtempSync(join(tmpdir(), 'hydra-cli-data-dir-'));
  try {
    const app = join(home, 'Library', 'Application Support', 'hydra');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'hydra.db'), 'app');
    writeFileSync(join(app, 'local-secrets.json'), '{}');
    const env = { ...process.env, HOME: home, HYDRA_DATA_DIR: '', DATABASE_URL: '', HYDRA_RUNTIME_STATE_PATH: '' };
    const root = new URL('../..', import.meta.url);
    const cli = new URL('../../bin/hydra.mjs', import.meta.url);
    const selected = execFileSync(process.execPath, [cli.pathname, 'data-dir'], { cwd: root.pathname, env, encoding: 'utf8' }).trim();
    const preview = JSON.parse(execFileSync(process.execPath, [cli.pathname, 'db', 'reset', '--dry-run', '--json'], { cwd: root.pathname, env, encoding: 'utf8' }));
    assert.equal(selected, app);
    assert.equal(preview.dbPath, join(app, 'hydra.db'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
