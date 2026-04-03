const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Global rate limiter
 * Applied to all API requests
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  },
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

/**
 * OTP sending - very strict
 * Prevent brute force OTP guessing and spam
 */
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3, // max 3 OTP requests per 10 minutes
  keyGenerator: (req) => {
    // Rate limit by phone number for unauthenticated requests
    // by user ID for authenticated requests
    return req.body?.phone || req.user?.id || req.ip;
  },
  message: 'Too many OTP requests. Please try again in 10 minutes.',
  handler: (req, res) => {
    logger.warn(`OTP rate limit exceeded for: ${req.body?.phone || req.user?.id || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many OTP requests. Please try again in 10 minutes.',
    });
  },
});

/**
 * OTP verification - moderate
 * Prevent brute force OTP verification attempts
 */
const otpVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // max 5 verification attempts per 5 minutes
  keyGenerator: (req) => {
    return req.body?.phone || req.user?.id || req.ip;
  },
  message: 'Too many OTP verification attempts. Please try again later.',
  handler: (req, res) => {
    logger.warn(`OTP verify rate limit exceeded for: ${req.body?.phone || req.user?.id || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many OTP verification attempts. Please try again later.',
    });
  },
});

/**
 * Authentication attempts - strict
 * Prevent credential brute force attacks
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // max 5 failed auth attempts
  keyGenerator: (req) => {
    return req.body?.email || req.body?.phone || req.ip;
  },
  message: 'Too many login attempts. Please try again later.',
  handler: (req, res) => {
    logger.warn(`Auth rate limit exceeded for: ${req.body?.email || req.body?.phone || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please try again later.',
    });
  },
});

/**
 * Create/publish operations - moderate
 * Prevent spam of marketplace listings
 */
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // max 20 creations per hour per user
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'You are creating content too quickly. Please try again later.',
  handler: (req, res) => {
    logger.warn(`Create rate limit exceeded for user: ${req.user?.id || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'You are creating content too quickly. Please try again later.',
    });
  },
});

/**
 * Offer operations - moderate
 * Prevent spam of offers
 */
const offerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // max 30 offers per hour per user
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'You are making too many offers. Please try again later.',
  handler: (req, res) => {
    logger.warn(`Offer rate limit exceeded for user: ${req.user?.id || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'You are making too many offers. Please try again later.',
    });
  },
});

/**
 * Chat/messaging - light
 * Prevent spam while allowing normal messaging
 */
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // max 30 messages per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'You are sending messages too fast. Please slow down.',
  handler: (req, res) => {
    logger.warn(`Chat rate limit exceeded for user: ${req.user?.id || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'You are sending messages too fast. Please slow down.',
    });
  },
});

/**
 * Payment operations - very strict
 * Prevent duplicate payments and fraud attempts
 */
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // max 10 payment attempts per hour
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Too many payment attempts. Please try again later.',
  handler: (req, res) => {
    logger.warn(`Payment rate limit exceeded for user: ${req.user?.id || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many payment attempts. Please try again later.',
    });
  },
});

/**
 * Review/rating - light
 * Allow users to review multiple items without restriction
 */
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // max 50 reviews per hour
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'You are submitting reviews too quickly.',
  handler: (req, res) => {
    logger.warn(`Review rate limit exceeded for user: ${req.user?.id || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'You are submitting reviews too quickly.',
    });
  },
});

/**
 * Search/read operations - very light
 * Prevent scraping while allowing normal browsing
 */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // max 60 searches per minute
  keyGenerator: (req) => req.ip,
  message: 'Too many search requests. Please try again later.',
  handler: (req, res) => {
    logger.warn(`Search rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many search requests. Please try again later.',
    });
  },
});

/**
 * Admin operations - strict
 * Protect admin endpoints from abuse
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // max 100 admin operations per hour
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Too many admin operations. Please try again later.',
  handler: (req, res) => {
    logger.warn(`Admin rate limit exceeded for user: ${req.user?.id || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many admin operations. Please try again later.',
    });
  },
});

/**
 * Password reset - very strict
 * Prevent password reset spam/abuse
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // max 3 password reset requests per hour
  keyGenerator: (req) => req.body?.email || req.ip,
  message: 'Too many password reset requests. Please try again later.',
  handler: (req, res) => {
    logger.warn(`Password reset rate limit exceeded for: ${req.body?.email || req.ip}`);
    res.status(429).json({
      success: false,
      message: 'Too many password reset requests. Please try again later.',
    });
  },
});

module.exports = {
  globalLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  authLimiter,
  createLimiter,
  offerLimiter,
  chatLimiter,
  paymentLimiter,
  reviewLimiter,
  searchLimiter,
  adminLimiter,
  passwordResetLimiter,
};
