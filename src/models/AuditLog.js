const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  module: {
    type: String, // e.g. 'Users', 'CMS', 'Settings', 'Payments'
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  ip: String,
  userAgent: String
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);
