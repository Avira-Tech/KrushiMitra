const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { getOrCreateChat, getMyChats, getMessages, sendMessage } = require('../controllers/chatController');

router.use(protect);

router.get('/', getMyChats);
router.post('/', getOrCreateChat);
router.get('/:chatId/messages', getMessages);
router.post('/:chatId/messages', sendMessage);

module.exports = router;
