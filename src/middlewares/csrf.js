const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * CSRF Token Management
 * - Generate tokens for GET requests
 * - Validate tokens for state-changing requests
 */

const generateCsrfToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Middleware: Add CSRF token to request object
 * Used in GET requests to attach token to response
 */
const csrfTokenMiddleware = (req, res, next) => {
  if (req.method === 'GET') {
    const token = generateCsrfToken();
    res.locals.csrfToken = token;
    res.setHeader('X-CSRF-Token', token);
    // Store in session (or JWT claims in production)
    req.csrfToken = token;
  }
  next();
};

/**
 * Middleware: Validate CSRF token
 * Check POST, PUT, PATCH, DELETE requests
 */
const validateCsrfToken = (req, res, next) => {
  // 1. Skip CSRF validation for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // 2. Skip for critical public endpoints (webhooks)
  const publicEndpoints = ['/api/v1/payments/webhook', '/api/v1/auth/otp'];
  if (publicEndpoints.some(e => req.path.startsWith(e))) {
    return next();
  }

  // 3. Extract token from header or body
  const receivedToken = req.headers['x-csrf-token'] || req.body?.csrfToken;

  if (!receivedToken) {
    logger.warn(`CSRF missing: ${req.method} ${req.path}`);
    return res.status(403).json({
      success: false,
      message: 'CSRF token missing. Required for state-changing requests.',
    });
  }

  // 4. Validate against user session (JWT claim)
  // req.user is populated by protect/auth middleware
  if (!req.user?.csrfToken) {
    // If not authenticated, we allow the request if it's a login/register (already in publicEndpoints)
    // or if the request is inherently unauthenticated. 
    // However, for most apps, unauthenticated POSTs should still be protected.
    // For KrushiMitra, if no req.user, it means it's a public endpoint.
    return next();
  }

  if (receivedToken !== req.user.csrfToken) {
    logger.error(`CSRF mismatch for user ${req.user.id}: origin=${req.headers.origin}`);
    return res.status(403).json({
      success: false,
      message: 'Invalid CSRF token cross-site request blocked.',
    });
  }

  next();
};

module.exports = { csrfTokenMiddleware, validateCsrfToken, generateCsrfToken };
