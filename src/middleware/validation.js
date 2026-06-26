const { validate, schemas } = require('../utils/validators');
const logger = require('../utils/logger');

/**
 * Generic validation middleware factory
 * @param {string} schemaName - Name of the validation schema to use
 * @returns {Function} - Koa middleware function
 */
function validateBody(schemaName) {
  return async (ctx, next) => {
    try {
      const { error, value } = validate(schemaName, ctx.request.body);
      
      if (error) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          message: 'Validation failed',
          errors: error.details.map(detail => detail.message)
        };
        return;
      }

      // Replace request body with validated value
      ctx.request.body = value;
      await next();
    } catch (err) {
      logger.error('Validation error:', err);
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: 'Validation error occurred',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      };
    }
  };
}

// Specific validation middleware accounts
const validateAccount = validateBody('createAccount');
const validateContact = validateBody('contact');
const validateGroup = validateBody('createGroup');
const validateMessage = (ctx, next) => {
  const schemaName =  'sendMessage';
  return validateBody(schemaName)(ctx, next);
};

module.exports = {
  validateBody,
  validateAccount,
  validateContact,
  validateGroup,
  validateMessage
}; 