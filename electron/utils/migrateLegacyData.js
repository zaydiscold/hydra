/**
 * Hydra Legacy Data Migration
 *
 * One-time migration: copies files from ./data/ (legacy CWD-relative dir) to
 * the platform-native userData path on first Electron launch.
 *
 * Idempotent: if userData already has a real hydra.db with accounts, the
 * migration is skipped. If the legacy dir doesn't exist, userData is created
 * empty. Safe to call multiple times.
 *
 * All I/O is async (fs/promises) to avoid blocking the Electron event loop.
 */
import { mkdir, copyFile, readdir, lstat, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const LEGACY_DIR = path.join(process.cwd(), 'data');

function isNotFoundError(err) {
  return err?.code === 'ENOENT' || err?.code === 'ENOTDIR';
}

function isMissingAccountTableError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  return message.includes('no such table') || (message.includes('account') && message.includes('does not exist'));
}

async function pathExists(pathToCheck, label) {
  try {
    await access(pathToCheck, fsConstants.F_OK);
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    console.warn(`[MIGRATION] Could not inspect ${label}, skipping migration: ${err?.message || err}`);
    throw err;
  }
}

/**
 * Check whether the database at dbPath already contains account records.
 * Uses a raw Prisma query so it works even before prisma db push has run
 * (the query will fail if the Account table doesn't exist, which is
 * treated as "no accounts" and migration should proceed).
 *
 * @param {string} dbPath - Absolute path to the SQLite database file
 * @returns {Promise<boolean>} true if the Account table exists
 */
async function hasAccounts(dbPath) {
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
  try {
    await prisma.$queryRaw`SELECT COUNT(*) as count FROM Account`;
    return true; // query succeeded → table exists → DB is initialized
  } catch (err) {
    if (isMissingAccountTableError(err)) {
      return false; // table doesn't exist → DB is uninitialized
    }
    console.warn(`[MIGRATION] Could not inspect database accounts for ${dbPath}, skipping migration: ${err?.message || err}`);
    throw err;
  } finally {
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.warn(`[MIGRATION] Prisma disconnect after account inspection failed: ${err?.message || err}`);
    }
  }
}

export async function migrateIfNeeded() {
  const userData = process.env.HYDRA_DATA_DIR;
  if (!userData) return;

  const userDB = path.join(userData, 'hydra.db');

  // ─── Check if userData DB already has accounts ──────────────────────────
  try {
    const dbExists = await pathExists(userDB, 'user database');
    if (dbExists && (await hasAccounts(userDB))) {
      console.log('[MIGRATION] User database already initialized, skipping');
      return;
    }
  } catch (err) {
    // If we can't determine state, log and skip migration to be safe
    console.warn('[MIGRATION] Could not check user database state, skipping:', err.message);
    return;
  }

  // ─── Ensure legacy dir exists ───────────────────────────────────────────
  try {
    const legacyExists = await pathExists(LEGACY_DIR, 'legacy data directory');
    if (!legacyExists) {
      try {
        await mkdir(userData, { recursive: true });
      } catch (err) {
        console.warn('[MIGRATION] Could not create userData directory:', err.message);
      }
      return;
    }
  } catch {
    return;
  }

  // ─── Check legacy DB exists ─────────────────────────────────────────────
  const legacyDB = path.join(LEGACY_DIR, 'hydra.db');
  try {
    const legacyDbExists = await pathExists(legacyDB, 'legacy hydra.db');
    if (!legacyDbExists) {
      try {
        await mkdir(userData, { recursive: true });
      } catch (err) {
        console.warn('[MIGRATION] Could not create userData directory:', err.message);
      }
      return;
    }
  } catch {
    return;
  }

  try {
    if (!(await hasAccounts(legacyDB))) {
      console.warn('[MIGRATION] Legacy hydra.db has no Account table; skipping migration');
      return;
    }
  } catch {
    return;
  }

  // ─── Ensure userData directory exists ───────────────────────────────────
  try {
    await mkdir(userData, { recursive: true });
  } catch (err) {
    console.warn('[MIGRATION] Could not create userData directory:', err.message);
    return;
  }

  // ─── Copy the database first (most important) ───────────────────────────
  try {
    await copyFile(legacyDB, userDB);
    console.log(`[MIGRATION] Copied hydra.db to ${userDB}`);
  } catch (err) {
    console.error('[MIGRATION] Failed to copy hydra.db:', err.message);
    return; // DB is critical — if we can't copy it, abort entire migration
  }

  // ─── Copy remaining files (secrets, proxy-gate, redemption-log) ─────────
  let files;
  try {
    files = await readdir(LEGACY_DIR);
  } catch (err) {
    console.warn('[MIGRATION] Could not read legacy directory:', err.message);
    console.log('[MIGRATION] Migration partially complete — hydra.db copied');
    return;
  }

  for (const file of files) {
    if (file === 'hydra.db') continue; // already copied

    const src = path.join(LEGACY_DIR, file);
    const dest = path.join(userData, file);

    // Use lstat to detect symlinks — skip them, only copy regular files
    let fileStat;
    try {
      fileStat = await lstat(src);
    } catch (err) {
      console.warn(`[MIGRATION] Could not stat ${file}, skipping:`, err.message);
      continue;
    }

    if (fileStat.isSymbolicLink()) {
      console.log(`[MIGRATION] Skipping symlink ${file}`);
      continue;
    }

    if (!fileStat.isFile()) continue;

    try {
      await copyFile(src, dest, fsConstants.COPYFILE_EXCL);
      console.log(`[MIGRATION] Copied ${file}`);
    } catch (err) {
      if (err?.code === 'EEXIST') {
        console.warn(`[MIGRATION] Destination ${file} already exists, leaving it untouched`);
      } else {
        console.warn(`[MIGRATION] Failed to copy ${file}:`, err.message);
      }
    }
  }

  console.log(`[MIGRATION] Migration complete — ${userDB}`);
}
