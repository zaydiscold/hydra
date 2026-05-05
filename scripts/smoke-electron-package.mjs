/**
 * Smoke-check an unpacked Electron package contract.
 *
 * This is intentionally local and file-system based so it can run in CI for
 * mac/win/linux without driving a GUI. It verifies the runtime files that
 * packaged startup depends on: Prisma client engine, migrations/schema,
 * prebuilt empty DB, bundled Chromium, and package size.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const RELEASE = resolve(ROOT, 'release');
const MAX_APP_BYTES = Number(process.env.HYDRA_MAX_PACKAGED_APP_MB || 900) * 1024 * 1024;

function findResourcesDir() {
  if (process.env.ELECTRON_APP_RESOURCES) {
    return resolve(process.env.ELECTRON_APP_RESOURCES);
  }

  const candidates = [
    join(RELEASE, 'mac-arm64/Hydra.app/Contents/Resources'),
    join(RELEASE, 'mac/Hydra.app/Contents/Resources'),
    join(RELEASE, 'linux-unpacked/resources'),
    join(RELEASE, 'win-unpacked/resources'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function dirSizeBytes(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stats = statSync(full);
    total += stats.isDirectory() ? dirSizeBytes(full) : stats.size;
  }
  return total;
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing at ${path}`);
  }
}

function findPrismaEngine(resourcesDir) {
  const clientDir = join(resourcesDir, 'app/node_modules/.prisma/client');
  assertExists(clientDir, 'Prisma generated client');
  const engine = readdirSync(clientDir).find((name) =>
    name.endsWith('.node') && /query_engine/.test(name)
  );
  if (!engine) throw new Error(`Prisma query engine missing in ${clientDir}`);
  return join(clientDir, engine);
}

function hasBundledChromium(resourcesDir) {
  const candidates = [
    join(resourcesDir, 'chromium/Chromium.app/Contents/MacOS/Chromium'),
    join(resourcesDir, 'chromium/chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
    join(resourcesDir, 'chromium/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'),
    join(resourcesDir, 'chromium/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(resourcesDir, 'chromium/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    join(resourcesDir, 'chromium/chrome-linux/chrome'),
    join(resourcesDir, 'chromium/chrome-win/chrome.exe'),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

const resourcesDir = findResourcesDir();
if (!resourcesDir) {
  throw new Error('No unpacked Electron resources directory found under release/. Build with electron-builder first.');
}

assertExists(join(resourcesDir, 'prisma/schema.prisma'), 'Prisma schema resource');
assertExists(join(resourcesDir, 'prisma/migrations'), 'Prisma migrations resource');
assertExists(join(resourcesDir, 'data/empty-hydra.db'), 'Empty packaged DB');
const engine = findPrismaEngine(resourcesDir);
if (!hasBundledChromium(resourcesDir)) {
  throw new Error(`Bundled Chromium missing under ${join(resourcesDir, 'chromium')}`);
}

const appDir = join(resourcesDir, 'app');
const appSize = existsSync(appDir) ? dirSizeBytes(appDir) : dirSizeBytes(resourcesDir);
if (appSize > MAX_APP_BYTES) {
  throw new Error(`Packaged app is too large: ${Math.round(appSize / 1024 / 1024)} MB`);
}

const prisma = new PrismaClient({
  datasources: { db: { url: `file:${join(resourcesDir, 'data/empty-hydra.db')}` } },
  log: [],
});
try {
  await prisma.$queryRaw`SELECT 1`;
} finally {
  await prisma.$disconnect();
}

console.log(`[electron-smoke] resources: ${resourcesDir}`);
console.log(`[electron-smoke] prisma engine: ${engine}`);
console.log(`[electron-smoke] app size: ${Math.round(appSize / 1024 / 1024)} MB`);
console.log('[electron-smoke] packaged resource contract OK');
