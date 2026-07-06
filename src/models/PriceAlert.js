const mongoose = require('mongoose');

const priceAlertSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cropName: { type: String, required: true, trim: true },
    state: { type: String, default: '' },
    market: { type: String, default: '' },
    targetPrice: { type: Number, required: true },
    condition: { type: String, enum: ['above', 'below'], default: 'above' },
    isActive: { type: Boolean, default: true },
    lastTriggeredAt: { type: Date, default: null },
    triggeredCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PriceAlert', priceAlertSchema);
