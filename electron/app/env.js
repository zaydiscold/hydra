/**
 * Hydra Electron — Environment & Path Setup
 *
 * Pins platform-native data paths BEFORE any server import.
 * Generates per-install JWT secret and copies bundled empty DB
 * for packaged-first launches.
 */
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const isDev = !app.isPackaged;
export const APP_ROOT = isDev ? path.resolve(__dirname, '..', '..') : app.getAppPath();
export const RESOURCES_PATH = isDev ? APP_ROOT : process.resourcesPath;
export const SCHEMA_PATH = path.join(isDev ? APP_ROOT : RESOURCES_PATH, 'prisma', 'schema.prisma');
export const MIGRATIONS_DIR = path.join(isDev ? APP_ROOT : RESOURCES_PATH, 'prisma', 'migrations');
export const PRISMA_BIN = path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
export const ICON_PATH = path.join(__dirname, '..', '..', 'desktop', 'icons', 'icon.png');
export const LOCAL_UI_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
export const EXTERNAL_URL_ALLOWLIST = new Set(['github.com']);

/** Pin env vars that MUST be set before any server import, then
 *  provision per-install JWT secret + copy bundled empty DB. */
export async function ensurePackagedRuntimeState() {
  process.env.HYDRA_DATA_DIR = app.getPath('userData');
  process.env.DATABASE_URL = 'file:' + path.join(app.getPath('userData'), 'hydra.db');
  process.env.HYDRA_EMBEDDED = '1';
  if (!isDev && !process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }

  if (isDev) return;

  const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const { randomBytes } = await import('node:crypto');
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'hydra-dev-secret-unsafe') {
    const secretPath = path.join(userData, 'jwt-secret');
    let secret = null;
    if (existsSync(secretPath)) {
      secret = readFileSync(secretPath, 'utf-8').trim();
    }
    if (!secret) {
      secret = randomBytes(32).toString('hex');
      writeFileSync(secretPath, secret, { mode: 0o600 });
    }
    process.env.JWT_SECRET = secret;
  }

  const dbPath = path.join(userData, 'hydra.db');
  const emptyDbPath = path.join(RESOURCES_PATH, 'data', 'empty-hydra.db');
  if (!existsSync(dbPath) && existsSync(emptyDbPath)) {
    copyFileSync(emptyDbPath, dbPath);
    console.log(`[electron] initialized database from bundled empty DB: ${dbPath}`);
  }
}
