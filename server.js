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

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.CLIENT_URL?.split(',') || ['https://krushimitra.com']
      : ['http://10.140.239.234:8081', 'http://localhost:19006', 'exp://10.140.239.234:8081'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────────────────────────────────
const bootstrap = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Initialize Firebase Admin
    initFirebase();

    // 3. Initialize Socket.io
    initializeSocket(io);

    // 4. Start server
    server.listen(PORT, '0.0.0.0', () => {
      logger.info('─'.repeat(60));
      logger.info('🌾  KrushiMitra API Server Started');
      logger.info('─'.repeat(60));
      logger.info(`🚀  Environment : ${NODE_ENV}`);
      logger.info(`🌐  Port        : ${PORT}`);
      logger.info(`🔗  Base URL    : http://localhost:${PORT}/api/v1`);
      logger.info(`💬  Socket.io   : ws://localhost:${PORT}`);
      logger.info(`❤️   Health      : http://localhost:${PORT}/health`);
      logger.info('─'.repeat(60));
    });

    // 5. Schedule cron jobs
    setupCronJobs();

    // 6. Graceful shutdown
    setupGracefulShutdown();

  } catch (error) {
    logger.error('❌ Bootstrap failed:', error);
    process.exit(1);
  }
};

// ─── Cron Jobs ──────────────────────────────────────────────────────────────────────────────────────────
const setupCronJobs = () => {
  // Sync mandi prices every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    logger.info('⏰ Cron: Syncing mandi prices...');
    await MandiService.fetchAndCachePrices('Gujarat').catch(logger.error);
    await MandiService.fetchAndCachePrices('Maharashtra').catch(logger.error);
  });

  // Expire old offers every hour
  cron.schedule('0 * * * *', async () => {
    const Offer = require('./src/models/Offer');
    const result = await Offer.updateMany(
      { status: 'pending', expiresAt: { $lt: new Date() } },
      { status: 'expired' }
    ).catch(logger.error);
    if (result?.modifiedCount > 0) {
      logger.info(`⏰ Cron: Expired ${result.modifiedCount} old offers`);
    }
  });

  // Clean up old notifications every day at midnight
  cron.schedule('0 0 * * *', async () => {
    const Notification = require('./src/models/Notification');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await Notification.deleteMany({
      isRead: true,
      createdAt: { $lt: thirtyDaysAgo },
    }).catch(logger.error);
    if (result?.deletedCount > 0) {
      logger.info(`⏰ Cron: Cleaned ${result.deletedCount} old notifications`);
    }
  });

  logger.info('✅ Cron jobs scheduled');
};

// ─── Graceful Shutdown ──────────────────────────────────────────────────────────────────────────────────────
const setupGracefulShutdown = () => {
  const shutdown = async (signal) => {
    logger.info(`\n${signal} received. Shutting down gracefully...`);

    server.close(async () => {
      logger.info('🔴 HTTP server closed');
      io.close();
      logger.info('🔴 Socket.io closed');
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      logger.info('🔴 MongoDB connection closed');
      logger.info('✅ Graceful shutdown complete');
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', { reason, promise });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
  });
};

bootstrap();

module.exports = { server, io };
