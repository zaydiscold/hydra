import path from 'node:path';
import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const icons = {
  error: '❌',
  warn: '⚠️',
  info: 'ℹ️',
  http: '🌐',
  verbose: '📝',
  debug: '🔍',
  silly: '🎭',
};

/**
 * Custom log format for Hydra.
 * Dev:  🔍 [debug] 2026-03-25 12:00:00: message
 * Prod: DEBUG 2026-03-25 12:00:00: message
 */
const hydraFormat = printf(({ level, message, timestamp, stack }) => {
  const levelIcon = process.env.NODE_ENV === 'production' ? level.toUpperCase() : (icons[level] || level);
  return `🐉 ${levelIcon} ${timestamp}: ${stack || message}`;
});

/**
 * Resolve the logger level from (in priority order):
 *   1. LOG_LEVEL env var (explicit override — e.g. "debug", "warn", "error")
 *   2. NODE_ENV=production → "info"
 *   3. Default → "debug"
 */
function resolveLogLevel() {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase().trim();
  if (envLevel) {
    // Validate against winston's known levels
    const valid = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
    if (valid.includes(envLevel)) return envLevel;
    // Accept numeric levels too
    const asNum = Number(envLevel);
    if (!Number.isNaN(asNum) && asNum >= 0 && asNum <= 5) {
      return valid[Math.min(asNum, valid.length - 1)];
    }
    // Fall through to default if invalid
    console.warn(`[logger] Invalid LOG_LEVEL="${envLevel}", falling back to default`);
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/**
 * The primary logger for the Hydra Server.
 * In development, it logs to the console with colors.
 * In production, it logs to the console (standard out) for easy cloud platform capture.
 * When HYDRA_DATA_DIR is set, also writes to a file transport at HYDRA_DATA_DIR/hydra.log.
 * Override log level anytime via LOG_LEVEL env var (e.g. LOG_LEVEL=debug).
 */
const transports = [
  new winston.transports.Console(),
];

if (process.env.HYDRA_DATA_DIR) {
  transports.push(new winston.transports.File({
    filename: path.join(process.env.HYDRA_DATA_DIR, 'hydra.log'),
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      printf(({ level, message, timestamp, stack }) => {
        return `${level.toUpperCase()} ${timestamp}: ${stack || message}`;
      })
    ),
  }));
}

export const logger = winston.createLogger({
  level: resolveLogLevel(),
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    colorize(),
    hydraFormat
  ),
  transports,
});

// Polyfill for standard console calls if needed, though explicit logger usage is preferred.
export default logger;
