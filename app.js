'use strict';
require('express-async-errors');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');
const fs = require('fs');

const logger = require('./src/utils/logger');
const { apiLimiter } = require('./src/middlewares/rateLimiter');
const { errorHandler, notFound } = require('./src/middlewares/errorHandler');

// Route imports
const authRoutes = require('./src/routes/authRoutes');
const cropRoutes = require('./src/routes/cropRoutes');
const offerRoutes = require('./src/routes/offerRoutes');
const contractRoutes = require('./src/routes/contractRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const weatherRoutes = require('./src/routes/weatherRoutes');
const mandiRoutes = require('./src/routes/mandiRoutes');
const reviewRoutes = require('./src/routes/reviewRoutes');

const app = express();

// ─── Ensure logs directory exists ─────────────────────────────────────────────────────────────────────────
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ─── Security Middleware ─────────────────────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
    },
  },
}));

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.CLIENT_URL,
      'http://localhost:3000',
      'http://localhost:19006',
      'exp://localhost:19000',
    ].filter(Boolean);
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(mongoSanitize()); // Prevent NoSQL injection
app.use(compression()); // Gzip compression

// ─── Body Parsing ─────────────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ──────────────────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (message) => logger.http(message.trim()) },
    skip: (req) => req.path === '/health',
  }));
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'KrushiMitra API is running',
    version: '1.0.0',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    onlineUsers: global.io?.getOnlineCount?.() || 0,
  });
});

// ─── API Routes ──────────────────────────────────────────────────────────────────────────────────────
const API_PREFIX = '/api/v1';

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/crops`, cropRoutes);
app.use(`${API_PREFIX}/offers`, offerRoutes);
app.use(`${API_PREFIX}/contracts`, contractRoutes);
app.use(`${API_PREFIX}/chats`, chatRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_PREFIX}/weather`, weatherRoutes);
app.use(`${API_PREFIX}/mandi`, mandiRoutes);
app.use(`${API_PREFIX}/reviews`, reviewRoutes);

// ─── API Docs (dev only) ───────────────────────────────────────────────────────────────────────────────
app.get(`${API_PREFIX}`, (req, res) => {
  res.json({
    success: true,
    message: '🌾 KrushiMitra API v1.0.0',
    tagline: 'From Farm to Market, A Trustworthy Bridge',
    endpoints: {
      auth: `${API_PREFIX}/auth`,
      crops: `${API_PREFIX}/crops`,
      offers: `${API_PREFIX}/offers`,
      contracts: `${API_PREFIX}/contracts`,
      chats: `${API_PREFIX}/chats`,
      admin: `${API_PREFIX}/admin`,
      notifications: `${API_PREFIX}/notifications`,
      weather: `${API_PREFIX}/weather`,
      mandi: `${API_PREFIX}/mandi`,
      reviews: `${API_PREFIX}/reviews`,
    },
    docs: 'https://github.com/krushimitra/api-docs',
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
