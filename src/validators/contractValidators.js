const Joi = require('joi');

const createContractSchema = Joi.object({
  offerId: Joi.string().hex().length(24).required(),
  deliveryDate: Joi.date().greater('now').required(),
  deliveryAddress: Joi.string().optional(),
  paymentTerms: Joi.string().max(500).optional(),
  specialConditions: Joi.string().max(1000).optional(),
});

const signContractSchema = Joi.object({
  signature: Joi.string().required(),
  ipAddress: Joi.string().optional(),
});

const disputeSchema = Joi.object({
  reason: Joi.string().min(10).max(1000).required(),
});

const resolveDisputeSchema = Joi.object({
  resolution: Joi.string().min(10).max(1000).required(),
  action: Joi.string().valid('release_payment', 'refund', 'partial_refund').required(),
  refundAmount: Joi.when('action', {
    is: 'partial_refund',
    then: Joi.number().positive().required(),
    otherwise: Joi.optional(),
  }),
});

module.exports = { createContractSchema, signContractSchema, disputeSchema, resolveDisputeSchema };
