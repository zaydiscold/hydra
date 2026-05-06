/**
 * Hydra Electron schema sync orchestrator.
 *
 * Hashing, locking, and self-heal replay live in focused sibling modules so
 * this file only coordinates the boot-time flow.
 */
import fs from 'node:fs';
import { SCHEMA_PATH, PRISMA_BIN, APP_ROOT, isDev } from './env.js';
import { computeSchemaContentHash, markSchemaSynced, shouldSyncSchema } from './schemaHash.js';
import { runSelfHealSync } from './schemaSelfHeal.js';

export { computeSchemaContentHash, markSchemaSynced, shouldSyncSchema };

/**
 * Sync the database schema, trying local prisma / npx first, then self-heal.
 * @param {Set} trackedChildren - spawned child processes to track for cleanup
 */
export async function syncSchemaWithFallback(trackedChildren) {
  const decision = await shouldSyncSchema();
  if (!decision.shouldSync) {
    console.log('[electron] schema unchanged — skipping sync');
    return;
  }
  console.log('[electron] schema changed — syncing');

  const { execFile } = await import('node:child_process');
  const tryPushAsync = (label, bin, args, cwd) => new Promise((resolve) => {
    const child = execFile(bin, args, { cwd, env: process.env, timeout: 30000 }, (err, _stdout, stderr) => {
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

  if (!isDev) {
    if (await runSelfHealSync()) await markSchemaSynced(decision);
    return;
  }

  if (fs.existsSync(PRISMA_BIN)) {
    if (await tryPushAsync('local prisma', PRISMA_BIN, ['db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
      await markSchemaSynced(decision);
      return;
    }
  } else {
    console.warn(`[electron] local prisma not found at ${PRISMA_BIN}`);
  }

  if (await tryPushAsync('npx', 'npx', ['prisma', 'db', 'push', '--skip-generate', `--schema=${SCHEMA_PATH}`], APP_ROOT)) {
    await markSchemaSynced(decision);
    return;
  }

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
