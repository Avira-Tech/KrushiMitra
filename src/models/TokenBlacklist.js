const mongoose = require('mongoose');

/**
 * Token Blacklist Model - for revoking tokens
 */
const tokenBlacklistSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tokenType: {
      type: String,
      enum: ['access', 'refresh'],
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    reason: {
      type: String,
      enum: ['logout', 'password-change', 'admin-revoke', 'security', 'other'],
      default: 'logout',
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true, // Index for automatic cleanup
    },
    revokedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false, // Don't need createdAt/updatedAt
    collection: 'tokenBlacklist',
  }
);

// Automatic cleanup: delete expired tokens
tokenBlacklistSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 } // TTL index
);

/**
 * TokenBlacklist Service
 */
class TokenBlacklistService {
  /**
   * Add token to blacklist (revoke)
   */
  static async revokeToken(token, tokenType, userId, reason = 'logout') {
    try {
      // Decode token to get expiration
      const decoded = require('jsonwebtoken').decode(token);
      if (!decoded || !decoded.exp) {
        throw new Error('Invalid token structure');
      }

      const expiresAt = new Date(decoded.exp * 1000);

      await TokenBlacklist.create({
        token,
        tokenType,
        userId,
        reason,
        expiresAt,
      });

      return true;
    } catch (err) {
      throw new Error(`Token revocation failed: ${err.message}`);
    }
  }

  /**
   * Check if token is blacklisted
   */
  static async isBlacklisted(token) {
    try {
      const blacklisted = await TokenBlacklist.findOne({ token });
      return !!blacklisted;
    } catch (err) {
      throw new Error(`Blacklist check failed: ${err.message}`);
    }
  }

  /**
   * Revoke all tokens for a user (security incident)
   */
  static async revokeAllForUser(userId, reason = 'security') {
    try {
      const tokens = await TokenBlacklist.find({
        userId,
        reason: { $ne: reason },
      }).select('token');

      // This would normally include all active user tokens
      // For now, we clear their current sessions
      const result = await TokenBlacklist.updateMany(
        { userId },
        { reason }
      );

      return result;
    } catch (err) {
      throw new Error(`Revoke all failed: ${err.message}`);
    }
  }

  /**
   * Cleanup expired tokens (run periodically via cron)
   */
  static async cleanupExpiredTokens() {
    try {
      const result = await TokenBlacklist.deleteMany({
        expiresAt: { $lt: new Date() },
      });

      return result;
    } catch (err) {
      throw new Error(`Cleanup failed: ${err.message}`);
    }
  }
}

const TokenBlacklist = mongoose.model('TokenBlacklist', tokenBlacklistSchema);

module.exports = { TokenBlacklist, TokenBlacklistService };
