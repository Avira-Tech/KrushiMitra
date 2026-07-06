const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: {
      type: String,
      enum: ['seeds', 'fertilizer', 'pesticide', 'labor', 'equipment', 'irrigation', 'transport', 'other'],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
    cropId: { type: mongoose.Schema.Types.ObjectId, ref: 'Crop', default: null },
    cropName: { type: String, default: '' },
    receiptUrl: { type: String, default: '' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Expense', expenseSchema);
