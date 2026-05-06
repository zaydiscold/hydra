import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { MIGRATIONS_DIR } from './env.js';
import { acquireMigrationLock } from './schemaLock.js';

async function checkpointWal(dbPath) {
  const { execFile } = await import('node:child_process');
  await new Promise((resolve) => {
    const child = execFile('sqlite3', [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], { timeout: 15_000 }, () => resolve());
    child.once('error', () => resolve());
  });
}

function backupDatabase(dbPath) {
  const backupPath = `${dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backupPath);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = dbPath + suffix;
    if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, backupPath + suffix);
  }
  console.log(`[electron] backed up database (with WAL/SHM) before self-heal: ${backupPath}`);
}

function pruneOldBackups(userDataDir) {
  try {
    const backups = fs.readdirSync(userDataDir)
      .filter(f => /^hydra\.db\.backup-/.test(f))
      .map(f => ({ name: f, path: path.join(userDataDir, f) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    while (backups.length > 5) {
      const old = backups.shift();
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(old.path + suffix); } catch { /* file may not exist */ }
      }
      console.log(`[electron] pruned old backup: ${old.name}`);
    }
  } catch (e) {
    console.warn('[electron] failed to prune old backups:', e.message);
  }
}

export async function runSelfHealSync() {
  console.warn('[electron] falling back to db-self-heal');
  const userData = app.getPath('userData');
  const lockPath = path.join(userData, 'hydra.db.migration.lock');
  let lockFd = null;
  try {
    try {
      lockFd = await acquireMigrationLock(lockPath);
    } catch (e) {
      if (e.code === 'EEXIST') return false;
      throw e;
    }

    const dbPath = path.join(userData, 'hydra.db');
    if (fs.existsSync(dbPath)) {
      await checkpointWal(dbPath);
      backupDatabase(dbPath);
      pruneOldBackups(userData);
    }

    const { runSelfHeal } = await import('../../server/lib/db-self-heal.js');
    const summary = await runSelfHeal({ dbPath, migrationsDir: MIGRATIONS_DIR, log: (m) => console.log(m) });
    console.log(`[electron] db-self-heal: ${summary.applied} applied, ${summary.skipped} already present, ${summary.errors} errors`);
    if (summary.errors > 0) console.error('[electron] db-self-heal errors:\n  ' + summary.errorDetails.join('\n  '));
    fs.closeSync(lockFd);
    lockFd = null;
    fs.unlinkSync(lockPath);
    return summary.errors === 0;
  } catch (e) {
    console.error('[electron] db-self-heal failed completely:', e.message);
    try {
      if (lockFd !== null) fs.closeSync(lockFd);
      fs.unlinkSync(lockPath);
    } catch { /* best effort */ }
    return false;
  }
}
