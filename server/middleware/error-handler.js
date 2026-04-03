import { logger } from '../services/logger.js';

/**
 * Standardizes API error responses.
 * Catch-all middleware for Express.
 */
export const errorHandler = (err, req, res, _next) => {
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
