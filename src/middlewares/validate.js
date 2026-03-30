const Joi = require('joi');
const { sendValidationError } = require('../utils/apiResponse');

/**
 * Joi validation middleware factory
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = source === 'body' ? req.body
      : source === 'query' ? req.query
      : source === 'params' ? req.params
      : { ...req.body, ...req.query, ...req.params };

    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/"/g, ''),
      }));
      return sendValidationError(res, errors);
    }

    if (source === 'body') req.body = value;
    else if (source === 'query') req.query = value;
    else if (source === 'params') req.params = value;

    next();
  };
};

module.exports = { validate };
