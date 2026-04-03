'use strict';
/**
 * paymentRoutes.js
 *
 * IMPORTANT: The Stripe webhook route MUST use express.raw() — NOT express.json().
 * Stripe verifies the raw request body to generate the signature.
 * This route is registered BEFORE the global express.json() middleware in app.js.
 */

const express  = require('express');
const router   = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const { handleWebhook }       = require('../controllers/stripeWebhookController');
const { initiatePayment, confirmPayment } = require('../controllers/paymentController');

// ── Stripe webhook ─────────────────────────────────────────────────────────────
// raw body required for signature verification — no auth middleware
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  handleWebhook
);

// ── Protected payment routes ───────────────────────────────────────────────────
router.use(protect);

router.post('/initiate', restrictTo('buyer'), initiatePayment);
router.post('/confirm',  restrictTo('buyer'), confirmPayment);

module.exports = router;