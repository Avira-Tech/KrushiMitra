const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../src/config/database');
const logger = require('../src/utils/logger');

const indexConfigs = [
  // ─── User Indexes ──────────────────────────────────────────────────
  {
    model: 'User',
    indexes: [
      { key: { email: 1 }, options: { unique: true, sparse: true } },
      { key: { phone: 1 }, options: { unique: true, sparse: true } },
      { key: { googleId: 1 }, options: { unique: true, sparse: true } },
      { key: { role: 1 } },
      { key: { 'location.coordinates': '2dsphere' } },
    ],
  },
  // ─── Crop Indexes ──────────────────────────────────────────────────
  {
    model: 'Crop',
    indexes: [
      { key: { farmer: 1 } },
      { key: { category: 1, createdAt: -1 } },
      { key: { 'location.coordinates': '2dsphere' } },
      { key: { availableQuantity: 1 } },
      { key: { createdAt: -1 } },
    ],
  },
  // ─── Offer Indexes ──────────────────────────────────────────────────
  {
    model: 'Offer',
    indexes: [
      { key: { crop: 1, status: 1 } },
      { key: { buyer: 1, status: 1 } },
      { key: { farmer: 1 } },
      { key: { status: 1, expiresAt: 1 } },
      { key: { createdAt: -1 } },
    ],
  },
  // ─── Contract Indexes ──────────────────────────────────────────────
  {
    model: 'Contract',
    indexes: [
      { key: { contractId: 1 }, options: { unique: true } },
      { key: { offer: 1 } },
      { key: { farmer: 1, status: 1 } },
      { key: { buyer: 1, status: 1 } },
      { key: { 'payment.status': 1 } },
      { key: { createdAt: -1 } },
    ],
  },
  // ─── Chat Indexes ──────────────────────────────────────────────────
  {
    model: 'Chat',
    indexes: [
      { key: { participants: 1 } },
      { key: { lastMessageAt: -1 } },
      { key: { isActive: 1 } },
    ],
  },
  // ─── Message Indexes ──────────────────────────────────────────────
  {
    model: 'Message',
    indexes: [
      { key: { chat: 1, createdAt: -1 } },
      { key: { sender: 1 } },
      { key: { isRead: 1, readAt: 1 } },
    ],
  },
  // ─── Notification Indexes ──────────────────────────────────────────
  {
    model: 'Notification',
    indexes: [
      { key: { recipient: 1, createdAt: -1 } },
      { key: { recipient: 1, isRead: 1 } },
      { key: { type: 1 } },
      { key: { isRead: 1, createdAt: 1 }, options: { expireAfterSeconds: 2592000 } }, // 30 days TTL
    ],
  },
  // ─── Review Indexes ──────────────────────────────────────────────
  {
    model: 'Review',
    indexes: [
      { key: { reviewee: 1, createdAt: -1 } },
      { key: { reviewer: 1 } },
      { key: { contract: 1 }, options: { unique: true, sparse: true } },
    ],
  },
  // ─── Payment Indexes ──────────────────────────────────────────────
  {
    model: 'Payment',
    indexes: [
      { key: { contract: 1 } },
      { key: { status: 1, createdAt: -1 } },
      { key: { 'stripe.paymentIntentId': 1 }, options: { sparse: true } },
    ],
  },
  // ─── MandiPrice Indexes ──────────────────────────────────────────
  {
    model: 'MandiPrice',
    indexes: [
      { key: { crop: 1, priceDate: -1 } },
      { key: { mandi: 1, priceDate: -1 } },
      { key: { priceDate: -1 } },
    ],
  },
  // ─── TokenBlacklist Indexes ──────────────────────────────────────
  {
    model: 'TokenBlacklist',
    indexes: [
      { key: { token: 1 }, options: { unique: true } },
      { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } }, // TTL index
    ],
  },
];

const setupIndexes = async () => {
  try {
    await connectDB();
    logger.info('📊 Starting database index setup...');

    for (const config of indexConfigs) {
      try {
        const model = mongoose.model(config.model);
        logger.info(`\n🔨 Setting up indexes for ${config.model}...`);

        for (const indexConfig of config.indexes) {
          const { key, options = {} } = indexConfig;
          await model.collection.createIndex(key, options);
          logger.info(`  ✅ Created index: ${JSON.stringify(key)}`);
        }
      } catch (error) {
        if (error.message.includes('already exists')) {
          logger.warn(`  ⚠️  Index already exists for ${config.model}`);
        } else {
          throw error;
        }
      }
    }

    logger.info('\n✅ All indexes created successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Index setup failed:', error);
    process.exit(1);
  }
};

setupIndexes();