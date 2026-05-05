/**
 * Hydra Client Logger
 *
 * Lightweight frontend logging helper. In production (non-DEV) it suppresses
 * debug/trace to keep the console quiet while still surfacing warnings/errors.
 * In DEV mode all levels pass through so you see everything during development.
 *
 * Usage:
 *   import logger from '../utils/clientLogger';
 *   logger.warn('Auth check failed:', err.message);
 *   logger.info('Server status:', status);
 */

const LEVELS = ['debug', 'info', 'warn', 'error', 'trace'] ;

function shouldSuppress(level) {
  // In DEV mode allow everything through
  if (import.meta.env.DEV) return false;
  // In production only show warn and error
  return level === 'debug' || level === 'info' || level === 'trace';
}

const noop = () => {};

function createLogger() {
  const impl = {};

  for (const level of LEVELS) {
    if (shouldSuppress(level)) {
      impl[level] = noop;
    } else {
      const native = console[level] || console.log;
      impl[level] = (...args) => {
        native(`[Hydra]`, ...args);
      };
    }
  }

  return impl;
}

const logger = createLogger();
export default logger;
