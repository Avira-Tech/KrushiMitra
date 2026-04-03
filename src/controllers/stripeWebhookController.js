'use strict';
/**
 * stripeWebhookController.js
 *
 * Handles verified Stripe webhook events.
 * Only this controller (not the client) should update payment/contract status.
 *
 * Required route setup in app.js BEFORE express.json() body-parser:
 *   app.post(
 *     '/api/v1/payments/webhook',
 *     express.raw({ type: 'application/json' }),   ← raw body required for Stripe sig verification
 *     stripeWebhookController.handleWebhook
 *   );
 */

const { constructWebhookEvent, capturePaymentIntent } = require('../config/stripe');
const Contract           = require('../models/Contract');
const Payment            = require('../models/Payment');
const NotificationService = require('../services/notificationService');
const logger             = require('../utils/logger');

// ─── POST /api/v1/payments/webhook ───────────────────────────────────────────
const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    logger.warn('Stripe webhook received without signature header');
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event;
  try {
    // req.body must be the raw Buffer — use express.raw() on this route
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  logger.info(`📦 Stripe webhook received: ${event.type} [${event.id}]`);

  try {
    switch (event.type) {
      // ── Payment authorised (manual-capture flow for escrow) ────────────────
      case 'payment_intent.amount_capturable_updated': {
        await handlePaymentAuthorised(event.data.object);
        break;
      }

      // ── Payment fully captured (escrow released) ───────────────────────────
      case 'payment_intent.succeeded': {
        await handlePaymentSucceeded(event.data.object);
        break;
      }

      // ── Payment failed ─────────────────────────────────────────────────────
      case 'payment_intent.payment_failed': {
        await handlePaymentFailed(event.data.object);
        break;
      }

      // ── Refund processed ───────────────────────────────────────────────────
      case 'charge.refunded': {
        await handleRefund(event.data.object);
        break;
      }

      // ── Payment cancelled ──────────────────────────────────────────────────
      case 'payment_intent.canceled': {
        await handlePaymentCancelled(event.data.object);
        break;
      }

      default:
        logger.debug(`Stripe webhook: unhandled event type ${event.type}`);
    }

    // Acknowledge receipt immediately — Stripe retries on non-2xx
    return res.status(200).json({ received: true, type: event.type });
  } catch (err) {
    logger.error(`Stripe webhook handler error (${event.type}):`, err);
    // Return 200 to prevent Stripe retrying an event that caused a server error
    // Log internally and handle manually if needed
    return res.status(200).json({ received: true, error: 'Handler error — logged internally' });
  }
};

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * payment_intent.amount_capturable_updated
 * Fires when funds are authorised and held — escrow is ready.
 */
const handlePaymentAuthorised = async (paymentIntent) => {
  const contractId = paymentIntent.metadata?.contractId;
  if (!contractId) return;

  const contract = await Contract.findById(contractId);
  if (!contract) return;
  if (contract.payment.status !== 'pending') return; // idempotency guard

  await Contract.findByIdAndUpdate(contractId, {
    'payment.status':                'authorized',
    'payment.stripePaymentIntentId': paymentIntent.id,
    'payment.paidAt':                new Date(),
  });

  await Payment.findOneAndUpdate(
    { 'stripe.paymentIntentId': paymentIntent.id },
    { status: 'authorized', processedAt: new Date() }
  );

  logger.info(`✅ Payment authorised (escrow): ${paymentIntent.id} for contract ${contractId}`);

  // Notify farmer
  NotificationService.notifyPaymentReceived(
    contract,
    contract.farmer,
    paymentIntent.amount / 100
  ).catch(logger.error);

  // Emit socket event
  if (global.io) {
    global.io.to(`user:${contract.farmer}`).emit('payment_in_escrow', {
      contractId: contract._id,
      amount:     paymentIntent.amount / 100,
    });
  }
};

/**
 * payment_intent.succeeded
 * Fires when a payment is fully captured (escrow released to farmer).
 */
const handlePaymentSucceeded = async (paymentIntent) => {
  const contractId = paymentIntent.metadata?.contractId;
  if (!contractId) return;

  const contract = await Contract.findById(contractId);
  if (!contract) return;
  if (contract.payment.status === 'released') return; // idempotency

  const charge = paymentIntent.latest_charge;

  await Contract.findByIdAndUpdate(contractId, {
    'payment.status':      'released',
    'payment.releasedAt':  new Date(),
    'payment.stripeChargeId': typeof charge === 'string' ? charge : charge?.id,
    status:                'completed',
    completedAt:           new Date(),
  });

  await Payment.findOneAndUpdate(
    { 'stripe.paymentIntentId': paymentIntent.id },
    {
      status:           'captured',
      'stripe.chargeId': typeof charge === 'string' ? charge : charge?.id,
      releasedAt:       new Date(),
    }
  );

  logger.info(`✅ Payment captured & released: ${paymentIntent.id}`);

  NotificationService.notifyPaymentReleased(
    contract,
    contract.farmer,
    contract.terms?.netAmount ?? paymentIntent.amount / 100
  ).catch(logger.error);

  if (global.io) {
    global.io.to(`user:${contract.farmer}`).emit('payment_released', {
      contractId: contract._id,
      amount:     contract.terms?.netAmount,
    });
  }
};

/**
 * payment_intent.payment_failed
 */
const handlePaymentFailed = async (paymentIntent) => {
  const contractId = paymentIntent.metadata?.contractId;
  if (!contractId) return;

  await Contract.findByIdAndUpdate(contractId, {
    'payment.status': 'failed',
  });

  await Payment.findOneAndUpdate(
    { 'stripe.paymentIntentId': paymentIntent.id },
    {
      status:        'failed',
      failureReason: paymentIntent.last_payment_error?.message ?? 'Unknown failure',
    }
  );

  logger.warn(`❌ Payment failed: ${paymentIntent.id} for contract ${contractId}`);

  const contract = await Contract.findById(contractId);
  if (contract && global.io) {
    global.io.to(`user:${contract.buyer}`).emit('payment_failed', {
      contractId: contract._id,
      reason:     paymentIntent.last_payment_error?.message,
    });
  }
};

/**
 * charge.refunded
 */
const handleRefund = async (charge) => {
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) return;

  const payment = await Payment.findOne({ 'stripe.paymentIntentId': paymentIntentId });
  if (!payment) return;

  const refundAmount = charge.amount_refunded / 100;

  await Payment.findByIdAndUpdate(payment._id, {
    status:           'refunded',
    'refund.status':  refundAmount >= payment.amount ? 'full' : 'partial',
    'refund.amount':  refundAmount,
    'refund.refundedAt': new Date(),
  });

  await Contract.findByIdAndUpdate(payment.contract, {
    'payment.status':     'refunded',
    'payment.refundedAt': new Date(),
    status:               'cancelled',
  });

  logger.info(`✅ Refund processed: ₹${refundAmount} for paymentIntent ${paymentIntentId}`);
};

/**
 * payment_intent.canceled
 */
const handlePaymentCancelled = async (paymentIntent) => {
  const contractId = paymentIntent.metadata?.contractId;
  if (!contractId) return;

  await Contract.findByIdAndUpdate(contractId, {
    'payment.status': 'failed',
  });

  await Payment.findOneAndUpdate(
    { 'stripe.paymentIntentId': paymentIntent.id },
    { status: 'failed', failureReason: 'Payment intent cancelled' }
  );

  logger.info(`Payment cancelled: ${paymentIntent.id}`);
};

module.exports = { handleWebhook };