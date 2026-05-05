const mongoose = require('mongoose');

const govtSchemeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  benefit: String,
  eligibility: String,
  link: String,
  icon: {
    type: String,
    default: '🌾'
  },
  color: {
    type: String,
    default: '#2E7D32'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('GovtScheme', govtSchemeSchema);
