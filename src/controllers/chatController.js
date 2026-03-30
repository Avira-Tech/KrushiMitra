const { Chat, Message } = require('../models/Chat');
const { parsePagination } = require('../utils/helpers');
const { sendSuccess, sendCreated, sendNotFound, sendForbidden, sendPaginated } = require('../utils/apiResponse');

// ─── GET OR CREATE CHAT ─────────────────────────────────────────────────────────────────────
const getOrCreateChat = async (req, res) => {
  const { participantId, cropId, offerId } = req.body;
  const userId = req.user._id;

  let chat = await Chat.findOne({
    type: 'direct',
    participants: { $all: [userId, participantId], $size: 2 },
  }).populate('participants', 'name phone avatar role');

  if (!chat) {
    chat = await Chat.create({
      participants: [userId, participantId],
      type: 'direct',
      relatedCrop: cropId,
      relatedOffer: offerId,
      unreadCounts: [
        { user: userId, count: 0 },
        { user: participantId, count: 0 },
      ],
    });
    await chat.populate('participants', 'name phone avatar role');
  }

  return sendSuccess(res, { data: { chat } });
};

// ─── GET MY CHATS ────────────────────────────────────────────────────────────────────────────
const getMyChats = async (req, res) => {
  const chats = await Chat.find({ participants: req.user._id, isActive: true })
    .populate('participants', 'name phone avatar role isVerified')
    .populate('relatedCrop', 'name images')
    .sort({ updatedAt: -1 })
    .limit(50);

  const chatsWithUnread = chats.map((chat) => {
    const unread = chat.unreadCounts.find((u) => u.user.toString() === req.user._id.toString());
    return { ...chat.toObject(), myUnreadCount: unread?.count || 0 };
  });

  return sendSuccess(res, { data: { chats: chatsWithUnread } });
};

// ─── GET MESSAGES ──────────────────────────────────────────────────────────────────────────
const getMessages = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const chat = await Chat.findById(req.params.chatId);
  if (!chat) return sendNotFound(res, 'Chat not found');

  const isParticipant = chat.participants.some((p) => p.toString() === req.user._id.toString());
  if (!isParticipant) return sendForbidden(res, 'Not a participant');

  const [messages, total] = await Promise.all([
    Message.find({ chat: req.params.chatId, isDeleted: false })
      .populate('sender', 'name avatar role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Message.countDocuments({ chat: req.params.chatId, isDeleted: false }),
  ]);

  // Mark messages as read
  await Message.updateMany(
    { chat: req.params.chatId, sender: { $ne: req.user._id }, 'readBy.user': { $ne: req.user._id } },
    { $addToSet: { readBy: { user: req.user._id, readAt: new Date() } } }
  );

  // Reset unread count
  await Chat.updateOne(
    { _id: req.params.chatId, 'unreadCounts.user': req.user._id },
    { $set: { 'unreadCounts.$.count': 0 } }
  );

  return sendPaginated(res, { data: { messages: messages.reverse() }, page, limit, total });
};

// ─── SEND MESSAGE ───────────────────────────────────────────────────────────────────────────
const sendMessage = async (req, res) => {
  const { content, type = 'text' } = req.body;
  const chat = await Chat.findById(req.params.chatId);
  if (!chat) return sendNotFound(res, 'Chat not found');

  const isParticipant = chat.participants.some((p) => p.toString() === req.user._id.toString());
  if (!isParticipant) return sendForbidden(res, 'Not a participant');

  const message = await Message.create({
    chat: req.params.chatId,
    sender: req.user._id,
    content,
    type,
    readBy: [{ user: req.user._id }],
  });

  await message.populate('sender', 'name avatar role');

  // Update chat last message
  await Chat.findByIdAndUpdate(req.params.chatId, {
    lastMessage: { content, sender: req.user._id, timestamp: new Date(), type },
    updatedAt: new Date(),
    $inc: Object.fromEntries(
      chat.participants
        .filter((p) => p.toString() !== req.user._id.toString())
        .map((p) => [`unreadCounts.${chat.unreadCounts.findIndex((u) => u.user.toString() === p.toString())}.count`, 1])
    ),
  });

  // Emit via socket
  if (global.io) {
    global.io.to(`chat:${req.params.chatId}`).emit('new_message', {
      chatId: req.params.chatId,
      message: message.toObject(),
    });
    // Notify other participants
    chat.participants
      .filter((p) => p.toString() !== req.user._id.toString())
      .forEach((recipientId) => {
        global.io.to(`user:${recipientId}`).emit('message_notification', {
          chatId: req.params.chatId,
          senderName: req.user.name,
          preview: content.substring(0, 100),
        });
      });
  }

  return sendCreated(res, { data: { message } });
};

module.exports = { getOrCreateChat, getMyChats, getMessages, sendMessage };
