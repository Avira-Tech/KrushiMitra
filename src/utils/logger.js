const winston = require('winston');
const path = require('path');

const { combine, timestamp, errors, json, colorize, printf, splat } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} [${level.toUpperCase()}]: ${stack || message}${metaStr}`;
});

const maskPII = winston.format((info) => {
  const mask = (str, type) => {
    if (!str || typeof str !== 'string') return str;
    if (type === 'phone') return str.replace(/(\d{3})(\d{4})(\d{3})/, '$1****$3');
    if (type === 'email') return str.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    return '*****';
  };

  if (typeof info.message === 'string') {
    // Mask typical Indian phone numbers and generic emails
    info.message = info.message.replace(/(\+91|91|0)?[6-9]\d{9}/g, '***REDACTED_PHONE***');
    info.message = info.message.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***REDACTED_EMAIL***');
  }

  if (info.phone) info.phone = '***REDACTED***';
  if (info.email) info.email = '***REDACTED***';
  if (info.otp)   info.otp   = '***';

  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    maskPII(),
    splat(),
    json()
  ),
  defaultMeta: { service: 'krushimitra-api' },
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
});

if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: path.join('logs', 'access.log'),
    level: 'http',
  }));
}

module.exports = logger;
