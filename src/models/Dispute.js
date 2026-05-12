const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema({
  contract: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contract',
    required: true
  },
  raisedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: {
    type: String,
    required: true,
    enum: ['quality_issue', 'quantity_mismatch', 'delivery_delay', 'payment_issue', 'other']
  },
  description: {
    type: String,
    required: true
  },
  evidence: [{
    url: String,
    publicId: String
  }],
  status: {
    type: String,
    enum: ['open', 'in_review', 'resolved', 'closed'],
    default: 'open'
  },
  resolution: {
    type: String
  },
  resolvedAt: {
    type: Date
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('Dispute', disputeSchema);
