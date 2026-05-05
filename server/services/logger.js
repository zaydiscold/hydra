import winston from 'winston';
import path from 'node:path';

const { combine, timestamp, printf, colorize } = winston.format;

/**
 * Development log format — includes emoji + color for local readability.
 * 🐉 [INFO] 2026-03-25T12:00:00Z: Server started on port 3001
 */
const devFormat = printf(({ level, message, timestamp, stack }) => {
  return `🐉 [${level}] ${timestamp}: ${stack || message}`;
});

/**
 * Production log format — clean structured output, no emoji, no color.
 * [INFO] 2026-03-25T12:00:00Z: Server started on port 3001
 */
const prodFormat = printf(({ level, message, timestamp, stack }) => {
  return `[${level}] ${timestamp}: ${stack || message}`;
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

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Build the transports array for the logger.
 * - Always includes a Console transport.
 * - In production, the console transport uses the plain format (no color, no emoji).
 * - In development, the console transport uses the colored/emoji format.
 * - If HYDRA_DATA_DIR is set, also writes to hydra.log inside that directory.
 */
function buildTransports() {
  const transports = [];

  if (isProduction) {
    transports.push(new winston.transports.Console({
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        prodFormat
      ),
    }));
  } else {
    transports.push(new winston.transports.Console({
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        colorize(),
        devFormat
      ),
    }));
  }

  const dataDir = process.env.HYDRA_DATA_DIR;
  if (dataDir) {
    transports.push(new winston.transports.File({
      filename: path.join(dataDir, 'hydra.log'),
      format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        prodFormat
      ),
    }));
  }

  return transports;
}

/**
 * The primary logger for the Hydra Server.
 * In development, it logs to the console with colors and emoji.
 * In production, it logs to the console (standard out) in clean format.
 * When HYDRA_DATA_DIR is set, also logs to hydra.log in that directory.
 * Override log level anytime via LOG_LEVEL env var (e.g. LOG_LEVEL=debug).
 */
export const logger = winston.createLogger({
  level: resolveLogLevel(),
  transports: buildTransports(),
});

// Polyfill for standard console calls if needed, though explicit logger usage is preferred.
export default logger;
