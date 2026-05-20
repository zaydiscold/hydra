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

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const EMPTY_DB_PATH = resolve(DATA_DIR, 'empty-hydra.db');
const SCHEMA_PATH = resolve(PROJECT_ROOT, 'prisma/schema.prisma');
const PRISMA_DIR = dirname(SCHEMA_PATH);
const PRISMA_CLI = resolve(PROJECT_ROOT, 'node_modules/prisma/build/index.js');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

console.log(`[build-empty-db] Generating empty SQLite database...`);
console.log(`[build-empty-db] Schema: ${SCHEMA_PATH}`);
console.log(`[build-empty-db] Output: ${EMPTY_DB_PATH}`);

// Push the schema to a temporary database file, creating all tables (empty)
const tempDb = resolve(PRISMA_DIR, '.hydra-empty-temp.db');
const tempSql = resolve(DATA_DIR, '.hydra-empty-temp.sql');
const REQUIRED_TABLES = [...readFileSync(SCHEMA_PATH, 'utf-8').matchAll(/^model\s+(\w+)\s*\{/gm)]
  .map((match) => match[1]);
const bootstrapSql = `
-- ⚠️  AUTO-GENERATED FALLBACK — DEPRECATED  ⚠️
-- ───────────────────────────────────────────
-- This SQL is a hand-maintained copy of the schema DDL from
--   prisma/schema.prisma
-- It is ONLY used when \`prisma db push\` fails (e.g., sqlite3 CLI
-- fallback).  It is stale by definition — if you add/change a table,
-- column, index, or constraint in schema.prisma you MUST update this
-- block to match, otherwise the fallback path will create a DB that
-- doesn't reflect the current schema.  Consider this a last resort.
-- Run \`node scripts/validate-fallback-sql.mjs\` to check consistency.
-- ───────────────────────────────────────────
PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS "ManagementKey";
DROP TABLE IF EXISTS "RequestLog";
DROP TABLE IF EXISTS "CachedModel";
DROP TABLE IF EXISTS "Discovery";
DROP TABLE IF EXISTS "Key";
DROP TABLE IF EXISTS "Account";
DROP TABLE IF EXISTS "User";

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "openRouterId" TEXT,
  "alias" TEXT NOT NULL,
  "sessionToken" TEXT NOT NULL,
  "config" TEXT,
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastKnownBalance" REAL,
  "totalCredits" REAL,
  "lastKnownBalanceAt" DATETIME,
  CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Key" (
  "hash" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT,
  "label" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isProvisioningKey" BOOLEAN NOT NULL DEFAULT false,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "isPooled" BOOLEAN NOT NULL DEFAULT false,
  "limit" REAL,
  "limitRemaining" REAL,
  "limitReset" TEXT,
  "usage" REAL,
  "usageMonthly" REAL,
  "accountId" TEXT NOT NULL,
  CONSTRAINT "Key_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Discovery" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
  "data" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "CachedModel" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "ctx" INTEGER,
  "category" TEXT,
  "ownedBy" TEXT,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "RequestLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "keyHash" TEXT,
  "model" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "clientHint" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestLog_keyHash_fkey" FOREIGN KEY ("keyHash") REFERENCES "Key" ("hash") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ManagementKey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "encryptedKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" TEXT,
  "lastUsedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ManagementKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE INDEX "Account_openRouterId_idx" ON "Account"("openRouterId");
CREATE INDEX "Key_accountId_idx" ON "Key"("accountId");
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");
CREATE INDEX "RequestLog_status_createdAt_idx" ON "RequestLog"("status", "createdAt");
CREATE INDEX "RequestLog_keyHash_createdAt_idx" ON "RequestLog"("keyHash", "createdAt");
CREATE INDEX "ManagementKey_accountId_status_idx" ON "ManagementKey"("accountId", "status");
CREATE INDEX "ManagementKey_createdAt_idx" ON "ManagementKey"("createdAt");
PRAGMA foreign_keys=ON;
`;

// Prisma's URL parser treats a bare `file:foo.db` as an unauthority URL and on
// some Windows builds rejects it before reaching the SQLite engine. The `./`
// prefix forces unambiguous relative resolution against the schema directory,
// which is portable across darwin/linux/win32. The temp DB always lives next to
// schema.prisma (PRISMA_DIR), so basename() is the path we need.
function prismaFileUrl(path) {
  return `file:./${basename(path)}`;
}

async function listSqliteTables(dbPath) {
  // stdio: 'inherit' here (and below) so a Prisma generate failure surfaces in
  // CI logs instead of being swallowed by the parent's try/catch. Without this
  // a Windows runner just emits "Process completed with exit code 1" with no
  // diagnosis.
  execFileSync(process.execPath, [PRISMA_CLI, 'generate', `--schema=${SCHEMA_PATH}`], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    timeout: 120_000,
  });

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: prismaFileUrl(dbPath),
      },
    },
  });

  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
    );
    return rows.map((row) => row.name);
  } finally {
    await prisma.$disconnect();
  }
}

try {
  rmSync(tempDb, { force: true });
  rmSync(`${tempDb}-journal`, { force: true });
  rmSync(`${tempDb}-wal`, { force: true });
  rmSync(`${tempDb}-shm`, { force: true });

  const dbUrl = prismaFileUrl(tempDb);
  console.log(`[build-empty-db] DATABASE_URL=${dbUrl} (cwd=${PROJECT_ROOT})`);
  try {
    execFileSync(
      process.execPath,
      [PRISMA_CLI, 'db', 'push', `--schema=${SCHEMA_PATH}`, '--skip-generate'],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
        },
        stdio: 'inherit',
        timeout: 120_000,
      },
    );
  } catch (err) {
    // sqlite3 binary is not pre-installed on Windows GitHub runners, so the
    // fallback below is mac/linux only. Surface the original Prisma failure
    // clearly when sqlite3 also isn't available, instead of dying with a
    // generic ENOENT later.
    console.warn(`[build-empty-db] Prisma db push failed (${err.message}); attempting sqlite3 bootstrap`);
    console.warn('[build-empty-db] WARNING: using fallback SQL; schema.prisma changes must be reflected here.');
    console.warn('[build-empty-db] Make sure bootstrapSql in this file matches the current prisma/schema.prisma.');
    writeFileSync(tempSql, bootstrapSql);
    try {
      execFileSync('sqlite3', [tempDb], {
        input: readFileSync(tempSql, 'utf-8'),
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        timeout: 30_000,
      });
    } catch (sqliteErr) {
      throw new Error(
        `[build-empty-db] Prisma db push failed and sqlite3 fallback also failed.\n` +
        `  prisma error: ${err.message}\n` +
        `  sqlite3 error: ${sqliteErr.message}\n` +
        `  (sqlite3 is not pre-installed on Windows runners; the Prisma path must succeed there.)`
      );
    }
  }

  const generatedTables = new Set(await listSqliteTables(tempDb));
  const missingTables = REQUIRED_TABLES.filter((table) => !generatedTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`empty DB is missing Prisma table(s): ${missingTables.join(', ')}`);
  }

  // Copy the freshly-pushed database to the final empty-db path
  copyFileSync(tempDb, EMPTY_DB_PATH);

  console.log(`[build-empty-db] Done — empty database created at ${EMPTY_DB_PATH}`);
} catch (err) {
  console.error(`[build-empty-db] Failed: ${err.stderr || err.message}`);
  process.exit(1);
} finally {
  // Clean up the temporary database
  try {
    rmSync(tempDb, { force: true });
    rmSync(`${tempDb}-journal`, { force: true });
    rmSync(`${tempDb}-wal`, { force: true });
    rmSync(`${tempDb}-shm`, { force: true });
    rmSync(tempSql, { force: true });
  } catch {
    // best effort cleanup
  }
}
