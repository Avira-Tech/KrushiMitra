const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const { sendUnauthorized, sendForbidden } = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * Protect routes - verify JWT access token
 */
const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return sendUnauthorized(res, 'No authentication token provided');
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendUnauthorized(res, 'Token expired. Please refresh.');
      }
      return sendUnauthorized(res, 'Invalid token');
    }

    const user = await User.findById(decoded.id).select('-password -otp -refreshToken');

    if (!user) {
      return sendUnauthorized(res, 'User not found');
    }

    if (!user.isActive) {
      return sendForbidden(res, 'Account has been deactivated');
    }

    if (user.isBanned) {
      return sendForbidden(res, `Account banned: ${user.banReason || 'Policy violation'}`);
    }

    // Update last active
    await User.findByIdAndUpdate(decoded.id, { lastActiveAt: new Date() }, { new: false });

    req.user = user;
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return sendUnauthorized(res, 'Authentication failed');
  }
};

/**
 * Restrict to specific roles
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return sendForbidden(res, `Access restricted to: ${roles.join(', ')}`);
    }
    next();
  };
};

/**
 * Require verified account
 */
const requireVerified = (req, res, next) => {
  if (!req.user?.isVerified) {
    return sendForbidden(res, 'Account verification required. Please wait for admin approval.');
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
      const decoded = verifyAccessToken(token);
      req.user = await User.findById(decoded.id).select('-password -otp -refreshToken');
    }
  } catch (err) {
    // Ignore errors for optional auth
  }
  next();
};

module.exports = { protect, restrictTo, requireVerified, optionalAuth };
