// const mongoose = require('mongoose');

// const offerSchema = new mongoose.Schema(
//   {
//     crop: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Crop',
//       required: true,
//     },
//     farmer: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'User',
//       required: true,
//     },
//     buyer: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'User',
//       required: true,
//     },
//     // Offer details
//     quantity: {
//       type: Number,
//       required: [true, 'Quantity is required'],
//       min: [1, 'Quantity must be at least 1'],
//     },
//     offeredPrice: {
//       type: Number,
//       required: [true, 'Offered price is required'],
//       min: [0.01, 'Price must be positive'],
//     },
//     totalAmount: {
//       type: Number,
//       required: true,
//     },
//     platformFee: {
//       type: Number,
//       default: 0,
//     },
//     message: {
//       type: String,
//       maxlength: [500, 'Message too long'],
//     },
//     // Status flow: pending → accepted/rejected/countered → contracted
//     status: {
//       type: String,
//       enum: ['pending', 'accepted', 'rejected', 'countered', 'contracted', 'expired', 'cancelled'],
//       default: 'pending',
//     },
//     // Counter offer
//     counterOffer: {
//       price: Number,
//       message: String,
//       by: { type: String, enum: ['farmer', 'buyer'] },
//       createdAt: Date,
//     },
//     // Negotiation history
//     negotiationHistory: [{
//       by: { type: String, enum: ['farmer', 'buyer'] },
//       action: { type: String, enum: ['offer', 'counter', 'accept', 'reject'] },
//       price: Number,
//       message: String,
//       timestamp: { type: Date, default: Date.now },
//     }],
//     // Expiry
//     expiresAt: {
//       type: Date,
//       default: () => new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
//     },
//     // Linked contract
//     contract: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Contract',
//     },
//     // Rejection reason
//     rejectionReason: String,
//     rejectedBy: { type: String, enum: ['farmer', 'buyer'] },
//   },
//   {
//     timestamps: true,
//     toJSON: { virtuals: true },
//     toObject: { virtuals: true },
//   }
// );

// offerSchema.index({ crop: 1, status: 1 });
// offerSchema.index({ farmer: 1, status: 1 });
// offerSchema.index({ buyer: 1, status: 1 });
// offerSchema.index({ expiresAt: 1 });
// offerSchema.index({ createdAt: -1 });

// // Pre-save: calculate total and platform fee
// offerSchema.pre('save', function (next) {
//   if (this.isModified('quantity') || this.isModified('offeredPrice')) {
//     this.totalAmount = parseFloat((this.quantity * this.offeredPrice).toFixed(2));
//     this.platformFee = parseFloat((this.totalAmount * 0.02).toFixed(2)); // 2% fee
//   }
//   next();
// });

// // Virtual: is expired
// offerSchema.virtual('isExpired').get(function () {
//   return this.status === 'pending' && new Date() > this.expiresAt;
// });

// module.exports = mongoose.model('Offer', offerSchema);

'use strict';
const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    crop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Crop',
      required: [true, 'Crop reference is required'],
    },
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Farmer reference is required'],
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Buyer reference is required'],
    },

    // ─── Pricing — standardized to pricePerKg everywhere ─────────────────────
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1 kg'],
    },
    pricePerKg: {
      type: Number,
      required: [true, 'Price per kg is required'],
      min: [0.01, 'Price must be positive'],
    },
    totalAmount: {
      type: Number,
      required: true,
      min: [0, 'Total amount must be non-negative'],
    },
    platformFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    message: {
      type: String,
      maxlength: [500, 'Message cannot exceed 500 characters'],
      trim: true,
    },

    // ─── Delivery details ────────────────────────────────────────────────────
    deliveryLocation: { type: String, trim: true },
    deliveryDate:     { type: Date },
    paymentTerms:     { type: String, trim: true, default: 'KrushiMitra Secure Escrow' },

    // ─── Status flow: pending → accepted | rejected | countered | contracted ──
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'countered', 'contracted', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },

    // ─── Counter offer ────────────────────────────────────────────────────────
    counterOffer: {
      price:     { type: Number, min: 0.01 },
      message:   { type: String, maxlength: 300 },
      by:        { type: String, enum: ['farmer', 'buyer'] },
      createdAt: { type: Date },
    },

    // ─── Negotiation history ─────────────────────────────────────────────────
    negotiationHistory: [
      {
        by:        { type: String, enum: ['farmer', 'buyer'] },
        action:    { type: String, enum: ['offer', 'counter', 'accept', 'reject'] },
        price:     { type: Number },
        message:   { type: String },
        timestamp: { type: Date, default: Date.now },
      },
    ],

    // ─── Expiry ───────────────────────────────────────────────────────────────
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
      index: true,
    },

    // ─── Linked contract (populated after acceptance) ─────────────────────────
    contract: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },

    // ─── Rejection ────────────────────────────────────────────────────────────
    rejectionReason: { type: String, maxlength: 300 },
    rejectedBy:      { type: String, enum: ['farmer', 'buyer'] },

    // ─── Timestamps from schema timestamps option ─────────────────────────────
    acceptedAt:  { type: Date },
    contractedAt:{ type: Date },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Compound indexes ─────────────────────────────────────────────────────────
offerSchema.index({ crop: 1, status: 1 });
offerSchema.index({ farmer: 1, status: 1 });
offerSchema.index({ buyer: 1, status: 1 });
offerSchema.index({ createdAt: -1 });

// ─── Pre-save: auto-calculate totalAmount and platformFee ────────────────────
offerSchema.pre('save', function (next) {
  if (this.isModified('quantity') || this.isModified('pricePerKg')) {
    this.totalAmount  = parseFloat((this.quantity * this.pricePerKg).toFixed(2));
    this.platformFee  = parseFloat((this.totalAmount * 0.02).toFixed(2)); // 2% fee
  }
  next();
});

// ─── Virtual: isExpired ───────────────────────────────────────────────────────
offerSchema.virtual('isExpired').get(function () {
  return this.status === 'pending' && new Date() > this.expiresAt;
});

module.exports = mongoose.model('Offer', offerSchema);