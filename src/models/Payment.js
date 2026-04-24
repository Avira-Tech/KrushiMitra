'use strict';
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contract',
      required: true,
      index: true,
    },
    payer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    payee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      enum: ['INR', 'USD'],
    },
    status: {
      type: String,
      enum: [
        'awaiting_payment',   // user hasn’t paid yet
        'initiated',          // Razorpay order created
        'paid',               // Razorpay success
        'captured',           // payment captured by webhook or manual verification
        'in_escrow',          // locked
        'released',           // sent to farmer
        'failed',
        'refunded',
        'refund_initiated'
      ],
      default: 'awaiting_payment',
      index: true,
    },
    type: {
      type: String,
      enum: ['stripe', 'upi', 'bank_transfer', 'razorpay', 'cod', 'escrow_deposit'],
      default: 'razorpay',
    },
    // Razorpay payment details
    razorpay: {
      orderId: { type: String, index: true },
      paymentId: { type: String, index: true },
      signature: String,
      method: String, // UPI / card / netbanking
      amount: Number,
      currency: String,
      status: String,
      paidAt: Date,
    },
    // UPI payment details
    upi: {
      transactionId: String,
      upiId: String,
    },
    // Bank transfer details
    bankTransfer: {
      transactionId: String,
      referenceNumber: String,
    },
    receiptId: {
      type: String,
      unique: true,
      sparse: true,
    },
    // Generic metadata
    metadata: {
      type: Map,
      of: String,
    },
    // Refund information
    refund: {
      status: {
        type: String,
        enum: ['none', 'partial', 'full'],
        default: 'none',
      },
      amount: Number,
      reason: String,
      refundId: String,
      refundedAt: Date,
    },
    notes: String,
    failureReason: String,
    ipAddress: String,
    processedAt: Date,
    releasedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes
paymentSchema.index({ contract: 1, status: 1 });
paymentSchema.index({ payer: 1, createdAt: -1 });
paymentSchema.index({ payee: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ 'razorpay.orderId': 1 }, { sparse: true });
paymentSchema.index({ 'razorpay.paymentId': 1 }, { sparse: true });

module.exports = mongoose.model('Payment', paymentSchema); 'refunded'
