'use strict';

const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const { getPayoutSummary, requestWithdrawal } = require('../controllers/payoutController');

router.use(protect);

// Only farmers can view summary and request withdrawals
router.get('/summary', restrictTo('farmer'), getPayoutSummary);
router.post('/request', restrictTo('farmer'), requestWithdrawal);

module.exports = router;
