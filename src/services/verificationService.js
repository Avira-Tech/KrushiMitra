'use strict';

const axios = require('axios');
const razorpay = require('../config/razorpay');
const logger = require('../utils/logger');

/**
 * Verhoeff Algorithm for Aadhaar Checksum Validation
 */
const verhoeff = {
  d: [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ],
  p: [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ],
  inv: [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]
};

/**
 * Validates Aadhaar number using Verhoeff Algorithm
 */
const validateAadhaarFormat = (aadhaar) => {
  if (!/^\d{12}$/.test(aadhaar)) return false;
  
  let c = 0;
  let invertedAadhaar = aadhaar.split('').reverse().map(Number);
  
  for (let i = 0; i < invertedAadhaar.length; i++) {
    c = verhoeff.d[c][verhoeff.p[i % 8][invertedAadhaar[i]]];
  }
  
  return c === 0;
};

/**
 * Validates GST number format using Regex
 */
const validateGSTFormat = (gst) => {
  const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstRegex.test(gst);
};

/**
 * Verifies GST Details using Razorpay API
 * @param {string} gstNumber 
 */
const verifyGSTWithRazorpay = async (gstNumber) => {
  try {
    if (!validateGSTFormat(gstNumber)) {
      throw new Error('Invalid GST format');
    }

    // Note: Razorpay GST validation is typically part of their 'Validation' suite
    // Documentation: https://razorpay.com/docs/api/payments/razorpayx/validation/gst/
    const response = await axios.post(
      'https://api.razorpay.com/v1/gstins/validations',
      { gstin: gstNumber },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET
        }
      }
    );

    return {
      isValid: response.data.status === 'active',
      details: response.data
    };
  } catch (error) {
    logger.error('GST Verification Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.description || 'GST verification failed');
  }
};

/**
 * Verifies Bank Account using Penny Drop (Razorpay)
 * @param {string} accountNumber 
 * @param {string} ifsc 
 * @param {string} name 
 */
const verifyBankAccount = async (accountNumber, ifsc, name) => {
  try {
    // Documentation: https://razorpay.com/docs/api/payments/razorpayx/validation/bank-account/
    const response = await axios.post(
      'https://api.razorpay.com/v1/fund_accounts/validations',
      {
        account_number: accountNumber,
        ifsc: ifsc,
        name: name
      },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET
        }
      }
    );

    return {
      isValid: response.data.status === 'completed' && response.data.results.account_status === 'active',
      registeredName: response.data.results.registered_name,
      details: response.data
    };
  } catch (error) {
    logger.error('Bank Verification Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.description || 'Bank verification failed');
  }
};

module.exports = {
  validateAadhaarFormat,
  validateGSTFormat,
  verifyGSTWithRazorpay,
  verifyBankAccount
};
