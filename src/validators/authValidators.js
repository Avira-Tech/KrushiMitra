const Joi = require('joi');

const phoneSchema = Joi.string()
  .pattern(/^[+]?[0-9]{10,15}$/)
  .required()
  .messages({ 'string.pattern.base': 'Enter a valid phone number (10-15 digits)' });

const sendOtpSchema = Joi.object({
  phone: phoneSchema,
  role: Joi.string().valid('farmer', 'buyer', 'admin').default('farmer'),
});

const verifyOtpSchema = Joi.object({
  phone: phoneSchema,
  otp: Joi.string().length(6).pattern(/^[0-9]+$/).required().messages({
    'string.length': 'OTP must be 6 digits',
    'string.pattern.base': 'OTP must be numeric',
  }),
  role: Joi.string().valid('farmer', 'buyer', 'admin').default('farmer'),
});

const registerSchema = Joi.object({
  name: Joi.string().min(2).max(100).required().trim(),
  phone: phoneSchema,
  email: Joi.string().email().optional().allow(''),
  role: Joi.string().valid('farmer', 'buyer').required(),
  // Farmer fields
  farmerId: Joi.when('role', {
    is: 'farmer',
    then: Joi.string().required().messages({ 'any.required': 'Farmer ID is required' }),
    otherwise: Joi.optional(),
  }),
  governmentId: Joi.string().optional(),
  // Buyer fields
  companyName: Joi.when('role', {
    is: 'buyer',
    then: Joi.string().required().messages({ 'any.required': 'Company name is required' }),
    otherwise: Joi.optional(),
  }),
  gstNumber: Joi.when('role', {
    is: 'buyer',
    then: Joi.string()
      .pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/)
      .required()
      .messages({ 'any.required': 'GST number is required', 'string.pattern.base': 'Invalid GST format' }),
    otherwise: Joi.optional(),
  }),
  businessAddress: Joi.string().optional(),
  location: Joi.object({
    lat: Joi.number().required(),
    lng: Joi.number().required(),
    address: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    pincode: Joi.string().optional(),
  }).optional(),
  language: Joi.string().valid('en', 'hi', 'gu', 'mr').default('en'),
  otp: Joi.string().length(6).required(),
});

const googleAuthSchema = Joi.object({
  idToken: Joi.string().required(),
  role: Joi.string().valid('farmer', 'buyer').default('buyer'),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional().trim(),
  email: Joi.string().email().optional().allow(''),
  language: Joi.string().valid('en', 'hi', 'gu', 'mr').optional(),
  fcmToken: Joi.string().optional(),
  location: Joi.object({
    lat: Joi.number(),
    lng: Joi.number(),
    address: Joi.string(),
    city: Joi.string(),
    state: Joi.string(),
    pincode: Joi.string(),
  }).optional(),
  companyName: Joi.string().optional(),
  businessAddress: Joi.string().optional(),
});

module.exports = {
  sendOtpSchema,
  verifyOtpSchema,
  registerSchema,
  googleAuthSchema,
  refreshTokenSchema,
  updateProfileSchema,
};
