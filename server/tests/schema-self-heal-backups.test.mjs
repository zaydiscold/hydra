import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

mock.module('electron', {
  namedExports: {
    app: {
      getPath(name) {
        assert.equal(name, 'userData');
        return mkdtempSync(join(tmpdir(), 'hydra-schema-backups-user-data-'));
      },
    },
  },
});

const { backupDatabase, pruneOldBackups } = await import('../../electron/app/schemaSelfHeal.js');

function listNames(dir) {
  return readdirSync(dir).sort();
}

test('backupDatabase copies db plus WAL/SHM sidecars and returns the root backup path', () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'hydra-schema-backup-copy-'));
  const dbPath = join(userDataDir, 'hydra.db');
  writeFileSync(dbPath, 'db', 'utf-8');
  writeFileSync(`${dbPath}-wal`, 'wal', 'utf-8');
  writeFileSync(`${dbPath}-shm`, 'shm', 'utf-8');

  const backupPath = backupDatabase(dbPath);
  const names = listNames(userDataDir);

  assert.match(backupPath, /hydra\.db\.backup-/);
  assert.ok(names.includes(backupPath.split('/').at(-1)));
  assert.ok(names.includes(`${backupPath.split('/').at(-1)}-wal`));
  assert.ok(names.includes(`${backupPath.split('/').at(-1)}-shm`));
});

test('pruneOldBackups keeps the newest five backup roots and their sidecars only', () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'hydra-schema-backup-prune-'));
  for (let i = 0; i < 7; i += 1) {
    const stamp = `2026-05-16T05-3${i}-00-000Z`;
    const root = join(userDataDir, `hydra.db.backup-${stamp}`);
    writeFileSync(root, `db-${i}`, 'utf-8');
    writeFileSync(`${root}-wal`, `wal-${i}`, 'utf-8');
    writeFileSync(`${root}-shm`, `shm-${i}`, 'utf-8');
  }

  pruneOldBackups(userDataDir);
  const names = listNames(userDataDir).filter((name) => name.startsWith('hydra.db.backup-'));
  const roots = names.filter((name) => !/-(?:wal|shm)$/.test(name));

  assert.equal(roots.length, 5);
  assert.deepEqual(roots, [
    'hydra.db.backup-2026-05-16T05-32-00-000Z',
    'hydra.db.backup-2026-05-16T05-33-00-000Z',
    'hydra.db.backup-2026-05-16T05-34-00-000Z',
    'hydra.db.backup-2026-05-16T05-35-00-000Z',
    'hydra.db.backup-2026-05-16T05-36-00-000Z',
  ]);

  for (const root of roots) {
    assert.ok(names.includes(`${root}-wal`), `${root}-wal should remain`);
    assert.ok(names.includes(`${root}-shm`), `${root}-shm should remain`);
  }
  assert.equal(names.some((name) => name.includes('05-30') || name.includes('05-31')), false);
});

test('self-heal cleanup and checkpoint fallbacks leave warning evidence', () => {
  const source = readFileSync(join(ROOT, 'electron/app/schemaSelfHeal.js'), 'utf-8');

  assert.match(source, /WAL checkpoint failed before self-heal: \$\{err\.message\}/);
  assert.match(source, /WAL checkpoint process failed before self-heal: \$\{err\.message\}/);
  assert.match(source, /failed to prune old backup \$\{label\}: \$\{e\.message\}/);
  assert.match(source, /failed to close migration lock after self-heal failure: \$\{e\.message\}/);
  assert.match(source, /failed to remove migration lock after self-heal failure: \$\{e\.message\}/);
  assert.doesNotMatch(source, /catch \{ \/\* best effort \*\/ \}/);
  assert.doesNotMatch(source, /catch \{ \/\* file may not exist \*\/ \}/);
});
