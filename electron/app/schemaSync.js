/**
 * Hydra Electron — Schema Sync (sentinel + fallback chain)
 *
 * Content-hash schema.prisma + migration SQL files against a sentinel
 * in userData to avoid running sync on every launch.
 */
import path from 'node:path';
import { SCHEMA_PATH, MIGRATIONS_DIR, APP_ROOT, PRISMA_BIN, isDev } from './env.js';
import { trackedChildren } from './state.js';

/**
 * Hash schema.prisma + every migration's SQL into one sha256.
 * Only iterates timestamp-prefixed migration directories (skips
 * top-level files like migration_lock.toml).
 */
async function computeSchemaContentHash() {
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

async function shouldSyncSchema() {
  try {
    const currentHash = await computeSchemaContentHash();
    const { readFileSync } = await import('node:fs');
    const sentinel = path.join(process.env.HYDRA_DATA_DIR || '', '.schema-version');
    const stored = readFileSync(sentinel, 'utf-8').trim();
    return stored !== currentHash;
  } catch {
    return true;
  }
}

async function markSchemaSynced() {
  try {
    const currentHash = await computeSchemaContentHash();
    const { writeFileSync } = await import('node:fs');
    const sentinel = path.join(process.env.HYDRA_DATA_DIR || '', '.schema-version');
    writeFileSync(sentinel, currentHash);
  } catch (e) {
    console.warn('[electron] failed to write schema-version sentinel:', e.message);
  }
}

async function syncSchemaWithFallback() {
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

  // Packaged apps: self-heal is the only reliable path
  if (!isDev) {
    if (await runSelfHealSync()) await markSchemaSynced();
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

  // 2. npx (dev only)
  if (await tryPushAsync('npx', 'npx', ['prisma', 'db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
    await markSchemaSynced();
    return;
  }

  // 3. Self-heal: replay migration SQL idempotently
  if (await runSelfHealSync()) await markSchemaSynced();
}

async function runSelfHealSync() {
  console.warn('[electron] falling back to db-self-heal');
  try {
    const { runSelfHeal } = await import('../server/lib/db-self-heal.js');
    const dbPath = path.join(process.env.HYDRA_DATA_DIR || '', 'hydra.db');
    const summary = await runSelfHeal({ dbPath, migrationsDir: MIGRATIONS_DIR, log: (m) => console.log(m) });
    console.log(`[electron] db-self-heal: ${summary.applied} applied, ${summary.skipped} already present, ${summary.errors} errors`);
    if (summary.errors > 0) console.error('[electron] db-self-heal errors:\n  ' + summary.errorDetails.join('\n  '));
    return summary.errors === 0;
  } catch (e) {
    console.error('[electron] db-self-heal failed completely:', e.message);
    return false;
  }
}

export async function firstLaunchSetup() {
  try {
    const { migrateIfNeeded } = await import('../utils/migrateLegacyData.js');
    await migrateIfNeeded();
  } catch (e) {
    console.warn('[electron] Legacy data migration skipped:', e.message);
  }
  await syncSchemaWithFallback();
}
