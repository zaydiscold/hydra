/**
 * SQLite schema self-healer.
 *
 * Why this exists: in a packaged Electron app on macOS, `prisma db push` can
 * silently fail (wrong cwd, npx not on PATH, schema file in extraResources).
 * When that happens, ALTER TABLE migrations never run and any query that
 * touches the new column 500s with `P2022 — column does not exist`.
 *
 * This self-healer scans every migration's `migration.sql`, picks out the
 * idempotent statements (`ALTER TABLE ... ADD COLUMN ...`, `CREATE INDEX IF NOT EXISTS`),
 * and replays them against the live DB. Duplicate-column / duplicate-index
 * errors are swallowed — if it already exists, we're done.
 *
 * Usage:
 *   const { runSelfHeal } = await import('./lib/db-self-heal.js');
 *   const summary = await runSelfHeal({ dbPath, migrationsDir });
 *   logger.info(`[DB_HEAL] ${summary.applied} applied, ${summary.skipped} already present, ${summary.errors} errors`);
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Pull every `ALTER TABLE ... ADD COLUMN ...` and `CREATE INDEX IF NOT EXISTS ...` from a migration. */
function extractIdempotentStatements(sql) {
  const out = [];
  // ALTER TABLE "X" ADD COLUMN "Y" ...;
  const alterRe = /ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+COLUMN\s+[^;]+;/gi;
  // CREATE INDEX "name" ON "table" ...;  — let duplicates throw, then classify
  const indexRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s+ON\s+["`]?(\w+)["`]?[^;]+;/gi;

  let m;
  while ((m = alterRe.exec(sql)) !== null) {
    out.push({ kind: 'alter', table: m[1], stmt: m[0] });
  }
  while ((m = indexRe.exec(sql)) !== null) {
    // Strip any IF NOT EXISTS so SQLite throws on duplicates and we can count
    // them as "skipped" rather than mis-counting them as "applied".
    const stmt = m[0].replace(/IF\s+NOT\s+EXISTS\s+/i, '');
    out.push({ kind: 'index', name: m[1], table: m[2], stmt });
  }
  return out;
}

/** Recognize SQLite duplicate errors so we can silently skip them. */
function isAlreadyExists(err) {
  const msg = err?.message || String(err);
  return /duplicate column name|already exists/i.test(msg);
}

/**
 * Run the self-heal pass.
 * @param {object} opts
 * @param {string} opts.dbPath        - absolute path to the SQLite DB file
 * @param {string} opts.migrationsDir - absolute path to prisma/migrations/
 * @param {(msg:string)=>void} [opts.log] - optional logger (default console.log)
 * @returns {Promise<{applied:number, skipped:number, errors:number, errorDetails:string[]}>}
 */
export async function runSelfHeal({ dbPath, migrationsDir, log = console.log }) {
  if (!existsSync(dbPath)) {
    log(`[DB_HEAL] DB not found at ${dbPath} — skipping self-heal`);
    return { applied: 0, skipped: 0, errors: 0, errorDetails: [] };
  }
  if (!existsSync(migrationsDir)) {
    log(`[DB_HEAL] migrations dir not found at ${migrationsDir} — skipping self-heal`);
    return { applied: 0, skipped: 0, errors: 0, errorDetails: [] };
  }

  // Collect every ALTER/INDEX statement across all migrations, in chronological order
  // (Prisma names migration folders with a timestamp prefix, so default sort = chronological).
  const folders = readdirSync(migrationsDir).filter(f => /^\d{14}_/.test(f)).sort();
  const stmts = [];
  for (const f of folders) {
    const sqlPath = join(migrationsDir, f, 'migration.sql');
    if (!existsSync(sqlPath)) continue;
    const sql = readFileSync(sqlPath, 'utf-8');
    for (const s of extractIdempotentStatements(sql)) {
      stmts.push({ ...s, migration: f });
    }
  }

  if (stmts.length === 0) {
    log('[DB_HEAL] no idempotent statements found in migrations');
    return { applied: 0, skipped: 0, errors: 0, errorDetails: [] };
  }

  // Use Prisma to execute raw SQL — it's already a dependency and bundles its
  // own SQLite driver so we don't need better-sqlite3 or node:sqlite.
  let PrismaClient;
  try {
    ({ PrismaClient } = await import('@prisma/client'));
  } catch (err) {
    log(`[DB_HEAL] @prisma/client not loadable: ${err.message}`);
    return { applied: 0, skipped: 0, errors: 1, errorDetails: [err.message] };
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
    // Keep Prisma quiet — we classify and report errors ourselves.
    log: [],
  });

  let applied = 0, skipped = 0, errors = 0;
  const errorDetails = [];

  try {
    for (const { stmt, kind, table, name, migration } of stmts) {
      try {
        await prisma.$executeRawUnsafe(stmt);
        applied++;
        const label = kind === 'alter' ? `ALTER ${table}` : `INDEX ${name} ON ${table}`;
        log(`[DB_HEAL] applied: ${label} (from ${migration})`);
      } catch (err) {
        if (isAlreadyExists(err)) {
          skipped++;
        } else {
          errors++;
          const detail = `${kind} on ${table || name}: ${err.message}`;
          errorDetails.push(detail);
          log(`[DB_HEAL] error: ${detail}`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  return { applied, skipped, errors, errorDetails };
}
