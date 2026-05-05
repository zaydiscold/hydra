/**
 * Hydra Legacy Data Migration
 *
 * One-time migration: copies files from ./data/ (legacy CWD-relative dir) to
 * the platform-native userData path on first Electron launch.
 *
 * Idempotent: if userData already contains files, the migration is skipped.
 * If the legacy dir doesn't exist, userData is created empty.
 * Safe to call multiple times.
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const LEGACY_DIR = path.join(process.cwd(), 'data');

export async function migrateIfNeeded() {
  const userData = process.env.HYDRA_DATA_DIR;
  if (!userData) return;

  // If userData already has files, migration already happened
  if (existsSync(userData) && readdirSync(userData).length > 0) return;

  // If legacy dir doesn't exist, nothing to migrate
  if (!existsSync(LEGACY_DIR)) {
    mkdirSync(userData, { recursive: true });
    return;
  }

  mkdirSync(userData, { recursive: true });

  const files = readdirSync(LEGACY_DIR);
  for (const file of files) {
    const src = path.join(LEGACY_DIR, file);
    const dest = path.join(userData, file);
    const stats = statSync(src);
    if (stats.isFile()) {
      copyFileSync(src, dest);
    }
  }

  console.log(`[MIGRATION] Copied ${files.length} files from ${LEGACY_DIR} to ${userData}`);
}
