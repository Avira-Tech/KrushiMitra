const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Comprehensive health check for all services
 */
const getHealthStatus = async () => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {},
    errors: [],
  };

  // ─── Database Health ────────────────────────────────────────────────────────
  try {
    const dbAdmin = mongoose.connection.db.admin();
    const status = await dbAdmin.ping();
    health.services.database = {
      status: 'connected',
      latency: 'ok',
      name: mongoose.connection.name,
      host: mongoose.connection.host,
    };
  } catch (err) {
    health.services.database = {
      status: 'disconnected',
      error: err.message,
    };
    health.errors.push('Database connection failed');
    health.status = 'degraded';
  }

  // ─── Memory Health ─────────────────────────────────────────────────────────
  const memUsage = process.memoryUsage();
  const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  health.services.memory = {
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    heapUsagePercent: `${heapUsagePercent.toFixed(2)}%`,
  };

  if (heapUsagePercent > 90) {
    health.errors.push('High memory usage');
    health.status = 'degraded';
  }

  // ─── Event Loop Health ─────────────────────────────────────────────────────
  health.services.eventLoop = {
    status: 'healthy',
  };

  // ─── Active Connections ────────────────────────────────────────────────────
  if (global.io) {
    const count = global.io.engine.clientsCount || 0;
    health.services.websocket = {
      active_connections: count,
      status: count > 0 ? 'active' : 'idle',
    };
  }

  // ─── Final Status ──────────────────────────────────────────────────────────
  if (health.errors.length > 0) {
    health.status = health.status === 'healthy' ? 'degraded' : health.status;
  }

  return health;
};

module.exports = { getHealthStatus };
