'use strict';
/**
 * app.js — KrushiMitra Express Application
 *
 * This application is configured for production-grade security,
 * performance, and observability.
 */

require('express-async-errors');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const xss = require('xss-clean');
const path = require('path');
const fs = require('fs');

const logger = require('./src/utils/logger');
const { apiLimiter } = require('./src/middlewares/rateLimiter');
const { errorHandler, notFound } = require('./src/middlewares/errorHandler');
const { getHealthStatus } = require('./src/services/healthService');
const {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  errorLoggingMiddleware,
  slowRequestMiddleware,
} = require('./src/middlewares/requestLogging');
const { checkMaintenance } = require('./src/middlewares/auth');

// ─── Route imports ────────────────────────────────────────────────────────────
const authRoutes = require('./src/routes/authRoutes');
const cropRoutes = require('./src/routes/cropRoutes');
const offerRoutes = require('./src/routes/offerRoutes');
const contractRoutes = require('./src/routes/contractRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const weatherRoutes = require('./src/routes/weatherRoutes');
const mandiRoutes = require('./src/routes/mandiRoutes');
const reviewRoutes = require('./src/routes/reviewRoutes');
const cmsRoutes = require('./src/routes/cmsRoutes');
const payoutRoutes = require('./src/routes/payoutRoutes');
const paymentPageRoute = require('./src/routes/paymentPage');

const app = express();

// ─── Ensure logs directory exists ─────────────────────────────────────────────
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ─── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "https://js.stripe.com", "https://checkout.razorpay.com", "'unsafe-inline'"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com", "https://api.razorpay.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://api.razorpay.com", "wss:", "ws:"], // Support WebSocket
      imgSrc: ["'self'", 'data:', 'https:', 'blob:', 'https://razorpay.com', 'https://stripe.com'],
    },
  },
}));

app.use(cors({
  origin: (origin, callback) => {
    const raw = process.env.ALLOWED_ORIGINS ?? '';
    const allowedOrigins = raw.split(',').map((o) => o.trim()).filter(Boolean);
    
    // 1. Allow if in whitelist
    if (allowedOrigins.includes(origin)) return callback(null, true);
    
    // 2. Allow if origin is missing (e.g., Mobile App, Postman, Server-to-Server)
    if (!origin) return callback(null, true);
    
    // 3. Allow if in development mode
    if (process.env.NODE_ENV === 'development') return callback(null, true);
    
    // Otherwise, block
    logger.warn(`CORS blocked request from unauthorized origin: ${origin}`);
    callback(new Error(`CORS policy: ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'Accept'],
}));

app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// ─── Webhook (Must be before express.json) ────────────────────────────────────
// Stripe signs the raw request body. Razorpay also benefits from raw body parsing.
const API_PREFIX = '/api/v1';
const { handleWebhook } = require('./src/controllers/paymentController');

app.post(
  `${API_PREFIX}/payments/webhook`,
  express.raw({ type: 'application/json' }),
  handleWebhook,
);

// ─── Body parsing (all other routes) ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Sanitization & Security (MUST be after body parsing) ─────────────────────
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// ─── Request tracking & logging ───────────────────────────────────────────────
app.use(correlationIdMiddleware);
app.use(requestLoggingMiddleware);
app.use(slowRequestMiddleware(1000));
app.use(errorLoggingMiddleware);

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.path === '/health',
  }));
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const health = await getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    return res.status(statusCode).json({
      success: health.status === 'healthy',
      ...health,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (err) {
    return res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Service unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── API routes ────────────────────────────────────────────────────────────────
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/crops`, cropRoutes);
app.use(`${API_PREFIX}/offers`, offerRoutes);
app.use(`${API_PREFIX}/contracts`, contractRoutes);
app.use(`${API_PREFIX}/payments`, paymentRoutes);
app.use(`${API_PREFIX}/chats`, chatRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);

// Maintenance Mode Protection (Blocks non-admins if active)
app.use(checkMaintenance);

app.use(`${API_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_PREFIX}/weather`, weatherRoutes);
app.use(`${API_PREFIX}/mandi`, mandiRoutes);
app.use(`${API_PREFIX}/reviews`, reviewRoutes);
app.use(`${API_PREFIX}/cms`, cmsRoutes);
app.use(`${API_PREFIX}/payouts`, payoutRoutes);
app.use(`${API_PREFIX}/`, paymentPageRoute);

// ─── API index ────────────────────────────────────────────────────────────────
app.get(`${API_PREFIX}`, (req, res) => {
  res.json({
    success: true,
    message: '🌾 KrushiMitra API v1.0.0',
    endpoints: {
      auth: `${API_PREFIX}/auth`,
      crops: `${API_PREFIX}/crops`,
      offers: `${API_PREFIX}/offers`,
      contracts: `${API_PREFIX}/contracts`,
      payments: `${API_PREFIX}/payments`,
      chats: `${API_PREFIX}/chats`,
      admin: `${API_PREFIX}/admin`,
      notifications: `${API_PREFIX}/notifications`,
      weather: `${API_PREFIX}/weather`,
      mandi: `${API_PREFIX}/mandi`,
      reviews: `${API_PREFIX}/reviews`,
    },
  });
});

// ─── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;