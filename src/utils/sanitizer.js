const xss = require('xss');
const mongoSanitize = require('express-mongo-sanitize');

/**
 * Sanitize string input to prevent XSS
 */
const sanitizeString = (str) => {
  if (!str) return '';
  return xss(str.trim(), {
    whiteList: {},
    stripIgnoredTag: true,
  });
};

/**
 * Sanitize URL
 */
const sanitizeUrl = (url) => {
  if (!url) return '';
  
  try {
    // Validate URL format
    const urlObj = new URL(url);
    
    // Only allow http and https
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Invalid protocol');
    }
    
    return url;
  } catch (error) {
    console.warn('Invalid URL provided:', url);
    return '';
  }
};

/**
 * Sanitize object recursively
 */
const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = {};
  for (const key in obj) {
    const value = obj[key];
    
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

/**
 * Sanitize MongoDB query to prevent NoSQL injection
 */
const sanitizeQuery = (query) => {
  return mongoSanitize.has(query) ? {} : query;
};

module.exports = {
  sanitizeString,
  sanitizeUrl,
  sanitizeObject,
  sanitizeQuery,
};
