const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    type: {
      type: String,
      enum: [
        'new_offer', 'offer_accepted', 'offer_rejected', 'offer_countered',
        'contract_created', 'contract_signed', 'payment_received', 'payment_released',
        'delivery_scheduled', 'delivery_update', 'delivery_completed',
        'crop_listed', 'crop_sold', 'new_message',
        'account_verified', 'account_rejected', 'system', 'dispute_raised', 'dispute_resolved',
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: true,
      maxlength: 500,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // References
    refModel: {
      type: String,
      enum: ['Crop', 'Offer', 'Contract', 'Payment', 'Chat', 'User'],
    },
    refId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    // Status
    isRead: { type: Boolean, default: false },
    readAt: Date,
    // Push notification
    isPushSent: { type: Boolean, default: false },
    pushSentAt: Date,
    pushError: String,
    // Priority
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
    },
    // Expiry
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

module.exports = mongoose.model('Notification', notificationSchema);
