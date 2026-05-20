import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hydra-schema-hash-'));

mock.module('electron', {
  namedExports: {
    app: {
      isPackaged: false,
      getPath(name) {
        if (name === 'userData' || name === 'logs') return userDataDir;
        return userDataDir;
      },
      once() {},
    },
  },
});

const {
  computeSchemaContentHash,
  resetSchemaContentHashCacheForTest,
  shouldSyncSchema,
} = await import('../../electron/app/schemaHash.js');

test('schema content hash is cached for repeated startup callers', async (t) => {
  resetSchemaContentHashCacheForTest();

  const originalReadFile = fsp.readFile;
  let readCount = 0;
  mock.method(fsp, 'readFile', async function (...args) {
    readCount += 1;
    return originalReadFile.apply(this, args);
  });
  t.after(() => {
    fsp.readFile.mock.restore();
    resetSchemaContentHashCacheForTest();
  });

  const first = await computeSchemaContentHash();
  const afterFirst = readCount;
  const second = await computeSchemaContentHash();

  assert.equal(second.hash, first.hash);
  assert.equal(second.mtimeFingerprint, first.mtimeFingerprint);
  assert.equal(readCount, afterFirst, 'second compute should reuse the in-process cache');

  await computeSchemaContentHash({ force: true });
  assert.ok(readCount > afterFirst, 'force recompute should reread schema and migration content');
});

test('schema sync fallback errors are logged before forcing sync', async (t) => {
  resetSchemaContentHashCacheForTest();

  const originalStat = fsp.stat;
  const warnings = [];
  mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  mock.method(fsp, 'stat', async function (target, ...args) {
    if (String(target).replaceAll('\\', '/').endsWith('prisma/schema.prisma')) {
      throw new Error('schema stat unavailable');
    }
    return originalStat.call(this, target, ...args);
  });
  t.after(() => {
    console.warn.mock.restore();
    fsp.stat.mock.restore();
    resetSchemaContentHashCacheForTest();
  });

  const result = await shouldSyncSchema();

  assert.equal(result.shouldSync, true);
  assert.equal(result.hash, null);
  assert.ok(
    warnings.some((line) => /schema sync check failed; forcing sync: schema stat unavailable/.test(line)),
    'schema sync fallback must leave a warning trail',
  );
});

test('schema sync sentinel read failures are logged without making first launch noisy', async (t) => {
  resetSchemaContentHashCacheForTest();

  const originalReadFile = fsp.readFile;
  const warnings = [];
  mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  mock.method(fsp, 'readFile', async function (target, ...args) {
    if (String(target).endsWith('.schema-mtimes')) {
      const err = new Error('permission denied');
      err.code = 'EACCES';
      throw err;
    }
    return originalReadFile.call(this, target, ...args);
  });
  t.after(() => {
    console.warn.mock.restore();
    fsp.readFile.mock.restore();
    resetSchemaContentHashCacheForTest();
  });

  const result = await shouldSyncSchema();

  assert.equal(result.shouldSync, true);
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.ok(
    warnings.some((line) => /schema sync could not read \.schema-mtimes; using fallback: permission denied/.test(line)),
    'unreadable mtime sentinel should leave warning evidence',
  );
  assert.ok(
    warnings.every((line) => !/schema sync could not read \.schema-version/.test(line)),
    'missing schema-version should stay quiet on first launch',
  );
});
