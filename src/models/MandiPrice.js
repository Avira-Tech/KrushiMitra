const mongoose = require('mongoose');

const mandiPriceSchema = new mongoose.Schema(
  {
    commodity: {
      type: String,
      required: true,
      index: true,
    },
    // Keep 'crop' as an alias or duplicate for legacy queries
    crop: {
      type: String,
      required: true,
      index: true,
    },
    market: {
      type: String,
      required: true,
      index: true,
    },
    // Keep 'mandi' as an alias
    mandi: {
      type: String,
      required: true,
    },
    variety: {
      type: String,
    },
    state: {
      type: String,
      required: true,
      index: true,
    },
    district: {
      type: String,
    },
    minPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    maxPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    modalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    priceDate: {
      type: Date,
      required: true,
      index: true,
    },
    unit: {
      type: String,
      default: 'per quintal',
    },
    source: {
      type: String,
      default: 'AGMARKNET',
    },
    currency: {
      type: String,
      default: 'INR',
    },
  },
  {
    timestamps: true,
  }
);

// Composite indexes for performance
mandiPriceSchema.index({ commodity: 1, priceDate: -1 });
mandiPriceSchema.index({ market: 1, priceDate: -1 });
mandiPriceSchema.index({ state: 1, priceDate: -1 });
mandiPriceSchema.index({ commodity: 1, market: 1, priceDate: -1 });

module.exports = mongoose.model('MandiPrice', mandiPriceSchema);
