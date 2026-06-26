const Joi = require('joi');

// Account validation schemas
const accountSchema = Joi.object({
  name: Joi.string().required().min(3).max(50)
});

// Contact validation schemas
const contactSchema = Joi.object({
  name: Joi.string().required().min(2).max(50),
  phoneNumber: Joi.string().required().pattern(/^\+?[1-9]\d{1,14}$/)
});

// Group validation schemas
const groupSchema = Joi.object({
  name: Joi.string().required().min(3).max(50),
  description: Joi.string().max(512),
  accountId: Joi.string().required(),
  participants: Joi.array().items(Joi.string().pattern(/^\+?[1-9]\d{1,14}$/)).min(1).required()
});

const groupSettingsSchema = Joi.object({
  subject: Joi.string().min(3).max(50),
  description: Joi.string().max(512),
  announce: Joi.boolean(),
  restrict: Joi.boolean(),
  ephemeral: Joi.number().valid(0, 86400, 604800, 7776000)
}).min(1);

const participantsSchema = Joi.object({
  participants: Joi.array().items(Joi.string().pattern(/^\+?[1-9]\d{1,14}$/)).min(1).required()
});

// Message validation schemas
const messageSchema = Joi.object({
  accountId: Joi.string().required(),
  to: Joi.string().required().pattern(/^\+?[1-9]\d{1,14}$/),
  content: Joi.string().required(),
  type: Joi.string().valid('text', 'image', 'video', 'audio', 'document', 'location', 'contact').default('text'),
  caption: Joi.string().when('type', {
    is: Joi.string().valid('image', 'video', 'document'),
    then: Joi.string().max(1024),
    otherwise: Joi.forbidden()
  }),
  mediaUrl: Joi.string().uri().when('type', {
    is: Joi.string().valid('image', 'video', 'document'),
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  options: Joi.object().default({})
});

const bulkMessageSchema = Joi.object({
  accountId: Joi.string().required(),
  messages: Joi.array().items(Joi.object({
    to: Joi.string().required().pattern(/^\+?[1-9]\d{1,14}$/),
    content: Joi.string().required(),
    type: Joi.string().valid('text', 'image', 'video', 'audio', 'document', 'location', 'contact').default('text'),
    caption: Joi.string().when('type', {
      is: Joi.string().valid('image', 'video', 'document'),
      then: Joi.string().max(1024),
      otherwise: Joi.forbidden()
    }),
    mediaUrl: Joi.string().uri().when('type', {
      is: Joi.string().valid('image', 'video', 'document'),
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    options: Joi.object().default({})
  })).min(1).max(100).required()
});

// Schema mapping
const schemas = {
  createAccount: accountSchema,
  contact: contactSchema,
  createGroup: groupSchema,
  updateGroupSettings: groupSettingsSchema,
  participants: participantsSchema,
  sendMessage: messageSchema,
  sendBulkMessages: bulkMessageSchema
};

/**
 * Validate data against schema
 * @param {string} schemaName - Name of the schema to validate against
 * @param {Object} data - Data to validate
 * @returns {Object} - Validation result
 */
function validate(schemaName, data) {
  const schema = schemas[schemaName];
  if (!schema) {
    throw new Error(`Validation schema '${schemaName}' not found`);
  }

  return schema.validate(data, {
    abortEarly: false,
    stripUnknown: true
  });
}

module.exports = {
  validate,
  schemas
}; 