const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Request logging middleware with correlation IDs
 * Adds unique ID to each request for tracing through logs
 */

/**
 * Middleware to attach correlation ID to all requests
 */
const correlationIdMiddleware = (req, res, next) => {
  // Generate or extract correlation ID
  const correlationId = req.headers['x-correlation-id'] || uuidv4();

  req.id = correlationId;
  req.startTime = Date.now();

  // Set response header
  res.setHeader('X-Correlation-ID', correlationId);

  // Enhance logger to include correlation ID
  const originalLogger = logger;
  req.log = {
    info: (msg, data) => originalLogger.info(`[${correlationId}] ${msg}`, data),
    warn: (msg, data) => originalLogger.warn(`[${correlationId}] ${msg}`, data),
    error: (msg, data) => originalLogger.error(`[${correlationId}] ${msg}`, data),
    debug: (msg, data) => originalLogger.debug(`[${correlationId}] ${msg}`, data),
  };

  next();
};

/**
 * Middleware to log all requests and responses
 */
const requestLoggingMiddleware = (req, res, next) => {
  // Skip logging for health check to reduce noise
  if (req.path === '/health') {
    return next();
  }

  // Capture response
  const originalSend = res.send;

  res.send = function (data) {
    res.send = originalSend;

    const duration = Date.now() - req.startTime;
    const statusCode = res.statusCode;

    // Log request details
    const logData = {
      correlationId: req.id,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode,
      duration: `${duration}ms`,
      clientIp: req.ip,
      userId: req.user?._id || 'anonymous',
      userRole: req.user?.role || 'guest',
    };

    // Add query params
    if (Object.keys(req.query).length > 0) {
      logData.query = req.query;
    }

    // Add request body (but sanitize sensitive fields)
    if (req.method !== 'GET' && Object.keys(req.body).length > 0) {
      logData.body = sanitizeLogData(req.body);
    }

    // Log level based on status code
    if (statusCode >= 500) {
      logger.error(`API Error: ${req.method} ${req.path}`, logData);
    } else if (statusCode >= 400) {
      logger.warn(`API Warning: ${req.method} ${req.path}`, logData);
    } else {
      logger.info(`API: ${req.method} ${req.path}`, logData);
    }

    return res.send(data);
  };

  next();
};

/**
 * Sanitize sensitive data before logging
 */
const sanitizeLogData = (data) => {
  if (!data || typeof data !== 'object') return data;

  const sanitized = { ...data };
  const sensitiveFields = [
    'password',
    'token',
    'refreshToken',
    'accessToken',
    'otp',
    'creditCard',
    'cardNumber',
    'cvv',
    'ssn',
    'secret',
    'privateKey',
  ];

  sensitiveFields.forEach(field => {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  });

  return sanitized;
};

/**
 * Error logging middleware
 */
const errorLoggingMiddleware = (err, req, res, next) => {
  const errorData = {
    correlationId: req.id,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    statusCode: err.statusCode || 500,
    errorMessage: err.message,
    errorType: err.name,
    stack: err.stack,
    userId: req.user?._id || 'anonymous',
    userRole: req.user?.role,
    clientIp: req.ip,
    query: req.query,
  };

  // Don't log request body for errors (already too much data)
  logger.error('API Error with full context', errorData);

  next(err);
};

/**
 * Middleware to track slow requests
 */
const slowRequestMiddleware = (slowThresholdMs = 1000) => {
  return (req, res, next) => {
    // Skip health check
    if (req.path === '/health') {
      return next();
    }

    const originalSend = res.send;

    res.send = function (data) {
      res.send = originalSend;

      const duration = Date.now() - req.startTime;

      if (duration > slowThresholdMs) {
        logger.warn(`Slow Request: ${req.method} ${req.path}`, {
          correlationId: req.id,
          duration: `${duration}ms`,
          threshold: `${slowThresholdMs}ms`,
          userId: req.user?._id,
        });
      }

      return res.send(data);
    };

    next();
  };
};

module.exports = {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  errorLoggingMiddleware,
  slowRequestMiddleware,
  sanitizeLogData,
};
