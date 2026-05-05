const mongoose = require('mongoose');

const transportSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['porter', 'dunzo', 'local', 'other'],
    default: 'other'
  },
  contactNumber: String,
  email: String,
  apiEnabled: {
    type: Boolean,
    default: false
  },
  apiConfig: {
    apiKey: String,
    baseUrl: String,
    webhookSecret: String
  },
  baseRate: {
    type: Number,
    default: 0
  },
  ratePerKm: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Transport', transportSchema);
