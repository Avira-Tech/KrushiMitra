const Stripe = require('stripe');
const logger = require('../utils/logger');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  typescript: false,
});

const createPaymentIntent = async ({ amount, currency = 'inr', metadata = {} }) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      metadata,
      payment_method_types: ['card'],
      capture_method: 'manual', // For escrow — authorize first
    });
    return paymentIntent;
  } catch (error) {
    logger.error('Stripe createPaymentIntent error:', error);
    throw error;
  }
};

const capturePaymentIntent = async (paymentIntentId) => {
  try {
    return await stripe.paymentIntents.capture(paymentIntentId);
  } catch (error) {
    logger.error('Stripe capture error:', error);
    throw error;
  }
};

const cancelPaymentIntent = async (paymentIntentId) => {
  try {
    return await stripe.paymentIntents.cancel(paymentIntentId);
  } catch (error) {
    logger.error('Stripe cancel error:', error);
    throw error;
  }
};

const createRefund = async (paymentIntentId, amount) => {
  try {
    return await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? Math.round(amount * 100) : undefined,
    });
  } catch (error) {
    logger.error('Stripe refund error:', error);
    throw error;
  }
};

const constructWebhookEvent = (payload, sig) => {
  return stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
};

module.exports = {
  stripe,
  createPaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  createRefund,
  constructWebhookEvent,
};
