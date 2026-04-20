'use strict';
const { Worker } = require('bullmq');
const { REDIS_URL } = require('../config/redis');
const PorterService = require('../services/porterService');
const Contract = require('../models/Contract');
const User = require('../models/User');
const NotificationService = require('../services/notificationService');
const logger = require('../utils/logger');

const startDeliveryWorker = () => {
  const worker = new Worker(
    'delivery-scheduling',
    async (job) => {
      const { contractId } = job.data;
      logger.info(`🚚 Processing delivery scheduling for contract: ${contractId} (Attempt ${job.attemptsMade + 1})`);

      const contract = await Contract.findById(contractId);
      if (!contract) {
        logger.error(`Contract ${contractId} not found, skipping job.`);
        return;
      }

      const farmer = await User.findById(contract.farmer).select('phone location');
      const buyer = await User.findById(contract.buyer).select('phone location');

      const deliveryResult = await PorterService.createOrder({
        contract,
        pickupAddress: farmer?.location?.address || 'Farmer location',
        dropAddress: buyer?.location?.address || 'Buyer location',
        farmerPhone: farmer?.phone ? `+91${farmer.phone}` : '+919999999999',
        buyerPhone: buyer?.phone ? `+91${buyer.phone}` : '+919999999999',
      });

      if (deliveryResult.success) {
        await Contract.findByIdAndUpdate(contract._id, {
          'delivery.status': 'scheduled',
          'delivery.porterOrderId': deliveryResult.orderId,
          'delivery.trackingId': deliveryResult.trackingId,
          'delivery.estimatedDelivery': deliveryResult.estimatedTime,
        });
        logger.info(`✅ Delivery scheduled for contract ${contractId}: ${deliveryResult.orderId}`);
      } else {
        throw new Error(deliveryResult.message || 'Porter API failed');
      }
    },
    {
      connection: { url: REDIS_URL },
      concurrency: 5,
    }
  );

  worker.on('failed', async (job, err) => {
    logger.error(`❌ Delivery Job ${job.id} failed: ${err.message}`);
    
    // If all attempts failed, notify admin
    if (job.attemptsMade >= (job.opts.attempts || 5)) {
      const { contractId } = job.data;
      logger.error(`🚨 FATAL: Delivery scheduling failed for contract ${contractId} after max retries.`);
      
      const admins = await User.find({ role: 'admin' }).select('_id');
      await NotificationService.createBulk(
        admins.map(a => a._id),
        {
          type: 'system',
          title: '🚨 POS Delivery Failure',
          body: `Critical: Failed to schedule delivery for Contract ${contractId} after 5 retries. Manual intervention required.`,
          priority: 'urgent',
        }
      ).catch(() => {});
    }
  });

  logger.info('👷 Delivery Worker started');
};

module.exports = { startDeliveryWorker };
