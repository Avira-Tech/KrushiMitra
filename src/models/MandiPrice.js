const mongoose = require('mongoose');

const mandiPriceSchema = new mongoose.Schema(
  {
    commodity: {
      type: String,
      required: true,
      trim: true,
    },
    variety: String,
    market: {
      type: String,
      required: true,
      trim: true,
    },
    state: String,
    district: String,
    minPrice: { type: Number, required: true },
    maxPrice: { type: Number, required: true },
    modalPrice: { type: Number, required: true },
    unit: { type: String, default: 'Quintal' },
    priceDate: { type: Date, required: true },
    source: { type: String, default: 'AGMARKNET' },
    // Change tracking
    previousModalPrice: Number,
    priceChange: Number,
    priceChangePercent: Number,
    trend: { type: String, enum: ['up', 'down', 'stable'] },
  },
  { timestamps: true }
);

mandiPriceSchema.index({ commodity: 1, priceDate: -1 });
mandiPriceSchema.index({ market: 1, priceDate: -1 });
mandiPriceSchema.index({ state: 1, commodity: 1 });
mandiPriceSchema.index({ priceDate: -1 });

module.exports = mongoose.model('MandiPrice', mandiPriceSchema);
