const jwt = require('jsonwebtoken');
const logger = require('./logger');

/**
 * Generate JWT access token (short-lived)
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '15m', // Enforce 15 minutes
    issuer:   'krushimitra-api',
    audience: 'krushimitra-app',
  });
};

/**
 * Generate JWT refresh token (long-lived)
 */
const generateRefreshToken = (payload) => {
  // Use a different secret for refresh tokens for defense-in-depth
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
    expiresIn: '7d', // 7 days
    issuer:   'krushimitra-api',
    audience: 'krushimitra-app',
  });
};

/**
 * Verify access token
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer:   'krushimitra-api',
    audience: 'krushimitra-app',
  });
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
    issuer:   'krushimitra-api',
    audience: 'krushimitra-app',
  });
};

/**
 * Generate token pair (access + refresh)
 */
const generateTokenPair = (user) => {
  const csrfToken = require('crypto').randomBytes(32).toString('hex');
  const payload = {
    id: user._id || user.id,
    role: user.role,
    phone: user.phone,
    csrfToken, 
  };
  
  return {
    accessToken:  generateAccessToken(payload),
    refreshToken: generateRefreshToken({ id: user._id || user.id }),
    expiresIn:    15 * 60, // returns seconds
    csrfToken,
  };
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
};
