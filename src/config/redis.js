'use strict';
const Redis = require('ioredis');
const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redisConfig = {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

const redis = new Redis(REDIS_URL, redisConfig);

redis.on('connect', () => {
  logger.info('🚀 Redis connected');
});

redis.on('error', (err) => {
  logger.error('❌ Redis connection error:', err.message);
});

// Helper for caching
const cache = {
  set: (key, value, ttlSeconds) => redis.set(key, JSON.stringify(value), 'EX', ttlSeconds),
  get: async (key) => {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },
  del: (key) => redis.del(key),
};

module.exports = { redis, cache, REDIS_URL };
