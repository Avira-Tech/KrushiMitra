const Joi = require('joi');

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

module.exports = { createOfferSchema, counterOfferSchema, updateOfferSchema };
