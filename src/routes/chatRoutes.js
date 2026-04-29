const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const {
  getConversations,
  getMessages,
  deleteMessage,
  getChats,
  getAdminForChat,
  editMessage,
  getPresence,
  toggleReaction,
  generateAgoraToken,
  startChat,
} = require('../controllers/chatController');

// ─── Protected routes ────────────────────────────────────────────────────
router.use(protect);

router.get('/', getChats || getConversations);
router.get('/presence', getPresence);
router.post('/call/token', generateAgoraToken);
router.post('/start', startChat);
router.get('/conversations', getConversations);
router.get('/conversations/:id/messages', getMessages);
router.get('/help', getAdminForChat);
router.delete('/messages/:id', deleteMessage);
router.put('/messages/:id', editMessage);
router.post('/messages/:id/reaction', toggleReaction);

module.exports = router;
