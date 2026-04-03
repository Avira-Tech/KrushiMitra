const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    lastMessage: mongoose.Schema.Types.ObjectId,
    lastMessageAt: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'file'],
      default: 'text',
    },
    mediaUrl: String,
    isRead: { type: Boolean, default: false },
    readAt: Date,
  },
  { timestamps: true }
);

// Add indexes
chatSchema.index({ participants: 1, lastMessageAt: -1 });
messageSchema.index({ chat: 1, createdAt: -1 });
messageSchema.index({ sender: 1, readAt: 1 });

module.exports = {
  Chat: mongoose.model('Chat', chatSchema),
  Message: mongoose.model('Message', messageSchema),
};
