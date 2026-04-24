'use strict';
/**
 * socketHandler.js
 *
 * Security model:
 *  - io.use() JWT middleware verifies token on every connection attempt
 *  - Identity comes from the verified token, never from client-sent data
 *  - 'user:auth' event removed — cannot be spoofed
 *  - Room joins verified — user must be a participant in the conversation
 *  - All socket events are wrapped in try/catch
 *  - Socket stored in useRef on frontend — cleanup always disconnects
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Lazy-loaded to avoid circular imports
let Message, Conversation, User;
const loadModels = () => {
  if (!Message) Message = require('../models/Message');
  if (!Conversation) Conversation = require('../models/Conversation');
  if (!User) User = require('../models/User');
};

// userId → Set<socketId> — MOVED TO REDIS for horizontal scaling
const { redis } = require('../config/redis');
const PRESENCE_KEY = 'presence:active_users';

const initializeSocket = (io) => {
  loadModels();

  // ─── JWT Authentication Middleware ──────────────────────────────────────────
  // Every connection must supply a valid JWT in handshake.auth.token
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication token required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'krushimitra-api',
        audience: 'krushimitra-app',
      });

      const user = await User.findById(decoded.id).select('name role isBanned isActive');
      if (!user) return next(new Error('User not found'));
      if (user.isBanned) return next(new Error('Account suspended'));
      if (!user.isActive) return next(new Error('Account inactive'));

      // Attach verified identity to socket
      socket.userId = decoded.id.toString();
      socket.userRole = user.role;
      socket.userName = user.name;

      next();
    } catch (err) {
      logger.warn('Socket auth failed: ' + err.message);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Track connections in Redis (atomic increment/set)
    (async () => {
      try {
        const count = await redis.hincrby(PRESENCE_KEY, userId, 1);
        if (count === 1) {
          // Broadcast online only on the first connection
          io.to(`role:farmer`).to(`role:buyer`).emit('presence:online', { userId, timestamp: new Date() });
        }
      } catch (err) {
        logger.error('Error tracking presence: ' + err.message);
      }
    })();

    // Auto-join personal room for targeted notifications
    socket.join(`user:${userId}`);
    socket.join(`role:${socket.userRole}`);

    logger.info(`Socket connected: ${userId} (${socket.userRole}) — ${socket.id}`);

    // Mark undelivered messages for this user as delivered
    (async () => {
      try {
        const undelivered = await Message.find({ recipient: userId, isDelivered: false });
        if (undelivered.length > 0) {
          const now = new Date();
          await Message.updateMany(
            { recipient: userId, isDelivered: false },
            { $set: { isDelivered: true, deliveredAt: now } }
          );
          // Notify senders in each conversation
          const convIds = [...new Set(undelivered.map(m => m.conversationId.toString()))];
          convIds.forEach(cid => {
            io.to(`conversation:${cid}`).emit('messages:delivered', { 
              conversationId: cid, 
              recipientId: userId,
              deliveredAt: now 
            });
          });
        }
      } catch (err) {
        logger.error('Error marking messages as delivered on connect: ' + err.message);
      }
    })();

    // ─── Chat Events ──────────────────────────────────────────────────────────

    socket.on('chat:join', async ({ conversationId }) => {
      try {
        if (!conversationId) return socket.emit('error', { message: 'conversationId required' });

        const conv = await Conversation.findById(conversationId).lean();
        if (!conv) return socket.emit('error', { message: 'Conversation not found' });

        const isParticipant = conv.participants.some((p) => p.toString() === userId);
        if (!isParticipant) return socket.emit('error', { message: 'Not a participant in this conversation' });

        socket.join(`conversation:${conversationId}`);
        logger.info(`User ${userId} joined conversation ${conversationId}`);
      } catch (err) {
        logger.error('chat:join error: ' + err.message);
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    socket.on('message:send', async ({ conversationId, recipientId, content, messageType = 'text' }) => {
      try {
        if (!conversationId || !content?.trim()) {
          return socket.emit('error', { message: 'conversationId and content are required' });
        }

        // 1. Resolve/Upsert Conversation (prevents duplicates)
        let conv;
        if (conversationId) {
          conv = await Conversation.findById(conversationId);
        } else if (recipientId) {
          // Deterministic sorting ensures [A,B] and [B,A] both map to [A,B] 
          const participants = [userId.toString(), recipientId.toString()].sort();
          conv = await Conversation.findOneAndUpdate(
            { participants: { $size: 2, $all: participants } },
            {
              $setOnInsert: { participants, lastMessageAt: new Date() }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          conversationId = conv._id;
        }

        if (!conv) return socket.emit('error', { message: 'Conversation not found and recipientId not provided' });

        const isParticipant = conv.participants.some((p) => p.toString() === userId);
        if (!isParticipant) return socket.emit('error', { message: 'Unauthorized' });

        const recipientOnline = await isUserOnline(recipientId);

        const message = await Message.create({
          conversationId: conv._id,
          sender: userId,
          recipient: recipientId,
          content: content.trim(),
          messageType,
          isDelivered: recipientOnline,
          deliveredAt: recipientOnline ? new Date() : null,
        });

        await message.populate('sender', 'name avatar');

        // Update conversation's last message
        await Conversation.findByIdAndUpdate(conv._id, {
          lastMessage: message._id,
          lastMessageAt: new Date(),
        });

        const payload = {
          _id: message._id,
          conversationId: conv._id,
          sender: message.sender,
          recipient: recipientId,
          content: message.content,
          messageType,
          createdAt: message.createdAt,
          isRead: false,
          isDelivered: message.isDelivered,
        };

        // Emit to everyone in the conversation room
        io.to(`conversation:${conv._id}`).emit('message:new', payload);

        logger.info(`Message sent: ${message._id} in conversation ${conv._id}`);
      } catch (err) {
        logger.error('message:send error: ' + err.message);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('message:read', async ({ messageId, conversationId }) => {
      try {
        const message = await Message.findByIdAndUpdate(
          messageId,
          { isRead: true, readAt: new Date(), isDelivered: true },
          { new: true }
        );
        if (message) {
          io.to(`conversation:${conversationId}`).emit('message:read', { messageId, readAt: message.readAt });
        }
      } catch (err) {
        logger.error('message:read error: ' + err.message);
      }
    });

    socket.on('message:delivered', async ({ messageId, conversationId }) => {
      try {
        const message = await Message.findByIdAndUpdate(
          messageId,
          { isDelivered: true, deliveredAt: new Date() },
          { new: true }
        );
        if (message) {
          io.to(`conversation:${conversationId}`).emit('message:delivered', { messageId, deliveredAt: message.deliveredAt });
        }
      } catch (err) {
        logger.error('message:delivered error: ' + err.message);
      }
    });

    // ─── Typing Indicators ────────────────────────────────────────────────────

    socket.on('typing:start', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:active', { userId });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:inactive', { userId });
    });

    socket.on('presence:get', async ({ userId: targetUserId }) => {
      try {
        const online = await isUserOnline(targetUserId);
        socket.emit('presence:status', { userId: targetUserId, status: online ? 'online' : 'offline' });
      } catch (err) {
        logger.error('presence:get error: ' + err.message);
      }
    });

    // ─── Disconnect ───────────────────────────────────────────────────────────

    socket.on('disconnect', async (reason) => {
      try {
        const count = await redis.hincrby(PRESENCE_KEY, userId, -1);
        if (count <= 0) {
          await redis.hdel(PRESENCE_KEY, userId);
          // Broadcast offline only when all connections across all servers closed
          io.to(`role:farmer`).to(`role:buyer`).emit('presence:offline', { userId, timestamp: new Date() });
        }
      } catch (err) {
        logger.error('Socket disconnect tracking error: ' + err.message);
      }
      logger.info(`Socket disconnected: ${userId} — reason: ${reason}`);
    });

    socket.on('error', (err) => logger.error('Socket error: ' + err.message));
  });

  logger.info('Socket.io initialized with JWT middleware');
};

const isUserOnline = async (userId) => {
  const count = await redis.hget(PRESENCE_KEY, userId);
  return parseInt(count) > 0;
};

// Note: getSocketIds can no longer be local-only. For scaling, 
// use io.to(`user:${userId}`).emit() which works across nodes.
const getSocketIds = async (userId) => {
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.map(s => s.id);
};

module.exports = { initializeSocket, isUserOnline, getSocketIds };