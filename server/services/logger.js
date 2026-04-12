import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

/**
 * Custom log format for Hydra.
 * 🐉 [INFO] 2026-03-25T12:00:00Z: Server started on port 3001
 */
const hydraFormat = printf(({ level, message, timestamp, stack }) => {
  return `🐉 [${level}] ${timestamp}: ${stack || message}`;
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
 * Override log level anytime via LOG_LEVEL env var (e.g. LOG_LEVEL=debug).
 */
export const logger = winston.createLogger({
  level: resolveLogLevel(),
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    colorize(),
    hydraFormat
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Polyfill for standard console calls if needed, though explicit logger usage is preferred.
export default logger;
