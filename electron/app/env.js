/**
 * Hydra Electron — Environment & Paths
 *
 * Logging init, platform paths, env vars, and packaged runtime state.
 * Must be imported BEFORE any server import.
 */
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const isDev = !app.isPackaged;

// ─── 0. Persistent logging (file + rotating) ────────────────────────────────
//
// Removed `electron-log` dependency (~300 KB) per audit. Replaced with a
// minimal file-tee implementation: console.* methods write through to BOTH
// stdout/stderr AND a rolling log file under `userData/logs/main.log`.
//
// Behavior parity with prior electron-log setup:
//   - Dev: writes everything (debug + info + warn + error) to file
//   - Prod: writes only warn + error to file (~90% I/O reduction)
//   - Console always shows everything (visible in `npm run dev` terminal)
//   - File rotates at 5 MB (rename to .1, drop .2)
//
// Trade-offs vs electron-log:
//   - No log levels API (we just have console.log/warn/error)
//   - No structured metadata; lines are plain text with ISO timestamps
//   - No cross-process aggregation from renderers (renderers log to their
//     own DevTools console; if you need them in main, IPC them explicitly)
//
// Why bother: the audit flagged dual logging (winston server-side +
// electron-log electron-side) as redundant. Removing one halves the
// logging-stack maintenance and saves ~300 KB in the packaged app.
const FILE_ROTATE_BYTES = 5 * 1024 * 1024;
const rawConsoleWarn = console.warn.bind(console);
let _logStream = null;
let _logPath = null;
let _logWriteFailureReported = false;

function rotateLogIfNeeded() {
  if (!_logPath) return;
  try {
    const stat = fs.statSync(_logPath);
    if (stat.size < FILE_ROTATE_BYTES) return;
    const rotated = _logPath + '.1';
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    fs.renameSync(_logPath, rotated);
    if (_logStream) {
      _logStream.end();
      _logStream = fs.createWriteStream(_logPath, { flags: 'a' });
    }
  } catch (e) {
    console.warn('[env] log rotation skipped:', e?.message ?? e);
  }
}

function writeLogLine(level, args) {
  const stamp = new Date().toISOString();
  const text = args
    .map((a) => (typeof a === 'string' ? a : (() => {
      try { return JSON.stringify(a); } catch { return String(a); }
    })()))
    .join(' ');
  const line = `${stamp} [${level}] ${text}\n`;
  if (_logStream) {
    try {
      _logStream.write(line);
    } catch (e) {
      if (!_logWriteFailureReported) {
        _logWriteFailureReported = true;
        rawConsoleWarn('[env] log stream write failed:', e?.message ?? e);
      }
    }
  }
}

export function setupLogging() {
  try {
    const logsDir = app.getPath('logs');
    fs.mkdirSync(logsDir, { recursive: true });
    _logPath = path.join(logsDir, 'main.log');
    rotateLogIfNeeded();
    _logStream = fs.createWriteStream(_logPath, { flags: 'a' });

    // Tee console.* to file. Production drops info — matches the audit's
    // "eliminate ~90% of startup I/O writes" goal from the prior setup.
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    const writeInfo = isDev; // dev: persist info; prod: skip info to disk

    console.log = (...args) => {
      if (writeInfo) writeLogLine('info', args);
      origLog(...args);
    };
    console.warn = (...args) => {
      writeLogLine('warn', args);
      origWarn(...args);
    };
    console.error = (...args) => {
      writeLogLine('error', args);
      origError(...args);
    };

    // Flush + close on quit so the last lines aren't lost in the kernel
    // page cache when the process exits hard.
    app.once('before-quit', () => {
      try { _logStream?.end(); } catch (e) { rawConsoleWarn('[env] log stream close failed:', e?.message ?? e); }
      _logStream = null;
    });
  } catch (e) {
    // If logging setup fails, fall back to plain console — never block boot.
    rawConsoleWarn('[env] log file setup failed:', e?.message ?? e);
  }
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

export function isAllowedLocalUiUrl(rawUrl, allowedPort = null) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
    const isLoopback = LOCAL_UI_HOSTS.has(hostname);
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const portMatches = allowedPort == null || Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)) === Number(allowedPort);
    return isLoopback && isHttp && portMatches;
  } catch {
    return false;
  }
}

export function resolveDevServerUrl(rawUrl, fallbackUrl) {
  if (!rawUrl) return fallbackUrl;
  if (isAllowedLocalUiUrl(rawUrl)) return rawUrl;
  console.warn(`[electron] ignoring unsafe VITE_DEV_SERVER_URL: ${rawUrl}`);
  return fallbackUrl;
}

// ─── 2. Platform setup ──────────────────────────────────────────────────────
export function setupPlatform() {
  if (process.platform === 'darwin' && isDev) {
    app.dock?.setIcon(ICON_PATH);
  }
  // Disable browser features we do not use. Keep GPU compositing enabled:
  // this UI is CSS-heavy, and software compositing makes window open/paint feel laggy.
  app.commandLine.appendSwitch('disable-features', 'Translate');
  // Hydra does not use Chromium's password manager. On macOS, Chromium can
  // otherwise touch the user's login keychain during startup and produce
  // repeated "Hydra wants to use your confidential information" prompts.
  // Keep app secrets in Hydra's own owner-only files instead.
  app.commandLine.appendSwitch('password-store', 'basic');
  if (process.platform === 'darwin') {
    app.commandLine.appendSwitch('use-mock-keychain');
  }
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

  const { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, statfsSync } = await import('node:fs');
  const { randomBytes } = await import('node:crypto');
  const userData = app.getPath('userData');

  // #79: Guard against full disk — mkdirSync can throw ENOSPC.
  // Also check available space before writing.
  try {
    mkdirSync(userData, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(userData, 0o700);
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
  } catch (e) {
    summary.errors.push('disk-space check failed: ' + e.message);
  }

  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'hydra-dev-secret-unsafe') {
    const secretPath = path.join(userData, 'jwt-secret');
    let secret = null;
    const hadSecretFile = existsSync(secretPath);
    if (hadSecretFile) {
      try {
        chmodSync(secretPath, 0o600);
      } catch (e) {
        summary.errors.push('jwt-secret permission repair failed: ' + e.message);
      }
      secret = readFileSync(secretPath, 'utf-8').trim();
    }
    if (!secret || secret.length < 32) {
      secret = randomBytes(32).toString('hex');
      try {
        writeFileSync(secretPath, secret, { mode: 0o600 });
        // #50: On POSIX, writeFileSync's mode option is only applied when
        // creating a new file. If the file already exists (e.g. created by
        // an older version without mode restriction), old permissions are
        // preserved. Explicit chmod enforces 0o600 every time we write.
        chmodSync(secretPath, 0o600);
        summary.jwtSecret = hadSecretFile ? 'repaired' : 'created';
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
        try {
          copyFileSync(dbPath, dbPath + '.corrupt');
        } catch (backupErr) {
          summary.errors.push('corrupt db backup failed: ' + backupErr.message);
        }
        try {
          unlinkSync(dbPath);
        } catch (unlinkErr) {
          summary.errors.push('invalid db removal failed: ' + unlinkErr.message);
        }
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
