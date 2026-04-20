'use strict';
/**
 * config/razorpay.js
 *
 * Wraps the Razorpay Node SDK.
 * Install:  npm install razorpay
 *
 * Required env vars:
 *   RAZORPAY_KEY_ID      — from Razorpay Dashboard → API Keys
 *   RAZORPAY_KEY_SECRET  — from Razorpay Dashboard → API Keys
 *   RAZORPAY_WEBHOOK_SECRET — from Razorpay Dashboard → Webhooks
 */

const Razorpay = require('razorpay');
const crypto = require('crypto');
const logger = require('../utils/logger');

// ─── Environment validation ───────────────────────────────────────────────────
const validateEnv = (key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return process.env[key];
};

// ─── SDK instance ─────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: validateEnv('RAZORPAY_KEY_ID'),
  key_secret: validateEnv('RAZORPAY_KEY_SECRET'),
});

/**
 * Create a Razorpay order.
 * Amount must be in paise (INR × 100).
 *
 * @param {{ amount: number, currency?: string, receipt: string, notes?: object }} opts
 * @returns {Promise<RazorpayOrder>}
 */
const createOrder = async ({ amount, currency = 'INR', receipt, notes = {} }) => {
  const amountPaise = Math.round(amount * 100); // ₹ → paise
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency,
    receipt: receipt.substring(0, 40), // Razorpay receipt max 40 chars
    notes,
    payment_capture: 1, // auto-capture after buyer pays
  });
  logger.info(`Razorpay order created: ${order.id} — ₹${amount}`);
  return order;
};

/**
 * Verify Razorpay payment signature (HMAC-SHA256).
 * Must be called after buyer completes payment on frontend.
 *
 * @param {{ orderId: string, paymentId: string, signature: string }} params
 * @returns {boolean}
 */
const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(body)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex'),
  );

  if (!isValid) logger.warn(`Razorpay signature mismatch — orderId: ${orderId}`);
  return isValid;
};

/**
 * Verify Razorpay webhook signature.
 * Called inside the webhook endpoint.
 *
 * @param {string} rawBody    — raw request body string
 * @param {string} signature  — X-Razorpay-Signature header
 * @returns {boolean}
 */
const verifyWebhookSignature = (rawBody, signature) => {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
};

/**
 * Fetch a Razorpay payment record.
 * @param {string} paymentId
 */
const fetchPayment = async (paymentId) => razorpay.payments.fetch(paymentId);

/**
 * Initiate a refund.
 * @param {{ paymentId: string, amount?: number, reason?: string }} opts
 * amount in ₹ (will be converted to paise); omit for full refund
 */
const refundPayment = async ({ paymentId, amount, reason = 'Dispute / Cancellation' }) => {
  const body = { notes: { reason } };
  if (amount) body.amount = Math.round(amount * 100);
  const refund = await razorpay.payments.refund(paymentId, body);
  logger.info(`Razorpay refund initiated: ${refund.id} for payment ${paymentId}`);
  return refund;
};

module.exports = {
  razorpay,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  fetchPayment,
  refundPayment,
};