'use strict';
/**
 * routes/paymentRoutes.js
 *
 * These are all the authenticated payment routes.
 * The Razorpay webhook is NOT here — it lives directly on app.js
 * at POST /api/v1/payments/webhook with its own express.raw() body parser,
 * mounted BEFORE express.json() so Razorpay's signature stays intact.
 *
 * All routes here are mounted AFTER express.json() so req.body is always
 * a parsed object. This is why createPaymentOrder receives { contractId }
 * correctly.
 */

const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const { paymentLimiter } = require('../middlewares/endpointRateLimiters');
const {
  createStripePaymentIntent,
  verifyStripePayment,
  confirmCodPayment,
  releasePayment,
  initiateRefund,
  getPaymentHistory,
} = require('../controllers/paymentController');

// Every route below requires a valid JWT
router.use(protect);

// 0. Fetch payment history for the logged in user
router.get('/history', getPaymentHistory);

// 1. Buyer creates a Stripe PaymentIntent → frontend gets clientSecret
router.post('/create-intent', restrictTo('buyer'), paymentLimiter, createStripePaymentIntent);

// 2. Buyer calls this after Stripe payment succeeds (Intent verification)
router.post('/verify', restrictTo('buyer'), verifyStripePayment);

// 3. Buyer confirms cash/UPI payment was made on delivery
router.post('/cod-confirm', restrictTo('buyer'), confirmCodPayment);

// 4. Buyer releases escrow after confirming delivery
router.post('/:contractId/release', releasePayment);

// 5. Admin or buyer initiates a refund for a disputed contract
router.post('/refund', initiateRefund);

module.exports = router;