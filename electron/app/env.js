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
  // #104: In production, only write warnings and errors to disk.
  // Info-level logs are still shown on console but not persisted —
  // this eliminates ~90% of startup I/O writes without losing
  // visibility into errors. Dev mode keeps debug level in file.
  log.transports.file.level = isDev ? 'debug' : 'warn';
  log.transports.console.level = isDev ? 'debug' : 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024;
  // #101: Do NOT overwrite console.log/warn/error with electron-log's
  // instrumented wrappers.  Those wrappers funnel every console.* call
  // through processMessage() → format pipeline → file transport, which
  // adds measurable overhead to the dozens of log lines emitted during
  // server bootstrap.  electron-log hooks its own log.* methods via
  // log.initialize() already; routing console through it as well is
  // redundant in the main process.
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
  // Build the SQLite `file:` URL.
  //
  // Earlier we wrapped the path in `encodeURI(...)`. That BREAKS the packaged
  // Mac install: macOS userData is `~/Library/Application Support/Hydra/...`
  // (literal space). `encodeURI` rewrites it to `Application%20Support`, and
  // Prisma's SQLite driver does NOT URI-decode the path — it tries to open a
  // file named literally `Application%20Support` and dies with SQLITE_CANTOPEN
  // (error code 14, "Unable to open the database file"). Spaces in `file:`
  // URLs are well-tolerated by SQLite — leave them alone.
  //
  // We DO still escape `#` and `?` — those would be parsed as URL fragment
  // and query before the path reaches SQLite, which is the bug #84 was
  // originally trying to prevent.
  const rawPath = path.join(appRef.getPath('userData'), 'hydra.db');
  const safePath = rawPath
    .replace(/\\/g, '/')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
  process.env.DATABASE_URL = 'file:' + safePath;
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

  const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statfsSync } = await import('node:fs');
  const { randomBytes } = await import('node:crypto');
  const userData = app.getPath('userData');

  // #79: Guard against full disk — mkdirSync can throw ENOSPC.
  // Also check available space before writing.
  try {
    mkdirSync(userData, { recursive: true });
  } catch (e) {
    summary.errors.push('cannot create userData directory: ' + e.message);
    summary.jwtSecret = 'existing';
    summary.db = 'skipped';
    return summary;
  }

  // Pre-flight: check disk space. If less than 10MB free, warn.
  try {
    const stats = statfsSync(userData);
    const freeBytes = stats.bsize * stats.bfree;
    const freeMB = Math.round(freeBytes / (1024 * 1024));
    if (freeMB < 10) {
      summary.errors.push(`disk space critical: only ${freeMB}MB free on the userData volume — writes may fail`);
    }
  } catch {
    // statfsSync may not be available everywhere; best-effort only
  }

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
        // #50: On POSIX, writeFileSync's mode option is only applied when
        // creating a new file. If the file already exists (e.g. created by
        // an older version without mode restriction), old permissions are
        // preserved. Explicit chmod enforces 0o600 every time we write.
        const { chmodSync } = await import('node:fs');
        chmodSync(secretPath, 0o600);
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
      // Bug #8: verify the SQLite magic header to catch corrupt copies early
      // (a zeroed file, truncated download, or wrong binary would fail here
      // instead of producing cryptic P1001 errors later).
      const header = readFileSync(dbPath);
      const magic = 'SQLite format 3\0';
      if (!header || header.length < 16 || Buffer.compare(header.subarray(0, 16), Buffer.from(magic)) !== 0) {
        summary.errors.push('db copy failed: invalid SQLite header after copy');
        summary.db = 'skipped';
        try { copyFileSync(dbPath, dbPath + '.corrupt'); } catch { /* best effort */ }
        try { (await import('node:fs')).unlinkSync(dbPath); } catch { /* best effort */ }
        return summary;
      }
      summary.db = 'copied';
      console.log(`[electron] initialized database from bundled empty DB: ${dbPath}`);
    } catch (e) {
      summary.errors.push('db copy failed: ' + e.message);
      summary.db = 'skipped';
    }
  } else if (existsSync(dbPath)) {
    summary.db = 'existing';
  } else if (!existsSync(emptyDbPath)) {
    // #56: Bundled empty DB is missing (broken build, corrupted resources).
    // Without it, the app starts with no database — first query will 500.
    // Log a clear error so the operator knows what went wrong.
    summary.errors.push('db init failed: bundled empty DB not found at ' + emptyDbPath);
    summary.db = 'skipped';
    console.error(`[electron] FATAL: Bundled empty database not found at ${emptyDbPath}. The app cannot initialize the database.`);
  }

  return summary;
}
