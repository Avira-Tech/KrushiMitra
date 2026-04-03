// 'use strict';
// require('express-async-errors');
// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const helmet = require('helmet');
// const morgan = require('morgan');
// const compression = require('compression');
// const mongoSanitize = require('express-mongo-sanitize');
// const path = require('path');
// const fs = require('fs');

// const logger = require('./src/utils/logger');
// const { apiLimiter } = require('./src/middlewares/rateLimiter');
// const { errorHandler, notFound } = require('./src/middlewares/errorHandler');
// // const { requestTimeout } = require('./src/middlewares/requestHandler');
// // const { csrfTokenMiddleware, validateCsrfToken } = require('./src/middlewares/csrf');
// const { getHealthStatus } = require('./src/services/healthService');
// const { 
//   correlationIdMiddleware, 
//   requestLoggingMiddleware, 
//   errorLoggingMiddleware,
//   slowRequestMiddleware 
// } = require('./src/middlewares/requestLogging');

// // Route imports
// const authRoutes = require('./src/routes/authRoutes');
// const cropRoutes = require('./src/routes/cropRoutes');
// const offerRoutes = require('./src/routes/offerRoutes');
// const contractRoutes = require('./src/routes/contractRoutes');
// const chatRoutes = require('./src/routes/chatRoutes');
// const adminRoutes = require('./src/routes/adminRoutes');
// const notificationRoutes = require('./src/routes/notificationRoutes');
// const weatherRoutes = require('./src/routes/weatherRoutes');
// const mandiRoutes = require('./src/routes/mandiRoutes');
// const reviewRoutes = require('./src/routes/reviewRoutes');

// const app = express();

// // ─── Ensure logs directory exists ─────────────────────────────────────────────────────────────────────────
// const logsDir = path.join(process.cwd(), 'logs');
// if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// // ─── Security Middleware ─────────────────────────────────────────────────────────────────────────────────
// app.use(helmet({
//   crossOriginEmbedderPolicy: false,
//   contentSecurityPolicy: {
//     directives: {
//       defaultSrc: ["'self'"],
//       styleSrc: ["'self'", "'unsafe-inline'"],
//       scriptSrc: ["'self'"],
//       imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
//     },
//   },
// }));

// app.use(cors({
//   origin: (origin, callback) => {
//     const allowedOrigins = [
//       process.env.CLIENT_URL,
//       'http://10.140.239.234:8081',
//       'exp://10.140.239.234:8081',
//       'http://localhost:19006',
//       'exp://localhost:19000',
//     ].filter(Boolean);
//     if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
// }));

// app.use(mongoSanitize()); // Prevent NoSQL injection
// app.use(compression()); // Gzip compression
// // app.use(requestTimeout(30000)); // 30 second request timeout

// // ─── CSRF Protection ──────────────────────────────────────────────────────────
// // app.use(csrfTokenMiddleware); // Attach CSRF token to all requests
// // app.use(validateCsrfToken);   // Validate CSRF on state-changing requests

// // ✅ INSTEAD: Your CORS + Authorization header protection is sufficient
// // CSRF is only needed for cookie-based sessions, not JWT/Bearer tokens

// // Verify in auth middleware that Bearer token is used:
// // app.use((req, res, next) => {
// //   if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
// //     return res.status(401).json({ message: 'Authorization token is required' });
// //   }
// //   next();
// // });

// // ─── Body Parsing ─────────────────────────────────────────────────────────────────────────────────────
// app.use(express.json({ limit: '10mb' }));
// app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// // ─── Request Tracking & Logging ───────────────────────────────────────────────────────────────────────
// app.use(correlationIdMiddleware); // Add correlation ID to all requests
// app.use(requestLoggingMiddleware); // Log all requests/responses
// app.use(slowRequestMiddleware(1000)); // Alert on slow requests (>1s)
// app.use(errorLoggingMiddleware); // Log errors with context

// // ─── Logging ──────────────────────────────────────────────────────────────────────────────────────────
// if (process.env.NODE_ENV !== 'test') {
//   app.use(morgan('combined', {
//     stream: { write: (message) => logger.http(message.trim()) },
//     skip: (req) => req.path === '/health',
//   }));
// }

// // ─── Rate Limiting ───────────────────────────────────────────────────────────────────────────────────
// app.use('/api/', apiLimiter);

// // ─── Health Check ─────────────────────────────────────────────────────────────────────────────────────
// app.get('/health', async (req, res) => {
//   try {
//     const health = await getHealthStatus();
//     const statusCode = health.status === 'healthy' ? 200 : 
//                        health.status === 'degraded' ? 503 : 500;
    
//     // Add timeout protection
//     const timeoutPromise = new Promise((_, reject) =>
//       setTimeout(() => reject(new Error('Health check timeout')), 5000)
//     );
    
//     return res.status(statusCode).json({
//       success: health.status === 'healthy',
//       ...health,
//       timestamp: new Date().toISOString(),
//       uptime: process.uptime(),
//     });
//   } catch (err) {
//     logger.error('❌ Health check failed:', {
//       error: err.message,
//       stack: err.stack,
//       timestamp: new Date().toISOString(),
//     });
//     return res.status(503).json({
//       success: false,
//       status: 'unhealthy',
//       error: process.env.NODE_ENV === 'development' ? err.message : 'Service unavailable',
//       timestamp: new Date().toISOString(),
//     });
//   }
// });

// // ─── API Routes ──────────────────────────────────────────────────────────────────────────────────────
// const API_PREFIX = '/api/v1';

// app.use(`${API_PREFIX}/auth`, authRoutes);
// app.use(`${API_PREFIX}/crops`, cropRoutes);
// app.use(`${API_PREFIX}/offers`, offerRoutes);
// app.use(`${API_PREFIX}/contracts`, contractRoutes);
// app.use(`${API_PREFIX}/chats`, chatRoutes);
// app.use(`${API_PREFIX}/admin`, adminRoutes);
// app.use(`${API_PREFIX}/notifications`, notificationRoutes);
// app.use(`${API_PREFIX}/weather`, weatherRoutes);
// app.use(`${API_PREFIX}/mandi`, mandiRoutes);
// app.use(`${API_PREFIX}/reviews`, reviewRoutes);

// // ─── API Docs (dev only) ───────────────────────────────────────────────────────────────────────────────
// app.get(`${API_PREFIX}`, (req, res) => {
//   res.json({
//     success: true,
//     message: '🌾 KrushiMitra API v1.0.0',
//     tagline: 'From Farm to Market, A Trustworthy Bridge',
//     endpoints: {
//       auth: `${API_PREFIX}/auth`,
//       crops: `${API_PREFIX}/crops`,
//       offers: `${API_PREFIX}/offers`,
//       contracts: `${API_PREFIX}/contracts`,
//       chats: `${API_PREFIX}/chats`,
//       admin: `${API_PREFIX}/admin`,
//       notifications: `${API_PREFIX}/notifications`,
//       weather: `${API_PREFIX}/weather`,
//       mandi: `${API_PREFIX}/mandi`,
//       reviews: `${API_PREFIX}/reviews`,
//     },
//     docs: 'https://github.com/krushimitra/api-docs',
//   });
// });

// // ─── Error Handling ───────────────────────────────────────────────────────────────────────────────────
// app.use(notFound);
// app.use(errorHandler);

// module.exports = app;


'use strict';
/**
 * app.js — PATCHED
 *
 * Key change: /api/v1/payments/webhook is registered BEFORE express.json()
 * so Stripe receives the raw Buffer needed for signature verification.
 * All other routes continue to use express.json() normally.
 */
require('express-async-errors');
require('dotenv').config();

const express       = require('express');
const cors          = require('cors');
const helmet        = require('helmet');
const morgan        = require('morgan');
const compression   = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const path          = require('path');
const fs            = require('fs');

const logger       = require('./src/utils/logger');
const { apiLimiter } = require('./src/middlewares/rateLimiter');
const { errorHandler, notFound } = require('./src/middlewares/errorHandler');
const { getHealthStatus } = require('./src/services/healthService');
const {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  errorLoggingMiddleware,
  slowRequestMiddleware,
} = require('./src/middlewares/requestLogging');

// ─── Route imports ────────────────────────────────────────────────────────────
const authRoutes         = require('./src/routes/authRoutes');
const cropRoutes         = require('./src/routes/cropRoutes');
const offerRoutes        = require('./src/routes/offerRoutes');
const contractRoutes     = require('./src/routes/contractRoutes');
const chatRoutes         = require('./src/routes/chatRoutes');
const adminRoutes        = require('./src/routes/adminRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const weatherRoutes      = require('./src/routes/weatherRoutes');
const mandiRoutes        = require('./src/routes/mandiRoutes');
const reviewRoutes       = require('./src/routes/reviewRoutes');
// ▼ NEW — contains the webhook route with its own raw-body parser
const paymentRoutes      = require('./src/routes/paymentRoutes');

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
      styleSrc:   ["'self'", "'unsafe-inline'"],
      scriptSrc:  ["'self'"],
      imgSrc:     ["'self'", 'data:', 'https:', 'blob:'],
    },
  },
}));

app.use(cors({
  origin: (origin, callback) => {
    const raw = process.env.ALLOWED_ORIGINS ?? '';
    const allowedOrigins = raw.split(',').map((o) => o.trim()).filter(Boolean);
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error(`CORS: ${origin} not allowed`));
    }
  },
  credentials:     true,
  methods:         ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:  ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(mongoSanitize());
app.use(compression());

// ─── ⚠️  STRIPE WEBHOOK — MUST BE REGISTERED BEFORE express.json() ────────────
// Stripe signs the raw request body. If express.json() runs first it converts
// the Buffer to a JS object and the signature check always fails with 400.
const API_PREFIX = '/api/v1';
app.use(`${API_PREFIX}/payments`, require('./src/routes/paymentRoutes'));

// ─── Body parsing (all other routes) ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Request tracking & logging ───────────────────────────────────────────────
app.use(correlationIdMiddleware);
app.use(requestLoggingMiddleware);
app.use(slowRequestMiddleware(1000));
app.use(errorLoggingMiddleware);

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip:   (req) => req.path === '/health',
  }));
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const health    = await getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    return res.status(statusCode).json({
      success:   health.status === 'healthy',
      ...health,
      timestamp: new Date().toISOString(),
      uptime:    process.uptime(),
    });
  } catch (err) {
    return res.status(503).json({
      success:   false,
      status:    'unhealthy',
      error:     process.env.NODE_ENV === 'development' ? err.message : 'Service unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── API routes ────────────────────────────────────────────────────────────────
app.use(`${API_PREFIX}/auth`,          authRoutes);
app.use(`${API_PREFIX}/crops`,         cropRoutes);
app.use(`${API_PREFIX}/offers`,        offerRoutes);
app.use(`${API_PREFIX}/contracts`,     contractRoutes);
// paymentRoutes already registered above (webhook must come before json parser)
app.use(`${API_PREFIX}/chats`,         chatRoutes);
app.use(`${API_PREFIX}/admin`,         adminRoutes);
app.use(`${API_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_PREFIX}/weather`,       weatherRoutes);
app.use(`${API_PREFIX}/mandi`,         mandiRoutes);
app.use(`${API_PREFIX}/reviews`,       reviewRoutes);

// ─── API index ────────────────────────────────────────────────────────────────
app.get(`${API_PREFIX}`, (req, res) => {
  res.json({
    success: true,
    message: '🌾 KrushiMitra API v1.0.0',
    endpoints: {
      auth:          `${API_PREFIX}/auth`,
      crops:         `${API_PREFIX}/crops`,
      offers:        `${API_PREFIX}/offers`,
      contracts:     `${API_PREFIX}/contracts`,
      payments:      `${API_PREFIX}/payments`,
      chats:         `${API_PREFIX}/chats`,
      admin:         `${API_PREFIX}/admin`,
      notifications: `${API_PREFIX}/notifications`,
      weather:       `${API_PREFIX}/weather`,
      mandi:         `${API_PREFIX}/mandi`,
      reviews:       `${API_PREFIX}/reviews`,
    },
  });
});

// ─── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;