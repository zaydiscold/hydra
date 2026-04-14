import { logger } from '../services/logger.js';

export default class BaseController {
  /**
   * Success response handler
   */
  success(res, data, statusCode = 200) {
    // Note: To maintain backward compatibility with old frontend expectations, 
    // we use a nested data pattern where appropriate or just return the data object.
    return res.status(statusCode).json({
      success: true,
      data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Error response handler
   */
  error(res, message, statusCode = 500, code = 'INTERNAL_ERROR', extra = {}) {
    logger.error(`[Controller Error] ${message}`, { 
      status: statusCode,
      code 
    });

    return res.status(statusCode).json({
      success: false,
      error: message,
      code,
      timestamp: new Date().toISOString(),
      ...extra,
    });
  }

  /**
   * Validation helper using Zod
   */
  validate(data, schema) {
    try {
      return schema.parse(data);
    } catch (err) {
      if (err.name === 'ZodError') {
        const issues = err.issues ?? err.errors ?? [];
        const message = issues.map((e) => e.message).join('. ');
        const error = new Error(message);
        error.status = 400;
        throw error;
      }
      throw err;
    }
  }

  /**
   * Express async handler wrapper. 
   * Captures rejected promises and routes them through the error() response handler.
   */
  catchAsync(fn) {
    return (req, res, next) => {
      Promise.resolve(fn.call(this, req, res, next)).catch((err) => {
        // Automatically translate generic errors via our base error handler
        return this.error(
          res, 
          err.message, 
          err.status || 500, 
          err.code || 'INTERNAL_ERROR', 
          err.extra || {}
        );
      });
    };
  }
}
