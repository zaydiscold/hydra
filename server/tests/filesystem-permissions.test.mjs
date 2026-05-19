import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('ensureDataDirSync creates the runtime data dir owner-only', async () => {
  const previous = process.env.HYDRA_DATA_DIR;
  const parent = await mkdtemp(path.join(os.tmpdir(), 'hydra-data-dir-parent-'));
  const dataDir = path.join(parent, 'data');
  process.env.HYDRA_DATA_DIR = dataDir;

  try {
    const { ensureDataDirSync } = await import(`../lib/data-dir.js?test=${Date.now()}`);
    assert.equal(ensureDataDirSync(), dataDir);
    if (process.platform !== 'win32') {
      assert.equal(statSync(dataDir).mode & 0o777, 0o700);
    }
  } finally {
    if (previous == null) delete process.env.HYDRA_DATA_DIR;
    else process.env.HYDRA_DATA_DIR = previous;
  }
});

test('acquireMigrationLock creates the migration lock owner-only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hydra-migration-lock-'));
  const lockPath = path.join(dir, 'hydra.db.migration.lock');
  const { acquireMigrationLock } = await import('../../electron/app/schemaLock.js');
  const fd = await acquireMigrationLock(lockPath);
  closeSync(fd);

  try {
    if (process.platform !== 'win32') {
      assert.equal(statSync(lockPath).mode & 0o777, 0o600);
    }
  } finally {
    unlinkSync(lockPath);
  }
});

test('acquireMigrationLock breaks stale migration locks before acquiring', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hydra-stale-migration-lock-'));
  const lockPath = path.join(dir, 'hydra.db.migration.lock');
  writeFileSync(lockPath, '999999:0', 'utf-8');

  const { acquireMigrationLock } = await import('../../electron/app/schemaLock.js');
  const fd = await acquireMigrationLock(lockPath);
  closeSync(fd);

  try {
    const [pidStr, tsStr] = readFileSync(lockPath, 'utf-8').trim().split(':');
    assert.equal(Number(pidStr), process.pid);
    assert.ok(Number(tsStr) > 0, 'replacement lock must contain a current timestamp');
  } finally {
    unlinkSync(lockPath);
  }
});

test('schema migration lock has a Windows PID liveness path', () => {
  const src = readFileSync(new URL('../../electron/app/schemaLock.js', import.meta.url), 'utf-8');
  assert.match(src, /process\.platform === 'win32'/);
  assert.match(src, /tasklist/);
  assert.match(src, /\/FI/);
  assert.match(src, /PID eq \$\{pid\}/);
  assert.match(src, /windowsHide: true/);
});

test('filesystem permission fallback failures leave warning evidence', () => {
  const dataDirSrc = readFileSync(new URL('../lib/data-dir.js', import.meta.url), 'utf-8');
  const schemaLockSrc = readFileSync(new URL('../../electron/app/schemaLock.js', import.meta.url), 'utf-8');

  assert.match(dataDirSrc, /chmod 0700 failed/);
  assert.match(dataDirSrc, /logger\.warn/);
  assert.doesNotMatch(dataDirSrc, /catch \{ \/\* best effort on unusual filesystems \*\/ \}/);
  assert.match(schemaLockSrc, /failed to remove stale migration lock/);
  assert.doesNotMatch(schemaLockSrc, /catch \{ \/\* another process may have cleaned it \*\/ \}/);
});
