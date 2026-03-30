const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contract',
      required: true,
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5'],
    },
    categories: {
      quality: { type: Number, min: 1, max: 5 },
      communication: { type: Number, min: 1, max: 5 },
      delivery: { type: Number, min: 1, max: 5 },
      pricing: { type: Number, min: 1, max: 5 },
    },
    comment: {
      type: String,
      maxlength: [1000, 'Comment too long'],
      trim: true,
    },
    images: [String],
    isVerified: { type: Boolean, default: false },
    isVisible: { type: Boolean, default: true },
    adminNote: String,
    helpfulCount: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

reviewSchema.index({ reviewee: 1, createdAt: -1 });
reviewSchema.index({ reviewer: 1 });
reviewSchema.index({ contract: 1 });
// Prevent duplicate reviews per contract
reviewSchema.index({ reviewer: 1, contract: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
