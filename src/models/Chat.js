const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: [2000, 'Message too long'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'document', 'offer_link', 'contract_link', 'location'],
      default: 'text',
    },
    attachments: [{
      url: String,
      name: String,
      type: String,
      size: Number,
    }],
    readBy: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      readAt: { type: Date, default: Date.now },
    }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true }
);

const chatSchema = new mongoose.Schema(
  {
    participants: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    }],
    type: {
      type: String,
      enum: ['direct', 'group'],
      default: 'direct',
    },
    name: String, // For group chats
    // Related entities
    relatedCrop: { type: mongoose.Schema.Types.ObjectId, ref: 'Crop' },
    relatedOffer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer' },
    relatedContract: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract' },
    // Last message
    lastMessage: {
      content: String,
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      timestamp: Date,
      type: String,
    },
    // Unread counts per participant
    unreadCounts: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      count: { type: Number, default: 0 },
    }],
    isActive: { type: Boolean, default: true },
    // Pinned messages
    pinnedMessages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
  },
  { timestamps: true }
);

chatSchema.index({ participants: 1 });
chatSchema.index({ updatedAt: -1 });
messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });

const Message = mongoose.model('Message', messageSchema);
const Chat = mongoose.model('Chat', chatSchema);

module.exports = { Chat, Message };
