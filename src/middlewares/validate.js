const Joi = require('joi');
const { sendValidationError } = require('../utils/apiResponse');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

/**
 * Joi validation middleware factory
 */
// const validate = (schema, source = 'body') => {
//   return (req, res, next) => {
//     const data = source === 'body' ? req.body
//       : source === 'query' ? req.query
//       : source === 'params' ? req.params
//       : { ...req.body, ...req.query, ...req.params };

//     const { error, value } = schema.validate(data, {
//       abortEarly: false,
//       stripUnknown: true,
//       convert: true,
//     });

//     if (error) {
//       const errors = error.details.map((d) => ({
//         field: d.path.join('.'),
//         message: d.message.replace(/"/g, ''),
//       }));
//       return sendValidationError(res, errors);
//     }

//     if (source === 'body') req.body = value;
//     else if (source === 'query') req.query = value;
//     else if (source === 'params') req.params = value;

//     next();
//   };
// };

/**
 * Validation middleware that handles both Joi and express-validator
 *
 * Usage:
 * - Joi: validate(joiSchema)
 * - Express-validator: validate(arrayOfValidators)
 */
const validate = (schema) => {
  return async (req, res, next) => {
    try {
      // ─── Handle Joi Schema ─────────────────────────────────────────
      if (schema.validate && typeof schema.validate === 'function') {
        const data = req.method === 'GET' ? req.query : req.body;
        const { error, value } = schema.validate(data, {
          abortEarly: false,
          stripUnknown: true,
          convert: true,
        });

        if (error) {
          const errors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message.replace(/"/g, ''),
          }));

          logger.warn('Validation error:', errors);
          return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors,
          });
        }

        if (req.method === 'GET') {
          req.query = value;
        } else {
          req.body = value;
        }
        return next();
      }

      // ─── Handle Express-Validator Array ────────────────────────────
      else if (Array.isArray(schema)) {
        // Run all validators in sequence
        await Promise.all(schema.map((validator) => validator.run(req)));

        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          const messages = errors.array().map((err) => ({
            field: err.param,
            message: err.msg,
          }));

          logger.warn('Validation error:', messages);
          return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: messages,
          });
        }

        return next();
      }

      // ─── Invalid Schema Type ──────────────────────────────────────
      else {
        logger.error('Invalid schema type provided to validate middleware');
        return res.status(500).json({
          success: false,
          message: 'Server validation configuration error',
        });
      }
    } catch (error) {
      logger.error('❌ Validation middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Validation error',
        error: error.message,
      });
    }
  };
};

module.exports = { validate };
