const jwt = require('jsonwebtoken');
const logger = require('./logger');

/**
 * Generate JWT access token (short-lived)
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '15m',
    issuer: 'krushimitra-api',
    audience: 'krushimitra-app',
  });
};

/**
 * Generate JWT refresh token (long-lived)
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
    issuer: 'krushimitra-api',
    audience: 'krushimitra-app',
  });
};

/**
 * Verify access token
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'krushimitra-api',
      audience: 'krushimitra-app',
    });
  } catch (error) {
    logger.debug('Access token verification failed:', error.message);
    throw error;
  }
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
      issuer: 'krushimitra-api',
      audience: 'krushimitra-app',
    });
  } catch (error) {
    logger.debug('Refresh token verification failed:', error.message);
    throw error;
  }
};

/**
 * Generate token pair (access + refresh)
 */
const generateTokenPair = (user) => {
  const payload = {
    id: user._id,
    role: user.role,
    phone: user.phone,
  };
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ id: user._id }),
    expiresIn: process.env.JWT_EXPIRE || '15m',
  };
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
};
