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
  // Skip CSRF validation for GET and OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip for public endpoints (webhooks, health, etc)
  const publicEndpoints = ['/health', '/api/v1/auth/webhook'];
  if (publicEndpoints.some(e => req.path.startsWith(e))) {
    return next();
  }

  const token = req.headers['x-csrf-token'] || req.body?.csrfToken;

  if (!token) {
    logger.warn(`CSRF token missing: ${req.method} ${req.path}`);
    return res.status(403).json({
      success: false,
      message: 'CSRF token missing. Required for state-changing requests.',
    });
  }

  // In production, verify token against user's session/JWT
  // For now, basic validation
  if (!/^[a-f0-9]{64}$/.test(token)) {
    logger.warn(`Invalid CSRF token format: ${req.method} ${req.path}`);
    return res.status(403).json({
      success: false,
      message: 'Invalid CSRF token',
    });
  }

  req.csrfToken = token;
  next();
};

module.exports = { csrfTokenMiddleware, validateCsrfToken, generateCsrfToken };
