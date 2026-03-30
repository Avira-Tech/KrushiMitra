const express = require('express');
const router = express.Router();
const { optionalAuth, protect, restrictTo } = require('../middlewares/auth');
const { getPrices, getPriceHistory, syncPrices } = require('../controllers/mandiController');

router.get('/', optionalAuth, getPrices);
router.get('/:commodity/history', optionalAuth, getPriceHistory);
router.post('/sync', protect, restrictTo('admin'), syncPrices);

module.exports = router;
