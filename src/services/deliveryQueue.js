'use strict';
const { Queue } = require('bullmq');
const { REDIS_URL } = require('../config/redis');
const logger = require('../utils/logger');

const deliveryQueue = new Queue('delivery-scheduling', {
  connection: {
    url: REDIS_URL,
  },
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s...
    },
    removeOnComplete: true,
    removeOnFail: false, // Keep for audit if failed after 5 tries
  },
});

deliveryQueue.on('error', (err) => {
  logger.error('❌ Delivery Queue Error:', err.message);
});

module.exports = { deliveryQueue };
