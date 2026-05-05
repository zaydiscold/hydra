/**
 * Hydra Electron — Environment & Paths
 *
 * Logging init, platform paths, env vars, and packaged runtime state.
 * Must be imported BEFORE any server import.
 */
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import log from 'electron-log/main.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const isDev = !app.isPackaged;

// ─── 0. Persistent logging (file + rotating) ────────────────────────────────
export function setupLogging() {
  log.initialize();
  log.transports.file.level = 'info';
  log.transports.console.level = isDev ? 'debug' : 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024;
  Object.assign(console, log.functions);
}

// ─── 1. Paths and constants ─────────────────────────────────────────────────
export const APP_ROOT = isDev
  ? path.resolve(__dirname, '..', '..')
  : app.getAppPath();

export const RESOURCES_PATH = isDev ? APP_ROOT : process.resourcesPath;
export const SCHEMA_PATH = path.join(isDev ? APP_ROOT : RESOURCES_PATH, 'prisma', 'schema.prisma');
export const MIGRATIONS_DIR = path.join(isDev ? APP_ROOT : RESOURCES_PATH, 'prisma', 'migrations');
export const PRISMA_BIN = path.join(APP_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
export const ICON_PATH = path.join(__dirname, '..', '..', 'desktop', 'icons', 'icon.png');
export const LOCAL_UI_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
export const EXTERNAL_URL_ALLOWLIST = new Set(['github.com', 'openrouter.ai']);

// ─── 2. Platform setup ──────────────────────────────────────────────────────
export function setupPlatform() {
  if (process.platform === 'darwin' && isDev) {
    app.dock?.setIcon(ICON_PATH);
  }
  // Disable browser features we do not use. Keep GPU compositing enabled:
  // this UI is CSS-heavy, and software compositing makes window open/paint feel laggy.
  app.commandLine.appendSwitch('disable-features', 'Translate');
}

// ─── 3. Environment Setup (MUST be before any server import) ────────────────
export function setupEnvironment(appParam) {
  const appRef = appParam || app;
  process.env.HYDRA_DATA_DIR = appRef.getPath('userData');
  process.env.DATABASE_URL = 'file:' + path.join(appRef.getPath('userData'), 'hydra.db');
  process.env.HYDRA_EMBEDDED = '1';
  if (!isDev && !process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }
}

/**
 * Ensure the packaged runtime has a JWT secret and a fresh database.
 * Returns a structured summary object for startup logging.
 *
 * @returns {Promise<{jwtSecret: 'created'|'existing', db: 'copied'|'existing'|'skipped', errors: string[]}>}
 */
export async function ensurePackagedRuntimeState() {
  const summary = { jwtSecret: 'existing', db: 'skipped', errors: [] };

  if (isDev) return summary;

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
      try {
        writeFileSync(secretPath, secret, { mode: 0o600 });
        summary.jwtSecret = 'created';
      } catch (e) {
        summary.errors.push('jwt-secret write failed: ' + e.message);
        summary.jwtSecret = 'existing';
      }
    }
    process.env.JWT_SECRET = secret;
  }

  const dbPath = path.join(userData, 'hydra.db');
  const emptyDbPath = path.join(RESOURCES_PATH, 'data', 'empty-hydra.db');
  if (!existsSync(dbPath) && existsSync(emptyDbPath)) {
    try {
      copyFileSync(emptyDbPath, dbPath);
      summary.db = 'copied';
      console.log(`[electron] initialized database from bundled empty DB: ${dbPath}`);
    } catch (e) {
      summary.errors.push('db copy failed: ' + e.message);
      summary.db = 'skipped';
    }
  } else if (existsSync(dbPath)) {
    summary.db = 'existing';
  }

  return summary;
}
