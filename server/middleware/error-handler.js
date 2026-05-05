import { logger } from '../services/logger.js';

/**
 * Standardizes API error responses.
 * Catch-all middleware for Express.
 */
export const errorHandler = (err, req, res, _next) => {
  // #11: Guard against double-send — if headers were already sent
  // (e.g., a streaming response started writing), delegate to Express's
  // default error handler rather than crashing the process.
  if (res.headersSent) {
    return _next(err);
  }

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  // Log detailed error for server console
  logger.error(`${err.stack || message}\n[ROUTE] ${req.method} ${req.url}`);

  // Sanitize message for production (no stacks)
  const isProduction = process.env.NODE_ENV === 'production';
  const response = {
    error: isProduction ? 'An internal error occurred. Please try again later.' : message,
    status
  };

  if (!isProduction && err.stack) {
    response.stack = err.stack;
  }

  res.status(status).json(response);
};

export default errorHandler;
