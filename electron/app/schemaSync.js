/**
 * Hydra Electron — Schema Sync
 *
 * Content-hash-based schema change detection, prisma db push with fallback
 * to self-heal replay, and first-launch setup (legacy migration + sync).
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { SCHEMA_PATH, MIGRATIONS_DIR, PRISMA_BIN, APP_ROOT, isDev } from './env.js';

/**
 * Hash schema.prisma + every migration's SQL into one sha256.
 * Skips top-level files in `migrations/` (e.g. `migration_lock.toml`) by
 * stat-checking each entry — only iterates the timestamp-prefixed migration
 * *directories*. The previous version called `fs.readdirSync(migration_lock.toml)`
 * which threw `ENOTDIR`.
 *
 * Returns `{ hash, mtimeFingerprint }`. The fingerprint is a stable string
 * derived from each input file's mtime + size; persisted alongside the hash
 * so subsequent boots can use it as a fast-path to skip hashing entirely
 * when nothing on disk has changed.
 */
export async function computeSchemaContentHash() {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  const mtimeParts = [];

  const schemaStat = await fsp.stat(SCHEMA_PATH);
  hash.update(await fsp.readFile(SCHEMA_PATH));
  mtimeParts.push(`schema:${schemaStat.mtimeMs}:${schemaStat.size}`);

  const entries = (await fsp.readdir(MIGRATIONS_DIR)).sort();
  for (const name of entries) {
    const full = path.join(MIGRATIONS_DIR, name);
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const files = (await fsp.readdir(full)).sort();
    for (const f of files) {
      const filePath = path.join(full, f);
      let fileStat;
      try { fileStat = await fsp.stat(filePath); } catch { continue; }
      hash.update(name + '/' + f);
      hash.update(await fsp.readFile(filePath));
      mtimeParts.push(`${name}/${f}:${fileStat.mtimeMs}:${fileStat.size}`);
    }
  }
  return { hash: hash.digest('hex'), mtimeFingerprint: mtimeParts.join('|') };
}

/**
 * Fingerprint just the mtimes/sizes of the files we'd hash. ~100x cheaper
 * than reading every byte. Used as a fast-path in `shouldSyncSchema` so
 * repeated boots with no schema changes skip the actual hash computation.
 */
async function computeMtimeFingerprint() {
  const parts = [];
  const schemaStat = await fsp.stat(SCHEMA_PATH);
  parts.push(`schema:${schemaStat.mtimeMs}:${schemaStat.size}`);
  const entries = (await fsp.readdir(MIGRATIONS_DIR)).sort();
  for (const name of entries) {
    const full = path.join(MIGRATIONS_DIR, name);
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const files = (await fsp.readdir(full)).sort();
    for (const f of files) {
      const filePath = path.join(full, f);
      try {
        const fStat = await fsp.stat(filePath);
        parts.push(`${name}/${f}:${fStat.mtimeMs}:${fStat.size}`);
      } catch { /* skip */ }
    }
  }
  return parts.join('|');
}

/**
 * Decide whether the DB schema needs syncing. Returns `{ shouldSync, hash }`
 * where `hash` is the freshly-computed content hash (or null when skipping
 * because mtime didn't change). Threading the hash through to the caller
 * means `markSchemaSynced` doesn't have to redo the work — the entire
 * 50-300 ms hash pipeline used to run TWICE on every "needs sync" boot.
 */
export async function shouldSyncSchema() {
  try {
    const userData = app.getPath('userData');
    const sentinelPath = path.join(userData, '.schema-version');
    const fingerprintPath = path.join(userData, '.schema-mtimes');

    // Fast path: if mtime fingerprint matches sentinel, skip both hash *and*
    // file read. Reading file mtimes only — no content I/O.
    let storedFingerprint = null;
    try { storedFingerprint = (await fsp.readFile(fingerprintPath, 'utf-8')).trim(); } catch { /* missing → fall through */ }
    if (storedFingerprint) {
      const currentFingerprint = await computeMtimeFingerprint();
      if (currentFingerprint === storedFingerprint) {
        // mtimes match → schema files unchanged → no sync needed, no hash needed.
        return { shouldSync: false, hash: null };
      }
    }

    // Slow path: actually hash. Either no fingerprint sentinel yet, or mtime
    // changed (which usually but not always means content changed — e.g. a
    // `touch` would invalidate fingerprint without changing the hash).
    const { hash, mtimeFingerprint } = await computeSchemaContentHash();
    let stored = '';
    try { stored = (await fsp.readFile(sentinelPath, 'utf-8')).trim(); } catch { /* fall through */ }
    return {
      shouldSync: stored !== hash,
      hash,
      mtimeFingerprint,
    };
  } catch {
    return { shouldSync: true, hash: null };
  }
}

/**
 * Persist the schema-version sentinel + mtime fingerprint. Accepts a
 * pre-computed hash from `shouldSyncSchema()` to avoid re-hashing.
 *
 * @param {object} [opts]
 * @param {string} [opts.hash] - hex sha256 from shouldSyncSchema; if missing,
 *   we recompute (e.g. when self-heal succeeds without the orchestrator
 *   keeping the prior result)
 * @param {string} [opts.mtimeFingerprint] - companion fingerprint for fast-path
 */
export async function markSchemaSynced(opts = {}) {
  try {
    let { hash, mtimeFingerprint } = opts;
    if (!hash || !mtimeFingerprint) {
      const fresh = await computeSchemaContentHash();
      hash = hash || fresh.hash;
      mtimeFingerprint = mtimeFingerprint || fresh.mtimeFingerprint;
    }
    const userData = app.getPath('userData');
    await fsp.writeFile(path.join(userData, '.schema-version'), hash);
    await fsp.writeFile(path.join(userData, '.schema-mtimes'), mtimeFingerprint);
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
    const raw = await fsp.readFile(lockPath, 'utf-8');
    const [pidStr, tsStr] = raw.trim().split(':');
    const pid = Number(pidStr);
    const ts = Number(tsStr);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(ts)) return null;
    return { pid, ts };
  } catch { return null; }
}

async function isPidAlive(pid) {
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
    // On Windows, signal 0 is not supported — we use tasklist instead.
    if (process.platform === 'win32') {
      const { execFileSync } = await import('node:child_process');
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
        timeout: 3000,
        encoding: 'utf-8',
        windowsHide: true,
      });
      // tasklist output contains the PID if the process exists
      return out.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

async function acquireMigrationLock(lockPath) {
  if (fs.existsSync(lockPath)) {
    const payload = await readLockPayload(lockPath);
    const isStale =
      payload &&
      (Date.now() - payload.ts > LOCK_TTL_MS || !(await isPidAlive(payload.pid)));
    if (isStale) {
      console.warn(
        `[electron] migration lock at ${lockPath} is stale ` +
        `(pid=${payload.pid}, age=${Date.now() - payload.ts}ms) — breaking lock`,
      );
      try { fs.unlinkSync(lockPath); } catch { /* another process may have cleaned it */ }
    }
  }

  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeSync(fd, `${process.pid}:${Date.now()}`);
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
    try {
      lockFd = await acquireMigrationLock(lockPath);
    } catch (e) {
      if (e.code === 'EEXIST') return false;
      throw e;
    }
    const { runSelfHeal } = await import('../../server/lib/db-self-heal.js');
    const dbPath = path.join(app.getPath('userData'), 'hydra.db');
    if (fs.existsSync(dbPath)) {
      // ── Bug #7 fix: WAL checkpoint + backup WAL/SHM ──────────────
      // Was execFileSync — synchronous, with a 15-second timeout, blocking
      // the Electron main thread (and therefore the splash compositor) for
      // up to 15s if `sqlite3` was missing or hung. Switched to async
      // execFile + promisify so the splash keeps animating while sqlite3
      // does its work or times out.
      const { execFile } = await import('node:child_process');
      await new Promise((resolve) => {
        const child = execFile(
          'sqlite3',
          [dbPath, 'PRAGMA wal_checkpoint(TRUNCATE);'],
          { timeout: 15_000 },
          () => resolve() // ignore err — sqlite3 may not be on PATH; copy below is still useful
        );
        // If the child errors immediately (e.g. ENOENT) `error` fires before
        // exit; resolve there too so we don't hang the chain.
        child.once('error', () => resolve());
      });

      const backupPath = `${dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.copyFileSync(dbPath, backupPath);
      // Also copy WAL/SHM if they exist so the backup is complete
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = dbPath + suffix;
        if (fs.existsSync(sidecar)) {
          fs.copyFileSync(sidecar, backupPath + suffix);
        }
      }
      console.log(`[electron] backed up database (with WAL/SHM) before self-heal: ${backupPath}`);

      // #49: Prune old backups — keep only the 5 most recent to prevent
      // unbounded disk accumulation across repeated self-heal runs.
      try {
        const userDataDir = app.getPath('userData');
        const backupPattern = /^hydra\.db\.backup-/;
        const backups = fs.readdirSync(userDataDir)
          .filter(f => backupPattern.test(f))
          .map(f => ({ name: f, path: path.join(userDataDir, f) }))
          .sort((a, b) => a.name.localeCompare(b.name)); // ISO timestamps sort lexicographically
        while (backups.length > 5) {
          const old = backups.shift();
          // Remove the main backup + any WAL/SHM sidecars
          for (const suffix of ['', '-wal', '-shm']) {
            const p = old.path + suffix;
            try { fs.unlinkSync(p); } catch { /* file may not exist */ }
          }
          console.log(`[electron] pruned old backup: ${old.name}`);
        }
      } catch (pruneErr) {
        console.warn('[electron] failed to prune old backups:', pruneErr.message);
      }
    }
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
  // Single hash computation per boot. shouldSyncSchema() now returns the
  // hash + mtime fingerprint so markSchemaSynced() can reuse them — used to
  // recompute identical work twice on every changed-schema boot.
  const decision = await shouldSyncSchema();
  if (!decision.shouldSync) {
    console.log('[electron] schema unchanged — skipping sync');
    return;
  }
  console.log('[electron] schema changed — syncing');

  const { execFile } = await import('node:child_process');
  

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
      await markSchemaSynced(decision);
    }
    return;
  }

  // 1. Local prisma binary (dev only)
  if (fs.existsSync(PRISMA_BIN)) {
    if (await tryPushAsync('local prisma', PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
      await markSchemaSynced(decision);
      return;
    }
  } else {
    console.warn(`[electron] local prisma not found at ${PRISMA_BIN}`);
  }

  // 2. npx (dev only — packaged apps rarely have npx on PATH)
  if (isDev) {
    if (await tryPushAsync('npx', 'npx', ['prisma', 'db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
      await markSchemaSynced(decision);
      return;
    }
  }

  // 3. Self-heal: replay migration SQL idempotently
  if (await runSelfHealSync()) await markSchemaSynced(decision);
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
