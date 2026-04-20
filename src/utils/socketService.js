'use strict';
/**
 * socketService.js
 * 
 * Centralized service for emitting socket events from outside the socket handler (e.g. controllers).
 * Eliminates reliance on global.io.
 */
const logger = require('./logger');

let io = null;

const init = (socketIoInstance) => {
  io = socketIoInstance;
  logger.info('SocketService initialized');
};

const emitToUser = (userId, event, data) => {
  if (!io) {
    logger.warn(`Could not emit ${event} to user ${userId}: Socket.io not initialized`);
    return false;
  }
  io.to(`user:${userId}`).emit(event, data);
  return true;
};

const emitToRoom = (room, event, data) => {
  if (!io) {
    logger.warn(`Could not emit ${event} to room ${room}: Socket.io not initialized`);
    return false;
  }
  io.to(room).emit(event, data);
  return true;
};

const broadcast = (event, data) => {
  if (!io) {
    logger.warn(`Could not broadcast ${event}: Socket.io not initialized`);
    return false;
  }
  io.emit(event, data);
  return true;
};

module.exports = {
  init,
  emitToUser,
  emitToRoom,
  broadcast,
  get io() { return io; }
};
