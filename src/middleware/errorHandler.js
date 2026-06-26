const logger = require('../utils/logger');

/**
 * Global error handling middleware
 */
async function errorHandler(ctx, next) {
  try {
    await next();
  } catch (err) {
    logger.error('Request error:', err);

    // Handle Boom errors
    if (err.isBoom) {
      ctx.status = err.output.statusCode;
      ctx.body = {
        success: false,
        message: err.output.payload.message,
        error: process.env.NODE_ENV === 'development' ? err.output.payload : undefined
      };
      return;
    }

    // Handle other errors
    ctx.status = err.status || 500;
    ctx.body = {
      success: false,
      message: err.message || 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    };

    // Emit error for global handling if needed
    ctx.app.emit('error', err, ctx);
  }
}

module.exports = errorHandler; 