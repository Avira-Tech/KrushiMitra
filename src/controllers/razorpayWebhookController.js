// 'use strict';
// /**
//  * razorpayWebhookController.js
//  * 
//  * Handles verified Razorpay webhook events for payment.authorized, payment.captured, etc.
//  * Webhook registered BEFORE express.json() in app.js.
//  */

// const razorpayConfig = require('../config/stripe'); // Razorpay config
// const Contract = require('../models/Contract');
// const Payment = require('../models/Payment');
// const NotificationService = require('../services/notificationService');
// const logger = require('../utils/logger');

// // ─── POST /api/v1/payments/webhook ───────────────────────────────────────────
// const handleWebhook = async (req, res) => {
//   const signature = req.headers['x-razorpay-signature'];

//   if (!signature) {
//     logger.warn('Razorpay webhook missing signature');
//     return res.status(400).json({ error: 'Missing x-razorpay-signature header' });
//   }

//   let event;
//   try {
//     // Verify signature on raw body
//     const isValid = razorpayConfig.verifyWebhookSignature(req.body, signature);
//     if (!isValid) {
//       logger.error('Razorpay webhook signature invalid');
//       return res.status(400).json({ error: 'Webhook signature invalid' });
//     }

//     event = JSON.parse(req.body);
//   } catch (err) {
//     logger.error('Webhook parsing error:', err.message);
//     return res.status(400).json({ error: 'Invalid webhook payload' });
//   }

//   logger.info(`📦 Razorpay webhook: ${event.event} [${event.payload.payment.entity.id}]`);

//   try {
//     switch (event.event) {
//       case 'payment.captured':
//         await handlePaymentCaptured(event.payload.payment.entity);
//         break;

//       case 'payment.failed':
//         await handlePaymentFailed(event.payload.payment.entity);
//         break;

//       case 'payment.authorized':
//         await handlePaymentAuthorized(event.payload.payment.entity);
//         break;

//       case 'refund.created':
//         await handleRefundCreated(event.payload.refund.entity);
//         break;

//       case 'refund.processed':
//         await handleRefundProcessed(event.payload.refund.entity);
//         break;

//       default:
//         logger.debug(`Unhandled webhook event: ${event.event}`);
//     }

//     return res.status(200).json({ received: true });
//   } catch (err) {
//     logger.error(`Webhook handler error (${event.event}):`, err);
//     // Still return 200 - don't let Razorpay retry processing errors
//     return res.status(200).json({ received: true, error: 'Handler error logged' });
//   }
// };

// // ─── Event Handlers ──────────────────────────────────────────────────────────

// const handlePaymentAuthorized = async (payment) => {
//   const orderId = payment.order_id;
//   if (!orderId) return;

//   const paymentRecord = await Payment.findOne({ 'razorpay.orderId': orderId });
//   if (!paymentRecord || paymentRecord.status !== 'initiated') return;

//   await Payment.findOneAndUpdate(
//     { 'razorpay.orderId': orderId },
//     { status: 'authorized', processedAt: new Date() }
//   );

//   const contractId = paymentRecord.contract;
//   await Contract.findByIdAndUpdate(contractId, {
//     'payment.status': 'authorized',
//     'payment.paidAt': new Date(),
//   });

//   logger.info(`✅ Payment authorized: ${payment.id}`);

//   // Notify parties
//   NotificationService.notifyEscrowCreated(paymentRecord).catch(logger.error);
// };

// const handlePaymentCaptured = async (payment) => {
//   const orderId = payment.order_id;
//   if (!orderId) return;

//   const paymentRecord = await Payment.findOne({ 'razorpay.orderId': orderId });
//   if (!paymentRecord || paymentRecord.status === 'captured') return; // idempotent

//   await Payment.findOneAndUpdate(
//     { _id: paymentRecord._id },
//     {
//       status: 'captured',
//       'razorpay.paymentId': payment.id,
//       processedAt: new Date(),
//     }
//   );

//   const contractId = paymentRecord.contract;
//   const contract = await Contract.findById(contractId);

//   await Contract.findByIdAndUpdate(contractId, {
//     'payment.status': 'completed',
//     'payment.transactionId': paymentRecord._id,
//     'payment.completedAt': new Date(),
//     status: 'confirmed',
//     completedAt: new Date(),
//   });

//   logger.info(`✅ Payment captured: ${payment.id} → Contract ${contract.contractId}`);

//   NotificationService.notifyPaymentReleased(contract, paymentRecord.amount).catch(logger.error);
// };

// const handlePaymentFailed = async (payment) => {
//   const orderId = payment.order_id;
//   if (!orderId) return;

//   await Payment.findOneAndUpdate(
//     { 'razorpay.orderId': orderId },
//     {
//       status: 'failed',
//       failureReason: payment.error_description || payment.acquirer_data?.error_message || 'Payment failed',
//     }
//   );

//   logger.warn(`❌ Payment failed: ${payment.id}`);
// };

// const handleRefundCreated = async (refund) => {
//   const paymentId = refund.payment_id;
//   const paymentRecord = await Payment.findOne({ 'razorpay.paymentId': paymentId });
//   if (!paymentRecord) return;

//   const refundAmount = refund.amount / 100;

//   await Payment.findByIdAndUpdate(paymentRecord._id, {
//     status: 'refunded',
//     'refund.status': refundAmount >= paymentRecord.amount ? 'full' : 'partial',
//     'refund.amount': refundAmount,
//     'refund.refundId': refund.id,
//     'refund.refundedAt': new Date(),
//   });

//   logger.info(`✅ Refund created: ${refund.id} (₹${refundAmount})`);
// };

// const handleRefundProcessed = async (refund) => {
//   logger.info(`✅ Refund processed: ${refund.id}`);
//   // Additional processing if needed
// };

// module.exports = { handleWebhook };

const razorpayConfig = require('../config/razorpay');
const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const logger = require('../utils/logger');

const handleWebhook = async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const isValid = razorpayConfig.verifyWebhookSignature(req.body, signature);

  if (!isValid) return res.status(400).json({ error: 'Invalid signature' });

  const event = req.body; // Ensure express.json({ verify: ... }) is used if raw body is needed
  const paymentData = event.payload.payment.entity;

  try {
    if (event.event === 'payment.captured') {
      const paymentRecord = await Payment.findOneAndUpdate(
        { 'razorpay.orderId': paymentData.order_id },
        { status: 'captured', 'razorpay.paymentId': paymentData.id }
      );

      await Contract.findByIdAndUpdate(paymentRecord.contract, {
        status: 'confirmed',
        'payment.status': 'in_escrow'
      });
      logger.info(`Webhook: Payment captured for Order ${paymentData.order_id}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('Webhook processing error:', err);
    return res.status(200).json({ error: 'Logged' });
  }
};

module.exports = { handleWebhook };