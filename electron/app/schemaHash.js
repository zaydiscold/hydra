import { app } from 'electron';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { SCHEMA_PATH, MIGRATIONS_DIR } from './env.js';

async function migrationFiles() {
  const out = [];
  const entries = (await fsp.readdir(MIGRATIONS_DIR)).sort();
  for (const name of entries) {
    const full = path.join(MIGRATIONS_DIR, name);
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const files = (await fsp.readdir(full)).sort();
    for (const file of files) out.push({ name, file, path: path.join(full, file) });
  }
  return out;
}

export async function computeSchemaContentHash() {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  const mtimeParts = [];

  const schemaStat = await fsp.stat(SCHEMA_PATH);
  hash.update(await fsp.readFile(SCHEMA_PATH));
  mtimeParts.push(`schema:${schemaStat.mtimeMs}:${schemaStat.size}`);

  for (const item of await migrationFiles()) {
    let stat;
    try { stat = await fsp.stat(item.path); } catch { continue; }
    hash.update(`${item.name}/${item.file}`);
    hash.update(await fsp.readFile(item.path));
    mtimeParts.push(`${item.name}/${item.file}:${stat.mtimeMs}:${stat.size}`);
  }
  return { hash: hash.digest('hex'), mtimeFingerprint: mtimeParts.join('|') };
}

async function computeMtimeFingerprint() {
  const parts = [];
  const schemaStat = await fsp.stat(SCHEMA_PATH);
  parts.push(`schema:${schemaStat.mtimeMs}:${schemaStat.size}`);
  for (const item of await migrationFiles()) {
    try {
      const stat = await fsp.stat(item.path);
      parts.push(`${item.name}/${item.file}:${stat.mtimeMs}:${stat.size}`);
    } catch { /* skip */ }
  }
  return parts.join('|');
}

export async function shouldSyncSchema() {
  try {
    const userData = app.getPath('userData');
    const sentinelPath = path.join(userData, '.schema-version');
    const fingerprintPath = path.join(userData, '.schema-mtimes');

    const storedFingerprint = await fsp.readFile(fingerprintPath, 'utf-8').then(v => v.trim()).catch(() => null);
    if (storedFingerprint && (await computeMtimeFingerprint()) === storedFingerprint) {
      return { shouldSync: false, hash: null };
    }

    const { hash, mtimeFingerprint } = await computeSchemaContentHash();
    const stored = await fsp.readFile(sentinelPath, 'utf-8').then(v => v.trim()).catch(() => '');
    return { shouldSync: stored !== hash, hash, mtimeFingerprint };
  } catch {
    return { shouldSync: true, hash: null };
  }
}

export async function markSchemaSynced(opts = {}) {
  try {
    let { hash, mtimeFingerprint } = opts;
    if (!hash || !mtimeFingerprint) {
      const fresh = await computeSchemaContentHash();
      hash = hash || fresh.hash;
      mtimeFingerprint = mtimeFingerprint || fresh.mtimeFingerprint;
    }
    const userData = app.getPath('userData');
    await fsp.writeFile(path.join(userData, '.schema-version'), hash);
    await fsp.writeFile(path.join(userData, '.schema-mtimes'), mtimeFingerprint);
  } catch (e) {
    console.warn('[electron] failed to write schema-version sentinel:', e.message);
  }
}
