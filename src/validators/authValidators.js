const Joi = require('joi');

const sendOtpSchema = Joi.object({
  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid 10-digit Indian mobile number',
    }),
  role: Joi.string().valid('farmer', 'buyer', 'admin', 'logistics').optional(),
});

const verifyOtpSchema = Joi.object({
  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required(),
  fcmToken: Joi.string().optional(),
});

const registerSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  phone: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required(),
  email: Joi.string().email().optional().allow(null, ''),
  role: Joi.string().valid('farmer', 'buyer', 'admin', 'logistics').required(),
  otp: Joi.string().length(6).optional(),
  fcmToken: Joi.string().optional().allow(null),
  location: Joi.object({
    lat: Joi.number().required(),
    lng: Joi.number().required(),
    address: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    pincode: Joi.string().optional(),
  }).optional(),
  farmerId: Joi.string().when('role', { is: 'farmer', then: Joi.required() }),
  govtId: Joi.string().when('role', { is: 'farmer', then: Joi.optional() }),
  companyName: Joi.string().when('role', { is: 'buyer', then: Joi.required() }),
  gstNumber: Joi.string().when('role', { is: 'buyer', then: Joi.optional() }),
}).unknown(true);

const googleAuthSchema = Joi.object({
  idToken: Joi.string().required(),
  role: Joi.string().valid('farmer', 'buyer', 'admin', 'logistics').optional(),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  email: Joi.string().email().optional(),
  language: Joi.string().valid('en', 'hi', 'gu', 'mr').optional(),
  avatar: Joi.string().optional(),
  companyName: Joi.string().optional(),
  businessAddress: Joi.string().optional(),
  username: Joi.string().optional(),
  fcmToken: Joi.string().optional(),
  location: Joi.alternatives().try(
    Joi.object({
      lat: Joi.number().required(),
      lng: Joi.number().required(),
      address: Joi.string().optional(),
      city: Joi.string().optional(),
      state: Joi.string().optional(),
      pincode: Joi.string().optional(),
    }),
    Joi.string()
  ).optional(),
  lat: Joi.number().optional(),
  lng: Joi.number().optional(),
  address: Joi.string().optional(),
}).unknown(true);

module.exports = {
  sendOtpSchema,
  verifyOtpSchema,
  registerSchema,
  googleAuthSchema,
  refreshTokenSchema,
  updateProfileSchema,
};
