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
    // Health check and specific routes should always be accessible
    if (req.path === '/health' || req.path.includes('/admin/settings')) return next();

    const settings = await SystemSetting.find({
      key: { $in: ['maintenance_mode', 'maintenance_until', 'maintenance_message'] },
    }).lean();

    const maintenance = settings.find((s) => s.key === 'maintenance_mode');

    if (maintenance?.value === true) {
      // Allow admins to bypass maintenance
      const token = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.substring(7)
        : null;

      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
          const user = await User.findById(decoded.id).select('role').lean();
          if (user?.role === 'admin') return next();
        } catch (err) {
          // Token invalid or user not found, proceed to block
        }
      }

      const until = settings.find((s) => s.key === 'maintenance_until');
      const message = settings.find((s) => s.key === 'maintenance_message');

      return res.status(503).json({
        success: false,
        error: message?.value || 'Platform is undergoing maintenance. Please try again later.',
        isMaintenance: true,
        maintenanceUntil: until?.value,
        maintenanceMessage: message?.value,
      });
    }
    next();
  } catch (error) {
    logger.error('Maintenance check failed:', error);
    next();
  }
};

/**
 * JWT verify options — MUST match the options used in jwt.js generateAccessToken().
 * Enforcing issuer + audience prevents tokens from other systems from being accepted.
 */
const JWT_VERIFY_OPTIONS = {
  issuer: 'krushimitra-api',
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
      user = await User.findById(decoded.id)
        .select('role status isBanned isActive isVerified bankDetails securityStatus')
        .lean();
      if (user) {
        await cache.set(cacheKey, user, 300); // Cache for 5 minutes
      }
    }

    if (!user || user.isBanned || !user.isActive || ['banned', 'suspended'].includes(user.status)) {
      logger.warn(`Blocked access for inactive/banned user: ${decoded.id}`, {
        status: user?.status,
        isActive: user?.isActive,
        isBanned: user?.isBanned,
      });

      // Force disconnect active sockets if user was just banned
      socketService.emitToUser(decoded.id, 'force_logout', { reason: 'Account suspended' });

      return res.status(403).json({ success: false, error: 'Account is inactive or suspended' });
    }

    // NEW: Attach Security Block status to req.user instead of blocking all data access
    // This allows blocked users to still view their data/profile, but restricted actions
    // (login/withdrawal) will check this flag.
    const isSecurityBlocked = !!(
      user.securityStatus?.blockedUntil && new Date(user.securityStatus.blockedUntil) > new Date()
    );
    const blockedUntil = isSecurityBlocked ? user.securityStatus.blockedUntil : null;

    // Set req.user here so subsequent checks and logging can see it
    req.user = {
      _id: decoded.id,
      id: decoded.id,
      role: user.role,
      phone: decoded.phone,
      isVerified: user.isVerified,
      status: user.status,
      bankDetails: user.bankDetails,
      csrfToken: decoded.csrfToken,
      isSecurityBlocked,
      blockedUntil,
    };

    req.token = token; // Attach for logout/blacklist usage
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
          _id: decoded.id,
          id: decoded.id,
          role: user.role,
          phone: decoded.phone,
          status: user.status,
        };
      }
    }
  } catch (err) {
    logger.debug('Optional auth failed (expected for guests):', err.message);
  }
  next();
};

module.exports = {
  protect,
  restrictTo,
  requireVerified,
  optionalAuth,
  adminOnly,
  checkMaintenance,
};
