const mongoose = require('mongoose');
const { generateContractId } = require('../utils/helpers');

const contractSchema = new mongoose.Schema(
  {
    contractId: {
      type: String,
      unique: true,
    },
    offer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Offer',
      required: true,
    },
    crop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Crop',
      required: true,
    },
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Contract terms
    terms: {
      cropName: { type: String, required: true },
      quantity: { type: Number, required: true },
      pricePerKg: { type: Number, required: true },
      totalAmount: { type: Number, required: true },
      platformFee: { type: Number, default: 0 },
      netAmount: { type: Number }, // totalAmount - platformFee
      deliveryDate: { type: Date, required: true },
      deliveryAddress: String,
      paymentTerms: {
        type: String,
        default: '50% advance, 50% on delivery',
      },
      qualityGrade: String,
      specialConditions: String,
    },
    // Status
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled', 'disputed'],
      default: 'active',
    },
    // Payment (Stripe Escrow)
    payment: {
      status: {
        type: String,
        enum: ['pending', 'authorized', 'in_escrow', 'released', 'refunded', 'failed'],
        default: 'pending',
      },
      stripePaymentIntentId: String,
      stripeChargeId: String,
      paidAt: Date,
      releasedAt: Date,
      refundedAt: Date,
      refundAmount: Number,
      receiptId: String,
      receiptUrl: String,
    },
    // Delivery
    delivery: {
      status: {
        type: String,
        enum: ['pending', 'scheduled', 'picked_up', 'in_transit', 'delivered', 'failed'],
        default: 'pending',
      },
      porterOrderId: String,
      trackingId: String,
      estimatedDelivery: Date,
      actualDelivery: Date,
      deliveryPartner: String,
      driverName: String,
      driverPhone: String,
      deliveryProof: [String], // Image URLs
    },
    // Dispute
    dispute: {
      isDisputed: { type: Boolean, default: false },
      reason: String,
      raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      raisedAt: Date,
      resolution: String,
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      resolvedAt: Date,
    },
    // Signatures (digital)
    signatures: {
      farmer: { signed: Boolean, signedAt: Date, ipAddress: String },
      buyer: { signed: Boolean, signedAt: Date, ipAddress: String },
    },
    // Completion
    completedAt: Date,
    cancelledAt: Date,
    cancellationReason: String,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // PDF
    contractPdfUrl: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

contractSchema.index({ farmer: 1, status: 1 });
contractSchema.index({ buyer: 1, status: 1 });
contractSchema.index({ contractId: 1 });
contractSchema.index({ 'payment.status': 1 });
contractSchema.index({ 'delivery.status': 1 });
contractSchema.index({ createdAt: -1 });

// Pre-save: generate contract ID
contractSchema.pre('save', function (next) {
  if (this.isNew && !this.contractId) {
    this.contractId = generateContractId();
  }
  if (this.isNew) {
    this.terms.platformFee = parseFloat((this.terms.totalAmount * 0.02).toFixed(2));
    this.terms.netAmount = parseFloat((this.terms.totalAmount - this.terms.platformFee).toFixed(2));
  }
  next();
});

module.exports = mongoose.model('Contract', contractSchema);
