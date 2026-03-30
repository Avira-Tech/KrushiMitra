const mongoose = require('mongoose');
const { generateReceiptId } = require('../utils/helpers');

const paymentSchema = new mongoose.Schema(
  {
    receiptId: {
      type: String,
      unique: true,
    },
    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contract',
      required: true,
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
      min: [1, 'Amount must be positive'],
    },
    platformFee: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    type: {
      type: String,
      enum: ['escrow_deposit', 'escrow_release', 'refund', 'platform_fee'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'authorized', 'captured', 'released', 'refunded', 'failed', 'cancelled'],
      default: 'pending',
    },
    // Stripe
    stripe: {
      paymentIntentId: String,
      chargeId: String,
      clientSecret: String,
      paymentMethodId: String,
      transferId: String,
    },
    // GST Details
    gst: {
      gstNumber: String,
      cgst: Number,
      sgst: Number,
      igst: Number,
      totalGst: Number,
    },
    // Receipt details
    receipt: {
      farmerName: String,
      buyerName: String,
      cropName: String,
      quantity: Number,
      pricePerKg: Number,
      contractDate: Date,
      deliveryDate: Date,
    },
    // Metadata
    description: String,
    failureReason: String,
    processedAt: Date,
    releasedAt: Date,
    refundedAt: Date,
    refundReason: String,
    ipAddress: String,
    userAgent: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

paymentSchema.index({ contract: 1 });
paymentSchema.index({ payer: 1, status: 1 });
paymentSchema.index({ payee: 1, status: 1 });
paymentSchema.index({ receiptId: 1 });
paymentSchema.index({ 'stripe.paymentIntentId': 1 });
paymentSchema.index({ createdAt: -1 });

paymentSchema.pre('save', function (next) {
  if (this.isNew && !this.receiptId) {
    this.receiptId = generateReceiptId();
  }
  if (this.isNew) {
    this.platformFee = parseFloat((this.amount * 0.02).toFixed(2));
    this.netAmount = parseFloat((this.amount - this.platformFee).toFixed(2));
  }
  next();
});

module.exports = mongoose.model('Payment', paymentSchema);
