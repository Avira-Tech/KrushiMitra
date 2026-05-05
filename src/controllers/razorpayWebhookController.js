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