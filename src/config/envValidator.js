'use strict';
/**
 * envValidator.js
 * 
 * Validates required environment variables at startup.
 * Prevents the server from starting in a broken state.
 */

const logger = require('../utils/logger');

const REQUIRED_ENV = [
  'NODE_ENV',
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'REDIS_URL'
];

const validateEnv = () => {
  const missing = [];
  
  REQUIRED_ENV.forEach(key => {
    if (!process.env[key]) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    logger.error('FATAL: Missing required environment variables:');
    missing.forEach(m => logger.error(` - ${m}`));
    
    if (process.env.NODE_ENV === 'production') {
      logger.error('Exiting due to missing env vars in production.');
      process.exit(1);
    } else {
      logger.warn('Workflow may be broken. Please check your .env file.');
    }
  } else {
    logger.info('Environment variables validated successfully.');
  }
};

module.exports = validateEnv;
