const logger = require('../utils/logger');
const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const { Message, Chat } = require('../models/Chat');

// Track connected users
const connectedUsers = new Map(); // userId -> socketId

const initializeSocket = (io) => {
  // Store io globally for use in controllers
  global.io = io;

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication required'));

      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.id).select('name role isActive');

      if (!user || !user.isActive) return next(new Error('User not found or inactive'));

      socket.user = user;
      socket.userId = user._id.toString();
      next();
    } catch (error) {
      logger.warn(`Socket auth failed: ${error.message}`);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    connectedUsers.set(userId, socket.id);

    logger.info(`🔌 Socket connected: ${userId} (${socket.user.name}) [${socket.user.role}]`);

    // Join personal room
    socket.join(`user:${userId}`);

    // Update online status
    User.findByIdAndUpdate(userId, { lastActiveAt: new Date() }).catch(() => {});

    // Broadcast online status to contacts
    socket.broadcast.emit('user_online', { userId, name: socket.user.name });

    // ─── CHAT EVENTS ──────────────────────────────────────────────────────────────────────

    // Join chat room
    socket.on('join_chat', async ({ chatId }) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return socket.emit('error', { message: 'Chat not found' });

        const isParticipant = chat.participants.some((p) => p.toString() === userId);
        if (!isParticipant) return socket.emit('error', { message: 'Not a participant' });

        socket.join(`chat:${chatId}`);
        logger.debug(`User ${userId} joined chat ${chatId}`);

        // Mark messages as read
        await Message.updateMany(
          { chat: chatId, sender: { $ne: userId }, 'readBy.user': { $ne: userId } },
          { $addToSet: { readBy: { user: userId, readAt: new Date() } } }
        );

        socket.emit('chat_joined', { chatId });
      } catch (error) {
        logger.error('join_chat error:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // Leave chat room
    socket.on('leave_chat', ({ chatId }) => {
      socket.leave(`chat:${chatId}`);
      logger.debug(`User ${userId} left chat ${chatId}`);
    });

    // Send message via socket (real-time)
    socket.on('send_message', async ({ chatId, content, type = 'text' }) => {
      try {
        if (!content?.trim()) return;

        const chat = await Chat.findById(chatId);
        if (!chat) return socket.emit('error', { message: 'Chat not found' });

        const isParticipant = chat.participants.some((p) => p.toString() === userId);
        if (!isParticipant) return socket.emit('error', { message: 'Not authorized' });

        const message = await Message.create({
          chat: chatId,
          sender: userId,
          content: content.trim(),
          type,
          readBy: [{ user: userId }],
        });

        await message.populate('sender', 'name avatar role');

        // Update chat last message
        await Chat.findByIdAndUpdate(chatId, {
          lastMessage: { content: content.trim(), sender: userId, timestamp: new Date(), type },
          updatedAt: new Date(),
        });

        // Broadcast to chat room
        io.to(`chat:${chatId}`).emit('new_message', {
          chatId,
          message: message.toObject(),
        });

        // Send notification to offline participants
        chat.participants
          .filter((p) => p.toString() !== userId)
          .forEach((recipientId) => {
            const recipientSocketId = connectedUsers.get(recipientId.toString());
            if (!recipientSocketId) {
              // User is offline - push notification handled by NotificationService
              logger.debug(`User ${recipientId} is offline, push notification queued`);
            } else {
              io.to(`user:${recipientId}`).emit('message_notification', {
                chatId,
                senderName: socket.user.name,
                preview: content.substring(0, 100),
              });
            }
          });

        logger.debug(`Message sent in chat ${chatId} by ${userId}`);
      } catch (error) {
        logger.error('send_message socket error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('user_typing', {
        chatId,
        userId,
        name: socket.user.name,
      });
    });

    socket.on('stop_typing', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('user_stop_typing', { chatId, userId });
    });

    // Message read receipt
    socket.on('message_read', async ({ chatId, messageId }) => {
      try {
        await Message.findByIdAndUpdate(messageId, {
          $addToSet: { readBy: { user: userId, readAt: new Date() } },
        });
        socket.to(`chat:${chatId}`).emit('message_read_receipt', { chatId, messageId, readBy: userId });
      } catch (error) {
        logger.error('message_read error:', error);
      }
    });

    // ─── OFFER EVENTS ─────────────────────────────────────────────────────────────────────

    socket.on('subscribe_offer', ({ offerId }) => {
      socket.join(`offer:${offerId}`);
    });

    // ─── LOCATION TRACKING ──────────────────────────────────────────────────────────────────

    socket.on('update_location', async ({ lat, lng, address }) => {
      try {
        await User.findByIdAndUpdate(userId, {
          'location.coordinates': [parseFloat(lng), parseFloat(lat)],
          'location.address': address,
        });
        logger.debug(`Location updated for user ${userId}`);
      } catch (error) {
        logger.error('update_location error:', error);
      }
    });

    // ─── DISCONNECT ─────────────────────────────────────────────────────────────────────────

    socket.on('disconnect', (reason) => {
      connectedUsers.delete(userId);
      socket.broadcast.emit('user_offline', { userId });
      logger.info(`🔔 Socket disconnected: ${userId} (${reason})`);
    });

    socket.on('error', (error) => {
      logger.error(`Socket error for ${userId}:`, error);
    });
  });

  // Utility: get online users count
  io.getOnlineCount = () => connectedUsers.size;
  io.getConnectedUsers = () => Array.from(connectedUsers.keys());
  io.isUserOnline = (userId) => connectedUsers.has(userId.toString());

  logger.info('✅ Socket.io initialized');
};

module.exports = { initializeSocket, connectedUsers };
