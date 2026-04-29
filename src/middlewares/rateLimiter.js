const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redis } = require('../config/redis');
const logger = require('../utils/logger');

const createLimiter = ({ windowMs, max, message, prefix }) =>
  rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      // @ts-expect-error - ioredis type mismatch in rate-limit-redis
      sendCommand: (...args) => redis.call(...args),
      prefix: `rl:${prefix}:`,
    }),
    handler: (req, res, next, options) => {
      logger.warn(`Rate limit exceeded: ${req.ip} - ${req.path} (${prefix})`);
      res.status(429).json(options.message);
    },
  });

// General API rate limiter
const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  message: 'Too many requests. Please try again later.',
  prefix: 'api',
});

// Auth rate limiter
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
  prefix: 'auth',
});

// OTP rate limiter
const otpLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many OTP requests. Please wait 10 minutes.',
  prefix: 'otp',
});

// Upload rate limiter
const uploadLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many file uploads. Please slow down.',
  prefix: 'upload',
});

// Check availability rate limiter
const checkLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  max: 50,
  message: 'Too many availability checks. Please wait.',
  prefix: 'check',
});

module.exports = { apiLimiter, authLimiter, otpLimiter, uploadLimiter, checkLimiter };
