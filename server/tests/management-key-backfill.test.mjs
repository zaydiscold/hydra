/**
 * Regression: legacy config.managementKey should backfill into the canonical
 * managementKey table exactly once and then become a no-op on repeat reads.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const DB_SPEC = new URL('../services/db.js', import.meta.url).href;
const CODEC_SPEC = new URL('../services/storage-codec.js', import.meta.url).href;

const rows = [];

mock.module(DB_SPEC, {
  namedExports: {
    prisma: {
      managementKey: {
        findFirst: mock.fn(async ({ where }) => rows.find((row) => row.accountId === where.accountId) || null),
        findMany: mock.fn(async ({ where }) => rows.filter((row) => row.accountId === where.accountId)),
        create: mock.fn(async ({ data }) => {
          const row = {
            id: data.id,
            accountId: data.accountId,
            encryptedKey: data.encryptedKey,
            name: data.name,
            status: data.status,
            metadata: data.metadata,
            lastUsedAt: data.lastUsedAt,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
          rows.push(row);
          return row;
        }),
      },
    },
  },
});

mock.module(CODEC_SPEC, {
  namedExports: {
    encrypt: (value) => `enc:${value}`,
    decrypt: (value) => String(value).startsWith('enc:') ? String(value).slice(4) : String(value),
  },
});

const { backfillLegacyManagementKey } = await import('../services/management-key-store.js');

test('backfillLegacyManagementKey stores once and then skips when rows already exist', async () => {
  const first = await backfillLegacyManagementKey('acct-1', 'sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789');
  assert.equal(first.backfilled, true);
  assert.equal(rows.length, 1);

  const second = await backfillLegacyManagementKey('acct-1', 'sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789');
  assert.equal(second.backfilled, false);
  assert.equal(rows.length, 1);
});
