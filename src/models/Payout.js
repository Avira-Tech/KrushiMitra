const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema(
  {
    // References
    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contract',
      required: true,
      index: true,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
    },
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Amount
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Status
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },

    // Payout method
    method: {
      type: String,
      enum: ['bank_transfer', 'upi', 'wallet', 'check', 'manual'],
      default: 'bank_transfer',
    },

    // Bank details (snapshot at payout time)
    bankDetails: {
      accountNumber: String,
      bankName: String,
      ifscCode: String,
      accountHolderName: String,
    },

    // External gateway tracking
    externalPayoutId: String, // Razorpay payout ID, Stripe payout ID, etc.
    externalMeta: mongoose.Schema.Types.Mixed, // Store full response from payment gateway

    // Timeline
    initiatedAt: Date,
    processedAt: Date,
    completedAt: Date,
    failedAt: Date,
    failureReason: String,

    // Security
    ipAddress: String,

    // Metadata
    metadata: mongoose.Schema.Types.Mixed,

    notes: String,
  },
  {
    timestamps: true,
  }
);

// Indexes
payoutSchema.index({ farmer: 1, status: 1 });
payoutSchema.index({ farmer: 1, createdAt: -1 });
payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ contract: 1 }, { unique: true }); // One payout per contract

// Pre-save hook
payoutSchema.pre('save', function (next) {
  if (this.isNew) {
    this.initiatedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Payout', payoutSchema);
