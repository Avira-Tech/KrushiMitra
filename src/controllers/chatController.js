const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const logger = require('../utils/logger');
const socketService = require('../utils/socketService');
const { RtcTokenBuilder, RtcRole } = require('agora-token');


/**
 * Start a conversation or find existing one
 * POST /api/v1/chats/start
 */
const startChat = async (req, res) => {
  try {
    const { otherUserId } = req.body;
    const userId = req.user.id;

    if (!otherUserId) {
      return res.status(400).json({ success: false, error: 'Other user ID is required' });
    }

    // Deterministic sorting of participants
    const participants = [userId.toString(), otherUserId.toString()].sort();

    let conversation = await Conversation.findOne({
      participants: { $size: 2, $all: participants },
    }).populate('participants', 'name avatar role');

    if (!conversation) {
      conversation = new Conversation({ participants });
      await conversation.save();
      await conversation.populate('participants', 'name avatar role');
    }

    return res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    logger.error('❌ Error starting chat:', error);
    return res.status(500).json({ success: false, error: 'Failed to start chat' });
  }
};

/**
 * Get all conversations for current user
 * GET /api/v1/chats/conversations
 */
const getConversations = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { skip = 0, limit = 20 } = req.query;

    const conversations = await Conversation.find({ participants: userId })
      .populate('participants', 'name avatar role')
      .populate({
        path: 'lastMessage',
        select: 'content sender createdAt',
      })
      .sort({ lastMessageAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Conversation.countDocuments({ participants: userId });

    logger.info(`[Chat] getConversations for ${userId}: found ${conversations.length} / ${total}`);

    return res.status(200).json({
      success: true,
      data: conversations,
      pagination: { total, skip: parseInt(skip), limit: parseInt(limit) },
    });
  } catch (error) {
    logger.error('❌ Error fetching conversations:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
  }
};

/**
 * Get messages for a specific conversation
 * GET /api/v1/chats/conversations/:id/messages
 */
const getMessages = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { skip = 0, limit = 50 } = req.query;
    const userId = req.user.id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const messages = await Message.find({ 
      conversationId,
      deletedBy: { $ne: userId }
    })
      .populate('sender', 'name avatar')
      .populate({
        path: 'offer',
        populate: { path: 'crop', select: 'name images pricePerKg' }
      })
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
    return res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
};

/**
 * Delete a message (Delete for Everyone or Soft delete)
 * DELETE /api/v1/chats/messages/:id
 */
const deleteMessage = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { mode = 'everyone' } = req.query; // 'everyone' or 'me'
    const userId = req.user.id;

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, error: 'Message not found' });

    if (message.sender.toString() !== userId && mode === 'everyone') {
      return res.status(403).json({ success: false, error: 'Can only delete your own messages for everyone' });
    }

    if (mode === 'everyone') {
      const fifteenMinutes = 15 * 60 * 1000;
      const timeDiff = Date.now() - new Date(message.createdAt).getTime();
      if (timeDiff > fifteenMinutes) {
        return res.status(400).json({ success: false, error: 'Messages can only be deleted for everyone within 15 minutes' });
      }

      message.content = '🚫 This message was deleted';
      message.messageType = 'text'; // Force to text to avoid opening offer cards for deleted offers
      message.isDeleted = true;
      await message.save();

      // Broadcast deletion via SocketService
      const socketService = require('../utils/socketService');
      socketService.emitToRoom(`conversation:${message.conversationId}`, 'message:delete', {
        messageId: message._id,
        conversationId: message.conversationId,
        content: message.content
      });
    } else {
      // Soft delete for current user only
      if (!message.deletedBy.includes(userId)) {
        message.deletedBy.push(userId);
        await message.save();
      }
    }

    return res.status(200).json({ success: true, message: 'Message deleted' });
  } catch (error) {
    logger.error('❌ Error deleting message:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete message' });
  }
};

/**
 * Edit a message (Within 5 minutes)
 * PUT /api/v1/chats/messages/:id
 */
const editMessage = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    if (!content) return res.status(400).json({ success: false, error: 'Content is required' });

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, error: 'Message not found' });

    if (message.sender.toString() !== userId) {
      return res.status(403).json({ success: false, error: 'Can only edit your own messages' });
    }

    // WhatsApp logic: restrict to 15 minutes
    const fifteenMinutes = 15 * 60 * 1000;
    const timeDiff = Date.now() - new Date(message.createdAt).getTime();

    if (timeDiff > fifteenMinutes) {
      return res.status(400).json({ success: false, error: 'Messages can only be edited within 15 minutes' });
    }

    message.content = content;
    message.edited = true;
    message.editedAt = Date.now();
    await message.save();

    socketService.emitToRoom(`conversation:${message.conversationId}`, 'message:edit', {
      messageId: message._id,
      conversationId: message.conversationId,
      content: message.content,
      editedAt: message.editedAt
    });

    return res.status(200).json({ success: true, data: message });
  } catch (error) {
    logger.error('❌ Error editing message:', error);
    return res.status(500).json({ success: false, error: 'Failed to edit message' });
  }
};

/**
 * Bulk get presence status
 * GET /api/v1/chats/presence?userIds=id1,id2...
 */
const getPresence = async (req, res) => {
  try {
    const { userIds } = req.query;
    if (!userIds) return res.status(400).json({ success: false, error: 'userIds required' });

    const ids = userIds.split(',');
    const { redis } = require('../config/redis');
    const PRESENCE_KEY = 'presence:active_users';

    const results = {};
    for (const id of ids) {
      const count = await redis.hget(PRESENCE_KEY, id);
      results[id] = parseInt(count) > 0 ? 'online' : 'offline';
    }

    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    logger.error('❌ Error getting presence:', error);
    return res.status(500).json({ success: false, error: 'Failed to get presence' });
  }
};

/**
 * Toggle a reaction on a message
 * POST /api/v1/chats/messages/:id/reaction
 */
const toggleReaction = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.id;

    if (!emoji) return res.status(400).json({ success: false, error: 'Emoji is required' });

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, error: 'Message not found' });

    const existingReactionIndex = message.reactions.findIndex(
      (r) => r.user.toString() === userId && r.emoji === emoji
    );

    if (existingReactionIndex > -1) {
      // Remove reaction if already exists
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Add reaction
      message.reactions.push({ user: userId, emoji });
    }

    await message.save();

    // Broadcast reaction change via socket
    const socketService = require('../utils/socketService'); // Fixed: Correct import
    const room = `conversation:${message.conversationId}`;
    socketService.emitToRoom(room, 'message:reaction', {
      messageId: message._id,
      reactions: message.reactions
    });

    return res.status(200).json({ success: true, data: message.reactions });
  } catch (error) {
    logger.error('❌ Error toggling reaction:', error);
    return res.status(500).json({ success: false, error: 'Failed to toggle reaction' });
  }
};

/**
 * Generate Agora Token for Voice/Video Call
 * POST /api/v1/chats/call/token
 */
const generateAgoraToken = async (req, res) => {
  try {
    const { channelName, uid = 0, role = 'publisher', expireTime = 3600 } = req.body;

    if (!channelName) {
      return res.status(400).json({ success: false, error: 'Channel name is required' });
    }

    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate || appId === 'your_agora_app_id') {
      return res.status(500).json({ 
        success: false, 
        error: 'Agora credentials not configured on server' 
      });
    }

    const rtcRole = role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const privilegeExpireTime = Math.floor(Date.now() / 1000) + expireTime;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      rtcRole,
      privilegeExpireTime,
      privilegeExpireTime
    );

    return res.status(200).json({
      success: true,
      data: {
        token,
        channelName,
        uid,
        appId
      }
    });
  } catch (error) {
    logger.error('❌ Error generating Agora token:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate token' });
  }
};

module.exports = {
  startChat,
  getConversations,
  getMessages,
  deleteMessage,
  editMessage,
  getPresence,
  toggleReaction,
  generateAgoraToken,
  getChats: getConversations,
};
