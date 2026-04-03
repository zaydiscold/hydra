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
 * The primary logger for the Hydra Server.
 * In development, it logs to the console with colors.
 * In production, it log to the console (standard out) for easy cloud platform capture.
 */
export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
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
