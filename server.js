'use strict';
require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const cron = require('node-cron');

const app = require('./app');
const connectDB = require('./src/config/database');
const { initFirebase } = require('./src/config/firebase');
const { initializeSocket } = require('./src/sockets/socketHandler');
const MandiService = require('./src/services/mandiService');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ─── Validate PORT ───────────────────────────────────────────────────────────
if (PORT < 1024 || PORT > 65535) {
  logger.error(`❌ Invalid PORT: ${PORT}. Must be between 1024-65535`);
  process.exit(1);
}

// ─── Create HTTP server ──────────────────────────────────────────────────────
const server = http.createServer(app);

// ─── Initialize Socket.io ────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? process.env.CLIENT_URL?.split(',')?.filter(Boolean) || []
      : ['http://10.185.238.217:8081', 'http://localhost:19006', 'exp://10.140.239.234:8081'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

// ─── Bootstrap Application ───────────────────────────────────────────────────
const bootstrap = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB().catch((err) => {
      throw new Error(`Database connection failed: ${err.message}`);
    });
    logger.info('✅ MongoDB connected');

    // 2. Initialize Firebase Admin
    initFirebase();
    logger.info('✅ Firebase initialized');

    // 3. Initialize Socket.io
    initializeSocket(io);
    logger.info('✅ Socket.io initialized');

    // 4. Start server
    server.listen(PORT, '0.0.0.0', () => {
      logger.info('─'.repeat(80));
      logger.info('🌾  KrushiMitra API Server Started Successfully');
      logger.info('─'.repeat(80));
      logger.info(`🚀  Environment     : ${NODE_ENV}`);
      logger.info(`🌐  Port            : ${PORT}`);
      logger.info(`🔗  Base URL        : http://localhost:${PORT}/api/v1`);
      logger.info(`💬  Socket.io       : ws://localhost:${PORT}`);
      logger.info(`❤️   Health Check    : http://localhost:${PORT}/health`);
      logger.info(`📊  API Docs        : http://localhost:${PORT}/api/v1`);
      logger.info('─'.repeat(80));
    });

    // 5. Schedule cron jobs
    setupCronJobs();
    logger.info('✅ Cron jobs initialized');

    // 6. Graceful shutdown
    setupGracefulShutdown();
    logger.info('✅ Graceful shutdown handlers registered');

  } catch (error) {
    logger.error('❌ Bootstrap failed', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    process.exit(1);
  }
};

// ─── Cron Jobs Setup ─────────────────────────────────────────────────────────
const setupCronJobs = () => {
  // Sync mandi prices every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      logger.info('⏰ Cron: Syncing mandi prices...');
      await MandiService.fetchAndCachePrices('Gujarat');
      await MandiService.fetchAndCachePrices('Maharashtra');
      logger.info('✅ Cron: Mandi prices synced');
    } catch (error) {
      logger.error('❌ Cron job failed - Mandi price sync:', error.message);
    }
  });

  // Expire old offers every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const Offer = require('./src/models/Offer');
      if (!Offer) {
        logger.error('❌ Offer model not loaded');
        return;
      }

      const result = await Offer.updateMany(
        { status: 'pending', expiresAt: { $lt: new Date() } },
        { status: 'expired' }
      );

      if (result?.modifiedCount > 0) {
        logger.info(`⏰ Cron: Expired ${result.modifiedCount} offers`);
      }
    } catch (error) {
      logger.error('❌ Cron job failed - Offer expiration:', error.message);
    }
  });

  // Clean up old notifications every day at midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      const Notification = require('./src/models/Notification');
      if (!Notification) {
        logger.error('❌ Notification model not loaded');
        return;
      }

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await Notification.deleteMany({
        isRead: true,
        createdAt: { $lt: thirtyDaysAgo },
      });

      if (result?.deletedCount > 0) {
        logger.info(`⏰ Cron: Cleaned ${result.deletedCount} old notifications`);
      }
    } catch (error) {
      logger.error('❌ Cron job failed - Notification cleanup:', error.message);
    }
  });

  logger.info('✅ Cron jobs scheduled');
};

// ─── Graceful Shutdown Setup ─────────────────────────────────────────────────
const setupGracefulShutdown = () => {
  const shutdown = async (signal) => {
    logger.info(`\n${signal} received. Shutting down gracefully...`);

    // Close HTTP server
    server.close(async () => {
      logger.info('🔴 HTTP server closed');

      // Close Socket.io
      io.close();
      logger.info('🔴 Socket.io closed');

      // Close MongoDB connection
      const mongoose = require('mongoose');
      try {
        await mongoose.connection.close();
        logger.info('🔴 MongoDB connection closed');
      } catch (error) {
        logger.error('Error closing MongoDB:', error.message);
      }

      logger.info('✅ Graceful shutdown complete');
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('❌ Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('❌ Unhandled Rejection:', {
      reason: reason instanceof Error ? reason.message : reason,
      promise: promise?.constructor?.name,
      timestamp: new Date().toISOString(),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('❌ Uncaught Exception:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
    process.exit(1);
  });
};

// ─── Start Application ───────────────────────────────────────────────────────
bootstrap();

module.exports = { server, io };
