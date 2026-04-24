'use strict';
const jwt = require('jsonwebtoken');
// const { TokenBlacklist } = require('../models/TokenBlacklist'); // Moved to Redis
const { redis, cache } = require('../config/redis');
const User = require('../models/User');
const BLACKLIST_PREFIX = 'blacklist:token:';
const logger = require('../utils/logger');
const socketService = require('../utils/socketService');
const SystemSetting = require('../models/SystemSetting');

/**
 * Check if the platform is in maintenance mode.
 * Admins are exempted from this check.
 */
const checkMaintenance = async (req, res, next) => {
  try {
    const maintenance = await SystemSetting.findOne({ key: 'maintenance_mode' }).lean();
    if (maintenance?.value === true && req.user?.role !== 'admin') {
      return res.status(503).json({
        success: false,
        error: 'Platform is undergoing maintenance. Please try again later.',
        isMaintenance: true
      });
    }
    next();
  } catch (error) {
    logger.error('Maintenance check failed:', error);
    next(); // Proceed if check fails to avoid blocking the app
  }
};

/**
 * JWT verify options — MUST match the options used in jwt.js generateAccessToken().
 * Enforcing issuer + audience prevents tokens from other systems from being accepted.
 */
const JWT_VERIFY_OPTIONS = {
  issuer:   'krushimitra-api',
  audience: 'krushimitra-app',
};

// ─── Protect routes — verify JWT access token ──────────────────────────────────
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.substring(7)
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided',
      });
    }

    // Check blacklist in Redis — MUCH faster than DB for every request
    const isBlacklisted = await redis.exists(`${BLACKLIST_PREFIX}${token}`);
    if (isBlacklisted) {
      return res.status(401).json({ success: false, error: 'Token has been revoked' });
    }

    // FIX #2: Pass issuer + audience — consistent with jwt.js generateAccessToken()
    const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTIONS);

    // FIX #11: Fetch live user status using Redis caching to reduce DB load
    const cacheKey = `user:status:${decoded.id}`;
    let user = await cache.get(cacheKey);

    if (!user) {
      user = await User.findById(decoded.id).select('role status isBanned isActive isVerified').lean();
      if (user) {
        await cache.set(cacheKey, user, 300); // Cache for 5 minutes
      }
    }

    if (!user || user.isBanned || !user.isActive || ['banned', 'suspended'].includes(user.status)) {
      logger.warn(`Blocked access for inactive/banned user: ${decoded.id}`);
      
      // Force disconnect active sockets if user was just banned
      socketService.emitToUser(decoded.id, 'force_logout', { reason: 'Account suspended' });
      
      return res.status(403).json({ success: false, error: 'Account is inactive or suspended' });
    }

    // Merge decoded token claims with live DB fields
    req.token = token; // Attach for logout/blacklist usage
    req.user = {
      _id:        decoded.id,
      id:         decoded.id,   // some controllers use .id, others ._id
      role:       user.role,
      phone:      decoded.phone,
      isVerified: user.isVerified,
      status:     user.status,
      csrfToken:  decoded.csrfToken, // stateless CSRF check
    };

    next();
  } catch (error) {
    logger.error('Token verification failed:', error.message);
    return res.status(401).json({
      success: false,
      error: error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token',
    });
  }
};

// ─── Restrict to specific roles ────────────────────────────────────────────────
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      logger.warn(`Unauthorized role access: User ${req.user?.id} tried ${req.method} ${req.path}`);
      return res.status(403).json({
        success: false,
        error: `Access restricted to: ${roles.join(', ')}`,
      });
    }
    next();
  };
};

// ─── Admin-only ────────────────────────────────────────────────────────────────
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    logger.error(`Admin access violation: User ${req.user?.id} at ${req.path}`);
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
};

// ─── Require verified account (KYC approved) ───────────────────────────────────
const requireVerified = (req, res, next) => {
  if (!req.user?.isVerified) {
    return res.status(403).json({
      success: false,
      error: 'Account verification required. Please wait for admin approval.',
    });
  }
  next();
};

// ─── Optional auth — attach user if token present, never block ─────────────────
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.substring(7)
      : null;

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTIONS);
      
      // Still check DB in optional auth to avoid assuming identity of banned users
      const user = await User.findById(decoded.id).select('role status isBanned isActive').lean();
      
      if (user && !user.isBanned && user.isActive && user.status !== 'banned') {
        req.user = {
          _id:   decoded.id,
          id:    decoded.id,
          role:  user.role,
          phone: decoded.phone,
          status: user.status
        };
      }
    }
  } catch (err) {
    logger.debug('Optional auth failed (expected for guests):', err.message);
  }
  next();
};

module.exports = { protect, restrictTo, requireVerified, optionalAuth, adminOnly, checkMaintenance };
