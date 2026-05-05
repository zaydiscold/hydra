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

  const userDB = path.join(userData, 'hydra.db');

  // If userData already has a real hydra.db (not just Electron artifacts), skip
  if (existsSync(userDB) && statSync(userDB).size > 4096) {
    console.log('[MIGRATION] User database exists, skipping');
    return;
  }

  // If legacy dir doesn't exist, nothing to migrate
  if (!existsSync(LEGACY_DIR)) {
    mkdirSync(userData, { recursive: true });
    return;
  }

  // Check legacy DB exists
  const legacyDB = path.join(LEGACY_DIR, 'hydra.db');
  if (!existsSync(legacyDB)) {
    mkdirSync(userData, { recursive: true });
    return;
  }

  mkdirSync(userData, { recursive: true });

  // Copy the database first (most important)
  copyFileSync(legacyDB, userDB);
  console.log(`[MIGRATION] Copied hydra.db (${statSync(legacyDB).size} bytes)`);

  // Copy remaining files (secrets, proxy-gate, redemption-log)
  const files = readdirSync(LEGACY_DIR);
  for (const file of files) {
    if (file === 'hydra.db') continue; // already copied
    const src = path.join(LEGACY_DIR, file);
    const dest = path.join(userData, file);
    if (statSync(src).isFile()) {
      copyFileSync(src, dest);
      console.log(`[MIGRATION] Copied ${file}`);
    }
  }

  console.log(`[MIGRATION] Migration complete — ${userDB}`);
}
