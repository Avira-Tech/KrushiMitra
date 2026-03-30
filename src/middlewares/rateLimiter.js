const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const createLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      logger.warn(`Rate limit exceeded: ${req.ip} - ${req.path}`);
      res.status(429).json(options.message);
    },
  });

// General API rate limiter
const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: 'Too many requests. Please try again in 15 minutes.',
});

// Auth rate limiter (strict)
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

// OTP rate limiter
const otpLimiter = createLimiter({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 3,
  message: 'Too many OTP requests. Please wait 10 minutes before trying again.',
});

// Upload rate limiter
const uploadLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 min
  max: 20,
  message: 'Too many file uploads. Please slow down.',
});

module.exports = { apiLimiter, authLimiter, otpLimiter, uploadLimiter };
