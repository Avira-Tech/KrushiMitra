const mongoose = require('mongoose');

const mandiPriceSchema = new mongoose.Schema(
  {
    crop: {
      type: String,
      required: true,
      index: true,
    },
    mandi: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
      enum: ['Gujarat', 'Maharashtra', 'Punjab', 'Haryana', 'Karnataka'],
      index: true,
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
      default: () => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        return date;
      },
      index: true,
    },
    unit: {
      type: String,
      default: 'per quintal',
    },
    supply: {
      type: String,
      enum: ['Good', 'Fair', 'Poor'],
    },
    tradingQuantity: Number,
    currency: {
      type: String,
      default: 'INR',
    },
  },
  {
    timestamps: true,
  }
);

// Composite indexes
mandiPriceSchema.index({ crop: 1, priceDate: -1 });
mandiPriceSchema.index({ mandi: 1, priceDate: -1 });
mandiPriceSchema.index({ state: 1, priceDate: -1 });

module.exports = mongoose.model('MandiPrice', mandiPriceSchema);
