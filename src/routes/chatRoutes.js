const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const {
  getConversations,
  getMessages,
  deleteMessage,
  getChats,
} = require('../controllers/chatController');

// ─── Protected routes ────────────────────────────────────────────────────
router.use(protect);

router.get('/', getChats || getConversations);
router.get('/conversations', getConversations);
router.get('/conversations/:id/messages', getMessages);
router.delete('/messages/:id', deleteMessage);

module.exports = router;
