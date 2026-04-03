const Payment = require('../models/Payment');
const Contract = require('../models/Contract');
const stripe = require('../config/stripe');
const { transactionPaymentProcessing } = require('../services/transactionService');
const logger = require('../utils/logger');

/**
 * Initiate payment
 * POST /api/v1/payments/initiate
 */
const initiatePayment = async (req, res) => {
  try {
    const { contractId, amount, type = 'stripe' } = req.body;
    const buyerId = req.user.id;

    if (!contractId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid contractId and amount required',
      });
    }

    // Find contract
    const contract = await Contract.findById(contractId)
      .populate(['farmer', 'buyer', 'crop']);

    if (!contract) {
      return res.status(404).json({
        success: false,
        error: 'Contract not found',
      });
    }

    // Verify buyer
    if (contract.buyer._id.toString() !== buyerId) {
      return res.status(403).json({
        success: false,
        error: 'Only the buyer can initiate payment for this contract',
      });
    }

    // Check contract status
    if (contract.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Contract is ${contract.status}. Cannot process payment.`,
      });
    }

    // Check payment hasn't been initiated
    if (contract.payment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Payment already initiated or completed for this contract',
      });
    }

    // ✅ Stripe payment
    if (type === 'stripe') {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to paise
        currency: 'inr',
        description: `Payment for contract ${contract.contractId}`,
        metadata: {
          contractId: contract._id.toString(),
          farmerId: contract.farmer._id.toString(),
          buyerId: contract.buyer._id.toString(),
        },
      });

      // Create payment record
      const payment = new Payment({
        contract: contractId,
        payer: buyerId,
        payee: contract.farmer._id,
        amount,
        type: 'stripe',
        status: 'initiated',
        stripe: {
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
        },
        metadata: {
          contractId: contract.contractId,
        },
      });

      await payment.save();

      logger.info(`✅ Payment initiated for contract ${contractId}:`, payment._id);

      return res.status(200).json({
        success: true,
        message: 'Payment initiated',
        data: {
          paymentId: payment._id,
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          amount,
        },
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Invalid payment type',
    });
  } catch (error) {
    logger.error('❌ Error initiating payment:', error);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Failed to initiate payment',
    });
  }
};

/**
 * Confirm payment
 * POST /api/v1/payments/confirm
 */
const confirmPayment = async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const buyerId = req.user.id;

    if (!paymentIntentId) {
      return res.status(400).json({
        success: false,
        error: 'paymentIntentId is required',
      });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (!paymentIntent) {
      return res.status(404).json({
        success: false,
        error: 'Payment intent not found',
      });
    }

    // Get payment from DB
    const payment = await Payment.findOne({
      'stripe.paymentIntentId': paymentIntentId,
    }).populate('contract');

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment record not found',
      });
    }

    // Verify buyer
    if (payment.payer.toString() !== buyerId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to confirm this payment',
      });
    }

    // ✅ Check payment status
    if (paymentIntent.status === 'succeeded') {
      // Update payment record
      payment.status = 'captured';
      payment.stripe.chargeId = paymentIntent.charges.data[0]?.id;
      payment.stripe.receiptUrl = paymentIntent.charges.data[0]?.receipt_url;
      await payment.save();

      // Update contract payment status
      const contract = await Contract.findByIdAndUpdate(
        payment.contract._id,
        {
          'payment.status': 'completed',
          'payment.transactionId': payment._id,
          'payment.completedAt': new Date(),
          status: 'confirmed', // Contract now confirmed
        },
        { new: true }
      );

      logger.info(`✅ Payment confirmed for contract ${contract.contractId}:`, payment._id);

      // Notify farmer
      const NotificationService = require('../services/notificationService');
      await NotificationService.notify(contract.farmer, {
        type: 'payment_received',
        title: 'Payment Received',
        message: `Payment of ₹${payment.amount} received for contract ${contract.contractId}`,
        relatedId: contract._id,
      }).catch(logger.error);

      return res.status(200).json({
        success: true,
        message: 'Payment confirmed successfully',
        data: {
          paymentId: payment._id,
          contractId: contract._id,
          amount: payment.amount,
        },
      });
    } else if (paymentIntent.status === 'requires_payment_method') {
      return res.status(400).json({
        success: false,
        error: 'Payment failed. Please try again.',
      });
    } else {
      return res.status(400).json({
        success: false,
        error: `Payment status: ${paymentIntent.status}`,
      });
    }
  } catch (error) {
    logger.error('❌ Error confirming payment:', error);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? error.message : 'Failed to confirm payment',
    });
  }
};

module.exports = { initiatePayment, confirmPayment };