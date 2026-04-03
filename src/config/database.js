const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    logger.info(`🔗 Connecting to MongoDB: ${mongoURI.split('@')[0]}...`);

    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000, // 10 seconds
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      retryWrites: true,
      family: 4, // Use IPv4
    };

    const conn = await mongoose.connect(mongoURI, options);

    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
    logger.info(`📦 Database: ${conn.connection.name}`);
    logger.info(`🔐 Connection State: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);

    // ─── Connection Event Handlers ────────────────────────────────────────
    mongoose.connection.on('error', (err) => {
      logger.error('❌ MongoDB connection error:', {
        message: err.message,
        code: err.code,
      });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️  MongoDB disconnected. Attempting reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('✅ MongoDB reconnected successfully');
    });

    mongoose.connection.on('close', () => {
      logger.info('🔴 MongoDB connection closed');
    });

    return conn;
  } catch (error) {
    logger.error(`❌ MongoDB Connection Failed:`, {
      message: error.message,
      code: error.code,
      mongoURI: process.env.MONGODB_URI?.split('@')[0],
    });
    
    // Exit with error
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    logger.info('✅ MongoDB connection closed due to app termination');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error closing MongoDB connection:', error.message);
    process.exit(1);
  }
});

module.exports = connectDB;
