'use strict';
const logger = require('../utils/logger');

/**
 * Strips sensitive fields from data objects before logging.
 */
const sanitizeData = (data) => {
  if (!data) return data;
  const sensitiveFields = ['otp', 'password', 'token', 'refreshToken', 'razorpay_secret', 'secret', 'cvv', 'card'];
  const sanitized = { ...data };

  sensitiveFields.forEach(field => {
    if (field in sanitized) sanitized[field] = '*****';
  });

  // Recursively sanitize if needed (shallow for now to save performance)
  return sanitized;
};

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errorCode = err.code || 'INTERNAL_ERROR';
  let errors = null;

  // Security: Log errors but sanitize the body
  logger.error(`[${req.method}] ${req.path} - ${statusCode}: ${message}`, {
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    user: req.user?._id,
    body: sanitizeData(req.body),
    params: req.params,
    query: req.query,
  });

  // ─── Known Error Mappings ──────────────────────────────────────────────────

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    statusCode = 422;
    errorCode = 'VALIDATION_ERROR';
    message = 'Validation failed';
    errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }

  // Mongoose Duplicate Key Error
  if (err.code === 11000) {
    statusCode = 409;
    errorCode = 'DUPLICATE_RESOURCE';
    const field = Object.keys(err.keyValue)[0];
    message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
  }

  // Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    errorCode = 'INVALID_ID';
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    message = 'Invalid authentication token';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    message = 'Authentication token expired';
  }

  // Razorpay Errors
  if (err.statusCode === 400 && err.error?.description) {
    statusCode = 400;
    errorCode = 'PAYMENT_ERROR';
    message = err.error.description;
  }

  const response = {
    success: false,
    code: errorCode,
    message,
    ...(errors && { errors }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  };

  res.status(statusCode).json(response);
};

/**
 * 404 Not Found handler
 */
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    code: 'RESOURCE_NOT_FOUND',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
};

/**
 * Async error wrapper
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, notFound, asyncHandler };
