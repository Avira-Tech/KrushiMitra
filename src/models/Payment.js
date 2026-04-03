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
      enum: ['initiated', 'authorized', 'captured', 'failed', 'refunded'],
      default: 'initiated',
      index: true,
    },
    type: {
      type: String,
      enum: ['stripe', 'upi', 'bank_transfer'],
      default: 'stripe',
    },
    // Stripe payment details
    stripe: {
      paymentIntentId: String,
      clientSecret: String,
      chargeId: String,
      receiptUrl: String,
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
paymentSchema.index({ 'stripe.paymentIntentId': 1 }, { sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
