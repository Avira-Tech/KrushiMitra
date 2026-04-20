'use strict';
/**
 * server.js — KrushiMitra API Server
 *
 * Startup order:
 *  1. Razorpay webhook route (needs raw body — BEFORE express.json)
 *  2. MongoDB connect
 *  3. Firebase Admin init
 *  4. Socket.io with JWT middleware
 *  5. HTTP server listen
 *  6. Cron jobs
 */

require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const cron = require('node-cron');

const app         = require('./app');
const connectDB   = require('./src/config/database');
const validateEnv = require('./src/config/envValidator');
const { initFirebase }     = require('./src/config/firebase');
const { initializeSocket } = require('./src/sockets/socketHandler');
const { redis } = require('./src/config/redis');
const { startDeliveryWorker } = require('./src/workers/deliveryWorker');
const socketService = require('./src/utils/socketService');
const logger = require('./src/utils/logger');

const PORT     = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

if (PORT < 1024 || PORT > 65535) {
  logger.error(`Invalid PORT: ${PORT}`);
  process.exit(1);
}

const server = http.createServer(app);

// ─── Socket.io & SocketService ────────────────────────────────────────────────
// Polling first — upgrades to websocket automatically. This fixes "websocket
// error" on real Android devices where ws is blocked by carrier/VPN.
const io = new Server(server, {
  cors: {
    origin:      NODE_ENV === 'production'
      ? (process.env.CLIENT_URL ?? '').split(',').filter(Boolean)
      : true,                            // ← allow ALL in dev
    credentials: true,
    methods:     ['GET', 'POST'],
  },
  transports:    ['polling', 'websocket'], // polling FIRST for mobile compatibility
  allowUpgrades: true,
  pingTimeout:   60_000,
  pingInterval:  25_000,
  maxHttpBufferSize: 1e6,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

// Horizontal Scaling: Sync socket events across multiple server nodes using Redis
const pubClient = redis;
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

socketService.init(io);

// ─── Bootstrap ───────────────────────────────────────────────────────────────
const bootstrap = async () => {
  try {
    validateEnv();
    await connectDB();
    logger.info('MongoDB connected');

    initFirebase();
    logger.info('Firebase initialized');

    initializeSocket(io);
    logger.info('Socket.io initialized');

    startDeliveryWorker();
    logger.info('Delivery Worker initialized');

    server.listen(PORT, '0.0.0.0', () => {
      logger.info('─'.repeat(60));
      logger.info(`🌾  KrushiMitra API — ${NODE_ENV.toUpperCase()}`);
      logger.info(`🚀  http://0.0.0.0:${PORT}/api/v1`);
      logger.info(`💬  ws://0.0.0.0:${PORT}`);
      logger.info(`❤️   http://0.0.0.0:${PORT}/health`);
      logger.info('─'.repeat(60));
    });

    setupCronJobs();
    setupGracefulShutdown();
  } catch (err) {
    logger.error('Bootstrap failed: ' + err.message);
    process.exit(1);
  }
};

// ─── Cron Jobs ────────────────────────────────────────────────────────────────
const setupCronJobs = () => {
  /**
   * Helper to ensure a cron job runs on only one instance in a distributed system.
   * Uses Redis SET with NX (not exists) and EX (expiry) to create a lock.
   */
  const withDistributedLock = async (lockKey, task, expirySeconds = 3600) => {
    const key = `lock:cron:${lockKey}`;
    try {
      const lock = await redis.set(key, 'locked', 'NX', 'EX', expirySeconds);
      if (lock) {
        logger.info(`[Cron] 🔒 Acquired lock for ${lockKey}`);
        await task();
      } else {
        logger.debug(`[Cron] ⏩ Skipping ${lockKey} (locked by another instance)`);
      }
    } catch (err) {
      logger.error(`[Cron] Lock error for ${lockKey}: ${err.message}`);
    }
  };

  // Sync mandi prices every 6 hours
  cron.schedule('0 */6 * * *', () => {
    withDistributedLock('mandi-price-sync', async () => {
      const { syncMandiPrices } = require('./src/controllers/mandiController');
      await Promise.all(['Gujarat', 'Maharashtra', 'Punjab', 'Haryana'].map((s) => syncMandiPrices(s)));
      logger.info('Mandi prices synced');
    }, 5 * 60 * 60);
  });

  // Expire stale offers every hour
  cron.schedule('0 * * * *', () => {
    withDistributedLock('offer-expiry', async () => {
      const Offer  = require('./src/models/Offer');
      const result = await Offer.updateMany(
        { status: 'pending', expiresAt: { $lt: new Date() } },
        { status: 'expired' }
      );
      if (result.modifiedCount) logger.info(`Expired ${result.modifiedCount} offers`);
    }, 55 * 60);
  });

  // Clean read notifications older than 30 days — midnight
  cron.schedule('0 0 * * *', () => {
    withDistributedLock('notification-cleanup', async () => {
      const Notification = require('./src/models/Notification');
      const cutoff       = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result       = await Notification.deleteMany({ isRead: true, createdAt: { $lt: cutoff } });
      if (result.deletedCount) logger.info(`Cleaned ${result.deletedCount} old notifications`);
    }, 23 * 60 * 60);
  });

  logger.info('Cron jobs scheduled');
};

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const setupGracefulShutdown = () => {
  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      io.close();
      const mongoose = require('mongoose');
      await mongoose.connection.close().catch(() => {});
      logger.info('Server shut down cleanly');
      process.exit(0);
    });
    // Force exit if graceful shutdown stalls
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection: ' + (reason instanceof Error ? reason.message : String(reason)));
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception: ' + err.message);
    process.exit(1);
  });
};

// Start bootstrapping directly (removed cluster mode)
bootstrap();

module.exports = { server, io };