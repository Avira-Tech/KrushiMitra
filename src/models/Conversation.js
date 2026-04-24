const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastMessageAt: -1 });

// Ensure participants is treated as a unique set for 1-on-1 chats if needed, 
// but typically we handle this in the controller/socket with deterministic sorting.

// ✅ FIX: Prevent model overwrite
module.exports = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
