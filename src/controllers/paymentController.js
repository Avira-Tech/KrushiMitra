'use strict';
/**
 * paymentController.js
 *
 * Razorpay payment flow:
 *
 * ADVANCE PAYMENT (Escrow):
 *   1. POST /api/v1/contracts/:id/payment/choose  { paymentType: 'advance' }
 *   2. POST /api/v1/payments/create-order          → { orderId, amount, currency, keyId }
 *   3. Frontend opens Razorpay Checkout with these params
 *   4. On success Razorpay returns { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *   5. POST /api/v1/payments/verify                → server verifies signature, updates DB
 *   6. POST /api/v1/contracts/:id/payment/release  → buyer releases funds after delivery
 *
 * PAY ON DELIVERY:
 *   1. POST /api/v1/contracts/:id/payment/choose  { paymentType: 'on_delivery' }
 *      → contract confirmed immediately, delivery scheduled
 *   2. POST /api/v1/payments/cod-confirm           → buyer records cash/UPI payment on delivery
 *
 * WEBHOOK (Razorpay → server):
 *   POST /api/v1/payments/webhook  (raw body required — registered BEFORE express.json)
 */

const {
  stripe,
  createPaymentIntent,
  capturePaymentIntent,
  constructWebhookEvent,
  createRefund,
} = require('../config/stripe');
const { deliveryQueue } = require('../services/deliveryQueue');
const {
  transactionPaymentVerification,
  transactionPaymentRelease,
  transactionCodPayment,
} = require('../services/transactionService');
const NotificationService = require('../services/notificationService');
const socketService = require('../utils/socketService');
const { sendSuccess, sendError, sendNotFound, sendForbidden } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const User = require('../models/User');

/**
 * ─── POST /api/v1/payments/create-intent ──────────────────────────────────────
 * Creates a Stripe PaymentIntent for advance payment.
 * Manual capture is used for the Escrow system.
 */
const createStripePaymentIntent = async (req, res) => {
  try {
    const { contractId } = req.body;
    const buyerId = req.user._id || req.user.id;

    if (!contractId) {
      return sendError(res, { message: 'contractId is required', statusCode: 400 });
    }

    const contract = await Contract.findById(contractId)
      .populate('farmer', 'name phone email')
      .populate('buyer', 'name phone email');

    if (!contract) return sendNotFound(res, 'Contract not found');

    if (contract.buyer._id.toString() !== buyerId.toString()) {
      return sendForbidden(res, 'Only the buyer can initiate payment');
    }

    // 1. Strict status check
    const allowedStatuses = ['awaiting_buyer', 'awaiting_payment', 'pending'];
    if (!allowedStatuses.includes(contract.payment?.status)) {
      if (['paid', 'in_escrow', 'requires_capture'].includes(contract.payment?.status)) {
        return sendError(res, { message: 'Payment already completed or in progress', statusCode: 400 });
      }
      return sendError(res, { message: `Current payment status '${contract.payment?.status}' does not allow payment initiation`, statusCode: 400 });
    }

    // Calculate fees in integer units (cents/paise) to avoid precision errors
    const totalAmount = contract.terms?.totalAmount || 0;
    const totalUnits = Math.round(totalAmount * 100);
    const platformUnits = Math.round(totalUnits * 0.02);
    const gstUnits = Math.round(platformUnits * 0.18);
    const grandTotalUnits = totalUnits + platformUnits + gstUnits;

    const platformFee = platformUnits / 100;
    const gstOnFee = gstUnits / 100;
    const grandTotal = grandTotalUnits / 100;

    // Stripe minimum for INR is ₹50 (5000 paise). This is a hard requirement.
    const STRIPE_MIN_INR_PAISE = 5000;
    if (grandTotalUnits < STRIPE_MIN_INR_PAISE) {
      return sendError(res, {
        message: `Payment amount ₹${grandTotal.toFixed(2)} is below the minimum order value of ₹50. Please increase the quantity.`,
        statusCode: 400,
      });
    }

    // 2. IDEMPOTENCY: Re-use existing intent if it exists and hasn't expired/succeeded
    // Idempotency Key: contractId + userId + status
    const existingPayment = await Payment.findOne({
      contract: contract._id,
      status: { $in: ['initiated', 'requires_action', 'awaiting_payment'] },
      'stripe.paymentIntentId': { $exists: true },
    }).sort({ createdAt: -1 });

    if (existingPayment) {
      logger.info(`Reusing active Stripe intent ${existingPayment.stripe.paymentIntentId} for contract ${contract._id}`);
      return sendSuccess(res, {
        message: 'Existing payment intent found.',
        data: {
          clientSecret: existingPayment.stripe.clientSecret,
          paymentIntentId: existingPayment.stripe.paymentIntentId,
          amount: grandTotal,
          currency: 'INR',
          publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        },
      });
    }

    // Idempotency key: daily bucket so retries on same day reuse the intent,
    // but a new key is generated if the previous one failed on a different day.
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const idempotencyKey = `PI-${contract._id}-${buyerId}-${today}`;

    const intent = await stripe.paymentIntents.create({
      amount: grandTotalUnits, // Already in paise (smallest unit) — do NOT multiply by 100 again
      currency: 'inr',
      metadata: {
        contractId: contract._id.toString(),
        buyerId: buyerId.toString(),
        farmerId: contract.farmer._id.toString(),
      },
      capture_method: 'manual', // Hold funds (Escrow)
    }, { idempotencyKey });

    const receiptId = `KM-STP-${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`;

    // 4. Create Payment record
    const payment = await Payment.create({
      contract: contract._id,
      payer: buyerId,
      payee: contract.farmer._id,
      amount: grandTotal,
      baseAmount: totalAmount,
      platformFee,
      gstOnFee,
      type: 'stripe',
      status: 'initiated',
      receiptId,
      stripe: {
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        status: intent.status,
      },
      ipAddress: req.ip,
    });

    // 5. Update contract with Stripe intent details
    await Contract.findByIdAndUpdate(contract._id, {
      'payment.status': 'awaiting_payment',
      'payment.method': 'stripe',
      'payment.stripeIntentId': intent.id,
    });

    logger.info(`New Stripe intent created: ${intent.id} for contract ${contract._id}`);

    return sendSuccess(res, {
      message: 'Payment intent created successfully.',
      data: {
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        amount: grandTotal,
        currency: 'INR',
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (err) {
    logger.error('createStripePaymentIntent error:', err);
    return sendError(res, { message: 'Failed to initiate Stripe payment', statusCode: 500 });
  }
};

/**
 * ─── POST /api/v1/payments/verify ────────────────────────────────────────────
 * Frontend calls this after a successful Stripe payment sheet interaction.
 * We verify the intent status directly with the Stripe API.
 */
const verifyStripePayment = async (req, res) => {
  try {
    const { paymentIntentId, contractId } = req.body;
    if (!paymentIntentId || !contractId) {
      return sendError(res, { message: 'Required fields missing', statusCode: 400 });
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Status can be 'succeeded' (instant pay) or 'requires_capture' (manual escrow)
    const validStatuses = ['succeeded', 'requires_capture'];
    if (!validStatuses.includes(intent.status)) {
      return sendError(res, { message: `Payment failed with status: ${intent.status}`, statusCode: 400 });
    }

    // Atomic update via service layer
    const { contract, payment } = await transactionPaymentVerification(contractId, {
      intentId: intent.id,
      amount: intent.amount / 100,
      status: intent.status,
      email: intent.receipt_email,
    });

    return sendSuccess(res, {
      message: 'Payment verified and funds held in escrow.',
      data: { contract, payment },
    });
  } catch (err) {
    logger.error('verifyStripePayment error:', err);
    return sendError(res, { message: 'Failed to verify payment', statusCode: 500 });
  }
};

/**
 * ─── POST /api/v1/payments/webhook ────────────────────────────────────────────
 * Async source of truth from Stripe.
 */
const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    logger.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const intent = event.data.object;
  const contractId = intent.metadata?.contractId;

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.requires_capture':
        if (contractId) {
          logger.info(`Stripe Webhook: Payment verified for contract ${contractId}`);
          await transactionPaymentVerification(contractId, {
            intentId: intent.id,
            amount: intent.amount / 100,
            status: intent.status,
          });
        }
        break;

      case 'payment_intent.payment_failed':
        if (contractId) {
          logger.warn(`Stripe Webhook: Payment failed for contract ${contractId}`);
          await Payment.findOneAndUpdate(
            { 'stripe.paymentIntentId': intent.id },
            { status: 'failed', failureReason: intent.last_payment_error?.message }
          );
          await Contract.findByIdAndUpdate(contractId, { 'payment.status': 'failed' });
        }
        break;

      default:
        logger.debug(`Unhandled Stripe event type ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('Webhook processing error:', err.message);
    return res.status(500).send('Internal Server Error');
  }
};

/**
 * ─── POST /api/v1/payments/cod-confirm ───────────────────────────────────────
 * Buyer confirms they have paid cash/UPI on delivery.
 */
const confirmCodPayment = async (req, res) => {
  try {
    const { contractId, method = 'cash', notes } = req.body;
    const buyerId = req.user._id || req.user.id;

    // 1. Transactional COD Confirmation
    const result = await transactionCodPayment(contractId, { notes });

    if (result.alreadyProcessed) {
      return sendSuccess(res, { message: 'COD already confirmed for this contract.' });
    }

    const { contract } = result;

    if (contract.buyer.toString() !== buyerId.toString()) {
      return sendForbidden(res, 'Only the buyer can confirm payment');
    }

    // 2. Notifications & Sockets
    NotificationService.create({
      recipientId: contract.farmer,
      type: 'payment_received',
      title: '✅ COD Payment Received!',
      body: `₹${(contract.terms?.totalAmount || 0).toLocaleString('en-IN')} received via ${method} on delivery.`,
      refModel: 'Contract',
      refId: contract._id,
      priority: 'high',
    }).catch(logger.error);

    socketService.emitToUser(contract.farmer, 'payment_released', {
      contractId: contract._id,
      type: 'on_delivery',
      method,
    });

    logger.info(`COD payment confirmed atomically for contract ${contract._id}`);
    return sendSuccess(res, { message: 'Payment confirmed. Contract completed!' });
  } catch (err) {
    logger.error('confirmCodPayment error:', err);
    return sendError(res, { message: err.message || 'Failed to confirm COD payment', statusCode: err.message.includes('not found') ? 404 : 500 });
  }
};

/**
 * ─── POST /api/v1/contracts/:id/payment/release ──────────────────────────────
 * Buyer releases funds to farmer after quality check upon delivery.
 * Triggers Stripe capture and marks contract completed.
 */
const releasePayment = async (req, res) => {
  try {
    const { id: contractId } = req.params;
    const userId = req.user._id || req.user.id;

    const contract = await Contract.findById(contractId);
    if (!contract) return sendNotFound(res, 'Contract not found');

    if (contract.buyer.toString() !== userId.toString()) {
      return sendForbidden(res, 'Only the buyer can release escrowed funds');
    }

    const payment = await Payment.findOne({ contract: contractId, status: 'in_escrow' });
    if (!payment || !payment.stripe?.paymentIntentId) {
      return sendError(res, { message: 'No escrowed payment found to release', statusCode: 400 });
    }

    // 1. Mark as "processing_release" to handle potential crashes during Stripe call
    const idempotencyKey = `release-${contractId}-${payment._id}`;
    await Payment.findByIdAndUpdate(payment._id, { status: 'processing_release' });

    // 2. Capture Stripe Intent (actually release funds)
    const intent = await capturePaymentIntent(payment.stripe.paymentIntentId, idempotencyKey);
    if (intent.status !== 'succeeded') {
      // Revert if Stripe fails (or mark as failed)
      await Payment.findByIdAndUpdate(payment._id, { status: 'in_escrow' });
      throw new Error(`Stripe capture failed: ${intent.status}`);
    }

    // 3. Update DB inside atomic transaction
    const { contract: updatedContract } = await transactionPaymentRelease(contractId);

    // 3. Notify Farmer
    NotificationService.create({
      recipientId: contract.farmer,
      type: 'payment',
      title: '💸 Funds Released!',
      body: `Buyer has released funds for ${contract.terms.cropName}. Your payout is successful.`,
      refModel: 'Contract',
      refId: contract._id,
      priority: 'high',
    }).catch(() => { });

    socketService.emitToUser(contract.farmer.toString(), 'contract:update', {
      contractId: contract._id,
      status: 'completed',
      paymentStatus: 'released'
    });

    return sendSuccess(res, {
      message: 'Escrow funds released to farmer.',
      data: { contract: updatedContract },
    });
  } catch (err) {
    logger.error('releasePayment error:', err);
    return sendError(res, { message: err.message || 'Failed to release payment', statusCode: 500 });
  }
};

/**
 * ─── POST /api/v1/payments/refund ────────────────────────────────────────────
 * Admin or authorized party initiates a refund.
 */
const initiateRefund = async (req, res) => {
  try {
    const { contractId, reason } = req.body;
    const userId = req.user._id || req.user.id;

    const contract = await Contract.findById(contractId);
    if (!contract) return sendNotFound(res, 'Contract not found');

    const isBuyer = contract.buyer.toString() === userId.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isBuyer && !isAdmin) return sendForbidden(res, 'Not authorized');

    const payment = await Payment.findOne({ contract: contractId, status: { $in: ['captured', 'in_escrow'] } });
    if (!payment?.stripe?.paymentIntentId) {
      return sendError(res, { message: 'No refundable Stripe payment found for this contract', statusCode: 404 });
    }

    const refund = await createRefund(payment.stripe.paymentIntentId);

    await Payment.findByIdAndUpdate(payment._id, {
      'refund.refundId': refund.id,
      'refund.status': 'full',
      'refund.refundedAt': new Date(),
      status: 'refunded',
    });

    await Contract.findByIdAndUpdate(contractId, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancellationReason: reason,
      'payment.status': 'refunded'
    });

    logger.info(`Refund successful: ${refund.id} for contract ${contractId}`);
    return sendSuccess(res, {
      message: 'Refund successful.',
      data: { refundId: refund.id, amount: refund.amount / 100 },
    });
  } catch (err) {
    logger.error('initiateRefund error:', err);
    return sendError(res, { message: 'Failed to initiate refund', statusCode: 500 });
  }
};

/**
 * ─── GET /api/v1/payments/history ─────────────────────────────────────────────
 */
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const role = req.user.role;

    const query = role === 'farmer' ? { payee: userId } : { payer: userId };

    const payments = await Payment.find(query)
      .populate('contract', 'status terms delivery.status payment.status')
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, {
      message: 'Payment history fetched successfully',
      data: payments,
    });
  } catch (err) {
    logger.error('getPaymentHistory error:', err);
    return sendError(res, { message: 'Failed to fetch payment history', statusCode: 500 });
  }
};

module.exports = {
  createStripePaymentIntent,
  verifyStripePayment,
  handleWebhook,
  confirmCodPayment,
  releasePayment,
  initiateRefund,
  getPaymentHistory,
};