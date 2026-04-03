const { Chat, Message } = require('../models/Chat');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Get chat or create if doesn't exist
 * POST /api/v1/chats/start
 */
const startChat = async (req, res) => {
  try {
    const { otherUserId } = req.body;
    const userId = req.user.id;

    if (!otherUserId) {
      return res.status(400).json({
        success: false,
        error: 'Other user ID is required',
      });
    }

    // Find or create chat
    let chat = await Chat.findOne({
      participants: { $all: [userId, otherUserId] },
    }).populate('participants', 'name avatar email');

    if (!chat) {
      chat = new Chat({
        participants: [userId, otherUserId],
      });
      await chat.save();
      await chat.populate('participants', 'name avatar email');
    }

    return res.status(200).json({
      success: true,
      data: chat,
    });
  } catch (error) {
    logger.error('❌ Error starting chat:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to start chat',
    });
  }
};

/**
 * Get all chats
 * GET /api/v1/chats
 */
const getChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { skip = 0, limit = 20 } = req.query;

    const chats = await Chat.find({ participants: userId })
      .populate('participants', 'name avatar email')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Chat.countDocuments({ participants: userId });

    return res.status(200).json({
      success: true,
      data: chats,
      pagination: { total, skip: parseInt(skip), limit: parseInt(limit) },
    });
  } catch (error) {
    logger.error('❌ Error fetching chats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch chats',
    });
  }
};

/**
 * Get conversations
 * GET /api/v1/chat/conversations
 */
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { skip = 0, limit = 20 } = req.query;

    const conversations = await Conversation.find({ participants: userId })
      .populate('participants', 'name avatar')
      .populate('lastMessage')
      .sort({ lastMessageAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Conversation.countDocuments({ participants: userId });

    return res.status(200).json({
      success: true,
      data: conversations,
      pagination: { total, skip: parseInt(skip), limit: parseInt(limit) },
    });
  } catch (error) {
    logger.error('❌ Error fetching conversations:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch conversations',
    });
  }
};

/**
 * Get conversation messages
 * GET /api/v1/chat/conversations/:id/messages
 */
const getMessages = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { skip = 0, limit = 50 } = req.query;
    const userId = req.user.id;

    // Verify user is in conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    const messages = await Message.find({ conversationId })
      .populate('sender', 'name avatar')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Message.countDocuments({ conversationId });

    return res.status(200).json({
      success: true,
      data: messages.reverse(),
      pagination: { total, skip: parseInt(skip), limit: parseInt(limit) },
    });
  } catch (error) {
    logger.error('❌ Error fetching messages:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch messages',
    });
  }
};

/**
 * Delete message
 * DELETE /api/v1/chat/messages/:id
 */
const deleteMessage = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const userId = req.user.id;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found',
      });
    }

    if (message.sender.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Can only delete your own messages',
      });
    }

    if (!message.deletedBy.includes(userId)) {
      message.deletedBy.push(userId);
      await message.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Message deleted',
    });
  } catch (error) {
    logger.error('❌ Error deleting message:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete message',
    });
  }
};

module.exports = {
  startChat,
  getChats,
  getConversations,
  getMessages,
  deleteMessage,
};
