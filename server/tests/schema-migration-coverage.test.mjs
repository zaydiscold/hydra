// @platform all
/**
 * Guard against the v1.6.0 ship bug: a scalar column (`User.authDisabled`) was
 * added to prisma/schema.prisma but no migration was generated, so packaged
 * installs — which build their DB from the `empty-hydra.db` template and then
 * heal via migration replay (server/lib/db-self-heal.js), NOT `prisma db push`
 * (dev-only) — could never gain the column. Result: rotation pool loads 0 keys
 * and auth queries fail with "column main.User.authDisabled does not exist".
 *
 * This reproduces the real runtime path: start from the shipped template, run
 * the self-healer, then assert every scalar column in schema.prisma is present.
 * A schema column with no template coverage AND no migration fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSelfHeal } from '../lib/db-self-heal.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCALAR_TYPES = new Set([
  'String', 'Int', 'Boolean', 'DateTime', 'Float', 'BigInt', 'Decimal', 'Bytes', 'Json',
]);

// model Name { ... } → { table: Set<column> } of scalar (non-relation) fields.
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

test('every schema column lands on a baseline DB after template + migration self-heal', async () => {
  const template = join(ROOT, 'data', 'empty-hydra.db');
  assert.ok(existsSync(template), 'empty-hydra.db template missing');

  const dir = mkdtempSync(join(tmpdir(), 'hydra-migration-coverage-'));
  const dbPath = join(dir, 'hydra.db');
  copyFileSync(template, dbPath);

  await runSelfHeal({ dbPath, migrationsDir: join(ROOT, 'prisma', 'migrations'), log: () => {} });

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } }, log: [] });
  try {
    const models = scalarColumnsFromSchema(readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8'));
    const missing = [];
    for (const [table, cols] of Object.entries(models)) {
      const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
      const have = new Set(rows.map((r) => r.name));
      for (const col of cols) {
        if (!have.has(col)) missing.push(`${table}.${col}`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `Schema columns absent after template + self-heal (packaged installs will break): ${missing.join(', ')}. `
        + 'Add a prisma migration with ALTER TABLE ... ADD COLUMN for each.',
    );
  } finally {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
