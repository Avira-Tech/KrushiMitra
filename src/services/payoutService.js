'use strict';
/**
 * payoutService.js
 *
 * Handles all seller/farmer payout operations:
 * - Records payout transactions
 * - Calculates payable amounts (deduct platform fees)
 * - Tracks payout status (pending, processing, completed, failed)
 * - Integrates with payment gateway settlement APIs
 */

const Payout = require('../models/Payout');
const Payment = require('../models/Payment');
const Contract = require('../models/Contract');
const User = require('../models/User');
const logger = require('../utils/logger');
const NotificationService = require('./notificationService');

/**
 * Create a payout record for a farmer after payment is released from escrow.
 * Called from paymentController.releasePayment()
 */
const createPayout = async ({ contractId, paymentId, amount, method = 'bank_transfer' }) => {
  try {
    const contract = await Contract.findById(contractId).populate('farmer');
    const payment = await Payment.findById(paymentId);

    if (!contract || !payment) {
      throw new Error('Contract or Payment not found');
    }

    const farmer = contract.farmer;
    if (!farmer) throw new Error('Farmer not found');

    // Calculate payout amount (deduct platform fee already calculated at contract creation)
    const netAmount = contract.terms?.netAmount || contract.terms?.totalAmount;
    if (!netAmount || netAmount <= 0) {
      throw new Error('Invalid net amount for payout');
    }

    // Check if payout already exists for this contract
    const existingPayout = await Payout.findOne({
      contract: contractId,
      status: { $in: ['pending', 'processing', 'completed'] },
    });

    if (existingPayout) {
      logger.warn(`Payout already exists for contract ${contractId}: ${existingPayout._id}`);
      return existingPayout;
    }

    // Verify farmer has bank details (required for payout)
    if (!farmer.bankDetails || !farmer.bankDetails.accountNumber) {
      throw new Error('Farmer bank details not found. Cannot process payout.');
    }

    // Create payout record
    const payout = await Payout.create({
      contract: contractId,
      payment: paymentId,
      farmer: farmer._id,
      amount: netAmount,
      method,
      status: 'pending',
      bankDetails: {
        accountNumber: farmer.bankDetails.accountNumber,
        bankName: farmer.bankDetails.bankName,
        ifscCode: farmer.bankDetails.ifscCode,
        accountHolderName: farmer.bankDetails.accountHolderName,
      },
      ipAddress: undefined, // Will be set by controller if available
      metadata: {
        contractId: contract.contractId,
        cropName: contract.terms?.cropName,
        buyerName: contract.terms?.buyerName,
      },
    });

    logger.info(`✅ Payout created: ${payout._id} for farmer ${farmer._id}, amount: ₹${netAmount}`);

    // Notify farmer that payout is being processed
    NotificationService.create({
      recipientId: farmer._id,
      type: 'payment_released',
      title: '✅ Payment Released to Payout!',
      body: `₹${netAmount.toLocaleString('en-IN')} will be transferred to your registered bank account within 1-2 business days.`,
      refModel: 'Payout',
      refId: payout._id,
      priority: 'high',
    }).catch(logger.error);

    return payout;
  } catch (err) {
    logger.error('createPayout error:', err);
    throw err;
  }
};

/**
 * Transition payout status from 'pending' to 'processing'
 * Call this when initiating the actual bank transfer (e.g., via Razorpay/Stripe payout APIs)
 */
const processPayout = async (payoutId) => {
  try {
    const payout = await Payout.findById(payoutId).populate('farmer');
    if (!payout) throw new Error('Payout not found');

    if (payout.status !== 'pending') {
      throw new Error(`Cannot process payout with status: ${payout.status}`);
    }

    // TODO: Integrate with actual payment gateway payout API
    // Example (Razorpay):
    // const razorpayPayout = await razorpay.payouts.create({
    //   account_number: '1112220061',  // Connect account
    //   amount: Math.round(payout.amount * 100),
    //   currency: 'INR',
    //   mode: 'NEFT',
    //   purpose: 'payout',
    //   recipient: {
    //     id: payout.bankDetails.accountNumber,
    //     type: 'bank_account',
    //     ...payout.bankDetails,
    //   },
    //   reference_id: payout._id.toString(),
    // });

    payout.status = 'processing';
    payout.processedAt = new Date();
    // payout.externalPayoutId = razorpayPayout.id; // store for webhook tracking
    await payout.save();

    logger.info(`Payout transitioned to processing: ${payoutId}`);
    return payout;
  } catch (err) {
    logger.error('processPayout error:', err);
    throw err;
  }
};

/**
 * Mark payout as completed (called from webhook when bank confirms receipt)
 */
const completePayout = async (payoutId, metadata = {}) => {
  try {
    const payout = await Payout.findByIdAndUpdate(
      payoutId,
      {
        status: 'completed',
        completedAt: new Date(),
        ...metadata,
      },
      { new: true }
    ).populate('farmer');

    if (!payout) throw new Error('Payout not found');

    logger.info(`✅ Payout completed: ${payoutId}`);

    // Notify farmer
    NotificationService.create({
      recipientId: payout.farmer._id,
      type: 'payout_completed',
      title: '💰 Payout Completed!',
      body: `₹${payout.amount.toLocaleString('en-IN')} has been credited to your bank account.`,
      refModel: 'Payout',
      refId: payout._id,
      priority: 'high',
    }).catch(logger.error);

    return payout;
  } catch (err) {
    logger.error('completePayout error:', err);
    throw err;
  }
};

/**
 * Mark payout as failed (called from webhook on error or manual mark)
 */
const failPayout = async (payoutId, failureReason) => {
  try {
    const payout = await Payout.findByIdAndUpdate(
      payoutId,
      {
        status: 'failed',
        failedAt: new Date(),
        failureReason: failureReason || 'Unknown error',
      },
      { new: true }
    ).populate('farmer');

    if (!payout) throw new Error('Payout not found');

    logger.error(`❌ Payout failed: ${payoutId} — ${failureReason}`);

    // Notify farmer and admin
    NotificationService.create({
      recipientId: payout.farmer._id,
      type: 'payout_failed',
      title: '⚠️ Payout Failed',
      body: `Payout of ₹${payout.amount} failed: ${failureReason}. Our team will investigate.`,
      refModel: 'Payout',
      refId: payout._id,
      priority: 'urgent',
    }).catch(logger.error);

    return payout;
  } catch (err) {
    logger.error('failPayout error:', err);
    throw err;
  }
};

/**
 * Get payout history for a farmer
 */
const getFarmerPayouts = async (farmerId, { skip = 0, limit = 20, status } = {}) => {
  try {
    const filter = { farmer: farmerId };
    if (status) filter.status = status;

    const [payouts, total] = await Promise.all([
      Payout.find(filter)
        .populate('contract', 'contractId terms')
        .sort({ createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit)),
      Payout.countDocuments(filter),
    ]);

    return {
      data: payouts,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  } catch (err) {
    logger.error('getFarmerPayouts error:', err);
    throw err;
  }
};

/**
 * Get payout statistics for a farmer
 */
const getPayoutStats = async (farmerId) => {
  try {
    const stats = await Payout.aggregate([
      { $match: { farmer: farmerId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]);

    const result = {
      pending: { count: 0, totalAmount: 0 },
      processing: { count: 0, totalAmount: 0 },
      completed: { count: 0, totalAmount: 0 },
      failed: { count: 0, totalAmount: 0 },
    };

    stats.forEach((s) => {
      if (result[s._id]) {
        result[s._id] = { count: s.count, totalAmount: s.totalAmount };
      }
    });

    result.grandTotal = Object.values(result).reduce((sum, v) => sum + v.totalAmount, 0);

    return result;
  } catch (err) {
    logger.error('getPayoutStats error:', err);
    throw err;
  }
};

module.exports = {
  createPayout,
  processPayout,
  completePayout,
  failPayout,
  getFarmerPayouts,
  getPayoutStats,
};
