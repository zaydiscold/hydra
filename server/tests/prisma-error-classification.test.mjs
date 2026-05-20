// @platform all
/**
 * Tests for prisma-error.js classifier — verifies that SQLite-level errors
 * (SQLITE_READONLY, SQLITE_BUSY, SQLITE_IOERR, etc.) are properly classified
 * into actionable tags and fix messages.
 */
import { strict as assert } from 'node:assert';
import { classifyPrismaError } from '../lib/prisma-error.js';

// ─── Known Prisma codes still work ───────────────────────────────────────────
{
  const err = { code: 'P2021', message: 'The table `main.Account` does not exist in the current database.' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_SCHEMA');
  assert.equal(c.summary, 'table does not exist');
  assert.ok(c.fix.includes('prisma db push'));
}
{
  const err = { code: 'P1001', message: 'Can\'t reach database server at `localhost`:`5432`' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_CONN');
  assert.equal(c.summary, 'cannot reach database');
}

// ─── #78: SQLITE_READONLY ────────────────────────────────────────────────────
{
  const err = { message: 'SQLITE_READONLY: attempt to write a readonly database' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_READONLY', 'SQLITE_READONLY should be classified');
  assert.equal(c.summary, 'database is read-only');
  assert.ok(c.fix.includes('file permissions'));
}

{
  const err = { message: 'attempt to write a readonly database' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_READONLY', 'readonly message should be classified');
}

{
  const err = { message: 'Error: readonly database' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_READONLY', 'readonly keyword should be caught');
}

// ─── #78: SQLITE_BUSY ────────────────────────────────────────────────────────
{
  const err = { message: 'SQLITE_BUSY: database is locked' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_BUSY', 'SQLITE_BUSY should be classified');
  assert.equal(c.summary, 'database is locked by another process');
  assert.ok(c.fix.includes('other Hydra instances'));
}

{
  const err = { message: 'database is locked' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_BUSY');
}

// ─── #79: Disk I/O / ENOSPC ──────────────────────────────────────────────────
{
  const err = { message: 'ENOSPC: no space left on device, write' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_DISK', 'ENOSPC should be classified as DB_DISK');
  assert.ok(c.fix.includes('disk space'));
}

{
  const err = { message: 'SQLITE_IOERR: disk I/O error' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_DISK', 'SQLITE_IOERR should be DB_DISK');
}

// ─── SQLITE_CORRUPT ──────────────────────────────────────────────────────────
{
  const err = { message: 'SQLITE_CORRUPT: database disk image is malformed' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_CORRUPT', 'SQLITE_CORRUPT should be classified');
  assert.ok(c.fix.includes('backup'));
}

// ─── SQLITE_CANTOPEN ─────────────────────────────────────────────────────────
{
  const err = { message: 'SQLITE_CANTOPEN: unable to open database file' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_CONN', 'SQLITE_CANTOPEN should be DB_CONN');
  assert.ok(c.fix.includes('parent directory'));
}

// ─── Unknown errors fall back to DB_ERROR ────────────────────────────────────
{
  const err = { message: 'Something completely unexpected happened' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_ERROR');
  assert.equal(c.summary, 'prisma error');
}

// ─── Pattern matching doesn't override known Prisma codes ────────────────────
{
  const err = { code: 'P2025', message: 'An operation failed because it depends on one or more records that were required but not found.' };
  const c = classifyPrismaError(err);
  assert.equal(c.tag, 'DB_NOT_FOUND', 'Known Prisma code should take precedence over patterns');
}

console.log('PASS: prisma-error classification tests');
