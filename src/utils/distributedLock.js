'use strict';
const { redis } = require('../config/redis');
const logger = require('./logger');

/**
 * DistributedLock
 * Reliable Redis-based locking with safe TTL and renewal logic.
 */
class DistributedLock {
  constructor(key, ttlSeconds = 30) {
    this.key = `lock:${key}`;
    this.ttl = ttlSeconds;
    this.value = require('crypto').randomBytes(16).toString('hex');
    this.timer = null;
  }

  /**
   * Acquire the lock
   * Uses NX (Set if Not Exists) and EX (Expire) for atomicity.
   */
  async acquire() {
    try {
      const result = await redis.set(this.key, this.value, 'NX', 'EX', this.ttl);
      if (result === 'OK') {
        this.startRenewal();
        return true;
      }
      return false;
    } catch (err) {
      logger.error(`Failed to acquire lock ${this.key}:`, err);
      return false;
    }
  }

  /**
   * Release the lock
   * Uses a Lua script to ensure only the owner can release it.
   */
  async release() {
    this.stopRenewal();
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await redis.eval(script, 1, this.key, this.value);
    } catch (err) {
      logger.error(`Error releasing lock ${this.key}:`, err);
    }
  }

  /**
   * Lock Renewal logic (Watchdog)
   * Prevents lock expiration if the process is still running.
   */
  startRenewal() {
    const interval = (this.ttl * 1000) / 2; // Renew halfway through TTL
    this.timer = setInterval(async () => {
      try {
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("expire", KEYS[1], ARGV[2])
          else
            return 0
          end
        `;
        const result = await redis.eval(script, 1, this.key, this.value, this.ttl);
        if (result === 0) {
          logger.warn(`Lock ${this.key} lost during renewal`);
          this.stopRenewal();
        }
      } catch (err) {
        logger.error(`Error renewing lock ${this.key}:`, err);
      }
    }, interval);
  }

  stopRenewal() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Wrap an async function with a lock
   */
  static async withLock(key, ttl, fn) {
    const lock = new DistributedLock(key, ttl);
    const acquired = await lock.acquire();
    if (!acquired) {
      throw new Error(`COULD_NOT_ACQUIRE_LOCK:${key}`);
    }
    try {
      return await fn();
    } finally {
      await lock.release();
    }
  }
}

module.exports = DistributedLock;
