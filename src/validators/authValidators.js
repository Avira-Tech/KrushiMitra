const Joi = require('joi');
const { body } = require('express-validator');

const phoneSchema = Joi.string()
  .pattern(/^[+]?[0-9]{10,15}$/)
  .required()
  .messages({ 'string.pattern.base': 'Enter a valid phone number (10-15 digits)' });

const sendOtpSchema = [
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone is required')
    .matches(/^\d{10}$|^\+?91\d{10}$/)
    .withMessage('Invalid phone number format'),
];

const verifyOtpSchema = [
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone is required')
    .matches(/^\d{10}$|^\+?91\d{10}$/)
    .withMessage('Invalid phone number format'),
  body('otp')
    .trim()
    .notEmpty().withMessage('OTP is required')
    .matches(/^\d{6}$/)
    .withMessage('OTP must be 6 digits'),
];

const registerSchema = [
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone is required')
    .matches(/^\d{10}$|^\+?91\d{10}$/)
    .withMessage('Invalid phone number format'),
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('role')
    .optional()
    .isIn(['farmer', 'buyer', 'admin'])
    .withMessage('Invalid role'),
];

const googleAuthSchema = [
  body('idToken')
    .trim()
    .notEmpty().withMessage('ID token is required'),
];

const refreshTokenSchema = [
  body('refreshToken')
    .trim()
    .notEmpty().withMessage('Refresh token is required'),
];

const updateProfileSchema = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('avatar')
    .optional()
    .trim()
    .isURL().withMessage('Avatar must be a valid URL'),
  body('state')
    .optional()
    .trim(),
  body('district')
    .optional()
    .trim(),
];

module.exports = {
  sendOtpSchema,
  verifyOtpSchema,
  registerSchema,
  googleAuthSchema,
  refreshTokenSchema,
  updateProfileSchema,
};
