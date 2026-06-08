// @platform all
/**
 * Guard against the v1.6.0 ship bug: a scalar column (`User.authDisabled`) was
 * added to prisma/schema.prisma but no migration was generated, so packaged
 * upgrades-in-place — which heal schema by replaying migration SQL
 * (server/lib/db-self-heal.js), NOT `prisma db push` (dev-only) — could never
 * gain the column. Result: rotation pool loads 0 keys and auth queries fail
 * with "column main.User.authDisabled does not exist".
 *
 * Static check (no DB / no build artifacts, so it runs in CI): every scalar
 * column in schema.prisma must be either an original baseline column (present
 * in the very first install's schema, frozen below) OR added by a migration's
 * `ALTER TABLE ... ADD COLUMN` / `CREATE TABLE`. A NEW column with neither
 * fails here, naming the exact Table.column — so this class of bug can't ship.
 *
 * BASELINE_COLUMNS are the columns that predate the migration era (existing
 * databases already have them, so they need no migration). Adding a genuinely
 * new baseline-style column is rare and should still ship a migration; if you
 * truly must, add it here with a comment explaining why.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCALAR_TYPES = new Set([
  'String', 'Int', 'Boolean', 'DateTime', 'Float', 'BigInt', 'Decimal', 'Bytes', 'Json',
]);

// Columns that predate prisma/migrations (created with the original DB, so every
// existing database already has them — no migration required).
const BASELINE_COLUMNS = {
  User: ['tokenVersion'],
  Key: ['key', 'isPooled'],
  CachedModel: ['id', 'name', 'ctx', 'category', 'ownedBy', 'updatedAt'],
  RequestLog: ['id', 'keyHash', 'model', 'status', 'latencyMs', 'promptTokens', 'completionTokens', 'createdAt'],
  ManagementKey: ['id', 'accountId', 'encryptedKey', 'name', 'status', 'metadata', 'lastUsedAt', 'createdAt', 'updatedAt'],
};

function scalarColumnsFromSchema(schema) {
  const models = {};
  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = modelRe.exec(schema))) {
    const [, name, body] = m;
    const cols = new Set();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const [field, rawType] = parts;
      const baseType = rawType.replace(/[?[\]]/g, '');
      if (SCALAR_TYPES.has(baseType) && !rawType.includes('[]') && !line.includes('@relation')) {
        cols.add(field);
      }
    }
    models[name] = cols;
  }
  return models;
}

// Columns each table gains across all migrations (CREATE TABLE defs + ADD COLUMN).
function migrationColumns() {
  const dir = join(ROOT, 'prisma', 'migrations');
  const tables = {};
  const add = (table, col) => { (tables[table] ||= new Set()).add(col); };
  for (const folder of readdirSync(dir).filter((f) => /^\d{14}_/.test(f))) {
    const sqlPath = join(dir, folder, 'migration.sql');
    if (!existsSync(sqlPath)) continue;
    const sql = readFileSync(sqlPath, 'utf-8');
    let c;
    const createRe = /CREATE\s+TABLE\s+"(\w+)"\s*\(([\s\S]*?)\);/gi;
    while ((c = createRe.exec(sql))) {
      for (const colLine of c[2].split('\n')) {
        const cm = colLine.trim().match(/^"(\w+)"/);
        if (cm) add(c[1], cm[1]);
      }
    }
    let a;
    const alterRe = /ALTER\s+TABLE\s+"(\w+)"\s+ADD\s+COLUMN\s+"(\w+)"/gi;
    while ((a = alterRe.exec(sql))) add(a[1], a[2]);
  }
  return tables;
}

test('every scalar schema column is covered by a migration or the frozen baseline', () => {
  const models = scalarColumnsFromSchema(readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8'));
  const migrated = migrationColumns();

  const stranded = [];
  for (const [table, cols] of Object.entries(models)) {
    const covered = new Set([...(migrated[table] || []), ...(BASELINE_COLUMNS[table] || [])]);
    for (const col of cols) {
      if (!covered.has(col)) stranded.push(`${table}.${col}`);
    }
  }

  assert.deepEqual(
    stranded,
    [],
    `Schema columns with no migration and not in the frozen baseline (packaged upgrades will break): ${stranded.join(', ')}. `
      + 'Add a prisma migration: ALTER TABLE "Table" ADD COLUMN "col" ...;',
  );
});
