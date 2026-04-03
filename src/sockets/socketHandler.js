// const logger = require('../utils/logger');

// // Lazy load models to avoid circular imports
// let Message, Conversation, User;

// const loadModels = () => {
//   if (!Message) Message = require('../models/Message');
//   if (!Conversation) Conversation = require('../models/Conversation');
//   if (!User) User = require('../models/User');
// };

// // Store active connections
// const activeConnections = new Map();

// const initializeSocket = (io) => {
//   loadModels(); // Load models once when socket is initialized

//   io.on('connection', (socket) => {
//     logger.info(`✅ User connected: ${socket.id}`);

//     // ─── User Authentication ──────────────────────────────────────────────
//     socket.on('user:auth', async (data) => {
//       try {
//         const { userId } = data;
        
//         const user = await User.findById(userId);
//         if (!user) {
//           socket.emit('error', { message: 'User not found' });
//           return;
//         }

//         activeConnections.set(userId, socket.id);
//         socket.userId = userId;
//         socket.userRole = user.role;

//         socket.join(`user:${userId}`);
//         socket.join(`role:${user.role}`);

//         logger.info(`✅ User authenticated: ${userId} (${user.role})`);
//         socket.emit('auth:success', { message: 'Authenticated' });
//       } catch (error) {
//         logger.error('❌ Auth error:', error);
//         socket.emit('error', { message: 'Authentication failed' });
//       }
//     });

//     // ─── Chat Events ──────────────────────────────────────────────────────

//     socket.on('chat:join', async (data) => {
//       try {
//         const { conversationId } = data;
//         const userId = socket.userId;

//         if (!userId) {
//           socket.emit('error', { message: 'Not authenticated' });
//           return;
//         }

//         const conversation = await Conversation.findById(conversationId);
//         if (!conversation || !conversation.participants.includes(userId)) {
//           socket.emit('error', { message: 'Unauthorized' });
//           return;
//         }

//         socket.join(`conversation:${conversationId}`);
//         logger.info(`✅ User ${userId} joined conversation ${conversationId}`);
//       } catch (error) {
//         logger.error('❌ Chat join error:', error);
//         socket.emit('error', { message: 'Failed to join conversation' });
//       }
//     });

//     socket.on('message:send', async (data) => {
//       try {
//         const { conversationId, recipientId, content, messageType = 'text' } = data;
//         const senderId = socket.userId;

//         if (!senderId || !conversationId || !content) {
//           socket.emit('error', { message: 'Invalid message data' });
//           return;
//         }

//         let conversation = await Conversation.findById(conversationId);
//         if (!conversation) {
//           conversation = new Conversation({
//             participants: [senderId, recipientId],
//           });
//           await conversation.save();
//         }

//         const message = new Message({
//           conversationId,
//           sender: senderId,
//           recipient: recipientId,
//           content,
//           messageType,
//         });

//         await message.save();
//         await message.populate('sender', 'name avatar');

//         conversation.lastMessage = message._id;
//         conversation.lastMessageAt = new Date();
//         await conversation.save();

//         io.to(`conversation:${conversationId}`).emit('message:new', {
//           _id: message._id,
//           conversationId,
//           sender: message.sender,
//           recipient: recipientId,
//           content: message.content,
//           messageType,
//           createdAt: message.createdAt,
//           isRead: false,
//         });

//         logger.info(`✅ Message sent: ${message._id}`);
//       } catch (error) {
//         logger.error('❌ Message send error:', error);
//         socket.emit('error', { message: 'Failed to send message' });
//       }
//     });

//     socket.on('message:read', async (data) => {
//       try {
//         const { messageId, conversationId } = data;

//         const message = await Message.findByIdAndUpdate(
//           messageId,
//           { isRead: true, readAt: new Date() },
//           { new: true }
//         );

//         if (message) {
//           io.to(`conversation:${conversationId}`).emit('message:read', {
//             messageId,
//             readAt: message.readAt,
//           });
//         }
//       } catch (error) {
//         logger.error('❌ Mark read error:', error);
//       }
//     });

//     socket.on('typing:start', (data) => {
//       const { conversationId } = data;
//       socket.broadcast.to(`conversation:${conversationId}`).emit('typing:active', {
//         userId: socket.userId,
//       });
//     });

//     socket.on('typing:stop', (data) => {
//       const { conversationId } = data;
//       socket.broadcast.to(`conversation:${conversationId}`).emit('typing:inactive', {
//         userId: socket.userId,
//       });
//     });

//     // ─── Offer Events ─────────────────────────────────────────────────────

//     socket.on('offer:status-changed', (data) => {
//       const { offerId, status, farmerId, buyerId } = data;

//       io.to(`user:${farmerId}`).emit('notification:offer', {
//         offerId,
//         status,
//         message: `Offer status changed to ${status}`,
//         timestamp: new Date(),
//       });

//       io.to(`user:${buyerId}`).emit('notification:offer', {
//         offerId,
//         status,
//         message: `Your offer status changed to ${status}`,
//         timestamp: new Date(),
//       });

//       logger.info(`✅ Offer status updated: ${offerId} -> ${status}`);
//     });

//     socket.on('offer:created', (data) => {
//       const { offerId, farmerId, cropName, buyerName } = data;

//       io.to(`user:${farmerId}`).emit('notification:new-offer', {
//         offerId,
//         message: `${buyerName} made an offer on ${cropName}`,
//         timestamp: new Date(),
//       });

//       logger.info(`✅ New offer notification: ${offerId}`);
//     });

//     // ─── Presence Events ──────────────────────────────────────────────────

//     socket.on('user:online', (data) => {
//       const { userId } = data;
//       io.emit('presence:online', { userId, timestamp: new Date() });
//     });

//     socket.on('user:offline', (data) => {
//       const { userId } = data;
//       io.emit('presence:offline', { userId, timestamp: new Date() });
//     });

//     socket.on('notification:send', (data) => {
//       const { userId, title, message, type } = data;

//       io.to(`user:${userId}`).emit('notification:received', {
//         title,
//         message,
//         type,
//         timestamp: new Date(),
//       });

//       logger.info(`✅ Notification sent to ${userId}`);
//     });

//     // ─── Error & Disconnect ───────────────────────────────────────────────

//     socket.on('error', (error) => {
//       logger.error('❌ Socket error:', error);
//     });

//     socket.on('disconnect', () => {
//       const userId = socket.userId;
      
//       if (userId) {
//         activeConnections.delete(userId);
//         io.emit('presence:offline', { userId, timestamp: new Date() });
//         logger.info(`❌ User disconnected: ${userId} (${socket.id})`);
//       }
//     });
//   });

//   logger.info('✅ Socket.io initialized');
// };

// const getActiveSocket = (userId) => activeConnections.get(userId);
// const isUserOnline = (userId) => activeConnections.has(userId);

// module.exports = {
//   initializeSocket,
//   getActiveSocket,
//   isUserOnline,
//   activeConnections,
// };

'use strict';
/**
 * socketHandler.js
 *
 * Security model:
 *   • JWT is verified on the handshake via io.use() middleware — before any event fires.
 *   • socket.userId / socket.userRole are set from the VERIFIED token, not from client data.
 *   • The 'user:auth' client event is removed — identity comes from the token only.
 *   • Room joins are protected: userId from token must match the conversation's participant list.
 */

const jwt     = require('jsonwebtoken');
const logger  = require('../utils/logger');

// Lazy-load models to avoid circular-import issues at startup
let Message, Conversation, User;
const loadModels = () => {
  if (!Message)      Message      = require('../models/Message');
  if (!Conversation) Conversation = require('../models/Conversation');
  if (!User)         User         = require('../models/User');
};

/** userId → socketId map for presence tracking */
const activeConnections = new Map();

// ─── Socket.io initialisation ─────────────────────────────────────────────────
const initializeSocket = (io) => {
  loadModels();

  // ── JWT Authentication Middleware (runs before any 'connection' event) ──────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('AUTH_REQUIRED: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        // If your jwt.js utility adds issuer/audience, uncomment these:
        // issuer:   'krushimitra-api',
        // audience: 'krushimitra-app',
      });

      // Verify user is still active in DB (catches banned users)
      const user = await (User || require('../models/User'))
        .findById(decoded.id)
        .select('role status isBanned name');

      if (!user) return next(new Error('AUTH_FAILED: User not found'));
      if (user.isBanned || user.status === 'banned') {
        return next(new Error('AUTH_FAILED: Account suspended'));
      }

      // Attach verified identity to socket — never trust client-sent userId again
      socket.userId   = decoded.id.toString();
      socket.userRole = user.role;
      socket.userName = user.name;

      next();
    } catch (err) {
      logger.warn(`Socket auth rejected: ${err.message}`);
      next(new Error('AUTH_FAILED: Invalid token'));
    }
  });

  // ── Connection handler (only runs for authenticated sockets) ────────────────
  io.on('connection', (socket) => {
    const { userId, userRole, userName } = socket;

    logger.info(`✅ Socket connected: ${userId} (${userRole}) [${socket.id}]`);

    // Register in presence map and join personal + role rooms
    activeConnections.set(userId, socket.id);
    socket.join(`user:${userId}`);
    socket.join(`role:${userRole}`);

    // Broadcast online status to mutual contacts (keep room-scoped, not global)
    socket.to(`role:farmer`).to(`role:buyer`).emit('presence:online', {
      userId,
      timestamp: new Date(),
    });

    // ── Chat Events ────────────────────────────────────────────────────────────

    socket.on('chat:join', async ({ conversationId }) => {
      try {
        if (!conversationId) return;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          socket.emit('error', { code: 'NOT_FOUND', message: 'Conversation not found' });
          return;
        }

        // Only participants can join
        const isParticipant = conversation.participants
          .map(String)
          .includes(userId);

        if (!isParticipant) {
          socket.emit('error', { code: 'FORBIDDEN', message: 'Not a participant in this conversation' });
          return;
        }

        socket.join(`conversation:${conversationId}`);
        logger.info(`User ${userId} joined conversation ${conversationId}`);
      } catch (err) {
        logger.error('chat:join error:', err);
        socket.emit('error', { code: 'SERVER_ERROR', message: 'Could not join conversation' });
      }
    });

    socket.on('message:send', async ({ conversationId, recipientId, content, messageType = 'text' }) => {
      try {
        if (!conversationId || !content?.trim()) {
          socket.emit('error', { code: 'INVALID', message: 'conversationId and content are required' });
          return;
        }

        // Ensure conversation exists; create if not
        let conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          if (!recipientId) {
            socket.emit('error', { code: 'INVALID', message: 'recipientId required to start conversation' });
            return;
          }
          conversation = await Conversation.create({
            participants: [userId, recipientId],
          });
          socket.join(`conversation:${conversation._id}`);
        }

        // Verify sender is a participant
        const isParticipant = conversation.participants.map(String).includes(userId);
        if (!isParticipant) {
          socket.emit('error', { code: 'FORBIDDEN', message: 'Not authorised to send in this conversation' });
          return;
        }

        // Persist message
        const message = await Message.create({
          conversationId: conversation._id,
          sender:         userId,
          recipient:      recipientId || conversation.participants.find((p) => String(p) !== userId),
          content:        content.trim(),
          messageType,
        });

        await message.populate('sender', 'name avatar');

        // Update conversation metadata
        conversation.lastMessage   = message._id;
        conversation.lastMessageAt = new Date();
        await conversation.save();

        // Broadcast to all room participants (sender included for optimistic-UI confirmation)
        const payload = {
          _id:            message._id,
          conversationId: conversation._id,
          sender:         message.sender,
          content:        message.content,
          messageType,
          createdAt:      message.createdAt,
          isRead:         false,
        };
        io.to(`conversation:${conversation._id}`).emit('message:new', payload);

      } catch (err) {
        logger.error('message:send error:', err);
        socket.emit('error', { code: 'SERVER_ERROR', message: 'Message delivery failed' });
      }
    });

    socket.on('message:read', async ({ messageId, conversationId }) => {
      try {
        const updated = await Message.findByIdAndUpdate(
          messageId,
          { isRead: true, readAt: new Date() },
          { new: true }
        );
        if (updated) {
          io.to(`conversation:${conversationId}`).emit('message:read', {
            messageId,
            readAt: updated.readAt,
          });
        }
      } catch (err) {
        logger.error('message:read error:', err);
      }
    });

    socket.on('typing:start', ({ conversationId }) => {
      if (!conversationId) return;
      socket.broadcast.to(`conversation:${conversationId}`).emit('typing:active', { userId });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      if (!conversationId) return;
      socket.broadcast.to(`conversation:${conversationId}`).emit('typing:inactive', { userId });
    });

    // ── Offer Notifications ────────────────────────────────────────────────────
    // These are server-to-client only — emitted from controllers via global.io
    // The client should NOT emit offer:status-changed — that's a server responsibility

    // ── Disconnect ─────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      activeConnections.delete(userId);
      // Scope offline broadcast to users who care (not everyone)
      socket.to(`role:farmer`).to(`role:buyer`).emit('presence:offline', {
        userId,
        timestamp: new Date(),
      });
      logger.info(`Socket disconnected: ${userId} [${socket.id}] — ${reason}`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error for ${userId}:`, err);
    });
  });

  logger.info('✅ Socket.io initialised with JWT auth middleware');
};

// ─── Utility exports ──────────────────────────────────────────────────────────
const getActiveSocket = (userId) => activeConnections.get(String(userId));
const isUserOnline    = (userId) => activeConnections.has(String(userId));

/**
 * Send a real-time notification to a specific user.
 * Used by controllers/services that have access to global.io.
 */
const emitToUser = (io, userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
};

module.exports = { initializeSocket, getActiveSocket, isUserOnline, emitToUser, activeConnections };