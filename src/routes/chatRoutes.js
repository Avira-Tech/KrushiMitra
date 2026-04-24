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
} = require('../controllers/chatController');

// ─── Protected routes ────────────────────────────────────────────────────
router.use(protect);

router.get('/', getChats || getConversations);
router.get('/presence', getPresence);
router.get('/conversations', getConversations);
router.get('/conversations/:id/messages', getMessages);
router.delete('/messages/:id', deleteMessage);
router.put('/messages/:id', editMessage);
router.post('/messages/:id/reaction', toggleReaction);

module.exports = router;
