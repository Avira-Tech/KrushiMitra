const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Protect routes - verify JWT access token
 */
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // Extract Bearer token

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user info to request
    req.user = decoded;
    next();
  } catch (error) {
    logger.error('❌ Token verification failed:', error.message);
    return res.status(401).json({
      success: false,
      error: error.message === 'jwt expired' ? 'Token expired' : 'Invalid token',
    });
  }
};

/**
 * Restrict to specific roles
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      logger.warn(
        `Unauthorized role access: User ${req.user?.id} attempted ${req.method} ${req.path}`
      );
      return res.status(403).json({
        success: false,
        error: `Access restricted to: ${roles.join(', ')}`,
      });
    }
    next();
  };
};

/**
 * Admin-only routes
 */
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    logger.error(`Admin access violation: User ${req.user?.id} at ${req.path}`);
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
    });
  }
  next();
};

/**
 * Require verified account
 */
const requireVerified = (req, res, next) => {
  if (!req.user?.isVerified) {
    return res.status(403).json({
      success: false,
      error: 'Account verification required. Please wait for admin approval.',
    });
  }
  next();
};

/**
 * Optional auth - attach user if token present but don't block
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }
  } catch (err) {
    // Silently ignore errors for optional auth
    logger.debug('Optional auth token invalid:', err.message);
  }
  next();
};

module.exports = {
  protect,
  restrictTo,
  requireVerified,
  optionalAuth,
  adminOnly,
};
