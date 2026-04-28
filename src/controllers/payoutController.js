'use strict';

const mongoose = require('mongoose');
const Payout = require('../models/Payout');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { sendSuccess, sendError, sendNotFound, sendForbidden } = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * ─── GET /api/v1/payouts/summary ──────────────────────────────────────────────
 * Detailed earnings and withdrawal overview for farmers.
 */
const getPayoutSummary = async (req, res) => {
  try {
    const farmerId = req.user._id;

    // 1. Calculate Total Earnings (all released payments)
    const releasedPayments = await Payment.find({
      payee: farmerId,
      status: 'released'
    });

    const totalEarned = releasedPayments.reduce((sum, p) => sum + p.amount, 0);

    // Calculate overall Total Revenue from all contracts
    const Contract = require('../models/Contract');
    const allContracts = await Contract.find({ farmer: farmerId });
    const totalRevenue = allContracts.reduce((sum, c) => sum + (c.terms?.totalAmount || 0), 0);

    // 2. Identify which of these are already paid out
    const paidOutIds = await Payout.find({
      farmer: farmerId,
      status: { $in: ['processing', 'completed'] }
    }).distinct('payment');

    const withdrawnAmount = releasedPayments
      .filter(p => paidOutIds.map(id => id.toString()).includes(p._id.toString()))
      .reduce((sum, p) => sum + p.amount, 0);

    const availableBalance = totalEarned - withdrawnAmount;

    // 3. Last few payouts
    const recentPayouts = await Payout.find({ farmer: farmerId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('contract', 'terms.cropName');

    return sendSuccess(res, {
      data: {
        totalRevenue,
        totalEarned,
        withdrawnAmount,
        availableBalance,
        recentPayouts,
        hasBankDetails: !!(req.user.bankDetails?.accountNumber)
      }
    });
  } catch (err) {
    logger.error('getPayoutSummary error:', err);
    return sendError(res, { message: 'Failed to fetch payout summary', statusCode: 500 });
  }
};

/**
 * ─── POST /api/v1/payouts/request ─────────────────────────────────────────────
 * Farmer requests a withdrawal for a specific released payment or full balance.
 * Simplified version: Request per contract.
 */
const requestWithdrawal = async (req, res) => {
  try {
    const { paymentId, notes } = req.body;
    const farmerId = req.user._id;

    if (!paymentId) {
      return sendError(res, { message: 'paymentId is required', statusCode: 400 });
    }

    // 1. Verify payment status and ownership
    const payment = await Payment.findById(paymentId).populate('contract');
    if (!payment) return sendNotFound(res, 'Payment record not found');

    if (payment.payee.toString() !== farmerId.toString()) {
      return sendForbidden(res, 'Not authorized to withdraw this payment');
    }

    if (payment.status !== 'released') {
      return sendError(res, { message: 'Payment funds are not yet released for withdrawal', statusCode: 400 });
    }

    // 2. Check if already withdrawn
    const existingPayout = await Payout.findOne({ payment: paymentId });
    if (existingPayout) {
      return sendError(res, { message: 'Withdrawal already requested for this payment', statusCode: 400 });
    }

    // 3. Verify bank details exist
    if (!req.user.bankDetails?.accountNumber) {
      return sendError(res, { message: 'Please add bank details before requesting withdrawal', statusCode: 400 });
    }

    // 4. Create Payout record
    const payout = await Payout.create({
      contract: payment.contract._id,
      payment: payment._id,
      farmer: farmerId,
      amount: payment.amount,
      status: 'pending',
      method: 'bank_transfer',
      bankDetails: {
        accountNumber: req.user.bankDetails.accountNumber,
        bankName: req.user.bankDetails.bankName,
        ifscCode: req.user.bankDetails.ifscCode,
        accountHolderName: req.user.bankDetails.accountHolderName,
      },
      notes: notes || 'Withdrawal request',
      initiatedAt: new Date()
    });

    logger.info(`Withdrawal request ${payout._id} created for farmer ${farmerId}`);

    return sendSuccess(res, {
      message: 'Withdrawal request submitted for processing',
      data: payout
    });
  } catch (err) {
    logger.error('requestWithdrawal error:', err);
    return sendError(res, { message: 'Failed to request withdrawal', statusCode: 500 });
  }
};

module.exports = {
  getPayoutSummary,
  requestWithdrawal
};
