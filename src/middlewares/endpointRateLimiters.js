'use strict';
/**
 * endpointRateLimiters.js
 *
 * Endpoint-specific rate limiters for sensitive operations.
 * These are stricter than the global apiLimiter and protect
 * against abuse of payment, auth, and upload endpoints.
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const createLimiter = ({ windowMs, max, message, keyGenerator }) =>
  rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGenerator || ((req) => req.ip),
    handler: (req, res, next, options) => {
      logger.warn(`Rate limit exceeded: ${req.ip} - ${req.path}`);
      res.status(429).json(options.message);
    },
  });

// Payment endpoints — strict limit to prevent order spam
const paymentLimiter = createLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: 'Too many payment requests. Please wait before retrying.',
});

// Webhook — Razorpay may retry, so allow more but still bounded
const webhookLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 50,
  message: 'Webhook rate limit exceeded.',
});

// File upload — prevent abuse
const uploadLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many file uploads. Please slow down.',
});

// Search / list endpoints — generous but bounded
const searchLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many search requests. Please slow down.',
});

module.exports = {
  paymentLimiter,
  webhookLimiter,
  uploadLimiter,
  searchLimiter,
};
