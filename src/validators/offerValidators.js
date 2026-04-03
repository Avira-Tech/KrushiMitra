const Joi = require('joi');
const { body } = require('express-validator');

const createOfferSchema = Joi.object({
  cropId: Joi.string().hex().length(24).required(),
  quantity: Joi.number().positive().required(),
  offeredPrice: Joi.number().positive().required(),
  message: Joi.string().max(500).optional().allow(''),
});

const counterOfferSchema = Joi.object({
  price: Joi.number().positive().required(),
  message: Joi.string().max(500).optional().allow(''),
});

const updateOfferSchema = Joi.object({
  action: Joi.string().valid('accept', 'reject', 'counter', 'cancel').required(),
  counterPrice: Joi.when('action', {
    is: 'counter',
    then: Joi.number().positive().required(),
    otherwise: Joi.optional(),
  }),
  message: Joi.string().max(500).optional().allow(''),
  reason: Joi.string().max(500).optional().allow(''),
});

const makeOfferSchema = [
  body('cropId')
    .trim()
    .notEmpty().withMessage('Crop ID is required')
    .isMongoId().withMessage('Invalid crop ID'),

  body('quantity')
    .isFloat({ min: 0.1 }).withMessage('Quantity must be greater than 0'),

  body('pricePerUnit')
    .isFloat({ min: 0.1 }).withMessage('Price per unit must be greater than 0'),

  body('deliveryLocation')
    .trim()
    .notEmpty().withMessage('Delivery location is required')
    .isLength({ min: 3, max: 200 }).withMessage('Invalid delivery location'),

  body('deliveryDate')
    .isISO8601().withMessage('Invalid delivery date')
    .custom(value => {
      const date = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) {
        throw new Error('Delivery date cannot be in the past');
      }
      return true;
    }),

  body('paymentTerms')
    .trim()
    .notEmpty().withMessage('Payment terms required')
    .isIn(['advance', 'on_delivery', 'installments'])
    .withMessage('Invalid payment terms'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters'),
];

module.exports = { createOfferSchema, counterOfferSchema, updateOfferSchema, makeOfferSchema };
