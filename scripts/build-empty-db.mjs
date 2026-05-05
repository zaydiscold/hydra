/**
 * build-empty-db.mjs
 *
 * Generates an empty SQLite database from the Prisma schema and saves it
 * to a known location (data/empty-hydra.db) for electron-builder extraResources.
 *
 * This lets the packaged Electron app ship a pre-initialized blank database
 * so that the first launch doesn't need to run migrations against a non-existent
 * database file. On first run the app copies empty-hydra.db to the user's
 * platform-native data directory.
 *
 * Usage:
 *   node scripts/build-empty-db.mjs
 *
 * Prerequisites:
 *   - Prisma client must be generated (`npx prisma generate`)
 *   - A valid DATABASE_URL is needed; we override it for this build step
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const EMPTY_DB_PATH = resolve(DATA_DIR, 'empty-hydra.db');
const SCHEMA_PATH = resolve(PROJECT_ROOT, 'prisma/schema.prisma');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

console.log(`[build-empty-db] Generating empty SQLite database...`);
console.log(`[build-empty-db] Schema: ${SCHEMA_PATH}`);
console.log(`[build-empty-db] Output: ${EMPTY_DB_PATH}`);

// Push the schema to a temporary database file, creating all tables (empty)
const tempDb = resolve(DATA_DIR, '.hydra-empty-temp.db');
try {
  execSync(
    `npx prisma db push --schema="${SCHEMA_PATH}" --accept-data-loss --force-reset`,
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: `file:${tempDb}`,
      },
      stdio: 'pipe',
      timeout: 60_000,
    },
  );

  // Copy the freshly-pushed database to the final empty-db path
  copyFileSync(tempDb, EMPTY_DB_PATH);

  console.log(`[build-empty-db] Done — empty database created at ${EMPTY_DB_PATH}`);
} catch (err) {
  console.error(`[build-empty-db] Failed: ${err.stderr || err.message}`);
  process.exit(1);
} finally {
  // Clean up the temporary database
  try {
    if (existsSync(tempDb)) {
      execSync(`rm -f "${tempDb}" "${tempDb}-journal" "${tempDb}-wal" "${tempDb}-shm"`);
    }
  } catch {
    // best effort cleanup
  }
}
