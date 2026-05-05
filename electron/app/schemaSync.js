/**
 * Hydra Electron — Schema Sync
 *
 * Content-hash-based schema change detection, prisma db push with fallback
 * to self-heal replay, and first-launch setup (legacy migration + sync).
 */
import { app } from 'electron';
import path from 'node:path';
import { SCHEMA_PATH, MIGRATIONS_DIR, PRISMA_BIN, APP_ROOT, isDev } from './env.js';

/**
 * Hash schema.prisma + every migration's SQL into one sha256.
 * Skips top-level files in `migrations/` (e.g. `migration_lock.toml`) by
 * stat-checking each entry — only iterates the timestamp-prefixed migration
 * *directories*. The previous version called `readdirSync(migration_lock.toml)`
 * which threw `ENOTDIR`.
 */
export async function computeSchemaContentHash() {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  hash.update(readFileSync(SCHEMA_PATH));
  const entries = readdirSync(MIGRATIONS_DIR).sort();
  for (const name of entries) {
    const full = path.join(MIGRATIONS_DIR, name);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { /* skip dangling */ }
    if (!isDir) continue;
    const files = readdirSync(full).sort();
    for (const f of files) {
      hash.update(name + '/' + f);
      hash.update(readFileSync(path.join(full, f)));
    }
  }
  return hash.digest('hex');
}

export async function shouldSyncSchema() {
  try {
    const currentHash = await computeSchemaContentHash();
    const { readFileSync } = await import('node:fs');
    const sentinel = path.join(app.getPath('userData'), '.schema-version');
    const stored = readFileSync(sentinel, 'utf-8').trim();
    return stored !== currentHash;
  } catch {
    return true;
  }
}

export async function markSchemaSynced() {
  try {
    const currentHash = await computeSchemaContentHash();
    const { writeFileSync } = await import('node:fs');
    const sentinel = path.join(app.getPath('userData'), '.schema-version');
    writeFileSync(sentinel, currentHash);
  } catch (e) {
    console.warn('[electron] failed to write schema-version sentinel:', e.message);
  }
}

/**
 * PID-based migration lock with TTL / stale-lock detection.
 *
 * The lock file contains `PID:TIMESTAMP`.  On acquisition we check:
 *  - Is the PID still alive?  (process.kill(pid, 0) on POSIX)
 *  - Has the lock exceeded LOCK_TTL (60 s)?
 *
 * If either is true the lock is considered stale and we break it.
 * This prevents a crash-during-self-heal from permanently blocking future
 * schema syncs (the orphaned-lock bug).
 */
const LOCK_TTL_MS = 60_000;

async function readLockPayload(lockPath) {
  try {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(lockPath, 'utf-8');
    const [pidStr, tsStr] = raw.trim().split(':');
    return { pid: Number(pidStr), ts: Number(tsStr) };
  } catch { return null; }
}

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  // #92: process.kill(pid, 0) is POSIX-only. On Windows it always throws
  // EPERM, which made isPidAlive() always return false — meaning orphaned
  // migration locks were only cleaned by TTL expiry (60s), not by PID check.
  // On Windows we use a different approach: check if the process exists via
  // tasklist or by attempting to open it.
  if (process.platform === 'win32') {
    try {
      // On Windows, process.kill with any signal besides 0 will throw
      // if the process doesn't exist. We try kill(pid) which throws
      // ESRCH if the pid doesn't exist, and EPERM if it does.
      process.kill(pid, 0);
      // If we reach here on Windows, the pid exists (unusual, but possible
      // with certain privileges). Fall through.
    } catch (e) {
      // On Windows: EPERM usually means the process exists (no permission
      // to signal it). ESRCH means the process does NOT exist.
      if (e.code === 'EPERM') return true;
      return false;
    }
  }
  try {
    // Signal 0 does not kill; it just checks existence (POSIX).
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

async function acquireMigrationLock(lockPath) {
  const { openSync, writeSync, closeSync, unlinkSync, existsSync } = await import('node:fs');

  if (existsSync(lockPath)) {
    const payload = await readLockPayload(lockPath);
    const isStale =
      payload &&
      (Date.now() - payload.ts > LOCK_TTL_MS || !isPidAlive(payload.pid));
    if (isStale) {
      console.warn(
        `[electron] migration lock at ${lockPath} is stale ` +
        `(pid=${payload.pid}, age=${Date.now() - payload.ts}ms) — breaking lock`,
      );
      try { unlinkSync(lockPath); } catch { /* another process may have cleaned it */ }
    }
  }

  try {
    const fd = openSync(lockPath, 'wx');
    writeSync(fd, `${process.pid}:${Date.now()}`);
    return fd;
  } catch (e) {
    if (e.code === 'EEXIST') {
      // If we tried to break a stale lock but another process re-created it,
      // treat as genuinely locked (don't loop — avoid lock contention).
      console.warn(`[electron] migration lock held by another process at ${lockPath}; skipping db-self-heal`);
    }
    throw e;
  }
}

async function runSelfHealSync() {
  console.warn('[electron] falling back to db-self-heal');
  const lockPath = path.join(app.getPath('userData'), 'hydra.db.migration.lock');
  let lockFd = null;
  try {
    const { closeSync, copyFileSync, existsSync, unlinkSync } = await import('node:fs');
    try {
      lockFd = await acquireMigrationLock(lockPath);
    } catch (e) {
      if (e.code === 'EEXIST') return false;
      throw e;
    }
    const { runSelfHeal } = await import('../../server/lib/db-self-heal.js');
    const dbPath = path.join(app.getPath('userData'), 'hydra.db');
    if (existsSync(dbPath)) {
      // ── Bug #7 fix: WAL checkpoint + backup WAL/SHM ──────────────
      const { execFileSync } = await import('node:child_process');
      try {
        execFileSync('sqlite3', [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'], {
          stdio: 'pipe',
          timeout: 15_000,
        });
      } catch {
        // sqlite3 may not be available; the copy is still useful without checkpoint
      }

      const backupPath = `${dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      copyFileSync(dbPath, backupPath);
      // Also copy WAL/SHM if they exist so the backup is complete
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = dbPath + suffix;
        if (existsSync(sidecar)) {
          copyFileSync(sidecar, backupPath + suffix);
        }
      }
      console.log(`[electron] backed up database (with WAL/SHM) before self-heal: ${backupPath}`);
    }
    const summary = await runSelfHeal({ dbPath, migrationsDir: MIGRATIONS_DIR, log: (m) => console.log(m) });
    console.log(`[electron] db-self-heal: ${summary.applied} applied, ${summary.skipped} already present, ${summary.errors} errors`);
    if (summary.errors > 0) console.error('[electron] db-self-heal errors:\n  ' + summary.errorDetails.join('\n  '));
    closeSync(lockFd);
    lockFd = null;
    unlinkSync(lockPath);
    return summary.errors === 0;
  } catch (e) {
    console.error('[electron] db-self-heal failed completely:', e.message);
    try {
      const { closeSync, unlinkSync } = await import('node:fs');
      if (lockFd !== null) closeSync(lockFd);
      unlinkSync(lockPath);
    } catch {
      // Best-effort lock cleanup.
    }
    return false;
  }
}

/**
 * Sync the database schema, trying local prisma / npx first, then self-heal.
 * @param {Set} trackedChildren - set of spawned child processes to track for cleanup
 */
export async function syncSchemaWithFallback(trackedChildren) {
  if (!(await shouldSyncSchema())) {
    console.log('[electron] schema unchanged — skipping sync');
    return;
  }
  console.log('[electron] schema changed — syncing');

  const { execFile } = await import('node:child_process');
  const { existsSync } = await import('node:fs');

  const tryPushAsync = (label, bin, args, cwd) => new Promise((resolve) => {
    const child = execFile(bin, args, { cwd, env: process.env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn(`[electron] schema sync via ${label} failed: ${err.message}${stderr ? '\n' + stderr.trim() : ''}`);
        resolve(false);
      } else {
        console.log(`[electron] schema synced (${label})`);
        resolve(true);
      }
    });
    trackedChildren.add(child);
    child.on('exit', () => trackedChildren.delete(child));
  });

  // Packaged apps do not reliably ship a usable Prisma CLI/.bin shim.
  // Use the embedded self-heal path first there; reserve CLI sync for dev.
  if (!isDev) {
    if (await runSelfHealSync()) {
      await markSchemaSynced();
    }
    return;
  }

  // 1. Local prisma binary (dev only)
  if (existsSync(PRISMA_BIN)) {
    if (await tryPushAsync('local prisma', PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
      await markSchemaSynced();
      return;
    }
  } else {
    console.warn(`[electron] local prisma not found at ${PRISMA_BIN}`);
  }

  // 2. npx (dev only — packaged apps rarely have npx on PATH)
  if (isDev) {
    if (await tryPushAsync('npx', 'npx', ['prisma', 'db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
      await markSchemaSynced();
      return;
    }
  }

  // 3. Self-heal: replay migration SQL idempotently
  if (await runSelfHealSync()) await markSchemaSynced();
}

export async function firstLaunchSetup(trackedChildren) {
  try {
    const { migrateIfNeeded } = await import('../utils/migrateLegacyData.js');
    await migrateIfNeeded();
  } catch (e) {
    console.warn('[electron] Legacy data migration skipped:', e.message);
  }
  await syncSchemaWithFallback(trackedChildren);
}
